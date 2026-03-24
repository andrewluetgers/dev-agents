---
name: stop
description: Stop a running dev agent. Lists active agents if no name given.
user-invocable: true
---

# Stop Agent

Stop a running dev agent container. Home directory persists for warm restart.

## Usage

`/stop [agent-name]`

Examples:
- `/stop cs-playwright` — stop the cs-playwright agent
- `/stop` — list running agents and ask which to stop

## Procedure

### 1. Resolve the agent

**If no argument:** Use `list_agents` to show all running agents. Ask the user which one to stop.

**If argument given:** Use it as the agent name.

### 2. Save work first

Before stopping, message the agent to save its work:

```
message(agent: "<name>", content: "I'm going to stop your session. Before I do, please:
- Commit or stash any uncommitted changes
- Write a summary of what you've done, what's left, and any decisions you made to .dev-agents/memory.md
- Note any issues or blockers for the next session
Confirm when you're done.")
```

Wait for confirmation (via a push event or dispatch a status check).

If the agent doesn't respond within 30 seconds, warn the user and ask if they want to force stop.

### 3. Stop the container

```
stop_agent(agent: "<name>")
```

### 4. Report

Tell the user:
- Agent stopped
- Home directory location (persists for warm restart)
- Any work summary the agent wrote
