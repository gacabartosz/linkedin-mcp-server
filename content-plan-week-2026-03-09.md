# LinkedIn Content Plan — Week of March 10, 2026

## Schedule Overview

| Day | Time | Language | Topic | Status |
|-----|------|----------|-------|--------|
| Tue Mar 10 | 09:30 CET | EN | "This Post Published Itself" — meta post | SCHEDULED |
| Wed Mar 11 | 08:00 CET | PL | Open Source LinkedIn MCP — GitHub showcase | SCHEDULED |
| Thu Mar 12 | 09:30 CET | EN | 12 Templates Built Into MCP | SCHEDULED |
| Fri Mar 13 | 08:00 CET | EN | Building MCP Tools in 48h — dev story | SCHEDULED |

---

## Post 5 — Tuesday 10.03, 09:30 CET (EN)

### Topic: "This Post Published Itself"
### Template: behind-the-scenes
### Image: post5-banner.png (terminal daemon log output)

This post published itself. No, really.

I'm writing this on Sunday. By the time you read it, it's Tuesday 9:30 AM — the exact time LinkedIn's algorithm gives maximum reach.

Here's what happened between then and now:

1. I wrote this post in Claude Code using natural language
2. Claude called linkedin_schedule_create with publish_at="2026-03-10T08:30:00Z"
3. The MCP daemon stored it in SQLite
4. At 9:30 CET, the daemon woke up, published it, and added the GitHub link as a comment

Zero manual steps. Zero browser tabs. Zero "remind me to post on Tuesday."

The tool that did this: linkedin-mcp-server — an open-source MCP server with 25 tools for LinkedIn automation. Write, schedule, comment, react, upload images — all from your AI assistant.

I built it because LinkedIn has no scheduling API. So I made one.

What would you automate if you had 25 LinkedIn tools at your fingertips?

#MCP #Automation #OpenSource

### Auto-comment (add after 15 min):
Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler, auto-comments, 12 templates. This post was scheduled and published automatically. MIT licensed.

---

## Post 6 — Wednesday 11.03, 08:00 CET (PL)

### Topic: Open Source LinkedIn MCP na GitHub
### Template: thought-leadership-pl
### Image: post6-github.png (GitHub repo page screenshot)

Opublikowalem jedyny open-source MCP server do LinkedIn z operacjami zapisu.

Co to znaczy? Mozesz powiedziec AI: "zaplanuj post na czwartek 9:30 z grafika" — i on to zrobi. Bez logowania do LinkedIn. Bez Hootsuite. Bez Buffer.

25 narzedzi MCP:
→ Tworzenie i edycja postow
→ Harmonogram z SQLite + daemon
→ Auto-komentarze z linkiem (bo link w poscie obcina zasiegi o 40%)
→ Upload zdjec i wideo
→ 12 szablonow z wbudowana wiedza o algorytmie
→ Konfiguracja brand voice

Caly kod na GitHub. MIT license. Zero oplat.

Dlaczego open source? Bo MCP to nowy standard — im wiecej osob buduje narzedzia, tym silniejszy ekosystem AI. Kazdy moze to wziac, zmodyfikowac, uzyc.

Ten post tez wystawil sie sam — przez harmonogram w linkedin-mcp-server.

Testujesz juz MCP w swoich projektach?

#MCP #OpenSource #LinkedIn

### Auto-comment (add after 15 min):
Kod zrodlowy: https://github.com/gacabartosz/linkedin-mcp-server — 25 narzedzi MCP, harmonogram, auto-komentarze, szablony. Zainstaluj i uzyj z Claude Code lub Claude Desktop.

---

## Post 7 — Thursday 12.03, 09:30 CET (EN)

### Topic: 12 Built-in Templates — Write LinkedIn Posts in Seconds
### Template: case-study
### Image: post7-banner.png (template grid)

"Write a thought leadership post about AI automation."

That prompt alone produces generic garbage. But add a template with LinkedIn algorithm rules baked in? Now you're cooking.

I built 12 post templates into my LinkedIn MCP server. Each one knows:

📋 Exact structure — hook → value → expansion → CTA
📏 Character limits — 210 chars before "see more" (your hook lives or dies here)
🔗 Link rules — never in post body, always in first comment after 15 min
#️⃣ Hashtag rules — max 3, at the end, no mid-text hashtags

The templates:
• Thought Leadership (EN + PL)
• Case Study
• Behind the Scenes
• Engagement Hook
• Viral Trend
• Community Question
• Lead Magnet
• Carousel Edu
• Lesson Learned
• Announcement

Each template has {{variables}} — you fill in your content, the structure handles the algorithm optimization.

Usage: "Use the thought-leadership template for a post about building MCP tools" → Claude fills variables → publishes via MCP.

This post? Written with the case-study template. Scheduled by the MCP daemon. Published automatically.

What template would you add to the list?

#ContentStrategy #MCP #LinkedInGrowth

### Auto-comment (add after 15 min):
All 12 templates included: https://github.com/gacabartosz/linkedin-mcp-server — open source, MIT. Install and use with any MCP-compatible AI assistant.

---

## Post 8 — Friday 13.03, 08:00 CET (EN)

### Topic: I Built This in 48 Hours with Claude Code
### Template: behind-the-scenes
### Image: post8-banner.png (48h dev story)

48 hours. 25 MCP tools. 1 developer + Claude Code.

Here's the real timeline of building linkedin-mcp-server:

Hour 0-4: OAuth flow + token refresh + LinkedIn REST API client
Hour 4-8: Post CRUD — create, read, update, delete, repost
Hour 8-12: Comments + reactions + media upload (images & video)
Hour 12-20: SQLite scheduler — daemon, retry logic, catch-up for missed posts
Hour 20-28: Content system — 12 templates, brand voice config, algorithm guidelines
Hour 28-36: Gemini Imagen integration + auto-publish daemon
Hour 36-48: Testing, edge cases, documentation, GitHub release

The secret? MCP (Model Context Protocol) makes AI tool-building stupidly simple. You define a tool schema, write the handler, and every AI assistant can use it. No REST API to maintain. No frontend. No deploy.

Claude Code wrote ~70% of the code. I guided architecture, fixed edge cases, and made product decisions. This is the new developer workflow.

The whole thing is on GitHub. Every commit. Every decision.

This post was written on Wednesday and scheduled for Friday 8:00 via the MCP scheduler I built in those 48 hours.

What could you build in 48 hours with AI?

#BuildInPublic #ClaudeCode #MCP

### Auto-comment (add after 15 min):
Every commit visible: https://github.com/gacabartosz/linkedin-mcp-server — from zero to 25 working LinkedIn tools in 48h. Open source, MIT licensed.
