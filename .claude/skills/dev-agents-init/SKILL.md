---
name: dev-agents-init
description: First-time setup for the dev-agents orchestration system. Checks prerequisites, builds the image, creates config, and walks through auth.
---

# Dev Agents Setup

Interactive onboarding for the dev-agents orchestration system. Run this on first use or to reconfigure.

Use the task system to track progress. Create all tasks up front, update them as you go. Ask the user questions when you need input — don't block silently.

## Task List

Create these tasks at the start:

1. **Check prerequisites** — Docker, Claude Code, Bun
2. **Detect host environment** — UID, OS, home directory
3. **Build the agent Docker image** — with correct UID and optional CA cert
4. **Create orchestrator home** — `~/dev-agents/orchestrator/` with config and memory
5. **Register projects** — ask which repos to manage, scan for `.dev-agents/`
6. **Azure DevOps auth** — `az login` if user works with ADO
7. **Google Cloud auth** — `gcloud auth login` if user works with GCP
8. **Claude Code auth test** — verify Claude Code is authenticated on the host
9. **Docker socket access** — check ECI settings for Docker socket allowlisting
10. **Verify end-to-end** — spawn a test agent, health check, tear down

## Procedure

Work through each task in order. Mark tasks in_progress when starting, completed when done. If a task fails, report the error and ask the user how to proceed.

### 1. Check prerequisites

Run these checks and report results:

```bash
docker --version
claude --version
bun --version || echo "not installed"
```

If Bun is missing, install it: `npm install -g bun`

If Docker or Claude Code is missing, tell the user to install them and provide links:
- Docker: https://docs.docker.com/get-docker/
- Claude Code: https://claude.ai/claude-code

### 2. Detect host environment

```bash
id -u          # host UID
uname -s       # OS
echo $HOME     # home directory
```

Tell the user: "I detected your UID is {uid}. I'll configure the Docker image to match so file permissions work correctly."

### 3. Build the agent Docker image

Check if the user has a corporate CA cert (Zscaler, etc.):

Ask: "Does your network use a corporate SSL proxy (like Zscaler)? If so, provide the path to the CA certificate file. If not, just say no."

If yes, copy the cert to `image/ca-cert.crt` before building.

```bash
docker build -t dev-agent:latest --build-arg AGENT_UID={uid} ./image
```

This takes a minute or two. While it builds, proceed to ask questions for steps 5 and 6.

### 4. Create orchestrator home

```bash
mkdir -p ~/dev-agents/orchestrator ~/dev-agents/shared
```

Write `~/dev-agents/orchestrator/config.json`:

```json
{
  "agentImage": "dev-agent:latest",
  "homesDir": "{home}/dev-agents",
  "channelPort": 8788,
  "defaults": {
    "memory": "4g",
    "agentUid": {uid}
  },
  "projects": {}
}
```

Write `~/dev-agents/orchestrator/memory.md` with user info gathered so far.

### 5. Register projects

Ask: "What projects do you want to manage with dev-agents? Give me the local paths to your repos (e.g. ~/dev/my-project). You can add more later."

For each project path:
1. Verify the path exists
2. Extract the project name from the directory name
3. Check if `.dev-agents/` exists in the repo
4. If not, ask if they want to create it with a basic config and empty memory
5. Add the project to the orchestrator's config.json

### 6. Azure DevOps auth (optional)

Ask: "Do you use Azure DevOps? If so, I'll set up authentication. Just say yes or no."

If yes:
1. Check if `az` CLI is installed. If not: `pip3 install azure-cli`
2. Run `az login` — this opens the browser for OAuth. Tell the user: "A browser window should open for Azure login. Complete the sign-in and come back."
3. Wait for the command to complete.
4. Verify: `az account show`
5. Ask: "What's your ADO organization? Give me a URL to any work item on your board and I'll figure it out."
6. Extract the org from the URL.
7. Test access: `az devops project list --org https://dev.azure.com/{org} -o table`
8. Report which projects are accessible.

### 7. Google Cloud auth (optional)

Ask: "Do you use Google Cloud? If so, I'll set up authentication."

If yes:
1. Check if `gcloud` is installed. If not, tell the user to install it: https://cloud.google.com/sdk/docs/install
2. Run `gcloud auth login` — browser opens. Tell user to complete sign-in.
3. Run `gcloud auth application-default login` — for ADC.
4. Verify: `gcloud auth print-access-token >/dev/null 2>&1`
5. Ask: "What's your GCP project ID?"
6. Set default: `gcloud config set project {project}`

### 8. Claude Code auth test

```bash
claude --version
```

Tell the user: "Claude Code is installed. Each agent container will need its own `claude login` the first time — I'll walk you through that when you spawn your first agent."

### 9. Docker socket access

Check if Enhanced Container Isolation is blocking Docker socket mounts:

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock dev-agent:latest docker ps 2>&1
```

If it fails with "Docker socket mount denied":

Tell the user: "Docker Desktop's Enhanced Container Isolation is blocking Docker socket access for the agent image. To fix this:

1. Open Docker Desktop → Settings
2. Go to Resources → Advanced (or search for Enhanced Container Isolation)
3. Find the Docker socket image list
4. Add `dev-agent:latest`
5. Apply & Restart Docker Desktop

Let me know when you've done this and I'll retry."

If it succeeds, report: "Docker socket access works."

### 10. Verify end-to-end

Spawn a test agent, verify everything works, tear down:

```bash
mkdir -p ~/dev-agents/test-agent/workspace

docker run -d --name dev-test-agent \
  -p 0:9111 \
  --add-host host.docker.internal:host-gateway \
  -v ~/dev-agents/test-agent:/home/agent \
  -e AGENT_ID=test-agent \
  -e CI=true \
  --memory 4g \
  dev-agent:latest

sleep 4

# Get port and health check
PORT=$(docker port dev-test-agent 9111 | head -1 | grep -o '[0-9]*$')
curl -s localhost:$PORT/health

# Run a command
curl -s localhost:$PORT/exec -H 'Content-Type: application/json' \
  -d '{"command": "node --version && bun --version && pnpm --version"}'

# Tear down
docker rm -f dev-test-agent
rm -rf ~/dev-agents/test-agent
```

Report results. If everything passed: "Setup complete! To start the orchestrator, run:

```
cd /path/to/dev-agents
claude --dangerously-load-development-channels server:agent
```"

## Notes

- Run tasks concurrently where possible (e.g. ask questions while Docker builds)
- If anything fails, don't just retry — diagnose and explain
- Save all configuration decisions to the orchestrator's memory.md
- Be conversational, not robotic. This is onboarding, not a script.
