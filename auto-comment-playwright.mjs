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
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

// ── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  PROFILE_DIR: join(homedir(), '.linkedin-mcp', 'browser-profile'),
  ENGAGE_DB: join(homedir(), '.linkedin-mcp', 'engage.db'),
  PERSONA_DIR: '/Users/gaca/projects/personal/second-mind/_system',
  LOG_DIR: '/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp',

  // Aktywne godziny CEST (UTC: 6:00-20:00)
  ACTIVE_HOURS_UTC: { start: 6, end: 20 },

  // Losowy interwał 2h ± 25 min
  INTERVAL_BASE_MS: 2 * 60 * 60 * 1000,
  INTERVAL_JITTER_MAX_MS: 25 * 60 * 1000,
  INTERVAL_JITTER_MIN_MS: 10 * 60 * 1000,

  // Limity
  MAX_POSTS_PER_CYCLE: 10,
  MAX_PROPOSALS_PER_CYCLE: 5,
  MAX_CYCLES_PER_DAY: 3,
  MAX_ERRORS_BEFORE_PAUSE: 3,
  ERROR_PAUSE_HOURS: 24,

  // Scoring
  MIN_LEAD_OR_ENGAGE: 3,
  MAX_TROLL_RISK: 2,

  // Human-like
  HUMAN_DELAY_MIN: 3000,
  HUMAN_DELAY_MAX: 15000,

  // Claude
  CLAUDE_BIN: '/Users/gaca/.local/bin/claude',
  CLAUDE_MODEL: 'opus',
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
  return new Database(CONFIG.ENGAGE_DB);
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
  db.prepare(`
    INSERT INTO thread_memory (post_urn, post_text, post_author, post_url, thread_json, our_replies_json, comment_count, last_scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_urn) DO UPDATE SET
      thread_json = excluded.thread_json,
      our_replies_json = excluded.our_replies_json,
      comment_count = excluded.comment_count,
      last_scraped_at = datetime('now')
  `).run(data.postUrn, data.postText || '', data.postAuthor || '', data.postUrl || '',
         JSON.stringify(data.thread), JSON.stringify(data.ourReplies), data.thread.length);
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

function saveProposal(p) {
  if (DRY_RUN) { log(`  [DRY-RUN] Skip save: ${p.proposedReply.slice(0, 60)}...`); return; }
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO reply_proposals
    (type, source_id, source_text, source_author, post_urn, post_text,
     proposed_reply, lead_score, troll_risk, engagement_value, thread_context, status)
    VALUES ('comment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(p.commentUrn, p.commentText, p.commentAuthor, p.postUrn, p.postText.slice(0, 500),
         p.proposedReply, p.scoring.lead_score || 0, p.scoring.troll_risk || 0,
         p.scoring.engagement_value || 0, p.threadContext.slice(0, 4000));
  db.close();
  log(`  💾 Propozycja zapisana: ${p.proposedReply.slice(0, 60)}...`);
}

// ── PERSONA ─────────────────────────────────────────────────────────────────

let cachedPersona = null;
function loadPersona() {
  if (cachedPersona) return cachedPersona;
  let profile = '', workStyle = '';
  try { profile = readFileSync(join(CONFIG.PERSONA_DIR, 'profile.md'), 'utf-8'); } catch {}
  try { workStyle = readFileSync(join(CONFIG.PERSONA_DIR, 'work-style.md'), 'utf-8'); } catch {}
  cachedPersona = (profile + '\n\n' + workStyle).slice(0, 3500);
  return cachedPersona;
}

// ── CLAUDE CLI ──────────────────────────────────────────────────────────────

function callClaude(prompt) {
  return new Promise((resolve) => {
    const child = spawn(CONFIG.CLAUDE_BIN, [
      '-p', '--no-session-persistence',
      '--model', CONFIG.CLAUDE_MODEL,
      '--output-format', 'text',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '', err = '';
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      log(`  ⚠️  Claude timeout po ${CONFIG.CLAUDE_TIMEOUT_MS}ms`);
      resolve(null);
    }, CONFIG.CLAUDE_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { log(`  ⚠️  Claude exit ${code}: ${err.slice(0, 200)}`); resolve(null); return; }
      resolve(out.trim());
    });
    child.on('error', (e) => { clearTimeout(timer); log(`  ⚠️  Claude spawn error: ${e.message}`); resolve(null); });
  });
}

// ── PROMPT BUILDER ──────────────────────────────────────────────────────────

const PL_WORDS = /\b(jak|jaki|jaka|jakie|co|czy|ile|kiedy|gdzie|dlaczego|kto|jest|są|tak|nie|moja|mój|moje|twoja|twój|ten|ta|to|już|teraz|więc|ale|bo|albo|lub|tylko|nawet|też|bardzo|dużo|mało|wszystko|jednak|jeśli|gdy|chociaż|ponieważ|aby|żeby|w|na|do|od|za|przez|po|przed|nad|pod|przy|bez|dla|między|wokół|obok|zamiast|oprócz|wobec)\b/i;

