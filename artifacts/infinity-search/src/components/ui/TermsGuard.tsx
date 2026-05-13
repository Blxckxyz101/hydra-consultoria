import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ChevronDown, ChevronUp, Square, CheckSquare } from "lucide-react";
import logoUrl from "@/assets/hydra-icon.png";

const LS_KEY = "infinity_terms_v1";

function hasAccepted() {
  try { return localStorage.getItem(LS_KEY) === "accepted"; } catch { return false; }
}

const TERMS_FULL = [
  { title: "Sem reembolso", text: "Todas as assinaturas e pagamentos são definitivos e não reembolsáveis, independente do motivo." },
  { title: "Sem responsabilidade por instabilidades", text: "A Hydra Consultoria não se responsabiliza por interrupções, lentidão, indisponibilidade ou perda de dados causados por falhas técnicas, ataques ou manutenção." },
  { title: "Sem responsabilidade por atos de terceiros", text: "A Hydra Consultoria não se responsabiliza por ações, danos ou prejuízos causados por terceiros com dados obtidos pela plataforma." },
  { title: "Uso legal e exclusivo do usuário", text: "O usuário declara que utilizará as consultas exclusivamente para fins lícitos. O uso indevido é de inteira responsabilidade do usuário, eximindo totalmente a Hydra Consultoria." },
  { title: "Conformidade com a LGPD", text: "As consultas são realizadas em bases de dados de acesso público ou fontes legalmente autorizadas. O usuário se compromete a tratar os dados obtidos conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018)." },
  { title: "Vedação de compartilhamento", text: "É proibido revender, compartilhar ou redistribuir o acesso à plataforma. Infrações resultam em encerramento imediato da conta sem reembolso." },
];

export function TermsGuard({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState(hasAccepted);
  const [checked, setChecked] = useState(false);
  const [showFull, setShowFull] = useState(false);

  if (accepted) return <>{children}</>;

  const accept = () => {
    if (!checked) return;
    try { localStorage.setItem(LS_KEY, "accepted"); } catch {}
    setAccepted(true);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[#030712]" />
      <div className="absolute inset-0 bg-gradient-to-br from-sky-950/25 via-transparent to-cyan-950/15" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-sky-500/5 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="rounded-2xl border border-white/8 bg-black/70 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-7 pt-7 pb-6 flex items-center gap-3.5">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-xl bg-sky-400/15 blur-lg" />
              <img src={logoUrl} alt="Hydra Consultoria" className="relative w-10 h-10 object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <ShieldCheck className="w-3 h-3 text-sky-400" />
                <span className="text-[9px] uppercase tracking-[0.5em] text-sky-400/70">Termos de Uso</span>
              </div>
              <h1 className="text-base font-bold tracking-wide text-white">Hydra Consultoria</h1>
            </div>
          </div>

          <div className="px-7 pb-2 space-y-5">
            {/* Main text */}
            <p className="text-sm text-white/80 leading-relaxed">
              Ao prosseguir, você concorda com todos os{" "}
              <strong className="text-white">Termos de Uso</strong> do Hydra Consultoria,
              incluindo conformidade com a{" "}
              <strong className="text-white">LGPD (Lei 13.709/2018)</strong> e uso exclusivamente
              para fins lícitos. O uso indevido é de sua inteira responsabilidade.
            </p>

            {/* Read terms toggle */}
            <button
              onClick={() => setShowFull((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] text-sky-400/70 hover:text-sky-400 transition-colors"
            >
              {showFull ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showFull ? "Ocultar termos" : "Ler termos completos"}
            </button>

            <AnimatePresence>
              {showFull && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div
                    className="space-y-3 max-h-52 overflow-y-auto pr-1 pb-1"
                    style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(56,189,248,0.15) transparent" }}
                  >
                    {TERMS_FULL.map((t, i) => (
                      <div key={i} className="rounded-xl bg-white/3 border border-white/5 px-4 py-3">
                        <p className="text-[11px] font-semibold text-white/80 mb-1">{t.title}</p>
                        <p className="text-[11px] text-white/40 leading-relaxed">{t.text}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Checkbox */}
            <button
              onClick={() => setChecked((v) => !v)}
              className="flex items-start gap-3 w-full text-left group"
            >
              <div className="shrink-0 mt-0.5 transition-transform group-active:scale-95">
                {checked
                  ? <CheckSquare className="w-4.5 h-4.5 text-sky-400" />
                  : <Square className="w-4.5 h-4.5 text-white/30 group-hover:text-white/50 transition-colors" />
                }
              </div>
              <span className="text-[12px] text-white/60 group-hover:text-white/80 transition-colors leading-relaxed">
                Li e concordo com os Termos de Uso e a Política de Privacidade do Hydra Consultoria
              </span>
            </button>
          </div>

          {/* Footer */}
          <div className="px-7 py-6 mt-2">
            <motion.button
              whileHover={checked ? { scale: 1.02 } : {}}
              whileTap={checked ? { scale: 0.98 } : {}}
              onClick={accept}
              disabled={!checked}
              className={`w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 ${
                checked
                  ? "bg-gradient-to-r from-sky-500 to-cyan-400 text-black shadow-[0_0_20px_rgba(56,189,248,0.3)] hover:shadow-[0_0_30px_rgba(56,189,248,0.5)]"
                  : "bg-white/5 text-white/20 border border-white/5 cursor-not-allowed"
              }`}
            >
              Continuar
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
