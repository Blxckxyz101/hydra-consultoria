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
  type: "user" | "post";
  extra?: string; // TikTok: username when identifier is a video ID
}

export function detectPlatform(input: string): PlatformInfo | null {
  const s = input.trim().replace(/^@/, "");

  // TikTok video/post
  const ttVideoMatch = s.match(/tiktok\.com\/@[^/?&\s]+\/video\/(\d{10,25})/);
  if (ttVideoMatch?.[1]) {
    const usernameM = s.match(/tiktok\.com\/@([^/?&\s]+)/);
    return { platform: "tiktok", identifier: ttVideoMatch[1], type: "post", extra: usernameM?.[1] };
  }

  // TikTok user
  const ttMatch = s.match(/tiktok\.com\/@([^/?&\s]+)/);
  if (ttMatch?.[1]) return { platform: "tiktok", identifier: ttMatch[1], type: "user" };

  // Instagram post/reel
  const igPostMatch = s.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]{8,14})/);
  if (igPostMatch?.[1]) return { platform: "instagram", identifier: igPostMatch[1], type: "post" };

  // Instagram user
  const igMatch = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (igMatch?.[1] && !["p","reel","stories","explore","accounts"].includes(igMatch[1]))
    return { platform: "instagram", identifier: igMatch[1], type: "user" };

  // Bare username → Instagram
  if (/^[a-zA-Z0-9_.]{2,30}$/.test(s)) return { platform: "instagram", identifier: s, type: "user" };

  return null;
}

// ── Instagram shortcode → media ID ───────────────────────────────────────────
const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function shortcodeToMediaId(shortcode: string): string {
  let id = BigInt(0);
  for (const c of shortcode) {
    const idx = IG_ALPHABET.indexOf(c);
    if (idx < 0) continue;
    id = id * BigInt(64) + BigInt(idx);
  }
  return id.toString();
}

const IG_REASONS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 18];
const TK_REASONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// ── Instagram: shared CSRF helper (with cookie file) ──────────────────────────
interface IgSession { csrf: string; cookiePath: string }

async function igGetSession(proxy: string[]): Promise<IgSession | null> {
  const cookiePath = `/tmp/ig_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    const page = await runCurl([...proxy, "--tlsv1.2", "-c", cookiePath,
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H", "Accept: text/html", "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "https://www.instagram.com/accounts/login/",
    ], 12_000);
    const csrf = page.body.match(/"csrf_token":"([^"]+)"/)?.[1]
              ?? page.body.match(/csrftoken=([^;"\s]+)/)?.[1] ?? "";
    if (!csrf) return null;
    return { csrf, cookiePath };
  } catch { return null; }
}

// ── Instagram user lookup ─────────────────────────────────────────────────────
async function igLookup(username: string): Promise<string | null> {
  // Scrape the user profile page via proxy (IG API requires login from our IPs)
  try {
    const proxy = pickProxy();
    const page = await runCurl([
      ...proxy,
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
    ], 15_000);
    const m = page.body.match(/"user_id"\s*:\s*"(\d+)"/)
           ?? page.body.match(/instapp:owner_user_id"\s+content="(\d+)"/)
           ?? page.body.match(/"id"\s*:\s*"(\d+)"/);
    if (m?.[1]) return m[1];
  } catch {}
  // Fallback: try IG API directly (may or may not work depending on IP reputation)
  try {
    const r = await runCurl([
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "-H", "X-IG-App-ID: 936619743392459",
      "-H", "Accept: */*", "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", "Referer: https://www.instagram.com/",
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    ], 12_000);
    const userId = JSON.parse(r.body)?.data?.user?.id ?? null;
    if (userId) return userId;
  } catch {}
  return null;
}

// ── Instagram account report — accepts pre-fetched session to avoid N CSRF hits ─
async function igReport(userId: string, reason: number, proxy: string[], session?: IgSession): Promise<boolean> {
  const sess = session ?? await igGetSession(proxy);
  const ownSession = !session;
  if (!sess) return false;
  try {
    const r = await runCurl([...proxy, "--tlsv1.2", "-X", "POST", "-b", sess.cookiePath,
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H", `X-CSRFToken: ${sess.csrf}`, "-H", "X-IG-App-ID: 936619743392459",
      "-H", "X-Instagram-AJAX: 1", "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Referer: https://www.instagram.com/",
      "--data-raw", `source_name=profile_page&reason_id=${reason}&frx_context=`,
      `https://www.instagram.com/users/${userId}/flag/`,
    ], 12_000);
    return r.statusCode === 200 || r.statusCode === 302;
  } catch { return false; }
  finally { if (ownSession) { try { fs.unlinkSync(sess.cookiePath); } catch {} } }
}

// ── Instagram post/reel report — accepts pre-fetched session ──────────────────
async function igMediaReport(mediaId: string, reason: number, proxy: string[], session?: IgSession): Promise<boolean> {
  const sess = session ?? await igGetSession(proxy);
  const ownSession = !session;
  if (!sess) return false;
  try {
    const r = await runCurl([...proxy, "--tlsv1.2", "-X", "POST", "-b", sess.cookiePath,
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H", `X-CSRFToken: ${sess.csrf}`, "-H", "X-IG-App-ID: 936619743392459",
      "-H", "X-Instagram-AJAX: 1", "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Referer: https://www.instagram.com/",
      "--data-raw", `reason_id=${reason}&frx_context=`,
      `https://www.instagram.com/media/${mediaId}/flag/`,
    ], 12_000);
    return r.statusCode === 200 || r.statusCode === 302;
  } catch { return false; }
  finally { if (ownSession) { try { fs.unlinkSync(sess.cookiePath); } catch {} } }
}

// ── TikTok ────────────────────────────────────────────────────────────────────
async function ttLookup(username: string): Promise<string | null> {
  const proxy = pickProxy();
  try {
    const page = await runCurl([
      ...proxy,
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      `https://www.tiktok.com/@${encodeURIComponent(username)}`,
    ], 15_000);
    return page.body.match(/"secUid":"([^"]+)"/)?.[1] ?? null;
  } catch { return null; }
}

const TK_UA = "com.zhiliaoapp.musically/2023130060 (Linux; U; Android 13; pt_BR; Pixel 7; Build/TQ3A; Cronet/112)";
const TK_ENDPOINTS = [
  "https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/report/",
  "https://api22-normal-c-useast2a.tiktokv.com/aweme/v1/report/",
];

async function ttReport(secUid: string, reason: number, proxy: string[]): Promise<boolean> {
  const body = `object_id=${encodeURIComponent(secUid)}&object_type=1&reason=${reason}&os_type=0&aid=1233&app_name=musically_go&channel=googleplay&device_platform=android&version_code=320000`;
  for (const ep of TK_ENDPOINTS) {
    try {
      const r = await runCurl([...proxy, "-X", "POST", "-H", `User-Agent: ${TK_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "X-TT-Locale: pt_BR", "--data-raw", body, ep,
      ], 12_000);
      if (r.statusCode === 200 && !r.body.includes('"status_code":1')) return true;
    } catch {}
  }
  return false;
}

// TikTok video/post report — object_type=4 (aweme)
async function ttVideoReport(videoId: string, reason: number, proxy: string[]): Promise<boolean> {
  const body = `object_id=${encodeURIComponent(videoId)}&object_type=4&reason=${reason}&os_type=0&aid=1233&app_name=musically_go&channel=googleplay&device_platform=android&version_code=320000`;
  for (const ep of TK_ENDPOINTS) {
    try {
      const r = await runCurl([...proxy, "-X", "POST", "-H", `User-Agent: ${TK_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "X-TT-Locale: pt_BR", "--data-raw", body, ep,
      ], 12_000);
      if (r.statusCode === 200 && !r.body.includes('"status_code":1')) return true;
    } catch {}
  }
  return false;
}

// ── Shared: executar uma rodada de reports ─────────────────────────────────────
async function runRound(
  info: PlatformInfo,
  qty: number,
  igUserId: string | null,
  igMediaId: string | null,
  ttSecUid: string | null,
  emit: (d: object) => void,
  stopped: () => boolean,
  roundLabel?: number,
): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;

  if (info.platform === "instagram") {
    // Get one session (CSRF + cookie) for the whole batch — avoids N login-page hits
    const proxy = pickProxy();
    let igSess = await igGetSession(proxy);
    try {
      for (let i = 0; i < qty && !stopped(); i++) {
        let ok = false;
        if (info.type === "post" && igMediaId) {
          ok = await igMediaReport(igMediaId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined);
          // Refresh session on failure
          if (!ok) { igSess = await igGetSession(proxy); ok = await igMediaReport(igMediaId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined); }
        } else if (igUserId) {
          ok = await igReport(igUserId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined);
          if (!ok) { igSess = await igGetSession(proxy); ok = await igReport(igUserId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined); }
        }
        ok ? sent++ : failed++;
        emit({ type: "progress", n: i + 1, total: qty, ok, platform: "instagram", ...(roundLabel ? { round: roundLabel } : {}) });
        if (i < qty - 1 && !stopped()) await rand(300, 800);
      }
    } finally {
      if (igSess) { try { fs.unlinkSync(igSess.cookiePath); } catch {} }
    }
  } else if (info.platform === "tiktok" && info.type === "post") {
    // TikTok video report — identifier is the video ID
    for (let i = 0; i < qty && !stopped(); i++) {
      const ok = await ttVideoReport(info.identifier, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
      ok ? sent++ : failed++;
      emit({ type: "progress", n: i + 1, total: qty, ok, platform: "tiktok", ...(roundLabel ? { round: roundLabel } : {}) });
      if (i < qty - 1 && !stopped()) await rand(250, 700);
    }
  } else if (info.platform === "tiktok" && ttSecUid) {
    for (let i = 0; i < qty && !stopped(); i++) {
      const ok = await ttReport(ttSecUid, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
      ok ? sent++ : failed++;
      emit({ type: "progress", n: i + 1, total: qty, ok, platform: "tiktok", ...(roundLabel ? { round: roundLabel } : {}) });
      if (i < qty - 1 && !stopped()) await rand(200, 600);
    }
  }

  return { sent, failed };
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
  if (!info) { res.status(400).json({ error: "Plataforma não reconhecida — suportamos Instagram e TikTok" }); return; }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? "5"), 10)), 50);

  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive", "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const emit = (d: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  let stopped = false;
  req.on("close", () => { stopped = true; });

  emit({ type: "start", platform: info.platform, target: info.identifier, subtype: info.type, total: qty });

  let igUserId: string | null = null;
  let igMediaId: string | null = null;
  let ttSecUid: string | null = null;

  try {
    if (info.platform === "instagram") {
      if (info.type === "post") {
        igMediaId = shortcodeToMediaId(info.identifier);
        emit({ type: "lookup", mediaId: igMediaId, shortcode: info.identifier, targetType: "post" });
      } else {
        igUserId = await igLookup(info.identifier);
        if (!igUserId) { emit({ type: "error", msg: "Usuário não encontrado no Instagram" }); res.end(); return; }
        emit({ type: "lookup", userId: igUserId, username: info.identifier, targetType: "account" });
      }
    } else if (info.platform === "tiktok") {
      if (info.type === "post") {
        // Video ID is already in identifier — no lookup needed
        emit({ type: "lookup", videoId: info.identifier, username: info.extra ?? "?", targetType: "video" });
      } else {
        ttSecUid = await ttLookup(info.identifier);
        if (!ttSecUid) { emit({ type: "error", msg: "Usuário não encontrado no TikTok" }); res.end(); return; }
        emit({ type: "lookup", secUid: ttSecUid.slice(0, 20) + "…", username: info.identifier, targetType: "account" });
      }
    }

    const { sent, failed } = await runRound(info, qty, igUserId, igMediaId, ttSecUid, emit, () => stopped);
    emit({ type: "done", sent, failed, total: qty });
  } catch (err) {
    emit({ type: "error", msg: String(err).slice(0, 100) });
    emit({ type: "done", sent: 0, failed: qty, total: qty });
  }

  res.end();
});

