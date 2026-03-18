#!/bin/bash
# LaunchAgent wrapper for auto-engage daemon
# Self-restarting loop — survives crashes, terminal close, reboot

LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"
LOG="$LOG_DIR/auto-engage.log"
mkdir -p "$LOG_DIR"

export PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin:$PATH"
export HOME="/Users/gaca"
# Load secrets from .env (not committed to git)
set -a
source /Users/gaca/projects/personal/linkedin-mcp-server/.env
set +a
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(cat /Users/gaca/.config/anthropic/api-key 2>/dev/null || echo '')}"

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

while true; do
  echo "[$(date -u +%FT%TZ)] Auto-engage starting (PID $$)..." >> "$LOG"
  /Users/gaca/.nvm/versions/node/v22.22.0/bin/node auto-engage.mjs >> "$LOG" 2>&1
  EXIT_CODE=$?
  echo "[$(date -u +%FT%TZ)] Process exited with code $EXIT_CODE. Restarting in 30s..." >> "$LOG"
  sleep 30
done
