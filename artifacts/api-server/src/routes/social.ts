import { Router }   from "express";
import { spawn }    from "child_process";
import * as fs      from "fs";
import { proxyCache, getResidentialCreds } from "./proxies.js";

const router = Router();

interface CurlResult { statusCode: number; body: string }
function runCurl(argv: string[], timeoutMs = 15_000): Promise<CurlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "--silent", "--show-error", "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--write-out", "\n---STATUS:%{http_code}---",
      "--compressed", "-L", ...argv,
    ]);
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", () => {});
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("TIMEOUT")); }, timeoutMs + 2000);
    child.on("close", () => {
      clearTimeout(timer);
      const sep  = out.lastIndexOf("---STATUS:");
      const body = sep >= 0 ? out.slice(0, sep).trimEnd() : out.trimEnd();
      const code = sep >= 0 ? parseInt(out.slice(sep + 10).replace("---", ""), 10) : 0;
      resolve({ statusCode: isNaN(code) ? 0 : code, body });
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function pickProxy(): string[] {
  const pool = proxyCache.filter(p => p.username && p.password && p.host !== "0.0.0.0");
  const seen = new Set<string>();
  const unique = pool.filter(p => { const k = `${p.host}:${p.port}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (unique.length > 0) {
    const p = unique[Math.floor(Math.random() * unique.length)]!;
    return ["-x", `http://${p.username}:${p.password}@${p.host}:${p.port}`];
  }
  const c = getResidentialCreds();
  if (c) return ["-x", `http://${c.username}:${c.password}@${c.host}:${c.port}`];
  return [];
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const rand  = (min: number, max: number) => sleep(min + Math.random() * (max - min));

// ── Platform detection ────────────────────────────────────────────────────────
export interface PlatformInfo {
  platform: "instagram" | "tiktok";
  identifier: string;
  type: "user";
}

export function detectPlatform(input: string): PlatformInfo | null {
  const s = input.trim().replace(/^@/, "");
  const ttMatch = s.match(/tiktok\.com\/@([^/?&\s]+)/);
  if (ttMatch?.[1]) return { platform: "tiktok", identifier: ttMatch[1], type: "user" };
  const igMatch = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (igMatch?.[1] && igMatch[1] !== "p" && igMatch[1] !== "reel" && igMatch[1] !== "stories")
    return { platform: "instagram", identifier: igMatch[1], type: "user" };
  if (/^[a-zA-Z0-9_.]{2,30}$/.test(s)) return { platform: "instagram", identifier: s, type: "user" };
  return null;
}

const IG_REASONS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 18];
const TK_REASONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// ── Instagram ─────────────────────────────────────────────────────────────────
async function igLookup(username: string): Promise<string | null> {
  try {
    const r = await runCurl([
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "-H", "X-IG-App-ID: 936619743392459",
      "-H", "Accept: */*",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", "Sec-Fetch-Site: same-origin",
      "-H", "Sec-Fetch-Mode: cors",
      "-H", "Sec-Fetch-Dest: empty",
      "-H", "Referer: https://www.instagram.com/",
      "-H", "Origin: https://www.instagram.com",
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    ], 12_000);
    return JSON.parse(r.body)?.data?.user?.id ?? null;
  } catch { return null; }
}

async function igReport(userId: string, reason: number, proxy: string[]): Promise<boolean> {
  const ck = `/tmp/ig_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    const page = await runCurl([...proxy, "--tlsv1.2", "-c", ck,
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H", "Accept: text/html", "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "https://www.instagram.com/accounts/login/",
    ], 12_000);
    const csrf = page.body.match(/"csrf_token":"([^"]+)"/)?.[1]
              ?? page.body.match(/csrftoken=([^;"\s]+)/)?.[1] ?? "";
    if (!csrf) return false;
    const r = await runCurl([...proxy, "--tlsv1.2", "-X", "POST", "-b", ck,
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H", `X-CSRFToken: ${csrf}`, "-H", "X-IG-App-ID: 936619743392459",
      "-H", "X-Instagram-AJAX: 1", "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Referer: https://www.instagram.com/",
      "--data-raw", `source_name=profile_page&reason_id=${reason}&frx_context=`,
      `https://www.instagram.com/users/${userId}/flag/`,
    ], 12_000);
    return r.statusCode === 200 || r.statusCode === 302;
  } catch { return false; }
  finally { try { fs.unlinkSync(ck); } catch {} }
}

// ── TikTok ────────────────────────────────────────────────────────────────────
async function ttLookup(username: string): Promise<string | null> {
  try {
    const page = await runCurl([
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      `https://www.tiktok.com/@${encodeURIComponent(username)}`,
    ], 15_000);
    return page.body.match(/"secUid":"([^"]+)"/)?.[1] ?? null;
  } catch { return null; }
}

