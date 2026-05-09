import type { RequestHandler } from "express";

const ALLOWED_HEADERS = "content-type,x-murmur-browser-use-api-key";
const ALLOWED_METHODS = "GET,POST,OPTIONS";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isAllowedLocalCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  if (origin === "null") {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function createLocalCorsMiddleware(): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && isAllowedLocalCorsOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
