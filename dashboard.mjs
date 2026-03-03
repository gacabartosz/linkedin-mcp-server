#!/usr/bin/env node
/**
 * LinkedIn Scheduler Dashboard v2
 * Localhost web UI with bilingual PL/EN support, auto-comment preview,
 * expand/collapse, and Google Translate-style edit modal.
 *
 * Usage: node dashboard.mjs
 * Opens: http://localhost:3000
 */

import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const PORT = 3000;
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';

// ── Language detection ───────────────────────────────────────────────────────

const PL_REGEX = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|zbudowal|narzedzi|mozesz|najwaz|klientow|Wklejasz|Opublikowal|automatyzacj|algorytm|harmonogram|szablonow|komentarze|publikuje/i;

function detectLanguage(text) {
  return PL_REGEX.test(text) ? 'pl' : 'en';
}

// ── Auto-comment lookup (same as auto-publish.mjs) ──────────────────────────

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
  'This post published itself': 'post5',
  'Opublikowalem jedyny open-source MCP server': 'post6',
  'Write a thought leadership post about AI automation': 'post7',
  '48 hours. 25 MCP tools': 'post8',
  'MCP (Model Context Protocol) to najwazniejsza zmiana': 'post9',
  'read about the LinkedIn algorithm. I coded it': 'post10',
  'content management stack as a solo founder': 'post11',
  '3 weeks ago I published my first post': 'post12',
  'Schedule a thought leadership post for Thursday': 'post3',
  'most powerful signal on LinkedIn': 'post4',
  'built an MCP server that runs 33 SEO audits': 'post13',
  '69 free AI models. 11 providers': 'post14',
  'This post was written on Sunday': 'post15',
  'Wklejasz dane klientow do ChatGPT': 'post16',
  'MCP servers for LinkedIn AND Facebook': 'post17',
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

// ── DB helpers ───────────────────────────────────────────────────────────────

function getDb(readonly = true) {
  return new Database(DB_PATH, { readonly });
}

function migrateDb() {
  const db = new Database(DB_PATH);
  // Add new columns (ignore if already exist)
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN language TEXT"); } catch {}
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN text_alt TEXT"); } catch {}

  // Auto-detect language for existing posts
  const posts = db.prepare("SELECT id, text FROM scheduled_posts WHERE language IS NULL").all();
  const stmt = db.prepare("UPDATE scheduled_posts SET language = ? WHERE id = ?");
  for (const p of posts) {
    stmt.run(detectLanguage(p.text), p.id);
  }
  if (posts.length > 0) console.log(`Auto-detected language for ${posts.length} posts`);
  db.close();
}

function getAuth() {
  if (!existsSync(AUTH_PATH)) return null;
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf-8')); } catch { return null; }
}

function getDaemonPid() {
  try {
    const out = execSync('pgrep -f "node.*auto-publish\\.mjs"', { encoding: 'utf-8' }).trim();
    return out.split('\n')[0] || null;
  } catch { return null; }
}

function callMCP(toolName, args) {
  return new Promise((resolve, reject) => {
    const msgs = [
      JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'dashboard',version:'2.0'}}}),
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

    proc.on('close', () => { if (!resolved) reject(new Error('No MCP response')); });
    proc.stdin.write(msgs);
    proc.stdin.end();
    setTimeout(() => { if (!resolved) { resolved = true; proc.kill(); reject(new Error('Timeout')); } }, 60000);
  });
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

