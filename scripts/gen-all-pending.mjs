#!/usr/bin/env node
/**
 * gen-all-pending — bulk wrapper for gen-post-image.mjs.
 *
 * Iterates over media_plan_items rows where banner_path is empty/fake and
 * status is not cancelled/archived, calls gen-post-image.mjs sequentially.
 *
 * Usage:
 *   node scripts/gen-all-pending.mjs               # all pending
 *   node scripts/gen-all-pending.mjs --limit 5     # only first 5
 *   node scripts/gen-all-pending.mjs --concept code,numbers
 *   node scripts/gen-all-pending.mjs --dry-run     # list only
 *   node scripts/gen-all-pending.mjs --force       # regen even if banner_path set
 *   node scripts/gen-all-pending.mjs --gemini-delay 15
 *   node scripts/gen-all-pending.mjs --no-visual   # skip Imagen secondary
 */
import Database from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/better-sqlite3/lib/index.js';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEDULER_DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');

const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}

const LIMIT = parseInt(arg('limit', '0'), 10);
const CONCEPT_FILTER = arg('concept', '');
const DRY_RUN = flag('dry-run');
const FORCE = flag('force');
const NO_VISUAL = flag('no-visual');
const GEMINI_DELAY = parseInt(arg('gemini-delay', '15'), 10) * 1000;

const db = new Database(SCHEDULER_DB, { readonly: true });

let query = `SELECT slug, banner_concept, score_visual, score_total, language, status, banner_path, publish_at
  FROM media_plan_items
  WHERE status NOT IN ('cancelled','archived')
    AND (? = 1 OR banner_path IS NULL OR banner_path = '' OR banner_path LIKE '%fake%')`;
const params = [FORCE ? 1 : 0];

if (CONCEPT_FILTER) {
  const cs = CONCEPT_FILTER.split(',').map(s => s.trim()).filter(Boolean);
  if (cs.length) {
    query += ` AND banner_concept IN (${cs.map(() => '?').join(',')})`;
    params.push(...cs);
  }
}
query += ` ORDER BY publish_at ASC, score_total DESC`;
if (LIMIT > 0) query += ` LIMIT ${LIMIT}`;

const rows = db.prepare(query).all(...params);
db.close();

console.log(`[bulk] ${rows.length} rows to process. force=${FORCE} no-visual=${NO_VISUAL} delay=${GEMINI_DELAY / 1000}s`);
console.log('');

if (DRY_RUN) {
  for (const r of rows) console.log(`  ${r.slug}  concept=${r.banner_concept} visual=${r.score_visual} publish=${r.publish_at}`);
  process.exit(0);
}

const genScript = join(__dirname, 'gen-post-image.mjs');

let ok = 0, fail = 0;
const startAll = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const t0 = Date.now();
  console.log(`\n=== [${i + 1}/${rows.length}] ${r.slug} (${r.banner_concept}, visual=${r.score_visual}) ===`);

  const cliArgs = [genScript, r.slug];
  if (FORCE) cliArgs.push('--force');
  if (NO_VISUAL) cliArgs.push('--no-visual');

  const res = spawnSync('node', cliArgs, {
    stdio: 'inherit',
    timeout: 120000,
  });

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status === 0) {
    ok++;
    console.log(`[bulk] ${r.slug} OK (${dt}s)`);
  } else {
    fail++;
    console.warn(`[bulk] ${r.slug} FAIL (exit=${res.status}, ${dt}s)`);
  }

  // Rate-limit Imagen API: sleep only when row used Imagen (illustration OR score_visual>=4 without --no-visual)
  const usedImagen = !NO_VISUAL && (r.banner_concept === 'illustration' || r.score_visual >= 4);
  if (usedImagen && i < rows.length - 1) {
    console.log(`[bulk] sleeping ${GEMINI_DELAY / 1000}s (Imagen rate-limit)...`);
    await new Promise(res => setTimeout(res, GEMINI_DELAY));
  }
}

const totalMin = ((Date.now() - startAll) / 60000).toFixed(1);
console.log(`\n[bulk] DONE: ${ok} ok, ${fail} fail, total ${totalMin} min.`);
