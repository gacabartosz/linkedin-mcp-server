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
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const PORT = 3000;
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const IMG_DIR = '/Users/gaca/output/personal/linkedin-mcp';

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

const POST_IMAGES = {
  'post5': 'post5-banner.png',
  'post6': 'post6-github.png',
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

function migrateDb() {
  const db = new Database(DB_PATH);
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN language TEXT"); } catch {}
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN text_alt TEXT"); } catch {}

  const posts = db.prepare("SELECT id, text FROM scheduled_posts WHERE language IS NULL").all();
  const stmt = db.prepare("UPDATE scheduled_posts SET language = ? WHERE id = ?");
  for (const p of posts) {
    stmt.run(detectLanguage(p.text), p.id);
  }
  if (posts.length > 0) console.log('Auto-detected language for ' + posts.length + ' posts');
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

function enrichPost(p) {
  p.auto_comment = getAutoComment(p.text);
  p.image_file = getImageFile(p.text);
  return p;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

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

    // POST /api/posts/:id/publish (must be before generic :id)
    if (method === 'POST' && path.match(/^\/api\/posts\/[^/]+\/publish$/)) {
      const id = path.split('/')[3];
      const db = getDb(false);
      const post = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
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
          .run(result.post_urn, new Date().toISOString(), id);
        dbw.close();
        return json(res, { ok: true, post_urn: result.post_urn });
      } catch (err) {
        return json(res, { error: err.message }, 500);
      }
    }

    // GET /api/posts/:id
    if (method === 'GET' && path.match(/^\/api\/posts\/[^/]+$/) && !path.includes('/publish')) {
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
      db.prepare("UPDATE scheduled_posts SET text = ?, publish_at = ?, visibility = ?, language = ?, text_alt = ?, updated_at = datetime('now') WHERE id = ?")
        .run(text, publish_at, visibility, language, text_alt, id);
      const updated = db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id);
      db.close();
      return json(res, enrichPost(updated));
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

    // GET / — serve dashboard HTML
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml());
      return;
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}

// ── Dashboard HTML (built as function to avoid template-literal issues) ──────

