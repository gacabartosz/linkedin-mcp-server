import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

/**
 * Load the package-root .env so the MCP server sees the same credentials as
 * dashboard.mjs (which parses .env itself). Existing process.env always wins,
 * so values injected by the MCP client config are never overwritten.
 *
 * Why this exists: credentials used to live in BOTH .env and .mcp.json, and
 * they had drifted to two different LinkedIn apps — the app in .mcp.json did
 * not own the token in auth.json (verified via introspectToken 2026-07-26),
 * so any re-auth through MCP would have written a token from the wrong app.
 * .env is now the single source of truth.
 */
function loadDotEnv(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");
  if (!existsSync(envPath)) return;

  try {
    for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq < 1) continue;

      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue; // never override

      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (err) {
    log("warn", `Failed to read .env at ${envPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

loadDotEnv();

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), ".linkedin-mcp");

/** All 12 scopes granted to the Community Management API app. */
export const ORG_SCOPES_DEFAULT = [
  "r_basicprofile",
  "w_member_social",
  "w_member_social_feed",
  "r_member_postAnalytics",
  "r_member_profileAnalytics",
  "r_1st_connections_size",
  "rw_organization_admin",
  "r_organization_social",
  "w_organization_social",
  "r_organization_social_feed",
  "w_organization_social_feed",
  "r_organization_followers",
];

function flag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const config = {
  dataDir: DATA_DIR,
  authFile: join(DATA_DIR, "auth.json"),
  orgAuthFile: join(DATA_DIR, "org-auth.json"),
  dbFile: join(DATA_DIR, "scheduler.db"),
  brandVoiceFile: join(DATA_DIR, "brand-voice.json"),
  userTemplatesDir: join(DATA_DIR, "templates"),
  imagesDir: join(DATA_DIR, "images"),
  guidelinesDir: "", // set dynamically — package root

  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || "",
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
  linkedinAccessToken: process.env.LINKEDIN_ACCESS_TOKEN || "",
  linkedinPersonUrn: process.env.LINKEDIN_PERSON_URN || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  callbackPort: parseInt(process.env.LINKEDIN_CALLBACK_PORT || "8585", 10),
  // How long the OAuth callback server waits for the consent click. Five
  // minutes is too short when a human has to open a portal tab first, so this
  // is configurable; the default keeps the previous behaviour.
  oauthTimeoutMs: Math.min(60, Math.max(1, parseInt(process.env.LINKEDIN_OAUTH_TIMEOUT_MIN || "5", 10) || 5)) * 60_000,
  apiVersion: process.env.LINKEDIN_API_VERSION || "202503",

  // Community Management API app, scoped to the bartoszgaca.pl Company Page
  linkedinOrgClientId: process.env.LINKEDIN_ORG_CLIENT_ID || "",
  linkedinOrgClientSecret: process.env.LINKEDIN_ORG_CLIENT_SECRET || "",
  linkedinOrgUrn: process.env.LINKEDIN_ORG_URN || "",
  orgCallbackPort: parseInt(process.env.LINKEDIN_ORG_CALLBACK_PORT || "8586", 10),
  orgScopes: (process.env.LINKEDIN_ORG_SCOPES || "").trim()
    ? (process.env.LINKEDIN_ORG_SCOPES as string).trim().split(/\s+/)
    : ORG_SCOPES_DEFAULT,

  // Feature flags — all default OFF, so runtime behaviour is unchanged until
  // a phase is explicitly switched on. Turning a flag off is the rollback.
  useApiAnalytics: flag("USE_API_ANALYTICS"),
  useApiSocialFeed: flag("USE_API_SOCIAL_FEED"),
  enableOrgFeatures: flag("ENABLE_ORG_FEATURES"),
  enableMarketIntel: flag("ENABLE_MARKET_INTEL"),

  // Deliberately low until the real Development Tier limit is established from
  // the developer portal + observed response headers. Not a guess at LinkedIn's
  // actual quota — a self-imposed ceiling.
  apiDailyBudget: parseInt(process.env.API_DAILY_BUDGET || "500", 10),
};

/** Extra databases the dashboard and daemons use, exposed for new API modules. */
export const dbPaths = {
  scheduler: config.dbFile,
  analytics: join(DATA_DIR, "analytics.db"),
  prospects: join(DATA_DIR, "prospects.db"),
  engage: join(DATA_DIR, "engage.db"),
  content: join(DATA_DIR, "content.db"),
};

export function ensureDataDirs(): void {
  for (const dir of [config.dataDir, config.userTemplatesDir, config.imagesDir]) {
    mkdirSync(dir, { recursive: true });
  }
}

export interface ConfigProblem {
  level: "warn" | "error";
  message: string;
}

/**
 * Report configuration problems as data instead of throwing, so a missing
 * optional credential degrades one feature instead of killing the server.
 * Callers log these; nothing here writes to stdout (reserved for MCP stdio).
 */
export function validateConfig(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  const hasMemberOAuth = Boolean(config.linkedinClientId && config.linkedinClientSecret);
  if (!hasMemberOAuth && !config.linkedinAccessToken) {
    problems.push({
      level: "error",
      message:
        "No member credentials: set LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET (OAuth) " +
        "or LINKEDIN_ACCESS_TOKEN + LINKEDIN_PERSON_URN (manual token) in .env.",
    });
  }

  if (config.linkedinAccessToken && !config.linkedinPersonUrn) {
    problems.push({
      level: "error",
      message: "LINKEDIN_ACCESS_TOKEN is set but LINKEDIN_PERSON_URN is missing — posting will fail.",
    });
  }

  const orgId = Boolean(config.linkedinOrgClientId);
  const orgSecret = Boolean(config.linkedinOrgClientSecret);
  if (orgId !== orgSecret) {
    problems.push({
      level: "error",
      message: "LINKEDIN_ORG_CLIENT_ID and LINKEDIN_ORG_CLIENT_SECRET must be set together.",
    });
  }

  if (config.enableOrgFeatures && !config.linkedinOrgUrn) {
    problems.push({
      level: "error",
      message: "ENABLE_ORG_FEATURES is on but LINKEDIN_ORG_URN is empty — org calls have no target.",
    });
  }

  if ((config.useApiAnalytics || config.useApiSocialFeed || config.enableOrgFeatures) && !orgId) {
    problems.push({
      level: "error",
      message: "API feature flags are on but the org app is not configured (LINKEDIN_ORG_CLIENT_ID missing).",
    });
  }

  if (config.callbackPort === config.orgCallbackPort) {
    problems.push({
      level: "error",
      message: `Member and org OAuth callback ports collide (${config.callbackPort}) — they must differ.`,
    });
  }

  if (!config.geminiApiKey) {
    problems.push({ level: "warn", message: "GEMINI_API_KEY missing — image generation is unavailable." });
  }

  if (!Number.isFinite(config.apiDailyBudget) || config.apiDailyBudget <= 0) {
    problems.push({ level: "warn", message: "API_DAILY_BUDGET is not a positive number — throttling disabled." });
  }

  return problems;
}

/** Log configuration problems to stderr. Never throws, never touches stdout. */
export function logConfigProblems(): ConfigProblem[] {
  const problems = validateConfig();
  for (const p of problems) log(p.level, `config: ${p.message}`);
  return problems;
}
