import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, infinityUsersTable, infinityConsultasTable } from "@workspace/db";
import { eq, desc, sql, gte, and } from "drizzle-orm";
import {
  createSession,
  deleteSession,
  extractToken,
  requireAuth,
  requireAdmin,
} from "../lib/infinity-auth.js";
import { loginLimiter, consultaLimiter, panelAuthLimiter } from "../middlewares/rateLimit.js";
import crypto from "node:crypto";

const router: IRouter = Router();

const PROVIDER_BASE = "http://149.56.18.68:25584/api/consulta";
const PROVIDER_KEY = process.env.GEASS_API_KEY ?? "GeassZero";

const DAILY_RATE_LIMIT = 350;
const PER_USER_DAILY_LIMIT = 100;

let _globalDailyCache: { date: string; count: number } = { date: "", count: 0 };

async function getGlobalDailyCount(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  if (_globalDailyCache.date === today) return _globalDailyCache.count;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, todayStart));
  const count = row?.c ?? 0;
  _globalDailyCache = { date: today, count };
  return count;
}

const _userDailyCache = new Map<string, { date: string; count: number }>();

async function getUserDailyCount(username: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = _userDailyCache.get(username);
  if (cached?.date === today) return cached.count;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(eq(infinityConsultasTable.username, username), gte(infinityConsultasTable.createdAt, todayStart)));
  const count = row?.c ?? 0;
  _userDailyCache.set(username, { date: today, count });
  return count;
}

function bumpCaches(username: string): void {
  const today = new Date().toISOString().slice(0, 10);
  _globalDailyCache = { date: today, count: _globalDailyCache.count + 1 };
  const u = _userDailyCache.get(username);
  if (u?.date === today) _userDailyCache.set(username, { date: today, count: u.count + 1 });
}

const SUPPORTED_TIPOS = new Set([
  "nome", "cpf", "pix", "nis", "cns", "placa", "chassi", "telefone",
  "mae", "pai", "parentes", "cep", "frota", "cnpj", "fucionarios",
  "socios", "empregos", "cnh", "renavam", "obito", "rg", "email",
  "motor", "vacinas",
]);

const onlyDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

function serializeUser(row: { username: string; role: string; createdAt: Date; lastLoginAt: Date | null; accountExpiresAt?: Date | null }) {
  return {
    username: row.username,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    accountExpiresAt: row.accountExpiresAt ? row.accountExpiresAt.toISOString() : null,
  };
}

async function logConsulta(args: {
  tipo: string; query: string; username: string; success: boolean; result: unknown;
}): Promise<void> {
  try {
    await db.insert(infinityConsultasTable).values({
      tipo: args.tipo,
      query: args.query,
      username: args.username,
      success: args.success,
      result: args.result as object,
    });
  } catch {
    /* swallow */
  }
}

// ─── Provider parser ───────────────────────────────────────────────────────
type ParsedSection = { name: string; items: string[] };
type Parsed = {
  fields: Array<{ key: string; value: string }>;
  sections: ParsedSection[];
  raw: string;
};

const SEP = " \u23AF ";
const LAST_WORD_RE = /\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$/;
const SEC_HEADER_RE = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Za-z_0-9 ]+):\s*\(\s*\d+\s*-\s*Encontrados?\s*\)/;

const KNOWN_MULTIWORD_KEYS = new Set([
  "NOME MÃE", "NOME PAI", "NOME MAE", "NOME PAI",
  "MUNICÍPIO DE NASCIMENTO", "MUNICIPIO DE NASCIMENTO",
  "TIPO SANGÚINEO", "TIPO SANGUINEO",
  "ESTADO CIVIL", "STATUS NA RECEITA",
  "HABILITADO PARA DIRIGIR", "HABILITADO_PARA_DIRIGIR",
  "ANO MODELO", "ANO FABRICACAO", "ANO FABRICAÇÃO",
  "PROPRIETARIO NOME", "PROPRIETARIO CPF",
  "MARCA MODELO", "NUMERO CHASSI",
  "DATA EMISSAO", "DATA NASCIMENTO", "DATA OBITO",
  "NOME FANTASIA", "RAZAO SOCIAL",
  "SITUACAO CADASTRAL", "NATUREZA JURIDICA",
  "CAPITAL SOCIAL", "DATA ABERTURA",
  "ENDERECO COMPLETO", "LOGRADOURO TIPO",
  "TITULO ELEITOR", "CLASSE SOCIAL",
  "RECEBE INSS", "NOME SOCIAL",
  "RACA COR", "TIPO LOGRADOURO",
  "DATA EMISSAO RG", "ORGAO EMISSOR",
  "PAIS NASCIMENTO", "PAIS RESIDENCIA",
  "SITUACAO ESPECIAL", "DATA SITUACAO",
]);

const PURE_KEY_RE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_]+$/;

