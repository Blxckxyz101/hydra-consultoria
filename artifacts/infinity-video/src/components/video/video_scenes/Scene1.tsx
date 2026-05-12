import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

const CHARS = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツDZテデトドナニヌネノハバパヒビピフブプ0123456789ABCDEF';

function MatrixColumn({ x, delay }: { x: number; delay: number }) {
  const [chars, setChars] = useState<string[]>([]);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setOpacity(1);
      const interval = setInterval(() => {
        setChars(Array.from({ length: 22 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]));
      }, 70);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(t1);
  }, [delay]);

  return (
    <div
      className="absolute top-0 flex flex-col text-[7px] font-mono leading-tight pointer-events-none"
      style={{ left: `${x}%`, opacity: opacity * 0.25, color: '#0ea5e9', transition: 'opacity 0.5s' }}
    >
      {chars.map((c, i) => (
        <span key={i} style={{ opacity: 1 - i * 0.045 }}>{c}</span>
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
      setTimeout(() => setPhase(1), 250),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => {
        setPhase(3);
        glitchRef.current = setInterval(() => {
          setGlitch(true);
          setTimeout(() => setGlitch(false), 80);
        }, 700);
      }, 1600),
      setTimeout(() => {
        if (glitchRef.current) clearInterval(glitchRef.current);
        setPhase(4);
      }, 3200),
      setTimeout(() => setPhase(5), 4000),
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
      {/* Matrix rain */}
      {Array.from({ length: 14 }).map((_, i) => (
        <MatrixColumn key={i} x={(i * 7.2) + 1} delay={i * 80} />
      ))}

      {/* Sweep scanline */}
      <motion.div
        className="absolute left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent, #0ea5e9, #38bdf8, #0ea5e9, transparent)',
          boxShadow: '0 0 20px #0ea5e9, 0 0 40px #0ea5e9',
        }}
        initial={{ top: 0, opacity: 0 }}
        animate={phase >= 1 ? { top: ['0%', '110%'], opacity: [0, 1, 1, 0.4] } : { top: 0, opacity: 0 }}
        transition={{ duration: 2.0, ease: 'linear' }}
      />

      {/* Main title block */}
      <div className="relative z-20 flex flex-col items-center gap-2">
        {/* HYDRA letters */}
        <div className="flex gap-1 relative">
          {WORD.split('').map((char, i) => (
            <motion.span
              key={i}
              className="relative inline-block font-black leading-none select-none"
              style={{
                fontFamily: '"Arial Black", sans-serif',
                fontSize: 'clamp(52px, 14vw, 80px)',
                color: glitch && i % 2 === 0 ? '#38bdf8' : 'white',
                textShadow: phase >= 3
                  ? `0 0 30px rgba(14,165,233,0.9), 0 0 60px rgba(14,165,233,0.4)`
                  : 'none',
                transform: glitch && i === 2 ? `translateX(${Math.random() * 6 - 3}px)` : 'none',
              }}
              initial={{ opacity: 0, y: 55, rotateX: -90 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 55, rotateX: -90 }}
              transition={{ type: 'spring', stiffness: 280, damping: 20, delay: i * 0.07 }}
            >
              {char}
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
          className="flex items-center gap-3 mt-1"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <div className="h-px bg-gradient-to-r from-transparent to-[#0ea5e9]/70" style={{ width: '36px' }} />
          <span className="text-[#0ea5e9] font-mono text-[11px] tracking-[0.35em] uppercase">CONSULTORIA</span>
          <div className="h-px bg-gradient-to-l from-transparent to-[#0ea5e9]/70" style={{ width: '36px' }} />
        </motion.div>

        {/* Tagline */}
        <motion.div
          className="text-white/35 font-mono text-[8px] tracking-[0.45em] uppercase text-center mt-1"
          initial={{ opacity: 0, y: 8 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.7, delay: 0.7 }}
        >
          CENTRO OPERACIONAL DE CONSULTAS E GESTÃO
        </motion.div>
      </div>

      {/* Badges row */}
      <motion.div
        className="absolute bottom-[20%] left-0 right-0 flex justify-center gap-3 px-8"
        initial={{ opacity: 0, y: 12 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.6 }}
      >
        {[
          { icon: '🔐', label: 'ACESSO RESTRITO' },
          { icon: '⚡', label: '+92 MÓDULOS' },
          { icon: '🤖', label: 'IA INTEGRADA' },
        ].map((b, i) => (
          <motion.div
            key={b.label}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[#0ea5e9]/25 bg-[#0ea5e9]/8"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={phase >= 5 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
            transition={{ delay: i * 0.12, type: 'spring', stiffness: 350, damping: 22 }}
            style={{ background: 'rgba(14,165,233,0.07)' }}
          >
            <span className="text-[10px] leading-none">{b.icon}</span>
            <span className="text-[7px] font-mono text-[#7dd3fc] tracking-widest">{b.label}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* HUD corners */}
      {[
        { cls: 'top-6 left-6', b: 'border-t-2 border-l-2' },
        { cls: 'top-6 right-6', b: 'border-t-2 border-r-2' },
        { cls: 'bottom-[18%] left-6', b: 'border-b-2 border-l-2' },
        { cls: 'bottom-[18%] right-6', b: 'border-b-2 border-r-2' },
      ].map(({ cls, b }, i) => (
        <motion.div
          key={i}
          className={`absolute w-6 h-6 border-[#0ea5e9] ${b} ${cls}`}
          initial={{ opacity: 0, scale: 1.5 }}
          animate={phase >= 2 ? { opacity: 0.5, scale: 1 } : { opacity: 0, scale: 1.5 }}
          transition={{ delay: i * 0.1 + 0.3, duration: 0.4 }}
        />
      ))}

      {/* CRT scanlines */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.8) 2px, rgba(0,0,0,0.8) 4px)',
        }}
      />
    </motion.div>
  );
}
