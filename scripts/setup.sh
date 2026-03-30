#!/bin/bash
set -eo pipefail

profile_dir="${HOME}/chrome-automation"
chrome_profile="${HOME}/Library/Application Support/Google/Chrome"

echo "=== web-agent-skill setup ==="

# 1. Copy Chrome profile (first time only)
if [ -d "${profile_dir}" ]; then
  echo "[ok] Chrome profile: ${profile_dir} (already exists, skipped)"
else
  if [ -d "${chrome_profile}" ]; then
    echo "[..] Copying Chrome profile..."
    cp -r "${chrome_profile}" "${profile_dir}"
    echo "[ok] Chrome profile copied to ${profile_dir}"
  else
    echo "[..] No existing profile found, creating empty directory"
    mkdir -p "${profile_dir}"
    echo "[ok] Created ${profile_dir}"
  fi
fi

# 2. Check CDP connection
if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "[ok] CDP port 9222: connected"
else
  echo "[--] CDP port 9222: not connected (run 'bun run chrome' to start)"
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. bun run chrome       -- start Chrome with CDP"
echo "  2. taskp run web-agent  -- run the agent"
