import { Telegraf, Markup, type Context } from "telegraf";
import { message } from "telegraf/filters";
import { BOT_TOKEN, API_BASE, CHECKER_TARGETS, MINIAPP_URL } from "./config.js";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN não configurado.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session {
  credentials?: string[];
  activeJobId?: string;
  hits:         string[];
  fails:        string[];
  errors:       string[];
  running:      boolean;
  progressMsgId?: number;
  progressChatId?: number;
  abortCtrl?:   AbortController;
  waitingFor?:  "file" | "domain" | null;
}

const sessions = new Map<number, Session>();
function getSession(userId: number): Session {
  if (!sessions.has(userId)) {
    sessions.set(userId, { hits: [], fails: [], errors: [], running: false });
  }
  return sessions.get(userId)!;
}

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Lelouch Theme ─────────────────────────────────────────────────────────────
const LINE  = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
const LINE2 = "──────────────────────────────";
const GEASS = "👁";
const SWORD = "⚔️";

function buildBar(pct: number, size = 12): string {
  const filled = Math.round((pct / 100) * size);
  return `<code>[${"█".repeat(filled)}${"░".repeat(size - filled)}]</code>`;
}

// ── Home screen ───────────────────────────────────────────────────────────────
function homeMsg(name: string): string {
  return [
    `${LINE}`,
    `${GEASS} <b>GEASS COMMAND CENTER</b> ${GEASS}`,
    `<i>All hail Lelouch vi Britannia</i>`,
    `${LINE}`,
    ``,
    `Bem-vindo, <b>${esc(name)}</b>.`,
    `O poder do Geass responde às suas ordens.`,
    ``,
    `${LINE2}`,
    `${SWORD} Escolha sua operação abaixo.`,
  ].join("\n");
}

function homeKeyboard() {
  const rows = [
    [
      Markup.button.callback(`${SWORD} Checar Credenciais`, "home_checker"),
      Markup.button.callback("🔍 Buscar Domínio",     "home_url"),
    ],
    [
      Markup.button.callback("📊 Estatísticas DB",   "home_stats"),
      Markup.button.callback("🎯 Ver HITs",           "home_hits"),
    ],
  ];
  if (MINIAPP_URL) {
    rows.push([Markup.button.webApp("📲 Abrir Painel Geass", MINIAPP_URL)]);
  }
  return Markup.inlineKeyboard(rows);
}

// ── Progress message ──────────────────────────────────────────────────────────
function buildProgress(
  label: string,
  total: number,
  done: number,
  hits: string[],
  fails: string[],
  errors: string[],
): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = buildBar(pct);
  const lines = [
    `${LINE}`,
    `${GEASS} <b>OPERAÇÃO EM CURSO</b> ${GEASS}`,
    `<b>Alvo:</b> <code>${esc(label.toUpperCase())}</code>`,
    `${LINE2}`,
    ``,
    `${bar} <b>${pct}%</b>`,
    `<code>${done.toLocaleString("pt-BR")} / ${total.toLocaleString("pt-BR")}</code> verificados`,
    ``,
    `✅ <b>HITs</b>:    <code>${hits.length}</code>`,
    `❌ <b>FAILs</b>:   <code>${fails.length}</code>`,
    `⚡ <b>Erros</b>:   <code>${errors.length}</code>`,
  ];
  if (hits.length > 0) {
    lines.push(``, `<b>🎯 Últimos HITs:</b>`);
    hits.slice(-3).forEach(h => lines.push(`  <code>${esc(h.split(" | ")[0] ?? h)}</code>`));
  }
  lines.push(`${LINE}`);
  return lines.join("\n");
}

