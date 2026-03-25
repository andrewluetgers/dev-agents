#!/usr/bin/env bun
//
// Agent server — runs inside every container
//
// Manages the agent's Claude Code session via stream-json protocol.
// Three responsibilities:
//   1. HTTP servers (:9111 command, :9222 channel)
//   2. Claude Code child process (stream-json stdin/stdout)
//   3. Dispatcher: logs to file, feeds SSE, pushes key events to orchestrator
//

import { appendFileSync, writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CMD_PORT = parseInt(Bun.env.AGENT_PORT || "9111", 10);
const CHANNEL_PORT = parseInt(Bun.env.AGENT_CHANNEL_PORT || "9222", 10);
const WORKSPACE = Bun.env.WORKSPACE || "/home/agent/workspace";
const AGENT_ID = Bun.env.AGENT_ID || "agent-1";
const CHANNEL_URL = Bun.env.CHANNEL_URL || "";
const LOG_FILE = "/home/agent/claude-session.log";
const STATUS_FILE = "/home/agent/STATUS.md";

// --- MCP server over HTTP (channel + permission relay) ---

const mcpServer = new Server(
  { name: `agent-${AGENT_ID}`, version: "0.3.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions: `You are agent "${AGENT_ID}" working under an orchestrator.

Messages from the orchestrator arrive as <channel> events. Read them and act accordingly.
If the orchestrator tells you to stop or change direction, comply immediately.

## Status File

Maintain /home/agent/STATUS.md throughout your work. The orchestrator reads this to track your progress.

Update it at these points:
- When you receive a task: write the Task and Plan sections
- When you start a new step: update the Current section
- When you complete a step: check it off in Plan, add to Progress
- When you hit a blocker: write the Blockers section

## Browser Testing

When working with the browser (Playwright MCP), save screenshots to /home/agent/screenshots/.
For complex UI verification, use a sub-agent to analyze screenshots.`,
  }
);

// MCP tools the agent's Claude can call
const mcpTools = [
  {
    name: "ask_orchestrator",
    description: "Ask the orchestrator a question. Blocks until the orchestrator responds.",
    inputSchema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "Your question for the orchestrator" },
      },
      required: ["question"],
    },
  },
  {
    name: "report_status",
    description: "Push a structured status update to the orchestrator.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Current status: working, blocked, done, error" },
        message: { type: "string", description: "Brief description of what you're doing" },
      },
      required: ["status", "message"],
    },
  },
];

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools }));

mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args || {}) as Record<string, any>;

  if (name === "ask_orchestrator") {
    await pushToOrchestrator("prompt", a.question);
    const response = await new Promise<string>((resolve) => {
      pendingReply = resolve;
      setTimeout(() => {
        if (pendingReply === resolve) {
          pendingReply = null;
          resolve("(timeout: no response from orchestrator)");
        }
      }, 300_000);
    });
    return { content: [{ type: "text" as const, text: response }] };
  }

  if (name === "report_status") {
    await pushToOrchestrator("status", `[${a.status}] ${a.message}`);
    return { content: [{ type: "text" as const, text: "Status reported." }] };
  }

  return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }] };
});

// Permission relay state
const pendingPermissions = new Map<string, (verdict: "allow" | "deny") => void>();

// MCP transport — one per session (stateful)
let mcpTransport: WebStandardStreamableHTTPServerTransport | null = null;

// Permission request notification handler — register on raw message level
// because the SDK may not have typed schemas for claude/channel notifications
function setupPermissionRelay(transport: WebStandardStreamableHTTPServerTransport) {
  const originalOnMessage = transport.onmessage;
  transport.onmessage = async (message, extra) => {
    // Check for permission_request notifications
    if (
      "method" in message &&
      message.method === "notifications/claude/channel/permission_request" &&
      "params" in message
    ) {
      const params = message.params as {
        request_id: string;
        tool_name: string;
        description: string;
        input_preview: string;
      };

      // Push to orchestrator
      await pushToOrchestrator("permission_request", params.description, {
        permission: {
          request_id: params.request_id,
          tool_name: params.tool_name,
          description: params.description,
          input_preview: params.input_preview,
        },
      });

      // Wait for verdict
      const verdict = await new Promise<"allow" | "deny">((resolve) => {
        pendingPermissions.set(params.request_id, resolve);
        setTimeout(() => {
          if (pendingPermissions.has(params.request_id)) {
            pendingPermissions.delete(params.request_id);
            resolve("deny");
          }
        }, 300_000);
      });

      // Send verdict back via MCP notification
      try {
        await mcpServer.notification({
          method: "notifications/claude/channel/permission" as any,
          params: {
            request_id: params.request_id,
            behavior: verdict,
          },
        });
      } catch (err: any) {
        console.error(`Permission verdict delivery failed: ${err.message}`);
      }

      return; // Don't pass to default handler
    }

    // Pass through to default handler
    if (originalOnMessage) {
      originalOnMessage(message, extra);
    }
  };
}

// --- Push to orchestrator (only for important events) ---

async function pushToOrchestrator(
  type: string,
  content: string,
  extra?: Record<string, any>
) {
  if (!CHANNEL_URL) return;
  try {
    await fetch(CHANNEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        agent: AGENT_ID,
        content,
        port: CMD_PORT,
        channelPort: CHANNEL_PORT,
        ...extra,
      }),
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

    const timer = timeout ? setTimeout(() => proc.kill(), timeout) : null;

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

// --- Claude Code session (stream-json) ---

let claudeProc: ReturnType<typeof Bun.spawn> | null = null;
let claudeStdinSink: { write(data: Uint8Array): number; flush(): void } | null = null;
let sessionActive = false;

// SSE clients watching the live stream
const sseClients = new Set<ReadableStreamDefaultController>();

// Current session state (derived from stream, cheap to read)
let sessionState = {
  status: "idle" as "idle" | "starting" | "running" | "thinking" | "tool_use" | "done" | "error",
  currentTool: null as string | null,
  lastActivity: new Date().toISOString(),
  turns: 0,
};

function logLine(line: string) {
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function broadcastSSE(data: string) {
  const msg = `data: ${data}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(msg));
    } catch {
      sseClients.delete(controller);
    }
  }
}

