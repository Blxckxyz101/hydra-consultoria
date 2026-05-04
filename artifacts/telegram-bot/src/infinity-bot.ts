import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL = "https://t.me/Blxckxyz";
const SUPPORT_URL2 = "https://t.me/xxmathexx";
const BOT_BANNER_URL = process.env.INFINITY_BOT_BANNER_URL
  ?? (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/static/logo.png` : "");
const AUTHOR = "blxckxyz";
const LINE = "═".repeat(40);
const LINE2 = "─".repeat(40);

// ── Access control ────────────────────────────────────────────────────────────
// Channel users must join to use the bot (private invite channel)
const CHANNEL_INVITE = "https://t.me/+7sBxmhOFPhJlYzcx";
// Numeric ID of the channel — set INFINITY_CHANNEL_ID env var
// (admin can discover it by sending /channelid in the channel after adding the bot)
let CHANNEL_ID: number | null = process.env.INFINITY_CHANNEL_ID
  ? Number(process.env.INFINITY_CHANNEL_ID)
  : null;

// Admin usernames (lowercase, no @)
const ADMIN_USERNAMES = new Set(["blxckxyz", "xxmathexx"]);
// Admin user IDs (more reliable than username)
const ADMIN_IDS = new Set<number>();

// Verified channel members (user IDs — persists in-memory)
const verifiedUsers = new Set<number>();
// Authorized group/supergroup chat IDs
const authorizedGroups = new Set<number>();

function isAdmin(userId: number, username?: string): boolean {
  if (ADMIN_IDS.has(userId)) return true;
  if (username && ADMIN_USERNAMES.has(username.toLowerCase())) {
    ADMIN_IDS.add(userId); // cache for next time
    return true;
  }
  return false;
}

async function checkChannelMembership(
  telegram: Telegraf["telegram"],
  userId: number
): Promise<boolean> {
  if (!CHANNEL_ID) return true; // no channel configured → allow all (dev mode)
  try {
    const member = await telegram.getChatMember(CHANNEL_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function isAuthorizedUser(
  telegram: Telegraf["telegram"],
  userId: number,
  username?: string
): Promise<boolean> {
  // Admins always allowed
  if (isAdmin(userId, username)) return true;
  // Already verified
  if (verifiedUsers.has(userId)) return true;
  // Check channel membership
  const ok = await checkChannelMembership(telegram, userId);
  if (ok) verifiedUsers.add(userId);
  return ok;
}

// ── All tipos (flat list) ─────────────────────────────────────────────────────
const TIPOS = [
  // ── Geass / ambos ─────────────────────────────────────────────────────────
  { id: "cpf",         label: "🪪 CPF",            prompt: "CPF (11 dígitos, só números)" },
  { id: "nome",        label: "👤 Nome",            prompt: "nome completo da pessoa" },
  { id: "telefone",    label: "📞 Telefone",        prompt: "telefone com DDD (ex: 11999887766)" },
  { id: "email",       label: "📧 E-mail",          prompt: "endereço de e-mail" },
  { id: "placa",       label: "🚗 Placa",           prompt: "placa do veículo (ex: ABC1D23)" },
  { id: "cnpj",        label: "🏭 CNPJ",            prompt: "CNPJ (14 dígitos, só números)" },
  { id: "cep",         label: "📍 CEP",             prompt: "CEP (8 dígitos, só números)" },
  { id: "pix",         label: "💳 PIX",             prompt: "chave PIX (CPF, e-mail, telefone ou aleatória)" },
  { id: "rg",          label: "🪪 RG",              prompt: "número do RG" },
  { id: "mae",         label: "👩 Mãe",             prompt: "CPF da pessoa (busca mãe)" },
  { id: "pai",         label: "👨 Pai",             prompt: "CPF da pessoa (busca pai)" },
  { id: "parentes",    label: "👨‍👩‍👧 Parentes",     prompt: "CPF da pessoa" },
  { id: "chassi",      label: "🔩 Chassi",          prompt: "número do chassi" },
  { id: "renavam",     label: "📄 Renavam",         prompt: "número do Renavam" },
  { id: "cnh",         label: "🪪 CNH",             prompt: "CPF do condutor" },
  { id: "socios",      label: "🤝 Sócios",          prompt: "CNPJ da empresa" },
  { id: "fucionarios", label: "👷 Funcionários",    prompt: "CNPJ da empresa" },
  { id: "empregos",    label: "💼 Empregos",        prompt: "CPF da pessoa" },
  { id: "cns",         label: "🏥 CNS",             prompt: "número do Cartão Nacional de Saúde" },
  { id: "nis",         label: "💰 NIS/PIS",         prompt: "número do NIS ou PIS" },
  { id: "obito",       label: "🕊️ Óbito",          prompt: "CPF da pessoa" },
  { id: "vacinas",     label: "💉 Vacinas",         prompt: "CPF da pessoa" },
  // ── Skylers exclusivos ────────────────────────────────────────────────────
  { id: "cpfbasico",   label: "📋 CPF Básico",      prompt: "CPF (11 dígitos)" },
  { id: "foto",        label: "📸 Foto CNH",        prompt: "CPF do condutor (11 dígitos)" },
  { id: "titulo",      label: "🗳️ Título Eleitor",  prompt: "CPF (11 dígitos)" },
  { id: "score",       label: "📊 Score",           prompt: "CPF (11 dígitos)" },
  { id: "irpf",        label: "🧾 IRPF",            prompt: "CPF (11 dígitos)" },
  { id: "beneficios",  label: "🎁 Benefícios",      prompt: "CPF (11 dígitos)" },
  { id: "mandado",     label: "⚠️ Mandado",         prompt: "CPF (11 dígitos)" },
  { id: "dividas",     label: "🏦 Dívidas",         prompt: "CPF (11 dígitos)" },
  { id: "bens",        label: "⭐ Bens",            prompt: "CPF (11 dígitos)" },
  { id: "processos",   label: "⚖️ Processos",       prompt: "CPF (11 dígitos)" },
  { id: "spc",         label: "💳 SPC",             prompt: "CPF (11 dígitos)" },
  { id: "iptu",        label: "🏠 IPTU",            prompt: "CPF (11 dígitos)" },
  { id: "certidoes",   label: "📜 Certidões",       prompt: "CPF (11 dígitos)" },
  { id: "cnhfull",     label: "🛡️ CNH Full",        prompt: "CPF do condutor (11 dígitos)" },
  { id: "biometria",   label: "🫆 Biometria",        prompt: "CPF da pessoa (11 dígitos)" },
  // Fotos por estado
  { id: "fotoma",       label: "📸 Foto MA",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoce",       label: "📸 Foto CE",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotosp",       label: "📸 Foto SP",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotorj",       label: "📸 Foto RJ",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoms",       label: "📸 Foto MS",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotonc",       label: "📸 Foto Nacional",    prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoes",       label: "📸 Foto ES",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fototo",       label: "📸 Foto TO",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoro",       label: "📸 Foto RO",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotomapresos", label: "📸 Foto MA Presos",   prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotopi",       label: "📸 Foto PI",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotopr",       label: "📸 Foto PR",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotodf",       label: "📸 Foto DF",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoal",       label: "📸 Foto AL",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotogo",       label: "📸 Foto GO",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotopb",       label: "📸 Foto PB",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotope",       label: "📸 Foto PE",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotorn",       label: "📸 Foto RN",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotoba",       label: "📸 Foto BA",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "fotomg",       label: "📸 Foto MG",          prompt: "CPF da pessoa (11 dígitos)" },
  { id: "crlvtofoto",   label: "🖼️ CRLV TO (Foto)",  prompt: "placa do veículo (ex: ABC1D23)" },
  { id: "crlvmtfoto",   label: "🖼️ CRLV MT (Foto)",  prompt: "placa do veículo (ex: ABC1D23)" },
] as const;

type TipoId = (typeof TIPOS)[number]["id"];

// Tipos que vão direto para Skylers (sem seletor de base)
const SKYLERS_ONLY_TIPOS = new Set<string>([
  "cpfbasico", "foto", "biometria", "titulo", "score", "irpf", "beneficios",
  "mandado", "dividas", "bens", "processos", "spc", "iptu", "certidoes", "cnhfull",
  // Fotos por estado
  "fotoma","fotoce","fotosp","fotorj","fotoms","fotonc","fotoes","fototo","fotoro",
  "fotomapresos","fotopi","fotopr","fotodf","fotoal","fotogo","fotopb","fotope",
  "fotorn","fotoba","fotomg","crlvtofoto","crlvmtfoto",
]);

// ── Styled query prompts ───────────────────────────────────────────────────────
const TIPO_PROMPT: Record<string, { title: string; lines: string[] }> = {
  cpf:         { title: "CONSULTA DE CPF",           lines: ["DIGITE O CPF QUE DESEJA CONSULTAR", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  nome:        { title: "CONSULTA POR NOME",          lines: ["DIGITE O NOME COMPLETO DA PESSOA"] },
  telefone:    { title: "CONSULTA DE TELEFONE",       lines: ["DIGITE O TELEFONE COM DDD", "EX: 11999887766 (SEM ESPAÇOS)"] },
  email:       { title: "CONSULTA DE E-MAIL",         lines: ["DIGITE O ENDEREÇO DE E-MAIL"] },
  placa:       { title: "CONSULTA DE PLACA",          lines: ["DIGITE A PLACA DO VEÍCULO", "EX: ABC1D23 (SEM HÍFEN)"] },
  cnpj:        { title: "CONSULTA DE CNPJ",           lines: ["DIGITE O CNPJ DA EMPRESA", "OBS: 14 DÍGITOS, APENAS NÚMEROS"] },
  cep:         { title: "CONSULTA DE CEP",            lines: ["DIGITE O CEP", "OBS: 8 DÍGITOS, APENAS NÚMEROS"] },
  pix:         { title: "CONSULTA DE CHAVE PIX",      lines: ["DIGITE A CHAVE PIX", "OBS: CPF, E-MAIL, TELEFONE OU ALEATÓRIA"] },
  rg:          { title: "CONSULTA DE RG",             lines: ["DIGITE O NÚMERO DO RG"] },
  mae:         { title: "CONSULTA DE MÃE",            lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  pai:         { title: "CONSULTA DE PAI",            lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  parentes:    { title: "CONSULTA DE PARENTES",       lines: ["DIGITE O CPF DA PESSOA"] },
  chassi:      { title: "CONSULTA DE CHASSI",         lines: ["DIGITE O NÚMERO DO CHASSI DO VEÍCULO"] },
  renavam:     { title: "CONSULTA DE RENAVAM",        lines: ["DIGITE O NÚMERO DO RENAVAM DO VEÍCULO"] },
  cnh:         { title: "CONSULTA DE CNH",            lines: ["DIGITE O CPF DO CONDUTOR", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  socios:      { title: "CONSULTA DE SÓCIOS",         lines: ["DIGITE O CNPJ DA EMPRESA", "OBS: 14 DÍGITOS, APENAS NÚMEROS"] },
  fucionarios: { title: "CONSULTA DE FUNCIONÁRIOS",   lines: ["DIGITE O CNPJ DA EMPRESA", "OBS: 14 DÍGITOS, APENAS NÚMEROS"] },
  empregos:    { title: "CONSULTA DE EMPREGOS",       lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  cns:         { title: "CONSULTA DE CNS",            lines: ["DIGITE O NÚMERO DO CARTÃO NACIONAL DE SAÚDE"] },
  nis:         { title: "CONSULTA DE NIS/PIS",        lines: ["DIGITE O NÚMERO DO NIS OU PIS"] },
  obito:       { title: "CONSULTA DE ÓBITO",          lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  vacinas:     { title: "CONSULTA DE VACINAS",        lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  // ── Skylers exclusivos ────────────────────────────────────────────────────
  cpfbasico:   { title: "CPF BÁSICO  ·  SKYLERS",     lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  foto:        { title: "FOTO CNH  ·  SKYLERS",       lines: ["DIGITE O CPF DO CONDUTOR", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  titulo:      { title: "TÍTULO ELEITOR  ·  SKYLERS", lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  score:       { title: "SCORE DE CRÉDITO  ·  SKYLERS",lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  irpf:        { title: "IRPF  ·  SKYLERS",           lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  beneficios:  { title: "BENEFÍCIOS  ·  SKYLERS",     lines: ["DIGITE O CPF", "OBS: Bolsa Família, BPC, etc.", "11 DÍGITOS, APENAS NÚMEROS"] },
  mandado:     { title: "MANDADO DE PRISÃO  ·  SKYLERS",lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  dividas:     { title: "DÍVIDAS  ·  SKYLERS",        lines: ["DIGITE O CPF", "OBS: BACEN, FGTS, etc.", "11 DÍGITOS, APENAS NÚMEROS"] },
  bens:        { title: "BENS PATRIMONIAIS  ·  SKYLERS",lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  processos:   { title: "PROCESSOS JUDICIAIS  ·  SKYLERS",lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  spc:         { title: "SPC  ·  SKYLERS",            lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  iptu:        { title: "IPTU  ·  SKYLERS",           lines: ["DIGITE O CPF DO PROPRIETÁRIO", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  certidoes:   { title: "CERTIDÕES  ·  SKYLERS",      lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  cnhfull:       { title: "CNH COMPLETO  ·  SKYLERS",     lines: ["DIGITE O CPF DO CONDUTOR", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  biometria:     { title: "BIOMETRIA  ·  SKYLERS",        lines: ["DIGITE O CPF DA PESSOA", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  // Fotos por estado
  fotoma:        { title: "FOTO MA  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoce:        { title: "FOTO CE  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotosp:        { title: "FOTO SP  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotorj:        { title: "FOTO RJ  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoms:        { title: "FOTO MS  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotonc:        { title: "FOTO NACIONAL  ·  SKYLERS",    lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoes:        { title: "FOTO ES  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fototo:        { title: "FOTO TO  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoro:        { title: "FOTO RO  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotomapresos:  { title: "FOTO MA PRESOS  ·  SKYLERS",   lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotopi:        { title: "FOTO PI  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotopr:        { title: "FOTO PR  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotodf:        { title: "FOTO DF  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoal:        { title: "FOTO AL  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotogo:        { title: "FOTO GO  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotopb:        { title: "FOTO PB  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotope:        { title: "FOTO PE  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotorn:        { title: "FOTO RN  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotoba:        { title: "FOTO BA  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  fotomg:        { title: "FOTO MG  ·  SKYLERS",          lines: ["DIGITE O CPF", "OBS: 11 DÍGITOS, APENAS NÚMEROS"] },
  crlvtofoto:    { title: "CRLV TO (FOTO)  ·  SKYLERS",   lines: ["DIGITE A PLACA DO VEÍCULO", "EX: ABC1D23 (SEM HÍFEN)"] },
  crlvmtfoto:    { title: "CRLV MT (FOTO)  ·  SKYLERS",   lines: ["DIGITE A PLACA DO VEÍCULO", "EX: ABC1D23 (SEM HÍFEN)"] },
};

function buildQueryPrompt(tipoId: string): string {
  const p = TIPO_PROMPT[tipoId];
  if (!p) {
    const tipo = TIPOS.find((t) => t.id === tipoId);
    return `Envie o <b>${tipo?.prompt ?? tipoId}</b>:`;
  }
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ • ${p.title}\n` +
    `┠────────────────────────────\n` +
    p.lines.map((l) => `┃ ${l}`).join("\n") + "\n" +
    `╰────────────────────────────╯`
  );
}

