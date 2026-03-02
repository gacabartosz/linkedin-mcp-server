import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), ".linkedin-mcp");

export const config = {
  dataDir: DATA_DIR,
  authFile: join(DATA_DIR, "auth.json"),
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
  apiVersion: process.env.LINKEDIN_API_VERSION || "202503",
};

export function ensureDataDirs(): void {
  for (const dir of [config.dataDir, config.userTemplatesDir, config.imagesDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
