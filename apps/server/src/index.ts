import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { RPCHandler } from "@orpc/server/fetch";
import { router, type Context } from "@dev-agents/rpc";
import type { AgentInfo, AgentEvent } from "@dev-agents/shared";
import { getLoops, syncLoops } from "./loops.js";
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";

const PORT = parseInt(process.env.PORT || "8788", 10);

// Fetch API key from macOS Keychain (SSO keys rotate)
function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    return execSync('security find-generic-password -s "Claude Code" -w', { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", cors());

// --- Agent registry (in-memory) ---

const agents = new Map<string, AgentInfo>();

// --- oRPC handler ---

const rpcHandler = new RPCHandler(router);
const loops = getLoops();

function buildContext(): Context {
  return { agents, loops };
}

app.use("/api/rpc/*", async (c) => {
  const context = buildContext();
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/api/rpc",
    context,
  });
  if (matched && response) {
    return response;
  }
  return c.json({ error: "RPC not matched" }, 404);
});

// --- Push event receiver (agents POST here) ---

const wsClients = new Set<{ send: (data: string) => void }>();

function broadcastEvent(event: AgentEvent) {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    try { ws.send(data); } catch { wsClients.delete(ws); }
  }
}

function dockerPort(container: string, port: string): number {
  try {
    const out = execSync(`docker port ${container} ${port}`, { encoding: "utf8" });
    const match = out.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch { return 0; }
}

app.post("/api/events", async (c) => {
  const body = await c.req.json<AgentEvent>();
  const { type, agent, content, port, channelPort } = body;

  if (agent && agent !== "unknown") {
    const existing = agents.get(agent);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      if (type === "status") existing.status = content;
    } else {
      const hostPort = port || dockerPort(`dev-${agent}`, "9111");
      const chanPort = channelPort || dockerPort(`dev-${agent}`, "9222");
      agents.set(agent, {
        id: agent,
        containerId: "external",
        hostPort,
        channelPort: chanPort,
        homeDir: `${process.env.HOME}/dev-agents/${agent}`,
        project: null,
        status: content || "registered",
        lastSeen: new Date().toISOString(),
      });
    }
  }

  broadcastEvent(body);
  return c.json({ status: "delivered" });
});

// --- WebSocket: live events ---

app.get("/api/ws", upgradeWebSocket(() => ({
  onOpen(_event, ws) {
    wsClients.add(ws as any);
  },
  onClose(_event, ws) {
    wsClients.delete(ws as any);
  },
})));

// --- Orchestrator container (started once at server init, persists) ---

function ensureOrchestratorContainer() {
  const home = process.env.HOME || "/tmp";
  const apiKey = getApiKey();
  // Write MCP config
  const mcpPath = `${home}/dev-agents/orchestrator/.mcp.json`;
  writeFileSync(mcpPath, JSON.stringify({
    mcpServers: {
      agent: {
        command: "bun",
        args: ["/opt/agent/agent-channel.ts"],
        env: {
          ORCHESTRATOR_HOME: "/home/agent/dev-agents/orchestrator",
          ANTHROPIC_API_KEY: apiKey,
        },
      },
    },
  }));

  // Pre-seed onboarding
  const claudeJson = `${home}/dev-agents/orchestrator/.claude.json`;
  if (!existsSync(claudeJson)) {
    writeFileSync(claudeJson, JSON.stringify({ hasCompletedOnboarding: true }));
  }

  // Check if already running
  try {
    const out = execSync("docker inspect -f '{{.State.Running}}' dev-orchestrator-tty 2>/dev/null", { encoding: "utf8" });
    if (out.trim() === "true") {
      console.log("Orchestrator container already running");
      return;
    }
  } catch {}

  // Start it
  try { execSync("docker rm -f dev-orchestrator-tty 2>/dev/null"); } catch {}
  const result = spawnSync("docker", [
    "run", "-d",
    "--name", "dev-orchestrator-tty",
    "-v", `${home}/dev-agents:/home/agent/dev-agents`,
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "--add-host", "host.docker.internal:host-gateway",
    "--group-add", "0",
    "-p", "8789:8788",
    "-e", `ANTHROPIC_API_KEY=${apiKey}`,
    "-e", "AGENT_ID=orchestrator",
    "-e", "HOME=/home/agent",
    "-e", "ORCHESTRATOR_HOME=/home/agent/dev-agents/orchestrator",
    "-e", "CLAUDE_CONFIG_DIR=/home/agent/dev-agents/orchestrator/.claude",
    "-e", "LANG=C.UTF-8",
    "-e", "LC_ALL=C.UTF-8",
    "-w", "/home/agent/dev-agents/orchestrator",
    "--memory", "8g",
    "dev-agent:latest",
    "bash", "-c",
    // Start Claude in a tmux session so it survives disconnects
    "tmux new-session -d -s orchestrator claude; sleep infinity",
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    console.error("Failed to start orchestrator container:", result.stderr);
  } else {
    console.log("Started orchestrator container:", result.stdout.trim().slice(0, 12));
  }
}

// --- WebSocket: terminal PTY (just attaches to running container) ---

app.get("/api/terminal", upgradeWebSocket(() => {
  let term: pty.IPty | null = null;

  return {
    onOpen(_event, ws) {
      // Attach to the tmux session running Claude
      // Detach other clients first, then attach
      term = pty.spawn("docker", [
        "exec", "-it", "dev-orchestrator-tty",
        "bash", "-c", "tmux detach-client -t orchestrator 2>/dev/null; tmux attach -t orchestrator 2>/dev/null || tmux new-session -s orchestrator claude",
      ], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        env: process.env as Record<string, string>,
      });

      term.onData((data) => {
        try { (ws as any).send(data); } catch {}
      });

      term.onExit(() => {
        try { (ws as any).close(); } catch {}
      });
    },
    onMessage(event, ws) {
      if (!term) return;
      const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);

      if (data.startsWith("{")) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            term.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {}
      }

      term.write(data);
    },
    onClose() {
      if (term) {
        term.kill();
        term = null;
      }
    },
  };
}));

// --- SSE proxy for agent streams ---

app.get("/api/agents/:id/stream", async (c) => {
  const id = c.req.param("id");
  const agent = agents.get(id);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  try {
    const resp = await fetch(`http://localhost:${agent.hostPort}/stream`);
    return new Response(resp.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// --- Serve dashboard SPA ---

app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ path: "../web/dist/index.html" }));

// --- Auto-discover running agents ---

function discoverAgents() {
  try {
    const out = execSync("docker ps --filter name=dev- --format '{{.Names}}'", { encoding: "utf8" });
    const names = out.trim().split("\n").filter(Boolean);
    for (const name of names) {
      const agentId = name.replace(/^dev-/, "");
      if (agents.has(agentId)) continue;
      const hostPort = dockerPort(name, "9111");
      const channelPort = dockerPort(name, "9222");
      if (hostPort) {
        agents.set(agentId, {
          id: agentId,
          containerId: name,
          hostPort,
          channelPort,
          homeDir: `${process.env.HOME}/dev-agents/${agentId}`,
          project: null,
          status: "discovered",
          lastSeen: new Date().toISOString(),
        });
      }
    }
    if (agents.size > 0) {
      console.log(`Discovered ${agents.size} running agent(s): ${[...agents.keys()].join(", ")}`);
    }
  } catch {}
}

discoverAgents();
ensureOrchestratorContainer();

// Sync loop intervals
setInterval(() => syncLoops(agents), 2000);

// --- Start ---

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Dev Agents server running on :${info.port}`);
});

injectWebSocket(server);
