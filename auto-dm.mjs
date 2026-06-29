#!/usr/bin/env node
/**
 * LinkedIn Auto-DM Daemon — odpowiada na wiadomości prywatne via Voyager API
 *
 * Filozofia: NIE cykliczne interwały — losowe okienka czasowe jak człowiek.
 * Sprawdza DMs 3-4x dziennie w losowych porach między 8:00-22:00.
 * Max 3 odpowiedzi dziennie. Min 2h między odpowiedziami na tę samą osobę.
 * Klasyfikacja: lead_score + troll_risk + urgency via Claude CLI.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import {
  buildDmPrompt, callClaude, parseClaudeJson, factCheck, retrieveKnowledge,
  loadPersona as loadFullPersona,
} from './lib/comment-gen.mjs';

// ── Config ──────────────────────────────────────────────────────────────────

const ENGAGE_DB = join(homedir(), '.linkedin-mcp', 'engage.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const SCRAPER_AUTH = join(homedir(), '.linkedin-mcp', 'scraper-auth.json');
const SECOND_MIND = '/Users/gaca/projects/personal/second-mind/_system';

// Ludzkie limity — nie robot
const MAX_REPLIES_PER_DAY = 3;
const MIN_HOURS_BETWEEN_REPLIES_SAME_PERSON = 2;
const REPLY_MIN_DELAY_MS = 8000;   // min 8 sekund przed odpowiedzią (człowiek czyta)
const REPLY_MAX_DELAY_MS = 45000;  // max 45 sekund (człowiek pisze odpowiedź)

// Scoring thresholds
const MIN_LEAD_SCORE_TO_REPLY = 4;  // DM = intymniejszy kanał, wyższy próg
const MAX_TROLL_RISK = 2;

// Aktywne godziny (8:00 - 22:00 CEST = 6:00 - 20:00 UTC)
const ACTIVE_HOUR_UTC_START = 6;
const ACTIVE_HOUR_UTC_END = 20;

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[auto-dm] ${new Date().toISOString().slice(11,19)} ${msg}`); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isActiveHour() {
  const h = new Date().getUTCHours();
  return h >= ACTIVE_HOUR_UTC_START && h < ACTIVE_HOUR_UTC_END;
}

function nextCheckDelay() {
  // Losowy interwał między 3h a 6h (nie cykliczne!)
  // Dodaje random jitter ±30 minut
  const baseMs = randInt(3 * 60, 6 * 60) * 60 * 1000;
  const jitterMs = randInt(-30, 30) * 60 * 1000;
  return baseMs + jitterMs;
}

function humanTypingDelay() {
  // Symuluje czas czytania + pisania (8-45 sekund)
  return randInt(REPLY_MIN_DELAY_MS, REPLY_MAX_DELAY_MS);
}

// ── DB Setup ─────────────────────────────────────────────────────────────────

function initDb() {
  const db = new Database(ENGAGE_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_watch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      message_id TEXT,
      sender_name TEXT,
      sender_urn TEXT,
      message_text TEXT,
      lead_score INTEGER DEFAULT 0,
      troll_risk INTEGER DEFAULT 0,
      urgency INTEGER DEFAULT 0,
      action TEXT DEFAULT 'pending',
      replied_text TEXT,
      checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_watch_msg ON message_watch(message_id);

    CREATE TABLE IF NOT EXISTS dm_daily_stats (
      date TEXT PRIMARY KEY,
      replies_sent INTEGER DEFAULT 0,
      messages_checked INTEGER DEFAULT 0
    );
  `);
  db.close();
}

// ── Persona ──────────────────────────────────────────────────────────────────

function loadPersona() {
  let profile = 'Bartosz Gaca — builder AI tools, MCP servers, automation. Direct, konkretny, bez BS.';
  try { profile = readFileSync(join(SECOND_MIND, 'profile.md'), 'utf-8').slice(0, 600); } catch {}
  return profile;
}

// ── Voyager API ──────────────────────────────────────────────────────────────

function getVoyagerCookie() {
  try {
    const d = JSON.parse(readFileSync(SCRAPER_AUTH, 'utf-8'));
    if (!d.li_at) throw new Error('no li_at');
    return d.li_at;
  } catch {
    throw new Error('Brak li_at cookie — zaloguj się przez dashboard Rutyna → Voyager');
  }
}

async function voyagerGet(path, liAt) {
  const resp = await fetch(`https://www.linkedin.com/voyager/api${path}`, {
    headers: {
      'Cookie': `li_at=${liAt}`,
      'Csrf-Token': 'ajax:0',
      'X-RestLi-Protocol-Version': '2.0.0',
      'X-Li-Lang': 'pl_PL',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  if (!resp.ok) throw new Error(`Voyager ${resp.status}: ${path}`);
  return resp.json();
}

async function voyagerPost(path, body, liAt) {
  // Pobierz CSRF token z ciasteczek
  const cookieResp = await fetch('https://www.linkedin.com/', {
    headers: { 'Cookie': `li_at=${liAt}` },
  });
  const csrfMatch = cookieResp.headers.get('set-cookie')?.match(/JSESSIONID="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : 'ajax:0';

  const resp = await fetch(`https://www.linkedin.com/voyager/api${path}`, {
    method: 'POST',
    headers: {
      'Cookie': `li_at=${liAt}; JSESSIONID="${csrf}"`,
      'Csrf-Token': csrf,
      'Content-Type': 'application/json',
      'X-RestLi-Protocol-Version': '2.0.0',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Voyager POST ${resp.status}: ${await resp.text()}`);
  return resp.json().catch(() => ({}));
}

async function fetchInboxMessages(liAt) {
  try {
    const data = await voyagerGet(
      '/messaging/conversations?q=INBOX&start=0&count=20&includeThirdParty=true',
      liAt
    );
    const convos = data?.elements || [];
    const messages = [];

    for (const conv of convos.slice(0, 15)) {
      const convId = conv.entityUrn?.split(':').pop() || conv['*events']?.split(':').pop();
      if (!convId) continue;

      const lastMsg = conv.events?.[0];
      if (!lastMsg) continue;

      const senderUrn = lastMsg.from?.com?.linkedin?.voyager?.messaging?.MessagingMember?.miniProfile?.entityUrn;
      const senderName = lastMsg.from?.com?.linkedin?.voyager?.messaging?.MessagingMember?.miniProfile?.firstName || 'Unknown';
      const msgText = lastMsg.eventContent?.com?.linkedin?.voyager?.messaging?.event?.content?.com?.linkedin?.voyager?.messaging?.event?.content?.text
        || lastMsg.eventContent?.text
        || '';
      const msgId = lastMsg.dashEntityUrn || lastMsg.entityUrn || convId + '_' + Date.now();
      const isFromMe = lastMsg.from?.com?.linkedin?.voyager?.messaging?.MessagingMember?.miniProfile?.entityUrn?.includes('FihAwG4y_B');

      if (isFromMe || !msgText || msgText.length < 5) continue;

      messages.push({ conversationId: convId, messageId: msgId, senderName, senderUrn, text: msgText });
    }
    return messages;
  } catch (err) {
    log(`Voyager inbox error: ${err.message}`);
    return [];
  }
}

async function sendDMReply(conversationId, replyText, liAt) {
  await voyagerPost(`/messaging/conversations/${conversationId}/events`, {
    eventCreate: {
      value: {
        'com.linkedin.voyager.messaging.create.MessageCreate': {
          body: replyText,
          attachments: [],
          attributedBody: { text: replyText, attributes: [] },
          mediaAttachments: [],
        },
      },
    },
  }, liAt);
}

// ── Classification via Claude CLI ────────────────────────────────────────────

async function classifyMessage(msgText, persona) {
  const prompt = `Sklasyfikuj wiadomość LinkedIn DM.

Wiadomość: "${msgText.slice(0, 500)}"

Mój profil: ${persona.slice(0, 200)}

Oceń na 3 osiach (1-5) i wybierz akcję:

lead_score: 5=konkretne pytanie o usługę/cenę/demo/współpracę, 3=ogólne zainteresowanie, 1=brak związku
troll_risk: 5=spam/agresja/niechciana oferta sprzedaży, 2=neutralne, 1=szczere zainteresowanie
urgency: 5=wymaga odpowiedzi dziś, 3=może poczekać tydzień, 1=nie wymaga odpowiedzi

Akcja: reply = warto odpowiedzieć | skip = zignoruj/spam | read_only = ciekawe ale nie odpowiadaj

Zwróć TYLKO JSON: {"action":"reply|skip|read_only","lead_score":N,"troll_risk":N,"urgency":N,"reason":"1 zdanie"}`;

  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--no-session-persistence', '--model', 'claude-haiku-4-5-20251001'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on('data', d => out += d);
    child.on('close', () => {
      try {
        const m = out.match(/\{[^}]*"action"[^}]*\}/s);
        if (m) resolve(JSON.parse(m[0]));
        else resolve({ action: 'skip', lead_score: 1, troll_risk: 1, urgency: 1, reason: 'parse failed' });
      } catch {
        resolve({ action: 'skip', lead_score: 1, troll_risk: 1, urgency: 1, reason: 'error' });
      }
    });
    child.on('error', () => resolve({ action: 'skip', lead_score: 1, troll_risk: 1, urgency: 1, reason: 'claude unavailable' }));
    setTimeout(() => { child.kill(); resolve({ action: 'skip', lead_score: 1, troll_risk: 1, urgency: 1, reason: 'timeout' }); }, 30000);
  });
}

// DM: ten sam pipeline co komentarze — Opus 4.8 + pełna persona + baza wiedzy + humanizer + fact-check.
// Zwraca string (gotowa odpowiedź) albo null (gdy model nie zwrócił sensownej treści — wtedy NIE proponujemy).
async function generateDMReply(msgText, senderName, persona, conversation) {
  const kb = retrieveKnowledge(msgText || '');
  if (kb.sources && kb.sources.length) log(`    📚 Baza wiedzy: ${kb.sources.join(', ')}`);
  const prompt = buildDmPrompt({
    persona, senderName,
    lastMessage: (msgText || '').slice(0, 1500),
    conversation, knowledge: kb.text,
  });
  log(`    🧠 Opus 4.8 generuje odpowiedź DM...`);
  const parsed = parseClaudeJson(await callClaude(prompt, { log: (m) => log(m.trim()) }));
  let reply = (parsed && parsed.reply) ? String(parsed.reply).trim() : '';
  if (!reply) { log('    ⚠️  DM: brak poprawnej odpowiedzi od Opusa — pomijam (nie proponuję śmiecia)'); return null; }

  // Fact-check (potwierdź że nie kłamie) — z bazą wiedzy jako grounded
  try {
    const fc = await factCheck({ postText: '', threadContext: `${senderName}: ${msgText}`, proposedReply: reply, persona, knowledge: kb.text }, { log: (m) => log(m.trim()) });
    if (fc.grounded === false) {
      if (fc.fixed_reply) { log(`    🛡️  DM fact-check: poprawiono (${fc.unsupported_claims.length} konkretów)`); reply = fc.fixed_reply; }
      else log(`    🚫 DM fact-check: HALLUCINATION_RISK — ${(fc.unsupported_claims || []).slice(0, 3).join('; ')} (do oceny w dashboardzie)`);
    }
  } catch {}
  return reply;
}

// ── Daily limit check ────────────────────────────────────────────────────────

function getTodayReplies() {
  const db = new Database(ENGAGE_DB, { readonly: true });
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT replies_sent FROM dm_daily_stats WHERE date = ?').get(today);
  db.close();
  return row?.replies_sent || 0;
}

function recordReply(conversationId, senderUrn, replyText, score) {
  const db = new Database(ENGAGE_DB);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    UPDATE message_watch SET action='replied', replied_text=?, checked_at=datetime('now')
    WHERE conversation_id=? ORDER BY id DESC LIMIT 1
  `).run(replyText, conversationId);
  db.prepare(`
    INSERT INTO dm_daily_stats (date, replies_sent, messages_checked) VALUES (?, 1, 0)
    ON CONFLICT(date) DO UPDATE SET replies_sent = replies_sent + 1
  `).run(today);
  db.close();
}

function wasRecentlyContacted(senderUrn) {
  const db = new Database(ENGAGE_DB, { readonly: true });
  const cutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_REPLIES_SAME_PERSON * 3600 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM message_watch
    WHERE sender_urn = ? AND action = 'replied' AND checked_at > ?
  `).get(senderUrn, cutoff);
  db.close();
  return (row?.c || 0) > 0;
}

function isAlreadyProcessed(messageId) {
  const db = new Database(ENGAGE_DB, { readonly: true });
  const row = db.prepare('SELECT id FROM message_watch WHERE message_id = ?').get(messageId);
  db.close();
  return !!row;
}

function saveMessage(msg, score) {
  const db = new Database(ENGAGE_DB);
  db.prepare(`
    INSERT OR IGNORE INTO message_watch
    (conversation_id, message_id, sender_name, sender_urn, message_text,
     lead_score, troll_risk, urgency, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(msg.conversationId, msg.messageId, msg.senderName, msg.senderUrn, msg.text,
         score.lead_score, score.troll_risk, score.urgency);
  db.close();
}

// ── Main check cycle ──────────────────────────────────────────────────────────

async function checkAndReply() {
  if (!isActiveHour()) {
    log('Poza aktywnymi godzinami (8:00-22:00 CEST). Skip.');
    return;
  }

  log('=== Sprawdzam DMs ===');

  let liAt;
  try { liAt = getVoyagerCookie(); } catch (e) { log(`SKIP: ${e.message}`); return; }

  const persona = loadFullPersona();
  const messages = await fetchInboxMessages(liAt);
  log(`  Pobrano ${messages.length} konwersacji`);

  const todayReplies = getTodayReplies();
  if (todayReplies >= MAX_REPLIES_PER_DAY) {
    log(`  Dzienny limit ${MAX_REPLIES_PER_DAY} osiągnięty. Skip.`);
    return;
  }

  let repliesSent = 0;

  for (const msg of messages) {
    if (repliesSent + todayReplies >= MAX_REPLIES_PER_DAY) break;
    if (isAlreadyProcessed(msg.messageId)) continue;
    if (wasRecentlyContacted(msg.senderUrn)) {
      log(`  Skip ${msg.senderName}: za wcześnie (${MIN_HOURS_BETWEEN_REPLIES_SAME_PERSON}h cooldown)`);
      continue;
    }

    log(`  → ${msg.senderName}: "${msg.text.slice(0, 80)}..."`);

    // Klasyfikacja
    const score = await classifyMessage(msg.text, persona);
    log(`    lead=${score.lead_score} troll=${score.troll_risk} urgency=${score.urgency} → ${score.action}`);

    saveMessage(msg, score);

    const shouldReply = score.action === 'reply'
      && score.lead_score >= MIN_LEAD_SCORE_TO_REPLY
      && score.troll_risk <= MAX_TROLL_RISK;

    if (!shouldReply) {
      log(`    Skip: poniżej progu (lead≥${MIN_LEAD_SCORE_TO_REPLY} wymagane)`);
      continue;
    }

    // Losowe opóźnienie — człowiek czyta i pisze
    const delay = humanTypingDelay();
    log(`    Czekam ${Math.round(delay/1000)}s (symulacja czytania)...`);
    await sleep(delay);

    const reply = await generateDMReply(msg.text, msg.senderName, persona);
    if (!reply) { log('    Skip: brak sensownej odpowiedzi (nie proponuję).'); continue; }
    log(`    Odpowiedź: "${reply.slice(0, 80)}..."`);

    // PROPOSALS-FIRST: zapisz propozycję do DB, NIE wysyłaj automatycznie
    try {
      const propDb = new Database(ENGAGE_DB);
      propDb.prepare(`
        INSERT OR IGNORE INTO reply_proposals
        (type, source_id, source_text, source_author,
         proposed_reply, lead_score, troll_risk, urgency, status)
        VALUES ('dm', ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        msg.conversationId + '_' + Date.now(),
        msg.text, msg.senderName,
        reply, score.lead_score||0, score.troll_risk||0, score.urgency||0
      );
      propDb.close();

      // Zapisz też do message_watch
      recordReply(msg.conversationId, msg.senderUrn, '[proposal saved]', score);
      repliesSent++;
      log(`    💾 Propozycja DM zapisana (${repliesSent + todayReplies}/${MAX_REPLIES_PER_DAY} dziś)`);
      log(`    Zatwierdź na http://localhost:6767 → Propozycje`);
    } catch (e) {
      log(`    ❌ Błąd zapisu propozycji: ${e.message}`);
    }

    // Przerwa między wiadomościami (kolejna losowa)
    if (repliesSent < MAX_REPLIES_PER_DAY) {
      const pause = randInt(15000, 60000);
      log(`    Przerwa ${Math.round(pause/1000)}s przed kolejną...`);
      await sleep(pause);
    }
  }

  log(`=== Koniec: ${repliesSent} odpowiedzi wysłanych ===\n`);
}

// ── Scheduler — losowe okienka, nie cykl ─────────────────────────────────────

async function scheduleNext() {
  const delayMs = nextCheckDelay();
  const nextTime = new Date(Date.now() + delayMs);
  log(`Następne sprawdzenie: ${nextTime.toLocaleTimeString('pl-PL')} (za ${Math.round(delayMs/60000)} min)`);
  setTimeout(async () => {
    await checkAndReply().catch(e => log(`Błąd cyklu: ${e.message}`));
    scheduleNext(); // zaplanuj kolejne
  }, delayMs);
}

// ── Start ─────────────────────────────────────────────────────────────────────

initDb();

log('Auto-DM Daemon uruchomiony');
log(`Limity: max ${MAX_REPLIES_PER_DAY} DM/dzień | cooldown ${MIN_HOURS_BETWEEN_REPLIES_SAME_PERSON}h/osoba`);
log(`Opóźnienia: losowe 8-45s (ludzki styl) | interwały: losowe 3-6h`);
log(`Scoring: lead≥${MIN_LEAD_SCORE_TO_REPLY} + troll≤${MAX_TROLL_RISK} żeby odpowiedzieć`);

// Pierwsze sprawdzenie po losowym opóźnieniu 5-20 minut (nie od razu)
const initDelay = randInt(5, 20) * 60 * 1000;
log(`Start za ${Math.round(initDelay/60000)} min...`);
setTimeout(async () => {
  await checkAndReply().catch(e => log(`Błąd inicjalny: ${e.message}`));
  scheduleNext();
}, initDelay);
