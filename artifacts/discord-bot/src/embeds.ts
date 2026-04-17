import {
  EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
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

// ── Generic Language Toggle Row ───────────────────────────────────────────────
export function buildLangRow(active: "en" | "pt", prefix: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_lang:en`)
      .setLabel("🇺🇸  English")
      .setStyle(active === "en" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${prefix}_lang:pt`)
      .setLabel("🇧🇷  Português")
      .setStyle(active === "pt" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

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
export function buildStartEmbed(attack: Attack, proxyCount = 0, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt    = lang === "pt";
  const emoji = METHOD_EMOJIS[attack.method] ?? "⚡";
  const isGeass = attack.method === "geass-override";

  const proxyLine = proxyCount > 0
    ? pt
      ? `\n\n🌐 **${proxyCount.toLocaleString()} IPs residenciais** em rotação — cada requisição de um IP diferente`
      : `\n\n🌐 **${proxyCount.toLocaleString()} residential IPs** in rotation — each request from a different IP`
    : "";

  const quote = pt
    ? `> *"Os homens NÃO nascem iguais. Alguns nascem mais rápidos, outros com mais beleza, alguns nascem na pobreza — e outros nascem doentes. Por causa disso... NÃO. POR CAUSA DISSO… nós lutamos."*\n> — **Lelouch vi Britannia**`
    : `> *"All men are NOT created equal. Some are born swifter afoot, some with greater beauty, some are born into poverty — and others are born sick and feeble. In spite of that... No. BECAUSE of that… We fight."*\n> — **Lelouch vi Britannia**`;

  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(pt ? `${emoji} COMANDO GEASS EMITIDO` : `${emoji} GEASS COMMAND ISSUED`)
    .setDescription(
      isGeass
        ? `${quote}\n\n👁️ **ARES OMNIVECT ∞** — ${pt ? "35 vetores de ataque reais disparando simultaneamente" : "35 real attack vectors deploying simultaneously"}${proxyLine}`
        : `${quote}${proxyLine}`
    )
    .setImage("attachment://lelouch.gif")
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      { name: pt ? "🎯 Alvo"       : "🎯 Target",    value: `\`${attack.target}\``,                       inline: true },
      { name: pt ? "⚔️ Método"     : "⚔️ Method",    value: `${emoji} **${methodLabel(attack.method)}**`, inline: true },
      { name: pt ? "🆔 ID do Ataque" : "🆔 Attack ID", value: `\`#${attack.id}\``,                        inline: true },
      { name: pt ? "🧵 Threads"    : "🧵 Threads",   value: `**${fmtNum(attack.threads)}**`,               inline: true },
      { name: pt ? "⏱ Duração"    : "⏱ Duration",   value: `**${attack.duration}s**`,                    inline: true },
      { name: pt ? "📊 Status"     : "📊 Status",    value: pt ? "🔴 **INICIALIZANDO...**" : "🔴 **INITIALIZING...**", inline: true },
      { name: "‎", value: pt ? "*Métricas ao vivo atualizam a cada 5 segundos.*" : "*Live metrics update every 5 seconds automatically.*", inline: false },
    )
    .setFooter(footer(pt ? "Iniciado por slash command" : "Started by slash command"))
    .setTimestamp();
}

// ── Stop Embed ────────────────────────────────────────────────────────────────
export function buildStopEmbed(id: number, ok: boolean, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt = lang === "pt";
  return new EmbedBuilder()
    .setColor(ok ? COLORS.GREEN : COLORS.RED)
    .setTitle(ok
      ? (pt ? "⏹️ ATAQUE ENCERRADO" : "⏹️ ATTACK TERMINATED")
      : (pt ? "❌ FALHA AO PARAR" : "❌ STOP FAILED"))
    .setDescription(
      ok
        ? (pt ? `Ataque **#${id}** foi encerrado pelo Comando Geass.` : `Attack **#${id}** has been stopped by Geass command.`)
        : (pt ? `Não foi possível parar o ataque **#${id}**. Ele pode já ter terminado.` : `Could not stop attack **#${id}**. It may have already ended.`)
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
export function buildListEmbed(attacks: Attack[], lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt       = lang === "pt";
  const running   = attacks.filter(a => a.status === "running");
  const completed = attacks.filter(a => a.status !== "running").slice(0, 8);

  const embed = new EmbedBuilder()
    .setColor(running.length > 0 ? COLORS.CRIMSON : COLORS.GOLD)
    .setTitle(pt ? "👁️ REGISTRO DE ATAQUES GEASS" : "👁️ GEASS ATTACK REGISTRY")
    .setDescription(
      running.length > 0
        ? `**${running.length} ataque${running.length > 1 ? "s" : ""}${pt ? " ativos no momento" : " currently active"}**`
        : (pt ? "Nenhum ataque ativo no momento." : "No active attacks at this time.")
    );

  if (running.length > 0) {
    embed.addFields({
      name: pt ? "🔴 ATAQUES ATIVOS" : "🔴 ACTIVE ATTACKS",
      value: running.map(a => {
        const e = METHOD_EMOJIS[a.method] ?? "⚡";
        return `\`#${a.id}\` ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtPkt(a.packetsSent)} | ⏳ ${elapsed(a.startedAt)}`;
      }).join("\n"),
      inline: false,
    });
  }

  if (completed.length > 0) {
    embed.addFields({
      name: pt ? "📋 HISTÓRICO RECENTE" : "📋 RECENT HISTORY",
      value: completed.map(a => {
        const icon = a.status === "finished" ? "✅" : a.status === "stopped" ? "⏹️" : "❌";
        const e    = METHOD_EMOJIS[a.method] ?? "⚡";
        return `\`#${a.id}\` ${icon} ${e} **${methodLabel(a.method)}** → \`${a.target}\` | ${fmtPkt(a.packetsSent)} | ${fmtBytes(a.bytesSent)}`;
      }).join("\n"),
      inline: false,
    });
  }

  if (attacks.length === 0) {
    embed.addFields({
      name: pt ? "Nenhum ataque encontrado" : "No attacks found",
      value: pt ? "Use `/attack start` para iniciar um Comando Geass." : "Use `/attack start` to launch a Geass command.",
      inline: false,
    });
  }

  embed.setFooter(footer(pt ? `${attacks.length} entradas no total` : `${attacks.length} total entries`)).setTimestamp();
  return embed;
}

// ── Stats Embed ───────────────────────────────────────────────────────────────
export function buildStatsEmbed(stats: AttackStats, proxyStats?: { count: number; residentialCount?: number; httpCount?: number; socks5Count?: number; avgResponseMs: number }, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt = lang === "pt";
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
    .setTitle(pt ? "📊 CENTRAL DE COMANDO GEASS — ESTATÍSTICAS GLOBAIS" : "📊 GEASS COMMAND CENTER — GLOBAL STATISTICS")
    .setDescription(pt ? "Métricas agregadas de todos os ataques registrados nesta sessão." : "Aggregate metrics across all attacks recorded in this session.")
    .addFields(
      {
        name: pt ? "🔴 Ativos / Total" : "🔴 Active / Total",
        value: `**${fmtNum(stats.runningAttacks)} ${pt ? "rodando" : "running"}** / **${fmtNum(stats.totalAttacks)} ${pt ? "total" : "total"}**\n${mkBar(stats.runningAttacks, Math.max(stats.totalAttacks, 1))}`,
        inline: false,
      },
      { name: pt ? "📦 Total de Pacotes"  : "📦 Total Packets",   value: `**${fmtPkt(stats.totalPacketsSent)}**`,   inline: true },
      { name: pt ? "💾 Dados Enviados"    : "💾 Total Data Sent", value: `**${fmtBytes(stats.totalBytesSent)}**`,   inline: true },
      { name: pt ? "💻 Núcleos CPU"       : "💻 CPU Cores",       value: `**${stats.cpuCount ?? "N/A"}**`,         inline: true },
    );

  if (proxyStats) {
    embed.addFields({
      name: pt ? "🌐 Rede de Proxies" : "🌐 Proxy Network",
      value: [
        pt
          ? `**${proxyStats.count.toLocaleString()}** proxies no pool`
          : `**${proxyStats.count.toLocaleString()}** total proxies in pool`,
        proxyStats.residentialCount != null
          ? (pt
            ? `**${proxyStats.residentialCount.toLocaleString()}** IPs residenciais (dedicados)`
            : `**${proxyStats.residentialCount.toLocaleString()}** residential IPs (dedicated)`)
          : `HTTP: ${proxyStats.httpCount ?? 0} / SOCKS5: ${proxyStats.socks5Count ?? 0}`,
        pt ? `Latência média: **${proxyStats.avgResponseMs}ms**` : `Avg latency: **${proxyStats.avgResponseMs}ms**`,
      ].join("\n"),
      inline: false,
    });
  }

  if (topMethods.length > 0) {
    embed.addFields({
      name: pt ? "🏆 Métodos Mais Usados" : "🏆 Top Methods",
      value: topMethods.map((m, i) => {
        const emoji = METHOD_EMOJIS[m.method] ?? "⚡";
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        return `${medal} ${emoji} **${methodLabel(m.method)}** — ${m.count} ${pt ? "ataques" : "attacks"}`;
      }).join("\n"),
      inline: false,
    });
  }

  embed.setFooter(footer()).setTimestamp();
  return embed;
}

// ── Analyze Embed ─────────────────────────────────────────────────────────────
export function buildAnalyzeEmbed(result: AnalyzeResult, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt = lang === "pt";

  // ── Strings ──
  const T = {
    title:      pt ? "🔍 RECONHECIMENTO DE ALVO — GEASS SCAN" : "🔍 TARGET RECONNAISSANCE — GEASS SCAN",
    desc:       pt ? `Análise completa de \`${result.target}\`` : `Full intelligence scan of \`${result.target}\``,
    secDns:     pt ? "━━━━ 🌐  **DNS & REDE** ━━━━" : "━━━━ 🌐  **DNS & NETWORK** ━━━━",
    primaryIp:  pt ? "🎯 IP Principal" : "🎯 Primary IP",
    allIps:     pt ? "📡 Todos IPs" : "📡 All IPs",
    secServer:  pt ? "━━━━ 🖥️  **SERVIDOR** ━━━━" : "━━━━ 🖥️  **SERVER FINGERPRINT** ━━━━",
    server:     pt ? "🖥️ Servidor" : "🖥️ Server",
    response:   pt ? "⏱ Resposta" : "⏱ Response Time",
    http:       pt ? "🌍 HTTP/HTTPS" : "🌍 HTTP/HTTPS",
    secProt:    pt ? "━━━━ 🛡️  **PROTEÇÃO** ━━━━" : "━━━━ 🛡️  **PROTECTION LAYER** ━━━━",
    cdn:        pt ? "☁️ CDN" : "☁️ CDN",
    waf:        pt ? "🛡️ WAF" : "🛡️ WAF",
    hsts:       pt ? "🔒 HSTS" : "🔒 HSTS",
    secProto:   pt ? "━━━━ 📡  **PROTOCOLOS** ━━━━" : "━━━━ 📡  **PROTOCOLS & FEATURES** ━━━━",
    httpVer:    pt ? "📡 Versão HTTP" : "📡 HTTP Version",
    ports:      pt ? "🔌 Portas Abertas" : "🔌 Open Ports",
    features:   pt ? "🔧 Recursos" : "🔧 Features",
    secOrigin:  pt ? "━━━━ 🔓  **IP DE ORIGEM DESCOBERTO** ━━━━" : "━━━━ 🔓  **ORIGIN IP DISCOVERED** ━━━━",
    originIp:   pt ? "🎯 IP Real (Bypass CDN)" : "🎯 Real IP (CDN Bypass)",
    originSub:  pt ? "🔗 Subdomínio Exposto" : "🔗 Exposed Subdomain",
    secRec:     pt ? "━━━━ 🏆  **VETORES RECOMENDADOS** ━━━━" : "━━━━ 🏆  **RECOMMENDED ATTACK VECTORS** ━━━━",
    recTitle:   pt ? "📋 Melhores Métodos" : "📋 Top Methods",
    noRec:      pt ? "Nenhuma recomendação disponível." : "No recommendations available.",
    noneDetect: pt ? "Nenhum detectado" : "None detected",
    none:       pt ? "Nenhuma" : "None",
    footerTxt:  pt ? `Escaneado em ${new Date().toUTCString()}` : `Scanned ${new Date().toUTCString()}`,
  };

  // ── Server display ──
  const serverDisplay = result.serverLabel && result.serverLabel !== "Unknown"
    ? result.serverLabel
    : result.serverType && result.serverType !== "unknown"
      ? result.serverType
      : T.noneDetect;

  // ── IP lines ──
  const primaryIpLine = result.ip ?? T.noneDetect;
  const allIpsLine = result.allIPs?.length > 1
    ? result.allIPs.slice(0, 6).map(ip => `\`${ip}\``).join("\n") +
      (result.allIPs.length > 6 ? `\n_+${result.allIPs.length - 6} more_` : "")
    : `\`${result.ip ?? "Unknown"}\``;

  // ── HTTP availability ──
  const httpParts: string[] = [];
  if (result.httpAvailable)  httpParts.push("**HTTP** ✅");
  if (result.httpsAvailable) httpParts.push("**HTTPS** ✅");
  if (!result.httpAvailable && !result.httpsAvailable) httpParts.push(pt ? "Indisponível" : "Unavailable");
  const httpLine = httpParts.join("  /  ");

  // ── Protection ──
  const cdnLine  = result.isCDN
    ? `✅ **${result.cdnProvider}**`
    : pt ? "❌ Não detectado" : "❌ Not detected";
  const wafLine  = result.hasWAF
    ? `🛡️ **${result.wafProvider}**`
    : pt ? "❌ Não detectado" : "❌ Not detected";
  const hstsLine = result.hasHSTS
    ? `✅ ${result.hstsMaxAge ? `max-age **${Math.round(result.hstsMaxAge / 86400)}d**` : "enabled"}`
    : pt ? "❌ Não ativo" : "❌ Not set";

  // ── Protocols ──
  const h2h3Parts: string[] = [];
  if (result.supportsH2) h2h3Parts.push("**H/2**");
  if (result.supportsH3) h2h3Parts.push("**H/3**");
  const protocolLine = h2h3Parts.length > 0 ? `✅ ${h2h3Parts.join(" + ")}` : "HTTP/1.1 only";

  // ── Features ──
  const featureParts: string[] = [];
  if (result.hasGraphQL)   featureParts.push("GraphQL");
  if (result.hasWebSocket) featureParts.push("WebSocket");
  const featuresLine = featureParts.length > 0 ? featureParts.join(", ") : T.noneDetect;

  // ── Ports ──
  const portsLine = result.openPorts.length > 0
    ? result.openPorts.map(p => `\`${p}\``).join("  ")
    : T.none;

  // ── Recommendations ──
  const top4 = [...result.recommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const recoLines = top4.length > 0
    ? top4.map((r, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        const tier  = tierIcon(r.tier ?? "");
        return `${medal} ${tier} **${r.name}** — Score \`${r.score}\` | **${r.tier ?? "?"}**\n> ${r.reason ?? ""}`;
      }).join("\n\n").slice(0, 1020)
    : T.noRec;

  const embed = new EmbedBuilder()
    .setColor(result.isCDN || result.hasWAF ? COLORS.GOLD : COLORS.PURPLE)
    .setTitle(T.title)
    .setDescription(T.desc)
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      // ── DNS / IP ──
      { name: "\u200b", value: T.secDns, inline: false },
      { name: T.primaryIp, value: `\`${primaryIpLine}\``, inline: true },
      { name: T.allIps,    value: allIpsLine,               inline: true },
      // ── Server ──
      { name: "\u200b",     value: T.secServer, inline: false },
      { name: T.server,     value: `**${serverDisplay}**`,    inline: true },
      { name: T.response,   value: `**${result.responseTimeMs}ms**`, inline: true },
      { name: T.http,       value: httpLine,                  inline: true },
      // ── Protection ──
      { name: "\u200b", value: T.secProt, inline: false },
      { name: T.cdn,    value: cdnLine,   inline: true },
      { name: T.waf,    value: wafLine,   inline: true },
      { name: T.hsts,   value: hstsLine,  inline: true },
      // ── Protocols & Features ──
      { name: "\u200b",   value: T.secProto,  inline: false },
      { name: T.httpVer,  value: protocolLine, inline: true },
      { name: T.features, value: featuresLine, inline: true },
      { name: T.ports,    value: portsLine,    inline: true },
    );

  // ── Origin IP bypass section (only if found) ──
  if (result.originIP) {
    embed.addFields(
      { name: "\u200b",     value: T.secOrigin, inline: false },
      { name: T.originIp,   value: `\`${result.originIP}\``,            inline: true },
      { name: T.originSub,  value: result.originSubdomain
          ? `\`${result.originSubdomain}\``
          : (pt ? "_não identificado_" : "_not identified_"),            inline: true },
    );
  }

  // ── Attack recommendations ──
  embed.addFields(
    { name: "\u200b",   value: T.secRec,  inline: false },
    { name: T.recTitle, value: recoLines, inline: false },
  );

  embed.setFooter(footer(T.footerTxt)).setTimestamp();
  return embed;
}

// ── Methods Embed (single page, button pagination) ────────────────────────────
export const METHODS_PAGE_SIZE = 4;

export function buildMethodsEmbed(
  methods: Method[],
  layerFilter?: string,
  lang: "en" | "pt" = "pt",
  page = 1,
): EmbedBuilder {
  const pt       = lang === "pt";
  const filtered = layerFilter
    ? methods.filter(m => m.layer?.toLowerCase() === layerFilter.toLowerCase())
    : methods;

  if (filtered.length === 0) {
    return new EmbedBuilder()
      .setColor(COLORS.RED)
      .setTitle(pt ? "❌ Nenhum Vetor Encontrado" : "❌ No Vectors Found")
      .setDescription(
        layerFilter
          ? (pt ? `Nenhum vetor para a camada \`${layerFilter}\`.` : `No vectors for layer \`${layerFilter}\`.`)
          : (pt ? "Nenhum vetor disponível." : "No vectors available.")
      )
      .setFooter(footer())
      .setTimestamp();
  }

  const total     = Math.ceil(filtered.length / METHODS_PAGE_SIZE);
  const safePage  = Math.min(Math.max(1, page), total);
  const start     = (safePage - 1) * METHODS_PAGE_SIZE;
  const chunk     = filtered.slice(start, start + METHODS_PAGE_SIZE);

  const layerLabel  = layerFilter ? ` — Layer ${layerFilter.toUpperCase()}` : "";
  const titleSuffix = pt ? "VETORES DE ATAQUE" : "ATTACK VECTORS";

  const desc = pt
    ? `${tierIcon("S")} **${filtered.length}** vetores disponíveis${layerFilter ? ` na Layer \`${layerFilter.toUpperCase()}\`` : ""}.\n📄 Página **${safePage} / ${total}** — use os botões para navegar.`
    : `${tierIcon("S")} **${filtered.length}** vectors available${layerFilter ? ` for Layer \`${layerFilter.toUpperCase()}\`` : ""}.\n📄 Page **${safePage} / ${total}** — use buttons to navigate.`;

  return new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(`⚔️ ARES ${titleSuffix}${layerLabel}`)
    .setDescription(desc)
    .addFields(
      chunk.map((m, idx) => {
        const num     = start + idx + 1;
        const rawDesc = m.description ?? (pt ? "Sem descrição" : "No description");
        const meta    = pt
          ? `\`${m.tier ?? "?"}\` · Camada \`${m.layer ?? "?"}\` · \`${m.protocol ?? "?"}\``
          : `\`${m.tier ?? "?"}\` · Layer \`${m.layer ?? "?"}\` · \`${m.protocol ?? "?"}\``;
        return {
          name:   `${num}. ${tierIcon(m.tier ?? "")} ${METHOD_EMOJIS[m.id] ?? "⚡"} ${m.name}`,
          value:  `${rawDesc}\n${meta}`,
          inline: false,
        };
      })
    )
    .setFooter(footer(pt ? `${filtered.length} vetores no total` : `${filtered.length} total vectors`))
    .setTimestamp();
}

