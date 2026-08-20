#!/usr/bin/env node
// Iter8: regeneracja media_plan_items.post_text przez Claude Opus 4.6
// Źródło faktów: git log per source_project + README.md (anti-halucynacje)
// Strategy: LINKEDIN-STRATEGY.md + guidelines/linkedin-strategy.json + ~/.linkedin-mcp/brand-voice.json
//
// Usage:
//   node scripts/regenerate-posts.mjs                    # wszystkie napisane+plan od jutra
//   node scripts/regenerate-posts.mjs --slug=23-raport-kpo-2026  # konkretny
//   node scripts/regenerate-posts.mjs --dry-run          # bez zapisu do DB

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const PROJECTS_DIR = join(homedir(), 'projects', 'personal');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const autoSchedule = args.includes('--auto-schedule');
const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1];
const startDateArg = args.find((a) => a.startsWith('--start='))?.split('=')[1] || null;

// Wczytaj ~/.linkedin-mcp/.env (NVIDIA_API_KEY, ANTHROPIC_API_KEY jeśli ustawione)
(function loadEnv() {
  try {
    const env = readFileSync(join(homedir(), '.linkedin-mcp', '.env'), 'utf-8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();

const USE_SDK = !!process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.REGEN_MODEL || (USE_SDK ? 'claude-sonnet-4-6' : 'claude-opus-4-6');
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/gaca/.local/bin/claude';

let anthropic = null;
if (USE_SDK) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log(`📦 Backend: Anthropic SDK + prompt cache, model ${MODEL}`);
} else {
  if (!existsSync(CLAUDE_BIN)) {
    console.error(`❌ Claude CLI nie istnieje: ${CLAUDE_BIN}. Albo ustaw ANTHROPIC_API_KEY w ~/.linkedin-mcp/.env.`);
    process.exit(1);
  }
  console.log(`📦 Backend: Claude CLI ${CLAUDE_BIN}, model ${MODEL}, timeout 300s (bez prompt cache - rozważ ANTHROPIC_API_KEY dla 5x speed)`);
}

async function callClaudeSDK(systemPrompt, userPrompt, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    }, { signal: ctrl.signal });
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { text, usage: resp.usage };
  } finally {
    clearTimeout(t);
  }
}

async function callClaudeCLI(systemPrompt, userPrompt, timeoutMs = 300000) {
  // CLI nie ma prompt cache. Łączymy system + user w jeden prompt (jak wcześniej).
  const fullPrompt = systemPrompt + '\n\n' + userPrompt;
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ['-p', '--no-session-persistence', '--model', MODEL], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdin.write(fullPrompt);
    child.stdin.end();
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code === 0) resolve({ text: out.trim(), usage: null });
      else reject(new Error(`claude exit ${code}: ${err.slice(0, 500)}`));
    });
    child.on('error', reject);
    setTimeout(() => { child.kill(); reject(new Error('claude timeout ' + timeoutMs + 'ms')); }, timeoutMs);
  });
}

async function callClaude(systemPrompt, userPrompt, timeoutMs = 300000) {
  return USE_SDK
    ? callClaudeSDK(systemPrompt, userPrompt, timeoutMs)
    : callClaudeCLI(systemPrompt, userPrompt, timeoutMs);
}

// Wczytaj strategię raz
const STRATEGY = (() => {
  try { return readFileSync(join(ROOT, 'LINKEDIN-STRATEGY.md'), 'utf-8').slice(0, 4000); }
  catch { return '(LINKEDIN-STRATEGY.md not found)'; }
})();
const GUIDELINES = (() => {
  try { return readFileSync(join(ROOT, 'guidelines', 'linkedin-strategy.json'), 'utf-8').slice(0, 3000); }
  catch { return '{}'; }
})();
const BRAND_VOICE = (() => {
  try { return JSON.parse(readFileSync(join(homedir(), '.linkedin-mcp', 'brand-voice.json'), 'utf-8')); }
  catch { return {}; }
})();

// Edytowalne wytyczne (humanizer + fact-checker) z ~/.linkedin-mcp/guidelines/
function loadGuideline(name) {
  const p = join(homedir(), '.linkedin-mcp', 'guidelines', `${name}.md`);
  try { return readFileSync(p, 'utf-8').trim(); } catch { return ''; }
}
const HUMANIZER = loadGuideline('humanizer');
const FACT_CHECKER = loadGuideline('fact-checker');

