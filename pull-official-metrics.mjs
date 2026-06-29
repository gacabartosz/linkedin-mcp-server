#!/usr/bin/env node
/**
 * pull-official-metrics.mjs — ingest official per-post analytics (impressions,
 * members reached, reshares, reactions, comments) into analytics.db.
 *
 * Source: LinkedIn official Member Creator Post Analytics API
 *   (src/api/analytics.ts → getPostFullAnalytics), aggregation=TOTAL.
 * Requires OAuth scope r_member_postAnalytics (added to the default scope set in
 * src/index.ts). Run `linkedin_auth_start` and re-consent first, otherwise every
 * call 403s and this script exits cleanly with a clear message.
 *
 * This is the robust replacement for the flaky Highcharts impressions scrape.
 * Writes one row per (post_urn, date) into post_metrics_history — the table the
 * LLM snapshot reads for reach (and, once populated, prefers for impressions).
 *
 * Usage: node pull-official-metrics.mjs [--limit N] [--days N]
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getPostFullAnalytics } from './dist/api/analytics.js';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const ANALYTICS_DB = join(DATA_DIR, 'analytics.db');
const SCHEDULER_DB = join(DATA_DIR, 'scheduler.db');

const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };
const LIMIT = parseInt(arg('--limit', '30'), 10);
const DAYS = parseInt(arg('--days', '120'), 10);

function today() {
  // basis date for the row; derived from the system date at ingest time. This is a
  // collection script (side-effecting), so a real timestamp is appropriate here.
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  if (!existsSync(SCHEDULER_DB)) { console.error('[pull-official] scheduler.db not found'); process.exit(1); }

  const sdb = new Database(SCHEDULER_DB, { readonly: true });
  const posts = sdb.prepare(`
    SELECT post_urn FROM scheduled_posts
    WHERE status='published' AND post_urn IS NOT NULL AND post_urn != ''
      AND publish_at >= date('now', ?)
    ORDER BY publish_at DESC LIMIT ?
  `).all(`-${DAYS} days`, LIMIT);
  sdb.close();

  if (posts.length === 0) { console.error('[pull-official] no published posts with a URN to query'); return; }

  const adb = new Database(ANALYTICS_DB);
  adb.exec(`CREATE TABLE IF NOT EXISTS post_metrics_history (
    post_urn TEXT NOT NULL, date TEXT NOT NULL,
    impressions INTEGER DEFAULT 0, members_reached INTEGER DEFAULT 0,
    reactions INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, reshares INTEGER DEFAULT 0,
    fetched_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (post_urn, date))`);
  const upsert = adb.prepare(`
    INSERT INTO post_metrics_history (post_urn, date, impressions, members_reached, reactions, comments, reshares, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_urn, date) DO UPDATE SET
      impressions=excluded.impressions, members_reached=excluded.members_reached,
      reactions=excluded.reactions, comments=excluded.comments, reshares=excluded.reshares,
      fetched_at=excluded.fetched_at`);

  const d = today();
  let ok = 0, failed = 0;
  for (const { post_urn } of posts) {
    try {
      const m = await getPostFullAnalytics(post_urn); // {impression, members_reached, reshare, reaction, comment}
      upsert.run(post_urn, d, m.impression || 0, m.members_reached || 0, m.reaction || 0, m.comment || 0, m.reshare || 0);
      ok++;
    } catch (err) {
      failed++;
      const msg = String(err?.message || err);
      if (msg.includes('403') || msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('scope')) {
        console.error('[pull-official] 403 — scope r_member_postAnalytics not granted yet. Re-run linkedin_auth_start and re-consent, then retry.');
        break;
      }
      console.error(`[pull-official] ${post_urn}: ${msg}`);
    }
    await new Promise(r => setTimeout(r, 1200)); // gentle pacing
  }
  adb.close();
  console.error(`[pull-official] done: ${ok} posts ingested, ${failed} failed, date=${d}`);
}

main().catch(e => { console.error('[pull-official] fatal:', e?.message || e); process.exit(1); });
