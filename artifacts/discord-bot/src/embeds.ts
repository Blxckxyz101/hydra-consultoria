import { EmbedBuilder, AttachmentBuilder } from "discord.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Attack, AttackStats, AnalyzeResult, Method } from "./api.js";
import { COLORS, METHOD_EMOJIS, AUTHOR, BOT_NAME } from "./config.js";

// ── Asset paths ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEASS_PNG  = path.join(__dirname, "..", "assets", "geass-symbol.png");
const LELOUCH_GIF = path.join(__dirname, "..", "assets", "lelouch.gif");

export function buildGeassFiles(): AttachmentBuilder[] {
  return [new AttachmentBuilder(GEASS_PNG, { name: "geass-symbol.png" })];
}
export function buildAttackFiles(): AttachmentBuilder[] {
  return [
    new AttachmentBuilder(LELOUCH_GIF, { name: "lelouch.gif" }),
    new AttachmentBuilder(GEASS_PNG,   { name: "geass-symbol.png" }),
  ];
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => n.toLocaleString("en-US");

const fmtBytes = (n: number) => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
};

const fmtPps = (pps: number) => {
  if (pps >= 1e6) return `${(pps / 1e6).toFixed(2)}M/s`;
  if (pps >= 1e3) return `${(pps / 1e3).toFixed(1)}K/s`;
  return `${Math.round(pps)}/s`;
};

const fmtBps = (bps: number) => {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return bps > 0 ? `${bps} bps` : "—";
};

const fmtPkt = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B pkts`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M pkts`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K pkts`;
  return `${n} pkts`;
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

export const methodLabel = (id: string) => {
  const map: Record<string, string> = {
    "http-flood":           "HTTP Flood",
    "http-bypass":          "HTTP Bypass",
    "http2-flood":          "HTTP/2 Rapid Reset",
    "http2-continuation":   "H2 CONTINUATION (CVE-2024-27316)",
    "waf-bypass":           "Geass WAF Bypass ∞",
    "conn-flood":           "TLS Connection Flood",
    "slowloris":            "Slowloris",
    "tls-renego":           "TLS Renegotiation DoS",
    "ws-flood":             "WebSocket Exhaustion",
    "graphql-dos":          "GraphQL Introspection DoS",
    "quic-flood":           "QUIC / HTTP3 Flood (RFC 9000)",
    "cache-poison":         "CDN Cache Poisoning DoS",
    "rudy-v2":              "RUDY v2 — Multipart Slow POST",
    "ssl-death":            "SSL Death Record",
    "rudy":                 "R.U.D.Y",
    "syn-flood":            "SYN Flood",
    "tcp-flood":            "TCP Flood",
    "udp-flood":            "UDP Flood",
    "udp-bypass":           "UDP Bypass",
    "dns-amp":              "DNS Amplification",
    "ntp-amp":              "NTP Amplification",
    "mem-amp":              "Memcached Amp",
    "hpack-bomb":           "HPACK Bomb — RFC 7541 Table Exhaustion",
    "h2-settings-storm":    "H2 Settings Storm — HPACK + Flow Control Exhaustion",
    "slow-read":            "Slow Read — TCP Buffer Exhaust",
    "range-flood":          "Range Flood — 500× I/O Per Request",
    "xml-bomb":             "XML Bomb — Billion Laughs XXE",
    "h2-ping-storm":        "H2 PING Storm — RFC 7540 §6.7 ACK Flood",
    "http-smuggling":       "HTTP Request Smuggling — TE/CL Desync",
    "doh-flood":            "DoH Flood — DNS-over-HTTPS Exhaust",
    "keepalive-exhaust":    "Keepalive Exhaust — 128-Req Pipeline",
    "app-smart-flood":      "App Smart Flood — DB Query Exhaust",
    "large-header-bomb":    "Large Header Bomb — 16KB Header Overflow",
    "http2-priority-storm": "H2 PRIORITY Storm — Stream Reorder Exhaust",
    "geass-override":       "Geass Override ∞ [ARES OMNIVECT — 35 VECTORS]",
    "cf-bypass":            "Cloudflare Bypass",
    "nginx-killer":         "Nginx Killer",
    "h2-rst-burst":         "H2 RST Burst — CVE-2023-44487 Pure RST Engine",
    "grpc-flood":           "gRPC Flood — Handler Pool Exhaustion",
    "h2-storm":             "H2 Storm",
    "pipeline-flood":       "HTTP Pipeline Flood",
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
  const pct    = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const filled = Math.round(pct * 20);
  const pctDisplay = Math.round(pct * 100);
  const bar    = `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
  const label  = pctDisplay < 100 ? `${pctDisplay}%` : "100% ✓";
  return `\`[${bar}]\` ${label}`;
};

