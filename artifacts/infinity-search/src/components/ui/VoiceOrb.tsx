import { useEffect, useRef } from "react";

type Props = {
  active: boolean;
  size?: number;
  intensity?: number;
};

export function VoiceOrb({ active, size = 280, intensity = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

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

    let raf = 0;
    let t = 0;

    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.28;

    const render = () => {
      t += 0.018;
      ctx.clearRect(0, 0, size, size);

      const energy = active ? 0.4 + intensityRef.current * 0.7 : 0.15;

      // Outer halo rings
      for (let i = 0; i < 4; i++) {
        const phase = (t * 0.6 + i * 0.4) % 1;
        const r = baseR + phase * size * 0.3 * (0.6 + energy);
        const alpha = (1 - phase) * 0.18 * (active ? 1 : 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // Soft glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 2.4);
      glow.addColorStop(0, `rgba(56, 189, 248, ${0.45 * energy})`);
      glow.addColorStop(0.6, `rgba(14, 165, 233, ${0.12 * energy})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // Distorted main blob
      ctx.beginPath();
      const points = 64;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const wobble =
          Math.sin(a * 3 + t * 1.4) * 6 * energy +
          Math.sin(a * 5 - t * 2.1) * 4 * energy +
          Math.cos(a * 2 + t * 0.9) * 5 * energy;
        const r = baseR + wobble + intensityRef.current * 18;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const fill = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR);
      fill.addColorStop(0, "rgba(186, 230, 253, 0.9)");
      fill.addColorStop(0.5, "rgba(56, 189, 248, 0.65)");
      fill.addColorStop(1, "rgba(14, 116, 200, 0.15)");
      ctx.fillStyle = fill;
      ctx.shadowColor = "rgba(56,189,248,0.7)";
      ctx.shadowBlur = 30 + energy * 30;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner highlight
      const hi = ctx.createRadialGradient(
        cx - baseR * 0.25,
        cy - baseR * 0.3,
        0,
        cx,
        cy,
        baseR
      );
      hi.addColorStop(0, "rgba(255,255,255,0.5)");
      hi.addColorStop(0.4, "rgba(255,255,255,0)");
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.85, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(render);
    };
    render();

    return () => cancelAnimationFrame(raf);
  }, [size, active]);

  return <canvas ref={canvasRef} className="pointer-events-none" aria-hidden />;
}
