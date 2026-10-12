import { createContext, useContext } from 'react';
import { deriveSkin } from '../shared/color';
import type { Accessory, AccessorySlot, Shape, Skin } from '../shared/types';

export interface SkinDef {
  label: string;
  /** Four body-gradient stops, light to dark. */
  stops: [string, string, string, string];
  /** Theme accent colours applied to the whole UI. */
  star: string;
  starStrong: string;
}

export type PresetSkin = Exclude<Skin, 'custom'>;

export const SKINS: Record<PresetSkin, SkinDef> = {
  classic: { label: 'Classic', stops: ['#bfe6ff', '#5cb8ff', '#2f7bff', '#1e4fd8'], star: '#5cb8ff', starStrong: '#2f7bff' },
  nebula: { label: 'Nebula', stops: ['#eadcff', '#b388ff', '#7c4dff', '#4527a0'], star: '#b388ff', starStrong: '#7c4dff' },
  sunset: { label: 'Sunset', stops: ['#ffe5c7', '#ffb547', '#ff7a3d', '#d6336c'], star: '#ffb547', starStrong: '#ff7a3d' },
  mint: { label: 'Mint', stops: ['#d9ffec', '#5ee6b0', '#18b784', '#0b7a5c'], star: '#5ee6b0', starStrong: '#18b784' },
  mono: { label: 'Moon', stops: ['#ffffff', '#dfe4f2', '#a3adc9', '#626b8a'], star: '#dfe4f2', starStrong: '#a3adc9' },
};

export interface ShapeInfo {
  label: string;
  group: 'Stars' | 'Space';
  icon: string;
  /** Pixels to move head accessories so they sit on top of this body (the classic star's top is at 0). */
  topOffset: number;
  /** Pixels the arms are pushed outward for bodies that are rounder than the star. */
  armSpread: number;
}

export const SHAPE_INFO: Record<Shape, ShapeInfo> = {
  star: { label: 'Star', group: 'Stars', icon: '★', topOffset: 0, armSpread: 0 },
  chubby: { label: 'Chubby star', group: 'Stars', icon: '✮', topOffset: 4, armSpread: 3 },
  sparkle: { label: 'Sparkle', group: 'Stars', icon: '✦', topOffset: 0, armSpread: 0 },
  hexa: { label: 'Six-point', group: 'Stars', icon: '✶', topOffset: 0, armSpread: 4 },
  planet: { label: 'Ringed planet', group: 'Space', icon: '🪐', topOffset: 19, armSpread: 10 },
  earth: { label: 'Earth', group: 'Space', icon: '🌍', topOffset: 17, armSpread: 9 },
  moon: { label: 'Moon', group: 'Space', icon: '🌕', topOffset: 17, armSpread: 9 },
  sun: { label: 'Sun', group: 'Space', icon: '☀️', topOffset: 29, armSpread: 3 },
  comet: { label: 'Comet', group: 'Space', icon: '☄️', topOffset: 25, armSpread: 4 },
};

export const SLOT_LABEL: Record<AccessorySlot, string> = { head: 'Head', ears: 'Ears', eyes: 'Eyes', neck: 'Neck', face: 'Face' };

export const ACCESSORY_LABEL: Record<Accessory, string> = {
  hat: 'Party hat', crown: 'Crown', wizard: 'Wizard hat', tophat: 'Top hat', halo: 'Halo', flower: 'Flower',
  catears: 'Cat ears', antenna: 'Antenna', bow: 'Bow', helmet: 'Space helmet',
  headphones: 'Headphones',
  glasses: 'Glasses', sunglasses: 'Sunglasses', monocle: 'Monocle',
  scarf: 'Scarf', bowtie: 'Bow tie',
  mustache: 'Mustache',
};

export interface Appearance { skin: Skin; customColor: string; shape: Shape; accessories: Accessory[] }

const AppearanceContext = createContext<Appearance>({ skin: 'classic', customColor: '#ff6fae', shape: 'star', accessories: [] });

/** The colours for a skin: a preset, or one derived from the user's own colour. */
export function resolveSkin(skin: Skin, customColor: string): SkinDef {
  if (skin === 'custom') return { label: 'Custom', ...deriveSkin(customColor) };
  return SKINS[skin] ?? SKINS.classic;
}

export const AppearanceProvider = AppearanceContext.Provider;
export const useAppearance = () => useContext(AppearanceContext);

/** CSS variables that re-theme the UI for a skin. */
export function skinVars(skin: Skin, customColor = '#ff6fae'): Record<string, string> {
  const s = resolveSkin(skin, customColor);
  return { '--star': s.star, '--star-strong': s.starStrong, '--mascot-halo': s.star };
}
