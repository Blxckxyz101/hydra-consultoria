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

export interface Proxy { host: string; port: number; responseMs: number; }

// ── In-memory cache (exported so attacks.ts can read it) ─────────────────
export let proxyCache: Proxy[] = [];
let lastFetch = 0;
let isFetching = false;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Proxy sources (public HTTP proxy lists) ──────────────────────────────
const SOURCES = [
  "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&country=all&simplified=true",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
];

// ── Parse proxy lines ─────────────────────────────────────────────────────
function parseProxies(text: string): { host: string; port: number }[] {
  const out: { host: string; port: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Match: ip:port or host:port (strip any leading "http://")
    const cleaned = line.replace(/^https?:\/\//i, "").split(/\s/)[0];
    const m = cleaned.match(/^([\d.]+|[a-z0-9.-]+):(\d+)$/i);
    if (!m) continue;
    const port = parseInt(m[2], 10);
    if (port < 1 || port > 65535) continue;
    out.push({ host: m[1], port });
  }
  return out;
}

// ── Test a single proxy (TCP connect) ────────────────────────────────────
async function testProxy(proxy: { host: string; port: number }): Promise<Proxy | null> {
  const start = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host: proxy.host, port: proxy.port });
      const t = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, 4000);
      sock.once("connect", () => { clearTimeout(t); sock.destroy(); resolve(); });
      sock.once("error",   (e) => { clearTimeout(t); reject(e); });
    });
    return { host: proxy.host, port: proxy.port, responseMs: Date.now() - start };
  } catch {
    return null;
  }
}

// ── Fetch + test all sources ──────────────────────────────────────────────
async function fetchAndTest(limit = 300): Promise<Proxy[]> {
  const raw: { host: string; port: number }[] = [];

  // Fetch all sources concurrently
  const fetches = await Promise.allSettled(
    SOURCES.map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      return parseProxies(text);
    })
  );

  for (const r of fetches) {
    if (r.status === "fulfilled") raw.push(...r.value);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = raw.filter(p => {
    const k = `${p.host}:${p.port}`;
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

// ── Auto-refresh every 10 minutes (server-side) ──────────────────────────
// First refresh fires 90 seconds after server starts (avoid startup delay)
setTimeout(() => {
  if (!isFetching) {
    isFetching = true;
    fetchAndTest(300)
      .then(fresh => { proxyCache = fresh; lastFetch = Date.now(); })
      .catch(() => { /* keep empty cache */ })
      .finally(() => { isFetching = false; });
  }
}, 90_000);

// Repeat every 10 minutes
setInterval(() => {
  if (!isFetching) {
    isFetching = true;
    fetchAndTest(300)
      .then(fresh => { proxyCache = fresh; lastFetch = Date.now(); })
      .catch(() => { /* keep old cache */ })
      .finally(() => { isFetching = false; });
  }
}, 10 * 60 * 1000);

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

// POST /api/proxies/refresh — re-fetch and re-test proxy list
router.post("/proxies/refresh", async (_req, res): Promise<void> => {
  if (isFetching) {
    res.json({ status: "already_fetching", count: proxyCache.length });
    return;
  }
  isFetching = true;
  const startTime = Date.now();
  res.json({ status: "started", message: "Fetching proxies from 5 sources and testing..." });

  try {
    const fresh = await fetchAndTest(300);
    proxyCache = fresh;
    lastFetch  = Date.now();
  } catch { /* keep old cache */ } finally {
    isFetching = false;
  }
});

// GET /api/proxies/count — quick count for polling
router.get("/proxies/count", (_req, res): void => {
  res.json({ count: proxyCache.length, fetching: isFetching, lastFetch });
});

export default router;
