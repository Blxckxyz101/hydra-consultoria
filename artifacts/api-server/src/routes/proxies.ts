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
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { refreshLimiter } from "../middlewares/rateLimit.js";

const router: IRouter = Router();

export interface Proxy { host: string; port: number; responseMs: number; type: "http" | "socks5"; username?: string; password?: string; }

// ── In-memory cache (exported so attacks.ts can read it) ─────────────────
export let proxyCache: Proxy[] = [];
let lastFetch = 0;
let isFetching = false;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Pinned proxies — custom/residential proxies that survive cache refresh ─
let pinnedProxies: Proxy[] = [];
let residentialCreds: { host: string; port: number; username: string; password: string; count: number } | null = null;

// ── Exported getter functions for SSE events route ───────────────────────
export function getResidentialCreds() { return residentialCreds; }
export function isFetchingProxies()  { return isFetching; }

// ── Persistence — save/load residential config across restarts ────────────
const CONFIG_FILE = path.join(process.cwd(), "data", "proxy-config.json");

type ResidentialConfig = { host: string; port: number; username: string; password: string; count: number };
interface SavedConfig {
  residential?: ResidentialConfig | null;
  pinnedList?: Array<{ host: string; port: number; username?: string; password?: string }>;
}

// ── Env-var sentinel helpers — never store real credentials on disk ───────────
// Passwords that match a known env var are stored as "__env:VAR_NAME__"
// and resolved back to the env var value when loaded.
const ENV_SENTINELS: Array<{ name: string; value: () => string | undefined }> = [
  { name: "WEBSHARE_PROXY_PASS", value: () => process.env.WEBSHARE_PROXY_PASS },
  { name: "RESIDENTIAL_PASS",    value: () => process.env.RESIDENTIAL_PASS },
];

function maskPassword(pass: string | undefined): string | undefined {
  if (!pass) return pass;
  for (const s of ENV_SENTINELS) {
    const v = s.value();
    if (v && pass === v) return `__env:${s.name}__`;
  }
  return pass;
}

function resolvePassword(pass: string | undefined): string | undefined {
  if (!pass) return pass;
  const m = /^__env:([A-Z0-9_]+)__$/.exec(pass);
  if (m) return process.env[m[1]] ?? pass;
  return pass;
}

