import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS: Record<string, number> = {
  hook:       5500,
  reveal:     7000,
  capability: 7500,
  speed:      7000,
  closing:    6500,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook:       Scene1,
  reveal:     Scene2,
  capability: Scene3,
  speed:      Scene4,
  closing:    Scene5,
};

// Deterministic particle positions (no random on render)
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  x: ((i * 37.3) % 100),
  y: ((i * 53.7) % 100),
  size: 1 + (i % 3) * 0.5,
  dur: 8 + (i % 6) * 2,
  delay: (i * 0.4) % 5,
  drift: -15 + (i % 5) * 8,
}));

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });
  const prevKeyRef = useRef(currentSceneKey);

  useEffect(() => {
    if (currentSceneKey !== prevKeyRef.current) {
      prevKeyRef.current = currentSceneKey;
      onSceneChange?.(currentSceneKey);
    }
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020408] flex items-center justify-center">
      {/* ─── Outer area left/right ─── */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 30% 80% at 0% 50%, rgba(14,165,233,0.04) 0%, transparent 60%), radial-gradient(ellipse 30% 80% at 100% 50%, rgba(14,165,233,0.04) 0%, transparent 60%)' }}
      />

      {/* ─── Phone frame ─── */}
      <div
        className="relative overflow-hidden shadow-[0_0_80px_rgba(14,165,233,0.15),0_0_160px_rgba(14,165,233,0.06)]"
        style={{
          width: '56.25vh',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '177.78vw',
          borderLeft: '1px solid rgba(14,165,233,0.12)',
          borderRight: '1px solid rgba(14,165,233,0.12)',
        }}
      >
        {/* ── Persistent Background Layer ── */}
        <div className="absolute inset-0 pointer-events-none z-0">
          {/* Base dark */}
          <div className="absolute inset-0 bg-[#020408]" />

          {/* Scanlines (CRT) */}
          <div
            className="absolute inset-0 opacity-[0.025] pointer-events-none"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,1) 2px, rgba(0,0,0,1) 4px)',
            }}
          />

          {/* Subtle dot grid */}
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: 'radial-gradient(circle, #0ea5e9 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />

          {/* Top neon glow arc */}
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-full h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(14,165,233,0.12) 0%, transparent 70%)' }}
          />

          {/* Bottom neon glow arc */}
          <div
            className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-full h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 100%, rgba(14,165,233,0.08) 0%, transparent 70%)' }}
          />

          {/* Animated particles */}
          {PARTICLES.map((p, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full bg-[#0ea5e9]"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                opacity: 0.15,
              }}
              animate={{
                y: [0, p.drift, 0],
                opacity: [0.08, 0.35, 0.08],
              }}
              transition={{
                duration: p.dur,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          ))}

          {/* Slow cyan blob top-left */}
          <motion.div
            className="absolute w-[60vh] h-[60vh] rounded-full pointer-events-none"
            style={{
              top: '-10%', left: '-20%',
              background: 'radial-gradient(circle, rgba(14,165,233,0.08) 0%, transparent 70%)',
              filter: 'blur(40px)',
            }}
            animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Slow cyan blob bottom-right */}
          <motion.div
            className="absolute w-[50vh] h-[50vh] rounded-full pointer-events-none"
            style={{
              bottom: '-10%', right: '-20%',
              background: 'radial-gradient(circle, rgba(56,189,248,0.06) 0%, transparent 70%)',
              filter: 'blur(40px)',
            }}
            animate={{ x: [0, -25, 0], y: [0, -15, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Vertical neon accent lines */}
          <motion.div
            className="absolute top-0 bottom-0 w-[1px] left-[15%] pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(14,165,233,0.3) 40%, rgba(14,165,233,0.3) 60%, transparent 100%)' }}
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute top-0 bottom-0 w-[1px] right-[15%] pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(14,165,233,0.3) 40%, rgba(14,165,233,0.3) 60%, transparent 100%)' }}
            animate={{ opacity: [0.5, 0.2, 0.5] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          />
        </div>

        {/* ── Scene content ── */}
        <AnimatePresence mode="popLayout">
          {SceneComponent && <SceneComponent key={currentSceneKey} />}
        </AnimatePresence>

        {/* ── Top HUD overlay ── */}
        <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none px-4 pt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-[#0ea5e9]"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-[7px] font-mono text-[#0ea5e9]/50 tracking-widest uppercase">HYDRA · LIVE</span>
          </div>
          <div className="text-[7px] font-mono text-white/20 tracking-widest">
            v2.0
          </div>
        </div>

        {/* ── Vignette ── */}
        <div
          className="absolute inset-0 pointer-events-none z-40"
          style={{
            background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 55%, rgba(2,4,8,0.85) 100%)',
          }}
        />
      </div>
    </div>
  );
}
