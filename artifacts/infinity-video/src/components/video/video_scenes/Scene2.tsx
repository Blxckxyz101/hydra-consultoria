import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

function useCounter(target: number, duration: number, active: boolean) {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, target, duration]);
  return val;
}

const WEEK_BARS = [
  { day: 'SEG', pct: 62 },
  { day: 'TER', pct: 78 },
  { day: 'QUA', pct: 91 },
  { day: 'QUI', pct: 55 },
  { day: 'SEX', pct: 100 },
  { day: 'SAB', pct: 44 },
  { day: 'DOM', pct: 30 },
];

export function Scene2() {
  const [phase, setPhase] = useState(0);
  const totalConsultas = useCounter(48_291, 1400, phase >= 3);
  const hojeConsultas  = useCounter(1_847,  1000, phase >= 3);
  const taxaSucesso    = useCounter(98,      800,  phase >= 3);
  const operadores     = useCounter(3_240,  1200, phase >= 3);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 650),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => setPhase(4), 2200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-4 bg-[#020408] overflow-hidden"
      {...sceneTransitions.wipe}
    >
      {/* Subtle grid bg */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#0ea5e9 1px, transparent 1px), linear-gradient(90deg, #0ea5e9 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Header */}
      <motion.div
        className="relative z-10 mb-3"
        initial={{ opacity: 0, x: -25 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -25 }}
        transition={{ duration: 0.5, ease: 'circOut' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <motion.div
            className="w-2 h-2 rounded-full bg-green-400"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          <span className="text-[9px] font-mono text-[#0ea5e9]/60 tracking-[0.35em] uppercase">SISTEMA OPERACIONAL</span>
        </div>
        <h1 className="text-[26px] font-black text-white leading-none tracking-tight">
          CENTRO DE<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#38bdf8] to-[#0ea5e9]">
            COMANDO
          </span>
        </h1>
        <div className="text-[9px] font-mono text-white/30 mt-1 tracking-wider">
          Bem-vindo, Operador · Nível PRO
        </div>
      </motion.div>

      {/* Metrics grid — 2x2 */}
      <motion.div
        className="relative z-10 grid grid-cols-2 gap-2 mb-3"
        initial={{ opacity: 0, y: 18 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
        transition={{ duration: 0.5 }}
      >
        {[
          { label: 'CONSULTAS TOTAIS', value: totalConsultas.toLocaleString('pt-BR'), accent: '#38bdf8', icon: '🔍' },
          { label: 'CONSULTAS HOJE',   value: hojeConsultas.toLocaleString('pt-BR'),  accent: '#34d399', icon: '📅' },
          { label: 'TAXA DE SUCESSO',  value: `${taxaSucesso}%`,                       accent: '#a78bfa', icon: '✅' },
          { label: 'OPERADORES',       value: operadores.toLocaleString('pt-BR'),      accent: '#f59e0b', icon: '👥' },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            className="rounded-xl border p-2.5"
            style={{
              borderColor: `${m.accent}25`,
              background: `${m.accent}08`,
            }}
            initial={{ opacity: 0, scale: 0.88 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.88 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 380, damping: 22 }}
          >
            <div className="text-[11px] mb-0.5">{m.icon}</div>
            <div
              className="text-[18px] font-black tabular-nums leading-none"
              style={{ color: m.accent }}
            >
              {m.value}
            </div>
            <div className="text-[7px] font-mono text-white/30 tracking-widest mt-0.5 leading-tight">
              {m.label}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Weekly activity chart */}
      <motion.div
        className="relative z-10 rounded-xl border border-[#0ea5e9]/18 bg-[#060e1a]/70 p-3"
        initial={{ opacity: 0, y: 14 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8px] font-mono text-[#0ea5e9]/50 tracking-widest uppercase">USO SEMANAL</span>
          <span className="text-[8px] font-mono text-green-400/70">↑ 23% vs semana anterior</span>
        </div>
        <div className="flex items-end gap-1 h-10">
          {WEEK_BARS.map((b, i) => (
            <div key={b.day} className="flex-1 flex flex-col items-center gap-0.5">
              <motion.div
                className="w-full rounded-t"
                style={{ background: i === 4 ? 'linear-gradient(to top, #0ea5e9, #38bdf8)' : 'rgba(14,165,233,0.3)' }}
                initial={{ height: 0 }}
                animate={phase >= 4 ? { height: `${b.pct}%` } : { height: 0 }}
                transition={{ delay: i * 0.06 + 0.2, duration: 0.5, ease: 'circOut' }}
              />
              <span className="text-[6px] font-mono text-white/25">{b.day}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Extra metrics strip */}
      <motion.div
        className="relative z-10 flex gap-2 mt-2"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        {[
          { label: 'COTA DIÁRIA',   value: '2.000', sub: 'consultas restantes' },
          { label: 'BASES ONLINE',  value: '5/6',   sub: 'provedores ativos' },
          { label: 'UPTIME',        value: '99,9%', sub: 'disponibilidade' },
        ].map((s) => (
          <div
            key={s.label}
            className="flex-1 rounded-lg border border-[#0ea5e9]/15 bg-[#0ea5e9]/5 p-1.5 text-center"
          >
            <div className="text-[12px] font-black text-[#38bdf8] leading-none tabular-nums">{s.value}</div>
            <div className="text-[6.5px] font-mono text-white/25 tracking-wider mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </motion.div>

      {/* Scan line */}
      {phase >= 2 && (
        <motion.div
          className="absolute left-4 right-4 h-px z-30 pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, #38bdf8, transparent)', boxShadow: '0 0 8px #38bdf8' }}
          animate={{ top: ['15%', '90%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      )}
    </motion.div>
  );
}
