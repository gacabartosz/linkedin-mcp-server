#!/usr/bin/env node
/**
 * API Probe — empiryczna macierz "co realnie działa" na LinkedIn REST API.
 *
 * Lista endpointów pochodzi z oficjalnej strony "Product API endpoints" w portalu
 * LinkedIn Developers (Community Management API, Development Tier). Skrypt NIE
 * zgaduje ścieżek — sprawdza je i zapisuje realne kody HTTP oraz próbkę odpowiedzi.
 *
 * Tylko GET/FINDER. Zero zapisów, zero POST/DELETE — probe nie może nic zepsuć.
 *
 * Wynik: tabela api_endpoint_probe w analytics.db + docs/API-CAPABILITY-MATRIX.md
 *
 * Użycie:
 *   node scripts/api-probe.mjs                 # token członkowski (auth.json)
 *   node scripts/api-probe.mjs --app org       # token apki org (org-auth.json)
 *   node scripts/api-probe.mjs --only analytics
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202503';

const args = process.argv.slice(2);
const APP = args.includes('--app') ? args[args.indexOf('--app') + 1] : 'member';
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// ── token ─────────────────────────────────────────────────────────────────
const authFile = join(DATA_DIR, APP === 'org' ? 'org-auth.json' : 'auth.json');
if (!existsSync(authFile)) {
  console.error(`Brak ${authFile} — najpierw autoryzuj apkę '${APP}'.`);
  process.exit(1);
}
const auth = JSON.parse(readFileSync(authFile, 'utf8'));
const TOKEN = auth.access_token;
const PERSON = auth.person_urn || process.env.LINKEDIN_PERSON_URN || '';
const ORG = process.env.LINKEDIN_ORG_URN || '';
const SCOPES = (auth.scopes || []).join(' ');

// URN własnego posta do testów per-entity: bierzemy realny opublikowany post.
let SAMPLE_POST = '';
try {
  const db = new Database(join(DATA_DIR, 'scheduler.db'), { readonly: true });
  SAMPLE_POST = db.prepare(
    "SELECT post_urn FROM scheduled_posts WHERE post_urn IS NOT NULL AND post_urn != '' ORDER BY published_at DESC LIMIT 1"
  ).get()?.post_urn || '';
  db.close();
} catch { /* brak bazy = testy per-entity pomijamy */ }

const enc = encodeURIComponent;

