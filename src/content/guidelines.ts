import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface GuidelinesData {
  [key: string]: unknown;
}

function getGuidelinesPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "guidelines", "linkedin-strategy.json");
}

let cachedGuidelines: GuidelinesData | null = null;

function loadAll(): GuidelinesData {
  if (cachedGuidelines) return cachedGuidelines;

  const filePath = getGuidelinesPath();
  if (!existsSync(filePath)) {
    throw new Error("Guidelines file not found. Ensure guidelines/linkedin-strategy.json exists.");
  }

  const raw = readFileSync(filePath, "utf-8");
  cachedGuidelines = JSON.parse(raw) as GuidelinesData;
  return cachedGuidelines;
}

const TOPIC_MAP: Record<string, string[]> = {
  algorithm: ["algorithm"],
  copywriting: ["copywriting"],
  formats: ["formats"],
  timing: ["cadence"],
  hooks: ["hooks"],
  ctas: ["ctas"],
  checklist: ["checklist"],
  dos_donts: ["dos_and_donts"],
  links: ["links_hashtags_tags"],
  ab_testing: ["ab_test_plan"],
};

export function loadGuidelines(topic?: string): Record<string, unknown> {
  const data = loadAll();

  if (!topic || topic === "all") {
    return data as Record<string, unknown>;
  }

  const keys = TOPIC_MAP[topic];
  if (!keys) {
    return {
      error: `Unknown topic '${topic}'. Available: ${["all", ...Object.keys(TOPIC_MAP)].join(", ")}`,
    };
  }

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in data) {
      result[key] = data[key];
    }
  }

  return result;
}
