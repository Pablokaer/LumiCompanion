import { describe, expect, it } from 'vitest';
import { CURSOR_IDLE_LIMIT_S, powerHint, shouldPollCursor } from '../shared/power';

describe('powerHint', () => {
  it('is calm on battery, but not critical', () => {
    expect(powerHint({ onBattery: true, thermal: 'nominal' })).toEqual({ calm: true, critical: false });
  });
  it('is not calm on mains power and a cool machine', () => {
    for (const thermal of ['unknown', 'nominal', 'fair'] as const) {
      expect(powerHint({ onBattery: false, thermal })).toEqual({ calm: false, critical: false });
    }
  });
  it('calms down when the machine runs hot, and holds still when it is critical', () => {
    expect(powerHint({ onBattery: false, thermal: 'serious' })).toEqual({ calm: true, critical: false });
    expect(powerHint({ onBattery: false, thermal: 'critical' })).toEqual({ calm: true, critical: true });
    expect(powerHint({ onBattery: true, thermal: 'critical' }).critical).toBe(true);
  });
});

describe('shouldPollCursor', () => {
  const active = { followMouse: true, windowVisible: true, locked: false, idleSeconds: 2 };
  it('polls while someone is there', () => {
    expect(shouldPollCursor(active)).toBe(true);
    expect(shouldPollCursor({ ...active, idleSeconds: CURSOR_IDLE_LIMIT_S })).toBe(true);
  });
  it('stops when the window is hidden, the screen is locked, the setting is off or the user is away', () => {
    expect(shouldPollCursor({ ...active, windowVisible: false })).toBe(false);
    expect(shouldPollCursor({ ...active, locked: true })).toBe(false);
    expect(shouldPollCursor({ ...active, followMouse: false })).toBe(false);
    expect(shouldPollCursor({ ...active, idleSeconds: CURSOR_IDLE_LIMIT_S + 1 })).toBe(false);
  });
});
