import { Router } from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const router = Router();

interface SkynetPoolAccount {
  nid: string;
  sid: string;
  addedAt: number;
  lastSeen?: number;   // Last successful keepalive
  expired?: boolean;   // Marked when cookie stops working
  source: string;
}

const POOL_FILE = join(process.cwd(), ".skynet-pool.json");
const SKYNETCHAT_BASE = "https://skynetchat.net";
const KEEPALIVE_INTERVAL_MS = 25 * 60 * 1000; // 25 min (shorter than typical 30-min session)

function loadPool(): SkynetPoolAccount[] {
  try { return JSON.parse(readFileSync(POOL_FILE, "utf-8")); }
  catch { return []; }
}

function savePool(p: SkynetPoolAccount[]) {
  try { writeFileSync(POOL_FILE, JSON.stringify(p, null, 2)); } catch {}
}

let pool: SkynetPoolAccount[] = loadPool();

// ── Session validation + keepalive ───────────────────────────────────────────

async function pingAccount(acc: SkynetPoolAccount): Promise<boolean> {
  try {
    const cookie = `nid=${acc.nid}; sid=${acc.sid}`;
    // Lightweight GET to the homepage with cookies — keeps session alive
    const res = await fetch(`${SKYNETCHAT_BASE}/`, {
      headers: {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    // Any 2xx/3xx means session is alive. 401/403 = expired.
    return res.status < 400;
  } catch {
    return false; // Network error — assume still valid (don't remove)
  }
}

async function runKeepalive() {
  if (pool.length === 0) return;
  const now = Date.now();
  let changed = false;

  for (const acc of pool) {
    if (acc.expired) continue;
    const alive = await pingAccount(acc);
    if (alive) {
      acc.lastSeen = now;
      acc.expired = false;
    } else {
      // Only mark expired if it was previously alive (has lastSeen) or is old
      const ageMs = now - acc.addedAt;
      if (acc.lastSeen || ageMs > 60 * 60 * 1000) {
        console.log(`[SKYNETCHAT-POOL] Cookie expired — nid=${acc.nid.slice(0, 12)}...`);
        acc.expired = true;
      }
    }
    changed = true;
  }

  if (changed) savePool(pool);
  const active = pool.filter(a => !a.expired).length;
  console.log(`[SKYNETCHAT-POOL] Keepalive done — ${active}/${pool.length} accounts active`);
}

// Start keepalive loop
setInterval(() => { void runKeepalive(); }, KEEPALIVE_INTERVAL_MS);
// Initial ping 10s after startup
setTimeout(() => { void runKeepalive(); }, 10_000);

// ── SkyNetChat ask helper (SSE consumer) ─────────────────────────────────────

function genId16(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

const SKYNET_VERSION = "c26d13cf0144ea0c6b935eebe9e7ab9d";

function buildWebshareProxy(): string | null {
  const list = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return null;
  const ips = list.split(",").map(s => s.trim()).filter(Boolean);
  if (ips.length === 0) return null;
  const ip = ips[Math.floor(Math.random() * ips.length)];
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}`;
}

async function askViaSkynet(message: string, cookie: string): Promise<string> {
  const proxyUrl = buildWebshareProxy();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const fetchFn = dispatcher ? (u: string, o: Record<string, unknown>) => undiciFetch(u, { ...o, dispatcher }) : fetch;

  const headers = {
    "Content-Type":   "application/json",
    "Accept":         "text/event-stream",
    "Cookie":         cookie,
    "Origin":         "https://skynetchat.net",
    "Referer":        "https://skynetchat.net/",
    "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "x-forwarded-for": `${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
  };

  const logBody = JSON.stringify({ v: SKYNET_VERSION, webrtcIp: null });
  void fetchFn("https://skynetchat.net/api/log", { method: "POST", headers: { ...headers, "Accept": "application/json" }, body: logBody, signal: AbortSignal.timeout(5000) } as Record<string, unknown>).catch(() => {});
  void fetchFn("https://skynetchat.net/api/log/message", { method: "POST", headers: { ...headers, "Accept": "application/json" }, body: logBody, signal: AbortSignal.timeout(5000) } as Record<string, unknown>).catch(() => {});

  await new Promise(r => setTimeout(r, 300));

  const body = JSON.stringify({
    id: genId16(),
    messages: [{ role: "user", id: genId16(), parts: [{ type: "text", text: message }] }],
    trigger: "submit-message",
  });

  const res = await (fetchFn as typeof fetch)("https://skynetchat.net/api/chat-V3", {
    method:  "POST",
    headers: headers as Record<string, string>,
    body,
    signal:  AbortSignal.timeout(60_000),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const text = await res.text();
  let reply = "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const raw = t.slice(5).trim();
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj.type === "text-delta" && typeof obj.delta === "string") {
        reply += obj.delta;
      }
    } catch {
      if (raw.startsWith("0:")) {
        const inner = raw.slice(2);
        try { reply += JSON.parse(inner) as string; } catch { reply += inner.replace(/^"|"$/g, ""); }
      }
    }
  }
  return reply.trim();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Proxy login → forward real browser's Turnstile token to SKYNETchat
router.post("/skynetchat/proxy-login", async (req, res) => {
  const { code, turnstileToken, visitorId = "" } = (req.body ?? {}) as Record<string, string>;

  if (!code || !turnstileToken) {
    res.status(400).json({ success: false, error: "Missing code or turnstileToken" });
    return;
  }

  try {
    const formBody = new URLSearchParams({
      code:                    code.trim(),
      "cf-turnstile-response": turnstileToken,
      turnstileToken:          turnstileToken,
      visitorId:               visitorId,
    });

    const resp = await fetch("https://skynetchat.net/login", {
      method: "POST",
      headers: {
        "Content-Type":       "application/x-www-form-urlencoded",
        "x-sveltekit-action": "true",
        "Origin":             "https://skynetchat.net",
        "Referer":            "https://skynetchat.net/login",
        "User-Agent":         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: formBody.toString(),
    });

    const data = await resp.json() as Record<string, unknown>;

    if (data?.type === "failure" || data?.type === "error") {
      res.json({ success: false, error: JSON.stringify(data?.data ?? data) });
      return;
    }

    const rawCookies: string[] =
      (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (resp.headers.get("set-cookie") ? [resp.headers.get("set-cookie")!] : []);

    let nid = "", sid = "";
    for (const c of rawCookies) {
      const nMatch = c.match(/(?:^|;\s*)nid=([^;]+)/i);
      const sMatch = c.match(/(?:^|;\s*)sid=([^;]+)/i);
      if (nMatch) nid = nMatch[1];
      if (sMatch) sid = sMatch[1];
    }

    if (!nid || !sid) {
      res.json({
        success: false,
        error: `Login returned ${resp.status} but no session cookies. Body: ${JSON.stringify(data).slice(0, 200)}`,
      });
      return;
    }

    pool = pool.filter(a => a.nid !== nid);
    pool.push({ nid, sid, addedAt: Date.now(), lastSeen: Date.now(), source: "panel" });
    savePool(pool);

    res.json({
      success: true,
      message: `✅ Conta adicionada ao pool! Total: ${pool.length}`,
      preview: { nid: nid.slice(0, 16) + "...", sid: sid.slice(0, 16) + "..." },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ success: false, error: msg });
  }
});

// Manually add nid+sid (from browser DevTools, no Turnstile required)
router.post("/skynetchat/add-manual", async (req, res) => {
  const { nid, sid } = (req.body ?? {}) as Record<string, string>;
  if (!sid) {
    res.status(400).json({ success: false, error: "sid is required" });
    return;
  }

  const entry: SkynetPoolAccount = { nid: nid ?? "", sid, addedAt: Date.now(), source: "manual" };

  // Immediately validate the cookie
  const alive = await pingAccount(entry);
  entry.lastSeen = alive ? Date.now() : undefined;
  entry.expired = !alive;

  pool = pool.filter(a => a.sid !== sid);
  pool.push(entry);
  savePool(pool);

  res.json({
    success: true,
    message: alive
      ? `✅ Cookie válido e salvo! Total: ${pool.length}`
      : `⚠️ Cookie salvo mas parece inválido/expirado (HTTP error). Total: ${pool.length}`,
    valid: alive,
    preview: { nid: nid ? nid.slice(0, 16) + "..." : "(none)", sid: sid.slice(0, 16) + "..." },
  });
});

// Manual keepalive trigger (useful from the panel)
router.post("/skynetchat/keepalive", async (_req, res) => {
  await runKeepalive();
  const active = pool.filter(a => !a.expired).length;
  res.json({ success: true, active, total: pool.length });
});

// Remove one account from pool by sid
router.delete("/skynetchat/pool/:sid", (req, res) => {
  const { sid } = req.params;
  const before = pool.length;
  pool = pool.filter(a => a.sid !== sid);
  savePool(pool);
  res.json({ success: true, removed: before - pool.length, total: pool.length });
});

// Discord bot polls this to get extra accounts beyond SKYNETCHAT_COOKIE
router.get("/skynetchat/pool", (_req, res) => {
  // Only return non-expired accounts
  res.json(pool.filter(a => !a.expired));
});

// ── Session status — shows real account info (isPro, messagesUsed, etc.) ─────
router.get("/skynetchat/session-status", async (_req, res) => {
  const results: Array<{
    source: string;
    nid: string;
    isPro: boolean | null;
    messagesUsed: number | null;
    messagesMax: number | null;
    dailyLimit: number | null;
    subscriptionExpired: boolean | null;
    proExpiresAt: string | null;
    sessionOk: boolean;
    error?: string;
  }> = [];

  // Check env cookie — auto-prefix sid= if user pasted raw token
  const envRaw = process.env.SKYNETCHAT_COOKIE?.trim();
  const envCookie = envRaw
    ? ((envRaw.startsWith("nid=") || envRaw.startsWith("sid=")) ? envRaw : `sid=${envRaw}`)
    : undefined;
  if (envCookie) {
    try {
      const r = await fetch("https://skynetchat.net/api/session", {
        headers: {
          "Cookie": envCookie,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        const d = await r.json() as { user?: Record<string, unknown> };
        const u = d.user ?? d as Record<string, unknown>;
        results.push({
          source: "env (SKYNETCHAT_COOKIE)",
          nid: (u.numberId as string ?? "").slice(0, 12),
          isPro: (u.isPro as boolean) ?? null,
          messagesUsed: (u.messagesUsed as number) ?? null,
          messagesMax: (u.messagesMax as number) ?? null,
          dailyLimit: (u.dailyLimit as number) ?? null,
          subscriptionExpired: (u.subscriptionExpired as boolean) ?? null,
          proExpiresAt: (u.proExpiresAt as string) ?? null,
          sessionOk: true,
        });
      } else {
        results.push({ source: "env (SKYNETCHAT_COOKIE)", nid: "", isPro: null, messagesUsed: null, messagesMax: null, dailyLimit: null, subscriptionExpired: null, proExpiresAt: null, sessionOk: false, error: `HTTP ${r.status}` });
      }
    } catch (e) {
      results.push({ source: "env (SKYNETCHAT_COOKIE)", nid: "", isPro: null, messagesUsed: null, messagesMax: null, dailyLimit: null, subscriptionExpired: null, proExpiresAt: null, sessionOk: false, error: String(e) });
    }
  }

  // Check pool accounts
  for (const acc of pool.filter(a => !a.expired)) {
    const cookie = `nid=${acc.nid}; sid=${acc.sid}`;
    try {
      const r = await fetch("https://skynetchat.net/api/session", {
        headers: { "Cookie": cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        const d = await r.json() as { user?: Record<string, unknown> };
        const u = d.user ?? d as Record<string, unknown>;
        results.push({
          source: `pool (${acc.source})`,
          nid: acc.nid.slice(0, 12),
          isPro: (u.isPro as boolean) ?? null,
          messagesUsed: (u.messagesUsed as number) ?? null,
          messagesMax: (u.messagesMax as number) ?? null,
          dailyLimit: (u.dailyLimit as number) ?? null,
          subscriptionExpired: (u.subscriptionExpired as boolean) ?? null,
          proExpiresAt: (u.proExpiresAt as string) ?? null,
          sessionOk: true,
        });
      } else {
        results.push({ source: `pool (${acc.source})`, nid: acc.nid.slice(0, 12), isPro: null, messagesUsed: null, messagesMax: null, dailyLimit: null, subscriptionExpired: null, proExpiresAt: null, sessionOk: false, error: `HTTP ${r.status}` });
      }
    } catch (e) {
      results.push({ source: `pool (${acc.source})`, nid: acc.nid.slice(0, 12), isPro: null, messagesUsed: null, messagesMax: null, dailyLimit: null, subscriptionExpired: null, proExpiresAt: null, sessionOk: false, error: String(e) });
    }
  }

  res.json({ accounts: results, total: results.length });
});

// Ask endpoint — used by Telegram bot and other clients
// POST /api/skynetchat/ask  { message: string }
// Returns { reply: string } or { error: string }
//
// Strategy:
//  1. Try the Discord bot's internal server (port 8089) — it has CF clearance + proxy rotation
//  2. Fallback to direct call (askViaSkynet) if Discord bot is unavailable
router.post("/skynetchat/ask", async (req, res) => {
  const { message } = (req.body ?? {}) as Record<string, string>;
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // ── Strategy 1: Discord bot internal server (has CF clearance) ────────────
  try {
    const r = await fetch("http://127.0.0.1:8089/ask", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: message.trim() }),
      signal:  AbortSignal.timeout(75_000),
    });
    const data = await r.json() as { reply?: string; error?: string };
    if (r.ok && data.reply) {
      res.json({ reply: data.reply });
      return;
    }
    if (r.status === 429) {
      res.status(429).json({ error: "rate_limit", message: "Limite de mensagens atingido." });
      return;
    }
    // Non-OK but not 429 → fall through to strategy 2
    console.warn("[SKYNET-ASK] Discord bot returned non-OK:", r.status, data);
  } catch (e) {
    // Discord bot unavailable (not started yet, or crashed) → fall through
    console.warn("[SKYNET-ASK] Discord bot internal server unavailable, falling back:", (e as Error).message?.slice(0, 80));
  }

  // ── Strategy 2: Direct call (no CF clearance, but works sometimes) ─────────
  const envRaw = process.env.SKYNETCHAT_COOKIE?.trim();
  let cookie: string | null = envRaw
    ? ((envRaw.startsWith("nid=") || envRaw.startsWith("sid=")) ? envRaw : `sid=${envRaw}`)
    : null;

  if (!cookie) {
    const active = pool.filter(a => !a.expired);
    if (active.length === 0) {
      res.status(503).json({ error: "no_accounts", message: "Nenhuma conta SkyNetChat disponível no pool." });
      return;
    }
    const acc = active[Math.floor(Math.random() * active.length)];
    cookie = `nid=${acc.nid}; sid=${acc.sid}`;
  }

  try {
    const reply = await askViaSkynet(message.trim(), cookie);
    if (!reply) {
      res.status(502).json({ error: "empty_reply", message: "SkyNetChat não retornou resposta." });
      return;
    }
    res.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "RATE_LIMIT") {
      res.status(429).json({ error: "rate_limit", message: "Limite de mensagens atingido." });
    } else {
      res.status(502).json({ error: "ask_failed", message: msg });
    }
  }
});

export default router;
