/**
 * DNS RECON ROUTE — /api/dns/recon
 *
 * Full DNS intelligence sweep for a target domain:
 *   - All record types: A, AAAA, MX, TXT, NS, SOA, CAA, DNSKEY, DS
 *   - All NS server IPs (multi-A per NS)
 *   - AXFR zone transfer attempt on each NS
 *   - DNSSEC status detection
 *   - CDN/hosting provider fingerprint from IP ranges
 *   - Reverse DNS on discovered IPs
 *   - Common subdomain enumeration
 */
import { Router, type IRouter } from "express";
import dns from "node:dns/promises";
import net from "node:net";

const router: IRouter = Router();

// ── CDN/Provider fingerprinting by CIDR ──────────────────────────────────────
const CDN_RANGES: Array<{ name: string; cidrs: string[] }> = [
  { name: "Cloudflare",    cidrs: ["103.21.244.0/22","103.22.200.0/22","103.31.4.0/22","104.16.0.0/13","104.24.0.0/14","108.162.192.0/18","131.0.72.0/22","141.101.64.0/18","162.158.0.0/15","172.64.0.0/13","173.245.48.0/20","188.114.96.0/20","190.93.240.0/20","197.234.240.0/22","198.41.128.0/17"] },
  { name: "Vercel",        cidrs: ["76.76.21.0/24","76.76.16.0/20","76.223.0.0/16","216.198.0.0/15","64.29.0.0/16","64.248.0.0/16","216.239.32.0/22"] },
  { name: "AWS CloudFront",cidrs: ["13.32.0.0/15","52.84.0.0/14","54.182.0.0/15","54.192.0.0/14","99.84.0.0/16","205.251.192.0/19"] },
  { name: "Fastly",        cidrs: ["23.235.32.0/20","43.249.72.0/22","103.244.50.0/24","103.245.222.0/23","151.101.0.0/16","157.52.64.0/18","185.31.16.0/22","199.27.72.0/21"] },
  { name: "Akamai",        cidrs: ["23.32.0.0/11","23.64.0.0/14","96.16.0.0/15","184.24.0.0/13","2.16.0.0/13"] },
  { name: "Google Cloud",  cidrs: ["34.0.0.0/9","34.128.0.0/10","35.184.0.0/13","35.192.0.0/12","35.208.0.0/12","35.224.0.0/12"] },
  { name: "DigitalOcean",  cidrs: ["134.122.0.0/15","137.184.0.0/16","143.198.0.0/16","157.245.0.0/16","164.90.0.0/15","165.22.0.0/15","167.71.0.0/16","167.99.0.0/16","174.138.0.0/15","178.62.0.0/15","188.166.0.0/15","198.211.96.0/19","206.189.0.0/16","209.97.128.0/17"] },
  { name: "Hetzner",       cidrs: ["5.9.0.0/16","23.88.0.0/17","49.12.0.0/16","65.21.0.0/16","78.46.0.0/15","88.198.0.0/16","95.216.0.0/16","116.203.0.0/16","128.140.0.0/17","135.181.0.0/16","136.243.0.0/16","157.90.0.0/16","159.69.0.0/16","167.235.0.0/16","168.119.0.0/16","176.9.0.0/16","178.63.0.0/16","195.201.0.0/16","213.239.192.0/18"] },
];

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  try {
    const [base, bits] = cidr.split("/");
    const mask = bits ? ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0 : 0xffffffff;
    return (ipToLong(base) & mask) === (ipToLong(ip) & mask);
  } catch { return false; }
}

function detectProvider(ip: string): string {
  if (!net.isIPv4(ip)) return "Unknown";
  for (const { name, cidrs } of CDN_RANGES) {
    if (cidrs.some(c => cidrContains(c, ip))) return name;
  }
  return "Unknown / Direct";
}

