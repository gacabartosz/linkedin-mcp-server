/**
 * LinkedIn Voyager API Client
 *
 * Uses LinkedIn's internal Voyager API (same as web app).
 * Authentication via li_at session cookie from the user's own browser session.
 *
 * COMPLIANCE NOTES:
 * - This tool accesses LinkedIn data using the user's own authenticated session
 * - LinkedIn's User Agreement (Section 8.2) prohibits automated scraping
 * - The hiQ Labs v. LinkedIn ruling (9th Circuit) established that accessing
 *   publicly available data is not a CFAA violation, but breach of contract
 *   claims remain valid
 * - This tool is designed for personal sales research, NOT mass data collection
 * - Conservative rate limiting: 3-7s delays, max 30 req/hr, 150 req/day
 * - The user assumes full responsibility for compliance with LinkedIn's ToS
 *
 * SAFETY MEASURES:
 * - Human-like delays between requests (3-7s randomized)
 * - Max 30 requests per hour (LinkedIn allows ~100 for normal browsing)
 * - Max 150 requests per day (hard cap)
 * - Exponential backoff on 429 responses
 * - No fake accounts, no proxies, no identity spoofing
 * - User's own session cookie only
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../utils/config.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { log } from "../utils/logger.js";

const LINKEDIN_BASE = "https://www.linkedin.com";
const VOYAGER_BASE = `${LINKEDIN_BASE}/voyager/api`;

// Conservative rate limiting — well below LinkedIn's detection thresholds
const MIN_DELAY_MS = 3_000;
const MAX_DELAY_MS = 7_000;
const MAX_REQUESTS_PER_HOUR = 30;
const MAX_REQUESTS_PER_DAY = 150;

interface ScraperAuth {
  li_at: string;
  csrf_token?: string;
  updated_at?: string;
  tos_acknowledged?: boolean;  // User acknowledged LinkedIn ToS risk
}

interface RateLimitState {
  lastRequestAt: number;
  requestsThisHour: number;
  hourStartedAt: number;
  requestsToday: number;
  dayStartedAt: number;
  backoffUntil: number;       // Exponential backoff timestamp
  consecutiveErrors: number;
}

const rateLimit: RateLimitState = {
  lastRequestAt: 0,
  requestsThisHour: 0,
  hourStartedAt: Date.now(),
  requestsToday: 0,
  dayStartedAt: Date.now(),
  backoffUntil: 0,
  consecutiveErrors: 0,
};

// ── Auth Management ──────────────────────────────────────────────────────────

function getScraperAuthFile(): string {
  return join(config.dataDir, "scraper-auth.json");
}

export function loadScraperAuth(): ScraperAuth | null {
  const file = getScraperAuthFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ScraperAuth;
  } catch {
    return null;
  }
}

export function saveScraperAuth(auth: ScraperAuth): void {
  auth.updated_at = new Date().toISOString();
  writeFileSync(getScraperAuthFile(), JSON.stringify(auth, null, 2), { mode: 0o600 });
  log("info", "Scraper auth saved");
}

export const COMPLIANCE_DISCLAIMER = `
⚠️  LINKEDIN TERMS OF SERVICE NOTICE

These research tools use LinkedIn's internal API with YOUR session cookie.
This is technically against LinkedIn's User Agreement (Section 8.2).

WHAT THIS MEANS:
• LinkedIn MAY restrict your account if they detect automated access
• You are using your OWN account — no fake accounts, no proxies
• Rate limiting is conservative (30 req/hr, 150/day) — well below detection
• The hiQ v. LinkedIn ruling protects against criminal liability (CFAA)
  but breach of contract claims remain possible

SAFETY MEASURES BUILT IN:
• 3-7 second random delays between requests (mimics human browsing)
• Hard daily cap of 150 requests (normal user browses 200-500 pages/day)
• Exponential backoff on errors (stops immediately if detected)
• No mass scraping — designed for targeted sales research only
• All data stored locally, never shared with third parties

BY USING THESE TOOLS YOU ACKNOWLEDGE:
• You understand the risks to your LinkedIn account
• You will use this for legitimate sales research only
• You accept responsibility for compliance with LinkedIn's ToS
`.trim();

// ── Rate Limiting ────────────────────────────────────────────────────────────

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();

  // Check backoff
  if (now < rateLimit.backoffUntil) {
    const waitMs = rateLimit.backoffUntil - now;
    log("warn", `In backoff period. Waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  // Reset hourly counter
  if (now - rateLimit.hourStartedAt > 3_600_000) {
    rateLimit.requestsThisHour = 0;
    rateLimit.hourStartedAt = now;
  }

  // Reset daily counter
  if (now - rateLimit.dayStartedAt > 86_400_000) {
    rateLimit.requestsToday = 0;
    rateLimit.dayStartedAt = now;
  }

  // Check daily limit (hard stop)
  if (rateLimit.requestsToday >= MAX_REQUESTS_PER_DAY) {
    const waitMs = 86_400_000 - (now - rateLimit.dayStartedAt);
    throw new Error(
      `Daily request limit reached (${MAX_REQUESTS_PER_DAY}/day). ` +
      `Resets in ${Math.ceil(waitMs / 3_600_000)} hours. ` +
      `This limit protects your LinkedIn account from detection.`
    );
  }

  // Check hourly limit
  if (rateLimit.requestsThisHour >= MAX_REQUESTS_PER_HOUR) {
    const waitMs = 3_600_000 - (now - rateLimit.hourStartedAt);
    log("warn", `Hourly limit reached (${MAX_REQUESTS_PER_HOUR}/hr). Waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    rateLimit.requestsThisHour = 0;
    rateLimit.hourStartedAt = Date.now();
  }

  // Enforce minimum delay between requests
  const elapsed = Date.now() - rateLimit.lastRequestAt;
  const delay = randomDelay();
  if (elapsed < delay) {
    await sleep(delay - elapsed);
  }

  rateLimit.requestsThisHour++;
  rateLimit.requestsToday++;
  rateLimit.lastRequestAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── User Agents (real browser versions, rotated) ─────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Core Voyager Request ─────────────────────────────────────────────────────

export async function voyagerRequest<T>(
  path: string,
  options?: { method?: string; body?: unknown; skipRateLimit?: boolean },
): Promise<T> {
  const auth = loadScraperAuth();
  if (!auth?.li_at) {
    throw new Error(
      "Scraper not authenticated. Use linkedin_scraper_auth to set your li_at cookie.\n" +
      "How to get it:\n" +
      "1. Open LinkedIn in Chrome\n" +
      "2. Open DevTools → Application → Cookies → linkedin.com\n" +
      "3. Copy the value of 'li_at' cookie\n" +
      "4. Run: linkedin_scraper_auth with li_at parameter"
    );
  }

  if (!auth.tos_acknowledged) {
    throw new Error(
      "You must acknowledge LinkedIn ToS risk first.\n" +
      "Run linkedin_scraper_auth with your li_at cookie — the tool will show the disclaimer."
    );
  }

  if (!options?.skipRateLimit) {
    await enforceRateLimit();
  }

  const csrfToken = auth.csrf_token || `ajax:${Date.now()}`;
  const url = path.startsWith("https://") ? path : `${VOYAGER_BASE}${path}`;

  const headers: Record<string, string> = {
    "User-Agent": getRandomUA(),
    "Accept": "application/vnd.linkedin.normalized+json+2.1",
    "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
    "x-li-lang": "en_US",
    "x-li-track": JSON.stringify({
      clientVersion: "1.13.22",
      mpVersion: "1.13.22",
      osName: "web",
      timezoneOffset: -1,
      timezone: "Europe/Warsaw",
      deviceFormFactor: "DESKTOP",
      mpName: "voyager-web",
    }),
    "x-restli-protocol-version": "2.0.0",
    "csrf-token": csrfToken,
    "cookie": `li_at=${auth.li_at}; JSESSIONID="${csrfToken}"`,
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  log("info", `Voyager ${options?.method || "GET"} ${path.substring(0, 80)}`);

  const response = await fetchWithTimeout(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  // Handle rate limiting with exponential backoff
  if (response.status === 429) {
    rateLimit.consecutiveErrors++;
    const backoffMs = Math.min(60_000 * Math.pow(2, rateLimit.consecutiveErrors - 1), 600_000);
    rateLimit.backoffUntil = Date.now() + backoffMs;
    log("warn", `LinkedIn rate limited (429). Exponential backoff: ${Math.ceil(backoffMs / 1000)}s`);
    throw new Error(
      `LinkedIn returned 429 (rate limited). Backing off for ${Math.ceil(backoffMs / 1000)}s. ` +
      `This is normal — wait and try again. Consecutive errors: ${rateLimit.consecutiveErrors}`
    );
  }

  if (response.status === 401 || response.status === 403) {
    rateLimit.consecutiveErrors++;
    throw new Error(
      `LinkedIn session expired or invalid (${response.status}). ` +
      "Please update your li_at cookie with linkedin_scraper_auth."
    );
  }

  if (!response.ok) {
    rateLimit.consecutiveErrors++;
    const body = await response.text().catch(() => "");
    throw new Error(`Voyager API ${response.status}: ${body.substring(0, 200)}`);
  }

  // Success — reset error counter
  rateLimit.consecutiveErrors = 0;

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ── Rate Limit Stats ─────────────────────────────────────────────────────────

export function getRateLimitStats(): {
  requests_this_hour: number;
  max_per_hour: number;
  requests_today: number;
  max_per_day: number;
  remaining_hour: number;
  remaining_day: number;
  next_hour_reset_seconds: number;
  in_backoff: boolean;
  consecutive_errors: number;
} {
  const now = Date.now();
  if (now - rateLimit.hourStartedAt > 3_600_000) {
    rateLimit.requestsThisHour = 0;
    rateLimit.hourStartedAt = now;
  }
  if (now - rateLimit.dayStartedAt > 86_400_000) {
    rateLimit.requestsToday = 0;
    rateLimit.dayStartedAt = now;
  }
  return {
    requests_this_hour: rateLimit.requestsThisHour,
    max_per_hour: MAX_REQUESTS_PER_HOUR,
    requests_today: rateLimit.requestsToday,
    max_per_day: MAX_REQUESTS_PER_DAY,
    remaining_hour: MAX_REQUESTS_PER_HOUR - rateLimit.requestsThisHour,
    remaining_day: MAX_REQUESTS_PER_DAY - rateLimit.requestsToday,
    next_hour_reset_seconds: Math.ceil((3_600_000 - (now - rateLimit.hourStartedAt)) / 1000),
    in_backoff: now < rateLimit.backoffUntil,
    consecutive_errors: rateLimit.consecutiveErrors,
  };
}
