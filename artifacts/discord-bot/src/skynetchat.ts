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

const SKYNETCHAT_BASE    = "https://skynetchat.net";
const SKYNETCHAT_TIMEOUT = 40_000;

export type SkynetMessage = { role: "user" | "assistant" | "system"; content: string };

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

/**
 * Calls SKYNETchat's /api/chat-V3 endpoint.
 *
 * @param messages  Conversation history (standard OpenAI role format)
 * @param endpoint  Which API to use (default: "chat-V3")
 * @returns         The assistant reply as plain text, or null on auth/network failure
 */
export async function askSkynet(
  messages:  SkynetMessage[],
  endpoint:  "chat-V3" | "chat-V2-fast" | "chat-V2-thinking" | "chat-V3-thinking" = "chat-V3",
): Promise<string | null> {
  const cookie = process.env.SKYNETCHAT_COOKIE?.trim();
  if (!cookie) return null;

  const chatId    = randomUUID();
  const messageId = randomUUID();
  const url       = `${SKYNETCHAT_BASE}/api/${endpoint}`;

  const body = JSON.stringify({
    id:        chatId,
    messages,
    trigger:   "submit-message",
    messageId,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Accept":        "text/event-stream, text/plain, */*",
        "Cookie":        cookie,
        "Origin":        SKYNETCHAT_BASE,
        "Referer":       `${SKYNETCHAT_BASE}/`,
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(SKYNETCHAT_TIMEOUT),
    });
  } catch (err) {
    console.error("[SKYNETCHAT] Network error:", err);
    return null;
  }

  if (res.status === 401 || res.status === 403) {
    console.error(`[SKYNETCHAT] Auth failed (HTTP ${res.status}) — cookie may be expired`);
    return null;
  }
  if (!res.ok) {
    console.error(`[SKYNETCHAT] HTTP ${res.status} from ${endpoint}`);
    return null;
  }

  let rawBody: string;
  try {
    rawBody = await res.text();
  } catch (err) {
    console.error("[SKYNETCHAT] Failed to read response body:", err);
    return null;
  }

  const text = parseVercelAiStream(rawBody).trim();
  if (!text) {
    console.warn("[SKYNETCHAT] Empty response from stream — cookie may be expired or model unavailable");
    return null;
  }

  return text;
}

/** Returns true if SKYNETCHAT_COOKIE is configured in the environment. */
export function isSkynetConfigured(): boolean {
  return Boolean(process.env.SKYNETCHAT_COOKIE?.trim());
}
