import { normalizeHex, normalizeSwatches } from './color';
import type { Accessory, AccessorySlot, Shape } from './types';

/**
 * Appearance data shared by the main process (settings migration) and the UI (pickers, drawing).
 * Pure and runtime-free apart from these tables.
 */

export const SHAPES: Shape[] = ['star', 'chubby', 'sparkle', 'hexa', 'planet', 'earth', 'moon', 'sun', 'comet'];

/** Accessories grouped by where they go. Only one per slot can be worn, different slots combine freely. */
export const ACCESSORY_SLOTS: Record<AccessorySlot, Accessory[]> = {
  head: ['hat', 'crown', 'wizard', 'tophat', 'halo', 'flower', 'catears', 'antenna', 'bow', 'helmet'],
  ears: ['headphones'],
  eyes: ['glasses', 'sunglasses', 'monocle'],
  neck: ['scarf', 'bowtie'],
  face: ['mustache'],
};

export const SLOT_ORDER: AccessorySlot[] = ['head', 'ears', 'eyes', 'neck', 'face'];

export const SLOT_OF: Record<Accessory, AccessorySlot> = Object.fromEntries(
  SLOT_ORDER.flatMap((slot) => ACCESSORY_SLOTS[slot].map((a) => [a, slot])),
) as Record<Accessory, AccessorySlot>;

export const isAccessory = (v: unknown): v is Accessory => typeof v === 'string' && v in SLOT_OF;
export const isShape = (v: unknown): v is Shape => typeof v === 'string' && (SHAPES as string[]).includes(v);

/** Adds an accessory, replacing whatever is worn in the same slot; choosing the worn one again takes it off. */
export function toggleAccessory(current: Accessory[], id: Accessory): Accessory[] {
  if (current.includes(id)) return current.filter((a) => a !== id);
  return [...current.filter((a) => SLOT_OF[a] !== SLOT_OF[id]), id];
}

/** Drops unknown values and keeps at most one accessory per slot (the last one listed wins). */
export function normalizeAccessories(input: unknown): Accessory[] {
  if (!Array.isArray(input)) return [];
  const bySlot = new Map<AccessorySlot, Accessory>();
  for (const item of input) if (isAccessory(item)) bySlot.set(SLOT_OF[item], item);
  return SLOT_ORDER.flatMap((slot) => bySlot.get(slot) ?? []);
}

/**
 * Brings stored settings up to date: the old single `accessory` value becomes the
 * `accessories` list, and invalid shapes or accessories are discarded.
 */
export function migrateAppearance<T extends Record<string, unknown>>(raw: T): Omit<T, 'accessory'> {
  const { accessory, ...rest } = raw as T & { accessory?: unknown };
  const out: Record<string, unknown> = { ...rest };
  if (out.accessories === undefined && isAccessory(accessory)) out.accessories = [accessory];
  if ('accessories' in out) out.accessories = normalizeAccessories(out.accessories);
  if ('shape' in out && !isShape(out.shape)) delete out.shape;
  if ('customColor' in out) {
    const hex = normalizeHex(out.customColor);
    if (hex) out.customColor = hex; else delete out.customColor;
  }
  if ('colorSwatches' in out) out.colorSwatches = normalizeSwatches(out.colorSwatches);
  return out as Omit<T, 'accessory'>;
}
