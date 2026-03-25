#!/bin/bash
#
# Keeps the dev-agents server and dashboard running.
# Restarts them if they die. Run this instead of pnpm dev.
#
# Usage: ./scripts/dev.sh
#

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

cleanup() {
  echo "Shutting down..."
  kill $SERVER_PID $WEB_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

start_server() {
  echo "[dev.sh] Starting server on :8788..."
  pnpm --filter @dev-agents/server dev &
  SERVER_PID=$!
}

start_web() {
  echo "[dev.sh] Starting dashboard on :5174..."
  pnpm --filter @dev-agents/web dev &
  WEB_PID=$!
}

start_server
start_web

echo "[dev.sh] Watching processes..."

while true; do
  # Check server
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[dev.sh] Server died, restarting..."
    sleep 2
    start_server
  fi

  # Check dashboard
  if ! kill -0 $WEB_PID 2>/dev/null; then
    echo "[dev.sh] Dashboard died, restarting..."
    sleep 2
    start_web
  fi

  sleep 5
done
