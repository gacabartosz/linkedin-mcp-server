/**
 * Streamable HTTP transport for the MCP server, mounted by the dashboard on
 * the same port (http://localhost:6767/mcp). Exposes every tool the stdio
 * server has. Loopback clients connect without a token; others use OAuth 2.1.
 */

import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

import { createMcpServer } from "../index.js";
import { config, ensureDataDirs } from "../utils/config.js";
import { log } from "../utils/logger.js";
import { LinkedInOAuthProvider } from "./oauth-provider.js";
import { cleanupExpired } from "./oauth-store.js";
import { isLoopbackRequest } from "./local.js";

/** Paths the dashboard should hand over to this app. */
export function isMcpPath(path: string): boolean {
  return path === "/mcp"
    || path.startsWith("/.well-known/oauth-")
    || ["/authorize", "/token", "/register", "/revoke"].includes(path);
}

export function createMcpHttpApp(): (req: IncomingMessage, res: ServerResponse) => void {
  ensureDataDirs();

  const app = express();
  const provider = new LinkedInOAuthProvider();
  const publicUrl = new URL(config.mcpPublicUrl);
  const mcpUrl = new URL("/mcp", publicUrl);

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: publicUrl,
    baseUrl: publicUrl,
    resourceServerUrl: mcpUrl,
    scopesSupported: ["mcp:tools"],
    resourceName: "LinkedIn MCP",
  }));

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });
  const auth = (req: Request, res: Response, next: NextFunction) =>
    isLoopbackRequest(req) ? next() : bearer(req, res, next);

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", auth, express.json({ limit: "4mb" }), async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    try {
      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (!transport) {
          res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (req.method !== "POST") {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "mcp-session-id header required" }, id: null });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, transport);
          log("info", `MCP HTTP session opened: ${sid}`);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          log("info", `MCP HTTP session closed: ${transport.sessionId}`);
        }
      };
      await createMcpServer().connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log("error", "MCP HTTP request failed", err instanceof Error ? err.message : String(err));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });

  setInterval(cleanupExpired, 3_600_000).unref();

  log("info", `MCP HTTP endpoint ready at ${mcpUrl.href}`);
  return app;
}
