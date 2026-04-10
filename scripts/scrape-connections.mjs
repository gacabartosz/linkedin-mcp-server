#!/usr/bin/env node
/**
 * Scrape ALL LinkedIn connections via Voyager API.
 * Keeps browser OPEN for cookie refresh between chunks.
 * First run: --login to authenticate.
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const PROFILE_DIR = join(homedir(), '.linkedin-mcp', 'browser-profile');
const AUTH_FILE = join(homedir(), '.linkedin-mcp', 'scraper-auth.json');
const PROSPECTS_DB = join(homedir(), '.linkedin-mcp', 'prospects.db');

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function main() {
  // Load auth env
  try {
    const a = JSON.parse(readFileSync(join(homedir(), '.linkedin-mcp', 'auth.json'), 'utf-8'));
    process.env.LINKEDIN_ACCESS_TOKEN = a.access_token;
    process.env.LINKEDIN_PERSON_URN = a.person_urn;
  } catch {}

  // Open persistent browser — stays open for the entire scrape
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // Navigate to feed to establish session
  log('Opening LinkedIn...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  if (page.url().includes('/login') || page.url().includes('/checkpoint')) {
    log('LOGIN REQUIRED — log in manually in the Chrome window');
    await page.waitForURL('**/feed/**', { timeout: 300000 });
    log('Logged in!');
    await page.waitForTimeout(3000);
  }

  // Save initial cookies
  await saveCookies(ctx);

  // Setup DB
  const pdb = new Database(PROSPECTS_DB);
  pdb.pragma('journal_mode = WAL');
  pdb.exec(`CREATE TABLE IF NOT EXISTS connections (public_id TEXT PRIMARY KEY, name TEXT, headline TEXT, profile_url TEXT, connected_at TEXT, scraped_at TEXT DEFAULT (datetime('now')))`);
  const ins = pdb.prepare(`INSERT OR REPLACE INTO connections (public_id, name, headline, profile_url, connected_at, scraped_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`);

  const existing = pdb.prepare('SELECT COUNT(*) as c FROM connections').get()?.c || 0;
  log(`=== Starting: ${existing} connections in DB ===`);

  let total = 0;
  let start = 0;
  let consecutiveErrors = 0;

  for (let pg = 0; pg < 250; pg++) {
    try {
      const { voyagerRequest } = await import('../dist/scraper/voyager.js');

      const r = await voyagerRequest(
        `/relationships/dash/connections?q=search&count=40&sortType=RECENTLY_ADDED&start=${start}&decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionList-3`
      );

      const inc = r.included || [];
      const profiles = new Map();
      const dates = new Map();

      for (const item of inc) {
        const t = (item.$type || '').split('.').pop();
        if (t === 'Profile' && item.publicIdentifier) {
          profiles.set(item.entityUrn || '', {
            pid: item.publicIdentifier,
            name: `${item.firstName || ''} ${item.lastName || ''}`.trim(),
            headline: item.occupation || '',
          });
        }
        if (t === 'Connection' && item.connectedMember) {
          dates.set(item.connectedMember, item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : '');
        }
      }

      if (profiles.size === 0) {
        log(`Page ${pg}: empty — ALL DONE`);
        break;
      }

      const tx = pdb.transaction(() => {
        for (const [urn, p] of profiles) {
          ins.run(p.pid, p.name, p.headline, `https://www.linkedin.com/in/${p.pid}`, dates.get(urn) || '');
          total++;
        }
      });
      tx();
      consecutiveErrors = 0;

      if (pg % 5 === 0) log(`Page ${pg} (start=${start}): +${profiles.size}, total=${total}`);
      start += 40;
      await new Promise(r => setTimeout(r, 7000));

    } catch (e) {
      const msg = e.message || '';
      consecutiveErrors++;
      log(`Page ${pg} error (${consecutiveErrors}): ${msg.slice(0, 80)}`);

      if (msg.includes('302') || msg.includes('fetch failed')) {
        // Cookie expired — refresh by navigating in browser
        log('  Refreshing session via browser navigation...');
        try {
          await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          await saveCookies(ctx);
          log('  Session refreshed');
          consecutiveErrors = 0;
        } catch (navErr) {
          log(`  Navigation failed: ${navErr.message?.slice(0, 60)}`);
        }

        if (consecutiveErrors >= 3) {
          log('3 consecutive errors — stopping');
          break;
        }
        await new Promise(r => setTimeout(r, 15000));
        continue; // retry same page
      }

      if (msg.includes('429')) {
        log('  Rate limited — waiting 60s');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      // Other error — skip page
      start += 40;
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  pdb.close();
  await ctx.close();

  const finalDb = new Database(PROSPECTS_DB, { readonly: true });
  const finalCount = finalDb.prepare('SELECT COUNT(*) as c FROM connections').get()?.c || 0;
  finalDb.close();
  log(`=== DONE: ${finalCount} connections in DB (added ${total} this run) ===`);
}

async function saveCookies(ctx) {
  const cookies = await ctx.cookies('https://www.linkedin.com');
  const liAt = cookies.find(c => c.name === 'li_at');
  const jsessionid = cookies.find(c => c.name === 'JSESSIONID');
  if (!liAt) return;

  let existing = {};
  try { existing = JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch {}
  existing.li_at = liAt.value;
  existing.csrf_token = jsessionid ? jsessionid.value.replace(/"/g, '') : existing.csrf_token;
  existing.updated_at = new Date().toISOString();
  existing.source = 'connections-scraper';
  writeFileSync(AUTH_FILE, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });
