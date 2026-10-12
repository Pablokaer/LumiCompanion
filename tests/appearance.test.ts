import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_SLOTS, isAccessory, isShape, migrateAppearance, normalizeAccessories, SHAPES, SLOT_OF, SLOT_ORDER, toggleAccessory,
} from '../shared/appearance';
import { ACCESSORY_LABEL, SHAPE_INFO } from '../src/appearance';
import { ACCESSORY_DRAW_ORDER } from '../src/components/gear';

describe('appearance catalogue', () => {
  it('describes every shape and gives every accessory a label, a slot and a place in the draw order', () => {
    for (const s of SHAPES) expect(SHAPE_INFO[s]).toBeDefined();
    const all = SLOT_ORDER.flatMap((slot) => ACCESSORY_SLOTS[slot]);
    expect(new Set(all).size).toBe(all.length); // an accessory belongs to exactly one slot
    for (const a of all) {
      expect(ACCESSORY_LABEL[a]).toBeTruthy();
      expect(SLOT_OF[a]).toBeDefined();
    }
    expect([...ACCESSORY_DRAW_ORDER].sort()).toEqual([...all].sort());
  });

  it('offers a good number of options', () => {
    expect(SHAPES.length).toBeGreaterThanOrEqual(9);
    expect(SLOT_ORDER.flatMap((s) => ACCESSORY_SLOTS[s]).length).toBeGreaterThanOrEqual(17);
  });

  it('recognises valid ids only', () => {
    expect(isAccessory('wizard')).toBe(true);
    expect(isAccessory('none')).toBe(false);
    expect(isAccessory(3)).toBe(false);
    expect(isShape('planet')).toBe(true);
    expect(isShape('cube')).toBe(false);
  });
});

describe('wearing accessories', () => {
  it('replaces within a slot, combines across slots, and toggles off', () => {
    let worn = toggleAccessory([], 'hat');
    worn = toggleAccessory(worn, 'sunglasses');
    expect(worn).toEqual(['hat', 'sunglasses']);
    worn = toggleAccessory(worn, 'wizard'); // same slot as the party hat
    expect(worn.sort()).toEqual(['sunglasses', 'wizard']);
    worn = toggleAccessory(worn, 'headphones'); // different slot: stacks
    expect(worn).toHaveLength(3);
    expect(toggleAccessory(worn, 'wizard')).not.toContain('wizard');
  });

  it('cleans up stored lists: unknown ids dropped, one per slot, stable order', () => {
    expect(normalizeAccessories(['mustache', 'nope', 'hat', 'crown', 'glasses'])).toEqual(['crown', 'glasses', 'mustache']);
    expect(normalizeAccessories('hat')).toEqual([]);
    expect(normalizeAccessories(undefined)).toEqual([]);
  });
});

describe('settings migration', () => {
  it('turns the old single accessory into a list', () => {
    expect(migrateAppearance({ accessory: 'crown', skin: 'mint' })).toEqual({ skin: 'mint', accessories: ['crown'] });
    expect(migrateAppearance({ accessory: 'none' })).toEqual({});
    expect(migrateAppearance({ accessory: 'glasses', accessories: ['hat'] })).toEqual({ accessories: ['hat'] });
  });

  it('discards invalid shapes and accessories', () => {
    expect(migrateAppearance({ shape: 'cube' })).toEqual({});
    expect(migrateAppearance({ shape: 'moon', accessories: ['x', 'bow'] })).toEqual({ shape: 'moon', accessories: ['bow'] });
  });
});
