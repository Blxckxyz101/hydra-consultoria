import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  db, infinityGiftCodesTable, infinityGiftPurchasesTable, infinityPaymentsTable,
  infinityReferralsTable, infinityUsersTable, infinityWalletTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../lib/infinity-auth.js";
import { loginLimiter } from "../middlewares/rateLimit.js";
import { debitWallet, ensureWallet } from "./infinity-wallet.js";

const router: IRouter = Router();
const PROMST_BASE = "https://promstpagamentos.discloud.app";
const CODE_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const REFERRAL_BONUS_DAYS = 7;

// ─── Pack definitions ──────────────────────────────────────────────────────────
export const GIFT_PACKS = [
  {
    id: "starter",
    label: "Starter",
    description: "5 códigos · 7 dias cada",
    codesCount: 5,
    days: 7,
    amountCents: 15000,       // R$150
    retailValueCents: 20000,  // R$200 (R$40 × 5)
    savings: 25,              // % off retail
    highlight: false,
  },
  {
    id: "standard",
    label: "Standard",
    description: "10 códigos · 14 dias cada",
    codesCount: 10,
    days: 14,
    amountCents: 55000,       // R$550
    retailValueCents: 70000,  // R$700 (R$70 × 10)
    savings: 21,
    highlight: true,
  },
  {
    id: "pro",
    label: "Pro",
    description: "10 códigos · 30 dias cada",
    codesCount: 10,
    days: 30,
    amountCents: 80000,       // R$800
    retailValueCents: 100000, // R$1000 (R$100 × 10)
    savings: 20,
    highlight: false,
  },
];

function getPack(id: string) { return GIFT_PACKS.find(p => p.id === id); }

// ─── Code generation ───────────────────────────────────────────────────────────
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/I/1 to avoid confusion

function generateCode(): string {
  const seg = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
  return `INFY-${seg()}-${seg()}-${seg()}`;
}

async function generateUniqueCodes(count: number): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      const existing = await db.select({ code: infinityGiftCodesTable.code })
        .from(infinityGiftCodesTable).where(eq(infinityGiftCodesTable.code, code)).limit(1);
      if (existing.length === 0) break;
    } while (attempts < 10);
    codes.push(code);
  }
  return codes;
}

async function completePurchase(purchaseId: number) {
  const [purchase] = await db.select().from(infinityGiftPurchasesTable)
    .where(eq(infinityGiftPurchasesTable.id, purchaseId)).limit(1);
  if (!purchase || purchase.status === "completed") return;

  const pack = getPack(purchase.packId);
  if (!pack) return;

  const codes = await generateUniqueCodes(purchase.codesCount);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await db.insert(infinityGiftCodesTable).values(
    codes.map(code => ({
      code,
      packId: pack.id,
      days: pack.days,
      ownedBy: purchase.username,
      purchaseId: purchase.id,
      expiresAt,
    }))
  );

  await db.update(infinityGiftPurchasesTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(infinityGiftPurchasesTable.id, purchaseId));
}

// ─── GET /affiliate/packs ──────────────────────────────────────────────────────
router.get("/affiliate/packs", requireAuth, (_req, res) => {
  res.json(GIFT_PACKS.map(p => ({
    ...p,
    amountBrl: (p.amountCents / 100).toFixed(2),
    retailValueBrl: (p.retailValueCents / 100).toFixed(2),
    perCodeBrl: (p.amountCents / p.codesCount / 100).toFixed(2),
    perRetailBrl: (p.retailValueCents / p.codesCount / 100).toFixed(2),
  })));
});

// ─── POST /affiliate/packs/buy ─────────────────────────────────────────────────
router.post("/affiliate/packs/buy", requireAuth, loginLimiter, async (req, res) => {
  const username = req.infinityUser!.username;
  const { packId, method } = req.body ?? {};

  const pack = getPack(String(packId ?? ""));
  if (!pack) { res.status(400).json({ error: "Pacote inválido" }); return; }
  if (!["pix", "wallet"].includes(String(method ?? ""))) {
    res.status(400).json({ error: "Método inválido — use 'pix' ou 'wallet'" }); return;
  }

  // ── Wallet payment — instant ────────────────────────────────────────────────
  if (method === "wallet") {
    const wallet = await ensureWallet(username);
    if (wallet.balanceCents < pack.amountCents) {
      res.status(402).json({
        error: `Saldo insuficiente. Você tem R$ ${(wallet.balanceCents / 100).toFixed(2)}, precisa de R$ ${(pack.amountCents / 100).toFixed(2)}.`,
        balanceCents: wallet.balanceCents,
        requiredCents: pack.amountCents,
      });
      return;
    }

    const [purchase] = await db.insert(infinityGiftPurchasesTable).values({
      username, packId: pack.id, codesCount: pack.codesCount,
      amountCents: pack.amountCents, paymentMethod: "wallet", status: "pending",
    }).returning();

    const debited = await debitWallet(
      username, pack.amountCents,
      `Compra pacote ${pack.label} (${pack.codesCount}× ${pack.days}d)`,
      String(purchase.id)
    );

    if (!debited) {
      await db.update(infinityGiftPurchasesTable)
        .set({ status: "cancelled" }).where(eq(infinityGiftPurchasesTable.id, purchase.id));
      res.status(402).json({ error: "Saldo insuficiente" }); return;
    }

    await completePurchase(purchase.id);
    const codes = await db.select().from(infinityGiftCodesTable)
      .where(eq(infinityGiftCodesTable.purchaseId, purchase.id));

    res.json({
      purchaseId: purchase.id, method: "wallet", status: "completed",
      codes: codes.map(c => ({ code: c.code, expiresAt: c.expiresAt.toISOString() })),
    });
    return;
  }

  // ── PIX payment ─────────────────────────────────────────────────────────────
  const PROMST_MERCHANT_ID = 7365425982;
  const paymentId = crypto.randomBytes(16).toString("hex");

  let promst: { txid: string; pixCopiaECola: string; qrcode_base64: string };
  try {
    const r = await fetch(`${PROMST_BASE}/create_payment?user_id=${PROMST_MERCHANT_ID}&valor=${(pack.amountCents / 100).toFixed(2)}`);
    if (!r.ok) throw new Error(`${r.status}`);
    promst = await r.json() as typeof promst;
  } catch { res.status(502).json({ error: "Falha ao gerar PIX. Tente novamente." }); return; }

  const expiresAt = new Date(Date.now() + 3600_000);
  await db.insert(infinityPaymentsTable).values({
    id: paymentId, username, planId: `gift_pack_${pack.id}`,
    amountCents: pack.amountCents, status: "pending",
    nedpayId: promst.txid, pixCode: promst.pixCopiaECola, pixQr: promst.qrcode_base64,
    expiresAt, purpose: "gift_pack", purposeMeta: pack.id,
  });

  const [purchase] = await db.insert(infinityGiftPurchasesTable).values({
    username, packId: pack.id, codesCount: pack.codesCount,
    amountCents: pack.amountCents, paymentMethod: "pix", paymentId, status: "pending",
  }).returning();

  res.json({
    purchaseId: purchase.id, paymentId, txid: promst.txid,
    pixCopiaECola: promst.pixCopiaECola, qrcode_base64: promst.qrcode_base64,
    amountBrl: (pack.amountCents / 100).toFixed(2),
    pack: { id: pack.id, label: pack.label, codesCount: pack.codesCount, days: pack.days },
    expiresAt: expiresAt.toISOString(),
  });
});

// ─── GET /affiliate/packs/buy/:purchaseId/pix-status ──────────────────────────
router.get("/affiliate/packs/buy/:purchaseId/pix-status", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const purchaseId = Number(req.params.purchaseId);
  const [purchase] = await db.select().from(infinityGiftPurchasesTable)
    .where(and(eq(infinityGiftPurchasesTable.id, purchaseId), eq(infinityGiftPurchasesTable.username, username))).limit(1);
  if (!purchase) { res.status(404).json({ error: "Compra não encontrada" }); return; }

  if (purchase.status === "completed") {
    const codes = await db.select().from(infinityGiftCodesTable).where(eq(infinityGiftCodesTable.purchaseId, purchaseId));
    res.json({ status: "completed", codes: codes.map(c => ({ code: c.code, expiresAt: c.expiresAt.toISOString() })) }); return;
  }

  if (!purchase.paymentId) { res.json({ status: purchase.status }); return; }

  const [payment] = await db.select().from(infinityPaymentsTable)
    .where(eq(infinityPaymentsTable.id, purchase.paymentId)).limit(1);
  if (!payment?.nedpayId) { res.json({ status: "pending" }); return; }

  try {
    const r = await fetch(`${PROMST_BASE}/verify_payment?payment_id=${encodeURIComponent(payment.nedpayId)}`);
    if (!r.ok) { res.json({ status: "pending" }); return; }
    const d = await r.json() as { status_pagamento: string };
    if (d.status_pagamento === "CONCLUIDA" && purchase.status !== "completed") {
      await db.update(infinityPaymentsTable).set({ status: "paid", paidAt: new Date() }).where(eq(infinityPaymentsTable.id, payment.id));
      await completePurchase(purchaseId);
      const codes = await db.select().from(infinityGiftCodesTable).where(eq(infinityGiftCodesTable.purchaseId, purchaseId));
      res.json({ status: "completed", codes: codes.map(c => ({ code: c.code, expiresAt: c.expiresAt.toISOString() })) }); return;
    }
  } catch {}
  res.json({ status: purchase.status });
});

// ─── GET /affiliate/codes ──────────────────────────────────────────────────────
router.get("/affiliate/codes", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const codes = await db.select().from(infinityGiftCodesTable)
    .where(eq(infinityGiftCodesTable.ownedBy, username))
    .orderBy(desc(infinityGiftCodesTable.createdAt));
  const now = new Date();
  res.json(codes.map(c => ({
    code: c.code, packId: c.packId, days: c.days,
    redeemedBy: c.redeemedBy ?? null,
    redeemedAt: c.redeemedAt?.toISOString() ?? null,
    expiresAt: c.expiresAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    status: c.redeemedBy ? "used"
      : c.expiresAt < now ? "expired"
      : "active",
  })));
});

// ─── GET /affiliate/stats ──────────────────────────────────────────────────────
router.get("/affiliate/stats", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const now = new Date();
  const codes = await db.select({
    redeemedBy: infinityGiftCodesTable.redeemedBy,
    expiresAt: infinityGiftCodesTable.expiresAt,
    amountCents: infinityGiftPurchasesTable.amountCents,
    codesCount: infinityGiftPurchasesTable.codesCount,
    days: infinityGiftCodesTable.days,
  }).from(infinityGiftCodesTable)
    .leftJoin(infinityGiftPurchasesTable, eq(infinityGiftCodesTable.purchaseId, infinityGiftPurchasesTable.id))
    .where(eq(infinityGiftCodesTable.ownedBy, username));

  const total = codes.length;
  const used = codes.filter(c => !!c.redeemedBy).length;
  const expired = codes.filter(c => !c.redeemedBy && c.expiresAt < now).length;
  const active = total - used - expired;

  // Estimate revenue (codes sold × retail price per code)
  const RETAIL_PER_DAY: Record<string, number> = { "7": 40, "14": 70, "30": 100 };
  const revenueEstCents = codes.filter(c => !!c.redeemedBy)
    .reduce((acc, c) => acc + (RETAIL_PER_DAY[String(c.days)] ?? 0) * 100, 0);

  res.json({ total, active, used, expired, revenueEstCents, revenueEstBrl: (revenueEstCents / 100).toFixed(2) });
});

// ─── GET /affiliate/purchases ──────────────────────────────────────────────────
router.get("/affiliate/purchases", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const purchases = await db.select().from(infinityGiftPurchasesTable)
    .where(eq(infinityGiftPurchasesTable.username, username))
    .orderBy(desc(infinityGiftPurchasesTable.createdAt)).limit(50);
  res.json(purchases.map(p => ({
    id: p.id, packId: p.packId, codesCount: p.codesCount,
    amountCents: p.amountCents, amountBrl: (p.amountCents / 100).toFixed(2),
    paymentMethod: p.paymentMethod, status: p.status,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
  })));
});

