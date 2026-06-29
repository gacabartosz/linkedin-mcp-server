#!/usr/bin/env node
/**
 * QA Gate — bramka jakości treści PRZED publikacją.
 *
 * Dla każdego zaplanowanego posta (qa_status != 'approved'):
 *   1. KOMPLETNOŚĆ — twarda bramka: placeholdery, ucięcia, niepełne dane → HOLD
 *   2. PRZEPISANIE — w stronę pierwszoosobowej, PRZEŻYTEJ relacji (brand-voice + algorithm-2026)
 *   3. FACT-CHECK  — Opus 4.8 + WebSearch weryfikuje twierdzenia o świecie
 *   4. SCORING     — experience / emotion / specificity (reguły nowego algorytmu)
 *   5. FORMAT      — reguły per media_kind (text / image / video / carousel)
 *   WERDYKT        — approved (tekst podmieniony, oryginał w text_original, score w qa_scores)
 *                    albo hold (niekompletny / halucynacja / za mało przeżycia → NIE publikuje)
 *
 * Mechanika AI = `claude` CLI headless (Opus 4.8 + WebSearch) — bez ANTHROPIC_API_KEY.
 * Wzorzec z content-quality-agent.
 *
 * Reguły jakości: guidelines/algorithm-2026.json (+ ~/.linkedin-mcp/brand-voice.json).
 *
 * Użycie:
 *   node qa-gate.mjs              # wszystkie pending
 *   node qa-gate.mjs --id <id>    # jeden post
 *   node qa-gate.mjs --dry        # nie zapisuj do DB (podgląd)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { humanizeText } from './lib/humanize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const BRAND_VOICE_PATH = join(homedir(), '.linkedin-mcp', 'brand-voice.json');
const ALGO_PATH = join(__dirname, 'guidelines', 'algorithm-2026.json');
const CLAUDE = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const ONLY_ID = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
const DRY = args.includes('--dry');

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }
function notify(title, body) {
  try {
    // JSON.stringify daje poprawny literał AppleScript (podwójne cudzysłowy + \" \\ \n),
    // a execFileSync omija shell, więc apostrofy/nawiasy w treści nie psują komendy.
    const script = `display notification ${JSON.stringify(String(body))} with title ${JSON.stringify(String(title))}`;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch {}
}

const brand = JSON.parse(readFileSync(BRAND_VOICE_PATH, 'utf8'));
const algo = JSON.parse(readFileSync(ALGO_PATH, 'utf8'));

// Rozpoznaj format posta z kolumn DB (media_kind / banner_preset / media_preview_path).
function detectFormat(post) {
  const mk = String(post.media_kind || '').toLowerCase();
  const mp = String(post.media_preview_path || '');
  const isGenBanner = mk === 'banner' || !!post.banner_preset;
  let kind = 'text';
  if (mk === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(mp)) kind = 'video';
  else if (mk === 'carousel' || /\.pdf$/i.test(mp)) kind = 'carousel';
  else if (mk === 'image' || mk === 'banner') kind = 'image';
  return { kind, isGenBanner };
}

function buildPrompt(text, fmt) {
  const T = algo.scoring.thresholds;
  const fmtRules = (algo.formats[fmt.kind]?.requires) || [];
  const fit = algo.audience_fit || {};
  const targetLang = fit.language?.target || 'pl';
  const nicheTopics = fit.niche?.topics || [];
  const offNiche = fit.niche?.off_niche_examples || [];
  const baitPatterns = fit.bait?.patterns || [];
  const genBannerNote = fmt.isGenBanner
    ? `\nUWAGA FORMAT: ten post ma grafikę GENEROWANĄ (banner/Canva). ${algo.formats.image.warn_on_generated} Dodaj to do formatNotes (ostrzeżenie, nie blokuje).`
    : '';
  return `Jesteś redaktorem, fact-checkerem i krytykiem zasięgowym dla profilu LinkedIn Bartosza Gacy (build-in-public, język polski).
Dostajesz tekst posta + jego FORMAT. Wykonaj 5 zadań i zwróć JEDEN surowy JSON.

═══ ZASADA NACZELNA (nowy algorytm LinkedIn) ═══
${algo.manifesto.one_liner}
${algo.manifesto.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')}

PERSONA / TON (brand voice):
- ${brand.voice?.persona ?? 'Builder-practitioner, nie influencer.'}
- Ton: ${brand.voice?.tone ?? 'bezpośredni, konkretny; jak developer w Slacku — krótko, z danymi.'}
- ZAKAZANE zwroty (usuń): ${JSON.stringify(brand.avoid_words ?? [])}
- Hook musi zmieścić sens w pierwszych ${brand.hook_max_chars ?? 210} znakach.

FORMAT TEGO POSTA: ${fmt.kind}
Wymogi formatu (sprawdź czy tekst je spełnia):
${fmtRules.map((r) => `- ${r}`).join('\n')}${genBannerNote}

ZADANIE 1 — KOMPLETNOŚĆ (twarda bramka). complete=false jeśli wystąpi COKOLWIEK z poniższego, a każdy problem wypisz w completenessIssues:
${algo.completeness_gate.hard_fail.map((r) => `- ${r}`).join('\n')}

ZADANIE 2 — PRZEPISANIE w stronę PRZEŻYTEJ, pierwszoosobowej relacji:
${algo.rewrite_directives.map((r) => `- ${r}`).join('\n')}
Usuń też ślady AI: ${algo.ai_red_flags.patterns.join(' | ')}.
KRYTYCZNE: nie wolno zmyślać faktów, liczb, dat, scen ani anegdot, żeby podbić wynik. Jeśli treść jest pustym poradnikiem bez realnego przeżycia — NIE dorabiaj przeżycia; zostaw fakty i zgłoś to w holdReason.

ZADANIE 3 — FACT-CHECK (użyj WebSearch). Dla KAŻDEGO sprawdzalnego twierdzenia/liczby:
- type="private" — twierdzenia o WŁASNYCH projektach/systemach/automatyzacjach Bartosza i o tym JAK DZIAŁAJĄ (liczby i zachowania jego botów, commity, equity, integracje). NIE weryfikujesz w necie, NIE blokują. W razie wątpliwości → "private".
- type="ok" — NIEZALEŻNE fakty o świecie potwierdzone w necie + sourceUrl.
- type="hallucination" — TYLKO niezależny fakt o świecie BEZPOŚREDNIO sprzeczny z autorytatywnym źródłem.
- type="unverifiable" — niezależny publiczny fakt, którego nie da się potwierdzić ani obalić.

ZADANIE 4 — SCORING (oceniaj TEKST PO przepisaniu, skala 0-5):
- experience: ${algo.scoring.dimensions.experience}
- emotion: ${algo.scoring.dimensions.emotion}
- specificity: ${algo.scoring.dimensions.specificity}
- commentability: ${algo.scoring.dimensions.commentability}
- saveability: ${algo.scoring.dimensions.saveability} (To MIĘKKI sygnał — NIE wpływa na werdykt approved/hold; służy tylko rekomendacji formatu.)

ZADANIE 5 — FORMAT: formatOk=true jeśli tekst spełnia wymogi formatu wyżej; inaczej false + co poprawić w formatNotes.

ZADANIE 6 — POLITYKA LINKÓW (hybryda per-post):
${(algo.links?.policy ?? []).map((r) => `- ${r}`).join('\n')}
${algo.links?.judge ?? ''}
W tym zadaniu NIE przenoś żadnego linku do komentarza i NIE wycinaj linku, który JEST sednem posta. Zwróć linkJustified (true/false; true gdy w treści nie ma linku albo link jest sednem wartości).

ZADANIE 7 — DOPASOWANIE DO KONTA (twarde bramki; uzasadnione danymi analytics tego profilu — TYLKO wykryj i zwróć sygnały, decyzję podejmuje kod):
a) JĘZYK: wykryj język TREŚCI i zwróć go w polu language jako 2-literowy kod ISO ('pl', 'en', 'de'...). Profil jest POLSKOJĘZYCZNY, a posty nie-PL mają martwy zasięg. KRYTYCZNE: jeśli oryginał jest w innym języku niż polski — NIE tłumacz go w humanizedText; zostaw język oryginału i ustaw language na ten język, żeby bramka mogła wstrzymać post (autor sam zdecyduje, czy w ogóle publikować po polsku). NIE maskuj problemu auto-tłumaczeniem.
b) NISZA: czy temat mieści się w niszy konta? W niszy: ${nicheTopics.join(' | ')}. Poza niszą (ustaw onNiche=false): ${offNiche.join(' | ')}. Zwróć onNiche (true/false) oraz topic (1-3 słowa: o czym jest post). Jeśli off-niche temat jest realnie powiązany z własną robotą AI/automatyzacją autora — onNiche=true.
c) BAIT: ustaw bait=true i wypisz konkretne frazy w baitIssues, jeśli post zawiera engagement-bait / lead-magnet / odsyłanie po link do komentarza: ${baitPatterns.join(' | ')}.

═══ WERDYKT (oblicz uczciwie) ═══
- approved=false jeśli complete=false (niekompletny/wadliwy).
- approved=false jeśli jest realna type="hallucination".
- approved=false jeśli po przepisaniu NIE są spełnione progi: experience>=${T.experience_min} I specificity>=${T.specificity_min} I emotion>=${T.emotion_min} I commentability>=${T.commentability_min} I suma(exp+emo+spec)>=${T.sum_min}. Wtedy w holdReason napisz KONKRETNIE, co autor ma dopisać z własnej głowy (jaką scenę/liczbę/decyzję/zamknięte pytanie-spór), żeby post był przeżyty i komentarzogenny.
- approved=false jeśli język treści ≠ ${targetLang} (profil polskojęzyczny — post w innym języku zakopuje zasięg).
- approved=false jeśli post jest poza niszą konta (onNiche=false).
- approved=false jeśli bait=true (engagement-bait / lead-magnet / odsyłanie po link do komentarza — LinkedIn to zakopuje).
- W przeciwnym razie approved=true.
- type="private"/"ok" nie blokują. type="unverifiable" nie blokuje, ale dopisz ostrzeżenie w summary.

Na końcu wypisz WYŁĄCZNIE surowy JSON (bez markdown, bez \`\`\`), dokładnie wg schematu:
{"complete": true|false, "completenessIssues": ["..."], "humanizedText": "<przepisany tekst>", "factIssues": [{"claim":"...","type":"ok|hallucination|unverifiable|private","evidence":"...","sourceUrl":"..."}], "scores": {"experience": 0, "emotion": 0, "specificity": 0, "commentability": 0, "saveability": 0}, "formatOk": true|false, "formatNotes": ["..."], "linkJustified": true|false, "language": "pl", "onNiche": true|false, "topic": "<1-3 słowa>", "bait": true|false, "baitIssues": ["..."], "approved": true|false, "holdReason": "<konkretny feedback po polsku albo pusty string>", "summary": "<1 zdanie po polsku>"}

TEKST POSTA DO OBRÓBKI:
<<<POST
${text}
POST>>>`;
}

function runClaude(prompt) {
  const r = spawnSync(CLAUDE, [
    '-p', prompt,
    '--output-format', 'json',
    '--allowedTools', 'WebSearch', 'WebFetch',
    '--permission-mode', 'acceptEdits',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  if (r.status !== 0 && !r.stdout) {
    throw new Error(`claude exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  }
  // envelope: {type:'result', result:'<text>', ...}
  let resultText = r.stdout;
  try {
    const env = JSON.parse(r.stdout);
    if (env && typeof env.result === 'string') resultText = env.result;
  } catch { /* may already be raw */ }
  // wyłuskaj ostatni blok JSON {...}
  let s = resultText.replace(/```json|```/g, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last < 0) throw new Error('Brak JSON w odpowiedzi claude');
  return JSON.parse(s.slice(first, last + 1));
}