// ── Trend arrow: compares last 2 PPS samples ─────────────────────────────────
const trendArrow = (history: number[]): string => {
  if (history.length < 2) return "";
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  if (prev === 0) return "";
  const delta = (last - prev) / prev;
  if (delta > 0.08)  return " **↑**";
  if (delta < -0.08) return " **↓**";
  return " **→**";
};

// ── Bandwidth bar: visual fill from 0..maxBps ─────────────────────────────────
const bpsBar = (bps: number, maxBps = 100_000_000) => {
  const pct    = Math.min(1, bps / maxBps);
  const filled = Math.round(pct * 14);
  return `\`[${"▓".repeat(filled)}${"░".repeat(14 - filled)}]\``;
};

// ── Connection bar ────────────────────────────────────────────────────────────
const connBar = (conns: number) => {
  const pct    = Math.min(1, conns / 10000);
  const filled = Math.round(pct * 12);
  const bar    = `${"▓".repeat(filled)}${"░".repeat(12 - filled)}`;
  const label  = conns >= 1000 ? `**${(conns / 1000).toFixed(1)}K**` : `**${conns}**`;
  return `\`[${bar}]\` ${label} holding`;
};

// ── Target probe result ───────────────────────────────────────────────────────
export type ProbeResult = {
  up:        boolean;
  latencyMs: number;
  reason?:   string;
};

const CONN_METHODS = new Set([
  "slowloris", "conn-flood", "geass-override", "rudy", "rudy-v2", "ws-flood",
  "tls-renego", "http2-continuation", "ssl-death", "slow-read", "keepalive-exhaust",
  "http-smuggling", "h2-ping-storm",
]);

// Require ECONNREFUSED for definitive down — DNS failures excluded (false positive risk)
const DEFINITIVE_DOWN = (reason?: string) => Boolean(reason?.includes("refused"));

const sparkDot = (p: ProbeResult) => {
  if (!p.up && DEFINITIVE_DOWN(p.reason)) return "🔴";
  if (!p.up) return "🟠";
  if (p.latencyMs > 5000) return "🟡";
  if (p.latencyMs > 4000) return "🟡";
  if (p.latencyMs > 1500) return "🟠";
  return "🟢";
};

