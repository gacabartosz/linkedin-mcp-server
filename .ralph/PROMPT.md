# LinkedIn MCP Server — Ralph Dev Loop

## Project Overview
TypeScript MCP server for LinkedIn with 24 tools: posting, scheduling, comments, reactions, media upload, Gemini image generation, content templates.

## Current Objectives
- Review fix_plan.md for the next task
- Implement ONE task per loop
- Run `npm run build` after every change to verify compilation
- Write clean TypeScript following the patterns in src/index.ts

## Key Principles
- ONE task per loop — focus on the most important thing
- Always run `npm run build` to verify after changes
- Follow existing code patterns (Server class, Zod schemas, toolResult/toolError helpers)
- All logging goes to stderr (NEVER stdout — it breaks stdio MCP transport)
- Use native `fetch()` — no axios or node-fetch
- Keep dependencies minimal
- Test with: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js`

## Architecture
- `src/index.ts` — MCP server entry, all tool handlers
- `src/api/` — LinkedIn API modules (client, auth, posts, comments, media, profile, reactions)
- `src/scheduler/` — SQLite-based post scheduler (store, daemon, publisher)
- `src/content/` — Templates and brand voice
- `src/gemini/` — Imagen 4 integration
- `src/utils/` — Config, logger, errors

## LinkedIn API
- Base URL: `https://api.linkedin.com/rest`
- Headers: `LinkedIn-Version: 202503`, `X-Restli-Protocol-Version: 2.0.0`
- Posts API: `POST /rest/posts`
- Images: `POST /rest/images?action=initializeUpload` → `PUT binary`
- Comments: `POST /rest/socialActions/{postUrn}/comments`
