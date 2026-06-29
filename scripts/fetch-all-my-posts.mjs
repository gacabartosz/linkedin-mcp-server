#!/usr/bin/env node
/**
 * Fetch FULL post history from LinkedIn activity feed via Playwright.
 *
 * Cel: dodać do scheduler.db wszystkie posty których brakuje (np. starsze niż
 * pierwsza zapisana data, lub wystawione ręcznie z LinkedIn UI poza naszym daemon).
 *
 * Usage:
 *   node scripts/fetch-all-my-posts.mjs           # scroll do końca
 *   node scripts/fetch-all-my-posts.mjs --max 50  # max 50 postów
 *   node scripts/fetch-all-my-posts.mjs --dry-run
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const PROFILE = join(homedir(), '.linkedin-mcp', 'browser-profile');
const SCHEDULER_DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');

const args = process.argv.slice(2);
// Guard: domyślnie skrypt NIE wstawia do DB (po incydencie 2026-05-11 13:48 — 51 zassanych historycznych postów z błędnym published_at).
// Żeby faktycznie pisać do scheduler.db musisz świadomie podać --insert-historical.
const ALLOW_INSERT = args.includes('--insert-historical');
const DRY_RUN = !ALLOW_INSERT || args.includes('--dry-run');
const maxIdx = args.indexOf('--max');
const MAX_POSTS = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 100;
const SCROLL_ITERATIONS = 30;

const log = (m) => console.log(`[fetch-posts] ${new Date().toISOString().slice(11,19)} ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ── My profile URL (hardcoded — uniknij rate limit) ────────────────────────
const MY_PROFILE_URL = 'https://www.linkedin.com/in/bartoszgaca/';
async function getMyProfileUrl() { return MY_PROFILE_URL; }

// ── Scrape activity feed ───────────────────────────────────────────────────
async function scrapeActivityFeed(page, profileUrl) {
  // Bezpośrednio do POSTS (tylko posty, nie cała aktywność z likami/komentarzami)
  const activityUrl = profileUrl.replace(/\/$/, '') + '/recent-activity/all/';
  log(`Activity feed: ${activityUrl}`);
  // Większy timeout (60s) + 'load' zamiast 'domcontentloaded' — LinkedIn rate-limituje po szybkich nawigacjach
  try {
    await page.goto(activityUrl, { waitUntil: 'load', timeout: 60000 });
  } catch (e) {
    log(`  ⚠️ Timeout/error na goto: ${e.message.slice(0,80)} — kontynuuję mimo wszystko`);
  }
  // LinkedIn ładuje dynamicznie posty po DOMContentLoaded — czekaj na konkretny element
  log('  Czekam na pojawienie się posts container (max 30s)...');
  try {
    await page.waitForSelector('[data-urn*="urn:li"], .feed-shared-update-v2, .scaffold-finite-scroll', { timeout: 30000 });
    log('  ✅ Container załadowany');
  } catch {
    log('  ⚠️ Container nie pojawił się w 30s');
    // Screenshot dla debugowania
    try {
      await page.screenshot({ path: '/tmp/linkedin-activity-debug.png', fullPage: false });
      log('  📸 Screenshot zapisany: /tmp/linkedin-activity-debug.png');
      const url = page.url();
      log(`  Current URL: ${url}`);
      const title = await page.title();
      log(`  Page title: ${title}`);
    } catch {}
  }
  await sleep(randInt(5000, 8000));

  // Scroll do końca żeby załadować wszystkie posty
  let prevHeight = 0;
  for (let i = 0; i < SCROLL_ITERATIONS; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === prevHeight) {
      log(`  Scroll: koniec strony (po ${i+1} iteracji)`);
      break;
    }
    prevHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    log(`  Scroll ${i+1}/${SCROLL_ITERATIONS}, height=${currentHeight}`);
    await sleep(randInt(2500, 4000));
  }

  // Wyciągnij tylko MOJE oryginalne posty (nie reshare'y cudzych)
  const posts = await page.evaluate(() => {
    const results = [];
    const items = document.querySelectorAll('[data-urn*="activity"], [data-urn*="share"], [data-urn*="ugcPost"], .feed-shared-update-v2');
    items.forEach((item, idx) => {
      const urn = item.getAttribute('data-urn') || item.getAttribute('data-id') || '';
      if (!urn || (!urn.includes('activity') && !urn.includes('share') && !urn.includes('ugcPost'))) return;

      // KRYTYCZNE: na activity feed widać też posty że "Bartosz polubił..." / "Bartosz skomentował..."
      // Bierzemy TYLKO posty gdzie author = Bartosz Gaca (oryginalne publikacje)
      const authorEl = item.querySelector('.update-components-actor__name, .feed-shared-actor__name, .update-components-actor__title');
      const author = authorEl ? authorEl.innerText.trim() : '';
      if (!/bartosz.*gaca|gaca.*bartosz/i.test(author)) return;

      // Skip jeśli to reshare/repost (header pokazuje "Bartosz Gaca reposted this" / "udostępnił")
      const headerEl = item.querySelector('.update-components-header, .feed-shared-header');
      const headerText = headerEl ? headerEl.innerText.toLowerCase() : '';
      if (/reposted|repost|udostępnił|shared|polubił|liked|skomentował/.test(headerText)) return;

      // Text posta
      const textEl = item.querySelector('.feed-shared-update-v2__description, .update-components-text, .feed-shared-text');
      const text = textEl ? textEl.innerText.trim() : '';
      if (!text || text.length < 30) return;

      const timeEl = item.querySelector('time, .feed-shared-actor__sub-description, .update-components-actor__sub-description');
      const timeStr = timeEl ? timeEl.innerText.trim() : '';

      const linkEl = item.querySelector('a[href*="/posts/"], a[href*="/feed/update/"]');
      const link = linkEl ? linkEl.href : '';

      results.push({ urn, author, text, timeStr, link, idx });
    });
    return results;
  });

  log(`  Znaleziono ${posts.length} elementów aktywności w DOM`);
  return posts;
}

// ── Compare with DB and insert missing ─────────────────────────────────────
function findMissing(posts) {
  const db = new Database(SCHEDULER_DB, { readonly: true });
  // Bierzemy zarówno post_urn jak i text (do match po tekście — bo activity_id ≠ share_id)
  const existingRows = db.prepare("SELECT post_urn, text FROM scheduled_posts WHERE status='published' AND post_urn IS NOT NULL").all();
  db.close();

  const existingUrns = new Set(existingRows.map(r => r.post_urn));
  // Normalizacja tekstów: usuwa whitespace, lowercase, pierwsze 80 znaków
  const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  const existingTexts = new Set(existingRows.map(r => normalize(r.text)));

  return posts.filter(p => {
    if (existingUrns.has(p.urn)) return false;
    // Sprawdź po tekście (activity:XXX vs share:YYY to ten sam post)
    if (existingTexts.has(normalize(p.text))) return false;
    return true;
  });
}

function insertMissing(missingPosts) {
  if (DRY_RUN) {
    log(`[DRY-RUN] Wstawiłbym ${missingPosts.length} brakujących postów`);
    missingPosts.forEach(p => log(`  ${p.urn} — ${p.text.slice(0,60)}...`));
    return 0;
  }

  const db = new Database(SCHEDULER_DB);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO scheduled_posts (id, text, visibility, language, publish_at, status, post_urn, published_at, created_at, updated_at)
    VALUES (?, ?, 'PUBLIC', ?, ?, 'published', ?, ?, datetime('now'), datetime('now'))
  `);
  let inserted = 0;
  for (const p of missingPosts) {
    const id = randomUUID();
    const lang = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(p.text) ? 'pl' : 'en';
    // Snowflake decoding: timestamp = URN_id >> 22 (UNIX epoch, no offset)
    let publishAt = new Date().toISOString();
    try {
      const m = p.urn.match(/(activity|share|ugcPost):(\d+)/);
      if (m) {
        const ts = Number(BigInt(m[2]) >> 22n);
        const d = new Date(ts);
        if (d.getFullYear() >= 2015 && d.getFullYear() <= 2030) {
          publishAt = d.toISOString();
        }
      }
    } catch {}
    try {
      const result = stmt.run(id, p.text, lang, publishAt, p.urn, publishAt);
      if (result.changes > 0) inserted++;
    } catch (e) {
      log(`  ❌ ${p.urn}: ${e.message}`);
    }
  }
  db.close();
  return inserted;
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  log(`Fetch all my posts ${DRY_RUN ? '(DRY-RUN — pass --insert-historical to write to DB)' : '(WRITING TO DB)'} | max ${MAX_POSTS}`);
  if (!ALLOW_INSERT) {
    log('⚠️  Domyślny tryb to dry-run od incydentu 2026-05-11 (51 historycznych postów zassanych z błędnym published_at).');
    log('   Aby faktycznie wstawić brakujące posty: node scripts/fetch-all-my-posts.mjs --insert-historical');
  }

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

  try {
    const profileUrl = await getMyProfileUrl();
    log(`Profil: ${profileUrl}`);

    // Pauza przed scrape (LinkedIn rate limit po wielokrotnych nawigacjach)
    log('Czekam 30s przed scrape żeby zminimalizować rate limit...');
    await sleep(30000);

    const allPosts = await scrapeActivityFeed(page, profileUrl);
    const missing = findMissing(allPosts);

    log(`Łącznie posty w DOM: ${allPosts.length}`);
    log(`Już mamy w scheduler.db: ${allPosts.length - missing.length}`);
    log(`BRAKUJĄCE: ${missing.length}`);

    if (missing.length > 0) {
      const limited = missing.slice(0, MAX_POSTS);
      log(`Wstawiam ${limited.length} brakujących postów...`);
      const inserted = insertMissing(limited);
      log(`✅ Wstawiono ${inserted} nowych postów`);
    }
  } finally {
    await ctx.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
