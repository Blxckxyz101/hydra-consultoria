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

const SKYLERS_BASE = "http://23.81.118.36:7070";
const SKYLERS_TOKEN = process.env.SKYLERS_TOKEN ?? "SQJeVAFAnPGHQWY3XbQVcdHlmrz8xe2pkAXtwGq4Jdk";

// ─── Notifications store ─────────────────────────────────────────────────────
interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  authorName: string;
}
const notifications: Notification[] = [];

// ─── Theme store ────────────────────────────────────────────────────────────
let globalTheme = "sky";
const THEME_COLOR_HEX: Record<string, number> = {
  sky: 0x38BDF8, violeta: 0xA78BFA, esmeralda: 0x34D399, ambar: 0xFBBF24,
  rosa: 0xF472B6, vermelho: 0xF87171, indigo: 0x818CF8, laranja: 0xFB923C,
  lima: 0xA3E635, coral: 0xFB7185, ciano: 0x22D3EE, roxo: 0xC084FC,
};
const THEME_EMOJI: Record<string, string> = {
  sky: "🌊", violeta: "🟣", esmeralda: "💚", ambar: "✨",
  rosa: "🌸", vermelho: "🔴", indigo: "🌌", laranja: "🔥",
  lima: "⚡", coral: "🪸", ciano: "🧊", roxo: "💜",
};
const THEME_HSL: Record<string, string> = {
  sky: "195 90% 55%", violeta: "270 80% 65%", esmeralda: "160 70% 50%", ambar: "38 95% 58%",
  rosa: "330 90% 65%", vermelho: "0 84% 60%", indigo: "240 80% 65%", laranja: "20 95% 60%",
  lima: "80 80% 55%", coral: "15 90% 65%", ciano: "185 100% 45%", roxo: "290 85% 65%",
};

const TIPO_TO_SKYLERS: Record<string, string> = {
  // ── tipos comuns (Geass + Skylers) ──────────────────────────────────────
  cpf: "iseek-cpf",
  nome: "iseek-dados---nomeabreviadofiltros",
  rg: "iseek-dados---rg",
  mae: "iseek-dados---mae",
  pai: "iseek-dados---pai",
  parentes: "iseek-dados---parentes",
  obito: "iseek-dados---obito",
  nis: "iseek-dados---nis",
  cns: "iseek-cpf",
  vacinas: "iseek-dados---vacinas",
  telefone: "iseek-dados---telefone",
  email: "iseek-dados---email",
  pix: "iseek-dados---pix",
  cep: "iseek-dados---cep",
  placa: "iseek-dados---placa",
  chassi: "iseek-dados---chassi",
  renavam: "iseek-dados---renavam",
  motor: "iseek-dados---motor",
  cnh: "iseek-dados---cnh",
  frota: "iseek-dados---veiculos",
  cnpj: "iseek-dados---cnpj",
  fucionarios: "iseek-dados---func",
  socios: "iseek-dados---cnpj",
  empregos: "iseek-dados---rais",
  // ── tipos exclusivos Skylers ─────────────────────────────────────────────
  cpfbasico: "iseek-cpfbasico",
  titulo: "iseek-dados---titulo",
  score: "iseek-dados---score",
  irpf: "iseek-dados---irpf",
  beneficios: "iseek-dados---beneficios",
  mandado: "iseek-dados---mandado",
  dividas: "iseek-dados---dividas",
  bens: "iseek-dados---bens",
  processos: "iseek-dados---processos",
  spc: "cpf-spc",
  iptu: "iseek-dados---iptu",
  certidoes: "iseek-dados---certidoes",
  cnhfull: "cnh-full",
  foto: "iseek-fotos---fotocnh",
  biometria: "iseek-fotos---biometria",
  credilink: "credilink",
};

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
  // Skylers-only (validated separately via /external/skylers)
  "cpfbasico", "titulo", "score", "irpf", "beneficios", "mandado",
  "dividas", "bens", "processos", "spc", "iptu", "certidoes", "cnhfull", "foto", "biometria", "credilink",
]);

const onlyDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

