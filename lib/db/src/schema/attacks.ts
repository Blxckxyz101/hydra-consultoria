import { pgTable, text, serial, timestamp, integer, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attacksTable = pgTable("attacks", {
  id: serial("id").primaryKey(),
  target: text("target").notNull(),
  port: integer("port").notNull(),
  method: text("method").notNull(),
  duration: integer("duration").notNull(),
  threads: integer("threads").notNull(),
  threadsEffective: integer("threads_effective"),
  status: text("status").notNull().default("running"),
  packetsSent: bigint("packets_sent", { mode: "number" }),
  bytesSent: bigint("bytes_sent", { mode: "number" }),
  codesOk: integer("codes_ok"),
  codesRedir: integer("codes_redir"),
  codesClient: integer("codes_client"),
  codesServer: integer("codes_server"),
  codesTimeout: integer("codes_timeout"),
  webhookUrl: text("webhook_url"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttackSchema = createInsertSchema(attacksTable).omit({
  id: true,
  createdAt: true,
  startedAt: true,
});
export type InsertAttack = z.infer<typeof insertAttackSchema>;
export type Attack = typeof attacksTable.$inferSelect;