function extractTrailingKey(seg: string): { value: string; key: string } {
  const trimmed = seg.trim();
  if (KNOWN_MULTIWORD_KEYS.has(trimmed)) return { value: "", key: trimmed };
  if (PURE_KEY_RE.test(trimmed)) return { value: "", key: trimmed };
  for (const n of [3, 2]) {
    const re = new RegExp(
      `^(.*?)\\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*\\s+){${n - 1}}[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$`
    );
    const m = re.exec(trimmed);
    if (m && KNOWN_MULTIWORD_KEYS.has(m[2].trim())) {
      return { value: m[1].trim(), key: m[2].trim() };
    }
  }
  const lm = LAST_WORD_RE.exec(trimmed);
  if (lm) return { value: trimmed.slice(0, lm.index).trim(), key: lm[1].trim() };
  return { value: trimmed, key: "" };
}

function parseBaseNFormat(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };
  const segments = raw.split(/\s*BASE\s+\d+\s*/i).filter((p) => p.trim().includes(":"));
  const items: string[] = [];
  for (const seg of segments) {
    const pairs: string[] = [];
    const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
      if (k && v) pairs.push(`${k}: ${v}`);
    }
    if (pairs.length > 0) items.push(pairs.join(" · "));
  }
  if (items.length > 0) result.sections.push({ name: "REGISTROS", items });
  return result;
}

function parseColonFormat(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };
  const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:\n]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
    if (k.length >= 2 && v) result.fields.push({ key: k, value: v });
  }
  return result;
}

function parseProviderText(raw: string): Parsed {
  const result: Parsed = { fields: [], sections: [], raw };
  if (/\bBASE\s+\d+\b/i.test(raw)) return parseBaseNFormat(raw);
  if (!raw || !raw.includes("\u23AF")) {
    if (raw && raw.includes(":")) {
      const colon = parseColonFormat(raw);
      if (colon.fields.length > 0) return colon;
    }
    return result;
  }
  const parts = raw.split(SEP);
  const firstExtract = extractTrailingKey(parts[0]);
  let currentKey = firstExtract.key || parts[0].trim();
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.includes("•")) {
      const secMatch = SEC_HEADER_RE.exec(part.trim());
      if (secMatch) {
        const bulletIdx = part.indexOf("•");
        const itemsRaw = part.slice(bulletIdx);
        const items = itemsRaw.split("•").map((s) => s.trim()).filter(Boolean);
        result.sections.push({ name: secMatch[1].trim().toUpperCase(), items });
        const lastItem = items[items.length - 1] ?? "";
        const lm = LAST_WORD_RE.exec(lastItem);
        currentKey = lm ? lm[1].trim() : "";
        continue;
      }
    }
    if (i === parts.length - 1) {
      const value = part.trim().replace(/\s+/g, " ");
      if (currentKey && value) result.fields.push({ key: currentKey, value });
      break;
    }
    const { value, key: nextKey } = extractTrailingKey(part);
    const cleanValue = value.replace(/\s+/g, " ");
    if (currentKey && cleanValue) result.fields.push({ key: currentKey, value: cleanValue });
    currentKey = nextKey;
  }
  return result;
}

async function callProvider(tipo: string, dados: string, signal: AbortSignal): Promise<{
  ok: boolean;
  parsed?: Parsed;
  error?: string;
  http?: number;
  raw?: unknown;
}> {
  const url = `${PROVIDER_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(PROVIDER_KEY)}`;
  try {
    const r = await fetch(url, { signal });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false, http: r.status, error: `Provedor HTTP ${r.status}`, raw: text.slice(0, 1000) };
    }
    let json: { status?: string; resposta?: string; criador?: string };
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: "Provedor retornou texto inválido", raw: text.slice(0, 500) };
    }
    if (!json.resposta || typeof json.resposta !== "string") {
      return { ok: false, error: "Sem resultado para esta consulta", raw: json };
    }
    const parsed = parseProviderText(json.resposta);
    if (parsed.fields.length === 0 && parsed.sections.length === 0 && parsed.raw.trim().length === 0) {
      return { ok: false, error: "Sem dados retornados", parsed };
    }
    return { ok: true, parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro de rede";
    return { ok: false, error: msg };
  }
}

// ─── ViaCEP fallback ────────────────────────────────────────────────────────
async function callViaCep(cep: string, signal: AbortSignal): Promise<{
  ok: boolean; parsed?: Parsed; error?: string;
}> {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal });
    if (!r.ok) return { ok: false, error: `ViaCEP HTTP ${r.status}` };
    const d = await r.json() as Record<string, string>;
    if (d.erro) return { ok: false, error: "CEP não encontrado na ViaCEP" };
    const fields: Parsed["fields"] = [];
    const add = (k: string, v: string | undefined) => { if (v?.trim()) fields.push({ key: k, value: v.trim() }); };
    add("CEP",        d.cep);
    add("Logradouro", d.logradouro);
    add("Complemento",d.complemento);
    add("Bairro",     d.bairro);
    add("Cidade",     d.localidade);
    add("UF",         d.uf);
    add("Estado",     d.estado);
    add("Região",     d.regiao);
    add("DDD",        d.ddd);
    add("IBGE",       d.ibge);
    const parsed: Parsed = { fields, sections: [], raw: `[ViaCEP] CEP: ${d.cep} · ${d.logradouro}, ${d.bairro} - ${d.localidade}/${d.uf}` };
    return { ok: fields.length > 0, parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro ViaCEP" };
  }
}

