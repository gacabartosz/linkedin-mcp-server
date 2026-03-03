#!/usr/bin/env node
/**
 * Batch scheduler for LinkedIn posts (Week 2 & 3).
 * Writes directly to SQLite scheduler DB (same as MCP server uses).
 * Images will be uploaded at publish time by updating the daemon.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const IMG_DIR = '/Users/gaca/output/personal/linkedin-mcp';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    visibility TEXT DEFAULT 'PUBLIC',
    media_ids TEXT,
    article_url TEXT,
    article_title TEXT,
    article_description TEXT,
    template_id TEXT,
    template_vars TEXT,
    gemini_prompt TEXT,
    gemini_aspect_ratio TEXT,
    publish_at TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled',
    post_urn TEXT,
    error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    published_at TEXT
  )
`);

const insertStmt = db.prepare(`
  INSERT INTO scheduled_posts (id, text, visibility, publish_at, status)
  VALUES (?, ?, 'PUBLIC', ?, 'scheduled')
`);

// ── Posts to schedule ─────────────────────────────────────────────────────────

const POSTS = [
  {
    id: 5,
    image: `${IMG_DIR}/post5-banner.png`,
    publish_at: '2026-03-10T08:30:00.000Z', // 09:30 CET
    text: `This post published itself. No, really.

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

#MCP #Automation #OpenSource`,
  },
  {
    id: 6,
    image: `${IMG_DIR}/post6-github.png`,
    publish_at: '2026-03-11T07:00:00.000Z', // 08:00 CET
    text: `Opublikowalem jedyny open-source MCP server do LinkedIn z operacjami zapisu.

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

#MCP #OpenSource #LinkedIn`,
  },
  {
    id: 7,
    image: `${IMG_DIR}/post7-banner.png`,
    publish_at: '2026-03-12T08:30:00.000Z', // 09:30 CET
    text: `"Write a thought leadership post about AI automation."

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

#ContentStrategy #MCP #LinkedInGrowth`,
  },
  {
    id: 8,
    image: `${IMG_DIR}/post8-banner.png`,
    publish_at: '2026-03-13T07:00:00.000Z', // 08:00 CET
    text: `48 hours. 25 MCP tools. 1 developer + Claude Code.

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

#BuildInPublic #ClaudeCode #MCP`,
  },
  {
    id: 9,
    image: `${IMG_DIR}/post9-banner.png`,
    publish_at: '2026-03-17T08:30:00.000Z', // 09:30 CET
    text: `MCP (Model Context Protocol) to najwazniejsza zmiana w AI od pojawienia sie ChatGPT.

Dlaczego? Bo AI w koncu moze ROBIC rzeczy, a nie tylko o nich mowic.

Przed MCP: "Napisz mi posta na LinkedIn" → dostajesz tekst → sam wklejasz → sam publikujesz
Po MCP: "Zaplanuj posta na czwartek 9:30 z grafika" → gotowe. Opublikowany. Z komentarzem.

MCP to prosty standard — definujesz narzedzia (tools), AI ich uzywa. Kazdy moze budowac:
→ MCP do LinkedIn (zbudowalem — 25 narzedzi)
→ MCP do Facebooka (tez zbudowalem)
→ MCP do bazy danych, CRM, e-mail, Slacka...

Kto powinien sie tym zainteresowac?
• Developerzy — nowa kategoria narzedzi do budowania
• Marketerzy — automatyzacja social media bez kodu
• Founderzy — wlasne narzedzia AI w godziny zamiast tygodni

Ten post wystawil sie automatycznie przez MCP scheduler. Tak wyglada przyszlosc content managementu.

Chcesz zobaczyc jak dziala? Link w komentarzu.

#MCP #AI #Automatyzacja`,
  },
  {
    id: 10,
    image: `${IMG_DIR}/post10-banner.png`,
    publish_at: '2026-03-18T07:00:00.000Z', // 08:00 CET
    text: `I didn't just read about the LinkedIn algorithm. I coded it into a tool.

Here are the rules my MCP server enforces before publishing any post:

✅ Hook in first 210 characters (before "see more" cutoff)
✅ Post length 1300-1600 chars (sweet spot for dwell time)
✅ Max 3 hashtags, only at the end
✅ Link in comment, never in post body (-40% reach)
✅ CTA as the last line (drives comments = #1 engagement signal)
✅ Post on Tue-Thu at 8:00, 9:30, or 17:00
✅ Minimum 12h gap between posts
✅ Max 1 post per day
✅ First comment with link after 15 minutes

The server has a linkedin_guidelines tool — ask it about any topic (hooks, timing, formats, dos/donts) and it returns the rules. Your AI assistant reads them before writing a single word.

Result? Every post follows best practices by default. Not because you remember the rules — because the tool knows them.

This is the difference between knowing the algorithm and encoding the algorithm.

Which rule surprised you the most?

#LinkedInAlgorithm #MCP #ContentStrategy`,
  },
  {
    id: 11,
    image: `${IMG_DIR}/post11-banner.png`,
    publish_at: '2026-03-19T08:30:00.000Z', // 09:30 CET
    text: `My content management stack as a solo founder:

Claude Code (AI assistant)
+ LinkedIn MCP Server (25 tools)
+ Facebook MCP Server (auto-posts + groups)
+ Auto-publish daemon (background scheduler)
= Zero manual social media work

Here's my actual weekly workflow:

Sunday: Plan 4 posts in one conversation with Claude
→ "Schedule thought leadership post for Tuesday 9:30, behind-the-scenes for Thursday"
→ Claude writes content using built-in templates
→ I review, tweak, approve
→ Claude schedules via linkedin_schedule_create

Monday-Friday: The daemon handles everything
→ Posts publish at optimal times
→ GitHub link added as comment after 15 min
→ I engage with replies during "golden hour" (first 60 min)

Total time: ~2 hours on Sunday. That's it.

Before this system: 45 min per post × 4 posts = 3 hours of scattered work across the week. Now it's batched, automated, and algorithm-optimized.

This post was scheduled on Sunday. Published automatically on Thursday. The comment below was added by the daemon 15 minutes ago.

What does your content workflow look like?

#SoloFounder #AIWorkflow #Productivity`,
  },
  {
    id: 12,
    image: `${IMG_DIR}/post12-banner.png`,
    publish_at: '2026-03-20T07:00:00.000Z', // 08:00 CET
    text: `3 weeks ago I published my first post via linkedin-mcp-server.

Here are the real numbers (no cherry-picking, no vanity metrics):

📊 Posts published: 12
⏱️ Time spent creating content: ~6 hours total (3 Sundays × 2h)
🤖 Posts that published themselves: 12/12

What worked:
→ "This post published itself" — highest engagement (people love meta content)
→ Polish posts get more comments from local network
→ Algorithm tips posts get saved/bookmarked
→ GitHub link in comment gets more clicks than link in post body

The MCP server is still running. Every post scheduled. Every comment automated. The system works.

If you're building something, build in public. The compound effect of consistent posting is real.

What's your experience with posting consistency?

#BuildInPublic #LinkedInGrowth #MCP`,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`Scheduling ${POSTS.length} posts directly to SQLite...\n`);

for (const post of POSTS) {
  const id = randomUUID();
  insertStmt.run(id, post.text, post.publish_at);
  console.log(`Post ${post.id}: scheduled for ${post.publish_at} → DB id: ${id}`);
}

// List all scheduled
console.log('\n=== All Scheduled Posts ===');
const scheduled = db.prepare("SELECT id, substr(text, 1, 80) as preview, publish_at, status FROM scheduled_posts WHERE status = 'scheduled' ORDER BY publish_at ASC").all();
for (const s of scheduled) {
  console.log(`  ${s.publish_at} | ${s.status} | ${s.preview}...`);
}

console.log(`\nTotal scheduled: ${scheduled.length}`);
db.close();
