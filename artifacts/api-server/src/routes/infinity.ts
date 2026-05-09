import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, infinityUsersTable, infinityConsultasTable, infinityPinsTable, infinityNotificationsTable } from "@workspace/db";
import { eq, desc, sql, gte, and, isNull } from "drizzle-orm";
import {
  createSession,
  deleteSession,
  extractToken,
  requireAuth,
  requireAdmin,
} from "../lib/infinity-auth.js";
import { loginLimiter, consultaLimiter, panelAuthLimiter, aiLimiter } from "../middlewares/rateLimit.js";
import crypto from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import http from "node:http";
import https from "node:https";

const router: IRouter = Router();

const PROVIDER_BASE = "http://149.56.18.68:25584/api/consulta";
const PROVIDER_KEY = process.env.GEASS_API_KEY ?? "GeassZero";

const SKYLERS_BASE = "http://23.81.118.36:7070";
const SKYLERS_TOKEN = process.env.SKYLERS_TOKEN ?? "SQJeVAFAnPGHQWY3XbQVcdHlmrz8xe2pkAXtwGq4Jdk";

// ── Proxy helper — both Geass and Skylers require it from Replit infra ───────
function buildOutboundDispatcher(): ProxyAgent | undefined {
  const list = process.env.WEBSHARE_PROXY_LIST?.trim();
  const user = process.env.WEBSHARE_PROXY_USER?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASS?.trim();
  if (!list || !user || !pass) return undefined;
  const ips = list.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (ips.length === 0) return undefined;
  const ip = ips[Math.floor(Math.random() * ips.length)];
  const proxyUrl = `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}`;
  return new ProxyAgent({ uri: proxyUrl, connectTimeout: 8_000 });
}
// ── Circuit breaker — prevents hammering dead providers ──────────────────────
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 3;
  private readonly resetMs = 90_000; // 90s cooldown after 3 consecutive failures

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.resetMs) { this.failures = 0; return false; }
    return true;
  }
  recordFailure() { this.failures++; this.lastFailure = Date.now(); }
  recordSuccess() { this.failures = 0; }
}
const geassCircuit  = new CircuitBreaker();
const skylersCircuit = new CircuitBreaker();

// ── httpGet: uses Node.js native http/https — works where undici/fetch fail ─
// timeoutMs: 8s default for Geass, pass 15_000 for Skylers (can be slow ~7s)
function httpGet(url: string, signal: AbortSignal, timeoutMs = 8_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Serviço indisponível (cancelado)")); return; }
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      timeout: timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*", "Connection": "close" },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => reject(new Error("Erro de rede: " + e.message)));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Serviço indisponível (sem resposta)")); });
    req.on("error", (e: NodeJS.ErrnoException) => {
      const code = e.code ?? "";
      if (code === "ECONNREFUSED") reject(new Error("Serviço indisponível (conexão recusada)"));
      else if (code === "ENOTFOUND" || code === "EAI_AGAIN") reject(new Error("Serviço indisponível (DNS)"));
      else reject(new Error("Serviço indisponível (" + (e.message ?? code) + ")"));
    });
    const onAbort = () => { req.destroy(); reject(new Error("Serviço indisponível (cancelado)")); };
    signal.addEventListener("abort", onAbort, { once: true });
    req.end();
  });
}

// ─── Temp foto store (base64 → URL) ─────────────────────────────────────────
interface FotoEntry { dataUri: string; expires: number; }
const fotoStore = new Map<string, FotoEntry>();
const FOTO_TTL_MS = 10 * 60 * 1000; // 10 minutes
function storeFoto(dataUri: string): string {
  const id = crypto.randomBytes(12).toString("hex");
  fotoStore.set(id, { dataUri, expires: Date.now() + FOTO_TTL_MS });
  // Clean expired entries
  for (const [k, v] of fotoStore) { if (v.expires < Date.now()) fotoStore.delete(k); }
  return id;
}

// ─── Notifications store (persisted in DB) ────────────────────────────────────

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
  nasc: "iseek-dados---nasc",
  parentes: "iseek-dados---parentes",
  obito: "iseek-dados---obito",
  nis: "iseek-dados---nis",
  cns: "iseek-cpf",
  vacinas: "iseek-dados---vacinas",
  telefone: "iseek-dados---telefone",
  email: "iseek-dados---email",
  pix: "iseek-dados---pix",
  cep: "iseek-dados---cep",
  endereco: "iseek-dados---cep",
  placa: "iseek-dados---placa",
  chassi: "iseek-dados---chassi",
  renavam: "iseek-dados---renavam",
  motor: "iseek-dados---motor",
  cnh: "iseek-dados---cnh",
  cnham: "iseek-dados---cnham",
  cnhnc: "iseek-dados---cnhnc",
  cnhrs: "iseek-dados---cnhrs",
  cnhrr: "iseek-dados---cnhrr",
  frota: "iseek-dados---veiculos",
  veiculos: "iseek-dados---veiculos",
  cnpj: "iseek-dados---cnpj",
  fucionarios: "iseek-dados---func",
  funcionarios: "iseek-dados---func",
  socios: "iseek-dados---cnpj",
  empregos: "iseek-dados---rais",
  rais:     "iseek-dados---rais",
  fotodetran: "iseek-dados---fotodetran",
  crlvto: "iseek-dados---crlvto",
  crlvmt: "iseek-dados---crlvmt",
  // ── aliases para dupla-consulta Geass+Skylers (family tree) ─────────────
  parentesSky: "iseek-dados---parentes",
  maeSky:      "iseek-dados---mae",
  paiSky:      "iseek-dados---pai",
  // ── tipos exclusivos Skylers ─────────────────────────────────────────────
  cpfbasico: "iseek-cpfbasico",
  titulo: "iseek-dados---titulo",
  score: "iseek-dados---score",
  score2: "iseek-dados---score2",
  irpf: "iseek-dados---irpf",
  beneficios: "iseek-dados---beneficios",
  mandado: "iseek-dados---mandado",
  dividas: "iseek-dados---dividas",
  bens: "iseek-dados---bens",
  processo: "iseek-dados---processo",
  processos: "iseek-dados---processos",
  advogadooab: "iseek-dados---advogadooab",
  advogadooabuf: "iseek-dados---advogadooabuf",
  advogadocpf: "iseek-dados---advogadocpf",
  oab: "iseek-dados---oab",
  matricula: "iseek-dados---matricula",
  cheque: "iseek-dados---cheque",
  spc: "cpf-spc",
  iptu: "iseek-dados---iptu",
  certidoes: "iseek-dados---certidoes",
  faculdades: "iseek-dados---faculdades",
  assessoria: "iseek-dados---assessoria",
  registro: "iseek-dados---registro",
  cnhfull: "cnh-full",
  foto: "iseek-fotos---fotocnh",
  biometria: "iseek-fotos---fotocnh",
  credilink: "credilink",
  catcpf: "iseek-dados---catcpf",
  catnumero: "iseek-dados---catnumero",
  placafipe: "placa-fipe",
  placaserpro: "placa-serpro",
  vistoria: "vistoria",
  // Fotos por estado
  fotoma:       "iseek-fotos---fotoma",
  fotoce:       "iseek-fotos---fotoce",
  fotosp:       "iseek-fotos---fotosp",
  fotorj:       "iseek-fotos---fotorj",
  fotoms:       "iseek-fotos---fotoms",
  fotonc:       "iseek-fotos---fotonc",
  fotoes:       "iseek-fotos---fotoes",
  fototo:       "iseek-fotos---fototo",
  fotoro:       "iseek-fotos---fotoro",
  fotomapresos: "iseek-fotos---fotomapresos",
  fotopi:       "iseek-fotos---fotopi",
  fotopr:       "iseek-fotos---fotopr",
  fotodf:       "iseek-fotos---fotodf",
  fotoal:       "iseek-fotos---fotoal",
  fotogo:       "iseek-fotos---fotogo",
  fotopb:       "iseek-fotos---fotopb",
  fotope:       "iseek-fotos---fotope",
  fotorn:       "iseek-fotos---fotorn",
  fotoba:       "iseek-fotos---fotoba",
  fotomg:       "iseek-fotos---fotomg",
  crlvtofoto:   "iseek-fotos---crlvto",
  crlvmtfoto:   "iseek-fotos---crlvmt",
};

const DAILY_RATE_LIMIT = 2000;
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

const _userSkylersCache = new Map<string, { date: string; count: number }>();
const _userSkylersTipoCache = new Map<string, Map<string, { date: string; count: number }>>();

function bumpSkylersTipoCache(username: string, tipoKey: string): void {
  const today = new Date().toISOString().slice(0, 10);
  // bump total (for badge)
  const total = _userSkylersCache.get(username);
  if (total?.date === today) _userSkylersCache.set(username, { date: today, count: total.count + 1 });
  else _userSkylersCache.set(username, { date: today, count: 1 });
  // bump per-tipo (for gate)
  if (!_userSkylersTipoCache.has(username)) _userSkylersTipoCache.set(username, new Map());
  const tipoMap = _userSkylersTipoCache.get(username)!;
  const t = tipoMap.get(tipoKey);
  if (t?.date === today) tipoMap.set(tipoKey, { date: today, count: t.count + 1 });
  else tipoMap.set(tipoKey, { date: today, count: 1 });
}

