import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { BOT_TOKEN, API_BASE, PANEL_URL } from "./config.js";

if (!BOT_TOKEN) {
  console.error("❌ INFINITY_BOT_TOKEN não configurado.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ─── Plans ────────────────────────────────────────────────────────────────────
interface Plan { id: string; label: string; days: number; amountBrl: string; highlight?: boolean }
const PLANS: Plan[] = [
  { id: "1d",  label: "1 Dia",   days: 1,  amountBrl: "15,00" },
  { id: "7d",  label: "7 Dias",  days: 7,  amountBrl: "40,00" },
  { id: "14d", label: "14 Dias", days: 14, amountBrl: "70,00", highlight: true },
  { id: "30d", label: "30 Dias", days: 30, amountBrl: "100,00" },
];

// ─── Session ──────────────────────────────────────────────────────────────────
type FlowStep =
  | "plan"
  | "flow"
  | "username_new" | "password_new"
  | "username_ex"  | "password_ex" | "pin_ex"
  | "paying";

interface Session {
  step?:      FlowStep;
  planId?:    string;
  username?:  string;
  password?:  string;
  tempToken?: string;
  authToken?: string;
  paymentId?: string;
  pixCode?:   string;
  pollTimer?: ReturnType<typeof setInterval>;
  promptMsgId?: number;
}

const sessions = new Map<number, Session>();
function getSession(id: number): Session {
  if (!sessions.has(id)) sessions.set(id, {});
  return sessions.get(id)!;
}
function clearSession(id: number): void {
  const s = sessions.get(id);
  if (s?.pollTimer) clearInterval(s.pollTimer);
  sessions.set(id, {});
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const H = "╔══════ ⚔ HYDRA CONSULTORIA ⚔ ══════╗";
const F = "╚═══════════════════════════════════════╝";
const D = "╠───────────────────────────────────────╣";

function esc(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function apiPost(path: string, body: object, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json() as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data: json };
}

async function apiGet(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const json = await res.json() as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data: json };
}

// ─── UI builders ──────────────────────────────────────────────────────────────
function welcomeMsg(name: string): string {
  return [
    H,
    `║  Olá, <b>${esc(name)}</b>! 👋`,
    D,
    `║  Adquira ou renove seu acesso à`,
    `║  plataforma Hydra Consultoria.`,
    `║`,
    `║  🔒 Acesso completo a +24 consultas`,
    `║  ⚡ Ativação automática após pagamento`,
    `║  💳 Pagamento via PIX — instantâneo`,
    F,
  ].join("\n");
}

function plansMsg(): string {
  const planLines = PLANS.map(p =>
    `║  ${p.highlight ? "⭐" : "▸"} ${p.label.padEnd(8)} — R$ ${p.amountBrl}${p.highlight ? " 🔥" : ""}`
  );
  return [
    H,
    `║  📦 PLANOS DISPONÍVEIS`,
    D,
    ...planLines,
    D,
    `║  Selecione um plano abaixo:`,
    F,
  ].join("\n");
}

function plansKeyboard() {
  return Markup.inlineKeyboard([
    PLANS.slice(0, 2).map(p => Markup.button.callback(`${p.label} — R$${p.amountBrl}`, `plan:${p.id}`)),
    PLANS.slice(2, 4).map(p => Markup.button.callback(`${p.label} — R$${p.amountBrl}${p.highlight ? " 🔥" : ""}`, `plan:${p.id}`)),
    [Markup.button.callback("🔙 Voltar", "start")],
  ]);
}

function flowKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Sim, já tenho conta", "flow:existing")],
    [Markup.button.callback("🆕 Não, quero criar agora", "flow:new")],
    [Markup.button.callback("🔙 Voltar", "show_plans")],
  ]);
}

function pixMsg(plan: Plan, pixCode: string, paymentId: string): string {
  return [
    H,
    `║  💳 PAGAMENTO VIA PIX`,
    D,
    `║  Plano: <b>${plan.label}</b>`,
    `║  Valor: <b>R$ ${plan.amountBrl}</b>`,
    D,
    `║  1. Copie o código Pix abaixo`,
    `║  2. Abra seu banco e cole o código`,
    `║  3. Confirme o pagamento`,
    D,
    `║  ⏳ Aguardando confirmação...`,
    `║  (expira em 60 minutos)`,
    F,
    ``,
    `<code>${esc(pixCode)}</code>`,
  ].join("\n");
}

