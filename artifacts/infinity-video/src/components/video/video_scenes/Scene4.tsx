import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';
import img3 from '@assets/18730aa3-711d-4091-ac9b-18d0ea4ddb76_1778471980393.jpeg';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 4200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#030712]"
      {...sceneTransitions.perspectiveFlip}
    >
      <div className="relative w-full aspect-[4/3] mb-8 rounded-xl overflow-hidden border border-[#38bdf8]/40 shadow-[0_0_40px_rgba(14,165,233,0.2)]">
        <motion.img 
          src={img3}
          alt="Infinity Search Data"
          className="w-full h-full object-cover"
          initial={{ scale: 1.2, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 1.2, opacity: 0 }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#030712]/40 to-[#030712]" />
      </div>

      <motion.div 
        className="w-full text-center relative z-20"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.8, ease: 'circOut' }}
      >
        <h2 className="text-4xl font-bold text-white mb-2">
          RESULTADOS EM
        </h2>
        <motion.div 
          className="text-6xl font-black text-[#0ea5e9] tracking-tighter"
          initial={{ scale: 0.8 }}
          animate={phase >= 2 ? { scale: [0.8, 1.1, 1] } : { scale: 0.8 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          SEGUNDOS
        </motion.div>
      </motion.div>

      {/* Animated numbers background */}
      <div className="absolute top-10 w-full text-center pointer-events-none opacity-20">
        <motion.div 
          className="font-mono text-7xl text-[#7dd3fc]"
          animate={{ opacity: [0.1, 0.5, 0.1] }}
          transition={{ duration: 0.1, repeat: Infinity }}
        >
          {phase >= 1 ? "99.9%" : "00.0%"}
        </motion.div>
        <div className="text-xs font-mono text-white tracking-widest mt-2">UPTIME_RELIABILITY</div>
      </div>
    </motion.div>
  );
}