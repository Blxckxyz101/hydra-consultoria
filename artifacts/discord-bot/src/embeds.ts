import { EmbedBuilder, AttachmentBuilder } from "discord.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Attack, AttackStats, AnalyzeResult, Method } from "./api.js";
import { COLORS, METHOD_EMOJIS, AUTHOR, BOT_NAME } from "./config.js";

// ── Asset paths ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEASS_PNG = path.join(__dirname, "..", "assets", "geass-symbol.png");
const LELOUCH_GIF = path.join(__dirname, "..", "assets", "lelouch.gif");

/** Returns attachment files for embeds that include the Geass symbol.
 *  Use in { embeds: [...], files: buildGeassFiles() } on one-shot sends (not edits). */
export function buildGeassFiles(): AttachmentBuilder[] {
  return [new AttachmentBuilder(GEASS_PNG, { name: "geass-symbol.png" })];
}
/** Returns both the Geass symbol + Lelouch GIF (for start/attack embeds). */
export function buildAttackFiles(): AttachmentBuilder[] {
  return [
    new AttachmentBuilder(LELOUCH_GIF,  { name: "lelouch.gif" }),
    new AttachmentBuilder(GEASS_PNG,    { name: "geass-symbol.png" }),
  ];
}

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
    "http-flood":          "HTTP Flood",
    "http-bypass":         "HTTP Bypass",
    "http2-flood":         "HTTP/2 Rapid Reset",
    "http2-continuation":  "H2 CONTINUATION (CVE-2024-27316)",
    "waf-bypass":          "Geass WAF Bypass ∞",
    "conn-flood":          "TLS Connection Flood",
    "slowloris":           "Slowloris",
    "tls-renego":          "TLS Renegotiation DoS",
    "ws-flood":            "WebSocket Exhaustion",
    "graphql-dos":         "GraphQL Introspection DoS",
    "quic-flood":          "QUIC / HTTP3 Flood (RFC 9000)",
    "cache-poison":        "CDN Cache Poisoning DoS",
    "rudy-v2":             "RUDY v2 — Multipart Slow POST",
    "ssl-death":           "SSL Death Record",
    "rudy":                "R.U.D.Y",
    "syn-flood":           "SYN Flood",
    "tcp-flood":           "TCP Flood",
    "udp-flood":           "UDP Flood",
    "udp-bypass":          "UDP Bypass",
    "dns-amp":             "DNS Amplification",
    "ntp-amp":             "NTP Amplification",
    "mem-amp":             "Memcached Amp",
    "hpack-bomb":          "HPACK Bomb — RFC 7541 Table Exhaustion",
    "h2-settings-storm":   "H2 Settings Storm — HPACK + Flow Control Exhaustion",
    "geass-override":      "Geass Override ∞ [ARES OMNIVECT — 21 VECTORS]",
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

// ── Target probe result (fed from index.ts polling) ──────────────────────────
export type ProbeResult = {
  up:        boolean;
  latencyMs: number;
  reason?:   string;
};

// Connection-based methods that show open conn counter
const CONN_METHODS = new Set(["slowloris", "conn-flood", "geass-override", "rudy", "rudy-v2", "ws-flood", "tls-renego", "http2-continuation", "ssl-death"]);

// ── Sparkline helpers ─────────────────────────────────────────────────────────
// Definitive DOWN reasons = server actively refused or DNS gone
// (NOT timeouts/resets/inconclusive which can be OUR network under load during attack)
const DEFINITIVE_DOWN = (reason?: string) => {
  if (!reason) return false;
  return reason.includes("refused") || reason.includes("DNS resolution failed");
};

const sparkDot = (p: ProbeResult) => {
  if (!p.up && DEFINITIVE_DOWN(p.reason)) return "🔴"; // confirmed server crash/refusal
  if (!p.up) return "🟠";                              // probe failed but inconclusive
  if (p.latencyMs > 5000) return "🟡";                 // probe timed out or inconclusive (our net busy)
  if (p.latencyMs > 4000) return "🟡";
  if (p.latencyMs > 1500) return "🟠";
  return "🟢";
};

