# dev-agents

Orchestrate isolated AI coding agents in Docker containers. An orchestrator (Claude Code session) spawns, monitors, and manages agents that work autonomously in sandboxed environments. A web dashboard provides real-time observability into every agent's activity.

Built on Claude Code's stream-json and MCP channel protocols. Inspired by [OpenAI Symphony](https://github.com/openai/symphony) and [harness engineering](https://openai.com/index/harness-engineering/) methodology.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Host Machine                                                   │
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │  Claude Code CLI  │    │  Host Server (:8788)             │   │
│  │  (Orchestrator)   │    │  Hono + oRPC + WebSocket         │   │
│  │                   │    │                                  │   │
│  │  MCP Channel ─────┼────┤  /api/rpc/*    oRPC procedures  │   │
│  │  (stdio)          │    │  /api/events   push receiver     │   │
│  │                   │    │  /api/ws       live events (WS)  │   │
│  └────────┬──────────┘    │  /api/terminal orchestrator PTY  │   │
│           │               │  /*            dashboard SPA     │   │
│           │ HTTP          └──────────────┬───────────────────┘   │
│           │                              │                       │
│  ┌────────▼──────────────────────────────▼───────────────────┐  │
│  │  Docker Containers                                        │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                │  │
│  │  │  dev-agent-1     │  │  dev-agent-2     │  ...          │  │
│  │  │  :9111 cmd srv   │  │  :9111 cmd srv   │               │  │
│  │  │  :9222 channel   │  │  :9222 channel   │               │  │
│  │  │                  │  │                  │               │  │
│  │  │  Claude Code     │  │  Claude Code     │               │  │
│  │  │  (stream-json)   │  │  (stream-json)   │               │  │
│  │  └─────────────────┘  └─────────────────┘                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ~/dev-agents/                                           │   │
│  │  orchestrator/config.json    agent-1/    agent-2/        │   │
│  │  shared/                     (persisted home dirs)       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Browser — Dashboard (React + Tailwind)                  │
│  ┌──────────┬───────────────────────────────────────┐    │
│  │ Sidebar  │  Agent Detail / Orchestrator / Board  │    │
│  │          │                                       │    │
│  │ Orch     │  Tabs: Status | Log | Changes | Loops │    │
│  │ agent-1  │                                       │    │
│  │ agent-2  │  Message input bar                    │    │
│  └──────────┴───────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Features

- **Isolated agents** — each agent runs in its own Docker container with a persistent home directory
- **Bidirectional messaging** — orchestrator pushes messages into agent sessions; agents push events back
- **Permission relay** — agents request tool permissions; orchestrator approves/denies per policy
- **Live stream** — real-time SSE stream of each agent's Claude Code session (stream-json)
- **Web dashboard** — sidebar with agent list, status badges, log viewer, diff viewer, message injection
- **Orchestrator terminal** — embedded Ghostty WASM terminal running the orchestrator's Claude Code CLI
- **Kanban board** — task cards derived from agent status, mapped to lanes
- **Loops** — recurring commands (exec or message) on intervals per agent
- **CLI skill** — `/dev-agent` slash command for spawning, messaging, and managing agents from Claude Code
- **Auto-discovery** — host server finds running agent containers on startup
- **Warm restart** — stopping an agent preserves its home directory; restarting picks up where it left off

## Requirements

- **Docker Desktop** with Compose v2+ (Enhanced Container Isolation supported)
- **Claude Code** v2.1.80+ — authenticated via claude.ai (SSO works)
- **Node.js** 22+, **Bun**, **pnpm**
- **Git**

## Quick Start

```bash
# Clone and install
git clone https://github.com/andrewluetgers/dev-agents.git
cd dev-agents
pnpm install

# Build the agent Docker image
cd image && docker build -t dev-agent:latest . && cd ..

# Create orchestrator config
mkdir -p ~/dev-agents/orchestrator
cp config.example.json ~/dev-agents/orchestrator/config.json
# Edit config.json: set homesDir, register projects

# Start the dashboard + host server
pnpm dev

# In another terminal, start the orchestrator channel
claude --dangerously-load-development-channels server:agent
```

The dashboard is at `http://localhost:8788`. The orchestrator runs as a Claude Code MCP channel.

### Interactive setup (alternative)

```bash
claude
/dev-agents-init
```

The `/dev-agents-init` skill walks through prerequisites, image build, config creation, project registration, and auth setup.

## Monorepo Structure

```
dev-agents/
├── apps/
│   ├── server/                 # Host API server (Bun + Hono)
│   │   └── src/index.ts        # HTTP, WebSocket, oRPC, SSE proxy
│   └── web/                    # Dashboard SPA (React + Vite + Tailwind)
│       └── src/components/     # Layout, Sidebar, AgentDetail, BoardView, etc.
├── image/
│   ├── Dockerfile              # Agent container image (node:22-slim + Claude Code)
│   ├── server.ts               # In-container server: cmd (:9111) + channel (:9222)
│   └── channel/
│       └── agent-channel.ts    # Orchestrator MCP channel (stdio transport)
├── packages/
│   ├── rpc/                    # oRPC router and procedures
│   │   └── src/procedures/     # agents.ts, projects.ts, loops.ts
│   └── shared/                 # Shared types (AgentInfo, AgentEvent, etc.)
├── scripts/
│   └── start-channel.sh        # Launches orchestrator channel with keychain auth
├── .claude/skills/
│   ├── dev-agent/              # /dev-agent CLI skill
│   ├── dev-agents-init/        # /dev-agents-init setup skill
│   └── onboard-project/        # /onboard-project readiness assessment
├── docs/
│   ├── ARCHITECTURE.md         # Detailed architecture document
│   ├── INTERFACE-DESIGN.md     # Dashboard interface design document
│   └── SYMPHONY-PLAN.md        # Implementation plan (Symphony adaptation)
├── turbo.json                  # Turborepo task config
├── package.json                # Monorepo root (pnpm workspaces)
└── .mcp.json                   # Registers MCP channel with Claude Code
```

Managed with **Turborepo** and **pnpm workspaces**. Key commands:

```bash
pnpm dev          # Start all apps in dev mode (server + web)
pnpm build        # Build all packages and apps
pnpm typecheck    # Type-check everything
pnpm lint         # Lint everything
```

## How It Works

### Orchestrator → Agents → Containers

1. **Orchestrator** is a Claude Code session with the `agent-channel.ts` MCP channel loaded. It has tools to spawn, stop, message, and manage agents.

2. **Spawn** creates a Docker container from `dev-agent:latest`. The container runs `server.ts`, which exposes two HTTP servers:
   - **Command server** (`:9111`) — health, exec, session start, stream (SSE), ask/respond
   - **Channel server** (`:9222`) — message injection, permission verdicts, MCP over HTTP

3. **Agent's Claude Code session** runs inside the container via stream-json protocol. The agent server reads stdout line-by-line, parses events, broadcasts to SSE clients, and pushes key events to the orchestrator.

4. **Communication** is push-based in both directions:
   - Orchestrator → Agent: HTTP POST to `:9222/message` (injected into Claude's stdin as `[From orchestrator]: ...`)
   - Agent → Orchestrator: HTTP POST to the host's `/api/events` endpoint, which forwards as MCP channel notifications

5. **Permission relay**: When Claude Code inside the container needs tool approval, the MCP permission request flows from Claude → agent server → orchestrator → verdict → back to agent server → Claude.

### Host Server

The host server (`apps/server/src/index.ts`) runs on `:8788` and serves three roles:
- **API server** — oRPC procedures for the dashboard (list agents, get health, send messages, exec commands, spawn/stop)
- **Push receiver** — `/api/events` endpoint where agent containers POST events
- **Dashboard host** — serves the built React SPA and proxies SSE streams from agent containers

### Dashboard

The web dashboard connects via:
- **oRPC** for CRUD operations (list agents, spawn, stop, send messages)
- **WebSocket** (`/api/ws`) for real-time event push
- **SSE proxy** (`/api/agents/:id/stream`) for live Claude Code session streams
- **WebSocket** (`/api/terminal`) for the orchestrator's embedded terminal

## CLI Commands

The `/dev-agent` skill provides a unified interface from any Claude Code session:

```
/dev-agent                              # List agents or offer to spawn
/dev-agent new my-project               # Spawn agent for a project
/dev-agent new my-project fix auth bug  # Spawn with initial task
/dev-agent status                       # Status of all agents
/dev-agent status agent-1               # Detailed status (reads STATUS.md)
/dev-agent msg agent-1 try login flow   # Inject message into agent's session
/dev-agent run agent-1 pnpm test        # Run command in agent's container
/dev-agent stop agent-1                 # Stop agent (preserves home dir)
```

## Configuration

Orchestrator config lives at `~/dev-agents/orchestrator/config.json`:

```json
{
  "agentImage": "dev-agent:latest",
  "homesDir": "/Users/you/dev-agents",
  "channelPort": 8788,
  "defaults": {
    "memory": "8g",
    "agentUid": 501
  },
  "projects": {
    "my-project": {
      "localPath": "/Users/you/dev/my-project"
    }
  }
}
```

Key fields:
- `agentImage` — Docker image name for agent containers
- `homesDir` — where agent home directories are created (`~/dev-agents/`)
- `channelPort` — port the orchestrator channel listens on for push events
- `projects` — registered projects (name → local path mapping)

## Auth

Agent containers need an `ANTHROPIC_API_KEY` to run Claude Code. The orchestrator channel (`start-channel.sh`) fetches the key from the macOS Keychain:

```bash
security find-generic-password -s "Claude Code" -w
```

This key is passed as an environment variable when spawning containers. SSO keys rotate, so the key is fetched fresh at spawn time.

## Development

```bash
# Install dependencies
pnpm install

# Start dev servers (host server + web dashboard with HMR)
pnpm dev

# Build the Docker image (run from image/ directory)
cd image && docker build -t dev-agent:latest --build-arg AGENT_UID=$(id -u) .

# Start the orchestrator channel (separate terminal)
claude --dangerously-load-development-channels server:agent
```

The host server runs on `:8788` in dev mode. The web app uses Vite with HMR. Changes to `packages/` are picked up by Turborepo's dependency graph.

## Port Assignments

| Port | Service | Location |
|------|---------|----------|
| 8788 | Host server (API + dashboard + push receiver) | Host |
| 9111 | Agent command server (per container) | Container |
| 9222 | Agent channel server (per container) | Container |

Container ports are mapped to random host ports via `docker run -p 0:9111 -p 0:9222`.

## Further Reading

- [Architecture](docs/ARCHITECTURE.md) — detailed system design, data flows, protocols
- [Interface Design](docs/INTERFACE-DESIGN.md) — dashboard layout, inspirations, planned features
- [Symphony Plan](docs/SYMPHONY-PLAN.md) — implementation plan for automated task dispatch
