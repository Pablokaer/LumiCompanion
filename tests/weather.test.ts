import { describe, expect, it } from 'vitest';
import {
  ambientFor, autoAccessories, conditionFromCode, formatTemperature, holidayHat, isRaining, parseGeocoding, parseIpLocation,
  parseOpenMeteo, seasonFor, weatherSummary,
} from '../shared/weather';

describe('weather codes', () => {
  it('maps WMO codes to conditions', () => {
    const cases: [number, string][] = [[0, 'clear'], [1, 'clear'], [2, 'partly'], [3, 'cloudy'], [45, 'fog'], [48, 'fog'], [53, 'drizzle'], [61, 'rain'], [65, 'rain'], [81, 'rain'],
      [71, 'snow'], [75, 'snow'], [86, 'snow'], [95, 'thunder'], [99, 'thunder'], [999, 'thunder'], [10, 'cloudy']];
    for (const [code, expected] of cases) expect(conditionFromCode(code), String(code)).toBe(expected);
  });

  it('knows what counts as rain', () => {
    expect(['rain', 'drizzle', 'thunder'].every((c) => isRaining(c as never))).toBe(true);
    expect(['clear', 'snow', 'cloudy', undefined].some((c) => isRaining(c as never))).toBe(false);
  });
});

describe('API responses', () => {
  it('reads an Open-Meteo reply', () => {
    expect(parseOpenMeteo({ current: { temperature_2m: 18.4, apparent_temperature: 17, weather_code: 61, is_day: 1 } }))
      .toEqual({ temperatureC: 18.4, apparentC: 17, condition: 'rain', isDay: true });
    expect(parseOpenMeteo({ current: { temperature_2m: 3, weather_code: 0, is_day: 0 } })).toMatchObject({ apparentC: 3, isDay: false });
  });

  it('rejects broken or empty replies', () => {
    for (const bad of [null, {}, { current: {} }, { current: { temperature_2m: 'hot', weather_code: 1 } }, { current: { temperature_2m: 5 } }, 'x']) {
      expect(parseOpenMeteo(bad)).toBeUndefined();
    }
  });

  it('reads IP geolocation from ipwho.is and ipapi.co shapes, and rejects errors and bad coordinates', () => {
    expect(parseIpLocation({ success: true, latitude: 38.72, longitude: -9.14, city: 'Lisbon', country: 'Portugal' })).toEqual({ latitude: 38.72, longitude: -9.14, place: 'Lisbon, Portugal' });
    expect(parseIpLocation({ latitude: -23.5, longitude: -46.6, city: 'São Paulo', country_name: 'Brazil' })?.place).toBe('São Paulo, Brazil');
    expect(parseIpLocation({ success: false, message: 'rate limited' })).toBeUndefined();
    expect(parseIpLocation({ error: true, reason: 'RateLimited' })).toBeUndefined();
    expect(parseIpLocation({ latitude: 200, longitude: 0 })).toBeUndefined();
    expect(parseIpLocation({ latitude: 10 })).toBeUndefined();
    expect(parseIpLocation(null)).toBeUndefined();
  });

  it('reads a geocoding search result', () => {
    expect(parseGeocoding({ results: [{ name: 'Porto', admin1: 'Porto', country: 'Portugal', latitude: 41.15, longitude: -8.61 }] })).toEqual({ latitude: 41.15, longitude: -8.61, place: 'Porto, Porto, Portugal' });
    expect(parseGeocoding({ results: [] })).toBeUndefined();
    expect(parseGeocoding({})).toBeUndefined();
  });
});

describe('temperature and summary', () => {
  it('formats in Celsius and Fahrenheit', () => {
    expect(formatTemperature(18.4, 'c')).toBe('18°C');
    expect(formatTemperature(0, 'f')).toBe('32°F');
    expect(formatTemperature(100, 'f')).toBe('212°F');
    expect(formatTemperature(undefined, 'c')).toBe('–');
  });

  it('summarises only when there is data', () => {
    expect(weatherSummary({ status: 'ok', condition: 'rain', temperatureC: 12.2, isDay: true }, 'c')).toBe('🌧️ 12°C, raining');
    expect(weatherSummary({ status: 'ok', condition: 'clear', temperatureC: 20, isDay: false }, 'c')).toContain('🌙');
    expect(weatherSummary({ status: 'error' }, 'c')).toBeUndefined();
    expect(weatherSummary({ status: 'loading' }, 'c')).toBeUndefined();
  });
});

