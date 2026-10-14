import type { CalendarEvent, ReminderPayload } from '../../shared/types';

/**
 * Decides which reminders are due. Pure & deterministic (unit tested):
 * call `due(events, now)` periodically; each (event, lead) pair fires at most once.
 * If several leads are already passed (e.g. app opened 3 min before a meeting),
 * only the closest one fires and the others are marked as done.
 */
export class ReminderScheduler {
  private fired = new Set<string>();

  constructor(private leadMinutes: number[] = [15, 5]) {}

  setLeads(leads: number[]) { this.leadMinutes = [...leads]; }

  due(events: CalendarEvent[], now = new Date()): ReminderPayload[] {
    const out: ReminderPayload[] = [];
    const leads = [...new Set(this.leadMinutes)].sort((a, b) => b - a);
    for (const event of events) {
      if (event.allDay) continue;
      const start = new Date(event.start).getTime();
      const msUntil = start - now.getTime();
      if (msUntil < -60_000) continue; // already started more than a minute ago
      const minutesUntil = Math.max(0, Math.round(msUntil / 60_000));
      const passed = leads.filter((lead) => msUntil <= lead * 60_000);
      const pending = passed.filter((lead) => !this.fired.has(this.key(event, lead)));
      if (!pending.length) continue;
      passed.forEach((lead) => this.fired.add(this.key(event, lead)));
      out.push({ event, minutesUntil, message: reminderMessage(event.title, minutesUntil) });
    }
    this.prune(now);
    return out;
  }

  private key(e: CalendarEvent, lead: number) { return `${e.id}|${e.start}|${lead}`; }

  private prune(now: Date) {
    if (this.fired.size < 500) return;
    const cutoff = now.getTime() - 86_400_000;
    for (const k of this.fired) {
      const start = Date.parse(k.split('|')[1]);
      if (start < cutoff) this.fired.delete(k);
    }
  }
}

/** How many held reminders are kept, and how long after an event began one is still worth showing. */
const HOLD_LIMIT = 5;
const HOLD_STALE_MS = 10 * 60_000;

/** Adds a reminder to the ones held back (while quiet or focusing); a newer one for the same event replaces the old. */
export function holdReminder(held: ReminderPayload[], r: ReminderPayload): ReminderPayload[] {
  return [...held.filter((h) => h.event.id !== r.event.id), r].slice(-HOLD_LIMIT);
}

/** The held reminders still worth showing, soonest first, with the time left worked out again. */
export function releaseReminders(held: ReminderPayload[], now = new Date()): ReminderPayload[] {
  return held
    .filter((h) => +new Date(h.event.start) > now.getTime() - HOLD_STALE_MS)
    .sort((a, b) => +new Date(a.event.start) - +new Date(b.event.start))
    .map((h) => {
      const minutesUntil = Math.max(0, Math.round((+new Date(h.event.start) - now.getTime()) / 60_000));
      return { ...h, minutesUntil, message: reminderMessage(h.event.title, minutesUntil) };
    });
}

export function reminderMessage(title: string, minutes: number) {
  if (minutes <= 0) return `“${title}” is starting now! ✦`;
  if (minutes === 1) return `“${title}” starts in 1 minute!`;
  return `“${title}” starts in ${minutes} minutes.`;
}
