import { describe, expect, it } from 'vitest';
import { FrameGate, isSlowMotion, targetFps, weightsSettled, type FrameRateState } from '../src/frameRate';

const still: FrameRateState = {
  hidden: false, sleeping: false, slowMotion: true, dancing: false, reacting: false, acting: false,
  easing: false, followingCursor: false, eyesBusy: false, expanded: false,
};
const with_ = (patch: Partial<FrameRateState>): FrameRateState => ({ ...still, ...patch });

describe('targetFps', () => {
  it('floats at 30 fps when nothing is going on', () => {
    expect(targetFps(still)).toBe(30);
  });

  it('keeps 60 fps for fast background movement (bouncing, shaking)', () => {
    expect(targetFps(with_({ slowMotion: false }))).toBe(60);
    expect(isSlowMotion('bounce')).toBe(false);
    expect(isSlowMotion('shake')).toBe(false);
    for (const m of ['float', 'slowFloat', 'thinkFloat', 'breathe'] as const) expect(isSlowMotion(m)).toBe(true);
  });

  it('sleeps at 15 fps', () => {
    expect(targetFps(with_({ sleeping: true }))).toBe(15);
  });

  it('is paused while hidden, whatever else is going on', () => {
    expect(targetFps(with_({ hidden: true }))).toBe(0);
    expect(targetFps(with_({ hidden: true, dancing: true, acting: true, expanded: true }))).toBe(0);
  });

  it.each(['dancing', 'reacting', 'acting', 'easing', 'followingCursor', 'expanded', 'eyesBusy'] as const)('runs at 60 fps while %s', (key) => {
    expect(targetFps(with_({ [key]: true }))).toBe(60);
  });

  it('never drops below 60 while dancing, reacting or acting, even asleep', () => {
    for (const key of ['dancing', 'reacting', 'acting'] as const) {
      expect(targetFps(with_({ [key]: true, sleeping: true }))).toBe(60);
    }
  });

  it('ignores blinks while asleep (her eyes are shut)', () => {
    expect(targetFps(with_({ sleeping: true, eyesBusy: true }))).toBe(15);
  });
});

/** Runs a gate over display frames and returns how many were drawn in `seconds`. */
function drawn(displayHz: number, fps: 15 | 30 | 60, seconds = 2, jitterMs = 0): number {
  const gate = new FrameGate();
  const step = 1000 / displayHz;
  let n = 0;
  for (let i = 0; i < displayHz * seconds; i++) {
    const t = 1000 + i * step + (i % 2 ? jitterMs : -jitterMs);
    if (gate.shouldDraw(t, fps)) n++;
  }
  return n / seconds;
}

describe('FrameGate', () => {
  it('skips frames on a 120 Hz screen to hold 60 fps', () => {
    const rate = drawn(120, 60);
    expect(rate).toBeLessThanOrEqual(61);
    expect(rate).toBeGreaterThanOrEqual(59);
  });

  it('draws every frame of a 60 Hz screen at 60 fps, even with timer jitter', () => {
    expect(drawn(60, 60, 2, 0.8)).toBe(60);
  });

  it('halves, then quarters, a 60 Hz screen for 30 and 15 fps', () => {
    expect(drawn(60, 30, 2, 0.8)).toBe(30);
    expect(drawn(60, 15, 2, 0.8)).toBe(15);
  });

  it('averages the target on a 144 Hz screen', () => {
    const rate = drawn(144, 60, 4);
    expect(rate).toBeGreaterThan(57);
    expect(rate).toBeLessThan(63);
  });

  it('never draws when paused', () => {
    const gate = new FrameGate();
    for (let t = 0; t < 1000; t += 8) expect(gate.shouldDraw(t, 0)).toBe(false);
  });

  it('draws straight away after a change of rate or a reset, and does not try to catch up after a stall', () => {
    const gate = new FrameGate();
    expect(gate.shouldDraw(0, 30)).toBe(true);
    expect(gate.shouldDraw(10, 30)).toBe(false);
    expect(gate.shouldDraw(11, 60)).toBe(true); // 30 -> 60: new schedule
    gate.reset(5000);
    expect(gate.shouldDraw(5000, 60)).toBe(true);
    // a one second stall is one drawn frame, not a burst of them
    expect(gate.shouldDraw(6000, 60)).toBe(true);
    expect(gate.shouldDraw(6004, 60)).toBe(false);
  });
});

describe('weightsSettled', () => {
  it('is true once the target weight is 1 and the rest 0', () => {
    expect(weightsSettled({ float: 1, dance: 0 }, 'float')).toBe(true);
    expect(weightsSettled({ float: 0.999, dance: 0.001 }, 'float')).toBe(true);
  });
  it('is false while still gliding', () => {
    expect(weightsSettled({ float: 0.8, dance: 0.2 }, 'float')).toBe(false);
    expect(weightsSettled({ float: 0.2, dance: 0.8 }, 'dance')).toBe(false);
  });
});
