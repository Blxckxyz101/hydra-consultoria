import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";

const INFINITY_BOT_TOKEN = process.env.INFINITY_BOT_TOKEN ?? "";
const GEASS_API_BASE = "http://149.56.18.68:25584/api/consulta";
const GEASS_API_KEY = process.env.GEASS_API_KEY ?? "GeassZero";
const SUPPORT_URL = "https://t.me/Blxckxyz";
const SUPPORT_URL2 = "https://t.me/xxmathexx";
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
  { id: "cpf",         label: "🪪 CPF",           prompt: "CPF (11 dígitos, só números)" },
  { id: "nome",        label: "👤 Nome",           prompt: "nome completo da pessoa" },
  { id: "telefone",    label: "📞 Telefone",       prompt: "telefone com DDD (ex: 11999887766)" },
  { id: "email",       label: "📧 E-mail",         prompt: "endereço de e-mail" },
  { id: "placa",       label: "🚗 Placa",          prompt: "placa do veículo (ex: ABC1D23)" },
  { id: "cnpj",        label: "🏭 CNPJ",           prompt: "CNPJ (14 dígitos, só números)" },
  { id: "cep",         label: "📍 CEP",            prompt: "CEP (8 dígitos, só números)" },
  { id: "pix",         label: "💳 PIX",            prompt: "chave PIX (CPF, e-mail, telefone ou aleatória)" },
  { id: "rg",          label: "🪪 RG",             prompt: "número do RG" },
  { id: "mae",         label: "👩 Mãe",            prompt: "CPF ou nome da mãe" },
  { id: "pai",         label: "👨 Pai",            prompt: "CPF ou nome do pai" },
  { id: "parentes",    label: "👨‍👩‍👧 Parentes",    prompt: "CPF da pessoa" },
  { id: "chassi",      label: "🔩 Chassi",         prompt: "número do chassi" },
  { id: "renavam",     label: "📄 Renavam",        prompt: "número do Renavam" },
  { id: "cnh",         label: "🪪 CNH",            prompt: "número da CNH ou CPF" },
  { id: "socios",      label: "🤝 Sócios",         prompt: "CNPJ da empresa" },
  { id: "fucionarios", label: "👷 Funcionários",   prompt: "CNPJ da empresa" },
  { id: "empregos",    label: "💼 Empregos",       prompt: "CPF da pessoa" },
  { id: "cns",         label: "🏥 CNS",            prompt: "número do Cartão Nacional de Saúde" },
  { id: "nis",         label: "💰 NIS/PIS",        prompt: "número do NIS ou PIS" },
  { id: "obito",       label: "🕊️ Óbito",         prompt: "CPF da pessoa" },
  { id: "vacinas",     label: "💉 Vacinas",        prompt: "CPF da pessoa" },
] as const;

type TipoId = (typeof TIPOS)[number]["id"];

// ── Session ───────────────────────────────────────────────────────────────────
interface BotSession {
  state: "idle" | "awaiting_query";
  tipo?: string;
}
const sessions = new Map<number, BotSession>();
function getSession(userId: number): BotSession {
  if (!sessions.has(userId)) sessions.set(userId, { state: "idle" });
  return sessions.get(userId)!;
}
function resetSession(userId: number) {
  sessions.set(userId, { state: "idle" });
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
  lines.push(LINE);
  return lines.join("\n");
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function buildHomeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍  Nova Consulta", "consultar")],
    [Markup.button.callback("❓ Ajuda", "show_ajuda")],
    [Markup.button.url("💬 Suporte: @Blxckxyz & @xxmathexx", SUPPORT_URL)] as any,
  ]);
}

