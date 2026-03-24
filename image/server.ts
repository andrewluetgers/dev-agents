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

const CMD_PORT = parseInt(Bun.env.AGENT_PORT || "9111", 10);
const CHANNEL_PORT = parseInt(Bun.env.AGENT_CHANNEL_PORT || "9222", 10);
const WORKSPACE = Bun.env.WORKSPACE || "/home/agent/workspace";
const AGENT_ID = Bun.env.AGENT_ID || "agent-1";
const CHANNEL_URL = Bun.env.CHANNEL_URL || "";
const LOG_FILE = "/home/agent/claude-session.log";
const STATUS_FILE = "/home/agent/STATUS.md";

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
let claudeStdin: WritableStream | null = null;
let claudeWriter: WritableStreamDefaultWriter | null = null;
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

  // Add MCP config for Playwright if available
  const mcpConfig = {
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest", "--headless", "--browser", "chromium"],
      },
    },
  };
  args.push("--mcp-config", JSON.stringify(mcpConfig));

  logLine(JSON.stringify({ type: "server", event: "starting_claude", args, timestamp: new Date().toISOString() }));

  claudeProc = Bun.spawn(args, {
    cwd: WORKSPACE,
    env: { ...Bun.env, TERM: "dumb" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  claudeStdin = claudeProc.stdin as WritableStream;
  claudeWriter = claudeStdin.getWriter();

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
  if (!claudeWriter || !sessionActive) return false;
  const msg = JSON.stringify({
    type: "user",
    message: { role: "user", content },
  }) + "\n";

  try {
    await claudeWriter.write(new TextEncoder().encode(msg));
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

// --- Channel server (:9222) — message injection ---

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
      });
    }

    // Inject a message into Claude's session (like /btw)
    if (req.method === "POST" && url.pathname === "/message") {
      const body = (await req.json()) as {
        content?: string;
        from?: string;
      };
      const content = body.content || "";
      const from = body.from || "orchestrator";

      if (!sessionActive) {
        return Response.json({ status: "no_claude_session", content });
      }

      const sent = await sendMessage(`[From ${from}]: ${content}`);
      return Response.json({
        status: sent ? "injected" : "send_failed",
      });
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
