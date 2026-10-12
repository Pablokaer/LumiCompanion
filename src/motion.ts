/**
 * One motion engine for the star's body. Every kind of background movement (floating, breathing,
 * bouncing, shaking, dancing) is a "layer" that gives a pose offset for a point in time. The engine
 * blends the layers with weights that glide toward the current state, so going from idle to asleep to
 * dancing is a smooth crossfade instead of one animation snapping to the next.
 */
import type { DancePose } from './dance';

export type BaseMotion = 'float' | 'slowFloat' | 'thinkFloat' | 'breathe' | 'bounce' | 'shake' | 'dance';

export const BASE_MOTIONS: BaseMotion[] = ['float', 'slowFloat', 'thinkFloat', 'breathe', 'bounce', 'shake', 'dance'];

export type Weights = Record<BaseMotion, number>;

export interface Pose {
  x: number;
  y: number;
  /** Degrees. */
  rot: number;
  sx: number;
  sy: number;
}

export const NEUTRAL: Pose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };

/** Seconds for a weight to cover about 63% of the way to its target. */
export const BLEND_SECONDS = 0.3;

export const initialWeights = (target: BaseMotion): Weights =>
  Object.fromEntries(BASE_MOTIONS.map((m) => [m, m === target ? 1 : 0])) as Weights;

/** Moves every weight toward the target layer. Weights keep summing to 1. */
export function easeWeights(w: Weights, target: BaseMotion, dtSeconds: number, tau = BLEND_SECONDS): void {
  const k = 1 - Math.exp(-Math.max(0, dtSeconds) / tau);
  for (const m of BASE_MOTIONS) w[m] += ((m === target ? 1 : 0) - w[m]) * k;
}

/** 0 → 1 → 0 smoothly over each period. */
const ripple = (t: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);

const ZERO: Pose = { x: 0, y: 0, rot: 0, sx: 0, sy: 0 };

/** How far a layer moves the star from neutral at time `t` (seconds). `dance` supplies the beat-synced pose. */
export function layerOffset(m: BaseMotion, t: number, dance?: DancePose): Pose {
  switch (m) {
    case 'float': return { ...ZERO, y: -6 * ripple(t, 4), rot: -3 * ripple(t, 4) };
    case 'slowFloat': return { ...ZERO, y: -6 * ripple(t, 7), rot: -3 * ripple(t, 7) };
    case 'thinkFloat': return { ...ZERO, y: -6 * ripple(t, 2.4), rot: -3 * ripple(t, 2.4) };
    case 'breathe': return { ...ZERO, y: ripple(t, 4), sx: 0.04 * ripple(t, 4), sy: 0.04 * ripple(t, 4) };
    case 'bounce': return { ...ZERO, y: -9 * ripple(t, 0.9), sx: 0.04 * ripple(t, 0.9), sy: -0.03 * ripple(t, 0.9) };
    case 'shake': return { ...ZERO, rot: 6 * Math.sin((2 * Math.PI * t) / 0.5), y: -3 * ripple(t, 4) };
    case 'dance':
      return dance ? { x: dance.x, y: dance.y, rot: dance.rot, sx: dance.sx - 1, sy: dance.sy - 1 } : ZERO;
  }
}

/** The blended pose for the current weights. */
export function blendPose(w: Weights, t: number, dance?: DancePose): Pose {
  const p: Pose = { ...NEUTRAL };
  for (const m of BASE_MOTIONS) {
    const weight = w[m];
    if (weight < 1e-4) continue;
    const o = layerOffset(m, t, dance);
    p.x += weight * o.x;
    p.y += weight * o.y;
    p.rot += weight * o.rot;
    p.sx += weight * o.sx;
    p.sy += weight * o.sy;
  }
  return p;
}

export const poseToCss = (p: Pose) => `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${p.sx.toFixed(4)}, ${p.sy.toFixed(4)})`;
