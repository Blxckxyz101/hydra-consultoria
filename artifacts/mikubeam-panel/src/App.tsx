import { useState, useEffect, useRef, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

interface LogEntry { id: number; text: string; type: "info" | "success" | "error" | "warn"; ts: number; }
interface CheckResult { up: boolean; status: number; statusText: string; responseTime: number; error: string | null; }
interface Preset { label: string; method: string; packetSize: number; duration: number; delay: number; threads: number; }

const PRESETS: Preset[] = [
  { label: "Quick Strike", method: "http-flood", packetSize: 64, duration: 30, delay: 50, threads: 8 },
  { label: "Heavy Assault", method: "udp-flood", packetSize: 1024, duration: 120, delay: 10, threads: 64 },
  { label: "Stealth Mode", method: "slowloris", packetSize: 32, duration: 300, delay: 500, threads: 4 },
  { label: "TCP Barrage", method: "tcp-flood", packetSize: 512, duration: 60, delay: 20, threads: 32 },
];

let _lid = 0;
function mkLog(text: string, type: LogEntry["type"] = "info"): LogEntry {
  return { id: ++_lid, text, type, ts: Date.now() };
}

function playTone(type: "start" | "stop" | "tick" | "check") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sawtooth";
    if (type === "start") {
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    } else if (type === "stop") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(); osc.stop(ctx.currentTime + 0.55);
    } else if (type === "tick") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.start(); osc.stop(ctx.currentTime + 0.07);
    } else {
      osc.frequency.setValueAtTime(528, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1056, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    }
  } catch { /* audio blocked */ }
}

function statusColor(code: number) {
  if (code === 0) return "#888";
  if (code < 300) return "#2ecc71";
  if (code < 400) return "#f39c12";
  if (code < 500) return "#C0392B";
  return "#8e44ad";
}

function fmtNum(n: number) { return n.toLocaleString(); }
function fmtBytes(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return n + " B";
}

function GeassEye() {
  return (
    <div className="geass-eye-bg" aria-hidden="true">
      <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="150" cy="150" rx="130" ry="65" stroke="rgba(212,175,55,0.13)" strokeWidth="1.5" fill="none"/>
        <ellipse cx="150" cy="150" rx="100" ry="50" stroke="rgba(212,175,55,0.08)" strokeWidth="1" fill="none"/>
        <circle cx="150" cy="150" r="42" stroke="rgba(192,57,43,0.25)" strokeWidth="1.5" fill="none"/>
        <circle cx="150" cy="150" r="22" stroke="rgba(192,57,43,0.18)" strokeWidth="1" fill="none"/>
        <circle cx="150" cy="150" r="8" fill="rgba(192,57,43,0.18)"/>
        {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => {
          const r = (deg * Math.PI) / 180;
          return <line key={deg}
            x1={150 + Math.cos(r)*50} y1={150 + Math.sin(r)*50}
            x2={150 + Math.cos(r)*140} y2={150 + Math.sin(r)*140}
            stroke="rgba(212,175,55,0.07)" strokeWidth="1"/>;
        })}
      </svg>
    </div>
  );
}