// ─── ReceitaWS fallback (CNPJ) ──────────────────────────────────────────────
interface ReceitaWsResponse {
  abertura?: string; situacao?: string; tipo?: string; nome?: string; fantasia?: string;
  porte?: string; natureza_juridica?: string; logradouro?: string; numero?: string;
  complemento?: string; bairro?: string; municipio?: string; uf?: string; cep?: string;
  email?: string; telefone?: string; cnpj?: string; data_situacao?: string;
  capital_social?: string; ultima_atualizacao?: string;
  atividade_principal?: Array<{ code: string; text: string }>;
  atividades_secundarias?: Array<{ code: string; text: string }>;
  qsa?: Array<{ nome: string; qual: string }>;
}

async function callReceitaWs(cnpj: string, signal: AbortSignal): Promise<{
  ok: boolean; parsed?: Parsed; error?: string;
}> {
  try {
    const r = await fetch(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, {
      signal,
      headers: { "Accept": "application/json", "User-Agent": "InfinitySearch/1.0" },
    });
    if (!r.ok) return { ok: false, error: `ReceitaWS HTTP ${r.status}` };
    const d = await r.json() as ReceitaWsResponse & { message?: string };
    if (d.message) return { ok: false, error: d.message };
    const fields: Parsed["fields"] = [];
    const add = (k: string, v: string | undefined) => { if (v?.trim()) fields.push({ key: k, value: v.trim() }); };
    add("CNPJ",              d.cnpj);
    add("Razão Social",      d.nome);
    add("Nome Fantasia",     d.fantasia);
    add("Situação",          d.situacao);
    add("Tipo",              d.tipo);
    add("Abertura",          d.abertura);
    add("Porte",             d.porte);
    add("Nat. Jurídica",     d.natureza_juridica);
    add("Capital Social",    d.capital_social);
    add("Logradouro",        d.logradouro);
    add("Número",            d.numero);
    add("Complemento",       d.complemento);
    add("Bairro",            d.bairro);
    add("Município",         d.municipio);
    add("UF",                d.uf);
    add("CEP",               d.cep);
    add("Telefone",          d.telefone);
    add("E-mail",            d.email);
    add("Situação desde",    d.data_situacao);
    add("Última atualização",d.ultima_atualizacao);

    const sections: Parsed["sections"] = [];

    if (d.atividade_principal?.length) {
      sections.push({
        name: "ATIVIDADE PRINCIPAL",
        items: d.atividade_principal.map((a) => `${a.code} · ${a.text}`),
      });
    }
    if (d.atividades_secundarias?.length) {
      sections.push({
        name: "ATIVIDADES SECUNDÁRIAS",
        items: d.atividades_secundarias.map((a) => `${a.code} · ${a.text}`),
      });
    }
    if (d.qsa?.length) {
      sections.push({
        name: "QUADRO SOCIETÁRIO (QSA)",
        items: d.qsa.map((s) => `${s.nome} (${s.qual})`),
      });
    }

    const parsed: Parsed = {
      fields,
      sections,
      raw: `[ReceitaWS] CNPJ: ${d.cnpj} · ${d.nome} · ${d.situacao}`,
    };
    return { ok: fields.length > 0, parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro ReceitaWS" };
  }
}

// ─── CNPJ.ws fallback ──────────────────────────────────────────────────────
interface CnpjWsResponse {
  cnpj_raiz?: string; razao_social?: string; capital_social?: string;
  natureza_juridica?: { id?: string; descricao?: string };
  qualificacao_do_responsavel?: { id?: number; descricao?: string };
  porte?: { id?: string; descricao?: string };
  entidade_responsavel?: { id?: string; descricao?: string };
  estabelecimento?: {
    cnpj?: string; tipo?: string; situacao_cadastral?: string; data_situacao_cadastral?: string;
    data_inicio_atividade?: string; nome_fantasia?: string;
    logradouro?: string; numero?: string; complemento?: string;
    bairro?: string; cep?: string;
    municipio?: { nome?: string }; estado?: { nome?: string; sigla?: string };
    email?: string; ddd1?: string; telefone1?: string; ddd2?: string; telefone2?: string;
    atividade_principal?: { id?: string; descricao?: string };
  };
  socios?: Array<{
    nome?: string; cpf_cnpj_socio?: string;
    qualificacao_socio?: { descricao?: string };
    data_entrada_sociedade?: string;
  }>;
}

async function callCnpjWs(cnpj: string, signal: AbortSignal): Promise<{
  ok: boolean; parsed?: Parsed; error?: string;
}> {
  try {
    const r = await fetch(`https://publica.cnpj.ws/v1/cnpj/${cnpj}`, {
      signal,
      headers: { "Accept": "application/json", "User-Agent": "InfinitySearch/1.0" },
    });
    if (!r.ok) return { ok: false, error: `CNPJ.ws HTTP ${r.status}` };
    const d = await r.json() as CnpjWsResponse;
    const est = d.estabelecimento;
    const fields: Parsed["fields"] = [];
    const add = (k: string, v: string | number | undefined | null) => {
      const s = String(v ?? "").trim(); if (s) fields.push({ key: k, value: s });
    };
    add("CNPJ",           est?.cnpj);
    add("Razão Social",   d.razao_social);
    add("Nome Fantasia",  est?.nome_fantasia);
    add("Situação",       est?.situacao_cadastral);
    add("Tipo",           est?.tipo);
    add("Início Atividade", est?.data_inicio_atividade);
    add("Capital Social", d.capital_social);
    add("Nat. Jurídica",  d.natureza_juridica?.descricao);
    add("Porte",          d.porte?.descricao);
    add("Logradouro",     est?.logradouro);
    add("Número",         est?.numero);
    add("Complemento",    est?.complemento);
    add("Bairro",         est?.bairro);
    add("Município",      est?.municipio?.nome);
    add("UF",             est?.estado?.sigla);
    add("Estado",         est?.estado?.nome);
    add("CEP",            est?.cep);
    const tel = est?.ddd1 && est?.telefone1 ? `(${est.ddd1}) ${est.telefone1}` : "";
    add("Telefone",       tel);
    const tel2 = est?.ddd2 && est?.telefone2 ? `(${est.ddd2}) ${est.telefone2}` : "";
    add("Telefone 2",     tel2);
    add("E-mail",         est?.email);
    add("Atividade Principal", est?.atividade_principal?.descricao);

    const sections: Parsed["sections"] = [];
    if (d.socios?.length) {
      sections.push({
        name: "QUADRO SOCIETÁRIO (QSA)",
        items: d.socios.map((s) =>
          `${s.nome ?? "?"} · ${s.qualificacao_socio?.descricao ?? ""} · Entrada: ${s.data_entrada_sociedade ?? "?"}`
        ),
      });
    }

    const parsed: Parsed = {
      fields,
      sections,
      raw: `[CNPJ.ws] CNPJ: ${est?.cnpj ?? cnpj} · ${d.razao_social} · ${est?.situacao_cadastral}`,
    };
    return { ok: fields.length > 0, parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro CNPJ.ws" };
  }
}

// ─── auth ──────────────────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username e password obrigatórios" });
    return;
  }
  const rows = await db
    .select()
    .from(infinityUsersTable)
    .where(sql`lower(${infinityUsersTable.username}) = lower(${String(username)})`)
    .limit(1);
  const u = rows[0];
  if (!u) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const ok = await bcrypt.compare(String(password), u.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const { token } = await createSession(u.username);
  await db.update(infinityUsersTable).set({ lastLoginAt: new Date() }).where(eq(infinityUsersTable.username, u.username));
  res.json({
    token,
    user: serializeUser({ ...u, lastLoginAt: new Date() }),
  });
});

