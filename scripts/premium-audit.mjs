#!/usr/bin/env node
/**
 * LinkedIn Premium API Audit
 *
 * Read-only verification of what Premium Business + Open Profile
 * actually unlocks at the API/Voyager layer vs the documented free-tier behavior.
 *
 * All probes are idempotent. The script never writes to LinkedIn.
 *
 * Usage:
 *   node scripts/premium-audit.mjs              # all probes, markdown stdout + file
 *   node scripts/premium-audit.mjs --json       # machine-readable
 *   node scripts/premium-audit.mjs --probe=5    # single probe (1..8)
 *   node scripts/premium-audit.mjs --no-voyager # skip Voyager probes (no li_at)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

import { voyagerRequest, loadScraperAuth } from '../dist/scraper/voyager.js';

const HOME = homedir();
const AUTH_PATH = join(HOME, '.linkedin-mcp', 'auth.json');
const ANALYTICS_DB = join(HOME, '.linkedin-mcp', 'analytics.db');
const OUT_DIR = join(HOME, '.linkedin-mcp');

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const noVoyager = args.includes('--no-voyager');
const probeArg = args.find(a => a.startsWith('--probe='));
const onlyProbe = probeArg ? parseInt(probeArg.split('=')[1], 10) : null;

function loadOauth() {
  if (!existsSync(AUTH_PATH)) {
    throw new Error(`OAuth auth file not found: ${AUTH_PATH}. Run linkedin_auth_start first.`);
  }
  return JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
}

async function oauthGet(path, { apiBase = 'rest', apiVersion = '202503' } = {}) {
  const tokens = loadOauth();
  const base = apiBase === 'v2'
    ? 'https://api.linkedin.com/v2'
    : 'https://api.linkedin.com/rest';
  const url = path.startsWith('https://') ? path : `${base}${path}`;
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    'X-Restli-Protocol-Version': '2.0.0',
  };
  if (apiBase !== 'v2') headers['LinkedIn-Version'] = apiVersion;

  const t0 = Date.now();
  const resp = await fetch(url, { method: 'GET', headers });
  const latency_ms = Date.now() - t0;
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: resp.status, ok: resp.ok, latency_ms, body, headers: Object.fromEntries(resp.headers.entries()) };
}

function trunc(obj, n = 500) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function getRecentPostUrn() {
  if (!existsSync(ANALYTICS_DB)) return null;
  try {
    const db = new Database(ANALYTICS_DB, { readonly: true });
    const row = db.prepare('SELECT post_urn FROM social_metadata ORDER BY fetched_at DESC LIMIT 1').get();
    db.close();
    return row?.post_urn || null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// Probes
// ────────────────────────────────────────────────────────────────

const probes = {
  1: {
    title: 'OIDC userinfo (baseline)',
    needsVoyager: false,
    async run() {
      const r = await oauthGet('/userinfo', { apiBase: 'v2' });
      return {
        request: 'GET /v2/userinfo',
        ...r,
        verdict: r.ok ? 'unchanged' : 'scope-required',
        recommendation: r.ok
          ? 'Baseline captured. Premium does not change this endpoint.'
          : 'Re-run linkedin_auth_start with `openid profile` scopes.',
      };
    },
  },
  2: {
    title: '/v2/me — premiumSubscriber field',
    needsVoyager: false,
    async run() {
      // Try with projection first; many newer apps get 403 on legacy v2/me without r_basicprofile
      const r = await oauthGet('/me?projection=(id,localizedFirstName,localizedLastName,premiumSubscriber)', { apiBase: 'v2' });
      const isPremium = r.ok && r.body?.premiumSubscriber === true;
      let verdict, recommendation;
      if (r.ok && isPremium) {
        verdict = 'premium-flagged';
        recommendation = 'Confirmed — token sees Premium status.';
      } else if (r.ok && !isPremium) {
        verdict = 'unchanged';
        recommendation = '/me responds 200 but premiumSubscriber!=true. Likely projection ignored without r_basicprofile.';
      } else if (r.status === 403) {
        verdict = 'scope-required';
        recommendation = 'v2/me requires r_basicprofile / r_liteprofile (legacy scopes, gated). Premium status not API-observable for OIDC apps.';
      } else {
        verdict = 'unchanged';
        recommendation = `Unexpected ${r.status} — see body.`;
      }
      return { request: 'GET /v2/me?projection=(id,premiumSubscriber)', ...r, verdict, recommendation };
    },
  },
  3: {
    title: 'Voyager profile-view counter',
    needsVoyager: true,
    async run() {
      const r = await voyagerCall('/identity/profileViewCount');
      return finishVoyager(r, {
        request: 'GET voyager/api/identity/profileViewCount',
        premiumSignals: ['weeklyViewersCount', 'totalViewsAllTime', 'premiumInsightsAvailable'],
      });
    },
  },
  4: {
    title: 'Voyager who-viewed-your-profile (identity reveal)',
    needsVoyager: true,
    async run() {
      const r = await voyagerCall('/identity/profileViews?count=10&start=0');
      return finishVoyager(r, {
        request: 'GET voyager/api/identity/profileViews?count=10',
        premiumSignals: ['anonymous=false viewer URNs', 'viewer.firstName present', 'numberOfDaysViewable'],
      });
    },
  },
  5: {
    title: 'Creator post analytics (impressions / reach)',
    needsVoyager: false,
    async run() {
      const postUrn = getRecentPostUrn();
      if (!postUrn) {
        return {
          request: 'skipped',
          status: 0,
          ok: false,
          latency_ms: 0,
          body: 'No post URN found in analytics.db social_metadata. Publish at least one post first.',
          verdict: 'unchanged',
          recommendation: 'Publish a post via linkedin_post_create, then re-run probe.',
        };
      }
      // Encode the URN for query params
      const encoded = encodeURIComponent(postUrn);
      const path = `/memberCreatorPostAnalytics?q=memberAndPosts&author=${encodeURIComponent('urn:li:person:' + (loadOauth().person_urn?.split(':').pop() || ''))}&posts=List(${encoded})`;
      const r = await oauthGet(path, { apiBase: 'rest' });
      let verdict, recommendation;
      if (r.ok) {
        verdict = 'premium-flagged';
        recommendation = 'r_member_postAnalytics scope is granted. Impressions/reach available.';
      } else if (r.status === 403) {
        verdict = 'scope-required';
        recommendation = 'Re-run linkedin_auth_start adding r_member_postAnalytics. Codebase already supports it as optional scope.';
      } else if (r.status === 401) {
        verdict = 'scope-required';
        recommendation = 'Token expired or scope missing. Re-OAuth.';
      } else {
        verdict = 'unchanged';
        recommendation = `Unexpected ${r.status}. May need different post URN format.`;
      }
      return { request: `GET /rest/memberCreatorPostAnalytics (post=${postUrn})`, ...r, verdict, recommendation };
    },
  },
  6: {
    title: 'Voyager search rate-limit sample',
    needsVoyager: true,
    async run() {
      const r = await voyagerCall('/search/blended?keywords=mcp&origin=GLOBAL_SEARCH_HEADER&count=1');
      return finishVoyager(r, {
        request: 'GET voyager/api/search/blended?keywords=mcp&count=1',
        premiumSignals: ['no commercialUseLimit warning', 'higher daily quota', 'x-li-rate-limit headers absent'],
      });
    },
  },
  7: {
    title: 'Voyager InMail / Premium dash',
    needsVoyager: true,
    async run() {
      // Try the dash profile premium endpoint that surfaces InMail credit balance
      const r = await voyagerCall('/identity/dash/profilePremium');
      return finishVoyager(r, {
        request: 'GET voyager/api/identity/dash/profilePremium',
        premiumSignals: ['inMailQuota', 'inMailCredits', 'premiumState != FREE', 'subscriptionType'],
      });
    },
  },
  8: {
    title: 'Open Profile (no API surface)',
    needsVoyager: false,
    async run() {
      return {
        request: 'n/a',
        status: 0,
        ok: true,
        latency_ms: 0,
        body: 'Open Profile is a render-time flag on the public profile page. Not exposed via OAuth APIs nor Voyager identity endpoints.',
        verdict: 'unchanged',
        recommendation: 'Verify manually: open https://www.linkedin.com/in/bartoszgaca/ in a private window (logged out). If the "Send message" button is visible without an InMail credit prompt, Open Profile is active.',
      };
    },
  },
};

async function voyagerCall(path) {
  const auth = loadScraperAuth();
  if (!auth?.li_at || !auth.tos_acknowledged) {
    return { status: 0, ok: false, latency_ms: 0, body: 'No li_at session cookie / ToS not acknowledged. Set via linkedin_scraper_auth.', _missingAuth: true };
  }
  const t0 = Date.now();
  try {
    const body = await voyagerRequest(path);
    return { status: 200, ok: true, latency_ms: Date.now() - t0, body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.match(/(\d{3})/);
    const status = m ? parseInt(m[1], 10) : 0;
    return { status, ok: false, latency_ms: Date.now() - t0, body: msg };
  }
}

function finishVoyager(r, { request, premiumSignals }) {
  let verdict, recommendation;
  if (r._missingAuth) {
    verdict = 'scope-required';
    recommendation = 'Run linkedin_scraper_auth with your li_at cookie (see voyager.ts:198-206).';
  } else if (r.status === 429) {
    verdict = 'unchanged';
    recommendation = 'Rate-limited. Premium upgrade does not increase Voyager limits — the rate limiter in voyager.ts is conservative on purpose.';
  } else if (r.status === 401 || r.status === 403 || r.status === 302) {
    verdict = 'scope-required';
    recommendation = 'li_at session expired. Refresh cookie via linkedin_scraper_auth.';
  } else if (r.ok) {
    verdict = 'premium-flagged';
    recommendation = `Inspect body for: ${premiumSignals.join(', ')}.`;
  } else if (r.status === 404) {
    verdict = 'unchanged';
    recommendation = 'Endpoint not present at this path — LinkedIn may have moved it. Inspect feed.ts:458 for current path.';
  } else {
    verdict = 'unchanged';
    recommendation = `Unexpected ${r.status} — see body.`;
  }
  return { request, ...r, verdict, recommendation };
}

// ────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────

function shouldRun(num) {
  if (onlyProbe !== null) return num === onlyProbe;
  if (noVoyager && probes[num].needsVoyager) return false;
  return true;
}

const VERDICT_ICON = {
  'premium-flagged': '✅ premium-flagged',
  'scope-required': '⚠️  scope-required',
  'partner-program-required': '🏛  partner-program-required',
  'unchanged': '➖ unchanged',
};

function formatMarkdown(results) {
  const lines = [];
  lines.push('# LinkedIn Premium Audit');
  lines.push('');
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push(`Token file: ${AUTH_PATH}`);
  const tokens = loadOauth();
  lines.push(`Scopes granted: \`${(tokens.scopes || []).join(' ')}\``);
  lines.push(`Person URN: \`${tokens.person_urn || '(unknown)'}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Probe | Status | Verdict |');
  lines.push('|---|---|---|---|');
  for (const [num, r] of Object.entries(results)) {
    lines.push(`| ${num} | ${r.title} | ${r.status} (${r.latency_ms}ms) | ${VERDICT_ICON[r.verdict] || r.verdict} |`);
  }
  lines.push('');
  for (const [num, r] of Object.entries(results)) {
    lines.push(`## Probe ${num}: ${r.title}`);
    lines.push('');
    lines.push(`- **Request:** \`${r.request}\``);
    lines.push(`- **HTTP:** ${r.status} (${r.latency_ms}ms)`);
    lines.push(`- **Verdict:** ${VERDICT_ICON[r.verdict] || r.verdict}`);
    lines.push(`- **Recommendation:** ${r.recommendation}`);
    lines.push('');
    lines.push('```json');
    lines.push(trunc(r.body, 500));
    lines.push('```');
    lines.push('');
  }
  lines.push('## Decision matrix');
  lines.push('');
  lines.push('- Probe 5 returned `scope-required` → re-run `linkedin_auth_start` with `r_member_postAnalytics`.');
  lines.push('- Probes 3, 4, 7 returned `scope-required` (li_at) → refresh session cookie via `linkedin_scraper_auth`.');
  lines.push('- All probes `unchanged` → Premium Business has no API surface beyond UI. Pursue **Marketing Developer Platform** application if InMail-via-API is wanted (separate process, 1–4 weeks).');
  lines.push('- Sales Navigator API → requires Sales Solutions Partner Program AND Sales Navigator subscription tier (Premium Business is *not* Sales Navigator).');
  lines.push('- Open Profile → render-time UI flag only; verify by viewing public profile while logged out.');
  return lines.join('\n');
}

(async () => {
  const results = {};
  for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
    if (!shouldRun(num)) continue;
    process.stderr.write(`\nProbe ${num}: ${probes[num].title}…\n`);
    try {
      const r = await probes[num].run();
      results[num] = { title: probes[num].title, ...r };
      process.stderr.write(`  → ${results[num].verdict} (${results[num].status})\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[num] = {
        title: probes[num].title,
        request: '(error before request)',
        status: 0,
        ok: false,
        latency_ms: 0,
        body: msg,
        verdict: 'unchanged',
        recommendation: 'Error thrown before HTTP call: ' + msg,
      };
      process.stderr.write(`  → ERROR: ${msg}\n`);
    }
  }

  if (wantJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  const md = formatMarkdown(results);
  process.stdout.write(md + '\n');

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const outFile = join(OUT_DIR, `premium-audit-${dateStr}.md`);
  writeFileSync(outFile, md);
  process.stderr.write(`\nWritten: ${outFile}\n`);
})().catch(err => {
  process.stderr.write(`\nFATAL: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
