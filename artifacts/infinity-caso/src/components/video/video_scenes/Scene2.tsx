import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

const MODULES = ['CPF', 'NOME', 'ENDEREÇO', 'TELEFONE', 'PARENTES', 'SCORE', 'RG', 'EMAIL'];

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2700),
      setTimeout(() => setPhase(5), 3500),
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
      transition={{ duration: 0.5 }}
    >
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg opacity-40" />

      {/* Radar rings centered */}
      <div className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
        <motion.div
          className="absolute rounded-full border"
          style={{
            width: '280px', height: '280px',
            borderColor: 'rgba(6,182,212,0.08)',
            left: '-140px', top: '-140px',
          }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {phase >= 2 && (
          <>
            <div className="absolute rounded-full border radar-ping"
              style={{ width: '160px', height: '160px', borderColor: 'rgba(6,182,212,0.35)', left: '-80px', top: '-80px' }} />
            <div className="absolute rounded-full border radar-ping-2"
              style={{ width: '160px', height: '160px', borderColor: 'rgba(6,182,212,0.25)', left: '-80px', top: '-80px' }} />
            <div className="absolute rounded-full border radar-ping-3"
              style={{ width: '160px', height: '160px', borderColor: 'rgba(6,182,212,0.15)', left: '-80px', top: '-80px' }} />
          </>
        )}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center" style={{ maxWidth: '700px', width: '90%' }}>

        {/* Question */}
        <motion.div
          className="text-center mb-6"
          style={{ fontFamily: 'var(--font-mono)', color: '#64748b', fontSize: 'clamp(0.75rem, 1.5vw, 1rem)', letterSpacing: '0.18em' }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: phase >= 1 ? 0.8 : 0, y: phase >= 1 ? 0 : 12 }}
          transition={{ duration: 0.6 }}
        >
          ALVO IDENTIFICADO
        </motion.div>

        {/* Redacted ID — big hero */}
        <motion.div
          className="mb-4 font-bold tracking-[0.15em] text-center"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(1.8rem, 5vw, 3.5rem)',
            color: '#e2e8f0',
            textShadow: phase >= 2 ? '0 0 30px rgba(6,182,212,0.4)' : 'none',
            transition: 'text-shadow 0.6s ease',
          }}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 0.92 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          ***.***.***-**
        </motion.div>

        {/* "17 consultas disponíveis" */}
        <motion.div
          className="text-sm mb-8"
          style={{ fontFamily: 'var(--font-mono)', color: '#c8a84b', letterSpacing: '0.1em' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.4 }}
        >
          17 consultas disponíveis
        </motion.div>

        {/* Module badges */}
        <motion.div
          className="flex flex-wrap justify-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          {MODULES.map((mod, i) => (
            <motion.span
              key={mod}
              className="px-3 py-1 text-xs font-bold tracking-widest border rounded"
              style={{
                fontFamily: 'var(--font-mono)',
                borderColor: i < 4 ? 'rgba(6,182,212,0.5)' : 'rgba(100,116,139,0.3)',
                color: i < 4 ? '#06b6d4' : '#64748b',
                backgroundColor: i < 4 ? 'rgba(6,182,212,0.07)' : 'transparent',
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 8 }}
              transition={{ duration: 0.35, delay: phase >= 3 ? i * 0.07 : 0 }}
            >
              {mod}
            </motion.span>
          ))}
        </motion.div>

        {/* Bottom status line */}
        <motion.div
          className="mt-8 text-xs tracking-widest text-center"
          style={{ fontFamily: 'var(--font-mono)', color: '#1e293b' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 4 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        >
          <span style={{ color: '#06b6d4' }}>■</span> SISTEMA PRONTO
          <span className="mx-4" style={{ color: '#1e293b' }}>│</span>
          <span style={{ color: '#c8a84b' }}>■</span> CONSULTA AUTORIZADA
        </motion.div>
      </div>

      {/* Diagonal accent line */}
      <motion.div
        className="absolute"
        style={{
          width: '1px',
          height: '40vh',
          background: 'linear-gradient(180deg, transparent, rgba(6,182,212,0.2) 50%, transparent)',
          right: '15%',
          top: '15%',
          transform: 'rotate(25deg)',
          transformOrigin: 'top',
        }}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
      />
    </motion.div>
  );
}
