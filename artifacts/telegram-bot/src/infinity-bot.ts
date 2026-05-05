import { Telegraf, Markup } from "telegraf";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE     = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY      = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL        = "https://t.me/Blxckxyz";
const SUPPORT_URL2       = "https://t.me/xxmathexx";
const PANEL_URL          = process.env.INFINITY_PANEL_URL ?? `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? ""}`;

const LINE  = "═".repeat(44);
const LINE2 = "─".repeat(44);
const AUTHOR = "blxckxyz";

// ── Channel — only updates channel required ────────────────────────────────────
const CHANNEL_INVITE   = "https://t.me/infinitysearchchannel";
const CHANNEL_USERNAME = process.env.INFINITY_CHANNEL2_USERNAME ?? "@infinitysearchchannel";
let   CHANNEL_ID: number | null = process.env.INFINITY_CHANNEL_ID
  ? Number(process.env.INFINITY_CHANNEL_ID)
  : null;

const MIN_GROUP_MEMBERS = 500;

// ── Access control ─────────────────────────────────────────────────────────────
const ADMIN_USERNAMES  = new Set<string>(["blxckxyz", "xxmathexx", "pianco"]);
const ADMIN_IDS        = new Set<number>();
const verifiedUsers    = new Set<number>();
const authorizedGroups = new Set<number>();

function isAdmin(userId: number, username?: string): boolean {
  if (ADMIN_IDS.has(userId)) return true;
  if (username && ADMIN_USERNAMES.has(username.toLowerCase())) {
    ADMIN_IDS.add(userId);
    return true;
  }
  return false;
}

// ── Query types ───────────────────────────────────────────────────────────────
interface TipoInfo {
  id: string;
  label: string;
  example: string;
  prompt: string;
  obs?: string;
}

const TIPOS: TipoInfo[] = [
  { id: "cpf",      label: "CPF",      example: "12345678901",    prompt: "CPF",     obs: "11 DÍGITOS, APENAS NÚMEROS" },
  { id: "cnpj",     label: "CNPJ",     example: "12345678000100", prompt: "CNPJ",    obs: "14 DÍGITOS, APENAS NÚMEROS" },
  { id: "cep",      label: "CEP",      example: "01310100",       prompt: "CEP",     obs: "8 DÍGITOS, APENAS NÚMEROS" },
  { id: "nome",     label: "NOME",     example: "João Silva",     prompt: "NOME",    obs: "NOME COMPLETO DA PESSOA" },
  { id: "telefone", label: "TELEFONE", example: "11999887766",    prompt: "TELEFONE", obs: "DDD + NÚMERO (EX: 11999887766)" },
  { id: "placa",    label: "PLACA",    example: "ABC1D23",        prompt: "PLACA",   obs: "FORMATO ANTIGO OU MERCOSUL" },
  { id: "bin",      label: "BIN",      example: "456789",         prompt: "BIN",     obs: "PRIMEIROS 6 A 8 DÍGITOS DO CARTÃO" },
  { id: "ip",       label: "IP",       example: "8.8.8.8",        prompt: "IP",      obs: "ENDEREÇO IP (EX: 8.8.8.8)" },
];
const TIPO_MAP = new Map<string, TipoInfo>(TIPOS.map(t => [t.id, t]));

// ── Session ───────────────────────────────────────────────────────────────────
interface PendingQuery { tipo: string; promptMsgId: number; chatId: number }
const pendingQueries = new Map<number, PendingQuery>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

let BOT_BANNER_URL: string = process.env.INFINITY_BOT_BANNER_URL ?? "";

function isAnimatedBanner(url: string): boolean {
  const l = url.toLowerCase().split("?")[0];
  return l.endsWith(".gif") || l.endsWith(".mp4") || l.endsWith(".webm");
}

