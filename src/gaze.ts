/**
 * Where the star's eyes look, and when she blinks. Pure controllers (driven by the mascot's animation
 * loop) so the behaviour can be unit tested with a seeded random generator.
 */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** How far a pupil can move inside the eye, in the mascot's drawing units. The white is 18 wide and 22 tall. */
export const MAX_X = 2.8;
export const MAX_UP = 5;
export const MAX_DOWN = 3.5;

/** The pointer, in window coordinates. Updated outside React so the animation loop can read it every frame. */
export const pointer = { x: 0, y: 0, at: 0, known: false };

export function setPointer(x: number, y: number, now: number) {
  if (!pointer.known || x !== pointer.x || y !== pointer.y) pointer.at = now;
  pointer.x = x;
  pointer.y = y;
  pointer.known = true;
}

export interface Gaze { x: number; y: number }

/** Where the pupils point for a cursor `dx`,`dy` pixels away from the eyes. `near` is 0–1, how close it is. */
export function gazeToward(dx: number, dy: number): Gaze & { near: number } {
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: 0, y: 0, near: 1 };
  const reach = Math.min(1, dist / 160); // leans fully once the cursor is ~160 px away
  const ux = dx / dist, uy = dy / dist;
  return {
    x: ux * reach * MAX_X,
    y: uy * reach * (uy < 0 ? MAX_UP : MAX_DOWN),
    near: clamp(1 - dist / 120, 0, 1),
  };
}

export const FOLLOW_FOR_MS = 5000;

export interface GazeInput {
  /** Cursor relative to the eyes, in pixels; undefined until the pointer has been seen. */
  cursor?: { dx: number; dy: number };
  /** Milliseconds since the cursor last moved. */
  cursorIdleMs: number;
  /** The "eyes follow the mouse" setting. */
  follow: boolean;
  /** A reminder is on: she stares straight ahead. */
  alert: boolean;
  /** 'avert': looks away from the cursor (shy). 'lock': fixes on it intently (about to bite). */
  mode?: 'avert' | 'lock';
}

/**
 * Eyes that follow the mouse while it moves, and wander on their own when it rests: quick glances to
 * the sides, up and down, now and then back toward the cursor, plus tiny involuntary movements.
 */
export class GazeController {
  x = 0;
  y = 0;
  /** 0–1: the cursor is close, so the pupils widen a little. */
  near = 0;
  private tx = 0;
  private ty = 0;
  private shiftAt = 0;
  private jitterAt = 0;
  private jx = 0;
  private jy = 0;
  private dilation = 0;

  constructor(private rand: () => number = Math.random) {}

  update(dtSec: number, nowMs: number, input: GazeInput): Gaze & { near: number } {
    const following = input.follow && !!input.cursor && input.cursorIdleMs < FOLLOW_FOR_MS;
    let tau = 0.07;
    let nearTarget = 0;

    if (input.alert) {
      this.tx = 0; this.ty = 0; tau = 0.12;
    } else if (input.mode === 'avert') {
      // looks away from the cursor and a little down, embarrassed
      const away = input.cursor ? -Math.sign(input.cursor.dx || 1) : 1;
      this.tx = away * MAX_X * 0.9; this.ty = MAX_DOWN * 0.6; tau = 0.1;
      this.shiftAt = nowMs + 400;
    } else if (input.mode === 'lock' && input.cursor) {
      const g = gazeToward(input.cursor.dx, input.cursor.dy);
      this.tx = g.x; this.ty = g.y; nearTarget = 1; tau = 0.08;
      this.shiftAt = nowMs + 400;
    } else if (following) {
      const g = gazeToward(input.cursor!.dx, input.cursor!.dy);
      this.tx = g.x; this.ty = g.y; nearTarget = g.near; tau = 0.09;
      this.shiftAt = nowMs + 400; // start wandering soon after the mouse comes to rest
    } else if (nowMs >= this.shiftAt) {
      this.pickWander(nowMs, input);
    }

    // tiny involuntary movements keep the eyes from ever looking frozen
    if (nowMs >= this.jitterAt) {
      this.jx = (this.rand() - 0.5) * 0.7;
      this.jy = (this.rand() - 0.5) * 0.7;
      this.jitterAt = nowMs + 350 + this.rand() * 500;
    }

    const k = 1 - Math.exp(-Math.max(0, dtSec) / tau);
    const steady = input.alert || input.mode === 'lock'; // no fidgeting while staring or locked on
    this.x += (clamp(this.tx + (steady ? 0 : this.jx), -MAX_X, MAX_X) - this.x) * k;
    this.y += (clamp(this.ty + (steady ? 0 : this.jy), -MAX_UP, MAX_DOWN) - this.y) * k;
    this.dilation += (nearTarget - this.dilation) * (1 - Math.exp(-Math.max(0, dtSec) / 0.25));
    this.near = this.dilation;
    return { x: this.x, y: this.y, near: this.near };
  }

  private pickWander(nowMs: number, input: GazeInput) {
    const r = this.rand();
    const side = this.rand() < 0.5 ? -1 : 1;
    if (r < 0.35) { // a small drift near the middle
      this.tx = (this.rand() - 0.5) * 2.4; this.ty = (this.rand() - 0.5) * 2;
    } else if (r < 0.65) { // glance to one side
      this.tx = side * MAX_X * (0.85 + this.rand() * 0.15); this.ty = (this.rand() - 0.5) * 1.5;
    } else if (r < 0.8) { // look up
      this.tx = side * this.rand() * 1.5; this.ty = -MAX_UP * (0.7 + this.rand() * 0.3);
    } else if (r < 0.9) { // look down
      this.tx = side * this.rand() * 1.5; this.ty = MAX_DOWN * (0.8 + this.rand() * 0.2);
    } else if (input.cursor) { // check on the cursor again
      const g = gazeToward(input.cursor.dx, input.cursor.dy);
      this.tx = g.x; this.ty = g.y;
    } else {
      this.tx = 0; this.ty = 0;
    }
    this.shiftAt = nowMs + 700 + this.rand() * 2800;
  }
}

/** Random blinks, with the occasional double blink. */
export class BlinkController {
  private starts: number[] = [];
  private nextAt = 0;

  constructor(private rand: () => number = Math.random) {}

  static readonly DURATION_MS = 150;

  /** 0 = eyes fully open, 1 = fully closed. */
  update(nowMs: number): number {
    if (!this.nextAt) this.nextAt = nowMs + 1000 + this.rand() * 2000;
    if (nowMs >= this.nextAt) {
      this.starts.push(this.nextAt);
      if (this.rand() < 0.15) this.starts.push(this.nextAt + 330); // a double blink
      this.nextAt = nowMs + 2000 + this.rand() * 4500;
    }
    let closure = 0;
    this.starts = this.starts.filter((s) => nowMs - s < BlinkController.DURATION_MS);
    for (const s of this.starts) {
      const t = (nowMs - s) / BlinkController.DURATION_MS;
      if (t < 0) continue;
      closure = Math.max(closure, t < 0.45 ? t / 0.45 : (1 - t) / 0.55);
    }
    return clamp(closure, 0, 1);
  }
}
