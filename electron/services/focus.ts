import { EventEmitter } from 'node:events';
import type { FocusState } from '../../shared/types';

/** Reminders further away than this are held back during a focus session. */
export const FOCUS_URGENT_MINUTES = 5;

export const shouldHoldReminder = (focusActive: boolean, minutesUntil: number) =>
  focusActive && minutesUntil > FOCUS_URGENT_MINUTES;

/** A single countdown. Emits 'changed' (FocusState | undefined) and 'done' when it runs out. */
export class FocusService extends EventEmitter {
  private state?: FocusState;
  private timer?: NodeJS.Timeout;

  get current() { return this.state; }

  start(minutes: number): FocusState {
    const m = Math.min(180, Math.max(1, Math.round(minutes) || 25));
    this.clear();
    this.state = { endsAt: Date.now() + m * 60_000, minutes: m };
    this.timer = setTimeout(() => {
      const finished = this.state;
      this.clear();
      this.state = undefined;
      this.emit('changed', undefined);
      if (finished) this.emit('done', finished);
    }, m * 60_000);
    this.emit('changed', this.state);
    return this.state;
  }

  stop() {
    if (!this.state) return;
    this.clear();
    this.state = undefined;
    this.emit('changed', undefined);
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
