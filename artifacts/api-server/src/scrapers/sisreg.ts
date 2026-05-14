/**
 * SISREG-III SCRAPER
 *
 * Authentication:
 *   POST /cgi-bin/index
 *   Fields: acao=autenticar, usuario=ESLI, senha=, senha_256=<sha256(pass.toUpperCase())>, etapa=ACESSO
 *
 * CNS / CPF lookup (Consultas Gerais → CNS):
 *   POST /cgi-bin/cadweb50?standalone=1
 *   Fields: nu_cns=<cpf_11_digits_or_cns_15_digits>, etapa=DETALHAR
 *
 * CPF / Nome general search:
 *   POST /cgi-bin/index
 *   Fields: acao=pesquisa, criterio=<cpf|nome>, <field>=<value>
 *
 * Proxy strategy: try Brazilian public proxies first (fetched from proxyscrape),
 * then Webshare pool, then direct. Rotates per session.
 */
import { createHash } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logger } from "../lib/logger.js";

const SISREG_BASE    = "https://sisregiii.saude.gov.br";
const SISREG_CGI     = `${SISREG_BASE}/cgi-bin/index`;
const SISREG_CNS     = `${SISREG_BASE}/cgi-bin/cadweb50?standalone=1`;

const ACCOUNT = { usuario: "ESLI", senha: "10203040" };
// SHA-256 of senha.toUpperCase() — computed once
const SENHA_256 = createHash("sha256").update(ACCOUNT.senha.toUpperCase()).digest("hex");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Proxy management ──────────────────────────────────────────────────────────

type FetchFn = (url: string, opts: RequestInit) => Promise<Response>;

interface ProxyEntry { addr: string; failCount: number; lastCheck: number }
const _proxyPool: ProxyEntry[] = [];
let _poolFetchedAt = 0;

