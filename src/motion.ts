/**
 * One motion engine for the star's body. Every kind of background movement (floating, breathing,
 * bouncing, shaking, dancing) is a "layer" that gives a pose offset for a point in time. The engine
 * blends the layers with weights that glide toward the current state, so going from idle to asleep to
 * dancing is a smooth crossfade instead of one animation snapping to the next.
 */
import type { DancePose } from './dance';

export type BaseMotion = 'float' | 'slowFloat' | 'thinkFloat' | 'breathe' | 'bounce' | 'shake' | 'dance' | 'giggle' | 'purr' | 'bite';

export const BASE_MOTIONS: BaseMotion[] = ['float', 'slowFloat', 'thinkFloat', 'breathe', 'bounce', 'shake', 'dance', 'giggle', 'purr', 'bite'];

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

const velocities = new WeakMap<Weights, Record<BaseMotion, number>>();

/**
 * Moves every weight toward the target layer with a critically damped spring: no overshoot, and, unlike
 * a plain exponential ease, no sudden start (the velocity builds up smoothly). Weights keep summing to 1.
 */
export function easeWeights(w: Weights, target: BaseMotion, dtSeconds: number, tau = BLEND_SECONDS): void {
  let v = velocities.get(w);
  if (!v) { v = Object.fromEntries(BASE_MOTIONS.map((m) => [m, 0])) as Record<BaseMotion, number>; velocities.set(w, v); }
  const omega = 1.4 / tau;
  let remaining = Math.max(0, dtSeconds);
  while (remaining > 1e-9) {
    const h = Math.min(0.02, remaining); // small steps keep the integration stable
    remaining -= h;
    for (const m of BASE_MOTIONS) {
      const x = w[m] - (m === target ? 1 : 0);
      v[m] += (-omega * omega * x - 2 * omega * v[m]) * h;
      w[m] += v[m] * h;
    }
  }
  // a change of target mid-flight can nudge a weight slightly out of range; keep them a proper blend
  let sum = 0;
  for (const m of BASE_MOTIONS) { w[m] = Math.min(1, Math.max(0, w[m])); sum += w[m]; }
  if (sum > 0) for (const m of BASE_MOTIONS) w[m] /= sum;
}

const smoothstep = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** Within this many pixels of her centre the cursor has no meaningful "direction", so the lean fades out. */
const AIM_FADE_PX = 24;

/** The lean direction for a cursor `dx`,`dy` pixels away: a unit vector that fades to nothing at the centre, so it never flips abruptly. */
export function aimTarget(dx: number, dy: number): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { x: 0, y: 0 };
  const strength = smoothstep(dist / AIM_FADE_PX);
  return { x: (dx / dist) * strength, y: (dy / dist) * strength };
}

/** Eases the lean toward its target so even a fast mouse cannot make her twitch. */
export function smoothAim(aim: { x: number; y: number }, target: { x: number; y: number }, dtSeconds: number, tau = 0.14): void {
  const k = 1 - Math.exp(-Math.max(0, dtSeconds) / tau);
  aim.x += (target.x - aim.x) * k;
  aim.y += (target.y - aim.y) * k;
}

/** 0 → 1 → 0 smoothly over each period. */
const ripple = (t: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);

const ZERO: Pose = { x: 0, y: 0, rot: 0, sx: 0, sy: 0 };

/** Extra information the reaction layers need. */
export interface MotionContext {
  dance?: DancePose;
  /** Unit vector from the star toward the mouse cursor (0,0 when unknown). */
  aimX?: number;
  aimY?: number;
  /** Seconds since the current reaction began. */
  since?: number;
}

/** Period of one bite (lunge and retreat), in seconds. */
export const BITE_PERIOD = 0.55;

/** 0 → 1 quickly, holds, then back to 0: one snap of the jaws. Eased at both ends, so it has no corners. */
export function biteSnap(since: number): number {
  const p = (((since % BITE_PERIOD) + BITE_PERIOD) % BITE_PERIOD) / BITE_PERIOD;
  if (p < 0.25) return smoothstep(p / 0.25);
  if (p < 0.4) return 1;
  return 1 - smoothstep((p - 0.4) / 0.6);
}

/** How far a layer moves the star from neutral at time `t` (seconds). `dance` supplies the beat-synced pose. */
export function layerOffset(m: BaseMotion, t: number, ctx: MotionContext = {}): Pose {
  const { dance, aimX = 0, aimY = 0, since = 0 } = ctx;
  switch (m) {
    case 'float': return { ...ZERO, y: -6 * ripple(t, 4), rot: -3 * ripple(t, 4) };
    case 'slowFloat': return { ...ZERO, y: -6 * ripple(t, 7), rot: -3 * ripple(t, 7) };
    case 'thinkFloat': return { ...ZERO, y: -6 * ripple(t, 2.4), rot: -3 * ripple(t, 2.4) };
    case 'breathe': return { ...ZERO, y: ripple(t, 4), sx: 0.04 * ripple(t, 4), sy: 0.04 * ripple(t, 4) };
    case 'bounce': return { ...ZERO, y: -9 * ripple(t, 0.9), sx: 0.04 * ripple(t, 0.9), sy: -0.03 * ripple(t, 0.9) };
    case 'shake': return { ...ZERO, rot: 6 * Math.sin((2 * Math.PI * t) / 0.5), y: -3 * ripple(t, 4) };
    case 'dance':
      return dance ? { x: dance.x, y: dance.y, rot: dance.rot, sx: dance.sx - 1, sy: dance.sy - 1 } : ZERO;
    case 'giggle': { // shaking and hopping like laughing out loud, building up gently and without sharp turns
      const ramp = smoothstep(since / 0.3);
      const wave = Math.sin(2 * Math.PI * 4 * since);
      const hop = Math.sin(Math.PI * 4 * since) ** 2; // smooth bounce, no corner at the bottom
      return { ...ZERO, y: -3.5 * hop * ramp, rot: 3 * wave * ramp, sy: -0.025 * hop * ramp, sx: 0.015 * hop * ramp };
    }
    case 'purr': // leans into the cursor, swaying slowly
      return { x: aimX * 4, y: -1.5 * ripple(t, 1.6) - aimY * 1.5, rot: aimX * 5 + 2.5 * Math.sin(2 * Math.PI * 0.6 * t), sx: 0.02 * ripple(t, 0.8), sy: -0.015 * ripple(t, 0.8) };
    case 'bite': { // lunges at the cursor over and over
      const snap = biteSnap(since);
      return { x: aimX * 13 * snap, y: aimY * 9 * snap, rot: aimX * 8 * snap, sx: 0.08 * snap, sy: -0.05 * snap };
    }
  }
}

/** The blended pose for the current weights. */
export function blendPose(w: Weights, t: number, dance?: DancePose, ctx: Omit<MotionContext, 'dance'> = {}): Pose {
  const p: Pose = { ...NEUTRAL };
  for (const m of BASE_MOTIONS) {
    const weight = w[m];
    if (weight < 1e-4) continue;
    const o = layerOffset(m, t, { ...ctx, dance });
    p.x += weight * o.x;
    p.y += weight * o.y;
    p.rot += weight * o.rot;
    p.sx += weight * o.sx;
    p.sy += weight * o.sy;
  }
  return p;
}

export const poseToCss = (p: Pose) => `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) rotate(${p.rot.toFixed(2)}deg) scale(${p.sx.toFixed(4)}, ${p.sy.toFixed(4)})`;
