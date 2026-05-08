import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  hook: 4500,
  problem: 5000,
  product: 8000,
  features: 6000,
  close: 6500,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: Scene1,
  problem: Scene2,
  product: Scene3,
  features: Scene4,
  close: Scene5,
};

// Persistent midground positions per scene
const ORB1_POS = [
  { x: '10vw', y: '15vh' },
  { x: '60vw', y: '5vh' },
  { x: '-5vw', y: '40vh' },
  { x: '55vw', y: '60vh' },
  { x: '20vw', y: '25vh' },
];
const ORB2_POS = [
  { x: '65vw', y: '55vh' },
  { x: '5vw', y: '60vh' },
  { x: '70vw', y: '20vh' },
  { x: '10vw', y: '10vh' },
  { x: '60vw', y: '40vh' },
];

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const orbIdx = Math.max(0, Math.min(sceneIndex, ORB1_POS.length - 1));

  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{ background: '#020617' }}
    >
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg pointer-events-none" />

      {/* Scanline sweep */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity: 0.06 }}>
        <div
          className="scanline absolute left-0 right-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)' }}
        />
      </div>

      {/* Persistent orb 1 — cyan */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 'clamp(300px, 50vw, 700px)',
          height: 'clamp(300px, 50vw, 700px)',
          background: 'radial-gradient(circle, rgba(6,182,212,0.18) 0%, transparent 70%)',
          filter: 'blur(60px)',
          top: '-10%',
          left: '-10%',
        }}
        animate={ORB1_POS[orbIdx]}
        transition={{ duration: 2.0, ease: [0.4, 0, 0.2, 1] }}
      />

      {/* Persistent orb 2 — blue */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 'clamp(200px, 35vw, 500px)',
          height: 'clamp(200px, 35vw, 500px)',
          background: 'radial-gradient(circle, rgba(14,165,233,0.12) 0%, transparent 70%)',
          filter: 'blur(50px)',
        }}
        animate={ORB2_POS[orbIdx]}
        transition={{ duration: 2.2, ease: [0.4, 0, 0.2, 1] }}
      />

      {/* Slow ambient drift on orb 1 */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 'clamp(150px, 25vw, 350px)',
          height: 'clamp(150px, 25vw, 350px)',
          background: 'radial-gradient(circle, rgba(103,232,249,0.08) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
        animate={{
          x: ['20vw', '70vw', '30vw'],
          y: ['70vh', '20vh', '60vh'],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Persistent accent line */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ height: 1, background: 'linear-gradient(90deg, transparent, #06b6d4, transparent)' }}
        animate={{
          top: ['8vh', '90vh', '50vh', '15vh', '80vh'][orbIdx],
          left: ['5%', '10%', '0%', '20%', '5%'][orbIdx],
          width: ['30%', '60%', '80%', '40%', '50%'][orbIdx],
          opacity: [0.4, 0.3, 0.5, 0.35, 0.45][orbIdx],
        }}
        transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
      />

      {/* Noise texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          opacity: 0.025,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Scene foreground */}
      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
