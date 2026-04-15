import { EmbedBuilder } from "discord.js";
import type { Attack, AttackStats, AnalyzeResult, Method } from "./api.js";
import { COLORS, METHOD_EMOJIS, AUTHOR, BOT_NAME } from "./config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtNum   = (n: number) => n.toLocaleString("en-US");
const fmtBytes = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
};
const fmtPps = (pps: number) => {
  if (pps >= 1e6) return `${(pps / 1e6).toFixed(2)}M pps`;
  if (pps >= 1e3) return `${(pps / 1e3).toFixed(1)}K pps`;
  return `${Math.round(pps)} pps`;
};
const elapsed = (startedAt: string) => {
  const s   = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const statusIcon = (s: string) =>
  s === "running"  ? "🔴 RUNNING"
  : s === "stopped"  ? "⏹️ STOPPED"
  : s === "finished" ? "✅ FINISHED"
  : "❌ ERROR";
const tierIcon = (t: string) =>
  t === "S" ? "🔴" : t === "A" ? "🟠" : t === "B" ? "🟡" : t === "C" ? "🔵" : "⚪";
const methodLabel = (id: string) => {
  const map: Record<string, string> = {
    "http-flood":     "HTTP Flood",
    "http-bypass":    "HTTP Bypass",
    "http2-flood":    "HTTP/2 Rapid Reset",
    "waf-bypass":     "Geass WAF Bypass ∞",
    "conn-flood":     "TLS Connection Flood",
    "slowloris":      "Slowloris",
    "rudy":           "R.U.D.Y",
    "syn-flood":      "SYN Flood",
    "tcp-flood":      "TCP Flood",
    "udp-flood":      "UDP Flood",
    "udp-bypass":     "UDP Bypass",
    "dns-amp":        "DNS Amplification",
    "ntp-amp":        "NTP Amplification",
    "mem-amp":        "Memcached Amp",
    "geass-override": "Geass Override ∞",
  };
  return map[id] ?? id;
};
const footer = (extra?: string) => ({
  text: [AUTHOR, extra].filter(Boolean).join(" • "),
});
const progressBar = (startedAt: string, durationSec: number) => {
  const dur    = durationSec * 1000;
  const spent  = Date.now() - new Date(startedAt).getTime();
  const pct    = Math.min(1, spent / dur);
  const filled = Math.round(pct * 18);
  return `\`[${"█".repeat(filled)}${"░".repeat(18 - filled)}]\` ${Math.round(pct * 100)}%`;
};

// ── Attack Running/Live Embed ─────────────────────────────────────────────────
// pps = calculated externally (delta packetsSent / 5s interval)
export function buildAttackEmbed(attack: Attack, livePps = 0): EmbedBuilder {
  const isRunning = attack.status === "running";
  const color     = isRunning ? COLORS.CRIMSON
    : attack.status === "finished" ? COLORS.GREEN
    : COLORS.GRAY;
  const emoji     = METHOD_EMOJIS[attack.method] ?? "⚡";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${isRunning ? "GEASS COMMAND ACTIVE" : `ATTACK ${attack.status.toUpperCase()}`}`)
    .setDescription(
      isRunning
        ? `**Target is ${attack.method === "waf-bypass" ? "under WAF Bypass" : "under fire"}** — live monitoring active`
        : `Attack **#${attack.id}** has **${attack.status}**.`
    )
    .addFields(
      { name: "🎯 Target",   value: `\`${attack.target}\``,                   inline: true },
      { name: "⚔️ Method",   value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: "🆔 ID",       value: `\`#${attack.id}\``,                       inline: true },
      { name: "🧵 Threads",  value: `**${fmtNum(attack.threads)}**`,            inline: true },
      { name: "⏱ Duration",  value: `**${attack.duration}s**`,                 inline: true },
      { name: "📊 Status",   value: statusIcon(attack.status),                  inline: true },
    );

  embed.addFields({ name: "\u200b", value: "━━━━━━━━━━ 📡 **METRICS** ━━━━━━━━━━", inline: false });

  if (isRunning) {
    embed.addFields(
      { name: "📈 Live Rate",    value: `**${fmtPps(livePps)}**`,                     inline: true },
      { name: "📦 Packets Sent", value: `**${fmtNum(attack.packetsSent)}**`,           inline: true },
      { name: "💾 Data Sent",    value: `**${fmtBytes(attack.bytesSent)}**`,           inline: true },
      { name: "⏳ Elapsed",      value: `**${elapsed(attack.startedAt)}**`,            inline: true },
      { name: "\u200b",          value: progressBar(attack.startedAt, attack.duration), inline: false },
    );
  } else {
    embed.addFields(
      { name: "📦 Total Packets",  value: `**${fmtNum(attack.packetsSent)}**`,   inline: true },
      { name: "💾 Total Data",     value: `**${fmtBytes(attack.bytesSent)}**`,   inline: true },
      { name: "⏳ Duration",       value: `**${elapsed(attack.startedAt)}**`,    inline: true },
    );
  }

  embed.setFooter(footer(`Attack #${attack.id}`)).setTimestamp();
  return embed;
}

