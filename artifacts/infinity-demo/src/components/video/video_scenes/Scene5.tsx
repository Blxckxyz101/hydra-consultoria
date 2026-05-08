import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1500),
      setTimeout(() => setPhase(4), 2200),
      setTimeout(() => setPhase(5), 3200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const title = 'INFINITY SEARCH';

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ clipPath: 'circle(0% at 50% 50%)' }}
      transition={{ duration: 1.0, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Slow zoom on everything */}
      <motion.div
        className="flex flex-col items-center"
        animate={phase >= 3 ? { scale: 1.05 } : { scale: 1 }}
        transition={{ duration: 4, ease: 'easeInOut' }}
      >
        {/* Large ∞ SVG */}
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 180, damping: 22 }}
          style={{ marginBottom: '3vh' }}
        >
          <svg
            viewBox="0 0 200 100"
            style={{
              width: 'clamp(100px,18vw,240px)',
              height: 'clamp(50px,9vw,120px)',
              filter: 'drop-shadow(0 0 18px rgba(6,182,212,0.6)) drop-shadow(0 0 40px rgba(6,182,212,0.25))',
            }}
          >
            {/* Outer glow path */}
            <motion.path
              d="M100,50 C100,28 118,10 140,10 C162,10 180,28 180,50 C180,72 162,90 140,90 C118,90 100,72 100,50 C100,28 82,10 60,10 C38,10 20,28 20,50 C20,72 38,90 60,90 C82,90 100,72 100,50 Z"
              fill="none"
              stroke="#67e8f9"
              strokeWidth="6"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={phase >= 1 ? { pathLength: 1, opacity: 0.3 } : { pathLength: 0, opacity: 0 }}
              transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1], delay: 0.1 }}
            />
            {/* Main path */}
            <motion.path
              d="M100,50 C100,28 118,10 140,10 C162,10 180,28 180,50 C180,72 162,90 140,90 C118,90 100,72 100,50 C100,28 82,10 60,10 C38,10 20,28 20,50 C20,72 38,90 60,90 C82,90 100,72 100,50 Z"
              fill="none"
              stroke="#06b6d4"
              strokeWidth="4"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={phase >= 1 ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
              transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
            />
            {/* Pulsing center dot */}
            <motion.circle
              cx="100"
              cy="50"
              r="3"
              fill="#06b6d4"
              initial={{ opacity: 0, scale: 0 }}
              animate={phase >= 2 ? { opacity: [0, 1, 0.6], scale: [0, 1.4, 1] } : { opacity: 0, scale: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
            />
          </svg>
        </motion.div>

        {/* Title chars */}
        <div
          className="flex tracking-[0.2em] leading-none"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(20px,4.5vw,64px)',
            fontWeight: 700,
          }}
        >
          {title.split('').map((char, i) => (
            <motion.span
              key={i}
              style={{
                display: 'inline-block',
                color: char === ' ' ? 'transparent' : '#f0f9ff',
                minWidth: char === ' ' ? '0.4em' : undefined,
              }}
              initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
              animate={phase >= 2 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 30, filter: 'blur(8px)' }}
              transition={{
                duration: 0.55,
                ease: [0.16, 1, 0.3, 1],
                delay: phase >= 2 ? i * 0.03 : 0,
              }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </div>

        {/* Divider */}
        <motion.div
          style={{ height: 1, background: 'rgba(6,182,212,0.35)', marginTop: '2.5vh', marginBottom: '2.5vh' }}
          initial={{ width: 0, opacity: 0 }}
          animate={phase >= 3 ? { width: 'clamp(100px,20vw,280px)', opacity: 1 } : { width: 0, opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* Tagline */}
        <motion.p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(9px,1vw,14px)',
            color: '#475569',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
          initial={{ opacity: 0, filter: 'blur(8px)' }}
          animate={phase >= 4 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(8px)' }}
          transition={{ duration: 0.7, ease: 'circOut' }}
        >
          Acesso restrito&nbsp;·&nbsp;Resultados reais
        </motion.p>

        {/* CTA */}
        <motion.div
          className="flex flex-col items-center"
          style={{ marginTop: '4vh', gap: '0.4em' }}
          initial={{ opacity: 0, y: 18 }}
          animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(0.55rem, 1vw, 0.75rem)',
            color: '#64748b',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
          }}>
            acesse agora
          </span>
          <motion.span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(1.1rem, 3vw, 2rem)',
              fontWeight: 700,
              color: '#06b6d4',
              letterSpacing: '0.05em',
              textShadow: '0 0 28px rgba(6,182,212,0.6), 0 0 60px rgba(6,182,212,0.2)',
            }}
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            infinitysearch.pro
          </motion.span>
        </motion.div>

        {/* Pulsing ring around ∞ */}
        <motion.div
          style={{
            position: 'absolute',
            width: 'clamp(120px,22vw,290px)',
            height: 'clamp(60px,11vw,145px)',
            borderRadius: '50%',
            border: '1px solid rgba(6,182,212,0.15)',
            pointerEvents: 'none',
          }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.15, 0.5] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    </motion.div>
  );
}
