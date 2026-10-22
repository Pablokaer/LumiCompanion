import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReminderPayload, Settings } from '../shared/types';
import type { Routine } from '../shared/routines';
import { applyPatch, DEFAULT_SETTINGS, sanitizePatch } from '../shared/settings';
import { toEventInput, parseQuickEvent } from '../shared/quickParse';
import { executeTool, type AgentDeps } from '../electron/agent/agent';
import { normalizeSuggestion } from '../electron/agent/mailTools';
import { parseChecksums, releaseAssetUrl, verifyDownload } from '../electron/agent/ollamaSetup';
import { answerAssignment } from '../electron/docs/assignment';
import { getFullEmail } from '../electron/google/gmail';
import { assertPublicUrl, fetchText, isPrivateAddress, readLimited } from '../electron/routines/feeds';
import { runRoutine } from '../electron/routines/runner';
import { scoreEmail } from '../electron/services/emailScoring';
import { holdReminder, releaseReminders } from '../electron/services/reminders';
import { checkNewEvent, isLocalDate, isLocalDateTime, parseLocal } from '../electron/services/time';
import { WeatherService } from '../electron/services/weather';

const googleFetch = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));
vi.mock('../electron/google/auth', () => ({ googleFetch }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); googleFetch.mockReset(); });

describe('dates that only look like dates', () => {
  it('rejects days and times that do not exist', () => {
    for (const bad of ['2025-02-30', '2025-13-01', '2025-00-10', '2025-06-31', '2023-02-29', '2025-01-00']) expect(isLocalDate(bad), bad).toBe(false);
    for (const bad of ['2025-02-30T10:00', '2025-06-31T10:00', '2025-06-30T25:00', '2025-06-30T10:60', '2025-06-30T24:00']) expect(isLocalDateTime(bad), bad).toBe(false);
  });
  it('accepts real ones, leap days included', () => {
    expect(isLocalDate('2024-02-29')).toBe(true);
    expect(isLocalDate('2026-12-31')).toBe(true);
    expect(isLocalDateTime('2025-06-30T23:59')).toBe(true);
    expect(isLocalDateTime('2025-06-30T00:00:30')).toBe(true);
  });
  it('refuses to parse an impossible date instead of silently rolling over', () => {
    expect(() => parseLocal('2025-02-30')).toThrow(/Invalid local date/);
    expect(() => parseLocal('2025-02-30T10:00')).toThrow(/Invalid local date/);
    expect(parseLocal('2025-02-28T10:00').getDate()).toBe(28);
  });
  it('rejects an e-mailed event suggestion with an impossible date', () => {
    expect(normalizeSuggestion({ found: true, title: 'Meeting', start: '2025-02-30T10:00' })).toBeUndefined();
    expect(normalizeSuggestion({ found: true, title: 'Meeting', start: '2025-02-28T10:00' })).toMatchObject({ start: '2025-02-28T10:00' });
  });
});

