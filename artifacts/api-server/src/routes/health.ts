import { Router, type IRouter } from "express";
import os from "node:os";
import { HealthCheckResponse } from "@workspace/api-zod";
import { attackLiveConns, attackAborts } from "./attacks.js";

const router: IRouter = Router();
const STARTED_AT = Date.now();

router.get(["/healthz", "/health"], (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Detailed live health: uptime, RAM, CPU load, active attacks, total live conns
router.get("/health/live", (_req, res) => {
  const mem      = process.memoryUsage();
  const totalRam = os.totalmem();
  const freeRam  = os.freemem();
  const usedRam  = totalRam - freeRam;
  const load     = os.loadavg();
  const cpus     = os.cpus().length;

  let totalConns = 0;
  for (const c of attackLiveConns.values()) totalConns += c;
  const activeAttacks = attackAborts.size;

  // Health score: green < 70% RAM, yellow 70–85%, red > 85% or load > cpus
  const ramPct  = Math.round((usedRam / totalRam) * 1000) / 10;
  const loadPct = Math.round((load[0] / cpus) * 1000) / 10;
  let status: "healthy" | "warning" | "critical" = "healthy";
  if (ramPct > 85 || loadPct > 100) status = "critical";
  else if (ramPct > 70 || loadPct > 75) status = "warning";

  res.json({
    status,
    uptimeSec:    Math.floor((Date.now() - STARTED_AT) / 1000),
    process: {
      heapUsedMB:  Math.round(mem.heapUsed / 1048576),
      heapTotalMB: Math.round(mem.heapTotal / 1048576),
      rssMB:       Math.round(mem.rss / 1048576),
      pid:         process.pid,
    },
    system: {
      cpus,
      load1:        load[0],
      load5:        load[1],
      load15:       load[2],
      loadPct,
      totalRamMB:   Math.round(totalRam / 1048576),
      usedRamMB:    Math.round(usedRam / 1048576),
      freeRamMB:    Math.round(freeRam / 1048576),
      ramPct,
      hostname:     os.hostname(),
      platform:     os.platform(),
    },
    attacks: {
      active:      activeAttacks,
      totalConns,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
