import { pgTable, text, timestamp, serial, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const infinityUsersTable = pgTable("infinity_users", {
  username:    text("username").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  role:        text("role").notNull().default("user"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_consultas_user_idx").on(t.username),
    byCreated: index("infinity_consultas_created_idx").on(t.createdAt),
  }),
);

export const insertInfinityUserSchema = createInsertSchema(infinityUsersTable);
export type InsertInfinityUser = z.infer<typeof insertInfinityUserSchema>;
export type InfinityUserRow = typeof infinityUsersTable.$inferSelect;
export type InfinitySessionRow = typeof infinitySessionsTable.$inferSelect;
export type InfinityConsultaRow = typeof infinityConsultasTable.$inferSelect;
