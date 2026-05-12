import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

const MODULES = [
  { icon: '👤', label: 'CPF COMPLETO',     cat: 'PESSOA' },
  { icon: '📸', label: 'FOTO BIOMÉTRICA',  cat: 'FOTOS' },
  { icon: '🚗', label: 'PLACA / VEÍCULO',  cat: 'VEÍCULO' },
  { icon: '🏢', label: 'CNPJ / EMPRESA',   cat: 'EMPRESA' },
  { icon: '📱', label: 'TELEFONE',         cat: 'PESSOA' },
  { icon: '💰', label: 'RENDA / IRPF',     cat: 'SAÚDE' },
  { icon: '📊', label: 'SCORE CRÉDITO',    cat: 'SAÚDE' },
  { icon: '🏠', label: 'ENDEREÇO / CEP',   cat: 'PESSOA' },
  { icon: '💳', label: 'PIX / CHAVE',      cat: 'PESSOA' },
  { icon: '⚖️',  label: 'PROCESSOS',        cat: 'PROCESSOS' },
  { icon: '👨‍👩‍👧', label: 'PARENTES / RG',   cat: 'PESSOA' },
  { icon: '🌐', label: 'EMAIL / SOCIAL',   cat: 'SOCIAL' },
];

const CAT_COLORS: Record<string, string> = {
  PESSOA:    '#0ea5e9',
  FOTOS:     '#f472b6',
  VEÍCULO:   '#34d399',
  EMPRESA:   '#a78bfa',
  SAÚDE:     '#f59e0b',
  PROCESSOS: '#fb923c',
  SOCIAL:    '#38bdf8',
};

const PROVIDERS = [
  { name: 'GEASS API',   dot: '#0ea5e9', modules: '68 módulos' },
  { name: 'SKYLERS API', dot: '#a78bfa', modules: '24 módulos' },
];

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 150),
      setTimeout(() => setPhase(2), 550),
      setTimeout(() => setPhase(3), 950),
      setTimeout(() => setPhase(4), 1800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-4 bg-[#020408] overflow-hidden"
      {...sceneTransitions.pushLeft}
    >
      {/* Radial glow top */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(14,165,233,0.07) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <motion.div
        className="mb-3 z-10 relative"
        initial={{ opacity: 0, y: -18 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -18 }}
        transition={{ duration: 0.5 }}
      >
        <div className="inline-flex items-center gap-2 border border-[#0ea5e9]/30 bg-[#0ea5e9]/10 rounded-full px-3 py-1 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9] animate-pulse" />
          <span className="text-[#0ea5e9] font-mono text-[8px] tracking-[0.3em] uppercase">MÓDULOS CONECTADOS</span>
        </div>

        <div className="flex items-end gap-2">
          <span
            className="text-[52px] font-black leading-none"
            style={{ color: '#38bdf8', textShadow: '0 0 25px rgba(56,189,248,0.6)' }}
          >
            +92
          </span>
          <div className="pb-1.5">
            <div className="text-white font-bold text-[15px] leading-tight">TIPOS DE</div>
            <div className="text-white font-bold text-[15px] leading-tight">CONSULTA</div>
          </div>
        </div>
      </motion.div>

      {/* Provider badges */}
      <motion.div
        className="flex gap-2 mb-3 z-10 relative"
        initial={{ opacity: 0, x: -15 }}
        animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -15 }}
        transition={{ duration: 0.4 }}
      >
        {PROVIDERS.map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border"
            style={{ borderColor: `${p.dot}30`, background: `${p.dot}0a` }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.dot }} />
            <span className="text-[8px] font-mono font-bold" style={{ color: p.dot }}>{p.name}</span>
            <span className="text-[7px] font-mono text-white/30">{p.modules}</span>
          </div>
        ))}
      </motion.div>

      {/* Modules grid */}
      <div className="relative z-10 grid grid-cols-2 gap-1.5">
        {MODULES.map((m, i) => (
          <motion.div
            key={m.label}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 border"
            style={{
              borderColor: `${CAT_COLORS[m.cat]}28`,
              background: `${CAT_COLORS[m.cat]}07`,
            }}
            initial={{ opacity: 0, scale: 0.82, x: i % 2 === 0 ? -12 : 12 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.82, x: i % 2 === 0 ? -12 : 12 }}
            transition={{ delay: i * 0.07, type: 'spring', stiffness: 420, damping: 26 }}
          >
            <span className="text-[13px] leading-none shrink-0">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[8.5px] font-bold text-white/90 truncate leading-tight">{m.label}</div>
              <div className="text-[6.5px] font-mono leading-none mt-0.5" style={{ color: CAT_COLORS[m.cat] }}>
                {m.cat}
              </div>
            </div>
            <motion.div
              className="w-1 h-1 rounded-full shrink-0"
              style={{ background: CAT_COLORS[m.cat] }}
              animate={{ opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.18 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Category legend */}
      <motion.div
        className="relative z-10 flex flex-wrap gap-x-3 gap-y-1 mt-2"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        {Object.entries(CAT_COLORS).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[6.5px] font-mono text-white/35">{cat}</span>
          </div>
        ))}
      </motion.div>

      {/* Right vertical accent */}
      <motion.div
        className="absolute right-4 top-6 bottom-6 w-px z-10"
        style={{ background: 'linear-gradient(to bottom, transparent, #0ea5e9, transparent)' }}
        initial={{ scaleY: 0 }}
        animate={phase >= 2 ? { scaleY: 1 } : { scaleY: 0 }}
        transition={{ duration: 0.9 }}
      />
    </motion.div>
  );
}
