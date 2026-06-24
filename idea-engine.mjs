#!/usr/bin/env node
/**
 * Idea Engine (Faza 2) — wydobywa REALNE przeżycia z gitów Twoich projektów
 * i zamienia je w kolejkę pomysłów na posty (media_plan_items, status='plan').
 *
 * Przyczyna #1 generycznych postów: piszemy z pustki. Tu draft startuje z prawdziwej
 * historii (scena + liczby z commitów), więc bramka QA przepuszcza za pierwszym razem.
 *
 * Zasady żelazne:
 *   - TYLKO z realnych commitów. ZERO zmyślania (brak historii → brak pomysłu).
 *   - WYŁĄCZNIE własne repo build-in-public (config). NIGDY danych/nazw klientów.
 *   - 2 nisze: ai-automation, e-gov.
 *
 * Mechanika AI = `claude` CLI headless (Opus 4.8, bez ANTHROPIC_API_KEY) — wzorzec z qa-gate.
 *
 * Użycie:
 *   node idea-engine.mjs                 # wszystkie repo z configu
 *   node idea-engine.mjs --project carhunter
 *   node idea-engine.mjs --days 30 --limit 6
 *   node idea-engine.mjs --dry           # pokaż pomysły, nie zapisuj
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const CONFIG_PATH = join(__dirname, 'guidelines', 'idea-engine.config.json');
const ALGO_PATH = join(__dirname, 'guidelines', 'algorithm-2026.json');
const CLAUDE = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const argVal = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const DRY = args.includes('--dry');
const ONLY_PROJECT = argVal('--project', null);
const LIMIT = Number(argVal('--limit', '0')) || Infinity;

const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const algo = JSON.parse(readFileSync(ALGO_PATH, 'utf8'));
// Lekki „qa-pre-check": odetnij słabe seedy na starcie (t=5 min), zanim ktoś je ręcznie zdrafuje (t=60 min).
// Liczony na ESTYMACIE modelu z seeda; progi dziedziczone z bramki (algorithm-2026.json).
const PRE = {
  exp: algo.scoring?.thresholds?.experience_min ?? 3,
  spec: algo.scoring?.thresholds?.specificity_min ?? 3,
  comm: algo.scoring?.thresholds?.commentability_min ?? 2,
};
const DAYS = Number(argVal('--days', cfg.defaults?.days ?? 14));
const MAX_COMMITS = cfg.defaults?.max_commits_per_repo ?? 50;
const MAX_PER_REPO = Number(argVal('--max-per-repo', cfg.defaults?.max_ideas_per_repo ?? 3));
const MIN_SUBJ = cfg.defaults?.min_subject_len ?? 12;

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

// ── Git: realne commity jako surowiec ─────────────────────────────────────────
function gitDigest(repoPath) {
  const r = spawnSync('git', [
    '-C', repoPath, 'log', `--since=${DAYS} days ago`, '--no-merges', '--date=short',
    `--max-count=${MAX_COMMITS}`, '--pretty=format:%cd | %s%n%b%n===',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return { digest: null, count: 0, reason: (r.stderr || 'git error').slice(0, 80) };

  const blocks = (r.stdout || '').split('\n===').map(s => s.trim()).filter(Boolean);
  // odsiej trywialne (za krótki subject / czyste bump/merge/wip/lint)
  const kept = blocks.filter(b => {
    const first = b.split('\n')[0].replace(/^\d{4}-\d{2}-\d{2}\s*\|\s*/, '');
    if (first.length < MIN_SUBJ) return false;
    return !/^(bump|chore|merge|wip|typo|lint|format|ci|deps?|version)\b/i.test(first);
  });
  let digest = kept.join('\n---\n');
  if (digest.length > 7000) digest = digest.slice(0, 7000) + '\n…(ucięte)';
  return { digest: kept.length ? digest : null, count: kept.length, reason: kept.length ? '' : 'brak istotnych commitów' };
}

