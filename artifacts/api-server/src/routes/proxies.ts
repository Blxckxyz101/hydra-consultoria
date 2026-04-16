/**
 * PROXIES ROUTE
 *
 * Fetches live HTTP proxies from public sources, tests them in parallel,
 * caches working ones, and serves them to the attack workers.
 *
 * Sources: ProxyScrape, TheSpeedX list, clarketm list
 * Testing: TCP connect on proxy port with 4s timeout
 * Refresh: POST /api/proxies/refresh — fetches new batch
 * Cache: holds for 10 minutes or until next refresh
 */
import { Router, type IRouter } from "express";
import net from "node:net";
import dns from "node:dns/promises";

const router: IRouter = Router();

export interface Proxy { host: string; port: number; responseMs: number; type: "http" | "socks5"; }

// ── In-memory cache (exported so attacks.ts can read it) ─────────────────
export let proxyCache: Proxy[] = [];
let lastFetch = 0;
let isFetching = false;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Proxy sources — expanded v3 (14 HTTP + 8 SOCKS5) ────────────────────
const HTTP_SOURCES = [
  // Primary bulk sources
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&country=all&simplified=true",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
  // Additional high-volume sources
  "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=https&timeout=5000&country=all&simplified=true",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/rx443/proxy-list/main/online/http.txt",
  "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt",
];
const SOCKS5_SOURCES = [
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5&timeout=5000&country=all&simplified=true",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt",
  "https://raw.githubusercontent.com/rx443/proxy-list/main/online/socks5.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/socks5.txt",
];

// ── Parse proxy lines ─────────────────────────────────────────────────────
function parseProxies(text: string, type: "http" | "socks5"): { host: string; port: number; type: "http" | "socks5" }[] {
  const out: { host: string; port: number; type: "http" | "socks5" }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Match: ip:port or host:port (strip any leading "http://")
    const cleaned = line.replace(/^https?:\/\//i, "").split(/\s/)[0];
    const m = cleaned.match(/^([\d.]+|[a-z0-9.-]+):(\d+)$/i);
    if (!m) continue;
    const port = parseInt(m[2], 10);
    if (port < 1 || port > 65535) continue;
    out.push({ host: m[1], port, type });
  }
  return out;
}

// ── Test a single proxy (TCP connect) ────────────────────────────────────
async function testProxy(proxy: { host: string; port: number; type: "http" | "socks5" }): Promise<Proxy | null> {
  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host: proxy.host, port: proxy.port });
      const t = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, 4000);
      sock.once("connect", () => { clearTimeout(t); sock.destroy(); resolve(); });
      sock.once("error",   (e) => { clearTimeout(t); reject(e); });
    });
    return { host: proxy.host, port: proxy.port, responseMs: Date.now() - start, type: proxy.type };
  } catch {
    return null;
  }
}

// ── Fetch + test all sources ──────────────────────────────────────────────
async function fetchAndTest(limit = 400): Promise<Proxy[]> {
  const raw: { host: string; port: number; type: "http" | "socks5" }[] = [];

  // Fetch HTTP sources
  const httpFetches = await Promise.allSettled(
    HTTP_SOURCES.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return parseProxies(await res.text(), "http");
    })
  );
  for (const r of httpFetches) if (r.status === "fulfilled") raw.push(...r.value);

  // Fetch SOCKS5 sources
  const socks5Fetches = await Promise.allSettled(
    SOCKS5_SOURCES.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return parseProxies(await res.text(), "socks5");
    })
  );
  for (const r of socks5Fetches) if (r.status === "fulfilled") raw.push(...r.value);

  // Deduplicate
  const seen = new Set<string>();
  const unique = raw.filter(p => {
    const k = `${p.type}:${p.host}:${p.port}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Shuffle and take first `limit` proxies to test (avoid testing thousands)
  const shuffled = unique.sort(() => Math.random() - 0.5).slice(0, limit);

  // Test in parallel batches of 40
  const BATCH = 40;
  const live: Proxy[] = [];
  for (let i = 0; i < shuffled.length; i += BATCH) {
    const batch = shuffled.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(testProxy));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) live.push(r.value);
    }
  }

  // Sort by response time (fastest first)
  return live.sort((a, b) => a.responseMs - b.responseMs);
}

// ── Auto-harvest on startup (30s delay) + every 5 minutes ────────────────
// v3: faster first harvest (30s was 90s), shorter cycle (5min was 10min),
//     larger batch size (600 was 400) → more proxies available for attacks
let totalTested = 0;
let totalFound  = 0;

async function runHarvest(limit = 600): Promise<void> {
  if (isFetching) return;
  isFetching = true;
  try {
    const fresh = await fetchAndTest(limit);
    totalTested += limit;
    totalFound  += fresh.length;
    // Merge with existing cache (keep fast proxies that are still valid)
    const merged = new Map<string, Proxy>();
    for (const p of [...proxyCache, ...fresh]) merged.set(`${p.type}:${p.host}:${p.port}`, p);
    proxyCache = [...merged.values()].sort((a, b) => a.responseMs - b.responseMs).slice(0, 1000);
    lastFetch  = Date.now();
  } catch { /* keep old cache */ } finally { isFetching = false; }
}

// Initial harvest after 30 seconds
setTimeout(() => void runHarvest(600), 30_000);

// Continuous harvest every 5 minutes
setInterval(() => void runHarvest(600), 5 * 60 * 1000);

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/proxies — return cached live proxies
router.get("/proxies", (_req, res): void => {
  const age = Date.now() - lastFetch;
  res.json({
    count:     proxyCache.length,
    proxies:   proxyCache.slice(0, 200), // max 200 in response
    ageMs:     age,
    fresh:     age < CACHE_TTL,
    fetching:  isFetching,
  });
});

// POST /api/proxies/refresh — trigger immediate harvest
router.post("/proxies/refresh", (_req, res): void => {
  if (isFetching) {
    res.json({ status: "already_fetching", count: proxyCache.length, lastFetch });
    return;
  }
  res.json({ status: "started", message: `Harvesting proxies from ${HTTP_SOURCES.length} HTTP + ${SOCKS5_SOURCES.length} SOCKS5 sources...` });
  void runHarvest(600);
});

// GET /api/proxies/count — quick count for polling
router.get("/proxies/count", (_req, res): void => {
  res.json({ count: proxyCache.length, fetching: isFetching, lastFetch });
});

// GET /api/proxies/stats — detailed harvester stats
router.get("/proxies/stats", (_req, res): void => {
  const ageMs = Date.now() - lastFetch;
  const httpCount   = proxyCache.filter(p => p.type === "http").length;
  const socks5Count = proxyCache.filter(p => p.type === "socks5").length;
  const avgMs = proxyCache.length > 0
    ? Math.round(proxyCache.reduce((a, p) => a + p.responseMs, 0) / proxyCache.length)
    : 0;
  res.json({
    count:         proxyCache.length,
    httpCount,
    socks5Count,
    avgResponseMs: avgMs,
    fastest:       proxyCache[0] ?? null,
    sources:       { http: HTTP_SOURCES.length, socks5: SOCKS5_SOURCES.length, total: HTTP_SOURCES.length + SOCKS5_SOURCES.length },
    lastFetch,
    ageMs,
    fresh:         ageMs < CACHE_TTL,
    fetching:      isFetching,
    totalTested,
    totalFound,
    nextRefreshIn: Math.max(0, 5 * 60 * 1000 - ageMs),
  });
});

export default router;