export function buildMethodsNavRow(
  page: number,
  total: number,
  lang: "en" | "pt",
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("methods_prev")
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId("methods_page_indicator")
      .setLabel(`${page} / ${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("methods_next")
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= total),
    new ButtonBuilder()
      .setCustomId("methods_lang:en")
      .setLabel("🇺🇸")
      .setStyle(lang === "en" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("methods_lang:pt")
      .setLabel("🇧🇷")
      .setStyle(lang === "pt" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

// ── Error Embed ───────────────────────────────────────────────────────────────

export function buildHelpEmbed(lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt = lang === "pt";
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(pt ? "👁️ LELOUCH BRITANNIA — CENTRAL DE COMANDO" : "👁️ LELOUCH BRITANNIA — COMMAND CENTER")
    .setDescription(
      pt
        ? `> *"Eu sou Zero — o homem que irá obliterar o mundo."*\n\nBem-vindo à interface de controle de rede do **${BOT_NAME}**.\nTodos os comandos são slash commands — pressione \`/\` para navegar.`
        : `> *"I am Zero — the man who will obliterate the world."*\n\nWelcome to the **${BOT_NAME}** network control interface.\nAll commands are slash commands — type \`/\` to browse them.`
    )
    .setThumbnail("attachment://geass-symbol.png")
    .addFields(
      {
        name: pt ? "⚔️ Ataques" : "⚔️ Attacks",
        value: pt
          ? [
              "`/attack start <alvo>` — Iniciar ataque — menu para escolher método, duração & threads",
              "`/attack stop <id>` — Parar ataque por ID",
              "`/attack list` — Ver todos os ataques ativos e recentes",
              "`/attack stats` — Estatísticas globais da sessão",
              "`/geass <alvo>` — Disparar **Geass Override ∞** — ARES OMNIVECT ∞ 35 vetores",
            ].join("\n")
          : [
              "`/attack start <target>` — Launch attack — dropdown for method, duration & threads",
              "`/attack stop <id>` — Stop a running attack by ID",
              "`/attack list` — View all active and recent attacks",
              "`/attack stats` — Show global aggregate statistics",
              "`/geass <target>` — Launch **Geass Override ∞** directly — ARES OMNIVECT ∞ 35 vectors",
            ].join("\n"),
        inline: false,
      },
      {
        name: pt ? "🔍 Reconhecimento" : "🔍 Reconnaissance",
        value: pt
          ? [
              "`/analyze <alvo>` — Scan completo: IP, subdomínios, CDN/WAF, vetores ranqueados",
              "`/methods [layer]` — Lista todos os vetores. Filtrar por `L7`, `L4` ou `L3`",
            ].join("\n")
          : [
              "`/analyze <target>` — Full scan: IP, subdomains, CDN/WAF, ranked attack vectors",
              "`/methods [layer]` — List all attack vectors. Filter by `L7`, `L4`, or `L3`",
            ].join("\n"),
        inline: false,
      },
      {
        name: pt ? "🌐 Cluster" : "🌐 Cluster",
        value: pt
          ? [
              "`/cluster status` — Saúde & latência de todos os nós do cluster",
              "`/cluster broadcast <alvo>` — Disparar Geass Override para TODOS os nós (10× potência)",
            ].join("\n")
          : [
              "`/cluster status` — Health & latency of all cluster nodes",
              "`/cluster broadcast <target>` — Fire Geass Override to ALL nodes (10× power)",
            ].join("\n"),
        inline: false,
      },
      {
        name: pt ? "🤖 IA & Info" : "🤖 AI & Info",
        value: pt
          ? [
              "`/lelouch ask <mensagem>` — Falar com **Lelouch IA** — ajuda com bot, código, sistemas web",
              "`/lelouch reset` — Limpar histórico da conversa",
              "`/info` — Info completa da plataforma — infraestrutura & stats ao vivo",
              "`/help` — Mostrar esta mensagem de ajuda",
            ].join("\n")
          : [
              "`/lelouch ask <message>` — Talk to **Lelouch AI** — helps with bot, code, web systems",
              "`/lelouch reset` — Clear conversation history",
              "`/info` — Full platform info — cluster infrastructure & live stats",
              "`/help` — Show this help message",
            ].join("\n"),
        inline: false,
      },
      { name: "\u200b", value: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", inline: false },
      {
        name: pt ? "💡 Dicas" : "💡 Tips",
        value: pt
          ? [
              "• Use `/analyze <alvo>` primeiro para descobrir o melhor vetor",
              "• Use `waf-bypass` para alvos protegidos por Cloudflare/Akamai",
              "• O botão ⏹️ **Stop** aparece em todo embed de ataque",
              "• Ataques ativos atualizam automaticamente a cada 5 segundos",
              "• Pergunte `/lelouch ask` qualquer coisa — ele conhece toda a plataforma",
            ].join("\n")
          : [
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
}, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt = lang === "pt";
  const { self, nodes, totalOnline, configuredNodes } = status;
  const allNodes = [{ ...self, url: pt ? "📍 Este nó (primário)" : "📍 This node (primary)" }, ...nodes];
  const onlineCount = nodes.filter(n => n.online).length;

  const nodeLines = allNodes.map((n, i) => {
    const dot     = i === 0 ? "🟢" : n.online ? "🟢" : "🔴";
    const lat     = n.latencyMs >= 0 ? `${n.latencyMs}ms` : (pt ? "timeout" : "timeout");
    const cpuStr  = n.cpus ? ` | ${n.cpus}vCPU` : "";
    const memStr  = n.freeMem ? ` | ${n.freeMem}MB ${pt ? "livre" : "free"}` : "";
    const label   = i === 0 ? n.url : `Node ${i}: \`${n.url}\``;
    return `${dot} ${label} — **${lat}**${cpuStr}${memStr}`;
  });

  return new EmbedBuilder()
    .setColor(totalOnline >= configuredNodes + 1 ? COLORS.GREEN : totalOnline > 1 ? COLORS.GOLD : COLORS.RED)
    .setTitle(`🌐 ${pt ? "STATUS DO CLUSTER" : "CLUSTER STATUS"} — ${totalOnline} / ${configuredNodes + 1} ${pt ? "NÓS ONLINE" : "NODES ONLINE"}`)
    .setDescription(
      configuredNodes === 0
        ? (pt
          ? `> Nenhum nó peer configurado. Defina a variável de ambiente \`CLUSTER_NODES\`.\n> Ex.: \`CLUSTER_NODES=https://node2.replit.app,https://node3.replit.app\``
          : `> No peer nodes configured. Set \`CLUSTER_NODES\` environment variable.\n> e.g. \`CLUSTER_NODES=https://node2.replit.app,https://node3.replit.app\``)
        : (pt
          ? `> *"O comando do rei alcança todos os cantos do reino."*\n\n`
          : `> *"The king's command reaches all corners of the realm."*\n\n`) +
          nodeLines.join("\n")
    )
    .addFields(
      { name: pt ? "🟢 Online"      : "🟢 Online",      value: `**${totalOnline}** nó${totalOnline !== 1 ? "s" : ""}`, inline: true },
      { name: pt ? "🔴 Offline"     : "🔴 Offline",     value: `**${configuredNodes - onlineCount}** nó${(configuredNodes - onlineCount) !== 1 ? "s" : ""}`, inline: true },
      { name: pt ? "⚡ Poder Geass" : "⚡ Geass Power", value: `**${totalOnline}×** ${pt ? "multiplicador" : "multiplier"}`, inline: true },
      { name: pt ? "💻 CPU Primário" : "💻 Primary CPU", value: `${self.cpus} vCPU`, inline: true },
      { name: pt ? "💾 RAM Primário" : "💾 Primary RAM", value: `${self.freeMem} MB ${pt ? "livre" : "free"}`, inline: true },
      { name: "👁️ Geass Override", value: configuredNodes > 0
          ? (pt
            ? `Quando Geass Override dispara, ele **propaga automaticamente** para todos os ${configuredNodes} nós peer configurados. Cada nó roda todos os 35 vetores ARES simultaneamente.`
            : `When Geass Override fires, it **automatically fans out** to all ${configuredNodes} configured peer nodes. Each node runs all 35 ARES vectors simultaneously.`)
          : (pt ? "Defina `CLUSTER_NODES` para ativar o fan-out automático." : "Set `CLUSTER_NODES` to enable automatic fan-out."),
        inline: false },
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
