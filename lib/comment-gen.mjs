/**
 * comment-gen.mjs — wspólny rdzeń generowania odpowiedzi na komentarze LinkedIn.
 *
 * Jedno źródło prawdy dla:
 *  - auto-comment-playwright.mjs (daemon skanujący wątki)
 *  - dashboard.mjs (przycisk „Przepisz (Opus 4.8)" / regenerate z wskazówką)
 *
 * Model przypięty do Opus 4.8 (decyzja Bartka). Anti-halucynacja: prompt grounduje
 * w poście + wątku + personie + fact-checker/humanizer, a osobny `factCheck()` POTWIERDZA
 * że odpowiedź nie zawiera zmyślonych konkretów.
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── KONFIG ────────────────────────────────────────────────────────────────────

export const CLAUDE = {
  BIN: '/Users/gaca/.local/bin/claude',
  MODEL: 'claude-opus-4-8', // PIN: Opus 4.8 (nie alias 'opus')
  TIMEOUT_MS: 120000,
};

export const DEFAULT_PERSONA_DIR = '/Users/gaca/projects/personal/second-mind/_system';
export const PERSONA_MAX_CHARS = 8500; // cały profile.md + work-style.md (było 3500 → ucinało)

export const VALIDATION_ALLOWED_URLS = [
  'bartoszgaca.pl', 'github.com/gacabartosz', 'linkedin.com', 'youtube.com/@gacabartosz',
];

// ── PERSONA / WYTYCZNE ─────────────────────────────────────────────────────────

let _personaCache = null;
export function loadPersona(personaDir = DEFAULT_PERSONA_DIR) {
  if (_personaCache) return _personaCache;
  let profile = '', workStyle = '';
  try { profile = readFileSync(join(personaDir, 'profile.md'), 'utf-8'); } catch {}
  try { workStyle = readFileSync(join(personaDir, 'work-style.md'), 'utf-8'); } catch {}
  _personaCache = (profile + '\n\n' + workStyle).slice(0, PERSONA_MAX_CHARS);
  return _personaCache;
}

// Edytowalne wytyczne z ~/.linkedin-mcp/guidelines/{humanizer,fact-checker,fact-checker-full}.md
// Czytane przy KAŻDYM wywołaniu (świeże po edycji w dashboardzie, bez restartu).
export function loadGuideline(name) {
  const path = join(homedir(), '.linkedin-mcp', 'guidelines', `${name}.md`);
  try { return readFileSync(path, 'utf-8').trim(); } catch { return ''; }
}

// ── BAZA WIEDZY / RETRIEVAL (RAG) ──────────────────────────────────────────────
// Prawdziwe fakty o projektach Bartosza (stacki, jak co działa, czym jest dany projekt).
// Źródło: second-mind (PARA). Generator czerpie z niej KONKRETY, fact-checker traktuje
// je jako grounded — dzięki temu na pytanie „w jakim stacku budujesz CRM?" bot odpowie
// PRAWDZIWIE (Node/Express/TS/Prisma/PostgreSQL + React/Vite/Tailwind, np. tapparella),
// zamiast unikać konkretu.
export const KNOWLEDGE_ROOT = '/Users/gaca/projects/personal/second-mind';
export const KNOWLEDGE_SUBDIRS = ['1_PROJECTS', '2_AREAS', '3_RESOURCES'];

const KB_STOP = new Set(['jest','są','być','oraz','dla','które','która','który','tego','tym','tej','tych','jak','jaki','jaka','jakie','czy','ile','kiedy','gdzie','dlaczego','kto','już','teraz','więc','ale','bo','albo','lub','tylko','nawet','też','bardzo','dużo','mało','wszystko','jednak','jeśli','gdy','this','that','with','from','about','what','which','your','have','does','will','custom','budujesz','robisz','masz','można','przez','jako','być','można']);

function walkMd(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

let _kbCache = null;
function loadKnowledgeCorpus() {
  if (_kbCache) return _kbCache;
  const docs = [];
  for (const sub of KNOWLEDGE_SUBDIRS) {
    for (const f of walkMd(join(KNOWLEDGE_ROOT, sub))) {
      try {
        const text = readFileSync(f, 'utf-8');
        const name = f.replace(KNOWLEDGE_ROOT + '/', '');
        docs.push({ name, text, lower: (name + ' ' + text).toLowerCase() });
      } catch {}
    }
  }
  _kbCache = docs;
  return docs;
}

/**
 * Keyword-retrieval po bazie wiedzy. Zwraca { text, sources }.
 * Dopasowuje znaczące słowa z (komentarz + post) do dokumentów; nazwa pliku waży więcej.
 */
