/**
 * voice.ts — Admin-only voice channel module
 * Commands: /voice join | leave | sniff
 *
 * Sniff exibe em tempo real:
 *   • IP exato + hostname (reverse-DNS) + região geográfica do servidor de voz Discord
 *   • Ping UDP, jitter, packet loss, bitrate, criptografia
 *   • Todos os participantes da call com SSRC, estado de voz e se estão falando
 *   • Pacotes RTP TX/RX/lost ao longo do tempo
 *
 * ⚠️  IPs individuais de usuários NÃO são expostos pelo Discord (toda voz passa
 *     pelos servidores do Discord). O que exibimos é o servidor de relay do Discord
 *     com hostname via reverse-DNS (ex: brazil1-a.discord.gg).
 */

import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  type GuildMember,
  type VoiceChannel,
  type StageChannel,
} from "discord.js";
import { promises as dns } from "node:dns";
import { isOwner, isMod } from "./bot-config.js";
import { COLORS } from "./config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParticipantInfo {
  userId:   string;
  tag:      string;
  ssrc:     number | null;
  speaking: boolean;
  muted:    boolean;    // selfMute OR serverMute
  deafened: boolean;    // selfDeaf OR serverDeaf
  streaming:boolean;
  camera:   boolean;
  bot:      boolean;
}

interface SniffSession {
  interval:    ReturnType<typeof setInterval> | null;
  ssrcMap:     Map<string, number>;   // userId → ssrc
  speakingSet: Set<string>;           // userId de quem está falando
  startedAt:   number;
  vcId:        string;
  vcName:      string;
  serverGeo:   ServerGeo | null;
}

interface ServerGeo {
  ip:       string;
  hostname: string | null;   // via reverse-DNS: "brazil1-a.discord.gg" etc.
  country:  string;
  region:   string;
  city:     string;
  org:      string;
  flag:     string;
}

// ── State ─────────────────────────────────────────────────────────────────────

const sniffSessions   = new Map<string, SniffSession>();
const activeConns     = new Map<string, VoiceConnection>(); // guildId → our own conn ref

// ── Permission helpers ─────────────────────────────────────────────────────────

function isAdmin(userId: string, username: string): boolean {
  return isOwner(userId, username) || isMod(userId, username);
}

function denyEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.RED)
    .setTitle("👁 Permissão Negada — Geass")
    .setDescription(
      "*\"Only those bound by my Geass may stand before me.\"*\n\n" +
      "Este comando é exclusivo para **owners** e **admins** do bot.",
    );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec);
}

function pingBar(ms: number): string {
  if (ms < 0)   return "⬛⬛⬛⬛⬛";
  if (ms < 50)  return "🟢🟢🟢🟢🟢";
  if (ms < 100) return "🟢🟢🟢🟢⬛";
  if (ms < 150) return "🟡🟡🟡⬛⬛";
  if (ms < 300) return "🔴🔴⬛⬛⬛";
  return            "🔴⬛⬛⬛⬛";
}

function lossColor(lp: number): number {
  if (lp > 15) return COLORS.RED;
  if (lp > 5)  return COLORS.ORANGE;
  return COLORS.GREEN;
}

function voiceStateIcons(p: ParticipantInfo): string {
  const icons: string[] = [];
  if (p.speaking)  icons.push("🎙");
  if (p.muted)     icons.push("🔇");
  if (p.deafened)  icons.push("🔕");
  if (p.streaming) icons.push("📺");
  if (p.camera)    icons.push("📷");
  if (p.bot)       icons.push("🤖");
  return icons.length > 0 ? icons.join("") : "🎧";
}

// ── Network lookups ───────────────────────────────────────────────────────────

/**
 * Resolve a hostname to its first IPv4 address.
 * If the input looks like an IP already, returns it unchanged.
 */
async function resolveHostname(host: string): Promise<string> {
  if (!host || host === "unknown") return host;
  // Already an IP (IPv4 or IPv6)
  if (/^[\d.:]+$/.test(host)) return host;
  try {
    const addrs = await dns.resolve4(host);
    return addrs[0] ?? host;
  } catch {
    return host;
  }
}

