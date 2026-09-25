/**
 * ai-marks.mjs — deterministyczne wykrywanie i usuwanie śladów generatora.
 *
 * Port skilla ~/.claude/skills/remove-ai-marks/scripts/clean_ai_marks.py na Node,
 * żeby daemony (auto-publish, qa-gate) działały bez Pythona i bez Claude Code.
 *
 * Po co osobny moduł, skoro jest lib/humanize.mjs: humanize czyści typografię,
 * którą WIDAĆ (myślniki, cudzysłowy, wielokropek). Nie rusza znaków, których nie
 * widać: zero-width, BOM, bidi, selektory wariantu, tagi, miękki łącznik. Grep po
 * repo za 200B|FEFF|zero-width nie zwracał nic, więc nie wiadomo było, ile takich
 * znaków wyszło na LinkedIna.
 *
 * PODZIAŁ ODPOWIEDZIALNOŚCI (ważne przy zmianach):
 *   - myślniki em/en NALEŻĄ do lib/humanize.mjs. Tamte reguły są lepsze: zakres
 *     10–20 zostaje liczbą z dywizem, punktor na początku linii zostaje "- ".
 *     Tutaj myślniki są tylko WYKRYWANE, nigdy przepisywane.
 *   - sprzątanie po zamianach (podwójne spacje, ", ,") należy do humanize.
 *     Ten moduł robi wyłącznie podmianę znak w znak.
 *
 * DWA POZIOMY MAPY ZAMIAN:
 *   - HARD: zawsze. Znaki, które w poście nie niosą treści, tylko zdradzają
 *     generator (krzywe cudzysłowy, wielokropek jednoznakowy, myślniko-podobne).
 *   - SOFT: tylko w trybie strict. Punktory, strzałki, znaki towarowe, ptaszki.
 *     Powód: 4 z 23 realnych postów Bartka używają "→" jako formatowania listy
 *     (bramka QA sama to chwaliła: "lista strzałek jest OK na mobile"). Zamiana
 *     na "->" byłaby zmianą jego stylu, nie usunięciem śladu AI. Tryb strict jest
 *     dla ofert i pism, gdzie obowiązuje pełna reguła skilla.
 */

/** Znaki niewidoczne i sterujące. Usuwane bez zamiennika. */
const INVISIBLE = new Map([
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x2060, 'WORD JOINER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE / BOM'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x00ad, 'SOFT HYPHEN'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x2028, 'LINE SEPARATOR'],
  [0x2029, 'PARAGRAPH SEPARATOR'],
]);
for (let c = 0x202a; c < 0x202f; c++) INVISIBLE.set(c, 'BIDI OVERRIDE');
for (let c = 0x2066; c < 0x206a; c++) INVISIBLE.set(c, 'BIDI ISOLATE');
for (let c = 0xfe00; c < 0xfe10; c++) INVISIBLE.set(c, 'VARIATION SELECTOR');
for (let c = 0xe0000; c < 0xe0080; c++) INVISIBLE.set(c, 'TAG CHARACTER');

/** Spacje nietypowe. Zamieniane na zwykłą spację U+0020. */
const ODD_SPACES = new Set([0x00a0, 0x1680, 0x202f, 0x205f, 0x3000]);
for (let c = 0x2000; c < 0x200b; c++) ODD_SPACES.add(c);

/** Typografia zdradzająca generator. Zamieniana zawsze. */
const REPLACE_HARD = new Map([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
  ['…', '...'],
  ['′', "'"], ['″', '"'],
  ['‐', '-'], ['‑', '-'], ['―', '-'], ['−', '-'],
  ['«', '"'], ['»', '"'],
]);

/** Typografia, która bywa świadomym formatowaniem. Zamieniana tylko w trybie strict. */
const REPLACE_SOFT = new Map([
  ['•', '-'], ['·', '-'], ['●', '-'], ['▪', '-'], ['‣', '-'],
  ['→', '->'], ['←', '<-'], ['⇒', '=>'],
  ['©', '(c)'], ['™', '(TM)'], ['®', '(R)'],
  ['✓', '[ok]'], ['✔', '[ok]'], ['✗', '[nie]'], ['✘', '[nie]'],
]);

/** Myślniki: wykrywane tutaj, przepisywane w lib/humanize.mjs. */
const DASHES = new Set(['—', '–']);

const SYMBOL_RE = /\p{So}/u;

const NAMES_HARD = new Map([
  ['‘', 'LEFT SINGLE QUOTATION MARK'], ['’', 'RIGHT SINGLE QUOTATION MARK'],
  ['‚', 'SINGLE LOW-9 QUOTATION MARK'], ['‛', 'SINGLE HIGH-REVERSED-9 QUOTATION MARK'],
  ['“', 'LEFT DOUBLE QUOTATION MARK'], ['”', 'RIGHT DOUBLE QUOTATION MARK'],
  ['„', 'DOUBLE LOW-9 QUOTATION MARK'], ['‟', 'DOUBLE HIGH-REVERSED-9 QUOTATION MARK'],
  ['…', 'HORIZONTAL ELLIPSIS'],
  ['′', 'PRIME'], ['″', 'DOUBLE PRIME'],
  ['‐', 'HYPHEN'], ['‑', 'NON-BREAKING HYPHEN'],
  ['―', 'HORIZONTAL BAR'], ['−', 'MINUS SIGN'],
  ['«', 'LEFT-POINTING DOUBLE ANGLE QUOTATION MARK'],
  ['»', 'RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK'],
]);

