import { Telegraf, Markup } from "telegraf";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE     = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY      = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL        = "https://t.me/Blxckxyz";
const SUPPORT_URL2       = "https://t.me/xxmathexx";
const SUPPORT_URL3       = "https://t.me/piancooz";
const PANEL_URL          = process.env.INFINITY_PANEL_URL ?? "https://infinitysearch.pro";

const LINE  = "═".repeat(44);
const LINE2 = "─".repeat(44);
const AUTHOR = "blxckxyz";
const BOT_NAME_HDR = "᯽ INFINITY SEARCH ᯽";

// ── Channel — only updates channel required ────────────────────────────────────
const CHANNEL_INVITE   = "https://t.me/infinitysearchchannel";
const CHANNEL_USERNAME = process.env.INFINITY_CHANNEL2_USERNAME ?? "@infinitysearchchannel";
let   CHANNEL_ID: number | null = process.env.INFINITY_CHANNEL_ID
  ? Number(process.env.INFINITY_CHANNEL_ID)
  : null;

// ── Grupos autorizados (grupo Infinity pré-carregado) ─────────────────────────
const INFINITY_GROUP_ID  = -1003795096082;
const authorizedGroups   = new Set<number>([INFINITY_GROUP_ID]);

// ── Access control ─────────────────────────────────────────────────────────────
const ADMIN_USERNAMES  = new Set<string>(["blxckxyz", "xxmathexx", "pianco", "piancooz"]);
const ADMIN_IDS        = new Set<number>();

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
const PENDING_TTL_MS = 90_000; // 90 seconds — query expires if user doesn't respond
interface PendingQuery { tipo: string; promptMsgId: number; chatId: number; expiresAt: number; timer: ReturnType<typeof setTimeout> }
const pendingQueries = new Map<number, PendingQuery>();

function setPending(userId: number, data: Omit<PendingQuery, "expiresAt" | "timer">): void {
  const existing = pendingQueries.get(userId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => pendingQueries.delete(userId), PENDING_TTL_MS);
  pendingQueries.set(userId, { ...data, expiresAt: Date.now() + PENDING_TTL_MS, timer });
}

function getPending(userId: number): Omit<PendingQuery, "timer"> | undefined {
  const p = pendingQueries.get(userId);
  if (!p) return undefined;
  if (Date.now() > p.expiresAt) { clearTimeout(p.timer); pendingQueries.delete(userId); return undefined; }
  return p;
}

function deletePending(userId: number): void {
  const p = pendingQueries.get(userId);
  if (p) { clearTimeout(p.timer); pendingQueries.delete(userId); }
}

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


// ── Keyboards ─────────────────────────────────────────────────────────────────
function buildStartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Consultas", "menu_consultas"), Markup.button.callback("💬 Suporte", "menu_suporte")],
    [Markup.button.callback("❓ Ajuda", "show_help")],
    [Markup.button.url("🖥️ Completo", PANEL_URL) as any],
  ]);
}

function buildConsultasKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("CPF",           "q:cpf"),      Markup.button.callback("CNPJ",       "q:cnpj")],
    [Markup.button.callback("NOME",          "q:nome"),     Markup.button.callback("TELEFONE",   "q:telefone")],
    [Markup.button.callback("CEP",           "q:cep"),      Markup.button.callback("PLACA",      "q:placa")],
    [Markup.button.callback("BIN",           "q:bin"),      Markup.button.callback("IP",         "q:ip")],
    [Markup.button.callback("📸 FOTO 🔒",   "locked:foto"), Markup.button.callback("📊 SCORE 🔒","locked:score")],
    [Markup.button.callback("💰 IRPF 🔒",   "locked:irpf"), Markup.button.callback("🧾 CHEQUE 🔒","locked:cheque")],
    [Markup.button.callback("🔄 Voltar",    "home")],
  ]);
}

function buildSuporteKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("👤 @Blxckxyz",  SUPPORT_URL)  as any, Markup.button.url("👤 @xxmathexx", SUPPORT_URL2) as any],
    [Markup.button.url("👤 @piancooz",  SUPPORT_URL3) as any],
    [Markup.button.callback("🔙 Voltar", "home")],
  ]);
}

function buildResultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 Nova Consulta", "menu_consultas"), Markup.button.callback("🏠 Início", "home")],
    [Markup.button.url("💬 Suporte", SUPPORT_URL) as any, Markup.button.callback("🗑️ Apagar", "delete_result") as any],
    [Markup.button.url("🖥️ Acessar Painel Pro ✨", PANEL_URL) as any],
  ]);
}

function buildNotAuthorizedKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("📣 Canal de Atualizações", CHANNEL_INVITE) as any],
    [Markup.button.url("💬 Suporte @Blxckxyz", SUPPORT_URL) as any],
  ]);
}

// ── Messages ──────────────────────────────────────────────────────────────────
const HDR = `╭──── ${BOT_NAME_HDR} ────╮`;
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
    "┃",
    "┃ 🔒 = Exclusivo no Painel Pro",
    FTR,
  ].join("\n");
}

function buildUpsellMsg(tipoLabel: string): string {
  return [
    HDR,
    "┃",
    `┃  🔒 ${tipoLabel} — PAINEL PRO`,
    DIV,
    "┃ Este tipo de consulta está",
    "┃ disponível <b>apenas no Painel</b>.",
    "┃",
    "┃ No Painel Completo você tem:",
    "┃  📸 Foto biométrica",
    "┃  📋 Dados completos",
    "┃  💰 IRPF e Renda",
    "┃  📊 Score de crédito",
    "┃  🧾 Cheque e histórico",
    "┃  🔎 +20 tipos de consulta",
    "┃  ⚡ Acesso ilimitado",
    DIV,
    "┃  👇 Garanta seu acesso agora",
    FTR,
  ].join("\n");
}

function buildUpsellKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("🖥️ Acessar Painel Completo", PANEL_URL) as any],
    [Markup.button.url("💬 @Blxckxyz", SUPPORT_URL) as any, Markup.button.url("💬 @xxmathexx", SUPPORT_URL2) as any, Markup.button.url("💬 @piancooz", SUPPORT_URL3) as any],
    [Markup.button.callback("🔙 Voltar às Consultas", "menu_consultas")],
  ]);
}

function buildFunnelMsg(): string {
  return [
    HDR,
    "┃",
    "┃  💎 QUER AINDA MAIS DADOS?",
    DIV,
    "┃ No <b>Painel Infinity Pro</b>:",
    "┃",
    "┃  📸 Foto biométrica do alvo",
    "┃  📋 Histórico completo",
    "┃  📊 Score + IRPF + Renda",
    "┃  🧾 Cheque e negativações",
    "┃  🔎 +20 tipos de consulta",
    "┃  ⚡ Acesso ilimitado 24h",
    DIV,
    "┃  👇 Garanta seu acesso agora",
    FTR,
  ].join("\n");
}

function buildFunnelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url("🖥️ Acessar Painel Pro", PANEL_URL) as any],
    [Markup.button.url("📣 Canal de Novidades", CHANNEL_INVITE) as any],
  ]);
}

function buildSuporteMsg(): string {
  return [
    HDR,
    "┃",
    "┃ • SUPORTE DISPONÍVEL",
    DIV,
    "┃ ESCOLHA UM DOS ADMINS ABAIXO 👇🏻",
    FTR,
  ].join("\n");
}