// ─── GET /referral ─────────────────────────────────────────────────────────────
router.get("/referral", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const referrals = await db.select().from(infinityReferralsTable)
    .where(eq(infinityReferralsTable.referrerUsername, username))
    .orderBy(desc(infinityReferralsTable.createdAt));

  const totalBonus = referrals.filter(r => !!r.appliedAt).reduce((acc, r) => acc + r.bonusDays, 0);
  const baseUrl = process.env.PANEL_URL ?? "https://hydraconsultoria.pro";

  res.json({
    referralCode: username,
    referralLink: `${baseUrl}/registro?ref=${encodeURIComponent(username)}`,
    bonusDaysPerReferral: REFERRAL_BONUS_DAYS,
    totalReferrals: referrals.length,
    confirmedReferrals: referrals.filter(r => !!r.appliedAt).length,
    totalBonusDaysEarned: totalBonus,
    referrals: referrals.map(r => ({
      id: r.id,
      referredUsername: r.referredUsername,
      bonusDays: r.bonusDays,
      appliedAt: r.appliedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// ─── POST /gift/redeem — for new users (no auth) ───────────────────────────────
router.post("/gift/redeem", loginLimiter, async (req, res) => {
  const { code, username, password } = req.body ?? {};
  if (!code || !username || !password) {
    res.status(400).json({ error: "code, username e password obrigatórios" }); return;
  }
  const codeStr = String(code).trim().toUpperCase();
  const userStr = String(username).trim().toLowerCase();
  const passStr = String(password);

  if (!/^[a-z0-9_]{3,30}$/.test(userStr)) {
    res.status(400).json({ error: "Usuário inválido (3-30 chars, letras/números/_)" }); return;
  }
  if (passStr.length < 6) {
    res.status(400).json({ error: "Senha deve ter no mínimo 6 caracteres" }); return;
  }

  const now = new Date();
  const [giftCode] = await db.select().from(infinityGiftCodesTable)
    .where(eq(infinityGiftCodesTable.code, codeStr)).limit(1);

  if (!giftCode) { res.status(404).json({ error: "Código inválido ou não encontrado" }); return; }
  if (giftCode.redeemedBy) { res.status(409).json({ error: "Código já foi utilizado" }); return; }
  if (giftCode.expiresAt < now) { res.status(410).json({ error: "Código expirado" }); return; }

  const [existing] = await db.select({ username: infinityUsersTable.username })
    .from(infinityUsersTable).where(eq(infinityUsersTable.username, userStr)).limit(1);
  if (existing) { res.status(409).json({ error: "Usuário já existe. Faça login e use /gift/redeem-account." }); return; }

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.default.hash(passStr, 10);
  const accountExpiresAt = new Date(now.getTime() + giftCode.days * 86400_000);

  await db.insert(infinityUsersTable).values({ username: userStr, passwordHash, role: "user", accountExpiresAt });
  await db.update(infinityGiftCodesTable)
    .set({ redeemedBy: userStr, redeemedAt: now })
    .where(eq(infinityGiftCodesTable.code, codeStr));

  res.json({ ok: true, username: userStr, days: giftCode.days, expiresAt: accountExpiresAt.toISOString() });
});

// ─── POST /gift/redeem-account — for logged-in users (extend) ─────────────────
router.post("/gift/redeem-account", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const { code } = req.body ?? {};
  if (!code) { res.status(400).json({ error: "code obrigatório" }); return; }
  const codeStr = String(code).trim().toUpperCase();
  const now = new Date();

  const [giftCode] = await db.select().from(infinityGiftCodesTable)
    .where(eq(infinityGiftCodesTable.code, codeStr)).limit(1);
  if (!giftCode) { res.status(404).json({ error: "Código inválido" }); return; }
  if (giftCode.redeemedBy) { res.status(409).json({ error: "Código já foi utilizado" }); return; }
  if (giftCode.expiresAt < now) { res.status(410).json({ error: "Código expirado" }); return; }

  // Prevent self-redemption (affiliate using their own codes)
  if (giftCode.ownedBy === username) {
    res.status(403).json({ error: "Não é permitido resgatar seus próprios códigos" }); return;
  }

  const [user] = await db.select().from(infinityUsersTable)
    .where(eq(infinityUsersTable.username, username)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  const base = user.accountExpiresAt && user.accountExpiresAt > now ? user.accountExpiresAt : now;
  const newExpiry = new Date(base.getTime() + giftCode.days * 86400_000);

  await db.update(infinityUsersTable).set({ accountExpiresAt: newExpiry }).where(eq(infinityUsersTable.username, username));
  await db.update(infinityGiftCodesTable).set({ redeemedBy: username, redeemedAt: now }).where(eq(infinityGiftCodesTable.code, codeStr));

  res.json({ ok: true, days: giftCode.days, newExpiresAt: newExpiry.toISOString() });
});

// ─── POST /referral/apply — called when a referred user completes payment ──────
export async function applyReferral(referredUsername: string, referredBy: string) {
  try {
    const [referrer] = await db.select({ username: infinityUsersTable.username, accountExpiresAt: infinityUsersTable.accountExpiresAt })
      .from(infinityUsersTable).where(eq(infinityUsersTable.username, referredBy)).limit(1);
    if (!referrer) return;

    // Check not duplicate
    const [existing] = await db.select().from(infinityReferralsTable)
      .where(eq(infinityReferralsTable.referredUsername, referredUsername)).limit(1);
    if (existing) return;

    await db.insert(infinityReferralsTable).values({
      referrerUsername: referredBy, referredUsername, bonusDays: REFERRAL_BONUS_DAYS, appliedAt: new Date(),
    });

    const base = referrer.accountExpiresAt && referrer.accountExpiresAt > new Date() ? referrer.accountExpiresAt : new Date();
    const newExpiry = new Date(base.getTime() + REFERRAL_BONUS_DAYS * 86400_000);
    await db.update(infinityUsersTable).set({ accountExpiresAt: newExpiry }).where(eq(infinityUsersTable.username, referredBy));
  } catch {}
}

export default router;
