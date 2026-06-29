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

// Timeouts to prevent silent hangs (Playwright operations that never resolve)
const SEND_TIMEOUT_MS = 90 * 1000;
const CYCLE_TIMEOUT_MS = 8 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

async function sleepWithHeartbeat(ms, label) {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(remaining, HEARTBEAT_MS);
    await sleep(step);
    remaining -= step;
    if (remaining > 0) log(`  ⏳ ${label} (${Math.round(remaining/1000)}s left)`);
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timeout ${Math.round(ms/1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
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

function markSent(id, prop) {
  if (DRY_RUN) { log(`  [DRY] would mark sent: ${id}`); return; }
  const db = new Database(ENGAGE_DB);

  // 1. Update reply_proposals status
  db.prepare(`UPDATE reply_proposals SET status='sent', sent_at=datetime('now'), sent_via='playwright', updated_at=datetime('now') WHERE id=?`).run(id);

  // 2. Dodaj NASZ komentarz do drzewka thread_comments
  // parent_comment_urn = source_id (komentarz na który odpowiedzieliśmy)
  // To zachowuje strukturę drzewka — nasze odpowiedzi są dziećmi komentarza target
  const ourCommentUrn = `our_reply_${id}_${Date.now()}`;
  db.prepare(`
    INSERT OR IGNORE INTO thread_comments
      (post_urn, comment_urn, parent_comment_urn, author_name, comment_text, comment_created_at, scraped_at, is_our_comment)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
  `).run(prop.post_urn, ourCommentUrn, prop.source_id, 'Bartosz Gaca', prop.proposed_reply);

  // 3. Zaktualizuj our_replies_json w thread_memory (cache)
  const tm = db.prepare("SELECT our_replies_json FROM thread_memory WHERE post_urn=?").get(prop.post_urn);
  if (tm) {
    let ourReplies = [];
    try { ourReplies = JSON.parse(tm.our_replies_json || '[]'); } catch {}
    ourReplies.push(prop.proposed_reply);
    db.prepare("UPDATE thread_memory SET our_replies_json=?, last_scraped_at=datetime('now') WHERE post_urn=?").run(JSON.stringify(ourReplies), prop.post_urn);
  }

  db.close();
  log(`  📝 Dodano do drzewka jako reply do ${prop.source_id.slice(0, 50)}...`);
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

  // ── TARGETOWANIE KOMENTARZA — KRYTYCZNE (komu odpowiadamy) ──────────────────
  // Fix bugu „odpowiedź pod złym użytkownikiem": NIE matchujemy po imieniu+30zn (dwie
  // osoby o tym samym imieniu / innerText rodzica zawiera tekst dzieci). Matchujemy po
  // UNIKALNYM URN komentarza (data-id === source_id) — to samo data-id, które daemon
  // zapisał jako commentUrn. Fallback tylko gdy PEWNY (pełne imię+nazwisko, ≥60 zn., 1 trafienie).
  const sourceId = prop.source_id || '';
  const sourceTextSnippet = (prop.source_text || '').slice(0, 80);
  const targetAuthor = prop.source_author || '';

  log(`  Szukam komentarza po URN: ${sourceId.slice(0, 55)} (autor: ${targetAuthor})`);

  const match = await page.evaluate(({ urn, author, snippet }) => {
    document.querySelectorAll('[data-sender-target]').forEach(e => e.removeAttribute('data-sender-target'));
    const ENTITY = '.comments-comment-entity, .comments-comment-item, article.comments-comment-item';

    // 1) EXACT po URN (data-id) — jedyny pewny sposób
    if (urn) {
      let el = null;
      try { el = document.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(urn) : urn.replace(/"/g, '\\"')) + '"]'); } catch {}
      if (!el) {
        // niektóre wersje DOM trzymają data-id na innym atrybucie / wrapperze
        for (const e of document.querySelectorAll('[data-id],[data-urn]')) {
          if (e.getAttribute('data-id') === urn || e.getAttribute('data-urn') === urn) { el = e; break; }
        }
      }
      if (el) {
        const entity = el.closest(ENTITY) || el;
        entity.setAttribute('data-sender-target', 'true');
        entity.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { ok: true, method: 'urn' };
      }
    }

    // DETERMINIZM: jeśli mamy realny URN, a nie ma go w DOM (komentarz usunięty / nie doładowany),
    // NIE robimy fuzzy-matchu — bo trafilibyśmy w innego użytkownika. Lepiej not_found.
    if (urn && urn.indexOf('urn:') === 0) {
      return { ok: false, reason: 'urn_not_in_dom' };
    }

    // 2) FALLBACK — TYLKO dla legacy source_id bez URN: pełne imię+nazwisko ORAZ ≥60 zn. ORAZ dokładnie 1 trafienie
    if (author && snippet && snippet.length >= 30) {
      const needle = snippet.slice(0, 60);
      const hits = [];
      for (const it of document.querySelectorAll(ENTITY)) {
        const authorEl = it.querySelector('.comments-comment-meta__description-title, .comments-post-meta__name-text');
        const textEl = it.querySelector('.comments-comment-item__main-content, .comments-comment-entity__main-content');
        if (!authorEl || !textEl) continue;
        if (authorEl.innerText.trim() === author && textEl.innerText.trim().includes(needle)) hits.push(it);
      }
      if (hits.length === 1) {
        hits[0].setAttribute('data-sender-target', 'true');
        hits[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { ok: true, method: 'fallback-exact' };
      }
      if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
    }
    return { ok: false, reason: 'not_found' };
  }, { urn: sourceId, author: targetAuthor, snippet: sourceTextSnippet });

  if (!match.ok) {
    // Lepiej NIE wysłać niż wysłać pod złą osobę.
    log(`  ❌ Target niepewny (${match.reason}) — NIE wysyłam (ochrona przed odpowiedzią pod złym użytkownikiem)`);
    return { ok: false, reason: match.reason === 'ambiguous' ? 'target_ambiguous' : 'comment_not_found' };
  }
  log(`  ✅ Target znaleziony (${match.method})`);

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

  // Wpisz tekst przez DOM (bez Accessibility API).
  // Quill editor (LinkedIn) wymaga emisji input events żeby Send button się aktywował.
  const typeResult = await editor.evaluate((el, text) => {
    el.focus();
    // Wyczyść istniejący content
    while (el.firstChild) el.removeChild(el.firstChild);
    // Wstaw tekst jako paragraphs (Quill format)
    const lines = text.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      if (line.trim() === '') {
        p.innerHTML = '<br>';
      } else {
        p.textContent = line;
      }
      el.appendChild(p);
    }
    // Emituj events których słucha Quill/React
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    return { ok: true, length: el.innerText.length };
  }, prop.proposed_reply);

  log(`  ✏️ Wstawiono ${typeResult.length} znaków przez DOM (bez Accessibility)`);

  await sleep(randInt(2000, 4000));

  if (DRY_RUN) {
    log(`  [DRY-RUN] Nie klikam Post (dry run mode)`);
    return { ok: true, dryRun: true };
  }

  // Kliknij Post / Odpowiedz / Opublikuj (różne języki + warianty UI)
  log(`  Klikam Odpowiedz/Post...`);
  const postClicked = await page.evaluate(() => {
    // Pierwsza próba: konkretne selektory klas/aria-label
    const buttonSelectors = [
      'button.comments-comment-box__submit-button',
      'button.comments-comment-box__submit-button--cr',
      'button[data-test-comment-box-submit]',
      'button[aria-label="Post"]',
      'button[aria-label="Opublikuj"]',
      'button[aria-label="Odpowiedz"]',
      'button[aria-label="Reply"]',
      'button[aria-label="Comment"]',
      'button[aria-label="Komentarz"]',
    ];
    for (const sel of buttonSelectors) {
      const btns = document.querySelectorAll(sel);
      for (const b of btns) {
        if (!b.disabled && b.offsetParent !== null) {
          b.click();
          return { ok: true, via: sel };
        }
      }
    }

    // Druga próba: znajdź NIEBIESKI przycisk po tekście wewnątrz formularza komentarza
    const containers = document.querySelectorAll('.comments-comment-texteditor, .comments-comment-box, .comments-comment-box--reply');
    const replyTextRegex = /^(post|odpowiedz|odpowiedź|opublikuj|reply|comment|komentarz)$/i;
    for (const container of containers) {
      const allBtns = container.querySelectorAll('button');
      for (const b of allBtns) {
        const text = (b.innerText || b.textContent || '').trim();
        if (replyTextRegex.test(text) && !b.disabled && b.offsetParent !== null) {
          b.click();
          return { ok: true, via: `text-match: "${text}"` };
        }
      }
    }

    // Trzecia próba: jakikolwiek primary blue button w formularzu komentarza
    const allFormBtns = document.querySelectorAll('.comments-comment-box button.artdeco-button--primary, .comments-comment-texteditor button.artdeco-button--primary');
    for (const b of allFormBtns) {
      if (!b.disabled && b.offsetParent !== null) {
        b.click();
        return { ok: true, via: 'artdeco-primary' };
      }
    }

    return { ok: false, reason: 'no-button-found' };
  });

  if (!postClicked.ok) {
    log(`  ❌ Przycisk submit nie znaleziono (${postClicked.reason || 'unknown'})`);
    return { ok: false, reason: 'post_button_not_clickable' };
  }
  log(`  ✅ Kliknięto via: ${postClicked.via}`);

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
    const batch = ready.slice(0, MAX_PER_CYCLE);
    for (let i = 0; i < batch.length; i++) {
      const prop = batch[i];
      log(`\n[${i + 1}/${batch.length}] propozycja #${prop.id} (${prop.source_author})`);
      try {
        const result = await withTimeout(sendReply(page, prop), SEND_TIMEOUT_MS, 'sendReply');
        if (result.ok) {
          markSent(prop.id, prop);
          sent++;
        } else {
          markFailed(prop.id, result.reason);
        }
      } catch (e) {
        log(`  ❌ Wyjątek: ${e.message}`);
        markFailed(prop.id, 'exception');
      }

      // Pauza między wysyłkami (human-like) — tylko jeśli będzie kolejna iteracja
      if (i < batch.length - 1) {
        const pause = randInt(60, 180) * 1000;
        log(`  Pauza ${Math.round(pause/1000)}s przed kolejną...`);
        await sleepWithHeartbeat(pause, `Pauza przed ${i+2}/${batch.length}`);
      }
    }

    log(`\n=== Cycle done: ${sent} wysłanych ===`);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

function handleCycleError(e) {
  log(`Crash: ${e.message}`);
  if (/timeout/i.test(e.message)) {
    log('Fatal — exiting for launchd restart (clean browser context)');
    process.exit(1);
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
    await withTimeout(runCycle(), CYCLE_TIMEOUT_MS, 'Cycle').catch(handleCycleError);
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
    await withTimeout(runCycle(), CYCLE_TIMEOUT_MS, 'Cycle').catch(handleCycleError);
    scheduleNext();
  }, initDelay);
}