router.post("/logout", async (req, res) => {
  const token = extractToken(req);
  if (token) await deleteSession(token);
  res.status(204).end();
});

router.get("/me", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, username)).limit(1);
  const u = rows[0];
  if (!u) {
    res.status(401).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json(serializeUser(u));
});

// ─── users (admin) ─────────────────────────────────────────────────────────
router.get("/users", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(infinityUsersTable).orderBy(desc(infinityUsersTable.createdAt));
  res.json(rows.map(serializeUser));
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, password, role, expiresInDays, expiresAt } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ error: "username, password e role obrigatórios" });
    return;
  }
  const validRoles = ["admin", "vip", "user"];
  const finalRole = validRoles.includes(role) ? role : "vip";
  const passwordHash = await bcrypt.hash(String(password), 10);

  let accountExpiresAt: Date | null = null;
  if (expiresAt) {
    accountExpiresAt = new Date(expiresAt);
  } else if (expiresInDays && Number(expiresInDays) > 0) {
    accountExpiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
  }

  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole, accountExpiresAt })
      .returning();
    res.status(201).json(serializeUser(created));
  } catch {
    res.status(400).json({ error: "Usuário já existe ou dados inválidos" });
  }
});

router.delete("/users/:username", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  if (target === req.infinityUser!.username) {
    res.status(400).json({ error: "Você não pode deletar sua própria conta" });
    return;
  }
  await db.delete(infinityUsersTable).where(eq(infinityUsersTable.username, target));
  res.status(204).end();
});

