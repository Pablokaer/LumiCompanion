import { describe, expect, it } from 'vitest';
import {
  BlinkController, FOLLOW_FOR_MS, GazeController, gazeToward, MAX_DOWN, MAX_UP, MAX_X, pointer, setPointer,
} from '../src/gaze';

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const FRAME = 1 / 60;

/** Runs the controller for `seconds`, calling `input(t)` each frame, and returns every gaze it produced. */
function run(g: GazeController, seconds: number, input: (tMs: number) => Parameters<GazeController['update']>[2], startMs = 0) {
  const out: { x: number; y: number; near: number; t: number }[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const t = startMs + i * FRAME * 1000;
    out.push({ ...g.update(FRAME, t, input(t)), t });
  }
  return out;
}

describe('looking toward the cursor', () => {
  it('points the pupils the way the cursor is', () => {
    expect(gazeToward(200, 0).x).toBeGreaterThan(2);
    expect(gazeToward(-200, 0).x).toBeLessThan(-2);
    expect(gazeToward(0, -200).y).toBeLessThan(-3);
    expect(gazeToward(0, 200).y).toBeGreaterThan(2);
  });

  it('never moves a pupil outside the eye, however far the cursor is', () => {
    for (const [dx, dy] of [[1e5, 0], [-1e5, 0], [0, 1e5], [0, -1e5], [3000, -3000], [-3, 4], [0.2, 0.1]]) {
      const g = gazeToward(dx, dy);
      expect(Math.abs(g.x)).toBeLessThanOrEqual(MAX_X + 1e-9);
      expect(g.y).toBeGreaterThanOrEqual(-MAX_UP - 1e-9);
      expect(g.y).toBeLessThanOrEqual(MAX_DOWN + 1e-9);
    }
  });

  it('leans harder the further away the cursor is, and centres when it is on top of the eyes', () => {
    expect(Math.abs(gazeToward(40, 0).x)).toBeLessThan(Math.abs(gazeToward(150, 0).x));
    expect(gazeToward(0.2, 0.2)).toEqual({ x: 0, y: 0, near: 1 });
  });

  it('widens the pupils when the cursor is close', () => {
    expect(gazeToward(30, 0).near).toBeGreaterThan(0.6);
    expect(gazeToward(400, 0).near).toBe(0);
  });
});

describe('gaze controller', () => {
  const follow = (dx: number, dy: number, idle = 0) => () => ({ cursor: { dx, dy }, cursorIdleMs: idle, follow: true, alert: false });

  it('follows a moving cursor smoothly and settles on it', () => {
    const g = new GazeController(rng(1));
    const frames = run(g, 1.5, follow(300, 0));
    expect(frames[frames.length - 1].x).toBeGreaterThan(2.2);
    // smooth: no frame jumps more than a pupil-width fraction
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, Math.abs(frames[i].x - frames[i - 1].x));
    expect(maxStep).toBeLessThan(0.7);
  });

  it('switches sides when the cursor does', () => {
    const g = new GazeController(rng(2));
    run(g, 1, follow(300, 0));
    expect(g.x).toBeGreaterThan(1.5);
    run(g, 1, follow(-300, 0), 1000);
    expect(g.x).toBeLessThan(-1.5);
  });

  it('stays inside the eye in every situation', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = new GazeController(rng(seed));
      for (const f of run(g, 30, (t) => ({ cursor: { dx: Math.sin(t / 700) * 900, dy: Math.cos(t / 500) * 900 }, cursorIdleMs: t % 12000, follow: true, alert: false }))) {
        expect(Math.abs(f.x)).toBeLessThanOrEqual(MAX_X + 1e-6);
        expect(f.y).toBeGreaterThanOrEqual(-MAX_UP - 1e-6);
        expect(f.y).toBeLessThanOrEqual(MAX_DOWN + 1e-6);
      }
    }
  });

  it('wanders by itself once the mouse has rested, looking in many directions', () => {
    const g = new GazeController(rng(7));
    const frames = run(g, 40, () => ({ cursor: { dx: 100, dy: 50 }, cursorIdleMs: FOLLOW_FOR_MS + 1, follow: true, alert: false }), 10_000);
    const xs = frames.map((f) => f.x), ys = frames.map((f) => f.y);
    expect(Math.max(...xs)).toBeGreaterThan(1.8);
    expect(Math.min(...xs)).toBeLessThan(-1.8);
    expect(Math.min(...ys)).toBeLessThan(-2.5); // looks up at some point
    expect(Math.max(...ys)).toBeGreaterThan(1.5); // and down
  });

  it('wanders too when following is switched off or the pointer is unknown', () => {
    for (const input of [{ cursor: { dx: 300, dy: 0 }, cursorIdleMs: 0, follow: false, alert: false }, { cursorIdleMs: 0, follow: true, alert: false }]) {
      const g = new GazeController(rng(9));
      const frames = run(g, 30, () => input);
      expect(Math.max(...frames.map((f) => Math.abs(f.x)))).toBeGreaterThan(1.5);
    }
  });

  it('never looks frozen: tiny movements continue even while following a still cursor', () => {
    const g = new GazeController(rng(5));
    const frames = run(g, 6, follow(200, 0, 0)).slice(120);
    const xs = frames.map((f) => f.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.05);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1.2);
  });

  it('stares straight ahead during an alert', () => {
    const g = new GazeController(rng(3));
    const frames = run(g, 2, () => ({ cursor: { dx: 300, dy: 0 }, cursorIdleMs: 0, follow: true, alert: true }));
    expect(Math.abs(frames[frames.length - 1].x)).toBeLessThan(0.05);
  });

  it('widens the pupils as the cursor gets close and relaxes when it leaves', () => {
    const g = new GazeController(rng(4));
    run(g, 1.5, follow(25, 10));
    expect(g.near).toBeGreaterThan(0.5);
    run(g, 2, follow(500, 0), 1500);
    expect(g.near).toBeLessThan(0.05);
  });
});

