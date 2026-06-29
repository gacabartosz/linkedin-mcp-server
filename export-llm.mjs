#!/usr/bin/env node
/**
 * export-llm.mjs — write the deterministic, LLM-ready analytics snapshot to disk.
 *
 * Reads only the already-collected DBs (no scraping here) and emits:
 *   ~/.linkedin-mcp/exports/analytics-latest.json     (canonical, deterministic)
 *   ~/.linkedin-mcp/exports/analytics-<basis_date>.json (archive, named by DB date)
 *
 * The content is identical to GET /api/analytics/llm-export — both call
 * lib/analytics-snapshot.mjs::buildSnapshot(). Safe to run repeatedly; same DB
 * state produces byte-identical output (no wall-clock timestamp in the payload).
 *
 * Usage: node export-llm.mjs [--print]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot } from './lib/analytics-snapshot.mjs';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const OUT_DIR = join(DATA_DIR, 'exports');

const snap = buildSnapshot();
const jsonStr = JSON.stringify(snap, null, 2);

if (process.argv.includes('--print')) {
  process.stdout.write(jsonStr + '\n');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const latest = join(OUT_DIR, 'analytics-latest.json');
writeFileSync(latest, jsonStr);

const basis = snap.basis_date || 'unknown';
const archive = join(OUT_DIR, `analytics-${basis}.json`);
writeFileSync(archive, jsonStr);

const dq = snap.data_quality || {};
process.stderr.write(
  `[export-llm] wrote ${latest}\n` +
  `  basis_date=${basis}  bytes=${jsonStr.length}\n` +
  `  followers=${snap.followers?.current?.value ?? 'n/a'}  reactions=${snap.reactions?.total?.value ?? 'n/a'}  ` +
  `impressions=${snap.impressions?.total?.value ?? 'n/a'}\n` +
  `  unavailable=${(dq.unavailable_metrics || []).length}  stale=${(dq.stale_metrics || []).length}  errors_today=${dq.errors_today}\n`,
);
