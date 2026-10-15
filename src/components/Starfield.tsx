import { useEffect, useRef } from 'react';

interface Star { x: number; y: number; r: number; base: number; speed: number; phase: number; hue: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number }

const HUES = [210, 220, 260, 190, 40];
/**
 * Fixed colour strings, one per hue. Every frame sets a star's brightness with `globalAlpha` instead of building a
 * new `hsla(..., alpha)` string: a colour string that is different on every frame (hundreds of stars, 30-60 times a
 * second) fills Chromium's colour-parsing caches and cost about 13 MB of memory in the window.
 */
const STAR_COLOR = HUES.map((h) => `hsl(${h}, 90%, 88%)`);
const GLOW_COLOR = HUES.map((h) => `hsl(${h}, 90%, 85%)`);
const METEOR_COLORS = ['rgba(220,240,255,1)', 'rgba(220,240,255,0)'];

/** Animated twinkling starfield with the occasional shooting star. */
export function Starfield({ density = 0.00035 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stars: Star[] = [];
    let meteor: Meteor | null = null;
    let nextMeteor = performance.now() + 3000 + Math.random() * 5000;
    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(30, Math.round(w * h * density));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() < 0.9 ? Math.random() * 1.1 + 0.3 : Math.random() * 1.2 + 1.2,
        base: Math.random() * 0.6 + 0.3,
        speed: Math.random() * 0.002 + 0.0005,
        phase: Math.random() * Math.PI * 2,
        hue: Math.floor(Math.random() * HUES.length),
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      for (const s of stars) {
        const a = reduce ? s.base : s.base * (0.6 + 0.4 * Math.sin(t * s.speed + s.phase));
        ctx.beginPath();
        ctx.globalAlpha = a;
        ctx.fillStyle = STAR_COLOR[s.hue];
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.3) {
          ctx.globalAlpha = a * 0.15;
          ctx.fillStyle = GLOW_COLOR[s.hue];
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (!reduce) { s.y += 0.015; if (s.y > h + 2) s.y = -2; }
      }

      if (!reduce) {
        if (!meteor && t > nextMeteor) {
          meteor = { x: Math.random() * w * 0.7 + w * 0.3, y: Math.random() * h * 0.3, vx: -4.5, vy: 2.2, life: 1 };
        }
        if (meteor) {
          const m = meteor;
          const grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 12, m.y - m.vy * 12);
          grad.addColorStop(0, METEOR_COLORS[0]);
          grad.addColorStop(1, METEOR_COLORS[1]);
          ctx.globalAlpha = Math.max(0, m.life);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * 12, m.y - m.vy * 12);
          ctx.stroke();
          ctx.globalAlpha = 1;
          m.x += m.vx; m.y += m.vy; m.life -= 0.012;
          if (m.life <= 0 || m.x < -50 || m.y > h + 50) {
            meteor = null;
            nextMeteor = t + 6000 + Math.random() * 9000;
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [density]);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
