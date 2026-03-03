/**
 * LinkedIn Banner Generator — MCP-integrated module.
 * Generates professional, scroll-stopping 1200×627 banners with CTA and branding.
 * Uses Puppeteer for HTML→PNG rendering (dynamic import).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const W = 1200;
const H = 627;
const BRAND = "Bartosz Gaca";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Design System ─────────────────────────────────────────────────────────────

export const GRADIENTS: Record<string, string> = {
  ocean:    "linear-gradient(135deg, #0077B5 0%, #00A0DC 50%, #0E76A8 100%)",
  sunset:   "linear-gradient(135deg, #FF6B35 0%, #F7C948 100%)",
  purple:   "linear-gradient(135deg, #5B21B6 0%, #7C3AED 40%, #A78BFA 100%)",
  emerald:  "linear-gradient(135deg, #059669 0%, #10B981 50%, #34D399 100%)",
  fire:     "linear-gradient(135deg, #DC2626 0%, #F97316 100%)",
  midnight: "linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)",
  teal:     "linear-gradient(135deg, #0D9488 0%, #14B8A6 100%)",
  rose:     "linear-gradient(135deg, #BE185D 0%, #EC4899 100%)",
};

function baseStyle(gradient: string): string {
  return `margin:0;padding:0;width:${W}px;height:${H}px;background:${gradient};display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;position:relative;overflow:hidden`;
}

function ctaBar(text = "Link in comments"): string {
  return `<div style="position:absolute;bottom:0;left:0;right:0;padding:14px 40px;background:rgba(0,0,0,0.35);display:flex;justify-content:space-between;align-items:center">
    <span style="color:rgba(255,255,255,0.9);font-size:15px;font-weight:600">${esc(BRAND)}</span>
    <span style="color:#fff;font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${esc(text)} <span style="font-size:20px">↓</span></span>
  </div>`;
}

function decorCircles(): string {
  return `<div style="position:absolute;top:-80px;right:-80px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>
  <div style="position:absolute;bottom:-120px;left:-60px;width:350px;height:350px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface HeroConfig {
  gradient: string;
  headline: string;
  subline?: string;
  stat?: string;
  stat_label?: string;
  cta?: string;
}

function heroHTML(cfg: HeroConfig): string {
  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)}">
    ${decorCircles()}
    ${cfg.stat ? `<div style="font-size:80px;font-weight:900;color:#fff;letter-spacing:-2px;margin-bottom:4px;text-shadow:0 4px 20px rgba(0,0,0,0.3)">${esc(cfg.stat)}</div>` : ""}
    ${cfg.stat_label ? `<div style="font-size:18px;color:rgba(255,255,255,0.8);font-weight:500;margin-bottom:20px;text-transform:uppercase;letter-spacing:3px">${esc(cfg.stat_label)}</div>` : ""}
    <div style="font-size:46px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.2;text-shadow:0 2px 12px rgba(0,0,0,0.2);padding:0 40px">${esc(cfg.headline)}</div>
    ${cfg.subline ? `<div style="font-size:22px;color:rgba(255,255,255,0.85);margin-top:16px;font-weight:500;text-align:center;max-width:800px;padding:0 40px">${esc(cfg.subline)}</div>` : ""}
    ${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

export interface SplitConfig {
  gradient: string;
  headline: string;
  bullets: string[];
  cta?: string;
}

function splitHTML(cfg: SplitConfig): string {
  const left = `<div style="flex:1;padding:50px;display:flex;flex-direction:column;justify-content:center">
    <div style="font-size:40px;font-weight:800;color:#fff;line-height:1.15;margin-bottom:24px;text-shadow:0 2px 8px rgba(0,0,0,0.15)">${esc(cfg.headline)}</div>
    ${cfg.bullets.map(b => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0">✓</span>
      <span style="color:rgba(255,255,255,0.92);font-size:18px;font-weight:500">${esc(b)}</span>
    </div>`).join("")}
  </div>`;
  const right = `<div style="flex:0.7;display:flex;align-items:center;justify-content:center">
    <div style="width:280px;height:280px;border-radius:24px;background:rgba(255,255,255,0.12);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;font-size:120px;text-shadow:0 4px 20px rgba(0,0,0,0.2)">🚀</div>
  </div>`;
  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)};flex-direction:row">
    ${decorCircles()}${left}${right}${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

export interface NumberItem {
  value: string;
  label: string;
}

export interface NumbersConfig {
  gradient: string;
  headline: string;
  numbers: NumberItem[];
  cta?: string;
}

function numbersHTML(cfg: NumbersConfig): string {
  const numEls = cfg.numbers.map(n => `<div style="text-align:center">
    <div style="font-size:52px;font-weight:900;color:#fff">${esc(n.value)}</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:2px;margin-top:4px">${esc(n.label)}</div>
  </div>`).join("");
  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)}">
    ${decorCircles()}
    <div style="font-size:42px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.15;margin-bottom:36px;padding:0 40px;text-shadow:0 2px 12px rgba(0,0,0,0.2)">${esc(cfg.headline)}</div>
    <div style="display:flex;gap:60px;align-items:center">${numEls}</div>
    ${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

export interface VsConfig {
  gradient: string;
  headline: string;
  before: { title: string; items: string[] };
  after: { title: string; items: string[] };
  cta?: string;
}

function vsHTML(cfg: VsConfig): string {
  const box = (title: string, items: string[], opacity: string) => `<div style="background:rgba(255,255,255,${opacity});border-radius:16px;padding:28px;width:400px">
    <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:16px">${esc(title)}</div>
    ${items.map(i => `<div style="color:rgba(255,255,255,0.85);font-size:16px;margin-bottom:8px;display:flex;align-items:center;gap:8px">${esc(i)}</div>`).join("")}
  </div>`;
  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)}">
    ${decorCircles()}
    <div style="font-size:38px;font-weight:800;color:#fff;margin-bottom:28px;text-shadow:0 2px 8px rgba(0,0,0,0.2)">${esc(cfg.headline)}</div>
    <div style="display:flex;gap:24px;align-items:stretch">
      ${box(cfg.before.title, cfg.before.items, "0.08")}
      <div style="display:flex;align-items:center;font-size:36px;color:rgba(255,255,255,0.6);font-weight:900">→</div>
      ${box(cfg.after.title, cfg.after.items, "0.15")}
    </div>
    ${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type TemplateType = "hero" | "split" | "numbers" | "vs";

export interface BannerConfig {
  /** Use a built-in preset name (post5, post6, ..., post17) */
  preset?: string;
  /** Template type for custom banners */
  template?: TemplateType;
  /** Gradient name (ocean, sunset, purple, emerald, fire, midnight, teal, rose) */
  gradient?: string;
  /** Main headline text */
  headline?: string;
  /** Subline / subtitle (hero template) */
  subline?: string;
  /** Big stat number (hero template) */
  stat?: string;
  /** Label under the stat (hero template) */
  stat_label?: string;
  /** Bullet points (split template) */
  bullets?: string[];
  /** Number items (numbers template) */
  numbers?: NumberItem[];
  /** Before section (vs template) */
  before?: { title: string; items: string[] };
  /** After section (vs template) */
  after?: { title: string; items: string[] };
  /** CTA text on the bottom bar */
  cta?: string;
  /** Custom save path. Default: ~/.linkedin-mcp/images/banner-{timestamp}.png */
  save_path?: string;
}