function pixKeyboard(pixCode: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 Copiar Código PIX", `copy:${pixCode.slice(0, 60)}`)],
    [Markup.button.callback("🔄 Verificar Pagamento", "check_payment")],
    [Markup.button.url("🔙 Acessar Painel", PANEL_URL)],
  ]);
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start(async ctx => {
  clearSession(ctx.from.id);
  await ctx.replyWithHTML(
    welcomeMsg(ctx.from.first_name ?? "Operador"),
    Markup.inlineKeyboard([[Markup.button.callback("📦 Ver Planos", "show_plans")]]),
  );
});

bot.action("start", async ctx => {
  await ctx.answerCbQuery();
  clearSession(ctx.from!.id);
  await ctx.editMessageText(
    welcomeMsg(ctx.from!.first_name ?? "Operador"),
    { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("📦 Ver Planos", "show_plans")]]) },
  );
});

// ─── Show plans ───────────────────────────────────────────────────────────────
bot.action("show_plans", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.step = "plan";
  await ctx.editMessageText(plansMsg(), { parse_mode: "HTML", ...plansKeyboard() }).catch(() =>
    ctx.replyWithHTML(plansMsg(), plansKeyboard()),
  );
});

// ─── Select plan ──────────────────────────────────────────────────────────────
bot.action(/^plan:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const planId = ctx.match[1];
  const plan = PLANS.find(p => p.id === planId);
  if (!plan) return;

  const s = getSession(ctx.from!.id);
  s.planId = planId;
  s.step = "flow";

  const text = [
    H,
    `║  Plano selecionado: <b>${plan.label} — R$ ${plan.amountBrl}</b>`,
    D,
    `║  Você já tem uma conta na Hydra?`,
    F,
  ].join("\n");

  await ctx.editMessageText(text, { parse_mode: "HTML", ...flowKeyboard() }).catch(() =>
    ctx.replyWithHTML(text, flowKeyboard()),
  );
});

// ─── Flow: new user ───────────────────────────────────────────────────────────
bot.action("flow:new", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.step = "username_new";

  const msg = await ctx.replyWithHTML([
    H,
    `║  👤 CRIAR CONTA`,
    D,
    `║  Digite o <b>usuário</b> que deseja criar:`,
    `║  (apenas letras, números e _)`,
    F,
  ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "show_plans")]]));
  s.promptMsgId = msg.message_id;
});

// ─── Flow: existing user ──────────────────────────────────────────────────────
bot.action("flow:existing", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.step = "username_ex";

  const msg = await ctx.replyWithHTML([
    H,
    `║  🔑 ENTRAR NA CONTA`,
    D,
    `║  Digite seu <b>usuário</b>:`,
    F,
  ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "show_plans")]]));
  s.promptMsgId = msg.message_id;
});

// ─── Check payment manually ───────────────────────────────────────────────────
bot.action("check_payment", async ctx => {
  await ctx.answerCbQuery("Verificando...");
  const s = getSession(ctx.from!.id);
  if (!s.paymentId) return;
  const { data } = await apiGet(`/api/infinity/payments/${s.paymentId}/status`);
  if ((data as Record<string, unknown>).status === "paid") {
    await handlePaymentSuccess(ctx.chat!.id, ctx.from!.first_name ?? "Operador", s);
  } else {
    await ctx.answerCbQuery("⏳ Pagamento ainda não confirmado. Aguarde...", { show_alert: true });
  }
});

bot.action(/^copy:/, async ctx => {
  await ctx.answerCbQuery("Código copiado! Cole no app do seu banco.", { show_alert: true });
});

