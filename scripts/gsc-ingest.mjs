#!/usr/bin/env node
/**
 * GSC ingest — pulls Search Analytics (queries, pages, dates) for sc-domain:bartoszgaca.pl
 * via Google Search Console API and upserts into ~/.linkedin-mcp/content.db.
 *
 * Auth: service account JSON at GSC_SA_PATH (default ~/.gsc-mcp-key.json locally,
 * /etc/linkedin-mcp/gsc-sa.json in container). The same key was added to GSC as Restricted user.
 *
 * Reuse pattern from bartoszgaca.pl/gsc_inspect_pages.py (Python) — same site URI, same scope.
 *
 * Usage:
 *   node scripts/gsc-ingest.mjs                # default: last 7 days
 *   node scripts/gsc-ingest.mjs --days=28      # GSC max retention is ~16 months
 *   node scripts/gsc-ingest.mjs --dry-run
 *
 * Verification: top 10 by impressions should contain 'claude'/'mcp'/'ai' related queries
 * if site content matches focus areas (sanity check, not strict).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { JWT } from 'google-auth-library';

const SITE = process.env.GSC_SITE || 'sc-domain:bartoszgaca.pl';
const SA_PATH = process.env.GSC_SA_PATH || join(homedir(), '.gsc-mcp-key.json');
const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const DB_PATH = join(DATA_DIR, 'content.db');

const args = process.argv.slice(2);
const flagVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const dryRun = args.includes('--dry-run');
const days = parseInt(flagVal('days', '7'), 10);

if (!existsSync(SA_PATH)) {
  console.error(`FATAL: GSC service account not found at ${SA_PATH}`);
  process.exit(2);
}

const sa = JSON.parse(readFileSync(SA_PATH, 'utf-8'));
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});

function ensureDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gsc_queries_daily (
      date TEXT NOT NULL, query TEXT NOT NULL, page TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL,
      position REAL,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (date, query, page)
    );
    CREATE INDEX IF NOT EXISTS idx_gsc_q_date ON gsc_queries_daily(date);
    CREATE INDEX IF NOT EXISTS idx_gsc_q_imp ON gsc_queries_daily(impressions DESC);
    CREATE INDEX IF NOT EXISTS idx_gsc_q_query ON gsc_queries_daily(query);
  `);
  return db;
}

function dateOffset(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function fetchSearchAnalytics() {
  await auth.authorize(); // explicit token exchange — fetch headers later won't auto-trigger
  const startDate = dateOffset(days + 2); // GSC has ~2-3 day data lag
  const endDate = dateOffset(2);
  const all = [];
  let startRow = 0;
  const rowLimit = 25000;
  while (true) {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
    const tokenResp = await auth.getAccessToken();
    const accessToken = tokenResp?.token || tokenResp;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate, endDate,
        dimensions: ['date', 'query', 'page'],
        rowLimit,
        startRow,
        dataState: 'all',
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`GSC API ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const rows = data.rows || [];
    all.push(...rows);
    if (rows.length < rowLimit) break;
    startRow += rowLimit;
    if (startRow > 200_000) {
      console.error('[gsc] safety break at 200k rows');
      break;
    }
  }
  return all;
}

(async () => {
  console.error(`[gsc] ${SITE}, last ${days}d…`);
  let rows;
  try {
    rows = await fetchSearchAnalytics();
  } catch (err) {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  }
  console.error(`[gsc] fetched ${rows.length} rows`);
  const mapped = rows.map(r => ({
    date: r.keys[0],
    query: r.keys[1],
    page: r.keys[2],
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: r.ctr ?? null,
    position: r.position ?? null,
  }));

  if (dryRun) {
    const top = [...mapped].sort((a, b) => b.impressions - a.impressions).slice(0, 10);
    console.log(JSON.stringify({ count: mapped.length, top10_by_impressions: top }, null, 2));
    return;
  }

  const db = ensureDb();
  const stmt = db.prepare(`
    INSERT INTO gsc_queries_daily (date, query, page, clicks, impressions, ctr, position, ingested_at)
    VALUES (@date, @query, @page, @clicks, @impressions, @ctr, @position, datetime('now'))
    ON CONFLICT(date, query, page) DO UPDATE SET
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      ctr = excluded.ctr,
      position = excluded.position,
      ingested_at = excluded.ingested_at
  `);
  const tx = db.transaction(rs => { for (const r of rs) stmt.run(r); });
  tx(mapped);
  db.close();
  console.error(`[gsc] upserted ${mapped.length} rows → ${DB_PATH}`);
})();
