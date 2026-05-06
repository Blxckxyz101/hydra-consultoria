import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, infinityPaymentsTable, infinityPendingAccountsTable, infinityUsersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireAdmin } from "../lib/infinity-auth.js";
import { loginLimiter } from "../middlewares/rateLimit.js";

const router: IRouter = Router();

const NEDPAY_BASE = "https://nedpayapp.com";
const NEDPAY_PUBLIC_KEY = process.env.NEDPAY_PUBLIC_KEY ?? "";
const NEDPAY_PRIVATE_KEY = process.env.NEDPAY_PRIVATE_KEY ?? "";

// ─── Plans (hardcoded) ────────────────────────────────────────────────────────
export interface Plan {
  id: string;
  label: string;
  days: number;
  amountCents: number;
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  { id: "7d",   label: "7 dias",   days: 7,  amountCents: 1990 },
  { id: "30d",  label: "30 dias",  days: 30, amountCents: 4990, highlight: true },
  { id: "90d",  label: "90 dias",  days: 90, amountCents: 9990 },
];

function getPlan(id: string): Plan | undefined {
  return PLANS.find(p => p.id === id);
}

// ─── NedPay signature ─────────────────────────────────────────────────────────
function nedpaySign(method: string, path: string, body: Record<string, unknown>, timestamp: string): string {
  const sortedKeys = Object.keys(body).sort();
  const bodyStr = sortedKeys.map(k => `${k}=${String(body[k])}`).join("&");
  const payload = `${method}${path}${bodyStr}${timestamp}`;
  return crypto.createHmac("sha256", NEDPAY_PRIVATE_KEY).update(payload).digest("hex");
}

