import { describe, expect, it } from 'vitest';
import { dancePose } from '../src/dance';
import {
  BASE_MOTIONS, blendPose, easeWeights, initialWeights, layerOffset, NEUTRAL, poseToCss, type BaseMotion, type Pose,
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
