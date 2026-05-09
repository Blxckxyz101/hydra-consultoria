import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, infinityPaymentsTable, infinityPendingAccountsTable, infinityUsersTable, infinityReferralsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireAdmin } from "../lib/infinity-auth.js";
import { loginLimiter } from "../middlewares/rateLimit.js";
import { sendWelcomeEmail } from "../lib/email.js";

const router: IRouter = Router();

const PROMST_BASE = "https://promstpagamentos.discloud.app";

// ─── Plans ────────────────────────────────────────────────────────────────────
export interface Plan {
  id: string;
  label: string;
  days: number;
  amountCents: number;
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  { id: "1d",  label: "1 Dia",   days: 1,  amountCents: 1500 },
  { id: "7d",  label: "7 Dias",  days: 7,  amountCents: 4000 },
  { id: "14d", label: "14 Dias", days: 14, amountCents: 7000, highlight: true },
  { id: "30d", label: "30 Dias", days: 30, amountCents: 10000 },
];

function getPlan(id: string): Plan | undefined {
  return PLANS.find(p => p.id === id);
}

// ─── Promst Pagamentos API ─────────────────────────────────────────────────────
interface PromstCreateResponse {
  txid: string;
  pixCopiaECola: string;
  qrcode_base64: string;
  status: string;
  amount: number;
  taxa: number;
  valor_liquido: number;
}

interface PromstVerifyResponse {
  payment_id: string;
  status_pagamento: string;
  valor: number;
  valor_liquido: number;
}

async function createPromstPayment(userId: number, valor: number): Promise<PromstCreateResponse> {
  const url = `${PROMST_BASE}/create_payment?user_id=${userId}&valor=${valor.toFixed(2)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Promst API error: ${res.status}`);
  return res.json() as Promise<PromstCreateResponse>;
}

async function verifyPromstPayment(txid: string): Promise<PromstVerifyResponse> {
  const url = `${PROMST_BASE}/verify_payment?payment_id=${txid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Promst verify error: ${res.status}`);
  return res.json() as Promise<PromstVerifyResponse>;
}

function generateUserId(seed: string): number {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return parseInt(hash.slice(0, 9), 16) % 2000000000 + 1000000000;
}

// ─── GET /plans ───────────────────────────────────────────────────────────────
router.get("/plans", (_req, res) => {
  res.json(PLANS.map(p => ({
    id: p.id,
    label: p.label,
    days: p.days,
    amountCents: p.amountCents,
    amountBrl: (p.amountCents / 100).toFixed(2),
    highlight: p.highlight ?? false,
  })));
});

