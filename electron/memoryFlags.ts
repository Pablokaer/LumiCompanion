/**
 * Chromium switches that trade a little rendering machinery for a lot less memory. Measured on Windows with the
 * mascot widget (idle, expanded panel and dancing): about 260 MB in total drops to about 135 MB, the GPU process
 * goes from ~105 MB to ~17 MB and the window's renderer from ~110 MB to ~70 MB, with no visible difference
 * (the transparent window and its glow, blur and gradients look the same) and no higher CPU use.
 *
 * - Software rendering: no real GPU process.
 * - Low-end device mode: smaller caches and decoded-image budgets in the renderer.
 *
 * Only done on Windows, where it was measured. `LUMI_HARDWARE_ACCELERATION=1` turns it off again.
 */
export interface SwitchTarget {
  disableHardwareAcceleration(): void;
  commandLine: { appendSwitch(name: string, value?: string): void };
}

export function applyMemoryFlags(app: SwitchTarget, platform: string = process.platform, env: Record<string, string | undefined> = process.env): boolean {
  if (platform !== 'win32' || env.LUMI_HARDWARE_ACCELERATION === '1') return false;
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-low-end-device-mode');
  return true;
}