async function ttReport(secUid: string, reason: number, proxy: string[]): Promise<boolean> {
  const UA = "com.zhiliaoapp.musically/2023130060 (Linux; U; Android 13; pt_BR; Pixel 7; Build/TQ3A; Cronet/112)";
  const body = `object_id=${encodeURIComponent(secUid)}&object_type=1&reason=${reason}&os_type=0&aid=1233&app_name=musically_go&channel=googleplay&device_platform=android&version_code=320000`;
  for (const ep of [
    "https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/report/",
    "https://api22-normal-c-useast2a.tiktokv.com/aweme/v1/report/",
  ]) {
    try {
      const r = await runCurl([...proxy, "-X", "POST", "-H", `User-Agent: ${UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "X-TT-Locale: pt_BR", "--data-raw", body, ep,
      ], 12_000);
      if (r.statusCode === 200 && !r.body.includes('"status_code":1')) return true;
    } catch {}
  }
  return false;
}

// ── GET /api/social/lookup ────────────────────────────────────────────────────
router.get("/lookup", (req, res): void => {
  const { url: u } = req.query as Record<string, string>;
  if (!u) { res.status(400).json({ error: "url obrigatório" }); return; }
  const info = detectPlatform(u.trim());
  if (!info) { res.status(400).json({ error: "Plataforma não reconhecida — suportamos Instagram e TikTok" }); return; }
  res.json(info);
});

// ── GET /api/social/stream/report ─────────────────────────────────────────────
router.get("/stream/report", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity } = req.query as Record<string, string>;
  if (!rawUrl) { res.status(400).end(); return; }

  const info = detectPlatform(rawUrl);
  if (!info) {
    res.status(400).json({ error: "Plataforma não reconhecida — suportamos Instagram e TikTok" });
    return;
  }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? "5"), 10)), 50);

  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive", "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const emit = (d: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  emit({ type: "start", platform: info.platform, target: info.identifier, total: qty });

  let sent = 0, failed = 0;

  try {
    if (info.platform === "instagram") {
      const userId = await igLookup(info.identifier);
      if (!userId) { emit({ type: "error", msg: "Usuário não encontrado no Instagram" }); res.end(); return; }
      emit({ type: "lookup", userId, username: info.identifier });
      for (let i = 0; i < qty; i++) {
        const ok = await igReport(userId, IG_REASONS[i % IG_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        emit({ type: "progress", n: i + 1, total: qty, ok, platform: "instagram" });
        if (i < qty - 1) await rand(300, 800);
      }
    } else if (info.platform === "tiktok") {
      const secUid = await ttLookup(info.identifier);
      if (!secUid) { emit({ type: "error", msg: "Usuário não encontrado no TikTok" }); res.end(); return; }
      emit({ type: "lookup", secUid: secUid.slice(0, 20) + "…", username: info.identifier });
      for (let i = 0; i < qty; i++) {
        const ok = await ttReport(secUid, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        emit({ type: "progress", n: i + 1, total: qty, ok, platform: "tiktok" });
        if (i < qty - 1) await rand(200, 600);
      }
    }
  } catch (err) {
    emit({ type: "error", msg: String(err).slice(0, 100) });
  }

  emit({ type: "done", sent, failed, total: qty });
  res.end();
});

// ── POST /api/social/report — para chamadas do Discord bot (retorna JSON) ─────
router.post("/report", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity } = req.body as Record<string, unknown>;
  if (!rawUrl || typeof rawUrl !== "string") { res.status(400).json({ error: "url obrigatório" }); return; }

  const info = detectPlatform(rawUrl.trim());
  if (!info) {
    res.status(400).json({ error: "Plataforma não reconhecida — suportamos Instagram e TikTok" });
    return;
  }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? 5), 10)), 50);
  let sent = 0, failed = 0;

  try {
    if (info.platform === "instagram") {
      const userId = await igLookup(info.identifier);
      if (userId) {
        for (let i = 0; i < qty; i++) {
          const ok = await igReport(userId, IG_REASONS[i % IG_REASONS.length]!, pickProxy());
          ok ? sent++ : failed++;
          if (i < qty - 1) await sleep(300);
        }
      } else { failed = qty; }
    } else if (info.platform === "tiktok") {
      const secUid = await ttLookup(info.identifier);
      if (secUid) {
        for (let i = 0; i < qty; i++) {
          const ok = await ttReport(secUid, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
          ok ? sent++ : failed++;
          if (i < qty - 1) await sleep(250);
        }
      } else { failed = qty; }
    } else {
      failed = qty;
    }
  } catch { failed = qty - sent; }

  res.json({ platform: info.platform, target: info.identifier, sent, failed, total: qty });
});

export default router;
