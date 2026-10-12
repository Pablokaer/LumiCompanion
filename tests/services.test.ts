import { afterEach, describe, expect, it, vi } from 'vitest';
import { DndService } from '../electron/services/dnd';
import { WeatherService } from '../electron/services/weather';
import { buildBriefing } from '../electron/services/briefing';
import type { CalendarEvent, Settings } from '../shared/types';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ipwho = { success: true, latitude: 38.72, longitude: -9.14, city: 'Lisbon', country: 'Portugal' };
const rain = { current: { temperature_2m: 14.2, apparent_temperature: 12, weather_code: 61, is_day: 1 } };

/** A fake fetch that answers by URL. */
function routes(map: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (url: string) => {
    for (const [prefix, answer] of Object.entries(map)) if (url.startsWith(prefix)) return answer();
    throw new Error(`unexpected request ${url}`);
  });
}

describe('WeatherService', () => {
  const on = { weather: true, weatherPlace: '' };

  it('finds you by IP address and reads the weather there', async () => {
    const fetchMock = routes({ 'https://ipwho.is/': () => json(ipwho), 'https://api.open-meteo.com/': () => json(rain) });
    vi.stubGlobal('fetch', fetchMock);
    const states: string[] = [];
    const w = new WeatherService({ getSettings: () => on });
    w.on('state', (s) => states.push(s.status));
    const state = await w.refresh();
    expect(state).toMatchObject({ status: 'ok', place: 'Lisbon, Portugal', temperatureC: 14.2, condition: 'rain', isDay: true, latitude: 38.72 });
    expect(states).toEqual(['loading', 'ok']);
    // only the coordinates go to the weather service
    const meteoUrl = fetchMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('open-meteo'))!;
    expect(meteoUrl).toContain('latitude=38.72');
    expect(meteoUrl).not.toContain('Lisbon');
  });

  it('remembers where you are instead of asking every time', async () => {
    const fetchMock = routes({ 'https://ipwho.is/': () => json(ipwho), 'https://api.open-meteo.com/': () => json(rain) });
    vi.stubGlobal('fetch', fetchMock);
    const w = new WeatherService({ getSettings: () => on });
    await w.refresh(); await w.refresh();
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('ipwho')).length).toBe(1);
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('open-meteo')).length).toBe(2);
  });

  it('uses a city you typed instead of guessing, and says so when it cannot find it', async () => {
    const found = routes({
      'https://geocoding-api.open-meteo.com/': () => json({ results: [{ name: 'Porto', country: 'Portugal', latitude: 41.15, longitude: -8.61 }] }),
      'https://api.open-meteo.com/': () => json(rain),
    });
    vi.stubGlobal('fetch', found);
    const w = new WeatherService({ getSettings: () => ({ weather: true, weatherPlace: 'Porto' }) });
    expect((await w.refresh()).place).toBe('Porto, Portugal');
    expect(found.mock.calls.some((c) => (c[0] as string).includes('ipwho'))).toBe(false); // never asked for your IP

    vi.stubGlobal('fetch', routes({ 'https://geocoding-api.open-meteo.com/': () => json({}) }));
    const lost = await new WeatherService({ getSettings: () => ({ weather: true, weatherPlace: 'Nowhereville' }) }).refresh();
    expect(lost).toMatchObject({ status: 'error' });
    expect(lost.message).toContain('Nowhereville');
  });

  it('falls back to the second geolocation service', async () => {
    vi.stubGlobal('fetch', routes({
      'https://ipwho.is/': () => { throw new Error('down'); },
      'https://ipapi.co/': () => json({ latitude: -23.55, longitude: -46.63, city: 'São Paulo', country_name: 'Brazil' }),
      'https://api.open-meteo.com/': () => json(rain),
    }));
    expect((await new WeatherService({ getSettings: () => on }).refresh()).place).toBe('São Paulo, Brazil');
  });

  it('keeps the last good reading when a refresh fails, and reports an error when there never was one', async () => {
    let up = true;
    vi.stubGlobal('fetch', routes({
      'https://ipwho.is/': () => json(ipwho),
      'https://api.open-meteo.com/': () => { if (!up) throw new Error('fetch failed'); return json(rain); },
    }));
    const w = new WeatherService({ getSettings: () => on });
    expect((await w.refresh()).status).toBe('ok');
    up = false;
    const stale = await w.refresh();
    expect(stale).toMatchObject({ status: 'ok', condition: 'rain' });
    expect(stale.message).toContain('internet connection');

    vi.stubGlobal('fetch', routes({ 'https://ipwho.is/': () => json(ipwho), 'https://api.open-meteo.com/': () => { throw new Error('fetch failed'); } }));
    expect((await new WeatherService({ getSettings: () => on }).refresh()).status).toBe('error');
  });

  it('is off, and contacts nobody, when switched off', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const state = await new WeatherService({ getSettings: () => ({ weather: false, weatherPlace: '' }) }).refresh();
    expect(state.status).toBe('off');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an answer it cannot use', async () => {
    vi.stubGlobal('fetch', routes({ 'https://ipwho.is/': () => json(ipwho), 'https://api.open-meteo.com/': () => json({ nope: true }) }));
    expect((await new WeatherService({ getSettings: () => on }).refresh()).status).toBe('error');
  });

  it('shares one request between callers that ask at the same time', async () => {
    const fetchMock = routes({ 'https://ipwho.is/': () => json(ipwho), 'https://api.open-meteo.com/': () => json(rain) });
    vi.stubGlobal('fetch', fetchMock);
    const w = new WeatherService({ getSettings: () => on });
    await Promise.all([w.refresh(), w.refresh(), w.refresh()]);
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes('open-meteo')).length).toBe(1);
  });
});

