#!/usr/bin/env bun
//
// Agent orchestration channel
//
// MCP channel server that manages a pool of agent containers.
// Each agent gets a persistent home directory on the host filesystem.
//
// Host layout:
//   ~/dev-agents/
//     ├── orchestrator/          ← this process's config + state
//     │   └── config.json        ← project registry, image name, defaults
//     ├── agent-1/               ← agent-1's home (mounted as /home/agent)
//     ├── agent-2/               ← agent-2's home
//     └── shared/                ← read-only data for all agents
//
// Container layout:
//   /home/agent/                 ← mounted from ~/dev-agents/<agent-id>
//     ├── workspace/             ← repo clone (persists across restarts)
//     ├── shared/                ← read-only mount from ~/dev-agents/shared
//     ├── env/                   ← project .env files (read-only)
//     └── server/                ← command server (from image)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// --- Config ---

const ORCHESTRATOR_HOME =
  process.env.ORCHESTRATOR_HOME ||
  join(process.env.HOME || "/tmp", "dev-agents", "orchestrator");

interface ProjectConfig {
  repo: string;
  localPath?: string;
  env: string[];
  data: Record<string, string>;
}

interface Config {
  agentImage: string;
  homesDir: string;
  channelPort: number;
  defaults: { memory: string };
  projects: Record<string, ProjectConfig>;
}

