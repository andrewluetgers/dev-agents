#!/bin/bash
# Starts the orchestrator channel with a fresh API key from the macOS Keychain.
# Called by Claude Code via .mcp.json — runs as the MCP server process.
export ANTHROPIC_API_KEY=$(security find-generic-password -s "Claude Code" -w 2>/dev/null)
export ORCHESTRATOR_HOME="${ORCHESTRATOR_HOME:-$HOME/dev-agents/orchestrator}"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Failed to extract Claude Code API key from keychain" >&2
  exit 1
fi

# Kill any stale process on the channel port
lsof -ti:8788 | xargs kill -9 2>/dev/null

exec bun "$(dirname "$0")/../image/channel/agent-channel.ts"
