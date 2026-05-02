#!/usr/bin/env node
/**
 * LinkedIn OAuth re-auth CLI runner.
 *
 * Reuses startAuth() from dist/api/auth.js. Prints the consent URL,
 * starts the localhost:8585 callback server, and exits when tokens are saved.
 *
 * Usage:
 *   node scripts/refresh-auth.mjs                                # default scopes
 *   node scripts/refresh-auth.mjs "openid profile w_member_social r_member_postAnalytics"
 */

import { startAuth } from '../dist/api/auth.js';

const customScopes = process.argv[2];
const scopes = customScopes
  ? customScopes.split(/\s+/).filter(Boolean)
  : ['openid', 'profile', 'email', 'w_member_social', 'r_member_postAnalytics'];

console.log('\nLinkedIn OAuth refresh');
console.log('  Requested scopes:', scopes.join(' '));

let result;
try {
  result = startAuth(scopes);
} catch (err) {
  console.error('\nFAILED to start auth:', err instanceof Error ? err.message : err);
  console.error('Check that LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are set in .env');
  process.exit(1);
}

console.log('\n──────────────────────────────────────────────────────────────────');
console.log('  Open this URL in your browser:');
console.log('');
console.log('  ' + result.auth_url);
console.log('');
console.log('  After approving, LinkedIn will redirect to localhost:8585/callback');
console.log('  and tokens will be saved to ~/.linkedin-mcp/auth.json');
console.log('──────────────────────────────────────────────────────────────────\n');

// startAuth() registers a callback server with a 5-min timeout that closes itself.
// Keep the process alive until the server closes.
console.log('Waiting for callback (timeout: 5 min)…');
