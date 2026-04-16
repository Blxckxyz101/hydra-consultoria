/**
 * SERVER-SENT EVENTS — /api/events
 *
 * Real-time push to the panel. Replaces polling for:
 * - Proxy count + residential stats
 * - Active attack count
 * - Fetching state
 *
 * Clients connect once; server pushes every 2s. Heartbeat every 15s.
 * Falls back gracefully if EventSource is unavailable (panel has polling fallback).
 */
import { Router, type Request, type Response } from "express";
import { proxyCache, getResidentialCreds, isFetchingProxies } from "./proxies.js";
import { getActiveAttackCount } from "./attacks.js";

const router = Router();

// ── Connected SSE clients ─────────────────────────────────────────────────────
const clients = new Set<Response>();

export function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { (client as Response & { write: (s: string) => boolean }).write(payload); }
    catch { clients.delete(client); }
  }
}

// ── SSE endpoint ──────────────────────────────────────────────────────────────
router.get("/events", (req: Request, res: Response): void => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  clients.add(res);

  // Send immediate snapshot
  const snap = buildSnapshot();
  res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);

  // Heartbeat every 15s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); }
    catch { clearInterval(heartbeat); clients.delete(res); }
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

// ── Push snapshot every 2 seconds ────────────────────────────────────────────
function buildSnapshot() {
  const rc = getResidentialCreds();
  return {
    proxyCount:        proxyCache.length,
    fetching:          isFetchingProxies(),
    residentialCount:  rc ? rc.count : 0,
    residential:       rc ? { host: rc.host, port: rc.port, count: rc.count, username: rc.username } : null,
    activeAttacks:     getActiveAttackCount(),
    ts:                Date.now(),
  };
}

setInterval(() => {
  if (clients.size === 0) return;
  broadcastEvent("update", buildSnapshot());
}, 2_000);

export default router;
