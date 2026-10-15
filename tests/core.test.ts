import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, EmailSummary, Settings } from '../shared/types';
import { buildEventBody } from '../electron/google/calendar';
import { parseFrom } from '../electron/google/gmail';
import { aiTriageEmails, executeTool, runAgent, type AgentDeps } from '../electron/agent/agent';
import { stripThinking, type OllamaMessage } from '../electron/agent/ollama';
import { rankEmails, scoreEmail } from '../electron/services/emailScoring';
import { ReminderScheduler } from '../electron/services/reminders';
import { addMinutesLocal, parseLocal } from '../electron/services/time';

// The pure modules under test transitively import electron via ../store; stub it.
vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

const settings: Settings = {
  mascotName: 'Lumi', widgetMode: 'desktop', widgetView: 'mascot', widgetScale: 1, panelScale: 1, startInTray: false, skin: 'classic', customColor: '#ff6fae', colorSwatches: [], shape: 'star', accessories: [], mascotLife: true, followMouse: true, petReactions: true, dndFullscreen: true, dndMeetings: false, dndHideWidget: true, quickCapture: true, quickCaptureShortcut: 'CommandOrControl+Shift+Space', weather: true, weatherPlace: '', temperatureUnit: 'c', seasonalLook: true, reactToSystem: true, proactiveTips: true, tipFrequency: 'normal', keepSignedIn: true, autoSetupOllama: true, sleepAfterMinutes: 3, reactToMusic: true, autoUpdate: true, autoInstallUpdates: true, autoStartOllama: false, morningBriefing: false, briefingTime: '08:00', focusMinutes: 25, voiceLanguage: 'system', modelChat: '', modelTriage: '', modelWriting: '', launchAtLogin: false, reminderLeadMinutes: [15, 5], systemNotifications: true,
  ollamaUrl: 'http://x', ollamaModel: 'm', aiEmailTriage: true, emailLookbackDays: 2,
};

const ev = (id: string, startInMin: number, now: Date, allDay = false): CalendarEvent => ({
  id, title: `Event ${id}`, allDay,
  start: new Date(now.getTime() + startInMin * 60_000).toISOString(),
  end: new Date(now.getTime() + (startInMin + 30) * 60_000).toISOString(),
});

const email = (over: Partial<EmailSummary>): EmailSummary => ({
  id: 'e1', threadId: 't1', from: 'Ana', fromEmail: 'ana@acme.com', to: 'me@x.com', subject: 'Hello', snippet: '',
  date: new Date().toISOString(), labelIds: ['INBOX'], hasListUnsubscribe: false, ...over,
});

describe('ReminderScheduler', () => {
  const now = new Date('2026-10-12T10:00:00Z');

  it('fires each lead once', () => {
    const s = new ReminderScheduler([15, 5]);
    const e = ev('a', 15, now);
    expect(s.due([e], now)).toHaveLength(1);
    expect(s.due([e], now)).toHaveLength(0);
    const later = new Date(now.getTime() + 10 * 60_000);
    const r = s.due([e], later);
    expect(r).toHaveLength(1);
    expect(r[0].minutesUntil).toBe(5);
    expect(s.due([e], later)).toHaveLength(0);
  });

  it('only fires the closest lead when several have passed', () => {
    const s = new ReminderScheduler([15, 5]);
    const r = s.due([ev('a', 3, now)], now);
    expect(r).toHaveLength(1);
    expect(r[0].message).toContain('3 minutes');
    expect(s.due([ev('a', 3, now)], new Date(now.getTime() + 60_000))).toHaveLength(0);
  });

  it('skips far, all-day and finished events', () => {
    const s = new ReminderScheduler([15]);
    expect(s.due([ev('far', 120, now), ev('day', 5, now, true), ev('old', -10, now)], now)).toHaveLength(0);
  });

  it('re-fires when an event is rescheduled', () => {
    const s = new ReminderScheduler([5]);
    expect(s.due([ev('a', 4, now)], now)).toHaveLength(1);
    expect(s.due([ev('a', 2, now)], now)).toHaveLength(1);
  });
});

