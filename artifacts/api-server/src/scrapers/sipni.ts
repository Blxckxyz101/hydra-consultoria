/**
 * SIPNI SCRAPER
 *
 * Scrapes SI-PNI (Sistema de Informações do Programa Nacional de Imunizações)
 * at https://sipni.datasus.gov.br
 *
 * Login uses SHA-512 hashed password (applied client-side by the original JS).
 * Maintains a session cache with round-robin account rotation.
 */
import { createHash } from "node:crypto";
import { logger } from "../lib/logger.js";

const SIPNI_BASE = "https://sipni.datasus.gov.br/si-pni-web";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Round-robin SIPNI accounts
const ACCOUNTS = [
  { user: "proxy96294998",   pass: "sipni97860" },
  { user: "proxy867387611",  pass: "sipni76040" },
];

function sha512hex(str: string): string {
  return createHash("sha512").update(str, "ascii").digest("hex");
}

function extractViewState(html: string): string | null {
  const m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  return m ? m[1] : null;
}

function mergeSetCookies(headers: Headers, into: Map<string, string>): void {
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

// Direct connection — SIPNI (datasus.gov.br) is accessible from Replit IPs without proxy
type FetchFn = (url: string, opts: RequestInit) => Promise<Response>;
const buildFetch = (): FetchFn => fetch;

interface SipniSession {
  cookies: Map<string, string>;
  accountIdx: number;
  expiresAt: number;
}

const _sessions: SipniSession[] = [];
let _accountRR = 0;

async function getSession(): Promise<SipniSession | null> {
  const now = Date.now();
  const valid = _sessions.find((s) => s.expiresAt > now);
  if (valid) return valid;

  const accIdx = _accountRR % ACCOUNTS.length;
  _accountRR++;
  const account = ACCOUNTS[accIdx];
  const fetchFn = buildFetch();
  const loginUrl = `${SIPNI_BASE}/faces/inicio.jsf`;

  try {
    // Step 1: GET login page to extract ViewState + cookies
    const pageResp = await fetchFn(loginUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    const pageHtml = await pageResp.text();
    const viewState = extractViewState(pageHtml);
    if (!viewState) {
      logger.warn("[SIPNI] Could not extract ViewState from login page");
      return null;
    }

    const jar = new Map<string, string>();
    mergeSetCookies(pageResp.headers, jar);

    // Detect form ID and button name from the live HTML
    const formIdMatch = pageHtml.match(/<form id="([^"]+)"[^>]+action="\/si-pni-web\/faces\/inicio\.jsf"/);
    const formId = formIdMatch?.[1] ?? "j_idt26";
    const btnMatch = pageHtml.match(/name="([^"]+)"[^>]*type="submit"/);
    const btnName = btnMatch?.[1] ?? `${formId}:j_idt38`;

    // Extract exact field names from live HTML (fallback to known names)
    const userFieldMatch = pageHtml.match(/name="([^"]*usuario[^"]*)"[^>]*type="text"/i);
    const passFieldMatch = pageHtml.match(/name="([^"]*senha[^"]*)"[^>]*type="password"/i);
    const userField = userFieldMatch?.[1] ?? `${formId}:usuario`;
    const passField = passFieldMatch?.[1] ?? `${formId}:senha`;

    // Step 2: Regular form POST — exactly what the browser sends when JS is disabled
    // or when the submit button (type=submit) is clicked without JS interception.
    // This is more reliable than PrimeFaces AJAX because:
    //   - AJAX execute=buttonOnly skips binding username/password in JSF model
    //   - Regular POST always includes all named form fields
    const postBody = new URLSearchParams({
      [formId]: formId,
      "javax.faces.ViewState": viewState,
      [userField]: account.user,
      [passField]: sha512hex(account.pass),
      [btnName]: btnName,
    });

    const authResp = await fetchFn(loginUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: cookieStr(jar),
        Referer: loginUrl,
        Origin: "https://sipni.datasus.gov.br",
      },
      body: postBody.toString(),
    });

    mergeSetCookies(authResp.headers, jar);

    // On successful login: server returns 302 redirect to menuHome or dashboard
    // On failure: server returns 200 with the login page again
    const loginOk =
      authResp.status === 302 ||
      authResp.status === 303 ||
      (authResp.headers.get("location") ?? "").includes("menuHome");

    if (!loginOk) {
      const body = await authResp.text();
      const hasError =
        body.includes("Informe o") ||
        body.includes("nválido") ||
        body.includes("incorreto");
      logger.warn(
        "[SIPNI] Login failed for %s — HTTP %d%s",
        account.user,
        authResp.status,
        hasError ? " (credenciais recusadas)" : " (resposta inesperada)",
      );
      return null;
    }

    // Step 3: Follow the redirect to establish a full session
    const redirectTarget = authResp.headers.get("location") ?? `${SIPNI_BASE}/faces/publico/menuHome.jsf`;
    const absRedirect = redirectTarget.startsWith("http")
      ? redirectTarget
      : `https://sipni.datasus.gov.br${redirectTarget}`;

    const homeResp = await fetchFn(absRedirect, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        Cookie: cookieStr(jar),
        Referer: loginUrl,
      },
    });
    mergeSetCookies(homeResp.headers, jar);

    const hasSession = jar.size > 0;
    if (!hasSession) {
      logger.warn("[SIPNI] No session cookies after login for %s", account.user);
      return null;
    }

    const session: SipniSession = {
      cookies: jar,
      accountIdx: accIdx,
      expiresAt: now + 20 * 60 * 1000,
    };
    _sessions.push(session);
    if (_sessions.length > 4) _sessions.splice(0, 1);
    logger.info("[SIPNI] Logged in as %s (cookies: %d)", account.user, jar.size);
    return session;
  } catch (err) {
    logger.error({ err }, "[SIPNI] Session creation error");
    return null;
  }
}

