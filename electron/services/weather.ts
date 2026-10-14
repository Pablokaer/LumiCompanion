import { EventEmitter } from 'node:events';
import { parseGeocoding, parseIpLocation, parseOpenMeteo, type Place, type WeatherState } from '../../shared/weather';

/**
 * Current weather from Open-Meteo (free, no key). The place is a city you typed in Settings, or, when
 * that is empty, guessed from your public IP address with a free geolocation service (ipwho.is, falling
 * back to ipapi.co). Only the coordinates are sent to Open-Meteo.
 */

export const REFRESH_EVERY_MS = 30 * 60_000;
/** A guessed location is reused for this long before asking again. */
const LOCATION_TTL_MS = 6 * 60 * 60_000;

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export interface WeatherDeps {
  /** The current settings, read on every refresh. */
  getSettings(): { weather: boolean; weatherPlace: string };
}

export class WeatherService extends EventEmitter {
  state: WeatherState = { status: 'off' };
  private located?: { place: Place; at: number; key: string };
  private timer?: NodeJS.Timeout;
  private busy?: { key: string; promise: Promise<WeatherState> };

  constructor(private deps: WeatherDeps) { super(); }

  start() {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Looks up the place and the weather again. A request already going for the same place is shared; one for a
   * place that has since been changed is waited for and then redone, so the answer is never for the old place.
   */
  refresh(): Promise<WeatherState> {
    const { weather, weatherPlace } = this.deps.getSettings();
    const key = `${weather}|${weatherPlace.trim().toLowerCase()}`;
    if (this.busy?.key === key) return this.busy.promise;
    const previous = this.busy?.promise;
    const promise: Promise<WeatherState> = (previous ? previous.catch(() => undefined).then(() => this.run()) : this.run())
      .finally(() => { if (this.busy?.promise === promise) this.busy = undefined; });
    this.busy = { key, promise };
    return promise;
  }

  private set(state: WeatherState) {
    this.state = state;
    this.emit('state', state);
    return state;
  }

  private async run(): Promise<WeatherState> {
    const { weather, weatherPlace } = this.deps.getSettings();
    if (!weather) return this.set({ status: 'off' });
    if (this.state.status !== 'ok') this.set({ status: 'loading' });
    try {
      const place = await this.locate(weatherPlace.trim());
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=auto';
      const current = parseOpenMeteo(await getJson(url));
      if (!current) throw new Error('The weather service sent an unexpected answer.');
      return this.set({ status: 'ok', place: place.place, latitude: place.latitude, ...current, updatedAt: Date.now() });
    } catch (e) {
      const message = friendly(e);
      // Keep showing the last good reading when a refresh fails.
      return this.set(this.state.status === 'ok' ? { ...this.state, message } : { status: 'error', message });
    }
  }

  private async locate(typed: string): Promise<Place> {
    const key = typed.toLowerCase();
    const cached = this.located;
    if (cached && cached.key === key && Date.now() - cached.at < (typed ? Infinity : LOCATION_TTL_MS)) return cached.place;

    let place: Place | undefined;
    if (typed) {
      place = parseGeocoding(await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(typed)}&count=1&language=en&format=json`));
      if (!place) throw new Error(`I could not find a place called “${typed}”.`);
    } else {
      for (const url of ['https://ipwho.is/', 'https://ipapi.co/json/']) {
        try { place = parseIpLocation(await getJson(url)); } catch { /* try the next service */ }
        if (place) break;
      }
      if (!place) throw new Error('I could not work out where you are. Type a city in Settings.');
    }
    this.located = { place, at: Date.now(), key };
    return place;
  }
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|timed? ?out|aborted/i.test(m)) return 'Could not reach the weather service. Check your internet connection.';
  return m.slice(0, 160);
}
