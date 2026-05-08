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

export function Scene1() {
  const [phase, setPhase] = useState(0);
  const timestamp = useTypewriter('23:47:12', 300, 85);
  const caseNum = useTypewriter('CASO #4891', 1000, 65);
  const sub = useTypewriter('Investigação em andamento...', 2100, 42);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 1050),
      setTimeout(() => setPhase(3), 2800),
      setTimeout(() => setPhase(4), 3600),
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
      transition={{ duration: 0.3, exit: { duration: 0.7 } } as never}
    >
      {/* Floating ambient particles */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${3 + (i % 3)}px`,
            height: `${3 + (i % 3)}px`,
            backgroundColor: i % 2 === 0 ? '#06b6d4' : '#c8a84b',
            left: `${10 + i * 11}%`,
            top: `${15 + (i % 4) * 18}%`,
            opacity: 0.15,
          }}
          animate={{ y: [0, -20, 0], opacity: [0.1, 0.25, 0.1] }}
          transition={{ duration: 4 + i * 0.7, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
        />
      ))}

      {/* ∞ logo top left */}
      <motion.div
        className="absolute top-7 left-9"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: phase >= 3 ? 0.8 : 0, x: phase >= 3 ? 0 : -10 }}
        transition={{ duration: 0.6 }}
      >
        <svg width="34" height="20" viewBox="0 0 100 60" fill="none">
          <path d="M50 30 C50 30 35 10 20 10 C8 10 0 18 0 30 C0 42 8 50 20 50 C35 50 50 30 50 30 Z"
            stroke="#06b6d4" strokeWidth="5" fill="none" />
          <path d="M50 30 C50 30 65 10 80 10 C92 10 100 18 100 30 C100 42 92 50 80 50 C65 50 50 30 50 30 Z"
            stroke="#06b6d4" strokeWidth="5" fill="none" />
        </svg>
      </motion.div>

      {/* INFINITY SEARCH label top left */}
      <motion.div
        className="absolute top-8 left-[68px] text-xs tracking-widest"
        style={{ fontFamily: 'var(--font-mono)', color: '#06b6d4' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 3 ? 0.7 : 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        INFINITY SEARCH
      </motion.div>

      {/* Timestamp */}
      <motion.div
        className="text-sm tracking-widest mb-5"
        style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.3 }}
      >
        {timestamp || '\u00A0'}
        {timestamp.length > 0 && timestamp.length < '23:47:12'.length && (
          <span className="cursor-blink">_</span>
        )}
      </motion.div>

      {/* Horizontal divider */}
      <motion.div
        className="mb-6"
        style={{ height: '1px', backgroundColor: '#1e293b' }}
        initial={{ width: 0 }}
        animate={{ width: phase >= 2 ? '320px' : 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Case number — always in DOM to prevent layout shift */}
      <div
        className="font-bold tracking-[0.12em] mb-4 leading-none"
        style={{
          fontFamily: 'var(--font-mono)',
          color: '#e2e8f0',
          fontSize: 'clamp(2.5rem, 6vw, 4.5rem)',
          minHeight: '1.2em',
        }}
      >
        {caseNum}
        {caseNum.length > 0 && caseNum.length < 'CASO #4891'.length && (
          <span className="cursor-blink" style={{ color: '#06b6d4' }}>▋</span>
        )}
        {caseNum.length === 0 && <span className="cursor-blink" style={{ color: '#06b6d4' }}>▋</span>}
      </div>

      {/* Subtitle */}
      <div
        className="text-sm tracking-wide"
        style={{ fontFamily: 'var(--font-mono)', color: '#06b6d4', minHeight: '1.4em' }}
      >
        {sub}
        {sub.length > 0 && sub.length < 'Investigação em andamento...'.length && (
          <span className="cursor-blink">▋</span>
        )}
      </div>

      {/* Top horizontal accent line */}
      <motion.div
        className="absolute top-0 left-0 right-0"
        style={{ height: '2px', background: 'linear-gradient(90deg, transparent, #06b6d4 40%, #c8a84b 60%, transparent)' }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 0.6 : 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* CONFIDENCIAL stamp */}
      <motion.div
        className="absolute bottom-10 right-10 border-2 px-5 py-2 font-bold tracking-[0.22em] text-xs"
        style={{
          fontFamily: 'var(--font-mono)',
          borderColor: '#c8a84b',
          color: '#c8a84b',
          transform: 'rotate(-11deg)',
        }}
        initial={{ opacity: 0, scale: 1.6 }}
        animate={{ opacity: phase >= 4 ? 0.85 : 0, scale: phase >= 4 ? 1 : 1.6 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        CONFIDENCIAL
      </motion.div>

      {/* Vertical accent left */}
      <motion.div
        className="absolute left-0 top-0 bottom-0"
        style={{ width: '2px', background: 'linear-gradient(180deg, transparent, #06b6d4 50%, transparent)' }}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 0.3 : 0 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      />
    </motion.div>
  );
}
