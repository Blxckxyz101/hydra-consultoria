import { Router, type IRouter } from "express";
import { CheckSiteBody } from "@workspace/api-zod";
import dns from "node:dns/promises";
import net from "node:net";

const router: IRouter = Router();

router.post("/check", async (req, res): Promise<void> => {
  const parsed = CheckSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { url } = parsed.data;

  // Normalize URL
  let baseUrl = url.trim();
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `http://${baseUrl}`;
  }

  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    hostname = baseUrl;
  }

  // Build probe URLs — try both HTTP and HTTPS to avoid false positives
  // (target might rate-limit our check from the attack IP, so we try multiple paths)
  const probeUrls: string[] = [baseUrl];
  try {
    const u = new URL(baseUrl);
    if (u.protocol === "http:") {
      probeUrls.push(`https://${hostname}`);
    } else {
      probeUrls.push(`http://${hostname}`);
    }
    // Also try root path in case a deep path 404s
    if (u.pathname !== "/") {
      probeUrls.push(`${u.protocol}//${hostname}/`);
    }
  } catch { /**/ }

  const TIMEOUT_MS = 6000;
  const overallStart = Date.now();

  // ── Step 1: DNS resolution check (UDP-based — NOT affected by TCP attack traffic)
  // This is the most reliable signal — if DNS resolves, the domain infrastructure is alive
  let dnsOk = false;
  let dnsMs = 0;
  try {
    const dnsStart = Date.now();
    await dns.resolve4(hostname);
    dnsMs = Date.now() - dnsStart;
    dnsOk = true;
  } catch { /* DNS failed */ }

  // ── Step 2: TCP connect probe (lightweight — just tests if port is ACCEPTING)
  // IMPORTANT: This is a fresh TCP socket separate from attack traffic.
  // A 3-way handshake completion = server is still accepting connections = UP.
  // Connection refused or timeout = server is overwhelmed or down.
  let tcpOk = false;
  let tcpMs = 0;
  let tcpPort = 80;
  // Extract port from URL (use 443 for HTTPS, 80 for HTTP by default)
  try {
    const u = new URL(baseUrl);
    tcpPort = parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80);
  } catch { tcpPort = 80; }
  try {
    const tcpStart = Date.now();
    await new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host: hostname, port: tcpPort });
      const t = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, TIMEOUT_MS);
      sock.once("connect", () => { clearTimeout(t); sock.destroy(); tcpMs = Date.now() - tcpStart; resolve(); });
      sock.once("error",   (e) => { clearTimeout(t); reject(e); });
    });
    tcpOk = true;
  } catch { /* TCP connect failed */ }

  // ── Step 3: HTTP probe (optional — useful for status code, but may be rate-limited)
  let httpStatus = 0;
  let httpStatusText = "";
  let httpMs = 0;
  let httpOk = false;
  try {
    const httpStart = Date.now();
    const response = await fetch(probeUrls[0], {
      method: "HEAD",  // HEAD is lighter — no body, less chance of being rate-limited
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; UptimeMonitor/1.0)",
        "Accept": "*/*",
        "Cache-Control": "no-cache",
      },
    });
    httpMs = Date.now() - httpStart;
    httpStatus = response.status;
    httpStatusText = response.statusText || statusLabel(response.status);
    // 429 = rate limited but server IS up; anything < 500 = up
    httpOk = httpStatus > 0 && httpStatus < 500;
  } catch { /* HTTP probe failed */ }

  const totalTime = Date.now() - overallStart;

  // ── Verdict: UP if TCP connects OR DNS resolves (DNS failure = infra problem)
  // HTTP failure alone is NOT enough to declare down (we may be rate-limited)
  // This prevents false positives when our attack saturates our own TCP stack
  const isUp = tcpOk || httpOk || (dnsOk && tcpOk);

  // Best response time: prefer TCP (doesn't go through rate limiter)
  const bestTime = tcpOk ? tcpMs : httpOk ? httpMs : totalTime;
  const bestStatus = httpStatus || (tcpOk ? 200 : 0);
  const bestStatusText = httpStatus > 0 ? httpStatusText : (tcpOk ? "TCP Connected" : "Unreachable");

  res.json({
    up: isUp,
    status: bestStatus,
    statusText: bestStatusText,
    responseTime: bestTime,
    dnsOk,
    tcpOk,
    httpOk,
    error: isUp ? null : "TCP connect failed — server not accepting connections on port " + tcpPort,
  });
});

function statusLabel(code: number): string {
  const labels: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    206: "Partial Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return labels[code] ?? "Unknown";
}

export default router;