// ─── POST /payments/create — logged-in user renewing ─────────────────────────
router.post("/payments/create", requireAuth, async (req, res) => {
  const { planId } = req.body ?? {};
  const plan = getPlan(String(planId ?? ""));
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  const username = req.infinityUser!.username;
  const paymentId = crypto.randomBytes(16).toString("hex");
  const userId = generateUserId(username + paymentId);

  let promstData: PromstCreateResponse;
  try {
    promstData = await createPromstPayment(userId, plan.amountCents / 100);
  } catch (err) {
    res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h to pay

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username,
    planId: plan.id,
    amountCents: plan.amountCents,
    status: "pending",
    nedpayId: promstData.txid,
    pixCode: promstData.pixCopiaECola,
    pixQr: promstData.qrcode_base64,
    expiresAt,
  });

  res.json({
    paymentId,
    txid: promstData.txid,
    pixCopiaECola: promstData.pixCopiaECola,
    qrcode_base64: promstData.qrcode_base64,
    amountBrl: (plan.amountCents / 100).toFixed(2),
    taxa: promstData.taxa,
    plan: { id: plan.id, label: plan.label, days: plan.days },
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── POST /payments/create-guest — new user registering + paying ──────────────
router.post("/payments/create-guest", loginLimiter, async (req, res) => {
  const { planId, username, password, email, referralCode } = req.body ?? {};

  if (!planId || !username || !password) {
    res.status(400).json({ error: "planId, username e password obrigatórios" });
    return;
  }
  const usernameStr = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(usernameStr)) {
    res.status(400).json({ error: "Usuário inválido (3-30 caracteres, letras/números/_)" });
    return;
  }
  const passwordStr = String(password);
  if (passwordStr.length < 6) {
    res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres" });
    return;
  }

  const plan = getPlan(String(planId));
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  // Check if username already taken
  const existingUser = await db.select({ username: infinityUsersTable.username })
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, usernameStr))
    .limit(1);
  if (existingUser.length > 0) {
    res.status(409).json({ error: "Usuário já existe" });
    return;
  }

  // Clean up old rejected/expired pending records for this username
  await db.delete(infinityPendingAccountsTable)
    .where(
      and(
        eq(infinityPendingAccountsTable.username, usernameStr),
        eq(infinityPendingAccountsTable.status, "rejected")
      )
    );

  // Check for existing pending
  const existingPending = await db.select({ id: infinityPendingAccountsTable.id, status: infinityPendingAccountsTable.status })
    .from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.username, usernameStr))
    .limit(1);

  if (existingPending.length > 0) {
    const pend = existingPending[0];
    if (pend.status === "pending_approval" || pend.status === "approved") {
      res.status(409).json({ error: "Já existe uma solicitação para este usuário" });
      return;
    }
    await db.delete(infinityPendingAccountsTable).where(eq(infinityPendingAccountsTable.username, usernameStr));
  }

  const paymentId = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(passwordStr, 10);
  const userId = generateUserId(usernameStr + paymentId);

  let promstData: PromstCreateResponse;
  try {
    promstData = await createPromstPayment(userId, plan.amountCents / 100);
  } catch {
    res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username: usernameStr,
    planId: plan.id,
    amountCents: plan.amountCents,
    status: "pending",
    nedpayId: promstData.txid,
    pixCode: promstData.pixCopiaECola,
    pixQr: promstData.qrcode_base64,
    expiresAt,
  });

  const refBy = referralCode ? String(referralCode).trim().toLowerCase() : null;

  await db.insert(infinityPendingAccountsTable).values({
    username: usernameStr,
    passwordHash,
    email: email ? String(email).trim() : null,
    planId: plan.id,
    paymentId,
    status: "pending_payment",
    referredBy: refBy !== usernameStr ? refBy : null,
  });

  res.json({
    paymentId,
    txid: promstData.txid,
    pixCopiaECola: promstData.pixCopiaECola,
    qrcode_base64: promstData.qrcode_base64,
    amountBrl: (plan.amountCents / 100).toFixed(2),
    taxa: promstData.taxa,
    plan: { id: plan.id, label: plan.label, days: plan.days },
    username: usernameStr,
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── GET /payments/:id/status ─────────────────────────────────────────────────
router.get("/payments/:id/status", async (req, res) => {
  const paymentId = req.params.id;
  const rows = await db.select().from(infinityPaymentsTable).where(eq(infinityPaymentsTable.id, paymentId)).limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Pagamento não encontrado" }); return; }
  const payment = rows[0];

  if (payment.status === "paid") {
    res.json({ status: "paid", paidAt: payment.paidAt?.toISOString() ?? null });
    return;
  }
  if (payment.status === "failed" || payment.status === "expired") {
    res.json({ status: payment.status, paidAt: null });
    return;
  }

  // Poll promst for status
  if (payment.nedpayId) {
    try {
      const verifyData = await verifyPromstPayment(payment.nedpayId);
      const st = String(verifyData.status_pagamento ?? "").toUpperCase();

      if (st === "CONCLUIDA" || st === "PAID" || st === "COMPLETED") {
        await db.update(infinityPaymentsTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(infinityPaymentsTable.id, paymentId));

        await handlePaymentConfirmed(payment.id, payment.username, payment.planId);
        res.json({ status: "paid", paidAt: new Date().toISOString() });
        return;
      }

      if (st === "EXPIRADA" || st === "EXPIRED" || st === "CANCELLED" || st === "FAILED") {
        await db.update(infinityPaymentsTable)
          .set({ status: "failed" })
          .where(eq(infinityPaymentsTable.id, paymentId));
        res.json({ status: "failed", paidAt: null });
        return;
      }
    } catch {
      // API temporarily unavailable — return pending
    }
  }

  res.json({ status: payment.status, paidAt: null });
});

// ─── Referral bonus ────────────────────────────────────────────────────────────
async function applyReferralBonus(referredUsername: string, referredBy: string) {
  try {
    const [referrer] = await db.select({ username: infinityUsersTable.username, accountExpiresAt: infinityUsersTable.accountExpiresAt })
      .from(infinityUsersTable).where(eq(infinityUsersTable.username, referredBy)).limit(1);
    if (!referrer) return;
    const [existing] = await db.select().from(infinityReferralsTable)
      .where(eq(infinityReferralsTable.referredUsername, referredUsername)).limit(1);
    if (existing) return;
    await db.insert(infinityReferralsTable).values({
      referrerUsername: referredBy, referredUsername, bonusDays: 7, appliedAt: new Date(),
    });
    const base = referrer.accountExpiresAt && referrer.accountExpiresAt > new Date() ? referrer.accountExpiresAt : new Date();
    const newExpiry = new Date(base.getTime() + 7 * 86400_000);
    await db.update(infinityUsersTable).set({ accountExpiresAt: newExpiry }).where(eq(infinityUsersTable.username, referredBy));
  } catch {}
}

// ─── Payment confirmed: auto-activate ─────────────────────────────────────────
async function handlePaymentConfirmed(paymentId: string, username: string | null, planId: string) {
  const plan = getPlan(planId);
  if (!plan || !username) return;

  // Check if existing user → extend account
  const existingUser = await db.select({ username: infinityUsersTable.username, accountExpiresAt: infinityUsersTable.accountExpiresAt })
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, username))
    .limit(1);

  if (existingUser.length > 0) {
    const base = existingUser[0].accountExpiresAt && existingUser[0].accountExpiresAt > new Date()
      ? existingUser[0].accountExpiresAt
      : new Date();
    const newExpiry = new Date(base.getTime() + plan.days * 24 * 60 * 60 * 1000);
    await db.update(infinityUsersTable)
      .set({ accountExpiresAt: newExpiry })
      .where(eq(infinityUsersTable.username, username));
    return;
  }

  // Guest: auto-create account immediately (no manual approval needed)
  const pendingRows = await db.select().from(infinityPendingAccountsTable)
    .where(and(eq(infinityPendingAccountsTable.username, username), eq(infinityPendingAccountsTable.paymentId, paymentId)))
    .limit(1);

  if (pendingRows.length === 0) return;

  const pending = pendingRows[0];
  const accountExpiresAt = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);

  try {
    await db.insert(infinityUsersTable).values({
      username: pending.username,
      passwordHash: pending.passwordHash,
      role: "user",
      accountExpiresAt,
    });
    await db.update(infinityPendingAccountsTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(infinityPendingAccountsTable.id, pending.id));

    // Send welcome email if the user provided one
    if (pending.email) {
      void sendWelcomeEmail({
        to: pending.email,
        username: pending.username,
        planLabel: plan.label,
        expiresAt: accountExpiresAt,
      });
    }

    // Apply referral bonus if invited
    if (pending.referredBy) {
      void applyReferralBonus(pending.username, pending.referredBy);
    }
  } catch {
    // User may have been created in a race — just mark approved
    await db.update(infinityPendingAccountsTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(infinityPendingAccountsTable.id, pending.id));
  }
}

