#!/bin/bash
#
# Start the dev-agents server and dashboard.
# Stores PIDs in ~/dev-agents/.pids for stop.sh
#
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
PIDFILE="$HOME/dev-agents/.pids"

# Kill any existing instances
"$(dirname "$0")/stop.sh" 2>/dev/null

echo "Starting server..."
pnpm --filter @dev-agents/server dev > /tmp/dev-agents-server.log 2>&1 &
echo $! > "$PIDFILE"

echo "Starting dashboard..."
pnpm --filter @dev-agents/web dev > /tmp/dev-agents-web.log 2>&1 &
echo $! >> "$PIDFILE"

sleep 3

SERVER_OK=$(curl -sf http://localhost:8788/api/rpc/agent/list -X POST -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 && echo "OK" || echo "FAILED")
WEB_OK=$(curl -sf http://localhost:5174 >/dev/null 2>&1 && echo "OK" || echo "FAILED")

echo "Server :8788  $SERVER_OK"
echo "Dashboard :5174  $WEB_OK"
echo ""
echo "Logs: tail -f /tmp/dev-agents-server.log /tmp/dev-agents-web.log"
echo "Stop: ./scripts/stop.sh"
