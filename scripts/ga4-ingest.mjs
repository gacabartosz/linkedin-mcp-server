#!/usr/bin/env node
/**
 * GA4 ingest — pulls daily pageviews, conversion events, and top landing pages
 * for bartoszgaca.pl (property 515884620), upserts into ~/.linkedin-mcp/content.db.
 *
 * Auth: service account JSON at GA4_SA_PATH env (default ~/.config/gcloud/ga4-service-account.json
 * locally, or /etc/linkedin-mcp/ga4-sa.json in container).
 *
 * Usage:
 *   node scripts/ga4-ingest.mjs                    # default: last 7 days
 *   node scripts/ga4-ingest.mjs --days=30          # custom range
 *   node scripts/ga4-ingest.mjs --dry-run          # print, don't write
 *   node scripts/ga4-ingest.mjs --query=pageviews  # one query type
 *
 * Verification: counts within ±5% of GA4 UI (sampling tolerance).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '515884620';
const SA_PATH = process.env.GA4_SA_PATH || join(homedir(), '.config/gcloud/ga4-service-account.json');
const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const DB_PATH = join(DATA_DIR, 'content.db');

const args = process.argv.slice(2);
const flagVal = (name, dflt) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const dryRun = args.includes('--dry-run');
const days = parseInt(flagVal('days', '7'), 10);
const queryFilter = flagVal('query', null); // pageviews | events | landing | null=all

if (!existsSync(SA_PATH)) {
  console.error(`FATAL: GA4 service account not found at ${SA_PATH}`);
  console.error('Set GA4_SA_PATH env or place file at default path.');
  process.exit(2);
}

const client = new BetaAnalyticsDataClient({ keyFilename: SA_PATH });

function ensureDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ga4_pageviews_daily (
      date TEXT NOT NULL, page_path TEXT NOT NULL, page_title TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      active_users INTEGER NOT NULL DEFAULT 0,
      avg_engagement_seconds REAL,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (date, page_path)
    );
    CREATE INDEX IF NOT EXISTS idx_ga4_pv_date ON ga4_pageviews_daily(date);
    CREATE INDEX IF NOT EXISTS idx_ga4_pv_views ON ga4_pageviews_daily(views DESC);

    CREATE TABLE IF NOT EXISTS ga4_events_daily (
      date TEXT NOT NULL, event_name TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      total_users INTEGER NOT NULL DEFAULT 0,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (date, event_name)
    );

    CREATE TABLE IF NOT EXISTS ga4_landing_daily (
      date TEXT NOT NULL, landing_page TEXT NOT NULL,
      sessions INTEGER NOT NULL DEFAULT 0,
      bounce_rate REAL,
      avg_session_duration REAL,
      conversions REAL DEFAULT 0,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (date, landing_page)
    );
  `);
  return db;
}

function dateRange(days) {
  return { startDate: `${days}daysAgo`, endDate: 'yesterday' };
}

async function runReport(req) {
  const [resp] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    ...req,
  });
  return resp;
}

async function ingestPageviews(db) {
  console.error(`[pageviews] last ${days}d…`);
  const resp = await runReport({
    dateRanges: [dateRange(days)],
    dimensions: [{ name: 'date' }, { name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
    ],
    limit: 10_000,
  });
  const rows = (resp.rows || []).map(r => ({
    date: formatGa4Date(r.dimensionValues[0].value),
    page_path: r.dimensionValues[1].value,
    page_title: r.dimensionValues[2].value,
    views: parseInt(r.metricValues[0].value, 10),
    active_users: parseInt(r.metricValues[1].value, 10),
    avg_engagement_seconds: parseFloat(r.metricValues[2].value),
  }));
  if (dryRun) {
    console.log(JSON.stringify({ table: 'ga4_pageviews_daily', count: rows.length, sample: rows.slice(0, 3) }, null, 2));
    return rows.length;
  }
  const stmt = db.prepare(`
    INSERT INTO ga4_pageviews_daily (date, page_path, page_title, views, active_users, avg_engagement_seconds, ingested_at)
    VALUES (@date, @page_path, @page_title, @views, @active_users, @avg_engagement_seconds, datetime('now'))
    ON CONFLICT(date, page_path) DO UPDATE SET
      page_title = excluded.page_title,
      views = excluded.views,
      active_users = excluded.active_users,
      avg_engagement_seconds = excluded.avg_engagement_seconds,
      ingested_at = excluded.ingested_at
  `);
  const tx = db.transaction(rs => { for (const r of rs) stmt.run(r); });
  tx(rows);
  console.error(`[pageviews] upserted ${rows.length} rows`);
  return rows.length;
}

async function ingestEvents(db) {
  console.error(`[events] last ${days}d…`);
  const resp = await runReport({
    dateRanges: [dateRange(days)],
    dimensions: [{ name: 'date' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    limit: 10_000,
  });
  const rows = (resp.rows || []).map(r => ({
    date: formatGa4Date(r.dimensionValues[0].value),
    event_name: r.dimensionValues[1].value,
    event_count: parseInt(r.metricValues[0].value, 10),
    total_users: parseInt(r.metricValues[1].value, 10),
  }));
  if (dryRun) {
    console.log(JSON.stringify({ table: 'ga4_events_daily', count: rows.length, sample: rows.slice(0, 3) }, null, 2));
    return rows.length;
  }
  const stmt = db.prepare(`
    INSERT INTO ga4_events_daily (date, event_name, event_count, total_users, ingested_at)
    VALUES (@date, @event_name, @event_count, @total_users, datetime('now'))
    ON CONFLICT(date, event_name) DO UPDATE SET
      event_count = excluded.event_count,
      total_users = excluded.total_users,
      ingested_at = excluded.ingested_at
  `);
  const tx = db.transaction(rs => { for (const r of rs) stmt.run(r); });
  tx(rows);
  console.error(`[events] upserted ${rows.length} rows`);
  return rows.length;
}

async function ingestLanding(db) {
  console.error(`[landing] last ${days}d…`);
  const resp = await runReport({
    dateRanges: [dateRange(days)],
    dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }],
    metrics: [
      { name: 'sessions' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
      { name: 'conversions' },
    ],
    limit: 5_000,
  });
  const rows = (resp.rows || []).map(r => ({
    date: formatGa4Date(r.dimensionValues[0].value),
    landing_page: r.dimensionValues[1].value,
    sessions: parseInt(r.metricValues[0].value, 10),
    bounce_rate: parseFloat(r.metricValues[1].value),
    avg_session_duration: parseFloat(r.metricValues[2].value),
    conversions: parseFloat(r.metricValues[3].value),
  }));
  if (dryRun) {
    console.log(JSON.stringify({ table: 'ga4_landing_daily', count: rows.length, sample: rows.slice(0, 3) }, null, 2));
    return rows.length;
  }
  const stmt = db.prepare(`
    INSERT INTO ga4_landing_daily (date, landing_page, sessions, bounce_rate, avg_session_duration, conversions, ingested_at)
    VALUES (@date, @landing_page, @sessions, @bounce_rate, @avg_session_duration, @conversions, datetime('now'))
    ON CONFLICT(date, landing_page) DO UPDATE SET
      sessions = excluded.sessions,
      bounce_rate = excluded.bounce_rate,
      avg_session_duration = excluded.avg_session_duration,
      conversions = excluded.conversions,
      ingested_at = excluded.ingested_at
  `);
  const tx = db.transaction(rs => { for (const r of rs) stmt.run(r); });
  tx(rows);
  console.error(`[landing] upserted ${rows.length} rows`);
  return rows.length;
}

function formatGa4Date(yyyymmdd) {
  // GA4 returns "20260502" → "2026-05-02"
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

(async () => {
  const db = dryRun ? null : ensureDb();
  const total = { pageviews: 0, events: 0, landing: 0 };
  try {
    if (!queryFilter || queryFilter === 'pageviews') total.pageviews = await ingestPageviews(db);
    if (!queryFilter || queryFilter === 'events') total.events = await ingestEvents(db);
    if (!queryFilter || queryFilter === 'landing') total.landing = await ingestLanding(db);
    console.error(`\n[done] ${JSON.stringify(total)} ${dryRun ? '(DRY RUN — nothing written)' : `→ ${DB_PATH}`}`);
  } catch (err) {
    console.error('FATAL:', err?.message || err);
    process.exit(1);
  } finally {
    if (db) db.close();
  }
})();
