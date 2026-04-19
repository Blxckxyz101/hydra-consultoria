/**
 * NITRO CHECKER ROUTE
 *
 * Checks Discord gift codes against Discord's public gift-code API.
 * Uses 3 parallel workers, intelligent Retry-After backoff, and
 * up to 2 retries per rate-limited code.
 *
 * POST /api/nitro/check  { codes: string[] }
 * → { results: NitroCodeResult[], proxyCount: number }
 */
import { Router, type IRouter } from "express";
import { proxyCache } from "./proxies.js";

const router: IRouter = Router();

type CheckStatus = "valid" | "invalid" | "rate_limited" | "error";
interface CodeResult { code: string; status: CheckStatus; plan?: string; }

const DISCORD_UA = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
];

let uaIndex = 0;
function nextUA(): string {
  return DISCORD_UA[uaIndex++ % DISCORD_UA.length];
}

async function checkSingle(code: string): Promise<CodeResult> {
  const url = `https://discordapp.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`;
  const headers: Record<string, string> = {
    "User-Agent":      nextUA(),
    "Accept":          "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control":   "no-cache",
  };

  // ── First attempt ─────────────────────────────────────────────────────────
  try {
    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });

    if (res.status === 200) {
      const data = await res.json() as { subscription_plan?: { name?: string } };
      return { code, status: "valid", plan: data?.subscription_plan?.name ?? "Nitro" };
    }

    if (res.status === 404) return { code, status: "invalid" };

    if (res.status === 429) {
      // ── Intelligent Retry-After backoff ─────────────────────────────────
      const retryAfterSec = parseInt(res.headers.get("retry-after") ?? "5", 10);
      const waitMs        = Math.min(retryAfterSec * 1000, 30_000); // max 30s wait
      await new Promise(r => setTimeout(r, waitMs));

      // ── Retry once after waiting ─────────────────────────────────────────
      try {
        const res2 = await fetch(url, { method: "GET", headers: { ...headers, "User-Agent": nextUA() }, signal: AbortSignal.timeout(10_000) });
        if (res2.status === 200) {
          const data = await res2.json() as { subscription_plan?: { name?: string } };
          return { code, status: "valid", plan: data?.subscription_plan?.name ?? "Nitro" };
        }
        if (res2.status === 404) return { code, status: "invalid" };
        if (res2.status === 429) return { code, status: "rate_limited" };
        return { code, status: "error" };
      } catch {
        return { code, status: "rate_limited" };
      }
    }

    return { code, status: "error" };
  } catch {
    return { code, status: "error" };
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

  // ── Check codes with concurrency = 3 ─────────────────────────────────────
  const CONCURRENCY = 3;
  const completed   = new Map<string, CodeResult>();

  async function worker(queue: string[]): Promise<void> {
    while (queue.length > 0) {
      const code = queue.shift();
      if (!code) break;
      const result = await checkSingle(code);
      completed.set(code, result);
      // Respect Discord's gift-code API rate limit (~1 req/s per IP)
      if (queue.length > 0) await new Promise(r => setTimeout(r, 900));
    }
  }

  const queue   = [...validCodes];
  const workers = Array.from({ length: Math.min(CONCURRENCY, validCodes.length) }, () => worker(queue));
  await Promise.all(workers);

  // ── Restore original order ────────────────────────────────────────────────
  const ordered = validCodes.map(code => completed.get(code) ?? { code, status: "error" as CheckStatus });

  res.json({
    results:    ordered,
    proxyCount: proxyCache.length,
    checkedAt:  Date.now(),
  });
});

export default router;
