import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

const CHARS = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツDZテデトドナニヌネノハバパヒビピフブプヘベペホボポ0123456789ABCDEF';

function MatrixColumn({ x, delay }: { x: number; delay: number }) {
  const [chars, setChars] = useState<string[]>([]);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setOpacity(1);
      const interval = setInterval(() => {
        setChars(Array.from({ length: 20 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]));
      }, 80);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(t1);
  }, [delay]);

  return (
    <div
      className="absolute top-0 flex flex-col text-[8px] font-mono leading-tight pointer-events-none"
      style={{ left: `${x}%`, opacity: opacity * 0.3, color: '#0ea5e9', transition: 'opacity 0.5s' }}
    >
      {chars.map((c, i) => (
        <span key={i} style={{ opacity: 1 - i * 0.05 }}>{c}</span>
      ))}
    </div>
  );
}

export function Scene1() {
  const [phase, setPhase] = useState(0);
  const [glitch, setGlitch] = useState(false);
  const glitchRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => {
        setPhase(3);
        glitchRef.current = setInterval(() => {
          setGlitch(true);
          setTimeout(() => setGlitch(false), 80);
        }, 600);
      }, 1800),
      setTimeout(() => {
        if (glitchRef.current) clearInterval(glitchRef.current);
        setPhase(4);
      }, 3500),
    ];
    return () => {
      timers.forEach(t => clearTimeout(t));
      if (glitchRef.current) clearInterval(glitchRef.current);
    };
  }, []);

  const WORD = 'HYDRA';

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#020408] overflow-hidden"
      {...sceneTransitions.fadeBlur}
    >
      {/* Matrix rain columns */}
      {Array.from({ length: 12 }).map((_, i) => (
        <MatrixColumn key={i} x={(i * 8.5) + 2} delay={i * 100} />
      ))}

      {/* Top scanline that sweeps down */}
      <motion.div
        className="absolute left-0 right-0 h-[2px] pointer-events-none"
        style={{ background: 'linear-gradient(90deg, transparent, #0ea5e9, #38bdf8, #0ea5e9, transparent)', boxShadow: '0 0 20px #0ea5e9, 0 0 40px #0ea5e9' }}
        initial={{ top: 0, opacity: 0 }}
        animate={phase >= 1 ? { top: ['0%', '110%'], opacity: [0, 1, 1, 0.5] } : { top: 0, opacity: 0 }}
        transition={{ duration: 2.2, ease: 'linear' }}
      />

      {/* HYDRA main title */}
      <div className="relative z-20 flex flex-col items-center gap-2">
        <div className="flex gap-1 md:gap-2 relative">
          {WORD.split('').map((char, i) => (
            <motion.span
              key={i}
              className="relative inline-block text-[14vw] md:text-[12vh] font-black leading-none select-none"
              style={{
                fontFamily: 'var(--font-display, "Arial Black", sans-serif)',
                color: glitch && i % 2 === 0 ? '#38bdf8' : 'white',
                textShadow: phase >= 3
                  ? `0 0 30px rgba(14,165,233,0.8), 0 0 60px rgba(14,165,233,0.4)`
                  : 'none',
                transform: glitch && i === 2 ? `translateX(${Math.random() * 6 - 3}px)` : 'none',
              }}
              initial={{ opacity: 0, y: 60, rotateX: -90 }}
              animate={phase >= 2
                ? { opacity: 1, y: 0, rotateX: 0 }
                : { opacity: 0, y: 60, rotateX: -90 }}
              transition={{
                type: 'spring', stiffness: 300, damping: 20,
                delay: i * 0.07,
              }}
            >
              {char}
              {/* Per-letter glow underline */}
              {phase >= 3 && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0ea5e9]"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: i * 0.07 + 0.3, duration: 0.4 }}
                  style={{ boxShadow: '0 0 8px #0ea5e9' }}
                />
              )}
            </motion.span>
          ))}
        </div>

        {/* Subtitle */}
        <motion.div
          className="flex items-center gap-3 mt-2"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-[#0ea5e9]/70" style={{ width: '40px' }} />
          <span className="text-[#0ea5e9] font-mono text-xs tracking-[0.3em] uppercase">
            CONSULTORIA
          </span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-[#0ea5e9]/70" style={{ width: '40px' }} />
        </motion.div>
      </div>

      {/* Tagline below */}
      <motion.div
        className="absolute bottom-[22%] left-0 right-0 flex flex-col items-center gap-1"
        initial={{ opacity: 0, y: 10 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.8, delay: 0.8 }}
      >
        <div className="text-white/40 font-mono text-[10px] tracking-[0.5em] uppercase">
          INTELIGÊNCIA · PODER · CONSULTAS
        </div>
      </motion.div>

      {/* Bottom scanlines (CRT effect) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.8) 2px, rgba(0,0,0,0.8) 4px)',
        }}
      />

      {/* Corner HUD brackets */}
      {[
        { cls: 'top-6 left-6', b: 'border-t-2 border-l-2' },
        { cls: 'top-6 right-6', b: 'border-t-2 border-r-2' },
        { cls: 'bottom-24 left-6', b: 'border-b-2 border-l-2' },
        { cls: 'bottom-24 right-6', b: 'border-b-2 border-r-2' },
      ].map(({ cls, b }, i) => (
        <motion.div
          key={i}
          className={`absolute w-6 h-6 border-[#0ea5e9] ${b} ${cls}`}
          initial={{ opacity: 0, scale: 1.5 }}
          animate={phase >= 2 ? { opacity: 0.6, scale: 1 } : { opacity: 0, scale: 1.5 }}
          transition={{ delay: i * 0.1 + 0.3, duration: 0.4 }}
        />
      ))}
    </motion.div>
  );
}