// ── Prompt ekstrakcji pomysłów ────────────────────────────────────────────────
function buildPrompt(project, digest) {
  const fit = algo.audience_fit || {};
  const redFlags = algo.ai_red_flags?.patterns || [];
  const nicheTopics = fit.niche?.topics || [];
  const offNiche = fit.niche?.off_niche_examples || [];
  const baitPatterns = fit.bait?.patterns || [];
  return `Jesteś researcherem treści build-in-public dla profilu LinkedIn Bartosza Gacy.
Nisze (tylko te): AI-automation (MCP/Claude Code/boty/automatyzacje) oraz polskie e-gov/open-data (KSeF/ZUS/ARiMR/IRZ/dane publiczne).

Dostajesz PRAWDZIWE commity z projektu "${project.name}" (nisza: ${project.niche}).
Wyciągnij od 0 do ${MAX_PER_REPO} POMYSŁÓW NA POST opartych na PRZEŻYTYCH momentach z tych commitów.

═══ ZASADA NACZELNA (algorytm LinkedIn 2026) ═══
${algo.manifesto.one_liner}
${algo.manifesto.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')}

ŻELAZNE ZASADY:
- TYLKO na podstawie commitów. ZERO ZMYŚLANIA. Jeśli commity są trywialne / nie ma z czego zrobić historii → zwróć pustą listę.
- Każdy pomysł = prawdziwy moment: co się WYSYPAŁO / co NAPRAWIŁEŚ / jaką PODJĄŁEŚ decyzję / co ZASKOCZYŁO. Pierwszoosobowo.
- Liczby TYLKO realne (z treści commitów). Nie wymyślaj metryk.
- NIGDY nazw klientów, nazwisk, danych identyfikujących osoby/firmy. Pisz o SWOIM narzędziu/automatyzacji.
- JĘZYK: WYŁĄCZNIE polski. Profil jest polskojęzyczny — pomysł po angielsku ma martwy zasięg i bramka i tak go odrzuci. Pisz po polsku.
- Hook: problem albo porażka pierwsza (nie sukces), ≤ 200 znaków.

UNIKAJ wzorców „piszę jak AI/ekspert" — pomysł NIE może do nich prowadzić (zbijają zasięg):
${redFlags.map((r) => `- ${r}`).join('\n')}

NISZA (twarda): w niszy = ${nicheTopics.join(' | ')}.
POZA niszą (NIE proponuj) = ${offNiche.join(' | ')}.
ZAKAZ baitu/lead-magnetu (NIE proponuj takich CTA): ${baitPatterns.join(' | ')}.

KOMENTARZOGENNOŚĆ: każdy pomysł MUSI mieć closing_question — JEDNO zamknięte pytanie-spór, z którym da się (nie)zgodzić (nie puste „a co myślisz?"). To główny driver komentarzy.

Dla każdego pomysłu zwróć:
- title: krótki tytuł roboczy (≤ 60 zn)
- hook: pierwsza linia posta (problem/porażka, ≤ 200 zn)
- scene: 2-4 zdania surowca — co się realnie wydarzyło wg commitów (to jest materiał do napisania posta)
- numbers: tablica realnych liczb/faktów z commitów (np. "timeout 360→600s", "3 grupy naraz"); [] jeśli brak
- closing_question: jedno zamknięte pytanie-spór na koniec posta
- niche: "ai-automation" lub "e-gov"
- format: "text" | "image" | "carousel"
- lead_trigger: jaki problem odbiorcy ten post adresuje (1 zdanie)
- est_experience, est_specificity, est_commentability: UCZCIWA estymacja 0-5, jak mocno ten surowiec wypadnie w bramce (experience=przeżyta scena, specificity=realne liczby, commentability=czy pytanie-spór realnie prowokuje kontrę). Bądź surowy — to filtr, nie autoreklama.

Wypisz WYŁĄCZNIE surowy JSON (bez markdown): {"ideas":[{"title":"","hook":"","scene":"","numbers":[],"closing_question":"","niche":"","format":"","lead_trigger":"","est_experience":0,"est_specificity":0,"est_commentability":0}]}

COMMITY:
<<<GIT
${digest}
GIT>>>`;
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
  return Array.isArray(obj.ideas) ? obj.ideas : [];
}

// ── Helpers DB ────────────────────────────────────────────────────────────────
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[ąàá]/g, 'a').replace(/[ęèé]/g, 'e').replace(/ó/g, 'o').replace(/[łĺ]/g, 'l')
    .replace(/ż|ź/g, 'z').replace(/ś/g, 's').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// Tymczasowy slot publikacji (kolumna NOT NULL). Pomysły to propozycje — i tak przeplanujesz.
