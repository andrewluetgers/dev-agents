# Architecture

Detailed technical architecture of the dev-agents orchestration system.

## System Overview

The system has four main components:

1. **Orchestrator** — a Claude Code CLI session with an MCP channel that provides agent management tools
2. **Host server** — Bun + Hono HTTP server that bridges the dashboard, agents, and orchestrator
3. **Agent containers** — Docker containers each running a Claude Code session via stream-json
4. **Dashboard** — React SPA for real-time monitoring and interaction

```
┌─────────────────┐          ┌────────────────────┐
│  Orchestrator    │  stdio   │  agent-channel.ts  │
│  (Claude Code)   ├──────────┤  MCP Server        │
│                  │          │                    │
│  Tools:          │          │  HTTP :8788        │◄── push events from agents
│  spawn_agent     │          │  (push receiver)   │
│  stop_agent      │          └────────────────────┘
│  dispatch        │
│  message         │          ┌────────────────────┐
│  reply           │          │  Host Server       │
│  approve/deny    │          │  apps/server       │
│  list_agents     │          │                    │
└──────────────────┘          │  :8788             │
                              │  oRPC + WS + SSE   │
                              │  Dashboard SPA     │
                              └────────┬───────────┘
                                       │
                    ┌──────────────────┬┴───────────────────┐
                    │                  │                    │
             ┌──────▼──────┐   ┌──────▼──────┐   ┌────────▼────┐
             │  Container   │   │  Container   │   │  Container  │
             │  dev-agent-1 │   │  dev-agent-2 │   │  dev-agent-N│
             │              │   │              │   │             │
             │  server.ts   │   │  server.ts   │   │  server.ts  │
             │  :9111 cmd   │   │  :9111 cmd   │   │  :9111 cmd  │
             │  :9222 chan  │   │  :9222 chan  │   │  :9222 chan │
             │              │   │              │   │             │
             │  Claude Code │   │  Claude Code │   │ Claude Code │
             │ (stream-json)│   │ (stream-json)│   │(stream-json)│
             └──────────────┘   └──────────────┘   └─────────────┘
```

## Component Details

### Orchestrator (`image/channel/agent-channel.ts`)

The orchestrator is an MCP server that connects to Claude Code via stdio transport. It provides tools for managing agent containers and relays events between agents and the orchestrator's Claude session.

**Transport**: MCP over stdio (registered via `.mcp.json` or `--dangerously-load-development-channels`)

**Startup sequence**:
1. `scripts/start-channel.sh` fetches `ANTHROPIC_API_KEY` from macOS Keychain
2. Launches `agent-channel.ts` with Bun
3. The MCP server connects to Claude Code via `StdioServerTransport`
4. An HTTP server starts on `:8788` to receive push events from agents
5. Auto-discovers any already-running `dev-*` containers

**Tools provided**:

| Tool | Description |
|------|-------------|
| `spawn_agent` | Create Docker container, assign ports, clone repo, optionally start Claude |
| `stop_agent` | `docker rm -f`, remove from registry (home dir preserved) |
| `dispatch` | POST command to agent's `:9111/exec` |
| `message` | POST to agent's `:9222/message` (injects into Claude session) |
| `reply` | POST to agent's `:9111/respond` (unblocks pending `/ask`) |
| `approve` | POST `{verdict: "allow"}` to agent's `:9222/permission` |
| `deny` | POST `{verdict: "deny"}` to agent's `:9222/permission`, then message with reason |
| `list_agents` | Return all agents from in-memory registry |

**Push event receiver**: Agents POST events to `http://host.docker.internal:8788`. The orchestrator forwards these as MCP channel notifications (`notifications/claude/channel`) into the Claude Code session. Events appear as `<channel>` tags in Claude's conversation.

**Permission policy**: Defined in the MCP server's `instructions` field. Three tiers:
- Always approve: file reads/writes, builds, tests, lint, git add/commit, installs
- Approve with caution: writes outside workspace, branch switching, network requests
- Always deny: force push, `rm -rf`, CI/CD changes, publishing, pushing to main

