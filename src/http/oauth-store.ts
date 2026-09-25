/**
 * SQLite-backed OAuth storage for clients, auth codes, and tokens.
 */

import Database from "better-sqlite3";
import { randomUUID, randomBytes } from "node:crypto";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

let db: Database.Database | null = null;

export function getOAuthDb(): Database.Database {
  if (db) return db;

  db = new Database(config.mcpOAuthDbFile);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_name TEXT DEFAULT '',
      redirect_uris TEXT DEFAULT '[]',
      grant_types TEXT DEFAULT '["authorization_code"]',
      response_types TEXT DEFAULT '["code"]',
      scope TEXT DEFAULT 'mcp:tools',
      token_endpoint_auth_method TEXT DEFAULT 'client_secret_post',
      client_id_issued_at INTEGER DEFAULT 0,
      client_secret_expires_at INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT DEFAULT '',
      resource TEXT DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scope TEXT DEFAULT '',
      resource TEXT DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      token TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scope TEXT DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  log("info", "OAuth database initialized");
  return db;
}

// ── Client Operations ─────────────────────────────────────────────────────────

export interface StoredClient {
  client_id: string;
  client_secret: string;
  client_name: string;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  scope: string;
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
  client_secret_expires_at: number;
}

export function getClient(clientId: string): StoredClient | null {
  const db = getOAuthDb();
  return db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?")
    .get(clientId) as StoredClient | null;
}

export function registerClient(data: {
  client_id?: string;
  client_secret?: string;
  client_name?: string;
  redirect_uris?: string[];
  client_secret_expires_at?: number;
}): StoredClient {
  const db = getOAuthDb();
  const clientId = data.client_id || randomUUID();
  const clientSecret = data.client_secret || randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO oauth_clients (client_id, client_secret, client_name, redirect_uris, client_id_issued_at, client_secret_expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    clientId,
    clientSecret,
    data.client_name || "Dynamic Client",
    JSON.stringify(data.redirect_uris || []),
    now,
    data.client_secret_expires_at || 0,
  );

  log("info", `Registered OAuth client: ${clientId} (${data.client_name})`);
  return getClient(clientId)!;
}

// ── Auth Code Operations ──────────────────────────────────────────────────────

export function createAuthCode(data: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scope?: string;
  resource?: string;
}): string {
  const db = getOAuthDb();
  const code = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 min

  db.prepare(`
    INSERT INTO oauth_auth_codes (code, client_id, code_challenge, redirect_uri, scope, resource, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, data.clientId, data.codeChallenge, data.redirectUri, data.scope || "", data.resource || "", expiresAt);

  return code;
}

export function getAuthCode(code: string): {
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  expires_at: number;
} | null {
  const db = getOAuthDb();
  return db.prepare("SELECT * FROM oauth_auth_codes WHERE code = ?").get(code) as ReturnType<typeof getAuthCode>;
}

export function deleteAuthCode(code: string): void {
  const db = getOAuthDb();
  db.prepare("DELETE FROM oauth_auth_codes WHERE code = ?").run(code);
}

// ── Token Operations ──────────────────────────────────────────────────────────

export function createTokens(clientId: string, scope: string, resource?: string): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} {
  const db = getOAuthDb();
  const accessToken = randomBytes(48).toString("hex");
  const refreshToken = randomBytes(48).toString("hex");
  const accessExpiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const refreshExpiresAt = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days

  db.prepare(`INSERT INTO oauth_access_tokens (token, client_id, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(accessToken, clientId, scope, resource || "", accessExpiresAt);
  db.prepare(`INSERT INTO oauth_refresh_tokens (token, access_token, client_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(refreshToken, accessToken, clientId, scope, refreshExpiresAt);

  return { accessToken, refreshToken, expiresIn: 3600 };
}

export function verifyToken(token: string): {
  client_id: string;
  scope: string;
  resource: string;
  expires_at: number;
} | null {
  const db = getOAuthDb();
  const row = db.prepare("SELECT * FROM oauth_access_tokens WHERE token = ?").get(token) as {
    client_id: string; scope: string; resource: string; expires_at: number;
  } | null;

  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare("DELETE FROM oauth_access_tokens WHERE token = ?").run(token);
    return null;
  }
  return row;
}

export function getRefreshToken(token: string): {
  access_token: string;
  client_id: string;
  scope: string;
  expires_at: number;
} | null {
  const db = getOAuthDb();
  const row = db.prepare("SELECT * FROM oauth_refresh_tokens WHERE token = ?").get(token) as ReturnType<typeof getRefreshToken>;
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare("DELETE FROM oauth_refresh_tokens WHERE token = ?").run(token);
    return null;
  }
  return row;
}

export function revokeToken(token: string): void {
  const db = getOAuthDb();
  db.prepare("DELETE FROM oauth_access_tokens WHERE token = ?").run(token);
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE token = ?").run(token);
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE access_token = ?").run(token);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export function cleanupExpired(): void {
  const db = getOAuthDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM oauth_auth_codes WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_access_tokens WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?").run(now);
}
