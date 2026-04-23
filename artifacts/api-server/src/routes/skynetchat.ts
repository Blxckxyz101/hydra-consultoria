import { Router } from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export default router;
