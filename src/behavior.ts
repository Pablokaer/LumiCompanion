/**
 * What the star does when nothing else is going on. Pure functions so the "personality"
 * is testable; the React side (mascotLife.tsx) just runs them on timers.
 */

export type MascotAction =
  | 'none' | 'smile' | 'hop' | 'look' | 'wave' | 'spin' | 'wiggle' | 'stretch' | 'twinkle' | 'hum' | 'peek' | 'cheer' | 'wake';

export interface ActionDef {
  action: Exclude<MascotAction, 'none' | 'wake'>;
  /** Relative chance of being picked. */
  weight: number;
  /** How long the animation lasts, in ms (matches the CSS). */
  ms: number;
}

export const IDLE_ACTIONS: ActionDef[] = [
  { action: 'smile', weight: 3, ms: 2200 },
  { action: 'look', weight: 3, ms: 2400 },
  { action: 'hop', weight: 3, ms: 1100 },
  { action: 'wave', weight: 2, ms: 2200 },
  { action: 'wiggle', weight: 2, ms: 1200 },
  { action: 'twinkle', weight: 2, ms: 1800 },
  { action: 'hum', weight: 2, ms: 3200 },
  { action: 'stretch', weight: 1, ms: 2000 },
  { action: 'peek', weight: 1, ms: 2000 },
  { action: 'spin', weight: 1, ms: 1300 },
  { action: 'cheer', weight: 1, ms: 1500 },
];

/** How long the wake-up stretch lasts after the computer has been idle. */
export const WAKE_MS = 3200;

/** Short bubble text that goes with some actions. */
export const ACTION_LINES: Partial<Record<MascotAction, string>> = {
  wave: 'Hi there! 👋',
  hum: '♪ la la la…',
  cheer: 'Woohoo! ✦',
  stretch: 'Ahh, stretching my points…',
  wake: 'Welcome back! ✦',
};

/** Actions come every few seconds; at most one line per this many ms, so the bubble is not always changing. */
export const ACTION_LINE_GAP_MS = 2 * 60_000;

/** Weighted random choice that never repeats the previous action. */
export function pickAction(rand: () => number, last?: MascotAction): { action: ActionDef['action']; durationMs: number } {
  const pool = IDLE_ACTIONS.filter((a) => a.action !== last);
  const total = pool.reduce((n, a) => n + a.weight, 0);
  let r = rand() * total;
  for (const a of pool) {
    r -= a.weight;
    if (r < 0) return { action: a.action, durationMs: a.ms };
  }
  const fallback = pool[pool.length - 1];
  return { action: fallback.action, durationMs: fallback.ms };
}

/** Pause before the next spontaneous action: she is never still for long, but not frantic either. */
export const nextDelayMs = (rand: () => number) => 2000 + rand() * 4500;

/** Idle time (seconds) after which the star falls asleep; 0 or less means never. */
export const sleepThresholdSeconds = (minutes: number) => (minutes > 0 ? minutes * 60 : Infinity);
