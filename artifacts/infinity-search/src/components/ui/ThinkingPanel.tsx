import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const THOUGHTS = [
  "Analisando sua mensagem…",
  "Verificando o contexto da conversa…",
  "Identificando intenção e tipo de dado…",
  "Conectando à base de dados Hydra…",
  "Avaliando qual ferramenta utilizar…",
  "Processando solicitação…",
  "Cruzando referências disponíveis…",
  "Formulando resposta…",
];

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M9.5 2C7.567 2 6 3.567 6 5.5c0 .28.034.552.098.813A3.501 3.501 0 0 0 4 9.5c0 1.202.608 2.262 1.535 2.893A3.5 3.5 0 0 0 5 13.5c0 1.45.882 2.7 2.148 3.233A3.5 3.5 0 0 0 10.5 20H11v2h2v-2h.5a3.5 3.5 0 0 0 3.352-2.267C18.118 16.2 19 14.95 19 13.5c0-.38-.052-.748-.149-1.098A3.5 3.5 0 0 0 20 9.5a3.501 3.501 0 0 0-2.098-3.187A3.5 3.5 0 0 0 14.5 2C13.2 2 12.02 2.59 11.25 3.523 10.48 2.59 9.3 2 8 2z"
        className="fill-current opacity-20"
      />
      <path
        d="M12 6v12M9 9c0-1.657 1.343-3 3-3M15 9c0-1.657-1.343-3-3-3M9 15c0 1.657 1.343 3 3 3M15 15c0 1.657-1.343 3-3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <ellipse cx="12" cy="12" rx="4.5" ry="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 9.5h9M7.5 14.5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ThinkingPanel() {
  const [elapsed, setElapsed] = useState(0);
  const [thoughts, setThoughts] = useState<string[]>([THOUGHTS[0]]);
  const [thoughtIdx, setThoughtIdx] = useState(0);
  const [typed, setTyped] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setThoughtIdx((i) => {
        const next = (i + 1) % THOUGHTS.length;
        setThoughts((prev) => {
          const updated = [...prev, THOUGHTS[next]].slice(-6);
          return updated;
        });
        setTyped(0);
        return next;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const current = THOUGHTS[thoughtIdx];
    if (typed >= current.length) return;
    const t = setTimeout(() => setTyped((n) => n + 1), 28);
    return () => clearTimeout(t);
  }, [typed, thoughtIdx]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thoughts, typed]);

  const fmtElapsed = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.25 }}
      className="w-full max-w-lg rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-950/60 via-black/50 to-cyan-950/40 backdrop-blur-xl overflow-hidden shadow-[0_0_40px_rgba(56,189,248,0.08)]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-sky-500/15">
        <div className="relative">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 rounded-full bg-sky-400/30 blur-md"
          />
          <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-sky-500/30 to-cyan-400/20 border border-sky-400/30 flex items-center justify-center">
            <BrainIcon className="w-4.5 h-4.5 text-sky-300" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-sky-300 tracking-wide">Pensando</div>
          <div className="text-[10px] text-sky-400/60 font-mono">{fmtElapsed}</div>
        </div>
        <div className="flex items-center gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-sky-400"
              animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1.1, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
            />
          ))}
        </div>
      </div>

      {/* Terminal thoughts */}
      <div
        ref={scrollRef}
        className="px-4 py-3 space-y-1.5 max-h-40 overflow-y-auto scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        {thoughts.slice(0, -1).map((t, i) => (
          <motion.div
            key={`${i}-${t}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 0.45, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-start gap-2 font-mono text-[11px] text-sky-400/50"
          >
            <span className="text-sky-600/60 shrink-0 mt-px">›</span>
            <span>{t}</span>
          </motion.div>
        ))}
        {thoughts.length > 0 && (
          <div className="flex items-start gap-2 font-mono text-[11px] text-sky-200">
            <motion.span
              className="text-sky-400 shrink-0 mt-px"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              ›
            </motion.span>
            <span>
              {THOUGHTS[thoughtIdx].slice(0, typed)}
              <motion.span
                className="inline-block w-0.5 h-3 bg-sky-400 ml-px align-middle"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              />
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
