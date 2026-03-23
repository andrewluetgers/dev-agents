# dev-agents

Isolated AI coding agent orchestration via Docker and Claude Code Channels.

Spin up sandboxed workstations for AI coding agents, each with their own persistent home directory, repo clone, and environment. An MCP channel server pushes events directly into your Claude Code session — no polling.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Host                                                    │
│                                                          │
│  Claude Code (orchestrator)                              │
│    │  MCP tools: spawn_agent, dispatch, reply, ...       │
│    │  Channel events: ◄── push from agents               │
│    │                                                     │
│    └── agent-channel.ts (:8788)                          │
│          │                                               │
│  ┌───────┴──────────────────────────────────────┐        │
│  │ ~/dev-agents/                                │        │
│  │   ├── orchestrator/config.json               │        │
│  │   ├── shared/            (read-only to all)  │        │
│  │   ├── agent-1/           (agent-1's home)    │        │
│  │   ├── agent-2/           (agent-2's home)    │        │
│  │   └── ...                                    │        │
│  └──────────────────────────────────────────────┘        │
│          │              │              │                  │
│    ┌─────┴─────┐  ┌────┴─────┐  ┌────┴─────┐            │
│    │ Container  │  │ Container │  │ Container │           │
│    │ agent-1    │  │ agent-2   │  │ agent-N   │           │
│    │ :auto port │  │ :auto port│  │ :auto port│           │
│    └───────────┘  └──────────┘  └──────────┘            │
└──────────────────────────────────────────────────────────┘
```

### Key principles

- **One agent, one container.** Always isolated. No thinking about when to isolate — just do it.
- **Persistent home directories.** Each agent's home lives on the host at `~/dev-agents/<agent-id>/`. Survives container removal. New container + same mount = warm restart.
- **Push, not poll.** Agents push events to the orchestrator via HTTP webhook. The channel server delivers them into your Claude Code session as MCP notifications.
- **Auto-assigned ports.** Docker picks a free host port for each container. Zero conflicts, zero management.
- **Shared data is read-only.** Env files, datasets, and other shared resources mount read-only. Agents work in their own home directory.

## Directory layout

### Host (`~/dev-agents/`)

```
~/dev-agents/
  ├── orchestrator/
  │   └── config.json          ← project registry, image name, defaults
  ├── shared/                  ← read-only data available to all agents
  │   └── (datasets, reference files, etc.)
  ├── agent-1/                 ← agent-1's home (mounted as /home/agent)
  │   ├── workspace/           ← repo clone
  │   ├── .claude/             ← agent's Claude settings/memory
  │   └── .local/share/pnpm/  ← pnpm cache
  └── agent-2/                 ← fully isolated from agent-1
      └── ...
```

### Container (`/home/agent/`)

```
/home/agent/                   ← mounted from ~/dev-agents/<agent-id>
  ├── workspace/               ← repo clone (read-write)
  ├── shared/                  ← mounted from ~/dev-agents/shared (read-only)
  ├── env/                     ← project .env files (read-only)
  ├── data/                    ← project data dirs (read-only)
  └── ...

/opt/agent-server/             ← command server (baked into image, not mounted)
  ├── server.js
  └── package.json
```

## Setup

### Prerequisites

- Docker with Compose v2+
- [Bun](https://bun.sh) (for the channel server)
- [Claude Code](https://claude.ai/claude-code) v2.1.80+
- Claude Code authenticated via claude.ai login (SSO works)

### 1. Clone this repo

```bash
git clone https://github.com/andrewluetgers/dev-agents.git
cd dev-agents
```

### 2. Install channel dependencies

```bash
cd channel && bun install && cd ..
```

### 3. Build the agent image

```bash
docker build -t dev-agent:latest ./image

# With a corporate CA cert (for SSL-inspecting proxies):
cp /path/to/your-ca.crt image/ca-cert.crt
docker build -t dev-agent:latest ./image

# With a custom UID (match your host user):
docker build -t dev-agent:latest --build-arg AGENT_UID=$(id -u) ./image
```

### 4. Create your config

```bash
mkdir -p ~/dev-agents/orchestrator ~/dev-agents/shared
cp config.example.json ~/dev-agents/orchestrator/config.json
```

Edit `~/dev-agents/orchestrator/config.json` with your projects:

```json
{
  "agentImage": "dev-agent:latest",
  "homesDir": "/Users/you/dev-agents",
  "channelPort": 8788,
  "defaults": {
    "memory": "4g",
    "agentUid": 504
  },
  "projects": {
    "my-app": {
      "repo": "https://github.com/you/my-app.git",
      "localPath": "/Users/you/dev/my-app",
      "env": [".env", ".env.local"],
      "data": {
        "datasets": "/Users/you/data/ml-datasets"
      }
    }
  }
}
```

### 5. Start the orchestrator

```bash
claude --dangerously-load-development-channels server:agent
```

This starts Claude Code with the channel server. The channel listens on port 8788 for agent push events and exposes MCP tools to Claude.

## Usage

Once the orchestrator is running, Claude has these tools:

| Tool | Description |
|------|-------------|
| `spawn_agent` | Create a new agent container with a persistent home directory |
| `stop_agent` | Stop an agent (home directory persists for warm restart) |
| `dispatch` | Run a command in an agent container |
| `reply` | Respond to an agent's question |
| `list_agents` | Show all agents with ports, projects, and status |

### Spawn an agent

Tell Claude: *"Spin up an agent for the cohort-search project."*

Claude calls `spawn_agent` with `name: "auth-work"` and `project: "cohort-search"`. The channel:
1. Creates `~/dev-agents/auth-work/`
2. Starts a container with that directory as `/home/agent`
3. Mounts `.env` files and data directories from the project config
4. Docker assigns a free port automatically
5. The agent boots, announces itself via push

### Dispatch work

Tell Claude: *"Have auth-work run the test suite."*

Claude calls `dispatch` with `agent: "auth-work"` and `command: "cd workspace && pnpm test"`.

### Receive push events

When an agent pushes an event (status update, result, error, question), it arrives in your Claude Code session as:

```
<channel source="agent" agent="auth-work" type="result">
All 136 tests passed.
</channel>
```

Claude sees this and can take action — dispatch more work, reply to questions, or report to you.

### Warm restart

```
# Agent's container dies or you stop it
# Home directory persists at ~/dev-agents/auth-work/

# Tell Claude: "Restart auth-work"
# spawn_agent with the same name — picks up where it left off
```

## Agent command server

Each container runs a lightweight HTTP server on port 9111 (mapped to an auto-assigned host port).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Agent status, ID, workspace path |
| `/exec` | POST | Run a command: `{"command": "...", "timeout": 120000}` |
| `/notify` | POST | Push event to channel: `{"type": "result", "content": "..."}` |
| `/ask` | POST | Ask the orchestrator a question (blocks until reply): `{"prompt": "..."}` |
| `/respond` | POST | Deliver a reply from the orchestrator: `{"response": "..."}` |

## Communication flow

```
Orchestrator (Claude Code)           Agent Container
  │                                       │
  ├── spawn_agent ──────────────────────► boots
  │                                       ├── POST :8788 (status: ready)
  │  ◄── <channel agent="x" type="status"> ──┘
  │                                       │
  ├── dispatch (command) ───────────────► /exec
  │  ◄── result ──────────────────────────┘
  │                                       │
  │                                       ├── POST :8788 (type: prompt)
  │  ◄── <channel agent="x" type="prompt"> ──┘
  ├── reply (text) ─────────────────────► /respond
  │                                       │
  │                                       ├── POST :8788 (type: result)
  │  ◄── <channel agent="x" type="result"> ──┘
```

## Files

```
dev-agents/
  ├── image/
  │   ├── Dockerfile           ← agent container image
  │   ├── server.js            ← command server (zero deps, ESM)
  │   └── package.json         ← declares "type": "module"
  ├── channel/
  │   ├── agent-channel.ts     ← MCP channel + orchestration tools
  │   └── package.json         ← bun project with @modelcontextprotocol/sdk
  ├── .mcp.json                ← registers channel with Claude Code
  └── config.example.json      ← template for ~/dev-agents/orchestrator/config.json
```

## When to use multiple agents

A single container can run multiple Claude sessions, use git worktrees, and parallelize commands. You don't need a new container just for parallelism.

**Use a new container when:**
- **Conflicting environments** — different dependency versions, destructive migrations
- **Resource isolation** — memory-heavy work that shouldn't OOM-kill other agents
- **Different projects** — separate repos with separate stacks
- **Blast radius** — risky or experimental work you want sandboxed

**Within one container, an agent can:**
- Run multiple Claude CLI sessions
- Work on multiple git branches via worktrees
- Run parallel commands (typecheck + tests + dev server)
- Do research while writing code
