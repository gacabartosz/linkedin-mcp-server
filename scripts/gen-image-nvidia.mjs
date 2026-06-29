#!/usr/bin/env node
/**
 * NVIDIA FLUX image generator dla media_plan_items.
 *
 * - Bierze media_plan_items.status IN ('napisane','scheduled') bez visual_asset_path
 *   (lub wszystkie z flagą --regen)
 * - Generuje opisowy prompt z hooka + format + brand voice
 * - Wywołuje NVIDIA FLUX schnell (https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell)
 * - Zapisuje PNG do ~/.linkedin-mcp/images/posts/<slug>.png
 * - Update media_plan_items.visual_asset_path i visual_asset_type='nvidia-flux-schnell'
 *
 * Usage:
 *   node scripts/gen-image-nvidia.mjs                  # wszystkie bez visual_asset_path
 *   node scripts/gen-image-nvidia.mjs --slug=22-gacek  # konkretny
 *   node scripts/gen-image-nvidia.mjs --regen          # nadpisz nawet jeśli już jest
 *   node scripts/gen-image-nvidia.mjs --dry-run        # pokaż prompty, nie odpalaj API
 */

import Database from 'better-sqlite3';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const IMG_DIR = join(homedir(), '.linkedin-mcp', 'images', 'posts');
const ENV_PATH = join(homedir(), '.linkedin-mcp', '.env');

