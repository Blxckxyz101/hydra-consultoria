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
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("infinity_pending_accounts_status_idx").on(t.status),
  }),
);

export const insertInfinityUserSchema = createInsertSchema(infinityUsersTable);
export type InsertInfinityUser = z.infer<typeof insertInfinityUserSchema>;
export type InfinityUserRow    = typeof infinityUsersTable.$inferSelect;
export type InfinitySessionRow = typeof infinitySessionsTable.$inferSelect;
export type InfinityConsultaRow = typeof infinityConsultasTable.$inferSelect;
export type InfinityPinRow     = typeof infinityPinsTable.$inferSelect;
export type InfinityPaymentRow = typeof infinityPaymentsTable.$inferSelect;
export type InfinityPendingAccountRow = typeof infinityPendingAccountsTable.$inferSelect;
