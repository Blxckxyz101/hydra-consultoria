/**
 * NITRO CHECKER ROUTE
 *
 * Checks Discord gift codes against Discord's public gift-code API.
 * Uses 4 parallel workers, rotating HTTP proxies from proxyCache,
 * and full browser-fingerprint headers to reduce rate limiting.
 *
 * POST /api/nitro/check  { codes: string[] }
 * → { results: NitroCodeResult[], proxyCount: number }
 */
import { Router, type IRouter } from "express";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { proxyCache, type Proxy } from "./proxies.js";

const router: IRouter = Router();

type CheckStatus = "valid" | "invalid" | "rate_limited" | "error";
interface CodeResult { code: string; status: CheckStatus; plan?: string; retryAfterMs?: number; }

// ── UA profiles: full browser fingerprint (UA + matching Client Hints) ─────────
interface UAProfile {
  ua:           string;
  secChUa:      string;
  platform:     string;   // for sec-ch-ua-platform
  mobile:       string;   // "?0" or "?1"
}

const UA_PROFILES: UAProfile[] = [
  {
    ua:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa:  '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    platform: '"Windows"',
    mobile:   "?0",
  },
  {
    ua:       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    secChUa:  '"Chromium";v="123", "Google Chrome";v="123", "Not-A.Brand";v="99"',
    platform: '"macOS"',
    mobile:   "?0",
  },
  {
    ua:       "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    secChUa:  '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
    platform: '"Linux"',
    mobile:   "?0",
  },
  {
    ua:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    secChUa:  '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="99"',
    platform: '"Windows"',
    mobile:   "?0",
  },
  {
    ua:       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    secChUa:  '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    platform: '"macOS"',
    mobile:   "?0",
  },
];

let profileIndex = 0;
function nextProfile(): UAProfile {
  return UA_PROFILES[profileIndex++ % UA_PROFILES.length];
}

// ── Global rate-limit backoff state ─────────────────────────────────────────
// When Discord rate-limits us, we record the exact time to resume.
// All workers check this before firing a request.
let globalBackoffUntil = 0;   // Unix ms timestamp
let consecutiveRateLimits = 0; // streak counter to detect rate-limit storms

async function waitForGlobalBackoff(): Promise<void> {
  const now = Date.now();
  if (globalBackoffUntil > now) {
    await new Promise(r => setTimeout(r, globalBackoffUntil - now + 200));
  }
}

function recordRateLimit(retryAfterMs: number): void {
  consecutiveRateLimits++;
  const resumeAt = Date.now() + retryAfterMs;
  // Only extend the global backoff — never shorten it
  if (resumeAt > globalBackoffUntil) {
    globalBackoffUntil = resumeAt;
  }
}

function recordSuccess(): void {
  consecutiveRateLimits = 0;
}

// ── Proxy rotation for nitro checks ──────────────────────────────────────────
let nitroProxyIndex = 0;
// Maps proxy key → exact Unix timestamp when the rate limit expires
const badNitroProxies = new Map<string, number>();
const DEFAULT_COOLDOWN = 30_000; // 30s default when no retry-after header

function getNextNitroProxy(): Proxy | null {
  const now = Date.now();
  for (const [k, exp] of badNitroProxies) {
    if (now > exp) badNitroProxies.delete(k);
  }

  const pool = proxyCache.filter(p => {
    const k = `${p.host}:${p.port}`;
    return !badNitroProxies.has(k);
  });

  if (pool.length === 0) return null;

  const p = pool[nitroProxyIndex % pool.length];
  nitroProxyIndex++;
  return p;
}

function markBadProxy(proxy: Proxy, cooldownMs: number = DEFAULT_COOLDOWN): void {
  // Residential/auth proxies rotate IPs on each connection — never mark them
  if (proxy.username) return;
  badNitroProxies.set(`${proxy.host}:${proxy.port}`, Date.now() + cooldownMs);
}

// ── Build a dispatcher (proxy or direct) ─────────────────────────────────────
function makeDispatcher(proxy: Proxy | null): ProxyAgent | undefined {
  if (!proxy) return undefined;
  const creds = proxy.username && proxy.password
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  const uri = `http://${creds}${proxy.host}:${proxy.port}`;
  try {
    return new ProxyAgent({ uri, connectTimeout: 4_000 });
  } catch {
    return undefined;
  }
}

// ── Parse retry-after from a 429 response (prefers exact header, falls back to body) ──
async function parseRetryAfterMs(res: Response): Promise<number> {
  // 1. x-ratelimit-reset-after (fractional seconds until reset)
  const resetAfter = res.headers.get("x-ratelimit-reset-after");
  if (resetAfter) {
    const ms = Math.ceil(parseFloat(resetAfter) * 1000) + 1_000;
    if (!isNaN(ms) && ms > 0) return Math.min(ms, 10 * 60_000);
  }
  // 2. retry-after header (integer seconds)
  const retryAfterHdr = res.headers.get("retry-after");
  if (retryAfterHdr) {
    const ms = Math.ceil(parseFloat(retryAfterHdr) * 1000) + 500;
    if (!isNaN(ms) && ms > 0) return Math.min(ms, 10 * 60_000);
  }
  // 3. JSON body retry_after field (float seconds, most precise)
  try {
    const body = await res.clone().json() as { retry_after?: number };
    if (body.retry_after && body.retry_after > 0) {
      return Math.min(Math.ceil(body.retry_after * 1000) + 500, 10 * 60_000);
    }
  } catch { /* ignore parse failure */ }

  return DEFAULT_COOLDOWN;
}

