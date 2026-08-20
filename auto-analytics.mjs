#!/usr/bin/env node
/**
 * LinkedIn Auto-Analytics v2 — Snowball Edition
 *
 * Direct imports from compiled dist/ — no subprocess spawning.
 * Smart scheduling: different collections on different days.
 * Snowball data growth: each run discovers more to collect next time.
 *
 * Schedule: daily 22:00 via LaunchAgent
 * Usage: node auto-analytics.mjs [--force-day=monday] [--dry-run]
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. IMPORTS + CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

// Direct imports from compiled TypeScript — no subprocess spawning
import { loadScraperAuth } from './dist/scraper/voyager.js';
import { getNetworkInfo, getProfileViews } from './dist/scraper/network.js';
import { getPostMetricsBatch, getPostReactors } from './dist/api/social-metadata.js';
import { searchPeople } from './dist/scraper/search.js';
import { getPersonPosts } from './dist/scraper/activity.js';
import { buildSnapshot } from './lib/analytics-snapshot.mjs';

const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const DB_PATH = join(homedir(), '.linkedin-mcp', 'analytics.db');
const SCHEDULER_DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const PROSPECTS_DB = join(homedir(), '.linkedin-mcp', 'prospects.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const LOG_DIR = join(MCP_DIR, 'output', 'linkedin-mcp');
const LOG_FILE = join(LOG_DIR, 'auto-analytics.log');
const PUBLIC_ID = 'bartoszgaca';
const PERSON_URN = 'urn:li:person:FihAwG4y_B';

// CLI flags
const args = process.argv.slice(2);
const forceDayFlag = args.find(a => a.startsWith('--force-day='));
const forceDay = forceDayFlag ? forceDayFlag.split('=')[1].toLowerCase() : null;
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATABASE — ensureDb() with all tables
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    -- Original tables (preserved)
    CREATE TABLE IF NOT EXISTS social_metadata (
      post_urn TEXT PRIMARY KEY,
      like_count INTEGER DEFAULT 0,
      praise_count INTEGER DEFAULT 0,
      empathy_count INTEGER DEFAULT 0,
      interest_count INTEGER DEFAULT 0,
      appreciation_count INTEGER DEFAULT 0,
      entertainment_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      comment_top_level INTEGER DEFAULT 0,
      fetched_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS post_metrics (
      post_urn TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      date TEXT DEFAULT 'TOTAL',
      fetched_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_urn, metric_type, date)
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      follower_count INTEGER,
      profile_views INTEGER,
      posts_published INTEGER,
      total_impressions INTEGER,
      total_reactions INTEGER,
      avg_engagement_rate REAL
    );
    CREATE TABLE IF NOT EXISTS weekly_report (
      week_start TEXT PRIMARY KEY,
      top_post_urn TEXT,
      top_post_reactions INTEGER,
      total_reactions INTEGER,
      follower_delta INTEGER,
      posts_count INTEGER,
      avg_engagement_rate REAL,
      content_mix TEXT,
      report_text TEXT
    );
    CREATE TABLE IF NOT EXISTS post_metrics_history (
      post_urn TEXT NOT NULL, date TEXT NOT NULL,
      impressions INTEGER DEFAULT 0, members_reached INTEGER DEFAULT 0,
      reactions INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, reshares INTEGER DEFAULT 0,
      fetched_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (post_urn, date)
    );
    CREATE TABLE IF NOT EXISTS reaction_type_daily (
      date TEXT NOT NULL, reaction_type TEXT NOT NULL, count INTEGER DEFAULT 0,
      PRIMARY KEY (date, reaction_type)
    );
    CREATE TABLE IF NOT EXISTS content_type_map (
      post_urn TEXT PRIMARY KEY, content_type TEXT DEFAULT 'text',
      post_length INTEGER DEFAULT 0, publish_hour INTEGER, publish_day_of_week INTEGER,
      language TEXT, hashtag_count INTEGER DEFAULT 0, hashtags TEXT DEFAULT '[]',
      classified_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS follower_deltas (
      date TEXT PRIMARY KEY, follower_count INTEGER, delta INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS top_engagers (
      person_urn TEXT PRIMARY KEY, name TEXT DEFAULT '', headline TEXT DEFAULT '', public_id TEXT DEFAULT '',
      reaction_count INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
      total_engagements INTEGER DEFAULT 0, last_engagement_at TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS network_demographics (
      category TEXT NOT NULL, value TEXT NOT NULL, count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (category, value)
    );
    CREATE TABLE IF NOT EXISTS hashtag_performance (
      hashtag TEXT PRIMARY KEY, usage_count INTEGER DEFAULT 0,
      avg_reactions REAL DEFAULT 0, avg_impressions REAL DEFAULT 0, avg_comments REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- v2 tables: snowball growth
    CREATE TABLE IF NOT EXISTS collection_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      priority INTEGER DEFAULT 5,
      discovered_from TEXT,
      collected_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(item_type, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_queue_pending ON collection_queue(item_type, priority DESC) WHERE collected_at IS NULL;

    CREATE TABLE IF NOT EXISTS data_health (
      metric TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audience_insights (
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      source TEXT DEFAULT 'reactors',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (category, value)
    );
  `);

  return db;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HELPERS — log, notify, sendTelegram, health tracking
// ═══════════════════════════════════════════════════════════════════════════════

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function notify(title, body) {
  try {
    const safe = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}"'`);
  } catch {}
}

function sendTelegram(text) {
  const cfgPath = join(homedir(), '.linkedin-mcp', 'telegram.json');
  if (!existsSync(cfgPath)) return;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chat_id, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    }).catch(() => {});
  } catch {}
}

/** Track a health metric in the DB */
function trackHealth(db, metric, value) {
  db.prepare(`
    INSERT INTO data_health (metric, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(metric) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(metric, String(value));
}

/** Increment a numeric health metric */
function incrementHealth(db, metric, delta = 1) {
  const current = db.prepare('SELECT value FROM data_health WHERE metric = ?').get(metric);
  const newVal = (parseInt(current?.value || '0', 10) || 0) + delta;
  trackHealth(db, metric, newVal);
}

/** Add item to collection queue (skip duplicates) */
function enqueue(db, itemType, itemId, discoveredFrom, priority = 5) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO collection_queue (item_type, item_id, priority, discovered_from)
      VALUES (?, ?, ?, ?)
    `).run(itemType, itemId, priority, discoveredFrom);
  } catch {}
}