describe('seasons', () => {
  it('follows the hemisphere', () => {
    expect(seasonFor(new Date(2026, 0, 15), 40)).toBe('winter');
    expect(seasonFor(new Date(2026, 3, 15), 40)).toBe('spring');
    expect(seasonFor(new Date(2026, 6, 15), 40)).toBe('summer');
    expect(seasonFor(new Date(2026, 9, 15), 40)).toBe('autumn');
    expect(seasonFor(new Date(2026, 11, 15), 40)).toBe('winter');
    expect(seasonFor(new Date(2026, 0, 15), -23)).toBe('summer');
    expect(seasonFor(new Date(2026, 9, 15), -23)).toBe('spring');
    expect(seasonFor(new Date(2026, 6, 15), -23)).toBe('winter');
  });

  it('picks the background drift: precipitation first, then the season', () => {
    expect(ambientFor('rain', 'autumn')).toBe('rain');
    expect(ambientFor('thunder', 'summer')).toBe('rain');
    expect(ambientFor('snow', 'spring')).toBe('snow');
    expect(ambientFor('clear', 'autumn')).toBe('leaves');
    expect(ambientFor('cloudy', 'spring')).toBe('petals');
    expect(ambientFor('clear', 'summer')).toBe('none');
    expect(ambientFor(undefined, 'winter')).toBe('none');
  });
});

describe('what she wears', () => {
  const now = new Date(2026, 5, 15); // mid June: no festive hat

  it('brings an umbrella when it rains', () => {
    expect(autoAccessories({ worn: [], weather: { condition: 'rain', temperatureC: 15 }, now })).toEqual(['umbrella']);
    expect(autoAccessories({ worn: [], weather: { condition: 'thunder', temperatureC: 15 }, now })).toContain('umbrella');
  });

  it('wraps up in the cold and puts on sunglasses in the heat', () => {
    expect(autoAccessories({ worn: [], weather: { condition: 'clear', temperatureC: 2 }, now })).toEqual(expect.arrayContaining(['scarf', 'beanie']));
    expect(autoAccessories({ worn: [], weather: { condition: 'snow', temperatureC: 8, apparentC: 8 }, now })).toEqual(expect.arrayContaining(['scarf', 'beanie']));
    expect(autoAccessories({ worn: [], weather: { condition: 'clear', temperatureC: 33, isDay: true }, now })).toEqual(['sunglasses']);
    expect(autoAccessories({ worn: [], weather: { condition: 'clear', temperatureC: 33, isDay: false }, now })).toEqual([]);
    expect(autoAccessories({ worn: [], weather: { condition: 'rain', temperatureC: 33 }, now })).not.toContain('sunglasses');
  });

  it('uses the felt temperature when it is available', () => {
    expect(autoAccessories({ worn: [], weather: { condition: 'clear', temperatureC: 8, apparentC: 2 }, now })).toContain('scarf');
  });

  it('never replaces what the user chose to wear, and only fills free spots', () => {
    const out = autoAccessories({ worn: ['crown', 'sunglasses'], weather: { condition: 'snow', temperatureC: -3 }, now });
    expect(out).toContain('crown');
    expect(out).not.toContain('beanie'); // the head spot is taken by the crown
    expect(out).toContain('scarf');
    expect(out).toContain('sunglasses');
    expect(autoAccessories({ worn: ['bowtie'], weather: { condition: 'snow', temperatureC: -3 }, now })).not.toContain('scarf'); // neck is taken
  });

  it('adds nothing in mild, dry weather or without data', () => {
    expect(autoAccessories({ worn: [], weather: { condition: 'clear', temperatureC: 20 }, now })).toEqual([]);
    expect(autoAccessories({ worn: ['hat'], now })).toEqual(['hat']);
  });

  it('puts on festive hats at the right time of year, ahead of a weather hat', () => {
    expect(holidayHat(new Date(2026, 11, 24))).toBe('santa');
    expect(holidayHat(new Date(2026, 11, 14))).toBeUndefined();
    expect(holidayHat(new Date(2026, 9, 31))).toBe('witch');
    expect(holidayHat(new Date(2026, 9, 20))).toBeUndefined();
    expect(holidayHat(new Date(2026, 11, 31))).toBe('hat');
    expect(holidayHat(new Date(2027, 0, 1))).toBe('hat');
    const out = autoAccessories({ worn: [], weather: { condition: 'snow', temperatureC: -2 }, now: new Date(2026, 11, 24) });
    expect(out).toContain('santa');
    expect(out).not.toContain('beanie');
  });
});
