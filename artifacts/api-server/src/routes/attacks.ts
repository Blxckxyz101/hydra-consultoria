import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import {
  CreateAttackBody,
  GetAttackParams,
  DeleteAttackParams,
  StopAttackParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function fireWebhook(webhookUrl: string, attack: typeof attacksTable.$inferSelect) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "attack_finished",
        attack: {
          id: attack.id,
          target: attack.target,
          method: attack.method,
          status: attack.status,
          packetsSent: attack.packetsSent,
          bytesSent: attack.bytesSent,
          stoppedAt: attack.stoppedAt,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* webhook failures are silent */ }
}

// Calculates packets per interval based on method and threads
function calcPacketsPerInterval(method: string, threads: number): number {
  const base = threads;
  const multipliers: Record<string, number> = {
    "udp-flood":    8000,
    "icmp-flood":   6000,
    "tcp-flood":    5000,
    "syn-flood":    7000,
    "dns-amp":      9000,
    "http-flood":   3000,
    "http2-flood":  2500,
    "slowloris":     200,
    "rudy":          150,
  };
  const mult = multipliers[method] ?? 4000;
  const variance = 0.75 + Math.random() * 0.5;
  return Math.floor(base * mult * variance);
}

function calcBytesPerPacket(method: string): number {
  const sizes: Record<string, [number, number]> = {
    "udp-flood":   [512, 1400],
    "icmp-flood":  [64, 512],
    "tcp-flood":   [40, 128],
    "syn-flood":   [40, 60],
    "dns-amp":     [512, 4096],
    "http-flood":  [256, 1024],
    "http2-flood": [128, 512],
    "slowloris":   [32, 64],
    "rudy":        [32, 64],
  };
  const [min, max] = sizes[method] ?? [64, 512];
  return min + Math.floor(Math.random() * (max - min));
}

router.get("/attacks", async (_req, res): Promise<void> => {
  const attacks = await db
    .select()
    .from(attacksTable)
    .orderBy(desc(attacksTable.createdAt));
  res.json(attacks);
});

router.post("/attacks", async (req, res): Promise<void> => {
  const parsed = CreateAttackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { target, port, method, duration, threads, webhookUrl } = parsed.data;

  const [attack] = await db
    .insert(attacksTable)
    .values({
      target,
      port,
      method,
      duration,
      threads,
      status: "running",
      packetsSent: 0,
      bytesSent: 0,
      webhookUrl: webhookUrl ?? null,
    })
    .returning();

  const durationMs = duration * 1000;
  const attackId = attack.id;

  // Update every 500ms for more responsive metrics
  const updateInterval = setInterval(async () => {
    try {
      const [current] = await db
        .select()
        .from(attacksTable)
        .where(eq(attacksTable.id, attackId));

      if (!current || current.status !== "running") {
        clearInterval(updateInterval);
        return;
      }

      const addedPackets = calcPacketsPerInterval(method, threads);
      const bpp = calcBytesPerPacket(method);
      const addedBytes = addedPackets * bpp;

      await db
        .update(attacksTable)
        .set({
          packetsSent: sql`${attacksTable.packetsSent} + ${addedPackets}`,
          bytesSent: sql`${attacksTable.bytesSent} + ${addedBytes}`,
        })
        .where(eq(attacksTable.id, attackId));
    } catch {
      clearInterval(updateInterval);
    }
  }, 500);

  setTimeout(async () => {
    clearInterval(updateInterval);
    try {
      const [current] = await db
        .select()
        .from(attacksTable)
        .where(eq(attacksTable.id, attackId));

      if (current && current.status === "running") {
        const [finished] = await db
          .update(attacksTable)
          .set({ status: "finished", stoppedAt: new Date() })
          .where(eq(attacksTable.id, attackId))
          .returning();

        if (finished?.webhookUrl) {
          await fireWebhook(finished.webhookUrl, finished);
        }
      }
    } catch { /* ignore */ }
  }, durationMs);

  res.status(201).json(attack);
});

router.get("/attacks/stats", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));

  const totalAttacks = attacks.length;
  const runningAttacks = attacks.filter((a) => a.status === "running").length;
  const totalPacketsSent = attacks.reduce((sum, a) => sum + (a.packetsSent ?? 0), 0);
  const totalBytesSent = attacks.reduce((sum, a) => sum + (a.bytesSent ?? 0), 0);

  const methodMap: Record<string, number> = {};
  for (const attack of attacks) {
    methodMap[attack.method] = (methodMap[attack.method] ?? 0) + 1;
  }
  const attacksByMethod = Object.entries(methodMap).map(([method, count]) => ({ method, count }));
  const recentAttacks = attacks.slice(0, 10);

  res.json({ totalAttacks, runningAttacks, totalPacketsSent, totalBytesSent, attacksByMethod, recentAttacks });
});

router.get("/attacks/:id", async (req, res): Promise<void> => {
  const params = GetAttackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [attack] = await db.select().from(attacksTable).where(eq(attacksTable.id, params.data.id));
  if (!attack) { res.status(404).json({ error: "Attack not found" }); return; }
  res.json(attack);
});

router.delete("/attacks/:id", async (req, res): Promise<void> => {
  const params = DeleteAttackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [attack] = await db.delete(attacksTable).where(eq(attacksTable.id, params.data.id)).returning();
  if (!attack) { res.status(404).json({ error: "Attack not found" }); return; }
  res.sendStatus(204);
});

router.post("/attacks/:id/stop", async (req, res): Promise<void> => {
  const params = StopAttackParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [attack] = await db
    .update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, params.data.id))
    .returning();

  if (!attack) { res.status(404).json({ error: "Attack not found" }); return; }
  if (attack.webhookUrl) await fireWebhook(attack.webhookUrl, attack);
  res.json(attack);
});

export default router;
