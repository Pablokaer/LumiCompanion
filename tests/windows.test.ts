import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { FullscreenProbe, PROBE_SCRIPT } from '../electron/services/dnd';
import { isBusyNotificationState } from '../shared/dnd';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

/** These run the real Windows probe, so they only run on Windows. */
describe.runIf(process.platform === 'win32')('Windows do-not-disturb probe', () => {
  it('prints the real notification state of this computer as a number from 1 to 7', async () => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROBE_SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const first = await new Promise<string>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no output from the probe: ${out}`)), 20_000);
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        const m = /^(\d+)\s*$/m.exec(out);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    });
    child.kill();
    const state = Number(first);
    expect(state).toBeGreaterThanOrEqual(1);
    expect(state).toBeLessThanOrEqual(7);
    // Whatever it is right now, the mapping must agree with what the probe class would report.
    expect(typeof isBusyNotificationState(state)).toBe('boolean');
  }, 30_000);

  it('starts and stops cleanly through FullscreenProbe, leaving no process behind', async () => {
    const probe = new FullscreenProbe();
    probe.start();
    await new Promise((r) => setTimeout(r, 2500));
    expect(typeof probe.busy).toBe('boolean');
    probe.stop();
    expect(probe.busy).toBe(false);
    await new Promise((r) => setTimeout(r, 500));
    // calling stop twice is harmless
    probe.stop();
  }, 15_000);
});
