/**
 * Telegram Bot Notifications
 * Sends notifications via Telegram Bot API.
 *
 * Config via env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * Or via ~/.linkedin-mcp/telegram.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "./utils/logger.js";

const TELEGRAM_CONFIG_PATH = join(homedir(), ".linkedin-mcp", "telegram.json");

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

function loadConfig(): TelegramConfig | null {
  // Env vars first
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    return {
      bot_token: process.env.TELEGRAM_BOT_TOKEN,
      chat_id: process.env.TELEGRAM_CHAT_ID,
    };
  }

  // Config file fallback
  if (existsSync(TELEGRAM_CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(TELEGRAM_CONFIG_PATH, "utf-8")) as TelegramConfig;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Send a Telegram message. Silently fails if not configured.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  const cfg = loadConfig();
  if (!cfg) {
    log("warn", "Telegram not configured — skipping notification");
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chat_id,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      log("error", `Telegram send failed: ${response.status} ${err}`);
      return false;
    }

    log("info", `Telegram message sent (${text.length} chars)`);
    return true;
  } catch (err) {
    log("error", `Telegram error: ${err}`);
    return false;
  }
}
