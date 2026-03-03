# LinkedIn Content Plan — Weeks of March 24 & 31, 2026

## Schedule Overview

| Day | Time | Language | Topic | Project | Status |
|-----|------|----------|-------|---------|--------|
| Tue Mar 24 | 09:30 CET | EN | SEO GACA MCP — 33 SEO Tools + PDF Report | seo-gaca-mcp | SCHEDULED |
| Wed Mar 25 | 08:00 CET | EN | G.A.C.A. — AI Bus with 69 Free Models | gaca-core | SCHEDULED |
| Thu Mar 26 | 09:30 CET | EN | linkedin-mcp-server — Full Auto Pipeline | linkedin-mcp-server | SCHEDULED |
| Fri Mar 27 | 08:00 CET | PL | Presidio Anonymizer v2.0 — Update | second-mind | SCHEDULED |
| Tue Mar 31 | 08:30 CET | EN | LinkedIn + Facebook MCP — Both Open Source | all MCPs | SCHEDULED |

---

## Post 13 — Tuesday 24.03, 09:30 CET (EN)

### Topic: SEO GACA MCP — 33 SEO Tools in One AI Conversation
### Project: github.com/gacabartosz/seo-gaca-mcp
### Image: post13-banner.png (grid of 12 SEO tool categories)

I built an MCP server that runs 33 SEO audits from a single AI conversation.

"Audit sneakerpeeker.pl — technical SEO, schema validation, Core Web Vitals, and generate a PDF report."

One prompt. Four tools. One branded PDF delivered to my desktop.

Meet SEO GACA MCP — an open-source SEO analysis server with 33 tools:

🔍 Technical SEO — meta tags, crawlability, HTTP headers, robots.txt, sitemap
📝 Content Analysis — readability (Flesch-Kincaid, Gunning Fog), keyword density, E-E-A-T signals
🔗 Link Graph — BFS internal crawl, orphan pages, broken links, PageRank distribution
🔒 Security — full SSL/TLS audit, cipher suites, HSTS, CSP, security headers
♿ Accessibility — WCAG 2.2 Level AA compliance check
🌐 International — hreflang validation with reciprocal link checking
📊 Performance — Lighthouse Core Web Vitals (LCP, CLS, TBT, FCP)
📋 Schema.org — JSON-LD validation + generation from 10 templates
🤖 GEO — AI search optimization based on Princeton research (9 methods, 5 AI platforms)
📄 PDF Reports — branded reports (personal/company/neutral themes)

The GEO module alone tracks 13 AI crawlers (GPTBot, ClaudeBot, PerplexityBot...) and tells you if your site is optimized for AI search results.

All 33 tools work via MCP — meaning Claude Code or Claude Desktop can run full SEO audits autonomously.

This post was scheduled and published by linkedin-mcp-server. The SEO audit was run by seo-gaca-mcp. Both open source.

What would you audit first?

#SEO #MCP #OpenSource

### Auto-comment (add after 15 min):
SEO GACA MCP — 33 SEO tools: https://github.com/gacabartosz/seo-gaca-mcp — technical SEO, GEO (AI search optimization), Core Web Vitals, Schema.org, PDF reports. Open source, MIT. Install: pip install seo-gaca-mcp

---

## Post 14 — Wednesday 25.03, 08:00 CET (EN)

### Topic: G.A.C.A. — AI Bus with 69 Free Models
### Project: github.com/gacabartosz/gaca-core
### Image: post14-banner.png (stack: App → Proxy → 11 Providers → Failover)

69 free AI models. 11 providers. One API endpoint.

I built G.A.C.A. (Generative AI Cost Arbitrage) — an AI Bus that sits between your app and every major LLM provider.

How it works:
1. Your app sends a request to G.A.C.A. (OpenAI-compatible API)
2. G.A.C.A. picks the best available model based on performance ranking
3. If a provider fails → automatic failover (up to 30 attempts across 11 providers)
4. Your app gets the response. Zero downtime. Zero cost.

Providers: Groq, Cerebras, Google AI, OpenRouter, Mistral, HuggingFace, Together AI, Fireworks AI, DeepSeek, Anthropic, OpenAI

The ranking is automatic — success rate (40%), latency (30%), quality (30%). Best model wins.

Key features:
→ Drop-in OpenAI replacement (/v1/chat/completions)
→ Auto-discovery pipeline — finds new free models weekly
→ Admin dashboard (React) for managing providers and testing
→ Rate limit tracking per provider AND per model
→ Cost tracking with USD estimation
→ SQLite + Prisma (portable, file-based)

Why "Cost Arbitrage"? Because the best AI model isn't always the most expensive. Often it's free.

Full source code on GitHub. MIT licensed.

This post was auto-published by linkedin-mcp-server's scheduling daemon.

What's your AI cost optimization strategy?

#AI #OpenSource #CostOptimization

### Auto-comment (add after 15 min):
G.A.C.A. source code: https://github.com/gacabartosz/gaca-core — 69+ free AI models, 11 providers, auto-failover, OpenAI-compatible API. Drop-in replacement. MIT licensed.

---

## Post 15 — Thursday 26.03, 09:30 CET (EN)

