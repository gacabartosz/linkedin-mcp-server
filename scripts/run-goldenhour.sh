#!/bin/bash
# LaunchAgent wrapper — Golden Hour Engine. Co ~5 min: pilnuje świeżo opublikowanych
# postów i w pierwszych 60 min wysyła push "odpisuj" + odpala sweep propozycji odpowiedzi.
LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"
LOG="$LOG_DIR/golden-hour.log"
mkdir -p "$LOG_DIR"

export PATH="/Users/gaca/.local/bin:/Users/gaca/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/gaca"
# Opcjonalny push na telefon (ntfy/n8n/Make/WA bot). Zostaw puste = tylko powiadomienie macOS.
# export GOLDEN_HOUR_PUSH_URL="https://ntfy.sh/twoj-prywatny-topic"

cd /Users/gaca/projects/personal/linkedin-mcp-server || exit 1

echo "[$(date -u +%FT%TZ)] golden-hour run start" >> "$LOG"
node golden-hour.mjs >> "$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] golden-hour run done (exit $?)" >> "$LOG"