function processPost(db, post) {
  const fmt = detectFormat(post);
  log(`QA → ${post.id} (${post.text.length} zn., format=${fmt.kind}${fmt.isGenBanner ? '/gen-banner' : ''})`);
  const verdict = runClaude(buildPrompt(post.text, fmt));

  // Deterministyczny humanizer NA WYJŚCIU modelu — gwarancja, że myślniki i
  // artefakty AI znikną niezależnie od tego, czy LLM posłuchał promptu. URL-e i
  // liczby chronione. Robione PRZED scoringiem/grepem, żeby decyzje liczyły się
  // na tekście realnie idącym do publikacji. Wyłączalne flagą brand-voice.humanize.
  if (typeof verdict.humanizedText === 'string') {
    verdict.humanizedText = humanizeText(verdict.humanizedText, { enabled: brand.humanize !== false });
  }

  // --- Zbierz sygnały ---
  const issues = Array.isArray(verdict.factIssues) ? verdict.factIssues
    : (Array.isArray(verdict.issues) ? verdict.issues : []); // wsteczna zgodność
  const halluc = issues.filter(i => i.type === 'hallucination');
  const unver = issues.filter(i => i.type === 'unverifiable'); // ostrzeżenie, nie blokuje (zgodnie z designem)
  const sources = issues.filter(i => i.sourceUrl).map(i => ({ claim: i.claim, url: i.sourceUrl }));

  const complete = verdict.complete !== false; // brak pola = traktuj jak kompletny (wsteczna zgodność)
  const completenessIssues = Array.isArray(verdict.completenessIssues) ? verdict.completenessIssues : [];
  const s = verdict.scores || {};
  const T = algo.scoring.thresholds;
  const exp = Number(s.experience ?? 0), emo = Number(s.emotion ?? 0), spec = Number(s.specificity ?? 0);
  const comm = Number(s.commentability ?? 0);
  const save = Number(s.saveability ?? 0); // MIĘKKI sygnał — nie wchodzi do werdyktu
  const sum = exp + emo + spec; // commentability NIE wchodzi do sumy (osobna bramka, żeby nie ruszać kalibracji sum_min)
  const commMin = T.commentability_min ?? 0;
  const viralOk = exp >= T.experience_min && spec >= T.specificity_min && emo >= T.emotion_min && comm >= commMin && sum >= T.sum_min;

  const formatNotes = Array.isArray(verdict.formatNotes) ? verdict.formatNotes : [];
  if (fmt.isGenBanner && !formatNotes.some(n => /baner|banner|generow|canva/i.test(n))) {
    formatNotes.push('Grafika generowana (banner/Canva) — test #11: zbija zasięg. Rozważ autentyczny screen.');
  }
  // Polityka linków (hybryda per-post): link w treści tylko gdy jest sednem; komentarz nigdy.
  // Rekomendacja, NIE blokada. (Komentarze są czyszczone osobno w auto-publish.)
  const bodyHasLink = /https?:\/\/\S+/i.test(verdict.humanizedText || post.text || '');
  if (bodyHasLink && verdict.linkJustified === false && !formatNotes.some(n => /link/i.test(n))) {
    formatNotes.push('Link w treści nie jest sednem posta (~19% kary zasięgu) — rozważ usunięcie i podanie w DM/profilu. Komentarz i tak bez linka.');
  }
  // Saveability (research 2026: save ≈ 5× like = top sygnał dystrybucji) — MIĘKKA rekomendacja, NIE blokuje.
  // Gęsty, zapisywalny materiał wrzucony jako goły tekst = zmarnowany format → zaproponuj karuzelę/dokument.
  if (save >= 4 && fmt.kind === 'text' && !formatNotes.some(n => /karuzel|saveab|zapis/i.test(n))) {
    formatNotes.push(`Wysoka saveability (${save}/5) jako goły tekst — to materiał na KARUZELĘ/dokument (PDF = #1 format, napędza save'y). Rozważ format=carousel.`);
  } else if (fmt.kind === 'carousel' && save <= 2 && !formatNotes.some(n => /karuzel|saveab|zapis/i.test(n))) {
    formatNotes.push(`Karuzela o niskiej saveability (${save}/5) — pusta karuzela wypada gorzej niż tekst. Dodaj konkretny framework/checklistę albo zmień na tekst.`);
  }
  // format hard-fail tylko gdy reguła JSON tak mówi (domyślnie wszystko = ostrzeżenie, nie blokuje)
  const formatHardFail =
    (fmt.kind === 'image' && fmt.isGenBanner && algo.formats.image.hold_on_generated === true) ||
    (fmt.kind === 'video' && algo.formats.video.hold_on_missing === true && verdict.formatOk === false) ||
    (fmt.kind === 'carousel' && algo.formats.carousel.hold_on_missing === true && verdict.formatOk === false);

  // --- Twarde bramki DOPASOWANIA do konta (dane z analytics: EN/off-niche/bait = martwy zasięg) ---
  const fit = algo.audience_fit || {};
  const targetLang = String(fit.language?.target || 'pl').toLowerCase();
  const LANG_NORM = { polish: 'pl', polski: 'pl', english: 'en', angielski: 'en', deutsch: 'de', german: 'de', niemiecki: 'de' };
  const rawLang = String(verdict.language || '').toLowerCase().trim();
  const detLang = (LANG_NORM[rawLang] || rawLang).slice(0, 2);
  // brak detekcji = nie blokuj (wsteczna zgodność); inaczej musi == target
  const languageOk = fit.language?.hold_on_non_target !== true ? true : (!detLang || detLang === targetLang);

  const onNiche = verdict.onNiche !== false; // brak pola = traktuj jak on-niche (wsteczna zgodność)
  const nicheOk = fit.niche?.hold_off_niche !== true ? true : onNiche;

  const baitIssues = Array.isArray(verdict.baitIssues) ? verdict.baitIssues : [];
  const isBait = verdict.bait === true || baitIssues.length > 0;
  const baitOk = fit.bait?.hold_on_bait !== true ? true : !isBait;

  // --- Autorytatywny werdykt liczony w kodzie (nie ufamy ślepo modelowi) ---
  const approved = complete && completenessIssues.length === 0 && halluc.length === 0
    && viralOk && !formatHardFail && languageOk && nicheOk && baitOk;
  const humanized = (verdict.humanizedText || '').trim();

  // Powód HOLD (konkretny, żeby user wiedział co poprawić zamiast usuwać)
  let holdReason = '';
  if (!complete || completenessIssues.length) holdReason = `Niekompletny/wadliwy: ${completenessIssues.join('; ') || 'patrz summary'}`;
  else if (!languageOk) holdReason = `Język treści ≠ ${targetLang.toUpperCase()} (wykryto: ${detLang || '?'}). Profil jest polskojęzyczny — post w innym języku zakopuje zasięg (dane z konta: posty EN = 0-4 kom. mimo 3k+ wyświetleń). Przepisz po polsku albo opublikuj ręcznie świadomie.`;
  else if (!nicheOk) holdReason = `Poza niszą konta${verdict.topic ? ` (temat: ${verdict.topic})` : ''}. ${fit.niche?.reason || 'Off-niche = rozjazd z tym, po co ludzie obserwują konto.'} Powiąż z własną robotą AI/automatyzacją albo nie publikuj.`;
  else if (!baitOk) holdReason = `Engagement-bait / lead-magnet: ${baitIssues.join('; ') || 'patrz summary'}. LinkedIn to zakopuje. Usuń wezwanie do komentarza/DM po magnet i nie odsyłaj po link do komentarza.`;
  else if (halluc.length) holdReason = `Fakt sprzeczny ze źródłem: ${halluc.map(h => h.claim).join('; ')}`;
  else if (!viralOk) holdReason = (verdict.holdReason && verdict.holdReason.trim())
    || `Za słaby pod algorytm (exp ${exp}/5, emo ${emo}/5, spec ${spec}/5, komentarzogenność ${comm}/5). Dopisz własną przeżytą scenę, konkretne liczby i jedno zamknięte pytanie-spór.`;
  else if (formatHardFail) holdReason = `Format ${fmt.kind}: ${formatNotes.join('; ')}`;

  const scoresBlob = {
    scores: { experience: exp, emotion: emo, specificity: spec, commentability: comm, saveability: save, sum },
    viralOk, complete, completenessIssues,
    language: detLang || null, languageOk,
    onNiche, nicheOk, topic: verdict.topic || null,
    bait: isBait, baitIssues, baitOk,
    format: fmt.kind, isGenBanner: fmt.isGenBanner, formatOk: verdict.formatOk !== false, formatNotes,
    linkJustified: verdict.linkJustified !== false,
    unverifiable: unver.map(u => u.claim),
    holdReason, at: new Date().toISOString(),
  };

  log(`   verdict: ${approved ? 'APPROVED ✅' : 'HOLD ⛔'} | exp ${exp} emo ${emo} spec ${spec} comm ${comm} save ${save} (Σ${sum}) | lang=${detLang || '?'} niche=${onNiche ? 'ok' : 'OFF'} bait=${isBait ? 'YES' : 'no'} | complete=${complete} halluc=${halluc.length} | ${verdict.summary || ''}`);
  if (completenessIssues.length) for (const c of completenessIssues) log(`   ⚠ kompletność: ${String(c).slice(0, 90)}`);
  if (!languageOk) log(`   ✗ [język] treść ≠ ${targetLang.toUpperCase()} (wykryto ${detLang || '?'})`);
  if (!nicheOk) log(`   ✗ [nisza] off-niche: ${verdict.topic || '?'}`);
  if (isBait) for (const b of baitIssues) log(`   ✗ [bait] ${String(b).slice(0, 90)}`);
  if (halluc.length) for (const h of halluc) log(`   ✗ [halucynacja] ${String(h.claim).slice(0, 90)}`);
  if (!approved && holdReason) log(`   → HOLD: ${holdReason.slice(0, 140)}`);

  if (DRY) { log('   (--dry: nie zapisuję)'); return { approved }; }

  if (approved && humanized) {
    db.prepare(`UPDATE scheduled_posts
      SET text_original = COALESCE(text_original, text), text = ?,
          qa_status='approved', qa_issues=?, qa_sources=?, qa_scores=?, qa_at=datetime('now'),
          error=NULL, updated_at=datetime('now')
      WHERE id = ?`).run(humanized, JSON.stringify(issues), JSON.stringify(sources), JSON.stringify(scoresBlob), post.id);
  } else {
    db.prepare(`UPDATE scheduled_posts
      SET qa_status='hold', qa_issues=?, qa_sources=?, qa_scores=?, qa_at=datetime('now'),
          error=?, updated_at=datetime('now')
      WHERE id = ?`).run(JSON.stringify(issues), JSON.stringify(sources), JSON.stringify(scoresBlob),
        `QA HOLD: ${(holdReason || verdict.summary || 'problem jakości/faktów').slice(0, 240)}`, post.id);
    notify('LinkedIn ⛔ Post wstrzymany (QA)', `${post.id.slice(0, 8)}: ${(holdReason || verdict.summary || '').slice(0, 110)}`);
  }
  return { approved };
}

