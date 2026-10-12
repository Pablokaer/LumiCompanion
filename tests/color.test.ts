import { describe, expect, it } from 'vitest';
import {
  addSwatch, deriveSkin, hexToHsv, hexToRgb, hsvToHex, hslToRgb, hsvToRgb, MAX_SWATCHES, normalizeHex, normalizeSwatches,
  removeSwatch, rgbToHex, rgbToHsl, rgbToHsv,
} from '../shared/color';

describe('hex parsing', () => {
  it('accepts the usual spellings and rejects the rest', () => {
    expect(normalizeHex('#FFAA00')).toBe('#ffaa00');
    expect(normalizeHex('ffaa00')).toBe('#ffaa00');
    expect(normalizeHex(' #fa0 ')).toBe('#ffaa00');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    for (const bad of ['', '#12', '#12345', '#1234567', 'ggg', '#ggg000', 'rgb(1,2,3)', undefined, null, 5]) expect(normalizeHex(bad)).toBeUndefined();
  });

  it('round-trips through RGB', () => {
    for (const hex of ['#000000', '#ffffff', '#5cb8ff', '#ff6fae', '#123456']) expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    expect(hexToRgb('nonsense')).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbToHex({ r: 300, g: -5, b: 127.6 })).toBe('#ff0080'); // clamped and rounded
  });
});

describe('HSV and HSL conversions', () => {
  it('maps the primaries and secondaries to the right hues', () => {
    const hue = (hex: string) => Math.round(hexToHsv(hex).h);
    expect([hue('#ff0000'), hue('#ffff00'), hue('#00ff00'), hue('#00ffff'), hue('#0000ff'), hue('#ff00ff')]).toEqual([0, 60, 120, 180, 240, 300]);
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('round-trips every colour on a coarse sweep of the whole RGB cube', () => {
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
      const hex = rgbToHex({ r, g, b });
      expect(hsvToHex(rgbToHsv({ r, g, b }))).toBe(hex);
      expect(rgbToHex(hslToRgb(rgbToHsl({ r, g, b })))).toBe(hex);
    }
  });

  it('wraps hues and keeps channels in range', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -60, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 255 });
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('deriving a skin from one colour', () => {
  const lightness = (hex: string) => rgbToHsl(hexToRgb(hex)).l;

  it('keeps the chosen colour as the main body stop and orders the gradient light to dark', () => {
    const s = deriveSkin('#ff6fae');
    expect(s.stops[1]).toBe('#ff6fae');
    const ls = s.stops.map(lightness);
    expect(ls[0]).toBeGreaterThan(ls[1]);
    expect(ls[1]).toBeGreaterThan(ls[2]);
    expect(ls[2]).toBeGreaterThan(ls[3]);
  });

  it('keeps UI accents readable for any colour, including black and white', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#0000ff', '#ffff00', '#123456', '#808080', '#5cb8ff']) {
      const s = deriveSkin(hex);
      expect(lightness(s.star)).toBeGreaterThanOrEqual(0.54); // legible on the dark background
      expect(lightness(s.starStrong)).toBeLessThanOrEqual(0.53); // white text stays legible on it
      expect(s.stops.every((c) => normalizeHex(c) === c)).toBe(true);
    }
  });

  it('keeps the hue of the picked colour', () => {
    const base = Math.round(rgbToHsl(hexToRgb('#2e9e5b')).h);
    const s = deriveSkin('#2e9e5b');
    expect(Math.abs(Math.round(rgbToHsl(hexToRgb(s.star)).h) - base)).toBeLessThanOrEqual(2);
  });
});

describe('saved swatches', () => {
  it('puts the newest first, drops duplicates and caps the list', () => {
    expect(addSwatch(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
    expect(addSwatch(['#111111'], 'oops')).toEqual(['#111111']);
    let list: string[] = [];
    for (let i = 0; i < 30; i++) list = addSwatch(list, rgbToHex({ r: i * 8, g: 0, b: 0 }));
    expect(list).toHaveLength(MAX_SWATCHES);
    expect(list[0]).toBe(rgbToHex({ r: 29 * 8, g: 0, b: 0 }));
  });

  it('removes and sanitises', () => {
    expect(removeSwatch(['#111111', '#222222'], '#111')).toEqual(['#222222']);
    expect(normalizeSwatches(['#AABBCC', 'x', '#aabbcc', '#123'])).toEqual(['#aabbcc', '#112233']);
    expect(normalizeSwatches('nope')).toEqual([]);
  });
});
