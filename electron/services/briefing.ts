import type { Briefing, CalendarEvent, ScoredEmail } from '../../shared/types';
import { formatLocalDateTime } from './time';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** True when the briefing is enabled, its time has passed and it has not been shown today. */
export function shouldShowBriefing(
  s: { morningBriefing: boolean; briefingTime: string; lastBriefingDate?: string },
  now = new Date(),
): boolean {
  if (!s.morningBriefing || s.lastBriefingDate === localDate(now)) return false;
  return hhmm(now) >= (/^\d{2}:\d{2}$/.test(s.briefingTime) ? s.briefingTime : '08:00');
}

export const briefingDate = localDate;

/** Builds the briefing text from today's events and the most important emails. Deterministic, no AI needed. */
export function buildBriefing(events: CalendarEvent[], emails: ScoredEmail[], now = new Date(), name?: string, weather?: string): Briefing {
  const today = localDate(now);
  const todays = events
    .filter((e) => localDate(new Date(e.start)) === today || (e.allDay && localDate(new Date(e.start)) <= today && localDate(new Date(+new Date(e.end) - 1)) >= today))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  const upcoming = todays.filter((e) => e.allDay || new Date(e.end) > now);
  const important = emails.filter((e) => e.level === 'high').slice(0, 3);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lines: string[] = [];
  if (weather) lines.push(`${weather}`);

  if (!upcoming.length) lines.push('Your calendar is clear today — no events ✦');
  else {
    lines.push(`${upcoming.length} event${upcoming.length === 1 ? '' : 's'} today:`);
    for (const e of upcoming.slice(0, 5)) {
      const when = e.allDay ? 'All day' : formatLocalDateTime(new Date(e.start)).slice(11, 16);
      lines.push(`• ${when} — ${e.title}`);
    }
    if (upcoming.length > 5) lines.push(`…and ${upcoming.length - 5} more`);
  }
  if (important.length) {
    lines.push(`${important.length} important email${important.length === 1 ? '' : 's'}:`);
    for (const e of important) lines.push(`• ${e.from}: ${e.subject}`);
  } else {
    lines.push('No urgent emails right now.');
  }
  return { title: `${greeting}${name ? `, ${name}` : ''}! Here is your day`, lines };
}
