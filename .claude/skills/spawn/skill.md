---
name: spawn
description: Spawn a dev agent for a project. Autocompletes registered projects or accepts a path/URL.
user-invocable: true
---

# Spawn Agent

Spawn an isolated dev agent container for a project.

## Usage

`/spawn [project-or-path] [task-description]`

Examples:
- `/spawn cohort-search` — spawn an agent for cohort-search, ask what to do
- `/spawn cohort-search write playwright smoke tests for apps/web` — spawn and assign a task
- `/spawn ~/dev/my-project` — spawn for an unregistered project path
- `/spawn` — show registered projects and ask which one

## Procedure

### 1. Resolve the project

Read the orchestrator config at `~/dev-agents/orchestrator/config.json` to get registered projects.

**If no argument given:** Show the registered projects as options and ask which one. Include an "Other" option for entering a path or git URL.

**If argument matches a registered project name:** Use it.

**If argument is a local path:** Verify it exists. If it has `.dev-agents/`, use it directly. If not, suggest running `/onboard-project` first.

**If argument is a git URL:** The agent will clone it into its workspace after spawning.

### 2. Name the agent

Generate a short, descriptive name based on the project and task. Examples:
- `cs-playwright` (cohort-search, playwright tests)
- `cs-auth-fix` (cohort-search, fixing auth)
- `da-channel` (dev-agents, channel work)

If the user provided a task description, derive the name from it. Otherwise use `{project-prefix}-agent-{n}`.

### 3. Spawn the container

Use the `spawn_agent` MCP tool from the orchestrator channel:

```
spawn_agent(name: "<agent-name>", project: "<project-name>")
```

This creates the container with:
- Project repo mounted at `/home/agent/workspace`
- Fresh API key from macOS Keychain
- Per-agent home directory at `~/dev-agents/<agent-name>/`
- 8GB memory limit
- Docker socket access

### 4. Wait for the agent to come online

After spawning, the agent's server starts and announces itself to the orchestrator. Check health:

```
dispatch(agent: "<agent-name>", command: "curl -s http://localhost:9111/health")
```

### 5. Assign the task (if given)

If the user provided a task description, send it to the agent:

```
message(agent: "<agent-name>", content: "<task-description>")
```

If no task was given, tell the user the agent is ready and they can send it work with:
```
message the <agent-name> agent to <task>
```

### 6. Report

Tell the user:
- Agent name and container ID
- Which project and port
- What task was assigned (if any)
- How to interact: `message <agent> to ...`, `dispatch <agent> <command>`, `stop_agent <agent>`
