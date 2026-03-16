/**
 * Prospect & Company Monitoring Database (SQLite)
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

let db: Database.Database | null = null;

// ── Types ────────────────────────────────────────────────────────────────────

export interface Prospect {
  id: string;
  name: string;
  headline: string;
  public_id: string;
  profile_url: string;
  profile_urn: string;
  company_name: string;
  category: "competitor_sales" | "target_buyer" | "influencer" | "other";
  tags: string;        // JSON array
  notes: string;
  source_company_id: string; // Which monitored company they came from
  last_scanned_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoredCompany {
  id: string;
  name: string;
  company_id: string;  // LinkedIn company universal name or ID
  company_url: string;
  type: "direct_competitor" | "indirect_competitor" | "target_segment" | "other";
  notes: string;
  created_at: string;
}

export interface ActivityRecord {
  id: string;
  prospect_id: string;
  type: "post" | "comment" | "reaction" | "share";
  text: string;
  post_url: string;
  post_urn: string;
  date: string;
  classification: string; // sales_pitch, buying_signal, job_posting, networking, irrelevant
  confidence: number;
  reasoning: string;
  is_new: number;        // 1 = not yet reviewed, 0 = reviewed
  created_at: string;
}

// ── Database Init ────────────────────────────────────────────────────────────

export function getProspectDb(): Database.Database {
  if (db) return db;

  const dbFile = config.dbFile.replace("scheduler.db", "prospects.db");
  db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS monitored_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company_id TEXT NOT NULL UNIQUE,
      company_url TEXT,
      type TEXT DEFAULT 'direct_competitor',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      headline TEXT DEFAULT '',
      public_id TEXT NOT NULL UNIQUE,
      profile_url TEXT DEFAULT '',
      profile_urn TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      category TEXT DEFAULT 'other',
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      source_company_id TEXT DEFAULT '',
      last_scanned_at TEXT,
      last_activity_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL,
      type TEXT DEFAULT 'post',
      text TEXT DEFAULT '',
      post_url TEXT DEFAULT '',
      post_urn TEXT DEFAULT '',
      date TEXT DEFAULT '',
      classification TEXT DEFAULT 'irrelevant',
      confidence REAL DEFAULT 0,
      reasoning TEXT DEFAULT '',
      is_new INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_prospect ON activities(prospect_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_classification ON activities(classification, is_new);
    CREATE INDEX IF NOT EXISTS idx_prospects_category ON prospects(category);
  `);

  log("info", "Prospect database initialized");
  return db;
}

// ── Company CRUD ─────────────────────────────────────────────────────────────

export function addCompany(data: {
  name: string;
  company_id: string;
  company_url?: string;
  type?: MonitoredCompany["type"];
  notes?: string;
}): MonitoredCompany {
  const db = getProspectDb();
  const id = randomUUID();

  db.prepare(`
    INSERT OR REPLACE INTO monitored_companies (id, name, company_id, company_url, type, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.company_id, data.company_url || "", data.type || "direct_competitor", data.notes || "");

  return db.prepare("SELECT * FROM monitored_companies WHERE id = ?").get(id) as MonitoredCompany;
}

export function listCompanies(type?: string): MonitoredCompany[] {
  const db = getProspectDb();
  if (type) {
    return db.prepare("SELECT * FROM monitored_companies WHERE type = ? ORDER BY name")
      .all(type) as MonitoredCompany[];
  }
  return db.prepare("SELECT * FROM monitored_companies ORDER BY name").all() as MonitoredCompany[];
}

export function removeCompany(companyId: string): boolean {
  const db = getProspectDb();
  const result = db.prepare("DELETE FROM monitored_companies WHERE company_id = ? OR id = ?")
    .run(companyId, companyId);
  return result.changes > 0;
}

// ── Prospect CRUD ────────────────────────────────────────────────────────────

export function addProspect(data: {
  name: string;
  headline?: string;
  public_id: string;
  profile_url?: string;
  profile_urn?: string;
  company_name?: string;
  category?: Prospect["category"];
  tags?: string[];
  notes?: string;
  source_company_id?: string;
}): Prospect {
  const db = getProspectDb();
  const id = randomUUID();

  db.prepare(`
    INSERT OR REPLACE INTO prospects (id, name, headline, public_id, profile_url, profile_urn,
      company_name, category, tags, notes, source_company_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.headline || "",
    data.public_id,
    data.profile_url || `https://www.linkedin.com/in/${data.public_id}`,
    data.profile_urn || "",
    data.company_name || "",
    data.category || "other",
    JSON.stringify(data.tags || []),
    data.notes || "",
    data.source_company_id || "",
  );

  return db.prepare("SELECT * FROM prospects WHERE public_id = ?").get(data.public_id) as Prospect;
}

export function listProspects(filters?: {
  category?: string;
  source_company_id?: string;
  has_new_activity?: boolean;
}): Prospect[] {
  const db = getProspectDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters?.category) {
    where.push("p.category = ?");
    params.push(filters.category);
  }
  if (filters?.source_company_id) {
    where.push("p.source_company_id = ?");
    params.push(filters.source_company_id);
  }
  if (filters?.has_new_activity) {
    where.push("EXISTS (SELECT 1 FROM activities a WHERE a.prospect_id = p.id AND a.is_new = 1)");
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM prospects p ${whereClause} ORDER BY p.updated_at DESC`)
    .all(...params) as Prospect[];
}

export function getProspect(publicIdOrId: string): Prospect | null {
  const db = getProspectDb();
  return (
    db.prepare("SELECT * FROM prospects WHERE public_id = ? OR id = ?").get(publicIdOrId, publicIdOrId) as Prospect | null
  );
}

export function removeProspect(publicId: string): boolean {
  const db = getProspectDb();
  const result = db.prepare("DELETE FROM prospects WHERE public_id = ? OR id = ?")
    .run(publicId, publicId);
  return result.changes > 0;
}

export function updateProspectScanTime(publicId: string): void {
  const db = getProspectDb();
  db.prepare("UPDATE prospects SET last_scanned_at = datetime('now'), updated_at = datetime('now') WHERE public_id = ?")
    .run(publicId);
}

// ── Activity CRUD ────────────────────────────────────────────────────────────

export function addActivity(data: {
  prospect_id: string;
  type: ActivityRecord["type"];
  text: string;
  post_url?: string;
  post_urn?: string;
  date?: string;
  classification?: string;
  confidence?: number;
  reasoning?: string;
}): ActivityRecord {
  const db = getProspectDb();
  const id = randomUUID();

  // Check for duplicate (same prospect + same post_urn)
  if (data.post_urn) {
    const existing = db.prepare(
      "SELECT id FROM activities WHERE prospect_id = ? AND post_urn = ?"
    ).get(data.prospect_id, data.post_urn);
    if (existing) {
      return db.prepare("SELECT * FROM activities WHERE prospect_id = ? AND post_urn = ?")
        .get(data.prospect_id, data.post_urn) as ActivityRecord;
    }
  }

  db.prepare(`
    INSERT INTO activities (id, prospect_id, type, text, post_url, post_urn, date,
      classification, confidence, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.prospect_id,
    data.type,
    data.text,
    data.post_url || "",
    data.post_urn || "",
    data.date || new Date().toISOString(),
    data.classification || "irrelevant",
    data.confidence || 0,
    data.reasoning || "",
  );

  // Update prospect last_activity_at
  db.prepare("UPDATE prospects SET last_activity_at = ?, updated_at = datetime('now') WHERE id = ?")
    .run(data.date || new Date().toISOString(), data.prospect_id);

  return db.prepare("SELECT * FROM activities WHERE id = ?").get(id) as ActivityRecord;
}

export function getNewActivities(filters?: {
  classification?: string;
  prospect_id?: string;
  limit?: number;
}): ActivityRecord[] {
  const db = getProspectDb();
  const where: string[] = ["is_new = 1"];
  const params: unknown[] = [];

  if (filters?.classification) {
    where.push("classification = ?");
    params.push(filters.classification);
  }
  if (filters?.prospect_id) {
    where.push("prospect_id = ?");
    params.push(filters.prospect_id);
  }

  const limit = filters?.limit || 50;
  return db.prepare(
    `SELECT * FROM activities WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT ?`
  ).all(...params, limit) as ActivityRecord[];
}

export function markActivitiesReviewed(ids?: string[]): number {
  const db = getProspectDb();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const result = db.prepare(`UPDATE activities SET is_new = 0 WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  }
  const result = db.prepare("UPDATE activities SET is_new = 0 WHERE is_new = 1").run();
  return result.changes;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getStats(): {
  total_prospects: number;
  total_companies: number;
  total_activities: number;
  new_activities: number;
  by_classification: Record<string, number>;
  by_category: Record<string, number>;
} {
  const db = getProspectDb();

  const totalProspects = (db.prepare("SELECT COUNT(*) as c FROM prospects").get() as { c: number }).c;
  const totalCompanies = (db.prepare("SELECT COUNT(*) as c FROM monitored_companies").get() as { c: number }).c;
  const totalActivities = (db.prepare("SELECT COUNT(*) as c FROM activities").get() as { c: number }).c;
  const newActivities = (db.prepare("SELECT COUNT(*) as c FROM activities WHERE is_new = 1").get() as { c: number }).c;

  const classRows = db.prepare(
    "SELECT classification, COUNT(*) as c FROM activities GROUP BY classification"
  ).all() as { classification: string; c: number }[];
  const byClassification: Record<string, number> = {};
  for (const r of classRows) byClassification[r.classification] = r.c;

  const catRows = db.prepare(
    "SELECT category, COUNT(*) as c FROM prospects GROUP BY category"
  ).all() as { category: string; c: number }[];
  const byCategory: Record<string, number> = {};
  for (const r of catRows) byCategory[r.category] = r.c;

  return {
    total_prospects: totalProspects,
    total_companies: totalCompanies,
    total_activities: totalActivities,
    new_activities: newActivities,
    by_classification: byClassification,
    by_category: byCategory,
  };
}