// Generator dat: rozkłada N slotów na poniedziałki/środy/piątki od startDate o 9:00
function generateMWFSlots(startDate, n) {
  const slots = [];
  const cursor = new Date(startDate);
  cursor.setHours(9, 0, 0, 0);
  while (slots.length < n) {
    const dow = cursor.getDay(); // 0=Nd, 1=Pn, 2=Wt, 3=Śr, 4=Cz, 5=Pt, 6=So
    if (dow === 1 || dow === 3 || dow === 5) {
      // YYYY-MM-DD HH:MM:SS w lokalnej strefie
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      slots.push(`${y}-${m}-${d} 09:00:00`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}


function resolveProjectDir(sourceProject) {
  if (!sourceProject) return null;
  if (sourceProject.startsWith('/')) return existsSync(sourceProject) ? sourceProject : null;
  const candidates = [
    join(PROJECTS_DIR, sourceProject),
    join(PROJECTS_DIR, sourceProject + '.pl'),
    join(PROJECTS_DIR, sourceProject.replace(/\.pl$/, '')),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function gatherAnalyticsFacts() {
  // Dla post-ów typu recap/stats - wyciągamy realne liczby z analytics.db
  // (Claude bez tego wymyślałby albo skracał post).
  try {
    const adb = new Database(join(homedir(), '.linkedin-mcp', 'analytics.db'), { readonly: true });
    const sdb = new Database(DB_PATH, { readonly: true });
    const totalPublished = sdb.prepare("SELECT COUNT(*) AS n FROM scheduled_posts WHERE status='published'").get().n;
    const last30 = sdb.prepare("SELECT COUNT(*) AS n FROM scheduled_posts WHERE status='published' AND published_at >= datetime('now','-30 days')").get().n;
    // post_metrics_history ma dane (935 rekordów), post_metrics jest puste
    const topPosts = adb.prepare(`
      SELECT post_urn,
             MAX(CASE WHEN metric_type='impressions' THEN count END) AS impressions,
             MAX(CASE WHEN metric_type='reactions' THEN count END) AS reactions,
             MAX(CASE WHEN metric_type='comments' THEN count END) AS comments
      FROM post_metrics_history GROUP BY post_urn ORDER BY impressions DESC LIMIT 5
    `).all();
    const followerCount = adb.prepare("SELECT followers FROM daily_stats WHERE followers IS NOT NULL ORDER BY date DESC LIMIT 1").get()?.followers;
    adb.close(); sdb.close();
    return {
      total_published: totalPublished,
      published_last_30d: last30,
      followers: followerCount,
      top_5_posts: topPosts,
    };
  } catch (e) {
    return null;
  }
}

function gatherFacts(projDir) {
  let gitLog = '';
  try {
    gitLog = execSync(`git log --oneline --since='60 days ago' --no-merges -n 60`, {
      cwd: projDir,
      encoding: 'utf-8',
    }).slice(0, 4000);
  } catch (e) {
    gitLog = '(git log unavailable: ' + e.message.slice(0, 100) + ')';
  }
  let readme = '';
  for (const fname of ['README.md', 'README.pl.md', 'docs/README.md', 'README.txt']) {
    const fp = join(projDir, fname);
    if (existsSync(fp)) {
      readme = readFileSync(fp, 'utf-8').slice(0, 6000);
      break;
    }
  }
  let pkgJson = '';
  try {
    const pkgPath = join(projDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      pkgJson = `name: ${pkg.name}\nversion: ${pkg.version}\ndescription: ${pkg.description || '(brak)'}\nscripts: ${Object.keys(pkg.scripts || {}).join(', ')}\ndeps: ${Object.keys(pkg.dependencies || {}).slice(0, 15).join(', ')}`;
    }
  } catch {}
  return { gitLog, readme, pkgJson };
}

// Static system prompt — wszystko co NIE zmienia się per-post.
// Anthropic prompt cache trafi tylko jak ten tekst jest identyczny między callami.
const STATIC_SYSTEM_PROMPT = `Jesteś asystentem Bartka Gacy generującym posty LinkedIn zgodne z jego strategią.

${HUMANIZER ? `== HUMANIZER — TON BARTOSZA (PRIORYTET ABSOLUTNY) ==\n${HUMANIZER}\n` : ''}
${FACT_CHECKER ? `== FACT-CHECKER — ANTI-HALUCYNACJA (PRIORYTET ABSOLUTNY) ==\n${FACT_CHECKER}\n` : ''}
== STRATEGIA (LINKEDIN-STRATEGY.md) ==
${STRATEGY}

== GUIDELINES (algorytm + reguły) ==
${GUIDELINES}

== BRAND VOICE ==
${JSON.stringify(BRAND_VOICE, null, 2)}

== KRYTYCZNE ZASADY ==
1. HOOK <= 210 znaków (najlepiej 62-100). Pierwsze zdanie widoczne przed "see more".
2. POST: 1300-1600 znaków całość.
3. TON: bezpośredni, z lekką ironią, konkretne liczby/daty/nazwy, jak developer rozmawia z innym developerem.
4. JĘZYK: weź z user prompt (zawsze respektuj).
5. HASHTAGI: dokładnie 3 na końcu (#hashtag #hashtag #hashtag), bez emotek przy nich.
6. ZAKAZ:
   - linki w treści (auto-comment 15min później)
   - "I built X in Y hours", "X lessons/tips/rules", "Let me tell you a story"
   - "game changer", "disrupting", "rewolucja", "must have"
   - WSZYSTKIE emotki (zero — także :) ;) i Unicode emoji)
   - em dash "—" i en dash "–" (używaj kropki, średnika, " - " z spacjami, nawiasów)
   - podwójne spacje "  "
   - ALL CAPS dłuższe niż 5 znaków
7. ANTI-HALUCYNACJA: używaj TYLKO faktów ze ŹRÓDEŁ w user prompt (git log, README, package.json). Konkretnych liczb NIE wymyślaj. Zamiast "340 uczniów" pisz "pierwszy klient testuje" lub "MVP w produkcji". NIE wymyślaj nazw produktów/klientów/wersji których nie ma w źródłach.
8. OUTPUT: TYLKO treść posta. Bez "Oto post:", bez nagłówków markdown, bez wyjaśnień.
`;

async function regenerate(item) {
  const projDir = resolveProjectDir(item.source_project);
  if (!projDir) {
    return { error: `project not found: ${item.source_project}`, skip: true };
  }
  const { gitLog, readme, pkgJson } = gatherFacts(projDir);
  const isPolish = (item.language || 'pl') === 'pl';
  // Recap/stats slugs - dorzucamy realne metryki z analytics.db
  const isRecap = /recap|stats|milestone|retrospekcj|podsumowani/i.test(item.slug + ' ' + (item.title || '') + ' ' + (item.format || ''));
  const analyticsFacts = isRecap ? gatherAnalyticsFacts() : null;

  // User prompt — DYNAMICZNY per-post. NIE jest cachowany.
  const userPrompt = `== ŹRÓDŁO FAKTÓW (TYLKO TE INFORMACJE — ZERO HALUCYNACJI) ==

Project: ${item.source_project}
Dir: ${projDir}

== package.json ==
${pkgJson || '(no package.json)'}

== README ==
${readme || '(no README)'}

== git log (60 dni, max 60 commits) ==
${gitLog}

${analyticsFacts ? `== ANALYTICS FACTS (z analytics.db - UŻYJ TYCH LICZB jeśli post o recap/stats) ==
- Total opublikowanych postów: ${analyticsFacts.total_published}
- Opublikowanych w ostatnich 30 dniach: ${analyticsFacts.published_last_30d}
- Aktualni followers: ${analyticsFacts.followers || '(brak danych)'}
- Top 5 postów wg impressions:
${(analyticsFacts.top_5_posts || []).map((p, i) => `  ${i+1}. ${p.impressions || 0} impressions, ${p.reactions || 0} reactions, ${p.comments || 0} comments (urn: ${p.post_urn?.slice(-12)})`).join('\n')}
` : ''}
== KONTEKST POSTA ==
- Slug: ${item.slug}
- Tytuł wewnętrzny: ${item.title || '(brak)'}
- Hook suggestion: ${item.hook || '(brak)'}
- Format: ${item.format || 'thought-leadership'}
- CTA: ${item.cta || 'DM otwarty.'}
- Lead trigger: ${item.lead_trigger || '(brak)'}
- Hashtags suggested: ${item.hashtags || '[]'}

== ZADANIE ==
Wygeneruj treść posta LinkedIn (1300-1600 znaków, hook <=210 znaków, 3 hashtagi na końcu, format: ${item.format || 'thought-leadership'}, język: ${isPolish ? 'polski (80%+ słów polskich)' : 'angielski'}).
Trzymaj się HUMANIZER + FACT-CHECKER ze STATIC SYSTEM PROMPT - to priorytet absolutny.
Zwróć TYLKO treść posta.`;

  const { text, usage } = await callClaude(STATIC_SYSTEM_PROMPT, userPrompt);
  return { text: sanitizePost(text), projDir, usage };
}

// Post-process gwarancja: usuń wszystko czego humanizer zakazał, niezależnie od tego co Claude wypluł.
function sanitizePost(text) {
  if (!text) return text;
  let t = text;
  // 1. em dash + en dash -> spacjowany myślnik
  t = t.replace(/—/g, ' - ').replace(/–/g, ' - ');
  // 2. emotki Unicode (wszystkie emoji bloki + zmod + dingbats) i tekstowe ":)" ";)"
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F100}-\u{1F1FF}️]/gu, '');
  t = t.replace(/(?<![A-Za-z0-9])[:;]-?[\)\(DPpOo]/g, '');
  // 3. podwójne spacje -> pojedyncza (poza początkiem linii)
  t = t.split('\n').map((line) => line.replace(/  +/g, ' ')).join('\n');
  // 4. trailing whitespace na końcu linii
  t = t.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  // 5. potrójne+ newliny -> podwójne (max akapit)
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

async function main() {
  const db = new Database(DB_PATH);
  // W auto-schedule: bierzemy wszystkie 'plan' + 'napisane' niezależnie od daty (i tak je przeplanujemy).
  // Bez auto-schedule: zachowujemy oryginalny filtr (tylko przyszłe).
  let query = `
    SELECT id, slug, source_project, scheduled_post_id, status, publish_at, language, format, title, hook, cta, lead_trigger, hashtags, post_text, topic_number
    FROM media_plan_items
    WHERE status IN ('napisane','plan')
  `;
  if (!autoSchedule) query += ` AND publish_at >= date('now', '+1 day')`;
  if (slugArg) query += ` AND slug = '${slugArg.replace(/'/g, "''")}'`;
  query += autoSchedule ? ` ORDER BY topic_number ASC` : ` ORDER BY publish_at ASC`;

  const targets = db.prepare(query).all();

  // Przygotuj nowe daty publikacji jeśli auto-schedule
  let newSlots = [];
  if (autoSchedule && targets.length > 0) {
    const start = startDateArg ? new Date(startDateArg) : new Date(Date.now() + 86400_000);
    newSlots = generateMWFSlots(start, targets.length);
    console.log(`\n📅 Auto-schedule: ${targets.length} sloty od ${newSlots[0]} do ${newSlots[newSlots.length-1]}`);
  }

  console.log(`\n🤖 Regenerating ${targets.length} posts${dryRun ? ' (DRY-RUN)' : ''}${autoSchedule ? ' + AUTO-SCHEDULE' : ''}\n`);

  let succeeded = 0, failed = 0, skipped = 0;
  let totalInputTokens = 0, totalCacheRead = 0, totalCacheCreated = 0, totalOutput = 0;
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const newPublishAt = autoSchedule ? newSlots[i] : item.publish_at;
    const dateLabel = autoSchedule ? `${item.publish_at.slice(0,10)} -> ${newPublishAt.slice(0,10)}` : item.publish_at.slice(0,10);
    process.stdout.write(`  [#${item.topic_number} ${dateLabel}] ${item.slug}... `);
    try {
      const t0 = Date.now();
      const result = await regenerate(item);
      const ms = Date.now() - t0;
      if (result.skip) {
        console.log(`⏭ skip: ${result.error}`);
        skipped++;
        continue;
      }
      if (result.usage) {
        totalInputTokens += (result.usage.input_tokens || 0);
        totalCacheRead += (result.usage.cache_read_input_tokens || 0);
        totalCacheCreated += (result.usage.cache_creation_input_tokens || 0);
        totalOutput += (result.usage.output_tokens || 0);
      }
      const chars = result.text.length;
      const hookLen = result.text.split('\n')[0].length;
      const hasHashtags = /#\w+/.test(result.text);
      const ok = chars >= 800 && chars <= 2200 && hookLen <= 220 && hasHashtags;
      const cacheHit = (result.usage?.cache_read_input_tokens || 0) > 0;
      console.log(`${ok ? '✓' : '⚠️'} ${chars}c hook${hookLen} #${hasHashtags?'Y':'N'} ${(ms/1000).toFixed(1)}s ${cacheHit?'[cache]':'[fresh]'}`);
      if (dryRun) {
        console.log('--- BEGIN POST ---');
        console.log(result.text);
        console.log('--- END POST ---\n');
        succeeded++;
        continue;
      }
      if (!ok) {
        console.log(`  ✗ WALIDACJA FAIL chars=${chars} hookLen=${hookLen} hashtags=${hasHashtags}.`);
        failed++;
        continue;
      }
      // 1) UPDATE media_plan_items (post_text + status + new publish_at jeśli auto-schedule)
      db.prepare(`
        UPDATE media_plan_items
        SET original_post_text = COALESCE(original_post_text, post_text),
            post_text = ?,
            status = 'napisane',
            publish_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(result.text, newPublishAt, item.id);

      // 2) Albo UPDATE istniejący scheduled_post, albo INSERT nowy.
      // Iter12: dodajemy media_preview_path = visual_asset_path z media_plan_items
      // (NVIDIA FLUX outputs), żeby auto-publish.mjs upload-ował obraz wraz z postem.
      const visualPath = item.visual_asset_path || null;  // jeśli już istnieje w media_plan_items
      const refreshedItem = db.prepare("SELECT visual_asset_path FROM media_plan_items WHERE id = ?").get(item.id);
      const finalVisualPath = refreshedItem?.visual_asset_path || visualPath;
      if (item.scheduled_post_id) {
        db.prepare(
          "UPDATE scheduled_posts SET text = ?, publish_at = ?, status = 'scheduled', language = COALESCE(language, ?), media_preview_path = COALESCE(?, media_preview_path), media_kind = COALESCE(?, media_kind, 'IMAGE'), updated_at = datetime('now') WHERE id = ?"
        ).run(result.text, newPublishAt, item.language || 'pl', finalVisualPath, finalVisualPath ? 'IMAGE' : null, item.scheduled_post_id);
      } else {
        // generate UUID jako string id (LinkedIn-mcp używa ich)
        const sid = crypto.randomUUID();
        db.prepare(`
          INSERT INTO scheduled_posts (id, text, visibility, publish_at, status, language, imported_from, media_preview_path, media_kind, created_at, updated_at)
          VALUES (?, ?, 'PUBLIC', ?, 'scheduled', ?, 'media_plan', ?, ?, datetime('now'), datetime('now'))
        `).run(sid, result.text, newPublishAt, item.language || 'pl', finalVisualPath, finalVisualPath ? 'IMAGE' : null);
        db.prepare(
          "UPDATE media_plan_items SET scheduled_post_id = ? WHERE id = ?"
        ).run(sid, item.id);
        console.log(`     ↪ INSERT scheduled_posts ${sid.slice(0, 8)}${finalVisualPath ? ' [+image]' : ''}`);
      }
      succeeded++;
      await new Promise((r) => setTimeout(r, 800));  // mild rate limit; SDK ma cache więc nie potrzeba 3s
    } catch (e) {
      console.log(`✗ ${e.message?.slice(0, 150)}`);
      failed++;
    }
  }
  db.close();
  console.log(`\n📊 Summary: ${succeeded} regenerated, ${skipped} skipped, ${failed} failed`);
  console.log(`💰 Tokens: input=${totalInputTokens} cache_read=${totalCacheRead} cache_created=${totalCacheCreated} output=${totalOutput}`);
  const cacheHitRate = totalCacheRead / Math.max(1, totalCacheRead + totalInputTokens);
  console.log(`📊 Cache hit rate: ${(cacheHitRate * 100).toFixed(1)}% (im wyżej tym taniej i szybciej)`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
