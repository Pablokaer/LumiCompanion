/**
 * Chromium switches that trade a little machinery for a lot less memory. Measured on Windows with the real app
 * (`LUMI_PERF=1`, widget idle): about 495 MB in total, about 162 MB with everything below. No visible difference
 * (the transparent window and its glow, blur and gradients look the same) and no higher CPU use.
 *
 * - Software rendering and low-end device mode: the GPU process drops from ~220 MB to ~17 MB and the window's
 *   renderer from ~104 MB to ~70 MB.
 * - The network, audio and video-capture services and the GPU work run inside the main process instead of in
 *   four separate processes (about 55 MB less in all).
 *
 * Applied on Windows, where it was measured. On macOS and Linux it is off by default (not measured there):
 * `LUMI_LOW_MEMORY=1` turns it on to try it. `LUMI_HARDWARE_ACCELERATION=1` turns it off everywhere.
 */
export interface SwitchTarget {
  disableHardwareAcceleration(): void;
  commandLine: { appendSwitch(name: string, value?: string): void };
}

export const LOW_MEMORY_SWITCHES = ['enable-low-end-device-mode', 'in-process-gpu'];
export const LOW_MEMORY_ENABLE_FEATURES = ['RunVideoCaptureServiceInBrowserProcess', 'NetworkServiceInProcess2'];
export const LOW_MEMORY_DISABLE_FEATURES = ['AudioServiceOutOfProcess'];

/** Whether the low-memory set applies on this platform with these environment variables. */
export function lowMemoryEnabled(platform: string = process.platform, env: Record<string, string | undefined> = process.env): boolean {
  if (env.LUMI_HARDWARE_ACCELERATION === '1') return false;
  return platform === 'win32' || env.LUMI_LOW_MEMORY === '1';
}

/**
 * Sets the switches. `alwaysDisabled` are Chromium features that are turned off regardless (they are merged
 * with the ones turned off here, because Chromium keeps only one `disable-features` value). Must run before the app is ready.
 * Returns whether the low-memory set was applied.
 */
export function applyMemoryFlags(
  app: SwitchTarget,
  alwaysDisabled: string[] = [],
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const low = lowMemoryEnabled(platform, env);
  const disabled = [...alwaysDisabled, ...(low ? LOW_MEMORY_DISABLE_FEATURES : [])];
  if (disabled.length) app.commandLine.appendSwitch('disable-features', disabled.join(','));
  if (!low) return false;
  app.disableHardwareAcceleration();
  for (const s of LOW_MEMORY_SWITCHES) app.commandLine.appendSwitch(s);
  app.commandLine.appendSwitch('enable-features', LOW_MEMORY_ENABLE_FEATURES.join(','));
  return true;
}