describe('scoreEmail', () => {
  it('ranks a personal urgent email above a promotion', () => {
    const urgent = scoreEmail(email({ id: '1', subject: 'Contract deadline today', labelIds: ['INBOX', 'IMPORTANT', 'UNREAD'] }), 'me@x.com');
    const promo = scoreEmail(email({ id: '2', fromEmail: 'no-reply@shop.com', subject: '50% off', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], hasListUnsubscribe: true }), 'me@x.com');
    expect(urgent.level).toBe('high');
    expect(promo.level).toBe('low');
    expect(urgent.reasons).toContain('Marked important by Gmail');
    expect(rankEmails([promo, urgent])[0].id).toBe('1');
  });

  it('understands Portuguese keywords', () => {
    const s = scoreEmail(email({ subject: 'Pagamento da fatura vence amanhã' }));
    expect(s.reasons.some((r) => r.startsWith('Mentions'))).toBe(true);
  });

  it('does not match keywords inside other words', () => {
    const s = scoreEmail(email({ subject: 'Design review', snippet: 'resign' }));
    expect(s.reasons.some((r) => r.startsWith('Mentions'))).toBe(false);
  });

  it('blends AI scores', () => {
    const a = scoreEmail(email({ id: 'a' }));
    const ranked = rankEmails([a], { a: { score: 100, reason: 'Boss' } });
    expect(ranked[0].score).toBe(Math.round(0.5 * a.score + 50));
    expect(ranked[0].aiReason).toBe('Boss');
  });
});

describe('calendar helpers', () => {
  it('builds a timed event with default duration', () => {
    const body = buildEventBody({ title: ' Call ', start: '2026-10-13T15:00' }, 'Europe/Dublin');
    expect(body).toMatchObject({ summary: 'Call', start: { dateTime: '2026-10-13T15:00:00', timeZone: 'Europe/Dublin' }, end: { dateTime: '2026-10-13T16:00:00' } });
  });

  it('handles midnight rollover and duration', () => {
    expect(addMinutesLocal('2026-12-31T23:30', 45)).toBe('2027-01-01T00:15');
    const body = buildEventBody({ title: 'x', start: '2026-10-13T23:30', durationMinutes: 90 }, 'UTC') as any;
    expect(body.end.dateTime).toBe('2026-10-14T01:00:00');
  });

  it('builds all-day events with exclusive end', () => {
    const body = buildEventBody({ title: 'Trip', start: '2026-10-20' }) as any;
    expect(body.start).toEqual({ date: '2026-10-20' });
    expect(body.end).toEqual({ date: '2026-10-21' });
  });

  it('rejects bad input', () => {
    expect(() => buildEventBody({ title: '', start: '2026-10-13T10:00' })).toThrow();
    expect(() => buildEventBody({ title: 'x', start: 'tomorrow' })).toThrow();
    expect(() => parseLocal('13/10/2026')).toThrow();
  });
});

describe('ollama helpers', () => {
  it('strips reasoning blocks', () => {
    expect(stripThinking('<think>secret\nplan</think>\nHello')).toBe('Hello');
  });
});

describe('gmail helpers', () => {
  it('parses From headers', () => {
    expect(parseFrom('"Ana Ribeiro" <ana@acme.com>')).toEqual({ name: 'Ana Ribeiro', email: 'ana@acme.com' });
    expect(parseFrom('bob@x.com')).toEqual({ name: 'bob@x.com', email: 'bob@x.com' });
  });
});

