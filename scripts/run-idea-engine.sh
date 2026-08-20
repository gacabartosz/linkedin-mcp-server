#!/bin/bash
# LaunchAgent wrapper — Idea Engine. Co poniedziałek rano: kopie gity własnych projektów
# i dorzuca pomysły na posty (z realnych commitów) do kolejki media_plan_items (status='plan').
LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"
LOG="$LOG_DIR/idea-engine.log"
mkdir -p "$LOG_DIR"

export PATH="/Users/gaca/.local/bin:/Users/gaca/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/gaca"

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

echo "[$(date -u +%FT%TZ)] idea-engine run start" >> "$LOG"
node idea-engine.mjs --days 14 >> "$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] idea-engine run done (exit $?)" >> "$LOG"
