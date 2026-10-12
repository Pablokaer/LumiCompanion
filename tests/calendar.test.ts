import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../shared/types';
import { addDays, dayKey, eventsByDay, gridRange, monthGrid, shiftMonth } from '../src/calendar';

const ev = (id: string, start: Date, end: Date, allDay = false): CalendarEvent => ({
  id, title: id, start: start.toISOString(), end: end.toISOString(), allDay,
});

describe('monthGrid', () => {
  it('is 6 weeks starting on a Monday and contains the whole month', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1);
    expect(dayKey(grid[0])).toBe('2026-09-28');
    expect(grid.filter((d) => d.getMonth() === 9)).toHaveLength(31);
  });

  it('starts on the 1st when the month begins on a Monday', () => {
    expect(dayKey(monthGrid(2026, 5)[0])).toBe('2026-06-01'); // 1 June 2026 is a Monday
  });

  it('fetches exactly the visible grid', () => {
    const { from, to } = gridRange(2026, 9);
    expect(dayKey(from)).toBe('2026-09-28');
    expect(dayKey(to)).toBe('2026-11-09');
  });

  it('shifts months across years', () => {
    expect(dayKey(shiftMonth(new Date(2026, 11, 20), 1))).toBe('2027-01-01');
    expect(dayKey(shiftMonth(new Date(2026, 0, 31), -1))).toBe('2025-12-01');
  });
});

describe('eventsByDay', () => {
  it('lists a timed event on its day, all-day events first', () => {
    const map = eventsByDay([
      ev('b', new Date(2026, 9, 12, 14), new Date(2026, 9, 12, 15)),
      ev('a', new Date(2026, 9, 12, 9), new Date(2026, 9, 12, 10)),
      ev('all', new Date(2026, 9, 12), new Date(2026, 9, 13), true),
    ]);
    expect(map.get('2026-10-12')!.map((e) => e.id)).toEqual(['all', 'a', 'b']);
    expect(map.has('2026-10-13')).toBe(false);
  });

  it('spreads multi-day events over each day, with an exclusive all-day end', () => {
    const map = eventsByDay([ev('trip', new Date(2026, 9, 10), new Date(2026, 9, 13), true)]);
    expect([...map.keys()]).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('does not spill into the next day when ending at midnight, but does when ending after it', () => {
    const endsAtMidnight = eventsByDay([ev('x', new Date(2026, 9, 12, 22), new Date(2026, 9, 13, 0))]);
    expect([...endsAtMidnight.keys()]).toEqual(['2026-10-12']);
    const overnight = eventsByDay([ev('y', new Date(2026, 9, 12, 22), new Date(2026, 9, 13, 2))]);
    expect([...overnight.keys()]).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('keeps zero-length events on their day', () => {
    const t = new Date(2026, 9, 12, 8);
    expect([...eventsByDay([ev('z', t, t)]).keys()]).toEqual(['2026-10-12']);
  });

  it('adds days across month ends', () => {
    expect(dayKey(addDays(new Date(2026, 9, 31), 1))).toBe('2026-11-01');
  });
});
