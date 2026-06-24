#!/usr/bin/env node
/**
 * LinkedIn Voyager Cookie Refresh
 *
 * Uses Playwright with persistent browser context to maintain
 * a real browser session. Extracts li_at + JSESSIONID cookies
 * and saves them to scraper-auth.json.
 *
 * HOW IT WORKS:
 * 1. Opens Chrome with a persistent profile (stays logged in)
 * 2. Navigates to linkedin.com/feed
 * 3. Extracts cookies (li_at, JSESSIONID, li_a)
 * 4. Saves to ~/.linkedin-mcp/scraper-auth.json
 * 5. Closes browser
 *
 * FIRST RUN: You'll need to log in manually once.
 *   node scripts/refresh-voyager-cookie.mjs --login
 *
 * SUBSEQUENT RUNS (auto/cron):
 *   node scripts/refresh-voyager-cookie.mjs
 *
 * KEEP-ALIVE (background, refreshes every 4h):
 *   node scripts/refresh-voyager-cookie.mjs --keep-alive
 */

import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const AUTH_DIR = join(homedir(), '.linkedin-mcp');
const AUTH_FILE = join(AUTH_DIR, 'scraper-auth.json');
const PROFILE_DIR = join(AUTH_DIR, 'browser-profile');
const KEEP_ALIVE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

const args = process.argv.slice(2);
const isLogin = args.includes('--login');
const isKeepAlive = args.includes('--keep-alive');
const isHeadless = false; // Always headful — LinkedIn blocks headless browsers

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Śledzimy aktywny kontekst, żeby zamknąć Chrome przy SIGTERM/SIGINT — inaczej osierocony Chrome
// trzyma SingletonLock profilu i blokuje scrape-analytics (współ-powód 75-dniowego zamrożenia wykresów).
let activeContext = null;
async function closeActive() {
  try { if (activeContext) await activeContext.close(); } catch {}
  activeContext = null;
}

async function refreshCookie() {
  log('Starting cookie refresh...');

  // Ensure profile directory exists
  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: isHeadless,
    channel: 'chrome', // Use system Chrome (more realistic)
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  });
  activeContext = context;

  try {
    const page = context.pages()[0] || await context.newPage();

    // Navigate to LinkedIn feed
    log('Navigating to linkedin.com/feed...');
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for page to load
    await page.waitForTimeout(3000);

    // Check if we need to log in
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/uas/login')) {
      if (isLogin) {
        log('LOGIN REQUIRED — Please log in manually in the browser window.');
        log('After logging in, the script will automatically extract cookies.');

        // Wait for user to log in (max 5 minutes)
        try {
          await page.waitForURL('**/feed/**', { timeout: 300000 });
          log('Login detected! Extracting cookies...');
          await page.waitForTimeout(3000);
        } catch {
          log('Login timeout (5 min). Please try again.');
          await context.close();
          process.exit(1);
        }
      } else {
        log('ERROR: Not logged in. Run with --login flag first:');
        log('  node scripts/refresh-voyager-cookie.mjs --login');
        await context.close();
        process.exit(1);
      }
    }

    // Extract cookies
    const cookies = await context.cookies('https://www.linkedin.com');

    const liAt = cookies.find(c => c.name === 'li_at');
    const jsessionid = cookies.find(c => c.name === 'JSESSIONID');
    const liA = cookies.find(c => c.name === 'li_a');

    if (!liAt) {
      log('ERROR: li_at cookie not found. Session may have expired.');
      await context.close();
      process.exit(1);
    }

    // Read existing auth and update
    let existing = {};
    try {
      existing = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
    } catch {}

    const newAuth = {
      ...existing,
      li_at: liAt.value,
      csrf_token: jsessionid ? jsessionid.value.replace(/"/g, '') : existing.csrf_token,
      li_a: liA ? liA.value : undefined,
      updated_at: new Date().toISOString(),
      expires_at: liAt.expires ? new Date(liAt.expires * 1000).toISOString() : undefined,
      source: 'playwright-auto-refresh',
    };

    writeFileSync(AUTH_FILE, JSON.stringify(newAuth, null, 2), { mode: 0o600 });

    log(`Cookie refreshed! li_at: ${liAt.value.slice(0, 20)}...`);
    log(`JSESSIONID: ${jsessionid ? 'YES' : 'NO'}`);
    log(`Expires: ${newAuth.expires_at || 'unknown'}`);

    await context.close();
    return true;
  } catch (err) {
    log(`ERROR: ${err.message}`);
    try { await context.close(); } catch {}
    return false;
  }
}

async function main() {
  // Zamknij Chrome przy stopie launchd (SIGTERM) lub Ctrl-C — bez tego zostaje osierocony Chrome z lockiem.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { log(`${sig} — zamykam przeglądarkę…`); await closeActive(); process.exit(0); });
  }

  if (isKeepAlive) {
    log('KEEP-ALIVE mode — refreshing every 4 hours');

    // First refresh
    await refreshCookie();

    // Then every 4 hours
    setInterval(async () => {
      log('--- Scheduled cookie refresh ---');
      await refreshCookie();
    }, KEEP_ALIVE_INTERVAL);
  } else {
    // Single refresh
    const ok = await refreshCookie();
    process.exit(ok ? 0 : 1);
  }
}

main();