async function getUserSkylersDaily(username: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = _userSkylersCache.get(username);
  if (cached?.date === today) return cached.count;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      eq(infinityConsultasTable.skylers, true),
      gte(infinityConsultasTable.createdAt, todayStart),
    ));
  const count = row?.c ?? 0;
  _userSkylersCache.set(username, { date: today, count });
  return count;
}

async function getUserSkylersDailyByTipo(username: string, tipoKey: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const tipoMap = _userSkylersTipoCache.get(username);
  const cached = tipoMap?.get(tipoKey);
  if (cached?.date === today) return cached.count;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      eq(infinityConsultasTable.tipo, tipoKey),
      gte(infinityConsultasTable.createdAt, todayStart),
    ));
  const count = row?.c ?? 0;
  if (!_userSkylersTipoCache.has(username)) _userSkylersTipoCache.set(username, new Map());
  _userSkylersTipoCache.get(username)!.set(tipoKey, { date: today, count });
  return count;
}

const SKYLERS_TOTAL_LIMIT = 25;

// ─── Temp tokens for 2-step PIN login ───────────────────────────────────────
interface TempToken { username: string; step: "setup-pin" | "verify-pin"; expiresAt: number }
const _tempTokens = new Map<string, TempToken>();

function cleanTempTokens(): void {
  const now = Date.now();
  for (const [k, v] of _tempTokens) { if (v.expiresAt < now) _tempTokens.delete(k); }
}

