import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "speaking" | "thinking";

type Props = {
  active: boolean;
  size?: number;
  intensity?: number;
  orbState?: OrbState;
};

const COLORS = {
  idle:      { core: ["rgba(148,163,184,0.45)", "rgba(100,116,139,0.28)", "rgba(51,65,85,0.04)"], glow: "rgba(100,116,139,", ring: "rgba(148,163,184,", particle: "rgba(148,163,184," },
  listening: { core: ["rgba(186,230,253,0.95)", "rgba(56,189,248,0.72)", "rgba(14,116,200,0.14)"], glow: "rgba(56,189,248,", ring: "rgba(56,189,248,", particle: "rgba(125,211,252," },
  speaking:  { core: ["rgba(233,213,255,0.95)", "rgba(168,85,247,0.78)", "rgba(109,40,217,0.14)"], glow: "rgba(167,139,250,", ring: "rgba(168,85,247,", particle: "rgba(216,180,254," },
  thinking:  { core: ["rgba(254,215,170,0.95)", "rgba(251,146,60,0.78)", "rgba(194,65,12,0.14)"], glow: "rgba(251,146,60,", ring: "rgba(251,146,60,", particle: "rgba(253,186,116," },
};

export function VoiceOrb({ active, size = 280, intensity = 0, orbState = "idle" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);
  const stateRef = useRef(orbState);

  useEffect(() => { intensityRef.current = intensity; }, [intensity]);
  useEffect(() => { stateRef.current = orbState; }, [orbState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.255;

    // Particles
    const NUM_P = 32;
    const particles = Array.from({ length: NUM_P }, (_, i) => ({
      angle: (i / NUM_P) * Math.PI * 2 + Math.random() * 0.6,
      radius: baseR * (1.38 + Math.random() * 1.0),
      speed: (0.003 + Math.random() * 0.006) * (Math.random() > 0.5 ? 1 : -1),
      sz: 1.1 + Math.random() * 2.4,
      a0: 0.25 + Math.random() * 0.55,
      layer: Math.floor(Math.random() * 3),
    }));

    let raf = 0;
    let t = 0;
    let energy = 0.12;

    // Color lerp between states
    let curR = 0, curG = 0, curB = 0;
    const parseRGB = (s: string) => {
      const m = s.match(/rgba?\((\d+),(\d+),(\d+)/);
      return m ? [+m[1], +m[2], +m[3]] : [100, 116, 139];
    };
    const lerpRGB = (a: number[], b: number[], t: number) =>
      a.map((v, i) => Math.round(v + (b[i] - v) * t));
    let targetColors = COLORS.idle;
    let prevColors = COLORS.idle;
    let colorT = 1;
    let lastState = "idle";

    const render = () => {
      t += 0.016;
      ctx.clearRect(0, 0, size, size);

      const state = stateRef.current;
      if (state !== lastState) { prevColors = targetColors; targetColors = COLORS[state as OrbState]; colorT = 0; lastState = state; }
      colorT = Math.min(1, colorT + 0.04);

      const targetEnergy = active ? 0.35 + intensityRef.current * 0.75 : 0.11;
      energy += (targetEnergy - energy) * 0.06;

      const blendGlow = (key: keyof typeof COLORS) => {
        const p = parseRGB(prevColors[key as keyof typeof prevColors] as string);
        const tg = parseRGB(targetColors[key as keyof typeof targetColors] as string);
        const [r, g, b] = lerpRGB(p, tg, colorT);
        return `rgba(${r},${g},${b},`;
      };

      const glowRGB = blendGlow("glow");
      const ringRGB = blendGlow("ring");
      const partRGB = blendGlow("particle");

      // Blend core colors
      const blendCore = (idx: number) => {
        const pa = parseRGB(prevColors.core[idx]);
        const ta = parseRGB(targetColors.core[idx]);
        const [r, g, b] = lerpRGB(pa, ta, colorT);
        // Extract alpha from color string
        const alphaMatch = targetColors.core[idx].match(/[\d.]+\)$/);
        const prevAlpha = parseFloat(prevColors.core[idx].match(/[\d.]+\)$/)![0]);
        const targAlpha = parseFloat(alphaMatch ? alphaMatch[0] : "1");
        const alpha = prevAlpha + (targAlpha - prevAlpha) * colorT;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
      };

      // ── Outer pulse rings ──
      for (let i = 0; i < 5; i++) {
        const phase = ((t * 0.52 + i * 0.21) % 1);
        const r = baseR + phase * size * 0.35 * (0.45 + energy);
        const alpha = (1 - phase) * 0.18 * (active ? 1.5 : 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `${ringRGB}${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // ── Deep ambient glow ──
      const deepG = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 3.2);
      deepG.addColorStop(0, `${glowRGB}${0.32 * energy})`);
      deepG.addColorStop(0.55, `${glowRGB}${0.1 * energy})`);
      deepG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = deepG;
      ctx.fillRect(0, 0, size, size);

      // ── Orbiting ellipse rings ──
      for (let i = 0; i < 3; i++) {
        const rA = t * (0.2 + i * 0.12) + i * 1.05;
        const rB = baseR * (1.52 + i * 0.32);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rA);
        ctx.beginPath();
        ctx.ellipse(0, 0, rB, rB * (0.32 + i * 0.08), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `${ringRGB}${0.05 + energy * 0.09})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      }

      // ── Particles ──
      particles.forEach((p) => {
        p.angle += p.speed * (1 + energy * 0.9);
        const drift = Math.sin(t * 1.1 + p.layer * 1.4) * 10 * energy;
        const r = p.radius + drift;
        const px = cx + Math.cos(p.angle) * r;
        const py = cy + Math.sin(p.angle) * r;
        const alpha = p.a0 * (0.2 + energy * 0.8);
        const sz = p.sz * (0.65 + energy * 0.55);
        const pg = ctx.createRadialGradient(px, py, 0, px, py, sz * 2.8);
        pg.addColorStop(0, `${partRGB}${alpha})`);
        pg.addColorStop(1, `${partRGB}0)`);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, sz * 2.8, 0, Math.PI * 2);
        ctx.fill();
      });

      // ── Main blob ──
      ctx.beginPath();
      const pts = 88;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const e = energy;
        const w =
          Math.sin(a * 3 + t * 1.7) * 7.5 * e +
          Math.sin(a * 5 - t * 2.4) * 4.8 * e +
          Math.cos(a * 7 + t * 1.15) * 2.8 * e +
          Math.sin(a * 2 - t * 0.85) * 6.5 * e +
          Math.cos(a * 4 + t * 3.2) * 2.2 * e +
          Math.sin(a * 9 - t * 1.6) * 1.5 * e;
        const rad = baseR + w + intensityRef.current * 24;
        if (i === 0) ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        else ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();

      const fillG = ctx.createRadialGradient(cx - baseR * 0.2, cy - baseR * 0.25, 0, cx, cy, baseR * 1.1);
      fillG.addColorStop(0, blendCore(0));
      fillG.addColorStop(0.5, blendCore(1));
      fillG.addColorStop(1, blendCore(2));
      ctx.fillStyle = fillG;
      ctx.shadowColor = `${glowRGB}0.85)`;
      ctx.shadowBlur = 32 + energy * 44;
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── Specular ──
      const hiG = ctx.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.38, 0, cx, cy, baseR * 0.95);
      hiG.addColorStop(0, "rgba(255,255,255,0.58)");
      hiG.addColorStop(0.3, "rgba(255,255,255,0.12)");
      hiG.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hiG;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.9, 0, Math.PI * 2);
      ctx.fill();

      // ── Inner core glow ──
      const coreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 0.52);
      coreG.addColorStop(0, `${glowRGB}${0.28 * energy})`);
      coreG.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = coreG;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.52, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(render);
    };
    render();

    return () => cancelAnimationFrame(raf);
  }, [size, active]);

  return <canvas ref={canvasRef} className="pointer-events-none drop-shadow-2xl" aria-hidden />;
}
