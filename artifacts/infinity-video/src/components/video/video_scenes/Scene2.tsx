import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

function AnimatedCounter({ target, duration = 1500 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return <>{value.toLocaleString('pt-BR')}</>;
}

const DASHBOARD_ROWS = [
  { label: "NOME", value: "JOÃO PEREIRA S.", status: "ok" },
  { label: "CPF", value: "•••.456.•••-78", status: "ok" },
  { label: "RENDA", value: "R$ 8.400/mês", status: "ok" },
  { label: "ENDEREÇO", value: "SP — Jardim Paulista", status: "ok" },
  { label: "SCORE", value: "810 pts", status: "high" },
  { label: "VEÍCULOS", value: "2 encontrados", status: "ok" },
];

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1300),
      setTimeout(() => setPhase(4), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-5 bg-[#020408] overflow-hidden"
      {...sceneTransitions.wipe}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#0ea5e9 1px, transparent 1px), linear-gradient(90deg, #0ea5e9 1px, transparent 1px)',
          backgroundSize: '30px 30px',
        }}
      />

      {/* Title */}
      <motion.div
        className="relative z-10 mb-4"
        initial={{ opacity: 0, x: -30 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
        transition={{ duration: 0.5, ease: 'circOut' }}
      >
        <div className="text-[#0ea5e9] font-mono text-[10px] tracking-[0.4em] mb-1 flex items-center gap-2">
          <motion.div
            className="w-2 h-2 rounded-full bg-[#0ea5e9]"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          PLATAFORMA
        </div>
        <h1 className="text-3xl font-black text-white leading-none tracking-tight">
          PODER DE<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#38bdf8] to-[#0ea5e9]">DECISÃO</span>
        </h1>
      </motion.div>

      {/* Fake dashboard panel */}
      <motion.div
        className="relative z-10 rounded-xl border border-[#0ea5e9]/25 bg-[#060e1a]/80 backdrop-blur overflow-hidden shadow-[0_0_40px_rgba(14,165,233,0.12)]"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6 }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#0ea5e9]/15 bg-[#0ea5e9]/5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400/80" />
            <span className="text-[9px] font-mono text-[#0ea5e9]/70 tracking-widest uppercase">CONSULTA · CPF COMPLETO</span>
          </div>
          <div className="text-[9px] font-mono text-white/30 tabular-nums">
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Data rows */}
        <div className="divide-y divide-[#0ea5e9]/8">
          {DASHBOARD_ROWS.map((row, i) => (
            <motion.div
              key={row.label}
              className="flex items-center justify-between px-3 py-2"
              initial={{ opacity: 0, x: -10 }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
              transition={{ delay: i * 0.1, duration: 0.3 }}
            >
              <span className="text-[9px] font-mono text-[#0ea5e9]/50 tracking-widest uppercase">{row.label}</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-mono font-bold ${row.status === 'high' ? 'text-green-400' : 'text-white/90'}`}>
                  {row.value}
                </span>
                <div className={`w-1 h-1 rounded-full ${row.status === 'high' ? 'bg-green-400' : 'bg-[#0ea5e9]'}`} />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div
        className="relative z-10 flex gap-2 mt-4"
        initial={{ opacity: 0, y: 15 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        {[
          { label: 'CONSULTAS', value: 48291, suffix: '+' },
          { label: 'UPTIME', value: 99, suffix: '.9%' },
          { label: 'BASES', value: 24, suffix: '' },
        ].map((stat) => (
          <div key={stat.label} className="flex-1 rounded-lg border border-[#0ea5e9]/20 bg-[#0ea5e9]/5 p-2 text-center">
            <div className="text-base font-black text-[#38bdf8] tabular-nums leading-none">
              {phase >= 3 ? <AnimatedCounter target={stat.value} /> : '0'}{stat.suffix}
            </div>
            <div className="text-[8px] font-mono text-white/30 tracking-widest mt-0.5">{stat.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Floating badge */}
      <motion.div
        className="absolute top-1/3 -right-2 bg-[#020408]/90 border border-[#0ea5e9]/40 px-3 py-1.5 rounded-l-lg text-[9px] font-mono text-[#0ea5e9] z-20"
        initial={{ opacity: 0, x: 20 }}
        animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.8 }}
        style={{ boxShadow: '0 0 15px rgba(14,165,233,0.2)' }}
      >
        🔒 CRIPTOGRAFADO
      </motion.div>

      {/* Scan line over dashboard */}
      {phase >= 2 && (
        <motion.div
          className="absolute left-5 right-5 h-[1px] z-30 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, #38bdf8, transparent)', boxShadow: '0 0 8px #38bdf8' }}
          animate={{ top: ['30%', '85%'] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}
