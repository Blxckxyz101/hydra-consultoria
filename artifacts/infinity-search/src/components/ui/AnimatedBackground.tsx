import { useEffect, useRef } from "react";
import bgUrl from "@/assets/background.png";

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let mouseX = width / 2;
    let mouseY = height / 2;
    let targetX = mouseX;
    let targetY = mouseY;

    const onMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    type P = { x: number; y: number; vx: number; vy: number; r: number; phase: number };
    const particles: P[] = [];
    const N = Math.min(120, Math.floor((width * height) / 14000));
    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.6 + 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }

    let t = 0;
    const render = () => {
      t += 0.005;
      mouseX += (targetX - mouseX) * 0.06;
      mouseY += (targetY - mouseY) * 0.06;

      ctx.clearRect(0, 0, width, height);

      // Subtle radial vignette glow following cursor
      const g = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 520);
      g.addColorStop(0, "rgba(56, 189, 248, 0.18)");
      g.addColorStop(0.5, "rgba(45, 124, 220, 0.06)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // Connecting + drifting particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // Mouse repulsion creates a wake
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const d2 = dx * dx + dy * dy;
        if (d2 < 18000) {
          const f = (18000 - d2) / 18000;
          p.vx += (dx / Math.sqrt(d2 + 1)) * 0.05 * f;
          p.vy += (dy / Math.sqrt(d2 + 1)) * 0.05 * f;
        }
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        const twinkle = 0.45 + Math.sin(t * 3 + p.phase) * 0.35;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125, 211, 252, ${twinkle * 0.7})`;
        ctx.fill();

        // connect nearby
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const ddx = p.x - q.x;
          const ddy = p.y - q.y;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < 11000) {
            const a = (1 - dd / 11000) * 0.18;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(56, 189, 248, ${a})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-[-3] pointer-events-none"
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-[-2] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(8,15,40,0.55), rgba(2,6,18,0.85) 60%, rgba(2,6,18,0.92))",
        }}
        aria-hidden
      />
      <canvas ref={canvasRef} className="fixed inset-0 z-[-1] pointer-events-none" aria-hidden />
    </>
  );
}