// ─── Text message handler (state machine) ─────────────────────────────────────
bot.on(message("text"), async ctx => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const text   = ctx.message.text.trim();
  const s      = getSession(userId);

  if (!s.step || s.step === "plan" || s.step === "flow") return;

  // Delete user input for privacy (passwords/pins)
  if (s.step === "password_new" || s.step === "password_ex" || s.step === "pin_ex") {
    await ctx.deleteMessage().catch(() => {});
  }

  // ── New user: collect username ──
  if (s.step === "username_new") {
    const username = text.toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      await ctx.replyWithHTML("❌ Usuário inválido. Use apenas letras, números e _ (3-30 caracteres).");
      return;
    }
    s.username = username;
    s.step = "password_new";
    const msg = await ctx.replyWithHTML([
      H,
      `║  👤 Usuário: <code>${esc(username)}</code>`,
      D,
      `║  Agora digite a <b>senha</b> desejada:`,
      `║  (mínimo 6 caracteres)`,
      F,
    ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "show_plans")]]));
    s.promptMsgId = msg.message_id;
    return;
  }

  // ── New user: collect password → create payment ──
  if (s.step === "password_new") {
    if (text.length < 6) {
      await ctx.replyWithHTML("❌ Senha muito curta. Mínimo 6 caracteres.");
      return;
    }
    s.password = text;
    s.step = "paying";

    const loadMsg = await ctx.replyWithHTML([
      H, `║  ⏳ Gerando seu PIX...`, F,
    ].join("\n"));

    try {
      const { ok, data } = await apiPost("/api/infinity/payments/create-guest", {
        planId: s.planId,
        username: s.username,
        password: s.password,
      });

      if (!ok) {
        const err = (data.error as string) ?? "Erro desconhecido";
        await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
          `❌ <b>Erro:</b> ${esc(err)}\n\nUse /start para tentar novamente.`, { parse_mode: "HTML" });
        clearSession(userId);
        return;
      }

      await deliverPix(ctx.telegram, chatId, loadMsg.message_id, userId, s, data);
    } catch {
      await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        "❌ Falha ao conectar com o servidor. Tente novamente.", { parse_mode: "HTML" });
      clearSession(userId);
    }
    return;
  }

  // ── Existing user: collect username ──
  if (s.step === "username_ex") {
    s.username = text.toLowerCase();
    s.step = "password_ex";
    const msg = await ctx.replyWithHTML([
      H,
      `║  👤 Usuário: <code>${esc(s.username)}</code>`,
      D,
      `║  Digite sua <b>senha</b>:`,
      F,
    ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "show_plans")]]));
    s.promptMsgId = msg.message_id;
    return;
  }

  // ── Existing user: collect password → login ──
  if (s.step === "password_ex") {
    s.password = text;
    s.step = "pin_ex";

    const loadMsg = await ctx.replyWithHTML([H, `║  🔑 Autenticando...`, F].join("\n"));

    try {
      const { ok, data } = await apiPost("/api/infinity/login", {
        username: s.username,
        password: s.password,
      });

      if (!ok) {
        await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
          "❌ Usuário ou senha incorretos. Use /start para tentar novamente.", { parse_mode: "HTML" });
        clearSession(userId);
        return;
      }

      if (data.step === "verify-pin" || data.step === "setup-pin") {
        s.tempToken = data.tempToken as string;
        s.step = "pin_ex";
        await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined, [
          H,
          `║  🔐 Digite seu <b>PIN de segurança</b>:`,
          F,
        ].join("\n"), { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Cancelar", "show_plans")]]) });
      } else if (data.token) {
        s.authToken = data.token as string;
        s.step = "paying";
        await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
          [H, `║  ⏳ Gerando seu PIX...`, F].join("\n"), { parse_mode: "HTML" });
        await createAndDeliverPix(ctx.telegram, chatId, loadMsg.message_id, userId, s);
      }
    } catch {
      await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        "❌ Falha ao conectar. Tente novamente com /start.", { parse_mode: "HTML" });
      clearSession(userId);
    }
    return;
  }

  // ── Existing user: collect PIN ──
  if (s.step === "pin_ex") {
    const loadMsg = await ctx.replyWithHTML([H, `║  ⏳ Verificando PIN...`, F].join("\n"));

    try {
      const { ok, data } = await apiPost("/api/infinity/verify-pin", {
        tempToken: s.tempToken,
        pin: text,
      });

      if (!ok || !data.token) {
        await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
          "❌ PIN incorreto. Use /start para tentar novamente.", { parse_mode: "HTML" });
        clearSession(userId);
        return;
      }

      s.authToken = data.token as string;
      s.step = "paying";
      await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        [H, `║  ⏳ Gerando seu PIX...`, F].join("\n"), { parse_mode: "HTML" });
      await createAndDeliverPix(ctx.telegram, chatId, loadMsg.message_id, userId, s);
    } catch {
      await ctx.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        "❌ Falha ao verificar PIN. Tente novamente com /start.", { parse_mode: "HTML" });
      clearSession(userId);
    }
    return;
  }
});