async function sendBanner(
  ctx: { replyWithAnimation: any; replyWithPhoto: any; replyWithHTML: any },
  caption: string,
  extra: object,
): Promise<void> {
  if (!BOT_BANNER_URL) {
    await (ctx.replyWithHTML as (t: string, e?: object) => Promise<any>)(caption, extra);
    return;
  }
  if (isAnimatedBanner(BOT_BANNER_URL)) {
    await ctx.replyWithAnimation(BOT_BANNER_URL, { caption, parse_mode: "HTML", ...extra } as any)
      .catch(() => (ctx.replyWithHTML as (t: string, e?: object) => Promise<any>)(caption, extra));
  } else {
    await ctx.replyWithPhoto(BOT_BANNER_URL, { caption, parse_mode: "HTML", ...extra } as any)
      .catch(() => (ctx.replyWithHTML as (t: string, e?: object) => Promise<any>)(caption, extra));
  }
}

// ── Channel membership check ──────────────────────────────────────────────────
async function checkChannelMembership(
  telegram: Telegraf["telegram"],
  userId: number,
): Promise<boolean> {
  // Try by numeric ID first, fallback to username
  const target = (CHANNEL_ID ?? CHANNEL_USERNAME) as number | string;
  try {
    const m = await telegram.getChatMember(target, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return false;
  }
}

// ── Group member count ─────────────────────────────────────────────────────────
async function checkGroupAuthorization(
  telegram: Telegraf["telegram"],
  chatId: number,
): Promise<{ ok: boolean; count?: number }> {
  if (authorizedGroups.has(chatId)) return { ok: true };
  try {
    const count = await telegram.getChatMembersCount(chatId);
    if (count >= MIN_GROUP_MEMBERS) { authorizedGroups.add(chatId); return { ok: true, count }; }
    return { ok: false, count };
  } catch {
    return { ok: false };
  }
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function buildStartKeyboard() {
  const rows: any[] = [
    [Markup.button.callback("🔍 Consultas", "menu_consultas"), Markup.button.callback("💬 Suporte", "menu_suporte")],
    [Markup.button.url("🖥️ Completo", PANEL_URL) as any],
  ];
  return Markup.inlineKeyboard(rows);
}

function buildConsultasKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("CPF",       "q:cpf"),      Markup.button.callback("CNPJ",     "q:cnpj")],
    [Markup.button.callback("CEP",       "q:cep")],
    [Markup.button.callback("NOME",      "q:nome"),     Markup.button.callback("TELEFONE", "q:telefone")],
    [Markup.button.callback("PLACA",     "q:placa")],
    [Markup.button.callback("BIN",       "q:bin"),      Markup.button.callback("IP",        "q:ip")],
    [Markup.button.callback("🔄 Voltar", "home")],
  ]);
}

function buildSuporteKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("👤 @Blxckxyz",  SUPPORT_URL)  as any],
    [Markup.button.url("👤 @xxmathexx", SUPPORT_URL2) as any],
    [Markup.button.callback("🔙 Voltar", "home")],
  ]);
}

function buildResultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Nova Consulta", "menu_consultas"), Markup.button.callback("🏠 Início", "home")],
    [Markup.button.url("💬 Suporte", SUPPORT_URL) as any],
  ]);
}

function buildNotAuthorizedKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("📣 Canal de Atualizações", CHANNEL_INVITE) as any],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL) as any],
  ]);
}

// ── Messages ──────────────────────────────────────────────────────────────────
const HDR = "╭──── ᯽ \u{1D5DC}\u{1D5FB}\u{1D5D9}\u{1D5DC}\u{1D5DB}\u{1D5DC}\u{1D5E7}\u{1D5EC} \u{1D5E6}\u{1D5D8}\u{1D5D4}\u{1D5E5}\u{1D5D6}\u{1D5DB} ᯽ ────╮";
const DIV = "┠────────────────────────────";
const FTR = "╰────────────────────────────╯";

function buildHomeMsg(name: string, admin: boolean): string {
  return [
    HDR,
    "┃",
    `┃ • OLÁ, ${esc(name)}!`,
    DIV,
    `┃ • CARGO: ${admin ? "admin 👑" : "membro"}`,
    "┃ • STATUS: online",
    "┃ • PLANO: free",
    DIV,
    "┃  SELECIONE UMA OPÇÃO ABAIXO 👇🏻",
    FTR,
  ].join("\n");
}

function buildConsultasMenuMsg(): string {
  return [
    HDR,
    "┃",
    "┃ • CONSULTAS DISPONÍVEIS",
    DIV,
    "┃ SELECIONE O TIPO DE CONSULTA",
    "┃ ABAIXO 👇🏻",
    FTR,
  ].join("\n");
}

