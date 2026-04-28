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
  platform: "instagram"|"tiktok"|"youtube"|"facebook"|"twitter"|"kwai"|"twitch";
  identifier: string;
  type: "user"|"video"|"channel";
}

export function detectPlatform(input: string): PlatformInfo | null {
  const s = input.trim().replace(/^@/, "");
  const checks: Array<{ re: RegExp; platform: PlatformInfo["platform"]; type: PlatformInfo["type"] }> = [
    { re: /tiktok\.com\/@([^/?&\s]+)/,                        platform: "tiktok",    type: "user" },
    { re: /instagram\.com\/([a-zA-Z0-9_.]+)/,                 platform: "instagram", type: "user" },
    { re: /youtube\.com\/@([a-zA-Z0-9_.@-]+)/,                platform: "youtube",   type: "channel" },
    { re: /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/,        platform: "youtube",   type: "channel" },
    { re: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&/?]+)/, platform: "youtube",   type: "video" },
    { re: /facebook\.com\/([a-zA-Z0-9._-]+)/,                 platform: "facebook",  type: "user" },
    { re: /(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/,              platform: "twitter",   type: "user" },
    { re: /kwai\.com\/(?:[^/]+\/)([a-zA-Z0-9_]+)/,            platform: "kwai",      type: "user" },
    { re: /twitch\.tv\/([a-zA-Z0-9_]+)/,                      platform: "twitch",    type: "user" },
  ];
  for (const { re, platform, type } of checks) {
    const m = s.match(re);
    if (m?.[1] && m[1] !== "watch" && m[1] !== "shorts") return { platform, identifier: m[1], type };
  }
  if (/^[a-zA-Z0-9_.]{2,30}$/.test(s)) return { platform: "instagram", identifier: s, type: "user" };
  return null;
}

const IG_REASONS = [1, 2, 3, 4, 5, 7, 8, 9, 11, 18];
const TK_REASONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const YT_REASONS = ["40","1","29","36","2","45"];
const FB_REASONS = ["spam","harassment","hate_speech","violence","false_news","nudity"];
const TW_BEARER  = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// ── Instagram ─────────────────────────────────────────────────────────────────
async function igLookup(username: string): Promise<string|null> {
  try {
    const r = await runCurl([
      "-H","User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H","X-IG-App-ID: 936619743392459",
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    ], 12_000);
    return JSON.parse(r.body)?.data?.user?.id ?? null;
  } catch { return null; }
}

async function igReport(userId: string, reason: number, proxy: string[]): Promise<boolean> {
  const ck = `/tmp/ig_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    const page = await runCurl([...proxy,"--tlsv1.2","-c",ck,
      "-H","User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H","Accept: text/html","-H","Accept-Language: pt-BR,pt;q=0.9",
      "https://www.instagram.com/accounts/login/",
    ], 12_000);
    const csrf = page.body.match(/"csrf_token":"([^"]+)"/)?.[1]
              ?? page.body.match(/csrftoken=([^;"\s]+)/)?.[1] ?? "";
    if (!csrf) return false;
    const r = await runCurl([...proxy,"--tlsv1.2","-X","POST","-b",ck,
      "-H","User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "-H",`X-CSRFToken: ${csrf}`,"-H","X-IG-App-ID: 936619743392459",
      "-H","X-Instagram-AJAX: 1","-H","Content-Type: application/x-www-form-urlencoded",
      "-H","Referer: https://www.instagram.com/",
      "--data-raw",`source_name=profile_page&reason_id=${reason}&frx_context=`,
      `https://www.instagram.com/users/${userId}/flag/`,
    ], 12_000);
    return r.statusCode === 200 || r.statusCode === 302;
  } catch { return false; }
  finally { try { fs.unlinkSync(ck); } catch {} }
}