// ── Session ───────────────────────────────────────────────────────────────────
interface BotSession {
  state: "idle" | "awaiting_query" | "awaiting_base";
  tipo?: string;
  dados?: string;
}
const sessions = new Map<number, BotSession>();
function getSession(userId: number): BotSession {
  if (!sessions.has(userId)) sessions.set(userId, { state: "idle" });
  return sessions.get(userId)!;
}
function resetSession(userId: number) {
  sessions.set(userId, { state: "idle" });
}

// Tipos that support external base selection
const EXTERNAL_BASES_TIPOS = new Set(["cpf", "nome", "cns", "vacinas"]);

// Internal API base (API server runs on port 8080 in the same container)
const INTERNAL_API_BASE = "http://localhost:8080";
const INTERNAL_KEY = "infinity-bot";

// ── Tier system ────────────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 10;

// Tipos que o free pode usar em grupos
const FREE_TIPOS = new Set([
  "cpf", "nome", "telefone", "email", "placa", "cnpj", "cep", "pix", "rg",
]);

// Usuários BLACK (admin-managed, in-memory)
const PAID_USERS = new Set<number>();

// Rastreador de consultas diárias: "userId:DD/MM/YYYY" → count
const freeQueryTracker = new Map<string, number>();

function isPaid(userId: number, username?: string): boolean {
  return isAdmin(userId, username) || PAID_USERS.has(userId);
}

