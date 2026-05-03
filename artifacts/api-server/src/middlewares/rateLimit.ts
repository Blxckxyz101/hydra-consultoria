/**
 * RATE LIMITING MIDDLEWARE
 *
 * General: 1500 req/min per IP
 * Login:   10 attempts per 15 min per IP (brute-force protection)
 * Consulta: 30 req/min per IP
 * Attacks: 20 req/min per IP (stricter — prevents attack spam)
 * Proxies refresh: 5 req/min (expensive operation)
 *
 * Uses ipKeyGenerator for IPv6-safe key generation (express-rate-limit v8+).
 */
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const ip = (req: import("express").Request) => {
  const raw =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.ip
    ?? "unknown";
  return ipKeyGenerator(raw);
};

export const generalLimiter = rateLimit({
  windowMs:        60_000,
  max:             1500,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    ip,
  message:         { error: "Too many requests — by order of Lelouch vi Britannia, slow down." },
  skip: (req) =>
    req.path === "/api/health"  ||
    req.path === "/api/events"  ||
    req.path.startsWith("/api/checker/") ||
    req.path.startsWith("/api/attacks/stream"),
});

export const loginLimiter = rateLimit({
  windowMs:           15 * 60_000,
  max:                10,
  standardHeaders:    true,
  legacyHeaders:      false,
  keyGenerator:       ip,
  skipSuccessfulRequests: true,
  message:            { error: "Muitas tentativas de login. Aguarde 15 minutos." },
});

export const consultaLimiter = rateLimit({
  windowMs:        60_000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    ip,
  message:         { error: "Muitas consultas por minuto. Aguarde um momento." },
});

export const attackLimiter = rateLimit({
  windowMs:        60_000,
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    ip,
  message:         { error: "Attack rate limit exceeded — wait 60s before launching another assault." },
});

export const refreshLimiter = rateLimit({
  windowMs:        60_000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    ip,
  message:         { error: "Proxy refresh rate limit — maximum 5 times per minute." },
});

export const imageLimiter = rateLimit({
  windowMs:        60_000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    ip,
  message:         { error: "Image generation rate limit — maximum 10 images per minute. The Geass needs time to paint." },
});
