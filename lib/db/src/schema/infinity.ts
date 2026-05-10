import { pgTable, text, timestamp, serial, boolean, jsonb, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const infinityUsersTable = pgTable("infinity_users", {
  username:         text("username").primaryKey(),
  passwordHash:     text("password_hash").notNull(),
  role:             text("role").notNull().default("user"),
  displayName:      text("display_name"),
  accountPin:       text("account_pin"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt:      timestamp("last_login_at", { withTimezone: true }),
  accountExpiresAt: timestamp("account_expires_at", { withTimezone: true }),
  queryDailyLimit:  integer("query_daily_limit"),
  // Profile fields (synced to DB)
  profilePhoto:     text("profile_photo"),
  profileBanner:    text("profile_banner"),
  profileBio:       text("profile_bio"),
  profileStatus:    text("profile_status").default("online"),
  profileStatusMsg: text("profile_status_msg"),
  hideUsername:     boolean("hide_username").notNull().default(false),
});

export const infinitySessionsTable = pgTable("infinity_sessions", {
  token:     text("token").primaryKey(),
  username:  text("username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const infinityConsultasTable = pgTable(
  "infinity_consultas",
  {
    id:        serial("id").primaryKey(),
    tipo:      text("tipo").notNull(),
    query:     text("query").notNull(),
    username:  text("username").notNull(),
    success:   boolean("success").notNull().default(false),
    result:    jsonb("result"),
    skylers:   boolean("skylers").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_consultas_user_idx").on(t.username),
    byCreated: index("infinity_consultas_created_idx").on(t.createdAt),
  }),
);

export const infinityPinsTable = pgTable("infinity_pins", {
  pin:       text("pin").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  usedAt:    timestamp("used_at", { withTimezone: true }),
  usedBy:    text("used_by"),
});

// ─── Payment + Pending Account tables ────────────────────────────────────────

export const infinityPaymentsTable = pgTable(
  "infinity_payments",
  {
    id:            text("id").primaryKey(),
    username:      text("username"),
    planId:        text("plan_id").notNull(),
    amountCents:   integer("amount_cents").notNull(),
    status:        text("status").notNull().default("pending"),
    nedpayId:      text("nedpay_id"),
    pixCode:       text("pix_code"),
    pixQr:         text("pix_qr"),
    expiresAt:     timestamp("expires_at", { withTimezone: true }),
    paidAt:        timestamp("paid_at", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Purpose field for multi-use payments
    purpose:       text("purpose").notNull().default("subscription"),
    purposeMeta:   text("purpose_meta"),
  },
  (t) => ({
    byUsername: index("infinity_payments_username_idx").on(t.username),
    byStatus:   index("infinity_payments_status_idx").on(t.status),
  }),
);

export const infinityPendingAccountsTable = pgTable(
  "infinity_pending_accounts",
  {
    id:           serial("id").primaryKey(),
    username:     text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    email:        text("email"),
    planId:       text("plan_id").notNull(),
    paymentId:    text("payment_id").notNull(),
    status:       text("status").notNull().default("pending_payment"),
    rejectedReason: text("rejected_reason"),
    referredBy:   text("referred_by"),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("infinity_pending_accounts_status_idx").on(t.status),
  }),
);

// ─── Wallet ────────────────────────────────────────────────────────────────────

export const infinityWalletTable = pgTable("infinity_wallet", {
  username:     text("username").primaryKey(),
  balanceCents: integer("balance_cents").notNull().default(0),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const infinityWalletTxnsTable = pgTable(
  "infinity_wallet_txns",
  {
    id:          serial("id").primaryKey(),
    username:    text("username").notNull(),
    direction:   text("direction").notNull(), // "credit" | "debit"
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    refId:       text("ref_id"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_wallet_txns_user_idx").on(t.username),
  }),
);

// ─── Gift Cards ────────────────────────────────────────────────────────────────

export const infinityGiftPurchasesTable = pgTable(
  "infinity_gift_purchases",
  {
    id:            serial("id").primaryKey(),
    username:      text("username").notNull(),
    packId:        text("pack_id").notNull(),
    codesCount:    integer("codes_count").notNull(),
    amountCents:   integer("amount_cents").notNull(),
    paymentMethod: text("payment_method").notNull(), // "pix" | "wallet"
    paymentId:     text("payment_id"),
    status:        text("status").notNull().default("pending"), // "pending" | "completed" | "cancelled"
    completedAt:   timestamp("completed_at", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser:   index("infinity_gift_purchases_user_idx").on(t.username),
    byStatus: index("infinity_gift_purchases_status_idx").on(t.status),
  }),
);

export const infinityGiftCodesTable = pgTable(
  "infinity_gift_codes",
  {
    code:        text("code").primaryKey(), // INFY-XXXX-XXXX-XXXX
    packId:      text("pack_id").notNull(),
    days:        integer("days").notNull(),
    ownedBy:     text("owned_by").notNull(),
    purchaseId:  integer("purchase_id").notNull(),
    redeemedBy:  text("redeemed_by"),
    redeemedAt:  timestamp("redeemed_at", { withTimezone: true }),
    expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner:    index("infinity_gift_codes_owner_idx").on(t.ownedBy),
    byPurchase: index("infinity_gift_codes_purchase_idx").on(t.purchaseId),
  }),
);

// ─── Profile Presets ─────────────────────────────────────────────────────────

export const infinityProfilePresetsTable = pgTable(
  "infinity_profile_presets",
  {
    id:        serial("id").primaryKey(),
    username:  text("username").notNull(),
    name:      text("name").notNull(),
    theme:     text("theme"),
    photo:     text("photo"),
    banner:    text("banner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_profile_presets_user_idx").on(t.username),
  }),
);

export type InfinityProfilePresetRow = typeof infinityProfilePresetsTable.$inferSelect;

// ─── Notifications ───────────────────────────────────────────────────────────

export const infinityNotificationsTable = pgTable(
  "infinity_notifications",
  {
    id:          text("id").primaryKey(),
    title:       text("title").notNull(),
    body:        text("body").notNull(),
    imageUrl:    text("image_url"),
    authorName:  text("author_name").notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreated: index("infinity_notifications_created_idx").on(t.createdAt),
  }),
);

export type InfinityNotificationRow = typeof infinityNotificationsTable.$inferSelect;

// ─── Referrals ─────────────────────────────────────────────────────────────────

export const infinityReferralsTable = pgTable(
  "infinity_referrals",
  {
    id:               serial("id").primaryKey(),
    referrerUsername: text("referrer_username").notNull(),
    referredUsername: text("referred_username").notNull().unique(),
    bonusDays:        integer("bonus_days").notNull().default(7),
    appliedAt:        timestamp("applied_at", { withTimezone: true }),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReferrer: index("infinity_referrals_referrer_idx").on(t.referrerUsername),
  }),
);

export const insertInfinityUserSchema = createInsertSchema(infinityUsersTable);
export type InsertInfinityUser        = z.infer<typeof insertInfinityUserSchema>;
export type InfinityUserRow           = typeof infinityUsersTable.$inferSelect;
export type InfinitySessionRow        = typeof infinitySessionsTable.$inferSelect;
export type InfinityConsultaRow       = typeof infinityConsultasTable.$inferSelect;
export type InfinityPinRow            = typeof infinityPinsTable.$inferSelect;
export type InfinityPaymentRow        = typeof infinityPaymentsTable.$inferSelect;
export type InfinityPendingAccountRow = typeof infinityPendingAccountsTable.$inferSelect;
export type InfinityWalletRow         = typeof infinityWalletTable.$inferSelect;
export type InfinityGiftCodeRow       = typeof infinityGiftCodesTable.$inferSelect;
export type InfinityGiftPurchaseRow   = typeof infinityGiftPurchasesTable.$inferSelect;
export type InfinityReferralRow       = typeof infinityReferralsTable.$inferSelect;
