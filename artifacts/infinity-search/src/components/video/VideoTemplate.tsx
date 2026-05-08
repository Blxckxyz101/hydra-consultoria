import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 4000, problem: 6000, product: 8000, advanced: 8000, close: 9000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020617] text-[#f0f9ff]" style={{ fontFamily: 'var(--app-font-sans)' }}>
      {/* Background layer - persists */}
      <div className="absolute inset-0">
        <video 
          src={`${import.meta.env.BASE_URL}bg-cyber.mp4`} 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-30" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-[#020617] opacity-80" />
        <div className="absolute inset-0 scanline pointer-events-none opacity-50" />
      </div>

      {/* Persistent Infinity Symbol */}
      <motion.div 
        className="absolute z-10 flex items-center justify-center pointer-events-none"
        animate={{
          x: currentScene === 0 ? '50vw' : currentScene === 4 ? '50vw' : '10vw',
          y: currentScene === 0 ? '40vh' : currentScene === 4 ? '40vh' : '10vh',
          scale: currentScene === 0 ? 2 : currentScene === 4 ? 3 : 0.6,
          opacity: currentScene >= 1 && currentScene <= 3 ? 0.4 : 1,
          x: currentScene === 0 ? 'calc(50vw - 40px)' : currentScene === 4 ? 'calc(50vw - 40px)' : 'calc(5vw)',
          y: currentScene === 0 ? 'calc(40vh - 40px)' : currentScene === 4 ? 'calc(40vh - 40px)' : 'calc(5vh)'
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="80" height="40" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
          <motion.path
            d="M25 25C25 15 35 15 45 25L55 35C65 45 75 45 75 35C75 25 65 15 55 15L45 25C35 35 25 35 25 25Z"
            stroke="#06b6d4"
            strokeWidth="4"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            style={{ filter: 'drop-shadow(0 0 8px rgba(6, 182, 212, 0.6))' }}
          />
        </svg>
      </motion.div>

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="open" />}
        {currentScene === 1 && <Scene2 key="problem" />}
        {currentScene === 2 && <Scene3 key="product" />}
        {currentScene === 3 && <Scene4 key="advanced" />}
        {currentScene === 4 && <Scene5 key="close" />}
      </AnimatePresence>
    </div>
  );
}