// ── Attack Started Embed ──────────────────────────────────────────────────────
export function buildStartEmbed(attack: Attack): EmbedBuilder {
  const emoji = METHOD_EMOJIS[attack.method] ?? "⚡";
  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(`${emoji} GEASS COMMAND ISSUED`)
    .setDescription(
      `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**`
    )
    .addFields(
      { name: "🎯 Target",    value: `\`${attack.target}\``,                       inline: true },
      { name: "⚔️ Method",    value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: "🆔 Attack ID", value: `\`#${attack.id}\``,                          inline: true },
      { name: "🧵 Threads",   value: `**${fmtNum(attack.threads)}**`,              inline: true },
      { name: "⏱ Duration",   value: `**${attack.duration}s**`,                    inline: true },
      { name: "📊 Status",    value: "🔴 **INITIALIZING...**",                     inline: true },
      { name: "\u200b", value: "*Metrics will update every 5 seconds automatically.*", inline: false },
    )
    .setFooter(footer("Started by slash command"))
    .setTimestamp();
}

// ── Stop Embed ────────────────────────────────────────────────────────────────
export function buildStopEmbed(id: number, ok: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ok ? COLORS.GREEN : COLORS.RED)
    .setTitle(ok ? "⏹️ ATTACK TERMINATED" : "❌ STOP FAILED")
    .setDescription(
      ok
        ? `Attack **#${id}** has been stopped by Geass command.`
        : `Could not stop attack **#${id}**. It may have already ended.`
    )
    .setFooter(footer())
    .setTimestamp();
}

// ── Attack List Embed ─────────────────────────────────────────────────────────
export function buildListEmbed(attacks: Attack[]): EmbedBuilder {
  const running   = attacks.filter(a => a.status === "running");
  const completed = attacks.filter(a => a.status !== "running").slice(0, 8);

  const embed = new EmbedBuilder()
    .setColor(running.length > 0 ? COLORS.CRIMSON : COLORS.GOLD)
    .setTitle("👁️ GEASS ATTACK REGISTRY")
    .setDescription(
      running.length > 0
        ? `**${running.length} attack${running.length > 1 ? "s" : ""} currently active**`
        : "No active attacks at this time."
    );

  if (running.length > 0) {
    embed.addFields({
      name: "🔴 ACTIVE ATTACKS",
      value: running.map(a => {
        const e = METHOD_EMOJIS[a.method] ?? "⚡";
        return `\`#${a.id}\` ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtNum(a.packetsSent)} pkts | ⏳ ${elapsed(a.startedAt)}`;
      }).join("\n"),
      inline: false,
    });
  }

  if (completed.length > 0) {
    embed.addFields({
      name: "📋 RECENT HISTORY",
      value: completed.map(a => {
        const icon = a.status === "finished" ? "✅" : a.status === "stopped" ? "⏹️" : "❌";
        const e    = METHOD_EMOJIS[a.method] ?? "⚡";
        return `\`#${a.id}\` ${icon} ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtNum(a.packetsSent)} pkts | ${fmtBytes(a.bytesSent)}`;
      }).join("\n"),
      inline: false,
    });
  }

  if (attacks.length === 0) {
    embed.addFields({ name: "No attacks found", value: "Use `/attack start` to launch a Geass command.", inline: false });
  }

  embed.setFooter(footer(`${attacks.length} total entries`)).setTimestamp();
  return embed;
}

