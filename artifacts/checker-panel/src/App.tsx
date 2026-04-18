import { useState, useRef, useCallback, useEffect } from "react";
import "./index.css";

/* ─────────────────────────────────────────────────────── */
/*  Config                                                  */
/* ─────────────────────────────────────────────────────── */
const API = "";   // same origin through proxy

const TARGETS = [
  { id: "github",       label: "GitHub",       emoji: "🐙", cat: "Dev/Cloud",   note: "user:pass • PAT" },
  { id: "aws",          label: "AWS IAM",      emoji: "☁️",  cat: "Dev/Cloud",   note: "access_key:secret" },
  { id: "vultr",        label: "Vultr",        emoji: "💎", cat: "VPS/Hosting",  note: "API Key" },
  { id: "hetzner",      label: "Hetzner",      emoji: "🟠", cat: "VPS/Hosting",  note: "API Key" },
  { id: "digitalocean", label: "DigitalOcean", emoji: "🌊", cat: "VPS/Hosting",  note: "API Key" },
  { id: "linode",       label: "Linode",       emoji: "🟢", cat: "VPS/Hosting",  note: "API Key" },
  { id: "ovh",          label: "OVH",          emoji: "🔵", cat: "VPS/Hosting",  note: "user:pass" },
  { id: "hostinger",    label: "Hostinger",    emoji: "🌐", cat: "VPS/Hosting",  note: "email:pass" },
  { id: "netflix",      label: "Netflix",      emoji: "🎬", cat: "Streaming",    note: "email:pass" },
  { id: "crunchyroll",  label: "Crunchyroll",  emoji: "🍥", cat: "Streaming",    note: "email:pass" },
  { id: "hbomax",       label: "HBO Max",      emoji: "👑", cat: "Streaming",    note: "email:pass" },
  { id: "disney",       label: "Disney+",      emoji: "🏰", cat: "Streaming",    note: "email:pass" },
  { id: "amazon",       label: "Amazon",       emoji: "📦", cat: "Streaming",    note: "email:pass" },
  { id: "paramount",    label: "Paramount+",   emoji: "⭐", cat: "Streaming",    note: "email:pass" },
  { id: "spotify",      label: "Spotify",      emoji: "🎵", cat: "Streaming",    note: "user:pass" },
  { id: "paypal",       label: "PayPal",       emoji: "💰", cat: "Financeiro",   note: "email:pass" },
  { id: "mercadopago",  label: "MercadoPago",  emoji: "💳", cat: "Financeiro",   note: "email:pass" },
  { id: "roblox",       label: "Roblox",       emoji: "🎮", cat: "Gaming",       note: "user:pass" },
  { id: "steam",        label: "Steam",        emoji: "🔵", cat: "Gaming",       note: "user:pass" },
  { id: "epicgames",    label: "Epic Games",   emoji: "🎯", cat: "Gaming",       note: "email:pass" },
  { id: "playstation",  label: "PlayStation",  emoji: "🎮", cat: "Gaming",       note: "email:pass" },
  { id: "riot",         label: "Riot Games",   emoji: "⚔️", cat: "Gaming",       note: "user:pass" },
  { id: "instagram",    label: "Instagram",    emoji: "📸", cat: "Social",       note: "user:pass" },
  { id: "serasa",       label: "Serasa",       emoji: "📊", cat: "Governo BR",   note: "CPF:pass" },
  { id: "iseek",        label: "iSeek",        emoji: "🔍", cat: "Governo BR",   note: "user:pass" },
  { id: "serpro",       label: "SERPRO",       emoji: "🛡️", cat: "Governo BR",   note: "user:pass" },
  { id: "sinesp",       label: "SINESP",       emoji: "🚔", cat: "Governo BR",   note: "user:pass" },
  { id: "cpf",          label: "CPF/CNPJ",     emoji: "🪪",  cat: "Governo BR",   note: "CPF:nascimento" },
  { id: "ifood",        label: "iFood",        emoji: "🛵", cat: "Delivery",     note: "email:pass" },
] as const;

type TargetId = (typeof TARGETS)[number]["id"];
const CATS = ["Todos", ...Array.from(new Set(TARGETS.map(t => t.cat)))];

