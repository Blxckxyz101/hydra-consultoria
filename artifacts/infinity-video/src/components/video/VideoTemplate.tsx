import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { 
  hook: 4000, 
  reveal: 5000, 
  capability: 6000, 
  social: 5000, 
  closing: 5000 
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#030712] flex items-center justify-center">
      {/* Container for 9:16 aspect ratio */}
      <div 
        className="relative overflow-hidden bg-[#030712] shadow-2xl shadow-cyan-900/20"
        style={{
          width: '56.25vh', /* 9/16 = 0.5625 */
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '177.78vw', /* 16/9 = 1.7778 */
        }}
      >
        {/* Persistent background layers */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Grid */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIDEwaDQwaC00MHptMCAxMGg0MGgtNDB6bTAgMTBoNDBoLTQwek0xMCAwdjQwdi00MHptMTAgMHY0MHYtNDB6bTEwIDB2NDB2LTQweiIgc3Ryb2tlPSIjMGVhNWU5IiBzdHJva2Utb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-30" />
          
          {/* Subtle cyan glows */}
          <motion.div 
            className="absolute top-1/4 left-1/4 w-[50vh] h-[50vh] rounded-full blur-[100px] opacity-20 pointer-events-none"
            style={{ background: '#0ea5e9' }}
            animate={{ 
              x: ['-20%', '20%', '-10%', '0%'],
              y: ['-10%', '30%', '10%', '0%'],
              scale: [1, 1.2, 0.8, 1],
              opacity: [0.1, 0.25, 0.15, 0.1]
            }}
            transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div 
            className="absolute bottom-1/4 right-1/4 w-[40vh] h-[40vh] rounded-full blur-[80px] opacity-10 pointer-events-none"
            style={{ background: '#38bdf8' }}
            animate={{ 
              x: ['20%', '-20%', '10%', '0%'],
              y: ['20%', '-30%', '-10%', '0%'],
              scale: [0.8, 1.3, 1, 0.8]
            }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Drifting particles */}
          {Array.from({ length: 20 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-1 h-1 bg-[#0ea5e9] rounded-full"
              initial={{
                x: `${Math.random() * 100}vw`,
                y: `${Math.random() * 100}vh`,
                opacity: Math.random() * 0.5 + 0.1
              }}
              animate={{
                y: [`${Math.random() * 100}vh`, `${Math.random() * 100}vh`],
                opacity: [0.1, 0.5, 0.1]
              }}
              transition={{
                duration: 10 + Math.random() * 10,
                repeat: Infinity,
                ease: 'linear'
              }}
            />
          ))}

          {/* Cross-scene continuity: persistent cyan accent line */}
          <motion.div
            className="absolute bg-[#0ea5e9] shadow-[0_0_15px_rgba(14,165,233,0.8)]"
            animate={{
              left: [0, '10%', '5%', 0, '50%'][currentScene],
              top: ['50%', '15%', '85%', '5%', '90%'][currentScene],
              width: ['100%', '2px', '40%', '2px', '20px'][currentScene],
              height: ['2px', '70%', '2px', '90%', '20px'][currentScene],
              opacity: [0.8, 0.6, 0.8, 0.5, 1][currentScene],
              rotate: [0, 0, 0, 0, 45][currentScene],
              borderRadius: [0, 0, 0, 0, '50%'][currentScene]
            }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            style={{ zIndex: 50 }}
          />
        </div>

        {/* Foreground scenes */}
        <AnimatePresence mode="sync">
          {currentScene === 0 && <Scene1 key="hook" />}
          {currentScene === 1 && <Scene2 key="reveal" />}
          {currentScene === 2 && <Scene3 key="capability" />}
          {currentScene === 3 && <Scene4 key="social" />}
          {currentScene === 4 && <Scene5 key="closing" />}
        </AnimatePresence>
      </div>
    </div>
  );
}