import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '../../lib/video/animations';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),  // scanline starts
      setTimeout(() => setPhase(2), 1200), // text reveals
      setTimeout(() => setPhase(3), 3200), // exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const text = "INFINITY";

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712]"
      {...sceneTransitions.fadeBlur}
    >
      {/* Scanner line */}
      <motion.div 
        className="absolute top-0 left-0 w-full h-1 bg-[#0ea5e9] shadow-[0_0_20px_#0ea5e9]"
        initial={{ y: '-10vh', opacity: 0 }}
        animate={
          phase === 0 ? { y: '-10vh', opacity: 0 } :
          phase < 3 ? { y: '110vh', opacity: [0, 1, 1, 0] } :
          { opacity: 0 }
        }
        transition={{ duration: 2.5, ease: 'linear' }}
      />

      <div className="relative z-10 text-center overflow-hidden py-10">
        <motion.div 
          className="text-6xl md:text-8xl font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-white to-[#0ea5e9]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {text.split('').map((char, i) => (
            <motion.span 
              key={i} 
              className="inline-block relative"
              initial={{ opacity: 0, y: 40, filter: 'blur(10px)' }}
              animate={phase >= 2 ? { 
                opacity: 1, 
                y: 0, 
                filter: 'blur(0px)',
                textShadow: ['0 0 0px #0ea5e9', '0 0 20px #0ea5e9', '0 0 0px #0ea5e9']
              } : { opacity: 0, y: 40, filter: 'blur(10px)' }}
              transition={{ 
                opacity: { duration: 0.4, delay: i * 0.1 },
                y: { type: 'spring', stiffness: 400, damping: 25, delay: i * 0.1 },
                filter: { duration: 0.4, delay: i * 0.1 },
                textShadow: { duration: 2, delay: i * 0.1 + 0.5, repeat: Infinity }
              }}
            >
              {char}
            </motion.span>
          ))}
        </motion.div>
      </div>

      <motion.div 
        className="absolute bottom-1/3 text-xs md:text-sm tracking-[0.4em] text-[#0ea5e9] font-mono opacity-60"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 0.6 } : { opacity: 0 }}
        transition={{ delay: 1.5, duration: 1 }}
      >
        INITIATING_PROTOCOL
      </motion.div>

      {/* Cyber overlay code */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10 font-mono text-[8px] md:text-xs text-[#0ea5e9] leading-tight whitespace-pre">
        {Array.from({ length: 40 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={phase >= 1 ? { opacity: Math.random(), x: 0 } : { opacity: 0, x: -20 }}
            transition={{ delay: Math.random() * 2, duration: 0.5 }}
          >
            {`0x${Math.floor(Math.random()*16777215).toString(16).toUpperCase().padStart(6, '0')} SYS_REQ INITIATED PID:${Math.floor(Math.random()*9999)}`}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}