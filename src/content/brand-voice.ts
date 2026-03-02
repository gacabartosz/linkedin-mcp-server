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
  // LinkedIn algorithm-specific
  hook_max_chars: number;
  optimal_post_length: { min: number; max: number };
  link_in_comment: boolean;
  max_hashtags: number;
  posting_times: string[];
  posting_days: string[];
  min_gap_hours: number;
  golden_hour_minutes: number;
  first_comment_delay_minutes: number;
}

const DEFAULT_BRAND_VOICE: BrandVoiceConfig = {
  tone: "professional-friendly",
  emoji_style: "minimal",
  hashtag_strategy: "1-3 precise hashtags at end, never >5",
  post_structure: "hook-value-expansion-cta",
  language: "en",
  max_length: 3000,
  avoid_words: [],
  signature_phrases: [],
  line_spacing: "double",
  // LinkedIn algorithm defaults
  hook_max_chars: 210,
  optimal_post_length: { min: 1300, max: 1600 },
  link_in_comment: true,
  max_hashtags: 3,
  posting_times: ["08:00", "09:30", "17:00"],
  posting_days: ["tue", "wed", "thu"],
  min_gap_hours: 12,
  golden_hour_minutes: 60,
  first_comment_delay_minutes: 15,
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
