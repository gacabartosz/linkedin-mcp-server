/**
 * lib/analytics-snapshot.mjs — deterministic, LLM-ready analytics snapshot.
 *
 * Single source of truth for the analytics export. Both the dashboard endpoint
 * (GET /api/analytics/llm-export) and the CLI (export-llm.mjs) call buildSnapshot()
 * so the served JSON and the on-disk file are byte-identical.
 *
 * Design contract (why this file exists):
 *  - NO fabrication. Every number is either real (from LinkedIn, persisted in DB)
 *    or explicitly marked { available:false, reason }. We never substitute one
 *    metric for another (the old bug: profile_views = impressions).
 *  - Provenance on every metric: { value, unit, source, measured_at, is_stale,
 *    staleness_days, confidence }. source ∈ official_api|voyager|playwright_scrape|
 *    computed|unavailable.
 *  - Deterministic: same DB state → identical output. We derive the "as of"
 *    reference date from the DB itself (basis_date), never from the wall clock,
 *    so running twice without DB changes yields an identical artifact. There is
 *    NO generated_at timestamp in the payload by design.
 *
 * Read-only. Opens analytics.db and prospects.db with { readonly: true }.
 */

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const SCHEMA_VERSION = '1.0.0';
const STALE_THRESHOLD_DAYS = 2; // a metric older than this (vs basis_date) is flagged stale

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const ANALYTICS_DB = join(DATA_DIR, 'analytics.db');
const PROSPECTS_DB = join(DATA_DIR, 'prospects.db');
const SCHEDULER_DB = join(DATA_DIR, 'scheduler.db');

// ── helpers ───────────────────────────────────────────────────────────────

function openRO(path) {
  if (!existsSync(path)) return null;
  try { return new Database(path, { readonly: true, fileMustExist: true }); } catch { return null; }
}

function safe(db, fn, fallback) {
  if (!db) return fallback;
  try { const v = fn(); return v === undefined || v === null ? fallback : v; } catch { return fallback; }
}

const datePart = (s) => (s ? String(s).slice(0, 10) : null);

