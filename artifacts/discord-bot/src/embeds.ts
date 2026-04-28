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

// ── PT-BR description translations ───────────────────────────────────────────
const METHOD_DESC_PT: Record<string, string> = {
  "geass-override":       "PODER MÁXIMO — 35 vetores simultâneos: H2+TCP+UDP+TLS+Slowloris+WAF+WebSocket+GraphQL+RUDY+Cache+Pipeline+Smuggling+QUIC+ICMP+DNS+NTP+Memcached+SSDP+DoH+gRPC",
  "waf-bypass":           "Fingerprint JA3+AKAMAI do Chrome — burla WAF Cloudflare/Akamai com 7 vetores simultâneos",
  "http2-flood":          "CVE-2023-44487 — rajada de 512 RST_STREAMs por sessão, milhões de req/s",
  "http2-continuation":   "CVE-2024-27316 — frames CONTINUATION infinitos, OOM no nginx/Apache — SEM patch para nginx ≤1.25.4",
  "hpack-bomb":           "Headers com indexação incremental → tempestade de despejo da tabela HPACK",
  "h2-settings-storm":    "Oscilação de SETTINGS + flood de WINDOW_UPDATE — drain triplo de CPU+memória H2",
  "http-pipeline":        "Pipeline keep-alive HTTP/1.1 — 512 requisições por escrita TCP, 300K+ req/s por thread",
  "ws-flood":             "Mantém milhares de conexões WebSocket abertas — uma goroutine/thread por conexão",
  "cache-poison":         "Preenche o cache CDN com chaves únicas — 100% de cache miss, origin origin fica sobrecarregado",
  "slowloris":            "25K conexões half-open — esgota o pool de threads do nginx/apache",
  "conn-flood":           "Abre e mantém milhares de sockets TLS — exaustão pré-HTTP",
  "tls-renego":           "Força renegociação TLS 1.2 — CPU cara de chave pública por conexão",
  "rudy-v2":              "multipart/form-data + boundary de 70 chars — prende threads do servidor, difícil de detectar",
  "http-flood":           "HTTP GET em alto volume — sobrecarrega os recursos do servidor web diretamente",
  "http-bypass":          "3 camadas com fingerprint Chrome: fetch+headers+drain lento — burla WAF/CDN",
  "quic-flood":           "Pacotes QUIC Initial — servidor aloca estado criptográfico por DCID → OOM",
  "ssl-death":            "Registros TLS de 1 byte — 40K decriptações AES-GCM/seg na CPU do servidor",
  "udp-flood":            "Flood de pacotes UDP brutos — satura a banda L4",
  "syn-flood":            "Exaustão de SYN_RECV TCP — preenche a tabela de conexões antes do handshake",
  "tcp-flood":            "Flood de pacotes TCP brutos contra portas abertas",
  "icmp-flood":           "ICMP real: raw-socket (CAP_NET_RAW), hping3, rajada de saturação UDP",
  "ntp-amp":              "Protocolo NTP binário real — mode7 monlist (CVE-2013-5211) + mode3 na porta 123",
  "dns-amp":              "Inunda servidores NS com subdomínios aleatórios — burla Cloudflare/CDN completamente",
  "mem-amp":              "Protocolo Memcached binário UDP real — get+stats na porta 11211",
  "ssdp-amp":             "Protocolo SSDP real na porta 1900 — rotaciona targets ST, exaustão da pilha UPnP",
  "slow-read":            "Pausa a janela TCP recv — buffer de envio do servidor enche, todas as threads bloqueiam na escrita",
  "range-flood":          "500 sub-requisições byte-range por req — fila de seek de disco/IO do servidor exaurida",
  "xml-bomb":             "Expansão de entidade XML aninhada — crash OOM do parser em qualquer endpoint SOAP/XMLRPC",
  "h2-ping-storm":        "300 frames PING/rajada × 2ms por conexão — servidor deve ACK cada um; exaustão de CPU",
  "http-smuggling":       "Dessincronização Transfer-Encoding/Content-Length — envenena a fila de requisições backend permanentemente",
  "doh-flood":            "Consultas DNS em formato wire via HTTPS — esgota o pool de threads do resolver recursivo",
  "keepalive-exhaust":    "Pipeline de 256 requisições por conexão mantida 10-20s — saturação de MaxKeepAliveRequests",
  "app-smart-flood":      "POST em /login /search /checkout — força consultas no banco, impossível de cachear",
  "large-header-bomb":    "32KB de headers aleatórios exaurem o alocador do parser HTTP, enche o buffer de headers do nginx",
  "http2-priority-storm": "Frames PRIORITY forçam o servidor a reconstruir a árvore de dependências de streams — 150K frames/seg",
  "h2-rst-burst":         "Pares HEADERS+RST_STREAM — sobrecarga pura na via de escrita, zero pressão no lado de leitura",
  "grpc-flood":           "Content-type application/grpc — esgota o pool de threads do handler gRPC",
};

