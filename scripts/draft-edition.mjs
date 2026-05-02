#!/usr/bin/env node
/**
 * Newsletter edition drafter.
 *
 * Pulls a topic + its GSC top queries + related article slugs from content.db,
 * calls Claude (Sonnet 4.6, adaptive thinking, prompt-cached system prompt)
 * to generate a JSON edition draft, and upserts it into newsletter_editions.
 *
 * Brand voice: bartoszgaca.pl personal newsletter — ciepło-po-imieniu PL.
 *
 * Usage:
 *   node scripts/draft-edition.mjs --topic-slug=token-optimization
 *   node scripts/draft-edition.mjs --topic-slug=token-optimization --dry-run
 *   node scripts/draft-edition.mjs --top                     # use highest-score gap topic
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const DB_PATH = join(DATA_DIR, 'content.db');
const MODEL = process.env.DRAFT_MODEL || 'claude-sonnet-4-6';

const args = process.argv.slice(2);
const flagVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const dryRun = args.includes('--dry-run');
const useTop = args.includes('--top');
const topicSlugArg = flagVal('topic-slug', null);

if (!existsSync(DB_PATH)) {
  console.error(`FATAL: ${DB_PATH} doesn't exist. Run topic-rank.mjs first.`);
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY env var not set');
  process.exit(2);
}

const EditionSchema = z.object({
  subject: z.string().min(20).max(120).describe('Email subject line, 20-80 chars optimal, polski'),
  preheader: z.string().min(40).max(140).describe('Email preheader, 80-130 chars, polski'),
  intro_md: z.string().min(150).describe('Intro paragraph in PL, ciepło-po-imieniu tone (zaczyna od "Cześć," albo bezpośrednio do czytelnika), markdown allowed'),
  body_md: z.string().min(800).describe('Main body in PL: 3 sections with ## headings. Section 1: dlaczego ten temat (data signal). Section 2: jak to zrobić (3-5 konkretnych kroków). Section 3: linki do dalszego czytania.'),
  cta_url: z.string().url().describe('Single CTA URL pointing to bartoszgaca.pl article (use related slug if provided, else https://bartoszgaca.pl/biuletyn)'),
  linkedin_teaser: z.string().min(400).max(1300).describe('LinkedIn UGC post teaser, 800-1300 chars, hook + 3 bulletpoints + soft CTA do biuletynu, polski'),
});

const SYSTEM_PROMPT = `Jesteś autorem biuletynu Bartosza Gacy na bartoszgaca.pl.

ZASADY TONU:
- Polski, ciepło-po-imieniu, jak do partnera biznesowego po imieniu
- Bezpośrednio, konkretnie, bez korpo-bełkotu
- Zaczynaj akapity od podmiotu, nie od "Jak wiemy", "Warto pamiętać"
- Pisz "ty/twój" nie "Państwo/Pana"
- Konkretne liczby, dane, przykłady > abstrakcyjne stwierdzenia
- Nie używaj emoji w nagłówkach (jeden emoji na całą edycję maksymalnie)

ZASADY STRUKTURY EDYCJI:
1. Subject: max 80 znaków, ciekawość + konkret (nie clickbait)
2. Preheader: rozszerza subject, dodaje value prop, nie powtarza
3. Intro (150-300 słów): hook od konkretu/historii/danych → dlaczego ten temat dziś
4. Body 3 sekcje:
   - "Dlaczego to ważne (i dla kogo)" — data signal, kogo to dotyczy
   - "Jak to zrobić (krok po kroku)" — 3-5 konkretnych kroków, można z code/CLI snippets
   - "Co dalej (i gdzie czytać)" — linki, related articles, follow-up
5. CTA URL: jeden, konkretny, prowadzi do artykułu na bartoszgaca.pl
6. LinkedIn teaser:
   - 800-1300 znaków
   - Hook (1-2 linijki) → 3 bulletpointy → soft CTA "Cały materiał w biuletynie: [URL]"
   - Algorytm LinkedIn lubi linie 1-2 zdań, nie ściany tekstu
   - Bez hashtagów na końcu (max 2 inline jeśli już)

ZASADY BRANDU:
- Brand: bartoszgaca.pl (NIE BeeCommerce — to osobny brand, nie mieszać)
- Autor: Bartosz Gaca, kontakt@bartoszgaca.pl
- Tematy: Claude Code, optymalizacja tokenów, MCP, AI dev workflow

OUTPUT: Zwracaj WYŁĄCZNIE poprawny JSON zgodny z wymaganym schema. Bez prozy przed/po, bez markdown fence, bez komentarzy.`;

function loadTopicContext(db, topicSlug) {
  const topic = db.prepare('SELECT * FROM topic_scores WHERE topic_slug = ?').get(topicSlug);
  if (!topic) throw new Error(`Topic ${topicSlug} not found in topic_scores. Run topic-rank.mjs.`);

  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  // Top 10 GSC queries that match the topic label keywords
  const labelWords = topic.topic_label_pl.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const likeClause = labelWords.map(() => 'LOWER(query) LIKE ?').join(' OR ') || '1=1';
  const likeParams = labelWords.map(w => `%${w}%`);
  const queries = db.prepare(`
    SELECT query, SUM(impressions) AS impressions, SUM(clicks) AS clicks, AVG(position) AS avg_position
    FROM gsc_queries_daily
    WHERE date >= ? AND (${likeClause})
    GROUP BY query
    ORDER BY impressions DESC
    LIMIT 10
  `).all(cutoff, ...likeParams);

  // Top GA4 pages for this topic (matches keyword in path or title)
  const ga4Pages = db.prepare(`
    SELECT page_path, page_title, SUM(views) AS views
    FROM ga4_pageviews_daily
    WHERE date >= ? AND (LOWER(page_path) LIKE ? OR LOWER(page_title) LIKE ?)
    GROUP BY page_path
    ORDER BY views DESC
    LIMIT 5
  `).all(cutoff, `%${labelWords[0] || ''}%`, `%${labelWords[0] || ''}%`);

  return {
    topic,
    related_slugs: JSON.parse(topic.related_article_slugs || '[]'),
    top_queries: queries,
    ga4_pages: ga4Pages,
  };
}

function ensureEditionsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_editions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      edition_number INTEGER UNIQUE,
      topic_slug TEXT NOT NULL,
      subject TEXT NOT NULL,
      preheader TEXT,
      intro_md TEXT NOT NULL,
      body_md TEXT NOT NULL,
      cta_url TEXT NOT NULL,
      linkedin_teaser TEXT NOT NULL,
      linkedin_scheduled_post_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('draft','scheduled','sent','failed')),
      send_at TEXT, sent_at TEXT,
      recipient_count INTEGER,
      resend_batch_id TEXT,
      model_used TEXT,
      input_tokens INTEGER,
      cache_read_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ne_status ON newsletter_editions(status);
    CREATE INDEX IF NOT EXISTS idx_ne_topic ON newsletter_editions(topic_slug);
  `);
}

(async () => {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  ensureEditionsTable(db);

  let slug = topicSlugArg;
  if (!slug && useTop) {
    const top = db.prepare('SELECT topic_slug FROM topic_scores ORDER BY score DESC LIMIT 1').get();
    if (!top) { console.error('No topics scored. Run topic-rank.mjs.'); process.exit(2); }
    slug = top.topic_slug;
  }
  if (!slug) {
    console.error('Usage: --topic-slug=<slug> or --top');
    process.exit(2);
  }

  const ctx = loadTopicContext(db, slug);
  console.error(`[draft-edition] topic=${slug} (score=${ctx.topic.score?.toFixed(3)})`);
  console.error(`  related slugs: ${ctx.related_slugs.length}`);
  console.error(`  top queries: ${ctx.top_queries.length}`);
  console.error(`  ga4 pages: ${ctx.ga4_pages.length}`);

  const userPrompt = `Wygeneruj edycję biuletynu na temat: **${ctx.topic.topic_label_pl}**

Sygnały danych z bartoszgaca.pl (last 30d):
- GSC top queries (impressions, clicks, avg_position):
${ctx.top_queries.length ? ctx.top_queries.map(q => `  - "${q.query}" → ${q.impressions} imp, ${q.clicks} clk, pos ${q.avg_position?.toFixed(1)}`).join('\n') : '  (brak danych GSC dla tego topiku)'}

- GA4 top pages (views):
${ctx.ga4_pages.length ? ctx.ga4_pages.map(p => `  - ${p.page_path} (${p.views} views) — ${p.page_title || ''}`).join('\n') : '  (brak danych GA4 dla tego topiku)'}

- Powiązane artykuły na bartoszgaca.pl:
${ctx.related_slugs.length ? ctx.related_slugs.map(s => `  - https://bartoszgaca.pl/news/${s}`).join('\n') : '  (BRAK — to gap content; CTA prowadź do https://bartoszgaca.pl/biuletyn)'}

WYMAGANIA:
- Edycja w PL, ton ciepło-po-imieniu, struktura 3 sekcje
- LinkedIn teaser w PL, 800-1300 znaków, soft CTA do biuletynu
- Subject + preheader w PL, mocne ale nie clickbait
- Jeśli to gap content (zero powiązanych artykułów), w sekcji "Co dalej" zapowiedź pełnego artykułu na bartoszgaca.pl
- Output: WYŁĄCZNIE JSON zgodny ze schema, nic poza tym`;

  const client = new Anthropic();
  const t0 = Date.now();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: z.toJSONSchema ? z.toJSONSchema(EditionSchema) : EditionSchema._def, // SDK helper falls back gracefully
        effort: 'medium',
      },
    },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  }).catch(async (err) => {
    // SDK .parse() may not be available in 0.78.0 with Zod helper; fallback to plain create + manual parse
    if (err && err.message && err.message.includes('parse is not a function')) return null;
    throw err;
  });

  let edition;
  let usage;
  let model;

  if (response && response.parsed_output) {
    edition = response.parsed_output;
    usage = response.usage;
    model = response.model;
  } else {
    // Fallback: plain messages.create with strict JSON instruction
    const plain = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt + '\n\nZwróć WYŁĄCZNIE JSON, bez ```json fence i bez prozy.' }],
    });
    usage = plain.usage;
    model = plain.model;
    const textBlock = plain.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in response');
    let raw = textBlock.text.trim();
    // Strip markdown fences if model added them
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    const parsed = JSON.parse(raw);
    edition = EditionSchema.parse(parsed);
  }

  const latencyMs = Date.now() - t0;
  console.error(`\n[claude] ${model} | ${latencyMs}ms | input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens || 0} cache_write=${usage.cache_creation_input_tokens || 0} output=${usage.output_tokens}`);

  if (dryRun) {
    console.log(JSON.stringify(edition, null, 2));
    db.close();
    return;
  }

  const now = new Date().toISOString();
  // Determine next edition number
  const maxRow = db.prepare('SELECT MAX(edition_number) AS n FROM newsletter_editions').get();
  const editionNumber = (maxRow.n || 0) + 1;

  const stmt = db.prepare(`
    INSERT INTO newsletter_editions
      (edition_number, topic_slug, subject, preheader, intro_md, body_md, cta_url, linkedin_teaser,
       status, model_used, input_tokens, cache_read_tokens, output_tokens, created_at, updated_at)
    VALUES (@edition_number, @topic_slug, @subject, @preheader, @intro_md, @body_md, @cta_url, @linkedin_teaser,
            'draft', @model_used, @input_tokens, @cache_read_tokens, @output_tokens, @created_at, @updated_at)
  `);
  const info = stmt.run({
    edition_number: editionNumber,
    topic_slug: slug,
    subject: edition.subject,
    preheader: edition.preheader,
    intro_md: edition.intro_md,
    body_md: edition.body_md,
    cta_url: edition.cta_url,
    linkedin_teaser: edition.linkedin_teaser,
    model_used: model,
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_input_tokens || 0,
    output_tokens: usage.output_tokens,
    created_at: now,
    updated_at: now,
  });

  console.error(`\n[draft-edition] saved as edition #${editionNumber} (id=${info.lastInsertRowid})`);
  console.error(`  subject: ${edition.subject}`);
  console.error(`  cta:     ${edition.cta_url}`);
  console.error(`  linkedin teaser: ${edition.linkedin_teaser.length} chars`);
  db.close();
})().catch(err => {
  console.error('FATAL:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
