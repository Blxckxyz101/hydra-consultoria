/**
 * voice.ts — Admin-only voice channel module
 * Commands: /voice join | leave | sniff
 *
 * "Sniff" — joins a voice channel and monitors the RTP/UDP network stats
 * in real-time, Discord-wireshark style, showing:
 *   • Ping to Discord voice server (UDP RTT)
 *   • RTP packets sent/received
 *   • Packet loss %, jitter
 *   • Bitrate (audio kbps)
 *   • Voice encryption mode
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
} from "discord.js";
import { isOwner, isMod } from "./bot-config.js";
import { COLORS } from "./config.js";

// ── Active sniff sessions: guildId → intervalId ──────────────────────────────
const sniffSessions = new Map<string, ReturnType<typeof setInterval>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdmin(userId: string, username: string): boolean {
  return isOwner(userId, username) || isMod(userId, username);
}

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec);
}

/** Extract network stats from the voice connection internals (discord.js v14). */
function getNetworkStats(conn: VoiceConnection): {
  ping:       number;
  packetsRx:  number;
  packetsTx:  number;
  packetsLost:number;
  lossPercent:number;
  jitter:     number;
  bitrateKbps:number;
  encryption: string;
  ssrc:       number | null;
  ip:         string;
  port:       number;
  state:      string;
} {
  const state = conn.state as Record<string, unknown>;
  const networking = state["networking"] as Record<string, unknown> | undefined;
  const netState   = networking?.["state"] as Record<string, unknown> | undefined;
  const udp        = netState?.["udp"] as Record<string, unknown> | undefined;
  const ready      = netState as Record<string, unknown> | undefined;

  const ping        = typeof conn.ping?.udp === "number" ? conn.ping.udp : -1;
  const packetsRx   = typeof udp?.["packetsReceived"]  === "number" ? udp["packetsReceived"]  as number : 0;
  const packetsTx   = typeof udp?.["packetsSent"]      === "number" ? udp["packetsSent"]      as number : 0;
  const packetsLost = typeof udp?.["packetsLost"]       === "number" ? udp["packetsLost"]      as number : 0;
  const jitter      = typeof udp?.["jitter"]            === "number" ? udp["jitter"]           as number : 0;
  const bitrateKbps = typeof ready?.["bitrateKbps"]    === "number" ? ready["bitrateKbps"]    as number : 0;
  const encryption  = typeof ready?.["encryptionMode"] === "string"  ? ready["encryptionMode"] as string : "aead_xchacha20_poly1305_rtpsize";
  const ssrc        = typeof ready?.["ssrc"]            === "number"  ? ready["ssrc"]           as number : null;
  const ip          = typeof ready?.["ip"]              === "string"  ? ready["ip"]             as string : "unknown";
  const port        = typeof ready?.["port"]            === "number"  ? ready["port"]           as number : 0;

  const totalRx    = packetsRx + packetsLost;
  const lossPercent = totalRx > 0 ? (packetsLost / totalRx) * 100 : 0;

  return {
    ping, packetsRx, packetsTx, packetsLost, lossPercent,
    jitter, bitrateKbps, encryption, ssrc, ip, port,
    state: conn.state.status,
  };
}

function lossColor(lp: number): number {
  if (lp > 15) return COLORS.RED;
  if (lp > 5)  return COLORS.ORANGE;
  return COLORS.GREEN;
}

function pingBar(ms: number): string {
  if (ms < 0)   return "⬛⬛⬛⬛⬛ N/A";
  if (ms < 50)  return "🟢🟢🟢🟢🟢";
  if (ms < 100) return "🟢🟢🟢🟢⬛";
  if (ms < 150) return "🟡🟡🟡⬛⬛";
  if (ms < 300) return "🔴🔴⬛⬛⬛";
  return            "🔴⬛⬛⬛⬛";
}