function serializeUser(row: { username: string; role: string; createdAt: Date; lastLoginAt: Date | null; accountExpiresAt?: Date | null; queryDailyLimit?: number | null }) {
  return {
    username: row.username,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    accountExpiresAt: row.accountExpiresAt ? row.accountExpiresAt.toISOString() : null,
    queryDailyLimit: row.queryDailyLimit ?? null,
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

  // ── 1. Map every section header so we know exact boundaries ─────────────
  // Pattern: "SECTION NAME: ( N - Encontrados)"
  // Note: no digits allowed in section name to avoid "CORSA SEDAN 2003 ENDERECOS" false match
  const SEC_HDR_FULL = /([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Za-z ]{3,}):\s*\(\s*(\d+)\s*-\s*Encontrados?\s*\)/g;
  const secBounds: Array<{ name: string; count: number; start: number; headerEnd: number }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = SEC_HDR_FULL.exec(raw)) !== null) {
    secBounds.push({
      name: sm[1].trim().toUpperCase(),
      count: parseInt(sm[2]),
      start: sm.index,
      headerEnd: sm.index + sm[0].length,
    });
  }

  // ── 2. Parse fields (text before the first section header) ──────────────
  const fieldsEnd = secBounds.length > 0 ? secBounds[0].start : raw.length;
  const fieldsRaw = raw.slice(0, fieldsEnd);

  if (fieldsRaw.includes("\u23AF")) {
    const parts = fieldsRaw.split(SEP);
    const firstEx = extractTrailingKey(parts[0]);
    let curKey = firstEx.key || parts[0].trim();

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        // Strip any trailing ⎯ left by the slice boundary, then skip if it's just a key name
        const val = part.trim().replace(/\s*\u23AF\s*$/, "").replace(/\s+/g, " ").trim();
        if (curKey && val && !PURE_KEY_RE.test(val)) {
          result.fields.push({ key: curKey, value: val });
        }
        break;
      }
      const { value, key: nextKey } = extractTrailingKey(part);
      const cleanVal = value.replace(/\s+/g, " ");
      if (curKey && cleanVal) result.fields.push({ key: curKey, value: cleanVal });
      curKey = nextKey;
    }
  }

  // ── 3. Parse each section using its exact content range ─────────────────
  for (let si = 0; si < secBounds.length; si++) {
    const sb = secBounds[si];
    if (sb.count === 0) continue; // skip empty sections

    const contentEnd = si + 1 < secBounds.length ? secBounds[si + 1].start : raw.length;
    const content = raw.slice(sb.headerEnd, contentEnd).trim();
    if (!content) continue;

    const items: string[] = [];

    if (content.includes("•")) {
      // Bullet-delimited items: TELEFONES, ENDERECOS, VEICULOS, EMAILS, etc.
      content.split("•").slice(1).forEach((b) => {
        const item = b
          .trim()
          .replace(/\s+/g, " ")
          // Strip trailing orphan dash/hyphen left when WhatsApp status is empty
          .replace(/\s+[-–]\s*$/, "")
          .trim();
        // Drop items with Python "None" literal or that are blank
        if (item && !/\bNone\b/.test(item)) items.push(item);
      });
    } else if (content.includes("\u23AF")) {
      // ⎯-delimited pairs: PARENTES, EMPREGOS, BANCOS…
      // Format inside section is KEY ⎯ VALUE ⎯ KEY ⎯ VALUE ⎯ (trailing sep possible)
      const subParts = content
        .replace(/\s*\u23AF\s*$/, "") // strip trailing ⎯
        .split(SEP)
        .map((s) => s.trim())
        .filter(Boolean);
      // Treat as consecutive key → value pairs
      for (let j = 0; j + 1 < subParts.length; j += 2) {
        const k = subParts[j];
        const v = subParts[j + 1];
        if (k && v) items.push(`${k}: ${v}`);
        else if (k) items.push(k);
      }
      // Odd remainder (trailing key with no value)
      if (subParts.length % 2 === 1) {
        const last = subParts[subParts.length - 1];
        if (last) items.push(last);
      }
    } else {
      const plain = content.replace(/\s+/g, " ");
      if (plain) items.push(plain);
    }

    if (items.length > 0) {
      result.sections.push({ name: sb.name, items });
    }
  }

  // ── 4. INTERESSES PESSOAIS — special "- Key: Value" format ──────────────
  // Not captured by SEC_HDR_FULL (no "Encontrados" counter)
  const intIdx = raw.indexOf("INTERESSES PESSOAIS:");
  if (intIdx !== -1) {
    const intContent = raw.slice(intIdx + "INTERESSES PESSOAIS:".length);
    const intItems = intContent
      .split(/\s*-\s+/)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter((s) => s.includes(":"));
    const simItems = intItems.filter((s) => /:\s*Sim\b/i.test(s));
    const show = simItems.length > 0 ? simItems : intItems.slice(0, 10);
    if (show.length > 0) {
      result.sections.push({ name: "INTERESSES PESSOAIS", items: show });
    }
  }

  // ── 5. Strip known template / junk field values from the API ────────────
  // e.g. RENDA = "R$" (no income), TITULO ELEITOR = "ZONA: SECAO:" (unfilled)
  result.fields = result.fields.filter(({ value }) => {
    const v = value.trim();
    if (!v) return false;
    if (/^R\$\s*$/.test(v)) return false;           // empty income
    if (/^ZONA:\s*SECAO:\s*$/.test(v)) return false; // empty titulo eleitor
    if (/^None$/.test(v)) return false;              // Python None literal
    return true;
  });

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