// ── Presets ────────────────────────────────────────────────────────────────────

const PRESETS: Record<string, () => string> = {
  post5: () => heroHTML({
    gradient: GRADIENTS.midnight,
    stat: "0", stat_label: "manual steps to publish",
    headline: "This Post Published Itself",
    subline: "Written Sunday → Auto-published Tuesday 9:30 → GitHub link added 15 min later",
    cta: "See how it works ↓",
  }),
  post6: () => numbersHTML({
    gradient: GRADIENTS.ocean,
    headline: "Jedyny Open-Source LinkedIn MCP",
    numbers: [
      { value: "25", label: "narzedzi MCP" },
      { value: "12", label: "szablonow" },
      { value: "0", label: "oplat" },
    ],
    cta: "Kod zrodlowy w komentarzu ↓",
  }),
  post7: () => splitHTML({
    gradient: GRADIENTS.purple,
    headline: "12 Templates That Write LinkedIn Posts For You",
    bullets: [
      "Hook optimized for 210-char cutoff",
      "Algorithm rules built-in",
      "Link in comment, never in body",
      "Max 3 hashtags, CTA as last line",
      "Auto-scheduled + auto-published",
    ],
    cta: "Get all 12 templates free ↓",
  }),
  post8: () => numbersHTML({
    gradient: GRADIENTS.fire,
    headline: "From Zero to 25 LinkedIn Tools",
    numbers: [
      { value: "48h", label: "build time" },
      { value: "25", label: "MCP tools" },
      { value: "1", label: "developer + AI" },
    ],
    cta: "Full git history in comments ↓",
  }),
  post9: () => vsHTML({
    gradient: GRADIENTS.teal,
    headline: "MCP zmienia wszystko",
    before: {
      title: "❌ Przed MCP",
      items: ["→ AI pisze tekst", "→ Ty sam wklejasz", "→ Ty sam publikujesz", "→ Ty sam dodajesz link"],
    },
    after: {
      title: "✅ Z MCP",
      items: ["→ \"Zaplanuj post na czwartek\"", "→ Gotowe. Opublikowany.", "→ Z grafika i komentarzem.", "→ Zero recznej pracy."],
    },
    cta: "Kod zrodlowy w komentarzu ↓",
  }),
  post10: () => splitHTML({
    gradient: GRADIENTS.ocean,
    headline: "LinkedIn Algorithm Rules I Coded Into a Tool",
    bullets: [
      "Hook in first 210 characters",
      "1300-1600 chars sweet spot",
      "Link in comment after 15 min",
      "Post Tue-Thu at 8:00 / 9:30 / 17:00",
      "Max 3 hashtags at the end",
    ],
    cta: "Open source — link in comments ↓",
  }),
  post11: () => numbersHTML({
    gradient: GRADIENTS.emerald,
    headline: "My Entire Content Stack as a Solo Founder",
    numbers: [
      { value: "2h", label: "per week" },
      { value: "4", label: "posts auto-published" },
      { value: "0", label: "manual work" },
    ],
    cta: "Full stack is open source ↓",
  }),
  post12: () => numbersHTML({
    gradient: GRADIENTS.sunset,
    headline: "3 Weeks of MCP-Powered LinkedIn",
    numbers: [
      { value: "12", label: "posts published" },
      { value: "100%", label: "automated" },
      { value: "6h", label: "total time spent" },
    ],
    cta: "Real numbers in comments ↓",
  }),
  post13: () => heroHTML({
    gradient: GRADIENTS.purple,
    stat: "33", stat_label: "SEO audit tools in one MCP",
    headline: "Run a Full SEO Audit From a Single AI Conversation",
    subline: "Technical SEO + Core Web Vitals + Schema + GEO — all open source",
    cta: "GitHub link in comments ↓",
  }),
  post14: () => heroHTML({
    gradient: GRADIENTS.midnight,
    stat: "69+", stat_label: "free AI models, one API",
    headline: "G.A.C.A. — Drop-In OpenAI Replacement",
    subline: "11 providers, auto-failover, smart routing. Your app doesn't change a line of code.",
    cta: "Open source — link in comments ↓",
  }),
  post15: () => vsHTML({
    gradient: GRADIENTS.emerald,
    headline: "The Full Auto-Publish Pipeline",
    before: {
      title: "🕐 Sunday",
      items: ["→ Write 4 posts with Claude", "→ Review + approve", "→ Schedule via MCP", "→ Done. Close laptop."],
    },
    after: {
      title: "🤖 Mon-Fri (auto)",
      items: ["→ Daemon checks every 60s", "→ Publish at optimal time", "→ Upload image automatically", "→ Add GitHub link after 15min"],
    },
    cta: "This post was automated too ↓",
  }),
  post16: () => heroHTML({
    gradient: GRADIENTS.rose,
    stat: "28", stat_label: "typow danych PII do anonimizacji",
    headline: "Przestań wklejać dane klientów do ChatGPT",
    subline: "Presidio Browser Anonymizer — 100% offline, Chrome Extension, Docker",
    cta: "Link w komentarzu ↓",
  }),
  post17: () => numbersHTML({
    gradient: GRADIENTS.ocean,
    headline: "My Open Source MCP Ecosystem",
    numbers: [
      { value: "25", label: "LinkedIn tools" },
      { value: "28", label: "Facebook tools" },
      { value: "33", label: "SEO tools" },
    ],
    cta: "All repos in comments ↓",
  }),
};