router.patch("/users/:username", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  const { action, expiresInDays, expiresAt } = req.body ?? {};

  let updateData: { accountExpiresAt: Date | null };

  if (action === "revoke") {
    updateData = { accountExpiresAt: new Date(Date.now() - 1000) };
  } else if (action === "restore") {
    updateData = { accountExpiresAt: null };
  } else if (expiresAt !== undefined) {
    updateData = { accountExpiresAt: expiresAt ? new Date(expiresAt) : null };
  } else if (expiresInDays !== undefined) {
    updateData = {
      accountExpiresAt: Number(expiresInDays) > 0
        ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
        : null,
    };
  } else {
    res.status(400).json({ error: "Ação inválida." });
    return;
  }

  const [updated] = await db
    .update(infinityUsersTable)
    .set(updateData)
    .where(eq(infinityUsersTable.username, target))
    .returning();

  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(serializeUser(updated));
});

// ─── overview ──────────────────────────────────────────────────────────────
router.get("/overview", requireAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days ?? 84), 7), 365);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(infinityConsultasTable);

  const [{ hoje }] = await db
    .select({ hoje: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, startOfDay));

  const [{ semana }] = await db
    .select({ semana: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, weekAgo));

  const [{ usuarios }] = await db
    .select({ usuarios: sql<number>`count(*)::int` })
    .from(infinityUsersTable);

  const porTipo = await db
    .select({
      tipo: infinityConsultasTable.tipo,
      count: sql<number>`count(*)::int`,
    })
    .from(infinityConsultasTable)
    .groupBy(infinityConsultasTable.tipo);

  // Operator ranking (all time)
  const porOperador = await db
    .select({
      username: infinityConsultasTable.username,
      count: sql<number>`count(*)::int`,
    })
    .from(infinityConsultasTable)
    .groupBy(infinityConsultasTable.username)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(10);

  // Global daily count (for rate limit display)
  const [{ todayTotal }] = await db
    .select({ todayTotal: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, startOfDay));

  const recentes = await db
    .select()
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, periodStart))
    .orderBy(desc(infinityConsultasTable.createdAt))
    .limit(500);

  res.json({
    totalConsultas: total ?? 0,
    consultasHoje: hoje ?? 0,
    consultasSemana: semana ?? 0,
    usuariosAtivos: usuarios ?? 0,
    consultasPorTipo: porTipo.map((p) => ({ tipo: p.tipo, count: p.count })),
    consultasPorOperador: porOperador.map((p) => ({ username: p.username, count: p.count })),
    rateLimitHoje: todayTotal ?? 0,
    rateLimitMax: DAILY_RATE_LIMIT,
    recentes: recentes.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      query: r.query,
      username: r.username,
      success: r.success,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

router.get("/consultas", requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const username = req.infinityUser!.username;
  const rows = await db
    .select()
    .from(infinityConsultasTable)
    .where(eq(infinityConsultasTable.username, username))
    .orderBy(desc(infinityConsultasTable.createdAt))
    .limit(limit);
  res.json(
    rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      query: r.query,
      username: r.username,
      success: r.success,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─── bases status ──────────────────────────────────────────────────────────
router.get("/bases/status", requireAuth, async (_req, res) => {
  const bases = [
    { id: "geass",    name: "Geass API",       description: "Provedor OSINT principal · 24 tipos",           url: PROVIDER_BASE.replace("/api/consulta", "/") },
    { id: "sipni",    name: "SI-PNI / DATASUS", description: "Programa Nacional de Imunizações",              url: "https://sipni.datasus.gov.br" },
    { id: "sisreg",   name: "SISREG-III",       description: "Sistema de Regulação em Saúde",                 url: "https://sisregiii.saude.gov.br" },
    { id: "viacep",   name: "ViaCEP",           description: "Consulta de endereços por CEP · fallback CEP",  url: "https://viacep.com.br/ws/01001000/json/" },
    { id: "receitaws",name: "ReceitaWS",         description: "CNPJ via Receita Federal · fallback CNPJ",     url: "https://www.receitaws.com.br/v1/cnpj/11222333000181" },
    { id: "cnpjws",   name: "CNPJ.ws",          description: "Consulta pública de CNPJ · fallback secundário",url: "https://publica.cnpj.ws/v1/" },
  ];

  const checks = await Promise.allSettled(
    bases.map(async (base) => {
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(base.url, {
          method: "GET",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0" },
          redirect: "follow",
        });
        clearTimeout(timer);
        const ms = Date.now() - start;
        const online = r.status < 500;
        return { id: base.id, name: base.name, description: base.description, online, ms, http: r.status };
      } catch {
        return { id: base.id, name: base.name, description: base.description, online: false, ms: Date.now() - start, http: 0 };
      }
    })
  );

  const results = checks.map((c, i) => {
    if (c.status === "fulfilled") return c.value;
    return { id: bases[i].id, name: bases[i].name, description: bases[i].description, online: false, ms: 0, http: 0 };
  });

  res.json(results);
});

// ─── consultas universal ───────────────────────────────────────────────────
router.post("/consultas/:tipo", requireAuth, consultaLimiter, async (req, res) => {
  const tipo = String(req.params.tipo).toLowerCase();
  if (!SUPPORTED_TIPOS.has(tipo)) {
    res.status(404).json({ error: `Tipo de consulta "${tipo}" não suportado` });
    return;
  }
  const dadosRaw = String(req.body?.dados ?? req.body?.query ?? "").trim();
  if (!dadosRaw) {
    res.status(400).json({ error: "Campo 'dados' obrigatório" });
    return;
  }

  const username = req.infinityUser!.username;

  // Global + per-user daily rate limits (cached in-memory)
  const [globalCount, userCount] = await Promise.all([
    getGlobalDailyCount(),
    getUserDailyCount(username),
  ]);
  if (globalCount >= DAILY_RATE_LIMIT) {
    res.status(429).json({
      error: `Limite diário de ${DAILY_RATE_LIMIT} consultas atingido para toda a plataforma. Tente novamente amanhã.`,
      rateLimited: true,
    });
    return;
  }
  if (userCount >= PER_USER_DAILY_LIMIT) {
    res.status(429).json({
      error: `Seu limite diário de ${PER_USER_DAILY_LIMIT} consultas foi atingido. Tente novamente amanhã.`,
      rateLimited: true,
    });
    return;
  }

  // Light validation per tipo
  let dados = dadosRaw;
  if (["cpf", "nis", "cns", "mae", "pai", "parentes", "obito", "vacinas"].includes(tipo)) {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 11) {
      res.status(400).json({ error: "CPF inválido (11 dígitos)" });
      return;
    }
  } else if (tipo === "cnpj" || tipo === "fucionarios" || tipo === "socios") {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 14) {
      res.status(400).json({ error: "CNPJ inválido (14 dígitos)" });
      return;
    }
  } else if (tipo === "telefone" || tipo === "pix") {
    dados = onlyDigits(dadosRaw);
  } else if (tipo === "cep") {
    dados = onlyDigits(dadosRaw);
    if (dados.length !== 8) {
      res.status(400).json({ error: "CEP inválido (8 dígitos)" });
      return;
    }
  } else if (tipo === "placa") {
    dados = dadosRaw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  } else {
    // Generic text types: cap at 200 chars
    dados = dadosRaw.slice(0, 200);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);

  let provider = await callProvider(tipo, dados, ctrl.signal);

  // ─── CEP fallback: ViaCEP ─────────────────────────────────────────────────
  if (!provider.ok && tipo === "cep" && !ctrl.signal.aborted) {
    const viacep = await callViaCep(dados, ctrl.signal);
    if (viacep.ok) provider = { ok: true, parsed: viacep.parsed };
    else provider = { ...provider, error: `Geass: ${provider.error} | ViaCEP: ${viacep.error}` };
  }

  // ─── CNPJ fallback: ReceitaWS → CNPJ.ws ──────────────────────────────────
  if (!provider.ok && (tipo === "cnpj" || tipo === "fucionarios" || tipo === "socios") && !ctrl.signal.aborted) {
    const receita = await callReceitaWs(dados, ctrl.signal);
    if (receita.ok) {
      provider = { ok: true, parsed: receita.parsed };
    } else if (!ctrl.signal.aborted) {
      const cnpjws = await callCnpjWs(dados, ctrl.signal);
      if (cnpjws.ok) provider = { ok: true, parsed: cnpjws.parsed };
      else provider = { ...provider, error: `Geass: ${provider.error} | ReceitaWS: ${receita.error} | CNPJ.ws: ${cnpjws.error}` };
    }
  }

  clearTimeout(timer);

  const success = provider.ok && !!provider.parsed;
  const data = provider.parsed ?? { fields: [], sections: [], raw: provider.raw ? String(provider.raw) : "" };

  await logConsulta({ tipo, query: dados, username, success, result: data });
  bumpCaches(username);

  res.json({
    success,
    tipo,
    query: dados,
    data,
    error: provider.error ?? null,
  });
});

// ─── AI chat (streaming via SSE, with tool-calling for consultations) ────────
const CONSULTA_TOOL = {
  type: "function" as const,
  function: {
    name: "consultar_infinity",
    description:
      "Executa uma consulta OSINT no Infinity Search. Use quando o usuário pedir para buscar/consultar CPF, CNPJ, telefone, placa, nome, etc.",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [
            "cpf", "nome", "placa", "chassi", "telefone", "pix", "nis", "cns",
            "mae", "pai", "parentes", "cep", "frota", "cnpj", "fucionarios",
            "socios", "empregos", "cnh", "renavam", "obito", "rg", "email", "motor", "vacinas",
          ],
          description: "Tipo de consulta OSINT",
        },
        dados: { type: "string", description: "O dado a ser consultado" },
      },
      required: ["tipo", "dados"],
    },
  },
};

