#!/usr/bin/env node
/**
 * Żniwa z konta — pobiera WSZYSTKO, co token org realnie oddaje, i raportuje
 * co jest dostępne, a co nie. Odpowiedź na "co jeszcze można wycisnąć".
 *
 * Tylko GET/FINDER. Zero zapisów po stronie LinkedIna.
 *
 * Uwzględnia limity: 429 zdarzył się po ~110 wywołaniach (2026-07-26), więc
 * odstęp 2 s, backoff na 429 i twardy budżet.
 *
 * Wynik: docs/ACCOUNT-HARVEST.md + surowe JSON-y w ~/.linkedin-mcp/harvest/
 *
 * Użycie: node scripts/harvest-account.mjs [--budget 80]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const OUT_DIR = join(DATA_DIR, 'harvest');
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202503';

const args = process.argv.slice(2);
const BUDGET = args.includes('--budget') ? parseInt(args[args.indexOf('--budget') + 1], 10) : 80;

const TOKEN = JSON.parse(readFileSync(join(DATA_DIR, 'org-auth.json'), 'utf8')).access_token;
const enc = (s) => encodeURIComponent(s);

const ORGS = [
  { id: '72198432', name: 'reklamacje24.pl' },
  { id: '109990139', name: 'OdpiszNaPismo.pl' },
  { id: '134844053', name: 'bartoszgaca.pl' },
];

let calls = 0, hit429 = 0;
const results = [];

async function get(path, label, group) {
  if (calls >= BUDGET) return { skipped: true };
  calls++;
  const r = await fetch(`https://api.linkedin.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'LinkedIn-Version': API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    signal: AbortSignal.timeout(25000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => `${e.name}: ${e.message}` }));

  if (r.status === 429) {
    hit429++;
    const wait = Math.min(60, 15 * hit429);
    console.log(`   429 — backoff ${wait}s`);
    await new Promise((s) => setTimeout(s, wait * 1000));
    calls--;
    return get(path, label, group);
  }

  const body = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* nie JSON */ }
  const entry = {
    group, label, path: path.split('?')[0], status: r.status, ok: r.ok,
    msg: r.ok ? '' : (parsed?.message || body.slice(0, 110)),
  };
  results.push(entry);
  console.log(`${r.ok ? '✅' : (r.status === 403 ? '🔒' : r.status === 404 ? '❔' : '❌')} ${String(r.status).padEnd(3)} ${label}`);
  if (r.ok && parsed) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${group}-${label.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify(parsed, null, 2));
  }
  await new Promise((s) => setTimeout(s, 2000));
  return { data: parsed, ok: r.ok, status: r.status };
}

// ── PROFIL ────────────────────────────────────────────────────────────────
console.log('\n═══ PROFIL ═══');
const me = await get('/rest/me', 'me — profil podstawowy', 'profil');
const personUrn = me.data?.id ? `urn:li:person:${me.data.id}` : '';
if (personUrn) {
  await get(`/rest/connections/${enc(personUrn)}`, 'connections — liczba kontaktów 1. st.', 'profil');
}

// ── STRONY FIRMOWE ────────────────────────────────────────────────────────
for (const org of ORGS) {
  const urn = `urn:li:organization:${org.id}`;
  const e = enc(urn);
  console.log(`\n═══ STRONA: ${org.name} (${org.id}) ═══`);
  await get(`/rest/organizations/${org.id}`, `${org.name} — dane strony`, 'strona');
  await get(`/rest/organizationPageStatistics?q=organization&organization=${e}`, `${org.name} — odsłony strony`, 'strona');
  await get(`/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${e}`, `${org.name} — followersi + demografia`, 'strona');
  await get(`/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${e}`, `${org.name} — METRYKI POSTÓW (impressions)`, 'strona');
  await get(`/rest/posts?q=author&author=${e}&count=10`, `${org.name} — posty strony`, 'strona');
  await get(`/rest/organizationalEntityNotifications?q=criteria&organizationalEntity=${e}`, `${org.name} — powiadomienia strony`, 'strona');
  await get(`/rest/vanityUrl?q=vanityUrlAsOrganization&organization=${e}`, `${org.name} — vanity URL`, 'strona');
  await get(`/rest/organizationBrands?q=vanityName&vanityName=${org.name.replace(/\..*$/, '')}`, `${org.name} — marki podrzędne`, 'strona');
  await get(`/rest/brandPageStatistics?q=brand&brand=${enc(`urn:li:organizationBrand:${org.id}`)}`, `${org.name} — statystyki brand page`, 'strona');
  await get(`/rest/videoAnalytics?q=entity&entity=${e}&type=VIDEO_VIEW`, `${org.name} — analityka wideo`, 'strona');
  await get(`/rest/peopleTypeahead?q=organizationFollowers&organization=${e}&keywords=bartosz`, `${org.name} — followersi (typeahead)`, 'strona');
}

