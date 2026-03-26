# Dev container for AI coding agents
# Isolated environment for autonomous AI agent workstations
#
# Two modes (same image):
#   Worker (default):       bun /opt/agent/server.ts
#   Orchestrator (override): bun /opt/agent/channel.ts
#
# Each agent gets its own home directory mounted from the host:
#   ~/dev-agents/<agent-id> → /home/agent
#
# All agent infrastructure lives at /opt/agent/ so host mounts
# on /home/agent don't clobber it.
#
# Designed for Docker Desktop Enhanced Container Isolation (ECI):
#   - Runs as non-root 'agent' user (UID matches host via AGENT_UID build arg)
#   - No --privileged required
#   - sudo is available but ECI restricts it to container-scoped ops only

FROM node:22-slim

# Optional: corporate CA cert for environments behind SSL-inspecting proxies.
# Place your cert at image/ca-cert.crt before building. If absent, this is a no-op.
COPY ca-cert.cr[t] /usr/local/share/ca-certificates/custom-ca.crt

# Dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    procps \
    sudo \
    ca-certificates \
    tmux \
  && rm -rf /var/lib/apt/lists/* \
  && update-ca-certificates

# UTF-8 locale — required for Unicode box-drawing in Claude Code TUI
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# Docker CLI — official static binary (the debian docker.io package is too old for Docker Desktop)
ARG DOCKER_CLI_VERSION=27.5.1
RUN curl -fsSL "https://download.docker.com/linux/static/stable/$(uname -m)/docker-${DOCKER_CLI_VERSION}.tgz" \
  | tar xz --strip-components=1 -C /usr/local/bin docker/docker

# Set CA env immediately so all subsequent npm/bun installs trust the proxy
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/custom-ca.crt

# Bun — primary runtime for agent infrastructure
RUN npm install -g bun

# pnpm — for project work inside the container
ARG PNPM_VERSION=10.30.3
RUN npm install -g pnpm@${PNPM_VERSION}

# Claude Code — so agents can run claude sessions autonomously
RUN npm install -g @anthropic-ai/claude-code
ENV CLAUDE_CODE_DISABLE_AUTO_UPDATE=1

# Playwright MCP — browser automation for agents (accessibility-tree based, not screenshots)
# Install Playwright + Chromium with system dependencies
RUN npx playwright install --with-deps chromium

# Non-root user — UID should match host user for bind mount permissions
ARG AGENT_UID=1000
RUN useradd -m -s /bin/bash -u ${AGENT_UID} agent \
  && echo "agent ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
  && usermod -aG docker agent 2>/dev/null || true

# Agent infrastructure — server + channel + shared deps in one directory
COPY server.ts /opt/agent/server.ts
COPY channel/agent-channel.ts /opt/agent/agent-channel.ts
COPY channel/package.json /opt/agent/package.json
RUN cd /opt/agent && bun install \
  && chown -R agent:agent /opt/agent

USER agent
WORKDIR /home/agent/workspace

EXPOSE 9111 9222 8788

# Default: worker mode
CMD ["bun", "/opt/agent/server.ts"]
