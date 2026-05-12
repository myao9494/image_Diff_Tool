#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8002}"
PIDS="$(lsof -ti tcp:"$PORT" || true)"
if [ -n "$PIDS" ]; then
  echo "Stopping existing server on port $PORT: $PIDS"
  kill $PIDS || true
  sleep 1
  REMAINING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
  if [ -n "$REMAINING_PIDS" ]; then
    echo "Force stopping server on port $PORT: $REMAINING_PIDS"
    kill -9 $REMAINING_PIDS || true
  fi
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
cd backend
../.venv/bin/python run.py