function createTempToken(username: string, step: "setup-pin" | "verify-pin"): string {
  cleanTempTokens();
  const token = crypto.randomBytes(32).toString("hex");
  _tempTokens.set(token, { username, step, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumeTempToken(token: string, expectedStep: "setup-pin" | "verify-pin"): string | null {
  cleanTempTokens();
  const t = _tempTokens.get(token);
  if (!t || t.expiresAt < Date.now() || t.step !== expectedStep) return null;
  _tempTokens.delete(token);
  return t.username;
}

const SUPPORTED_TIPOS = new Set([
  "nome", "cpf", "pix", "nis", "cns", "placa", "chassi", "telefone",
  "mae", "pai", "parentes", "cep", "frota", "cnpj", "fucionarios", "funcionarios",
  "socios", "empregos", "cnh", "renavam", "obito", "rg", "email",
  "motor", "vacinas", "nasc", "endereco", "veiculos",
  "cnham", "cnhnc", "cnhrs", "cnhrr", "fotodetran", "crlvto", "crlvmt",
  // Skylers-only
  "cpfbasico", "titulo", "score", "score2", "irpf", "beneficios", "mandado",
  "dividas", "bens", "processo", "processos", "spc", "iptu", "certidoes",
  "cnhfull", "foto", "biometria", "credilink",
  "advogadooab", "advogadooabuf", "advogadocpf", "oab", "matricula", "cheque",
  "catcpf", "catnumero", "faculdades", "assessoria", "registro",
  "placafipe", "placaserpro", "vistoria",
  // Fotos por estado
  "fotoma","fotoce","fotosp","fotorj","fotoms","fotonc","fotoes","fototo","fotoro",
  "fotomapresos","fotopi","fotopr","fotodf","fotoal","fotogo","fotopb","fotope",
  "fotorn","fotoba","fotomg","crlvtofoto","crlvmtfoto",
]);

const onlyDigits = (s: string) => String(s ?? "").replace(/\D/g, "");

function serializeUser(row: { username: string; role: string; createdAt: Date; lastLoginAt: Date | null; accountExpiresAt?: Date | null; queryDailyLimit?: number | null; displayName?: string | null; accountPin?: string | null }) {
  return {
    username: row.username,
    displayName: row.displayName ?? null,
    role: row.role,
    pinSet: !!row.accountPin,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    accountExpiresAt: row.accountExpiresAt ? row.accountExpiresAt.toISOString() : null,
    queryDailyLimit: row.queryDailyLimit ?? null,
  };
}

async function logConsulta(args: {
  tipo: string; query: string; username: string; success: boolean; result: unknown; skylers?: boolean;
}): Promise<void> {
  try {
    await db.insert(infinityConsultasTable).values({
      tipo: args.tipo,
      query: args.query,
      username: args.username,
      success: args.success,
      result: args.result as object,
      skylers: args.skylers ?? false,
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
  if (geassCircuit.isOpen()) {
    return { ok: false, error: "Geass API temporariamente indisponível" };
  }
  const url = `${PROVIDER_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(PROVIDER_KEY)}`;
  try {
    const { status, body: text } = await httpGet(url, signal);
    if (status < 200 || status >= 300) {
      geassCircuit.recordFailure();
      return { ok: false, http: status, error: `Provedor HTTP ${status}`, raw: text.slice(0, 1000) };
    }
    let json: { status?: string; resposta?: string; criador?: string };
    try {
      json = JSON.parse(text);
    } catch {
      geassCircuit.recordFailure();
      return { ok: false, error: "Provedor retornou texto inválido", raw: text.slice(0, 500) };
    }
    if (!json.resposta || typeof json.resposta !== "string") {
      return { ok: false, error: "Sem resultado para esta consulta", raw: json };
    }
    const parsed = parseProviderText(json.resposta);
    if (parsed.fields.length === 0 && parsed.sections.length === 0 && parsed.raw.trim().length === 0) {
      return { ok: false, error: "Sem dados retornados", parsed };
    }
    geassCircuit.recordSuccess();
    return { ok: true, parsed };
  } catch (e) {
    geassCircuit.recordFailure();
    const msg = e instanceof Error ? e.message : "Serviço indisponível";
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
const JUNK_KEYS_SKYLERS = new Set([
  "status", "token", "criador", "creditos", "creditos_restantes", "api_info", "mensagem",
  // Additional token/auth-related keys that Skylers may return
  "token_info", "tokeninfo", "api_token", "access_token", "apikey", "api_key",
  "chave_api", "api_secret", "authorization", "bearer", "hash_token",
  "token_acesso", "chave_acesso", "senha", "password", "key",
]);
// Detect values that look like API tokens (long alphanum strings, no spaces)
const TOKEN_VALUE_RE = /^[A-Za-z0-9_\-]{32,}$/;
function isTokenLikeValue(s: string): boolean {
  return TOKEN_VALUE_RE.test(s.trim());
}
const PHOTO_URL_RE = /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;

// Keys that commonly carry base64 photo data from Skylers foto modules
const BASE64_PHOTO_KEYS = /^(foto|imagem|image|photo|pic|thumb|face|base64|fotografia|retrato|biometria|cnh|selfie|rosto|figura)/i;
// A valid base64 string: only base64 chars, long enough to be an image (>500 chars)
const BASE64_RE = /^[A-Za-z0-9+/]{500,}={0,2}$/;

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

/**
 * Normalises a string value into a data URI if it looks like a base64-encoded image.
 * Handles values that already carry the "data:image/..." prefix.
 */
function toDataUri(s: string): string | null {
  const trimmed = s.replace(/[\r\n\s]/g, "");
  // Already a complete data URI
  if (/^data:image\//i.test(trimmed)) return trimmed;
  // Raw base64 (no prefix)
  if (BASE64_RE.test(trimmed)) return `data:image/jpeg;base64,${trimmed}`;
  // Prefixed but without the "data:" scheme (e.g. "image/jpeg;base64,...")
  const noData = trimmed.replace(/^image\/\w+;base64,/i, "");
  if (noData !== trimmed && BASE64_RE.test(noData)) return `data:image/jpeg;base64,${noData}`;
  return null;
}

/**
 * Scans an object for a base64-encoded photo field.
 * First checks keys matching photo-like names, then falls back to scanning
 * any string value that is long and valid base64 (to catch unexpected key names).
 */
function extractBase64Photo(obj: Record<string, unknown>): { key: string; dataUri: string } | null {
  // Priority pass: keys with photo-like names
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    if (!BASE64_PHOTO_KEYS.test(k)) continue;
    const uri = toDataUri(v);
    if (uri) return { key: k, dataUri: uri };
  }
  // Fallback: any string value >= 500 chars that is pure base64
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string" || v.length < 500) continue;
    const uri = toDataUri(v);
    if (uri) return { key: k, dataUri: uri };
  }
  return null;
}

/**
 * Deeply flattens a plain object to displayable "Key: value" strings.
 * Handles nested objects and arrays recursively (up to depth 5).
 * Skips junk keys and token-like values at every level.
 */
function flattenObjToItems(obj: Record<string, unknown>, skipKey?: string, _depth = 0): string[] {
  if (_depth > 5) return [];
  const items: string[] = [];
  for (const [sk, sv] of Object.entries(obj)) {
    if (sk === skipKey) continue;
    if (JUNK_KEYS_SKYLERS.has(sk.toLowerCase())) continue;
    if (sv === null || sv === undefined) continue;
    const label = humanizeKey(sk);

    if (Array.isArray(sv)) {
      if (sv.length === 0) continue;
      // Array of primitives → join as comma list
      const prims = sv.filter((x) => x !== null && x !== undefined && typeof x !== "object" && isUseful(x));
      if (prims.length > 0) {
        items.push(`${label}: ${prims.slice(0, 10).join(", ")}`);
        continue;
      }
      // Array of objects → flatten each item
      for (const item of sv.slice(0, 15)) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const subItems = flattenObjToItems(item as Record<string, unknown>, undefined, _depth + 1);
          for (const si of subItems) items.push(`${label} ${si}`);
        } else if (isUseful(item)) {
          items.push(`${label}: ${String(item)}`);
        }
      }
    } else if (sv && typeof sv === "object" && !Array.isArray(sv)) {
      // Nested object → recurse with parent key as prefix
      const subItems = flattenObjToItems(sv as Record<string, unknown>, undefined, _depth + 1);
      for (const si of subItems) items.push(`${label} ${si}`);
    } else {
      if (!isUseful(sv)) continue;
      const s = String(sv).trim();
      if (isTokenLikeValue(s)) continue;
      items.push(`${label}: ${s}`);
    }
  }
  return items;
}

/**
 * Processes an array of items into section entries, extracting base64 photos
 * into `fotoUrl` if found (first occurrence wins).
 */
function processArray(
  arr: unknown[],
  fotoUrl: { value: string | null },
): string[] {
  const items: string[] = [];
  for (const item of arr) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      // Try to extract base64 photo from this object item
      if (!fotoUrl.value) {
        const b64 = extractBase64Photo(obj);
        if (b64) {
          fotoUrl.value = b64.dataUri;
          // Flatten the rest of the fields (without the base64 key)
          const entries = flattenObjToItems(obj, b64.key);
          if (entries.length > 0) items.push(entries.join(" · "));
          continue;
        }
      }
      const entries = flattenObjToItems(obj);
      if (entries.length > 0) items.push(entries.join(" · "));
    } else if (isUseful(item)) {
      items.push(String(item));
    }
  }
  return items;
}

function parseSkylers(data: unknown): Parsed {
  // Build sanitized raw: remove junk keys (token, criador, etc.) so they never appear in the raw display
  let sanitizedForRaw: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    sanitizedForRaw = Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([k]) => !JUNK_KEYS_SKYLERS.has(k.toLowerCase()))
    );
  }
  const raw = typeof data === "string" ? data : JSON.stringify(sanitizedForRaw, null, 2);
  const result: Parsed = { fields: [], sections: [], raw };

  if (!data) return result;

  // Shared mutable ref so nested helpers can promote base64 to FOTO_URL
  const fotoUrl: { value: string | null } = { value: null };

  // ── Top-level array ────────────────────────────────────────────────────────
  if (Array.isArray(data)) {
    if (data.length === 0) return result;
    const items = processArray(data as unknown[], fotoUrl);
    if (fotoUrl.value) result.fields.push({ key: "FOTO_URL", value: fotoUrl.value });
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
      const secItems = processArray(v as unknown[], fotoUrl);
      if (secItems.length > 0) {
        result.sections.push({ name: k.toUpperCase().replace(/_/g, " "), items: secItems });
      }

    } else if (typeof v === "object" && v !== null) {
      const sub = v as Record<string, unknown>;
      // Check base64 in sub-object first
      if (!fotoUrl.value) {
        const b64 = extractBase64Photo(sub);
        if (b64) {
          fotoUrl.value = b64.dataUri;
          // Deep-flatten the rest, skipping the base64 key
          const subItems = flattenObjToItems(sub, b64.key);
          if (subItems.length <= 3) {
            for (const si of subItems) {
              const colonIdx = si.indexOf(": ");
              if (colonIdx > -1) result.fields.push({ key: `${humanizeKey(k)} · ${si.slice(0, colonIdx)}`, value: si.slice(colonIdx + 2) });
            }
          } else {
            result.sections.push({ name: k.toUpperCase().replace(/_/g, " "), items: subItems });
          }
          continue;
        }
      }
      // Deep-flatten nested object using recursive flattenObjToItems
      const subItems = flattenObjToItems(sub);
      if (subItems.length === 0) continue;
      if (subItems.length <= 3) {
        for (const si of subItems) {
          const colonIdx = si.indexOf(": ");
          if (colonIdx > -1) result.fields.push({ key: `${humanizeKey(k)} · ${si.slice(0, colonIdx)}`, value: si.slice(colonIdx + 2) });
          else result.fields.push({ key: humanizeKey(k), value: si });
        }
      } else {
        result.sections.push({ name: k.toUpperCase().replace(/_/g, " "), items: subItems });
      }

    } else {
      const s = String(v).trim();
      if (s && !JUNK_VALUES.has(s)) {
        // Check if this field itself is a base64 photo (or already a data URI)
        // Also catches keys that don't match BASE64_PHOTO_KEYS (e.g. "dados", "imagem_cnhh") by
        // trying toDataUri on any long string value.
        if (!fotoUrl.value && (BASE64_PHOTO_KEYS.test(k) || s.length > 500)) {
          const uri = toDataUri(s);
          if (uri) {
            fotoUrl.value = uri;
            continue; // Don't add raw base64 to fields
          }
        }
        // Skip values that look like API tokens
        if (isTokenLikeValue(s)) continue;
        result.fields.push({ key: humanizeKey(k), value: s });
      }
    }
  }

  // Last-resort scan: check all top-level string values for base64/data-URI images.
  // This catches photo data stored under unusual key names that didn't match earlier patterns.
  if (!fotoUrl.value) {
    for (const [, sv] of Object.entries(d)) {
      if (typeof sv !== "string" || sv.length < 500) continue;
      const uri = toDataUri(sv);
      if (uri) { fotoUrl.value = uri; break; }
    }
  }

  // Promote extracted base64 to FOTO_URL field
  if (fotoUrl.value && !result.fields.some((f) => f.key === "FOTO_URL")) {
    result.fields.push({ key: "FOTO_URL", value: fotoUrl.value });
  }

  // ── Detect photo URLs in fields → promote to FOTO_URL ─────────────────────
  if (!result.fields.some((f) => f.key === "FOTO_URL")) {
    for (const f of result.fields) {
      if (PHOTO_URL_RE.test(f.value.trim())) {
        result.fields.push({ key: "FOTO_URL", value: f.value.trim() });
        break;
      }
    }
    // Also check section items for image URLs
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
  if (skylersCircuit.isOpen()) {
    return { ok: false, error: "Skylers API temporariamente indisponível" };
  }
  try {
    let url: string;
    if (endpoint === "likes") {
      url = `${SKYLERS_BASE}/likes?token=${SKYLERS_TOKEN}&id=${encodeURIComponent(valor)}&region=BR`;
    } else if (endpoint === "telegram") {
      url = `${SKYLERS_BASE}/telegram?token=${SKYLERS_TOKEN}&user=${encodeURIComponent(valor)}`;
    } else {
      url = `${SKYLERS_BASE}/consulta?token=${SKYLERS_TOKEN}&modulo=${encodeURIComponent(modulo)}&valor=${encodeURIComponent(valor)}`;
    }

    const { status, body: text } = await httpGet(url, signal, 15_000);

    if (status < 200 || status >= 300) {
      const friendly = status === 400
        ? "Consulta não disponível para este dado na Skylers API"
        : status === 401 || status === 403
        ? "Token Skylers inválido ou expirado"
        : status === 429
        ? "Limite de requisições Skylers atingido, tente novamente em instantes"
        : status >= 500
        ? "Skylers API temporariamente indisponível"
        : `Skylers HTTP ${status}`;
      // Only count as circuit failure for true server errors (5xx), not client errors (4xx)
      if (status >= 500) skylersCircuit.recordFailure();
      return { ok: false, error: friendly, raw: text.slice(0, 500) };
    }

    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    // Check for error responses — case-insensitive key scan
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const dj = json as Record<string, unknown>;
      // Build a lowercase→value map for case-insensitive lookup
      const djLower = Object.fromEntries(Object.entries(dj).map(([k, v]) => [k.toLowerCase(), v]));
      const isErr = djLower.error || djLower.err ||
        (djLower.status && String(djLower.status).toLowerCase() === "error") ||
        (djLower.message && String(djLower.message).toLowerCase().includes("error")) ||
        (djLower.success === false);
      if (isErr) {
        const msg = djLower.message ?? djLower.error ?? djLower.err ?? djLower.detail ?? "Sem resultado";
        return { ok: false, error: String(msg), raw: json };
      }
    }

    const parsed = parseSkylers(json);
    if (parsed.fields.length === 0 && parsed.sections.length === 0) {
      // Server responded fine (2xx) but returned no useful data — NOT a circuit failure
      skylersCircuit.recordSuccess();
      return { ok: false, error: "Sem dados retornados para esta consulta", parsed };
    }
    // Detect error-only results that survived as a single field (e.g. nested {"Err":"CPF inválido."})
    if (parsed.fields.length === 1 && parsed.sections.length === 0) {
      const fk = parsed.fields[0].key.toLowerCase();
      if (fk === "err" || fk === "error" || fk === "erro" || fk === "erros" || fk === "resultado") {
        skylersCircuit.recordSuccess(); // server is up, just a bad query
        return { ok: false, error: parsed.fields[0].value, parsed: { fields: [], sections: [], raw: parsed.raw } };
      }
    }
    skylersCircuit.recordSuccess();
    return { ok: true, parsed };
  } catch (e) {
    // Only count as circuit failure for actual network errors (ECONNREFUSED, timeout)
    const isNetworkErr = e instanceof Error && (
      e.name === "AbortError" ||
      (e as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
      (e as NodeJS.ErrnoException).code === "ECONNRESET" ||
      (e as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
      e.message.includes("timed out") ||
      e.message.includes("network")
    );
    if (isNetworkErr) skylersCircuit.recordFailure();
    const msg = e instanceof Error ? e.message : "Serviço indisponível";
    return { ok: false, error: msg };
  }
}


// ─── Field priority sorter for pessoa-type results ─────────────────────────
// Moves the most important identity fields to the top of the fields array.
// Priority groups for pessoa-type results (lower index = higher priority).
// Each group is an array of aliases — if a field key matches ANY alias, it gets that group's rank.
const PESSOA_PRIORITY_GROUPS: string[][] = [
  ["nome", "nome completo", "nome_completo"],
  ["data de nascimento", "data_nascimento", "nascimento", "dt_nascimento", "dt nascimento", "nasc", "data nasc"],
  ["nome da mãe", "nome_mae", "nome mãe", "nome da mae", "nome mae", "filiacao · nome mae", "mae", "mãe"],
  ["nome do pai", "nome_pai", "nome pai", "filiacao · nome pai", "pai"],
  ["cpf", "rg"],
  ["sexo", "genero", "gênero", "idade"],
  ["situação", "situacao", "status"],
  ["email"],
  ["telefone", "celular"],
  ["logradouro", "endereço", "endereco", "bairro", "cidade", "uf", "cep"],
];

function sortFieldsByPriority(fields: { key: string; value: string }[]): { key: string; value: string }[] {
  const priority = (key: string): number => {
    const k = key.toLowerCase().trim();
    for (let g = 0; g < PESSOA_PRIORITY_GROUPS.length; g++) {
      for (const alias of PESSOA_PRIORITY_GROUPS[g]) {
        // Exact match always wins
        if (k === alias) return g;
        // Multi-word aliases can match as substring of compound field keys (e.g. "filiacao · nome mae")
        // Single-word aliases only match exactly to avoid "nome" matching "filiacao · nome mae"
        if (alias.includes(" ") && k.includes(alias)) return g;
        if (alias.includes(" ") && alias.includes(k)) return g;
      }
    }
    return 9999;
  };
  // Stable sort: preserve original order for fields with equal priority
  return [...fields].sort((a, b) => priority(a.key) - priority(b.key));
}

// Tipos that represent person records and should have priority field sorting
const PESSOA_TIPOS = new Set(["cpf", "nome", "telefone", "email", "rg", "mae", "pai", "parentes", "titulo", "obito", "irpf", "score", "cheque"]);

// ─── auth ──────────────────────────────────────────────────────────────────
// Per-username brute-force lockout (in-memory, complements IP rate limiter)
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function isUserLocked(uname: string): boolean {
  const entry = loginFailures.get(uname.toLowerCase());
  if (!entry) return false;
  if (entry.lockedUntil > Date.now()) return true;
  loginFailures.delete(uname.toLowerCase());
  return false;
}

function recordLoginFailure(uname: string): void {
  const key = uname.toLowerCase();
  const entry = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginFailures.set(key, entry);
}

function clearLoginFailures(uname: string): void {
  loginFailures.delete(uname.toLowerCase());
}

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: "username e password obrigatórios" });
    return;
  }
  if (isUserLocked(String(username))) {
    res.status(429).json({ error: "Conta temporariamente bloqueada por muitas tentativas. Aguarde 15 minutos." });
    return;
  }
  const rows = await db
    .select()
    .from(infinityUsersTable)
    .where(sql`lower(${infinityUsersTable.username}) = lower(${String(username)})`)
    .limit(1);
  const u = rows[0];
  if (!u) {
    recordLoginFailure(String(username));
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  const ok = await bcrypt.compare(String(password), u.passwordHash);
  if (!ok) {
    recordLoginFailure(u.username);
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }
  clearLoginFailures(u.username);
  const step: "setup-pin" | "verify-pin" = u.accountPin ? "verify-pin" : "setup-pin";
  const tempToken = createTempToken(u.username, step);
  res.json({ step, tempToken });
});

