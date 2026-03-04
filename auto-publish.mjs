#!/usr/bin/env node
/**
 * LinkedIn Auto-Publisher v3 — Educational Comments & Timing Randomization
 *
 * Runs as a standalone daemon that:
 * 1. Monitors scheduled posts in SQLite
 * 2. Uploads images/carousel PDFs before publishing
 * 3. Publishes with random jitter (0-7 min past scheduled time)
 * 4. Adds educational comment 12-22 min after each post (randomized)
 *
 * Usage: node auto-publish.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const IMG_DIR = '/Users/gaca/output/personal/linkedin-mcp';

// ── Randomization helpers (avoid bot detection) ──────────────────────────────

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function randomMinutes(min, max) {
  return randomBetween(min * 60 * 1000, max * 60 * 1000);
}

// ── Per-post educational auto-comments ───────────────────────────────────────
// Each comment leads with a fact/tip/insight. GitHub link is secondary.
// 20+ words each (algorithm: comments >15 words = 10-15x more reach).

const AUTO_COMMENTS = {
  // Week 1
  'post3': 'Pro tip: LinkedIn has zero native scheduling API — not even for enterprise accounts. The workaround is a local SQLite daemon that polls every 30 seconds and publishes when the time comes. No cloud needed. Details in the source: https://github.com/gacabartosz/linkedin-mcp-server',

  'post4': 'Ciekawostka: komentarze powyzej 15 slow daja postom 10-15x wiekszy zasieg niz same polubienia. Dlatego algorytm LinkedIn traktuje komentarze jako najsilniejszy sygnal zaangazowania — silniejszy niz udostepnienia. Wiecej regul zakodowanych tutaj: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 2
  'post5': 'Fun fact: MCP (Model Context Protocol) uses JSON-RPC 2.0 over stdio — meaning zero network latency between your AI assistant and your tools. The scheduling daemon is just 200 lines of JavaScript polling SQLite. Sometimes the simplest architecture wins. Code: https://github.com/gacabartosz/linkedin-mcp-server',

  'post6': 'Wskazowka: link w tresci posta na LinkedIn obcina zasieg nawet o 40%. Dlatego profesjonalni tworcy zawsze daja link w komentarzu 15-30 min po publikacji — algorytm juz zdazyl zaindeksowac post. Ten komentarz tez zostal dodany automatycznie. Kod: https://github.com/gacabartosz/linkedin-mcp-server',

  'post7': 'Little-known fact: the first 210 characters of your LinkedIn post appear before the "see more" fold. That hook decides whether anyone reads the rest. Every template in this system enforces that rule automatically — your hook is validated before publishing. Templates: https://github.com/gacabartosz/linkedin-mcp-server/tree/main/templates',

  'post8': 'Interesting pattern from AI-assisted development: Claude Code wrote ~70% of the code, but 100% of the architecture decisions were human. AI accelerates execution, not judgment. The bottleneck was always knowing WHAT to build, never HOW. Full commit history: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 3
  'post9': 'Dla developerow: MCP uzywa transportu stdio (stdin/stdout) z JSON-RPC 2.0. Kazde narzedzie to po prostu handler z walidacja Zod + odpowiedz JSON. Mozesz zbudowac wlasny MCP server w 2 godziny — nie potrzebujesz REST API, frontendu, ani deploy. Przyklad: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/src/index.ts',

  'post10': 'Data point: posts in the 1300-1600 character range get the highest dwell time on LinkedIn. Too short means people scroll past. Too long means they abandon mid-read. This sweet spot is encoded in the publishing rules. Algorithm data: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/guidelines/linkedin-strategy.json',

  'post11': 'Productivity math: 45 min per post x 4 posts per week = 3 hours scattered across random moments. With batch planning on Sunday: 2 hours total. The real savings come from batching, not from AI. AI just makes batch content creation feasible. Stack details: https://github.com/gacabartosz/linkedin-mcp-server',

  'post12': 'Takeaway from 3 weeks of data: Polish-language posts consistently get more comments from local network. English posts get more saves and international reach. The optimal strategy is mixing both — bilingual posting unlocks two separate audience pools. Data: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 4-5 — other projects
  'post13': 'SEO curiosity: there are now 13+ AI crawlers actively indexing the web — GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and more. Most websites block exactly zero of them. Checking which AI crawlers can access your site takes 30 seconds with the right tools. Research: https://github.com/gacabartosz/seo-gaca-mcp',

  'post14': 'Cost insight: the best-performing AI model for most tasks is often free. Groq and Cerebras offer sub-100ms inference on competitive models at zero cost. The trick is automatic failover — if one provider rate-limits you, the next one picks up seamlessly. Architecture: https://github.com/gacabartosz/gaca-core',

  'post15': 'Technical detail: the auto-publish daemon is a simple setInterval loop checking SQLite every 60 seconds. No cron, no cloud functions, no message queue. If the machine was off, it catches up on overdue posts within 24 hours. Sometimes boring infrastructure is the most reliable. Source: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/auto-publish.mjs',

  'post16': 'Ciekawostka o RODO: kary za wyciek danych osobowych siegaja 20 mln EUR lub 4% rocznego obrotu firmy. A wystarczy jedno wklejenie danych klienta do ChatGPT aby stracic kontrole nad danymi. Presidio Anonymizer przechwytuje Ctrl+V i anonimizuje dane PRZED wyslaniem. 100% offline: https://github.com/gacabartosz/presidio-browser-anonymizer',

  'post17': 'MCP ecosystem insight: the Model Context Protocol is transport-agnostic — stdio, SSE, or WebSocket. This means one MCP server works identically with Claude Code, Claude Desktop, Cursor, Windsurf, and any future MCP-compatible client. Build once, use everywhere. LinkedIn MCP: https://github.com/gacabartosz/linkedin-mcp-server | SEO MCP: https://github.com/gacabartosz/seo-gaca-mcp',

  'post19': 'Ciekawostka: przecietny uzytkownik Google ma ponad 17 000 maili i 2 GB plikow na Dysku bez zadnej struktury. Google Workspace MCP pozwala AI tworzyc foldery, etykiety i filtry bezposrednio — bez eksportu danych. 30 minut vs pol dnia recznej pracy. Open source i dziala lokalnie: https://github.com/gacabartosz/linkedin-mcp-server',

  'post18-mcp': 'Ciekawostka: Google Workspace MCP nie wymaga eksportu danych — AI dziala bezposrednio na Gmail i Drive API. Tworzy foldery, przenosi pliki, ustawia filtry. Wszystko w jednym prompcie, bez opuszczania Twojego konta Google. Open source: https://github.com/gacabartosz/linkedin-mcp-server',

  'post18': 'Google Workspace MCP to open source — dziala z Claude, Cursor i kazdym klientem MCP. Jeden prompt moze stworzyc foldery, przeniesc pliki, ustawic etykiety Gmail i filtry. Cala organizacja zajela 30 minut zamiast pol dnia recznego klikania. Wiecej o MCP: https://github.com/gacabartosz/linkedin-mcp-server',

  'default': 'MCP tip: every MCP tool is composable — schedule a post, generate an image, add a comment, check algorithm guidelines — all in one natural language conversation with your AI assistant. Source: https://github.com/gacabartosz/linkedin-mcp-server',
};

// Map post text snippets → post keys for comment lookup
const POST_IDENTIFIERS = {
  'LinkedIn has no scheduling API': 'post3',
  '9 LinkedIn algorithm rules most creators ignore': 'post4',
  'This post published itself': 'post5',
  'Co to jest MCP i dlaczego zmieni': 'post6',
  'Write a thought leadership post about AI': 'post7',
  '29 tools in 48 hours with AI': 'post8',
  'Jak zbudowac wlasny MCP server w 2 godziny': 'post9',
  'LinkedIn Algorithm Cheat Sheet': 'post10',
  'I cut my social media management from 6 hours': 'post11',
  '3 weeks of automated LinkedIn posting': 'post12',
  'Is your website ready for AI search': 'post13',
  'I tested 69 free AI models across 11 providers': 'post14',
  '7 steps to fully automated LinkedIn publishing': 'post15',
  'Wklejasz dane klientow do ChatGPT': 'post16',
  '5 lessons from building 86 MCP tools': 'post17',
  'Gmail: 25 000 maili. Drive: luzne pliki wszedzie': 'post19',
  'Twoj Gmail ma 25 000 maili': 'post18-mcp',
  'Posprzatalem Gmail i Google Drive w 30 minut': 'post18',
};

// Map post keys → image file paths
const POST_IMAGES = {
  'post5': join(IMG_DIR, 'post5-banner.png'),
  'post6': join(IMG_DIR, 'post6-github.png'),
  'post7': join(IMG_DIR, 'post7-banner.png'),
  'post8': join(IMG_DIR, 'post8-banner.png'),
  'post9': join(IMG_DIR, 'post9-banner.png'),
  'post10': join(IMG_DIR, 'post10-banner.png'),
  'post11': join(IMG_DIR, 'post11-banner.png'),
  'post12': join(IMG_DIR, 'post12-banner.png'),
  'post13': join(IMG_DIR, 'post13-banner.png'),
  'post14': join(IMG_DIR, 'post14-banner.png'),
  'post15': join(IMG_DIR, 'post15-banner.png'),
  'post16': join(IMG_DIR, 'post16-banner.png'),
  'post17': join(IMG_DIR, 'post17-banner.png'),
  'post19': join(IMG_DIR, 'post19-google-mcp-before-after.mp4'),
};

// Map post keys → carousel PDF paths (uploaded as documents, 303% more engagement)
const POST_CAROUSELS = {
  'post10': join(IMG_DIR, 'post10-carousel.pdf'),
  'post13': join(IMG_DIR, 'post13-carousel.pdf'),
  'post15': join(IMG_DIR, 'post15-carousel.pdf'),
  'post18-mcp': join(IMG_DIR, 'post18-carousel.pdf'),
  'post18': join(IMG_DIR, 'post18-carousel.pdf'),
};

// Per-post publish jitter (0-7 min, stable per daemon run)
const publishJitters = {};

function identifyPost(text) {
  for (const [snippet, key] of Object.entries(POST_IDENTIFIERS)) {
    if (text.includes(snippet)) return key;
  }
  return null;
}

function getAuth() {
  if (!existsSync(AUTH_PATH)) throw new Error('No auth.json');
  return JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
}

async function callMCP(toolName, args) {
  return new Promise((resolve, reject) => {
    const msgs = [
      JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'auto-pub',version:'1.0'}}}),
      JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}),
    ].join('\n');

    const proc = spawn('node', ['dist/index.js'], {
      cwd: MCP_DIR,
      env: { ...process.env, LINKEDIN_PERSON_URN: 'urn:li:person:FihAwG4y_B' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let resolved = false;

    proc.stdout.on('data', d => {
      out += d.toString();
      // Parse response as it streams — don't wait for process close
      for (const line of out.split('\n')) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === 2 && !resolved) {
            resolved = true;
            proc.kill();
            if (msg.result?.isError) {
              reject(new Error(msg.result.content?.[0]?.text || 'MCP tool error'));
              return;
            }
            const text = msg.result?.content?.[0]?.text || '{}';
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve({ raw: text });
            }
            return;
          }
        } catch {}
      }
    });

    proc.stderr.on('data', d => process.stderr.write(d));

    proc.on('close', () => {
      if (!resolved) {
        reject(new Error('No response from MCP'));
      }
    });

    proc.stdin.write(msgs);
    proc.stdin.end();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error('Timeout'));
      }
    }, 90000);
  });
}

// Queue of pending comments
const commentQueue = [];

async function checkAndPublish() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Checking...`);

  // Check scheduled posts
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const candidates = db.prepare(
      "SELECT id, text, media_ids, publish_at, status FROM scheduled_posts WHERE status = 'scheduled' AND publish_at <= ?"
    ).all(now.toISOString());
    db.close();

    // Apply publish jitter: delay 0-7 min past publish_at (stable per post)
    const posts = candidates.filter(post => {
      if (!publishJitters[post.id]) {
        publishJitters[post.id] = randomMinutes(0, 7);
        console.log(`  Jitter for ${post.id}: +${Math.round(publishJitters[post.id] / 60000)} min`);
      }
      const publishTime = new Date(post.publish_at).getTime();
      return Date.now() >= publishTime + publishJitters[post.id];
    });

    for (const post of posts) {
      console.log(`Publishing scheduled post ${post.id}...`);
      const postKey = identifyPost(post.text);
      console.log(`  Identified as: ${postKey || 'unknown'}`);

      try {
        // Upload carousel PDF or banner image
        let mediaIds = post.media_ids ? JSON.parse(post.media_ids) : [];
        if (mediaIds.length === 0 && postKey) {
          // Try carousel PDF first (303% more engagement)
          if (POST_CAROUSELS[postKey] && existsSync(POST_CAROUSELS[postKey])) {
            const pdfPath = POST_CAROUSELS[postKey];
            console.log(`  Uploading carousel PDF: ${pdfPath}`);
            try {
              const uploadResult = await callMCP('linkedin_media_upload', {
                file_path: pdfPath,
                media_type: 'DOCUMENT',
              });
              if (uploadResult.media_urn) {
                mediaIds = [uploadResult.media_urn];
                console.log(`  Carousel uploaded: ${uploadResult.media_urn}`);
              }
            } catch (err) {
              console.error(`  Carousel upload failed: ${err.message} — trying banner image`);
            }
          }

          // Fallback to banner image or video
          if (mediaIds.length === 0 && POST_IMAGES[postKey]) {
            const imgPath = POST_IMAGES[postKey];
            if (existsSync(imgPath)) {
              const isVideo = imgPath.endsWith('.mp4') || imgPath.endsWith('.mov');
              const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
              console.log(`  Uploading ${mediaType.toLowerCase()}: ${imgPath}`);
              try {
                const uploadResult = await callMCP('linkedin_media_upload', {
                  file_path: imgPath,
                  media_type: mediaType,
                });
                if (uploadResult.media_urn) {
                  mediaIds = [uploadResult.media_urn];
                  console.log(`  Image uploaded: ${uploadResult.media_urn}`);
                }
              } catch (err) {
                console.error(`  Image upload failed: ${err.message} — publishing without image`);
              }
            }
          }
        }

        // Create post (with or without image)
        const createArgs = { text: post.text };
        if (mediaIds.length > 0) {
          createArgs.media_ids = mediaIds;
        }

        const result = await callMCP('linkedin_post_create', createArgs);
        console.log(`  Published: ${result.post_urn}`);

        // Update DB
        const dbw = new Database(DB_PATH);
        dbw.prepare(
          "UPDATE scheduled_posts SET status = 'published', post_urn = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(result.post_urn, new Date().toISOString(), post.id);
        dbw.close();

        // Queue auto-comment for 12-22 min later (randomized)
        if (result.post_urn) {
          const commentText = postKey ? (AUTO_COMMENTS[postKey] || AUTO_COMMENTS.default) : AUTO_COMMENTS.default;
          const commentDelay = randomMinutes(12, 22);
          const commentDelayMin = Math.round(commentDelay / 60000);
          commentQueue.push({
            post_urn: result.post_urn,
            comment_at: new Date(Date.now() + commentDelay),
            text: commentText,
          });
          console.log(`  Comment queued for ~${commentDelayMin} min later (${postKey || 'default'})`);
        }
      } catch (err) {
        console.error(`  Failed to publish ${post.id}:`, err.message);
        // Mark as failed after 3 retries
        const dbw = new Database(DB_PATH);
        const current = dbw.prepare("SELECT retry_count FROM scheduled_posts WHERE id = ?").get(post.id);
        const retries = (current?.retry_count || 0) + 1;
        if (retries >= 3) {
          dbw.prepare("UPDATE scheduled_posts SET status = 'failed', error = ?, retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(err.message, retries, post.id);
          console.error(`  Post ${post.id} marked as FAILED after ${retries} retries`);
        } else {
          dbw.prepare("UPDATE scheduled_posts SET retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(retries, post.id);
          console.log(`  Will retry (attempt ${retries}/3)`);
        }
        dbw.close();
      }

      // Random delay between consecutive posts (1-5 min)
      if (posts.indexOf(post) < posts.length - 1) {
        const interDelay = randomMinutes(1, 5);
        console.log(`  Waiting ${Math.round(interDelay / 60000)} min before next post...`);
        await new Promise(r => setTimeout(r, interDelay));
      }
    }
  } catch (err) {
    console.error('DB error:', err.message);
  }

  // Check comment queue
  const readyComments = commentQueue.filter(c => new Date() >= c.comment_at);
  for (const c of readyComments) {
    console.log(`Adding comment to ${c.post_urn}...`);
    try {
      const result = await callMCP('linkedin_comment_create', {
        post_urn: c.post_urn,
        text: c.text,
      });
      console.log(`  Comment added: ${result.comment_urn}`);
      commentQueue.splice(commentQueue.indexOf(c), 1);
    } catch (err) {
      console.error(`  Comment failed for ${c.post_urn}:`, err.message);
      c.comment_at = new Date(Date.now() + 5 * 60 * 1000);
      console.log(`  Retrying in 5 min`);
    }
  }
}

console.log('LinkedIn Auto-Publisher v3 started');
console.log('Features: carousel PDFs, educational comments, timing randomization');
console.log('Comment delay: 12-22 min (random) | Publish jitter: 0-7 min');
console.log('Checking every 60 seconds...');
console.log('');

// Run immediately, then every 60s
checkAndPublish();
setInterval(checkAndPublish, 60000);