function tentativeSlot(i) {
  const d = new Date(Date.now() + (7 + i * 2) * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 08:00:00`;
}

function main() {
  const db = new Database(DB_PATH);
  let projects = cfg.projects || [];
  if (ONLY_PROJECT) projects = projects.filter(p => p.name === ONLY_PROJECT);
  if (!projects.length) { log(`Brak projektów (filtr --project ${ONLY_PROJECT}?).`); db.close(); return; }

  let nextTopic = (db.prepare('SELECT COALESCE(MAX(topic_number),0) m FROM media_plan_items').get().m) + 1;
  const existing = new Set(db.prepare("SELECT title FROM media_plan_items").all().map(r => norm(r.title)));

  log(`Idea Engine — ${projects.length} repo, okno ${DAYS} dni${DRY ? ' (DRY)' : ''} | pre-check exp≥${PRE.exp} spec≥${PRE.spec} comm≥${PRE.comm}`);
  let total = 0, skippedDup = 0, droppedWeak = 0;

  for (const p of projects) {
    if (total >= LIMIT) break;
    const { digest, count, reason } = gitDigest(p.path);
    if (!digest) { log(`  · ${p.name}: pomijam (${reason})`); continue; }
    log(`  ⛏  ${p.name}: ${count} istotnych commitów → ekstrakcja…`);

    let ideas;
    try { ideas = runClaude(buildPrompt(p, digest)); }
    catch (e) { log(`    ERROR ${p.name}: ${e.message}`); continue; }

    let perRepo = 0;
    for (const idea of ideas) {
      if (total >= LIMIT || perRepo >= MAX_PER_REPO) break;
      if (!idea.hook || !idea.title) continue;
      const nt = norm(idea.title);
      if (existing.has(nt)) { skippedDup++; continue; }   // dedup vs istniejące + ten przebieg
      existing.add(nt);

      // qa-pre-check: odrzuć słaby seed na podstawie uczciwej estymacji modelu — zanim ktoś go zdrafuje.
      const eExp = Number(idea.est_experience ?? 0);
      const eSpec = Number(idea.est_specificity ?? 0);
      const eComm = Number(idea.est_commentability ?? 0);
      if (eExp < PRE.exp || eSpec < PRE.spec || eComm < PRE.comm) {
        droppedWeak++;
        log(`    ✗ słaby seed (est exp ${eExp}/spec ${eSpec}/comm ${eComm} < ${PRE.exp}/${PRE.spec}/${PRE.comm}): ${idea.title}`);
        continue;
      }

      const seed = [
        idea.scene,
        (idea.numbers?.length ? 'Liczby: ' + idea.numbers.join('; ') : ''),
        (idea.closing_question ? 'Pytanie-spór: ' + idea.closing_question : ''),
      ].filter(Boolean).join('\n\n');
      const row = {
        id: randomUUID(),
        topic_number: nextTopic++,
        slug: `${nextTopic - 1}-${slugify(idea.title)}`,
        title: idea.title.slice(0, 120),
        hook: idea.hook.slice(0, 300),
        language: 'pl', // profil polskojęzyczny — wymuszone (EN = HOLD w bramce, martwy cykl)
        status: 'plan',
        publish_at: tentativeSlot(total),
        post_text: seed,
        cta: (idea.closing_question || '').slice(0, 300),
        lead_trigger: (idea.lead_trigger || '').slice(0, 300),
        format: idea.format || 'text',
        icp: idea.niche || p.niche,
        source_project: p.name,
        live_signal: `git:${p.name} ${count} commitów / ${DAYS}d`,
      };

      log(`    💡 [${row.icp}/${row.format}] ${row.title}`);
      log(`        hook: ${row.hook.slice(0, 90)}`);

      if (!DRY) {
        db.prepare(`INSERT INTO media_plan_items
          (id, topic_number, slug, title, hook, language, status, publish_at, post_text, cta, lead_trigger, format, icp, source_project, live_signal, created_at, updated_at)
          VALUES (@id,@topic_number,@slug,@title,@hook,@language,@status,@publish_at,@post_text,@cta,@lead_trigger,@format,@icp,@source_project,@live_signal,datetime('now'),datetime('now'))`)
          .run(row);
      }
      perRepo++; total++;
    }
  }

  db.close();
  log(`Koniec — ${total} pomysłów${DRY ? ' (DRY, nie zapisano)' : ' zapisanych jako plan'}${skippedDup ? `, pominięto ${skippedDup} duplikatów` : ''}${droppedWeak ? `, odrzucono ${droppedWeak} słabych (pre-check)` : ''}.`);
}

main();
