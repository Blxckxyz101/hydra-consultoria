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
    "geass-override":      "Geass Override ∞ [ARES OMNIVECT — 30 VECTORS]",
  };
  return map[id] ?? id;
};
const footer = (extra?: string) => ({
  text: [AUTHOR, extra].filter(Boolean).join(" • "),
});
const progressBar = (startedAt: string, durationSec: number) => {
  const dur    = durationSec * 1000;
  const spent  = Date.now() - new Date(startedAt).getTime();
  const raw    = dur > 0 ? spent / dur : 0;
  // Guard against NaN/Infinity — would cause "█".repeat(NaN) → RangeError
  const pct    = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
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
// Definitive DOWN = server actively refused connections (ECONNREFUSED from TARGET's TCP stack)
// ENOTFOUND is excluded: DNS Water Torture can poison OUR system resolver → false positive
// Timeouts/resets/inconclusive = NOT confirmed down (our network may be saturated by attack)
const DEFINITIVE_DOWN = (reason?: string) => {
  if (!reason) return false;
  // Only trust ECONNREFUSED — TCP port actively rejected = server process crashed/stopped
  // NOT ENOTFOUND: during DNS Water Torture, OUR resolver can fail → false "site down" report
  return reason.includes("refused");
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

  // Require 5 consecutive confirmed DOWNs (ECONNREFUSED) before declaring "TARGET DOWN".
  // Previously was 3, which produced false positives when the attack saturated our own NIC/DNS.
  // ECONNREFUSED = TCP port actively rejected by target's kernel — this cannot be a false positive
  // from our side. But we still want 5+ to avoid declaring down on a CDN edge flap.
  const recent8  = history.slice(-8);
  const downRun5 = recent8.filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length >= 5;

  let statusLine: string;
  if (!last.up && DEFINITIVE_DOWN(last.reason) && downRun5) {
    // Target confirmed DOWN — server actively refusing connections
    const causeMap: Record<string, string> = {
      "geass-override":     "All 23 ARES vectors converged — ABSOLUTE ANNIHILATION (OMNIVECT)",
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
      "syn-flood":          "TCP connection table exhausted — SYN_RECV backlog full",
      "http-bypass":        "Proxy bypass overwhelmed origin — WAF bypassed",
    };
    const methodCause = causeMap[method] ?? "Server resources exhausted";
    const probeCause  = last.reason?.includes("refused") ? methodCause : (last.reason ?? methodCause);
    statusLine = `**💀 TARGET DOWN** — ${probeCause}`;
  } else if (!last.up && DEFINITIVE_DOWN(last.reason)) {
    // 1–4 consecutive ECONNREFUSED — confirming, not yet declared down
    const downCount = recent8.filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length;
    statusLine = `**🔴 REFUSING** — TCP port rejected (${downCount}/5 confirms) — verifying…`;
  } else if (!last.up) {
    // Probe failed but not ECONNREFUSED (timeout, reset, DNS fail on our side)
    statusLine = `**🟠 UNREACHABLE** — probe failed (${last.reason ?? "network error"}) — may be our network`;
  } else if (last.latencyMs > 5000) {
    // Probe inconclusive or very slow — likely network under attack load on our side
    statusLine = `**🟡 DEGRADED** — ${last.latencyMs}ms (heavy load — site may be UP for users)`;
  } else if (last.latencyMs > 4000) {
    statusLine = `**🟠 CRITICAL LAG** — ${last.latencyMs}ms (near collapse)`;
  } else if (last.latencyMs > 1500) {
    statusLine = `**🟠 UNDER STRESS** — ${last.latencyMs}ms (response degrading)`;
  } else if (last.latencyMs > 800) {
    statusLine = `**🟡 SLOWING** — ${last.latencyMs}ms (attack taking effect)`;
  } else {
    statusLine = `**🟢 ONLINE** — ${last.latencyMs}ms (resisting attack)`;
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
          ? `👁️ **ARES OMNIVECT ∞** — 30 simultaneous real attack vectors, all CVEs active, live monitoring`
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
        ? `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**\n\n👁️ **ARES OMNIVECT ∞** — 30 real attack vectors deploying simultaneously`
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
      { name: "\u200b", value: "*Metrics will update every 8 seconds automatically.*", inline: false },
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

  const serverDisplay = result.serverLabel && result.serverLabel !== "Unknown"
    ? result.serverLabel
    : result.serverType && result.serverType !== "unknown"
      ? result.serverType
      : "Unknown";

  // CDN / WAF line
  let shieldLine: string;
  if (result.isCDN && result.hasWAF) {
    shieldLine = `⚠️ **${result.cdnProvider}** + **${result.wafProvider}**`;
  } else if (result.isCDN) {
    shieldLine = `✅ CDN: **${result.cdnProvider}**`;
  } else if (result.hasWAF) {
    shieldLine = `🛡️ WAF: **${result.wafProvider}**`;
  } else {
    shieldLine = "❌ None detected";
  }

  // HTTP version support
  const h2h3Parts: string[] = [];
  if (result.supportsH2) h2h3Parts.push("**H/2**");
  if (result.supportsH3) h2h3Parts.push("**H/3**");
  const protocolLine = h2h3Parts.length > 0 ? `✅ ${h2h3Parts.join(" + ")}` : "HTTP/1.1 only";

  // Features line (GraphQL, WebSocket, HSTS)
  const featureParts: string[] = [];
  if (result.hasGraphQL)  featureParts.push("GraphQL");
  if (result.hasWebSocket) featureParts.push("WebSocket");
  if (result.hasHSTS)      featureParts.push(`HSTS${result.hstsMaxAge ? ` (${Math.round(result.hstsMaxAge / 86400)}d)` : ""}`);
  const featuresLine = featureParts.length > 0 ? featureParts.join(", ") : "None detected";

  // Open ports
  const portsLine = result.openPorts.length > 0
    ? result.openPorts.map(p => `\`${p}\``).join(" ")
    : "None scanned";

  // All IPs
  const ipsLine = result.allIPs?.length > 0
    ? result.allIPs.slice(0, 5).join(", ") + (result.allIPs.length > 5 ? ` +${result.allIPs.length - 5} more` : "")
    : result.ip ?? "Unknown";

  const recoLines = top6.length > 0
    ? top6.map((r, i) => {
        const icon  = tierIcon(r.tier);
        const emoji = METHOD_EMOJIS[r.method] ?? "⚡";
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `  ${i + 1}.`;
        return `${medal} ${icon} \`[${r.score}]\` ${emoji} **${r.name}** — ${r.suggestedThreads}t × ${r.suggestedDuration}s`;
      }).join("\n")
    : "No recommendations available.";

  const topRec = top6[0];

  const color = result.isCDN && result.hasWAF ? COLORS.RED
    : result.isCDN ? COLORS.ORANGE
    : result.hasWAF ? COLORS.CRIMSON
    : COLORS.TEAL;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🔍 TARGET RECON: \`${result.target}\``)
    .setDescription(
      result.hasDNS
        ? `✅ Target analyzed — **${result.recommendations.length}** attack vectors scored.\n${
            result.isCDN && result.hasWAF ? `🔴 **${result.cdnProvider}** + **${result.wafProvider}** detected — heavily shielded.` :
            result.isCDN ? `⚠️ **${result.cdnProvider}** CDN detected — DNS Water Torture bypasses it.` :
            result.hasWAF ? `⚠️ **${result.wafProvider}** detected — use HTTP Bypass or Pipeline vectors.` :
            "✅ Direct server — no CDN/WAF detected. All vectors viable."
          }`
        : "❌ **DNS resolution failed.** Target may be offline or the domain is invalid."
    )
    .addFields(
      { name: "🌐 HTTP",      value: result.httpAvailable  ? "✅ Online" : "❌ Offline",                  inline: true },
      { name: "🔒 HTTPS",     value: result.httpsAvailable ? "✅ Online" : "❌ Offline",                  inline: true },
      { name: "⚡ Response",   value: result.responseTimeMs > 0 ? `**${result.responseTimeMs}ms**` : "N/A", inline: true },
      { name: "🖥️ Server",    value: `**${serverDisplay}**`,                                              inline: true },
      { name: "🛡️ CDN/WAF",   value: shieldLine,                                                         inline: true },
      { name: "📡 Protocol",   value: protocolLine,                                                        inline: true },
      { name: "🔬 Features",   value: featuresLine,                                                        inline: true },
      { name: "🔌 Open Ports", value: portsLine,                                                           inline: true },
      { name: "🌍 IP(s)",      value: ipsLine,                                                             inline: true },
      ...(result.originIP ? [{
        name:   "🎯 Origin IP Found!",
        value:  `\`${result.originIP}\`${result.originSubdomain ? ` via \`${result.originSubdomain}\`` : " (SPF record)"} — **bypass CDN directly!**`,
        inline: false,
      }] : []),
      { name: "\u200b", value: "━━━━━━━━━━ 🎯 **VULNERABILITY REPORT** ━━━━━━━━━━", inline: false },
      { name: `Top ${top6.length} Vectors (sorted by effectiveness)`, value: recoLines, inline: false },
    );

  if (topRec) {
    embed.addFields({
      name: "💡 Quick Attack",
      value: `\`/attack start target:${result.target}\` → **${methodLabel(topRec.method)}** | threads: **${topRec.suggestedThreads}** | duration: **${topRec.suggestedDuration}s**`,
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
      { name: "⚡ `/methods [layer]`",          value: "List all attack vectors. Filter by `L7`, `L4`, or `L3`.",          inline: false },
      { name: "👁️ `/geass <target>`",            value: "Launch **Geass Override ∞** directly — ARES OMNIVECT ∞ 30 vectors.", inline: false },
      { name: "🌐 `/cluster status`",            value: "Check health & latency of all cluster nodes.",                       inline: false },
      { name: "🌐 `/cluster broadcast <target>`",value: "Fire Geass Override to ALL nodes simultaneously (10× power).",       inline: false },
      { name: "🤖 `/lelouch ask <message>`",     value: "Talk to **Lelouch AI** — helps with the bot, code, web systems & anything else.",  inline: false },
      { name: "🔄 `/lelouch reset`",             value: "Clear your Lelouch AI conversation history.",                        inline: false },
      { name: "ℹ️ `/info`",                      value: "Full platform info — cluster infrastructure & live stats (EN/PT).",  inline: false },
      { name: "❓ `/help`",                      value: "Show this help message.",                                            inline: false },
      { name: "\u200b",                          value: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",                         inline: false },
      {
        name: "💡 Tips",
        value: [
          "• Run `/analyze <target>` first to find the best attack vector",
          "• Use `waf-bypass` for Cloudflare/Akamai protected targets",
          "• The ⏹️ **Stop** button appears on every attack embed",
          "• Active attacks auto-update every 5 seconds",
          "• Ask `/lelouch ask` anything — it knows the entire platform",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter(footer())
    .setTimestamp();
}

// ── Info Embed ────────────────────────────────────────────────────────────────
export function buildInfoEmbed(opts: {
  guildCount:    number;
  totalAttacks:  number;
  activeAttacks: number;
  uptimeMs:      number;
  cpuCount?:     number;
  totalPackets:  number;
  totalBytes:    number;
  clusterNodes?: number;
  lang?:         "en" | "pt";
}): EmbedBuilder {
  const {
    guildCount, totalAttacks, activeAttacks, uptimeMs,
    cpuCount, totalPackets, totalBytes, clusterNodes = 0,
    lang = "en",
  } = opts;

  const pt = lang === "pt";

  const fmtUptime = (ms: number) => {
    const s   = Math.floor(ms / 1000);
    const d   = Math.floor(s / 86400);
    const h   = Math.floor((s % 86400) / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `**${d}d** ${h}h ${m}m`;
    if (h > 0) return `**${h}h** ${m}m ${sec}s`;
    return `**${m}m** ${sec}s`;
  };

  const fmtBig = (n: number) => {
    if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  const totalNodes   = 10 + clusterNodes;
  const totalVCPU    = totalNodes * 8;
  const totalRAM     = totalNodes * 32;
  const totalVectors = totalNodes * 21;

  // ── Strings ────────────────────────────────────────────────────────────────
  const T = {
    title:       pt
      ? "👁️  LELOUCH BRITANNIA  —  INTERFACE DE COMANDO GEASS"
      : "👁️  LELOUCH BRITANNIA  —  GEASS COMMAND INTERFACE",
    quote:       pt
      ? `> *"Os únicos que deveriam matar são aqueles que estão preparados para serem mortos."*\n> — **Lelouch vi Britannia**, Código R-02`
      : `> *"The only ones who should kill, are those who are prepared to be killed."*\n> — **Lelouch vi Britannia**, Code R-02`,
    desc:        pt
      ? `**Lelouch Britannia** é uma plataforma de stress-test de redes de próxima geração.\n30 vetores de ataque simultâneos (ARES OMNIVECT ∞), fan-out multi-nó em cluster, monitoramento ao vivo e C2 via Discord — tudo sob um único Comando Geass.`
      : `**Lelouch Britannia** is a next-generation network stress-testing platform.\n30 simultaneous real attack vectors (ARES OMNIVECT ∞), multi-node cluster fan-out, live probe monitoring, and Discord C2 — all under one Geass command.`,
    secEngine:   pt ? "━━━━ ⚔️  **MOTOR ARES OMNIVECT** ━━━━" : "━━━━ ⚔️  **ARES OMNIVECT ENGINE** ━━━━",
    engineTitle: pt ? "🔴 Geass Override ∞ — 30 Vetores" : "🔴 Geass Override ∞ — 30 Vectors",
    engineBox:
      "```\n" +
      (pt
        ? "  TODOS OS 30 VETORES — SIMULTÂNEOS\n"
        : "  ALL 30 VECTORS — SIMULTANEOUS\n") +
      "  ┌───────────────────────────────────────┐\n" +
      (pt
        ? "  │  L7 App     ·  12  │  L7 H2  ·   4  │\n"
        : "  │  L7 App     ·  12  │  L7 H2  ·   4  │\n") +
      (pt
        ? "  │  TLS/Crypto ·   3  │  Ext App ·  3  │\n"
        : "  │  TLS/Crypto ·   3  │  Ext App ·  3  │\n") +
      (pt
        ? "  │  L4 SYN     ·   1  │  L3 Amp  ·  5  │\n"
        : "  │  L4 SYN     ·   1  │  L3 Amp  ·  5  │\n") +
      (pt
        ? "  │  UDP/Vol    ·   2  │  TOTAL   · 30  │\n"
        : "  │  UDP/Vol    ·   2  │  TOTAL   · 30  │\n") +
      "  │  CVE-2024-27316 ·  H2 CONTINUATION   │\n" +
      "  │  CVE-2023-44487 ·  Rapid Reset        │\n" +
      "  │  RFC 9000       ·  QUIC / HTTP3       │\n" +
      "  └───────────────────────────────────────┘\n" +
      "```",
    secInfra:    pt ? "━━━━ 🖥️  **INFRAESTRUTURA DO CLUSTER** ━━━━" : "━━━━ 🖥️  **CLUSTER INFRASTRUCTURE** ━━━━",
    infraBox:
      "```\n" +
      (pt
        ? `  CLUSTER COMPUTACIONAL — ${totalNodes} MÁQUINAS\n`
        : `  COMPUTE CLUSTER — ${totalNodes} MACHINES\n`) +
      "  ┌─────────────────────────────────────────┐\n" +
      (pt
        ? `  │  Máquinas    :  ${String(totalNodes).padEnd(4)} servidores dedicados  │\n`
        : `  │  Machines    :  ${String(totalNodes).padEnd(4)} dedicated servers     │\n`) +
      `  │  vCPU/node   :  8    →  ${String(totalVCPU).padStart(3)} vCPU total    │\n` +
      `  │  RAM /node   :  32GB →  ${String(totalRAM).padStart(3)}GB  total     │\n` +
      (pt
        ? `  │  Nós cluster :  ${String(clusterNodes).padEnd(2)}  peer node(s)          │\n`
        : `  │  Cluster peer:  ${String(clusterNodes).padEnd(2)}  node(s) configured    │\n`) +
      (pt
        ? `  │  Fan-out     :  ${String(totalNodes)}× poder — Geass Override ∞  │\n`
        : `  │  Fan-out     :  ${String(totalNodes)}× power — Geass Override ∞  │\n`) +
      (pt
        ? `  │  Vetores tot.:  ${String(totalVectors)} simultâneos por disparo │\n`
        : `  │  Total vects :  ${String(totalVectors)} simultaneous per fire    │\n`) +
      "  ├─────────────────────────────────────────┤\n" +
      (pt ? "  │  CAPACIDADE DOS THREAD POOLS (por nó) │\n" : "  │  THREAD POOL CAPACITY (per node)      │\n") +
      "  │  HTTP Pipeline        →  1,200 threads  │\n" +
      "  │  HTTP/2 Rapid Reset   →    800 sessions │\n" +
      "  │  H2 CONTINUATION      →    650 threads  │\n" +
      "  │  WAF Bypass / HPACK   →    400 threads  │\n" +
      "  │  ICMP / DNS / NTP amp →    512 threads  │\n" +
      "  │  H2 Sessions × Streams→ 800 × 1,000     │\n" +
      "  ├─────────────────────────────────────────┤\n" +
      (pt ? "  │  RUNTIME & STACK                      │\n" : "  │  RUNTIME & STACK                      │\n") +
      "  │  Node.js 20 LTS  ·  TypeScript 5       │\n" +
      "  │  Linux (Debian)  ·  pnpm workspace     │\n" +
      "  │  Discord.js v14  ·  Hono REST API      │\n" +
      "  └─────────────────────────────────────────┘\n" +
      "```",
    cpuLabel:    pt ? "💻 CPU Detectada" : "💻 CPU Detected",
    cpuVal:      cpuCount ? `**${cpuCount}** core(s)` : "—",
    freeMemLabel:pt ? "🟢 RAM Livre" : "🟢 Free RAM",
    secStats:    pt ? "━━━━ 📊  **ESTATÍSTICAS DA SESSÃO** ━━━━" : "━━━━ 📊  **LIVE SESSION STATS** ━━━━",
    guilds:      pt ? "🏰 Servidores" : "🏰 Guilds",
    total:       pt ? "⚔️ Total Ataques" : "⚔️ Total Attacks",
    active:      pt ? "🔴 Ativos Agora" : "🔴 Active Now",
    pkts:        pt ? "📦 Pacotes Env." : "📦 Pkts Fired",
    data:        pt ? "💾 Dados Enviados" : "💾 Data Sent",
    uptime:      pt ? "⏱ Tempo Ativo" : "⏱ Uptime",
    firing:      pt ? "disparando" : "firing",
    secCmds:     pt ? "━━━━ 📖  **REFERÊNCIA DE COMANDOS** ━━━━" : "━━━━ 📖  **COMMAND REFERENCE** ━━━━",
    coreTitle:   pt ? "⚡ Comandos Principais" : "⚡ Core Commands",
    coreVal:     pt
      ? "`/geass`  — Geass Override ∞ · 30 vetores ARES OMNIVECT ∞\n`/attack start`  — Iniciar qualquer vetor\n`/attack stop`   — Encerrar por ID\n`/attack list`   — Ver todos os ataques\n`/attack stats`  — Estatísticas da sessão"
      : "`/geass`  — Geass Override ∞ · 30 vectors ARES OMNIVECT ∞\n`/attack start`  — Launch any single vector\n`/attack stop`   — Terminate by ID\n`/attack list`   — View all attacks\n`/attack stats`  — Session statistics",
    reconTitle:  pt ? "🔍 Reconhecimento & Cluster" : "🔍 Recon & Cluster",
    reconVal:    pt
      ? "`/analyze`  — Reconhecimento do alvo\n`/methods`  — Lista de vetores de ataque\n`/cluster status`  — Grade de saúde dos nós\n`/cluster broadcast`  — Fan-out Geass a todos\n`/lelouch ask`  — IA Lelouch · ajuda & chat\n`/info`  — Esta tela  ·  `/help`  — Ajuda rápida"
      : "`/analyze`  — Target recon & vector ranking\n`/methods`  — Full attack method list\n`/cluster status`  — Node health grid\n`/cluster broadcast`  — Fan-out Geass to all nodes\n`/lelouch ask`  — Lelouch AI · help & chat\n`/info`  — This screen  ·  `/help`  — Quick reference",
    footer:      pt
      ? `${AUTHOR}  •  Lelouch Britannia v2.0  •  ${totalNodes} Nós  •  🇧🇷 Português`
      : `${AUTHOR}  •  Lelouch Britannia v2.0  •  ${totalNodes} Nodes  •  🇺🇸 English`,
  };

  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(T.title)
    .setDescription(`${T.quote}\n\n${T.desc}`)
    .setImage("attachment://lelouch.gif")
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      { name: "\u200b",        value: T.secEngine,               inline: false },
      { name: T.engineTitle,   value: T.engineBox,                inline: false },
      { name: "\u200b",        value: T.secInfra,                 inline: false },
      { name: "\u200b",        value: T.infraBox,                 inline: false },
      { name: T.cpuLabel,      value: T.cpuVal,                   inline: true  },
      { name: "\u200b",        value: T.secStats,                 inline: false },
      { name: T.guilds,        value: `**${fmtBig(guildCount)}**`,  inline: true  },
      { name: T.total,         value: `**${fmtBig(totalAttacks)}**`, inline: true  },
      { name: T.active,        value: `**${activeAttacks}** ${T.firing}`, inline: true  },
      { name: T.pkts,          value: `**${fmtBig(totalPackets)}**`, inline: true  },
      { name: T.data,          value: `**${fmtBytes(totalBytes)}**`, inline: true  },
      { name: T.uptime,        value: fmtUptime(uptimeMs),            inline: true  },
      { name: "\u200b",        value: T.secCmds,                   inline: false },
      { name: T.coreTitle,     value: T.coreVal,                   inline: true  },
      { name: T.reconTitle,    value: T.reconVal,                  inline: true  },
    )
    .setFooter({ text: T.footer })
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
          ? `When Geass Override fires, it **automatically fans out** to all ${configuredNodes} configured peer nodes. Each node runs all 23 ARES vectors simultaneously.`
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
