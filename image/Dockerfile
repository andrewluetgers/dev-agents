# Dev container for AI coding agents
# Isolated Node.js environment for autonomous AI agent workstations
#
# Each agent gets its own home directory mounted from the host:
#   ~/dev-agents/<agent-id> → /home/agent
#
# The command server lives at /opt/agent-server/ so host mounts
# don't clobber it.
#
# Designed for Docker Desktop Enhanced Container Isolation (ECI):
#   - Runs as non-root 'agent' user (UID matches host via AGENT_UID build arg)
#   - No --privileged required
#   - sudo is available but ECI restricts it to container-scoped ops only

FROM node:22-slim

# Optional: corporate CA cert for environments behind SSL-inspecting proxies.
# Place your cert at image/ca-cert.crt before building. If absent, this is a no-op.
COPY ca-cert.cr[t] /usr/local/share/ca-certificates/custom-ca.crt

# Dev tools + CA trust store update
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    procps \
    sudo \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && update-ca-certificates

# Set CA env if a custom cert was added
RUN [ -f /usr/local/share/ca-certificates/custom-ca.crt ] \
  && echo 'export NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/custom-ca.crt' >> /etc/profile.d/custom-ca.sh \
  || true

# pnpm
ARG PNPM_VERSION=10.30.3
RUN npm install -g pnpm@${PNPM_VERSION}

# Non-root user — UID should match host user for bind mount permissions
ARG AGENT_UID=1000
RUN useradd -m -s /bin/bash -u ${AGENT_UID} agent \
  && echo "agent ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Command server (lives outside /home/agent so host mounts don't clobber it)
COPY package.json server.js /opt/agent-server/
RUN cd /opt/agent-server && npm install --omit=dev 2>/dev/null; true \
  && chown -R agent:agent /opt/agent-server

USER agent
WORKDIR /home/agent/workspace

EXPOSE 9111

CMD ["node", "/opt/agent-server/server.js"]
