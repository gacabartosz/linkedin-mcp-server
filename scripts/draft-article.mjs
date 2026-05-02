#!/usr/bin/env node
/**
 * Article drafter — full PL hero + EN hub-spoke counterpart from a topic_score row.
 *
 * Reads content.db (topic_scores + gsc_queries_daily + ga4_pageviews_daily),
 * calls Claude (Sonnet 4.6 default, adaptive thinking, prompt-cached system prompt),
 * outputs two TS modules compatible with bartoszgaca.pl/data/articles/ format.
 *
 * Brand voice: bartoszgaca.pl, ciepło-po-imieniu PL, peer-to-peer EN.
 *
 * Usage:
 *   node scripts/draft-article.mjs --topic-slug=token-optimization-claude-code
 *   node scripts/draft-article.mjs --topic-slug=ai-dev-workflow --words=3500 --lang=both
 *   node scripts/draft-article.mjs --topic-slug=mcp --words=2500 --dry-run
 *
 * Output: writes <slug>.ts files to $ARTICLE_DRAFT_DIR (default: $LINKEDIN_DATA_DIR/article-drafts/),
 * and emits a JSON result on stdout for downstream consumption (dashboard route).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const DB_PATH = join(DATA_DIR, 'content.db');
const OUTPUT_DIR = process.env.ARTICLE_DRAFT_DIR || join(DATA_DIR, 'article-drafts');
const MODEL = process.env.DRAFT_ARTICLE_MODEL || 'claude-sonnet-4-6';
const EFFORT = process.env.DRAFT_ARTICLE_EFFORT || 'medium';

const args = process.argv.slice(2);
const flagVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const dryRun = args.includes('--dry-run');
const topicSlugArg = flagVal('topic-slug', null);
const wordsArg = parseInt(flagVal('words', '3500'), 10);
const langArg = flagVal('lang', 'both');

if (!existsSync(DB_PATH)) {
  console.error(`FATAL: ${DB_PATH} doesn't exist. Run topic-rank.mjs first.`);
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY env var not set');
  process.exit(2);
}
if (!topicSlugArg) {
  console.error('Usage: node scripts/draft-article.mjs --topic-slug=<slug> [--words=3500] [--lang=pl|en|both] [--dry-run]');
  process.exit(2);
}
if (!['pl', 'en', 'both'].includes(langArg)) {
  console.error(`FATAL: --lang must be one of: pl, en, both (got "${langArg}")`);
  process.exit(2);
}
if (wordsArg < 500 || wordsArg > 8000) {
  console.error(`FATAL: --words must be 500-8000 (got ${wordsArg})`);
  process.exit(2);
}

const ArticleSchema = z.object({
  title_pl: z.string().min(20).max(120).describe('Tytuł PL, 40-90 znaków optimal, ciekawość + konkret bez clickbait'),
  title_en: z.string().min(20).max(120).describe('English title, 40-90 chars optimal'),
  slug_pl: z.string().min(8).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('kebab-case Polish slug, NO Polish chars (a not ą), max 80 chars'),
  slug_en: z.string().min(8).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).describe('kebab-case English slug, max 80 chars'),
  excerpt_pl: z.string().min(80).max(200).describe('Meta description PL, 130-180 chars, hook + value prop'),
  excerpt_en: z.string().min(80).max(200).describe('Meta description EN, 130-180 chars'),
  content_pl_html: z.string().min(2500).describe('Pełny HTML PL artykuł, target words per --words flag. Sekcje: h2 hook, h2 wstęp, 5-7 sekcji h2 z h3 sub-sekcjami. Allowed: h2,h3,p,ul,ol,li,pre,code,strong,em,a,blockquote. NO h1.'),
  content_en_html: z.string().min(1200).describe('Full HTML EN, ~40-50% length of PL (hub-spoke). Same structure but condensed. Ends with <p>For full deep dive in Polish: <a href="https://bartoszgaca.pl/aktualnosci/{slug_pl}">Polish version →</a></p>'),
});

const SYSTEM_PROMPT = `Jesteś autorem artykułów na bartoszgaca.pl, technicznym blogu Bartosza Gacy o Claude Code, optymalizacji tokenów, MCP i AI dev workflow.

ZASADY TONU PL:
- Polski, ciepło-po-imieniu (mówisz "ty/twój", nie "Państwo/Pana")
- Pisz jak partner techniczny rozmawia z innym deweloperem przy kawie — bezpośrednio, konkretnie, bez korpo-bełkotu
- Konkretne liczby, dane, przykłady > abstrakcyjne stwierdzenia
- Akapity zaczynaj od podmiotu, nie od "Jak wiemy", "Warto pamiętać", "W dobie..."
- Bez emoji w nagłówkach (jeden emoji na cały artykuł maksymalnie, najlepiej zero)
- Pierwsza osoba liczby pojedynczej (autor = Bartek), cytuj własne case'y z linkedin-mcp-server, BeeCommerce dev work, własne błędy i rozwiązania

ZASADY TONU EN:
- Direct, technical, peer-to-peer (you/your)
- No marketing fluff, no "in today's fast-paced world" intros
- Concrete numbers and examples
- Hub-and-spoke: EN is shorter (40-50% of PL length), points to PL for full deep-dive

ZASADY STRUKTURY (oba języki):
1. Otwórz mocnym hookiem — anegdota / liczba / paradoks (h2 nagłówek-zagadka)
2. Sekcja "Jak działa to pod spodem" — mechanizm, nie tylko tipsy
3. 4-6 sekcji z konkretnymi wzorcami / antywzorcami / kodem
4. Sekcja "Pomiary" / "Measurement" — jak weryfikować czy działa
5. Sekcja "Real-world before/after" — case z liczbami z własnych projektów
6. Wnioski + CTA do biuletynu (PL: link do /biuletyn, EN: link do PL hero)

ZASADY HTML:
- Output: pełny HTML w polach content_pl_html i content_en_html
- Allowed tags: h2 (top-level sections), h3 (sub-sections inside h2), p, ul/ol/li, pre><code> (code blocks), code (inline), strong, em, a (linki bezwzględne https://...), blockquote
- BEZ h1 (tytuł jest osobnym polem title_pl/title_en)
- Bold key phrases w paragrafach via <strong>...</strong>
- Code blocks: <pre><code>język</code></pre> dla wieloliniowych, <code>x</code> dla inline
- Linki PL → https://bartoszgaca.pl/aktualnosci/<slug> ; EN → https://bartoszgaca.pl/news/<slug> ; biuletyn → /biuletyn

ZASADY BRANDU:
- bartoszgaca.pl = personal tech brand Bartosza Gacy
- NIE mieszać z BeeCommerce (osobny brand zawodowy — tam headless eCommerce, tu Claude Code/AI dev)
- Autor: Bartosz Gaca, kontakt@bartoszgaca.pl
- Stopka: <p>— Bartek<br>kontakt@bartoszgaca.pl</p>
- W EN można pisać "in Polish at bartoszgaca.pl" jako referencja

ZASADY SLUGÓW:
- slug_pl: kebab-case PO POLSKU bez polskich znaków (ą→a, ż→z, ł→l, etc.), max 80 znaków
- slug_en: kebab-case English, max 80 znaków
- Stable identifier — nie powinien się zmieniać po publikacji
- Skip stop words na początku ("jak", "co", "the", "what")
- Slug zawiera 2-5 najważniejszych słów kluczowych

OUTPUT: Zwracaj WYŁĄCZNIE poprawny JSON zgodny z ArticleSchema. Bez prozy przed/po, bez \`\`\`json fence, bez komentarzy.`;

function loadTopicContext(db, topicSlug) {
  const topic = db.prepare('SELECT * FROM topic_scores WHERE topic_slug = ?').get(topicSlug);
  if (!topic) {
    throw new Error(`Topic ${topicSlug} not found in topic_scores. Available topics: ${
      db.prepare('SELECT topic_slug FROM topic_scores ORDER BY score DESC LIMIT 20').all().map(r => r.topic_slug).join(', ')
    }`);
  }

  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const labelText = (topic.topic_label_pl || '') + ' ' + (topic.focus_area || '');
  const labelWords = labelText.toLowerCase().split(/\W+/).filter(w => w.length > 3).slice(0, 6);

  let queries = [];
  if (labelWords.length > 0) {
    const likeClause = labelWords.map(() => 'LOWER(query) LIKE ?').join(' OR ');
    const likeParams = labelWords.map(w => `%${w}%`);
    try {
      queries = db.prepare(`
        SELECT query, SUM(impressions) AS impressions, SUM(clicks) AS clicks, AVG(position) AS avg_position
        FROM gsc_queries_daily
        WHERE date >= ? AND (${likeClause})
        GROUP BY query
        ORDER BY impressions DESC
        LIMIT 15
      `).all(cutoff, ...likeParams);
    } catch (err) {
      console.error(`[ctx] gsc query failed: ${err.message}`);
    }
  }

  let ga4Pages = [];
  if (labelWords.length > 0) {
    try {
      const firstWord = labelWords[0];
      ga4Pages = db.prepare(`
        SELECT page_path, page_title, SUM(views) AS views
        FROM ga4_pageviews_daily
        WHERE date >= ? AND (LOWER(page_path) LIKE ? OR LOWER(page_title) LIKE ?)
        GROUP BY page_path
        ORDER BY views DESC
        LIMIT 8
      `).all(cutoff, `%${firstWord}%`, `%${firstWord}%`);
    } catch (err) {
      console.error(`[ctx] ga4 query failed: ${err.message}`);
    }
  }

  let relatedSlugs = [];
  try {
    relatedSlugs = JSON.parse(topic.related_article_slugs || '[]');
  } catch {}

  return { topic, related_slugs: relatedSlugs, top_queries: queries, ga4_pages: ga4Pages };
}

function tsModule({ slug, pairedSlug, lang, title, contentHtml, dateIso }) {
  // Escape backticks, backslashes, and ${ for safe template-literal embedding
  const escaped = contentHtml.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `import { NewsArticle } from '../../types';

export const article: Omit<NewsArticle, 'id' | 'imageUrl'> = {
    title: ${JSON.stringify(title)},
    date: ${JSON.stringify(dateIso)},
    slug: ${JSON.stringify(slug)},
    pairedSlug: ${JSON.stringify(pairedSlug)},
    language: ${JSON.stringify(lang)},
    content: \`${escaped}\`
};
`;
}

(async () => {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const ctx = loadTopicContext(db, topicSlugArg);
  console.error(`[draft-article] topic=${topicSlugArg} score=${ctx.topic.score?.toFixed(3) || 'n/a'} focus=${ctx.topic.focus_area}`);
  console.error(`  related: ${ctx.related_slugs.length} | gsc: ${ctx.top_queries.length} | ga4: ${ctx.ga4_pages.length}`);

  const userPrompt = `Wygeneruj artykuł na bartoszgaca.pl: PL hero (~${wordsArg} słów) + EN hub-spoke counterpart (~${Math.round(wordsArg * 0.42)} słów).

TEMAT: ${ctx.topic.topic_label_pl}
FOCUS AREA: ${ctx.topic.focus_area}
GAP CONTENT: ${ctx.topic.has_existing_article === 0 ? 'TAK — pierwszy artykuł na ten temat na bartoszgaca.pl, mocno wzmacniaj że to świeży deep-dive' : 'NIE — istnieją powiązane artykuły, linkuj do nich'}

SYGNAŁY DANYCH (real GSC + GA4 last 30d, bartoszgaca.pl):

GSC top queries (impressions, clicks, avg_position):
${ctx.top_queries.length ? ctx.top_queries.map(q => `  - "${q.query}" → ${q.impressions} imp, ${q.clicks} clk, pos ${q.avg_position?.toFixed(1) || '?'}`).join('\n') : '  (brak danych GSC pasujących do label words — gap content lub nowy temat)'}

GA4 top pages dla tej tematyki:
${ctx.ga4_pages.length ? ctx.ga4_pages.map(p => `  - ${p.page_path} (${p.views} views) — ${(p.page_title || '').slice(0, 70)}`).join('\n') : '  (brak danych GA4)'}

Powiązane istniejące artykuły:
${ctx.related_slugs.length ? ctx.related_slugs.map(s => `  - https://bartoszgaca.pl/aktualnosci/${s}`).join('\n') : '  (BRAK — to gap content)'}

WYMAGANIA:
- PL: pełny artykuł zgodny z ZASADY STRUKTURY z system promptu, ~${wordsArg} słów (~${Math.round(wordsArg * 5.5)} chars HTML)
- EN: hub-spoke shorter, kończy bezwzględnym linkiem do PL: <p>For the full deep dive in Polish (~${wordsArg} words): <a href="https://bartoszgaca.pl/aktualnosci/<slug_pl>">Polish version →</a></p>
- Co najmniej JEDNA sekcja używa real GSC queries powyżej jako data signal ("co users naprawdę szukają")
- Jeśli gap content: w intro wzmocnij że to pierwszy taki artykuł
- CTA na końcu PL: <a href="/biuletyn">Subscribe to bartoszgaca.pl newsletter</a>
- Stopka obu wersji: <p>— Bartek<br>kontakt@bartoszgaca.pl</p>
- Output: WYŁĄCZNIE JSON zgodny ze schema.`;

  const client = new Anthropic();
  const t0 = Date.now();

  const baseOpts = {
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  };

  let article;
  let usage;
  let model;

  // Try messages.parse() first (newer SDK with structured outputs)
  if (typeof client.messages.parse === 'function') {
    try {
      const r = await client.messages.parse({
        ...baseOpts,
        output_config: {
          effort: EFFORT,
          format: {
            type: 'json_schema',
            schema: typeof z.toJSONSchema === 'function' ? z.toJSONSchema(ArticleSchema) : ArticleSchema._def,
          },
        },
      });
      if (r.parsed_output) {
        article = r.parsed_output;
        usage = r.usage;
        model = r.model;
      }
    } catch (err) {
      if (!(err.message && (err.message.includes('parse is not a function') || err.message.includes('output_config')))) {
        throw err;
      }
      console.error(`[draft-article] structured output unavailable (${err.message}), falling back to plain JSON`);
    }
  }

  if (!article) {
    // Fallback: plain create + manual JSON parse
    const plain = await client.messages.create({
      ...baseOpts,
      messages: [{ role: 'user', content: userPrompt + '\n\nKRYTYCZNE: Zwróć WYŁĄCZNIE poprawny JSON zgodny z ArticleSchema. Bez ```json fence. Bez prozy przed/po.' }],
    });
    usage = plain.usage;
    model = plain.model;
    const textBlock = plain.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in response');
    let raw = textBlock.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    article = ArticleSchema.parse(JSON.parse(raw));
  }

  const latencyMs = Date.now() - t0;
  console.error(`\n[claude] ${model} | ${latencyMs}ms | input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens || 0} cache_write=${usage.cache_creation_input_tokens || 0} output=${usage.output_tokens}`);
  console.error(`[article] PL: "${article.title_pl}" (~${Math.round(article.content_pl_html.length / 5.5)} words)`);
  console.error(`[article] EN: "${article.title_en}" (~${Math.round(article.content_en_html.length / 5.5)} words)`);

  const dateIso = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';

  const plTs = tsModule({
    slug: article.slug_pl,
    pairedSlug: article.slug_en,
    lang: 'pl',
    title: article.title_pl,
    contentHtml: article.content_pl_html,
    dateIso,
  });
  const enTs = tsModule({
    slug: article.slug_en,
    pairedSlug: article.slug_pl,
    lang: 'en',
    title: article.title_en,
    contentHtml: article.content_en_html,
    dateIso,
  });

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      title_pl: article.title_pl,
      title_en: article.title_en,
      slug_pl: article.slug_pl,
      slug_en: article.slug_en,
      excerpt_pl: article.excerpt_pl,
      excerpt_en: article.excerpt_en,
      pl_chars: article.content_pl_html.length,
      en_chars: article.content_en_html.length,
      pl_ts_preview: plTs.slice(0, 600) + '\n...',
      en_ts_preview: enTs.slice(0, 600) + '\n...',
      usage: { ...usage, model, latency_ms: latencyMs },
    }, null, 2));
    db.close();
    return;
  }

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const plPath = join(OUTPUT_DIR, `${article.slug_pl}.ts`);
  const enPath = join(OUTPUT_DIR, `${article.slug_en}.ts`);

  if (langArg === 'pl' || langArg === 'both') writeFileSync(plPath, plTs);
  if (langArg === 'en' || langArg === 'both') writeFileSync(enPath, enTs);

  console.error(`\n[draft-article] saved to ${OUTPUT_DIR}/`);
  if (langArg !== 'en') console.error(`  PL → ${plPath}`);
  if (langArg !== 'pl') console.error(`  EN → ${enPath}`);
  console.error(`\nNext: copy these to bartoszgaca.pl/data/articles/ and commit.`);

  // Stdout: JSON for downstream consumption (dashboard route, scripting)
  console.log(JSON.stringify({
    ok: true,
    title_pl: article.title_pl,
    title_en: article.title_en,
    slug_pl: article.slug_pl,
    slug_en: article.slug_en,
    excerpt_pl: article.excerpt_pl,
    excerpt_en: article.excerpt_en,
    pl_ts: plTs,
    en_ts: enTs,
    pl_path: langArg !== 'en' ? plPath : null,
    en_path: langArg !== 'pl' ? enPath : null,
    usage: { ...usage, model, latency_ms: latencyMs },
  }, null, 2));

  db.close();
})().catch(err => {
  console.error('FATAL:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
