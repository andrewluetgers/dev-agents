---
name: list-agents
description: List all running dev agents with their status, projects, and ports.
user-invocable: true
---

# List Agents

Show all running dev agents.

## Usage

`/list-agents`

## Procedure

Use `list_agents` from the orchestrator channel. Format the output as a table:

```
Agent           Project          Status    Port   Channel
cs-playwright   cohort-search    running   55001  55002
da-channel      dev-agents       starting  55003  55004
```

If no agents are running, say so and suggest `/spawn` to create one.
