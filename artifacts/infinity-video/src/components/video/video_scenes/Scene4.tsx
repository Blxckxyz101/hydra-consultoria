import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '@/lib/video/animations';

const AI_SHORTCUTS = [
  { icon: '👤', label: 'Consultar CPF' },
  { icon: '📱', label: 'Consultar Telefone' },
  { icon: '🏢', label: 'Consultar CNPJ' },
  { icon: '🚗', label: 'Consultar Placa' },
  { icon: '📸', label: 'Foto Biométrica' },
  { icon: '📁', label: 'Dossiê Completo' },
];

const BASES = [
  { name: 'GEASS PRIMARY',  status: 'ONLINE',  ms: 124, color: '#34d399' },
  { name: 'SKYLERS API',    status: 'ONLINE',  ms: 218, color: '#34d399' },
  { name: 'RECEITA WS',     status: 'ONLINE',  ms: 87,  color: '#34d399' },
  { name: 'BRASIL API',     status: 'ONLINE',  ms: 156, color: '#34d399' },
  { name: 'VIACEP',         status: 'ONLINE',  ms: 95,  color: '#34d399' },
  { name: 'FALLBACK B',     status: 'OFFLINE', ms: 0,   color: '#f87171' },
];

const FEATURES = [
  { icon: '📁', label: 'DOSSIÊ', desc: 'Compile evidências em relatórios estruturados' },
  { icon: '⭐', label: 'FAVORITOS', desc: 'Acesse resultados importantes rapidamente' },
  { icon: '📜', label: 'HISTÓRICO', desc: 'Auditoria completa com filtros e repetição' },
];