export function retrieveKnowledge(queryText, opts = {}) {
  const { maxChars = 7000, maxDocs = 5, perDocChars = 3800 } = opts;
  const docs = loadKnowledgeCorpus();
  if (!docs.length) return { text: '', sources: [] };
  const terms = [...new Set((queryText || '').toLowerCase().match(/[a-ząćęłńóśźż0-9]{4,}/gi) || [])]
    .filter(t => !KB_STOP.has(t));
  if (!terms.length) return { text: '', sources: [] };
  const scored = docs.map(d => {
    let score = 0;
    for (const t of terms) {
      let idx = 0, c = 0;
      while ((idx = d.lower.indexOf(t, idx)) !== -1 && c < 5) { c++; idx += t.length; }
      score += c + (d.name.toLowerCase().includes(t) ? 3 : 0);
    }
    return { d, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, maxDocs);
  if (!scored.length) return { text: '', sources: [] };
  let budget = maxChars;
  const parts = [], sources = [];
  for (const { d } of scored) {
    if (budget <= 200) break;
    const slice = d.text.slice(0, Math.min(d.text.length, budget, perDocChars));
    parts.push(`### ${d.name}\n${slice}`);
    sources.push(d.name);
    budget -= slice.length;
  }
  return { text: parts.join('\n\n'), sources };
}

// ── JĘZYK ──────────────────────────────────────────────────────────────────────

const PL_WORDS = /\b(jak|jaki|jaka|jakie|co|czy|ile|kiedy|gdzie|dlaczego|kto|jest|są|tak|nie|moja|mój|moje|twoja|twój|ten|ta|to|już|teraz|więc|ale|bo|albo|lub|tylko|nawet|też|bardzo|dużo|mało|wszystko|jednak|jeśli|gdy|chociaż|ponieważ|aby|żeby|w|na|do|od|za|przez|po|przed|nad|pod|przy|bez|dla|między|wokół|obok|zamiast|oprócz|wobec)\b/i;

export function detectLanguage(text) {
  if (!text) return 'polsku';
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return 'polsku';
  const pl = (text.match(PL_WORDS) || []).length;
  const en = (text.match(/\b(the|is|are|was|were|have|has|had|do|does|will|can|could|should|this|that|these|with|from|about|because|however|but|and|or|not|very|much|some|any|all|every)\b/gi) || []).length;
  if (pl > en) return 'polsku';
  if (en > pl) return 'angielsku';
  return text.length < 30 ? 'polsku' : 'angielsku';
}

// ── PROMPT BUILDER ─────────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {string} p.persona
 * @param {string} p.postText
 * @param {string} p.postAuthor
 * @param {Array<{author,text,isReply?,isOurs?,commentUrn?}>} p.thread
 * @param {string[]} p.ourReplies
 * @param {{author,text,commentUrn?}} p.targetComment
 * @param {string} [p.hint] — opcjonalna wskazówka Bartka (regenerate): kierunek odpowiedzi
 */
export function buildPrompt({ persona, postText, postAuthor, thread, ourReplies, targetComment, hint, knowledge }) {
  const threadFormatted = (thread || []).map((c, i) => {
    const marker = c.isReply ? '  ↳ ' : '';
    const ours = c.isOurs ? ' [TWOJA WCZEŚNIEJSZA ODPOWIEDŹ]' : '';
    const target = (c.commentUrn && targetComment.commentUrn && c.commentUrn === targetComment.commentUrn)
      ? ' ← [TEN KOMENTARZ — odpowiadasz]' : '';
    return `${marker}${i + 1}. ${c.author}: "${(c.text || '').slice(0, 300)}"${ours}${target}`;
  }).join('\n');

  const ourRepliesFormatted = (ourReplies && ourReplies.length > 0)
    ? ourReplies.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '(brak — to pierwszy raz odpowiadasz w tym wątku)';

  const humanizer = loadGuideline('humanizer');
  const factCheck = loadGuideline('fact-checker');

  const hintBlock = (hint && hint.trim())
    ? `<wskazowka_bartka>
${hint.trim()}
</wskazowka_bartka>
PRIORYTET: napisz odpowiedź idącą w kierunku tej wskazówki Bartka — ale NADAL trzymaj się WYŁĄCZNIE faktów z postu/wątku/persony (wytyczne fact-checker obowiązują; nie wymyślaj konkretów żeby spełnić wskazówkę).

`
    : '';

  return `<persona>
${persona}
</persona>

${humanizer ? `<humanizer_wytyczne>\n${humanizer}\n</humanizer_wytyczne>\n\n` : ''}${factCheck ? `<fact_checker_wytyczne>\n${factCheck}\n</fact_checker_wytyczne>\n\n` : ''}${knowledge ? `<baza_wiedzy>\n${knowledge}\n</baza_wiedzy>\nTo PRAWDZIWE dane o projektach Bartosza (stacki technologiczne, czym jest dany projekt, jak działa). Gdy komentarz pyta o fakt (np. „w jakim stacku budujesz CRM?", „czym jest tapparella?") — odpowiedz KONKRETNIE na ich podstawie. Cytuj tylko to, co tu jest.\n\n` : ''}${hintBlock}<oryginalny_post>
Autor: ${postAuthor}
Treść: ${(postText || '(brak treści)').slice(0, 800)}
</oryginalny_post>

<historia_watku>
${threadFormatted || '(brak wcześniejszych komentarzy)'}
</historia_watku>

<twoje_poprzednie_odpowiedzi_w_tym_watku>
${ourRepliesFormatted}
</twoje_poprzednie_odpowiedzi_w_tym_watku>

<zadanie>
Komentarz do oceny: "${targetComment.text}"
Autor: ${targetComment.author}

KROK 1: Oceń komentarz (1-5):
- lead_score: 5=konkretne zainteresowanie usługą/ceną/demo, 3=ogólne zainteresowanie, 1=brak
- troll_risk: 5=agresja/spam/trolling, 2=neutralny, 1=konstruktywny
- engagement_value: 5=otwarte pytanie wymuszające dyskusję, 3=merytoryczny, 1=emoji/one-word

KROK 2: ZAWSZE napisz odpowiedź (nawet jeśli komentarz wygląda na śmieć — user sam zdecyduje czy wysłać).

KROK 3: Napisz odpowiedź:
- **JĘZYK:** wykryj język KOMENTARZA (nie postu, nie wątku — tylko "${targetComment.text}") i odpowiedz dokładnie w tym samym języku. PL → odpowiedź PL. EN → odpowiedź EN.
- **KRÓTKO: max 2-4 zdania (~30-60 słów). Jedna myśl + pytanie/puenta na końcu. NIE rozwlekaj.**
- **BEZWZGLĘDNIE zastosuj <humanizer_wytyczne>** — brzmienie ludzkie, zero korpo-waty, zero „myślników-eseju", zero list. Tak jakby Bartek rzucił to z telefonu.
- Logicznie kontynuuje wątek (nawiąż do poprzednich komentarzy jeśli są)
- NIE powtarzaj się — sprawdź twoje poprzednie odpowiedzi
- Zero "Świetny komentarz", "Dzięki za pytanie"
- Zakończ pytaniem lub konkretną obserwacją wymuszającą dyskusję
- Styl: bezpośredni, developer-like, lekka ironia OK
- **FAKTY:** jeśli komentarz pyta o konkret (stack, jak budujesz, czym jest dany projekt) — NAJPIERW sprawdź <baza_wiedzy> i <oryginalny_post>. Jeśli konkret tam jest (np. „CRM: Node.js + Express + TypeScript + Prisma + PostgreSQL, front React + Vite + Tailwind", „tapparella = CRM zamówień rolet") — UŻYJ GO, odpowiedz wprost. Jeśli konkretu NIE MA ani w bazie, ani w poście/wątku — POMIŃ, NIE WYMYŚLAJ (napisz ogólniej albo warunkowo). Lepiej krótsza odpowiedź bez halucynacji niż dłuższa z fikcją. ZASTOSUJ też <humanizer_wytyczne>.

KROK 4: Opisz JAK zbudowałeś odpowiedź:
- temperature: 1-5 (1=sucha/biznesowa, 3=neutralna, 5=mocna/ironiczna/prowokacyjna)
- tone: jedno z: formal | casual | ironic | empathetic | technical | provocative | neutral
- context_used: lista max 4 KONKRETNYCH elementów wykorzystanych (np. ["wątek: komentarz Tomka o cenie", "persona: developer-like", "post: temat MCP"])
- reasoning: 1-2 zdania DLACZEGO ta odpowiedź — co ze źródeł zaważyło

ZWRÓĆ TYLKO JSON (nic poza nim):
{"lead_score": N, "troll_risk": N, "engagement_value": N, "reply": "...", "temperature": N, "tone": "casual|ironic|formal|empathetic|technical|provocative|neutral", "context_used": ["..."], "reasoning": "..."}
</zadanie>`;
}

/**
 * Prompt dla odpowiedzi na WIADOMOŚĆ PRYWATNĄ (DM). Te same standardy co komentarze:
 * krótko, humanizer, baza wiedzy, bez halucynacji, kontekst rozmowy.
 * @param {object} p
 * @param {string} p.persona
 * @param {string} p.senderName
 * @param {string} p.lastMessage
 * @param {Array<{from,text}>} [p.conversation] — historia rozmowy (nie gubić kontekstu)
 * @param {string} [p.knowledge]
 * @param {string} [p.hint]
 */
export function buildDmPrompt({ persona, senderName, lastMessage, conversation, knowledge, hint }) {
  const humanizer = loadGuideline('humanizer');
  const factCheckG = loadGuideline('fact-checker');
  const convFormatted = (conversation && conversation.length)
    ? conversation.map((m, i) => `${i + 1}. ${m.from}: "${(m.text || '').slice(0, 400)}"`).join('\n')
    : '(brak wcześniejszej historii — to pierwsza wymiana)';
  const hintBlock = (hint && hint.trim())
    ? `<wskazowka_bartka>\n${hint.trim()}\n</wskazowka_bartka>\nPRIORYTET: idź w kierunku wskazówki, ale trzymaj się faktów (baza/rozmowa).\n\n`
    : '';
  return `<persona>
${persona}
</persona>

${humanizer ? `<humanizer_wytyczne>\n${humanizer}\n</humanizer_wytyczne>\n\n` : ''}${factCheckG ? `<fact_checker_wytyczne>\n${factCheckG}\n</fact_checker_wytyczne>\n\n` : ''}${knowledge ? `<baza_wiedzy>\n${knowledge}\n</baza_wiedzy>\nTo PRAWDZIWE dane o projektach Bartosza — gdy ktoś pyta o fakt (stack, projekt), odpowiedz konkretnie z bazy. Cytuj tylko to, co tu jest.\n\n` : ''}${hintBlock}<historia_rozmowy>
${convFormatted}
</historia_rozmowy>

<zadanie>
Nowa wiadomość DM od ${senderName}: "${lastMessage}"

Napisz odpowiedź (PISZESZ JAKO BARTOSZ GACA):
- **JĘZYK:** ten sam co wiadomości (PL→PL, EN→EN).
- **KRÓTKO: max 2-4 zdania (~30-60 słów).** Jedna myśl. Tak jak Bartek pisze z telefonu.
- NIE zaczynaj od "Cześć ${senderName}," — za szablonowo. Zero korpo-waty.
- Odpowiedz na konkret; jeśli pyta o projekt/usługę/stack — odpowiedz z <baza_wiedzy>, ewentualnie zaproponuj krótką rozmowę.
- **NIE GUBIĆ KONTEKSTU** — nawiąż do historii rozmowy jeśli jest.
- **BEZWZGLĘDNIE <humanizer_wytyczne> i <fact_checker_wytyczne>.** Konkret którego NIE ma w bazie/rozmowie — POMIŃ, NIE WYMYŚLAJ.

ZWRÓĆ TYLKO JSON: {"reply": "...", "lead_score": N, "troll_risk": N}
</zadanie>`;
}

// ── CLAUDE CLI ─────────────────────────────────────────────────────────────────

export function callClaude(prompt, opts = {}) {
  const { bin = CLAUDE.BIN, model = CLAUDE.MODEL, timeoutMs = CLAUDE.TIMEOUT_MS, log = () => {} } = opts;
  return new Promise((resolve) => {
    const child = spawn(bin, [
      '-p', '--no-session-persistence',
      '--model', model,
      '--output-format', 'text',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '', err = '';
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      log(`  ⚠️  Claude timeout po ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { log(`  ⚠️  Claude exit ${code}: ${err.slice(0, 200)}`); resolve(null); return; }
      resolve(out.trim());
    });
    child.on('error', (e) => { clearTimeout(timer); log(`  ⚠️  Claude spawn error: ${e.message}`); resolve(null); });
  });
}

function extractJsonBlock(text, key) {
  if (!text) return null;
  const re = new RegExp('\\{[\\s\\S]*"' + key + '"[\\s\\S]*\\}');
  const m = text.match(re);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function parseClaudeJson(text) {
  return extractJsonBlock(text, 'reply');
}

// ── WALIDACJA STRUKTURALNA ─────────────────────────────────────────────────────

export function computeComposite(scoring) {
  const lead = +scoring.lead_score || 0;
  const troll = +scoring.troll_risk || 0;
  const eng = +scoring.engagement_value || 0;
  const urg = +scoring.urgency || 0;
  const raw = 0.4 * lead - 0.3 * troll + 0.2 * eng + 0.1 * urg;
  return Math.round(Math.max(0, Math.min(10, (raw + 0.9) * 10 / 4.1)) * 10) / 10;
}

// db opcjonalne — gdy podane, sprawdza DUPLICATE względem thread_comments(is_our_comment=1)
export function validateProposal({ proposedReply, sourceText }, db) {
  const notes = [];
  const reply = (proposedReply || '').trim();
  if (reply.length < 20) notes.push('TOO_SHORT');
  if (reply.length > 1250) notes.push('TOO_LONG');
  if (db) {
    try {
      const prefix = reply.slice(0, 100).toLowerCase();
      if (prefix.length >= 40) {
        const dup = db.prepare(
          "SELECT 1 FROM thread_comments WHERE is_our_comment = 1 AND LOWER(SUBSTR(comment_text, 1, 100)) = ? LIMIT 1"
        ).get(prefix);
        if (dup) notes.push('DUPLICATE');
      }
    } catch {}
  }
  if (sourceText && sourceText.length > 30 && reply.includes(sourceText.slice(0, 50))) notes.push('ECHO_SOURCE');
  const urls = reply.match(/https?:\/\/[^\s)\]]+/g) || [];
  for (const u of urls) {
    if (!VALIDATION_ALLOWED_URLS.some((a) => u.includes(a))) notes.push('UNAUTHORIZED_URL:' + u.slice(0, 60));
  }
  if (/\b(click here|amazing deal|buy now|limited time)\b/i.test(reply)) notes.push('SPAM_PATTERN');
  if (/🔥{3,}|⚡{3,}|🚀{3,}/.test(reply)) notes.push('EMOJI_SPAM');
  const capsRuns = (reply.match(/[A-ZĄĆĘŁŃÓŚŹŻ]{6,}/g) || []).length;
  if (capsRuns > 2) notes.push('TOO_MANY_CAPS');
  return notes;
}

// ── FACT-CHECK PASS (drugi przebieg Opus 4.8 — POTWIERDZA że nie kłamie) ─────────

/**
 * Niezależny przebieg: czyta gotową odpowiedź i potwierdza, że każdy KONKRET ma
 * pokrycie w poście / wątku / personie. Zwraca:
 *   { grounded: bool, unsupported_claims: string[], fixed_reply: string|null }
 * Gdy model nie odpowie poprawnym JSON → fail-open ostrożnie: grounded=null (caller decyduje).
 */
export async function factCheck({ postText, threadContext, proposedReply, persona, knowledge }, opts = {}) {
  const { bin = CLAUDE.BIN, model = CLAUDE.MODEL, timeoutMs = CLAUDE.TIMEOUT_MS, log = () => {} } = opts;
  const guide = loadGuideline('fact-checker-full') || loadGuideline('fact-checker');

  const prompt = `Jesteś rygorystycznym fact-checkerem. Twoim JEDYNYM zadaniem jest sprawdzić, czy PROPONOWANA ODPOWIEDŹ trzyma się WYŁĄCZNIE faktów obecnych w POŚCIE, WĄTKU, PERSONIE lub BAZIE WIEDZY. Nie oceniaj stylu ani trafności — tylko prawdziwość konkretów.

${guide ? `<wytyczne_fact_checker>\n${guide.slice(0, 6000)}\n</wytyczne_fact_checker>\n\n` : ''}<post>
${(postText || '').slice(0, 1500)}
</post>

<watek>
${(threadContext || '').slice(0, 4000)}
</watek>

<persona_bartka>
${(persona || '').slice(0, 2000)}
</persona_bartka>

${knowledge ? `<baza_wiedzy>\n${knowledge.slice(0, 7500)}\n</baza_wiedzy>\n(BAZA WIEDZY to prawdziwe dane o projektach Bartosza — konkrety stąd są DOZWOLONE, nie są halucynacją.)\n\n` : ''}<proponowana_odpowiedz>
${proposedReply}
</proponowana_odpowiedz>

ZADANIE:
1. Wypisz każdy KONKRET w odpowiedzi, którego NIE ma w poście/wątku/personie ANI w bazie wiedzy: liczby, statystyki, daty, nazwy wersji/produktów, czyjeś doświadczenie, nazwy projektów/klientów Bartosza, twierdzenia o faktach podane jako pewnik. UWAGA: konkret obecny w BAZIE WIEDZY (np. stack technologiczny projektu, nazwa, jak coś działa) jest POPRAWNY — NIE wpisuj go.
2. Jeśli jest co najmniej jeden taki niepokryty konkret → "grounded": false. Jeśli odpowiedź zawiera tylko ogólne opinie/pytania/parafrazy źródeł, lub konkrety pokryte przez bazę/post/wątek → "grounded": true.
3. PREFERUJ "fixed_reply": usuń lub zmiękcz niepokryte konkrety (np. wytnij zmyśloną liczbę/retoryczny przykład, zamień pewnik na ogólnik) ZACHOWUJĄC sens, ton, długość i język. Zwróć "fixed_reply": null TYLKO gdy cała odpowiedź stoi na zmyślonym fakcie i nie da się jej uratować bez pisania od zera. Drobny zmyślony detal (np. „200 leadów" jako ilustracja) → po prostu go usuń w fixed_reply, nie blokuj całości.

ZWRÓĆ TYLKO JSON (nic poza nim):
{"grounded": true|false, "unsupported_claims": ["..."], "fixed_reply": "..."|null}`;

  const out = await callClaude(prompt, { bin, model, timeoutMs, log });
  const parsed = extractJsonBlock(out, 'grounded');
  if (!parsed) return { grounded: null, unsupported_claims: [], fixed_reply: null };
  return {
    grounded: parsed.grounded === true,
    unsupported_claims: Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : [],
    fixed_reply: (typeof parsed.fixed_reply === 'string' && parsed.fixed_reply.trim()) ? parsed.fixed_reply.trim() : null,
  };
}