// ── AXFR zone transfer via raw TCP ──────────────────────────────────────────
// DNS AXFR = type 252; uses TCP (not UDP). Returns list of records or error.
async function attemptAXFR(nsIP: string, domain: string): Promise<string[]> {
  return new Promise((resolve) => {
    const results: string[] = [];
    const timeout = setTimeout(() => { socket.destroy(); resolve(results); }, 4000);
    const socket = net.createConnection(53, nsIP);

    socket.on("error", () => { clearTimeout(timeout); resolve(results); });
    socket.on("timeout", () => { socket.destroy(); clearTimeout(timeout); resolve(results); });
    socket.setTimeout(4000);

    socket.on("connect", () => {
      // Build AXFR query packet (TCP DNS: 2-byte length prefix)
      const labels = domain.split(".");
      const nameParts = labels.map(l => {
        const b = Buffer.allocUnsafe(1 + l.length);
        b[0] = l.length; b.write(l, 1, "ascii"); return b;
      });
      const nameBytes = Buffer.concat([...nameParts, Buffer.from([0x00])]);
      const hdr = Buffer.allocUnsafe(12);
      hdr.writeUInt16BE(0x1234, 0); // TX ID
      hdr.writeUInt16BE(0x0100, 2); // RD=1
      hdr.writeUInt16BE(1, 4);      // QDCOUNT
      hdr.fill(0, 6);
      const qHdr = Buffer.allocUnsafe(4);
      qHdr.writeUInt16BE(252, 0);   // QTYPE: AXFR
      qHdr.writeUInt16BE(1, 2);     // QCLASS: IN
      const pkt = Buffer.concat([hdr, nameBytes, qHdr]);
      const lenPrefix = Buffer.allocUnsafe(2);
      lenPrefix.writeUInt16BE(pkt.length, 0);
      socket.write(Buffer.concat([lenPrefix, pkt]));
    });

    socket.on("data", (chunk) => {
      // Parse minimal response — check ANCOUNT > 0 (zone transfer allowed)
      if (chunk.length > 5 && chunk.readUInt16BE(4) > 0) {
        results.push("Zone transfer ALLOWED — AXFR succeeded!");
      } else {
        results.push("AXFR refused (RCODE=5) or empty zone");
      }
      socket.destroy();
      clearTimeout(timeout);
      resolve(results);
    });
  });
}

// ── Common subdomains to probe ───────────────────────────────────────────────
const COMMON_SUBS = [
  "www","mail","smtp","pop","imap","webmail","cpanel","whm","ftp",
  "admin","api","dev","staging","test","beta","app","portal",
  "blog","shop","store","cdn","media","static","assets","img",
  "vpn","remote","ns1","ns2","mx","mx1","mx2","smtp2",
  "direct","origin","backend","internal","intranet","secure","ssl",
  "dashboard","panel","control","manage","login","auth","sso",
];

