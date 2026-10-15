import { describe, expect, it } from 'vitest';
import { dancePose } from '../src/dance';
import { REACTION_MS } from '../src/interaction';
import {
  aimTarget, BASE_MOTIONS, BITE_PERIOD, biteSnap, blendPose, easeWeights, initialWeights, layerOffset, NEUTRAL, poseToCss, smoothAim, type BaseMotion, type Pose,
} from '../src/motion';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
const FRAME = 1 / 60;

/** Runs the engine for `seconds` while the target changes, returning the pose at every frame. */
function simulate(steps: { target: BaseMotion; seconds: number }[], danceAt = (t: number) => dancePose(((t / 0.5) % 1 + 1) % 1, Math.floor(t / 0.5))) {
  const w = initialWeights(steps[0].target);
  const poses: Pose[] = [];
  let t = 0;
  for (const step of steps) {
    for (let i = 0; i < Math.round(step.seconds / FRAME); i++) {
      easeWeights(w, step.target, FRAME);
      poses.push(blendPose(w, t, danceAt(t)));
      t += FRAME;
    }
  }
  return { poses, w };
}

const maxStep = (poses: Pose[], key: keyof Pose, from = 1) =>
  Math.max(...poses.slice(from).map((p, i) => Math.abs(p[key] - poses[i + from - 1][key])));

describe('weights', () => {
  it('start fully on the chosen motion', () => {
    const w = initialWeights('breathe');
    expect(w.breathe).toBe(1);
    expect(sum(w)).toBe(1);
  });

  it('glide toward a new target, keep summing to 1, and never overshoot', () => {
    const w = initialWeights('float');
    let previous = 0;
    for (let i = 0; i < 120; i++) {
      easeWeights(w, 'dance', FRAME);
      expect(sum(w)).toBeCloseTo(1, 9);
      expect(w.dance).toBeGreaterThanOrEqual(previous);
      expect(w.dance).toBeLessThanOrEqual(1);
      previous = w.dance;
    }
    expect(w.dance).toBeGreaterThan(0.97); // ~2 s is plenty
    expect(w.float).toBeLessThan(0.03);
  });

  it('take a visible moment, not a single frame', () => {
    const w = initialWeights('float');
    easeWeights(w, 'dance', FRAME);
    expect(w.dance).toBeLessThan(0.1);
  });

  it('ignore negative time steps', () => {
    const w = initialWeights('float');
    easeWeights(w, 'dance', -1);
    expect(w.float).toBe(1);
  });
});

describe('blending', () => {
  it('equals the layer when its weight is 1, and neutral for an empty dance', () => {
    const w = initialWeights('float');
    const p = blendPose(w, 1.3);
    const o = layerOffset('float', 1.3);
    expect(p.y).toBeCloseTo(NEUTRAL.y + o.y, 9);
    expect(p.rot).toBeCloseTo(o.rot, 9);
    expect(blendPose(initialWeights('dance'), 5)).toEqual(NEUTRAL);
  });

  it('keeps every layer inside sensible bounds', () => {
    for (const m of BASE_MOTIONS) {
      for (let t = 0; t < 8; t += 0.05) {
        const p = blendPose(initialWeights(m), t, dancePose((t / 0.5) % 1, Math.floor(t / 0.5)));
        expect(Math.abs(p.y)).toBeLessThanOrEqual(24);
        expect(p.sx).toBeGreaterThan(0.85);
        expect(p.sy).toBeGreaterThan(0.85);
      }
    }
  });

  it('formats a CSS transform', () => {
    expect(poseToCss(NEUTRAL)).toBe('translate(0.00px, 0.00px) rotate(0.00deg) scale(1.0000, 1.0000)');
  });
});

