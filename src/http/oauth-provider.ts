/**
 * OAuth 2.1 Server Provider for MCP.
 * Implements OAuthServerProvider interface from @modelcontextprotocol/sdk.
 * Uses SQLite for persistence. Single-user; every authorization needs MCP_OAUTH_PIN.
 */

import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";
import * as store from "./oauth-store.js";
import { timingSafeEqual } from "node:crypto";

// ── Clients Store ─────────────────────────────────────────────────────────────

class SqliteClientsStore implements OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const c = store.getClient(clientId);
    if (!c) return undefined;
    return {
      client_id: c.client_id,
      client_secret: c.client_secret,
      client_name: c.client_name,
      redirect_uris: JSON.parse(c.redirect_uris) as string[],
      grant_types: JSON.parse(c.grant_types) as string[],
      response_types: JSON.parse(c.response_types) as string[],
      scope: c.scope,
      token_endpoint_auth_method: c.token_endpoint_auth_method,
      client_id_issued_at: c.client_id_issued_at,
      client_secret_expires_at: c.client_secret_expires_at,
    };
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    // SDK pre-generates client_id/secret when clientIdGeneration=true
    // The runtime object may have these fields despite the TypeScript Omit type
    const fullClient = client as OAuthClientInformationFull;
    const clientId = fullClient.client_id || undefined;
    const clientSecret = fullClient.client_secret || undefined;

    try {
      const registered = store.registerClient({
        client_id: clientId,
        client_secret: clientSecret,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        client_secret_expires_at: fullClient.client_secret_expires_at,
      });
      const result = this.getClient(registered.client_id);
      if (!result) {
        log("error", `registerClient: saved but getClient returned null for ${registered.client_id}`);
        throw new Error("Failed to read back registered client");
      }
      log("info", `Client registered: ${result.client_id}`);
      return result;
    } catch (err) {
      log("error", `registerClient failed: ${(err as Error).message}`, (err as Error).stack);
      throw err;
    }
  }
}

// ── Approval page ─────────────────────────────────────────────────────────────

function pinMatches(submitted: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(config.mcpOAuthPin);
  return a.length === b.length && timingSafeEqual(a, b);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function approvalPage(client: OAuthClientInformationFull, params: AuthorizationParams): string {
  const hidden: Record<string, string | undefined> = {
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    response_type: "code",
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
    scope: params.scopes?.join(" ") || undefined,
    resource: params.resource?.toString(),
  };
  const inputs = Object.entries(hidden)
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v!)}">`)
    .join("\n  ");
  return `<!DOCTYPE html>
<html><head><title>LinkedIn MCP — Authorize</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 20px; background: #0a0f1a; color: #e0e8f0; }
h1 { font-size: 1.3em; color: #38bdf8; }
p { color: #94a3b8; line-height: 1.5; }
input[type=password] { width: 100%; box-sizing: border-box; padding: 12px; font-size: 18px; border: 2px solid #1e293b; border-radius: 8px; background: #0f172a; color: #e0e8f0; text-align: center; letter-spacing: 4px; }
button { width: 100%; margin-top: 16px; padding: 12px; font-size: 16px; background: #38bdf8; color: #0a0f1a; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
</style></head><body>
<h1>LinkedIn MCP</h1>
<p>Client <strong>${esc(client.client_name || client.client_id)}</strong> wants access to all LinkedIn MCP tools, including posting and messaging.</p>
<form method="GET" action="">
  ${inputs}
  <input type="password" name="pin" placeholder="PIN" autocomplete="off" autofocus required>
  <button type="submit">Authorize</button>
</form>
</body></html>`;
}

// ── OAuth Provider ────────────────────────────────────────────────────────────

export class LinkedInOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new SqliteClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const { state, codeChallenge, redirectUri, scopes, resource } = params;

    // Always require the PIN, loopback included: a top-level navigation from
    // any website arrives from 127.0.0.1 with a localhost Host, so the source
    // address proves nothing here. Local clients use /mcp without OAuth anyway.
    if (!config.mcpOAuthPin) {
      res.status(403).type("text/plain").send("OAuth authorization is disabled. Set MCP_OAUTH_PIN to enable it.");
      return;
    }
    const submittedPin = typeof res.req.query.pin === "string" ? res.req.query.pin : "";
    if (!pinMatches(submittedPin)) {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      res.status(200).type("html").send(approvalPage(client, params));
      return;
    }

    // Approved — generate auth code
    const code = store.createAuthCode({
      clientId: client.client_id,
      codeChallenge,
      redirectUri,
      scope: scopes?.join(" ") || "mcp:tools",
      resource: resource?.toString(),
    });

    // Redirect back to client with code
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);

    log("info", `OAuth authorized: client=${client.client_id}, code=${code.substring(0, 8)}...`);
    res.redirect(302, redirect.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const authCode = store.getAuthCode(authorizationCode);
    if (!authCode) throw new Error("Invalid authorization code");
    return authCode.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const authCode = store.getAuthCode(authorizationCode);
    if (!authCode) throw new Error("Invalid authorization code");
    if (authCode.client_id !== client.client_id) throw new Error("Client mismatch");
    if (authCode.expires_at < Math.floor(Date.now() / 1000)) throw new Error("Authorization code expired");

    // Delete used code
    store.deleteAuthCode(authorizationCode);

    // Generate tokens
    const tokens = store.createTokens(client.client_id, authCode.scope, resource?.toString());

    log("info", `OAuth token issued: client=${client.client_id}`);
    return {
      access_token: tokens.accessToken,
      token_type: "bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: authCode.scope,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const rt = store.getRefreshToken(refreshToken);
    if (!rt) throw new Error("Invalid refresh token");
    if (rt.client_id !== client.client_id) throw new Error("Client mismatch");

    // Revoke old tokens
    store.revokeToken(rt.access_token);
    store.revokeToken(refreshToken);

    // Issue new tokens
    const scope = scopes?.join(" ") || rt.scope;
    const tokens = store.createTokens(client.client_id, scope, resource?.toString());

    log("info", `OAuth token refreshed: client=${client.client_id}`);
    return {
      access_token: tokens.accessToken,
      token_type: "bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const t = store.verifyToken(token);
    if (!t) throw new Error("Invalid or expired access token");

    return {
      token,
      clientId: t.client_id,
      scopes: t.scope.split(" ").filter(Boolean),
      expiresAt: t.expires_at,
      ...(t.resource ? { resource: new URL(t.resource) } : {}),
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    store.revokeToken(request.token);
    log("info", `OAuth token revoked`);
  }
}
