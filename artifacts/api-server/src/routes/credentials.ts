import { Router } from "express";
import { db, credentialEntriesTable } from "@workspace/db";
import { eq, ilike, sql } from "drizzle-orm";

const router = Router();

// ── POST /api/credentials/import ─────────────────────────────────────────────
// Accepts raw text body (one login:password per line). Parses and stores them.
router.post("/import", async (req, res) => {
  try {
    const { source = "upload" } = req.query as Record<string, string>;
    const body = req.body as string;
    if (typeof body !== "string" || !body.trim()) {
      res.status(400).json({ error: "Empty body" });
      return;
    }

    const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      res.status(400).json({ error: "No valid lines found" });
      return;
    }

    const rows: { domain: string; login: string; password: string; source: string }[] = [];
    let skipped = 0;

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0) { skipped++; continue; }
      const rawLogin = line.slice(0, colonIdx).trim();
      const rawPass  = line.slice(colonIdx + 1).trim();
      if (!rawPass) { skipped++; continue; }

      const domain = extractDomain(rawLogin);
      rows.push({ domain, login: rawLogin, password: rawPass, source: String(source) });
    }

    if (rows.length === 0) {
      res.status(400).json({ error: "No parseable credentials", skipped });
      return;
    }

    // Batch insert in chunks of 500
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.insert(credentialEntriesTable).values(chunk);
      inserted += chunk.length;
    }

    res.json({ inserted, skipped, total: lines.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/credentials/search ───────────────────────────────────────────────
// ?domain=github.com&limit=500
router.get("/search", async (req, res) => {
  try {
    const { domain, limit: rawLimit = "500" } = req.query as Record<string, string>;
    if (!domain) {
      res.status(400).json({ error: "domain is required" });
      return;
    }
    const limit = Math.min(Number(rawLimit) || 500, 5_000);

    // Normalize domain: strip www., http(s)://, trailing path
    const norm = normalizeDomain(domain);

    const rows = await db
      .select({
        login:    credentialEntriesTable.login,
        password: credentialEntriesTable.password,
        source:   credentialEntriesTable.source,
      })
      .from(credentialEntriesTable)
      .where(ilike(credentialEntriesTable.domain, `%${norm}%`))
      .limit(limit);

    res.json({ domain: norm, count: rows.length, credentials: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/credentials/stats ────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  try {
    const [total] = await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(credentialEntriesTable);
    const topDomains = await db
      .select({
        domain: credentialEntriesTable.domain,
        count:  sql<number>`count(*)`.mapWith(Number),
      })
      .from(credentialEntriesTable)
      .groupBy(credentialEntriesTable.domain)
      .orderBy(sql`count(*) DESC`)
      .limit(10);
    res.json({ total: total?.total ?? 0, topDomains });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/credentials/domain ───────────────────────────────────────────
router.delete("/domain", async (req, res) => {
  try {
    const { domain } = req.query as Record<string, string>;
    if (!domain) { res.status(400).json({ error: "domain required" }); return; }
    const norm = normalizeDomain(domain);
    const deleted = await db
      .delete(credentialEntriesTable)
      .where(ilike(credentialEntriesTable.domain, `%${norm}%`))
      .returning({ id: credentialEntriesTable.id });
    res.json({ deleted: deleted.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractDomain(login: string): string {
  // Check if it's an email
  const emailMatch = login.match(/@([^@]+)$/);
  if (emailMatch) {
    const parts = emailMatch[1].split(".");
    if (parts.length >= 2) return parts.slice(-2).join(".");
    return emailMatch[1];
  }
  // Check if it looks like a URL
  try {
    const url = new URL(login.startsWith("http") ? login : `https://${login}`);
    const host = url.hostname.replace(/^www\./, "");
    return host || "unknown";
  } catch { /**/ }
  // Fallback: use the raw login as-is domain
  return "generic";
}

function normalizeDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();
}

export default router;
