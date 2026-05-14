/**
 * SISREG-III SCRAPER — standalone
 *
 * Uso:
 *   npx tsx sisreg-standalone.ts cpf 12345678901
 *   npx tsx sisreg-standalone.ts nome "JOAO DA SILVA"
 *
 * Instalar dependências:
 *   npm install tsx
 *
 * Funciona apenas a partir de IPs não bloqueados pelo DATASUS
 * (máquinas locais, VPS brasileira, etc.).
 */

const SISREG_BASE = "https://sisregiii.saude.gov.br";
const SISREG_CGI  = `${SISREG_BASE}/cgi-bin/index`;

const ACCOUNT = { usuario: "ESLI", senha: "10203040" };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Cookie helpers ───────────────────────────────────────────────────────────

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

// ── Session cache ────────────────────────────────────────────────────────────

interface Session {
  cookies: Map<string, string>;
  expiresAt: number;
}

let _session: Session | null = null;

async function getSession(): Promise<Session | null> {
  const now = Date.now();
  if (_session && _session.expiresAt > now) return _session;

  const jar = new Map<string, string>();

  const body = new URLSearchParams({
    acao:    "autenticar",
    usuario: ACCOUNT.usuario,
    senha:   ACCOUNT.senha,
  });

  console.log("[SISREG] Autenticando...");

  const resp = await fetch(SISREG_CGI, {
    method: "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer:        `${SISREG_BASE}/cgi-bin/index`,
      Origin:         SISREG_BASE,
    },
    body: body.toString(),
  });

  mergeCookies(resp.headers, jar);
  const html = await resp.text();

  const failed =
    html.toLowerCase().includes("usuário ou senha inválido") ||
    html.toLowerCase().includes("login inválido") ||
    html.toLowerCase().includes("senha incorreta");

  if (failed) {
    console.error("[SISREG] Login falhou — credenciais inválidas ou site em manutenção");
    return null;
  }

  const ok =
    html.includes("pesquisa") ||
    html.includes("regulação") ||
    html.includes("Bem-vindo") ||
    jar.size > 0;

  if (!ok) {
    console.error("[SISREG] Login falhou — resposta inesperada do servidor");
    console.error("[SISREG] HTML preview:", html.slice(0, 400));
    return null;
  }

  _session = { cookies: jar, expiresAt: now + 15 * 60 * 1000 };
  console.log("[SISREG] Login OK. Cookies:", [...jar.keys()].join(", ") || "(nenhum)");
  return _session;
}

// ── HTML parser ──────────────────────────────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s.replace(/&[a-z]+;/gi, (e) =>
    ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&apos;": "'", "&quot;": '"' }[e] ?? e)
  );
}

function parseTable(html: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let headers: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) =>
        decodeHtmlEntities(c[1].replace(/<[^>]+>/g, ""))
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    if (!cells.length) continue;

    if (!headers.length) {
      headers = cells;
    } else {
      const row: Record<string, string> = {};
      cells.forEach((v, i) => { row[headers[i] ?? `col${i}`] = v; });
      rows.push(row);
    }
  }

  return rows;
}

// ── Main search function ─────────────────────────────────────────────────────

export interface SisregResult {
  success: boolean;
  rows?: Record<string, string>[];
  raw?: string;
  error?: string;
}

export async function sisregSearch(
  tipo: "cpf" | "nome",
  dado: string
): Promise<SisregResult> {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Falha na autenticação SISREG-III" };
  }

  const searchBody = new URLSearchParams({
    acao:     "pesquisa",
    criterio: tipo,
    [tipo]:   dado,
  });

  console.log(`[SISREG] Buscando ${tipo}=${dado} ...`);

  const resp = await fetch(SISREG_CGI, {
    method: "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie:         cookieStr(session.cookies),
      Referer:        `${SISREG_BASE}/cgi-bin/index`,
      Origin:         SISREG_BASE,
    },
    body: searchBody.toString(),
  });

  mergeCookies(resp.headers, session.cookies);
  const html = await resp.text();

  if (
    html.toLowerCase().includes("sessão expirada") ||
    html.toLowerCase().includes("não autenticado")
  ) {
    _session = null;
    return { success: false, error: "Sessão SISREG expirada — tente novamente" };
  }

  const rows = parseTable(html);

  if (!rows.length) {
    return {
      success: false,
      error: "Nenhum resultado encontrado no SISREG-III para este dado",
    };
  }

  // Format as readable text
  const formatted = rows
    .map((r, i) =>
      `[Registro ${i + 1}]\n` +
      Object.entries(r)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    )
    .join("\n\n─────────────────────\n\n");

  return { success: true, rows, raw: formatted };
}

// ── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
  const [, , tipo, dado] = process.argv;

  if (!tipo || !dado || !["cpf", "nome"].includes(tipo)) {
    console.log("Uso: npx tsx sisreg-standalone.ts <cpf|nome> <valor>");
    console.log("  Ex: npx tsx sisreg-standalone.ts cpf 12345678901");
    console.log('  Ex: npx tsx sisreg-standalone.ts nome "JOAO DA SILVA"');
    process.exit(1);
  }

  const result = await sisregSearch(tipo as "cpf" | "nome", dado);

  if (!result.success) {
    console.error("\n❌ Erro:", result.error);
    process.exit(1);
  }

  console.log("\n✅ Resultados encontrados:\n");
  console.log(result.raw);
  console.log(`\n(${result.rows?.length} registro(s))`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
