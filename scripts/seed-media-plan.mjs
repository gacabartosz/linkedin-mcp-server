#!/usr/bin/env node
// Seeds 12 topics from bartoszgaca.pl/MEDIA-PLAN-2026-Q2.md into ~/.linkedin-mcp/scheduler.db
// Idempotent — runs migration (CREATE TABLE IF NOT EXISTS) and INSERT OR REPLACE by slug.

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.LINKEDIN_DATA_DIR
  ? join(process.env.LINKEDIN_DATA_DIR, 'scheduler.db')
  : join(homedir(), '.linkedin-mcp', 'scheduler.db');

const MEDIA_PLAN_PATH = '/Users/gaca/projects/personal/bartoszgaca.pl/MEDIA-PLAN-2026-Q2.md';

if (!existsSync(DB_PATH)) {
  console.error(`scheduler.db not found at ${DB_PATH}. Start dashboard.mjs first to init.`);
  process.exit(1);
}
if (!existsSync(MEDIA_PLAN_PATH)) {
  console.error(`MEDIA-PLAN not found at ${MEDIA_PLAN_PATH}.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

// ── Migration (idempotent) ───────────────────────────────────────────────────

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

  post_text TEXT,
  hashtags TEXT,
  cta TEXT,
  lead_trigger TEXT,
  format TEXT,
  icp TEXT,
  length_target TEXT,

  banner_concept TEXT,
  banner_path TEXT,
  visual_asset_plan TEXT,
  visual_asset_path TEXT,
  visual_asset_type TEXT,

  source_project TEXT,
  live_signal TEXT,
  wiki_slug TEXT,
  scheduled_post_id TEXT,
  linkedin_post_urn TEXT,

  cannibalize_status TEXT DEFAULT 'pending',
  cannibalize_overlaps TEXT,
  cannibalize_checked_at TEXT,

  gsc_status TEXT DEFAULT 'not_checked',
  gsc_inspect_result TEXT,
  gsc_checked_at TEXT,

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

console.log('Migration done.');

// ── Parse MEDIA-PLAN-2026-Q2.md ──────────────────────────────────────────────

const md = readFileSync(MEDIA_PLAN_PATH, 'utf-8');

// Split by "### #N." headers
const sections = md.split(/^### #(\d+)\./gm);
// sections[0] = preamble, then alternating: number, body, number, body, ...

const items = [];
for (let i = 1; i < sections.length; i += 2) {
  const num = parseInt(sections[i], 10);
  const body = sections[i + 1];
  items.push({ num, body });
}

if (items.length !== 12) {
  console.error(`Expected 12 topics, got ${items.length}. Check MEDIA-PLAN-2026-Q2.md headers.`);
  process.exit(1);
}

// ── Canonical slugs (from wiki paths in the doc) ─────────────────────────────

const SLUGS = {
  1: '01-checklist-matrix-biuro-rachunkowe',
  2: '02-prompt-injection-fix',
  3: '03-15-vectors-en',
  4: '04-irzplus-network',
  5: '05-rag-alergeny',
  6: '06-buhalter-sync',
  7: '07-cristall-glass-ui',
  8: '08-roboforex-v122',
  9: '09-ga4-mcp-en',
  10: '10-agent-pack-foss',
  11: '11-wearefuture-landing',
  12: '12-recap-q2',
};

// ── Field extractors ─────────────────────────────────────────────────────────

function extract(body, label) {
  // - **Label:** ... up to next \n-
  const re = new RegExp('-\\s*\\*\\*' + label + ':\\*\\*\\s*([^\\n]*(?:\\n(?!-)[^\\n]*)*)', 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function extractHook(body) {
  // **Hook:** ... line until blank line
  const m = body.match(/\*\*Hook:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function extractScore(body) {
  // - Lead-gen 5 (×2=10) · ICP 5 · Algo 4 · Świeżość 5 · Dowód 5 (×1.5=7.5) · Unikalność 5 · Narracja 5
  const m = body.match(/Lead-gen\s+(\d+)[^·]*·\s*ICP\s+(\d+)\s*·\s*Algo\s+(\d+)\s*·\s*Świeżość\s+(\d+)\s*·\s*Dowód\s+(\d+)[^·]*·\s*Unikalność\s+(\d+)\s*·\s*Narracja\s+(\d+)/);
  if (!m) return { lead: null, icp: null, algo: null, fresh: null, visual: null, unique: null, narr: null };
  return {
    lead: +m[1], icp: +m[2], algo: +m[3], fresh: +m[4], visual: +m[5], unique: +m[6], narr: +m[7]
  };
}

function extractTotal(body) {
  const m = body.match(/\*\*Total:\s*([\d.]+)\s*\/\s*5\.0\*\*/);
  return m ? parseFloat(m[1]) : null;
}

function extractDateTime(body) {
  // First line of body: " Wt 2026-05-05 07:30 CET — PL — Build log"
  const m = body.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+CET\s+—\s+\*?\*?(PL|EN)\b/);
  if (!m) return { publish_at: null, language: 'pl' };
  return {
    publish_at: `${m[1]} ${m[2]}:00`, // "2026-05-05 07:30:00" — local CET, sqlite-friendly
    language: m[3].toLowerCase()
  };
}

function extractTitle(body) {
  // First line after the date: "...— PL — Build log ⭐"  capture the format/category as title fallback
  const m = body.match(/^[^\n]*\n\s*\n\*\*Hook:\*\*\s*([^\n]+)/);
  if (m) return m[1].trim().slice(0, 200);
  return null;
}

function extractVisualPlan(body) {
  // ```\n1. ...\n2. ...\n```  inside "VISUAL ASSET" section
  const m = body.match(/VISUAL ASSET[^\n]*\n+```\n([\s\S]*?)\n```/);
  return m ? m[1].trim() : null;
}

function extractHashtags(body) {
  // - **Hashtags:** `#a #b #c`
  const m = body.match(/\*\*Hashtags(?:\s*\(\d+\))?:\*\*\s*`?([^`\n]+)`?/i);
  if (!m) return null;
  const tags = m[1].match(/#[\w]+/g) || [];
  return JSON.stringify(tags);
}

function extractBannerConcept(body) {
  // - **Banner concept:** `screenshot` typ → ...
  const m = body.match(/\*\*Banner concept:\*\*\s*`?([a-z]+)`?/i);
  return m ? m[1].toLowerCase() : null;
}

function extractCTA(body) {
  // - **CTA:** "..."
  const m = body.match(/\*\*CTA:\*\*\s*"?([^"\n]+)"?/);
  return m ? m[1].replace(/^"|"$/g, '').trim() : null;
}

function extractLeadTrigger(body) {
  const m = body.match(/\*\*Lead trigger:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function extractFormat(body) {
  const m = body.match(/\*\*Format(?:\s*\/\s*długość)?:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function extractICP(body) {
  const m = body.match(/\*\*ICP:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function extractSourceProject(body) {
  const m = body.match(/\*\*Projekt[^:]*:\*\*\s*`([^`]+)`/);
  return m ? m[1].trim() : null;
}

function extractLiveSignal(body) {
  const m = body.match(/\*\*Live signal:\*\*\s*([^\n]+)/);
  return m ? m[1].trim() : null;
}

function extractWikiSlug(body) {
  const m = body.match(/\*\*Wiki:\*\*\s*`([^`]+)`/);
  return m ? m[1].trim() : null;
}

function extractHeader(body) {
  // First line before \n\n: " Wt 2026-05-05 07:30 CET — PL — Build log ⭐⭐⭐"
  const firstLine = body.split('\n')[0].trim();
  return firstLine;
}

function extractTitleFromHeader(header, num) {
  // Strip leading day/date/time/CET
  let h = header.replace(/^[A-ZŚŻ]\w+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+CET\s*—\s*/u, '');
  // Strip lang token (PL or EN, possibly wrapped in **)
  h = h.replace(/^\*?\*?(PL|EN)\*?\*?\s*/, '');
  // Strip optional FLAGSHIP/TOP markers
  h = h.replace(/^(?:—\s*)?\*?\*?(FLAGSHIP|TOP)\*?\*?(?:\s*—\s*)?/g, '');
  h = h.replace(/^—\s*/, '');
  // Strip trailing stars + decorations
  h = h.replace(/\s*[⭐\*]+\s*(?:TOP)?\s*$/u, '').trim();
  // If empty after stripping, fallback to slug
  return h || `Topic #${num}`;
}

