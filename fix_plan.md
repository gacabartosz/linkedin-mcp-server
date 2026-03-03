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
- [x] Add shebang to dist/index.js (#!/usr/bin/env node) via prepublish script
- [x] Add CLAUDE.md with project conventions
- [x] LinkedIn algorithm guidelines (guidelines/linkedin-strategy.json + tool #25 linkedin_guidelines)
- [x] 5 new templates (viral-trend, community-question, lead-magnet, carousel-edu, thought-leadership-pl) — 12 total
- [x] Upgraded all templates with tips field and algorithm-aware descriptions
- [x] Extended BrandVoiceConfig with LinkedIn algorithm fields
- [x] Updated tool descriptions with algorithm best practices

### TODO — Next tasks for Ralph
- [x] Update CLAUDE.md to reflect Phase 2 changes (25 tools, 12 templates, guidelines module)
- [ ] Test linkedin_auth_status tool with no tokens — verify graceful response
- [ ] Test linkedin_guidelines tool with various topics — verify all return data
- [ ] Test linkedin_template_list — verify 12 templates load correctly
- [ ] Test linkedin_brand_voice get — verify new LinkedIn-specific fields present
- [ ] Test linkedin_schedule_create → linkedin_schedule_list flow
- [ ] Add input validation error messages that guide users (e.g., "text is required, use linkedin_template_list to browse templates")
- [x] Add connection timeout to fetch calls (AbortController with 30s timeout)
- [ ] Verify the scheduler catch-up logic works (overdue posts published on startup)
- [ ] Consider adding linkedin_post_create_with_image convenience tool (generate + upload + post in one call)
- [x] Ensure guidelines/linkedin-strategy.json is included in npm package (files[] in package.json)
- [x] Add tips field to ContentTemplate TypeScript interface in templates.ts