describe('blinking', () => {
  it('blinks every few seconds, fully closing and reopening each time', () => {
    const b = new BlinkController(rng(11));
    const closure: number[] = [];
    for (let t = 0; t < 60_000; t += 8) closure.push(b.update(t));
    const blinks = closure.filter((v, i) => v > 0.9 && (closure[i - 1] ?? 0) <= 0.9).length;
    expect(blinks).toBeGreaterThanOrEqual(8);
    expect(blinks).toBeLessThanOrEqual(30);
    expect(Math.max(...closure)).toBeGreaterThan(0.95);
    expect(Math.min(...closure)).toBe(0);
    expect(closure.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('keeps her eyes open most of the time', () => {
    const b = new BlinkController(rng(21));
    let closed = 0, total = 0;
    for (let t = 0; t < 60_000; t += 8) { total++; if (b.update(t) > 0.3) closed++; }
    expect(closed / total).toBeLessThan(0.06);
  });

  it('sometimes blinks twice in a row, at irregular intervals', () => {
    const b = new BlinkController(rng(33));
    const starts: number[] = [];
    let prev = 0;
    for (let t = 0; t < 300_000; t += 8) { const v = b.update(t); if (v > 0.9 && prev <= 0.9) starts.push(t); prev = v; }
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    expect(gaps.some((g) => g < 600)).toBe(true); // double blinks
    expect(gaps.some((g) => g > 2500)).toBe(true);
    expect(new Set(gaps.map((g) => Math.round(g / 250))).size).toBeGreaterThan(5); // not a metronome
  });
});

describe('pointer store', () => {
  it('records when the pointer last moved', () => {
    setPointer(10, 20, 100);
    expect(pointer).toMatchObject({ x: 10, y: 20, at: 100, known: true });
    setPointer(10, 20, 500); // same place: not a move
    expect(pointer.at).toBe(100);
    setPointer(11, 20, 700);
    expect(pointer.at).toBe(700);
  });
});

describe('reaction gazes', () => {
  const input = (mode: 'avert' | 'lock' | undefined, dx: number, dy = 0) => () => ({ cursor: { dx, dy }, cursorIdleMs: 0, follow: true, alert: false, mode });

  it('looks away from the cursor when shy, and a little down', () => {
    const right = new GazeController(rng(1));
    run(right, 1, input('avert', 300));
    expect(right.x).toBeLessThan(-1.8);
    expect(right.y).toBeGreaterThan(1);
    const left = new GazeController(rng(1));
    run(left, 1, input('avert', -300));
    expect(left.x).toBeGreaterThan(1.8);
  });

  it('locks onto the cursor without fidgeting when about to bite', () => {
    const g = new GazeController(rng(2));
    const frames = run(g, 3, input('lock', 300, 0)).slice(60);
    const xs = frames.map((f) => f.x);
    expect(Math.min(...xs)).toBeGreaterThan(2.6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01);
    expect(g.near).toBeGreaterThan(0.8); // pupils widen
  });

  it('snaps to the target faster when locked than when following', () => {
    const lock = new GazeController(rng(3));
    const follow = new GazeController(rng(3));
    lock.update(0.05, 0, { cursor: { dx: 300, dy: 0 }, cursorIdleMs: 0, follow: true, alert: false, mode: 'lock' });
    follow.update(0.05, 0, { cursor: { dx: 300, dy: 0 }, cursorIdleMs: 0, follow: true, alert: false });
    expect(lock.x).toBeGreaterThan(follow.x);
  });
});
