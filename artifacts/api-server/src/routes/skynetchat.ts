import { Router } from "express";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const router = Router();

interface SkynetPoolAccount {
  nid: string;
  sid: string;
  addedAt: number;
  source: string;
}

const POOL_FILE = join(process.cwd(), ".skynet-pool.json");

function loadPool(): SkynetPoolAccount[] {
  try { return JSON.parse(readFileSync(POOL_FILE, "utf-8")); }
  catch { return []; }
}

function savePool(p: SkynetPoolAccount[]) {
  try { writeFileSync(POOL_FILE, JSON.stringify(p, null, 2)); } catch {}
}

let pool: SkynetPoolAccount[] = loadPool();

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

    // Extract nid + sid from Set-Cookie headers
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

    // Deduplicate + save
    pool = pool.filter(a => a.nid !== nid);
    pool.push({ nid, sid, addedAt: Date.now(), source: "panel" });
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

// Discord bot polls this to get extra accounts beyond SKYNETCHAT_COOKIE
router.get("/skynetchat/pool", (_req, res) => {
  res.json(pool);
});

export default router;