function getFreeKey(userId: number): string {
  return `${userId}:${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
}

function getFreeUsed(userId: number): number {
  return freeQueryTracker.get(getFreeKey(userId)) ?? 0;
}

function trackFreeQuery(userId: number): void {
  const k = getFreeKey(userId);
  freeQueryTracker.set(k, (freeQueryTracker.get(k) ?? 0) + 1);
}

function buildUpgradeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("💎 CONTRATAR PLANO BLACK", SUPPORT_URL)],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL), Markup.button.url("💬 @xxmathexx", SUPPORT_URL2)] as any,
    [Markup.button.callback("↩ Voltar ao Menu", "home")],
  ]);
}

function buildUpgradeTipoMsg(label: string): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ 💎 MÓDULO EXCLUSIVO — BLACK\n` +
    `┠────────────────────────────\n` +
    `┃ • MÓDULO: <b>${label}</b>\n` +
    `┃ • STATUS: 🔒 Requer plano BLACK\n` +
    `┠────────────────────────────\n` +
    `┃ ✅ PLANO BLACK INCLUI:\n` +
    `┃  + Todos os módulos disponíveis\n` +
    `┃  + Foto CNH, Biometria, Score...\n` +
    `┃  + Sem limite de consultas\n` +
    `┃  + Acesso via chat privado\n` +
    `┃  + Painel web completo\n` +
    `┠────────────────────────────\n` +
    `┃ 👇 CLIQUE ABAIXO PARA CONTRATAR\n` +
    `╰────────────────────────────╯`
  );
}

function buildUpgradeLimitMsg(used: number): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ ⚠️ LIMITE DIÁRIO ATINGIDO\n` +
    `┠────────────────────────────\n` +
    `┃ • USADAS: <b>${used}/${FREE_DAILY_LIMIT}</b> consultas hoje\n` +
    `┃ • RENOVA: meia-noite (horário BRT)\n` +
    `┠────────────────────────────\n` +
    `┃ Com o plano <b>BLACK</b>:\n` +
    `┃  + Consultas ilimitadas\n` +
    `┃  + Todos os módulos\n` +
    `┃  + Acesso pelo chat privado\n` +
    `┠────────────────────────────\n` +
    `┃ 👇 UPGRADE AGORA\n` +
    `╰────────────────────────────╯`
  );
}

function buildUpgradeDMMsg(): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ 🔒 ACESSO PRIVADO — PLANO BLACK\n` +
    `┠────────────────────────────\n` +
    `┃ O chat privado é exclusivo para\n` +
    `┃ assinantes do plano <b>BLACK</b>.\n` +
    `┠────────────────────────────\n` +
    `┃ ✅ PLANO BLACK INCLUI:\n` +
    `┃  + Acesso total — todos os módulos\n` +
    `┃  + Foto CNH · Biometria · Score\n` +
    `┃  + IRPF · Mandado · SPC · Bens\n` +
    `┃  + Consultas ilimitadas\n` +
    `┃  + Painel web completo\n` +
    `┠────────────────────────────\n` +
    `┃ 👇 CONTRATE AGORA\n` +
    `╰────────────────────────────╯`
  );
}

function buildBaseKeyboard(tipo: string, freeMode: boolean = false) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (["cpf", "nome"].includes(tipo)) {
    rows.push([Markup.button.callback("🏥 SISREG-III", "base:sisreg")]);
  }
  if (["cpf", "cns", "nome", "vacinas"].includes(tipo)) {
    rows.push([Markup.button.callback("💉 SI-PNI", "base:sipni")]);
  }
  if (tipo === "cpf") {
    rows.push([Markup.button.callback("💳 CrediLink (Skylers)", "base:credilink")]);
  }
  rows.push([Markup.button.callback("∞ Infinity Search", "base:infinity")]);
  if (freeMode) {
    rows.push([Markup.button.url("💎 BLACK — Acesso Completo", SUPPORT_URL)] as any);
  }
  rows.push([Markup.button.callback("❌ Cancelar", "home")]);
  return Markup.inlineKeyboard(rows);
}

async function executeExternalQuery(
  ctx: { telegram: Telegraf["telegram"]; chat: { id: number } },
  source: "sisreg" | "sipni",
  tipo: string,
  dados: string,
  loadMsgId: number,
) {
  const chatId = ctx.chat.id;
  const sourceLabel = source === "sisreg" ? "🏥 SISREG-III" : "💉 SI-PNI";
  try {
    const r = await fetch(`${INTERNAL_API_BASE}/api/infinity/external/${source}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ tipo, dados }),
      signal: AbortSignal.timeout(35_000),
    });

    const json = await r.json() as { success: boolean; data?: string; error?: string };

    if (!json.success || !json.data) {
      await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
        `⚠️ <b>Sem resultado no ${sourceLabel}</b>\n\n` +
        `<code>${json.error ?? "Nenhum dado encontrado para este valor."}</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) });
      return;
    }

    const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const txtContent =
      `${"═".repeat(40)}\n` +
      `       ∞  INFINITY SEARCH  ∞\n` +
      `${"═".repeat(40)}\n` +
      `  Fonte    : ${sourceLabel}\n` +
      `  Consulta : ${tipo.toUpperCase()}\n` +
      `  Dado     : ${dados}\n` +
      `  Data     : ${now}\n` +
      `${"═".repeat(40)}\n\n` +
      json.data + "\n\n" +
      `${"═".repeat(40)}\n` +
      `  Made by ${AUTHOR} | Infinity Search\n` +
      `  Suporte : ${SUPPORT_URL}\n` +
      `${"═".repeat(40)}\n`;

    await ctx.telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

    const filename = `${source}-${tipo}-${Date.now()}.txt`;
    const sentDoc = await ctx.telegram.sendDocument(chatId,
      { source: Buffer.from(txtContent, "utf-8"), filename },
      {
        caption: `✅ <b>Resultado ${sourceLabel}</b>\n\n<code>◈</code> <b>Tipo:</b> <code>${tipo.toUpperCase()}</code>\n<code>◈</code> <b>Dado:</b> <code>${dados}</code>`,
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]),
      }
    );
    const kb = resultKeyboard(chatId, sentDoc.message_id);
    await ctx.telegram.editMessageReplyMarkup(chatId, sentDoc.message_id, undefined, kb.reply_markup).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
      `❌ <b>Erro ao consultar ${sourceLabel}:</b>\n<code>${msg.slice(0, 200)}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) }
    ).catch(() => {});
  }
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseGeassResult(raw: string): { fields: [string, string][]; sections: { name: string; items: string[] }[] } {
  const fields: [string, string][] = [];
  const sections: { name: string; items: string[] }[] = [];

  if (/\bBASE\s+\d+\b/i.test(raw)) {
    const segs = raw.split(/\s*BASE\s+\d+\s*/i).filter((s) => s.includes(":"));
    const items: string[] = [];
    for (const seg of segs) {
      const pairs: string[] = [];
      const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const k = m[1].trim(); const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
        if (k && v) pairs.push(`${k}: ${v}`);
      }
      if (pairs.length > 0) items.push(pairs.join(" | "));
    }
    if (items.length > 0) sections.push({ name: "REGISTROS", items });
    return { fields, sections };
  }

  const SEP = " \u23AF ";
  if (raw.includes("\u23AF")) {
    const parts = raw.split(SEP);
    let currentKey = parts[0].match(/\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})$/)?.[1] ?? "";
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes("•")) {
        const secMatch = /^([A-Za-záéíóúÁÉÍÓÚ_0-9 ]+):\s*\(\s*\d+\s*-\s*Encontrados?\s*\)/i.exec(part.trim());
        if (secMatch) {
          const bulletIdx = part.indexOf("•");
          const items = part.slice(bulletIdx).split("•").map((s) => s.trim()).filter(Boolean);
          sections.push({ name: secMatch[1].trim().toUpperCase(), items });
          currentKey = items[items.length - 1]?.match(/\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})$/)?.[1] ?? "";
          continue;
        }
      }
      if (i === parts.length - 1) { if (currentKey && part.trim()) fields.push([currentKey, part.trim()]); break; }
      const nk = part.match(/^(.*?)\s+([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,})*)$/);
      if (nk) { if (currentKey && nk[1].trim()) fields.push([currentKey, nk[1].trim()]); currentKey = nk[2].trim(); }
    }
    return { fields, sections };
  }

  const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:\n]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    fields.push([m[1].trim(), m[2].trim().replace(/`/g, "").replace(/\s+/g, " ")]);
  }
  return { fields, sections };
}

