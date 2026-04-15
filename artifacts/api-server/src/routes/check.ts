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
    baseUrl = `https://${baseUrl}`;
  }

  let hostname = "";
  let parsedProto = "https:";
  try {
    const u = new URL(baseUrl);
    hostname = u.hostname;
    parsedProto = u.protocol;
  } catch {
    hostname = baseUrl;
  }

  // Build multiple probe URLs to maximize chances of a real response
  const probeUrls: string[] = [];
  try {
    const u = new URL(baseUrl);
    // Primary: as-given
    probeUrls.push(baseUrl);
    // HTTPS root
    probeUrls.push(`https://${hostname}/`);
    // HTTP root fallback
    probeUrls.push(`http://${hostname}/`);
    // If path is not root, also try root explicitly
    if (u.pathname !== "/" && u.pathname !== "") {
      probeUrls.push(`${u.protocol}//${hostname}/`);
    }
  } catch {
    probeUrls.push(baseUrl);
  }
  // De-duplicate
  const uniqueProbeUrls = [...new Set(probeUrls)];

  const TIMEOUT_MS = 8000;
  const TCP_TIMEOUT_MS = 5000;
  const overallStart = Date.now();

  // ── Step 1: DNS resolution check (UDP-based — NOT affected by TCP attack traffic)
  let dnsOk = false;
  let dnsMs = 0;
  let dnsAddresses: string[] = [];
  try {
    const dnsStart = Date.now();
    // Try IPv4 first, fall back to any record type
    try {
      dnsAddresses = await dns.resolve4(hostname);
    } catch {
      const records = await dns.resolve(hostname);
      dnsAddresses = Array.isArray(records) ? records.map(String) : [];
    }
    dnsMs = Date.now() - dnsStart;
    dnsOk = dnsAddresses.length > 0;
  } catch { /* DNS failed */ }

  // ── Step 2: TCP connect probes — try BOTH port 443 and 80 for maximum accuracy
  let tcpOk = false;
  let tcpMs = 0;

  const tcpPorts: number[] = [];
  try {
    const u = new URL(baseUrl);
    const explicitPort = parseInt(u.port, 10);
    if (!isNaN(explicitPort) && explicitPort > 0) {
      tcpPorts.push(explicitPort);
    }
  } catch { /**/ }
  // Always try 443 first then 80 (most modern sites use HTTPS)
  if (!tcpPorts.includes(443)) tcpPorts.push(443);
  if (!tcpPorts.includes(80)) tcpPorts.push(80);

  async function tryTcp(host: string, port: number, timeoutMs: number): Promise<number | false> {
    return new Promise((resolve) => {
      const start = Date.now();
      const sock = net.createConnection({ host, port });
      const t = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
      sock.once("connect", () => { clearTimeout(t); sock.destroy(); resolve(Date.now() - start); });
      sock.once("error", () => { clearTimeout(t); resolve(false); });
    });
  }

  for (const port of tcpPorts) {
    const result = await tryTcp(hostname, port, TCP_TIMEOUT_MS);
    if (result !== false) {
      tcpOk = true;
      tcpMs = result;
      break;
    }
  }

  // ── Step 3: HTTP probe — try multiple URLs and methods (HEAD then GET fallback)
  let httpStatus = 0;
  let httpStatusText = "";
  let httpMs = 0;
  let httpOk = false;
  let anyHttpResponse = false; // Even 5xx = server is alive

  async function tryHttp(probeUrl: string, method: "HEAD" | "GET"): Promise<{ status: number; statusText: string; ms: number } | null> {
    try {
      const start = Date.now();
      const response = await fetch(probeUrl, {
        method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });
      return {
        status: response.status,
        statusText: response.statusText || statusLabel(response.status),
        ms: Date.now() - start,
      };
    } catch {
      return null;
    }
  }

  // Try each probe URL until we get a response
  for (const probeUrl of uniqueProbeUrls) {
    // Try HEAD first
    let result = await tryHttp(probeUrl, "HEAD");

    // If HEAD fails (network error or no response), try GET — some servers block HEAD
    if (!result) {
      result = await tryHttp(probeUrl, "GET");
    }

    if (result) {
      anyHttpResponse = true;
      httpStatus = result.status;
      httpStatusText = result.statusText;
      httpMs = result.ms;
      // Any response below 500 = clearly UP; 5xx = server is alive but having issues
      httpOk = result.status > 0 && result.status < 500;

      // If we got a good response, stop trying
      if (httpOk) break;
      // If we got a 5xx, keep trying other URLs but remember we got a response
    }
  }

  const totalTime = Date.now() - overallStart;

  // ── Verdict: comprehensive logic to minimize false negatives
  //
  // A site is UP if ANY of these are true:
  //   1. HTTP responds with < 500 (clear UP signal)
  //   2. TCP handshake succeeded (port is open, server accepting connections)
  //   3. DNS resolves + ANY HTTP response (even 5xx = server is responding, just overwhelmed)
  //   4. DNS resolves + TCP connects (infra is intact)
  //
  // A site is DOWN only if ALL probes fail:
  //   - DNS fails (domain doesn't exist)
  //   - TCP fails on all ports
  //   - No HTTP response at all
  const isUp =
    httpOk ||
    tcpOk ||
    (dnsOk && anyHttpResponse) ||
    (dnsOk && tcpOk);

  // Best response time
  const bestTime = httpOk ? httpMs : tcpOk ? tcpMs : httpMs || tcpMs || totalTime;
  const bestStatus = httpStatus || (tcpOk ? 200 : 0);
  const bestStatusText = httpStatus > 0 ? httpStatusText : tcpOk ? "TCP Connected" : "Unreachable";

  // Build descriptive error if down
  let errorMsg: string | null = null;
  if (!isUp) {
    if (!dnsOk) {
      errorMsg = `DNS resolution failed — domain "${hostname}" not found`;
    } else if (!tcpOk && !anyHttpResponse) {
      errorMsg = `Server not responding — TCP connect failed on ports ${tcpPorts.join(", ")} and no HTTP response`;
    } else {
      errorMsg = "Server appears to be down — all probes failed";
    }
  }

  res.json({
    up: isUp,
    status: bestStatus,
    statusText: bestStatusText,
    responseTime: bestTime,
    dnsOk,
    tcpOk,
    httpOk,
    anyHttpResponse,
    error: errorMsg,
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
