#!/usr/bin/env node
/**
 * Przenosi PROPOSED_POSTS z dashboard.mjs do bazy jako realne propozycje.
 *
 * Dlaczego: te 14 postów siedziało w zahardkodowanej tablicy w dashboard.mjs
 * z datami z kwietnia/maja 2026. Nie były w żadnej bazie, więc:
 *   - wisiały w kolejce pod martwymi tygodniami (nie dało się ich "poukładać"),
 *   - NIGDY nie przeszły przez qa-gate.mjs, bo bramka czyta scheduled_posts.
 *
 * Co robi:
 *   1. AUDYT deterministyczny wg guidelines/CHECKLIST-SPRAWDZANIA-POSTOW.md
 *      (hashtagi 0-1, zero em-dashów, długość 1300-1600, hook <=210, brak
 *      kwot klienckich, brak baitu "link w komentarzu")
 *   2. NAPRAWA tego, co da się naprawić deterministycznie
 *   3. MIGRACJA do media_plan_items (status='napisane') + scheduled_posts
 *      (status='draft') na pierwsze WOLNE terminy wt/śr/czw 08:10 w przyszłości
 *
 * Post ląduje jako 'draft', nie 'scheduled' — auto-publish bierze tylko
 * qa_status='approved', a pełny fact-check robi dopiero qa-gate.mjs --id <id>.
 * Oryginalny tekst zawsze zostaje w scheduled_posts.text_original.
 *
 * Użycie:
 *   node scripts/migrate-hardcoded-proposals.mjs           # audyt, nic nie zapisuje
 *   node scripts/migrate-hardcoded-proposals.mjs --apply   # audyt + naprawa + migracja
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { humanizeText } from '../lib/humanize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp'), 'scheduler.db');
const APPLY = process.argv.includes('--apply');
const TAG = 'dashboard-hardcoded-2026-07-26';

// ── 1. Wyciągnięcie tablicy z dashboard.mjs ────────────────────────────────
function readProposedPosts() {
  const src = readFileSync(join(ROOT, 'dashboard.mjs'), 'utf8');
  const start = src.indexOf('const PROPOSED_POSTS = [');
  if (start < 0) throw new Error('Nie znalazłem PROPOSED_POSTS w dashboard.mjs');
  const end = src.indexOf('\n];', start);
  const literal = src.slice(start + 'const PROPOSED_POSTS = '.length, end + 2);
  return eval(literal); // literał tablicy z własnego repo, nie wejście użytkownika
}

// ── 2. Audyt deterministyczny wg checklisty ───────────────────────────────
const RE_EMDASH = /[—–]/g;
// Kwoty w PLN = ceny moich usług i budżety/wyniki klientów. To dane
// niepubliczne — nie idą do posta. Kwoty w $ to zwykle publiczne cenniki
// obcych SaaS-ów (Hootsuite itp.), więc tylko informacja, nie bloker.
const RE_MONEY_CLIENT = /\d[\d\s.,]*\s*(?:K\s*)?(?:PLN|zł|złotych)|\d+\s*K\/mies/gi;
const RE_MONEY_PUBLIC = /\$\s?\d[\d.,]*/g;
const RE_BAIT = /link w (?:pierwszym )?komentarzu|link w 1\. komentarzu/i;
const RE_HASHTAG = /#[\p{L}\p{N}_]+/gu;

function auditPost(text) {
  const issues = [];
  const hashtags = text.match(RE_HASHTAG) || [];
  const emdashes = text.match(RE_EMDASH) || [];
  const moneyClient = text.match(RE_MONEY_CLIENT) || [];
  const moneyPublic = text.match(RE_MONEY_PUBLIC) || [];
  const hook = text.split('\n')[0];

  if (hashtags.length > 1) issues.push({ rule: 'hashtagi 0-1', detail: `${hashtags.length}: ${hashtags.join(' ')}`, level: 'fix' });
  if (emdashes.length) issues.push({ rule: 'zero em-dashów', detail: `${emdashes.length} wystąpień`, level: 'fix' });
  if (RE_BAIT.test(text)) issues.push({ rule: 'bait: link w komentarzu', detail: 'fraza obecna', level: 'fix' });
  if (moneyClient.length) issues.push({ rule: 'KWOTY NIEPUBLICZNE', detail: moneyClient.join(' | '), level: 'block' });
  if (hook.length > 210) issues.push({ rule: 'hook <=210', detail: `${hook.length} znaków`, level: 'block' });
  if (moneyPublic.length) issues.push({ rule: 'kwoty w $ (cennik obcy — sprawdź)', detail: moneyPublic.join(' | '), level: 'warn' });
  if (text.length < 1300) issues.push({ rule: 'długość 1300-1600', detail: `${text.length} zn — poniżej optimum dwell time`, level: 'warn' });
  else if (text.length > 1600) issues.push({ rule: 'długość 1300-1600', detail: `${text.length} zn (za długi)`, level: 'warn' });
  if (humanizeText(text) !== text) issues.push({ rule: 'humanizer', detail: 'zmienia tekst = są ślady AI', level: 'fix' });

  return { issues, hashtags: hashtags.length, len: text.length, hookLen: hook.length };
}

