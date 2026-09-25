// Bramka pre-publish (lib/publish-gate.mjs).
// Kluczowy wymog: post BEZ medium nie moze wyjsc. Historycznie 5 na 99
// opublikowanych postow mialo realnie wgrane medium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublishable, postDeclaresMedia } from '../lib/publish-gate.mjs';

const base = { post: {}, postKey: null, text: 'Tresc posta.', mediaUrns: [], mediaCategory: 'NONE' };

test('pusta tresc nie przechodzi', () => {
  assert.throws(() => assertPublishable({ ...base, text: '   ', mediaUrns: ['urn:1'], mediaCategory: 'IMAGE' }),
    /pusta treść/);
});

test('post bez medium NIE przechodzi', () => {
  assert.throws(() => assertPublishable(base), /bez medium/);
});

test('post bez medium przechodzi tylko ze swiadomym text_only_ok=1', () => {
  assert.doesNotThrow(() => assertPublishable({ ...base, post: { text_only_ok: 1 } }));
});

test('text_only_ok=0 nie jest furtka', () => {
  assert.throws(() => assertPublishable({ ...base, post: { text_only_ok: 0 } }), /bez medium/);
});

test('obraz bez ALT nie przechodzi', () => {
  assert.throws(
    () => assertPublishable({ ...base, post: { media_alt: 'krotki' }, mediaUrns: ['urn:1'], mediaCategory: 'IMAGE' }),
    /ALT/
  );
});

test('obraz z ALT >=15 znakow przechodzi', () => {
  assert.doesNotThrow(() =>
    assertPublishable({
      ...base,
      post: { media_alt: 'Zrzut panelu z lista zamowien klienta' },
      mediaUrns: ['urn:1'],
      mediaCategory: 'IMAGE',
    })
  );
});

test('karuzela nie wymaga ALT (PDF), ale liczy sie jako medium', () => {
  assert.doesNotThrow(() =>
    assertPublishable({ ...base, mediaUrns: ['urn:doc:1'], mediaCategory: 'DOCUMENT' })
  );
});

test('zadeklarowane media + brak URN = blad (upload sie nie udal)', () => {
  const post = { media_ids: JSON.stringify(['urn:li:image:x']) };
  assert.throws(() => assertPublishable({ ...base, post }), /upload nie dał URN/);
});

test('postDeclaresMedia czyta media_ids', () => {
  assert.equal(postDeclaresMedia({ media_ids: '["urn:li:image:x"]' }, null), true);
  assert.equal(postDeclaresMedia({ media_ids: '[]' }, null), false);
  assert.equal(postDeclaresMedia({}, null), false);
});

test('postDeclaresMedia nie wywraca sie na zepsutym JSON', () => {
  assert.equal(postDeclaresMedia({ media_ids: 'nie-json' }, null), false);
});

// ── Slady generatora (lib/ai-marks.mjs) ─────────────────────────────────────

test('tekst ze znakiem zerowej szerokosci nie przechodzi', () => {
  assert.throws(
    () => assertPublishable({ ...base, text: 'Wycena​rolet.', mediaUrns: ['urn:1'], mediaCategory: 'IMAGE', post: { media_alt: 'Zrzut konfiguratora wycen' } }),
    /śladów generatora/
  );
});

test('tekst z myslnikiem em nie przechodzi', () => {
  assert.throws(
    () => assertPublishable({ ...base, text: 'Wycena — rolet.', mediaUrns: ['urn:1'], mediaCategory: 'IMAGE', post: { media_alt: 'Zrzut konfiguratora wycen' } }),
    /śladów generatora/
  );
});

test('strzalka jako formatowanie listy przechodzi', () => {
  assert.doesNotThrow(
    () => assertPublishable({ ...base, text: 'krok 1 → krok 2', mediaUrns: ['urn:1'], mediaCategory: 'IMAGE', post: { media_alt: 'Zrzut konfiguratora wycen' } })
  );
});

// ── Tygodniowy limit postow bez medium ──────────────────────────────────────

test('pierwszy i drugi post bez medium w tygodniu przechodza', () => {
  for (const used of [0, 1]) {
    assert.doesNotThrow(
      () => assertPublishable({ ...base, post: { text_only_ok: 1 }, textOnlyUsedLast7Days: used })
    );
  }
});

test('trzeci post bez medium w tygodniu nie przechodzi', () => {
  assert.throws(
    () => assertPublishable({ ...base, post: { text_only_ok: 1 }, textOnlyUsedLast7Days: 2 }),
    /limit postów bez medium wyczerpany/
  );
});

test('limit nie dotyczy postow z medium', () => {
  assert.doesNotThrow(
    () => assertPublishable({ ...base, mediaUrns: ['urn:1'], mediaCategory: 'IMAGE', textOnlyUsedLast7Days: 9, post: { media_alt: 'Zrzut konfiguratora wycen' } })
  );
});
