import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

const MODULES = [
  'CPF', 'NOME', 'PLACA', 'CNPJ', 'EMAIL',
  'TELEFONE', 'CEP', 'SCORE', 'FOTO CNH', 'PARENTES',
  'EMPRESA', 'PROCESSOS', 'PIX', 'NIS', 'IP',
  'RG', 'TÍTULO', 'ENDEREÇO', 'IRPF', 'CNS',
  'CHASSIS', 'FROTA', 'OBITO', 'SCORE+',
];

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 600),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => setPhase(4), 1600),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center"
      initial={{ clipPath: 'inset(0 100% 0 0)' }}
      animate={{ clipPath: 'inset(0 0% 0 0)' }}
      exit={{ clipPath: 'inset(0 0 0 100%)' }}
      transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Left text block */}
      <div className="pl-[8vw] w-[42%] flex flex-col justify-center">
        <motion.p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(11px, 1.2vw, 16px)',
            color: '#06b6d4',
            letterSpacing: '0.18em',
            fontWeight: 500,
            textTransform: 'uppercase',
          }}
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          O problema
        </motion.p>

        <motion.h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 5.5vw, 76px)',
            fontWeight: 700,
            color: '#f0f9ff',
            lineHeight: 1.0,
            marginTop: '2vh',
          }}
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        >
          Você precisa<br />
          <span style={{ color: '#06b6d4' }}>de dados.</span>
        </motion.h2>

        <motion.p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(14px, 2vw, 28px)',
            fontWeight: 300,
            color: '#94a3b8',
            marginTop: '2vh',
            letterSpacing: '0.02em',
          }}
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.6, ease: 'circOut' }}
        >
          Precisos. Agora.
        </motion.p>

        {/* Count */}
        <motion.div
          className="mt-[4vh] flex items-baseline gap-[0.5vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 4vw, 56px)',
            fontWeight: 700,
            color: '#06b6d4',
          }}>24+</span>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(11px, 1.1vw, 15px)',
            color: '#475569',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>módulos disponíveis</span>
        </motion.div>
      </div>

      {/* Right modules grid */}
      <div className="flex-1 pr-[5vw] pl-[2vw]">
        <div className="flex flex-wrap gap-[0.8vw]">
          {MODULES.map((mod, i) => (
            <motion.div
              key={mod}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'clamp(9px, 0.9vw, 13px)',
                color: '#06b6d4',
                border: '1px solid rgba(6,182,212,0.3)',
                borderRadius: 4,
                padding: 'clamp(4px,0.5vh,8px) clamp(8px,0.8vw,14px)',
                background: 'rgba(6,182,212,0.05)',
                letterSpacing: '0.12em',
                whiteSpace: 'nowrap',
              }}
              initial={{ opacity: 0, scale: 0.8, x: 20 }}
              animate={phase >= 4 ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.8, x: 20 }}
              transition={{
                type: 'spring',
                stiffness: 350,
                damping: 24,
                delay: phase >= 4 ? i * 0.04 : 0,
              }}
            >
              {mod}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
