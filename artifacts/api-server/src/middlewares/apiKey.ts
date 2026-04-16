/**
 * API KEY AUTHENTICATION MIDDLEWARE
 *
 * Reads API_KEY from environment. If not set, auth is disabled (backwards compat).
 * Accepts key via:
 *   - Authorization: Bearer <key>
 *   - X-Api-Key: <key>
 *
 * Public routes bypassed: /api/health, GET /api/proxies/count
 */
import type { Request, Response, NextFunction } from "express";

const API_KEY = process.env.API_KEY?.trim() ?? "";

const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/events",          // SSE stream — panel needs this without auth
  "/api/proxies/count",   // lightweight widget polling
]);

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // No key configured — auth disabled, let everything through
  if (!API_KEY) { next(); return; }

  // Always allow public routes
  if (PUBLIC_ROUTES.has(req.path)) { next(); return; }

  const authHeader = String(req.headers["authorization"] ?? "");
  const keyHeader  = String(req.headers["x-api-key"]     ?? "");

  const provided =
    authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : keyHeader.trim();

  if (provided === API_KEY) { next(); return; }

  res.status(401).json({
    error: "Unauthorized — invalid or missing API key.",
    hint:  "Set Authorization: Bearer <key> or X-Api-Key: <key>",
  });
}