function loadConfig(): Config {
  const configPath = join(ORCHESTRATOR_HOME, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

const config = loadConfig();
const CHANNEL_PORT = config.channelPort || 8788;

// --- Agent registry ---

interface AgentInfo {
  containerId: string;
  hostPort: number;       // command server port
  channelPort: number;    // agent channel port (for pushing messages into agent's Claude session)
  homeDir: string;
  project: string | null;
  lastSeen: string;
  status: string;
}

const agents = new Map<string, AgentInfo>();
let nextAgentNum = 1;

// --- Docker helpers ---

async function run(
  cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function spawnAgent(
  agentId: string,
  project?: string
): Promise<AgentInfo> {
  const homeDir = join(config.homesDir, agentId);
  const sharedDir = join(config.homesDir, "shared");

  // Create home directory if it doesn't exist
  mkdirSync(join(homeDir, "workspace"), { recursive: true });

  // Pre-seed onboarding skip for Claude Code
  const claudeJson = join(homeDir, ".claude.json");
  if (!existsSync(claudeJson)) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(claudeJson, JSON.stringify({ hasCompletedOnboarding: true }));
  }

  // Build docker run args
  const args = [
    "docker",
    "run",
    "-d",
    "--name",
    `dev-${agentId}`,
    // Auto-assign host ports for command server and channel
    "-p", "0:9111",
    "-p", "0:9222",
    "--add-host", "host.docker.internal:host-gateway",
    // Docker socket + group for orchestrator-capable agents
    "--group-add", "0",
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    // Agent's home directory
    "-v", `${homeDir}:/home/agent`,
    // Shared read-only data
    "-v", `${sharedDir}:/home/agent/shared:ro`,
    // Memory limit
    "--memory", config.defaults.memory || "8g",
    // Environment
    "-e", `AGENT_ID=${agentId}`,
    "-e", `CHANNEL_URL=http://host.docker.internal:${CHANNEL_PORT}`,
    "-e", "NODE_ENV=development",
    "-e", "CI=true",
  ];

  // Pass Claude Code auth from orchestrator environment
  if (process.env.ANTHROPIC_API_KEY) {
    args.push("-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
  }

  // Mount project repo and env if specified
  if (project && config.projects[project]) {
    const proj = config.projects[project];

    // Mount the project repo into the workspace
    if (proj.localPath && existsSync(proj.localPath)) {
      args.push("-v", `${proj.localPath}:/home/agent/workspace`);
    }

    // Pass database URLs etc from the env files
    const envPath = join(proj.localPath || "", ".env");
    if (existsSync(envPath)) {
      args.push("--env-file", envPath);
    }
  }

  args.push(config.agentImage);

  const result = await run(args);
  if (result.exitCode !== 0) {
    throw new Error(`docker run failed: ${result.stderr}`);
  }

  const containerId = result.stdout.slice(0, 12);

  // Query the assigned host port
  const portResult = await run([
    "docker",
    "port",
    `dev-${agentId}`,
    "9111",
  ]);
  const portMatch = portResult.stdout.match(/:(\d+)/);
  if (!portMatch) {
    throw new Error(`Could not determine host port for ${agentId}`);
  }
  const hostPort = parseInt(portMatch[1], 10);

  // Query the channel port too
  const chanResult = await run([
    "docker",
    "port",
    `dev-${agentId}`,
    "9222",
  ]);
  const chanMatch = chanResult.stdout.match(/:(\d+)/);
  const channelPort = chanMatch ? parseInt(chanMatch[1], 10) : 0;

  const info: AgentInfo = {
    containerId,
    hostPort,
    channelPort,
    homeDir,
    project: project || null,
    lastSeen: new Date().toISOString(),
    status: "starting",
  };
  agents.set(agentId, info);
  return info;
}

async function stopAgent(agentId: string): Promise<void> {
  // Stop but don't remove — home dir persists for warm restart
  await run(["docker", "rm", "-f", `dev-${agentId}`]);
  agents.delete(agentId);
}

// --- MCP Server ---

const mcp = new Server(
  { name: "agent", version: "0.3.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: `You are an orchestrator managing AI coding agents in isolated dev containers.
Your primary responsibility is keeping the project safe while enabling agents to be productive.

## Events

Events arrive as <channel source="agent" agent="<id>" type="<type>"> tags:
- type="result": agent finished a task
- type="status": agent status update
- type="error": agent hit a problem
- type="prompt": agent is asking you a question
- type="request": agent is requesting a shared resource (skill, template, or data)
- type="permission_request": agent needs approval to use a tool (URGENT — agent is blocked waiting)

## Tools

- spawn_agent: create a new agent container with its own persistent home directory
- stop_agent: stop an agent (home directory persists for warm restart)
- dispatch: run a command in an agent container
- message: push a message directly into an agent's Claude Code session (low latency, no polling)
- reply: respond to an agent's prompt (unblocks a pending /ask call)
- approve: approve a pending permission request from an agent
- deny: deny a pending permission request from an agent
- list_agents: show all agents

Use "message" to give agents new instructions, corrections, or context mid-task.
Use "dispatch" to run shell commands in the agent's container.
Use "reply" to answer a specific question an agent asked via /ask.

## Permission Policy

PERMISSION REQUESTS are time-sensitive. The agent is blocked and waiting. Review the
tool_name, description, and input_preview, then call approve or deny promptly.

### ALWAYS APPROVE (routine development work):
- Reading any file
- Writing/editing files within the agent's workspace
- Running builds: pnpm build, pnpm typecheck, npm run build, etc.
- Running tests: pnpm test, vitest, jest, etc.
- Running linters: pnpm lint, eslint, etc.
- Installing dependencies: pnpm install, npm install, bun install
- Git reads: git status, git log, git diff, git branch
- Git staging: git add <specific files>
- Git commits (without --amend on shared branches)
- Searching: grep, rg, find, ls, cat, head, tail
- Dev servers: pnpm dev, npm run dev
- curl/fetch for localhost or health checks

### APPROVE WITH CAUTION (review the details):
- Writing files outside the workspace (why?)
- Git checkout/switch branches (is there uncommitted work?)
- Git merge (are there conflicts?)
- Creating new branches
- Running unfamiliar scripts or binaries
- Network requests to external services (what and why?)
- Database operations (read-only OK, writes need scrutiny)
- Docker commands from within the agent

### ALWAYS DENY (destructive — escalate to the user):
- git push --force or git push --force-with-lease
- git reset --hard
- git clean -f or git checkout . (discards uncommitted work)
- git rebase on shared/published branches
- git branch -D (force delete)
- rm -rf on anything outside workspace or node_modules
- Deleting or overwriting .env files, credentials, or secrets
- Any command with sudo outside the container
- Modifying CI/CD pipelines or deployment configs without user approval
- Dropping database tables or destructive migrations
- Publishing packages (npm publish, etc.)
- Pushing to main/master branches
- Any command you don't understand — deny and ask the user

### AFTER EVERY DENIAL:
A bare denial is never enough. The agent is stuck and needs guidance. After calling deny, ALWAYS
follow up with a "message" to the agent that includes:

1. **Why** the request was denied (be specific)
2. **What to do instead** — suggest a safe alternative if one exists
3. **Whether to continue or stop** — if the denial changes the agent's approach fundamentally,
   say so. "Don't force push — create a new branch and push that instead" is actionable.
   "Stop — this approach won't work, let me rethink and get back to you" is also valid.

If an agent is repeatedly hitting denials or seems confused about its constraints, consider:
- Sending a message with clearer instructions about what IS allowed
- Stopping the agent and restarting with better initial context
- Escalating to the user: "Agent X seems stuck, here's what it's trying to do — how should I redirect it?"

The goal is to keep the agent productive within safe boundaries, not to just block it.

### BEFORE CLEARING OR RESTARTING AN AGENT:
Never stop, clear, or restart an agent session without first having it save its work:

1. Message the agent: "I'm going to restart your session. Before I do, please:
   - Commit or stash any uncommitted changes
   - Write a summary of what you've done, what's left, and any decisions you made
     to /home/agent/workspace/.dev-agents/memory.md (or append to it)
   - Note any issues, blockers, or things the next session should know"
2. Wait for the agent to confirm it's saved everything
3. Only then stop the container

This applies to ANY situation where the agent's Claude session context will be lost:
- Stopping the container
- Restarting with new instructions
- Clearing a stuck/looping agent
- Replacing an agent with a fresh one on the same task

The agent's home directory persists, so anything written to disk survives. But the
Claude session context (conversation history, reasoning state) does not. The memory
file is how continuity is maintained across sessions.

### WHEN IN DOUBT:
Deny the request and message the user explaining what the agent wants to do and why.
It's always better to pause and ask than to allow something destructive. The cost of
a brief delay is low; the cost of lost work or corrupted state is high.

### PATTERNS TO WATCH FOR:
- Agent retrying a denied request with slight variations — this is circumvention. Deny again
  AND message the agent: "I've denied this twice. The approach you're taking isn't going to
  work. Here's what I need you to do instead: ..."
- Agent trying to --no-verify or skip hooks — deny, hooks exist for a reason. Tell the agent
  to fix whatever the hook is catching instead of bypassing it.
- Commands that combine safe and unsafe operations (e.g. "git add . && git push --force") — deny
  the whole thing and tell the agent to split it into separate operations
- Agent writing to /home/agent/shared/ — this is read-only, deny and explain they should
  request the orchestrator add resources to shared via a "request" event
- Agent appears to be in a loop or thrashing — stop the agent, assess what went wrong, and
  either restart with better context or escalate to the user

## Environment

Each agent has its own home directory at ~/dev-agents/<agent-id>/ on the host.
This persists across container restarts. Agents are fully isolated from each other.
Project config and memory live in each repo at .dev-agents/.
Global config is in ~/dev-agents/orchestrator/config.json.
Global memory is in ~/dev-agents/orchestrator/memory.md.`,
  }
);

// --- Tools ---

const tools = [
  {
    name: "spawn_agent",
    description:
      "Create a new isolated agent container. Gets its own persistent home directory. Docker assigns a free port automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description:
            'Agent name, e.g. "auth-fixer". Auto-generated if omitted.',
        },
        project: {
          type: "string",
          description:
            "Project name from config.json. Mounts env files and data directories for that project.",
        },
      },
    },
  },
  {
    name: "stop_agent",
    description:
      "Stop and remove an agent container. Home directory persists on disk for warm restart.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID to stop" },
      },
      required: ["agent"],
    },
  },
  {
    name: "dispatch",
    description: "Run a shell command in an agent container and return the result.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID" },
        command: { type: "string", description: "Shell command to run" },
        timeout: {
          type: "number",
          description: "Timeout in ms (default 120000)",
        },
      },
      required: ["agent", "command"],
    },
  },
  {
    name: "message",
    description:
      "Push a message directly into an agent's Claude Code session. Use this to give new instructions, corrections, or context mid-task. Low latency — arrives immediately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID to message" },
        content: { type: "string", description: "The message to inject into the agent's Claude session" },
      },
      required: ["agent", "content"],
    },
  },
  {
    name: "reply",
    description: "Send a response back to an agent that asked a question via /ask. Unblocks the pending request.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID to reply to" },
        text: { type: "string", description: "The response text" },
      },
      required: ["agent", "text"],
    },
  },
  {
    name: "approve",
    description:
      "Approve a pending permission request from an agent. The agent is blocked waiting — respond promptly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID" },
        request_id: {
          type: "string",
          description: "The request_id from the permission_request event",
        },
      },
      required: ["agent", "request_id"],
    },
  },
  {
    name: "deny",
    description:
      "Deny a pending permission request from an agent. The agent is blocked waiting — respond promptly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent ID" },
        request_id: {
          type: "string",
          description: "The request_id from the permission_request event",
        },
        reason: {
          type: "string",
          description: "Why the request was denied (sent to the agent)",
        },
      },
      required: ["agent", "request_id"],
    },
  },
  {
    name: "list_agents",
    description: "List all agents with their IDs, ports, projects, and status.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args || {}) as Record<string, any>;

  try {
    switch (name) {
      case "spawn_agent": {
        const agentId = a.name || `agent-${nextAgentNum++}`;
        const info = await spawnAgent(agentId, a.project);
        return text(
          `Spawned ${agentId}\n` +
            `  Container: ${info.containerId}\n` +
            `  Port: ${info.hostPort}\n` +
            `  Home: ${info.homeDir}\n` +
            `  Project: ${info.project || "(none)"}`
        );
      }

      case "stop_agent": {
        const info = agents.get(a.agent);
        await stopAgent(a.agent);
        return text(
          `Stopped ${a.agent}. Home directory preserved at ${info?.homeDir || "~/dev-agents/" + a.agent}`
        );
      }

      case "message": {
        const info = agents.get(a.agent);
        if (!info)
          return text(`Agent "${a.agent}" not found.`);
        if (!info.channelPort)
          return text(`Agent "${a.agent}" has no channel port — it may not be running Claude Code with --channels.`);
        try {
          const resp = await fetch(`http://localhost:${info.channelPort}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: a.content, from: "orchestrator" }),
          });
          const result = await resp.json();
          return text(`Message delivered to ${a.agent}: ${JSON.stringify(result)}`);
        } catch (err: any) {
          return text(`Failed to message ${a.agent}: ${err.message}`);
        }
      }

      case "dispatch": {
        const info = agents.get(a.agent);
        if (!info)
          return text(
            `Agent "${a.agent}" not found. Known: ${[...agents.keys()].join(", ") || "none"}`
          );
        const resp = await fetch(`http://localhost:${info.hostPort}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: a.command,
            timeout: a.timeout || 120000,
          }),
        });
        return text(JSON.stringify(await resp.json(), null, 2));
      }

      case "reply": {
        const info = agents.get(a.agent);
        if (!info) return text(`Agent "${a.agent}" not found.`);
        const resp = await fetch(`http://localhost:${info.hostPort}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: a.text }),
        });
        return text(`Reply delivered: ${JSON.stringify(await resp.json())}`);
      }

      case "approve": {
        const info = agents.get(a.agent);
        if (!info) return text(`Agent "${a.agent}" not found.`);
        try {
          const resp = await fetch(`http://localhost:${info.hostPort}/permission`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: a.request_id, verdict: "allow" }),
          });
          const result = await resp.json();
          return text(`Approved ${a.request_id} for ${a.agent}: ${JSON.stringify(result)}`);
        } catch (err: any) {
          return text(`Failed to deliver approval to ${a.agent}: ${err.message}`);
        }
      }

      case "deny": {
        const info = agents.get(a.agent);
        if (!info) return text(`Agent "${a.agent}" not found.`);
        try {
          const resp = await fetch(`http://localhost:${info.hostPort}/permission`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: a.request_id, verdict: "deny" }),
          });
          const result = await resp.json();
          // Also message the agent with the reason
          if (a.reason && info.channelPort) {
            await fetch(`http://localhost:${info.channelPort}/message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: `Permission denied: ${a.reason}`, from: "orchestrator" }),
            }).catch(() => {});
          }
          return text(`Denied ${a.request_id} for ${a.agent}: ${JSON.stringify(result)}`);
        } catch (err: any) {
          return text(`Failed to deliver denial to ${a.agent}: ${err.message}`);
        }
      }

      case "list_agents": {
        if (agents.size === 0) return text("No agents running.");
        const list = [...agents.entries()].map(([id, info]) => ({
          id,
          port: info.hostPort,
          channelPort: info.channelPort,
          home: info.homeDir,
          project: info.project,
          status: info.status,
          lastSeen: info.lastSeen,
        }));
        return text(JSON.stringify(list, null, 2));
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return text(`Error: ${err.message}`);
  }
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// --- Connect to Claude Code ---

await mcp.connect(new StdioServerTransport());

// --- HTTP listener: receives push events from agent containers ---

Bun.serve({
  port: CHANNEL_PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      const list = [...agents.entries()].map(([id, info]) => ({
        id,
        port: info.hostPort,
        project: info.project,
        status: info.status,
      }));
      return Response.json({ status: "ok", agents: list, port: CHANNEL_PORT });
    }

    if (req.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }

    try {
      const body = await req.json();
      const {
        type = "message",
        agent = "unknown",
        content = "",
        port,
        channelPort: incomingChannelPort,
      } = body as {
        type?: string;
        agent?: string;
        content?: string;
        port?: number;
        channelPort?: number;
      };

      // Update or register agent from self-announcement
      if (agent !== "unknown") {
        const existing = agents.get(agent);
        if (existing) {
          existing.lastSeen = new Date().toISOString();
          if (type === "status") existing.status = content;
        } else {
          // Agent started outside spawn (e.g. compose) — discover host port
          let hostPort = port || 9111;
          try {
            const result = await run([
              "docker",
              "port",
              `dev-${agent}`,
              "9111",
            ]);
            const match = result.stdout.match(/:(\d+)/);
            if (match) hostPort = parseInt(match[1], 10);
          } catch {}
          // Discover channel port too
          let chanPort = incomingChannelPort || 0;
          if (!chanPort) {
            try {
              const chanResult = await run([
                "docker", "port", `dev-${agent}`, "9222",
              ]);
              const chanMatch = chanResult.stdout.match(/:(\d+)/);
              if (chanMatch) chanPort = parseInt(chanMatch[1], 10);
            } catch {}
          }
          agents.set(agent, {
            containerId: "external",
            hostPort,
            channelPort: chanPort,
            homeDir: join(config.homesDir, agent),
            project: null,
            lastSeen: new Date().toISOString(),
            status: content || "registered",
          });
        }
      }

      // Push event into Claude Code session
      await mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content,
          meta: { agent, type },
        },
      });

      return Response.json({ status: "delivered" });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  },
});
