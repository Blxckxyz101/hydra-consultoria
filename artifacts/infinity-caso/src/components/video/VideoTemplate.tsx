import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  abertura:   5000,
  alvo:       6000,
  consulta:   8000,
  revelacao:  7000,
  encerramento: 5500,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  abertura:     Scene1,
  alvo:         Scene2,
  consulta:     Scene3,
  revelacao:    Scene4,
  encerramento: Scene5,
};

const ORB_POSITIONS = [
  { x: '20vw',  y: '25vh', scale: 1.8, opacity: 0.06 },
  { x: '70vw',  y: '60vh', scale: 1.2, opacity: 0.05 },
  { x: '50vw',  y: '15vh', scale: 2.2, opacity: 0.04 },
  { x: '10vw',  y: '70vh', scale: 1.0, opacity: 0.05 },
  { x: '80vw',  y: '20vh', scale: 1.5, opacity: 0.04 },
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

  const orbPos = ORB_POSITIONS[sceneIndex] ?? ORB_POSITIONS[0];

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ backgroundColor: '#05080f' }}>

      {/* Persistent drifting ambient orb */}
      <motion.div
        className="absolute rounded-full blur-3xl pointer-events-none"
        style={{
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(6,182,212,1), transparent 70%)',
        }}
        animate={{
          x: orbPos.x,
          y: orbPos.y,
          scale: orbPos.scale,
          opacity: orbPos.opacity,
        }}
        transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Second persistent orb — amber */}
      <motion.div
        className="absolute rounded-full blur-3xl pointer-events-none"
        style={{
          width: '350px',
          height: '350px',
          background: 'radial-gradient(circle, rgba(200,168,75,1), transparent 70%)',
          right: 0,
          bottom: 0,
        }}
        animate={{
          opacity: [0.03, 0.05, 0.03],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Persistent accent line that shifts position between scenes */}
      <motion.div
        className="absolute pointer-events-none"
        style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(6,182,212,0.4), transparent)' }}
        animate={{
          top: ['8%', '92%', '50%', '15%', '85%'][sceneIndex],
          left: '10%',
          right: '10%',
          opacity: [0.5, 0.3, 0.6, 0.4, 0.7][sceneIndex],
        }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Persistent floating dot array — top right */}
      <motion.div
        className="absolute top-6 right-8 flex gap-2 pointer-events-none"
        animate={{ opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      >
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#06b6d4' }} />
        ))}
      </motion.div>

      {/* Scene foreground */}
      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
