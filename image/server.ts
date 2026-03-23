#!/usr/bin/env bun
//
// Agent server — runs inside every container (worker + orchestrator)
//
// Single Bun process that handles:
//   - Command server (:9111) — exec, health, notify, ask, respond
//   - Agent channel (:9222) — receives messages from orchestrator,
//     pushes them into the local Claude Code session via MCP
//
// The command server is always on. The agent channel starts when
// CHANNEL_URL is set (i.e. this is a worker, not the orchestrator).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const CMD_PORT = parseInt(Bun.env.AGENT_PORT || "9111", 10);
const CHANNEL_PORT = parseInt(Bun.env.AGENT_CHANNEL_PORT || "9222", 10);
const WORKSPACE = Bun.env.WORKSPACE || "/home/agent/workspace";
const AGENT_ID = Bun.env.AGENT_ID || "agent-1";
const CHANNEL_URL = Bun.env.CHANNEL_URL || "";

// --- Push to orchestrator ---

async function pushToOrchestrator(type: string, content: string) {
  if (!CHANNEL_URL) return;
  try {
    await fetch(CHANNEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, agent: AGENT_ID, content, port: CMD_PORT, channelPort: CHANNEL_PORT }),
    });
  } catch (err: any) {
    console.error(`Push failed: ${err.message}`);
  }
}

// --- Command execution ---

async function execCommand(
  command: string,
  cwd?: string,
  timeout?: number
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["bash", "-lc", command], {
      cwd: cwd || WORKSPACE,
      env: { ...Bun.env, TERM: "dumb" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = timeout
      ? setTimeout(() => proc.kill(), timeout)
      : null;

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (timer) clearTimeout(timer);
    return { exitCode, stdout, stderr };
  } catch (err: any) {
    return { exitCode: 1, stdout: "", stderr: err.message };
  }
}

// --- Pending reply for /ask ---

let pendingReply: ((response: string) => void) | null = null;

// --- Agent channel MCP server (for receiving orchestrator messages) ---

let agentMcp: Server | null = null;

// This will be set up if/when Claude Code connects to us as a channel.
// For now, the MCP server is created but only used when the agent
// runs Claude Code with --channels pointing to this server.

// --- Command server ---

Bun.serve({
  port: CMD_PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Health
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: AGENT_ID,
        workspace: WORKSPACE,
        channel: CHANNEL_URL || null,
        ports: { command: CMD_PORT, channel: CHANNEL_PORT },
      });
    }

    // Execute a command
    if (req.method === "POST" && url.pathname === "/exec") {
      const body = await req.json() as { command?: string; cwd?: string; timeout?: number };
      if (!body.command) {
        return Response.json({ error: "command is required" }, { status: 400 });
      }
      const result = await execCommand(body.command, body.cwd, body.timeout || 120_000);
      return Response.json(result);
    }

    // Push a notification to the orchestrator
    if (req.method === "POST" && url.pathname === "/notify") {
      const body = await req.json() as { type?: string; content?: string };
      await pushToOrchestrator(body.type || "message", body.content || "");
      return Response.json({ status: "pushed" });
    }

    // Ask the orchestrator a question (blocks until /respond)
    if (req.method === "POST" && url.pathname === "/ask") {
      const body = await req.json() as { prompt?: string };
      if (!body.prompt) {
        return Response.json({ error: "prompt is required" }, { status: 400 });
      }

      await pushToOrchestrator("prompt", body.prompt);

      const response = await new Promise<string>((resolve) => {
        pendingReply = resolve;
        setTimeout(() => {
          if (pendingReply === resolve) {
            pendingReply = null;
            resolve("(timeout: no response from orchestrator)");
          }
        }, 300_000);
      });

      return Response.json({ response });
    }

    // Receive a reply from the orchestrator
    if (req.method === "POST" && url.pathname === "/respond") {
      const body = await req.json() as { response?: string };
      if (pendingReply) {
        pendingReply(body.response || "");
        pendingReply = null;
        return Response.json({ status: "delivered" });
      }
      return Response.json({ status: "no_pending_prompt" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

// --- Agent channel server (receives messages from orchestrator) ---
// The orchestrator pushes messages here, and they get injected into
// the agent's Claude Code session via MCP notifications.

let channelClients: ((message: string) => void)[] = [];

Bun.serve({
  port: CHANNEL_PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", agent: AGENT_ID, channel: true });
    }

    // Orchestrator pushes a message to inject into the agent's Claude session
    if (req.method === "POST" && url.pathname === "/message") {
      const body = await req.json() as { content?: string; from?: string };
      const content = body.content || "";
      const from = body.from || "orchestrator";

      // If we have an MCP connection to Claude, push via channel notification
      if (agentMcp) {
        await agentMcp.notification({
          method: "notifications/claude/channel",
          params: {
            content,
            meta: { from, agent: AGENT_ID },
          },
        });
        return Response.json({ status: "injected" });
      }

      return Response.json({ status: "no_claude_session", content });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

// --- MCP channel for agent's Claude Code session ---
// When this server is used as a channel (via --channels), Claude Code
// connects over stdio. This sets up the MCP server for that connection.

if (Bun.env.AGENT_CHANNEL_MODE === "mcp") {
  agentMcp = new Server(
    { name: `agent-${AGENT_ID}`, version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions: `You are agent "${AGENT_ID}". Messages from the orchestrator arrive as <channel> events. Read them and act accordingly. If the orchestrator tells you to stop or change direction, comply immediately.

To communicate back to the orchestrator, use:
  curl -s $CHANNEL_URL -H 'Content-Type: application/json' -d '{"type": "<type>", "agent": "${AGENT_ID}", "content": "<message>"}'

Types: result, status, error, prompt, request`,
    }
  );

  await agentMcp.connect(new StdioServerTransport());
}

// --- Startup ---

console.log(`Agent ${AGENT_ID} ready`);
console.log(`  Command server: :${CMD_PORT}`);
console.log(`  Channel server: :${CHANNEL_PORT}`);
console.log(`  Workspace: ${WORKSPACE}`);
console.log(`  Orchestrator: ${CHANNEL_URL || "(none)"}`);

// Announce to orchestrator
pushToOrchestrator("status", `Agent ${AGENT_ID} ready`);
