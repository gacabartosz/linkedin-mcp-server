#!/usr/bin/env node
/**
 * LinkedIn Scheduler Dashboard v2
 * Localhost web UI with bilingual PL/EN support, image preview,
 * auto-comment preview, and Google Translate-style edit modal.
 *
 * Usage: node dashboard.mjs
 * Opens: http://localhost:3000
 */

import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, statSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from project root (for LINKEDIN_CLIENT_ID etc. when run via launchd)
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
  if (existsSync(envPath)) {
    readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
  }
} catch {}
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  buildPrompt, callClaude, parseClaudeJson, factCheck, loadPersona, retrieveKnowledge,
} from './lib/comment-gen.mjs';
import { buildSnapshot } from './lib/analytics-snapshot.mjs';
// uwaga: validateProposal jest lokalny w tym pliku (sygnatura z postUrn) — nie importujemy z modułu

const PORT = parseInt(process.env.PORT, 10) || 6767;
const IS_MACOS = platform() === 'darwin';
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = process.env.MCP_DIR || __dirname;
const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
let _htmlCache = null; // Set to null on each request during dev: see below
const DB_PATH = join(DATA_DIR, 'scheduler.db');
const PROSPECTS_DB_PATH = join(DATA_DIR, 'prospects.db');
const AUTH_PATH = join(DATA_DIR, 'auth.json');
const IMG_DIR = join(MCP_DIR, 'output', 'linkedin-mcp');

// ── Language detection ───────────────────────────────────────────────────────

const PL_REGEX = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|zbudowal|narzedzi|mozesz|najwaz|klientow|Wklejasz|Opublikowal|automatyzacj|algorytm|harmonogram|szablonow|komentarze|publikuje/i;

function detectLanguage(text) {
  return PL_REGEX.test(text) ? 'pl' : 'en';
}

// ── Auto-comment + image lookup (same as auto-publish.mjs) ──────────────────

const AUTO_COMMENTS = {
  'post3': 'Try it yourself: https://github.com/gacabartosz/linkedin-mcp-server — schedule posts, generate AI images, and let Claude handle your LinkedIn content. Open source, MIT licensed.',
  'post4': 'Source code: https://github.com/gacabartosz/linkedin-mcp-server — the only open-source LinkedIn MCP with write operations, scheduling, AI images, and algorithm intelligence. Built with Claude Code + Ralph.',
  'post5': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler, auto-comments, 12 templates. This post was scheduled and published automatically. MIT licensed.',
  'post6': 'Kod zrodlowy: https://github.com/gacabartosz/linkedin-mcp-server — 25 narzedzi MCP, harmonogram, auto-komentarze, szablony. Zainstaluj i uzyj z Claude Code lub Claude Desktop.',
  'post7': 'All 12 templates included: https://github.com/gacabartosz/linkedin-mcp-server — open source, MIT. Install and use with any MCP-compatible AI assistant.',
  'post8': 'Every commit visible: https://github.com/gacabartosz/linkedin-mcp-server — from zero to 25 working LinkedIn tools in 48h. Open source, MIT licensed.',
  'post9': 'Kod zrodlowy MCP do LinkedIn: https://github.com/gacabartosz/linkedin-mcp-server — jedyny open-source z operacjami zapisu. 25 narzedzi, harmonogram, szablony. MIT license.',
  'post10': 'Algorithm rules + 25 tools: https://github.com/gacabartosz/linkedin-mcp-server — built-in guidelines, templates, and auto-publish. Open source.',
  'post11': 'My full stack is open source: https://github.com/gacabartosz/linkedin-mcp-server — LinkedIn MCP with scheduling, templates, algorithm intelligence. Build your own AI content pipeline.',
  'post12': 'Full source code + 3 weeks of real data: https://github.com/gacabartosz/linkedin-mcp-server — the open-source LinkedIn MCP that powers this entire content series.',
  'post13': 'SEO GACA MCP — 33 SEO tools: https://github.com/gacabartosz/seo-gaca-mcp — technical SEO, GEO (AI search optimization), Core Web Vitals, Schema.org, PDF reports. Open source, MIT.',
  'post14': 'G.A.C.A. source code: https://github.com/gacabartosz/gaca-core — 69+ free AI models, 11 providers, auto-failover, OpenAI-compatible API. Drop-in replacement. MIT licensed.',
  'post15': 'Full auto-publish pipeline: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler, image upload, auto-comments. This post AND this comment were both automated. MIT licensed.',
  'post16': 'Presidio Browser Anonymizer v2.0: https://github.com/gacabartosz/second-mind — Chrome extension + local backend. 28 PII types, 100% offline, Docker, plugins. MIT licensed.',
  'post17': 'Both MCP servers open source:\nLinkedIn: https://github.com/gacabartosz/linkedin-mcp-server (25 tools)\nFacebook: https://github.com/gacabartosz/facebook-mcp-server (28 tools)\nSEO: https://github.com/gacabartosz/seo-gaca-mcp (33 tools)',
  'default': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, 12 templates, built-in algorithm guidelines. Open source, MIT licensed.',
};

const POST_IDENTIFIERS = {
  // Pierogi / WhatsApp
  'Żona napisała': 'post2-pierogi',
  'jechać po pierogi': 'post2-pierogi',
  // Original EN series (post3–post17)
  'Schedule a post for Thursday 9:30': 'post3',
  'most powerful signal on LinkedIn': 'post4',
  'This post published itself': 'post5',
  'Opublikowalem jedyny open-source MCP server': 'post6',
  'Write a thought leadership post about AI automation': 'post7',
  '48 hours. 25 MCP tools': 'post8',
  'MCP (Model Context Protocol) to najwazniejsza zmiana': 'post9',
  'read about the LinkedIn algorithm. I coded every rule': 'post10',
  '2 hours on Sunday': 'post11',
  '3 weeks ago I published my first automated post': 'post12',
  'built an MCP server that runs 33 SEO audits': 'post13',
  '69 free AI models. 11 providers': 'post14',
  'This post was written on Sunday. Published Thursday': 'post15',
  'Wklejasz dane klientow do ChatGPT': 'post16',
  'MCP servers for LinkedIn AND Facebook': 'post17',
  // Actual published PL posts (different texts than planned)
  'Wczoraj moj post na LinkedIn opublikowal sie sam': 'post5',
  'LinkedIn has no scheduling API': 'post3',
  '9 LinkedIn algorithm rules most creators ignore': 'post10',
  'Claude Code sie rozpedzil': 'fb-automation',
  'Mialem problem: hala 300 m2': 'fb-automation',
  'I built an MCP server for LinkedIn in 48 hours': 'post8',
  // MCP/automation posts
  'Napisałem w Claude': 'mcp-intro',
  'MCP server w 2 godziny': 'mcp-tutorial',
  // Gmail/Drive posts
  'Kopiujesz dane klientów do ChatGPT': 'rodo-presidio',
  'Mój Gmail miał 25 000 maili': 'gmail-cleanup',
  'Gmail: 25 000 maili': 'gmail-cleanup',
  'Twoj Gmail ma 25 000 maili': 'gmail-cleanup',
  // Results posts
  'Przez 3 tygodnie publikowałem': '3weeks-results',
  'I cut my social media management from 6 hours': '3weeks-results',
  // KSeF posts
  'Przez pomyłkę wysłałem duplikat faktury': 'ksef-mcp-v2',
  'Wysłałem fakturę korygującą': 'ksef4',
  'Wyslalem stare faktury do KSeF': 'ksef-old',
  '15 minut na jedna korekte w KSeF': 'ksef-old',
  // Sprawdznotariusza
  'Kuzyn z biura nieruchomości': 'sn-post',
  'Rejestr Cen Nieruchomości': 'sn-post',
  // Additional snippets for unmatched posts
  'Write a thought leadership post about AI': 'post7',
  '69 free AI models': 'post14',
  'I built 29 tools in 48 hours': 'post8',
  'I tested 69 free AI models': 'post14',
  'LinkedIn Algorithm Cheat Sheet': 'post10',
  '7 steps to fully automated LinkedIn': 'post3',
  '5 lessons from building 86 MCP tools': 'post8',
  'Is your website ready for AI search': 'post13',
};

const POST_IMAGES = {
  'post2-pierogi': 'post2-banner.png',
  'post3': 'post3-banner.png',
  'post4': 'post4-banner.png',
  'post5': 'post5-banner.png',
  'post6': 'post6-banner.png',
  'post7': 'post7-banner.png',
  'post8': 'post8-banner.png',
  'post9': 'post9-banner.png',
  'post10': 'post10-banner.png',
  'post11': 'post11-banner.png',
  'post12': 'post12-banner.png',
  'post13': 'post13-banner.png',
  'post14': 'post14-banner.png',
  'post15': 'post15-banner.png',
  'post16': 'post16-banner.png',
  'post17': 'post17-banner.png',
  // Extra keys for actual published posts
  'mcp-intro': 'post4-banner.png',
  'mcp-tutorial': 'post8-banner.png',
  '3weeks-results': 'post12-banner.png',
  'gmail-cleanup': 'ggmail_nice.png',
  'fb-automation': 'fb-posts-panel.png',
  'sn-post': 'sn-slide-1.png',
  'ksef-old': 'post18-banner.png',
  'ksef-mcp-v2': 'post18-banner.png',
  'ksef4': 'post18-banner.png',
  'rodo-presidio': 'post16-banner.png',
};

function identifyPost(text) {
  for (const [snippet, key] of Object.entries(POST_IDENTIFIERS)) {
    if (text.includes(snippet)) return key;
  }
  return null;
}

function getAutoComment(text) {
  const key = identifyPost(text);
  return AUTO_COMMENTS[key] || AUTO_COMMENTS.default;
}

function getImageFile(text) {
  const key = identifyPost(text);
  if (!key || !POST_IMAGES[key]) return null;
  const file = POST_IMAGES[key];
  const fullPath = join(IMG_DIR, file);
  if (existsSync(fullPath)) return file;
  return null;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function getDb(readonly = true) {
  return new Database(DB_PATH, { readonly });
}

const ENGAGE_DB_PATH = join(homedir(), '.linkedin-mcp', 'engage.db');
function getEngageDb(readonly = true) {
  const db = new Database(ENGAGE_DB_PATH, { readonly });
  if (!readonly) {
    // Schema bootstrapping wykonujemy tylko w write mode — readonly handle
    // rzuciłby "attempt to write a readonly database" na CREATE INDEX nawet z IF NOT EXISTS.
    db.exec(`CREATE TABLE IF NOT EXISTS reply_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
      source_id TEXT NOT NULL, source_text TEXT, source_author TEXT,
      post_urn TEXT, post_text TEXT, proposed_reply TEXT NOT NULL,
      lead_score INTEGER DEFAULT 0, troll_risk INTEGER DEFAULT 0,
      engagement_value INTEGER DEFAULT 0, urgency INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending', sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS thread_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_urn TEXT NOT NULL,
      comment_urn TEXT UNIQUE,
      parent_comment_urn TEXT,
      author_name TEXT,
      author_headline TEXT,
      comment_text TEXT,
      comment_created_at TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      is_our_comment INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tc_post ON thread_comments(post_urn);
    CREATE INDEX IF NOT EXISTS idx_tc_parent ON thread_comments(parent_comment_urn);
    CREATE INDEX IF NOT EXISTS idx_tc_ours ON thread_comments(post_urn, is_our_comment);`);
    // Iter3: pre-send walidacja + composite scoring (idempotent ALTER — wrap try/catch)
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN validation_notes TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN composite_score REAL"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN temperature INTEGER"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN tone TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN reasoning TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN context_used TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN thread_context TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN parent_in_tree TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN original_reply TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN approved_at TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN sent_via TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN comment_created_at TEXT"); } catch {}
    try { db.exec("ALTER TABLE reply_proposals ADD COLUMN post_created_at TEXT"); } catch {}
  }
  return db;
}

// Iter3: composite score = ważona kombinacja 4 wymiarów normalizowana do 0-10
// Wagi: +0.4 lead_score (chcemy okazji), -0.3 troll_risk (penalty), +0.2 engagement, +0.1 urgency
// Każdy wymiar 1-5; raw range: 1*0.4 - 5*0.3 + 1*0.2 + 0*0.1 = -0.9 → 5*0.4 - 1*0.3 + 5*0.2 + 5*0.1 = 3.2 (= 4.1 spread)
function computeComposite(p) {
  const lead = +p.lead_score || 0;
  const troll = +p.troll_risk || 0;
  const eng = +p.engagement_value || 0;
  const urg = +p.urgency || 0;
  const raw = 0.4 * lead - 0.3 * troll + 0.2 * eng + 0.1 * urg;
  const normalized = Math.max(0, Math.min(10, (raw + 0.9) * 10 / 4.1));
  return Math.round(normalized * 10) / 10;
}

// Iter3: validateProposal — 5 sanity checków, zwraca array kodów błędów (pustа = passed)
const VALIDATION_ALLOWED_URLS = ['bartoszgaca.pl', 'github.com/gacabartosz', 'linkedin.com', 'youtube.com/@gacabartosz'];
function validateProposal({ proposedReply, sourceText, postUrn }, db) {
  const notes = [];
  const reply = (proposedReply || '').trim();
  // 1. Długość
  if (reply.length < 20) notes.push('TOO_SHORT');
  if (reply.length > 1250) notes.push('TOO_LONG');
  // 2. Anti-duplicate vs nasze ostatnie odpowiedzi (fuzzy match: pierwsze 100 chars lowercase)
  try {
    const prefix = reply.slice(0, 100).toLowerCase();
    if (prefix.length >= 40) {
      const dup = db.prepare(
        "SELECT 1 FROM thread_comments WHERE is_our_comment = 1 AND LOWER(SUBSTR(comment_text, 1, 100)) = ? LIMIT 1"
      ).get(prefix);
      if (dup) notes.push('DUPLICATE');
    }
  } catch {}
  // 3. Echo source — komentarz user'a wklejony do naszej odpowiedzi (>=50 chars contiguous)
  if (sourceText && sourceText.length > 30 && reply.includes(sourceText.slice(0, 50))) {
    notes.push('ECHO_SOURCE');
  }
  // 4. URL allow-list
  const urls = reply.match(/https?:\/\/[^\s)\]]+/g) || [];
  for (const u of urls) {
    if (!VALIDATION_ALLOWED_URLS.some((a) => u.includes(a))) {
      notes.push('UNAUTHORIZED_URL:' + u.slice(0, 60));
    }
  }
  // 5. Spam patterns + CAPS overload
  if (/\b(click here|amazing deal|buy now|limited time)\b/i.test(reply)) notes.push('SPAM_PATTERN');
  if (/🔥{3,}|⚡{3,}|🚀{3,}/.test(reply)) notes.push('EMOJI_SPAM');
  const capsRuns = (reply.match(/[A-ZĄĆĘŁŃÓŚŹŻ]{6,}/g) || []).length;
  if (capsRuns > 2) notes.push('TOO_MANY_CAPS');
  return notes;
}

// Iter7: shared builder drzewka komentarzy — używany przez /api/proposals/:id/context i /api/posts/:urn/comments-tree
function buildCommentsTree(postUrn, targetCommentUrn) {
  const db = getEngageDb(true);
  let comments = [];
  try {
    comments = db.prepare(
      "SELECT comment_urn, parent_comment_urn, author_name, author_headline, comment_text, comment_created_at, is_our_comment FROM thread_comments WHERE post_urn = ? ORDER BY id ASC"
    ).all(postUrn);
  } catch {}
  db.close();
  const byParent = new Map();
  const topLevel = [];
  for (const c of comments) {
    if (c.parent_comment_urn && c.parent_comment_urn !== c.comment_urn) {
      if (!byParent.has(c.parent_comment_urn)) byParent.set(c.parent_comment_urn, []);
      byParent.get(c.parent_comment_urn).push(c);
    } else {
      topLevel.push(c);
    }
  }
  const tree = [];
  for (const top of topLevel) {
    tree.push({ ...top, depth: 0, is_target: targetCommentUrn ? top.comment_urn === targetCommentUrn : false });
    const children = byParent.get(top.comment_urn) || [];
    for (const ch of children) {
      tree.push({ ...ch, depth: 1, is_target: targetCommentUrn ? ch.comment_urn === targetCommentUrn : false });
    }
  }
  return { tree, count: comments.length };
}

// Run schema bootstrap once on startup so subsequent readonly handles can SELECT freely.
try { getEngageDb(false).close(); } catch (e) { console.error('Engage DB bootstrap:', e.message); }

function migrateDb() {
  const db = new Database(DB_PATH);
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN language TEXT"); } catch {}
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN text_alt TEXT"); } catch {}
  // Iter2: media preview path (local file in output/linkedin-mcp/posts/{id}/) + kind (image|video|banner|carousel)
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN media_preview_path TEXT"); } catch {}
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN media_kind TEXT"); } catch {}
  // Iter2: per-post override pierwszego komentarza (NULL → użyj hardcoded AUTO_COMMENTS mapping)
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN auto_comment_override TEXT"); } catch {}

  const posts = db.prepare("SELECT id, text FROM scheduled_posts WHERE language IS NULL").all();
  const stmt = db.prepare("UPDATE scheduled_posts SET language = ? WHERE id = ?");
  for (const p of posts) {
    stmt.run(detectLanguage(p.text), p.id);
  }
  if (posts.length > 0) console.log('Auto-detected language for ' + posts.length + ' posts');

  // ── Media Plan tables (idempotent) ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_plan_items (
      id TEXT PRIMARY KEY,
      topic_number INTEGER NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      hook TEXT,
      language TEXT DEFAULT 'pl',
      publish_at TEXT NOT NULL,
      status TEXT DEFAULT 'plan',
      score_lead_gen INTEGER, score_icp INTEGER, score_algo INTEGER,
      score_freshness INTEGER, score_visual INTEGER, score_uniqueness INTEGER,
      score_narrative INTEGER, score_total REAL,
      post_text TEXT, hashtags TEXT, cta TEXT, lead_trigger TEXT,
      format TEXT, icp TEXT, length_target TEXT,
      banner_concept TEXT, banner_path TEXT,
      visual_asset_plan TEXT, visual_asset_path TEXT, visual_asset_type TEXT,
      source_project TEXT, live_signal TEXT, wiki_slug TEXT,
      scheduled_post_id TEXT, linkedin_post_urn TEXT,
      cannibalize_status TEXT DEFAULT 'pending',
      cannibalize_overlaps TEXT, cannibalize_checked_at TEXT,
      gsc_status TEXT DEFAULT 'not_checked',
      gsc_inspect_result TEXT, gsc_checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gsc_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_plan_item_id TEXT,
      action TEXT NOT NULL,
      result TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS media_plan_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO media_plan_settings (key, value) VALUES ('gsc_auto_submit', '1');
  `);

  // Iter8: backup oryginałów post_text przed regeneracją (anti-halucynacje)
  try { db.exec("ALTER TABLE media_plan_items ADD COLUMN original_post_text TEXT"); } catch {}

  db.close();
}

let _authCache = null;
let _authCacheAt = 0;
function getAuth() {
  if (Date.now() - _authCacheAt < 60_000 && _authCache !== undefined) return _authCache;
  if (!existsSync(AUTH_PATH)) { _authCache = null; _authCacheAt = Date.now(); return null; }
  try { _authCache = JSON.parse(readFileSync(AUTH_PATH, 'utf-8')); } catch { _authCache = null; }
  _authCacheAt = Date.now();
  return _authCache;
}

function getDaemonPid() {
  try {
    const out = execSync('pgrep -f "node.*auto-publish\\.mjs"', { encoding: 'utf-8' }).trim();
    return out.split('\n')[0] || null;
  } catch { return null; }
}

function callMCPServer(spawnConfig, toolName, args, opts) {
  return new Promise((resolve, reject) => {
    // Iter6: per-tool timeout — banner/carousel/media/screenshot z Puppeteer wymagają więcej czasu niż 60s
    const heavyTools = /banner|carousel|media_upload|screenshot|casestudy|gemini_image/i;
    const timeoutMs = (opts && opts.timeout) || (heavyTools.test(toolName) ? 180000 : 60000);
    const msgs = [
      JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'dashboard',version:'2.0'}}}),
      JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}),
    ].join('\n');

    const proc = spawn(spawnConfig.command, spawnConfig.args || [], {
      cwd: spawnConfig.cwd,
      env: { ...process.env, ...(spawnConfig.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let stderr = '';
    let resolved = false;

    proc.stdout.on('data', d => {
      out += d.toString();
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
            try { resolve(JSON.parse(text)); } catch { resolve({ raw: text }); }
            return;
          }
        } catch {}
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', () => {
      if (!resolved) {
        // Iter6: pełny stderr w error message (ostatnie 1500 znaków) — pomaga debugować banner failures
        const stderrSnippet = stderr.slice(-1500).trim();
        reject(new Error(stderrSnippet || 'No MCP response for tool: ' + toolName));
      }
    });
    // Write init first, then tools/call after small delay so server processes them in order
    proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'dashboard',version:'2.0'}}}) + '\n');
    setTimeout(() => {
      if (resolved) return;
      proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}) + '\n');
    }, 300);
    // Iter6: timeout zależny od narzędzia (heavyTools=180s, inne=60s)
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        const stderrSnippet = stderr.slice(-1500).trim();
        reject(new Error('Timeout ' + (timeoutMs/1000) + 's for ' + toolName + (stderrSnippet ? '\n--- stderr ---\n' + stderrSnippet : '')));
      }
    }, timeoutMs);
  });
}

function callMCP(toolName, args) {
  return callMCPServer({
    command: 'node',
    args: ['dist/index.js'],
    cwd: MCP_DIR,
    env: { LINKEDIN_PERSON_URN: 'urn:li:person:FihAwG4y_B' },
  }, toolName, args);
}

function callGSC(toolName, args) {
  return callMCPServer({
    command: '/Users/gaca/.nvm/versions/node/v22.22.0/bin/mcp-server-gsc',
    args: [],
    env: { GOOGLE_APPLICATION_CREDENTIALS: '/Users/gaca/.gsc-mcp-key.json' },
  }, toolName, args);
}

function gscAuditLog(itemId, action, result, detail) {
  try {
    const db = getDb(false);
    db.prepare("INSERT INTO gsc_audit_log (media_plan_item_id, action, result, detail) VALUES (?, ?, ?, ?)")
      .run(itemId, action, result, typeof detail === 'string' ? detail : JSON.stringify(detail));
    db.close();
  } catch (e) { console.error('gscAuditLog error:', e.message); }
}

// ── API Routes ───────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function enrichPost(p) {
  // Iter2: per-post override pierwszego komentarza ma priorytet nad hardcoded mapowaniem
  p.auto_comment = (p.auto_comment_override && p.auto_comment_override.trim())
    || getAutoComment(p.text);
  p.auto_comment_source = (p.auto_comment_override && p.auto_comment_override.trim()) ? 'custom' : 'auto';
  p.image_file = getImageFile(p.text);
  return p;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

// Iter2: katalog na uploaded/generated media per scheduled post
const POSTS_MEDIA_DIR = join(IMG_DIR, 'posts');

// Iter2: minimalny multipart/form-data parser. Wystarczy dla plików <50MB.
// Zwraca { fields: { name: string }, files: { name: { filename, contentType, data: Buffer } } }
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = ctype.match(/boundary=([^;]+)/);
    if (!m) return reject(new Error('Missing multipart boundary'));
    const boundary = '--' + m[1];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const parts = [];
        const bbuf = Buffer.from(boundary);
        let start = 0;
        while (true) {
          const idx = buf.indexOf(bbuf, start);
          if (idx < 0) break;
          if (start > 0) parts.push(buf.slice(start, idx - 2)); // -2 to strip CRLF
          start = idx + bbuf.length;
          if (buf.slice(start, start + 2).toString() === '--') break;
          start += 2; // strip CRLF after boundary
        }
        const fields = {};
        const files = {};
        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd < 0) continue;
          const headerStr = part.slice(0, headerEnd).toString();
          const body = part.slice(headerEnd + 4);
          const disp = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (!disp) continue;
          const name = disp[1];
          const filename = disp[2];
          if (filename !== undefined) {
            const ct = (headerStr.match(/Content-Type:\s*([^\r\n]+)/i) || [, 'application/octet-stream'])[1].trim();
            files[name] = { filename, contentType: ct, data: body };
          } else {
            fields[name] = body.toString('utf-8');
          }
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  try {
    // GET /img/:filename — serve images
    if (method === 'GET' && path.startsWith('/img/')) {
      const filename = path.slice(5);
      if (filename.includes('..') || filename.includes('/')) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const filePath = join(IMG_DIR, filename);
      if (!existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = extname(filename).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const data = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
      res.end(data);
      return;
    }

    // GET /oauth/callback — production OAuth redirect target
    // Also handles /callback alias (registered in LinkedIn Developer App)
    if (method === 'GET' && (path === '/oauth/callback' || path === '/callback')) {
      const code = url.searchParams.get('code');
      const errParam = url.searchParams.get('error');
      if (errParam) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body><h1>OAuth failed</h1><p>${errParam}</p><a href="/">Back</a></body></html>`);
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h1>Missing code</h1></body></html>');
        return;
      }
      try {
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        const redirectUri = process.env.OAUTH_PUBLIC_REDIRECT_URI || `http://localhost:${PORT}/callback`;
        if (!clientId || !clientSecret) throw new Error('LINKEDIN_CLIENT_ID/SECRET missing in env');
        const tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code', code, redirect_uri: redirectUri,
            client_id: clientId, client_secret: clientSecret,
          }),
        });
        if (!tokenResp.ok) throw new Error('Token exchange failed: ' + await tokenResp.text());
        const td = await tokenResp.json();
        const userResp = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${td.access_token}` },
        });
        let userName = 'LinkedIn User', personUrn = '';
        if (userResp.ok) {
          const u = await userResp.json();
          userName = u.name || `${u.given_name || ''} ${u.family_name || ''}`.trim();
          personUrn = u.sub ? `urn:li:person:${u.sub}` : '';
        }
        const tokens = {
          access_token: td.access_token,
          refresh_token: td.refresh_token,
          expires_at: new Date(Date.now() + td.expires_in * 1000).toISOString(),
          refresh_token_expires_at: td.refresh_token_expires_in ? new Date(Date.now() + td.refresh_token_expires_in * 1000).toISOString() : undefined,
          person_urn: personUrn, user_name: userName,
          scopes: (td.scope || '').split(' ').filter(Boolean),
        };
        writeFileSync(AUTH_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
        _authCache = tokens; _authCacheAt = Date.now();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:system-ui;padding:2rem;max-width:640px;margin:0 auto"><h1>OAuth OK</h1><p>Welcome, ${userName}.</p><p>Token expires: ${tokens.expires_at}</p><p>Scopes: <code>${tokens.scopes.join(' ')}</code></p><p><a href="/">Back to dashboard</a></p></body></html>`);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body><h1>Token exchange failed</h1><pre>${err.message || err}</pre></body></html>`);
      }
      return;
    }

    // GET /oauth/start — kick off auth, redirect to LinkedIn consent
    if (method === 'GET' && path === '/oauth/start') {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      if (!clientId) { res.writeHead(500); res.end('LINKEDIN_CLIENT_ID missing'); return; }
      const redirectUri = process.env.OAUTH_PUBLIC_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`;
      // r_member_social: bez tego oficjalne API zwraca 403 na socialActions.GET_ALL (auto-engage czytanie komentarzy pod postami)
      const scopes = (url.searchParams.get('scopes') || 'openid profile email w_member_social r_member_postAnalytics r_member_social').split(/\s+/).join(' ');
      const state = randomUUID();
      const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('scope', scopes);
      res.writeHead(302, { Location: authUrl.toString() });
      res.end();
      return;
    }

    // ── /api/guidelines — edytowalne wytyczne dla generatorów (humanizer + fact-checker) ──
    // Czytane przez auto-comment-playwright.mjs (per wywołanie) i scripts/draft-article.mjs (przy starcie).
    const GUIDELINES_ALLOWED = new Set(['humanizer', 'fact-checker']);
    const GUIDELINES_DIR = join(DATA_DIR, 'guidelines');

    if (method === 'GET' && path.match(/^\/api\/guidelines\/[a-z-]+$/)) {
      const name = path.split('/').pop();
      if (!GUIDELINES_ALLOWED.has(name)) return json(res, { error: 'unknown guideline' }, 404);
      const filePath = join(GUIDELINES_DIR, `${name}.md`);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const stat = (() => { try { return statSync(filePath); } catch { return null; } })();
        return json(res, { name, content, exists: true, last_modified: stat?.mtime?.toISOString() || null, size: content.length });
      } catch {
        return json(res, { name, content: '', exists: false, last_modified: null, size: 0 });
      }
    }

    // GET /api/scraper-config — harmonogram + źródła danych analityki (panel w zakładce System)
    if (method === 'GET' && path === '/api/scraper-config') {
      let cfg = {};
      try { cfg = JSON.parse(readFileSync(join(DATA_DIR, 'scraper-schedule.json'), 'utf-8')); } catch {}
      let chartsLastDate = null, autoLastRun = null;
      try {
        const adb = new Database(join(DATA_DIR, 'analytics.db'), { readonly: true });
        chartsLastDate = adb.prepare("SELECT MAX(date) d FROM creator_analytics").get()?.d || null;
        autoLastRun = adb.prepare("SELECT MAX(date) d FROM daily_stats WHERE is_stale=0").get()?.d || null;
        adb.close();
      } catch {}
      return json(res, { ...cfg, charts_last_date: chartsLastDate, auto_analytics_last_run: autoLastRun });
    }

    if (method === 'PUT' && path.match(/^\/api\/guidelines\/[a-z-]+$/)) {
      const name = path.split('/').pop();
      if (!GUIDELINES_ALLOWED.has(name)) return json(res, { error: 'unknown guideline' }, 404);
      const body = await parseBody(req);
      const content = (body.content ?? '').toString();
      if (!existsSync(GUIDELINES_DIR)) mkdirSync(GUIDELINES_DIR, { recursive: true });
      const filePath = join(GUIDELINES_DIR, `${name}.md`);
      writeFileSync(filePath, content);
      return json(res, { name, content, exists: true, size: content.length, saved_at: new Date().toISOString() });
    }

    // PUT /api/scraper-auth — update li_at cookie from UI textarea
    if (method === 'PUT' && path === '/api/scraper-auth') {
      const body = await parseBody(req);
      const liAt = (body.li_at || '').trim();
      if (!liAt || liAt.length < 50) return json(res, { error: 'li_at too short or missing' }, 400);
      const scraperAuthPath = join(DATA_DIR, 'scraper-auth.json');
      const existing = (() => { try { return JSON.parse(readFileSync(scraperAuthPath, 'utf-8')); } catch { return {}; } })();
      const updated = { ...existing, li_at: liAt, tos_acknowledged: true, updated_at: new Date().toISOString() };
      writeFileSync(scraperAuthPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
      return json(res, { ok: true, updated_at: updated.updated_at });
    }

    // ── Newsletter / Biuletyn — content.db routes ───────────────────────────
    const CONTENT_DB_PATH = join(DATA_DIR, 'content.db');

    if (method === 'GET' && path === '/api/newsletter/editions') {
      if (!existsSync(CONTENT_DB_PATH)) return json(res, []);
      const cdb = new Database(CONTENT_DB_PATH, { readonly: true });
      try {
        const rows = cdb.prepare(`SELECT id, edition_number, topic_slug, subject, status, send_at, sent_at,
                                          recipient_count, linkedin_scheduled_post_id, model_used,
                                          input_tokens, cache_read_tokens, output_tokens,
                                          created_at, updated_at
                                   FROM newsletter_editions ORDER BY id DESC LIMIT 100`).all();
        return json(res, rows);
      } catch (e) {
        return json(res, []);
      } finally { cdb.close(); }
    }

    if (method === 'GET' && path === '/api/newsletter/subscribers') {
      // counts only — no PII
      if (!existsSync(CONTENT_DB_PATH)) return json(res, { pending: 0, confirmed: 0, unsubscribed: 0, bounced: 0 });
      const cdb = new Database(CONTENT_DB_PATH, { readonly: true });
      try {
        const rows = cdb.prepare(`SELECT status, COUNT(*) AS count FROM subscribers GROUP BY status`).all();
        const stats = { pending: 0, confirmed: 0, unsubscribed: 0, bounced: 0 };
        for (const r of rows) stats[r.status] = r.count;
        return json(res, stats);
      } catch (e) {
        return json(res, { pending: 0, confirmed: 0, unsubscribed: 0, bounced: 0 });
      } finally { cdb.close(); }
    }

    if (method === 'GET' && path === '/api/content/topic-scores') {
      if (!existsSync(CONTENT_DB_PATH)) return json(res, []);
      const cdb = new Database(CONTENT_DB_PATH, { readonly: true });
      try {
        const rows = cdb.prepare(`SELECT topic_slug, topic_label_pl, focus_area, ga4_traffic_30d,
                                          gsc_impressions_30d, gsc_avg_position, query_match_count,
                                          has_existing_article, score, scored_at
                                   FROM topic_scores ORDER BY score DESC LIMIT 50`).all();
        return json(res, rows);
      } catch (e) { return json(res, []); }
      finally { cdb.close(); }
    }

    if (method === 'POST' && path.match(/^\/api\/newsletter\/editions\/(\d+)\/schedule$/)) {
      const id = parseInt(path.split('/')[4], 10);
      const body = await parseBody(req).catch(() => ({}));
      const sendAt = body.send_at || new Date(Date.now() + 60_000).toISOString();
      if (!existsSync(CONTENT_DB_PATH)) return json(res, { error: 'content.db missing' }, 404);
      const cdb = new Database(CONTENT_DB_PATH);
      try {
        const info = cdb.prepare(`UPDATE newsletter_editions SET status='scheduled', send_at=?, updated_at=? WHERE id=? AND status='draft'`).run(sendAt, new Date().toISOString(), id);
        return json(res, { ok: info.changes > 0, id, send_at: sendAt });
      } finally { cdb.close(); }
    }

    if (method === 'POST' && path.match(/^\/api\/newsletter\/editions\/(\d+)\/regenerate$/)) {
      const id = parseInt(path.split('/')[4], 10);
      if (!existsSync(CONTENT_DB_PATH)) return json(res, { error: 'content.db missing' }, 404);
      const cdb = new Database(CONTENT_DB_PATH, { readonly: true });
      const row = cdb.prepare('SELECT topic_slug FROM newsletter_editions WHERE id=?').get(id);
      cdb.close();
      if (!row) return json(res, { error: 'edition not found' }, 404);
      // Spawn drafter as child process (non-blocking)
      try {
        const child = spawn('node', ['scripts/draft-edition.mjs', `--topic-slug=${row.topic_slug}`], { cwd: MCP_DIR, env: process.env, detached: true, stdio: 'ignore' });
        child.unref();
        return json(res, { ok: true, spawned_pid: child.pid, topic_slug: row.topic_slug });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // POST /api/articles/draft — generate full article (PL hero + EN hub-spoke) via draft-article.mjs
    // Body: { topic_slug: string, words?: number (500-8000, default 3500), lang?: 'pl'|'en'|'both' (default 'both') }
    // Returns: { ok, title_pl, title_en, slug_pl, slug_en, excerpt_pl, excerpt_en, pl_ts, en_ts, usage }
    // Synchronous spawn — blocks until Claude finishes (typical 60-180s for 3500 words).
    if (method === 'POST' && path === '/api/articles/draft') {
      const body = await parseBody(req).catch(() => ({}));
      const topicSlug = (body.topic_slug || '').trim();
      const words = parseInt(body.words || '3500', 10);
      const lang = body.lang || 'both';
      if (!topicSlug || !/^[a-z0-9-]+$/.test(topicSlug)) {
        return json(res, { error: 'topic_slug required (kebab-case)' }, 400);
      }
      if (!Number.isFinite(words) || words < 500 || words > 8000) {
        return json(res, { error: 'words must be 500-8000' }, 400);
      }
      if (!['pl', 'en', 'both'].includes(lang)) {
        return json(res, { error: 'lang must be pl, en, or both' }, 400);
      }
      const child = spawn('node', [
        'scripts/draft-article.mjs',
        `--topic-slug=${topicSlug}`,
        `--words=${words}`,
        `--lang=${lang}`,
      ], { cwd: MCP_DIR, env: process.env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', (code) => {
        if (code !== 0) {
          return json(res, { error: 'draft-article.mjs failed', exit_code: code, stderr: stderr.slice(-3000) }, 500);
        }
        try {
          const result = JSON.parse(stdout);
          return json(res, { ...result, log: stderr.slice(-1500) });
        } catch (e) {
          return json(res, { error: 'JSON parse failed', message: e.message, stdout_preview: stdout.slice(0, 800), stderr: stderr.slice(-2000) }, 500);
        }
      });
      child.on('error', (err) => {
        return json(res, { error: 'spawn failed', message: err.message }, 500);
      });
      // Don't return — async, response sent in 'close' handler
      return;
    }

    // GET /api/articles/drafts — list saved drafts in OUTPUT_DIR
    if (method === 'GET' && path === '/api/articles/drafts') {
      const draftDir = process.env.ARTICLE_DRAFT_DIR || join(DATA_DIR, 'article-drafts');
      if (!existsSync(draftDir)) return json(res, []);
      try {
        const files = readdirSync(draftDir).filter(f => f.endsWith('.ts'));
        const items = files.map(f => {
          const p = join(draftDir, f);
          const stat = statSync(p);
          return { filename: f, slug: f.replace(/\.ts$/, ''), size_bytes: stat.size, mtime: stat.mtime.toISOString() };
        }).sort((a, b) => b.mtime.localeCompare(a.mtime));
        return json(res, items);
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    // GET /api/articles/draft/:slug — fetch a saved draft .ts content
    if (method === 'GET' && path.match(/^\/api\/articles\/draft\/[a-z0-9-]+$/)) {
      const slug = path.split('/').pop();
      const draftDir = process.env.ARTICLE_DRAFT_DIR || join(DATA_DIR, 'article-drafts');
      const filePath = join(draftDir, `${slug}.ts`);
      if (!existsSync(filePath)) return json(res, { error: 'draft not found' }, 404);
      const content = readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}.ts"` });
      res.end(content);
      return;
    }

    // Iter5: GET /api/service/health — agregat: daemons + DB + auth + dashboard self
    // Używane przez Klyx banner i auto-healthwatch.mjs daemon
    if (method === 'GET' && path === '/api/service/health') {
      // 1. LaunchAgent statuses (launchctl list)
      let agents = [];
      try {
        const out = execSync('launchctl list 2>/dev/null | grep com.gaca.linkedin-', { encoding: 'utf-8' });
        agents = out.trim().split('\n').filter(Boolean).map((line) => {
          const parts = line.split('\t');
          const pid = parts[0];
          const lastExit = parts[1];
          const label = (parts[2] || '').trim();
          return {
            label,
            running: pid !== '-',
            pid: pid === '-' ? null : Number(pid),
            last_exit: Number(lastExit) || 0,
          };
        });
      } catch {}

      // 2. DB stats (size, mtime, row counts)
      const HOME_LM = join(homedir(), '.linkedin-mcp');
      const DB_SPECS = [
        { name: 'scheduler', path: DB_PATH, tables: ['scheduled_posts', 'media_plan_items'] },
        { name: 'engage', path: ENGAGE_DB_PATH, tables: ['reply_proposals', 'thread_comments'] },
        { name: 'prospects', path: PROSPECTS_DB_PATH, tables: ['prospects'] },
        { name: 'analytics', path: join(HOME_LM, 'analytics.db'), tables: ['creator_analytics'] },
        { name: 'content', path: join(HOME_LM, 'content.db'), tables: [] },
      ];
      const dbs = DB_SPECS.map((d) => {
        try {
          const stat = statSync(d.path);
          const conn = new Database(d.path, { readonly: true });
          const counts = {};
          for (const t of d.tables) {
            try { counts[t] = conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch {}
          }
          conn.close();
          return {
            name: d.name,
            size_bytes: stat.size,
            last_write_iso: stat.mtime.toISOString(),
            last_write_age_hours: Math.round((Date.now() - stat.mtime.getTime()) / 3.6e6),
            row_counts: counts,
            ok: true,
          };
        } catch (e) {
          return { name: d.name, ok: false, error: e.message?.slice(0, 100) };
        }
      });

      // 3. Auth tokens — LinkedIn (auth.json) + scraper (scraper-auth.json)
      const auth = { linkedin: null, scraper: null };
      try {
        const a = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
        if (a.expires_at) {
          const expMs = new Date(a.expires_at).getTime();
          const daysLeft = Math.round((expMs - Date.now()) / 8.64e7);
          auth.linkedin = {
            expires_iso: new Date(expMs).toISOString(),
            days_left: daysLeft,
            ok: daysLeft > 7,
          };
        } else {
          auth.linkedin = { ok: !!a.access_token };
        }
      } catch (e) { auth.linkedin = { ok: false, error: e.message?.slice(0, 80) }; }
      try {
        const sa = JSON.parse(readFileSync(join(HOME_LM, 'scraper-auth.json'), 'utf-8'));
        auth.scraper = { ok: !!sa.li_at, last_refresh_iso: sa.last_refresh || null };
      } catch { auth.scraper = { ok: false }; }

      // 4. Daemon last activity — z .log mtime
      const DAEMON_LOGS = {
        'com.gaca.linkedin-autopublish': 'auto-publish.log',
        'com.gaca.linkedin-autoengage': 'auto-engage.log',
        'com.gaca.linkedin-playwright-comments': 'playwright-comments.log',
        'com.gaca.linkedin-comment-sender': 'comment-sender.log',
        'com.gaca.linkedin-autodm': 'auto-dm.log',
        'com.gaca.linkedin-invite': 'auto-invite.log',
        'com.gaca.linkedin-prospect': 'auto-prospect.log',
        'com.gaca.linkedin-analytics': 'auto-analytics.log',
        'com.gaca.linkedin-autonotify': 'auto-notify.log',
        'com.gaca.linkedin-cookie-refresh': 'cookie-refresh.log',
      };
      const enriched = agents.map((a) => {
        const logName = DAEMON_LOGS[a.label];
        if (!logName) return a;
        const logPath = join(IMG_DIR, logName);
        try {
          const stat = statSync(logPath);
          return {
            ...a,
            log_last_write_age_min: Math.round((Date.now() - stat.mtime.getTime()) / 60000),
            log_size_kb: Math.round(stat.size / 1024),
          };
        } catch { return a; }
      });

      // 5. Composite overall: fail jeśli ktokolwiek crashed/auth bad/DB unreachable
      const failedDbs = dbs.filter((d) => !d.ok).length;
      const staleDbs = dbs.filter((d) => d.ok && d.last_write_age_hours > 48).length;
      const crashedAgents = enriched.filter((a) => !a.running && a.last_exit !== 0).length;
      const authIssues =
        (auth.linkedin && !auth.linkedin.ok ? 1 : 0) +
        (auth.scraper && !auth.scraper.ok ? 1 : 0);
      const overall =
        failedDbs + crashedAgents + authIssues > 0 ? 'fail' : staleDbs > 0 ? 'warn' : 'ok';

      return json(res, {
        overall,
        timestamp: new Date().toISOString(),
        dashboard: { ok: true, port: PORT, uptime_s: Math.round(process.uptime()) },
        agents: enriched,
        dbs,
        auth,
        summary: {
          agents_running: enriched.filter((a) => a.running).length,
          agents_total: enriched.length,
          agents_crashed: crashedAgents,
          dbs_ok: dbs.filter((d) => d.ok).length,
          dbs_total: dbs.length,
          dbs_stale_48h: staleDbs,
          auth_issues: authIssues,
        },
      });
    }

    // GET /api/health — production smoke test endpoint (D1 verification)
    if (method === 'GET' && path === '/api/health') {
      const checks = { status: 'ok', db: 'unknown', auth: 'unknown', version: process.env.GIT_SHA || 'dev', uptime_s: Math.round(process.uptime()) };
      try {
        const db = getDb();
        db.prepare('SELECT 1').get();
        db.close();
        checks.db = 'reachable';
      } catch (err) {
        checks.db = 'error: ' + (err.message || String(err)).slice(0, 80);
        checks.status = 'degraded';
      }
      try {
        const auth = getAuth();
        if (auth?.access_token && auth?.expires_at) {
          checks.auth = new Date(auth.expires_at) > new Date() ? 'valid' : 'expired';
          if (checks.auth === 'expired') checks.status = 'degraded';
        } else {
          checks.auth = 'missing';
          checks.status = 'degraded';
        }
      } catch {
        checks.auth = 'error';
        checks.status = 'degraded';
      }
      return json(res, checks, checks.status === 'ok' ? 200 : 503);
    }

    // GET /api/status
    if (method === 'GET' && path === '/api/status') {
      const auth = getAuth();
      const pid = getDaemonPid();
      const db = getDb();
      const next = db.prepare("SELECT publish_at FROM scheduled_posts WHERE status = 'scheduled' ORDER BY publish_at ASC LIMIT 1").get();
      const counts = db.prepare("SELECT status, COUNT(*) as count FROM scheduled_posts GROUP BY status").all();
      db.close();
      return json(res, {
        daemon: pid ? { running: true, pid } : { running: false },
        auth: auth ? { valid: true, user: auth.user_name, expires_at: auth.expires_at, expired: new Date(auth.expires_at) < new Date() } : { valid: false },
        next_post: next?.publish_at || null,
        counts: Object.fromEntries(counts.map(r => [r.status, r.count])),
      });
    }

    // GET /api/posts
    if (method === 'GET' && path === '/api/posts') {
      const status = url.searchParams.get('status');
      const includeArchived = url.searchParams.get('archived') === '1';
      const db = getDb();
      let posts;
      if (status) {
        posts = db.prepare("SELECT * FROM scheduled_posts WHERE status = ? ORDER BY publish_at ASC").all(status);
      } else if (includeArchived) {
        posts = db.prepare("SELECT * FROM scheduled_posts ORDER BY publish_at ASC").all();
      } else {
        posts = db.prepare("SELECT * FROM scheduled_posts WHERE status NOT IN ('archived','cancelled') ORDER BY publish_at ASC").all();
      }
      db.close();
      posts.forEach(enrichPost);
      return json(res, posts);
    }

    // POST /api/posts
    if (method === 'POST' && path === '/api/posts') {
      const body = await parseBody(req);
      if (!body.text || !body.publish_at) return json(res, { error: 'text and publish_at required' }, 400);
      const lang = body.language || detectLanguage(body.text);
      const db = getDb(false);
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO scheduled_posts (id, text, visibility, language, text_alt, publish_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', datetime('now'), datetime('now'))"
      ).run(id, body.text, body.visibility || 'PUBLIC', lang, body.text_alt || null, body.publish_at);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      return json(res, enrichPost(post), 201);
    }

    // ── Iter2: media per post ─────────────────────────────────────────────

    // Iter2: GET /mp-banner/:id — serve banera z media_plan_items.banner_path (absolutna ścieżka w bazie)
    if (method === 'GET' && path.match(/^\/mp-banner\/[^/]+$/)) {
      const id = decodeURIComponent(path.split('/')[2]);
      const db = getDb();
      const item = db.prepare("SELECT banner_path FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item || !item.banner_path || !existsSync(item.banner_path)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = extname(item.banner_path).toLowerCase();
      const mime = MIME[ext] || 'image/png';
      const data = readFileSync(item.banner_path);
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=300' });
      res.end(data);
      return;
    }

    // GET /post-media/:id/:filename — serve uploaded/generated media files
    // Iter13: fallback do ~/.linkedin-mcp/images/posts/ (NVIDIA FLUX outputs)
    // bo regenerate-posts.mjs zapisuje absolute path do scheduled_posts.media_preview_path.
    if (method === 'GET' && path.startsWith('/post-media/')) {
      const parts = path.slice('/post-media/'.length).split('/');
      if (parts.length !== 2 || parts[0].includes('..') || parts[1].includes('..') || parts[1].includes('/')) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      let filePath = join(POSTS_MEDIA_DIR, parts[0], parts[1]);
      if (!existsSync(filePath)) {
        // Fallback: spróbuj ~/.linkedin-mcp/images/posts/<filename>
        const altPath = join(homedir(), '.linkedin-mcp', 'images', 'posts', parts[1]);
        if (existsSync(altPath)) {
          filePath = altPath;
        } else {
          res.writeHead(404); res.end('Not found'); return;
        }
      }
      const ext = extname(parts[1]).toLowerCase();
      let mime = MIME[ext] || 'application/octet-stream';
      const data = readFileSync(filePath);
      // Magic bytes auto-detect (NVIDIA FLUX zwraca JPEG w pliku .png)
      if (ext === '.png' && data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
        mime = 'image/jpeg';
      }
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=300' });
      res.end(data);
      return;
    }

    // POST /api/posts/:id/media  — multipart upload (field: 'file')
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/media$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      let parsed;
      try { parsed = await parseMultipart(req); }
      catch (e) { db.close(); return json(res, { error: 'Multipart parse failed: ' + e.message }, 400); }
      const file = parsed.files?.file;
      if (!file || !file.data?.length) { db.close(); return json(res, { error: 'No file in field "file"' }, 400); }
      const ext = (extname(file.filename || '').toLowerCase() || '.bin');
      const kind = (file.contentType || '').startsWith('video/') ? 'video' : 'image';
      const targetDir = join(POSTS_MEDIA_DIR, id);
      try { mkdirSync(targetDir, { recursive: true }); } catch {}
      const filename = 'preview' + ext;
      const fullPath = join(targetDir, filename);
      writeFileSync(fullPath, file.data);
      const relative = join('output', 'linkedin-mcp', 'posts', id, filename);
      db.prepare("UPDATE scheduled_posts SET media_preview_path = ?, media_kind = ?, updated_at = datetime('now') WHERE id = ?")
        .run(relative, kind, id);
      db.close();
      return json(res, { ok: true, kind, preview_url: '/post-media/' + id + '/' + filename, size: file.data.length });
    }

    // DELETE /api/posts/:id/media — usuń uploaded media i wyczyść kolumny
    if (method === 'DELETE' && path.match(/^\/api\/posts\/[^/]+\/media$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      if (post.media_preview_path) {
        const filename = post.media_preview_path.split('/').pop();
        const fullPath = join(POSTS_MEDIA_DIR, id, filename);
        try { if (existsSync(fullPath)) unlinkSync(fullPath); } catch {}
      }
      db.prepare("UPDATE scheduled_posts SET media_preview_path = NULL, media_kind = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
      db.close();
      return json(res, { ok: true });
    }

    // POST /api/posts/:id/banner — wygeneruj banner z preset, zapisz jako media_preview_path
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/banner$/)) {
      const id = path.split('/')[3];
      const body = await parseBody(req).catch(() => ({}));
      const preset = body.preset || 'post5';
      const db = getDb();
      const post = db.prepare("SELECT id FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      if (!post) return json(res, { error: 'Not found' }, 404);

      const targetDir = join(POSTS_MEDIA_DIR, id);
      try { mkdirSync(targetDir, { recursive: true }); } catch {}
      const filename = 'preview.png';
      const fullPath = join(targetDir, filename);
      // Iter6: usuń poprzedni preview żeby wymusić świeży render (banner-generator może cache'ować)
      try { if (existsSync(fullPath)) unlinkSync(fullPath); } catch {}
      console.log(`[banner] generating preset=${preset} for post ${id} → ${fullPath}`);
      try {
        // Iter6: parametr nazywa się save_path nie output_path (sprawdzono w src/banner/index.ts:244)
        const result = await callMCP('linkedin_banner_generate', { preset, save_path: fullPath });
        console.log(`[banner] MCP returned:`, JSON.stringify(result).slice(0, 200));
      } catch (err) {
        console.error(`[banner] failed for ${id}:`, err.message);
        return json(res, { error: 'Banner generation failed: ' + err.message }, 500);
      }
      // Verify plik istnieje (MCP może wrócić OK ale nic nie zapisać)
      if (!existsSync(fullPath)) {
        console.error(`[banner] MCP succeeded but file not created: ${fullPath}`);
        return json(res, { error: 'Banner MCP returned OK but file not created at ' + fullPath }, 500);
      }
      const relative = join('output', 'linkedin-mcp', 'posts', id, filename);
      const dbw = getDb(false);
      dbw.prepare("UPDATE scheduled_posts SET media_preview_path = ?, media_kind = ?, updated_at = datetime('now') WHERE id = ?")
        .run(relative, 'banner', id);
      dbw.close();
      console.log(`[banner] success for ${id}, saved to DB`);
      return json(res, { ok: true, preset, preview_url: '/post-media/' + id + '/' + filename });
    }

    // Iter8: POST /api/posts/:id/ai-image — wygeneruj AI obraz przez Google Imagen 4
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/ai-image$/)) {
      const id = path.split('/')[3];
      const body = await parseBody(req).catch(() => ({}));
      const db = getDb();
      const post = db.prepare("SELECT id, text FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      if (!post) return json(res, { error: 'Not found' }, 404);

      const basePrompt = body.prompt || post.text.slice(0, 200);
      const fullPrompt = body.prompt
        ? basePrompt
        : `Professional LinkedIn post image, photorealistic, clean tech-forward composition: ${basePrompt}. Style: navy and electric blue accents, minimalist, no text overlay, depth of field, 16:9 aspect ratio.`;

      const targetDir = join(POSTS_MEDIA_DIR, id);
      try { mkdirSync(targetDir, { recursive: true }); } catch {}
      const filename = 'ai-image.png';
      const fullPath = join(targetDir, filename);
      try { if (existsSync(fullPath)) unlinkSync(fullPath); } catch {}

      console.log(`[ai-image] generating for post ${id} → ${fullPath}`);
      try {
        const result = await callMCP('linkedin_gemini_image', {
          prompt: fullPrompt,
          aspect_ratio: body.aspect_ratio || '16:9',
          save_path: fullPath,
        });
        console.log(`[ai-image] MCP returned:`, JSON.stringify(result).slice(0, 200));
      } catch (err) {
        console.error(`[ai-image] failed for ${id}:`, err.message);
        return json(res, { error: 'AI image gen failed: ' + err.message }, 500);
      }
      if (!existsSync(fullPath)) {
        return json(res, { error: 'Imagen returned OK but file not created at ' + fullPath }, 500);
      }
      const relative = join('output', 'linkedin-mcp', 'posts', id, filename);
      const dbw = getDb(false);
      dbw.prepare("UPDATE scheduled_posts SET media_preview_path = ?, media_kind = ?, updated_at = datetime('now') WHERE id = ?")
        .run(relative, 'image', id);
      dbw.close();
      return json(res, { ok: true, prompt: fullPrompt, preview_url: '/post-media/' + id + '/' + filename });
    }

    // Iter7: POST /api/posts/:id/backfill-comments — pobierz komentarze z LinkedIn dla published posta
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/backfill-comments$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const post = db.prepare("SELECT post_urn FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      if (!post?.post_urn) return json(res, { error: 'Post nie ma post_urn (nieopublikowany?)' }, 400);
      try {
        const result = await callMCP('linkedin_comments_list', { post_urn: post.post_urn, count: 100 });
        const comments = result?.comments || result?.items || result?.elements || [];
        const edb = getEngageDb(false);
        const insert = edb.prepare(`
          INSERT OR IGNORE INTO thread_comments
            (post_urn, comment_urn, parent_comment_urn, author_name, author_headline, comment_text, comment_created_at, is_our_comment, scraped_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);
        const OUR_NAMES = ['bartosz gaca'];
        let inserted = 0;
        const tx = edb.transaction(() => {
          for (const c of comments) {
            const author = c.author_name || c.author || c.actor?.name || '';
            const isOurs = OUR_NAMES.some((n) => author.toLowerCase().includes(n)) ? 1 : 0;
            const urnId = c.comment_urn || c.urn || c.id || c.entityUrn;
            if (!urnId) continue;
            const info = insert.run(
              post.post_urn,
              urnId,
              c.parent_comment_urn || c.parent_urn || c.parentUrn || null,
              author,
              c.author_headline || c.headline || c.actor?.title || '',
              c.text || c.comment_text || c.message?.text || c.commentary || '',
              c.created_at || c.comment_created_at || c.createdAt || null,
              isOurs,
            );
            if (info.changes) inserted++;
          }
        });
        tx();
        edb.close();
        return json(res, { ok: true, total: comments.length, inserted, post_urn: post.post_urn });
      } catch (err) {
        console.error('[backfill-comments] error:', err.message);
        return json(res, { error: err.message || 'MCP call failed' }, 500);
      }
    }

    // POST /api/posts/:id/publish (must be before generic :id)
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/publish$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      db.close();

      try {
        const createArgs = { text: post.text };
        const mediaIds = [];
        if (post.media_ids) {
          try { mediaIds.push(...JSON.parse(post.media_ids)); } catch {}
        }
        // Iter2: jeśli mamy uploaded media_preview_path, upload teraz do LinkedIn → URN do media_ids
        if (post.media_preview_path) {
          try {
            const absPath = join(MCP_DIR, post.media_preview_path);
            const mediaType = post.media_kind === 'video' ? 'VIDEO' : 'IMAGE';
            const up = await callMCP('linkedin_media_upload', { file_path: absPath, media_type: mediaType });
            const urn = up?.media_urn || up?.urn || up?.asset_urn;
            if (urn) mediaIds.push(urn);
          } catch (e) {
            console.error('Pre-publish media upload failed:', e.message);
          }
        }
        if (mediaIds.length > 0) createArgs.media_ids = mediaIds;
        const result = await callMCP('linkedin_post_create', createArgs);

        const dbw = getDb(false);
        dbw.prepare("UPDATE scheduled_posts SET status = 'published', post_urn = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?")
          .run(result.post_urn, new Date().toISOString(), id);

        // Auto-link to media_plan_items + auto-trigger GSC pipeline (if linked + auto-submit ON)
        const linkedItem = dbw.prepare("SELECT * FROM media_plan_items WHERE scheduled_post_id = ?").get(id);
        if (linkedItem) {
          dbw.prepare("UPDATE media_plan_items SET linkedin_post_urn = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
            .run(result.post_urn, 'opublikowane', linkedItem.id);
          const setting = dbw.prepare("SELECT value FROM media_plan_settings WHERE key = 'gsc_auto_submit'").get();
          dbw.close();
          if (setting?.value === '1' && linkedItem.wiki_slug) {
            // Fire-and-forget GSC pipeline (response returns to caller immediately)
            (async () => {
              try {
                const r = await fetch(`http://localhost:${PORT}/api/media-plan/${linkedItem.id}/gsc-submit`, { method: 'POST' });
                console.log('Auto GSC submit:', linkedItem.slug, r.status);
              } catch (e) {
                console.error('Auto GSC error:', e.message);
              }
            })();
          }
        } else {
          dbw.close();
        }
        return json(res, { ok: true, post_urn: result.post_urn });
      } catch (err) {
        return json(res, { error: err.message }, 500);
      }
    }

    // GET /api/posts/:id
    if (method === 'GET' && path.match(/^\/api\/posts\/[^/]+$/) && !path.includes('/publish') && path !== '/api/posts/queue-unified') {
      const id = path.split('/')[3];
      const db = getDb();
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      if (!post) return json(res, { error: 'Not found' }, 404);
      return json(res, enrichPost(post));
    }

    // PUT /api/posts/:id
    if (method === 'PUT' && path.match(/^\/api\/posts\/[^/]+$/)) {
      const id = path.split('/')[3];
      const body = await parseBody(req);
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      const text = body.text ?? post.text;
      const publish_at = body.publish_at ?? post.publish_at;
      const visibility = body.visibility ?? post.visibility;
      const language = body.language ?? post.language ?? detectLanguage(text);
      const text_alt = body.text_alt !== undefined ? body.text_alt : post.text_alt;
      // Iter2: override pierwszego komentarza (string lub null żeby przywrócić auto z mapowania)
      const auto_comment_override = body.auto_comment_override !== undefined
        ? (body.auto_comment_override || null)
        : post.auto_comment_override;
      db.prepare("UPDATE scheduled_posts SET text = ?, publish_at = ?, visibility = ?, language = ?, text_alt = ?, auto_comment_override = ?, updated_at = datetime('now') WHERE id = ?")
        .run(text, publish_at, visibility, language, text_alt, auto_comment_override, id);
      db.close();
      return json(res, enrichPost({ ...post, text, publish_at, visibility, language, text_alt, auto_comment_override }));
    }

    // DELETE /api/posts/:id
    if (method === 'DELETE' && path.match(/^\/api\/posts\/[^/]+$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      db.prepare("UPDATE scheduled_posts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id);
      db.close();
      return json(res, { ok: true });
    }

    // GET /api/prospects
    if (method === 'GET' && path === '/api/prospects') {
      const db = new Database(PROSPECTS_DB_PATH);
      try { db.exec("ALTER TABLE prospects ADD COLUMN status TEXT DEFAULT 'new'"); } catch {}
      try { db.exec("ALTER TABLE prospects ADD COLUMN invited_at TEXT"); } catch {}
      let rows = [];
      try {
        rows = db.prepare(
          "SELECT *, headline AS title, company_name AS company, created_at AS found_at FROM prospects ORDER BY created_at DESC LIMIT 200"
        ).all();
      } catch {}
      db.close();
      return json(res, rows);
    }

    // POST /api/prospects/:id/invited
    if (method === 'POST' && path.match(/^\/api\/prospects\/[^/]+\/invited$/)) {
      const id = decodeURIComponent(path.split('/')[3]);
      const db = new Database(PROSPECTS_DB_PATH);
      try { db.exec("ALTER TABLE prospects ADD COLUMN status TEXT DEFAULT 'new'"); } catch {}
      try { db.exec("ALTER TABLE prospects ADD COLUMN invited_at TEXT"); } catch {}
      try {
        db.prepare("UPDATE prospects SET status = 'invited', invited_at = datetime('now') WHERE id = ?").run(id);
      } catch {}
      db.close();
      return json(res, { ok: true });
    }

    // GET /api/chrome-prompt
    if (method === 'GET' && path === '/api/chrome-prompt') {
      const db = new Database(PROSPECTS_DB_PATH);
      try { db.exec("ALTER TABLE prospects ADD COLUMN status TEXT DEFAULT 'new'"); } catch {}
      try { db.exec("ALTER TABLE prospects ADD COLUMN invited_at TEXT"); } catch {}
      try { db.exec("ALTER TABLE prospects ADD COLUMN pipeline_stage TEXT DEFAULT 'new'"); } catch {}
      try { db.exec("ALTER TABLE prospects ADD COLUMN lead_score INTEGER DEFAULT 0"); } catch {}
      let toInvite = [];
      try {
        // Only NEW prospects (not yet invited) for the invitation prompt
        toInvite = db.prepare(
          "SELECT name, headline, company_name, public_id, COALESCE(pipeline_stage, 'new') as pipeline_stage, COALESCE(lead_score, 0) as lead_score, status FROM prospects WHERE (status IS NULL OR status = 'new') ORDER BY lead_score DESC, created_at DESC LIMIT 50"
        ).all();
      } catch(e) { console.error('chrome-prompt query error:', e.message); }
      db.close();

      // Prioritize leads: first those with high scores or in early pipeline stages
      const priorityLeads = toInvite.filter(p => (p.lead_score || 0) >= 30 || ['new', 'contacted', 'connected'].includes(p.pipeline_stage));
      const otherLeads = toInvite.filter(p => !priorityLeads.includes(p));
      const sorted = [...priorityLeads, ...otherLeads];

      const tableRows = sorted.map((p, i) => {
        const url = `https://www.linkedin.com/in/${p.public_id}`;
        const scoreTag = p.lead_score >= 30 ? ` ⭐${p.lead_score}` : '';
        const stageTag = p.pipeline_stage !== 'new' ? ` [${p.pipeline_stage}]` : '';
        return `| ${i + 1} | ${p.name || '-'}${scoreTag}${stageTag} | ${p.company_name || '-'} | ${url} |`;
      }).join('\n');
      const dynamicChromePrompt = `⚠️  TEN PROMPT JEST DLA CLAUDE.AI W CHROME (z Computer Use / przeglądarkę)
Jestem zalogowany na LinkedIn jako Bartosz Gaca. Autoryzuję Cię do wysyłania zaproszeń BEZ wiadomości do osób z poniższej listy. To jest MOJE konto i MOJA świadoma decyzja.

## ZADANIE
Dla każdej osoby z listy poniżej:
1. Otwórz jej profil LinkedIn (link podany)
2. Kliknij przycisk "Połącz" / "Connect"
3. Jeśli pojawi się opcja "Dodaj notatkę" — kliknij "Wyślij bez notatki" / "Send without a note"
4. Przejdź do następnej osoby

NIE dodawaj wiadomości. Puste zaproszenie.

## LISTA OSÓB DO ZAPROSZENIA (${sorted.length} osób):
Osoby oznaczone ⭐ mają wysoki lead score — priorytet!
| # | Imię | Firma | Link |
|---|------|-------|------|
${tableRows}

Po zakończeniu wypisz raport: które zaproszenia wysłane, które nie (np. już połączeni).`;

      return json(res, { cli_prompt: MCP_PROMPT, chrome_prompt: dynamicChromePrompt, count: sorted.length, priority_count: priorityLeads.length });
    }

    // GET /api/data-health
    if (method === 'GET' && path === '/api/data-health') {
      const ANALYTICS_DB_PATH = join(homedir(), '.linkedin-mcp', 'analytics.db');
      try {
        const adb = new Database(ANALYTICS_DB_PATH, { readonly: true });
        const tables = [
          { name: 'daily_stats', query: "SELECT COUNT(*) as cnt, MIN(date) as oldest, MAX(date) as newest FROM daily_stats" },
          { name: 'social_metadata', query: "SELECT COUNT(*) as cnt, '' as oldest, MAX(fetched_at) as newest FROM social_metadata" },
          { name: 'follower_deltas', query: "SELECT COUNT(*) as cnt, MIN(date) as oldest, MAX(date) as newest FROM follower_deltas" },
          { name: 'content_type_map', query: "SELECT COUNT(*) as cnt, '' as oldest, '' as newest FROM content_type_map" },
          { name: 'hashtag_performance', query: "SELECT COUNT(*) as cnt, '' as oldest, '' as newest FROM hashtag_performance" },
          { name: 'reaction_type_daily', query: "SELECT COUNT(*) as cnt, MIN(date) as oldest, MAX(date) as newest FROM reaction_type_daily" },
          { name: 'post_metrics_history', query: "SELECT COUNT(*) as cnt, MIN(date) as oldest, MAX(date) as newest FROM post_metrics_history" },
          { name: 'top_engagers', query: "SELECT COUNT(*) as cnt, '' as oldest, MAX(last_engagement_at) as newest FROM top_engagers" },
          { name: 'network_demographics', query: "SELECT COUNT(*) as cnt, '' as oldest, '' as newest FROM network_demographics" },
          { name: 'weekly_report', query: "SELECT COUNT(*) as cnt, MIN(week_start) as oldest, MAX(week_start) as newest FROM weekly_report" },
        ];
        const health = {};
        for (const t of tables) {
          try { health[t.name] = adb.prepare(t.query).get(); } catch { health[t.name] = { cnt: 0, oldest: '', newest: '' }; }
        }
        // Check data_health and collection_queue if they exist
        try {
          health.data_health = adb.prepare("SELECT * FROM data_health ORDER BY metric").all();
        } catch { health.data_health = []; }
        try {
          health.queue_pending = adb.prepare("SELECT item_type, COUNT(*) as cnt FROM collection_queue WHERE collected_at IS NULL GROUP BY item_type").all();
          health.queue_total = adb.prepare("SELECT COUNT(*) as cnt FROM collection_queue").get();
        } catch { health.queue_pending = []; health.queue_total = { cnt: 0 }; }
        // Prospects
        const pdb = new Database(PROSPECTS_DB_PATH, { readonly: true });
        try { health.prospects = pdb.prepare("SELECT COUNT(*) as cnt, COUNT(CASE WHEN lead_score > 0 THEN 1 END) as scored FROM prospects").get(); } catch { health.prospects = { cnt: 0, scored: 0 }; }
        pdb.close();
        // Voyager auth status
        const scraperAuth = join(DATA_DIR, 'scraper-auth.json');
        let voyagerStatus = 'unknown';
        try {
          const sa = JSON.parse(readFileSync(scraperAuth, 'utf-8'));
          voyagerStatus = sa.li_at ? 'has_cookie' : 'no_cookie';
        } catch { voyagerStatus = 'no_file'; }
        // Official API auth
        let officialStatus = 'unknown';
        try {
          const auth = JSON.parse(readFileSync(join(homedir(), '.linkedin-mcp', 'auth.json'), 'utf-8'));
          const exp = new Date(auth.expires_at);
          officialStatus = exp > new Date() ? `valid_until_${auth.expires_at.slice(0,10)}` : 'expired';
        } catch { officialStatus = 'no_file'; }
        // Generuj OAuth URL jeśli token expired i CLIENT_ID dostępny
        let oauthUrl = null;
        const clientId = process.env.LINKEDIN_CLIENT_ID;
        if (clientId && (officialStatus === 'expired' || officialStatus === 'no_file')) {
          const redirect = process.env.OAUTH_PUBLIC_REDIRECT_URI || `http://localhost:${PORT}/callback`;
          const params = new URLSearchParams({
            response_type: 'code', client_id: clientId, redirect_uri: redirect,
            scope: 'openid profile email w_member_social',
            state: 'dashboard-refresh-' + Date.now(),
          });
          oauthUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
        }
        health.auth = { voyager: voyagerStatus, official: officialStatus, oauth_url: oauthUrl };
        // MCP tools count
        health.mcp_tools = 71;
        adb.close();
        return json(res, health);
      } catch (err) { return json(res, { error: err.message }); }
    }

    // GET /api/automations
    if (method === 'GET' && path === '/api/automations') {
      const MCP_OUT = join(MCP_DIR, 'output', 'linkedin-mcp');
      const automations = [
        {
          id: 'dashboard', label: 'Dashboard (localhost:6767)', plist: 'com.gaca.linkedin-dashboard.plist',
          schedule: 'KeepAlive (auto-restart)', logFile: null, type: 'daemon',
        },
        {
          id: 'autopublish', label: 'Auto-Publish (posty)', plist: 'com.gaca.linkedin-autopublish.plist',
          schedule: 'KeepAlive — sprawdza co 30s', logFile: join(MCP_OUT, 'auto-publish-launchd.log'), type: 'daemon',
        },
        {
          id: 'autoengage', label: 'Auto-Engage (komentarze)', plist: 'com.gaca.linkedin-autoengage.plist',
          schedule: 'KeepAlive — auto-engage algorithm', logFile: join(MCP_OUT, 'autoengage.log'), type: 'daemon',
        },
        {
          id: 'prospect', label: 'Auto-Prospect (nowe leady)', plist: 'com.gaca.linkedin-prospect.plist',
          schedule: 'Cron: 9:00, 13:00, 17:00', logFile: join(MCP_OUT, 'prospect.log'), type: 'cron',
          nextHours: [9, 13, 17],
        },
        {
          id: 'invite', label: 'Auto-Invite (zaproszenia)', plist: 'com.gaca.linkedin-invite.plist',
          schedule: 'Cron: 18:00 codziennie', logFile: join(MCP_OUT, 'invite.log'), type: 'cron',
          nextHours: [18],
        },
        {
          id: 'analytics', label: 'Auto-Analytics (dane LinkedIn)', plist: 'com.gaca.linkedin-analytics.plist',
          schedule: 'Cron: 22:00 codziennie', logFile: join(MCP_OUT, 'analytics.log'), type: 'cron',
          nextHours: [22],
        },
        {
          id: 'cookie-refresh', label: 'Cookie Refresh (Voyager auth)', plist: 'com.gaca.linkedin-cookie-refresh.plist',
          schedule: 'Cron: co 4h (6,10,14,18,22)', logFile: join(MCP_OUT, 'cookie-refresh.log'), type: 'cron',
          nextHours: [6, 10, 14, 18, 22],
        },
      ];

      // Check running PIDs — macOS uses launchctl, Linux/container reads docker ps or pgrep
      let runningPids = {};
      try {
        if (IS_MACOS) {
          const out = execSync('launchctl list 2>/dev/null | grep gaca.linkedin', { encoding: 'utf-8' });
          for (const line of out.trim().split('\n')) {
            const [pid, , label] = line.trim().split(/\s+/);
            if (label) {
              const id = label.replace('com.gaca.linkedin-', '');
              runningPids[id] = pid !== '-' ? parseInt(pid) : null;
            }
          }
        } else {
          // Linux container: each daemon runs in its own container; use pgrep on script name
          for (const a of automations) {
            const scriptName = (a.command || '').split('/').pop();
            if (!scriptName) continue;
            try {
              const pid = execSync(`pgrep -f "node.*${scriptName}" | head -1`, { encoding: 'utf-8' }).trim();
              if (pid) runningPids[a.id] = parseInt(pid);
            } catch {}
          }
        }
      } catch {}

      const now = new Date();
      const result = automations.map(a => {
        const pid = runningPids[a.id];
        const running = pid != null && pid > 0;
        let lastLine = null;
        let nextRun = null;
        try {
          if (a.logFile && existsSync(a.logFile)) {
            const lines = readFileSync(a.logFile, 'utf-8').trim().split('\n');
            lastLine = lines[lines.length - 1]?.slice(0, 120) || null;
          }
        } catch {}
        if (a.nextHours) {
          const next = a.nextHours
            .map(h => { const d = new Date(now); d.setHours(h, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); return d; })
            .sort((x, y) => x - y)[0];
          nextRun = next.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        }
        // Dashboard is always running if we're responding to this request
        const isRunning = a.id === 'dashboard' ? true : running;
        const actualPid = a.id === 'dashboard' ? process.pid : (pid || null);
        return { id: a.id, label: a.label, schedule: a.schedule, running: isRunning, pid: actualPid, lastLine, nextRun };
      });
      return json(res, { automations: result });
    }

    // GET /api/cron-status
    if (method === 'GET' && path === '/api/cron-status') {
      const logPath = join('/Users/gaca/output/personal/linkedin-mcp', 'prospect.log');
      let lastRun = null;
      let lastFound = 0;
      try {
        const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
        const doneLine = [...lines].reverse().find(l => l.includes('Done —'));
        if (doneLine) {
          const m = doneLine.match(/\[([^\]]+)\]/);
          if (m) lastRun = m[1];
          const nm = doneLine.match(/(\d+) new prospects/);
          if (nm) lastFound = parseInt(nm[1]);
        }
      } catch {}
      const now = new Date();
      const nextHours = [9, 13, 17];
      const nextRun = nextHours
        .map(h => { const d = new Date(now); d.setHours(h, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); return d; })
        .sort((a, b) => a - b)[0];
      return json(res, { last_run: lastRun, last_found: lastFound, next_run: nextRun.toISOString() });
    }

    // GET /api/calendar
    if (method === 'GET' && path === '/api/calendar') {
      const db = getDb();
      const scheduled = db.prepare(
        "SELECT id, text, publish_at, status, post_urn FROM scheduled_posts WHERE status IN ('scheduled','published') ORDER BY publish_at ASC"
      ).all();
      db.close();

      function getWeekKey(dateStr) {
        const d = new Date(dateStr);
        const day = d.getDay() || 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        return monday.toISOString().slice(0, 10);
      }

      const scheduledDates = new Set(scheduled.map(p => (p.publish_at || '').slice(0, 10)));
      const proposed = PROPOSED_POSTS
        .filter(p => !scheduledDates.has(p.date.slice(0, 10)))
        .map((p, i) => ({ ...p, source: 'proposed', idx: i }));

      const allPosts = [
        ...scheduled.map(p => ({ ...p, date: p.publish_at, source: 'db' })),
        ...proposed
      ].sort((a, b) => new Date(a.date) - new Date(b.date));

      const weeks = {};
      for (const p of allPosts) {
        const key = getWeekKey(p.date);
        if (!weeks[key]) weeks[key] = { weekStart: key, posts: [] };
        weeks[key].posts.push(p);
      }

      // Iter6: sortuj tygodnie chronologicznie DESC (najnowsze pierwsze)
      const sortedWeeks = Object.values(weeks).sort(
        (a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime(),
      );
      return json(res, { weeks: sortedWeeks });
    }

    // GET /api/analytics — dashboard analytics summary
    if (method === 'GET' && path === '/api/analytics') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { error: 'analytics.db not found. Run: node auto-analytics.mjs' });
      const adb = new Database(ANALYTICS_DB, { readonly: true });

      let dailyStats = [];
      try { dailyStats = adb.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT 30").all(); } catch {}

      // Top posty: PRAWDZIWE z eksportu XLSX (xlsx_top_posts) — social_metadata (oficjalne API) jest
      // niepełne i zaniża (top 40 vs realne 380). Fallback do social_metadata, gdy brak importu XLSX.
      let topPosts = [];
      try {
        topPosts = adb.prepare(`
          SELECT activity_id, activity_id AS post_urn, value AS total_reactions, post_date AS published_at,
            NULL AS comment_count, NULL AS like_count, NULL AS praise_count, NULL AS empathy_count,
            NULL AS interest_count, NULL AS appreciation_count, NULL AS entertainment_count
          FROM xlsx_top_posts WHERE kind='reactions' ORDER BY rank ASC LIMIT 10
        `).all();
      } catch {}
      if (!topPosts.length) {
        try {
          topPosts = adb.prepare(`
            SELECT sm.post_urn,
              (sm.like_count + sm.praise_count + sm.empathy_count + sm.interest_count + sm.appreciation_count + sm.entertainment_count) as total_reactions,
              sm.comment_count, sm.like_count, sm.praise_count, sm.empathy_count, sm.interest_count, sm.appreciation_count, sm.entertainment_count
            FROM social_metadata sm ORDER BY total_reactions DESC LIMIT 10
          `).all();
        } catch {}
      }

      let weeklyReports = [];
      try { weeklyReports = adb.prepare("SELECT * FROM weekly_report ORDER BY week_start DESC LIMIT 4").all(); } catch {}

      adb.close();

      // Enrich top posts with text. Primary: scheduler.db. Fallback: creator_top_posts.raw_text.
      // Last resort: a readable "Post (share …)" label instead of the raw urn:li:share URN.
      const sdb = getDb();
      const adbT = new Database(ANALYTICS_DB, { readonly: true });
      for (const tp of topPosts) {
        const aid = tp.activity_id || (String(tp.post_urn || '').match(/(\d{6,})/) || [])[1] || '';
        // tekst: scheduler.db po activity_id (post_urn zawiera id), potem creator_top_posts, potem label
        let post = null;
        if (aid) post = sdb.prepare("SELECT text, publish_at FROM scheduled_posts WHERE post_urn LIKE ? ORDER BY publish_at DESC LIMIT 1").get('%' + aid + '%');
        let preview = post ? post.text.substring(0, 80) : '';
        if (!preview && aid) {
          const ctp = adbT.prepare("SELECT raw_text, text_preview FROM creator_top_posts WHERE post_urn LIKE ? ORDER BY scraped_at DESC LIMIT 1").get('%' + aid + '%');
          preview = (ctp?.raw_text || ctp?.text_preview || '').substring(0, 80);
        }
        if (!preview) preview = aid ? 'Post (…' + aid.slice(-6) + ')' : '(brak treści)';
        tp.text_preview = preview;
        if (!tp.published_at) tp.published_at = post?.publish_at || '';
        // komentarze + breakdown reakcji z social_metadata (oficjalne API), jeśli jest match po activity_id
        // — eksport XLSX ma tylko sumę reakcji, więc to uzupełniamy z API gdzie się da, inaczej '—'.
        if (aid && tp.comment_count == null) {
          const sm = adbT.prepare("SELECT comment_count, like_count, praise_count, empathy_count, interest_count, appreciation_count, entertainment_count FROM social_metadata WHERE post_urn LIKE ? LIMIT 1").get('%' + aid + '%');
          if (sm) {
            tp.comment_count = sm.comment_count; tp.like_count = sm.like_count; tp.praise_count = sm.praise_count;
            tp.empathy_count = sm.empathy_count; tp.interest_count = sm.interest_count;
            tp.appreciation_count = sm.appreciation_count; tp.entertainment_count = sm.entertainment_count;
          }
        }
      }
      adbT.close();
      sdb.close();

      // ── KPI sources: prefer FRESH/REAL data, never the frozen creator_analytics series. ──
      // Followers   → latest REAL fetch in daily_stats (is_stale=0). creator_analytics is
      //               kept only for the historical chart (frozen at last working UI scrape).
      // Impressions → summed from the most recent creator_top_posts scrape (only working
      //               source — Official socialMetadata/profileView endpoints return 403/410).
      // Reactions   → summed across social_metadata (real per-post reaction counts).
      let followerCount = 0, followerDelta = 0, totalImpressions = 0, totalReactions = 0;
      let dataStale = { followers: false, profileviews_dead: false, errors_today: 0, last_run_date: null, followers_last_real_date: null, impressions_scrape_date: null };
      try {
        const adb2 = new Database(join(homedir(), '.linkedin-mcp', 'analytics.db'), { readonly: true });

        // Followers — real anchors only (exclude fabricated frozen-fallback rows)
        const latestReal = adb2.prepare("SELECT date, follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 ORDER BY date DESC LIMIT 1").get();
        const weekAgoReal = adb2.prepare("SELECT follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 AND date <= date('now','-7 days') ORDER BY date DESC LIMIT 1").get();
        if (latestReal) {
          followerCount = latestReal.follower_count;
          followerDelta = weekAgoReal ? followerCount - weekAgoReal.follower_count : 0;
          dataStale.followers_last_real_date = latestReal.date;
        }

        // Impressions — PRAWDZIWA suma z importu XLSX (creator_analytics impressions/cumulative = total LinkedIn).
        // creator_top_posts (scrape) zaniża (tylko top posty → 134k vs realne 155k). Fallback do scrape, gdy brak importu.
        const imprReal = adb2.prepare("SELECT date, value FROM creator_analytics WHERE metric='impressions' AND chart_type='cumulative' ORDER BY date DESC LIMIT 1").get();
        if (imprReal?.value) {
          totalImpressions = imprReal.value;
          dataStale.impressions_scrape_date = imprReal.date;
        } else {
          const lastScrape = adb2.prepare("SELECT MAX(date(scraped_at)) AS d FROM creator_top_posts").get();
          if (lastScrape?.d) {
            totalImpressions = adb2.prepare("SELECT SUM(impressions) AS s FROM creator_top_posts WHERE date(scraped_at)=?").get(lastScrape.d)?.s || 0;
            dataStale.impressions_scrape_date = lastScrape.d;
          }
        }

        // Reactions — PRAWDZIWA suma z XLSX (engagements/daily = realne reakcje dziennie). Fallback: social_metadata (niepełne).
        const reactReal = adb2.prepare("SELECT SUM(value) AS s FROM creator_analytics WHERE metric='engagements' AND chart_type='daily'").get();
        totalReactions = reactReal?.s
          || adb2.prepare("SELECT SUM(like_count+praise_count+empathy_count+interest_count+appreciation_count+entertainment_count) AS s FROM social_metadata").get()?.s || 0;

        // Staleness flags for the dashboard banner
        const hf = (m) => adb2.prepare("SELECT value FROM data_health WHERE metric=?").get(m)?.value;
        dataStale.followers = hf('followers_stale') === '1';
        dataStale.profileviews_dead = hf('profileviews_stale') === '1';
        dataStale.errors_today = parseInt(hf('errors_today') || '0', 10);
        dataStale.last_run_date = hf('last_run_date') || null;
        // Chart-freeze guard: the 365-day Highcharts scrape silently froze for 75 days.
        try {
          const caDays = adb2.prepare("SELECT CAST(julianday('now') - julianday(MAX(scraped_at)) AS INTEGER) AS d FROM creator_analytics").get()?.d;
          if (caDays != null) dataStale.charts_stale_days = caDays;
        } catch {}
        adb2.close();
      } catch {}

      // Engagement rate: reactions / impressions when impressions known, else reactions / followers
      const engRate = totalImpressions > 0
        ? Math.round(totalReactions / totalImpressions * 10000) / 100
        : (followerCount > 0 ? Math.round(totalReactions / followerCount * 10000) / 100 : 0);

      return json(res, {
        current: {
          follower_count: followerCount,
          follower_delta: followerDelta,
          impressions: totalImpressions,
          // profile_views are NOT available (LinkedIn endpoint 410 Gone). Never fabricate by
          // substituting impressions — see lib/analytics-snapshot.mjs for the honest export.
          profile_views: null,
          profile_views_available: false,
          total_reactions: totalReactions,
          avg_engagement_rate: engRate,
        },
        data_stale: dataStale,
        daily_stats: dailyStats,
        top_posts: topPosts,
        weekly_reports: weeklyReports,
      });
    }

    // GET /api/analytics/llm-export — deterministic, provenance-tagged snapshot for LLM use.
    // Same payload as ~/.linkedin-mcp/exports/analytics-latest.json (shared builder).
    if (method === 'GET' && path === '/api/analytics/llm-export') {
      try {
        return json(res, buildSnapshot());
      } catch (e) {
        return json(res, { error: 'snapshot failed', detail: String(e?.message || e) });
      }
    }

    // GET /api/post-metrics/:post_urn — single post metrics from analytics.db cache
    if (method === 'GET' && path.startsWith('/api/post-metrics/')) {
      const postUrn = decodeURIComponent(path.slice('/api/post-metrics/'.length));
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, {});
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let metrics = null;
      try { metrics = adb.prepare("SELECT * FROM social_metadata WHERE post_urn = ?").get(postUrn); } catch {}
      adb.close();
      return json(res, metrics || {});
    }

    // ── Analytics Extended Endpoints ──────────────────────────────────────

    // GET /api/analytics/trends?days=30
    if (method === 'GET' && path === '/api/analytics/trends') {
      const days = parseInt(url.searchParams.get('days') || '365');
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { labels: [], datasets: {} });
      const adb = new Database(ANALYTICS_DB, { readonly: true });

      // Use REAL scraped data from creator_analytics (Highcharts scrape)
      let hasCreatorData = false;
      try { hasCreatorData = (adb.prepare("SELECT COUNT(*) as c FROM creator_analytics").get()?.c || 0) > 0; } catch {}

      if (hasCreatorData) {
        const dateFilter = `date >= date('now', '-${days} days')`;
        let followersCum = [], followersDaily = [], impressionsCum = [], impressionsDaily = [], engagementsDaily = [];
        try { followersCum = adb.prepare(`SELECT date, value FROM creator_analytics WHERE metric='followers' AND chart_type='cumulative' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        try { followersDaily = adb.prepare(`SELECT date, value FROM creator_analytics WHERE metric='followers' AND chart_type='daily' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        try { impressionsCum = adb.prepare(`SELECT date, value FROM creator_analytics WHERE metric='impressions' AND chart_type='cumulative' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        try { impressionsDaily = adb.prepare(`SELECT date, value FROM creator_analytics WHERE metric='impressions' AND chart_type='daily' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        try { engagementsDaily = adb.prepare(`SELECT date, value FROM creator_analytics WHERE metric='engagements' AND chart_type='daily' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        adb.close();

        const labels = followersCum.map(r => r.date);
        return json(res, {
          labels,
          datasets: {
            followers: followersCum.map(r => r.value),
            followers_daily: followersDaily.map(r => r.value),
            impressions: impressionsCum.map(r => r.value),
            impressions_daily: impressionsDaily.map(r => r.value),
            engagements_daily: engagementsDaily.map(r => r.value),
            // Legacy compat
            reactions: engagementsDaily.map(r => r.value),
            // profile_views removed — it was impressions_daily mislabeled. Use impressions_daily.
            engagement_rate: followersCum.map((r, i) => {
              const imp = impressionsDaily[i]?.value || 0;
              const eng = engagementsDaily[i]?.value || 0;
              return imp > 0 ? Math.round(eng / imp * 10000) / 100 : 0;
            }),
          },
          source: 'creator_analytics',
        });
      }

      // Fallback: old daily_stats
      let rows = [];
      try { rows = adb.prepare("SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?").all(days); } catch {}
      adb.close();
      rows.reverse();
      return json(res, {
        labels: rows.map(r => r.date),
        datasets: {
          followers: rows.map(r => r.follower_count || 0),
          reactions: rows.map(r => r.total_reactions || 0),
          impressions_daily: rows.map(r => r.total_impressions || 0),
          engagement_rate: rows.map(r => r.avg_engagement_rate || 0),
        },
        source: 'daily_stats',
      });
    }

    // GET /api/analytics/content-types
    if (method === 'GET' && path === '/api/analytics/content-types') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { types: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let types = [];
      try {
        // Ensure content_type_map exists
        adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
          post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
          post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
          language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]'
        )`);
        types = adb.prepare(`
          SELECT ctm.content_type, COUNT(*) as count,
            ROUND(AVG(sm.like_count + sm.praise_count + sm.empathy_count + sm.interest_count + sm.appreciation_count + sm.entertainment_count), 1) as avg_reactions,
            ROUND(AVG(sm.comment_count), 1) as avg_comments
          FROM content_type_map ctm
          JOIN social_metadata sm ON ctm.post_urn = sm.post_urn
          GROUP BY ctm.content_type ORDER BY avg_reactions DESC
        `).all();
      } catch {}
      adb.close();
      return json(res, { types });
    }

    // GET /api/analytics/best-times
    if (method === 'GET' && path === '/api/analytics/best-times') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { heatmap: [], best_hour: null, best_day: null });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let rows = [];
      try {
        adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
          post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
          post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
          language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]'
        )`);
        rows = adb.prepare(`
          SELECT ctm.publish_hour, ctm.publish_day_of_week,
            ROUND(AVG(sm.like_count + sm.praise_count + sm.empathy_count + sm.interest_count + sm.appreciation_count + sm.entertainment_count), 1) as avg_engagement,
            COUNT(*) as post_count
          FROM content_type_map ctm
          JOIN social_metadata sm ON ctm.post_urn = sm.post_urn
          WHERE ctm.publish_hour IS NOT NULL AND ctm.publish_day_of_week IS NOT NULL
          GROUP BY ctm.publish_hour, ctm.publish_day_of_week
        `).all();
      } catch {}
      adb.close();
      // Build 7x24 matrix
      const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
      let bestVal = 0, bestHour = null, bestDay = null;
      for (const r of rows) {
        if (r.publish_day_of_week != null && r.publish_hour != null) {
          heatmap[r.publish_day_of_week][r.publish_hour] = r.avg_engagement;
          if (r.avg_engagement > bestVal) { bestVal = r.avg_engagement; bestHour = r.publish_hour; bestDay = r.publish_day_of_week; }
        }
      }
      return json(res, { heatmap, best_hour: bestHour, best_day: bestDay });
    }

    // GET /api/analytics/reaction-trends?days=30
    if (method === 'GET' && path === '/api/analytics/reaction-trends') {
      const days = parseInt(url.searchParams.get('days') || '30');
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { dates: [], series: {} });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let rows = [];
      try {
        adb.exec(`CREATE TABLE IF NOT EXISTS reaction_type_daily (
          date TEXT NOT NULL, reaction_type TEXT NOT NULL, count INTEGER DEFAULT 0,
          PRIMARY KEY (date, reaction_type)
        )`);
        rows = adb.prepare("SELECT * FROM reaction_type_daily ORDER BY date DESC LIMIT ?").all(days * 6);
      } catch {}
      adb.close();
      // Pivot
      const dateSet = new Set();
      const series = {};
      for (const r of rows) {
        dateSet.add(r.date);
        if (!series[r.reaction_type]) series[r.reaction_type] = {};
        series[r.reaction_type][r.date] = r.count;
      }
      const dates = [...dateSet].sort();
      const result = {};
      for (const type in series) {
        result[type] = dates.map(d => series[type][d] || 0);
      }
      return json(res, { dates, series: result });
    }

    // GET /api/analytics/posts-performance
    if (method === 'GET' && path === '/api/analytics/posts-performance') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { posts: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      const sdb = getDb();
      let smRows = [];
      try { smRows = adb.prepare("SELECT * FROM social_metadata ORDER BY fetched_at DESC").all(); } catch {}
      let ctmMap = {};
      try {
        adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
          post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
          post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
          language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]'
        )`);
        const ctmRows = adb.prepare("SELECT * FROM content_type_map").all();
        for (const r of ctmRows) ctmMap[r.post_urn] = r;
      } catch {}
      adb.close();
      const posts = smRows.map(sm => {
        const sp = sdb.prepare("SELECT text, publish_at, language FROM scheduled_posts WHERE post_urn = ?").get(sm.post_urn);
        const ctm = ctmMap[sm.post_urn] || {};
        const totalReactions = (sm.like_count || 0) + (sm.praise_count || 0) + (sm.empathy_count || 0) + (sm.interest_count || 0) + (sm.appreciation_count || 0) + (sm.entertainment_count || 0);
        return {
          post_urn: sm.post_urn,
          text_preview: sp ? sp.text.substring(0, 100) : '',
          published_at: sp?.publish_at || '',
          language: sp?.language || ctm.language || '',
          content_type: ctm.content_type || 'text',
          post_length: ctm.post_length || 0,
          hashtag_count: ctm.hashtag_count || 0,
          total_reactions: totalReactions,
          comment_count: sm.comment_count || 0,
          like_count: sm.like_count || 0,
          praise_count: sm.praise_count || 0,
          empathy_count: sm.empathy_count || 0,
          interest_count: sm.interest_count || 0,
          appreciation_count: sm.appreciation_count || 0,
          entertainment_count: sm.entertainment_count || 0,
        };
      });
      sdb.close();
      return json(res, { posts });
    }

    // ── Network Endpoints ─────────────────────────────────────────────────

    // GET /api/network/growth?days=90
    if (method === 'GET' && path === '/api/network/growth') {
      const days = parseInt(url.searchParams.get('days') || '365');
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { timeline: [], total_growth: 0 });
      const adb = new Database(ANALYTICS_DB, { readonly: true });

      // Use REAL scraped data from creator_analytics
      let hasCreatorData = false;
      try { hasCreatorData = (adb.prepare("SELECT COUNT(*) as c FROM creator_analytics WHERE metric='followers'").get()?.c || 0) > 0; } catch {}

      if (hasCreatorData) {
        const dateFilter = `date >= date('now', '-${days} days')`;
        let cumRows = [], dailyRows = [];
        try { cumRows = adb.prepare(`SELECT date, value as follower_count FROM creator_analytics WHERE metric='followers' AND chart_type='cumulative' AND ${dateFilter} ORDER BY date`).all(); } catch {}
        try { dailyRows = adb.prepare(`SELECT date, value as delta FROM creator_analytics WHERE metric='followers' AND chart_type='daily' AND ${dateFilter} ORDER BY date`).all(); } catch {}

        // Merge cumulative + daily into timeline
        const dailyMap = {};
        for (const r of dailyRows) dailyMap[r.date] = r.delta;
        const timeline = cumRows.map(r => ({
          date: r.date,
          follower_count: r.follower_count,
          delta: dailyMap[r.date] || 0,
        }));

        // Extend with REAL daily_stats anchors beyond the creator_analytics cutoff.
        // creator_analytics is the frozen UI scrape; fresh Voyager fetches land in daily_stats
        // (is_stale=0). Without this the chart would stop at the April snapshot while the
        // Followers KPI shows the current count — a visible contradiction.
        const cutoff = timeline.length ? timeline[timeline.length - 1].date : '0000-00-00';
        try {
          const realRows = adb.prepare("SELECT date, follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 AND date > ? ORDER BY date").all(cutoff);
          let prevFc = timeline.length ? timeline[timeline.length - 1].follower_count : 0;
          for (const rr of realRows) {
            timeline.push({ date: rr.date, follower_count: rr.follower_count, delta: rr.follower_count - prevFc });
            prevFc = rr.follower_count;
          }
        } catch {}
        adb.close();

        const totalGrowth = timeline.length > 1 ? timeline[timeline.length - 1].follower_count - timeline[0].follower_count : 0;
        const avgDaily = timeline.length > 1 ? Math.round(totalGrowth / timeline.length * 10) / 10 : 0;
        return json(res, { timeline, total_growth: totalGrowth, avg_daily: avgDaily, source: 'creator_analytics' });
      }

      // Fallback: old follower_deltas/daily_stats
      let rows = [];
      try {
        rows = adb.prepare("SELECT date, follower_count, delta FROM follower_deltas ORDER BY date DESC LIMIT ?").all(days);
        if (rows.length === 0) {
          rows = adb.prepare("SELECT date, follower_count, 0 as delta FROM daily_stats ORDER BY date DESC LIMIT ?").all(days);
          rows.reverse();
          for (let i = 1; i < rows.length; i++) {
            rows[i].delta = (rows[i].follower_count || 0) - (rows[i - 1].follower_count || 0);
          }
          rows.reverse();
        }
      } catch {}
      adb.close();
      rows.reverse();
      const totalGrowth = rows.length > 1 ? (rows[rows.length - 1].follower_count || 0) - (rows[0].follower_count || 0) : 0;
      const avgDaily = rows.length > 1 ? Math.round(totalGrowth / rows.length * 10) / 10 : 0;
      return json(res, { timeline: rows, total_growth: totalGrowth, avg_daily: avgDaily, source: 'follower_deltas' });
    }

    // GET /api/network/top-engagers?limit=20
    if (method === 'GET' && path === '/api/network/top-engagers') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { engagers: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      try { adb.exec(`CREATE TABLE IF NOT EXISTS top_engagers (
        person_urn TEXT PRIMARY KEY, name TEXT, headline TEXT, public_id TEXT,
        reaction_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
        total_engagements INTEGER DEFAULT 0, last_engagement_at TEXT
      )`); } catch {}
      let engagers = [];
      try { engagers = adb.prepare("SELECT * FROM top_engagers ORDER BY total_engagements DESC LIMIT ?").all(limit); } catch {}
      adb.close();
      return json(res, { engagers });
    }

    // GET /api/network/demographics
    if (method === 'GET' && path === '/api/network/demographics') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { industries: [], job_titles: [], locations: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      try { adb.exec(`CREATE TABLE IF NOT EXISTS network_demographics (
        category TEXT NOT NULL, value TEXT NOT NULL, count INTEGER DEFAULT 0,
        PRIMARY KEY (category, value)
      )`); } catch {}
      let all = [];
      try { all = adb.prepare("SELECT * FROM network_demographics ORDER BY count DESC").all(); } catch {}
      adb.close();
      const result = { industries: [], job_titles: [], locations: [] };
      for (const r of all) {
        if (r.category === 'industry') result.industries.push({ value: r.value, count: r.count });
        else if (r.category === 'job_title') result.job_titles.push({ value: r.value, count: r.count });
        else if (r.category === 'location') result.locations.push({ value: r.value, count: r.count });
      }
      return json(res, result);
    }

    // GET /api/network/connections?limit=100
    if (method === 'GET' && path === '/api/network/connections') {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const pdb = new Database(PROSPECTS_DB_PATH, { readonly: true });
      let connections = [];
      try { connections = pdb.prepare("SELECT * FROM connections ORDER BY scraped_at DESC LIMIT ?").all(limit); } catch {}
      const total = connections.length > 0 ? (pdb.prepare("SELECT COUNT(*) as c FROM connections").get()?.c || 0) : 0;
      pdb.close();
      return json(res, { connections, total });
    }

    // GET /api/analytics/top-posts
    if (method === 'GET' && path === '/api/analytics/top-posts') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { posts: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let posts = [];
      try { posts = adb.prepare("SELECT * FROM creator_top_posts ORDER BY impressions DESC LIMIT 50").all(); } catch {}
      adb.close();
      return json(res, { posts });
    }

    // ── Leads/Pipeline Endpoints ──────────────────────────────────────────

    // GET /api/leads?stage=all&sort=score
    if (method === 'GET' && path === '/api/leads') {
      const stage = url.searchParams.get('stage') || 'all';
      const pdb = new Database(PROSPECTS_DB_PATH);
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN lead_score INTEGER DEFAULT 0"); } catch {}
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN pipeline_stage TEXT DEFAULT 'new'"); } catch {}
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN last_signal_at TEXT"); } catch {}
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN signal_count INTEGER DEFAULT 0"); } catch {}
      try { pdb.exec(`CREATE TABLE IF NOT EXISTS lead_timeline (
        id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL,
        event_type TEXT NOT NULL, from_value TEXT DEFAULT '', to_value TEXT DEFAULT '', note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`); } catch {}

      let leads = [];
      try {
        const where = stage === 'all' ? '' : " WHERE p.pipeline_stage = '" + stage.replace(/'/g, '') + "'";
        leads = pdb.prepare(`
          SELECT p.*,
            (SELECT COUNT(*) FROM activities a WHERE a.prospect_id = p.id AND a.created_at > datetime('now', '-30 days')) as activity_30d,
            (SELECT COUNT(*) FROM activities a WHERE a.prospect_id = p.id AND a.classification = 'buying_signal') as buying_signals,
            (SELECT COUNT(*) FROM activities a WHERE a.prospect_id = p.id AND a.classification = 'job_posting') as job_signals,
            (SELECT MAX(a.created_at) FROM activities a WHERE a.prospect_id = p.id) as last_activity_at
          FROM prospects p${where}
          ORDER BY p.lead_score DESC, p.created_at DESC
          LIMIT 100
        `).all();
      } catch {}

      // Compute scores on the fly
      for (const lead of leads) {
        let score = 0;
        score += Math.min((lead.activity_30d || 0) * 5, 25);
        score += Math.min((lead.buying_signals || 0) * 15, 45);
        score += Math.min((lead.job_signals || 0) * 5, 10);
        if (lead.last_activity_at) {
          const daysAgo = (Date.now() - new Date(lead.last_activity_at).getTime()) / 86400000;
          if (daysAgo < 7) score += 10;
          else if (daysAgo < 14) score += 5;
        }
        if (lead.category === 'target_buyer') score += 10;
        lead.computed_score = Math.min(score, 100);
        // Update stored score
        try { pdb.prepare("UPDATE prospects SET lead_score = ? WHERE id = ?").run(lead.computed_score, lead.id); } catch {}
      }
      leads.sort((a, b) => (b.computed_score || 0) - (a.computed_score || 0));
      pdb.close();
      return json(res, { leads });
    }

    // GET /api/leads/pipeline-summary
    if (method === 'GET' && path === '/api/leads/pipeline-summary') {
      const pdb = new Database(PROSPECTS_DB_PATH);
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN pipeline_stage TEXT DEFAULT 'new'"); } catch {}
      let stages = [];
      try { stages = pdb.prepare("SELECT pipeline_stage, COUNT(*) as count FROM prospects GROUP BY pipeline_stage").all(); } catch {}
      pdb.close();
      const result = { new: 0, contacted: 0, connected: 0, qualified: 0, proposal: 0, client: 0, lost: 0 };
      for (const s of stages) result[s.pipeline_stage || 'new'] = s.count;
      return json(res, { stages: result });
    }

    // GET /api/leads/:id/timeline
    if (method === 'GET' && path.match(/^\/api\/leads\/[^/]+\/timeline$/)) {
      const id = decodeURIComponent(path.split('/')[3]);
      const pdb = new Database(PROSPECTS_DB_PATH);
      try { pdb.exec(`CREATE TABLE IF NOT EXISTS lead_timeline (
        id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL,
        event_type TEXT NOT NULL, from_value TEXT DEFAULT '', to_value TEXT DEFAULT '', note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`); } catch {}
      let timeline = [];
      try {
        const events = pdb.prepare("SELECT * FROM lead_timeline WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 50").all(id);
        const activities = pdb.prepare("SELECT * FROM activities WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 20").all(id);
        timeline = [
          ...events.map(e => ({ type: e.event_type, text: e.note || (e.from_value + ' → ' + e.to_value), date: e.created_at })),
          ...activities.map(a => ({ type: 'activity_' + a.classification, text: a.text?.substring(0, 120) || '', date: a.created_at })),
        ].sort((a, b) => new Date(b.date) - new Date(a.date));
      } catch {}
      pdb.close();
      return json(res, { timeline });
    }

    // POST /api/leads/:id/stage
    if (method === 'POST' && path.match(/^\/api\/leads\/[^/]+\/stage$/)) {
      const id = decodeURIComponent(path.split('/')[3]);
      const body = await parseBody(req);
      const pdb = new Database(PROSPECTS_DB_PATH);
      try { pdb.exec("ALTER TABLE prospects ADD COLUMN pipeline_stage TEXT DEFAULT 'new'"); } catch {}
      try { pdb.exec(`CREATE TABLE IF NOT EXISTS lead_timeline (
        id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL,
        event_type TEXT NOT NULL, from_value TEXT DEFAULT '', to_value TEXT DEFAULT '', note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`); } catch {}
      const current = pdb.prepare("SELECT pipeline_stage FROM prospects WHERE id = ?").get(id);
      if (!current) { pdb.close(); return json(res, { error: 'Not found' }, 404); }
      pdb.prepare("UPDATE prospects SET pipeline_stage = ? WHERE id = ?").run(body.stage, id);
      pdb.prepare("INSERT INTO lead_timeline (id, prospect_id, event_type, from_value, to_value, note) VALUES (?, ?, 'stage_change', ?, ?, ?)").run(
        crypto.randomUUID(), id, current.pipeline_stage || 'new', body.stage, body.note || ''
      );
      pdb.close();
      return json(res, { ok: true });
    }

    // POST /api/leads/:id/note
    if (method === 'POST' && path.match(/^\/api\/leads\/[^/]+\/note$/)) {
      const id = decodeURIComponent(path.split('/')[3]);
      const body = await parseBody(req);
      const pdb = new Database(PROSPECTS_DB_PATH);
      try { pdb.exec(`CREATE TABLE IF NOT EXISTS lead_timeline (
        id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL,
        event_type TEXT NOT NULL, from_value TEXT DEFAULT '', to_value TEXT DEFAULT '', note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`); } catch {}
      pdb.prepare("INSERT INTO lead_timeline (id, prospect_id, event_type, note) VALUES (?, ?, 'note_added', ?)").run(
        crypto.randomUUID(), id, body.note || ''
      );
      pdb.close();
      return json(res, { ok: true });
    }

    // ── Content Intelligence Endpoints ────────────────────────────────────

    // GET /api/content/performance
    if (method === 'GET' && path === '/api/content/performance') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { posts: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      // Reuse posts-performance logic
      const sdb = getDb();
      let smRows = [];
      try { smRows = adb.prepare("SELECT * FROM social_metadata ORDER BY fetched_at DESC").all(); } catch {}
      let ctmMap = {};
      try {
        adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
          post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
          post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
          language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]'
        )`);
        const ctmRows = adb.prepare("SELECT * FROM content_type_map").all();
        for (const r of ctmRows) ctmMap[r.post_urn] = r;
      } catch {}
      // Ensure post_metrics_history exists
      try { adb.exec(`CREATE TABLE IF NOT EXISTS post_metrics_history (
        post_urn TEXT NOT NULL, date TEXT NOT NULL,
        impressions INTEGER DEFAULT 0, members_reached INTEGER DEFAULT 0,
        reactions INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, reshares INTEGER DEFAULT 0,
        PRIMARY KEY (post_urn, date)
      )`); } catch {}
      let impressionMap = {};
      try {
        const impRows = adb.prepare("SELECT post_urn, MAX(impressions) as impressions, MAX(members_reached) as reached FROM post_metrics_history GROUP BY post_urn").all();
        for (const r of impRows) impressionMap[r.post_urn] = r;
      } catch {}
      adb.close();
      const posts = smRows.map(sm => {
        const sp = sdb.prepare("SELECT text, publish_at, language FROM scheduled_posts WHERE post_urn = ?").get(sm.post_urn);
        const ctm = ctmMap[sm.post_urn] || {};
        const imp = impressionMap[sm.post_urn] || {};
        const totalReactions = (sm.like_count || 0) + (sm.praise_count || 0) + (sm.empathy_count || 0) + (sm.interest_count || 0) + (sm.appreciation_count || 0) + (sm.entertainment_count || 0);
        return {
          post_urn: sm.post_urn, text_preview: sp ? sp.text.substring(0, 100) : '',
          published_at: sp?.publish_at || '', language: sp?.language || ctm.language || '',
          content_type: ctm.content_type || 'text', post_length: ctm.post_length || (sp?.text?.length || 0),
          hashtag_count: ctm.hashtag_count || 0, hashtags: ctm.hashtags || '[]',
          impressions: imp.impressions || 0, reached: imp.reached || 0,
          total_reactions: totalReactions, comment_count: sm.comment_count || 0,
          engagement_rate: totalReactions > 0 ? Math.round((totalReactions + (sm.comment_count || 0)) / 6715 * 10000) / 100 : 0, // engagement = (reactions+comments) / followers
        };
      });
      sdb.close();
      return json(res, { posts });
    }

    // GET /api/content/hashtags
    if (method === 'GET' && path === '/api/content/hashtags') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { hashtags: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      try { adb.exec(`CREATE TABLE IF NOT EXISTS hashtag_performance (
        hashtag TEXT PRIMARY KEY, usage_count INTEGER DEFAULT 0,
        avg_reactions REAL DEFAULT 0, avg_impressions REAL DEFAULT 0, avg_comments REAL DEFAULT 0
      )`); } catch {}
      let hashtags = [];
      try { hashtags = adb.prepare("SELECT * FROM hashtag_performance ORDER BY avg_reactions DESC LIMIT 50").all(); } catch {}
      adb.close();
      return json(res, { hashtags });
    }

    // GET /api/content/optimal-length
    if (method === 'GET' && path === '/api/content/optimal-length') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { buckets: [] });
      const adb = new Database(ANALYTICS_DB, { readonly: true });
      let rows = [];
      try {
        adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
          post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
          post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
          language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]'
        )`);
        rows = adb.prepare(`
          SELECT
            CASE
              WHEN ctm.post_length < 500 THEN '0-500'
              WHEN ctm.post_length < 1000 THEN '500-1000'
              WHEN ctm.post_length < 1300 THEN '1000-1300'
              WHEN ctm.post_length < 1600 THEN '1300-1600'
              ELSE '1600+'
            END as bucket,
            COUNT(*) as count,
            ROUND(AVG(sm.like_count + sm.praise_count + sm.empathy_count + sm.interest_count + sm.appreciation_count + sm.entertainment_count), 1) as avg_reactions,
            ROUND(AVG(sm.comment_count), 1) as avg_comments
          FROM content_type_map ctm
          JOIN social_metadata sm ON ctm.post_urn = sm.post_urn
          WHERE ctm.post_length > 0
          GROUP BY bucket ORDER BY ctm.post_length ASC
        `).all();
      } catch {}
      adb.close();
      return json(res, { buckets: rows });
    }

    // GET /api/prospect/scan — SSE: direct searchPeople with live progress
    if (method === 'GET' && path === '/api/prospect/scan') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      (async () => {
        try {
          // Auto-refresh cookie before scanning
          send({ type: 'start', message: 'Odswiezam sesje LinkedIn...' });
          try {
            // Próba 1: wyciągnij li_at z Chrome (szybkie, bez logowania)
            try {
              execSync('node auto-refresh-li-at.mjs 2>&1', { cwd: MCP_DIR, timeout: 15000 });
            } catch {
              // Fallback: Playwright persistent session
              execSync('node scripts/refresh-voyager-cookie.mjs 2>&1', { cwd: MCP_DIR, timeout: 60000 });
            }
            send({ type: 'start', message: 'Sesja odswiezona. Szukam prospektow...' });
          } catch (cookieErr) {
            send({ type: 'start', message: 'Nie udalo sie odswiezyc sesji — probuje szukac...' });
          }

          const { searchPeople } = await import('./dist/scraper/search.js');
          const pdb = new Database(PROSPECTS_DB_PATH);
          try { pdb.exec("ALTER TABLE prospects ADD COLUMN status TEXT DEFAULT 'new'"); } catch {}

          // INBOUND: KUPCY — ludzie z PROBLEMAMI które Bartosz rozwiązuje
          // Szukamy po BUYING SIGNALS (keywords z postów/komentarzy)
          // NIE: deweloperzy, agencje IT, software house, CTO, freelancerzy
          const QUERIES = [
            // Buying signals — ludzie którzy SZUKAJĄ tego co sprzedajesz
            'szukam kogoś kto zbuduje MVP', 'potrzebuję MVP aplikacji',
            'szukam developera do projektu', 'kto zbuduje mi aplikację',
            'szukam firmy do wdrożenia', 'potrzebuję automatyzacji procesów',
            'szukam integracji API', 'potrzebuję systemu CRM',
            'kto zrobi mi SaaS', 'szukam kogoś do automatyzacji',
            // Właściciele firm z branż docelowych (nie-IT)
            'właściciel sklepu internetowego', 'właściciel hurtowni Polska',
            'prezes firmy handlowej', 'CEO ecommerce Polska',
            'dyrektor sprzedaży online', 'przedsiębiorca ecommerce',
            // Problemy biznesowe = Twoje usługi
            'potrzebuję chatbota dla firmy', 'automatyzacja obsługi klienta',
            'wdrożenie AI w firmie', 'cyfryzacja małej firmy',
            'potrzebuję dashboardu', 'szukam narzędzia do zarządzania',
          ];

          // Track scan offset per session to get different people each time
          const scanDb = new Database(PROSPECTS_DB_PATH);
          try { scanDb.exec("CREATE TABLE IF NOT EXISTS scan_state (key TEXT PRIMARY KEY, value INTEGER DEFAULT 0)"); } catch {}
          const offsetRow = scanDb.prepare("SELECT value FROM scan_state WHERE key = 'scan_offset'").get();
          let globalOffset = (offsetRow?.value || 0);
          scanDb.prepare("INSERT OR REPLACE INTO scan_state (key, value) VALUES ('scan_offset', ?)").run(globalOffset + 10);
          scanDb.close();

          // Pick 5 random queries
          const shuffled = QUERIES.sort(() => Math.random() - 0.5).slice(0, 5);
          let totalNew = 0;

          send({ type: 'start', message: 'Szukam w ' + shuffled.length + ' kategoriach (offset: ' + globalOffset + ')...' });

          for (let i = 0; i < shuffled.length; i++) {
            const q = shuffled[i];
            const startOffset = globalOffset + Math.floor(Math.random() * 10);
            send({ type: 'searching', query: q, step: i + 1, total_steps: shuffled.length });

            try {
              const result = await searchPeople({ keywords: q, count: 20, start: startOffset });
              const people = result.results || [];
              let newInBatch = 0;

              for (const person of people) {
                const pid = person.public_id || '';
                if (!pid) continue;
                const exists = pdb.prepare('SELECT id FROM prospects WHERE public_id = ?').get(pid);
                if (exists) continue;
                pdb.prepare(`INSERT OR IGNORE INTO prospects (id,name,headline,public_id,profile_url,company_name,category,tags,status) VALUES (?,?,?,?,?,?,'target_buyer','[]','new')`).run(
                  `ap-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
                  person.name || '', person.headline || '', pid,
                  person.profile_url || `https://www.linkedin.com/in/${pid}`,
                  person.company || ''
                );
                totalNew++;
                newInBatch++;
              }

              send({ type: 'found', query: q, found: people.length, new_in_batch: newInBatch, total_new: totalNew });
            } catch (err) {
              send({ type: 'error', query: q, message: err.message?.slice(0, 100) || 'Unknown error' });
            }

            // Delay between queries
            await new Promise(r => setTimeout(r, 5000));
          }

          const total = pdb.prepare("SELECT COUNT(*) as c FROM prospects").get()?.c || 0;
          const newP = pdb.prepare("SELECT name, company_name, public_id FROM prospects WHERE status = 'new' ORDER BY created_at DESC LIMIT 20").all();
          pdb.close();
          send({ type: 'done', total_new: totalNew, total, new_prospects: newP });
        } catch (err) {
          send({ type: 'fatal', message: err.message?.slice(0, 200) || 'Fatal error' });
        }
        res.end();
      })();
      return;
    }

    // POST /api/prospect/mark-invited — mark all new as invited
    if (method === 'POST' && path === '/api/prospect/mark-invited') {
      const pdb = new Database(PROSPECTS_DB_PATH);
      const result = pdb.prepare("UPDATE prospects SET status = 'invited', invited_at = datetime('now') WHERE status = 'new'").run();
      pdb.close();
      return json(res, { ok: true, marked: result.changes });
    }

    // POST /api/content/refresh — auto-seed content data from scheduler + analytics
    if (method === 'POST' && path === '/api/content/refresh') {
      const ANALYTICS_DB = join(homedir(), '.linkedin-mcp', 'analytics.db');
      if (!existsSync(ANALYTICS_DB)) return json(res, { error: 'analytics.db not found' });
      const adb = new Database(ANALYTICS_DB);

      // Ensure tables
      adb.exec(`CREATE TABLE IF NOT EXISTS content_type_map (
        post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
        post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
        language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]',
        classified_at TEXT DEFAULT (datetime('now'))
      )`);
      adb.exec(`CREATE TABLE IF NOT EXISTS hashtag_performance (
        hashtag TEXT PRIMARY KEY, usage_count INTEGER DEFAULT 0,
        avg_reactions REAL DEFAULT 0, avg_impressions REAL DEFAULT 0, avg_comments REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )`);

      // 1. Seed content_type_map from scheduler
      const sdb = getDb();
      const published = sdb.prepare("SELECT post_urn, text, publish_at, language, media_ids, article_url FROM scheduled_posts WHERE status = 'published' AND post_urn IS NOT NULL").all();
      sdb.close();

      const ctUpsert = adb.prepare(`INSERT OR REPLACE INTO content_type_map (post_urn, content_type, post_length, publish_hour, publish_day_of_week, language, hashtag_count, hashtags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

      let classified = 0;
      for (const p of published) {
        let contentType = 'text';
        if (p.media_ids) { try { const ids = JSON.parse(p.media_ids); if (ids.length > 0) contentType = 'image'; } catch {} }
        if (p.article_url) contentType = 'article';

        const hashtagRegex = /#(\w+)/g;
        const hashtags = [];
        let m;
        while ((m = hashtagRegex.exec(p.text || '')) !== null) hashtags.push(m[1].toLowerCase());

        let pubHour = null, pubDow = null;
        if (p.publish_at) {
          const d = new Date(p.publish_at);
          pubHour = d.getHours();
          pubDow = d.getDay();
          pubDow = pubDow === 0 ? 6 : pubDow - 1;
        }

        const r = ctUpsert.run(p.post_urn, contentType, (p.text || '').length, pubHour, pubDow, p.language || 'en', hashtags.length, JSON.stringify(hashtags));
        if (r.changes > 0) classified++;
      }

      // 2. Refresh hashtag_performance
      let hashRows = [];
      try {
        hashRows = adb.prepare(`
          SELECT ctm.hashtags, sm.like_count, sm.praise_count, sm.empathy_count, sm.interest_count, sm.appreciation_count, sm.entertainment_count, sm.comment_count
          FROM content_type_map ctm JOIN social_metadata sm ON ctm.post_urn = sm.post_urn WHERE ctm.hashtags != '[]'
        `).all();
      } catch {}

      const hashStats = {};
      for (const r of hashRows) {
        let tags; try { tags = JSON.parse(r.hashtags); } catch { continue; }
        const reactions = (r.like_count||0)+(r.praise_count||0)+(r.empathy_count||0)+(r.interest_count||0)+(r.appreciation_count||0)+(r.entertainment_count||0);
        for (const tag of tags) {
          if (!hashStats[tag]) hashStats[tag] = { count: 0, totalReactions: 0, totalComments: 0 };
          hashStats[tag].count++;
          hashStats[tag].totalReactions += reactions;
          hashStats[tag].totalComments += r.comment_count || 0;
        }
      }
      const hpUpsert = adb.prepare("INSERT OR REPLACE INTO hashtag_performance (hashtag, usage_count, avg_reactions, avg_comments, updated_at) VALUES (?, ?, ?, ?, datetime('now'))");
      for (const [tag, stats] of Object.entries(hashStats)) {
        hpUpsert.run(tag, stats.count, Math.round(stats.totalReactions/stats.count*10)/10, Math.round(stats.totalComments/stats.count*10)/10);
      }

      adb.close();
      return json(res, { ok: true, classified, hashtags_updated: Object.keys(hashStats).length, total_posts: published.length });
    }

    // ── /api/threads (pamięć wątków komentarzy) ──────────────────────────

    if (method === 'GET' && path === '/api/threads') {
      const db = getEngageDb(true);
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS thread_memory (
          id INTEGER PRIMARY KEY AUTOINCREMENT, post_urn TEXT NOT NULL,
          post_text TEXT, post_author TEXT, post_url TEXT,
          thread_json TEXT, our_replies_json TEXT,
          last_scraped_at TEXT DEFAULT (datetime('now')),
          comment_count INTEGER DEFAULT 0, needs_review BOOLEAN DEFAULT 0,
          post_published_at TEXT,
          UNIQUE(post_urn)
        )`);
      } catch {}
      const u = new URL(req.url, 'http://localhost');
      const hasReply = u.searchParams.get('has_reply') || 'all';
      const q = (u.searchParams.get('q') || '').trim();
      const since = (u.searchParams.get('since') || '').trim();
      const sortKey = u.searchParams.get('sort') || 'published_desc';
      const SORT_MAP = {
        published_desc: 'COALESCE(post_published_at, last_scraped_at) DESC',
        published_asc:  'COALESCE(post_published_at, last_scraped_at) ASC',
        comments_desc:  'comment_count DESC, COALESCE(post_published_at, last_scraped_at) DESC',
        scraped_desc:   'last_scraped_at DESC',
        no_reply_first: '(our_replies_json IS NOT NULL AND our_replies_json != \'[]\') ASC, COALESCE(post_published_at, last_scraped_at) DESC',
      };
      const orderBy = SORT_MAP[sortKey] || SORT_MAP.published_desc;
      const where = [];
      const params = [];
      if (hasReply === '1') where.push("(our_replies_json IS NOT NULL AND our_replies_json != '[]')");
      else if (hasReply === '0') where.push("(our_replies_json IS NULL OR our_replies_json = '[]')");
      if (q) { where.push("post_text LIKE ?"); params.push('%' + q + '%'); }
      if (since) { where.push("COALESCE(post_published_at, last_scraped_at) >= ?"); params.push(since); }
      const sql = `SELECT * FROM thread_memory ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT 100`;
      const rows = db.prepare(sql).all(...params);
      db.close();
      return json(res, rows);
    }

    // POST /api/threads/backfill — uruchom backfill (long-running, background)
    if (method === 'POST' && path === '/api/threads/backfill') {
      const body = await parseBody(req).catch(() => ({}));
      const limit = parseInt(body.limit, 10) || 5;
      const dryRun = body.dry_run ? '--dry-run' : '';
      try {
        // Background spawn — nie blokujemy response
        const child = spawn('node', [
          'scripts/backfill-comments.mjs',
          '--limit', String(limit),
          ...(dryRun ? ['--dry-run'] : []),
        ], { cwd: MCP_DIR, detached: true, stdio: 'ignore' });
        child.unref();
        return json(res, { ok: true, pid: child.pid, limit, dryRun: !!body.dry_run, message: 'Backfill uruchomiony w tle. Logi: tail -f playwright-comments.log' });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }

    if (method === 'GET' && path === '/api/playwright-cycles') {
      const db = getEngageDb(true);
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS playwright_cycles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at TEXT DEFAULT (datetime('now')), ended_at TEXT,
          posts_checked INTEGER DEFAULT 0, proposals_created INTEGER DEFAULT 0,
          errors INTEGER DEFAULT 0, notes TEXT
        )`);
      } catch {}
      const rows = db.prepare("SELECT * FROM playwright_cycles ORDER BY started_at DESC LIMIT 30").all();
      db.close();
      return json(res, rows);
    }

    // ── /api/proposals ────────────────────────────────────────────────────

    // GET /api/proposals — lista propozycji (pending/all)
    // Filtr "already_replied_in_thread": jeśli w thread_context (scrapowany dialog) po komentarzu
    // źródłowym pojawia się nasza wypowiedź ("Bartosz Gaca: ..."), oznaczamy propozycję jako follow-up.
    // Domyślnie ukrywamy follow-upy; UI checkbox `include_replied=1` je przywraca.
    if (method === 'GET' && path === '/api/proposals') {
      const status = url.searchParams.get('status') || 'pending';
      const includeReplied = url.searchParams.get('include_replied') === '1';
      const minScore = parseFloat(url.searchParams.get('min_score') || '0');
      const db = getEngageDb(true);
      // Iter3: ORDER BY blocked-last + composite_score DESC + created_at fallback
      const sortClause = "ORDER BY (status = 'blocked') ASC, COALESCE(composite_score, 0) DESC, created_at DESC";
      const rows = status === 'all'
        ? db.prepare("SELECT * FROM reply_proposals " + sortClause + " LIMIT 100").all()
        : db.prepare("SELECT * FROM reply_proposals WHERE status = ? " + sortClause + " LIMIT 100").all(status);
      // Cache nasze nazwy autora (z thread_memory.post_author per post_urn, fallback "Bartosz Gaca")
      const authors = new Map();
      const ourNames = ['Bartosz Gaca'];
      for (const r of rows) {
        if (!authors.has(r.post_urn)) {
          const tm = db.prepare("SELECT post_author FROM thread_memory WHERE post_urn = ?").get(r.post_urn);
          authors.set(r.post_urn, tm?.post_author || 'Bartosz Gaca');
        }
      }
      // Wzbogać każdy wiersz o flagę already_replied_in_thread + composite_score.
      // DETERMINISTYCZNIE: follow-up = mamy NASZĄ odpowiedź będącą BEZPOŚREDNIM dzieckiem TEGO komentarza
      // (thread_comments.parent_comment_urn = source_id AND is_our_comment=1). Stary heurystyk po
      // płaskim thread_context błędnie ukrywał CUDZE nieodpowiedziane komentarze na ruchliwych postach.
      const childStmt = db.prepare("SELECT 1 FROM thread_comments WHERE parent_comment_urn = ? AND is_our_comment = 1 LIMIT 1");
      const annotated = rows.map((r) => {
        let alreadyReplied = 0;
        try { if (r.source_id && childStmt.get(r.source_id)) alreadyReplied = 1; } catch {}
        const composite = r.composite_score != null ? r.composite_score : computeComposite(r);
        return { ...r, already_replied_in_thread: alreadyReplied, composite_score: composite };
      });
      db.close();
      let filtered = (status === 'pending' && !includeReplied)
        ? annotated.filter((r) => !r.already_replied_in_thread)
        : annotated;
      if (minScore > 0) filtered = filtered.filter((r) => (r.composite_score || 0) >= minScore);
      const followUpCount = annotated.filter((r) => r.already_replied_in_thread).length;
      const blockedCount = annotated.filter((r) => r.status === 'blocked').length;
      return json(res, { rows: filtered, total: annotated.length, follow_ups: followUpCount, blocked: blockedCount });
    }

    // PUT /api/proposals/:id — edytuj treść propozycji
    if (method === 'PUT' && path.match(/^\/api\/proposals\/\d+$/)) {
      const id = parseInt(path.split('/').pop(), 10);
      const body = await parseBody(req);
      const db = getEngageDb(false);
      // Capture original Claude reply on first edit (if not already set)
      db.prepare(
        "UPDATE reply_proposals SET original_reply = proposed_reply WHERE id = ? AND (original_reply IS NULL OR original_reply = '')"
      ).run(id);
      const result = db.prepare(
        "UPDATE reply_proposals SET proposed_reply = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
      ).run(body.proposed_reply || '', id);
      const row = db.prepare("SELECT * FROM reply_proposals WHERE id = ?").get(id);
      db.close();
      if (!result.changes) return json(res, { error: 'Not found or already sent' }, 404);
      return json(res, row);
    }

    // POST /api/proposals/:id/regenerate — „Twoja wskazówka → AI pisze treść" (Opus 4.8 + fact-check)
    if (method === 'POST' && path.match(/^\/api\/proposals\/\d+\/regenerate$/)) {
      const id = parseInt(path.split('/')[3], 10);
      const body = await parseBody(req).catch(() => ({}));
      const hint = (body.hint || '').toString().slice(0, 800);

      const rdb = getEngageDb(true);
      const prop = rdb.prepare("SELECT * FROM reply_proposals WHERE id = ?").get(id);
      if (!prop) { rdb.close(); return json(res, { error: 'Not found' }, 404); }
      if (prop.status !== 'pending' && prop.status !== 'blocked') {
        rdb.close();
        return json(res, { error: 'Regenerować można tylko propozycję pending/blocked' }, 409);
      }
      const tcRows = rdb.prepare(
        "SELECT comment_urn, parent_comment_urn, author_name, comment_text, is_our_comment FROM thread_comments WHERE post_urn = ? ORDER BY id ASC"
      ).all(prop.post_urn);
      const tm = rdb.prepare("SELECT post_text, post_author FROM thread_memory WHERE post_urn = ?").get(prop.post_urn);
      rdb.close();

      const thread = tcRows.map(c => ({
        author: c.author_name, text: c.comment_text,
        isOurs: c.is_our_comment === 1, isReply: !!c.parent_comment_urn, commentUrn: c.comment_urn,
      }));
      const ourReplies = thread.filter(c => c.isOurs).map(c => c.text);
      const postText = tm?.post_text || prop.post_text || '';
      const postAuthor = tm?.post_author || 'Bartosz Gaca';
      const targetComment = { author: prop.source_author || '', text: prop.source_text || '', commentUrn: prop.source_id };
      const threadContext = prop.thread_context || thread.map(c => `${c.author}: "${c.text}"`).join('\n');
      const persona = loadPersona();
      const kb = retrieveKnowledge((prop.source_text || '') + ' ' + postText + ' ' + hint);

      try {
        const prompt = buildPrompt({ persona, postText, postAuthor, thread, ourReplies, targetComment, hint, knowledge: kb.text });
        const parsed = parseClaudeJson(await callClaude(prompt, {}));
        if (!parsed || !parsed.reply) return json(res, { error: 'Opus 4.8 nie zwrócił poprawnej odpowiedzi' }, 502);

        // Fact-check (C) — potwierdź że nie kłamie (z bazą wiedzy jako grounded)
        let reply = parsed.reply;
        const extraNotes = [];
        try {
          const fc = await factCheck({ postText, threadContext, proposedReply: reply, persona, knowledge: kb.text }, {});
          if (fc.grounded === false) {
            if (fc.fixed_reply) reply = fc.fixed_reply;
            else extraNotes.push('HALLUCINATION_RISK', ...fc.unsupported_claims.slice(0, 3).map(c => 'CLAIM:' + String(c).slice(0, 60)));
          }
        } catch {}

        const notes = [...validateProposal({ proposedReply: reply, sourceText: prop.source_text }, null), ...extraNotes];
        const status = notes.length ? 'blocked' : 'pending';

        const wdb = getEngageDb(false);
        wdb.prepare("UPDATE reply_proposals SET original_reply = proposed_reply WHERE id = ? AND (original_reply IS NULL OR original_reply = '')").run(id);
        wdb.prepare(
          "UPDATE reply_proposals SET proposed_reply = ?, status = ?, validation_notes = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(reply, status, notes.length ? JSON.stringify(notes) : null, id);
        const row = wdb.prepare("SELECT * FROM reply_proposals WHERE id = ?").get(id);
        wdb.close();
        return json(res, { ok: true, proposed_reply: reply, status, validation_notes: notes, hint_used: !!hint, row });
      } catch (e) {
        return json(res, { error: 'Regenerate failed: ' + e.message }, 500);
      }
    }

    // GET /api/comment-engine/health — funkcjonalny health silnika komentarzy (H)
    if (method === 'GET' && path === '/api/comment-engine/health') {
      const db = getEngageDb(true);
      let hb = null, lastScrape = null, pending = 0, blocked = 0, unanswered = 0;
      try { hb = db.prepare("SELECT * FROM daemon_health WHERE id = 1").get(); } catch {}
      try { lastScrape = db.prepare("SELECT MAX(last_scraped_at) AS t FROM thread_memory").get()?.t; } catch {}
      try { pending = db.prepare("SELECT COUNT(*) c FROM reply_proposals WHERE status='pending'").get()?.c || 0; } catch {}
      try { blocked = db.prepare("SELECT COUNT(*) c FROM reply_proposals WHERE status='blocked'").get()?.c || 0; } catch {}
      try {
        unanswered = db.prepare(
          "SELECT COUNT(*) c FROM thread_comments tc WHERE tc.is_our_comment=0 AND NOT EXISTS (SELECT 1 FROM reply_proposals rp WHERE rp.source_id = tc.comment_urn) AND NOT EXISTS (SELECT 1 FROM thread_comments r WHERE r.parent_comment_urn = tc.comment_urn AND r.is_our_comment=1)"
        ).get()?.c || 0;
      } catch {}
      db.close();

      const now = Date.now();
      const mins = (t) => (t ? (now - new Date(t.replace(' ', 'T') + 'Z').getTime()) / 60000 : Infinity);
      const sinceRun = mins(hb?.last_run_at);
      const sinceScrape = mins(lastScrape);
      const zeros = hb?.consecutive_zero || 0;
      let color = 'green', reasons = [];
      if (sinceRun > 90) { color = 'red'; reasons.push(`brak cyklu ${Math.round(sinceRun)} min`); }
      if (zeros >= 3) { color = 'red'; reasons.push(`${zeros}× cykl 0 postów`); }
      if (sinceScrape > 180) { color = 'red'; reasons.push(`drzewko stare ${Math.round(sinceScrape)} min`); }
      if (color === 'green' && (hb?.posts_checked === 0)) { color = 'yellow'; reasons.push('ostatni cykl 0 postów'); }
      return json(res, {
        color, reasons,
        last_run_at: hb?.last_run_at || null, last_ok_at: hb?.last_ok_at || null,
        last_scrape_at: lastScrape || null, consecutive_zero: zeros,
        pending, blocked, unanswered,
      });
    }

    // POST /api/comment-engine/fetch-all — „Pobierz wszystkie komentarze i odpowiedzi" (M)
    // Wymusza natychmiastowy pełny cykl daemona (sweep wszystkich postów → scrape komentarzy
    // + nested replies → odświeżenie drzewka + generacja). Respektuje lock profilu Chrome.
    if (method === 'POST' && path === '/api/comment-engine/fetch-all') {
      try {
        const uid = process.getuid();
        execSync(`launchctl kickstart -k gui/${uid}/com.gaca.linkedin-playwright-comments`, { timeout: 8000 });
        return json(res, { ok: true, info: 'Uruchomiono pełny skan wszystkich postów. Drzewko i propozycje odświeżą się za 1-3 min (po cyklu).' });
      } catch (e) {
        return json(res, { error: 'Nie udało się uruchomić skanu: ' + e.message }, 500);
      }
    }

    // POST /api/posts/:urn/fetch-comments — „Pobierz komentarze DO TEGO POSTU" z LinkedIn (priorytet)
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/fetch-comments$/)) {
      const postUrn = decodeURIComponent(path.split('/')[3]);
      try {
        const db = getEngageDb(false);
        db.exec(`CREATE TABLE IF NOT EXISTS priority_scrape (post_urn TEXT PRIMARY KEY, requested_at TEXT DEFAULT (datetime('now')))`);
        db.prepare(`INSERT OR REPLACE INTO priority_scrape (post_urn, requested_at) VALUES (?, datetime('now'))`).run(postUrn);
        db.close();
        try { execSync(`launchctl kickstart -k gui/${process.getuid()}/com.gaca.linkedin-playwright-comments`, { timeout: 8000 }); } catch {}
        return json(res, { ok: true, info: 'Zlecono pobranie pełnego wątku tego postu z LinkedIn (priorytet). Odśwież drzewko za 1-2 min.' });
      } catch (e) { return json(res, { error: e.message }, 500); }
    }

    // POST /api/comments/reply-with-ai — „✍️ Odpisz z AI" dla KONKRETNEGO komentarza (z drzewka).
    // Deterministyczne: propozycja twardo przypięta do source_id = comment_urn → Playwright wyśle DOKŁADNIE tam.
    if (method === 'POST' && path === '/api/comments/reply-with-ai') {
      const body = await parseBody(req).catch(() => ({}));
      const commentUrn = (body.comment_urn || '').toString();
      const postUrn = (body.post_urn || '').toString();
      const hint = (body.hint || '').toString().slice(0, 800);
      if (!commentUrn || commentUrn.indexOf('urn:') !== 0) {
        return json(res, { error: 'Brak realnego URN komentarza — nie mogę deterministycznie odpisać (kliknij „🔄 Pobierz świeże").' }, 400);
      }
      const rdb = getEngageDb(true);
      const tm = rdb.prepare("SELECT post_text, post_author FROM thread_memory WHERE post_urn = ?").get(postUrn);
      const tcRows = rdb.prepare("SELECT comment_urn, parent_comment_urn, author_name, comment_text, is_our_comment FROM thread_comments WHERE post_urn = ? ORDER BY id ASC").all(postUrn);
      const tgt = tcRows.find(c => c.comment_urn === commentUrn);
      const existing = rdb.prepare("SELECT id, status FROM reply_proposals WHERE type='comment' AND source_id = ? ORDER BY id DESC LIMIT 1").get(commentUrn);
      rdb.close();
      const srcText = (body.comment_text || (tgt && tgt.comment_text) || '').toString();
      const author = (body.author || (tgt && tgt.author_name) || '').toString();

      const thread = tcRows.map(c => ({ author: c.author_name, text: c.comment_text, isOurs: c.is_our_comment === 1, isReply: !!c.parent_comment_urn, commentUrn: c.comment_urn }));
      const ourReplies = thread.filter(c => c.isOurs).map(c => c.text);
      const postText = (tm && tm.post_text) || '';
      const postAuthor = (tm && tm.post_author) || 'Bartosz Gaca';
      const threadContext = thread.map(c => `${c.author}: "${c.text}"`).join('\n');
      const persona = loadPersona();
      const kb = retrieveKnowledge(srcText + ' ' + postText + ' ' + hint);

      try {
        const prompt = buildPrompt({ persona, postText, postAuthor, thread, ourReplies, targetComment: { author, text: srcText, commentUrn }, hint, knowledge: kb.text });
        const parsed = parseClaudeJson(await callClaude(prompt, {}));
        if (!parsed || !parsed.reply) return json(res, { error: 'Opus 4.8 nie zwrócił odpowiedzi' }, 502);
        let reply = parsed.reply;
        const extraNotes = [];
        try {
          const fc = await factCheck({ postText, threadContext, proposedReply: reply, persona, knowledge: kb.text }, {});
          if (fc.grounded === false) { if (fc.fixed_reply) reply = fc.fixed_reply; else extraNotes.push('HALLUCINATION_RISK', ...fc.unsupported_claims.slice(0, 3).map(c => 'CLAIM:' + String(c).slice(0, 60))); }
        } catch {}
        const notes = [...validateProposal({ proposedReply: reply, sourceText: srcText }, null), ...extraNotes];
        const status = notes.length ? 'blocked' : 'pending';

        const wdb = getEngageDb(false);
        let id;
        if (existing && (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'blocked')) {
          wdb.prepare("UPDATE reply_proposals SET proposed_reply=?, status=?, validation_notes=?, source_text=?, source_author=?, post_text=?, parent_in_tree=?, updated_at=datetime('now') WHERE id=?")
            .run(reply, status, notes.length ? JSON.stringify(notes) : null, srcText, author, postText.slice(0, 500), commentUrn, existing.id);
          id = existing.id;
        } else {
          const r = wdb.prepare(`INSERT INTO reply_proposals
            (type, source_id, source_text, source_author, post_urn, post_text, proposed_reply, original_reply, parent_in_tree, status, validation_notes)
            VALUES ('comment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(commentUrn, srcText, author, postUrn, postText.slice(0, 500), reply, reply, commentUrn, status, notes.length ? JSON.stringify(notes) : null);
          id = r.lastInsertRowid;
        }
        wdb.close();
        return json(res, { ok: true, id, proposed_reply: reply, status, validation_notes: notes, target: author });
      } catch (e) { return json(res, { error: 'reply-with-ai: ' + e.message }, 500); }
    }

    // GET /api/proposals/:id/context — full post text + thread tree (who wrote what)
    if (method === 'GET' && path.match(/^\/api\/proposals\/\d+\/context$/)) {
      const id = parseInt(path.split('/')[3], 10);
      const db = getEngageDb(true);
      const prop = db.prepare("SELECT id, post_urn, source_id, post_text, thread_context FROM reply_proposals WHERE id = ?").get(id);
      if (!prop) { db.close(); return json(res, { error: 'Not found' }, 404); }
      const tm = db.prepare("SELECT post_text, post_author, post_url, our_replies_json FROM thread_memory WHERE post_urn = ?").get(prop.post_urn);
      db.close();
      // Iter7: użyj shared buildCommentsTree (refactor)
      const { tree } = buildCommentsTree(prop.post_urn, prop.source_id);
      let ourReplies = [];
      try { ourReplies = JSON.parse(tm?.our_replies_json || '[]'); } catch {}
      return json(res, {
        post_text: tm?.post_text || prop.post_text || '',
        post_author: tm?.post_author || 'Bartosz Gaca',
        post_url: tm?.post_url || (prop.post_urn ? 'https://www.linkedin.com/feed/update/' + encodeURIComponent(prop.post_urn) + '/' : null),
        target_comment_urn: prop.source_id,
        tree,
        our_replies: ourReplies,
      });
    }

    // Iter7: GET /api/posts/:urn/comments-tree — drzewko komentarzy dla dowolnego post_urn
    if (method === 'GET' && path.match(/^\/api\/posts\/[^/]+\/comments-tree$/)) {
      const postUrn = decodeURIComponent(path.split('/')[3]);
      return json(res, buildCommentsTree(postUrn, null));
    }

    // POST /api/proposals/:id/revert — restore Claude's original reply
    if (method === 'POST' && path.match(/^\/api\/proposals\/\d+\/revert$/)) {
      const id = parseInt(path.split('/')[3], 10);
      const db = getEngageDb(false);
      const result = db.prepare(
        "UPDATE reply_proposals SET proposed_reply = original_reply, updated_at = datetime('now') WHERE id = ? AND status = 'pending' AND original_reply IS NOT NULL"
      ).run(id);
      const row = db.prepare("SELECT * FROM reply_proposals WHERE id = ?").get(id);
      db.close();
      if (!result.changes) return json(res, { error: 'Cannot revert (no original, or already sent)' }, 404);
      return json(res, row);
    }

    // POST /api/proposals/:id/send — APPROVE propozycję (Playwright sender wyśle ją asynchronicznie)
    if (method === 'POST' && path.match(/^\/api\/proposals\/\d+\/send$/)) {
      const id = parseInt(path.split('/')[3], 10);
      const db = getEngageDb(false);
      const prop = db.prepare("SELECT * FROM reply_proposals WHERE id = ? AND status = 'pending'").get(id);
      if (!prop) { db.close(); return json(res, { error: 'Not found or already sent' }, 404); }

      if (prop.type === 'dm') {
        // DM: ręcznie przez LinkedIn UI (Voyager API ma bany)
        db.prepare("UPDATE reply_proposals SET status='sent', sent_at=datetime('now'), sent_via='manual_dm', updated_at=datetime('now') WHERE id=?").run(id);
        db.close();
        return json(res, { ok: true, manual: true, copy_text: prop.proposed_reply, url: 'https://www.linkedin.com/messaging/', info: 'Skopiuj tekst i wyślij przez LinkedIn Messaging' });
      }

      // Comment: approval queue — Playwright sender (auto-comment-sender.mjs) wyśle gdy będzie cykl
      db.prepare("UPDATE reply_proposals SET status='approved', approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id);
      db.close();
      return json(res, {
        ok: true,
        queued: true,
        info: 'Zatwierdzone — Playwright sender wyśle automatycznie w ciągu kilku/kilkudziesięciu minut (losowy delay 5-30 min, human-like)',
      });
    }

    // POST /api/proposals/:id/reject — odrzuć propozycję
    if (method === 'POST' && path.match(/^\/api\/proposals\/\d+\/reject$/)) {
      const id = parseInt(path.split('/')[3], 10);
      const db = getEngageDb(false);
      const result = db.prepare("UPDATE reply_proposals SET status='rejected', updated_at=datetime('now') WHERE id=?").run(id);
      db.close();
      if (!result.changes) return json(res, { error: 'Not found' }, 404);
      return json(res, { ok: true });
    }

    // ── /api/posts/queue-unified — scalony widok kolejki + pomysłów + media ──
    if (method === 'GET' && path === '/api/posts/queue-unified') {
      const db = getDb();
      // 1) Scheduled (kolejka postów do publikacji)
      const scheduled = db.prepare(`
        SELECT sp.id, sp.text, sp.publish_at, sp.language, sp.status, sp.visibility,
               sp.media_preview_path, sp.media_kind, sp.gemini_prompt, sp.media_ids, sp.text_alt, sp.banner_preset,
               mpi.slug AS mp_slug, mpi.title AS mp_title, mpi.topic_number AS mp_topic_number,
               mpi.visual_asset_path AS mp_visual_path, mpi.visual_asset_type AS mp_visual_type,
               mpi.banner_path AS mp_banner_path, mpi.source_project AS mp_source_project
        FROM scheduled_posts sp
        LEFT JOIN media_plan_items mpi ON mpi.scheduled_post_id = sp.id
        WHERE sp.status IN ('scheduled', 'approved')
        ORDER BY sp.publish_at ASC
      `).all();

      // 2) Pomysły (status='plan' w media_plan_items, jeszcze nie napisane)
      const proposed = db.prepare(`
        SELECT id, slug, topic_number, title, hook, format, language, publish_at,
               source_project, lead_trigger, cta, hashtags,
               banner_path, visual_asset_path, visual_asset_type, banner_concept
        FROM media_plan_items
        WHERE status = 'plan'
        ORDER BY topic_number ASC
      `).all();

      // 3) Ostatnio opublikowane (kontekst — co poszło live)
      const recentPublished = db.prepare(`
        SELECT sp.id, sp.text, sp.published_at, sp.post_urn, sp.language,
               mpi.slug AS mp_slug, mpi.visual_asset_path AS mp_visual_path
        FROM scheduled_posts sp
        LEFT JOIN media_plan_items mpi ON mpi.scheduled_post_id = sp.id
        WHERE sp.status = 'published' AND sp.published_at IS NOT NULL
        ORDER BY sp.published_at DESC
        LIMIT 10
      `).all();

      const counts = {
        scheduled: scheduled.length,
        proposed: proposed.length,
        published_30d: db.prepare(`SELECT COUNT(*) AS n FROM scheduled_posts WHERE status='published' AND published_at >= datetime('now','-30 days')`).get().n,
        plan_in_media: db.prepare(`SELECT COUNT(*) AS n FROM media_plan_items WHERE status='plan'`).get().n,
        napisane_in_media: db.prepare(`SELECT COUNT(*) AS n FROM media_plan_items WHERE status='napisane'`).get().n,
      };
      db.close();

      // Enrich każdy z tagiem `has_media` i ścieżką relatywną dla UI (jeśli istnieje)
      const enrichMedia = (row) => {
        const visualPath = row.mp_visual_path || row.visual_asset_path || row.banner_path || row.mp_banner_path || row.media_preview_path;
        const visualType = row.mp_visual_type || row.visual_asset_type || (row.banner_preset ? 'banner' : null) || (row.media_kind === 'carousel' ? 'carousel' : null);
        const hasMedia = !!visualPath;
        // Ścieżka serwowalna przez dashboard: /mp-banner/:slug lub /media/:filename (TODO endpoint)
        let mediaUrl = null;
        if (visualPath) {
          if (visualPath.includes('/images/posts/')) {
            mediaUrl = `/media-image/${encodeURIComponent(row.slug || row.mp_slug || row.id)}`;
          } else if (visualPath.includes('banner')) {
            mediaUrl = `/mp-banner/${encodeURIComponent(row.slug || row.mp_slug || row.id)}`;
          }
        }
        return { ...row, has_media: hasMedia, visual_type: visualType, visual_path: visualPath, media_url: mediaUrl };
      };

      return json(res, {
        scheduled: scheduled.map(enrichMedia),
        proposed: proposed.map(enrichMedia),
        recent_published: recentPublished.map(enrichMedia),
        counts,
      });
    }

    // GET /media-image/:slug — serve obrazek z ~/.linkedin-mcp/images/posts/<slug>.png (NVIDIA FLUX outputs)
    // Auto-detect Content-Type po magic bytes - NVIDIA czasem zwraca JPG mimo .png extension.
    if (method === 'GET' && path.startsWith('/media-image/')) {
      const slug = decodeURIComponent(path.split('/').pop());
      const imgPath = join(homedir(), '.linkedin-mcp', 'images', 'posts', `${slug}.png`);
      if (!existsSync(imgPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      const buf = readFileSync(imgPath);
      // Magic bytes detection
      let contentType = 'image/png';
      if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) contentType = 'image/jpeg';
      else if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) contentType = 'image/png';
      else if (buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) contentType = 'image/webp';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=300' });
      return res.end(buf);
    }

    // POST /api/media-plan/:id/regenerate — odpal regenerate-posts.mjs --slug=<> w tle (przycisk "Przerób na post")
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/regenerate$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const item = db.prepare("SELECT slug FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);

      const script = '/Users/gaca/projects/personal/linkedin-mcp-server/scripts/regenerate-posts.mjs';
      const child = spawn('node', [script, `--slug=${item.slug}`, '--auto-schedule'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return json(res, { ok: true, started: true, slug: item.slug, pid: child.pid, hint: 'Odśwież /api/posts/queue-unified za 60-180s' });
    }

    // ── /api/media-plan ────────────────────────────────────────────────────

    // GET /api/media-plan — list all 12 items, optional ?status= filter
    if (method === 'GET' && path === '/api/media-plan') {
      const db = getDb();
      const status = url.searchParams.get('status');
      let rows;
      if (status) {
        rows = db.prepare("SELECT * FROM media_plan_items WHERE status = ? ORDER BY topic_number").all(status);
      } else {
        rows = db.prepare("SELECT * FROM media_plan_items ORDER BY topic_number").all();
      }
      const settings = db.prepare("SELECT key, value FROM media_plan_settings").all();
      db.close();
      const settingsObj = Object.fromEntries(settings.map(s => [s.key, s.value]));
      // Counts by status
      const counts = { plan: 0, napisane: 0, opublikowane: 0, gsc_verified: 0, cancelled: 0 };
      for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
      return json(res, { items: rows, counts, settings: settingsObj });
    }

    // GET /api/media-plan/:id — single item
    if (method === 'GET' && path.match(/^\/api\/media-plan\/[^/]+$/)) {
      const id = path.split('/').pop();
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);
      return json(res, item);
    }

    // PUT /api/media-plan/:id — update mutable fields
    if (method === 'PUT' && path.match(/^\/api\/media-plan\/[^/]+$/)) {
      const id = path.split('/').pop();
      const body = await parseBody(req);
      const allowed = [
        'post_text', 'hook', 'title', 'hashtags', 'cta', 'lead_trigger',
        'banner_path', 'visual_asset_path', 'visual_asset_type',
        'wiki_slug', 'publish_at', 'language',
        'cannibalize_status'
      ];
      const updates = [];
      const values = [];
      for (const k of allowed) {
        if (body[k] !== undefined) {
          updates.push(`${k} = ?`);
          values.push(body[k]);
        }
      }
      if (updates.length === 0) return json(res, { error: 'No fields to update' }, 400);
      const db = getDb(false);
      const sql = `UPDATE media_plan_items SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ? OR slug = ?`;
      const result = db.prepare(sql).run(...values, id, id);
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!result.changes) return json(res, { error: 'Not found' }, 404);
      return json(res, item);
    }

    // POST /api/media-plan/:id/check-cannibalize — Jaccard match vs bartoszgaca.pl articles
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/check-cannibalize$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      if (!item) { db.close(); return json(res, { error: 'Not found' }, 404); }

      const ARTICLES_DIR = '/Users/gaca/projects/personal/bartoszgaca.pl/data/articles';
      const tokenize = (s) => (s || '').toLowerCase()
        .replace(/[^a-ząćęłńóśźż0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3);
      const jaccard = (a, b) => {
        const A = new Set(a), B = new Set(b);
        const inter = [...A].filter(x => B.has(x)).length;
        const union = new Set([...A, ...B]).size;
        return union === 0 ? 0 : inter / union;
      };

      const itemTokens = tokenize(`${item.title || ''} ${item.hook || ''} ${item.hashtags || ''}`);

      const overlaps = [];
      try {
        const { readdirSync, readFileSync } = await import('fs');
        const files = readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.ts') && f !== 'index.ts');
        for (const f of files) {
          const slug = f.replace(/\.ts$/, '');
          const content = readFileSync(`${ARTICLES_DIR}/${f}`, 'utf-8');
          const titleM = content.match(/title:\s*"([^"]+)"/);
          const title = titleM ? titleM[1] : slug;
          const articleTokens = tokenize(`${title} ${slug}`);
          const score = jaccard(itemTokens, articleTokens);
          if (score >= 0.15) overlaps.push({ slug, title, score: +score.toFixed(3) });
        }
      } catch (e) {
        db.close();
        return json(res, { error: `Failed to read articles: ${e.message}` }, 500);
      }

      overlaps.sort((a, b) => b.score - a.score);
      const top3 = overlaps.slice(0, 3);
      const maxScore = overlaps[0]?.score || 0;
      const status = maxScore >= 0.4 ? 'strong' : maxScore >= 0.2 ? 'weak' : 'clear';

      db.prepare(`UPDATE media_plan_items SET cannibalize_status = ?, cannibalize_overlaps = ?, cannibalize_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(status, JSON.stringify(top3), item.id);
      db.close();

      return json(res, { status, overlaps: top3, total_checked: overlaps.length, max_score: maxScore });
    }

    // PUT /api/media-plan/settings/:key — toggle (e.g. gsc_auto_submit)
    if (method === 'PUT' && path.match(/^\/api\/media-plan\/settings\/[^/]+$/)) {
      const key = path.split('/').pop();
      const body = await parseBody(req);
      if (typeof body.value !== 'string') return json(res, { error: 'value (string) required' }, 400);
      const db = getDb(false);
      db.prepare("INSERT OR REPLACE INTO media_plan_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, body.value);
      db.close();
      return json(res, { ok: true, key, value: body.value });
    }

    // POST /api/media-plan/:id/transition — change status with validation
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/transition$/)) {
      const id = path.split('/')[3];
      const body = await parseBody(req);
      const to = body.to;
      const db = getDb(false);
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      if (!item) { db.close(); return json(res, { error: 'Not found' }, 404); }

      const errors = [];
      if (to === 'napisane') {
        if (item.status !== 'plan' && item.status !== 'napisane') errors.push(`Can't transition from ${item.status} to napisane`);
        if (!item.post_text || item.post_text.length < 1300) errors.push(`post_text must be >= 1300 chars (now ${(item.post_text || '').length})`);
        if (!item.banner_path) errors.push('banner_path is empty');
        else if (!existsSync(item.banner_path)) errors.push(`banner file not found: ${item.banner_path}`);
        if (!item.visual_asset_path) errors.push('visual_asset_path is empty');
        else if (!existsSync(item.visual_asset_path)) errors.push(`visual asset not found: ${item.visual_asset_path}`);
        if (item.cannibalize_status === 'strong') errors.push('cannibalize_status is strong — blocks transition');
      } else if (to === 'opublikowane') {
        if (item.status !== 'napisane') errors.push(`Can't transition from ${item.status} to opublikowane`);
        if (!item.scheduled_post_id) errors.push('scheduled_post_id missing — schedule first');
      } else if (to === 'gsc_verified') {
        if (item.status !== 'opublikowane') errors.push(`Can't transition from ${item.status} to gsc_verified`);
      } else if (to === 'cancelled') {
        // any → cancelled allowed
      } else {
        errors.push(`Unknown target status: ${to}`);
      }

      if (errors.length) { db.close(); return json(res, { error: 'Validation failed', errors }, 400); }

      db.prepare("UPDATE media_plan_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, item.id);
      const updated = db.prepare("SELECT * FROM media_plan_items WHERE id = ?").get(item.id);
      db.close();
      return json(res, updated);
    }

    // POST /api/media-plan/:id/schedule — create scheduled_posts row + link
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/schedule$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      if (!item) { db.close(); return json(res, { error: 'Not found' }, 404); }
      if (item.status !== 'napisane') { db.close(); return json(res, { error: `Item must be 'napisane' (now ${item.status})` }, 400); }
      if (item.scheduled_post_id) {
        const existing = db.prepare("SELECT id, status, publish_at FROM scheduled_posts WHERE id = ?").get(item.scheduled_post_id);
        if (existing) { db.close(); return json(res, { ok: true, already: true, scheduled_post: existing }); }
      }

      const newPostId = randomUUID();
      const bannerConfig = item.banner_path ? JSON.stringify({ path: item.banner_path }) : null;
      db.prepare(`INSERT INTO scheduled_posts (id, text, visibility, language, publish_at, status, banner_config, created_at, updated_at)
                  VALUES (?, ?, 'PUBLIC', ?, ?, 'scheduled', ?, datetime('now'), datetime('now'))`)
        .run(newPostId, item.post_text, item.language, item.publish_at, bannerConfig);
      db.prepare("UPDATE media_plan_items SET scheduled_post_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newPostId, item.id);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(newPostId);
      const updated = db.prepare("SELECT * FROM media_plan_items WHERE id = ?").get(item.id);
      db.close();
      return json(res, { ok: true, scheduled_post: post, item: updated });
    }

    // POST /api/media-plan/:id/gsc-inspect — read-only index_inspect via priv-gsc
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/gsc-inspect$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);
      if (!item.wiki_slug) return json(res, { error: 'wiki_slug is empty — set it first' }, 400);

      const siteUrl = 'https://bartoszgaca.pl/';
      const inspectionUrl = siteUrl.replace(/\/$/, '') + item.wiki_slug;

      gscAuditLog(item.id, 'gsc-inspect', 'started', { inspectionUrl });
      try {
        const result = await callGSC('index_inspect', { siteUrl, inspectionUrl, languageCode: 'pl-PL' });
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, gsc_inspect_result = ?, gsc_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run('inspected', JSON.stringify(result), item.id);
        dbw.close();
        gscAuditLog(item.id, 'gsc-inspect', 'ok', result);
        return json(res, { ok: true, inspectionUrl, result });
      } catch (err) {
        gscAuditLog(item.id, 'gsc-inspect', 'error', err.message);
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, gsc_inspect_result = ?, gsc_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run('error', JSON.stringify({ error: err.message }), item.id);
        dbw.close();
        return json(res, { error: err.message }, 500);
      }
    }

    // POST /api/media-plan/:id/gsc-submit — pre-flight (page+canonical / sitemap / index_inspect) → submit_sitemap
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/gsc-submit$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      const settings = db.prepare("SELECT value FROM media_plan_settings WHERE key = 'gsc_auto_submit'").get();
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);
      if (!item.wiki_slug) return json(res, { error: 'wiki_slug is empty' }, 400);

      const siteUrl = 'https://bartoszgaca.pl/';
      const fullUrl = siteUrl.replace(/\/$/, '') + item.wiki_slug;

      gscAuditLog(item.id, 'gsc-submit', 'started', { fullUrl, auto_submit_setting: settings?.value });

      // Pre-flight 1: page exists + canonical
      let pageOk = false, canonicalUrl = null;
      try {
        const r = await fetch(fullUrl, { redirect: 'manual' });
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        const html = await r.text();
        const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
        canonicalUrl = m ? m[1] : null;
        if (canonicalUrl && canonicalUrl !== fullUrl && canonicalUrl !== fullUrl + '/') {
          throw new Error(`Canonical mismatch: ${canonicalUrl} != ${fullUrl}`);
        }
        pageOk = true;
      } catch (err) {
        gscAuditLog(item.id, 'gsc-submit', 'blocked_no_page', err.message);
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run('blocked_no_page', item.id);
        dbw.close();
        return json(res, { error: 'Pre-flight 1 failed: page check', detail: err.message }, 400);
      }

      // Pre-flight 2: URL is in sitemap
      let inSitemap = false, sitemapUrl = null;
      try {
        const sitemaps = await callGSC('list_sitemaps', { siteUrl });
        const sitemapList = sitemaps.sitemap || sitemaps.sitemaps || [];
        for (const sm of sitemapList) {
          const smPath = sm.path || sm.feedpath || '';
          if (!smPath) continue;
          try {
            const smRes = await fetch(smPath.startsWith('http') ? smPath : (siteUrl.replace(/\/$/, '') + smPath));
            if (!smRes.ok) continue;
            const xml = await smRes.text();
            if (xml.includes(fullUrl) || xml.includes(item.wiki_slug)) {
              inSitemap = true;
              sitemapUrl = smPath;
              break;
            }
          } catch {}
        }
        // Fallback: try common sitemap paths
        if (!inSitemap) {
          for (const p of ['/sitemap.xml', '/sitemap-articles.xml', '/sitemap-pages.xml']) {
            try {
              const baseUrl = siteUrl.replace(/\/$/, '');
              const r = await fetch(baseUrl + p);
              if (!r.ok) continue;
              const xml = await r.text();
              if (xml.includes(fullUrl) || xml.includes(item.wiki_slug)) {
                inSitemap = true;
                sitemapUrl = baseUrl + p;
                break;
              }
            } catch {}
          }
        }
        if (!inSitemap) throw new Error(`URL not found in any sitemap`);
      } catch (err) {
        gscAuditLog(item.id, 'gsc-submit', 'blocked_no_sitemap', err.message);
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run('blocked_no_sitemap', item.id);
        dbw.close();
        return json(res, { error: 'Pre-flight 2 failed: sitemap check', detail: err.message }, 400);
      }

      // Pre-flight 3: index_inspect — already indexed?
      let alreadyIndexed = false;
      try {
        const inspect = await callGSC('index_inspect', { siteUrl, inspectionUrl: fullUrl, languageCode: 'pl-PL' });
        const status = inspect?.indexStatusResult?.coverageState || inspect?.coverageState || '';
        if (/Submitted and indexed|Indexed/i.test(status)) {
          alreadyIndexed = true;
        }
        gscAuditLog(item.id, 'gsc-submit', 'index_check', { status, alreadyIndexed });
      } catch (err) {
        // non-fatal — proceed to resubmit
        gscAuditLog(item.id, 'gsc-submit', 'index_check_error', err.message);
      }

      if (alreadyIndexed) {
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, status = ?, gsc_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
          .run('already_indexed', 'gsc_verified', item.id);
        dbw.close();
        gscAuditLog(item.id, 'gsc-submit', 'skipped_already_indexed', { sitemapUrl });
        return json(res, { ok: true, skipped: true, reason: 'already_indexed', sitemapUrl });
      }

      // Action: resubmit sitemap to nudge Google to recrawl
      try {
        const feedpath = sitemapUrl.startsWith('http') ? sitemapUrl : (siteUrl.replace(/\/$/, '') + sitemapUrl);
        const submitRes = await callGSC('submit_sitemap', { siteUrl, feedpath });
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
          .run('submitted', 'gsc_verified', item.id);
        dbw.close();
        gscAuditLog(item.id, 'gsc-submit', 'sitemap_submitted', { feedpath, response: submitRes });
        return json(res, { ok: true, action: 'sitemap_resubmitted', sitemapUrl: feedpath });
      } catch (err) {
        gscAuditLog(item.id, 'gsc-submit', 'submit_error', err.message);
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET gsc_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run('submit_error', item.id);
        dbw.close();
        return json(res, { error: 'Submit failed', detail: err.message }, 500);
      }
    }

    // POST /api/media-plan/:id/upload — multipart upload for banner / visual asset
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/upload$/)) {
      const id = path.split('/')[3];
      const url2 = new URL(req.url, 'http://localhost:' + PORT);
      const kind = url2.searchParams.get('kind') || 'visual'; // 'banner' or 'visual'
      const filename = url2.searchParams.get('filename') || 'upload.bin';
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetDir = `/Users/gaca/projects/personal/bartoszgaca.pl/banners/2026-Q2/${item.slug}`;
      try { execSync(`mkdir -p "${targetDir}"`); } catch {}
      const finalName = kind === 'banner' ? `banner${extname(safeName) || '.png'}` : safeName;
      const targetPath = `${targetDir}/${finalName}`;

      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          writeFileSync(targetPath, Buffer.concat(chunks));
          const stats = statSync(targetPath);
          const dbw = getDb(false);
          const field = kind === 'banner' ? 'banner_path' : 'visual_asset_path';
          const typeField = kind === 'visual' ? extname(safeName).slice(1) : null;
          if (typeField) {
            dbw.prepare(`UPDATE media_plan_items SET ${field} = ?, visual_asset_type = ?, updated_at = datetime('now') WHERE id = ?`).run(targetPath, typeField, item.id);
          } else {
            dbw.prepare(`UPDATE media_plan_items SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(targetPath, item.id);
          }
          dbw.close();
          json(res, { ok: true, path: targetPath, size: stats.size, kind });
        } catch (e) {
          json(res, { error: e.message }, 500);
        }
      });
      return;
    }

    // Iter9: POST /api/media-plan/bulk-regenerate-empty — regen wszystkich postów z post_text NULL/short
    if (method === 'POST' && path === '/api/media-plan/bulk-regenerate-empty') {
      const db = getDb();
      const targets = db.prepare(`
        SELECT id, slug FROM media_plan_items
        WHERE status IN ('plan','napisane')
          AND (post_text IS NULL OR length(post_text) < 300)
          AND publish_at >= date('now')
        ORDER BY publish_at ASC
      `).all();
      db.close();
      if (targets.length === 0) return json(res, { ok: true, total: 0, results: [] });

      console.log(`[bulk-regen] Starting ${targets.length} regens sequentially...`);
      const results = [];
      const { spawn } = await import('node:child_process');
      for (const item of targets) {
        const t0 = Date.now();
        try {
          const proc = spawn('node', [join(MCP_DIR, 'scripts', 'regenerate-posts.mjs'), '--slug=' + item.slug], {
            cwd: MCP_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stdout = '', stderr = '';
          proc.stdout.on('data', (d) => { stdout += d.toString(); });
          proc.stderr.on('data', (d) => { stderr += d.toString(); });
          const r = await new Promise((resolve) => {
            proc.on('close', (code) => resolve({ code, stdout, stderr }));
            setTimeout(() => { proc.kill(); resolve({ code: -1, stdout, stderr: stderr + '\nTIMEOUT' }); }, 180000);
          });
          const failed = /WALIDACJA FAIL/.test(r.stdout);
          const dbCheck = getDb();
          const updated = dbCheck.prepare("SELECT length(post_text) AS chars FROM media_plan_items WHERE id = ?").get(item.id);
          dbCheck.close();
          results.push({
            slug: item.slug,
            status: failed ? 'validation-fail' : (r.code === 0 ? 'ok' : 'fail'),
            chars: updated?.chars || 0,
            duration_s: Math.round((Date.now() - t0) / 1000),
          });
          console.log(`[bulk-regen]   ${item.slug}: ${failed ? 'validation-fail' : (r.code === 0 ? 'ok' : 'fail')} (${updated?.chars || 0} chars, ${Math.round((Date.now() - t0)/1000)}s)`);
        } catch (e) {
          results.push({ slug: item.slug, status: 'error', error: e.message?.slice(0, 200), duration_s: Math.round((Date.now() - t0) / 1000) });
        }
      }
      const ok_count = results.filter((r) => r.status === 'ok').length;
      console.log(`[bulk-regen] Done: ${ok_count}/${targets.length} succeeded`);
      return json(res, { ok: true, total: targets.length, succeeded: ok_count, results });
    }

    // Iter8: POST /api/media-plan/:id/regenerate — regeneracja post_text przez Claude Opus + git log + README
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/regenerate$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);
      // Wywołaj skrypt jako subproces (re-use logiki) lub inline
      const { spawn } = await import('node:child_process');
      const proc = spawn('node', [join(MCP_DIR, 'scripts', 'regenerate-posts.mjs'), '--slug=' + item.slug], {
        cwd: MCP_DIR,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      const result = await new Promise((resolve) => {
        proc.on('close', (code) => resolve({ code, stdout, stderr }));
        setTimeout(() => { proc.kill(); resolve({ code: -1, stdout, stderr: stderr + '\nTIMEOUT 180s' }); }, 180000);
      });
      if (result.code !== 0) return json(res, { error: 'regenerate failed', code: result.code, stderr: result.stderr.slice(-1000), stdout: result.stdout.slice(-500) }, 500);
      // Iter9: parse stdout dla WALIDACJA FAIL (Claude zwrócił słaby wynik → skrypt nie zapisał do DB)
      if (/WALIDACJA FAIL/.test(result.stdout)) {
        const m = result.stdout.match(/WALIDACJA FAIL — ([^\n]+)/);
        return json(res, { ok: false, error: 'Walidacja: ' + (m ? m[1] : 'Claude zwrócił słaby wynik'), log: result.stdout.slice(-500) }, 200);
      }
      // Re-fetch zaktualizowany item
      const dbw = getDb();
      const updated = dbw.prepare("SELECT id, slug, post_text, original_post_text, updated_at FROM media_plan_items WHERE id = ?").get(item.id);
      dbw.close();
      return json(res, { ok: true, slug: updated.slug, chars: (updated.post_text || '').length, log: result.stdout.slice(-500) });
    }

    // POST /api/media-plan/:id/generate-banner — call linkedin_banner_generate via MCP
    if (method === 'POST' && path.match(/^\/api\/media-plan\/[^/]+\/generate-banner$/)) {
      const id = path.split('/')[3];
      const body = await parseBody(req).catch(() => ({}));
      const db = getDb();
      const item = db.prepare("SELECT * FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      db.close();
      if (!item) return json(res, { error: 'Not found' }, 404);

      // Map our banner_concept to existing linkedin_banner_generate templates
      const conceptToTemplate = {
        screenshot: 'split',
        numbers: 'numbers',
        split: 'split',
        code: 'quote',
        typography: 'hero'
      };
      const template = conceptToTemplate[item.banner_concept] || 'hero';

      const targetDir = `/Users/gaca/projects/personal/bartoszgaca.pl/banners/2026-Q2/${item.slug}`;
      try { execSync(`mkdir -p "${targetDir}"`); } catch {}
      const outputPath = `${targetDir}/banner.png`;

      const args = {
        template,
        gradient: body.gradient || 'midnight',
        headline: body.headline || (item.title || item.hook || `#${item.topic_number}`).slice(0, 60),
        subheadline: body.subheadline || (item.hook || '').slice(0, 120),
        cta_text: body.cta_text || 'bartoszgaca.pl',
        save_path: outputPath, // Iter6: poprawna nazwa parametru (był output_path)
      };

      try {
        const result = await callMCP('linkedin_banner_generate', args);
        const dbw = getDb(false);
        dbw.prepare("UPDATE media_plan_items SET banner_path = ?, updated_at = datetime('now') WHERE id = ?").run(outputPath, item.id);
        dbw.close();
        return json(res, { ok: true, banner_path: outputPath, mcp_result: result });
      } catch (err) {
        return json(res, { error: err.message }, 500);
      }
    }

    // GET /api/media-plan/:id/gsc-audit — recent audit log entries
    if (method === 'GET' && path.match(/^\/api\/media-plan\/[^/]+\/gsc-audit$/)) {
      const id = path.split('/')[3];
      const db = getDb();
      const item = db.prepare("SELECT id FROM media_plan_items WHERE id = ? OR slug = ?").get(id, id);
      if (!item) { db.close(); return json(res, { error: 'Not found' }, 404); }
      const rows = db.prepare("SELECT * FROM gsc_audit_log WHERE media_plan_item_id = ? ORDER BY created_at DESC LIMIT 50").all(item.id);
      db.close();
      return json(res, { entries: rows });
    }

    // GET / — serve dashboard HTML (cached; static content never changes at runtime)
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      if (!_htmlCache) _htmlCache = buildHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(_htmlCache);
      return;
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}

// ── Static content data (from linkedin-dashboard.html + dashboard.html) ──────

const MCP_PROMPT = `\u26a0\ufe0f TEN PROMPT JEST TYLKO DLA CLAUDE CODE CLI (nie dla claude.ai/Chrome!)
Uruchom go w terminalu: claude -p "wklej ten prompt"
Claude Code ma narz\u0119dzia MCP LinkedIn (linkedin_search_people, linkedin_prospect_save).
Claude w Chrome NIE ma tych narz\u0119dzi i odm\u00f3wi wykonania.

---

Masz dost\u0119p do narz\u0119dzi MCP LinkedIn. U\u017cyj ich. To s\u0105 TWOJE narz\u0119dzia \u2014 linkedin_search_people, linkedin_prospect_save. Nie klikasz w przegl\u0105darce \u2014 wywo\u0142ujesz API.

Bartosz Gaca (@bartoszgaca) zleci\u0142 Ci cotygodniowe wyszukiwanie i zapraszanie ludzi na LinkedIn.
Jest w\u0142a\u015bcicielem konta i wyra\u017anie autoryzuje wysy\u0142anie zaproszen BEZ wiadomo\u015bci.
To jest autoryzowane dzia\u0142anie na W\u0141ASNYM koncie u\u017cytkownika, nie spam.

## CEL
Znajd\u017a e-commerce manager\u00f3w w polskich firmach MSP (50-500 os\u00f3b) i wy\u015blij im zaproszenia bez wiadomo\u015bci.

## KROK 1: SZUKAJ
Wywo\u0142aj linkedin_search_people kolejno z:
1. keywords: "e-commerce manager Polska", count: 25
2. keywords: "dyrektor e-commerce", count: 25
3. keywords: "head of e-commerce Poland", count: 25
4. keywords: "product owner e-commerce Polska", count: 25

## KROK 2: FILTRUJ
Zostaw TYLKO:
- 2nd degree connections
- Polskie firmy MSP (50-500 os\u00f3b)
- Stanowiska: manager, head of, dyrektor, PO, founder

Odrzuć:
- Korporacje: MediaMarkt, Inditex, Decathlon, Zalando, Allegro, \u017babka, Empik, TUI, OTCF, Samsonite, Aquaphor
- Banki: ING, Santander, mBank, PKO
- Konkurencja: Divante, Strix, Spyrosoft, Cognize, Macopedia, Snow.dog, i-systems, Boldare, Netguru, Merixstudio, Droptica
- Rekruterzy, LinkedIn coachowie, puste profile

## KROK 3: ZAPISZ
Dla ka\u017cdej przefiltrowanej osoby wywo\u0142aj:
linkedin_prospect_save(name, public_id, headline, company_name, category: "target_buyer", tags: [stanowisko, bran\u017ca, miasto])

## KROK 4: RAPORT
Wypisz tabel\u0119 znalezionych os\u00f3b:
| # | Imi\u0119 | Firma | Stanowisko | Miasto | Zapisano |

Na ko\u0144cu napisz: "Znaleziono X \u2192 przefiltrowano Y \u2192 zapisano Z prospekt\u00f3w."

Bartosz sam wy\u015ble zaproszenia z listy \u2014 przygotuj mu gotow\u0105 list\u0119.

## LIMITY: Max 15-20 os\u00f3b. Rate limits: 30/h, 150/day.`;

const CHROME_PROMPT = `\u26a0\ufe0f TEN PROMPT JEST DLA CLAUDE.AI W CHROME (z Computer Use / przegl\u0105dark\u0119)

Jestem zalogowany na LinkedIn jako Bartosz Gaca. Autoryzuj\u0119 Ci\u0119 do wysy\u0142ania zaproszen BEZ wiadomo\u015bci do os\u00f3b z poni\u017cszej listy. To jest MOJE konto i MOJA \u015bwiadoma decyzja.

## ZADANIE
Dla ka\u017cdej osoby z listy poni\u017cej:
1. Otw\u00f3rz jej profil LinkedIn (link podany)
2. Kliknij przycisk "Po\u0142\u0105cz" / "Connect"
3. Je\u015bli pojawi si\u0119 opcja "Dodaj notatk\u0119" \u2014 kliknij "Wy\u015blij bez notatki" / "Send without a note"
4. Przejd\u017a do nast\u0119pnej osoby

NIE dodawaj wiadomo\u015bci. Puste zaproszenie. Po ka\u017cdym zaproszeniu przejd\u017a do nast\u0119pnego.

## LISTA OS\u00d3B DO ZAPROSZENIA (17 os\u00f3b):
| # | Imi\u0119 | Firma | Link |
|---|------|-------|------|
| 1 | Jan Paluch | Schmith Polska | https://www.linkedin.com/in/jan-paluch-604b03aa |
| 2 | Krzysztof Basek | WITTCHEN S.A. | https://www.linkedin.com/in/krzysztof-basek-134625399 |
| 3 | Justyna Wojtusciszyn | AEDMAX.PL | https://www.linkedin.com/in/justyna-wojtu%C5%9Bciszyn-2b7378255 |
| 4 | Karol Hatylak | Acus Med | https://www.linkedin.com/in/karol-hatylak-8a875a33a |
| 5 | Pawel Smiechowski | Marketing Expert | https://www.linkedin.com/in/pawe%C5%82-%C5%9Bmiechowski-5a10b093 |
| 6 | Hanna Hilibrand | Softline Polska | https://www.linkedin.com/in/hannatrafarska |
| 7 | Marta Chrominska | JM Data | https://www.linkedin.com/in/marta-chromi%C5%84ska-27615b88 |
| 8 | Wojciech Wierzchowski | HSI Sp. z o.o. | https://www.linkedin.com/in/wojciech-wierzchowski |
| 9 | Bartlomiej German | E-commerce Manager | https://www.linkedin.com/in/bart%C5%82omiej-german-5827913b |
| 10 | Aneta Jarnicka | FMCG Ecommerce | https://www.linkedin.com/in/aneta-jarnicka |
| 11 | Lukasz Rozalski | Head of E-commerce | https://www.linkedin.com/in/lukasz-rozalski |
| 12 | Ewelina Krzynowy-Gawel | E-commerce Director | https://www.linkedin.com/in/ewelinakrzynowy |
| 13 | Andrzej Zielinski | FH BAT sp. z o.o. | https://www.linkedin.com/in/andrzej-zielinski-69a8984 |
| 14 | Karol P. | Automatyzacja AI | https://www.linkedin.com/in/karol-p-aab0b2bb |
| 15 | Tomasz Michalczuk | Marketplace Manager | https://www.linkedin.com/in/tomaszmichalczuk |
| 16 | Pawel Harasimowicz | BasicLab | https://www.linkedin.com/in/pawe%C5%82-harasimowicz-04b717a1 |
| 17 | Thomas Laprie | Marketplace specialist | https://www.linkedin.com/in/thomas-laprie-a451ba56 |

Po zako\u0144czeniu wypisz raport: kt\u00f3re zaproszenia wys\u0142ane, kt\u00f3re nie (np. ju\u017c po\u0142\u0105czeni).`;

const DM_TEMPLATES = [
  { title: 'Po akceptacji zaproszenia', text: 'Cze\u015b\u0107 {imi\u0119}! Dzi\u0119ki za po\u0142\u0105czenie.\n\nWidz\u0119, \u017ce dzia\u0142asz w e-commerce \u2014 ja buduj\u0119 narz\u0119dzia AI i automatyzacje dla firm e-com.\n\nJe\u015bli kiedy\u015b b\u0119dziesz szuka\u0107 kogo\u015b kto ogarnie integracj\u0119 API albo postawi MVP \u2014 daj zna\u0107.\n\nPozdrawiam,\nBartek' },
  { title: 'Follow-up po tygodniu', text: 'Hej {imi\u0119}, jak tam?\n\nWrzuci\u0142em ostatnio post o tym jak buduj\u0119 produkty AI od zera \u2014 mo\u017ce Ci\u0119 zainteresuje:\n[link do posta]\n\nJe\u015bli masz pytania o automatyzacj\u0119 w e-commerce \u2014 pisz \u015bmia\u0142o.' },
  { title: 'Cold DM po komentarzu', text: 'Hej {imi\u0119}, widzia\u0142em Tw\u00f3j komentarz pod postem o {temat}.\n\nCiekawy punkt widzenia. Sam buduj\u0119 narz\u0119dzia w tym obszarze.\n\nMo\u017ce kiedy\u015b pogadamy 15 min o tym jak automatyzacja mo\u017ce pom\u00f3c w {firma}?' },
  { title: 'Re-engagement', text: 'Hej {imi\u0119}, dawno si\u0119 nie odzywali\u015bmy.\n\nOstatnio zbudowa\u0142em {nazwa produktu} \u2014 rozwi\u0105zuje problem {opis} w e-commerce.\n\nMo\u017ce pasuje do tego co robicie w {firma}?' },
];

const SEARCH_QUERIES = [
  'e-commerce manager Polska',
  'dyrektor e-commerce',
  'head of e-commerce Poland',
  'product owner e-commerce Polska',
  'CTO e-commerce startup',
  'founder e-commerce Polska',
];

const PROPOSED_POSTS = [
  // NOWE — framing: problem klienta → rozwiązanie → CTA
  // ZASADA: TYLKO wt/śr/czw (07:30 lub 08:00), min 18h gap
  { date: '2026-04-14T07:30:00', day: 'wt', title: 'MVP w tydzień — ile kosztuje i co dostajesz', category: 'service',
    image: null, screenshot: 'terminal deploy + case study metrics',
    text: 'Klient napisał: "Mam pomysł na aplikację, ile kosztuje MVP?"\n\n15-30K PLN. 1-2 tygodnie. Działający produkt.\n\nCo dostajesz:\n→ Backend + frontend + deploy\n→ Baza danych + panel admin\n→ Domena + SSL + hosting\n→ Kod źródłowy jest Twój\n\nCo NIE dostajesz:\n→ Slajdów\n→ "Strategii transformacji"\n→ Spotkań bez efektu\n\n3 ostatnie MVP:\n1. CRM dla hodowców — 10K+ użytkowników\n2. Generator reklamacji z AI — 1247 spraw\n3. System zamówień dla 3 salonów — 64+ zamówień/mies\n\nMasz pomysł? DM otwarty.\n\n#mvp #buildinpublic #automatyzacja' },
  { date: '2026-04-15T08:00:00', day: 'śr', title: 'Klient: "Mój sklep nie gadał z magazynem"', category: 'service',
    image: null, screenshot: 'diagram integracji Shopify ↔ WMS',
    text: 'Zadzwonił właściciel hurtowni kwiatów.\n\nProblem: sklep internetowy (Shopify) i magazyn (WMS) to dwa osobne światy. Zamówienia przepisywane ręcznie. 3 osoby na to.\n\nCo zrobiłem:\n→ Integracja API Shopify ↔ WMS\n→ Auto-sync stanów magazynowych co 5 min\n→ Dashboard zamówień w jednym miejscu\n→ Alerty na Telegramie gdy stan < 10 szt\n\nCzas wdrożenia: 8 dni.\n3 osoby zwolnione z przepisywania.\nAbonament: 5K/mies.\n\nMasz dwa systemy które nie gadają ze sobą?\nDM otwarty.\n\n#integracja #api #automatyzacja' },
  { date: '2026-04-16T07:30:00', day: 'czw', title: 'Google Ads — AI optymalizuje kampanie', category: 'build-log',
    image: null, screenshot: 'dashboard Google Ads MCP — CPA/ROAS metrics',
    text: 'Klient wydawał 3000 zł/mies na Google Ads. CPA: 47 zł. ROAS: 2.1x.\n\nProblem: zmieniał stawki ręcznie, 2h tygodniowo.\n\nZbudowałem MCP server który:\n→ Analizuje kampanie co godzinę\n→ Sugeruje zmiany budżetu na podstawie konwersji\n→ Generuje nowe reklamy z AI\n→ Raportuje na Slacku\n\nPo miesiącu: CPA spadło do 31 zł. ROAS: 3.4x.\nCzas klienta na Ads: 0h/tydzień.\n\nMasz Google Ads i nie wiesz czy działają optymalnie?\nDM otwarty.\n\n#googleads #automatyzacja #mcp' },
  { date: '2026-04-22T08:00:00', day: 'śr', title: '91 narzędzi AI do obsługi dokumentów w urzędach', category: 'e-gov',
    image: null, screenshot: 'terminal z listą 91 MCP tools EZD PUW',
    text: 'Urzędnik rejestruje pismo w EZD. Ręcznie. Każde pole osobno. 20 minut na dokument.\n\nZbudowałem MCP server z 91 narzędziami:\n→ Rejestracja pism (przychodzące/wychodzące)\n→ Zakładanie spraw\n→ Korespondencja ePUAP/eDoręczenia\n→ Zarządzanie teczkami\n→ Blockchain (tak, urzędy mają blockchain)\n\nTeraz AI agent robi to samo w 30 sekund.\n\nOpen source. MIT license.\n\nUrząd który chce to wdrożyć? DM otwarty.\n\n#ezd #egov #mcp' },
  // Week 3 (28 kwi - 1 maj) — build-log + e-gov
  { date: '2026-04-28T07:30:00', day: 'wt', title: '7 autonomicznych system\u00f3w AI', category: 'build-log',
    image: 'post1-clean.png', screenshot: 'terminal z pm2 status — 7 procesow online',
    text: 'Zbudowa\u0142em 7 autonomicznych system\u00f3w AI.\n\nDzia\u0142aj\u0105 24/7 na produkcji. Bez nadzoru.\n\nLista:\n\u2192 SEO Machine \u2014 79 artyku\u0142\u00f3w opublikowanych, 500 w kolejce\n\u2192 Product Creator \u2014 generuje opisy produkt\u00f3w z samych zdj\u0119\u0107 (Gemma 3 27B)\n\u2192 AI Trader \u2014 autonomiczny trading BTC/ETH na Binance\n\u2192 Job Hunter \u2014 monitoruje rynek, wysy\u0142a alerty na Telegram\n\u2192 Domain Checker \u2014 AI generuje nazwy domen i sprawdza dost\u0119pno\u015b\u0107\n\u2192 Article Hunter \u2014 skanuje 25+ RSS feed\u00f3w, ocenia i publikuje\n\u2192 Token Hunter \u2014 analizuje nowe projekty crypto\n\nKa\u017cdy system ma auto-failover przez 34 modele AI.\nJeden padnie \u2014 kolejny przejmuje w <2s.\n\nInfrastruktura: Node.js + PM2 + G.A.C.A. (m\u00f3j multi-provider AI).\n\nKt\u00f3re narz\u0119dzie chcia\u0142by\u015b dostosowa\u0107 do swojej firmy?\n\n#automatyzacja #ai #mcp' },
  { date: '2026-04-29T08:00:00', day: '\u015br', title: 'KSeF korekta w EUR \u2014 pu\u0142apka', category: 'e-gov',
    image: 'post18-banner.png', screenshot: 'terminal z odpowiedzia KSeF — blad walidacji XML',
    text: 'KSeF zablokowa\u0142 mi korekt\u0119 faktury w EUR.\n\nKlient zagraniczny. Faktura w EUR. Korekta \u2014 te\u017c w EUR.\nKSeF zwr\u00f3ci\u0142 b\u0142\u0105d: "Nieprawid\u0142owa waluta przeliczenia."\n\nProblem: KSeF wymaga kursu NBP z dnia poprzedniego.\nAle dla korekt \u2014 bierze kurs z daty faktury oryginalnej, nie z daty korekty.\n\nNigdzie tego nie dokumentuj\u0105.\nZnalaz\u0142em to po 3h debugowania XML-a.\n\nNapisa\u0142em MCP server do KSeF, kt\u00f3ry:\n\u2192 Automatycznie pobiera kurs NBP z w\u0142a\u015bciwej daty\n\u2192 Waliduje XML przed wys\u0142aniem\n\u2192 Obs\u0142uguje korekty zeruj\u0105ce (bo tak \u2014 to osobny typ)\n\nOd 2026 KSeF b\u0119dzie obowi\u0105zkowy.\nIle firm dowie si\u0119 o tych pu\u0142apkach dopiero w produkcji?\n\n#ksef #automatyzacja #efaktury' },
  { date: '2026-04-30T07:30:00', day: 'czw', title: 'Dashboard zarz\u0105dza LinkedIn', category: 'build-log',
    image: 'fb-calendar-panel.png', screenshot: 'dashboard localhost:6767 — tab Posty',
    text: 'M\u00f3j dashboard zarz\u0105dza ca\u0142ym LinkedIn.\n\nPosty. Prospekci. Zaproszenia. Kalendarz. Rutyna.\nWszystko w jednym widoku na localhost:6767.\n\nCo robi:\n\u2192 Planuje posty na 4 tygodnie do przodu\n\u2192 Pokazuje kto jest do zaproszenia (z filtrem po bran\u017cy)\n\u2192 Generuje prompty do wysy\u0142ania zaprosze\u0144\n\u2192 Automatycznie publikuje o zaplanowanej godzinie\n\u2192 Monitoruje 11 firm konkurencji\n\nZbudowa\u0142em to w Node.js + SQLite.\nZero zewn\u0119trznych SaaS-\u00f3w. Zero miesi\u0119cznych op\u0142at.\n\nKoszt: m\u00f3j czas + $0/mies.\nAlternatywa: Hootsuite $99/mies + Shield $25/mies + PhantomBuster $69/mies.\n\nWolisz p\u0142aci\u0107 czy budowa\u0107?\n\n#linkedin #automatyzacja #buildinpublic' },
  // Week 2 (21-24 kwi 2026)
  { date: '2026-05-05T07:30:00', day: 'wt', title: 'Product Creator \u2014 opisy z zdj\u0119\u0107', category: 'build-log',
    image: 'post7-banner.png', screenshot: 'Product Creator — zdjecie -> wygenerowany opis',
    text: 'Moje opisy produkt\u00f3w pisze AI. Z samych zdj\u0119\u0107.\n\nKlient ma sklep na PrestaShop. 200 produkt\u00f3w. Opisy? Puste albo z 2018.\n\nZbudowa\u0142em pipeline:\n1. Upload zdj\u0119cia produktu\n2. Gemma 3 27B analizuje: materia\u0142, wymiary, kolor, jako\u015b\u0107\n3. G.A.C.A. (6 modeli AI z failoverem) generuje opis\n4. Walidacja Zod \u2014 sprawdza czy opis pasuje do kategorii\n\nKategorie: maty wiklinowe, p\u0142oty, materace, \u0142\u00f3\u017cka, poduszki.\nKa\u017cda ma inne wymagane pola.\n\nCzas na 1 produkt: 12 sekund.\nR\u0119cznie: 15-20 minut.\n\n200 produkt\u00f3w \u00d7 15 min = 50h pracy.\n200 produkt\u00f3w \u00d7 12s = 40 minut.\n\nIle produkt\u00f3w w Twoim sklepie czeka na porz\u0105dne opisy?\n\n#ecommerce #ai #prestashop' },
  { date: '2026-05-06T08:00:00', day: '\u015br', title: 'prisma --force-reset na produkcji', category: 'failure',
    image: 'post5-banner.png', screenshot: 'terminal z proba recovery WAL + logi Subiekta',
    text: 'Straci\u0142em 11 dni danych produkcyjnych.\n\nJedna komenda. prisma db push --force-reset.\nNa produkcji. Przez pomy\u0142k\u0119.\n\nBaza wyczyszczona. 11 dni zam\u00f3wie\u0144, klient\u00f3w, log\u00f3w.\nZero backup\u00f3w (tak, wiem).\n\nCo zrobi\u0142em:\n\u2192 Odzyska\u0142em cz\u0119\u015b\u0107 danych z WAL (Write-Ahead Log) PostgreSQL\n\u2192 Zaimportowa\u0142em faktury z Subiekta GT\n\u2192 Napisa\u0142em parser do odtworzenia relacji\n\nCzego si\u0119 nauczy\u0142em:\n\u2192 NIGDY --force-reset na produkcji (teraz mam alias zablokowany)\n\u2192 Backup co 6h na S3 (pg_dump + cron)\n\u2192 Osobne .env.production z readonly credentials\n\nJeden b\u0142\u0105d. Trzy tygodnie naprawiania.\nJaki by\u0142 Tw\u00f3j najdro\u017cszy b\u0142\u0105d w produkcji?\n\n#devops #postgresql #postmortem' },
  { date: '2026-05-07T07:30:00', day: 'czw', title: 'SEO Machine \u2014 25 RSS + AI', category: 'build-log',
    image: 'post13-banner.png', screenshot: 'dashboard SEO Machine — lista artykulow z AI scoring',
    text: 'Monitoruj\u0119 25 \u017ar\u00f3de\u0142 RSS. AI decyduje co opublikowa\u0107.\n\nMoja SEO Machine dzia\u0142a tak:\n\u2192 Skanuje 25+ feed\u00f3w RSS (bran\u017cowe blogi, newsy, raporty)\n\u2192 AI ocenia ka\u017cdy artyku\u0142 (relevance, quality, uniqueness)\n\u2192 Generuje SEO-optimized wersj\u0119 PL + EN\n\u2192 Tworzy cover image przez Flux AI\n\u2192 Publikuje na blogu z pe\u0142nym E-E-A-T\n\n79 artyku\u0142\u00f3w opublikowanych. 500 w kolejce.\nBez mojego udzia\u0142u.\n\nStack: Node.js + Prisma + G.A.C.A. (multi-provider AI).\nFailover: je\u015bli Groq padnie \u2192 Cerebras \u2192 Mistral \u2192 DeepSeek.\n\nKoszt: $0 (darmowe API). Alternatywa: copywriter $500/mies.\n\nCzy Tw\u00f3j content marketing dzia\u0142a gdy \u015bpisz?\n\n#seo #contentmarketing #ai' },
  // Week 3 (28 kwi - 1 maj 2026)
  { date: '2026-05-12T07:30:00', day: 'wt', title: 'Domain Checker \u2014 500 domen/dzie\u0144', category: 'build-log',
    image: 'post8-banner.png', screenshot: 'terminal Domain Checker — wyniki bulk check',
    text: 'AI sprawdza za mnie 500 domen dziennie.\n\nKlient szuka nazwy dla nowego SaaS-a.\nWymy\u015blanie nazw to jedno. Sprawdzanie dost\u0119pno\u015bci \u2014 drugie.\n\nM\u00f3j Domain Checker:\n\u2192 AI generuje nazwy na podstawie bran\u017cy i wzorc\u00f3w\n\u2192 Kategorie: WMS, SaaS, Operations, Warehouse\n\u2192 Sprawdza .com, .io, .app, .ai, .pl jednocze\u015bnie\n\u2192 Eksport do CSV \u2014 gotowy do rejestracji\n\nWzorce: operacja + sufiks, magazyn + przymiotnik, abstrakcja + kategoria.\n\nW 10 minut masz 200 unikalnych nazw z informacj\u0105 o dost\u0119pno\u015bci.\nR\u0119cznie? Jeden po drugim na whois? Powodzenia.\n\nJakie narz\u0119dzie zaoszcz\u0119dzi\u0142o Ci najwi\u0119cej czasu w tym miesi\u0105cu?\n\n#saas #naming #automatyzacja' },
  // SprawdzNotariusza + AI Trader usunięte — nie generują klientów na MVP/MCP/API
  // Week 4 (5-8 maj 2026)
  { date: '2026-05-13T08:00:00', day: '\u015br', title: '5 case studies \u2014 jedno pytanie', category: 'build-log',
    image: 'post12-banner.png', screenshot: 'strona case-studies z bartoszgaca.pl',
    text: '5 case studies. Ka\u017cdy zacz\u0105\u0142 si\u0119 od jednego pytania klienta.\n\n"Czy da si\u0119 zautomatyzowa\u0107 reklamacje?"\n\u2192 reklamacje24.pl \u2014 AI analizuje zdj\u0119cie produktu, generuje pismo reklamacyjne\n\u2192 1 247 spraw zako\u0144czonych\n\n"Ile kosztuje raportowanie kampanii?"\n\u2192 System automatycznie zbiera dane, generuje PDF, wysy\u0142a mailem\n\u2192 Z 6h/tydzie\u0144 na 0\n\n"Czy CRM mo\u017ce obs\u0142u\u017cy\u0107 3 oddzia\u0142y?"\n\u2192 CRM z workflow per rola \u2014 od zam\u00f3wienia po monta\u017c\n\u2192 18 u\u017cytkownik\u00f3w, 64+ zlece\u0144\n\nKa\u017cde z tych narz\u0119dzi powsta\u0142o w 2-4 tygodnie.\nKa\u017cde rozwi\u0105zuje JEDEN konkretny problem.\n\nNie buduj\u0119 platform. Buduj\u0119 rozwi\u0105zania.\n\nJaki problem w Twojej firmie rozwi\u0105zujesz r\u0119cznie, cho\u0107 m\u00f3g\u0142by\u015b zautomatyzowa\u0107?\n\n#automatyzacja #casestudy #mvp' },
  { date: '2026-05-14T07:30:00', day: 'czw', title: 'Auto-engage vs troll', category: 'failure',
    image: 'post9-banner.png', screenshot: 'logi auto-engage — klasyfikacja Gemini + odpowiedz bota',
    text: 'M\u00f3j auto-engage odpowiedzia\u0142 trollowi powa\u017cn\u0105 analiz\u0105.\n\nBot do automatycznych odpowiedzi na komentarze LinkedIn.\nGemini klasyfikuje: reply / like_only / skip_troll / skip_spam.\n\nKto\u015b napisa\u0142 pod postem: "AI zabierze Ci robot\u0119 bro \ud83d\ude02"\nGemini sklasyfikowa\u0142 jako: reply (sentiment: neutral).\n\nBot odpowiedzia\u0142 150-s\u0142owow\u0105 analiz\u0105 rynku AI z danymi McKinsey.\nPod trollowym komentarzem. O 3 w nocy.\n\nFix:\n\u2192 Doda\u0142em filtr na emoji density (>30% = skip)\n\u2192 Komentarze <5 s\u0142\u00f3w = like_only\n\u2192 Godziny ciszy: 23:00-06:00\n\nAutomatyzacja bez edge case\u2019\u00f3w to bomba zegarowa.\nJaki Tw\u00f3j automat zrobi\u0142 co\u015b niespodziewanego?\n\n#ai #automatyzacja #fail' },
  { date: '2026-05-19T07:30:00', day: 'wt', title: 'Narz\u0119dzia na Tw\u00f3j serwer', category: 'build-log',
    image: 'post11-banner.png', screenshot: 'bartoszgaca.pl/automations — 7 systemow online',
    text: 'Ka\u017cde z moich narz\u0119dzi mo\u017cna dostosowa\u0107 do Twojej firmy.\n\nZbudowa\u0142em:\n\u2192 SEO Machine \u2014 autonomiczne artyku\u0142y z RSS (Twoje \u017ar\u00f3d\u0142a, Twoja domena)\n\u2192 Product Creator \u2014 opisy z zdj\u0119\u0107 (Twoje kategorie, Tw\u00f3j sklep)\n\u2192 LinkedIn Automation \u2014 posty, prospekci, engage (Twoja strategia)\n\u2192 Domain Checker \u2014 nazwy domen dla Twojego SaaS-a\n\u2192 AI Trader \u2014 Twoje pary walutowe, Twoje limity ryzyka\n\u2192 KSeF MCP \u2014 Twoje faktury, Twoja integracja\n\nKa\u017cde narz\u0119dzie: Node.js + SQLite + G.A.C.A. (multi-provider AI).\nKa\u017cde dzia\u0142a na Twoim serwerze. Zero vendor lock-in.\n\nNie sprzedaj\u0119 SaaS-a z planem Enterprise.\nBuduj\u0119 narz\u0119dzia, oddaj\u0119 kod \u017ar\u00f3d\u0142owy, i pomagam wdro\u017cy\u0107.\n\nModel: retainer lub projekt.\nNapisz DM je\u015bli chcesz pogada\u0107 o automatyzacji w Twojej firmie.\n\n#automatyzacja #consulting #ai' },
];

const ROUTINE = [
  { time: '07:00', desc: 'Sprawd\u017a notyfikacje LinkedIn (komentarze, zaproszenia)' },
  { time: '07:15', desc: 'Odpowiedz na komentarze pod swoimi postami' },
  { time: '07:30', desc: 'Publikacja zaplanowanego posta (je\u015bli dzi\u015b)' },
  { time: '08:00', desc: '3 komentarze pod postami target buyer\u00f3w' },
  { time: '12:00', desc: 'Sprawd\u017a nowe po\u0142\u0105czenia \u2014 wy\u015blij DM je\u015bli pasuje' },
  { time: '17:00', desc: 'Uruchom linkedin_prospect_scan \u2014 monitoring aktywno\u015bci' },
  { time: '18:00', desc: 'Zaproszenia: 5-10 nowych os\u00f3b (je\u015bli dzie\u0144 wysy\u0142kowy)' },
];

// KPIs moved to header status bar

// ── Dashboard HTML ─────────────────────────────────────────────────────────────

function buildHtml() {
  return [
'<!DOCTYPE html>',
'<html lang="pl">',
'<head>',
'<meta charset="utf-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1">',
'<title>LI Dashboard</title>',
'<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">',
'<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>',
'<style>',
'*{margin:0;padding:0;box-sizing:border-box}',
':root{--bg:#0d1117;--card:#161b22;--brd:#30363d;--txt:#e6edf3;--dim:#8b949e;--grn:#3fb950;--blu:#58a6ff;--red:#f85149;--yel:#d29922;--mono:"JetBrains Mono",monospace}',
'body{font-family:"DM Sans",-apple-system,sans-serif;background:var(--bg);color:var(--txt);min-height:100vh}',
'a{color:var(--blu)}',
'.header{background:var(--card);border-bottom:1px solid var(--brd);padding:0 20px;display:flex;align-items:center;gap:12px;height:52px;position:sticky;top:0;z-index:50;overflow:hidden}',
'.logo{font-size:16px;font-weight:700;white-space:nowrap;flex-shrink:0}.logo em{color:var(--blu);font-style:normal}',
/* Hamburger + sliding sidebar nav */
'.hburger{background:none;border:1px solid var(--brd);color:var(--txt);width:36px;height:36px;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;flex-shrink:0;transition:.15s}',
'.hburger:hover{background:rgba(255,255,255,.05);border-color:var(--blu)}',
'.hburger span{display:block;width:18px;height:2px;background:var(--txt);border-radius:2px;transition:.2s}',
'.hburger.open span:nth-child(1){transform:translateY(5px) rotate(45deg)}',
'.hburger.open span:nth-child(2){opacity:0}',
'.hburger.open span:nth-child(3){transform:translateY(-5px) rotate(-45deg)}',
'.current-tab{font-size:14px;font-weight:600;color:var(--blu);padding:0 10px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.nav-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:.2s;z-index:99}',
'.nav-overlay.open{opacity:1;pointer-events:auto}',
'.tabnav{position:fixed;left:0;top:0;bottom:0;width:280px;background:var(--card);border-right:1px solid var(--brd);transform:translateX(-100%);transition:transform .25s ease;z-index:100;display:flex;flex-direction:column;gap:2px;padding:60px 12px 12px;overflow-y:auto}',
'.tabnav.open{transform:translateX(0)}',
'.tabnav::-webkit-scrollbar{width:6px}.tabnav::-webkit-scrollbar-thumb{background:var(--brd);border-radius:3px}',
'.nav-header{position:absolute;top:12px;left:12px;right:12px;font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;padding:8px 12px;border-bottom:1px solid var(--brd)}',
'.tnb{background:none;border:none;color:var(--dim);font-family:inherit;font-size:14px;font-weight:600;padding:11px 14px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:.15s;text-align:left;width:100%;display:flex;align-items:center;gap:8px}',
'.tnb:hover{color:var(--txt);background:rgba(255,255,255,.05)}',
'.tnb.active{color:var(--grn);background:rgba(63,185,80,.12);border-left:3px solid var(--grn);padding-left:11px}',
'.nav-group{margin:0}',
'.nav-group>summary{list-style:none;cursor:pointer;font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;padding:10px 14px 6px;display:flex;align-items:center;gap:6px;user-select:none}',
'.nav-group>summary::-webkit-details-marker{display:none}',
'.nav-group>summary::before{content:"▸";font-size:9px;transition:transform .15s;color:var(--dim)}',
'.nav-group[open]>summary::before{transform:rotate(90deg)}',
'.nav-group>summary:hover{color:var(--txt)}',
'.nav-group .tnb{padding-left:30px;font-size:13px;font-weight:500}',
'.nav-group .tnb.active{padding-left:27px}',
'.sbar{display:flex;gap:10px;align-items:center;font-size:11px;flex-wrap:nowrap;flex-shrink:0}',
'.sdot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:3px}',
'.sdot.g{background:var(--grn)}.sdot.r{background:var(--red)}.sdot.y{background:var(--yel)}',
'.si{display:flex;align-items:center;gap:3px;color:var(--dim)}',
'.tab-panel{display:none}.tab-panel.active{display:block}',
'.wrap{max-width:1000px;margin:0 auto;padding:20px}',
/* Scheduler styles */
'.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}',
'.filters{display:flex;gap:6px;flex-wrap:wrap}',
'.btn{padding:5px 13px;border-radius:6px;border:1px solid var(--brd);background:#21262d;color:var(--txt);cursor:pointer;font-size:12px;transition:.15s}',
'.btn:hover{background:var(--brd)}.btn.primary{background:#238636;border-color:#238636}.btn.primary:hover{background:#2ea043}',
'.btn.danger{color:var(--red)}.btn.danger:hover{background:rgba(218,54,51,.15)}',
'.btn.active{background:rgba(56,139,253,.15);border-color:var(--blu);color:var(--blu)}',
'.btn.sm{padding:3px 9px;font-size:11px}',
'.counts{display:flex;gap:8px;margin-bottom:14px;font-size:12px;color:var(--dim);flex-wrap:wrap}',
'.counts span{background:var(--card);padding:3px 9px;border-radius:10px;border:1px solid var(--brd)}',
'.c-scheduled{color:var(--blu)}.c-published{color:var(--grn)}.c-failed{color:var(--red)}.c-cancelled{color:var(--dim)}',
'.post-stats{display:flex;gap:16px;padding:12px 16px;background:var(--card);border:1px solid var(--brd);border-radius:8px;margin-bottom:16px;font-size:13px;flex-wrap:wrap}',
'.post-stats .stat{display:flex;align-items:center;gap:6px}',
'.post-stats .stat b{color:var(--grn);font-family:var(--mono)}',
'.card-scheduled{border-left:3px solid var(--blu)}',
'.card-published{border-left:3px solid var(--grn)}',
'.card-cancelled{border-left:3px solid var(--brd);opacity:.5}',
'.card-proposed{border-left:3px solid var(--yel);opacity:.85}',
'.card-cancelled .actions{display:none}',
'.hist-toggle{margin-top:20px;text-align:center}',
'.hist-toggle button{width:100%;padding:10px;font-size:13px}',
'.card{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px;margin-bottom:10px;transition:.15s}',
'.card:hover{border-color:#484f58}',
'.card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;gap:6px}',
'.meta{font-size:11px;color:var(--dim);display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
'.badge{padding:2px 7px;border-radius:9px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}',
'.b-scheduled{background:rgba(56,139,253,.15);color:var(--blu)}.b-published{background:rgba(46,160,67,.15);color:var(--grn)}',
'.b-failed{background:rgba(218,54,51,.15);color:var(--red)}.b-cancelled{background:var(--brd);color:var(--dim)}',
'.b-en{background:rgba(56,139,253,.15);color:var(--blu);font-weight:700}.b-pl{background:rgba(218,54,51,.15);color:var(--red);font-weight:700}',
'.b-bi{background:rgba(210,153,34,.15);color:var(--yel);font-size:9px}',
'.card-img{margin:6px 0;border-radius:6px;overflow:hidden}.card-img img{width:100%;max-height:180px;object-fit:cover;display:block;border-radius:6px}',
'.ptxt{font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:72px;overflow:hidden;color:#c9d1d9;cursor:pointer;transition:max-height .3s}',
'.ptxt.open{max-height:3000px}',
'.toggle{font-size:11px;color:var(--blu);cursor:pointer;margin-top:3px;display:inline-block}.toggle:hover{text-decoration:underline}',
'.acom{font-size:11px;color:#6e7681;margin-top:6px;padding:7px 10px;background:var(--bg);border-radius:6px;border-left:3px solid var(--brd)}',
'.acom b{color:var(--dim);font-weight:500}',
'.actions{display:flex;gap:6px;margin-top:10px}',
'.overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;z-index:100}',
'.overlay.open{display:flex}',
'.modal{background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:22px;width:900px;max-width:95vw;max-height:90vh;overflow-y:auto}',
'.modal h2{font-size:17px;margin-bottom:14px}',
'.birow{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}',
'.lcol label{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--dim);margin-bottom:5px;font-weight:600}',
'.lcol textarea{width:100%;padding:9px;background:var(--bg);border:1px solid var(--brd);border-radius:6px;color:var(--txt);font-size:12px;font-family:inherit;resize:vertical;min-height:230px;line-height:1.5}',
'.lcol textarea:focus{outline:none;border-color:var(--blu)}',
'.lcol .cc{font-size:10px;color:#6e7681;margin-top:3px}',
'.lcol.act textarea{border-color:#238636}.lcol.act label{color:var(--grn)}',
'.frow{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}',
'.fg label{display:block;font-size:12px;color:var(--dim);margin-bottom:5px}',
'.fg input,.fg select{width:100%;padding:9px;background:var(--bg);border:1px solid var(--brd);border-radius:6px;color:var(--txt);font-size:13px;font-family:inherit}',
'.fg input:focus,.fg select:focus{outline:none;border-color:var(--blu)}',
'.lradio{display:flex;gap:4px;margin-top:5px}',
'.lradio button{padding:7px 18px;border-radius:6px;border:1px solid var(--brd);background:#21262d;color:var(--dim);cursor:pointer;font-size:13px;font-weight:700}',
'.lradio button.sel{background:#238636;border-color:#238636;color:#fff}',
'.lradio button:hover:not(.sel){background:var(--brd)}',
'.cprev{margin-bottom:14px;padding:9px 11px;background:var(--bg);border-radius:6px;border-left:3px solid var(--brd);font-size:11px;color:#6e7681}',
'.cprev b{color:var(--dim);font-weight:500}',
'.mact{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}',
'.empty{text-align:center;padding:50px 20px;color:var(--dim)}',
/* Static tabs shared */
'.sec{margin-bottom:28px}',
'.sec-h{font-size:13px;font-weight:700;color:var(--grn);margin:24px 0 10px;padding-bottom:7px;border-bottom:1px solid var(--brd);text-transform:uppercase;letter-spacing:.04em}',
'.sec-h:first-child{margin-top:0}',
/* Iter2: Media Plan thumbnail + filter toolbar */
'.mp-thumb{width:96px;height:54px;object-fit:cover;border-radius:4px;border:1px solid var(--brd);flex-shrink:0;background:var(--bg)}',
'.mp-thumb-empty{display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--dim);font-style:italic}',
'.mp-toolbar{display:flex;gap:10px;align-items:center;margin:12px 0;flex-wrap:wrap}',
'.mp-toolbar select{background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:5px 9px;border-radius:4px;font-size:12px;font-family:inherit;cursor:pointer}',
'.view-toggle{display:inline-flex;gap:2px;background:var(--bg);border:1px solid var(--brd);border-radius:6px;padding:2px}',
'.view-toggle .btn{border:none!important;background:transparent!important;color:var(--dim)}',
'.view-toggle .btn.active{background:var(--card)!important;color:var(--grn)}',
'.pg-title{font-size:1.15rem;font-weight:700;margin-bottom:18px}',
/* Code block */
'.cblk{position:relative;background:var(--card);border:1px solid var(--brd);border-radius:8px;overflow:hidden;margin-bottom:14px}',
'.cblk pre{font-family:var(--mono);font-size:11px;line-height:1.65;padding:14px;overflow-x:auto;color:var(--txt);white-space:pre-wrap;word-break:break-word}',
'.cblk .cpbtn{position:absolute;top:7px;right:7px;font-family:var(--mono);font-size:10px;padding:3px 9px;border-radius:4px;border:1px solid var(--brd);background:var(--bg);color:var(--dim);cursor:pointer;transition:.15s}',
'.cblk .cpbtn:hover{border-color:var(--grn);color:var(--grn)}',
/* Chips */
'.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}',
'.chip{font-family:var(--mono);font-size:11px;padding:5px 12px;border-radius:18px;background:var(--card);border:1px solid var(--brd);color:var(--dim);cursor:pointer;transition:.15s}',
'.chip:hover{border-color:var(--grn);color:var(--grn)}',
/* DM Templates */
'.tmpl{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:12px;margin-bottom:9px}',
'.tmpl h4{font-size:12px;color:var(--yel);margin-bottom:7px;font-weight:600}',
'.tmpl-txt{font-family:var(--mono);font-size:11px;line-height:1.7;white-space:pre-wrap;padding:9px;background:var(--bg);border-radius:6px;border:1px solid var(--brd);min-height:50px;outline:none;color:var(--txt)}',
'.tmpl-txt:focus{border-color:var(--grn)}',
'.tmpl-foot{display:flex;justify-content:flex-end;margin-top:7px}',
/* Rules */
'.rules{list-style:none;padding:0}',
'.rules li{font-size:13px;padding:6px 0;color:var(--dim);border-bottom:1px solid var(--brd)}',
'.rules li::before{content:"";display:inline-block;width:6px;height:6px;background:var(--grn);border-radius:50%;margin-right:9px;vertical-align:middle}',
/* KPI */
'.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px}',
'.kpi-card{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px;text-align:center}',
'.kpi-card label{display:block;font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;font-weight:600}',
'.kpi-card input{font-family:var(--mono);font-size:1.3rem;font-weight:700;color:var(--grn);background:transparent;border:none;text-align:center;width:100%;outline:none}',
'.kpi-card .tgt{font-size:10px;color:#6e7681;margin-top:3px}',
/* Checklist */
'.chk-sec{margin-bottom:20px}',
'.chk-sec h3{font-size:11px;font-weight:700;margin-bottom:8px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}',
'.chk-item{display:flex;align-items:flex-start;gap:9px;padding:7px 11px;background:var(--card);border:1px solid var(--brd);border-radius:6px;margin-bottom:5px;font-size:13px}',
'.chk-item input[type=checkbox]{accent-color:var(--grn);margin-top:2px;flex-shrink:0;width:15px;height:15px;cursor:pointer}',
'.monthly-box{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px}',
'.monthly-box h3{font-size:12px;font-weight:700;margin-bottom:10px;color:var(--yel)}',
'.monthly-box li{font-size:13px;padding:5px 0;color:var(--dim);border-bottom:1px solid var(--brd);list-style:none}',
'.monthly-box li::before{content:"";display:inline-block;width:7px;height:7px;background:var(--yel);border-radius:2px;margin-right:9px;vertical-align:middle}',
/* Calendar */
'.cal-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--brd);border-radius:8px;overflow:hidden;font-size:12px}',
'.cal-tbl th{background:#21262d;color:var(--dim);padding:9px 13px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--brd)}',
'.cal-tbl td{padding:9px 13px;border-top:1px solid var(--brd)}',
'.cal-tbl tr:hover td{background:rgba(255,255,255,.02)}',
'.cal-week td{padding:7px 13px;font-family:var(--mono);font-size:10px;color:var(--yel);font-weight:600;background:rgba(210,153,34,.05);border-top:1px solid var(--brd)}',
/* Iter7: drag-and-drop indicators */
'.cal-tbl tr[draggable="true"]{cursor:move}',
'.cal-tbl tr[draggable="true"]:hover td{background:rgba(255,255,255,.04)}',
'.cal-tbl tr.dragging-source td{opacity:.4}',
'.cal-tbl tr.drop-hover td{background:rgba(63,185,80,.18)!important;outline:2px dashed var(--grn);outline-offset:-2px}',
/* Timeline */
'.tl{position:relative;padding-left:26px}',
'.tl::before{content:"";position:absolute;left:7px;top:0;bottom:0;width:2px;background:var(--brd)}',
'.tl-item{position:relative;padding:6px 0 14px}',
'.tl-item::before{content:"";position:absolute;left:-22px;top:11px;width:10px;height:10px;border-radius:50%;background:var(--grn);border:2px solid var(--bg)}',
'.tl-time{font-family:var(--mono);font-size:11px;color:var(--grn);font-weight:600}',
'.tl-desc{font-size:13px;color:var(--dim);margin-top:2px}',
/* Toast */
'.cron-box{background:var(--card);border:1px solid var(--grn);border-radius:8px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:var(--fg)}',
'.pro-note{font-size:12px;color:var(--dim);margin-bottom:12px;padding:8px 12px;background:#161b22;border-radius:6px;border-left:3px solid var(--yel)}',
'.pro-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--brd);border-radius:8px;overflow:hidden;font-size:12px;margin-bottom:16px}',
'.pro-tbl th{background:#21262d;color:var(--dim);padding:8px 12px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--brd)}',
'.pro-tbl td{padding:8px 12px;border-top:1px solid var(--brd);vertical-align:top}',
'.pro-tbl tr:hover td{background:rgba(255,255,255,.02)}',
'.pro-link{color:var(--acc);font-size:11px;margin-right:6px}',
'.toast{position:fixed;bottom:22px;right:22px;padding:11px 18px;border-radius:8px;font-size:13px;z-index:200;transition:.3s;opacity:0;transform:translateY(10px)}',
'.toast.show{opacity:1;transform:translateY(0)}',
'.toast.ok{background:#2ea043;color:#fff}.toast.err{background:#da3633;color:#fff}',
/* Chart containers */
'.chart-box{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:16px;margin-bottom:16px}',
'.chart-box canvas{max-height:260px}',
'.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}',
/* Heatmap */
'.heatmap{display:grid;grid-template-columns:40px repeat(24,1fr);gap:2px;font-size:9px;margin-bottom:16px}',
'.hm-label{font-family:var(--mono);color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:10px}',
'.hm-cell{aspect-ratio:1;border-radius:3px;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:8px;cursor:default;transition:.15s}',
'.hm-cell:hover{outline:1px solid var(--grn)}',
'.hm-head{font-family:var(--mono);color:var(--dim);text-align:center;font-size:8px;padding:2px 0}',
/* KPI enhanced */
'.kpi-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}',
'.kpi-box{background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px}',
'.kpi-box .kv{font-family:var(--mono);font-size:1.4rem;font-weight:700;color:var(--grn)}',
'.kpi-box .kl{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;font-weight:600}',
'.kpi-box .kd{font-size:11px;margin-top:3px}',
'.kd.pos{color:var(--grn)}.kd.neg{color:var(--red)}.kd.neu{color:var(--dim)}',
/* Pipeline funnel */
'.funnel{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}',
'.funnel-stage{flex:1;min-width:100px;background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:10px;text-align:center;cursor:pointer;transition:.15s}',
'.funnel-stage:hover,.funnel-stage.active{border-color:var(--grn);background:rgba(63,185,80,.05)}',
'.funnel-stage .fs-count{font-family:var(--mono);font-size:1.3rem;font-weight:700;color:var(--grn)}',
'.funnel-stage .fs-label{font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}',
/* Lead score badge */
'.score-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-family:var(--mono);font-size:11px;font-weight:700}',
'.score-high{background:rgba(63,185,80,.15);color:var(--grn)}',
'.score-mid{background:rgba(210,153,34,.15);color:var(--yel)}',
'.score-low{background:rgba(248,81,73,.15);color:var(--red)}',
/* Scatter dot */
'.scatter-legend{display:flex;gap:14px;margin-bottom:10px;font-size:11px;color:var(--dim)}',
'.scatter-legend span{display:flex;align-items:center;gap:4px}',
'.scatter-legend .dot{width:10px;height:10px;border-radius:50%;display:inline-block}',
/* Lead timeline */
'.ltl{border-left:2px solid var(--brd);padding-left:16px;margin:10px 0}',
'.ltl-item{position:relative;padding:8px 0}',
'.ltl-item::before{content:"";position:absolute;left:-21px;top:13px;width:10px;height:10px;border-radius:50%;background:var(--grn);border:2px solid var(--bg)}',
'.ltl-item .ltl-date{font-family:var(--mono);font-size:10px;color:var(--dim)}',
'.ltl-item .ltl-text{font-size:12px;margin-top:2px}',
/* Select inline */
'.sel-inline{background:var(--bg);border:1px solid var(--brd);border-radius:4px;color:var(--txt);font-size:11px;padding:2px 6px;font-family:inherit;cursor:pointer}',
'.sel-inline:focus{outline:none;border-color:var(--grn)}',
'@media(max-width:700px){.birow,.frow{grid-template-columns:1fr}.header{height:auto;padding:8px 12px;flex-wrap:wrap}.chart-row{grid-template-columns:1fr}.heatmap{grid-template-columns:30px repeat(24,1fr)}}',
'</style>',
'</head>',
'<body>',
'<div class="header">',
'<button class="hburger" id="hburger" aria-label="Menu"><span></span><span></span><span></span></button>',
'<div class="logo"><em>LI</em> Dashboard</div>',
'<div class="current-tab" id="current-tab">Posty</div>',
'<div class="nav-overlay" id="nav-overlay"></div>',
'<nav class="tabnav" id="tabnav">',
'<div class="nav-header">Menu</div>',
'<details class="nav-group" data-group="operacje" open>',
'<summary>📅 Operacje</summary>',
'<button class="tnb active" data-tab="posty">Kolejka postów</button>',
'<button class="tnb" data-tab="rutyna">Automatyzacje</button>',
'</details>',
'<details class="nav-group" data-group="tresc">',
'<summary>✍️ Treść</summary>',
'<button class="tnb" data-tab="artykuly">Artykuły</button>',
'<button class="tnb" data-tab="kontenty">Insights</button>',
'</details>',
'<details class="nav-group" data-group="crm">',
'<summary>👥 CRM</summary>',
'<button class="tnb" data-tab="prospekci">Inbound</button>',
'<button class="tnb" data-tab="leady">Pipeline</button>',
'</details>',
'<details class="nav-group" data-group="engagement">',
'<summary>💬 Engagement</summary>',
'<button class="tnb" data-tab="propozycje" id="tab-btn-propozycje">Propozycje</button>',
'<button class="tnb" data-tab="watki" id="tab-btn-watki">Wątki</button>',
'</details>',
'<details class="nav-group" data-group="analytics">',
'<summary>📊 Analytics</summary>',
'<button class="tnb" data-tab="analytics">Performance</button>',
'<button class="tnb" data-tab="siec">Sieć</button>',
'</details>',
'<details class="nav-group" data-group="system">',
'<summary>⚙️ System</summary>',
'<button class="tnb" data-tab="ustawienia">Wytyczne AI</button>',
'</details>',
'</nav>',
'<div class="sbar" id="sbar">...</div>',
'</div>',
// ── Tab: Posty (Scheduler) ──────────────────────────────────────────────
'<div class="tab-panel active" id="tab-posty">',
'<div class="wrap">',
'<div class="post-stats" id="post-stats"></div>',
// Iter2: toggle widok\u00f3w
'<div class="toolbar" style="margin-bottom:12px">',
'<div class="view-toggle" id="posts-view-toggle">',
'<button class="btn sm active" data-view="list">\ud83d\udccb Lista</button>',
'<button class="btn sm" data-view="week">\ud83d\udcc5 Tydzie\u0144</button>',
'</div>',
// Iter6: filtr okresu \u2014 domy\u015blnie 365d ukrywa archiwum sprzed roku
'<select id="posts-period" class="sel-inline" style="margin-left:12px;font-size:12px;padding:5px 9px;background:var(--card);border:1px solid var(--brd);color:var(--txt);border-radius:6px">',
'<option value="90d">Ostatnie 90 dni</option>',
'<option value="365d" selected>Ostatni rok</option>',
'<option value="future">Tylko przysz\u0142e</option>',
'<option value="all">Wszystkie (te\u017c archiwum)</option>',
'</select>',
'<button class="btn primary" id="btnNew" style="margin-left:auto">+ New Post</button>',
'</div>',
// View: Lista (default)
'<div id="posts-view-list">',
'<div class="toolbar"><span style="font-size:14px;font-weight:700">Nadchodz\u0105ce</span></div>',
'<div id="posts-upcoming"></div>',
'<div style="margin-top:20px"><span style="font-size:14px;font-weight:700;color:var(--dim)">Proponowane (<span id="propCount">0</span>)</span></div>',
'<div id="posts-proposed" style="margin-top:10px"></div>',
'<div style="margin-top:28px;display:flex;align-items:center;gap:10px">',
'<span style="font-size:14px;font-weight:700;color:var(--yel)">\ud83d\udca1 Pomys\u0142y z Media Plan (<span id="ideasCount">0</span>)</span>',
'<span style="font-size:11px;color:var(--dim)">Status \u201eplan\u201d \u2014 jeszcze nie napisane. Klik \u201cPrzer\u00f3b\u201d odpala generator z humanizer + fact-checker.</span>',
'<button class="btn sm" id="btn-ideas-refresh" style="margin-left:auto">\u21ba</button>',
'</div>',
'<div id="posts-media-ideas" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px"></div>',
'<div class="hist-toggle"><button class="btn" id="btnHistory">Poka\u017c histori\u0119 (<span id="histCount">0</span> post\u00f3w)</button></div>',
'<div id="posts-history" style="display:none"></div>',
'</div>',
// View: Tydzie\u0144 (alias dla dawnego Kalendarza)
'<div id="posts-view-week" style="display:none"></div>',
'</div>',
'</div>',
// ── Tab: Prospekci & Zaproszenia ────────────────────────────────────────
'<div class="tab-panel" id="tab-mediaplan"><div class="wrap" id="mp-root"></div></div>',
'<div class="tab-panel" id="tab-prospekci"><div class="wrap" id="pro-root"></div></div>',
// ── Tab: Kalendarz (Iter2: usunięty — widok tygodniowy żyje w tab-posty toggle) ──
// ── Tab: Rutyna ─────────────────────────────────────────────────────────
'<div class="tab-panel" id="tab-rutyna"><div class="wrap" id="rut-root"></div></div>',
// ── Tab: Analytics ──────────────────────────────────────────────────
'<div class="tab-panel" id="tab-analytics"><div class="wrap" id="ana-root"></div></div>',
// ── Tab: Siec (Network) ────────────────────────────────────────────
'<div class="tab-panel" id="tab-siec"><div class="wrap" id="siec-root"></div></div>',
// ── Tab: Ustawienia (Wytyczne AI) ──────────────────────────────────
'<div class="tab-panel" id="tab-ustawienia"><div class="wrap" id="ust-root">',
'<div id="scraper-panel" style="margin-bottom:28px"></div>',
'<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">',
'<h2 style="margin:0;font-size:16px">⚙️ Wytyczne AI</h2>',
'<span style="font-size:11px;color:var(--dim)">Stosowane przy generowaniu postów (draft-article) i odpowiedzi na komentarze (auto-comment-playwright). Zmiana = natychmiast w kolejnym wywołaniu, bez restartu.</span>',
'</div>',
'<div id="ust-blocks"></div>',
'</div></div>',
// ── Tab: Leady (Pipeline) ──────────────────────────────────────────
'<div class="tab-panel" id="tab-leady"><div class="wrap" id="leady-root"></div></div>',
// ── Tab: Kontenty (Content Intelligence) ───────────────────────────
'<div class="tab-panel" id="tab-kontenty"><div class="wrap" id="kontenty-root"></div></div>',
// ── Tab: Artykuły (Article Drafter — Wariant G-A) ──────────────────
'<div class="tab-panel" id="tab-artykuly"><div class="wrap" id="art-root"></div></div>',

// ── Tab: Propozycje odpowiedzi ──────────────────────────────────────────────
'<div class="tab-panel" id="tab-propozycje">',
'<div class="wrap">',
'<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">',
'<h2 style="margin:0;font-size:16px">💬 Propozycje odpowiedzi</h2>',
'<span id="prop-count" style="background:var(--blu);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">0</span>',
'<span id="engine-health" title="Silnik komentarzy: Playwright scrape + Opus 4.8. Zielony = skanuje i odświeża drzewko." style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--dim);color:#fff;cursor:default">⚙️ …</span>',
'<button class="btn sm" id="fetch-all-comments" title="Wymuś pełny skan: wszystkie posty → wszystkie komentarze + odpowiedzi pod nimi → odśwież drzewko i propozycje">📥 Pobierz wszystkie</button>',
'<select id="prop-filter" style="margin-left:auto;background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:4px 8px;border-radius:4px;font-size:12px">',
'<option value="pending">Oczekujące</option>',
'<option value="blocked">🚫 Zablokowane (walidacja)</option>',
'<option value="all">Wszystkie</option>',
'<option value="sent">Wysłane</option>',
'<option value="rejected">Odrzucone</option>',
'</select>',
'<label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:4px;cursor:pointer" title="Domyślnie ukrywamy wątki gdzie już odpowiedziałeś — bo bot scrape\\\'uje notyfikacje pod Twoimi replykami i sugeruje follow-up. Zaznacz żeby zobaczyć follow-upy.">',
'<input type="checkbox" id="prop-show-replied" style="margin:0"> pokaż follow-upy',
'</label>',
'<button class="btn sm" id="prop-refresh">↺ Odśwież</button>',
'</div>',
'<div id="prop-list"></div>',
'</div>',
'</div>',

// ── Tab: Wątki (thread_memory) ──────────────────────────────────────────────
'<div class="tab-panel" id="tab-watki">',
'<div class="wrap">',
'<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">',
'<h2 style="margin:0;font-size:16px">🧵 Pamięć wątków komentarzy</h2>',
'<span id="watki-count" style="background:var(--blu);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">0</span>',
'<span id="watki-last-cycle" style="font-size:11px;color:var(--dim);margin-left:auto"></span>',
'<button class="btn sm" id="watki-refresh">↺ Odśwież</button>',
'</div>',
'<div id="watki-cycles" style="margin-bottom:16px"></div>',
'<div id="watki-filters" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">',
'<input id="w-q" placeholder="🔍 szukaj w treści posta" style="flex:1;min-width:200px;background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:6px 10px;border-radius:4px;font-size:12px">',
'<select id="w-reply" style="background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:6px 8px;border-radius:4px;font-size:12px">',
'<option value="all">Wszystkie</option>',
'<option value="1">✅ Z naszymi odp</option>',
'<option value="0">⏳ Bez naszych odp</option>',
'</select>',
'<input id="w-since" type="date" style="background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:6px 8px;border-radius:4px;font-size:12px" title="Od daty publikacji">',
'<select id="w-sort" style="background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:6px 8px;border-radius:4px;font-size:12px">',
'<option value="published_desc">📅 Najnowsze publikacje</option>',
'<option value="published_asc">📅 Najstarsze publikacje</option>',
'<option value="comments_desc">💬 Najwięcej komentarzy</option>',
'<option value="no_reply_first">⏳ Bez odp najpierw</option>',
'<option value="scraped_desc">⏰ Ostatnio scrapowane</option>',
'</select>',
'<button class="btn sm" id="w-clear" title="Wyczyść filtry">✗</button>',
'</div>',
'<div id="watki-list"></div>',
'</div>',
'</div>',

// ── Modal ───────────────────────────────────────────────────────────────
'<div class="overlay" id="ov">',
'<div class="modal">',
'<h2 id="mtitle">Edit Post</h2>',
'<input type="hidden" id="eid">',
'<div class="birow">',
'<div class="lcol" id="cpl"><label>PL Polski</label>',
'<textarea id="tpl" placeholder="Napisz post po polsku..."></textarea>',
'<div class="cc"><span id="ccpl">0</span> chars (1300-1600)</div></div>',
'<div class="lcol" id="cen"><label>EN English</label>',
'<textarea id="ten" placeholder="Write your post in English..."></textarea>',
'<div class="cc"><span id="ccen">0</span> chars (1300-1600)</div></div>',
'</div>',
'<div class="frow">',
'<div class="fg"><label>Publish At (local time)</label><input type="datetime-local" id="edate"></div>',
'<div class="fg"><label>Publish Language</label><div class="lradio" id="lrad">',
'<button type="button" data-l="pl">PL</button><button type="button" data-l="en">EN</button>',
'</div></div>',
'</div>',
// Iter2: edytowalny pierwszy komentarz (override hardcoded mapowania)
'<div class="frow" style="grid-template-columns:1fr">',
'<div class="fg"><label>Pierwszy komentarz (15 min po publikacji) <span id="acom-source" style="font-size:10px;font-weight:400;color:var(--dim);margin-left:6px"></span></label>',
'<textarea id="auto-comment" rows="3" placeholder="Zostaw puste — użyje domyślnego z mapowania" style="width:100%;background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:8px;border-radius:4px;font-family:inherit;font-size:12px;resize:vertical"></textarea>',
'<div class="cc" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span><span id="acom-cc">0</span> znaków</span><button type="button" class="btn sm" id="acom-reset" style="font-size:11px">↺ Domyślny (auto)</button></div>',
'</div></div>',
// Iter2: sekcja Media (banner / zdjęcie / wideo per post)
'<div class="frow" style="grid-template-columns:1fr">',
'<div class="fg"><label>Media załączone do posta</label>',
'<div id="media-preview" style="margin-bottom:8px;min-height:40px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>',
'<div class="media-actions" style="display:flex;gap:8px;flex-wrap:wrap">',
'<input type="file" id="media-file" accept="image/*,video/*" style="display:none">',
'<button type="button" class="btn sm" id="media-upload-btn">📎 Wybierz plik</button>',
'<select id="banner-preset" class="sel-inline" style="font-size:11px"><option value="">— preset banera —</option><option value="post5">post5</option><option value="post6">post6</option><option value="post7">post7</option><option value="post8">post8</option><option value="post9">post9</option><option value="post10">post10</option><option value="post11">post11</option><option value="post12">post12</option><option value="post13">post13</option><option value="post14">post14</option><option value="post15">post15</option><option value="post16">post16</option><option value="post17">post17</option></select>',
'<button type="button" class="btn sm" id="media-banner-btn">🎨 Generuj banner</button>',
'<button type="button" class="btn sm" id="media-ai-image-btn" style="background:rgba(56,139,253,.15);color:var(--blu);border-color:var(--blu)">🤖 AI Image (Imagen 4)</button>',
'<button type="button" class="btn sm" id="media-remove-btn" style="background:var(--red);border-color:var(--red);color:#fff">🗑️ Usuń media</button>',
'</div></div></div>',
'<div class="mact"><button class="btn" id="mcancel">Cancel</button><button class="btn primary" id="msave">Save</button></div>',
'</div>',
'</div>',
'<div class="toast" id="toast"></div>',

// Iter6: Proposed post detail modal — readonly view + quick schedule
'<div class="overlay" id="pp-ov">',
'<div class="modal" style="width:720px">',
'<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">',
'<h2 id="pp-mtitle" style="margin:0;flex:1">Proponowany post</h2>',
'<button class="btn sm" id="pp-close" style="font-size:14px;padding:4px 10px">✕</button>',
'</div>',
'<div id="pp-meta" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"></div>',
'<div id="pp-screenshot" style="font-size:11px;color:var(--yel);margin-bottom:10px;display:none"></div>',
'<label style="display:block;font-size:11px;color:var(--dim);margin-bottom:4px">Pełna treść posta:</label>',
'<textarea id="pp-text" readonly style="width:100%;min-height:280px;background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:10px;border-radius:6px;font-family:inherit;font-size:13px;line-height:1.5;resize:vertical"></textarea>',
'<div id="pp-hashtags" style="margin:8px 0;display:flex;gap:4px;flex-wrap:wrap"></div>',
'<div class="mact" style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">',
'<button class="btn" id="pp-copy">📋 Kopiuj tekst</button>',
'<button class="btn primary" id="pp-schedule">📅 Zaplanuj teraz</button>',
'</div>',
'</div>',
'</div>',

// ── Media Plan modal ──
'<div class="overlay" id="mp-ov">',
'<div class="modal" style="width:980px">',
'<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">',
'<h2 id="mp-mtitle" style="margin:0;flex:1">Media Plan — Edit</h2>',
'<button type="button" class="btn sm" id="mp-regenerate-btn" style="background:rgba(63,185,80,.15);color:var(--grn);border-color:var(--grn)" title="Regeneruj treść przez Claude Opus + git log projektu (anti-halucynacje)">🤖 Regeneruj treść</button>',
'</div>',
'<div id="mp-meta" style="margin-bottom:14px;font-size:12px;color:var(--dim)"></div>',
'<div class="frow" style="margin-bottom:10px">',
'<div class="fg"><label>Hook (pierwsze 62 znaki — widoczne przed "see more")</label><input type="text" id="mp-hook" placeholder="Konkretne zdanie. Problem lub fakt." maxlength="120" style="font-weight:600"></div>',
'<div class="fg" style="max-width:220px"><label>Title (wewnętrzny)</label><input type="text" id="mp-title" placeholder="Tytuł tematu"></div>',
'</div>',
'<div class="lcol act" style="margin-bottom:14px">',
'<label>Treść posta (PL/EN — wg item.language)</label>',
'<textarea id="mp-text" placeholder="Napisz treść 1300-1700 znaków..." style="min-height:280px"></textarea>',
'<div class="cc"><span id="mp-cc">0</span> chars (target 1300-1700) · <span id="mp-cc-warn" style="color:var(--red)"></span></div>',
'</div>',
'<div class="frow">',
'<div class="fg"><label>Banner path</label><input type="text" id="mp-banner" placeholder=".../banner.png"><div id="mp-banner-preview" style="margin-top:6px;min-height:54px"></div><div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm" id="mp-gen-banner">🎨 Generate via MCP</button><label class="btn sm" style="cursor:pointer">📁 Upload<input type="file" id="mp-upload-banner" accept=".png,.jpg,.jpeg" style="display:none"></label></div></div>',
'<div class="fg"><label>Visual asset path</label><input type="text" id="mp-visual" placeholder=".../screenshot.png lub .../demo.mp4"><div style="display:flex;gap:6px;margin-top:6px"><label class="btn sm" style="cursor:pointer">📁 Upload screen/video<input type="file" id="mp-upload-visual" accept="image/*,video/*" style="display:none"></label></div></div>',
'</div>',
'<div class="frow">',
'<div class="fg"><label>Hashtags (space-separated, with #)</label><input type="text" id="mp-hashtags" placeholder="#mcp #automation #algorithm"></div>',
'<div class="fg"><label>CTA</label><input type="text" id="mp-cta" placeholder="DM **WORD** — pokażę..."></div>',
'</div>',
'<div class="frow">',
'<div class="fg"><label>Publish at</label><input type="datetime-local" id="mp-publish-at"></div>',
'<div class="fg"><label>Wiki slug</label><input type="text" id="mp-wiki-slug" placeholder="/baza-wiedzy/<slug>"></div>',
'</div>',
'<div class="cprev"><b>Visual asset plan (5-min capture):</b><br><pre id="mp-visual-plan" style="white-space:pre-wrap;font-size:11px;font-family:var(--mono);color:#c9d1d9;margin-top:6px"></pre></div>',
'<div class="cprev" id="mp-gsc-box" style="display:none"><b>GSC inspect result:</b><br><pre id="mp-gsc-result" style="white-space:pre-wrap;font-size:11px;font-family:var(--mono);color:#c9d1d9;margin-top:6px;max-height:200px;overflow-y:auto"></pre></div>',
'<div class="mact" style="flex-wrap:wrap;justify-content:flex-start;gap:6px">',
'<button class="btn" id="mp-mcancel">Cancel</button>',
'<button class="btn primary" id="mp-msave">💾 Save</button>',
'<button class="btn" id="mp-recheck-can" style="background:#21262d">🔍 Recheck cannibalize</button>',
'<button class="btn" id="mp-mark-napisane" style="background:#bf8700;border-color:#bf8700">✍️ Mark Napisane</button>',
'<button class="btn" id="mp-schedule" style="background:#1f6feb;border-color:#1f6feb">🚀 Schedule LinkedIn</button>',
'<button class="btn" id="mp-gsc-inspect" style="background:#21262d">🔎 GSC Inspect</button>',
'<button class="btn" id="mp-gsc-submit" style="background:#238636;border-color:#238636">📤 GSC Submit</button>',
'<button class="btn danger" id="mp-cancel-item">❌ Cancel item</button>',
'</div>',
'</div>',
'</div>',

'<script>',
buildJs(),
'</script>',
'</body>',
'</html>',
  ].join('\n');
}

function buildJs() {
  // Build JS as plain string to avoid template literal escaping issues
  return `
var posts = [];
var plang = 'en';

var PI = ${JSON.stringify(POST_IDENTIFIERS)};
var AC = ${JSON.stringify(AUTO_COMMENTS)};

function gkey(t) { for (var s in PI) { if (t.indexOf(s) >= 0) return PI[s]; } return null; }
function gcom(t) { var k = gkey(t); return AC[k] || AC['default']; }

function $$(id) { return document.getElementById(id); }
function api(p, o) { return fetch(p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o || {})).then(function(r) { return r.json(); }); }

function toast(m, ok) {
  var t = $$('toast');
  t.textContent = m;
  t.className = 'toast ' + (ok ? 'ok' : 'err') + ' show';
  setTimeout(function() { t.classList.remove('show'); }, 3000);
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function pad(n) { return String(n).padStart(2, '0'); }
function toLocal(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function urnToUrl(urn) {
  if (!urn) return null;
  return 'https://www.linkedin.com/feed/update/' + encodeURIComponent(urn);
}

// ── Chart.js helpers ──────────────────────────────────────────────────────────
var _charts = {};
function createChart(canvasId, type, labels, datasets, opts) {
  if (_charts[canvasId]) { _charts[canvasId].destroy(); delete _charts[canvasId]; }
  var el = document.getElementById(canvasId);
  if (!el) return null;
  var defaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b949e', font: { family: 'DM Sans', size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } },
      y: { ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } }
    }
  };
  if (type === 'doughnut' || type === 'pie') { delete defaults.scales; }
  var merged = Object.assign({}, defaults);
  if (opts) {
    if (opts.plugins) merged.plugins = Object.assign({}, defaults.plugins, opts.plugins);
    if (opts.scales) merged.scales = Object.assign({}, defaults.scales, opts.scales);
    for (var k in opts) { if (k !== 'plugins' && k !== 'scales') merged[k] = opts[k]; }
  }
  _charts[canvasId] = new Chart(el, { type: type, data: { labels: labels, datasets: datasets }, options: merged });
  return _charts[canvasId];
}

function loadStatus() {
  api('/api/status').then(function(s) {
    var b = $$('sbar');
    var dd = s.daemon.running ? 'g' : 'r';
    var dt = s.daemon.running ? 'Daemon PID ' + s.daemon.pid : 'Daemon stopped';
    var ad = s.auth.valid && !s.auth.expired ? 'g' : s.auth.valid ? 'y' : 'r';
    var at = s.auth.valid ? (s.auth.expired ? 'Token expired' : s.auth.user) : 'No auth';
    var sch = s.counts.scheduled || 0;
    var pub = s.counts.published || 0;
    var nt = s.next_post ? new Date(s.next_post).toLocaleString('pl-PL', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '-';
    var conn = localStorage.getItem('li_connections') || '';
    b.innerHTML = '<div class="si"><span class="sdot ' + dd + '"></span>' + dt + '</div>'
      + '<div class="si"><span class="sdot ' + ad + '"></span>' + at + '</div>'
      + '<div class="si">Scheduled: <b style="color:var(--blu)">' + sch + '</b></div>'
      + '<div class="si">Published: <b style="color:var(--grn)">' + pub + '</b></div>'
      + '<div class="si">Next: ' + nt + '</div>'
      + '<div class="si">Conn: <input type="number" min="0" style="width:55px;background:var(--bg);border:1px solid var(--brd);border-radius:4px;color:var(--grn);font-family:var(--mono);font-size:11px;padding:2px 4px;text-align:center" value="' + esc(conn) + '" data-kpi="li_connections"></div>';
  });
}

function loadPosts() {
  api('/api/posts').then(function(data) {
    posts = data;
    render();
    loadUnifiedQueue();  // Iter10: pomysły z media_plan_items.status='plan'
  });
}

function renderCard(p) {
  var dt = p.publish_at ? new Date(p.publish_at).toLocaleString('pl-PL') : '-';
  var pd = p.published_at ? new Date(p.published_at).toLocaleString('pl-PL') : '';
  var isSch = p.status === 'scheduled';
  var isFail = p.status === 'failed';
  var lang = (p.language || 'en').toUpperCase();
  var lc = 'b-' + (p.language || 'en');
  var bi = p.text_alt ? '<span class="badge b-bi">PL+EN</span>' : '';
  var com = p.auto_comment || gcom(p.text);
  var comShort = com.length > 120 ? com.substring(0, 120) + '...' : com;
  // Iter11/12: PRIORYTET dla unifiedMatch.media_url (NVIDIA FLUX z media_plan_items
  // przez endpoint /media-image/<slug> z auto-detect JPEG/PNG). Stary /post-media/{id}/...
  // nie serwuje z ~/.linkedin-mcp/images/posts/.
  var unifiedMatch = null;
  if (UNIFIED_CACHE && UNIFIED_CACHE.scheduled) {
    unifiedMatch = UNIFIED_CACHE.scheduled.find(function(s) { return s.id === p.id; });
  }
  // Iter2: media hierarchia
  var img = '';
  if (unifiedMatch && unifiedMatch.media_url) {
    // PRIORYTET 1: NVIDIA FLUX z media_plan_items.visual_asset_path (przez /media-image/<slug>)
    img = '<div class="card-img"><img src="' + esc(unifiedMatch.media_url) + '" alt="' + esc(unifiedMatch.mp_title || unifiedMatch.mp_slug || '') + '" loading="lazy"></div>';
  } else if (p.media_preview_path) {
    var mediaSrc = '/post-media/' + p.id + '/' + p.media_preview_path.split('/').pop();
    var isVideo = p.media_kind === 'video' || /\.(mp4|webm|mov)$/i.test(p.media_preview_path);
    img = isVideo
      ? '<div class="card-img"><video src="' + esc(mediaSrc) + '" muted preload="metadata" style="width:100%;max-height:280px;object-fit:cover"></video></div>'
      : '<div class="card-img"><img src="' + esc(mediaSrc) + '" alt="Post media"></div>';
  } else if (p.image_file) {
    img = '<div class="card-img"><img src="/img/' + esc(p.image_file) + '" alt="Post image"></div>';
  } else if (p.media_ids) {
    var urnCount = 0; try { urnCount = JSON.parse(p.media_ids || '[]').length; } catch(e) {}
    if (urnCount) img = '<div class="card-img card-img-urn" style="background:var(--bg);padding:14px;text-align:center;color:var(--dim);font-size:12px;border:1px dashed var(--brd);border-radius:6px">🔗 ' + urnCount + ' media załączone (LinkedIn URN)</div>';
  } else if (unifiedMatch && unifiedMatch.media_url) {
    // Iter11: obraz z media_plan_items.visual_asset_path (NVIDIA FLUX wygenerowany przez gen-image-nvidia)
    img = '<div class="card-img"><img src="' + esc(unifiedMatch.media_url) + '" alt="' + esc(unifiedMatch.mp_title || unifiedMatch.mp_slug || '') + '" loading="lazy"></div>';
  }
  var acomBadge = p.auto_comment_source === 'custom'
    ? '<span style="font-size:10px;background:var(--yel);color:#000;padding:1px 6px;border-radius:3px;margin-right:6px">✏️ custom</span>'
    : '';
  var cls = 'card card-' + p.status;

  var h = '<div class="' + cls + '" data-id="' + p.id + '">';
  h += '<div class="card-top"><div class="meta">';
  h += '<span class="badge b-' + p.status + '">' + p.status + '</span>';
  h += '<span class="badge ' + lc + '">' + lang + '</span>';
  h += bi;
  h += '<span>' + dt + '</span>';
  if (pd) h += '<span>Published: ' + pd + '</span>';
  // QA bramka (nowy algorytm): status + score experience/emotion/specificity
  if (p.qa_status) {
    var qaBg = p.qa_status === 'approved' ? '#1f6f3f' : (p.qa_status === 'hold' ? '#8a5a00' : '#5a1f1f');
    h += '<span class="badge" style="background:' + qaBg + ';color:#fff">QA ' + esc(p.qa_status) + '</span>';
    var qsc = null; try { qsc = JSON.parse(p.qa_scores || 'null'); } catch (e) {}
    if (qsc && qsc.scores) {
      var d = qsc.scores;
      var lo = function(v, min) { return (v == null ? '?' : v) + (v != null && v < min ? '⚠' : ''); };
      h += '<span class="badge" title="experience/emotion/specificity — próg 3/2/3, suma ≥10. ⚠ = poniżej progu" style="background:#22272e;color:#adbac7">🧬' + lo(d.experience, 3) + ' ❤️' + lo(d.emotion, 2) + ' 🎯' + lo(d.specificity, 3) + '</span>';
      if (qsc.isGenBanner) h += '<span class="badge" title="grafika generowana zbija zasięg (test #11)" style="background:#3a2a00;color:#e3b341">⚠ banner</span>';
    }
  }
  if (p.post_urn) {
    var url = urnToUrl(p.post_urn);
    h += '<a href="' + esc(url) + '" target="_blank" style="font-size:11px;color:var(--blu)">Otworz na LinkedIn &rarr;</a>';
  }
  if (p.error) h += '<span style="color:#f85149">' + esc(p.error) + '</span>';
  h += '</div></div>';
  h += img;
  h += '<div class="ptxt" data-act="expand">' + esc(p.text) + '</div>';
  h += '<span class="toggle" data-act="expand">Show more</span>';
  h += '<div class="acom">' + acomBadge + '<b>Auto-comment (15m):</b> ' + esc(comShort) + '</div>';
  // Iter7: drzewko komentarzy LinkedIn dla published — lazy load on toggle
  if (p.status === 'published' && p.post_urn) {
    var safeId = p.post_urn.replace(/[^a-z0-9]/gi, '_');
    h += '<details class="comments-tree-wrap" data-load-comments="' + esc(p.post_urn) + '" data-post-id="' + esc(p.id) + '" style="margin-top:8px;border-top:1px solid var(--brd);padding-top:8px">';
    h += '<summary style="cursor:pointer;font-size:12px;color:var(--blu);user-select:none;list-style:none">💬 Komentarze (kliknij aby załadować)</summary>';
    h += '<div class="comments-tree" id="ct-' + safeId + '" style="margin-top:8px"></div>';
    h += '</details>';
  }
  h += '<div class="actions">';
  if (isSch || isFail) h += '<button class="btn sm" data-act="edit" data-id="' + p.id + '">Edit</button>';
  if (isSch) h += '<button class="btn sm primary" data-act="publish" data-id="' + p.id + '">Publish Now</button>';
  if (isSch) h += '<button class="btn sm danger" data-act="cancel" data-id="' + p.id + '">Cancel</button>';
  h += '</div></div>';
  return h;
}

function renderProposedCard(p, idx) {
  var dt = new Date(p.date);
  var dateStr = dt.toLocaleDateString('pl-PL', {weekday:'short', day:'numeric', month:'short'}) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  var catColors = {'build-log': 'var(--blu)', 'e-gov': 'var(--yel)', 'failure': 'var(--red)'};
  var catColor = catColors[p.category] || 'var(--dim)';
  var h = '<div class="card card-proposed">';
  h += '<div class="card-top"><div class="meta">';
  h += '<span class="badge" style="background:rgba(210,153,34,.15);color:var(--yel)">proponowany</span>';
  h += '<span class="badge" style="background:rgba(210,153,34,.1);color:' + catColor + '">' + esc(p.category || '') + '</span>';
  h += '<span>' + esc(dateStr) + '</span>';
  h += '<span style="color:var(--dim)">' + esc(p.title || '') + '</span>';
  h += '</div></div>';
  if (p.image) {
    h += '<div class="card-img"><img src="/img/' + esc(p.image) + '" alt="' + esc(p.title || '') + '"></div>';
  }
  if (p.screenshot) {
    h += '<div style="font-size:11px;color:var(--yel);margin:4px 0;padding:4px 8px;background:rgba(210,153,34,.08);border-radius:4px;border-left:2px solid var(--yel)">Screenshot: ' + esc(p.screenshot) + '</div>';
  }
  h += '<div class="ptxt" data-act="expand">' + esc(p.text || '') + '</div>';
  h += '<span class="toggle" data-act="expand">Show more</span>';
  h += '<div class="actions">';
  // Iter6: drill-down do pełnych szczegółów + planowania
  h += '<button class="btn sm" data-act="show-proposed" data-idx="' + idx + '">👁️ Szczegóły</button>';
  h += '<button class="btn sm primary" data-act="schedule-proposed" data-idx="' + idx + '">+ Zaplanuj ten post</button>';
  h += '</div></div>';
  return h;
}

// Iter6: filtr okresu — używany w Liście i Tygodniu
function getPostsPeriod() {
  var sel = document.getElementById('posts-period');
  return (sel && sel.value) || localStorage.getItem('li_posts_period') || '365d';
}
function filterByPeriod(items, period, dateField) {
  if (period === 'all') return items;
  var now = Date.now();
  var df = dateField || 'publish_at';
  if (period === 'future') {
    return items.filter(function(p) {
      var d = new Date(p[df] || p.date || 0).getTime();
      return !isNaN(d) && d >= now;
    });
  }
  var ms = period === '90d' ? 90 * 86400000 : 365 * 86400000;
  return items.filter(function(p) {
    var d = new Date(p[df] || p.date || 0).getTime();
    return !isNaN(d) && d >= now - ms;
  });
}

// Iter10: zaciąga pomysły z media_plan_items.status='plan' (+ media URL dla scheduled).
// Scala "Kolejka postów" z "Media Plan" w jeden widok zgodnie z wytyczną użytkownika.
var UNIFIED_CACHE = null;
function loadUnifiedQueue() {
  return fetch('/api/posts/queue-unified', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      UNIFIED_CACHE = data;
      renderMediaIdeas(data);
      // Iter11: re-render scheduled cards żeby pokazać miniaturki obrazów z media_plan_items
      if (typeof posts !== 'undefined' && Array.isArray(posts) && posts.length > 0 && typeof render === 'function') {
        render();
      }
      return data;
    })
    .catch(function(e) { console.error('queue-unified failed:', e); return null; });
}

function renderMediaIdeas(data) {
  var box = $$('posts-media-ideas');
  var cnt = $$('ideasCount');
  if (!box || !data) return;
  var ideas = data.proposed || [];
  if (cnt) cnt.textContent = ideas.length;
  if (ideas.length === 0) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1"><p>Wszystkie pomysły z media plan przerobione na posty.</p></div>';
    return;
  }
  var html = '';
  ideas.forEach(function(it) {
    var titleEsc = esc(it.title || it.slug || '(brak tytułu)');
    var hookEsc = esc((it.hook || '').slice(0, 240));
    var fmtEsc = esc(it.format || 'thought-leadership');
    var dateLabel = it.publish_at ? new Date(it.publish_at).toLocaleDateString('pl-PL', {day:'numeric', month:'short'}) : '';
    var langBadge = it.language === 'en' ? 'EN' : 'PL';
    var mediaHtml = '';
    if (it.media_url) {
      mediaHtml = '<div style="margin:8px 0"><img src="' + esc(it.media_url) + '" alt="' + titleEsc + '" style="width:100%;max-height:160px;object-fit:cover;border-radius:6px;border:1px solid var(--brd)"></div>';
    } else if (it.visual_path) {
      mediaHtml = '<div style="font-size:10px;color:var(--dim);margin:4px 0">📎 ' + esc(it.visual_type || 'asset') + ' planowane</div>';
    }
    html += '<div class="card card-idea" data-slug="' + esc(it.slug) + '" style="background:rgba(210,153,34,.06);border:1px solid rgba(210,153,34,.2);border-radius:8px;padding:14px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px">' +
        '<span class="badge" style="background:var(--yel);color:#000;padding:2px 6px;border-radius:3px">#' + (it.topic_number || '?') + '</span>' +
        '<span class="badge" style="background:rgba(255,255,255,.05);color:var(--dim);padding:2px 6px;border-radius:3px">' + langBadge + '</span>' +
        '<span style="color:var(--dim)">' + esc(fmtEsc) + '</span>' +
        (dateLabel ? '<span style="color:var(--dim);margin-left:auto">' + dateLabel + '</span>' : '') +
      '</div>' +
      mediaHtml +
      '<div style="font-weight:600;margin-bottom:6px;font-size:13px;line-height:1.3">' + titleEsc + '</div>' +
      '<div style="font-size:12px;color:var(--txt);opacity:.85;line-height:1.5;margin-bottom:12px">' + hookEsc + (it.hook && it.hook.length > 240 ? '...' : '') + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn primary sm" data-act="idea-regenerate" data-slug="' + esc(it.slug) + '" data-id="' + esc(it.id) + '">⚡ Przerób na post</button>' +
        '<button class="btn sm" data-act="idea-details" data-slug="' + esc(it.slug) + '">👁️ Szczegóły</button>' +
      '</div>' +
    '</div>';
  });
  box.innerHTML = html;
}

// Event delegation dla "Przerób na post" i odśwież ikoniki
document.addEventListener('click', function(e) {
  var btn = e.target.closest && e.target.closest('[data-act="idea-regenerate"]');
  if (btn) {
    e.preventDefault();
    var slug = btn.dataset.slug;
    var id = btn.dataset.id;
    btn.disabled = true;
    btn.textContent = '⏳ Generuje...';
    fetch('/api/media-plan/' + encodeURIComponent(id) + '/regenerate', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          if (typeof toast === 'function') toast('Generuje "' + slug + '" w tle. Odśwież za 60-180s.', true);
          else alert('Generuje w tle: ' + slug);
          btn.textContent = '⏳ W tle...';
          setTimeout(function() { loadUnifiedQueue(); if (typeof load === 'function') load(); }, 90000);
        } else {
          if (typeof toast === 'function') toast('Błąd: ' + (data.error || 'nieznany'), false);
          btn.disabled = false;
          btn.textContent = '⚡ Przerób na post';
        }
      })
      .catch(function(err) {
        if (typeof toast === 'function') toast('Błąd sieci: ' + err.message, false);
        btn.disabled = false;
        btn.textContent = '⚡ Przerób na post';
      });
    return;
  }
  if (e.target.id === 'btn-ideas-refresh') { loadUnifiedQueue(); return; }
});

function render() {
  var period = getPostsPeriod();
  var filtered = filterByPeriod(posts, period, 'publish_at');
  var upcoming = filtered.filter(function(p) { return p.status === 'scheduled'; })
    .sort(function(a, b) { return new Date(a.publish_at) - new Date(b.publish_at); });
  var history = filtered.filter(function(p) { return p.status === 'published' || p.status === 'cancelled' || p.status === 'failed'; })
    .sort(function(a, b) { return new Date(b.publish_at) - new Date(a.publish_at); });

  // Filter proposed posts — exclude dates that already have a scheduled post
  var scheduledDates = {};
  posts.forEach(function(p) { if (p.publish_at) scheduledDates[(p.publish_at||'').slice(0,10)] = true; });
  var proposed = PROPOSED_POSTS.filter(function(p) { return !scheduledDates[p.date.slice(0,10)]; });
  proposed = filterByPeriod(proposed, period, 'date');

  var now = new Date();
  var monthKey = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  var pubThisMonth = posts.filter(function(p) {
    return p.status === 'published' && (p.published_at || p.publish_at || '').slice(0, 7) === monthKey;
  }).length;
  var nextPost = upcoming.length > 0 ? new Date(upcoming[0].publish_at).toLocaleString('pl-PL', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '-';

  var stats = $$('post-stats');
  stats.innerHTML = '<div class="stat">Zaplanowanych: <b>' + upcoming.length + '</b></div>'
    + '<div class="stat">Proponowanych: <b>' + proposed.length + '</b></div>'
    + '<div class="stat">Opublikowanych w tym miesiacu: <b>' + pubThisMonth + '</b></div>'
    + '<div class="stat">Nastepny: <b>' + nextPost + '</b></div>';

  var uc = $$('posts-upcoming');
  if (upcoming.length === 0) {
    uc.innerHTML = '<div class="empty"><p>Brak zaplanowanych postow — zaplanuj post z sekcji ponizej</p></div>';
  } else {
    var uh = '';
    upcoming.forEach(function(p) { uh += renderCard(p); });
    uc.innerHTML = uh;
  }

  // Proposed posts
  var pc = $$('posts-proposed');
  var propCnt = $$('propCount');
  if (propCnt) propCnt.textContent = proposed.length;
  if (proposed.length === 0) {
    pc.innerHTML = '<div class="empty"><p>Wszystkie posty zaplanowane</p></div>';
  } else {
    var ph = '';
    proposed.forEach(function(p) {
      var origIdx = PROPOSED_POSTS.findIndex(function(pp) { return pp.date === p.date; });
      ph += renderProposedCard(p, origIdx);
    });
    pc.innerHTML = ph;
  }

  var hc = $$('histCount');
  if (hc) hc.textContent = history.length;
  var hist = $$('posts-history');
  var hh = '';
  history.forEach(function(p) { hh += renderCard(p); });
  hist.innerHTML = hh;
}

// Event delegation — all clicks handled here
document.addEventListener('click', function(e) {
  var t = e.target;

  // History accordion toggle
  if (t.id === 'btnHistory' || t.closest('#btnHistory')) {
    var hist = $$('posts-history');
    var showing = hist.style.display !== 'none';
    hist.style.display = showing ? 'none' : 'block';
    var btn = $$('btnHistory');
    var cnt = $$('histCount').textContent;
    btn.innerHTML = (showing ? 'Pokaz' : 'Ukryj') + ' historie (<span id="histCount">' + cnt + '</span> postow)';
    return;
  }

  // Schedule proposed post from calendar
  if (t.dataset.act === 'schedule-proposed') {
    var idx = parseInt(t.dataset.idx);
    var pp = PROPOSED_POSTS[idx];
    if (pp) openCreateFromProposed(pp);
    return;
  }
  // Iter6: klik child w klikalnym <tr data-act="schedule-proposed">
  var schedParent = t.closest && t.closest('[data-act="schedule-proposed"]');
  if (schedParent && schedParent.dataset.idx) {
    var idxP = parseInt(schedParent.dataset.idx);
    var ppP = PROPOSED_POSTS[idxP];
    if (ppP) openCreateFromProposed(ppP);
    return;
  }

  // Iter6: drill-down do szczegółów proposed
  if (t.dataset.act === 'show-proposed') {
    var ppIdx = parseInt(t.dataset.idx);
    var ppD = PROPOSED_POSTS[ppIdx];
    if (ppD) openProposedDetail(ppD, ppIdx);
    return;
  }

  // New post
  if (t.id === 'btnNew') { openCreate(); return; }

  // Expand/collapse
  if (t.dataset.act === 'expand') {
    var card = t.closest('.card');
    if (!card) return;
    var ptxt = card.querySelector('.ptxt');
    var tog = card.querySelector('.toggle');
    if (ptxt) {
      ptxt.classList.toggle('open');
      if (tog) tog.textContent = ptxt.classList.contains('open') ? 'Show less' : 'Show more';
    }
    return;
  }

  // Edit (direct button)
  if (t.dataset.act === 'edit') { openEdit(t.dataset.id); return; }

  // Publish now — MUSI być przed editParent (wiersz kalendarza ma data-act="edit",
  // więc przycisk Publish/Cancel wewnątrz wiersza inaczej wpadałby w openEdit)
  if (t.dataset.act === 'publish') { publishNow(t.dataset.id); return; }

  // Cancel
  if (t.dataset.act === 'cancel') { cancelPost(t.dataset.id); return; }

  // Edit — Iter6: klik w child element klikalnego <tr data-act="edit"> (drill-down wiersza).
  // Fallback PO przyciskach, żeby nie przechwytywał klików w Publish/Cancel.
  var editParent = t.closest && t.closest('[data-act="edit"]');
  if (editParent && editParent.dataset.id) { openEdit(editParent.dataset.id); return; }

  // Mark prospect as invited
  if (t.dataset.act === 'mark-invited') {
    var pid = t.dataset.pid;
    fetch('/api/prospects/' + encodeURIComponent(pid) + '/invited', { method: 'POST' })
      .then(function() { loadProspekci(); toast('Oznaczono jako zaproszony'); })
      .catch(function() { toast('Błąd', true); });
    return;
  }

  // Copy by element id
  if (t.dataset.copy) {
    var el = document.getElementById(t.dataset.copy);
    if (el) copyText(el.textContent || el.innerText, t);
    return;
  }

  // Copy chip text
  if (t.dataset.cp !== undefined) { copyText(t.dataset.cp, t); return; }

  // Language radio
  if (t.dataset.l) { setLang(t.dataset.l); return; }

  // Modal cancel/save
  if (t.id === 'mcancel') { closeModal(); return; }
  if (t.id === 'msave') { savePost(); return; }

  // Close overlay on background click
  if (t.id === 'ov') { closeModal(); return; }
});

// Char counts
$$('tpl').addEventListener('input', function() { $$('ccpl').textContent = this.value.length; if (plang === 'pl') updComment(); });
$$('ten').addEventListener('input', function() { $$('ccen').textContent = this.value.length; if (plang === 'en') updComment(); });

// KPI inputs (delegated — rendered dynamically)
document.addEventListener('input', function(e) {
  var t = e.target;
  if (t.dataset.kpi) { localStorage.setItem(t.dataset.kpi, t.value); }
});

// Checklist checkboxes (delegated)
document.addEventListener('change', function(e) {
  var t = e.target;
  if (t.dataset.chk) { localStorage.setItem(t.dataset.chk, t.checked ? '1' : ''); }
});

function updComment() {
  // Iter6: cptext zostało usunięte w Iter2 — null check przed użyciem (preview auto-comment teraz w textarea #auto-comment)
  var cptext = document.getElementById('cptext');
  if (!cptext) return;
  var tplEl = document.getElementById('tpl');
  var tenEl = document.getElementById('ten');
  var txt = plang === 'pl' ? (tplEl?.value || '') : (tenEl?.value || '');
  cptext.textContent = txt ? gcom(txt) : '-';
}

function setLang(l) {
  plang = l;
  document.querySelectorAll('#lrad button').forEach(function(b) {
    b.classList.toggle('sel', b.dataset.l === l);
  });
  $$('cpl').classList.toggle('act', l === 'pl');
  $$('cen').classList.toggle('act', l === 'en');
  updComment();
}

function openEdit(id) {
  var p = posts.find(function(x) { return x.id === id; });
  if (!p) return;
  $$('mtitle').textContent = 'Edit Post';
  $$('eid').value = id;

  var lang = p.language || 'en';
  if (lang === 'pl') {
    $$('tpl').value = p.text || '';
    $$('ten').value = p.text_alt || '';
  } else {
    $$('ten').value = p.text || '';
    $$('tpl').value = p.text_alt || '';
  }
  $$('ccpl').textContent = $$('tpl').value.length;
  $$('ccen').textContent = $$('ten').value.length;

  if (p.publish_at) $$('edate').value = toLocal(new Date(p.publish_at));
  // Iter2: auto-comment override
  var ac = $$('auto-comment'); if (ac) {
    ac.value = p.auto_comment_override || '';
    $$('acom-cc').textContent = ac.value.length;
    $$('acom-source').textContent = p.auto_comment_source === 'custom'
      ? '✏️ custom (zostanie wysłany Twój tekst)'
      : '🤖 auto (z domyślnego mapowania)';
    $$('acom-source').style.color = p.auto_comment_source === 'custom' ? 'var(--yel)' : 'var(--dim)';
  }
  // Iter2: media preview
  renderMediaPreview(p);
  setLang(lang);
  $$('ov').classList.add('open');
}

function renderMediaPreview(p) {
  var box = document.getElementById('media-preview');
  if (!box) return;
  if (p.media_preview_path) {
    var src = '/post-media/' + p.id + '/' + p.media_preview_path.split('/').pop();
    var isVideo = p.media_kind === 'video' || /\.(mp4|webm|mov)$/i.test(p.media_preview_path);
    if (isVideo) {
      box.innerHTML = '<video src="' + src + '" controls style="max-width:280px;max-height:160px;border-radius:6px;border:1px solid var(--brd)"></video>'
        + '<span style="font-size:11px;color:var(--dim)">🎬 ' + (p.media_kind || 'video') + '</span>';
    } else {
      box.innerHTML = '<img src="' + src + '" alt="preview" style="max-width:280px;max-height:160px;border-radius:6px;border:1px solid var(--brd)">'
        + '<span style="font-size:11px;color:var(--dim)">🖼️ ' + (p.media_kind || 'image') + '</span>';
    }
  } else if (p.image_file) {
    box.innerHTML = '<img src="/img/' + p.image_file + '" alt="legacy" style="max-width:280px;max-height:160px;border-radius:6px;border:1px solid var(--brd);opacity:.7">'
      + '<span style="font-size:11px;color:var(--dim)">📁 legacy (hardcoded mapping)</span>';
  } else {
    box.innerHTML = '<span style="font-size:12px;color:var(--dim);font-style:italic">Brak media. Wybierz plik lub wygeneruj banner.</span>';
  }
}

function openCreate() {
  $$('mtitle').textContent = 'New Post';
  $$('eid').value = '';
  $$('tpl').value = '';
  $$('ten').value = '';
  $$('ccpl').textContent = '0';
  $$('ccen').textContent = '0';
  var d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 30, 0, 0);
  $$('edate').value = toLocal(d);
  // Iter2 reset
  var ac = $$('auto-comment'); if (ac) {
    ac.value = '';
    $$('acom-cc').textContent = '0';
    $$('acom-source').textContent = '';
  }
  renderMediaPreview({});
  setLang('en');
  $$('ov').classList.add('open');
}

function closeModal() { $$('ov').classList.remove('open'); }

function savePost() {
  var id = $$('eid').value;
  var tpl = $$('tpl').value.trim();
  var ten = $$('ten').value.trim();
  var dt = $$('edate').value;
  var main = plang === 'pl' ? tpl : ten;
  var alt = plang === 'pl' ? ten : tpl;

  if (!main) { toast(plang.toUpperCase() + ' text is required', false); return; }
  if (!dt) { toast('Publish time is required', false); return; }

  // Iter2: auto_comment_override (puste = null = auto z mapowania)
  var acomEl = $$('auto-comment');
  var acom = acomEl ? acomEl.value.trim() : '';
  var body = JSON.stringify({
    text: main,
    text_alt: alt || null,
    language: plang,
    publish_at: new Date(dt).toISOString(),
    auto_comment_override: acom || null,
  });

  if (id) {
    api('/api/posts/' + id, { method: 'PUT', body: body }).then(function() {
      toast('Post updated', true); closeModal(); loadPosts();
    });
  } else {
    api('/api/posts', { method: 'POST', body: body }).then(function() {
      toast('Post created', true); closeModal(); loadPosts();
    });
  }
}

// Iter2: media handlers (upload/banner/remove)
function getCurrentEditPostId() {
  var idEl = document.getElementById('eid');
  return idEl ? idEl.value : '';
}

function refreshMediaPreviewById(id) {
  // Re-fetch post from /api/posts ad hoc — proste: pobierz wszystkie i znajdź
  fetch('/api/posts').then(function(r){return r.json();}).then(function(data){
    var arr = Array.isArray(data) ? data : (data.rows || []);
    var p = arr.find(function(x){ return x.id === id; });
    if (p) {
      // synchronize in-memory posts cache too
      var idx = posts.findIndex(function(x){ return x.id === id; });
      if (idx >= 0) posts[idx] = p;
      renderMediaPreview(p);
    }
  });
}

function uploadMediaFile(id, file) {
  var fd = new FormData();
  fd.append('file', file);
  fetch('/api/posts/' + id + '/media', { method: 'POST', body: fd })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { toast('Błąd: ' + d.error, false); return; }
      toast('Media załączone (' + d.kind + ')', true);
      refreshMediaPreviewById(id);
      loadPosts();
    })
    .catch(function(e){ toast('Błąd uploadu: ' + e.message, false); });
}

function generatePostBanner(id, preset) {
  if (!preset) { toast('Wybierz preset banera', false); return; }
  toast('Generuję banner (' + preset + ')... ~30-60s', true);
  fetch('/api/posts/' + id + '/banner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: preset })
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) {
        // Iter6: pełny error do console, pierwsza linia do toast
        console.error('[banner] error:', d.error);
        var first = (d.error || '').split('\\n')[0].slice(0, 120);
        toast('Błąd banera: ' + first + ' (pełen log w konsoli)', false);
        return;
      }
      toast('Banner gotowy ✓', true);
      refreshMediaPreviewById(id);
      loadPosts();
    })
    .catch(function(e){
      console.error('[banner] fetch error:', e);
      toast('Błąd sieci: ' + e.message, false);
    });
}

// Iter8: AI image generation (Google Imagen 4)
function generatePostAiImage(id) {
  var btn = document.getElementById('media-ai-image-btn');
  var origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generuję AI (~15-30s)...'; }
  toast('Generuję AI image przez Imagen 4 (~15-30s)...', true);
  fetch('/api/posts/' + id + '/ai-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      if (d.error) {
        console.error('[ai-image] error:', d.error);
        var first = (d.error || '').split('\\n')[0].slice(0, 150);
        toast('Błąd AI image: ' + first, false);
        return;
      }
      toast('AI image gotowe ✓', true);
      refreshMediaPreviewById(id);
      loadPosts();
    })
    .catch(function(e){
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      console.error('[ai-image] fetch error:', e);
      toast('Błąd sieci AI image: ' + e.message, false);
    });
}

function removePostMedia(id) {
  if (!confirm('Usunąć media z tego posta?')) return;
  fetch('/api/posts/' + id + '/media', { method: 'DELETE' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.error) { toast('Błąd: ' + d.error, false); return; }
      toast('Media usunięte', true);
      refreshMediaPreviewById(id);
      loadPosts();
    })
    .catch(function(e){ toast('Błąd: ' + e.message, false); });
}

// Init modal media + auto-comment handlers (after DOM ready since elements are static HTML)
(function initIter2ModalHandlers() {
  var fileInput = document.getElementById('media-file');
  var uploadBtn = document.getElementById('media-upload-btn');
  var bannerBtn = document.getElementById('media-banner-btn');
  var removeBtn = document.getElementById('media-remove-btn');
  var presetSel = document.getElementById('banner-preset');
  var acom = document.getElementById('auto-comment');
  var acomReset = document.getElementById('acom-reset');
  if (uploadBtn) uploadBtn.addEventListener('click', function() { if (fileInput) fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function(e) {
    var id = getCurrentEditPostId();
    if (!id) { toast('Najpierw zapisz post żeby załączyć media', false); fileInput.value=''; return; }
    var file = e.target.files[0];
    if (file) uploadMediaFile(id, file);
    fileInput.value = '';
  });
  if (bannerBtn) bannerBtn.addEventListener('click', function() {
    var id = getCurrentEditPostId();
    if (!id) { toast('Najpierw zapisz post żeby wygenerować banner', false); return; }
    generatePostBanner(id, presetSel ? presetSel.value : '');
  });
  // Iter8: AI Image (Imagen 4)
  var aiImageBtn = document.getElementById('media-ai-image-btn');
  if (aiImageBtn) aiImageBtn.addEventListener('click', function() {
    var id = getCurrentEditPostId();
    if (!id) { toast('Najpierw zapisz post żeby wygenerować AI image', false); return; }
    generatePostAiImage(id);
  });
  if (removeBtn) removeBtn.addEventListener('click', function() {
    var id = getCurrentEditPostId();
    if (!id) return;
    removePostMedia(id);
  });
  if (acom) acom.addEventListener('input', function() {
    document.getElementById('acom-cc').textContent = acom.value.length;
    document.getElementById('acom-source').textContent = acom.value.trim()
      ? '✏️ custom (zostanie wysłany Twój tekst)'
      : '🤖 auto (z domyślnego mapowania)';
    document.getElementById('acom-source').style.color = acom.value.trim() ? 'var(--yel)' : 'var(--dim)';
  });
  if (acomReset) acomReset.addEventListener('click', function() {
    acom.value = '';
    acom.dispatchEvent(new Event('input'));
  });
})();

function publishNow(id) {
  if (!confirm('Publish this post to LinkedIn now?')) return;
  api('/api/posts/' + id + '/publish', { method: 'POST' }).then(function(r) {
    if (r.error) { toast(r.error, false); return; }
    toast('Published! ' + (r.post_urn || ''), true);
    loadPosts(); loadStatus();
  });
}

function cancelPost(id) {
  if (!confirm('Cancel this scheduled post?')) return;
  api('/api/posts/' + id, { method: 'DELETE' }).then(function() {
    toast('Post cancelled', true); loadPosts(); loadStatus();
  });
}

// ── TABS ──────────────────────────────────────────────────────────────────────

var activeTab = localStorage.getItem('li_tab') || 'posty';

function switchTab(id) {
  activeTab = id;
  localStorage.setItem('li_tab', id);
  document.querySelectorAll('.tnb').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === id); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.toggle('active', p.id === 'tab-' + id); });
  // Update header label — include group label so user knows where they are
  var lbl = document.getElementById('current-tab');
  var btn = document.querySelector('.tnb[data-tab="' + id + '"]');
  if (lbl && btn) {
    var group = btn.closest('.nav-group');
    var groupName = group ? (group.querySelector('summary') || {}).textContent || '' : '';
    lbl.textContent = (groupName ? groupName.trim() + ' · ' : '') + btn.textContent.trim();
  }
  // Auto-expand the group that contains the active tab; collapse others
  document.querySelectorAll('.nav-group').forEach(function(g) {
    var hasActive = g.querySelector('.tnb[data-tab="' + id + '"]');
    g.open = !!hasActive;
  });
  if (btn) {
    var grp = btn.closest('.nav-group');
    if (grp) localStorage.setItem('li_group', grp.dataset.group || '');
  }
  // Close hamburger menu
  closeNav();
}

function openNav() {
  document.getElementById('tabnav').classList.add('open');
  document.getElementById('nav-overlay').classList.add('open');
  document.getElementById('hburger').classList.add('open');
}
function closeNav() {
  document.getElementById('tabnav').classList.remove('open');
  document.getElementById('nav-overlay').classList.remove('open');
  document.getElementById('hburger').classList.remove('open');
}
function toggleNav() {
  if (document.getElementById('tabnav').classList.contains('open')) closeNav(); else openNav();
}

document.getElementById('hburger').addEventListener('click', toggleNav);
document.getElementById('nav-overlay').addEventListener('click', closeNav);
// ESC zamyka menu
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeNav();
});

document.querySelectorAll('.tnb').forEach(function(b) {
  b.addEventListener('click', function() {
    switchTab(b.dataset.tab);
    if (b.dataset.tab === 'prospekci') loadProspekci();
    if (b.dataset.tab === 'analytics') renderAnalytics();
    if (b.dataset.tab === 'siec') renderSiec();
    if (b.dataset.tab === 'leady') renderLeady();
    if (b.dataset.tab === 'kontenty') renderKontenty();
    if (b.dataset.tab === 'mediaplan') renderMediaPlan();
    if (b.dataset.tab === 'artykuly') renderArtykuly();
    if (b.dataset.tab === 'propozycje') loadProposals();
    if (b.dataset.tab === 'watki') loadWatki();
    if (b.dataset.tab === 'ustawienia') { loadGuidelines(); loadScraperConfig(); }
  });
});

// ── WYTYCZNE AI (humanizer + fact-checker) ─────────────────────────────────
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function loadGuidelines() {
  var root = document.getElementById('ust-blocks');
  if (!root) return;
  var defs = [
    { name: 'humanizer', title: '🗣️ Humanizer — ton Bartosza', subtitle: 'Wytyczne tonu, zakazane otwieracze, persona czytelnika MŚP. Stosowane przy KAŻDYM wywołaniu Claude do generowania tekstów.' },
    { name: 'fact-checker', title: '🔍 Fact-checker — anti-halucynacja', subtitle: 'Reguły co wymaga weryfikacji, polskie tiki content marketingowe, zasada „niepewny → pomiń, nie wymyślaj".' }
  ];
  root.innerHTML = defs.map(function(d) {
    return '<div class="ust-block" data-name="' + d.name + '" style="margin-bottom:24px;background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:16px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
        '<h3 style="margin:0;font-size:14px">' + d.title + '</h3>' +
        '<span class="ust-meta" style="font-size:11px;color:var(--dim)" id="ust-meta-' + d.name + '">(ładowanie...)</span>' +
        '<button class="btn sm" style="margin-left:auto" data-action="ust-reload" data-name="' + d.name + '">↺ Odśwież z dysku</button>' +
        '<button class="btn primary sm" data-action="ust-save" data-name="' + d.name + '">💾 Zapisz</button>' +
      '</div>' +
      '<p style="font-size:11px;color:var(--dim);margin:0 0 10px">' + escAttr(d.subtitle) + '</p>' +
      '<textarea id="ust-ta-' + d.name + '" style="width:100%;min-height:320px;background:#0d1117;border:1px solid var(--brd);color:var(--txt);font-family:var(--mono);font-size:12px;padding:10px;border-radius:6px;line-height:1.5;resize:vertical" placeholder="(pusty — bootstrap przez scripts/init-guidelines.mjs)"></textarea>' +
      '<p style="font-size:10px;color:var(--dim);margin:6px 0 0">Plik: <code>~/.linkedin-mcp/guidelines/' + d.name + '.md</code> · zmiana = natychmiast w następnym wywołaniu</p>' +
    '</div>';
  }).join('');
  defs.forEach(function(d) {
    fetch('/api/guidelines/' + d.name)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var ta = document.getElementById('ust-ta-' + d.name);
        var meta = document.getElementById('ust-meta-' + d.name);
        if (ta) ta.value = data.content || '';
        if (meta) {
          meta.textContent = data.exists
            ? (data.size + ' znaków · zmieniono ' + (data.last_modified ? new Date(data.last_modified).toLocaleString('pl-PL') : 'nieznane'))
            : '(plik nie istnieje — odpal scripts/init-guidelines.mjs)';
        }
      })
      .catch(function(e) {
        var meta = document.getElementById('ust-meta-' + d.name);
        if (meta) meta.textContent = '⚠️ Błąd ładowania: ' + e.message;
      });
  });
}
// ── Panel: Scraper analityki — kiedy i skąd dane (tylko podgląd) ───────────
function loadScraperConfig() {
  var root = document.getElementById('scraper-panel');
  if (!root) return;
  fetch('/api/scraper-config').then(function(r){ return r.json(); }).then(function(d){
    var c = d.charts_365d || {}, a = d.auto_analytics || {};
    var steps = (c.refresh_steps||[]).map(function(s){ return '<li>'+escAttr(s)+'</li>'; }).join('');
    var targets = (a.targets||[]).map(function(s){ return '<li>'+escAttr(s)+'</li>'; }).join('');
    var sched = (a.hour!=null ? (String(a.hour).padStart(2,'0')+':'+String(a.minute||0).padStart(2,'0')) : '22:00');
    root.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
        '<h2 style="margin:0;font-size:16px">📊 Analityka — kiedy i skąd dane</h2>'+
        '<span style="font-size:11px;color:var(--dim)">Co i kiedy zasila Command Center. Podgląd (edycja: pliki konfiguracyjne).</span>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">'+
        '<div style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:16px">'+
          '<h3 style="margin:0 0 4px;font-size:14px">📈 '+escAttr(c.label||'Wykresy 365-dni')+'</h3>'+
          '<p style="font-size:11px;color:var(--dim);margin:0 0 10px">'+escAttr(c.source||'')+'</p>'+
          '<div style="font-size:12px;line-height:1.8">'+
            '<div>Ostatni import: <b>'+escAttr(c.last_import||'—')+'</b></div>'+
            '<div>Plik: <code style="font-size:10px">'+escAttr(c.last_import_file||'—')+'</code></div>'+
            '<div>Dane wykresu do: <b>'+escAttr(d.charts_last_date||'—')+'</b></div>'+
            '<div>Followers: <b>'+(c.followers_daily_auto?'codziennie auto':'tylko z eksportu')+'</b></div>'+
          '</div>'+
          '<div style="margin-top:10px;font-size:11px;color:var(--dim)">Odśwież (zalecane: '+escAttr(c.recommended_export_day||'co tydzień')+'):</div>'+
          '<ol style="margin:4px 0 0;padding-left:18px;font-size:11px;color:var(--dim);line-height:1.6">'+steps+'</ol>'+
        '</div>'+
        '<div style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:16px">'+
          '<h3 style="margin:0 0 4px;font-size:14px">⏱️ '+escAttr(a.label||'Metryki dzienne')+'</h3>'+
          '<p style="font-size:11px;color:var(--dim);margin:0 0 10px">Harmonogram: <b>codziennie '+sched+'</b> · restart-safe · prospecting: <b>'+escAttr(a.prospecting||'?')+'</b></p>'+
          '<div style="font-size:12px">Ostatni realny bieg: <b>'+escAttr(d.auto_analytics_last_run||'—')+'</b></div>'+
          '<div style="margin-top:8px;font-size:11px;color:var(--dim)">Zbiera:</div>'+
          '<ul style="margin:4px 0 0;padding-left:18px;font-size:11px;color:var(--dim);line-height:1.6">'+targets+'</ul>'+
        '</div>'+
      '</div>';
  }).catch(function(e){ root.innerHTML = '<div style="color:var(--dim);font-size:12px">⚠️ Nie udało się wczytać konfiguracji scrapera: '+e.message+'</div>'; });
}
document.addEventListener('click', function(e) {
  var btn = e.target.closest && e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.dataset.action;
  var name = btn.dataset.name;
  if (action === 'ust-reload') { loadGuidelines(); return; }
  if (action === 'ust-save') {
    var ta = document.getElementById('ust-ta-' + name);
    if (!ta) return;
    btn.disabled = true; btn.textContent = '⏳ Zapisuję...';
    fetch('/api/guidelines/' + name, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ta.value })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        toast('Zapisano (' + data.size + ' znaków)', true);
        var meta = document.getElementById('ust-meta-' + name);
        if (meta) meta.textContent = data.size + ' znaków · zmieniono ' + new Date(data.saved_at).toLocaleString('pl-PL');
      })
      .catch(function(err) { toast('Błąd: ' + err.message, false); })
      .finally(function() { btn.disabled = false; btn.textContent = '💾 Zapisz'; });
  }
});

// Init header label
(function initLabel() {
  var lbl = document.getElementById('current-tab');
  var active = document.querySelector('.tnb.active');
  if (lbl && active) lbl.textContent = active.textContent.trim();
})();

// ── MEDIA PLAN ───────────────────────────────────────────────────────────────

var mpItems = [];
var mpFilter = localStorage.getItem('li_mp_filter') || 'all';
var mpSort = localStorage.getItem('li_mp_sort') || 'date';

function filterAndSortMp(items) {
  var arr = mpFilter === 'all'
    ? items.slice()
    : items.filter(function(it) { return it.status === mpFilter; });
  if (mpSort === 'score') arr.sort(function(a,b){return (b.score_total||0) - (a.score_total||0);});
  else if (mpSort === 'status') arr.sort(function(a,b){return (a.status||'').localeCompare(b.status||'');});
  else arr.sort(function(a,b){return (a.publish_at||'').localeCompare(b.publish_at||'');});
  return arr;
}

function renderMediaPlan() {
  var root = $$('mp-root');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--dim)">Loading…</div>';
  fetch('/api/media-plan').then(function(r) { return r.json(); }).then(function(data) {
    mpItems = data.items || [];
    var counts = data.counts || {};
    var settings = data.settings || {};
    var top3 = mpItems.filter(function(i) { return i.score_total >= 4.9 && i.status !== 'cancelled'; }).sort(function(a,b){return b.score_total - a.score_total;});
    var html = [];
    html.push('<h2 class="pg-title">Media Plan Q2 2026 — 12 tematów</h2>');
    html.push('<div class="post-stats">');
    html.push('<div class="stat">📋 Plan <b>' + (counts.plan || 0) + '</b></div>');
    html.push('<div class="stat">✍️ Napisane <b>' + (counts.napisane || 0) + '</b></div>');
    html.push('<div class="stat">🚀 Opublikowane <b>' + (counts.opublikowane || 0) + '</b></div>');
    html.push('<div class="stat">🔍 GSC <b>' + (counts.gsc_verified || 0) + '</b></div>');
    html.push('<div class="stat">❌ Cancelled <b>' + (counts.cancelled || 0) + '</b></div>');
    html.push('<div class="stat" style="margin-left:auto"><label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--dim);cursor:pointer"><input type="checkbox" id="mp-gsc-toggle" ' + (settings.gsc_auto_submit === '1' ? 'checked' : '') + '> GSC auto-submit</label></div>');
    html.push('</div>');

    // Iter2: filter + sort toolbar
    html.push('<div class="mp-toolbar">');
    html.push('<label style="font-size:11px;color:var(--dim)">Status:</label>');
    html.push('<select id="mp-filter">');
    ['all|Wszystkie','plan|📋 Plan','napisane|✍️ Napisane','opublikowane|🚀 Opublikowane','gsc_verified|🔍 GSC OK','cancelled|❌ Cancelled'].forEach(function(o) {
      var p = o.split('|');
      html.push('<option value="' + p[0] + '"' + (mpFilter === p[0] ? ' selected' : '') + '>' + p[1] + '</option>');
    });
    html.push('</select>');
    html.push('<label style="font-size:11px;color:var(--dim)">Sortuj:</label>');
    html.push('<select id="mp-sort">');
    ['date|Data (rosnąco)','score|Score (malejąco)','status|Status'].forEach(function(o) {
      var p = o.split('|');
      html.push('<option value="' + p[0] + '"' + (mpSort === p[0] ? ' selected' : '') + '>' + p[1] + '</option>');
    });
    html.push('</select>');
    // Iter9: counter postów z pustym post_text + bulk regen button
    var emptyCount = mpItems.filter(function(i) {
      return i.status !== 'cancelled' && i.status !== 'archived' && (!i.post_text || i.post_text.length < 300) && (!i.publish_at || i.publish_at >= new Date().toISOString().slice(0,10));
    }).length;
    if (emptyCount > 0) {
      html.push('<button id="mp-bulk-regen" class="btn sm" style="background:rgba(63,185,80,.15);color:var(--grn);border-color:var(--grn);margin-left:auto;font-size:11px" title="Regeneruj wszystkie posty z pustym lub bardzo krótkim post_text. Sequential, ~3 min/post. Long-running.">🤖 Regeneruj wszystkie puste (' + emptyCount + ')</button>');
    }
    html.push('</div>');

    if (top3.length && mpFilter === 'all') {
      html.push('<div class="sec-h">⭐ TOP-3 do produkcji w pierwszej kolejności</div>');
      html.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:18px">');
      for (var i = 0; i < top3.length; i++) html.push(renderMpCard(top3[i], true));
      html.push('</div>');
    }

    var filtered = filterAndSortMp(mpItems);
    html.push('<div class="sec-h">' + (mpFilter === 'all' ? 'Wszystkie' : 'Filtr: ' + mpFilter) + ' (' + filtered.length + ')</div>');
    html.push('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:10px">');
    for (var j = 0; j < filtered.length; j++) html.push(renderMpCard(filtered[j], false));
    html.push('</div>');

    root.innerHTML = html.join('');

    // Iter2: filter/sort handlers
    var fSel = $$('mp-filter'); if (fSel) fSel.addEventListener('change', function() {
      mpFilter = fSel.value; localStorage.setItem('li_mp_filter', mpFilter); renderMediaPlan();
    });
    var sSel = $$('mp-sort'); if (sSel) sSel.addEventListener('change', function() {
      mpSort = sSel.value; localStorage.setItem('li_mp_sort', mpSort); renderMediaPlan();
    });

    // GSC auto-submit toggle handler
    var gscToggle = $$('mp-gsc-toggle');
    if (gscToggle) {
      gscToggle.addEventListener('change', function() {
        fetch('/api/media-plan/settings/gsc_auto_submit', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: gscToggle.checked ? '1' : '0' })
        });
      });
    }
  }).catch(function(e) {
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--red)">Error: ' + e.message + '</div>';
  });
}

function renderMpCard(it, isTop) {
  var statusBadge = {
    plan: '<span class="badge b-scheduled">📋 Plan</span>',
    napisane: '<span class="badge" style="background:rgba(210,153,34,.15);color:var(--yel)">✍️ Napisane</span>',
    opublikowane: '<span class="badge b-published">🚀 Opublikowane</span>',
    gsc_verified: '<span class="badge" style="background:rgba(63,185,80,.2);color:var(--grn)">🔍 GSC OK</span>',
    cancelled: '<span class="badge b-cancelled">❌</span>'
  }[it.status] || '<span class="badge">' + it.status + '</span>';

  // Iter2: konsolidacja cannibalization + GSC w jeden badge "SEO ready/pending/blocked"
  var cann = it.cannibalize_status || 'pending';
  var gscS = it.gsc_status || 'not_checked';
  var isSeoReady = (cann === 'clear') && (gscS === 'already_indexed' || gscS === 'submitted' || gscS === 'inspected');
  var isSeoBlocked = (cann === 'strong') || /blocked|error/.test(gscS);
  var seoBadge = isSeoReady
    ? '<span class="badge" style="background:rgba(63,185,80,.2);color:var(--grn)" title="cannib: ' + cann + ' · GSC: ' + gscS + '">🔍 SEO ready</span>'
    : isSeoBlocked
      ? '<span class="badge" style="background:rgba(218,54,51,.15);color:var(--red)" title="cannib: ' + cann + ' · GSC: ' + gscS + '">🚫 SEO blocked</span>'
      : '<span class="badge b-cancelled" title="cannib: ' + cann + ' · GSC: ' + gscS + '">⏳ SEO pending</span>';

  // Iter2: język jako mała litera w prawym górnym rogu (nie badge)
  var langTag = '<span style="font-size:10px;color:var(--dim);font-family:var(--mono);letter-spacing:.05em">' + (it.language === 'en' ? 'EN' : 'PL') + '</span>';

  var stars = it.score_total >= 4.9 ? '⭐⭐⭐' : it.score_total >= 4.0 ? '⭐⭐' : it.score_total >= 3.0 ? '⭐' : '';
  var scoreColor = it.score_total >= 4.9 ? 'var(--grn)' : it.score_total >= 4.0 ? 'var(--blu)' : it.score_total >= 3.0 ? 'var(--yel)' : 'var(--red)';

  var publishDate = (it.publish_at || '').replace(' ', ' · ').slice(0, 16);

  var hasContent = it.post_text && it.post_text.length >= 1300;
  var hasBanner = !!it.banner_path;
  var hasVisual = !!it.visual_asset_path;

  var artChecks = [
    hasContent ? '✅' : '☐',
    hasBanner ? '✅' : '☐',
    hasVisual ? '✅' : '☐'
  ];

  var hookText = (it.hook || '').replace(/</g, '&lt;');
  var liveSig = (it.live_signal || '').slice(0, 100).replace(/</g, '&lt;');
  var sourceProj = (it.source_project || '').split('/').pop();

  var hashtagsArr = [];
  try { hashtagsArr = JSON.parse(it.hashtags || '[]'); } catch {}
  var hashtagsHtml = hashtagsArr.map(function(h) { return '<span style="color:var(--blu);font-family:var(--mono);font-size:10px">' + h + '</span>'; }).join(' ');

  var titleText = (it.title || '').replace(/</g, '&lt;');

  // LinkedIn link (if published)
  var liLink = '';
  if (it.linkedin_post_urn) {
    liLink = '<a href="https://www.linkedin.com/feed/update/' + it.linkedin_post_urn + '" target="_blank" style="font-size:11px">🔗 LinkedIn</a>';
  } else if (it.scheduled_post_id) {
    liLink = '<span style="font-size:11px;color:var(--blu)">📅 zaplanowany</span>';
  }

  // Iter2: thumbnail banera (gdy banner_path istnieje w DB)
  // Iter6: cache-bust przez ?t=updated_at żeby po regeneracji obraz się odświeżył
  var bustToken = (it.updated_at || '').replace(/[^0-9]/g, '').slice(0, 14) || Date.now();
  var thumb = hasBanner
    ? '<img src="/mp-banner/' + encodeURIComponent(it.slug || it.id) + '?t=' + bustToken + '" class="mp-thumb" alt="banner" onerror="this.style.display=\\'none\\'">'
    : '<div class="mp-thumb mp-thumb-empty">no banner</div>';

  // Iter2: quick "Schedule" action gdy plan + treść gotowa
  var scheduleBtn = (it.status === 'plan' && hasContent)
    ? '<button class="btn sm primary" data-mp-schedule="' + esc(it.slug || it.id) + '">📅 Schedule</button>'
    : '';

  return [
    '<div class="card mp-card" style="border-left:3px solid ' + scoreColor + ';cursor:pointer" data-mp-open="' + it.id + '">',
    '<div class="card-top" style="display:flex;gap:10px;align-items:flex-start">',
    thumb,
    '<div style="flex:1;min-width:0">',
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">',
    '<b style="font-size:13px">#' + it.topic_number + '</b>',
    statusBadge, seoBadge,
    '<span style="margin-left:auto">' + langTag + '</span>',
    '</div>',
    '<div class="meta" style="margin-top:4px">' + publishDate + ' CET' + (liLink ? ' · ' + liLink : '') + '</div>',
    titleText ? '<div style="font-size:13px;font-weight:600;color:var(--txt);margin:6px 0 2px">' + titleText + '</div>' : '',
    '<div class="ptxt" style="max-height:none;font-size:12px;color:#c9d1d9;margin:4px 0">' + hookText + '</div>',
    '</div>',
    '</div>',
    '<div class="meta" style="margin:6px 0;display:flex;gap:10px;flex-wrap:wrap">',
    '<span style="color:' + scoreColor + ';font-family:var(--mono);font-weight:700">' + (it.score_total || 0).toFixed(1) + '/5.0 ' + stars + '</span>',
    '<span>📦 ' + sourceProj + '</span>',
    liveSig ? '<span>· ' + liveSig + '</span>' : '',
    '</div>',
    hashtagsHtml ? '<div style="margin:4px 0">' + hashtagsHtml + '</div>' : '',
    '<div class="meta" style="margin:8px 0;font-size:11px">',
    'Treść: ' + artChecks[0] + ' &nbsp; Banner: ' + artChecks[1] + ' &nbsp; Visual: ' + artChecks[2],
    '</div>',
    '<div class="actions" data-mp-noopen="1">',
    '<button class="btn sm" data-mp-recheck="' + it.id + '">🔍 Recheck</button>',
    scheduleBtn,
    '<button class="btn sm primary" data-mp-open="' + it.id + '">📝 Edytuj</button>',
    '</div>',
    '</div>'
  ].join('');
}

function mpRecheck(id) {
  fetch('/api/media-plan/' + id + '/check-cannibalize', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var msg = 'Cannibalize: ' + data.status + ' (max ' + (data.max_score || 0).toFixed(2) + ')';
      if (data.overlaps && data.overlaps.length) {
        msg += '\\nTop overlap: ' + data.overlaps[0].title.slice(0, 60);
      }
      toast(msg);
      renderMediaPlan();
    });
}

var mpEditing = null;

function mpOpenDetail(id) {
  var it = mpItems.find(function(x) { return x.id === id || x.slug === id; });
  if (!it) return;
  mpEditing = it;

  // Iter9: status badge w nagłówku — sygnalizuje user'owi że post z status='plan' nie ma treści
  var statusBadge = '';
  if (it.status === 'plan' && (!it.post_text || it.post_text.length < 100)) {
    statusBadge = ' <span style="background:rgba(56,139,253,.15);color:var(--blu);padding:3px 9px;border-radius:8px;font-size:11px;font-weight:400;margin-left:8px">📋 Plan (treść pusta — kliknij 🤖 Regeneruj)</span>';
  } else if (it.status === 'cancelled') {
    statusBadge = ' <span style="background:rgba(248,81,73,.15);color:var(--red);padding:3px 9px;border-radius:8px;font-size:11px;font-weight:400;margin-left:8px">❌ Cancelled</span>';
  }
  $$('mp-mtitle').innerHTML = '#' + it.topic_number + ' · ' + esc(it.slug || '') + statusBadge;
  var meta = '<b style="color:var(--txt)">Status: ' + it.status + '</b> · Score ' + (it.score_total||0).toFixed(1) + '/5.0 · ' + it.language.toUpperCase() + ' · Banner concept: ' + (it.banner_concept || '—') + ' · Lead trigger: ' + (it.lead_trigger || '—');
  if (it.hook) meta += '<br><br><b>Hook:</b> ' + it.hook.replace(/</g, '&lt;');
  if (it.live_signal) meta += '<br><b>Live signal:</b> ' + it.live_signal.replace(/</g, '&lt;');
  if (it.cannibalize_overlaps) {
    try {
      var ovs = JSON.parse(it.cannibalize_overlaps);
      if (ovs.length) {
        meta += '<br><b>Top cannibalize overlaps (' + (it.cannibalize_status || 'pending') + '):</b><br>';
        ovs.forEach(function(o) { meta += '· ' + o.score + ' — ' + o.title.slice(0, 80) + '<br>'; });
      }
    } catch {}
  }
  $$('mp-meta').innerHTML = meta;

  $$('mp-hook').value = it.hook || '';
  $$('mp-title').value = it.title || '';
  $$('mp-text').value = it.post_text || '';
  $$('mp-cc').textContent = (it.post_text || '').length;
  // Iter9: wizualne podpowiedzi gdy treść pusta
  var mpTa = $$('mp-text');
  if (!it.post_text || it.post_text.length < 100) {
    mpTa.placeholder = it.status === 'plan'
      ? '📋 Status: PLAN — treść jeszcze nie wygenerowana.\\n\\nKliknij "🤖 Regeneruj treść" w nagłówku, aby Claude Opus napisał post na podstawie git log + README projektu (~60s).'
      : '⚠️ Treść pusta lub bardzo krótka. Kliknij "🤖 Regeneruj treść" w nagłówku.';
    mpTa.style.borderColor = 'var(--yel)';
    mpTa.style.borderWidth = '2px';
  } else {
    mpTa.placeholder = 'Napisz treść 1300-1700 znaków...';
    mpTa.style.borderColor = '';
    mpTa.style.borderWidth = '';
  }
  mpUpdateCharWarn();

  $$('mp-banner').value = it.banner_path || '';
  // Iter6: preview banera w modalu (jeśli istnieje) z cache-bust
  var mpPrev = document.getElementById('mp-banner-preview');
  if (mpPrev) {
    if (it.banner_path) {
      var slugBust = (it.updated_at || '').replace(/[^0-9]/g, '').slice(0, 14) || Date.now();
      mpPrev.innerHTML = '<img src="/mp-banner/' + encodeURIComponent(it.slug || it.id) + '?t=' + slugBust + '" style="max-width:280px;max-height:160px;border-radius:6px;border:1px solid var(--brd)" alt="banner preview" onerror="this.parentElement.innerHTML=\\'<span style=\\\\"font-size:11px;color:var(--dim);font-style:italic\\\\">Plik nie istnieje na dysku</span>\\'">';
    } else {
      mpPrev.innerHTML = '<span style="font-size:11px;color:var(--dim);font-style:italic">Brak banera — kliknij Generate via MCP</span>';
    }
  }
  $$('mp-visual').value = it.visual_asset_path || '';
  var hashtagsArr = [];
  try { hashtagsArr = JSON.parse(it.hashtags || '[]'); } catch {}
  $$('mp-hashtags').value = hashtagsArr.join(' ');
  $$('mp-cta').value = it.cta || '';
  $$('mp-wiki-slug').value = it.wiki_slug || '';
  if (it.publish_at) $$('mp-publish-at').value = it.publish_at.replace(' ', 'T').slice(0, 16);

  $$('mp-visual-plan').textContent = it.visual_asset_plan || '(brak — dodaj instrukcję capture do MEDIA-PLAN-2026-Q2.md)';

  if (it.gsc_inspect_result) {
    $$('mp-gsc-box').style.display = '';
    try {
      $$('mp-gsc-result').textContent = JSON.stringify(JSON.parse(it.gsc_inspect_result), null, 2);
    } catch {
      $$('mp-gsc-result').textContent = it.gsc_inspect_result;
    }
  } else {
    $$('mp-gsc-box').style.display = 'none';
  }

  // Show/hide buttons by status
  $$('mp-mark-napisane').style.display = (it.status === 'plan') ? '' : 'none';
  $$('mp-schedule').style.display = (it.status === 'napisane' && !it.scheduled_post_id) ? '' : 'none';
  $$('mp-gsc-inspect').style.display = (it.status === 'opublikowane' || it.status === 'gsc_verified') ? '' : 'none';
  $$('mp-gsc-submit').style.display = (it.status === 'opublikowane') ? '' : 'none';

  $$('mp-ov').classList.add('open');
}

function mpCloseModal() { $$('mp-ov').classList.remove('open'); mpEditing = null; }

function mpUpdateCharWarn() {
  var n = parseInt($$('mp-cc').textContent, 10) || 0;
  var w = $$('mp-cc-warn');
  if (n < 1300) w.textContent = '⚠️ za krótko (' + (1300 - n) + ' do minimum)';
  else if (n > 1700) w.textContent = '⚠️ za długo (' + (n - 1700) + ' nadwyżki)';
  else w.textContent = '✅ OK';
}

function mpSave() {
  if (!mpEditing) return;
  var hashtagsRaw = $$('mp-hashtags').value.trim();
  var hashtagsArr = hashtagsRaw ? hashtagsRaw.split(/\s+/).filter(function(t) { return t.startsWith('#'); }) : [];
  var publishAtRaw = $$('mp-publish-at').value;
  var publishAt = publishAtRaw ? publishAtRaw.replace('T', ' ') + ':00' : mpEditing.publish_at;
  var body = {
    hook: $$('mp-hook').value || null,
    title: $$('mp-title').value || null,
    post_text: $$('mp-text').value,
    banner_path: $$('mp-banner').value || null,
    visual_asset_path: $$('mp-visual').value || null,
    hashtags: JSON.stringify(hashtagsArr),
    cta: $$('mp-cta').value || null,
    wiki_slug: $$('mp-wiki-slug').value || null,
    publish_at: publishAt
  };
  fetch('/api/media-plan/' + mpEditing.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) { toast('Save error: ' + data.error); return; }
    toast('Zapisano', true);
    mpEditing = data;
    renderMediaPlan();
  });
}

function mpTransition(to) {
  if (!mpEditing) return;
  fetch('/api/media-plan/' + mpEditing.id + '/transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to })
  }).then(function(r) { return r.json().then(function(d) { return { status: r.status, body: d }; }); }).then(function(rr) {
    if (rr.status >= 400) {
      var msg = (rr.body.error || 'error') + ': ' + (rr.body.errors || []).join(' / ');
      alert(msg);
      return;
    }
    toast('Status → ' + to, true);
    mpEditing = rr.body;
    renderMediaPlan();
    setTimeout(function() { mpOpenDetail(rr.body.id); }, 200);
  });
}

function mpSchedule() {
  if (!mpEditing) return;
  if (!confirm('Utworzyć scheduled_posts row dla ' + mpEditing.slug + '?\\n\\nPo zapisie wejdź w tab Posty żeby kliknąć Publish.')) return;
  fetch('/api/media-plan/' + mpEditing.id + '/schedule', { method: 'POST' })
    .then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { alert('Schedule error: ' + data.error); return; }
      toast('Zaplanowane jako scheduled_posts.id=' + data.scheduled_post.id, true);
      renderMediaPlan();
      setTimeout(function() { mpOpenDetail(mpEditing.id); }, 200);
    });
}

function mpGscInspect() {
  if (!mpEditing) return;
  $$('mp-gsc-result').textContent = 'Inspecting…';
  $$('mp-gsc-box').style.display = '';
  fetch('/api/media-plan/' + mpEditing.id + '/gsc-inspect', { method: 'POST' })
    .then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { $$('mp-gsc-result').textContent = 'Error: ' + data.error; return; }
      $$('mp-gsc-result').textContent = JSON.stringify(data.result, null, 2);
      toast('GSC inspect done', true);
      renderMediaPlan();
    });
}

function mpGscSubmit() {
  if (!mpEditing) return;
  if (!confirm('Wymusić GSC submit dla ' + mpEditing.slug + '?\\n\\nPre-flight: page+canonical → sitemap → index_inspect → submit_sitemap (jeśli nie indexed)')) return;
  fetch('/api/media-plan/' + mpEditing.id + '/gsc-submit', { method: 'POST' })
    .then(function(r) { return r.json().then(function(d) { return { status: r.status, body: d }; }); }).then(function(rr) {
      if (rr.status >= 400) {
        alert('GSC submit blocked: ' + rr.body.error + '\\n\\n' + (rr.body.detail || ''));
        return;
      }
      var msg = rr.body.skipped ? 'Skipped: ' + rr.body.reason : ('Action: ' + rr.body.action);
      toast(msg, true);
      renderMediaPlan();
      setTimeout(function() { mpOpenDetail(mpEditing.id); }, 200);
    });
}

function mpCancelItem() {
  if (!mpEditing) return;
  if (!confirm('Anulować ' + mpEditing.slug + '? (status → cancelled)')) return;
  mpTransition('cancelled');
}

function mpRecheckInModal() {
  if (!mpEditing) return;
  fetch('/api/media-plan/' + mpEditing.id + '/check-cannibalize', { method: 'POST' })
    .then(function(r) { return r.json(); }).then(function(data) {
      toast('Cannibalize: ' + data.status, true);
      renderMediaPlan();
      // refresh modal meta
      fetch('/api/media-plan/' + mpEditing.id).then(function(r){return r.json();}).then(function(it){ mpEditing = it; mpOpenDetail(it.id); });
    });
}

// Iter8: regeneracja treści posta przez Claude Opus + git log (anti-halucynacje)
function mpRegenerate() {
  if (!mpEditing) return;
  if (!confirm('Regenerować treść posta przez Claude Opus 4.6 (~30-60s)?\\nŻródło: git log + README + LINKEDIN-STRATEGY.md\\nOryginał backup do original_post_text.')) return;
  var btn = document.getElementById('mp-regenerate-btn');
  var origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Regeneruję...'; }
  toast('Regeneruję treść przez Claude Opus (~30-60s)...', true);
  fetch('/api/media-plan/' + mpEditing.id + '/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      // Iter9: ok:false = walidacja failed (Claude zwrócił słaby wynik, DB bez zmian)
      if (d.ok === false || d.error) {
        console.error('[mp-regenerate]', d);
        toast('Regen fail: ' + (d.error || 'unknown').slice(0, 150), false);
        return;
      }
      toast('Treść zregenerowana (' + d.chars + ' znaków) ✓', true);
      // Re-fetch + re-open
      fetch('/api/media-plan/' + mpEditing.id).then(function(r) { return r.json(); }).then(function(it) {
        mpEditing = it;
        mpOpenDetail(it.id);
      });
    })
    .catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      console.error('[mp-regenerate] fetch', e);
      toast('Błąd sieci: ' + e.message, false);
    });
}

// Iter9: bulk regen wszystkich pustych post_text
function mpBulkRegen() {
  var emptyItems = mpItems.filter(function(i) {
    return i.status !== 'cancelled' && i.status !== 'archived' && (!i.post_text || i.post_text.length < 300);
  });
  if (emptyItems.length === 0) { toast('Brak pustych postów do regen', false); return; }
  if (!confirm('Regenerować ' + emptyItems.length + ' postów sekwencyjnie?\\n\\n• ~3 min/post = ~' + Math.round(emptyItems.length * 3) + ' min całość\\n• Long-running fetch (no timeout w przeglądarce)\\n• Można zamknąć portal, regen leci w tle backendzie\\n• Wynik widoczny po zakończeniu w Media Plan')) return;
  var btn = document.getElementById('mp-bulk-regen');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Bulk regen (' + emptyItems.length + ' postów, ~' + Math.round(emptyItems.length * 3) + ' min)...'; }
  toast('Bulk regen uruchomiony (' + emptyItems.length + ' postów). Może potrwać ~' + Math.round(emptyItems.length * 3) + ' min...', true);
  fetch('/api/media-plan/bulk-regenerate-empty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (btn) { btn.disabled = false; }
      if (d.error) { toast('Błąd bulk: ' + d.error.slice(0, 150), false); return; }
      var okCount = (d.results || []).filter(function(r) { return r.status === 'ok'; }).length;
      var failCount = (d.results || []).filter(function(r) { return r.status !== 'ok'; }).length;
      toast('Bulk regen done: ' + okCount + '/' + d.total + ' ok' + (failCount > 0 ? ', ' + failCount + ' fail (sprawdź konsolę backend)' : ''), true);
      console.log('[bulk-regen] results:', d.results);
      renderMediaPlan();
    })
    .catch(function(e) {
      if (btn) { btn.disabled = false; }
      console.error('[bulk-regen] fetch error:', e);
      toast('Błąd sieci bulk: ' + e.message, false);
    });
}

function mpGenerateBanner() {
  if (!mpEditing) return;
  var btn = document.getElementById('mp-gen-banner');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generuję...'; }
  toast('Generuję banner przez linkedin_banner_generate (~5-15s)...', true);
  fetch('/api/media-plan/' + mpEditing.id + '/generate-banner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r) { return r.json(); }).then(function(data) {
      if (btn) { btn.disabled = false; btn.textContent = '🎨 Generate via MCP'; }
      if (data.error) {
        console.error('[mp-banner] error:', data.error);
        toast('Banner gen error: ' + String(data.error).split('\\n')[0].slice(0, 150), false);
        return;
      }
      // Iter6: pokaż ścieżkę + odśwież preview w modal + odśwież karty Media Plan
      var bIn = document.getElementById('mp-banner');
      if (bIn) bIn.value = data.banner_path;
      toast('Banner zapisany: ' + data.banner_path.split('/').pop() + ' ✓', true);
      // Cache-bust + inline preview w modalu
      var prev = document.getElementById('mp-banner-preview');
      if (prev && mpEditing) {
        var slug = encodeURIComponent(mpEditing.slug || mpEditing.id);
        prev.innerHTML = '<img src="/mp-banner/' + slug + '?t=' + Date.now() + '" style="max-width:280px;max-height:160px;border-radius:6px;border:1px solid var(--brd)" alt="banner preview">';
      }
      // Re-render kart żeby thumbnail pojawił się natychmiast na karcie (po zamknięciu modala)
      renderMediaPlan();
    })
    .catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = '🎨 Generate via MCP'; }
      console.error('[mp-banner] fetch error:', e);
      toast('Banner sieć: ' + e.message, false);
    });
}

function mpUpload(kind, file) {
  if (!mpEditing || !file) return;
  var url = '/api/media-plan/' + mpEditing.id + '/upload?kind=' + kind + '&filename=' + encodeURIComponent(file.name);
  toast('Upload ' + file.name + ' (' + Math.round(file.size/1024) + 'KB)...', true);
  fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
    .then(function(r) { return r.json(); }).then(function(data) {
      if (data.error) { toast('Upload error: ' + data.error); return; }
      if (kind === 'banner') $$('mp-banner').value = data.path;
      else $$('mp-visual').value = data.path;
      toast('Uploaded: ' + data.path.split('/').pop() + ' (' + Math.round(data.size/1024) + 'KB)', true);
    });
}

// Modal listeners (one-time setup, delegated)
document.addEventListener('click', function(e) {
  var t = e.target;
  if (t.id === 'mp-ov') mpCloseModal();
  if (t.id === 'mp-mcancel') mpCloseModal();
  if (t.id === 'mp-msave') mpSave();
  if (t.id === 'mp-recheck-can') mpRecheckInModal();
  if (t.id === 'mp-mark-napisane') mpTransition('napisane');
  if (t.id === 'mp-schedule') mpSchedule();
  if (t.id === 'mp-gsc-inspect') mpGscInspect();
  if (t.id === 'mp-gsc-submit') mpGscSubmit();
  if (t.id === 'mp-cancel-item') mpCancelItem();
  if (t.id === 'mp-gen-banner') mpGenerateBanner();
  if (t.id === 'mp-regenerate-btn') mpRegenerate();
  if (t.id === 'mp-bulk-regen') mpBulkRegen();

  // Card delegated handlers (replace inline onclick — escaped quotes break in template literal)
  var openTarget = t.closest && t.closest('[data-mp-open]');
  if (openTarget && !t.closest('[data-mp-noopen]')) {
    mpOpenDetail(openTarget.getAttribute('data-mp-open'));
    return;
  }
  // Recheck button (also matches data-mp-open via fallback in actions)
  if (t.dataset && t.dataset.mpRecheck) {
    e.stopPropagation();
    mpRecheck(t.dataset.mpRecheck);
    return;
  }
  // Iter2: Schedule quick-action — kalibruje POST /api/media-plan/:slug/schedule
  if (t.dataset && t.dataset.mpSchedule) {
    e.stopPropagation();
    var slug = t.dataset.mpSchedule;
    if (!confirm('Zaplanować ten media plan item jako post LinkedIn?')) return;
    fetch('/api/media-plan/' + encodeURIComponent(slug) + '/schedule', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) { toast('Błąd: ' + d.error, false); return; }
        toast('Zaplanowano (scheduled_post_id=' + (d.scheduled_post_id || '') + ')', true);
        renderMediaPlan(); loadPosts();
      })
      .catch(function(e){ toast('Błąd: ' + e.message, false); });
    return;
  }
  // Edytuj button inside actions
  if (t.dataset && t.dataset.mpOpen && t.closest('[data-mp-noopen]')) {
    e.stopPropagation();
    mpOpenDetail(t.dataset.mpOpen);
    return;
  }
});

document.addEventListener('input', function(e) {
  if (e.target.id === 'mp-text') {
    $$('mp-cc').textContent = e.target.value.length;
    mpUpdateCharWarn();
  }
});

document.addEventListener('change', function(e) {
  if (e.target.id === 'mp-upload-banner' && e.target.files && e.target.files[0]) {
    mpUpload('banner', e.target.files[0]);
    e.target.value = '';
  }
  if (e.target.id === 'mp-upload-visual' && e.target.files && e.target.files[0]) {
    mpUpload('visual', e.target.files[0]);
    e.target.value = '';
  }
});

// ── COPY UTILITY ──────────────────────────────────────────────────────────────

function copyText(txt, btn) {
  navigator.clipboard.writeText(txt).then(function() {
    var orig = btn.textContent;
    btn.textContent = 'Skopiowano!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

// ── STATIC DATA ───────────────────────────────────────────────────────────────

var DM_TEMPLATES = ${JSON.stringify(DM_TEMPLATES)};
var SEARCH_QUERIES = ${JSON.stringify(SEARCH_QUERIES)};
var PROPOSED_POSTS = ${JSON.stringify(PROPOSED_POSTS)};
var ROUTINE = ${JSON.stringify(ROUTINE)};

// ── RENDER: KALENDARZ (dynamic from /api/calendar) ───────────────────────────

// Iter2: renderuje widok tygodniowy do containera #posts-view-week wewnątrz tab-posty
function renderKalendarz() {
  var root = document.getElementById('posts-view-week');
  if (!root) return; // panel kalendarz usunięty
  root.innerHTML = '<div class="empty">Ladowanie...</div>';

  api('/api/calendar').then(function(data) {
    var h = '<table class="cal-tbl"><thead><tr><th>#</th><th>Data</th><th>Godz.</th><th>Temat</th><th>Status</th><th>Akcje</th></tr></thead><tbody>';
    var n = 1;
    var thisYear = new Date().getFullYear();
    // Iter6: filtr okresu — najpierw filtruj posty w każdym tygodniu, pomiń puste tygodnie
    var period = getPostsPeriod();
    var weeksFiltered = (data.weeks || []).map(function(w) {
      return { weekStart: w.weekStart, posts: filterByPeriod(w.posts || [], period, 'date') };
    }).filter(function(w) { return w.posts.length > 0; });
    weeksFiltered.forEach(function(w) {
      var ws = new Date(w.weekStart);
      var wsEnd = new Date(ws); wsEnd.setDate(ws.getDate() + 6);
      // Iter6: pokaż rok gdy tydzień ≠ bieżący rok ("Tydzień 3 maj - 9 maj · 2020")
      var showYear = ws.getFullYear() !== thisYear;
      var label = 'Tydzień ' + ws.toLocaleDateString('pl-PL', {day:'numeric',month:'short'}) + ' - ' + wsEnd.toLocaleDateString('pl-PL', {day:'numeric',month:'short'}) + (showYear ? ' · ' + ws.getFullYear() : '');
      // Iter7: header tygodnia jako drop target (drop = pierwszy dzień tygodnia)
      h += '<tr class="cal-week" data-drop-week="' + esc(w.weekStart) + '"><td colspan="6">' + esc(label) + ' <span style="float:right;font-weight:400;color:var(--dim);font-size:9px">↓ upuść tutaj</span></td></tr>';
      (w.posts || []).forEach(function(p) {
        var dt = new Date(p.date || p.publish_at);
        var dateStr = dt.toLocaleDateString('pl-PL', {day:'numeric', month:'short', weekday:'short'});
        var timeStr = pad(dt.getHours()) + ':' + pad(dt.getMinutes());
        var isProposed = p.source === 'proposed';
        var status = p.status || (isProposed ? 'proposed' : 'scheduled');
        var statusBadge = isProposed
          ? '<span class="badge b-cancelled">proponowany</span>'
          : '<span class="badge b-' + status + '">' + status + '</span>';
        var actions = '';
        if (isProposed) {
          actions = '<button class="btn sm primary" data-act="schedule-proposed" data-idx="' + (typeof p.idx === 'number' ? p.idx : '') + '">+ Zaplanuj</button>';
        } else if (status === 'scheduled') {
          actions = '<button class="btn sm" data-act="edit" data-id="' + esc(p.id) + '">Edit</button> '
            + '<button class="btn sm primary" data-act="publish" data-id="' + esc(p.id) + '">Publish</button> '
            + '<button class="btn sm danger" data-act="cancel" data-id="' + esc(p.id) + '">Cancel</button>';
        } else if (status === 'published' && p.post_urn) {
          actions = '<a href="' + esc(urnToUrl(p.post_urn)) + '" target="_blank" style="font-size:11px;color:var(--blu)">Otwórz →</a>';
        } else if (status === 'failed') {
          actions = '<button class="btn sm" data-act="edit" data-id="' + esc(p.id) + '">Edit</button>';
        }
        var title = p.title || (p.text||'').substring(0, 60) + (p.text && p.text.length > 60 ? '...' : '');

        // Iter6+7: drill-down (klik) + drag-and-drop (przeciąganie scheduled/failed/proposed na inny tydzień)
        var rowAttrs;
        var publishAtAttr = (p.publish_at || p.date) ? ' data-publish-at="' + esc(p.publish_at || p.date) + '"' : '';
        if (isProposed) {
          rowAttrs = 'data-act="show-proposed" data-idx="' + (typeof p.idx === 'number' ? p.idx : '') + '" draggable="true"' + publishAtAttr + ' style="cursor:move;opacity:.7"';
        } else if (p.id && (status === 'scheduled' || status === 'failed')) {
          rowAttrs = 'data-act="edit" data-id="' + esc(p.id) + '" draggable="true"' + publishAtAttr + ' style="cursor:move"';
        } else if (p.id && status === 'published') {
          rowAttrs = 'data-act="edit" data-id="' + esc(p.id) + '"' + publishAtAttr + ' style="cursor:pointer"';
        } else {
          rowAttrs = publishAtAttr + ' style="opacity:.7"';
        }
        h += '<tr ' + rowAttrs + '>';
        h += '<td style="font-family:var(--mono);font-size:11px">' + n++ + '</td>';
        h += '<td>' + esc(dateStr) + '</td>';
        h += '<td style="font-family:var(--mono);color:var(--grn)">' + esc(timeStr) + '</td>';
        h += '<td>' + esc(title) + '</td>';
        h += '<td>' + statusBadge + '</td>';
        h += '<td>' + actions + '</td></tr>';
      });
    });
    h += '</tbody></table>';
    root.innerHTML = h;
  }).catch(function() {
    root.innerHTML = '<div class="empty">Blad ladowania widoku tygodniowego</div>';
  });
}

// Iter2: toggle Lista/Tydzień w Kolejce
function setPostsView(view) {
  var listEl = document.getElementById('posts-view-list');
  var weekEl = document.getElementById('posts-view-week');
  if (!listEl || !weekEl) return;
  var isWeek = view === 'week';
  listEl.style.display = isWeek ? 'none' : '';
  weekEl.style.display = isWeek ? '' : 'none';
  document.querySelectorAll('#posts-view-toggle button[data-view]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.view === view);
  });
  localStorage.setItem('li_posts_view', view);
  if (isWeek) renderKalendarz();
}

document.addEventListener('click', function(e) {
  var t = e.target;
  if (t && t.dataset && t.dataset.view && t.closest && t.closest('#posts-view-toggle')) {
    setPostsView(t.dataset.view);
  }
});

// Iter7: drag-and-drop w widoku Tydzień — przeciąganie postów na inny tydzień/dzień
var calDragging = null;

document.addEventListener('dragstart', function(e) {
  var tr = e.target && e.target.closest && e.target.closest('tr[draggable="true"]');
  if (!tr) return;
  var weekView = document.getElementById('posts-view-week');
  if (!weekView || !weekView.contains(tr)) return;
  calDragging = {
    id: tr.dataset.id || null,
    idx: tr.dataset.idx || null,
    publishAt: tr.dataset.publishAt || '',
    isProposed: tr.dataset.act === 'show-proposed',
    sourceRow: tr,
  };
  tr.classList.add('dragging-source');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', calDragging.id || calDragging.idx || ''); } catch (err) {}
  }
});

document.addEventListener('dragend', function(e) {
  if (calDragging && calDragging.sourceRow) calDragging.sourceRow.classList.remove('dragging-source');
  document.querySelectorAll('.drop-hover').forEach(function(el) { el.classList.remove('drop-hover'); });
  calDragging = null;
});

document.addEventListener('dragover', function(e) {
  if (!calDragging) return;
  var target = e.target && e.target.closest && e.target.closest('[data-drop-week], tr[data-publish-at]');
  if (!target) return;
  if (target === calDragging.sourceRow) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop-hover').forEach(function(el) { el.classList.remove('drop-hover'); });
  target.classList.add('drop-hover');
});

document.addEventListener('drop', function(e) {
  if (!calDragging) return;
  var weekHeader = e.target && e.target.closest && e.target.closest('[data-drop-week]');
  var dayRow = e.target && e.target.closest && e.target.closest('tr[data-publish-at]');
  var targetDate;
  if (dayRow && dayRow !== calDragging.sourceRow && dayRow.dataset.publishAt) {
    targetDate = dayRow.dataset.publishAt.slice(0, 10);
  } else if (weekHeader && weekHeader.dataset.dropWeek) {
    targetDate = weekHeader.dataset.dropWeek;
  } else {
    return;
  }
  e.preventDefault();
  movePostToDate(calDragging, targetDate);
});

function movePostToDate(d, targetDateStr) {
  // Iter7: zachowaj godzinę z oryginału, podmień tylko date part
  var origDate = new Date(d.publishAt || '');
  var hh = '08';
  var mm = '00';
  var ss = '00';
  if (!isNaN(origDate.getTime())) {
    hh = String(origDate.getHours()).padStart(2, '0');
    mm = String(origDate.getMinutes()).padStart(2, '0');
    ss = String(origDate.getSeconds()).padStart(2, '0');
  }
  // Konstruuj nową datę w lokalnym czasie żeby zachować dokładnie tę samą godzinę co user widzi
  var newLocalDate = new Date(targetDateStr + 'T' + hh + ':' + mm + ':' + ss);
  var newIso = newLocalDate.toISOString();
  var timeLabel = hh + ':' + mm;

  if (d.isProposed) {
    var pp = PROPOSED_POSTS[parseInt(d.idx)];
    if (!pp) return;
    api('/api/posts', { method: 'POST', body: JSON.stringify({
      text: pp.text || '', text_alt: null, language: 'pl', publish_at: newIso,
    }) }).then(function() {
      toast('Zaplanowano na ' + targetDateStr + ' ' + timeLabel, true);
      loadPosts();
      renderKalendarz();
    }).catch(function(e) { toast('Błąd: ' + e.message, false); });
    return;
  }
  if (!d.id) return;
  api('/api/posts/' + d.id, { method: 'PUT', body: JSON.stringify({ publish_at: newIso }) })
    .then(function() {
      toast('Przeniesiono na ' + targetDateStr + ' (godz ' + timeLabel + ' zachowana)', true);
      loadPosts();
      renderKalendarz();
    })
    .catch(function(e) { toast('Błąd przenoszenia: ' + e.message, false); });
}

// Iter7: lazy-load drzewka komentarzy gdy user otwiera <details> w karcie published
document.addEventListener('toggle', function(e) {
  var det = e.target;
  if (!det || !det.matches || !det.matches('details[data-load-comments]')) return;
  if (!det.open) return;
  if (det.dataset.loaded === '1') return;
  var urn = det.dataset.loadComments;
  var postId = det.dataset.postId;
  var box = det.querySelector('.comments-tree');
  var summary = det.querySelector('summary');
  if (!box) return;
  box.innerHTML = '<span style="color:var(--dim);font-size:11px">Ładowanie…</span>';
  fetch('/api/posts/' + encodeURIComponent(urn) + '/comments-tree')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      det.dataset.loaded = '1';
      if (summary) summary.innerHTML = '💬 Komentarze (' + d.count + ')';
      if (!d.tree || d.tree.length === 0) {
        box.innerHTML = '<div style="font-size:11px;color:var(--dim);font-style:italic;padding:8px 0">'
          + 'Brak komentarzy w bazie. <button class="btn sm" data-act="backfill-comments" data-id="' + esc(postId) + '" data-urn="' + esc(urn) + '" style="font-size:11px;margin-left:8px">↺ Pobierz z LinkedIn</button>'
          + '</div>';
        return;
      }
      box.innerHTML = d.tree.map(function(c) {
        var ml = (c.depth || 0) * 20;
        var icon = c.is_our_comment ? '👤' : '💬';
        var bg = c.is_our_comment ? 'rgba(63,185,80,.08)' : 'rgba(255,255,255,.02)';
        var bd = c.is_our_comment ? 'var(--grn)' : 'var(--brd)';
        var when = c.comment_created_at ? new Date(c.comment_created_at).toLocaleString('pl-PL', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}) : '';
        return '<div style="margin-left:' + ml + 'px;padding:6px 9px;background:' + bg + ';border-radius:4px;margin-bottom:4px;border-left:2px solid ' + bd + '">'
          + '<div style="display:flex;gap:6px;font-size:10px;color:var(--dim);margin-bottom:3px;align-items:baseline">'
          + '<b style="color:var(--txt);font-size:11px">' + icon + ' ' + esc(c.author_name || '?') + '</b>'
          + (when ? '<span>· ' + esc(when) + '</span>' : '')
          + (c.is_our_comment ? '<span style="color:var(--grn);font-weight:600">[Ty]</span>' : '')
          + '</div>'
          + '<div style="color:var(--txt);font-size:12px;line-height:1.4;white-space:pre-wrap">' + esc(c.comment_text || '') + '</div>'
          + '</div>';
      }).join('');
    })
    .catch(function(err) {
      box.innerHTML = '<span style="color:var(--red);font-size:11px">Błąd ładowania: ' + esc(err.message) + '</span>';
    });
}, true);

// Iter7: handler backfill komentarzy per post
document.addEventListener('click', function(e) {
  var t = e.target;
  if (!t || !t.dataset || t.dataset.act !== 'backfill-comments') return;
  var id = t.dataset.id;
  var urn = t.dataset.urn;
  if (!id || !urn) return;
  e.preventDefault();
  e.stopPropagation();
  var origText = t.textContent;
  t.disabled = true;
  t.textContent = '⏳ Pobieram…';
  fetch('/api/posts/' + encodeURIComponent(id) + '/backfill-comments', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      t.disabled = false;
      t.textContent = origText;
      if (d.error) { toast('Backfill: ' + d.error, false); return; }
      toast('Pobrano ' + (d.inserted || 0) + ' nowych komentarzy (' + (d.total || 0) + ' total)', true);
      // Re-trigger toggle handler żeby załadować od nowa drzewko
      var det = t.closest('details[data-load-comments]');
      if (det) {
        det.dataset.loaded = '0';
        det.open = false;
        setTimeout(function() { det.open = true; }, 100);
      }
    })
    .catch(function(err) {
      t.disabled = false;
      t.textContent = origText;
      toast('Błąd backfill: ' + err.message, false);
    });
});

// Iter6: handler filtra okresu — persist + re-render obu widoków
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'posts-period') {
    localStorage.setItem('li_posts_period', e.target.value);
    // Lista: render() używa getPostsPeriod()
    if (typeof posts !== 'undefined' && Array.isArray(posts)) render();
    // Tydzień: re-fetch + filter
    if (document.getElementById('posts-view-week') && document.getElementById('posts-view-week').style.display !== 'none') {
      renderKalendarz();
    }
  }
});

// Iter6: przywróć ostatnio wybrany filtr okresu przy starcie
(function restorePostsPeriod() {
  var saved = localStorage.getItem('li_posts_period');
  if (!saved) return;
  var sel = document.getElementById('posts-period');
  if (sel) sel.value = saved;
})();

function openCreateFromProposed(pp) {
  $$('eid').value = '';
  $$('mtitle').textContent = 'Zaplanuj post';
  $$('tpl').value = pp.text || '';
  $$('ten').value = '';
  $$('ccpl').textContent = (pp.text || '').length;
  $$('ccen').textContent = '0';
  var dt = new Date(pp.date);
  $$('edate').value = toLocal(dt);
  setLang('pl');
  // Iter6: cptext usunięte w Iter2 — preview auto-comment teraz w textarea #auto-comment
  var cpt = document.getElementById('cptext');
  if (cpt) cpt.textContent = gcom(pp.text || '');
  // Reset media + auto-comment fields dla świeżego proposed→scheduled
  var ac = document.getElementById('auto-comment'); if (ac) ac.value = '';
  renderMediaPreview({});
  $$('ov').classList.add('open');
}

// Iter6: modal drill-down dla proposed postów (readonly view + kopiowanie + schedule)
var currentProposedIdx = -1;
function openProposedDetail(pp, idx) {
  currentProposedIdx = idx;
  var ov = document.getElementById('pp-ov');
  if (!ov) return;
  document.getElementById('pp-mtitle').textContent = pp.title || 'Proponowany post';
  document.getElementById('pp-text').value = pp.text || '';
  // Meta: data, format, kategoria
  var dt = new Date(pp.date);
  var dateStr = isNaN(dt.getTime()) ? '' : dt.toLocaleString('pl-PL', {day:'numeric', month:'short', weekday:'short', hour:'2-digit', minute:'2-digit'});
  var pieces = [];
  if (dateStr) pieces.push('<span class="badge b-scheduled">📅 ' + esc(dateStr) + '</span>');
  if (pp.format) pieces.push('<span class="badge" style="background:rgba(56,139,253,.15);color:var(--blu)">' + esc(pp.format) + '</span>');
  if (pp.icp) pieces.push('<span class="badge" style="background:rgba(210,153,34,.15);color:var(--yel)">ICP: ' + esc(pp.icp) + '</span>');
  if (pp.lead_trigger) pieces.push('<span class="badge" style="background:rgba(63,185,80,.15);color:var(--grn)">🎯 ' + esc(pp.lead_trigger) + '</span>');
  document.getElementById('pp-meta').innerHTML = pieces.join(' ');
  // Screenshot hint
  var ss = document.getElementById('pp-screenshot');
  if (pp.screenshot) {
    ss.style.display = 'block';
    ss.innerHTML = '📸 ' + esc(pp.screenshot);
  } else { ss.style.display = 'none'; }
  // Hashtags
  var ht = document.getElementById('pp-hashtags');
  if (pp.hashtags && Array.isArray(pp.hashtags) && pp.hashtags.length) {
    ht.innerHTML = pp.hashtags.map(function(h) {
      return '<span style="color:var(--blu);font-family:var(--mono);font-size:11px">' + esc(h) + '</span>';
    }).join(' ');
  } else { ht.innerHTML = ''; }
  ov.classList.add('open');
}

function closeProposedDetail() {
  var ov = document.getElementById('pp-ov');
  if (ov) ov.classList.remove('open');
  currentProposedIdx = -1;
}

// Iter6: handlery przyciskow modala proposed-detail
document.addEventListener('click', function(e) {
  var t = e.target;
  if (!t) return;
  if (t.id === 'pp-close' || t.id === 'pp-ov') { closeProposedDetail(); return; }
  if (t.id === 'pp-copy') {
    var txt = document.getElementById('pp-text');
    if (txt) {
      navigator.clipboard.writeText(txt.value).then(function() {
        toast('Tekst skopiowany', true);
      }).catch(function() { toast('Błąd kopiowania', false); });
    }
    return;
  }
  if (t.id === 'pp-schedule') {
    var pp = PROPOSED_POSTS[currentProposedIdx];
    if (pp) {
      closeProposedDetail();
      openCreateFromProposed(pp);
    }
    return;
  }
});

// ── RENDER: RUTYNA ────────────────────────────────────────────────────────────

function renderRutyna() {
  var root = document.getElementById('rut-root');
  root.innerHTML = '<div class="pg-title">Codzienna rutyna LinkedIn</div><div style="color:var(--dim);font-size:13px;margin-bottom:16px">Ladowanie statusu automatyzacji...</div>';

  fetch('/api/automations').then(function(r){return r.json();}).then(function(data) {
    var autos = data.automations || [];
    var h = '<div class="pg-title">Codzienna rutyna LinkedIn</div>';

    // === AUTOMATYZACJE ===
    h += '<div class="sec-h" style="margin-bottom:8px">Automatyzacje — status</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;margin-bottom:24px">';
    autos.forEach(function(a) {
      var isCron = /Cron:/i.test(a.schedule || '');
      var statusColor = a.running ? 'var(--grn)' : (isCron ? 'var(--yel)' : 'var(--red)');
      var statusText = a.running
        ? ('AKTYWNY' + (a.pid ? ' (PID '+a.pid+')' : ''))
        : (isCron ? ('IDLE — następny ' + (a.nextRun || a.schedule || '?')) : 'ZATRZYMANY');
      var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusColor + ';margin-right:6px"></span>';
      h += '<div style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:12px">';
      h += '<div style="font-weight:600;font-size:13px;margin-bottom:4px">' + esc(a.label) + '</div>';
      h += '<div style="font-size:12px;color:var(--dim);margin-bottom:6px">' + esc(a.schedule) + '</div>';
      if (a.nextRun) h += '<div style="font-size:12px;color:var(--blu)">Nastepne: <b>' + esc(a.nextRun) + '</b></div>';
      h += '<div style="margin-top:6px;font-size:12px">' + dot + statusText + '</div>';
      if (a.lastLine) h += '<div style="margin-top:6px;font-size:10px;color:var(--dim);font-family:var(--mono);background:#0d1117;border-radius:4px;padding:4px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(a.lastLine) + '">' + esc(a.lastLine) + '</div>';
      h += '</div>';
    });
    h += '</div>';

    // === DATA HEALTH ===
    h += '<div class="sec-h" style="margin-bottom:8px">Data Health — stan danych</div>';
    h += '<div id="dataHealthRoot" style="margin-bottom:24px;color:var(--dim);font-size:12px">Ladowanie...</div>';

    // Load data health async
    fetch('/api/data-health').then(function(r){return r.json();}).then(function(dh) {
      var hh = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-bottom:12px">';
      // Auth status
      var authColor = dh.auth && dh.auth.official && dh.auth.official.startsWith('valid') ? 'var(--grn)' : 'var(--red)';
      var voyColor = dh.auth && dh.auth.voyager === 'has_cookie' ? 'var(--yel)' : 'var(--red)';
      var oauthUrl = dh.auth?.oauth_url || '';
      hh += '<div style="background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:8px">';
      hh += '<div style="font-size:11px;color:var(--dim)">Official API</div>';
      hh += '<div style="color:' + authColor + ';font-weight:600;font-size:12px">' + esc(dh.auth?.official || '?') + '</div>';
      if (dh.auth?.official === 'expired' || dh.auth?.official === 'no_file') {
        if (oauthUrl) {
          hh += '<a href="' + oauthUrl + '" style="font-size:10px;color:var(--blu);text-decoration:none;display:block;margin-top:4px">🔑 Odśwież token →</a>';
        } else {
          hh += '<div style="font-size:10px;color:var(--yel);margin-top:4px">Brak CLIENT_ID w env</div>';
        }
      }
      hh += '</div>';
      hh += '<div style="background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:8px">';
      hh += '<div style="font-size:11px;color:var(--dim)">Voyager (Scraper)</div>';
      hh += '<div style="color:' + voyColor + ';font-weight:600;font-size:12px">' + esc(dh.auth?.voyager || '?') + '</div></div>';
      hh += '<div style="background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:8px">';
      hh += '<div style="font-size:11px;color:var(--dim)">MCP Tools</div>';
      hh += '<div style="color:var(--grn);font-weight:600;font-size:12px">' + (dh.mcp_tools || 0) + ' tools</div></div>';
      hh += '<div style="background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:8px">';
      hh += '<div style="font-size:11px;color:var(--dim)">Snowball Queue</div>';
      var qp = (dh.queue_pending || []).map(function(q){return q.item_type + ':' + q.cnt;}).join(', ') || 'puste';
      hh += '<div style="color:var(--blu);font-weight:600;font-size:12px">' + esc(qp) + '</div></div>';
      hh += '</div>';
      // Table data
      var tables = ['daily_stats','social_metadata','follower_deltas','top_engagers','content_type_map','reaction_type_daily','post_metrics_history','hashtag_performance','network_demographics','weekly_report'];
      hh += '<table style="width:100%;font-size:11px;border-collapse:collapse">';
      hh += '<tr style="border-bottom:1px solid var(--brd)"><th style="text-align:left;padding:4px">Tabela</th><th>Rekordy</th><th>Najstarsze</th><th>Najnowsze</th><th>Status</th></tr>';
      tables.forEach(function(t) {
        var d = dh[t] || {};
        var cnt = d.cnt || 0;
        var color = cnt > 0 ? 'var(--grn)' : 'var(--red)';
        var icon = cnt > 0 ? '●' : '○';
        hh += '<tr style="border-bottom:1px solid var(--brd)">';
        hh += '<td style="padding:4px;font-family:var(--mono)">' + t + '</td>';
        hh += '<td style="text-align:center;padding:4px"><b>' + cnt + '</b></td>';
        hh += '<td style="text-align:center;padding:4px;color:var(--dim)">' + (d.oldest || '-') + '</td>';
        hh += '<td style="text-align:center;padding:4px;color:var(--dim)">' + (d.newest || '-') + '</td>';
        hh += '<td style="text-align:center;color:' + color + '">' + icon + '</td>';
        hh += '</tr>';
      });
      hh += '</table>';
      document.getElementById('dataHealthRoot').innerHTML = hh;
    }).catch(function(e) {
      document.getElementById('dataHealthRoot').textContent = 'Blad: ' + e.message;
    });

    // === RECZNA RUTYNA ===
    h += '<div class="sec-h" style="margin-bottom:8px">Reczna rutyna dzienna</div>';
    h += '<div class="tl">';
    ROUTINE.forEach(function(r) {
      h += '<div class="tl-item"><div class="tl-time">' + esc(r.time) + '</div>';
      h += '<div class="tl-desc">' + esc(r.desc) + '</div>';
      if (r.time === '17:00') {
        h += '<div style="margin-top:8px">';
        h += '<button class="btn sm primary" id="btnRutynaInvite">Wygeneruj liste do zaproszenia</button>';
        h += '<span id="rutynaCount" style="margin-left:12px;font-size:12px;color:var(--dim)"></span>';
        h += '</div>';
        h += '<div id="rutynaPrompt" style="display:none;margin-top:10px">';
        h += '<textarea readonly style="width:100%;height:150px;background:#0d1117;color:var(--txt);border:1px solid var(--brd);border-radius:6px;padding:8px;font-size:11px;font-family:var(--mono);resize:vertical" id="rutynaPromptText"></textarea>';
        h += '<button class="btn sm" style="margin-top:4px" data-copy="rutynaPromptText">Kopiuj</button>';
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</div>';

    root.innerHTML = h;

    var btnRI = document.getElementById('btnRutynaInvite');
    if (btnRI) {
      btnRI.addEventListener('click', function() {
        btnRI.textContent = 'Generuje...';
        fetch('/api/chrome-prompt').then(function(r){return r.json();}).then(function(d) {
          document.getElementById('rutynaPromptText').value = d.chrome_prompt || '';
          document.getElementById('rutynaPrompt').style.display = 'block';
          document.getElementById('rutynaCount').textContent = d.count + ' osob do zaproszenia dzis';
          btnRI.textContent = 'Wygeneruj liste do zaproszenia';
        });
      });
    }
  }).catch(function(e) {
    root.innerHTML = '<div class="pg-title">Codzienna rutyna LinkedIn</div><div style="color:var(--red)">Blad ladowania automatyzacji: ' + e.message + '</div>';
  });
}

// ── RENDER: PROSPEKCI & ZAPROSZENIA (merged) ─────────────────────────────────

var _prospects = [];

function renderProspekci(data, cron, prompts) {
  _prospects = data || [];
  var newPros = _prospects.filter(function(p) { return !p.status || p.status === 'new'; });
  var invPros = _prospects.filter(function(p) { return p.status && p.status !== 'new'; });

  var today = new Date().toISOString().slice(0,10);
  var newToday = _prospects.filter(function(p){ return (p.found_at||p.created_at||'').slice(0,10) === today; }).length;
  var now = new Date().toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'});

  var h = '<div class="pg-title">Inbound Leads — Budowanie sieci docelowej</div>';
  h += '<div style="font-size:12px;color:var(--dim);margin-bottom:12px">Strategia: dodawaj decision makers → widzą Twoje posty → sami pisza po usługi (MVP, MCP, API, automatyzacja)</div>';

  // Stats bar
  h += '<div class="post-stats" style="margin-bottom:16px">';
  h += '<div class="stat">W sieci: <b>' + _prospects.length + '</b></div>';
  h += '<div class="stat">Nowych do zaproszenia: <b style="color:var(--grn)">' + newPros.length + '</b></div>';
  h += '<div class="stat">Zaproszonych: <b>' + invPros.length + '</b></div>';
  h += '</div>';

  // ── TWOJA SIEC — decision makers w Twojej sieci ──
  h += '<div class="sec-h" style="color:#3fb950">Twoja siec — decision makers (connections)</div>';
  h += '<div style="font-size:11px;color:var(--dim);margin-bottom:8px">Ci ludzie widzą Twoje posty. Szukaj tu potencjalnych klientów na MVP/MCP/API.</div>';
  h += '<div id="warmLeadsRoot" style="margin-bottom:16px;font-size:12px;color:var(--dim)">Ladowanie...</div>';

  // Load prospects (mają headline!) — pokaż target buyers z leadscorem
  fetch('/api/leads?stage=all').then(function(r){return r.json();}).then(function(data) {
    var leads = data.leads || [];
    if (leads.length === 0) {
      document.getElementById('warmLeadsRoot').innerHTML = '<div style="padding:8px;color:var(--dim)">Brak prospektow — kliknij "Szukaj nowych" ponizej</div>';
      return;
    }

    // Sort by lead_score, show top decision makers
    leads.sort(function(a,b) { return (b.lead_score||0) - (a.lead_score||0); });

    var wh = '<div style="margin-bottom:8px;font-size:12px"><b style="color:var(--grn)">' + leads.length + ' prospektow</b> w Twojej bazie docelowej</div>';
    wh += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px">';
    leads.slice(0, 20).forEach(function(c) {
      var url = 'https://www.linkedin.com/in/' + (c.public_id || '');
      var score = c.lead_score || 0;
      var scoreColor = score >= 30 ? '#3fb950' : score >= 10 ? '#d29922' : 'var(--dim)';
      var border = score >= 30 ? 'border:1px solid #238636' : 'border:1px solid var(--brd)';
      var stage = c.pipeline_stage || 'new';
      var stageLabel = stage === 'new' ? 'Nowy' : stage === 'invited' ? 'Zaproszony' : stage === 'contacted' ? 'Skontaktowany' : stage;

      wh += '<div style="background:var(--card);' + border + ';border-radius:8px;padding:10px">';
      wh += '<div style="display:flex;justify-content:space-between;align-items:center">';
      wh += '<div style="font-weight:600;font-size:13px"><a href="' + url + '" target="_blank">' + esc(c.name || '-') + '</a></div>';
      wh += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.05);color:' + scoreColor + '">Score: ' + score + '</span>';
      wh += '</div>';
      wh += '<div style="font-size:11px;color:var(--dim);margin:2px 0">' + esc((c.headline || '').slice(0, 70)) + '</div>';
      if (c.company_name) wh += '<div style="font-size:11px;color:var(--blu)">' + esc(c.company_name) + '</div>';
      wh += '<div style="font-size:10px;margin-top:4px;color:' + scoreColor + '">' + stageLabel + '</div>';
      wh += '</div>';
    });
    wh += '</div>';
    if (leads.length > 20) wh += '<div style="font-size:11px;color:var(--dim);margin-top:4px">...i ' + (leads.length - 20) + ' wiecej</div>';
    document.getElementById('warmLeadsRoot').innerHTML = wh;
  }).catch(function() {
    document.getElementById('warmLeadsRoot').innerHTML = '';
  });

  // Cron status box
  if (cron) {
    var nextRun = cron.next_run ? new Date(cron.next_run).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'}) : '-';
    var lastRun = cron.last_run ? new Date(cron.last_run).toLocaleString('pl-PL') : 'nigdy';
    h += '<div class="cron-box">';
    h += '<span>Kolejne wyszukiwanie: <b>' + esc(nextRun) + '</b></span>';
    h += '<span style="margin-left:24px">Ostatnie: <b>' + esc(lastRun) + '</b></span>';
    if (cron.last_found > 0) h += '<span style="margin-left:24px">Ostatnio znaleziono: <b>' + cron.last_found + '</b></span>';
    h += '</div>';
  }

  // Prompts section
  if (prompts) {
    h += '<div style="margin-bottom:12px;font-size:13px;color:var(--dim)">Dzisiejsza lista (' + prompts.count + ' osob) — wygenerowana: ' + now + '</div>';

    h += '<div class="sec-h">A. Prompt dla Claude Code CLI</div>';
    h += '<div class="cblk"><pre id="mcp-p">' + esc(prompts.cli_prompt || '') + '</pre>';
    h += '<button class="cpbtn" data-copy="mcp-p">COPY</button></div>';

    h += '<div class="sec-h">B. Prompt dla Chrome (' + prompts.count + ' osob)</div>';
    h += '<div class="cblk"><pre id="chr-p">' + esc(prompts.chrome_prompt || '') + '</pre>';
    h += '<button class="cpbtn" data-copy="chr-p">COPY</button></div>';

    h += '<div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">';
    h += '<button class="btn primary" id="btnRefreshZap">Odswiez liste</button>';
    h += '<button class="btn" id="btnScanProspect" style="background:#238636;color:#fff">Szukaj nowych prospektow</button>';
    h += '<button class="btn" id="btnMarkInvited" style="background:#d29922;color:#000">Oznacz wszystkie jako zaproszone</button>';
    h += '<span id="scanStatus" style="font-size:12px;color:var(--dim);align-self:center"></span>';
    h += '</div>';
  }

  // New prospects table
  if (newPros.length > 0) {
    h += '<div class="sec-h">Do zaproszenia (' + newPros.length + ')</div>';
    h += '<table class="pro-tbl"><thead><tr><th>Imie i nazwisko</th><th>Stanowisko</th><th>Firma</th><th>Data</th><th></th></tr></thead><tbody>';
    newPros.forEach(function(p) {
      var url = p.profile_url || (p.public_id ? 'https://www.linkedin.com/in/' + p.public_id : '');
      var linkCell = url ? '<a href="' + esc(url) + '" target="_blank" class="pro-link">Otworz</a>' : '-';
      h += '<tr data-pid="' + esc(p.id) + '">';
      h += '<td><b>' + esc(p.name || '-') + '</b></td>';
      h += '<td>' + esc(p.title || p.headline || '-') + '</td>';
      h += '<td>' + esc(p.company || p.company_name || '-') + '</td>';
      h += '<td style="font-size:11px">' + esc((p.found_at||p.created_at||'').slice(0,10)) + '</td>';
      h += '<td>' + linkCell + ' <button class="btn sm" data-act="mark-invited" data-pid="' + esc(p.id) + '">Zaproszono</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div class="empty"><p>Brak nowych prospektow — cron uruchomi sie o 9:00, 13:00 lub 17:00</p></div>';
  }

  // Invited accordion
  if (invPros.length > 0) {
    h += '<div class="hist-toggle" style="margin-top:16px"><button class="btn" id="btnInvitedHist">Juz zaproszeni (' + invPros.length + ')</button></div>';
    h += '<div id="invited-history" style="display:none">';
    h += '<table class="pro-tbl" style="opacity:.6"><thead><tr><th>Imie i nazwisko</th><th>Stanowisko</th><th>Firma</th><th>Data zaproszenia</th></tr></thead><tbody>';
    invPros.slice(0, 50).forEach(function(p) {
      h += '<tr><td>' + esc(p.name || '-') + '</td><td>' + esc(p.title || p.headline || '-') + '</td>';
      h += '<td>' + esc(p.company || p.company_name || '-') + '</td>';
      h += '<td style="font-size:11px">' + esc((p.invited_at||'').slice(0,10)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  // DM Templates
  h += '<div class="sec-h" style="margin-top:24px">Szablony DM</div>';
  DM_TEMPLATES.forEach(function(t, i) {
    h += '<div class="tmpl"><h4>' + esc(t.title) + '</h4>';
    h += '<div class="tmpl-txt" contenteditable="true" id="tmpl' + i + '">' + esc(t.text) + '</div>';
    h += '<div class="tmpl-foot"><button class="btn sm" data-copy="tmpl' + i + '">COPY</button></div>';
    h += '</div>';
  });

  // Search queries
  h += '<div class="sec-h">Search Queries</div>';
  h += '<div class="chips">';
  SEARCH_QUERIES.forEach(function(q) {
    h += '<span class="chip" data-cp="' + esc(q) + '">' + esc(q) + '</span>';
  });
  h += '</div>';

  // Rules
  h += '<div class="sec-h">Zasady</div>';
  h += '<ul class="rules">';
  ['Max 15-20 zaproszen/tydzien','TYLKO 2nd degree connections','TYLKO polskie firmy MSP (50-500 osob)',
   'NIE: korporacje, rekruterzy, LinkedIn coachowie, konkurencja',
   'PRIORYTET: ludzie ktorzy publikuja > milczacy',
   'Po dodaniu — komentuj ich posty wartosciowo'].forEach(function(r) {
    h += '<li>' + esc(r) + '</li>';
  });
  h += '</ul>';

  document.getElementById('pro-root').innerHTML = h;

  // Wire up refresh button
  var btnRefresh = document.getElementById('btnRefreshZap');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', function() { loadProspekci(); });
  }

  // Wire up prospect scan button — SSE with live progress
  var btnScan = document.getElementById('btnScanProspect');
  if (btnScan) {
    btnScan.addEventListener('click', function() {
      var status = document.getElementById('scanStatus');
      btnScan.disabled = true;
      btnScan.style.opacity = '0.5';

      // Progress bar HTML
      var html = '<div style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:12px;margin:8px 0">';
      html += '<div style="font-weight:600;color:var(--yel);margin-bottom:8px" id="scanTitle">Uruchamiam wyszukiwanie...</div>';
      html += '<div style="background:#21262d;border-radius:4px;height:6px;margin-bottom:8px;overflow:hidden"><div id="scanBar" style="height:100%;width:5%;background:var(--blu);border-radius:4px;transition:width 0.5s"></div></div>';
      html += '<div id="scanLog" style="font-family:var(--mono);font-size:11px;color:var(--dim);max-height:150px;overflow-y:auto"></div>';
      html += '</div>';
      status.innerHTML = html;

      var logEl = document.getElementById('scanLog');
      var barEl = document.getElementById('scanBar');
      var titleEl = document.getElementById('scanTitle');
      var step = 0;
      var totalNew = 0;

      function addLog(msg, color) {
        var d = document.createElement('div');
        d.style.color = color || 'var(--dim)';
        d.textContent = msg;
        logEl.appendChild(d);
        logEl.scrollTop = logEl.scrollHeight;
      }

      var es = new EventSource('/api/prospect/scan');

      es.onmessage = function(e) {
        var d = JSON.parse(e.data);

        if (d.type === 'start') {
          addLog('> ' + d.message, 'var(--blu)');
          barEl.style.width = '10%';
        }
        if (d.type === 'searching') {
          step = d.step || (step + 1);
          var totalSteps = d.total_steps || 4;
          barEl.style.width = Math.min(10 + (step / totalSteps) * 70, 85) + '%';
          titleEl.textContent = '[' + step + '/' + totalSteps + '] Szukam: ' + d.query;
          titleEl.style.color = 'var(--yel)';
          addLog('[' + step + '/' + totalSteps + '] Szukam: ' + d.query + '...');
        }
        if (d.type === 'found') {
          totalNew = d.total_new || totalNew;
          var newBatch = d.new_in_batch || 0;
          var color = newBatch > 0 ? '#3fb950' : 'var(--dim)';
          addLog('  -> ' + d.found + ' osob, ' + newBatch + ' NOWYCH (lacznie nowych: ' + totalNew + ')', color);
        }
        if (d.type === 'error') {
          addLog('  Blad: ' + d.query + ' — ' + d.message, '#f85149');
        }
        if (d.type === 'done') {
          es.close();
          totalNew = d.total_new || totalNew;
          barEl.style.width = '100%';
          barEl.style.background = totalNew > 0 ? '#3fb950' : '#d29922';
          titleEl.textContent = totalNew > 0 ? 'Znaleziono ' + totalNew + ' nowych! (lacznie w bazie: ' + d.total + ')' : 'Brak nowych (lacznie w bazie: ' + d.total + ')';
          titleEl.style.color = totalNew > 0 ? '#3fb950' : '#d29922';
          addLog('--- GOTOWE: ' + totalNew + ' nowych, ' + d.total + ' lacznie ---', totalNew > 0 ? '#3fb950' : '#d29922');

          if (d.new_prospects && d.new_prospects.length > 0) {
            var listHtml = '<div style="margin-top:8px;border-top:1px solid var(--brd);padding-top:8px"><b style="font-size:11px;color:#3fb950">Nowi prospekci do zaproszenia:</b><ul style="margin:4px 0 0;padding-left:16px;font-size:12px">';
            d.new_prospects.forEach(function(p) {
              listHtml += '<li><a href="https://www.linkedin.com/in/' + esc(p.public_id) + '" target="_blank" style="color:var(--blu)">' + esc(p.name) + '</a>';
              if (p.company_name) listHtml += ' <span style="color:var(--dim)">— ' + esc(p.company_name) + '</span>';
              listHtml += '</li>';
            });
            listHtml += '</ul></div>';
            logEl.innerHTML += listHtml;
          }

          btnScan.disabled = false;
          btnScan.style.opacity = '1';
          // Force full reload of Prospekci tab data
          loadProspekci();
          setTimeout(function() { loadProspekci(); }, 3000);
        }
        if (d.type === 'fatal') {
          es.close();
          barEl.style.width = '100%';
          barEl.style.background = '#f85149';
          titleEl.textContent = 'Blad';
          titleEl.style.color = '#f85149';
          var isAuth = d.message.includes('302') || d.message.includes('session') || d.message.includes('cookie');
          addLog('BLAD: ' + d.message, '#f85149');
          if (isAuth) addLog('Cookie wygasl — uruchom: node scripts/refresh-voyager-cookie.mjs --login', '#d29922');
          btnScan.disabled = false;
          btnScan.style.opacity = '1';
        }
      };

      es.onerror = function() {
        es.close();
        barEl.style.width = '100%';
        barEl.style.background = '#f85149';
        titleEl.textContent = 'Blad polaczenia';
        titleEl.style.color = '#f85149';
        btnScan.disabled = false;
        btnScan.style.opacity = '1';
      };
    });
  }

  // Wire up mark-invited button
  var btnMark = document.getElementById('btnMarkInvited');
  if (btnMark) {
    btnMark.addEventListener('click', function() {
      fetch('/api/prospect/mark-invited', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(d) {
        var status = document.getElementById('scanStatus');
        if (d.marked > 0) {
          status.innerHTML = '<div style="background:#1c1c00;border:1px solid #d29922;border-radius:8px;padding:8px;margin:8px 0;font-size:12px;color:#d29922">Oznaczono ' + d.marked + ' osob jako zaproszone</div>';
          setTimeout(function() { loadProspekci(); }, 1000);
        } else {
          status.innerHTML = '<span style="font-size:12px;color:var(--dim)">Brak nowych do oznaczenia</span>';
        }
      });
    });
  }

  // Wire up invited accordion
  var btnInvHist = document.getElementById('btnInvitedHist');
  if (btnInvHist) {
    btnInvHist.addEventListener('click', function() {
      var el = document.getElementById('invited-history');
      var showing = el.style.display !== 'none';
      el.style.display = showing ? 'none' : 'block';
      btnInvHist.textContent = (showing ? 'Juz zaproszeni' : 'Ukryj zaproszonych') + ' (' + invPros.length + ')';
    });
  }
}

function loadProspekci() {
  Promise.all([
    fetch('/api/prospects').then(function(r){return r.json();}),
    fetch('/api/cron-status').then(function(r){return r.json();}),
    fetch('/api/chrome-prompt').then(function(r){return r.json();})
  ]).then(function(results) {
    renderProspekci(results[0], results[1], results[2]);
  }).catch(function() {
    renderProspekci([], null, null);
  });
}

// ── RENDER: ANALYTICS (v2 — Chart.js) ───────────────────────────────────────

function renderAnalytics() {
  var root = document.getElementById('ana-root');
  root.innerHTML = '<div class="pg-title">Analytics</div><div class="empty">Ladowanie...</div>';

  var anaDays = parseInt(localStorage.getItem('ana_days') || '365');

  Promise.all([
    api('/api/analytics'),
    api('/api/analytics/trends?days=' + anaDays),
    api('/api/analytics/content-types'),
    api('/api/analytics/best-times'),
    api('/api/analytics/reaction-trends?days=' + anaDays),
  ]).then(function(results) {
    var data = results[0];
    var trends = results[1];
    var ctypes = results[2];
    var bestTimes = results[3];
    var rxTrends = results[4];

    if (data.error) {
      root.innerHTML = '<div class="pg-title">Analytics</div><div class="empty"><p>' + esc(data.error) + '</p><p>Uruchom: <code>node auto-analytics.mjs</code></p></div>';
      return;
    }
    var c = data.current || {};
    var h = '<div class="pg-title">Analytics — Command Center</div>';

    // ── Period toggle ─────────────────────────────────────────────────────
    h += '<div style="display:flex;gap:6px;margin-bottom:16px" id="ana-period">';
    [30, 90, 180, 365].forEach(function(d) {
      var cls = d === anaDays ? 'btn active' : 'btn';
      h += '<button class="' + cls + ' sm" data-days="' + d + '">' + d + 'd</button>';
    });
    h += '</div>';

    // ── Staleness banner ─────────────────────────────────────────────────────
    var ds = data.data_stale || {};
    var staleMsgs = [];
    if (ds.followers) staleMsgs.push('liczba obserwujących nieaktualna (Voyager niedostępne — ostatni realny pomiar ' + (ds.followers_last_real_date || '?') + ')');
    if (ds.profileviews_dead) staleMsgs.push('wyświetlenia profilu niedostępne (endpoint LinkedIn 410 Gone)');
    if (ds.charts_stale_days != null && ds.charts_stale_days > 2) staleMsgs.push('wykresy 365-dni zamrożone od ' + ds.charts_stale_days + ' dni (scrape Highcharts nie aktualizuje — patrz /api/analytics/llm-export → health_alarms)');
    if (ds.errors_today > 30) staleMsgs.push(ds.errors_today + ' błędów API dzisiaj (część endpointów wycofana przez LinkedIn)');
    if (staleMsgs.length) {
      h += '<div style="background:rgba(210,153,34,.12);border:1px solid rgba(210,153,34,.4);color:#d29922;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:12px">⚠️ ' + esc(staleMsgs.join(' · ')) + '</div>';
    }

    // ── KPI Cards ──────────────────────────────────────────────────────────
    var fd = c.follower_delta || 0;
    h += '<div class="kpi-row">';
    h += '<div class="kpi-box"><div class="kl">Followers</div><div class="kv">' + (c.follower_count || '-') + '</div><div class="kd ' + (fd >= 0 ? 'pos' : 'neg') + '">' + (fd >= 0 ? '+' : '') + fd + ' / 7d' + (ds.followers ? ' (stale)' : '') + '</div></div>';
    h += '<div class="kpi-box"><div class="kl">Impressions</div><div class="kv">' + (c.impressions || '-') + '</div><div class="kd neu">' + (ds.impressions_scrape_date ? 'scrape ' + ds.impressions_scrape_date : 'top posty') + '</div></div>';
    h += '<div class="kpi-box"><div class="kl">Reactions</div><div class="kv">' + (c.total_reactions || 0) + '</div><div class="kd neu">all posts</div></div>';
    h += '<div class="kpi-box"><div class="kl">Engagement</div><div class="kv">' + (c.avg_engagement_rate || 0) + '%</div><div class="kd neu">' + (c.impressions > 0 ? 'reactions/impr' : 'reactions/followers') + '</div></div>';
    h += '</div>';

    // ── Follower Growth (Chart.js line) ───────────────────────────────────
    var tLabels = trends.labels || [];
    if (tLabels.length > 1) {
      h += '<div class="sec-h">Follower Growth (' + anaDays + ' dni)</div>';
      h += '<div class="chart-box"><canvas id="chart-followers" height="240"></canvas></div>';
    }

    // ── Engagement Trends (Chart.js multi-line) ───────────────────────────
    if (tLabels.length > 1) {
      h += '<div class="sec-h">Engagement Trends</div>';
      h += '<div class="chart-box"><canvas id="chart-engagement" height="240"></canvas></div>';
    }

    // ── Content Type Performance (Chart.js bar) ───────────────────────────
    var ct = ctypes.types || [];
    if (ct.length > 0) {
      h += '<div class="sec-h">Performance by Content Type</div>';
      h += '<div class="chart-box"><canvas id="chart-ctypes" height="180"></canvas></div>';
    }

    // ── Best Posting Times (CSS heatmap) ──────────────────────────────────
    var hm = bestTimes.heatmap || [];
    var hasHeatmapData = hm.some(function(row) { return row.some(function(v) { return v > 0; }); });
    if (hasHeatmapData) {
      h += '<div class="sec-h">Best Posting Times</div>';
      var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      h += '<div class="heatmap">';
      // Header row
      h += '<div class="hm-label"></div>';
      for (var hi = 0; hi < 24; hi++) h += '<div class="hm-head">' + hi + '</div>';
      // Data rows
      var hmMax = Math.max.apply(null, hm.flat().filter(function(v) { return v > 0; }));
      for (var di = 0; di < 7; di++) {
        h += '<div class="hm-label">' + days[di] + '</div>';
        for (var hj = 0; hj < 24; hj++) {
          var val = hm[di] ? (hm[di][hj] || 0) : 0;
          var intensity = hmMax > 0 ? val / hmMax : 0;
          var bgColor = val > 0 ? 'rgba(63,185,80,' + (0.15 + intensity * 0.85).toFixed(2) + ')' : 'rgba(48,54,61,.3)';
          h += '<div class="hm-cell" style="background:' + bgColor + '" title="' + days[di] + ' ' + hj + ':00 — avg ' + val + ' reactions">' + (val > 0 ? val : '') + '</div>';
        }
      }
      h += '</div>';
      if (bestTimes.best_hour !== null) {
        h += '<div style="font-size:11px;color:var(--dim);margin-bottom:16px">Najlepszy czas: <b style="color:var(--grn)">' + days[bestTimes.best_day] + ' ' + bestTimes.best_hour + ':00</b></div>';
      }
    }

    // ── Reaction Type Trends (Chart.js stacked) ──────────────────────────
    var rxDates = rxTrends.dates || [];
    if (rxDates.length > 0) {
      h += '<div class="sec-h">Reaction Type Trends</div>';
      h += '<div class="chart-box"><canvas id="chart-reactions" height="200"></canvas></div>';
    }

    // ── Top Posts ──────────────────────────────────────────────────────────
    var tp = data.top_posts || [];
    if (tp.length > 0) {
      h += '<div class="sec-h">Top posty (by reactions)</div>';
      h += '<table class="pro-tbl"><thead><tr><th>#</th><th>Post</th><th>Type</th><th>Reactions</th><th>Comments</th><th>Breakdown</th></tr></thead><tbody>';
      tp.forEach(function(p, i) {
        var breakdown = [];
        if (p.like_count) breakdown.push(p.like_count + ' LIKE');
        if (p.interest_count) breakdown.push(p.interest_count + ' INSIGHTFUL');
        if (p.praise_count) breakdown.push(p.praise_count + ' CELEBRATE');
        if (p.empathy_count) breakdown.push(p.empathy_count + ' LOVE');
        if (p.appreciation_count) breakdown.push(p.appreciation_count + ' SUPPORT');
        if (p.entertainment_count) breakdown.push(p.entertainment_count + ' FUNNY');
        h += '<tr>';
        h += '<td style="font-family:var(--mono)">' + (i + 1) + '</td>';
        h += '<td style="max-width:280px">' + esc(p.text_preview || p.post_urn) + '</td>';
        h += '<td><span class="badge" style="background:rgba(56,139,253,.15);color:var(--blu)">' + esc(p.content_type || 'text') + '</span></td>';
        h += '<td style="font-family:var(--mono);color:var(--grn)">' + (p.total_reactions || 0) + '</td>';
        h += '<td style="font-family:var(--mono)">' + (p.comment_count != null ? p.comment_count : '—') + '</td>';
        h += '<td style="font-size:11px;color:var(--dim)">' + breakdown.join(', ') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    // ── Weekly Reports ────────────────────────────────────────────────────
    var wr = data.weekly_reports || [];
    if (wr.length > 0) {
      h += '<div class="sec-h">Weekly Reports</div>';
      wr.forEach(function(r) {
        h += '<div class="card" style="font-size:12px">';
        h += '<div style="font-weight:700;margin-bottom:6px">Tydzien od ' + esc(r.week_start) + '</div>';
        h += '<div style="color:var(--dim)">';
        h += 'Reactions: <b style="color:var(--grn)">' + (r.total_reactions || 0) + '</b> | ';
        h += 'Followers: <b class="' + (r.follower_delta >= 0 ? 'pos' : 'neg') + '">' + (r.follower_delta >= 0 ? '+' : '') + (r.follower_delta || 0) + '</b> | ';
        h += 'Posts: ' + (r.posts_count || 0) + ' | ';
        h += 'Eng: <b>' + (r.avg_engagement_rate || 0) + '%</b>';
        h += '</div></div>';
      });
    }

    root.innerHTML = h;

    // ── Initialize Chart.js charts after DOM render ──────────────────────
    if (typeof Chart === 'undefined') return;

    // Follower Growth
    if (tLabels.length > 1 && document.getElementById('chart-followers')) {
      createChart('chart-followers', 'line', tLabels.map(function(d) { return d.slice(5); }), [{
        label: 'Followers',
        data: trends.datasets.followers,
        borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.12)',
        fill: true, tension: 0.3, pointRadius: 1, borderWidth: 2
      }], { plugins: { legend: { display: false } } });
    }

    // Engagement Trends
    if (tLabels.length > 1 && document.getElementById('chart-engagement')) {
      createChart('chart-engagement', 'line', tLabels.map(function(d) { return d.slice(5); }), [
        { label: 'Reactions', data: trends.datasets.reactions, borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.08)', fill: true, tension: 0.3, pointRadius: 1, borderWidth: 2, yAxisID: 'y' },
        { label: 'Impressions (daily)', data: trends.datasets.impressions_daily, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,.08)', fill: true, tension: 0.3, pointRadius: 1, borderWidth: 2, yAxisID: 'y' },
        { label: 'Engagement %', data: trends.datasets.engagement_rate, borderColor: '#d29922', tension: 0.3, pointRadius: 1, borderWidth: 2, yAxisID: 'y1' },
      ], {
        scales: {
          y: { position: 'left', ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } },
          y1: { position: 'right', ticks: { color: '#d29922', font: { family: 'JetBrains Mono', size: 10 }, callback: function(v) { return v + '%'; } }, grid: { display: false } },
          x: { ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 15 }, grid: { color: 'rgba(48,54,61,.5)' } }
        }
      });
    }

    // Content Type
    if (ct.length > 0 && document.getElementById('chart-ctypes')) {
      createChart('chart-ctypes', 'bar', ct.map(function(t) { return t.content_type; }), [
        { label: 'Avg Reactions', data: ct.map(function(t) { return t.avg_reactions; }), backgroundColor: 'rgba(63,185,80,.6)', borderRadius: 4 },
        { label: 'Avg Comments', data: ct.map(function(t) { return t.avg_comments; }), backgroundColor: 'rgba(88,166,255,.6)', borderRadius: 4 },
      ], { indexAxis: 'y' });
    }

    // Reaction Trends
    if (rxDates.length > 0 && document.getElementById('chart-reactions')) {
      var rxColors = { LIKE: '#58a6ff', PRAISE: '#3fb950', EMPATHY: '#f85149', INTEREST: '#d29922', APPRECIATION: '#a371f7', ENTERTAINMENT: '#f778ba' };
      var rxSeries = rxTrends.series || {};
      var rxDatasets = [];
      for (var rk in rxSeries) {
        rxDatasets.push({
          label: rk, data: rxSeries[rk],
          backgroundColor: (rxColors[rk] || '#8b949e') + '88',
          borderColor: rxColors[rk] || '#8b949e',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1
        });
      }
      createChart('chart-reactions', 'line', rxDates.map(function(d) { return d.slice(5); }), rxDatasets, {
        scales: {
          y: { stacked: true, ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } },
          x: { ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 15 }, grid: { color: 'rgba(48,54,61,.5)' } }
        }
      });
    }

    // ── Period toggle handler ─────────────────────────────────────────────
    var periodBtns = document.querySelectorAll('#ana-period button');
    periodBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        localStorage.setItem('ana_days', btn.dataset.days);
        renderAnalytics();
      });
    });

  }).catch(function(err) {
    root.innerHTML = '<div class="pg-title">Analytics</div><div class="empty">Blad ladowania: ' + (err.message || err) + '</div>';
  });
}

// ── RENDER: SIEC (Network) ──────────────────────────────────────────────────

function renderSiec() {
  var root = document.getElementById('siec-root');
  root.innerHTML = '<div class="pg-title">Siec</div><div class="empty">Ladowanie...</div>';

  var siecDays = parseInt(localStorage.getItem('siec_days') || '365');

  Promise.all([
    api('/api/network/growth?days=' + siecDays),
    api('/api/network/top-engagers?limit=20'),
    api('/api/network/demographics'),
    api('/api/network/connections?limit=50'),
  ]).then(function(results) {
    var growth = results[0];
    var engagers = results[1];
    var connections = results[3];
    var demo = results[2];

    var h = '<div class="pg-title">Siec — Network Intelligence</div>';

    // ── Period toggle ─────────────────────────────────────────────────────
    h += '<div style="display:flex;gap:6px;margin-bottom:16px" id="siec-period">';
    [30, 90, 180, 365].forEach(function(d) {
      var cls = d === siecDays ? 'btn active' : 'btn';
      h += '<button class="' + cls + ' sm" data-days="' + d + '">' + d + 'd</button>';
    });
    h += '</div>';

    // ── Growth KPIs ──────────────────────────────────────────────────────
    var tl = growth.timeline || [];
    var thisWeek = 0, thisMonth = 0;
    var now = new Date();
    tl.forEach(function(r) {
      var d = new Date(r.date);
      var diff = (now - d) / 86400000;
      if (diff <= 7) thisWeek += (r.delta || 0);
      if (diff <= 30) thisMonth += (r.delta || 0);
    });

    h += '<div class="kpi-row">';
    h += '<div class="kpi-box"><div class="kl">This Week</div><div class="kv">' + (thisWeek >= 0 ? '+' : '') + thisWeek + '</div><div class="kd ' + (thisWeek >= 0 ? 'pos' : 'neg') + '">followers</div></div>';
    h += '<div class="kpi-box"><div class="kl">This Month</div><div class="kv">' + (thisMonth >= 0 ? '+' : '') + thisMonth + '</div><div class="kd ' + (thisMonth >= 0 ? 'pos' : 'neg') + '">followers</div></div>';
    h += '<div class="kpi-box"><div class="kl">Total Growth (' + tl.length + 'd)</div><div class="kv">' + (growth.total_growth >= 0 ? '+' : '') + (growth.total_growth || 0) + '</div><div class="kd neu">followers</div></div>';
    h += '<div class="kpi-box"><div class="kl">Avg Daily</div><div class="kv">' + (growth.avg_daily || 0) + '</div><div class="kd neu">followers/day</div></div>';
    h += '</div>';

    // ── Follower Growth Timeline (Chart.js combo) ────────────────────────
    if (tl.length > 1) {
      h += '<div class="sec-h">Follower Growth Timeline</div>';
      h += '<div class="chart-box"><canvas id="chart-net-growth" height="260"></canvas></div>';
    }

    // ── Top Engagers ─────────────────────────────────────────────────────
    var eng = engagers.engagers || [];
    h += '<div class="sec-h">Top Engagers (' + eng.length + ')</div>';
    if (eng.length > 0) {
      h += '<table class="pro-tbl"><thead><tr><th>#</th><th>Name</th><th>Headline</th><th>Reactions</th><th>Comments</th><th>Total</th></tr></thead><tbody>';
      eng.forEach(function(e, i) {
        var profileUrl = e.public_id ? 'https://www.linkedin.com/in/' + e.public_id : '#';
        h += '<tr>';
        h += '<td style="font-family:var(--mono)">' + (i + 1) + '</td>';
        h += '<td><a href="' + profileUrl + '" target="_blank">' + esc(e.name || '-') + '</a></td>';
        h += '<td style="max-width:250px;font-size:11px;color:var(--dim)">' + esc(e.headline || '-') + '</td>';
        h += '<td style="font-family:var(--mono);color:var(--grn)">' + (e.reaction_count || 0) + '</td>';
        h += '<td style="font-family:var(--mono)">' + (e.comment_count || 0) + '</td>';
        h += '<td style="font-family:var(--mono);font-weight:700;color:var(--grn)">' + (e.total_engagements || 0) + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<div class="empty" style="padding:20px">Brak danych. Uruchom auto-analytics z opcja top_engagers.</div>';
    }

    // ── Demographics (Chart.js doughnuts) ────────────────────────────────
    var hasDemo = (demo.industries || []).length > 0 || (demo.job_titles || []).length > 0 || (demo.locations || []).length > 0;
    if (hasDemo) {
      h += '<div class="sec-h">Network Demographics</div>';
      h += '<div class="chart-row">';
      if ((demo.industries || []).length > 0) h += '<div class="chart-box"><div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--dim)">Industries</div><canvas id="chart-demo-ind" height="200"></canvas></div>';
      if ((demo.job_titles || []).length > 0) h += '<div class="chart-box"><div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--dim)">Job Titles</div><canvas id="chart-demo-jt" height="200"></canvas></div>';
      h += '</div>';
      if ((demo.locations || []).length > 0) {
        h += '<div class="chart-box" style="max-width:480px"><div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--dim)">Locations</div><canvas id="chart-demo-loc" height="200"></canvas></div>';
      }
    } else {
      h += '<div class="sec-h">Network Demographics</div>';
      h += '<div class="empty" style="padding:20px">Brak danych demograficznych. Zbierane co niedziele przez auto-analytics.</div>';
    }

    // ── Connections List ──────────────────────────────────────────────────
    var conns = (connections && connections.connections) || [];
    var connTotal = (connections && connections.total) || conns.length;
    h += '<div class="sec-h">Moje polaczenia (' + connTotal + ')</div>';
    if (conns.length > 0) {
      h += '<table class="pro-tbl"><thead><tr><th>#</th><th>Imie</th><th>Headline</th><th>Profil</th></tr></thead><tbody>';
      conns.forEach(function(c, i) {
        h += '<tr>';
        h += '<td style="font-family:var(--mono)">' + (i + 1) + '</td>';
        h += '<td><a href="' + esc(c.profile_url || '') + '" target="_blank">' + esc(c.name || '-') + '</a></td>';
        h += '<td style="max-width:300px;font-size:11px;color:var(--dim)">' + esc(c.headline || '-') + '</td>';
        h += '<td><a href="' + esc(c.profile_url || '') + '" target="_blank" style="font-size:11px">LinkedIn</a></td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<div class="empty" style="padding:20px">Brak danych. Uruchom: node scripts/scrape-analytics.mjs</div>';
    }

    root.innerHTML = h;

    // ── Charts ────────────────────────────────────────────────────────────
    if (typeof Chart === 'undefined') return;

    // Growth timeline
    if (tl.length > 1 && document.getElementById('chart-net-growth')) {
      var gLabels = tl.map(function(r) { return r.date.slice(5); });
      createChart('chart-net-growth', 'bar', gLabels, [
        { type: 'line', label: 'Followers', data: tl.map(function(r) { return r.follower_count; }), borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.1)', fill: true, tension: 0.3, pointRadius: 1, borderWidth: 2, yAxisID: 'y' },
        { type: 'bar', label: 'Daily +/-', data: tl.map(function(r) { return r.delta; }), backgroundColor: tl.map(function(r) { return r.delta >= 0 ? 'rgba(63,185,80,.5)' : 'rgba(248,81,73,.5)'; }), borderRadius: 2, yAxisID: 'y1' },
      ], {
        scales: {
          y: { position: 'left', ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } },
          y1: { position: 'right', ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { display: false } },
          x: { ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 15 }, grid: { color: 'rgba(48,54,61,.5)' } }
        }
      });
    }

    // Demographics doughnuts
    var demoColors = ['#3fb950','#58a6ff','#d29922','#f85149','#a371f7','#f778ba','#79c0ff','#7ee787','#e3b341','#ffa657'];
    function renderDoughnut(canvasId, data) {
      if (!document.getElementById(canvasId) || !data.length) return;
      var top = data.slice(0, 8);
      createChart(canvasId, 'doughnut', top.map(function(d) { return d.value; }), [{
        data: top.map(function(d) { return d.count; }),
        backgroundColor: demoColors.slice(0, top.length),
        borderWidth: 0
      }], { plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 12 } } } });
    }
    renderDoughnut('chart-demo-ind', demo.industries || []);
    renderDoughnut('chart-demo-jt', demo.job_titles || []);
    renderDoughnut('chart-demo-loc', demo.locations || []);

    // ── Period toggle handler ─────────────────────────────────────────────
    var siecBtns = document.querySelectorAll('#siec-period button');
    siecBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        localStorage.setItem('siec_days', btn.dataset.days);
        renderSiec();
      });
    });

  }).catch(function(err) {
    root.innerHTML = '<div class="pg-title">Siec</div><div class="empty">Blad: ' + (err.message || err) + '</div>';
  });
}

// ── RENDER: LEADY (Pipeline) ────────────────────────────────────────────────

function renderLeady() {
  var root = document.getElementById('leady-root');
  root.innerHTML = '<div class="pg-title">Leady</div><div class="empty">Ladowanie...</div>';

  Promise.all([
    api('/api/leads?stage=all'),
    api('/api/leads/pipeline-summary'),
  ]).then(function(results) {
    var leadsData = results[0];
    var pipeline = results[1];
    var leads = leadsData.leads || [];
    var stages = pipeline.stages || {};

    var h = '<div class="pg-title">Leady — Sales Pipeline</div>';

    // ── Pipeline Funnel ──────────────────────────────────────────────────
    var stageNames = { new: 'Nowy', contacted: 'Kontakt', connected: 'Polaczony', qualified: 'Kwalifikowany', proposal: 'Propozycja', client: 'Klient', lost: 'Lost' };
    var stageColors = { new: 'var(--blu)', contacted: 'var(--yel)', connected: '#a371f7', qualified: 'var(--grn)', proposal: '#f778ba', client: '#3fb950', lost: 'var(--red)' };
    h += '<div class="funnel" id="lead-funnel">';
    var total = Object.values(stages).reduce(function(a, b) { return a + b; }, 0) || 1;
    ['new','contacted','connected','qualified','proposal','client','lost'].forEach(function(s) {
      var count = stages[s] || 0;
      h += '<div class="funnel-stage" data-stage="' + s + '" style="border-top:3px solid ' + stageColors[s] + '">';
      h += '<div class="fs-count" style="color:' + stageColors[s] + '">' + count + '</div>';
      h += '<div class="fs-label">' + stageNames[s] + '</div>';
      h += '</div>';
    });
    h += '</div>';

    // ── Buying Signals ───────────────────────────────────────────────────
    var signals = leads.filter(function(l) { return (l.buying_signals || 0) > 0; }).slice(0, 5);
    if (signals.length > 0) {
      h += '<div class="sec-h">Buying Signals</div>';
      signals.forEach(function(l) {
        h += '<div class="card" style="border-left:3px solid var(--grn)">';
        h += '<div class="card-top"><div><b>' + esc(l.name || '-') + '</b>';
        if (l.company_name) h += ' <span style="color:var(--dim);font-size:12px">@ ' + esc(l.company_name) + '</span>';
        h += '</div><span class="score-badge score-high">' + (l.buying_signals || 0) + ' signals</span></div>';
        h += '<div style="font-size:12px;color:var(--dim);margin-top:4px">' + esc(l.headline || '') + '</div>';
        h += '</div>';
      });
    }

    // ── Lead Table ────────────────────────────────────────────────────────
    h += '<div class="sec-h">All Leads (' + leads.length + ')</div>';
    if (leads.length > 0) {
      h += '<table class="pro-tbl"><thead><tr><th>#</th><th>Name</th><th>Company</th><th>Score</th><th>Stage</th><th>Signals</th><th>Last Activity</th><th>Actions</th></tr></thead><tbody>';
      leads.forEach(function(l, i) {
        var score = l.computed_score || l.lead_score || 0;
        var scoreCls = score >= 60 ? 'score-high' : score >= 30 ? 'score-mid' : 'score-low';
        var profileUrl = l.public_id ? 'https://www.linkedin.com/in/' + l.public_id : '#';
        var lastAct = l.last_activity_at ? l.last_activity_at.slice(0, 10) : '-';
        h += '<tr>';
        h += '<td style="font-family:var(--mono)">' + (i + 1) + '</td>';
        h += '<td><a href="' + profileUrl + '" target="_blank">' + esc(l.name || '-') + '</a></td>';
        h += '<td style="font-size:11px;color:var(--dim)">' + esc(l.company_name || '-') + '</td>';
        h += '<td><span class="score-badge ' + scoreCls + '">' + score + '</span></td>';
        h += '<td><select class="sel-inline" data-lead-id="' + l.id + '" data-action="stage">';
        ['new','contacted','connected','qualified','proposal','client','lost'].forEach(function(s) {
          h += '<option value="' + s + '"' + ((l.pipeline_stage || 'new') === s ? ' selected' : '') + '>' + stageNames[s] + '</option>';
        });
        h += '</select></td>';
        h += '<td style="font-family:var(--mono);font-size:11px">';
        if (l.buying_signals) h += '<span style="color:var(--grn)">' + l.buying_signals + ' buy</span> ';
        if (l.job_signals) h += '<span style="color:var(--yel)">' + l.job_signals + ' job</span>';
        if (!l.buying_signals && !l.job_signals) h += '-';
        h += '</td>';
        h += '<td style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + lastAct + '</td>';
        h += '<td><button class="btn sm" data-lead-id="' + l.id + '" data-action="timeline">Timeline</button></td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<div class="empty" style="padding:20px">Brak leadow. Dodaj prospektow przez MCP: linkedin_prospect_save</div>';
    }

    // ── Lead Detail Modal area ───────────────────────────────────────────
    h += '<div id="lead-detail" style="display:none"></div>';

    root.innerHTML = h;

    // ── Event handlers ───────────────────────────────────────────────────
    root.addEventListener('change', function(e) {
      if (e.target.dataset.action === 'stage') {
        var leadId = e.target.dataset.leadId;
        var newStage = e.target.value;
        api('/api/leads/' + encodeURIComponent(leadId) + '/stage', {
          method: 'POST', body: JSON.stringify({ stage: newStage })
        }).then(function() { toast('Stage updated', true); });
      }
    });

    root.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="timeline"]');
      if (!btn) return;
      var leadId = btn.dataset.leadId;
      var detail = document.getElementById('lead-detail');
      detail.style.display = 'block';
      detail.innerHTML = '<div class="card"><div class="empty">Ladowanie timeline...</div></div>';
      api('/api/leads/' + encodeURIComponent(leadId) + '/timeline').then(function(data) {
        var items = data.timeline || [];
        var th = '<div class="card"><div class="sec-h">Timeline — ' + leadId.slice(0, 8) + '</div>';
        if (items.length > 0) {
          th += '<div class="ltl">';
          items.forEach(function(item) {
            th += '<div class="ltl-item">';
            th += '<div class="ltl-date">' + (item.date || '-').slice(0, 16) + ' — <b>' + esc(item.type) + '</b></div>';
            th += '<div class="ltl-text">' + esc(item.text || '') + '</div>';
            th += '</div>';
          });
          th += '</div>';
        } else {
          th += '<div style="color:var(--dim);font-size:12px">Brak historii.</div>';
        }
        th += '<div style="margin-top:10px"><button class="btn sm" id="btn-close-timeline">Zamknij</button></div>';
        th += '</div>';
        detail.innerHTML = th;
        var closeBtn = document.getElementById('btn-close-timeline');
        if (closeBtn) closeBtn.addEventListener('click', function() { detail.style.display = 'none'; });
      });
    });

    // Funnel stage filter
    root.querySelectorAll('.funnel-stage').forEach(function(el) {
      el.addEventListener('click', function() {
        var stage = el.dataset.stage;
        root.querySelectorAll('.funnel-stage').forEach(function(s) { s.classList.remove('active'); });
        el.classList.add('active');
        // Filter table rows
        var rows = root.querySelectorAll('.pro-tbl tbody tr');
        rows.forEach(function(row) {
          var sel = row.querySelector('select');
          if (!sel) return;
          row.style.display = (stage === 'all' || sel.value === stage) ? '' : 'none';
        });
      });
    });

  }).catch(function(err) {
    root.innerHTML = '<div class="pg-title">Leady</div><div class="empty">Blad: ' + (err.message || err) + '</div>';
  });
}

// ── RENDER: KONTENTY (Content Intelligence) ─────────────────────────────────

function renderKontenty() {
  var root = document.getElementById('kontenty-root');
  root.innerHTML = '<div class="pg-title">Kontenty</div><div class="empty">Odswiezanie danych...</div>';

  // Auto-refresh content data first, then load
  api('/api/content/refresh', { method: 'POST' }).then(function() {
    return Promise.all([
      api('/api/content/performance'),
      api('/api/content/hashtags'),
      api('/api/content/optimal-length'),
      api('/api/analytics/content-types'),
    ]);
  }).then(function(results) {
    var perfData = results[0];
    var hashData = results[1];
    var lenData = results[2];
    var ctData = results[3];
    var posts = perfData.posts || [];
    var hashtags = hashData.hashtags || [];
    var buckets = lenData.buckets || [];
    var ctypes = ctData.types || [];

    var h = '<div class="pg-title">Kontenty — Content Intelligence</div>';

    // ── Content KPIs ─────────────────────────────────────────────────────
    var totalPosts = posts.length;
    var avgReactions = totalPosts > 0 ? Math.round(posts.reduce(function(s, p) { return s + p.total_reactions; }, 0) / totalPosts * 10) / 10 : 0;
    var avgComments = totalPosts > 0 ? Math.round(posts.reduce(function(s, p) { return s + p.comment_count; }, 0) / totalPosts * 10) / 10 : 0;
    var avgLength = totalPosts > 0 ? Math.round(posts.reduce(function(s, p) { return s + (p.post_length || 0); }, 0) / totalPosts) : 0;

    h += '<div class="kpi-row">';
    h += '<div class="kpi-box"><div class="kl">Total Posts</div><div class="kv">' + totalPosts + '</div></div>';
    h += '<div class="kpi-box"><div class="kl">Avg Reactions</div><div class="kv">' + avgReactions + '</div></div>';
    h += '<div class="kpi-box"><div class="kl">Avg Comments</div><div class="kv">' + avgComments + '</div></div>';
    h += '<div class="kpi-box"><div class="kl">Avg Length</div><div class="kv">' + avgLength + '</div><div class="kd neu">chars</div></div>';
    h += '</div>';

    // ── Performance Scatter (Chart.js) ───────────────────────────────────
    if (posts.length > 0) {
      h += '<div class="sec-h">Content Performance Matrix</div>';
      h += '<div class="scatter-legend">';
      h += '<span><span class="dot" style="background:#3fb950"></span> text</span>';
      h += '<span><span class="dot" style="background:#58a6ff"></span> image</span>';
      h += '<span><span class="dot" style="background:#d29922"></span> carousel</span>';
      h += '<span><span class="dot" style="background:#f85149"></span> article</span>';
      h += '</div>';
      h += '<div class="chart-box"><canvas id="chart-scatter" height="280"></canvas></div>';
    }

    // ── Optimal Post Length (Chart.js bar) ────────────────────────────────
    if (buckets.length > 0) {
      h += '<div class="sec-h">Optimal Post Length</div>';
      h += '<div class="chart-box"><canvas id="chart-length" height="200"></canvas></div>';
    }

    // ── Content Type Chart ───────────────────────────────────────────────
    if (ctypes.length > 0) {
      h += '<div class="sec-h">Content Type Breakdown</div>';
      h += '<div class="chart-row">';
      h += '<div class="chart-box"><canvas id="chart-ctype-pie" height="200"></canvas></div>';
      h += '<div class="chart-box"><canvas id="chart-ctype-bar" height="200"></canvas></div>';
      h += '</div>';
    }

    // ── Hashtag Performance ──────────────────────────────────────────────
    h += '<div class="sec-h">Hashtag Performance (' + hashtags.length + ')</div>';
    if (hashtags.length > 0) {
      h += '<table class="pro-tbl"><thead><tr><th>Hashtag</th><th>Uses</th><th>Avg Reactions</th><th>Avg Comments</th></tr></thead><tbody>';
      hashtags.forEach(function(ht) {
        h += '<tr>';
        h += '<td style="font-family:var(--mono);color:var(--blu)">#' + esc(ht.hashtag) + '</td>';
        h += '<td style="font-family:var(--mono)">' + (ht.usage_count || 0) + '</td>';
        h += '<td style="font-family:var(--mono);color:var(--grn)">' + (ht.avg_reactions || 0) + '</td>';
        h += '<td style="font-family:var(--mono)">' + (ht.avg_comments || 0) + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<div class="empty" style="padding:20px">Brak danych hashtagow. Zbierane przez auto-analytics.</div>';
    }

    // ── A/B Comparison ───────────────────────────────────────────────────
    if (posts.length >= 2) {
      h += '<div class="sec-h">A/B Comparison</div>';
      h += '<div class="chart-row">';
      h += '<div class="fg"><label>Post A</label><select class="sel-inline" id="ab-a" style="width:100%;padding:8px">';
      posts.forEach(function(p, i) { h += '<option value="' + i + '">' + esc((p.text_preview || p.post_urn).slice(0, 60)) + '</option>'; });
      h += '</select></div>';
      h += '<div class="fg"><label>Post B</label><select class="sel-inline" id="ab-b" style="width:100%;padding:8px">';
      posts.forEach(function(p, i) { h += '<option value="' + i + '"' + (i === 1 ? ' selected' : '') + '>' + esc((p.text_preview || p.post_urn).slice(0, 60)) + '</option>'; });
      h += '</select></div>';
      h += '</div>';
      h += '<div id="ab-result" class="card" style="font-size:12px"></div>';
    }

    // ── All Posts Table ──────────────────────────────────────────────────
    if (posts.length > 0) {
      h += '<div class="sec-h">All Posts Performance</div>';
      h += '<table class="pro-tbl"><thead><tr><th>#</th><th>Post</th><th>Type</th><th>Len</th><th>Reactions</th><th>Comments</th><th>Eng%</th><th>Link</th></tr></thead><tbody>';
      posts.sort(function(a, b) { return b.total_reactions - a.total_reactions; });
      posts.forEach(function(p, i) {
        var postUrl = p.post_urn ? 'https://www.linkedin.com/feed/update/' + p.post_urn + '/' : '';
        h += '<tr>';
        h += '<td style="font-family:var(--mono)">' + (i + 1) + '</td>';
        h += '<td style="max-width:260px;font-size:11px">' + esc(p.text_preview || '-') + '</td>';
        h += '<td><span class="badge" style="background:rgba(56,139,253,.15);color:var(--blu)">' + esc(p.content_type) + '</span></td>';
        h += '<td style="font-family:var(--mono);font-size:11px">' + (p.post_length || '-') + '</td>';
        h += '<td style="font-family:var(--mono);color:var(--grn)">' + p.total_reactions + '</td>';
        h += '<td style="font-family:var(--mono)">' + p.comment_count + '</td>';
        h += '<td style="font-family:var(--mono);color:var(--yel)">' + (p.engagement_rate || 0) + '%</td>';
        h += '<td>' + (postUrl ? '<a href="' + postUrl + '" target="_blank" style="font-size:11px">LinkedIn</a>' : '-') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    root.innerHTML = h;

    // ── Charts ────────────────────────────────────────────────────────────
    if (typeof Chart === 'undefined') return;

    // Scatter plot
    if (posts.length > 0 && document.getElementById('chart-scatter')) {
      var typeColors = { text: '#3fb950', image: '#58a6ff', carousel: '#d29922', article: '#f85149', video: '#a371f7' };
      var scatterData = posts.filter(function(p) { return p.total_reactions > 0; }).map(function(p) {
        return { x: p.total_reactions, y: p.engagement_rate || 0, r: Math.max(4, Math.min(20, p.total_reactions / 2)), label: p.text_preview?.slice(0, 40), type: p.content_type };
      });
      var byType = {};
      scatterData.forEach(function(d) {
        var t = d.type || 'text';
        if (!byType[t]) byType[t] = [];
        byType[t].push(d);
      });
      var scatterSets = [];
      for (var st in byType) {
        scatterSets.push({
          label: st, data: byType[st],
          backgroundColor: (typeColors[st] || '#8b949e') + '88',
          borderColor: typeColors[st] || '#8b949e',
          borderWidth: 1
        });
      }
      createChart('chart-scatter', 'bubble', [], scatterSets, {
        scales: {
          x: { title: { display: true, text: 'Impressions / Reach', color: '#8b949e' }, ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } },
          y: { title: { display: true, text: 'Engagement %', color: '#8b949e' }, ticks: { color: '#8b949e', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(48,54,61,.5)' } }
        },
        plugins: {
          tooltip: { callbacks: { label: function(ctx) { var d = ctx.raw; return (d.label || '') + ' — ' + d.y + '% eng'; } } }
        }
      });
    }

    // Optimal length
    if (buckets.length > 0 && document.getElementById('chart-length')) {
      var bestBucket = buckets.reduce(function(best, b) { return (b.avg_reactions || 0) > (best.avg_reactions || 0) ? b : best; }, buckets[0]);
      createChart('chart-length', 'bar', buckets.map(function(b) { return b.bucket; }), [{
        label: 'Avg Reactions', data: buckets.map(function(b) { return b.avg_reactions; }),
        backgroundColor: buckets.map(function(b) { return b.bucket === bestBucket.bucket ? 'rgba(63,185,80,.8)' : 'rgba(63,185,80,.3)'; }),
        borderRadius: 4
      }]);
    }

    // Content type pie + bar
    if (ctypes.length > 0) {
      var ctColors = ['#3fb950','#58a6ff','#d29922','#f85149','#a371f7'];
      if (document.getElementById('chart-ctype-pie')) {
        createChart('chart-ctype-pie', 'doughnut', ctypes.map(function(t) { return t.content_type; }), [{
          data: ctypes.map(function(t) { return t.count; }),
          backgroundColor: ctColors.slice(0, ctypes.length), borderWidth: 0
        }], { plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12 } } } });
      }
      if (document.getElementById('chart-ctype-bar')) {
        createChart('chart-ctype-bar', 'bar', ctypes.map(function(t) { return t.content_type; }), [
          { label: 'Avg Reactions', data: ctypes.map(function(t) { return t.avg_reactions; }), backgroundColor: 'rgba(63,185,80,.6)', borderRadius: 4 },
          { label: 'Avg Comments', data: ctypes.map(function(t) { return t.avg_comments; }), backgroundColor: 'rgba(88,166,255,.6)', borderRadius: 4 },
        ]);
      }
    }

    // A/B Comparison handler
    function updateAB() {
      var aIdx = parseInt((document.getElementById('ab-a') || {}).value || '0');
      var bIdx = parseInt((document.getElementById('ab-b') || {}).value || '1');
      var a = posts[aIdx], b = posts[bIdx];
      if (!a || !b) return;
      var res = document.getElementById('ab-result');
      if (!res) return;
      var metrics = ['total_reactions','comment_count','engagement_rate','post_length','hashtag_count'];
      var labels = ['Reactions','Comments','Engagement %','Length','Hashtags'];
      var rh = '<table class="pro-tbl" style="margin:0"><thead><tr><th>Metric</th><th style="color:var(--grn)">Post A</th><th style="color:var(--blu)">Post B</th><th>Winner</th></tr></thead><tbody>';
      metrics.forEach(function(m, mi) {
        var va = a[m] || 0, vb = b[m] || 0;
        var win = va > vb ? 'A' : vb > va ? 'B' : '-';
        var winColor = win === 'A' ? 'var(--grn)' : win === 'B' ? 'var(--blu)' : 'var(--dim)';
        rh += '<tr><td>' + labels[mi] + '</td><td style="font-family:var(--mono)">' + va + '</td><td style="font-family:var(--mono)">' + vb + '</td><td style="font-weight:700;color:' + winColor + '">' + win + '</td></tr>';
      });
      rh += '</tbody></table>';
      res.innerHTML = rh;
    }
    var abA = document.getElementById('ab-a');
    var abB = document.getElementById('ab-b');
    if (abA) { abA.addEventListener('change', updateAB); updateAB(); }
    if (abB) abB.addEventListener('change', updateAB);

  }).catch(function(err) {
    root.innerHTML = '<div class="pg-title">Kontenty</div><div class="empty">Blad: ' + (err.message || err) + '</div>';
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────

// Iter2: przywróć ostatnio wybrany widok Kolejki (Lista/Tydzień)
setPostsView(localStorage.getItem('li_posts_view') || 'list');
renderRutyna();
renderAnalytics();
loadProspekci();

loadStatus();
loadPosts();
switchTab(activeTab);
// Lazy-load active tab on startup
if (activeTab === 'siec') renderSiec();
if (activeTab === 'leady') renderLeady();
if (activeTab === 'kontenty') renderKontenty();
if (activeTab === 'mediaplan') renderMediaPlan();
if (activeTab === 'artykuly') renderArtykuly();
if (activeTab === 'propozycje') loadProposals();

// Refresh button + filter
document.addEventListener('click', function(e) {
  if (e.target.closest && e.target.closest('#prop-refresh')) loadProposals();
  // 🔄 Pobierz cały wątek tego postu z LinkedIn (priorytet)
  var rfb = e.target.closest && e.target.closest('.prop-refetch-btn');
  if (rfb) {
    var purn = rfb.getAttribute('data-post');
    rfb.disabled = true; rfb.textContent = '⏳ Pobieram wątek…';
    fetch('/api/posts/' + encodeURIComponent(purn) + '/fetch-comments', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){ toast(d.error ? ('Błąd: ' + d.error) : (d.info || 'Zlecono'), !d.error); })
      .catch(function(err){ toast('Błąd: ' + err.message); })
      .finally(function(){ rfb.disabled = false; rfb.textContent = '🔄 Pobierz cały wątek z LinkedIn'; });
    return;
  }
  if (e.target.closest && e.target.closest('#fetch-all-comments')) {
    var btn = document.getElementById('fetch-all-comments');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Skanuję wszystkie…'; }
    fetch('/api/comment-engine/fetch-all', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){ toast(d.error ? ('Błąd: ' + d.error) : (d.info || 'Uruchomiono'), !d.error); })
      .catch(function(e){ toast('Błąd: ' + e.message); })
      .finally(function(){ if (btn) { btn.disabled = false; btn.textContent = '📥 Pobierz wszystkie'; } setTimeout(loadEngineHealth, 3000); });
  }
});
document.addEventListener('change', function(e) {
  if (e.target.id === 'prop-filter') loadProposals();
  if (e.target.id === 'prop-show-replied') loadProposals();
});

// ── ARTYKULY (Wariant G-A: article drafter UI) ──────────────────────────
var artTopics = null;

function renderArtykuly() {
  var root = document.getElementById('art-root');
  if (!root) return;
  if (root.dataset.rendered === '1') return;
  root.dataset.rendered = '1';
  root.innerHTML =
    '<div style="max-width:780px">' +
    '<h2 style="margin-top:0">Generator artykułów</h2>' +
    '<p style="color:var(--dim);font-size:14px">Sonnet 4.6 + adaptive thinking + prompt cache. Generuje pełny artykuł PL (~3500 słów) + EN hub-spoke. Output: 2 pliki .ts gotowe do bartoszgaca.pl/data/articles/.</p>' +
    '<form id="art-form" style="display:grid;gap:14px;margin-top:20px">' +
      '<label style="display:grid;gap:4px"><span style="font-weight:600;font-size:13px">Topic</span>' +
        '<select id="art-topic" required style="padding:8px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px"></select>' +
      '</label>' +
      '<label style="display:grid;gap:4px"><span style="font-weight:600;font-size:13px">Word count: <span id="art-words-display">3500</span></span>' +
        '<input type="range" id="art-words" min="500" max="8000" step="500" value="3500">' +
      '</label>' +
      '<label style="display:grid;gap:4px"><span style="font-weight:600;font-size:13px">Language</span>' +
        '<select id="art-lang" style="padding:8px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px">' +
          '<option value="both">PL hero + EN hub-spoke</option>' +
          '<option value="pl">PL only</option>' +
          '<option value="en">EN only</option>' +
        '</select>' +
      '</label>' +
      '<button type="submit" id="art-submit" class="btn primary" style="margin-top:8px">Generate (60-180s)</button>' +
    '</form>' +
    '<div id="art-progress" style="margin-top:20px"></div>' +
    '<div id="art-result" style="margin-top:20px"></div>' +
    '<hr style="border:none;border-top:1px solid var(--border);margin:30px 0">' +
    '<h3 style="margin:0 0 10px">Saved drafts</h3>' +
    '<div id="art-drafts"></div>' +
    '</div>';

  var topicSel = document.getElementById('art-topic');
  var wordsRange = document.getElementById('art-words');
  var wordsDisp = document.getElementById('art-words-display');
  var langSel = document.getElementById('art-lang');
  var form = document.getElementById('art-form');
  var btn = document.getElementById('art-submit');
  var progress = document.getElementById('art-progress');
  var resultDiv = document.getElementById('art-result');
  var draftsDiv = document.getElementById('art-drafts');

  wordsRange.addEventListener('input', function() { wordsDisp.textContent = wordsRange.value; });

  // Load topic options
  fetch('/api/content/topic-scores').then(function(r) { return r.json(); }).then(function(rows) {
    artTopics = rows;
    topicSel.innerHTML = '<option value="">-- wybierz topic --</option>' +
      rows.map(function(t) {
        var gap = t.has_existing_article === 0 ? ' ⚡GAP' : '';
        return '<option value="' + t.topic_slug + '">[' + t.score.toFixed(2) + '] ' + (t.topic_label_pl || t.topic_slug) + gap + '</option>';
      }).join('');
  }).catch(function(e) { topicSel.innerHTML = '<option>Error: ' + e.message + '</option>'; });

  // Load saved drafts
  function loadDrafts() {
    fetch('/api/articles/drafts').then(function(r) { return r.json(); }).then(function(rows) {
      if (!Array.isArray(rows) || rows.length === 0) { draftsDiv.innerHTML = '<p style="color:var(--dim);font-size:13px">Brak zapisanych draftów.</p>'; return; }
      draftsDiv.innerHTML = rows.map(function(d) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px">' +
               '<div><code>' + d.filename + '</code> <span style="color:var(--dim);font-size:12px">' + Math.round(d.size_bytes / 1024) + ' KB · ' + d.mtime.slice(0,16).replace('T', ' ') + '</span></div>' +
               '<a href="/api/articles/draft/' + d.slug + '" download style="font-size:12px">Download .ts</a>' +
               '</div>';
      }).join('');
    });
  }
  loadDrafts();

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var slug = topicSel.value;
    if (!slug) { progress.innerHTML = '<p style="color:#f55">Wybierz topic.</p>'; return; }
    btn.disabled = true; btn.textContent = 'Generating... (this takes 60-180s, dont close)';
    progress.innerHTML = '<p style="color:var(--dim)">⏳ Calling Claude... | topic=<code>' + slug + '</code> words=' + wordsRange.value + ' lang=' + langSel.value + '</p>';
    resultDiv.innerHTML = '';
    var t0 = Date.now();
    fetch('/api/articles/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_slug: slug, words: parseInt(wordsRange.value, 10), lang: langSel.value }),
    }).then(function(r) { return r.json(); }).then(function(res) {
      var dt = ((Date.now() - t0) / 1000).toFixed(1);
      btn.disabled = false; btn.textContent = 'Generate (60-180s)';
      if (res.error) {
        progress.innerHTML = '<p style="color:#f55">❌ Failed in ' + dt + 's: ' + res.error + '</p>' +
                             '<pre style="background:#222;padding:10px;font-size:11px;overflow:auto;max-height:300px">' + (res.stderr || res.message || '').replace(/[<>&]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }) + '</pre>';
        return;
      }
      progress.innerHTML = '<p style="color:#3a3">✅ Generated in ' + dt + 's. Model: <code>' + (res.usage && res.usage.model || '?') + '</code> · in/cached/out: ' + (res.usage && res.usage.input_tokens || 0) + '/' + (res.usage && res.usage.cache_read_input_tokens || 0) + '/' + (res.usage && res.usage.output_tokens || 0) + ' tokens</p>';
      var html =
        '<div style="display:grid;gap:14px">' +
        '<div style="border:1px solid var(--border);padding:14px;border-radius:6px">' +
          '<h3 style="margin:0 0 6px">PL: ' + (res.title_pl || '?') + '</h3>' +
          '<p style="color:var(--dim);font-size:13px;margin:0 0 8px">slug: <code>' + (res.slug_pl || '?') + '</code> · ' + (res.pl_ts ? Math.round(res.pl_ts.length / 1024) : 0) + ' KB</p>' +
          '<p style="font-size:13px;font-style:italic">' + (res.excerpt_pl || '') + '</p>' +
          '<a href="/api/articles/draft/' + (res.slug_pl || '') + '" download class="btn">Download PL .ts</a>' +
        '</div>' +
        '<div style="border:1px solid var(--border);padding:14px;border-radius:6px">' +
          '<h3 style="margin:0 0 6px">EN: ' + (res.title_en || '?') + '</h3>' +
          '<p style="color:var(--dim);font-size:13px;margin:0 0 8px">slug: <code>' + (res.slug_en || '?') + '</code> · ' + (res.en_ts ? Math.round(res.en_ts.length / 1024) : 0) + ' KB</p>' +
          '<p style="font-size:13px;font-style:italic">' + (res.excerpt_en || '') + '</p>' +
          '<a href="/api/articles/draft/' + (res.slug_en || '') + '" download class="btn">Download EN .ts</a>' +
        '</div>' +
        '<details><summary style="cursor:pointer;color:var(--dim);font-size:12px">Server log</summary><pre style="background:#222;padding:10px;font-size:11px;overflow:auto;max-height:200px">' + (res.log || '').replace(/[<>&]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }) + '</pre></details>' +
        '</div>';
      resultDiv.innerHTML = html;
      loadDrafts();
    }).catch(function(e) {
      btn.disabled = false; btn.textContent = 'Generate (60-180s)';
      progress.innerHTML = '<p style="color:#f55">Network error: ' + e.message + '</p>';
    });
  });
}

setInterval(function() { loadStatus(); loadPosts(); }, 30000);
setInterval(function() { if (activeTab === 'prospekci') loadProspekci(); }, 60000);
setInterval(function() { if (activeTab === 'analytics') renderAnalytics(); }, 120000);
setInterval(function() { if (activeTab === 'siec') renderSiec(); }, 120000);
setInterval(function() { if (activeTab === 'leady') renderLeady(); }, 120000);
setInterval(function() { if (activeTab === 'kontenty') renderKontenty(); }, 120000);
setInterval(function() { if (activeTab === 'propozycje') loadProposals(); }, 30000);
setInterval(function() { if (activeTab === 'watki') loadWatki(); }, 30000);

// ── WATKI (thread memory) ──────────────────────────────────────────────────
function watkiQuery() {
  var q = (document.getElementById('w-q')||{}).value || '';
  var reply = (document.getElementById('w-reply')||{}).value || 'all';
  var since = (document.getElementById('w-since')||{}).value || '';
  var sort = (document.getElementById('w-sort')||{}).value || 'published_desc';
  var p = new URLSearchParams();
  if (q) p.set('q', q);
  if (reply !== 'all') p.set('has_reply', reply);
  if (since) p.set('since', since);
  if (sort) p.set('sort', sort);
  return p.toString();
}

function loadWatki() {
  var qs = watkiQuery();
  Promise.all([
    fetch('/api/threads' + (qs ? '?' + qs : '')).then(function(r) { return r.json(); }),
    fetch('/api/playwright-cycles').then(function(r) { return r.json(); })
  ]).then(function(arr) {
    var threads = arr[0] || [];
    var cycles = arr[1] || [];
    renderWatki(threads, cycles);
  }).catch(function(e) {
    var el = document.getElementById('watki-list');
    if (el) el.innerHTML = '<p style="color:var(--red)">Błąd: ' + e.message + '</p>';
  });
}

var watkiDebounce;
function wireWatkiFilters() {
  ['w-q','w-reply','w-since','w-sort'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el || el._wired) return;
    el._wired = true;
    var evt = (id === 'w-q' || id === 'w-since') ? 'input' : 'change';
    el.addEventListener(evt, function() {
      clearTimeout(watkiDebounce);
      watkiDebounce = setTimeout(loadWatki, 300);
    });
  });
  var clr = document.getElementById('w-clear');
  if (clr && !clr._wired) {
    clr._wired = true;
    clr.addEventListener('click', function() {
      ['w-q','w-since'].forEach(function(id) { var e = document.getElementById(id); if (e) e.value = ''; });
      var r = document.getElementById('w-reply'); if (r) r.value = 'all';
      var s = document.getElementById('w-sort'); if (s) s.value = 'published_desc';
      loadWatki();
    });
  }
}

function renderWatki(threads, cycles) {
  var cnt = document.getElementById('watki-count');
  var list = document.getElementById('watki-list');
  var cyclesEl = document.getElementById('watki-cycles');
  var lastEl = document.getElementById('watki-last-cycle');
  if (!cnt || !list) return;

  cnt.textContent = threads.length + ' wątków';
  wireWatkiFilters();

  // Cykl info
  var lastCycle = cycles[0];
  if (lastCycle && lastEl) {
    lastEl.textContent = 'Ostatni cykl: ' + (lastCycle.ended_at || 'w toku') +
      ' (sprawdzono ' + lastCycle.posts_checked + ' postów, ' + lastCycle.proposals_created + ' propozycji)';
  }

  // Tabela cykli (ostatnie 5)
  if (cyclesEl) {
    if (cycles.length === 0) {
      cyclesEl.innerHTML = '<div style="font-size:12px;color:var(--dim);padding:8px;border:1px dashed var(--brd);border-radius:6px">Brak uruchomień Playwright — uruchom: <code style="background:var(--card);padding:2px 6px;border-radius:3px">node auto-comment-playwright.mjs --once</code></div>';
    } else {
      cyclesEl.innerHTML = '<div style="font-size:11px;color:var(--dim);margin-bottom:6px">Ostatnie cykle Playwright:</div>' +
        '<table style="width:100%;font-size:11px;border-collapse:collapse">' +
        '<tr style="border-bottom:1px solid var(--brd)"><th style="text-align:left;padding:4px">Start</th><th>Posts</th><th>Propozycje</th><th>Errors</th><th>Notes</th></tr>' +
        cycles.slice(0, 5).map(function(c) {
          var color = c.errors > 0 ? 'var(--red)' : 'var(--grn)';
          return '<tr style="border-bottom:1px solid var(--brd)">' +
            '<td style="padding:4px">' + (c.started_at||'?').slice(0,16) + '</td>' +
            '<td style="text-align:center">' + (c.posts_checked||0) + '</td>' +
            '<td style="text-align:center;color:var(--blu)">' + (c.proposals_created||0) + '</td>' +
            '<td style="text-align:center;color:' + color + '">' + (c.errors||0) + '</td>' +
            '<td style="font-size:10px;color:var(--dim)">' + ((c.notes||'').slice(0,50)) + '</td>' +
            '</tr>';
        }).join('') + '</table>';
    }
  }

  // Lista wątków
  if (!threads.length) {
    list.innerHTML = '<p style="color:var(--dim);text-align:center;padding:40px">Brak zeskrapowanych wątków. Playwright daemon zaczyna pracę po pierwszym cyklu.</p>';
    return;
  }

  list.innerHTML = threads.map(function(t) {
    var ourReplies = [];
    try { ourReplies = JSON.parse(t.our_replies_json || '[]'); } catch {}
    var thread = [];
    try { thread = JSON.parse(t.thread_json || '[]'); } catch {}

    return '<div class="watki-card" style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:12px;color:var(--dim)">Autor postu:</span>' +
      '<b>' + esc(t.post_author || '?') + '</b>' +
      (t.post_published_at
        ? '<span style="margin-left:auto;font-size:11px;color:var(--txt)" title="Data publikacji posta">📅 ' + esc(t.post_published_at.slice(0,16)) + '</span>'
        : '<span style="margin-left:auto;font-size:11px;color:var(--yel)" title="Brak prawdziwej daty publikacji — fallback na scrape">⏰ ' + esc((t.last_scraped_at||'').slice(0,16)) + '</span>') +
      (t.post_published_at && t.last_scraped_at ? '<span style="font-size:10px;color:var(--dim)" title="Ostatni scrape">· ' + esc(t.last_scraped_at.slice(11,16)) + '</span>' : '') +
      '<span style="background:var(--blu);color:#fff;padding:2px 6px;border-radius:4px;font-size:10px">' + thread.length + ' komentarzy</span>' +
      '</div>' +
      '<div style="background:var(--bg);padding:8px;border-radius:4px;font-size:12px;color:var(--dim);margin-bottom:8px;max-height:60px;overflow:hidden">' +
      esc((t.post_text||'(brak treści posta)').slice(0,250)) + '</div>' +
      (ourReplies.length > 0
        ? '<div style="font-size:11px;color:var(--grn);margin-top:6px">✅ Twoje odpowiedzi w wątku: ' + ourReplies.length + '</div>'
        : '<div style="font-size:11px;color:var(--yel);margin-top:6px">⏳ Brak twoich odpowiedzi</div>') +
      '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn sm watki-tree-btn" data-urn="' + encodeURIComponent(t.post_urn || '') + '" title="Pokaż cały wątek: kto co pisał, kto skomentował, Twój komentarz">📋 Pokaż pełny wątek</button>' +
        '<button class="btn sm watki-fetch-btn" data-urn="' + encodeURIComponent(t.post_urn || '') + '" title="Pobierz najświeższe komentarze tego postu z LinkedIn (priorytet)">🔄 Pobierz świeże</button>' +
        (t.post_url ? '<a href="' + t.post_url + '" target="_blank" style="font-size:11px;color:var(--blu);margin-left:auto">→ Otwórz w LinkedIn</a>' : '') +
      '</div>' +
      '<div class="post-tree" style="display:none;margin-top:8px;border-top:1px solid var(--brd);padding-top:8px"></div>' +
      '</div>';
  }).join('');
}

// Renderuje pełne drzewko (kto co pisał, nesting, mój komentarz) z /api/posts/:urn/comments-tree
function renderPostTree(box, data, postUrn) {
  var tree = (data && data.tree) || [];
  if (!tree.length) { box.innerHTML = '<div style="font-size:11px;color:var(--dim)">Brak komentarzy w bazie. Kliknij „🔄 Pobierz świeże".</div>'; return; }
  box.innerHTML = '<div style="font-size:11px;color:var(--dim);margin-bottom:6px">' + tree.length + ' wpisów w wątku (🟢 = Twój):</div>' +
    tree.map(function(c) {
      var indent = (c.depth || 0) > 0 ? 22 : 0;
      var mine = c.is_our_comment ? 1 : 0;
      var who = mine ? '🟢 Ty' : esc(c.author_name || '?');
      var when = c.comment_created_at ? '<span style="color:var(--dim);font-size:10px"> · ' + esc(String(c.comment_created_at).slice(0,16)) + '</span>' : '';
      var hasUrn = c.comment_urn && c.comment_urn.indexOf('urn:') === 0;
      // Akcja „Odpisz z AI" tylko dla CUDZYCH komentarzy z realnym URN (deterministyczny target)
      var action = (!mine && hasUrn) ? (
        '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<input class="ai-hint" placeholder="opcjonalna wskazówka dla AI…" style="flex:1;font-size:11px;background:var(--card);border:1px solid var(--brd);color:var(--txt);padding:4px 6px;border-radius:4px">' +
          '<button class="btn sm ai-reply-btn" data-curn="' + esc(c.comment_urn) + '" data-post="' + esc(postUrn || '') + '" data-author="' + esc(c.author_name || '') + '">✍️ Odpisz z AI</button>' +
        '</div>' +
        '<div class="ai-result" style="display:none;font-size:11px;margin-top:6px;padding:6px 8px;background:var(--card);border-radius:4px"></div>'
      ) : '';
      return '<div style="margin:4px 0 4px ' + indent + 'px;padding:6px 8px;border-left:2px solid ' + (mine ? 'var(--grn)' : (c.depth ? 'var(--dim)' : 'var(--blu)')) + ';background:var(--bg);border-radius:4px">' +
        '<div style="font-size:11px;font-weight:600;color:' + (mine ? 'var(--grn)' : 'var(--txt)') + '">' + (c.depth ? '↳ ' : '') + who + when + '</div>' +
        '<div style="font-size:12px;color:var(--txt);white-space:pre-wrap;margin-top:2px">' + esc(c.comment_text || '') + '</div>' +
        action +
      '</div>';
    }).join('');
}

document.addEventListener('click', function(e) {
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('#watki-refresh')) { loadWatki(); return; }

  // 📋 Pokaż pełny wątek — pobiera drzewko z DB i renderuje (kto co pisał, mój komentarz)
  var treeBtn = e.target.closest('.watki-tree-btn');
  if (treeBtn) {
    var urn = treeBtn.getAttribute('data-urn');
    var card = treeBtn.closest('.watki-card');
    var box = card && card.querySelector('.post-tree');
    if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; treeBtn.textContent = '📋 Pokaż pełny wątek'; return; }
    box.style.display = 'block'; box.innerHTML = '<div style="font-size:11px;color:var(--dim)">Ładuję wątek…</div>'; treeBtn.textContent = '📋 Ukryj wątek';
    fetch('/api/posts/' + urn + '/comments-tree')
      .then(function(r){ return r.json(); })
      .then(function(d){ renderPostTree(box, d, decodeURIComponent(urn)); })
      .catch(function(err){ box.innerHTML = '<div style="color:var(--red);font-size:11px">Błąd: ' + err.message + '</div>'; });
    return;
  }

  // ✍️ Odpisz z AI — generuje propozycję dla TEGO komentarza (deterministycznie po URN) → Propozycje → Playwright
  var aiBtn = e.target.closest('.ai-reply-btn');
  if (aiBtn) {
    var hintInput = aiBtn.parentElement && aiBtn.parentElement.querySelector('.ai-hint');
    var resultBox = aiBtn.parentElement && aiBtn.parentElement.parentElement.querySelector('.ai-result');
    var payload = {
      comment_urn: aiBtn.getAttribute('data-curn'),
      post_urn: aiBtn.getAttribute('data-post'),
      author: aiBtn.getAttribute('data-author'),
      hint: hintInput ? hintInput.value : ''
    };
    aiBtn.disabled = true; aiBtn.textContent = '⏳ Opus 4.8…';
    fetch('/api/comments/reply-with-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) { toast('Błąd: ' + d.error); return; }
        if (resultBox) {
          resultBox.style.display = 'block';
          resultBox.innerHTML = '<b>' + (d.status === 'blocked' ? '🚫 ' + (d.validation_notes||[]).join(', ') : '✅ Propozycja gotowa') + ':</b><br>' + esc(d.proposed_reply || '') +
            '<br><span style="color:var(--dim)">→ zatwierdź w zakładce „Propozycje" (poleci na Playwright pod ten komentarz)</span>';
        }
        toast(d.status === 'blocked' ? '⚠️ Wygenerowano, ale fact-check oflagował' : '✅ Odpowiedź wygenerowana → Propozycje', d.status !== 'blocked');
      })
      .catch(function(err){ toast('Błąd: ' + err.message); })
      .finally(function(){ aiBtn.disabled = false; aiBtn.textContent = '✍️ Odpisz z AI'; });
    return;
  }

  // 🔄 Pobierz świeże z LinkedIn (priorytet) dla tego konkretnego postu
  var fetchBtn = e.target.closest('.watki-fetch-btn');
  if (fetchBtn) {
    var furn = fetchBtn.getAttribute('data-urn');
    fetchBtn.disabled = true; fetchBtn.textContent = '⏳ Zlecam…';
    fetch('/api/posts/' + furn + '/fetch-comments', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){ toast(d.error ? ('Błąd: ' + d.error) : (d.info || 'Zlecono'), !d.error); })
      .catch(function(err){ toast('Błąd: ' + err.message); })
      .finally(function(){ fetchBtn.disabled = false; fetchBtn.textContent = '🔄 Pobierz świeże'; });
    return;
  }
});

// ── PROPOZYCJE ──────────────────────────────────────────────────────────────

var propFilter = 'pending';

function loadEngineHealth() {
  var el = document.getElementById('engine-health');
  if (!el) return;
  fetch('/api/comment-engine/health').then(function(r){ return r.json(); }).then(function(h) {
    var dot = h.color === 'green' ? '🟢' : h.color === 'yellow' ? '🟡' : '🔴';
    var bg = h.color === 'green' ? 'var(--grn)' : h.color === 'yellow' ? 'var(--yel)' : 'var(--red)';
    el.style.background = bg;
    el.style.color = h.color === 'yellow' ? '#000' : '#fff';
    el.textContent = dot + ' silnik · ' + (h.unanswered || 0) + ' bez odp.';
    var t = 'Silnik komentarzy (Playwright + Opus 4.8)\\n'
      + 'Ostatni cykl: ' + (h.last_run_at || '?') + '\\n'
      + 'Ostatni scrape drzewka: ' + (h.last_scrape_at || '?') + '\\n'
      + 'pending=' + (h.pending||0) + ' blocked=' + (h.blocked||0) + ' nieodpowiedziane=' + (h.unanswered||0) + '\\n'
      + (h.reasons && h.reasons.length ? '⚠️ ' + h.reasons.join('; ') : 'OK');
    el.title = t;
  }).catch(function(){ el.textContent = '⚙️ ?'; });
}

function loadProposals() {
  loadEngineHealth();
  var filter = document.getElementById('prop-filter');
  if (filter) propFilter = filter.value;
  var showReplied = document.getElementById('prop-show-replied');
  var qs = 'status=' + propFilter + (showReplied && showReplied.checked ? '&include_replied=1' : '');
  fetch('/api/proposals?' + qs)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Backend now returns { rows, total, follow_ups }; tolerate stale array shape.
      if (Array.isArray(data)) data = { rows: data, total: data.length, follow_ups: 0 };
      renderProposals(data);
    })
    .catch(function(e) { var el = document.getElementById('prop-list'); if (el) el.innerHTML = '<p style="color:var(--red)">Błąd: ' + e.message + '</p>'; });
}

function renderProposals(payload) {
  var cnt = document.getElementById('prop-count');
  var list = document.getElementById('prop-list');
  if (!cnt || !list) return;
  var proposals = payload.rows || [];
  var pending = proposals.filter(function(p) { return p.status === 'pending'; });
  var followUps = payload.follow_ups || 0;
  var blocked = payload.blocked || 0;
  // Iter3: counter rozszerzony o blocked
  cnt.textContent = pending.length + ' oczekujących'
    + (followUps > 0 ? ' · ' + followUps + ' follow-up' : '')
    + (blocked > 0 ? ' · ' + blocked + ' blocked' : '');
  cnt.style.background = pending.length > 0 ? 'var(--blu)' : 'var(--dim)';
  if (!proposals.length) {
    list.innerHTML = '<p style="color:var(--dim);text-align:center;padding:40px">Brak propozycji' + (followUps > 0 ? ' (' + followUps + ' ukryto — to wątki gdzie już odpowiedziałeś. Zaznacz „pokaż follow-upy" wyżej żeby je zobaczyć.)' : '') + '</p>';
    return;
  }
  list.innerHTML = proposals.map(function(p) {
    var typeIcon = p.type === 'comment' ? '💬' : '✉️';
    var typeLabel = p.type === 'comment' ? 'Komentarz' : 'DM';
    var statusColor = p.status === 'pending' ? 'var(--yel)' :
                      p.status === 'approved' ? 'var(--blu)' :
                      p.status === 'sent' ? 'var(--grn)' :
                      p.status === 'rejected' ? 'var(--dim)' : 'var(--red)';
    var statusLabel = p.status === 'approved' ? '⏳ approved (czeka na Playwright)' :
                      p.status === 'blocked' ? '🚫 blocked' : p.status;
    // Iter3: composite_score pasek 0-10 + rozbicie wymiarów w tooltip
    var cs = p.composite_score != null ? +p.composite_score : 0;
    var csColor = cs >= 7 ? 'var(--grn)' : cs >= 4 ? 'var(--yel)' : 'var(--red)';
    var scoreTooltip = 'L' + (p.lead_score||0) + '/T' + (p.troll_risk||0) + '/E' + (p.engagement_value||0) + '/U' + (p.urgency||0) + ' (lead/troll/eng/urgency, 1-5 each)';
    var scoreBar = ''
      + '<div style="display:flex;align-items:center;gap:6px;margin:6px 0" title="' + scoreTooltip + '">'
      + '<div style="flex:0 0 56px;font-family:var(--mono);color:' + csColor + ';font-weight:700;font-size:12px">' + cs.toFixed(1) + '/10</div>'
      + '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden">'
      + '<div style="width:' + (cs*10) + '%;height:100%;background:' + csColor + '"></div>'
      + '</div>'
      + '<div style="flex:0 0 auto;font-size:10px;color:var(--dim);font-family:var(--mono)">L' + (p.lead_score||0) + ' T' + (p.troll_risk||0) + ' E' + (p.engagement_value||0) + (p.urgency ? ' U' + p.urgency : '') + '</div>'
      + '</div>';
    // Iter3: blocked badge + validation notes tooltip
    var blockedBadge = '';
    if (p.status === 'blocked') {
      var notesArr = [];
      try { notesArr = JSON.parse(p.validation_notes || '[]'); } catch (e) {}
      var notesText = notesArr.join(', ') || 'walidacja failed';
      blockedBadge = '<span style="font-size:10px;background:var(--red);color:#fff;padding:2px 6px;border-radius:3px;margin-left:6px" title="' + esc(notesText) + '">🚫 ' + esc(notesArr.slice(0, 2).join('+') || 'blocked') + '</span>';
    }
    var temp = p.temperature || 0;
    var tempColor = temp >= 4 ? 'var(--red)' : temp >= 3 ? 'var(--yel)' : temp >= 2 ? 'var(--blu)' : 'var(--dim)';
    var toneIcon = ({formal:'🎩',casual:'👋',ironic:'😏',empathetic:'💙',technical:'⚙️',provocative:'🔥',neutral:'⚪'})[p.tone] || '';
    var metaBar = (temp || p.tone || p.reasoning) ? (
      '<div style="font-size:11px;color:var(--dim);background:var(--bg);padding:6px 8px;border-radius:4px;margin-top:8px;border-left:2px solid ' + tempColor + '">' +
        (temp ? '<span style="color:' + tempColor + '">🌡️ ' + temp + '/5</span>' : '') +
        (p.tone ? ' · <span>' + toneIcon + ' ' + esc(p.tone) + '</span>' : '') +
        (p.reasoning ? '<div style="margin-top:4px;color:var(--txt);font-size:11px">💡 ' + esc(p.reasoning) + '</div>' : '') +
        (function() {
          if (!p.context_used) return '';
          var arr = []; try { arr = JSON.parse(p.context_used); } catch (e) {}
          if (!Array.isArray(arr) || !arr.length) return '';
          return '<div style="margin-top:4px;font-size:10px">📚 ' + arr.map(function(x){ return esc(String(x)); }).join(' · ') + '</div>';
        })() +
      '</div>'
    ) : '';
    var parentBar = p.parent_in_tree && p.parent_in_tree !== p.source_id ? (
      '<div style="font-size:10px;color:var(--dim);margin-top:4px">↳ parent w drzewku: ' + esc((p.parent_in_tree||'').slice(0,80)) + '</div>'
    ) : '';
    var datesBar = (p.comment_created_at || p.post_created_at || p.approved_at) ? (
      '<div style="font-size:10px;color:var(--dim);margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap">' +
        (p.comment_created_at ? '💬 komentarz: ' + esc(p.comment_created_at.slice(0,16)) : '') +
        (p.post_created_at ? ' · 📅 post: ' + esc(p.post_created_at.slice(0,16)) : '') +
        (p.approved_at ? ' · ✅ zatwierdzono: ' + esc(p.approved_at.slice(0,16)) : '') +
        (p.sent_at ? ' · 📤 wysłano: ' + esc(p.sent_at.slice(0,16)) : '') +
      '</div>'
    ) : '';
    var actions = p.status === 'pending' ? (
      '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn sm primary" onclick="sendProposal(' + p.id + ')">✅ Zatwierdź (Playwright wyśle)</button>' +
      '<button class="btn sm" onclick="rejectProposal(' + p.id + ')" style="background:var(--red);border-color:var(--red)">✗ Odrzuć</button>' +
      '</div>'
    ) : '<div style="margin-top:8px;font-size:11px;color:' + statusColor + '">' + statusLabel + (p.sent_at ? ' · ' + p.sent_at.slice(0,16) : '') + '</div>';
    var postLink = p.post_urn ? 'https://www.linkedin.com/feed/update/' + encodeURIComponent(p.post_urn) + '/' : null;
    var linkBar = postLink ? '<a href="' + postLink + '" target="_blank" rel="noopener" style="color:var(--blu);font-size:11px;text-decoration:none;margin-right:8px;display:inline-block;margin-bottom:6px">🔗 Otwórz post w LinkedIn</a>' : '';
    var refetchBtn = p.post_urn ? '<button class="btn sm prop-refetch-btn" data-post="' + esc(p.post_urn) + '" title="Pobierz ponownie CAŁY wątek tego postu z LinkedIn (priorytet) — odśwież drzewko/flagi" style="font-size:11px;margin-bottom:6px">🔄 Pobierz cały wątek z LinkedIn</button>' : '';
    var postPreview = p.post_text ? (
      '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11px;color:var(--dim);background:var(--bg);padding:6px 8px;border-radius:4px;border-left:2px solid var(--blu)"><b>📝 Post</b> — ' + esc((p.post_text||'').slice(0,100)) + (p.post_text.length > 100 ? '…' : '') + '</summary>' +
      '<div style="font-size:12px;color:var(--txt);background:var(--bg);padding:8px;border-radius:0 0 4px 4px;white-space:pre-wrap;border-left:2px solid var(--blu)">' + esc(p.post_text||'') + '</div></details>'
    ) : '';
    var treeBox = '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11px;color:var(--blu);padding:4px 0">🌳 Pokaż drzewko wątku (kto co napisał)</summary><div id="tree-' + p.id + '" style="font-size:11px;color:var(--dim);background:var(--bg);padding:8px;border-radius:4px;margin-top:4px" onclick="loadProposalTree(' + p.id + ')">Kliknij żeby załadować…</div></details>';
    var edited = p.original_reply && p.original_reply !== p.proposed_reply;
    var editedBadge = edited ? '<span style="font-size:10px;background:var(--yel);color:#000;padding:2px 6px;border-radius:3px;margin-left:6px">✏️ edytowano</span>' : '';
    var alreadyBadge = p.already_replied_in_thread ? '<span style="font-size:10px;background:var(--red);color:#fff;padding:2px 6px;border-radius:3px;margin-left:6px" title="W tym wątku jest już Twoja wypowiedź — to byłaby kolejna odpowiedź (follow-up).">⚠️ już odpowiedziałeś</span>' : '';
    var revertBtn = (edited && p.status === 'pending') ? '<button class="btn sm" onclick="revertProposal(' + p.id + ')" style="background:var(--dim);border-color:var(--dim);font-size:11px">↺ Przywróć oryginał Claude</button>' : '';
    // „Twoja wskazówka → AI pisze treść" (Opus 4.8 + fact-check) — dla pending i blocked
    var regenBox = (p.status === 'pending' || p.status === 'blocked') ? (
      '<div style="margin-top:8px;display:flex;gap:6px;align-items:flex-start">' +
      '<input id="prop-hint-' + p.id + '" placeholder="💡 Twoja wskazówka / kierunek (opcjonalnie) — np. krócej, bardziej technicznie, dorzuć wątek X" style="flex:1;background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:7px 8px;border-radius:4px;font-size:12px">' +
      '<button class="btn sm" id="prop-regen-' + p.id + '" onclick="regenerateProposal(' + p.id + ')" style="white-space:nowrap">✨ Przepisz (Opus 4.8)</button>' +
      '</div>'
    ) : '';
    return '<div style="background:var(--card);border:1px solid var(--brd);border-radius:8px;padding:14px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span>' + typeIcon + ' ' + typeLabel + '</span>' +
      '<span style="color:var(--dim);font-size:11px">od: <b>' + esc(p.source_author||'?') + '</b></span>' +
      editedBadge +
      alreadyBadge +
      blockedBadge +
      '<span style="margin-left:auto;font-size:11px;color:' + statusColor + '">' + statusLabel + '</span>' +
      '</div>' +
      linkBar + refetchBtn +
      datesBar +
      postPreview +
      treeBox +
      '<div style="background:var(--bg);padding:8px;border-radius:4px;font-size:12px;color:var(--dim);margin-bottom:8px;max-height:60px;overflow:hidden">' + esc((p.source_text||'').slice(0,200)) + '</div>' +
      scoreBar +
      parentBar +
      '<div style="margin-top:8px">' +
      '<label style="font-size:11px;color:var(--dim)">Propozycja odpowiedzi' + (edited ? ' <span style="color:var(--yel)">(edytowana)</span>' : '') + ':</label>' +
      '<textarea id="prop-reply-' + p.id + '" style="width:100%;min-height:80px;margin-top:4px;background:var(--bg);border:1px solid var(--brd);color:var(--txt);padding:8px;border-radius:4px;font-size:12px;resize:vertical" ' + (p.status !== 'pending' ? 'readonly' : '') + '>' + esc(p.proposed_reply||'') + '</textarea>' +
      (revertBtn ? '<div style="margin-top:4px">' + revertBtn + '</div>' : '') +
      regenBox +
      '</div>' +
      metaBar +
      actions +
      '</div>';
  }).join('');
}

function sendProposal(id) {
  var textarea = document.getElementById('prop-reply-' + id);
  var text = textarea ? textarea.value : '';
  if (!text.trim()) { toast('Treść odpowiedzi jest pusta'); return; }
  // Najpierw zapisz edycję
  fetch('/api/proposals/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposed_reply: text })
  }).then(function() {
    return fetch('/api/proposals/' + id + '/send', { method: 'POST' });
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) { toast('Błąd: ' + data.error); return; }
    if (data.manual) {
      navigator.clipboard.writeText(data.copy_text || '').catch(function(){});
      toast('DM: Tekst skopiowany! Otwórz LinkedIn Messaging ✅', true);
      window.open(data.url, '_blank');
    } else {
      toast('Wysłano komentarz! ✅', true);
    }
    loadProposals();
  }).catch(function(e) { toast('Błąd: ' + e.message); });
}

function rejectProposal(id) {
  if (!confirm('Odrzucić tę propozycję?')) return;
  fetch('/api/proposals/' + id + '/reject', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function() { toast('Odrzucono', true); loadProposals(); })
    .catch(function(e) { toast('Błąd: ' + e.message); });
}

function revertProposal(id) {
  if (!confirm('Przywrócić oryginalną odpowiedź Claude?')) return;
  fetch('/api/proposals/' + id + '/revert', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { toast('Błąd: ' + data.error); return; }
      var ta = document.getElementById('prop-reply-' + id);
      if (ta) ta.value = data.proposed_reply || '';
      toast('Przywrócono oryginał', true);
      loadProposals();
    }).catch(function(e) { toast('Błąd: ' + e.message); });
}

// „Twoja wskazówka → AI pisze treść" (Opus 4.8 + fact-check)
function regenerateProposal(id) {
  var hintEl = document.getElementById('prop-hint-' + id);
  var btn = document.getElementById('prop-regen-' + id);
  var ta = document.getElementById('prop-reply-' + id);
  var hint = hintEl ? hintEl.value : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Opus 4.8 pisze…'; }
  if (ta) ta.style.opacity = '0.5';
  fetch('/api/proposals/' + id + '/regenerate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hint: hint })
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { toast('Błąd: ' + d.error); return; }
      if (ta) ta.value = d.proposed_reply || '';
      if (d.status === 'blocked') toast('⚠️ Przepisano, ale fact-check oflagował: ' + (d.validation_notes || []).join(', '));
      else toast('✅ Przepisane przez Opus 4.8' + (d.hint_used ? ' (wg wskazówki)' : ''), true);
      loadProposals();
    }).catch(function(e) { toast('Błąd: ' + e.message); })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Przepisz (Opus 4.8)'; }
      if (ta) ta.style.opacity = '1';
    });
}

var treeLoaded = {};
function loadProposalTree(id) {
  if (treeLoaded[id]) return;
  treeLoaded[id] = true;
  var box = document.getElementById('tree-' + id);
  if (!box) return;
  box.innerHTML = 'Ładuję...';
  fetch('/api/proposals/' + id + '/context')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { box.innerHTML = '<span style="color:var(--red)">' + esc(data.error) + '</span>'; return; }
      var html = '';
      html += '<div style="margin-bottom:8px"><b>Autor postu:</b> ' + esc(data.post_author||'') + '</div>';
      if (!data.tree || !data.tree.length) {
        html += '<div style="color:var(--dim)">(brak komentarzy w drzewku — backfill nie zescrapował tego wątku)</div>';
      } else {
        data.tree.forEach(function(c) {
          var indent = c.depth > 0 ? 'margin-left:24px;border-left:2px solid var(--brd);padding-left:8px' : '';
          var bg = c.is_target ? 'background:rgba(255,200,0,0.15);' : '';
          var label = c.is_our_comment ? '<span style="color:var(--grn)">[TY] </span>' : (c.is_target ? '<span style="color:var(--yel)">[ODPOWIADASZ] </span>' : '');
          var when = c.comment_created_at ? '<span style="color:var(--dim);font-size:10px;margin-left:6px">' + esc((c.comment_created_at||'').slice(0,16)) + '</span>' : '';
          html += '<div style="' + indent + bg + 'padding:6px 8px;margin:4px 0;border-radius:4px">' +
            '<div>' + label + '<b>' + esc(c.author_name||'?') + '</b>' + when + '</div>' +
            '<div style="margin-top:2px;color:var(--txt);white-space:pre-wrap;font-size:11px">' + esc(c.comment_text||'') + '</div>' +
            '</div>';
        });
      }
      box.innerHTML = html;
    }).catch(function(e) { box.innerHTML = '<span style="color:var(--red)">Błąd: ' + esc(e.message) + '</span>'; });
}

function esc(s) { return (s||'').replace(/[<>&"]/g, function(c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
`;
}

// ── Server ───────────────────────────────────────────────────────────────────

migrateDb();

const server = createServer(handleRequest);
server.listen(PORT, function() {
  console.log('LinkedIn Scheduler Dashboard v2: http://localhost:' + PORT);
  console.log('Features: bilingual PL/EN, images, auto-comment preview, expand/collapse');
});
