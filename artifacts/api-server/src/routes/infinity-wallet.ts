import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, infinityWalletTable, infinityWalletTxnsTable, infinityPaymentsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/infinity-auth.js";
import { loginLimiter } from "../middlewares/rateLimit.js";

const router: IRouter = Router();
const PROMST_BASE = "https://promstpagamentos.discloud.app";

// ─── Exported helpers used by affiliate route ──────────────────────────────────

export async function ensureWallet(username: string) {
  await db.insert(infinityWalletTable)
    .values({ username, balanceCents: 0 })
    .onConflictDoNothing();
  const [w] = await db.select().from(infinityWalletTable).where(eq(infinityWalletTable.username, username)).limit(1);
  return w ?? { username, balanceCents: 0, updatedAt: new Date() };
}

export async function creditWallet(username: string, amountCents: number, description: string, refId?: string) {
  await ensureWallet(username);
  await db.update(infinityWalletTable)
    .set({ balanceCents: sql`${infinityWalletTable.balanceCents} + ${amountCents}`, updatedAt: sql`NOW()` })
    .where(eq(infinityWalletTable.username, username));
  await db.insert(infinityWalletTxnsTable).values({ username, direction: "credit", amountCents, description, refId: refId ?? null });
}

export async function debitWallet(username: string, amountCents: number, description: string, refId?: string): Promise<boolean> {
  await ensureWallet(username);
  const result = await db.update(infinityWalletTable)
    .set({ balanceCents: sql`${infinityWalletTable.balanceCents} - ${amountCents}`, updatedAt: sql`NOW()` })
    .where(and(eq(infinityWalletTable.username, username), sql`${infinityWalletTable.balanceCents} >= ${amountCents}`))
    .returning({ balanceCents: infinityWalletTable.balanceCents });
  if (result.length === 0) return false;
  await db.insert(infinityWalletTxnsTable).values({ username, direction: "debit", amountCents, description, refId: refId ?? null });
  return true;
}

// ─── GET /wallet ────────────────────────────────────────────────────────────────
router.get("/wallet", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const wallet = await ensureWallet(username);
  const txns = await db.select().from(infinityWalletTxnsTable)
    .where(eq(infinityWalletTxnsTable.username, username))
    .orderBy(desc(infinityWalletTxnsTable.createdAt)).limit(20);
  res.json({
    balanceCents: wallet.balanceCents,
    balanceBrl: (wallet.balanceCents / 100).toFixed(2),
    updatedAt: wallet.updatedAt.toISOString(),
    recentTxns: txns.map(t => ({
      id: t.id, direction: t.direction,
      amountCents: t.amountCents, amountBrl: (t.amountCents / 100).toFixed(2),
      description: t.description, refId: t.refId, createdAt: t.createdAt.toISOString(),
    })),
  });
});

// ─── GET /wallet/transactions ───────────────────────────────────────────────────
router.get("/wallet/transactions", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const txns = await db.select().from(infinityWalletTxnsTable)
    .where(eq(infinityWalletTxnsTable.username, username))
    .orderBy(desc(infinityWalletTxnsTable.createdAt)).limit(limit);
  res.json(txns.map(t => ({
    id: t.id, direction: t.direction,
    amountCents: t.amountCents, amountBrl: (t.amountCents / 100).toFixed(2),
    description: t.description, refId: t.refId, createdAt: t.createdAt.toISOString(),
  })));
});

// ─── POST /wallet/topup ─────────────────────────────────────────────────────────
router.post("/wallet/topup", requireAuth, loginLimiter, async (req, res) => {
  const username = req.infinityUser!.username;
  const { amountBrl } = req.body ?? {};
  const amount = Number(amountBrl);
  if (!amount || isNaN(amount) || amount < 10 || amount > 5000) {
    res.status(400).json({ error: "Valor inválido (mínimo R$10, máximo R$5000)" });
    return;
  }
  const amountCents = Math.round(amount * 100);
  const paymentId = crypto.randomBytes(16).toString("hex");
  const hashHex = crypto.createHash("sha256").update(username + paymentId + "wallet").digest("hex");
  const userId = parseInt(hashHex.slice(0, 9), 16) % 2000000000 + 1000000000;

  let promst: { txid: string; pixCopiaECola: string; qrcode_base64: string };
  try {
    const r = await fetch(`${PROMST_BASE}/create_payment?user_id=${userId}&valor=${amount.toFixed(2)}`);
    if (!r.ok) throw new Error(`${r.status}`);
    promst = await r.json() as typeof promst;
  } catch { res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." }); return; }

  const expiresAt = new Date(Date.now() + 3600_000);
  await db.insert(infinityPaymentsTable).values({
    id: paymentId, username, planId: "wallet_topup", amountCents,
    status: "pending", nedpayId: promst.txid, pixCode: promst.pixCopiaECola,
    pixQr: promst.qrcode_base64, expiresAt, purpose: "wallet_topup", purposeMeta: String(amountCents),
  });

  res.json({
    paymentId, txid: promst.txid, pixCopiaECola: promst.pixCopiaECola,
    qrcode_base64: promst.qrcode_base64, amountBrl: amount.toFixed(2), expiresAt: expiresAt.toISOString(),
  });
});

// ─── GET /wallet/topup/:paymentId/status ───────────────────────────────────────
router.get("/wallet/topup/:paymentId/status", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const paymentId = String(req.params.paymentId);
  const [payment] = await db.select().from(infinityPaymentsTable)
    .where(and(eq(infinityPaymentsTable.id, paymentId), eq(infinityPaymentsTable.username, username))).limit(1);
  if (!payment) { res.status(404).json({ error: "Não encontrado" }); return; }
  if (payment.status === "paid") { res.json({ status: "paid" }); return; }
  if (!payment.nedpayId) { res.json({ status: payment.status }); return; }
  try {
    const r = await fetch(`${PROMST_BASE}/verify_payment?payment_id=${encodeURIComponent(payment.nedpayId)}`);
    if (!r.ok) { res.json({ status: "pending" }); return; }
    const d = await r.json() as { status_pagamento: string };
    if (d.status_pagamento === "CONCLUIDA" && payment.status !== "paid") {
      await db.update(infinityPaymentsTable).set({ status: "paid", paidAt: new Date() }).where(eq(infinityPaymentsTable.id, paymentId));
      const amountCents = payment.amountCents;
      await creditWallet(username, amountCents, `Depósito PIX — R$ ${(amountCents / 100).toFixed(2)}`, paymentId);
      res.json({ status: "paid", amountCents }); return;
    }
  } catch {}
  res.json({ status: payment.status });
});

export default router;
