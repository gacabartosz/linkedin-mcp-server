#!/usr/bin/env node
// Iter8: cancel media_plan_items zawierające halucynacje (fabrykowane liczby / projekt nie istnieje)
// + powiązany scheduled_post (sync status='cancelled')
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const DB = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const PROJECTS_DIR = join(homedir(), 'projects', 'personal');

// Explicite halucynacyjne (zawierają wymyślone liczby/dane lub projekt nie istnieje)
const EXPLICIT_HALLUCINATIONS = new Set([
  '15-panelszkoly-saas-340-uczniow', // "340 uczniów" — fabrykowane, README mówi tylko "MVP, pierwsza szkoła testuje"
  '14-flora-whatsapp-szkola-jezykowa', // projekt flora nie istnieje, dane (Ola, Kasia) wymyślone
  '20-gaca-proxy-ai-cost-arbitrage', // gaca-core nie istnieje jako standalone projekt
]);

const db = new Database(DB);
const items = db
  .prepare(
    "SELECT id, slug, source_project, scheduled_post_id, status, publish_at FROM media_plan_items WHERE status IN ('plan','napisane')"
  )
  .all();

const targets = [];
for (const it of items) {
  if (EXPLICIT_HALLUCINATIONS.has(it.slug)) {
    targets.push({ ...it, reason: 'explicit-halucination' });
    continue;
  }
  if (!it.source_project) continue;
  // source_project może być pełną ścieżką lub samym name
  const candidates = it.source_project.startsWith('/')
    ? [it.source_project]
    : [
        join(PROJECTS_DIR, it.source_project),
        join(PROJECTS_DIR, it.source_project + '.pl'),
        join(PROJECTS_DIR, it.source_project.replace(/\.pl$/, '')),
      ];
  const exists = candidates.some((p) => existsSync(p));
  if (!exists) {
    targets.push({ ...it, reason: 'project-not-found: ' + it.source_project });
  }
}

if (targets.length === 0) {
  console.log('Nic do cancelowania.');
  db.close();
  process.exit(0);
}

console.log(`Cancel ${targets.length} postów:\n`);
const tx = db.transaction(() => {
  for (const c of targets) {
    db.prepare(
      "UPDATE media_plan_items SET status='cancelled', cannibalize_overlaps = COALESCE(cannibalize_overlaps,'') || ?, updated_at = datetime('now') WHERE id = ?"
    ).run(`[Iter8 cancel: ${c.reason}]`, c.id);
    if (c.scheduled_post_id) {
      db.prepare(
        "UPDATE scheduled_posts SET status='cancelled', updated_at = datetime('now') WHERE id = ?"
      ).run(c.scheduled_post_id);
    }
    console.log(`  ✗ ${c.slug} [${c.publish_at}] — ${c.reason}`);
  }
});
tx();
db.close();
console.log(`\n✓ ${targets.length} postów cancelled w media_plan_items + powiązane scheduled_posts`);
