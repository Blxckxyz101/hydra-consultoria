import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
} from "./embeds.js";

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is not set. Set it in the environment variables.");
  process.exit(1);
}

// ── Slash Command Definitions ─────────────────────────────────────────────────
const COMMANDS = [
  new SlashCommandBuilder()
    .setName("attack")
    .setDescription("⚔️ Geass Attack Control — launch, stop, and monitor attacks")
    .addSubcommand(sub =>
      sub.setName("start")
        .setDescription("🔴 Launch a new Geass command (attack) against a target")
        .addStringOption(opt =>
          opt.setName("target").setDescription("Target URL or IP address (e.g. https://example.com)").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("method").setDescription("Attack method ID (e.g. http-flood, waf-bypass, syn-flood)").setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName("threads").setDescription("Number of concurrent threads (default: 200)").setRequired(false).setMinValue(1).setMaxValue(2000)
        )
        .addIntegerOption(opt =>
          opt.setName("duration").setDescription("Duration in seconds (default: 60)").setRequired(false).setMinValue(5).setMaxValue(3600)
        )
    )
    .addSubcommand(sub =>
      sub.setName("stop")
        .setDescription("⏹️ Stop a running attack by ID")
        .addIntegerOption(opt =>
          opt.setName("id").setDescription("Attack ID to stop (shown when attack was started)").setRequired(true)
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
      opt.setName("target").setDescription("Target URL or IP to analyze (e.g. cloudflare.com)").setRequired(true)
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

// ── Live attack monitor ───────────────────────────────────────────────────────
const monitors     = new Map<number, NodeJS.Timeout>();
const prevPackets  = new Map<number, number>(); // for pps delta calculation

function startMonitor(attackId: number, msg: Message): void {
  if (monitors.has(attackId)) return;

  const INTERVAL_SEC = 5;

  const tick = setInterval(async () => {
    const attack = await api.getAttack(attackId);
    if (!attack) {
      clearInterval(tick);
      monitors.delete(attackId);
      prevPackets.delete(attackId);
      return;
    }

    // Calculate live pps via delta (packets sent since last poll / interval)
    const prev    = prevPackets.get(attackId) ?? attack.packetsSent;
    const delta   = Math.max(0, attack.packetsSent - prev);
    const livePps = delta / INTERVAL_SEC;
    prevPackets.set(attackId, attack.packetsSent);

    try {
      await msg.edit({ embeds: [buildAttackEmbed(attack, livePps)] });
    } catch { /* message may have been deleted */ }

    if (attack.status !== "running") {
      clearInterval(tick);
      monitors.delete(attackId);
      prevPackets.delete(attackId);
    }
  }, INTERVAL_SEC * 1000);

  monitors.set(attackId, tick);
}

// ── Command Handlers ──────────────────────────────────────────────────────────
async function handleAttackStart(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target   = interaction.options.getString("target",  true);
  const method   = interaction.options.getString("method")  ?? "http-flood";
  const threads  = interaction.options.getInteger("threads") ?? 200;
  const duration = interaction.options.getInteger("duration") ?? 60;
  const user     = interaction.user.tag;

  console.log(`[ATTACK START] ${user} → ${target} | ${method} | ${threads}t | ${duration}s`);

  try {
    const attack = await api.startAttack({ target, method, threads, duration });

    const startEmbed = buildStartEmbed(attack);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`stop_${attack.id}`)
        .setLabel("⏹️ Stop Attack")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({ embeds: [startEmbed], components: [row] });

    // Log the command
    console.log(`[ATTACK #${attack.id}] Started — ${method} → ${target}`);

    // Start live monitoring
    startMonitor(attack.id, msg as Message);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      embeds: [buildErrorEmbed("ATTACK FAILED", `Could not launch attack:\n\`\`\`\n${message}\n\`\`\``)],
    });
  }
}

async function handleAttackStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const id   = interaction.options.getInteger("id", true);
  const user = interaction.user.tag;

  console.log(`[ATTACK STOP] ${user} → #${id}`);

  try {
    const result = await api.stopAttack(id);
    const ok     = result?.ok ?? false;

    // Clear monitor if running
    const timer = monitors.get(id);
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
  const user   = interaction.user.tag;

  console.log(`[ANALYZE] ${user} → ${target}`);

  // Show "scanning" message while working
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.GOLD)
        .setTitle("🔍 SCANNING TARGET...")
        .setDescription(`Analyzing \`${target}\`\nRunning DNS, HTTP/HTTPS probes, server fingerprinting, CDN detection...`)
        .setFooter({ text: AUTHOR })
    ],
  });

  try {
    const result = await api.analyze(target);
    await interaction.editReply({ embeds: [buildAnalyzeEmbed(result)] });
    console.log(`[ANALYZE] ${target} → CDN: ${result.isCDN ? result.cdnProvider : "none"} | Server: ${result.serverType}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      embeds: [buildErrorEmbed("ANALYSIS FAILED", `Could not analyze \`${target}\`:\n\`\`\`\n${message}\n\`\`\``)],
    });
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

// ── Button Interaction Handler ────────────────────────────────────────────────
async function handleButton(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const [action, idStr] = interaction.customId.split("_");
  if (action !== "stop" || !idStr) return;

  const id = parseInt(idStr, 10);
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await api.stopAttack(id);
    const ok     = result?.ok ?? false;

    const timer = monitors.get(id);
    if (timer) { clearInterval(timer); monitors.delete(id); }

    await interaction.editReply({
      embeds: [buildStopEmbed(id, ok)],
    });

    console.log(`[BUTTON] ${interaction.user.tag} stopped attack #${id}`);
  } catch {
    await interaction.editReply({ embeds: [buildStopEmbed(id, false)] });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Register slash commands first
  await deployCommands();

  // Create client (only need Guilds intent for slash commands)
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, c => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   👁️  LELOUCH BRITANNIA — ONLINE        ║`);
    console.log(`║   Bot: ${c.user.tag.padEnd(32)} ║`);
    console.log(`║   Servers: ${String(c.guilds.cache.size).padEnd(28)} ║`);
    console.log(`╚════════════════════════════════════════╝\n`);
    console.log(`${AUTHOR}`);
    c.user.setPresence({
      activities: [{ name: "⚔️ Geass Commands — /help" }],
      status: "online",
    });
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      // Button interactions
      if (interaction.isButton()) {
        await handleButton(interaction as import("discord.js").ButtonInteraction);
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      const { commandName } = interaction;

      if (commandName === "attack") {
        const sub = interaction.options.getSubcommand();
        if (sub === "start") await handleAttackStart(interaction);
        else if (sub === "stop")  await handleAttackStop(interaction);
        else if (sub === "list")  await handleAttackList(interaction);
        else if (sub === "stats") await handleAttackStats(interaction);
      } else if (commandName === "analyze") {
        await handleAnalyze(interaction);
      } else if (commandName === "methods") {
        await handleMethods(interaction);
      } else if (commandName === "help") {
        await handleHelp(interaction);
      }
    } catch (err) {
      console.error("[INTERACTION ERROR]", err);
      try {
        const errEmbed = buildErrorEmbed("INTERNAL ERROR", "An unexpected error occurred. Please try again.");
        if (interaction.isRepliable() && !interaction.replied) {
          await interaction.reply({ embeds: [errEmbed], ephemeral: true });
        }
      } catch { /* ignore reply errors */ }
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
