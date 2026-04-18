import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const credentialEntriesTable = pgTable(
  "credential_entries",
  {
    id:          serial("id").primaryKey(),
    domain:      text("domain").notNull(),
    login:       text("login").notNull(),
    password:    text("password").notNull(),
    source:      text("source").notNull().default("manual"),
    importedAt:  timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credential_entries_domain_idx").on(t.domain),
  ],
);

export const insertCredentialSchema = createInsertSchema(credentialEntriesTable).omit({
  id: true,
  importedAt: true,
});
export type InsertCredential = z.infer<typeof insertCredentialSchema>;
export type CredentialEntry = typeof credentialEntriesTable.$inferSelect;