function buildPrivateMsg(): string {
  return [
    HDR,
    "┃",
    "┃ 🤖 USE NO GRUPO INFINITY",
    DIV,
    `┃ Este bot funciona apenas no`,
    `┃ grupo oficial do Infinity Search.`,
    "┃",
    "┃ 💬 Entre em contato com o suporte.",
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
const W = 52; // total width inside borders
const BORDER_TOP    = `╔${"═".repeat(W)}╗`;
const BORDER_BOT    = `╚${"═".repeat(W)}╝`;
const BORDER_MID    = `╠${"═".repeat(W)}╣`;
const BORDER_SEP    = `╟${"─".repeat(W)}╢`;
const BORDER_SIDE   = "║";

function txtLine(text = ""): string {
  const pad = W - text.length;
  const l = Math.floor(pad / 2);
  const r = pad - l;
  return `${BORDER_SIDE}${" ".repeat(l)}${text}${" ".repeat(Math.max(0, r))}${BORDER_SIDE}`;
}

function txtKV(key: string, value: string): string {
  const keyW = 20;
  const valW = W - keyW - 5; // "  KEY : VALUE  "
  const k = key.slice(0, keyW).padEnd(keyW);
  const v = String(value).slice(0, valW);
  const content = `  ${k} : ${v}`;
  return `${BORDER_SIDE}${content.padEnd(W)}${BORDER_SIDE}`;
}

function buildResultTxt(
  tipo: string,
  dados: string,
  content: Record<string, string>[],
  sections?: { name: string; items: string[] }[],
  rawText?: string,
): string {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(BORDER_TOP);
  lines.push(txtLine());
  lines.push(txtLine("∞  INFINITY SEARCH  ∞"));
  lines.push(txtLine("Powered by Infinity Search Pro"));
  lines.push(txtLine());
  lines.push(BORDER_MID);
  lines.push(txtLine());
  lines.push(txtKV("Consulta", tipo.toUpperCase()));
  lines.push(txtKV("Dado", dados));
  lines.push(txtKV("Data", now));
  lines.push(txtKV("Canal", "@infinitysearchchannel"));
  lines.push(txtLine());
  lines.push(BORDER_MID);

  // ── Fields ─────────────────────────────────────────────────────────────────
  if (content.length > 0) {
    lines.push(txtLine());
    lines.push(txtLine("◆  DADOS ENCONTRADOS"));
    lines.push(txtLine());
    for (const field of content) {
      const [k, v] = Object.entries(field)[0] ?? ["", ""];
      if (k) lines.push(txtKV(k, String(v)));
    }
    lines.push(txtLine());
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  if (sections && sections.length > 0) {
    for (const sec of sections) {
      lines.push(BORDER_SEP);
      lines.push(txtLine());
      lines.push(txtLine(`◆  ${sec.name}  (${sec.items.length} registro${sec.items.length !== 1 ? "s" : ""})`));
      lines.push(txtLine());
      sec.items.forEach((item, i) => {
        const num = `  ${String(i + 1).padStart(3)}.  `;
        const valW = W - num.length - 2;
        const chunks: string[] = [];
        let rest = item;
        while (rest.length > 0) {
          chunks.push(rest.slice(0, valW));
          rest = rest.slice(valW);
        }
        chunks.forEach((chunk, ci) => {
          const prefix = ci === 0 ? num : " ".repeat(num.length);
          const content2 = `${prefix}${chunk}`;
          lines.push(`${BORDER_SIDE}${content2.padEnd(W)}${BORDER_SIDE}`);
        });
      });
      lines.push(txtLine());
    }
  }

  // ── Raw fallback ───────────────────────────────────────────────────────────
  if (content.length === 0 && (!sections || sections.length === 0) && rawText) {
    lines.push(txtLine());
    lines.push(txtLine("◆  RESPOSTA BRUTA"));
    lines.push(txtLine());
    const rawLines = rawText.slice(0, 3000).split(/\s{2,}|\n/);
    for (const rl of rawLines) {
      if (rl.trim()) {
        const content3 = `  ${rl.trim()}`;
        lines.push(`${BORDER_SIDE}${content3.slice(0, W).padEnd(W)}${BORDER_SIDE}`);
      }
    }
    lines.push(txtLine());
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  lines.push(BORDER_MID);
  lines.push(txtLine());
  lines.push(txtLine("Infinity Search  ·  infinitysearch.pro"));
  lines.push(txtLine("Suporte: @Blxckxyz  |  @xxmathexx  |  @piancooz"));
  lines.push(txtLine(`Canal: @infinitysearchchannel`));
  lines.push(txtLine());
  lines.push(BORDER_BOT);

  return lines.join("\n");
}

// ── Geass API ─────────────────────────────────────────────────────────────────
interface GeassResult { fields: Record<string, string>[]; sections: { name: string; items: string[] }[]; raw: string }

// ── Full provider text parser (mirrors API server parseProviderText) ──────────
const SEP = " \u23AF ";
const PURE_KEY_RE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_]+$/;
const LAST_WORD_RE = /\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$/;
const KNOWN_MULTI = new Set([
  "NOME MÃE","NOME PAI","NOME MAE","MUNICÍPIO DE NASCIMENTO","MUNICIPIO DE NASCIMENTO",
  "TIPO SANGÚINEO","TIPO SANGUINEO","ESTADO CIVIL","STATUS NA RECEITA","HABILITADO PARA DIRIGIR",
  "ANO MODELO","ANO FABRICACAO","ANO FABRICAÇÃO","PROPRIETARIO NOME","PROPRIETARIO CPF",
  "MARCA MODELO","NUMERO CHASSI","DATA EMISSAO","DATA NASCIMENTO","DATA OBITO",
  "NOME FANTASIA","RAZAO SOCIAL","SITUACAO CADASTRAL","NATUREZA JURIDICA","CAPITAL SOCIAL",
  "DATA ABERTURA","ENDERECO COMPLETO","LOGRADOURO TIPO","TITULO ELEITOR","CLASSE SOCIAL",
  "RECEBE INSS","NOME SOCIAL","RACA COR","TIPO LOGRADOURO","DATA EMISSAO RG",
  "ORGAO EMISSOR","PAIS NASCIMENTO","PAIS RESIDENCIA","SITUACAO ESPECIAL","DATA SITUACAO",
]);

function extractTrailingKey(seg: string): { value: string; key: string } {
  const t = seg.trim();
  if (KNOWN_MULTI.has(t) || PURE_KEY_RE.test(t)) return { value: "", key: t };
  for (const n of [3, 2]) {
    const re = new RegExp(`^(.*?)\\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*\\s+){${n-1}}[A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_][A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Z_0-9]*)$`);
    const m = re.exec(t);
    if (m && KNOWN_MULTI.has(m[2].trim())) return { value: m[1].trim(), key: m[2].trim() };
  }
  const lm = LAST_WORD_RE.exec(t);
  if (lm) return { value: t.slice(0, lm.index).trim(), key: lm[1].trim() };
  return { value: t, key: "" };
}

function parseProviderText(raw: string): { fields: { key: string; value: string }[]; sections: { name: string; items: string[] }[] } {
  const fields: { key: string; value: string }[] = [];
  const sections: { name: string; items: string[] }[] = [];

  // BASE N format
  if (/\bBASE\s+\d+\b/i.test(raw)) {
    const segs = raw.split(/\s*BASE\s+\d+\s*/i).filter(p => p.trim().includes(":"));
    const items: string[] = [];
    for (const seg of segs) {
      const pairs: string[] = [];
      const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(seg)) !== null) {
        const k = m[1].trim(); const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
        if (k && v) pairs.push(`${k}: ${v}`);
      }
      if (pairs.length > 0) items.push(pairs.join(" · "));
    }
    if (items.length > 0) sections.push({ name: "REGISTROS", items });
    return { fields, sections };
  }

  // No ⎯ — try colon format
  if (!raw.includes("\u23AF")) {
    if (raw.includes(":")) {
      const re = /\b([A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*)\s*:\s*`?([^:\n]+?)(?=\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÔÇÑA-Z_]+)*\s*:|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        const k = m[1].trim(); const v = m[2].trim().replace(/`/g, "").replace(/\s+/g, " ");
        if (k.length >= 2 && v) fields.push({ key: k, value: v });
      }
    }
    return { fields, sections };
  }

  // Section headers: "NAME: (N - Encontrados)"
  const SEC_HDR = /([A-ZÁÉÍÓÚÂÊÔÃÕÇÑA-Za-z ]{3,}):\s*\(\s*(\d+)\s*-\s*Encontrados?\s*\)/g;
  const secBounds: Array<{ name: string; count: number; start: number; headerEnd: number }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = SEC_HDR.exec(raw)) !== null) {
    secBounds.push({ name: sm[1].trim().toUpperCase(), count: parseInt(sm[2]), start: sm.index, headerEnd: sm.index + sm[0].length });
  }

  // Fields (before first section)
  const fieldsEnd = secBounds.length > 0 ? secBounds[0].start : raw.length;
  const fieldsRaw = raw.slice(0, fieldsEnd);
  if (fieldsRaw.includes("\u23AF")) {
    const parts = fieldsRaw.split(SEP);
    const firstEx = extractTrailingKey(parts[0]);
    let curKey = firstEx.key || parts[0].trim();
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        const val = part.trim().replace(/\s*\u23AF\s*$/, "").replace(/\s+/g, " ").trim();
        if (curKey && val && !PURE_KEY_RE.test(val)) fields.push({ key: curKey, value: val });
        break;
      }
      const { value, key: nextKey } = extractTrailingKey(part);
      const cleanVal = value.replace(/\s+/g, " ");
      if (curKey && cleanVal) fields.push({ key: curKey, value: cleanVal });
      curKey = nextKey;
    }
  }

  // Parse sections
  for (let si = 0; si < secBounds.length; si++) {
    const sb = secBounds[si];
    if (sb.count === 0) continue;
    const contentEnd = si + 1 < secBounds.length ? secBounds[si + 1].start : raw.length;
    const content = raw.slice(sb.headerEnd, contentEnd).trim();
    if (!content) continue;
    const items: string[] = [];
    if (content.includes("•")) {
      content.split("•").slice(1).forEach(b => {
        const item = b.trim().replace(/\s+/g, " ").replace(/\s+[-–]\s*$/, "").trim();
        if (item && !/\bNone\b/.test(item)) items.push(item);
      });
    } else if (content.includes("\u23AF")) {
      const sub = content.replace(/\s*\u23AF\s*$/, "").split(SEP).map(s => s.trim()).filter(Boolean);
      for (let j = 0; j + 1 < sub.length; j += 2) {
        if (sub[j] && sub[j+1]) items.push(`${sub[j]}: ${sub[j+1]}`);
        else if (sub[j]) items.push(sub[j]);
      }
      if (sub.length % 2 === 1 && sub[sub.length - 1]) items.push(sub[sub.length - 1]);
    } else {
      const plain = content.replace(/\s+/g, " ");
      if (plain) items.push(plain);
    }
    if (items.length > 0) sections.push({ name: sb.name, items });
  }

  // INTERESSES PESSOAIS (special format)
  const intIdx = raw.indexOf("INTERESSES PESSOAIS:");
  if (intIdx !== -1) {
    const intContent = raw.slice(intIdx + "INTERESSES PESSOAIS:".length);
    const intItems = intContent.split(/\s*-\s+/).map(s => s.trim().replace(/\s+/g, " ")).filter(s => s.includes(":"));
    const simItems = intItems.filter(s => /:\s*Sim\b/i.test(s));
    const show = simItems.length > 0 ? simItems : intItems.slice(0, 10);
    if (show.length > 0) sections.push({ name: "INTERESSES PESSOAIS", items: show });
  }

  // Filter junk values
  const filtered = fields.filter(({ value: v }) => {
    if (!v.trim()) return false;
    if (/^R\$\s*$/.test(v)) return false;
    if (/^ZONA:\s*SECAO:\s*$/.test(v)) return false;
    if (/^None$/.test(v)) return false;
    return true;
  });

  return { fields: filtered, sections };
}

