#!/usr/bin/env node
/**
 * LinkedIn Analytics Scraper
 *
 * Uses Playwright persistent context to visit LinkedIn Analytics pages
 * and intercept the API responses that contain chart data.
 * Saves to analytics.db → creator_analytics table.
 *
 * Usage:
 *   node scripts/scrape-analytics.mjs          # scrape all 5 pages
 *   node scripts/scrape-analytics.mjs --dry-run # show what would be scraped
 */

import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, appendFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const PROFILE_DIR = join(homedir(), '.linkedin-mcp', 'browser-profile');
const DB_PATH = join(homedir(), '.linkedin-mcp', 'analytics.db');
const LOG_DIR = join('/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp');
const LOG_FILE = join(LOG_DIR, 'analytics-scrape.log');

const dryRun = process.argv.includes('--dry-run');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// Pages to scrape
const PAGES = [
  {
    url: 'https://www.linkedin.com/analytics/creator/audience/?lineChartType=cumulative&timeRange=past_365_days',
    metric: 'followers',
    chartType: 'cumulative',
  },
  {
    url: 'https://www.linkedin.com/analytics/creator/audience/?lineChartType=daily&timeRange=past_365_days',
    metric: 'followers',
    chartType: 'daily',
  },
  {
    url: 'https://www.linkedin.com/analytics/creator/content/?lineChartType=cumulative&metricType=IMPRESSIONS&timeRange=past_365_days',
    metric: 'impressions',
    chartType: 'cumulative',
  },
  {
    url: 'https://www.linkedin.com/analytics/creator/content/?lineChartType=daily&metricType=IMPRESSIONS&timeRange=past_365_days',
    metric: 'impressions',
    chartType: 'daily',
  },
  {
    url: 'https://www.linkedin.com/analytics/creator/content/?lineChartType=daily&metricType=ENGAGEMENTS&timeRange=past_365_days',
    metric: 'engagements',
    chartType: 'daily',
  },
];

function ensureDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_analytics (
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      scraped_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (date, metric, chart_type)
    );
  `);
  return db;
}

/**
 * Extract chart data from LinkedIn analytics page via Highcharts JS object.
 * LinkedIn uses Highcharts — data is in window.Highcharts.charts[0].series[0].data
 */
async function scrapeChartData(page, pageConfig) {
  const { url, metric, chartType } = pageConfig;
  log(`Scraping: ${metric} (${chartType}) ...`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000); // Wait for Highcharts to render

  // Extract all data from Highcharts
  const rawPoints = await page.evaluate(() => {
    if (typeof Highcharts === 'undefined' || !Highcharts.charts) return [];
    const chart = Highcharts.charts.find(Boolean);
    if (!chart || !chart.series || !chart.series[0]) return [];
    return chart.series[0].data.map(p => ({
      x: p.x,
      y: p.y,
      category: p.category || '',
    }));
  });

  if (rawPoints.length === 0) {
    log(`  WARNING: Highcharts data empty for ${metric} (${chartType})`);
    return [];
  }

  // Convert category labels ("10 kwi", "5 lut") to ISO dates
  // We know the chart covers 365 days ending today
  const today = new Date();
  const dataPoints = rawPoints.map((p, i) => {
    const daysAgo = rawPoints.length - 1 - i;
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    return {
      date: date.toISOString().slice(0, 10),
      value: Math.round(p.y || 0),
    };
  });

  log(`  Extracted ${dataPoints.length} data points for ${metric} (${chartType})`);
  return dataPoints;
}

/**
 * Scrape Top Posts from LinkedIn Analytics — HTML table/list extraction.
 */
async function scrapeTopPosts(page, db) {
  log('Scraping: Top Posts (impressions, 365d) ...');
  await page.goto('https://www.linkedin.com/analytics/creator/top-posts/?metricType=IMPRESSIONS&timeRange=past_365_days', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(8000);

  const posts = await page.evaluate(() => {
    const results = [];
    // LinkedIn analytics top posts use this class
    const cards = document.querySelectorAll('.ember-view.member-analytics-addon__mini-update-item');

    for (const card of cards) {
      const fullText = card.innerText || '';
      if (fullText.length < 50) continue;

      // Get link to post (contains URN)
      const linkEl = card.querySelector('a[href*="feed/update"]');
      const postUrl = linkEl?.href || '';
      const urnMatch = postUrl.match(/urn:li:activity:(\d+)/);
      const postUrn = urnMatch ? `urn:li:activity:${urnMatch[1]}` : '';

      // Get the actual post text (from the commentary span, skip author line)
      const textEl = card.querySelector('.break-words, [class*="update-text"], [class*="commentary"]');
      const postText = textEl?.innerText?.trim()?.slice(0, 200) || '';

      // Metrics are at the end of the fullText: "239\n128 komentarzy\n41 001"
      // Pattern: last 3 numbers = reactions, comments, impressions
      const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
      const metricLines = lines.slice(-5); // last 5 lines contain metrics

      let impressions = 0, reactions = 0, comments = 0;
      for (const line of metricLines) {
        const numMatch = line.replace(/\s/g, '').match(/^([\d,.]+)$/);
        const comMatch = line.match(/^(\d[\d\s,.]*)\s*komentarz/i);
        if (comMatch) {
          comments = parseInt(comMatch[1].replace(/[\s,.]/g, ''));
        } else if (numMatch) {
          const val = parseInt(numMatch[1].replace(/[,.]/g, ''));
          if (val > 1000) impressions = val; // big number = impressions
          else if (reactions === 0) reactions = val; // first small number = reactions
        }
      }
      // If no big number found, last number is impressions
      if (impressions === 0) {
        const allNums = fullText.match(/[\d\s]+/g)?.map(n => parseInt(n.replace(/\s/g, ''))).filter(n => !isNaN(n) && n > 0) || [];
        if (allNums.length > 0) impressions = allNums[allNums.length - 1];
      }

      if (postText.length > 10 || postUrn) {
        results.push({
          text_preview: postText || fullText.slice(0, 200),
          post_url: postUrl,
          post_urn: postUrn,
          impressions,
          reactions,
          comments,
          raw_text: fullText.slice(0, 500),
        });
      }
    }

    return results;
  });

  if (posts.length > 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creator_top_posts (
        post_urn TEXT,
        text_preview TEXT,
        impressions INTEGER DEFAULT 0,
        reactions INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        post_url TEXT,
        raw_text TEXT,
        scraped_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (text_preview)
      );
    `);
    const ins = db.prepare(`INSERT OR REPLACE INTO creator_top_posts (post_urn, text_preview, impressions, reactions, comments, post_url, raw_text, engagement_rate, scraped_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`);
    for (const p of posts) {
      const eng = p.impressions > 0 ? Math.round((p.reactions + p.comments) / p.impressions * 10000) / 100 : 0;
      ins.run(p.post_urn, p.text_preview, p.impressions, p.reactions, p.comments, p.post_url, p.raw_text, eng);
    }
    log(`  Saved ${posts.length} top posts`);
  } else {
    log('  WARNING: No top posts found — trying raw body text extraction');
    // Log page body for debugging
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 1000));
    log('  Page body: ' + (bodySnippet || '').slice(0, 300));
  }
  return posts.length;
}

/**
 * Scrape Connections via Voyager API (fast, paginated, no scroll needed).
 * Uses /relationships/dash/connections with decoration for profile data.
 */
