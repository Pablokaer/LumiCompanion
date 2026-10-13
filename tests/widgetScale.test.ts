import { describe, expect, it, vi } from 'vitest';
import { clampScale } from '../electron/store';
import { sizeFor } from '../electron/window';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {}, BrowserWindow: class {}, screen: {} }));

describe('widget size', () => {
  it('keeps the scale between 60% and 100%', () => {
    expect(clampScale(0.3)).toBe(0.6);
    expect(clampScale(2)).toBe(1);
    expect(clampScale(0.85)).toBe(0.85);
    expect(clampScale('big')).toBe(1);
    expect(clampScale(NaN)).toBe(1);
  });
  it('scales the window size', () => {
    expect(sizeFor('compact', 'mascot', 1)).toEqual({ width: 240, height: 300 });
    expect(sizeFor('compact', 'mascot', 0.5)).toEqual({ width: 120, height: 150 });
    expect(sizeFor('expanded', 'mascot', 0.7)).toEqual({ width: 280, height: 448 });
  });
});
