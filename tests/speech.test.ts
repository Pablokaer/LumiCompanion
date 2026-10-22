import { describe, expect, it } from 'vitest';
import { ACTION_LINE_GAP_MS } from '../src/behavior';
import { ActionLineGate, speechFor, type SpeechInput } from '../src/speech';
import type { CalendarEvent } from '../shared/types';

const now = new Date('2026-10-22T10:00:00');
const inMinutes = (m: number): CalendarEvent => ({
  id: 'e', title: 'Stand-up', allDay: false,
  start: new Date(+now + m * 60_000).toISOString(), end: new Date(+now + (m + 30) * 60_000).toISOString(),
});
const calm: SpeechInput = {
  now, importantEmails: 0, calendarOnly: false, reminderLeadMinutes: [15, 5], thinking: false, dnd: false, sleeping: false, dancing: false,
};

describe('what her bubble says', () => {
  it('on a calm day: the next event, important emails and a greeting', () => {
    expect(speechFor({ ...calm, upcoming: inMinutes(20), importantEmails: 2, firstName: 'Ana' }))
      .toEqual(['“Stand-up” in 20 min ✦', '2 important emails waiting for you', 'Good morning, Ana!']);
    expect(speechFor(calm)).toEqual(['Good morning!', 'Your sky is clear — no more events today 🌌']);
  });

  it('follows the priority order: reminder over everything, then thinking, briefing, focus, quiet mode…', () => {
    const busy: SpeechInput = {
      ...calm, reminder: 'Stand-up in 5 min', thinking: true, focusEndsAt: +now + 10 * 60_000, dnd: true, notice: 'Charging', sleeping: true,
    };
    expect(speechFor(busy)).toEqual(['Stand-up in 5 min']);
    expect(speechFor({ ...busy, reminder: undefined })).toEqual(['Thinking among the stars…']);
    expect(speechFor({ ...busy, reminder: undefined, thinking: false })).toEqual(['Focus time — 10 min left ✦']);
    expect(speechFor({ ...busy, reminder: undefined, thinking: false, focusEndsAt: undefined })).toEqual(['🔕 Quiet mode — I will stay out of your way']);
    expect(speechFor({ ...calm, notice: 'Charging', sleeping: true })).toEqual(['Charging']);
    expect(speechFor({ ...calm, sleeping: true, actionLine: 'Hi there! 👋' })).toEqual(['Zzz… 💤']);
    expect(speechFor({ ...calm, dancing: true, bpm: 120 })[0]).toBe('♪ 120 BPM — I love this one!');
  });

  it('in calendar-only mode: silent unless an event is about to start, but reminders still show', () => {
    const quiet = { ...calm, calendarOnly: true, notice: 'Charging', importantEmails: 3, thinking: true };
    expect(speechFor(quiet)).toEqual([]);
    expect(speechFor({ ...quiet, upcoming: inMinutes(40) })).toEqual([]);
    expect(speechFor({ ...quiet, upcoming: inMinutes(12) })).toEqual(['“Stand-up” in 12 min ✦']);
    expect(speechFor({ ...quiet, upcoming: inMinutes(25), reminderLeadMinutes: [30] })).toEqual(['“Stand-up” in 25 min ✦']);
    expect(speechFor({ ...quiet, upcoming: inMinutes(-5) })).toEqual([]); // already started
    expect(speechFor({ ...quiet, reminder: 'Stand-up now' })).toEqual(['Stand-up now']);
  });
});

describe('action lines', () => {
  it('speak at most once per gap, and never for actions without a line', () => {
    const gate = new ActionLineGate();
    expect(gate.lineFor('wave', 0)).toBe('Hi there! 👋');
    expect(gate.lineFor('none', 1000)).toBeUndefined();
    expect(gate.lineFor('cheer', 60_000)).toBeUndefined();
    expect(gate.lineFor('spin', ACTION_LINE_GAP_MS + 1)).toBeUndefined(); // no line for a spin
    expect(gate.lineFor('cheer', ACTION_LINE_GAP_MS + 2)).toBe('Woohoo! ✦');
  });
});
