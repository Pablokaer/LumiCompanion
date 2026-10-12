import type { Accessory } from './types';
import { SLOT_OF } from './appearance';

/**
 * Weather and seasons: turning API responses into something the star can react to. Pure functions.
 * Weather data comes from Open-Meteo (free, no key); the place comes from your IP address or a city you type.
 */

export type WeatherCondition = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export interface WeatherState {
  status: 'off' | 'loading' | 'ok' | 'error';
  place?: string;
  latitude?: number;
  temperatureC?: number;
  apparentC?: number;
  condition?: WeatherCondition;
  isDay?: boolean;
  updatedAt?: number;
  message?: string;
}

export type TemperatureUnit = 'c' | 'f';

/** WMO weather interpretation codes, as used by Open-Meteo. */
export function conditionFromCode(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reads an Open-Meteo `current` block. Returns undefined when it is not usable. */
export function parseOpenMeteo(json: unknown): Pick<WeatherState, 'temperatureC' | 'apparentC' | 'condition' | 'isDay'> | undefined {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c || !finite(c.temperature_2m) || !finite(c.weather_code)) return undefined;
  return {
    temperatureC: c.temperature_2m,
    apparentC: finite(c.apparent_temperature) ? c.apparent_temperature : c.temperature_2m,
    condition: conditionFromCode(c.weather_code),
    isDay: c.is_day === undefined ? true : c.is_day === 1 || c.is_day === true,
  };
}

export interface Place { latitude: number; longitude: number; place: string }

const valid = (lat: unknown, lon: unknown): lat is number =>
  finite(lat) && finite(lon) && Math.abs(lat) <= 90 && Math.abs(lon as number) <= 180;

/** Reads the answer of an IP geolocation service (ipwho.is or ipapi.co). */
export function parseIpLocation(json: unknown): Place | undefined {
  const j = json as Record<string, unknown> | null;
  if (!j || j.success === false || j.error) return undefined;
  if (!valid(j.latitude, j.longitude)) return undefined;
  const city = [j.city, j.country ?? j.country_name].filter((x): x is string => typeof x === 'string' && !!x).join(', ');
  return { latitude: j.latitude as number, longitude: j.longitude as number, place: city || 'Your location' };
}

/** Reads the first result of Open-Meteo's geocoding search. */
export function parseGeocoding(json: unknown): Place | undefined {
  const r = (json as { results?: Record<string, unknown>[] } | null)?.results?.[0];
  if (!r || !valid(r.latitude, r.longitude)) return undefined;
  const name = [r.name, r.admin1, r.country].filter((x): x is string => typeof x === 'string' && !!x).join(', ');
  return { latitude: r.latitude as number, longitude: r.longitude as number, place: name || 'Chosen place' };
}

export const toFahrenheit = (c: number) => (c * 9) / 5 + 32;

export function formatTemperature(c: number | undefined, unit: TemperatureUnit): string {
  if (c === undefined) return '–';
  return `${Math.round(unit === 'f' ? toFahrenheit(c) : c)}°${unit === 'f' ? 'F' : 'C'}`;
}

const CONDITION_TEXT: Record<WeatherCondition, string> = {
  clear: 'clear', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'foggy', drizzle: 'drizzling', rain: 'raining', snow: 'snowing', thunder: 'thunderstorm',
};

const CONDITION_ICON: Record<WeatherCondition, [string, string]> = {
  clear: ['☀️', '🌙'], partly: ['⛅', '☁️'], cloudy: ['☁️', '☁️'], fog: ['🌫️', '🌫️'], drizzle: ['🌦️', '🌧️'], rain: ['🌧️', '🌧️'], snow: ['❄️', '❄️'], thunder: ['⛈️', '⛈️'],
};

export const conditionText = (c: WeatherCondition) => CONDITION_TEXT[c];
export const conditionIcon = (c: WeatherCondition, isDay = true) => CONDITION_ICON[c][isDay ? 0 : 1];

/** "☔ 18°C, raining" */
export function weatherSummary(w: WeatherState, unit: TemperatureUnit): string | undefined {
  if (w.status !== 'ok' || !w.condition) return undefined;
  return `${conditionIcon(w.condition, w.isDay)} ${formatTemperature(w.temperatureC, unit)}, ${conditionText(w.condition)}`;
}

export const isRaining = (c?: WeatherCondition) => c === 'rain' || c === 'drizzle' || c === 'thunder';

// ---------- seasons ----------

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Meteorological seasons; the southern hemisphere (negative latitude) is six months out of step. */
export function seasonFor(date: Date, latitude = 1): Season {
  const m = date.getMonth(); // 0 = January
  const north: Season = m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
  if (latitude >= 0) return north;
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[north];
}

/** Things drifting through the background. */
export type Ambient = 'none' | 'rain' | 'snow' | 'leaves' | 'petals';

/** Precipitation wins; otherwise a gentle seasonal drift (leaves in autumn, petals in spring). */
export function ambientFor(condition: WeatherCondition | undefined, season: Season): Ambient {
  if (isRaining(condition)) return 'rain';
  if (condition === 'snow') return 'snow';
  if (season === 'autumn') return 'leaves';
  if (season === 'spring') return 'petals';
  return 'none';
}

// ---------- what she wears ----------

/** A festive hat for the time of year, if any. */
export function holidayHat(date: Date): Accessory | undefined {
  const m = date.getMonth(), d = date.getDate();
  if (m === 11 && d === 31) return 'hat'; // New Year's Eve
  if (m === 0 && d === 1) return 'hat'; // New Year's Day
  if (m === 11 && d >= 15) return 'santa';
  if (m === 9 && d >= 25) return 'witch'; // Halloween week
  return undefined;
}

export interface LookInput {
  /** What the user chose to wear. These are never replaced. */
  worn: Accessory[];
  weather?: Pick<WeatherState, 'condition' | 'temperatureC' | 'apparentC' | 'isDay'>;
  now: Date;
}

/**
 * The accessories to actually draw: the ones the user picked, plus seasonal and weather extras for
 * any spot the user left free (festive hat, umbrella in the rain, scarf and beanie in the cold,
 * sunglasses on a hot sunny day). Never replaces a choice.
 */
export function autoAccessories({ worn, weather, now }: LookInput): Accessory[] {
  const out = [...worn];
  const add = (a: Accessory) => { if (!out.some((w) => SLOT_OF[w] === SLOT_OF[a])) out.push(a); };

  const hat = holidayHat(now);
  if (hat) add(hat);

  if (weather?.condition) {
    const felt = weather.apparentC ?? weather.temperatureC;
    if (isRaining(weather.condition)) add('umbrella');
    if (weather.condition === 'snow' || (felt !== undefined && felt <= 5)) { add('scarf'); add('beanie'); }
    if (felt !== undefined && felt >= 30 && weather.isDay !== false && (weather.condition === 'clear' || weather.condition === 'partly')) add('sunglasses');
  }
  return out;
}
