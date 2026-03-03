/**
 * LinkedIn Case Study PDF Generator
 *
 * Generates professional, branded case study PDFs optimized for LinkedIn.
 * Uses:
 * - Puppeteer for screenshots of project pages
 * - Gemini Imagen for cover images
 * - ReportLab (via existing pdf-generator skill) for PDF generation
 * - Banner generator for LinkedIn banner companion
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { captureScreenshot } from "../banner/index.js";
import { generateBanner } from "../banner/index.js";
import { generateImage } from "../gemini/client.js";

const execFileAsync = promisify(execFile);

const PDF_GENERATOR_SCRIPT = "/Users/gaca/.agents/skills/pdf-generator/scripts/generate_pdf.py";
const PYTHON_BIN = "/Users/gaca/tools/document-edit-mcp/.venv/bin/python";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface CaseStudyConfig {
  project_name: string;
  project_url?: string;
  problem: string;
  solution: string;
  metrics?: Array<{ label: string; value: string }>;
  screenshots?: string[];
  tech_stack?: string[];
  brand?: "bartoszgaca" | "beecommerce" | "neutral";
  generate_cover?: boolean;
  generate_banner?: boolean;
  language?: "pl" | "en";
  save_path?: string;
}

export interface CaseStudyResult {
  pdf_path: string;
  banner_path?: string;
  cover_image_path?: string;
  screenshot_paths: string[];
  project_name: string;
}

// ── Labels ───────────────────────────────────────────────────────────────────

const LABELS = {
  en: {
    case_study: "CASE STUDY",
    problem: "The Problem",
    solution: "The Solution",
    key_metrics: "Key Metrics",
    tech_stack: "Tech Stack",
    screenshots: "In Action",
    conclusion: "Conclusion",
    cta: "Try it yourself",
    metric: "Metric",
    value: "Value",
  },
  pl: {
    case_study: "CASE STUDY",
    problem: "Problem",
    solution: "Rozwiązanie",
    key_metrics: "Kluczowe metryki",
    tech_stack: "Stack technologiczny",
    screenshots: "W akcji",
    conclusion: "Podsumowanie",
    cta: "Sprawdź sam",
    metric: "Metryka",
    value: "Wartość",
  },
};

// ── PDF Content Builder ──────────────────────────────────────────────────────

function buildPDFContent(cfg: CaseStudyConfig, screenshotPaths: string[], coverPath?: string): object {
  const lang = cfg.language || "en";
  const l = LABELS[lang];
  const today = new Date().toISOString().split("T")[0];

  const content: Array<Record<string, unknown>> = [];

  // Cover image if generated
  if (coverPath && existsSync(coverPath)) {
    content.push({ type: "image", path: coverPath, width: 500, align: "center" });
    content.push({ type: "spacer", height: 20 });
  }

  // Problem section
  content.push({ type: "heading", text: l.problem, level: 1 });
  content.push({ type: "paragraph", text: cfg.problem });
  content.push({ type: "spacer", height: 12 });

  // Solution section
  content.push({ type: "heading", text: l.solution, level: 1 });
  content.push({ type: "paragraph", text: cfg.solution });
  content.push({ type: "spacer", height: 12 });

  // Tech stack
  if (cfg.tech_stack && cfg.tech_stack.length > 0) {
    content.push({ type: "heading", text: l.tech_stack, level: 2 });
    content.push({ type: "list", items: cfg.tech_stack, ordered: false });
    content.push({ type: "spacer", height: 12 });
  }

  // Key metrics
  if (cfg.metrics && cfg.metrics.length > 0) {
    content.push({ type: "heading", text: l.key_metrics, level: 1 });
    content.push({
      type: "table",
      headers: [l.metric, l.value],
      rows: cfg.metrics.map(m => [m.label, m.value]),
    });
    content.push({ type: "spacer", height: 12 });
  }

  // Screenshots
  if (screenshotPaths.length > 0) {
    content.push({ type: "heading", text: l.screenshots, level: 1 });
    for (const ss of screenshotPaths) {
      if (existsSync(ss)) {
        content.push({ type: "image", path: ss, width: 480, align: "center" });
        content.push({ type: "spacer", height: 10 });
      }
    }
  }

  // CTA
  content.push({ type: "separator" });
  if (cfg.project_url) {
    content.push({
      type: "paragraph",
      text: `<b>${l.cta}:</b> ${cfg.project_url}`,
      align: "center",
    });
  }

  return {
    title: `${l.case_study}: ${cfg.project_name}`,
    subtitle: cfg.project_url || "",
    author: "Bartosz Gaca",
    date: today,
    show_logo: true,
    content,
  };
}

// ── Main Generator ───────────────────────────────────────────────────────────

export async function generateCaseStudy(cfg: CaseStudyConfig): Promise<CaseStudyResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const slug = cfg.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 30);
  const outDir = dirname(cfg.save_path || join(config.imagesDir, "casestudy", `${slug}.pdf`));
  mkdirSync(outDir, { recursive: true });

  const pdfPath = cfg.save_path || join(config.imagesDir, "casestudy", `${timestamp}-${slug}.pdf`);
  const result: CaseStudyResult = {
    pdf_path: pdfPath,
    screenshot_paths: [],
    project_name: cfg.project_name,
  };

  // Step 1: Capture screenshots
  if (cfg.screenshots && cfg.screenshots.length > 0) {
    log("info", `Capturing ${cfg.screenshots.length} screenshots...`);
    for (let i = 0; i < cfg.screenshots.length; i++) {
      try {
        const ssResult = await captureScreenshot({
          url: cfg.screenshots[i],
          width: 1280,
          height: 800,
          save_path: join(outDir, `screenshot-${i}.png`),
        });
        result.screenshot_paths.push(ssResult.file_path);
      } catch (err) {
        log("warn", `Screenshot failed for ${cfg.screenshots[i]}: ${(err as Error).message}`);
      }
    }
  }

  // Step 2: Generate cover image with Gemini
  let coverPath: string | undefined;
  if (cfg.generate_cover !== false && config.geminiApiKey) {
    log("info", "Generating cover image with Gemini...");
    try {
      const coverPrompt = `Professional case study cover image for "${cfg.project_name}". Tech/automation theme with navy blue and cyan accents. Clean, modern design. Abstract geometric patterns suggesting data flow and automation. No text overlay. Professional and minimalist.`;
      const imageResult = await generateImage({
        prompt: coverPrompt,
        aspect_ratio: "16:9",
        save_path: join(outDir, "cover.png"),
      });
      coverPath = imageResult.file_path;
      result.cover_image_path = coverPath;
    } catch (err) {
      log("warn", `Cover image generation failed: ${(err as Error).message}`);
    }
  }

  // Step 3: Build PDF content JSON
  const pdfContent = buildPDFContent(cfg, result.screenshot_paths, coverPath);
  const jsonPath = join(outDir, `${slug}-content.json`);
  writeFileSync(jsonPath, JSON.stringify(pdfContent, null, 2));

  // Step 4: Generate PDF via existing pdf-generator skill
  log("info", `Generating PDF: ${pdfPath}`);
  const brand = cfg.brand || "bartoszgaca";

  if (!existsSync(PDF_GENERATOR_SCRIPT)) {
    throw new Error(`PDF generator script not found at ${PDF_GENERATOR_SCRIPT}`);
  }
  if (!existsSync(PYTHON_BIN)) {
    throw new Error(`Python binary not found at ${PYTHON_BIN}`);
  }

  try {
    await execFileAsync(PYTHON_BIN, [PDF_GENERATOR_SCRIPT, jsonPath, pdfPath, "--brand", brand], {
      timeout: 60000,
    });
  } catch (err) {
    throw new Error(`PDF generation failed: ${(err as Error).message}`);
  }

  // Step 5: Generate LinkedIn banner
  if (cfg.generate_banner !== false) {
    log("info", "Generating LinkedIn banner...");
    try {
      const bannerCfg: Record<string, unknown> = {
        template: "numbers" as const,
        gradient: "ocean",
        headline: `Case Study: ${cfg.project_name}`,
        cta: cfg.project_url ? "Full case study in comments ↓" : "Link in comments ↓",
        save_path: join(outDir, `${slug}-banner.png`),
      };

      if (cfg.metrics && cfg.metrics.length > 0) {
        bannerCfg.numbers = cfg.metrics.slice(0, 3).map(m => ({
          value: m.value,
          label: m.label,
        }));
      }

      const bannerResult = await generateBanner(bannerCfg as Parameters<typeof generateBanner>[0]);
      result.banner_path = bannerResult.file_path;
    } catch (err) {
      log("warn", `Banner generation failed: ${(err as Error).message}`);
    }
  }

  log("info", `Case study complete: ${pdfPath}`);
  return result;
}
