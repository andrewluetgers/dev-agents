#!/usr/bin/env bun
//
// Agent server — runs inside every container (worker + orchestrator)
//
// Single Bun process that handles:
//   - Command server (:9111) — exec, health, notify, ask, respond
//   - Agent channel (:9222) — receives messages from orchestrator,
//     pushes them into the local Claude Code session via MCP
//   - Permission relay — forwards Claude Code permission prompts to
//     the orchestrator for approval/denial
//
// The command server is always on. The agent channel starts when
// CHANNEL_URL is set (i.e. this is a worker, not the orchestrator).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CMD_PORT = parseInt(Bun.env.AGENT_PORT || "9111", 10);
const CHANNEL_PORT = parseInt(Bun.env.AGENT_CHANNEL_PORT || "9222", 10);
const WORKSPACE = Bun.env.WORKSPACE || "/home/agent/workspace";
const AGENT_ID = Bun.env.AGENT_ID || "agent-1";
const CHANNEL_URL = Bun.env.CHANNEL_URL || "";

// --- Push to orchestrator ---

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

// --- Pending callbacks ---

let pendingReply: ((response: string) => void) | null = null;

// Permission verdicts: request_id → resolve function
const pendingPermissions = new Map<string, (verdict: "allow" | "deny") => void>();

// --- Agent channel MCP server ---

let agentMcp: Server | null = null;

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

    // Health
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: AGENT_ID,
        workspace: WORKSPACE,
        channel: CHANNEL_URL || null,
        ports: { command: CMD_PORT, channel: CHANNEL_PORT },
        pendingPermissions: pendingPermissions.size,
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

    // Receive a permission verdict from the orchestrator
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

        // Also relay to Claude Code via MCP notification if connected
        if (agentMcp) {
          await agentMcp.notification({
            method: "notifications/claude/channel/permission" as any,
            params: {
              request_id: body.request_id,
              behavior: body.verdict,
            },
          });
        }

        return Response.json({ status: "verdict_delivered", request_id: body.request_id });
      }

      return Response.json({ status: "no_pending_request", request_id: body.request_id });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

// --- Agent channel server (:9222) ---

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
      const body = (await req.json()) as {
        content?: string;
        from?: string;
      };
      const content = body.content || "";
      const from = body.from || "orchestrator";

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
//
// When AGENT_CHANNEL_MODE=mcp, this process is spawned by Claude Code
// as a channel server over stdio. It:
//   1. Pushes orchestrator messages into the Claude session
//   2. Relays permission prompts to the orchestrator for approval
//   3. Receives verdicts back and forwards them to Claude Code

if (Bun.env.AGENT_CHANNEL_MODE === "mcp") {
  agentMcp = new Server(
    { name: `agent-${AGENT_ID}`, version: "0.2.0" },
    {
      capabilities: {
        experimental: {
          "claude/channel": {},
          "claude/channel/permission": {}, // opt in to permission relay
        },
        tools: {},
      },
      instructions: `You are agent "${AGENT_ID}" working under an orchestrator.

Messages from the orchestrator arrive as <channel> events. Read them and act accordingly.
If the orchestrator tells you to stop or change direction, comply immediately.

Your tool-use permissions are managed by the orchestrator. When you need to run a command
or write a file, the permission prompt is forwarded to the orchestrator for approval.
You don't need to do anything special — just work normally and the orchestrator will
approve or deny as appropriate.

## Status File

Maintain /home/agent/STATUS.md throughout your work. The orchestrator reads this to track your progress.

**Update it at these points:**
- When you receive a task: write the Task and Plan sections
- When you start a new step: update the Current section
- When you complete a step: check it off in Plan, add a line to Progress with timestamp
- When you hit a blocker: write the Blockers section
- When you take a screenshot: add it to Screenshots

**Format:**
\`\`\`markdown
# Agent Status

## Task
<what you were asked to do>

## Plan
- [x] Completed step
- [ ] Current step ← you are here
- [ ] Future step

## Current
**Action:** <what you're doing right now>
**Started:** <ISO timestamp>
**Detail:** <brief detail>

## Progress
- <timestamp> — <what you completed>
- <timestamp> — <what you completed>

## Blockers
<anything you're stuck on>

## Screenshots
- screenshots/<name>.png — <description>

## Notes
<decisions, discoveries, context>
\`\`\`

Keep it concise. Update Current frequently — the orchestrator checks this to know if you're making progress or stuck.

## Browser Testing

When working with the browser (Playwright MCP), save screenshots to /home/agent/screenshots/:
  mkdir -p /home/agent/screenshots

For complex UI verification, use a sub-agent to analyze screenshots instead of loading them
into your own context. This keeps your working context clean.

## Communication

To communicate back to the orchestrator:
  curl -s $CHANNEL_URL -H 'Content-Type: application/json' \\
    -d '{"type": "<type>", "agent": "${AGENT_ID}", "content": "<message>"}'

Types: result, status, error, prompt, request`,
    }
  );

  // --- Permission relay: Claude Code → orchestrator ---
  //
  // When Claude wants to use a tool that requires approval, Claude Code
  // sends a permission_request notification. We forward it to the orchestrator,
  // wait for the verdict, and relay it back.

  const PermissionRequestSchema = z.object({
    method: z.literal(
      "notifications/claude/channel/permission_request" as any
    ),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  });

  agentMcp.setNotificationHandler(
    PermissionRequestSchema,
    async ({ params }) => {
      // Push the permission request to the orchestrator
      await pushToOrchestrator("permission_request", params.description, {
        permission: {
          request_id: params.request_id,
          tool_name: params.tool_name,
          description: params.description,
          input_preview: params.input_preview,
        },
      });

      // Register a pending callback for the verdict
      // The orchestrator will POST to /permission with the verdict
      const verdict = await new Promise<"allow" | "deny">((resolve) => {
        pendingPermissions.set(params.request_id, resolve);

        // Timeout after 5 minutes — deny by default
        setTimeout(() => {
          if (pendingPermissions.has(params.request_id)) {
            pendingPermissions.delete(params.request_id);
            resolve("deny");
          }
        }, 300_000);
      });

      // Relay verdict back to Claude Code
      await agentMcp!.notification({
        method: "notifications/claude/channel/permission" as any,
        params: {
          request_id: params.request_id,
          behavior: verdict,
        },
      });
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
console.log(
  `  Permission relay: ${Bun.env.AGENT_CHANNEL_MODE === "mcp" ? "active" : "inactive"}`
);

// Announce to orchestrator
pushToOrchestrator("status", `Agent ${AGENT_ID} ready`);
