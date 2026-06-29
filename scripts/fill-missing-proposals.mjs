#!/usr/bin/env node
/**
 * Generuje propozycje odpowiedzi dla komentarzy które są w thread_comments
 * ale nie mają wpisu w reply_proposals (zostały pominięte przez MAX_PROPOSALS_TOTAL).
 *
 * Używa Claude Opus z full context (persona + cały wątek + nasze poprzednie odpowiedzi).
 * Wszystko jako pending — user zatwierdza/odrzuca w dashboardzie.
 *
 * Limit: MAX_FILL (default 20) — żeby nie wybuchnąć kosztami przy dużym backfill.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/better-sqlite3/lib/index.js';

const ENGAGE_DB = join(homedir(), '.linkedin-mcp', 'engage.db');
const PERSONA_DIR = '/Users/gaca/projects/personal/second-mind/_system';
const CLAUDE_BIN = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const maxIdx = args.indexOf('--max');
const MAX_FILL = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 20;

const MIN_LEAD_OR_ENGAGE = 3;
const MAX_TROLL_RISK = 2;

const log = (m) => console.log(`[fill] ${new Date().toISOString().slice(11, 19)} ${m}`);

// ── Persona ─────────────────────────────────────────────────────────────────
let cachedPersona = null;
function loadPersona() {
  if (cachedPersona) return cachedPersona;
  let p = '', w = '';
  try { p = readFileSync(join(PERSONA_DIR, 'profile.md'), 'utf-8'); } catch {}
  try { w = readFileSync(join(PERSONA_DIR, 'work-style.md'), 'utf-8'); } catch {}
  cachedPersona = (p + '\n\n' + w).slice(0, 3500);
  return cachedPersona;
}

// ── Claude CLI ──────────────────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['-p', '--no-session-persistence', '--model', 'opus'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdin.write(prompt); child.stdin.end();
    child.stdout.on('data', d => out += d);
    const t = setTimeout(() => { child.kill(); resolve(null); }, 120000);
    child.on('close', code => { clearTimeout(t); resolve(code === 0 ? out.trim() : null); });
    child.on('error', () => { clearTimeout(t); resolve(null); });
  });
}

function parseClaude(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*"reply"[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────
const db = new Database(ENGAGE_DB);

// Pobierz komentarze NIE-nasze BEZ propozycji + ich kontekst wątku
const missing = db.prepare(`
  SELECT
    tc.comment_urn, tc.post_urn, tc.author_name, tc.comment_text, tc.parent_comment_urn,
    tm.post_text, tm.post_author, tm.thread_json, tm.our_replies_json
  FROM thread_comments tc
  LEFT JOIN thread_memory tm ON tm.post_urn = tc.post_urn
  WHERE tc.is_our_comment = 0
    AND NOT EXISTS (SELECT 1 FROM reply_proposals rp WHERE rp.source_id = tc.comment_urn)
  ORDER BY tc.scraped_at DESC
  LIMIT ?
`).all(MAX_FILL);

log(`Znalazłem ${missing.length} komentarzy bez propozycji (limit ${MAX_FILL})`);
if (missing.length === 0) { db.close(); process.exit(0); }

const persona = loadPersona();
const insert = db.prepare(`
  INSERT INTO reply_proposals
    (type, source_id, source_text, source_author, post_urn, post_text,
     proposed_reply, original_reply, lead_score, troll_risk, engagement_value, thread_context,
     temperature, tone, context_used, reasoning, parent_in_tree,
     comment_created_at, post_created_at, status)
  VALUES ('comment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'pending')
`);

let created = 0, skipped = 0, errors = 0;

for (let i = 0; i < missing.length; i++) {
  const c = missing[i];
  log(`[${i+1}/${missing.length}] ${c.author_name}: "${c.comment_text.slice(0, 60)}..."`);

  let thread = [];
  try { thread = JSON.parse(c.thread_json || '[]'); } catch {}
  let ourReplies = [];
  try { ourReplies = JSON.parse(c.our_replies_json || '[]'); } catch {}

  // Format wątku — zaznacz target
  const threadFormatted = thread.map((tc, idx) => {
    const marker = tc.isReply ? '  ↳ ' : '';
    const ours = tc.author && tc.author.includes('Bartosz') ? ' [TWOJA WCZEŚNIEJSZA ODPOWIEDŹ]' : '';
    const target = tc.commentUrn === c.comment_urn ? ' ← [TEN KOMENTARZ]' : '';
    return `${marker}${idx + 1}. ${tc.author}: "${(tc.text || '').slice(0, 250)}"${ours}${target}`;
  }).join('\n');

  const oursFormatted = ourReplies.length ? ourReplies.map((r, i) => `${i+1}. ${r}`).join('\n') : '(brak)';

  const prompt = `<persona>${persona.slice(0, 2000)}</persona>

<oryginalny_post>
Autor: ${c.post_author || 'Bartosz Gaca'}
Treść: ${(c.post_text || '').slice(0, 600)}
</oryginalny_post>

<historia_watku>
${threadFormatted || '(brak komentarzy)'}
</historia_watku>

<twoje_poprzednie_odpowiedzi>
${oursFormatted}
</twoje_poprzednie_odpowiedzi>

<zadanie>
Komentarz: "${c.comment_text}"
Autor: ${c.author_name}

Oceń (1-5): lead_score (5=konkretne pytanie/zainteresowanie), troll_risk (5=spam/agresja), engagement_value (5=otwarte pytanie/dyskusja).

**JĘZYK:** wykryj język KOMENTARZA i odpowiedz w tym samym (PL → PL, EN → EN).

ZAWSZE napisz odpowiedź 50-120 słów (user sam zdecyduje czy wysłać), bez "Świetny komentarz/Dzięki", zakończ pytaniem.
NIE powtarzaj się — sprawdź swoje poprzednie odpowiedzi w wątku.

Dodaj metadane:
- temperature: 1-5 (1=sucha, 5=mocna/ironiczna)
- tone: formal|casual|ironic|empathetic|technical|provocative|neutral
- context_used: lista max 4 elementów które wykorzystałeś
- reasoning: 1-2 zdania DLACZEGO ta odpowiedź

ZWRÓĆ TYLKO JSON:
{"lead_score": N, "troll_risk": N, "engagement_value": N, "reply": "...", "temperature": N, "tone": "...", "context_used": ["..."], "reasoning": "..."}
</zadanie>`;

  const raw = await callClaude(prompt);
  const parsed = parseClaude(raw);

  if (!parsed) { log(`    ❌ Claude nie zwrócił JSON`); errors++; continue; }
  log(`    lead=${parsed.lead_score} troll=${parsed.troll_risk} engage=${parsed.engagement_value} temp=${parsed.temperature} tone=${parsed.tone}`);

  if (!parsed.reply) {
    log(`    ⊘ Skip: brak reply w JSON`);
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    log(`    [DRY] Propozycja: ${parsed.reply.slice(0, 80)}...`);
    created++;
    continue;
  }

  insert.run(
    c.comment_urn, c.comment_text, c.author_name,
    c.post_urn, (c.post_text || '').slice(0, 500),
    parsed.reply,
    parsed.reply,  // original_reply = same as proposed_reply at insert time
    parsed.lead_score || 0, parsed.troll_risk || 0, parsed.engagement_value || 0,
    threadFormatted.slice(0, 4000),
    parsed.temperature || 3,
    parsed.tone || 'neutral',
    JSON.stringify(Array.isArray(parsed.context_used) ? parsed.context_used : []),
    (parsed.reasoning || '').slice(0, 500),
    c.comment_urn  // parent_in_tree = the comment we're replying to
  );
  log(`    ✅ Wstawiono jako pending`);
  created++;
}

db.close();
log(`\nGotowe: ${created} propozycji utworzonych, ${skipped} skipped, ${errors} errors`);