describe('DndService', () => {
  const NOW = new Date(2026, 9, 14, 10, 30).getTime();
  const settings = (over: Partial<Settings> = {}) => ({ dndFullscreen: true, dndMeetings: true, dndUntil: undefined, ...over }) as Settings;
  const meeting: CalendarEvent = { id: 'm', title: 'Standup', allDay: false, start: new Date(2026, 9, 14, 10).toISOString(), end: new Date(2026, 9, 14, 11).toISOString() };

  function make(over: Partial<Settings> = {}, events: CalendarEvent[] = []) {
    let s = settings(over);
    const saved: (number | undefined)[] = [];
    const service = new DndService({ getSettings: () => s, getEvents: () => events, saveManual: (ms) => { saved.push(ms); s = { ...s, dndUntil: ms }; } });
    return { service, saved, setSettings: (o: Partial<Settings>) => { s = { ...s, ...o }; } };
  }

  it('is quiet during a meeting, and says which', () => {
    const { service } = make({}, [meeting]);
    const seen: unknown[] = [];
    service.on('state', (st) => seen.push(st));
    service.evaluate(NOW);
    expect(service.state).toEqual({ active: true, reason: 'meeting', meeting: 'Standup' });
    service.evaluate(new Date(2026, 9, 14, 11, 5).getTime()); // the meeting is over
    expect(service.state).toEqual({ active: false });
    expect(seen).toHaveLength(2);
  });

  it('follows the full-screen probe when that setting is on', () => {
    const { service, setSettings } = make({ dndMeetings: false });
    service.probe.busy = true;
    service.evaluate(NOW);
    expect(service.state).toMatchObject({ active: true, reason: 'fullscreen' });
    service.probe.busy = false;
    service.evaluate(NOW);
    expect(service.state.active).toBe(false);
    setSettings({ dndFullscreen: false });
    service.probe.busy = true;
    service.evaluate(NOW);
    expect(service.state.active).toBe(false);
  });

  it('a manual pause saves its end time and clears it again', () => {
    const { service, saved } = make({ dndMeetings: false, dndFullscreen: false });
    vi.useFakeTimers({ now: NOW });
    service.setManual(NOW + 3_600_000);
    expect(service.state).toMatchObject({ active: true, reason: 'manual', until: NOW + 3_600_000 });
    service.setManual(null);
    expect(service.state.active).toBe(false);
    expect(saved).toEqual([NOW + 3_600_000, undefined]);
    vi.useRealTimers();
  });

  it('only announces real changes', () => {
    const { service } = make({ dndMeetings: false });
    const seen: unknown[] = [];
    service.on('state', (st, was) => seen.push([st.active, was.active]));
    service.evaluate(NOW); service.evaluate(NOW + 1000);
    expect(seen).toEqual([]);
    service.probe.busy = true; service.evaluate(NOW); service.evaluate(NOW);
    expect(seen).toEqual([[true, false]]);
  });
});

describe('briefing with the weather', () => {
  it('puts the weather first when there is one', () => {
    const b = buildBriefing([], [], new Date(2026, 9, 14, 9), 'Pablo', '🌧️ 14°C, raining');
    expect(b.lines[0]).toBe('🌧️ 14°C, raining');
    expect(buildBriefing([], [], new Date(2026, 9, 14, 9), 'Pablo').lines[0]).not.toContain('°');
  });
});