function buildSuporteMsg(): string {
  return [
    "╭──── ᯽ INFINITY SEARCH ᯽ ───────╮",
    "┃",
    "┃ • SUPORTE DISPONÍVEL",
    DIV,
    "┃ESCOLHA UM DOS ADMINS ABAIXO 👇🏻",
    FTR,
  ].join("\n");
}

function buildGroupTooSmallMsg(count?: number): string {
  return [
    HDR,
    "┃",
    "┃ ⚠️ GRUPO MUITO PEQUENO",
    DIV,
    `┃ Membros: ${count ?? "?"}`,
    `┃ Mínimo: <b>${MIN_GROUP_MEMBERS}</b>`,
    "┃",
    "┃ Adicione mais membros e",
    "┃ tente novamente.",
    FTR,
  ].join("\n");
}

function buildPrivateMsg(): string {
  return [
    HDR,
    "┃",
    "┃ 🤖 BOT EXCLUSIVO PARA GRUPOS",
    DIV,
    `┃ Adicione o bot ao seu grupo`,
    `┃ (mínimo <b>${MIN_GROUP_MEMBERS} membros</b>).`,
    "┃",
    "┃ Precisa de ajuda? Use",
    "┃ o suporte abaixo 👇🏻",
    FTR,
  ].join("\n");
}

function buildNotAuthorizedMsg(): string {
  return [
    HDR,
    "┃",
    "┃ ❌ ACESSO NEGADO",
    DIV,
    "┃ Para usar o bot, entre no",
    "┃ canal de atualizações:",
    "┃",
    "┃ 📣 @infinitysearchchannel",
    "┃",
    "┃ Após entrar, use /start.",
    FTR,
  ].join("\n");
}

function buildPromptMsg(tipo: TipoInfo): string {
  return [
    HDR,
    "┃",
    `┃ • CONSULTA DE ${tipo.label}`,
    DIV,
    `┃ DIGITE O ${tipo.prompt} QUE DESEJA`,
    `┃ CONSULTAR`,
    tipo.obs ? `┃ OBS: ${tipo.obs}` : "┃",
    FTR,
  ].join("\n");
}

function buildLoadingMsg(tipo: TipoInfo, dados: string): string {
  return [
    HDR,
    "┃",
    "┃ ⏳ CONSULTANDO...",
    DIV,
    `┃ Tipo: <code>${tipo.label}</code>`,
    `┃ Dado: <code>${esc(dados)}</code>`,
    "┃",
    "┃ Aguarde...",
    FTR,
  ].join("\n");
}

// ── TXT builder ───────────────────────────────────────────────────────────────
function buildResultTxt(
  tipo: string,
  dados: string,
  content: Record<string, string>[],
  sections?: { name: string; items: string[] }[],
  rawText?: string,
): string {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [];

  lines.push(LINE);
  lines.push(`       ∞  INFINITY SEARCH  ∞`);
  lines.push(LINE);
  lines.push(`  Base      : Infinity`);
  lines.push(`  Consulta  : ${tipo.toUpperCase()}`);
  lines.push(`  Dado      : ${dados}`);
  lines.push(`  Data      : ${now}`);
  lines.push(LINE);
  lines.push("");

  if (content.length > 0) {
    const maxKey = Math.min(22, Math.max(...content.map(f => Object.keys(f)[0]?.length ?? 0)));
    lines.push("DADOS ENCONTRADOS");
    lines.push(LINE2);
    for (const field of content) {
      const [k, v] = Object.entries(field)[0] ?? ["", ""];
      if (k) lines.push(`  ${k.padEnd(maxKey)} : ${v}`);
    }
    lines.push("");
  }

  if (sections && sections.length > 0) {
    for (const sec of sections) {
      lines.push(`${sec.name}  (${sec.items.length} registro${sec.items.length !== 1 ? "s" : ""})`);
      lines.push(LINE2);
      sec.items.slice(0, 50).forEach((item, i) => lines.push(`  ${String(i + 1).padStart(3)}.  ${item}`));
      lines.push("");
    }
  }

  if (content.length === 0 && (!sections || sections.length === 0) && rawText) {
    lines.push("RESPOSTA");
    lines.push(LINE2);
    lines.push(rawText.slice(0, 4000));
    lines.push("");
  }

  lines.push(LINE);
  lines.push(`  Made by ${AUTHOR} | Infinity Search`);
  lines.push(`  Suporte : @Blxckxyz`);
  lines.push(`  Suporte : @xxmathexx`);
  lines.push(LINE);

  return lines.join("\n");
}

