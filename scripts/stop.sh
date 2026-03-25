#!/bin/bash
#
# Stop the dev-agents server and dashboard.
#
PIDFILE="$HOME/dev-agents/.pids"

if [ -f "$PIDFILE" ]; then
  while read pid; do
    kill "$pid" 2>/dev/null
  done < "$PIDFILE"
  rm -f "$PIDFILE"
fi

# Also kill by port in case PIDs are stale
lsof -ti:8788 | xargs kill 2>/dev/null
lsof -ti:5174 | xargs kill 2>/dev/null

echo "Stopped"
