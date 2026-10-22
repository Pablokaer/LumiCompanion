import type { ReminderPayload } from '../../shared/types';
import { holdReminder, releaseReminders } from './reminders';

/** Reminders further away than this are held back during a focus session. */
export const FOCUS_URGENT_MINUTES = 5;

export interface Quiet {
  /** Do not disturb (manual, full-screen app or meeting). */
  dnd: boolean;
  /** A focus session is running. */
  focus: boolean;
  /** "Calendar pop-ups only". */
  calendarOnly: boolean;
}

export interface InterruptionDeps {
  quiet(): Quiet;
  /** Sends a reminder to the window. */
  showReminder(r: ReminderPayload): void;
  /** Brings the widget to the front for a moment. */
  peek(ms?: number): void;
  /** A system notification (the adapter checks that notifications are on). Returns whether it was shown. */
  systemNotify(title: string, body: string, onClick?: () => void): boolean;
  /** What clicking a reminder notification does (join the call, or open Lumi). */
  onReminderClick(r: ReminderPayload): void;
}

export interface NotifyOptions {
  onClick?: () => void;
  /** Not about the calendar: dropped in "calendar pop-ups only" mode. */
  chatter?: boolean;
  /** Also bring the widget forward, for this long (true: the default time). */
  peek?: number | true;
}

/**
 * Everything that interrupts you goes through here, and here alone it is decided whether it shows now,
 * waits or is dropped:
 * - quiet mode (do not disturb) silences notifications and peeking;
 * - reminders that come due while quiet, or while focusing (unless 5 minutes or less away), are held
 *   and shown when both end, several of them as one "While you were busy" summary;
 * - "calendar pop-ups only" drops everything that is not about the calendar.
 */
export class Interruptions {
  private held: ReminderPayload[] = [];

  constructor(private deps: InterruptionDeps) {}

  /** A reminder came due: shown now, or held until quiet mode and focus end. */
  reminder(r: ReminderPayload) {
    const q = this.deps.quiet();
    if (q.dnd || (q.focus && r.minutesUntil > FOCUS_URGENT_MINUTES)) { this.held = holdReminder(this.held, r); return; }
    this.announce(r);
  }

  /** Quiet mode or focus changed: once neither is on, shows what was held. */
  quietChanged(now = new Date()) {
    const q = this.deps.quiet();
    if (q.dnd || q.focus) return;
    const relevant = releaseReminders(this.held, now);
    this.held = [];
    if (!relevant.length) return;
    this.announce(relevant[0]);
    if (relevant.length > 1) this.notify('While you were busy', `${relevant.length} reminders came up: ${relevant.map((h) => h.event.title).join(', ')}.`);
  }

  /** A notification (and optionally a peek). Returns whether the notification was shown. */
  notify(title: string, body: string, opts: NotifyOptions = {}): boolean {
    const q = this.deps.quiet();
    if (opts.chatter && q.calendarOnly) return false;
    if (q.dnd) return false;
    if (opts.peek !== undefined) this.deps.peek(opts.peek === true ? undefined : opts.peek);
    return this.deps.systemNotify(title, body, opts.onClick);
  }

  /** Whether the automatic morning briefing may appear now; if not, it waits for a better moment. */
  briefingMayShow(): boolean {
    const q = this.deps.quiet();
    return !q.dnd && !q.calendarOnly;
  }

  private announce(r: ReminderPayload) {
    this.deps.showReminder(r);
    this.notify(r.event.title, r.event.joinUrl ? `${r.message} Click to join the call.` : r.message, { peek: true, onClick: () => this.deps.onReminderClick(r) });
  }
}