// ── lista endpointów z oficjalnej dokumentacji portalu ────────────────────
const ENDPOINTS = [
  // --- analytics: r_member_postAnalytics ---
  { group: 'analytics', scope: 'r_member_postAnalytics', path: `/rest/memberCreatorPostAnalytics?q=me&queryType=IMPRESSION&aggregation=TOTAL`, note: 'agregat wszystkich moich postów' },
  { group: 'analytics', scope: 'r_member_postAnalytics', path: SAMPLE_POST ? `/rest/memberCreatorPostAnalytics?q=entity&entity=(ugc:${enc(SAMPLE_POST)})&queryType=IMPRESSION&aggregation=TOTAL` : null, note: 'metryki jednego posta' },
  { group: 'analytics', scope: 'r_member_postAnalytics', path: SAMPLE_POST ? `/rest/memberCreatorVideoAnalytics?q=entity&entity=(ugc:${enc(SAMPLE_POST)})` : null, note: 'metryki wideo' },

  // --- profil: r_member_profileAnalytics ---
  { group: 'profile', scope: 'r_member_profileAnalytics', path: `/rest/memberFollowersCount?q=me`, note: 'liczba followersów teraz' },
  { group: 'profile', scope: 'r_member_profileAnalytics', path: `/rest/memberFollowersCount?q=dateRange`, note: 'followersi w czasie' },

  // --- tożsamość: r_basicprofile ---
  { group: 'identity', scope: 'r_basicprofile', path: `/rest/me`, note: 'podstawowy profil' },
  { group: 'identity', scope: '(brak)', path: `/v2/userinfo`, note: 'OpenID userinfo — działa na obecnym tokenie' },
  { group: 'identity', scope: 'r_basicprofile', path: `/rest/industries?ids=List(4)`, note: 'taksonomia branż' },

  // --- kontakty: r_1st_connections_size ---
  { group: 'connections', scope: 'r_1st_connections_size', path: PERSON ? `/rest/connections/${enc(PERSON)}` : null, note: 'liczba kontaktów 1. stopnia' },

  // --- posty ---
  { group: 'posts', scope: 'r_organization_social', path: PERSON ? `/rest/posts?q=author&author=${enc(PERSON)}&count=5` : null, note: 'NIEWIADOMA N1: czy FINDER author działa dla person URN' },
  { group: 'posts', scope: 'r_organization_social', path: SAMPLE_POST ? `/rest/posts/${enc(SAMPLE_POST)}` : null, note: 'pojedynczy post' },

  // --- social feed: w_member_social_feed ---
  { group: 'social', scope: 'w_member_social_feed', path: SAMPLE_POST ? `/rest/socialActions/${enc(SAMPLE_POST)}/comments` : null, note: 'komentarze pod postem' },
  { group: 'social', scope: 'w_member_social_feed', path: SAMPLE_POST ? `/rest/socialActions/${enc(SAMPLE_POST)}/likes` : null, note: 'lista lajkujących' },
  { group: 'social', scope: 'w_member_social_feed', path: SAMPLE_POST ? `/rest/socialMetadata/${enc(SAMPLE_POST)}` : null, note: 'PEŁNE rozbicie reakcji' },

  // --- organizacja: rw_organization_admin ---
  { group: 'org', scope: 'rw_organization_admin', path: `/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, note: 'których stron jestem adminem' },
  { group: 'org', scope: 'rw_organization_admin', path: ORG ? `/rest/organizations/${enc(ORG.split(':').pop())}` : null, note: 'dane mojej strony' },
  { group: 'org', scope: 'rw_organization_admin', path: ORG ? `/rest/organizationPageStatistics?q=organization&organization=${enc(ORG)}` : null, note: 'statystyki strony' },
  { group: 'org', scope: 'rw_organization_admin', path: ORG ? `/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${enc(ORG)}` : null, note: 'followersi + demografia' },
  { group: 'org', scope: 'rw_organization_admin', path: ORG ? `/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${enc(ORG)}` : null, note: 'metryki postów firmy' },
  { group: 'org', scope: 'rw_organization_admin', path: ORG ? `/rest/organizationalEntityNotifications?q=criteria&organizationalEntity=${enc(ORG)}` : null, note: 'feed powiadomień strony' },
  { group: 'org', scope: 'r_organization_social', path: ORG ? `/rest/posts?q=author&author=${enc(ORG)}&count=5` : null, note: 'posty strony' },
  { group: 'org', scope: 'r_organization_followers', path: ORG ? `/rest/vanityUrl?q=vanityUrlAsOrganization&organization=${enc(ORG)}` : null, note: 'vanity URL strony' },

  // --- events / subskrypcje: NIEWIADOMA N3 ---
  { group: 'events', scope: 'rw_organization_admin', path: ORG ? `/rest/events?q=eventsByOrganizer&organizer=${enc(ORG)}` : null, note: 'NIEWIADOMA N3: LinkedIn Events organizatora' },
  { group: 'events', scope: 'rw_organization_admin', path: `/rest/eventSubscriptions?q=subscriberAndEventType`, note: 'NIEWIADOMA N3: webhooki czy uczestnicy?' },

  // --- bez scope / "Application (3-legged)": NIEWIADOMA N4 ---
  { group: 'intel', scope: '(brak)', path: `/rest/organizationsLookup?ids=List(${enc(ORG || 'urn:li:organization:1035')})`, note: 'NIEWIADOMA N4: dane dowolnej firmy' },
  { group: 'intel', scope: '(brak)', path: ORG ? `/rest/networkSizes/${enc(ORG)}?edgeType=CompanyFollowedByMember` : null, note: 'NIEWIADOMA N4: licznik followersów' },
  { group: 'intel', scope: '(brak)', path: `/rest/adTargetingFacets`, note: 'NIEWIADOMA N4: wymiary targetowania' },
  { group: 'intel', scope: '(brak)', path: `/rest/geoTypeahead?q=search&query=Warszawa`, note: 'NIEWIADOMA N4: taksonomia geo' },
  { group: 'intel', scope: '(brak)', path: `/rest/seniorities`, note: 'NIEWIADOMA N4: taksonomia senioralności' },
].filter((e) => e.path && (!ONLY || e.group === ONLY));

// ── probe ─────────────────────────────────────────────────────────────────
async function probe(ep) {
  const url = `https://api.linkedin.com${ep.path}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'X-Restli-Protocol-Version': '2.0.0',
  };
  if (ep.path.startsWith('/rest/')) headers['LinkedIn-Version'] = API_VERSION;

  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    return {
      status: r.status,
      ms: Date.now() - t0,
      works: r.ok,
      sample: body.slice(0, 400),
      // LinkedIn zwraca powód odmowy w treści — to on mówi, czy blokuje scope
      // czy brak uprawnień do zasobu.
      reason: r.ok ? '' : (() => {
        try { return JSON.parse(body).message || ''; } catch { return body.slice(0, 200); }
      })(),
    };
  } catch (err) {
    return { status: 0, ms: Date.now() - t0, works: false, sample: '', reason: `${err.name}: ${err.message}` };
  }
}