describe('checking an event before anybody is asked to confirm it', () => {
  it('finds what is wrong', () => {
    expect(checkNewEvent({ title: ' ', start: '2026-10-14T10:00' })).toMatch(/title/);
    expect(checkNewEvent({ title: 'x', start: '2025-02-30T10:00' })).toMatch(/not a real date/);
    expect(checkNewEvent({ title: 'x', start: '2026-10-14T10:00', end: 'later' })).toMatch(/end/);
    expect(checkNewEvent({ title: 'x', start: '2026-10-14T10:00', durationMinutes: Number.NaN })).toMatch(/duration/);
    expect(checkNewEvent({ title: 'x', start: '2026-10-14T10:00', durationMinutes: 0 })).toMatch(/duration/);
    expect(checkNewEvent({ title: 'x', start: '2026-10-14T10:00', durationMinutes: 5000 })).toMatch(/duration/);
  });
  it('lets good events through', () => {
    expect(checkNewEvent({ title: 'x', start: '2026-10-14T10:00', end: '2026-10-14T11:00', durationMinutes: 30 })).toBeUndefined();
    expect(checkNewEvent({ title: 'x', start: '2026-10-14' })).toBeUndefined();
  });

  const deps = () => ({ confirm: vi.fn(async () => true), createEvent: vi.fn(async (i: { title: string; start: string }) => ({ id: '1', title: i.title, start: new Date(2026, 9, 14, 10).toISOString(), end: new Date(2026, 9, 14, 11).toISOString(), allDay: false })) });

  it('the agent does not ask you to approve an impossible event', async () => {
    for (const args of [{ title: 'Dentist', start: '2025-02-30T10:00' }, { title: 'Dentist', start: '2026-10-14T10:00', durationMinutes: 'abc' }, { title: '', start: '2026-10-14T10:00' }]) {
      const d = deps();
      const out = await executeTool('create_calendar_event', args, d as unknown as AgentDeps);
      expect(out).toMatch(/^Error: the event was NOT created/);
      expect(d.confirm).not.toHaveBeenCalled();
      expect(d.createEvent).not.toHaveBeenCalled();
    }
  });
  it('the agent still asks for, and creates, a good event', async () => {
    const d = deps();
    const out = await executeTool('create_calendar_event', { title: 'Dentist', start: '2026-10-14T10:00', durationMinutes: 45 }, d as unknown as AgentDeps);
    expect(d.confirm).toHaveBeenCalledTimes(1);
    expect(d.createEvent).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/^Created event/);
  });
});

describe('what an address may point at', () => {
  it('knows the private and reserved ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.0.1', '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.5', '[::1]', 'nonsense']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '172.15.0.1', '100.63.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses hosts that are, or resolve to, a private address', async () => {
    const lookup = (map: Record<string, string[]>) => async (h: string) => (map[h] ?? []).map((address) => ({ address }));
    await expect(assertPublicUrl(new URL('https://news.example/feed'), lookup({ 'news.example': ['93.184.216.34'] }))).resolves.toBeUndefined();
    await expect(assertPublicUrl(new URL('https://sneaky.example/'), lookup({ 'sneaky.example': ['93.184.216.34', '10.0.0.7'] }))).rejects.toThrow(/not a public website/); // one bad record is enough
    await expect(assertPublicUrl(new URL('https://empty.example/'), lookup({}))).rejects.toThrow(/not a public website/);
    for (const url of ['http://localhost/', 'http://127.0.0.1:8080/', 'http://[::1]/', 'http://192.168.1.1/admin', 'http://printer.local/', 'http://nas.lan/', 'http://169.254.169.254/latest/meta-data']) {
      await expect(assertPublicUrl(new URL(url), lookup({})), url).rejects.toThrow(/not a public website/);
    }
  });

  it('fetchText never reaches a local address, and only speaks http(s)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('http://127.0.0.1:8080/secret')).rejects.toThrow(/not a public website/);
    await expect(fetchText('http://localhost/')).rejects.toThrow(/not a public website/);
    await expect(fetchText('file:///etc/passwd')).rejects.toThrow(/Only http/);
    await expect(fetchText('ftp://93.184.216.34/x')).rejects.toThrow(/Only http/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks every redirect hop, not only the first address', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('93.184.216.34')
      ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/internal' } })
      : new Response('leaked')));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('http://93.184.216.34/feed')).rejects.toThrow(/not a public website/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private hop was never requested
  });

  it('follows redirects between public addresses, and gives up on a loop', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/old')
      ? new Response(null, { status: 301, headers: { location: '/new' } })
      : new Response('<rss></rss>'))));
    expect(await fetchText('http://93.184.216.34/old')).toBe('<rss></rss>');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })));
    await expect(fetchText('http://93.184.216.34/loop')).rejects.toThrow(/too many times/);
  });

  it('reads at most the limit and stops downloading there', async () => {
    let cancelled = false;
    const endless = new Response(new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(1000).fill(97)); },
      cancel() { cancelled = true; },
    }));
    const text = await readLimited(endless, 5000);
    expect(text).toHaveLength(5000);
    expect(cancelled).toBe(true);
    expect(await readLimited(new Response('short and sweet'), 5000)).toBe('short and sweet');
  });
});

