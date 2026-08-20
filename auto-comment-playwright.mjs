#!/usr/bin/env node
/**
 * Auto-Comment Playwright Daemon — odpowiada na komentarze LinkedIn z pełnym kontekstem
 *
 * Architektura:
 * 1. Playwright (persistent profile) loguje się na LinkedIn (sesja żyje tygodniami)
 * 2. Sprawdza notyfikacje w losowych okienkach 2h ± 25 min
 * 3. Dla każdego komentarza pobiera CAŁY wątek (top-level + replies)
 * 4. Zapisuje wątki do thread_memory (pamięć wieloturna)
 * 5. Claude CLI Opus generuje odpowiedź z pełnym kontekstem:
 *    - oryginalny post
 *    - wszystkie komentarze w wątku
 *    - nasze poprzednie odpowiedzi (anti-duplicate)
 *    - persona z second-mind
 * 6. Propozycje → reply_proposals (status='pending') — TY zatwierdzasz
 *
 * Bezpieczeństwo:
 * - max 3 cykle/dobę, max 5 propozycji/cykl = 15/doba
 * - aktywne godziny 8-22 CEST
 * - losowe interwały (nie cron)
 * - human-like delays
 * - --dry-run dla testów (bez zapisu do DB)
 * - --once dla pojedynczego uruchomienia
 *
 * Usage:
 *   node auto-comment-playwright.mjs              # daemon mode
 *   node auto-comment-playwright.mjs --once       # 1 cykl i exit
 *   node auto-comment-playwright.mjs --once --dry-run  # bez zapisu
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, readlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import {
  buildPrompt, callClaude, parseClaudeJson,
  validateProposal, computeComposite, loadPersona, factCheck, retrieveKnowledge,
} from './lib/comment-gen.mjs';

// Self-heal SingletonLock: ten daemon dzieli browser-profile z cookie-refresh / scrape, więc
// osierocony (martwy PID) lock blokuje start i daje crash -9 (gubione cykle komentarzy → Golden Hour ucieka).
// Czyścimy TYLKO martwy lock; żywy (inny proces w trakcie) przeczekujemy, a po czasie pomijamy cykl.
async function ensureProfileFree(profileDir) {
  const lock = join(profileDir, 'SingletonLock');
  for (let attempt = 0; attempt < 6; attempt++) {
    if (!existsSync(lock)) return;
    let pid = 0;
    try { pid = parseInt(String(readlinkSync(lock)).split('-').pop(), 10) || 0; } catch { return; }
    let alive = false;
    if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = (e.code === 'EPERM'); } }
    if (!alive) {
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        try { unlinkSync(join(profileDir, f)); } catch {}
      }
      log(`  Usunięto osierocony lock profilu (martwy PID ${pid}).`);
      return;
    }
    log(`  Profil zajęty (żywy PID ${pid}) — czekam… (${attempt + 1}/6)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Profil przeglądarki zajęty (żywy lock) po 30 s — pomijam ten cykl komentarzy.');
}

// ── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  PROFILE_DIR: join(homedir(), '.linkedin-mcp', 'browser-profile'),
  ENGAGE_DB: join(homedir(), '.linkedin-mcp', 'engage.db'),
  PERSONA_DIR: '/Users/gaca/projects/personal/second-mind/_system',
  LOG_DIR: '/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp',

  // Decyzja Bartka: GENEROWANIE propozycji 24/7 (nic nie umyka), WYSYŁKA dalej tylko 8-22
  // (okno trzyma auto-comment-sender.mjs). Tu skanujemy całą dobę.
  SCAN_24_7: true,
  ACTIVE_HOURS_UTC: { start: 6, end: 20 }, // tylko informacyjnie (sender ma własne okno)

  // Losowy interwał 20 min ± 5-15 min (częściej, żeby nowe komentarze NIE umykały)
  INTERVAL_BASE_MS: 20 * 60 * 1000,        // 20 min
  INTERVAL_JITTER_MAX_MS: 15 * 60 * 1000,  // ±15 min
  INTERVAL_JITTER_MIN_MS: 5 * 60 * 1000,   // ±5 min

  // Limity
  MAX_POSTS_PER_CYCLE: 15,
  MAX_PROPOSALS_PER_CYCLE: 15,             // backlog rozłoży się na kilka cykli; wysyłkę dławi sender
  MAX_CYCLES_PER_DAY: 100,                 // 24/7 × ~20 min = ~72/dobę, z buforem
  MAX_ERRORS_BEFORE_PAUSE: 5,
  ERROR_PAUSE_HOURS: 3,

  // Full-sweep (B): skanuj ostatnie posty NIEZALEŻNIE od notyfikacji
  SWEEP_POST_LIMIT: 15,
  SWEEP_DAYS: 21,
  GOTO_RETRIES: 2,                         // retry na ERR_INTERNET_DISCONNECTED itp.
  CYCLE_TIMEOUT_MS: 8 * 60 * 1000,         // hard-timeout całego cyklu (anti-hang)

  // Scoring
  MIN_LEAD_OR_ENGAGE: 3,
  MAX_TROLL_RISK: 2,

  // Human-like
  HUMAN_DELAY_MIN: 3000,
  HUMAN_DELAY_MAX: 15000,

  // Claude — faktyczny model przypięty w lib/comment-gen.mjs (CLAUDE.MODEL = 'claude-opus-4-8')
  CLAUDE_TIMEOUT_MS: 120000,

  // Playwright
  HEADLESS: false, // LinkedIn blokuje headless
  USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  VIEWPORT: { width: 1280, height: 800 },
};

const args = process.argv.slice(2);
const RUN_ONCE = args.includes('--once');
const DRY_RUN = args.includes('--dry-run');

// ── HELPERS ─────────────────────────────────────────────────────────────────

const log = (msg) => console.log(`[playwright] ${new Date().toISOString().slice(11, 19)} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const humanDelay = () => sleep(randInt(CONFIG.HUMAN_DELAY_MIN, CONFIG.HUMAN_DELAY_MAX));
const isActiveHour = () => {
  const h = new Date().getUTCHours();
  return h >= CONFIG.ACTIVE_HOURS_UTC.start && h < CONFIG.ACTIVE_HOURS_UTC.end;
};

function nextDelay() {
  const sign = Math.random() > 0.5 ? 1 : -1;
  const jitter = randInt(CONFIG.INTERVAL_JITTER_MIN_MS, CONFIG.INTERVAL_JITTER_MAX_MS);
  return CONFIG.INTERVAL_BASE_MS + sign * jitter;
}

// ── DB ──────────────────────────────────────────────────────────────────────

function getDb() {
  const db = new Database(CONFIG.ENGAGE_DB);
  // Defensive: ensure tables daemon depends on exist (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS processed_notifications (
    notification_id TEXT PRIMARY KEY,
    type TEXT,
    post_urn TEXT,
    actor_name TEXT,
    processed_at TEXT DEFAULT (datetime('now'))
  );`);
  // Priority scrape: dashboard wrzuca tu post_urn (przycisk „Pobierz komentarze do postu"),
  // daemon skanuje je PIERWSZE w cyklu, potem czyści.
  db.exec(`CREATE TABLE IF NOT EXISTS priority_scrape (
    post_urn TEXT PRIMARY KEY,
    requested_at TEXT DEFAULT (datetime('now'))
  );`);
  return db;
}

function snowflakeToIso(urn) {
  const m = (urn || '').match(/(activity|share|ugcPost):(\d+)/);
  if (!m) return null;
  try {
    const ts = Number(BigInt(m[2]) >> 22n);
    const d = new Date(ts);
    return d.getFullYear() >= 2015 && d.getFullYear() <= 2030 ? d.toISOString() : null;
  } catch { return null; }
}

function resolvePublishedAt(postUrn) {
  // 1) JOIN ze scheduler.db; 2) Snowflake decode fallback
  try {
    const sch = new Database(join(homedir(), '.linkedin-mcp', 'scheduler.db'), { readonly: true });
    const row = sch.prepare("SELECT publish_at FROM scheduled_posts WHERE post_urn = ? LIMIT 1").get(postUrn);
    sch.close();
    if (row?.publish_at) return row.publish_at;
  } catch {}
  return snowflakeToIso(postUrn);
}

function getTodayCycleCount() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT COUNT(*) as c FROM playwright_cycles WHERE started_at >= ?").get(today);
  db.close();
  return row?.c || 0;
}

function getRecentErrorCount() {
  const db = getDb();
  const cutoff = new Date(Date.now() - CONFIG.ERROR_PAUSE_HOURS * 3600 * 1000).toISOString();
  const row = db.prepare("SELECT SUM(errors) as e FROM playwright_cycles WHERE started_at > ?").get(cutoff);
  db.close();
  return row?.e || 0;
}

function startCycleLog() {
  const db = getDb();
  const result = db.prepare("INSERT INTO playwright_cycles (started_at) VALUES (datetime('now'))").run();
  db.close();
  return result.lastInsertRowid;
}

function endCycleLog(cycleId, stats) {
  const db = getDb();
  db.prepare(`UPDATE playwright_cycles SET ended_at = datetime('now'),
              posts_checked = ?, proposals_created = ?, errors = ?, notes = ? WHERE id = ?`)
    .run(stats.postsChecked, stats.proposalsCreated, stats.errors, stats.notes || '', cycleId);
  db.close();
}

function getThread(postUrn) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM thread_memory WHERE post_urn = ?").get(postUrn);
  db.close();
  return row;
}

function saveThread(data) {
  const db = getDb();
  const publishedAt = resolvePublishedAt(data.postUrn);
  db.prepare(`
    INSERT INTO thread_memory (post_urn, post_text, post_author, post_url, thread_json, our_replies_json, comment_count, post_published_at, last_scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_urn) DO UPDATE SET
      thread_json = excluded.thread_json,
      our_replies_json = excluded.our_replies_json,
      comment_count = excluded.comment_count,
      post_published_at = COALESCE(excluded.post_published_at, thread_memory.post_published_at),
      last_scraped_at = datetime('now')
  `).run(data.postUrn, data.postText || '', data.postAuthor || '', data.postUrl || '',
         JSON.stringify(data.thread), JSON.stringify(data.ourReplies), data.thread.length, publishedAt);
  db.close();
}

function isNotificationProcessed(notifId) {
  const db = getDb();
  const row = db.prepare("SELECT 1 FROM processed_notifications WHERE notification_id = ?").get(notifId);
  db.close();
  return !!row;
}

function markNotificationProcessed(notifId, type, postUrn, actor) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO processed_notifications (notification_id, type, post_urn, actor_name) VALUES (?, ?, ?, ?)")
    .run(notifId, type, postUrn, actor);
  db.close();
}

function saveThreadComments(postUrn, comments, ourName) {
  if (DRY_RUN || !comments?.length) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO thread_comments
      (post_urn, comment_urn, parent_comment_urn, author_name, author_headline, comment_text, comment_created_at, is_our_comment, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const tx = db.transaction((rows) => {
    for (const c of rows) {
      if (!c.commentUrn) continue;
      const isOurs = (c.author?.includes('Bartosz') || c.author?.includes(ourName)) ? 1 : 0;
      insert.run(
        postUrn,
        c.commentUrn,
        c.parentCommentUrn || c.replyToUrn || null,
        c.author || '',
        c.authorHeadline || '',
        c.text || '',
        c.createdAt || null,
        isOurs,
      );
    }
  });
  tx(comments);
  db.close();
}

// validateProposal + computeComposite → przeniesione do lib/comment-gen.mjs (import na górze)

function saveProposal(p) {
  if (DRY_RUN) { log(`  [DRY-RUN] Skip save: ${p.proposedReply.slice(0, 60)}...`); return 'dry-run'; }
  const db = getDb();
  const contextJson = JSON.stringify(p.contextUsed || []);
  // pre-send walidacja strukturalna + notatki z fact-check passa (C) → status='blocked'
  const notes = [
    ...validateProposal({ proposedReply: p.proposedReply, sourceText: p.commentText }, db),
    ...(Array.isArray(p.extraNotes) ? p.extraNotes : []),
  ];
  const status = notes.length > 0 ? 'blocked' : 'pending';
  const composite = computeComposite(p.scoring || {});
  if (notes.length > 0) log(`  🚫 BLOCKED (${notes.join(', ')}): ${p.proposedReply.slice(0, 60)}...`);
  db.prepare(`
    INSERT OR IGNORE INTO reply_proposals
    (type, source_id, source_text, source_author, post_urn, post_text,
     proposed_reply, original_reply, lead_score, troll_risk, engagement_value, thread_context,
     temperature, tone, context_used, reasoning, parent_in_tree, status,
     validation_notes, composite_score)
    VALUES ('comment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.commentUrn, p.commentText, p.commentAuthor, p.postUrn, p.postText.slice(0, 500),
         p.proposedReply, p.proposedReply, p.scoring.lead_score || 0, p.scoring.troll_risk || 0,
         p.scoring.engagement_value || 0, p.threadContext.slice(0, 4000),
         p.temperature || 3, p.tone || 'neutral', contextJson, (p.reasoning || '').slice(0, 500),
         p.parentInTree || p.commentUrn, status,
         notes.length ? JSON.stringify(notes) : null, composite);
  db.close();
  log(`  💾 Propozycja ${status === 'blocked' ? '🚫 BLOCKED' : 'zapisana'} (score=${composite}/10 temp=${p.temperature} tone=${p.tone}): ${p.proposedReply.slice(0, 60)}...`);
  return status;
}

// ── DEDUP PER-KOMENTARZ (B0) ──────────────────────────────────────────────────
// Komentarz uznajemy za obsłużony gdy: mamy już propozycję na ten URN (pending/approved/sent)
// LUB w drzewie istnieje NASZA odpowiedź będąca jego dzieckiem (wysłana).
// To zastępuje stary dedup po URN POSTA, który blokował całe posty (root cause incydentu).
function isCommentHandled(commentUrn) {
  if (!commentUrn) return false;
  const db = getDb();
  try {
    // Dedup po KOMENTARZU niezależnie od statusu: jeśli komentarz ma JAKĄKOLWIEK propozycję (też 'rejected'),
    // NIE proponuj ponownie. Wcześniej 'rejected' było pominięte → odrzucone wracały jako nowe 'pending'
    // (objaw: „odrzucam komentarze i się nie odrzucają").
    const prop = db.prepare(
      "SELECT 1 FROM reply_proposals WHERE source_id = ? LIMIT 1"
    ).get(commentUrn);
    if (prop) return true;
    const replied = db.prepare(
      "SELECT 1 FROM thread_comments WHERE parent_comment_urn = ? AND is_our_comment = 1 LIMIT 1"
    ).get(commentUrn);
    return !!replied;
  } catch { return false; }
  finally { db.close(); }
}

// ── FULL-SWEEP (B) ─────────────────────────────────────────────────────────────
// Ostatnie opublikowane posty ze scheduler.db — skanowane NIEZALEŻNIE od notyfikacji,
// żeby (a) odpisać „na wszystkie" i (b) odświeżać drzewko co cykl.
function getRecentPostsForSweep() {
  const seen = new Set();
  const out = [];
  const add = (urn, src) => {
    if (!urn || seen.has(urn)) return;
    seen.add(urn);
    out.push({ notifId: urn, postUrl: `https://www.linkedin.com/feed/update/${urn}/`, source: src });
  };
  // 0) NAJWYŻSZY PRIORYTET: ręczne żądania z dashboardu („Pobierz komentarze do postu") — skanuj NAJPIERW, potem wyczyść.
  try {
    const db = getDb();
    const prio = db.prepare(`SELECT post_urn AS u FROM priority_scrape ORDER BY requested_at ASC LIMIT ?`).all(CONFIG.SWEEP_POST_LIMIT);
    for (const r of prio) add(r.u, 'priority');
    if (prio.length && !DRY_RUN) db.prepare(`DELETE FROM priority_scrape`).run();
    db.close();
    if (prio.length) log(`  ⭐ Priority scrape (z dashboardu): ${prio.length} post(ów)`);
  } catch (e) { log(`  ⚠️  Priority scrape read: ${e.message}`); }

  // 1) PRIORYTET: posty z NIEODPOWIEDZIANYMI cudzymi komentarzami (engage.db) — to gwarantuje
  //    że „każdy komentarz który wymaga odpowiedzi" trafi do skanu (źródłem NIE jest scheduler.db,
  //    bo komentarze są też na postach nie-schedulowanych narzędziem).
  try {
    const db = getDb();
    const unanswered = db.prepare(`
      SELECT tc.post_urn AS u, COUNT(*) AS c FROM thread_comments tc
      WHERE tc.is_our_comment = 0 AND tc.post_urn IS NOT NULL AND tc.post_urn != ''
        AND NOT EXISTS (SELECT 1 FROM reply_proposals rp WHERE rp.source_id = tc.comment_urn)
        AND NOT EXISTS (SELECT 1 FROM thread_comments r WHERE r.parent_comment_urn = tc.comment_urn AND r.is_our_comment = 1)
      GROUP BY tc.post_urn ORDER BY c DESC LIMIT ?
    `).all(CONFIG.SWEEP_POST_LIMIT);
    for (const r of unanswered) add(r.u, 'unanswered');
    // 2) ostatnio scrapowane posty (thread_memory) — odświeżenie drzewka
    const recent = db.prepare(`SELECT post_urn AS u FROM thread_memory WHERE post_urn IS NOT NULL ORDER BY last_scraped_at DESC LIMIT ?`).all(CONFIG.SWEEP_POST_LIMIT);
    for (const r of recent) add(r.u, 'recent');
    db.close();
  } catch (e) { log(`  ⚠️  Sweep engage.db: ${e.message}`); }
  // 3) nowe posty ze scheduler.db (świeżo opublikowane, przed 1. scrape)
  try {
    const sch = new Database(join(homedir(), '.linkedin-mcp', 'scheduler.db'), { readonly: true });
    const cutoff = new Date(Date.now() - CONFIG.SWEEP_DAYS * 86400 * 1000).toISOString();
    const rows = sch.prepare(
      `SELECT post_urn AS u FROM scheduled_posts
       WHERE post_urn IS NOT NULL AND post_urn != ''
         AND COALESCE(published_at, publish_at, '') >= ?
       ORDER BY COALESCE(published_at, publish_at) DESC LIMIT ?`
    ).all(cutoff, CONFIG.SWEEP_POST_LIMIT);
    sch.close();
    for (const r of rows) add(r.u, 'scheduler');
  } catch (e) { log(`  ⚠️  Sweep scheduler.db: ${e.message}`); }
  return out;
}

// ── HEARTBEAT / HEALTH (H) ─────────────────────────────────────────────────────
function writeHeartbeat({ postsChecked, proposalsCreated, ok }) {
  if (DRY_RUN) return;
  try {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS daemon_health (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_run_at TEXT, last_ok_at TEXT,
      posts_checked INTEGER, proposals_created INTEGER,
      consecutive_zero INTEGER DEFAULT 0, updated_at TEXT
    );`);
    const prev = db.prepare("SELECT consecutive_zero FROM daemon_health WHERE id = 1").get();
    const prevZero = prev?.consecutive_zero || 0;
    const consecutiveZero = postsChecked === 0 ? prevZero + 1 : 0;
    db.prepare(`
      INSERT INTO daemon_health (id, last_run_at, last_ok_at, posts_checked, proposals_created, consecutive_zero, updated_at)
      VALUES (1, datetime('now'), CASE WHEN ? THEN datetime('now') ELSE (SELECT last_ok_at FROM daemon_health WHERE id=1) END, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        last_run_at = datetime('now'),
        last_ok_at = CASE WHEN ? THEN datetime('now') ELSE daemon_health.last_ok_at END,
        posts_checked = excluded.posts_checked,
        proposals_created = excluded.proposals_created,
        consecutive_zero = excluded.consecutive_zero,
        updated_at = datetime('now')
    `).run(ok ? 1 : 0, postsChecked, proposalsCreated, consecutiveZero, ok ? 1 : 0);
    db.close();
  } catch (e) { log(`  ⚠️  Heartbeat zapis nieudany: ${e.message}`); }
}

// loadPersona / loadGuideline / callClaude → przeniesione do lib/comment-gen.mjs (import na górze)

// buildPrompt / detectLanguage / parseClaudeJson → przeniesione do lib/comment-gen.mjs (import na górze)

// ── PLAYWRIGHT SCRAPING ─────────────────────────────────────────────────────

async function fetchNotifications(page) {
  log('  Ładuję notyfikacje...');
  // filter=my_posts_all — LinkedIn pokazuje TYLKO notyfikacje pod moimi postami (komentarze + wzmianki)
  // dużo mniej hałasu niż filter=all (nie ma likes/follows/trendów cudzych)
  await page.goto('https://www.linkedin.com/notifications/?filter=my_posts_all', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay();

  try {
    await page.waitForSelector('article.nt-card', { timeout: 10000 });
  } catch {
    log('  ⚠️  Brak kart notyfikacji w DOM (article.nt-card) — strona pusta lub LinkedIn zmienił layout');
    return [];
  }

  // Wyciągnij i klasyfikuj wszystkie notyfikacje
  const allNotifs = await page.evaluate(() => {
    function classify(text) {
      if (/skomentował.{0,40}(twoj|twój)/i.test(text)) return 'OUR_POST_COMMENT';
      if (/odpisał.{0,40}(twoj|twój|tobie)/i.test(text)) return 'OUR_COMMENT_REPLY';
      if (/(wspomniał|@.{0,20}bartosz|mentioned you)/i.test(text)) return 'MENTION';
      if (/zareagował.{0,40}(twoj|twój)/i.test(text)) return 'OUR_POST_REACTION';
      if (/commented on your/i.test(text)) return 'OUR_POST_COMMENT';
      if (/replied to your/i.test(text)) return 'OUR_COMMENT_REPLY';
      return 'OTHER';
    }
    function extractActivityUrn(url) {
      const m = url.match(/urn(?:%3A|:)li(?:%3A|:)(activity|ugcPost)(?:%3A|:)(\d+)/);
      return m ? `urn:li:${m[1]}:${m[2]}` : null;
    }
    const cards = document.querySelectorAll('article.nt-card');
    const out = [];
    cards.forEach((c, i) => {
      const text = (c.innerText || '').replace(/\s+/g, ' ').trim();
      const type = classify(text);
      const links = Array.from(c.querySelectorAll('a')).map(a => a.href);
      const postLink = links.find(l => /urn(:|%3A)li/.test(l)) || links[1] || links[0];
      const activityUrn = postLink ? extractActivityUrn(postLink) : null;
      out.push({
        idx: i + 1, type, snippet: text.slice(0, 200),
        postUrl: postLink || '', activityUrn,
        unread: c.classList.contains('nt-card--unread'),
      });
    });
    return out;
  });

  // Statystyki typów (dla logów)
  const byType = {};
  allNotifs.forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
  const typesStr = Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ');
  log(`  ${allNotifs.length} notyfikacji w sumie: ${typesStr}`);

  // Tylko te dotyczące NASZYCH postów / wzmianek
  const interesting = allNotifs.filter(n =>
    ['OUR_POST_COMMENT', 'OUR_COMMENT_REPLY', 'MENTION'].includes(n.type)
    && n.activityUrn && n.postUrl
  );

  log(`  → Do odpowiedzi (komentarze/wzmianki pod Twoimi postami): ${interesting.length}`);

  if (interesting.length === 0) {
    log('  ℹ️  Brak komentarzy do odpowiedzi w tej chwili. Inne typy (FYI, trends) pominięte.');
  } else {
    interesting.forEach(n => log(`     • [${n.type}] ${n.snippet.slice(0, 100)}`));
  }

  return interesting.slice(0, CONFIG.MAX_POSTS_PER_CYCLE).map(n => ({
    notifId: n.activityUrn,
    postUrl: n.postUrl,
    snippet: n.snippet,
    type: n.type,
  }));
}

// Nawigacja z retry (B0): LinkedIn / sieć potrafią rzucić ERR_INTERNET_DISCONNECTED / timeout.
async function gotoWithRetry(page, url, opts = {}) {
  const tries = (CONFIG.GOTO_RETRIES || 0) + 1;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000, ...opts });
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) { log(`  ↻ goto retry ${i + 1}/${tries - 1} (${e.message.slice(0, 50)})`); await sleep(randInt(3000, 8000)); }
    }
  }
  throw lastErr;
}

async function scrapePostThread(page, postUrl) {
  log(`  → ${postUrl.slice(0, 80)}`);
  await gotoWithRetry(page, postUrl);
  await humanDelay();

  // Rozwijaj "View more comments" AŻ ZNIKNIE (cel: WSZYSTKIE komentarze, nie pierwsze ~30)
  for (let i = 0; i < 12; i++) {
    try {
      const btn = await page.$('button.comments-comments-list__load-more-comments-button, button[aria-label*="more comments"], button[aria-label*="więcej komentarzy"]');
      if (!btn) break;
      await btn.click();
      await sleep(randInt(1500, 4000));
    } catch { break; }
  }

  // Rozwiń WSZYSTKIE "Show N replies" (cap bezpieczeństwa 40) — odpowiedzi POD komentarzami też muszą wejść.
  // Re-query po rozwinięciu "more comments" (nowe wątki dochodzą do DOM).
  const replyButtons = await page.$$('button[aria-label*="repli"], button[aria-label*="odpowied"], button.comments-comment-item__show-replies-button');
  for (const btn of replyButtons.slice(0, 40)) {
    try { await btn.click(); await sleep(randInt(1000, 2500)); } catch {}
  }

  // DEFENSIVE: rozwiń obcięte komentarze ("więcej" / "see more")
  for (let i = 0; i < 3; i++) {
    const seeMoreBtns = await page.$$([
      'button.comments-comment-item__see-more',
      'button.comments-comment-text-collapsed__see-more-button',
      'button[aria-label="See more"]',
      'button[aria-label="see more"]',
      'button[aria-label="…więcej"]',
      'button[aria-label*="Zobacz więcej"]',
      'button[aria-label*="See more, visually"]',
    ].join(', '));
    if (seeMoreBtns.length === 0) break;
    log(`    📖 Rozwijam ${seeMoreBtns.length} obciętych komentarzy`);
    for (const b of seeMoreBtns) {
      try { await b.click({ timeout: 2000 }); await sleep(randInt(200, 500)); } catch {}
    }
    await sleep(randInt(800, 1500));
  }

  // Wyciągnij wszystkie komentarze z DOM (z kilkoma fallback selektorami)
  const data = await page.evaluate(() => {
    function findText(parent, selectors) {
      for (const s of selectors) {
        const el = parent.querySelector(s);
        if (el && el.innerText.trim()) return el.innerText.trim();
      }
      return '';
    }
    const postText = findText(document, [
      '.feed-shared-update-v2__description',
      '.feed-shared-update-v2 .update-components-text',
      '.update-components-update-v2__commentary',
      '[data-test-id="main-feed-activity-card"] .update-components-text',
    ]);
    const postAuthor = findText(document, [
      '.update-components-actor__name',
      '.feed-shared-actor__name',
      '.update-components-actor__title',
    ]);

    const items = document.querySelectorAll('.comments-comment-entity, .comments-comment-item, article.comments-comment-item');
    const comments = [];
    items.forEach(it => {
      const author = findText(it, [
        '.comments-comment-meta__description-title',
        '.comments-post-meta__name-text',
        '.comments-comment-meta__actor a',
      ]);
      const text = findText(it, [
        '.comments-comment-item__main-content',
        '.comments-comment-entity__main-content',
        '.update-components-text',
        '.feed-shared-text',
      ]);
      const urnAttr = it.getAttribute('data-id') || it.getAttribute('data-urn') || '';
      const isReply = !!it.closest('.comments-comment-item--reply, .comments-comment-list__nested, .comments-comment-entity--reply');
      if (!text || !author) return;
      // DETERMINISTYCZNE DRZEWKO: dla odpowiedzi znajdź URN komentarza-rodzica (najbliższy nadrzędny entity z data-id).
      let parentCommentUrn = null;
      if (isReply) {
        let p = it.parentElement;
        while (p) {
          if (p.matches && p.matches('.comments-comment-entity, .comments-comment-item, article.comments-comment-item')) {
            parentCommentUrn = p.getAttribute('data-id') || p.getAttribute('data-urn') || null;
            break;
          }
          p = p.parentElement;
        }
      }
      comments.push({
        commentUrn: urnAttr || author + '_' + text.slice(0, 30),
        author, text, isReply, parentCommentUrn,
      });
    });
    return { postText, postAuthor, comments };
  });

  log(`    Autor posta: "${data.postAuthor}" | komentarze: ${data.comments.length}`);

  // KRYTYCZNE: sprawdź czy to NASZ post
  const isOurPost = /bartosz.*gaca|gaca.*bartosz/i.test(data.postAuthor);
  if (!isOurPost && data.postAuthor) {
    log(`    ⊘ POMIJAM: post nie jest Twój (autor: ${data.postAuthor})`);
    data.skip = true;
  }
  if (!data.postAuthor) {
    log(`    ⚠️  Nie udało się ustalić autora posta — skipping for safety`);
    data.skip = true;
  }

  return data;
}

// ── MAIN CYCLE ──────────────────────────────────────────────────────────────

async function runCycle() {
  log('=== Start cyklu ===');
  if (DRY_RUN) log('⚠️  DRY-RUN MODE: bez zapisu do DB');

  // G: generowanie 24/7 (SCAN_24_7). Wysyłkę i tak dławi sender (okno 8-22).
  if (!CONFIG.SCAN_24_7 && !isActiveHour()) {
    log('  Poza godzinami aktywnymi. Skip.');
    return { skipped: true };
  }

  if (getTodayCycleCount() >= CONFIG.MAX_CYCLES_PER_DAY) {
    log(`  Dzienny limit ${CONFIG.MAX_CYCLES_PER_DAY} cykli osiągnięty. Skip.`);
    return { skipped: true };
  }

  if (getRecentErrorCount() >= CONFIG.MAX_ERRORS_BEFORE_PAUSE) {
    log(`  Zbyt wiele błędów (${CONFIG.MAX_ERRORS_BEFORE_PAUSE}+) w ostatnich ${CONFIG.ERROR_PAUSE_HOURS}h. Pauza.`);
    return { skipped: true };
  }

  const cycleId = DRY_RUN ? null : startCycleLog();
  const stats = { postsChecked: 0, proposalsCreated: 0, errors: 0, notes: '' };
  let context;
  let timedOut = false;

  // B0: cała praca cyklu w jednym promisie + hard-timeout (anti-hang).
  const work = (async () => {
    log('  Uruchamiam Playwright...');
    await ensureProfileFree(CONFIG.PROFILE_DIR);
    context = await chromium.launchPersistentContext(CONFIG.PROFILE_DIR, {
      headless: CONFIG.HEADLESS,
      channel: 'chrome',
      viewport: CONFIG.VIEWPORT,
      userAgent: CONFIG.USER_AGENT,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    });
    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

    const persona = loadPersona();

    // ── ŹRÓDŁA POSTÓW: notyfikacje (szybka ścieżka) ∪ FULL-SWEEP (gwarancja „na wszystkie") ──
    let notifs = [];
    try { notifs = await fetchNotifications(page); }
    catch (e) { log(`  ⚠️  Notyfikacje padły (${e.message.slice(0, 60)}) — lecę samym sweepem`); }
    const sweep = getRecentPostsForSweep();
    const seen = new Set();
    const targets = [];
    for (const t of [...notifs, ...sweep]) {
      if (!t.notifId || seen.has(t.notifId)) continue;
      seen.add(t.notifId);
      targets.push(t);
    }
    log(`  📋 Posty do skanu: ${targets.length} (notif=${notifs.length} ∪ sweep=${sweep.length}, po dedup)`);

    for (const t of targets) {
      if (timedOut) break;
      if (stats.proposalsCreated >= CONFIG.MAX_PROPOSALS_PER_CYCLE) {
        log(`  Limit ${CONFIG.MAX_PROPOSALS_PER_CYCLE} propozycji/cykl — reszta w kolejnym cyklu.`);
        break;
      }
      if (stats.postsChecked >= CONFIG.MAX_POSTS_PER_CYCLE) {
        log(`  Limit ${CONFIG.MAX_POSTS_PER_CYCLE} postów/cykl.`);
        break;
      }
      stats.postsChecked++;
      try {
        await processPost(page, persona, t, stats);
        await sleep(randInt(4000, 10000)); // pauza jak człowiek
      } catch (e) {
        log(`    ❌ Błąd przy poście ${String(t.notifId).slice(-18)}: ${e.message}`);
        stats.errors++;
      }
    }
  })();

  try {
    await Promise.race([
      work,
      new Promise((_, rej) => setTimeout(() => {
        timedOut = true;
        rej(new Error(`CYCLE_TIMEOUT ${CONFIG.CYCLE_TIMEOUT_MS / 1000}s`));
      }, CONFIG.CYCLE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    log(`❌ Błąd/timeout cyklu: ${e.message}`);
    stats.errors++;
    stats.notes = e.message.slice(0, 500);
  } finally {
    if (context) await context.close().catch(() => {});
    if (cycleId) endCycleLog(cycleId, stats);
    writeHeartbeat({ postsChecked: stats.postsChecked, proposalsCreated: stats.proposalsCreated, ok: stats.errors === 0 });
    log(`=== Koniec: ${stats.postsChecked} postów sprawdzonych, ${stats.proposalsCreated} propozycji, ${stats.errors} błędów ===\n`);
  }

  return stats;
}

// Przetwarza JEDEN post: scrape → zapis drzewka → odpowiedz na WSZYSTKIE nieobsłużone komentarze (B + C).
async function processPost(page, persona, target, stats) {
  const data = await scrapePostThread(page, target.postUrl);
  if (data.skip) return;
  if (!data.comments.length) { log('    Brak komentarzy do analizy'); return; }

  const ourName = 'Bartosz Gaca';
  const isOurs = (a) => !!a && (a.includes('Bartosz') || a.includes(ourName));
  const ourReplies = data.comments.filter(c => isOurs(c.author)).map(c => c.text);

  // Zapis drzewka → odświeża dashboard „drzewko" + pamięć wątku (KAŻDY cykl, nie tylko nowe)
  if (!DRY_RUN) {
    saveThread({ postUrn: target.notifId, postText: data.postText, postAuthor: data.postAuthor, postUrl: target.postUrl, thread: data.comments, ourReplies });
    saveThreadComments(target.notifId, data.comments, ourName);
  }

  // B: WSZYSTKIE nieobsłużone, nie-nasze komentarze (top-level + odpowiedzi POD komentarzami).
  // Dedup per-komentarz (B0) zamiast per-post → nowe komentarze pod starym postem też wejdą.
  const todo = data.comments.filter(c => !isOurs(c.author) && c.text && !isCommentHandled(c.commentUrn));
  if (!todo.length) { log(`    ↪ Wszystkie ${data.comments.length} komentarzy już obsłużone.`); return; }
  log(`    🎯 ${todo.length} nieobsłużonych komentarzy (z ${data.comments.length} w wątku)`);

  const threadContext = data.comments.map(c => `${c.author}: "${c.text}"`).join('\n');

  for (const targetComment of todo) {
    if (stats.proposalsCreated >= CONFIG.MAX_PROPOSALS_PER_CYCLE) break;
    log(`    Target: ${targetComment.author}: "${targetComment.text.slice(0, 60)}..."`);

    // RAG: dociągnij prawdziwe fakty z bazy wiedzy (stacki, projekty) pod ten komentarz
    const kb = retrieveKnowledge(targetComment.text + ' ' + (data.postText || ''));
    if (kb.sources.length) log(`    📚 Baza wiedzy: ${kb.sources.join(', ')}`);

    const prompt = buildPrompt({ persona, postText: data.postText, postAuthor: data.postAuthor, thread: data.comments, ourReplies, targetComment, knowledge: kb.text });
    log(`    🧠 Opus 4.8 generuje (timeout ${CONFIG.CLAUDE_TIMEOUT_MS / 1000}s)...`);
    const parsed = parseClaudeJson(await callClaude(prompt, { log }));
    if (!parsed || !parsed.reply) { log('    ⚠️  Brak poprawnego JSON/reply od Opusa — skip'); stats.errors++; continue; }

    log(`    Score: lead=${parsed.lead_score} troll=${parsed.troll_risk} engage=${parsed.engagement_value} | temp=${parsed.temperature} tone=${parsed.tone}`);

    // C: drugi przebieg Opus 4.8 — POTWIERDŹ, że odpowiedź nie kłamie (grounding gate, z bazą wiedzy).
    let reply = parsed.reply;
    const extraNotes = [];
    try {
      const fc = await factCheck({ postText: data.postText, threadContext, proposedReply: reply, persona, knowledge: kb.text }, { log });
      if (fc.grounded === false) {
        if (fc.fixed_reply) { log(`    🛡️  Fact-check: poprawiono (${fc.unsupported_claims.length} konkretów bez pokrycia)`); reply = fc.fixed_reply; }
        else {
          extraNotes.push('HALLUCINATION_RISK', ...fc.unsupported_claims.slice(0, 3).map(c => 'CLAIM:' + String(c).slice(0, 60)));
          log(`    🚫 Fact-check: HALLUCINATION_RISK — blokuję (${fc.unsupported_claims.length} konkretów)`);
        }
      }
    } catch (e) { log(`    ⚠️  Fact-check padł (${e.message.slice(0, 40)}) — przepuszczam do walidacji strukturalnej`); }

    const status = saveProposal({
      commentUrn: targetComment.commentUrn,
      commentText: targetComment.text,
      commentAuthor: targetComment.author,
      postUrn: target.notifId,
      postText: data.postText,
      proposedReply: reply,
      scoring: { lead_score: parsed.lead_score, troll_risk: parsed.troll_risk, engagement_value: parsed.engagement_value },
      threadContext,
      temperature: parsed.temperature || 3,
      tone: parsed.tone || 'neutral',
      contextUsed: Array.isArray(parsed.context_used) ? parsed.context_used : [],
      reasoning: parsed.reasoning || '',
      parentInTree: targetComment.commentUrn,
      extraNotes,
    });
    if (status) stats.proposalsCreated++;

    await sleep(randInt(2000, 5000));
  }
}

// ── SCHEDULER ───────────────────────────────────────────────────────────────

async function scheduleNext() {
  const delayMs = nextDelay();
  const nextTime = new Date(Date.now() + delayMs);
  log(`Następne sprawdzenie: ${nextTime.toLocaleString('pl-PL')} (za ${Math.round(delayMs / 60000)} min)`);
  setTimeout(async () => {
    await runCycle().catch((e) => log(`Crash cyklu: ${e.message}`));
    scheduleNext();
  }, delayMs);
}

// ── START ───────────────────────────────────────────────────────────────────

log(`Auto-Comment Playwright v1 ${DRY_RUN ? '(DRY-RUN)' : ''}`);
log(`Profile: ${CONFIG.PROFILE_DIR}`);
log(`Limity: ${CONFIG.MAX_CYCLES_PER_DAY} cykli/dobę × ${CONFIG.MAX_PROPOSALS_PER_CYCLE} propozycji = max ${CONFIG.MAX_CYCLES_PER_DAY * CONFIG.MAX_PROPOSALS_PER_CYCLE}/dobę`);
log(`Skan: ${CONFIG.SCAN_24_7 ? '24/7 (generowanie)' : `${CONFIG.ACTIVE_HOURS_UTC.start}-${CONFIG.ACTIVE_HOURS_UTC.end} UTC`} | model: claude-opus-4-8 | wysyłkę dławi sender (okno 8-22)`);

if (RUN_ONCE) {
  runCycle().then((stats) => {
    log(`Run-once zakończony: ${JSON.stringify(stats)}`);
    process.exit(stats?.errors > 0 ? 1 : 0);
  }).catch((e) => {
    log(`Fatal: ${e.message}`);
    process.exit(1);
  });
} else {
  const initDelay = randInt(3, 10) * 60 * 1000;
  log(`Start za ${Math.round(initDelay / 60000)} min (initial delay)`);
  setTimeout(async () => {
    await runCycle().catch((e) => log(`Crash inicjalny: ${e.message}`));
    scheduleNext();
  }, initDelay);
}
