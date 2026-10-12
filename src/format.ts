import type { CalendarEvent } from '../shared/types';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

export function relative(iso: string, now = new Date()) {
  const mins = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (mins < -1) return `${Math.abs(mins)} min ago`;
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `in ${h}h ${m}m` : `in ${h}h`;
  const days = Math.round(h / 24);
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

export function timeAgo(iso: string, now = new Date()) {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function groupByDay(events: CalendarEvent[], now = new Date()) {
  const groups = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (!e.allDay && new Date(e.end) < now) continue; // hide finished events
    const key = dayLabel(e.start, now);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.entries()];
}

export function nextEvent(events: CalendarEvent[], now = new Date()) {
  return events.find((e) => !e.allDay && new Date(e.end) > now);
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5) return 'Still up among the stars';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const isNight = (now = new Date()) => now.getHours() >= 23 || now.getHours() < 6;