// ── networkSizes: szukamy poprawnego edgeType ─────────────────────────────
console.log('\n═══ networkSizes — dobieranie edgeType ═══');
// Ustalone 2026-07-27: edgeType MUSI byc SCREAMING_SNAKE.
for (const org of ORGS) {
  await get(`/rest/networkSizes/${enc(`urn:li:organization:${org.id}`)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, `${org.name} — followersi total`, 'strona');
}

// ── INTEL / TAKSONOMIE ────────────────────────────────────────────────────
console.log('\n═══ INTEL + TAKSONOMIE ═══');
await get('/rest/adTargetingFacets', 'adTargetingFacets — wymiary targetowania', 'intel');
await get('/rest/seniorities', 'seniorities — poziomy stanowisk', 'intel');
await get('/rest/functions', 'functions — funkcje w firmie', 'intel');
await get('/rest/degrees', 'degrees — stopnie naukowe', 'intel');
await get('/rest/iabCategories', 'iabCategories — kategorie IAB', 'intel');
await get('/rest/skills?locale=(language:en,country:US)', 'skills — umiejętności', 'intel');
await get('/rest/titles', 'titles — stanowiska', 'intel');
await get('/rest/standardizedTitles', 'standardizedTitles', 'intel');
await get('/rest/geoTypeahead?q=search&query=Warszawa', 'geoTypeahead — lokalizacje', 'intel');
await get('/rest/industries', 'industries — branże', 'intel');
await get(`/rest/organizationsLookup?ids=List(72198432,109990139,134844053)`, 'organizationsLookup — dane firm', 'intel');
await get('/rest/adTargetingEntities?q=typeahead&facet=urn%3Ali%3AadTargetingFacet%3Aindustries&query=ecommerce', 'adTargetingEntities typeahead', 'intel');

// ── eventSubscriptions z wymaganym eventType ──────────────────────────────
console.log('\n═══ WEBHOOKI ═══');
for (const et of ['ORGANIZATION_SOCIAL_ACTION_NOTIFICATIONS', 'SHARE_STATISTICS', 'ORGANIZATION_LIFECYCLE_EVENTS']) {
  await get(`/rest/eventSubscriptions?q=subscriberAndEventType&eventType=${et}`, `eventSubscriptions eventType=${et}`, 'webhooki');
}

// ── MEDIA (czy da się wysyłać dokumenty/wideo) ─────────────────────────────
console.log('\n═══ MEDIA ═══');
// FINDER associatedAccount przyjmuje wylacznie konta reklamowe ("Owner is not a
// sponsored account urn"), wiec dla strony firmowej nie ma zastosowania. Upload
// idzie przez ACTION initializeUpload (POST), a probe jest read-only.
console.log('   pominiete: documents/videos/images FINDER associatedAccount — tylko konta reklamowe');

// ── RAPORT ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => r.ok);
console.log(`\n${'═'.repeat(70)}`);
console.log(`DZIAŁA: ${ok.length}/${results.length} | wywołań: ${calls}/${BUDGET} | 429: ${hit429}`);

const byGroup = {};
for (const r of results) (byGroup[r.group] ||= []).push(r);

const md = ['# Żniwa z konta — co realnie oddaje LinkedIn API', '',
  `Wygenerowane: \`scripts/harvest-account.mjs\`. Apka: Community Management API (Development Tier).`,
  `Wywołań: ${calls} | działa: ${ok.length}/${results.length} | trafień 429: ${hit429}`, '',
  'Surowe odpowiedzi: `~/.linkedin-mcp/harvest/`', ''];
for (const [g, rows] of Object.entries(byGroup)) {
  md.push(`## ${g}`, '', '| | HTTP | Zasób | Uwaga |', '|---|---|---|---|');
  for (const r of rows) {
    const m = r.ok ? '✅' : r.status === 403 ? '🔒' : r.status === 404 ? '❔' : '❌';
    md.push(`| ${m} | ${r.status} | ${r.label} | ${r.msg.slice(0, 90)} |`);
  }
  md.push('');
}
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'ACCOUNT-HARVEST.md'), md.join('\n') + '\n');
console.log('Raport: docs/ACCOUNT-HARVEST.md');
