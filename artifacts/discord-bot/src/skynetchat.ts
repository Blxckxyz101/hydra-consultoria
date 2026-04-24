/**
 * SKYNETCHAT CLIENT
 *
 * Calls https://skynetchat.net/api/chat-V3 (Vercel AI SDK SSE streaming).
 * Authentication: cookie-based — requires SKYNETCHAT_COOKIE env var.
 *
 * How to get the cookie:
 *  1. Log into https://skynetchat.net in your browser
 *  2. Open DevTools → Application → Cookies → skynetchat.net
 *  3. Copy the full cookie string (all name=value pairs joined with "; ")
 *  4. Set it as the SKYNETCHAT_COOKIE environment secret
 *
 * Account rotation:
 *  When a 429 (rate limit) is hit, the bot automatically creates a new
 *  account using the Turnstile solver and rotates to it.
 *
 * Request format (Vercel AI SDK Data Stream):
 *   POST /api/chat-V3
 *   Body: { id, messages, trigger, messageId }
 *
 * Response format (SSE — Vercel AI Data Stream Protocol):
 *   data: 0:"text chunk"      ← text delta
 *   data: d:{...}             ← done signal
 *   data: e:{...}             ← error/finish signal
 */

import { randomUUID } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { createSkynetAccount, loginWithProCode, getCfClearanceViaProxy, type SkynetAccount, type CfCookies } from "./turnstile-solver.js";

/** Generate a 16-character alphanumeric ID matching SkyNetChat's format */
function genId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** SkyNetChat build version hash — used in pre-log calls */
const SKYNET_VERSION = "c26d13cf0144ea0c6b935eebe9e7ab9d";

// ── Webshare proxy pool for Cloudflare bypass ─────────────────────────────────
// SkyNetChat's /api/chat-* endpoints are behind Cloudflare Bot Management.
// Webshare proxies bypass the CF check — loaded from env vars.

function buildWebshareProxies(): string[] {
  const list  = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user  = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass  = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return [];
  return list.split(",").map(hp => `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hp.trim()}`);
}

const webshareProxies = buildWebshareProxies();
const failedProxies   = new Set<string>();   // temporarily failed proxies
let   workingProxy: string | null = null;    // last known good proxy URL
let   proxyIdx = 0;

if (webshareProxies.length > 0) {
  console.log(`[SKYNETCHAT] Webshare proxy pool: ${webshareProxies.length} proxies — Cloudflare bypass active`);
} else {
  console.warn("[SKYNETCHAT] No Webshare proxies configured (WEBSHARE_PROXY_LIST/USER/PASS)");
}

function nextProxy(): string | null {
  // Prefer Webshare proxies
  const available = webshareProxies.filter(p => !failedProxies.has(p));
  if (available.length === 0) {
    // All Webshare failed — reset and retry from start
    if (webshareProxies.length > 0) {
      failedProxies.clear();
      return webshareProxies[0];
    }
    return null;
  }
  proxyIdx = proxyIdx % available.length;
  return available[proxyIdx++];
}

// Reset failed set every 5 min — proxies recover
setInterval(() => failedProxies.clear(), 5 * 60 * 1000);

// ── cf_clearance cache ─────────────────────────────────────────────────────────
// Cloudflare JS challenge sets cf_clearance tied to the proxy's IP.
// We fetch it once per proxy (takes ~15s) and cache for 1 hour.
interface CfEntry { cookies: CfCookies; expiresAt: number; }
const cfCache = new Map<string, CfEntry>();                          // proxyUrl → CF cookies
const cfPending = new Map<string, Promise<CfCookies | null>>();      // in-flight solves

const CF_CLEARANCE_TTL = 25 * 60 * 1000; // 25 min — __cf_bm expires in ~30 min

async function getOrFetchCfClearance(proxyUrl: string): Promise<CfCookies | null> {
  // Return cached value if still fresh
  const cached = cfCache.get(proxyUrl);
  if (cached && Date.now() < cached.expiresAt) return cached.cookies;

  // Deduplicate concurrent requests for the same proxy
  const inflight = cfPending.get(proxyUrl);
  if (inflight) return inflight;

  const p = getCfClearanceViaProxy(proxyUrl).then((val) => {
    cfPending.delete(proxyUrl);
    if (val) {
      cfCache.set(proxyUrl, { cookies: val, expiresAt: Date.now() + CF_CLEARANCE_TTL });
      console.log(`[SKYNETCHAT] CF cookies cached for ${new URL(proxyUrl).hostname} (TTL 25min): ${val.cookieString.split(';').map(c=>c.trim().split('=')[0]).join(', ')}`);
    }
    return val;
  });
  cfPending.set(proxyUrl, p);
  return p;
}

