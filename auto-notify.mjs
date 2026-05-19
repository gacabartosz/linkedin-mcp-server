#!/usr/bin/env node
/**
 * LinkedIn Notification Checker — sprawdza notyfikacje i tworzy propozycje odpowiedzi
 *
 * Co 2h ± losowe minuty (jak człowiek logujący się na LinkedIn):
 * 1. Pobiera notyfikacje via Voyager (komentarze, wzmianki)
 * 2. Dla każdego komentarza: pobiera pełny wątek (wielowątkowy)
 * 3. Klasyfikuje kontekst wątku via Claude CLI
 * 4. Generuje propozycję odpowiedzi logicznie wpisującą się w wątek
 * 5. Zapisuje do reply_proposals — NIE wysyła automatycznie
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

// ── Config ──────────────────────────────────────────────────────────────────

const ENGAGE_DB   = join(homedir(), '.linkedin-mcp', 'engage.db');
const SCRAPER_AUTH = join(homedir(), '.linkedin-mcp', 'scraper-auth.json');
const SECOND_MIND  = '/Users/gaca/projects/personal/second-mind/_system';

const MAX_PROPOSALS_PER_CYCLE = 5;
const MAX_TROLL_RISK = 2;
const MIN_LEAD_OR_ENGAGE = 3;

// Losowe okienko 2h ± 10-25 minut
const BASE_INTERVAL_MS = 2 * 60 * 60 * 1000;
const JITTER_MAX_MS    = 25 * 60 * 1000;
const JITTER_MIN_MS    = 10 * 60 * 1000;

// Aktywne godziny UTC (8:00-22:00 CEST = 6:00-20:00 UTC)
const UTC_START = 6;
const UTC_END   = 20;

// ── Helpers ─────────────────────────────────────────────────────────────────

const log = msg => console.log(`[notify] ${new Date().toISOString().slice(11,19)} ${msg}`);
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isActiveHour = () => { const h = new Date().getUTCHours(); return h >= UTC_START && h < UTC_END; };

function nextDelay() {
  const jitter = randInt(JITTER_MIN_MS, JITTER_MAX_MS);
  const sign   = Math.random() > 0.5 ? 1 : -1;
  return BASE_INTERVAL_MS + sign * jitter;
}

// ── DB ───────────────────────────────────────────────────────────────────────

function initDb() {
  const db = new Database(ENGAGE_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_notifications (
      notification_id TEXT PRIMARY KEY,
      type TEXT,
      post_urn TEXT,
      actor_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reply_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL, source_id TEXT NOT NULL,
      source_text TEXT, source_author TEXT, post_urn TEXT, post_text TEXT,
      proposed_reply TEXT NOT NULL,
      lead_score INTEGER DEFAULT 0, troll_risk INTEGER DEFAULT 0,
      engagement_value INTEGER DEFAULT 0, urgency INTEGER DEFAULT 0,
      thread_context TEXT,
      status TEXT DEFAULT 'pending', sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.close();
}

function isProcessed(notifId) {
  const db = new Database(ENGAGE_DB, { readonly: true });
  const row = db.prepare('SELECT notification_id FROM processed_notifications WHERE notification_id = ?').get(notifId);
  db.close();
  return !!row;
}

function markProcessed(notifId, type, postUrn, actorName) {
  const db = new Database(ENGAGE_DB);
  db.prepare('INSERT OR IGNORE INTO processed_notifications (notification_id,type,post_urn,actor_name) VALUES (?,?,?,?)').run(notifId, type, postUrn, actorName);
  db.close();
}

function saveProposal(p) {
  const db = new Database(ENGAGE_DB);
  db.prepare(`
    INSERT OR IGNORE INTO reply_proposals
    (type,source_id,source_text,source_author,post_urn,post_text,
     proposed_reply,lead_score,troll_risk,engagement_value,thread_context,status)
    VALUES ('comment',?,?,?,?,?,?,?,?,?,?,'pending')
  `).run(p.commentUrn, p.commentText, p.actorName, p.postUrn, p.postText,
         p.reply, p.lead_score||0, p.troll_risk||0, p.engagement_value||0, p.threadCtx);
  db.close();
  log(`  💾 Propozycja zapisana dla ${p.actorName}: "${p.reply.slice(0,60)}..."`);
}

// ── Persona ─────────────────────────────────────────────────────────────────

function loadPersona() {
  let p = 'Bartosz Gaca — builder AI/MCP. Direct, konkretny.';
  try { p = readFileSync(join(SECOND_MIND, 'profile.md'), 'utf-8').slice(0, 500); } catch {}
  return p;
}

// ── Voyager API ──────────────────────────────────────────────────────────────

function getLiAt() {
  try {
    const d = JSON.parse(readFileSync(SCRAPER_AUTH, 'utf-8'));
    if (!d.li_at) throw new Error('no li_at');
    return d.li_at;
  } catch { throw new Error('Brak li_at — zaloguj przez Rutyna → Voyager'); }
}

async function voyagerGet(path, liAt) {
  const r = await fetch(`https://www.linkedin.com/voyager/api${path}`, {
    headers: {
      'Cookie': `li_at=${liAt}`,
      'Csrf-Token': 'ajax:0',
      'X-RestLi-Protocol-Version': '2.0.0',
      'X-Li-Lang': 'pl_PL',
      'Accept': 'application/vnd.linkedin.normalized+json+2.1',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!r.ok) throw new Error(`Voyager ${r.status} ${path}`);
  return r.json();
}

// ── Fetch notifications ──────────────────────────────────────────────────────

async function fetchNotifications(liAt) {
  try {
    const data = await voyagerGet(
      '/identity/dash/notifications?q=ALL&start=0&count=30&decorationId=com.linkedin.voyager.dash.deco.notifications.NotificationsDecoration-17',
      liAt
    );
    const elements = data?.elements || [];
    const relevant = [];

    for (const n of elements) {
      const type = n.notificationActionType || n.actionType || '';
      if (!['COMMENT', 'MENTION', 'REPLY_COMMENT'].includes(type.toUpperCase())) continue;

      const notifId = n.entityUrn || n.dashEntityUrn || String(n.createdAt || Math.random());
      const actorName = n.actor?.name?.text || n.actor?.firstName?.text || 'Unknown';
      const commentText = n.commentary?.text?.text || n.subtext?.text || '';
      const postUrn = n.object?.['*socialActivityCounts'] || n.object?.urn || '';

      relevant.push({ notifId, type, actorName, commentText, postUrn, raw: n });
    }

    log(`  Pobrano ${elements.length} notyfikacji, ${relevant.length} komentarzy/wzmianek`);
    return relevant;
  } catch (e) {
    log(`  Voyager notifs błąd: ${e.message}`);
    return [];
  }
}

// ── Fetch comment thread (multi-level) ──────────────────────────────────────

async function fetchCommentThread(postUrn, liAt) {
  try {
    if (!postUrn) return [];
    const encodedUrn = encodeURIComponent(postUrn);
    const data = await voyagerGet(
      `/feed/comments?count=20&start=0&q=comments&sortOrder=RANKED&updateKey=${encodedUrn}`,
      liAt
    );
    const comments = [];
    const elements = data?.elements || data?.data?.elements || [];
    for (const c of elements) {
      const text = c.commentary?.text?.text || c.commentary?.text || '';
      const author = c.commenter?.actor?.name?.text || 'Unknown';
      const urn = c.dashEntityUrn || c.entityUrn || '';
      const timestamp = c.createdAt ? new Date(c.createdAt).toLocaleTimeString('pl-PL') : '';
      comments.push({ text, author, urn, timestamp });
      // Replies to comment
      if (c.commentSocialActivityCounts?.numComments > 0) {
        try {
          const replies = await voyagerGet(
            `/feed/comments?count=5&start=0&q=comments&sortOrder=RANKED&parentCommentUrn=${encodeURIComponent(urn)}`,
            liAt
          );
          for (const r of replies?.elements || []) {
            const rt = r.commentary?.text?.text || '';
            const ra = r.commenter?.actor?.name?.text || 'Unknown';
            if (rt) comments.push({ text: rt, author: ra, urn: r.dashEntityUrn || '', timestamp: '', isReply: true });
          }
        } catch {}
      }
    }
    return comments;
  } catch (e) {
    log(`  Thread fetch błąd: ${e.message}`);
    return [];
  }
}

function buildThreadContext(comments, targetCommentUrn) {
  if (!comments.length) return '';
  const lines = comments.map(c =>
    `${c.isReply ? '  ↳ ' : ''}${c.author}: "${c.text.slice(0, 200)}"${c.urn === targetCommentUrn ? ' ← [TEN KOMENTARZ]' : ''}`
  );
  return lines.join('\n');
}

// ── Claude CLI classification ────────────────────────────────────────────────

function claudeRun(prompt, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--no-session-persistence', '--model', 'claude-haiku-4-5-20251001'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdin.write(prompt); child.stdin.end();
    child.stdout.on('data', d => out += d);
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
    setTimeout(() => { child.kill(); resolve(''); }, timeoutMs);
  });
}

async function classifyComment(commentText, threadCtx, postText) {
  const prompt = `Oceń komentarz LinkedIn w kontekście całego wątku.

Post (fragment): "${(postText||'').slice(0,200)}"

Wątek komentarzy:
${threadCtx || '(brak poprzednich komentarzy)'}

Komentarz do oceny: "${commentText.slice(0,300)}"

Oceń (1-5):
lead_score: 5=konkretne zainteresowanie usługą/ceną/demo, 3=ogólne zainteresowanie, 1=brak
troll_risk: 5=spam/agresja, 2=neutralny, 1=konstruktywny
engagement_value: 5=otwarte pytanie/dyskusja, 3=merytoryczny, 1=emoji/short

Zwróć TYLKO JSON: {"lead_score":N,"troll_risk":N,"engagement_value":N,"should_reply":true/false,"reason":"1 zdanie"}`;

  const out = await claudeRun(prompt);
  try {
    const m = out.match(/\{[^}]*"lead_score"[^}]*\}/s);
    return m ? JSON.parse(m[0]) : { lead_score: 1, troll_risk: 1, engagement_value: 2, should_reply: false };
  } catch {
    return { lead_score: 1, troll_risk: 1, engagement_value: 2, should_reply: false };
  }
}

async function generateContextualReply(commentText, threadCtx, postText, actorName, persona) {
  const lang = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/i.test(commentText) ? 'polsku' : 'English';

  const prompt = `${persona.slice(0, 300)}

Post (fragment): "${(postText||'').slice(0,200)}"

Wątek przed Twoją odpowiedzią:
${threadCtx || '(brak)'}

Nowy komentarz od ${actorName}: "${commentText.slice(0,300)}"

Napisz odpowiedź po ${lang} która:
- Logicznie kontynuuje wątek (nawiąż do poprzednich komentarzy jeśli są)
- Jest konkretna (50-120 słów)
- Kończy się pytaniem lub obserwacją zmuszającą do dalszej dyskusji
- Zero "Świetny komentarz!" / "Dzięki za pytanie"
- Styl: bezpośredni, developer-like

Tylko treść odpowiedzi.`;

  return await claudeRun(prompt, 40000) || 'Dzięki za komentarz — odezwę się wkrótce.';
}

// ── Main cycle ───────────────────────────────────────────────────────────────

async function checkNotifications() {
  if (!isActiveHour()) { log('Poza godzinami aktywnymi. Skip.'); return; }

  log('=== Sprawdzam notyfikacje LinkedIn ===');

  let liAt;
  try { liAt = getLiAt(); } catch(e) { log(`SKIP: ${e.message}`); return; }

  const persona = loadPersona();
  const notifications = await fetchNotifications(liAt);

  let proposalsCreated = 0;

  for (const n of notifications) {
    if (proposalsCreated >= MAX_PROPOSALS_PER_CYCLE) break;
    if (!n.commentText || n.commentText.length < 5) continue;
    if (isProcessed(n.notifId)) { log(`  Skip (already processed): ${n.actorName}`); continue; }

    log(`  → [${n.type}] ${n.actorName}: "${n.commentText.slice(0,70)}"`);

    // Pobierz wątek
    await sleep(randInt(2000, 5000)); // ludzkie opóźnienie
    const thread = await fetchCommentThread(n.postUrn, liAt);
    const threadCtx = buildThreadContext(thread, '');

    // Klasyfikuj
    const score = await classifyComment(n.commentText, threadCtx, '');
    log(`    lead=${score.lead_score} troll=${score.troll_risk} engage=${score.engagement_value} reply=${score.should_reply}`);

    markProcessed(n.notifId, n.type, n.postUrn, n.actorName);

    const shouldReply = score.should_reply !== false
      && score.troll_risk <= MAX_TROLL_RISK
      && (score.lead_score >= MIN_LEAD_OR_ENGAGE || score.engagement_value >= MIN_LEAD_OR_ENGAGE);

    if (!shouldReply) { log(`    Skip: poniżej progu`); continue; }

    // Losowe opóźnienie przed generowaniem (8-30s)
    await sleep(randInt(8000, 30000));

    const reply = await generateContextualReply(
      n.commentText, threadCtx, '', n.actorName, persona
    );

    saveProposal({
      commentUrn: n.notifId,
      commentText: n.commentText,
      actorName: n.actorName,
      postUrn: n.postUrn,
      postText: '',
      reply,
      lead_score: score.lead_score,
      troll_risk: score.troll_risk,
      engagement_value: score.engagement_value,
      threadCtx,
    });

    proposalsCreated++;

    // Przerwa między propozycjami
    if (proposalsCreated < MAX_PROPOSALS_PER_CYCLE) {
      await sleep(randInt(10000, 25000));
    }
  }

  log(`=== Koniec: ${proposalsCreated} propozycji dodanych ===\n`);
}

// ── Scheduler ────────────────────────────────────────────────────────────────

async function scheduleNext() {
  const delayMs = nextDelay();
  const nextTime = new Date(Date.now() + delayMs);
  log(`Następne sprawdzenie: ${nextTime.toLocaleTimeString('pl-PL')} (za ${Math.round(delayMs/60000)} min)`);
  setTimeout(async () => {
    await checkNotifications().catch(e => log(`Błąd cyklu: ${e.message}`));
    scheduleNext();
  }, delayMs);
}

// ── Start ────────────────────────────────────────────────────────────────────

initDb();

log('Auto-Notify Daemon uruchomiony');
log(`Sprawdza notyfikacje co ~2h ± ${Math.round(JITTER_MAX_MS/60000)} min`);
log(`Max ${MAX_PROPOSALS_PER_CYCLE} propozycji/cykl | threshold: lead/engage ≥ ${MIN_LEAD_OR_ENGAGE}, troll ≤ ${MAX_TROLL_RISK}`);

const initDelay = randInt(3, 12) * 60 * 1000;
log(`Start za ${Math.round(initDelay/60000)} min...`);

setTimeout(async () => {
  await checkNotifications().catch(e => log(`Błąd inicjalny: ${e.message}`));
  scheduleNext();
}, initDelay);
