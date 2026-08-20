#!/usr/bin/env node
/**
 * Dobieranie poprawnych parametrów do endpointów, które w żniwach dały 400/422/500.
 *
 * Teza: 400 to nie brak uprawnień, a zły format parametru Rest.li. Dla każdego
 * zepsutego zasobu próbujemy kilku wariantów i zapisujemy, który przechodzi.
 *
 * Tylko GET. Odstęp 1.5 s (429 przyszło po ~110 wywołaniach).
 *
 * Użycie: node scripts/fix-broken-endpoints.mjs
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const TOKEN = JSON.parse(readFileSync(join(DATA_DIR, 'org-auth.json'), 'utf8')).access_token;
const VER = process.env.LINKEDIN_API_VERSION || '202503';

const ORG = 'urn:li:organization:134844053';
const ORG_ID = '134844053';
const e = encodeURIComponent;

// Realny URN posta profilu — do testów zasobów wymagających encji treści.
let POST = '';
try {
  const db = new Database(join(DATA_DIR, 'scheduler.db'), { readonly: true });
  POST = db.prepare("SELECT post_urn FROM scheduled_posts WHERE post_urn LIKE '%share%' AND status='published' ORDER BY published_at DESC LIMIT 1").get()?.post_urn || '';
  db.close();
} catch { /* brak bazy */ }

async function try_(path) {
  const r = await fetch(`https://api.linkedin.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'LinkedIn-Version': VER,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    signal: AbortSignal.timeout(25000),
  }).catch((err) => ({ ok: false, status: 0, text: async () => String(err) }));
  const body = await r.text();
  let msg = '';
  if (!r.ok) { try { msg = JSON.parse(body).message || ''; } catch { msg = body.slice(0, 100); } }
  await new Promise((s) => setTimeout(s, 1500));
  return { status: r.status, ok: r.ok, msg: msg.slice(0, 100), body: body.slice(0, 150) };
}

const GROUPS = [
  ['networkSizes — licznik followersów', [
    `/rest/networkSizes/${e(ORG)}?edgeType=CompanyFollowedByMember`,
    `/rest/networkSizes/${ORG_ID}?edgeType=CompanyFollowedByMember`,
    `/rest/networkSizes/${e(ORG)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
    `/rest/networkSizes/${e(ORG)}`,
    `/rest/networkSizes/${e(ORG)}?edgeType=CompanyFollowedByMember&count=0`,
  ]],
  ['vanityUrl strony', [
    `/rest/vanityUrl?q=vanityUrlAsOrganization&organization=${e(ORG)}`,
    `/rest/vanityUrl?q=vanityUrlAsOrganization&vanityName=bartoszgaca`,
    `/rest/vanityUrl?q=vanityUrlAsOrganization&organizationalEntity=${e(ORG)}`,
  ]],
  ['organizationBrands', [
    `/rest/organizationBrands?q=parentOrganization&parentOrganization=${e(ORG)}`,
    `/rest/organizationBrands?q=vanityName&vanityName=bartoszgaca`,
    `/rest/organizationBrands?q=parentOrganization&parentOrganization=${ORG_ID}`,
  ]],
  ['organizationalEntityNotifications — feed zdarzeń strony', [
    `/rest/organizationalEntityNotifications?q=criteria&organizationalEntity=${e(ORG)}`,
    `/rest/organizationalEntityNotifications?q=criteria&criteria=(organizationalEntity:${e(ORG)})`,
    `/rest/organizationalEntityNotifications?q=criteria&organizationalEntity=${e(ORG)}&count=10`,
    `/rest/organizationalEntityNotifications?q=criteria&criteria=(organizationalEntity:${e(ORG)},actions:List(COMMENT))`,
  ]],
  ['peopleTypeahead — followersi org', [
    `/rest/peopleTypeahead?q=organizationFollowers&organization=${e(ORG)}`,
    `/rest/peopleTypeahead?q=organizationFollowers&organization=${e(ORG)}&query=a`,
    `/rest/peopleTypeahead?q=organizationFollowers&organizationalEntity=${e(ORG)}&query=a`,
  ]],
  ['videoAnalytics — entity musi być treścią, nie organizacją', POST ? [
    `/rest/videoAnalytics?q=entity&entity=${e(POST)}`,
    `/rest/videoAnalytics?q=entity&entity=${e(POST)}&type=VIDEO_VIEW`,
    `/rest/videoAnalytics?q=entity&entity=${e(ORG)}`,
  ] : []],
  ['documents / videos / images — finder associatedAccount', [
    `/rest/documents?q=associatedAccount&associatedAccount=${e(ORG)}`,
    `/rest/documents?q=associatedAccount&associatedAccount=${e(ORG)}&count=5`,
    `/rest/images?q=associatedAccount&associatedAccount=${e(ORG)}&count=5`,
    `/rest/videos?q=associatedAccount&associatedAccount=${e(ORG)}&count=5`,
  ]],
  ['skills — mój wcześniejszy błąd: puste ?q=', [
    `/rest/skills`,
    `/rest/skills?start=0&count=10`,
  ]],
  ['brandPageStatistics — brand URN, nie organization', [
    `/rest/brandPageStatistics?q=brand&brand=${e(ORG)}`,
    `/rest/brandPageStatistics?q=brand&brand=${e('urn:li:organizationBrand:134844053')}`,
  ]],
  ['posts FINDER author dla profilu (niewiadoma N1)', [
    `/rest/posts?q=author&author=${e('urn:li:person:PHp-Tl1fZw')}&count=5`,
    `/rest/posts?q=author&author=${e('urn:li:person:PHp-Tl1fZw')}&count=5&isDsc=false`,
    `/rest/posts?q=author&author=${e('urn:li:person:PHp-Tl1fZw')}&count=5&viewContext=AUTHOR`,
  ]],
];

const wins = [];
for (const [label, paths] of GROUPS) {
  if (!paths.length) continue;
  console.log(`\n── ${label}`);
  let solved = false;
  for (const p of paths) {
    const r = await try_(p);
    const mark = r.ok ? '✅' : r.status === 403 ? '🔒' : r.status === 404 ? '❔' : '❌';
    const q = p.includes('?') ? p.slice(p.indexOf('?') + 1) : '(bez parametrów)';
    console.log(`   ${mark} ${String(r.status).padEnd(3)} ${q.slice(0, 95)}`);
    if (!r.ok && r.msg) console.log(`         ${r.msg}`);
    if (r.ok) {
      console.log(`         → ${r.body.slice(0, 120)}`);
      wins.push({ label, path: p });
      solved = true;
      break; // pierwszy działający wariant wystarcza
    }
  }
  if (!solved) console.log('   → żaden wariant nie przeszedł');
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`NAPRAWIONE: ${wins.length}/${GROUPS.filter(([, p]) => p.length).length} grup\n`);
for (const w of wins) console.log(`  ✅ ${w.label}\n     ${w.path}`);
