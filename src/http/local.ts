import type { IncomingMessage } from "node:http";
import { config } from "../utils/config.js";

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function allowedHosts(): Set<string> {
  const port = new URL(config.mcpPublicUrl).port || process.env.PORT || "6767";
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

/**
 * True for a request that came straight from this machine: loopback socket,
 * no proxy hop, a localhost Host header (blocks DNS rebinding) and, when a
 * browser sent an Origin, a localhost Origin (blocks cross-site pages).
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress || "")) return false;
  if (req.headers["x-forwarded-for"] || req.headers["forwarded"]) return false;
  const hosts = allowedHosts();
  if (!hosts.has(req.headers.host || "")) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!hosts.has(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
