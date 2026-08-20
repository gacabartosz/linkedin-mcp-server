#!/usr/bin/env node
/**
 * Golden Hour Engine — pierwsze 60 min po publikacji decyduje o zasięgu (LinkedIn 2026).
 *
 * Dla KAŻDEGO posta opublikowanego w ostatnich `golden_hour_minutes` minut:
 *   1. START (≈t0)      — PUSH do Ciebie: "🔥 GOLDEN HOUR — otwórz i odpisuj 60 min" + URL posta
 *                         + odpala szybki sweep propozycji odpowiedzi (auto-notify.mjs --once).
 *   2. WARNING (≈t-10)  — PUSH: "⏳ kończy się za ~10 min — domknij wątki" + drugi sweep.
 *
 * Golden hour to ręczna robota o NAJWYŻSZYM ROI (komentarze = 15× like, wątki = waga).
 * Ten daemon tylko Cię pilnuje i przygotowuje propozycje — odpisujesz Ty (autentyczność).
 *
 * Kanały push: lokalne powiadomienie macOS (osascript) ZAWSZE + opcjonalnie webhook na telefon
 * (env GOLDEN_HOUR_PUSH_URL — POST {title, body, url}; działa np. z ntfy/Make/n8n/własnym botem WA).
 *
 * Uruchamiany przez launchd co ~5 min (com.gaca.linkedin-goldenhour).
 *   node golden-hour.mjs          # jeden przebieg
 *   node golden-hour.mjs --dry    # nic nie wysyłaj/nie zapisuj (podgląd)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const BRAND_VOICE_PATH = join(homedir(), '.linkedin-mcp', 'brand-voice.json');
const PUSH_URL = process.env.GOLDEN_HOUR_PUSH_URL || '';
const DRY = process.argv.includes('--dry');

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

const brand = (() => { try { return JSON.parse(readFileSync(BRAND_VOICE_PATH, 'utf8')); } catch { return {}; } })();
const GOLDEN_MIN = Number(brand.golden_hour_minutes ?? brand.algorithm?.golden_hour_minutes ?? 60);
const WARNING_AT = Math.max(5, GOLDEN_MIN - 10); // ostrzeżenie ~10 min przed końcem

function postUrl(urn) {
  if (!urn) return 'https://www.linkedin.com/in/me/recent-activity/all/';
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

function hookOf(text) {
  const firstLine = String(text || '').split('\n').find(l => l.trim()) || '';
  return firstLine.trim().slice(0, 80);
}

// ── Push: macOS notification (zawsze) + opcjonalny webhook na telefon ──────────
function pushLocal(title, body) {
  try {
    const script = `display notification ${JSON.stringify(String(body))} with title ${JSON.stringify(String(title))}`;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch {}
}
async function pushWebhook(title, body, url) {
  if (!PUSH_URL) return;
  try {
    await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Title': title },
      body: JSON.stringify({ title, body, url, message: `${title}\n${body}\n${url}` }),
    });
  } catch (e) { log(`  webhook push błąd: ${e.message}`); }
}
async function push(title, body, url) {
  log(`  PUSH: ${title} — ${body}`);
  if (DRY) return;
  pushLocal(title, `${body}\n${url}`);
  await pushWebhook(title, body, url);
}

// ── Szybki sweep propozycji odpowiedzi (nie blokuje; osobny proces) ────────────
function triggerReplySweep() {
  if (DRY) { log('  (--dry: pomijam reply sweep)'); return; }
  try {
    const child = spawn(process.execPath, [join(__dirname, 'auto-notify.mjs'), '--once'], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
    log('  reply sweep odpalony (auto-notify.mjs --once)');
  } catch (e) { log(`  reply sweep błąd: ${e.message}`); }
}

function main() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS golden_hour (
    post_id TEXT PRIMARY KEY,
    post_urn TEXT,
    published_at TEXT,
    start_sent INTEGER DEFAULT 0,
    warning_sent INTEGER DEFAULT 0,
    sweeps INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  const now = Date.now();
  // published_at jest zapisywane jako ISO UTC ("2026-06-19T06:04:59.075Z"),
  // więc próg liczymy też w ISO (porównanie leksykalne ISO UTC jest poprawne).
  const cutoffIso = new Date(now - (GOLDEN_MIN + 5) * 60000).toISOString();
  const rows = db.prepare(`
    SELECT id, text, post_urn, published_at FROM scheduled_posts
    WHERE status='published' AND published_at IS NOT NULL
      AND published_at >= ?
    ORDER BY published_at DESC
  `).all(cutoffIso);

  log(`Golden Hour — okno ${GOLDEN_MIN} min — ${rows.length} świeżo opublikowanych post(ów)${DRY ? ' (DRY)' : ''}`);

  let actions = 0;
  const tasks = [];
  for (const post of rows) {
    const elapsedMin = Math.round((now - new Date(post.published_at).getTime()) / 60000);
    if (Number.isNaN(elapsedMin) || elapsedMin < 0 || elapsedMin > GOLDEN_MIN) continue;

    const st = db.prepare('SELECT * FROM golden_hour WHERE post_id=?').get(post.id)
      || { start_sent: 0, warning_sent: 0, sweeps: 0 };
    const url = postUrl(post.post_urn);
    const hook = hookOf(post.text);

    // 1) START
    if (!st.start_sent) {
      tasks.push(push('🔥 GOLDEN HOUR START', `Odpisuj na komentarze przez ${GOLDEN_MIN} min. „${hook}…"`, url));
      triggerReplySweep();
      if (!DRY) db.prepare(`INSERT INTO golden_hour (post_id, post_urn, published_at, start_sent, sweeps, updated_at)
        VALUES (?,?,?,1,1,datetime('now'))
        ON CONFLICT(post_id) DO UPDATE SET start_sent=1, sweeps=sweeps+1, updated_at=datetime('now')`)
        .run(post.id, post.post_urn, post.published_at);
      actions++;
      log(`  ▶ START  ${post.id.slice(0, 8)} (t+${elapsedMin}min)`);
    }
    // 2) WARNING (~10 min przed końcem)
    else if (!st.warning_sent && elapsedMin >= WARNING_AT) {
      tasks.push(push('⏳ Golden hour kończy się', `~${GOLDEN_MIN - elapsedMin} min do końca — domknij wątki. „${hook}…"`, url));
      triggerReplySweep();
      if (!DRY) db.prepare(`UPDATE golden_hour SET warning_sent=1, sweeps=sweeps+1, updated_at=datetime('now') WHERE post_id=?`)
        .run(post.id);
      actions++;
      log(`  ⏳ WARNING ${post.id.slice(0, 8)} (t+${elapsedMin}min)`);
    } else {
      log(`  · ${post.id.slice(0, 8)} t+${elapsedMin}min (start=${st.start_sent} warn=${st.warning_sent}) — nic`);
    }
  }

  Promise.all(tasks).finally(() => { db.close(); log(`Koniec — ${actions} akcji.`); });
}

main();
