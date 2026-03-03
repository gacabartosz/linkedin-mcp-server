# CLAUDE.md — LinkedIn MCP Server

## Build & Run

```bash
npm run build          # TypeScript compile + shebang injection
npm run dev            # Dev mode with tsx
npm start              # Run compiled dist/index.js
```

Verify tools after changes:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Architecture

- `src/index.ts` — MCP server entry point, all 26 tool handlers (single switch statement)
- `src/api/` — LinkedIn REST API modules (client, auth, posts, comments, media, profile, reactions)
- `src/scheduler/` — SQLite-based post scheduler (store, daemon, publisher)
- `src/content/` — Content templates (12 built-in + custom), brand voice config, and guidelines loader
- `src/gemini/` — Google Gemini Imagen 4 image generation
- `src/banner/` — Professional LinkedIn banner generator (HTML→PNG via Puppeteer, 4 templates, 8 gradients)
- `src/utils/` — Config, logger, errors (toolResult/toolError helpers)
- `guidelines/` — LinkedIn algorithm strategy data (`linkedin-strategy.json`)
- `scripts/generate-banner.mjs` — Standalone banner generator CLI (same design system as MCP tool)

## Code Conventions

- **ESM only** — `"type": "module"` in package.json, use `.js` extensions in imports
- **Strict TypeScript** — `strict: true`, target ES2022, NodeNext module resolution
- **Zod for input validation** — schemas defined at top of index.ts, parsed with `.parse(args)` in handlers
- **Tool responses** — always return `toolResult(data)` for success, `toolError(message)` for errors
- **Logging** — use `log("info"|"warn"|"error", message, data?)` from `src/utils/logger.ts`
- **NEVER write to stdout** — all logging goes to stderr (stdout is reserved for MCP stdio transport)
- **Native `fetch()`** — no axios, no node-fetch; use Node 18+ built-in fetch
- **Minimal dependencies** — only `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`

## Adding a New Tool

1. Add Zod input schema at the top of `src/index.ts`
2. Add tool definition in `ListToolsRequestSchema` handler (name, description, inputSchema)
3. Add `case "tool_name":` in `CallToolRequestSchema` handler switch
4. Parse input with `Schema.parse(args)`, call API function, return `toolResult()`
5. Wrap in try/catch — errors caught by the outer handler

## Tools (26 total)

**Auth & Profile:** linkedin_auth_start, linkedin_auth_status, linkedin_profile_me
**Posts:** linkedin_post_create, linkedin_post_update, linkedin_post_delete, linkedin_post_repost, linkedin_post_get, linkedin_posts_list
**Comments:** linkedin_comment_create, linkedin_comments_list, linkedin_comment_delete
**Reactions:** linkedin_reaction_add, linkedin_reaction_remove
**Media:** linkedin_media_upload, linkedin_gemini_image, linkedin_banner_generate
**Scheduling:** linkedin_schedule_create, linkedin_schedule_list, linkedin_schedule_cancel, linkedin_schedule_update
**Content:** linkedin_template_list, linkedin_template_get, linkedin_template_save, linkedin_brand_voice, linkedin_guidelines

## Banner Generator

`linkedin_banner_generate` creates professional 1200×627 LinkedIn banners (2x retina).

**Templates:** hero (big stat + headline), split (bullets + icon), numbers (3 stats), vs (before/after)
**Gradients:** ocean, sunset, purple, emerald, fire, midnight, teal, rose
**Presets:** post5-post17 (pre-configured designs for scheduled posts)

All banners include CTA bar (bottom) with personal branding + call-to-action text.
Can auto-upload to LinkedIn via `upload_to_linkedin: true`.

Scheduler supports `banner_preset` / `banner_config` fields for auto-generation at publish time.

## Templates (12 built-in)

Templates are JSON files in `templates/`. Each has: id, name, description, category, body (with `{{variable}}` placeholders), variables, tips.
Custom templates are saved to `~/.linkedin-mcp/templates/`.

## Brand Voice

Config stored in `~/.linkedin-mcp/brand-voice.json`. Includes LinkedIn algorithm fields:
`hook_max_chars`, `optimal_post_length`, `link_in_comment`, `max_hashtags`, `posting_times`, `posting_days`, `min_gap_hours`, `golden_hour_minutes`, `first_comment_delay_minutes`

## Guidelines

`guidelines/linkedin-strategy.json` — LinkedIn algorithm strategy data loaded by `src/content/guidelines.ts`.
Topics: algorithm, copywriting, formats, timing, hooks, ctas, checklist, dos_donts, links, ab_testing

## LinkedIn API

- Base: `https://api.linkedin.com/rest`
- Headers: `LinkedIn-Version: 202503`, `X-Restli-Protocol-Version: 2.0.0`
- Auth: Bearer token via `linkedinRequest()` in `src/api/client.ts`
- Token refresh is automatic on 401

## Environment Variables

- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` — OAuth app credentials
- `LINKEDIN_ACCESS_TOKEN` — manual token mode (skips OAuth)
- `LINKEDIN_PERSON_URN` — required with manual token
- `GEMINI_API_KEY` — for Imagen 4 image generation
- `LINKEDIN_DATA_DIR` — data directory (default: `~/.linkedin-mcp`)
- `LINKEDIN_API_VERSION` — API version header (default: `202503`)
- `LINKEDIN_CALLBACK_PORT` — OAuth callback port (default: `8585`)