function buildSniffEmbed(
  conn: VoiceConnection,
  channelName: string,
  startedAt: number,
  sampleCount: number,
): EmbedBuilder {
  const ns       = getNetworkStats(conn);
  const elapsed  = Math.floor((Date.now() - startedAt) / 1000);
  const mm       = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss       = String(elapsed % 60).padStart(2, "0");

  const pingStr  = ns.ping >= 0 ? `${ns.ping}ms` : "N/A";
  const lossStr  = `${fmt(ns.lossPercent)}%`;
  const jitterMs = ns.jitter > 0 ? `${fmt(ns.jitter * 1000)}ms` : "0.0ms";
  const bitrate  = ns.bitrateKbps > 0 ? `${fmt(ns.bitrateKbps)} kbps` : "—";
  const cryptoShort = ns.encryption.replace("aead_", "").replace("_rtpsize", "").toUpperCase();

  const statusIcon = ns.state === VoiceConnectionStatus.Ready ? "🟢" :
                     ns.state === VoiceConnectionStatus.Connecting ? "🟡" : "🔴";

  return new EmbedBuilder()
    .setColor(lossColor(ns.lossPercent))
    .setTitle(`📡 Voice Network Monitor — #${channelName}`)
    .setDescription(
      `\`\`\`\n` +
      `  DISCORD VOICE SNIFFER — RTP/UDP STATS\n` +
      `  Sample #${sampleCount} | Uptime: ${mm}:${ss}\n` +
      `\`\`\``
    )
    .addFields(
      {
        name: "🌐 Conexão",
        value: [
          `**Status:** ${statusIcon} ${ns.state}`,
          `**IP do Voice Server:** \`${ns.ip}:${ns.port}\``,
          `**SSRC:** \`${ns.ssrc ?? "—"}\``,
          `**Criptografia:** \`${cryptoShort}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "⚡ Latência / Qualidade",
        value: [
          `**Ping UDP:** \`${pingStr}\``,
          `${pingBar(ns.ping)}`,
          `**Jitter:** \`${jitterMs}\``,
          `**Packet Loss:** \`${lossStr}\``,
          `**Bitrate Estimado:** \`${bitrate}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "📦 Pacotes RTP",
        value: [
          `**Enviados (TX):** \`${ns.packetsTx.toLocaleString()}\``,
          `**Recebidos (RX):** \`${ns.packetsRx.toLocaleString()}\``,
          `**Perdidos:** \`${ns.packetsLost.toLocaleString()}\``,
          `**Total observado:** \`${(ns.packetsRx + ns.packetsLost).toLocaleString()}\``,
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: `👁 Lelouch Network Intelligence • Atualiza a cada 5s • /voice leave para parar` })
    .setTimestamp();
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

  // All voice subcommands are admin-only
  if (!isAdmin(userId, userName)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.RED)
          .setTitle("👁 Permissão Negada — Geass")
          .setDescription("*\"Only those bound by my Geass may command my presence.\"*\n\n Este comando é exclusivo para **owners** e **admins** do bot."),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── /voice join ────────────────────────────────────────────────────────────
  if (sub === "join") {
    const member   = await interaction.guild!.members.fetch(userId).catch(() => null);
    const vcState  = member?.voice;
    const vc       = vcState?.channel;

    if (!vc || vc.type !== ChannelType.GuildVoice) {
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const conn = joinVoiceChannel({
        channelId:      vc.id,
        guildId:        guildId,
        adapterCreator: interaction.guild!.voiceAdapterCreator,
        selfDeaf:       true,
        selfMute:       true,
      });

      await entersState(conn, VoiceConnectionStatus.Ready, 10_000);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle("🔊 Lelouch entrou na call")
            .setDescription(
              `Conectado em **#${vc.name}**.\n\n` +
              `Use \`/voice sniff\` para monitorar o tráfego de rede (RTP/UDP) em tempo real.\n` +
              `Use \`/voice leave\` para sair.`,
            ),
        ],
      });
    } catch {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle("❌ Falha ao entrar na call")
            .setDescription("Verifique se o bot tem permissão de `Connect` no canal."),
        ],
      });
    }
    return;
  }

  // ── /voice leave ───────────────────────────────────────────────────────────
  if (sub === "leave") {
    // Stop any active sniff session
    const existing = sniffSessions.get(guildId);
    if (existing) {
      clearInterval(existing);
      sniffSessions.delete(guildId);
    }

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
          .setDescription("*\"I take my leave. Until I am needed again.\"*"),
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

    // Kill any previous sniff session for this guild
    const prev = sniffSessions.get(guildId);
    if (prev) { clearInterval(prev); sniffSessions.delete(guildId); }

    // Get voice channel name
    const member  = await interaction.guild!.members.fetch(userId).catch(() => null);
    const vcName  = member?.voice?.channel?.name ?? conn.joinConfig.channelId;

    await interaction.deferReply();

    const startedAt  = Date.now();
    let   sampleCount = 0;

    // Send the first frame immediately
    sampleCount++;
    const firstEmbed = buildSniffEmbed(conn, vcName, startedAt, sampleCount);
    await interaction.editReply({ embeds: [firstEmbed] });

    // Then update every 5 seconds
    const interval = setInterval(async () => {
      const currentConn = getVoiceConnection(guildId);
      if (!currentConn || currentConn.state.status === VoiceConnectionStatus.Destroyed) {
        clearInterval(interval);
        sniffSessions.delete(guildId);
        try {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.RED)
                .setTitle("📡 Sniff terminado — conexão encerrada")
                .setDescription("A conexão de voz foi encerrada."),
            ],
          });
        } catch { /**/ }
        return;
      }

      sampleCount++;
      try {
        const embed = buildSniffEmbed(currentConn, vcName, startedAt, sampleCount);
        await interaction.editReply({ embeds: [embed] });
      } catch { /**/ }
    }, 5_000);

    sniffSessions.set(guildId, interval);
    return;
  }
}
