import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Clock, AlertTriangle, ExternalLink, ArrowRight } from "lucide-react";
import { ResultViewer } from "@/components/consultas/ResultViewer";

const API = "/api/infinity";

type SharedPayload = {
  tipo: string;
  query: string;
  data: unknown;
  expiresAt: string;
};

type PageState = "loading" | "loaded" | "expired" | "notfound";

export default function ConsultaPublica() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();

  const [state, setState] = useState<PageState>("loading");
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!id) { setState("notfound"); return; }

    fetch(`${API}/shared/${id}`)
      .then(async r => {
        if (r.status === 410) { setState("expired"); return; }
        if (r.status === 404) { setState("notfound"); return; }
        if (!r.ok) { setState("notfound"); return; }
        const d = await r.json() as SharedPayload;
        setPayload(d);
        setState("loaded");

        const secs = Math.max(0, Math.floor((new Date(d.expiresAt).getTime() - Date.now()) / 1000));
        setSecondsLeft(secs);
        timerRef.current = setInterval(() => {
          setSecondsLeft(prev => {
            if (prev <= 1) {
              clearInterval(timerRef.current);
              setState("expired");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      })
      .catch(() => setState("notfound"));

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [id]);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen" style={{ background: "#060912", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(6,9,18,0.9)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => setLocation("/")}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.75)" }}
          >
            <img src="/hydra-icon.png" style={{ width: 28, height: 28, objectFit: "contain" }} alt="Hydra"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.35em", textTransform: "uppercase" }}>
              Hydra Consultoria
            </span>
          </button>

          {state === "loaded" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: secondsLeft < 60 ? "#f59e0b" : "#34d399" }}>
              <Clock style={{ width: 13, height: 13 }} />
              Expira em {fmtTime(secondsLeft)}
            </div>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 80px" }}>

        {/* Loading */}
        {state === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 120, gap: 16 }}>
            <div style={{ width: 32, height: 32, border: "2px solid #06b6d4", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <p style={{ fontSize: 13, color: "rgba(148,163,184,0.7)" }}>Carregando consulta...</p>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* Not found */}
        {state === "notfound" && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 120, gap: 20, textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)" }}>
              <AlertTriangle style={{ width: 36, height: 36, color: "#f59e0b" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 900, color: "rgba(255,255,255,0.9)", marginBottom: 8 }}>Link não encontrado</h1>
              <p style={{ fontSize: 13, color: "rgba(148,163,184,0.7)", maxWidth: 340 }}>
                Este link não existe ou já foi removido do servidor.
              </p>
            </div>
            <button onClick={() => setLocation("/")}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, background: "#06b6d4", color: "#000", border: "none", cursor: "pointer" }}>
              Acessar plataforma <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          </motion.div>
        )}

        {/* Expired */}
        {state === "expired" && (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 120, gap: 24, textAlign: "center" }}>
            <div style={{ width: 80, height: 80, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)" }}>
              <Lock style={{ width: 40, height: 40, color: "#475569" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 900, color: "rgba(255,255,255,0.85)", marginBottom: 10, letterSpacing: 1 }}>Consulta expirada</h1>
              <p style={{ fontSize: 14, color: "rgba(148,163,184,0.65)", maxWidth: 380, lineHeight: 1.7 }}>
                Este link expirou. Consultas compartilhadas ficam disponíveis por{" "}
                <strong style={{ color: "rgba(255,255,255,0.55)" }}>10 minutos</strong>{" "}
                após o compartilhamento.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setLocation("/")}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 22px", borderRadius: 12, fontSize: 13, fontWeight: 600, background: "#06b6d4", color: "#000", border: "none", cursor: "pointer" }}>
                Acessar plataforma <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </motion.div>
        )}

        {/* Loaded */}
        <AnimatePresence>
          {state === "loaded" && payload && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {/* Badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 11, color: "rgba(148,163,184,0.5)", letterSpacing: "0.05em" }}>
                <ExternalLink style={{ width: 13, height: 13 }} />
                Consulta compartilhada · visualização pública
                <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, color: "rgba(148,163,184,0.3)" }}>
                  ID: {id?.slice(0, 10)}
                </span>
              </div>

              {/* Apply default theme vars so ResultViewer renders correctly */}
              <style>{`:root{--color-primary:#06b6d4}`}</style>

              <ResultViewer
                tipo={payload.tipo}
                query={payload.query}
                result={{ success: true, data: payload.data as { fields: { key: string; value: string }[]; sections: { name: string; items: string[] }[]; raw: string } }}
              />

              {/* Footer CTA */}
              <div style={{ marginTop: 32, padding: "20px 24px", borderRadius: 16, border: "1px solid rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.8)", marginBottom: 4 }}>Precisa de mais consultas?</p>
                  <p style={{ fontSize: 12, color: "rgba(148,163,184,0.6)" }}>Acesse a plataforma Hydra Consultoria para pesquisas completas de OSINT.</p>
                </div>
                <button onClick={() => setLocation("/")}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 12, fontSize: 13, fontWeight: 600, background: "#06b6d4", color: "#000", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
                  Acessar Hydra <ArrowRight style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
