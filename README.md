# dev-agents

Orchestrate isolated AI coding agents via Docker and Claude Code Channels. Agents work autonomously in sandboxed containers while an orchestrator manages permissions, communication, and quality gates. Inspired by [OpenAI's Symphony](https://github.com/openai/symphony) and [harness engineering](https://openai.com/index/harness-engineering/) methodology.

## Requirements

- **Docker Desktop** with Compose v2+ (Enhanced Container Isolation supported)
- **Claude Code** v2.1.80+ — authenticated via claude.ai (SSO works)
- **Node.js** 22+
- **Git**

## Getting Started

```bash
# 1. Clone this repo
git clone https://github.com/andrewluetgers/dev-agents.git
cd dev-agents

# 2. Run the setup skill — it handles everything else interactively
claude
/dev-agents-init
```

The `/dev-agents-init` skill walks you through:
- Installing prerequisites (Bun, az CLI, gcloud if needed)
- Building the Docker image (detects your UID and corporate certs automatically)
- Creating `~/dev-agents/` with orchestrator config and memory
- Registering your projects
- Setting up auth (Azure DevOps, GCP) via browser OAuth
- Verifying the full stack end-to-end

After setup, onboard a project:

```bash
/onboard-project ~/dev/my-project
```

This assesses the project's agent readiness, creates `.dev-agents/` config files, scores legibility, and produces a gap closure plan.

## How It Works

```
You
  │
  └── Claude Code (orchestrator)
        │  Spawns agents, approves permissions, manages work
        │
        ├── Agent 1 (Docker container)
        │     Claude Code session working autonomously
        │     Pushes results/questions back to orchestrator
        │
        ├── Agent 2 (Docker container)
        │     Different project, fully isolated
        │
        └── Agent N ...
```

**One agent, one container, always.** Each agent gets a persistent home directory on the host at `~/dev-agents/<agent-id>/`. Containers come and go; the home directory survives.

**Push, not poll.** Agents push events to the orchestrator via webhook. The orchestrator pushes messages into agents' Claude sessions via MCP channels. Bidirectional, low latency.

**Orchestrator as user proxy.** The orchestrator holds the user's intent and makes decisions on their behalf — approving permissions, answering questions, redirecting agents that go off-track.

## Running the Orchestrator

```bash
cd ~/dev/dev-agents
claude --dangerously-load-development-channels server:agent
```

The orchestrator has these MCP tools:

| Tool | Description |
|------|-------------|
| `spawn_agent` | Create a new agent container for a project |
| `stop_agent` | Stop an agent (home directory persists for warm restart) |
| `dispatch` | Run a shell command in an agent container |
| `message` | Push a message into an agent's Claude session |
| `reply` | Answer an agent's question |
| `approve` / `deny` | Approve or deny an agent's permission request |
| `list_agents` | Show all agents with status |

## Permission Management

Agents run without `--dangerously-skip-permissions`. Every tool use goes through the orchestrator for approval:

- **Auto-approve**: reads, builds, tests, linting, git add/commit
- **Review**: branch switching, external network, database operations
- **Always deny + escalate**: force push, `rm -rf`, pipeline changes, publishing

After every denial, the orchestrator explains why and suggests alternatives. See [the full policy](channel/agent-channel.ts) in the orchestrator instructions.

## Project Integration

Each project that agents work on has a `.dev-agents/` directory (committed to the repo):

```
my-project/.dev-agents/
  ├── config.json       ← env vars, skills, branch config
  ├── memory.md         ← architecture, people, decisions, gotchas
  ├── WORKFLOW.md       ← how agents handle work items (Symphony pattern)
  └── LEGIBILITY.md     ← agent readiness scorecard + gap closure plan
```

## Execution Phases

Agents work through structured phases with gates between them:

1. **Research** — read code, tests, docs (agent solo)
2. **Plan** — propose approach, get approval (interactive with user)
3. **Execute** — implement in small commits (agent solo)
4. **Verify** — run deterministic gates: typecheck, test, lint (agent solo)
5. **Deliver** — push branch, report completion (agent solo)

Two key touch points require user involvement:
- **Planning** — collaborative back-and-forth before coding
- **Harness engineering** — when the system itself needs improvement

## Architecture

### Host Layout

```
~/dev-agents/                         ← not in git
  ├── orchestrator/
  │   ├── config.json                 ← image, homes dir, project pointers
  │   └── memory.md                   ← user prefs, auth, cross-project notes
  ├── shared/                         ← read-only to all agents
  │   ├── skills/                     ← ADO boards, pipelines, gcloud, etc.
  │   └── templates/                  ← agent role templates
  └── <agent-id>/                     ← per-agent home (mounted as /home/agent)
      └── workspace/                  ← repo clone
```

### Container Layout

```
/home/agent/                          ← mounted from ~/dev-agents/<agent-id>
  ├── workspace/                      ← repo clone (read-write)
  ├── shared/                         ← from ~/dev-agents/shared (read-only)
  └── env/                            ← project .env files (read-only)

/opt/agent/                           ← baked into image (not mounted)
  ├── server.ts                       ← command server + agent channel
  └── agent-channel.ts                ← orchestrator channel (orchestrator mode)
```

### Communication

```
Orchestrator                          Agent Container
  │                                       │
  ├── spawn_agent ──────────────────────► boots, announces via push
  ├── dispatch (command) ───────────────► /exec → returns result
  ├── message (text) ───────────────────► injected into Claude session
  │                                       │
  │  ◄── push: status/result/error ───────┤ agent pushes events
  │  ◄── push: permission_request ────────┤ agent needs approval
  ├── approve/deny ─────────────────────► verdict relayed to Claude
  │                                       │
  │  ◄── push: prompt (question) ─────────┤ agent asks a question
  ├── reply (answer) ───────────────────► unblocks agent's /ask call
```

## Shared Skills

Reusable skills available to all agents:

| Skill | Description |
|-------|-------------|
| `ado-boards` | Query, update, create, link ADO work items |
| `ado-pipelines` | Approve, monitor ADO pipeline runs |
| `gcloud` | GCP auth, storage, Cloud Run, Cloud SQL, logging |
| `example-reviewer` | Code review from a git diff |

Skills follow a consistent pattern: `config.json` (env + auth + permissions) + `SKILL.md` (instructions).

## Harness Engineering

When agents struggle, it's a signal the **harness** needs work — not just the agent. The orchestrator tracks failure patterns and escalates to the user for harness engineering sessions.

Harness improvements compound: fix a legibility gap or add a golden principle, and every future agent run benefits.

Key principles:
1. Documentation is the table of contents, not the encyclopedia
2. Golden principles are enforced, not suggested
3. Code design is context
4. Deterministic gates before LLM evaluation
5. Structured execution phases
6. Entropy management (the meta-loop)
7. Application legibility (project-specific, assessed via `/onboard-project`)

See [docs/SYMPHONY-PLAN.md](docs/SYMPHONY-PLAN.md) for the full implementation plan.

## Files

```
dev-agents/
  ├── image/
  │   ├── Dockerfile              ← agent container (worker + orchestrator modes)
  │   ├── server.ts               ← command server + agent channel (Bun)
  │   └── channel/                ← orchestrator channel (baked into image)
  ├── channel/
  │   └── agent-channel.ts        ← MCP channel + tools + permission policy
  ├── skills/                     ← shared skills (ado-boards, gcloud, etc.)
  ├── templates/                  ← agent role templates (base-agent, researcher)
  ├── docs/
  │   └── SYMPHONY-PLAN.md        ← implementation plan
  ├── .claude/skills/
  │   ├── dev-agents-init/        ← /dev-agents-init — first-time user setup
  │   └── onboard-project/        ← /onboard-project — project readiness assessment
  ├── .mcp.json                   ← registers channel with Claude Code
  └── config.example.json         ← template for orchestrator config
```

## When to Use Multiple Agents

A single container can run multiple Claude sessions and parallelize commands. You don't need a new container just for parallelism.

**Use a new container when:**
- Conflicting environments (different dependency versions)
- Resource isolation (memory-heavy work)
- Different projects entirely
- Blast radius (risky/experimental work)
