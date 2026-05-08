import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

const CARDS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    title: 'Dossiê Digital',
    desc: 'Salve evidências, adicione notas e exporte relatórios completos.',
    color: '#06b6d4',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
        <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .116 2.7-1.179 2.7H3.977c-1.296 0-2.18-1.7-1.179-2.7L4.2 15.3" />
      </svg>
    ),
    title: 'Assistente IA',
    desc: 'Análise inteligente dos dados encontrados, padrões e correlações.',
    color: '#0ea5e9',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ width: '100%', height: '100%' }}>
        <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a12 12 0 010 18M12 3a12 12 0 000 18" />
      </svg>
    ),
    title: '80+ Módulos',
    desc: 'Via Skylers API — cobertura máxima, dados atualizados em tempo real.',
    color: '#67e8f9',
  },
];

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ clipPath: 'circle(0% at 50% 100%)' }}
      animate={{ clipPath: 'circle(150% at 50% 100%)' }}
      exit={{ clipPath: 'circle(0% at 50% 0%)' }}
      transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Header */}
      <motion.div
        className="text-center mb-[4vh]"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'clamp(10px, 1.1vw, 14px)',
          color: '#06b6d4',
          letterSpacing: '0.18em',
          fontWeight: 500,
          textTransform: 'uppercase',
          marginBottom: '1vh',
        }}>Ferramentas profissionais</p>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(24px, 4vw, 56px)',
          fontWeight: 700,
          color: '#f0f9ff',
          lineHeight: 1.1,
        }}>Tudo que você precisa,<br /><span style={{ color: '#06b6d4' }}>num só lugar.</span></h2>
      </motion.div>

      {/* Cards */}
      <div className="flex" style={{ gap: 'clamp(12px,2vw,28px)', padding: '0 clamp(20px,5vw,80px)' }}>
        {CARDS.map((card, i) => (
          <motion.div
            key={card.title}
            style={{
              flex: 1,
              background: `rgba(6,182,212,0.04)`,
              border: `1px solid rgba(6,182,212,0.18)`,
              borderRadius: 12,
              padding: 'clamp(16px,2.5vh,36px) clamp(14px,1.8vw,26px)',
              backdropFilter: 'blur(12px)',
              boxShadow: `0 0 30px rgba(6,182,212,0.06), inset 0 1px 0 rgba(255,255,255,0.04)`,
              position: 'relative',
              overflow: 'hidden',
            }}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={phase >= 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.95 }}
            transition={{
              type: 'spring',
              stiffness: 320,
              damping: 26,
              delay: phase >= 2 ? i * 0.12 : 0,
            }}
          >
            {/* Glow accent top */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${card.color}, transparent)`,
              opacity: 0.6,
            }} />

            {/* Icon */}
            <motion.div
              style={{
                width: 'clamp(28px,3vw,44px)',
                height: 'clamp(28px,3vw,44px)',
                color: card.color,
                marginBottom: 'clamp(10px,1.5vh,20px)',
              }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
            >
              {card.icon}
            </motion.div>

            <h3 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(14px,1.6vw,22px)',
              fontWeight: 600,
              color: '#f0f9ff',
              marginBottom: 'clamp(6px,1vh,12px)',
            }}>{card.title}</h3>

            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'clamp(10px,1vw,14px)',
              color: '#475569',
              lineHeight: 1.6,
            }}>{card.desc}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