describe('agent', () => {
  const baseDeps = (over: Partial<AgentDeps> = {}): AgentDeps => ({
    getSettings: () => settings,
    getProfile: async () => ({ name: 'Pablo', email: 'p@x.com' }),
    listEvents: async () => [],
    getImportantEmails: async () => [],
    searchEmails: async () => [],
    createEvent: async (i) => ({ id: 'n', title: i.title, start: new Date().toISOString(), end: new Date().toISOString(), allDay: false }),
    searchNews: async () => [],
    searchArticles: async () => [],
    readWebsite: async () => [],
    listRoutines: () => [],
    saveRoutine: () => [],
    removeRoutine: () => [],
    confirm: async () => true,
    onStatus: () => undefined,
    ...over,
  });

  it('runs a tool call loop and returns the final answer', async () => {
    const replies: OllamaMessage[] = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_upcoming_events', arguments: { days: 1 } } }] },
      { role: 'assistant', content: 'You have one event ✦' },
    ];
    const seen: OllamaMessage[][] = [];
    const chat = async (o: { messages: OllamaMessage[] }) => { seen.push([...o.messages]); return replies.shift()!; };
    const now = new Date();
    const out = await runAgent([{ role: 'user', content: 'today?' }], baseDeps({ chat: chat as any, listEvents: async () => [ev('1', 30, now)] }));
    expect(out).toBe('You have one event ✦');
    const toolMsg = seen[1].find((m) => m.role === 'tool')!;
    expect(toolMsg.content).toContain('Event 1');
    expect(seen[0][0].content).toContain('Lumi');
  });

  it('does not create events the user declines', async () => {
    let created = false;
    const deps = baseDeps({ confirm: async () => false, createEvent: async () => { created = true; throw new Error('no'); } });
    const res = await executeTool('create_calendar_event', { title: 'X', start: '2026-10-13T10:00' }, deps);
    expect(created).toBe(false);
    expect(res).toMatch(/declined/);
  });

  it('creates events after confirmation', async () => {
    const res = await executeTool('create_calendar_event', { title: 'Lunch', start: '2026-10-13T12:00' }, baseDeps());
    expect(res).toContain('Created event');
  });

  it('creates a routine (not a calendar event) after confirmation', async () => {
    const saved: unknown[] = [];
    let asked: any;
    const deps = baseDeps({
      confirm: async (req) => { asked = req; return true; },
      saveRoutine: (i) => { saved.push(i); return []; },
      createEvent: async () => { throw new Error('must not touch the calendar'); },
    });
    const res = await executeTool('create_routine', { name: 'AI news', kind: 'news', target: 'LLM', time: '08:00' }, deps);
    expect(res).toContain('Created routine');
    expect(asked.kind).toBe('create_routine');
    expect(saved).toHaveLength(1);
  });

  it('does not create a routine the user declines or that is invalid', async () => {
    let saved = false;
    const deps = baseDeps({ confirm: async () => false, saveRoutine: () => { saved = true; return []; } });
    expect(await executeTool('create_routine', { name: 'X', kind: 'news', target: 'a' }, deps)).toMatch(/declined/);
    expect(await executeTool('create_routine', { name: 'X', kind: 'site', target: 'not a url' }, baseDeps())).toMatch(/NOT created/);
    expect(saved).toBe(false);
  });

  it('deletes a routine only when it exists and the user agrees', async () => {
    const r = { id: 'r1', name: 'AI news', kind: 'news', target: 'LLM', language: 'en', frequency: 'daily', time: '08:00', maxItems: 5, useAi: true, enabled: true, createdAt: 0 } as const;
    const removed: string[] = [];
    const deps = baseDeps({ listRoutines: () => [r], removeRoutine: (id) => { removed.push(id); return []; } });
    expect(await executeTool('delete_routine', { id: 'nope' }, deps)).toMatch(/no routine/);
    expect(await executeTool('delete_routine', { id: 'r1' }, deps)).toContain('Deleted');
    expect(removed).toEqual(['r1']);
  });

  it('a scheduled (unattended) run only gets read tools and cannot write', async () => {
    const offered: string[][] = [];
    const chat = async (o: any) => { offered.push(o.tools.map((t: any) => t.function.name)); return { role: 'assistant' as const, content: 'Report ✦' }; };
    const out = await runAgent([{ role: 'user', content: 'brief me' }], baseDeps({ chat: chat as any, unattended: true }));
    expect(out).toBe('Report ✦');
    expect(offered[0]).toContain('search_news');
    expect(offered[0]).not.toContain('create_calendar_event');
    expect(offered[0]).not.toContain('create_routine');
    let created = false;
    const res = await executeTool('create_calendar_event', { title: 'X', start: '2026-10-13T10:00' }, baseDeps({ unattended: true, createEvent: async () => { created = true; throw new Error('no'); } }));
    expect(res).toMatch(/cannot be done/);
    expect(created).toBe(false);
  });

  it('an unattended run that gives up or answers nothing fails instead of saving junk', async () => {
    const silent = async () => ({ role: 'assistant' as const, content: '' });
    await expect(runAgent([{ role: 'user', content: 'x' }], baseDeps({ chat: silent as any, unattended: true }))).rejects.toThrow();
    const looping = async () => ({ role: 'assistant' as const, content: '', tool_calls: [{ function: { name: 'list_routines', arguments: {} } }] });
    await expect(runAgent([{ role: 'user', content: 'x' }], baseDeps({ chat: looping as any, unattended: true }))).rejects.toThrow(/steps/);
  });

  it('creates an instructions routine from the chat tool', async () => {
    const saved: any[] = [];
    const deps = baseDeps({ saveRoutine: (i) => { saved.push(i); return []; } });
    const res = await executeTool('create_routine', { name: 'Briefing', kind: 'task', instructions: 'List my meetings.', time: '07:30' }, deps);
    expect(res).toContain('Created routine');
    expect(saved[0]).toMatchObject({ kind: 'task', target: 'List my meetings.', time: '07:30' });
  });

  it('AI triage tolerates garbage output', async () => {
    const chat = async () => ({ role: 'assistant' as const, content: 'not json' });
    expect(await aiTriageEmails([scoreEmail(email({}))], settings, chat as any)).toEqual({});
  });

  it('AI triage parses scores', async () => {
    const chat = async () => ({ role: 'assistant' as const, content: '{"emails":[{"id":"e1","score":88,"reason":"Client"}]}' });
    expect(await aiTriageEmails([scoreEmail(email({}))], settings, chat as any)).toEqual({ e1: { score: 88, reason: 'Client' } });
  });
});
