// Bramki ICP (guidelines/icp.json): zargon na torze K + rozpoznanie toru.
// Testujemy czysta logike, bez LLM i bez bazy — tak jak test/humanize.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const icp = JSON.parse(readFileSync(join(__dirname, '..', 'guidelines', 'icp.json'), 'utf8'));

// Te dwie funkcje sa kopia logiki z qa-gate.mjs (qa-gate importuje better-sqlite3
// na starcie, wiec nie da sie go zaimportowac w tescie bez bazy).
function laneOf(post) {
  const l = String(post.lane || '').toUpperCase();
  return l === 'P' ? 'P' : 'K';
}
function jargonHits(text, lane) {
  const banned = icp.lanes?.[lane]?.banned_jargon || [];
  const hits = [];
  for (const w of banned) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) hits.push(w);
  }
  return hits;
}

test('icp.json ma oba tory i persony toru K', () => {
  assert.ok(icp.lanes.K, 'brak toru K');
  assert.ok(icp.lanes.P, 'brak toru P');
  assert.equal(icp.lanes.K.personas.length, 7, 'tor K ma miec 7 person (a1-a7)');
  // kazda persona toru K wskazuje na istniejacy artykul z systemu a1-a7
  for (const p of icp.lanes.K.personas) {
    assert.match(p.article, /^a[1-7]-/, `persona ${p.key} nie wskazuje na artykul a1-a7`);
  }
});

test('brak lane = tor K (domyslnie ostrzejszy)', () => {
  assert.equal(laneOf({}), 'K');
  assert.equal(laneOf({ lane: null }), 'K');
  assert.equal(laneOf({ lane: 'p' }), 'P');
  assert.equal(laneOf({ lane: 'K' }), 'K');
});

test('zargon na torze K jest wykrywany', () => {
  const post = 'Zbudowalem serwer MCP, ktory spina RAG z pipeline i robi deploy co noc.';
  const hits = jargonHits(post, 'K');
  assert.ok(hits.includes('MCP'), 'MCP nie wykryte');
  assert.ok(hits.includes('RAG'), 'RAG nie wykryte');
  assert.ok(hits.includes('pipeline'), 'pipeline nie wykryte');
  assert.ok(hits.includes('deploy'), 'deploy nie wykryte');
});

test('tekst dla klienta przechodzi bez trafien', () => {
  const post =
    'Wlascicielka biura rachunkowego przepisywala faktury z maila do Excela. ' +
    'Dwie godziny dziennie. Teraz robi to program, a ona sprawdza wyjatki. ' +
    'Ile faktur miesiecznie przechodzi przez Wasze biuro?';
  assert.deepEqual(jargonHits(post, 'K'), []);
});

test('zargon NIE blokuje toru P', () => {
  const post = 'Serwer MCP + Claude Code, deploy przez Dockera.';
  assert.deepEqual(jargonHits(post, 'P'), [], 'tor P nie ma listy zakazanych slow');
  assert.ok(jargonHits(post, 'K').length > 0, 'ten sam tekst ma lecec na torze K');
});

test('dopasowanie po granicy slowa, nie po fragmencie', () => {
  // "API" nie moze trafiac w srodku slowa (np. "kapitan", "APIspecjalista")
  assert.deepEqual(jargonHits('Kapitan wszedl na poklad.', 'K'), []);
  assert.ok(jargonHits('Podpialem sie pod API urzedu.', 'K').includes('API'));
});

test('wielkosc liter nie ma znaczenia', () => {
  assert.ok(jargonHits('zrobilem mu deploy w nocy', 'K').includes('deploy'));
  assert.ok(jargonHits('DEPLOY poszedl gladko', 'K').includes('deploy'));
});
