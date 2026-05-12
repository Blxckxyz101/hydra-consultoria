import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

const CAPABILITIES = [
  { icon: '👤', label: 'CPF COMPLETO', cat: 'PESSOA' },
  { icon: '🏢', label: 'CNPJ / EMPRESA', cat: 'EMPRESA' },
  { icon: '🚗', label: 'PLACA / VEÍCULO', cat: 'VEÍCULO' },
  { icon: '📱', label: 'TELEFONE', cat: 'PESSOA' },
  { icon: '💰', label: 'RENDA / IRPF', cat: 'SAÚDE' },
  { icon: '📊', label: 'SCORE CRÉDITO', cat: 'SAÚDE' },
  { icon: '🏠', label: 'ENDEREÇO', cat: 'PESSOA' },
  { icon: '📸', label: 'FOTO BIOMÉTRICA', cat: 'PESSOA' },
];

const CAT_COLORS: Record<string, string> = {
  PESSOA: '#0ea5e9',
  EMPRESA: '#a78bfa',
  VEÍCULO: '#34d399',
  SAÚDE: '#f59e0b',
};

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 700),
      setTimeout(() => setPhase(3), 1200),
      setTimeout(() => setPhase(4), 5500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-5 bg-[#020408] overflow-hidden"
      {...sceneTransitions.pushLeft}
    >
      {/* Background: radial gradient accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(14,165,233,0.06) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <motion.div
        className="mb-4 z-10 relative"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.5 }}
      >
        <div className="inline-flex items-center gap-2 border border-[#0ea5e9]/30 bg-[#0ea5e9]/10 rounded-full px-3 py-1 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9] animate-pulse" />
          <span className="text-[#0ea5e9] font-mono text-[9px] tracking-[0.35em] uppercase">CAPABILITY_SCAN</span>
        </div>
        <div className="flex items-end gap-2">
          <h2 className="text-5xl font-black text-white leading-none">+24</h2>
          <div className="pb-1">
            <div className="text-[#38bdf8] font-bold text-lg leading-none">TIPOS DE</div>
            <div className="text-[#38bdf8] font-bold text-lg leading-none">CONSULTA</div>
          </div>
        </div>
      </motion.div>

      {/* Capabilities grid */}
      <div className="relative z-10 grid grid-cols-2 gap-2">
        {CAPABILITIES.map((cap, i) => (
          <motion.div
            key={cap.label}
            className="flex items-center gap-2 rounded-lg p-2.5 border"
            style={{
              borderColor: `${CAT_COLORS[cap.cat]}30`,
              background: `${CAT_COLORS[cap.cat]}08`,
            }}
            initial={{ opacity: 0, scale: 0.8, x: i % 2 === 0 ? -15 : 15 }}
            animate={phase >= 3 ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.8, x: i % 2 === 0 ? -15 : 15 }}
            transition={{ delay: i * 0.09, type: 'spring', stiffness: 400, damping: 25 }}
          >
            <span className="text-base leading-none">{cap.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-bold text-white/90 truncate leading-tight">{cap.label}</div>
              <div className="text-[7px] font-mono leading-none mt-0.5" style={{ color: CAT_COLORS[cap.cat] }}>
                {cap.cat}
              </div>
            </div>
            <motion.div
              className="w-1 h-1 rounded-full shrink-0"
              style={{ background: CAT_COLORS[cap.cat] }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Bottom counter bar */}
      <motion.div
        className="relative z-10 mt-4 flex gap-2"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
      >
        {Object.entries(CAT_COLORS).map(([cat, color]) => (
          <div key={cat} className="flex-1 flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[7px] font-mono text-white/40 truncate">{cat}</span>
          </div>
        ))}
      </motion.div>

      {/* Vertical accent line */}
      <motion.div
        className="absolute right-5 top-8 bottom-8 w-px z-10"
        style={{ background: 'linear-gradient(to bottom, transparent, #0ea5e9, transparent)' }}
        initial={{ scaleY: 0 }}
        animate={phase >= 2 ? { scaleY: 1 } : { scaleY: 0 }}
        transition={{ duration: 0.8 }}
      />
    </motion.div>
  );
}
