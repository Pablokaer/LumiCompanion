/**
 * Proactive tips: gentle, rare nudges (water, stretching, resting your eyes, bedtime, rain) delivered in
 * her speech bubble. The engine is pure and keeps strict limits so she never becomes a nag.
 */

export type TipId = 'water' | 'stretch' | 'eyes' | 'posture' | 'late' | 'rain';
export type TipAction = 'stretch' | 'wave' | 'hop' | 'twinkle' | 'cheer';
export type TipFrequency = 'rare' | 'normal' | 'often';

export interface Tip {
  id: TipId;
  text: string;
  action: TipAction;
}

export interface TipContext {
  now: number;
  /** Minutes of continuous computer use (resets after a 5-minute break). */
  activeMinutes: number;
  /** Local hour of day, 0-23. */
  hour: number;
  /** Do not disturb, focus session, meeting, asleep or hidden: say nothing. */
  quiet: boolean;
  /** It is raining and an event is coming up soon. */
  rainSoon?: boolean;
}

/** Multiplies every waiting time: "rare" waits twice as long, "often" waits 40% less. */
export const FREQUENCY_FACTOR: Record<TipFrequency, number> = { rare: 2, normal: 1, often: 0.6 };

const MIN = 60_000;
/** Minimum time between any two tips, before the frequency factor. */
export const MIN_GAP_MINUTES = 25;

const TEXTS: Record<TipId, { lines: string[]; action: TipAction }> = {
  water: { lines: ['Time for some water? 💧', 'Hydration check! 💧 A glass of water?', 'Your star says: drink some water 💧'], action: 'hop' },
  stretch: { lines: ['You have been at it a while — stand up and stretch? 🧘', 'Stretch break! Roll your shoulders with me ✦', 'Let\'s stretch our points together 🧘'], action: 'stretch' },
  eyes: { lines: ['Rest your eyes: look at something far away for 20 seconds 👀', 'Eye break! Look out of the window for a moment 👀'], action: 'twinkle' },
  posture: { lines: ['Posture check! Shoulders back, screen at eye level ✦', 'Sit up tall, little human ✦'], action: 'wave' },
  late: { lines: ['It is very late… how about some sleep? 🌙', 'The stars say it is bedtime 🌙 Your work will be there tomorrow.'], action: 'stretch' },
  rain: { lines: ['It is raining — remember an umbrella before you head out ☂️', 'Rain outside! Take an umbrella with you ☂️'], action: 'wave' },
};

interface EngineState {
  lastAny: number;
  last: Partial<Record<TipId, number>>;
}

export class TipEngine {
  private state: EngineState;

  constructor(private rand: () => number = Math.random, saved?: Partial<EngineState>, private frequency: TipFrequency = 'normal') {
    this.state = { lastAny: saved?.lastAny ?? 0, last: { ...saved?.last } };
  }

  setFrequency(f: TipFrequency) { this.frequency = f; }

  /** What to remember between runs, so a restart does not reset the cooldowns. */
  serialize(): EngineState { return { lastAny: this.state.lastAny, last: { ...this.state.last } }; }

  /** The tip to show right now, if any. Records it as shown. */
  consider(ctx: TipContext): Tip | undefined {
    if (ctx.quiet) return undefined;
    const f = FREQUENCY_FACTOR[this.frequency];
    const sinceAny = (ctx.now - this.state.lastAny) / MIN;
    if (this.state.lastAny && sinceAny < MIN_GAP_MINUTES * f) return undefined;
    const since = (id: TipId) => (ctx.now - (this.state.last[id] ?? 0)) / MIN;
    const ready = (id: TipId, cooldown: number) => !this.state.last[id] || since(id) >= cooldown * f;

    // In priority order; the first one that applies wins.
    let id: TipId | undefined;
    if (ctx.hour < 5 && ctx.activeMinutes >= 20 && ready('late', 360)) id = 'late';
    else if (ctx.rainSoon && ready('rain', 180)) id = 'rain';
    else if (ctx.activeMinutes >= 55 * f && ready('stretch', 60)) id = 'stretch';
    else if (ctx.activeMinutes >= 75 * f && ready('water', 90)) id = 'water';
    else if (ctx.activeMinutes >= 40 * f && ready('eyes', 45)) id = 'eyes';
    else if (ctx.activeMinutes >= 90 * f && ready('posture', 120)) id = 'posture';
    if (!id) return undefined;

    this.state.lastAny = ctx.now;
    this.state.last[id] = ctx.now;
    const { lines, action } = TEXTS[id];
    return { id, text: lines[Math.min(lines.length - 1, Math.floor(this.rand() * lines.length))], action };
  }
}

/**
 * Tracks continuous use from the idle time the OS reports: it grows while you work, and a break of
 * `BREAK_MINUTES` or more starts the count again.
 */
export const BREAK_MINUTES = 5;

export class ActivityTracker {
  /** Minutes of continuous use. */
  minutes = 0;
  private lastAt?: number;

  /** Feed an idle-time reading (seconds) taken at `now` (ms). */
  update(now: number, idleSeconds: number): number {
    if (this.lastAt !== undefined) {
      const elapsedMin = (now - this.lastAt) / MIN;
      if (idleSeconds >= BREAK_MINUTES * 60) this.minutes = 0;
      else if (idleSeconds < 120) this.minutes += Math.min(elapsedMin, 2); // ignore gaps (a suspended laptop)
    }
    this.lastAt = now;
    return this.minutes;
  }

  reset() { this.minutes = 0; }
}