const buildStatusField = (history: ProbeResult[], method: string) => {
  if (history.length === 0) return { name: "🌐 Target Status", value: "_probing..._" };
  const last     = history[history.length - 1];
  const dots     = history.slice(-20).map(sparkDot).join("");
  // 5 consecutive definitive DOWNs = confirmed down (ignore probe inconclusive)
  const recent5  = history.slice(-5);
  const downRun  = recent5.length >= 5 && recent5.every(p => !p.up && DEFINITIVE_DOWN(p.reason));
  const anyDown3 = history.slice(-3).filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length >= 3;

  let statusLine: string;
  if (!last.up && DEFINITIVE_DOWN(last.reason) && (downRun || anyDown3)) {
    // Target confirmed DOWN — server actively refusing connections
    const causeMap: Record<string, string> = {
      "geass-override":     "All 21 ARES vectors converged — ABSOLUTE ANNIHILATION (OMNIVECT)",
      "http2-flood":        "H2 connection table saturated (CVE-2023-44487)",
      "http2-continuation": "Header reassembly buffer exhausted (CVE-2024-27316) — OOM",
      "waf-bypass":         "WAF layer overwhelmed — origin exposed",
      "conn-flood":         "TLS socket table exhausted — nginx fell",
      "slowloris":          "Thread pool saturated — server frozen",
      "tls-renego":         "TLS CPU exhausted — handshake queue overflowed",
      "ws-flood":           "WebSocket goroutine pool drained — server unresponsive",
      "graphql-dos":        "GraphQL resolver CPU limit hit — exponential query collapse",
      "quic-flood":         "QUIC DCID table exhausted — HTTP/3 crypto state OOM",
      "cache-poison":       "CDN cache poisoned — 100% origin miss, server crushed",
      "rudy-v2":            "Multipart buffer exhausted — server thread pool frozen",
      "ssl-death":          "TLS crypto thread pool saturated — AES-GCM queue overflowed",
      "udp-flood":          "Bandwidth saturated at L4",
    };
    const methodCause = causeMap[method] ?? "Server resources exhausted";
    const probeCause  = last.reason ?? methodCause;
    statusLine = `**💀 TARGET DOWN** — ${probeCause}`;
  } else if (!last.up && DEFINITIVE_DOWN(last.reason)) {
    statusLine = `**🔴 FAILING** — ${last.reason} (${last.latencyMs}ms) — confirming…`;
  } else if (last.latencyMs > 5000) {
    // Probe inconclusive or very slow — network under attack load
    statusLine = `**🟠 UNCONFIRMED** — probe slow (${last.latencyMs}ms) — possible stress or probe saturated`;
  } else if (last.latencyMs > 4000) {
    statusLine = `**🟡 CRITICAL LAG** — ${last.latencyMs}ms (on the edge)`;
  } else if (last.latencyMs > 1500) {
    statusLine = `**🟠 UNDER STRESS** — ${last.latencyMs}ms (rising)`;
  } else {
    statusLine = `**🟢 ONLINE** — ${last.latencyMs}ms (resisting so far)`;
  }

  return {
    name:   "🌐 Target Status",
    value:  `${dots}\n${statusLine}`,
    inline: false,
  };
};

// ── Attack Running/Live Embed ─────────────────────────────────────────────────
// pps = calculated externally (delta packetsSent / 5s interval)
// liveConns = from /api/attacks/:id/live endpoint (active open connections)
export function buildAttackEmbed(
  attack: Attack,
  livePps = 0,
  liveConns = 0,
  targetHistory: ProbeResult[] = [],
): EmbedBuilder {
  const isRunning = attack.status === "running";
  const color     = isRunning ? COLORS.CRIMSON
    : attack.status === "finished" ? COLORS.GREEN
    : COLORS.GRAY;
  const emoji     = METHOD_EMOJIS[attack.method] ?? "⚡";
  const showConns = CONN_METHODS.has(attack.method);

  const connBar = (conns: number) => {
    // Visual bar showing connection density (max display = 10K)
    const pct    = Math.min(1, conns / 10000);
    const filled = Math.round(pct * 12);
    const bar    = `${"▓".repeat(filled)}${"░".repeat(12 - filled)}`;
    return `\`[${bar}]\` ${conns >= 1000 ? `**${(conns/1000).toFixed(1)}K**` : `**${conns}**`} holding`;
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${isRunning ? "GEASS COMMAND ACTIVE" : `ATTACK ${attack.status.toUpperCase()}`}`)
    .setDescription(
      isRunning
        ? attack.method === "geass-override"
          ? `👁️ **ARES OMNIVECT** — 21 simultaneous real attack vectors, all CVEs active, live monitoring`
          : `**Target is ${attack.method === "waf-bypass" ? "under WAF Bypass" : "under fire"}** — live monitoring active`
        : `Attack **#${attack.id}** has **${attack.status}**.`
    )
    .addFields(
      { name: "🎯 Target",   value: `\`${attack.target}\``,                       inline: true },
      { name: "⚔️ Method",   value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: "🆔 ID",       value: `\`#${attack.id}\``,                          inline: true },
      { name: "🧵 Threads",  value: `**${fmtNum(attack.threads)}**`,               inline: true },
      { name: "⏱ Duration",  value: `**${attack.duration}s**`,                    inline: true },
      { name: "📊 Status",   value: statusIcon(attack.status),                     inline: true },
    );

  embed.addFields({ name: "\u200b", value: "━━━━━━━━━━ 📡 **METRICS** ━━━━━━━━━━", inline: false });

  if (isRunning) {
    embed.addFields(
      { name: "📈 Live Rate",    value: `**${fmtPps(livePps)}**`,                       inline: true },
      { name: "📦 Packets Sent", value: `**${fmtNum(attack.packetsSent)}**`,             inline: true },
      { name: "💾 Data Sent",    value: `**${fmtBytes(attack.bytesSent)}**`,             inline: true },
      { name: "⏳ Elapsed",      value: `**${elapsed(attack.startedAt)}**`,              inline: true },
    );
    if (showConns) {
      embed.addFields({
        name:    "🔗 Open Connections",
        value:   liveConns > 0 ? connBar(liveConns) : "_ramping up..._",
        inline:  true,
      });
    }
    embed.addFields({ name: "\u200b", value: progressBar(attack.startedAt, attack.duration), inline: false });
    // Target status sparkline — only shown during active attack
    embed.addFields(buildStatusField(targetHistory, attack.method));
  } else {
    embed.addFields(
      { name: "📦 Total Packets",  value: `**${fmtNum(attack.packetsSent)}**`,   inline: true },
      { name: "💾 Total Data",     value: `**${fmtBytes(attack.bytesSent)}**`,   inline: true },
      { name: "⏳ Elapsed",        value: `**${elapsed(attack.startedAt)}**`,    inline: true },
    );
    // Show final target status if we have probe history
    if (targetHistory.length > 0) {
      embed.addFields(buildStatusField(targetHistory, attack.method));
    }
  }

  embed.setFooter(footer(`Attack #${attack.id}`)).setTimestamp();
  return embed;
}

