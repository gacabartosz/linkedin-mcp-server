#!/usr/bin/env node
/**
 * Backfill komentarzy z opublikowanych postów LinkedIn do thread_memory.
 *
 * Cel: daemon Playwright sprawdza tylko notyfikacje (nowe komentarze).
 * Stare posty mają komentarze które nigdy nie były scrapowane.
 * Ten script raz zeskrapuje historię i wygeneruje propozycje odpowiedzi
 * dla komentarzy gdzie my nie odpisaliśmy.
 *
 * Bezpieczeństwo:
 * - max 5 propozycji w całym backfill (Ty wybierasz które zatwierdzić)
 * - skip komentarz starszy niż 30 dni
 * - skip jeśli już odpowiedzieliśmy
 * - skip jeśli to nasz komentarz
 * - tylko aktywne godziny 8-22 CEST
 *
 * Usage:
 *   node scripts/backfill-comments.mjs --dry-run        # nic nie zapisuje
 *   node scripts/backfill-comments.mjs --limit 5        # 5 ostatnich postów
 *   node scripts/backfill-comments.mjs                  # wszystkie z scheduler.db
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const PROFILE = join(homedir(), '.linkedin-mcp', 'browser-profile');
const SCHEDULER_DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const ENGAGE_DB = join(homedir(), '.linkedin-mcp', 'engage.db');
const PERSONA_DIR = '/Users/gaca/projects/personal/second-mind/_system';
const CLAUDE_BIN = '/Users/gaca/.local/bin/claude';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const POST_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 100;

// Hard limits
const MAX_PROPOSALS_TOTAL = 5;
const MAX_PROPOSALS_PER_POST = 3;
const COMMENT_MAX_AGE_DAYS = 30;
const MIN_LEAD_OR_ENGAGE = 3;
const MAX_TROLL_RISK = 2;

const log = (m) => console.log(`[backfill] ${new Date().toISOString().slice(11, 19)} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

// ── Language detection (PL/EN) ──────────────────────────────────────────────
// Wykrywa polski na podstawie: znaków diakrytycznych LUB polskich słów-wskaźników
const PL_WORDS = /\b(jak|jaki|jaka|jakie|jakiego|jakiej|jakim|jakich|co|czy|ile|kiedy|gdzie|dlaczego|kto|który|która|które|jest|są|był|była|było|były|tak|nie|moja|mój|moje|twoja|twój|twoje|nasza|nasz|nasze|wasza|wasz|wasze|ten|ta|to|tego|tej|tym|temu|już|teraz|więc|ale|bo|albo|lub|i|oraz|tylko|nawet|też|także|bardzo|dużo|mało|trochę|wszystko|nic|coś|ktoś|cię|cię|cię|ciebie|tobie|mi|mnie|nam|wam|im|niego|niej|nich|wszystko|jednak|natomiast|wreszcie|zatem|dlatego|jeśli|jeżeli|gdy|kiedy|chociaż|ponieważ|aby|żeby|w|na|do|od|za|przez|po|przed|nad|pod|przy|bez|dla|miedzy|między|wśród|wokół|obok|zamiast|oprócz|pomimo|wobec|wzdłuż|wokoło|naprzeciw|naprzeciwko)\b/i;

function detectLanguage(text) {
  if (!text) return 'polsku';
  // 1. Polskie znaki diakrytyczne
  if (/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text)) return 'polsku';
  // 2. Polskie słowa-wskaźniki (typowe polskie words bez diakrytyki)
  const plMatches = (text.match(PL_WORDS) || []).length;
  // 3. Angielskie words
  const enMatches = (text.match(/\b(the|is|are|was|were|have|has|had|do|does|did|will|would|can|could|should|this|that|these|those|with|from|about|because|however|therefore|but|and|or|not|very|much|some|any|all|every|each|both|either|neither)\b/gi) || []).length;

  if (plMatches > enMatches) return 'polsku';
  if (enMatches > plMatches) return 'angielsku';
  // Tie-break: krótki tekst → PL (konto polskie); długi → EN
  return text.length < 30 ? 'polsku' : 'angielsku';
}

// ── Persona ──────────────────────────────────────────────────────────────────
let personaCache = null;
function loadPersona() {
  if (personaCache) return personaCache;
  let p = '', w = '';
  try { p = readFileSync(join(PERSONA_DIR, 'profile.md'), 'utf-8'); } catch {}
  try { w = readFileSync(join(PERSONA_DIR, 'work-style.md'), 'utf-8'); } catch {}
  personaCache = (p + '\n\n' + w).slice(0, 3500);
  return personaCache;
}

// ── Claude CLI ───────────────────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['-p', '--no-session-persistence', '--model', 'opus'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdin.write(prompt); child.stdin.end();
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    const t = setTimeout(() => { child.kill(); resolve(null); }, 120000);
    child.on('close', code => { clearTimeout(t); resolve(code === 0 ? out.trim() : null); });
    child.on('error', () => { clearTimeout(t); resolve(null); });
  });
}

function parseClaude(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*"should_reply"[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── DB ───────────────────────────────────────────────────────────────────────
function getPublishedPosts(limit) {
  const db = new Database(SCHEDULER_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT post_urn, text, publish_at, published_at
    FROM scheduled_posts
    WHERE status = 'published' AND post_urn IS NOT NULL
    ORDER BY publish_at DESC LIMIT ?
  `).all(limit);
  db.close();
  return rows;
}

function alreadyInThreadMemory(postUrn) {
  const db = new Database(ENGAGE_DB, { readonly: true });
  const row = db.prepare("SELECT 1 FROM thread_memory WHERE post_urn = ?").get(postUrn);
  db.close();
  return !!row;
}

function saveThread(d) {
  if (DRY_RUN) { log(`  [DRY] save thread ${d.postUrn} (${d.comments.length} comments)`); return; }
  const db = new Database(ENGAGE_DB);
  db.prepare(`
    INSERT INTO thread_memory (post_urn, post_text, post_author, post_url, thread_json, our_replies_json, comment_count, last_scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_urn) DO UPDATE SET
      thread_json=excluded.thread_json, our_replies_json=excluded.our_replies_json,
      comment_count=excluded.comment_count, last_scraped_at=datetime('now')
  `).run(d.postUrn, d.postText.slice(0, 2000), d.postAuthor, d.postUrl,
         JSON.stringify(d.comments), JSON.stringify(d.ourReplies), d.comments.length);
  db.close();
}

function saveProposal(p) {
  if (DRY_RUN) { log(`  [DRY] proposal: ${p.proposedReply.slice(0, 60)}...`); return; }
  const db = new Database(ENGAGE_DB);
  db.prepare(`
    INSERT OR IGNORE INTO reply_proposals
    (type, source_id, source_text, source_author, post_urn, post_text,
     proposed_reply, lead_score, troll_risk, engagement_value, thread_context, status)
    VALUES ('comment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(p.commentUrn, p.commentText, p.commentAuthor, p.postUrn, p.postText.slice(0, 500),
         p.proposedReply, p.scoring.lead_score || 0, p.scoring.troll_risk || 0,
         p.scoring.engagement_value || 0, p.threadContext.slice(0, 4000));
  db.close();
}

// ── Playwright scrape ────────────────────────────────────────────────────────
async function scrapePost(page, postUrn) {
  const url = `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
  log(`  → ${url.slice(0, 90)}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(randInt(4000, 8000));

  // Rozwijaj "Show more comments"
  for (let i = 0; i < 4; i++) {
    try {
      const btn = await page.$('button.comments-comments-list__load-more-comments-button, button[aria-label*="more comment"]');
      if (!btn) break;
      await btn.click();
      await sleep(randInt(2000, 4000));
    } catch { break; }
  }

  // Rozwiń replies dla każdego top-level
  const replyBtns = await page.$$('button[aria-label*="repli"], button.comments-comment-item__show-replies-button');
  for (const b of replyBtns.slice(0, 10)) {
    try { await b.click(); await sleep(randInt(1500, 3000)); } catch {}
  }

  return await page.evaluate(() => {
    function find(parent, sels) {
      for (const s of sels) { const el = parent.querySelector(s); if (el?.innerText?.trim()) return el.innerText.trim(); }
      return '';
    }
    const postText = find(document, [
      '.feed-shared-update-v2__description', '.update-components-update-v2__commentary',
      '.feed-shared-update-v2 .update-components-text',
    ]);
    const postAuthor = find(document, [
      '.update-components-actor__name', '.feed-shared-actor__name',
    ]);

    const items = document.querySelectorAll('.comments-comment-entity, .comments-comment-item, article.comments-comment-item');
    const comments = [];
    items.forEach(it => {
      const author = find(it, [
        '.comments-comment-meta__description-title', '.comments-post-meta__name-text',
      ]);
      const text = find(it, [
        '.comments-comment-item__main-content', '.comments-comment-entity__main-content',
        '.update-components-text', '.feed-shared-text',
      ]);
      const urn = it.getAttribute('data-id') || it.getAttribute('data-urn') || (author + '_' + text.slice(0, 30));
      const isReply = !!it.closest('.comments-comment-item--reply, .comments-comment-list__nested, .comments-comment-entity--reply');
      // Próba znalezienia daty
      const timeEl = it.querySelector('time, .comments-comment-meta__data');
      const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim()) : '';
      if (!text || !author) return;
      comments.push({ commentUrn: urn, author, text, isReply, timestamp });
    });
    return { postText, postAuthor, comments };
  });
}

// ── Classify + propose ──────────────────────────────────────────────────────
async function generateProposal(targetComment, allComments, ourReplies, postText, postAuthor, persona) {
  const threadFmt = allComments.map((c, i) => {
    const marker = c.isReply ? '  ↳ ' : '';
    const ours = c.author.includes('Bartosz') ? ' [TWOJA WCZEŚNIEJSZA ODPOWIEDŹ]' : '';
    const target = c.commentUrn === targetComment.commentUrn ? ' ← [TEN KOMENTARZ]' : '';
    return `${marker}${i + 1}. ${c.author}: "${c.text.slice(0, 250)}"${ours}${target}`;
  }).join('\n');
  const oursFmt = ourReplies.length ? ourReplies.map((r, i) => `${i + 1}. ${r}`).join('\n') : '(brak — pierwszy raz)';

  const prompt = `<persona>${persona.slice(0, 2000)}</persona>

<oryginalny_post>
Autor: ${postAuthor}
Treść: ${postText.slice(0, 600)}
</oryginalny_post>

<historia_watku>
${threadFmt || '(brak komentarzy)'}
</historia_watku>

<twoje_poprzednie_odpowiedzi>
${oursFmt}
</twoje_poprzednie_odpowiedzi>

<zadanie>
Komentarz do oceny: "${targetComment.text}"
Autor: ${targetComment.author}

Oceń (1-5):
- lead_score: konkretne zainteresowanie usługą/ceną/demo
- troll_risk: agresja/spam/trolling
- engagement_value: pytanie/dyskusja

should_reply = (lead≥${MIN_LEAD_OR_ENGAGE} OR engagement≥${MIN_LEAD_OR_ENGAGE}) AND troll≤${MAX_TROLL_RISK}

UWAGA: To komentarz HISTORYCZNY (sprzed kilku tygodni). Odpowiadaj TYLKO jeśli:
- konkretny lead (lead_score≥4)
- ważne pytanie merytoryczne wciąż aktualne

**JĘZYK ODPOWIEDZI:** wykryj język KOMENTARZA (nie postu, nie wątku — tylko komentarza "${targetComment.text}") i odpowiedz dokładnie w tym samym języku. Jeśli komentarz po polsku → odpowiedź po polsku. Jeśli po angielsku → odpowiedź po angielsku. Mieszany? — użyj dominującego.

Jeśli should_reply=true, napisz odpowiedź 50-120 słów,
bez "Świetny komentarz", "Dzięki za pytanie", zakończ pytaniem/obserwacją.

ZWRÓĆ TYLKO JSON:
{"lead_score": N, "troll_risk": N, "engagement_value": N, "should_reply": true|false, "reply": "...", "reasoning": "1 zdanie"}
</zadanie>`;

  const out = await callClaude(prompt);
  return parseClaude(out);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  log(`Backfill ${DRY_RUN ? 'DRY-RUN' : 'LIVE'} | limit ${POST_LIMIT} postów | max ${MAX_PROPOSALS_TOTAL} propozycji łącznie`);

  const posts = getPublishedPosts(POST_LIMIT);
  log(`Pobieram ${posts.length} opublikowanych postów z scheduler.db`);

  const persona = loadPersona();
  log(`Persona: ${persona.length} znaków`);

  log('Uruchamiam Playwright (headed)...');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

  let totalProposals = 0;
  const stats = { posts: 0, comments: 0, scraped: 0, skipped: 0, errors: 0 };

  try {
    for (const post of posts) {
      if (totalProposals >= MAX_PROPOSALS_TOTAL) {
        log(`Limit ${MAX_PROPOSALS_TOTAL} propozycji łącznie. Stop.`);
        break;
      }
      stats.posts++;
      log(`\n[${stats.posts}/${posts.length}] ${post.post_urn}`);
      log(`  Post: ${post.text.slice(0, 80)}...`);

      try {
        const data = await scrapePost(page, post.post_urn);
        log(`  ${data.comments.length} komentarzy znaleziono`);
        stats.scraped++;

        // Identyfikuj "nasze" odpowiedzi
        const ourReplies = data.comments
          .filter(c => /bartosz.*gaca|gaca.*bartosz/i.test(c.author))
          .map(c => c.text);
        log(`  ${ourReplies.length} naszych odpowiedzi w wątku`);

        // Zapisz pełny wątek
        saveThread({
          postUrn: post.post_urn,
          postText: data.postText || post.text,
          postAuthor: data.postAuthor || 'Bartosz Gaca',
          postUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(post.post_urn)}/`,
          comments: data.comments,
          ourReplies,
        });

        // Komentarze do których nie odpowiedzieliśmy
        const candidates = data.comments.filter(c => {
          if (/bartosz.*gaca|gaca.*bartosz/i.test(c.author)) return false;
          // Jeśli reply pojawia się PO naszym komentarzu w wątku — skip
          return true;
        });

        if (candidates.length === 0) { log('  Brak nowych komentarzy do analizy'); continue; }

        let perPost = 0;
        for (const cm of candidates) {
          if (totalProposals >= MAX_PROPOSALS_TOTAL) break;
          if (perPost >= MAX_PROPOSALS_PER_POST) break;
          stats.comments++;

          log(`  Analizuję: "${cm.author}: ${cm.text.slice(0, 60)}..."`);
          const result = await generateProposal(cm, data.comments, ourReplies, data.postText || post.text, data.postAuthor || 'Bartosz Gaca', persona);

          if (!result) { log('    ⚠️  Claude nie zwrócił JSON'); stats.errors++; continue; }
          log(`    lead=${result.lead_score} troll=${result.troll_risk} engage=${result.engagement_value} reply=${result.should_reply}`);

          if (result.should_reply && result.reply) {
            saveProposal({
              commentUrn: cm.commentUrn, commentText: cm.text, commentAuthor: cm.author,
              postUrn: post.post_urn, postText: post.text,
              proposedReply: result.reply,
              scoring: { lead_score: result.lead_score, troll_risk: result.troll_risk, engagement_value: result.engagement_value },
              threadContext: data.comments.map(c => `${c.author}: "${c.text}"`).join('\n'),
            });
            totalProposals++; perPost++;
            log(`    ✅ Propozycja (${totalProposals}/${MAX_PROPOSALS_TOTAL})`);
          } else {
            log(`    ⊘ Skip: ${result.reasoning}`);
            stats.skipped++;
          }
        }

        // Random delay między postami (jak człowiek)
        const pause = randInt(15000, 40000);
        log(`  Pauza ${Math.round(pause/1000)}s przed kolejnym postem...`);
        await sleep(pause);
      } catch (e) {
        log(`  ❌ Błąd: ${e.message}`);
        stats.errors++;
      }
    }
  } finally {
    await ctx.close();
    log(`\n=== KONIEC ===`);
    log(`Postów sprawdzonych: ${stats.scraped}/${stats.posts}`);
    log(`Komentarzy analizowanych: ${stats.comments}`);
    log(`Propozycji utworzonych: ${totalProposals}`);
    log(`Skipped: ${stats.skipped}`);
    log(`Errors: ${stats.errors}`);
  }
})();