### Host Server (`apps/server/src/index.ts`)

The host server is a Bun HTTP server using Hono for routing. It serves the dashboard, provides the oRPC API, receives push events from agents, and manages WebSocket connections.

**Port**: 8788 (configurable via `PORT` env var)

**Endpoints**:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rpc/*` | POST | oRPC procedure calls from the dashboard |
| `/api/events` | POST | Push event receiver (agents POST here) |
| `/api/agents/:id/stream` | GET | SSE proxy — forwards agent's `:9111/stream` |
| `/api/ws` | WS | Real-time event broadcast to dashboard |
| `/api/terminal` | WS | Orchestrator terminal PTY (bash shell) |
| `/*` | GET | Dashboard SPA (static files from `apps/web/dist`) |

**State**: In-memory `Map<string, AgentInfo>`. No database. State is reconstructed from running Docker containers on startup via `discoverAgents()`.

**Event flow**: When an agent POSTs to `/api/events`, the server:
1. Updates the agent registry (creates entry if new, updates `lastSeen`/`status`)
2. Broadcasts the event to all WebSocket clients (dashboard)

**Terminal**: The `/api/terminal` WebSocket spawns a `bash -l` shell process. User keystrokes are forwarded to stdin; stdout/stderr are sent back over the WebSocket. This is used by the orchestrator terminal view in the dashboard.

### Agent Container Server (`image/server.ts`)

Each agent container runs `server.ts`, which manages the Claude Code session and exposes two HTTP servers.

**Command server (`:9111`)**:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Agent info + session state |
| `/stream` | GET | SSE stream of Claude Code output (stream-json lines) |
| `/exec` | POST | Execute shell command in workspace |
| `/start` | POST | Start Claude Code session with optional prompt |
| `/notify` | POST | Push event to orchestrator |
| `/ask` | POST | Ask orchestrator a question (blocks until `/respond`) |
| `/respond` | POST | Deliver orchestrator's reply (unblocks `/ask`) |

**Channel server (`:9222`)**:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Channel status + pending permissions |
| `/message` | POST | Inject message into Claude's session via stream-json stdin |
| `/permission` | POST | Deliver permission verdict (allow/deny) |
| `/mcp` | POST | MCP over HTTP (channel + permission relay + tools) |

**Claude Code session management**:

The server spawns Claude Code as a child process with `--output-format stream-json --input-format stream-json`. It:
- Reads stdout line-by-line, parsing each as a JSON event
- Updates local session state (status, current tool, turn count)
- Broadcasts lines to SSE clients
- Logs everything to `/home/agent/claude-session.log`
- Pushes key events (init, result, error) to the orchestrator

**MCP server**: The channel server also runs an MCP server (HTTP transport) that Claude Code inside the container connects to. This provides:
- `ask_orchestrator` tool — agent asks a question, blocks until reply
- `report_status` tool — agent pushes structured status update
- Permission relay — intercepts `permission_request` notifications, forwards to orchestrator, waits for verdict

### Dashboard (`apps/web/`)

React SPA built with Vite and Tailwind CSS.

**Data fetching**:
- **oRPC** via `@tanstack/react-query` for all CRUD operations
- **WebSocket** (`/api/ws`) for live event push (drives unread badges)
- **SSE** (`/api/agents/:id/stream`) for real-time Claude Code log streaming

**Views**:
- **Sidebar** — agent list with status indicators and unread badges
- **Agent Detail** — tabbed view (Status, Log, Changes, Loops) with message input
- **Orchestrator View** — embedded terminal (Ghostty WASM) + event stream
- **Board View** — kanban board derived from agent states
- **Spawn Dialog** — form to create new agents

## Communication Protocols

### Stream-JSON (Claude Code ↔ Agent Server)

Claude Code runs with `--output-format stream-json --input-format stream-json`. Each line of stdout is a JSON object:

```json
{"type": "system", "subtype": "init", ...}
{"type": "assistant", "message": {"content": [{"type": "text", "text": "..."}]}}
{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", ...}]}}
{"type": "result", "subtype": "success", "result": "..."}
```

Input (stdin) accepts user messages:

```json
{"type": "user", "message": {"role": "user", "content": "..."}}
```

This is how the orchestrator injects messages into an agent's Claude session — the channel server writes to Claude's stdin pipe.

### MCP over stdio (Orchestrator ↔ Claude Code)

The orchestrator channel uses MCP's stdio transport. Claude Code connects to it as a configured MCP server. The channel provides tools and receives notifications.

Push events from agents arrive via HTTP and are forwarded as MCP channel notifications:

```json
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "Agent auth-fixer ready",
    "meta": { "agent": "auth-fixer", "type": "status" }
  }
}
```

### MCP over HTTP (Agent's Claude ↔ Agent Server)

Inside each container, Claude Code connects to the agent server's MCP endpoint at `http://localhost:9222/mcp`. This uses `WebStandardStreamableHTTPServerTransport`.

The MCP server provides tools (`ask_orchestrator`, `report_status`) and handles the permission relay via `claude/channel/permission` experimental capability.

### HTTP Push (Agent → Orchestrator)

Agents push events to the orchestrator (or host server) via HTTP POST:

```json
POST http://host.docker.internal:8788/api/events
{
  "type": "status",
  "agent": "auth-fixer",
  "content": "Running tests",
  "port": 9111,
  "channelPort": 9222
}
```

Event types: `status`, `result`, `error`, `prompt`, `request`, `permission_request`.

### WebSocket (Host Server → Dashboard)

The host server broadcasts all agent events to connected WebSocket clients at `/api/ws`. The dashboard uses this for:
- Unread badge counts per agent
- Real-time status updates in the sidebar
- Event stream view in the orchestrator panel

## Data Flow Diagrams

### Agent Spawn

```
User/Orchestrator                Host/Channel                    Docker
       │                              │                            │
       │  spawn_agent(name, project)  │                            │
       ├─────────────────────────────►│                            │
       │                              │  docker run -d ...         │
       │                              ├───────────────────────────►│
       │                              │                  container │
       │                              │◄───────────────────────────┤
       │                              │                            │
       │                              │  docker port dev-X 9111    │
       │                              ├───────────────────────────►│
       │                              │  0.0.0.0:54321             │
       │                              │◄───────────────────────────┤
       │                              │                            │
       │                              │  POST :hostPort/start      │
       │                              ├──────────────────────────► Container
       │                              │                            │  spawns
       │                              │                            │  claude
       │                              │  POST /api/events          │  process
       │                              │  {type: "status",          │
       │                              │   agent: "X", ...}         │
       │                              │◄───────────────────────────┤
       │  <channel> Agent X ready     │                            │
       │◄─────────────────────────────┤                            │
```

### Permission Relay

```
Agent's Claude     Agent Server      Orchestrator     Orchestrator's Claude
      │                 │                  │                    │
      │  tool_use       │                  │                    │
      │  (needs perm)   │                  │                    │
      ├────────────────►│                  │                    │
      │                 │  POST /api/events│                    │
      │                 │  permission_req  │                    │
      │                 ├─────────────────►│                    │
      │                 │                  │  channel notif     │
      │                 │                  ├───────────────────►│
      │                 │                  │                    │
      │                 │                  │  approve(req_id)   │
      │                 │                  │◄───────────────────┤
      │                 │  POST /permission│                    │
      │                 │  {verdict: allow}│                    │
      │                 │◄─────────────────┤                    │
      │  MCP notif      │                  │                    │
      │  permission     │                  │                    │
      │  allow          │                  │                    │
      │◄────────────────┤                  │                    │
      │                 │                  │                    │
      │  (continues)    │                  │                    │
```

### Message Injection

```
Orchestrator                    Agent Container
      │                              │
      │  message(agent, content)     │
      ├─────────────────────────────►│  POST :channelPort/message
      │                              │
      │                              │  Writes to Claude's stdin:
      │                              │  {"type":"user","message":
      │                              │   {"role":"user",
      │                              │    "content":"[From orchestrator]: ..."}}
      │                              │
      │                              │  Claude reads it as a new user turn
      │                              │  and responds accordingly
```

## Agent Lifecycle

```
    spawn_agent(name, project, task)
         │
         ▼
    ┌──────────┐
    │ STARTING │  Docker container created
    │          │  Ports assigned, repo cloned
    └────┬─────┘
         │  POST /start {prompt}
         ▼
    ┌──────────┐
    │ RUNNING  │  Claude Code session active
    │          │  Processing stream-json events
    │          │  Pushing status to orchestrator
    └────┬─────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
┌──────────┐              ┌──────────┐
│   DONE   │              │  ERROR   │
│          │              │          │
│  Result  │              │  Error   │
│  pushed  │              │  pushed  │
└──────────┘              └──────────┘
         │
         ▼
    stop_agent(name)
         │
         ▼
    Container removed
    Home dir preserved at ~/dev-agents/<name>/
    (warm restart possible)
```

During the RUNNING state, the agent may cycle through sub-states:
- `thinking` — Claude is generating text
- `tool_use` — Claude is calling a tool (Read, Edit, Bash, etc.)
- `running` — general active state

## Docker Container Design

**Base image**: `node:22-slim`

**Installed tools**:
- Git, curl, procps, sudo, ca-certificates
- Docker CLI (static binary) — for orchestrator-capable agents
- Bun — runtime for agent infrastructure
- pnpm — for project work
- Claude Code (`@anthropic-ai/claude-code`)
- Playwright + Chromium — browser automation

**User**: Non-root `agent` user. UID matches host user via `AGENT_UID` build arg (for bind mount permissions).

**Volumes**:
- `~/dev-agents/<agent-id>` → `/home/agent` (read-write, persistent)
- `~/dev-agents/shared` → `/home/agent/shared` (read-only)
- `/var/run/docker.sock` → `/var/run/docker.sock` (for Docker-in-Docker)
- Project local path → `/tmp/repo-source` (read-only, for initial clone)

**Ports**:
- `9111` — command server (mapped to random host port)
- `9222` — channel server (mapped to random host port)

**Environment variables**:
- `AGENT_ID` — unique agent identifier
- `CHANNEL_URL` — orchestrator's push event endpoint (`http://host.docker.internal:8788`)
- `ANTHROPIC_API_KEY` — fetched from macOS Keychain at spawn time
- `AGENT_TASK` — optional initial prompt (auto-starts Claude)
- `CLAUDE_MODEL` — model override (default: `sonnet`)

**ECI compatibility**: Designed for Docker Desktop Enhanced Container Isolation. No `--privileged`. Runs as non-root. sudo available but ECI-scoped.

## Auth Flow

```
macOS Keychain                 start-channel.sh              agent-channel.ts
      │                              │                            │
      │  security find-generic-      │                            │
      │  password -s "Claude Code"   │                            │
      │◄─────────────────────────────┤                            │
      │  <api-key>                   │                            │
      ├─────────────────────────────►│                            │
      │                              │  ANTHROPIC_API_KEY=<key>   │
      │                              │  exec bun agent-channel.ts │
      │                              ├───────────────────────────►│
      │                              │                            │
      │                              │                            │
      │                              │  spawn_agent(...)          │
      │                              │  docker run -e             │
      │                              │  ANTHROPIC_API_KEY=<key>   │
      │                              ├──────────────────────────► Container
```

The API key is the same one Claude Code CLI stores in the macOS Keychain. SSO keys rotate, so `start-channel.sh` fetches a fresh key each time the channel starts. When spawning agents, `agent-channel.ts` also fetches a fresh key from the keychain.

## Networking

All container-to-host communication uses `host.docker.internal` (Docker Desktop's host gateway). The `--add-host host.docker.internal:host-gateway` flag ensures this resolves correctly.

Container ports are dynamically assigned (`-p 0:9111`). The orchestrator discovers the assigned host port via `docker port dev-<agent-id> 9111`.

Dashboard ↔ host server is standard HTTP/WS on `:8788`. The host server proxies SSE streams from individual agents to the dashboard, so the browser only connects to one origin.
