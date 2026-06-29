#!/usr/bin/env node
/**
 * Master pipeline — całość w jednym skrypcie.
 *
 *   1. init-guidelines (--force jeśli flaga)
 *   2. regenerate-posts.mjs --auto-schedule (15 sztuk media_plan_items 'plan'+'napisane' → scheduled_posts)
 *   3. gen-image-nvidia.mjs (NVIDIA FLUX schnell, 1 obraz per slug 'napisane' bez visual_asset_path)
 *
 * Usage:
 *   node scripts/run-pipeline.mjs                  # pełna pipeline (regenerate + images)
 *   node scripts/run-pipeline.mjs --skip-regen     # tylko obrazy
 *   node scripts/run-pipeline.mjs --skip-images    # tylko regeneracja
 *   node scripts/run-pipeline.mjs --reset-guidelines  # init-guidelines --force przed
 *   node scripts/run-pipeline.mjs --dry-run        # pokaż co zrobi, bez DB writes
 *   node scripts/run-pipeline.mjs --start=2026-06-09  # data startu MWF schedule
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = __dirname;

const args = process.argv.slice(2);
const skipRegen = args.includes('--skip-regen');
const skipImages = args.includes('--skip-images');
const resetGuidelines = args.includes('--reset-guidelines');
const dryRun = args.includes('--dry-run');
const startArg = args.find((a) => a.startsWith('--start='));

const COLORS = { reset: '\x1b[0m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yel: '\x1b[33m', dim: '\x1b[2m' };
const log = (msg) => console.log(`${COLORS.cyan}[pipeline]${COLORS.reset} ${msg}`);
const ok = (msg) => console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
const err = (msg) => console.error(`${COLORS.red}✗${COLORS.reset} ${msg}`);
const hr = () => console.log(`${COLORS.dim}${'─'.repeat(60)}${COLORS.reset}`);

function runStep(name, cmd, scriptArgs) {
  return new Promise((resolve, reject) => {
    hr();
    log(`${COLORS.bold}${name}${COLORS.reset}`);
    log(`  node ${cmd} ${scriptArgs.join(' ')}`);
    const t0 = Date.now();
    const child = spawn('node', [cmd, ...scriptArgs], { stdio: 'inherit' });
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      if (code === 0) {
        ok(`${name} done in ${(ms/1000).toFixed(1)}s`);
        resolve({ ok: true, ms });
      } else {
        err(`${name} failed (exit ${code}) after ${(ms/1000).toFixed(1)}s`);
        resolve({ ok: false, ms, exitCode: code });
      }
    });
    child.on('error', (e) => {
      err(`${name} spawn error: ${e.message}`);
      resolve({ ok: false, err: e.message });
    });
  });
}

async function main() {
  console.log(`${COLORS.bold}🚀 LI Pipeline${COLORS.reset} - start ${new Date().toLocaleString('pl-PL')}`);
  console.log(`  ${dryRun ? 'DRY-RUN' : 'LIVE'} | regen=${!skipRegen} images=${!skipImages} reset-guidelines=${resetGuidelines}`);

  const results = [];

  // Step 0: optional guidelines reset (idempotent unless --force)
  if (resetGuidelines) {
    const r = await runStep('Step 0/3: init-guidelines --force', join(SCRIPTS, 'init-guidelines.mjs'), ['--force']);
    results.push(['init-guidelines', r]);
    if (!r.ok) { err('Aborting: guidelines init failed'); process.exit(1); }
  }

  // Step 1: regenerate posts (media_plan_items 'plan'/'napisane' -> sanitized text + scheduled_posts)
  if (!skipRegen) {
    const regenArgs = ['--auto-schedule'];
    if (dryRun) regenArgs.push('--dry-run');
    if (startArg) regenArgs.push(startArg);
    const r = await runStep('Step 1/3: regenerate-posts --auto-schedule', join(SCRIPTS, 'regenerate-posts.mjs'), regenArgs);
    results.push(['regenerate-posts', r]);
    if (!r.ok && !dryRun) {
      err('Regenerate had failures - kontynuuję z images dla tego co przeszło');
    }
  } else {
    log('  ⏭  Skipping regenerate (--skip-regen)');
  }

  // Step 2: NVIDIA FLUX images for slugs ze status='napisane' bez visual_asset_path
  if (!skipImages) {
    const imgArgs = [];
    if (dryRun) imgArgs.push('--dry-run');
    const r = await runStep('Step 2/3: gen-image-nvidia', join(SCRIPTS, 'gen-image-nvidia.mjs'), imgArgs);
    results.push(['gen-image-nvidia', r]);
  } else {
    log('  ⏭  Skipping images (--skip-images)');
  }

  // Step 3: summary
  hr();
  console.log(`${COLORS.bold}📊 Pipeline summary${COLORS.reset}`);
  for (const [name, r] of results) {
    const status = r.ok ? `${COLORS.green}OK${COLORS.reset}` : `${COLORS.red}FAIL${COLORS.reset}`;
    console.log(`  ${status}  ${name} (${(r.ms/1000).toFixed(1)}s${r.exitCode != null ? `, exit ${r.exitCode}` : ''})`);
  }
  console.log(`  ${COLORS.dim}Dashboard: http://localhost:6767 → tab Kolejka postów${COLORS.reset}`);
  const allOk = results.every(([, r]) => r.ok);
  process.exit(allOk ? 0 : 2);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
