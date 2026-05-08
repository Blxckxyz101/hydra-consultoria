import { useState, useEffect, useMemo } from 'react';

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);
  
  const sceneKeys = useMemo(() => Object.keys(durations), [durations]);
  const sceneDurations = useMemo(() => Object.values(durations), [durations]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    // Notify recording started
    if (currentScene === 0) {
      if (typeof window !== 'undefined' && (window as any).startRecording) {
        (window as any).startRecording();
      }
    }

    const duration = sceneDurations[currentScene];
    if (duration) {
      timeoutId = setTimeout(() => {
        if (currentScene === sceneDurations.length - 1) {
          if (typeof window !== 'undefined' && (window as any).stopRecording) {
            (window as any).stopRecording();
          }
          // Loop back to start
          setCurrentScene(0);
        } else {
          setCurrentScene(currentScene + 1);
        }
      }, duration);
    }

    return () => clearTimeout(timeoutId);
  }, [currentScene, sceneDurations]);

  return { currentScene };
}