export function Scene4() {
  const [phase, setPhase] = useState(0);
  const [activeTab, setActiveTab] = useState<'ia' | 'monitor' | 'tools'>('ia');
  const [aiTyping, setAiTyping] = useState(false);
  const [aiText, setAiText] = useState('');

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 650),
      setTimeout(() => setPhase(3), 1100),
      setTimeout(() => {
        setAiTyping(true);
        const msg = 'Olá! Como posso ajudar?';
        let i = 0;
        const iv = setInterval(() => {
          setAiText(msg.slice(0, ++i));
          if (i >= msg.length) { clearInterval(iv); setAiTyping(false); }
        }, 55);
      }, 1600),
      setTimeout(() => { setActiveTab('monitor'); }, 3200),
      setTimeout(() => { setActiveTab('tools'); setPhase(4); }, 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col justify-center p-4 bg-[#020408] overflow-hidden"
      {...sceneTransitions.perspectiveFlip}
    >
      {/* Bg glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 45%, rgba(14,165,233,0.06) 0%, transparent 70%)' }}
      />

      {/* Header */}
      <motion.div
        className="relative z-10 mb-3"
        initial={{ opacity: 0, y: -18 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -18 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-mono text-[#0ea5e9]/55 tracking-[0.35em] uppercase">INTELIGÊNCIA COMPLETA</span>
        </div>
        <h2 className="text-[24px] font-black text-white leading-none">
          FERRAMENTAS<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#a78bfa] to-[#38bdf8]">
            AVANÇADAS
          </span>
        </h2>
      </motion.div>

      {/* Tab bar */}
      <motion.div
        className="relative z-10 flex gap-1 mb-2"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.4 }}
      >
        {(['ia', 'monitor', 'tools'] as const).map((tab) => {
          const labels = { ia: '🤖 IA ASSISTANT', monitor: '📡 BASES', tools: '🗂 RECURSOS' };
          const isActive = activeTab === tab;
          return (
            <div
              key={tab}
              className="flex-1 py-1.5 rounded-lg text-center text-[7.5px] font-mono font-bold tracking-wider transition-all"
              style={{
                background: isActive ? 'rgba(14,165,233,0.18)' : 'rgba(14,165,233,0.05)',
                border: isActive ? '1px solid rgba(14,165,233,0.4)' : '1px solid rgba(14,165,233,0.1)',
                color: isActive ? '#38bdf8' : 'rgba(255,255,255,0.3)',
              }}
            >
              {labels[tab]}
            </div>
          );
        })}
      </motion.div>

      {/* Tab content */}
      <motion.div
        className="relative z-10 rounded-xl border border-[#0ea5e9]/18 bg-[#060e1a]/80 overflow-hidden flex-1 max-h-[260px]"
        initial={{ opacity: 0, y: 14 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={{ duration: 0.5 }}
      >
        {/* IA tab */}
        {activeTab === 'ia' && (
          <div className="flex flex-col h-full">
            {/* Chat area */}
            <div className="flex-1 p-3 flex flex-col gap-2 overflow-hidden">
              {/* Bot message */}
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-[#0ea5e9]/20 border border-[#0ea5e9]/40 flex items-center justify-center text-[10px] shrink-0">
                  🤖
                </div>
                <div className="bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 rounded-lg rounded-tl-none px-2.5 py-1.5">
                  <span className="text-[9px] text-white/80 font-mono">
                    {aiText || '​'}
                    {aiTyping && (
                      <motion.span
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 0.7, repeat: Infinity }}
                        className="inline-block w-1 h-2.5 bg-[#38bdf8] ml-0.5 align-middle"
                      />
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="border-t border-[#0ea5e9]/15 p-2">
              <div className="text-[7px] font-mono text-white/25 mb-1.5 tracking-widest">AÇÕES RÁPIDAS</div>
              <div className="grid grid-cols-3 gap-1">
                {AI_SHORTCUTS.map((s, i) => (
                  <motion.div
                    key={s.label}
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 border border-[#0ea5e9]/18 bg-[#0ea5e9]/06 cursor-pointer"
                    style={{ background: 'rgba(14,165,233,0.05)' }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.08 + 0.2, type: 'spring', stiffness: 400, damping: 25 }}
                    whileHover={{ scale: 1.05 }}
                  >
                    <span className="text-[9px]">{s.icon}</span>
                    <span className="text-[6.5px] font-mono text-white/55 truncate">{s.label}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Monitor tab */}
        {activeTab === 'monitor' && (
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] font-mono text-[#0ea5e9]/55 tracking-widest uppercase">STATUS EM TEMPO REAL</span>
              <div className="flex gap-1.5">
                <span className="text-[7px] font-mono text-green-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />5 ONLINE
                </span>
                <span className="text-[7px] font-mono text-red-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />1 OFFLINE
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              {BASES.map((b, i) => (
                <motion.div
                  key={b.name}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 border"
                  style={{ borderColor: `${b.color}20`, background: `${b.color}06` }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                >
                  <motion.div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: b.color }}
                    animate={b.status === 'ONLINE' ? { opacity: [1, 0.4, 1] } : { opacity: 0.4 }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                  />
                  <span className="flex-1 text-[8.5px] font-mono text-white/70">{b.name}</span>
                  <span className="text-[7px] font-mono" style={{ color: b.color }}>
                    {b.status === 'ONLINE' ? `${b.ms}ms` : 'OFFLINE'}
                  </span>
                  <span className="text-[6.5px] font-mono text-white/25 w-12 text-right">
                    {b.status === 'ONLINE' ? 'HTTP 200' : 'TIMEOUT'}
                  </span>
                </motion.div>
              ))}
            </div>
            <div className="mt-2 px-2 py-1 rounded border border-amber-400/20 bg-amber-400/05 text-[7px] font-mono text-amber-400/70">
              ⚡ CIRCUIT BREAKER ativo — fallback automático habilitado
            </div>
          </div>
        )}

        {/* Tools tab */}
        {activeTab === 'tools' && (
          <div className="p-3 flex flex-col gap-2">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                className="flex items-start gap-3 rounded-lg p-2.5 border border-[#0ea5e9]/18 bg-[#0ea5e9]/05"
                style={{ background: 'rgba(14,165,233,0.04)' }}
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.12 }}
              >
                <span className="text-xl leading-none shrink-0 mt-0.5">{f.icon}</span>
                <div>
                  <div className="text-[9px] font-black text-white tracking-wider">{f.label}</div>
                  <div className="text-[8px] font-mono text-white/40 mt-0.5 leading-snug">{f.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
