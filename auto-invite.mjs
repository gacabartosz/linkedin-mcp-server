#!/usr/bin/env node
/**
 * LinkedIn Auto-Invite Reminder v1
 * Daily cron: generates invite list from prospects and sends Telegram notification.
 * Does NOT send invites automatically (risk of ban).
 *
 * Schedule: daily 18:00 via LaunchAgent
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

const PROSPECTS_DB = join(homedir(), '.linkedin-mcp', 'prospects.db');
const TELEGRAM_CFG = join(homedir(), '.linkedin-mcp', 'telegram.json');

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function notify(title, body) {
  try {
    const safe = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}"'`);
  } catch {}
}

function sendTelegram(text) {
  if (!existsSync(TELEGRAM_CFG)) return;
  try {
    const cfg = JSON.parse(readFileSync(TELEGRAM_CFG, 'utf-8'));
    fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chat_id, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    }).catch(() => {});
  } catch {}
}

function main() {
  if (!existsSync(PROSPECTS_DB)) {
    log('No prospects DB — skipping');
    return;
  }

  const db = new Database(PROSPECTS_DB, { readonly: true });
  try { db.exec("SELECT status FROM prospects LIMIT 0"); } catch { db.close(); return; }

  const toInvite = db.prepare(
    "SELECT name, headline, company_name, public_id FROM prospects WHERE (status IS NULL OR status = 'new') ORDER BY created_at DESC LIMIT 5"
  ).all();

  const totalNew = db.prepare("SELECT COUNT(*) as cnt FROM prospects WHERE status IS NULL OR status = 'new'").get();
  const totalInvited = db.prepare("SELECT COUNT(*) as cnt FROM prospects WHERE status = 'invited'").get();
  db.close();

  if (toInvite.length === 0) {
    log('No new prospects to invite');
    return;
  }

  const list = toInvite.map((p, i) => {
    const url = `https://www.linkedin.com/in/${p.public_id}`;
    return `${i + 1}. *${p.name || '-'}* — ${p.company_name || '-'}\n   ${url}`;
  }).join('\n');

  const msg = `📨 *LinkedIn Zaproszenia*\n\n${toInvite.length} osob do zaproszenia dzis:\n\n${list}\n\n_Lacznie: ${totalNew?.cnt || 0} nowych | ${totalInvited?.cnt || 0} zaproszonych_\n\nOtworz Chrome i wyslij zaproszenia bez notatki.`;

  notify('LinkedIn Zaproszenia', `${toInvite.length} osob do zaproszenia`);
  sendTelegram(msg);
  log(`Invite reminder sent: ${toInvite.length} prospects`);
}

main();
