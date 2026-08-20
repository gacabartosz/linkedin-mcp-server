#!/usr/bin/env node
/**
 * Swipe Ingest — bank WZORCÓW (nie treści) od najlepszych twórców AI/build-in-public.
 *
 * Po co: Idea/Draft Engine pisze z własnych commitów (świetne do autentyczności),
 * ale brakuje mu "kątów zaczepienia" — archetypów hooków i szkieletów postów, które
 * realnie łapią zasięg. Ten skrypt podpatruje STRUKTURĘ u referencyjnych twórców
 * (Greg Isenberg — pipeline scrape→LLM→post, "ship wiele hooków"; Allie K. Miller —
 * format dokument/checklista/framework) i zapisuje ANONIMOWE szkielety do
 * ~/.linkedin-mcp/swipe-file.json. Te szkielety wstrzykuje potem draft/idea-engine.
 *
 * ŻELAZNE ZASADY:
 *   - Zapisujemy WYŁĄCZNIE strukturę: archetyp hooka, typ otwartej pętli, szkielet
 *     posta, styl CTA, pasmo długości, format. ZERO cytatów cudzej treści/liczb/
 *     przykładów (anti-rule: zero kopiowania; treść postów zawsze z własnych faktów).
 *   - To skrypt JEDNORAZOWY, ODPALANY RĘCZNIE. NIGDY launchd/cron (lekcja z
 *     restrykcji konta 2026-06-24: wolumen Playwright = ban). Po jednym przebiegu
 *     proces się KOŃCZY. Brak pętli.
 *
 * Tryby:
 *   node swipe-ingest.mjs                 # PUBLIC-WEB (domyślny, zero ryzyka konta):
 *                                         #   claude CLI + WebSearch/WebFetch na PUBLICZNYCH postach/artykułach
 *   node swipe-ingest.mjs --dry          # pokaż wyekstrahowane wzorce, nie zapisuj
 *   node swipe-ingest.mjs --source greg-isenberg
 *   node swipe-ingest.mjs --playwright --i-understand-account-risk
 *                                         # OPCJONALNY 1-shot zalogowaną sesją (tylko czego brak publicznie):
 *                                         #   mocno rate-limited, cap postów, długie losowe opóźnienia, exit po 1 przebiegu.
 *
 * Mechanika AI = `claude` CLI headless (Opus 4.8) — wzorzec z qa-gate/idea-engine.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SWIPE_PATH = join(homedir(), '.linkedin-mcp', 'swipe-file.json');
const PROFILE_DIR = join(homedir(), '.linkedin-mcp', 'browser-profile');
const CLAUDE = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const argVal = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DRY = args.includes('--dry');
const USE_PLAYWRIGHT = args.includes('--playwright');
const RISK_ACK = args.includes('--i-understand-account-risk');
const ONLY_SOURCE = argVal('--source', null);
const PER_SOURCE = Math.max(1, Number(argVal('--per-source', '4')) || 4);

// Twórcy referencyjni (wybór użytkownika 2026-06-29: US/AI-builder, NIE personal-brand).
const SOURCES = [
  {
    key: 'greg-isenberg', name: 'Greg Isenberg',
    li: 'https://www.linkedin.com/in/gisenberg/',
    why: 'Build-in-public; pipeline scrape→LLM→post; zasada "ship 10+ hooków, algo wybiera zwycięzcę". Wzorzec operacyjny.',
  },
  {
    key: 'allie-k-miller', name: 'Allie K. Miller',
    li: 'https://www.linkedin.com/in/alliekmiller/',
    why: 'AI Business Voice; format dokument/checklista/framework ("jak wdrożyć AI / jak wybrać vendora"); ROI. Wzorzec formatu (PDF=#1).',
  },
];

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

function runClaude(prompt, { web = false } = {}) {
  const a = ['-p', prompt, '--output-format', 'json'];
  if (web) a.push('--allowedTools', 'WebSearch', 'WebFetch', '--permission-mode', 'acceptEdits');
  const r = spawnSync(CLAUDE, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  if (r.status !== 0 && !r.stdout) throw new Error(`claude exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  let txt = r.stdout;
  try { const env = JSON.parse(r.stdout); if (env && typeof env.result === 'string') txt = env.result; } catch {}
  let s = txt.replace(/```json|```/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('Brak JSON w odpowiedzi claude');
  const obj = JSON.parse(s.slice(i, j + 1));
  return Array.isArray(obj.patterns) ? obj.patterns : [];
}

// Wspólny schemat + twardy guardrail anonimizacji (ten sam dla public-web i playwright).
const SCHEMA_RULES = `Zwróć WYŁĄCZNIE surowy JSON: {"patterns":[{
  "format":"text|carousel|image|video",
  "hook_archetype":"<nazwa kąta zaczepienia, np. 'kontrariańska teza', 'porażka-przed-sukcesem', 'liczba-szok', 'scena o 2 w nocy', 'before/after'>",
  "opening_loop":"<JAK pierwsza linia otwiera pętlę/napięcie — opis mechanizmu, NIE cytat>",
  "structure_skeleton":"<szkielet posta krok-po-kroku w formie abstrakcyjnej, np. 'hook→koszt błędu→zwrot→1 konkret→zamknięte pytanie'>",
  "cta_style":"<jak domyka: zamknięte pytanie / zaproszenie do własnej historii / brak>",
  "length_band":"krótki|średni|długi",
  "notes":"<co czyni ten wzorzec zasięgowym — 1 zdanie abstrakcyjne>"
}]}

KRYTYCZNE (anti-rule, bezwzględne):
- To bank STRUKTUR, nie treści. NIE kopiuj ani nie parafrazuj ich zdań, liczb, nazw, przykładów ani fraz.
- Każde pole = ABSTRAKCYJNY opis mechanizmu ("porażka przed sukcesem"), NIGDY ich konkretne słowa.
- Jeśli nie da się opisać wzorca bez cytowania — pomiń ten post.`;

function buildWebPrompt(src) {
  return `Jesteś analitykiem struktury treści LinkedIn. Cel: wyekstrahować POWTARZALNE WZORCE
(archetypy hooków i szkielety postów) z PUBLICZNIE dostępnych, dobrze radzących sobie postów
i artykułów twórcy: ${src.name} (${src.li}).
Czemu ten twórca: ${src.why}

Użyj WebSearch/WebFetch, żeby znaleźć kilka jego PUBLICZNYCH, mocnych postów/artykułów (publiczne URL-e,
bez logowania). Wyekstrahuj ${PER_SOURCE} różnych wzorców strukturalnych — różne kąty zaczepienia.

${SCHEMA_RULES}`;
}

function buildExtractPrompt(src, rawTexts) {
  return `Jesteś analitykiem struktury treści LinkedIn. Poniżej kilka postów twórcy ${src.name}
(zebrane ręcznie, jednorazowo). Wyekstrahuj ${PER_SOURCE} POWTARZALNYCH WZORCÓW strukturalnych.
Czemu ten twórca: ${src.why}

${SCHEMA_RULES}

POSTY (surowiec do analizy STRUKTURY — nie do cytowania):
<<<POSTS
${rawTexts.slice(0, 12000)}
POSTS>>>`;
}

function loadSwipe() {
  if (!existsSync(SWIPE_PATH)) return { updated: null, note: 'Bank WZORCÓW (struktura, nie treść) — generowany przez swipe-ingest.mjs.', sources: [], patterns: [] };
  try { return JSON.parse(readFileSync(SWIPE_PATH, 'utf8')); } catch { return { updated: null, sources: [], patterns: [] }; }
}
function saveSwipe(data) {
  writeFileSync(SWIPE_PATH, JSON.stringify(data, null, 2));
}
const patKey = (p) => `${p.source}|${String(p.hook_archetype || '').toLowerCase().trim()}`;

function mergePatterns(swipe, src, patterns, stamp) {
  const seen = new Set(swipe.patterns.map(patKey));
  let added = 0;
  for (const p of patterns) {
    const rec = {
      source: src.key,
      format: p.format || 'text',
      hook_archetype: p.hook_archetype || '',
      opening_loop: p.opening_loop || '',
      structure_skeleton: p.structure_skeleton || '',
      cta_style: p.cta_style || '',
      length_band: p.length_band || '',
      notes: p.notes || '',
      ingested_at: stamp,
    };
    if (!rec.hook_archetype) continue;
    if (seen.has(patKey(rec))) continue;
    seen.add(patKey(rec));
    swipe.patterns.push(rec);
    added++;
    log(`    + [${rec.source}/${rec.format}] ${rec.hook_archetype}`);
  }
  return added;
}

// ── Opcjonalny 1-shot Playwright (tylko czego brak publicznie) ────────────────
// Reużywa współdzielonego browser-profile + self-heal locka (wzorzec z auto-comment-playwright).
// JEDEN przebieg, cap postów, długie losowe opóźnienia, exit. NIGDY jako daemon.
async function ensureProfileFree(profileDir) {
  const lock = join(profileDir, 'SingletonLock');
  for (let attempt = 0; attempt < 6; attempt++) {
    if (!existsSync(lock)) return;
    let pid = 0;
    try { pid = parseInt(String(readlinkSync(lock)).split('-').pop(), 10) || 0; } catch { return; }
    let alive = false;
    if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = (e.code === 'EPERM'); } }
    if (!alive) {
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { unlinkSync(join(profileDir, f)); } catch {} }
      log(`  Usunięto osierocony lock profilu (martwy PID ${pid}).`);
      return;
    }
    log(`  Profil zajęty (żywy PID ${pid}) — czekam… (${attempt + 1}/6)`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Profil przeglądarki zajęty (żywy lock) — przerywam (NIE forsuję).');
}
const rand = (min, max) => min + Math.floor((max - min) * (0.3 + 0.4 * ((Date.now() % 1000) / 1000)));

async function scrapePlaywright(src, cap) {
  const { chromium } = await import('playwright');
  await ensureProfileFree(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // LinkedIn blokuje headless
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const texts = [];
  try {
    const page = context.pages()[0] || await context.newPage();
    const url = src.li.replace(/\/$/, '') + '/recent-activity/all/';
    log(`  → ${url} (1-shot, cap ${cap})`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(rand(4000, 9000));
    // Delikatny scroll, żeby doczytać kilka postów; długie losowe pauzy (human-like, low-volume).
    for (let i = 0; i < Math.min(cap, 6); i++) {
      await page.mouse.wheel(0, rand(700, 1400));
      await page.waitForTimeout(rand(3500, 8000));
    }
    const blocks = await page.$$eval('div.feed-shared-update-v2, div.update-components-text',
      (els) => els.map((e) => (e.innerText || '').trim()).filter((t) => t.length > 120));
    for (const b of blocks.slice(0, cap)) texts.push(b);
    log(`  Zebrano ${texts.length} bloków tekstu (do analizy STRUKTURY, nie do zapisu surowego).`);
  } finally {
    await context.close();
  }
  return texts.join('\n\n---\n\n');
}

async function main() {
  if (USE_PLAYWRIGHT && !RISK_ACK) {
    log('⛔ --playwright wymaga jawnego potwierdzenia: dołóż flagę --i-understand-account-risk');
    log('   (konto LinkedIn dostało restrykcję 2026-06-24 przez wolumen Playwright — to 1-shot, ręczny, na własną odpowiedzialność).');
    process.exit(2);
  }
  const sources = ONLY_SOURCE ? SOURCES.filter((s) => s.key === ONLY_SOURCE) : SOURCES;
  if (!sources.length) { log(`Brak źródła (filtr --source ${ONLY_SOURCE}?). Dostępne: ${SOURCES.map((s) => s.key).join(', ')}`); return; }

  const swipe = loadSwipe();
  const stamp = new Date().toISOString();
  const mode = USE_PLAYWRIGHT ? 'PLAYWRIGHT 1-shot (zalogowany)' : 'PUBLIC-WEB (bez logowania)';
  log(`Swipe Ingest — ${sources.length} źródło(a), tryb: ${mode}${DRY ? ' (DRY)' : ''}`);

  let totalAdded = 0;
  for (const src of sources) {
    log(`▸ ${src.name} [${src.key}]`);
    try {
      let patterns;
      if (USE_PLAYWRIGHT) {
        const raw = await scrapePlaywright(src, PER_SOURCE * 2);
        if (!raw.trim()) { log('  (brak tekstu — pomijam)'); continue; }
        patterns = runClaude(buildExtractPrompt(src, raw));
      } else {
        patterns = runClaude(buildWebPrompt(src), { web: true });
      }
      const added = mergePatterns(swipe, src, patterns, stamp);
      totalAdded += added;
      if (!swipe.sources.find((s) => s.key === src.key)) swipe.sources.push({ key: src.key, name: src.name, li: src.li });
      log(`  ${added} nowych wzorców (z ${patterns.length} wyekstrahowanych).`);
    } catch (e) {
      log(`  ERROR ${src.key}: ${e.message}`);
    }
  }

  swipe.updated = stamp;
  if (DRY) { log(`(--dry) nie zapisuję. Łącznie nowych: ${totalAdded}. Bank miałby ${swipe.patterns.length} wzorców.`); return; }
  saveSwipe(swipe);
  log(`Koniec — +${totalAdded} wzorców, bank=${swipe.patterns.length}, plik: ${SWIPE_PATH}`);
}

main().then(() => process.exit(0)).catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
