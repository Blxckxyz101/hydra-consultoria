/**
 * BOTNET / DDOS PROTECTION MIDDLEWARE
 *
 * Layers of defense applied before rate limiting:
 *
 * 1. Request timeout — drops connections that don't complete in time (anti-slowloris)
 * 2. Bot fingerprinting — blocks obvious bots/scrapers by User-Agent and header patterns
 * 3. IP abuse tracker — auto-bans IPs that repeatedly trigger rate limits (429s)
 * 4. Slow-down — adds progressive delays before blocking (depletes botnet bandwidth)
 *
 * All bans are in-memory and auto-expire. No persistent state needed.
 */
import type { Request, Response, NextFunction } from "express";
import slowDown from "express-slow-down";
import { ipKeyGenerator } from "express-rate-limit";

// ── Shared IP key helper (same logic as rateLimit.ts) ────────────────────────
function getIp(req: Request): string {
  const raw =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.ip
    ?? "unknown";
  return ipKeyGenerator(raw);
}

// ── 1. Request timeout — anti-slowloris ──────────────────────────────────────
// Forces a response timeout for requests that take too long to send headers.
// Slowloris attacks hold connections open with slow partial requests.
// 90s: covers SISREG sequential proxy attempts (slow external scraper) + Geass/Skylers + DB ops
const REQUEST_TIMEOUT_MS = 90_000;

export function requestTimeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  }, REQUEST_TIMEOUT_MS);
  // Clear timer once response is sent
  res.on("finish", () => clearTimeout(timer));
  res.on("close", () => clearTimeout(timer));
  next();
}

// ── 2. Bot fingerprinting ─────────────────────────────────────────────────────
// Blocks requests that match known bot/scanner patterns.
// Legitimate browsers always send Accept and Accept-Language headers.
const BOT_UA_PATTERNS = [
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /axios\//i,
  /node-fetch/i,
  /java\//i,
  /zgrab/i,
  /masscan/i,
  /nmap/i,
  /nikto/i,
  /sqlmap/i,
  /dirbuster/i,
  /nuclei/i,
  /hydra/i,
  /medusa/i,
  /burpsuite/i,
  /owasp/i,
];

// Paths that are legitimately accessed by scripts/bots
const BOT_BYPASS_PATHS = new Set([
  "/api/health",
  "/api/events",
]);

export function botDetectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow whitelisted paths
  if (BOT_BYPASS_PATHS.has(req.path)) { next(); return; }

  const ua = (req.headers["user-agent"] ?? "").toLowerCase();

  // Block completely missing UA
  if (!ua || ua.length < 5) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Block known scanner/tool UAs
  if (BOT_UA_PATTERNS.some(p => p.test(ua))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}

// ── 3. IP abuse tracker ───────────────────────────────────────────────────────
// Tracks IPs that receive 429 (rate limited) responses.
// After ABUSE_THRESHOLD consecutive 429s, the IP is hard-banned for BAN_DURATION_MS.
const ABUSE_THRESHOLD = 5;
const BAN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const abuseMap = new Map<string, { hits: number; bannedUntil: number }>();

// Intercepts outgoing 429s to increment the abuse counter
export function abuseTrackerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = getIp(req);
  const entry = abuseMap.get(ip);

  // Already banned
  if (entry && entry.bannedUntil > Date.now()) {
    res.status(429).set("Retry-After", String(Math.ceil((entry.bannedUntil - Date.now()) / 1000)))
      .json({ error: "IP temporariamente banido por comportamento abusivo. Tente novamente mais tarde." });
    return;
  }

  // Hook into response to detect 429s
  const origEnd = res.end.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = function(...args: any[]) {
    if (res.statusCode === 429) {
      const cur = abuseMap.get(ip) ?? { hits: 0, bannedUntil: 0 };
      cur.hits++;
      if (cur.hits >= ABUSE_THRESHOLD) {
        cur.bannedUntil = Date.now() + BAN_DURATION_MS;
        cur.hits = 0; // reset after ban applied
      }
      abuseMap.set(ip, cur);
    } else if (res.statusCode < 400) {
      // Successful response — decay abuse counter slowly
      const cur = abuseMap.get(ip);
      if (cur && cur.hits > 0) {
        cur.hits = Math.max(0, cur.hits - 1);
        abuseMap.set(ip, cur);
      }
    }
    return origEnd(...args);
  };

  next();
}

// Auto-cleanup expired ban entries every 5 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of abuseMap) {
    if (entry.bannedUntil < now && entry.hits === 0) {
      abuseMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ── 4. Progressive slow-down ─────────────────────────────────────────────────
// Adds increasing delays per request after a threshold.
// A real user never hits 30+ requests/min on a single endpoint — a bot does.
// Delays waste botnet bandwidth without breaking legitimate users.
export const slowDownMiddleware = slowDown({
  windowMs:     60_000,       // 1 minute window
  delayAfter:   30,           // start delaying after 30 req/min
  delayMs:      (used) => (used - 30) * 200, // +200ms per request over limit
  maxDelayMs:   5_000,        // cap at 5s delay
  keyGenerator: getIp,
  skip: (req) =>
    req.path === "/api/health" ||
    req.path === "/api/events" ||
    req.path.startsWith("/api/attacks/stream"),
});

// ── Admin endpoint: view current bans ────────────────────────────────────────
export function getBanList() {
  const now = Date.now();
  return [...abuseMap.entries()]
    .filter(([, e]) => e.bannedUntil > now)
    .map(([ip, e]) => ({
      ip,
      bannedUntil: new Date(e.bannedUntil).toISOString(),
      remainingMs: e.bannedUntil - now,
    }));
}

export function unbanIp(ip: string): boolean {
  if (abuseMap.has(ip)) {
    abuseMap.delete(ip);
    return true;
  }
  return false;
}
