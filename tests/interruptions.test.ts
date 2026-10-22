import { describe, expect, it } from 'vitest';
import { Interruptions, type Quiet } from '../electron/services/interruptions';
import type { ReminderPayload } from '../shared/types';

const now = new Date('2026-10-22T10:00:00');
const reminder = (id: string, minutesUntil: number, joinUrl?: string): ReminderPayload => ({
  event: { id, title: `Event ${id}`, allDay: false, joinUrl, start: new Date(+now + minutesUntil * 60_000).toISOString(), end: new Date(+now + (minutesUntil + 30) * 60_000).toISOString() },
  minutesUntil,
  message: `Event ${id} in ${minutesUntil}`,
});

/** Interruptions wired to a pretend window and notification centre. */
function setup(quiet: Partial<Quiet> = {}) {
  const q: Quiet = { dnd: false, focus: false, calendarOnly: false, ...quiet };
  const log: string[] = [];
  const clicked: string[] = [];
  const clicks: (() => void)[] = [];
  const i = new Interruptions({
    quiet: () => q,
    showReminder: (r) => log.push(`reminder ${r.event.id} ${r.minutesUntil}`),
    peek: (ms) => log.push(`peek${ms ? ` ${ms}` : ''}`),
    systemNotify: (title, body, onClick) => { log.push(`notify ${title}: ${body}`); if (onClick) clicks.push(onClick); return true; },
    onReminderClick: (r) => clicked.push(r.event.id),
  });
  return { i, q, log, clicked, clicks };
}

describe('interruptions', () => {
  it('shows a reminder at once on a normal day: in the window, a peek and a notification that joins the call', () => {
    const { i, log, clicks, clicked } = setup();
    i.reminder(reminder('a', 10, 'https://meet.google.com/x'));
    expect(log).toEqual(['reminder a 10', 'peek', 'notify Event a: Event a in 10 Click to join the call.']);
    clicks[0]();
    expect(clicked).toEqual(['a']);
  });

  it('holds reminders in quiet mode and shows them as one summary when it ends', () => {
    const { i, q, log } = setup({ dnd: true });
    i.reminder(reminder('a', 10));
    i.reminder(reminder('b', 20));
    i.notify('Lumi 2.0 is ready', 'Restart');
    expect(log).toEqual([]); // nothing at all while quiet
    q.dnd = false;
    i.quietChanged(now);
    expect(log).toEqual(['reminder a 10', 'peek', 'notify Event a: “Event a” starts in 10 minutes.', 'notify While you were busy: 2 reminders came up: Event a, Event b.']); // time left worked out again
    i.quietChanged(now);
    expect(log).toHaveLength(4); // released once
  });

  it('lets urgent reminders through a focus session and holds the rest until focus and quiet mode both end', () => {
    const { i, q, log } = setup({ focus: true });
    i.reminder(reminder('soon', 5));
    expect(log[0]).toBe('reminder soon 5');
    log.length = 0;
    i.reminder(reminder('later', 30));
    expect(log).toEqual([]);
    q.dnd = true;
    q.focus = false;
    i.quietChanged(now); // focus ended, but quiet mode began: still waiting
    expect(log).toEqual([]);
    q.dnd = false;
    i.quietChanged(now);
    expect(log[0]).toBe('reminder later 30');
  });

  it('drops chatter in calendar-only mode, keeps calendar items, and holds the briefing back', () => {
    const { i, log } = setup({ calendarOnly: true });
    expect(i.notify('3 new in “AI news”', '• x', { chatter: true })).toBe(false);
    expect(i.briefingMayShow()).toBe(false);
    i.reminder(reminder('a', 10));
    expect(log[0]).toBe('reminder a 10');
  });

  it('peeks for this long when asked, and the briefing may show on a normal day', () => {
    const { i, log } = setup();
    expect(i.briefingMayShow()).toBe(true);
    expect(i.notify('Good morning', 'Two meetings', { peek: 30_000 })).toBe(true);
    expect(log).toEqual(['peek 30000', 'notify Good morning: Two meetings']);
  });
});