// ── Stats Embed ───────────────────────────────────────────────────────────────
export function buildStatsEmbed(stats: AttackStats): EmbedBuilder {
  const mkBar = (val: number, max: number) => {
    const pct    = max === 0 ? 0 : Math.min(1, val / max);
    const filled = Math.round(pct * 15);
    return `\`[${"█".repeat(filled)}${"░".repeat(15 - filled)}]\``;
  };

  const topMethods = [...stats.attacksByMethod]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle("📊 GEASS COMMAND CENTER — GLOBAL STATISTICS")
    .setDescription("Aggregate metrics across all attacks recorded in this session.")
    .addFields(
      {
        name: "🔴 Active / Total",
        value: `**${fmtNum(stats.runningAttacks)} running** / **${fmtNum(stats.totalAttacks)} total**\n${mkBar(stats.runningAttacks, Math.max(stats.totalAttacks, 1))}`,
        inline: false,
      },
      { name: "📦 Total Packets",   value: `**${fmtNum(stats.totalPacketsSent)}**`,   inline: true },
      { name: "💾 Total Data Sent", value: `**${fmtBytes(stats.totalBytesSent)}**`,   inline: true },
      { name: "💻 CPU Cores",       value: `**${stats.cpuCount ?? "N/A"}**`,          inline: true },
    );

  if (topMethods.length > 0) {
    embed.addFields({
      name: "🏆 Top Methods",
      value: topMethods.map((m, i) => {
        const emoji = METHOD_EMOJIS[m.method] ?? "⚡";
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        return `${medal} ${emoji} **${methodLabel(m.method)}** — ${m.count} attacks`;
      }).join("\n"),
      inline: false,
    });
  }

  embed.setFooter(footer()).setTimestamp();
  return embed;
}