/** Whole-day distance from a measured date to the DB-derived basis date. Deterministic. */
function stalenessDays(measuredAt, basisDate) {
  const m = datePart(measuredAt);
  if (!m || !basisDate) return null;
  const a = Date.parse(m + 'T00:00:00Z');
  const b = Date.parse(basisDate + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Build a provenance-wrapped metric. Keys are emitted in a fixed order for
 * deterministic JSON. Pass available:false to mark a metric we deliberately
 * cannot supply (the LLM must treat value:null as "unknown", never as zero).
 */
function metric(value, opts = {}, basisDate = null) {
  const {
    unit = null, source = 'computed', measured_at = null, is_stale = null,
    confidence = 'high', available = true, reason = null, note = null,
  } = opts;
  const sd = available ? stalenessDays(measured_at, basisDate) : null;
  const stale = is_stale != null ? is_stale : (sd != null ? sd > STALE_THRESHOLD_DAYS : false);
  const out = {
    value: available ? value : null,
    available,
  };
  if (unit != null) out.unit = unit;
  out.source = available ? source : 'unavailable';
  if (available) {
    out.measured_at = measured_at;
    out.is_stale = stale;
    out.staleness_days = sd;
    out.confidence = stale ? (confidence === 'high' ? 'medium' : 'low') : confidence;
  }
  if (reason) out.reason = reason;
  if (note) out.note = note;
  return out;
}

// ── snapshot ────────────────────────────────────────────────────────────────

export function buildSnapshot() {
  const adb = openRO(ANALYTICS_DB);
  const pdb = openRO(PROSPECTS_DB);
  const sdb = openRO(SCHEDULER_DB);

  // basis_date = the freshest date the DB knows about. Everything is "as of" this
  // date, NOT the wall clock — that is what makes the snapshot deterministic.
  const lastRun = safe(adb, () => adb.prepare("SELECT value FROM data_health WHERE metric='last_run_date'").get()?.value, null);
  const maxDaily = safe(adb, () => adb.prepare("SELECT MAX(date) d FROM daily_stats").get()?.d, null);
  const basisDate = [datePart(lastRun), datePart(maxDaily)].filter(Boolean).sort().pop() || null;

  const M = (v, o = {}) => metric(v, o, basisDate);

  // ── followers ──────────────────────────────────────────────────────────
  const latestReal = safe(adb, () => adb.prepare(
    "SELECT date, follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 ORDER BY date DESC LIMIT 1").get(), null);
  const anchor7 = safe(adb, () => adb.prepare(
    "SELECT date, follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 AND date <= date(?, '-7 days') ORDER BY date DESC LIMIT 1").get(basisDate), null);
  const anchor30 = safe(adb, () => adb.prepare(
    "SELECT date, follower_count FROM daily_stats WHERE is_stale=0 AND follower_count>0 AND date <= date(?, '-30 days') ORDER BY date DESC LIMIT 1").get(basisDate), null);

  // Delta confidence drops when the 7/30d baseline is not exactly 7/30 days back
  // (real-fetch gaps) — we report the actual span so the LLM isn't misled.
  const span = (a) => (a && latestReal) ? stalenessDays(a.date, latestReal.date) : null;
  const followers = {
    current: latestReal
      ? M(latestReal.follower_count, { unit: 'followers', source: 'voyager', measured_at: latestReal.date })
      : M(null, { available: false, reason: 'no non-stale follower row in daily_stats' }),
    delta_7d: (latestReal && anchor7)
      ? M(latestReal.follower_count - anchor7.follower_count, {
          unit: 'followers', source: 'computed', measured_at: latestReal.date,
          confidence: span(anchor7) === 7 ? 'high' : 'medium',
          note: `baseline ${anchor7.date} (${span(anchor7)}d back); excludes frozen-fallback rows`,
        })
      : M(null, { available: false, reason: 'no real follower baseline ~7 days back' }),
    delta_30d: (latestReal && anchor30)
      ? M(latestReal.follower_count - anchor30.follower_count, {
          unit: 'followers', source: 'computed', measured_at: latestReal.date,
          confidence: 'medium',
          note: `baseline ${anchor30.date} (${span(anchor30)}d back); excludes frozen-fallback rows`,
        })
      : M(null, { available: false, reason: 'no real follower baseline ~30 days back' }),
    history: safe(adb, () => adb.prepare(
      "SELECT date, follower_count AS value, is_stale FROM daily_stats WHERE follower_count>0 ORDER BY date DESC LIMIT 90").all()
      .map(r => ({ date: r.date, value: r.follower_count ?? r.value, is_stale: !!r.is_stale })).reverse(), []),
  };

  // ── impressions / reach ────────────────────────────────────────────────
  // Prefer official per-post analytics (post_metrics_history, written by
  // pull-official-metrics.mjs once r_member_postAnalytics is granted). Fall back
  // to the Highcharts top-posts scrape when official data is absent.
  const officialImprDate = safe(adb, () => adb.prepare("SELECT MAX(date) d FROM post_metrics_history WHERE impressions>0").get()?.d, null);
  const officialImprSum = officialImprDate
    ? safe(adb, () => adb.prepare("SELECT SUM(impressions) s FROM post_metrics_history WHERE date=?").get(officialImprDate)?.s, 0)
    : 0;
  const lastImprScrape = safe(adb, () => adb.prepare("SELECT MAX(date(scraped_at)) d FROM creator_top_posts").get()?.d, null);
  const imprSum = lastImprScrape
    ? safe(adb, () => adb.prepare("SELECT SUM(impressions) s FROM creator_top_posts WHERE date(scraped_at)=?").get(lastImprScrape)?.s, 0)
    : 0;
  const reachRow = safe(adb, () => adb.prepare("SELECT SUM(members_reached) s, MAX(date) d, COUNT(*) c FROM post_metrics_history").get(), { s: 0, d: null, c: 0 });

  const impressions = {
    total: officialImprDate
      ? M(officialImprSum, { unit: 'impressions', source: 'official_api', measured_at: officialImprDate, note: 'official Member Creator Post Analytics' })
      : (lastImprScrape
        ? M(imprSum, {
            unit: 'impressions', source: 'playwright_scrape', measured_at: lastImprScrape,
            note: 'sum of top-posts scrape; will switch to official_api once r_member_postAnalytics is granted + pull-official-metrics.mjs runs',
          })
        : M(null, { available: false, reason: 'no impressions on record (official API needs scope; Highcharts scrape extracts 0 points)' })),
  };
  const reach = {
    // members_reached only comes from the official API. Rows may exist with reached=0
    // (legacy reaction-only snapshots) — treat 0 as UNKNOWN, not as real reach.
    total: (reachRow && reachRow.s > 0)
      ? M(reachRow.s, { unit: 'members_reached', source: 'official_api', measured_at: reachRow.d })
      : M(null, { available: false, reason: 'requires OAuth scope r_member_postAnalytics + pull-official-metrics.mjs (no members_reached on record)' }),
  };

  // ── profile views — permanently unavailable, never fabricated ───────────
  const profile_views = {
    total: M(null, { available: false, reason: 'LinkedIn member profile-views endpoint returns 410 Gone; no API or scrape path exists' }),
  };

  // ── reactions / comments ────────────────────────────────────────────────
  const reactAgg = safe(adb, () => adb.prepare(`
    SELECT COUNT(*) posts,
      SUM(like_count) l, SUM(praise_count) p, SUM(empathy_count) e,
      SUM(interest_count) i, SUM(appreciation_count) a, SUM(entertainment_count) en,
      SUM(comment_count) c, MAX(fetched_at) m
    FROM social_metadata`).get(), null);
  const reactTotal = reactAgg ? (reactAgg.l + reactAgg.p + reactAgg.e + reactAgg.i + reactAgg.a + reactAgg.en) : 0;
  const reactMeasured = datePart(reactAgg?.m);
  const reactions = {
    total: reactAgg
      ? M(reactTotal, { unit: 'reactions', source: 'official_api', measured_at: reactMeasured, note: `across ${reactAgg.posts} tracked posts` })
      : M(null, { available: false, reason: 'social_metadata empty' }),
    by_type: reactAgg ? {
      LIKE: reactAgg.l, PRAISE: reactAgg.p, EMPATHY: reactAgg.e,
      INTEREST: reactAgg.i, APPRECIATION: reactAgg.a, ENTERTAINMENT: reactAgg.en,
    } : null,
    posts_tracked: reactAgg ? reactAgg.posts : 0,
  };
  const comments = {
    total: reactAgg
      ? M(reactAgg.c, { unit: 'comments', source: 'official_api', measured_at: reactMeasured })
      : M(null, { available: false, reason: 'social_metadata empty' }),
  };

  // ── engagement rate (computed, formula stated) ──────────────────────────
  const denomImpr = impressions.total.available && impressions.total.value > 0;
  const engDenom = denomImpr ? impressions.total.value : (followers.current.value || 0);
  const engValue = engDenom > 0 ? Math.round((reactTotal / engDenom) * 10000) / 100 : null;
  const engagement_rate = {
    value: engValue,
    available: engValue != null,
    unit: 'percent',
    source: 'computed',
    formula: denomImpr ? 'reactions / impressions * 100' : 'reactions / followers * 100 (fallback: impressions unavailable)',
    confidence: denomImpr ? (impressions.total.is_stale ? 'medium' : 'high') : 'low',
    note: denomImpr ? null : 'denominator is followers, not impressions — not comparable to LinkedIn-reported engagement rate',
  };

  // ── top posts ───────────────────────────────────────────────────────────
  const topPostRows = safe(adb, () => adb.prepare(`
    SELECT post_urn,
      (like_count+praise_count+empathy_count+interest_count+appreciation_count+entertainment_count) AS reactions,
      comment_count, like_count, praise_count, empathy_count, interest_count, appreciation_count, entertainment_count, fetched_at
    FROM social_metadata ORDER BY reactions DESC, post_urn ASC LIMIT 10`).all(), []);
  const top_posts = topPostRows.map(r => {
    let text = sdb ? (safe(sdb, () => sdb.prepare("SELECT text FROM scheduled_posts WHERE post_urn=?").get(r.post_urn)?.text, '') || '') : '';
    if (!text && adb) {
      const c = safe(adb, () => adb.prepare("SELECT raw_text, text_preview FROM creator_top_posts WHERE post_urn=? ORDER BY scraped_at DESC LIMIT 1").get(r.post_urn), null);
      text = c ? (c.raw_text || c.text_preview || '') : '';
    }
    return {
      post_urn: r.post_urn,
      text_preview: (text || '').slice(0, 120),
      reactions: r.reactions,
      comments: r.comment_count,
      breakdown: { LIKE: r.like_count, PRAISE: r.praise_count, EMPATHY: r.empathy_count, INTEREST: r.interest_count, APPRECIATION: r.appreciation_count, ENTERTAINMENT: r.entertainment_count },
      measured_at: datePart(r.fetched_at),
      source: 'official_api',
    };
  });

  // ── top engagers (identity honesty) ─────────────────────────────────────
  const engRows = safe(adb, () => adb.prepare(`
    SELECT person_urn, name, headline, public_id, reaction_count, comment_count, total_engagements, last_engagement_at
    FROM top_engagers ORDER BY total_engagements DESC, person_urn ASC LIMIT 20`).all(), []);
  const engResolved = engRows.filter(r => r.name && r.name.trim()).length;
  const top_engagers = {
    identity_resolved: `${engResolved}/${engRows.length}`,
    available: engRows.length > 0,
    note: engResolved === 0 && engRows.length > 0
      ? 'engager identities NOT resolved — only reaction counts are real; names/headlines require a Voyager profile lookup pass'
      : null,
    source: 'voyager',
    items: engRows.map(r => ({
      person_urn: r.person_urn,
      name: r.name && r.name.trim() ? r.name : null,
      headline: r.headline && r.headline.trim() ? r.headline : null,
      public_id: r.public_id && r.public_id.trim() ? r.public_id : null,
      reactions: r.reaction_count,
      comments: r.comment_count,
      total: r.total_engagements,
      identity_resolved: !!(r.name && r.name.trim()),
    })),
  };

  // ── demographics / audience insights ────────────────────────────────────
  const demoRows = safe(adb, () => adb.prepare("SELECT category, value, count FROM network_demographics ORDER BY category, count DESC, value").all(), []);
  const insightRows = safe(adb, () => adb.prepare("SELECT category, value, count, source FROM audience_insights ORDER BY category, count DESC, value").all(), []);
  const groupBy = (rows) => {
    const g = {};
    for (const r of rows) (g[r.category] ||= []).push({ value: r.value, count: r.count });
    return g;
  };
  const demographics = demoRows.length > 0
    ? { available: true, source: 'voyager', by_category: groupBy(demoRows) }
    : { available: false, reason: 'network_demographics empty — needs resolved engager/visitor profiles (Voyager pass)', by_category: null };
  const audience_insights = insightRows.length > 0
    ? { available: true, source: 'voyager', by_category: groupBy(insightRows) }
    : { available: false, reason: 'audience_insights empty — depends on resolved engager headlines', by_category: null };

  // ── weekly (gap-flagged) ────────────────────────────────────────────────
  const weeklyRows = safe(adb, () => adb.prepare(`
    SELECT week_start, total_reactions, follower_delta, posts_count, avg_engagement_rate, top_post_reactions
    FROM weekly_report ORDER BY week_start DESC LIMIT 12`).all(), []);
  const weekly = weeklyRows.map(r => {
    const reactionsGap = r.posts_count > 0 && (r.total_reactions || 0) === 0;
    const followerGap = (r.follower_delta || 0) === 0;
    return {
      week_start: r.week_start,
      total_reactions: r.total_reactions,
      follower_delta: r.follower_delta,
      posts_count: r.posts_count,
      avg_engagement_rate: r.avg_engagement_rate,
      complete: !reactionsGap && !followerGap,
      gaps: [
        reactionsGap ? 'reactions=0 with posts>0 (collection gap, not a real zero)' : null,
        followerGap ? 'follower_delta=0 (likely frozen follower data that week)' : null,
      ].filter(Boolean),
    };
  });

  // ── connections ─────────────────────────────────────────────────────────
  const connCount = safe(pdb, () => pdb.prepare("SELECT COUNT(*) c FROM connections").get()?.c, 0);
  const connFresh = safe(pdb, () => pdb.prepare("SELECT MAX(date(scraped_at)) d FROM connections").get()?.d, null);
  const connNamed = safe(pdb, () => pdb.prepare("SELECT COUNT(*) c FROM connections WHERE headline IS NOT NULL AND headline!=''").get()?.c, 0);
  const connections = {
    total: connCount > 0
      ? M(connCount, { unit: 'connections', source: 'voyager', measured_at: connFresh, note: `${connNamed}/${connCount} have a headline` })
      : M(null, { available: false, reason: 'prospects.db connections empty' }),
  };

  // ── content-type performance (computed) ─────────────────────────────────
  const contentTypes = safe(adb, () => adb.prepare(`
    SELECT ctm.content_type AS type, COUNT(*) AS posts,
      ROUND(AVG(sm.like_count+sm.praise_count+sm.empathy_count+sm.interest_count+sm.appreciation_count+sm.entertainment_count),1) AS avg_reactions,
      ROUND(AVG(sm.comment_count),1) AS avg_comments
    FROM content_type_map ctm JOIN social_metadata sm ON ctm.post_urn=sm.post_urn
    GROUP BY ctm.content_type ORDER BY avg_reactions DESC, type ASC`).all(), []);

  // ── data quality summary ────────────────────────────────────────────────
  const hf = (m) => safe(adb, () => adb.prepare("SELECT value FROM data_health WHERE metric=?").get(m)?.value, null);
  const unavailable = [];
  const stale = [];
  const scan = (path, obj) => {
    if (!obj || typeof obj !== 'object') return;
    if ('available' in obj && obj.available === false) unavailable.push({ metric: path, reason: obj.reason || null });
    if (obj.is_stale === true) stale.push({ metric: path, staleness_days: obj.staleness_days ?? null });
  };
  scan('followers.current', followers.current);
  scan('impressions.total', impressions.total);
  scan('reach.total', reach.total);
  scan('profile_views.total', profile_views.total);
  scan('reactions.total', reactions.total);
  scan('connections.total', connections.total);
  if (!demographics.available) unavailable.push({ metric: 'demographics', reason: demographics.reason });
  if (!audience_insights.available) unavailable.push({ metric: 'audience_insights', reason: audience_insights.reason });
  if (top_engagers.available && engResolved === 0) unavailable.push({ metric: 'top_engagers.identities', reason: 'reaction counts real but names unresolved' });

  const creatorAnalyticsFresh = safe(adb, () => adb.prepare("SELECT MAX(date(scraped_at)) d FROM creator_analytics").get()?.d, null);
  const caStale = stalenessDays(creatorAnalyticsFresh, basisDate);
  const errorsToday = parseInt(hf('errors_today') || '0', 10);
  const callsToday = parseInt(hf('total_api_calls_today') || '0', 10);

  // ── staleness guard: deterministic alarms derived from DB state. This is the
  // tripwire that should have caught the 75-day silent freeze of the chart scrape.
  const alarms = [];
  if (caStale != null && caStale > STALE_THRESHOLD_DAYS)
    alarms.push({ severity: caStale > 14 ? 'critical' : 'warning', code: 'creator_analytics_frozen',
      message: `365-day charts (creator_analytics) are ${caStale} days stale — the Highcharts scrape is not updating.` });
  if (hf('profileviews_stale') === '1')
    alarms.push({ severity: 'info', code: 'profileviews_dead', message: 'Profile views permanently unavailable (LinkedIn 410 Gone).' });
  if (hf('followers_stale') === '1')
    alarms.push({ severity: 'warning', code: 'followers_stale', message: 'Latest follower count is a frozen fallback, not a fresh fetch (Voyager failed).' });
  if (callsToday > 0 && errorsToday / callsToday > 0.05)
    alarms.push({ severity: 'warning', code: 'high_api_error_rate', message: `${errorsToday}/${callsToday} API calls failed today (~${Math.round(errorsToday / callsToday * 100)}%) — likely a dead/expired li_at cookie.` });
  if (engRows.length > 0 && engResolved === 0)
    alarms.push({ severity: 'warning', code: 'engagers_unresolved', message: 'Top-engager reaction counts are real but identities are unresolved (Voyager profile lookup needed).' });
  if (!demographics.available)
    alarms.push({ severity: 'info', code: 'demographics_missing', message: 'Network demographics not collected (depends on resolved engager/visitor profiles).' });

  const data_quality = {
    basis_date: basisDate,
    errors_today: errorsToday,
    total_api_calls_today: callsToday,
    last_run: hf('last_run_start') || hf('last_run_date') || null,
    followers_stale_flag: hf('followers_stale') === '1',
    profileviews_dead: hf('profileviews_stale') === '1',
    creator_analytics_scraped_at: creatorAnalyticsFresh,
    creator_analytics_staleness_days: caStale,
    health_alarms: alarms,
    unavailable_metrics: unavailable,
    stale_metrics: stale,
    trust_note: 'Each metric carries its own source/measured_at/is_stale/confidence. value:null with available:false means UNKNOWN — never treat it as zero.',
  };

  if (adb) adb.close();
  if (pdb) pdb.close();
  if (sdb) sdb.close();

  // Fixed key order → deterministic JSON.
  return {
    schema_version: SCHEMA_VERSION,
    basis_date: basisDate,
    account: { person_urn: 'urn:li:person:FihAwG4y_B' },
    followers,
    impressions,
    reach,
    profile_views,
    reactions,
    comments,
    engagement_rate,
    top_posts,
    top_engagers,
    demographics,
    audience_insights,
    content_type_performance: contentTypes,
    weekly,
    connections,
    data_quality,
  };
}

export function snapshotJson() {
  return JSON.stringify(buildSnapshot(), null, 2);
}
