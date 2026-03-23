# Agent Environment

You are an AI coding agent running in an isolated Docker container managed by an orchestrator.

## Your environment

- **Home**: `/home/agent/` — your persistent workspace, survives container restarts
- **Workspace**: `/home/agent/workspace/` — where you clone and work on repos
- **Shared (read-only)**: `/home/agent/shared/` — curated skills, templates, and data managed by the orchestrator
  - `shared/skills/` — reusable Claude Code skills (SKILL.md files)
  - `shared/templates/` — agent role templates (CLAUDE.md files)
  - `shared/data/` — datasets and reference files
- **Env files**: `/home/agent/env/` — project environment variables (read-only)

## Communicating with the orchestrator

You can push events to the orchestrator at any time via the channel:

```bash
# Report a result
curl -s $CHANNEL_URL -H 'Content-Type: application/json' \
  -d '{"type": "result", "agent": "'$AGENT_ID'", "content": "description of what you accomplished"}'

# Report an error or blocker
curl -s $CHANNEL_URL -H 'Content-Type: application/json' \
  -d '{"type": "error", "agent": "'$AGENT_ID'", "content": "description of what went wrong"}'

# Ask the orchestrator a question (blocks until reply)
curl -s localhost:9111/ask -H 'Content-Type: application/json' \
  -d '{"prompt": "your question here"}'
```

## Requesting shared resources

If you need a skill, template, or dataset that isn't in `/home/agent/shared/`, request it from the orchestrator:

```bash
curl -s $CHANNEL_URL -H 'Content-Type: application/json' \
  -d '{"type": "request", "agent": "'$AGENT_ID'", "content": "skill: <description of what you need>"}'
```

The orchestrator will either:
- Add it to the shared folder (available to all agents)
- Tell you to keep it in your own home directory (agent-specific)
- Deny the request with an explanation

**Do not attempt to write to `/home/agent/shared/`** — it is read-only. Keep agent-specific files in your home directory.

## Status updates

Push status updates so the orchestrator knows what you're doing:

```bash
curl -s $CHANNEL_URL -H 'Content-Type: application/json' \
  -d '{"type": "status", "agent": "'$AGENT_ID'", "content": "cloning repo and installing dependencies"}'
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `AGENT_ID` | Your unique identifier (e.g. `agent-1`) |
| `CHANNEL_URL` | Orchestrator's webhook endpoint |
| `CI` | Set to `true` (non-interactive mode) |
| `NODE_ENV` | `development` |

Project-specific env vars (DATABASE_URL, etc.) are loaded from `/home/agent/env/` when available.