describe('what a routine remembers', () => {
  const routine = (patch: Partial<Routine> = {}): Routine => ({ id: 'r', name: 'R', kind: 'site', target: 'https://x.example/', language: 'en', frequency: 'hourly', time: '08:00', maxItems: 2, useAi: false, enabled: true, createdAt: 0, lastRunAt: 1, ...patch });
  const posts = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1} title`, url: `https://x.example/${prefix}${i + 1}` }));
  const deps = (find: () => Promise<{ title: string; url: string }[]>, chat?: never) => ({ getSettings: () => ({ ollamaUrl: 'http://x', ollamaModel: 'm', modelChat: '', modelTriage: '', modelWriting: '' }) as Settings, find, chat, makeId: (u: string) => u });

  it('keeps a website’s extra new posts for the next run instead of losing them', async () => {
    const feed = posts(5);
    const first = await runRoutine(routine(), new Set(['https://x.example/old']), deps(async () => [...feed, { title: 'old one', url: 'https://x.example/old' }]));
    expect(first.items.map((i) => i.url)).toEqual(['https://x.example/p1', 'https://x.example/p2']);
    expect(first.seen.sort()).toEqual(['https://x.example/old', 'https://x.example/p1', 'https://x.example/p2']);
    const second = await runRoutine(routine(), new Set(first.seen), deps(async () => [...feed, { title: 'old one', url: 'https://x.example/old' }]));
    expect(second.items.map((i) => i.url)).toEqual(['https://x.example/p3', 'https://x.example/p4']);
    const third = await runRoutine(routine(), new Set([...first.seen, ...second.seen]), deps(async () => feed));
    expect(third.items.map((i) => i.url)).toEqual(['https://x.example/p5']);
  });

  it('still passes over the whole archive on the first run, on purpose', async () => {
    const r = await runRoutine(routine({ lastRunAt: undefined, maxItems: 10 }), new Set(), deps(async () => posts(8)));
    expect(r.items).toHaveLength(3);
    expect(r.seen).toHaveLength(8);
  });

  it('leaves the articles the AI never looked at for later', async () => {
    const chat = (async () => ({ role: 'assistant', content: JSON.stringify({ items: [{ n: 1, summary: 'one' }] }) })) as never;
    const r = await runRoutine(routine({ kind: 'news', useAi: true, maxItems: 1 }), new Set(), deps(async () => posts(30), chat));
    expect(r.items).toHaveLength(1);
    expect(r.seen).toHaveLength(20); // the 20 it was shown; the other 10 are still new next time
  });
});

describe('reminders held back while you are busy', () => {
  const at = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);
  const reminder = (id: string, startsInMinutes: number): ReminderPayload => ({
    event: { id, title: `Event ${id}`, start: at(startsInMinutes).toISOString(), end: at(startsInMinutes + 30).toISOString(), allDay: false },
    minutesUntil: 15,
    message: 'old message',
  });

  it('keeps one per event, and no more than five', () => {
    let held: ReminderPayload[] = [];
    held = holdReminder(held, reminder('a', 15));
    held = holdReminder(held, reminder('a', 15));
    expect(held).toHaveLength(1);
    for (const id of 'bcdefg') held = holdReminder(held, reminder(id, 20));
    expect(held).toHaveLength(5);
    expect(held.map((h) => h.event.id)).toEqual(['c', 'd', 'e', 'f', 'g']);
  });

  it('shows the ones still worth showing, soonest first, with the time left worked out again', () => {
    const held = [reminder('later', 40), reminder('soon', 12), reminder('over', -30), reminder('justStarted', -5)];
    const out = releaseReminders(held);
    expect(out.map((r) => r.event.id)).toEqual(['justStarted', 'soon', 'later']);
    expect(out.find((r) => r.event.id === 'soon')).toMatchObject({ minutesUntil: 12, message: '“Event soon” starts in 12 minutes.' });
    expect(out.find((r) => r.event.id === 'justStarted')?.message).toMatch(/starting now/);
  });

  it('is empty when nothing was held', () => {
    expect(releaseReminders([])).toEqual([]);
  });
});

