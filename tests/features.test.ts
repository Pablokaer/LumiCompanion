import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, ScoredEmail, Settings } from '../shared/types';
import { draftReply, normalizeSuggestion, replySubject, suggestEventFromEmail } from '../electron/agent/mailTools';
import { ensureOllama, isLocalUrl, modelFor, ollamaCandidates } from '../electron/agent/ollama';
import { reviewAnswer, applyCitations, type ParsedAssignment } from '../electron/docs/assignment';
import type { Source } from '../electron/docs/sources';
import { buildRawMessage, extractBody, htmlToText, type FullEmail } from '../electron/google/gmail';
import { briefingDate, buildBriefing, shouldShowBriefing } from '../electron/services/briefing';
import { FocusService, shouldHoldReminder } from '../electron/services/focus';
import { skinVars } from '../src/appearance';
import { transcribe } from '../electron/voice/transcribe';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

const settings: Settings = {
  mascotName: 'Lumi', widgetMode: 'desktop', widgetView: 'mascot', widgetScale: 1, panelScale: 1, startInTray: false, skin: 'classic', customColor: '#ff6fae', colorSwatches: [], shape: 'star', accessories: [], mascotLife: true, followMouse: true, petReactions: true, dndFullscreen: true, dndMeetings: false, dndHideWidget: true, quickCapture: true, quickCaptureShortcut: 'CommandOrControl+Shift+Space', weather: true, weatherPlace: '', temperatureUnit: 'c', seasonalLook: true, reactToSystem: true, proactiveTips: true, tipFrequency: 'normal', keepSignedIn: true, autoSetupOllama: true, sleepAfterMinutes: 3, reactToMusic: true, autoUpdate: true, autoStartOllama: false,
  morningBriefing: true, briefingTime: '08:00', focusMinutes: 25, voiceLanguage: 'system', launchAtLogin: false,
  reminderLeadMinutes: [15, 5], systemNotifications: true, ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'main',
  modelChat: '', modelTriage: '', modelWriting: '', aiEmailTriage: true, emailLookbackDays: 2,
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('models per task', () => {
  it('falls back to the default model unless a task override is set', () => {
    expect(modelFor(settings, 'chat')).toBe('main');
    expect(modelFor({ ...settings, modelWriting: 'big' }, 'writing')).toBe('big');
    expect(modelFor({ ...settings, modelWriting: 'big' }, 'triage')).toBe('main');
    expect(modelFor({ ...settings, modelTriage: '  ' }, 'triage')).toBe('main');
  });
});

describe('ollama auto-start', () => {
  it('only treats loopback servers as local', () => {
    expect(isLocalUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalUrl('http://localhost:11434')).toBe(true);
    expect(isLocalUrl('http://192.168.1.5:11434')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });

  it('looks in Lumi\'s own folder, then the per-user install folder, on Windows', () => {
    const c = ollamaCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } as NodeJS.ProcessEnv);
    expect(c[0]).toContain('Lumi');
    expect(c[1]).toContain('Programs');
    expect(ollamaCandidates('darwin').at(-1)).toBe('ollama');
  });

  it('does nothing when it is already running or the server is remote', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'm' }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await ensureOllama('http://127.0.0.1:11434')).running).toBe(true);
    fetchMock.mockImplementation(async () => { throw new Error('down'); });
    expect((await ensureOllama('http://example.com:11434', 10)).running).toBe(false);
  });
});