describe('transitions are smooth', () => {
  it('idle → asleep → awake never jumps between frames', () => {
    const { poses } = simulate([{ target: 'float', seconds: 2 }, { target: 'breathe', seconds: 3 }, { target: 'float', seconds: 3 }]);
    // A hard cut would move the star by ~6 px / ~3° in one frame; the glide is at most a few tenths.
    expect(maxStep(poses, 'y')).toBeLessThan(0.5);
    expect(maxStep(poses, 'rot')).toBeLessThan(0.3);
    expect(maxStep(poses, 'sy')).toBeLessThan(0.005);
  });

  it('happy bounce → alert shake → thinking stays continuous', () => {
    const { poses } = simulate([{ target: 'bounce', seconds: 1 }, { target: 'shake', seconds: 2 }, { target: 'thinkFloat', seconds: 2 }]);
    expect(maxStep(poses, 'y')).toBeLessThan(1);
    expect(maxStep(poses, 'rot')).toBeLessThan(1.4); // shaking itself moves up to ~1.26° per frame
  });

  it('idle → dance → idle eases in and out (no snap when the music starts or stops)', () => {
    // A bouncing dance with no beat impact, so only the blending is measured.
    const calmDance = () => ({ move: 'bounce' as const, x: 0, y: -6, rot: 0, sx: 1, sy: 1, armL: 0, armR: 0 });
    const { poses } = simulate([{ target: 'float', seconds: 1 }, { target: 'dance', seconds: 2 }, { target: 'float', seconds: 2 }], calmDance);
    expect(maxStep(poses, 'y')).toBeLessThan(0.5);
    // ...and once the dance is gone she is back to ordinary floating (within the float range).
    const last = poses[poses.length - 1];
    expect(last.y).toBeLessThanOrEqual(0);
    expect(last.y).toBeGreaterThanOrEqual(-6.5);
  });

  it('the real choreography only moves as fast as the beat dictates while blending in', () => {
    const { poses } = simulate([{ target: 'float', seconds: 0.5 }, { target: 'dance', seconds: 3 }]);
    expect(maxStep(poses, 'y')).toBeLessThan(2.5); // 12–22 px hops over half a beat at 120 BPM
    expect(maxStep(poses, 'x')).toBeLessThan(1);
  });
});

describe('reaction layers', () => {
  const at = (m: BaseMotion, ctx: { aimX?: number; aimY?: number; since?: number }, t = 3) => layerOffset(m, t, ctx);

  it('start from rest, so a reaction fades in without a jump', () => {
    expect(at('giggle', { since: 0 }, 0).y).toBeCloseTo(0, 6);
    expect(at('giggle', { since: 0 }, 0).rot).toBeCloseTo(0, 6);
    expect(at('bite', { aimX: 1, since: 0 }).x).toBeCloseTo(0, 6);
  });

  it('bite lunges toward the cursor, hits full reach, and retreats', () => {
    const right = (since: number) => at('bite', { aimX: 1, aimY: 0, since }).x;
    expect(right(BITE_PERIOD * 0.3)).toBeCloseTo(13, 5); // fully extended
    expect(right(BITE_PERIOD * 0.95)).toBeLessThan(2); // pulled back
    expect(at('bite', { aimX: -1, since: BITE_PERIOD * 0.3 }).x).toBeCloseTo(-13, 5); // toward whichever side the cursor is
    expect(at('bite', { aimX: 0, aimY: 1, since: BITE_PERIOD * 0.3 }).y).toBeGreaterThan(8); // lunges down at a cursor below
    expect(biteSnap(BITE_PERIOD * 0.3)).toBe(1);
    expect(biteSnap(0)).toBe(0);
    expect(biteSnap(BITE_PERIOD)).toBeCloseTo(0, 9); // each bite starts and ends at rest
  });

  it('snaps repeatedly: three lunges in the length of a bite reaction', () => {
    let lunges = 0, was = 0;
    for (let s = 0; s < REACTION_MS.bite / 1000; s += 0.01) { const v = biteSnap(s); if (v > 0.9 && was <= 0.9) lunges++; was = v; }
    expect(lunges).toBe(3);
  });

  it('purr leans into the cursor', () => {
    expect(at('purr', { aimX: 1 }).x).toBeGreaterThan(3);
    expect(at('purr', { aimX: -1 }).x).toBeLessThan(-3);
  });

  it('stay inside sensible bounds', () => {
    for (const m of ['giggle', 'purr', 'bite'] as BaseMotion[]) {
      for (let s = 0; s < 4; s += 0.037) {
        const p = blendPose(initialWeights(m), 5 + s, undefined, { aimX: 0.6, aimY: -0.8, since: s });
        expect(Math.abs(p.x)).toBeLessThanOrEqual(14);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(10);
        expect(Math.abs(p.rot)).toBeLessThanOrEqual(12);
        expect(p.sx).toBeGreaterThan(0.88);
        expect(p.sy).toBeGreaterThan(0.88);
      }
    }
  });

  it('blend smoothly from idle into a bite', () => {
    const w = initialWeights('float');
    let prev = blendPose(w, 0, undefined, { aimX: 1, since: 0 });
    let maxStep = 0;
    for (let i = 1; i < 120; i++) {
      easeWeights(w, 'bite', FRAME);
      const p = blendPose(w, i * FRAME, undefined, { aimX: 1, since: i * FRAME });
      maxStep = Math.max(maxStep, Math.abs(p.x - prev.x));
      prev = p;
    }
    expect(maxStep).toBeLessThan(2.5); // a 13 px lunge in a quarter of a bite period is ~4 px per frame at full weight; blending softens it
  });
});

