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

  let normalizedUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    normalizedUrl = `http://${url}`;
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(normalizedUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeoutId);

    const responseTime = Date.now() - start;

    res.json({
      up: response.status < 500,
      status: response.status,
      statusText: response.statusText || statusLabel(response.status),
      responseTime,
      error: null,
    });
  } catch (err: unknown) {
    const responseTime = Date.now() - start;
    const message = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = message.includes("abort") || message.includes("timeout");

    res.json({
      up: false,
      status: 0,
      statusText: isTimeout ? "Request Timeout" : "Connection Failed",
      responseTime,
      error: message,
    });
  }
});

function statusLabel(code: number): string {
  const labels: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
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
