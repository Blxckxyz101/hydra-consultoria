import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, infinityPaymentsTable, infinityPendingAccountsTable, infinityUsersTable, infinityReferralsTable, infinityCouponsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireAdmin } from "../lib/infinity-auth.js";
import { loginLimiter } from "../middlewares/rateLimit.js";
import { sendWelcomeEmail } from "../lib/email.js";
import { sendSaleNotification } from "../lib/telegram-notif.js";

const router: IRouter = Router();

const PROMST_BASE = "https://promstpagamentos.discloud.app";

// ─── Plans ────────────────────────────────────────────────────────────────────
export interface Plan {
  id: string;
  label: string;
  days: number;
  amountCents: number;
  queryQuota: number;
  tier: "padrao" | "vip" | "ultra";
  dailyModuleLimit: number;   // per-module daily limit (non-foto)
  photoDailyLimit: number;    // per-module daily limit for foto modules
  freeCredits: number;        // credits given on purchase
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  // ── Padrão ────────────────────────────────────────────────────────────────
  { id: "1d",  label: "1 Dia Padrão",   days: 1,  amountCents: 1500,  queryQuota: 30,   tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
  { id: "7d",  label: "7 Dias Padrão",  days: 7,  amountCents: 4000,  queryQuota: 210,  tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
  { id: "14d", label: "14 Dias Padrão", days: 14, amountCents: 7000,  queryQuota: 420,  tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
  { id: "30d", label: "30 Dias Padrão", days: 30, amountCents: 10000, queryQuota: 900,  tier: "padrao", dailyModuleLimit: 30, photoDailyLimit: 10, freeCredits: 0 },
  // ── VIP ───────────────────────────────────────────────────────────────────
  { id: "1d_vip",  label: "1 Dia VIP",   days: 1,  amountCents: 3000,  queryQuota: 60,   tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 50 },
  { id: "7d_vip",  label: "7 Dias VIP",  days: 7,  amountCents: 8000,  queryQuota: 420,  tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 100 },
  { id: "14d_vip", label: "14 Dias VIP", days: 14, amountCents: 15000, queryQuota: 840,  tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 200, highlight: true },
  { id: "30d_vip", label: "30 Dias VIP", days: 30, amountCents: 22000, queryQuota: 1800, tier: "vip", dailyModuleLimit: 60, photoDailyLimit: 25, freeCredits: 300 },
  // ── Ultra ─────────────────────────────────────────────────────────────────
  { id: "ultra_14d", label: "ULTRA 14 Dias", days: 14, amountCents: 50000, queryQuota: 2800, tier: "ultra", dailyModuleLimit: 200, photoDailyLimit: 200, freeCredits: 500 },
];

// ─── Runtime price overrides (admin-editable, persisted in DB) ───────────────
const priceOverrides = new Map<string, number>();

void (async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS infinity_price_overrides (
        id TEXT PRIMARY KEY,
        amount_cents INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const result = await db.execute(sql`SELECT id, amount_cents FROM infinity_price_overrides`);
    for (const row of (result as any).rows ?? []) {
      priceOverrides.set(String(row.id), Number(row.amount_cents));
    }
    // Add plan_tier column if not present (migration for existing DBs)
    await db.execute(sql`ALTER TABLE infinity_users ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'`);
  } catch { /* DB may not be ready on first boot */ }
})();

function getPlan(id: string): Plan | undefined {
  const base = PLANS.find(p => p.id === id);
  if (!base) return undefined;
  const ov = priceOverrides.get(id);
  return ov !== undefined ? { ...base, amountCents: ov } : base;
}

// ─── Recharge Packs ───────────────────────────────────────────────────────────
export interface RechargePack {
  id: string;
  label: string;
  credits: number;
  consultas: number;
  amountCents: number;
  highlight?: boolean;
}

export const RECHARGE_PACKS: RechargePack[] = [
  { id: "rc_micro",    label: "Micro",    credits: 100,  consultas: 20,  amountCents:  1990 },
  { id: "rc_basico",   label: "Básico",   credits: 300,  consultas: 60,  amountCents:  4990 },
  { id: "rc_padrao",   label: "Padrão",   credits: 600,  consultas: 120, amountCents:  8990, highlight: true },
  { id: "rc_avancado", label: "Avançado", credits: 1500, consultas: 300, amountCents: 19990 },
  { id: "rc_pro",      label: "Pro",      credits: 3000, consultas: 600, amountCents: 39990 },
];

function getRechargePack(id: string): RechargePack | undefined {
  const base = RECHARGE_PACKS.find(p => p.id === id);
  if (!base) return undefined;
  const ov = priceOverrides.get(id);
  return ov !== undefined ? { ...base, amountCents: ov } : base;
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
  res.json(PLANS.map(p => {
    const eff = getPlan(p.id)!;
    return {
      id: p.id,
      label: p.label,
      days: p.days,
      amountCents: eff.amountCents,
      amountBrl: (eff.amountCents / 100).toFixed(2),
      queryQuota: p.queryQuota,
      tier: p.tier,
      dailyModuleLimit: p.dailyModuleLimit,
      photoDailyLimit: p.photoDailyLimit,
      freeCredits: p.freeCredits,
      highlight: p.highlight ?? false,
    };
  }));
});

// ─── GET /recharges ───────────────────────────────────────────────────────────
router.get("/recharges", (_req, res) => {
  res.json(RECHARGE_PACKS.map(p => {
    const eff = getRechargePack(p.id)!;
    return {
      id: p.id,
      label: p.label,
      credits: p.credits,
      consultas: p.consultas,
      amountCents: eff.amountCents,
      amountBrl: (eff.amountCents / 100).toFixed(2),
      highlight: p.highlight ?? false,
    };
  }));
});

// ─── POST /recharges/create — buy credits (logged-in only) ───────────────────
router.post("/recharges/create", requireAuth, async (req, res) => {
  const { packId } = req.body ?? {};
  const pack = getRechargePack(String(packId ?? ""));
  if (!pack) { res.status(400).json({ error: "Pacote de recarga inválido" }); return; }

  const username = req.infinityUser!.username;
  const paymentId = crypto.randomBytes(16).toString("hex");
  const userId = generateUserId(username + paymentId);

  let promstData: PromstCreateResponse;
  try {
    promstData = await createPromstPayment(userId, pack.amountCents / 100);
  } catch {
    res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username,
    planId: pack.id,
    amountCents: pack.amountCents,
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
    amountBrl: (pack.amountCents / 100).toFixed(2),
    taxa: promstData.taxa,
    pack: { id: pack.id, label: pack.label, credits: pack.credits, consultas: pack.consultas },
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── Coupon helpers ────────────────────────────────────────────────────────────

/** Validate a coupon without consuming it. Returns discount info or error. */
async function validateCoupon(code: string): Promise<
  { valid: true; discountPercent: number; description: string | null } |
  { valid: false; error: string }
> {
  const codeUpper = code.trim().toUpperCase();
  if (!codeUpper) return { valid: false, error: "Código de cupom vazio." };
  const [coupon] = await db.select().from(infinityCouponsTable)
    .where(eq(infinityCouponsTable.code, codeUpper)).limit(1);
  if (!coupon)             return { valid: false, error: "Cupom não encontrado." };
  if (!coupon.active)      return { valid: false, error: "Cupom inativo." };
  if (coupon.expiresAt && coupon.expiresAt < new Date())
                           return { valid: false, error: "Cupom expirado." };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses)
                           return { valid: false, error: "Cupom esgotado (limite de usos atingido)." };
  return { valid: true, discountPercent: coupon.discountPercent, description: coupon.description };
}

/** Consume a coupon (increment usedCount). Call only after payment is created. */
async function consumeCoupon(code: string) {
  const codeUpper = code.trim().toUpperCase();
  const [coupon] = await db.select({ usedCount: infinityCouponsTable.usedCount })
    .from(infinityCouponsTable).where(eq(infinityCouponsTable.code, codeUpper)).limit(1);
  if (!coupon) return;
  await db.update(infinityCouponsTable)
    .set({ usedCount: coupon.usedCount + 1 })
    .where(eq(infinityCouponsTable.code, codeUpper));
}

// ─── POST /coupons/validate — check a coupon (auth required, non-destructive) ─
router.post("/coupons/validate", requireAuth, async (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  if (!code) { res.status(400).json({ valid: false, error: "Código obrigatório." }); return; }
  const result = await validateCoupon(code);
  res.json(result);
});

// ─── Admin: coupon CRUD ────────────────────────────────────────────────────────

// ─── Admin: price overrides ────────────────────────────────────────────────────

router.get("/admin/prices", requireAdmin, (_req, res) => {
  const plans = PLANS.map(p => ({
    id: p.id,
    label: p.label,
    days: p.days,
    defaultAmountCents: p.amountCents,
    amountCents: priceOverrides.get(p.id) ?? p.amountCents,
    queryQuota: p.queryQuota,
    highlight: p.highlight ?? false,
  }));
  const recharges = RECHARGE_PACKS.map(p => ({
    id: p.id,
    label: p.label,
    credits: p.credits,
    consultas: p.consultas,
    defaultAmountCents: p.amountCents,
    amountCents: priceOverrides.get(p.id) ?? p.amountCents,
    highlight: p.highlight ?? false,
  }));
  res.json({ plans, recharges });
});

router.patch("/admin/prices/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = (req.params as { id: string }).id;
  const amountCents = Number((req.body as { amountCents?: unknown }).amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    res.status(400).json({ error: "amountCents deve ser um inteiro positivo" });
    return;
  }
  const allIds = [...PLANS.map(p => p.id), ...RECHARGE_PACKS.map(p => p.id)];
  if (!allIds.includes(id)) { res.status(404).json({ error: "ID inválido" }); return; }
  priceOverrides.set(id, amountCents);
  try {
    await db.execute(sql`
      INSERT INTO infinity_price_overrides (id, amount_cents, updated_at)
      VALUES (${id}, ${amountCents}, now())
      ON CONFLICT (id) DO UPDATE SET amount_cents = ${amountCents}, updated_at = now()
    `);
  } catch { /* if table doesn't exist yet, in-memory override still works */ }
  res.json({ ok: true, id, amountCents });
});

router.delete("/admin/prices/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = (req.params as { id: string }).id;
  priceOverrides.delete(id);
  try {
    await db.execute(sql`DELETE FROM infinity_price_overrides WHERE id = ${id}`);
  } catch { /* ignore */ }
  res.json({ ok: true });
});

// ─── Admin: coupon CRUD ────────────────────────────────────────────────────────

router.get("/admin/coupons", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityCouponsTable)
    .orderBy(desc(infinityCouponsTable.createdAt));
  res.json(rows.map(c => ({
    code:            c.code,
    discountPercent: c.discountPercent,
    maxUses:         c.maxUses,
    usedCount:       c.usedCount,
    expiresAt:       c.expiresAt?.toISOString() ?? null,
    active:          c.active,
    description:     c.description,
    createdBy:       c.createdBy,
    createdAt:       c.createdAt.toISOString(),
  })));
});