function detectLanguage(text) {
  if (!text) return 'polsku';
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return 'polsku';
  const pl = (text.match(PL_WORDS) || []).length;
  const en = (text.match(/\b(the|is|are|was|were|have|has|had|do|does|will|can|could|should|this|that|these|with|from|about|because|however|but|and|or|not|very|much|some|any|all|every)\b/gi) || []).length;
  if (pl > en) return 'polsku';
  if (en > pl) return 'angielsku';
  return text.length < 30 ? 'polsku' : 'angielsku';
}

function buildPrompt({ persona, postText, postAuthor, thread, ourReplies, targetComment }) {
  const threadFormatted = thread.map((c, i) => {
    const marker = c.isReply ? '  ↳ ' : '';
    const ours = c.isOurs ? ' [TWOJA WCZEŚNIEJSZA ODPOWIEDŹ]' : '';
    const target = c.commentUrn === targetComment.commentUrn ? ' ← [TEN KOMENTARZ — odpowiadasz]' : '';
    return `${marker}${i + 1}. ${c.author}: "${c.text.slice(0, 300)}"${ours}${target}`;
  }).join('\n');

  const ourRepliesFormatted = ourReplies.length > 0
    ? ourReplies.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '(brak — to pierwszy raz odpowiadasz w tym wątku)';

  return `<persona>
${persona}
</persona>

<oryginalny_post>
Autor: ${postAuthor}
Treść: ${(postText || '(brak treści)').slice(0, 800)}
</oryginalny_post>

<historia_watku>
${threadFormatted || '(brak wcześniejszych komentarzy)'}
</historia_watku>

<twoje_poprzednie_odpowiedzi_w_tym_watku>
${ourRepliesFormatted}
</twoje_poprzednie_odpowiedzi_w_tym_watku>

<zadanie>
Komentarz do oceny: "${targetComment.text}"
Autor: ${targetComment.author}

KROK 1: Oceń komentarz (1-5):
- lead_score: 5=konkretne zainteresowanie usługą/ceną/demo, 3=ogólne zainteresowanie, 1=brak
- troll_risk: 5=agresja/spam/trolling, 2=neutralny, 1=konstruktywny
- engagement_value: 5=otwarte pytanie wymuszające dyskusję, 3=merytoryczny, 1=emoji/one-word

KROK 2: Decyzja "should_reply":
- TAK jeśli (lead_score≥${CONFIG.MIN_LEAD_OR_ENGAGE} LUB engagement_value≥${CONFIG.MIN_LEAD_OR_ENGAGE}) AND troll_risk≤${CONFIG.MAX_TROLL_RISK}
- NIE w przeciwnym razie

KROK 3: Jeśli should_reply=TAK, napisz odpowiedź:
- **JĘZYK:** wykryj język KOMENTARZA (nie postu, nie wątku — tylko "${targetComment.text}") i odpowiedz dokładnie w tym samym języku. PL → odpowiedź PL. EN → odpowiedź EN.
- 50-120 słów
- Logicznie kontynuuje wątek (nawiąż do poprzednich komentarzy jeśli są)
- NIE powtarzaj się — sprawdź twoje poprzednie odpowiedzi
- Zero "Świetny komentarz", "Dzięki za pytanie"
- Zakończ pytaniem lub konkretną obserwacją wymuszającą dyskusję
- Styl: bezpośredni, developer-like, lekka ironia OK

ZWRÓĆ TYLKO JSON (nic poza nim):
{"lead_score": N, "troll_risk": N, "engagement_value": N, "should_reply": true|false, "reply": "...", "reasoning": "1 krótkie zdanie"}
</zadanie>`;
}

