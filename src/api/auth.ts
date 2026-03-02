import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "../utils/config.js";
import { saveTokens, clearTokenCache } from "./client.js";
import { log } from "../utils/logger.js";

interface OAuthState {
  state: string;
  resolve: (result: { success: boolean; error?: string }) => void;
}

let pendingAuth: OAuthState | null = null;

export function startAuth(scopes: string[]): { auth_url: string; state: string; instructions: string } {
  if (!config.linkedinClientId || !config.linkedinClientSecret) {
    throw new Error(
      "Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET environment variables. " +
      "Create a LinkedIn app at https://developer.linkedin.com/ and set these env vars."
    );
  }

  const state = randomBytes(16).toString("hex");
  const scopeStr = scopes.join(" ");
  const redirectUri = `http://localhost:${config.callbackPort}/callback`;

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.linkedinClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", scopeStr);

  // Start callback server
  startCallbackServer(state);

  return {
    auth_url: authUrl.toString(),
    state,
    instructions: `Open this URL in your browser to authorize:\n${authUrl.toString()}\n\nAfter authorizing, LinkedIn will redirect to localhost:${config.callbackPort} and tokens will be saved automatically.`,
  };
}

function startCallbackServer(expectedState: string): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${config.callbackPort}`);

    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
      server.close();
      if (pendingAuth) pendingAuth.resolve({ success: false, error });
      return;
    }

    if (!code || state !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Invalid callback</h1><p>State mismatch or missing code.</p></body></html>");
      return;
    }

    try {
      const tokens = await exchangeCode(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body><h1>LinkedIn MCP — Authorized!</h1>` +
        `<p>Welcome, ${tokens.user_name}!</p>` +
        `<p>Token expires: ${tokens.expires_at}</p>` +
        `<p>You can close this window.</p></body></html>`
      );
      log("info", `Auth success: ${tokens.user_name} (${tokens.person_urn})`);
      if (pendingAuth) pendingAuth.resolve({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<html><body><h1>Token Exchange Failed</h1><p>${msg}</p></body></html>`);
      if (pendingAuth) pendingAuth.resolve({ success: false, error: msg });
    }

    server.close();
  });

  server.listen(config.callbackPort, "127.0.0.1", () => {
    log("info", `OAuth callback server listening on http://localhost:${config.callbackPort}/callback`);
  });

  // Auto-close after 5 minutes
  setTimeout(() => {
    server.close();
    log("warn", "OAuth callback server timed out after 5 minutes");
  }, 300_000);
}

async function exchangeCode(code: string): Promise<{
  user_name: string;
  person_urn: string;
  expires_at: string;
}> {
  const redirectUri = `http://localhost:${config.callbackPort}/callback`;

  const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.linkedinClientId,
      client_secret: config.linkedinClientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope: string;
  };

  // Fetch user info
  const userResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  let userName = "LinkedIn User";
  let personUrn = "";

  if (userResponse.ok) {
    const userData = await userResponse.json() as {
      sub: string;
      name?: string;
      given_name?: string;
      family_name?: string;
    };
    userName = userData.name || `${userData.given_name || ""} ${userData.family_name || ""}`.trim();
    personUrn = `urn:li:person:${userData.sub}`;
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    refresh_token_expires_at: tokenData.refresh_token_expires_in
      ? new Date(Date.now() + tokenData.refresh_token_expires_in * 1000).toISOString()
      : undefined,
    person_urn: personUrn,
    user_name: userName,
    scopes: tokenData.scope.split(" "),
  };

  clearTokenCache();
  saveTokens(tokens);

  return { user_name: userName, person_urn: personUrn, expires_at: expiresAt };
}
