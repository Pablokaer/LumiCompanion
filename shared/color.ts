/**
 * Colour maths for the custom-colour picker and for turning one chosen colour into a full skin.
 * Pure functions, shared by the UI and by the main process (which validates stored settings).
 */

export interface RGB { r: number; g: number; b: number }
/** h in degrees 0–360, s and v in 0–1. */
export interface HSV { h: number; s: number; v: number }
export interface HSL { h: number; s: number; l: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const byte = (n: number) => clamp(Math.round(n), 0, 255);

/** "#abc", "abc", "#aabbcc" or "AABBCC" → "#aabbcc"; undefined if it is not a colour. */
export function normalizeHex(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

export function hexToRgb(hex: string): RGB {
  const n = normalizeHex(hex) ?? '#000000';
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

export const rgbToHex = ({ r, g, b }: RGB) => `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`;

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const H = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}

export const hexToHsv = (hex: string) => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: HSV) => rgbToHex(hsvToRgb(hsv));

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = rgbToHsv({ r, g, b }).h;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const H = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255) };
}

export const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

export interface DerivedSkin {
  /** Body gradient, light to dark. The picked colour is the main stop. */
  stops: [string, string, string, string];
  /** Accent used on the dark UI (kept light enough to read). */
  star: string;
  /** Deeper accent used behind white text on buttons (kept dark enough for contrast). */
  starStrong: string;
}

/** Builds a full skin from one colour: the body gradient keeps the colour itself, the UI accents are adjusted for readability. */
export function deriveSkin(hex: string): DerivedSkin {
  const base = hexToRgb(hex);
  const hsl = rgbToHsl(base);
  const shade = (k: number) => rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: Math.max(0.05, hsl.l * k) }));
  return {
    stops: [rgbToHex(mix(base, { r: 255, g: 255, b: 255 }, 0.65)), rgbToHex(base), shade(0.72), shade(0.5)],
    star: rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp(hsl.l, 0.55, 0.8) })),
    starStrong: rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp(hsl.l * 0.8, 0.3, 0.52) })),
  };
}

export const MAX_SWATCHES = 12;

/** Newest first, no duplicates, capped. Invalid colours are ignored. */
export function addSwatch(list: string[], hex: string): string[] {
  const n = normalizeHex(hex);
  if (!n) return list;
  return [n, ...list.filter((c) => c !== n)].slice(0, MAX_SWATCHES);
}

export const removeSwatch = (list: string[], hex: string) => list.filter((c) => c !== normalizeHex(hex));

/** Cleans a stored swatch list: valid, unique, capped. */
export function normalizeSwatches(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const n = normalizeHex(item);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, MAX_SWATCHES);
}