const buildStatusField = (history: ProbeResult[], method: string) => {
  if (history.length === 0) return { name: "🌐 Target Status", value: "_probing..._" };
  const last    = history[history.length - 1];
  const dots    = history.slice(-20).map(sparkDot).join("");
  const recent8 = history.slice(-8);
  const downRun5 = recent8.filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length >= 5;

  const causeMap: Record<string, string> = {
    "geass-override":       "All 33 ARES vectors converged — ABSOLUTE ANNIHILATION (OMNIVECT ∞)",
    "slow-read":            "Server send buffer full — all threads blocked on TCP write",
    "range-flood":          "500× byte-range I/O exhausted disk seek queue — server froze",
    "xml-bomb":             "XML entity expansion exceeded memory — OOM parser crash",
    "h2-ping-storm":        "H2 PING ACK queue overflowed — server CPU melted",
    "http-smuggling":       "Request queue poisoned — backend thread pool deadlocked",
    "doh-flood":            "DNS resolver thread pool exhausted — all lookups queued forever",
    "keepalive-exhaust":    "Keep-alive pool saturated — MaxKeepAliveRequests hit on all workers",
    "app-smart-flood":      "DB query pool drained — all backend threads blocked on SQL",
    "large-header-bomb":    "HTTP parser buffer overflowed — server OOM on header allocation",
    "http2-priority-storm": "H2 stream dependency tree exhausted — priority queue OOM",
    "http2-flood":          "H2 connection table saturated (CVE-2023-44487)",
    "http2-continuation":   "Header reassembly buffer exhausted (CVE-2024-27316) — OOM",
    "waf-bypass":           "WAF layer overwhelmed — origin exposed",
    "conn-flood":           "TLS socket table exhausted — nginx fell",
    "slowloris":            "Thread pool saturated — server frozen",
    "tls-renego":           "TLS CPU exhausted — handshake queue overflowed",
    "ws-flood":             "WebSocket goroutine pool drained — server unresponsive",
    "graphql-dos":          "GraphQL resolver CPU limit hit — exponential query collapse",
    "quic-flood":           "QUIC DCID table exhausted — HTTP/3 crypto state OOM",
    "cache-poison":         "CDN cache poisoned — 100% origin miss, server crushed",
    "rudy-v2":              "Multipart buffer exhausted — server thread pool frozen",
    "ssl-death":            "TLS crypto thread pool saturated — AES-GCM queue overflowed",
    "udp-flood":            "Bandwidth saturated at L4",
    "syn-flood":            "TCP connection table exhausted — SYN_RECV backlog full",
    "http-bypass":          "Proxy bypass overwhelmed origin — WAF bypassed",
    "dns-amp":              "NS server flooded — DNS resolution chain collapsed",
  };

  let statusLine: string;
  if (!last.up && DEFINITIVE_DOWN(last.reason) && downRun5) {
    const cause = causeMap[method] ?? "Server resources exhausted";
    statusLine = `**💀 TARGET DOWN** — ${cause}`;
  } else if (!last.up && DEFINITIVE_DOWN(last.reason)) {
    const downCount = recent8.filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length;
    statusLine = `**🔴 REFUSING** — TCP port rejected (${downCount}/5 confirms) — verifying…`;
  } else if (!last.up) {
    statusLine = `**🟠 UNREACHABLE** — ${last.reason ?? "network error"} — may be our network`;
  } else if (last.latencyMs > 5000) {
    statusLine = `**🟡 DEGRADED** — ${last.latencyMs.toLocaleString()}ms (heavy load)`;
  } else if (last.latencyMs > 4000) {
    statusLine = `**🟠 CRITICAL LAG** — ${last.latencyMs.toLocaleString()}ms (near collapse)`;
  } else if (last.latencyMs > 1500) {
    statusLine = `**🟠 UNDER STRESS** — ${last.latencyMs.toLocaleString()}ms (response degrading)`;
  } else if (last.latencyMs > 800) {
    statusLine = `**🟡 SLOWING** — ${last.latencyMs.toLocaleString()}ms (attack taking effect)`;
  } else {
    statusLine = `**🟢 ONLINE** — ${last.latencyMs.toLocaleString()}ms (resisting)`;
  }

  return { name: "🌐 Target Status", value: `${dots}\n${statusLine}`, inline: false };
};