export function listPresets(): string[] {
  return Object.keys(PRESETS);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

async function renderPNG(html: string, outPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error(
      "Puppeteer is required for banner generation. Install with: npm install puppeteer"
    );
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const launch = puppeteer.default?.launch || puppeteer.launch;
  const browser = await launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await browser.close();
  }
}

// ── Main Export ───────────────────────────────────────────────────────────────

export async function generateBanner(cfg: BannerConfig): Promise<{
  file_path: string;
  template: string;
  gradient: string;
  presets_available: string[];
}> {
  let html: string;
  let templateName: string;
  let gradientName: string;

  if (cfg.preset) {
    const presetFn = PRESETS[cfg.preset];
    if (!presetFn) {
      throw new Error(
        `Unknown preset: "${cfg.preset}". Available: ${Object.keys(PRESETS).join(", ")}`
      );
    }
    html = presetFn();
    templateName = cfg.preset;
    gradientName = "preset";
  } else {
    const template = cfg.template || "hero";
    gradientName = cfg.gradient || "ocean";
    const gradient = GRADIENTS[gradientName] || GRADIENTS.ocean;
    templateName = template;

    if (!cfg.headline) {
      throw new Error("headline is required for custom banners (or use preset)");
    }

    switch (template) {
      case "hero":
        html = heroHTML({
          gradient,
          headline: cfg.headline,
          subline: cfg.subline,
          stat: cfg.stat,
          stat_label: cfg.stat_label,
          cta: cfg.cta,
        });
        break;
      case "split":
        html = splitHTML({
          gradient,
          headline: cfg.headline,
          bullets: cfg.bullets || [],
          cta: cfg.cta,
        });
        break;
      case "numbers":
        html = numbersHTML({
          gradient,
          headline: cfg.headline,
          numbers: cfg.numbers || [],
          cta: cfg.cta,
        });
        break;
      case "vs":
        if (!cfg.before || !cfg.after) {
          throw new Error("before and after are required for 'vs' template");
        }
        html = vsHTML({
          gradient,
          headline: cfg.headline,
          before: cfg.before,
          after: cfg.after,
          cta: cfg.cta,
        });
        break;
      default:
        throw new Error(`Unknown template: "${template}". Available: hero, split, numbers, vs`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const slug = (cfg.preset || cfg.headline || "banner")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 30)
    .replace(/-$/, "");
  const filePath = cfg.save_path || join(config.imagesDir, `${timestamp}-${slug}.png`);

  log("info", `Generating banner: "${templateName}" → ${filePath}`);
  await renderPNG(html, filePath);
  log("info", `Banner saved: ${filePath}`);

  return {
    file_path: filePath,
    template: templateName,
    gradient: gradientName,
    presets_available: Object.keys(PRESETS),
  };
}