function saveConfig(): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const seen = new Set<string>();
    const pinnedList = pinnedProxies
      .filter(p => p.username && p.password)
      .filter(p => {
        const k = `${p.host}:${p.port}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map(p => ({ host: p.host, port: p.port, username: p.username, password: maskPassword(p.password) }));
    const residentialMasked = residentialCreds
      ? { ...residentialCreds, password: maskPassword(residentialCreds.password) ?? "" }
      : null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ residential: residentialMasked, pinnedList }, null, 2));
  } catch { /* non-fatal */ }
}

function loadConfig(): void {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    const cfg = JSON.parse(raw) as SavedConfig;
    if (cfg.pinnedList && cfg.pinnedList.length > 0) {
      pinnedProxies = cfg.pinnedList.map((p, i) => ({
        host: p.host, port: p.port, responseMs: i + 1, type: "http" as const,
        username: p.username, password: resolvePassword(p.password),
      }));
      proxyCache = [...pinnedProxies];
      lastFetch = Date.now();
      console.log(`[PROXIES] Restored ${pinnedProxies.length} pinned proxies from config`);
    } else if (cfg.residential) {
      const rc: ResidentialConfig = cfg.residential;
      const pass = resolvePassword(rc.password);
      residentialCreds = { ...rc, password: pass ?? rc.password };
      pinnedProxies = Array.from({ length: rc.count }, (_, i) => ({
        host: rc.host, port: rc.port,
        responseMs: i + 1, type: "http" as const,
        username: rc.username, password: pass,
      }));
      proxyCache = [...pinnedProxies];
      lastFetch = Date.now();
      console.log(`[PROXIES] Restored ${rc.count} residential slots from legacy config (${rc.host})`);
    }
    if (cfg.residential) {
      const rc2: ResidentialConfig = cfg.residential;
      residentialCreds = { ...rc2, password: resolvePassword(rc2.password) ?? rc2.password };
    }
  } catch { /* no saved config */ }
}

// Load persisted config immediately on startup
loadConfig();

// ── T007: Env var bootstrap — auto-configure residential proxy from env on deploy ─
// Set RESIDENTIAL_HOST, RESIDENTIAL_PORT, RESIDENTIAL_USER, RESIDENTIAL_PASS, RESIDENTIAL_COUNT
// These are used as a fallback when no pinnedList is present in the saved config.
// If the saved config already has a pinnedList (multiple residential IPs), it takes priority.
(function bootstrapFromEnv() {
  const host  = process.env.RESIDENTIAL_HOST?.trim();
  const port  = parseInt(process.env.RESIDENTIAL_PORT ?? "", 10);
  const user  = process.env.RESIDENTIAL_USER?.trim();
  const pass  = process.env.RESIDENTIAL_PASS?.trim();
  const count = parseInt(process.env.RESIDENTIAL_COUNT ?? "0", 10);
  if (!host || !port || !user || !pass || count < 1) return;
  // Skip env var bootstrap if saved config already loaded a pinnedList with authenticated proxies.
  // This prevents old/broken env var credentials from overriding the manually configured pool.
  const savedAuthCount = pinnedProxies.filter(p => p.username && p.password).length;
  if (savedAuthCount > 0) {
    console.log(`[PROXIES] Env var bootstrap skipped — ${savedAuthCount} authenticated proxies already loaded from saved config`);
    return;
  }
  residentialCreds = { host, port, username: user, password: pass, count };
  pinnedProxies = Array.from({ length: count }, (_, i) => ({
    host, port, responseMs: i + 1, type: "http" as const, username: user, password: pass,
  }));
  proxyCache = [...pinnedProxies];
  lastFetch  = Date.now();
  console.log(`[PROXIES] Bootstrapped ${count} residential slots from env vars (${host})`);
})();

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

// ── Healthy proxy cache — TCP-verified subset of proxyCache ──────────────
// Background health-check tests a random sample every 5 min and keeps only
// confirmed-live proxies here. spawnPool prefers this over raw proxyCache.
export let healthyProxyCache: Proxy[] = [];
// Fast tier (<= 1500ms) — ideal for latency-sensitive attacks (waf-bypass, rapid-reset)
export let fastProxyCache:    Proxy[] = [];
// Slow tier (1500-8000ms) — good for connection-holding attacks (slowloris, rudy, cdn-purge-flood)
export let slowProxyCache:    Proxy[] = [];
let _healthCheckRunning = false;

const FAST_THRESHOLD_MS = 1500;

async function runHealthCheck(): Promise<void> {
  if (_healthCheckRunning || proxyCache.length === 0) return;
  _healthCheckRunning = true;
  try {
    const residentialAll = proxyCache.filter(p => p.username && p.password);
    const nonRes         = proxyCache.filter(p => !p.username);

    // ── TCP-test ALL residential proxies — remove dead ones ───────────────
    // Residential proxies rotate internally, but the proxy gateway endpoint
    // itself can go down. We test each with a 5s TCP timeout and keep only
    // confirmed-live ones. Dead proxies are removed from pinnedProxies too.
    const resTestResults = await Promise.allSettled(
      residentialAll.map(p => testProxy({ host: p.host, port: p.port, type: p.type ?? "http" })),
    );
    const liveResidential: Proxy[] = [];
    const deadResidential = new Set<string>();
    resTestResults.forEach((r, i) => {
      const p = residentialAll[i];
      if (r.status === "fulfilled" && r.value !== null) {
        // Preserve auth credentials on the result from testProxy (it doesn't copy them)
        liveResidential.push({ ...r.value, username: p.username, password: p.password });
      } else {
        deadResidential.add(`${p.host}:${p.port}`);
        console.warn(`[PROXIES] Dead residential proxy removed: ${p.host}:${p.port}`);
      }
    });

    // Remove dead proxies from pinnedProxies so they don't come back on next harvest
    if (deadResidential.size > 0) {
      pinnedProxies = pinnedProxies.filter(p => !deadResidential.has(`${p.host}:${p.port}`));
      proxyCache    = proxyCache.filter(p => !deadResidential.has(`${p.host}:${p.port}`));
      saveConfig();
    }

    // ── TCP-test a sample of non-residential proxies ───────────────────────
    const sample  = [...nonRes].sort(() => Math.random() - 0.5).slice(0, 300);
    const results = await Promise.allSettled(sample.map(testProxy));
    const liveFree = results
      .filter((r): r is PromiseFulfilledResult<Proxy | null> => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value!);

    // Merge: residential first, then confirmed-live non-residential, deduped
    const merged = new Map<string, Proxy>();
    for (const p of [...liveResidential, ...liveFree]) merged.set(`${p.host}:${p.port}`, p);
    healthyProxyCache = [...merged.values()].sort((a, b) => a.responseMs - b.responseMs);

    // Split into fast / slow tiers for specialized vectors
    fastProxyCache = [
      ...liveResidential,
      ...liveFree.filter(p => p.responseMs <= FAST_THRESHOLD_MS),
    ].sort((a, b) => a.responseMs - b.responseMs);

    slowProxyCache = liveFree
      .filter(p => p.responseMs > FAST_THRESHOLD_MS && p.responseMs <= 8000)
      .sort((a, b) => a.responseMs - b.responseMs);

    console.log(`[PROXIES] Health-check done — ${healthyProxyCache.length} live (${liveResidential.length}/${residentialAll.length} residential + ${liveFree.length} free) | fast:${fastProxyCache.length} slow:${slowProxyCache.length}${deadResidential.size > 0 ? ` | removed ${deadResidential.size} dead` : ""}`);
  } catch { /* keep stale */ } finally { _healthCheckRunning = false; }
}

// First health-check 20s after startup; repeat every 5 min
setTimeout(() => { void runHealthCheck(); }, 20_000);
setInterval(() => { void runHealthCheck(); }, 5 * 60 * 1000);

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
    // Always keep pinned proxies at the front (fastest priority)
    const harvested = [...merged.values()].sort((a, b) => a.responseMs - b.responseMs).slice(0, 1000);
    const pinnedKeys = new Set(pinnedProxies.map(p => `${p.type}:${p.host}:${p.port}`));
    const nonDup = harvested.filter(p => !pinnedKeys.has(`${p.type}:${p.host}:${p.port}`));
    proxyCache = [...pinnedProxies, ...nonDup];
    lastFetch  = Date.now();
  } catch { /* keep old cache */ } finally { isFetching = false; }
}

// ── Parse custom proxy string (supports user:pass@host:port & plain host:port) ─
function parseCustomProxy(line: string): { host: string; port: number; username?: string; password?: string } | null {
  const s = line.trim().replace(/^https?:\/\//i, "");
  // user:pass@host:port
  const authMatch = s.match(/^([^:@]+):([^@]+)@([\d.a-z-]+):(\d+)$/i);
  if (authMatch) {
    const port = parseInt(authMatch[4], 10);
    if (port < 1 || port > 65535) return null;
    return { username: authMatch[1], password: authMatch[2], host: authMatch[3], port };
  }
  // host:port
  const plain = s.match(/^([\d.]+|[a-z0-9.-]+):(\d+)$/i);
  if (plain) {
    const port = parseInt(plain[2], 10);
    if (port < 1 || port > 65535) return null;
    return { host: plain[1], port };
  }
  return null;
}

// Initial harvest after 10 seconds
setTimeout(() => void runHarvest(600), 10_000);

// Continuous harvest every 5 minutes
setInterval(() => void runHarvest(600), 5 * 60 * 1000);

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/proxies — return cached live proxies
router.get("/proxies", (_req, res): void => {
  const age = Date.now() - lastFetch;
  // Separate residential (auth'd) from public proxies for clean display
  const residentialHost = residentialCreds?.host;
  const publicProxies   = proxyCache.filter(p => !p.username || p.host !== residentialHost);
  const residentialProxies = residentialCreds
    ? proxyCache.filter(p => p.username && p.host === residentialHost)
    : [];
  res.json({
    count:              proxyCache.length,
    publicCount:        publicProxies.length,
    residentialCount:   residentialProxies.length,
    proxies:            publicProxies.slice(0, 200), // public only (no auth dupes)
    residential:        residentialCreds
      ? { host: residentialCreds.host, port: residentialCreds.port, count: residentialCreds.count, username: residentialCreds.username }
      : null,
    ageMs:              age,
    fresh:              age < CACHE_TTL,
    fetching:           isFetching,
  });
});

// POST /api/proxies/refresh — trigger immediate harvest
router.post("/proxies/refresh", refreshLimiter, (_req, res): void => {
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
  const httpCount      = proxyCache.filter(p => p.type === "http").length;
  const socks5Count    = proxyCache.filter(p => p.type === "socks5").length;
  const pinnedCount    = pinnedProxies.length;
  const residentialCount = residentialCreds ? residentialCreds.count : 0;
  const avgMs = proxyCache.length > 0
    ? Math.round(proxyCache.reduce((a, p) => a + p.responseMs, 0) / proxyCache.length)
    : 0;
  res.json({
    count:            proxyCache.length,
    httpCount,
    socks5Count,
    pinnedCount,
    residentialCount,
    residential:      residentialCreds ? { host: residentialCreds.host, port: residentialCreds.port, count: residentialCreds.count } : null,
    avgResponseMs:    avgMs,
    fastest:          proxyCache[0] ?? null,
    sources:          { http: HTTP_SOURCES.length, socks5: SOCKS5_SOURCES.length, total: HTTP_SOURCES.length + SOCKS5_SOURCES.length },
    lastFetch,
    ageMs,
    fresh:            ageMs < CACHE_TTL,
    fetching:         isFetching,
    totalTested,
    totalFound,
    nextRefreshIn:    Math.max(0, 5 * 60 * 1000 - ageMs),
  });
});

// POST /api/proxies/import — import custom proxy list (host:port or user:pass@host:port lines)
router.post("/proxies/import", (req, res): void => {
  const { proxies: lines, test = false } = req.body as { proxies: string[]; test?: boolean };
  if (!Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "proxies must be a non-empty array of strings" }); return;
  }
  const parsed: Proxy[] = [];
  for (const line of lines) {
    const p = parseCustomProxy(line);
    if (!p) continue;
    parsed.push({ host: p.host, port: p.port, responseMs: 1, type: "http", username: p.username, password: p.password });
  }
  if (parsed.length === 0) { res.status(400).json({ error: "no valid proxies found in input" }); return; }

  if (test) {
    // Test connectivity first (parallel, 4s timeout)
    res.json({ status: "testing", message: `Testing ${parsed.length} proxies... check /api/proxies/stats for results` });
    void (async () => {
      const live: Proxy[] = [];
      const BATCH = 50;
      for (let i = 0; i < parsed.length; i += BATCH) {
        const batch = parsed.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(testProxy));
        for (const r of results) if (r.status === "fulfilled" && r.value) live.push(r.value);
      }
      // Preserve auth credentials (testProxy strips them)
      const liveWithAuth = live.map(lp => {
        const orig = parsed.find(p => p.host === lp.host && p.port === lp.port);
        return { ...lp, username: orig?.username, password: orig?.password };
      });
      pinnedProxies = [...pinnedProxies, ...liveWithAuth];
      const pinnedKeys = new Set(pinnedProxies.map(p => `${p.type}:${p.host}:${p.port}`));
      proxyCache = [...pinnedProxies, ...proxyCache.filter(p => !pinnedKeys.has(`${p.type}:${p.host}:${p.port}`))];
      lastFetch = Date.now();
    })();
    return;
  }

  // Direct add without testing
  pinnedProxies = [...pinnedProxies, ...parsed];
  const pinnedKeys = new Set(pinnedProxies.map(p => `${p.type}:${p.host}:${p.port}`));
  proxyCache = [...pinnedProxies, ...proxyCache.filter(p => !pinnedKeys.has(`${p.type}:${p.host}:${p.port}`))];
  lastFetch = Date.now();
  saveConfig();
  res.json({ status: "imported", added: parsed.length, total: proxyCache.length });
});

// POST /api/proxies/residential — configure rotating residential proxy credentials
// Creates N virtual entries all pointing to the same host (each connection gets a different residential IP)
router.post("/proxies/residential", (req, res): void => {
  const { host, port, username, password, count = 25 } = req.body as {
    host: string; port: number; username: string; password: string; count?: number;
  };
  if (!host || !port || !username || !password) {
    res.status(400).json({ error: "host, port, username, password required" }); return;
  }
  residentialCreds = { host, port: Number(port), username, password, count: Number(count) };
  // Create `count` virtual proxy entries — same endpoint, each connection rotates IP
  const residential: Proxy[] = Array.from({ length: Number(count) }, (_, i) => ({
    host, port: Number(port), responseMs: i + 1, type: "http" as const, username, password,
  }));
  // Remove old residential entries from pinned
  pinnedProxies = pinnedProxies.filter(p => !(p.username === username && p.host === host));
  pinnedProxies = [...residential, ...pinnedProxies];
  // Rebuild cache with residential proxies at front
  const pinnedKeys = new Set(pinnedProxies.map(p => `${p.type}:${p.host}:${p.port}`));
  proxyCache = [...pinnedProxies, ...proxyCache.filter(p => !pinnedKeys.has(`${p.type}:${p.host}:${p.port}`))];
  lastFetch = Date.now();
  saveConfig();
  res.json({
    status: "configured", residential: residentialCreds,
    message: `${count} rotating residential proxy slots added — each connection exits via a different IP`,
    totalProxies: proxyCache.length,
  });
});

// DELETE /api/proxies/pinned — clear all pinned/imported/residential proxies
router.delete("/proxies/pinned", (_req, res): void => {
  const removed = pinnedProxies.length;
  pinnedProxies = [];
  residentialCreds = null;
  proxyCache = proxyCache.filter(p => !p.username);
  res.json({ status: "cleared", removed, remaining: proxyCache.length });
});

// ── GET /api/probe?url=...  — proxied HTTP probe ──────────────────────────
// Fires a HEAD (then GET fallback) request through the proxy pool to the target.
// Used by the Discord/Telegram bot when direct probes fail (datacenter IP blocks).
// Tries: residential → random free proxies (3) → direct.
// Response: { up, statusCode, latencyMs, serverHeader, redirected, finalUrl, via, error }
router.get("/probe", (req, res): void => {
  const rawUrl = typeof req.query["url"] === "string" ? req.query["url"].trim() : "";
  if (!rawUrl) { res.status(400).json({ error: "url query param required" }); return; }

  let url = rawUrl;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const TIMEOUT_S = 10;
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  function runCurlProbe(proxyArgs: string[]): Promise<{ statusCode: number; serverHeader: string | null; location: string | null }> {
    return new Promise((resolve, reject) => {
      const args = ["-s", "--max-time", String(TIMEOUT_S),
        "-I", "-L", "--max-redirs", "5", "-A", UA,
        "-H", "Cache-Control: no-cache, no-store",
        "-H", "Pragma: no-cache",
        ...proxyArgs, "--", url];
      execFile("curl", args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (!stdout && err) { reject(err); return; }
        // Parse status code from HTTP status line(s) — use last one (after all redirects)
        const lines = stdout.split(/\r?\n/);
        let statusCode = 0;
        let serverHeader: string | null = null;
        let location: string | null = null;
        for (const line of lines) {
          const sm = line.match(/^HTTP\/\S+\s+(\d+)/i);
          if (sm) { statusCode = parseInt(sm[1], 10); serverHeader = null; location = null; }
          const sh = line.match(/^(?:server|x-powered-by):\s*(.+)/i);
          if (sh) serverHeader = sh[1].trim();
          const lh = line.match(/^location:\s*(.+)/i);
          if (lh) location = lh[1].trim();
        }
        if (statusCode === 0) { reject(new Error("no HTTP status parsed")); return; }
        resolve({ statusCode, serverHeader, location });
      });
    });
  }

  // Build proxy candidate list: residential first, then 3 random free proxies
  function getProxyCandidates(): string[][] {
    const candidates: string[][] = [];
    const rc = residentialCreds;
    if (rc) {
      const auth = `${rc.username}:${rc.password}@${rc.host}:${rc.port}`;
      candidates.push(["-x", `http://${auth}`]);
    }
    const free = proxyCache.filter(p => !p.username && p.host !== "0.0.0.0");
    const shuffled = free.sort(() => Math.random() - 0.5).slice(0, 3);
    for (const p of shuffled) {
      const scheme = p.type === "socks5" ? "socks5h" : "http";
      candidates.push(["-x", `${scheme}://${p.host}:${p.port}`]);
    }
    candidates.push([]); // direct fallback
    return candidates;
  }

  void (async () => {
    const t0 = Date.now();
    const candidates = getProxyCandidates();
    let lastError: string | null = null;
    let via: "residential" | "free-proxy" | "direct" = "direct";

    for (let i = 0; i < candidates.length; i++) {
      const proxyArgs = candidates[i];
      const isResidential = i === 0 && residentialCreds !== null;
      const isFree        = !isResidential && proxyArgs.length > 0;
      const isDirect      = proxyArgs.length === 0;

      try {
        const result = await runCurlProbe(proxyArgs);
        const latencyMs = Date.now() - t0;
        via = isResidential ? "residential" : isFree ? "free-proxy" : "direct";
        const up = result.statusCode > 0 && result.statusCode < 500 && result.statusCode !== 503;
        const finalUrl = result.location ?? null;
        res.json({ up, statusCode: result.statusCode, latencyMs, serverHeader: result.serverHeader, redirected: finalUrl !== null, finalUrl, via });
        return;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (!isDirect) continue; // try next candidate
      }
    }

    const latencyMs = Date.now() - t0;
    res.json({ up: false, statusCode: null, latencyMs, serverHeader: null, redirected: false, finalUrl: null, via, error: lastError ?? "All probe attempts failed" });
  })();
});

export default router;