function processOutputLine(line: string) {
  // Log everything to file
  logLine(line);

  // Broadcast to SSE clients
  broadcastSSE(line);

  // Parse and update state / push important events
  try {
    const event = JSON.parse(line);
    sessionState.lastActivity = new Date().toISOString();

    if (event.type === "system" && event.subtype === "init") {
      sessionState.status = "running";
      sessionState.turns = 0;
      pushToOrchestrator("status", "Claude session started");
    } else if (event.type === "assistant") {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === "tool_use") {
          sessionState.status = "tool_use";
          sessionState.currentTool = block.name;
        } else if (block.type === "text") {
          sessionState.status = "thinking";
          sessionState.currentTool = null;
        }
      }
    } else if (event.type === "result") {
      sessionState.turns++;
      if (event.subtype === "success") {
        sessionState.status = "done";
        sessionState.currentTool = null;
        pushToOrchestrator("result", event.result?.slice(0, 500) || "Task complete");
      } else {
        sessionState.status = "error";
        pushToOrchestrator("error", event.result?.slice(0, 500) || "Session error");
      }
    }
  } catch {
    // Not JSON, just log it
  }
}

async function startClaude(initialPrompt?: string) {
  if (claudeProc) return;

  sessionState.status = "starting";

  // Build claude command
  const args = [
    "claude",
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model", Bun.env.CLAUDE_MODEL || "sonnet",
  ];

  // Write MCP config to file — Claude Code expects a file path, not inline JSON
  const mcpConfig = {
    mcpServers: {
      channel: {
        type: "http",
        url: `http://localhost:${CHANNEL_PORT}/mcp`,
      },
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest", "--headless", "--browser", "chromium"],
      },
    },
  };
  const mcpConfigPath = "/tmp/agent-mcp.json";
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
  args.push("--mcp-config", mcpConfigPath);

  logLine(JSON.stringify({ type: "server", event: "starting_claude", args, timestamp: new Date().toISOString() }));

  claudeProc = Bun.spawn(args, {
    cwd: WORKSPACE,
    env: { ...Bun.env, TERM: "dumb" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Bun.spawn stdin is a FileSink, not a WritableStream
  claudeStdinSink = claudeProc.stdin as any;

  // Read stdout line by line
  const reader = claudeProc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) processOutputLine(line.trim());
        }
      }
      if (buffer.trim()) processOutputLine(buffer.trim());
    } catch (err: any) {
      logLine(JSON.stringify({ type: "server", event: "stdout_error", error: err.message }));
    }
    sessionActive = false;
    sessionState.status = "done";
    pushToOrchestrator("status", "Claude session ended");
  })();

  // Read stderr
  const stderrReader = claudeProc.stderr.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.trim()) logLine(JSON.stringify({ type: "server", event: "stderr", text: text.trim() }));
      }
    } catch {}
  })();

  // Wait for process to be ready, then send initial prompt
  sessionActive = true;

  if (initialPrompt) {
    // Small delay to let claude initialize
    await new Promise(r => setTimeout(r, 1000));
    await sendMessage(initialPrompt);
  }
}

async function sendMessage(content: string): Promise<boolean> {
  if (!claudeStdinSink || !sessionActive) return false;
  const msg = JSON.stringify({
    type: "user",
    message: { role: "user", content },
  }) + "\n";

  try {
    claudeStdinSink.write(new TextEncoder().encode(msg));
    claudeStdinSink.flush();
    logLine(JSON.stringify({ type: "server", event: "message_sent", content: content.slice(0, 200) }));
    return true;
  } catch (err: any) {
    logLine(JSON.stringify({ type: "server", event: "send_error", error: err.message }));
    return false;
  }
}

