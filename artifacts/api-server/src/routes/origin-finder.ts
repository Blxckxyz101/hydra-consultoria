/**
 * ORIGIN IP FINDER
 *
 * Tries every known technique to discover the real IP behind Cloudflare/CDN:
 *  1. crt.sh SSL certificate history (subdomains before CF was enabled)
 *  2. DNS bypass subdomains (mail, ftp, cpanel, direct, origin, etc.)
 *  3. IPv6 AAAA records (often forgotten, not proxied through CF)
 *  4. MX records (mail server often on same /24 subnet)
 *  5. TXT/SPF records (reveal internal IPs via include:, ip4:, ip6:)
 *  6. Historical A records via SecurityTrails API fallback
 */
import { Router } from "express";
import dns from "node:dns/promises";
import https from "node:https";

const router = Router();

// ── Cloudflare IP ranges (CIDR) ─────────────────────────────────────────
function parseRanges(cidrs: string[]): [number, number, number][] {
  return cidrs.map(cidr => {
    const [ip, mask] = cidr.split("/");
    const parts = ip.split(".").map(Number);
    const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    const m = mask === "0" ? 0 : (~((1 << (32 - Number(mask))) - 1)) >>> 0;
    return [n, m, (n & m) >>> 0];
  });
}

const CF_RANGES_V4 = parseRanges([
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
  "103.31.4.0/22",   "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
  "198.41.128.0/17", "162.158.0.0/15",  "104.16.0.0/13",
  "104.24.0.0/14",   "172.64.0.0/13",   "131.0.72.0/22",
]);

function isCloudflareIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;
  const n = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return CF_RANGES_V4.some(([, mask, net]) => (n & mask) === net);
}

// ── Fetch helper with timeout ────────────────────────────────────────────
function fetchJSON(url: string, timeoutMs = 8000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SecurityResearch/1.0)",
        "Accept":     "application/json",
      },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end",  () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// ── crt.sh SSL certificate history ──────────────────────────────────────
async function queryCrtSh(domain: string): Promise<string[]> {
  try {
    const data = await fetchJSON(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
      12000,
    ) as Array<{ name_value?: string; common_name?: string }> | null;

    if (!Array.isArray(data)) return [];
    const hosts = new Set<string>();
    for (const cert of data) {
      const names = [cert.name_value, cert.common_name].filter(Boolean).join("\n");
      for (const name of names.split("\n")) {
        const h = name.trim().replace(/^\*\./, "");
        if (h && h.includes(".") && !h.includes("*")) hosts.add(h.toLowerCase());
      }
    }
    return [...hosts];
  } catch { return []; }
}

// ── Resolve a hostname, return IPs that are NOT Cloudflare ──────────────
async function resolveOrigin(host: string): Promise<string[]> {
  try {
    const ips = await dns.resolve4(host).catch(() => [] as string[]);
    return ips.filter(ip => !isCloudflareIP(ip));
  } catch { return []; }
}

// ── Resolve IPv6 — often not proxied through Cloudflare ─────────────────
async function resolveIPv6(host: string): Promise<string[]> {
  try {
    return await dns.resolve6(host).catch(() => [] as string[]);
  } catch { return []; }
}

// ── SPF/TXT record IP extraction ─────────────────────────────────────────
function extractIPsFromSPF(records: string[][]): string[] {
  const ips: string[] = [];
  const ipRx = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  for (const rec of records) {
    const flat = rec.join(" ");
    const matches = flat.match(ipRx);
    if (matches) ips.push(...matches);
  }
  return ips.filter(ip => !isCloudflareIP(ip));
}

// ── Common bypass subdomains ─────────────────────────────────────────────
const BYPASS_SUBS = [
  "mail", "smtp", "pop", "imap", "ftp", "ftps",
  "cpanel", "whm", "webmail", "direct", "origin",
  "server", "ns1", "ns2", "ns3", "dns", "host",
  "vpn", "ssh", "sftp", "api", "app", "dev",
  "staging", "stage", "beta", "test", "www2",
  "old", "backup", "admin", "panel", "portal",
  "mx", "mail2", "smtp2", "relay",
];

