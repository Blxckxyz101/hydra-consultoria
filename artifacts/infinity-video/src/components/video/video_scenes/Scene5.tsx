import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';
import hydraLogo from '@/hydra-logo.jpg';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 1700),
      setTimeout(() => setPhase(4), 2400),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-end bg-[#020408] overflow-hidden"
      {...sceneTransitions.morphExpand}
    >
      {/* Cyber floor grid (perspective) */}
      <motion.div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: '200%',
          height: '45vh',
          transform: 'perspective(400px) rotateX(55deg) translateX(-50%) translateY(10%)',
          background: 'linear-gradient(to top, rgba(14,165,233,0.15) 0%, transparent 100%)',
          backgroundImage: 'linear-gradient(rgba(14,165,233,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.25) 1px, transparent 1px)',
          backgroundSize: '50px 50px',
        }}
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
      />

      {/* Horizon glow */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          bottom: '32%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '120%',
          height: '2px',
          background: 'linear-gradient(90deg, transparent, #0ea5e9, #38bdf8, #0ea5e9, transparent)',
          boxShadow: '0 0 40px 4px rgba(14,165,233,0.6)',
        }}
        initial={{ opacity: 0, scaleX: 0 }}
        animate={phase >= 1 ? { opacity: 1, scaleX: 1 } : { opacity: 0, scaleX: 0 }}
        transition={{ duration: 1 }}
      />

      {/* Main content (above grid) */}
      <div className="relative z-20 flex flex-col items-center pb-[38%] gap-3">
        {/* Logo */}
        <motion.div
          className="w-20 h-20 rounded-2xl overflow-hidden border border-[#0ea5e9]/40 shadow-[0_0_30px_rgba(14,165,233,0.4)] shrink-0"
          initial={{ opacity: 0, scale: 0.4, filter: 'blur(15px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : {}}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <img src={hydraLogo} alt="Hydra" className="w-full h-full object-cover" />
        </motion.div>

        {/* Brand name */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 15 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-3xl font-black tracking-[0.25em] text-white" style={{ textShadow: '0 0 20px rgba(14,165,233,0.5)' }}>
            HYDRA
          </div>
          <div className="text-[10px] font-mono text-[#0ea5e9]/70 tracking-[0.5em] uppercase -mt-0.5">
            CONSULTORIA
          </div>
        </motion.div>

        {/* Tagline */}
        <motion.div
          className="text-[10px] font-mono text-[#38bdf8]/60 tracking-[0.25em] text-center uppercase"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          INTELIGÊNCIA EM CADA CONSULTA
        </motion.div>

        {/* CTA */}
        <motion.div
          className="flex flex-col items-center gap-2 w-full max-w-[220px]"
          initial={{ opacity: 0, scale: 0.9, y: 15 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 15 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        >
          <motion.div
            className="w-full py-2.5 rounded-full text-center text-white text-xs font-bold tracking-[0.2em] cursor-pointer select-none uppercase"
            style={{
              background: 'linear-gradient(135deg, #0369a1, #0ea5e9)',
              boxShadow: '0 0 20px rgba(14,165,233,0.5), 0 0 40px rgba(14,165,233,0.2)',
            }}
            animate={{ boxShadow: ['0 0 20px rgba(14,165,233,0.5)', '0 0 35px rgba(14,165,233,0.8)', '0 0 20px rgba(14,165,233,0.5)'] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            ACESSE AGORA
          </motion.div>

          <div className="flex gap-2 w-full">
            {['VER PLANOS', 'TESTAR GRÁTIS'].map((label, i) => (
              <div key={label} className="flex-1 py-2 rounded-full text-center text-[9px] font-semibold tracking-wider text-[#7dd3fc] border border-[#0ea5e9]/25 bg-[#0ea5e9]/5">
                {label}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Website */}
        <motion.div
          className="flex flex-col items-center gap-1 mt-1"
          initial={{ opacity: 0, y: 8 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-2">
            <span className="w-10 h-px bg-[#0ea5e9]/30" />
            <span className="text-[8px] font-mono text-white/30 tracking-[0.3em] uppercase">entre em contato</span>
            <span className="w-10 h-px bg-[#0ea5e9]/30" />
          </div>
          <span className="text-[10px] font-mono">
            🌐 <span className="text-[#38bdf8]">hydraconsultoria.pro</span>
          </span>
        </motion.div>
      </div>

      {/* Top particles flying in */}
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-[#0ea5e9]"
          style={{ left: `${15 + i * 12}%` }}
          initial={{ top: '-5%', opacity: 0 }}
          animate={phase >= 1 ? { top: `${30 + (i % 3) * 8}%`, opacity: [0, 0.8, 0] } : {}}
          transition={{ delay: i * 0.15, duration: 1.5, ease: 'easeOut' }}
        />
      ))}
    </motion.div>
  );
}