// ── Final report ──────────────────────────────────────────────────────────────
function buildFinal(
  label: string,
  total: number,
  hits: string[],
  fails: string[],
  errors: string[],
  stopped = false,
): string {
  const hitRate = total > 0 ? ((hits.length / total) * 100).toFixed(1) : "0.0";
  const lines = [
    `${LINE}`,
    stopped
      ? `🛑 <b>GEASS SUSPENSO — ${esc(label.toUpperCase())}</b>`
      : `✅ <b>GEASS CONCLUÍDO — ${esc(label.toUpperCase())}</b>`,
    `${LINE2}`,
    ``,
    `📊 Total: <b>${total}</b>  |  Taxa HIT: <b>${hitRate}%</b>`,
    ``,
    `✅ HITs:   <b>${hits.length}</b>`,
    `❌ FAILs:  <b>${fails.length}</b>`,
    `⚡ Erros:  <b>${errors.length}</b>`,
  ];
  if (hits.length > 0) {
    lines.push(``, `<b>🎯 Primeiros HITs:</b>`);
    hits.slice(0, 5).forEach(h => lines.push(`  <code>${esc(h)}</code>`));
  }
  lines.push(``, `${LINE}`, `<i>Use os botões abaixo para ver os resultados completos.</i>`);
  return lines.join("\n");
}

// ── Edit helper ───────────────────────────────────────────────────────────────
async function editMsg(
  ctx: Context,
  chatId: number,
  msgId: number,
  text: string,
  extra?: Parameters<typeof ctx.telegram.editMessageText>[4],
) {
  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined, text, {
      parse_mode: "HTML",
      ...extra,
    });
  } catch { /* ignore edit conflicts */ }
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async ctx => {
  const name = ctx.from?.first_name ?? "Operador";
  await ctx.replyWithHTML(homeMsg(name), homeKeyboard());
});

bot.command("home", async ctx => {
  const name = ctx.from?.first_name ?? "Operador";
  await ctx.replyWithHTML(homeMsg(name), homeKeyboard());
});

bot.command("help", async ctx => {
  await ctx.replyWithHTML([
    `${LINE}`,
    `${GEASS} <b>ORDENS DO GEASS</b>`,
    `${LINE2}`,
    ``,
    `/start    — Painel de comando`,
    `/checker  — Iniciar checker (envie um arquivo)`,
    `/url &lt;domínio&gt; — Buscar no DB e checar`,
    `/import   — Importar credenciais para o DB`,
    `/stats    — Estatísticas do banco`,
    `/hits     — Ver HITs da última sessão`,
    `/fails    — Ver FAILs da última sessão`,
    `/errors   — Ver Erros da última sessão`,
    `/stop     — Parar checker ativo`,
    ``,
    `${LINE}`,
  ].join("\n"));
});

// ── /stats ────────────────────────────────────────────────────────────────────
bot.command("stats", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.running) {
    await ctx.replyWithHTML(
      `${LINE}\n${GEASS} <b>DB STATS</b>\n${LINE2}\n\n<i>Checker ativo — aguarde ou /stop</i>`,
    );
    return;
  }
  await showStats(ctx);
});

bot.action("home_stats", async ctx => {
  await ctx.answerCbQuery();
  await showStats(ctx);
});