// ── 3. Naprawa deterministyczna ───────────────────────────────────────────
function fixPost(text) {
  const applied = [];
  let out = text;

  // Humanizer: em-dashy i artefakty AI. Reguła z checklisty: NIGDY em-dash.
  const humanized = humanizeText(out);
  if (humanized !== out) { out = humanized; applied.push('humanizer'); }

  // Hashtagi: zostaw maksymalnie 1 (brak = +5-10% zasięgu, >3 nigdy).
  const tags = out.match(RE_HASHTAG) || [];
  if (tags.length > 1) {
    const lines = out.split('\n');
    const idx = lines.findIndex((l) => (l.match(RE_HASHTAG) || []).length > 1);
    if (idx >= 0) {
      lines[idx] = tags[0];
      out = lines.join('\n');
      applied.push(`hashtagi ${tags.length} -> 1`);
    }
  }

  // Bait: odsyłanie po link do komentarza (LinkedIn to zakopuje).
  if (RE_BAIT.test(out)) {
    out = out.split('\n').filter((l) => !RE_BAIT.test(l)).join('\n');
    applied.push('usunięto bait "link w komentarzu"');
  }

  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), applied };
}

// ── 4. Wolne terminy: wt/śr/czw 08:10 (sygnatura backlogu idea-engine) ────
function freeSlots(db, count) {
  const taken = new Set(
    db.prepare("SELECT DISTINCT substr(publish_at,1,10) d FROM scheduled_posts WHERE status IN ('scheduled','draft','publishing')")
      .all().map((r) => r.d)
  );
  const planned = new Set(
    db.prepare("SELECT DISTINCT substr(publish_at,1,10) d FROM media_plan_items WHERE status IN ('plan','napisane','drafted')")
      .all().map((r) => r.d)
  );

  const slots = [];
  const cur = new Date();
  cur.setUTCDate(cur.getUTCDate() + 1); // od jutra
  while (slots.length < count) {
    const dow = cur.getUTCDay(); // 2=wt, 3=śr, 4=czw
    const iso = cur.toISOString().slice(0, 10);
    if ([2, 3, 4].includes(dow) && !taken.has(iso) && !planned.has(iso)) {
      slots.push(`${iso}T08:10:00`);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return slots;
}

// ── main ──────────────────────────────────────────────────────────────────
const posts = readProposedPosts();
const db = new Database(DB_PATH, { readonly: !APPLY });

const already = new Set(
  db.prepare("SELECT title FROM media_plan_items WHERE source_project = ?").all(TAG).map((r) => r.title)
);
const todo = posts.filter((p) => !already.has(p.title));

console.log(`PROPOSED_POSTS w dashboard.mjs: ${posts.length}`);
console.log(`już zmigrowane: ${already.size} | do zrobienia: ${todo.length}`);
console.log(`tryb: ${APPLY ? 'APPLY (zapis)' : 'AUDYT (bez zapisu)'}\n`);

const slots = todo.length ? freeSlots(db, todo.length) : [];
let blockers = 0;

const insertMp = db.prepare(`
  INSERT INTO media_plan_items (id, topic_number, slug, title, hook, language, publish_at, status,
                                post_text, original_post_text, format, source_project, banner_concept,
                                scheduled_post_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'pl', ?, 'napisane', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`);
const insertSp = db.prepare(`
  INSERT INTO scheduled_posts (id, text, text_original, visibility, language, publish_at, status,
                               imported_from, created_at, updated_at)
  VALUES (?, ?, ?, 'PUBLIC', 'pl', ?, 'draft', ?, datetime('now'), datetime('now'))
`);
const nextTopic = (db.prepare("SELECT COALESCE(MAX(topic_number),0) m FROM media_plan_items").get().m) + 1;

todo.forEach((p, i) => {
  const before = auditPost(p.text);
  const fixed = fixPost(p.text);
  const after = auditPost(fixed.text);
  const hard = after.issues.filter((x) => x.level === 'block');
  if (hard.length) blockers++;

  console.log(`${String(i + 1).padStart(2)}. ${p.title}`);
  console.log(`    stara data: ${p.date.slice(0, 10)}  ->  nowa: ${slots[i]?.slice(0, 10) || '—'}`);
  console.log(`    przed: ${before.len} zn, ${before.hashtags} hashtagów, ${before.issues.length} uwag`);
  if (fixed.applied.length) console.log(`    naprawiono: ${fixed.applied.join(', ')}`);
  if (after.issues.length) {
    const mark = { block: '✗ BLOKER', warn: '! uwaga', fix: '~ do naprawy' };
    for (const x of after.issues) {
      console.log(`    ${mark[x.level]} ${x.rule}: ${x.detail}`);
    }
  } else {
    console.log('    ✓ audyt deterministyczny czysty');
  }
  console.log(`    media: ${p.image ? 'obraz ' + p.image : 'BRAK obrazu'} | screenshot: ${p.screenshot || '—'}`);

  if (APPLY) {
    const spId = randomUUID();
    const slug = p.title.toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
    insertSp.run(spId, fixed.text, p.text, slots[i], TAG);
    insertMp.run(randomUUID(), nextTopic + i, `${slug}-${nextTopic + i}`, p.title,
      p.text.split('\n')[0], slots[i], fixed.text, p.text,
      p.image ? 'post-obraz' : 'post-tekst', TAG, p.screenshot || null, spId);
    console.log(`    -> zapisano: scheduled_posts ${spId} (draft) + media_plan_items #${nextTopic + i}`);
  }
  console.log();
});

console.log('─'.repeat(70));
console.log(`Postów z twardymi blokerami (do ręcznej decyzji): ${blockers}/${todo.length}`);
console.log('BLOKER = kwoty niepubliczne (moje ceny, budżety i wyniki klientów) albo hook >210 zn.');
console.log('Ich NIE naprawia automat — wymagają Twojej decyzji o treści.');
if (!APPLY) console.log('\nTo był audyt. Uruchom z --apply, żeby zapisać.');
else console.log(`\nNastępny krok: qa-gate na każdym draftcie (fact-check + scoring).`);

db.close();