// ── .txt formatter ────────────────────────────────────────────────────────────
function formatResultTxt(tipo: string, dados: string, parsed: { fields: [string, string][]; sections: { name: string; items: string[] }[] }, raw: string): string {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [];
  lines.push(LINE); lines.push(`       ∞  INFINITY SEARCH  ∞`); lines.push(LINE);
  lines.push(`  Consulta  : ${tipo.toUpperCase()}`);
  lines.push(`  Dado      : ${dados}`);
  lines.push(`  Data      : ${now}`);
  lines.push(LINE); lines.push("");
  if (parsed.fields.length > 0) {
    lines.push("DADOS ENCONTRADOS"); lines.push(LINE2);
    const maxKey = Math.min(22, Math.max(...parsed.fields.map(([k]) => k.length)));
    for (const [k, v] of parsed.fields) lines.push(`  ${k.padEnd(maxKey)} : ${v}`);
    lines.push("");
  }
  for (const sec of parsed.sections) {
    lines.push(`${sec.name}  (${sec.items.length} registro${sec.items.length !== 1 ? "s" : ""})`);
    lines.push(LINE2);
    sec.items.forEach((item, idx) => lines.push(`  ${String(idx + 1).padStart(3)}.  ${item}`));
    lines.push("");
  }
  if (parsed.fields.length === 0 && parsed.sections.length === 0 && raw) {
    lines.push("RESPOSTA BRUTA"); lines.push(LINE2); lines.push(raw.slice(0, 3000)); lines.push("");
  }
  lines.push(LINE);
  lines.push(`  Made by ${AUTHOR} | Infinity Search`);
  lines.push(`  Suporte : ${SUPPORT_URL}`);
  lines.push(`  Suporte : ${SUPPORT_URL2}`);
  lines.push(LINE);
  return lines.join("\n");
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function buildHomeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍  Nova Consulta", "consultar")],
    [Markup.button.callback("❓ Ajuda", "show_ajuda"), Markup.button.callback("💬 Suporte", "show_suporte")],
  ]);
}

function buildSupportKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("💬 @Blxckxyz", SUPPORT_URL), Markup.button.url("💬 @xxmathexx", SUPPORT_URL2)] as any,
    [Markup.button.callback("↩ Voltar", "home")],
  ]);
}

function buildTiposKeyboard(freeMode: boolean = false) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const arr = [...TIPOS];
  for (let i = 0; i < arr.length; i += 2) {
    const t1 = arr[i];
    const t2 = arr[i + 1];
    const lock1 = freeMode && !FREE_TIPOS.has(t1.id);
    const lock2 = t2 && freeMode && !FREE_TIPOS.has(t2.id);
    rows.push([
      Markup.button.callback(lock1 ? `🔒 ${t1.label}` : t1.label, `tipo:${t1.id}`),
      ...(t2 ? [Markup.button.callback(lock2 ? `🔒 ${t2.label}` : t2.label, `tipo:${t2.id}`)] : []),
    ]);
  }
  if (freeMode) {
    rows.push([Markup.button.url("💎 Ver Plano BLACK", SUPPORT_URL)] as any);
  }
  rows.push([Markup.button.callback("↩ Cancelar", "home")]);
  return Markup.inlineKeyboard(rows);
}

function resultKeyboard(chatId: number, msgId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Nova Consulta", "consultar"), Markup.button.callback("🗑 Apagar", `del:${chatId}:${msgId}`)],
    [Markup.button.url("💬 Suporte", SUPPORT_URL)] as any,
  ]);
}

// ── Not authorized reply ──────────────────────────────────────────────────────
async function sendNotAuthorized(ctx: { replyWithHTML: (t: string, extra?: object) => Promise<any> }) {
  await ctx.replyWithHTML(
    `🔒 <b>Acesso restrito</b>\n\n` +
    `Para usar o <b>Infinity Search Bot</b>, você precisa ser membro do canal oficial.\n\n` +
    `Entre no canal e tente novamente:`,
    Markup.inlineKeyboard([
      [Markup.button.url("📢 Entrar no Canal", CHANNEL_INVITE)],
      [Markup.button.url("💬 Suporte", SUPPORT_URL)] as any,
    ])
  );
}

// ── Core query executor ───────────────────────────────────────────────────────
async function executeQuery(
  ctx: { telegram: Telegraf["telegram"]; chat: { id: number } },
  tipo: string,
  dados: string,
  loadMsgId: number,
) {
  const chatId = ctx.chat.id;
  try {
    const url = `${GEASS_API_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(GEASS_API_KEY)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(28000) });

    if (!resp.ok) {
      await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
        `❌ <b>Erro ${resp.status}</b>\n\nFalha ao consultar o provedor. Tente novamente.`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) });
      return;
    }

    const json = await resp.json() as { status?: string; resposta?: string };

    if (!json.resposta || json.status === "erro" || json.resposta.trim() === "") {
      await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
        `⚠️ <b>Sem resultado</b>\n\n<code>${tipo.toUpperCase()}</code>: <code>${dados}</code>\n\nNenhum dado encontrado para este valor.`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) });
      return;
    }

    const raw = json.resposta;
    const parsed = parseGeassResult(raw);
    const totalRegistros = parsed.sections.reduce((a, s) => a + s.items.length, 0);
    const txtContent = formatResultTxt(tipo, dados, parsed, raw);

    const summaryParts: string[] = [
      `✅ <b>Resultado encontrado</b>`,
      ``,
      `<code>◈</code> <b>Tipo:</b> <code>${tipo.toUpperCase()}</code>`,
      `<code>◈</code> <b>Dado:</b> <code>${dados}</code>`,
    ];
    if (parsed.fields.length > 0) summaryParts.push(`<code>◈</code> <b>Campos:</b> ${parsed.fields.length}`);
    if (totalRegistros > 0) summaryParts.push(`<code>◈</code> <b>Registros:</b> ${totalRegistros}`);

    const preview = parsed.fields.slice(0, 6);
    if (preview.length > 0) {
      summaryParts.push(``, `<b>Prévia:</b>`);
      for (const [k, v] of preview) summaryParts.push(`  <code>${k}</code>: <b>${v.slice(0, 60)}</b>`);
    } else if (parsed.sections.length > 0 && parsed.sections[0].items.length > 0) {
      summaryParts.push(``, `<b>Prévia (${parsed.sections[0].name}):</b>`);
      parsed.sections[0].items.slice(0, 3).forEach(item => summaryParts.push(`  • ${item.slice(0, 80)}`));
    }

    await ctx.telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

    const filename = `infinity-${tipo}-${Date.now()}.txt`;
    const sentDoc = await ctx.telegram.sendDocument(chatId,
      { source: Buffer.from(txtContent, "utf-8"), filename },
      {
        caption: summaryParts.join("\n").slice(0, 1024),
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]),
      }
    );

    const kb = resultKeyboard(chatId, sentDoc.message_id);
    await ctx.telegram.editMessageReplyMarkup(chatId, sentDoc.message_id, undefined, kb.reply_markup).catch(() => {});

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
      `❌ <b>Erro ao consultar:</b>\n<code>${msg.slice(0, 200)}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) }
    ).catch(() => {});
  }
}