async function showStats(ctx: Context) {
  try {
    const r    = await fetch(`${API_BASE}/api/credentials/stats`);
    const data = await r.json() as { total: number; topDomains: { domain: string; count: number }[] };
    const domains = data.topDomains.slice(0, 8)
      .map((d, i) => `  ${i + 1}. <code>${esc(d.domain)}</code> — <b>${d.count}</b>`)
      .join("\n");
    await ctx.replyWithHTML([
      `${LINE}`,
      `${GEASS} <b>BANCO DE CREDENCIAIS</b>`,
      `${LINE2}`,
      ``,
      `📦 Total: <b>${data.total.toLocaleString("pt-BR")}</b> credenciais`,
      ``,
      `<b>Top Domínios:</b>`,
      domains || `  <i>Nenhum ainda</i>`,
      ``,
      `${LINE}`,
    ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
  } catch (e) {
    await ctx.reply(`❌ Erro: ${String(e)}`);
  }
}

// ── /hits, /fails, /errors ────────────────────────────────────────────────────
bot.command("hits", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.hits.length === 0) { await ctx.reply("Nenhum HIT na última sessão."); return; }
  const text = s.hits.slice(0, 50).map(h => `✅ ${h}`).join("\n");
  await ctx.replyWithHTML(
    `${LINE}\n✅ <b>HITs (${s.hits.length})</b>\n${LINE2}\n\n<code>${esc(text)}</code>`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
});

bot.action("home_hits", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  if (s.hits.length === 0) {
    await ctx.replyWithHTML(
      `${LINE}\n✅ <b>HITs</b>\n${LINE2}\n\n<i>Nenhum HIT ainda nesta sessão.</i>`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }
  const text = s.hits.slice(0, 50).map(h => `✅ ${h}`).join("\n");
  await ctx.replyWithHTML(
    `${LINE}\n✅ <b>HITs (${s.hits.length})</b>\n${LINE2}\n\n<code>${esc(text)}</code>`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
});

bot.command("fails", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.fails.length === 0) { await ctx.reply("Nenhum FAIL na última sessão."); return; }
  const text = s.fails.slice(0, 50).map(h => `❌ ${h}`).join("\n");
  await ctx.replyWithHTML(`${LINE}\n❌ <b>FAILs (${s.fails.length})</b>\n${LINE2}\n\n<code>${esc(text)}</code>`);
});

bot.command("errors", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.errors.length === 0) { await ctx.reply("Nenhum erro na última sessão."); return; }
  const text = s.errors.slice(0, 50).map(h => `⚡ ${h}`).join("\n");
  await ctx.replyWithHTML(
    `${LINE}\n⚡ <b>Erros (${s.errors.length})</b>\n${LINE2}\n\n<code>${esc(text)}</code>`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
});

// ── /stop ─────────────────────────────────────────────────────────────────────
bot.command("stop", async ctx => {
  const s = getSession(ctx.from!.id);
  if (!s.running) { await ctx.reply("Nenhum checker ativo."); return; }
  await stopChecker(ctx, s, true);
});

bot.action("stop_checker", async ctx => {
  await ctx.answerCbQuery("🛑 Parando...");
  const s = getSession(ctx.from!.id);
  if (!s.running) return;
  await stopChecker(ctx, s, true);
});

async function stopChecker(ctx: Context, s: Session, byUser = false) {
  s.abortCtrl?.abort("user_stop");
  s.running = false;
  if (s.activeJobId) {
    await fetch(`${API_BASE}/api/checker/${s.activeJobId}`, { method: "DELETE" }).catch(() => {});
  }
  if (s.progressChatId && s.progressMsgId) {
    const text = buildFinal("checker", s.hits.length + s.fails.length + s.errors.length, s.hits, s.fails, s.errors, byUser);
    await editMsg(ctx, s.progressChatId, s.progressMsgId, text,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Ver HITs",  "home_hits"),  Markup.button.callback("📊 Stats", "home_stats")],
        [Markup.button.callback("🏠 Início",    "go_home")],
      ]),
    );
  }
}