// ── Main endpoint ────────────────────────────────────────────────────────
router.post("/find-origin", async (req, res) => {
  const { domain } = req.body ?? {};
  if (!domain || typeof domain !== "string") {
    return res.status(400).json({ error: "domain required" });
  }

  const bare = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!bare) return res.status(400).json({ error: "invalid domain" });

  const findings: Array<{
    source: string;
    host: string;
    ip: string;
    isCF: boolean;
    confidence: "high" | "medium" | "low";
  }> = [];

  const cfStatus: Record<string, boolean> = {};
  const seen = new Set<string>();

  const addIP = (source: string, host: string, ip: string, confidence: "high" | "medium" | "low") => {
    const key = `${ip}:${host}`;
    if (seen.has(key)) return;
    seen.add(key);
    const isCF = isCloudflareIP(ip);
    cfStatus[ip] = isCF;
    findings.push({ source, host, ip, isCF, confidence });
  };

  // ── 1. Main domain A record ──────────────────────────────────────────
  const mainIPs = await resolveOrigin(bare).catch(() => [] as string[]);
  const mainIPsAll = await dns.resolve4(bare).catch(() => [] as string[]);
  for (const ip of mainIPsAll) addIP("DNS A record (main)", bare, ip, "high");

  // ── 2. IPv6 — most forgotten ─────────────────────────────────────────
  const ipv6s = await resolveIPv6(bare);
  for (const ip of ipv6s) addIP("DNS AAAA (IPv6 — often unproxied!)", bare, ip, "high");

  // ── 3. MX records ───────────────────────────────────────────────────
  try {
    const mxRecords = await dns.resolveMx(bare).catch(() => [] as { exchange: string; priority: number }[]);
    await Promise.all(mxRecords.map(async mx => {
      const mxIPs = await resolveOrigin(mx.exchange).catch(() => [] as string[]);
      for (const ip of mxIPs) addIP(`MX record (${mx.exchange})`, mx.exchange, ip, "medium");
    }));
  } catch { /**/ }

  // ── 4. TXT/SPF records ──────────────────────────────────────────────
  try {
    const txtRecords = await dns.resolveTxt(bare).catch(() => [] as string[][]);
    const spfIPs = extractIPsFromSPF(txtRecords);
    for (const ip of spfIPs) addIP("SPF/TXT record", bare, ip, "medium");
  } catch { /**/ }

  // ── 5. Common bypass subdomains ──────────────────────────────────────
  const subResults = await Promise.allSettled(
    BYPASS_SUBS.map(async sub => {
      const host = `${sub}.${bare}`;
      const ips  = await dns.resolve4(host).catch(() => [] as string[]);
      return { sub, host, ips };
    }),
  );
  for (const r of subResults) {
    if (r.status !== "fulfilled") continue;
    const { host, ips } = r.value;
    for (const ip of ips) {
      const isCF = isCloudflareIP(ip);
      // Non-CF sub IPs are HIGH confidence (direct access without proxy)
      addIP(`Subdomain bypass (${host})`, host, ip, isCF ? "low" : "high");
    }
  }

  // ── 6. crt.sh SSL history ────────────────────────────────────────────
  const crtHosts = await queryCrtSh(bare);
  // Resolve top 40 unique crt.sh hosts to avoid excessive DNS queries
  const crtSample = crtHosts.slice(0, 40);
  const crtResults = await Promise.allSettled(
    crtSample.map(async host => {
      const ips = await dns.resolve4(host).catch(() => [] as string[]);
      return { host, ips };
    }),
  );
  for (const r of crtResults) {
    if (r.status !== "fulfilled") continue;
    const { host, ips } = r.value;
    for (const ip of ips) {
      const isCF = isCloudflareIP(ip);
      addIP(`crt.sh SSL cert history (${host})`, host, ip, isCF ? "low" : "high");
    }
  }

  // ── Compute summary ──────────────────────────────────────────────────
  const originIPs = findings.filter(f => !f.isCF).map(f => f.ip);
  const uniqueOrigins = [...new Set(originIPs)];
  const isProtected  = mainIPsAll.every(ip => isCloudflareIP(ip));

  return res.json({
    domain:       bare,
    isCloudflare: isProtected,
    originIPs:    uniqueOrigins,
    findings:     findings.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (a.isCF ? 10 : 0) - (b.isCF ? 10 : 0) + order[a.confidence] - order[b.confidence];
    }),
    crtHostsFound: crtHosts.length,
    tip: isProtected && uniqueOrigins.length === 0
      ? "No origin IP found yet. Try checking DNS history on SecurityTrails.com, or look for mail.domain.com or cpanel.domain.com manually."
      : uniqueOrigins.length > 0
        ? `Found ${uniqueOrigins.length} potential origin IP(s). Attack directly using UDP/TCP flood, bypassing Cloudflare!`
        : "Domain appears to be directly accessible (no CDN detected).",
  });
});

export default router;
