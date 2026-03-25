import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { RPCHandler } from "@orpc/server/node";
import { router, type Context } from "@dev-agents/rpc";
import type { AgentInfo, AgentEvent } from "@dev-agents/shared";

const PORT = parseInt(process.env.PORT || "8788", 10);

const app = new Hono();

app.use("*", cors());

// --- Agent registry (in-memory) ---

const agents = new Map<string, AgentInfo>();

// --- oRPC handler ---

const rpcHandler = new RPCHandler(router);

function buildContext(): Context {
  return { agents };
}

app.use("/api/rpc/*", async (c) => {
  const context = buildContext();
  const { matched } = await rpcHandler.handle(c.req.raw, {
    prefix: "/api/rpc",
    context,
  });
  if (matched) {
    return new Response(null, { status: 200 }); // rpcHandler already sent response
  }
  return c.json({ error: "RPC not matched" }, 404);
});

// --- Push event receiver (agents POST here) ---

app.post("/api/events", async (c) => {
  const body = await c.req.json<AgentEvent>();
  const { type, agent, content, port, channelPort } = body;

  if (agent && agent !== "unknown") {
    const existing = agents.get(agent);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      if (type === "status") existing.status = content;
    } else {
      let hostPort = port || 0;
      let chanPort = channelPort || 0;
      if (!hostPort) {
        try {
          const proc = Bun.spawnSync(["docker", "port", `dev-${agent}`, "9111"]);
          const match = proc.stdout.toString().match(/:(\d+)/);
          if (match) hostPort = parseInt(match[1], 10);
        } catch {}
      }
      if (!chanPort) {
        try {
          const proc = Bun.spawnSync(["docker", "port", `dev-${agent}`, "9222"]);
          const match = proc.stdout.toString().match(/:(\d+)/);
          if (match) chanPort = parseInt(match[1], 10);
        } catch {}
      }
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

// --- WebSocket for live events ---

const wsClients = new Set<{ send: (data: string) => void }>();

function broadcastEvent(event: AgentEvent) {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}

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

// --- Start ---

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket: {
    open(ws) {
      wsClients.add(ws);
    },
    message() {},
    close(ws) {
      wsClients.delete(ws);
    },
  },
});

// Auto-discover running agents on startup
async function discoverAgents() {
  try {
    const proc = Bun.spawnSync(["docker", "ps", "--filter", "name=dev-", "--format", "{{.Names}}"]);
    const names = proc.stdout.toString().trim().split("\n").filter(Boolean);
    for (const name of names) {
      const agentId = name.replace(/^dev-/, "");
      if (agents.has(agentId)) continue;
      let hostPort = 0, channelPort = 0;
      try {
        const p = Bun.spawnSync(["docker", "port", name, "9111"]);
        const m = p.stdout.toString().match(/:(\d+)/);
        if (m) hostPort = parseInt(m[1], 10);
      } catch {}
      try {
        const p = Bun.spawnSync(["docker", "port", name, "9222"]);
        const m = p.stdout.toString().match(/:(\d+)/);
        if (m) channelPort = parseInt(m[1], 10);
      } catch {}
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

await discoverAgents();
console.log(`Dev Agents server running on :${PORT}`);