// ── Attack Running/Live Embed ─────────────────────────────────────────────────
export function buildAttackEmbed(
  attack:        Attack,
  livePps        = 0,
  liveBps        = 0,
  liveConns      = 0,
  targetHistory: ProbeResult[] = [],
  ppsHistory:    number[]      = [],
  proxyCount     = 0,
): EmbedBuilder {
  const isRunning  = attack.status === "running";
  const color      = isRunning ? COLORS.CRIMSON
    : attack.status === "finished" ? COLORS.GREEN
    : COLORS.GRAY;
  const emoji      = METHOD_EMOJIS[attack.method] ?? "⚡";
  const showConns  = CONN_METHODS.has(attack.method);
  const trend      = trendArrow(ppsHistory);
  const isGeass    = attack.method === "geass-override";

  // Proxy badge shown when proxies are active and method uses them
  const proxyBadge = proxyCount > 0
    ? `🌐 **${proxyCount.toLocaleString()}** residential IPs rotating`
    : "";

  const descLines: string[] = [];
  if (isRunning) {
    if (isGeass) {
      descLines.push("👁️ **ARES OMNIVECT ∞** — 33 simultaneous real attack vectors, all CVEs active");
    } else {
      descLines.push(`**Target is under ${attack.method === "waf-bypass" ? "WAF Bypass" : "fire"}** — live monitoring active`);
    }
    if (proxyBadge) descLines.push(proxyBadge);
  } else {
    descLines.push(`Attack **#${attack.id}** has **${attack.status}**.`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${isRunning ? "GEASS COMMAND ACTIVE" : `ATTACK ${attack.status.toUpperCase()}`}`)
    .setDescription(descLines.join(" • "))
    .addFields(
      { name: "🎯 Target",   value: `\`${attack.target}\``,                       inline: true },
      { name: "⚔️ Method",   value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: "🆔 ID",       value: `\`#${attack.id}\``,                          inline: true },
      { name: "🧵 Threads",  value: `**${fmtNum(attack.threads)}**`,               inline: true },
      { name: "⏱ Duration",  value: `**${attack.duration}s**`,                    inline: true },
      { name: "📊 Status",   value: statusIcon(attack.status),                     inline: true },
    );

  if (isRunning) {
    // ── Live metrics section ────────────────────────────────────────────────
    embed.addFields({ name: "‎", value: "━━━━━━━━━━━━ 📡 **LIVE METRICS** ━━━━━━━━━━━━", inline: false });

    // Row 1: PPS + Bandwidth
    embed.addFields(
      {
        name:   "⚡ Packet Rate",
        value:  `**${fmtPps(livePps)}**${trend}`,
        inline: true,
      },
      {
        name:   "📶 Bandwidth",
        value:  liveBps > 0 ? `**${fmtBps(liveBps)}**${trend}\n${bpsBar(liveBps)}` : "_ramping..._",
        inline: true,
      },
      { name: "⏳ Elapsed", value: `**${elapsed(attack.startedAt)}**`, inline: true },
    );

    // Row 2: Cumulative totals
    embed.addFields(
      { name: "📦 Packets Sent", value: `**${fmtPkt(attack.packetsSent)}**`,   inline: true },
      { name: "💾 Data Sent",    value: `**${fmtBytes(attack.bytesSent)}**`,    inline: true },
    );

    // Row 3: Open connections (if applicable)
    if (showConns) {
      embed.addFields({
        name:   "🔗 Open Connections",
        value:  liveConns > 0 ? connBar(liveConns) : "_ramping up..._",
        inline: true,
      });
    }

    // Progress bar
    embed.addFields({ name: "‎", value: progressBar(attack.startedAt, attack.duration), inline: false });

    // Target status sparkline
    embed.addFields(buildStatusField(targetHistory, attack.method));

  } else {
    // ── Finished metrics ────────────────────────────────────────────────────
    embed.addFields({ name: "‎", value: "━━━━━━━━━━━━ 📊 **FINAL REPORT** ━━━━━━━━━━━━", inline: false });

    const elapsedSec = attack.stoppedAt && attack.startedAt
      ? Math.max(1, Math.round((new Date(attack.stoppedAt).getTime() - new Date(attack.startedAt).getTime()) / 1000))
      : attack.duration;
    const avgPps  = elapsedSec > 0 ? Math.round(attack.packetsSent / elapsedSec) : 0;
    const avgBps  = elapsedSec > 0 ? Math.round((attack.bytesSent * 8) / elapsedSec) : 0;

    embed.addFields(
      { name: "📦 Total Packets",  value: `**${fmtPkt(attack.packetsSent)}**`,  inline: true },
      { name: "💾 Total Data",     value: `**${fmtBytes(attack.bytesSent)}**`,   inline: true },
      { name: "⏳ Elapsed",        value: `**${elapsed(attack.startedAt)}**`,    inline: true },
      { name: "📈 Avg PPS",        value: `**${fmtPps(avgPps)}**`,              inline: true },
      { name: "📶 Avg Bandwidth",  value: `**${fmtBps(avgBps)}**`,              inline: true },
    );

    if (targetHistory.length > 0) {
      embed.addFields(buildStatusField(targetHistory, attack.method));
    }
  }

  embed.setFooter(footer(`Attack #${attack.id} • updates every 5s`)).setTimestamp();
  return embed;
}