// --- Pending callbacks ---

let pendingReply: ((response: string) => void) | null = null;

// --- Command server (:9111) ---

Bun.serve({
  port: CMD_PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

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

    // Health + session state
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: AGENT_ID,
        workspace: WORKSPACE,
        channel: CHANNEL_URL || null,
        ports: { command: CMD_PORT, channel: CHANNEL_PORT },
        session: sessionState,
      });
    }

    // Live activity stream (SSE)
    if (req.method === "GET" && url.pathname === "/stream") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          // Send current state as first event
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "server", event: "connected", session: sessionState })}\n\n`
            )
          );
        },
        cancel(controller) {
          sseClients.delete(controller);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Execute a command
    if (req.method === "POST" && url.pathname === "/exec") {
      const body = (await req.json()) as {
        command?: string;
        cwd?: string;
        timeout?: number;
      };
      if (!body.command) {
        return Response.json({ error: "command is required" }, { status: 400 });
      }
      const result = await execCommand(
        body.command,
        body.cwd,
        body.timeout || 120_000
      );
      return Response.json(result);
    }

    // Start Claude session
    if (req.method === "POST" && url.pathname === "/start") {
      const body = (await req.json()) as { prompt?: string };
      if (sessionActive) {
        return Response.json({ status: "already_running", session: sessionState });
      }
      await startClaude(body.prompt);
      return Response.json({ status: "started", session: sessionState });
    }

    // Push a notification to the orchestrator
    if (req.method === "POST" && url.pathname === "/notify") {
      const body = (await req.json()) as {
        type?: string;
        content?: string;
      };
      await pushToOrchestrator(body.type || "message", body.content || "");
      return Response.json({ status: "pushed" });
    }

    // Ask the orchestrator a question (blocks until /respond)
    if (req.method === "POST" && url.pathname === "/ask") {
      const body = (await req.json()) as { prompt?: string };
      if (!body.prompt) {
        return Response.json(
          { error: "prompt is required" },
          { status: 400 }
        );
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
      const body = (await req.json()) as { response?: string };
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

// --- Channel server (:9222) — message injection + MCP over HTTP ---

Bun.serve({
  port: CHANNEL_PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: AGENT_ID,
        sessionActive,
        session: sessionState,
        mcpConnected: mcpTransport !== null,
        pendingPermissions: pendingPermissions.size,
      });
    }

    // Inject a message into Claude's session via stream-json stdin (like /btw)
    if (req.method === "POST" && url.pathname === "/message") {
      const body = (await req.json()) as {
        content?: string;
        from?: string;
      };
      const content = body.content || "";
      const from = body.from || "orchestrator";

      if (!sessionActive) {
        // Auto-start Claude with the message as the initial prompt
        await startClaude(`[From ${from}]: ${content}`);
        return Response.json({ status: "started_with_message" });
      }

      const sent = await sendMessage(`[From ${from}]: ${content}`);
      return Response.json({
        status: sent ? "injected" : "send_failed",
      });
    }

    // Permission verdict from orchestrator
    if (req.method === "POST" && url.pathname === "/permission") {
      const body = (await req.json()) as {
        request_id?: string;
        verdict?: "allow" | "deny";
      };
      if (!body.request_id || !body.verdict) {
        return Response.json(
          { error: "request_id and verdict are required" },
          { status: 400 }
        );
      }

      const resolve = pendingPermissions.get(body.request_id);
      if (resolve) {
        resolve(body.verdict);
        pendingPermissions.delete(body.request_id);
        return Response.json({ status: "verdict_delivered", request_id: body.request_id });
      }
      return Response.json({ status: "no_pending_request", request_id: body.request_id });
    }

    // MCP over HTTP — channel + permission relay + tools
    if (url.pathname === "/mcp") {
      if (!mcpTransport) {
        mcpTransport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        setupPermissionRelay(mcpTransport);
        await mcpServer.connect(mcpTransport);
        logLine(JSON.stringify({ type: "server", event: "mcp_connected", timestamp: new Date().toISOString() }));
      }
      return mcpTransport.handleRequest(req);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

// --- Startup ---

console.log(`Agent ${AGENT_ID} ready`);
console.log(`  Command server: :${CMD_PORT}`);
console.log(`  Channel server: :${CHANNEL_PORT}`);
console.log(`  Workspace: ${WORKSPACE}`);
console.log(`  Orchestrator: ${CHANNEL_URL || "(none)"}`);

// Announce to orchestrator
pushToOrchestrator("status", `Agent ${AGENT_ID} ready`);

// Auto-start Claude if an initial prompt is provided via env
if (Bun.env.AGENT_TASK) {
  console.log(`  Auto-starting Claude with task: ${Bun.env.AGENT_TASK.slice(0, 80)}...`);
  startClaude(Bun.env.AGENT_TASK);
}