router.post("/setup-pin", loginLimiter, async (req, res) => {
  const { tempToken, pin } = req.body ?? {};
  if (!tempToken || !pin) {
    res.status(400).json({ error: "tempToken e pin obrigatórios" });
    return;
  }
  if (!/^\d{4}$/.test(String(pin))) {
    res.status(400).json({ error: "PIN deve ter exatamente 4 dígitos numéricos" });
    return;
  }
  const username = consumeTempToken(String(tempToken), "setup-pin");
  if (!username) {
    res.status(401).json({ error: "Token inválido ou expirado. Faça login novamente." });
    return;
  }
  const pinHash = await bcrypt.hash(String(pin), 10);
  await db.update(infinityUsersTable)
    .set({ accountPin: pinHash, lastLoginAt: new Date() })
    .where(eq(infinityUsersTable.username, username));
  const { token } = await createSession(username);
  const [updated] = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, username)).limit(1);
  res.json({ token, user: serializeUser({ ...updated!, lastLoginAt: new Date() }) });
});

router.post("/verify-pin", loginLimiter, async (req, res) => {
  const { tempToken, pin } = req.body ?? {};
  if (!tempToken || !pin) {
    res.status(400).json({ error: "tempToken e pin obrigatórios" });
    return;
  }
  const username = consumeTempToken(String(tempToken), "verify-pin");
  if (!username) {
    res.status(401).json({ error: "Token inválido ou expirado. Faça login novamente." });
    return;
  }
  const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, username)).limit(1);
  const u = rows[0];
  if (!u || !u.accountPin) {
    res.status(401).json({ error: "Conta sem PIN configurado" });
    return;
  }
  const ok = await bcrypt.compare(String(pin), u.accountPin);
  if (!ok) {
    res.status(401).json({ error: "PIN incorreto" });
    return;
  }
  await db.update(infinityUsersTable).set({ lastLoginAt: new Date() }).where(eq(infinityUsersTable.username, username));
  const { token } = await createSession(username);
  res.json({ token, user: serializeUser({ ...u, lastLoginAt: new Date() }) });
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
  const skylersTotal = await getUserSkylersDaily(username);
  res.json({ ...serializeUser(u), skylersTotal, skylersLimit: SKYLERS_TOTAL_LIMIT });
});

router.patch("/me/display-name", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const { displayName } = req.body ?? {};
  const val = displayName !== undefined ? String(displayName).trim().slice(0, 50) || null : undefined;
  if (val === undefined) {
    res.status(400).json({ error: "displayName obrigatório" });
    return;
  }
  const [updated] = await db
    .update(infinityUsersTable)
    .set({ displayName: val })
    .where(eq(infinityUsersTable.username, username))
    .returning();
  res.json(serializeUser(updated!));
});

