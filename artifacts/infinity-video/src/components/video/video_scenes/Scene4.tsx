import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

function useCounter(target: number, duration: number, active: boolean) {
  const [val, setVal] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    startRef.current = performance.now();
    const tick = (now: number) => {
      const elapsed = now - (startRef.current ?? now);
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setVal(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, target, duration]);

  return val;
}

const SPEED_BARS = [
  { label: 'CPF', ms: 420 },
  { label: 'CNPJ', ms: 580 },
  { label: 'PLACA', ms: 310 },
  { label: 'TELEFONE', ms: 490 },
  { label: 'NOME', ms: 650 },
];

export function Scene4() {
  const [phase, setPhase] = useState(0);
  const users = useCounter(12847, 1200, phase >= 3);
  const queries = useCounter(4930217, 1500, phase >= 3);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => setPhase(4), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const maxMs = Math.max(...SPEED_BARS.map(b => b.ms));

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-5 bg-[#020408] overflow-hidden"
      {...sceneTransitions.perspectiveFlip}
    >
      {/* Background pulse */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(14,165,233,0.07) 0%, transparent 70%)' }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity }}
      />

      {/* Headline */}
      <motion.div
        className="relative z-10 mb-5"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-[#0ea5e9] font-mono text-[9px] tracking-[0.4em] mb-2 uppercase">PERFORMANCE</div>
        <h2 className="text-4xl font-black text-white leading-none">
          RESULTADOS EM
        </h2>
        <motion.div
          className="text-5xl font-black leading-none"
          style={{
            textShadow: '0 0 30px rgba(14,165,233,0.8)',
            color: '#38bdf8',
          }}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={phase >= 2 ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.2 }}
        >
          SEGUNDOS
        </motion.div>
      </motion.div>

      {/* Speed bars */}
      <div className="relative z-10 space-y-2 mb-5">
        {SPEED_BARS.map((bar, i) => (
          <motion.div
            key={bar.label}
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
          >
            <span className="text-[9px] font-mono text-white/50 w-14 shrink-0 uppercase tracking-wide">{bar.label}</span>
            <div className="flex-1 h-2 bg-[#0ea5e9]/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)', boxShadow: '0 0 6px #0ea5e9' }}
                initial={{ width: '0%' }}
                animate={phase >= 3 ? { width: `${(bar.ms / maxMs) * 100}%` } : { width: '0%' }}
                transition={{ delay: i * 0.1 + 0.2, duration: 0.7, ease: 'circOut' }}
              />
            </div>
            <span className="text-[9px] font-mono text-[#38bdf8] w-10 text-right shrink-0">
              {phase >= 3 ? `${bar.ms}ms` : '—'}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Stats */}
      <motion.div
        className="relative z-10 grid grid-cols-2 gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        <div className="rounded-xl border border-[#0ea5e9]/20 bg-[#0ea5e9]/5 p-3 text-center">
          <div className="text-2xl font-black text-[#38bdf8] tabular-nums leading-none">
            {users.toLocaleString('pt-BR')}
          </div>
          <div className="text-[8px] font-mono text-white/30 tracking-widest mt-1">USUÁRIOS ATIVOS</div>
        </div>
        <div className="rounded-xl border border-[#0ea5e9]/20 bg-[#0ea5e9]/5 p-3 text-center">
          <div className="text-lg font-black text-[#38bdf8] tabular-nums leading-none">
            {queries.toLocaleString('pt-BR')}
          </div>
          <div className="text-[8px] font-mono text-white/30 tracking-widest mt-1">CONSULTAS FEITAS</div>
        </div>
      </motion.div>

      {/* Uptime badge */}
      <motion.div
        className="absolute top-6 right-5 flex items-center gap-1.5 border border-green-400/30 bg-green-400/10 rounded-full px-2.5 py-1 z-20"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
        transition={{ delay: 0.5, type: 'spring' }}
      >
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-green-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
        <span className="text-[9px] font-mono text-green-400 tracking-widest">99.9% UPTIME</span>
      </motion.div>
    </motion.div>
  );
}