// ── GET /api/social/stream/loop ────────────────────────────────────────────────
// Loop infinito: dispara `quantity` reports, espera `interval` segundos, repete.
router.get("/stream/loop", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity, interval } = req.query as Record<string, string>;
  if (!rawUrl) { res.status(400).end(); return; }

  const info = detectPlatform(rawUrl);
  if (!info) { res.status(400).json({ error: "Plataforma não reconhecida" }); return; }

  const qty         = Math.min(Math.max(1, parseInt(String(quantity ?? "5"), 10)), 50);
  const intervalMs  = Math.min(Math.max(30, parseInt(String(interval ?? "60"), 10)), 3600) * 1000;

  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
    "Connection": "keep-alive", "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const emit = (d: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  let stopped = false;
  req.on("close", () => { stopped = true; });

  // Pre-lookup
  let igUserId: string | null = null;
  let igMediaId: string | null = null;
  let ttSecUid: string | null = null;

  emit({ type: "loop_init", platform: info.platform, target: info.identifier, subtype: info.type, qty, intervalSec: intervalMs / 1000 });

  try {
    if (info.platform === "instagram") {
      if (info.type === "post") {
        igMediaId = shortcodeToMediaId(info.identifier);
        emit({ type: "lookup", mediaId: igMediaId, shortcode: info.identifier, targetType: "post" });
      } else {
        igUserId = await igLookup(info.identifier);
        if (!igUserId) { emit({ type: "error", msg: "Usuário não encontrado no Instagram" }); res.end(); return; }
        emit({ type: "lookup", userId: igUserId, username: info.identifier, targetType: "account" });
      }
    } else if (info.platform === "tiktok") {
      if (info.type === "post") {
        emit({ type: "lookup", videoId: info.identifier, username: info.extra ?? "?", targetType: "video" });
      } else {
        ttSecUid = await ttLookup(info.identifier);
        if (!ttSecUid) { emit({ type: "error", msg: "Usuário não encontrado no TikTok" }); res.end(); return; }
        emit({ type: "lookup", secUid: ttSecUid.slice(0, 20) + "…", username: info.identifier, targetType: "account" });
      }
    }
  } catch (err) {
    emit({ type: "error", msg: String(err).slice(0, 100) }); res.end(); return;
  }

  let round = 0;
  let totalSent = 0, totalFailed = 0;

  while (!stopped && !res.writableEnded) {
    round++;
    emit({ type: "round_start", round, target: info.identifier, qty });

    try {
      const { sent, failed } = await runRound(info, qty, igUserId, igMediaId, ttSecUid, emit, () => stopped, round);
      totalSent   += sent;
      totalFailed += failed;
      emit({ type: "round_done", round, sent, failed, totalSent, totalFailed });
    } catch (err) {
      emit({ type: "error", msg: String(err).slice(0, 100) });
    }

    if (stopped || res.writableEnded) break;

    // Countdown until next round
    const endAt = Date.now() + intervalMs;
    while (!stopped && !res.writableEnded && Date.now() < endAt) {
      await sleep(1000);
      const remaining = Math.ceil((endAt - Date.now()) / 1000);
      if (remaining >= 0 && !res.writableEnded) {
        emit({ type: "cooldown", remaining, nextRound: round + 1 });
      }
    }
  }

  if (!res.writableEnded) {
    emit({ type: "loop_done", totalSent, totalFailed, rounds: round });
    res.end();
  }
});

// ── POST /api/social/report — para chamadas do Discord bot (retorna JSON) ─────
router.post("/report", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity } = req.body as Record<string, unknown>;
  if (!rawUrl || typeof rawUrl !== "string") { res.status(400).json({ error: "url obrigatório" }); return; }

  const info = detectPlatform(rawUrl.trim());
  if (!info) { res.status(400).json({ error: "Plataforma não reconhecida — suportamos Instagram e TikTok" }); return; }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? 5), 10)), 50);
  let sent = 0, failed = 0;

  try {
    if (info.platform === "instagram") {
      const proxy = pickProxy();
      let igSess = await igGetSession(proxy);
      try {
        if (info.type === "post") {
          const mediaId = shortcodeToMediaId(info.identifier);
          for (let i = 0; i < qty; i++) {
            let ok = await igMediaReport(mediaId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined);
            if (!ok) { igSess = await igGetSession(proxy); ok = await igMediaReport(mediaId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined); }
            ok ? sent++ : failed++;
            if (i < qty - 1) await sleep(300);
          }
        } else {
          const userId = await igLookup(info.identifier);
          if (userId) {
            for (let i = 0; i < qty; i++) {
              let ok = await igReport(userId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined);
              if (!ok) { igSess = await igGetSession(proxy); ok = await igReport(userId, IG_REASONS[i % IG_REASONS.length]!, proxy, igSess ?? undefined); }
              ok ? sent++ : failed++;
              if (i < qty - 1) await sleep(300);
            }
          } else { failed = qty; }
        }
      } finally {
        if (igSess) { try { fs.unlinkSync(igSess.cookiePath); } catch {} }
      }
    } else if (info.platform === "tiktok") {
      if (info.type === "post") {
        // Video report — ID is directly in identifier
        for (let i = 0; i < qty; i++) {
          const ok = await ttVideoReport(info.identifier, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
          ok ? sent++ : failed++;
          if (i < qty - 1) await sleep(250);
        }
      } else {
        const secUid = await ttLookup(info.identifier);
        if (secUid) {
          for (let i = 0; i < qty; i++) {
            const ok = await ttReport(secUid, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
            ok ? sent++ : failed++;
            if (i < qty - 1) await sleep(250);
          }
        } else { failed = qty; }
      }
    } else {
      failed = qty;
    }
  } catch { failed = qty - sent; }

  res.json({ platform: info.platform, target: info.identifier, subtype: info.type, sent, failed, total: qty });
});

export default router;