/** Build a FetchFn that routes through an HTTP proxy. */
function proxyFetch(proxyUrl: string): FetchFn {
  const dispatcher = new ProxyAgent({ uri: proxyUrl, connectTimeout: 6_000 });
  return (url, opts) =>
    undiciFetch(url, { ...opts, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

/** Fetch fresh Brazilian free proxies (no aggressive caching — proxies die fast). */
async function refreshBrProxies(forceRefresh = false): Promise<void> {
  const stale = Date.now() - _poolFetchedAt > 90_000; // 90s cache
  if (!forceRefresh && !stale && _proxyPool.length > 0) return;
  try {
    // Fetch from two sources simultaneously for maximum coverage
    const sources = [
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=BR&ssl=all&anonymity=all",
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=BR&ssl=all&anonymity=elite",
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

/** Build Webshare proxies from env vars. */
function webshareProxies(): FetchFn[] {
  const list = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return [];
  return list.split(",").map(addr => addr.trim()).filter(Boolean).slice(0, 5).map(addr =>
    proxyFetch(`http://${user}:${pass}@${addr}`)
  );
}

/** Returns a list of fetchFns to try in order: BR proxies → Webshare → direct. */
async function buildCandidates(): Promise<FetchFn[]> {
  await refreshBrProxies();
  const brFns = _proxyPool
    .filter(p => p.failCount < 3)
    .slice(0, 6)
    .map(p => proxyFetch(`http://${p.addr}`));
  return [...brFns, ...webshareProxies(), fetch as unknown as FetchFn];
}

// ── Session cache ─────────────────────────────────────────────────────────────

interface SisregSession { cookies: Map<string, string>; fetchFn: FetchFn; expiresAt: number }
let _session: SisregSession | null = null;

function mergeCookies(headers: Headers, into: Map<string, string>): void {
  const raw: string[] =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=[^ ])/).filter(Boolean);
  for (const c of raw) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) into.set(m[1].trim(), m[2].trim());
  }
}

function cookieStr(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** In-flight session promise — prevents duplicate parallel login races. */
let _loginInFlight: Promise<SisregSession | null> | null = null;

async function tryLoginWith(fetchFn: FetchFn, idx: number): Promise<SisregSession> {
  const jar = new Map<string, string>();
  const body = new URLSearchParams({
    acao:      "autenticar",
    usuario:   ACCOUNT.usuario,
    senha:     "",
    senha_256: SENHA_256,
    etapa:     "ACESSO",
  });

  const resp = await fetchFn(SISREG_CGI, {
    method: "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:        SISREG_CGI,
      Origin:         SISREG_BASE,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  } as RequestInit);

  mergeCookies(resp.headers, jar);
  const html = await resp.text();

  const failed =
    html.toLowerCase().includes("usuário ou senha inválido") ||
    html.toLowerCase().includes("login inválido") ||
    html.toLowerCase().includes("request rejected") ||
    (!html.includes("Sair") && !html.includes("logout") && !html.includes("cadweb"));

  if (failed) throw new Error(`login-rejected[${idx}]`);

  return { cookies: jar, fetchFn, expiresAt: Date.now() + 15 * 60_000 };
}

async function attemptParallelLogin(forceRefresh: boolean): Promise<SisregSession | null> {
  await refreshBrProxies(forceRefresh);
  const candidates = await buildCandidates();
  if (!candidates.length) return null;
  try {
    const session = await Promise.any(candidates.map((fn, i) => tryLoginWith(fn, i)));
    logger.info({ count: candidates.length }, "[SISREG] Session established (parallel login)");
    return session;
  } catch (err) {
    // Log sample errors from AggregateError for diagnostics
    const ae = err as AggregateError;
    const sample = ae?.errors?.slice(0, 3).map((e: Error) => e?.message ?? String(e));
    logger.warn({ sample }, "[SISREG] Parallel login batch failed");
    return null;
  }
}

async function getSession(): Promise<SisregSession | null> {
  if (_session && _session.expiresAt > Date.now()) return _session;
  if (_loginInFlight) return _loginInFlight;

  _loginInFlight = (async (): Promise<SisregSession | null> => {
    try {
      // First attempt with cached proxies
      let session = await attemptParallelLogin(false);
      if (session) { _session = session; return session; }

      // Second attempt: force-refresh proxy list and retry
      logger.info("[SISREG] Retrying with fresh proxy batch...");
      session = await attemptParallelLogin(true);
      if (session) { _session = session; return session; }

      logger.error("[SISREG] All login attempts exhausted after retry");
      return null;
    } finally {
      _loginInFlight = null;
    }
  })();

  return _loginInFlight;
}

/** Pre-warm the SISREG session in the background at startup. */
export function prewarmSisregSession(): void {
  getSession().catch(() => { /* background — ignore errors */ });
}

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

/** Parse the cadweb50 patient detail page into key: value pairs. */
function parseCadwebDetail(html: string): string[] {
  const fields: string[] = [];
  // cadweb50 renders a definition-list style layout — look for label/value pairs
  const labelRe = /<(?:td|th|label|b|strong)[^>]*>\s*([^<]{2,40}?)\s*[:<]\s*<\/(?:td|th|label|b|strong)>\s*<(?:td|th|span)[^>]*>\s*([^<]{1,200}?)\s*</gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(html)) !== null) {
    const k = stripTags(m[1]).replace(/:$/, "").trim();
    const v = stripTags(m[2]).trim();
    if (k && v && k.length < 40) fields.push(`${k}: ${v}`);
  }
  // Fallback to table rows
  if (fields.length === 0) return parseTableRows(html);
  return fields;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SisregResult { success: boolean; data?: string; error?: string }

/** Try a single query via one fetchFn; throws on timeout/failure/invalid response. */
async function tryQueryWith(
  fetchFn: FetchFn,
  url: string,
  body: URLSearchParams,
  cookies: Map<string, string>
): Promise<string> {
  const resp = await fetchFn(url, {
    method: "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie:         cookieStr(cookies),
      Referer:        SISREG_CGI,
      Origin:         SISREG_BASE,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(12_000),
  } as RequestInit);
  mergeCookies(resp.headers, cookies);
  const html = await resp.text();
  if (!html || html.length < 50) throw new Error("empty-response");
  return html;
}

export async function sisregSearch(
  tipo: "cpf" | "nome" | "cns",
  dados: string
): Promise<SisregResult> {
  const session = await getSession();
  if (!session) {
    return {
      success: false,
      error: "SISREG-III indisponível — não foi possível estabelecer sessão. Verifique a conectividade.",
    };
  }

  const { cookies } = session;

  let url: string;
  let body: URLSearchParams;

  if (tipo === "cns" || tipo === "cpf") {
    url  = SISREG_CNS;
    body = new URLSearchParams({ nu_cns: dados, etapa: "DETALHAR" });
  } else {
    url  = SISREG_CGI;
    body = new URLSearchParams({ acao: "pesquisa", criterio: "nome", nome: dados });
  }

  try {
    // Try all available proxies in parallel — use the fastest successful response
    const candidates = await buildCandidates();
    let html: string;
    try {
      html = await Promise.any(candidates.map(fn => tryQueryWith(fn, url, body, cookies)));
    } catch {
      // All proxies failed — invalidate session and report
      _session = null;
      return { success: false, error: "SISREG-III não respondeu. A sessão foi reiniciada — tente novamente." };
    }

    if (
      html.toLowerCase().includes("sessão expirada") ||
      html.toLowerCase().includes("não autenticado") ||
      html.includes("formLogin")
    ) {
      _session = null;
      return { success: false, error: "Sessão SISREG expirada — tente novamente" };
    }

    if (html.includes("Request Rejected") || html.toLowerCase().includes("acesso negado")) {
      _session = null;
      return { success: false, error: "SISREG bloqueou a requisição (WAF). Tente novamente em instantes." };
    }

    // Try to parse as detail page (cadweb) or table results
    const isCadweb = url.includes("cadweb50");
    const rows = isCadweb ? parseCadwebDetail(html) : parseTableRows(html);

    if (!rows.length) {
      // Check if it's a "not found" or session page
      const stripped = stripTags(html);
      if (stripped.includes("Nenhum") || stripped.includes("nenhum") || stripped.includes("não encontrado")) {
        return { success: false, error: "Nenhum paciente encontrado no SISREG-III para este dado" };
      }
      return { success: false, error: "SISREG-III não retornou dados para este paciente" };
    }

    return { success: true, data: rows.join("\n\n─────────────────────\n\n") };
  } catch (err) {
    logger.error({ err }, "[SISREG] Search error");
    _session = null;
    return { success: false, error: err instanceof Error ? err.message : "Erro ao consultar SISREG-III" };
  }
}
