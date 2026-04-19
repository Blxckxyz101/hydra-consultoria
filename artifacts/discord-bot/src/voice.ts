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
  entersState,
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

const sniffSessions = new Map<string, SniffSession>();

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

/** Reverse-DNS lookup: IP → hostname (ex: brazil1-a.discord.gg). */
async function reverseDns(ip: string): Promise<string | null> {
  if (!ip || ip === "unknown") return null;
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames[0] ?? null;
  } catch {
    return null;
  }
}

/** GeoIP + reverse-DNS combined lookup. */
async function lookupServerGeo(ip: string): Promise<ServerGeo | null> {
  if (!ip || ip === "unknown") return null;

  const [hostname, geoResp] = await Promise.allSettled([
    reverseDns(ip),
    fetch(`https://ipapi.co/${ip}/json/`, {
      signal: AbortSignal.timeout(5_000),
      headers: { "User-Agent": "Discord-VoiceSniffer/2.0" },
    }).then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : null),
  ]);

  const hn  = hostname.status === "fulfilled" ? hostname.value : null;
  const geo = geoResp.status  === "fulfilled" ? geoResp.value  : null;

  if (!geo || (geo as Record<string, unknown>)["error"]) {
    return {
      ip, hostname: hn,
      country: "Desconhecido", region: "", city: "", org: "", flag: "🌐",
    };
  }

  const d       = geo as Record<string, unknown>;
  const country = String(d["country_name"] ?? "");
  const code    = String(d["country_code"] ?? "").toLowerCase();
  const flag    = code.length === 2
    ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 97))
    : "🌐";

  return {
    ip, hostname: hn,
    country,
    region:  String(d["region"] ?? ""),
    city:    String(d["city"] ?? ""),
    org:     String(d["org"] ?? ""),
    flag,
  };
}

// ── Internal state extractors ─────────────────────────────────────────────────

/** Extract the voice server IP+port from multiple fallback paths in internal state. */
function extractServerEndpoint(conn: VoiceConnection): { ip: string; port: number } {
  const state = conn.state as Record<string, unknown>;

  // Path 1: networking.state (Ready status)
  const networking = state["networking"]  as Record<string, unknown> | undefined;
  const netState   = networking?.["state"] as Record<string, unknown> | undefined;

  const ip1   = netState?.["ip"]   as string | undefined;
  const port1 = netState?.["port"] as number | undefined;
  if (ip1 && ip1 !== "unknown") return { ip: ip1, port: port1 ?? 0 };

  // Path 2: networking.state.udp
  const udp  = netState?.["udp"] as Record<string, unknown> | undefined;
  const ip2  = udp?.["remote"]   as Record<string, unknown> | undefined;
  if (ip2?.["address"]) return { ip: String(ip2["address"]), port: Number(ip2["port"] ?? 0) };

  // Path 3: root state
  const ip3   = state["ip"]   as string | undefined;
  const port3 = state["port"] as number | undefined;
  if (ip3 && ip3 !== "unknown") return { ip: ip3, port: port3 ?? 0 };

  return { ip: "unknown", port: 0 };
}