// ── TikTok ────────────────────────────────────────────────────────────────────
async function ttLookup(username: string): Promise<string|null> {
  try {
    const page = await runCurl([
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H","Accept-Language: pt-BR,pt;q=0.9",
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
      const r = await runCurl([...proxy,"-X","POST","-H",`User-Agent: ${UA}`,
        "-H","Content-Type: application/x-www-form-urlencoded",
        "-H","X-TT-Locale: pt_BR","--data-raw",body,ep,
      ], 12_000);
      if (r.statusCode === 200 && !r.body.includes('"status_code":1')) return true;
    } catch {}
  }
  return false;
}

// ── YouTube ───────────────────────────────────────────────────────────────────
interface YtSess { key: string; vis: string; ver: string }

async function ytSession(proxy: string[]): Promise<YtSess|null> {
  try {
    const r = await runCurl([...proxy,
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "https://www.youtube.com/",
    ], 15_000);
    const key = r.body.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? "";
    const vis = r.body.match(/"visitorData":"([^"]+)"/)?.[1] ?? "";
    const ver = r.body.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? "2.20240101.00.00";
    return key ? { key, vis, ver } : null;
  } catch { return null; }
}

async function ytGetVideos(handle: string, proxy: string[]): Promise<string[]> {
  try {
    const r = await runCurl([...proxy,
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      `https://www.youtube.com/@${encodeURIComponent(handle)}/videos`,
    ], 15_000);
    const ids = [...new Set([...r.body.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m=>m[1]))];
    return ids.slice(0, 8);
  } catch { return []; }
}

async function ytFlag(videoId: string, reasonId: string, sess: YtSess, proxy: string[]): Promise<boolean> {
  try {
    const r = await runCurl([...proxy,"-X","POST",
      `https://www.youtube.com/youtubei/v1/flag/flag?key=${sess.key}&prettyPrint=false`,
      "-H","Content-Type: application/json",
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H",`X-Goog-Visitor-Id: ${sess.vis}`,
      "--data-raw",JSON.stringify({
        context:{ client:{ clientName:"WEB",clientVersion:sess.ver,hl:"pt",gl:"BR",visitorData:sess.vis } },
        flaggedContent:{ videoFlaggedContent:{ externalVideoId: videoId } },
        reasonInfos:[{ id: reasonId, secondaryReasonInfos:[] }],
      }),
    ], 12_000);
    return r.statusCode === 200;
  } catch { return false; }
}

// ── Facebook ──────────────────────────────────────────────────────────────────
async function fbReport(username: string, reason: string, proxy: string[]): Promise<boolean> {
  const ck = `/tmp/fb_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    const page = await runCurl([...proxy,"-c",ck,
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H","Accept-Language: pt-BR,pt;q=0.9",
      `https://www.facebook.com/${encodeURIComponent(username)}`,
    ], 15_000);
    const dtsg = page.body.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1]
              ?? page.body.match(/"token":"(AQ[^"]{10,})"/)?.[1] ?? "";
    const lsd  = page.body.match(/\["LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? "";
    if (!dtsg) return false;
    const jazoest = `2${[...dtsg].reduce((s,c)=>s+c.charCodeAt(0),0)}`;
    const r = await runCurl([...proxy,"-X","POST","-b",ck,
      "-H","User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H","Content-Type: application/x-www-form-urlencoded",
      "-H","Referer: https://www.facebook.com/",
      "--data-raw", new URLSearchParams({ fb_dtsg:dtsg,jazoest,lsd,report_type:reason,target:username }).toString(),
      "https://www.facebook.com/ajax/report/social_report.php",
    ], 12_000);
    return r.statusCode === 200 || r.statusCode === 302;
  } catch { return false; }
  finally { try { fs.unlinkSync(ck); } catch {} }
}

// ── Twitter / X ───────────────────────────────────────────────────────────────
async function twGuestToken(proxy: string[]): Promise<string|null> {
  try {
    const r = await runCurl([...proxy,"-X","POST",
      "-H",`Authorization: Bearer ${TW_BEARER}`,
      "https://api.twitter.com/1.1/guest/activate.json",
    ], 10_000);
    return JSON.parse(r.body)?.guest_token ?? null;
  } catch { return null; }
}

async function twLookup(username: string, gt: string, proxy: string[]): Promise<string|null> {
  try {
    const r = await runCurl([...proxy,
      "-H",`Authorization: Bearer ${TW_BEARER}`,"-H",`x-guest-token: ${gt}`,
      `https://api.twitter.com/1.1/users/show.json?screen_name=${encodeURIComponent(username)}`,
    ], 10_000);
    return JSON.parse(r.body)?.id_str ?? null;
  } catch { return null; }
}

