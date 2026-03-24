#!/bin/bash
# Extracts the Claude Code API key from the macOS Keychain.
# SSO-managed keys rotate — call this fresh each time rather than caching.
# Usage: export ANTHROPIC_API_KEY=$(./scripts/get-claude-key.sh)
security find-generic-password -s "Claude Code" -w 2>/dev/null