// Pre-warm cf_clearance for the first proxy in the background on startup
if (webshareProxies.length > 0) {
  setTimeout(() => {
    console.log("[SKYNETCHAT] Pre-warming cf_clearance for first proxy...");
    void getOrFetchCfClearance(webshareProxies[0]);
  }, 2_000);
}

type FetchFn = (url: string, opts?: RequestInit) => Promise<Response>;

// Pro code for unlimited messages — read from env or fallback
const SKYNETCHAT_PRO_CODE = process.env["SKYNETCHAT_PRO_CODE"]?.trim() || "";

const SKYNETCHAT_BASE    = "https://skynetchat.net";
const SKYNETCHAT_TIMEOUT = 40_000;

export type SkynetMessage = { role: "user" | "assistant" | "system"; content: string };

/** Thrown when the free account message quota is exhausted (HTTP 429) and rotation also failed. */
export class SkynetRateLimitError extends Error {
  constructor(public readonly raw: string) {
    super("free message limit reached");
    this.name = "SkynetRateLimitError";
  }
}

// ── Account pool ───────────────────────────────────────────────────────────────

interface PoolEntry {
  cookie: string;   // full cookie string for the request
  limited: boolean; // true if this account has hit the 429
  source: "env" | "auto" | "pro";
}

const accountPool: PoolEntry[] = [];
let poolInitialized = false;
let creatingAccount = false; // prevent concurrent creation

function initPool() {
  if (poolInitialized) return;
  poolInitialized = true;
  const envRaw = process.env.SKYNETCHAT_COOKIE?.trim();
  if (envRaw) {
    // Auto-prefix with sid= if user pasted just the token value (without cookie name)
    const envCookie = (envRaw.startsWith("nid=") || envRaw.startsWith("sid="))
      ? envRaw
      : `sid=${envRaw}`;
    accountPool.push({ cookie: envCookie, limited: false, source: "env" });
    console.log("[SKYNETCHAT] Pool initialized with 1 env account");
  }
  // Async: load accounts from API server pool (accounts added via panel login)
  void loadPoolFromApiServer();
  // Note: Turnstile auto-solve is blocked on datacenter IPs (Cloudflare detects them).
  // To use the Pro code, log in manually at skynetchat.net and add cookies via the panel.
  // Refresh pool from API server every 5 minutes — picks up new cookies added via panel
  // Also resets "limited" flag on ALL accounts (rate limits reset daily on SkyNetChat)
  setInterval(() => {
    void loadPoolFromApiServer().then(() => {
      for (const acc of accountPool) {
        if (acc.limited) {
          acc.limited = false;
          console.log(`[SKYNETCHAT] Reset limited flag on ${acc.source} account (periodic refresh)`);
        }
      }
    });
  }, 5 * 60 * 1000);
}

async function loadPoolFromApiServer() {
  try {
    const res = await fetch("http://localhost:8080/api/skynetchat/pool");
    if (!res.ok) return;
    const accounts = await res.json() as Array<{ nid: string; sid: string }>;
    let added = 0;
    for (const acc of accounts) {
      if (!acc.sid) continue;
      const cookie = acc.nid ? `nid=${acc.nid}; sid=${acc.sid}` : `sid=${acc.sid}`;
      if (!accountPool.some(a => a.cookie === cookie)) {
        accountPool.push({ cookie, limited: false, source: "auto" });
        added++;
      }
    }
    if (added > 0)
      console.log(`[SKYNETCHAT] Loaded ${added} extra account(s) from API server pool`);
  } catch {
    // API server not yet up, ignore
  }
}

function getActiveCookie(): string | null {
  initPool();
  const active = accountPool.find(a => !a.limited);
  return active?.cookie ?? null;
}