export function getMethodDesc(id: string, lang: "en" | "pt", fallback?: string): string {
  if (lang === "pt") return METHOD_DESC_PT[id] ?? fallback ?? id;
  return fallback ?? id;
}

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
  up:          boolean;
  latencyMs:   number;
  statusCode?: number | null;
  reason?:     string;
};

const CONN_METHODS = new Set([
  "slowloris", "conn-flood", "geass-override", "rudy", "rudy-v2", "ws-flood",
  "tls-renego", "http2-continuation", "ssl-death", "slow-read", "keepalive-exhaust",
  "http-smuggling", "h2-ping-storm",
]);

// Definitive down: ECONNREFUSED or HTTP 5xx (server-side crash/error)
const DEFINITIVE_DOWN = (reason?: string) =>
  Boolean(reason?.includes("refused") || reason?.includes("HTTP 5") || reason?.includes("crash"));

const sparkDot = (p: ProbeResult) => {
  if (!p.up && DEFINITIVE_DOWN(p.reason)) return "🔴";
  if (!p.up) return "🟠";
  if (p.latencyMs > 5000) return "⬛";
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
    "geass-override":        "All 37 ARES vectors converged — ABSOLUTE ANNIHILATION (OMNIVECT ∞)",
    "slow-read":             "Server send buffer full — all threads blocked on TCP write",
    "range-flood":           "500× byte-range I/O exhausted disk seek queue — server froze",
    "xml-bomb":              "XML entity expansion exceeded memory — OOM parser crash",
    "h2-ping-storm":         "H2 PING ACK queue overflowed — server CPU melted",
    "http-smuggling":        "Request queue poisoned — backend thread pool deadlocked",
    "doh-flood":             "DNS resolver thread pool exhausted — all lookups queued forever",
    "keepalive-exhaust":     "Keep-alive pool saturated — MaxKeepAliveRequests hit on all workers",
    "app-smart-flood":       "DB query pool drained — all backend threads blocked on SQL",
    "large-header-bomb":     "HTTP parser buffer overflowed — server OOM on header allocation",
    "http2-priority-storm":  "H2 stream dependency tree exhausted — priority queue OOM",
    "http2-flood":           "H2 connection table saturated (CVE-2023-44487)",
    "http2-continuation":    "Header reassembly buffer exhausted (CVE-2024-27316) — OOM",
    "waf-bypass":            "WAF layer overwhelmed — origin exposed, all requests hitting backend raw",
    "conn-flood":            "TLS socket table exhausted — nginx/Apache fell",
    "slowloris":             "Thread pool saturated — server frozen on partial connections",
    "tls-renego":            "TLS CPU exhausted — handshake queue overflowed",
    "ws-flood":              "WebSocket goroutine pool drained — server unresponsive",
    "graphql-dos":           "GraphQL resolver CPU limit hit — exponential query collapse",
    "quic-flood":            "QUIC DCID table exhausted — HTTP/3 crypto state OOM",
    "cache-poison":          "CDN cache poisoned — 100% origin miss, server crushed",
    "rudy-v2":               "Multipart upload buffer exhausted — server thread pool frozen",
    "ssl-death":             "TLS crypto thread pool saturated — AES-GCM queue overflowed",
    "udp-flood":             "UDP bandwidth saturated at L4 — pipes full",
    "syn-flood":             "TCP connection table exhausted — SYN_RECV backlog full",
    "http-bypass":           "WAF bypassed via proxy rotation — origin flooded directly",
    "dns-amp":               "NS server flooded — DNS resolution chain collapsed",
    "h2-rst-burst":          "RST_STREAM storm exhausted H2 session state — CVE-2023-44487 variant",
    "grpc-flood":            "gRPC channel pool exhausted — server goroutines saturated",
    "icmp-flood":            "ICMP echo queue overflowed — kernel packet buffer full",
    "ntp-amp":               "NTP amplification overloaded inbound — bandwidth ceiling hit",
    "mem-amp":               "Memcached amplification collapsed inbound bandwidth",
    "ssdp-amp":              "SSDP reflection packets saturated UDP socket queue",
    "tcp-flood":             "TCP segment queue exhausted — kernel connection table full",
    "hpack-bomb":            "HPACK huffman expansion OOM — header compression table exploded",
    "h2-settings-storm":     "H2 SETTINGS flood exhausted ACK buffer — connection deadlocked",
    "http-pipeline":         "HTTP pipelining queue filled — worker threads all blocked on I/O",
    "rudy":                  "Slow POST body exhausted backend upload thread pool",
  };

  let statusLine: string;
  if (!last.up && DEFINITIVE_DOWN(last.reason) && downRun5) {
    const cause = causeMap[method] ?? "Server resources exhausted";
    const codeTag = last.statusCode ? ` [HTTP ${last.statusCode}]` : "";
    statusLine = `**💀 TARGET DOWN**${codeTag} — ${cause}`;
  } else if (!last.up && DEFINITIVE_DOWN(last.reason)) {
    const downCount = recent8.filter(p => !p.up && DEFINITIVE_DOWN(p.reason)).length;
    const codeTag   = last.statusCode ? ` HTTP ${last.statusCode}` : "";
    statusLine = `**🔴 DOWN${codeTag}** — (${downCount}/5 confirms) — ${last.reason?.replace(/^HTTP \d+ — /, "") ?? "server error"}`;
  } else if (!last.up) {
    statusLine = `**🟠 UNREACHABLE** — ${last.reason ?? "network error"} — may be our outbound`;
  } else if (last.latencyMs > 5000) {
    const codeTag = last.statusCode ? ` [${last.statusCode}]` : "";
    statusLine = `**⬛ TIMEOUT${codeTag}** — probe timed out (>5s) — target slow or our pipes saturated`;
  } else if (last.latencyMs > 4000) {
    const codeTag = last.statusCode ? ` [${last.statusCode}]` : "";
    statusLine = `**🟡 CRITICAL LAG${codeTag}** — ${last.latencyMs.toLocaleString()}ms (near collapse)`;
  } else if (last.latencyMs > 1500) {
    const codeTag = last.statusCode ? ` [${last.statusCode}]` : "";
    statusLine = `**🟠 UNDER STRESS${codeTag}** — ${last.latencyMs.toLocaleString()}ms (response degrading)`;
  } else if (last.latencyMs > 800) {
    const codeTag = last.statusCode ? ` [${last.statusCode}]` : "";
    statusLine = `**🟡 SLOWING${codeTag}** — ${last.latencyMs.toLocaleString()}ms (attack taking effect)`;
  } else {
    const codeTag = last.statusCode ? ` [${last.statusCode}]` : "";
    statusLine = `**🟢 ONLINE${codeTag}** — ${last.latencyMs.toLocaleString()}ms (resisting)`;
  }

  const legend = "🟢 OK  🟠 Stress  🟡 Slow  ⬛ Timeout  🔴 Down";
  return { name: "🌐 Target Status", value: `${dots}\n${statusLine}\n-# ${legend}`, inline: false };
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
  const isRunning = attack.status === "running";
  const color     = isRunning ? COLORS.CRIMSON
    : attack.status === "finished" ? COLORS.GREEN
    : COLORS.GRAY;
  const emoji     = METHOD_EMOJIS[attack.method] ?? "⚡";
  const showConns = CONN_METHODS.has(attack.method);
  const trend     = trendArrow(ppsHistory);
  const isGeass   = attack.method === "geass-override";

  // ── Compact header: all key config in one description line ───────────────
  const configLine = `\`${attack.target}\` · ${emoji} **${methodLabel(attack.method)}** · \`#${attack.id}\` · **${fmtNum(attack.threads)}t** · **${attack.duration}s**`;

  let statusDesc: string;
  if (isRunning) {
    statusDesc = isGeass
      ? "👁️ **ARES OMNIVECT ∞** — all CVEs active simultaneously"
      : "🔴 **ATTACK ACTIVE** — live metrics updating every 8s";
  } else {
    const icon = attack.status === "finished" ? "✅" : attack.status === "stopped" ? "⏹️" : "⚠️";
    statusDesc = `${icon} **${attack.status.toUpperCase()}**`;
  }

  const proxyLine = proxyCount > 0
    ? `\n🌐 **${proxyCount.toLocaleString()}** residential IPs in rotation`
    : "";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${isRunning ? "GEASS COMMAND ACTIVE" : `ATTACK #${attack.id} ${attack.status.toUpperCase()}`}`)
    .setDescription(`${configLine}\n${statusDesc}${proxyLine}`);

  if (isRunning) {
    // ── Single compact live metrics field ───────────────────────────────────
    const ppsStr   = `⚡ **${fmtPps(livePps)}**${trend}`;
    const bpsStr   = liveBps > 0 ? `📶 **${fmtBps(liveBps)}** ${bpsBar(liveBps)}` : "📶 _ramping..._";
    const pktsStr  = `📦 **${fmtPkt(attack.packetsSent)}**`;
    const bytesStr = `💾 **${fmtBytes(attack.bytesSent)}**`;
    const timeStr  = `⏳ **${elapsed(attack.startedAt)}**`;
    const connLine = showConns
      ? `\n🔗 ${liveConns > 0 ? connBar(liveConns) : "_conns ramping..._"}`
      : "";

    embed.addFields({
      name:   "📡 Live Metrics",
      value:  `${ppsStr}  ·  ${bpsStr}\n${pktsStr} sent  ·  ${bytesStr}  ·  ${timeStr}${connLine}`,
      inline: false,
    });

    // Progress bar (zero-width name to keep compact)
    embed.addFields({ name: "\u200b", value: progressBar(attack.startedAt, attack.duration), inline: false });

    // Target status sparkline
    embed.addFields(buildStatusField(targetHistory, attack.method));

  } else {
    // ── Compact final report ─────────────────────────────────────────────────
    const elapsedSec = attack.stoppedAt && attack.startedAt
      ? Math.max(1, Math.round((new Date(attack.stoppedAt).getTime() - new Date(attack.startedAt).getTime()) / 1000))
      : attack.duration;
    const avgPps = elapsedSec > 0 ? Math.round(attack.packetsSent / elapsedSec) : 0;
    const avgBps = elapsedSec > 0 ? Math.round((attack.bytesSent * 8) / elapsedSec) : 0;
    const minSec = Math.floor(elapsedSec / 60);
    const remSec = elapsedSec % 60;
    const durStr = minSec > 0 ? `${minSec}m ${remSec}s` : `${elapsedSec}s`;

    embed.addFields({
      name:   "📊 Final Report",
      value:  `📦 **${fmtPkt(attack.packetsSent)}** · 💾 **${fmtBytes(attack.bytesSent)}** · ⏳ **${durStr}**\n📈 Avg rate: **${fmtPps(avgPps)}** · 📶 Avg BW: **${fmtBps(avgBps)}**`,
      inline: false,
    });

    if (targetHistory.length > 0) {
      embed.addFields(buildStatusField(targetHistory, attack.method));
    }
  }

  embed.setFooter(footer(`#${attack.id} • updates every 8s`)).setTimestamp();
  return embed;
}