async function streamGroq(
  apiKey: string,
  messages: unknown[],
  res: import("express").Response
): Promise<void> {
  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", stream: true, messages }),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      res.write(`data: ${JSON.stringify({ error: `Groq HTTP ${upstream.status}`, detail: text.slice(0, 200) })}\n\n`);
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch { /* ignore */ }
      }
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (e) {
    const err = e instanceof Error ? e.message : "erro";
    res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
    res.end();
  }
}

router.post("/ai/chat", requireAuth, async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages obrigatório" });
    return;
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GROQ_API_KEY não configurada" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const systemPrompt =
    "Você é o assistente do painel Infinity Search, uma plataforma OSINT brasileira. Responda em português brasileiro, de forma clara, objetiva e profissional. " +
    "Use a ferramenta consultar_infinity SOMENTE quando a mensagem ATUAL do usuário pedir EXPLICITAMENTE uma nova busca/consulta de um dado específico (CPF, CNPJ, telefone, placa, e-mail, etc.). " +
    "NÃO use a ferramenta em resposta a: agradecimentos, saudações, perguntas sobre resultados anteriores, confirmações ou qualquer mensagem que não contenha um pedido claro de nova consulta. " +
    "Nunca repita consultas de mensagens anteriores. Nunca invente dados. " +
    "Suas respostas podem ser lidas em voz alta — seja conciso, use frases naturais e evite listas muito longas.";

  const cleanMessages = messages.filter(
    (m: { role?: string; content?: string }) => m && typeof m.content === "string"
  );

  type AnyMsg = Record<string, unknown>;
  let finalMessages: AnyMsg[] = [
    { role: "system", content: systemPrompt },
    ...cleanMessages,
  ];

  try {
    const phase1Resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        stream: false,
        messages: finalMessages,
        tools: [CONSULTA_TOOL],
        tool_choice: "auto",
        max_tokens: 200,
      }),
    });

    if (phase1Resp.ok) {
      type ToolCall = { id: string; function: { name: string; arguments: string } };
      type Phase1Choice = { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } };
      const phase1Data = await phase1Resp.json() as { choices?: Phase1Choice[] };
      const choice = phase1Data.choices?.[0];

      if (choice?.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        const toolCall = choice.message.tool_calls[0];
        let args: { tipo?: string; dados?: string } = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch {}
        const tipo = String(args.tipo ?? "");
        const dados = String(args.dados ?? "");

        if (tipo && dados) {
          res.write(`data: ${JSON.stringify({ status: `🔍 Consultando ${tipo.toUpperCase()}: ${dados}...` })}\n\n`);
          const consultResult = await callProvider(tipo, dados, new AbortController().signal);
          let toolContent = "";
          if (consultResult.ok && consultResult.parsed) {
            const p = consultResult.parsed;
            const lines: string[] = [];
            p.fields.forEach((f) => lines.push(`${f.key}: ${f.value}`));
            p.sections.forEach((s) => {
              lines.push(`\n${s.name} (${s.items.length} registros):`);
              s.items.slice(0, 10).forEach((it) => lines.push(`  • ${it}`));
            });
            toolContent = lines.join("\n") || p.raw.slice(0, 800);
          } else {
            toolContent = `Sem resultado: ${consultResult.error ?? "dado não encontrado"}`;
          }
          finalMessages = [
            { role: "system", content: systemPrompt },
            ...cleanMessages,
            { role: "assistant", content: null, tool_calls: [toolCall] },
            { role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: toolContent },
          ];
        }
      }
    }
  } catch { /* phase 1 failed — fall through to normal streaming */ }

  await streamGroq(apiKey, finalMessages, res);
});

