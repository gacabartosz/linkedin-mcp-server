#!/usr/bin/env node
/**
 * Phase 0 v2 — per-URN navigation (replacement for v1 scrape approach,
 * which failed due to LinkedIn activity-feed virtualization).
 *
 * Read-only. Open Playwright z autoryzowanym ~/.linkedin-mcp/browser-profile,
 * dla każdego post_urn z DB odwiedza /feed/update/<URN>/ i klasyfikuje:
 *
 *   ALIVE       — strona ładuje post (selector .feed-shared-update-v2 albo title contains author)
 *   DELETED     — strona pokazuje "ten post jest niedostępny" / "this post isn't available"
 *                 lub redirect do login/signup
 *   RESTRICTED  — strona ładuje się ale brak treści (private / restricted)
 *   ERROR       — timeout / nawigacja padła
 *
 * Output: ~/.linkedin-mcp/reports/audit-YYYY-MM-DD.md + .csv (nadpisuje v1)
 *
 * Usage:
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/audit-live-vs-db-v2.mjs
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/audit-live-vs-db-v2.mjs --limit 5  # smoke test
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/audit-live-vs-db-v2.mjs --headed   # widoczna przeglądarka
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const PROFILE = join(homedir(), '.linkedin-mcp', 'browser-profile');
const REPORT_DIR = join(homedir(), '.linkedin-mcp', 'reports');

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const HEADED = args.includes('--headed');

const log = (m) => console.log(`[audit-v2] ${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function urnToFeedUrl(urn) {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
}

function preview(text, n = 90) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').slice(0, n);
}

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Klasyfikuje stan postu odwiedzając jego URL.
 * Kontrakt:
 *   - jeśli redirect do /signup lub /login → DELETED (post niedostępny publicznie i nawet zalogowany owner nie może go zobaczyć)
 *   - jeśli URL zawiera "/feed/update/" ale brak selectora postu w ciągu 6s → RESTRICTED
 *   - jeśli pojawi się tekst "post jest niedostępny", "post isn't available", "not found" → DELETED
 *   - jeśli pojawi się selector .feed-shared-update-v2 lub .scaffold-finite-scroll → ALIVE
 */
async function classifyPost(page, urn) {
  const url = urnToFeedUrl(urn);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  } catch (e) {
    return { state: 'ERROR', detail: 'goto: ' + e.message.slice(0, 80) };
  }

  await sleep(1500);

  const currentUrl = page.url();
  if (/\/signup|\/login|\/authwall/i.test(currentUrl)) {
    return { state: 'DELETED', detail: 'redirect-to-' + currentUrl.match(/\/(signup|login|authwall)/i)[1] };
  }

  // Wait briefly for post content OR error
  let hasPost = false;
  let bodyText = '';
  try {
    await page.waitForSelector(
      '.feed-shared-update-v2, .scaffold-finite-scroll, .update-components-text, [data-urn*="urn:li"]',
      { timeout: 6000 }
    );
    hasPost = true;
  } catch {
    // No post selector — check for error message
  }

  try {
    bodyText = (await page.locator('body').innerText({ timeout: 2000 })) || '';
  } catch {}

  const lower = bodyText.toLowerCase();
  if (
    /this post (is unavailable|isn'?t available|couldn'?t be found)/i.test(bodyText) ||
    /ten post (jest niedostępny|nie jest dostępny|został usunięty)/i.test(bodyText) ||
    /page not found|nie znaleziono strony|404/.test(lower)
  ) {
    return { state: 'DELETED', detail: 'error-message-on-page' };
  }

  if (hasPost) {
    const title = await page.title().catch(() => '');
    return { state: 'ALIVE', detail: 'has-post-selector', title: title.slice(0, 80) };
  }

  return { state: 'RESTRICTED', detail: 'no-post-no-error' };
}

