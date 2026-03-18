#!/bin/bash
# LaunchAgent wrapper for auto-publish daemon
# Self-restarting loop — survives crashes, terminal close, reboot
# launchd handles the initial launch; this script handles restarts

LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"
LOG="$LOG_DIR/auto-publish.log"
mkdir -p "$LOG_DIR"

export PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin:$PATH"
export HOME="/Users/gaca"
# Load secrets from .env (not committed to git)
set -a
source /Users/gaca/projects/personal/linkedin-mcp-server/.env
set +a

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

while true; do
  echo "[$(date -u +%FT%TZ)] Daemon starting (PID $$)..." >> "$LOG"
  /Users/gaca/.nvm/versions/node/v22.22.0/bin/node auto-publish.mjs >> "$LOG" 2>&1
  EXIT_CODE=$?
  echo "[$(date -u +%FT%TZ)] Process exited with code $EXIT_CODE. Restarting in 30s..." >> "$LOG"
  sleep 30
done
