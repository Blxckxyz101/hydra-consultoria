import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2300),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const title1 = 'INFINITY';
  const title2 = 'SEARCH';

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(100% at 50% 50%)' }}
      exit={{ scale: 1.1, opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 1.1, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="relative flex flex-col items-center z-10">
        {/* ∞ SVG draws itself */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mb-[2vh]"
        >
          <svg width="10vw" height="5vw" viewBox="0 0 120 60" style={{ minWidth: 80, minHeight: 40 }}>
            <motion.path
              d="M60,30 C60,16 72,6 84,6 C96,6 108,16 108,30 C108,44 96,54 84,54 C72,54 60,44 60,30 C60,16 48,6 36,6 C24,6 12,16 12,30 C12,44 24,54 36,54 C48,54 60,44 60,30 Z"
              fill="none"
              stroke="#06b6d4"
              strokeWidth="5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={phase >= 1 ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
              transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
              style={{ filter: 'drop-shadow(0 0 8px rgba(6,182,212,0.8))' }}
            />
            <motion.path
              d="M60,30 C60,16 72,6 84,6 C96,6 108,16 108,30 C108,44 96,54 84,54 C72,54 60,44 60,30 C60,16 48,6 36,6 C24,6 12,16 12,30 C12,44 24,54 36,54 C48,54 60,44 60,30 Z"
              fill="none"
              stroke="#67e8f9"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={phase >= 1 ? { pathLength: 1, opacity: 0.4 } : { pathLength: 0, opacity: 0 }}
              transition={{ duration: 1.4, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
            />
          </svg>
        </motion.div>

        {/* INFINITY */}
        <div className="overflow-hidden">
          <div
            className="flex tracking-[0.15em] leading-none"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 7vw, 96px)', fontWeight: 700 }}
          >
            {title1.split('').map((char, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block', color: '#f0f9ff' }}
                initial={{ opacity: 0, y: '80%', rotateX: -50 }}
                animate={phase >= 2 ? { opacity: 1, y: '0%', rotateX: 0 } : { opacity: 0, y: '80%', rotateX: -50 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28, delay: phase >= 2 ? i * 0.045 : 0 }}
              >
                {char}
              </motion.span>
            ))}
          </div>
        </div>

        {/* SEARCH */}
        <div className="overflow-hidden">
          <div
            className="flex tracking-[0.35em] leading-none mt-[0.5vh]"
            style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(14px, 2.8vw, 40px)', fontWeight: 300, color: '#06b6d4' }}
          >
            {title2.split('').map((char, i) => (
              <motion.span
                key={i}
                style={{ display: 'inline-block' }}
                initial={{ opacity: 0, y: '100%' }}
                animate={phase >= 3 ? { opacity: 1, y: '0%' } : { opacity: 0, y: '100%' }}
                transition={{ type: 'spring', stiffness: 320, damping: 26, delay: phase >= 3 ? i * 0.06 : 0 }}
              >
                {char}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Divider line */}
        <motion.div
          className="mt-[3vh] h-px bg-[#06b6d4]/40"
          initial={{ width: 0, opacity: 0 }}
          animate={phase >= 4 ? { width: '18vw', opacity: 1 } : { width: 0, opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{ minWidth: phase >= 4 ? 120 : 0 }}
        />

        {/* Tagline */}
        <motion.p
          className="mt-[2vh] text-center"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(11px, 1.4vw, 18px)',
            color: '#94a3b8',
            letterSpacing: '0.1em',
            fontWeight: 300,
          }}
          initial={{ opacity: 0, filter: 'blur(12px)' }}
          animate={phase >= 4 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(12px)' }}
          transition={{ duration: 0.8, ease: 'circOut' }}
        >
          Inteligência que vai além
        </motion.p>
      </div>

      {/* Corner badge */}
      <motion.div
        className="absolute top-[4vh] left-[4vw]"
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 0.5 } : { opacity: 0 }}
        transition={{ duration: 0.5 }}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(9px, 0.9vw, 13px)', color: '#06b6d4', letterSpacing: '0.15em' }}
      >
        ∞ OSINT PLATFORM
      </motion.div>
    </motion.div>
  );
}