describe('checking the Ollama download', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-sum-'));
  const sha = (data: string) => crypto.createHash('sha256').update(data).digest('hex');

  it('reads the release’s checksum list', () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64);
    const sums = parseChecksums(`${a}  ./ollama-windows-amd64.zip\r\n${b} *Ollama-darwin.zip\nnot a line\n`);
    expect(sums.get('ollama-windows-amd64.zip')).toBe(a);
    expect(sums.get('Ollama-darwin.zip')).toBe(b);
    expect(sums.size).toBe(2);
  });

  it('accepts a file whose checksum matches, and nothing else', async () => {
    const d = dir();
    const file = path.join(d, 'x.zip');
    fs.writeFileSync(file, 'real ollama');
    await expect(verifyDownload(file, 'x.zip', new Map([['x.zip', sha('real ollama')]]))).resolves.toBeUndefined();
    await expect(verifyDownload(file, 'x.zip', new Map([['x.zip', sha('tampered')]]))).rejects.toThrow(/did not match/);
    await expect(verifyDownload(file, 'x.zip', new Map())).rejects.toThrow(/does not list a checksum/);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('builds addresses inside one release, so the file and its checksums always belong together', () => {
    expect(releaseAssetUrl('v0.9.0', 'sha256sum.txt')).toBe('https://github.com/ollama/ollama/releases/download/v0.9.0/sha256sum.txt');
    expect(releaseAssetUrl('latest', 'Ollama-darwin.zip')).toBe('https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip');
  });
});

describe('opening an e-mail', () => {
  it('asks Gmail once, and still gets the summary, the body and the threading headers', async () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    googleFetch.mockResolvedValue({
      id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 'Hi &amp; hello', internalDate: String(Date.UTC(2026, 9, 14, 10)),
      payload: {
        mimeType: 'text/plain', body: { data: b64('Hello Ana') },
        headers: [
          { name: 'From', value: 'Boss <boss@example.com>' }, { name: 'To', value: 'ana@example.com' }, { name: 'Subject', value: 'Contract' },
          { name: 'Message-ID', value: '<abc@mail>' }, { name: 'List-Unsubscribe', value: '<mailto:x>' },
        ],
      },
    });
    const full = await getFullEmail('m1');
    expect(googleFetch).toHaveBeenCalledTimes(1);
    expect(googleFetch.mock.calls[0][0]).toContain('format=full');
    expect(full.summary).toMatchObject({ id: 'm1', from: 'Boss', fromEmail: 'boss@example.com', subject: 'Contract', snippet: 'Hi & hello', hasListUnsubscribe: true });
    expect(full.body).toBe('Hello Ana');
    expect(full).toMatchObject({ messageId: '<abc@mail>', replyTo: 'boss@example.com' });
  });
});

describe('"dia 31" in a month without one', () => {
  const NOW = new Date(2026, 3, 20, 10, 0); // 20 April: 30 days
  it('means the next month that has a 31st, not the 1st of the next one', () => {
    expect(toEventInput(parseQuickEvent('Reunião dia 31', NOW), NOW).start).toBe('2026-05-31');
    expect(toEventInput(parseQuickEvent('Party on the 31st', NOW), NOW).start).toBe('2026-05-31');
  });
  it('still picks this month when the day is ahead, and the next when it has passed', () => {
    expect(toEventInput(parseQuickEvent('Reunião dia 25', NOW), NOW).start).toBe('2026-04-25');
    expect(toEventInput(parseQuickEvent('Reunião dia 10', NOW), NOW).start).toBe('2026-05-10');
  });
  it('skips February for the 30th', () => {
    const jan = new Date(2026, 0, 31, 10, 0);
    expect(toEventInput(parseQuickEvent('Consulta dia 30', jan), jan).start).toBe('2026-03-30');
  });
});

