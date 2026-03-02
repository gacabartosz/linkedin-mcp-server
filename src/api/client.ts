import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../utils/config.js";
import { LinkedInApiError, toolError } from "../utils/errors.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { log } from "../utils/logger.js";

interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: string;
  refresh_token_expires_at?: string;
  person_urn: string;
  user_name: string;
  scopes: string[];
}

let cachedTokens: AuthTokens | null = null;

export function loadTokens(): AuthTokens | null {
  if (cachedTokens) return cachedTokens;

  // Manual token mode
  if (config.linkedinAccessToken) {
    cachedTokens = {
      access_token: config.linkedinAccessToken,
      person_urn: config.linkedinPersonUrn,
      user_name: "Manual Token",
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      scopes: ["w_member_social"],
    };
    return cachedTokens;
  }

  try {
    const data = readFileSync(config.authFile, "utf-8");
    cachedTokens = JSON.parse(data) as AuthTokens;
    return cachedTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: AuthTokens): void {
  writeFileSync(config.authFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  cachedTokens = tokens;
}

export function clearTokenCache(): void {
  cachedTokens = null;
}

export function getPersonUrn(): string {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Not authenticated. Run linkedin_auth_start first.");
  return tokens.person_urn;
}

export async function linkedinRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Not authenticated. Run linkedin_auth_start first.");

  const url = path.startsWith("https://")
    ? path
    : `https://api.linkedin.com/rest${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access_token}`,
    "LinkedIn-Version": config.apiVersion,
    "X-Restli-Protocol-Version": "2.0.0",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  log("info", `LinkedIn API ${method} ${path}`);

  const response = await fetchWithTimeout(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && tokens.refresh_token) {
    log("warn", "Token expired, attempting refresh");
    const refreshed = await refreshAccessToken(tokens);
    if (refreshed) {
      return linkedinRequest(method, path, body);
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ status: response.status }));
    throw new LinkedInApiError(response.status, errorBody);
  }

  if (response.status === 204) return {} as T;

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function linkedinUploadBinary(
  uploadUrl: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Not authenticated.");

  const response = await fetchWithTimeout(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": contentType,
    },
    body: new Uint8Array(buffer),
    timeoutMs: 120_000,
  });

  if (!response.ok) {
    throw new LinkedInApiError(response.status, { message: "Binary upload failed" });
  }
}

async function refreshAccessToken(tokens: AuthTokens): Promise<boolean> {
  if (!tokens.refresh_token || !config.linkedinClientId) return false;

  try {
    const response = await fetchWithTimeout("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: config.linkedinClientId,
        client_secret: config.linkedinClientSecret,
      }),
    });

    if (!response.ok) return false;

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    const updated: AuthTokens = {
      ...tokens,
      access_token: data.access_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      ...(data.refresh_token ? {
        refresh_token: data.refresh_token,
        refresh_token_expires_at: data.refresh_token_expires_in
          ? new Date(Date.now() + data.refresh_token_expires_in * 1000).toISOString()
          : tokens.refresh_token_expires_at,
      } : {}),
    };

    saveTokens(updated);
    log("info", "Token refreshed successfully");
    return true;
  } catch (err) {
    log("error", "Token refresh failed", err);
    return false;
  }
}