/* ─────────────────────────────────────────────────────── */
/*  Types                                                   */
/* ─────────────────────────────────────────────────────── */
interface ResultItem { credential: string; detail: string; }
interface JobResult  { hits: ResultItem[]; fails: ResultItem[]; errors: ResultItem[]; }

/* ─────────────────────────────────────────────────────── */
/*  Helpers                                                 */
/* ─────────────────────────────────────────────────────── */
function exportTxt(items: ResultItem[], label: string) {
  const text = items.map(i => `${i.credential} | ${i.detail}`).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${label}.txt`;
  a.click(); URL.revokeObjectURL(url);
}

function parseLines(raw: string): string[] {
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(":") && l.length > 3);
}

/* ─────────────────────────────────────────────────────── */
/*  App                                                     */
/* ─────────────────────────────────────────────────────── */
export default function App() {
  // Config state
  const [credentials, setCredentials] = useState<string[]>([]);
  const [credInput,   setCredInput]   = useState("");
  const [target,      setTarget]      = useState<TargetId>("iseek");
  const [catFilter,   setCatFilter]   = useState("Todos");
  const [dragging,    setDragging]    = useState(false);

  // Job state
  const [running,     setRunning]     = useState(false);
  const [jobId,       setJobId]       = useState<string | null>(null);
  const [total,       setTotal]       = useState(0);
  const [done,        setDone]        = useState(0);
  const [speed,       setSpeed]       = useState(0);
  const [results,     setResults]     = useState<JobResult>({ hits: [], fails: [], errors: [] });
  const [finished,    setFinished]    = useState(false);

  const esRef      = useRef<EventSource | null>(null);
  const doneRef    = useRef(0);
  const startRef   = useRef(0);
  const speedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Filtered targets ───────────────────────────────────
  const visTargets = catFilter === "Todos"
    ? TARGETS
    : TARGETS.filter(t => t.cat === catFilter);

  // ── File drop ──────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text  = e.target?.result as string ?? "";
      const lines = parseLines(text);
      setCredentials(lines);
      setCredInput(`${lines.length} credenciais carregadas de "${file.name}"`);
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onPaste = useCallback((raw: string) => {
    const lines = parseLines(raw);
    if (lines.length > 0) { setCredentials(lines); setCredInput(raw); }
    else setCredInput(raw);
  }, []);

  // ── Start check ────────────────────────────────────────
  const startCheck = useCallback(async () => {
    const creds = credentials.length > 0
      ? credentials
      : parseLines(credInput);
    if (creds.length === 0) { alert("Nenhuma credencial válida (formato login:senha)."); return; }

    setRunning(true);
    setFinished(false);
    setDone(0); doneRef.current = 0;
    setResults({ hits: [], fails: [], errors: [] });
    startRef.current = Date.now();

    // Speed meter
    speedTimer.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      setSpeed(elapsed > 0 ? Math.round(doneRef.current / elapsed) : 0);
    }, 1000);

    try {
      const r = await fetch(`${API}/api/checker/start`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ credentials: creds, target }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error((err as {error?: string}).error ?? `HTTP ${r.status}`); }
      const data = await r.json() as { jobId: string; total: number };
      setJobId(data.jobId);
      setTotal(data.total);

      // SSE stream
      const es = new EventSource(`${API}/api/checker/${data.jobId}/stream`);
      esRef.current = es;

      es.onmessage = ev => {
        try {
          const d = JSON.parse(ev.data as string) as {
            type: string;
            status?: string;
            credential?: string;
            detail?: string;
          };
          if (d.type === "result") {
            doneRef.current++;
            setDone(p => p + 1);
            const item: ResultItem = { credential: d.credential ?? "?", detail: d.detail ?? "" };
            setResults(p => ({
              hits:   d.status === "HIT"   ? [...p.hits,   item] : p.hits,
              fails:  d.status === "FAIL"  ? [...p.fails,  item] : p.fails,
              errors: d.status === "ERROR" ? [...p.errors, item] : p.errors,
            }));
          } else if (d.type === "done" || d.type === "end") {
            es.close(); esRef.current = null;
            setRunning(false); setFinished(true);
            if (speedTimer.current) clearInterval(speedTimer.current);
          }
        } catch { /**/ }
      };

      es.onerror = () => {
        es.close(); esRef.current = null;
        setRunning(false); setFinished(true);
        if (speedTimer.current) clearInterval(speedTimer.current);
      };
    } catch (err) {
      setRunning(false);
      if (speedTimer.current) clearInterval(speedTimer.current);
      alert(`Erro ao iniciar: ${String(err)}`);
    }
  }, [credentials, credInput, target]);

  // ── Stop ──────────────────────────────────────────────
  const stopCheck = useCallback(async () => {
    esRef.current?.close(); esRef.current = null;
    if (speedTimer.current) clearInterval(speedTimer.current);
    if (jobId) await fetch(`${API}/api/checker/${jobId}`, { method: "DELETE" }).catch(() => {});
    setRunning(false); setFinished(true);
  }, [jobId]);

  // Cleanup on unmount
  useEffect(() => () => {
    esRef.current?.close();
    if (speedTimer.current) clearInterval(speedTimer.current);
  }, []);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hitRate = done > 0 ? ((results.hits.length / done) * 100).toFixed(1) : "0.0";

  return (
    <div className="apex-root">
      <div className="apex-scanline" />

      {/* ── Header ── */}
      <header className="apex-header">
        <div className="apex-logo">
          <div className="apex-logo-dot" />
          APEX CHECKER
        </div>
        <div className="apex-stats-bar">
          {running && (
            <span className="apex-speed">⚡ {speed}/s</span>
          )}
          <span className="apex-stat-pill apex-stat-pill--hit">✅ {results.hits.length}</span>
          <span className="apex-stat-pill apex-stat-pill--fail">❌ {results.fails.length}</span>
          <span className="apex-stat-pill apex-stat-pill--error">⚠️ {results.errors.length}</span>
          <span className={`apex-status ${running ? "apex-status--running" : finished ? "apex-status--done" : "apex-status--idle"}`}>
            <span className="apex-status-dot" />
            {running ? "CHECANDO" : finished ? "FINALIZADO" : "AGUARDANDO"}
          </span>
        </div>
      </header>

      <main className="apex-main">

        {/* ── Config row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>

          {/* Left — credentials */}
          <div className="flex-col gap-12">
            <div className="apex-card">
              <div className="apex-card-header">
                <span className="apex-card-title">📋 Credenciais</span>
                {credentials.length > 0 && (
                  <span className="apex-cred-badge">
                    {credentials.length.toLocaleString("pt-BR")} linhas
                  </span>
                )}
              </div>

              {/* Drop zone */}
              <div
                className={`apex-dropzone ${dragging ? "apex-dropzone--drag" : ""}`}
                style={{ margin: 12, borderRadius: 8 }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div className="apex-dropzone-icon">📂</div>
                <div className="apex-dropzone-text">
                  <strong>Arraste o arquivo</strong> ou clique para selecionar<br />
                  <span style={{ fontSize: ".65rem", opacity: .7 }}>.txt, .csv, .log — uma credential por linha</span>
                </div>
                <input
                  type="file"
                  accept=".txt,.csv,.log,text/plain"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              {/* Text area */}
              <div style={{ padding: "0 12px 12px" }}>
                <div className="section-label">ou cole aqui</div>
                <textarea
                  className="apex-textarea"
                  placeholder={"usuario@email.com:senha123\noutro_user:outra_senha"}
                  value={credentials.length > 0 ? `✅ ${credentials.length} credenciais carregadas` : credInput}
                  onChange={e => {
                    if (!e.target.value.startsWith("✅")) {
                      setCredentials([]);
                      setCredInput(e.target.value);
                      onPaste(e.target.value);
                    }
                  }}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex-row gap-8">
              {running ? (
                <button className="apex-btn apex-btn--danger flex-1" onClick={stopCheck}>
                  ■ PARAR
                </button>
              ) : (
                <button
                  className="apex-btn apex-btn--primary flex-1"
                  disabled={credentials.length === 0 && parseLines(credInput).length === 0}
                  onClick={startCheck}
                >
                  ⚔️ INICIAR CHECKER
                </button>
              )}
              <button
                className="apex-btn apex-btn--ghost"
                onClick={() => { setCredentials([]); setCredInput(""); setResults({ hits: [], fails: [], errors: [] }); setFinished(false); setDone(0); setTotal(0); }}
                disabled={running}
              >
                ↺ Reset
              </button>
            </div>

            {/* Progress */}
            {(running || finished) && (
              <div className="apex-card apex-card--glow">
                <div className="apex-progress-wrap">
                  <div className="apex-progress-meta">
                    <span style={{ fontFamily: "var(--mono)", fontSize: ".78rem" }}>
                      {done.toLocaleString()}/{total.toLocaleString()} <span className="text-dim">verificados</span>
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: ".78rem", color: "var(--cyan)" }}>
                      {pct}%
                    </span>
                  </div>
                  <div className="apex-progress-bar">
                    <div className="apex-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  {finished && (
                    <div style={{ marginTop: 8, fontSize: ".72rem", color: "var(--text2)", fontFamily: "var(--mono)" }}>
                      Taxa HIT: <span style={{ color: "var(--green)", fontWeight: 700 }}>{hitRate}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right — target picker */}
          <div className="apex-card">
            <div className="apex-card-header">
              <span className="apex-card-title">🎯 Alvo</span>
              <span style={{ fontSize: ".72rem", color: "var(--cyan)" }}>
                {TARGETS.find(t => t.id === target)?.emoji} {TARGETS.find(t => t.id === target)?.label}
              </span>
            </div>

            {/* Category tabs */}
            <div className="apex-cat-tabs">
              {CATS.map(cat => (
                <button
                  key={cat}
                  className={`apex-cat-tab ${catFilter === cat ? "apex-cat-tab--active" : ""}`}
                  onClick={() => setCatFilter(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Target grid */}
            <div className="apex-targets">
              {visTargets.map(t => (
                <button
                  key={t.id}
                  className={`apex-target-btn ${target === t.id ? "apex-target-btn--active" : ""}`}
                  onClick={() => setTarget(t.id)}
                  disabled={running}
                >
                  <span className="apex-target-emoji">{t.emoji}</span>
                  <span className="apex-target-name">{t.label}</span>
                  <span className="apex-target-cat">{t.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Results columns ── */}
        <div className="apex-results">
          {/* HITs */}
          <ResultColumn
            type="hit"
            title="✅ HITs"
            items={results.hits}
            onExport={() => exportTxt(results.hits, `hits_${target}`)}
          />
          {/* FAILs */}
          <ResultColumn
            type="fail"
            title="❌ FAILs"
            items={results.fails}
            onExport={() => exportTxt(results.fails, `fails_${target}`)}
          />
          {/* ERRORs */}
          <ResultColumn
            type="error"
            title="⚠️ ERRORs"
            items={results.errors}
            onExport={() => exportTxt(results.errors, `errors_${target}`)}
          />
        </div>

      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */
/*  ResultColumn                                            */
/* ─────────────────────────────────────────────────────── */
function ResultColumn({
  type, title, items, onExport
}: { type: "hit"|"fail"|"error"; title: string; items: ResultItem[]; onExport: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [items.length]);

  return (
    <div className={`apex-result-col apex-result-col--${type}`}>
      <div className={`apex-result-header apex-result-header--${type}`}>
        <span className={`apex-result-title apex-result-title--${type}`}>
          {title}
        </span>
        <div className="flex-row gap-8" style={{ alignItems: "center" }}>
          <span className={`apex-result-count apex-result-count--${type}`}>
            {items.length.toLocaleString()}
          </span>
          {items.length > 0 && (
            <button
              className={`apex-btn apex-btn--export-${type}`}
              style={{ padding: "3px 8px", fontSize: ".65rem" }}
              onClick={onExport}
            >
              ↓ Export
            </button>
          )}
        </div>
      </div>

      <div className="apex-result-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="apex-result-empty">nenhum {type === "hit" ? "acerto" : type === "fail" ? "erro" : "problema"} ainda</div>
        ) : (
          items.map((item, i) => {
            const [cred, ...infoParts] = item.credential.includes(" | ")
              ? [item.credential.split(" | ")[0], item.credential.split(" | ").slice(1).join(" | ")]
              : [item.credential, ""];
            const info = infoParts.join("") || item.detail;
            return (
              <div key={i} className={`apex-result-item apex-result-item--${type}`}>
                <div className="apex-result-cred">{cred}</div>
                {info && <div className="apex-result-info">{info}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
