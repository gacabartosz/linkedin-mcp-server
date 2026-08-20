#!/usr/bin/env node
/**
 * gen-post-image — concept-aware banner+visual generator for media_plan_items.
 *
 * Usage:
 *   node scripts/gen-post-image.mjs <slug>          # generate one
 *   node scripts/gen-post-image.mjs <slug> --force  # re-generate even if banner_path set
 *   node scripts/gen-post-image.mjs <slug> --no-visual  # skip Imagen secondary asset
 *
 * Concept dispatch (col `media_plan_items.banner_concept`):
 *   screenshot  → Puppeteer goto(live_signal_url) + page.screenshot
 *   code        → HTML template with code block + JetBrains Mono
 *   numbers     → HTML template with 3 big stats
 *   split       → HTML template with bullets
 *   typography  → HTML template with big hero text
 *   illustration→ Imagen 4 (banner.png from Imagen)
 *
 * Optional visual.png via Imagen 4 when score_visual >= 4 and concept != illustration.
 *
 * Output: /Users/gaca/projects/personal/bartoszgaca.pl/banners/2026-Q2/<slug>/{banner,visual}.png
 * Updates: media_plan_items.banner_path, visual_asset_path, visual_asset_type='png', updated_at.
 */
import puppeteer from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import Database from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/better-sqlite3/lib/index.js';
import { mkdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const SCHEDULER_DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const BANNERS_ROOT = '/Users/gaca/projects/personal/bartoszgaca.pl/banners/2026-Q2';
const WIDTH = 1200;
const HEIGHT = 627;

const args = process.argv.slice(2);
const slug = args.find(a => !a.startsWith('--'));
const FORCE = args.includes('--force');
const NO_VISUAL = args.includes('--no-visual');
const VISUAL_ONLY = args.includes('--visual-only');

if (!slug) {
  console.error('Usage: node scripts/gen-post-image.mjs <slug> [--force] [--no-visual] [--visual-only]');
  process.exit(2);
}

// ── GEMINI_API_KEY from keychain if missing ─────────────────────────────────
function ensureGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const k = execSync('security find-generic-password -a "$USER" -s GEMINI_API_KEY -w', {
      encoding: 'utf-8',
    }).trim();
    if (k) {
      process.env.GEMINI_API_KEY = k;
      return k;
    }
  } catch {}
  return null;
}

