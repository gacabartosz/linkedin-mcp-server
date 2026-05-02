#!/usr/bin/env node
/**
 * Topic ranker — combines GA4 traffic + GSC queries + existing article inventory
 * to score newsletter topics. Highlights "content gaps" (topics with traffic
 * signal but no published article) for prioritization.
 *
 * Score formula:
 *   score = 0.45 * traffic_norm_30d
 *         + 0.25 * gsc_impressions_norm
 *         + 0.20 * gap_bonus            (1 if no published article matches topic, else 0)
 *         + 0.10 * gsc_position_inv     (lower position = higher signal, normalized)
 *
 * Usage:
 *   node scripts/topic-rank.mjs                # rank all focus areas, write top 50
 *   node scripts/topic-rank.mjs --dry-run      # print, don't write
 *   node scripts/topic-rank.mjs --top=20
 *
 * Reads:  ~/.linkedin-mcp/content.db (ga4_pageviews_daily, gsc_queries_daily)
 *         bartoszgaca.pl/data/articles/*.ts (slug inventory)
 * Writes: topic_scores table
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const DB_PATH = join(DATA_DIR, 'content.db');
const ARTICLES_DIR = process.env.ARTICLES_DIR || '/Users/gaca/projects/personal/bartoszgaca.pl/data/articles';

const args = process.argv.slice(2);
const flagVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const dryRun = args.includes('--dry-run');
const topN = parseInt(flagVal('top', '50'), 10);

// Focus areas with seed keywords for topic clustering
const FOCUS_AREAS = {
  'token-optimization': {
    label_pl: 'Optymalizacja tokenów w Claude Code',
    keywords: ['token', 'cache', 'caching', 'cost', 'prompt cach', 'koszt', 'optymalizacja', 'efficient', 'efficiency', 'haiku', 'sonnet', 'opus', 'context window'],
  },
  'claude-code': {
    label_pl: 'Claude Code w produkcji',
    keywords: ['claude code', 'claude-code', 'cli', 'agent', 'subagent', 'plan mode', 'auto mode', 'mcp', 'workflow'],
  },
  'mcp': {
    label_pl: 'MCP — Model Context Protocol',
    keywords: ['mcp', 'model context protocol', 'mcp server', 'mcp client', 'tool use', 'anthropic mcp'],
  },
  'ai-dev': {
    label_pl: 'AI development workflow',
    keywords: ['ai workflow', 'developer ai', 'coding assistant', 'ai pair', 'prompt engineering', 'inżynier promptów', 'inzynieria promptow'],
  },
};

function ensureDb() {
  if (!existsSync(DB_PATH)) {
    console.error(`FATAL: ${DB_PATH} doesn't exist. Run ga4-ingest.mjs and gsc-ingest.mjs first.`);
    process.exit(2);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_scores (
      topic_slug TEXT PRIMARY KEY,
      topic_label_pl TEXT NOT NULL,
      focus_area TEXT NOT NULL,
      related_article_slugs TEXT,
      ga4_traffic_30d INTEGER NOT NULL DEFAULT 0,
      gsc_impressions_30d INTEGER NOT NULL DEFAULT 0,
      gsc_avg_position REAL,
      query_match_count INTEGER DEFAULT 0,
      has_existing_article INTEGER DEFAULT 0,
      score REAL NOT NULL,
      scored_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts_score ON topic_scores(score DESC);
    CREATE INDEX IF NOT EXISTS idx_ts_focus ON topic_scores(focus_area);
  `);
  return db;
}

function loadArticleSlugs() {
  if (!existsSync(ARTICLES_DIR)) {
    console.error(`WARN: ${ARTICLES_DIR} not found — gap_bonus will be 1 for all topics`);
    return [];
  }
  const files = readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.ts'));
  return files.map(f => f.replace(/\.ts$/, ''));
}

function matchesTopic(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

function clusterGscQueries(db, focusKey, focusDef, days = 30) {
  // Aggregate GSC queries that match the focus keywords
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT query, page,
           SUM(impressions) AS impressions, SUM(clicks) AS clicks,
           AVG(position) AS avg_position
    FROM gsc_queries_daily
    WHERE date >= ?
    GROUP BY query, page
  `).all(cutoff);

  const matched = rows.filter(r => matchesTopic(r.query, focusDef.keywords) || matchesTopic(r.page, focusDef.keywords));
  // Also cluster by individual query → topic (each query becomes a candidate topic)
  return matched;
}

function clusterGa4Pageviews(db, focusDef, days = 30) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT page_path, page_title, SUM(views) AS views, SUM(active_users) AS users
    FROM ga4_pageviews_daily
    WHERE date >= ?
    GROUP BY page_path
  `).all(cutoff);
  return rows.filter(r => matchesTopic(r.page_path, focusDef.keywords) || matchesTopic(r.page_title, focusDef.keywords));
}

function scoreTopics() {
  const db = ensureDb();
  const articleSlugs = loadArticleSlugs();
  console.error(`[topic-rank] ${articleSlugs.length} articles in inventory`);

  const candidates = [];

  for (const [focusKey, focusDef] of Object.entries(FOCUS_AREAS)) {
    const ga4Rows = clusterGa4Pageviews(db, focusDef);
    const gscRows = clusterGscQueries(db, focusKey, focusDef);

    // Each focus area becomes ONE candidate topic with aggregate signals
    const ga4Traffic = ga4Rows.reduce((s, r) => s + (r.views || 0), 0);
    const gscImpressions = gscRows.reduce((s, r) => s + (r.impressions || 0), 0);
    const gscPositions = gscRows.filter(r => r.avg_position).map(r => r.avg_position);
    const gscAvgPos = gscPositions.length ? gscPositions.reduce((s, p) => s + p, 0) / gscPositions.length : null;
    const queryMatchCount = gscRows.length;

    // Check if any existing article slug matches focus keywords
    const matchingArticles = articleSlugs.filter(slug => matchesTopic(slug, focusDef.keywords));
    const hasArticle = matchingArticles.length > 0 ? 1 : 0;

    const slug = focusKey;
    candidates.push({
      topic_slug: slug,
      topic_label_pl: focusDef.label_pl,
      focus_area: focusKey,
      related_article_slugs: JSON.stringify(matchingArticles),
      ga4_traffic_30d: ga4Traffic,
      gsc_impressions_30d: gscImpressions,
      gsc_avg_position: gscAvgPos,
      query_match_count: queryMatchCount,
      has_existing_article: hasArticle,
    });
  }

  // Also create per-query candidates from top GSC queries (high impressions, low CTR = content gap signal)
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const topQueries = db.prepare(`
    SELECT query, SUM(impressions) AS impressions, SUM(clicks) AS clicks, AVG(position) AS avg_position
    FROM gsc_queries_daily
    WHERE date >= ? AND impressions >= 3
    GROUP BY query
    ORDER BY impressions DESC
    LIMIT 100
  `).all(cutoff);

  for (const q of topQueries) {
    const slug = 'q-' + q.query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    if (candidates.some(c => c.topic_slug === slug)) continue;
    // Determine focus area from query
    let focus = 'other';
    for (const [fk, fd] of Object.entries(FOCUS_AREAS)) {
      if (matchesTopic(q.query, fd.keywords)) { focus = fk; break; }
    }
    if (focus === 'other') continue; // skip queries that don't fit any focus area
    const matchingArticles = articleSlugs.filter(s => s.toLowerCase().includes(q.query.toLowerCase().split(' ')[0]));
    candidates.push({
      topic_slug: slug,
      topic_label_pl: q.query,
      focus_area: focus,
      related_article_slugs: JSON.stringify(matchingArticles),
      ga4_traffic_30d: 0,
      gsc_impressions_30d: q.impressions,
      gsc_avg_position: q.avg_position,
      query_match_count: 1,
      has_existing_article: matchingArticles.length > 0 ? 1 : 0,
    });
  }

  // Normalize and score
  const maxTraffic = Math.max(1, ...candidates.map(c => c.ga4_traffic_30d));
  const maxImps = Math.max(1, ...candidates.map(c => c.gsc_impressions_30d));
  for (const c of candidates) {
    const trafficNorm = c.ga4_traffic_30d / maxTraffic;
    const impsNorm = c.gsc_impressions_30d / maxImps;
    const posInv = c.gsc_avg_position ? Math.max(0, 1 - c.gsc_avg_position / 30) : 0;
    const gapBonus = c.has_existing_article === 0 ? 1 : 0;
    c.score = 0.45 * trafficNorm + 0.25 * impsNorm + 0.20 * gapBonus + 0.10 * posInv;
  }
  candidates.sort((a, b) => b.score - a.score);

  const top = candidates.slice(0, topN);

  if (dryRun) {
    console.log(JSON.stringify(top, null, 2));
    db.close();
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO topic_scores (topic_slug, topic_label_pl, focus_area, related_article_slugs, ga4_traffic_30d, gsc_impressions_30d, gsc_avg_position, query_match_count, has_existing_article, score, scored_at)
    VALUES (@topic_slug, @topic_label_pl, @focus_area, @related_article_slugs, @ga4_traffic_30d, @gsc_impressions_30d, @gsc_avg_position, @query_match_count, @has_existing_article, @score, datetime('now'))
    ON CONFLICT(topic_slug) DO UPDATE SET
      topic_label_pl = excluded.topic_label_pl,
      focus_area = excluded.focus_area,
      related_article_slugs = excluded.related_article_slugs,
      ga4_traffic_30d = excluded.ga4_traffic_30d,
      gsc_impressions_30d = excluded.gsc_impressions_30d,
      gsc_avg_position = excluded.gsc_avg_position,
      query_match_count = excluded.query_match_count,
      has_existing_article = excluded.has_existing_article,
      score = excluded.score,
      scored_at = excluded.scored_at
  `);
  const tx = db.transaction(rs => { for (const r of rs) stmt.run(r); });
  tx(top);

  console.error(`[topic-rank] scored ${candidates.length} topics, wrote top ${top.length} to ${DB_PATH}`);
  console.error('\nTop 10:');
  top.slice(0, 10).forEach((c, i) => {
    const gap = c.has_existing_article === 0 ? '🟢 GAP' : '   has-article';
    console.error(`  ${i + 1}. ${gap} | score=${c.score.toFixed(3)} | ${c.topic_label_pl.slice(0, 60)}`);
  });
  db.close();
}

scoreTopics();
