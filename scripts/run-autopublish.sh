#!/bin/bash
# LaunchAgent wrapper for auto-publish daemon
# Logs everything to help debug launchd issues

LOG="/Users/gaca/Library/Logs/linkedin-autopublish.log"
ERRLOG="/Users/gaca/Library/Logs/linkedin-autopublish.error.log"

export PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin:$PATH"
export HOME="/Users/gaca"
export LINKEDIN_PERSON_URN="urn:li:person:FihAwG4y_B"

echo "[$(date -u +%FT%TZ)] Wrapper starting..." >> "$LOG"
echo "[$(date -u +%FT%TZ)] CWD: $(pwd)" >> "$LOG"
echo "[$(date -u +%FT%TZ)] Node: $(which node)" >> "$LOG"

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

exec /Users/gaca/.nvm/versions/node/v22.22.0/bin/node auto-publish.mjs >> "$LOG" 2>> "$ERRLOG"
