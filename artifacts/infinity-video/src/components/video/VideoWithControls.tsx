import { useCallback, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SkipBack, SkipForward, Repeat, ChevronDown, ChevronUp,
  Play, Pause,
} from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from '@/hooks/useSceneControls';

const PROGRESS_TICK_MS = 50;

const SCENE_LABELS: Record<string, string> = {
  hook:       'INTRO',
  reveal:     'COMANDO',
  capability: 'MÓDULOS',
  speed:      'FERRAMENTAS',
  closing:    'ACESSO',
};

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({
  sceneKeys,
  activeIndex,
  activeDuration,
  tick,
  onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  onJumpTo: (i: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;

  return (
    <div className="flex items-center gap-1.5 w-full">
      {sceneKeys.map((key, i) => {
        const baseKey = key.replace(/_r[12]$/, '');
        const isActive = i === activeIndex;
        const fill = isActive ? progress * 100 : i < activeIndex ? 100 : 0;
        return (
          <button
            key={key}
            onClick={() => onJumpTo(i)}
            className="group flex-1 flex flex-col gap-1 items-center cursor-pointer"
            title={SCENE_LABELS[baseKey] ?? baseKey}
          >
            <div className="relative w-full h-1 rounded-full overflow-hidden bg-white/10 group-hover:bg-white/20 transition-colors">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${fill}%`,
                  background: isActive
                    ? 'linear-gradient(90deg, #0ea5e9, #38bdf8)'
                    : fill === 100
                    ? 'rgba(14,165,233,0.5)'
                    : 'transparent',
                  boxShadow: isActive ? '0 0 6px rgba(14,165,233,0.8)' : 'none',
                  transition: isActive ? `width ${PROGRESS_TICK_MS}ms linear` : 'width 0.3s ease',
                }}
              />
            </div>
            <span className={`text-[7px] font-mono tracking-widest transition-colors ${isActive ? 'text-[#38bdf8]' : 'text-white/20'}`}>
              {SCENE_LABELS[baseKey] ?? baseKey}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Control Bar ───────────────────────────────────────────────────────────────
function ControlBar({
  visible,
  collapsed,
  locked,
  paused,
  sceneKeys,
  activeIndex,
  activeDuration,
  tick,
  onToggleLock,
  onJumpTo,
  onToggleCollapsed,
  onPrev,
  onNext,
  onTogglePause,
}: {
  visible: boolean;
  collapsed: boolean;
  locked: boolean;
  paused: boolean;
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  onToggleLock: () => void;
  onJumpTo: (i: number) => void;
  onToggleCollapsed: () => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="bar"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="flex flex-col gap-3 px-4 pt-3 pb-4"
          style={{
            background: 'linear-gradient(to top, rgba(2,4,8,0.98) 0%, rgba(2,4,8,0.85) 100%)',
            borderTop: '1px solid rgba(14,165,233,0.15)',
            backdropFilter: 'blur(16px)',
          }}
        >
          {/* Progress bar */}
          <ProgressBar
            sceneKeys={sceneKeys}
            activeIndex={activeIndex}
            activeDuration={activeDuration}
            tick={tick}
            onJumpTo={onJumpTo}
          />

          {/* Buttons row */}
          <div className="flex items-center justify-between">
            {/* Left: Prev */}
            <button
              onClick={onPrev}
              disabled={activeIndex === 0}
              className="w-9 h-9 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              title="Cena anterior"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Center: Play/Pause + Loop */}
            <div className="flex items-center gap-2">
              <button
                onClick={onTogglePause}
                className="relative w-11 h-11 flex items-center justify-center rounded-full transition-all"
                style={{
                  background: 'linear-gradient(135deg, #0369a1, #0ea5e9)',
                  boxShadow: paused ? 'none' : '0 0 15px rgba(14,165,233,0.6)',
                }}
                title={paused ? 'Reproduzir' : 'Pausar'}
              >
                {paused
                  ? <Play className="w-5 h-5 text-white translate-x-0.5" />
                  : <Pause className="w-5 h-5 text-white" />}
              </button>

              <button
                onClick={onToggleLock}
                className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                  locked
                    ? 'text-[#0ea5e9] bg-[#0ea5e9]/15 shadow-[0_0_10px_rgba(14,165,233,0.3)]'
                    : 'text-white/30 hover:text-white/60 hover:bg-white/10'
                }`}
                title={locked ? 'Loop: ligado' : 'Loop: desligado'}
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            {/* Right: Next + scene counter + collapse */}
            <div className="flex items-center gap-1">
              <button
                onClick={onNext}
                disabled={activeIndex === sceneKeys.length - 1}
                className="w-9 h-9 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                title="Próxima cena"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <div className="text-[10px] font-mono text-white/30 tabular-nums w-8 text-center">
                {activeIndex + 1}/{sceneKeys.length}
              </div>

              <button
                onClick={onToggleCollapsed}
                className="w-9 h-9 flex items-center justify-center rounded-full text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
                title={collapsed ? 'Mostrar controles' : 'Ocultar controles'}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function VideoWithControls() {
  const {
    sceneKeys,
    activeIndex,
    locked,
    mountKey,
    tick,
    durations,
    activeDuration,
    onSceneChange,
    jumpTo,
    toggleLock,
  } = useSceneControls(SCENE_DURATIONS);

  const sensorRef   = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [hovering,  setHovering]    = useState(false);
  const [tapPinned, setTapPinned]   = useState(false);
  const [paused,    setPaused]      = useState(false);

  // Show/hide logic
  const handlePointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (collapsed) setTapPinned(true);
  }, [collapsed]);

  const handleToggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      if (!c) { setHovering(false); setTapPinned(false); }
      return !c;
    });
  }, []);

  // Dismiss tap-pinned bar when tapping outside
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const handler = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (!sensorRef.current?.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [collapsed, tapPinned]);

  // Pause: freeze the video template by not passing durations
  const activeDurations = paused
    ? Object.fromEntries(Object.keys(durations).map(k => [k, 9_999_999]))
    : durations;

  const barVisible = !collapsed || hovering || tapPinned;

  const handlePrev = useCallback(() => {
    if (activeIndex > 0) jumpTo(activeIndex - 1);
  }, [activeIndex, jumpTo]);

  const handleNext = useCallback(() => {
    if (activeIndex < sceneKeys.length - 1) jumpTo(activeIndex + 1);
  }, [activeIndex, sceneKeys.length, jumpTo]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ')           { e.preventDefault(); setPaused(p => !p); }
      if (e.key === 'ArrowRight')  handleNext();
      if (e.key === 'ArrowLeft')   handlePrev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleNext, handlePrev]);

  // Collapsed tab (peek button)
  const PeekTab = () => (
    <AnimatePresence>
      {collapsed && (
        <motion.button
          key="peek"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={handleToggleCollapsed}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-white/40 hover:text-white/70 text-[9px] font-mono tracking-widest transition-colors"
          style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.15)' }}
        >
          <ChevronUp className="w-3 h-3" />
          CONTROLES
        </motion.button>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={activeDurations}
        loop
        onSceneChange={onSceneChange}
      />

      {/* Control sensor zone */}
      <div
        ref={sensorRef}
        className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end"
        style={{ height: '30%' }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <div className="flex-1 w-full" aria-hidden />
        <ControlBar
          visible={barVisible}
          collapsed={collapsed}
          locked={locked}
          paused={paused}
          sceneKeys={sceneKeys}
          activeIndex={activeIndex}
          activeDuration={activeDuration}
          tick={tick}
          onToggleLock={toggleLock}
          onJumpTo={jumpTo}
          onToggleCollapsed={handleToggleCollapsed}
          onPrev={handlePrev}
          onNext={handleNext}
          onTogglePause={() => setPaused(p => !p)}
        />
      </div>

      <PeekTab />
    </div>
  );
}