router.patch("/me/pin", requireAuth, async (req, res) => {
  const username = req.infinityUser!.username;
  const { currentPin, newPin } = req.body ?? {};
  if (!currentPin || !newPin) {
    res.status(400).json({ error: "currentPin e newPin obrigatórios" });
    return;
  }
  if (!/^\d{4}$/.test(String(newPin))) {
    res.status(400).json({ error: "newPin deve ter exatamente 4 dígitos numéricos" });
    return;
  }
  const rows = await db.select().from(infinityUsersTable).where(eq(infinityUsersTable.username, username)).limit(1);
  const u = rows[0];
  if (!u) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  if (!u.accountPin) {
    // PIN ainda não configurado — permite definir direto sem verificar PIN atual
    const pinHash = await bcrypt.hash(String(newPin), 10);
    await db.update(infinityUsersTable).set({ accountPin: pinHash }).where(eq(infinityUsersTable.username, username));
    res.json({ ok: true, pinCreated: true });
    return;
  }
  if (!currentPin) {
    res.status(400).json({ error: "currentPin obrigatório para alterar PIN" });
    return;
  }
  const ok = await bcrypt.compare(String(currentPin), u.accountPin);
  if (!ok) { res.status(401).json({ error: "PIN atual incorreto" }); return; }
  const pinHash = await bcrypt.hash(String(newPin), 10);
  await db.update(infinityUsersTable).set({ accountPin: pinHash }).where(eq(infinityUsersTable.username, username));
  res.json({ ok: true });
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
  const { username, password, role, expiresInDays, expiresAt, queryDailyLimit, pin } = req.body ?? {};
  if (!username || !password || !role) {
    res.status(400).json({ error: "username, password e role obrigatórios" });
    return;
  }

  // Validate PIN
  const pinStr = String(pin ?? "").trim();
  if (!/^\d{4}$/.test(pinStr)) {
    res.status(400).json({ error: "PIN de 4 dígitos obrigatório" });
    return;
  }
  const pinRow = await db.select().from(infinityPinsTable).where(eq(infinityPinsTable.pin, pinStr)).limit(1);
  if (pinRow.length === 0) {
    res.status(400).json({ error: "PIN inválido ou não encontrado" });
    return;
  }
  if (pinRow[0].usedAt !== null) {
    res.status(400).json({ error: "PIN já utilizado" });
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

    // Mark PIN as used
    await db
      .update(infinityPinsTable)
      .set({ usedAt: new Date(), usedBy: String(username) })
      .where(eq(infinityPinsTable.pin, pinStr));

    res.status(201).json(serializeUser(created));
  } catch {
    res.status(400).json({ error: "Usuário já existe ou dados inválidos" });
  }
});

// ─── pins (admin) ───────────────────────────────────────────────────────────
router.get("/pins", requireAdmin, async (_req, res) => {
  const pins = await db
    .select()
    .from(infinityPinsTable)
    .orderBy(desc(infinityPinsTable.createdAt));
  res.json(pins.map(p => ({
    pin:       p.pin,
    createdAt: p.createdAt,
    createdBy: p.createdBy,
    usedAt:    p.usedAt,
    usedBy:    p.usedBy,
  })));
});

router.post("/pins", requireAdmin, async (req, res) => {
  const admin = req.infinityUser!.username;
  const { pin: customPin } = req.body ?? {};

  let pin: string;
  if (customPin !== undefined) {
    pin = String(customPin).trim();
    if (!/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: "PIN deve ter exatamente 4 dígitos numéricos" });
      return;
    }
  } else {
    // Generate random unused PIN
    pin = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  }

  try {
    const [created] = await db
      .insert(infinityPinsTable)
      .values({ pin, createdBy: admin })
      .returning();
    res.status(201).json(created);
  } catch {
    res.status(400).json({ error: "PIN já existe" });
  }
});

router.delete("/pins/:pin", requireAdmin, async (req, res) => {
  const pin = String(req.params.pin);
  const existing = await db.select().from(infinityPinsTable).where(eq(infinityPinsTable.pin, pin)).limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: "PIN não encontrado" });
    return;
  }
  if (existing[0].usedAt !== null) {
    res.status(400).json({ error: "Não é possível remover um PIN já utilizado" });
    return;
  }
  await db.delete(infinityPinsTable).where(eq(infinityPinsTable.pin, pin));
  res.status(204).end();
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

router.post("/users/:username/reset-pin", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  const [updated] = await db
    .update(infinityUsersTable)
    .set({ accountPin: null })
    .where(eq(infinityUsersTable.username, target))
    .returning();
  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json({ ok: true });
});