/** Reverse-DNS lookup: IP → hostname. Returns null on failure. */
async function reverseDns(ip: string): Promise<string | null> {
  if (!ip || /[a-zA-Z]/.test(ip)) return null; // already a hostname or empty
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * GeoIP lookup.
 * Accepts EITHER an IP address OR a hostname (discord voice hostnames like brazil1-a.discord.gg).
 * When a hostname is provided, it is DNS-resolved to an IP first.
 */
async function lookupServerGeo(hostnameOrIp: string): Promise<ServerGeo | null> {
  if (!hostnameOrIp || hostnameOrIp === "unknown") return null;

  const isHostname = /[a-zA-Z]/.test(hostnameOrIp);

  // Resolve in parallel: DNS forward-resolve (if hostname) + reverse-DNS fallback
  const [ipResult, hnResult] = await Promise.allSettled([
    isHostname ? resolveHostname(hostnameOrIp) : Promise.resolve(hostnameOrIp),
    isHostname ? Promise.resolve(hostnameOrIp) : reverseDns(hostnameOrIp),
  ]);

  const ip       = ipResult.status === "fulfilled"  ? ipResult.value  : hostnameOrIp;
  const hostname = hnResult.status === "fulfilled"  ? hnResult.value  : null;

  // GeoIP fetch against the resolved IP
  let geo: Record<string, unknown> | null = null;
  try {
    const resp = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal:  AbortSignal.timeout(6_000),
      headers: { "User-Agent": "Mozilla/5.0 LelouchBot/3.0" },
    });
    if (resp.ok) geo = await resp.json() as Record<string, unknown>;
  } catch { /* timeout / network error */ }

  if (!geo || geo["error"]) {
    return {
      ip, hostname: isHostname ? hostnameOrIp : hostname,
      country: "Desconhecido", region: "", city: "", org: "", flag: "🌐",
    };
  }

  const country = String(geo["country_name"] ?? "");
  const code    = String(geo["country_code"]  ?? "").toLowerCase();
  const flag    = code.length === 2
    ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 97))
    : "🌐";

  return {
    ip,
    hostname: isHostname ? hostnameOrIp : (hostname ?? null),
    country,
    region: String(geo["region"] ?? ""),
    city:   String(geo["city"]   ?? ""),
    org:    String(geo["org"]    ?? ""),
    flag,
  };
}

// ── Internal state extractors ─────────────────────────────────────────────────

/**
 * NetworkingStatusCode mirrored from @discordjs/voice internals:
 * 0=OpeningWs 1=Identifying 2=UdpHandshaking 3=SelectingProtocol 4=Ready 5=Resuming 6=Closed
 */
const NET_CODE_LABEL: Record<number, string> = {
  0: "🔄 Abrindo WebSocket",
  1: "🔑 Identificando",
  2: "📡 Handshake UDP",
  3: "🤝 Selecionando protocolo",
  4: "✅ Pronto",
  5: "🔁 Reconectando",
  6: "❌ Fechado",
};

/**
 * Deep-extract voice server info from ALL known paths in @discordjs/voice internals.
 *
 * Priority:
 *   1. conn.packets.server.endpoint  (VOICE_SERVER_UPDATE payload) — always available
 *   2. networking._state.connectionOptions.endpoint
 *   3. networking._state.udp.remote  (UDP socket remote endpoint — code 2+)
 *
 * Returns { hostname, ip, port, networkingCode }
 */
function extractVoiceServer(conn: VoiceConnection): {
  hostname: string;
  ip:       string;   // may equal hostname until DNS resolves
  port:     number;
  networkingCode: number;
} {
  const c    = conn as unknown as Record<string, unknown>;
  const cs   = conn.state as Record<string, unknown>;

  // ── Networking internal state ──────────────────────────────────────────────
  const networking   = cs["networking"]    as Record<string, unknown> | undefined;
  const netInternal  = networking
    ? ((networking["_state"] ?? networking["state"]) as Record<string, unknown> | undefined)
    : undefined;
  const networkingCode: number = (netInternal?.["code"] as number | undefined) ?? -1;

  // ── Path 1: conn.packets.server.endpoint (BEST — available instantly) ──────
  //    Format: "brazil1-a.discord.gg:443" or "ip:port"
  const packets  = c["packets"]        as Record<string, unknown> | undefined;
  const server   = packets?.["server"] as Record<string, unknown> | undefined;
  const rawEp    = server?.["endpoint"] as string | undefined;

  if (rawEp) {
    const idx      = rawEp.lastIndexOf(":");
    const hostname = idx > 0 ? rawEp.slice(0, idx)           : rawEp;
    const port     = idx > 0 ? parseInt(rawEp.slice(idx + 1), 10) : 443;
    const ip       = /^[\d.]+$/.test(hostname) ? hostname : hostname; // hostname (resolve async later)
    return { hostname, ip: hostname, port, networkingCode };
  }

  // ── Path 2: networking._state.connectionOptions.endpoint ──────────────────
  const connOpts = netInternal?.["connectionOptions"] as Record<string, unknown> | undefined;
  const ep2      = connOpts?.["endpoint"] as string | undefined;
  if (ep2) {
    const idx      = ep2.lastIndexOf(":");
    const hostname = idx > 0 ? ep2.slice(0, idx)           : ep2;
    const port     = idx > 0 ? parseInt(ep2.slice(idx + 1), 10) : 443;
    return { hostname, ip: hostname, port, networkingCode };
  }

  // ── Path 3: networking._state.udp.remote (code 2+ only) ───────────────────
  const udp    = netInternal?.["udp"]    as Record<string, unknown> | undefined;
  const remote = udp?.["remote"]         as Record<string, unknown> | undefined;
  if (remote?.["ip"]) {
    const ip   = String(remote["ip"]);
    const port = Number(remote["port"] ?? 0);
    return { hostname: ip, ip, port, networkingCode };
  }

  return { hostname: "unknown", ip: "unknown", port: 0, networkingCode };
}