function markCurrentLimited(cookie: string) {
  const entry = accountPool.find(a => a.cookie === cookie);
  if (entry) entry.limited = true;
  console.log(`[SKYNETCHAT] Account marked as rate-limited. Active accounts: ${accountPool.filter(a => !a.limited).length}/${accountPool.length}`);
}

function skynetAccountToCookie(account: SkynetAccount): string {
  return `nid=${account.nid}; sid=${account.sid}`;
}

async function acquireFreshAccount(): Promise<string | null> {
  if (creatingAccount) {
    // Wait for the ongoing creation
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (!creatingAccount) { clearInterval(check); resolve(); }
      }, 500);
      setTimeout(() => { clearInterval(check); resolve(); }, 60_000);
    });
    return getActiveCookie();
  }

  creatingAccount = true;
  try {
    let account: SkynetAccount | null = null;

    // Pro login via headless browser only works when 2captcha is configured.
    // On datacenter IPs (Replit), Cloudflare blocks Turnstile auto-solve.
    if (SKYNETCHAT_PRO_CODE && process.env.TWOCAPTCHA_API_KEY) {
      console.log("[SKYNETCHAT] Attempting Pro login via headless browser + 2captcha...");
      account = await loginWithProCode(SKYNETCHAT_PRO_CODE);
      if (account) {
        void fetch("http://localhost:8080/api/skynetchat/add-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nid: account.nid, sid: account.sid }),
        }).catch(() => {});
      }
    }

    if (!account && process.env.TWOCAPTCHA_API_KEY) {
      console.log("[SKYNETCHAT] Falling back to free account creation via 2captcha...");
      account = await createSkynetAccount();
    }

    if (!account) {
      console.warn(
        "[SKYNETCHAT] ⚠️  Pool vazio e sem 2captcha configurado.\n" +
        "    → Acesse o painel → aba SKY Login → cole os cookies nid+sid do skynetchat.net"
      );
      return null;
    }
    const cookie = skynetAccountToCookie(account);
    accountPool.push({ cookie, limited: false, source: SKYNETCHAT_PRO_CODE ? "pro" : "auto" });
    console.log(`[SKYNETCHAT] Account added to pool (total: ${accountPool.length})`);
    return cookie;
  } finally {
    creatingAccount = false;
  }
}

// ── Stream parser ──────────────────────────────────────────────────────────────

/**
 * Parses SkyNetChat SSE response body.
 * Handles:
 *   - New format (2025+): `{"type":"text-delta","delta":"..."}` and `{"type":"step-delta","delta":"..."}`
 *   - Old Vercel Data Stream: `0:"chunk"` prefix format
 */
function parseVercelAiStream(raw: string): string {
  const lines = raw.split("\n");
  const chunks: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;

    // New SkyNetChat format: JSON objects with type field
    if (payload.startsWith("{")) {
      try {
        const obj = JSON.parse(payload);
        // text-delta: actual response text chunks
        if (obj.type === "text-delta" && typeof obj.delta === "string") {
          chunks.push(obj.delta);
          continue;
        }
        // step-delta from a text step (fallback)
        if (obj.type === "step-delta" && obj.stepType !== "thinking" && typeof obj.delta === "string") {
          chunks.push(obj.delta);
          continue;
        }
      } catch { /* not JSON */ }
      continue;
    }

    // Old Vercel Data Stream Protocol — type prefix followed by JSON value
    // 0:"text"       → text delta
    // d:{...}        → done (finish)
    // e:{...}        → error/done
    // 2:[...]        → tool calls (skip)
    // 8:{...}        → metadata (skip)
    const colonIdx = payload.indexOf(":");
    if (colonIdx > 0) {
      const typeStr = payload.slice(0, colonIdx);
      const value   = payload.slice(colonIdx + 1);
      // Text delta type = "0"
      if (typeStr === "0") {
        try {
          const decoded = JSON.parse(value) as string;
          if (typeof decoded === "string") chunks.push(decoded);
        } catch { /* malformed chunk — skip */ }
        continue;
      }
      // Done/error signals — stop collecting
      if (typeStr === "d" || typeStr === "e") break;
    }

    // Legacy format: raw JSON objects
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      if (obj.type === "text-delta" && typeof obj.textDelta === "string") {
        chunks.push(obj.textDelta);
      } else if (obj.type === "finish" || obj.type === "done") {
        break;
      }
    } catch { /* not JSON — skip */ }
  }

  return chunks.join("");
}