router.patch("/users/:username", requireAdmin, async (req, res) => {
  const target = String(req.params.username);
  const { action, expiresInDays, expiresAt, queryDailyLimit, role, password, displayName } = req.body ?? {};

  const updateData: Partial<{
    accountExpiresAt: Date | null;
    queryDailyLimit: number | null;
    role: string;
    passwordHash: string;
    displayName: string | null;
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

  if (displayName !== undefined) {
    updateData.displayName = String(displayName).trim().slice(0, 50) || null;
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

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [{ mes }] = await db
    .select({ mes: sql<number>`count(*)::int` })
    .from(infinityConsultasTable)
    .where(and(
      eq(infinityConsultasTable.username, username),
      gte(infinityConsultasTable.createdAt, startOfMonth),
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
    consultasMes: mes ?? 0,
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

// ─── providers/ping — lightweight status for any auth'd user ───────────────
router.get("/providers/ping", requireAuth, async (_req, res) => {
  const probe = async (url: string, timeoutMs = 3000): Promise<{ online: boolean; ms: number }> => {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
      clearTimeout(timer);
      return { online: r.status < 500, ms: Date.now() - start };
    } catch {
      return { online: false, ms: Date.now() - start };
    }
  };

  const [geassProbe, skylersProbe] = await Promise.all([
    probe(`${PROVIDER_BASE}/cpf?cpf=00000000000`, 3000),
    probe(SKYLERS_BASE, 3000),
  ]);

  res.json({
    geass:   { online: geassProbe.online,   ms: geassProbe.ms,   circuitOpen: geassCircuit.isOpen() },
    skylers: { online: skylersProbe.online, ms: skylersProbe.ms, circuitOpen: skylersCircuit.isOpen() },
  });
});

// ─── bases status ──────────────────────────────────────────────────────────
router.get("/bases/status", requireAdmin, async (_req, res) => {
  // Use real probe URLs that reflect actual API health (not just root paths)
  const bases = [
    {
      id: "geass",
      name: "Geass API",
      description: "Provedor OSINT principal · 24 tipos (CPF, Nome, Placa…)",
      url: `${PROVIDER_BASE}/cpf?cpf=00000000000`,
      circuitOpen: geassCircuit.isOpen(),
      role: "primary",
    },
    {
      id: "skylers",
      name: "Skylers API",
      description: "Provedor OSINT avançado · 80+ módulos · Foto CNH",
      // Probe root only — returns HTTP 404 in ~150ms when server is UP.
      // Using the real /consulta endpoint with a query is too slow (DB lookup).
      url: SKYLERS_BASE,
      circuitOpen: skylersCircuit.isOpen(),
      role: "fallback",
    },
    {
      id: "viacep",
      name: "ViaCEP",
      description: "Consulta de endereços por CEP · fallback automático CEP",
      url: "https://viacep.com.br/ws/01001000/json/",
      circuitOpen: false,
      role: "fallback",
    },
    {
      id: "receitaws",
      name: "ReceitaWS",
      description: "CNPJ via Receita Federal · fallback CNPJ primário",
      url: "https://www.receitaws.com.br/v1/cnpj/11222333000181",
      circuitOpen: false,
      role: "fallback",
    },
    {
      id: "brasilapi",
      name: "BrasilAPI",
      description: "CNPJ público com QSA · fallback CNPJ secundário",
      url: "https://brasilapi.com.br/api/cnpj/v1/00360305000104",
      circuitOpen: false,
      role: "fallback",
    },
    {
      id: "cnpjws",
      name: "CNPJ.ws",
      description: "Consulta pública de CNPJ · fallback CNPJ terciário",
      url: "https://publica.cnpj.ws/cnpj/11222333000181",
      circuitOpen: false,
      role: "fallback",
    },
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
        // Consider online only if the server actually responded (not ECONNREFUSED/timeout)
        // 4xx = server up but query failed (still online), 5xx = server error (offline)
        const online = r.status < 500;
        return { id: base.id, name: base.name, description: base.description, online, ms, http: r.status, circuitOpen: base.circuitOpen, role: base.role };
      } catch {
        return { id: base.id, name: base.name, description: base.description, online: false, ms: Date.now() - start, http: 0, circuitOpen: base.circuitOpen, role: base.role };
      }
    })
  );

  const results = checks.map((c, i) => {
    if (c.status === "fulfilled") return c.value;
    return { id: bases[i].id, name: bases[i].name, description: bases[i].description, online: false, ms: 0, http: 0, circuitOpen: bases[i].circuitOpen, role: bases[i].role };
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
  const isAdmin  = req.infinityUser!.role === "admin";

  const tipoKey = `skylers:${ep ?? modulo ?? "unknown"}`;

  if (!isAdmin) {
    const [globalCount, userCount, skylersTipoCount] = await Promise.all([
      getGlobalDailyCount(),
      getUserDailyCount(username),
      getUserSkylersDailyByTipo(username, tipoKey),
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

    if (skylersTipoCount >= SKYLERS_TOTAL_LIMIT) {
      res.status(429).json({
        success: false,
        error: `Limite de ${SKYLERS_TOTAL_LIMIT} consultas '${ep ?? modulo}' Skylers atingido hoje.`,
        rateLimited: true,
        skylersLimited: true,
        limitInfo: { used: skylersTipoCount, limit: SKYLERS_TOTAL_LIMIT },
      });
      return;
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);

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
  bumpSkylersTipoCache(username, tipoKey);
  // Send response BEFORE logging — prevents 10s global timeout from firing during DB write
  if (!res.headersSent) {
    res.json({ success, data, error: provider.error ?? null });
  }
  void logConsulta({ tipo: tipoLog, query: String(valor).trim(), username, success, result: data, skylers: true }).catch(() => {});
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
  // Strict boolean check — belt-and-suspenders with header fallback for CpfFullPanel batch calls
  const skipLog = req.body?.skipLog === true || req.headers["x-skip-log"] === "1";

  const username = req.infinityUser!.username;
  const isAdmin  = req.infinityUser!.role === "admin";

  // Global + per-user daily rate limits — skipped entirely for admins
  if (!isAdmin) {
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

  // ─── Skylers fallback: when Geass fails and the tipo has a Skylers mapping ──
  if (!provider.ok && !ctrl.signal.aborted) {
    const skylersModulo = TIPO_TO_SKYLERS[tipo];
    if (skylersModulo) {
      const geassErr = provider.error;
      const sk = await callSkylers(skylersModulo, dados, ctrl.signal);
      if (sk.ok && sk.parsed) {
        const sortedParsed = PESSOA_TIPOS.has(tipo)
          ? { ...sk.parsed, fields: sortFieldsByPriority(sk.parsed.fields) }
          : sk.parsed;
        provider = { ok: true, parsed: sortedParsed };
      } else {
        // Both providers failed — give a clear combined message
        provider = { ...provider, error: "Provedores OSINT indisponíveis temporariamente. Tente novamente em instantes." };
        void geassErr; // suppress unused warning
      }
    }
  }

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

  // Send response BEFORE logging — prevents 10s global timeout from firing during DB write
  res.json({
    success,
    tipo,
    query: dados,
    data,
    error: provider.error ?? null,
  });
  if (!skipLog) {
    bumpCaches(username);
    void logConsulta({ tipo, query: dados, username, success, result: data }).catch(() => {});
  }
});

// ─── AI chat (streaming via SSE, with multi-step tool-calling) ───────────────
const CONSULTA_TOOL = {
  type: "function" as const,
  function: {
    name: "consultar_infinity",
    description:
      "Executa uma consulta OSINT no banco de dados do Infinity Search. " +
      "Use SEMPRE que o usuário pedir para buscar, consultar, pesquisar ou investigar qualquer dado sobre pessoas, veículos, empresas, crédito ou governo brasileiro. " +
      "Nunca invente dados — consulte sempre a ferramenta.",
    parameters: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: [
            "cpf", "nome", "rg", "mae", "pai", "parentes", "obito",
            "telefone", "email", "pix", "cep",
            "placa", "chassi", "frota", "cnh", "cnhfull", "renavam",
            "cnpj", "fucionarios",
            "nis", "cns", "titulo", "irpf", "beneficios", "mandado",
            "score", "dividas", "bens", "processos", "spc",
            "foto", "biometria",
          ],
          description:
            "Tipo da consulta:\n" +
            "PESSOA: cpf (dados completos de uma pessoa pelo CPF), nome (busca por nome completo), rg, mae (dados da mãe pelo CPF), pai, parentes (família e parentes), obito (verifica óbito)\n" +
            "CONTATO: telefone (titular do número), email, pix (titular da chave), cep (endereço por CEP)\n" +
            "VEÍCULO: placa (dados do veículo e proprietário), chassi, frota (todos os veículos de uma pessoa/empresa), cnh (habilitação por CPF), cnhfull (CNH completa com foto), renavam\n" +
            "EMPRESA: cnpj (dados da empresa, sócios, endereço), fucionarios (funcionários da empresa)\n" +
            "GOVERNO: nis, cns, titulo (título de eleitor), irpf (imposto de renda), beneficios (Bolsa Família/BPC), mandado (mandado de prisão)\n" +
            "FINANCEIRO: score (score de crédito), dividas (dívidas BACEN/FGTS), bens, processos (judiciais), spc\n" +
            "FOTO/BIOMETRIA: Use 'foto' ou 'biometria' quando o usuário pedir foto, imagem, rosto, selfie ou biometria de uma pessoa. Sempre requer CPF como dados.",
        },
        dados: {
          type: "string",
          description:
            "O valor a ser consultado. " +
            "Para CPF: somente dígitos (ex: 12345678900). " +
            "Para placa: formato ABC1234 ou ABC1D23. " +
            "Para CNPJ: somente dígitos. " +
            "Para nome: nome completo da pessoa. " +
            "Para telefone: DDD + número (ex: 11999999999). " +
            "Para CEP: somente dígitos. " +
            "Para email: endereço completo. " +
            "Para foto/biometria: CPF da pessoa.",
        },
      },
      required: ["tipo", "dados"],
    },
  },
};

const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"];

// Tipos that must always use Skylers
const AI_SKYLERS_ONLY = new Set([
  "titulo", "score", "irpf", "beneficios", "mandado", "dividas", "bens",
  "processos", "spc", "iptu", "certidoes", "cnhfull", "foto", "biometria", "cpfbasico",
]);

async function streamGroq(
  apiKey: string,
  messages: unknown[],
  res: import("express").Response,
  modelIndex = 0
): Promise<void> {
  const model = GROQ_MODELS[modelIndex] ?? GROQ_MODELS[GROQ_MODELS.length - 1];
  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: true, messages, max_tokens: 1536 }),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      // On 429 try next model in fallback chain
      if (upstream.status === 429 && modelIndex < GROQ_MODELS.length - 1) {
        await new Promise(r => setTimeout(r, 600));
        return streamGroq(apiKey, messages, res, modelIndex + 1);
      }
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

router.post("/ai/chat", requireAuth, aiLimiter, async (req, res) => {
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
    "Você é a Infinity IA — agente OSINT profissional da plataforma Infinity Search. Responda SEMPRE em português brasileiro.\n\n" +

    "══════════════════════════════════════\n" +
    "REGRA ABSOLUTA — PROIBIÇÕES ESTRITAS\n" +
    "══════════════════════════════════════\n" +
    "❌ NUNCA escreva análises, interpretações ou opiniões sobre os dados.\n" +
    "❌ NUNCA escreva frases como 'foi possível identificar', 'os registros indicam', 'parece ser', 'pode sugerir', 'recomendo verificar'.\n" +
    "❌ NUNCA invente, suponha ou deduza dados pessoais.\n" +
    "❌ NUNCA omita campos retornados pela ferramenta — mostre TODOS.\n" +
    "❌ NUNCA mencione URLs de foto na resposta de texto.\n\n" +

    "══════════════════\n" +
    "FORMATO OBRIGATÓRIO\n" +
    "══════════════════\n" +
    "Você DEVE reproduzir os campos exatamente como retornados pela ferramenta, organizados em seções:\n" +
    "### 👤 Dados Pessoais\n" +
    "**Nome:** FULANO DE TAL\n" +
    "**CPF:** 123.456.789-00\n" +
    "**Nascimento:** 01/01/1990\n" +
    "**Mãe:** MARIA DA SILVA\n\n" +
    "### 📍 Endereço\n" +
    "**Logradouro:** RUA DAS FLORES, 123\n" +
    "**Bairro:** CENTRO\n" +
    "**Cidade:** SÃO PAULO/SP\n\n" +
    "Para listas (telefones, emails, parentes, veículos): use - para cada item.\n" +
    "Use --- para separar seções quando necessário.\n" +
    "Se não há resultado: escreva apenas '❌ Sem resultado para [tipo] — dado não encontrado na base.'\n\n" +

    "══════════════\n" +
    "USO DA FERRAMENTA\n" +
    "══════════════\n" +
    "Use consultar_infinity SEMPRE que o usuário pedir busca, consulta, pesquisa ou investigação de:\n" +
    "- PESSOA: cpf, nome, rg, mae, pai, parentes, obito\n" +
    "- CONTATO: telefone, email, pix, cep\n" +
    "- VEÍCULO: placa, chassi, frota, cnh, cnhfull, renavam\n" +
    "- EMPRESA: cnpj, fucionarios\n" +
    "- GOVERNO: nis, cns, titulo, irpf, beneficios, mandado\n" +
    "- FINANCEIRO: score, dividas, bens, processos, spc\n" +
    "- FOTO/BIOMETRIA: tipo='foto', dados=CPF da pessoa\n\n" +

    "DOSSIÊ COMPLETO: quando pedirem dossiê/perfil completo → consulte cpf → depois score → depois foto (3 chamadas sequenciais).\n" +
    "NÃO use a ferramenta para saudações ou perguntas sobre capacidades.";

  // Trim history to prevent 413: keep last 8 messages, truncate large content
  const rawMessages = (messages as Array<{ role?: string; content?: string }>).filter(
    (m) => m && (typeof m.content === "string" || m.content === null)
  );
  const MAX_HIST = 8;
  const MAX_CONTENT = 1200;
  const cleanMessages = rawMessages.slice(-MAX_HIST).map((m) => ({
    ...m,
    content: typeof m.content === "string" && m.content.length > MAX_CONTENT
      ? m.content.slice(0, MAX_CONTENT) + "…"
      : m.content,
  }));

  type AnyMsg = Record<string, unknown>;
  type ToolCall = { id: string; function: { name: string; arguments: string } };

  let finalMessages: AnyMsg[] = [
    { role: "system", content: systemPrompt },
    ...cleanMessages,
  ];

  // ── Helper: execute one tool call and return the text content for the tool role
  let capturedPhotoUrl: string | undefined;

  function buildToolContent(
    p: { fields: Array<{key:string;value:string}>; sections: Array<{name:string;items:string[]}>; raw: string },
    tipo: string,
  ): string {
    const lines: string[] = [];
    const priorityFields: string[] = [];
    const otherFields: string[] = [];

    for (const f of p.fields) {
      if (f.key === "FOTO_URL") {
        // Convert base64 to served URL; direct URLs pass through
        if (!capturedPhotoUrl) {
          if (f.value.startsWith("data:image")) {
            const fotoId = storeFoto(f.value);
            capturedPhotoUrl = `/api/infinity/foto/${fotoId}`;
          } else if (f.value.startsWith("http")) {
            capturedPhotoUrl = f.value;
          }
        }
        continue; // never add raw FOTO_URL to tool content
      }
      const kl = f.key.toLowerCase();
      const isPriority = /nome|cpf|rg|nascimento|mãe|mae|pai|endereço|endereco|telefone|email|score|situação|situacao/.test(kl);
      if (isPriority) priorityFields.push(`${f.key}: ${f.value}`);
      else otherFields.push(`${f.key}: ${f.value}`);
    }

    if (capturedPhotoUrl) lines.push("[FOTO CAPTURADA — será exibida automaticamente no chat acima desta resposta]");
    lines.push(`Consulta: ${tipo.toUpperCase()}`);
    if (priorityFields.length) lines.push("", "--- Dados principais ---", ...priorityFields);
    if (otherFields.length) {
      lines.push("", "--- Dados adicionais ---", ...otherFields.slice(0, 25));
      if (otherFields.length > 25) lines.push(`... e mais ${otherFields.length - 25} campos`);
    }

    for (const s of p.sections) {
      const shown = s.items.slice(0, 10);
      lines.push("", `--- ${s.name} (${s.items.length} registros) ---`, ...shown.map(it => `• ${it}`));
      if (s.items.length > 10) lines.push(`... e mais ${s.items.length - 10} registros`);
    }

    const result = lines.join("\n").trim();
    return result || `Sem dados detalhados. Raw: ${p.raw.slice(0, 400)}`;
  }

  async function executeTool(toolCall: ToolCall, stepNum: number): Promise<string> {
    let args: { tipo?: string; dados?: string } = {};
    try { args = JSON.parse(toolCall.function.arguments); } catch {}
    const tipo = String(args.tipo ?? "").toLowerCase().trim();
    const dados = String(args.dados ?? "").trim();

    if (!tipo || !dados) return "Parâmetros inválidos para a consulta.";

    const useSkylers = AI_SKYLERS_ONLY.has(tipo);
    const stepSuffix = stepNum > 1 ? ` (passo ${stepNum})` : "";
    res.write(`data: ${JSON.stringify({ status: `🔍 Consultando ${tipo.toUpperCase()}${useSkylers ? " via Skylers" : ""}…${stepSuffix}` })}\n\n`);

    // For photo: send the SSE event immediately once captured
    const prevPhoto = capturedPhotoUrl;

    // Fallback chain for foto/biometria: national first, then CNH, then state DMV databases
    const FOTO_FALLBACK_MODULES = [
      "iseek-fotos---fotonc",
      "iseek-fotos---fotocnh",
      "iseek-fotos---fotosp",
      "iseek-fotos---fotodf",
      "iseek-fotos---fotomg",
      "iseek-fotos---fotoba",
      "iseek-fotos---fotope",
      "iseek-fotos---fotorn",
      "iseek-fotos---fotopr",
      "iseek-fotos---fotors",
      "iseek-fotos---fotoce",
      "iseek-fotos---fotoma",
    ];

    let toolContent = "";
    if (tipo === "foto" || tipo === "biometria") {
      let found = false;
      for (const modulo of FOTO_FALLBACK_MODULES) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        res.write(`data: ${JSON.stringify({ status: `📷 Buscando foto (${modulo.split("---")[1]?.toUpperCase()})…` })}\n\n`);
        const sk = await callSkylers(modulo, dados, ctrl.signal);
        clearTimeout(timer);
        if (sk.ok && sk.parsed) {
          toolContent = buildToolContent(sk.parsed, tipo);
          found = true;
          break;
        }
      }
      if (!found || !toolContent) {
        toolContent = `Sem resultado para foto: CPF não encontrado nas bases biométricas disponíveis (CNH, SP, DF, MG, BA, PE, RN, PR, CE, MA)`;
      }
    } else if (useSkylers) {
      const modulo = TIPO_TO_SKYLERS[tipo];
      if (modulo) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 22_000);
        const sk = await callSkylers(modulo, dados, ctrl.signal);
        clearTimeout(timer);
        if (sk.ok && sk.parsed) {
          toolContent = buildToolContent(sk.parsed, tipo);
        } else {
          toolContent = `Sem resultado para ${tipo}: ${sk.error ?? "dado não encontrado ou não disponível"}`;
        }
      } else {
        // tipo Skylers-only but no module mapping — try geass fallback
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        const fb = await callProvider(tipo, dados, ctrl.signal);
        clearTimeout(timer);
        toolContent = fb.ok && fb.parsed
          ? buildToolContent(fb.parsed, tipo)
          : `Sem resultado para ${tipo}: ${fb.error ?? "não encontrado"}`;
      }
    } else {
      // Try Geass first, Skylers as fallback if available
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      const g = await callProvider(tipo, dados, ctrl.signal);
      clearTimeout(timer);
      if (g.ok && g.parsed) {
        toolContent = buildToolContent(g.parsed, tipo);
      } else {
        // Try Skylers fallback if the tipo is mapped
        const modulo = TIPO_TO_SKYLERS[tipo];
        if (modulo) {
          const ctrl2 = new AbortController();
          const timer2 = setTimeout(() => ctrl2.abort(), 15_000);
          const sk = await callSkylers(modulo, dados, ctrl2.signal);
          clearTimeout(timer2);
          toolContent = sk.ok && sk.parsed
            ? buildToolContent(sk.parsed, tipo)
            : `Sem resultado para ${tipo}: ${sk.error ?? g.error ?? "dado não encontrado"}`;
        } else {
          toolContent = `Sem resultado para ${tipo}: ${g.error ?? "dado não encontrado"}`;
        }
      }
    }

    // If we just captured a photo URL (changed from prev), send SSE immediately
    if (capturedPhotoUrl && capturedPhotoUrl !== prevPhoto) {
      res.write(`data: ${JSON.stringify({ photo: capturedPhotoUrl })}\n\n`);
    }

    return toolContent;
  }

  // ── Multi-step tool calling loop (up to 4 sequential tool calls)
  const MAX_TOOL_STEPS = 4;
  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      // Non-streaming call to detect tool calls
      let phase1Resp: Response | null = null;
      for (let mi = 0; mi < GROQ_MODELS.length; mi++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 25_000);
        const attempt = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: GROQ_MODELS[mi],
            stream: false,
            messages: finalMessages,
            tools: [CONSULTA_TOOL],
            tool_choice: "auto",
            max_tokens: 600,
            temperature: 0.1,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (attempt.status === 429 && mi < GROQ_MODELS.length - 1) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        phase1Resp = attempt;
        break;
      }

      if (!phase1Resp?.ok) break;

      type Phase1Choice = { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } };
      const phase1Data = await phase1Resp.json() as { choices?: Phase1Choice[] };
      const choice = phase1Data.choices?.[0];

      // No tool call — LLM wants to respond directly; break and stream
      if (!choice || choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) break;

      const toolCall = choice.message.tool_calls[0]!;
      const toolContent = await executeTool(toolCall, step + 1);

      // Cap tool content sent to Groq to avoid 413 on multi-step calls
      const MAX_TOOL_CONTENT = 1800;
      const toolContentForGroq = toolContent.length > MAX_TOOL_CONTENT
        ? toolContent.slice(0, MAX_TOOL_CONTENT) + "\n… [truncado para caber no contexto]"
        : toolContent;

      // Add tool exchange to message history for next iteration
      finalMessages = [
        ...finalMessages,
        { role: "assistant", content: null, tool_calls: [toolCall] },
        { role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: toolContentForGroq },
      ];
    }
  } catch { /* tool loop error — fall through to stream with whatever messages we have */ }

  // ── Stream final LLM response
  await streamGroq(apiKey, finalMessages, res);
});