// ─── Create payment for existing users ────────────────────────────────────────
async function createAndDeliverPix(
  telegram: Telegraf["telegram"],
  chatId: number,
  msgId: number,
  userId: number,
  s: Session,
) {
  try {
    const { ok, data } = await apiPost("/api/infinity/payments/create", { planId: s.planId }, s.authToken);
    if (!ok) {
      const err = (data.error as string) ?? "Erro desconhecido";
      await telegram.editMessageText(chatId, msgId, undefined,
        `❌ <b>Erro:</b> ${esc(err)}\n\nUse /start para tentar novamente.`, { parse_mode: "HTML" });
      clearSession(userId);
      return;
    }
    await deliverPix(telegram, chatId, msgId, userId, s, data);
  } catch {
    await telegram.editMessageText(chatId, msgId, undefined,
      "❌ Falha ao gerar PIX. Tente novamente com /start.", { parse_mode: "HTML" });
    clearSession(userId);
  }
}

// ─── Deliver PIX (QR + code + poll) ──────────────────────────────────────────
async function deliverPix(
  telegram: Telegraf["telegram"],
  chatId: number,
  loadMsgId: number,
  userId: number,
  s: Session,
  data: Record<string, unknown>,
) {
  const plan   = PLANS.find(p => p.id === s.planId)!;
  const pixCode    = data.pixCopiaECola as string;
  const qrBase64   = data.qrcode_base64 as string | undefined;
  const paymentId  = data.paymentId as string;

  s.paymentId = paymentId;
  s.pixCode   = pixCode;

  // Delete loading message
  await telegram.deleteMessage(chatId, loadMsgId).catch(() => {});

  // Send QR code image if available
  if (qrBase64) {
    const imgBuf = Buffer.from(qrBase64, "base64");
    await telegram.sendPhoto(chatId, { source: imgBuf, filename: "qrcode.png" }, {
      caption: `📱 Escaneie o QR Code acima com seu app bancário`,
    }).catch(() => {});
  }

  // Send PIX message
  await telegram.sendMessage(chatId, pixMsg(plan, pixCode, paymentId), {
    parse_mode: "HTML",
    ...pixKeyboard(pixCode),
  });

  // Start polling
  startPolling(telegram, chatId, userId, s);
}

// ─── Payment polling ──────────────────────────────────────────────────────────
function startPolling(telegram: Telegraf["telegram"], chatId: number, userId: number, s: Session) {
  if (s.pollTimer) clearInterval(s.pollTimer);

  const TIMEOUT = 10 * 60 * 1000;
  const startedAt = Date.now();

  s.pollTimer = setInterval(async () => {
    if (!s.paymentId) { clearInterval(s.pollTimer!); return; }

    if (Date.now() - startedAt > TIMEOUT) {
      clearInterval(s.pollTimer!);
      await telegram.sendMessage(chatId, [
        "⏰ <b>Tempo de pagamento expirado.</b>",
        "Use /start para gerar um novo PIX.",
      ].join("\n"), { parse_mode: "HTML" }).catch(() => {});
      clearSession(userId);
      return;
    }

    try {
      const res  = await fetch(`${API_BASE}/api/infinity/payments/${s.paymentId}/status`);
      const data = await res.json() as { status: string };
      if (data.status === "paid") {
        clearInterval(s.pollTimer!);
        await handlePaymentSuccess(chatId, undefined, s, telegram);
        clearSession(userId);
      }
    } catch { /* ignore — retry next tick */ }
  }, 5000);
}

async function handlePaymentSuccess(
  chatId: number,
  firstName?: string,
  s?: Session,
  telegram?: Telegraf["telegram"],
) {
  const tg = telegram ?? bot.telegram;
  await tg.sendMessage(chatId, [
    H,
    `║  ✅ PAGAMENTO CONFIRMADO!`,
    D,
    firstName ? `║  Parabéns, <b>${esc(firstName)}</b>! 🎉` : `║  Acesso ativado com sucesso! 🎉`,
    `║`,
    `║  Seu acesso está ativo agora.`,
    `║  Acesse o painel para começar:`,
    F,
  ].join("\n"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.url("🚀 Acessar Painel Hydra", PANEL_URL)]]),
  }).catch(() => {});
}

// ─── Launch ───────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log("✅ Bot de pagamentos rodando."));

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