async function scrapeConnections(page, db) {
  log('Scraping: Connections via Voyager API ...');

  // Import voyagerRequest dynamically
  const { voyagerRequest } = await import('./dist/scraper/voyager.js');

  const PROSPECTS_DB = join(homedir(), '.linkedin-mcp', 'prospects.db');
  const pdb = new Database(PROSPECTS_DB);
  pdb.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      public_id TEXT PRIMARY KEY,
      name TEXT,
      headline TEXT,
      profile_url TEXT,
      connected_at TEXT,
      scraped_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const ins = pdb.prepare(`INSERT OR REPLACE INTO connections (public_id, name, headline, profile_url, connected_at, scraped_at) VALUES (?,?,?,?,?,datetime('now'))`);
  let totalConnections = 0;
  let start = 0;
  const batchSize = 40;
  const maxPages = 200; // 40 * 200 = 8000 max

  for (let page = 0; page < maxPages; page++) {
    try {
      const r = await voyagerRequest(
        `/relationships/dash/connections?q=search&count=${batchSize}&sortType=RECENTLY_ADDED&start=${start}&decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionList-3`
      );
      const included = r.included || [];

      // Separate Connection entities (with createdAt) and Profile entities (with name)
      const profiles = new Map();
      const connectionDates = new Map();

      for (const item of included) {
        const type = (item.$type || '').split('.').pop();
        if (type === 'Profile' && item.publicIdentifier) {
          profiles.set(item.entityUrn || '', {
            public_id: item.publicIdentifier,
            name: `${item.firstName || ''} ${item.lastName || ''}`.trim(),
            headline: item.occupation || item.headline || '',
          });
        }
        if (type === 'Connection' && item.connectedMember) {
          connectionDates.set(item.connectedMember, item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : '');
        }
      }

      if (profiles.size === 0) {
        log(`    Page ${page} (start=${start}): no more profiles — done`);
        break;
      }

      // Insert batch
      const insertBatch = pdb.transaction(() => {
        for (const [urn, p] of profiles) {
          const connDate = connectionDates.get(urn) || '';
          ins.run(p.public_id, p.name, p.headline, `https://www.linkedin.com/in/${p.public_id}`, connDate);
          totalConnections++;
        }
      });
      insertBatch();

      if (page % 10 === 0) {
        log(`    Page ${page} (start=${start}): +${profiles.size} profiles, total=${totalConnections}`);
      }

      start += batchSize;

      // Rate limit: 5s delay between batches
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      log(`    Page ${page} error: ${err.message?.slice(0, 80)}`);
      if (err.message?.includes('302') || err.message?.includes('429') || err.message?.includes('fetch failed')) {
        log('    Rate limited or session expired — stopping');
        break;
      }
      // Small errors: continue
      start += batchSize;
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  pdb.close();
  log(`  Saved ${totalConnections} connections (${scrollAttempts} scrolls)`);
  return totalConnections;
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  log('=== LinkedIn Analytics Scraper starting ===');
  log(`Pages to scrape: ${PAGES.length}`);

  if (dryRun) {
    PAGES.forEach(p => log(`  ${p.metric} (${p.chartType}): ${p.url}`));
    log('DRY RUN — no browser launched');
    return;
  }

  const db = ensureDb();

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO creator_analytics (date, metric, chart_type, value, scraped_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  let totalPoints = 0;

  for (const pageConfig of PAGES) {
    try {
      const dataPoints = await scrapeChartData(page, pageConfig);

      if (dataPoints.length > 0) {
        const insert = db.transaction((points) => {
          for (const p of points) {
            upsert.run(p.date, pageConfig.metric, pageConfig.chartType, p.value);
          }
        });
        insert(dataPoints);
        totalPoints += dataPoints.length;
        log(`  Saved ${dataPoints.length} points to DB`);
      } else {
        log(`  WARNING: No data extracted for ${pageConfig.metric} (${pageConfig.chartType})`);
      }
    } catch (err) {
      log(`  ERROR scraping ${pageConfig.metric}: ${err.message}`);
    }

    // Delay between pages
    await page.waitForTimeout(3000);
  }

  // ── Top Posts ──
  try {
    const topPostCount = await scrapeTopPosts(page, db);
    totalPoints += topPostCount;
  } catch (err) {
    log(`  ERROR scraping top posts: ${err.message}`);
  }
  await page.waitForTimeout(3000);

  // ── Connections ──
  try {
    const connCount = await scrapeConnections(page, db);
    totalPoints += connCount;
  } catch (err) {
    log(`  ERROR scraping connections: ${err.message}`);
  }

  await ctx.close();
  db.close();

  log(`=== Done: ${totalPoints} total data points saved ===`);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
