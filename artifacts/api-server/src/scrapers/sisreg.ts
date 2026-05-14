/**
 * SISREG-III SCRAPER
 *
 * Scrapes SISREG-III (Sistema de Regulação) at https://sisregiii.saude.gov.br
 *
 * The site uses a Perl CGI backend with a JavaScript SPA frontend.
 * Login: POST /cgi-bin/index with acao=autenticar, usuario=, senha=
 * Search (CPF/Nome): POST /cgi-bin/index with acao=pesquisa, criterio=, <field>=
 * Search (CNS):      POST /cgi-bin/acesso_cns with acao=pesquisa, criterio=cns, cns=
 *
 * Credentials: usuario=ESLI / senha=10203040
 *
 * Since the site blocks direct connections from many IP ranges,
 * requests are routed through the Webshare proxy pool when available.
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logger } from "../lib/logger.js";

const SISREG_BASE    = "https://sisregiii.saude.gov.br";
const SISREG_CGI     = `${SISREG_BASE}/cgi-bin/index`;
const SISREG_CGI_CNS = `${SISREG_BASE}/cgi-bin/acesso_cns`;

const ACCOUNT = { usuario: "ESLI", senha: "10203040" };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Proxy setup (mirrors the pattern used by infinity.ts) ─────────────────────
function buildDispatcher(): ProxyAgent | undefined {
  const list = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return undefined;
  const proxies = list.split(",").map(p => p.trim()).filter(Boolean);
  if (!proxies.length) return undefined;
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  try {
    return new ProxyAgent({ uri: `http://${user}:${pass}@${proxy}`, connectTimeout: 6_000 });
  } catch {
    return undefined;
  }
}

type FetchFn = (url: string, opts: RequestInit) => Promise<Response>;

function makeFetchFn(dispatcher?: ProxyAgent): FetchFn {
  if (!dispatcher) return fetch;
  return (url, opts) =>
    undiciFetch(url, { ...opts, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

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

interface SisregSession {
  cookies: Map<string, string>;
  expiresAt: number;
  fetchFn: FetchFn;
}

let _session: SisregSession | null = null;

async function getSession(): Promise<SisregSession | null> {
  const now = Date.now();
  if (_session && _session.expiresAt > now) return _session;

  // Try direct first, then proxy
  const candidates: FetchFn[] = [fetch, makeFetchFn(buildDispatcher())].filter(
    (f, i, arr) => i === 0 || f !== arr[0]
  );

  for (const fetchFn of candidates) {
    try {
      const jar = new Map<string, string>();

      const loginBody = new URLSearchParams({
        acao:    "autenticar",
        usuario: ACCOUNT.usuario,
        senha:   ACCOUNT.senha,
      });

      const resp = await fetchFn(SISREG_CGI, {
        method: "POST",
        headers: {
          "User-Agent":   UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer:        `${SISREG_BASE}/cgi-bin/index`,
          Origin:         SISREG_BASE,
        },
        body: loginBody.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      mergeCookies(resp.headers, jar);
      const html = await resp.text();

      const isLoggedIn =
        !html.toLowerCase().includes("usuário ou senha inválido") &&
        !html.toLowerCase().includes("login inválido") &&
        (html.includes("pesquisa") || html.includes("regulação") || html.includes("regulacao") || jar.size > 0);

      if (!isLoggedIn) {
        logger.warn("[SISREG] Login failed, trying next candidate");
        continue;
      }

      _session = { cookies: jar, expiresAt: now + 15 * 60 * 1000, fetchFn };
      logger.info("[SISREG] Logged in successfully");
      return _session;
    } catch (err) {
      logger.warn({ err }, "[SISREG] Login attempt failed, trying next candidate");
    }
  }

  logger.error("[SISREG] All login attempts failed");
  return null;
}

function parseResults(html: string): string[] {
  const results: string[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  let headers: string[] = [];

  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " " }[e] ?? e)).replace(/\s+/g, " ").trim()
    ).filter(Boolean);

    if (!cells.length) continue;
    if (!headers.length) {
      headers = cells;
    } else {
      results.push(cells.map((v, i) => `${headers[i] ?? `col${i}`}: ${v}`).join("\n"));
    }
  }

  return results;
}

export interface SisregResult {
  success: boolean;
  data?: string;
  error?: string;
}

export async function sisregSearch(
  tipo: "cpf" | "nome" | "cns",
  dados: string
): Promise<SisregResult> {
  const session = await getSession();

  if (!session) {
    return {
      success: false,
      error: "SISREG-III indisponível — o site bloqueia conexões externas. Tente novamente mais tarde.",
    };
  }

  const { fetchFn } = session;

  try {
    // CNS lookups use the dedicated acesso_cns CGI endpoint (Consultas Gerais → CNS)
    const isCns = tipo === "cns";
    const endpoint = isCns ? SISREG_CGI_CNS : SISREG_CGI;

    const searchBody = new URLSearchParams(
      isCns
        ? { acao: "pesquisa", criterio: "cns", cns: dados }
        : { acao: "pesquisa", criterio: tipo, [tipo]: dados }
    );

    const resp = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "User-Agent":   UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie:         cookieStr(session.cookies),
        Referer:        `${SISREG_BASE}/cgi-bin/index`,
        Origin:         SISREG_BASE,
      },
      body: searchBody.toString(),
      signal: AbortSignal.timeout(12_000),
    });

    mergeCookies(resp.headers, session.cookies);
    const html = await resp.text();

    if (html.toLowerCase().includes("sessão expirada") || html.toLowerCase().includes("não autenticado")) {
      _session = null;
      return { success: false, error: "Sessão SISREG expirada — tente novamente" };
    }

    const rows = parseResults(html);
    if (!rows.length) {
      return { success: false, error: "Nenhum paciente encontrado no SISREG-III para este dado" };
    }

    return { success: true, data: rows.join("\n\n─────────────────────\n\n") };
  } catch (err) {
    logger.error({ err }, "[SISREG] Search error");
    _session = null;
    return { success: false, error: err instanceof Error ? err.message : "Erro ao consultar SISREG-III" };
  }
}
