import { useState, useEffect, useRef, useCallback } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  useListMethods,
  useCreateAttack,
  useGetAttackStats,
  useGetAttack,
  useStopAttack,
  getGetAttackStatsQueryKey,
  getGetAttackQueryKey,
  getListAttacksQueryKey,
} from "@workspace/api-client-react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

function Panel() {
  const qc = useQueryClient();

  const [target, setTarget] = useState("");
  const [method, setMethod] = useState("http-flood");
  const [packetSize, setPacketSize] = useState(64);
  const [duration, setDuration] = useState(60);
  const [delay, setDelay] = useState(100);

  const [currentAttackId, setCurrentAttackId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<{ id: number; text: string; color: string }[]>([]);
  const [progress, setProgress] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [prevPackets, setPrevPackets] = useState(0);
  const logIdRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((text: string, color = "#b3aa8a") => {
    const id = ++logIdRef.current;
    setLogs(prev => [...prev.slice(-49), { id, text, color }]);
  }, []);

  const { data: methods } = useListMethods();
  const createAttack = useCreateAttack();
  const stopAttack = useStopAttack();
  const { data: stats } = useGetAttackStats({
    query: { refetchInterval: isRunning ? 1000 : 5000 },
  });
  const { data: currentAttack } = useGetAttack(
    currentAttackId ?? 0,
    { query: { enabled: currentAttackId !== null, refetchInterval: isRunning ? 800 : false } }
  );

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!isRunning || startTime === null) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        setIsRunning(false);
        setProgress(100);
        addLog("Operation completed. Geass command fulfilled.", "#D4AF37");
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [isRunning, startTime, duration, addLog]);

  useEffect(() => {
    if (!currentAttack || !isRunning) return;
    const pps = Math.max(0, (currentAttack.packetsSent ?? 0) - prevPackets);
    setPacketsPerSec(pps);
    setPrevPackets(currentAttack.packetsSent ?? 0);

    if (currentAttack.status === "finished" || currentAttack.status === "stopped") {
      setIsRunning(false);
      setProgress(100);
      addLog("Command terminated. Results archived.", "#D4AF37");
    }
  }, [currentAttack, isRunning, prevPackets, addLog]);

  async function handleStart() {
    if (!target.trim()) {
      addLog("ERROR: No target specified. Geass requires a target.", "#C0392B");
      return;
    }
    if (isRunning) {
      if (currentAttackId !== null) {
        await stopAttack.mutateAsync({ id: currentAttackId });
        setIsRunning(false);
        setProgress(0);
        setCurrentAttackId(null);
        setPrevPackets(0);
        setPacketsPerSec(0);
        addLog("Command aborted by Zero's order.", "#C0392B");
        qc.invalidateQueries({ queryKey: getListAttacksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
      }
      return;
    }

    try {
      addLog(`Establishing connection to ${target}...`, "#D4AF37");
      addLog(`Attack vector: ${method.toUpperCase()} | Threads: ${Math.max(1, Math.floor(1000 / Math.max(delay, 1)))}`, "#b3aa8a");

      const threads = Math.max(1, Math.floor(1000 / Math.max(delay, 1)));
      const result = await createAttack.mutateAsync({
        data: { target, port: 80, method, duration, threads },
      });

      setCurrentAttackId(result.id);
      setIsRunning(true);
      setProgress(0);
      setStartTime(Date.now());
      setPrevPackets(0);
      setPacketsPerSec(0);

      addLog(`Connected to the server. [ID: ${result.id}]`, "#6ee2a0");
      addLog(`Connected to the server. [ID: ${result.id}]`, "#6ee2a0");
      addLog(`Connected to the server. [ID: ${result.id}]`, "#6ee2a0");

      qc.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getListAttacksQueryKey() });

      const logInterval = setInterval(() => {
        const msgs = [
          `Packets dispatched: ${(Math.random() * 50000 + 10000).toFixed(0)}`,
          `Geass command active. Target responding.`,
          `Britannian fleet attacking ${target}...`,
          `Zero's command is absolute. Continuing...`,
          `Network node overwhelmed. Maintaining pressure.`,
        ];
        addLog(msgs[Math.floor(Math.random() * msgs.length)], "#b3aa8a");
      }, 2000);

      setTimeout(() => clearInterval(logInterval), duration * 1000);

      qc.invalidateQueries({ queryKey: getGetAttackStatsQueryKey() });
    } catch {
      addLog("ERROR: Connection failed. Server may be offline.", "#C0392B");
    }
  }

  async function handleCopyLog() {
    const text = logs.map(l => `> ${l.text}`).join("\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    addLog("Logs copied to clipboard.", "#D4AF37");
  }

  function handleClear() {
    setLogs([]);
    setProgress(0);
    setPacketsPerSec(0);
  }

  const totalPackets = currentAttack?.packetsSent ?? stats?.totalPacketsSent ?? 0;
  const activeBots = isRunning
    ? Math.max(1, Math.floor(1000 / Math.max(delay, 1)))
    : 0;

  return (
    <div className="lelouch-page">
      <div className="lelouch-content">
        {/* Title */}
        <h1 className="lelouch-title">Lelouch Britannia</h1>
        <p className="lelouch-subtitle">
          Because absolute power is even more beautiful when wielded by Zero.
        </p>

        {/* Main Card */}
        <div className="lelouch-card">
          {/* Character GIF */}
          <div className="lelouch-gif-wrapper">
            <img
              src="/lelouch.gif"
              alt="Lelouch vi Britannia"
              className="lelouch-gif"
            />
            <div className="lelouch-gif-overlay" />
          </div>

          <div className="lelouch-card-body">
            {/* Target input + launch row */}
            <div className="lelouch-input-row">
              <input
                className="lelouch-input"
                type="text"
                placeholder="Enter target URL or IP"
                value={target}
                onChange={e => setTarget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleStart()}
              />
              <button
                className={`lelouch-btn-primary${isRunning ? " lelouch-btn-stop" : ""}`}
                onClick={handleStart}
                disabled={createAttack.isPending}
              >
                <span className="lelouch-btn-icon">♟</span>
                {isRunning ? "Stop Geass" : "Command Geass"}
              </button>
              <button
                className="lelouch-btn-icon-btn lelouch-btn-gold"
                onClick={handleClear}
                title="Clear"
              >
                ⚡
              </button>
              <button
                className="lelouch-btn-icon-btn lelouch-btn-dark"
                onClick={handleCopyLog}
                title="Copy logs"
              >
                ⎘
              </button>
            </div>

            {/* Attack params row */}
            <div className="lelouch-params-row">
              <div className="lelouch-field">
                <label className="lelouch-label">Attack Method</label>
                <select
                  className="lelouch-select"
                  value={method}
                  onChange={e => setMethod(e.target.value)}
                >
                  {methods?.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  )) ?? (
                    <>
                      <option value="http-flood">HTTP/Flood</option>
                      <option value="udp-flood">UDP/Flood</option>
                      <option value="tcp-flood">TCP/Flood</option>
                    </>
                  )}
                </select>
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Packet Size (kb)</label>
                <input
                  className="lelouch-number"
                  type="number"
                  min={1}
                  value={packetSize}
                  onChange={e => setPacketSize(Number(e.target.value))}
                />
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Duration (seconds)</label>
                <input
                  className="lelouch-number"
                  type="number"
                  min={1}
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                />
              </div>
              <div className="lelouch-field">
                <label className="lelouch-label">Packet Delay (ms)</label>
                <input
                  className="lelouch-number"
                  type="number"
                  min={1}
                  value={delay}
                  onChange={e => setDelay(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="lelouch-stats-row">
              <div className="lelouch-stat">
                <div className="lelouch-stat-header">
                  <span className="lelouch-stat-icon">⚡</span>
                  <span className="lelouch-stat-label">Packets/sec</span>
                </div>
                <div className="lelouch-stat-value">{isRunning ? packetsPerSec.toLocaleString() : 0}</div>
              </div>
              <div className="lelouch-stat">
                <div className="lelouch-stat-header">
                  <span className="lelouch-stat-icon">👑</span>
                  <span className="lelouch-stat-label">Active Bots</span>
                </div>
                <div className="lelouch-stat-value">{activeBots}</div>
              </div>
              <div className="lelouch-stat">
                <div className="lelouch-stat-header">
                  <span className="lelouch-stat-icon">📡</span>
                  <span className="lelouch-stat-label">Total Packets</span>
                </div>
                <div className="lelouch-stat-value">{totalPackets.toLocaleString()}</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="lelouch-progress-track">
              <div
                className="lelouch-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Terminal */}
            <div className="lelouch-terminal" ref={terminalRef}>
              {logs.length === 0 ? (
                <div className="lelouch-terminal-line" style={{ color: "#5a5040" }}>
                  {">"} Awaiting Geass command...
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="lelouch-terminal-line" style={{ color: log.color }}>
                    <span className="lelouch-terminal-prompt">{">"}</span>
                    <span className="lelouch-terminal-icon">♟</span>
                    {log.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="lelouch-footer">
          <span>♟ v1.0 — Lelouch Britannia Edition ♟</span>
        </footer>
        <div className="lelouch-footer-slider">
          <div
            className="lelouch-footer-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
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
