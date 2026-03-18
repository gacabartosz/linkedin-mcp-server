#!/usr/bin/env node
/**
 * LinkedIn Auto-Engage Daemon v3 — Gemini-powered AI Replies via MCP
 *
 * Uses linkedin_comment_classify + linkedin_comment_reply_generate MCP tools to:
 * 1. Classify comments (reply / like_only / skip_troll / skip_spam)
 * 2. Generate context-aware replies with persona from second-mind
 * 3. Apply socjotechnika (reciprocity, social proof, authority)
 * 4. Handle hate with common sense
 * 5. Adapt language (PL/EN) and reference correct GitHub project
 *
 * No external API keys required — uses GEMINI_API_KEY from MCP server config.
 *
 * Usage: node auto-engage.mjs
 * Interval: every 2 hours, max 10 replies per cycle
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

// ── Config ──────────────────────────────────────────────────────────────────

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const ENGAGE_DB_PATH = join(homedir(), '.linkedin-mcp', 'engage.db');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const PERSON_URN = 'urn:li:person:FihAwG4y_B';

const CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
const MAX_REPLIES_PER_CYCLE = 10;
const MAX_POSTS_TO_MONITOR = 10;
const API_DELAY_MS = 2000;

// ── Persona Loader ──────────────────────────────────────────────────────────

const SECOND_MIND_DIR = '/Users/gaca/projects/personal/second-mind/_system';

let cachedPersona = null;

function loadPersona() {
  if (cachedPersona) return cachedPersona;

  let profile = '';
  let workStyle = '';

  try {
    profile = readFileSync(join(SECOND_MIND_DIR, 'profile.md'), 'utf-8');
  } catch {
    console.warn('  [persona] profile.md not found, using fallback');
    profile = `Bartosz Gaca — Fractional Head of Automation. AI-first, action-oriented.
Builds AI agents, MCP tools, automation workflows. Direct, low formality, ironic under stress.
"Ludzi brak, to zastępuje" — AI as necessity, not hype.`;
  }

  try {
    workStyle = readFileSync(join(SECOND_MIND_DIR, 'work-style.md'), 'utf-8');
  } catch {
    console.warn('  [persona] work-style.md not found, using fallback');
    workStyle = `Short messages, zero preamble. No corporate BS. Typical: "daj znać", "sprawdź repo".
Emoji: 1-2 max. Swearing sparingly. Constructive criticism welcome.`;
  }

  cachedPersona = { profile, workStyle };
  console.log('  [persona] Loaded from second-mind');
  return cachedPersona;
}

// ── Project Mapper ──────────────────────────────────────────────────────────

const PROJECT_MAP = [
  {
    keywords: ['linkedin mcp', 'linkedin-mcp', 'auto-publish', 'auto-engage', '25 tools', '25 narzedzi', '26 tool', '26 narzedzi', 'linkedin tool'],
    repo: 'https://github.com/gacabartosz/linkedin-mcp-server',
    name: 'LinkedIn MCP Server',
  },
  {
    keywords: ['seo', 'seo audit', 'seo-gaca', 'core web vitals', 'lighthouse', '33 tools', '33 narzedzi', 'seo mcp'],
    repo: 'https://github.com/gacabartosz/seo-gaca-mcp',
    name: 'SEO MCP Server',
  },
  {
    keywords: ['g.a.c.a.', 'gaca-core', 'gateway', '69 model', '69+ model', 'openai replacement', 'failover', 'drop-in'],
    repo: 'https://github.com/gacabartosz/gaca-core',
    name: 'G.A.C.A. Gateway',
  },
  {
    keywords: ['presidio', 'anonimizacj', 'pii', 'chatgpt', 'browser anonymizer', 'chrome extension', 'anonymiz'],
    repo: 'https://github.com/gacabartosz/presidio-browser-anonymizer',
    name: 'Presidio Browser Anonymizer',
  },
  {
    keywords: ['second-mind', 'content automat', 'content pipeline', 'mcp ecosystem', 'knowledge management'],
    repo: 'https://github.com/gacabartosz/second-mind',
    name: 'Second Mind',
  },
];

function identifyProject(postText) {
  const lower = (postText || '').toLowerCase();
  for (const project of PROJECT_MAP) {
    if (project.keywords.some(kw => lower.includes(kw))) {
      return project;
    }
  }
  return { repo: 'https://github.com/gacabartosz/linkedin-mcp-server', name: 'LinkedIn MCP Server' };
}

// ── Language Detector ───────────────────────────────────────────────────────

function detectLanguage(text) {
  const hasPL = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/i.test(text) ||
    /\b(jest|nie|jak|ale|czy|bardzo|dzięki|dziękuję|super|świetnie|pozdrawiam|fajn|dobr|robi|piszesz|masz|możesz|narzedzi|zbudowal|klientow)\b/i.test(text);
  return hasPL ? 'pl' : 'en';
}

// ── Comment Classifier (via MCP → Gemini) ──────────────────────────────────

async function classifyComment(commentText, postText, commentAuthor) {
  try {
    return await callMCP('linkedin_comment_classify', {
      comment_text: commentText,
      post_text: postText.substring(0, 400),
      comment_author: commentAuthor,
    });
  } catch (err) {
    console.error(`    [classify] Error: ${err.message}`);
    return { decision: 'like_only', sentiment: 'neutral' };
  }
}

// ── Reply Generator (via MCP → Gemini + socjotechnika) ──────────────────────

async function generateReply(commentText, postText, language, sentiment, project, persona, threadContext) {
  try {
    const result = await callMCP('linkedin_comment_reply_generate', {
      comment_text: commentText,
      post_text: postText.substring(0, 600),
      language,
      sentiment,
      project_name: project.name,
      project_repo: project.repo,
      persona_profile: persona.profile.substring(0, 1200),
      persona_work_style: persona.workStyle.substring(0, 1200),
      thread_context: threadContext || undefined,
    });
    return result.reply || (language === 'pl'
      ? 'Dzięki za komentarz! Daj znać jeśli masz pytania.'
      : 'Thanks! Let me know if you have questions.');
  } catch (err) {
    console.error(`    [reply] Error: ${err.message}`);
    return language === 'pl'
      ? 'Dzięki za komentarz! Daj znać jeśli masz pytania.'
      : 'Thanks! Let me know if you have questions.';
  }
}

// ── Database ────────────────────────────────────────────────────────────────

function initEngageDB() {
  const db = new Database(ENGAGE_DB_PATH);
  db.pragma('journal_mode = WAL');

  // Base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_comments (
      comment_urn TEXT PRIMARY KEY,
      post_urn TEXT NOT NULL,
      action TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engagement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_urn TEXT NOT NULL,
      comment_urn TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engage_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_start TEXT NOT NULL,
      cycle_end TEXT,
      replies_sent INTEGER DEFAULT 0,
      comments_processed INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0
    );
  `);

  // Extend processed_comments with new columns (idempotent)
  const newCols = [
    ['replied_text', 'TEXT'],
    ['comment_text', 'TEXT'],
    ['comment_author', 'TEXT'],
    ['language', 'TEXT'],
    ['sentiment', 'TEXT'],
    ['decision', 'TEXT'],
  ];
  for (const [col, type] of newCols) {
    try { db.exec(`ALTER TABLE processed_comments ADD COLUMN ${col} ${type}`); } catch {}
  }

  db.close();
}

function isProcessed(commentUrn) {
  const db = new Database(ENGAGE_DB_PATH, { readonly: true });
  const row = db.prepare('SELECT 1 FROM processed_comments WHERE comment_urn = ?').get(commentUrn);
  db.close();
  return !!row;
}

function markProcessed(commentUrn, postUrn, decision, meta = {}) {
  const db = new Database(ENGAGE_DB_PATH);
  db.prepare(`INSERT OR IGNORE INTO processed_comments
    (comment_urn, post_urn, action, replied_text, comment_text, comment_author, language, sentiment, decision, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      commentUrn, postUrn, decision,
      meta.replied_text || null,
      meta.comment_text || null,
      meta.comment_author || null,
      meta.language || null,
      meta.sentiment || null,
      decision,
      new Date().toISOString()
    );
  db.prepare('INSERT INTO engagement_log (post_urn, comment_urn, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(postUrn, commentUrn, decision, JSON.stringify(meta), new Date().toISOString());
  db.close();
}

function logCycle(cycleStart, repliesSent, commentsProcessed, errors) {
  const db = new Database(ENGAGE_DB_PATH);
  db.prepare('INSERT INTO engage_cycles (cycle_start, cycle_end, replies_sent, comments_processed, errors) VALUES (?, ?, ?, ?, ?)')
    .run(cycleStart.toISOString(), new Date().toISOString(), repliesSent, commentsProcessed, errors);
  db.close();
}

// ── MCP Caller ──────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callMCP(toolName, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/index.js'], {
      cwd: MCP_DIR,
      env: {
        ...process.env,
        LINKEDIN_PERSON_URN: PERSON_URN,
        LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || '',
        LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let resolved = false;
    let initialized = false;

    function tryParse(buffer) {
      for (const line of buffer.split('\n')) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === 1 && !initialized) {
            initialized = true;
            proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}) + '\n');
            proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}) + '\n');
          }
          if (msg.id === 2 && !resolved) {
            resolved = true;
            proc.kill();
            if (msg.result?.isError) {
              reject(new Error(msg.result.content?.[0]?.text || 'MCP tool error'));
              return;
            }
            const text = msg.result?.content?.[0]?.text || '{}';
            try { resolve(JSON.parse(text)); }
            catch { resolve({ raw: text }); }
            return;
          }
        } catch {}
      }
    }

    proc.stdout.on('data', d => { out += d.toString(); tryParse(out); });
    proc.stderr.on('data', d => { tryParse(d.toString()); });

    proc.on('close', () => {
      if (!resolved) reject(new Error('No response from MCP'));
    });

    // Send initialize first, wait for response before tools/call
    proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'auto-engage',version:'2.0'}}}) + '\n');

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error('Timeout'));
      }
    }, 90000);
  });
}

// ── Main Engagement Loop ────────────────────────────────────────────────────

async function checkAndEngage() {
  const cycleStart = new Date();
  console.log(`\n[${cycleStart.toISOString()}] === Engagement cycle started ===`);

  let repliesSent = 0;
  let commentsProcessed = 0;
  let errors = 0;

  const persona = loadPersona();

  try {
    // Get published posts from scheduler DB
    const db = new Database(DB_PATH, { readonly: true });
    const posts = db.prepare(
      "SELECT id, text, post_urn, published_at FROM scheduled_posts WHERE status = 'published' AND post_urn IS NOT NULL ORDER BY published_at DESC LIMIT ?"
    ).all(MAX_POSTS_TO_MONITOR);
    db.close();

    const validPosts = posts.filter(p => p.post_urn && p.post_urn.length > 10);

    if (validPosts.length === 0) {
      console.log('  No published posts with valid URNs to monitor.');
      logCycle(cycleStart, 0, 0, 0);
      return;
    }

    console.log(`  Monitoring ${validPosts.length} posts...`);

    for (const post of validPosts) {
      if (repliesSent >= MAX_REPLIES_PER_CYCLE) {
        console.log(`  Rate limit reached (${MAX_REPLIES_PER_CYCLE} replies). Stopping.`);
        break;
      }

      try {
        const result = await callMCP('linkedin_comments_list', {
          post_urn: post.post_urn,
          count: 20,
        });

        const comments = result.comments || [];
        if (comments.length === 0) continue;

        const project = identifyProject(post.text);
        const postLanguage = detectLanguage(post.text);

        console.log(`  Post #${post.id} (${project.name}): ${comments.length} comments`);

        for (const comment of comments) {
          if (repliesSent >= MAX_REPLIES_PER_CYCLE) break;

          const commentUrn = comment['$URN'] || comment.urn || comment.id;
          if (!commentUrn) continue;

          // Skip own comments
          const actor = comment.actor || '';
          const actorUrn = typeof actor === 'object' ? (actor?.['~'] || actor?.urn || '') : actor;
          if (actorUrn === PERSON_URN || (typeof actorUrn === 'string' && actorUrn.includes(PERSON_URN))) {
            continue;
          }

          // Skip already processed
          if (isProcessed(commentUrn)) continue;

          commentsProcessed++;
          const commentText = comment.message?.text || comment.text || '';
          const commentAuthor = comment.actor?.name || comment.authorName || 'someone';
          const commentLang = detectLanguage(commentText);

          console.log(`    Comment by ${commentAuthor}: "${commentText.substring(0, 80)}${commentText.length > 80 ? '...' : ''}" (${commentLang})`);

          // Step 1: Classify
          let classification;
          try {
            classification = await classifyComment(commentText, post.text, commentAuthor);
          } catch (err) {
            console.error(`    [classify] Failed: ${err.message}`);
            classification = { decision: 'like_only', sentiment: 'neutral' };
            errors++;
          }

          console.log(`    Decision: ${classification.decision} | Sentiment: ${classification.sentiment}`);

          // Step 2: LIKE (unless troll/spam)
          if (!['skip_troll', 'skip_spam'].includes(classification.decision)) {
            try {
              await callMCP('linkedin_reaction_add', {
                entity_urn: commentUrn,
                reaction_type: 'LIKE',
              });
              console.log(`    -> Liked`);
            } catch (err) {
              console.error(`    -> Like failed: ${err.message}`);
            }
          }

          // Step 3: Reply (only if classified as "reply")
          let repliedText = null;
          if (classification.decision === 'reply') {
            try {
              // Build thread context (previous replies in this comment chain)
              let threadContext = '';
              if (comment.replies && comment.replies.length > 0) {
                threadContext = comment.replies
                  .map(r => `${r.actor?.name || 'Unknown'}: "${r.message?.text || r.text || ''}"`)
                  .join('\n');
              }

              const reply = await generateReply(
                commentText,
                post.text,
                commentLang,
                classification.sentiment,
                project,
                persona,
                threadContext,
              );

              await callMCP('linkedin_comment_create', {
                post_urn: post.post_urn,
                text: reply,
                parent_comment_urn: commentUrn,
              });

              repliedText = reply;
              repliesSent++;
              console.log(`    -> Replied (${repliesSent}/${MAX_REPLIES_PER_CYCLE}): "${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}"`);
            } catch (err) {
              console.error(`    -> Reply failed: ${err.message}`);
              errors++;
            }
          }

          // Step 4: Record
          markProcessed(commentUrn, post.post_urn, classification.decision, {
            replied_text: repliedText,
            comment_text: commentText,
            comment_author: commentAuthor,
            language: commentLang,
            sentiment: classification.sentiment,
          });

          // Rate limit delay between API calls
          await sleep(API_DELAY_MS);
        }
      } catch (err) {
        console.error(`  Error on post #${post.id}: ${err.message}`);
        errors++;
      }
    }
  } catch (err) {
    console.error('Engage error:', err.message);
    errors++;
  }

  logCycle(cycleStart, repliesSent, commentsProcessed, errors);
  console.log(`  === Cycle complete: ${commentsProcessed} processed, ${repliesSent} replies, ${errors} errors ===\n`);
}

// ── Stats ───────────────────────────────────────────────────────────────────

function printStats() {
  try {
    const db = new Database(ENGAGE_DB_PATH, { readonly: true });
    const total = db.prepare('SELECT COUNT(*) as c FROM processed_comments').get();
    const replied = db.prepare("SELECT COUNT(*) as c FROM processed_comments WHERE decision = 'reply'").get();
    const cycles = db.prepare('SELECT COUNT(*) as c FROM engage_cycles').get();
    db.close();
    console.log(`Stats: ${total.c} comments processed, ${replied?.c || 0} AI replies sent, ${cycles?.c || 0} cycles completed`);
  } catch {}
}

// ── Startup ─────────────────────────────────────────────────────────────────

console.log('LinkedIn Auto-Engage v3.0 — Gemini-powered AI Replies (via MCP)');
console.log(`Interval: ${CHECK_INTERVAL / 60000} min | Max replies/cycle: ${MAX_REPLIES_PER_CYCLE}`);
console.log(`Persona: second-mind | Socjotechnika: enabled`);
console.log(`AI: linkedin_comment_classify + linkedin_comment_reply_generate (Gemini Flash)`);
console.log('');

initEngageDB();
loadPersona();
printStats();

// Handle graceful shutdown
process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nShutting down...'); process.exit(0); });
process.on('uncaughtException', err => { console.error('Uncaught:', err.message); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err?.message || err); });

// Run immediately then on interval
checkAndEngage();
setInterval(checkAndEngage, CHECK_INTERVAL);