// ── Palette / typography ────────────────────────────────────────────────────
const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`;

const PALETTES = {
  dark:    { bg: '#0a0a0a', text: '#ffffff', accent: '#3b82f6', muted: 'rgba(255,255,255,0.5)' },
  navy:    { bg: '#0f172a', text: '#f8fafc', accent: '#38bdf8', muted: 'rgba(248,250,252,0.5)' },
  warm:    { bg: '#1c1917', text: '#fafaf9', accent: '#f97316', muted: 'rgba(250,250,249,0.5)' },
  clean:   { bg: '#ffffff', text: '#0f172a', accent: '#2563eb', muted: 'rgba(15,23,42,0.5)' },
  emerald: { bg: '#022c22', text: '#ecfdf5', accent: '#34d399', muted: 'rgba(236,253,245,0.5)' },
};

function paletteFor(concept, scoreVisual) {
  // bias palette by concept so the deck looks varied but consistent
  switch (concept) {
    case 'code': return PALETTES.dark;
    case 'numbers': return scoreVisual >= 5 ? PALETTES.navy : PALETTES.warm;
    case 'split': return PALETTES.clean;
    case 'typography': return PALETTES.emerald;
    case 'illustration': return PALETTES.navy;
    default: return PALETTES.dark;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseStyles(p) {
  return `<style>
    ${FONTS}
    * { margin:0; padding:0; box-sizing:border-box; }
    body { width:${WIDTH}px; height:${HEIGHT}px; background:${p.bg}; color:${p.text};
      font-family:'Inter',-apple-system,sans-serif; overflow:hidden; position:relative; }
    .container { width:100%; height:100%; padding:60px 72px;
      display:flex; flex-direction:column; justify-content:center; position:relative; z-index:1; }
    .accent { color:${p.accent}; }
    .muted { color:${p.muted}; }
    .mono { font-family:'JetBrains Mono',monospace; }
    .brand { position:absolute; bottom:24px; left:72px; font-size:14px; font-weight:500;
      color:${p.muted}; letter-spacing:0.5px; }
    .brand-dot { display:inline-block; width:6px; height:6px; background:${p.accent};
      border-radius:50%; margin-right:8px; vertical-align:middle; }
    .tag { display:inline-block; background:${p.accent}26; color:${p.accent};
      font-size:12px; font-weight:600; padding:5px 12px; border-radius:6px;
      letter-spacing:1px; text-transform:uppercase; margin-bottom:20px; width:fit-content; }
  </style>`;
}

// ── Content extraction from row ─────────────────────────────────────────────
function extractHeadline(row) {
  // Prefer first 1-2 sentences of hook, fall back to title
  const h = (row.hook || row.title || '').trim();
  // Grab whatever fits in 90 chars — full sentences preferred
  if (h.length <= 90) return h;
  // Take first sentence ending in . ! or ? — if it's >= 40 chars stop, else add 2nd sentence
  const parts = h.split(/(?<=[.!?])\s+/);
  let acc = parts[0];
  for (let i = 1; i < parts.length && (acc.length + parts[i].length + 1) <= 95; i++) {
    if (acc.length >= 40) break;
    acc = acc + ' ' + parts[i];
  }
  return acc.slice(0, 95).trim();
}

function accentWord(text, lang) {
  // Strip surrounding punctuation; pick the longest meaningful token
  const stopwords = new Set(['klient','client','problem','sprint','about','jeden','dwoch','three','they','that','this','with','from','have','their','here','tylko','jeszcze','jednak','przez','przy','dla','jak','jest','sie','swoje','tych','tym','tej','tego','co','czy','to','jakby','które','które','kiedy','które','którą','które','project','projekt','kod']);
  const words = (text || '')
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
    .filter(w => w.length >= 5 && !stopwords.has(w.toLowerCase()));
  if (!words.length) return '';
  return words.sort((a, b) => b.length - a.length)[0];
}

function extractNumbers(row) {
  const src = `${row.hook || ''} ${row.post_text || ''} ${row.live_signal || ''}`;
  // patterns: 25 MB, 30 min, 200 ms, 12 arkuszy, 8 parserów, 15 wektorów, 90 lines, 24h, 4 projektach
  const re = /(\d{1,4})\s*([%kKhmsM][BbsBl]?|wektor\w*|arkusz\w*|parser\w*|line\w*|projekt\w*|minut\w*|godzin\w*|sec|min|ms|d(?:ays?|ni)?|krok\w*|day\w*|hour\w*)?/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) && found.length < 8) {
    const val = m[1];
    const unit = (m[2] || '').slice(0, 8);
    if (parseInt(val, 10) >= 2 && parseInt(val, 10) <= 9999) {
      found.push({ value: val + (unit ? unit : ''), label: '' });
    }
  }
  // dedupe by value
  const seen = new Set();
  const dedup = found.filter(n => !seen.has(n.value) && seen.add(n.value));
  return dedup.slice(0, 3);
}

function extractBullets(row) {
  // Lines starting with → or - or numbered
  const text = row.post_text || row.hook || '';
  const lines = text.split(/\n+/);
  const bullets = [];
  for (const line of lines) {
    const m = line.match(/^[\s]*(?:→|-|•|\d+[.)])\s*(.{8,80})/);
    if (m) bullets.push(m[1].trim());
    if (bullets.length >= 5) break;
  }
  if (bullets.length >= 3) return bullets;
  // Fallback: split hook on commas
  const halves = (row.hook || '').split(/[,;]\s*/).map(s => s.trim()).filter(s => s.length > 8);
  return halves.slice(0, 5);
}

function extractCodeSnippet(row) {
  const src = row.post_text || row.hook || '';
  // Find a fenced block or stack list
  const fence = src.match(/```[\w]*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim().slice(0, 280);
  // Find "→" stack list
  const stackLines = src.split('\n').filter(l => /^→/.test(l.trim())).map(l => l.replace(/^→\s*/, ''));
  if (stackLines.length >= 2) return stackLines.slice(0, 5).join('\n');
  // Fallback
  return `// ${(row.hook || '').slice(0, 60)}\nconst result = await ${(row.slug || '').replace(/[^a-z]/g, '').slice(0, 14)}();`;
}