router.post("/admin/coupons", requireAdmin, async (req, res) => {
  const { code, discountPercent, maxUses, expiresAt, description } = req.body ?? {};
  const codeStr = String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, "");
  if (!codeStr || codeStr.length < 3 || codeStr.length > 30) {
    res.status(400).json({ error: "Código inválido (3–30 chars, letras/números/_ /-)." }); return;
  }
  const pct = Number(discountPercent);
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    res.status(400).json({ error: "Desconto deve ser entre 1 e 100%." }); return;
  }
  const maxUsesVal = maxUses !== undefined && maxUses !== "" && maxUses !== null
    ? Number(maxUses) : null;
  if (maxUsesVal !== null && (!Number.isInteger(maxUsesVal) || maxUsesVal < 1)) {
    res.status(400).json({ error: "Limite de usos deve ser um número positivo." }); return;
  }
  const expiresAtVal = expiresAt ? new Date(String(expiresAt)) : null;
  if (expiresAtVal && isNaN(expiresAtVal.getTime())) {
    res.status(400).json({ error: "Data de validade inválida." }); return;
  }
  const createdBy = req.infinityUser!.username;
  try {
    await db.insert(infinityCouponsTable).values({
      code: codeStr,
      discountPercent: pct,
      maxUses: maxUsesVal,
      expiresAt: expiresAtVal,
      description: description ? String(description).slice(0, 200) : null,
      createdBy,
    });
    res.json({ ok: true, code: codeStr });
  } catch {
    res.status(409).json({ error: "Já existe um cupom com esse código." });
  }
});

