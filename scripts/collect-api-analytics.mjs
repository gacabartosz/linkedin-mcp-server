#!/usr/bin/env node
/**
 * Codzienny kolektor analityki z OFICJALNEGO API LinkedIn.
 *
 * Zbiera tylko to, co Development Tier realnie oddaje (potwierdzone probe'em
 * i żniwami 2026-07-26/27):
 *   - odsłony stron firmowych, z rozbiciem na urządzenie i zakładkę
 *   - demografia followersów stron (senioralność, branża, funkcja, kraj, wielkość)
 *   - metryki postów stron (impressions, klik, reakcje) — zera dopóki strony są puste
 *   - liczba kontaktów 1. stopnia profilu
 *   - rozbicie typów reakcji pod postami profilu (socialMetadata)
 *
 * Czego NIE zbiera, bo Dev Tier zwraca 404: memberCreatorPostAnalytics
 * (impressions postów osobistych) i memberFollowersCount. Wymagają
 * `Request upgrade` produktu w portalu.
 *
 * Proweniencja: każda tabela ma prefiks api_ i własny wiersz per dzień, więc
 * nigdy nie nadpisuje danych ze scrapera ani z eksportu XLSX. Zasada wyciągnięta
 * z incydentu, gdy upsert do social_metadata skasował lepsze wartości.
 *
 * Token: przez orgLinkedinRequest(), które samo odnawia access token na 401
 * (refresh_token ważny do 2027-07-26).
 *
 * Użycie:
 *   node scripts/collect-api-analytics.mjs             # pełny przebieg
 *   node scripts/collect-api-analytics.mjs --dry       # bez zapisu
 *   node scripts/collect-api-analytics.mjs --no-social # pomiń socialMetadata (oszczędza wywołania)
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { orgLinkedinRequest } from '../dist/api/client.js';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const BUDGET = parseInt(process.env.API_DAILY_BUDGET || '500', 10);
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_SOCIAL = args.includes('--no-social');
const TODAY = new Date().toISOString().slice(0, 10);

const ORGS = [
  { urn: 'urn:li:organization:72198432', name: 'reklamacje24.pl' },
  { urn: 'urn:li:organization:109990139', name: 'OdpiszNaPismo.pl' },
  { urn: 'urn:li:organization:134844053', name: 'bartoszgaca.pl' },
];

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const enc = encodeURIComponent;

const db = new Database(join(DATA_DIR, 'analytics.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS api_org_page_views (
  date TEXT, org_urn TEXT, metric TEXT, value INTEGER, fetched_at TEXT,
  PRIMARY KEY (date, org_urn, metric));
CREATE TABLE IF NOT EXISTS api_org_follower_stats (
  date TEXT, org_urn TEXT, category TEXT, bucket TEXT,
  organic INTEGER, paid INTEGER, fetched_at TEXT,
  PRIMARY KEY (date, org_urn, category, bucket));
CREATE TABLE IF NOT EXISTS api_org_share_stats (
  date TEXT, org_urn TEXT, impressions INTEGER, unique_impressions INTEGER,
  clicks INTEGER, likes INTEGER, comments INTEGER, shares INTEGER,
  engagement REAL, fetched_at TEXT,
  PRIMARY KEY (date, org_urn));
CREATE TABLE IF NOT EXISTS api_org_posts (
  post_urn TEXT PRIMARY KEY, org_urn TEXT, created_at TEXT, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS api_profile_stats (
  date TEXT, metric TEXT, value INTEGER, fetched_at TEXT,
  PRIMARY KEY (date, metric));
CREATE TABLE IF NOT EXISTS api_social_metadata (
  post_urn TEXT PRIMARY KEY, like_count INT, praise_count INT, empathy_count INT,
  interest_count INT, appreciation_count INT, entertainment_count INT,
  comment_count INT, comment_top_level INT, fetched_at TEXT);
`);

const put = {
  pageView: db.prepare(`INSERT OR REPLACE INTO api_org_page_views VALUES (?,?,?,?,datetime('now'))`),
  follower: db.prepare(`INSERT OR REPLACE INTO api_org_follower_stats VALUES (?,?,?,?,?,?,datetime('now'))`),
  share: db.prepare(`INSERT OR REPLACE INTO api_org_share_stats VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`),
  post: db.prepare(`INSERT OR REPLACE INTO api_org_posts VALUES (?,?,?,datetime('now'))`),
  profile: db.prepare(`INSERT OR REPLACE INTO api_profile_stats VALUES (?,?,?,datetime('now'))`),
  social: db.prepare(`INSERT OR REPLACE INTO api_social_metadata VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`),
  health: db.prepare(`INSERT OR REPLACE INTO data_health (metric, value, updated_at) VALUES (?,?,datetime('now'))`),
};

let calls = 0, errors = 0;

async function api(path, label) {
  if (calls >= BUDGET) { log(`! budżet ${BUDGET} wyczerpany — pomijam ${label}`); return null; }
  calls++;
  try {
    const d = await orgLinkedinRequest('GET', path);
    await new Promise((s) => setTimeout(s, 1500)); // 2026-07-26: 429 po ~110 wywołaniach
    return d;
  } catch (err) {
    errors++;
    log(`✗ ${label}: ${err instanceof Error ? err.message.slice(0, 110) : err}`);
    await new Promise((s) => setTimeout(s, 1500));
    return null;
  }
}

// ── strony firmowe ────────────────────────────────────────────────────────
for (const org of ORGS) {
  const e = enc(org.urn);
  log(`── ${org.name}`);

  const ps = await api(`/organizationPageStatistics?q=organization&organization=${e}`, `${org.name} odsłony`);
  const views = ps?.elements?.[0]?.totalPageStatistics?.views || {};
  let vn = 0;
  for (const [k, v] of Object.entries(views)) {
    const n = v?.pageViews;
    if (typeof n === 'number') { if (!DRY) put.pageView.run(TODAY, org.urn, k, n); vn++; }
  }
  log(`   odsłony: ${vn} metryk (all=${views.allPageViews?.pageViews ?? '—'})`);

  const fs = await api(`/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${e}`, `${org.name} followersi`);
  const fel = fs?.elements?.[0] || {};
  let fn = 0;
  for (const [key, arr] of Object.entries(fel)) {
    if (!Array.isArray(arr)) continue;
    const category = key.replace(/^followerCountsBy/, '');
    for (const row of arr) {
      // klucz kubełka to jedyne pole, które nie jest followerCounts
      const bucket = String(Object.entries(row).find(([k]) => k !== 'followerCounts')?.[1] ?? 'ALL');
      const c = row.followerCounts || {};
      if (!DRY) put.follower.run(TODAY, org.urn, category, bucket, c.organicFollowerCount || 0, c.paidFollowerCount || 0);
      fn++;
    }
  }
  log(`   followersi: ${fn} kubełków`);

  const ss = await api(`/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${e}`, `${org.name} metryki postów`);
  const t = ss?.elements?.[0]?.totalShareStatistics;
  if (t) {
    if (!DRY) put.share.run(TODAY, org.urn, t.impressionCount || 0, t.uniqueImpressionsCount || 0,
      t.clickCount || 0, t.likeCount || 0, t.commentCount || 0, t.shareCount || 0, t.engagement || 0);
    log(`   impressions=${t.impressionCount} klik=${t.clickCount} reakcje=${t.likeCount}`);
  }

  const po = await api(`/posts?q=author&author=${e}&count=25`, `${org.name} posty`);
  const els = po?.elements || [];
  for (const p of els) {
    const urn = p.id || p.urn;
    if (urn && !DRY) put.post.run(urn, org.urn, p.createdAt ? new Date(p.createdAt).toISOString() : null);
  }
  log(`   posty strony: ${els.length}`);
}

// ── profil ────────────────────────────────────────────────────────────────
log('── profil');
const me = await api('/me', 'me');
if (me?.id) {
  const conn = await api(`/connections/${enc(`urn:li:person:${me.id}`)}`, 'kontakty');
  if (typeof conn?.firstDegreeSize === 'number') {
    if (!DRY) put.profile.run(TODAY, 'connections_first_degree', conn.firstDegreeSize);
    log(`   kontakty 1. stopnia: ${conn.firstDegreeSize}`);
  }
}

// ── reakcje pod postami profilu ───────────────────────────────────────────
if (!NO_SOCIAL) {
  const sched = new Database(join(DATA_DIR, 'scheduler.db'), { readonly: true });
  // Świeże posty odświeżamy codziennie; starsze mają już stabilne liczby.
  const recent = sched.prepare(
    `SELECT post_urn FROM scheduled_posts WHERE post_urn IS NOT NULL AND post_urn != ''
     AND status='published' AND published_at >= date('now','-21 days') ORDER BY published_at DESC`
  ).all();
  sched.close();
  log(`── socialMetadata dla ${recent.length} postów z ostatnich 21 dni`);
  let sn = 0;
  for (const { post_urn } of recent) {
    // Post zapisany jako ugcPost bywa widoczny tylko pod share (i odwrotnie) —
    // 1 z 9 postów leciał 404 właśnie na tym.
    const id = post_urn.split(':').pop();
    const tries = post_urn.includes(':share:')
      ? [post_urn, `urn:li:ugcPost:${id}`]
      : [post_urn, `urn:li:share:${id}`];
    let m = null;
    for (const u of tries) {
      m = await api(`/socialMetadata/${enc(u)}`, u.slice(-19));
      if (m) break;
    }
    if (!m) continue;
    const rs = m.reactionSummaries || {}, cs = m.commentSummary || {};
    const R = (k) => rs[k]?.count || 0;
    if (!DRY) put.social.run(post_urn, R('LIKE'), R('PRAISE'), R('EMPATHY'), R('INTEREST'),
      R('APPRECIATION'), R('ENTERTAINMENT'), cs.aggregatedTotalComments ?? cs.count ?? 0, cs.count ?? 0);
    sn++;
  }
  log(`   zaktualizowane: ${sn}`);
}

// ── zdrowie danych (dashboard czyta data_health) ───────────────────────────
if (!DRY) {
  put.health.run('api_last_run', new Date().toISOString());
  put.health.run('api_last_success_date', TODAY);
  put.health.run('api_calls_today', String(calls));
  put.health.run('api_errors_today', String(errors));
}

log(`\ngotowe — wywołań: ${calls}/${BUDGET}, błędów: ${errors}${DRY ? ' (DRY, bez zapisu)' : ''}`);
db.close();