// ─── Temp foto serve endpoint ─────────────────────────────────────────────────
router.get("/foto/:id", (req, res) => {
  const entry = fotoStore.get(req.params.id);
  if (!entry || entry.expires < Date.now()) {
    res.status(404).send("Foto não encontrada ou expirada");
    return;
  }
  // dataUri is like: data:image/jpeg;base64,/9j/...
  const match = entry.dataUri.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) { res.status(500).send("Formato inválido"); return; }
  const [, mime, b64] = match;
  const buf = Buffer.from(b64, "base64");
  res.setHeader("Content-Type", mime!);
  res.setHeader("Cache-Control", "no-store");
  res.end(buf);
});

// ─── External scraper routes ───────────────────────────────────────────────
const INTERNAL_KEY = process.env["INTERNAL_BOT_KEY"] ?? "infinity-bot-fallback-change-me";

function requireAuthOrInternal(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const internalKey = req.headers["x-internal-key"];
  if (internalKey === INTERNAL_KEY) { next(); return; }
  requireAuth(req, res, next);
}

router.post("/external/:source", requireAuthOrInternal, async (req, res) => {
  const source = req.params.source as "skylers" | "sisreg" | "sipni";
  if (!["skylers", "sisreg", "sipni"].includes(source)) {
    res.status(400).json({ success: false, error: "Fonte inválida." });
    return;
  }
  // sisreg and sipni are not yet connected — return a clear error
  if (source === "sisreg" || source === "sipni") {
    const label = source === "sisreg" ? "SISREG-III" : "SI-PNI";
    res.json({ success: false, error: `O módulo ${label} está temporariamente indisponível. Tente pela base Infinity.` });
    return;
  }

  const tipo  = String(req.body?.tipo  ?? "").trim();
  const dados = String(req.body?.dados ?? "").trim();
  // Strict boolean check — belt-and-suspenders with header fallback for CpfFullPanel batch calls
  const skipLog = req.body?.skipLog === true || req.headers["x-skip-log"] === "1";
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
    const tipoLower = tipo.toLowerCase() as "telegram" | "likes" | string;
    const isSpecialEndpoint = tipoLower === "telegram" || tipoLower === "likes";
    const modulo = isSpecialEndpoint ? "" : TIPO_TO_SKYLERS[tipoLower];
    const extTipoKey = isSpecialEndpoint ? `skylers:${tipoLower}` : `skylers:${modulo}`;
    if (!isSpecialEndpoint && !modulo) {
      res.json({ success: false, error: `Tipo '${tipo}' não mapeado na Skylers API.`, data: "" });
      return;
    }
    if (!skipLog && req.infinityUser && req.infinityUser.role !== "admin") {
      const skylersTipoCount = await getUserSkylersDailyByTipo(req.infinityUser.username, extTipoKey);
      if (skylersTipoCount >= SKYLERS_TOTAL_LIMIT) {
        res.status(429).json({
          success: false,
          error: `Limite de ${SKYLERS_TOTAL_LIMIT} consultas '${tipo}' Skylers atingido hoje.`,
          rateLimited: true,
          skylersLimited: true,
          limitInfo: { used: skylersTipoCount, limit: SKYLERS_TOTAL_LIMIT },
        });
        return;
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const provider = await callSkylers(
      modulo,
      dadosStr,
      ctrl.signal,
      isSpecialEndpoint ? (tipoLower as "telegram" | "likes") : undefined,
    );
    clearTimeout(timer);
    const success = provider.ok && !!provider.parsed;
    // Serialize parsed result as compact string for the base-selector "raw" display
    const rawText = provider.parsed?.raw ?? "";
    // Send response BEFORE logging — prevents 10s global timeout from firing during DB write
    if (!res.headersSent) {
      if (success) {
        res.json({ success: true, data: provider.parsed });
      } else {
        res.json({ success: false, error: provider.error ?? "Sem resultado", data: { fields: [], sections: [], raw: rawText } });
      }
    }
    if (req.infinityUser && !skipLog) {
      bumpCaches(req.infinityUser.username);
      bumpSkylersTipoCache(req.infinityUser.username, extTipoKey);
      void logConsulta({
        tipo: `skylers:${modulo}`,
        query: dadosStr,
        username: req.infinityUser.username,
        success,
        result: provider.parsed ?? {},
        skylers: true,
      }).catch(() => {});
    }
    return;
  }

  res.status(400).json({ success: false, error: "Fonte inválida." });
});

// ─── CPF Full single-entry logger ──────────────────────────────────────────
// Dedup cache: key = `${username}:${cpf}`, value = timestamp of last log
const _cpfFullDedup = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 10_000;
  for (const [k, ts] of _cpfFullDedup.entries()) if (ts < cutoff) _cpfFullDedup.delete(k);
}, 30_000);

