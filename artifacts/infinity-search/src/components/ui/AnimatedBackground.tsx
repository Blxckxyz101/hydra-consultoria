import { useEffect, useRef, useState } from "react";
import bgUrl from "@/assets/background.png";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function getThemeRgb(): [number, number, number] {
  const hsl = document.documentElement.getAttribute("data-theme-hsl") ?? "195 90% 55%";
  const parts = hsl.split(" ");
  const h = parseFloat(parts[0] ?? "195");
  const s = parseFloat((parts[1] ?? "90%").replace("%", ""));
  const l = parseFloat((parts[2] ?? "55%").replace("%", ""));
  return hslToRgb(h, s, l);
}

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isAmoled, setIsAmoled] = useState(
    () => document.documentElement.getAttribute("data-theme") === "amoled"
  );

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsAmoled(document.documentElement.getAttribute("data-theme") === "amoled");
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

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
    let frameCount = 0;
    let rgb: [number, number, number] = getThemeRgb();
    let curIsAmoled = document.documentElement.getAttribute("data-theme") === "amoled";

    const render = () => {
      t += 0.005;
      frameCount++;
      if (frameCount % 30 === 0) {
        rgb = getThemeRgb();
        curIsAmoled = document.documentElement.getAttribute("data-theme") === "amoled";
      }

      mouseX += (targetX - mouseX) * 0.06;
      mouseY += (targetY - mouseY) * 0.06;

      ctx.clearRect(0, 0, width, height);

      const [rr, gg, bb] = rgb;

      // cursor glow — tighter and more vivid on AMOLED
      const glowRadius = curIsAmoled ? 400 : 520;
      const glowAlpha = curIsAmoled ? 0.28 : 0.18;
      const g = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, glowRadius);
      g.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${glowAlpha})`);
      g.addColorStop(0.5, `rgba(${Math.round(rr * 0.8)}, ${Math.round(gg * 0.65)}, ${Math.round(bb * 0.87)}, ${curIsAmoled ? 0.09 : 0.06})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
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
        const particleAlpha = curIsAmoled ? twinkle * 0.9 : twinkle * 0.7;
        if (curIsAmoled) {
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${particleAlpha})`;
        } else {
          const lr = Math.min(255, Math.round(rr + (255 - rr) * 0.45));
          const lg = Math.min(255, Math.round(gg + (255 - gg) * 0.45));
          const lb = Math.min(255, Math.round(bb + (255 - bb) * 0.45));
          ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${particleAlpha})`;
        }
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const ddx = p.x - q.x;
          const ddy = p.y - q.y;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < 11000) {
            const alpha = (1 - dd / 11000) * (curIsAmoled ? 0.28 : 0.18);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
            ctx.lineWidth = curIsAmoled ? 0.8 : 0.6;
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
      {/* Background image — hidden on AMOLED for true black */}
      {!isAmoled && (
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
      )}

      {/* Overlay — pure black for AMOLED, navy gradient otherwise */}
      <div
        className="fixed inset-0 z-[-2] pointer-events-none"
        style={{
          background: isAmoled
            ? "#000000"
            : "radial-gradient(ellipse at top, rgba(8,15,40,0.55), rgba(2,6,18,0.85) 60%, rgba(2,6,18,0.92))",
          transition: "background 0.4s ease",
        }}
        aria-hidden
      />

      <canvas ref={canvasRef} className="fixed inset-0 z-[-1] pointer-events-none" aria-hidden />
    </>
  );
}