// ─── External scraper routes ───────────────────────────────────────────────
const INTERNAL_KEY = "infinity-bot";

function requireAuthOrInternal(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const internalKey = req.headers["x-internal-key"];
  if (internalKey === INTERNAL_KEY) { next(); return; }
  requireAuth(req, res, next);
}

router.post("/external/:source", requireAuthOrInternal, async (req, res) => {
  const source = req.params.source as "sipni" | "sisreg";
  if (source !== "sipni" && source !== "sisreg") {
    res.status(400).json({ success: false, error: "Fonte inválida. Use 'sipni' ou 'sisreg'." });
    return;
  }

  const { tipo, dados } = req.body as { tipo?: string; dados?: string };
  if (!tipo || !dados) {
    res.status(400).json({ success: false, error: "Parâmetros 'tipo' e 'dados' são obrigatórios." });
    return;
  }

  const dadosStr = String(dados).trim();
  if (!dadosStr) {
    res.status(400).json({ success: false, error: "Dados não podem estar vazios." });
    return;
  }

  try {
    let result: { success: boolean; data?: string; error?: string };

    if (source === "sipni") {
      const { sipniSearch } = await import("../scrapers/sipni.js");
      const tipoSipni = (["cpf", "nome", "cns"].includes(tipo) ? tipo : "cpf") as "cpf" | "nome" | "cns";
      result = await sipniSearch(tipoSipni, dadosStr);
    } else {
      const { sisregSearch } = await import("../scrapers/sisreg.js");
      const tipoSisreg = (["cpf", "nome"].includes(tipo) ? tipo : "cpf") as "cpf" | "nome";
      result = await sisregSearch(tipoSisreg, dadosStr);
    }

    const username = (req as unknown as { user?: { username?: string } }).user?.username ?? "bot";
    await logConsulta({
      tipo: `${source}:${tipo}`,
      query: dadosStr,
      username,
      success: result.success,
      result: { source, data: result.data?.slice(0, 2000) },
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "External scraper error");
    res.status(500).json({ success: false, error: "Erro interno ao consultar fonte externa." });
  }
});

// ─── Panel PIN session auth ─────────────────────────────────────────────────
// The PIN is stored only in the PANEL_PIN env var (server-side only, never sent to browser).
// The frontend exchanges the PIN for a short-lived in-memory session token.
// This means VITE_PANEL_SECRET is removed completely — nothing sensitive in the JS bundle.

const PANEL_PIN = process.env.PANEL_PIN ?? "";
const PANEL_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const panelSessions = new Map<string, { expiresAt: number }>();

function cleanPanelSessions(): void {
  const now = Date.now();
  for (const [token, s] of panelSessions.entries()) {
    if (s.expiresAt < now) panelSessions.delete(token);
  }
}

function requirePanelToken(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  const header = String(req.headers["x-panel-token"] ?? "");
  if (!header) { res.status(403).json({ error: "Acesso negado." }); return; }
  const session = panelSessions.get(header);
  if (!session || session.expiresAt < Date.now()) {
    panelSessions.delete(header);
    res.status(403).json({ error: "Sessão expirada. Autentique novamente.", expired: true });
    return;
  }
  next();
}

// POST /api/infinity/panel/auth  — exchange PIN for a session token
router.post("/panel/auth", panelAuthLimiter, (req, res) => {
  if (!PANEL_PIN) {
    res.status(503).json({ error: "PIN do painel não configurado no servidor." });
    return;
  }
  const { pin } = req.body ?? {};
  if (!pin || String(pin) !== PANEL_PIN) {
    res.status(403).json({ error: "PIN incorreto." });
    return;
  }
  cleanPanelSessions();
  const token = crypto.randomBytes(32).toString("hex");
  panelSessions.set(token, { expiresAt: Date.now() + PANEL_SESSION_TTL_MS });
  res.json({ token, expiresIn: PANEL_SESSION_TTL_MS / 1000 });
});

// GET /api/infinity/panel/verify — check if a panel session token is still valid
router.get("/panel/verify", (req, res) => {
  const header = String(req.headers["x-panel-token"] ?? "");
  const session = panelSessions.get(header);
  if (!session || session.expiresAt < Date.now()) {
    res.status(403).json({ valid: false });
    return;
  }
  res.json({ valid: true, expiresAt: new Date(session.expiresAt).toISOString() });
});

router.get("/panel/users", requirePanelToken, async (_req, res) => {
  const rows = await db.select().from(infinityUsersTable).orderBy(desc(infinityUsersTable.createdAt));
  res.json(rows.map(serializeUser));
});

router.post("/panel/users", requirePanelToken, async (req, res) => {
  const { username, password, role, expiresInDays } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ error: "username, password e role obrigatórios" });
    return;
  }
  const validRoles = ["admin", "vip", "user"];
  const finalRole = validRoles.includes(role) ? role : "vip";
  const passwordHash = await bcrypt.hash(String(password), 10);
  const accountExpiresAt =
    expiresInDays && Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
      : null;
  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole, accountExpiresAt })
      .returning();
    res.status(201).json(serializeUser(created));
  } catch {
    res.status(400).json({ error: "Usuário já existe ou dados inválidos" });
  }
});

router.delete("/panel/users/:username", requirePanelToken, async (req, res) => {
  await db.delete(infinityUsersTable).where(eq(infinityUsersTable.username, String(req.params.username)));
  res.status(204).end();
});

router.patch("/panel/users/:username", requirePanelToken, async (req, res) => {
  const { action, expiresInDays } = req.body ?? {};
  let accountExpiresAt: Date | null;
  if (action === "revoke") {
    accountExpiresAt = new Date(Date.now() - 1000);
  } else if (action === "restore") {
    accountExpiresAt = null;
  } else {
    accountExpiresAt = Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
      : null;
  }
  const [updated] = await db
    .update(infinityUsersTable)
    .set({ accountExpiresAt })
    .where(eq(infinityUsersTable.username, String(req.params.username)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(serializeUser(updated));
});

export default router;

