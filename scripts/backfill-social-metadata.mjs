#!/usr/bin/env node
/**
 * Backfill socialMetadata z oficjalnego API dla wszystkich opublikowanych postów.
 *
 * Dlaczego to ma sens teraz: scope `w_member_social_feed` z nowej apki otworzył
 * /rest/socialMetadata/{entity} (potwierdzone probe'em 2026-07-26). Tabela
 * social_metadata miała 25 wierszy ze 152 postów nie z powodu limitów, a z
 * powodu braku tego scope'a.
 *
 * Czego to NIE daje: impressions ani zasięgu. Te siedzą w
 * memberCreatorPostAnalytics, którego Development Tier nie udostępnia (404).
 * Do tego potrzebny jest upgrade produktu w portalu.
 *
 * Bezpieczniki:
 *   - tylko GET, zero zapisów po stronie LinkedIna
 *   - twardy limit wywołań z API_DAILY_BUDGET (domyślnie 500)
 *   - odstęp między wywołaniami, backoff na 429
 *   - obsługa obu typów URN (share i ugcPost) — post opublikowany starą apką
 *     może mieć inny typ, niż zwraca dzisiejsze API
 *
 * Użycie:
 *   node scripts/backfill-social-metadata.mjs --dry
 *   node scripts/backfill-social-metadata.mjs --apply [--limit 50]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202503';
const BUDGET = parseInt(process.env.API_DAILY_BUDGET || '500', 10);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

const auth = JSON.parse(readFileSync(join(DATA_DIR, 'org-auth.json'), 'utf8'));
const TOKEN = auth.access_token;

const sched = new Database(join(DATA_DIR, 'scheduler.db'), { readonly: true });
const posts = sched.prepare(
  `SELECT id, post_urn, date(published_at) d FROM scheduled_posts
   WHERE post_urn IS NOT NULL AND post_urn != '' AND status = 'published'
   ORDER BY published_at DESC`
).all().slice(0, LIMIT === Infinity ? undefined : LIMIT);
sched.close();

const adb = new Database(join(DATA_DIR, 'analytics.db'));
// WŁASNA tabela, nie social_metadata. Pierwsza wersja tego skryptu nadpisywała
// social_metadata i skasowała 5 wierszy lepszymi danymi ze scrapera (post
// 7434531282274992128: 27 reakcji -> 1). API systematycznie zaniża względem
// eksportu XLSX (~44%), więc te dwa źródła NIE MOGĄ dzielić jednego wiersza.
adb.exec(`CREATE TABLE IF NOT EXISTS api_social_metadata (
  post_urn TEXT PRIMARY KEY, like_count INT, praise_count INT, empathy_count INT,
  interest_count INT, appreciation_count INT, entertainment_count INT,
  comment_count INT, comment_top_level INT, fetched_at TEXT)`);

const upsert = adb.prepare(`
  INSERT INTO api_social_metadata (post_urn, like_count, praise_count, empathy_count, interest_count,
                                   appreciation_count, entertainment_count, comment_count,
                                   comment_top_level, fetched_at)
  VALUES (@post_urn, @like_count, @praise_count, @empathy_count, @interest_count,
          @appreciation_count, @entertainment_count, @comment_count,
          @comment_top_level, datetime('now'))
  ON CONFLICT(post_urn) DO UPDATE SET
    like_count=@like_count, praise_count=@praise_count, empathy_count=@empathy_count,
    interest_count=@interest_count, appreciation_count=@appreciation_count,
    entertainment_count=@entertainment_count, comment_count=@comment_count,
    comment_top_level=@comment_top_level, fetched_at=datetime('now')
`);

async function fetchMeta(urn) {
  const url = `https://api.linkedin.com/rest/socialMetadata/${encodeURIComponent(urn)}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'LinkedIn-Version': API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    signal: AbortSignal.timeout(25000),
  });
  if (r.status === 429) return { retry: true };
  if (!r.ok) return { error: r.status, body: (await r.text()).slice(0, 120) };
  return { data: await r.json() };
}

// Post opublikowany jako share może być widoczny pod urn:li:ugcPost i odwrotnie.
function variants(urn) {
  const id = urn.split(':').pop();
  return urn.includes(':share:')
    ? [urn, `urn:li:ugcPost:${id}`]
    : [urn, `urn:li:share:${id}`];
}

const R = (rs, k) => rs?.[k]?.count || 0;

console.log(`Backfill socialMetadata — ${posts.length} postów, budżet ${BUDGET} wywołań`);
console.log(`tryb: ${APPLY ? 'APPLY' : 'DRY (bez zapisu)'}\n`);

let calls = 0, ok = 0, failed = 0, reactions = 0, comments = 0;

for (const p of posts) {
  if (calls >= BUDGET) { console.log(`\n! budżet ${BUDGET} wyczerpany — przerywam`); break; }

  let got = null, lastErr = null;
  for (const urn of variants(p.post_urn)) {
    if (calls >= BUDGET) break;
    calls++;
    let res = await fetchMeta(urn);
    if (res.retry) {
      console.log('  429 — czekam 30 s');
      await new Promise((s) => setTimeout(s, 30000));
      calls++;
      res = await fetchMeta(urn);
    }
    if (res.data) { got = { urn, data: res.data }; break; }
    lastErr = res.error ? `${res.error}` : 'nieznany';
    await new Promise((s) => setTimeout(s, 300));
  }

  if (!got) {
    failed++;
    console.log(`✗ ${p.post_urn.slice(-19)}  ${p.d}  HTTP ${lastErr}`);
    continue;
  }

  const rs = got.data.reactionSummaries || {};
  const cs = got.data.commentSummary || {};
  const row = {
    post_urn: p.post_urn,
    like_count: R(rs, 'LIKE'),
    praise_count: R(rs, 'PRAISE'),
    empathy_count: R(rs, 'EMPATHY'),
    interest_count: R(rs, 'INTEREST'),
    appreciation_count: R(rs, 'APPRECIATION'),
    entertainment_count: R(rs, 'ENTERTAINMENT'),
    // aggregatedTotalComments nie wraca z tej wersji API — to komentarze 1. poziomu
    comment_count: cs.aggregatedTotalComments ?? cs.count ?? 0,
    comment_top_level: cs.count ?? 0,
  };
  const tot = row.like_count + row.praise_count + row.empathy_count + row.interest_count
            + row.appreciation_count + row.entertainment_count;
  reactions += tot;
  comments += row.comment_count;
  ok++;

  if (APPLY) upsert.run(row);
  console.log(`✓ ${p.post_urn.slice(-19)}  ${p.d}  reakcje=${String(tot).padEnd(4)} komentarze=${row.comment_count}`);
  await new Promise((s) => setTimeout(s, 300));
}

console.log(`\n${'─'.repeat(64)}`);
console.log(`pobrane: ${ok} | nieudane: ${failed} | wywołań API: ${calls}/${BUDGET}`);
console.log(`suma reakcji: ${reactions} | suma komentarzy: ${comments}`);
if (APPLY) {
  const n = adb.prepare('SELECT COUNT(*) c FROM api_social_metadata').get().c;
  console.log(`api_social_metadata: ${n} wierszy (social_metadata NIETKNIĘTE)`);
} else {
  console.log('DRY — uruchom z --apply, żeby zapisać.');
}
adb.close();