/** Extract all RTP/UDP stats + voice server info from connection internals. */
function getNetworkStats(conn: VoiceConnection) {
  const cs         = conn.state as Record<string, unknown>;
  const networking = cs["networking"] as Record<string, unknown> | undefined;
  const netInt     = networking
    ? ((networking["_state"] ?? networking["state"]) as Record<string, unknown> | undefined)
    : undefined;

  // UDP socket stats (only populated after networkingCode 2+)
  const udp        = netInt?.["udp"]    as Record<string, unknown> | undefined;
  const connData   = netInt?.["connectionData"] as Record<string, unknown> | undefined;

  const { hostname, ip, port, networkingCode } = extractVoiceServer(conn);

  const ping        = typeof conn.ping?.udp === "number" ? conn.ping.udp : -1;
  const packetsRx   = (udp?.["packetsReceived"] as number | undefined) ?? 0;
  const packetsTx   = (udp?.["packetsSent"]     as number | undefined) ?? 0;
  const packetsLost = (udp?.["packetsLost"]      as number | undefined) ?? 0;
  const jitter      = (udp?.["jitter"]           as number | undefined) ?? 0;
  const bitrateKbps = (netInt?.["bitrateKbps"]   as number | undefined) ?? 0;
  const encryption  = (connData?.["encryptionMode"] as string | undefined)
                   ?? (netInt?.["encryptionMode"]   as string | undefined)
                   ?? "XCHACHA20_POLY1305";
  const ssrc        = (connData?.["ssrc"]         as number | undefined) ?? null;

  const totalRx     = packetsRx + packetsLost;
  const lossPercent = totalRx > 0 ? (packetsLost / totalRx) * 100 : 0;

  return {
    ping, packetsRx, packetsTx, packetsLost, lossPercent,
    jitter, bitrateKbps,
    encryption: encryption.toUpperCase().replace(/_/g, " "),
    ssrc, hostname, ip, port,
    networkingCode,
    networkingLabel: NET_CODE_LABEL[networkingCode] ?? "Desconhecido",
    connStatus: conn.state.status,
  };
}

/** Get all participants from the voice channel cache. */
function getParticipants(
  vc: VoiceChannel | StageChannel,
  session: SniffSession,
): ParticipantInfo[] {
  return [...vc.members.values()].map((m: GuildMember) => ({
    userId:   m.id,
    tag:      m.user.username + (m.nickname ? ` (${m.nickname})` : ""),
    ssrc:     session.ssrcMap.get(m.id) ?? null,
    speaking: session.speakingSet.has(m.id),
    muted:    !!(m.voice.selfMute || m.voice.serverMute),
    deafened: !!(m.voice.selfDeaf || m.voice.serverDeaf),
    streaming:!!m.voice.streaming,
    camera:   !!m.voice.selfVideo,
    bot:      m.user.bot,
  }));
}

// ── Embed builder ─────────────────────────────────────────────────────────────