async function main() {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  if (!existsSync(PROFILE)) {
    console.error('FATAL: brak browser-profile przy', PROFILE);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });
  let dbRows = db
    .prepare(
      `SELECT id, post_urn, text, published_at, status, imported_from
       FROM scheduled_posts
       WHERE post_urn IS NOT NULL
         AND status IN ('published','failed')
       ORDER BY published_at DESC`
    )
    .all();
  db.close();

  if (LIMIT) dbRows = dbRows.slice(0, LIMIT);
  log(`DB: ${dbRows.length} posts z URN do sprawdzenia per-URN navigation`);

  log(`Launching Chromium with persistent profile (${PROFILE})`);
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: !HEADED,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const results = [];
  let alive = 0, deleted = 0, restricted = 0, errored = 0;

  for (let i = 0; i < dbRows.length; i++) {
    const r = dbRows[i];
    const cls = await classifyPost(page, r.post_urn);
    results.push({ ...r, ...cls });
    if (cls.state === 'ALIVE') alive++;
    else if (cls.state === 'DELETED') deleted++;
    else if (cls.state === 'RESTRICTED') restricted++;
    else errored++;

    const tag = cls.state.padEnd(10);
    const idx = String(i + 1).padStart(3);
    log(`[${idx}/${dbRows.length}] ${tag} ${r.post_urn}  ${preview(r.text, 50)}  (${cls.detail})`);

    if (i < dbRows.length - 1) await sleep(randInt(1500, 2800));
  }

  await context.close();

  const today = new Date().toISOString().slice(0, 10);
  const mdPath = join(REPORT_DIR, `audit-${today}.md`);
  const csvPath = join(REPORT_DIR, `audit-${today}.csv`);

  // CSV
  const csvHeader = 'id,post_urn,li_state,detail,imported_from,published_at,db_status,feed_url,text_preview';
  const csvLines = results.map((r) =>
    [
      r.id,
      r.post_urn,
      r.state,
      r.detail || '',
      r.imported_from || 'native',
      r.published_at || '',
      r.status,
      urnToFeedUrl(r.post_urn),
      preview(r.text, 200),
    ]
      .map(csvEscape)
      .join(',')
  );
  writeFileSync(csvPath, csvHeader + '\n' + csvLines.join('\n') + '\n');

  // MD
  const md = [];
  md.push(`# LinkedIn Posts Audit (v2) — ${today}`);
  md.push('');
  md.push(`**Metoda:** Per-URN Playwright nav z authenticated browser-profile. Każdy URN testowany osobno przez \`/feed/update/<URN>/\`.`);
  md.push('');
  md.push(`**DB:** ${dbRows.length} posts z URN`);
  md.push('');
  md.push('| Stan | Liczba | Znaczenie |');
  md.push('|---|---:|---|');
  md.push(`| ALIVE | ${alive} | strona renderuje post |`);
  md.push(`| DELETED | ${deleted} | redirect do signup/login/authwall lub komunikat o niedostępności |`);
  md.push(`| RESTRICTED | ${restricted} | strona ładuje ale brak selectora postu (private/limited reach?) |`);
  md.push(`| ERROR | ${errored} | timeout / błąd nawigacji — re-run |`);
  md.push('');
  if (deleted > 0) {
    md.push(`> 🔴 **${deleted} postów oznaczonych w DB jako \`published\` jest niedostępnych na LinkedIn.** To prawdopodobna przyczyna spadku impresji — algorytm nie widzi historii, której nie ma.`);
    md.push('');
  }
  md.push('---');
  md.push('');

  for (const stateKey of ['DELETED', 'RESTRICTED', 'ERROR', 'ALIVE']) {
    const subset = results.filter((r) => r.state === stateKey);
    if (subset.length === 0) continue;
    md.push(`## ${stateKey} (${subset.length})`);
    md.push('');
    md.push('| # | Data publikacji | URN | Źródło | Detail | Otwórz | Podgląd |');
    md.push('|---:|---|---|---|---|---|---|');
    subset.forEach((r, idx) => {
      const date = r.published_at ? r.published_at.slice(0, 10) : '?';
      const src = r.imported_from || 'native';
      const link = `[LI](${urnToFeedUrl(r.post_urn)})`;
      const urnShort = (r.post_urn || '').replace('urn:li:', '');
      md.push(
        `| ${idx + 1} | ${date} | \`${urnShort}\` | ${src} | ${r.detail || ''} | ${link} | ${preview(r.text, 80)} |`
      );
    });
    md.push('');
  }

  md.push('---');
  md.push('');
  md.push('**Pliki:**');
  md.push(`- MD:  \`${mdPath}\``);
  md.push(`- CSV: \`${csvPath}\``);

  writeFileSync(mdPath, md.join('\n'));

  log('');
  log(`SUMMARY: ${alive} alive · ${deleted} deleted · ${restricted} restricted · ${errored} errored`);
  log(`MD:  ${mdPath}`);
  log(`CSV: ${csvPath}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
