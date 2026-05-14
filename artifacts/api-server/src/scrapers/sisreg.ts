/**
 * SISREG-III SCRAPER
 *
 * Authentication:
 *   POST /cgi-bin/index
 *   Fields: acao=autenticar, usuario=ESLI, senha=, senha_256=<sha256(pass.toUpperCase())>, etapa=ACESSO
 *   → returns HTTP 302 with Set-Cookie (session ID) — undici.request() with maxRedirections:0 is required
 *     to capture the session cookie before the redirect is followed.
 *
 * CNS / CPF lookup (Consultas Gerais → CNS):
 *   POST /cgi-bin/cadweb50?standalone=1
 *   Fields: nu_cns=<cpf_11_digits_or_cns_15_digits>, etapa=DETALHAR
 *   → NOTE: SISREG delegates this to CadSUS (external system). Returns CadSUS redirect page.
 *
 * Proxy strategy:
 *   - Brazilian free proxies from proxyscrape (ephemeral, ~3/20 alive at any time)
 *   - Authenticated Webshare residential proxies from proxy-config.json
 *   - Attempts are SEQUENTIAL (one at a time) because SISREG only allows one active session
 *     per account — concurrent logins kill each other's sessions.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Dispatcher, ProxyAgent, request as undiciRequest } from "undici";
import { logger } from "../lib/logger.js";

const SISREG_BASE = "https://sisregiii.saude.gov.br";
const SISREG_CGI  = `${SISREG_BASE}/cgi-bin/index`;
const SISREG_CNS  = `${SISREG_BASE}/cgi-bin/cadweb50?standalone=1`;

const ACCOUNT = { usuario: "ESLI", senha: "10203040" };
const SENHA_256 = createHash("sha256").update(ACCOUNT.senha.toUpperCase()).digest("hex");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Proxy management ──────────────────────────────────────────────────────────

interface ProxyEntry { addr: string; failCount: number; lastCheck: number }
const _proxyPool: ProxyEntry[] = [];
let _poolFetchedAt = 0;

function makeProxyAgent(proxyUrl: string): ProxyAgent {
  // connectTimeout covers the CONNECT tunnel handshake (before the HTTP request).
  // Keeping it short (3s) ensures stalling proxies are abandoned quickly.
  return new ProxyAgent({ uri: proxyUrl, connectTimeout: 3_000 });
}

async function refreshBrProxies(forceRefresh = false): Promise<void> {
  const stale = Date.now() - _poolFetchedAt > 90_000;
  if (!forceRefresh && !stale && _proxyPool.length > 0) return;
  try {
    const sources = [
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=15000&country=BR&ssl=all&anonymity=all",
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=15000&country=BR&ssl=all&anonymity=elite",
    ];
    const results = await Promise.allSettled(
      sources.map(url => fetch(url, { signal: AbortSignal.timeout(8_000) }).then(r => r.text()))
    );
    const lines = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        r.value.trim().split(/\r?\n/).filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l)).forEach(l => lines.add(l));
      }
    }
    _proxyPool.length = 0;
    for (const addr of [...lines].slice(0, 50)) {
      _proxyPool.push({ addr, failCount: 0, lastCheck: 0 });
    }
    _poolFetchedAt = Date.now();
    logger.info({ count: _proxyPool.length }, "[SISREG] Refreshed BR proxy pool");
  } catch (err) {
    logger.warn({ err }, "[SISREG] Failed to refresh BR proxy pool");
  }
}

const PROXY_CONFIG_FILE = path.join(process.cwd(), "data", "proxy-config.json");

function resolveSentinel(pass: string | undefined): string | undefined {
  if (!pass) return pass;
  const m = /^__env:([A-Z0-9_]+)__$/.exec(pass);
  return m ? (process.env[m[1]] ?? pass) : pass;
}

function residentialDispatchers(): ProxyAgent[] {
  try {
    const raw = fs.readFileSync(PROXY_CONFIG_FILE, "utf8");
    const cfg = JSON.parse(raw) as {
      pinnedList?: Array<{ host: string; port: number; username?: string; password?: string }>;
      residential?: { host: string; port: number; username: string; password: string; count: number };
    };
    const entries: Array<{ host: string; port: number; user?: string; pass?: string }> = [];
    if (cfg.pinnedList?.length) {
      for (const p of cfg.pinnedList) {
        entries.push({ host: p.host, port: p.port, user: p.username, pass: resolveSentinel(p.password) });
      }
    } else if (cfg.residential) {
      const r = cfg.residential;
      const pass = resolveSentinel(r.password);
      for (let i = 0; i < Math.min(r.count, 9); i++) {
        entries.push({ host: r.host, port: r.port, user: r.username, pass });
      }
    }
    const agents = entries
      .filter(e => e.user && e.pass)
      .map(e => makeProxyAgent(`http://${encodeURIComponent(e.user!)}:${encodeURIComponent(e.pass!)}@${e.host}:${e.port}`));
    if (agents.length > 0) return agents;
  } catch { /* config not yet written */ }

  const list = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return [];
  return list.split(",").map(a => a.trim()).filter(Boolean).slice(0, 9).map(addr =>
    makeProxyAgent(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${addr}`)
  );
}

/**
 * Candidates: up to 12 free BR proxies (shuffled to avoid positional bias),
 * then undefined (direct connection).
 * Residential (Webshare) proxies excluded — always fail with 407 for HTTPS CONNECT.
 * Sequential attempts — no concurrent logins.
 */
async function buildCandidates(): Promise<Array<Dispatcher | undefined>> {
  await refreshBrProxies();
  const eligible = _proxyPool.filter(p => p.failCount < 3);
  // Shuffle so working proxies aren't systematically at the tail of the list
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
  }
  const br = eligible.slice(0, 14).map(p => makeProxyAgent(`http://${p.addr}`));
  return [...br, undefined];
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function extractCookies(headers: Record<string, string | string[] | undefined>): Map<string, string> {
  const jar = new Map<string, string>();
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? [raw] : []);
  for (const c of list) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) jar.set(m[1].trim(), m[2].trim());
  }
  return jar;
}