router.post("/log-cpffull", requireAuth, async (req, res) => {
  const { cpf } = req.body ?? {};
  const username = req.infinityUser!.username;
  const dedupKey = `${username}:${String(cpf ?? "").replace(/\D/g, "").slice(0, 11)}`;
  const lastLogged = _cpfFullDedup.get(dedupKey) ?? 0;
  if (Date.now() - lastLogged < 5_000) {
    // Duplicate within 5s (React StrictMode double-fire) — acknowledge but skip DB write
    res.json({ ok: true, deduped: true });
    return;
  }
  _cpfFullDedup.set(dedupKey, Date.now());
  const isAdmin = req.infinityUser!.role === "admin";
  if (!isAdmin) {
    const cpfFullCount = await getUserSkylersDailyByTipo(username, "cpffull");
    if (cpfFullCount >= SKYLERS_TOTAL_LIMIT) {
      res.status(429).json({
        success: false,
        error: `Limite de ${SKYLERS_TOTAL_LIMIT} consultas CPF Full Skylers atingido hoje.`,
        rateLimited: true,
        skylersLimited: true,
        limitInfo: { used: cpfFullCount, limit: SKYLERS_TOTAL_LIMIT },
      });
      return;
    }
  }
  const query = String(cpf ?? "").replace(/\D/g, "").slice(0, 11) || "unknown";
  await logConsulta({ tipo: "cpffull", query, username, success: true, result: { fields: [], sections: [], raw: "" } });
  bumpCaches(username);
  bumpSkylersTipoCache(username, "cpffull");
  res.json({ ok: true });
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

// ─── Notification image upload (base64 → temp URL) ───────────────────────────
router.post("/notifications/upload", requireAuth, (req, res) => {
  const user = req.infinityUser;
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Apenas admins" }); return; }
  const { data, mimeType } = req.body as { data?: string; mimeType?: string };
  if (!data || !mimeType) { res.status(400).json({ error: "data e mimeType obrigatórios" }); return; }
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowed.includes(mimeType)) { res.status(400).json({ error: "Tipo de imagem inválido" }); return; }
  const dataUri = `data:${mimeType};base64,${data}`;
  const id = crypto.randomBytes(12).toString("hex");
  const NOTIF_IMG_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  fotoStore.set(id, { dataUri, expires: Date.now() + NOTIF_IMG_TTL });
  res.json({ url: `/api/infinity/foto/${id}` });
});

// ─── Notification endpoints ──────────────────────────────────────────────────
router.get("/notifications", requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(infinityNotificationsTable)
      .orderBy(desc(infinityNotificationsTable.createdAt))
      .limit(50);
    res.json(rows.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      imageUrl: r.imageUrl ?? undefined,
      createdAt: r.createdAt.toISOString(),
      authorName: r.authorName,
    })));
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar notificações" });
  }
});

router.post("/notifications", requireAuth, async (req, res) => {
  const user = req.infinityUser;
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Apenas admins podem enviar novidades" }); return; }
  const { title, body, imageUrl } = req.body as { title?: string; body?: string; imageUrl?: string };
  if (!title?.trim() || !body?.trim()) { res.status(400).json({ error: "Título e mensagem são obrigatórios" }); return; }
  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, c => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'" }[c] ?? c));
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const [row] = await db.insert(infinityNotificationsTable).values({
      id,
      title: stripHtml(title.trim()).slice(0, 120),
      body: stripHtml(body.trim()).slice(0, 1000),
      imageUrl: imageUrl?.trim() || null,
      authorName: user.username,
    }).returning();
    res.status(201).json({
      id: row.id,
      title: row.title,
      body: row.body,
      imageUrl: row.imageUrl ?? undefined,
      createdAt: row.createdAt.toISOString(),
      authorName: row.authorName,
    });
  } catch (e) {
    res.status(500).json({ error: "Erro ao salvar notificação" });
  }
});

router.delete("/notifications/:id", requireAuth, async (req, res) => {
  const user = req.infinityUser;
  if (!user || user.role !== "admin") { res.status(403).json({ error: "Apenas admins podem remover novidades" }); return; }
  try {
    const deleted = await db
      .delete(infinityNotificationsTable)
      .where(eq(infinityNotificationsTable.id, String(req.params.id)))
      .returning();
    if (deleted.length === 0) { res.status(404).json({ error: "Notificação não encontrada" }); return; }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao remover notificação" });
  }
});

export default router;

