import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "../utils/config.js";

export interface BrandVoiceConfig {
  tone: string;
  emoji_style: "none" | "minimal" | "moderate" | "heavy";
  hashtag_strategy: string;
  post_structure: string;
  language: string;
  max_length: number;
  avoid_words: string[];
  signature_phrases: string[];
  line_spacing: string;
}

const DEFAULT_BRAND_VOICE: BrandVoiceConfig = {
  tone: "professional-friendly",
  emoji_style: "minimal",
  hashtag_strategy: "3-5 relevant, last line",
  post_structure: "hook-story-lesson-cta",
  language: "en",
  max_length: 3000,
  avoid_words: [],
  signature_phrases: [],
  line_spacing: "double",
};

export function getBrandVoice(): BrandVoiceConfig {
  if (!existsSync(config.brandVoiceFile)) {
    return DEFAULT_BRAND_VOICE;
  }
  try {
    const data = readFileSync(config.brandVoiceFile, "utf-8");
    return { ...DEFAULT_BRAND_VOICE, ...JSON.parse(data) };
  } catch {
    return DEFAULT_BRAND_VOICE;
  }
}

export function setBrandVoice(voiceConfig: Partial<BrandVoiceConfig>): BrandVoiceConfig {
  const current = getBrandVoice();
  const updated = { ...current, ...voiceConfig };
  writeFileSync(config.brandVoiceFile, JSON.stringify(updated, null, 2));
  return updated;
}
