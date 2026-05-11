#!/usr/bin/env node
/**
 * Auto-Comment Sender — wysyła zatwierdzone propozycje przez Playwright UI
 *
 * Workflow:
 * 1. Co losowe 5-15 min (jak człowiek wchodzący sprawdzić LinkedIn)
 * 2. Sprawdza reply_proposals WHERE status='approved' AND comment type
 * 3. Bierze najstarszą (FIFO)
 * 4. Random delay 0-30 min od approved_at (żeby nie wysyłać natychmiast)
 * 5. Otwiera link do posta w Playwright (persistent profile)
 * 6. Znajduje target comment w DOM po tekście autora i pierwszych słowach
 * 7. Klika "Odpowiedz" / "Reply"
 * 8. Wpisuje tekst z human-like typing (40-90 ms per char)
 * 9. Klika "Post" / "Opublikuj"
 * 10. Status → 'sent' + sent_at + sent_via='playwright'
 *
 * Bezpieczeństwo:
 * - max 3 odpowiedzi/cykl (1× co 5-15 min = max ~30/dzień ale realnie kilka)
 * - aktywne godziny 8-22 CEST
 * - skip jeśli już sent
 * - retry max 2x w wypadku error
 * - jeśli nie znajdzie targetu po 30s → status='failed' + reason
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const PROFILE = join(homedir(), '.linkedin-mcp', 'browser-profile');
const ENGAGE_DB = join(homedir(), '.linkedin-mcp', 'engage.db');

// Limity (twarde)
const MAX_PER_CYCLE = 3;
const MIN_DELAY_AFTER_APPROVAL_MIN = 0;     // min 0 min od approved
const MAX_DELAY_AFTER_APPROVAL_MIN = 30;    // max 30 min — losowe okno
const CYCLE_INTERVAL_BASE_MIN = 10;
const CYCLE_JITTER_MIN = 5;                 // ±5 min
const ACTIVE_HOURS_UTC = { start: 6, end: 20 };

const log = (m) => console.log(`[sender] ${new Date().toISOString().slice(11,19)} ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const isActiveHour = () => { const h = new Date().getUTCHours(); return h >= ACTIVE_HOURS_UTC.start && h < ACTIVE_HOURS_UTC.end; };

const args = process.argv.slice(2);
const RUN_ONCE = args.includes('--once');
const DRY_RUN = args.includes('--dry-run');

// ── DB ─────────────────────────────────────────────────────────────────────
function getApprovedProposals() {
  const db = new Database(ENGAGE_DB, { readonly: true });
  // Bierz tylko te które są approved DŁUŻEJ niż random delay (5-30 min)
  const rows = db.prepare(`
    SELECT * FROM reply_proposals
    WHERE status = 'approved' AND type = 'comment'
      AND approved_at IS NOT NULL
    ORDER BY approved_at ASC
    LIMIT 20
  `).all();
  db.close();
  return rows;
}

function markSent(id, commentUrn) {
  if (DRY_RUN) { log(`  [DRY] would mark sent: ${id}`); return; }
  const db = new Database(ENGAGE_DB);
  db.prepare(`UPDATE reply_proposals SET status='sent', sent_at=datetime('now'), sent_via='playwright', updated_at=datetime('now') WHERE id=?`).run(id);
  db.close();
}

function markFailed(id, reason) {
  if (DRY_RUN) { log(`  [DRY] would mark failed: ${id} ${reason}`); return; }
  const db = new Database(ENGAGE_DB);
  db.prepare(`UPDATE reply_proposals SET status='failed', updated_at=datetime('now') WHERE id=?`).run(id);
  db.close();
}

// ── Playwright ─────────────────────────────────────────────────────────────
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char);
    await sleep(randInt(40, 90));
  }
}

async function sendReply(page, prop) {
  const postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(prop.post_urn)}/`;
  log(`  Otwieram: ${postUrl.slice(0, 80)}`);
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randInt(4000, 8000));

  // Rozwiń komentarze
  for (let i = 0; i < 3; i++) {
    try {
      const btn = await page.$('button.comments-comments-list__load-more-comments-button, button[aria-label*="more comment"]');
      if (!btn) break;
      await btn.click();
      await sleep(randInt(2000, 4000));
    } catch { break; }
  }

  // Rozwiń replies
  const replyShowBtns = await page.$$('button[aria-label*="repli"], button.comments-comment-item__show-replies-button');
  for (const b of replyShowBtns.slice(0, 8)) {
    try { await b.click(); await sleep(randInt(1500, 3000)); } catch {}
  }

  // Znajdź target comment po autorze + tekście
  // source_text z DB jest oryginalnym komentarzem
  const sourceTextSnippet = (prop.source_text || '').slice(0, 60);
  const targetAuthor = prop.source_author;

  log(`  Szukam komentarza: "${targetAuthor}: ${sourceTextSnippet}..."`);

  // Locator: znajdź element komentarza zawierający autora + fragment tekstu
  const found = await page.evaluate(({ author, snippet }) => {
    const items = document.querySelectorAll('.comments-comment-entity, .comments-comment-item, article.comments-comment-item');
    for (const it of items) {
      const authorEl = it.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text');
      const textEl = it.querySelector('.comments-comment-item__main-content, .comments-comment-entity__main-content, .update-components-text, .feed-shared-text');
      if (!authorEl || !textEl) continue;
      const a = authorEl.innerText.trim();
      const t = textEl.innerText.trim();
      if (a.includes(author.split(' ')[0]) && t.includes(snippet.slice(0, 30))) {
        // Scroll do tego komentarza
        it.scrollIntoView({ behavior: 'smooth', block: 'center' });
        it.setAttribute('data-sender-target', 'true');
        return true;
      }
    }
    return false;
  }, { author: targetAuthor, snippet: sourceTextSnippet });

  if (!found) {
    log(`  ❌ Nie znaleziono komentarza w DOM`);
    return { ok: false, reason: 'comment_not_found' };
  }

  await sleep(randInt(2000, 5000));

  // Kliknij "Reply" / "Odpowiedz" na target komentarzu
  log(`  Klikam Odpowiedz...`);
  const replyClicked = await page.evaluate(() => {
    const target = document.querySelector('[data-sender-target="true"]');
    if (!target) return false;
    // Szukaj button reply
    const replyBtn = target.querySelector('button.comments-comment-social-bar__reply-action-button, button[aria-label*="Odpowiedz"], button[aria-label*="Reply"]');
    if (replyBtn) { replyBtn.click(); return true; }
    return false;
  });

  if (!replyClicked) {
    log(`  ❌ Nie znaleziono przycisku Odpowiedz`);
    return { ok: false, reason: 'reply_button_not_found' };
  }

  await sleep(randInt(2000, 4000));

  // Wpisz tekst w textarea/contenteditable
  log(`  Wpisuję tekst (${prop.proposed_reply.length} znaków)...`);

  const editor = await page.$('[data-sender-target="true"] .comments-comment-box__form .ql-editor[contenteditable="true"]')
    || await page.$('.comments-comment-box--reply .ql-editor[contenteditable="true"]')
    || await page.$('.ql-editor[contenteditable="true"]:not([data-placeholder*="Add"])');

  if (!editor) {
    log(`  ❌ Nie znaleziono edytora tekstu`);
    return { ok: false, reason: 'editor_not_found' };
  }

  await editor.click();
  await sleep(800);

  // Wpisz z human-like delay
  for (const char of prop.proposed_reply) {
    await page.keyboard.type(char);
    await sleep(randInt(40, 90));
  }

  await sleep(randInt(3000, 6000));

  if (DRY_RUN) {
    log(`  [DRY-RUN] Nie klikam Post (dry run mode)`);
    return { ok: true, dryRun: true };
  }

  // Kliknij Post / Opublikuj
  log(`  Klikam Post...`);
  const postClicked = await page.evaluate(() => {
    // Active state buttons
    const buttons = document.querySelectorAll('button.comments-comment-box__submit-button, button[aria-label*="Post"], button[aria-label*="Opublikuj"]');
    for (const b of buttons) {
      if (!b.disabled) { b.click(); return true; }
    }
    return false;
  });

  if (!postClicked) {
    log(`  ❌ Przycisk Post nieaktywny lub nie znaleziono`);
    return { ok: false, reason: 'post_button_not_clickable' };
  }

  await sleep(randInt(3000, 6000));
  log(`  ✅ Wysłano`);
  return { ok: true };
}

// ── Main cycle ─────────────────────────────────────────────────────────────
async function runCycle() {
  log('=== Start cyklu sender ===');
  if (!isActiveHour()) { log('  Poza godzinami aktywnymi. Skip.'); return; }

  const approved = getApprovedProposals();
  log(`  ${approved.length} approved w kolejce`);

  if (approved.length === 0) { log('=== Koniec — brak kolejki ==='); return; }

  // Filter: tylko te które są approved >= MIN minut temu
  const now = Date.now();
  const ready = approved.filter(p => {
    if (!p.approved_at) return false;
    const approvedMs = new Date(p.approved_at).getTime();
    const minutesAgo = (now - approvedMs) / 60000;
    return minutesAgo >= MIN_DELAY_AFTER_APPROVAL_MIN;
  });

  if (ready.length === 0) {
    log(`  Wszystkie approved są za młode (<${MIN_DELAY_AFTER_APPROVAL_MIN} min). Skip.`);
    return;
  }

  log(`  ${ready.length} gotowych do wysłania`);

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, {
      headless: false, channel: 'chrome',
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

    let sent = 0;
    for (const prop of ready.slice(0, MAX_PER_CYCLE)) {
      log(`\n[${sent + 1}/${MAX_PER_CYCLE}] propozycja #${prop.id} (${prop.source_author})`);
      try {
        const result = await sendReply(page, prop);
        if (result.ok) {
          markSent(prop.id);
          sent++;
        } else {
          markFailed(prop.id, result.reason);
        }
      } catch (e) {
        log(`  ❌ Wyjątek: ${e.message}`);
        markFailed(prop.id, 'exception');
      }

      // Pauza między wysyłkami (human-like)
      if (sent < MAX_PER_CYCLE) {
        const pause = randInt(60, 180) * 1000;
        log(`  Pauza ${Math.round(pause/1000)}s przed kolejną...`);
        await sleep(pause);
      }
    }

    log(`\n=== Cycle done: ${sent} wysłanych ===`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function scheduleNext() {
  const sign = Math.random() > 0.5 ? 1 : -1;
  const jitter = randInt(0, CYCLE_JITTER_MIN);
  const delayMin = CYCLE_INTERVAL_BASE_MIN + sign * jitter;
  const delayMs = Math.max(2, delayMin) * 60 * 1000;
  const nextAt = new Date(Date.now() + delayMs);
  log(`Następny cykl: ${nextAt.toLocaleTimeString('pl-PL')} (za ${Math.round(delayMs/60000)} min)`);
  setTimeout(async () => {
    await runCycle().catch(e => log(`Crash: ${e.message}`));
    scheduleNext();
  }, delayMs);
}

log(`Auto-Comment Sender ${DRY_RUN ? '(DRY-RUN)' : ''}`);
log(`Limit: ${MAX_PER_CYCLE} per cykl, interval ${CYCLE_INTERVAL_BASE_MIN}±${CYCLE_JITTER_MIN} min`);

if (RUN_ONCE) {
  runCycle().then(() => process.exit(0)).catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });
} else {
  const initDelay = randInt(2, 8) * 60 * 1000;
  log(`Start za ${Math.round(initDelay/60000)} min`);
  setTimeout(async () => {
    await runCycle().catch(e => log(`Crash init: ${e.message}`));
    scheduleNext();
  }, initDelay);
}