### Topic: linkedin-mcp-server — This Post Auto-Published AND Auto-Commented
### Project: github.com/gacabartosz/linkedin-mcp-server
### Image: post15-banner.png (terminal: full auto-publish pipeline)

This post was written on Sunday.
Scheduled on Sunday.
Published on Thursday at exactly 9:30 CET.
The GitHub link below was added automatically 15 minutes after publishing.

No human touched LinkedIn between Sunday and now.

Here's the full pipeline:

1. I open Claude Code and say: "Schedule a post about auto-publishing for Thursday 9:30"
2. Claude uses linkedin_schedule_create → stores in SQLite with publish_at timestamp
3. On Thursday 09:30, the auto-publish daemon wakes up
4. Daemon calls linkedin_media_upload → uploads the banner image
5. Daemon calls linkedin_post_create → publishes with image attached
6. Daemon queues a comment for 15 minutes later
7. At 09:45, daemon calls linkedin_comment_create → adds the GitHub link

7 steps. Zero manual intervention. All MCP.

The daemon runs 24/7 on my Mac. It checks SQLite every 60 seconds. If the server was down, it catches up on overdue posts (up to 24h window).

Failed posts retry 3 times with 5-minute intervals. Failed comments retry indefinitely with 5-minute backoff.

This is what "AI-native content management" actually looks like. Not a fancy SaaS dashboard. A 200-line daemon + 25 MCP tools.

Every line of code is on GitHub. Open source. MIT licensed.

What would you automate next?

#MCP #Automation #BuildInPublic

### Auto-comment (add after 15 min):
Full auto-publish pipeline: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler, image upload, auto-comments. This post AND this comment were both automated. MIT licensed.

---

## Post 16 — Friday 27.03, 08:00 CET (PL)

### Topic: Presidio Browser Anonymizer v2.0 — Aktualizacja
### Project: github.com/gacabartosz/second-mind
### Image: post16-banner.png (checklist: 8 features v2.0)

Wklejasz dane klientow do ChatGPT? Mam cos dla Ciebie.

Presidio Browser Anonymizer v2.0 — rozszerzenie Chrome ktore automatycznie anonimizuje dane osobowe PRZED wklejeniem do AI.

Jak to dziala:
1. Kopiujesz tekst z danymi osobowymi (PESEL, NIP, email, telefon...)
2. Wciskasz Ctrl+V w ChatGPT / Claude / Perplexity
3. Rozszerzenie przechwytuje wklejanie
4. Microsoft Presidio wykrywa i zamienia dane na tokeny
5. AI dostaje zanonimizowany tekst

28 typow danych osobowych:
→ PESEL, NIP, REGON (polskie)
→ Email, telefon, IBAN, numer karty
→ Imiona, nazwiska, adresy
→ Paszport, dowod osobisty
→ IP, URL, daty

Najwazniejsze: 100% offline. Wszystko dziala na localhost:4222. Zadne dane nie opuszczaja Twojego komputera.

Nowosci w v2.0:
→ Docker support
→ System pluginow (wlasne wzorce PII)
→ Multi-language
→ Deanonimizacja (odwracanie tokenow z szyfrowaniem)
→ CI/CD pipeline

Wlasnie zaktualizowalem na GitHub. Open source, MIT.

Ten post wystawil sie automatycznie przez linkedin-mcp-server.

Uzywasz AI w pracy z danymi klientow? Jak je chronisz?

#Privacy #GDPR #AI

### Auto-comment (add after 15 min):
Presidio Browser Anonymizer v2.0: https://github.com/gacabartosz/second-mind — Chrome extension + local backend. 28 PII types, 100% offline, Docker, plugins. MIT licensed.

---

## Post 17 — Tuesday 31.03, 08:30 CET (EN)

### Topic: LinkedIn + Facebook MCP — Both Open Source
### Project: All MCP servers
### Image: post17-banner.png (grid: Facebook MCP 12 features)

I now have MCP servers for LinkedIn AND Facebook. Both open source.

LinkedIn MCP (25 tools):
→ Posts, comments, reactions, media upload
→ SQLite scheduler + auto-publish daemon
→ 12 templates with algorithm intelligence
→ Brand voice config + guidelines

Facebook MCP (28 tools):
→ Page posts, comments, image posts
→ Post insights (impressions, clicks, engagement)
→ Reaction breakdown (like, love, wow, haha, sorry, anger)
→ Comment moderation (hide, delete, bulk operations)
→ DMs, scheduled posts, fan count

Both work through MCP (Model Context Protocol) — one natural language conversation controls everything.

My Sunday workflow:
"Schedule 4 LinkedIn posts for this week and 3 Facebook posts for the page"
→ Claude writes content using templates
→ Schedules on both platforms
→ Auto-publishes throughout the week
→ Adds GitHub links as comments

Total social media management time: 2 hours per week. For two platforms. With images.

The age of MCP-powered content management is here. Every platform can be an MCP tool.

What platform would you MCP-ify next?

#MCP #SocialMedia #OpenSource

### Auto-comment (add after 15 min):
Both MCP servers open source:
LinkedIn: https://github.com/gacabartosz/linkedin-mcp-server (25 tools)
Facebook: https://github.com/gacabartosz/facebook-mcp-server (28 tools)
SEO: https://github.com/gacabartosz/seo-gaca-mcp (33 tools)
