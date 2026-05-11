import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '../../lib/video/animations';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // Logo
      setTimeout(() => setPhase(2), 1200), // Tagline
      setTimeout(() => setPhase(3), 2000), // CTA
      setTimeout(() => setPhase(4), 4500), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#030712]"
      {...sceneTransitions.morphExpand}
    >
      <div className="relative z-20 flex flex-col items-center">
        {/* Infinity Logo constructed with CSS */}
        <motion.div 
          className="relative w-32 h-16 mb-8"
          initial={{ opacity: 0, scale: 0.5, filter: 'blur(10px)' }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.5, filter: 'blur(10px)' }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <svg viewBox="0 0 100 50" className="w-full h-full drop-shadow-[0_0_15px_rgba(14,165,233,0.8)]">
            <motion.path 
              d="M 25,25 m -15,0 a 15,15 0 1,0 30,0 a 15,15 0 1,0 -30,0" 
              fill="none" 
              stroke="#0ea5e9" 
              strokeWidth="6"
              initial={{ pathLength: 0 }}
              animate={phase >= 1 ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 1.5, ease: "easeInOut" }}
            />
            <motion.path 
              d="M 75,25 m -15,0 a 15,15 0 1,0 30,0 a 15,15 0 1,0 -30,0" 
              fill="none" 
              stroke="#38bdf8" 
              strokeWidth="6"
              initial={{ pathLength: 0 }}
              animate={phase >= 1 ? { pathLength: 1 } : { pathLength: 0 }}
              transition={{ duration: 1.5, ease: "easeInOut", delay: 0.2 }}
            />
            <path d="M 40,25 Q 50,40 60,25" fill="none" stroke="#7dd3fc" strokeWidth="6" />
            <path d="M 40,25 Q 50,10 60,25" fill="none" stroke="#0ea5e9" strokeWidth="6" />
          </svg>
        </motion.div>

        <motion.h1 
          className="text-4xl font-bold tracking-widest text-white mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          INFINITY
        </motion.h1>

        <motion.div 
          className="text-sm font-mono text-[#0ea5e9] tracking-widest mb-12 text-center"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1 }}
        >
          INTELIGÊNCIA EM<br/>CADA CONSULTA
        </motion.div>

        <motion.div 
          className="px-8 py-3 bg-[#0ea5e9]/10 border border-[#0ea5e9] rounded-full text-white text-sm font-bold tracking-wider backdrop-blur-sm"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          ACESSE AGORA
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