// ── Build records ────────────────────────────────────────────────────────────

const records = items.map(({ num, body }) => {
  const score = extractScore(body);
  const dt = extractDateTime(body);
  const slug = SLUGS[num];
  const header = extractHeader(body);
  const title = extractTitleFromHeader(header, num);

  return {
    id: randomUUID(),
    topic_number: num,
    slug,
    title,
    hook: extractHook(body),
    language: dt.language,
    publish_at: dt.publish_at,
    status: 'plan',

    score_lead_gen: score.lead,
    score_icp: score.icp,
    score_algo: score.algo,
    score_freshness: score.fresh,
    score_visual: score.visual,
    score_uniqueness: score.unique,
    score_narrative: score.narr,
    score_total: extractTotal(body),

    post_text: null,
    hashtags: extractHashtags(body),
    cta: extractCTA(body),
    lead_trigger: extractLeadTrigger(body),
    format: extractFormat(body),
    icp: extractICP(body),
    length_target: null,

    banner_concept: extractBannerConcept(body),
    banner_path: null,
    visual_asset_plan: extractVisualPlan(body),
    visual_asset_path: null,
    visual_asset_type: null,

    source_project: extractSourceProject(body),
    live_signal: extractLiveSignal(body),
    wiki_slug: extractWikiSlug(body),
    scheduled_post_id: null,
    linkedin_post_urn: null,

    cannibalize_status: 'pending',
    gsc_status: 'not_checked',
  };
});