// ── HTML templates ──────────────────────────────────────────────────────────

function tplTypography(row) {
  const p = paletteFor('typography', row.score_visual || 3);
  const h = extractHeadline(row);
  const accent = accentWord(h, row.language);
  const html = h.replace(new RegExp(`\\b${accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), `<span class="accent">${esc(accent)}</span>`);
  return `<!DOCTYPE html><html><head>${baseStyles(p)}
    <style>
      .big { font-size:58px; font-weight:900; line-height:1.05; letter-spacing:-1.5px; max-width:1000px; }
      .sub { font-size:18px; color:${p.muted}; margin-top:24px; font-weight:400; max-width:800px; line-height:1.5; }
    </style></head><body>
    <div class="container">
      <div class="tag">${esc((row.banner_concept || '').toUpperCase())}</div>
      <div class="big">${html}</div>
      ${row.cta ? `<div class="sub">${esc(row.cta.slice(0, 140))}</div>` : ''}
    </div>
    <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
  </body></html>`;
}

function tplCode(row) {
  const p = paletteFor('code', row.score_visual || 3);
  const h = extractHeadline(row);
  const accent = accentWord(h, row.language);
  const html = h.replace(new RegExp(`\\b${accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), `<span class="accent">${esc(accent)}</span>`);
  const code = extractCodeSnippet(row);
  return `<!DOCTYPE html><html><head>${baseStyles(p)}
    <style>
      .big { font-size:48px; font-weight:900; line-height:1.1; letter-spacing:-1.5px; margin-bottom:28px; max-width:740px; }
      .code { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
        border-radius:12px; padding:20px 28px; font-family:'JetBrains Mono',monospace;
        font-size:14px; line-height:1.7; color:rgba(255,255,255,0.78); max-width:680px; white-space:pre-wrap; }
      .lang-tag { position:absolute; top:60px; right:72px; font-family:'JetBrains Mono',monospace;
        font-size:13px; color:${p.muted}; letter-spacing:1px; text-transform:uppercase; }
    </style></head><body>
    <div class="lang-tag">${esc(row.language === 'en' ? 'EN' : 'PL')} · CODE</div>
    <div class="container">
      <div class="big">${html}</div>
      <div class="code">${esc(code)}</div>
    </div>
    <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
  </body></html>`;
}

function tplNumbers(row) {
  const p = paletteFor('numbers', row.score_visual || 3);
  const h = extractHeadline(row);
  const accent = accentWord(h, row.language);
  const html = h.replace(new RegExp(`\\b${accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), `<span class="accent">${esc(accent)}</span>`);
  const nums = extractNumbers(row);
  // fill to 3 with hints
  while (nums.length < 3) nums.push({ value: '?', label: '' });
  const stats = nums.slice(0, 3).map(n => `
    <div class="stat">
      <div class="stat-val">${esc(n.value)}</div>
      ${n.label ? `<div class="stat-lbl">${esc(n.label)}</div>` : ''}
    </div>`).join('');
  return `<!DOCTYPE html><html><head>${baseStyles(p)}
    <style>
      .big { font-size:46px; font-weight:900; line-height:1.1; letter-spacing:-1.5px; margin-bottom:36px; max-width:880px; }
      .stats { display:flex; gap:56px; }
      .stat { display:flex; flex-direction:column; }
      .stat-val { font-size:62px; font-weight:900; color:${p.accent}; font-family:'JetBrains Mono',monospace; line-height:1; }
      .stat-lbl { font-size:13px; color:${p.muted}; text-transform:uppercase; letter-spacing:1px; margin-top:8px; }
      .divider { width:60px; height:3px; background:${p.accent}; opacity:0.4; border-radius:2px; margin:24px 0; }
    </style></head><body>
    <div class="container">
      <div class="big">${html}</div>
      <div class="divider"></div>
      <div class="stats">${stats}</div>
    </div>
    <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
  </body></html>`;
}

function tplSplit(row) {
  const p = paletteFor('split', row.score_visual || 3);
  const h = extractHeadline(row);
  const accent = accentWord(h, row.language);
  const html = h.replace(new RegExp(`\\b${accent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), `<span class="accent">${esc(accent)}</span>`);
  const bullets = extractBullets(row);
  const items = bullets.slice(0, 5).map(b => `
    <div class="item"><div class="bar"></div><span>${esc(b)}</span></div>`).join('');
  return `<!DOCTYPE html><html><head>${baseStyles(p)}
    <style>
      .big { font-size:46px; font-weight:900; line-height:1.1; letter-spacing:-1.5px; margin-bottom:32px; max-width:840px; }
      .list { display:flex; flex-direction:column; gap:14px; max-width:780px; }
      .item { display:flex; align-items:center; gap:14px; font-size:17px; font-weight:600; color:${p.bg === '#ffffff' ? 'rgba(15,23,42,0.78)' : 'rgba(255,255,255,0.78)'}; }
      .bar { width:4px; height:22px; background:${p.accent}; border-radius:2px; flex-shrink:0; }
    </style></head><body>
    <div class="container">
      <div class="big">${html}</div>
      <div class="list">${items}</div>
    </div>
    <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
  </body></html>`;
}

// ── Renderer ────────────────────────────────────────────────────────────────
async function renderHTML(html, outPath) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Allow font swap
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: outPath, type: 'png' });
  } finally {
    await browser.close();
  }
}

