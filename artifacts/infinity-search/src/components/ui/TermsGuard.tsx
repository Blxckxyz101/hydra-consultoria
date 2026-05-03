import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, AlertTriangle, ExternalLink, X } from "lucide-react";
import logoUrl from "@/assets/logo.png";

const LS_KEY = "infinity_terms_v1";

function hasAccepted() {
  try { return localStorage.getItem(LS_KEY) === "accepted"; } catch { return false; }
}

const TERMS = [
  {
    icon: "💳",
    title: "Sem reembolso",
    text: "Todas as assinaturas e pagamentos são definitivos e não reembolsáveis, independente do motivo.",
  },
  {
    icon: "⚡",
    title: "Sem responsabilidade por instabilidades",
    text: "O Infinity Search não se responsabiliza por interrupções, lentidão, indisponibilidade ou perda de dados causados por falhas técnicas, ataques ou manutenção.",
  },
  {
    icon: "🛡️",
    title: "Sem responsabilidade por atos de terceiros",
    text: "O Infinity Search não se responsabiliza por ações, danos ou prejuízos causados por terceiros com dados obtidos pela plataforma.",
  },
  {
    icon: "🕵️",
    title: "Uso legal e exclusivo do usuário",
    text: "O usuário declara que utilizará as consultas exclusivamente para fins lícitos. O uso indevido é de inteira responsabilidade do usuário, eximindo totalmente o Infinity Search.",
  },
  {
    icon: "🔒",
    title: "Conformidade com a LGPD",
    text: "As consultas são realizadas em bases de dados de acesso público ou fontes legalmente autorizadas. O usuário se compromete a tratar os dados obtidos conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).",
  },
  {
    icon: "📵",
    title: "Vedação de compartilhamento",
    text: "É proibido revender, compartilhar ou redistribuir o acesso à plataforma. Infrações resultam em encerramento imediato da conta sem reembolso.",
  },
];

export function TermsGuard({ children }: { children: React.ReactNode }) {
  const [accepted, setAccepted] = useState(hasAccepted);
  const [refused, setRefused] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  if (accepted) return <>{children}</>;

  const accept = () => {
    try { localStorage.setItem(LS_KEY, "accepted"); } catch {}
    setAccepted(true);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-[#030712]" />
      <div className="absolute inset-0 bg-gradient-to-br from-sky-950/30 via-transparent to-cyan-950/20" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-2xl"
      >
        <div className="rounded-3xl border border-white/10 bg-black/60 backdrop-blur-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-white/5 flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-2xl bg-sky-400/20 blur-xl" />
              <img src={logoUrl} alt="Infinity" className="relative w-14 h-14 object-contain drop-shadow-[0_0_16px_rgba(56,189,248,0.5)]" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <span className="text-[10px] uppercase tracking-[0.5em] text-sky-400/80">Termos de Uso</span>
              </div>
              <h1 className="text-xl font-bold tracking-wide">Infinity Search</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Leia e aceite os termos antes de continuar</p>
            </div>
          </div>

          {/* Terms list */}
          <div
            className="px-8 py-6 space-y-4 max-h-[52vh] overflow-y-auto"
            onScroll={(e) => { if ((e.target as HTMLDivElement).scrollTop > 40) setScrolled(true); }}
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(56,189,248,0.2) transparent" }}
          >
            {TERMS.map((term, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className="flex gap-4 p-4 rounded-2xl bg-white/3 border border-white/6 hover:bg-white/5 transition-colors"
              >
                <div className="text-2xl shrink-0 mt-0.5">{term.icon}</div>
                <div>
                  <div className="text-sm font-semibold text-white mb-1">{term.title}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">{term.text}</div>
                </div>
              </motion.div>
            ))}

            <div className="pt-2 pb-1 px-1">
              <p className="text-[11px] text-muted-foreground/60 leading-relaxed text-center">
                Ao clicar em <strong className="text-white">Concordo</strong>, você declara ter lido, compreendido e aceitado integralmente estes Termos de Uso e a Política de Privacidade do Infinity Search, em conformidade com a LGPD (Lei 13.709/2018).
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-6 border-t border-white/5 bg-black/20">
            <AnimatePresence>
              {refused && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-4 flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    Para usar o Infinity Search é necessário aceitar os termos de uso. Sem a aceitação, o acesso à plataforma não será liberado.
                  </p>
                  <button onClick={() => setRefused(false)} className="shrink-0 p-0.5 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex gap-3">
              <button
                onClick={() => setRefused(true)}
                className="flex-1 py-3 rounded-2xl border border-white/10 text-muted-foreground hover:text-white hover:border-white/20 transition-all text-sm font-medium"
              >
                Recusar
              </button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={accept}
                className="flex-[2] py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 text-black font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(56,189,248,0.35)] hover:shadow-[0_0_36px_rgba(56,189,248,0.55)] transition-shadow"
              >
                <ShieldCheck className="w-4 h-4" />
                Concordo com os Termos
              </motion.button>
            </div>

            {!scrolled && (
              <p className="text-center text-[10px] text-muted-foreground/40 mt-3">
                Role para baixo para ler todos os termos
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
