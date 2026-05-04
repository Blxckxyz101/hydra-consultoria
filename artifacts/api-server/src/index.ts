import app from "./app";
import { logger } from "./lib/logger";
import { db, attacksTable, infinitySessionsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
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

// ── Expired session cleanup — runs every 24h ───────────────────────────────
async function cleanExpiredSessions() {
  try {
    const deleted = await db
      .delete(infinitySessionsTable)
      .where(lt(infinitySessionsTable.expiresAt, new Date()))
      .returning({ token: infinitySessionsTable.token });
    if (deleted.length > 0) {
      logger.info({ deleted: deleted.length }, "Cleaned up expired infinity sessions");
    }
  } catch (err) {
    logger.warn({ err }, "Expired session cleanup failed (non-fatal)");
  }
}
void cleanExpiredSessions();
setInterval(() => void cleanExpiredSessions(), 24 * 60 * 60 * 1000);

const startServer = (attempt = 1, maxAttempts = 10, delayMs = 2000) => {
  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");

    // Prevent "other side closed" errors when clients (Discord bot, panel) reuse
    // HTTP keep-alive connections. Node.js defaults to 5s — too short for callers
    // that poll every 5-10s. Set to 65s (must be > any client-side idle timeout).
    server.keepAliveTimeout = 65_000;
    // headersTimeout must be > keepAliveTimeout to avoid a race condition where
    // the server sends FIN while the client is mid-request.
    server.headersTimeout = 66_000;

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
          botProc = spawn(process.execPath, ["--max-old-space-size=384", botDist], {
            env: process.env,
            stdio: "inherit",
          });
          botProc.on("exit", (code, signal) => {
            // Exit code 0 = clean intentional exit (e.g. dev instance deferring to prod)
            // Don't restart on clean exit — that would create a crash loop
            if (code === 0) {
              logger.info({ code, signal }, "Discord bot exited cleanly — not restarting");
              return;
            }
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

      // Telegram bot
      const tgBotDist = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../telegram-bot/dist/index.mjs",
      );

      if (existsSync(tgBotDist)) {
        let tgProc: ChildProcess | null = null;

        const launchTg = () => {
          logger.info({ tgBotDist }, "Launching Telegram bot process...");
          tgProc = spawn(process.execPath, ["--max-old-space-size=256", tgBotDist], {
            env: process.env,
            stdio: "inherit",
          });
          tgProc.on("exit", (code, signal) => {
            // Exit code 0 = clean intentional exit (e.g. "another instance already running")
            // Don't restart on clean exit — that would create a crash loop
            if (code === 0) {
              logger.info({ code, signal }, "Telegram bot exited cleanly — not restarting");
              return;
            }
            logger.warn({ code, signal }, "Telegram bot process exited — restarting in 5s...");
            setTimeout(launchTg, 5_000);
          });
          tgProc.on("error", (spawnErr) => {
            logger.error({ spawnErr }, "Telegram bot spawn error");
          });
        };

        launchTg();
      } else {
        logger.warn({ tgBotDist }, "Telegram bot dist not found — skipping bot launch (run build first)");
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