function parseClaudeJson(text) {
  if (!text) return null;
  // Spróbuj wyciągnąć JSON z odpowiedzi
  const match = text.match(/\{[\s\S]*"should_reply"[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ── PLAYWRIGHT SCRAPING ─────────────────────────────────────────────────────

async function fetchNotifications(page) {
  log('  Ładuję notyfikacje...');
  await page.goto('https://www.linkedin.com/notifications/?filter=all', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

async function scrapePostThread(page, postUrl) {
  log(`  → ${postUrl.slice(0, 80)}`);
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay();

  // Spróbuj rozwijać "View more comments"
  for (let i = 0; i < 3; i++) {
    try {
      const btn = await page.$('button.comments-comments-list__load-more-comments-button, button[aria-label*="more comments"]');
      if (!btn) break;
      await btn.click();
      await sleep(randInt(2000, 5000));
    } catch { break; }
  }

  // Rozwiń "Show N replies"
  const replyButtons = await page.$$('button[aria-label*="repli"], button.comments-comment-item__show-replies-button');
  for (const btn of replyButtons.slice(0, 8)) {
    try { await btn.click(); await sleep(randInt(1500, 3500)); } catch {}
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
      comments.push({
        commentUrn: urnAttr || author + '_' + text.slice(0, 30),
        author, text, isReply,
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

  if (!isActiveHour()) {
    log('  Poza godzinami aktywnymi (8:00-22:00 CEST). Skip.');
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
  let context, page;

  try {
    log('  Uruchamiam Playwright...');
    context = await chromium.launchPersistentContext(CONFIG.PROFILE_DIR, {
      headless: CONFIG.HEADLESS,
      channel: 'chrome',
      viewport: CONFIG.VIEWPORT,
      userAgent: CONFIG.USER_AGENT,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    page = context.pages()[0] || await context.newPage();

    // Stealth
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const persona = loadPersona();
    const notifs = await fetchNotifications(page);

    for (const n of notifs) {
      if (stats.proposalsCreated >= CONFIG.MAX_PROPOSALS_PER_CYCLE) {
        log(`  Limit ${CONFIG.MAX_PROPOSALS_PER_CYCLE} propozycji osiągnięty.`);
        break;
      }
      if (isNotificationProcessed(n.notifId)) {
        log(`  ↪ Pomijam (już przetworzone): ${n.snippet.slice(0, 40)}...`);
        continue;
      }

      stats.postsChecked++;
      try {
        const data = await scrapePostThread(page, n.postUrl);
        if (data.skip) {
          markNotificationProcessed(n.notifId, n.type || 'COMMENT', n.notifId, '');
          continue;
        }
        if (!data.comments.length) { log('    Brak komentarzy do analizy'); continue; }

        // Identyfikuj nasze poprzednie odpowiedzi (po nazwie)
        const ourName = 'Bartosz Gaca';
        const ourReplies = data.comments.filter(c => c.author.includes('Bartosz') || c.author.includes(ourName)).map(c => c.text);

        // Zapisz wątek do pamięci
        if (!DRY_RUN) {
          saveThread({
            postUrn: n.notifId,
            postText: data.postText,
            postAuthor: data.postAuthor,
            postUrl: n.postUrl,
            thread: data.comments,
            ourReplies,
          });
        }

        // Znajdź target comment (ostatni nie-nasz komentarz)
        const targetComment = [...data.comments].reverse().find(c =>
          !c.author.includes('Bartosz') && !c.author.includes(ourName)
        );
        if (!targetComment) { log('    Brak nowych komentarzy do odpowiedzi'); markNotificationProcessed(n.notifId, 'COMMENT', n.notifId, ''); continue; }

        log(`    Target: ${targetComment.author}: "${targetComment.text.slice(0, 60)}..."`);

        // Generuj odpowiedź przez Claude Opus
        const prompt = buildPrompt({
          persona,
          postText: data.postText,
          postAuthor: data.postAuthor,
          thread: data.comments,
          ourReplies,
          targetComment,
        });

        log(`    🧠 Pytam Claude Opus (timeout ${CONFIG.CLAUDE_TIMEOUT_MS / 1000}s)...`);
        const claudeOut = await callClaude(prompt);
        const parsed = parseClaudeJson(claudeOut);

        if (!parsed) {
          log('    ⚠️  Claude nie zwrócił JSON');
          stats.errors++;
          continue;
        }

        log(`    Score: lead=${parsed.lead_score} troll=${parsed.troll_risk} engage=${parsed.engagement_value} | should_reply=${parsed.should_reply}`);

        if (parsed.should_reply && parsed.reply) {
          saveProposal({
            commentUrn: targetComment.commentUrn,
            commentText: targetComment.text,
            commentAuthor: targetComment.author,
            postUrn: n.notifId,
            postText: data.postText,
            proposedReply: parsed.reply,
            scoring: { lead_score: parsed.lead_score, troll_risk: parsed.troll_risk, engagement_value: parsed.engagement_value },
            threadContext: data.comments.map(c => `${c.author}: "${c.text}"`).join('\n'),
          });
          stats.proposalsCreated++;
        } else {
          log(`    ⊘ Skip (reasoning: ${parsed.reasoning})`);
        }

        if (!DRY_RUN) markNotificationProcessed(n.notifId, 'COMMENT', n.notifId, targetComment.author);

        // Pauza między postami (jak człowiek przegląda)
        await sleep(randInt(5000, 15000));
      } catch (e) {
        log(`    ❌ Błąd przy poście: ${e.message}`);
        stats.errors++;
      }
    }
  } catch (e) {
    log(`❌ Błąd cyklu: ${e.message}`);
    stats.errors++;
    stats.notes = e.message.slice(0, 500);
  } finally {
    if (context) await context.close().catch(() => {});
    if (cycleId) endCycleLog(cycleId, stats);
    log(`=== Koniec: ${stats.postsChecked} postów sprawdzonych, ${stats.proposalsCreated} propozycji, ${stats.errors} błędów ===\n`);
  }

  return stats;
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
log(`Active hours UTC: ${CONFIG.ACTIVE_HOURS_UTC.start}-${CONFIG.ACTIVE_HOURS_UTC.end} (CEST: 8-22)`);

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
