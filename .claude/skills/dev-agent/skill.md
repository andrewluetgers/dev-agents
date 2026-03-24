---
name: dev-agent
description: Manage dev agents — spawn, list, message, run commands, stop. Single entry point for all agent operations.
user-invocable: true
---

# Dev Agent

Single entry point for managing dev agents. Use `ToolSearch` to fetch any MCP tools before calling them.

## Usage

`/dev-agent [action] [args...]`

Examples:
- `/dev-agent` — show running agents or offer to spawn one
- `/dev-agent new cohort-search` — spawn a new agent for cohort-search
- `/dev-agent new cohort-search write playwright smoke tests` — spawn and assign a task
- `/dev-agent status` — show status of all running agents
- `/dev-agent status cs-playwright` — detailed status of one agent
- `/dev-agent msg cs-playwright focus on login flow first` — message an agent
- `/dev-agent run cs-playwright pnpm test` — run a command in an agent
- `/dev-agent stop cs-playwright` — stop an agent

## Procedure

### Step 1: Fetch MCP tools

Always start by fetching the orchestrator tools:
```
ToolSearch(query: "select:mcp__agent__list_agents,mcp__agent__spawn_agent,mcp__agent__dispatch,mcp__agent__message,mcp__agent__stop_agent")
```

### Step 2: Determine the action

Parse the first argument to determine what to do:

| First arg | Action |
|-----------|--------|
| (none) | List agents, or offer to spawn if none running |
| `new` | Spawn a new agent |
| `status` | Show status of all agents (or one if name follows) |
| `msg` | Message an agent |
| `run` | Run a command in an agent |
| `stop` | Stop an agent |
| (agent name) | Show that agent's status and offer actions |

### Action: List / Default (no args)

1. Call `mcp__agent__list_agents`
2. If agents exist, show them as a table and use AskUserQuestion to offer actions:
   - "Spawn new agent"
   - One option per running agent (clicking selects it for msg/run/stop)
3. If no agents, use AskUserQuestion with registered projects from `~/dev-agents/orchestrator/config.json` and offer to spawn

### Action: New (spawn)

Arguments: `/dev-agent new [project] [task...]`

1. If no project given, read `~/dev-agents/orchestrator/config.json` and use AskUserQuestion to show registered projects
2. Generate agent name from project + task (e.g. `cs-playwright`, `cs-auth-fix`)
3. Call `mcp__agent__spawn_agent(name: "<name>", project: "<project>")`
4. Wait 3 seconds, then call `mcp__agent__dispatch(agent: "<name>", command: "curl -s localhost:9111/health")`
5. If task was given, call `mcp__agent__message(agent: "<name>", content: "<task>")`
6. Report: agent name, project, port, task assigned

### Action: Status

Arguments: `/dev-agent status [agent-name]`

1. Call `mcp__agent__list_agents`
2. If an agent name was given, filter to just that agent
3. For each agent, also call `mcp__agent__dispatch(agent: "<name>", command: "curl -s localhost:9111/health")` to get live health
4. Show a concise summary:
   ```
   cs-playwright (cohort-search) — running
     Port: 55010 | Channel: 55011 | Health: ok
     Claude session: active | Pending permissions: 0
   ```

### Action: Message

Arguments: `/dev-agent msg <agent> <message...>`

1. If no agent name, call `mcp__agent__list_agents` and ask which one
2. Call `mcp__agent__message(agent: "<name>", content: "<message>")`
3. Confirm delivery

### Action: Run

Arguments: `/dev-agent run <agent> <command...>`

1. If no agent name, call `mcp__agent__list_agents` and ask which one
2. Call `mcp__agent__dispatch(agent: "<name>", command: "<command>")`
3. Show stdout/stderr and exit code

### Action: Stop

Arguments: `/dev-agent stop <agent>`

1. If no agent name, call `mcp__agent__list_agents` and ask which one
2. First message the agent to save work:
   `mcp__agent__message(agent: "<name>", content: "Save your work — committing/stashing changes and writing a summary to .dev-agents/memory.md. Confirm when done.")`
3. Wait for confirmation or 30 seconds
4. Call `mcp__agent__stop_agent(agent: "<name>")`
5. Report: agent stopped, home directory preserved

## Rules

- Always use ToolSearch before calling MCP tools
- Never use Bash to interact with agents — always use the MCP tools
- Keep output concise
