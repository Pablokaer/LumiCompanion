import type { Accessory, Settings, Shape, Skin, WidgetMode, WidgetView } from './types';

/**
 * Settings come into the main process from the renderer, so a patch is checked here instead of being
 * trusted: unknown keys and values of the wrong type or outside their range are dropped, never saved.
 */

const SKINS = ['classic', 'nebula', 'sunset', 'mint', 'mono', 'custom'] as const satisfies readonly Skin[];
const SHAPES = ['star', 'chubby', 'sparkle', 'hexa', 'planet', 'earth', 'moon', 'sun', 'comet'] as const satisfies readonly Shape[];
const WIDGET_MODES = ['desktop', 'onTop'] as const satisfies readonly WidgetMode[];
const WIDGET_VIEWS = ['mascot', 'month', 'day'] as const satisfies readonly WidgetView[];
const ACCESSORIES = [
  'hat', 'crown', 'wizard', 'tophat', 'halo', 'flower', 'catears', 'antenna', 'bow', 'helmet', 'santa', 'witch', 'beanie',
  'headphones', 'glasses', 'sunglasses', 'monocle', 'scarf', 'bowtie', 'mustache', 'umbrella',
] as const satisfies readonly Accessory[];

const INVALID = Symbol('invalid');
type Check = (v: any) => unknown;

const oneOf = (list: readonly string[]): Check => (v) => (typeof v === 'string' && list.includes(v) ? v : INVALID);
const text = (max: number, { min = 0 } = {}): Check => (v) => {
  if (typeof v !== 'string') return INVALID;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : INVALID;
};
const int = (min: number, max: number): Check => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : INVALID);
const HEX = /^#[0-9a-f]{6}$/i;
const list = (item: Check, max: number): Check => (v) => {
  if (!Array.isArray(v) || v.length > max) return INVALID;
  const out = v.map(item);
  return out.some((x) => x === INVALID) ? INVALID : out;
};

/** The address of the AI server: http(s) only, no password in it. */
export function cleanOllamaUrl(v: unknown): string | typeof INVALID {
  if (typeof v !== 'string' || v.length > 200) return INVALID;
  try {
    const u = new URL(v.trim());
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? v.trim().replace(/\/+$/, '') : INVALID;
  } catch {
    return INVALID;
  }
}

const CHECKS: Partial<Record<keyof Settings, Check>> = {
  mascotName: text(20, { min: 1 }),
  widgetMode: oneOf(WIDGET_MODES),
  widgetView: oneOf(WIDGET_VIEWS),
  widgetScale: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : INVALID), // clamped to 0.6-1 by the store
  panelScale: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : INVALID),
  skin: oneOf(SKINS),
  customColor: (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : INVALID),
  colorSwatches: list((v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : INVALID), 24),
  shape: oneOf(SHAPES),
  accessories: list(oneOf(ACCESSORIES), 8),
  quickCaptureShortcut: text(60, { min: 1 }),
  weatherPlace: text(100),
  temperatureUnit: oneOf(['c', 'f']),
  tipFrequency: oneOf(['rare', 'normal', 'often']),
  sleepAfterMinutes: int(0, 240),
  briefingTime: (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : INVALID),
  focusMinutes: int(1, 240),
  voiceLanguage: oneOf(['system', 'pt', 'en', 'es']),
  reminderLeadMinutes: list(int(0, 10_080), 8),
  ollamaUrl: cleanOllamaUrl,
  ollamaModel: text(120, { min: 1 }),
  modelChat: text(120),
  modelTriage: text(120),
  modelWriting: text(120),
  emailLookbackDays: int(1, 14),
  dndUntil: int(0, Number.MAX_SAFE_INTEGER),
  lastBriefingDate: (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : INVALID),
};

/** Keys that exist without a default value. They can be cleared by sending `undefined`. */
const OPTIONAL: (keyof Settings)[] = ['dndUntil', 'lastBriefingDate'];

/** The part of a patch that is safe to save. */
export function sanitizePatch(patch: unknown, defaults: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    const k = key as keyof Settings;
    const optional = OPTIONAL.includes(k);
    if (!optional && !Object.hasOwn(defaults, k)) continue; // not a setting (and never something inherited, like "constructor")
    if (value === undefined) { if (optional) out[k] = undefined; continue; }
    const check = Object.hasOwn(CHECKS, k) ? CHECKS[k] : undefined;
    if (check) {
      const clean = check(value);
      if (clean !== INVALID) out[k] = clean;
    } else if (typeof defaults[k] === 'boolean' && typeof value === 'boolean') {
      out[k] = value;
    }
  }
  return out as Partial<Settings>;
}
