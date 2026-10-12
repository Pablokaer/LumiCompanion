import { describe, expect, it } from 'vitest';
import { computeDnd, isBusyNotificationState, lastNotificationState, meetingNow, nextLocalHour } from '../shared/dnd';
import type { CalendarEvent } from '../shared/types';

const NOW = new Date(2026, 9, 14, 10, 30).getTime();
const on = { dndFullscreen: true, dndMeetings: true };
const off = { dndFullscreen: false, dndMeetings: false };
const ev = (title: string, startH: number, endH: number, allDay = false): CalendarEvent => ({
  id: title, title, allDay, start: new Date(2026, 9, 14, startH).toISOString(), end: new Date(2026, 9, 14, endH).toISOString(),
});

describe('do not disturb', () => {
  it('is off when nothing applies', () => {
    expect(computeDnd({ now: NOW, fullscreen: false, settings: on })).toEqual({ active: false });
  });

  it('a manual pause lasts until its end time, and then lets go', () => {
    expect(computeDnd({ now: NOW, manualUntil: NOW + 60_000, fullscreen: false, settings: off })).toEqual({ active: true, reason: 'manual', until: NOW + 60_000 });
    expect(computeDnd({ now: NOW, manualUntil: NOW - 1, fullscreen: false, settings: off })).toEqual({ active: false });
  });

  it('a full-screen app only counts when the setting is on', () => {
    expect(computeDnd({ now: NOW, fullscreen: true, settings: on })).toEqual({ active: true, reason: 'fullscreen' });
    expect(computeDnd({ now: NOW, fullscreen: true, settings: off })).toEqual({ active: false });
  });

  it('a meeting only counts when the setting is on, and names the meeting', () => {
    expect(computeDnd({ now: NOW, fullscreen: false, meeting: { title: 'Standup' }, settings: on })).toEqual({ active: true, reason: 'meeting', meeting: 'Standup' });
    expect(computeDnd({ now: NOW, fullscreen: false, meeting: { title: 'Standup' }, settings: off })).toEqual({ active: false });
  });

  it('prefers a manual pause over a full-screen app over a meeting', () => {
    const both = { now: NOW, fullscreen: true, meeting: { title: 'x' }, settings: on };
    expect(computeDnd(both).reason).toBe('fullscreen');
    expect(computeDnd({ ...both, manualUntil: NOW + 1000 }).reason).toBe('manual');
  });
});

describe('meetings', () => {
  it('finds the timed event running now', () => {
    expect(meetingNow([ev('Early', 8, 9), ev('Now', 10, 11), ev('Later', 12, 13)], NOW)?.title).toBe('Now');
    expect(meetingNow([ev('Early', 8, 9)], NOW)).toBeUndefined();
  });

  it('ignores all-day events and very long ones, and an event that just ended', () => {
    expect(meetingNow([ev('Holiday', 0, 24, true)], NOW)).toBeUndefined();
    expect(meetingNow([ev('Conference', 7, 17)], NOW)).toBeUndefined(); // 10 hours: not a meeting
    expect(meetingNow([ev('Ended', 9, 10)], NOW)).toBeUndefined(); // ended exactly at 10:00, it is 10:30
  });
});

describe('Windows notification state', () => {
  it('treats full-screen, presentation and Focus Assist as busy', () => {
    for (const s of [2, 3, 4, 6, 7]) expect(isBusyNotificationState(s), String(s)).toBe(true);
    for (const s of [1, 5, 0, 99]) expect(isBusyNotificationState(s), String(s)).toBe(false);
  });

  it('reads the last valid number the probe printed', () => {
    expect(lastNotificationState('5\r\n5\r\n3\r\n')).toBe(3);
    expect(lastNotificationState('warning: something\n5\nnoise\n')).toBe(5);
    expect(lastNotificationState('')).toBeUndefined();
    expect(lastNotificationState('error\nfailed')).toBeUndefined();
  });
});

describe('quiet until tomorrow', () => {
  it('is the next 8:00, today if it is still ahead', () => {
    expect(nextLocalHour(new Date(2026, 9, 14, 6, 0).getTime(), 8)).toBe(new Date(2026, 9, 14, 8, 0).getTime());
    expect(nextLocalHour(new Date(2026, 9, 14, 10, 30).getTime(), 8)).toBe(new Date(2026, 9, 15, 8, 0).getTime());
    expect(nextLocalHour(new Date(2026, 9, 14, 8, 0).getTime(), 8)).toBe(new Date(2026, 9, 15, 8, 0).getTime()); // exactly 8:00: strictly after
  });
});