// ── main ──────────────────────────────────────────────────────────────────
console.log(`API Probe — apka: ${APP}`);
console.log(`token scopes: ${SCOPES || '(nieznane)'}`);
console.log(`person: ${PERSON || '—'} | org: ${ORG || '—'}`);
console.log(`próbka posta: ${SAMPLE_POST || '— (brak opublikowanych postów z URN)'}`);
console.log(`endpointów do sprawdzenia: ${ENDPOINTS.length}\n`);

const db = new Database(join(DATA_DIR, 'analytics.db'));
db.exec(`CREATE TABLE IF NOT EXISTS api_endpoint_probe (
  endpoint TEXT, method TEXT, scope TEXT, app TEXT, http_status INTEGER,
  works INTEGER, reason TEXT, sample TEXT, tested_at TEXT,
  PRIMARY KEY (endpoint, method, app)
)`);
const save = db.prepare(`INSERT OR REPLACE INTO api_endpoint_probe
  (endpoint, method, scope, app, http_status, works, reason, sample, tested_at)
  VALUES (?, 'GET', ?, ?, ?, ?, ?, ?, datetime('now'))`);

const results = [];
for (const ep of ENDPOINTS) {
  const r = await probe(ep);
  const mark = r.works ? '✅' : (r.status === 403 ? '🔒' : (r.status === 404 ? '❔' : '❌'));
  const shortPath = ep.path.split('?')[0];
  console.log(`${mark} ${String(r.status).padEnd(3)} ${shortPath.padEnd(52)} ${ep.scope}`);
  if (!r.works && r.reason) console.log(`        ${r.reason.slice(0, 150)}`);
  save.run(ep.path, ep.scope, APP, r.status, r.works ? 1 : 0, r.reason, r.sample);
  results.push({ ...ep, ...r });
  await new Promise((s) => setTimeout(s, 350)); // delikatnie z limitem
}
db.close();

// ── raport ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => r.works);
const forbidden = results.filter((r) => r.status === 403);
const notFound = results.filter((r) => r.status === 404);
const other = results.filter((r) => !r.works && r.status !== 403 && r.status !== 404);

console.log(`\n${'─'.repeat(70)}`);
console.log(`DZIAŁA: ${ok.length}/${results.length}  |  403 brak uprawnień: ${forbidden.length}  |  404: ${notFound.length}  |  inne: ${other.length}`);

const md = [
  '# Macierz zdolności LinkedIn API',
  '',
  `Wygenerowane przez \`scripts/api-probe.mjs\` — realne kody HTTP, nie dokumentacja.`,
  '',
  `- apka: **${APP}**`,
  `- scope'y tokena: \`${SCOPES || 'nieznane'}\``,
  `- wersja API: \`${API_VERSION}\``,
  '',
  '| | HTTP | Endpoint | Wymagany scope | Co daje |',
  '|---|---|---|---|---|',
  ...results.map((r) => {
    const mark = r.works ? '✅' : r.status === 403 ? '🔒' : r.status === 404 ? '❔' : '❌';
    return `| ${mark} | ${r.status} | \`${r.path.split('?')[0]}\` | ${r.scope} | ${r.note} |`;
  }),
  '',
  '**Legenda:** ✅ działa · 🔒 403 (brak scope/uprawnień) · ❔ 404 (ścieżka lub zasób nie istnieje) · ❌ inny błąd',
  '',
  '## Powody odmowy',
  '',
  ...results.filter((r) => !r.works && r.reason).map((r) => `- \`${r.path.split('?')[0]}\` → **${r.status}**: ${r.reason.slice(0, 300)}`),
];
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', `API-CAPABILITY-MATRIX-${APP}.md`), md.join('\n') + '\n');
console.log(`Raport: docs/API-CAPABILITY-MATRIX-${APP}.md`);
