#!/bin/bash
set -eo pipefail

# CDP port 9222 で起動した Chrome のみを終了
CDP_PID=$(lsof -ti :9222 2>/dev/null || true)

if [ -n "$CDP_PID" ]; then
  kill "$CDP_PID" 2>/dev/null
  echo "[ok] Chrome (CDP) stopped (PID: ${CDP_PID})"
else
  echo "[--] No Chrome on port 9222"
fi
