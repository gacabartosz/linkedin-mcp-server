import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeText } from '../lib/humanize.mjs';

test('em-dash jako pauza → przecinek', () => {
  assert.equal(humanizeText('AI — to nie magia.'), 'AI, to nie magia.');
  assert.equal(humanizeText('zrobiłem to – i zadziałało'), 'zrobiłem to, i zadziałało');
});

test('zakres liczbowy zostaje dywizem (cyfry nietknięte)', () => {
  assert.equal(humanizeText('10–20 firm'), '10-20 firm');
  assert.equal(humanizeText('koszt 100 — 200 zł'), 'koszt 100-200 zł');
});

test('punktor myślnikiem na początku linii → "- "', () => {
  assert.equal(humanizeText('— pierwszy\n— drugi'), '- pierwszy\n- drugi');
});

test('spacja przed interpunkcją usunięta', () => {
  assert.equal(humanizeText('słowo , drugie .'), 'słowo, drugie.');
  assert.equal(humanizeText('co teraz ? nie wiem !'), 'co teraz? nie wiem!');
});

test('multi-spacja → pojedyncza, newline zostaje', () => {
  assert.equal(humanizeText('za    dużo   spacji'), 'za dużo spacji');
  assert.equal(humanizeText('linia1\n\n\n\nlinia2'), 'linia1\n\nlinia2');
});

test('podwójne przecinki i spacje w nawiasach', () => {
  assert.equal(humanizeText('tak,, no i ( ważne )'), 'tak, no i (ważne)');
});

test('resztki markdown usuwane', () => {
  assert.equal(humanizeText('## Nagłówek'), 'Nagłówek');
  assert.equal(humanizeText('to jest **ważne** i `kod`'), 'to jest ważne i kod');
  assert.equal(humanizeText('> cytat'), 'cytat');
});

test('typografia: fancy cudzysłowy i wielokropek', () => {
  assert.equal(humanizeText('„cytat” i …'), '"cytat" i...');
  assert.equal(humanizeText('to’s'), "to's");
});

test('URL nietknięty mimo myślników i interpunkcji obok', () => {
  const out = humanizeText('repo: https://github.com/a/b—c?x=1 — sprawdź');
  assert.ok(out.includes('https://github.com/a/b—c?x=1'), out);
  assert.ok(out.includes(', sprawdź'), out);
});

test('idempotencja', () => {
  const cases = [
    'AI — to nie magia, naprawdę   .',
    '10–20 firm, koszt 100 — 200 zł',
    '## Tytuł\n\n\n— punkt\nlink https://x.io — koniec',
  ];
  for (const c of cases) {
    const once = humanizeText(c);
    assert.equal(humanizeText(once), once, `nieidempotentne dla: ${JSON.stringify(c)}`);
  }
});

test('flaga enabled=false = no-op', () => {
  const raw = 'AI — bez zmian   .';
  assert.equal(humanizeText(raw, { enabled: false }), raw);
});

test('null/undefined → pusty string', () => {
  assert.equal(humanizeText(null), '');
  assert.equal(humanizeText(undefined), '');
});
