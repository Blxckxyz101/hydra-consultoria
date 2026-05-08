import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useState, useEffect } from 'react';

const DATA_ROWS = [
  { label: 'NOME COMPLETO', value: 'CARLOS EDUARDO M. SILVA', delay: 0.1 },
  { label: 'CPF', value: '011.847.329-40', delay: 0.22 },
  { label: 'NASCIMENTO', value: '14/03/1982 · 43 anos', delay: 0.34 },
  { label: 'MÃE', value: 'MARIA APARECIDA SILVA', delay: 0.46 },
  { label: 'ENDEREÇO', value: 'R. DAS ACÁCIAS, 247 — SANTO ANDRÉ/SP', delay: 0.58 },
  { label: 'TELEFONE', value: '(11) 98432-7741', delay: 0.70 },
  { label: 'SCORE', value: '641 — Regular', delay: 0.82 },
  { label: 'CLASSE SOCIAL', value: 'B2', delay: 0.94 },
];

function CounterNumber({ target, duration = 1.2 }: { target: number; duration?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, v => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(count, target, { duration, ease: 'easeOut' });
    const unsub = rounded.on('change', v => setDisplay(v));
    return () => { controls.stop(); unsub(); };
  }, [target, duration]);

  return <span>{display}</span>;
}

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1400),
      setTimeout(() => setPhase(4), 1800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center scanlines"
      style={{ backgroundColor: '#05080f' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Scanline reveal effect on enter */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(6,182,212,0.12) 0%, transparent 100%)' }}
        initial={{ scaleY: 0, originY: 0 }}
        animate={{ scaleY: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />

      {/* Grid */}
      <div className="absolute inset-0 grid-bg opacity-30" />

      <div className="relative z-10 w-full" style={{ maxWidth: 'clamp(340px, 70vw, 720px)', padding: '0 24px' }}>

        {/* IDENTIFICADO stamp */}
        <motion.div
          className="text-center mb-2"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(2rem, 6vw, 4.5rem)',
            fontWeight: 700,
            color: '#06b6d4',
            letterSpacing: '0.08em',
            textShadow: '0 0 40px rgba(6,182,212,0.5)',
            lineHeight: 1,
          }}
          initial={{ opacity: 0, scale: 1.3, filter: 'blur(8px)' }}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            scale: phase >= 1 ? 1 : 1.3,
            filter: phase >= 1 ? 'blur(0px)' : 'blur(8px)',
          }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          IDENTIFICADO.
        </motion.div>

        {/* Counter badge */}
        <motion.div
          className="text-center text-xs mb-6 tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          {phase >= 2 && <CounterNumber target={37} />} dados encontrados
        </motion.div>

        {/* Data rows */}
        <motion.div
          className="space-y-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          {DATA_ROWS.map((row) => (
            <motion.div
              key={row.label}
              className="flex items-baseline gap-3 px-4 py-2 rounded"
              style={{ borderLeft: '2px solid rgba(6,182,212,0.3)' }}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: phase >= 3 ? 1 : 0, x: phase >= 3 ? 0 : -12 }}
              transition={{ duration: 0.35, delay: phase >= 3 ? row.delay : 0 }}
            >
              <span
                className="shrink-0"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: '#c8a84b',
                  fontSize: 'clamp(0.55rem, 0.9vw, 0.65rem)',
                  letterSpacing: '0.1em',
                  width: 'clamp(90px, 14vw, 130px)',
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: '#e2e8f0',
                  fontSize: 'clamp(0.7rem, 1.2vw, 0.82rem)',
                }}
              >
                {row.value}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom verification line */}
        <motion.div
          className="mt-5 pt-4 flex items-center justify-between"
          style={{ borderTop: '1px solid rgba(30,41,59,0.8)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 4 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', color: '#06b6d4', fontSize: '0.65rem', letterSpacing: '0.15em' }}>
            ✓ VERIFICADO · INFINITY SEARCH
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#1e293b', fontSize: '0.65rem' }}>
            23:47:14
          </span>
        </motion.div>
      </div>

      {/* Glowing right edge accent */}
      <motion.div
        className="absolute right-0 top-0 bottom-0"
        style={{ width: '2px', background: 'linear-gradient(180deg, transparent 20%, rgba(6,182,212,0.4) 50%, transparent 80%)' }}
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, scaleY: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
    </motion.div>
  );
}