async function renderScreenshot(url, outPath) {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for content to settle but cap at 5s
    await page.waitForLoadState ? null : await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: outPath, type: 'png', fullPage: false });
  } finally {
    await browser.close();
  }
}

// ── Imagen 4 ────────────────────────────────────────────────────────────────
async function callImagen({ prompt, aspectRatio = '16:9', outPath }) {
  const key = ensureGeminiKey();
  if (!key) throw new Error('GEMINI_API_KEY not available (env nor keychain)');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Imagen ${res.status}: ${errTxt.slice(0, 300)}`);
  }
  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen returned no image (safety filter?)');
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

function buildImagenPrompt(row, mode = 'banner') {
  const subject = (row.hook || row.title || '').slice(0, 140);
  // Strip Polish marketing nouns and keep concrete subject
  const cleanSubject = subject.replace(/DM\s+\*\*[^*]+\*\*[^\n]*/g, '').replace(/[#@]/g, '').trim();
  // Brand style
  const style = [
    'minimal vector illustration',
    'editorial tech magazine aesthetic',
    'navy blue and cyan color palette with white space',
    'flat composition, isometric optional',
    'professional LinkedIn hero image',
  ].join(', ');
  const negatives = 'no text, no letters, no typography, no logos, no watermarks, no human faces, no fingers, abstract symbolic representation';
  return `${cleanSubject}. Style: ${style}. ${negatives}.`;
}

// ── Main ────────────────────────────────────────────────────────────────────
const db = new Database(SCHEDULER_DB);
const row = db.prepare(`SELECT slug, title, hook, cta, language, post_text, lead_trigger,
  banner_concept, banner_path, visual_asset_path, score_visual, score_total,
  live_signal, wiki_slug, source_project
  FROM media_plan_items WHERE slug = ?`).get(slug);

if (!row) {
  console.error(`[err] slug not found: ${slug}`);
  db.close();
  process.exit(1);
}

console.log(`[gen] ${slug}  concept=${row.banner_concept}  score_visual=${row.score_visual}  lang=${row.language}`);

const outDir = join(BANNERS_ROOT, slug);
mkdirSync(outDir, { recursive: true });
const bannerPath = join(outDir, 'banner.png');
const visualPath = join(outDir, 'visual.png');

const bannerExists = existsSync(bannerPath) && statSync(bannerPath).size > 1024;
const visualExists = existsSync(visualPath) && statSync(visualPath).size > 1024;

// ── Banner ──────────────────────────────────────────────────────────────────
if (!VISUAL_ONLY && (!bannerExists || FORCE)) {
  console.log(`[gen] rendering banner (${row.banner_concept})...`);
  try {
    if (row.banner_concept === 'screenshot') {
      // Try live_signal URL first (extract URL from text), then wiki_slug
      const urlMatch = (row.live_signal || '').match(/https?:\/\/\S+/);
      const wikiUrl = row.wiki_slug ? `https://bartoszgaca.pl${row.wiki_slug}` : null;
      const targetUrl = urlMatch ? urlMatch[0] : wikiUrl;
      if (targetUrl) {
        try {
          await renderScreenshot(targetUrl, bannerPath);
          console.log(`[gen] screenshot OK ← ${targetUrl}`);
        } catch (e) {
          console.warn(`[gen] screenshot fail (${e.message.slice(0, 80)}) — falling back to typography`);
          await renderHTML(tplTypography(row), bannerPath);
        }
      } else {
        console.warn(`[gen] no URL for screenshot — falling back to typography`);
        await renderHTML(tplTypography(row), bannerPath);
      }
    } else if (row.banner_concept === 'code') {
      await renderHTML(tplCode(row), bannerPath);
    } else if (row.banner_concept === 'numbers') {
      await renderHTML(tplNumbers(row), bannerPath);
    } else if (row.banner_concept === 'split') {
      await renderHTML(tplSplit(row), bannerPath);
    } else if (row.banner_concept === 'typography') {
      await renderHTML(tplTypography(row), bannerPath);
    } else if (row.banner_concept === 'illustration') {
      const prompt = buildImagenPrompt(row, 'banner');
      await callImagen({ prompt, aspectRatio: '16:9', outPath: bannerPath });
      console.log(`[gen] Imagen 4 banner OK`);
    } else {
      console.warn(`[gen] unknown concept "${row.banner_concept}" — using typography`);
      await renderHTML(tplTypography(row), bannerPath);
    }
    const sz = (statSync(bannerPath).size / 1024).toFixed(0);
    console.log(`[gen] banner.png written (${sz} KB)`);
  } catch (e) {
    console.error(`[err] banner render failed: ${e.message}`);
    db.close();
    process.exit(1);
  }
} else {
  console.log(`[gen] banner.png already present (${(statSync(bannerPath).size / 1024).toFixed(0)} KB) — use --force to regen`);
}

