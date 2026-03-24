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

If yes, export the cert from the system keychain (macOS):

```bash
security find-certificate -c "Zscaler Root CA" -p /Library/Keychains/System.keychain > ./image/ca-cert.crt
```

If not on macOS, ask for the cert file path and copy it to `image/ca-cert.crt`.

**Important:** Pull a fresh base image before building. ECI validates Docker socket access by comparing image layer digests against the registry. A stale base image causes silent validation failures in step 9.

```bash
docker pull node:22-slim
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
4. If not, tell the user to run `/onboard-project` in that repo to set it up:
   ```
   cd <project-path>
   claude
   /onboard-project
   ```
   The onboard-project skill must run FROM the project directory so it has full codebase context. Do NOT run it from the dev-agents orchestrator repo.
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

**Container auth via macOS Keychain:**

Claude Code stores a managed API key in the macOS Keychain under service name "Claude Code". Extract it and pass as `ANTHROPIC_API_KEY` when spawning containers:

```bash
TOKEN=$(security find-generic-password -s "Claude Code" -w)
docker run -e ANTHROPIC_API_KEY="$TOKEN" ...
```

Test that it works inside a container:

```bash
TOKEN=$(security find-generic-password -s "Claude Code" -w)
docker run --rm -e ANTHROPIC_API_KEY="$TOKEN" dev-agent:latest claude auth status
```

Containers also need `~/.claude.json` with `{"hasCompletedOnboarding": true}` pre-seeded in the agent's home directory to skip the interactive onboarding wizard.

Note: `claude setup-token` and interactive `claude auth login` inside containers may not work with corporate/Teams accounts. The Keychain extraction approach is the reliable path.

### 9. Docker socket access

The orchestrator container needs Docker socket access to spawn sibling agent containers.
Two things must be configured: ECI allowlisting and Unix socket permissions.

**Test Docker socket access:**

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock --group-add 0 dev-agent:latest docker ps 2>&1
```

Note: `--group-add 0` is required because Docker Desktop mounts the socket as `root:root` inside the container. The agent user needs the root group to read it.

If it succeeds, report: "Docker socket access works." and move on.

#### ECI allowlisting

If it fails with "Docker socket mount denied", ECI is blocking the agent image.

ECI's Docker socket access is controlled via an `admin-settings.json` file, NOT through Docker Desktop's UI settings panel. The file goes at:

- **macOS**: `/Library/Application Support/com.docker.docker/admin-settings.json` (requires sudo)
- **Windows**: `C:\ProgramData\Docker\admin-settings.json`
- **Linux**: `/usr/share/docker-desktop/admin-settings.json`

Reference: https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation/config/

**The reference config is at `image/admin-settings.json` in this repo.** The approach:

- Allowlist the Dockerfile's base image (`node:22-slim`) and set `allowDerivedImages: true`
- This lets any locally built image derived FROM that base access the socket
- ECI validates by comparing digests against the registry, so the base image must be fresh

**Setup steps:**

1. Pull a fresh base image first — stale digests cause silent validation failures:
   ```bash
   docker pull node:22-slim
   ```

2. Rebuild the agent image so its layer lineage matches the fresh base:
   ```bash
   docker build -t dev-agent:latest --build-arg AGENT_UID={uid} ./image
   ```

3. Install the admin-settings.json (requires sudo — have the user run this themselves).

   **Do NOT blindly overwrite** — the user may have an existing file with other settings.

   First check if it already exists:
   ```bash
   cat "/Library/Application Support/com.docker.docker/admin-settings.json" 2>/dev/null
   ```

   - If it **doesn't exist**: copy our reference file directly:
     ```bash
     sudo mkdir -p "/Library/Application Support/com.docker.docker"
     sudo cp ./image/admin-settings.json "/Library/Application Support/com.docker.docker/admin-settings.json"
     ```

   - If it **already exists**: read both files, deep-merge the `enhancedContainerIsolation` key from our reference into the existing file (preserving other keys), write the merged result to a temp file, then have the user `sudo cp` it into place. Use `jq` or `python3 -c 'import json, sys; ...'` for the merge.

4. Fully quit and reopen Docker Desktop (the file is only read at startup).

5. Retry the socket test.

If it still fails after all this, the org may be enforcing ECI via MDM and overriding local admin-settings. In that case:

1. Tell the user to contact their Docker admin to add the base image to the org's socket allowlist in the Admin Console.
2. Note that worker agents don't need the socket — only the orchestrator does. Setup can continue without it.

### 10. Verify end-to-end

Spawn a test agent, verify everything works, tear down:

```bash
mkdir -p ~/dev-agents/test-agent/workspace

docker run -d --name dev-test-agent \
  -p 0:9111 \
  --add-host host.docker.internal:host-gateway \
  --group-add 0 \
  -v ~/dev-agents/test-agent:/home/agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
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
