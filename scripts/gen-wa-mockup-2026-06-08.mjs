#!/usr/bin/env node
/**
 * Mockup dashboardu WhatsApp inbox dla scheduled post id 7bc9fd9d
 * (post "Mam asystenta na WhatsApp..." na 2026-06-08 09:00 UTC).
 *
 * Anonimizacja: wszystkie imiona / nazwiska / numery telefonów są FIKCYJNE.
 * Layout naśladuje style ownerowego admin-panel (dark theme, 3-col), ale
 * dane są syntetyczne — zero PII.
 *
 * Output: /Users/gaca/output/personal/linkedin-mcp/wa-assistant-2026-06-08.png
 *         (1200×627, LinkedIn feed landscape optimal)
 *
 * Side-effect: UPDATE scheduled_posts SET media_preview_path=?, media_kind='image'
 *              WHERE id='7bc9fd9d-d7a5-412f-b238-a4fc667907ae'
 *
 * Usage:
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/gen-wa-mockup-2026-06-08.mjs
 *   ~/.nvm/versions/node/v22.22.0/bin/node scripts/gen-wa-mockup-2026-06-08.mjs --no-db
 */

import puppeteer from '/Users/gaca/projects/personal/linkedin-mcp-server/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

const OUTPUT_DIR = '/Users/gaca/output/personal/linkedin-mcp';
const OUTPUT_FILE = join(OUTPUT_DIR, 'wa-assistant-2026-06-08.png');
const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const POST_ID = '7bc9fd9d-d7a5-412f-b238-a4fc667907ae';
const SKIP_DB = process.argv.includes('--no-db');

const WIDTH = 1200;
const HEIGHT = 627;

// ── Synthetic data (zero PII) ──────────────────────────────────────────────

const INBOX = [
  { name: 'Tomasz K.', preview: 'Cześć! Ile za audyt automatyzacji dla 6-osobowej firmy?', when: '5min', active: true, kind: 'phone', label: '+48 *** *** 234' },
  { name: 'Andrzej W.', preview: 'Mam mały sklep online, pytania o RAG i FAQ', when: '23min', kind: 'phone', label: '+48 *** *** 781' },
  { name: 'Magda S.', preview: 'Dziękuję za odpowiedź wieczorem!', when: '1h', kind: 'phone', label: '+48 *** *** 109' },
  { name: 'Krzysztof L.', preview: 'Wysyłam pdf z procesem księgowym do analizy', when: '3h', kind: 'phone', label: '+48 *** *** 552' },
  { name: 'Klub MŚP Wrocław', preview: '↗ Dzień dobry Bartoszu, czy mógłby Pan...', when: '8h', kind: 'group', label: 'grupa' },
  { name: 'Joanna M.', preview: 'Super, w czwartek 14:00 mi pasuje', when: '12h', kind: 'phone', label: '+48 *** *** 410' },
  { name: 'Paweł D.', preview: 'Czy zrobisz to dla branży kosmetycznej?', when: '1d', kind: 'phone', label: '+48 *** *** 037' },
];

const CONV = {
  name: 'Tomasz K.',
  label: '+48 *** *** 234',
  msgs: [
    { role: 'them', text: 'Cześć! Widziałem Pana stronę. Ile kosztuje audyt automatyzacji dla 6-osobowej firmy?', when: '17:32' },
    { role: 'bot', text: 'Cześć! Sam audyt jest free — 30-min konsultacja z Bartkiem, umawiasz na bartoszgaca.pl. Co konkretnie u Was zjada najwięcej czasu?', when: '17:32', badge: 'AI · 2.1s' },
    { role: 'them', text: 'Faktury wracają z błędami i nikt nie ogarnia odpowiedzi na WhatsApp. To by się dało?', when: '17:35' },
    { role: 'bot', text: 'Tak. Bot WhatsApp pod FAQ to 300-800 zł/msc, automatyzacja faktur 3-8 tys/msc, wdrożenie 1-2 tygodnie. Rzuć 30 min na bartoszgaca.pl, Bartek powie konkretnie ile w Waszym przypadku.', when: '17:35', badge: 'AI · 1.8s' },
    { role: 'them', text: 'Ok, umówię się', when: '17:48' },
  ],
};