function matchRoute(url, pattern) {
  const urlParts = url.split('/');
  const patParts = pattern.split('/');
  if (urlParts.length !== patParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = urlParts[i];
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  try {
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
      const db = getDb();
      let posts;
      if (status) {
        posts = db.prepare("SELECT * FROM scheduled_posts WHERE status = ? ORDER BY publish_at ASC").all(status);
      } else {
        posts = db.prepare("SELECT * FROM scheduled_posts ORDER BY publish_at ASC").all();
      }
      db.close();
      // Enrich with auto-comment
      posts.forEach(p => { p.auto_comment = getAutoComment(p.text); });
      return json(res, posts);
    }

    // POST /api/posts — create new
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
      post.auto_comment = getAutoComment(post.text);
      return json(res, post, 201);
    }

    // GET /api/posts/:id
    let params = matchRoute(path, '/api/posts/:id');

    // POST /api/posts/:id/publish (check BEFORE generic :id routes)
    const pubParams = matchRoute(path, '/api/posts/:id/publish');
    if (method === 'POST' && pubParams) {
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(pubParams.id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      db.close();

      try {
        const createArgs = { text: post.text };
        if (post.media_ids) {
          const ids = JSON.parse(post.media_ids);
          if (ids.length > 0) createArgs.media_ids = ids;
        }
        const result = await callMCP('linkedin_post_create', createArgs);

        const dbw = getDb(false);
        dbw.prepare("UPDATE scheduled_posts SET status = 'published', post_urn = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?")
          .run(result.post_urn, new Date().toISOString(), pubParams.id);
        dbw.close();
        return json(res, { ok: true, post_urn: result.post_urn });
      } catch (err) {
        return json(res, { error: err.message }, 500);
      }
    }

    if (method === 'GET' && params) {
      const db = getDb();
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(params.id);
      db.close();
      if (!post) return json(res, { error: 'Not found' }, 404);
      post.auto_comment = getAutoComment(post.text);
      return json(res, post);
    }

    // PUT /api/posts/:id
    if (method === 'PUT' && params) {
      const body = await parseBody(req);
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(params.id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      const text = body.text ?? post.text;
      const publish_at = body.publish_at ?? post.publish_at;
      const visibility = body.visibility ?? post.visibility;
      const language = body.language ?? post.language ?? detectLanguage(text);
      const text_alt = body.text_alt !== undefined ? body.text_alt : post.text_alt;
      db.prepare("UPDATE scheduled_posts SET text = ?, publish_at = ?, visibility = ?, language = ?, text_alt = ?, updated_at = datetime('now') WHERE id = ?")
        .run(text, publish_at, visibility, language, text_alt, params.id);
      const updated = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(params.id);
      db.close();
      updated.auto_comment = getAutoComment(updated.text);
      return json(res, updated);
    }

    // DELETE /api/posts/:id
    if (method === 'DELETE' && params) {
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(params.id);
      if (!post) { db.close(); return json(res, { error: 'Not found' }, 404); }
      db.prepare("UPDATE scheduled_posts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(params.id);
      db.close();
      return json(res, { ok: true });
    }

    // GET / — serve dashboard HTML
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}

// ── Dashboard HTML ───────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinkedIn Scheduler</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
  a { color: #58a6ff; }

  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header h1 span { color: #58a6ff; }

  .status-bar { display: flex; gap: 16px; align-items: center; font-size: 13px; flex-wrap: wrap; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
  .status-dot.green { background: #3fb950; }
  .status-dot.red { background: #f85149; }
  .status-dot.yellow { background: #d29922; }
  .status-item { display: flex; align-items: center; gap: 4px; color: #8b949e; }

  .container { max-width: 1100px; margin: 0 auto; padding: 24px; }

  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .toolbar .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer; font-size: 13px; transition: 0.15s; }
  .btn:hover { background: #30363d; }
  .btn.primary { background: #238636; border-color: #238636; }
  .btn.primary:hover { background: #2ea043; }
  .btn.danger { color: #f85149; }
  .btn.danger:hover { background: #da363326; }
  .btn.active { background: #388bfd26; border-color: #388bfd; color: #58a6ff; }
  .btn.sm { padding: 4px 10px; font-size: 12px; }

  .counts { display: flex; gap: 12px; margin-bottom: 16px; font-size: 13px; color: #8b949e; flex-wrap: wrap; }
  .counts span { background: #161b22; padding: 4px 10px; border-radius: 12px; border: 1px solid #30363d; }
  .counts .c-scheduled { color: #58a6ff; }
  .counts .c-published { color: #3fb950; }
  .counts .c-failed { color: #f85149; }
  .counts .c-cancelled { color: #8b949e; }

  .post-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px; transition: 0.15s; }
  .post-card:hover { border-color: #484f58; }
  .post-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }
  .post-meta { font-size: 12px; color: #8b949e; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.scheduled { background: #388bfd26; color: #58a6ff; }
  .badge.published { background: #2ea04326; color: #3fb950; }
  .badge.failed { background: #da363326; color: #f85149; }
  .badge.cancelled { background: #30363d; color: #8b949e; }
  .badge.publishing { background: #d2992226; color: #d29922; }
  .badge.lang-en { background: #388bfd26; color: #58a6ff; font-weight: 700; }
  .badge.lang-pl { background: #da363326; color: #f85149; font-weight: 700; }
  .badge.bilingual { background: #d2992226; color: #d29922; font-size: 10px; }

  .post-text { font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 80px; overflow: hidden; position: relative; color: #c9d1d9; cursor: pointer; transition: max-height 0.3s; }
  .post-text.expanded { max-height: 2000px; }
  .expand-toggle { font-size: 12px; color: #58a6ff; cursor: pointer; margin-top: 4px; display: inline-block; }
  .expand-toggle:hover { text-decoration: underline; }

  .auto-comment { font-size: 12px; color: #6e7681; margin-top: 8px; padding: 8px 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #30363d; }
  .auto-comment-label { color: #8b949e; font-weight: 500; margin-bottom: 2px; }

  .post-actions { display: flex; gap: 8px; margin-top: 12px; }

  /* Modal */
  .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 100; }
  .modal-overlay.open { display: flex; }
  .modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; width: 920px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }
  .modal h2 { font-size: 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }

  .bilingual-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .lang-col { display: flex; flex-direction: column; }
  .lang-col label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #8b949e; margin-bottom: 6px; font-weight: 500; }
  .lang-col textarea {
    width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #e6edf3; font-size: 13px; font-family: inherit; resize: vertical; min-height: 250px; line-height: 1.5;
  }
  .lang-col textarea:focus { outline: none; border-color: #58a6ff; }
  .lang-col .char-count { font-size: 11px; color: #6e7681; margin-top: 4px; }
  .lang-col.active-lang textarea { border-color: #238636; }
  .lang-col.active-lang label { color: #3fb950; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .form-group { margin-bottom: 0; }
  .form-group label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 6px; }
  .form-group input[type="datetime-local"], .form-group select {
    width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 14px; font-family: inherit;
  }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #58a6ff; }

  .lang-selector { display: flex; gap: 8px; align-items: center; }
  .lang-selector label { margin-bottom: 0; font-size: 13px; color: #8b949e; }
  .lang-radio { display: flex; gap: 4px; }
  .lang-radio button { padding: 6px 16px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #8b949e; cursor: pointer; font-size: 13px; font-weight: 600; }
  .lang-radio button.selected { background: #238636; border-color: #238636; color: #fff; }
  .lang-radio button:hover:not(.selected) { background: #30363d; }

  .comment-preview { margin-bottom: 16px; padding: 10px 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #30363d; font-size: 12px; color: #6e7681; }
  .comment-preview .cp-label { color: #8b949e; font-weight: 500; margin-bottom: 4px; }

  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  .empty { text-align: center; padding: 60px 20px; color: #8b949e; }
  .empty p { font-size: 15px; }

  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 14px; z-index: 200; transition: 0.3s; opacity: 0; transform: translateY(10px); }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.success { background: #2ea043; color: #fff; }
  .toast.error { background: #da3633; color: #fff; }

  @media (max-width: 700px) {
    .bilingual-editor { grid-template-columns: 1fr; }
    .form-row { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="header">
  <h1><span>LinkedIn</span> Scheduler</h1>
  <div class="status-bar" id="statusBar">Loading...</div>
</div>

<div class="container">
  <div class="toolbar">
    <div class="filters">
      <button class="btn active" data-filter="all">All</button>
      <button class="btn" data-filter="scheduled">Scheduled</button>
      <button class="btn" data-filter="published">Published</button>
      <button class="btn" data-filter="failed">Failed</button>
    </div>
    <button class="btn primary" onclick="openCreate()">+ New Post</button>
  </div>
  <div class="counts" id="counts"></div>
  <div id="posts"></div>
</div>

<!-- Edit/Create Modal -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h2 id="modalTitle">Edit Post</h2>
    <input type="hidden" id="editId">

    <div class="bilingual-editor">
      <div class="lang-col" id="colPl">
        <label>PL Polski</label>
        <textarea id="editTextPl" placeholder="Napisz post po polsku..."></textarea>
        <div class="char-count"><span id="charCountPl">0</span> chars</div>
      </div>
      <div class="lang-col" id="colEn">
        <label>EN English</label>
        <textarea id="editTextEn" placeholder="Write your post in English..."></textarea>
        <div class="char-count"><span id="charCountEn">0</span> chars</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Publish At (local time)</label>
        <input type="datetime-local" id="editPublishAt">
      </div>
      <div class="form-group">
        <label>Publish Language</label>
        <div class="lang-radio" id="langRadio">
          <button type="button" data-lang="pl" onclick="setPublishLang('pl')">PL</button>
          <button type="button" data-lang="en" onclick="setPublishLang('en')">EN</button>
        </div>
      </div>
    </div>

    <div class="comment-preview" id="commentPreview">
      <div class="cp-label">Auto-comment (15 min after publish):</div>
      <div id="commentPreviewText">-</div>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="savePost()">Save</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = '';
let allPosts = [];
let currentFilter = 'all';
let publishLang = 'en';

// ── Auto-comment lookup (client-side copy) ───────────────────────────────────
const POST_IDENTIFIERS = {
  'This post published itself': 'post5',
  'Opublikowalem jedyny open-source MCP server': 'post6',
  'Write a thought leadership post about AI automation': 'post7',
  '48 hours. 25 MCP tools': 'post8',
  'MCP (Model Context Protocol) to najwazniejsza zmiana': 'post9',
  'read about the LinkedIn algorithm. I coded it': 'post10',
  'content management stack as a solo founder': 'post11',
  '3 weeks ago I published my first post': 'post12',
  'Schedule a thought leadership post for Thursday': 'post3',
  'most powerful signal on LinkedIn': 'post4',
  'built an MCP server that runs 33 SEO audits': 'post13',
  '69 free AI models. 11 providers': 'post14',
  'This post was written on Sunday': 'post15',
  'Wklejasz dane klientow do ChatGPT': 'post16',
  'MCP servers for LinkedIn AND Facebook': 'post17',
};
const AUTO_COMMENTS = {
  'post3': 'Try it yourself: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post4': 'Source code: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post5': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler...',
  'post6': 'Kod zrodlowy: https://github.com/gacabartosz/linkedin-mcp-server — 25 narzedzi MCP...',
  'post7': 'All 12 templates included: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post8': 'Every commit visible: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post9': 'Kod zrodlowy MCP do LinkedIn: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post10': 'Algorithm rules + 25 tools: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post11': 'My full stack is open source: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post12': 'Full source code + 3 weeks of real data: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post13': 'SEO GACA MCP — 33 SEO tools: https://github.com/gacabartosz/seo-gaca-mcp ...',
  'post14': 'G.A.C.A. source code: https://github.com/gacabartosz/gaca-core — 69+ free AI models...',
  'post15': 'Full auto-publish pipeline: https://github.com/gacabartosz/linkedin-mcp-server ...',
  'post16': 'Presidio Browser Anonymizer v2.0: https://github.com/gacabartosz/second-mind ...',
  'post17': 'Both MCP servers open source: LinkedIn + Facebook + SEO ...',
  'default': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools...',
};

function getPostKey(text) {
  for (const [snippet, key] of Object.entries(POST_IDENTIFIERS)) {
    if (text.includes(snippet)) return key;
  }
  return null;
}

function getCommentPreview(text) {
  const key = getPostKey(text);
  return AUTO_COMMENTS[key] || AUTO_COMMENTS['default'];
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Status bar ───────────────────────────────────────────────────────────────
async function loadStatus() {
  const s = await api('/api/status');
  const bar = document.getElementById('statusBar');
  const daemonDot = s.daemon.running ? 'green' : 'red';
  const daemonText = s.daemon.running ? 'Daemon PID ' + s.daemon.pid : 'Daemon stopped';
  const authDot = s.auth.valid && !s.auth.expired ? 'green' : s.auth.valid ? 'yellow' : 'red';
  const authText = s.auth.valid ? (s.auth.expired ? 'Token expired' : s.auth.user) : 'No auth';
  const nextText = s.next_post ? new Date(s.next_post).toLocaleString() : 'none';

  bar.innerHTML =
    '<div class="status-item"><span class="status-dot ' + daemonDot + '"></span>' + daemonText + '</div>' +
    '<div class="status-item"><span class="status-dot ' + authDot + '"></span>' + authText + '</div>' +
    '<div class="status-item">Next: ' + nextText + '</div>';
}

// ── Posts ─────────────────────────────────────────────────────────────────────
async function loadPosts() {
  allPosts = await api('/api/posts');
  renderPosts();
}

function renderPosts() {
  const filtered = currentFilter === 'all' ? allPosts : allPosts.filter(p => p.status === currentFilter);

  // Counts
  const counts = {};
  allPosts.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
  document.getElementById('counts').innerHTML = Object.entries(counts)
    .map(([s, c]) => '<span class="c-' + s + '">' + c + ' ' + s + '</span>').join('');

  const container = document.getElementById('posts');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty"><p>No posts found</p></div>';
    return;
  }

  container.innerHTML = filtered.map(p => {
    const date = p.publish_at ? new Date(p.publish_at).toLocaleString() : '-';
    const pubDate = p.published_at ? new Date(p.published_at).toLocaleString() : '';
    const isScheduled = p.status === 'scheduled';
    const isFailed = p.status === 'failed';
    const lang = (p.language || 'en').toUpperCase();
    const langClass = 'lang-' + (p.language || 'en');
    const hasBoth = p.text_alt && p.text_alt.length > 0;
    const commentText = p.auto_comment || getCommentPreview(p.text);
    const commentShort = commentText.length > 120 ? commentText.slice(0, 120) + '...' : commentText;

    return '<div class="post-card" data-id="' + p.id + '">' +
      '<div class="post-header">' +
        '<div class="post-meta">' +
          '<span class="badge ' + p.status + '">' + p.status + '</span>' +
          '<span class="badge ' + langClass + '">' + lang + '</span>' +
          (hasBoth ? '<span class="badge bilingual">PL+EN</span>' : '') +
          '<span>' + date + '</span>' +
          (pubDate ? '<span>Published: ' + pubDate + '</span>' : '') +
          (p.post_urn ? '<span style="font-size:11px">' + esc(p.post_urn) + '</span>' : '') +
          (p.error ? '<span style="color:#f85149">Error: ' + esc(p.error) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="post-text" onclick="toggleExpand(this)">' + esc(p.text) + '</div>' +
      '<span class="expand-toggle" onclick="toggleExpand(this.previousElementSibling)">Show more</span>' +
      '<div class="auto-comment">' +
        '<div class="auto-comment-label">Auto-comment (15 min):</div>' +
        esc(commentShort) +
      '</div>' +
      '<div class="post-actions">' +
        (isScheduled || isFailed ? '<button class="btn sm" onclick="openEdit(\\'' + p.id + '\\')">Edit</button>' : '') +
        (isScheduled ? '<button class="btn sm primary" onclick="publishNow(\\'' + p.id + '\\')">Publish Now</button>' : '') +
        (isScheduled ? '<button class="btn sm danger" onclick="cancelPost(\\'' + p.id + '\\')">Cancel</button>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleExpand(el) {
  if (!el || !el.classList.contains('post-text')) return;
  el.classList.toggle('expanded');
  const toggle = el.nextElementSibling;
  if (toggle && toggle.classList.contains('expand-toggle')) {
    toggle.textContent = el.classList.contains('expanded') ? 'Show less' : 'Show more';
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderPosts();
  });
});

// ── Language selector ────────────────────────────────────────────────────────
function setPublishLang(lang) {
  publishLang = lang;
  document.querySelectorAll('#langRadio button').forEach(b => {
    b.classList.toggle('selected', b.dataset.lang === lang);
  });
  document.getElementById('colPl').classList.toggle('active-lang', lang === 'pl');
  document.getElementById('colEn').classList.toggle('active-lang', lang === 'en');
  updateCommentPreview();
}

function updateCommentPreview() {
  const textPl = document.getElementById('editTextPl').value;
  const textEn = document.getElementById('editTextEn').value;
  const mainText = publishLang === 'pl' ? textPl : textEn;
  const comment = mainText ? getCommentPreview(mainText) : '-';
  document.getElementById('commentPreviewText').textContent = comment;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openEdit(id) {
  const post = allPosts.find(p => p.id === id);
  if (!post) return;
  document.getElementById('modalTitle').textContent = 'Edit Post';
  document.getElementById('editId').value = id;

  const lang = post.language || 'en';

  // Fill both textareas
  if (lang === 'pl') {
    document.getElementById('editTextPl').value = post.text || '';
    document.getElementById('editTextEn').value = post.text_alt || '';
  } else {
    document.getElementById('editTextEn').value = post.text || '';
    document.getElementById('editTextPl').value = post.text_alt || '';
  }

  document.getElementById('charCountPl').textContent = document.getElementById('editTextPl').value.length;
  document.getElementById('charCountEn').textContent = document.getElementById('editTextEn').value.length;

  if (post.publish_at) {
    document.getElementById('editPublishAt').value = toLocalISOString(new Date(post.publish_at));
  }

  setPublishLang(lang);
  document.getElementById('modal').classList.add('open');
}

function openCreate() {
  document.getElementById('modalTitle').textContent = 'New Post';
  document.getElementById('editId').value = '';
  document.getElementById('editTextPl').value = '';
  document.getElementById('editTextEn').value = '';
  document.getElementById('charCountPl').textContent = '0';
  document.getElementById('charCountEn').textContent = '0';

  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 30, 0, 0);
  document.getElementById('editPublishAt').value = toLocalISOString(d);

  setPublishLang('en');
  document.getElementById('modal').classList.add('open');
}

function closeModal() { document.getElementById('modal').classList.remove('open'); }

function toLocalISOString(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

document.getElementById('editTextPl').addEventListener('input', e => {
  document.getElementById('charCountPl').textContent = e.target.value.length;
  if (publishLang === 'pl') updateCommentPreview();
});
document.getElementById('editTextEn').addEventListener('input', e => {
  document.getElementById('charCountEn').textContent = e.target.value.length;
  if (publishLang === 'en') updateCommentPreview();
});

document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

async function savePost() {
  const id = document.getElementById('editId').value;
  const textPl = document.getElementById('editTextPl').value.trim();
  const textEn = document.getElementById('editTextEn').value.trim();
  const publishAtLocal = document.getElementById('editPublishAt').value;

  const mainText = publishLang === 'pl' ? textPl : textEn;
  const altText = publishLang === 'pl' ? textEn : textPl;

  if (!mainText) { toast('Main text (' + publishLang.toUpperCase() + ') is required', 'error'); return; }
  if (!publishAtLocal) { toast('Publish time is required', 'error'); return; }

  const publish_at = new Date(publishAtLocal).toISOString();

  try {
    const body = { text: mainText, text_alt: altText || null, language: publishLang, publish_at };
    if (id) {
      await api('/api/posts/' + id, { method: 'PUT', body: JSON.stringify(body) });
      toast('Post updated');
    } else {
      await api('/api/posts', { method: 'POST', body: JSON.stringify(body) });
      toast('Post created');
    }
    closeModal();
    loadPosts();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function publishNow(id) {
  if (!confirm('Publish this post to LinkedIn now?')) return;
  try {
    const result = await api('/api/posts/' + id + '/publish', { method: 'POST' });
    if (result.error) { toast('Error: ' + result.error, 'error'); return; }
    toast('Published! ' + (result.post_urn || ''));
    loadPosts();
    loadStatus();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function cancelPost(id) {
  if (!confirm('Cancel this scheduled post?')) return;
  try {
    await api('/api/posts/' + id, { method: 'DELETE' });
    toast('Post cancelled');
    loadPosts();
    loadStatus();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
loadStatus();
loadPosts();
setInterval(() => { loadStatus(); loadPosts(); }, 30000);
</script>
</body>
</html>`;

// ── Server ───────────────────────────────────────────────────────────────────

// Run DB migration before starting
migrateDb();

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`LinkedIn Scheduler Dashboard v2: http://localhost:${PORT}`);
  console.log('Features: bilingual PL/EN, auto-comment preview, expand/collapse');
});