// ── Visual (Imagen secondary) ───────────────────────────────────────────────
let usedImagen = (row.banner_concept === 'illustration' && !VISUAL_ONLY);
if (!NO_VISUAL && row.score_visual >= 4 && row.banner_concept !== 'illustration' && (!visualExists || FORCE)) {
  console.log(`[gen] generating Imagen 4 secondary visual...`);
  try {
    const prompt = buildImagenPrompt(row, 'visual');
    await callImagen({ prompt, aspectRatio: '1:1', outPath: visualPath });
    usedImagen = true;
    const sz = (statSync(visualPath).size / 1024).toFixed(0);
    console.log(`[gen] visual.png written (${sz} KB)`);
  } catch (e) {
    console.warn(`[warn] Imagen visual failed: ${e.message.slice(0, 200)}`);
  }
}

// ── Update DB ───────────────────────────────────────────────────────────────
const finalBanner = existsSync(bannerPath) && statSync(bannerPath).size > 1024 ? bannerPath : null;
const finalVisual = existsSync(visualPath) && statSync(visualPath).size > 1024 ? visualPath : null;

const upd = db.prepare(`UPDATE media_plan_items
  SET banner_path = COALESCE(?, banner_path),
      visual_asset_path = COALESCE(?, visual_asset_path),
      visual_asset_type = CASE WHEN ? IS NOT NULL THEN 'png' ELSE visual_asset_type END,
      updated_at = datetime('now')
  WHERE slug = ?`);
upd.run(finalBanner, finalVisual, finalVisual, slug);
db.close();

console.log(`[ok] ${slug} → banner=${finalBanner ? 'OK' : 'SKIP'}  visual=${finalVisual ? 'OK' : 'SKIP'}  imagen=${usedImagen}`);