async function twReport(userId: string, gt: string, proxy: string[]): Promise<boolean> {
  try {
    const r = await runCurl([...proxy,"-X","POST",
      "-H",`Authorization: Bearer ${TW_BEARER}`,"-H",`x-guest-token: ${gt}`,
      "-H","Content-Type: application/x-www-form-urlencoded",
      "--data-raw",`reported_user_id=${userId}`,
      "https://api.twitter.com/1.1/report_spam.json",
    ], 12_000);
    return r.statusCode === 200 && !r.body.includes('"errors"');
  } catch { return false; }
}

// ── GET /api/social/lookup ────────────────────────────────────────────────────
router.get("/lookup", (req, res): void => {
  const { url: u } = req.query as Record<string,string>;
  if (!u) { res.status(400).json({ error:"url obrigatório" }); return; }
  const info = detectPlatform(u.trim());
  if (!info) { res.status(400).json({ error:"plataforma não reconhecida" }); return; }
  res.json(info);
});

// ── GET /api/social/stream/report ─────────────────────────────────────────────
router.get("/stream/report", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity } = req.query as Record<string,string>;
  if (!rawUrl) { res.status(400).end(); return; }

  const info = detectPlatform(rawUrl);
  if (!info) { res.status(400).json({ error:"Plataforma não reconhecida" }); return; }

  const qty = Math.min(Math.max(1, parseInt(String(quantity ?? "5"), 10)), 50);

  res.writeHead(200, {
    "Content-Type":"text/event-stream","Cache-Control":"no-cache, no-store",
    "Connection":"keep-alive","X-Accel-Buffering":"no",
    "Access-Control-Allow-Origin":"*",
  });

  const emit = (d: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };
  emit({ type:"start", platform:info.platform, target:info.identifier, total:qty });

  let sent = 0, failed = 0;

  try {
    // ─ INSTAGRAM ──────────────────────────────────────────────────────────────
    if (info.platform === "instagram") {
      const userId = await igLookup(info.identifier);
      if (!userId) { emit({ type:"error", msg:"Usuário não encontrado no Instagram" }); res.end(); return; }
      emit({ type:"lookup", userId, username:info.identifier });
      for (let i = 0; i < qty; i++) {
        const ok = await igReport(userId, IG_REASONS[i % IG_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        emit({ type:"progress", n:i+1, total:qty, ok, platform:"instagram" });
        if (i < qty-1) await rand(300,800);
      }
    }

    // ─ TIKTOK ─────────────────────────────────────────────────────────────────
    else if (info.platform === "tiktok") {
      const secUid = await ttLookup(info.identifier);
      if (!secUid) { emit({ type:"error", msg:"Usuário não encontrado no TikTok" }); res.end(); return; }
      emit({ type:"lookup", secUid:secUid.slice(0,20)+"…", username:info.identifier });
      for (let i = 0; i < qty; i++) {
        const ok = await ttReport(secUid, TK_REASONS[i % TK_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        emit({ type:"progress", n:i+1, total:qty, ok, platform:"tiktok" });
        if (i < qty-1) await rand(200,600);
      }
    }

    // ─ YOUTUBE ────────────────────────────────────────────────────────────────
    else if (info.platform === "youtube") {
      const proxy = pickProxy();
      const sess  = await ytSession(proxy);
      if (!sess) { emit({ type:"error", msg:"Falha ao obter sessão YouTube" }); res.end(); return; }

      let videoIds: string[];
      if (info.type === "video") {
        videoIds = [info.identifier];
      } else {
        emit({ type:"info", msg:"Buscando vídeos do canal…" });
        videoIds = await ytGetVideos(info.identifier, proxy);
        if (!videoIds.length) { emit({ type:"error", msg:"Nenhum vídeo encontrado" }); res.end(); return; }
        emit({ type:"lookup", videoCount:videoIds.length, channel:info.identifier });
      }

      for (let i = 0; i < qty; i++) {
        const p2  = pickProxy();
        const s2  = i % 4 === 0 ? (await ytSession(p2) ?? sess) : sess;
        const ok  = await ytFlag(videoIds[i % videoIds.length]!, YT_REASONS[i % YT_REASONS.length]!, s2, p2);
        ok ? sent++ : failed++;
        emit({ type:"progress", n:i+1, total:qty, ok, platform:"youtube" });
        if (i < qty-1) await rand(400,1000);
      }
    }

    // ─ FACEBOOK ───────────────────────────────────────────────────────────────
    else if (info.platform === "facebook") {
      for (let i = 0; i < qty; i++) {
        const ok = await fbReport(info.identifier, FB_REASONS[i % FB_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        emit({ type:"progress", n:i+1, total:qty, ok, platform:"facebook" });
        if (i < qty-1) await rand(600,1400);
      }
    }

    // ─ TWITTER / X ────────────────────────────────────────────────────────────
    else if (info.platform === "twitter") {
      const proxy = pickProxy();
      let gt = await twGuestToken(proxy);
      if (!gt) { emit({ type:"error", msg:"Falha ao obter token Twitter" }); res.end(); return; }
      const userId = await twLookup(info.identifier, gt, proxy);
      if (!userId) { emit({ type:"error", msg:"Usuário não encontrado no Twitter/X" }); res.end(); return; }
      emit({ type:"lookup", userId, username:info.identifier });
      for (let i = 0; i < qty; i++) {
        const p2 = pickProxy();
        if (i % 3 === 0) gt = (await twGuestToken(p2)) ?? gt;
        const ok = await twReport(userId, gt, p2);
        ok ? sent++ : failed++;
        emit({ type:"progress", n:i+1, total:qty, ok, platform:"twitter" });
        if (i < qty-1) await rand(400,1000);
      }
    }

    else {
      emit({ type:"error", msg:`Plataforma ${info.platform} em breve` });
    }

  } catch (err) {
    emit({ type:"error", msg:String(err).slice(0,100) });
  }

  emit({ type:"done", sent, failed, total:qty });
  res.end();
});

// ── POST /api/social/report — para chamadas do Discord bot (retorna JSON) ─────
router.post("/report", async (req, res): Promise<void> => {
  const { url: rawUrl, quantity } = req.body as Record<string, unknown>;
  if (!rawUrl || typeof rawUrl !== "string") { res.status(400).json({ error: "url obrigatório" }); return; }

  const info = detectPlatform(rawUrl.trim());
  if (!info) { res.status(400).json({ error: "Plataforma não reconhecida" }); return; }

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
    } else if (info.platform === "youtube") {
      const proxy = pickProxy();
      const sess = await ytSession(proxy);
      if (sess) {
        const videoIds = info.type === "video" ? [info.identifier] : await ytGetVideos(info.identifier, proxy);
        for (let i = 0; i < qty && videoIds.length > 0; i++) {
          const ok = await ytFlag(videoIds[i % videoIds.length]!, YT_REASONS[i % YT_REASONS.length]!, sess, pickProxy());
          ok ? sent++ : failed++;
          if (i < qty - 1) await sleep(400);
        }
      } else { failed = qty; }
    } else if (info.platform === "facebook") {
      for (let i = 0; i < qty; i++) {
        const ok = await fbReport(info.identifier, FB_REASONS[i % FB_REASONS.length]!, pickProxy());
        ok ? sent++ : failed++;
        if (i < qty - 1) await sleep(600);
      }
    } else if (info.platform === "twitter") {
      const proxy = pickProxy();
      let gt = await twGuestToken(proxy);
      if (gt) {
        const userId = await twLookup(info.identifier, gt, proxy);
        if (userId) {
          for (let i = 0; i < qty; i++) {
            if (i % 3 === 0) gt = (await twGuestToken(pickProxy())) ?? gt;
            const ok = await twReport(userId, gt, pickProxy());
            ok ? sent++ : failed++;
            if (i < qty - 1) await sleep(400);
          }
        } else { failed = qty; }
      } else { failed = qty; }
    } else {
      failed = qty;
    }
  } catch { failed = qty - sent; }

  res.json({ platform: info.platform, target: info.identifier, sent, failed, total: qty });
});

export default router;