async function nedpayRequest(method: string, path: string, body?: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const signature = nedpaySign(method, path, body ?? {}, timestamp);
  const res = await fetch(`${NEDPAY_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": NEDPAY_PUBLIC_KEY,
      "X-API-Signature": signature,
      "X-API-Timestamp": timestamp,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, data: json };
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

// ─── POST /payments/create ─────────────────────────────────────────────────────
// For logged-in users renewing their own plan
router.post("/payments/create", requireAuth, async (req, res) => {
  const { planId } = req.body ?? {};
  const plan = getPlan(String(planId ?? ""));
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  const username = req.infinityUser!.username;
  const paymentId = crypto.randomBytes(16).toString("hex");

  // Create NedPay payment
  const nedBody = {
    amount: plan.amountCents,
    currency: "BRL",
    description: `Infinity Search - ${plan.label}`,
    externalId: paymentId,
    paymentMethod: "PIX",
  };

  const nedRes = await nedpayRequest("POST", "/api/gateway/payments", nedBody);
  if (!nedRes.ok) {
    res.status(502).json({ error: "Falha ao criar pagamento PIX", details: nedRes.data });
    return;
  }

  const nedData = nedRes.data as Record<string, unknown>;

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username,
    planId: plan.id,
    amountCents: plan.amountCents,
    status: "pending",
    nedpayId: String(nedData.id ?? nedData.paymentId ?? ""),
    pixCode: String(nedData.pixCode ?? nedData.qrCode ?? nedData.code ?? ""),
    pixQr:   String(nedData.pixQr ?? nedData.qrCodeImage ?? nedData.qrImage ?? ""),
    expiresAt,
  });

  res.json({
    paymentId,
    pixCode: nedData.pixCode ?? nedData.qrCode ?? nedData.code ?? null,
    pixQr:   nedData.pixQr ?? nedData.qrCodeImage ?? nedData.qrImage ?? null,
    amountBrl: (plan.amountCents / 100).toFixed(2),
    plan: { id: plan.id, label: plan.label, days: plan.days },
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── POST /payments/create-guest ───────────────────────────────────────────────
// For new users on the login page picking a plan before registration
router.post("/payments/create-guest", loginLimiter, async (req, res) => {
  const { planId, username, password, email } = req.body ?? {};

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

  // Check if username already taken (active user)
  const existingUser = await db.select({ username: infinityUsersTable.username })
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, usernameStr))
    .limit(1);
  if (existingUser.length > 0) {
    res.status(409).json({ error: "Usuário já existe" });
    return;
  }

  // Check if there's already a pending account with this username
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
    // Remove old rejected/pending_payment record so they can retry
    await db.delete(infinityPendingAccountsTable).where(eq(infinityPendingAccountsTable.username, usernameStr));
  }

  const paymentId = crypto.randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(passwordStr, 10);

  // Create NedPay payment
  const nedBody = {
    amount: plan.amountCents,
    currency: "BRL",
    description: `Infinity Search - ${plan.label} - @${usernameStr}`,
    externalId: paymentId,
    paymentMethod: "PIX",
  };

  const nedRes = await nedpayRequest("POST", "/api/gateway/payments", nedBody);
  if (!nedRes.ok) {
    res.status(502).json({ error: "Falha ao criar pagamento PIX", details: nedRes.data });
    return;
  }

  const nedData = nedRes.data as Record<string, unknown>;

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username: usernameStr,
    planId: plan.id,
    amountCents: plan.amountCents,
    status: "pending",
    nedpayId: String(nedData.id ?? nedData.paymentId ?? ""),
    pixCode: String(nedData.pixCode ?? nedData.qrCode ?? nedData.code ?? ""),
    pixQr:   String(nedData.pixQr ?? nedData.qrCodeImage ?? nedData.qrImage ?? ""),
    expiresAt,
  });

  await db.insert(infinityPendingAccountsTable).values({
    username: usernameStr,
    passwordHash,
    email: email ? String(email).trim() : null,
    planId: plan.id,
    paymentId,
    status: "pending_payment",
  });

  res.json({
    paymentId,
    pixCode: nedData.pixCode ?? nedData.qrCode ?? nedData.code ?? null,
    pixQr:   nedData.pixQr ?? nedData.qrCodeImage ?? nedData.qrImage ?? null,
    amountBrl: (plan.amountCents / 100).toFixed(2),
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

  // If already confirmed/failed, just return cached status
  if (payment.status === "paid" || payment.status === "failed" || payment.status === "expired") {
    res.json({ status: payment.status, paidAt: payment.paidAt?.toISOString() ?? null });
    return;
  }

  // Poll NedPay for status
  if (payment.nedpayId) {
    const nedRes = await nedpayRequest("GET", `/api/gateway/payments/${payment.nedpayId}`, {});
    if (nedRes.ok) {
      const nedData = nedRes.data as Record<string, unknown>;
      const nedStatus = String(nedData.status ?? "").toLowerCase();
      if (nedStatus === "paid" || nedStatus === "completed" || nedStatus === "approved") {
        // Payment confirmed — mark and handle
        await db.update(infinityPaymentsTable)
          .set({ status: "paid", paidAt: new Date() })
          .where(eq(infinityPaymentsTable.id, paymentId));

        await handlePaymentConfirmed(payment.id, payment.username, payment.planId);
        res.json({ status: "paid", paidAt: new Date().toISOString() });
        return;
      } else if (nedStatus === "expired" || nedStatus === "cancelled" || nedStatus === "failed") {
        await db.update(infinityPaymentsTable)
          .set({ status: "failed" })
          .where(eq(infinityPaymentsTable.id, paymentId));
        res.json({ status: "failed", paidAt: null });
        return;
      }
    }
  }

  res.json({ status: payment.status, paidAt: null });
});

// ─── Payment confirmed handler ────────────────────────────────────────────────
async function handlePaymentConfirmed(paymentId: string, username: string | null, planId: string) {
  const plan = getPlan(planId);
  if (!plan || !username) return;

  // Check if this is a guest (pending account) or existing user
  const existingUser = await db.select({ username: infinityUsersTable.username, accountExpiresAt: infinityUsersTable.accountExpiresAt })
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, username))
    .limit(1);

  if (existingUser.length > 0) {
    // Existing user — extend their account
    const currentExpiry = existingUser[0].accountExpiresAt;
    const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(base.getTime() + plan.days * 24 * 60 * 60 * 1000);
    await db.update(infinityUsersTable)
      .set({ accountExpiresAt: newExpiry })
      .where(eq(infinityUsersTable.username, username));
    return;
  }

  // Guest — move pending account to pending_approval
  const pendingRows = await db.select().from(infinityPendingAccountsTable)
    .where(and(eq(infinityPendingAccountsTable.username, username), eq(infinityPendingAccountsTable.paymentId, paymentId)))
    .limit(1);

  if (pendingRows.length > 0) {
    await db.update(infinityPendingAccountsTable)
      .set({ status: "pending_approval", updatedAt: new Date() })
      .where(eq(infinityPendingAccountsTable.id, pendingRows[0].id));
  }
}

// ─── GET /pending-account/status?username= ────────────────────────────────────
// Polling endpoint for the "waiting" screen after payment
router.get("/pending-account/status", async (req, res) => {
  const username = String(req.query.username ?? "").trim().toLowerCase();
  if (!username) { res.status(400).json({ error: "username obrigatório" }); return; }

  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.username, username))
    .limit(1);

  if (rows.length === 0) {
    // Check if user was approved and now exists in users table
    const user = await db.select({ username: infinityUsersTable.username })
      .from(infinityUsersTable)
      .where(eq(infinityUsersTable.username, username))
      .limit(1);
    if (user.length > 0) {
      res.json({ status: "approved" });
    } else {
      res.json({ status: "not_found" });
    }
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

// ─── Admin: list pending accounts ─────────────────────────────────────────────
router.get("/pending-accounts", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.status, "pending_approval"))
    .orderBy(desc(infinityPendingAccountsTable.createdAt));

  res.json(rows.map(r => ({
    id: r.id,
    username: r.username,
    email: r.email,
    planId: r.planId,
    paymentId: r.paymentId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

// ─── Admin: approve pending account ───────────────────────────────────────────
router.post("/pending-accounts/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.id, id))
    .limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  const pending = rows[0];
  const plan = getPlan(pending.planId);
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  // Check if username already exists
  const existing = await db.select({ username: infinityUsersTable.username })
    .from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, pending.username))
    .limit(1);
  if (existing.length > 0) {
    // Already exists — just mark as approved and extend
    const user = await db.select({ accountExpiresAt: infinityUsersTable.accountExpiresAt })
      .from(infinityUsersTable)
      .where(eq(infinityUsersTable.username, pending.username))
      .limit(1);
    const base = user[0]?.accountExpiresAt && user[0].accountExpiresAt > new Date()
      ? user[0].accountExpiresAt
      : new Date();
    const newExpiry = new Date(base.getTime() + plan.days * 24 * 60 * 60 * 1000);
    await db.update(infinityUsersTable)
      .set({ accountExpiresAt: newExpiry })
      .where(eq(infinityUsersTable.username, pending.username));
    await db.update(infinityPendingAccountsTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(infinityPendingAccountsTable.id, id));
    res.json({ ok: true, username: pending.username });
    return;
  }

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
      .where(eq(infinityPendingAccountsTable.id, id));
    res.json({ ok: true, username: pending.username });
  } catch {
    res.status(400).json({ error: "Falha ao criar usuário" });
  }
});

// ─── Admin: reject pending account ────────────────────────────────────────────
router.post("/pending-accounts/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body ?? {};
  const rows = await db.select().from(infinityPendingAccountsTable)
    .where(eq(infinityPendingAccountsTable.id, id))
    .limit(1);
  if (rows.length === 0) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  await db.update(infinityPendingAccountsTable)
    .set({ status: "rejected", rejectedReason: reason ? String(reason).slice(0, 200) : null, updatedAt: new Date() })
    .where(eq(infinityPendingAccountsTable.id, id));

  res.json({ ok: true });
});

// ─── Admin: list all payments ──────────────────────────────────────────────────
router.get("/payments", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityPaymentsTable)
    .orderBy(desc(infinityPaymentsTable.createdAt))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.id,
    username: r.username,
    planId: r.planId,
    amountBrl: (r.amountCents / 100).toFixed(2),
    status: r.status,
    nedpayId: r.nedpayId,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  })));
});

export default router;
