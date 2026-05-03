import { useState, useEffect, useRef, useCallback } from "react";

const BASE = "";

type InfStats = {
  totalConsultas: number;
  consultasHoje: number;
  consultasSemana: number;
  usuariosAtivos: number;
  consultasPorTipo: Array<{ tipo: string; count: number }>;
  recentes: Array<{ id: number; tipo: string; query: string; username: string; success: boolean; createdAt: string }>;
};

type Props = {
  isRunning: boolean;
  pps: number;
  totalRequests: number;
  hits: number;
  targetDomain: string;
  method: string;
  duration: number;
  elapsed: number;
};

const GEASS_VOICE_LINES = [
  "Eu, Lelouch vi Britannia, ordeno a você — submeta-se!",
  "O Geass foi lançado. Não há como resistir à minha vontade.",
  "Este é o poder do rei. O poder absoluto de mudar o destino.",
  "Zero não recua. Cada obstáculo será destruído.",
  "Pela ordem de Geass — que o alvo seja eliminado!",
  "O rei não deve recuar. Mesmo que o mundo inteiro seja seu inimigo.",
  "Eu assumo a responsabilidade pelo mundo. Este é o peso do Geass.",
  "Rebeldes do mundo, sigam o eu — sigam Zero!",
  "A Brittania caiu. Uma nova era começa agora.",
  "Alguém precisa assumir o papel do vilão — e esse alguém sou eu.",
];

const METRIC_COLORS = [
  "#9b59b6", "#6d2db5", "#0ea5e9", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6",
];

