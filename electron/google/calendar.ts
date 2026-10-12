import type { CalendarEvent, NewEventInput } from '../../shared/types';
import { findMeetingLink } from '../../shared/meeting';
import { addDaysLocal, addMinutesLocal, isLocalDate, isLocalDateTime, localTimeZone, parseLocal } from '../services/time';
import { googleFetch } from './auth';

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export function mapEvent(e: GEvent): CalendarEvent {
  const allDay = !e.start.dateTime;
  const start = e.start.dateTime ?? parseLocal(e.start.date!).toISOString();
  const end = e.end.dateTime ?? parseLocal(e.end.date!).toISOString();
  return {
    id: e.id,
    title: e.summary || '(no title)',
    start,
    end,
    allDay,
    location: e.location,
    description: e.description,
    meetLink: e.hangoutLink,
    joinUrl: e.hangoutLink ?? findMeetingLink(
      e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri, e.location, e.description,
    ),
    htmlLink: e.htmlLink,
  };
}

export async function listUpcomingEvents(days = 7, from = new Date()): Promise<CalendarEvent[]> {
  const startOfToday = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const until = new Date(startOfToday.getTime() + (days + 1) * 86_400_000);
  const params = new URLSearchParams({
    timeMin: startOfToday.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  const res = await googleFetch<{ items?: GEvent[] }>(`${BASE}?${params}`);
  return (res.items ?? []).filter((e) => e.status !== 'cancelled').map(mapEvent);
}

/** All events between two instants, following Google's pagination (recurring events are expanded). */
export async function listEventsInRange(from: Date, to: Date): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await googleFetch<{ items?: GEvent[]; nextPageToken?: string }>(`${BASE}?${params}`);
    out.push(...(res.items ?? []).filter((e) => e.status !== 'cancelled').map(mapEvent));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Converts friendly input into a Google Calendar event body. Exported for tests. */
export function buildEventBody(input: NewEventInput, timeZone = localTimeZone()) {
  const title = input.title?.trim();
  if (!title) throw new Error('Event title is required.');
  const allDay = input.allDay || isLocalDate(input.start);

  if (allDay) {
    const startDate = input.start.slice(0, 10);
    if (!isLocalDate(startDate)) throw new Error(`Invalid date "${input.start}".`);
    // Google's all-day end date is exclusive.
    const endDate = input.end && isLocalDate(input.end.slice(0, 10)) ? addDaysLocal(input.end.slice(0, 10), 1) : addDaysLocal(startDate, 1);
    return {
      summary: title,
      location: input.location,
      description: input.description,
      start: { date: startDate },
      end: { date: endDate },
    };
  }

  if (!isLocalDateTime(input.start)) throw new Error(`Invalid start "${input.start}". Use YYYY-MM-DDTHH:mm.`);
  const start = input.start.slice(0, 16);
  let end = input.end && isLocalDateTime(input.end) ? input.end.slice(0, 16) : addMinutesLocal(start, input.durationMinutes ?? 60);
  if (parseLocal(end) <= parseLocal(start)) end = addMinutesLocal(start, 60);
  return {
    summary: title,
    location: input.location,
    description: input.description,
    start: { dateTime: `${start}:00`, timeZone },
    end: { dateTime: `${end}:00`, timeZone },
  };
}

export async function createEvent(input: NewEventInput): Promise<CalendarEvent> {
  const created = await googleFetch<GEvent>(BASE, { method: 'POST', body: JSON.stringify(buildEventBody(input)) });
  return mapEvent(created);
}