// ── Route ────────────────────────────────────────────────────────────────────
router.get("/dns/recon", async (req, res) => {
  const domain = (req.query.domain as string ?? "").trim().replace(/^https?:\/\//, "").split("/")[0];
  if (!domain || domain.length < 3) {
    return res.status(400).json({ error: "domain query param required" });
  }

  // Helper to safe-resolve
  const safeResolve = async (type: string): Promise<string[]> => {
    try {
      const r = await dns.resolve(domain, type as "A");
      return Array.isArray(r) ? r.map(v => typeof v === "string" ? v : JSON.stringify(v)) : [];
    } catch { return []; }
  };

  // 1. Resolve all record types in parallel
  const [aRecs, aaaaRecs, mxRecs, txtRecs, nsRecs, soaRecs, caaRecs, dnskeyRecs, dsRecs] =
    await Promise.all([
      safeResolve("A"),
      safeResolve("AAAA"),
      dns.resolveMx(domain).then(r => r.map(m => `${m.priority} ${m.exchange}`)).catch(() => [] as string[]),
      dns.resolveTxt(domain).then(r => r.map(t => t.join("")).map(t => t.slice(0, 120))).catch(() => [] as string[]),
      safeResolve("NS"),
      dns.resolveSoa(domain)
        .then(s => [`mname=${s.nsname} rname=${s.hostmaster} serial=${s.serial} ttl=${s.minttl}`])
        .catch(() => [] as string[]),
      safeResolve("CAA"),
      safeResolve("DNSKEY"),
      safeResolve("DS"),
    ]);

  // 2. Resolve ALL IPs for ALL NS servers
  const nsDetails: Array<{ name: string; ips: string[]; providers: string[] }> = [];
  for (const ns of nsRecs) {
    const ips = await dns.resolve4(ns).catch(() => [] as string[]);
    nsDetails.push({
      name: ns,
      ips,
      providers: ips.map(detectProvider),
    });
  }

  // 3. Provider detection for A records
  const aProviders = aRecs.map(ip => ({ ip, provider: detectProvider(ip) }));

  // 4. Reverse DNS on A records
  const reverseDNS: Record<string, string> = {};
  await Promise.all(
    aRecs.slice(0, 8).map(ip =>
      dns.reverse(ip)
        .then(names => { reverseDNS[ip] = names[0] ?? ""; })
        .catch(() => { reverseDNS[ip] = ""; })
    )
  );

  // 5. AXFR attempt on each NS server
  const axfrResults: Array<{ ns: string; result: string }> = [];
  for (const ns of nsDetails.slice(0, 4)) {
    for (const ip of ns.ips.slice(0, 2)) {
      const results = await attemptAXFR(ip, domain);
      axfrResults.push({ ns: `${ns.name} (${ip})`, result: results[0] ?? "No response" });
    }
  }

  // 6. DNSSEC status
  const dnssecEnabled = dnskeyRecs.length > 0 || dsRecs.length > 0;
  const dnssecStatus  = dnssecEnabled
    ? `Enabled — DNSKEY: ${dnskeyRecs.length} records, DS: ${dsRecs.length} records`
    : "Not detected (no DNSKEY/DS records)";

  // 7. Wildcard DNS detection — probe a random non-existent subdomain first
  // If it resolves, the domain uses wildcard DNS (e.g. *.vercel.app).
  // We filter out any subdomain that resolves to the same IPs as the wildcard.
  const wildcardLabel = `__wc-probe-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const wildcardIPs   = new Set(
    await dns.resolve4(`${wildcardLabel}.${domain}`).catch(() => [] as string[])
  );
  const isWildcard = wildcardIPs.size > 0;

  // 8. Common subdomain enumeration (parallel, 8 at a time)
  const subdomainHits: string[] = [];
  if (isWildcard) {
    subdomainHits.push(`[WILDCARD DETECTED] All *.${domain} → ${[...wildcardIPs].join(", ")} — subdomain enumeration skipped (all would match)`);
  } else {
    const chunks: string[][] = [];
    for (let i = 0; i < COMMON_SUBS.length; i += 8) chunks.push(COMMON_SUBS.slice(i, i + 8));
    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map(async sub => {
          const fqdn = `${sub}.${domain}`;
          const ips = await dns.resolve4(fqdn).catch(() => null);
          if (!ips) return null;
          // Filter out wildcard matches (IPs identical to wildcard)
          const nonWild = ips.filter(ip => !wildcardIPs.has(ip));
          if (nonWild.length === 0 && ips.every(ip => wildcardIPs.has(ip))) return null;
          return { fqdn, ips };
        })
      );
      for (const r of results) {
        if (r) subdomainHits.push(`${r.fqdn} → ${r.ips.join(", ")} [${detectProvider(r.ips[0])}]`);
      }
    }
  }

  // 8. SPF, DMARC, DKIM detection from TXT records
  const spf   = txtRecs.filter(t => t.startsWith("v=spf1"));
  const dmarc = await dns.resolveTxt(`_dmarc.${domain}`).then(r => r.map(t => t.join(""))).catch(() => [] as string[]);
  const dkim  = await dns.resolve4(`default._domainkey.${domain}`).then(() => ["DKIM found at default._domainkey"]).catch(() => [] as string[]);

  return res.json({
    domain,
    resolvedAt: new Date().toISOString(),
    records: {
      A:      aRecs,
      AAAA:   aaaaRecs,
      MX:     mxRecs,
      TXT:    txtRecs,
      NS:     nsRecs,
      SOA:    soaRecs,
      CAA:    caaRecs,
    },
    nsDetails,
    ipProviders: aProviders,
    reverseDNS,
    dnssec: {
      status: dnssecStatus,
      enabled: dnssecEnabled,
    },
    emailSecurity: {
      spf:   spf.length > 0 ? spf : ["Not configured"],
      dmarc: dmarc.length > 0 ? dmarc : ["Not configured"],
      dkim:  dkim.length > 0 ? dkim : ["Not detected (checked default selector)"],
    },
    axfr: axfrResults,
    subdomains: subdomainHits,
    summary: {
      totalIPs:        aRecs.length + aaaaRecs.length,
      nsCount:         nsRecs.length,
      subdomainsFound: subdomainHits.length,
      axfrVulnerable:  axfrResults.some(r => r.result.includes("ALLOWED")),
      dnssecEnabled,
      cdnDetected:     aProviders.some(p => p.provider !== "Unknown / Direct"),
      providers:       [...new Set(aProviders.map(p => p.provider))],
    },
  });
});

export default router;
