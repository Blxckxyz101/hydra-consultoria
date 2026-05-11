import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';
import img1 from '@assets/IMG_9748_1778471980393.jpeg';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),  // Image slides up
      setTimeout(() => setPhase(2), 1000), // Data boxes appear
      setTimeout(() => setPhase(3), 4200), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-6"
      {...sceneTransitions.zoomThrough}
    >
      <motion.div 
        className="w-full text-left mb-6 relative z-20"
        initial={{ opacity: 0, x: -30 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
        transition={{ duration: 0.6, ease: 'circOut' }}
      >
        <h2 className="text-[#0ea5e9] font-mono text-sm tracking-widest mb-2">/PLATFORM</h2>
        <h1 className="text-3xl md:text-5xl font-bold text-white leading-tight">
          PODER DE<br />DECISÃO
        </h1>
      </motion.div>

      <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden border border-[#0ea5e9]/30 shadow-[0_0_30px_rgba(14,165,233,0.15)] bg-[#0f172a]/50 backdrop-blur-md">
        <motion.img 
          src={img1}
          alt="Infinity Search Dashboard"
          className="w-full h-full object-cover opacity-80 mix-blend-screen"
          initial={{ scale: 1.2, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, opacity: 0.8 } : { scale: 1.2, opacity: 0 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        />
        
        {/* Overlay scan line */}
        <motion.div 
          className="absolute top-0 left-0 w-full h-[2px] bg-[#38bdf8] shadow-[0_0_10px_#38bdf8]"
          animate={{ y: ['0%', '400%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Floating data elements */}
      <motion.div 
        className="absolute top-[25%] -right-4 bg-[#030712]/80 border border-[#0ea5e9]/50 p-3 rounded text-xs font-mono text-[#0ea5e9] backdrop-blur-md z-30"
        initial={{ opacity: 0, x: 20 }}
        animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        STATUS: ENCRYPTED
      </motion.div>

      <motion.div 
        className="absolute bottom-[20%] -left-2 bg-[#030712]/80 border border-[#0ea5e9]/50 p-3 rounded text-xs font-mono text-white backdrop-blur-md z-30"
        initial={{ opacity: 0, x: -20 }}
        animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
      >
        ACCESS: GRANTED
      </motion.div>
    </motion.div>
  );
}