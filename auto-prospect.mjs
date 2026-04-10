#!/usr/bin/env node
/**
 * LinkedIn Auto-Prospect v2 — Direct Import Edition
 * Searches for potential clients 3x/day (triggered by launchd).
 * Saves new prospects to SQLite, sends macOS notification.
 *
 * v2: Direct imports from compiled dist/ — no subprocess spawning.
 *
 * Usage: node auto-prospect.mjs
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

// Direct imports — no subprocess spawning
import { searchPeople } from './dist/scraper/search.js';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'prospects.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const LOG_DIR = join(MCP_DIR, 'output', 'linkedin-mcp');
const LOG_FILE = join(LOG_DIR, 'prospect.log');

// Bootstrap auth env vars for API calls
try {
  const auth = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
  process.env.LINKEDIN_ACCESS_TOKEN = auth.access_token;
  process.env.LINKEDIN_PERSON_URN = auth.person_urn || 'urn:li:person:FihAwG4y_B';
} catch {}

// INBOUND: Buying signals — ludzie SZUKAJĄCY MVP/automatyzacji/aplikacji
// + Właściciele firm (nie-IT) z branż docelowych
const SEARCH_QUERIES = [
  { keywords: 'szukam kogoś kto zbuduje MVP' },
  { keywords: 'potrzebuję MVP aplikacji' },
  { keywords: 'szukam developera do projektu' },
  { keywords: 'potrzebuję automatyzacji procesów' },
  { keywords: 'szukam integracji API' },
  { keywords: 'kto zrobi mi SaaS' },
  { keywords: 'właściciel sklepu internetowego' },
  { keywords: 'właściciel hurtowni Polska' },
  { keywords: 'prezes firmy handlowej' },
  { keywords: 'CEO ecommerce Polska' },
  { keywords: 'wdrożenie AI w firmie' },
  { keywords: 'cyfryzacja małej firmy' },
];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function notify(title, body) {
  try {
    const safe = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}"'`);
  } catch {}
}

function getAuth() {
  if (!existsSync(AUTH_PATH)) return null;
  try { return JSON.parse(readFileSync(AUTH_PATH, 'utf-8')); } catch { return null; }
}

function ensureProspectsTable(db) {
  try { db.exec("ALTER TABLE prospects ADD COLUMN status TEXT DEFAULT 'new'"); } catch {}
  try { db.exec("ALTER TABLE prospects ADD COLUMN invited_at TEXT"); } catch {}
}

async function main() {
  const auth = getAuth();
  if (!auth || new Date(auth.expires_at) < new Date()) {
    log('No valid auth — skipping prospect search');
    notify('LinkedIn ⚠️ Prospect search', 'Brak autoryzacji — odśwież token LinkedIn');
    process.exit(0);
  }

  const db = new Database(DB_PATH);
  ensureProspectsTable(db);

  // Pick 3 queries to run this time (rotate by hour) + page 2 for first query
  const hour = new Date().getHours();
  const indices = [0, 1, 2].map(i => (hour + i) % SEARCH_QUERIES.length);
  const searches = [
    { ...SEARCH_QUERIES[indices[0]], start: 0 },
    { ...SEARCH_QUERIES[indices[0]], start: 10 }, // page 2 of first query
    { ...SEARCH_QUERIES[indices[1]], start: 0 },
    { ...SEARCH_QUERIES[indices[2]], start: 0 },
  ];

  let totalNew = 0;
  const newNames = [];

  for (const q of searches) {
    log(`Searching: ${q.keywords} (start=${q.start})`);
    try {
      const result = await searchPeople({ keywords: q.keywords, count: 20, start: q.start || 0 });
      const people = result.people || result.results || [];

      for (const person of people) {
        const publicId = person.public_id || person.id || '';
        if (!publicId) continue;
        const existing = db.prepare('SELECT id FROM prospects WHERE public_id = ?').get(publicId);
        if (existing) continue;

        const newId = `ap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        db.prepare(`
          INSERT OR IGNORE INTO prospects (id, name, headline, public_id, profile_url, company_name, category, tags, status)
          VALUES (?, ?, ?, ?, ?, ?, 'target_buyer', '[]', 'new')
        `).run(
          newId,
          person.name || '',
          person.headline || '',
          publicId,
          person.profile_url || `https://www.linkedin.com/in/${publicId}`,
          person.company || '',
        );
        totalNew++;
        if (newNames.length < 3) newNames.push(person.name || publicId);
      }
      log(`  Found ${people.length} people, ${totalNew} new total so far`);
    } catch (err) {
      log(`  Error searching "${q.keywords}": ${err.message}`);
    }

    // Delay between searches (respect rate limits)
    await new Promise(r => setTimeout(r, 5000));
  }

  db.close();

  if (totalNew > 0) {
    const preview = newNames.join(', ') + (totalNew > 3 ? ` +${totalNew - 3} więcej` : '');
    notify(`LinkedIn 👥 ${totalNew} nowych potencjalnych klientów`, preview);
    log(`Done — ${totalNew} new prospects saved`);
  } else {
    log('Done — no new prospects this run');
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  notify('LinkedIn Prospect search error', err.message.slice(0, 100));
  process.exit(1);
});
