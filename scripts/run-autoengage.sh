#!/bin/bash
export PATH="/Users/gaca/.nvm/versions/node/v22.22.0/bin:$PATH"
export HOME="/Users/gaca"
export LINKEDIN_PERSON_URN="urn:li:person:FihAwG4y_B"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(cat /Users/gaca/.config/anthropic/api-key 2>/dev/null || echo '')}"
cd /Users/gaca/projects/personal/linkedin-mcp-server
exec /Users/gaca/.nvm/versions/node/v22.22.0/bin/node auto-engage.mjs
