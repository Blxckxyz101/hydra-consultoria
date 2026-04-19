/**
 * NITRO CHECKER ROUTE
 *
 * Checks Discord gift codes against Discord's public gift-code API.
 * Uses 8 parallel workers, rotating HTTP proxies from proxyCache,
 * and intelligent Retry-After backoff.
 *
 * POST /api/nitro/check  { codes: string[] }
 * → { results: NitroCodeResult[], proxyCount: number }
 */
import { Router, type IRouter } from "express";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { proxyCache, type Proxy } from "./proxies.js";

const router: IRouter = Router();

type CheckStatus = "valid" | "invalid" | "rate_limited" | "error";
interface CodeResult { code: string; status: CheckStatus; plan?: string; }

const DISCORD_UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
];

let uaIndex = 0;
function nextUA(): string {
  return DISCORD_UA[uaIndex++ % DISCORD_UA.length];
}

// ── Proxy rotation for nitro checks ──────────────────────────────────────────
let nitroProxyIndex = 0;
const badNitroProxies = new Map<string, number>(); // key → expiry ts
const BAD_PROXY_TTL = 3 * 60 * 1000; // 3 min cooldown per bad proxy

function getNextNitroProxy(): Proxy | null {
  const now = Date.now();
  // Clean expired bad proxies
  for (const [k, exp] of badNitroProxies) {
    if (now > exp) badNitroProxies.delete(k);
  }

  const pool = proxyCache.filter(p => {
    const k = `${p.host}:${p.port}`;
    return !badNitroProxies.has(k);
  });

  if (pool.length === 0) return null; // no proxies → direct

  const p = pool[nitroProxyIndex % pool.length];
  nitroProxyIndex++;
  return p;
}

function markBadProxy(proxy: Proxy): void {
  // Residential/auth proxies rotate IPs on each connection — never mark them as bad
  if (proxy.username) return;
  badNitroProxies.set(`${proxy.host}:${proxy.port}`, Date.now() + BAD_PROXY_TTL);
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

// ── Single code check via undici (supports proxy dispatcher) ─────────────────
async function checkSingle(code: string): Promise<CodeResult> {
  const url = `https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`;
  const headers: Record<string, string> = {
    "User-Agent":      nextUA(),
    "Accept":          "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control":   "no-cache",
    "Pragma":          "no-cache",
  };

  const proxy = getNextNitroProxy();
  const dispatcher = makeDispatcher(proxy);

  const doFetch = async (disp: ProxyAgent | undefined): Promise<CodeResult> => {
    const res = await undiciFetch(url, {
      method:     "GET",
      headers,
      dispatcher: disp,
      signal:     AbortSignal.timeout(5_000),
    });

    if (res.status === 200) {
      const data = await res.json() as { subscription_plan?: { name?: string } };
      return { code, status: "valid", plan: data?.subscription_plan?.name ?? "Nitro" };
    }
    if (res.status === 404) return { code, status: "invalid" };
    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get("retry-after") ?? "2", 10);
      const waitMs = Math.min(retryAfterSec * 1000, 5_000);
      if (proxy) markBadProxy(proxy); // this proxy is rate-limited
      await new Promise(r => setTimeout(r, waitMs));

      // One retry with a fresh proxy
      const proxy2 = getNextNitroProxy();
      const disp2  = makeDispatcher(proxy2);
      try {
        const res2 = await undiciFetch(url, {
          method:     "GET",
          headers:    { ...headers, "User-Agent": nextUA() },
          dispatcher: disp2,
          signal:     AbortSignal.timeout(5_000),
        });
        if (res2.status === 200) {
          const data = await res2.json() as { subscription_plan?: { name?: string } };
          return { code, status: "valid", plan: data?.subscription_plan?.name ?? "Nitro" };
        }
        if (res2.status === 404)  return { code, status: "invalid" };
        if (res2.status === 429)  return { code, status: "rate_limited" };
        return { code, status: "error" };
      } catch {
        return { code, status: "rate_limited" };
      }
    }
    return { code, status: "error" };
  };

  try {
    return await doFetch(dispatcher);
  } catch (err) {
    // Proxy connection failed → mark bad and retry direct
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

  const CONCURRENCY = 8;
  const completed   = new Map<string, CodeResult>();

  async function worker(queue: string[]): Promise<void> {
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) break;
      const result = await checkSingle(code);
      completed.set(code, result);
    }
  }

  const queue   = [...validCodes];
  const workers = Array.from({ length: Math.min(CONCURRENCY, validCodes.length) }, () => worker(queue));
  await Promise.all(workers);

  const ordered = validCodes.map(code => completed.get(code) ?? { code, status: "error" as CheckStatus });

  res.json({
    results:    ordered,
    proxyCount: proxyCache.length,
    badProxies: badNitroProxies.size,
    checkedAt:  Date.now(),
  });
});

// ── GET /api/nitro/proxy-status ───────────────────────────────────────────────
router.get("/nitro/proxy-status", (_req, res): void => {
  res.json({
    totalProxies: proxyCache.length,
    badProxies:   badNitroProxies.size,
    goodProxies:  Math.max(0, proxyCache.length - badNitroProxies.size),
    usingProxy:   proxyCache.length > 0,
  });
});

export default router;
