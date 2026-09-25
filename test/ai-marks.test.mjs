import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAiMarks, checkAiMarks, findAiMarks, formatAiMarksReport } from '../lib/ai-marks.mjs';
import { humanizeText } from '../lib/humanize.mjs';

const ZWSP = '​';
const ZWNJ = '‌';
const ZWJ = '‍';
const BOM = '﻿';
const WJ = '⁠';
const LRM = '‎';
const SOFT_HYPHEN = '­';
const BIDI_OVERRIDE = '‮';
const BIDI_ISOLATE = '⁦';
const VS16 = '️';
const TAG = '\u{E0041}';
const LINE_SEP = ' ';
const NBSP = ' ';
const EN_QUAD = ' ';
const NARROW_NBSP = ' ';
const IDEOGRAPHIC_SPACE = '　';

test('usuwa znaki zerowej szerokosci i BOM', () => {
  const { text } = stripAiMarks(`wy${ZWSP}cena${ZWNJ} rolet${ZWJ}${BOM}${WJ}`);
  assert.equal(text, 'wycena rolet');
});

test('usuwa znaki kierunku, miekki lacznik, bidi, selektor wariantu i tag', () => {
  const { text } = stripAiMarks(`a${LRM}b${SOFT_HYPHEN}c${BIDI_OVERRIDE}d${BIDI_ISOLATE}e${VS16}f${TAG}g`);
  assert.equal(text, 'abcdefg');
});

test('usuwa separator linii i akapitu', () => {
  assert.equal(stripAiMarks(`a${LINE_SEP}b c`).text, 'abc');
});

test('nietypowe spacje zamienia na zwykla', () => {
  const { text } = stripAiMarks(`a${NBSP}b${EN_QUAD}c${NARROW_NBSP}d${IDEOGRAPHIC_SPACE}e`);
  assert.equal(text, 'a b c d e');
});

test('twarda typografia: cudzyslowy, wielokropek, myslniko-podobne', () => {
  const { text } = stripAiMarks('„cena” to ‘to’ samo… 10− 5 ― i ‐ tu');
  assert.equal(text, '"cena" to \'to\' samo... 10- 5 - i - tu');
});

test('myslnikow em i en NIE rusza, bo nalezą do humanizeText', () => {
  const { text } = stripAiMarks('wycena — rolet i 10–20 sztuk');
  assert.equal(text, 'wycena — rolet i 10–20 sztuk');
});

test('myslniki sa jednak WYKRYWANE jako naruszenie', () => {
  const marks = checkAiMarks('wycena — rolet');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].name, 'MYSLNIK (em/en dash)');
});

test('strzalki i punktory zostaja domyslnie, bo to swiadome formatowanie', () => {
  const src = 'krok 1 → krok 2\n• punkt';
  assert.equal(stripAiMarks(src).text, src);
  assert.equal(checkAiMarks(src).length, 0, 'poziom hard ich nie liczy');
  assert.equal(checkAiMarks(src, { strict: true }).length, 2, 'strict liczy oba');
});

test('tryb strict zamienia strzalki, punktory i znaki towarowe', () => {
  const { text } = stripAiMarks('a → b\n• c\n© d ✓ e', { strict: true });
  assert.equal(text, 'a -> b\n- c\n(c) d [ok] e');
});

test('emoji jest wykrywane, ale nigdy przepisywane', () => {
  const src = 'wynik ✅ gotowe';
  assert.equal(stripAiMarks(src, { strict: true }).text, src, 'emoji zostaje w tekscie');
  const soft = findAiMarks(src).filter((f) => f.name === 'SYMBOL/EMOJI');
  assert.equal(soft.length, 1);
  assert.equal(soft[0].tier, 'soft');
});

test('nie rusza dywizow w slowach ani wersji', () => {
  const src = 'e-mail, PN-EN 1090, ISO 9001:2015, mobile-first';
  assert.equal(stripAiMarks(src).text, src);
  assert.equal(checkAiMarks(src).length, 0);
});

test('idempotentny', () => {
  const src = `a${ZWSP}b${NBSP}c „d”…`;
  const once = stripAiMarks(src).text;
  assert.equal(stripAiMarks(once).text, once);
});

test('pozycja znaleziska: linia i kolumna liczone w punktach kodowych', () => {
  const marks = findAiMarks(`ok\nala${ZWSP}ma`);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].line, 2);
  assert.equal(marks[0].col, 4);
  assert.equal(marks[0].cp, 0x200b);
});

test('null i undefined nie wysadzaja', () => {
  assert.equal(stripAiMarks(null).text, '');
  assert.equal(stripAiMarks(undefined).text, '');
  assert.deepEqual(checkAiMarks(null), []);
});

test('raport ma format skilla', () => {
  assert.equal(formatAiMarksReport('czysty tekst', 'post.md'), 'CZYSTY: post.md');
  const rep = formatAiMarksReport(`a${ZWSP}b`, 'post.md');
  assert.match(rep, /^ZNALEZIONO 1 w post\.md:/);
  assert.match(rep, /linia 1, kol 2: U\+200B {2}ZERO WIDTH SPACE/);
});

// ── integracja z humanizeText ──────────────────────────────────────────────

test('humanizeText czysci znaki niewidoczne i nadal nie tyka URL-i', () => {
  const out = humanizeText(`Zobacz${ZWSP} https://bartoszgaca.pl/case-studies teraz${BOM}`);
  assert.equal(out, 'Zobacz https://bartoszgaca.pl/case-studies teraz');
});

test('humanizeText: po przejsciu tekst nie ma juz zadnych sladow hard', () => {
  const brudny = `Wycena${ZWSP} rolet — 10–20 sztuk${NBSP}i „koniec”…`;
  const out = humanizeText(brudny);
  assert.deepEqual(checkAiMarks(out), [], 'zero naruszen po humanizeText');
  assert.match(out, /10-20/, 'zakres liczbowy zostaje dywizem');
});

test('humanizeText zostaje idempotentny po dolozeniu ai-marks', () => {
  const brudny = `a${ZWSP}b — c\n— punkt\n10–20`;
  const once = humanizeText(brudny);
  assert.equal(humanizeText(once), once);
});
