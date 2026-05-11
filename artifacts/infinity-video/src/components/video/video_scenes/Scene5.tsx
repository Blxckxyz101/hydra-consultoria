import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';
import hydraLogo from '@assets/4dd5ed63-e0ef-48f8-a1ca-d13c3c00d495_1778525084093.jpeg';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Logo
      setTimeout(() => setPhase(2), 1200), // Tagline
      setTimeout(() => setPhase(3), 2000), // CTA buttons
      setTimeout(() => setPhase(4), 3200), // Contact line
      setTimeout(() => setPhase(5), 5500), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#030712]"
      {...sceneTransitions.morphExpand}
    >
      <div className="relative z-20 flex flex-col items-center">
        {/* Hydra Logo */}
        <motion.div 
          className="relative w-36 h-36 mb-6"
          initial={{ opacity: 0, scale: 0.5, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.5, filter: 'blur(10px)' }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <img 
            src={hydraLogo} 
            alt="Hydra Consultoria" 
            className="w-full h-full object-contain drop-shadow-[0_0_20px_rgba(14,165,233,0.8)]"
          />
        </motion.div>

        <motion.h1 
          className="text-4xl font-bold tracking-widest text-white mb-1"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          HYDRA
        </motion.h1>
        <motion.div
          className="text-xs font-mono text-[#0ea5e9]/70 tracking-[0.4em] uppercase mb-6"
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          CONSULTORIA
        </motion.div>

        <motion.div 
          className="text-sm font-mono text-[#0ea5e9] tracking-widest mb-8 text-center"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1 }}
        >
          INTELIGÊNCIA EM<br/>CADA CONSULTA
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          className="flex flex-col items-center gap-3 mb-6 w-full max-w-xs"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="w-full px-6 py-3 bg-[#0ea5e9]/15 border border-[#0ea5e9] rounded-full text-white text-sm font-bold tracking-wider backdrop-blur-sm text-center">
            ACESSE AGORA
          </div>
          <div className="flex gap-2 w-full">
            <div className="flex-1 px-4 py-2.5 bg-white/5 border border-white/15 rounded-full text-[#7dd3fc] text-xs font-semibold tracking-wider text-center">
              CONHEÇA OS PLANOS
            </div>
            <div className="flex-1 px-4 py-2.5 bg-white/5 border border-white/15 rounded-full text-[#7dd3fc] text-xs font-semibold tracking-wider text-center">
              SOLICITE UM TESTE
            </div>
          </div>
        </motion.div>

        {/* Contact / site line */}
        <motion.div
          className="flex flex-col items-center gap-1.5"
          initial={{ opacity: 0, y: 8 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.7 }}
        >
          <div className="flex items-center gap-2">
            <span className="w-12 h-px bg-[#0ea5e9]/40" />
            <span className="text-[10px] font-mono text-[#0ea5e9]/70 tracking-[0.25em] uppercase">entre em contato conosco</span>
            <span className="w-12 h-px bg-[#0ea5e9]/40" />
          </div>
          <p className="text-[11px] text-white/50 tracking-widest font-mono">
            🌐 <span className="text-[#38bdf8]">hydraconsultoria.pro</span>
          </p>
          <p className="text-[11px] text-white/50 tracking-widest font-mono">
            💬 <span className="text-[#38bdf8]">Entre em contato via WhatsApp</span>
          </p>
        </motion.div>
      </div>

      {/* Cyber grid floor */}
      <motion.div 
        className="absolute bottom-0 w-[200%] h-[40vh] border-t border-[#0ea5e9]/30"
        style={{
          background: 'linear-gradient(to top, rgba(14,165,233,0.1) 0%, transparent 100%)',
          transform: 'perspective(500px) rotateX(60deg)',
          backgroundImage: 'linear-gradient(rgba(14,165,233,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.2) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
        initial={{ opacity: 0, y: 50 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
      />
    </motion.div>
  );
}
