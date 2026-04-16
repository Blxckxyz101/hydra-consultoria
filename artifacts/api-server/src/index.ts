import app from "./app";
import { logger } from "./lib/logger";
import { db, attacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Stale attack cleanup — runs once at startup ────────────────────────────
// Any attack marked "running" in the DB is stale — workers died with the last process.
// Mark them all "stopped" so the stats and panel are accurate on every boot.
void (async () => {
  try {
    const result = await db
      .update(attacksTable)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(attacksTable.status, "running"))
      .returning({ id: attacksTable.id });
    if (result.length > 0) {
      logger.info({ cleaned: result.length }, "Cleaned up stale running attacks on startup");
    }
  } catch (err) {
    logger.warn({ err }, "Stale attack cleanup failed (non-fatal)");
  }
})();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