// ── Build full Chrome-like request headers ────────────────────────────────────
function buildHeaders(profile: UAProfile): Record<string, string> {
  return {
    "User-Agent":                 profile.ua,
    "Accept":                     "*/*",
    "Accept-Language":            "en-US,en;q=0.9",
    "Accept-Encoding":            "gzip, deflate, br",
    "Origin":                     "https://discord.com",
    "Referer":                    "https://discord.com/",
    "sec-ch-ua":                  profile.secChUa,
    "sec-ch-ua-mobile":           profile.mobile,
    "sec-ch-ua-platform":         profile.platform,
    "sec-fetch-dest":             "empty",
    "sec-fetch-mode":             "cors",
    "sec-fetch-site":             "same-origin",
    "X-Discord-Locale":           "en-US",
    "X-Discord-Timezone":         "America/New_York",
    "Cache-Control":              "no-cache",
    "Pragma":                     "no-cache",
    "Connection":                 "keep-alive",
  };
}

// ── Single code check via undici (supports proxy dispatcher) ─────────────────
async function checkSingle(code: string): Promise<CodeResult> {
  // Respect any active global rate-limit window before firing the request
  await waitForGlobalBackoff();

  const url = `https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`;
  const profile = nextProfile();
  const headers = buildHeaders(profile);

  const proxy = getNextNitroProxy();
  const dispatcher = makeDispatcher(proxy);

  const doFetch = async (disp: ProxyAgent | undefined): Promise<CodeResult> => {
    const res = await undiciFetch(url, {
      method:     "GET",
      headers,
      dispatcher: disp,
      signal:     AbortSignal.timeout(6_000),
    });

    if (res.status === 200) {
      recordSuccess();
      const data = await res.json() as { subscription_plan?: { name?: string } };
      return { code, status: "valid", plan: data?.subscription_plan?.name ?? "Nitro" };
    }
    if (res.status === 404) {
      recordSuccess();
      return { code, status: "invalid" };
    }
    if (res.status === 429) {
      const retryAfterMs = await parseRetryAfterMs(res);
      recordRateLimit(retryAfterMs);
      if (proxy) markBadProxy(proxy, retryAfterMs);
      return { code, status: "rate_limited", retryAfterMs };
    }
    return { code, status: "error" };
  };

  try {
    return await doFetch(dispatcher);
  } catch (err) {
    if (proxy) markBadProxy(proxy);
    try {
      return await doFetch(undefined);
    } catch {
      return { code, status: "error" };
    }
  }
}

// ── POST /api/nitro/check ─────────────────────────────────────────────────────
router.post("/nitro/check", async (req, res): Promise<void> => {
  const { codes } = req.body as { codes?: unknown };

  if (!Array.isArray(codes) || codes.length === 0) {
    res.status(400).json({ error: "codes must be a non-empty array of strings" });
    return;
  }

  if (codes.length > 500) {
    res.status(400).json({ error: "maximum 500 codes per request" });
    return;
  }

  const validCodes = codes.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  if (validCodes.length === 0) {
    res.status(400).json({ error: "no valid code strings provided" });
    return;
  }

  // 2 workers: enough to check in parallel without causing a burst of 4+ requests
  // simultaneously, which is what triggers Discord's rate limit detection.
  const CONCURRENCY = 2;
  const completed   = new Map<string, CodeResult>();

  async function worker(queue: string[], startDelayMs: number): Promise<void> {
    if (startDelayMs > 0) await new Promise(r => setTimeout(r, startDelayMs));
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) break;
      const result = await checkSingle(code);
      completed.set(code, result);
      // 400-700ms jitter between each check (each worker)
      if (queue.length > 0) await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
    }
  }

  const queue   = [...validCodes];
  const workers = Array.from({ length: Math.min(CONCURRENCY, validCodes.length) }, (_, i) =>
    worker(queue, i * 400),  // stagger workers by 400ms so they're out of phase
  );
  await Promise.all(workers);

  const ordered = validCodes.map(code => completed.get(code) ?? { code, status: "error" as CheckStatus });

  // Compute the median retry-after reported by 429 responses (useful for diagnostics)
  const retryAfterValues = ordered
    .filter(r => r.status === "rate_limited" && r.retryAfterMs)
    .map(r => r.retryAfterMs as number);
  const medianRetryAfter = retryAfterValues.length > 0
    ? retryAfterValues.sort((a, b) => a - b)[Math.floor(retryAfterValues.length / 2)]
    : null;

  res.json({
    results:         ordered,
    proxyCount:      proxyCache.length,
    badProxies:      badNitroProxies.size,
    checkedAt:       Date.now(),
    globalBackoffMs: Math.max(0, globalBackoffUntil - Date.now()),
    medianRetryAfterMs: medianRetryAfter,
  });
});

// ── GET /api/nitro/proxy-status ───────────────────────────────────────────────
router.get("/nitro/proxy-status", (_req, res): void => {
  const now = Date.now();
  res.json({
    totalProxies:     proxyCache.length,
    badProxies:       badNitroProxies.size,
    goodProxies:      Math.max(0, proxyCache.length - badNitroProxies.size),
    usingProxy:       proxyCache.length > 0,
    globalBackoffMs:  Math.max(0, globalBackoffUntil - now),
    consecutiveRateLimits,
  });
});

export default router;