// ─── GET /pending-account/status ──────────────────────────────────────────────
router.get("/pending-account/status", async (req, res) => {
  const username = String(req.query.username ?? "").trim().toLowerCase();
  if (!username) { res.status(400).json({ error: "username obrigatório" }); return; }

  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.username, username))
    .limit(1);

  if (rows.length === 0) {
    const user = await db.select({ username: infinityUsersTable.username })
      .from(infinityUsersTable)
      .where(eq(infinityUsersTable.username, username))
      .limit(1);
    res.json({ status: user.length > 0 ? "approved" : "not_found" });
    return;
  }

  const pending = rows[0];
  res.json({
    status: pending.status,
    planId: pending.planId,
    createdAt: pending.createdAt.toISOString(),
    updatedAt: pending.updatedAt.toISOString(),
  });
});

// ─── Admin routes ──────────────────────────────────────────────────────────────
router.get("/pending-accounts", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.status, "pending_approval"))
    .orderBy(desc(infinityPendingAccountsTable.createdAt));
  res.json(rows.map(r => ({
    id: r.id, username: r.username, email: r.email, planId: r.planId,
    paymentId: r.paymentId, status: r.status,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  })));
});

router.post("/pending-accounts/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.id, id)).limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  const pending = rows[0];
  const plan = getPlan(pending.planId);
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  const existing = await db.select({ username: infinityUsersTable.username, accountExpiresAt: infinityUsersTable.accountExpiresAt })
    .from(infinityUsersTable).where(eq(infinityUsersTable.username, pending.username)).limit(1);

  if (existing.length > 0) {
    const base = existing[0].accountExpiresAt && existing[0].accountExpiresAt > new Date()
      ? existing[0].accountExpiresAt : new Date();
    const newExpiry = new Date(base.getTime() + plan.days * 24 * 60 * 60 * 1000);
    await db.update(infinityUsersTable).set({ accountExpiresAt: newExpiry }).where(eq(infinityUsersTable.username, pending.username));
    await db.update(infinityPendingAccountsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(infinityPendingAccountsTable.id, id));
    res.json({ ok: true, username: pending.username });
    return;
  }

  const accountExpiresAt = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);
  try {
    await db.insert(infinityUsersTable).values({
      username: pending.username, passwordHash: pending.passwordHash,
      role: "user", accountExpiresAt,
    });
    await db.update(infinityPendingAccountsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(infinityPendingAccountsTable.id, id));
    res.json({ ok: true, username: pending.username });
  } catch {
    res.status(400).json({ error: "Falha ao criar usuário" });
  }
});

router.post("/pending-accounts/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body ?? {};
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.id, id)).limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Conta não encontrada" }); return; }
  await db.update(infinityPendingAccountsTable)
    .set({ status: "rejected", rejectedReason: reason ? String(reason).slice(0, 200) : null, updatedAt: new Date() })
    .where(eq(infinityPendingAccountsTable.id, id));
  res.json({ ok: true });
});

router.get("/payments", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityPaymentsTable)
    .orderBy(desc(infinityPaymentsTable.createdAt)).limit(100);
  res.json(rows.map(r => ({
    id: r.id, username: r.username, planId: r.planId,
    amountBrl: (r.amountCents / 100).toFixed(2),
    status: r.status, nedpayId: r.nedpayId,
    createdAt: r.createdAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null,
  })));
});

export default router;
