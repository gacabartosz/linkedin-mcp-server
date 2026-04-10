#!/bin/bash
# Setup LaunchAgent for automatic Voyager cookie refresh
# Runs every 4 hours to keep li_at cookie alive

PLIST_NAME="com.gaca.linkedin-cookie-refresh"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
NODE_PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin/node"
SCRIPT_PATH="/Users/gaca/projects/personal/linkedin-mcp-server/scripts/refresh-voyager-cookie.mjs"
LOG_DIR="/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp"

mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${SCRIPT_PATH}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict>
            <key>Hour</key>
            <integer>6</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>10</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>14</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>18</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>22</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/gaca/projects/personal/linkedin-mcp-server</string>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/cookie-refresh.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/cookie-refresh-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/Users/gaca/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/gaca</string>
        <key>DISPLAY</key>
        <string>:0</string>
    </dict>
</dict>
</plist>
EOF

# Load the agent
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✓ LaunchAgent installed: $PLIST_PATH"
echo "✓ Schedule: every 4h (06:00, 10:00, 14:00, 18:00, 22:00)"
echo ""
echo "FIRST TIME SETUP:"
echo "  cd /Users/gaca/projects/personal/linkedin-mcp-server"
echo "  node scripts/refresh-voyager-cookie.mjs --login"
echo ""
echo "This will open Chrome — log in to LinkedIn manually."
echo "After login, cookies are auto-saved. Future runs are headless."
