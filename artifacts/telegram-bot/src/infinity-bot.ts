import { Telegraf, Markup } from "telegraf";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE     = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY      = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL        = "https://t.me/Blxckxyz";
const SUPPORT_URL2       = "https://t.me/xxmathexx";
let   BOT_BANNER_URL: string = process.env.INFINITY_BOT_BANNER_URL ?? "";

const LINE   = "═".repeat(44);
const LINE2  = "─".repeat(44);
const AUTHOR = "blxckxyz";

// ── Channels ──────────────────────────────────────────────────────────────────
// Channel 1 — free queries access (private invite)
const CHANNEL1_INVITE   = "https://t.me/+7sBxmhOFPhJlYzcx";
let   CHANNEL1_ID: number | null = process.env.INFINITY_CHANNEL_ID
  ? Number(process.env.INFINITY_CHANNEL_ID)
  : null;

// Channel 2 — updates/announcements channel (configure once link is available)
const CHANNEL2_INVITE   = process.env.INFINITY_CHANNEL2_INVITE ?? "https://t.me/infinitysearchchannel";
const CHANNEL2_USERNAME = process.env.INFINITY_CHANNEL2_USERNAME ?? "@infinitysearchchannel";

const MIN_GROUP_MEMBERS = 500;

// ── Access control ─────────────────────────────────────────────────────────────
const ADMIN_USERNAMES  = new Set<string>(["blxckxyz", "xxmathexx", "pianco"]);
const ADMIN_IDS        = new Set<number>();
const verifiedUsers    = new Set<number>();    // channel-verified users
const authorizedGroups = new Set<number>();    // groups with 500+ members

function isAdmin(userId: number, username?: string): boolean {
  if (ADMIN_IDS.has(userId)) return true;
  if (username && ADMIN_USERNAMES.has(username.toLowerCase())) {
    ADMIN_IDS.add(userId);
    return true;
  }
  return false;
}

// ── Query types ───────────────────────────────────────────────────────────────
interface TipoInfo { id: string; label: string; example: string; prompt: string }

const TIPOS: TipoInfo[] = [
  { id: "cpf",      label: "🪪 CPF",      example: "12345678901",    prompt: "CPF (11 dígitos, apenas números)" },
  { id: "cnpj",     label: "🏭 CNPJ",     example: "12345678000100", prompt: "CNPJ (14 dígitos, apenas números)" },
  { id: "nome",     label: "👤 Nome",     example: "João Silva",     prompt: "nome completo da pessoa" },
  { id: "telefone", label: "📞 Telefone", example: "11999887766",    prompt: "telefone com DDD (ex: 11999887766)" },
  { id: "placa",    label: "🚗 Placa",    example: "ABC1D23",        prompt: "placa do veículo (ex: ABC1D23)" },
  { id: "bin",      label: "💳 BIN",      example: "456789",         prompt: "primeiros 6 a 8 dígitos do cartão" },
  { id: "ip",       label: "🌐 IP",       example: "8.8.8.8",       prompt: "endereço IP (ex: 8.8.8.8)" },
];
const TIPO_MAP = new Map<string, TipoInfo>(TIPOS.map(t => [t.id, t]));

// ── Session (per-user pending type) ──────────────────────────────────────────
interface PendingQuery { tipo: string; promptMsgId: number; chatId: number }
const pendingQueries = new Map<number, PendingQuery>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

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
): Promise<{ ok: boolean; missingInvite?: string; label?: string }> {
  // Channel 1 check (if ID is configured)
  if (CHANNEL1_ID) {
    try {
      const m = await telegram.getChatMember(CHANNEL1_ID, userId);
      if (!["member", "administrator", "creator"].includes(m.status)) {
        return { ok: false, missingInvite: CHANNEL1_INVITE, label: "Canal de Consultas Free" };
      }
    } catch {
      return { ok: false, missingInvite: CHANNEL1_INVITE, label: "Canal de Consultas Free" };
    }
  }
  // Channel 2 check
  try {
    const m2 = await telegram.getChatMember(CHANNEL2_USERNAME, userId);
    if (!["member", "administrator", "creator"].includes(m2.status)) {
      return { ok: false, missingInvite: CHANNEL2_INVITE, label: "Canal de Atualizações" };
    }
  } catch {
    // If bot isn't in channel 2, skip check (don't block users)
  }
  return { ok: true };
}