describe('the weather after the place was changed', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const forecast = { current: { temperature_2m: 20, apparent_temperature: 20, weather_code: 0, is_day: 1 } };

  it('is for the new place, never for the one that was typed before', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('geocoding')) {
        const name = new URL(url).searchParams.get('name')!;
        asked.push(name);
        if (name === 'Porto') await gate; // the old lookup is slow
        return json({ results: [{ name, country: 'Portugal', latitude: 41, longitude: -8 }] });
      }
      return json(forecast);
    }));
    let place = 'Porto';
    const w = new WeatherService({ getSettings: () => ({ weather: true, weatherPlace: place }) });
    const first = w.refresh();
    place = 'Lisbon';
    const second = w.refresh();
    expect(second).not.toBe(first); // not the answer for the old place
    release();
    const [, newest] = await Promise.all([first, second]);
    expect(newest).toMatchObject({ status: 'ok', place: 'Lisbon, Portugal' });
    expect(w.state).toMatchObject({ place: 'Lisbon, Portugal' });
    expect(asked).toEqual(['Porto', 'Lisbon']);
  });

  it('still shares a request for the same place', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('geocoding') ? json({ results: [{ name: 'Porto', country: 'Portugal', latitude: 41, longitude: -8 }] }) : json(forecast))));
    const w = new WeatherService({ getSettings: () => ({ weather: true, weatherPlace: 'Porto' }) });
    expect(w.refresh()).toBe(w.refresh());
    await w.refresh();
  });
});

describe('a document longer than what can be read', () => {
  const parsed = { title: 'Long quiz', language: 'en', citationStyle: 'APA', instructions: '', questions: [{ number: '1', text: 'Why do teams learn?' }] };
  const run = async (length: number) => {
    const chat = vi.fn(async ({ messages }: any) => {
      const system: string = messages[0].content;
      if (system.startsWith('You read assignment')) return { role: 'assistant', content: JSON.stringify(parsed) };
      if (system.startsWith('Propose')) return { role: 'assistant', content: JSON.stringify({ queries: [] }) };
      return { role: 'assistant', content: 'No idea.' };
    });
    const createDoc = vi.fn(async () => 'https://docs.google.com/document/d/abc/edit');
    const progress: string[] = [];
    const settings = { ...DEFAULT_SETTINGS };
    await answerAssignment('/tmp/q.txt', { settings, onProgress: (m) => progress.push(m), chat: chat as any, search: async () => [], createDoc, readFile: async () => 'x'.repeat(length) });
    const paras = (createDoc.mock.calls[0] as any)[1] as { runs: { text: string }[] }[];
    return { progress, text: paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n') };
  };

  it('tells you, in the document and while it works, that only the start was read', async () => {
    const { progress, text } = await run(14_001);
    expect(text).toContain('only the start was read');
    expect(progress.some((m) => /only its start can be read/.test(m))).toBe(true);
  });
  it('says nothing about it for a document that fits', async () => {
    const { progress, text } = await run(14_000);
    expect(text).not.toContain('only the start was read');
    expect(progress.some((m) => /only its start/.test(m))).toBe(false);
  });
});

describe('checking settings from the renderer', () => {
  it('keeps only known settings with valid values', () => {
    const clean = sanitizePatch({
      mascotName: '  Nova  ', skin: 'sunset', shape: 'planet', accessories: ['crown', 'glasses'], customColor: '#ABCDEF', colorSwatches: ['#112233'],
      weather: false, sleepAfterMinutes: 999, focusMinutes: 0, emailLookbackDays: 99, briefingTime: '07:30', reminderLeadMinutes: [30, 10], voiceLanguage: 'pt',
    }, DEFAULT_SETTINGS);
    expect(clean).toEqual({
      mascotName: 'Nova', skin: 'sunset', shape: 'planet', accessories: ['crown', 'glasses'], customColor: '#abcdef', colorSwatches: ['#112233'],
      weather: false, sleepAfterMinutes: 240, focusMinutes: 1, emailLookbackDays: 14, briefingTime: '07:30', reminderLeadMinutes: [30, 10], voiceLanguage: 'pt',
    });
  });

  it('drops what is wrong', () => {
    const clean = sanitizePatch({
      unknown: 1, constructor: 'x', toString: 'y', mascotName: '', skin: 'rainbow', accessories: ['crown', 'jetpack'], customColor: 'red', colorSwatches: 'x',
      weather: 'yes', briefingTime: '7:30', reminderLeadMinutes: 'abc', ollamaUrl: 'javascript:alert(1)', focusMinutes: '25', widgetView: 'huge',
    }, DEFAULT_SETTINGS);
    expect(clean).toEqual({});
  });

  it('allows only http(s) AI servers without a password', () => {
    expect(sanitizePatch({ ollamaUrl: 'https://ai.example.com/' }, DEFAULT_SETTINGS)).toEqual({ ollamaUrl: 'https://ai.example.com' });
    expect(sanitizePatch({ ollamaUrl: 'file:///etc/passwd' }, DEFAULT_SETTINGS)).toEqual({});
    expect(sanitizePatch({ ollamaUrl: 'http://a:b@host' }, DEFAULT_SETTINGS)).toEqual({});
    expect(sanitizePatch({ ollamaUrl: 'x'.repeat(300) }, DEFAULT_SETTINGS)).toEqual({});
  });

  it('is empty for anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 5, [1, 2]]) expect(sanitizePatch(bad, DEFAULT_SETTINGS)).toEqual({});
  });

  it('accepts a value for every setting Lumi itself saves', () => {
    const own = sanitizePatch({ widgetScale: 0.7, panelScale: 1, startInTray: true, widgetMode: 'onTop', widgetView: 'day', dndUntil: Date.now(), lastBriefingDate: '2026-10-14', launchAtLogin: false, autoUpdate: false }, DEFAULT_SETTINGS);
    expect(Object.keys(own)).toHaveLength(9);
  });
});

