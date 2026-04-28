import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const router: Router = Router();

// ── Métodos permitidos por tier ───────────────────────────────────────────────
export const FREE_METHODS = new Set([
  "http-flood", "http-bypass", "slowloris", "syn-flood",
  "udp-flood", "tcp-flood", "dns-amp",
]);
export const MAX_POWER_FREE     = 4;
export const MAX_DURATION_FREE  = 60;
export const MAX_POWER_VIP      = 8;
export const MAX_DURATION_VIP   = 600;

// ── GET /api/users/:userId — retorna tier do usuário ─────────────────────────
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId));
  if (!user) {
    res.json({ userId, tier: "free", expiresAt: null });
    return;
  }
  // Verifica expiração automática
  if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
    await db.delete(usersTable).where(eq(usersTable.userId, userId));
    res.json({ userId, tier: "free", expiresAt: null });
    return;
  }
  res.json({ userId, tier: user.tier, expiresAt: user.expiresAt ?? null, grantedAt: user.grantedAt });
});

// ── POST /api/users/:userId/tier — concede VIP ────────────────────────────────
router.post("/:userId/tier", async (req, res) => {
  const { userId } = req.params;
  const { tier, grantedBy, durationDays } = req.body as {
    tier?: string;
    grantedBy?: string;
    durationDays?: number;
  };
  if (!tier || !["free", "vip"].includes(tier)) {
    res.status(400).json({ error: "tier must be 'free' or 'vip'" });
    return;
  }
  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 86_400_000)
    : null;
  await db
    .insert(usersTable)
    .values({ userId, tier, grantedBy: grantedBy ?? null, expiresAt })
    .onConflictDoUpdate({
      target: usersTable.userId,
      set: { tier, grantedBy: grantedBy ?? null, expiresAt, grantedAt: new Date() },
    });
  res.json({ ok: true, userId, tier, expiresAt });
});

// ── DELETE /api/users/:userId/tier — revoga VIP ───────────────────────────────
router.delete("/:userId/tier", async (req, res) => {
  const { userId } = req.params;
  await db.delete(usersTable).where(eq(usersTable.userId, userId));
  res.json({ ok: true, userId, tier: "free" });
});

export default router;
