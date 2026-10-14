// Pure date helpers (unit tested). All "local" strings are wall-clock times in the user's time zone.

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const LOCAL_D = /^(\d{4})-(\d{2})-(\d{2})$/;

export const pad = (n: number) => String(n).padStart(2, '0');

/** A real calendar day and clock time: 2025-02-30 and T25:99 have the right shape but do not exist. */
function exists(y: number, mo: number, d: number, h = 0, mi = 0) {
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

export function isLocalDateTime(s: string) {
  const m = s.match(LOCAL_DT);
  return !!m && exists(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

export function isLocalDate(s: string) {
  const m = s.match(LOCAL_D);
  return !!m && exists(+m[1], +m[2], +m[3]);
}

/** Parses "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" as a local Date. */
export function parseLocal(s: string): Date {
  const dt = s.match(LOCAL_DT);
  if (dt && isLocalDateTime(s)) return new Date(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5]);
  const d = s.match(LOCAL_D);
  if (d && isLocalDate(s)) return new Date(+d[1], +d[2] - 1, +d[3]);
  throw new Error(`Invalid local date/time "${s}". Use YYYY-MM-DDTHH:mm or YYYY-MM-DD.`);
}

export function formatLocalDateTime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLocalDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addMinutesLocal(s: string, minutes: number) {
  return formatLocalDateTime(new Date(parseLocal(s).getTime() + minutes * 60_000));
}

export function addDaysLocal(s: string, days: number) {
  const d = parseLocal(s);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const MAX_EVENT_MINUTES = 24 * 60;

/**
 * What is wrong with an event before anybody is asked to confirm it, in words fit for the model or the user;
 * undefined when it is fine. (`buildEventBody` checks again when saving.)
 */
export function checkNewEvent(e: { title?: unknown; start?: unknown; end?: unknown; durationMinutes?: unknown }): string | undefined {
  if (typeof e.title !== 'string' || !e.title.trim()) return 'the title is required';
  if (typeof e.start !== 'string' || !(isLocalDateTime(e.start) || isLocalDate(e.start))) return `"${String(e.start)}" is not a real date; use YYYY-MM-DDTHH:mm (or YYYY-MM-DD for an all-day event)`;
  if (e.end !== undefined && e.end !== '' && (typeof e.end !== 'string' || !(isLocalDateTime(e.end) || isLocalDate(e.end)))) return `the end "${String(e.end)}" is not a real date or time`;
  if (e.durationMinutes !== undefined && (typeof e.durationMinutes !== 'number' || !Number.isFinite(e.durationMinutes) || e.durationMinutes < 1 || e.durationMinutes > MAX_EVENT_MINUTES)) return 'the duration must be between 1 and 1440 minutes';
  return undefined;
}