// ── HTTP call ──────────────────────────────────────────────────────────────────

/** Returns true if response body looks like a Cloudflare JS challenge page */
function isCloudflareChallenge(body: string): boolean {
  return (
    body.includes("__CF$cv$params") ||
    body.includes("cf-browser-verification") ||
    body.includes("Checking your browser") ||
    body.includes("cf_clearance") ||
    body.includes("cloudflare") && body.includes("<html")
  );
}

async function doRequest(
  messages: SkynetMessage[],
  endpoint: string,
  cookie: string,
): Promise<{ status: number; body: string }> {
  const chatId = genId();
  const url    = `${SKYNETCHAT_BASE}/api/${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type":   "application/json",
    "Accept":         "text/event-stream, text/plain, */*",
    "Cookie":         cookie,
    "Origin":         SKYNETCHAT_BASE,
    "Referer":        `${SKYNETCHAT_BASE}/`,
    "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "sec-ch-ua":      '"Google Chrome";v="131", "Chromium";v="131", ";Not A Brand";v="99"',
    "sec-ch-ua-mobile":   "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };

  // Convert SkynetMessage[] → SkyNetChat's parts format
  // Old: { role, content: "text" }
  // New: { role, id, parts: [{ type: "text", text: "..." }] }
  const formattedMessages = messages.map((m) => ({
    role: m.role,
    id:   genId(),
    parts: [{ type: "text", text: m.content }],
  }));

  const bodyStr = JSON.stringify({
    id:       chatId,
    messages: formattedMessages,
    trigger:  "submit-message",
  });

  // Send pre-log calls required by the SkyNetChat frontend before each chat
  // These are fire-and-forget — we don't wait for them to finish
  const logHeaders = { ...headers, "Accept": "*/*" };
  void Promise.all([
    fetch(`${SKYNETCHAT_BASE}/api/log`, {
      method: "POST",
      headers: logHeaders,
      body: JSON.stringify({ v: SKYNET_VERSION, webrtcIp: null }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {}),
    fetch(`${SKYNETCHAT_BASE}/api/log/message`, {
      method: "POST",
      headers: logHeaders,
      body: JSON.stringify({ v: SKYNET_VERSION }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {}),
  ]);

  const MAX_PROXY_TRIES = Math.max(webshareProxies.length, 1);

  const tryWithProxy = async (proxyUrl: string | null): Promise<{ status: number; body: string } | null> => {
    try {
      let res: Response;
      if (proxyUrl) {
        // Get (or fetch) all Cloudflare cookies for this proxy's IP
        // cf_clearance + __cf_bm (Bot Management) — both tied to the proxy IP
        const cfCookies = await getOrFetchCfClearance(proxyUrl);
        const cookieWithCf = cfCookies
          ? `${cfCookies.cookieString}; ${cookie}`
          : cookie;

        const agent = new ProxyAgent(proxyUrl);
        res = await (undiciFetch as unknown as FetchFn)(url, {
          method: "POST",
          headers: { ...headers, "Cookie": cookieWithCf },
          body: bodyStr,
          // @ts-expect-error undici dispatcher
          dispatcher: agent,
          signal: AbortSignal.timeout(20_000),
        });
      } else {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: AbortSignal.timeout(SKYNETCHAT_TIMEOUT),
        });
      }
      const body = await res.text().catch(() => "");
      return { status: res.status, body };
    } catch {
      return null;
    }
  };

  // 1. Try last known working proxy first (fast path)
  if (workingProxy) {
    const r = await tryWithProxy(workingProxy);
    if (r && !isCloudflareChallenge(r.body)) {
      return r;
    }
    console.log("[SKYNETCHAT] Working proxy failed, rotating...");
    failedProxies.add(workingProxy);
    workingProxy = null;
  }

  // 2. Rotate through Webshare proxies
  for (let i = 0; i < MAX_PROXY_TRIES; i++) {
    const proxyUrl = nextProxy();

    const r = await tryWithProxy(proxyUrl);

    if (!r) {
      if (proxyUrl) failedProxies.add(proxyUrl);
      continue;
    }

    if (isCloudflareChallenge(r.body)) {
      if (proxyUrl) {
        failedProxies.add(proxyUrl);
        console.log(`[SKYNETCHAT] Proxy CF-blocked (${failedProxies.size}/${webshareProxies.length} failed)`);
      }
      continue;
    }

    if (proxyUrl) {
      workingProxy = proxyUrl;
      const host = proxyUrl.match(/@([^:]+):/)?.[1] ?? proxyUrl;
      console.log(`[SKYNETCHAT] ✅ Proxy OK: ${host}`);
    }
    return r;
  }

  // 3. Fallback: direct (may hit Cloudflare)
  console.warn("[SKYNETCHAT] All proxies exhausted — trying direct");
  return await tryWithProxy(null) ?? { status: 503, body: "" };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Calls SKYNETchat's /api/chat-V3 endpoint.
 * Automatically rotates to a fresh account if the current one hits the rate limit.
 *
 * @param messages  Conversation history (standard OpenAI role format)
 * @param endpoint  Which API to use (default: "chat-V3")
 * @returns         The assistant reply as plain text, or null on auth/network failure
 */
export async function askSkynet(
  messages:  SkynetMessage[],
  endpoint:  "chat-V3" | "chat-V2-fast" | "chat-V2-thinking" | "chat-V3-thinking" = "chat-V3",
): Promise<string | null> {
  initPool();

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let cookie = getActiveCookie();

    if (!cookie) {
      console.log("[SKYNETCHAT] No active account — creating one...");
      cookie = await acquireFreshAccount();
      if (!cookie) return null;
    }

    let result: { status: number; body: string };
    try {
      result = await doRequest(messages, endpoint, cookie);
    } catch (err) {
      console.error("[SKYNETCHAT] Network error:", err);
      return null;
    }

    const { status, body } = result;

    if (status === 401 || status === 403) {
      console.error(`[SKYNETCHAT] Auth failed (HTTP ${status}) — marking account invalid`);
      markCurrentLimited(cookie);
      continue;
    }

    if (status === 429) {
      console.warn(`[SKYNETCHAT] Rate limited (HTTP 429) — rotating account...`);
      markCurrentLimited(cookie);
      // Try to get next available or create new
      const next = getActiveCookie() ?? await acquireFreshAccount();
      if (!next) {
        throw new SkynetRateLimitError(body);
      }
      // Retry with new account on next iteration
      continue;
    }

    if (!result || status >= 400) {
      console.error(`[SKYNETCHAT] HTTP ${status} from ${endpoint}`);
      return null;
    }

    const text = parseVercelAiStream(body).trim();
    if (!text) {
      console.warn("[SKYNETCHAT] Empty response from stream — cookie may be expired or model unavailable");
      return null;
    }

    return text;
  }

  throw new SkynetRateLimitError("all accounts rate limited after rotation");
}

/** Returns true if SKYNETCHAT_COOKIE is configured or pool has active accounts. */
export function isSkynetConfigured(): boolean {
  initPool();
  return Boolean(process.env.SKYNETCHAT_COOKIE?.trim()) || accountPool.some(a => !a.limited);
}

/** Returns a summary of the current account pool status. */
export function getSkynetPoolStatus(): { total: number; active: number; limited: number } {
  initPool();
  const total   = accountPool.length;
  const limited = accountPool.filter(a => a.limited).length;
  return { total, active: total - limited, limited };
}

/**
 * Manually add an account to the pool (nid + sid from browser cookies).
 * Returns true if added successfully, false if already in pool.
 */
export async function addAccountToPool(nid: string, sid: string): Promise<{ ok: boolean; reason?: string }> {
  initPool();
  const cookie = `nid=${nid.trim()}; sid=${sid.trim()}`;

  // Check duplicate
  if (accountPool.some(a => a.cookie === cookie)) {
    return { ok: false, reason: "already_exists" };
  }

  // Validate by calling /api/session
  try {
    const res = await fetch(`${SKYNETCHAT_BASE}/api/session`, {
      headers: {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { ok: false, reason: "invalid_cookie" };
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const data = await res.json() as { id?: string; isPro?: boolean; messagesUsed?: number };
    if (!data.id) return { ok: false, reason: "no_user" };

    accountPool.push({ cookie, limited: false, source: "env" });
    console.log(`[SKYNETCHAT] Manual account added (id=${data.id}, used=${data.messagesUsed}). Pool: ${accountPool.length}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