describe('scoring e-mail keywords', () => {
  const mail = (subject: string) => ({ id: '1', threadId: 't', from: 'A', fromEmail: 'a@b.c', to: 'me@b.c', subject, snippet: '', date: new Date().toISOString(), labelIds: ['INBOX'], hasListUnsubscribe: false });
  it('still finds whole-word keywords in English and Portuguese, and not parts of other words', () => {
    expect(scoreEmail(mail('Contract needs signature today'), 'me@b.c').reasons.join(' ')).toMatch(/contract/);
    expect(scoreEmail(mail('Reunião amanhã'), 'me@b.c').reasons.join(' ')).toMatch(/reunião/);
    expect(scoreEmail(mail('Assigned the designation'), 'me@b.c').reasons.join(' ')).not.toMatch(/Mentions/);
  });
  it('gives the same result when asked repeatedly (the patterns are reused)', () => {
    const first = scoreEmail(mail('Urgent: invoice overdue'), 'me@b.c');
    for (let i = 0; i < 5; i++) expect(scoreEmail(mail('Urgent: invoice overdue'), 'me@b.c').score).toBe(first.score);
  });
});

describe('the settings module', () => {
  it('accepts every default value back, so no setting is missing a check', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(sanitizePatch({ [key]: value }, DEFAULT_SETTINGS), key).toEqual({ [key]: value });
    }
  });

  it('applies a patch, tidies the result and lists only what changed', () => {
    const { next, changed } = applyPatch(DEFAULT_SETTINGS, { widgetScale: 0.3, mascotName: 'Lumi', reminderLeadMinutes: [1, 10, 1], evil: 1 });
    expect(next.widgetScale).toBe(0.6);
    expect(next.reminderLeadMinutes).toEqual([10, 1]);
    expect(changed.sort()).toEqual(['reminderLeadMinutes', 'widgetScale']);
    expect(applyPatch(DEFAULT_SETTINGS, {}).changed).toEqual([]);
  });
});
