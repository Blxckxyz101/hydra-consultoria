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
import { createSkynetAccount, type SkynetAccount } from "./turnstile-solver.js";

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
  source: "env" | "auto";
}

const accountPool: PoolEntry[] = [];
let poolInitialized = false;
let creatingAccount = false; // prevent concurrent creation

function initPool() {
  if (poolInitialized) return;
  poolInitialized = true;
  const envCookie = process.env.SKYNETCHAT_COOKIE?.trim();
  if (envCookie) {
    accountPool.push({ cookie: envCookie, limited: false, source: "env" });
    console.log("[SKYNETCHAT] Pool initialized with 1 env account");
  }
  // Async: also load accounts from API server pool (accounts added via panel login)
  void loadPoolFromApiServer();
}

async function loadPoolFromApiServer() {
  try {
    const res = await fetch("http://localhost:8080/api/skynetchat/pool");
    if (!res.ok) return;
    const accounts = await res.json() as Array<{ nid: string; sid: string }>;
    let added = 0;
    for (const acc of accounts) {
      if (!acc.nid || !acc.sid) continue;
      const cookie = `nid=${acc.nid}; sid=${acc.sid}`;
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
    console.log("[SKYNETCHAT] Creating new account via Turnstile solver...");
    const account = await createSkynetAccount();
    if (!account) {
      console.error("[SKYNETCHAT] Failed to create new account");
      return null;
    }
    const cookie = skynetAccountToCookie(account);
    accountPool.push({ cookie, limited: false, source: "auto" });
    console.log(`[SKYNETCHAT] New account added to pool (total: ${accountPool.length})`);
    return cookie;
  } finally {
    creatingAccount = false;
  }
}

// ── Stream parser ──────────────────────────────────────────────────────────────

/**
 * Parses a Vercel AI SDK Data Stream SSE response body.
 * Handles both:
 *   - New Data Stream Protocol: `0:"chunk"` (JSON-encoded string after type prefix)
 *   - Legacy text-delta objects: `{"type":"text-delta","textDelta":"..."}`
 */
function parseVercelAiStream(raw: string): string {
  const lines = raw.split("\n");
  const chunks: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;

    // New Data Stream Protocol — type prefix followed by JSON value
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

async function doRequest(
  messages: SkynetMessage[],
  endpoint: string,
  cookie: string,
): Promise<{ status: number; body: string }> {
  const chatId    = randomUUID();
  const messageId = randomUUID();
  const url       = `${SKYNETCHAT_BASE}/api/${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "text/event-stream, text/plain, */*",
      "Cookie":        cookie,
      "Origin":        SKYNETCHAT_BASE,
      "Referer":       `${SKYNETCHAT_BASE}/`,
      "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ id: chatId, messages, trigger: "submit-message", messageId }),
    signal: AbortSignal.timeout(SKYNETCHAT_TIMEOUT),
  });

  const body = await res.text().catch(() => "");
  return { status: res.status, body };
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