function main() {
  const db = new Database(DB_PATH);
  // Idempotentna migracja — kolumna na wyniki scoringu (wzorzec z store.ts)
  try { db.exec("ALTER TABLE scheduled_posts ADD COLUMN qa_scores TEXT"); } catch { /* istnieje */ }

  const COLS = "id, text, media_kind, banner_preset, media_preview_path, language";
  let rows;
  if (ONLY_ID) {
    rows = db.prepare(`SELECT ${COLS} FROM scheduled_posts WHERE id = ?`).all(ONLY_ID);
  } else {
    rows = db.prepare(`SELECT ${COLS} FROM scheduled_posts WHERE status='scheduled' AND (qa_status IS NULL OR qa_status != 'approved')`).all();
  }
  log(`QA Gate start — ${rows.length} post(ów) do przetworzenia${DRY ? ' (DRY)' : ''}`);
  let ok = 0, hold = 0, err = 0;
  for (const post of rows) {
    try {
      const r = processPost(db, post);
      r.approved ? ok++ : hold++;
    } catch (e) {
      err++;
      log(`   ERROR ${post.id}: ${e.message}`);
      if (!DRY) db.prepare("UPDATE scheduled_posts SET qa_status='error', error=?, qa_at=datetime('now') WHERE id=?")
        .run(`QA error: ${e.message.slice(0, 200)}`, post.id);
    }
  }
  db.close();
  log(`QA Gate koniec — approved: ${ok}, hold: ${hold}, error: ${err}`);
}

main();
