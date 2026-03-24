---
name: run
description: Run a shell command inside a dev agent container and return the output.
user-invocable: true
---

# Run Command in Agent

Execute a shell command inside a running agent's container.

## Usage

`/run <agent-name> <command>`

Examples:
- `/run cs-playwright pnpm test`
- `/run cs-auth-fix git status`
- `/run cs-playwright curl -s http://localhost:3001/api/status`

## Procedure

### 1. Resolve

**If no agent name:** Use `list_agents` and ask which one.

**If agent name but no command:** Ask what to run.

### 2. Execute

```
dispatch(agent: "<name>", command: "<command>")
```

### 3. Report

Show the output (stdout/stderr) and exit code. If exit code is non-zero, note the failure.