// ── Attack Started Embed ──────────────────────────────────────────────────────
export function buildStartEmbed(attack: Attack, proxyCount = 0): EmbedBuilder {
  const emoji   = METHOD_EMOJIS[attack.method] ?? "⚡";
  const isGeass = attack.method === "geass-override";
  const proxyLine = proxyCount > 0
    ? `\n\n🌐 **${proxyCount.toLocaleString()} residential IPs** in rotation — each request from a different IP`
    : "";

  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(`${emoji} GEASS COMMAND ISSUED`)
    .setDescription(
      isGeass
        ? `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**\n\n👁️ **ARES OMNIVECT ∞** — 33 real attack vectors deploying simultaneously${proxyLine}`
        : `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**${proxyLine}`
    )
    .setImage("attachment://lelouch.gif")
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      { name: "🎯 Target",    value: `\`${attack.target}\``,                       inline: true },
      { name: "⚔️ Method",    value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: "🆔 Attack ID", value: `\`#${attack.id}\``,                          inline: true },
      { name: "🧵 Threads",   value: `**${fmtNum(attack.threads)}**`,               inline: true },
      { name: "⏱ Duration",   value: `**${attack.duration}s**`,                    inline: true },
      { name: "📊 Status",    value: "🔴 **INITIALIZING...**",                     inline: true },
      { name: "‎", value: "*Live metrics update every 5 seconds automatically.*", inline: false },
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

// ── Finish Notification Embed (sent to channel on attack end) ─────────────────
export function buildFinishEmbed(
  attackId:  number,
  target:    string,
  method:    string,
  status:    string,
  packets:   number,
  bytes:     number,
  startedAt: string,
  stoppedAt: string | null,
): EmbedBuilder {
  const finishColor = status === "finished" ? COLORS.GREEN
                    : status === "stopped"  ? COLORS.GOLD
                    : COLORS.RED;
  const finishIcon  = status === "finished" ? "✅"
                    : status === "stopped"  ? "⏹️"
                    : "⚠️";
  const emoji      = METHOD_EMOJIS[method] ?? "⚡";
  const elapsedSec = stoppedAt && startedAt
    ? Math.max(1, Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : 0;
  const avgPps  = elapsedSec > 0 ? Math.round(packets / elapsedSec) : 0;
  const avgBps  = elapsedSec > 0 ? Math.round((bytes * 8) / elapsedSec) : 0;
  const minSec  = Math.floor(elapsedSec / 60);
  const remSec  = elapsedSec % 60;
  const durStr  = minSec > 0 ? `${minSec}m ${remSec}s` : `${elapsedSec}s`;

  return new EmbedBuilder()
    .setColor(finishColor)
    .setTitle(`${finishIcon} ATTACK #${attackId} ${status.toUpperCase()}`)
    .setDescription(`${emoji} **${methodLabel(method)}** → \`${target}\``)
    .addFields(
      { name: "⏱️ Duration",      value: `**${durStr}**`,         inline: true },
      { name: "📦 Total Packets", value: `**${fmtPkt(packets)}**`,  inline: true },
      { name: "💾 Total Data",    value: `**${fmtBytes(bytes)}**`,   inline: true },
      { name: "📈 Avg Rate",      value: `**${fmtPps(avgPps)}**`,   inline: true },
      { name: "📶 Avg Bandwidth", value: `**${fmtBps(avgBps)}**`,   inline: true },
    )
    .setFooter({ text: `${BOT_NAME} — ${AUTHOR}` })
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
        return `\`#${a.id}\` ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtPkt(a.packetsSent)} | ⏳ ${elapsed(a.startedAt)}`;
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
        return `\`#${a.id}\` ${icon} ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtPkt(a.packetsSent)} | ${fmtBytes(a.bytesSent)}`;
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
export function buildStatsEmbed(stats: AttackStats, proxyStats?: { count: number; residentialCount?: number; httpCount?: number; socks5Count?: number; avgResponseMs: number }): EmbedBuilder {
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
      { name: "📦 Total Packets",   value: `**${fmtPkt(stats.totalPacketsSent)}**`,   inline: true },
      { name: "💾 Total Data Sent", value: `**${fmtBytes(stats.totalBytesSent)}**`,   inline: true },
      { name: "💻 CPU Cores",       value: `**${stats.cpuCount ?? "N/A"}**`,          inline: true },
    );

  if (proxyStats) {
    embed.addFields({
      name: "🌐 Proxy Network",
      value: [
        `**${proxyStats.count.toLocaleString()}** total proxies in pool`,
        proxyStats.residentialCount != null ? `**${proxyStats.residentialCount.toLocaleString()}** residential IPs (dedicated)` : `HTTP: ${proxyStats.httpCount ?? 0} / SOCKS5: ${proxyStats.socks5Count ?? 0}`,
        `Avg latency: **${proxyStats.avgResponseMs}ms**`,
      ].join("\n"),
      inline: false,
    });
  }

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

  const h2h3Parts: string[] = [];
  if (result.supportsH2) h2h3Parts.push("**H/2**");
  if (result.supportsH3) h2h3Parts.push("**H/3**");
  const protocolLine = h2h3Parts.length > 0 ? `✅ ${h2h3Parts.join(" + ")}` : "HTTP/1.1 only";

  const featureParts: string[] = [];
  if (result.hasGraphQL)   featureParts.push("GraphQL");
  if (result.hasWebSocket) featureParts.push("WebSocket");
  if (result.hasHSTS)      featureParts.push(`HSTS${result.hstsMaxAge ? ` (${Math.round(result.hstsMaxAge / 86400)}d)` : ""}`);
  const featuresLine = featureParts.length > 0 ? featureParts.join(", ") : "None detected";

  const portsLine = result.openPorts.length > 0
    ? result.openPorts.map(p => `\`${p}\``).join(" ")
    : "None scanned";

  const ipsLine = result.allIPs?.length > 0
    ? result.allIPs.slice(0, 5).join(", ") + (result.allIPs.length > 5 ? ` +${result.allIPs.length - 5} more` : "")
    : result.ip ?? "Unknown";

  const recoLines = top6.length > 0
    ? top6.map((r, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        const tier  = tierIcon(r.tier ?? "");
        return `${medal} ${tier} **${r.name}** — Score: **${r.score}** | Tier: **${r.tier ?? "?"}**\n> ${r.reason}`;
      }).join("\n\n")
    : "No recommendations available.";

  return new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle("🔍 TARGET RECONNAISSANCE — GEASS SCAN")
    .setDescription(`Analysis of \`${result.target}\``)
    .addFields(
      { name: "🌐 IP / DNS",     value: ipsLine,          inline: true },
      { name: "🖥️ Server",       value: serverDisplay,    inline: true },
      { name: "⏱ Response",      value: `${result.responseTimeMs}ms`, inline: true },
      { name: "🛡️ Protection",   value: shieldLine,       inline: true },
      { name: "📡 HTTP Version",  value: protocolLine,     inline: true },
      { name: "🔌 Open Ports",   value: portsLine,         inline: true },
      { name: "🔧 Features",     value: featuresLine,      inline: false },
      { name: "‎", value: "━━━━━━━━━━━━ 🏆 **RECOMMENDED ATTACK VECTORS** ━━━━━━━━━━━━", inline: false },
      { name: "📋 Top Methods", value: recoLines, inline: false },
    )
    .setFooter(footer(`Scanned ${new Date().toUTCString()}`))
    .setTimestamp();
}

// ── Methods Embed ─────────────────────────────────────────────────────────────
export function buildMethodsEmbed(methods: Method[], layerFilter?: string): EmbedBuilder[] {
  const filtered = layerFilter
    ? methods.filter(m => m.layer?.toLowerCase() === layerFilter.toLowerCase())
    : methods;

  const pages: EmbedBuilder[] = [];
  const PAGE_SIZE = 8;

  for (let i = 0; i < filtered.length; i += PAGE_SIZE) {
    const chunk = filtered.slice(i, i + PAGE_SIZE);
    const page  = Math.floor(i / PAGE_SIZE) + 1;
    const total = Math.ceil(filtered.length / PAGE_SIZE);

    const embed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle(`⚔️ ARES ATTACK VECTORS — ${layerFilter ? `Layer ${layerFilter.toUpperCase()}` : "All Methods"} (${page}/${total})`)
      .setDescription(`**${filtered.length}** methods available${layerFilter ? ` for Layer ${layerFilter.toUpperCase()}` : ""}.`)
      .addFields(
        chunk.map(m => ({
          name:   `${tierIcon(m.tier ?? "")} ${METHOD_EMOJIS[m.id] ?? "⚡"} **${m.name}**`,
          value:  [
            m.description ?? "_No description_",
            `Tier: **${m.tier ?? "?"}** | Layer: **${m.layer ?? "?"}** | Protocol: **${m.protocol ?? "?"}**`,
          ].join("\n"),
          inline: false,
        }))
      )
      .setFooter(footer(`${filtered.length} total methods`))
      .setTimestamp();

    pages.push(embed);
  }

  if (pages.length === 0) {
    pages.push(
      new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle("❌ No Methods Found")
        .setDescription(layerFilter ? `No methods found for layer \`${layerFilter}\`.` : "No methods available.")
        .setFooter(footer())
        .setTimestamp()
    );
  }

  return pages;
}

// ── Error Embed ───────────────────────────────────────────────────────────────

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
      { name: "👁️ `/geass <target>`",            value: "Launch **Geass Override ∞** directly — ARES OMNIVECT ∞ 33 vectors.", inline: false },
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
      ? `**Lelouch Britannia** é uma plataforma de stress-test de redes de próxima geração.\n33 vetores de ataque simultâneos (ARES OMNIVECT ∞), fan-out multi-nó em cluster, monitoramento ao vivo e C2 via Discord — tudo sob um único Comando Geass.`
      : `**Lelouch Britannia** is a next-generation network stress-testing platform.\n33 simultaneous real attack vectors (ARES OMNIVECT ∞), multi-node cluster fan-out, live probe monitoring, and Discord C2 — all under one Geass command.`,
    secEngine:   pt ? "━━━━ ⚔️  **MOTOR ARES OMNIVECT** ━━━━" : "━━━━ ⚔️  **ARES OMNIVECT ENGINE** ━━━━",
    engineTitle: pt ? "🔴 Geass Override ∞ — 33 Vetores" : "🔴 Geass Override ∞ — 33 Vectors",
    engineBox:
      "```\n" +
      (pt
        ? "  TODOS OS 33 VETORES — SIMULTÂNEOS\n"
        : "  ALL 33 VECTORS — SIMULTANEOUS\n") +
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
      ? "`/geass`  — Geass Override ∞ · 33 vetores ARES OMNIVECT ∞\n`/attack start`  — Iniciar qualquer vetor\n`/attack stop`   — Encerrar por ID\n`/attack list`   — Ver todos os ataques\n`/attack stats`  — Estatísticas da sessão"
      : "`/geass`  — Geass Override ∞ · 33 vectors ARES OMNIVECT ∞\n`/attack start`  — Launch any single vector\n`/attack stop`   — Terminate by ID\n`/attack list`   — View all attacks\n`/attack stats`  — Session statistics",
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
          ? `When Geass Override fires, it **automatically fans out** to all ${configuredNodes} configured peer nodes. Each node runs all 33 ARES vectors simultaneously.`
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