// ── Geass API ─────────────────────────────────────────────────────────────────
interface GeassResult { fields: Record<string, string>[]; sections: { name: string; items: string[] }[]; raw: string }

function parseGeassRaw(raw: string): GeassResult {
  const fields: Record<string, string>[] = [];
  const sections: { name: string; items: string[] }[] = [];
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  let currentSection: { name: string; items: string[] } | null = null;

  for (const line of lines) {
    if (/^[─═━\-─]{3,}$/.test(line)) continue;
    const kvMatch = line.match(/^([A-ZÀ-Ü][A-ZÀ-Ü\s\/\-\.]+?)\s*[:：]\s*(.+)$/);
    if (kvMatch && kvMatch[1] && kvMatch[2]) {
      const key = kvMatch[1].trim().toUpperCase();
      const val = kvMatch[2].trim();
      if (key.length <= 40 && val.length > 0) { fields.push({ [key]: val }); currentSection = null; continue; }
    }
    if (/^[A-ZÁÉÍÓÚÀÃÂÊÔ\s]{4,}$/.test(line) && line.length < 50) {
      currentSection = { name: line, items: [] };
      sections.push(currentSection);
      continue;
    }
    if (currentSection) currentSection.items.push(line);
  }
  return { fields, sections, raw };
}

async function queryGeass(tipo: string, dados: string): Promise<GeassResult> {
  const url = `${GEASS_API_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(GEASS_API_KEY)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Provedor retornou HTTP ${resp.status}`);
  const json = await resp.json() as { status?: string; resposta?: string; error?: string };
  if (json.status === "erro" || json.error) throw new Error(json.error ?? "Sem dados para este valor");
  if (!json.resposta || json.resposta.trim() === "") throw new Error("Sem dados encontrados");
  return parseGeassRaw(json.resposta);
}

