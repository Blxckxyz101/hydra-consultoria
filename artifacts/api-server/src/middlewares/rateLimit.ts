/**
 * RATE LIMITING MIDDLEWARE
 *
 * General: 300 req/min per IP
 * Attacks: 20 req/min per IP (stricter — prevents attack spam)
 * Proxies refresh: 5 req/min (expensive operation)
 */
import rateLimit from "express-rate-limit";

const ip = (req: import("express").Request) =>
  (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
  ?? req.ip
  ?? "unknown";

export const generalLimiter = rateLimit({
  windowMs:       60_000,
  max:            300,
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   ip,
  message:        { error: "Too many requests — by order of Lelouch vi Britannia, slow down." },
  skip: (req) => req.path === "/api/health" || req.path === "/api/events",
});

export const attackLimiter = rateLimit({
  windowMs:       60_000,
  max:            20,
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   ip,
  message:        { error: "Attack rate limit exceeded — wait 60s before launching another assault." },
});

export const refreshLimiter = rateLimit({
  windowMs:       60_000,
  max:            5,
  standardHeaders: true,
  legacyHeaders:  false,
  keyGenerator:   ip,
  message:        { error: "Proxy refresh rate limit — maximum 5 times per minute." },
});