router.patch("/admin/coupons/:code", requireAdmin, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const { active } = req.body ?? {};
  if (typeof active !== "boolean") { res.status(400).json({ error: "Campo 'active' obrigatório." }); return; }
  await db.update(infinityCouponsTable).set({ active }).where(eq(infinityCouponsTable.code, code));
  res.json({ ok: true });
});

router.delete("/admin/coupons/:code", requireAdmin, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  await db.delete(infinityCouponsTable).where(eq(infinityCouponsTable.code, code));
  res.json({ ok: true });
});

// ─── POST /payments/create — logged-in user renewing ─────────────────────────
router.post("/payments/create", requireAuth, async (req, res) => {
  const { planId, couponCode } = req.body ?? {};
  const plan = getPlan(String(planId ?? ""));
  if (!plan) { res.status(400).json({ error: "Plano inválido" }); return; }

  // Apply coupon discount if provided
  let finalAmountCents = plan.amountCents;
  let appliedCoupon: string | null = null;
  if (couponCode && String(couponCode).trim()) {
    const couponResult = await validateCoupon(String(couponCode));
    if (!couponResult.valid) { res.status(400).json({ error: couponResult.error }); return; }
    finalAmountCents = Math.max(100, Math.round(plan.amountCents * (1 - couponResult.discountPercent / 100)));
    appliedCoupon = String(couponCode).trim().toUpperCase();
  }

  const username = req.infinityUser!.username;
  const paymentId = crypto.randomBytes(16).toString("hex");
  const userId = generateUserId(username + paymentId);

  let promstData: PromstCreateResponse;
  try {
    promstData = await createPromstPayment(userId, finalAmountCents / 100);
  } catch (err) {
    res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h to pay

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username,
    planId: plan.id,
    amountCents: finalAmountCents,
    originalAmountCents: appliedCoupon ? plan.amountCents : null,
    couponCode: appliedCoupon,
    status: "pending",
    nedpayId: promstData.txid,
    pixCode: promstData.pixCopiaECola,
    pixQr: promstData.qrcode_base64,
    expiresAt,
  });

  // Consume coupon slot after payment record is created
  if (appliedCoupon) await consumeCoupon(appliedCoupon);

  res.json({
    paymentId,
    txid: promstData.txid,
    pixCopiaECola: promstData.pixCopiaECola,
    qrcode_base64: promstData.qrcode_base64,
    amountBrl: (finalAmountCents / 100).toFixed(2),
    originalAmountBrl: appliedCoupon ? (plan.amountCents / 100).toFixed(2) : undefined,
    discountPercent: appliedCoupon
      ? Math.round((1 - finalAmountCents / plan.amountCents) * 100)
      : undefined,
    taxa: promstData.taxa,
    plan: { id: plan.id, label: plan.label, days: plan.days },
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── POST /payments/create-guest — new user registering + paying ──────────────
router.post("/payments/create-guest", loginLimiter, async (req, res) => {
  const { planId, username, password, email, referralCode, couponCode } = req.body ?? {};

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
  const rechargePack = plan ? null : getRechargePack(String(planId));
  if (!plan && !rechargePack) {
    res.status(400).json({ error: "Plano ou pacote de recarga inválido" });
    return;
  }

  const baseAmountCents = plan ? plan.amountCents : rechargePack!.amountCents;

  // Apply coupon discount if provided (plans only)
  let finalAmountCents = baseAmountCents;
  let appliedCoupon: string | null = null;
  if (plan && couponCode && String(couponCode).trim()) {
    const couponResult = await validateCoupon(String(couponCode));
    if (!couponResult.valid) { res.status(400).json({ error: couponResult.error }); return; }
    finalAmountCents = Math.max(100, Math.round(baseAmountCents * (1 - couponResult.discountPercent / 100)));
    appliedCoupon = String(couponCode).trim().toUpperCase();
  }

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
    promstData = await createPromstPayment(userId, finalAmountCents / 100);
  } catch {
    res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const effectivePlanId = plan ? plan.id : rechargePack!.id;

  await db.insert(infinityPaymentsTable).values({
    id: paymentId,
    username: usernameStr,
    planId: effectivePlanId,
    amountCents: finalAmountCents,
    originalAmountCents: appliedCoupon ? baseAmountCents : null,
    couponCode: appliedCoupon,
    status: "pending",
    nedpayId: promstData.txid,
    pixCode: promstData.pixCopiaECola,
    pixQr: promstData.qrcode_base64,
    expiresAt,
  });

  // Consume coupon slot after payment record is created
  if (appliedCoupon) await consumeCoupon(appliedCoupon);

  const refBy = referralCode ? String(referralCode).trim().toLowerCase() : null;

  await db.insert(infinityPendingAccountsTable).values({
    username: usernameStr,
    passwordHash,
    email: email ? String(email).trim() : null,
    planId: effectivePlanId,
    paymentId,
    status: "pending_payment",
    referredBy: refBy !== usernameStr ? refBy : null,
  });

  if (plan) {
    res.json({
      paymentId,
      txid: promstData.txid,
      pixCopiaECola: promstData.pixCopiaECola,
      qrcode_base64: promstData.qrcode_base64,
      amountBrl: (finalAmountCents / 100).toFixed(2),
      originalAmountBrl: appliedCoupon ? (baseAmountCents / 100).toFixed(2) : undefined,
      discountPercent: appliedCoupon
        ? Math.round((1 - finalAmountCents / baseAmountCents) * 100)
        : undefined,
      taxa: promstData.taxa,
      plan: { id: plan.id, label: plan.label, days: plan.days },
      username: usernameStr,
      expiresAt: expiresAt.toISOString(),
    });
  } else {
    const rp = rechargePack!;
    res.json({
      paymentId,
      txid: promstData.txid,
      pixCopiaECola: promstData.pixCopiaECola,
      qrcode_base64: promstData.qrcode_base64,
      amountBrl: (finalAmountCents / 100).toFixed(2),
      taxa: promstData.taxa,
      pack: { id: rp.id, label: rp.label, credits: rp.credits, consultas: rp.consultas },
      username: usernameStr,
      expiresAt: expiresAt.toISOString(),
    });
  }
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

// ─── GET /payments/:id/watch (SSE — substitui polling a cada 3s) ──────────────
router.get("/payments/:id/watch", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const paymentId = req.params.id;
  const TIMEOUT_MS = 3 * 60 * 1000;
  const INTERVAL_MS = 3000;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!res.writableEnded) res.end();
  };
  req.on("close", finish);

  const tick = async () => {
    if (res.writableEnded) return;
    if (Date.now() - startedAt > TIMEOUT_MS) {
      res.write(`data: ${JSON.stringify({ status: "expired" })}\n\n`);
      finish(); return;
    }
    try {
      const rows = await db.select().from(infinityPaymentsTable).where(eq(infinityPaymentsTable.id, paymentId)).limit(1);
      if (rows.length === 0) { finish(); return; }
      const payment = rows[0];
      if (payment.status === "paid") {
        res.write(`data: ${JSON.stringify({ status: "paid" })}\n\n`);
        finish(); return;
      }
      if (payment.status === "failed" || payment.status === "expired") {
        res.write(`data: ${JSON.stringify({ status: payment.status })}\n\n`);
        finish(); return;
      }
      if (payment.nedpayId) {
        const verifyData = await verifyPromstPayment(payment.nedpayId);
        const st = String(verifyData.status_pagamento ?? "").toUpperCase();
        if (st === "CONCLUIDA" || st === "PAID" || st === "COMPLETED") {
          await db.update(infinityPaymentsTable).set({ status: "paid", paidAt: new Date() }).where(eq(infinityPaymentsTable.id, paymentId));
          await handlePaymentConfirmed(payment.id, payment.username, payment.planId);
          res.write(`data: ${JSON.stringify({ status: "paid" })}\n\n`);
          finish(); return;
        }
        if (st === "EXPIRADA" || st === "EXPIRED" || st === "CANCELLED" || st === "FAILED") {
          await db.update(infinityPaymentsTable).set({ status: "failed" }).where(eq(infinityPaymentsTable.id, paymentId));
          res.write(`data: ${JSON.stringify({ status: "failed" })}\n\n`);
          finish(); return;
        }
      }
    } catch {}
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ status: "pending" })}\n\n`);
      timer = setTimeout(tick, INTERVAL_MS);
    }
  };

  res.write(`: keepalive\n\n`);
  timer = setTimeout(tick, INTERVAL_MS);
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
  if (!username) return;

  // ── Recharge pack ─────────────────────────────────────────────────────────
  if (planId.startsWith("rc_")) {
    const pack = getRechargePack(planId);
    if (!pack) return;

    // Check if there is a pending guest account (new user signup with recharge pack)
    const pendingRc = await db.select().from(infinityPendingAccountsTable)
      .where(and(
        eq(infinityPendingAccountsTable.username, username),
        eq(infinityPendingAccountsTable.paymentId, paymentId),
      )).limit(1);

    if (pendingRc.length > 0) {
      const pending = pendingRc[0];
      try {
        await db.insert(infinityUsersTable).values({
          username: pending.username,
          passwordHash: pending.passwordHash,
          role: "user",
          accountExpiresAt: null,
          planQueryQuota: 0,
          planQueriesUsed: 0,
          creditBalance: pack.credits,
        });
        if (pending.referredBy) void applyReferralBonus(pending.username, pending.referredBy);
      } catch { /* race — user already exists */ }
      await db.update(infinityPendingAccountsTable)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(infinityPendingAccountsTable.id, pending.id));
    } else {
      // Existing user — add credits
      await db.update(infinityUsersTable)
        .set({ creditBalance: sql`credit_balance + ${pack.credits}` })
        .where(eq(infinityUsersTable.username, username));
    }

    void sendSaleNotification({
      username,
      planLabel: `Recarga ${pack.label} (${pack.consultas} consultas)`,
      amountCents: pack.amountCents,
      expiresAt: null,
      isRenewal: pendingRc.length === 0,
    });
    return;
  }

  // ── Plan purchase ─────────────────────────────────────────────────────────
  const plan = getPlan(planId);
  if (!plan) return;

  // Check if existing user → extend account and reset quota
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
      .set({
        accountExpiresAt: newExpiry,
        planQueryQuota: plan.queryQuota,
        planQueriesUsed: 0,
        planTier: plan.tier,
      })
      .where(eq(infinityUsersTable.username, username));
    if (plan.freeCredits > 0) {
      await db.update(infinityUsersTable)
        .set({ creditBalance: sql`credit_balance + ${plan.freeCredits}` })
        .where(eq(infinityUsersTable.username, username));
    }
    void sendSaleNotification({
      username,
      planLabel: plan.label,
      amountCents: plan.amountCents,
      expiresAt: newExpiry,
      isRenewal: true,
    });
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
      planQueryQuota: plan.queryQuota,
      planQueriesUsed: 0,
      planTier: plan.tier,
      creditBalance: plan.freeCredits,
    });
    await db.update(infinityPendingAccountsTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(infinityPendingAccountsTable.id, pending.id));

    if (pending.email) {
      void sendWelcomeEmail({
        to: pending.email,
        username: pending.username,
        planLabel: plan.label,
        expiresAt: accountExpiresAt,
      });
    }

    if (pending.referredBy) {
      void applyReferralBonus(pending.username, pending.referredBy);
    }

    void sendSaleNotification({
      username: pending.username,
      planLabel: plan.label,
      amountCents: plan.amountCents,
      expiresAt: accountExpiresAt,
      isRenewal: false,
    });
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