describe('smoothness of the reactions', () => {
  it('the lean direction fades out near her centre instead of flipping sign abruptly', () => {
    // A mouse crossing right through her: dx goes from -100 to +100 at 1 px per step.
    let prev = aimTarget(-100, 0).x;
    let maxStep = 0;
    for (let dx = -99; dx <= 100; dx++) {
      const a = aimTarget(dx, 0).x;
      maxStep = Math.max(maxStep, Math.abs(a - prev));
      prev = a;
    }
    expect(maxStep).toBeLessThan(0.1); // a raw unit vector would jump from -1 to +1 in one step
    expect(aimTarget(0, 0)).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(aimTarget(2, 0).x, aimTarget(2, 0).y)).toBeLessThan(0.05); // right on top of her: no lean
    expect(aimTarget(200, 0).x).toBeCloseTo(1, 6); // far away: full lean
  });

  it('eases the lean toward its target', () => {
    const aim = { x: 0, y: 0 };
    smoothAim(aim, { x: 1, y: 0 }, 1 / 60);
    expect(aim.x).toBeGreaterThan(0);
    expect(aim.x).toBeLessThan(0.15); // one frame covers a small part of the way
    for (let i = 0; i < 120; i++) smoothAim(aim, { x: 1, y: 0 }, 1 / 60);
    expect(aim.x).toBeGreaterThan(0.99);
  });

  it('weights start moving gently (a spring), not with a jolt', () => {
    const w = initialWeights('float');
    const history: number[] = [];
    for (let i = 0; i < 90; i++) { easeWeights(w, 'bite', FRAME); history.push(w.bite); }
    const velocity = history.map((v, i) => (i ? v - history[i - 1] : v));
    expect(velocity[0]).toBeLessThan(velocity[10]); // accelerates from rest
    expect(velocity[0]).toBeLessThan(0.01); // a plain exponential ease would cover ~5% in its first frame
    for (let i = 1; i < history.length; i++) expect(history[i]).toBeGreaterThanOrEqual(history[i - 1] - 1e-9); // monotonic, no overshoot
    expect(history[history.length - 1]).toBeGreaterThan(0.98);
  });

  it('keeps the weights a valid blend even when the target changes mid-flight', () => {
    const w = initialWeights('float');
    const targets: BaseMotion[] = ['bite', 'purr', 'dance', 'giggle', 'float', 'bite'];
    for (let i = 0; i < 600; i++) {
      easeWeights(w, targets[Math.floor(i / 40) % targets.length], FRAME);
      const total = Object.values(w).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
      for (const v of Object.values(w)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
    }
  });

  it('the bite snap has no corners: it is continuous and its slope is continuous too', () => {
    let maxStep = 0, maxSlopeChange = 0, prev = biteSnap(0), prevStep = 0;
    for (let s = 0.0005; s < BITE_PERIOD * 3; s += 0.0005) {
      const v = biteSnap(s);
      const step = v - prev;
      maxStep = Math.max(maxStep, Math.abs(step));
      maxSlopeChange = Math.max(maxSlopeChange, Math.abs(step - prevStep));
      prev = v; prevStep = step;
    }
    expect(maxStep).toBeLessThan(0.02); // no jump
    expect(maxSlopeChange).toBeLessThan(0.0008); // no abrupt change of speed
  });

  it('the giggle builds up from rest and never jumps', () => {
    expect(layerOffset('giggle', 0, { since: 0 }).rot).toBeCloseTo(0, 9);
    let prev = layerOffset('giggle', 0, { since: 0 });
    let maxRot = 0, maxY = 0;
    for (let s = 0.005; s < 2; s += 0.005) {
      const o = layerOffset('giggle', s, { since: s });
      maxRot = Math.max(maxRot, Math.abs(o.rot - prev.rot));
      maxY = Math.max(maxY, Math.abs(o.y - prev.y));
      prev = o;
    }
    expect(maxRot).toBeLessThan(0.45); // 5 ms steps: a 3° swing at 4 Hz moves ~0.38° per step, so this is just the wave itself
    expect(maxY).toBeLessThan(0.45);
  });
});
