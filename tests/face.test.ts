import { describe, expect, it } from 'vitest';
import { IDLE_ACTIONS } from '../src/behavior';
import { faceFor, GRIN_ACTIONS, moodFor, type Mood } from '../src/face';

const base = { mood: 'idle' as Mood, sleeping: false, dancing: false, action: 'none' as const };
const OPEN_EYES = new Set(['idle', 'alert', 'thinking']);

describe('expressions', () => {
  it('has open eyes by default', () => {
    expect(faceFor(base)).toEqual({ eyes: 'idle', mouth: 'idle' });
  });

  it('keeps her eyes open while dancing and during almost every action', () => {
    expect(faceFor({ ...base, dancing: true })).toEqual({ eyes: 'idle', mouth: 'happy' });
    for (const a of IDLE_ACTIONS.map((x) => x.action)) {
      const { eyes } = faceFor({ ...base, action: a });
      if (a !== 'cheer') expect(OPEN_EYES.has(eyes), `eyes during "${a}"`).toBe(true);
    }
    for (const a of GRIN_ACTIONS) expect(faceFor({ ...base, action: a })).toEqual({ eyes: 'idle', mouth: 'happy' });
  });

  it('closes them only for cheering, a yawn (handled in the drawing), or real sleep', () => {
    expect(faceFor({ ...base, action: 'cheer' }).eyes).toBe('happy');
    expect(faceFor({ ...base, sleeping: true, dancing: true, action: 'hop' })).toEqual({ eyes: 'sleepy', mouth: 'sleepy' });
    const closed = IDLE_ACTIONS.map((x) => x.action).filter((a) => !OPEN_EYES.has(faceFor({ ...base, action: a }).eyes));
    expect(closed).toEqual(['cheer']);
  });

  it('keeps her eyes open when she is just happy after a click or sign-in', () => {
    expect(faceFor({ ...base, mood: 'happy' })).toEqual({ eyes: 'idle', mouth: 'happy' });
  });

  it('lets reminders and thinking override cheerfulness', () => {
    expect(faceFor({ ...base, mood: 'alert', dancing: true, action: 'hop' })).toEqual({ eyes: 'alert', mouth: 'alert' });
    expect(faceFor({ ...base, mood: 'thinking', action: 'cheer' })).toEqual({ eyes: 'thinking', mouth: 'thinking' });
  });
});

describe('mood', () => {
  it('is never drowsy because of the time of day', () => {
    // No input describes the clock any more, so no hour can make her sleepy.
    expect(moodFor({ reminder: false, busy: false, recentlyHappy: false })).toBe('idle');
  });

  it('prioritises reminders, then work, then a happy moment', () => {
    expect(moodFor({ reminder: true, busy: true, recentlyHappy: true })).toBe('alert');
    expect(moodFor({ reminder: false, busy: true, recentlyHappy: true })).toBe('thinking');
    expect(moodFor({ reminder: false, busy: false, recentlyHappy: true })).toBe('happy');
  });
});

describe('reaction expressions', () => {
  const base = { mood: 'idle' as Mood, sleeping: false, dancing: false, action: 'none' as const };

  it('laughs and purrs with happy closed eyes, and keeps her eyes open when shy or about to bite', () => {
    expect(faceFor({ ...base, reaction: 'giggle' })).toEqual({ eyes: 'happy', mouth: 'laugh' });
    expect(faceFor({ ...base, reaction: 'purr' })).toEqual({ eyes: 'happy', mouth: 'purr' });
    expect(faceFor({ ...base, reaction: 'shy' })).toEqual({ eyes: 'idle', mouth: 'shy' });
    expect(faceFor({ ...base, reaction: 'bite' })).toEqual({ eyes: 'idle', mouth: 'chomp', brows: true });
  });

  it('is overridden by sleep, alerts and thinking', () => {
    expect(faceFor({ ...base, reaction: 'bite', sleeping: true }).mouth).toBe('sleepy');
    expect(faceFor({ ...base, mood: 'alert', reaction: 'giggle' })).toEqual({ eyes: 'alert', mouth: 'alert' });
    expect(faceFor({ ...base, mood: 'thinking', reaction: 'purr' })).toEqual({ eyes: 'thinking', mouth: 'thinking' });
  });

  it('only the bite has eyebrows', () => {
    for (const r of ['none', 'giggle', 'purr', 'shy'] as const) expect(faceFor({ ...base, reaction: r }).brows).toBeFalsy();
  });
});
