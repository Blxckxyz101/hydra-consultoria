import { useEffect, useRef, useCallback } from 'react';

type SceneKey = 'abertura' | 'alvo' | 'consulta' | 'revelacao' | 'encerramento';

function createCtx() {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
}

function fadeGain(gain: GainNode, from: number, to: number, duration: number, ctx: AudioContext) {
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(from, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(to, ctx.currentTime + duration);
}

export function useNoirAudio(sceneKey: string) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const droneRef = useRef<OscillatorNode[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeNodes = useRef<AudioNode[]>([]);
  const resumedRef = useRef(false);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = createCtx();
      const master = ctxRef.current.createGain();
      master.gain.setValueAtTime(0, ctxRef.current.currentTime);
      master.connect(ctxRef.current.destination);
      masterRef.current = master;
    }
    return { ctx: ctxRef.current, master: masterRef.current! };
  }, []);

  const resume = useCallback(async () => {
    const { ctx, master } = getCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    if (!resumedRef.current) {
      resumedRef.current = true;
      fadeGain(master, 0, 1, 1.5, ctx);
      startDrone(ctx, master);
    }
  }, [getCtx]);

  function startDrone(ctx: AudioContext, dest: GainNode) {
    [[55, 0.04], [57.2, 0.03], [110, 0.015], [82.5, 0.02]].forEach(([freq, vol]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      osc.connect(g);
      g.connect(dest);
      osc.start();
      droneRef.current.push(osc);
    });

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    function playNoise() {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(80, ctx.currentTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.008, ctx.currentTime);
      src.connect(filter);
      filter.connect(g);
      g.connect(dest);
      src.start();
      activeNodes.current.push(src);
    }
    playNoise();
  }

  function typewriterTick(ctx: AudioContext, dest: GainNode) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.015), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3000 + Math.random() * 1000, ctx.currentTime);
    filter.Q.setValueAtTime(2, ctx.currentTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start();
  }

  function radarPing(ctx: AudioContext, dest: GainNode) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.connect(g);
    g.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 1.0);
  }

  function dataBeep(ctx: AudioContext, dest: GainNode, pitch: number) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, ctx.currentTime);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g);
    g.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }

  function alertSweep(ctx: AudioContext, dest: GainNode) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(720, ctx.currentTime + 1.2);
    osc.frequency.linearRampToValueAtTime(360, ctx.currentTime + 2.0);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.15);
    g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 1.8);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.connect(filter);
    filter.connect(g);
    g.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 2.6);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(660, ctx.currentTime);
      g2.gain.setValueAtTime(0, ctx.currentTime);
      g2.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc2.connect(g2);
      g2.connect(dest);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.7);
    }, 1800);
  }

  function terminalBeep(ctx: AudioContext, dest: GainNode) {
    [0, 120, 240].forEach(delay => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(g);
        g.connect(dest);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }, delay);
    });
  }

  function clearInterval_() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    if (!resumedRef.current) return;

    const { ctx, master } = getCtx();
    clearInterval_();

    const base = sceneKey.replace(/_r[12]$/, '') as SceneKey;

    if (base === 'abertura') {
      const tick = () => typewriterTick(ctx, master);
      tick();
      intervalRef.current = setInterval(tick, 100 + Math.random() * 80);

    } else if (base === 'alvo') {
      radarPing(ctx, master);
      intervalRef.current = setInterval(() => radarPing(ctx, master), 2200);

    } else if (base === 'consulta') {
      const pitches = [1200, 1400, 900, 1600, 800, 1100];
      let i = 0;
      const tick = () => {
        dataBeep(ctx, master, pitches[i % pitches.length]);
        i++;
      };
      tick();
      intervalRef.current = setInterval(tick, 120);

    } else if (base === 'revelacao') {
      alertSweep(ctx, master);

    } else if (base === 'encerramento') {
      terminalBeep(ctx, master);
    }

    return () => clearInterval_();
  }, [sceneKey, getCtx]);

  useEffect(() => {
    const handler = () => resume();
    window.addEventListener('click', handler, { once: true });
    resume();
    return () => window.removeEventListener('click', handler);
  }, [resume]);

  useEffect(() => {
    return () => {
      clearInterval_();
      droneRef.current.forEach(o => { try { o.stop(); } catch {} });
      ctxRef.current?.close();
    };
  }, []);

  return { resume };
}