export interface SipniResult {
  success: boolean;
  data?: string;
  rows?: Array<Record<string, string>>;
  error?: string;
}

export async function sipniSearch(
  tipo: "cpf" | "nome" | "cns",
  dados: string
): Promise<SipniResult> {
  const session = await getSession();
  if (!session) return { success: false, error: "Falha ao autenticar no SIPNI — tente novamente" };

  const { cookies } = session;
  const fetchFn = buildFetch();
  const listUrl = `${SIPNI_BASE}/faces/paciente/listarPaciente.jsf`;

  try {
    const listResp = await fetchFn(listUrl, {
      headers: {
        "User-Agent": UA,
        Cookie: cookieStr(cookies),
        Referer: `${SIPNI_BASE}/faces/inicio.jsf`,
      },
    });
    mergeSetCookies(listResp.headers, cookies);
    const listHtml = await listResp.text();

    const viewState = extractViewState(listHtml);
    if (!viewState) {
      session.expiresAt = 0;
      return { success: false, error: "Sessão SIPNI expirada — tente novamente" };
    }

    const formIdMatch = listHtml.match(/<form id="([^"]+)"/);
    const formId = formIdMatch?.[1] ?? "frmPaciente";

    let fieldName: string;
    if (tipo === "cpf") {
      fieldName = listHtml.match(/name="([^"]*[Cc][Pp][Ff][^"]*)"[^>]*type="text"/)?.[1] ?? `${formId}:cpf`;
    } else if (tipo === "nome") {
      fieldName = listHtml.match(/name="([^"]*[Nn]ome[^"]*)"[^>]*type="text"/)?.[1] ?? `${formId}:nome`;
    } else {
      fieldName = listHtml.match(/name="([^"]*[Cc][Nn][Ss][^"]*)"[^>]*type="text"/)?.[1] ?? `${formId}:cns`;
    }

    const btnMatch = listHtml.match(/name="([^"]*(?:buscar|pesquisar|search|btn)[^"]*)"[^>]*type="submit"/i);
    const searchBody: Record<string, string> = {
      [formId]: formId,
      "javax.faces.ViewState": viewState,
      [fieldName]: dados,
    };
    if (btnMatch?.[1]) searchBody[btnMatch[1]] = btnMatch[1];

    const searchResp = await fetchFn(listUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieStr(cookies),
        Referer: listUrl,
        Origin: "https://sipni.datasus.gov.br",
      },
      body: new URLSearchParams(searchBody).toString(),
    });
    mergeSetCookies(searchResp.headers, cookies);
    const resultHtml = await searchResp.text();

    const rows = parseHtmlTableRows(resultHtml);
    if (!rows.length) {
      return { success: false, error: "Nenhum registro encontrado no SIPNI" };
    }

    const formatted = rows.map((r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join("\n")).join("\n\n─────────────────────\n\n");
    return { success: true, data: formatted, rows };
  } catch (err) {
    logger.error({ err }, "[SIPNI] Search error");
    return { success: false, error: err instanceof Error ? err.message : "Erro interno ao consultar SIPNI" };
  }
}

function parseHtmlTableRows(html: string): Array<Record<string, string>> {
  const headers: string[] = [];
  const rows: Array<Record<string, string>> = [];

  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];

  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let first = true;
  let m: RegExpExecArray | null;

  while ((m = trRe.exec(tableMatch[1])) !== null) {
    const cells = [...m[1].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
    );
    if (!cells.length) continue;
    if (first) {
      headers.push(...cells);
      first = false;
    } else {
      const row: Record<string, string> = {};
      cells.forEach((v, i) => { row[headers[i] ?? `col${i}`] = v; });
      if (Object.values(row).some((v) => v.length > 0)) rows.push(row);
    }
  }

  return rows;
}
