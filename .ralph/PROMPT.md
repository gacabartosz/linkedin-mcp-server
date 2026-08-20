# LinkedIn MCP Server — Ralph Dev Loop

## Project Overview
TypeScript MCP server + Playwright automation for LinkedIn:
- Comment scraping z thread memory (drzewko parent_comment_urn)
- Proposal queue (pending → approved → sent przez Playwright)
- Auto-publish scheduler dla postów (REST API)
- Dashboard localhost:6767 — UI do zatwierdzania propozycji

## Current Objectives (PRIORITY ORDER)

1. **Playwright scraper resilience**
   - Każdy scrape musi klikać "więcej" / "see more" przy obciętych komentarzach (defensive — LinkedIn DOM zmienia thresholdy)
   - Selektory PL + EN aria-label (button[aria-label="Zobacz więcej"], button[aria-label="See more"])
   - Test: po scrape żaden source_text nie kończy się na "..." ani "więcej"

2. **Auto-comment-sender retry logic**
   - Jeśli sendReply zwróci `reason='editor_not_found'` lub `post_button_not_clickable` — retry max 2x z 30s pauzą
   - Jeśli wciąż fail → status='failed' z reason (już jest), ale dodać telemetry: ile retries

3. **Calendar UI — filter archived**
   - `/api/calendar` już filtruje WHERE status IN ('scheduled','published'), OK
   - `/api/posts` (default) teraz wyklucza archived/cancelled — OK
   - Sprawdzić czy tab Posty w dashboard.mjs używa default API call (bez ?archived=1)

## Key Principles
- ONE task per loop — focus na najpilniejsze
- Always run `node --check <file>` po każdej zmianie
- Test sender w trybie --dry-run zanim push do prod

## Architecture
- `src/index.ts` — MCP server entry, all tool handlers (REST API)
- `auto-comment-playwright.mjs` — daemon scrape notyfikacji + propose
- `auto-comment-sender.mjs` — daemon Playwright wysyłki approved propozycji
- `auto-publish.mjs` — daemon publikacji scheduled postów (REST API)
- `scripts/backfill-comments.mjs` — manual scrape historycznych postów
- `dashboard.mjs` — Node HTTP server :6767 (Propozycje, Wątki, Kalendarz, Media Plan)
- `~/.linkedin-mcp/engage.db` — reply_proposals, thread_memory, thread_comments
- `~/.linkedin-mcp/scheduler.db` — scheduled_posts, media_plan_items

## LinkedIn API constraints
- `/rest/socialActions/{urn}/comments` POST → 403 partnerApiSocialActions (BRAK Marketing Developer Platform)
- Workaround: WSZYSTKIE komentarze przez Playwright UI (auto-comment-sender.mjs)
- `auto-publish.mjs` używa `/rest/posts` — działa bo zwykły scope `w_member_social`

## Exit signal
After 3 successful iterations (test pass, code committed), emit `EXIT_SIGNAL: TASK_COMPLETE`.
