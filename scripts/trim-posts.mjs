#!/usr/bin/env node
/**
 * Trim posts that exceed 1600 chars to fit the 1300-1600 sweet spot.
 * Strategy: keep hook (first 210 chars) + CTA (last 2 lines) intact, trim middle sections.
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const db = new Database(DB_PATH);

const trims = {
  // POST 1: 1730→~1580 — trim scheduling details
  '73fe8e8c': `"Schedule a post for Thursday 9:30 with an AI-generated banner."

That's the entire prompt. And it works. No Hootsuite. No Buffer. No browser tabs.

I built a LinkedIn MCP server that handles everything enterprise tools charge \$300/month for:

Natural language scheduling
Say "post this Monday at 9am" — the MCP daemon stores it in SQLite, waits for the exact time, and publishes. No cron jobs. No cloud functions. A local daemon checking every 30 seconds.

Background reliability
Retries failed posts up to 3 times with 5-minute intervals. If your machine was off during publish time, catches up within 24 hours. Nothing gets lost.

AI images at publish time
Attach a Gemini Imagen prompt to any scheduled post. At publish time, the daemon generates a fresh image and uploads it. Or use the banner generator for professional 1200x627 graphics with CTA bars.

Algorithm awareness
The server knows optimal posting times (Tue-Thu, 8:00/9:30/17:00), enforces max 1 post per day and 12h gaps, validates content against a pre-publish checklist.

12 built-in templates
Thought Leadership, Case Study, Behind the Scenes, Engagement Hook and more. Each has algorithm tips baked into the structure.

LinkedIn offers zero scheduling API. So I built one — SQLite + setInterval + catch-up logic. 200 lines of daemon code that replaced a SaaS subscription.

This post was written Sunday and published automatically. The GitHub link appeared 15 minutes later.

What features would you want in a LinkedIn automation tool?

#MCP #LinkedIn #Automation`,

  // POST 2: 1685→~1580 — trim composability section
  'a7f49e70': `The most powerful signal on LinkedIn isn't likes. It's comments with 15+ words.

I know this because I coded every LinkedIn algorithm rule into a tool. After 3 weeks of data, the comments rule matters most.

Posts with quality comments get 10-15x more reach. The first 60 minutes after posting (the "golden hour") decide everything. If nobody engages in hour one, the algorithm buries your post.

So I built a system that understands this:

Auto-commenting via MCP
The daemon adds your GitHub link as a comment 15 minutes after publishing. Why 15 minutes? Links in the post body cut reach by up to 40%. In a comment, they don't. The 15-minute delay lets organic engagement happen first.

Built-in algorithm knowledge
The server has a linkedin_guidelines tool. Ask about hooks, timing, or engagement rules — it returns the data. Your AI reads these before writing a single word.

Pre-publish validation
Before any post goes live: Hook in first 210 chars? Check. Max 3 hashtags? Check. Link in comment, not body? Check. CTA as last line? Check. Everything validated against best practices.

Brand voice configuration
Set your tone, emoji style, posting schedule, golden hour duration. The AI adapts to YOUR voice. Not generic corporate speak.

The magic of MCP: composability. One conversation — schedule a post, generate an AI banner, add a link as comment, validate against guidelines. Four tools. One prompt.

I went from "I wish I could automate LinkedIn" to 26 working MCP tools in 48 hours.

What's stopping you from building your own MCP tools?

#MCP #LinkedInAlgorithm #ContentStrategy`,

  // POST 3: 1635→~1570 — slight trim
  '6fb0ae7b': `This post published itself. No, really. Zero human intervention between writing and what you're reading now.

I wrote this on Sunday. By the time you see it, it's Tuesday 9:30 AM — the exact time LinkedIn's algorithm gives maximum reach to new content.

Here's what happened between Sunday and now:

Step 1: I opened Claude Code and said "Schedule a post about auto-publishing for Tuesday 9:30"
Step 2: Claude called linkedin_schedule_create with the text and publish_at timestamp
Step 3: The MCP daemon stored it in SQLite and went back to sleep
Step 4: Tuesday 09:30 CET — the daemon woke up, published the post to LinkedIn
Step 5: Tuesday 09:45 CET — the daemon added the GitHub link as a first comment

Five steps. Zero manual. Zero browser tabs. Zero "remind me to post on Tuesday."

The technical stack:

SQLite database stores scheduled posts with status tracking (scheduled/publishing/published/failed). The daemon checks every 30 seconds. Failed posts retry 3 times with 5-minute intervals. If the machine was off, it catches up on overdue posts within 24 hours.

The daemon also generates AI images at publish time (Gemini Imagen 4) or professional banners (Puppeteer-based, 8 gradient themes, CTA bars). Everything happens at the moment of publishing.

26 MCP tools. Open source. MIT license. The entire git history is public.

I built it because LinkedIn has no scheduling API. So I made one. It's been running flawlessly for 3 weeks.

What would you automate if you had 26 LinkedIn tools at your fingertips?

#MCP #Automation #OpenSource`,

  // POST 5: 1785→~1570 — trim template details
  'b9cd9b5a': `"Write a thought leadership post about AI automation."

That prompt alone produces generic garbage every time. But add a template with LinkedIn algorithm rules baked in? Now you're cooking.

I built 12 post templates into my LinkedIn MCP server. Each one knows the rules most people learn the hard way:

Structure enforcement
Every template follows: hook (first 210 chars) then value then expansion then CTA. The AI doesn't remember the formula — the template IS the formula.

Character precision
210 chars before "see more" — your hook lives or dies here. Templates force the hook into the first variable. You fill in the compelling part, the structure handles the rest.

Link discipline
No template puts a link in the post body. The system adds it as a comment 15 minutes after publishing. This single rule preserves 40% of your potential reach.

Hashtag rules
Max 3, always at the end, never scattered through text. Every template has a {{hashtags}} slot at the bottom.

The 12 templates:
Thought Leadership (EN + PL), Case Study, Behind the Scenes, Engagement Hook, Viral Trend, Community Question, Lead Magnet, Carousel Edu, Lesson Learned, Announcement.

Each has {{variables}} — you provide content, the template provides algorithm-optimized structure. Plus tips and examples.

Usage: "Use the thought-leadership template for a post about MCP tools" — Claude fills variables, validates against the checklist, publishes via scheduler.

This post used the case-study template. Scheduled by the daemon. Published automatically.

What template would you add to the collection?

#ContentStrategy #MCP #LinkedIn`,

  // POST 6: 1908→~1590 — significant trim of timeline
  'd47a1c83': `48 hours. 25 MCP tools. 1 developer + Claude Code. Here's the real timeline.

Most "I built X in Y hours" posts skip the ugly parts. This one won't:

Hours 0-4: Foundation
OAuth 2.0 + token refresh + LinkedIn REST API client. 90 minutes debugging LinkedIn's undocumented 401 behavior.

Hours 4-8: Post operations
Create, read, update, delete, repost. LinkedIn uses URNs everywhere — took time to get the format right.

Hours 8-12: Social features
Comments, reactions, media upload. LinkedIn's media upload is a 3-step process. Claude nailed it first try.

Hours 12-20: Scheduler (the hard part)
SQLite database, daemon with 30-second ticks, retry logic (3 attempts), catch-up for missed posts (24h window). No existing library does this for LinkedIn.

Hours 20-28: Content system
12 templates with algorithm intelligence, brand voice config, guidelines loader. Each template knows the 210-char hook rule, 1300-1600 char sweet spot, max 3 hashtags.

Hours 28-36: Image generation
Gemini Imagen 4 integration, professional banner generator (4 templates, 8 gradients, CTA bars), auto-upload at publish time.

Hours 36-48: Polish
Testing, edge cases, documentation, open-source release.

Claude Code wrote ~70% of the code. I guided architecture, fixed edge cases, made product decisions. This is the new developer workflow — AI writes the implementation, you steer the product.

The whole thing is on GitHub. Every commit, every decision documented.

What could you build in 48 hours with AI?

#BuildInPublic #MCP #ClaudeCode`,

  // POST 8: 1815→~1590 — trim algorithm rules detail
  '4cc24467': `I didn't just read about the LinkedIn algorithm. I coded every rule into a tool that enforces them automatically.

Most people learn algorithm rules, nod, then forget half by the time they're writing. I built a system where forgetting is impossible.

Here are the rules my MCP server enforces before publishing:

Hook in first 210 characters
The "see more" cutoff is your make-or-break moment. Templates force the hook into the first 210 chars. If your opening doesn't create curiosity, the algorithm never helps you.

Post length 1300-1600 characters
The dwell time sweet spot. Short posts get scrolled past. Long ones get abandoned. 1300-1600 is where readers finish AND the algorithm rewards reading time.

Max 3 hashtags at the end
More than 3 = spam signal. Mid-text hashtags = worse. The system puts them at the bottom, always.

Link in comment after 15 minutes
Links in post body cut reach by 40%. My daemon adds the link as a comment exactly 15 minutes after publishing. Preserves organic engagement during golden hour.

CTA as the last line
Comments are the #1 engagement signal. A question drives 3-5x more comments than posts without one. Every template ends with a conversation starter.

Posting: Tue-Thu at 8:00, 9:30, or 17:00
Min 12h gap. Max 1 per day. The scheduler enforces this — no accidental double-posts.

The server has a linkedin_guidelines tool — ask about any topic, get the rules. Your AI reads them before writing a word.

This is the difference between knowing the algorithm and encoding it into every post you publish.

Which rule surprised you most?

#LinkedIn #MCP #ContentStrategy`,

  // POST 9: 1878→~1590 — trim workflow details
  'd6b757ae': `2 hours on Sunday. That's my entire social media management for the week. Two platforms. With images.

Here's the content stack I built as a solo founder:

Claude Code + LinkedIn MCP (26 tools) + Facebook MCP (28 tools) + Auto-publish daemon = Zero manual social media work during the week.

My Sunday workflow:

Step 1: Open Claude Code. One conversation.
"Schedule thought leadership for Tuesday 9:30, case study for Wednesday 8:00, behind-the-scenes for Thursday 9:30, community question for Friday."

Step 2: Claude writes content using built-in templates.
Each template has algorithm rules — 210-char hooks, 1300-1600 char length, max 3 hashtags, CTA as last line. I don't think about the rules.

Step 3: I review, tweak, approve.
The only manual step. 10 minutes per post.

Step 4: Claude schedules via linkedin_schedule_create.
Posts go into SQLite. Done. Close the laptop.

Mon-Fri: The daemon handles everything.
Posts publish at optimal times. Professional banners uploaded automatically. GitHub links added as comments 15 min after each post. I only engage during golden hour — responding to comments for 60 minutes after going live.

Before: 45 min per post, 4 posts = 3 hours of scattered work. Context-switching between writing, scheduling, posting, commenting.

Now: batched, automated, algorithm-optimized. The daemon runs 24/7 on my Mac. Retries failed posts. Catches up on missed ones.

What does your content workflow look like?

#SoloFounder #MCP #Productivity`,

  // POST 10: 1985→~1590 — major trim
  '3a86f738': `3 weeks ago I published my first automated post. Here are the real numbers — zero cherry-picking.

Most "results" posts show highlights. This shows everything.

Hard numbers:
Posts published: 12 (all via daemon)
Content creation time: ~6 hours (3 Sundays x 2h)
Auto-published without manual steps: 12/12
Auto-comments delivered on time: 12/12
Failed publishes: 0
Manual LinkedIn logins: 0

What worked:

"This post published itself" — highest engagement. People love meta content about the tool that publishes the posts. Inception-level content marketing.

Polish posts get more comments from my local network. Higher engagement rate per impression for PL. But EN reaches wider.

Algorithm tips posts get saved and bookmarked. "Rules I coded into a tool" resonates because it's not theory — it's a working tool.

Link in comment gets more clicks than link in body. Data confirms the 40% reach penalty for body links.

What I'd change:

Longer posts from the start. First posts were 800-900 chars. After switching to 1300-1600, dwell time improved visibly. The algorithm rewards reading time.

More Polish content. Network is 60% Polish speakers, but 70% of posts were English.

More visual variety. Banners work, but carousels would likely perform better (highest dwell time format).

The system is still running. Every post scheduled. Every comment automated. Compound effect of consistent posting is real — and automation makes consistency trivial.

What's your experience with posting consistency?

#BuildInPublic #LinkedIn #MCP`,

  // POST 12: 1790→~1580 — trim feature details
  '4f9406da': `69 free AI models. 11 providers. One API endpoint. Zero vendor lock-in.

Most companies pick one AI provider and pray it doesn't go down. I built a system that uses all of them and failovers in milliseconds.

G.A.C.A. (Generative AI Cost Arbitrage) — an AI Bus between your app and every major LLM provider. One request in. Best response out.

How it works:
Your app sends an OpenAI-compatible request to G.A.C.A.
G.A.C.A. picks the best model using performance ranking (success rate 40%, latency 30%, quality 30%).
Provider fails? Automatic failover — up to 30 attempts across 11 providers in under 2 seconds.
Your app gets the response. Never knows the difference.

The 11 providers:
Groq, Cerebras, Google AI, OpenRouter, Mistral, HuggingFace, Together AI, Fireworks AI, DeepSeek, Anthropic, OpenAI.

Why "Cost Arbitrage"? Best AI model isn't always most expensive. Free models from Groq or Cerebras often outperform paid ones on speed. G.A.C.A. finds the optimum automatically.

Key features:
Drop-in OpenAI replacement (/v1/chat/completions)
Auto-discovery finds new free models weekly
Admin dashboard (React) for real-time testing
Dynamic ranking — every request updates scores
Rate limit tracking per provider AND per model
SQLite + Prisma (portable, no cloud DB needed)

The ranking is live. Bad models sink. Good models rise. No manual config.

Full source on GitHub. MIT licensed. Already handling production traffic.

What's your AI cost optimization strategy?

#AI #OpenSource #MCP`,

  // POST 13: 1844→~1580 — trim step details
  'c255e6fc': `This post was written on Sunday. Published Thursday 9:30. GitHub link appeared 15 minutes later. No human touched LinkedIn in between.

Most people automate one step. Maybe scheduling. Maybe images. The full pipeline — writing to publishing to commenting — that's the difference between "kinda automated" and "fully autonomous."

Every step that happened automatically:

Sunday evening — I told Claude: "Schedule a post for Thursday 9:30." Claude called linkedin_schedule_create. Post stored in SQLite. Done.

Thursday 09:29:30 — Daemon wakes up (checks every 30 seconds). Finds a due post.

Thursday 09:29:32 — Daemon calls banner generator. Professional 1200x627 banner in 2 seconds (Puppeteer + HTML, 8 gradient themes, CTA bar with branding).

Thursday 09:29:35 — Daemon uploads banner to LinkedIn. Media URN received.

Thursday 09:29:37 — Daemon publishes post with text and banner attached.

Thursday 09:44:37 — Exactly 15 min later, daemon adds GitHub link as first comment. Body links cut reach by 40%.

Six automated steps. Five seconds of execution. Zero manual work.

The daemon runs 24/7 via LaunchAgent. Survives reboots. Catches up within 24h if machine was down. Failed posts retry 3x. Failed comments retry with 5-minute backoff.

This is AI-native content management. Not a SaaS dashboard. A 200-line daemon + 26 MCP tools. Open source. MIT licensed. Every line of code on GitHub.

What would you automate in your workflow?

#MCP #Automation #BuildInPublic`,

  // POST 14: 1875→~1590 — trim PL post
  'a54b9d3f': `Wklejasz dane klientow do ChatGPT? To moze Cie kosztowac firme. Kary RODO siegaja 20 milionow euro.

Presidio Browser Anonymizer v2.0 — rozszerzenie Chrome ktore automatycznie anonimizuje dane osobowe ZANIM trafia do AI.

Jak to dziala:
Kopiujesz tekst z danymi osobowymi (PESEL, NIP, email, telefon)
Wciskasz Ctrl+V w ChatGPT, Claude lub Perplexity
Rozszerzenie przechwytuje wklejanie w tle
Microsoft Presidio wykrywa i zamienia dane na tokeny
AI dostaje zanonimizowany tekst — nigdy nie widzi prawdziwych danych

28 typow danych osobowych:
Polskie: PESEL, NIP, REGON
Kontaktowe: email, telefon, IBAN, numer karty
Personalne: imiona, nazwiska, adresy
Dokumenty: paszport, dowod osobisty, prawo jazdy
Techniczne: IP, URL, daty

100% offline. Wszystko na localhost:4222. Zadne dane nie opuszczaja komputera.

Nowosci v2.0:
Docker support — jeden docker-compose up i masz stack
System pluginow — wlasne wzorce PII (np. numery klientow)
Multi-language — wiele jezykow jednoczesnie
Deanonimizacja — odwracanie tokenow z szyfrowaniem AES
CI/CD pipeline — testy, linting, budowanie
Interfejs web do konfiguracji

Dlaczego to wazne TERAZ? Od kiedy ChatGPT stal sie standardem, ludzie masowo wklejaja dane klientow, umowy, faktury, emaile z danymi. Kazde takie wklejenie to potencjalny incydent bezpieczenstwa.

Ten plugin to Twoja ostatnia linia obrony. Nawet jesli pracownicy uzywaja AI bezmyslnie — dane klientow sa chronione.

Na GitHub. Open source, MIT.

Uzywasz AI w pracy z danymi klientow? Jak je chronisz?

#Privacy #RODO #AI`,

  // POST 15: 1998→~1590 — trim Facebook details
  '1f3d45fc': `MCP servers for LinkedIn AND Facebook. 54 tools. Both open source. One month that changed how I think about content management.

30 days ago I manually logged into LinkedIn, wrote posts, copied links, scheduled in Buffer. Now one AI conversation on Sunday handles my entire week.

LinkedIn MCP Server (26 tools):
Posts — create, edit, delete, repost, get, list
Comments and reactions — full CRUD
Media — upload images/video, generate AI images (Gemini Imagen 4)
Banner generator — professional 1200x627, CTA bars, 4 templates, 8 gradients
Scheduler — SQLite daemon, auto-publish, retry, catch-up
Content — 12 templates, brand voice, algorithm guidelines

Facebook MCP Server (28 tools):
Page posts — create, update, delete, schedule, image posts
Engagement — comments, replies, reaction breakdown
Analytics — impressions, clicks, engaged users, share count
Moderation — hide/unhide, delete, bulk operations, negative filter
DMs and top commenters

Both via MCP — one Claude conversation controls everything.

My Sunday workflow:
"Schedule 4 LinkedIn posts and 3 Facebook posts. Use thought-leadership templates for LinkedIn, engagement hooks for Facebook. Generate banners. Add GitHub links as comments 15 minutes after publishing."

One prompt. The system does the rest all week.

Total: 2 hours/week for 2 platforms with images, auto-comments, algorithm optimization. Before: 6+ hours of scattered manual work.

MCP-powered content management is here. Every platform is just another set of tools.

What platform would you MCP-ify next?

#MCP #OpenSource #ContentStrategy`,
};

const stmt = db.prepare("UPDATE scheduled_posts SET text = ?, updated_at = datetime('now') WHERE id LIKE ? || '%' AND status = 'scheduled'");

let updated = 0;
for (const [prefix, text] of Object.entries(trims)) {
  const result = stmt.run(text, prefix);
  if (result.changes > 0) {
    console.log(`Trimmed ${prefix} → ${text.length} chars`);
    updated++;
  } else {
    console.log(`SKIP ${prefix}`);
  }
}

console.log(`\n${updated} posts trimmed.\n`);

// Final verification
const posts = db.prepare("SELECT id, text, language, text_alt FROM scheduled_posts WHERE status='scheduled' ORDER BY publish_at").all();
let allGood = true;
for (const p of posts) {
  const ok = p.text.length >= 1300 && p.text.length <= 1600;
  if (!ok) allGood = false;
  console.log(`${p.id.substring(0,8)} | ${p.language} | ${p.text.length} chars ${ok ? '✓' : '⚠'} | alt: ${p.text_alt ? p.text_alt.length : '-'}`);
}
console.log(allGood ? '\n✅ All posts in 1300-1600 range!' : '\n⚠ Some posts still outside range');

db.close();
