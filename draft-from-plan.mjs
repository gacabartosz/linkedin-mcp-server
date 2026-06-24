#!/usr/bin/env node
/**
 * Draft Engine — zamienia seed z media_plan_items (status='plan') w PEŁNY draft posta
 * i wstawia go do scheduled_posts (status='scheduled', qa_status=NULL).
 *
 * Domyka lukę w pipeline: idea-engine robił tylko seedy (scena+liczby+pytanie-spór),
 * a scheduled_posts powstawały RĘCZNIE. Teraz: seed → pełny post (Claude, reguły
 * algorithm-2026.json + struktura wybranego szablonu) → DB. Bramka qa-gate.mjs
 * dokańcza scoring/rewrite — nic nie dublujemy.
 *
 * Żelazne zasady (jak idea-engine/qa-gate): ZERO zmyślania liczb/scen. Tylko to,
 * co jest w seedzie. Jak za mało materiału — krótszy uczciwy post, bramka go oceni.
 *
 * Mechanika AI = `claude` CLI headless (Opus 4.8, bez ANTHROPIC_API_KEY).
 *
 * Użycie:
 *   node draft-from-plan.mjs                 # top N planów (domyślnie 5)
 *   node draft-from-plan.mjs --limit 3
 *   node draft-from-plan.mjs --id <media_plan_item_id>
 *   node draft-from-plan.mjs --dry           # pokaż draft, nie zapisuj
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const BRAND_VOICE_PATH = join(homedir(), '.linkedin-mcp', 'brand-voice.json');
const ALGO_PATH = join(__dirname, 'guidelines', 'algorithm-2026.json');
const TEMPLATES_DIR = join(__dirname, 'templates');
const CLAUDE = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DRY = args.includes('--dry');
const ONLY_ID = argVal('--id', null);
const LIMIT = Number(argVal('--limit', '5')) || 5;

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

const algo = JSON.parse(readFileSync(ALGO_PATH, 'utf8'));
const brand = existsSync(BRAND_VOICE_PATH) ? JSON.parse(readFileSync(BRAND_VOICE_PATH, 'utf8')) : {};

// Wybór szablonu po formacie/niszy. Szablon daje STRUKTURĘ (nie wypełniamy {{}} mechanicznie —
// model pisze pełny post wg intencji szablonu + reguł algorytmu).
function pickTemplate(mpi) {
  const fmt = String(mpi.format || 'text').toLowerCase();
  if (fmt === 'carousel') return 'carousel-edu';
  if (String(mpi.icp || '').includes('e-gov')) return 'thought-leadership-pl';
  return 'lesson-learned'; // domyślnie: relacja przeżyta — najlepsze komentarze
}
function loadTemplate(id) {
  const p = join(TEMPLATES_DIR, `${id}.json`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
function mediaKind(fmt) {
  return { image: 'IMAGE', carousel: 'CAROUSEL', video: 'VIDEO' }[String(fmt || 'text').toLowerCase()] || 'TEXT';
}

function buildDraftPrompt(mpi, tmpl) {
  const T = algo.scoring.thresholds;
  const links = (algo.links?.policy ?? []);
  const tmplHint = tmpl
    ? `\nSTRUKTURA REFERENCYJNA (szablon "${tmpl.name}", trzymaj się ducha, nie wstawiaj literalnie {{pól}}):\n- ${(tmpl.tips || []).join('\n- ')}`
    : '';
  const numbers = mpi.post_text || '';
  return `Jesteś redaktorem LinkedIn dla profilu Bartosza Gacy (build-in-public, język POLSKI).
Masz SEED (surowiec z realnego commita) i masz napisać PEŁNY, gotowy do publikacji post po polsku.

═══ ZASADA NACZELNA (algorytm 2026) ═══
${algo.manifesto.one_liner}
${algo.manifesto.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')}

PERSONA/TON: ${brand.voice?.persona ?? 'Builder-practitioner, nie influencer.'} ${brand.voice?.tone ?? 'Bezpośrednio, konkretnie, jak developer w Slacku.'}

TWARDE REGUŁY:
- JĘZYK: polski. Krótkie zdania, jedna myśl = jeden akapit, dużo enterów (mobile).
- ZERO ZMYŚLANIA: użyj WYŁĄCZNIE faktów/liczb/scen z seeda. Brak materiału na konkret → napisz krócej i uczciwie, NIE dorabiaj liczb ani anegdot.
- Hook (pierwsza linia, ≤ ${brand.hook_max_chars ?? 210} zn): problem albo PORAŻKA pierwsza, nie sukces.
- Relacja pierwszoosobowa „zrobiłem/zobaczyłem/wkurzyło mnie", pokaż drogę i błąd PRZED wynikiem. NIE listicle („X sposobów"), NIE tryb rozkazujący.
- Zakończ DOKŁADNIE tym zamkniętym pytaniem-sporem: "${(mpi.cta || '').replace(/"/g, "'")}" (jeśli puste — wymyśl jedno zamknięte pytanie-spór z treści).
- Max 3 hashtagi na końcu, trafione w niszę (${mpi.icp || 'ai-automation'}).
- LINKI: ${links.join(' ')} (NIGDY linka w komentarzu; w treści tylko gdy link JEST sednem — tu raczej bez linka).
- ZERO baitu/lead-magnetu ("napisz HASŁO", "DM po PDF", "zapisz/udostępnij", "oznacz znajomego").
- Cel jakościowy bramki (pisz tak, by przejść): experience≥${T.experience_min}, specificity≥${T.specificity_min}, emotion≥${T.emotion_min}, commentability≥${T.commentability_min}.${tmplHint}

SEED:
- Tytuł roboczy: ${mpi.title || ''}
- Hook (propozycja): ${mpi.hook || ''}
- Materiał (scena + liczby + pytanie-spór):
${numbers}
- Problem odbiorcy (lead): ${mpi.lead_trigger || ''}
- Format docelowy: ${mpi.format || 'text'}

Zwróć WYŁĄCZNIE surowy JSON (bez markdown): {"post":"<pełny tekst posta po polsku, z hookiem na początku, zamkniętym pytaniem i ≤3 hashtagami na końcu>"}`;
}

function runClaude(prompt) {
  const r = spawnSync(CLAUDE, ['-p', prompt, '--output-format', 'json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  if (r.status !== 0 && !r.stdout) throw new Error(`claude exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  let txt = r.stdout;
  try { const env = JSON.parse(r.stdout); if (env && typeof env.result === 'string') txt = env.result; } catch {}
  let s = txt.replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('Brak JSON w odpowiedzi claude');
  const obj = JSON.parse(s.slice(a, b + 1));
  const post = String(obj.post || '').trim();
  if (!post) throw new Error('Pusty post w odpowiedzi claude');
  return post;
}

function main() {
  const db = new Database(DB_PATH);
  let rows;
  if (ONLY_ID) {
    rows = db.prepare("SELECT * FROM media_plan_items WHERE id = ? AND status='plan'").all(ONLY_ID);
  } else {
    // najświeższe plany pierwsze (seedy idea-engine nie mają jeszcze score_total),
    // score jako tie-break — żeby świeża partia faktycznie poszła do draftu
    rows = db.prepare(
      "SELECT * FROM media_plan_items WHERE status='plan' ORDER BY created_at DESC, COALESCE(score_total,0) DESC LIMIT ?"
    ).all(LIMIT);
  }
  log(`Draft Engine — ${rows.length} plan(ów) do zdraftowania${DRY ? ' (DRY)' : ''}`);
  let ok = 0, err = 0;

  for (const mpi of rows) {
    const tmplId = pickTemplate(mpi);
    const tmpl = loadTemplate(tmplId);
    log(`✍  ${mpi.slug || mpi.id} [${mpi.icp}/${mpi.format}] szablon=${tmplId}`);
    let post;
    try { post = runClaude(buildDraftPrompt(mpi, tmpl)); }
    catch (e) { err++; log(`   ERROR: ${e.message}`); continue; }

    log(`   → ${post.length} zn. | hook: ${post.split('\n')[0].slice(0, 90)}`);
    if (mediaKind(mpi.format) !== 'TEXT') log(`   ⓘ format ${mpi.format}: draft tekstowy gotowy; wizual (banner/screen) dorobić przed publikacją.`);

    if (DRY) { log('   (--dry: nie zapisuję)'); ok++; continue; }

    const postId = randomUUID();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO scheduled_posts
        (id, text, visibility, publish_at, status, language, media_kind, template_id, imported_from, created_at, updated_at)
        VALUES (?, ?, 'PUBLIC', ?, 'scheduled', 'pl', ?, ?, 'draft-from-plan', datetime('now'), datetime('now'))`)
        .run(postId, post, mpi.publish_at, mediaKind(mpi.format), tmplId);
      db.prepare("UPDATE media_plan_items SET status='drafted', scheduled_post_id=?, updated_at=datetime('now') WHERE id=?")
        .run(postId, mpi.id);
    });
    tx();
    ok++;
    log(`   ✅ scheduled_posts ${postId.slice(0, 8)} (qa_status=NULL → trafi do qa-gate); plan→drafted`);
  }

  db.close();
  log(`Draft Engine koniec — zdraftowane: ${ok}, błędy: ${err}${DRY ? ' (DRY, nie zapisano)' : ''}`);
}

main();
