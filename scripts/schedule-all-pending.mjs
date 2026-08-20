#!/usr/bin/env node
/**
 * Batch schedule wszystkich postów z media_plan_items → scheduled_posts.
 *
 * Dla każdego topic_number w (9,14,15,17,18,19,20,21,22):
 *  - jeśli nie ma jeszcze scheduled_post_id w media_plan_items → INSERT do scheduled_posts
 *  - UPDATE media_plan_items.scheduled_post_id + status='napisane'
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const db = new Database(join(homedir(), '.linkedin-mcp', 'scheduler.db'));

const TARGET_TOPICS = [9, 14, 15, 17, 18, 19, 20, 21, 22];

const items = db.prepare(`
  SELECT * FROM media_plan_items
  WHERE topic_number IN (${TARGET_TOPICS.join(',')})
  ORDER BY publish_at
`).all();

console.log(`Znalazłem ${items.length} postów do schedulingu:`);

let scheduled = 0, skipped = 0;

const insertStmt = db.prepare(`
  INSERT INTO scheduled_posts
    (id, text, visibility, language, publish_at, status, created_at, updated_at)
  VALUES (?, ?, 'PUBLIC', ?, ?, 'scheduled', datetime('now'), datetime('now'))
`);
const updateStmt = db.prepare(`
  UPDATE media_plan_items
  SET scheduled_post_id = ?, status = 'napisane', updated_at = datetime('now')
  WHERE id = ?
`);

for (const it of items) {
  // Skip jeśli już ma scheduled_post_id ORAZ ten post istnieje
  if (it.scheduled_post_id) {
    const exists = db.prepare("SELECT 1 FROM scheduled_posts WHERE id = ?").get(it.scheduled_post_id);
    if (exists) {
      console.log(`  ⊘ #${it.topic_number} ${it.slug} — już zaplanowany (${it.scheduled_post_id})`);
      skipped++;
      continue;
    }
  }

  // Skip jeśli brak treści
  if (!it.post_text) {
    console.log(`  ⊘ #${it.topic_number} ${it.slug} — brak post_text`);
    skipped++;
    continue;
  }

  const id = randomUUID();
  // Konwersja publish_at: '2026-05-13 08:00:00' → ISO z timezone CEST (+02:00)
  const dateStr = it.publish_at.replace(' ', 'T') + '+02:00';

  insertStmt.run(id, it.post_text, it.language || 'pl', dateStr);
  updateStmt.run(id, it.id);

  console.log(`  ✅ #${it.topic_number} ${it.slug} → scheduled_post ${id.substring(0,8)} on ${dateStr}`);
  scheduled++;
}

db.close();

console.log(`\nGotowe: ${scheduled} zaplanowanych, ${skipped} pominiętych`);