// ── Attack Started Embed ──────────────────────────────────────────────────────
export function buildStartEmbed(attack: Attack, proxyCount = 0, lang: "en" | "pt" = "en"): EmbedBuilder {
  const pt      = lang === "pt";
  const emoji   = METHOD_EMOJIS[attack.method] ?? "⚡";
  const isGeass = attack.method === "geass-override";

  const quote = pt
    ? `> *"NÃO. POR CAUSA DISSO… nós lutamos."*  — **Lelouch vi Britannia**`
    : `> *"No. BECAUSE of that… We fight."*  — **Lelouch vi Britannia**`;

  const geassLine = isGeass
    ? (pt ? "\n👁️ **ARES OMNIVECT ∞** — 35 vetores simultâneos" : "\n👁️ **ARES OMNIVECT ∞** — 35 simultaneous vectors")
    : "";

  const proxyLine = proxyCount > 0
    ? (pt
        ? `\n🌐 **${proxyCount.toLocaleString()} IPs residenciais** em rotação`
        : `\n🌐 **${proxyCount.toLocaleString()} residential IPs** rotating`)
    : "";

  const configLine = `\`${attack.target}\` · ${emoji} **${methodLabel(attack.method)}** · \`#${attack.id}\` · **${fmtNum(attack.threads)}t** · **${attack.duration}s**`;

  return new EmbedBuilder()
    .setColor(COLORS.CRIMSON)
    .setTitle(pt ? `${emoji} COMANDO GEASS EMITIDO` : `${emoji} GEASS COMMAND ISSUED`)
    .setDescription(`${quote}${geassLine}${proxyLine}\n\n${configLine}`)
    .setImage("attachment://lelouch.gif")
    .setThumbnail("attachment://geass-symbol.png")
    .addFields({
      name:   pt ? "🔴 Inicializando" : "🔴 Initializing",
      value:  pt ? "*Métricas ao vivo em instantes — esta mensagem atualiza automaticamente.*" : "*Live metrics in moments — this message updates automatically.*",
      inline: false,
    })
    .setFooter(footer(pt ? `ID #${attack.id}` : `Attack #${attack.id}`))
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
  const avgPps = elapsedSec > 0 ? Math.round(packets / elapsedSec) : 0;
  const avgBps = elapsedSec > 0 ? Math.round((bytes * 8) / elapsedSec) : 0;
  const minSec = Math.floor(elapsedSec / 60);
  const remSec = elapsedSec % 60;
  const durStr = minSec > 0 ? `${minSec}m ${remSec}s` : `${elapsedSec}s`;

  return new EmbedBuilder()
    .setColor(finishColor)
    .setTitle(`${finishIcon} ATTACK #${attackId} — ${status.toUpperCase()}`)
    .setDescription(`${emoji} **${methodLabel(method)}** → \`${target}\``)
    .addFields({
      name:   "📊 Damage Report",
      value:  `⏱️ **${durStr}**  ·  📦 **${fmtPkt(packets)}**  ·  💾 **${fmtBytes(bytes)}**\n📈 Avg rate: **${fmtPps(avgPps)}**  ·  📶 Avg BW: **${fmtBps(avgBps)}**`,
      inline: false,
    })
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
      name: pt ? "🔴 Ativos Agora" : "🔴 Active Now",
      value: running.map(a => {
        const e = METHOD_EMOJIS[a.method] ?? "⚡";
        return `\`#${a.id}\` ${e} **${methodLabel(a.method)}**\n┗ \`${a.target}\` · ${fmtPkt(a.packetsSent)} · ⏳ ${elapsed(a.startedAt)} · **${a.threads}t**`;
      }).join("\n"),
      inline: false,
    });
  }

  if (completed.length > 0) {
    embed.addFields({
      name: pt ? "📋 Histórico Recente" : "📋 Recent History",
      value: completed.map(a => {
        const icon = a.status === "finished" ? "✅" : a.status === "stopped" ? "⏹️" : "❌";
        const e    = METHOD_EMOJIS[a.method] ?? "⚡";
        const elapsedSec = a.stoppedAt && a.startedAt
          ? Math.max(1, Math.round((new Date(a.stoppedAt).getTime() - new Date(a.startedAt).getTime()) / 1000))
          : a.duration;
        const minSec = Math.floor(elapsedSec / 60);
        const remSec = elapsedSec % 60;
        const durStr = minSec > 0 ? `${minSec}m${remSec}s` : `${elapsedSec}s`;
        return `${icon} \`#${a.id}\` ${e} **${methodLabel(a.method)}** → \`${a.target}\` · ${fmtPkt(a.packetsSent)} · ${fmtBytes(a.bytesSent)} · ${durStr}`;
      }).join("\n"),
      inline: false,
    });
  }

  if (attacks.length === 0) {
    embed.addFields({
      name: pt ? "Nenhum ataque" : "No attacks found",
      value: pt ? "Use `/attack start` para iniciar um Comando Geass." : "Use `/attack start` to launch a Geass command.",
      inline: false,
    });
  }

  embed.setFooter(footer(pt ? `${attacks.length} no total` : `${attacks.length} total`)).setTimestamp();
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
        const medal  = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        const tier   = tierIcon(r.tier ?? "");
        const reason = getMethodDesc((r as { method?: string }).method ?? "", lang, r.reason ?? "");
        return `${medal} ${tier} **${r.name}** — Score \`${r.score}\` | **${r.tier ?? "?"}**\n> ${reason}`;
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
        const num  = start + idx + 1;
        const desc = getMethodDesc(m.id, lang, m.description ?? undefined);
        const meta = pt
          ? `\`${m.tier ?? "?"}\` · Camada \`${m.layer ?? "?"}\` · \`${m.protocol ?? "?"}\``
          : `\`${m.tier ?? "?"}\` · Layer \`${m.layer ?? "?"}\` · \`${m.protocol ?? "?"}\``;
        return {
          name:   `${num}. ${tierIcon(m.tier ?? "")} ${METHOD_EMOJIS[m.id] ?? "⚡"} ${m.name}`,
          value:  `${desc}\n${meta}`,
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
      ? "`/geass`  — Geass Override ∞ · 42 vetores ARES OMNIVECT ∞\n`/attack start`  — Iniciar qualquer vetor\n`/attack stop`   — Encerrar por ID\n`/attack list`   — Ver todos os ataques\n`/attack stats`  — Estatísticas da sessão"
      : "`/geass`  — Geass Override ∞ · 42 vectors ARES OMNIVECT ∞\n`/attack start`  — Launch any single vector\n`/attack stop`   — Terminate by ID\n`/attack list`   — View all attacks\n`/attack stats`  — Session statistics",
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

// ── Site Checker Embed ────────────────────────────────────────────────────────
export interface CheckResult {
  target:         string;
  statusCode:     number | null;
  responseTimeMs: number;
  serverHeader:   string | null;
  contentType:    string | null;
  redirected:     boolean;
  finalUrl:       string | null;
  httpVersion:    string | null;
  error:          string | null;
  // Multi-probe extras
  probeCount?:    number;
  bestMs?:        number;
  worstMs?:       number;
  avgMs?:         number;
  successCount?:  number;
  cdn?:           string | null;
  protection?:    string | null;
  cfRay?:         string | null;
  xCacheHeader?:  string | null;
}

export function buildCheckEmbed(r: CheckResult, lang: "en" | "pt" = "pt"): EmbedBuilder {
  const pt   = lang === "pt";
  const up   = r.statusCode !== null && r.statusCode < 500 && !r.error;
  const warn = r.statusCode !== null && r.statusCode >= 400 && r.statusCode < 500;

  const color = r.error        ? COLORS.RED
              : warn           ? COLORS.GOLD
              : up             ? COLORS.GREEN
              : COLORS.RED;

  const statusIcon = r.error   ? "🔴"
                   : warn      ? "🟡"
                   : up        ? "🟢"
                   : "🔴";

  const pingBar = (ms: number): string => {
    const n = Math.min(20, Math.max(1, Math.round(ms / 50)));
    const clr = ms < 200 ? "🟩" : ms < 800 ? "🟨" : "🟥";
    return clr.repeat(n);
  };

  const T = {
    title:   pt ? `${statusIcon} CHECKER DE SITE — GEASS SCAN` : `${statusIcon} SITE CHECKER — GEASS SCAN`,
    desc:    pt ? `Verificando resposta de \`${r.target}\`` : `Checking response of \`${r.target}\``,
    status:  pt ? "📡 Status HTTP" : "📡 HTTP Status",
    ping:    pt ? "⚡ Latência" : "⚡ Latency",
    server:  pt ? "🖥️ Servidor" : "🖥️ Server",
    ctype:   pt ? "📄 Conteúdo" : "📄 Content-Type",
    redir:   pt ? "🔀 Redirecionamento" : "🔀 Redirect",
    verdict: pt ? "🎯 Resultado" : "🎯 Verdict",
    unknown: pt ? "Desconhecido" : "Unknown",
    online:  pt ? "✅ **ONLINE** — respondendo normalmente" : "✅ **ONLINE** — responding normally",
    warn400: pt ? "🟡 **PARCIAL** — respondeu com erro de cliente" : "🟡 **PARTIAL** — client error response",
    offline: pt ? "🔴 **OFFLINE** — sem resposta ou erro de servidor" : "🔴 **OFFLINE** — no response or server error",
    errLabel:pt ? "❌ Erro" : "❌ Error",
  };

  const statusLine = r.statusCode !== null
    ? `\`${r.statusCode}\` ${r.httpVersion ? `· \`${r.httpVersion}\`` : ""}`
    : (pt ? "`sem resposta`" : "`no response`");

  // Build latency display from multi-probe data if available, else single probe
  const hasMulti = typeof r.bestMs === "number" && typeof r.worstMs === "number";
  const pingLine = r.error
    ? (pt ? "n/a (sem resposta)" : "n/a (no response)")
    : hasMulti
      ? [
          `⚡ Melhor: \`${r.bestMs}ms\``,
          `🟡 Pior:  \`${r.worstMs}ms\``,
          `📊 Média: \`${r.avgMs}ms\``,
          pingBar(r.avgMs ?? r.responseTimeMs),
        ].join("\n")
      : `\`${r.responseTimeMs}ms\`\n${pingBar(r.responseTimeMs)}`;

  const probeSuccessLine = hasMulti && typeof r.probeCount === "number"
    ? `${r.successCount ?? 0}/${r.probeCount} probes OK`
    : null;

  const verdict = r.error    ? T.offline
                : warn       ? T.warn400
                : up         ? T.online
                : T.offline;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(T.title)
    .setDescription(r.error
      ? (pt ? `❌ Falha ao conectar em \`${r.target}\`` : `❌ Could not connect to \`${r.target}\``)
      : T.desc
    )
    .addFields(
      { name: T.status,  value: statusLine + (probeSuccessLine ? `\n-# ${probeSuccessLine}` : ""), inline: true },
      { name: T.ping,    value: pingLine, inline: true },
      { name: T.server,  value: r.serverHeader  ? `\`${r.serverHeader}\``  : T.unknown, inline: true },
    );

  // CDN / Protection row
  const cdnLine = r.cdn ? `🛡️ CDN: \`${r.cdn}\`` : null;
  const protLine = r.protection ? `🔒 WAF: \`${r.protection}\`` : null;
  const cfRayLine = r.cfRay ? `-# CF-Ray: \`${r.cfRay}\`` : null;

  if (cdnLine || protLine) {
    embed.addFields({
      name:   pt ? "🌐 Infra" : "🌐 Infra",
      value:  [cdnLine, protLine, cfRayLine].filter(Boolean).join("\n") || T.unknown,
      inline: true,
    });
  }

  embed.addFields(
    { name: T.ctype,   value: r.contentType   ? `\`${r.contentType.split(";")[0]}\`` : T.unknown, inline: true },
    { name: T.redir,   value: r.redirected && r.finalUrl ? `✅ → \`${r.finalUrl.slice(0, 60)}\`` : "❌", inline: true },
    { name: T.verdict, value: verdict, inline: false },
  );

  if (r.error) {
    embed.addFields({ name: T.errLabel, value: `\`${r.error.slice(0, 200)}\``, inline: false });
  }

  embed.setFooter(footer(pt ? "3 probes paralelas enviadas" : "3 parallel probes sent")).setTimestamp();
  return embed;
}