/** Extract RTP/UDP stats from the voice connection internals. */
function getNetworkStats(conn: VoiceConnection) {
  const state      = conn.state as Record<string, unknown>;
  const networking = state["networking"]  as Record<string, unknown> | undefined;
  const netState   = networking?.["state"] as Record<string, unknown> | undefined;
  const udp        = netState?.["udp"]    as Record<string, unknown> | undefined;

  const { ip, port } = extractServerEndpoint(conn);

  const ping        = typeof conn.ping?.udp === "number" ? conn.ping.udp : -1;
  const packetsRx   = (udp?.["packetsReceived"]  as number | undefined) ?? 0;
  const packetsTx   = (udp?.["packetsSent"]      as number | undefined) ?? 0;
  const packetsLost = (udp?.["packetsLost"]       as number | undefined) ?? 0;
  const jitter      = (udp?.["jitter"]            as number | undefined) ?? 0;
  const bitrateKbps = (netState?.["bitrateKbps"] as number | undefined) ?? 0;
  const encryption  = (netState?.["encryptionMode"] as string | undefined) ?? "xchacha20_poly1305";
  const ssrc        = (netState?.["ssrc"]         as number | undefined) ?? null;

  const totalRx     = packetsRx + packetsLost;
  const lossPercent = totalRx > 0 ? (packetsLost / totalRx) * 100 : 0;

  return {
    ping, packetsRx, packetsTx, packetsLost, lossPercent,
    jitter, bitrateKbps, encryption, ssrc, ip, port,
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

  // Voice server IP block
  const geo      = session.serverGeo;
  const ipLine   = `\`${ns.ip}:${ns.port}\``;
  const hostLine = geo?.hostname ? `🖥 **Hostname:** \`${geo.hostname}\`` : "";
  const geoLine  = geo && geo.country !== "Desconhecido"
    ? `${geo.flag} **${geo.city}, ${geo.country}** — \`${geo.org}\``
    : ipLine;

  // Participants
  const participants   = getParticipants(vc, session);
  const participantLines = participants.map(p => {
    const icons  = voiceStateIcons(p);
    const ssrcTag = p.ssrc !== null ? ` · SSRC:\`${p.ssrc}\`` : "";
    return `${icons} **${p.tag}**${ssrcTag}`;
  });

  const totalPkts = ns.packetsRx + ns.packetsLost;

  const ipBlock = [
    `${connIcon} **Status:** \`${ns.connStatus}\``,
    `🔌 **IP Exato:** ${ipLine}`,
    ...(hostLine ? [hostLine] : []),
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
    const member = await interaction.guild!.members.fetch(userId).catch(() => null);
    const vc     = member?.voice?.channel;

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

      await entersState(conn, VoiceConnectionStatus.Ready, 15_000);

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

      // Grab voice server IP right after Ready
      const { ip: serverIp, port } = extractServerEndpoint(conn);
      const [geo] = await Promise.allSettled([lookupServerGeo(serverIp)]);
      const resolvedGeo = geo.status === "fulfilled" ? geo.value : null;
      const hostnameDisp = resolvedGeo?.hostname ? `\n🖥 Hostname: \`${resolvedGeo.hostname}\`` : "";
      const locationDisp = resolvedGeo?.country
        ? `\n📍 ${resolvedGeo.flag} ${resolvedGeo.city}, ${resolvedGeo.country} — \`${resolvedGeo.org}\``
        : "";

      const memberCount = vc.members.size;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle("🔊 Lelouch entrou na call")
            .setDescription(
              `Conectado em **#${vc.name}** · ${memberCount} participante${memberCount !== 1 ? "s" : ""}.\n\n` +
              `**🔌 IP do Servidor de Voz:** \`${serverIp}:${port}\`${hostnameDisp}${locationDisp}\n\n` +
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

    const conn = getVoiceConnection(guildId);
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
    const conn = getVoiceConnection(guildId);
    if (!conn || conn.state.status !== VoiceConnectionStatus.Ready) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("📡 Bot não está conectado")
            .setDescription("Use `/voice join` primeiro para entrar em uma call antes de iniciar o sniff."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Stop any previous session for this guild
    stopSession(guildId);

    // Resolve voice channel from bot's current state
    const botMember = await interaction.guild!.members.fetchMe().catch(() => null);
    const vc        = botMember?.voice?.channel as VoiceChannel | StageChannel | null;
    if (!vc) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ORANGE)
            .setTitle("📡 Canal de voz não encontrado")
            .setDescription("Não foi possível determinar em qual canal o bot está. Tente `/voice leave` e `/voice join` novamente."),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    // Resolve IP and geo before first render
    const { ip: serverIp } = extractServerEndpoint(conn);
    const serverGeo = await lookupServerGeo(serverIp).catch(() => null);

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
      const currentConn = getVoiceConnection(guildId);

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
