// Bramki pre-publish: albo komplet poprawny, albo throw (-> retry/failed + alert).
// Wydzielone z auto-publish.mjs, zeby dalo sie je przetestowac bez startowania
// daemona (auto-publish.mjs odpala setInterval juz przy imporcie).
//
// Gwarancje:
//  1. nigdy nie wychodzi post z pusta trescia,
//  2. nigdy nie wychodzi post, ktory deklaruje media, ale upload nie dal URN-a,
//  3. nigdy nie wychodzi post BEZ medium (chyba ze text_only_ok=1),
//  4. obraz/wideo zawsze z ALT-textem,
//  5. nigdy nie wychodzi tekst ze sladami generatora (znaki niewidoczne, myslniki),
//  6. posty bez medium maja tygodniowy limit, zeby zawor nie stal sie norma.
import { existsSync } from 'node:fs';
import { checkAiMarks } from './ai-marks.mjs';

// Ile postow BEZ medium wolno wypuscic w oknie 7 dni. Zawor bezpieczenstwa, nie norma.
// Historia: bramka "kazdy post ma medium" z 10.08.2026 nie miala ani limitu wyjatkow,
// ani widoku "czego brakuje", wiec zatrzymala caly pipeline na 35 dni po cichu.
export const TEXT_ONLY_WEEKLY_LIMIT = 2;

// Czy post DEKLARUJE media (gdy tak — publikacja bez zdjecia to BLAD, nie "ok").
export function postDeclaresMedia(post, postKey, { images = {}, carousels = {} } = {}) {
  try { if (post.media_ids && JSON.parse(post.media_ids).length > 0) return true; } catch {}
  if (post.media_preview_path && existsSync(post.media_preview_path)) return true;
  if (postKey && images[postKey] && existsSync(images[postKey])) return true;
  if (postKey && carousels[postKey] && existsSync(carousels[postKey])) return true;
  return false;
}

export function assertPublishable({
  post, postKey, text, mediaUrns, mediaCategory, maps,
  textOnlyUsedLast7Days = 0,
}) {
  if (!text || !text.trim()) throw new Error('GATE: pusta treść posta');

  // Slady generatora. Ostatnia linia obrony: humanizeText leci wczesniej (qa-gate
  // i createPost), ale post moze trafic tu takze recznie z panelu albo z importu.
  // Audyt korpusu z 03.09.2026: 79 z 99 opublikowanych postow mialo slady, w tym
  // ZERO WIDTH JOINER i VARIATION SELECTOR, ktore realnie poszly na LinkedIna.
  const marks = checkAiMarks(text);
  if (marks.length > 0) {
    const top = marks.slice(0, 5).map(
      (m) => 'U+' + m.cp.toString(16).toUpperCase().padStart(4, '0') + ' (linia ' + m.line + ', kol ' + m.col + ')'
    ).join(', ');
    throw new Error(
      'GATE: tekst ma ' + marks.length + ' śladów generatora — NIE publikuję. ' +
      'Pierwsze: ' + top + '. Przepuść treść przez humanizeText().'
    );
  }

  if (postDeclaresMedia(post, postKey, maps) && (mediaUrns.length === 0 || mediaCategory === 'NONE')) {
    throw new Error('GATE: post deklaruje media, ale upload nie dał URN — NIE publikuję bez zdjęcia');
  }

  // WYMÓG: każdy post ma mieć obraz, karuzelę albo wideo.
  // Historia: 5 na 99 opublikowanych postów miało realnie wgrane medium, mimo że 23
  // miały ustawione media_kind — dlatego bramka patrzy na URN-y z uploadu, a NIE na
  // media_kind (ta kolumna kłamie). Świadome odstępstwo: text_only_ok=1 ustawiane
  // ręcznie w panelu, np. gdy nie ma realnego zrzutu, a dorabianie banera jest zakazane.
  if (mediaUrns.length === 0 && Number(post.text_only_ok) !== 1) {
    throw new Error(
      'GATE: post bez medium (obraz/karuzela/wideo) — NIE publikuję. ' +
      'Dodaj realny zrzut z biblioteki albo ustaw text_only_ok=1 świadomie.'
    );
  }

  // Limit tygodniowy na zawor text_only_ok. Bez niego "swiadome odstepstwo" po
  // kilku tygodniach staje sie domyslnym trybem pracy i wymog medium jest fikcja.
  if (mediaUrns.length === 0 && textOnlyUsedLast7Days >= TEXT_ONLY_WEEKLY_LIMIT) {
    throw new Error(
      'GATE: limit postów bez medium wyczerpany (' + textOnlyUsedLast7Days + '/' +
      TEXT_ONLY_WEEKLY_LIMIT + ' w ostatnich 7 dniach) — NIE publikuję. ' +
      'Zrób zdjęcie albo przesuń post na przyszły tydzień.'
    );
  }

  // Obraz ZAWSZE z ALT-textem (dostępność + cytowalność przez AI).
  // Dokument/karuzela zwykle nie mają alt (PDF), więc dotyczy tylko IMAGE/VIDEO.
  if (mediaUrns.length > 0 && (mediaCategory === 'IMAGE' || mediaCategory === 'VIDEO')) {
    const alt = (post.media_alt || '').trim();
    if (alt.length < 15) {
      throw new Error('GATE: post z obrazem bez ALT-textu (min 15 zn.) — NIE publikuję. Uzupełnij media_alt.');
    }
  }
}