// ── Server Health Embed ───────────────────────────────────────────────────────
export interface HealthData {
  status:    "healthy" | "warning" | "critical";
  uptimeSec: number;
  process:   { heapUsedMB: number; heapTotalMB: number; rssMB: number; pid: number };
  system:    { cpus: number; load1: number; load5: number; load15: number; loadPct: number;
               totalRamMB: number; usedRamMB: number; freeRamMB: number; ramPct: number;
               hostname: string; platform: string };
  attacks:   { active: number; totalConns: number };
}

export interface GlobalStats {
  totalAttacks:   number;
  runningAttacks: number;
  totalPacketsSent: number;
  totalBytesSent:   number;
}

export function buildHealthEmbed(h: HealthData, stats: GlobalStats | null, lang: "en" | "pt" = "pt"): EmbedBuilder {
  const pt = lang === "pt";

  const fmtUptime = (s: number): string => {
    const d  = Math.floor(s / 86400);
    const hr = Math.floor((s % 86400) / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const sc = s % 60;
    if (d  > 0) return `${d}d ${hr}h ${m}m`;
    if (hr > 0) return `${hr}h ${m}m ${sc}s`;
    if (m  > 0) return `${m}m ${sc}s`;
    return `${sc}s`;
  };

  const bar = (pct: number, size = 16): string => {
    const n   = Math.min(size, Math.max(0, Math.round(pct / 100 * size)));
    const clr = pct < 60 ? "🟩" : pct < 85 ? "🟨" : "🟥";
    return clr.repeat(n) + "⬛".repeat(size - n);
  };

  const color = h.status === "healthy" ? COLORS.GREEN
              : h.status === "warning" ? COLORS.GOLD
              : COLORS.RED;
  const icon  = h.status === "healthy" ? "🟢" : h.status === "warning" ? "🟡" : "🔴";

  const T = {
    title:   pt ? `${icon} LELOUCH BRITANNIA — MÉTRICAS DO SERVIDOR` : `${icon} LELOUCH BRITANNIA — SERVER METRICS`,
    status:  pt ? "📡 Status" : "📡 Status",
    uptime:  pt ? "⏱ Uptime" : "⏱ Uptime",
    ram:     pt ? `🧠 RAM  (${h.system.ramPct}%)` : `🧠 RAM  (${h.system.ramPct}%)`,
    cpu:     pt ? `⚡ CPU  (${h.system.loadPct}%)` : `⚡ CPU  (${h.system.loadPct}%)`,
    proc:    pt ? "🟣 Processo" : "🟣 Process",
    atks:    pt ? "⚔️ Ataques" : "⚔️ Attacks",
    pkts:    pt ? "📦 Pacotes" : "📦 Packets",
    data:    pt ? "💾 Dados" : "💾 Data",
  };

  const statusVal = pt
    ? `\`${h.status === "healthy" ? "SAUDÁVEL" : h.status === "warning" ? "ATENÇÃO" : "CRÍTICO"}\` · nó \`${h.system.hostname}\``
    : `\`${h.status.toUpperCase()}\` · node \`${h.system.hostname}\``;

  const ramVal  = `${bar(h.system.ramPct)}\n\`${h.system.usedRamMB} / ${h.system.totalRamMB} MB\`  ·  ${pt ? "livre" : "free"}: \`${h.system.freeRamMB} MB\``;
  const cpuVal  = `${bar(h.system.loadPct)}\n\`${h.system.cpus}\` cores  ·  1m \`${h.system.load1.toFixed(2)}\`  5m \`${h.system.load5.toFixed(2)}\`  15m \`${h.system.load15.toFixed(2)}\``;
  const procVal = `Heap: \`${h.process.heapUsedMB}/${h.process.heapTotalMB} MB\`  RSS: \`${h.process.rssMB} MB\``;
  const atksVal = stats
    ? `${pt ? "Ativos" : "Active"}: \`${h.attacks.active}\`  ${pt ? "Conns" : "Conns"}: \`${h.attacks.totalConns.toLocaleString()}\`\n${pt ? "Total histórico" : "All-time"}: \`${stats.totalAttacks.toLocaleString()}\``
    : `${pt ? "Ativos" : "Active"}: \`${h.attacks.active}\`  Conns: \`${h.attacks.totalConns.toLocaleString()}\``;
  const pktsVal = stats ? `\`${stats.totalPacketsSent.toLocaleString()}\`` : "`—`";
  const dataVal = stats ? `\`${fmtBytes(stats.totalBytesSent)}\`` : "`—`";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(T.title)
    .addFields(
      { name: T.status,  value: statusVal, inline: true  },
      { name: T.uptime,  value: `\`${fmtUptime(h.uptimeSec)}\``, inline: true },
      { name: T.ram,     value: ramVal,    inline: false },
      { name: T.cpu,     value: cpuVal,    inline: false },
      { name: T.proc,    value: procVal,   inline: true  },
      { name: T.atks,    value: atksVal,   inline: true  },
      { name: T.pkts,    value: pktsVal,   inline: true  },
      { name: T.data,    value: dataVal,   inline: true  },
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
