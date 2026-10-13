// Injected before the page runs (see visual-shots.cjs). Makes the animation deterministic: a fake
// performance.now()/requestAnimationFrame that only moves when the screenshot tool steps it, and a seeded Math.random().
(() => {
  let seed = 12345;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let T = 5000;
  let queue = [];
  let nextId = 1;
  performance.now = () => T;
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { queue = queue.filter((q) => q[0] !== id); };
  window.__frames = 0;
  /** Advances fake time by `ms` in display-sized steps, running the queued animation frames. */
  window.__advance = (ms, step = 1000 / 60) => {
    const end = T + ms;
    while (T < end) {
      T = Math.min(end, T + step);
      const run = queue; queue = [];
      for (const [, cb] of run) cb(T);
      window.__frames++;
    }
  };
  /** Freezes every CSS animation at a fixed point so frames can be compared pixel by pixel. */
  window.__freezeCss = (t = 1000) => {
    for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = t; } catch { /* ignore */ } }
  };
})();
