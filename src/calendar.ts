import type { CalendarEvent } from '../shared/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD" key for a date. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** The 6 × 7 grid of days shown for a month; weeks start on Monday. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

/** The instants to fetch so every cell of the month grid has its events. */
export function gridRange(year: number, month: number): { from: Date; to: Date } {
  const grid = monthGrid(year, month);
  return { from: grid[0], to: addDays(grid[41], 1) };
}

export const shiftMonth = (d: Date, delta: number) => new Date(d.getFullYear(), d.getMonth() + delta, 1);

/**
 * Groups events by every local day they cover. All-day events end on an
 * exclusive date, and a timed event ending exactly at midnight does not spill
 * into the next day. Each day lists all-day events first, then by start time.
 */
export function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const first = startOfDay(new Date(e.start));
    let last = startOfDay(new Date(+new Date(e.end) - 1));
    if (last < first) last = first;
    for (let d = first, guard = 0; d <= last && guard < 62; d = addDays(d, 1), guard++) {
      const key = dayKey(d);
      const list = map.get(key);
      if (list) list.push(e); else map.set(key, [e]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  }
  return map;
}

export const monthTitle = (d: Date) => d.toLocaleDateString([], { month: 'long', year: 'numeric' });

export const weekdayLabels = () =>
  Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: 'short' }).slice(0, 3));