function buildHtml() {
  return [
'<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'<meta charset="utf-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1">',
'<title>LinkedIn Scheduler</title>',
'<style>',
'* { margin: 0; padding: 0; box-sizing: border-box; }',
'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }',
'a { color: #58a6ff; }',
'.header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }',
'.header h1 { font-size: 20px; font-weight: 600; }',
'.header h1 em { color: #58a6ff; font-style: normal; }',
'.status-bar { display: flex; gap: 16px; align-items: center; font-size: 13px; flex-wrap: wrap; }',
'.sdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }',
'.sdot.g { background: #3fb950; } .sdot.r { background: #f85149; } .sdot.y { background: #d29922; }',
'.si { display: flex; align-items: center; gap: 4px; color: #8b949e; }',
'.container { max-width: 1100px; margin: 0 auto; padding: 24px; }',
'.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 8px; }',
'.filters { display: flex; gap: 8px; flex-wrap: wrap; }',
'.btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer; font-size: 13px; transition: 0.15s; }',
'.btn:hover { background: #30363d; }',
'.btn.primary { background: #238636; border-color: #238636; } .btn.primary:hover { background: #2ea043; }',
'.btn.danger { color: #f85149; } .btn.danger:hover { background: rgba(218,54,51,0.15); }',
'.btn.active { background: rgba(56,139,253,0.15); border-color: #388bfd; color: #58a6ff; }',
'.btn.sm { padding: 4px 10px; font-size: 12px; }',
'.counts { display: flex; gap: 12px; margin-bottom: 16px; font-size: 13px; color: #8b949e; flex-wrap: wrap; }',
'.counts span { background: #161b22; padding: 4px 10px; border-radius: 12px; border: 1px solid #30363d; }',
'.c-scheduled { color: #58a6ff; } .c-published { color: #3fb950; } .c-failed { color: #f85149; } .c-cancelled { color: #8b949e; }',
'.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px; transition: 0.15s; }',
'.card:hover { border-color: #484f58; }',
'.card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }',
'.meta { font-size: 12px; color: #8b949e; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }',
'.badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }',
'.b-scheduled { background: rgba(56,139,253,0.15); color: #58a6ff; }',
'.b-published { background: rgba(46,160,67,0.15); color: #3fb950; }',
'.b-failed { background: rgba(218,54,51,0.15); color: #f85149; }',
'.b-cancelled { background: #30363d; color: #8b949e; }',
'.b-en { background: rgba(56,139,253,0.15); color: #58a6ff; font-weight: 700; }',
'.b-pl { background: rgba(218,54,51,0.15); color: #f85149; font-weight: 700; }',
'.b-bi { background: rgba(210,153,34,0.15); color: #d29922; font-size: 10px; }',
'.card-img { margin: 8px 0; border-radius: 6px; overflow: hidden; }',
'.card-img img { width: 100%; max-height: 200px; object-fit: cover; border-radius: 6px; display: block; }',
'.ptxt { font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 80px; overflow: hidden; color: #c9d1d9; cursor: pointer; transition: max-height 0.3s; }',
'.ptxt.open { max-height: 3000px; }',
'.toggle { font-size: 12px; color: #58a6ff; cursor: pointer; margin-top: 4px; display: inline-block; }',
'.toggle:hover { text-decoration: underline; }',
'.acom { font-size: 12px; color: #6e7681; margin-top: 8px; padding: 8px 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #30363d; }',
'.acom b { color: #8b949e; font-weight: 500; }',
'.actions { display: flex; gap: 8px; margin-top: 12px; }',
'.overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 100; }',
'.overlay.open { display: flex; }',
'.modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; width: 920px; max-width: 95vw; max-height: 90vh; overflow-y: auto; }',
'.modal h2 { font-size: 18px; margin-bottom: 16px; }',
'.birow { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }',
'.lcol label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #8b949e; margin-bottom: 6px; font-weight: 600; }',
'.lcol textarea { width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 13px; font-family: inherit; resize: vertical; min-height: 250px; line-height: 1.5; }',
'.lcol textarea:focus { outline: none; border-color: #58a6ff; }',
'.lcol .cc { font-size: 11px; color: #6e7681; margin-top: 4px; }',
'.lcol.act textarea { border-color: #238636; } .lcol.act label { color: #3fb950; }',
'.frow { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }',
'.fg label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 6px; }',
'.fg input, .fg select { width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 14px; font-family: inherit; }',
'.fg input:focus, .fg select:focus { outline: none; border-color: #58a6ff; }',
'.lradio { display: flex; gap: 4px; margin-top: 6px; }',
'.lradio button { padding: 8px 20px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #8b949e; cursor: pointer; font-size: 14px; font-weight: 700; }',
'.lradio button.sel { background: #238636; border-color: #238636; color: #fff; }',
'.lradio button:hover:not(.sel) { background: #30363d; }',
'.cprev { margin-bottom: 16px; padding: 10px 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #30363d; font-size: 12px; color: #6e7681; }',
'.cprev b { color: #8b949e; font-weight: 500; }',
'.mact { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }',
'.empty { text-align: center; padding: 60px 20px; color: #8b949e; }',
'.toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; border-radius: 8px; font-size: 14px; z-index: 200; transition: 0.3s; opacity: 0; transform: translateY(10px); }',
'.toast.show { opacity: 1; transform: translateY(0); }',
'.toast.ok { background: #2ea043; color: #fff; } .toast.err { background: #da3633; color: #fff; }',
'@media (max-width: 700px) { .birow, .frow { grid-template-columns: 1fr; } }',
'</style>',
'</head>',
'<body>',
'<div class="header">',
'  <h1><em>LinkedIn</em> Scheduler</h1>',
'  <div class="status-bar" id="sbar">Loading...</div>',
'</div>',
'<div class="container">',
'  <div class="toolbar">',
'    <div class="filters" id="filters">',
'      <button class="btn active" data-f="all">All</button>',
'      <button class="btn" data-f="scheduled">Scheduled</button>',
'      <button class="btn" data-f="published">Published</button>',
'      <button class="btn" data-f="failed">Failed</button>',
'    </div>',
'    <button class="btn primary" id="btnNew">+ New Post</button>',
'  </div>',
'  <div class="counts" id="counts"></div>',
'  <div id="posts"></div>',
'</div>',
'<div class="overlay" id="ov">',
'  <div class="modal">',
'    <h2 id="mtitle">Edit Post</h2>',
'    <input type="hidden" id="eid">',
'    <div class="birow">',
'      <div class="lcol" id="cpl">',
'        <label>PL Polski</label>',
'        <textarea id="tpl" placeholder="Napisz post po polsku..."></textarea>',
'        <div class="cc"><span id="ccpl">0</span> chars (1300-1600)</div>',
'      </div>',
'      <div class="lcol" id="cen">',
'        <label>EN English</label>',
'        <textarea id="ten" placeholder="Write your post in English..."></textarea>',
'        <div class="cc"><span id="ccen">0</span> chars (1300-1600)</div>',
'      </div>',
'    </div>',
'    <div class="frow">',
'      <div class="fg">',
'        <label>Publish At (local time)</label>',
'        <input type="datetime-local" id="edate">',
'      </div>',
'      <div class="fg">',
'        <label>Publish Language</label>',
'        <div class="lradio" id="lrad">',
'          <button type="button" data-l="pl">PL</button>',
'          <button type="button" data-l="en">EN</button>',
'        </div>',
'      </div>',
'    </div>',
'    <div class="cprev">',
'      <b>Auto-comment (15 min after publish):</b><br>',
'      <span id="cptext">-</span>',
'    </div>',
'    <div class="mact">',
'      <button class="btn" id="mcancel">Cancel</button>',
'      <button class="btn primary" id="msave">Save</button>',
'    </div>',
'  </div>',
'</div>',
'<div class="toast" id="toast"></div>',
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
var filter = 'all';
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

function loadStatus() {
  api('/api/status').then(function(s) {
    var b = $$('sbar');
    var dd = s.daemon.running ? 'g' : 'r';
    var dt = s.daemon.running ? 'Daemon PID ' + s.daemon.pid : 'Daemon stopped';
    var ad = s.auth.valid && !s.auth.expired ? 'g' : s.auth.valid ? 'y' : 'r';
    var at = s.auth.valid ? (s.auth.expired ? 'Token expired' : s.auth.user) : 'No auth';
    var nt = s.next_post ? new Date(s.next_post).toLocaleString() : 'none';
    b.innerHTML = '<div class="si"><span class="sdot ' + dd + '"></span>' + dt + '</div>'
      + '<div class="si"><span class="sdot ' + ad + '"></span>' + at + '</div>'
      + '<div class="si">Next: ' + nt + '</div>';
  });
}

function loadPosts() {
  api('/api/posts').then(function(data) {
    posts = data;
    render();
  });
}

function render() {
  var f = filter === 'all' ? posts : posts.filter(function(p) { return p.status === filter; });

  var cn = {};
  posts.forEach(function(p) { cn[p.status] = (cn[p.status] || 0) + 1; });
  var ch = '';
  for (var k in cn) { ch += '<span class="c-' + k + '">' + cn[k] + ' ' + k + '</span>'; }
  $$('counts').innerHTML = ch;

  var c = $$('posts');
  if (f.length === 0) { c.innerHTML = '<div class="empty"><p>No posts found</p></div>'; return; }

  var h = '';
  f.forEach(function(p) {
    var dt = p.publish_at ? new Date(p.publish_at).toLocaleString() : '-';
    var pd = p.published_at ? new Date(p.published_at).toLocaleString() : '';
    var isSch = p.status === 'scheduled';
    var isFail = p.status === 'failed';
    var lang = (p.language || 'en').toUpperCase();
    var lc = 'b-' + (p.language || 'en');
    var bi = p.text_alt ? '<span class="badge b-bi">PL+EN</span>' : '';
    var com = p.auto_comment || gcom(p.text);
    var comShort = com.length > 120 ? com.substring(0, 120) + '...' : com;
    var img = p.image_file ? '<div class="card-img"><img src="/img/' + esc(p.image_file) + '" alt="Post image"></div>' : '';

    h += '<div class="card" data-id="' + p.id + '">';
    h += '<div class="card-top"><div class="meta">';
    h += '<span class="badge b-' + p.status + '">' + p.status + '</span>';
    h += '<span class="badge ' + lc + '">' + lang + '</span>';
    h += bi;
    h += '<span>' + dt + '</span>';
    if (pd) h += '<span>Published: ' + pd + '</span>';
    if (p.post_urn) h += '<span style="font-size:11px">' + esc(p.post_urn) + '</span>';
    if (p.error) h += '<span style="color:#f85149">' + esc(p.error) + '</span>';
    h += '</div></div>';
    h += img;
    h += '<div class="ptxt" data-act="expand">' + esc(p.text) + '</div>';
    h += '<span class="toggle" data-act="expand">Show more</span>';
    h += '<div class="acom"><b>Auto-comment (15m):</b> ' + esc(comShort) + '</div>';
    h += '<div class="actions">';
    if (isSch || isFail) h += '<button class="btn sm" data-act="edit" data-id="' + p.id + '">Edit</button>';
    if (isSch) h += '<button class="btn sm primary" data-act="publish" data-id="' + p.id + '">Publish Now</button>';
    if (isSch) h += '<button class="btn sm danger" data-act="cancel" data-id="' + p.id + '">Cancel</button>';
    h += '</div></div>';
  });
  c.innerHTML = h;
}

// Event delegation — all clicks handled here
document.addEventListener('click', function(e) {
  var t = e.target;

  // Filters
  if (t.dataset.f) {
    document.querySelectorAll('[data-f]').forEach(function(b) { b.classList.remove('active'); });
    t.classList.add('active');
    filter = t.dataset.f;
    render();
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

  // Edit
  if (t.dataset.act === 'edit') { openEdit(t.dataset.id); return; }

  // Publish now
  if (t.dataset.act === 'publish') { publishNow(t.dataset.id); return; }

  // Cancel
  if (t.dataset.act === 'cancel') { cancelPost(t.dataset.id); return; }

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

function updComment() {
  var txt = plang === 'pl' ? $$('tpl').value : $$('ten').value;
  $$('cptext').textContent = txt ? gcom(txt) : '-';
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
  setLang(lang);
  $$('ov').classList.add('open');
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

  var body = JSON.stringify({ text: main, text_alt: alt || null, language: plang, publish_at: new Date(dt).toISOString() });

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

loadStatus();
loadPosts();
setInterval(function() { loadStatus(); loadPosts(); }, 30000);
`;
}

// ── Server ───────────────────────────────────────────────────────────────────

migrateDb();

const server = createServer(handleRequest);
server.listen(PORT, function() {
  console.log('LinkedIn Scheduler Dashboard v2: http://localhost:' + PORT);
  console.log('Features: bilingual PL/EN, images, auto-comment preview, expand/collapse');
});
