#!/bin/bash
# LaunchAgent wrapper — QA Gate (humanizer + Opus 4.8 fact-check) co godzinę.
# Przejeżdża wszystkie zaplanowane posty bez qa_status='approved'.
LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"
LOG="$LOG_DIR/qa-gate.log"
mkdir -p "$LOG_DIR"

# claude CLI w /Users/gaca/.local/bin, node z nvm
export PATH="/Users/gaca/.local/bin:/Users/gaca/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/gaca"

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

echo "[$(date -u +%FT%TZ)] QA gate run start" >> "$LOG"
node qa-gate.mjs >> "$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] QA gate run done (exit $?)" >> "$LOG"
