# LinkedIn MCP Server — Fix Plan

## Phase: Post-MVP Polish

### Completed
- [x] Project scaffolding (package.json, tsconfig.json, .gitignore)
- [x] Utils: config.ts, logger.ts, errors.ts
- [x] API client with token management and refresh
- [x] OAuth 2.0 flow with localhost callback
- [x] Profile API (linkedin_profile_me)
- [x] Posts API (create, update, delete, get, list, repost)
- [x] Media upload (images + video, 2-step flow)
- [x] Comments API (create, list, delete)
- [x] Reactions API (add, remove)
- [x] Scheduler (SQLite store, daemon, publisher)
- [x] Content templates (7 built-in + custom)
- [x] Brand voice configuration
- [x] Gemini Imagen 4 integration
- [x] MCP server with all 24 tools
- [x] README.md
- [x] GitHub Actions publish workflow
- [x] Build passes, 24 tools verified

### TODO — Next tasks for Ralph
- [x] Add shebang to dist/index.js (#!/usr/bin/env node) via prepublish script
- [ ] Add CLAUDE.md with project conventions
- [ ] Test linkedin_auth_status tool with no tokens — verify graceful response
- [ ] Test linkedin_template_list — verify built-in templates load correctly
- [ ] Test linkedin_schedule_create → linkedin_schedule_list flow
- [ ] Add input validation error messages that guide users (e.g., "text is required, use linkedin_template_list to browse templates")
- [ ] Verify the scheduler catch-up logic works (overdue posts published on startup)
- [ ] Add connection timeout to fetch calls (AbortController with 30s timeout)
- [ ] Handle LinkedIn API version header dynamically (default to current month YYYYMM)
- [ ] Consider adding linkedin_post_create_with_image convenience tool (generate + upload + post in one call)
