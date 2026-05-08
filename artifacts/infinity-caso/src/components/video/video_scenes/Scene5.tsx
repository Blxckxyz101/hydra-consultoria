import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

function useTypewriter(text: string, startDelay: number = 0, speed: number = 60) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    let startTimer: ReturnType<typeof setTimeout>;
    let interval: ReturnType<typeof setInterval>;
    startTimer = setTimeout(() => {
      let i = 0;
      interval = setInterval(() => {
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) clearInterval(interval);
      }, speed);
    }, startDelay);
    return () => { clearTimeout(startTimer); clearInterval(interval); };
  }, [text, startDelay, speed]);
  return displayed;
}

export function Scene5() {
  const [phase, setPhase] = useState(0);
  const tagline = useTypewriter('Onde a busca termina.', 2000, 55);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 1800),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => setPhase(5), 3600),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center scanlines"
      style={{ backgroundColor: '#05080f' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      {/* Subtle dark gradient bg */}
      <div className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(6,182,212,0.04) 0%, transparent 70%)' }} />

      {/* ∞ SVG with pathLength trace */}
      <motion.div
        className="relative mb-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      >
        <svg
          width="clamp(80px, 14vw, 140px)"
          height="clamp(48px, 8.4vw, 84px)"
          viewBox="0 0 200 120"
          fill="none"
        >
          {/* Glow under paths */}
          <path
            d="M100 60 C100 60 70 18 40 18 C16 18 0 36 0 60 C0 84 16 102 40 102 C70 102 100 60 100 60 Z"
            stroke="rgba(6,182,212,0.12)" strokeWidth="12" fill="none"
          />
          <path
            d="M100 60 C100 60 130 18 160 18 C184 18 200 36 200 60 C200 84 184 102 160 102 C130 102 100 60 100 60 Z"
            stroke="rgba(6,182,212,0.12)" strokeWidth="12" fill="none"
          />

          {/* Left loop trace */}
          <motion.path
            d="M100 60 C100 60 70 18 40 18 C16 18 0 36 0 60 C0 84 16 102 40 102 C70 102 100 60 100 60 Z"
            stroke="#06b6d4" strokeWidth="4" fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 1 : 0 }}
            transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Right loop trace — slight delay */}
          <motion.path
            d="M100 60 C100 60 130 18 160 18 C184 18 200 36 200 60 C200 84 184 102 160 102 C130 102 100 60 100 60 Z"
            stroke="#06b6d4" strokeWidth="4" fill="none"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 1 : 0 }}
            transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          />
        </svg>

        {/* Glow pulse ring */}
        {phase >= 2 && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: '50%',
              boxShadow: '0 0 60px rgba(6,182,212,0.25)',
            }}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </motion.div>

      {/* INFINITY SEARCH wordmark */}
      <motion.div
        className="font-bold tracking-[0.3em] text-center"
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'clamp(1.1rem, 3.5vw, 2.2rem)',
          color: '#e2e8f0',
          letterSpacing: '0.28em',
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 10 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        INFINITY SEARCH
      </motion.div>

      {/* Tagline */}
      <motion.div
        className="mt-3 text-sm tracking-wide"
        style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b', minHeight: '1.5em' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 3 ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        {tagline}
        {tagline.length > 0 && tagline.length < 'Onde a busca termina.'.length && (
          <span className="cursor-blink">▋</span>
        )}
      </motion.div>

      {/* Divider and bottom label */}
      <motion.div
        className="mt-8 flex items-center gap-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 4 ? 0.5 : 0 }}
        transition={{ duration: 0.6 }}
      >
        <div style={{ height: '1px', width: '60px', backgroundColor: 'rgba(100,116,139,0.4)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', color: '#64748b', fontSize: '0.62rem', letterSpacing: '0.2em' }}>
          OSINT · INTELIGÊNCIA · BRASIL
        </span>
        <div style={{ height: '1px', width: '60px', backgroundColor: 'rgba(100,116,139,0.4)' }} />
      </motion.div>

      {/* CTA — acesse agora */}
      <motion.div
        className="mt-7 flex flex-col items-center gap-1"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: phase >= 5 ? 1 : 0, y: phase >= 5 ? 0 : 16 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'clamp(0.6rem, 1.2vw, 0.8rem)',
          color: '#94a3b8',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
        }}>
          acesse agora
        </span>
        <motion.span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(1rem, 2.8vw, 1.8rem)',
            fontWeight: 700,
            color: '#06b6d4',
            letterSpacing: '0.04em',
            textShadow: '0 0 24px rgba(6,182,212,0.55)',
          }}
          animate={{ opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          infinitysearch.pro
        </motion.span>
      </motion.div>

      {/* Bottom bar */}
      <motion.div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: '2px', background: 'linear-gradient(90deg, transparent, #06b6d4 30%, #c8a84b 70%, transparent)' }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 0.7 : 0 }}
        transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  );
}