function Panel() {
  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("http-flood");
  const [packetSize, setPacketSize] = useState(64);
  const [duration, setDuration] = useState(60);
  const [delay, setDelay] = useState(100);
  const [threads, setThreads] = useState(16);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showWebhook, setShowWebhook] = useState(false);

  const [currentAttackId, setCurrentAttackId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([mkLog("Awaiting Geass command...", "info")]);
  const [progress, setProgress] = useState(0);
  const [packetsPerSec, setPacketsPerSec] = useState(0);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("lb-favorites") || "[]"); } catch { return []; }
  });
  const [showFavs, setShowFavs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [entered, setEntered] = useState(false);

  const [checkerUrl, setCheckerUrl] = useState("");
  const [checkerResult, setCheckerResult] = useState<CheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);
  const durationRef = useRef(60);
  const prevPacketsRef = useRef(0);

  const { data: methods = [] } = useListMethods();
  const createAttack = useCreateAttack();
  const stopAttack = useStopAttack();
  const { data: stats, refetch: refetchStats } = useGetAttackStats({ query: { refetchInterval: isRunning ? 2000 : 10000 } });
  const { data: currentAttack, refetch: refetchAttack } = useGetAttack(
    currentAttackId ?? 0,
    { query: { enabled: currentAttackId !== null, refetchInterval: isRunning ? 900 : false } }
  );
  const { data: allAttacks = [], refetch: refetchHistory } = useListAttacks({ query: { refetchInterval: showHistory ? 5000 : false } });

  const addLog = useCallback((text: string, type: LogEntry["type"] = "info") => {
    setLogs(prev => [...prev.slice(-79), mkLog(text, type)]);
  }, []);

  useEffect(() => { setEntered(true); }, []);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!isRunning || startTimeRef.current === null) return;
    const iv = setInterval(() => {
      if (startTimeRef.current === null) return;
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const pct = Math.min((elapsed / durationRef.current) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        setIsRunning(false); setProgress(100);
        addLog("♟ Geass lifted — operation complete.", "success");
        if (soundEnabled) playTone("stop");
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        refetchStats(); refetchHistory();
        clearInterval(iv);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [isRunning, addLog, soundEnabled, refetchStats, refetchHistory]);

  useEffect(() => {
    if (!currentAttack || !isRunning) return;
    const packets = currentAttack.packetsSent ?? 0;
    const pps = Math.max(0, packets - prevPacketsRef.current);
    setPacketsPerSec(pps);
    prevPacketsRef.current = packets;
    if (pps > 0) {
      addLog(`♟ ${fmtNum(pps)} pkts/s | total ${fmtNum(packets)} | ${fmtBytes(currentAttack.bytesSent ?? 0)}`, "info");
      if (soundEnabled) playTone("tick");
    }
  }, [currentAttack, isRunning, addLog, soundEnabled]);

  async function handleLaunch() {
    if (!target.trim()) { addLog("✕ No target specified.", "error"); return; }
    if (isRunning) {
      if (currentAttackId !== null) {
        addLog("♟ Revoking Geass — stopping strike...", "warn");
        try {
          await stopAttack.mutateAsync({ id: currentAttackId });
          addLog("♟ Strike stopped.", "success");
          if (soundEnabled) playTone("stop");
          if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        } catch { addLog("✕ Failed to stop.", "error"); }
        setIsRunning(false); setProgress(0);
        setCurrentAttackId(null); prevPacketsRef.current = 0;
        setPacketsPerSec(0); refetchHistory();
      }
      return;
    }
    const port = method.includes("http") ? 80 : method.includes("dns") ? 53 : 443;
    addLog(`♟ Geass granted — targeting ${target}`, "info");
    addLog(`  Method: ${method} | Duration: ${duration}s | Threads: ${threads}`, "info");
    if (soundEnabled) playTone("start");
    if ("vibrate" in navigator) navigator.vibrate([200]);
    try {
      const result = await createAttack.mutateAsync({
        data: { target: target.trim(), port, method, duration, threads, webhookUrl: webhookUrl.trim() || null },
      });
      setCurrentAttackId(result.id);
      setIsRunning(true);
      startTimeRef.current = Date.now();
      durationRef.current = duration;
      prevPacketsRef.current = 0;
      setProgress(0); setPacketsPerSec(0);
      addLog(`♟ Strike launched [ID #${result.id}] — ${duration}s duration`, "success");
      saveFavorite(target.trim()); refetchHistory(); refetchStats();
    } catch { addLog("✕ Launch failed — check connection.", "error"); }
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
    addLog(`♟ Preset applied: ${p.label}`, "info");
    if (soundEnabled) playTone("tick");
  }
  function handleClearLogs() { setLogs([mkLog("Terminal cleared.", "info")]); }
  function handleExportLogs() {
    const txt = logs.map(l => `[${new Date(l.ts).toISOString()}] ${l.text}`).join("\n");
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `lelouch-log-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
    addLog("♟ Logs exported as .txt", "success");
  }
  async function handleCheckSite() {
    const urlToCheck = checkerUrl.trim() || target.trim();
    if (!urlToCheck) { addLog("✕ Enter a URL to check.", "error"); return; }
    setIsChecking(true); setCheckerResult(null);
    if (soundEnabled) playTone("tick");
    try {
      const res = await fetch(`${BASE}/api/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToCheck }),
      });
      const data: CheckResult = await res.json();
      setCheckerResult(data);
      if (soundEnabled) playTone("check");
      const msg = data.up
        ? `♟ ${urlToCheck} → HTTP ${data.status} ${data.statusText} (${data.responseTime}ms)`
        : `✕ ${urlToCheck} → DOWN — ${data.statusText} (${data.responseTime}ms)`;
      addLog(msg, data.up ? "success" : "error");
    } catch { addLog("✕ Site check network error.", "error"); }
    setIsChecking(false);
  }

  const totalPackets = isRunning ? (currentAttack?.packetsSent ?? 0) : (stats?.totalPacketsSent ?? 0);
  const activeBots = isRunning ? threads : (stats?.runningAttacks ?? 0);

  return (
    <div className={`lelouch-page ${entered ? "page-entered" : ""}`}>
      <GeassEye />

      <div className="lelouch-content">
        <header className="lelouch-header">
          {isRunning && (
            <div className="geass-badge">
              <span className="geass-badge-dot" />
              GEASS ACTIVE
            </div>
          )}
          <h1 className="lelouch-title">Lelouch Britannia</h1>
          <p className="lelouch-subtitle">Because absolute power is even more beautiful when wielded by Zero.</p>
        </header>

        <div className="presets-strip">
          {PRESETS.map(p => (
            <button key={p.label} className="preset-btn" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>

        <div className="lelouch-card">
          <div className="lelouch-gif-wrapper">
            <img src="/lelouch.gif" alt="Lelouch vi Britannia" className="lelouch-gif"/>
            <div className="scanlines" aria-hidden="true"/>
            <div className="lelouch-gif-overlay" aria-hidden="true"/>
          </div>

          <div className="lelouch-card-body">
            <div className="target-row">
              <div className="target-input-wrap">
                <input
                  className="lelouch-input"
                  type="text"
                  placeholder="Enter target URL or IP"
                  value={target}
                  onChange={e => { setTarget(e.target.value); setShowFavs(false); }}
                  onFocus={() => { if (favorites.length > 0) setShowFavs(true); }}
                  onBlur={() => setTimeout(() => setShowFavs(false), 160)}
                  onKeyDown={e => e.key === "Enter" && handleLaunch()}
                  autoComplete="off"
                />
                {showFavs && favorites.length > 0 && (
                  <div className="favs-dropdown">
                    {favorites.map(f => (
                      <div key={f} className="fav-item">
                        <span className="fav-url" onClick={() => { setTarget(f); setShowFavs(false); }}>{f}</span>
                        <button className="fav-remove" onClick={e => { e.stopPropagation(); removeFavorite(f); }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {target.trim() && !favorites.includes(target.trim()) && (
                <button className="fav-star-btn" title="Save to favorites" onClick={() => saveFavorite(target.trim())}>★</button>
              )}
            </div>

            <div className="lelouch-input-row">
              <button
                className={`lelouch-btn-primary${isRunning ? " lelouch-btn-stop" : ""}`}
                onClick={handleLaunch}
                disabled={createAttack.isPending}
              >
                <span className="lelouch-btn-icon">♟</span>
                {isRunning ? "Stop Geass" : "Command Geass"}
              </button>
              <button className="lelouch-btn-icon-btn lelouch-btn-gold" title="Clear logs" onClick={handleClearLogs}>⚡</button>
              <button className="lelouch-btn-icon-btn lelouch-btn-dark" title="Export logs as .txt" onClick={handleExportLogs}>⎘</button>
              <button
                className={`lelouch-btn-icon-btn ${soundEnabled ? "lelouch-btn-gold" : "lelouch-btn-dark"}`}
                title={soundEnabled ? "Mute" : "Unmute"}
                onClick={() => setSoundEnabled(v => !v)}
              >{soundEnabled ? "🔊" : "🔇"}</button>
            </div>

            <div className="lelouch-params-row">
              <div className="lelouch-field">
                <label className="lelouch-label">Attack Method</label>
                <select className="lelouch-select" value={method} onChange={e => setMethod(e.target.value)}>
                  {methods.length === 0
                    ? <><option value="http-flood">HTTP Flood</option><option value="udp-flood">UDP Flood</option><option value="tcp-flood">TCP Flood</option></>
                    : methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                  }
                </select>
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Packet Size (kb)</label>
                <input className="lelouch-number" type="number" min={1} max={65535} value={packetSize} onChange={e => setPacketSize(+e.target.value)}/>
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Duration (seconds)</label>
                <input className="lelouch-number" type="number" min={1} max={3600} value={duration} onChange={e => setDuration(+e.target.value)}/>
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Threads</label>
                <input className="lelouch-number" type="number" min={1} max={256} value={threads} onChange={e => setThreads(+e.target.value)}/>
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Packet Delay (ms)</label>
                <input className="lelouch-number" type="number" min={0} max={10000} value={delay} onChange={e => setDelay(+e.target.value)}/>
              </div>
              <div className="lelouch-field webhook-field">
                <label className="lelouch-label webhook-toggle" onClick={() => setShowWebhook(v => !v)}>
                  {showWebhook ? "▲" : "▼"} Webhook URL <span className="opt-tag">optional</span>
                </label>
                {showWebhook && (
                  <input className="lelouch-number" type="url" placeholder="https://your-webhook.com/notify" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}/>
                )}
              </div>
            </div>

            <div className="lelouch-stats-row">
              <div className="lelouch-stat">
                <div className="lelouch-stat-header"><span className="lelouch-stat-icon">⚡</span><span className="lelouch-stat-label">Packets/sec</span></div>
                <div className="lelouch-stat-value">{isRunning ? fmtNum(packetsPerSec) : "0"}</div>
              </div>
              <div className="lelouch-stat">
                <div className="lelouch-stat-header"><span className="lelouch-stat-icon">👑</span><span className="lelouch-stat-label">Active Bots</span></div>
                <div className="lelouch-stat-value">{activeBots}</div>
              </div>
              <div className="lelouch-stat">
                <div className="lelouch-stat-header"><span className="lelouch-stat-icon">📡</span><span className="lelouch-stat-label">Total Packets</span></div>
                <div className="lelouch-stat-value">{fmtNum(totalPackets)}</div>
              </div>
            </div>

            <div className="lelouch-progress-track">
              <div className="lelouch-progress-fill" style={{ width: `${progress}%` }}/>
            </div>

            <div className="lelouch-terminal" ref={terminalRef}>
              {logs.map(l => (
                <div key={l.id} className={`lelouch-terminal-line tlog-${l.type}`}>
                  <span className="lelouch-terminal-prompt">{">"}</span> {l.text}
                </div>
              ))}
            </div>

            <section className="site-checker">
              <h3 className="section-title">♟ Site Status Checker</h3>
              <div className="checker-row">
                <input
                  className="lelouch-input checker-input"
                  type="text"
                  placeholder="URL to check (or uses target field)"
                  value={checkerUrl}
                  onChange={e => setCheckerUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCheckSite()}
                />
                <button className="checker-btn" onClick={handleCheckSite} disabled={isChecking}>
                  {isChecking ? "Scanning..." : "Check"}
                </button>
              </div>
              {checkerResult && (
                <div className={`checker-result ${checkerResult.up ? "result-up" : "result-down"}`}>
                  <span className="checker-dot" style={{ background: statusColor(checkerResult.status) }}/>
                  <span className="checker-code" style={{ color: statusColor(checkerResult.status) }}>
                    {checkerResult.status === 0 ? "OFFLINE" : `HTTP ${checkerResult.status}`}
                  </span>
                  <span className="checker-status-text">{checkerResult.statusText}</span>
                  <span className="checker-time">{checkerResult.responseTime}ms</span>
                  <span className={`checker-pill ${checkerResult.up ? "pill-up" : "pill-down"}`}>
                    {checkerResult.up ? "ONLINE" : "DOWN"}
                  </span>
                </div>
              )}
            </section>

            <section className="history-section">
              <button className="history-toggle" onClick={() => { setShowHistory(v => !v); refetchHistory(); }}>
                ♟ Attack History ({allAttacks.length}) {showHistory ? "▲" : "▼"}
              </button>
              {showHistory && (
                <div className="history-list">
                  {allAttacks.length === 0
                    ? <div className="history-empty">No attacks recorded yet.</div>
                    : allAttacks.map(a => (
                      <div key={a.id} className={`history-item status-${a.status}`}>
                        <span className="history-target" title={a.target}>{a.target}</span>
                        <span className="history-method">{a.method}</span>
                        <span className={`history-badge badge-${a.status}`}>{a.status}</span>
                        <span className="history-pkts">{fmtNum(a.packetsSent ?? 0)} pkts</span>
                      </div>
                    ))
                  }
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="lelouch-footer">♟ v1.0 — Lelouch Britannia Edition ♟</footer>
        <div className="lelouch-footer-slider"><div className="lelouch-footer-fill" style={{ width: `${progress}%` }}/></div>
      </div>

      <button className={`mobile-fab ${isRunning ? "fab-stop" : ""}`} onClick={handleLaunch} aria-label={isRunning ? "Stop Geass" : "Command Geass"}>
        <span className="fab-glyph">♟</span>
        <span className="fab-label">{isRunning ? "Stop" : "Geass"}</span>
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