async function isAuthorizedUser(
  telegram: Telegraf["telegram"],
  userId: number,
  username?: string,
): Promise<boolean> {
  if (isAdmin(userId, username)) return true;
  if (verifiedUsers.has(userId)) return true;
  const { ok } = await checkChannelMembership(telegram, userId);
  if (ok) verifiedUsers.add(userId);
  return ok;
}

// ── Group member count check ──────────────────────────────────────────────────
async function checkGroupAuthorization(
  telegram: Telegraf["telegram"],
  chatId: number,
): Promise<{ ok: boolean; count?: number }> {
  if (authorizedGroups.has(chatId)) return { ok: true };
  try {
    const count = await telegram.getChatMembersCount(chatId);
    if (count >= MIN_GROUP_MEMBERS) {
      authorizedGroups.add(chatId);
      return { ok: true, count };
    }
    return { ok: false, count };
  } catch {
    return { ok: false };
  }
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function buildMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🪪 CPF",      "q:cpf"),       Markup.button.callback("🏭 CNPJ",      "q:cnpj")],
    [Markup.button.callback("👤 Nome",     "q:nome"),      Markup.button.callback("📞 Telefone",  "q:telefone")],
    [Markup.button.callback("🚗 Placa",    "q:placa"),     Markup.button.callback("💳 BIN",       "q:bin")],
    [Markup.button.callback("🌐 IP",       "q:ip"),        Markup.button.callback("❓ Ajuda",      "show_help")],
    [Markup.button.url("💬 @Blxckxyz", SUPPORT_URL) as any, Markup.button.url("💬 @xxmathexx", SUPPORT_URL2) as any],
  ]);
}

function buildResultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Nova Consulta", "home")],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL) as any, Markup.button.url("💬 @xxmathexx", SUPPORT_URL2) as any],
  ]);
}

function buildNotAuthorizedKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("📢 Canal de Consultas Free", CHANNEL1_INVITE) as any],
    [Markup.button.url("📣 Canal de Atualizações", CHANNEL2_INVITE) as any],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL) as any],
  ]);
}

// ── Messages ──────────────────────────────────────────────────────────────────
function buildHomeMsg(name: string, admin: boolean): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃  Bem-vindo, <b>${esc(name)}</b>!\n` +
    `┃  Status: ✅ Ativo${admin ? " · 👑 ADMIN" : ""}\n` +
    `┠─────────────────────────────────\n` +
    `┃  🪪 <b>CPF</b>       🏭 <b>CNPJ</b>\n` +
    `┃  👤 <b>Nome</b>      📞 <b>Telefone</b>\n` +
    `┃  🚗 <b>Placa</b>     💳 <b>BIN</b>\n` +
    `┃  🌐 <b>IP</b>\n` +
    `┠─────────────────────────────────\n` +
    `┃  Escolha uma opção abaixo 👇🏻\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildGroupTooSmallMsg(count?: number): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃ ⚠️ <b>GRUPO MUITO PEQUENO</b>\n` +
    `┠─────────────────────────────────\n` +
    `┃ Este grupo tem ${count ? `<b>${count}</b>` : "poucos"} membros.\n` +
    `┃ O bot requer um mínimo de\n` +
    `┃ <b>${MIN_GROUP_MEMBERS} membros</b> para funcionar.\n` +
    `┃\n` +
    `┃ Adicione mais membros ao grupo\n` +
    `┃ e tente novamente.\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildPrivateMsg(): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃ 🤖 Bot exclusivo para grupos!\n` +
    `┠─────────────────────────────────\n` +
    `┃ Adicione o bot ao seu grupo\n` +
    `┃ (mínimo <b>${MIN_GROUP_MEMBERS} membros</b>) e use por lá.\n` +
    `┃\n` +
    `┃ Precisa de ajuda? Fale com\n` +
    `┃ nosso suporte abaixo 👇🏻\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildNotAuthorizedMsg(label?: string): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃ ❌ <b>ACESSO NEGADO</b>\n` +
    `┠─────────────────────────────────\n` +
    `┃ Para usar o bot, entre nos\n` +
    `┃ dois canais obrigatórios:\n` +
    `┃\n` +
    `┃ 1️⃣ Canal de Consultas Free\n` +
    `┃ 2️⃣ Canal de Atualizações\n` +
    `┃\n` +
    `┃ ${label ? `❗ Você não está em: <b>${esc(label)}</b>\n┃\n` : ""}` +
    `┃ Após entrar, use /start novamente.\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildPromptMsg(tipo: TipoInfo): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃ ${tipo.label.toUpperCase()}\n` +
    `┠─────────────────────────────────\n` +
    `┃ Digite o <b>${esc(tipo.prompt)}</b>\n` +
    `┃\n` +
    `┃ Ex: <code>${esc(tipo.example)}</code>\n` +
    `┃\n` +
    `┃ ⏳ Aguardando sua resposta...\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildLoadingMsg(tipo: TipoInfo, dados: string): string {
  return (
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
    `┃\n` +
    `┃ ⏳ <b>CONSULTANDO...</b>\n` +
    `┠─────────────────────────────────\n` +
    `┃ Tipo: <code>${tipo.id.toUpperCase()}</code>\n` +
    `┃ Dado: <code>${esc(dados)}</code>\n` +
    `┃\n` +
    `┃ Por favor, aguarde...\n` +
    `╰─────────────────────────────────╯`
  );
}