// Wczytaj NVIDIA_API_KEY z ~/.linkedin-mcp/.env (chmod 600)
function loadKey() {
  if (process.env.NVIDIA_API_KEY) return process.env.NVIDIA_API_KEY;
  try {
    const env = readFileSync(ENV_PATH, 'utf-8');
    const m = env.match(/^NVIDIA_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}
const NVIDIA_API_KEY = loadKey();
if (!NVIDIA_API_KEY) {
  console.error(`❌ NVIDIA_API_KEY nie znaleziony (sprawdź ${ENV_PATH} lub env var)`);
  process.exit(1);
}
if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const regen = args.includes('--regen');
const slugArg = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

const FLUX_ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell';

// Tematyczne branche promptów per topic - wyciąga wizualny koncept z treści posta
// zamiast generic "minimalist abstract". Cel: obraz zatrzymujący scroll w feedzie.
const THEME_BRANCHES = [
  { match: /ksef|faktur|jpk|vat|fa\(3\)|p_14|korekta/i,
    desc: 'official Polish tax office aesthetic, formal documents stacked on dark wooden desk, stamps, paperwork, blue-grey government palette with single orange accent, warm side light, editorial photography' },
  { match: /whatsapp|messenger|sms|wiadomo|bot.*komunikator/i,
    desc: 'modern smartphone displaying messaging chat interface, green accent matching WhatsApp brand, dark workspace background, productive flow, hand near phone, cinematic side light' },
  { match: /mcp|claude code|terminal|cli|gacek|bielik/i,
    desc: 'developer terminal interface dark theme, multiple terminal windows tiled, blinking cursor, code editor aesthetic, deep navy #0d1117 with electric cyan accents, programmer setup, late-night vibe' },
  { match: /multi.?agent|orchestr|19 agent|architekt/i,
    desc: 'isometric node graph network, glowing connection lines between nodes, decentralized topology suggesting parallel work, deep blue background with orange node highlights, abstract architecture' },
  { match: /failure|błąd|broken|--force-reset|prisma|halucynac|crash/i,
    desc: 'visual metaphor of shattered then reassembling object - broken database visualization, fragments of data floating mid-recovery, high contrast red-to-green transition suggesting recovery, dramatic dark mood' },
  { match: /polski.*ai|sovereign|local|lokalnie|speakleash|polski.*model/i,
    desc: 'Polish technology sovereignty aesthetic, subtle white-red accent stripe, server room with warm amber light, hardware locally hosted, national tech pride, editorial professional' },
  { match: /rag|kodeks|aplikantai|prawo|prawnik|ustaw/i,
    desc: 'digital library architecture, floating legal codex pages with subtle glow, scholarly blue-grey palette, knowledge graph suggested in background, soft warm reading light' },
  { match: /rodo|presidio|anonim|pii|prywat|gdpr/i,
    desc: 'data privacy abstract, glowing padlock symbol breaking apart into encrypted fragments, deep navy with emerald-green security accent, vault aesthetic, sense of secure isolation' },
  { match: /irz|stado|bydl|rolnik|arimr|hodowca|farmer/i,
    desc: 'modern agritech dashboard overlay on rural farm landscape blurred behind, data visualization meeting traditional farming, green-and-earth palette with charts floating, professional infographic style' },
  { match: /nieruchom|sprawdznotari|notariusz|rcn|deszczno|hala/i,
    desc: 'urban architecture aerial top-down map view, property data points pulsing with light, dark blue cartography aesthetic with warm orange data accents, real estate intelligence visualization' },
  { match: /google ads|gsc|seo|search.console|ranking/i,
    desc: 'search engine results visualized as 3D layered landscape, ranking positions as floating tiles, dark interface with green and orange data accents, analytics dashboard aesthetic' },
  { match: /linkedin|content|engagement|algorytm.*post|viral/i,
    desc: 'social analytics dashboard close-up, line graphs ascending sharply, engagement metric tiles, modern UI dark mode with blue and orange highlights, scroll-stopping data viz' },
  { match: /wal|backup|recovery|odzyskiwa|pg_/i,
    desc: 'recovery operation visualization, fragments of data flowing back together, hex dump aesthetic in background, dramatic before-and-after lighting transition, deep dark blue mood' },
  { match: /grup.*facebook|31 grup|automatyz.*social/i,
    desc: 'network of interconnected community nodes, social graph topology, warm community-vibe orange and blue, isometric depth, suggestion of broadcast reach without faces' },
  { match: /gmail|drive|workspace|maile.*porządk/i,
    desc: 'minimalist organized digital workspace, folder structure visualization, clean monochrome with single warm accent, before-after sense of order from chaos, productivity aesthetic' },
  { match: /n8n|workflow|automation|automat/i,
    desc: 'workflow nodes connected by glowing data pipelines, automation graph aesthetic, dark interface with cyan flow lines, isometric depth, modern dev-ops vibe' },
];

function buildImagePrompt(item) {
  const text = `${item.title || ''} ${item.hook || ''} ${item.slug || ''} ${(item.post_text || '').slice(0, 600)}`;
  const matched = THEME_BRANCHES.find((b) => b.match.test(text));
  const theme = matched
    ? matched.desc
    : 'editorial tech illustration, dark navy background #0d1117 with single accent of warm orange or electric cyan, abstract geometric composition with single focal object, professional editorial';

  const hookFirstLine = (item.post_text || item.hook || '').split('\n')[0].replace(/[„"]/g, '').slice(0, 100);
  const topic = item.title || item.slug;

  return [
    `Editorial photo-illustration for LinkedIn feed thumbnail. Topic: ${topic}.`,
    `Concept: "${hookFirstLine}".`,
    `Visual theme: ${theme}.`,
    `Composition: rule of thirds, single focal point, generous negative space, scroll-stopping.`,
    `Strict: NO embedded text, NO logos, NO watermarks, NO human faces, NO LinkedIn UI, NO emoji.`,
    `Mood: precise, professional, slightly mysterious, human-not-corporate, magazine cover quality.`,
    `Lighting: dramatic side light, soft shadows, cinematic depth.`,
    `Quality: 8k editorial photography, sharp focus, professional finish.`,
    `Aspect 1:1, 1024x1024, LinkedIn feed optimized.`,
  ].join(' ');
}

const MIN_VALID_SIZE = 20_000;  // <20KB = często niekompletny / zbyt ciemny / placeholder
const MAX_RETRIES = 2;

async function fluxCall(prompt, seed) {
  const body = { prompt, width: 1024, height: 1024, seed, steps: 4, cfg_scale: 0 };
  const t0 = Date.now();
  const res = await fetch(FLUX_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, error: `HTTP ${res.status} (${ms}ms): ${errText.slice(0, 200)}`, ms };
  }
  const data = await res.json();
  const b64 = data?.artifacts?.[0]?.base64;
  if (!b64) return { ok: false, error: 'No base64 in response: ' + JSON.stringify(data).slice(0, 200), ms };
  const buf = Buffer.from(b64, 'base64');
  return { ok: true, buf, ms };
}

async function generateOne(item) {
  const prompt = buildImagePrompt(item);
  const outPath = join(IMG_DIR, `${item.slug}.png`);

  if (dryRun) {
    console.log(`\n=== ${item.slug} ===\nPrompt: ${prompt}\nWould save to: ${outPath}\n`);
    return { ok: true, dryRun: true, path: outPath };
  }

  if (existsSync(outPath) && !regen) {
    return { ok: true, skipped: 'exists', path: outPath };
  }

  // Fallback prompt - konkretny prosty objekt zamiast metafory.
  // Używany gdy główny prompt 3x dał za mały plik (FLUX schnell nie radzi sobie z abstrakcjami).
  const fallbackPrompt = [
    `Editorial product photography for LinkedIn feed. Topic: ${item.title || item.slug}.`,
    `Single iconic object: a modern laptop on a dark wooden desk, screen glowing with abstract data visualization, no readable text on screen.`,
    `Dark background, single warm side light from upper left, deep shadows, premium product photography style.`,
    `Composition: rule of thirds, generous negative space, scroll-stopping focal point.`,
    `NO embedded text, NO logos, NO faces, NO emoji.`,
    `Quality: 8k editorial magazine photography, sharp focus, professional.`,
    `Aspect 1:1, 1024x1024.`,
  ].join(' ');

  let lastResult = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const usePrompt = (attempt === MAX_RETRIES && lastResult?.tooSmall) ? fallbackPrompt : prompt;
    const seed = Math.floor(Math.random() * 1_000_000);
    const r = await fluxCall(usePrompt, seed);
    if (!r.ok) { lastResult = r; continue; }
    if (r.buf.length < MIN_VALID_SIZE && attempt < MAX_RETRIES) {
      // Mały plik = placeholder. Retry z innym seedem, ostatnia próba z fallback promptem.
      lastResult = { ok: false, tooSmall: true, error: `attempt ${attempt+1}: image too small (${r.buf.length}B < ${MIN_VALID_SIZE}B)`, ms: r.ms };
      continue;
    }
    writeFileSync(outPath, r.buf);
    return { ok: true, path: outPath, size: r.buf.length, ms: r.ms, seed, attempts: attempt + 1, usedFallback: usePrompt === fallbackPrompt };
  }
  // Ostatecznie zapisz nawet jeśli mały (lepsze coś niż nic).
  if (lastResult?.tooSmall) {
    // Spróbuj jeszcze raz z fallback bez walidatora.
    const r = await fluxCall(fallbackPrompt, Math.floor(Math.random() * 1_000_000));
    if (r.ok && r.buf.length > 0) {
      writeFileSync(outPath, r.buf);
      return { ok: true, path: outPath, size: r.buf.length, ms: r.ms, usedFallback: true, attempts: MAX_RETRIES + 2 };
    }
  }
  return lastResult || { ok: false, error: 'unknown failure' };
}

async function main() {
  const db = new Database(DB_PATH);
  let query = `
    SELECT id, slug, title, hook, post_text, format, topic_number, status, visual_asset_path
    FROM media_plan_items
    WHERE status IN ('napisane','scheduled')
  `;
  if (slugArg) query += ` AND slug = '${slugArg.replace(/'/g, "''")}'`;
  if (!regen && !slugArg) query += ` AND (visual_asset_path IS NULL OR visual_asset_path = '')`;
  query += ` ORDER BY topic_number ASC`;
  const targets = db.prepare(query).all();

  console.log(`🎨 NVIDIA FLUX: ${targets.length} obrazów${dryRun ? ' (DRY-RUN)' : ''}${regen ? ' (REGEN)' : ''}\n`);

  let ok = 0, failed = 0, skipped = 0;
  for (const item of targets) {
    process.stdout.write(`  [#${item.topic_number}] ${item.slug}... `);
    try {
      const result = await generateOne(item);
      if (result.skipped) {
        console.log(`⏭ ${result.skipped}`);
        skipped++;
        continue;
      }
      if (!result.ok) {
        console.log(`✗ ${result.error}`);
        failed++;
        continue;
      }
      if (!dryRun) {
        console.log(`✓ ${(result.size/1024).toFixed(0)}KB in ${result.ms}ms`);
        db.prepare(`
          UPDATE media_plan_items
          SET visual_asset_path = ?,
              visual_asset_type = 'nvidia-flux-schnell',
              updated_at = datetime('now')
          WHERE id = ?
        `).run(result.path, item.id);
        // Iter12: sync do scheduled_posts.media_preview_path - auto-publish.mjs to czyta
        const sched = db.prepare("SELECT scheduled_post_id FROM media_plan_items WHERE id = ?").get(item.id);
        if (sched?.scheduled_post_id) {
          db.prepare(
            "UPDATE scheduled_posts SET media_preview_path = ?, media_kind = COALESCE(media_kind, 'IMAGE'), updated_at = datetime('now') WHERE id = ? AND status IN ('scheduled','approved')"
          ).run(result.path, sched.scheduled_post_id);
        }
        ok++;
      } else {
        ok++;
      }
      await new Promise((r) => setTimeout(r, 1500));  // mild rate-limit dla NVIDIA
    } catch (e) {
      console.log(`✗ ${e.message?.slice(0, 120)}`);
      failed++;
    }
  }
  db.close();
  console.log(`\n📊 Summary: ${ok} ok, ${skipped} skipped, ${failed} failed`);
  console.log(`📂 Images: ${IMG_DIR}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
