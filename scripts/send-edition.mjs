#!/usr/bin/env node
/**
 * Newsletter sender + LinkedIn cross-poster.
 *
 * Reads scheduled editions from content.db, sends to confirmed subscribers via Resend,
 * then enqueues a LinkedIn UGC teaser into scheduler.db (NOT immediate publish — picked
 * up by auto-publish.mjs 60s loop).
 *
 * Usage:
 *   node scripts/send-edition.mjs                                # send all due editions
 *   node scripts/send-edition.mjs --dry-run                      # print, no email, no scheduler.db write
 *   node scripts/send-edition.mjs --limit-to=kontakt@bartoszgaca.pl  # send to one address only
 *   node scripts/send-edition.mjs --edition=1                    # specific edition number
 *
 * Safety: combination of --dry-run + --limit-to + status='scheduled' (not immediate)
 * makes mass spam essentially impossible.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Resend } from 'resend';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const CONTENT_DB = join(DATA_DIR, 'content.db');
const SCHEDULER_DB = join(DATA_DIR, 'scheduler.db');

const args = process.argv.slice(2);
const flagVal = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const dryRun = args.includes('--dry-run');
const limitTo = flagVal('limit-to', null);
const editionFilter = flagVal('edition', null);

if (!existsSync(CONTENT_DB)) {
  console.error(`FATAL: ${CONTENT_DB} doesn't exist.`);
  process.exit(2);
}

const FROM_EMAIL = process.env.BIULETYN_FROM_EMAIL || 'biuletyn@bartoszgaca.pl';
const FROM_NAME = process.env.BIULETYN_FROM_NAME || 'Bartosz Gaca';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://bartoszgaca.pl';

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS newsletter_editions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, edition_number INTEGER UNIQUE,
      topic_slug TEXT NOT NULL, subject TEXT NOT NULL, preheader TEXT,
      intro_md TEXT NOT NULL, body_md TEXT NOT NULL, cta_url TEXT NOT NULL,
      linkedin_teaser TEXT NOT NULL, linkedin_scheduled_post_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft','scheduled','sent','failed')),
      send_at TEXT, sent_at TEXT, recipient_count INTEGER, resend_batch_id TEXT,
      model_used TEXT, input_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','confirmed','unsubscribed','bounced')),
      confirm_token TEXT, unsubscribe_token TEXT NOT NULL,
      consent_text_version TEXT NOT NULL, source TEXT, ip_at_signup TEXT, user_agent TEXT,
      created_at TEXT NOT NULL, confirmed_at TEXT, unsubscribed_at TEXT
    );
  `);
}

function findDueEditions(db) {
  const now = new Date().toISOString();
  let sql = `SELECT * FROM newsletter_editions WHERE status = 'scheduled' AND (send_at IS NULL OR send_at <= ?)`;
  const params = [now];
  if (editionFilter) { sql += ' AND edition_number = ?'; params.push(parseInt(editionFilter, 10)); }
  sql += ' ORDER BY edition_number ASC LIMIT 5';
  return db.prepare(sql).all(...params);
}

function loadRecipients(db) {
  if (limitTo) {
    return [{ email: limitTo, unsubscribe_token_hash: null, _is_test_recipient: true }];
  }
  return db.prepare(`SELECT email, unsubscribe_token FROM subscribers WHERE status = 'confirmed'`).all()
    .map(r => ({ email: r.email, unsubscribe_token_hash: r.unsubscribe_token }));
}

// Markdown → minimal HTML (h2/h3, lists, paragraphs, code, links). Not a full parser; covers our drafter output.
function mdToHtml(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre style="background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto;font-family:monospace;font-size:13px"><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code style="background:#f4f4f4;padding:2px 6px;border-radius:3px;font-family:monospace;font-size:13px">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:17px;margin:24px 0 8px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:20px;margin:32px 0 12px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:24px;margin:32px 0 12px">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0a66c2">$1</a>');
  // Lists
  html = html.replace(/(?:^- .+\n?)+/gm, m => '<ul style="padding-left:20px">' + m.split(/\n/).filter(Boolean).map(l => `<li>${l.replace(/^- /, '')}</li>`).join('') + '</ul>');
  // Paragraphs
  html = html.split(/\n{2,}/).map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|ul|ol|pre)/.test(trimmed)) return trimmed;
    return `<p style="margin:12px 0;line-height:1.6">${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

function renderEditionHtml(edition, unsubscribeUrl) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${edition.subject}</title></head>
<body style="font-family:system-ui,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:32px 16px;color:#222;background:#fff">
${edition.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${edition.preheader}</div>` : ''}
${mdToHtml(edition.intro_md)}
${mdToHtml(edition.body_md)}
<p style="margin:32px 0"><a href="${edition.cta_url}" style="background:#0a66c2;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Czytaj cały materiał na bartoszgaca.pl</a></p>
<p style="margin-top:32px">— Bartek<br>kontakt@bartoszgaca.pl</p>
<hr style="margin:32px 0;border:0;border-top:1px solid #ddd">
<p style="font-size:12px;color:#999">Edycja #${edition.edition_number} biuletynu bartoszgaca.pl. Nie chcesz dostawać kolejnych? <a href="${unsubscribeUrl}" style="color:#999">Wypisz się</a>.</p>
</body></html>`;
}

function renderEditionText(edition, unsubscribeUrl) {
  const stripMd = s => (s || '').replace(/[*_`#]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return `${stripMd(edition.intro_md)}\n\n${stripMd(edition.body_md)}\n\nCzytaj na: ${edition.cta_url}\n\n— Bartek\nkontakt@bartoszgaca.pl\n\n--\nWypisz się: ${unsubscribeUrl}`;
}

function unsubUrlFor(unsubscribeTokenHash) {
  // Subscribers' tokens are stored hashed. We need a way to render a working unsub link.
  // For now, link to the generic unsubscribe page that asks for confirmation.
  // Dedicated per-recipient tokens would require a schema change to keep plaintext (against best practice).
  // Trade-off: hashed-at-rest tokens vs single-click unsub. v1 takes hashed-at-rest + manual confirm page.
  return `${PUBLIC_BASE_URL}/biuletyn/wypisano?signal=footer`;
}

async function sendOne(resend, edition, recipient) {
  const unsubUrl = unsubUrlFor(recipient.unsubscribe_token_hash);
  const html = renderEditionHtml(edition, unsubUrl);
  const text = renderEditionText(edition, unsubUrl);
  return resend.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: recipient.email,
    subject: edition.subject,
    html, text,
    headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
}

function enqueueLinkedinTeaser(edition) {
  if (!existsSync(SCHEDULER_DB)) {
    console.error(`[skipped] scheduler.db not found at ${SCHEDULER_DB} — LinkedIn teaser not enqueued`);
    return null;
  }
  const db = new Database(SCHEDULER_DB);
  db.pragma('journal_mode = WAL');
  // scheduler.db schema is owned by linkedin-mcp-server; we INSERT minimum required cols and let publisher pick it up
  // From src/scheduler/store.ts:40-61 — scheduled_posts has: id (TEXT), text, visibility, status, publish_at, created_at, updated_at, etc.
  const id = `nl-${edition.edition_number}-${Date.now()}`;
  const text = `${edition.linkedin_teaser}\n\n${edition.cta_url}`;
  const publishAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO scheduled_posts (id, text, visibility, status, publish_at, created_at, updated_at, retry_count)
                VALUES (?, ?, 'PUBLIC', 'scheduled', ?, ?, ?, 0)`).run(id, text, publishAt, now, now);
  } catch (err) {
    console.error('[scheduler.db insert]', err?.message || err);
    db.close();
    return null;
  }
  db.close();
  return { id, publish_at: publishAt };
}

(async () => {
  const db = new Database(CONTENT_DB);
  db.pragma('journal_mode = WAL');
  ensureTables(db);

  const editions = findDueEditions(db);
  if (editions.length === 0) {
    console.error('[send-edition] no due editions');
    db.close();
    return;
  }

  const recipients = loadRecipients(db);
  console.error(`[send-edition] ${editions.length} edition(s) due, ${recipients.length} recipient(s)${limitTo ? ' (limited to ' + limitTo + ')' : ''}${dryRun ? ' [DRY RUN]' : ''}`);

  if (recipients.length === 0 && !dryRun) {
    console.error('[send-edition] no confirmed subscribers — nothing to send');
    db.close();
    return;
  }

  const resend = dryRun ? null : (() => {
    if (!process.env.RESEND_API_KEY) { console.error('FATAL: RESEND_API_KEY not set'); process.exit(2); }
    return new Resend(process.env.RESEND_API_KEY);
  })();

  for (const edition of editions) {
    console.error(`\n[edition #${edition.edition_number}] ${edition.subject}`);

    if (dryRun) {
      console.log(JSON.stringify({
        edition_number: edition.edition_number,
        subject: edition.subject,
        recipients_count: recipients.length,
        first_200_chars: edition.intro_md.slice(0, 200),
        would_enqueue_linkedin_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        linkedin_teaser_preview: edition.linkedin_teaser.slice(0, 200),
      }, null, 2));
      continue;
    }

    let sent = 0;
    let failed = 0;
    let resendBatchId = null;
    for (const r of recipients) {
      try {
        const resp = await sendOne(resend, edition, r);
        sent++;
        if (!resendBatchId && resp?.data?.id) resendBatchId = resp.data.id;
      } catch (err) {
        failed++;
        console.error(`  [send failed] ${r.email}: ${err?.message || err}`);
      }
    }
    console.error(`  → sent ${sent}, failed ${failed}`);

    // Enqueue LinkedIn teaser
    const teaser = enqueueLinkedinTeaser(edition);
    if (teaser) console.error(`  → LinkedIn teaser enqueued: ${teaser.id} (publish_at=${teaser.publish_at})`);

    // Mark edition as sent
    db.prepare(`UPDATE newsletter_editions SET status='sent', sent_at=?, recipient_count=?, resend_batch_id=?, linkedin_scheduled_post_id=?, updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), sent, resendBatchId, teaser ? teaser.id : null, new Date().toISOString(), edition.id);
  }

  db.close();
  console.error('\n[send-edition] done');
})().catch(err => {
  console.error('FATAL:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