function buildHelpMsg(): string {
  return [
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮`,
    `┃`,
    `┃ 📋 <b>CONSULTAS DISPONÍVEIS</b>`,
    `┠─────────────────────────────────`,
    `┃ 🪪 /cpf &lt;número&gt; — CPF`,
    `┃ 🏭 /cnpj &lt;número&gt; — CNPJ`,
    `┃ 👤 /nome &lt;nome&gt; — Nome`,
    `┃ 📞 /telefone &lt;ddd+número&gt; — Telefone`,
    `┃ 🚗 /placa &lt;placa&gt; — Veículo`,
    `┃ 💳 /bin &lt;6-8 dígitos&gt; — Cartão`,
    `┃ 🌐 /ip &lt;endereço&gt; — Geolocalização IP`,
    `┠─────────────────────────────────`,
    `┃ 💡 Você também pode usar o menu`,
    `┃    interativo com /start`,
    `┠─────────────────────────────────`,
    `┃ <i>🔒 Bot exclusivo para grupos</i>`,
    `┃ <i>📋 Mínimo ${MIN_GROUP_MEMBERS} membros por grupo</i>`,
    `╰─────────────────────────────────╯`,
  ].join("\n");
}

// ── TXT builder ───────────────────────────────────────────────────────────────
function buildResultTxt(tipo: string, dados: string, content: Record<string, string>[], sections?: { name: string; items: string[] }[], rawText?: string): string {
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

// ── Geass API query ───────────────────────────────────────────────────────────
interface GeassResult {
  fields: Record<string, string>[];
  sections: { name: string; items: string[] }[];
  raw: string;
}

function parseGeassRaw(raw: string): GeassResult {
  const fields: Record<string, string>[] = [];
  const sections: { name: string; items: string[] }[] = [];
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  let currentSection: { name: string; items: string[] } | null = null;

  for (const line of lines) {
    // Section headers (all caps, possibly with dashes)
    if (/^[─═━\-─]{3,}$/.test(line)) continue;

    const kvMatch = line.match(/^([A-ZÀ-Ü][A-ZÀ-Ü\s\/\-\.]+?)\s*[:：]\s*(.+)$/);
    if (kvMatch && kvMatch[1] && kvMatch[2]) {
      const key = kvMatch[1].trim().toUpperCase();
      const val = kvMatch[2].trim();
      if (key.length <= 40 && val.length > 0) {
        fields.push({ [key]: val });
        currentSection = null;
        continue;
      }
    }

    if (/^[A-ZÁÉÍÓÚÀÃÂÊÔ\s]{4,}$/.test(line) && line.length < 50) {
      currentSection = { name: line, items: [] };
      sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.items.push(line);
    }
  }

  return { fields, sections, raw };
}

async function queryGeass(tipo: string, dados: string): Promise<GeassResult> {
  const url = `${GEASS_API_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(GEASS_API_KEY)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Provedor retornou HTTP ${resp.status}`);
  const json = await resp.json() as { status?: string; resposta?: string; error?: string };
  if (json.status === "erro" || json.error) throw new Error(json.error ?? "Sem dados para este valor");
  if (!json.resposta || json.resposta.trim() === "") throw new Error("Sem dados encontrados para este valor");
  return parseGeassRaw(json.resposta);
}

// ── BIN lookup ────────────────────────────────────────────────────────────────
interface BinResult { fields: Record<string, string>[] }

async function queryBIN(bin: string): Promise<BinResult> {
  const clean = bin.replace(/\D/g, "").slice(0, 8);
  if (clean.length < 6) throw new Error("BIN deve ter ao menos 6 dígitos");

  const resp = await fetch(`https://lookup.binlist.net/${clean}`, {
    headers: { "Accept-Version": "3", "User-Agent": "Mozilla/5.0 InfinitySearch/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`BIN não encontrado (${resp.status})`);

  const d = await resp.json() as {
    number?: { length?: number; luhn?: boolean };
    scheme?: string;
    type?: string;
    brand?: string;
    prepaid?: boolean;
    country?: { name?: string; emoji?: string; currency?: string; latitude?: number; longitude?: number };
    bank?: { name?: string; url?: string; phone?: string; city?: string };
  };

  const fields: Record<string, string>[] = [];
  const add = (k: string, v: string | number | boolean | undefined | null) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") fields.push({ [k]: String(v) });
  };

  add("BIN",        clean);
  add("ESQUEMA",    d.scheme?.toUpperCase());
  add("TIPO",       d.type?.toUpperCase());
  add("BRAND",      d.brand);
  add("PRÉ-PAGO",   d.prepaid !== undefined ? (d.prepaid ? "SIM" : "NÃO") : undefined);
  if (d.country) {
    add("PAÍS",     `${d.country.emoji ?? ""} ${d.country.name ?? ""}`.trim());
    add("MOEDA",    d.country.currency);
  }
  if (d.bank) {
    add("BANCO",    d.bank.name);
    add("CIDADE BANCO", d.bank.city);
    add("SITE BANCO",   d.bank.url);
    add("TELEFONE BANCO", d.bank.phone);
  }
  if (d.number) {
    add("COMPRIMENTO CARTÃO", d.number.length);
    add("VALIDAÇÃO LUHN",     d.number.luhn ? "SIM" : "NÃO");
  }

  return { fields };
}

// ── IP lookup ─────────────────────────────────────────────────────────────────
interface IpResult { fields: Record<string, string>[] }

async function queryIP(ip: string): Promise<IpResult> {
  const clean = ip.trim();
  if (!/^[\d.:a-fA-F]+$/.test(clean)) throw new Error("IP inválido");

  const resp = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(clean)}?lang=pt-BR&fields=status,message,continent,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,reverse,mobile,proxy,hosting,query`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!resp.ok) throw new Error(`Falha na consulta de IP (${resp.status})`);
  const d = await resp.json() as {
    status?: string; message?: string; query?: string;
    country?: string; countryCode?: string; continent?: string;
    region?: string; regionName?: string; city?: string; district?: string; zip?: string;
    lat?: number; lon?: number; timezone?: string; offset?: number; currency?: string;
    isp?: string; org?: string; as?: string; asname?: string; reverse?: string;
    mobile?: boolean; proxy?: boolean; hosting?: boolean;
  };

  if (d.status !== "success") throw new Error(d.message ?? "IP não encontrado ou inválido");

  const fields: Record<string, string>[] = [];
  const add = (k: string, v: string | number | boolean | undefined | null) => {
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v) !== "undefined") fields.push({ [k]: String(v) });
  };

  add("IP",           d.query);
  add("CONTINENTE",   d.continent);
  add("PAÍS",         `${d.country ?? ""} (${d.countryCode ?? ""})`.trim());
  add("REGIÃO",       d.regionName);
  add("CIDADE",       d.city);
  add("BAIRRO",       d.district);
  add("CEP",          d.zip);
  add("LATITUDE",     d.lat);
  add("LONGITUDE",    d.lon);
  add("TIMEZONE",     d.timezone);
  add("MOEDA",        d.currency);
  add("ISP",          d.isp);
  add("ORGANIZAÇÃO",  d.org);
  add("AS",           d.as);
  add("HOSTNAME",     d.reverse);
  add("MOBILE",       d.mobile !== undefined ? (d.mobile ? "SIM" : "NÃO") : undefined);
  add("PROXY/VPN",    d.proxy !== undefined ? (d.proxy ? "✅ SIM" : "❌ NÃO") : undefined);
  add("HOSTING",      d.hosting !== undefined ? (d.hosting ? "SIM" : "NÃO") : undefined);

  return { fields };
}

// ── Summary HTML (caption for .txt file) ─────────────────────────────────────
function buildCaption(tipo: string, dados: string, fields: Record<string, string>[], total?: number): string {
  const parts: string[] = [
    `✅ <b>Resultado encontrado</b>`,
    ``,
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

// ── Core: execute query and send result ───────────────────────────────────────
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
      fields = r.fields;
      sections = r.sections.length > 0 ? r.sections : undefined;
      rawText = r.raw;
    }

    const totalRegistros = sections?.reduce((a, s) => a + s.items.length, 0) ?? 0;
    const txt = buildResultTxt(tipo, trimmedDados, fields, sections, rawText);
    const caption = buildCaption(tipo, trimmedDados, fields, totalRegistros > 0 ? totalRegistros : undefined);

    // Delete loading message
    await telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

    const sentDoc = await telegram.sendDocument(
      chatId,
      { source: Buffer.from(txt, "utf-8"), filename: `infinity-${tipo}-${Date.now()}.txt` },
      {
        caption,
        parse_mode: "HTML",
        ...buildResultKeyboard(),
      },
    );
    void sentDoc;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await telegram.editMessageText(
      chatId, loadMsgId, undefined,
      `❌ <b>Erro na consulta de ${tipoInfo.label}</b>\n\n<code>${esc(msg.slice(0, 300))}</code>`,
      { parse_mode: "HTML", ...buildResultKeyboard() },
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

  // Register user commands
  void bot.telegram.setMyCommands([
    { command: "start",     description: "🌐 Menu principal" },
    { command: "cpf",       description: "🪪 Consultar CPF" },
    { command: "cnpj",      description: "🏭 Consultar CNPJ" },
    { command: "nome",      description: "👤 Consultar por Nome" },
    { command: "telefone",  description: "📞 Consultar Telefone" },
    { command: "placa",     description: "🚗 Consultar Placa" },
    { command: "bin",       description: "💳 Consultar BIN de Cartão" },
    { command: "ip",        description: "🌐 Consultar Geolocalização de IP" },
    { command: "ajuda",     description: "❓ Lista de comandos" },
  ]).catch(() => {});

  // ── Middleware: group-only + group size + channel membership ─────────────────
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!chat || !from) return next();

    // Private chats: show "group only" message (except for cb queries silently)
    if (chat.type === "private") {
      if ("message" in ctx) {
        await ctx.replyWithHTML(buildPrivateMsg(), Markup.inlineKeyboard([
          [Markup.button.url("💬 Suporte", SUPPORT_URL) as any],
        ]));
      }
      // Ignore callback_queries and other updates in private
      return;
    }

    // Groups/supergroups
    if (chat.type === "group" || chat.type === "supergroup") {
      // Allow admin commands without full auth
      if (isAdmin(from.id, from.username)) return next();

      // Check group size
      const groupAuth = await checkGroupAuthorization(bot.telegram, chat.id);
      if (!groupAuth.ok) {
        if ("message" in ctx) {
          try { await ctx.deleteMessage(); } catch {}
          await ctx.replyWithHTML(buildGroupTooSmallMsg(groupAuth.count));
        } else if ("callback_query" in ctx) {
          await (ctx as any).answerCbQuery("❌ Grupo muito pequeno (mín. " + MIN_GROUP_MEMBERS + " membros)", { show_alert: true });
        }
        return;
      }

      // Check channel membership
      const { ok, label } = await checkChannelMembership(bot.telegram, from.id);
      if (!ok) {
        if ("message" in ctx) {
          try { await ctx.deleteMessage(); } catch {}
          await ctx.replyWithHTML(buildNotAuthorizedMsg(label), buildNotAuthorizedKeyboard());
        } else if ("callback_query" in ctx) {
          await (ctx as any).answerCbQuery("❌ Entre nos canais obrigatórios primeiro!", { show_alert: true });
        }
        return;
      }

      verifiedUsers.add(from.id);
    }

    return next();
  });

  // ── When bot is added to a group ───────────────────────────────────────────
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
          `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ────────╮\n` +
          `┃\n` +
          `┃ ✅ <b>BOT ATIVADO!</b>\n` +
          `┠─────────────────────────────────\n` +
          `┃ Grupo com <b>${count}</b> membros — requisito\n` +
          `┃ mínimo atendido ✅\n` +
          `┃\n` +
          `┃ Consultas: <b>CPF, CNPJ, Nome,</b>\n` +
          `┃ <b>Telefone, Placa, BIN, IP</b>\n` +
          `┃\n` +
          `┃ Use /start para começar!\n` +
          `╰─────────────────────────────────╯`,
          { parse_mode: "HTML", ...buildMainKeyboard() },
        );
      } else {
        await bot.telegram.sendMessage(
          chat.id,
          buildGroupTooSmallMsg(count),
          { parse_mode: "HTML" },
        );
      }
    } catch { /* ignore */ }
  });

  // ── Admin: /liberar — manually authorize group ─────────────────────────────
  bot.command("liberar", async (ctx) => {
    const from = ctx.from;
    if (!isAdmin(from.id, from.username)) {
      await ctx.replyWithHTML("❌ Apenas admins podem usar este comando.");
      return;
    }
    if (ctx.chat.type === "private") {
      await ctx.replyWithHTML("ℹ️ Use este comando dentro do grupo.");
      return;
    }
    authorizedGroups.add(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      `✅ <b>Grupo liberado manualmente!</b>\nID: <code>${ctx.chat.id}</code>`,
      buildMainKeyboard(),
    );
  });

  // /bloquear — remove group authorization
  bot.command("bloquear", async (ctx) => {
    const from = ctx.from;
    if (!isAdmin(from.id, from.username)) return;
    authorizedGroups.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`🔒 <b>Grupo bloqueado.</b>\nID: <code>${ctx.chat.id}</code>`);
  });

  // /groupid — show current chat ID
  bot.command("groupid", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(
      `🆔 <b>ID deste chat</b>\n\nID: <code>${ctx.chat.id}</code>\nTipo: <code>${ctx.chat.type}</code>`,
    );
  });

  // /channelid — set channel 1 ID
  bot.command("channelid", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    CHANNEL1_ID = ctx.chat.id;
    await ctx.replyWithHTML(
      `📡 <b>Canal 1 configurado!</b>\n\nID: <code>${ctx.chat.id}</code>\n\n` +
      `Defina <code>INFINITY_CHANNEL_ID=${ctx.chat.id}</code> para persistir.`,
    );
  });

  // /addadmin — add admin
  bot.command("addadmin", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    const args = ctx.message.text.split(" ").slice(1);
    const uid = Number(args[0]);
    if (!uid) { await ctx.replyWithHTML("Uso: <code>/addadmin 123456789</code>"); return; }
    ADMIN_IDS.add(uid);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <code>${uid}</code> adicionado como admin.`);
  });

  // /status_bot
  bot.command("status_bot", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    await ctx.replyWithHTML([
      `📊 <b>Status do Bot</b>`,
      ``,
      `Canal 1 ID: <code>${CHANNEL1_ID ?? "não configurado"}</code>`,
      `Usuários verificados: <b>${verifiedUsers.size}</b>`,
      `Grupos autorizados: <b>${authorizedGroups.size}</b>`,
      `IDs dos grupos: ${[...authorizedGroups].map(id => `<code>${id}</code>`).join(", ") || "nenhum"}`,
    ].join("\n"));
  });

  // /setbanner
  bot.command("setbanner", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    try { await ctx.deleteMessage(); } catch {}
    const url = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!url) {
      await ctx.replyWithHTML(`🖼️ <b>Banner atual:</b> <code>${BOT_BANNER_URL || "nenhum"}</code>\n\nUso: <code>/setbanner https://...</code>`);
      return;
    }
    BOT_BANNER_URL = url;
    await ctx.replyWithHTML(`✅ <b>Banner atualizado!</b>\n<code>${url}</code>`);
  });

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    const from = ctx.from;
    const name = from.username ? `@${from.username}` : (from.first_name ?? "operador");
    pendingQueries.delete(from.id);
    await sendBanner(ctx as any, buildHomeMsg(name, isAdmin(from.id, from.username)), buildMainKeyboard());
  });

  // ── /ajuda ────────────────────────────────────────────────────────────────
  bot.command("ajuda", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(buildHelpMsg(), Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "home")]]));
  });

  // ── Direct query commands ──────────────────────────────────────────────────
  async function handleDirectCommand(
    ctx: any,
    tipo: string,
  ): Promise<void> {
    try { await ctx.deleteMessage(); } catch {}
    const text: string = ctx.message?.text ?? "";
    const args = text.split(" ").slice(1).join(" ").trim();

    if (!args) {
      const tipoInfo = TIPO_MAP.get(tipo)!;
      const promptMsg = await ctx.replyWithHTML(buildPromptMsg(tipoInfo), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "cancel")]]));
      pendingQueries.set(ctx.from.id, { tipo, promptMsgId: promptMsg.message_id, chatId: ctx.chat.id });
      return;
    }

    const tipoInfo = TIPO_MAP.get(tipo)!;
    const loadMsg = await ctx.replyWithHTML(buildLoadingMsg(tipoInfo, args));
    await executeAndSend(bot.telegram, ctx.chat.id, tipo, args, loadMsg.message_id);
  }

  bot.command("cpf",      ctx => handleDirectCommand(ctx, "cpf"));
  bot.command("cnpj",     ctx => handleDirectCommand(ctx, "cnpj"));
  bot.command("nome",     ctx => handleDirectCommand(ctx, "nome"));
  bot.command("telefone", ctx => handleDirectCommand(ctx, "telefone"));
  bot.command("placa",    ctx => handleDirectCommand(ctx, "placa"));
  bot.command("bin",      ctx => handleDirectCommand(ctx, "bin"));
  bot.command("ip",       ctx => handleDirectCommand(ctx, "ip"));

  // ── Callback actions ───────────────────────────────────────────────────────
  bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    const from = ctx.from!;
    pendingQueries.delete(from.id);
    const name = from.username ? `@${from.username}` : (from.first_name ?? "operador");
    await ctx.replyWithHTML(buildHomeMsg(name, isAdmin(from.id, from.username)), buildMainKeyboard());
  });

  bot.action("show_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithHTML(buildHelpMsg(), Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "home")]]));
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery("Cancelado");
    const from = ctx.from!;
    pendingQueries.delete(from.id);
    try { await ctx.deleteMessage(); } catch {}
  });

  // q:<tipo> — interactive query selector
  bot.action(/^q:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
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

  // ── Text message handler: capture pending query input ─────────────────────
  bot.on("text", async (ctx) => {
    const from = ctx.from;
    const pending = pendingQueries.get(from.id);
    if (!pending || pending.chatId !== ctx.chat.id) return;

    const dados = ctx.message.text.trim();
    if (!dados || dados.startsWith("/")) return;

    pendingQueries.delete(from.id);

    // Delete user's message
    try { await ctx.deleteMessage(); } catch {}

    // Edit the prompt message to loading state
    const tipoInfo = TIPO_MAP.get(pending.tipo)!;
    const loadMsg = await ctx.replyWithHTML(buildLoadingMsg(tipoInfo, dados));

    // Delete the old prompt
    try { await bot.telegram.deleteMessage(pending.chatId, pending.promptMsgId); } catch {}

    await executeAndSend(bot.telegram, ctx.chat.id, pending.tipo, dados, loadMsg.message_id);
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  bot.launch({ allowedUpdates: ["message", "callback_query", "my_chat_member"] })
    .catch(err => console.error("[InfinityBot] launch error:", err));

  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  process.once("SIGINT",  () => bot.stop("SIGINT"));

  console.log("[InfinityBot] Bot iniciado com sucesso ✅");
}