// ── /import ───────────────────────────────────────────────────────────────────
bot.command("import", async ctx => {
  const s = getSession(ctx.from!.id);
  s.waitingFor = "file";
  await ctx.replyWithHTML(
    `${LINE}\n💾 <b>IMPORTAR CREDENCIAIS</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b> com credenciais\n(<code>login:senha</code> por linha).`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

// ── /checker ─────────────────────────────────────────────────────────────────
bot.command("checker", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.running) {
    await ctx.reply("⚠️ Já existe um checker ativo. Use /stop primeiro.");
    return;
  }
  if (s.credentials?.length) {
    await showTargetMenu(ctx, s.credentials.length);
  } else {
    s.waitingFor = "file";
    await ctx.replyWithHTML(
      `${LINE}\n${SWORD} <b>GEASS CHECKER</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b> com credenciais\n(<code>login:senha</code> por linha).`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
  }
});

// ── /url ─────────────────────────────────────────────────────────────────────
bot.command("url", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (!args[0]) {
    await ctx.reply("Uso: /url <domínio>  (ex: /url github.com)");
    return;
  }
  await searchAndOffer(ctx, args[0]);
});

bot.action("home_url", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.waitingFor = "domain";
  await ctx.replyWithHTML(
    `${LINE}\n🔍 <b>BUSCAR DOMÍNIO</b>\n${LINE2}\n\nEnvie o domínio para buscar no banco:\n<i>ex: github.com, netflix.com</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

async function searchAndOffer(ctx: Context, domain: string) {
  const waitMsg = await ctx.replyWithHTML(
    `${LINE}\n🔍 <b>BUSCANDO</b> <code>${esc(domain)}</code>...\n${LINE}`,
  );
  try {
    const r    = await fetch(`${API_BASE}/api/credentials/search?domain=${encodeURIComponent(domain)}&limit=500`);
    const data = await r.json() as { count: number; credentials: { login: string; password: string }[] };
    if (data.count === 0) {
      await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id,
        `${LINE}\n🔍 <b>BUSCA — ${esc(domain)}</b>\n${LINE2}\n\n<i>Nenhuma credencial encontrada no banco.</i>\n\n${LINE}`,
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
      );
      return;
    }
    const creds = data.credentials.map(c => `${c.login}:${c.password}`);
    const s = getSession(ctx.from!.id);
    s.credentials = creds;
    await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id,
      `${LINE}\n🔍 <b>${esc(domain.toUpperCase())}</b>\n${LINE2}\n\n✅ <b>${data.count}</b> credenciais encontradas!\n\n${LINE}`,
    );
    await showTargetMenu(ctx, creds.length, domain);
  } catch (e) {
    await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id, `❌ Erro: ${String(e)}`);
  }
}

// ── Target menu ───────────────────────────────────────────────────────────────
async function showTargetMenu(ctx: Context, count: number, domain?: string) {
  const cats: Record<string, { id: string; label: string }[]> = {};
  CHECKER_TARGETS.forEach(t => { (cats[t.cat] ??= []).push({ id: t.id, label: t.label }); });

  const rows = Object.entries(cats).map(([, targets]) =>
    targets.map(t => Markup.button.callback(t.label, `target_${t.id}`)),
  );
  rows.push([Markup.button.callback("↩ Cancelar", "go_home")]);

  await ctx.replyWithHTML(
    [
      `${LINE}`,
      `${SWORD} <b>ESCOLHA O ALVO</b>`,
      `${LINE2}`,
      ``,
      domain ? `🔍 Domínio: <code>${esc(domain)}</code>` : "",
      `📋 <b>${count}</b> credenciais prontas`,
      ``,
      `${LINE}`,
    ].filter(Boolean).join("\n"),
    Markup.inlineKeyboard(rows),
  );
}

// ── Home callback ─────────────────────────────────────────────────────────────
bot.action("go_home", async ctx => {
  await ctx.answerCbQuery();
  const name = ctx.from?.first_name ?? "Operador";
  await ctx.replyWithHTML(homeMsg(name), homeKeyboard());
});

bot.action("home_checker", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  if (s.running) {
    await ctx.replyWithHTML("⚠️ Já existe um checker ativo. Use /stop primeiro.");
    return;
  }
  if (s.credentials?.length) {
    await showTargetMenu(ctx, s.credentials.length);
  } else {
    s.waitingFor = "file";
    await ctx.replyWithHTML(
      `${LINE}\n${SWORD} <b>GEASS CHECKER</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b> com credenciais\n(<code>login:senha</code> por linha).`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
  }
});

// ── File actions ──────────────────────────────────────────────────────────────
bot.action("file_check", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  if (!s.credentials?.length) { await ctx.reply("Nenhuma credencial carregada."); return; }
  await showTargetMenu(ctx, s.credentials.length);
});

bot.action("file_import", async ctx => {
  await ctx.answerCbQuery("Importando...");
  const s = getSession(ctx.from!.id);
  if (!s.credentials?.length) { await ctx.reply("Nenhuma credencial carregada."); return; }
  try {
    const r    = await fetch(`${API_BASE}/api/credentials/import?source=telegram`, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: s.credentials.join("\n"),
    });
    const data = await r.json() as { inserted: number; skipped: number };
    await ctx.replyWithHTML(
      `${LINE}\n💾 <b>IMPORTAÇÃO CONCLUÍDA</b>\n${LINE2}\n\nInserido: <b>${data.inserted}</b>\nIgnorado: <b>${data.skipped}</b>\n\n${LINE}`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
  } catch (e) {
    await ctx.reply(`❌ Erro ao importar: ${String(e)}`);
  }
});

// ── Target callbacks ──────────────────────────────────────────────────────────
CHECKER_TARGETS.forEach(t => {
  bot.action(`target_${t.id}`, async ctx => {
    await ctx.answerCbQuery(`${SWORD} Iniciando ${t.label}...`);
    const s = getSession(ctx.from!.id);
    if (!s.credentials?.length) { await ctx.reply("Nenhuma credencial carregada."); return; }
    if (s.running) { await ctx.reply("Pare o checker atual (/stop) primeiro."); return; }
    await startChecker(ctx, t.id, t.label, s);
  });
});

// ── File handler ──────────────────────────────────────────────────────────────
bot.on(message("document"), async ctx => {
  const doc = ctx.message.document;
  if (!doc.file_name?.match(/\.(txt|csv|log)$/i) && doc.mime_type !== "text/plain") {
    await ctx.reply("⚠️ Envie um arquivo .txt com credenciais.");
    return;
  }
  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const raw      = await fetch(fileLink.toString()).then(r => r.text());
    const lines    = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":"));

    if (lines.length === 0) {
      await ctx.reply("❌ Nenhuma credencial válida (formato login:senha) encontrada.");
      return;
    }

    const s = getSession(ctx.from!.id);
    s.credentials = lines;
    s.waitingFor  = null;

    // If import mode
    if ((ctx.message as { caption?: string }).caption?.toLowerCase().includes("import")) {
      await ctx.replyWithHTML(
        `${LINE}\n💾 <b>ARQUIVO RECEBIDO</b>\n${LINE2}\n\n📄 <b>${esc(doc.file_name ?? "arquivo.txt")}</b>\n<b>${lines.length}</b> credenciais\n\n${LINE}`,
        Markup.inlineKeyboard([
          [Markup.button.callback(   `${SWORD} Checar`, "file_check"),
           Markup.button.callback("💾 Importar DB", "file_import")],
          [Markup.button.callback("🏠 Início",          "go_home")],
        ]),
      );
      return;
    }

    await ctx.replyWithHTML(
      `${LINE}\n📄 <b>ARQUIVO RECEBIDO</b>\n${LINE2}\n\n<b>${esc(doc.file_name ?? "arquivo.txt")}</b>\n<b>${lines.length}</b> credenciais carregadas\n\n${LINE}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`${SWORD} Checar Agora`, "file_check"),
         Markup.button.callback("💾 Importar DB",       "file_import")],
        [Markup.button.callback("🏠 Início",             "go_home")],
      ]),
    );
  } catch (e) {
    await ctx.reply(`❌ Erro ao ler arquivo: ${String(e)}`);
  }
});

