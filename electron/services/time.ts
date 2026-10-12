// Pure date helpers (unit tested). All "local" strings are wall-clock times in the user's time zone.

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const LOCAL_D = /^(\d{4})-(\d{2})-(\d{2})$/;

export const pad = (n: number) => String(n).padStart(2, '0');

export function isLocalDateTime(s: string) { return LOCAL_DT.test(s); }
export function isLocalDate(s: string) { return LOCAL_D.test(s); }

/** Parses "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" as a local Date. */
export function parseLocal(s: string): Date {
  const dt = s.match(LOCAL_DT);
  if (dt) return new Date(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5]);
  const d = s.match(LOCAL_D);
  if (d) return new Date(+d[1], +d[2] - 1, +d[3]);
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
