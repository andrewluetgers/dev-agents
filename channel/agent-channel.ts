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
  hostPort: number;
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

  // Build docker run args
  const args = [
    "docker",
    "run",
    "-d",
    "--name",
    `dev-${agentId}`,
    // Auto-assign host port
    "-p",
    "0:9111",
    "--add-host",
    "host.docker.internal:host-gateway",
    // Agent's home directory
    "-v",
    `${homeDir}:/home/agent`,
    // Shared read-only data
    "-v",
    `${sharedDir}:/home/agent/shared:ro`,
    // Memory limit
    "--memory",
    config.defaults.memory || "4g",
    // Environment
    "-e",
    `AGENT_ID=${agentId}`,
    "-e",
    `CHANNEL_URL=http://host.docker.internal:${CHANNEL_PORT}`,
    "-e",
    "NODE_ENV=development",
    "-e",
    "CI=true",
  ];

  // Mount project env files if specified
  if (project && config.projects[project]) {
    const proj = config.projects[project];

    // Database/service env vars from .env files
    for (const envFile of proj.env) {
      const envPath = join(proj.localPath || "", envFile);
      if (existsSync(envPath)) {
        mkdirSync(join(homeDir, "env"), { recursive: true });
        args.push("-v", `${envPath}:/home/agent/env/${envFile}:ro`);
      }
    }

    // Data directories
    for (const [name, hostPath] of Object.entries(proj.data)) {
      if (existsSync(hostPath)) {
        args.push("-v", `${hostPath}:/home/agent/data/${name}:ro`);
      }
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

  const info: AgentInfo = {
    containerId,
    hostPort,
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

Events arrive as <channel source="agent" agent="<id>" type="<type>"> tags:
- type="result": agent finished a task
- type="status": agent status update
- type="error": agent hit a problem
- type="prompt": agent is asking you a question

Tools:
- spawn_agent: create a new agent container with its own persistent home directory
- stop_agent: stop an agent (home directory persists for warm restart)
- dispatch: run a command in an agent container
- reply: respond to an agent's prompt
- list_agents: show all agents

Each agent has its own home directory at ~/dev-agents/<agent-id>/ on the host.
This persists across container restarts. Agents are fully isolated from each other.
Project config (env files, data paths) is in ~/dev-agents/orchestrator/config.json.`,
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
    name: "reply",
    description: "Send a response back to an agent that asked a question.",
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

      case "list_agents": {
        if (agents.size === 0) return text("No agents running.");
        const list = [...agents.entries()].map(([id, info]) => ({
          id,
          port: info.hostPort,
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
      } = body as {
        type?: string;
        agent?: string;
        content?: string;
        port?: number;
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
          agents.set(agent, {
            containerId: "external",
            hostPort,
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