function cookieStr(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── Atomic login + query pipeline ─────────────────────────────────────────────

/**
 * Login + query atomically through the same dispatcher.
 * Uses undici.request() with maxRedirections: 0 on login to capture the
 * 302 Set-Cookie session cookies before the redirect is followed.
 */
async function tryLoginThenQuery(
  dispatcher: Dispatcher | undefined,
  idx: number,
  queryUrl: string,
  queryBody: URLSearchParams
): Promise<string> {
  const loginBody = new URLSearchParams({
    acao:      "autenticar",
    usuario:   ACCOUNT.usuario,
    senha:     "",
    senha_256: SENHA_256,
    etapa:     "ACESSO",
  });

  const commonHeaders = {
    "user-agent":   UA,
    "content-type": "application/x-www-form-urlencoded",
    referer:        SISREG_CGI,
    origin:         SISREG_BASE,
  };
  const dispatcherOpt = dispatcher ? { dispatcher } : {};

  // Step 1 — login (independent 5s signal)
  // undici.request() does NOT follow redirects by default (unlike fetch).
  // The SISREG login returns HTTP 302 with Set-Cookie — we capture those headers directly.
  const loginResp = await undiciRequest(SISREG_CGI, {
    ...dispatcherOpt,
    method: "POST",
    headers: commonHeaders,
    body: loginBody.toString(),
    signal: AbortSignal.timeout(5_000),
  });

  // Consume body to release connection
  await loginResp.body.dump();

  const jar = extractCookies(loginResp.headers as Record<string, string | string[]>);

  // A real SISREG login returns 302 with session cookies
  if (loginResp.statusCode !== 302) {
    throw new Error(`login-not-302[${idx}]: status=${loginResp.statusCode}`);
  }
  if (jar.size === 0) {
    throw new Error(`login-no-cookies[${idx}]`);
  }

  // Step 2 — query immediately (fresh independent 10s signal — session still alive)
  const qResp = await undiciRequest(queryUrl, {
    ...dispatcherOpt,
    method: "POST",
    headers: { ...commonHeaders, cookie: cookieStr(jar) },
    body: queryBody.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  const html = await qResp.body.text();
  if (!html || html.length < 50) throw new Error(`empty-response[${idx}]`);
  return html;
}

/** Pre-warm is a no-op — SISREG sessions expire in ~30s, pre-warming is counterproductive. */
export function prewarmSisregSession(): void { /* no-op */ }

// ── HTML parsing ──────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã").replace(/&otilde;/gi, "õ").replace(/&eacute;/gi, "é")
    .replace(/\s+/g, " ").trim();
}

function parseTableRows(html: string): string[] {
  const results: string[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  let headers: string[] = [];
  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => stripTags(c[1])).filter(Boolean);
    if (!cells.length) continue;
    if (!headers.length) { headers = cells; }
    else { results.push(cells.map((v, i) => `${headers[i] ?? `col${i}`}: ${v}`).join("\n")); }
  }
  return results;
}

function parseCadwebDetail(html: string): string[] {
  const fields: string[] = [];
  const labelRe = /<(?:td|th|label|b|strong)[^>]*>\s*([^<]{2,40}?)\s*[:<]\s*<\/(?:td|th|label|b|strong)>\s*<(?:td|th|span)[^>]*>\s*([^<]{1,200}?)\s*</gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(html)) !== null) {
    const k = stripTags(m[1]).replace(/:$/, "").trim();
    const v = stripTags(m[2]).trim();
    if (k && v && k.length < 40) fields.push(`${k}: ${v}`);
  }
  if (fields.length === 0) return parseTableRows(html);
  return fields;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SisregResult { success: boolean; data?: string; error?: string }