// ─── BrasilAPI fallback (CNPJ) ─────────────────────────────────────────────
interface BrasilApiCnpjResponse {
  cnpj?: string; razao_social?: string; nome_fantasia?: string;
  descricao_situacao_cadastral?: string; descricao_tipo_de_logradouro?: string;
  logradouro?: string; numero?: string; complemento?: string; bairro?: string;
  municipio?: string; uf?: string; cep?: string; ddd_telefone_1?: string;
  ddd_telefone_2?: string; email?: string; porte?: string;
  descricao_porte?: string; natureza_juridica?: string;
  capital_social?: number; data_inicio_atividade?: string;
  cnae_fiscal_descricao?: string; data_situacao_cadastral?: string;
  qsa?: Array<{
    nome_socio?: string; qualificacao_socio?: string;
    faixa_etaria?: string; data_entrada_sociedade?: string;
  }>;
}

async function callBrasilApiCnpj(cnpj: string, signal: AbortSignal): Promise<{
  ok: boolean; parsed?: Parsed; error?: string;
}> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal,
      headers: { "Accept": "application/json", "User-Agent": "InfinitySearch/1.0" },
    });
    if (!r.ok) return { ok: false, error: `BrasilAPI HTTP ${r.status}` };
    const d = await r.json() as BrasilApiCnpjResponse;
    if (!d.cnpj && !d.razao_social) return { ok: false, error: "BrasilAPI: sem dados" };

    const fields: Parsed["fields"] = [];
    const add = (k: string, v: string | number | undefined | null) => {
      const s = String(v ?? "").trim(); if (s && s !== "0") fields.push({ key: k, value: s });
    };
    add("CNPJ",              d.cnpj);
    add("Razão Social",      d.razao_social);
    add("Nome Fantasia",     d.nome_fantasia);
    add("Situação",          d.descricao_situacao_cadastral);
    add("Situação desde",    d.data_situacao_cadastral);
    add("Início Atividade",  d.data_inicio_atividade);
    add("Porte",             d.descricao_porte ?? d.porte);
    add("Nat. Jurídica",     d.natureza_juridica);
    add("Capital Social",    d.capital_social ? `R$ ${Number(d.capital_social).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : undefined);
    add("Atividade Principal", d.cnae_fiscal_descricao);
    const logr = [d.descricao_tipo_de_logradouro, d.logradouro, d.numero].filter(Boolean).join(" ");
    add("Logradouro",        logr);
    add("Complemento",       d.complemento);
    add("Bairro",            d.bairro);
    add("Município",         d.municipio);
    add("UF",                d.uf);
    add("CEP",               d.cep);
    add("Telefone",          d.ddd_telefone_1);
    add("Telefone 2",        d.ddd_telefone_2);
    add("E-mail",            d.email);

    const sections: Parsed["sections"] = [];
    if (d.qsa?.length) {
      sections.push({
        name: "QUADRO SOCIETÁRIO (QSA)",
        items: d.qsa.map((s) =>
          [s.nome_socio, s.qualificacao_socio, s.faixa_etaria, s.data_entrada_sociedade ? `Entrada: ${s.data_entrada_sociedade}` : ""]
            .filter(Boolean).join(" · ")
        ),
      });
    }

    const parsed: Parsed = {
      fields,
      sections,
      raw: `[BrasilAPI] CNPJ: ${d.cnpj ?? cnpj} · ${d.razao_social} · ${d.descricao_situacao_cadastral}`,
    };
    return { ok: fields.length > 0, parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro BrasilAPI" };
  }
}

// ─── Skylers API ────────────────────────────────────────────────────────────
// Values that are always useless to display
const JUNK_VALUES = new Set(["None", "null", "undefined", "N/A", "n/a", "-", "", "0"]);
const JUNK_KEYS_SKYLERS = new Set(["status", "token", "criador", "creditos", "creditos_restantes", "api_info", "mensagem"]);
const PHOTO_URL_RE = /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;

function isUseful(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s.length > 0 && !JUNK_VALUES.has(s);
}

function humanizeKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenObjToItems(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([, sv]) => isUseful(sv) && typeof sv !== "object")
    .map(([sk, sv]) => `${humanizeKey(sk)}: ${sv}`);
}

function parseSkylers(data: unknown): Parsed {
  const raw = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const result: Parsed = { fields: [], sections: [], raw };

  if (!data) return result;

  // ── Top-level array ────────────────────────────────────────────────────────
  if (Array.isArray(data)) {
    if (data.length === 0) return result;
    const items = (data as unknown[]).map((item) => {
      if (item && typeof item === "object") {
        const entries = flattenObjToItems(item as Record<string, unknown>);
        return entries.join(" · ");
      }
      return isUseful(item) ? String(item) : "";
    }).filter(Boolean);
    if (items.length > 0) result.sections.push({ name: "RESULTADOS", items });
    return result;
  }

  if (typeof data !== "object") {
    if (isUseful(data)) result.fields.push({ key: "Resultado", value: String(data) });
    return result;
  }

  const d = data as Record<string, unknown>;

  // ── Unwrap common OSINT API response wrappers ─────────────────────────────
  const wrappers = ["data", "result", "resposta", "response", "content", "retorno", "dados"];
  for (const w of wrappers) {
    if (d[w] && typeof d[w] === "object" && !Array.isArray(d[w])) {
      const inner = parseSkylers(d[w]);
      if (inner.fields.length > 0 || inner.sections.length > 0) return { ...inner, raw };
    }
    if (Array.isArray(d[w]) && (d[w] as unknown[]).length > 0) {
      return { ...parseSkylers(d[w]), raw };
    }
  }

  // ── Flatten object → fields and sections ──────────────────────────────────
  for (const [k, v] of Object.entries(d)) {
    if (JUNK_KEYS_SKYLERS.has(k.toLowerCase())) continue;
    if (!isUseful(v) && !Array.isArray(v) && typeof v !== "object") continue;

    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      const items = v.map((item) => {
        if (item && typeof item === "object") {
          const entries = flattenObjToItems(item as Record<string, unknown>);
          return entries.join(" · ");
        }
        return isUseful(item) ? String(item) : "";
      }).filter(Boolean);
      if (items.length > 0) result.sections.push({ name: k.toUpperCase().replace(/_/g, " "), items });

    } else if (typeof v === "object" && v !== null) {
      const sub = v as Record<string, unknown>;
      const subEntries = Object.entries(sub).filter(([, sv]) => isUseful(sv) && typeof sv !== "object");
      if (subEntries.length === 0) continue;
      // Small sub-objects (≤3 fields) are merged into main fields for readability
      if (subEntries.length <= 3) {
        for (const [sk, sv] of subEntries) {
          result.fields.push({ key: `${humanizeKey(k)} · ${humanizeKey(sk)}`, value: String(sv) });
        }
      } else {
        const items = subEntries.map(([sk, sv]) => `${humanizeKey(sk)}: ${sv}`);
        result.sections.push({ name: k.toUpperCase().replace(/_/g, " "), items });
      }

    } else {
      const s = String(v).trim();
      if (s && !JUNK_VALUES.has(s)) {
        result.fields.push({ key: humanizeKey(k), value: s });
      }
    }
  }

  // ── Detect photo URLs in any field → promote to FOTO_URL ──────────────────
  if (!result.fields.some((f) => f.key === "FOTO_URL")) {
    for (const f of result.fields) {
      if (PHOTO_URL_RE.test(f.value.trim())) {
        result.fields.push({ key: "FOTO_URL", value: f.value.trim() });
        break;
      }
    }
    // Also check section items
    if (!result.fields.some((f) => f.key === "FOTO_URL")) {
      outer: for (const sec of result.sections) {
        for (const item of sec.items) {
          const urlMatch = item.match(/(https?:\/\/\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?)/i);
          if (urlMatch) {
            result.fields.push({ key: "FOTO_URL", value: urlMatch[1] });
            break outer;
          }
        }
      }
    }
  }

  return result;
}

async function callSkylers(
  modulo: string,
  valor: string,
  signal: AbortSignal,
  endpoint?: "likes" | "telegram",
): Promise<{ ok: boolean; parsed?: Parsed; error?: string; raw?: unknown }> {
  try {
    let url: string;
    if (endpoint === "likes") {
      url = `${SKYLERS_BASE}/likes?token=${SKYLERS_TOKEN}&id=${encodeURIComponent(valor)}&region=BR`;
    } else if (endpoint === "telegram") {
      url = `${SKYLERS_BASE}/telegram?token=${SKYLERS_TOKEN}&user=${encodeURIComponent(valor)}`;
    } else {
      url = `${SKYLERS_BASE}/consulta?token=${SKYLERS_TOKEN}&modulo=${encodeURIComponent(modulo)}&valor=${encodeURIComponent(valor)}`;
    }

    const r = await fetch(url, { signal });
    const text = await r.text();

    if (!r.ok) {
      return { ok: false, error: `Skylers HTTP ${r.status}`, raw: text.slice(0, 500) };
    }

    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    // Check for error responses
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const dj = json as Record<string, unknown>;
      const isErr = dj.error || (dj.status && String(dj.status).toLowerCase() === "error") ||
        (dj.message && String(dj.message).toLowerCase().includes("error"));
      if (isErr) {
        return { ok: false, error: String(dj.message ?? dj.error ?? dj.detail ?? "Sem resultado"), raw: json };
      }
    }

    const parsed = parseSkylers(json);
    if (parsed.fields.length === 0 && parsed.sections.length === 0) {
      return { ok: false, error: "Sem dados retornados para esta consulta", parsed };
    }
    return { ok: true, parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro de rede";
    return { ok: false, error: msg };
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

// ─── helpers ───────────────────────────────────────────────────────────────
async function getUsersWithStats() {
  const rows = await db.select().from(infinityUsersTable).orderBy(desc(infinityUsersTable.createdAt));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const stats = await db
    .select({
      username: infinityConsultasTable.username,
      total:    sql<number>`count(*)::int`,
      hoje:     sql<number>`count(*) filter (where ${infinityConsultasTable.createdAt} >= ${today})::int`,
      semana:   sql<number>`count(*) filter (where ${infinityConsultasTable.createdAt} >= ${weekAgo})::int`,
    })
    .from(infinityConsultasTable)
    .groupBy(infinityConsultasTable.username);
  const statsMap = new Map(stats.map(s => [s.username, s]));
  return rows.map(row => ({
    ...serializeUser(row),
    totalConsultas:   statsMap.get(row.username)?.total   ?? 0,
    consultasHoje:    statsMap.get(row.username)?.hoje    ?? 0,
    consultasSemana:  statsMap.get(row.username)?.semana  ?? 0,
  }));
}

// ─── users (admin) ─────────────────────────────────────────────────────────
router.get("/users", requireAdmin, async (_req, res) => {
  res.json(await getUsersWithStats());
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, password, role, expiresInDays, expiresAt, queryDailyLimit } = req.body ?? {};
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

  const queryDailyLimitVal = queryDailyLimit !== undefined && queryDailyLimit !== null && queryDailyLimit !== ""
    ? Number(queryDailyLimit) || null
    : null;

  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole, accountExpiresAt, queryDailyLimit: queryDailyLimitVal })
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
  const { action, expiresInDays, expiresAt, queryDailyLimit, role, password } = req.body ?? {};

  const updateData: Partial<{
    accountExpiresAt: Date | null;
    queryDailyLimit: number | null;
    role: string;
    passwordHash: string;
  }> = {};

  if (action === "revoke") {
    updateData.accountExpiresAt = new Date(Date.now() - 1000);
  } else if (action === "restore") {
    updateData.accountExpiresAt = null;
  } else if (expiresAt !== undefined) {
    updateData.accountExpiresAt = expiresAt ? new Date(expiresAt) : null;
  } else if (expiresInDays !== undefined) {
    updateData.accountExpiresAt = Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
      : null;
  }

  if (queryDailyLimit !== undefined) {
    updateData.queryDailyLimit = queryDailyLimit === null || queryDailyLimit === "" || Number(queryDailyLimit) <= 0
      ? null
      : Number(queryDailyLimit);
  }

  if (role && ["admin", "vip", "user"].includes(String(role))) {
    updateData.role = String(role);
  }

  if (password && String(password).length >= 6) {
    updateData.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Nenhum campo para atualizar." });
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
  const username = req.infinityUser!.username;

  // ── Stats filtered to the current user ────────────────────────────────
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(eq(infinityConsultasTable.username, username));

  const [{ hoje }] = await db
    .select({ hoje: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      gte(infinityConsultasTable.createdAt, startOfDay),
    ));

  const [{ semana }] = await db
    .select({ semana: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      gte(infinityConsultasTable.createdAt, weekAgo),
    ));

  const [{ usuarios }] = await db
    .select({ usuarios: sql<number>`count(*)::int` })
    .from(infinityUsersTable);

  const porTipo = await db
    .select({
      tipo: infinityConsultasTable.tipo,
      count: sql<number>`count(*)::int`,
    })
    .from(infinityConsultasTable)
    .where(eq(infinityConsultasTable.username, username))
    .groupBy(infinityConsultasTable.tipo);

  // Operator ranking (all time) — global, used for leaderboard card
  const porOperador = await db
    .select({
      username: infinityConsultasTable.username,
      count: sql<number>`count(*)::int`,
    })
    .from(infinityConsultasTable)
    .groupBy(infinityConsultasTable.username)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(10);

  // Global daily count (for platform-wide rate limit display)
  const [{ todayTotal }] = await db
    .select({ todayTotal: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(gte(infinityConsultasTable.createdAt, startOfDay));

  // Recent activity filtered to the current user
  const recentes = await db
    .select()
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      gte(infinityConsultasTable.createdAt, periodStart),
    ))
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
      result: r.result ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─── bases status ──────────────────────────────────────────────────────────
router.get("/bases/status", requireAuth, async (_req, res) => {
  const bases = [
    { id: "geass",    name: "Geass API",    description: "Provedor OSINT principal · 24 tipos",                url: PROVIDER_BASE.replace("/api/consulta", "/") },
    { id: "skylers",  name: "Skylers API",  description: "Provedor OSINT avançado · 80+ módulos + Foto CNH",   url: `${SKYLERS_BASE}/token/info?token=${SKYLERS_TOKEN}` },
    { id: "viacep",    name: "ViaCEP",      description: "Consulta de endereços por CEP · fallback CEP",        url: "https://viacep.com.br/ws/01001000/json/" },
    { id: "receitaws", name: "ReceitaWS",   description: "CNPJ via Receita Federal · fallback CNPJ primário",  url: "https://www.receitaws.com.br/v1/cnpj/11222333000181" },
    { id: "brasilapi", name: "BrasilAPI",   description: "CNPJ público com QSA · fallback CNPJ secundário",    url: "https://brasilapi.com.br/api/cnpj/v1/00360305000104" },
    { id: "cnpjws",    name: "CNPJ.ws",     description: "Consulta pública de CNPJ · fallback CNPJ terciário", url: "https://publica.cnpj.ws/v1/" },
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

// ─── Skylers route ─────────────────────────────────────────────────────────
router.post("/skylers", requireAuth, consultaLimiter, async (req, res) => {
  const { modulo, valor, endpoint } = req.body ?? {};

  if (!valor) {
    res.status(400).json({ success: false, error: "valor é obrigatório" });
    return;
  }

  const ep = endpoint as "likes" | "telegram" | undefined;
  if (!ep && !modulo) {
    res.status(400).json({ success: false, error: "modulo é obrigatório" });
    return;
  }

  const username = req.infinityUser!.username;
  const [globalCount, userCount] = await Promise.all([
    getGlobalDailyCount(),
    getUserDailyCount(username),
  ]);

  if (globalCount >= DAILY_RATE_LIMIT) {
    res.status(429).json({
      success: false,
      error: `Limite diário de ${DAILY_RATE_LIMIT} consultas atingido.`,
      rateLimited: true,
    });
    return;
  }

  const userLimit = req.infinityUser!.queryDailyLimit ?? PER_USER_DAILY_LIMIT;
  if (userCount >= userLimit) {
    res.status(429).json({
      success: false,
      error: `Limite diário de ${userLimit} consultas atingido. Tente novamente amanhã.`,
      rateLimited: true,
      limitInfo: { used: userCount, limit: userLimit },
    });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);

  const provider = await callSkylers(
    String(modulo ?? ""),
    String(valor).trim(),
    ctrl.signal,
    ep,
  );
  clearTimeout(timer);

  const success = provider.ok && !!provider.parsed;
  const data = provider.parsed ?? { fields: [], sections: [], raw: "" };
  const tipoLog = `skylers:${ep ?? modulo ?? "unknown"}`;

  bumpCaches(username);
  await logConsulta({ tipo: tipoLog, query: String(valor).trim(), username, success, result: data });

  res.json({ success, data, error: provider.error ?? null });
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
  const userLimit = req.infinityUser!.queryDailyLimit ?? PER_USER_DAILY_LIMIT;
  if (userCount >= userLimit) {
    res.status(429).json({
      error: `Seu limite diário de ${userLimit} consultas foi atingido. Tente novamente amanhã.`,
      rateLimited: true,
      limitInfo: { used: userCount, limit: userLimit },
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

  // ─── CNPJ fallback: ReceitaWS → BrasilAPI → CNPJ.ws ─────────────────────
  if (!provider.ok && (tipo === "cnpj" || tipo === "fucionarios" || tipo === "socios") && !ctrl.signal.aborted) {
    const receita = await callReceitaWs(dados, ctrl.signal);
    if (receita.ok) {
      provider = { ok: true, parsed: receita.parsed };
    } else if (!ctrl.signal.aborted) {
      const brasilapi = await callBrasilApiCnpj(dados, ctrl.signal);
      if (brasilapi.ok) {
        provider = { ok: true, parsed: brasilapi.parsed };
      } else if (!ctrl.signal.aborted) {
        const cnpjws = await callCnpjWs(dados, ctrl.signal);
        if (cnpjws.ok) provider = { ok: true, parsed: cnpjws.parsed };
        else provider = { ...provider, error: `Geass: ${provider.error} | ReceitaWS: ${receita.error} | BrasilAPI: ${brasilapi.error} | CNPJ.ws: ${cnpjws.error}` };
      }
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
      "Executa uma consulta OSINT no Infinity Search. Use quando o usuário pedir para buscar/consultar CPF, CNPJ, telefone, placa, nome, foto CNH, score, benefícios, dívidas, IRPF, título de eleitor, processos, etc.",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [
            "cpf", "cpfbasico", "nome", "rg", "mae", "pai", "parentes", "obito",
            "placa", "chassi", "telefone", "pix", "nis", "cns",
            "cep", "frota", "cnpj", "fucionarios", "socios", "empregos",
            "cnh", "cnhfull", "renavam", "motor", "vacinas", "email",
            "titulo", "score", "irpf", "beneficios", "mandado",
            "dividas", "bens", "processos", "spc", "iptu", "certidoes",
            "foto",
          ],
          description:
            "Tipo de consulta OSINT. " +
            "Use 'foto' para foto da CNH pelo CPF (Skylers). " +
            "Use 'score' para score de crédito. " +
            "Use 'irpf' para declaração de imposto de renda. " +
            "Use 'beneficios' para Bolsa Família/BPC. " +
            "Use 'dividas' para dívidas BACEN/FGTS. " +
            "Use 'titulo' para título de eleitor. " +
            "Tipos exclusivos Skylers: titulo, score, irpf, beneficios, mandado, dividas, bens, processos, spc, iptu, certidoes, cnhfull, foto, cpfbasico.",
        },
        dados: { type: "string", description: "O dado a ser consultado (CPF, placa, nome, CNPJ, etc.)" },
        base: {
          type: "string",
          enum: ["geass", "skylers"],
          description: "Base de dados. Para tipos exclusivos Skylers, a base é definida automaticamente. Para tipos comuns, use 'skylers' para consultar na Skylers API.",
        },
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
    "Use a ferramenta consultar_infinity SOMENTE quando a mensagem ATUAL do usuário pedir EXPLICITAMENTE uma nova busca/consulta de um dado específico (CPF, CNPJ, telefone, placa, e-mail, foto de CNH, score, benefícios, dívidas, etc.). " +
    "NÃO use a ferramenta em resposta a: agradecimentos, saudações, perguntas sobre resultados anteriores, confirmações ou qualquer mensagem que não contenha um pedido claro de nova consulta. " +
    "Nunca repita consultas de mensagens anteriores. Nunca invente dados. " +
    "IMPORTANTE: quando uma foto CNH for encontrada (campo FOTO_URL ou URL de imagem), coloque a URL da imagem EXATAMENTE em uma linha separada, sozinha, sem nenhum outro texto na mesma linha. " +
    "Exemplo correto de resposta com foto:\nEncontrei a foto CNH:\n\nhttps://url-da-foto.jpg\n\nCPF consultado: 12345678901. " +
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
          const SKYLERS_ONLY_AI = new Set(["titulo", "score", "irpf", "beneficios", "mandado", "dividas", "bens", "processos", "spc", "iptu", "certidoes", "cnhfull", "foto", "biometria", "cpfbasico"]);
          const rawBase = String((args as { base?: string }).base ?? "geass");
          const base = SKYLERS_ONLY_AI.has(tipo) ? "skylers" : rawBase;
          res.write(`data: ${JSON.stringify({ status: `🔍 Consultando ${tipo.toUpperCase()}${base === "skylers" ? " via Skylers" : ""}…` })}\n\n`);
          let toolContent = "";

          if (base === "skylers") {
            const modulo = TIPO_TO_SKYLERS[tipo.toLowerCase()];
            if (modulo) {
              const sk = await callSkylers(modulo, dados, new AbortController().signal);
              if (sk.ok && sk.parsed) {
                const p = sk.parsed;
                const lines: string[] = [];
                p.fields.forEach((f) => lines.push(`${f.key}: ${f.value}`));
                p.sections.forEach((s) => {
                  lines.push(`\n${s.name} (${s.items.length} registros):`);
                  s.items.slice(0, 10).forEach((it) => lines.push(`  • ${it}`));
                });
                toolContent = lines.join("\n") || p.raw.slice(0, 800);
              } else {
                toolContent = `Sem resultado Skylers: ${sk.error ?? "dado não encontrado"}`;
              }
            } else {
              toolContent = `Tipo '${tipo}' não suportado pela Skylers API, usando base principal.`;
              const fallback = await callProvider(tipo, dados, new AbortController().signal);
              if (fallback.ok && fallback.parsed) {
                const p = fallback.parsed;
                const lines: string[] = [];
                p.fields.forEach((f) => lines.push(`${f.key}: ${f.value}`));
                toolContent = lines.join("\n") || p.raw.slice(0, 800);
              }
            }
          } else {
            const consultResult = await callProvider(tipo, dados, new AbortController().signal);
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
  const source = req.params.source as "skylers";
  if (source !== "skylers") {
    res.status(400).json({ success: false, error: "Fonte inválida." });
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

  // ── Skylers external proxy ───────────────────────────────────────────────
  if (source === "skylers") {
    const modulo = TIPO_TO_SKYLERS[tipo.toLowerCase()];
    if (!modulo) {
      res.json({ success: false, error: `Tipo '${tipo}' não mapeado na Skylers API.`, data: "" });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    const provider = await callSkylers(modulo, dadosStr, ctrl.signal);
    clearTimeout(timer);
    const success = provider.ok && !!provider.parsed;
    // Serialize parsed result as compact string for the base-selector "raw" display
    const rawText = provider.parsed?.raw ?? "";
    if (req.infinityUser) {
      bumpCaches(req.infinityUser.username);
      await logConsulta({
        tipo: `skylers:${modulo}`,
        query: dadosStr,
        username: req.infinityUser.username,
        success,
        result: provider.parsed ?? {},
      });
    }
    if (success) {
      res.json({ success: true, data: provider.parsed });
    } else {
      res.json({ success: false, error: provider.error ?? "Sem resultado", data: rawText });
    }
    return;
  }

  res.status(400).json({ success: false, error: "Fonte inválida." });
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
  res.json(await getUsersWithStats());
});

router.post("/panel/users", requirePanelToken, async (req, res) => {
  const { username, password, role, expiresInDays, queryDailyLimit } = req.body ?? {};
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
  const queryDailyLimitVal = queryDailyLimit !== undefined && queryDailyLimit !== null && queryDailyLimit !== ""
    ? Number(queryDailyLimit) || null
    : null;
  try {
    const [created] = await db
      .insert(infinityUsersTable)
      .values({ username: String(username), passwordHash, role: finalRole, accountExpiresAt, queryDailyLimit: queryDailyLimitVal })
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
  const { action, expiresInDays, queryDailyLimit, role, password } = req.body ?? {};

  const updateData: Partial<{
    accountExpiresAt: Date | null;
    queryDailyLimit: number | null;
    role: string;
    passwordHash: string;
  }> = {};

  if (action === "revoke") {
    updateData.accountExpiresAt = new Date(Date.now() - 1000);
  } else if (action === "restore") {
    updateData.accountExpiresAt = null;
  } else if (expiresInDays !== undefined) {
    updateData.accountExpiresAt = Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 86_400_000)
      : null;
  }

  if (queryDailyLimit !== undefined) {
    updateData.queryDailyLimit = queryDailyLimit === null || queryDailyLimit === "" || Number(queryDailyLimit) <= 0
      ? null
      : Number(queryDailyLimit);
  }

  if (role && ["admin", "vip", "user"].includes(String(role))) {
    updateData.role = String(role);
  }

  if (password && String(password).length >= 6) {
    updateData.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "Nenhum campo para atualizar." });
    return;
  }

  const [updated] = await db
    .update(infinityUsersTable)
    .set(updateData)
    .where(eq(infinityUsersTable.username, String(req.params.username)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(serializeUser(updated));
});

// ─── Theme endpoints ─────────────────────────────────────────────────────────
router.get("/theme", (_req, res) => {
  res.json({
    theme: globalTheme,
    color: THEME_COLOR_HEX[globalTheme] ?? 0x38BDF8,
    emoji: THEME_EMOJI[globalTheme] ?? "🌊",
    hsl: THEME_HSL[globalTheme] ?? "195 90% 55%",
  });
});

router.put("/theme", requireAuth, (req, res) => {
  const { theme } = req.body as { theme?: string };
  if (theme && THEME_COLOR_HEX[theme]) {
    globalTheme = theme;
  }
  res.json({
    ok: true,
    theme: globalTheme,
    color: THEME_COLOR_HEX[globalTheme] ?? 0x38BDF8,
    emoji: THEME_EMOJI[globalTheme] ?? "🌊",
  });
});

// ─── Notification endpoints ──────────────────────────────────────────────────
router.get("/notifications", requireAuth, (_req, res) => {
  res.json([...notifications].reverse());
});

router.post("/notifications", requireAuth, (req, res) => {
  const user = req.infinityUser;
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Apenas admins podem enviar novidades" }); return; }
  const { title, body } = req.body as { title?: string; body?: string };
  if (!title?.trim() || !body?.trim()) { res.status(400).json({ error: "Título e mensagem são obrigatórios" }); return; }
  const notif: Notification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title.trim().slice(0, 120),
    body: body.trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
    authorName: user.username,
  };
  notifications.push(notif);
  if (notifications.length > 50) notifications.splice(0, notifications.length - 50);
  res.status(201).json(notif);
});

router.delete("/notifications/:id", requireAuth, (req, res) => {
  const user = req.infinityUser;
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Apenas admins podem remover novidades" }); return; }
  const idx = notifications.findIndex(n => n.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Notificação não encontrada" }); return; }
  notifications.splice(idx, 1);
  res.json({ ok: true });
});

export default router;

