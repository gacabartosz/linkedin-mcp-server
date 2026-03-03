#!/usr/bin/env node
/**
 * Schedule posts 13-17 (other projects) directly to SQLite.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const insertStmt = db.prepare(`
  INSERT INTO scheduled_posts (id, text, visibility, publish_at, status)
  VALUES (?, ?, 'PUBLIC', ?, 'scheduled')
`);

const POSTS = [
  {
    id: 13,
    publish_at: '2026-03-24T08:30:00.000Z', // Tue 09:30 CET
    text: `I built an MCP server that runs 33 SEO audits from a single AI conversation.

"Audit sneakerpeeker.pl — technical SEO, schema validation, Core Web Vitals, and generate a PDF report."

One prompt. Four tools. One branded PDF delivered to my desktop.

Meet SEOleo MCP — an open-source SEO analysis server with 33 tools:

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

This post was scheduled and published by linkedin-mcp-server. The SEO audit was run by seoleo-mcp. Both open source.

What would you audit first?

#SEO #MCP #OpenSource`,
  },
  {
    id: 14,
    publish_at: '2026-03-25T07:00:00.000Z', // Wed 08:00 CET
    text: `69 free AI models. 11 providers. One API endpoint.

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

#AI #OpenSource #CostOptimization`,
  },
  {
    id: 15,
    publish_at: '2026-03-26T08:30:00.000Z', // Thu 09:30 CET
    text: `This post was written on Sunday.
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

#MCP #Automation #BuildInPublic`,
  },
  {
    id: 16,
    publish_at: '2026-03-27T07:00:00.000Z', // Fri 08:00 CET
    text: `Wklejasz dane klientow do ChatGPT? Mam cos dla Ciebie.

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

#Privacy #GDPR #AI`,
  },
  {
    id: 17,
    publish_at: '2026-03-31T07:30:00.000Z', // Tue 08:30 CET (next week)
    text: `I now have MCP servers for LinkedIn AND Facebook. Both open source.

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

#MCP #SocialMedia #OpenSource`,
  },
];

console.log(`Scheduling ${POSTS.length} posts...\n`);

for (const post of POSTS) {
  const id = randomUUID();
  insertStmt.run(id, post.text, post.publish_at);
  console.log(`Post ${post.id}: ${post.publish_at} → ${id}`);
}

console.log('\n=== All Scheduled Posts ===');
const scheduled = db.prepare("SELECT publish_at, status, substr(text, 1, 60) as preview FROM scheduled_posts WHERE status = 'scheduled' ORDER BY publish_at ASC").all();
for (const s of scheduled) {
  console.log(`  ${s.publish_at} | ${s.preview}...`);
}
console.log(`\nTotal scheduled: ${scheduled.length}`);
db.close();