function parseQueryHtml(html: string, isFromCadweb: boolean): SisregResult {
  if (
    html.toLowerCase().includes("sessão expirada") ||
    html.toLowerCase().includes("não autenticado") ||
    html.toLowerCase().includes("sessão deste operador") ||
    html.toLowerCase().includes("finalizada pelo servidor") ||
    html.includes("formLogin")
  ) {
    return { success: false, error: "Sessão SISREG expirada durante a consulta — tente novamente." };
  }

  if (html.includes("Request Rejected") || html.toLowerCase().includes("acesso negado")) {
    return { success: false, error: "SISREG bloqueou a requisição (WAF). Tente novamente em instantes." };
  }

  if (
    html.includes("cadastro.saude.gov.br") ||
    html.includes("cadwebConsulta") ||
    html.toLowerCase().includes("url de redirecionamento") ||
    html.includes("CADSUS") ||
    html.includes("Cadastro do Sistema")
  ) {
    return {
      success: false,
      error:
        "SISREG-III não armazena dados demográficos (nome/endereço/nascimento). " +
        "A consulta de CNS/CPF é redirecionada ao sistema CadSUS externo, que exige autenticação própria. " +
        "Use as bases Hydra (CPF/Nome) para dados cadastrais.",
    };
  }

  const rows = isFromCadweb ? parseCadwebDetail(html) : parseTableRows(html);

  if (!rows.length) {
    const stripped = stripTags(html);
    logger.warn({ preview: stripped.slice(0, 400), htmlLen: html.length }, "[SISREG] Parser found no rows — HTML preview");
    if (stripped.toLowerCase().includes("nenhum") || stripped.toLowerCase().includes("não encontrado")) {
      return { success: false, error: "Nenhum registro encontrado no SISREG-III para este dado." };
    }
    return { success: false, error: "SISREG-III não retornou dados para este paciente." };
  }

  return { success: true, data: rows.join("\n\n─────────────────────\n\n") };
}

// 17s per candidate safety net: 5s login + 10s query + 2s overhead.
// Individual AbortSignal timeouts (5s/10s) are the primary timeouts per step.
// Dead proxies fail in < 5s (ECONNREFUSED < 200ms, timeout at exactly 5s).
const PER_CANDIDATE_TIMEOUT_MS = 17_000;

async function trySequential(
  candidates: Array<Dispatcher | undefined>,
  queryUrl: string,
  queryBody: URLSearchParams
): Promise<string | null> {
  for (let i = 0; i < candidates.length; i++) {
    try {
      const html = await Promise.race([
        tryLoginThenQuery(candidates[i], i, queryUrl, queryBody),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout[${i}]`)), PER_CANDIDATE_TIMEOUT_MS)
        ),
      ]);
      logger.info({ idx: i, total: candidates.length }, "[SISREG] login+query succeeded");
      return html;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.info({ idx: i, err: msg }, "[SISREG] candidate failed, trying next");
    }
  }
  return null;
}

export async function sisregSearch(
  tipo: "cpf" | "nome" | "cns",
  dados: string
): Promise<SisregResult> {
  const queryUrl = (tipo === "cns" || tipo === "cpf") ? SISREG_CNS : SISREG_CGI;
  const queryBody = (tipo === "cns" || tipo === "cpf")
    ? new URLSearchParams({ nu_cns: dados, etapa: "DETALHAR" })
    : new URLSearchParams({ acao: "pesquisa", criterio: "nome", nome: dados });
  const isCadweb = queryUrl.includes("cadweb50");

  await refreshBrProxies();
  const candidates = await buildCandidates();

  let html = await trySequential(candidates, queryUrl, queryBody);

  if (!html) {
    logger.info("[SISREG] All candidates failed — retrying with fresh proxy batch");
    await refreshBrProxies(true);
    const fresh = await buildCandidates();
    html = await trySequential(fresh, queryUrl, queryBody);
  }

  if (!html) {
    logger.warn("[SISREG] All sequential login+query attempts exhausted");
    return { success: false, error: "SISREG-III indisponível no momento. Tente novamente em instantes." };
  }

  try {
    return parseQueryHtml(html, isCadweb);
  } catch (err) {
    logger.error({ err }, "[SISREG] Parse error");
    return { success: false, error: "Erro ao processar resposta do SISREG-III." };
  }
}