// ── Skylers query executor ────────────────────────────────────────────────────
async function executeSkylersBotQuery(
  ctx: { telegram: Telegraf["telegram"]; chat: { id: number } },
  tipo: string,
  dados: string,
  loadMsgId: number,
) {
  const chatId = ctx.chat.id;
  const tipoObj = TIPOS.find((t) => t.id === tipo);
  const label = tipoObj?.label ?? tipo.toUpperCase();

  try {
    const r = await fetch(`${INTERNAL_API_BASE}/api/infinity/external/skylers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify({ tipo, dados }),
      signal: AbortSignal.timeout(35_000),
    });

    const json = await r.json() as { success: boolean; data?: unknown; error?: string };

    if (!json.success || !json.data) {
      await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
        `⚠️ <b>Sem resultado — ${label}</b>\n\n` +
        `<code>${json.error ?? "Nenhum dado encontrado para este valor."}</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) });
      return;
    }

    // data is a parsed { fields, sections, raw } object
    type ParsedData = { fields: { key: string; value: string }[]; sections: { name: string; items: string[] }[]; raw: string };
    const parsed = json.data as ParsedData;
    const fields: [string, string][] = (parsed.fields ?? []).map((f) => [f.key, f.value]);
    const sections = (parsed.sections ?? []).map((s) => ({ name: s.name, items: s.items }));
    const raw = parsed.raw ?? "";

    // Check for photo URL
    const fotoField = fields.find(([k]) => k === "FOTO_URL");
    const totalRegistros = sections.reduce((a, s) => a + s.items.length, 0);

    const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const lines: string[] = [];
    lines.push(LINE); lines.push(`       ∞  INFINITY SEARCH  ∞`); lines.push(LINE);
    lines.push(`  Base      : Skylers`);
    lines.push(`  Consulta  : ${tipo.toUpperCase()}`);
    lines.push(`  Dado      : ${dados}`);
    lines.push(`  Data      : ${now}`);
    lines.push(LINE); lines.push("");

    const displayFields = fields.filter(([k]) => k !== "FOTO_URL");
    if (displayFields.length > 0) {
      lines.push("DADOS ENCONTRADOS"); lines.push(LINE2);
      const maxKey = Math.min(22, Math.max(...displayFields.map(([k]) => k.length)));
      for (const [k, v] of displayFields) lines.push(`  ${k.padEnd(maxKey)} : ${v}`);
      lines.push("");
    }
    if (fotoField) {
      const isBase64 = fotoField[1].startsWith("data:image");
      lines.push("FOTO"); lines.push(LINE2);
      lines.push(isBase64 ? "  [imagem base64 — enviada como foto acima]" : `  URL: ${fotoField[1]}`);
      lines.push("");
    }
    for (const sec of sections) {
      lines.push(`${sec.name}  (${sec.items.length} registro${sec.items.length !== 1 ? "s" : ""})`);
      lines.push(LINE2);
      sec.items.forEach((item, idx) => lines.push(`  ${String(idx + 1).padStart(3)}.  ${item}`));
      lines.push("");
    }
    if (displayFields.length === 0 && sections.length === 0 && raw) {
      lines.push("RESPOSTA BRUTA"); lines.push(LINE2); lines.push(raw.slice(0, 3000)); lines.push("");
    }
    lines.push(LINE);
    lines.push(`  Made by ${AUTHOR} | Infinity Search`);
    lines.push(`  Suporte : ${SUPPORT_URL}`);
    lines.push(`  Suporte : ${SUPPORT_URL2}`);
    lines.push(LINE);
    const txtContent = lines.join("\n");

    const summaryParts: string[] = [
      `✅ <b>Resultado encontrado — Skylers</b>`,
      ``,
      `<code>◈</code> <b>Módulo:</b> <code>${tipo.toUpperCase()}</code>`,
      `<code>◈</code> <b>Dado:</b> <code>${dados}</code>`,
    ];
    if (displayFields.length > 0) summaryParts.push(`<code>◈</code> <b>Campos:</b> ${displayFields.length}`);
    if (totalRegistros > 0) summaryParts.push(`<code>◈</code> <b>Registros:</b> ${totalRegistros}`);
    if (fotoField) summaryParts.push(`<code>◈</code> <b>Foto:</b> enviada como imagem`);

    const preview = displayFields.slice(0, 5);
    if (preview.length > 0) {
      summaryParts.push(``, `<b>Prévia:</b>`);
      for (const [k, v] of preview) summaryParts.push(`  <code>${k}</code>: <b>${v.slice(0, 60)}</b>`);
    } else if (sections.length > 0 && sections[0].items.length > 0) {
      summaryParts.push(``, `<b>Prévia (${sections[0].name}):</b>`);
      sections[0].items.slice(0, 3).forEach((item) => summaryParts.push(`  • ${item.slice(0, 80)}`));
    }

    await ctx.telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

    // ── Send photo (base64 or URL) before the document ──────────────────────
    if (fotoField) {
      const fotoVal = fotoField[1];
      try {
        if (fotoVal.startsWith("data:image")) {
          // Base64 data URI → extract raw bytes and send as BufferedPhoto
          const b64 = fotoVal.replace(/^data:image\/\w+;base64,/, "");
          const buf = Buffer.from(b64, "base64");
          await ctx.telegram.sendPhoto(chatId,
            { source: buf, filename: `foto-${tipo}-${Date.now()}.jpg` },
            { caption: `📸 <b>Foto encontrada</b> · Módulo: <code>${tipo.toUpperCase()}</code>`, parse_mode: "HTML" }
          );
        } else if (/^https?:\/\//i.test(fotoVal)) {
          // Regular URL
          await ctx.telegram.sendPhoto(chatId, fotoVal,
            { caption: `📸 <b>Foto encontrada</b> · Módulo: <code>${tipo.toUpperCase()}</code>`, parse_mode: "HTML" }
          ).catch(async () => {
            // If URL send fails, just note it in summary (already handled)
          });
        }
      } catch {
        // Non-fatal — photo send failed, txt still goes out
      }
    }

    const filename = `skylers-${tipo}-${Date.now()}.txt`;
    const sentDoc = await ctx.telegram.sendDocument(chatId,
      { source: Buffer.from(txtContent, "utf-8"), filename },
      {
        caption: summaryParts.join("\n").slice(0, 1024),
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]),
      }
    );

    const kb = resultKeyboard(chatId, sentDoc.message_id);
    await ctx.telegram.editMessageReplyMarkup(chatId, sentDoc.message_id, undefined, kb.reply_markup).catch(() => {});

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.telegram.editMessageText(chatId, loadMsgId, undefined,
      `❌ <b>Erro ao consultar ${label}:</b>\n<code>${msg.slice(0, 200)}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Nova Consulta", "consultar")]]) }
    ).catch(() => {});
  }
}

// ── Bot factory ───────────────────────────────────────────────────────────────
export function startInfinityBot(): void {
  if (!INFINITY_BOT_TOKEN) {
    console.log("[InfinityBot] INFINITY_BOT_TOKEN não configurado — bot não iniciado.");
    return;
  }

  const bot = new Telegraf(INFINITY_BOT_TOKEN);

  // ── Register commands ──────────────────────────────────────────────────────
  const USER_COMMANDS = [
    { command: "start",     description: "🌐 Menu principal" },
    { command: "consultar", description: "🔍 Nova consulta OSINT" },
    { command: "cpf",       description: "🪪 Consultar CPF" },
    { command: "nome",      description: "👤 Consultar por Nome" },
    { command: "telefone",  description: "📞 Consultar Telefone" },
    { command: "email",     description: "📧 Consultar E-mail" },
    { command: "placa",     description: "🚗 Consultar Placa" },
    { command: "cnpj",      description: "🏭 Consultar CNPJ" },
    { command: "cep",       description: "📍 Consultar CEP" },
    { command: "pix",       description: "💳 Consultar chave PIX" },
    { command: "rg",        description: "🪪 Consultar RG" },
    { command: "ajuda",     description: "❓ Ajuda e lista de comandos" },
  ];
  const ADMIN_COMMANDS = [
    ...USER_COMMANDS,
    { command: "groupid",     description: "🆔 Ver ID do grupo/chat atual" },
    { command: "liberar",     description: "✅ Liberar bot neste grupo" },
    { command: "bloquear",    description: "🔒 Bloquear bot neste grupo" },
    { command: "channelid",   description: "📡 Capturar ID do canal" },
    { command: "addadmin",    description: "👑 Adicionar admin por ID" },
    { command: "status_bot",  description: "📊 Status do bot e grupos" },
    { command: "addpago",     description: "💎 Adicionar usuário BLACK (ID)" },
    { command: "removepago",  description: "❌ Remover usuário BLACK (ID)" },
    { command: "listpagos",   description: "📋 Listar usuários BLACK" },
  ];
  void bot.telegram.setMyCommands(USER_COMMANDS).catch(() => {});

  function buildHomeText(from: { username?: string; first_name?: string; id: number }): string {
    const name = from.username ? `@${from.username}` : (from.first_name || "usuário");
    const admin = isAdmin(from.id, from.username);
    const paid = isPaid(from.id, from.username);
    const cargo = admin ? "admin" : paid ? "black" : "membro";
    const plano = admin ? "admin" : paid ? "💎 BLACK" : "🔓 FREE";
    return (
      `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
      `┃\n` +
      `┃ • OLÁ, <b>${name}</b>!\n` +
      `┠────────────────────────────\n` +
      `┃ • CARGO: <code>${cargo}</code>\n` +
      `┃ • STATUS: ✅ ativo\n` +
      `┃ • PLANO: <code>${plano}</code>\n` +
      `┠────────────────────────────\n` +
      `┃  SELECIONE UMA OPÇÃO ABAIXO 👇🏻\n` +
      `╰────────────────────────────╯`
    );
  }

  const TIPO_MENU_TEXT =
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ • ESCOLHA O MÓDULO DE CONSULTA\n` +
    `┃ • QUE DESEJA UTILIZAR\n` +
    `┠────────────────────────────\n` +
    `┃ SELECIONE UMA OPÇÃO ABAIXO 👇🏻\n` +
    `╰────────────────────────────╯`;

  // ── Middleware: group authorization check ──────────────────────────────────
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat) return next();

    // In groups/supergroups: check group authorization
    if (chat.type === "group" || chat.type === "supergroup") {
      if (!authorizedGroups.has(chat.id)) {
        // Only respond to admins trying to liberate; ignore everything else silently
        const from = ctx.from;
        if (from && isAdmin(from.id, from.username)) return next();
        return; // ignore non-admin messages in unauthorized groups
      }
    }

    // In private chats: check channel membership
    if (chat.type === "private") {
      const from = ctx.from;
      if (!from) return next();
      if (isAdmin(from.id, from.username)) return next();

      const authorized = await isAuthorizedUser(bot.telegram, from.id, from.username);
      if (!authorized) {
        // Only send the not-authorized message for commands/messages, not callbacks (avoid spam)
        if ("message" in ctx || "callback_query" in ctx) {
          await sendNotAuthorized(ctx as any);
        }
        return;
      }
    }

    return next();
  });

  // ── Admin-only commands ────────────────────────────────────────────────────

  // /liberar — authorize current group (admin only)
  bot.command("liberar", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) {
      await ctx.replyWithHTML("❌ <b>Sem permissão.</b> Apenas admins podem liberar grupos.");
      return;
    }
    const chat = ctx.chat;
    if (chat.type === "private") {
      await ctx.replyWithHTML("ℹ️ Este comando funciona em grupos. Adicione o bot ao grupo e use /liberar lá.");
      return;
    }
    authorizedGroups.add(chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      `✅ <b>Grupo liberado!</b>\n\n` +
      `O bot está ativo neste grupo.\n` +
      `ID: <code>${chat.id}</code>`,
      Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "consultar")]])
    );
  });

  // /bloquear — remove group authorization (admin only)
  bot.command("bloquear", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) {
      await ctx.replyWithHTML("❌ <b>Sem permissão.</b>");
      return;
    }
    const chat = ctx.chat;
    authorizedGroups.delete(chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`🔒 <b>Grupo bloqueado.</b>\nID: <code>${chat.id}</code>`);
  });

  // /groupid — show current chat ID (admin only, useful before /liberar)
  bot.command("groupid", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const chat = ctx.chat;
    const tipo = chat.type === "private" ? "privado" : chat.type === "supergroup" ? "supergrupo" : chat.type;
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      `🆔 <b>ID deste chat</b>\n\n` +
      `ID: <code>${chat.id}</code>\n` +
      `Tipo: <code>${tipo}</code>\n` +
      `${"title" in chat && chat.title ? `Nome: <b>${chat.title}</b>\n` : ""}` +
      `\n` +
      `Use esse ID para liberar o bot:\n` +
      `<code>/liberar</code> — neste grupo\n` +
      `<code>/bloquear</code> — para remover acesso`,
      Markup.inlineKeyboard(
        chat.type !== "private"
          ? [[Markup.button.callback("✅ Liberar agora", "admin_liberar")]]
          : []
      )
    );
  });

  // /channelid — discover channel ID (admin only, use inside the channel)
  bot.command("channelid", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const chat = ctx.chat;
    CHANNEL_ID = chat.id;
    await ctx.replyWithHTML(
      `📡 <b>Canal detectado!</b>\n\nID: <code>${chat.id}</code>\n\n` +
      `Defina <code>INFINITY_CHANNEL_ID=${chat.id}</code> para persistir entre reinicializações.`
    );
  });

  // /addadmin — add admin by user ID (admin only)
  bot.command("addadmin", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const args = ctx.message.text.split(" ").slice(1);
    const uid = Number(args[0]);
    if (!uid) { await ctx.replyWithHTML("Uso: <code>/addadmin 123456789</code>"); return; }
    ADMIN_IDS.add(uid);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <code>${uid}</code> adicionado como admin.`);
  });

  // /status_bot — show access control status (admin only)
  bot.command("status_bot", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    await ctx.replyWithHTML([
      `📊 <b>Status do Bot</b>`,
      ``,
      `Canal ID: <code>${CHANNEL_ID ?? "não configurado"}</code>`,
      `Usuários verificados: <b>${verifiedUsers.size}</b>`,
      `Grupos autorizados: <b>${authorizedGroups.size}</b>`,
      `IDs dos grupos: ${[...authorizedGroups].map(id => `<code>${id}</code>`).join(", ") || "nenhum"}`,
      `Usuários BLACK: <b>${PAID_USERS.size}</b>`,
    ].join("\n"));
  });

  // /addpago — adicionar usuário BLACK (admin only)
  bot.command("addpago", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const args = ctx.message.text.split(" ").slice(1);
    const uid = Number(args[0]);
    if (!uid) { await ctx.replyWithHTML("Uso: <code>/addpago 123456789</code>"); return; }
    PAID_USERS.add(uid);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      `✅ <b>Usuário BLACK adicionado</b>\nID: <code>${uid}</code>\nTotal: <b>${PAID_USERS.size}</b>`
    );
  });

  // /removepago — remover usuário BLACK (admin only)
  bot.command("removepago", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const args = ctx.message.text.split(" ").slice(1);
    const uid = Number(args[0]);
    if (!uid) { await ctx.replyWithHTML("Uso: <code>/removepago 123456789</code>"); return; }
    const existed = PAID_USERS.delete(uid);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      existed
        ? `🗑 <b>Usuário BLACK removido</b>\nID: <code>${uid}</code>\nTotal: <b>${PAID_USERS.size}</b>`
        : `⚠️ ID <code>${uid}</code> não estava na lista BLACK.`
    );
  });

  // /listpagos — listar todos os usuários BLACK (admin only)
  bot.command("listpagos", async (ctx) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) return;
    const list = [...PAID_USERS];
    await ctx.replyWithHTML(
      list.length === 0
        ? `📋 <b>Usuários BLACK</b>\n\nNenhum usuário cadastrado.`
        : `📋 <b>Usuários BLACK</b> (${list.length})\n\n` + list.map(id => `• <code>${id}</code>`).join("\n")
    );
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    resetSession(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    const from = ctx.from;
    const chat = ctx.chat;
    const paid = isPaid(from.id, from.username);

    if (isAdmin(from.id, from.username)) {
      void bot.telegram.setMyCommands(ADMIN_COMMANDS, {
        scope: { type: "chat", chat_id: from.id },
      }).catch(() => {});
    }

    // DM: require BLACK tier
    if (chat.type === "private" && !paid) {
      if (BOT_BANNER_URL) {
        await ctx.replyWithPhoto(BOT_BANNER_URL, { caption: buildUpgradeDMMsg(), parse_mode: "HTML", ...buildUpgradeKeyboard() } as any).catch(() =>
          ctx.replyWithHTML(buildUpgradeDMMsg(), buildUpgradeKeyboard())
        );
      } else {
        await ctx.replyWithHTML(buildUpgradeDMMsg(), buildUpgradeKeyboard());
      }
      return;
    }

    if (BOT_BANNER_URL) {
      await ctx.replyWithPhoto(BOT_BANNER_URL, { caption: buildHomeText(from), parse_mode: "HTML", ...buildHomeKeyboard() } as any).catch(() =>
        ctx.replyWithHTML(buildHomeText(from), buildHomeKeyboard())
      );
    } else {
      await ctx.replyWithHTML(buildHomeText(from), buildHomeKeyboard());
    }
  });

  // ── /consultar ───────────────────────────────────────────────────────────
  bot.command("consultar", async (ctx) => {
    resetSession(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    const from = ctx.from;
    const chat = ctx.chat;
    const paid = isPaid(from.id, from.username);

    // DM: require BLACK tier
    if (chat.type === "private" && !paid) {
      await ctx.replyWithHTML(buildUpgradeDMMsg(), buildUpgradeKeyboard());
      return;
    }

    const freeMode = !paid && chat.type !== "private";
    await ctx.replyWithHTML(TIPO_MENU_TEXT, buildTiposKeyboard(freeMode));
  });

  // ── Direct tipo commands ──────────────────────────────────────────────────
  const DIRECT_COMMANDS: { cmd: string; tipoId: TipoId }[] = [
    { cmd: "cpf",      tipoId: "cpf" },
    { cmd: "nome",     tipoId: "nome" },
    { cmd: "telefone", tipoId: "telefone" },
    { cmd: "email",    tipoId: "email" },
    { cmd: "placa",    tipoId: "placa" },
    { cmd: "cnpj",     tipoId: "cnpj" },
    { cmd: "cep",      tipoId: "cep" },
    { cmd: "pix",      tipoId: "pix" },
    { cmd: "rg",       tipoId: "rg" },
  ];

  for (const { cmd, tipoId } of DIRECT_COMMANDS) {
    bot.command(cmd, async (ctx) => {
      const args = ctx.message.text.split(" ").slice(1).join(" ").trim();
      const tipo = TIPOS.find((t) => t.id === tipoId)!;
      try { await ctx.deleteMessage(); } catch {}

      if (args) {
        resetSession(ctx.from.id);
        const loadMsg = await ctx.replyWithHTML(
          `⏳ <b>Consultando ${tipo.label}...</b>\n<code>${args}</code>`
        );
        await executeQuery(ctx, tipoId, args, loadMsg.message_id);
      } else {
        const session = getSession(ctx.from.id);
        session.state = "awaiting_query";
        session.tipo = tipoId;
        await ctx.replyWithHTML(
          buildQueryPrompt(tipoId),
          Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "home_new")]]),
        );
      }
    });
  }

  // ── /ajuda ────────────────────────────────────────────────────────────────
  bot.command("ajuda", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    const admin = isAdmin(ctx.from.id, ctx.from.username);
    const lines = [
      `❓ <b>INFINITY SEARCH — AJUDA</b>`,
      `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`,
      ``,
      `<b>Comandos rápidos (dado opcional):</b>`,
      `<code>/cpf 12345678901</code>`,
      `<code>/telefone 11999887766</code>`,
      `<code>/placa ABC1D23</code>`,
      `<code>/cnpj 12345678000195</code>`,
      `<code>/email addr@mail.com</code>`,
      `<code>/cep 01310100</code>`,
      `<code>/pix chave-pix</code>`,
      `<code>/rg 123456789</code>`,
      `<code>/nome João Silva</code>`,
      ``,
      `<b>Menu interativo:</b>`,
      `<code>/consultar</code> — abre seletor com todos os tipos`,
      ``,
      `<b>Bases de dados disponíveis:</b>`,
      `∞ <b>Infinity</b> — OSINT completo (todos os tipos)`,
      `🏥 <b>SISREG-III</b> — Regulação em saúde (CPF/Nome)`,
      `💉 <b>SI-PNI</b> — Vacinação nacional (CPF/CNS/Nome)`,
      ``,
      `<b>Acesso:</b>`,
      `Membros do canal têm acesso automático.`,
      `Grupos precisam ser liberados por um admin.`,
    ];

    if (admin) {
      lines.push(``);
      lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
      lines.push(`👑 <b>COMANDOS DE ADMIN</b>`);
      lines.push(``);
      lines.push(`<code>/groupid</code> — ver ID do grupo/chat atual`);
      lines.push(`<code>/liberar</code> — liberar bot neste grupo`);
      lines.push(`<code>/bloquear</code> — bloquear bot neste grupo`);
      lines.push(`<code>/channelid</code> — capturar ID do canal`);
      lines.push(`<code>/addadmin 123456</code> — promover usuário por ID`);
      lines.push(`<code>/status_bot</code> — status de grupos e usuários`);
    }

    lines.push(``);
    lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
    lines.push(`<i>Resultados entregues em arquivo .txt formatado</i>`);

    await ctx.replyWithHTML(lines.join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Consultar Agora", "consultar")],
        [Markup.button.url("💬 Suporte", SUPPORT_URL), Markup.button.url("💬 Suporte", SUPPORT_URL2)] as any,
      ]),
    );
  });

  // ── Callback: admin_liberar (from /groupid button) ───────────────────────
  bot.action("admin_liberar", async (ctx) => {
    await ctx.answerCbQuery();
    const from = ctx.from;
    if (!from || !isAdmin(from.id, from.username)) {
      await ctx.answerCbQuery("❌ Apenas admins podem liberar grupos.");
      return;
    }
    const chat = ctx.chat;
    if (!chat || chat.type === "private") return;
    authorizedGroups.add(chat.id);
    await ctx.editMessageText(
      `✅ <b>Grupo liberado!</b>\n\nID: <code>${chat.id}</code>\nO bot está ativo neste grupo.`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "consultar")]]) }
    );
  });

  // ── Callback: home ────────────────────────────────────────────────────────
  bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    await ctx.editMessageText(buildHomeText(ctx.from), { parse_mode: "HTML", ...buildHomeKeyboard() });
  });

  bot.action("home_new", async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    await ctx.replyWithHTML(buildHomeText(ctx.from), buildHomeKeyboard());
  });

  // ── Callback: consultar (open tipo list) ──────────────────────────────────
  bot.action("consultar", async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    try {
      await ctx.editMessageText(TIPO_MENU_TEXT, { parse_mode: "HTML", ...buildTiposKeyboard() });
    } catch {
      await ctx.replyWithHTML(TIPO_MENU_TEXT, buildTiposKeyboard());
    }
  });

  // ── Callback: show ajuda ──────────────────────────────────────────────────
  bot.action("show_ajuda", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML([
      `❓ <b>Comandos rápidos:</b>`,
      `<code>/cpf</code> · <code>/telefone</code> · <code>/placa</code> · <code>/cnpj</code>`,
      `<code>/email</code> · <code>/cep</code> · <code>/pix</code> · <code>/rg</code> · <code>/nome</code>`,
      ``,
      `Envie o comando + dado direto: <code>/cpf 12345678901</code>`,
      ``,
      `<b>Acesso:</b> entre no canal para usar o bot.`,
    ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Consultar", "consultar")],
        [Markup.button.url("📢 Canal", CHANNEL_INVITE)] as any,
      ]),
    );
  });

  // ── Callback: suporte ─────────────────────────────────────────────────────
  bot.action("show_suporte", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
      `┃\n` +
      `┃ • SUPORTE DISPONÍVEL\n` +
      `┠────────────────────────────\n` +
      `┃ Escolha um dos admins abaixo 👇🏻\n` +
      `╰────────────────────────────╯`,
      { parse_mode: "HTML", ...buildSupportKeyboard() },
    );
  });

  // ── Callback: tipo selection ───────────────────────────────────────────────
  bot.action(/^tipo:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tipoId = ctx.match[1];
    const tipo = TIPOS.find((t) => t.id === tipoId);
    if (!tipo) return;
    const from = ctx.from;
    const chat = ctx.chat;
    const paid = isPaid(from.id, from.username);

    // In groups: check if tipo is free
    if (chat?.type !== "private" && !paid && !FREE_TIPOS.has(tipoId)) {
      await ctx.editMessageText(
        buildUpgradeTipoMsg(tipo.label),
        { parse_mode: "HTML", ...buildUpgradeKeyboard() }
      );
      return;
    }

    const session = getSession(from.id);
    session.state = "awaiting_query";
    session.tipo = tipoId;
    await ctx.editMessageText(
      buildQueryPrompt(tipoId),
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "home")]]) }
    );
  });

  // ── Callback: delete message ───────────────────────────────────────────────
  bot.action(/^del:(-?\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Mensagem apagada");
    const chatId = parseInt(ctx.match[1]);
    const msgId = parseInt(ctx.match[2]);
    await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
  });

  // ── Base selector callback ──────────────────────────────────────────────
  bot.action(/^base:(sisreg|sipni|infinity|credilink)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.chat) return;
    const source = ctx.match[1] as "sisreg" | "sipni" | "infinity" | "credilink";
    const session = getSession(ctx.from.id);

    if (session.state !== "awaiting_base" || !session.tipo || !session.dados) {
      await ctx.replyWithHTML("❌ Sessão expirada. Use /consultar para uma nova consulta.");
      return;
    }

    const { tipo, dados } = session;
    resetSession(ctx.from.id);

    const fromId = ctx.from.id;
    const paid = isPaid(fromId, ctx.from.username);
    const freeMode = !paid && ctx.chat.type !== "private";

    // Track free daily limit on base selection
    if (freeMode) {
      const used = getFreeUsed(fromId);
      if (used >= FREE_DAILY_LIMIT) {
        await ctx.replyWithHTML(buildUpgradeLimitMsg(used), buildUpgradeKeyboard());
        return;
      }
      trackFreeQuery(fromId);
    }

    const sourceLabel =
      source === "sisreg"    ? "🏥 SISREG-III"         :
      source === "sipni"     ? "💉 SI-PNI"              :
      source === "credilink" ? "💳 CrediLink (Skylers)" : "∞ Infinity Search";

    const tipoObj = TIPOS.find((t) => t.id === tipo);
    const loadMsg = await ctx.replyWithHTML(
      `⏳ <b>Consultando ${sourceLabel}...</b>\n<code>${dados}</code>`
    );

    const chatCtx = { telegram: ctx.telegram, chat: { id: ctx.chat.id } };
    if (source === "infinity") {
      await executeQuery(chatCtx, tipo, dados, loadMsg.message_id);
    } else if (source === "credilink") {
      // CrediLink: query via Skylers with tipo=credilink
      await executeSkylersBotQuery(chatCtx, "credilink", dados, loadMsg.message_id);
    } else {
      await executeExternalQuery(chatCtx, source, tipo, dados, loadMsg.message_id);
    }
  });

  // ── Text handler — only active during awaiting_query / awaiting_base flow ──
  bot.on(message("text"), async (ctx) => {
    // Ignore commands (handled above)
    if (ctx.message.text.startsWith("/")) return;

    const session = getSession(ctx.from.id);

    // Only respond when waiting for query data — ignore all other text silently
    if (session.state !== "awaiting_query" || !session.tipo) {
      return;
    }

    const dados = ctx.message.text.trim();
    const tipo = session.tipo;

    try { await ctx.deleteMessage(); } catch {}

    const fromId = ctx.from.id;
    const chat = ctx.chat;
    const paid = isPaid(fromId, ctx.from.username);
    const freeMode = !paid && chat.type !== "private";

    // Free users in groups: check daily limit before executing
    if (freeMode) {
      const used = getFreeUsed(fromId);
      if (used >= FREE_DAILY_LIMIT) {
        await ctx.replyWithHTML(buildUpgradeLimitMsg(used), buildUpgradeKeyboard());
        return;
      }
    }

    if (SKYLERS_ONLY_TIPOS.has(tipo)) {
      // Skylers-only: go directly to Skylers, no base selector
      resetSession(fromId);
      if (freeMode) trackFreeQuery(fromId);
      const tipoObj = TIPOS.find((t) => t.id === tipo);
      const loadMsg = await ctx.replyWithHTML(
        `⏳ <b>Consultando ${tipoObj?.label ?? tipo.toUpperCase()} via Skylers...</b>\n<code>${dados}</code>`
      );
      await executeSkylersBotQuery(ctx, tipo, dados, loadMsg.message_id);
    } else if (EXTERNAL_BASES_TIPOS.has(tipo)) {
      // Show base selector — store dados in session
      session.state = "awaiting_base";
      session.dados = dados;

      const tipoObj = TIPOS.find((t) => t.id === tipo);
      const masked = dados.length > 6
        ? dados.slice(0, 3) + "*".repeat(Math.max(0, dados.length - 5)) + dados.slice(-2)
        : dados;

      await ctx.replyWithHTML(
        `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
        `┃\n` +
        `┃ • ${tipoObj?.label ?? tipo.toUpperCase()} INFORMADO\n` +
        `┃ • DADO: <code>${masked}</code>\n` +
        `┠────────────────────────────\n` +
        `┃ SELECIONE A BASE DE DADOS 👇🏻\n` +
        `╰────────────────────────────╯`,
        buildBaseKeyboard(tipo, freeMode)
      );
    } else {
      resetSession(fromId);
      if (freeMode) trackFreeQuery(fromId);
      const tipoObj = TIPOS.find((t) => t.id === tipo);
      const loadMsg = await ctx.replyWithHTML(
        `⏳ <b>Consultando ${tipoObj?.label ?? tipo.toUpperCase()}...</b>\n<code>${dados}</code>`
      );
      await executeQuery(ctx, tipo, dados, loadMsg.message_id);
    }
  });

  // ── Listen for chat_member updates (auto-verify on channel join) ───────────
  bot.on("chat_member", async (ctx) => {
    const update = ctx.update.chat_member;
    if (!update) return;
    // If this update is from our channel, and user became a member
    if (CHANNEL_ID && update.chat.id === CHANNEL_ID) {
      const newStatus = update.new_chat_member.status;
      const userId = update.new_chat_member.user.id;
      if (["member", "administrator", "creator"].includes(newStatus)) {
        verifiedUsers.add(userId);
      } else {
        // Left/kicked → remove from verified
        verifiedUsers.delete(userId);
      }
    }
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  bot.launch({ allowedUpdates: ["message", "callback_query", "chat_member", "my_chat_member"] }, () => {
    console.log("🌐 Infinity Search Bot iniciado com sucesso!");
  }).catch((err: unknown) => {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("409") || msg.includes("Conflict") || msg.includes("terminated by other")) {
      console.warn("⚠️  InfinityBot: outra instância já está ativa.");
    } else {
      console.error("[InfinityBot] Erro ao iniciar:", err);
    }
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