// ── Text message handler ──────────────────────────────────────────────────────
bot.on(message("text"), async ctx => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const s = getSession(ctx.from!.id);

  // Domain search mode
  if (s.waitingFor === "domain") {
    s.waitingFor = null;
    const domain = text.trim().replace(/^https?:\/\//i, "").split("/")[0];
    await searchAndOffer(ctx, domain);
    return;
  }

  // Credential paste
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":") && !l.startsWith("/"));
  if (lines.length >= 2) {
    s.credentials = lines;
    s.waitingFor  = null;
    await ctx.replyWithHTML(
      `${LINE}\n📋 <b>CREDENCIAIS CARREGADAS</b>\n${LINE2}\n\n<b>${lines.length}</b> linhas detectadas\n\n${LINE}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`${SWORD} Checar Agora`, "file_check"),
         Markup.button.callback("💾 Importar DB",       "file_import")],
        [Markup.button.callback("🏠 Início",             "go_home")],
      ]),
    );
    return;
  }

  // Single line URL-like
  const trimmed = text.trim();
  if (trimmed.includes(".") && !trimmed.includes(" ") && trimmed.length < 100) {
    const domain = trimmed.replace(/^https?:\/\//i, "").split("/")[0];
    await searchAndOffer(ctx, domain);
  }
});

// ── Start checker SSE session ─────────────────────────────────────────────────
async function startChecker(ctx: Context, target: string, label: string, s: Session) {
  s.hits    = [];
  s.fails   = [];
  s.errors  = [];
  s.running = true;

  const creds  = s.credentials!;
  const chatId = ctx.chat!.id;

  const initMsg = await ctx.replyWithHTML(
    buildProgress(label, creds.length, 0, [], [], []),
    Markup.inlineKeyboard([[Markup.button.callback("🛑 PARAR GEASS", "stop_checker")]]),
  );
  s.progressMsgId  = initMsg.message_id;
  s.progressChatId = chatId;

  let jobId: string;
  try {
    const r = await fetch(`${API_BASE}/api/checker/start`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ target, credentials: creds }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { jobId: string };
    jobId = data.jobId;
    s.activeJobId = jobId;
  } catch (e) {
    s.running = false;
    await ctx.reply(`❌ Erro ao iniciar checker: ${String(e)}`);
    return;
  }

  const abortCtrl = new AbortController();
  s.abortCtrl = abortCtrl;

  let done           = 0;
  let lastEdit       = Date.now();
  const EDIT_INTERVAL = 3_000;

  void (async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/checker/${jobId}/stream`, {
        signal: abortCtrl.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (data["type"] === "result") {
            done++;
            const cred = `${String(data["credential"] ?? "?")} | ${String(data["detail"] ?? "")}`;
            if      (data["status"] === "HIT")  s.hits.push(cred);
            else if (data["status"] === "FAIL") s.fails.push(cred);
            else                                s.errors.push(cred);

            const now = Date.now();
            if (now - lastEdit > EDIT_INTERVAL) {
              lastEdit = now;
              await editMsg(ctx, chatId, s.progressMsgId!,
                buildProgress(label, creds.length, done, s.hits, s.fails, s.errors),
                Markup.inlineKeyboard([[Markup.button.callback("🛑 PARAR GEASS", "stop_checker")]]),
              );
            }
          } else if (data["type"] === "done" || data["type"] === "end") {
            s.running = false;
            await sendFinalReport(ctx, chatId, s.progressMsgId!, label, creds.length, s.hits, s.fails, s.errors);
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
    } finally {
      if (s.running) {
        s.running = false;
        await sendFinalReport(ctx, chatId, s.progressMsgId!, label, creds.length, s.hits, s.fails, s.errors);
      }
    }
  })();
}

async function sendFinalReport(
  ctx: Context,
  chatId: number,
  msgId: number,
  label: string,
  total: number,
  hits: string[],
  fails: string[],
  errors: string[],
) {
  const text = buildFinal(label, total, hits, fails, errors, false);
  await editMsg(ctx, chatId, msgId, text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ver HITs",  "home_hits"),  Markup.button.callback("📊 Stats", "home_stats")],
      [Markup.button.callback("🏠 Início",    "go_home")],
    ]),
  );

  if (hits.length > 5) {
    const buf = Buffer.from(hits.join("\n"), "utf-8");
    await ctx.telegram.sendDocument(chatId,
      { source: buf, filename: `hits_${label.replace(/\s+/g, "_")}.txt` },
      { caption: `✅ ${hits.length} HITs — ${label}`, parse_mode: "HTML" },
    );
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch(() => {
  console.log("🤖 Geass Command Center bot running...");
}).catch(err => {
  console.error("Bot launch error:", err);
  process.exit(1);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