const NAMES_SOFT = new Map([
  ['•', 'BULLET'], ['·', 'MIDDLE DOT'], ['●', 'BLACK CIRCLE'],
  ['▪', 'BLACK SMALL SQUARE'], ['‣', 'TRIANGULAR BULLET'],
  ['→', 'RIGHTWARDS ARROW'], ['←', 'LEFTWARDS ARROW'], ['⇒', 'RIGHTWARDS DOUBLE ARROW'],
  ['©', 'COPYRIGHT SIGN'], ['™', 'TRADE MARK SIGN'], ['®', 'REGISTERED SIGN'],
  ['✓', 'CHECK MARK'], ['✔', 'HEAVY CHECK MARK'],
  ['✗', 'BALLOT X'], ['✘', 'HEAVY BALLOT X'],
]);

/**
 * Wszystkie znaleziska w tekście, z pozycją.
 * Linie liczone od 1, kolumny od 1, w punktach kodowych (nie w jednostkach UTF-16).
 *
 * @param {string} input
 * @returns {{line:number,col:number,cp:number,char:string,name:string,tier:'hard'|'soft'}[]}
 */
export function findAiMarks(input) {
  if (input == null) return [];
  const out = [];
  const lines = String(input).split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    let col = 0;
    for (const ch of lines[i]) {
      col++;
      const cp = ch.codePointAt(0);
      const at = { line: i + 1, col, cp, char: ch };
      if (INVISIBLE.has(cp)) out.push({ ...at, name: INVISIBLE.get(cp), tier: 'hard' });
      else if (ODD_SPACES.has(cp)) out.push({ ...at, name: 'SPACJA NIETYPOWA', tier: 'hard' });
      else if (DASHES.has(ch)) out.push({ ...at, name: 'MYSLNIK (em/en dash)', tier: 'hard' });
      else if (REPLACE_HARD.has(ch)) out.push({ ...at, name: 'TYPOGRAFIA: ' + NAMES_HARD.get(ch), tier: 'hard' });
      else if (REPLACE_SOFT.has(ch)) out.push({ ...at, name: 'TYPOGRAFIA: ' + NAMES_SOFT.get(ch), tier: 'soft' });
      else if (cp > 0x2100 && SYMBOL_RE.test(ch)) out.push({ ...at, name: 'SYMBOL/EMOJI', tier: 'soft' });
    }
  }
  return out;
}

/**
 * Znaleziska, które liczą się jako naruszenie. Odpowiednik `--check` ze skilla.
 * Bez strict: tylko poziom hard. Ze strict: wszystko, łącznie z emoji i strzałkami.
 *
 * @param {string} input
 * @param {{strict?: boolean}} [opts]
 */
export function checkAiMarks(input, opts = {}) {
  const all = findAiMarks(input);
  return opts.strict ? all : all.filter((f) => f.tier === 'hard');
}

/**
 * Usuwa ślady AI. Wyłącznie podmiana znak w znak; myślników NIE rusza (robi to
 * humanizeText) i nie sprząta odstępów po zamianach (też humanizeText).
 *
 * @param {string} input
 * @param {{strict?: boolean}} [opts]
 * @returns {{text: string, findings: ReturnType<typeof findAiMarks>}}
 */
export function stripAiMarks(input, opts = {}) {
  if (input == null) return { text: '', findings: [] };
  const text = String(input);
  const findings = findAiMarks(text);
  const strict = opts.strict === true;

  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (INVISIBLE.has(cp)) continue;
    if (ODD_SPACES.has(cp)) { out += ' '; continue; }
    if (REPLACE_HARD.has(ch)) { out += REPLACE_HARD.get(ch); continue; }
    if (strict && REPLACE_SOFT.has(ch)) { out += REPLACE_SOFT.get(ch); continue; }
    out += ch;
  }
  return { text: out, findings };
}

/**
 * Raport w formacie skilla, do logów i do panelu.
 *
 * @param {string} input
 * @param {string} [label]
 * @param {{strict?: boolean}} [opts]
 */
export function formatAiMarksReport(input, label = '<tekst>', opts = {}) {
  const marks = checkAiMarks(input, opts);
  if (marks.length === 0) return 'CZYSTY: ' + label;
  const head = 'ZNALEZIONO ' + marks.length + ' w ' + label + ':';
  const rows = marks.slice(0, 200).map(
    (m) => '  linia ' + m.line + ', kol ' + m.col +
      ': U+' + m.cp.toString(16).toUpperCase().padStart(4, '0') + '  ' + m.name
  );
  if (marks.length > 200) rows.push('  ... i ' + (marks.length - 200) + ' wiecej');
  return [head, ...rows].join('\n');
}

export default stripAiMarks;