function buildTiposKeyboard() {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const arr = [...TIPOS];
  for (let i = 0; i < arr.length; i += 2) {
    rows.push([
      Markup.button.callback(arr[i].label, `tipo:${arr[i].id}`),
      ...(arr[i + 1] ? [Markup.button.callback(arr[i + 1].label, `tipo:${arr[i + 1].id}`)] : []),
    ]);
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

// ── Bot factory ───────────────────────────────────────────────────────────────
export function startInfinityBot(): void {
  if (!INFINITY_BOT_TOKEN) {
    console.log("[InfinityBot] INFINITY_BOT_TOKEN não configurado — bot não iniciado.");
    return;
  }

  const bot = new Telegraf(INFINITY_BOT_TOKEN);

  // ── Register commands ──────────────────────────────────────────────────────
  void bot.telegram.setMyCommands([
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
    { command: "ajuda",     description: "❓ Lista de tipos disponíveis" },
  ]).catch(() => {});

  function buildHomeText(from: { username?: string; first_name?: string; id: number }): string {
    const name = from.username ? `@${from.username}` : (from.first_name || "usuário");
    const admin = isAdmin(from.id, from.username);
    const cargo = admin ? "admin" : "membro";
    return (
      `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
      `┃\n` +
      `┃ • OLÁ, <b>${name}</b>!\n` +
      `┠────────────────────────────\n` +
      `┃ • CARGO: <code>${cargo}</code>\n` +
      `┃ • STATUS: ✅ ativo\n` +
      `┃ • PLANO: <code>free</code>\n` +
      `┠────────────────────────────\n` +
      `┃  SELECIONE UMA OPÇÃO ABAIXO 👇🏻\n` +
      `╰────────────────────────────╯`
    );
  }

  const TIPO_MENU_TEXT =
    `╭──── ᯽ <b>INFINITY SEARCH</b> ᯽ ───────╮\n` +
    `┃\n` +
    `┃ ESCOLHA O MÓDULO DE CONSULTA\n` +
    `┃ QUE DESEJA UTILIZAR\n` +
    `┠────────────────────────────\n` +
    `┃  SELECIONE UMA OPÇÃO ABAIXO 👇🏻\n` +
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
    ].join("\n"));
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    resetSession(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(buildHomeText(ctx.from), buildHomeKeyboard());
  });

  // ── /consultar ───────────────────────────────────────────────────────────
  bot.command("consultar", async (ctx) => {
    resetSession(ctx.from.id);
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML(TIPO_MENU_TEXT, buildTiposKeyboard());
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
          `${tipo.label}\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\nEnvie o <b>${tipo.prompt}</b>:`,
          Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "home_new")]]),
        );
      }
    });
  }

  // ── /ajuda ────────────────────────────────────────────────────────────────
  bot.command("ajuda", async (ctx) => {
    try { await ctx.deleteMessage(); } catch {}
    await ctx.replyWithHTML([
      `❓ <b>INFINITY SEARCH — AJUDA</b>`,
      `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`,
      ``,
      `<b>Comandos rápidos (com ou sem dado):</b>`,
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
      `/consultar — abre o seletor com todos os tipos`,
      ``,
      `<b>Acesso:</b>`,
      `Membros do canal oficial têm acesso automático.`,
      `Grupos precisam ser liberados por um admin.`,
      ``,
      `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`,
      `<i>Resultados entregues em arquivo .txt formatado</i>`,
    ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Consultar Agora", "consultar")],
        [Markup.button.url("💬 Suporte", SUPPORT_URL)] as any,
      ]),
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

  // ── Callback: tipo selection ───────────────────────────────────────────────
  bot.action(/^tipo:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const tipoId = ctx.match[1];
    const tipo = TIPOS.find((t) => t.id === tipoId);
    if (!tipo) return;
    const session = getSession(ctx.from.id);
    session.state = "awaiting_query";
    session.tipo = tipoId;
    await ctx.editMessageText(
      `${tipo.label}\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\nEnvie o <b>${tipo.prompt}</b>:`,
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

  // ── Text handler — only active during awaiting_query flow ────────────────
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
    resetSession(ctx.from.id);

    try { await ctx.deleteMessage(); } catch {}

    const tipoObj = TIPOS.find((t) => t.id === tipo);
    const loadMsg = await ctx.replyWithHTML(
      `⏳ <b>Consultando ${tipoObj?.label ?? tipo.toUpperCase()}...</b>\n<code>${dados}</code>`
    );

    await executeQuery(ctx, tipo, dados, loadMsg.message_id);
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