// ── HTML template ──────────────────────────────────────────────────────────

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inboxRowHtml = (r) => `
  <div class="inbox-row${r.active ? ' active' : ''}">
    <div class="avatar ${r.kind === 'group' ? 'group' : 'phone'}">${r.kind === 'group' ? '👥' : '📱'}</div>
    <div class="row-body">
      <div class="row-top">
        <span class="row-name">${escape(r.name)}</span>
        <span class="row-time">${r.when}</span>
      </div>
      <div class="row-preview">${escape(r.preview)}</div>
      <div class="row-label">${escape(r.label)}</div>
    </div>
  </div>
`;

const msgHtml = (m) => {
  if (m.role === 'them') {
    return `
      <div class="msg-row them">
        <div class="msg-bubble them">
          <div class="msg-text">${escape(m.text)}</div>
          <div class="msg-time">${m.when}</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="msg-row bot">
      <div class="msg-bubble bot">
        <div class="msg-text">${escape(m.text)}</div>
        <div class="msg-meta">
          <span class="msg-badge">${m.badge}</span>
          <span class="msg-time">${m.when}</span>
        </div>
      </div>
    </div>
  `;
};

const html = `
<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    background: #0b1220; color: #d8def0;
    display: flex; overflow: hidden;
    font-size: 13px;
  }
  /* Sidebar */
  .sidebar {
    width: 215px; padding: 18px 16px;
    background: #0b1220; border-right: 1px solid #1a253c;
    display: flex; flex-direction: column; gap: 14px;
  }
  .brand { color: #3b82f6; font-size: 17px; font-weight: 700; }
  .brand-sub { color: #6b7790; font-size: 11px; margin-top: -8px; }
  .nav-section { font-size: 10px; letter-spacing: 0.08em; color: #6b7790; text-transform: uppercase; margin-top: 6px; }
  .nav-item {
    padding: 7px 10px; border-radius: 8px; display: flex; align-items: center;
    gap: 9px; color: #b6becf; cursor: pointer; font-size: 13px;
  }
  .nav-item.active { background: #1d3a7a; color: #cee0ff; }
  .nav-icon { font-size: 13px; }
  .agent-box {
    background: #131c2f; border: 1px solid #1d2942; border-radius: 10px;
    padding: 9px 11px; color: #6ea4ff; font-weight: 600; font-size: 11.5px;
    display: flex; align-items: center; gap: 7px; margin-top: 4px;
  }
  /* Middle column - inbox list */
  .inbox-col {
    width: 415px; border-right: 1px solid #1a253c;
    display: flex; flex-direction: column;
  }
  .inbox-header { padding: 13px 14px 10px; border-bottom: 1px solid #1a253c; }
  .search { background: #131c2f; border-radius: 22px; padding: 8px 14px; color: #6b7790; font-size: 12px; }
  .filters { display: flex; gap: 6px; margin-top: 9px; }
  .filter { padding: 4px 11px; border-radius: 999px; font-size: 11px; background: #131c2f; color: #8a93ad; }
  .filter.active { background: #2563eb; color: #fff; font-weight: 600; }
  .inbox-count { color: #5b6379; font-size: 10.5px; margin-top: 6px; font-style: italic; }
  .inbox-list { flex: 1; overflow: hidden; }
  .inbox-row {
    display: flex; gap: 9px; padding: 10px 13px;
    border-bottom: 1px solid #131b30; align-items: flex-start;
  }
  .inbox-row.active { background: rgba(37, 99, 235, 0.06); border-left: 2px solid #2563eb; padding-left: 11px; }
  .avatar {
    width: 26px; height: 26px; border-radius: 6px; background: #1c2842;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
    flex-shrink: 0;
  }
  .row-body { flex: 1; min-width: 0; }
  .row-top { display: flex; justify-content: space-between; align-items: baseline; }
  .row-name { font-weight: 600; color: #e6eaf5; font-size: 12.5px; }
  .row-time { color: #5b6379; font-size: 10px; }
  .row-preview {
    color: #8a93ad; font-size: 11px; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 350px;
  }
  .row-label { color: #4a5470; font-size: 9.5px; margin-top: 2px; font-family: 'JetBrains Mono', monospace; }
  /* Right column - conversation */
  .conv-col { flex: 1; display: flex; flex-direction: column; }
  .conv-header {
    padding: 11px 16px; border-bottom: 1px solid #1a253c;
    display: flex; align-items: center; gap: 11px;
  }
  .conv-avatar { width: 32px; height: 32px; border-radius: 8px; background: #1c2842; display: flex; align-items: center; justify-content: center; font-size: 16px; }
  .conv-name { font-weight: 700; color: #e6eaf5; font-size: 13px; }
  .conv-label { font-size: 10.5px; color: #6b7790; margin-top: 1px; font-family: 'JetBrains Mono', monospace; }
  .conv-msgs {
    flex: 1; padding: 12px 18px;
    display: flex; flex-direction: column; gap: 8px;
    overflow: hidden;
  }
  .msg-row { display: flex; }
  .msg-row.them { justify-content: flex-start; }
  .msg-row.bot { justify-content: flex-end; }
  .msg-bubble {
    max-width: 70%; padding: 8px 11px; border-radius: 12px;
    font-size: 11.5px; line-height: 1.4;
  }
  .msg-bubble.them { background: #1a2540; color: #c9d2e5; border-bottom-left-radius: 4px; }
  .msg-bubble.bot { background: #1d6f3a; color: #d8f5d8; border-bottom-right-radius: 4px; }
  .msg-meta { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 4px; }
  .msg-time { font-size: 9.5px; color: #6b7790; }
  .msg-bubble.bot .msg-time { color: #a8d5b0; }
  .msg-badge {
    font-size: 9px; background: rgba(255,255,255,0.12); padding: 2px 7px;
    border-radius: 999px; color: #d8f5d8; font-weight: 600; letter-spacing: 0.03em;
  }
  .conv-input {
    padding: 9px 16px; border-top: 1px solid #1a253c;
    display: flex; gap: 8px; align-items: center;
  }
  .input-box { flex: 1; background: #131c2f; padding: 8px 13px; border-radius: 10px; color: #5b6379; font-size: 11.5px; }
  .input-btn { background: #7c3aed; color: white; padding: 7px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 600; }
  .input-btn.secondary { background: #b04a2a; }
</style>
</head>
<body>
  <aside class="sidebar">
    <div>
      <div class="brand">Admin Panel</div>
      <div class="brand-sub">bartoszgaca.pl</div>
    </div>
    <div class="agent-box">🤖 AGENT WA / SMS / EMAIL</div>
    <div class="nav-section">Główne</div>
    <div class="nav-item active"><span class="nav-icon">📥</span>Inbox</div>
    <div class="nav-item"><span class="nav-icon">👥</span>Kontakty</div>
    <div class="nav-item"><span class="nav-icon">📤</span>Wyślij (AI)</div>
    <div class="nav-item"><span class="nav-icon">⏰</span>Zaplanowane</div>
    <div class="nav-section">Konfiguracja</div>
    <div class="nav-item"><span class="nav-icon">⚙️</span>Ustawienia</div>
    <div class="nav-item"><span class="nav-icon">📱</span>WhatsApp (QR)</div>
  </aside>

  <div class="inbox-col">
    <div class="inbox-header">
      <div class="search">🔍 Szukaj...</div>
      <div class="filters">
        <span class="filter active">Wszystkie</span>
        <span class="filter">Lead</span>
        <span class="filter">Hot</span>
        <span class="filter">Klient</span>
      </div>
      <div class="inbox-count">200 z 200</div>
    </div>
    <div class="inbox-list">
      ${INBOX.map(inboxRowHtml).join('')}
    </div>
  </div>

  <div class="conv-col">
    <div class="conv-header">
      <div class="conv-avatar">📱</div>
      <div>
        <div class="conv-name">${escape(CONV.name)}</div>
        <div class="conv-label">${escape(CONV.label)} · WhatsApp</div>
      </div>
    </div>
    <div class="conv-msgs">
      ${CONV.msgs.map(msgHtml).join('')}
    </div>
    <div class="conv-input">
      <div class="input-box">Napisz wiadomość... (Cmd+Enter = wyślij)</div>
      <div class="input-btn">✨ Generuj AI</div>
      <div class="input-btn secondary">⏰ Zaplanuj</div>
    </div>
  </div>
</body>
</html>
`;

// ── Render ─────────────────────────────────────────────────────────────────

mkdirSync(OUTPUT_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: OUTPUT_FILE, type: 'png' });
} finally {
  await browser.close();
}

console.log(`[gen] Image written: ${OUTPUT_FILE}`);

if (!SKIP_DB) {
  const db = new Database(DB_PATH);
  const r = db
    .prepare(
      `UPDATE scheduled_posts
       SET media_preview_path = ?, media_kind = 'image', updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(OUTPUT_FILE, POST_ID);
  console.log(`[gen] DB updated · changes=${r.changes} · post_id=${POST_ID}`);
  db.close();
}
