#!/bin/bash
set -e

python server/server.py &
SERVER_PID=$!

sleep 10

python server/utils/daemons.py &
DAEMON_PID=$!

cleanup() {
  echo "Stopping processes..."
  kill $SERVER_PID $DAEMON_PID 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait