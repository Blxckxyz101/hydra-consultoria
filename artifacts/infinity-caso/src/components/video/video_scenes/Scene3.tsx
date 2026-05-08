import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

function useTypewriter(text: string, startDelay: number = 0, speed: number = 70) {
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

const PILLS = ['Pessoa', 'Veículo', 'Empresa', 'Saúde', 'Outros'];

const PREVIEW_FIELDS = [
  { label: 'NOME', value: 'CARLOS EDUARDO M. SILVA' },
  { label: 'NASCIMENTO', value: '14/03/1982' },
  { label: 'MÃE', value: 'MARIA APARECIDA SILVA' },
  { label: 'ENDEREÇO', value: 'R. DAS ACÁCIAS, 247 — SP' },
];

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const searchText = useTypewriter('011.8**.***.4**', 1200, 90);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 3000),
      setTimeout(() => setPhase(4), 3600),
      setTimeout(() => setPhase(5), 4400),
      setTimeout(() => setPhase(6), 5000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center scanlines"
      style={{ backgroundColor: '#080d16' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Grid bg */}
      <div className="absolute inset-0 grid-bg" />

      {/* Ambient glow blobs */}
      <motion.div
        className="absolute rounded-full blur-3xl"
        style={{ width: '600px', height: '300px', background: 'radial-gradient(ellipse, rgba(6,182,212,0.06), transparent)', top: '10%', left: '-5%' }}
        animate={{ x: [0, 30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Glass card */}
      <motion.div
        className="relative z-10"
        style={{
          width: 'clamp(340px, 55vw, 600px)',
          background: 'rgba(8,13,22,0.92)',
          border: '1px solid rgba(6,182,212,0.18)',
          borderRadius: '12px',
          boxShadow: '0 0 60px rgba(6,182,212,0.06), 0 24px 80px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(12px)',
          padding: 'clamp(20px, 3vw, 36px)',
        }}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, y: phase >= 1 ? 0 : 20, scale: phase >= 1 ? 1 : 0.97 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Card header */}
        <div className="flex items-center gap-3 mb-5">
          <svg width="22" height="13" viewBox="0 0 100 60" fill="none">
            <path d="M50 30 C50 30 35 10 20 10 C8 10 0 18 0 30 C0 42 8 50 20 50 C35 50 50 30 50 30 Z"
              stroke="#06b6d4" strokeWidth="6" fill="none" />
            <path d="M50 30 C50 30 65 10 80 10 C92 10 100 18 100 30 C100 42 92 50 80 50 C65 50 50 30 50 30 Z"
              stroke="#06b6d4" strokeWidth="6" fill="none" />
          </svg>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, color: '#e2e8f0', fontSize: '0.85rem', letterSpacing: '0.08em' }}>
            INFINITY SEARCH
          </span>
          <motion.div
            className="ml-auto w-2 h-2 rounded-full"
            style={{ backgroundColor: '#06b6d4' }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {PILLS.map((pill, i) => (
            <motion.span
              key={pill}
              className="px-3 py-1 rounded-full text-xs font-medium cursor-default"
              style={{
                fontFamily: 'var(--font-body)',
                backgroundColor: pill === 'Pessoa' ? 'rgba(6,182,212,0.15)' : 'rgba(30,41,59,0.6)',
                color: pill === 'Pessoa' ? '#06b6d4' : '#64748b',
                border: pill === 'Pessoa' ? '1px solid rgba(6,182,212,0.4)' : '1px solid rgba(30,41,59,0.8)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= 1 ? 1 : 0 }}
              transition={{ duration: 0.3, delay: i * 0.06 }}
            >
              {pill}
            </motion.span>
          ))}
        </div>

        {/* Search input */}
        <motion.div
          className="flex items-center gap-3 mb-5 rounded-lg px-4 py-3"
          style={{
            background: 'rgba(6,182,212,0.05)',
            border: `1px solid ${phase >= 2 ? 'rgba(6,182,212,0.4)' : 'rgba(6,182,212,0.15)'}`,
            transition: 'border-color 0.3s ease',
            boxShadow: phase >= 2 ? '0 0 20px rgba(6,182,212,0.08)' : 'none',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <span style={{ fontFamily: 'var(--font-mono)', color: '#e2e8f0', fontSize: '0.9rem', flex: 1 }}>
            {searchText}
            {searchText.length > 0 && searchText.length < '011.8**.***.4**'.length && (
              <span className="cursor-blink" style={{ color: '#06b6d4' }}>|</span>
            )}
            {searchText.length === 0 && phase >= 2 && (
              <span className="cursor-blink" style={{ color: '#06b6d4' }}>|</span>
            )}
          </span>
        </motion.div>

        {/* Search button / loading / results */}
        {phase < 4 && (
          <motion.div
            className="w-full py-3 rounded-lg font-semibold text-sm text-center"
            style={{
              fontFamily: 'var(--font-body)',
              background: phase >= 3
                ? 'linear-gradient(135deg, rgba(6,182,212,0.4), rgba(6,182,212,0.2))'
                : 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(6,182,212,0.08))',
              color: '#06b6d4',
              border: '1px solid rgba(6,182,212,0.3)',
              boxShadow: phase >= 3 ? '0 0 24px rgba(6,182,212,0.2)' : 'none',
              transition: 'all 0.3s ease',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 2 ? 1 : 0 }}
            transition={{ duration: 0.35 }}
          >
            {phase >= 3 ? 'Consultando...' : 'Consultar'}
          </motion.div>
        )}

        {/* Results cascade */}
        {phase >= 5 && (
          <div className="mt-4 space-y-2">
            {PREVIEW_FIELDS.map((field, i) => (
              <motion.div
                key={field.label}
                className="flex items-baseline gap-3 py-2 px-3 rounded"
                style={{
                  backgroundColor: 'rgba(6,182,212,0.04)',
                  borderLeft: '2px solid rgba(6,182,212,0.3)',
                }}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: i * 0.12 }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b', fontSize: '0.65rem', letterSpacing: '0.1em', minWidth: '80px' }}>
                  {field.label}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#e2e8f0', fontSize: '0.78rem' }}>
                  {field.value}
                </span>
              </motion.div>
            ))}
          </div>
        )}

        {/* Loading dots */}
        {phase >= 4 && phase < 5 && (
          <div className="mt-4 flex justify-center gap-2">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: '#06b6d4' }}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* "17 dados encontrados" badge */}
      {phase >= 6 && (
        <motion.div
          className="absolute bottom-8 text-xs tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b' }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          ✓ 17 registros encontrados
        </motion.div>
      )}
    </motion.div>
  );
}
