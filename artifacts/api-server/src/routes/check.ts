import { Router, type IRouter } from "express";
import { CheckSiteBody } from "@workspace/api-zod";

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

  const TIMEOUT_MS = 8000;
  const overallStart = Date.now();

  // Try each probe URL — declare UP if ANY succeeds
  // This prevents false "down" from a single rate-limited or slow probe
  const results = await Promise.allSettled(
    probeUrls.map(async (probeUrl) => {
      const start = Date.now();
      const response = await fetch(probeUrl, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: {
          // Use a neutral UA so the target doesn't block the check
          "User-Agent": "Mozilla/5.0 (compatible; UptimeMonitor/1.0)",
          "Accept": "text/html,*/*",
          "Cache-Control": "no-cache",
        },
      });
      return { status: response.status, statusText: response.statusText || statusLabel(response.status), timeMs: Date.now() - start };
    })
  );

  const totalTime = Date.now() - overallStart;

  // Find the best result (prefer a successful one)
  let bestStatus = 0;
  let bestStatusText = "Connection Failed";
  let bestTime = totalTime;
  let isUp = false;

  for (const r of results) {
    if (r.status === "fulfilled") {
      const { status, statusText, timeMs } = r.value;
      // Consider "up" if any response comes back with status < 500
      // (even 429 Too Many Requests means the server IS responding — it's up)
      // Only truly "down" if status === 0 (connection refused / timeout)
      if (status > 0) {
        isUp = true;
        bestStatus = status;
        bestStatusText = statusText;
        bestTime = timeMs;
        if (status < 400) break; // prefer a successful response — stop early
      }
    }
  }

  // If all probes failed (status 0), it might just be that we're rate-limited.
  // Mark as "uncertain" by using 0 status — the frontend will decide after N consecutive failures.
  res.json({
    up: isUp,
    status: bestStatus,
    statusText: bestStatusText,
    responseTime: bestTime,
    error: isUp ? null : "All probes failed — target unreachable or rate-limiting checker IP",
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