// ── Insert (INSERT OR REPLACE by slug) ───────────────────────────────────────

const upsert = db.prepare(`
INSERT INTO media_plan_items (
  id, topic_number, slug, title, hook, language, publish_at, status,
  score_lead_gen, score_icp, score_algo, score_freshness,
  score_visual, score_uniqueness, score_narrative, score_total,
  hashtags, cta, lead_trigger, format, icp,
  banner_concept, visual_asset_plan,
  source_project, live_signal, wiki_slug,
  cannibalize_status, gsc_status,
  created_at, updated_at
) VALUES (
  @id, @topic_number, @slug, @title, @hook, @language, @publish_at, @status,
  @score_lead_gen, @score_icp, @score_algo, @score_freshness,
  @score_visual, @score_uniqueness, @score_narrative, @score_total,
  @hashtags, @cta, @lead_trigger, @format, @icp,
  @banner_concept, @visual_asset_plan,
  @source_project, @live_signal, @wiki_slug,
  @cannibalize_status, @gsc_status,
  datetime('now'), datetime('now')
)
ON CONFLICT(slug) DO UPDATE SET
  topic_number = excluded.topic_number,
  title = excluded.title,
  hook = excluded.hook,
  language = excluded.language,
  publish_at = excluded.publish_at,
  score_lead_gen = excluded.score_lead_gen,
  score_icp = excluded.score_icp,
  score_algo = excluded.score_algo,
  score_freshness = excluded.score_freshness,
  score_visual = excluded.score_visual,
  score_uniqueness = excluded.score_uniqueness,
  score_narrative = excluded.score_narrative,
  score_total = excluded.score_total,
  hashtags = excluded.hashtags,
  cta = excluded.cta,
  lead_trigger = excluded.lead_trigger,
  format = excluded.format,
  icp = excluded.icp,
  banner_concept = excluded.banner_concept,
  visual_asset_plan = excluded.visual_asset_plan,
  source_project = excluded.source_project,
  live_signal = excluded.live_signal,
  wiki_slug = excluded.wiki_slug,
  updated_at = datetime('now')
`);

const tx = db.transaction((rows) => {
  for (const r of rows) upsert.run(r);
});

tx(records);

// ── Verify ───────────────────────────────────────────────────────────────────

const summary = db.prepare(`
  SELECT topic_number, slug, language, status, score_total, ROUND(score_total, 1) as score
  FROM media_plan_items ORDER BY topic_number
`).all();

console.log('\nSeeded media_plan_items:');
console.log('═══════════════════════════════════════════════════════════════════');
for (const r of summary) {
  console.log(`#${String(r.topic_number).padStart(2)} [${r.language.toUpperCase()}] ${r.score}/5.0  ${r.slug}  status=${r.status}`);
}
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`Total: ${summary.length} items.`);

const gsc_setting = db.prepare("SELECT value FROM media_plan_settings WHERE key='gsc_auto_submit'").get();
console.log(`gsc_auto_submit=${gsc_setting.value}`);

db.close();