/** Mark queue item as collected */
function markCollected(db, itemType, itemId) {
  db.prepare(`
    UPDATE collection_queue SET collected_at = datetime('now')
    WHERE item_type = ? AND item_id = ?
  `).run(itemType, itemId);
}

/** Get pending queue items */
function getPendingQueue(db, itemType, limit = 10) {
  return db.prepare(`
    SELECT * FROM collection_queue
    WHERE item_type = ? AND collected_at IS NULL
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).all(itemType, limit);
}

/** Safe wrapper for API calls with error counting */
async function safeCall(db, label, fn) {
  try {
    const result = await fn();
    incrementHealth(db, 'total_api_calls_today');
    return result;
  } catch (err) {
    log(`[ERROR] ${label}: ${err.message}`);
    incrementHealth(db, 'errors_today');
    return null;
  }
}

/** Get the day name for scheduling logic */
function getDayName(date) {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. COLLECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DAILY: Collect post metrics for all published posts via Official API batch.
 * Returns { totalReactions, totalComments, postCount }
 */
async function collectPostMetrics(db) {
  log('--- Collecting post metrics (Official API batch) ---');

  const schedulerDb = new Database(SCHEDULER_DB, { readonly: true });
  const published = schedulerDb.prepare(
    "SELECT post_urn, publish_at, text FROM scheduled_posts WHERE status = 'published' AND post_urn IS NOT NULL ORDER BY publish_at DESC LIMIT 30"
  ).all();
  schedulerDb.close();

  const urns = published.map(p => p.post_urn).filter(Boolean);
  if (urns.length === 0) {
    log('No published posts to track');
    return { totalReactions: 0, totalComments: 0, postCount: 0, published: [] };
  }

  log(`Fetching metrics for ${urns.length} posts`);

  const batchResult = await safeCall(db, 'getPostMetricsBatch', () =>
    getPostMetricsBatch(urns.slice(0, 20))
  );

  if (!batchResult || batchResult.length === 0) {
    log('Post metrics batch empty — falling back to reactors count');
    // Fallback: count reactions from reactors endpoint (which still works with w_member_social)
    let totalReactions = 0;
    const upsertFallback = db.prepare(`
      INSERT OR REPLACE INTO social_metadata
      (post_urn, like_count, praise_count, empathy_count, interest_count, appreciation_count, entertainment_count, comment_count, comment_top_level, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const urn of urns.slice(0, 10)) {
      const rResult = await safeCall(db, 'getPostReactors-fallback', () => getPostReactors(urn, 100));
      if (rResult && rResult.reactors) {
        const typeCounts = {};
        for (const r of rResult.reactors) {
          typeCounts[r.reaction_type] = (typeCounts[r.reaction_type] || 0) + 1;
        }
        upsertFallback.run(
          urn,
          typeCounts.LIKE || 0, typeCounts.PRAISE || 0, typeCounts.EMPATHY || 0,
          typeCounts.INTEREST || 0, typeCounts.APPRECIATION || 0, typeCounts.ENTERTAINMENT || 0,
          0, 0 // comments not available from reactors
        );
        totalReactions += rResult.total || rResult.reactors.length;
        log(`  ${urn.slice(-10)}: ${rResult.total || rResult.reactors.length} reactions`);
      }
    }
    log(`Fallback: collected ${totalReactions} reactions from ${Math.min(urns.length, 10)} posts`);
    return { totalReactions, totalComments: 0, postCount: Math.min(urns.length, 10), published };
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO social_metadata
    (post_urn, like_count, praise_count, empathy_count, interest_count, appreciation_count, entertainment_count, comment_count, comment_top_level, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let totalReactions = 0;
  let totalComments = 0;

  const insertMany = db.transaction((posts) => {
    for (const p of posts) {
      const r = p.reactions || {};
      upsert.run(
        p.post_urn,
        r.LIKE || 0, r.PRAISE || 0, r.EMPATHY || 0,
        r.INTEREST || 0, r.APPRECIATION || 0, r.ENTERTAINMENT || 0,
        p.comments || 0, p.comments_top_level || 0
      );
      totalReactions += p.total_reactions || 0;
      totalComments += p.comments || 0;
    }
  });
  insertMany(batchResult);

  log(`Saved metrics for ${batchResult.length} posts: ${totalReactions} reactions, ${totalComments} comments`);
  return { totalReactions, totalComments, postCount: batchResult.length, published };
}

/**
 * DAILY: Collect follower count and profile views via Voyager.
 */
async function collectNetworkStats(db) {
  log('--- Collecting network stats (Voyager) ---');

  let followerCount = 0;
  let connectionCount = 0;
  let profileViews = 0;
  // Staleness flags: true means the value below is a stale fallback, NOT a fresh fetch.
  // Critical: never let a fallback value be persisted as if it were real (past bug — frozen series).
  let followerStale = false;
  let viewsStale = false;

  const network = await safeCall(db, 'getNetworkInfo', () => getNetworkInfo(PUBLIC_ID));
  if (network && network.follower_count > 0) {
    followerCount = network.follower_count;
    connectionCount = network.connection_count || 0;
    log(`Followers: ${followerCount}, Connections: ${connectionCount}`);
  } else {
    // Fallback: reuse last known value ONLY for continuity, but flag it as stale.
    const lastKnown = db.prepare('SELECT follower_count FROM daily_stats WHERE follower_count > 0 ORDER BY date DESC LIMIT 1').get();
    if (lastKnown) {
      followerCount = lastKnown.follower_count;
      followerStale = true;
      log(`Voyager unavailable — last known follower count (STALE, flagged): ${followerCount}`);
    }
  }

  const views = await safeCall(db, 'getProfileViews', () => getProfileViews(PUBLIC_ID));
  if (views && views.total_views > 0) {
    profileViews = views.total_views;
    log(`Profile views: ${profileViews}`);
  } else {
    // Endpoint is permanently 410 Gone. NEVER carry forward the last-known value —
    // that produced a self-perpetuating fabricated constant (e.g. 38 every day).
    // Record NULL + flag; the dashboard and LLM export render it as "unavailable".
    profileViews = null;
    viewsStale = true;
    log('Profile views unavailable (LinkedIn endpoint 410 Gone) — persisting NULL, not fabricating.');
  }

  return { followerCount, connectionCount, profileViews, followerStale, viewsStale };
}

/**
 * DAILY: Save daily stats row, follower deltas, reaction types, post metrics history.
 */
function saveDailyAggregates(db, today, followerCount, profileViews, totalReactions, totalComments, meta = {}) {
  log('--- Saving daily aggregates ---');

  const { followerStale = false, viewsStale = false } = meta;
  // Row-level staleness marker for the follower series (the one the dashboard trusts).
  // dashboard.mjs reads is_stale to exclude fabricated/frozen rows from growth + KPI.
  const rowStale = followerStale ? 1 : 0;
  const staleReason = followerStale
    ? 'follower_fallback_frozen'
    : (viewsStale ? 'profileviews_endpoint_dead' : null);

  // data_health flags drive the dashboard staleness banner.
  trackHealth(db, 'followers_stale', followerStale ? '1' : '0');
  trackHealth(db, 'profileviews_stale', viewsStale ? '1' : '0');
  if (!followerStale) trackHealth(db, 'followers_last_real_date', today);
  if (!viewsStale) trackHealth(db, 'profileviews_last_real_date', today);

  // Posts published today
  let pubToday = 0;
  try {
    const schedulerDb = new Database(SCHEDULER_DB, { readonly: true });
    const row = schedulerDb.prepare(
      "SELECT COUNT(*) as cnt FROM scheduled_posts WHERE status = 'published' AND publish_at LIKE ?"
    ).get(today + '%');
    schedulerDb.close();
    pubToday = row?.cnt || 0;
  } catch {}

  const engRate = totalReactions > 0 && followerCount > 0
    ? ((totalReactions + totalComments) / Math.max(followerCount, 1) * 100).toFixed(1)
    : '0.0';

  // total_impressions: sum of freshly scraped per-post impressions (creator_top_posts).
  // Official socialMetadata/profileView endpoints are dead (403/410), so this is the only
  // real impressions source. 0 if no fresh scrape exists.
  let totalImpressions = 0;
  try {
    const impr = db.prepare("SELECT SUM(impressions) AS s FROM creator_top_posts WHERE date(scraped_at) = ?").get(today);
    totalImpressions = impr?.s || 0;
  } catch {}

  // daily_stats — now carries is_stale/stale_reason so fabricated fallback rows are
  // distinguishable from real fetches (root-cause fix for the frozen-series bug).
  db.prepare(`
    INSERT OR REPLACE INTO daily_stats (date, follower_count, profile_views, posts_published, total_reactions, total_impressions, avg_engagement_rate, is_stale, stale_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(today, followerCount, profileViews, pubToday, totalReactions, totalImpressions, parseFloat(engRate), rowStale, staleReason);

  // 365-d wykres followers świeży MIĘDZY eksportami XLSX: dopisz dzisiejszy punkt do creator_analytics
  // (źródło wykresu w dashboardzie). Tylko realny fetch (nie stale fallback). Impressions/engagements
  // zostają z importu XLSX — per-post scrape jest zbyt szumny na dzienny total.
  try {
    if (!followerStale && followerCount > 0) {
      const prev = db.prepare("SELECT value FROM creator_analytics WHERE metric='followers' AND chart_type='cumulative' AND date < ? ORDER BY date DESC LIMIT 1").get(today);
      const ca = db.prepare("INSERT OR REPLACE INTO creator_analytics (date, metric, chart_type, value, scraped_at) VALUES (?, 'followers', ?, ?, datetime('now'))");
      ca.run(today, 'cumulative', followerCount);
      ca.run(today, 'daily', prev ? Math.max(followerCount - prev.value, 0) : 0);
    }
  } catch (e) { log(`creator_analytics daily append: ${e.message}`); }

  // follower_deltas — only meaningful when the follower count is a REAL fetch.
  // A stale fallback would otherwise produce a fake 0 (or a fake jump on the next real day).
  try {
    if (followerStale) {
      db.prepare("INSERT OR REPLACE INTO follower_deltas (date, follower_count, delta) VALUES (?, ?, NULL)").run(today, followerCount);
      log('Follower delta: skipped (stale follower count)');
    } else {
      const prevDay = db.prepare("SELECT follower_count FROM daily_stats WHERE date < ? AND is_stale = 0 ORDER BY date DESC LIMIT 1").get(today);
      const delta = prevDay ? followerCount - (prevDay.follower_count || 0) : 0;
      db.prepare("INSERT OR REPLACE INTO follower_deltas (date, follower_count, delta) VALUES (?, ?, ?)").run(today, followerCount, delta);
      log(`Follower delta: ${delta >= 0 ? '+' : ''}${delta}`);
    }
  } catch (err) { log(`Follower delta error: ${err.message}`); }

  // reaction_type_daily — aggregate from all social_metadata
  try {
    const allSm = db.prepare("SELECT * FROM social_metadata").all();
    const typeSums = { LIKE: 0, PRAISE: 0, EMPATHY: 0, INTEREST: 0, APPRECIATION: 0, ENTERTAINMENT: 0 };
    for (const sm of allSm) {
      typeSums.LIKE += sm.like_count || 0;
      typeSums.PRAISE += sm.praise_count || 0;
      typeSums.EMPATHY += sm.empathy_count || 0;
      typeSums.INTEREST += sm.interest_count || 0;
      typeSums.APPRECIATION += sm.appreciation_count || 0;
      typeSums.ENTERTAINMENT += sm.entertainment_count || 0;
    }
    const rxUpsert = db.prepare("INSERT OR REPLACE INTO reaction_type_daily (date, reaction_type, count) VALUES (?, ?, ?)");
    for (const [type, count] of Object.entries(typeSums)) {
      rxUpsert.run(today, type, count);
    }
    log(`Reaction types: LIKE=${typeSums.LIKE}, PRAISE=${typeSums.PRAISE}, INTEREST=${typeSums.INTEREST}`);
  } catch (err) { log(`Reaction type error: ${err.message}`); }

  // post_metrics_history — snapshot per-post totals
  try {
    const allSm = db.prepare("SELECT * FROM social_metadata").all();
    const pmhUpsert = db.prepare("INSERT OR REPLACE INTO post_metrics_history (post_urn, date, reactions, comments, fetched_at) VALUES (?, ?, ?, ?, datetime('now'))");
    for (const sm of allSm) {
      const rx = (sm.like_count || 0) + (sm.praise_count || 0) + (sm.empathy_count || 0)
        + (sm.interest_count || 0) + (sm.appreciation_count || 0) + (sm.entertainment_count || 0);
      pmhUpsert.run(sm.post_urn, today, rx, sm.comment_count || 0);
    }
    log(`Saved post metrics history for ${allSm.length} posts`);
  } catch (err) { log(`Post metrics history error: ${err.message}`); }

  return { engRate, pubToday };
}

/**
 * DAILY: Classify published posts by content type and compute hashtag performance.
 */
function classifyContent(db) {
  log('--- Classifying content types + hashtag performance ---');

  // Content type classification
  try {
    const schedulerDb = new Database(SCHEDULER_DB, { readonly: true });
    const allPublished = schedulerDb.prepare(
      "SELECT post_urn, text, publish_at, language, media_ids, article_url FROM scheduled_posts WHERE status = 'published' AND post_urn IS NOT NULL"
    ).all();
    schedulerDb.close();

    const ctUpsert = db.prepare(`
      INSERT OR IGNORE INTO content_type_map (post_urn, content_type, post_length, publish_hour, publish_day_of_week, language, hashtag_count, hashtags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let classified = 0;
    for (const p of allPublished) {
      let contentType = 'text';
      if (p.media_ids) {
        try { if (JSON.parse(p.media_ids).length > 0) contentType = 'image'; } catch {}
      }
      if (p.article_url) contentType = 'article';
      if (p.text && /carousel|slides?/i.test(p.text)) contentType = 'carousel';

      const hashtags = [];
      let match;
      const rx = /#(\w+)/g;
      while ((match = rx.exec(p.text || '')) !== null) hashtags.push(match[1].toLowerCase());

      let pubHour = null, pubDow = null;
      if (p.publish_at) {
        const d = new Date(p.publish_at);
        pubHour = d.getHours();
        pubDow = d.getDay();
        pubDow = pubDow === 0 ? 6 : pubDow - 1;
      }

      const result = ctUpsert.run(p.post_urn, contentType, (p.text || '').length, pubHour, pubDow, p.language || 'en', hashtags.length, JSON.stringify(hashtags));
      if (result.changes > 0) classified++;
    }
    if (classified > 0) log(`Classified ${classified} new posts`);
  } catch (err) { log(`Content type error: ${err.message}`); }

  // Hashtag performance
  try {
    const hashRows = db.prepare(`
      SELECT ctm.hashtags, sm.like_count, sm.praise_count, sm.empathy_count,
             sm.interest_count, sm.appreciation_count, sm.entertainment_count, sm.comment_count
      FROM content_type_map ctm JOIN social_metadata sm ON ctm.post_urn = sm.post_urn
      WHERE ctm.hashtags != '[]'
    `).all();

    const hashStats = {};
    for (const r of hashRows) {
      let tags;
      try { tags = JSON.parse(r.hashtags); } catch { continue; }
      const reactions = (r.like_count || 0) + (r.praise_count || 0) + (r.empathy_count || 0)
        + (r.interest_count || 0) + (r.appreciation_count || 0) + (r.entertainment_count || 0);
      for (const tag of tags) {
        if (!hashStats[tag]) hashStats[tag] = { count: 0, totalReactions: 0, totalComments: 0 };
        hashStats[tag].count++;
        hashStats[tag].totalReactions += reactions;
        hashStats[tag].totalComments += r.comment_count || 0;
      }
    }
    const hpUpsert = db.prepare("INSERT OR REPLACE INTO hashtag_performance (hashtag, usage_count, avg_reactions, avg_comments, updated_at) VALUES (?, ?, ?, ?, datetime('now'))");
    for (const [tag, stats] of Object.entries(hashStats)) {
      hpUpsert.run(tag, stats.count, Math.round(stats.totalReactions / stats.count * 10) / 10, Math.round(stats.totalComments / stats.count * 10) / 10);
    }
    if (Object.keys(hashStats).length > 0) log(`Updated ${Object.keys(hashStats).length} hashtag records`);
  } catch (err) { log(`Hashtag performance error: ${err.message}`); }
}

/**
 * MON/THU: Collect top engagers — reactors from top 5 recent posts.
 * Snowball: discovered reactors get queued for profile scanning.
 */
async function collectTopEngagers(db, published) {
  log('--- Collecting top engagers (Official API reactors) ---');

  const recentPosts = (published || []).slice(0, 5);
  if (recentPosts.length === 0) {
    log('No recent posts for engager collection');
    return;
  }

  const engUpsert = db.prepare(`
    INSERT INTO top_engagers (person_urn, name, headline, public_id, reaction_count, comment_count, total_engagements, last_engagement_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, 1, datetime('now'), datetime('now'))
    ON CONFLICT(person_urn) DO UPDATE SET
      reaction_count = reaction_count + 1,
      total_engagements = total_engagements + 1,
      last_engagement_at = datetime('now'),
      updated_at = datetime('now'),
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE top_engagers.name END,
      headline = CASE WHEN excluded.headline != '' THEN excluded.headline ELSE top_engagers.headline END
  `);

  let totalEngagers = 0;

  for (const post of recentPosts) {
    const result = await safeCall(db, `getPostReactors(${post.post_urn})`, () =>
      getPostReactors(post.post_urn, 10)
    );

    if (!result?.reactors) continue;

    for (const reactor of result.reactors) {
      const personUrn = reactor.person_urn || '';
      if (!personUrn) continue;

      engUpsert.run(personUrn, '', '', '', );
      totalEngagers++;

      // SNOWBALL: queue reactor profiles for future scanning
      enqueue(db, 'reactor', personUrn, `post:${post.post_urn}`, 3);
    }

    // Rate-limit friendly: small pause between posts
    await new Promise(r => setTimeout(r, 1000));
  }

  if (totalEngagers > 0) {
    log(`Updated ${totalEngagers} engager records from ${recentPosts.length} posts`);
    const queuedNew = db.prepare("SELECT COUNT(*) as cnt FROM collection_queue WHERE item_type = 'reactor' AND collected_at IS NULL").get();
    log(`Reactor queue: ${queuedNew.cnt} pending for future scanning`);
  }
}

/**
 * TUE/FRI: Scan prospect activity — check 10 prospects from prospects.db.
 * Snowball: interesting posts get queued for deeper analysis.
 */
async function scanProspectActivity(db) {
  log('--- Scanning prospect activity (Voyager) ---');

  if (!existsSync(PROSPECTS_DB)) {
    log('No prospects.db found, skipping');
    return;
  }

  const prospectsDb = new Database(PROSPECTS_DB, { readonly: true });
  // Pick prospects: oldest-scanned first, max 10
  const prospects = prospectsDb.prepare(`
    SELECT public_id, name, id FROM prospects
    ORDER BY COALESCE(last_scanned_at, '2000-01-01') ASC
    LIMIT 10
  `).all();
  prospectsDb.close();

  if (prospects.length === 0) {
    log('No prospects to scan');
    return;
  }

  log(`Scanning ${prospects.length} prospects`);
  let scanned = 0;
  let activitiesFound = 0;

  for (const prospect of prospects) {
    const result = await safeCall(db, `getPersonPosts(${prospect.public_id})`, () =>
      getPersonPosts({ public_id: prospect.public_id, count: 5 })
    );

    if (!result?.activities) continue;
    scanned++;
    activitiesFound += result.activities.length;

    // SNOWBALL: queue interesting posts for collection
    for (const activity of result.activities) {
      if (activity.post_urn && (activity.likes_count || 0) > 10) {
        enqueue(db, 'post', activity.post_urn, `prospect:${prospect.public_id}`, 4);
      }
    }

    // Update last_scanned_at in prospects.db
    try {
      const pdb = new Database(PROSPECTS_DB);
      pdb.prepare("UPDATE prospects SET last_scanned_at = datetime('now') WHERE id = ?").run(prospect.id);
      pdb.close();
    } catch {}

    // Voyager rate limiting: pause between prospects (3-5s built into voyagerRequest,
    // but add a small buffer for safety)
    await new Promise(r => setTimeout(r, 500));
  }

  log(`Scanned ${scanned} prospects, found ${activitiesFound} activities`);
}

/**
 * WEDNESDAY: Competitor monitoring — check key employees at monitored companies.
 */
async function monitorCompetitors(db) {
  log('--- Monitoring competitors (Voyager) ---');

  if (!existsSync(PROSPECTS_DB)) {
    log('No prospects.db found, skipping competitor monitoring');
    return;
  }

  const prospectsDb = new Database(PROSPECTS_DB, { readonly: true });
  const companies = prospectsDb.prepare("SELECT * FROM monitored_companies ORDER BY name").all();
  prospectsDb.close();

  if (companies.length === 0) {
    log('No monitored companies found');
    return;
  }

  log(`Checking ${companies.length} competitor companies`);
  let totalActivities = 0;

  for (const company of companies) {
    // Search for key people at this company (CEO, CTO, founders, sales)
    const searchResult = await safeCall(db, `searchPeople(${company.name})`, () =>
      searchPeople({ company_id: company.company_id, keywords: 'CEO CTO founder', count: 3 })
    );

    if (!searchResult?.results) continue;

    for (const person of searchResult.results) {
      // Queue discovered employees for future scanning
      enqueue(db, 'profile', person.public_id, `competitor:${company.company_id}`, 6);

      // Scan their recent activity
      const activity = await safeCall(db, `getPersonPosts(${person.public_id})`, () =>
        getPersonPosts({ public_id: person.public_id, count: 3 })
      );

      if (!activity?.activities) continue;
      totalActivities += activity.activities.length;

      // Queue interesting competitor posts
      for (const act of activity.activities) {
        if (act.post_urn) {
          enqueue(db, 'post', act.post_urn, `competitor_employee:${person.public_id}`, 7);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  log(`Competitor monitoring found ${totalActivities} activities`);
}

/**
 * SUNDAY: Build audience insights from reactor data in top_engagers.
 */
function buildAudienceInsights(db) {
  log('--- Building audience insights ---');

  const engagers = db.prepare(`
    SELECT person_urn, name, headline, total_engagements
    FROM top_engagers
    WHERE headline != '' AND total_engagements > 0
    ORDER BY total_engagements DESC
  `).all();

  if (engagers.length === 0) {
    log('No engager data for audience insights');
    return;
  }

  const insights = { job_title: {}, company: {}, seniority: {} };

  // Seniority keywords
  const seniorityMap = {
    'C-Level': /\b(CEO|CTO|CFO|COO|CMO|CIO|CPO|Chief)\b/i,
    'VP': /\b(VP|Vice President)\b/i,
    'Director': /\bDirector\b/i,
    'Manager': /\b(Manager|Head of|Team Lead)\b/i,
    'Senior': /\bSenior\b/i,
    'Mid-Level': /\b(Specialist|Engineer|Developer|Analyst|Consultant)\b/i,
    'Junior': /\b(Junior|Associate|Intern|Trainee)\b/i,
  };

  for (const eng of engagers) {
    const h = eng.headline || '';

    // Extract seniority
    for (const [level, regex] of Object.entries(seniorityMap)) {
      if (regex.test(h)) {
        insights.seniority[level] = (insights.seniority[level] || 0) + eng.total_engagements;
        break;
      }
    }

    // Extract company from headline (often "Title at Company")
    const atMatch = h.match(/(?:at|@|w\/|,)\s+(.+?)(?:\s*[|]|$)/i);
    if (atMatch) {
      const company = atMatch[1].trim().slice(0, 60);
      if (company.length > 2) {
        insights.company[company] = (insights.company[company] || 0) + eng.total_engagements;
      }
    }

    // Use first part of headline as rough job title
    const titlePart = h.split(/\s+(?:at|@|,|\|)\s+/i)[0].trim().slice(0, 80);
    if (titlePart.length > 3) {
      insights.job_title[titlePart] = (insights.job_title[titlePart] || 0) + eng.total_engagements;
    }
  }

  // Upsert into audience_insights
  const upsert = db.prepare(`
    INSERT INTO audience_insights (category, value, count, source, updated_at)
    VALUES (?, ?, ?, 'reactors', datetime('now'))
    ON CONFLICT(category, value) DO UPDATE SET
      count = excluded.count, updated_at = excluded.updated_at
  `);

  let total = 0;
  for (const [category, values] of Object.entries(insights)) {
    // Keep top 50 per category
    const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 50);
    for (const [value, count] of sorted) {
      upsert.run(category, value, count);
      total++;
    }
  }

  log(`Audience insights: ${total} entries across ${Object.keys(insights).length} categories (from ${engagers.length} engagers)`);
}

/**
 * SUNDAY: Generate weekly report.
 */
function generateWeeklyReport(db, today, followerCount, totalReactions, totalComments, engRate) {
  log('--- Generating weekly report ---');

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStart = weekAgo.toISOString().slice(0, 10);

  const prevStats = db.prepare("SELECT follower_count FROM daily_stats WHERE date <= ? ORDER BY date DESC LIMIT 1").get(weekStart);
  const followerDelta = followerCount - (prevStats?.follower_count || followerCount);

  const topPost = db.prepare(`
    SELECT post_urn, (like_count + praise_count + empathy_count + interest_count + appreciation_count + entertainment_count) as total
    FROM social_metadata ORDER BY total DESC LIMIT 1
  `).get();

  // Count posts this week
  let weekPosts = 0;
  try {
    const schedulerDb = new Database(SCHEDULER_DB, { readonly: true });
    const row = schedulerDb.prepare(
      "SELECT COUNT(*) as cnt FROM scheduled_posts WHERE status = 'published' AND publish_at >= ?"
    ).get(weekStart);
    schedulerDb.close();
    weekPosts = row?.cnt || 0;
  } catch {}

  // Queue stats
  const queuePending = db.prepare("SELECT COUNT(*) as cnt FROM collection_queue WHERE collected_at IS NULL").get();
  const queueProcessed = db.prepare("SELECT COUNT(*) as cnt FROM collection_queue WHERE collected_at IS NOT NULL").get();
  const engagerCount = db.prepare("SELECT COUNT(*) as cnt FROM top_engagers").get();

  // Top audience segments
  let audienceSummary = '';
  try {
    const topSeniority = db.prepare("SELECT value, count FROM audience_insights WHERE category = 'seniority' ORDER BY count DESC LIMIT 3").all();
    if (topSeniority.length > 0) {
      audienceSummary = '\nAudience: ' + topSeniority.map(r => `${r.value}(${r.count})`).join(', ');
    }
  } catch {}

  const reportText = [
    '*LinkedIn Weekly Report*',
    '',
    `Followers: ${followerCount} (${followerDelta >= 0 ? '+' : ''}${followerDelta})`,
    `Posts this week: ${weekPosts}`,
    `Total reactions: ${totalReactions}`,
    `Comments: ${totalComments}`,
    `Top post: ${topPost?.total || 0} reactions`,
    `Engagement: ${engRate}%`,
    `Engagers tracked: ${engagerCount?.cnt || 0}`,
    `Queue: ${queuePending?.cnt || 0} pending, ${queueProcessed?.cnt || 0} processed`,
    audienceSummary,
  ].filter(Boolean).join('\n');

  db.prepare(`
    INSERT OR REPLACE INTO weekly_report (week_start, top_post_urn, top_post_reactions, total_reactions, follower_delta, posts_count, avg_engagement_rate, report_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(weekStart, topPost?.post_urn || '', topPost?.total || 0, totalReactions, followerDelta, weekPosts, parseFloat(engRate), reportText);

  sendTelegram(reportText);
  log('Weekly report generated and sent');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SNOWBALL QUEUE PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Process pending items from the collection queue.
 * Runs a limited batch each day to stay within rate limits.
 */
async function processQueue(db) {
  log('--- Processing collection queue ---');

  const pending = db.prepare("SELECT COUNT(*) as cnt FROM collection_queue WHERE collected_at IS NULL").get();
  log(`Queue has ${pending.cnt} pending items`);

  if (pending.cnt === 0) return;

  // Process up to 5 reactor profiles per run (they use Voyager, expensive)
  const reactorQueue = getPendingQueue(db, 'reactor', 5);
  let reactorsProcessed = 0;

  for (const item of reactorQueue) {
    // For reactors, we try to resolve their profile info via search
    // This is lightweight — just queue them as profiles for deeper scan later
    const personUrn = item.item_id;

    // Already in top_engagers? Mark as collected.
    const existing = db.prepare("SELECT person_urn FROM top_engagers WHERE person_urn = ?").get(personUrn);
    if (existing) {
      markCollected(db, 'reactor', personUrn);
      reactorsProcessed++;
      continue;
    }

    // Queue as profile for future deep scan
    enqueue(db, 'profile', personUrn, item.discovered_from, 2);
    markCollected(db, 'reactor', personUrn);
    reactorsProcessed++;
  }

  if (reactorsProcessed > 0) log(`Processed ${reactorsProcessed} reactor queue items`);

  // Process up to 3 profile scans per run
  const profileQueue = getPendingQueue(db, 'profile', 3);
  let profilesProcessed = 0;

  for (const item of profileQueue) {
    const publicId = item.item_id;

    // Try to get their activity
    const result = await safeCall(db, `queue:getPersonPosts(${publicId})`, () =>
      getPersonPosts({ public_id: publicId, count: 3 })
    );

    markCollected(db, 'profile', publicId);
    profilesProcessed++;

    if (result?.activities) {
      for (const act of result.activities) {
        if (act.post_urn && (act.likes_count || 0) > 5) {
          enqueue(db, 'post', act.post_urn, `profile:${publicId}`, 2);
        }
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  if (profilesProcessed > 0) log(`Processed ${profilesProcessed} profile queue items`);

  // Summary
  const remaining = db.prepare("SELECT COUNT(*) as cnt FROM collection_queue WHERE collected_at IS NULL").get();
  log(`Queue remaining: ${remaining.cnt} items`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SMART SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════════

function getSchedule(dayName) {
  // Every day: post metrics, network stats, daily aggregates, content classify, queue processing
  const schedule = {
    collectPostMetrics: true,
    collectNetworkStats: true,
    saveDailyAggregates: true,
    classifyContent: true,
    processQueue: true,
  };

  // Mon/Thu: top engagers (post_reactors for top 5 posts)
  if (['monday', 'thursday'].includes(dayName)) {
    schedule.collectTopEngagers = true;
  }

  // PROSPECTING WYŁĄCZONY (decyzja usera 2026-06): scanProspectActivity (Tue/Fri) + monitorCompetitors (Wed)
  // robiły większość nieudanych calli (FACETED_SEARCH "CEO CTO" → 0 wyników, getPostReactors 404). To lead-gen,
  // nie analityka, którą oglądasz na dashboardzie. Funkcje zostają w kodzie — odkomentuj, by przywrócić.
  // if (['tuesday', 'friday'].includes(dayName)) schedule.scanProspectActivity = true;
  // if (dayName === 'wednesday') schedule.monitorCompetitors = true;

  // Sunday: full weekly report + audience insights + demographic survey
  if (dayName === 'sunday') {
    schedule.buildAudienceInsights = true;
    schedule.generateWeeklyReport = true;
  }

  return schedule;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();
  log('=== LinkedIn Auto-Analytics v2 starting ===');

  // Validate auth
  const auth = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
  if (new Date(auth.expires_at) < new Date()) {
    log('Auth token expired — skipping analytics run');
    notify('LinkedIn Analytics', 'Auth expired — skipping');
    return;
  }

  // Set env vars for Official API calls (used by linkedinRequest in client.js)
  process.env.LINKEDIN_ACCESS_TOKEN = auth.access_token;
  process.env.LINKEDIN_PERSON_URN = auth.person_urn || PERSON_URN;

  // Verify Voyager auth is available (reads from scraper-auth.json automatically)
  const scraperAuth = loadScraperAuth();
  if (!scraperAuth?.li_at) {
    log('WARNING: Scraper auth (li_at) not found — Voyager calls will fail');
  }

  const db = ensureDb();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const dayName = forceDay || getDayName(now);

  // Restart-safe: launchd RunAtLoad odpala przy KAŻDYM logowaniu — nie powtarzaj, jeśli realny bieg
  // (is_stale=0) już był dziś. To zamienia RunAtLoad w „dorób pominięty bieg" zamiast pętli przy każdym loginie.
  if (!force && !dryRun && !forceDay) {
    const ranToday = db.prepare("SELECT 1 FROM daily_stats WHERE date = ? AND is_stale = 0").get(today);
    if (ranToday) { log(`Skip — realny bieg już był dziś (${today}). Użyj --force, by wymusić.`); db.close(); return; }
  }

  // Reset daily health counters. BUG (naprawiony): wcześniej last_run_date było nadpisywane PRZED
  // porównaniem, więc warunek zawsze fałszywy → liczniki NIGDY się nie zerowały (stąd fałszywe „140 błędów"
  // / 1185 calls > dzienny cap 150). Czytamy POPRZEDNI dzień przed nadpisaniem.
  const prevRunDate = db.prepare("SELECT value FROM data_health WHERE metric = 'last_run_date'").get()?.value;
  trackHealth(db, 'last_run_date', today);
  trackHealth(db, 'last_run_start', now.toISOString());
  if (prevRunDate !== today) {
    trackHealth(db, 'total_api_calls_today', '0');
    trackHealth(db, 'errors_today', '0');
  }

  const schedule = getSchedule(dayName);
  log(`Day: ${dayName} | Schedule: ${Object.keys(schedule).filter(k => schedule[k]).join(', ')}`);

  if (dryRun) {
    log('DRY RUN — showing schedule only, no API calls');
    db.close();
    return;
  }

  // --- DAILY: Post metrics (Official API — fast, single batch call) ---
  let totalReactions = 0;
  let totalComments = 0;
  let published = [];

  if (schedule.collectPostMetrics) {
    const metrics = await collectPostMetrics(db);
    totalReactions = metrics.totalReactions;
    totalComments = metrics.totalComments;
    published = metrics.published;
  }

  // --- DAILY: Network stats (Voyager — 2 calls) ---
  let followerCount = 0;
  let profileViews = 0;
  let followerStale = false;
  let viewsStale = false;

  if (schedule.collectNetworkStats) {
    const network = await collectNetworkStats(db);
    followerCount = network.followerCount;
    profileViews = network.profileViews;
    followerStale = network.followerStale;
    viewsStale = network.viewsStale;
  }

  // --- DAILY: Save aggregates (local DB only, no API) ---
  let engRate = '0.0';
  if (schedule.saveDailyAggregates) {
    const agg = saveDailyAggregates(db, today, followerCount, profileViews, totalReactions, totalComments, { followerStale, viewsStale });
    engRate = agg.engRate;
  }

  // --- DAILY: Content classification (local DB only, no API) ---
  if (schedule.classifyContent) {
    classifyContent(db);
  }

  // --- MON/THU: Top engagers (Official API — 1 call per post, max 5) ---
  if (schedule.collectTopEngagers) {
    await collectTopEngagers(db, published);
  }

  // --- TUE/FRI: Prospect scanning (Voyager — 2 calls per prospect, max 10) ---
  if (schedule.scanProspectActivity) {
    await scanProspectActivity(db);
  }

  // --- WED: Competitor monitoring (Voyager — heavy, limited batch) ---
  if (schedule.monitorCompetitors) {
    await monitorCompetitors(db);
  }

  // --- DAILY: Process snowball queue (limited batch) ---
  if (schedule.processQueue) {
    await processQueue(db);
  }

  // --- SUNDAY: Audience insights + weekly report ---
  if (schedule.buildAudienceInsights) {
    buildAudienceInsights(db);
  }

  if (schedule.generateWeeklyReport) {
    generateWeeklyReport(db, today, followerCount, totalReactions, totalComments, engRate);
  }

  // --- Final: health + notifications ---
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  trackHealth(db, 'last_successful_run', now.toISOString());
  trackHealth(db, 'last_run_duration_seconds', elapsed);

  const apiCalls = db.prepare("SELECT value FROM data_health WHERE metric = 'total_api_calls_today'").get();
  const errors = db.prepare("SELECT value FROM data_health WHERE metric = 'errors_today'").get();

  const msg = [
    'LinkedIn Daily Stats',
    `Followers: ${followerCount}`,
    `Profile views: ${profileViews ?? 'n/a (410 Gone)'}`,
    `Reactions: ${totalReactions}`,
    `Comments: ${totalComments}`,
    `Engagement: ${engRate}%`,
    `API calls: ${apiCalls?.value || 0} | Errors: ${errors?.value || 0}`,
    `Duration: ${elapsed}s | Day: ${dayName}`,
  ].join('\n');

  notify('LinkedIn Analytics', `Followers: ${followerCount} | Reactions: ${totalReactions} | ${elapsed}s`);
  sendTelegram(msg);

  db.close();

  // Regenerate the deterministic LLM-ready snapshot from the freshly-collected DB.
  // Same builder the dashboard serves at /api/analytics/llm-export. Never let an
  // export failure fail the collection run.
  try {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const snap = buildSnapshot();
    const jsonStr = JSON.stringify(snap, null, 2);
    const outDir = join(homedir(), '.linkedin-mcp', 'exports');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'analytics-latest.json'), jsonStr);
    writeFileSync(join(outDir, `analytics-${snap.basis_date || 'unknown'}.json`), jsonStr);
    log(`LLM export written (basis ${snap.basis_date}, ${(snap.data_quality?.health_alarms || []).length} alarms)`);
  } catch (e) {
    log(`LLM export failed (non-fatal): ${e.message}`);
  }

  log(`=== Analytics done in ${elapsed}s ===`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  log(err.stack || '');
  notify('LinkedIn Analytics Error', err.message.slice(0, 100));
  process.exit(1);
});
