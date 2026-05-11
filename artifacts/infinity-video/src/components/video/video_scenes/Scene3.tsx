import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { sceneTransitions } from '../../lib/video/animations';
import img2 from '@assets/ade57ce7-cfa0-44f4-91e6-2bf98cc05f54_1778471980393.jpeg';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),  // Image reveals
      setTimeout(() => setPhase(2), 1200), // Text overlay
      setTimeout(() => setPhase(3), 2000), // Data populating
      setTimeout(() => setPhase(4), 5200), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const types = ["NOME/CPF", "CNPJ", "VEÍCULOS", "TELEFONES", "EMAILS", "RENDA", "PARENTES"];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#030712]"
      {...sceneTransitions.wipe}
    >
      <div className="absolute inset-0 overflow-hidden opacity-40">
        <motion.img 
          src={img2}
          alt="Infinity Search Features"
          className="w-full h-full object-cover"
          initial={{ scale: 1.1, rotate: -2 }}
          animate={phase >= 1 ? { scale: 1.05, rotate: 0 } : { scale: 1.1, rotate: -2 }}
          transition={{ duration: 6, ease: 'easeOut' }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-[#030712]/80 to-transparent" />
      </div>

      <div className="relative z-20 w-full flex flex-col justify-center h-full">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: 'circOut' }}
        >
          <div className="inline-block border border-[#0ea5e9] bg-[#0ea5e9]/10 text-[#0ea5e9] px-3 py-1 rounded-full text-xs font-mono mb-4">
            CAPABILITY_SCAN
          </div>
          <h2 className="text-5xl font-black text-white leading-none mb-2">24 TIPOS</h2>
          <h3 className="text-2xl text-[#38bdf8] tracking-wide mb-8">DE CONSULTA</h3>
        </motion.div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          {types.map((type, i) => (
            <motion.div
              key={type}
              className="border border-[#0f172a] bg-[#030712]/90 backdrop-blur-md p-3 rounded-lg text-sm font-mono text-gray-300 flex items-center gap-2"
              initial={{ opacity: 0, x: -20, scale: 0.9 }}
              animate={phase >= 3 ? { opacity: 1, x: 0, scale: 1, borderColor: '#0ea5e940' } : { opacity: 0, x: -20, scale: 0.9 }}
              transition={{ delay: i * 0.15, type: 'spring', stiffness: 300, damping: 20 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9]" />
              {type}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}