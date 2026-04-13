import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attacksTable = pgTable("attacks", {
  id: serial("id").primaryKey(),
  target: text("target").notNull(),
  port: integer("port").notNull(),
  method: text("method").notNull(),
  duration: integer("duration").notNull(),
  threads: integer("threads").notNull(),
  status: text("status").notNull().default("running"),
  packetsSent: integer("packets_sent"),
  bytesSent: integer("bytes_sent"),
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
