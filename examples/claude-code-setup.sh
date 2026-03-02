#!/bin/bash
# Add LinkedIn MCP server to Claude Code (user scope)
#
# Replace the values below with your actual credentials:
#   - LINKEDIN_CLIENT_ID: from https://developer.linkedin.com/
#   - LINKEDIN_CLIENT_SECRET: from https://developer.linkedin.com/
#   - GEMINI_API_KEY: from https://aistudio.google.com (optional, for AI images)

claude mcp add --scope user linkedin npx -- -y linkedin-mcp-server \
  -e LINKEDIN_CLIENT_ID=your_client_id \
  -e LINKEDIN_CLIENT_SECRET=your_client_secret \
  -e GEMINI_API_KEY=your_gemini_key
