import { describe, expect, it, vi } from 'vitest';
import { FullscreenProbe, queryNotificationState } from '../electron/services/dnd';
import { isBusyNotificationState } from '../shared/dnd';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

/** These call the real Windows API, so they only run on Windows. */
describe.runIf(process.platform === 'win32')('Windows do-not-disturb probe', () => {
  it('reads the real notification state of this computer as a number from 1 to 7', () => {
    const state = queryNotificationState();
    expect(state).toBeGreaterThanOrEqual(1);
    expect(state).toBeLessThanOrEqual(7);
    expect(typeof isBusyNotificationState(state!)).toBe('boolean');
  });

  it('starts and stops cleanly through FullscreenProbe', () => {
    const probe = new FullscreenProbe();
    probe.start();
    expect(typeof probe.busy).toBe('boolean');
    probe.stop();
    expect(probe.busy).toBe(false);
    probe.stop();
  });
});
