import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

let db: Database.Database | null = null;

export interface ScheduledPost {
  id: string;
  text: string;
  visibility: string;
  media_ids: string | null;
  article_url: string | null;
  article_title: string | null;
  article_description: string | null;
  template_id: string | null;
  template_vars: string | null;
  gemini_prompt: string | null;
  gemini_aspect_ratio: string | null;
  publish_at: string;
  status: "scheduled" | "publishing" | "published" | "failed" | "cancelled";
  post_urn: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(config.dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      visibility TEXT DEFAULT 'PUBLIC',
      media_ids TEXT,
      article_url TEXT,
      article_title TEXT,
      article_description TEXT,
      template_id TEXT,
      template_vars TEXT,
      gemini_prompt TEXT,
      gemini_aspect_ratio TEXT,
      publish_at TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      post_urn TEXT,
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_status_time
    ON scheduled_posts(status, publish_at)
  `);

  log("info", "Scheduler database initialized");
  return db;
}

export function createSchedule(data: {
  text: string;
  publish_at: string;
  visibility?: string;
  media_ids?: string[];
  article_url?: string;
  article_title?: string;
  article_description?: string;
  template_id?: string;
  template_vars?: Record<string, string>;
  gemini_prompt?: string;
  gemini_aspect_ratio?: string;
}): ScheduledPost {
  const db = getDb();
  const id = randomUUID();

  const stmt = db.prepare(`
    INSERT INTO scheduled_posts (id, text, visibility, media_ids, article_url, article_title,
      article_description, template_id, template_vars, gemini_prompt, gemini_aspect_ratio, publish_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.text,
    data.visibility || "PUBLIC",
    data.media_ids ? JSON.stringify(data.media_ids) : null,
    data.article_url || null,
    data.article_title || null,
    data.article_description || null,
    data.template_id || null,
    data.template_vars ? JSON.stringify(data.template_vars) : null,
    data.gemini_prompt || null,
    data.gemini_aspect_ratio || null,
    data.publish_at,
  );

  return getSchedule(id)!;
}

export function getSchedule(id: string): ScheduledPost | null {
  const db = getDb();
  return db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id) as ScheduledPost | null;
}

export function listSchedules(status?: string): ScheduledPost[] {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM scheduled_posts WHERE status = ? ORDER BY publish_at ASC")
      .all(status) as ScheduledPost[];
  }
  return db.prepare("SELECT * FROM scheduled_posts ORDER BY publish_at ASC")
    .all() as ScheduledPost[];
}

export function getDuePosts(): ScheduledPost[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(
    "SELECT * FROM scheduled_posts WHERE status = 'scheduled' AND publish_at <= ? ORDER BY publish_at ASC"
  ).all(now) as ScheduledPost[];
}

export function updateScheduleStatus(
  id: string,
  status: string,
  extra?: { post_urn?: string; error?: string; published_at?: string; retry_count?: number },
): void {
  const db = getDb();
  const sets = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (extra?.post_urn !== undefined) { sets.push("post_urn = ?"); params.push(extra.post_urn); }
  if (extra?.error !== undefined) { sets.push("error = ?"); params.push(extra.error); }
  if (extra?.published_at !== undefined) { sets.push("published_at = ?"); params.push(extra.published_at); }
  if (extra?.retry_count !== undefined) { sets.push("retry_count = ?"); params.push(extra.retry_count); }

  params.push(id);
  db.prepare(`UPDATE scheduled_posts SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function cancelSchedule(id: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE scheduled_posts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'"
  ).run(id);
  return result.changes > 0;
}

export function updateScheduleFields(
  id: string,
  fields: { text?: string; publish_at?: string; visibility?: string; media_ids?: string[] },
): boolean {
  const db = getDb();
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (fields.text !== undefined) { sets.push("text = ?"); params.push(fields.text); }
  if (fields.publish_at !== undefined) { sets.push("publish_at = ?"); params.push(fields.publish_at); }
  if (fields.visibility !== undefined) { sets.push("visibility = ?"); params.push(fields.visibility); }
  if (fields.media_ids !== undefined) { sets.push("media_ids = ?"); params.push(JSON.stringify(fields.media_ids)); }

  if (sets.length === 1) return false;

  params.push(id);
  const result = db.prepare(
    `UPDATE scheduled_posts SET ${sets.join(", ")} WHERE id = ? AND status = 'scheduled'`
  ).run(...params);
  return result.changes > 0;
}
