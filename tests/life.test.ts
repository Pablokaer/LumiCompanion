import { describe, expect, it } from 'vitest';
import { IDLE_ACTIONS, nextDelayMs, pickAction, sleepThresholdSeconds } from '../src/behavior';
import { BEATS_PER_MOVE, dancePose, MOVES, moveFor } from '../src/dance';

/** A deterministic pseudo-random generator. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe('spontaneous behaviour', () => {
  it('never repeats the previous action', () => {
    const rand = rng(3);
    let last: ReturnType<typeof pickAction>['action'] | undefined;
    for (let i = 0; i < 300; i++) {
      const { action } = pickAction(rand, last);
      expect(action).not.toBe(last);
      last = action;
    }
  });

  it('uses every action over time, favouring the common ones', () => {
    const rand = rng(11);
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) { const { action } = pickAction(rand); counts.set(action, (counts.get(action) ?? 0) + 1); }
    expect([...counts.keys()].sort()).toEqual(IDLE_ACTIONS.map((a) => a.action).sort());
    expect(counts.get('smile')!).toBeGreaterThan(counts.get('spin')!);
  });

  it('returns the duration of the chosen action, and survives extreme random values', () => {
    expect(pickAction(() => 0).durationMs).toBeGreaterThan(0);
    expect(pickAction(() => 0.9999999).durationMs).toBeGreaterThan(0);
    expect(IDLE_ACTIONS.every((a) => a.ms >= 1000)).toBe(true);
  });

  it('keeps the pauses between actions short', () => {
    for (const r of [0, 0.5, 0.999]) {
      const d = nextDelayMs(() => r);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(6500);
    }
  });

  it('turns the sleep setting into seconds, with 0 meaning never', () => {
    expect(sleepThresholdSeconds(3)).toBe(180);
    expect(sleepThresholdSeconds(0)).toBe(Infinity);
  });
});

describe('dance', () => {
  it('cycles through every move, four beats each', () => {
    const seen = Array.from({ length: BEATS_PER_MOVE * MOVES.length }, (_, c) => moveFor(c));
    expect(new Set(seen)).toEqual(new Set(MOVES));
    expect(moveFor(0)).toBe(moveFor(BEATS_PER_MOVE - 1));
    expect(moveFor(0)).not.toBe(moveFor(BEATS_PER_MOVE));
    expect(moveFor(BEATS_PER_MOVE * MOVES.length)).toBe(moveFor(0));
    expect(moveFor(-1)).toBe(MOVES[MOVES.length - 1]);
  });

  it('keeps every pose inside sensible bounds for any beat and phase', () => {
    for (let count = 0; count < 32; count++) {
      for (let i = 0; i <= 20; i++) {
        const p = dancePose(i / 20, count);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(8);
        expect(p.y).toBeLessThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(-24);
        expect(p.sx).toBeGreaterThan(0.9);
        expect(p.sy).toBeGreaterThan(0.9);
        expect(p.armL).toBeGreaterThanOrEqual(0);
        expect(p.armR).toBeGreaterThanOrEqual(0);
        expect(p.rot).toBeGreaterThanOrEqual(0 - 12);
        expect(p.rot).toBeLessThanOrEqual(360);
      }
    }
  });

  it('lands on the ground at the start and end of each beat', () => {
    for (let count = 0; count < 16; count++) {
      expect(dancePose(0, count).y).toBeCloseTo(0, 5);
      expect(dancePose(1, count).y).toBeCloseTo(0, 5);
    }
  });

  it('completes the full spin exactly on the last beat of the twirl', () => {
    const twirl = MOVES.indexOf('twirl') * BEATS_PER_MOVE + (BEATS_PER_MOVE - 1);
    expect(dancePose(0, twirl).rot).toBeCloseTo(0, 5);
    expect(dancePose(0.5, twirl).rot).toBeCloseTo(180, 5);
    expect(dancePose(1, twirl).rot).toBeCloseTo(360, 5);
  });

  it('swings left and right on alternate beats when swaying', () => {
    const sway = MOVES.indexOf('sway') * BEATS_PER_MOVE;
    expect(dancePose(0.5, sway).rot).toBeGreaterThan(5);
    expect(dancePose(0.5, sway + 1).rot).toBeLessThan(-5);
  });
});