describe('morning briefing', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m);
  const ev = (title: string, start: Date, mins = 60, allDay = false): CalendarEvent => ({
    id: title, title, start: start.toISOString(), end: new Date(+start + mins * 60_000).toISOString(), allDay,
  });
  const mail = (from: string, level: 'high' | 'low'): ScoredEmail => ({
    id: from, threadId: from, from, fromEmail: `${from}@x.com`, to: '', subject: `Hi from ${from}`, snippet: '', date: '', labelIds: [],
    hasListUnsubscribe: false, score: 80, level, reasons: [], url: '',
  });

  it('shows once per day after the configured time', () => {
    const s = { morningBriefing: true, briefingTime: '08:00' };
    expect(shouldShowBriefing(s, at(7, 59))).toBe(false);
    expect(shouldShowBriefing(s, at(8, 0))).toBe(true);
    expect(shouldShowBriefing({ ...s, lastBriefingDate: briefingDate(at(8)) }, at(9))).toBe(false);
    expect(shouldShowBriefing({ ...s, lastBriefingDate: '2026-10-11' }, at(9))).toBe(true);
    expect(shouldShowBriefing({ ...s, morningBriefing: false }, at(9))).toBe(false);
    expect(shouldShowBriefing({ ...s, briefingTime: 'garbage' }, at(7, 30))).toBe(false);
  });

  it('lists today’s remaining events and only the high-importance emails', () => {
    const b = buildBriefing(
      [ev('Past', at(8), 30), ev('Stand-up', at(10)), ev('Tomorrow', new Date(2026, 9, 13, 10)), ev('Holiday', new Date(2026, 9, 12), 24 * 60, true)],
      [mail('Ana', 'high'), mail('News', 'low')],
      at(9, 30),
      'Pablo',
    );
    expect(b.title).toBe('Good morning, Pablo! Here is your day');
    expect(b.lines).toContain('2 events today:');
    expect(b.lines).toContain('• All day — Holiday');
    expect(b.lines).toContain('• 10:00 — Stand-up');
    expect(b.lines.join('\n')).not.toContain('Past');
    expect(b.lines.join('\n')).not.toContain('Tomorrow');
    expect(b.lines).toContain('1 important email:');
    expect(b.lines.join('\n')).not.toContain('News');
  });

  it('says so when there is nothing on', () => {
    expect(buildBriefing([], [], at(9)).lines).toEqual(['Your calendar is clear today — no events ✦', 'No urgent emails right now.']);
  });
});

describe('focus timer', () => {
  it('counts down, emits changes and finishes', () => {
    vi.useFakeTimers();
    const focus = new FocusService();
    const changed = vi.fn();
    const done = vi.fn();
    focus.on('changed', changed);
    focus.on('done', done);
    const state = focus.start(25);
    expect(state.minutes).toBe(25);
    expect(focus.current?.endsAt).toBe(Date.now() + 25 * 60_000);
    vi.advanceTimersByTime(24 * 60_000);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ minutes: 25 }));
    expect(focus.current).toBeUndefined();
    expect(changed).toHaveBeenLastCalledWith(undefined);
  });

  it('can be stopped and clamps absurd lengths', () => {
    vi.useFakeTimers();
    const focus = new FocusService();
    const done = vi.fn();
    focus.on('done', done);
    expect(focus.start(9999).minutes).toBe(180);
    focus.stop();
    vi.advanceTimersByTime(200 * 60_000);
    expect(done).not.toHaveBeenCalled();
    expect(focus.start(0).minutes).toBe(25);
  });

  it('only holds back reminders that are not urgent', () => {
    expect(shouldHoldReminder(true, 15)).toBe(true);
    expect(shouldHoldReminder(true, 5)).toBe(false);
    expect(shouldHoldReminder(false, 15)).toBe(false);
  });
});

