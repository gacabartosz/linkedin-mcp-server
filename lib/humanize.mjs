/**
 * humanize.mjs — deterministyczny pass "pisz jak człowiek" (BEZ LLM).
 *
 * Po co: usuwanie myślników i artefaktów AI istniało dotąd TYLKO jako reguła
 * w prompcie (algorithm-2026.json → ai_red_flags), więc zależało od tego, czy
 * model posłucha. Nie wystarczało. Ten moduł gwarantuje czyszczenie niezależnie
 * od LLM — odpalany na końcu qa-gate.mjs (na humanizedText) i defensywnie w
 * auto-publish.mjs przed escapeLinkedInText (łapie też ręcznie wpisane posty
 * i auto-komentarze).
 *
 * Gwarancje:
 *   - NIE rusza URL-i (chronione sentinelami na czas obróbki).
 *   - NIE zmienia liczb (zakresy 10–20 → 10-20 dywizem, nie usuwa cyfr).
 *   - Idempotentny: humanizeText(humanizeText(x)) === humanizeText(x).
 *
 * Konfigurowalny: opts.enabled=false → zwraca tekst bez zmian (flaga
 * brand-voice.json: "humanize": false).
 */

const URL_RE = /\bhttps?:\/\/\S+/gi;
// Sentinel ze znaku sterującego (U+0001) — nie jest whitespace ani interpunkcją,
// więc żadna reguła (collapse spacji, trim, dash→przecinek) go nie tknie ani nie
// zje. Dzięki temu URL zawsze da się przywrócić. Budowany z fromCharCode, by nie
// trzymać surowego znaku sterującego w źródle.
const SENT = String.fromCharCode(1);

/** Wyjmij URL-e, żeby żadna reguła ich nie tknęła; przywróć po obróbce. */
function protectUrls(text) {
  const urls = [];
  const masked = text.replace(URL_RE, (m) => {
    urls.push(m);
    return `${SENT}${urls.length - 1}${SENT}`;
  });
  return { masked, urls };
}
function restoreUrls(text, urls) {
  return text.replace(new RegExp(`${SENT}(\\d+)${SENT}`, 'g'), (_, i) => urls[Number(i)] ?? '');
}

/**
 * @param {string} input
 * @param {{enabled?: boolean}} [opts]
 * @returns {string}
 */
export function humanizeText(input, opts = {}) {
  if (opts.enabled === false) return String(input ?? '');
  if (input == null) return '';
  let t = String(input);
  const { masked, urls } = protectUrls(t);
  t = masked;

  // 1) Typografia: znaki niewidoczne / fancy → proste.
  t = t.replace(/ /g, ' ');              // twarda spacja → zwykła
  t = t.replace(/[‘’‚‹›]/g, "'"); // ' ' ‚ ‹ › → '
  t = t.replace(/[“”„«»]/g, '"'); // " " „ « » → "
  t = t.replace(/…/g, '...');            // … → ...

  // 2) Resztki markdown (gdy przeciekną z generacji).
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // nagłówki ###
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '');       // cytat blokowy >
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');           // **bold**
  t = t.replace(/__(.+?)__/g, '$1');               // __bold__
  t = t.replace(/`([^`]+)`/g, '$1');               // `code`
  t = t.replace(/`/g, '');                          // wiszące backticki

  // 3) Myślniki (kolejność istotna):
  //    a) punktor na początku linii: "— " → "- "
  t = t.replace(/^([ \t]*)[—–][ \t]+/gm, '$1- ');
  //    b) zakres liczbowy: 10–20 → 10-20 (dywiz, nie usuwamy cyfr)
  t = t.replace(/(\d)[ \t]*[—–][ \t]*(\d)/g, '$1-$2');
  //    c) pauza parentetyczna (gdziekolwiek indziej) → przecinek
  t = t.replace(/[ \t]*[—–][ \t]*/g, ', ');

  // 4) Artefakty interpunkcji/spacji.
  t = t.replace(/[ \t]+([,.;:!?])/g, '$1');     // spacja przed , . ; : ! ?
  t = t.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')'); // spacje wewnątrz nawiasów
  t = t.replace(/,[ \t]*,+/g, ',');             // ,, → ,
  t = t.replace(/([.!?]){4,}/g, '$1$1$1');      // !!!! → !!! (zostaw "...")
  t = t.replace(/[^\S\n]{2,}/g, ' ');           // multi-spacja → 1 (newline'y zostają)

  // 5) Domknięcie: trailing spacje per linia, max 2 puste linie, trim całości.
  t = t.replace(/[^\S\n]+$/gm, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.trim();

  return restoreUrls(t, urls);
}

export default humanizeText;
