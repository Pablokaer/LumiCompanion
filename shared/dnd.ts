import type { CalendarEvent } from './types';

/**
 * Do not disturb: when Lumi should stay quiet (no notifications, no popping up, no chatter).
 * Pure logic; the Windows probe that feeds `fullscreen` lives in the main process.
 */

export type DndReason = 'manual' | 'fullscreen' | 'meeting';

export interface DndState {
  active: boolean;
  reason?: DndReason;
  /** For a manual pause: epoch ms when it ends. */
  until?: number;
  /** For `meeting`: the event in progress. */
  meeting?: string;
}

export interface DndInput {
  now: number;
  /** Manual "quiet until" time (epoch ms), if any. */
  manualUntil?: number;
  /** A full-screen app, presentation or the OS's Focus Assist is on. */
  fullscreen: boolean;
  /** The event happening right now, if any. */
  meeting?: Pick<CalendarEvent, 'title'>;
  settings: { dndFullscreen: boolean; dndMeetings: boolean };
}

/** The reason that applies, in order: a manual pause wins, then a full-screen app, then a meeting. */
export function computeDnd(input: DndInput): DndState {
  const { now, manualUntil, fullscreen, meeting, settings } = input;
  if (manualUntil && manualUntil > now) return { active: true, reason: 'manual', until: manualUntil };
  if (settings.dndFullscreen && fullscreen) return { active: true, reason: 'fullscreen' };
  if (settings.dndMeetings && meeting) return { active: true, reason: 'meeting', meeting: meeting.title };
  return { active: false };
}

/** A timed event that is running now and looks like a meeting (not all-day, shorter than 8 hours). */
export function meetingNow(events: CalendarEvent[], now: number): CalendarEvent | undefined {
  return events.find((e) => {
    if (e.allDay) return false;
    const start = +new Date(e.start), end = +new Date(e.end);
    return start <= now && now < end && end - start <= 8 * 3_600_000;
  });
}

/**
 * Values of Windows' SHQueryUserNotificationState that mean "do not interrupt":
 * 2 busy (a full-screen app), 3 a full-screen Direct3D game, 4 presentation mode, 6 quiet time (Focus Assist), 7 a full-screen store app.
 * 1 (screen saver / locked) and 5 (ready for notifications) do not.
 */
export const isBusyNotificationState = (state: number) => [2, 3, 4, 6, 7].includes(state);

/** Parses the lines the Windows probe prints (one integer per line), returning the last valid state. */
export function lastNotificationState(output: string): number | undefined {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
  return lines.length ? Number(lines[lines.length - 1]) : undefined;
}

/** Epoch ms of the next occurrence of `hour`:00 local time, strictly after `now` (for "quiet until tomorrow morning"). */
export function nextLocalHour(now: number, hour: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (+d <= now) d.setDate(d.getDate() + 1);
  return +d;
}