// ── Analyze Embed ─────────────────────────────────────────────────────────────
export function buildAnalyzeEmbed(result: AnalyzeResult): EmbedBuilder {
  const top6 = [...result.recommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const serverDisplay = !result.serverType || result.serverType === "unknown" ? "Unknown" : result.serverType;
  const cdnDisplay    = result.isCDN ? `✅ **${result.cdnProvider}**` : "❌ None detected";

  const recoLines = top6.length > 0
    ? top6.map((r, i) => {
        const icon  = tierIcon(r.tier);
        const emoji = METHOD_EMOJIS[r.method] ?? "⚡";
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `  ${i + 1}.`;
        return `${medal} ${icon} \`[${r.score}]\` ${emoji} **${r.name}** — ${r.suggestedThreads}t × ${r.suggestedDuration}s`;
      }).join("\n")
    : "No recommendations available.";

  const topRec = top6[0];

  const embed = new EmbedBuilder()
    .setColor(result.isCDN ? COLORS.ORANGE : COLORS.TEAL)
    .setTitle(`🔍 TARGET RECON: \`${result.target}\``)
    .setDescription(
      result.hasDNS
        ? `✅ Target analyzed successfully.\n${result.isCDN ? `⚠️ **${result.cdnProvider}** detected — use WAF bypass for best results.` : "Direct server — no CDN detected."}`
        : "❌ **DNS resolution failed.** Target may be offline or invalid."
    )
    .addFields(
      { name: "🌐 HTTP",     value: result.httpAvailable  ? "✅ Available"          : "❌ Offline",         inline: true },
      { name: "🔒 HTTPS",    value: result.httpsAvailable ? "✅ Available"          : "❌ Offline",         inline: true },
      { name: "⚡ Response",  value: result.responseTimeMs > 0 ? `**${result.responseTimeMs}ms**` : "N/A", inline: true },
      { name: "🖥️ Server",   value: `**${serverDisplay}**`,                                               inline: true },
      { name: "🛡️ CDN/WAF",  value: cdnDisplay,                                                           inline: true },
      { name: "📡 DNS",      value: result.hasDNS ? "✅ Resolved" : "❌ Failed",                           inline: true },
      { name: "\u200b", value: "━━━━━━━━━━ 🎯 **VULNERABILITY REPORT** ━━━━━━━━━━", inline: false },
      { name: `Top ${top6.length} Vectors (sorted by effectiveness)`, value: recoLines, inline: false },
    );

  if (topRec) {
    embed.addFields({
      name: "💡 Quick Attack Command",
      value: `\`\`\`\n/attack start target:${result.target} method:${topRec.method} threads:${topRec.suggestedThreads} duration:${topRec.suggestedDuration}\n\`\`\``,
      inline: false,
    });
  }

  embed.setFooter(footer(`${result.recommendations.length} vectors analyzed`)).setTimestamp();
  return embed;
}

// ── Methods Embed ─────────────────────────────────────────────────────────────
export function buildMethodsEmbed(methods: Method[], layerFilter?: string): EmbedBuilder {
  const filtered = layerFilter
    ? methods.filter(m => m.layer.toLowerCase() === layerFilter.toLowerCase())
    : methods;

  const byLayer: Record<string, Method[]> = {};
  for (const m of filtered) {
    (byLayer[m.layer] ??= []).push(m);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle("⚔️ GEASS ARSENAL — ATTACK METHODS")
    .setDescription(`**${filtered.length}** attack vectors available${layerFilter ? ` (filtered: **${layerFilter}**)` : ""}`);

  for (const [layer, ms] of Object.entries(byLayer).sort(([a], [b]) => a.localeCompare(b))) {
    const layerEmoji = layer === "L7" ? "🌐" : layer === "L4" ? "🔌" : "📡";
    embed.addFields({
      name: `${layerEmoji} ${layer} — ${layer === "L7" ? "Application" : layer === "L4" ? "Transport" : "Network"} Layer (${ms.length})`,
      value: ms.map(m => {
        const emoji = METHOD_EMOJIS[m.id] ?? "⚡";
        return `${emoji} **\`${m.id}\`** — ${m.name} \`[${m.protocol}]\``;
      }).join("\n"),
      inline: false,
    });
  }

  embed.setFooter(footer("Use /attack start method:<id>")).setTimestamp();
  return embed;
}

// ── Help Embed ────────────────────────────────────────────────────────────────
export function buildHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle("👁️ LELOUCH BRITANNIA — COMMAND CENTER")
    .setDescription(
      `> *"I am Zero — the man who will obliterate the world."*\n\nWelcome to the **${BOT_NAME}** network control interface.\nAll commands are slash commands — type \`/\` to browse them.`
    )
    .addFields(
      { name: "⚔️ `/attack start <target> [method] [threads] [duration]`", value: "Launch a new attack. Method defaults to `http-flood`, 200 threads, 60s.", inline: false },
      { name: "⏹️ `/attack stop <id>`",  value: "Stop a running attack by its ID number.",    inline: false },
      { name: "📋 `/attack list`",         value: "View all active and recent attacks.",         inline: false },
      { name: "📊 `/attack stats`",        value: "Show global aggregate statistics.",           inline: false },
      { name: "🔍 `/analyze <target>`",    value: "Scan a target and get ranked recommendations for best attack vectors.", inline: false },
      { name: "⚡ `/methods [layer]`",     value: "List all attack vectors. Filter by `L7`, `L4`, or `L3`.", inline: false },
      { name: "❓ `/help`",               value: "Show this help message.",                     inline: false },
      { name: "\u200b",                    value: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", inline: false },
      {
        name: "💡 Tips",
        value: [
          "• Run `/analyze <target>` first to find the best attack vector",
          "• Use `waf-bypass` for Cloudflare/Akamai protected targets",
          "• The ⏹️ **Stop** button appears on every attack embed",
          "• Active attacks auto-update every 5 seconds",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter(footer())
    .setTimestamp();
}

// ── Error Embed ───────────────────────────────────────────────────────────────
export function buildErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.RED)
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setFooter(footer())
    .setTimestamp();
}
