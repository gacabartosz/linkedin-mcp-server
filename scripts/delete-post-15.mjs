#!/usr/bin/env node
/**
 * Phase 3 (plan: 1-wejdz-i-sprawc-abundant-patterson.md) — usuń post #15
 * ("Zbudowałem chatbot na bartoszgaca.pl. Po 3 dniach ktoś próbował go zhakować.")
 * z LinkedIn i zsynchronizuj DB.
 *
 * IRREVERSIBLE. Wymaga --confirm żeby uniknąć przypadkowego strzału.
 *
 * Flow:
 *   1. Default = DRY-RUN: tylko pokaż co byłoby usunięte.
 *   2. Z --confirm: wywołaj deletePost(URN) na LI API, update DB,
 *      log do ~/.linkedin-mcp/deleted-posts.log.
 *
 * Usage:
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/delete-post-15.mjs
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/delete-post-15.mjs --confirm
 */

import { deletePost } from '../dist/api/posts.js';
import Database from 'better-sqlite3';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TARGET_URN = 'urn:li:share:7468480400596656128';
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const LOG_PATH = join(homedir(), '.linkedin-mcp', 'deleted-posts.log');
const CONFIRM = process.argv.includes('--confirm');

const db = new Database(DB_PATH);
const row = db
  .prepare(
    `SELECT id, status, published_at, substr(text, 1, 100) AS preview
     FROM scheduled_posts
     WHERE post_urn = ?`,
  )
  .get(TARGET_URN);

if (!row) {
  console.error(`[delete] FATAL: brak rekordu z post_urn=${TARGET_URN} w DB`);
  db.close();
  process.exit(1);
}

console.log('[delete] TARGET:');
console.log(`         urn=${TARGET_URN}`);
console.log(`         db_id=${row.id} · status=${row.status}`);
console.log(`         published_at=${row.published_at}`);
console.log(`         preview="${row.preview}..."`);
console.log('');

if (!CONFIRM) {
  console.log('[delete] DRY-RUN — nic nie usuwam.');
  console.log('         Aby usunąć z LinkedIn dodaj flagę --confirm.');
  console.log('         UWAGA: operacja jest NIEODWRACALNA — LI nie pozwala odzyskać posta.');
  db.close();
  process.exit(0);
}

console.log('[delete] --confirm given → wykonuję DELETE na LinkedIn...');

try {
  const result = await deletePost(TARGET_URN);
  console.log(`[delete] LI API OK: ${JSON.stringify(result)}`);

  db.prepare(
    `UPDATE scheduled_posts
     SET status = 'cancelled',
         error = ?,
         updated_at = datetime('now')
     WHERE post_urn = ?`,
  ).run('deleted-by-user-2026-06-07-content-quality', TARGET_URN);

  const logLine = `${new Date().toISOString()}\t${TARGET_URN}\tdb_id=${row.id}\tpreview="${row.preview.replace(/\t/g, ' ')}"\n`;
  appendFileSync(LOG_PATH, logLine);

  console.log(`[delete] DB updated: status=cancelled`);
  console.log(`[delete] Logged to ${LOG_PATH}`);
  console.log(`[delete] DONE. Post ${TARGET_URN} usunięty z LinkedIn.`);
} catch (e) {
  console.error('[delete] FAILED:', e?.message || e);
  console.error('[delete] DB nie został zaktualizowany — stan niezmieniony.');
  console.error('[delete] Możesz spróbować usunąć ręcznie z LinkedIn UI:');
  console.error(`         https://www.linkedin.com/feed/update/${encodeURIComponent(TARGET_URN)}/`);
  db.close();
  process.exit(1);
}

db.close();
