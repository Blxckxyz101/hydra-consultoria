import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';
import hydraLogo from '@/hydra-logo.jpg';

const THEMES = [
  { name: 'Hydra Infinity', color: '#0ea5e9' },
  { name: 'Violeta Zero',   color: '#a78bfa' },
  { name: 'Esmeralda',      color: '#34d399' },
  { name: 'Âmbar Real',     color: '#f59e0b' },
  { name: 'Rosa Sakura',    color: '#f472b6' },
  { name: 'Escarlate',      color: '#f87171' },
  { name: 'Índigo Void',    color: '#6366f1' },
  { name: 'Laranja Fênix',  color: '#fb923c' },
  { name: 'Lima Neon',      color: '#a3e635' },
  { name: 'Coral Inferno',  color: '#ff6b6b' },
  { name: 'Ciano Profundo', color: '#06b6d4' },
  { name: 'Roxo Neon',      color: '#c084fc' },
  { name: 'AMOLED Black',   color: '#ffffff' },
  { name: 'Preto & Cinza',  color: '#9ca3af' },
];

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const [activeTheme, setActiveTheme] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 350),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1500),
      setTimeout(() => setPhase(4), 2200),
    ];
    // Cycle themes for visual effect
    const themeInterval = setInterval(() => {
      setActiveTheme(t => (t + 1) % THEMES.length);
    }, 380);
    return () => {
      timers.forEach(t => clearTimeout(t));
      clearInterval(themeInterval);
    };
  }, []);

  const accent = THEMES[activeTheme].color;

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-end bg-[#020408] overflow-hidden"
      {...sceneTransitions.morphExpand}
    >
      {/* Cyber floor grid */}
      <motion.div
        className="absolute bottom-0 left-1/2 pointer-events-none"
        style={{
          width: '220%',
          height: '40vh',
          transform: 'perspective(380px) rotateX(55deg) translateX(-50%) translateY(8%)',
          backgroundImage: `linear-gradient(${accent}30 1px, transparent 1px), linear-gradient(90deg, ${accent}30 1px, transparent 1px)`,
          backgroundSize: '44px 44px',
        }}
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
      />

      {/* Horizon glow */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          bottom: '30%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '120%',
          height: '2px',
          background: `linear-gradient(90deg, transparent, ${accent}, ${accent}cc, ${accent}, transparent)`,
          boxShadow: `0 0 40px 4px ${accent}99`,
        }}
        initial={{ opacity: 0, scaleX: 0 }}
        animate={phase >= 1 ? { opacity: 1, scaleX: 1 } : { opacity: 0, scaleX: 0 }}
        transition={{ duration: 1 }}
      />

      {/* Main content */}
      <div className="relative z-20 flex flex-col items-center pb-[34%] gap-2.5 w-full px-5">

        {/* Logo */}
        <motion.div
          className="w-16 h-16 rounded-xl overflow-hidden border shadow-[0_0_28px_rgba(14,165,233,0.4)] shrink-0"
          style={{ borderColor: `${accent}60` }}
          initial={{ opacity: 0, scale: 0.4, filter: 'blur(15px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : {}}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <img src={hydraLogo} alt="Hydra" className="w-full h-full object-cover" />
        </motion.div>

        {/* Brand */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 14 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          transition={{ duration: 0.6 }}
        >
          <div
            className="text-[28px] font-black tracking-[0.22em] text-white"
            style={{ textShadow: `0 0 20px ${accent}80` }}
          >
            HYDRA
          </div>
          <div className="text-[9px] font-mono tracking-[0.5em] uppercase -mt-0.5" style={{ color: `${accent}bb` }}>
            CONSULTORIA
          </div>
        </motion.div>

        {/* Theme palette showcase */}
        <motion.div
          className="flex flex-col items-center gap-1.5 w-full"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          <div className="text-[7px] font-mono text-white/25 tracking-[0.4em] uppercase">
            14 TEMAS PERSONALIZÁVEIS
          </div>
          <div className="flex gap-1 flex-wrap justify-center max-w-[200px]">
            {THEMES.map((t, i) => (
              <motion.div
                key={t.name}
                className="w-4 h-4 rounded-full border-2 transition-all"
                style={{
                  background: t.color,
                  borderColor: i === activeTheme ? 'white' : 'transparent',
                  boxShadow: i === activeTheme ? `0 0 8px ${t.color}` : 'none',
                  transform: i === activeTheme ? 'scale(1.3)' : 'scale(1)',
                }}
                title={t.name}
              />
            ))}
          </div>
          <div className="text-[8px] font-mono transition-all" style={{ color: accent }}>
            {THEMES[activeTheme].name}
          </div>
        </motion.div>

        {/* CTA button */}
        <motion.div
          className="flex flex-col items-center gap-2 w-full max-w-[210px] mt-1"
          initial={{ opacity: 0, scale: 0.9, y: 14 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 14 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        >
          <motion.div
            className="w-full py-2.5 rounded-full text-center text-white text-[11px] font-black tracking-[0.2em] uppercase"
            style={{
              background: `linear-gradient(135deg, ${accent}cc, ${accent})`,
              boxShadow: `0 0 22px ${accent}80, 0 0 40px ${accent}30`,
            }}
            animate={{
              boxShadow: [
                `0 0 22px ${accent}80`,
                `0 0 38px ${accent}cc`,
                `0 0 22px ${accent}80`,
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            ACESSE AGORA
          </motion.div>

          <div className="flex gap-2 w-full">
            {['VER PLANOS', 'TESTAR GRÁTIS'].map((label) => (
              <div
                key={label}
                className="flex-1 py-1.5 rounded-full text-center text-[8px] font-semibold tracking-wider text-white/60 border border-white/15 bg-white/5"
              >
                {label}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Contact info */}
        <motion.div
          className="flex flex-col items-center gap-1 mt-0.5"
          initial={{ opacity: 0, y: 8 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2">
            <span className="w-8 h-px bg-white/15" />
            <span className="text-[7px] font-mono text-white/25 tracking-[0.3em] uppercase">acesso imediato</span>
            <span className="w-8 h-px bg-white/15" />
          </div>
          <div className="flex gap-3">
            <span className="text-[9px] font-mono">
              🌐 <span style={{ color: accent }}>hydraconsultoria.pro</span>
            </span>
            <span className="text-[9px] font-mono">
              ✈️ <span className="text-[#7dd3fc]">t.me/hydraconsultoria</span>
            </span>
          </div>
        </motion.div>
      </div>

      {/* Particles */}
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full"
          style={{ left: `${10 + i * 11}%`, background: accent }}
          initial={{ top: '-5%', opacity: 0 }}
          animate={phase >= 1 ? { top: `${28 + (i % 4) * 7}%`, opacity: [0, 0.9, 0] } : {}}
          transition={{ delay: i * 0.12, duration: 1.6, ease: 'easeOut' }}
        />
      ))}
    </motion.div>
  );
}
