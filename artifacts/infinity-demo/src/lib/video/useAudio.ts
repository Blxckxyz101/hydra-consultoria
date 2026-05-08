import { useEffect, useRef, useCallback } from 'react';

type SceneKey = 'hook' | 'problem' | 'product' | 'features' | 'close';

function createCtx() {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
}

function fadeGain(gain: GainNode, from: number, to: number, duration: number, ctx: AudioContext) {
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(from, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(to, ctx.currentTime + duration);
}

export function useDemoAudio(sceneKey: string) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const padOscsRef = useRef<OscillatorNode[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      startPad(ctx, master);
    }
  }, [getCtx]);

  function startPad(ctx: AudioContext, dest: GainNode) {
    const chords = [
      [220, 277.18, 329.63],
      [196, 246.94, 293.66],
      [246.94, 311.13, 369.99],
    ];
    const chord = chords[0];
    chord.forEach(freq => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0.022, ctx.currentTime);
      osc.connect(g);
      g.connect(dest);
      osc.start();
      padOscsRef.current.push(osc);
    });

    const pulse = ctx.createOscillator();
    const pulseGain = ctx.createGain();
    pulse.type = 'sine';
    pulse.frequency.setValueAtTime(2, ctx.currentTime);
    pulseGain.gain.setValueAtTime(0.012, ctx.currentTime);
    pulse.connect(pulseGain);
    pulseGain.connect(dest);
    pulse.start();
    padOscsRef.current.push(pulse);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = noiseBuffer;
    nSrc.loop = true;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'highpass';
    nFilter.frequency.setValueAtTime(6000, ctx.currentTime);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.004, ctx.currentTime);
    nSrc.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(dest);
    nSrc.start();
  }

  function swoosh(ctx: AudioContext, dest: GainNode, up = true) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(up ? 400 : 2000, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(up ? 2000 : 400, ctx.currentTime + 0.35);
    filter.Q.setValueAtTime(3, ctx.currentTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start();
  }

  function discordantLow(ctx: AudioContext, dest: GainNode) {
    [[80, 0.06], [127, 0.04], [113, 0.035]].forEach(([freq, vol], i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.3);
        g.gain.linearRampToValueAtTime(vol * 0.6, ctx.currentTime + 2.5);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 4.0);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, ctx.currentTime);
        osc.connect(filter);
        filter.connect(g);
        g.connect(dest);
        osc.start();
        osc.stop(ctx.currentTime + 4.5);
      }, i * 300);
    });
  }

  function uiClick(ctx: AudioContext, dest: GainNode) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.05);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  function techPing(ctx: AudioContext, dest: GainNode, freq: number) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(g);
    g.connect(dest);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  }

  function triumphArpeggio(ctx: AudioContext, dest: GainNode) {
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(g);
        g.connect(dest);
        osc.start();
        osc.stop(ctx.currentTime + 1.0);
      }, i * 120);
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

    if (base === 'hook') {
      swoosh(ctx, master, true);

    } else if (base === 'problem') {
      discordantLow(ctx, master);

    } else if (base === 'product') {
      swoosh(ctx, master, true);
      setTimeout(() => uiClick(ctx, master), 600);
      intervalRef.current = setInterval(() => uiClick(ctx, master), 1800);

    } else if (base === 'features') {
      const pings = [523.25, 659.25, 783.99, 1046.5];
      let i = 0;
      const tick = () => {
        techPing(ctx, master, pings[i % pings.length]);
        i++;
      };
      tick();
      intervalRef.current = setInterval(tick, 1200);

    } else if (base === 'close') {
      triumphArpeggio(ctx, master);
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
      padOscsRef.current.forEach(o => { try { o.stop(); } catch {} });
      ctxRef.current?.close();
    };
  }, []);

  return { resume };
}
