/**
 * LinkedIn Banner Generator — MCP-integrated module.
 * Generates professional, scroll-stopping 1200×627 banners with CTA and branding.
 * 6 templates: hero, split, numbers, vs, infographic, quote
 * Carousel PDF support (1080×1080 slides → PDF).
 * Screenshot capture for web pages.
 * Uses Puppeteer for HTML→PNG rendering (dynamic import).
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
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

// ── Visual Complexity (dwell time boosters) ──────────────────────────────────

function noiseOverlay(): string {
  return `<div style="position:absolute;inset:0;opacity:0.03;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%224%22/%3E%3CfeColorMatrix type=%22saturate%22 values=%220%22/%3E%3C/filter%3E%3Crect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/%3E%3C/svg%3E');background-repeat:repeat;background-size:200px"></div>`;
}

function decorGeometric(): string {
  return `${decorCircles()}
    <div style="position:absolute;top:50px;left:50px;width:80px;height:80px;border:2px solid rgba(255,255,255,0.08);transform:rotate(45deg)"></div>
    <div style="position:absolute;bottom:80px;right:120px;width:60px;height:60px;border:2px solid rgba(255,255,255,0.06);border-radius:50%"></div>
    <div style="position:absolute;top:200px;right:40px;width:4px;height:120px;background:rgba(255,255,255,0.05)"></div>`;
}

function dotGrid(): string {
  return `<div style="position:absolute;inset:0;opacity:0.04;background-image:radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px);background-size:24px 24px"></div>`;
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

// ── Infographic Template ──────────────────────────────────────────────────────

export interface InfographicConfig {
  gradient: string;
  headline: string;
  data_points: Array<{ label: string; value: number; max?: number }>;
  cta?: string;
}

function infographicHTML(cfg: InfographicConfig): string {
  const maxVal = Math.max(...cfg.data_points.map(d => d.max || d.value));
  const bars = cfg.data_points.map(d => {
    const pct = Math.round((d.value / maxVal) * 100);
    return `<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
      <span style="color:rgba(255,255,255,0.7);font-size:14px;width:140px;text-align:right;flex-shrink:0;text-transform:uppercase;letter-spacing:1px">${esc(d.label)}</span>
      <div style="flex:1;height:36px;background:rgba(255,255,255,0.1);border-radius:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:rgba(255,255,255,0.25);border-radius:8px;display:flex;align-items:center;padding-left:12px;min-width:40px">
          <span style="color:#fff;font-size:15px;font-weight:700">${d.value}</span>
        </div>
      </div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)}">
    ${decorGeometric()}${noiseOverlay()}${dotGrid()}
    <div style="font-size:38px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.15;margin-bottom:36px;padding:0 40px;text-shadow:0 2px 12px rgba(0,0,0,0.3)">${esc(cfg.headline)}</div>
    <div style="width:85%;max-width:800px">${bars}</div>
    ${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

// ── Quote Template ───────────────────────────────────────────────────────────

export interface QuoteConfig {
  gradient: string;
  quote: string;
  author?: string;
  cta?: string;
}

function quoteHTML(cfg: QuoteConfig): string {
  return `<!DOCTYPE html><html><body style="${baseStyle(cfg.gradient)}">
    ${decorGeometric()}${noiseOverlay()}
    <div style="font-size:140px;color:rgba(255,255,255,0.12);position:absolute;top:30px;left:60px;font-family:Georgia,serif;line-height:1">&ldquo;</div>
    <div style="font-size:30px;font-weight:600;color:#fff;text-align:center;max-width:800px;line-height:1.45;padding:0 80px;font-style:italic;text-shadow:0 2px 12px rgba(0,0,0,0.2)">${esc(cfg.quote)}</div>
    ${cfg.author ? `<div style="margin-top:24px;font-size:17px;color:rgba(255,255,255,0.7);font-weight:500">&mdash; ${esc(cfg.author)}</div>` : ""}
    ${ctaBar(cfg.cta || "Link in comments")}
  </body></html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type TemplateType = "hero" | "split" | "numbers" | "vs" | "infographic" | "quote";

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
  /** Data points for infographic template */
  data_points?: Array<{ label: string; value: number; max?: number }>;
  /** Quote text for quote template */
  quote?: string;
  /** Quote author for quote template */
  quote_author?: string;
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

    if (!cfg.headline && template !== "quote") {
      throw new Error("headline is required for custom banners (or use preset)");
    }

    const headline = cfg.headline || "";

    switch (template) {
      case "hero":
        html = heroHTML({
          gradient,
          headline,
          subline: cfg.subline,
          stat: cfg.stat,
          stat_label: cfg.stat_label,
          cta: cfg.cta,
        });
        break;
      case "split":
        html = splitHTML({
          gradient,
          headline,
          bullets: cfg.bullets || [],
          cta: cfg.cta,
        });
        break;
      case "numbers":
        html = numbersHTML({
          gradient,
          headline,
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
          headline,
          before: cfg.before,
          after: cfg.after,
          cta: cfg.cta,
        });
        break;
      case "infographic":
        html = infographicHTML({
          gradient,
          headline,
          data_points: cfg.data_points || [],
          cta: cfg.cta,
        });
        break;
      case "quote":
        if (!cfg.quote) {
          throw new Error("quote text is required for 'quote' template");
        }
        html = quoteHTML({
          gradient,
          quote: cfg.quote,
          author: cfg.quote_author,
          cta: cfg.cta,
        });
        break;
      default:
        throw new Error(`Unknown template: "${template}". Available: hero, split, numbers, vs, infographic, quote`);
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

// ── Carousel PDF Generation ──────────────────────────────────────────────────

const CAROUSEL_W = 1080;
const CAROUSEL_H = 1080;

export interface CarouselSlide {
  template: TemplateType;
  gradient?: string;
  headline?: string;
  subline?: string;
  stat?: string;
  stat_label?: string;
  bullets?: string[];
  numbers?: NumberItem[];
  before?: { title: string; items: string[] };
  after?: { title: string; items: string[] };
  data_points?: Array<{ label: string; value: number; max?: number }>;
  quote?: string;
  quote_author?: string;
  cta?: string;
}

export interface CarouselConfig {
  slides: CarouselSlide[];
  gradient?: string;
  save_path?: string;
}

function carouselBaseStyle(gradient: string): string {
  return `margin:0;padding:0;width:${CAROUSEL_W}px;height:${CAROUSEL_H}px;background:${gradient};display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;position:relative;overflow:hidden`;
}

function generateSlideHTML(slide: CarouselSlide, gradientValue: string): string {
  // Generate HTML adapted for 1080×1080 square format
  const style = carouselBaseStyle(gradientValue);
  const cta = slide.cta || "Swipe →";

  switch (slide.template) {
    case "hero":
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}
        ${slide.stat ? `<div style="font-size:90px;font-weight:900;color:#fff;letter-spacing:-2px;margin-bottom:8px;text-shadow:0 4px 20px rgba(0,0,0,0.3)">${esc(slide.stat)}</div>` : ""}
        ${slide.stat_label ? `<div style="font-size:18px;color:rgba(255,255,255,0.8);font-weight:500;margin-bottom:24px;text-transform:uppercase;letter-spacing:3px">${esc(slide.stat_label)}</div>` : ""}
        <div style="font-size:48px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.2;text-shadow:0 2px 12px rgba(0,0,0,0.2);padding:0 50px">${esc(slide.headline || "")}</div>
        ${slide.subline ? `<div style="font-size:22px;color:rgba(255,255,255,0.85);margin-top:20px;font-weight:500;text-align:center;max-width:800px;padding:0 50px">${esc(slide.subline)}</div>` : ""}
        ${ctaBar(cta)}
      </body></html>`;

    case "split":
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}
        <div style="padding:60px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;width:100%;box-sizing:border-box">
          <div style="font-size:40px;font-weight:800;color:#fff;line-height:1.15;margin-bottom:30px;text-shadow:0 2px 8px rgba(0,0,0,0.15)">${esc(slide.headline || "")}</div>
          ${(slide.bullets || []).map(b => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0">✓</span>
            <span style="color:rgba(255,255,255,0.92);font-size:20px;font-weight:500">${esc(b)}</span>
          </div>`).join("")}
        </div>
        ${ctaBar(cta)}
      </body></html>`;

    case "numbers": {
      const numEls = (slide.numbers || []).map(n => `<div style="text-align:center">
        <div style="font-size:56px;font-weight:900;color:#fff">${esc(n.value)}</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:2px;margin-top:6px">${esc(n.label)}</div>
      </div>`).join("");
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}
        <div style="font-size:42px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.15;margin-bottom:40px;padding:0 50px;text-shadow:0 2px 12px rgba(0,0,0,0.2)">${esc(slide.headline || "")}</div>
        <div style="display:flex;gap:60px;align-items:center">${numEls}</div>
        ${ctaBar(cta)}
      </body></html>`;
    }

    case "infographic": {
      const maxVal = Math.max(...(slide.data_points || []).map(d => d.max || d.value), 1);
      const bars = (slide.data_points || []).map(d => {
        const pct = Math.round((d.value / maxVal) * 100);
        return `<div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
          <span style="color:rgba(255,255,255,0.7);font-size:15px;width:140px;text-align:right;flex-shrink:0">${esc(d.label)}</span>
          <div style="flex:1;height:36px;background:rgba(255,255,255,0.1);border-radius:8px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:rgba(255,255,255,0.25);border-radius:8px;display:flex;align-items:center;padding-left:12px;min-width:40px">
              <span style="color:#fff;font-size:15px;font-weight:700">${d.value}</span>
            </div>
          </div>
        </div>`;
      }).join("");
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}${dotGrid()}
        <div style="font-size:38px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.15;margin-bottom:36px;padding:0 50px">${esc(slide.headline || "")}</div>
        <div style="width:85%;max-width:800px">${bars}</div>
        ${ctaBar(cta)}
      </body></html>`;
    }

    case "quote":
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}
        <div style="font-size:140px;color:rgba(255,255,255,0.12);position:absolute;top:40px;left:60px;font-family:Georgia,serif;line-height:1">&ldquo;</div>
        <div style="font-size:32px;font-weight:600;color:#fff;text-align:center;max-width:800px;line-height:1.45;padding:0 80px;font-style:italic">${esc(slide.quote || "")}</div>
        ${slide.quote_author ? `<div style="margin-top:24px;font-size:17px;color:rgba(255,255,255,0.7)">&mdash; ${esc(slide.quote_author)}</div>` : ""}
        ${ctaBar(cta)}
      </body></html>`;

    case "vs": {
      const box = (title: string, items: string[], opacity: string) => `<div style="background:rgba(255,255,255,${opacity});border-radius:16px;padding:28px;width:420px">
        <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:16px">${esc(title)}</div>
        ${items.map(i => `<div style="color:rgba(255,255,255,0.85);font-size:17px;margin-bottom:8px">${esc(i)}</div>`).join("")}
      </div>`;
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorGeometric()}${noiseOverlay()}
        <div style="font-size:38px;font-weight:800;color:#fff;margin-bottom:28px">${esc(slide.headline || "")}</div>
        <div style="display:flex;gap:24px;align-items:stretch">
          ${slide.before ? box(slide.before.title, slide.before.items, "0.08") : ""}
          <div style="display:flex;align-items:center;font-size:36px;color:rgba(255,255,255,0.6);font-weight:900">→</div>
          ${slide.after ? box(slide.after.title, slide.after.items, "0.15") : ""}
        </div>
        ${ctaBar(cta)}
      </body></html>`;
    }

    default:
      return `<!DOCTYPE html><html><body style="${style}">
        ${decorCircles()}
        <div style="font-size:48px;font-weight:800;color:#fff;text-align:center;padding:0 60px">${esc(slide.headline || "")}</div>
        ${ctaBar(cta)}
      </body></html>`;
  }
}

async function renderCarouselSlide(html: string, outPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error("Puppeteer is required for carousel generation");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const launch = puppeteer.default?.launch || puppeteer.launch;
  const browser = await launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: CAROUSEL_W, height: CAROUSEL_H, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.screenshot({ path: outPath, type: "png" });
  } finally {
    await browser.close();
  }
}

export async function generateCarousel(cfg: CarouselConfig): Promise<{
  file_path: string;
  slide_count: number;
  format: string;
}> {
  const { PDFDocument } = await import("pdf-lib");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const pdfPath = cfg.save_path || join(config.imagesDir, `carousel-${timestamp}.pdf`);
  mkdirSync(dirname(pdfPath), { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const tempFiles: string[] = [];

  for (let i = 0; i < cfg.slides.length; i++) {
    const slide = cfg.slides[i];
    const gradientName = slide.gradient || cfg.gradient || "ocean";
    const gradientValue = GRADIENTS[gradientName] || GRADIENTS.ocean;
    const html = generateSlideHTML(slide, gradientValue);

    const tempPng = join(config.imagesDir, `carousel-temp-${i}.png`);
    tempFiles.push(tempPng);
    await renderCarouselSlide(html, tempPng);

    const pngBytes = readFileSync(tempPng);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([CAROUSEL_W * 2, CAROUSEL_H * 2]);
    page.drawImage(pngImage, {
      x: 0, y: 0,
      width: CAROUSEL_W * 2,
      height: CAROUSEL_H * 2,
    });
  }

  const pdfBytes = await pdfDoc.save();
  writeFileSync(pdfPath, pdfBytes);

  // Cleanup temp files
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }

  log("info", `Carousel PDF saved: ${pdfPath} (${cfg.slides.length} slides)`);

  return {
    file_path: pdfPath,
    slide_count: cfg.slides.length,
    format: "pdf",
  };
}

// ── Screenshot Capture ───────────────────────────────────────────────────────

export interface ScreenshotConfig {
  url: string;
  width?: number;
  height?: number;
  selector?: string;
  save_path?: string;
  full_page?: boolean;
}

export async function captureScreenshot(cfg: ScreenshotConfig): Promise<{
  file_path: string;
  url: string;
  width: number;
  height: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteer: any;
  try {
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error("Puppeteer is required for screenshot capture");
  }

  const width = cfg.width || 1280;
  const height = cfg.height || 800;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const outPath = cfg.save_path || join(config.imagesDir, `screenshot-${timestamp}.png`);
  mkdirSync(dirname(outPath), { recursive: true });

  const launch = puppeteer.default?.launch || puppeteer.launch;
  const browser = await launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.goto(cfg.url, { waitUntil: "networkidle0", timeout: 30000 });

    if (cfg.selector) {
      const element = await page.$(cfg.selector);
      if (element) {
        await element.screenshot({ path: outPath, type: "png" });
      } else {
        await page.screenshot({ path: outPath, type: "png", fullPage: cfg.full_page });
      }
    } else {
      await page.screenshot({ path: outPath, type: "png", fullPage: cfg.full_page });
    }
  } finally {
    await browser.close();
  }

  log("info", `Screenshot saved: ${outPath}`);

  return {
    file_path: outPath,
    url: cfg.url,
    width,
    height,
  };
}