// ── BIN ───────────────────────────────────────────────────────────────────────
async function queryBIN(bin: string): Promise<{ fields: Record<string, string>[] }> {
  const clean = bin.replace(/\D/g, "").slice(0, 8);
  if (clean.length < 6) throw new Error("BIN deve ter ao menos 6 dígitos");
  const resp = await fetch(`https://lookup.binlist.net/${clean}`, {
    headers: { "Accept-Version": "3", "User-Agent": "Mozilla/5.0 InfinitySearch/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`BIN não encontrado (${resp.status})`);
  const d = await resp.json() as {
    number?: { length?: number; luhn?: boolean }; scheme?: string; type?: string; brand?: string;
    prepaid?: boolean; country?: { name?: string; emoji?: string; currency?: string };
    bank?: { name?: string; url?: string; phone?: string; city?: string };
  };
  const fields: Record<string, string>[] = [];
  const add = (k: string, v: string | number | boolean | undefined | null) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") fields.push({ [k]: String(v) });
  };
  add("BIN", clean); add("ESQUEMA", d.scheme?.toUpperCase()); add("TIPO", d.type?.toUpperCase());
  add("BRAND", d.brand); add("PRÉ-PAGO", d.prepaid !== undefined ? (d.prepaid ? "SIM" : "NÃO") : undefined);
  if (d.country) { add("PAÍS", `${d.country.emoji ?? ""} ${d.country.name ?? ""}`.trim()); add("MOEDA", d.country.currency); }
  if (d.bank) { add("BANCO", d.bank.name); add("CIDADE BANCO", d.bank.city); add("SITE BANCO", d.bank.url); }
  return { fields };
}

// ── IP ────────────────────────────────────────────────────────────────────────
async function queryIP(ip: string): Promise<{ fields: Record<string, string>[] }> {
  const clean = ip.trim();
  if (!/^[\d.:a-fA-F]+$/.test(clean)) throw new Error("IP inválido");
  const resp = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(clean)}?lang=pt-BR&fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,currency,isp,org,as,reverse,mobile,proxy,hosting,query`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!resp.ok) throw new Error(`Falha (${resp.status})`);
  const d = await resp.json() as {
    status?: string; message?: string; query?: string; country?: string; countryCode?: string;
    regionName?: string; city?: string; zip?: string; lat?: number; lon?: number; timezone?: string;
    currency?: string; isp?: string; org?: string; as?: string; reverse?: string;
    mobile?: boolean; proxy?: boolean; hosting?: boolean;
  };
  if (d.status !== "success") throw new Error(d.message ?? "IP inválido");
  const fields: Record<string, string>[] = [];
  const add = (k: string, v: string | number | boolean | undefined | null) => {
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v) !== "undefined") fields.push({ [k]: String(v) });
  };
  add("IP", d.query); add("PAÍS", `${d.country ?? ""} (${d.countryCode ?? ""})`);
  add("REGIÃO", d.regionName); add("CIDADE", d.city); add("CEP", d.zip);
  add("LATITUDE", d.lat); add("LONGITUDE", d.lon); add("TIMEZONE", d.timezone);
  add("ISP", d.isp); add("ORGANIZAÇÃO", d.org); add("REVERSE", d.reverse);
  add("MOBILE", d.mobile !== undefined ? (d.mobile ? "SIM" : "NÃO") : undefined);
  add("PROXY/VPN", d.proxy !== undefined ? (d.proxy ? "✅ SIM" : "❌ NÃO") : undefined);
  add("HOSTING", d.hosting !== undefined ? (d.hosting ? "SIM" : "NÃO") : undefined);
  return { fields };
}

// ── Caption preview ───────────────────────────────────────────────────────────
function buildCaption(tipo: string, dados: string, fields: Record<string, string>[], total?: number): string {
  const parts: string[] = [
    `✅ <b>Resultado encontrado</b>`, ``,
    `<code>◈</code> <b>Tipo:</b> <code>${tipo.toUpperCase()}</code>`,
    `<code>◈</code> <b>Dado:</b> <code>${esc(dados)}</code>`,
  ];
  if (fields.length > 0) parts.push(`<code>◈</code> <b>Campos:</b> ${fields.length}`);
  if (total) parts.push(`<code>◈</code> <b>Registros:</b> ${total}`);
  const preview = fields.slice(0, 5);
  if (preview.length > 0) {
    parts.push(``, `<b>Prévia:</b>`);
    for (const f of preview) {
      const [k, v] = Object.entries(f)[0] ?? ["", ""];
      if (k) parts.push(`  <code>${esc(k)}</code>: <b>${esc(String(v).slice(0, 60))}</b>`);
    }
  }
  return parts.join("\n").slice(0, 1024);
}

// ── Execute query and send result ─────────────────────────────────────────────
async function executeAndSend(
  telegram: Telegraf["telegram"],
  chatId: number,
  tipo: string,
  dados: string,
  loadMsgId: number,
): Promise<void> {
  const tipoInfo = TIPO_MAP.get(tipo)!;
  const trimmedDados = dados.trim();
  try {
    let fields: Record<string, string>[] = [];
    let sections: { name: string; items: string[] }[] | undefined;
    let rawText: string | undefined;

    if (tipo === "bin") {
      const r = await queryBIN(trimmedDados);
      fields = r.fields;
    } else if (tipo === "ip") {
      const r = await queryIP(trimmedDados);
      fields = r.fields;
    } else {
      const r = await queryGeass(tipo, trimmedDados);
      fields = r.fields; sections = r.sections.length > 0 ? r.sections : undefined; rawText = r.raw;
    }

    const totalRegistros = sections?.reduce((a, s) => a + s.items.length, 0) ?? 0;
    const txt = buildResultTxt(tipo, trimmedDados, fields, sections, rawText);
    const caption = buildCaption(tipo, trimmedDados, fields, totalRegistros > 0 ? totalRegistros : undefined);

    await telegram.deleteMessage(chatId, loadMsgId).catch(() => {});
    await telegram.sendDocument(
      chatId,
      { source: Buffer.from(txt, "utf-8"), filename: `infinity-${tipo}-${Date.now()}.txt` },
      { caption, parse_mode: "HTML", ...buildResultKeyboard() },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await telegram.editMessageText(
      chatId, loadMsgId, undefined,
      `❌ <b>Erro na consulta de ${tipoInfo.label}</b>\n\n<code>${esc(msg.slice(0, 300))}</code>`,
      { parse_mode: "HTML", ...buildResultKeyboard() },
    ).catch(() => {});
  }
}

// ── Private query block message ───────────────────────────────────────────────
function buildPrivateQueryMsg(): string {
  return [
    HDR,
    "┃",
    "┃ ⚠️ CONSULTAS APENAS EM GRUPOS",
    DIV,
    "┃ As consultas só podem ser",
    "┃ realizadas dentro de um grupo.",
    "┃",
    "┃ Adicione o bot ao seu grupo",
    "┃ e use por lá 👇🏻",
    FTR,
  ].join("\n");
}

function buildAddToGroupKeyboard(botUsername: string) {
  const addUrl = botUsername
    ? `https://t.me/${botUsername}?startgroup=true`
    : SUPPORT_URL;
  return Markup.inlineKeyboard([
    [Markup.button.url("➕ Adicionar ao Grupo", addUrl) as any],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL) as any],
  ]);
}