function buildSniffEmbed(
  conn:        VoiceConnection,
  session:     SniffSession,
  vc:          VoiceChannel | StageChannel,
  sampleCount: number,
): EmbedBuilder {
  const ns      = getNetworkStats(conn);
  const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
  const mm      = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss      = String(elapsed % 60).padStart(2, "0");

  const pingStr  = ns.ping >= 0 ? `${ns.ping}ms` : "N/A";
  const lossStr  = `${fmt(ns.lossPercent)}%`;
  const jitterMs = ns.jitter > 0 ? `${fmt(ns.jitter * 1000)}ms` : "0.0ms";
  const bitrate  = ns.bitrateKbps > 0 ? `${fmt(ns.bitrateKbps)} kbps` : "—";
  const cryptoShort = ns.encryption
    .replace(/^aead_/, "")
    .replace(/_rtpsize$/, "")
    .toUpperCase();

  const connIcon = ns.connStatus === VoiceConnectionStatus.Ready      ? "🟢" :
                   ns.connStatus === VoiceConnectionStatus.Connecting  ? "🟡" : "🔴";

  // Voice server block — hostname always available from conn.packets.server.endpoint
  const geo      = session.serverGeo;
  const displayHost = ns.hostname !== "unknown" ? ns.hostname : (geo?.hostname ?? "unknown");
  const displayIp   = geo?.ip && geo.ip !== displayHost ? ` · IP: \`${geo.ip}\`` : "";
  const ipLine      = `\`${displayHost}:${ns.port}\`${displayIp}`;
  const geoLine  = geo && geo.country !== "Desconhecido"
    ? `${geo.flag} **${geo.city}, ${geo.country}** — \`${geo.org}\``
    : `🌐 Localização pendente...`;

  // Participants
  const participants     = getParticipants(vc, session);
  const participantLines = participants.map(p => {
    const icons   = voiceStateIcons(p);
    const ssrcTag = p.ssrc !== null ? ` · SSRC:\`${p.ssrc}\`` : "";
    return `${icons} **${p.tag}**${ssrcTag}`;
  });

  const totalPkts = ns.packetsRx + ns.packetsLost;

  const ipBlock = [
    `${connIcon} **Status:** \`${ns.connStatus}\` · Fase: ${ns.networkingLabel}`,
    `🔌 **Servidor:** ${ipLine}`,
    `📍 **Localização:** ${geoLine}`,
    `🔐 **Criptografia:** \`${cryptoShort}\``,
    `🆔 **SSRC do Bot:** \`${ns.ssrc ?? "—"}\``,
  ].join("\n");

  return new EmbedBuilder()
    .setColor(lossColor(ns.lossPercent))
    .setTitle(`📡 Voice Sniffer — #${session.vcName}`)
    .setDescription(
      "```\n" +
      `  LELOUCH NETWORK INTELLIGENCE — SAMPLE #${sampleCount}\n` +
      `  Canal: #${session.vcName} · Uptime: ${mm}:${ss}\n` +
      "```"
    )
    .addFields(
      {
        name: "🌐 Servidor de Voz Discord",
        value: ipBlock,
        inline: false,
      },
      {
        name: "⚡ Qualidade da Conexão",
        value: [
          `**Ping UDP:** \`${pingStr}\` ${pingBar(ns.ping)}`,
          `**Jitter:** \`${jitterMs}\``,
          `**Packet Loss:** \`${lossStr}\``,
          `**Bitrate Estimado:** \`${bitrate}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "📦 Tráfego RTP (cumulativo)",
        value: [
          `**TX (enviado):** \`${ns.packetsTx.toLocaleString()} pkts\``,
          `**RX (recebido):** \`${ns.packetsRx.toLocaleString()} pkts\``,
          `**Perdidos:** \`${ns.packetsLost.toLocaleString()} pkts\``,
          `**Total observado:** \`${totalPkts.toLocaleString()} pkts\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: `👥 Participantes na Call (${participants.length})`,
        value: participantLines.length > 0
          ? participantLines.slice(0, 15).join("\n")
          : "*Canal vazio*",
        inline: false,
      },
      {
        name: "📖 Legenda",
        value: "🎙 Falando · 🔇 Mutado · 🔕 Ensurdecido · 📺 Stream · 📷 Camera · 🤖 Bot · 🎧 Ouvindo",
        inline: false,
      },
    )
    .setFooter({ text: "👁 Lelouch Intelligence · Atualiza a cada 5s · /voice leave para encerrar" })
    .setTimestamp();
}

// ── Session cleanup ────────────────────────────────────────────────────────────

function stopSession(guildId: string): void {
  const s = sniffSessions.get(guildId);
  if (!s) return;
  if (s.interval !== null) clearInterval(s.interval);
  sniffSessions.delete(guildId);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleVoice(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub      = interaction.options.getSubcommand(true);
  const userId   = interaction.user.id;
  const userName = interaction.user.username;
  const guildId  = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "❌ Este comando só pode ser usado em um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Double-check: Discord-level permission + our bot-config admin list
  if (!isAdmin(userId, userName)) {
    await interaction.reply({ embeds: [denyEmbed()], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /voice join ────────────────────────────────────────────────────────────
  if (sub === "join") {
    // Primary: voice state cache (populated once GuildVoiceStates intent is on)
    // Fallback: fresh member fetch (covers edge cases where cache lags)
    const guild  = interaction.guild!;
    const cached = guild.voiceStates.cache.get(userId);
    const member = cached?.member ?? await guild.members.fetch(userId).catch(() => null);
    const vc     = cached?.channel ?? member?.voice?.channel;

    if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("🔊 Você não está em uma call")
            .setDescription("Entre em um canal de voz e tente novamente."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Stop any previous sniff session before re-joining
    stopSession(guildId);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const conn = joinVoiceChannel({
        channelId:      vc.id,
        guildId,
        adapterCreator: interaction.guild!.voiceAdapterCreator,
        selfDeaf:       false,  // não deafen — permite ouvir SSRCs via speaking events
        selfMute:       true,
      });

      // Store IMMEDIATELY — sniff reads from this map
      activeConns.set(guildId, conn);
      conn.on(VoiceConnectionStatus.Destroyed, () => activeConns.delete(guildId));

      // Give Gateway ~800ms to deliver VOICE_SERVER_UPDATE (populates conn.packets.server)
      // We do NOT wait for Ready — UDP may never complete on Replit's network,
      // but the hostname is available the moment the WS READY opcode is received.
      await new Promise(r => setTimeout(r, 800));

      // Track SSRCs via speaking events (Discord sends {userId, ssrc} in SPEAKING gateway event)
      conn.receiver.speaking.on("start", (speakingUserId) => {
        const session = sniffSessions.get(guildId);
        if (session) session.speakingSet.add(speakingUserId);

        try {
          const networking = (conn.state as Record<string, unknown>)["networking"] as Record<string, unknown> | undefined;
          const netSt      = networking?.["state"] as Record<string, unknown> | undefined;
          const ws         = netSt?.["ws"] as Record<string, unknown> | undefined;
          const ssrcMap    = ws?.["ssrcMap"] as Map<number, string> | undefined;
          if (ssrcMap && session) {
            for (const [ssrc, uid] of ssrcMap.entries()) {
              if (uid === speakingUserId) { session.ssrcMap.set(speakingUserId, ssrc); break; }
            }
          }
        } catch { /**/ }
      });

      conn.receiver.speaking.on("end", (speakingUserId) => {
        sniffSessions.get(guildId)?.speakingSet.delete(speakingUserId);
      });

      // Extract voice server info from conn.packets.server.endpoint (always populated by now)
      const { hostname: serverHost, ip: serverIp, port } = extractVoiceServer(conn);
      const geo = await lookupServerGeo(serverHost !== "unknown" ? serverHost : serverIp).catch(() => null);

      const memberCount = vc.members.size;
      const serverLine  = serverHost !== "unknown"
        ? `\`${serverHost}:${port}\``
        : "`(aguardando Gateway…)`";
      const ipLine = geo?.ip && geo.ip !== serverHost ? `\n🔢 **IP:** \`${geo.ip}\`` : "";
      const geoLine = geo && geo.country !== "Desconhecido"
        ? `\n📍 ${geo.flag} **${geo.city}, ${geo.country}** — \`${geo.org}\``
        : "";

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle("🔊 Lelouch entrou na call")
            .setDescription(
              `Conectado em **#${vc.name}** · ${memberCount} participante${memberCount !== 1 ? "s" : ""}.\n\n` +
              `**🔌 Servidor de Voz Discord:**\n${serverLine}${ipLine}${geoLine}\n\n` +
              `Use \`/voice sniff\` para iniciar o monitor de rede em tempo real.\n` +
              `Use \`/voice leave\` para sair.`,
            ),
        ],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("❌ Falha ao entrar na call")
            .setDescription(
              `Verifique se o bot tem permissão de **Connect** no canal.\n\n` +
              `Erro: \`${err instanceof Error ? err.message : String(err)}\``,
            ),
        ],
      });
    }
    return;
  }

  // ── /voice leave ───────────────────────────────────────────────────────────
  if (sub === "leave") {
    stopSession(guildId);

    const conn = activeConns.get(guildId) ?? getVoiceConnection(guildId);
    activeConns.delete(guildId);

    if (!conn) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("🔇 Bot não está em nenhuma call")
            .setDescription("O bot não está conectado a nenhum canal de voz neste servidor."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    conn.destroy();
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.CRIMSON)
          .setTitle("🔇 Lelouch saiu da call")
          .setDescription("*\"I take my leave. Remember — I am always watching.\"*"),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── /voice sniff ───────────────────────────────────────────────────────────
  if (sub === "sniff") {
    // ⚠️ MUST defer FIRST — Discord expires interactions after 3s with no response.
    // All further checks use editReply so there is no expiry risk.
    await interaction.deferReply();

    // Use our own stored reference — do NOT wait for Ready, we work in any active state
    const conn = activeConns.get(guildId) ?? getVoiceConnection(guildId);

    if (!conn || conn.state.status === VoiceConnectionStatus.Destroyed ||
                 conn.state.status === VoiceConnectionStatus.Disconnected) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("📡 Bot não está em nenhuma call")
            .setDescription("Use `/voice join` primeiro para entrar em um canal de voz."),
        ],
      });
      return;
    }

    // Stop any previous session for this guild
    stopSession(guildId);

    // Resolve the voice channel the bot is in
    const joinedChannelId =
      conn.joinConfig.channelId ??
      interaction.guild!.voiceStates.cache.get(interaction.client.user!.id)?.channelId;

    console.log(`[VOICE SNIFF] joinedChannelId=${joinedChannelId}, connStatus=${conn.state.status}`);

    // Try cache first, then fetch from API
    let vc: VoiceChannel | StageChannel | null = null;
    if (joinedChannelId) {
      const cached = interaction.guild!.channels.cache.get(joinedChannelId);
      if (cached && (cached.type === ChannelType.GuildVoice || cached.type === ChannelType.GuildStageVoice)) {
        vc = cached as VoiceChannel | StageChannel;
      } else {
        const fetched = await interaction.guild!.channels.fetch(joinedChannelId).catch(() => null);
        if (fetched && (fetched.type === ChannelType.GuildVoice || fetched.type === ChannelType.GuildStageVoice)) {
          vc = fetched as VoiceChannel | StageChannel;
        }
      }
    }

    if (!vc) {
      console.log(`[VOICE SNIFF] Could not resolve VC — joinedChannelId=${joinedChannelId}`);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("📡 Canal de voz não encontrado")
            .setDescription("Não foi possível resolver o canal. Tente `/voice leave` e `/voice join` novamente."),
        ],
      });
      return;
    }

    // Resolve geo from hostname (e.g. "brazil1-a.discord.gg") — no need for Ready state
    const { hostname: serverHost, ip: serverIp } = extractVoiceServer(conn);
    const geoTarget = serverHost !== "unknown" ? serverHost : serverIp;
    console.log(`[VOICE SNIFF] server=${geoTarget}, connStatus=${conn.state.status}`);
    const serverGeo = await lookupServerGeo(geoTarget).catch(() => null);

    const session: SniffSession = {
      interval:    null,
      ssrcMap:     new Map(),
      speakingSet: new Set(),
      startedAt:   Date.now(),
      vcId:        vc.id,
      vcName:      vc.name,
      serverGeo,
    };
    sniffSessions.set(guildId, session);

    let sampleCount = 0;

    const tick = async (): Promise<void> => {
      const currentConn = activeConns.get(guildId) ?? getVoiceConnection(guildId);

      // If connection was destroyed, stop session and update embed
      if (!currentConn || currentConn.state.status === VoiceConnectionStatus.Destroyed) {
        stopSession(guildId);
        try {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.RED)
                .setTitle("📡 Sniff encerrado — conexão perdida")
                .setDescription("A conexão de voz foi encerrada ou destruída."),
            ],
          });
        } catch { /**/ }
        return;
      }

      // Refresh VC from cache to get latest member list
      const vcFresh = interaction.guild?.channels.cache.get(session.vcId) as VoiceChannel | StageChannel | undefined;
      if (!vcFresh) return;

      sampleCount++;
      try {
        const embed = buildSniffEmbed(currentConn, session, vcFresh, sampleCount);
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        // Interaction expired (Discord 15-min token limit) — stop silently
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unknown interaction") || msg.includes("10062") || msg.includes("expired")) {
          stopSession(guildId);
        }
      }
    };

    // First render immediately, then every 5 seconds
    await tick();
    if (sniffSessions.has(guildId)) {
      session.interval = setInterval(() => void tick(), 5_000);
    }
    return;
  }
}