describe('gmail drafts', () => {
  const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

  it('builds a threaded, UTF-8 safe message', () => {
    const mime = decode(buildRawMessage({ threadId: 't', to: 'ana@x.com', subject: 'Re: Reunião', body: 'Olá, tudo bem?\nAté já', inReplyTo: '<abc@mail>' }));
    const [head, body] = mime.split('\r\n\r\n');
    expect(head).toContain('To: ana@x.com');
    expect(head).toContain('In-Reply-To: <abc@mail>');
    expect(head).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Olá, tudo bem?\nAté já');
  });

  it('cannot be tricked into injecting headers', () => {
    const mime = decode(buildRawMessage({ threadId: 't', to: 'a@x.com\r\nBcc: evil@x.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'x' }));
    expect(mime.split('\r\n\r\n')[0].split('\r\n').filter((l) => l.startsWith('Bcc'))).toEqual([]);
  });

  it('reads the plain text part, or strips HTML', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    expect(extractBody({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<b>no</b>') } }, { mimeType: 'text/plain', body: { data: b64('hello') } }] })).toBe('hello');
    expect(extractBody({ mimeType: 'text/html', body: { data: b64('<p>Hi&nbsp;there</p><style>x{}</style><p>Bye</p>') } })).toBe('Hi there\nBye');
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });
});

describe('mail tools', () => {
  const email: FullEmail = {
    summary: { id: 'm1', threadId: 't1', from: 'Carlos', fromEmail: 'carlos@x.com', to: '', subject: 'Interview slots', snippet: '', date: '2026-10-12', labelIds: [], hasListUnsubscribe: false },
    body: 'Would Tuesday at 10:00 work?', messageId: '<id@x>', replyTo: 'carlos@x.com',
  };
  const fakeChat = (content: string) => vi.fn(async () => ({ role: 'assistant' as const, content }));

  it('drafts a reply addressed to the right person, never sending anything', async () => {
    const chat = fakeChat('Tuesday works.\n\nPablo');
    const d = await draftReply(email, 'accept', 'Pablo', { ...settings, modelWriting: 'writer' }, chat as never);
    expect(d).toMatchObject({ to: 'carlos@x.com', subject: 'Re: Interview slots', threadId: 't1', inReplyTo: '<id@x>', body: 'Tuesday works.\n\nPablo' });
    expect((chat.mock.calls[0] as unknown as [{ model: string }])[0].model).toBe('writer');
    await expect(draftReply(email, undefined, undefined, settings, fakeChat('  ') as never)).rejects.toThrow('empty reply');
  });

  it('does not stack Re: prefixes', () => {
    expect(replySubject('Re: Hi')).toBe('Re: Hi');
    expect(replySubject('Hi')).toBe('Re: Hi');
  });

  it('accepts only complete, valid event suggestions', () => {
    expect(normalizeSuggestion({ found: false })).toBeUndefined();
    expect(normalizeSuggestion({ found: true, title: 'x', start: 'next week' })).toBeUndefined();
    expect(normalizeSuggestion({ found: true, title: '', start: '2026-10-13T10:00' })).toBeUndefined();
    expect(normalizeSuggestion({ found: true, title: 'Interview', start: '2026-10-13T10:00', end: '2026-10-13T11:00', location: 'Zoom' }))
      .toMatchObject({ title: 'Interview', start: '2026-10-13T10:00', end: '2026-10-13T11:00', location: 'Zoom' });
    expect(normalizeSuggestion({ found: true, title: 'Due', start: '2026-10-20', end: '' })).toMatchObject({ start: '2026-10-20', allDay: true, end: undefined });
    expect(normalizeSuggestion({ found: true, title: 'Bad end', start: '2026-10-13T10:00', end: '2026-10-13T09:00' })?.end).toBeUndefined();
  });

  it('survives a model that does not return JSON', async () => {
    expect(await suggestEventFromEmail(email, settings, new Date(2026, 9, 12), fakeChat('not json') as never)).toBeUndefined();
    const ok = fakeChat(JSON.stringify({ found: true, title: 'Interview', start: '2026-10-13T10:00' }));
    expect((await suggestEventFromEmail(email, settings, new Date(2026, 9, 12), ok as never))?.title).toBe('Interview');
  });
});

describe('answer review', () => {
  const src = (id: string): Source => ({ id, title: `Paper ${id}`, authors: [{ given: 'A', family: 'Silva' }], year: 2020, abstract: 'x'.repeat(100) });
  const parsed: ParsedAssignment = { title: 't', language: 'en', style: 'APA', instructions: '', questions: [] };
  const noAi = vi.fn(async () => JSON.stringify({ unsupported: [] }));

  it('flags uncited paragraphs, unused sources and dropped markers', async () => {
    const sources = [src('1'), src('2')];
    const { text, cited, dropped } = applyCitations('Cited claim [1].\n\nUncited paragraph.\n\nBogus [9].', sources, 'APA');
    expect(dropped).toBe(1);
    const notes = await reviewAnswer(text, sources, cited, dropped, parsed, noAi);
    expect(notes).toEqual(['Paragraph 2 has no citation.', 'Paragraph 3 has no citation.', '1 citation(s) with no matching source were removed.']);
  });

  it('adds claims the model finds unsupported, and tolerates a broken model', async () => {
    const sources = [src('1')];
    const { text, cited, dropped } = applyCitations('Teams learn [1].', sources, 'APA');
    const ai = vi.fn(async () => JSON.stringify({ unsupported: ['Productivity rises 40%'] }));
    expect(await reviewAnswer(text, sources, cited, dropped, parsed, ai)).toEqual(['Possibly unsupported by the sources: “Productivity rises 40%”']);
    expect(await reviewAnswer(text, sources, cited, dropped, parsed, vi.fn(async () => 'nope'))).toEqual([]);
  });

  it('notes an answer that cites nothing, and skips unsourced questions', async () => {
    expect(await reviewAnswer('Plain text.', [src('1')], [], 0, parsed, noAi)).toEqual(['The answer cites none of the 1 retrieved sources.']);
    expect(await reviewAnswer('Plain text.', [], [], 0, parsed, noAi)).toEqual([]);
  });
});

describe('appearance and voice', () => {
  it('re-themes the UI per skin', () => {
    expect(skinVars('sunset')['--star']).toBe('#ffb547');
    expect(skinVars('nope' as never)['--star']).toBe('#5cb8ff');
  });

  it('transcribing silence-free empty audio returns nothing without loading the model', async () => {
    expect(await transcribe(new Float32Array(0), 'unused')).toBe('');
  });
});
