#!/usr/bin/env node
/**
 * Napraw publish_at dla postów zaimportowanych przez fetch-all-my-posts.mjs.
 *
 * LinkedIn URN ID jest Snowflake — dekodowanie:
 *   shift 22 bitów w prawo, epoch UNIX (0).
 * Walidowane na 3 znanych postach (pierogi 08.04, hala 03.03, testujący 29.04) ✅
 *
 * Updates tylko posty z 'publish_at LIKE 2026-05-11T13:48%' (import timestamp).
 */
import Database from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/better-sqlite3/lib/index.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

const db = new Database(join(homedir(), '.linkedin-mcp', 'scheduler.db'));

function snowflakeToDate(urn) {
  const m = urn.match(/(activity|share|ugcPost):(\d+)/);
  if (!m) return null;
  const ts = Number(BigInt(m[2]) >> 22n);
  return new Date(ts);
}

// Tylko posty z błędną datą importu
const rows = db.prepare(`
  SELECT id, post_urn, publish_at
  FROM scheduled_posts
  WHERE post_urn IS NOT NULL
    AND publish_at LIKE '2026-05-11T13:48%'
`).all();

console.log(`Znalazłem ${rows.length} postów do naprawy dat\n`);

let updated = 0, skipped = 0, errors = 0;
const stmt = db.prepare("UPDATE scheduled_posts SET publish_at = ?, updated_at = datetime('now') WHERE id = ?");

for (const r of rows) {
  const date = snowflakeToDate(r.post_urn);
  if (!date) { console.log(`❌ ${r.post_urn.slice(0,50)} — nie udało się dekodować`); errors++; continue; }

  const year = date.getFullYear();
  if (year < 2015 || year > 2026) {
    console.log(`⚠️  ${r.post_urn.slice(0,50)} → ${date.toISOString().slice(0,10)} (poza zakresem, skip)`);
    skipped++;
    continue;
  }

  stmt.run(date.toISOString(), r.id);
  console.log(`✅ ${r.post_urn.slice(0,50).padEnd(50)} → ${date.toISOString().slice(0,16)}`);
  updated++;
}

console.log(`\nGotowe: ${updated} zaktualizowanych, ${skipped} pominiętych, ${errors} błędów`);
db.close();
