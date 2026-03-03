#!/bin/bash
# Start LinkedIn auto-publish and auto-engage daemons
# Used by LaunchAgent: com.gaca.linkedin-daemons.plist

export PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin:$PATH"
export LINKEDIN_PERSON_URN="urn:li:person:FihAwG4y_B"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(cat /Users/gaca/.config/anthropic/api-key 2>/dev/null || echo '')}"

cd /Users/gaca/projects/personal/linkedin-mcp-server

LOG_DIR="/Users/gaca/output/personal/linkedin-mcp"

# Kill existing instances
pkill -f "auto-publish.mjs" 2>/dev/null
pkill -f "auto-engage.mjs" 2>/dev/null
sleep 1

# Start auto-publish daemon
node auto-publish.mjs >> "$LOG_DIR/auto-publish.log" 2>&1 &
echo "auto-publish PID: $!"

# Start auto-engage daemon
node auto-engage.mjs >> "$LOG_DIR/auto-engage.log" 2>&1 &
echo "auto-engage PID: $!"

# Keep script alive (LaunchAgent KeepAlive will restart if this exits)
wait
