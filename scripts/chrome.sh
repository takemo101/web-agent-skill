#!/bin/bash
set -eo pipefail

profile_dir="${HOME}/chrome-automation"
chrome_app="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -d "${profile_dir}" ]; then
  echo "Error: ${profile_dir} does not exist. Run 'bun run setup' first."
  exit 1
fi

if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "[ok] Chrome with CDP is already running (port 9222)"
  exit 0
fi

echo "[..] Starting Chrome with CDP..."
"${chrome_app}" \
  --remote-debugging-port=9222 \
  --user-data-dir="${profile_dir}" \
  --profile-directory=Default \
  --no-first-run \
  --no-default-browser-check &

# Wait for CDP to respond
for i in $(seq 1 30); do
  if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "[ok] Chrome started (CDP port 9222)"
    exit 0
  fi
  sleep 0.5
done

echo "Error: Chrome startup timed out"
exit 1
