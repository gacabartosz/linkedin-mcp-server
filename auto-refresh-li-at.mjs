#!/usr/bin/env node
/**
 * Auto-refresh li_at cookie z Chrome na macOS
 *
 * Chrome szyfruje ciasteczka AES-128-CBC kluczem z macOS Keychain.
 * Ten skrypt: czyta klucz → odszyfrowuje li_at → zapisuje do scraper-auth.json
 *
 * Wymaga: macOS + Chrome zalogowany na LinkedIn
 * Nie wymaga: haseł, Puppeteer, zewnętrznych serwisów
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import Database from 'better-sqlite3';

const SCRAPER_AUTH = join(homedir(), '.linkedin-mcp', 'scraper-auth.json');
const CHROME_COOKIES = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Cookies');
const CHROME_COOKIES_ALT = [
  join(homedir(), 'Library/Application Support/Google/Chrome/Profile 1/Cookies'),
  join(homedir(), 'Library/Application Support/Google/Chrome/Profile 2/Cookies'),
  join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies'),
];

const log = msg => console.log(`[li-at-refresh] ${new Date().toISOString().slice(11,19)} ${msg}`);

// ── 1. Pobierz klucz szyfrowania z macOS Keychain ───────────────────────────

function getChromeKey() {
  try {
    const raw = execSync(
      'security find-generic-password -w -a Chrome -s "Chrome Safe Storage"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    // Chrome używa PBKDF2 z hasłem z Keychain, salt='saltysalt', iter=1003, keylen=16
    const key = pbkdf2Sync(raw, 'saltysalt', 1003, 16, 'sha1');
    return key;
  } catch (e) {
    throw new Error(`Keychain error: ${e.message}`);
  }
}

// ── 2. Odszyfruj ciasteczko Chrome (AES-128-CBC, prefix v10) ────────────────

function decryptCookie(encryptedValue, key) {
  try {
    if (!encryptedValue || encryptedValue.length < 3) return null;
    // Chrome encrypted cookies mają prefix 'v10' (3 bajty)
    const buf = Buffer.isBuffer(encryptedValue) ? encryptedValue : Buffer.from(encryptedValue);
    if (buf.slice(0, 3).toString() !== 'v10') {
      // Może być plaintext (stare sesje)
      return buf.toString('utf-8');
    }
    const iv = Buffer.alloc(16, ' '); // Chrome używa ' ' * 16 jako IV
    const payload = buf.slice(3);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    let decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}

// ── 3. Czytaj ciasteczka z SQLite Chrome ────────────────────────────────────

function readLiAt(cookiesPath, key) {
  // Chrome może trzymać lock na pliku — kopiujemy do /tmp
  const tmpPath = join(tmpdir(), `chrome-cookies-${Date.now()}.db`);
  try {
    copyFileSync(cookiesPath, tmpPath);
    const db = new Database(tmpPath, { readonly: true });
    // Szukaj li_at dla linkedin.com
    const rows = db.prepare(
      `SELECT name, encrypted_value, value FROM cookies
       WHERE host_key LIKE '%linkedin.com%' AND name = 'li_at'
       ORDER BY creation_utc DESC LIMIT 1`
    ).all();
    db.close();

    if (!rows.length) return null;
    const row = rows[0];
    // Spróbuj odszyfrować
    const decrypted = decryptCookie(row.encrypted_value, key);
    if (decrypted && decrypted.length > 50) return decrypted;
    // Fallback: value plaintext
    if (row.value && row.value.length > 50) return row.value;
    return null;
  } catch (e) {
    log(`  SQLite error (${cookiesPath}): ${e.message}`);
    return null;
  } finally {
    try { execSync(`rm -f "${tmpPath}"`); } catch {}
  }
}

// ── 4. Sprawdź aktualny li_at i porównaj ────────────────────────────────────

function getCurrentLiAt() {
  try {
    const d = JSON.parse(readFileSync(SCRAPER_AUTH, 'utf-8'));
    return d.li_at || null;
  } catch { return null; }
}

function saveLiAt(liAt) {
  const now = new Date().toISOString();
  const data = {
    li_at: liAt,
    tos_acknowledged: true,
    updated_at: now,
    source: 'auto-chrome-extract',
  };
  writeFileSync(SCRAPER_AUTH, JSON.stringify(data, null, 2), { mode: 0o600 });
  log(`✅ Zapisano nowy li_at (${liAt.length} znaków) → ${SCRAPER_AUTH}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function refreshLiAt() {
  log('Sprawdzam li_at w Chrome...');

  let key;
  try {
    key = getChromeKey();
    log('  Klucz z Keychain: OK');
  } catch (e) {
    log(`  ❌ ${e.message}`);
    process.exit(1);
  }

  // Znajdź plik Cookies
  const cookiePaths = [CHROME_COOKIES, ...CHROME_COOKIES_ALT].filter(p => existsSync(p));
  log(`  Znaleziono ${cookiePaths.length} plików cookies Chrome`);

  let newLiAt = null;
  for (const p of cookiePaths) {
    log(`  Czytam: ${p}`);
    newLiAt = readLiAt(p, key);
    if (newLiAt) { log(`  li_at znaleziony (${newLiAt.length} znaków)`); break; }
  }

  if (!newLiAt) {
    log('❌ Nie znaleziono li_at. Czy jesteś zalogowany na LinkedIn w Chrome?');
    process.exit(1);
  }

  const current = getCurrentLiAt();
  if (current === newLiAt) {
    log('ℹ️  li_at nie zmienił się — brak potrzeby aktualizacji');
    return;
  }

  saveLiAt(newLiAt);
  log('🔄 li_at zaktualizowany pomyślnie');
}

refreshLiAt().catch(e => { log(`Błąd: ${e.message}`); process.exit(1); });
