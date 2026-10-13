/**
 * What the main process tells the window about the computer, outside React so the animation loop and the
 * timers can read it without re-rendering anything.
 */
export interface PowerView {
  /** The window is hidden or minimised, or the screen is locked or asleep: nothing can be seen. */
  hidden: boolean;
}

export const power: PowerView = { hidden: false };

const subscribers = new Set<() => void>();

export function setPower(patch: Partial<PowerView>): void {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof PowerView)[]) {
    if (patch[k] !== undefined && power[k] !== patch[k]) { power[k] = patch[k] as never; changed = true; }
  }
  if (changed) subscribers.forEach((fn) => fn());
}

/** Calls `fn` whenever the power view changes. Returns the unsubscribe function. */
export function subscribePower(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** True when nothing she does can be seen: the main process says so, or the page itself is hidden or covered. */
export const isHidden = (): boolean => power.hidden || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