function parseGeassRaw(raw: string): GeassResult {
  const parsed = parseProviderText(raw);
  return {
    fields: parsed.fields.map(f => ({ [f.key]: f.value })),
    sections: parsed.sections,
    raw,
  };
}

async function queryGeass(tipo: string, dados: string): Promise<GeassResult> {
  const url = `${GEASS_API_BASE}/${tipo}?dados=${encodeURIComponent(dados)}&apikey=${encodeURIComponent(GEASS_API_KEY)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`Provedor retornou HTTP ${resp.status}`);
  const text = await resp.text();
  let json: { status?: string; resposta?: string; error?: string };
  try { json = JSON.parse(text); } catch { throw new Error("Resposta inválida do provedor"); }
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

// ── Beautiful result message ──────────────────────────────────────────────────
function buildResultMsg(
  tipo: string,
  dados: string,
  fields: Record<string, string>[],
  sections?: { name: string; items: string[] }[],
): string {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const tipoInfo = TIPO_MAP.get(tipo);
  const totalReg = sections?.reduce((a, s) => a + s.items.length, 0) ?? 0;

  const lines: string[] = [
    HDR,
    "┃",
    `┃  ✅ ${tipoInfo?.label ?? tipo.toUpperCase()} ENCONTRADO`,
    DIV,
    `┃  📌 <b>Dado:</b> <code>${esc(dados)}</code>`,
  ];

  if (fields.length > 0) {
    lines.push(DIV);
    for (const f of fields.slice(0, 28)) {
      const [k, v] = Object.entries(f)[0] ?? ["", ""];
      if (!k) continue;
      const val = esc(String(v).slice(0, 90));
      lines.push(`┃ <b>${esc(k)}</b>: <code>${val}</code>`);
    }
  } else if (!sections || sections.length === 0) {
    lines.push(DIV);
    lines.push("┃  ⚠️ Nenhum campo encontrado.");
  }

  if (sections && sections.length > 0) {
    lines.push(DIV);
    for (const sec of sections.slice(0, 4)) {
      lines.push(`┃  📂 <b>${esc(sec.name)}</b> (${sec.items.length})`);
      sec.items.slice(0, 3).forEach(item =>
        lines.push(`┃    • <code>${esc(item.slice(0, 65))}</code>`)
      );
      if (sec.items.length > 3) lines.push(`┃    <i>... +${sec.items.length - 3} registros</i>`);
    }
    if (sections.length > 4) lines.push(`┃  <i>+ ${sections.length - 4} seções</i>`);
  }

  lines.push(DIV);
  if (totalReg > 0) lines.push(`┃  📁 Total de registros: <b>${totalReg}</b>`);
  lines.push(`┃  🕐 ${now}`);
  lines.push(DIV);
  lines.push("┃  💎 <b>QUER AINDA MAIS DADOS?</b>");
  lines.push("┃  📸 Foto · 📊 Score · 💰 IRPF");
  lines.push("┃  🔎 +20 tipos · ⚡ Acesso ilimitado");
  lines.push(FTR);

  return lines.join("\n").slice(0, 4096);
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
      fields = r.fields;
      sections = r.sections.length > 0 ? r.sections : undefined;
      rawText = r.raw;
    }

    const totalRegistros = sections?.reduce((a, s) => a + s.items.length, 0) ?? 0;
    const resultMsg = buildResultMsg(tipo, trimmedDados, fields, sections);

    await telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

    const txt = buildResultTxt(tipo, trimmedDados, fields, sections, rawText);

    // Envia o .txt como documento (sem caption)
    await telegram.sendDocument(
      chatId,
      { source: Buffer.from(txt, "utf-8"), filename: `infinity-${tipo}-${Date.now()}.txt` },
    );

    // Envia o resultado como blockquote (visual de citação do Telegram)
    const blockText = `<blockquote>${resultMsg.slice(0, 4096)}</blockquote>`;
    await telegram.sendMessage(chatId, blockText, { parse_mode: "HTML", ...buildResultKeyboard() });


  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await telegram.editMessageText(
      chatId, loadMsgId, undefined,
      [
        HDR, "┃",
        `┃  ❌ ERRO NA CONSULTA DE ${tipoInfo.label}`,
        DIV,
        `┃ <code>${esc(msg.slice(0, 300))}</code>`,
        FTR,
      ].join("\n"),
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

function buildSupportKeyboardSimple() {
  return Markup.inlineKeyboard([
    [Markup.button.url("💬 @Blxckxyz", SUPPORT_URL) as any, Markup.button.url("💬 @xxmathexx", SUPPORT_URL2) as any],
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
    { command: "setgroup",  description: "🔐 [Admin] Liberar grupo atual" },
    { command: "groupid",   description: "🆔 [Admin] Ver ID do grupo" },
    { command: "liberar",   description: "✅ [Admin] Liberar grupo" },
    { command: "bloquear",  description: "🔒 [Admin] Bloquear grupo" },
    { command: "addadmin",  description: "👤 [Admin] Adicionar admin por ID" },
    { command: "status_bot", description: "📊 [Admin] Status do bot" },
  ]).catch(() => {});

  // ── Middleware ────────────────────────────────────────────────────────────
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!chat || !from) return next();

    // Private chats: allow freely
    if (chat.type === "private") return next();

    if (chat.type === "group" || chat.type === "supergroup") {
      // Admins passam direto em QUALQUER grupo (inclusive para poder usar /setgroup)
      if (isAdmin(from.id, from.username)) return next();

      // Usuários comuns: só opera em grupos autorizados
      if (!authorizedGroups.has(chat.id)) return;

      // Processa apenas comandos, callbacks e respostas de consulta pendente
      const hasCommand = "message" in ctx && (ctx as any).message?.text?.startsWith("/");
      const hasCallback = "callback_query" in ctx;
      const hasPending = "message" in ctx && getPending(from.id) !== null;
      if (!hasCommand && !hasCallback && !hasPending) return;
    }

    return next();
  });

  // ── Bot adicionado a grupo — aguarda /setgroup do admin ──────────────────
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.update.my_chat_member;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    if (newStatus !== "member" && newStatus !== "administrator") return;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    // Não faz nada ao ser adicionado — admin precisa usar /setgroup para liberar
  });

  // ── Admin commands ────────────────────────────────────────────────────────
  bot.command("setgroup", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    if (ctx.chat.type === "private") { await ctx.replyWithHTML("ℹ️ Use dentro do grupo que deseja liberar."); return; }
    authorizedGroups.add(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <b>Grupo liberado!</b>\nID: <code>${ctx.chat.id}</code>`);
  });

  bot.command("liberar", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    if (ctx.chat.type === "private") { await ctx.replyWithHTML("ℹ️ Use dentro do grupo que deseja liberar."); return; }
    authorizedGroups.add(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`✅ <b>Grupo liberado!</b>\nID: <code>${ctx.chat.id}</code>`);
  });

  bot.command("bloquear", async (ctx) => {
    if (!isAdmin(ctx.from.id, ctx.from.username)) return;
    if (ctx.chat.type === "private") { await ctx.replyWithHTML("ℹ️ Use dentro do grupo."); return; }
    authorizedGroups.delete(ctx.chat.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(`🔒 <b>Grupo bloqueado.</b>\nID: <code>${ctx.chat.id}</code>`);
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
      `Grupos liberados: <b>${authorizedGroups.size}</b> (<code>${[...authorizedGroups].join(", ")}</code>)`,
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
    deletePending(from.id);
    await sendBanner(ctx as any, buildHomeMsg(name, isAdmin(from.id, from.username)), buildStartKeyboard());
  });

  // ── /ajuda ────────────────────────────────────────────────────────────────
  bot.command("ajuda", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    const admin = isAdmin(ctx.from.id, ctx.from.username);
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
      ...(admin ? [
        DIV,
        "┃ 🔐 <b>ADMIN</b>",
        "┃ /setgroup — Liberar grupo atual",
        "┃ /groupid — Ver ID do grupo",
        "┃ /bloquear — Bloquear grupo",
        "┃ /addadmin — Adicionar admin por ID",
        "┃ /status_bot — Status do bot",
      ] : []),
      DIV, "┃ Use /start para o menu.", FTR,
    ];
    await ctx.replyWithHTML(lines.join("\n"), Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "menu_consultas")]]));
  });

  // ── Direct commands ───────────────────────────────────────────────────────
  async function handleDirectCommand(ctx: any, tipo: string): Promise<void> {
    // Block queries in private chat
    if (ctx.chat?.type === "private") {
      await ctx.replyWithHTML(buildPrivateQueryMsg(), buildSupportKeyboardSimple());
      return;
    }
    try { await ctx.deleteMessage(); } catch {}
    const text: string = ctx.message?.text ?? "";
    const args = text.split(" ").slice(1).join(" ").trim();
    const tipoInfo = TIPO_MAP.get(tipo)!;
    if (!args) {
      const promptMsg = await ctx.replyWithHTML(
        buildPromptMsg(tipoInfo),
        Markup.inlineKeyboard([
          [Markup.button.callback("🔙 Voltar", "menu_consultas"), Markup.button.callback("❌ Cancelar", "cancel")],
        ]),
      );
      setPending(ctx.from.id, { tipo, promptMsgId: promptMsg.message_id, chatId: ctx.chat.id });
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
    deletePending(from.id);
    const name = from.username ? `@${from.username}` : (from.first_name ?? "operador");
    try {
      await ctx.editMessageText(buildHomeMsg(name, isAdmin(from.id, from.username)), { parse_mode: "HTML", ...buildStartKeyboard() });
    } catch { await ctx.replyWithHTML(buildHomeMsg(name, isAdmin(from.id, from.username)), buildStartKeyboard()); }
  });

  bot.action("menu_consultas", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(buildConsultasMenuMsg(), { parse_mode: "HTML", ...buildConsultasKeyboard() });
    } catch { await ctx.replyWithHTML(buildConsultasMenuMsg(), buildConsultasKeyboard()); }
  });

  bot.action("menu_suporte", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(buildSuporteMsg(), { parse_mode: "HTML", ...buildSuporteKeyboard() });
    } catch { await ctx.replyWithHTML(buildSuporteMsg(), buildSuporteKeyboard()); }
  });

  bot.action("show_help", async (ctx) => {
    await ctx.answerCbQuery();
    const from = ctx.from!;
    const admin = isAdmin(from.id, from.username);
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
      ...(admin ? [
        DIV,
        "┃ 🔐 <b>ADMIN</b>",
        "┃ /setgroup — Liberar grupo atual",
        "┃ /groupid — Ver ID do grupo",
        "┃ /bloquear — Bloquear grupo",
        "┃ /addadmin — Adicionar admin",
        "┃ /status_bot — Status do bot",
      ] : []),
      DIV,
      "┃ 💡 Use os botões em /start.",
      FTR,
    ];
    const kb = Markup.inlineKeyboard([[Markup.button.callback("🔍 Consultar", "menu_consultas"), Markup.button.callback("🏠 Início", "home")]]);
    try {
      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", ...kb });
    } catch { await ctx.replyWithHTML(lines.join("\n"), kb); }
  });

  bot.action("cancel", async (ctx) => {
    await ctx.answerCbQuery("Cancelado");
    const from = ctx.from!;
    deletePending(from.id);
    try { await ctx.deleteMessage(); } catch {}
  });

  bot.action("delete_result", async (ctx) => {
    await ctx.answerCbQuery("Apagado!");
    try { await ctx.deleteMessage(); } catch {}
  });

  // ── Funnel B — locked tipos ────────────────────────────────────────────────
  const LOCKED_LABELS: Record<string, string> = {
    foto: "FOTO BIOMÉTRICA",
    score: "SCORE DE CRÉDITO",
    irpf: "IRPF / RENDA",
    cheque: "CHEQUE",
  };
  bot.action(/^locked:(.+)$/, async (ctx) => {
    const key = (ctx.match as RegExpMatchArray)[1];
    const label = LOCKED_LABELS[key] ?? key.toUpperCase();
    await ctx.answerCbQuery("🔒 Disponível no Painel Pro!", { show_alert: false });
    await ctx.replyWithHTML(buildUpsellMsg(label), buildUpsellKeyboard());
  });

  bot.action(/^q:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    // Block queries in private chat
    if (ctx.chat?.type === "private") {
      await ctx.replyWithHTML(buildPrivateQueryMsg(), buildSupportKeyboardSimple());
      return;
    }
    const tipo = (ctx.match as RegExpMatchArray)[1];
    const tipoInfo = TIPO_MAP.get(tipo);
    if (!tipoInfo) return;
    const from = ctx.from!;
    deletePending(from.id);
    const promptMsg = await ctx.replyWithHTML(
      buildPromptMsg(tipoInfo),
      Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "cancel")]]),
    );
    setPending(from.id, { tipo, promptMsgId: promptMsg.message_id, chatId: ctx.chat!.id });
  });

  // ── Text: capture pending query only — ignore all other messages ──────────
  bot.on("text", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    // Only respond if this user has an active, non-expired pending query in this chat
    const pending = getPending(from.id);
    if (!pending || pending.chatId !== ctx.chat.id) return;
    const dados = ctx.message.text.trim();
    // Ignore commands and bot mentions that aren't query data
    if (!dados || dados.startsWith("/") || dados.startsWith("@")) return;
    deletePending(from.id);
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

  console.log(`[InfinityBot] Grupo Infinity: ${INFINITY_GROUP_ID}`);

  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  process.once("SIGINT",  () => bot.stop("SIGINT"));

  console.log("[InfinityBot] Bot iniciado com sucesso ✅");
  console.log(`[InfinityBot] Canal: ${CHANNEL_USERNAME}`);
  console.log(`[InfinityBot] Painel: ${PANEL_URL}`);
}