// ── Attack Started Embed ──────────────────────────────────────────────────────
export function buildStartEmbed(attack: Attack): EmbedBuilder {
  const emoji = METHOD_EMOJIS[attack.method] ?? "⚡";
  const isGeass = attack.method === "geass-override";
  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(`${emoji} GEASS COMMAND ISSUED`)
    .setDescription(
      isGeass
        ? `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**\n\n👁️ **ARES OMNIVECT** — 21 real attack vectors deploying simultaneously`
        : `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**`
    )
    .setImage("attachment://lelouch.gif")
    .setThumbnail("attachment://geass-symbol.png")
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
      name: "💡 Quick Attack",
      value: `Run \`/attack start target:${result.target}\` — select **${methodLabel(topRec.method)}** from the dropdown, set threads to **${topRec.suggestedThreads}** and duration to **${topRec.suggestedDuration}s**.`,
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

  embed.setFooter(footer("Use /attack start <target> to launch")).setTimestamp();
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
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      { name: "⚔️ `/attack start <target>`", value: "Launch attack — opens a **dropdown menu** to pick method, duration & threads.", inline: false },
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

// ── Cluster Status Embed ──────────────────────────────────────────────────────
export function buildClusterEmbed(status: {
  self:            { url: string; online: boolean; latencyMs: number; cpus: number; freeMem: number };
  nodes:           { url: string; online: boolean; latencyMs: number; cpus?: number; freeMem?: number }[];
  totalOnline:     number;
  configuredNodes: number;
}): EmbedBuilder {
  const { self, nodes, totalOnline, configuredNodes } = status;
  const allNodes = [{ ...self, url: "📍 This node (primary)" }, ...nodes];
  const onlineCount = nodes.filter(n => n.online).length;

  const nodeLines = allNodes.map((n, i) => {
    const dot     = i === 0 ? "🟢" : n.online ? "🟢" : "🔴";
    const lat     = n.latencyMs >= 0 ? `${n.latencyMs}ms` : "timeout";
    const cpuStr  = n.cpus ? ` | ${n.cpus}vCPU` : "";
    const memStr  = n.freeMem ? ` | ${n.freeMem}MB free` : "";
    const label   = i === 0 ? n.url : `Node ${i}: \`${n.url}\``;
    return `${dot} ${label} — **${lat}**${cpuStr}${memStr}`;
  });

  return new EmbedBuilder()
    .setColor(totalOnline >= configuredNodes + 1 ? COLORS.GREEN : totalOnline > 1 ? COLORS.GOLD : COLORS.RED)
    .setTitle(`🌐 CLUSTER STATUS — ${totalOnline} / ${configuredNodes + 1} NODES ONLINE`)
    .setDescription(
      configuredNodes === 0
        ? `> No peer nodes configured. Set \`CLUSTER_NODES\` environment variable.\n> e.g. \`CLUSTER_NODES=https://node2.replit.app,https://node3.replit.app\``
        : `> *"The king's command reaches all corners of the realm."*\n\n` +
          nodeLines.join("\n")
    )
    .addFields(
      { name: "🟢 Online",      value: `**${totalOnline}** node${totalOnline !== 1 ? "s" : ""}`, inline: true },
      { name: "🔴 Offline",     value: `**${configuredNodes - onlineCount}** node${(configuredNodes - onlineCount) !== 1 ? "s" : ""}`, inline: true },
      { name: "⚡ Geass Power", value: `**${totalOnline}×** multiplier`, inline: true },
      { name: "💻 Primary CPU",  value: `${self.cpus} vCPU`, inline: true },
      { name: "💾 Primary RAM",  value: `${self.freeMem} MB free`, inline: true },
      { name: "👁️ Geass Override", value: configuredNodes > 0
          ? `When Geass Override fires, it **automatically fans out** to all ${configuredNodes} configured peer nodes. Each node runs all 21 ARES vectors simultaneously.`
          : "Set `CLUSTER_NODES` to enable automatic fan-out.", inline: false },
    )
    .setThumbnail("attachment://geass-symbol.png")
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
