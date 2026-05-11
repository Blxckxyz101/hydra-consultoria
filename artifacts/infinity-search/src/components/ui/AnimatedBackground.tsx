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
  const hsl = document.documentElement.getAttribute("data-theme-hsl") ?? "210 90% 55%";
  const parts = hsl.split(" ");
  const h = parseFloat(parts[0] ?? "210");
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
    const isMobile = window.innerWidth < 768;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);

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

    const onMove = (e: MouseEvent) => { targetX = e.clientX; targetY = e.clientY; };
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) { targetX = e.touches[0].clientX; targetY = e.touches[0].clientY; }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    type Star = { x: number; y: number; vx: number; vy: number; r: number; phase: number; twinkleSpeed: number };
    type ShootingStar = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; active: boolean };
    type FloatingOrb = { x: number; y: number; vx: number; vy: number; r: number; phase: number };

    const isMob = window.innerWidth < 768;
    const starCount = Math.min(isMob ? 60 : 130, Math.floor((width * height) / (isMob ? 9000 : 7000)));

    const stars: Star[] = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.12,
      r: Math.random() * 1.4 + 0.3,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 1.5 + Math.random() * 2.5,
    }));

    const orbCount = isMob ? 2 : 4;
    const orbs: FloatingOrb[] = Array.from({ length: orbCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.08,
      vy: (Math.random() - 0.5) * 0.08,
      r: 60 + Math.random() * 120,
      phase: Math.random() * Math.PI * 2,
    }));

    const shootingStars: ShootingStar[] = Array.from({ length: 3 }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, active: false,
    }));

    let scanY = -height;
    let scanActive = false;
    let scanTimer = 0;
    const scanInterval = isMob ? 12000 : 8000;

    let t = 0;
    let frameCount = 0;
    let lastScan = performance.now();
    let rgb: [number, number, number] = getThemeRgb();

    function spawnShootingStar(s: ShootingStar) {
      s.x = Math.random() * width * 0.7;
      s.y = Math.random() * height * 0.4;
      const angle = (Math.random() * 30 + 10) * (Math.PI / 180);
      const speed = 4 + Math.random() * 5;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
      s.life = 0;
      s.maxLife = 50 + Math.random() * 40;
      s.active = true;
    }

    const render = (now: number) => {
      t += 0.006;
      frameCount++;

      if (frameCount % 60 === 0) {
        rgb = getThemeRgb();
      }

      mouseX += (targetX - mouseX) * 0.04;
      mouseY += (targetY - mouseY) * 0.04;

      ctx.clearRect(0, 0, width, height);
      const [rr, gg, bb] = rgb;

      // Floating orbs — very subtle glow blobs
      for (const orb of orbs) {
        orb.phase += 0.003;
        orb.x += orb.vx + Math.sin(orb.phase) * 0.15;
        orb.y += orb.vy + Math.cos(orb.phase * 0.7) * 0.12;
        if (orb.x < -200) orb.x = width + 200;
        if (orb.x > width + 200) orb.x = -200;
        if (orb.y < -200) orb.y = height + 200;
        if (orb.y > height + 200) orb.y = -200;
        const orbGrad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
        const orbAlpha = (0.025 + Math.sin(orb.phase) * 0.01);
        orbGrad.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${orbAlpha})`);
        orbGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = orbGrad;
        ctx.fillRect(0, 0, width, height);
      }

      // Cursor glow
      const glowR = isMob ? 280 : 420;
      const glow = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, glowR);
      glow.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, 0.14)`);
      glow.addColorStop(0.45, `rgba(${Math.round(rr * 0.6)}, ${Math.round(gg * 0.5)}, ${Math.round(bb * 0.85)}, 0.04)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Stars
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const dx = s.x - mouseX;
        const dy = s.y - mouseY;
        const d2 = dx * dx + dy * dy;
        if (d2 < 22000) {
          const f = (22000 - d2) / 22000;
          s.vx += (dx / Math.sqrt(d2 + 1)) * 0.04 * f;
          s.vy += (dy / Math.sqrt(d2 + 1)) * 0.04 * f;
        }
        s.vx *= 0.988;
        s.vy *= 0.988;
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < -5) s.x = width + 5;
        if (s.x > width + 5) s.x = -5;
        if (s.y < -5) s.y = height + 5;
        if (s.y > height + 5) s.y = -5;

        const twinkle = 0.4 + Math.sin(t * s.twinkleSpeed + s.phase) * 0.35;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        const lr = Math.min(255, Math.round(rr + (255 - rr) * 0.5));
        const lg = Math.min(255, Math.round(gg + (255 - gg) * 0.5));
        const lb = Math.min(255, Math.round(bb + (255 - bb) * 0.5));
        ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${twinkle * 0.65})`;
        ctx.fill();

        // Bright star cross sparkle on larger stars
        if (s.r > 1.1 && twinkle > 0.65) {
          ctx.globalAlpha = (twinkle - 0.65) * 0.8;
          ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, 0.6)`;
          ctx.lineWidth = 0.5;
          const ss = s.r * 2.5;
          ctx.beginPath(); ctx.moveTo(s.x - ss, s.y); ctx.lineTo(s.x + ss, s.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s.x, s.y - ss); ctx.lineTo(s.x, s.y + ss); ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Connect nearby stars with very faint lines
        if (!isMob) {
          for (let j = i + 1; j < stars.length; j++) {
            const q = stars[j];
            const ddx = s.x - q.x;
            const ddy = s.y - q.y;
            const dd = ddx * ddx + ddy * ddy;
            if (dd < 9000) {
              ctx.beginPath();
              ctx.moveTo(s.x, s.y);
              ctx.lineTo(q.x, q.y);
              ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${(1 - dd / 9000) * 0.1})`;
              ctx.lineWidth = 0.4;
              ctx.stroke();
            }
          }
        }
      }

      // Shooting stars
      for (const ss of shootingStars) {
        if (!ss.active) continue;
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.life++;
        if (ss.life >= ss.maxLife) { ss.active = false; continue; }
        const prog = ss.life / ss.maxLife;
        const alpha = prog < 0.3 ? prog / 0.3 : prog > 0.7 ? (1 - prog) / 0.3 : 1;
        const tailLen = 40 + ss.vx * 6;
        const grad = ctx.createLinearGradient(ss.x - ss.vx * 10, ss.y - ss.vy * 10, ss.x, ss.y);
        grad.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, 0)`);
        grad.addColorStop(1, `rgba(255, 255, 255, ${alpha * 0.85})`);
        ctx.beginPath();
        ctx.moveTo(ss.x - ss.vx * (tailLen / Math.abs(ss.vx)), ss.y - ss.vy * (tailLen / Math.abs(ss.vx)));
        ctx.lineTo(ss.x, ss.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Shoot star spawner
      if (now - scanTimer > 4000 + Math.random() * 6000) {
        const idle = shootingStars.find(s => !s.active);
        if (idle && !isMob) { spawnShootingStar(idle); }
        scanTimer = now;
      }

      // Horizontal scan line sweep
      if (!scanActive && now - lastScan > scanInterval) {
        scanActive = true;
        scanY = -4;
        lastScan = now;
      }
      if (scanActive) {
        scanY += isMob ? 4 : 3;
        if (scanY > height + 10) { scanActive = false; scanY = -10; }
        const scanGrad = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
        scanGrad.addColorStop(0, "rgba(0,0,0,0)");
        scanGrad.addColorStop(0.4, `rgba(${rr}, ${gg}, ${bb}, 0.07)`);
        scanGrad.addColorStop(0.5, `rgba(${rr}, ${gg}, ${bb}, 0.18)`);
        scanGrad.addColorStop(0.6, `rgba(${rr}, ${gg}, ${bb}, 0.07)`);
        scanGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = scanGrad;
        ctx.fillRect(0, scanY - 12, width, 24);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      {/* New Hydra tech background */}
      <div
        className="fixed inset-0 z-[-3] pointer-events-none"
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
        }}
        aria-hidden
      />

      {/* Subtle darkening overlay — much lighter to let the background breathe */}
      <div
        className="fixed inset-0 z-[-2] pointer-events-none"
        style={{
          background: isAmoled
            ? "rgba(0,0,0,0.92)"
            : "radial-gradient(ellipse at 50% 30%, rgba(4,12,30,0.35) 0%, rgba(2,6,18,0.55) 60%, rgba(2,6,18,0.72) 100%)",
          transition: "background 0.5s ease",
        }}
        aria-hidden
      />

      <canvas ref={canvasRef} className="fixed inset-0 z-[-1] pointer-events-none" aria-hidden />
    </>
  );
}
