import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

const FIELDS = [
  { label: 'NOME', value: 'João Silva Santos' },
  { label: 'DATA NASC', value: '15/03/1985 — 39 anos' },
  { label: 'CPF', value: '***.***.***-87' },
  { label: 'ENDEREÇO', value: 'Rua das Flores, 123 — São Paulo/SP' },
  { label: 'SCORE', value: '742 — Bom' },
];

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 700),
    ];

    // Sequentially highlight each field
    FIELDS.forEach((_, i) => {
      timers.push(setTimeout(() => setHighlightIdx(i), 1000 + i * 900));
    });
    timers.push(setTimeout(() => setPhase(3), 1000 + FIELDS.length * 900));

    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ clipPath: 'polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)' }}
      animate={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
      exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
      transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Left: headline text */}
      <div className="pl-[7vw] w-[36%] flex flex-col justify-center">
        <motion.p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(10px, 1.1vw, 14px)',
            color: '#06b6d4',
            letterSpacing: '0.18em',
            fontWeight: 500,
            textTransform: 'uppercase',
          }}
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          Consulta em tempo real
        </motion.p>

        <motion.h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(22px, 4vw, 56px)',
            fontWeight: 700,
            color: '#f0f9ff',
            lineHeight: 1.05,
            marginTop: '1.5vh',
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        >
          Resultados<br />
          <span style={{ color: '#06b6d4' }}>em segundos.</span>
        </motion.h2>

        <motion.p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(11px, 1.1vw, 15px)',
            color: '#475569',
            marginTop: '2vh',
            lineHeight: 1.6,
          }}
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Dados precisos de múltiplas<br />
          fontes, unificados numa<br />
          interface limpa e rápida.
        </motion.p>

        {/* Status dot */}
        <motion.div
          className="mt-[3vh] flex items-center gap-[0.8vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            className="rounded-full"
            style={{ width: 'clamp(6px,0.6vw,10px)', height: 'clamp(6px,0.6vw,10px)', background: '#10b981' }}
            animate={{ scale: [1, 1.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(9px, 0.85vw, 12px)',
            color: '#10b981',
            letterSpacing: '0.1em',
          }}>SKYLERS API · ONLINE</span>
        </motion.div>
      </div>

      {/* Right: glass UI panel */}
      <motion.div
        className="flex-1 pr-[7vw] pl-[3vw]"
        initial={{ opacity: 0, x: 60 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: 60 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
      >
        {/* Panel */}
        <div style={{
          background: 'rgba(6,182,212,0.04)',
          border: '1px solid rgba(6,182,212,0.2)',
          borderRadius: 12,
          padding: 'clamp(16px,2.5vh,32px) clamp(16px,2vw,28px)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 0 40px rgba(6,182,212,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}>
          {/* Panel header */}
          <div className="flex items-center justify-between mb-[2vh]">
            <div className="flex items-center gap-[0.6vw]">
              <div style={{ width: 'clamp(6px,0.6vw,10px)', height: 'clamp(6px,0.6vw,10px)', borderRadius: '50%', background: '#ef4444' }} />
              <div style={{ width: 'clamp(6px,0.6vw,10px)', height: 'clamp(6px,0.6vw,10px)', borderRadius: '50%', background: '#f59e0b' }} />
              <div style={{ width: 'clamp(6px,0.6vw,10px)', height: 'clamp(6px,0.6vw,10px)', borderRadius: '50%', background: '#10b981' }} />
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(8px,0.75vw,11px)',
              color: '#475569',
              letterSpacing: '0.1em',
            }}>consulta · CPF</span>
          </div>

          {/* Fields */}
          <div className="flex flex-col" style={{ gap: 'clamp(8px,1.2vh,16px)' }}>
            {FIELDS.map((field, i) => (
              <motion.div
                key={field.label}
                style={{
                  padding: 'clamp(6px,0.8vh,12px) clamp(10px,1vw,16px)',
                  borderRadius: 6,
                  background: highlightIdx === i
                    ? 'rgba(6,182,212,0.12)'
                    : highlightIdx > i
                    ? 'rgba(6,182,212,0.03)'
                    : 'rgba(255,255,255,0.01)',
                  border: `1px solid ${highlightIdx === i ? 'rgba(6,182,212,0.4)' : highlightIdx > i ? 'rgba(6,182,212,0.12)' : 'rgba(255,255,255,0.04)'}`,
                  transition: 'all 0.35s ease',
                }}
                initial={{ opacity: 0, x: 15 }}
                animate={i <= highlightIdx ? { opacity: 1, x: 0 } : { opacity: 0, x: 15 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'clamp(8px,0.7vw,11px)',
                  color: '#06b6d4',
                  letterSpacing: '0.12em',
                  marginBottom: 'clamp(2px,0.3vh,4px)',
                }}>{field.label}</div>
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 'clamp(11px,1.05vw,15px)',
                  color: '#f0f9ff',
                  fontWeight: 400,
                }}>{field.value}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