function StatCard({
  label, value, sub, accent = "#9b59b6", glow = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  glow?: boolean;
}) {
  return (
    <div style={{
      background: "rgba(0,0,0,0.55)",
      border: `1px solid ${accent}40`,
      borderRadius: 14,
      padding: "18px 20px",
      position: "relative",
      overflow: "hidden",
      boxShadow: glow ? `0 0 24px -6px ${accent}88` : "none",
      transition: "box-shadow 0.3s",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse at top left, ${accent}18 0%, transparent 70%)`,
      }} />
      <p style={{ fontSize: 10, letterSpacing: "0.35em", textTransform: "uppercase", color: `${accent}cc`, marginBottom: 8, fontWeight: 600 }}>
        {label}
      </p>
      <p style={{ fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#ccc", textTransform: "uppercase", letterSpacing: "0.15em" }}>{label}</span>
        <span style={{ fontSize: 11, color: color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color,
          borderRadius: 3, transition: "width 0.6s ease",
          boxShadow: `0 0 8px ${color}88`,
        }} />
      </div>
    </div>
  );
}

function PulsingDot({ color = "#10b981" }: { color?: string }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 10, height: 10, marginRight: 6 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%", background: color,
        animation: "lb-pulse 1.4s ease-in-out infinite",
      }} />
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
    </span>
  );
}

export function Wallboard({ isRunning, pps, totalRequests, hits, targetDomain, method, duration, elapsed }: Props) {
  const [stats, setStats] = useState<InfStats | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [lastLine, setLastLine] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refresh infinity stats every 15s
  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem("infinity_token") ?? "";
        const r = await fetch(`${BASE}/api/infinity/overview`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!r.ok) { setLoadErr(`HTTP ${r.status}`); return; }
        const data = await r.json();
        setStats(data);
        setLoadErr("");
      } catch (e) {
        setLoadErr("Sem conexão com Infinity API");
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  // Clock tick every second for uptime / live display
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Geass voice mode — speaks a random line every ~12s
  const speak = useCallback((line: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(line);
    utt.lang = "pt-BR";
    utt.rate = 0.88;
    utt.pitch = 0.7;
    utt.volume = 1;
    // Try to pick a deep voice
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang.startsWith("pt")) ?? null;
    if (ptVoice) utt.voice = ptVoice;
    utt.onstart = () => setSpeaking(true);
    utt.onend = () => setSpeaking(false);
    setLastLine(line);
    window.speechSynthesis.speak(utt);
  }, []);

  useEffect(() => {
    if (!voiceActive) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    // Speak immediately
    speak(GEASS_VOICE_LINES[Math.floor(Math.random() * GEASS_VOICE_LINES.length)]);
    timerRef.current = setInterval(() => {
      speak(GEASS_VOICE_LINES[Math.floor(Math.random() * GEASS_VOICE_LINES.length)]);
    }, 12_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [voiceActive, speak]);

  const uptime = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const hitRate = totalRequests > 0 ? ((hits / totalRequests) * 100).toFixed(1) : "0.0";
  const maxTipo = stats ? Math.max(...stats.consultasPorTipo.map((t) => t.count), 1) : 1;
  const now = new Date();

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0010 0%, #080018 50%, #040010 100%)",
      padding: "24px 20px",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase", color: "#fff", margin: 0 }}>
            👁 Wallboard
          </h2>
          <p style={{ fontSize: 11, color: "#666", letterSpacing: "0.3em", textTransform: "uppercase", marginTop: 4 }}>
            {now.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Status pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", borderRadius: 20,
            background: isRunning ? "rgba(155,89,182,0.15)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${isRunning ? "rgba(155,89,182,0.5)" : "rgba(255,255,255,0.08)"}`,
          }}>
            <PulsingDot color={isRunning ? "#9b59b6" : "#444"} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: isRunning ? "#9b59b6" : "#666" }}>
              {isRunning ? "Geass Ativo" : "Aguardando"}
            </span>
          </div>
          {/* Geass voice toggle */}
          <button
            onClick={() => setVoiceActive((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 16px", borderRadius: 20,
              background: voiceActive ? "rgba(109,45,181,0.25)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${voiceActive ? "rgba(109,45,181,0.7)" : "rgba(255,255,255,0.08)"}`,
              color: voiceActive ? "#bf8fff" : "#666",
              cursor: "pointer", fontWeight: 700, fontSize: 11,
              letterSpacing: "0.2em", textTransform: "uppercase",
              boxShadow: voiceActive ? "0 0 24px -4px rgba(109,45,181,0.6)" : "none",
              transition: "all 0.3s",
            }}
          >
            <span style={{
              fontSize: 18,
              filter: voiceActive ? "drop-shadow(0 0 6px #9b59b6)" : "none",
              animation: speaking ? "lb-pulse 0.6s ease-in-out infinite" : "none",
            }}>👁</span>
            {voiceActive ? (speaking ? "Falando..." : "Voz Geass ON") : "Voz Geass"}
          </button>
        </div>
      </div>

      {/* Last spoken line */}
      {lastLine && (
        <div style={{
          marginBottom: 24,
          padding: "12px 18px",
          borderRadius: 12,
          background: "rgba(109,45,181,0.1)",
          border: "1px solid rgba(109,45,181,0.3)",
          color: "#bf8fff",
          fontSize: 13,
          fontStyle: "italic",
          letterSpacing: "0.04em",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>🗣</span>
          "{lastLine}"
        </div>
      )}

      {/* ═══ ATTACK METRICS ═══ */}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 10, letterSpacing: "0.45em", textTransform: "uppercase", color: "#9b59b640", marginBottom: 16, fontWeight: 600 }}>
          ⚔ Métricas de Ataque
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
          <StatCard label="PPS Atual" value={isRunning ? pps.toLocaleString() : "—"} sub="pacotes/segundo" accent="#9b59b6" glow={isRunning} />
          <StatCard label="Total Reqs" value={totalRequests.toLocaleString()} sub="desde o início" accent="#6d2db5" glow={false} />
          <StatCard label="Taxa de Hit" value={`${hitRate}%`} sub={`${hits} hits`} accent={Number(hitRate) > 30 ? "#10b981" : "#f59e0b"} />
          <StatCard label="Uptime" value={isRunning ? uptime : "—"} sub={method || "nenhum método"} accent="#0ea5e9" />
          {targetDomain && (
            <StatCard label="Alvo" value={targetDomain.slice(0, 18)} sub={`${duration}s configurado`} accent="#ef4444" glow={isRunning} />
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(109,45,181,0.4), transparent)", marginBottom: 24 }} />

      {/* ═══ INFINITY SEARCH METRICS ═══ */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.45em", textTransform: "uppercase", color: "#0ea5e940", fontWeight: 600 }}>
            ∞ Infinity Search
          </p>
          {loadErr ? (
            <span style={{ fontSize: 11, color: "#ef4444", letterSpacing: "0.15em" }}>{loadErr}</span>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <PulsingDot color="#10b981" />
              <span style={{ fontSize: 10, color: "#10b981", letterSpacing: "0.2em", textTransform: "uppercase" }}>Online</span>
            </div>
          )}
        </div>

        {stats ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
              <StatCard label="Total Consultas" value={stats.totalConsultas.toLocaleString()} accent="#0ea5e9" glow />
              <StatCard label="Hoje" value={stats.consultasHoje.toLocaleString()} sub="desde meia-noite" accent="#06b6d4" />
              <StatCard label="Semana" value={stats.consultasSemana.toLocaleString()} sub="últimos 7 dias" accent="#8b5cf6" />
              <StatCard label="Usuários" value={stats.usuariosAtivos.toLocaleString()} sub="contas registradas" accent="#10b981" />
            </div>

            {/* Por tipo — barras horizontais */}
            {stats.consultasPorTipo.length > 0 && (
              <div style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(14,165,233,0.2)",
                borderRadius: 14,
                padding: "20px 22px",
                marginBottom: 20,
              }}>
                <p style={{ fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: "#0ea5e960", marginBottom: 16, fontWeight: 600 }}>
                  Consultas por tipo
                </p>
                {[...stats.consultasPorTipo]
                  .sort((a, b) => b.count - a.count)
                  .map((t, i) => (
                    <MiniBar
                      key={t.tipo}
                      label={t.tipo}
                      value={t.count}
                      max={maxTipo}
                      color={METRIC_COLORS[i % METRIC_COLORS.length]}
                    />
                  ))}
              </div>
            )}

            {/* Recentes */}
            {stats.recentes.length > 0 && (
              <div style={{
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(14,165,233,0.15)",
                borderRadius: 14,
                padding: "18px 20px",
              }}>
                <p style={{ fontSize: 10, letterSpacing: "0.4em", textTransform: "uppercase", color: "#0ea5e960", marginBottom: 14, fontWeight: 600 }}>
                  Atividade recente
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                  {stats.recentes.map((r) => (
                    <div key={r.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase",
                        color: "#0ea5e9", background: "rgba(14,165,233,0.1)", border: "1px solid rgba(14,165,233,0.2)",
                        padding: "2px 8px", borderRadius: 6, flexShrink: 0,
                      }}>{r.tipo}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.query}
                      </span>
                      <span style={{ fontSize: 11, color: "#555", flexShrink: 0 }}>
                        {r.username}
                      </span>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{r.success ? "✅" : "⚠️"}</span>
                      <span style={{ fontSize: 10, color: "#444", flexShrink: 0 }}>
                        {new Date(r.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          !loadErr && (
            <div style={{
              textAlign: "center", padding: "60px 0", color: "#444",
              letterSpacing: "0.3em", textTransform: "uppercase", fontSize: 12,
            }}>
              Carregando métricas Infinity...
            </div>
          )
        )}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 32, paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.05)",
        display: "flex", justifyContent: "space-between",
        fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: "#333",
      }}>
        <span>LelouchBritannia Panel</span>
        <span>Wallboard · Auto-refresh 15s</span>
      </div>
    </div>
  );
}
