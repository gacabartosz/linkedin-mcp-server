#!/usr/bin/env node
/**
 * Faza 1 — autoryzacja apki Community Management API (12 scope'ów).
 *
 * Dlaczego osobny skrypt, a nie narzędzie MCP: `linkedin_auth_start` w serwerze
 * MCP obsługuje wyłącznie apkę osobistą (parametr `app` nie jest jeszcze
 * zaimplementowany), a działający proces serwera i tak trzyma starą konfigurację.
 * Ten skrypt używa gotowego startOrgAuth() z dist/api/auth.js.
 *
 * Co robi:
 *   1. buduje URL zgody z 12 scope'ami i client_id apki org
 *   2. podnosi lokalny serwer callback na :8586
 *   3. czeka, aż klikniesz zgodę w przeglądarce
 *   4. wymienia code na token i zapisuje ~/.linkedin-mcp/org-auth.json
 *
 * Nie loguję się za Ciebie — zgodę klikasz Ty.
 *
 * Użycie: node scripts/org-auth.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../dist/utils/config.js';
import { startOrgAuth } from '../dist/api/auth.js';

const ORG_AUTH = join(config.dataDir, 'org-auth.json');

if (!config.linkedinOrgClientId || !config.linkedinOrgClientSecret) {
  console.error('Brak LINKEDIN_ORG_CLIENT_ID / LINKEDIN_ORG_CLIENT_SECRET w .env.');
  process.exit(1);
}

console.log('Faza 1 — autoryzacja apki Community Management API\n');
console.log(`  client_id:  ${config.linkedinOrgClientId}`);
console.log(`  callback:   http://localhost:${config.orgCallbackPort}/callback`);
console.log(`  scope'ów:   ${config.orgScopes.length}`);
console.log(`  token ->    ${ORG_AUTH}\n`);

const { auth_url } = startOrgAuth(config.orgScopes);

console.log('─'.repeat(78));
console.log('OTWÓRZ TEN LINK W PRZEGLĄDARCE I KLIKNIJ ZGODĘ:\n');
console.log(auth_url);
console.log('\n' + '─'.repeat(78));
console.log(`\nCzekam na callback (max ${config.oauthTimeoutMs / 60000} min)...`);
console.log('Jeśli LinkedIn pokaże błąd o redirect_uri — brakuje');
console.log(`http://localhost:${config.orgCallbackPort}/callback w Auth > Authorized redirect URLs.\n`);

// Serwer callback z startOrgAuth() zapisuje token sam. Pollujemy plik, żeby
// dać jasny komunikat i nie trzymać procesu dłużej, niż trzeba.
const deadline = Date.now() + config.oauthTimeoutMs;
const timer = setInterval(() => {
  if (existsSync(ORG_AUTH)) {
    clearInterval(timer);
    const t = JSON.parse(readFileSync(ORG_AUTH, 'utf8'));
    console.log('\n✅ TOKEN ZAPISANY');
    console.log(`   użytkownik:     ${t.user_name}`);
    console.log(`   wygasa:         ${t.expires_at}`);
    console.log(`   refresh_token:  ${t.refresh_token ? 'JEST — koniec ręcznego odnawiania' : 'BRAK — LinkedIn go nie przyznał'}`);
    console.log(`   scope'ów:       ${(t.scopes || []).length}/${config.orgScopes.length}`);
    const granted = new Set(t.scopes || []);
    const missing = config.orgScopes.filter((s) => !granted.has(s));
    if (missing.length) console.log(`   NIE PRZYZNANE:  ${missing.join(', ')}`);
    else console.log('   wszystkie scope\'y przyznane');
    console.log('\nNastępny krok: node scripts/api-probe.mjs --app org');
    process.exit(0);
  }
  if (Date.now() > deadline) {
    clearInterval(timer);
    console.error('\n❌ Timeout — token nie dotarł. Uruchom ponownie.');
    process.exit(1);
  }
}, 1500);