// ── Bot ───────────────────────────────────────────────────────────────────────
export function startInfinityBot(): void {
  if (!INFINITY_BOT_TOKEN) {
    console.log("[InfinityBot] INFINITY_BOT_TOKEN não configurado — bot não iniciado.");
    return;
  }

  const bot = new Telegraf(INFINITY_BOT_TOKEN);
  let botUsername = "";

  void bot.telegram.setMyCommands([
    { command: "start",     description: "🌐 Menu principal" },
    { command: "cpf",       description: "Consultar CPF" },
    { command: "cnpj",      description: "Consultar CNPJ" },
    { command: "cep",       description: "Consultar CEP" },
    { command: "nome",      description: "Consultar por Nome" },
    { command: "telefone",  description: "Consultar Telefone" },
    { command: "placa",     description: "Consultar Placa" },
    { command: "bin",       description: "Consultar BIN de Cartão" },
    { command: "ip",        description: "Consultar IP" },
    { command: "ajuda",     description: "❓ Lista de comandos" },
  ]).catch(() => {});

  // ── Middleware ────────────────────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!chat || !from) return next();

    // Private chats: allow freely — individual handlers block queries
    if (chat.type === "private") return next();

    if (chat.type === "group" || chat.type === "supergroup") {
      if (isAdmin(from.id, from.username)) return next();

      const groupAuth = await checkGroupAuthorization(bot.telegram, chat.id);
      if (!groupAuth.ok) {
        if ("message" in ctx) {
          try { await ctx.deleteMessage(); } catch {}
          await ctx.replyWithHTML(buildGroupTooSmallMsg(groupAuth.count));
        } else if ("callback_query" in ctx) {
          await (ctx as any).answerCbQuery(`❌ Grupo muito pequeno (mín. ${MIN_GROUP_MEMBERS} membros)`, { show_alert: true });
        }
        return;
      }

      if (!verifiedUsers.has(from.id)) {
        const ok = await checkChannelMembership(bot.telegram, from.id);
        if (!ok) {
          if ("message" in ctx) {
            try { await ctx.deleteMessage(); } catch {}
            await ctx.replyWithHTML(buildNotAuthorizedMsg(), buildNotAuthorizedKeyboard());
          } else if ("callback_query" in ctx) {
            await (ctx as any).answerCbQuery("❌ Entre no canal de atualizações primeiro!", { show_alert: true });
          }
          return;
        }
        verifiedUsers.add(from.id);
      }
    }

    return next();
  });

  // ── Bot added to group ────────────────────────────────────────────────────
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.update.my_chat_member;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    if (newStatus !== "member" && newStatus !== "administrator") return;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    try {
      const count = await bot.telegram.getChatMembersCount(chat.id);
      if (count >= MIN_GROUP_MEMBERS) {
        authorizedGroups.add(chat.id);
        await bot.telegram.sendMessage(
          chat.id,
          [
            HDR, "┃", "┃ ✅ BOT ATIVADO!", DIV,
            `┃ Grupo com <b>${count}</b> membros ✅`,
            "┃", "┃ Use /start para começar!", FTR,
          ].join("\n"),
          { parse_mode: "HTML", ...buildStartKeyboard() },
        );
      } else {
        await bot.telegram.sendMessage(chat.id, buildGroupTooSmallMsg(count), { parse_mode: "HTML" });
      }
    } catch { /* ignore */ }
  });

  // ── Admin commands ────────────────────────────────────────────────────────
  bot.command("liberar", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    if (ctx.chat.type === "private") { await ctx.replyWithHTML("ℹ️ Use no grupo."); return; }
    authorizedGroups.add(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <b>Grupo liberado!</b> ID: <code>${ctx.chat.id}</code>`, buildStartKeyboard());
  });

  bot.command("bloquear", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    authorizedGroups.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`🔒 <b>Grupo bloqueado.</b> ID: <code>${ctx.chat.id}</code>`);
  });

  bot.command("groupid", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`🆔 Chat ID: <code>${ctx.chat.id}</code>`);
  });

  bot.command("channelid", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    CHANNEL_ID = ctx.chat.id;
    await ctx.replyWithHTML(`📡 Canal configurado! ID: <code>${ctx.chat.id}</code>`);
  });

  bot.command("addadmin", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    const uid = Number(ctx.message.text.split(" ")[1]);
    if (!uid) { await ctx.replyWithHTML("Uso: <code>/addadmin 123456789</code>"); return; }
    ADMIN_IDS.add(uid);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <code>${uid}</code> adicionado como admin.`);
  });

  bot.command("status_bot", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    await ctx.replyWithHTML([
      `📊 <b>Status</b>`,
      `Canal ID: <code>${CHANNEL_ID ?? "username: " + CHANNEL_USERNAME}</code>`,
      `Verificados: <b>${verifiedUsers.size}</b>`,
      `Grupos: <b>${authorizedGroups.size}</b>`,
    ].join("\n"));
  });

  bot.command("setbanner", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    try { await ctx.deleteMessage(); } catch {}
    const url = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!url) { await ctx.replyWithHTML(`Banner atual: <code>${BOT_BANNER_URL || "nenhum"}</code>`); return; }
    BOT_BANNER_URL = url;
    await ctx.replyWithHTML(`✅ Banner: <code>${url}</code>`);
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    const from = ctx.from;
    const name = from.username ? `@${from.username}` : (from.first_name ?? "operador");
    pendingQueries.delete(from.id);
    await sendBanner(ctx as any, buildHomeMsg(name, isAdmin(from.id, from.username)), buildStartKeyboard());
  });

  // ── /ajuda ────────────────────────────────────────────────────────────────
  bot.command("ajuda", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    const lines = [
      HDR, "┃", "┃ • COMANDOS DISPONÍVEIS", DIV,
      "┃ /cpf — Consultar CPF",
      "┃ /cnpj — Consultar CNPJ",
      "┃ /cep — Consultar CEP",
      "┃ /nome — Busca por Nome",
      "┃ /telefone — Consultar Telefone",
      "┃ /placa — Consultar Placa",
      "┃ /bin — Consultar BIN",
      "┃ /ip — Localizar IP",
      DIV, "┃ Use /start para o menu.", FTR,
    ];
    await ctx.replyWithHTML(lines.join("\n"), Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "menu_consultas")]]));
  });

  // ── Direct commands ───────────────────────────────────────────────────────
  async function handleDirectCommand(ctx: any, tipo: string): Promise<void> {
    // Block queries in private chat
    if (ctx.chat?.type === "private") {
      await ctx.replyWithHTML(buildPrivateQueryMsg(), buildAddToGroupKeyboard(botUsername));
      return;
    }
    try { await ctx.deleteMessage(); } catch {}
    const text: string = ctx.message?.text ?? "";
    const args = text.split(" ").slice(1).join(" ").trim();
    const tipoInfo = TIPO_MAP.get(tipo)!;
    if (!args) {
      const promptMsg = await ctx.replyWithHTML(buildPromptMsg(tipoInfo), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "cancel")]]));
      pendingQueries.set(ctx.from.id, { tipo, promptMsgId: promptMsg.message_id, chatId: ctx.chat.id });
      return;
    }
    const loadMsg = await ctx.replyWithHTML(buildLoadingMsg(tipoInfo, args));
    await executeAndSend(bot.telegram, ctx.chat.id, tipo, args, loadMsg.message_id);
  }

  bot.command("cpf",      ctx => handleDirectCommand(ctx, "cpf"));
  bot.command("cnpj",     ctx => handleDirectCommand(ctx, "cnpj"));
  bot.command("cep",      ctx => handleDirectCommand(ctx, "cep"));
  bot.command("nome",     ctx => handleDirectCommand(ctx, "nome"));
  bot.command("telefone", ctx => handleDirectCommand(ctx, "telefone"));
  bot.command("placa",    ctx => handleDirectCommand(ctx, "placa"));
  bot.command("bin",      ctx => handleDirectCommand(ctx, "bin"));
  bot.command("ip",       ctx => handleDirectCommand(ctx, "ip"));

  // ── Callbacks ─────────────────────────────────────────────────────────────
  bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    const from = ctx.from!;
    pendingQueries.delete(from.id);
    const name = from.username ? `@${from.username}` : (from.first_name ?? "operador");
    await ctx.replyWithHTML(buildHomeMsg(name, isAdmin(from.id, from.username)), buildStartKeyboard());
  });

  bot.action("menu_consultas", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(buildConsultasMenuMsg(), buildConsultasKeyboard());
  });

  bot.action("menu_suporte", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(buildSuporteMsg(), buildSuporteKeyboard());
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery("Cancelado");
    const from = ctx.from!;
    pendingQueries.delete(from.id);
    try { await ctx.deleteMessage(); } catch {}
  });

  bot.action(/^q:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    // Block queries in private chat
    if (ctx.chat?.type === "private") {
      await ctx.replyWithHTML(buildPrivateQueryMsg(), buildAddToGroupKeyboard(botUsername));
      return;
    }
    const tipo = (ctx.match as RegExpMatchArray)[1];
    const tipoInfo = TIPO_MAP.get(tipo);
    if (!tipoInfo) return;
    const from = ctx.from!;
    pendingQueries.delete(from.id);
    const promptMsg = await ctx.replyWithHTML(
      buildPromptMsg(tipoInfo),
      Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "cancel")]]),
    );
    pendingQueries.set(from.id, { tipo, promptMsgId: promptMsg.message_id, chatId: ctx.chat!.id });
  });

  // ── Text: capture pending query ───────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const from = ctx.from;
    const pending = pendingQueries.get(from.id);
    if (!pending || pending.chatId !== ctx.chat.id) return;
    const dados = ctx.message.text.trim();
    if (!dados || dados.startsWith("/")) return;
    pendingQueries.delete(from.id);
    try { await ctx.deleteMessage(); } catch {}
    const tipoInfo = TIPO_MAP.get(pending.tipo)!;
    const loadMsg = await ctx.replyWithHTML(buildLoadingMsg(tipoInfo, dados));
    try { await bot.telegram.deleteMessage(pending.chatId, pending.promptMsgId); } catch {}
    await executeAndSend(bot.telegram, ctx.chat.id, pending.tipo, dados, loadMsg.message_id);
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  bot.launch({ allowedUpdates: ["message", "callback_query", "my_chat_member"] })
    .catch(err => console.error("[InfinityBot] launch error:", err));

  // Fetch bot username for "add to group" links
  bot.telegram.getMe().then(me => {
    botUsername = me.username ?? "";
    console.log(`[InfinityBot] Username: @${botUsername}`);
  }).catch(() => {});

  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  process.once("SIGINT",  () => bot.stop("SIGINT"));

  console.log("[InfinityBot] Bot iniciado com sucesso ✅");
  console.log(`[InfinityBot] Canal: ${CHANNEL_USERNAME}`);
  console.log(`[InfinityBot] Painel: ${PANEL_URL}`);
}
