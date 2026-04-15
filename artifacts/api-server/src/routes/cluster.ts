/**
 * CLUSTER ROUTES
 *
 * Manages the 10-node deployment cluster.
 * CLUSTER_NODES env var: comma-separated list of peer API node base URLs.
 * e.g. CLUSTER_NODES=https://node2.replit.app,https://node3.replit.app
 */
import { Router, type IRouter } from "express";
import os from "node:os";

const router: IRouter = Router();

// ── Parse cluster nodes from env ─────────────────────────────────────────────
export const CLUSTER_NODES = (() => {
  const raw = process.env.CLUSTER_NODES ?? "";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
})();

// ── GET /cluster/status — ping all peer nodes ────────────────────────────────
router.get("/cluster/status", async (_req, res): Promise<void> => {
  const t0 = Date.now();
  const nodeResults = await Promise.allSettled(
    CLUSTER_NODES.map(async (nodeUrl) => {
      const ts = Date.now();
      try {
        const r = await fetch(`${nodeUrl.replace(/\/$/, "")}/api/healthz`, {
          signal: AbortSignal.timeout(3000),
        });
        const latencyMs = Date.now() - ts;
        let cpus: number | undefined;
        let freeMem: number | undefined;
        if (r.ok) {
          try {
            const d = await r.json() as { cpus?: number; freeMem?: number };
            cpus    = d.cpus;
            freeMem = d.freeMem;
          } catch { /**/ }
        }
        return { url: nodeUrl, online: r.ok, latencyMs, cpus, freeMem };
      } catch {
        return { url: nodeUrl, online: false, latencyMs: -1 };
      }
    })
  );

  const nodes = nodeResults.map(r =>
    r.status === "fulfilled" ? r.value : { url: "unknown", online: false, latencyMs: -1 }
  );

  res.json({
    self: {
      url:     "self",
      online:  true,
      latencyMs: Date.now() - t0,
      cpus:    os.cpus().length,
      freeMem: Math.round(os.freemem() / 1024 / 1024),
    },
    nodes,
    totalOnline:      nodes.filter(n => n.online).length + 1,  // +1 for self
    configuredNodes:  CLUSTER_NODES.length,
  });
});

// ── GET /cluster/nodes — list configured peer nodes ──────────────────────────
router.get("/cluster/nodes", (_req, res): void => {
  res.json({
    nodes:            CLUSTER_NODES,
    count:            CLUSTER_NODES.length,
    cpus:             os.cpus().length,
    totalRamMb:       Math.round(os.totalmem() / 1024 / 1024),
    freeRamMb:        Math.round(os.freemem() / 1024 / 1024),
  });
});

export default router;
