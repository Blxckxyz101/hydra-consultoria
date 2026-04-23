import app from "./app";
import { logger } from "./lib/logger";
import { db, attacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const startServer = (attempt = 1, maxAttempts = 10, delayMs = 2000) => {
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");

    // ── Discord bot auto-launch ─────────────────────────────────────────────
    // In production (REPLIT_DEPLOYMENT=1) the Discord bot is NOT a separate
    // workflow — it must be spawned here so it runs in the deployed container.
    // In dev, the bot already runs as its own workflow, so we skip this.
    if (process.env["REPLIT_DEPLOYMENT"] === "1") {
      const botDist = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../discord-bot/dist/index.mjs",
      );

      if (existsSync(botDist)) {
        let botProc: ChildProcess | null = null;

        const launchBot = () => {
          logger.info({ botDist }, "Launching Discord bot process...");
          botProc = spawn(process.execPath, ["--enable-source-maps", botDist], {
            env: process.env,
            stdio: "inherit",
          });
          botProc.on("exit", (code, signal) => {
            logger.warn({ code, signal }, "Discord bot process exited — restarting in 5s...");
            setTimeout(launchBot, 5_000);
          });
          botProc.on("error", (spawnErr) => {
            logger.error({ spawnErr }, "Discord bot spawn error");
          });
        };

        launchBot();
      } else {
        logger.warn({ botDist }, "Discord bot dist not found — skipping bot launch (run build first)");
      }
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      if (attempt >= maxAttempts) {
        logger.error({ port, attempt }, "Port still in use after max retries — giving up");
        process.exit(1);
      }
      logger.warn({ port, attempt, delayMs }, `Port in use — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
      setTimeout(() => startServer(attempt + 1, maxAttempts, delayMs), delayMs);
    } else {
      logger.error({ err }, "Unexpected server error");
      process.exit(1);
    }
  });
};

startServer();
