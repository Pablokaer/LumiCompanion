import { createContext, useContext } from 'react';
import type { Accessory, Skin } from '../shared/types';

export interface SkinDef {
  label: string;
  /** Four body-gradient stops, light to dark. */
  stops: [string, string, string, string];
  /** Theme accent colours applied to the whole UI. */
  star: string;
  starStrong: string;
}

export const SKINS: Record<Skin, SkinDef> = {
  classic: { label: 'Classic', stops: ['#bfe6ff', '#5cb8ff', '#2f7bff', '#1e4fd8'], star: '#5cb8ff', starStrong: '#2f7bff' },
  nebula: { label: 'Nebula', stops: ['#eadcff', '#b388ff', '#7c4dff', '#4527a0'], star: '#b388ff', starStrong: '#7c4dff' },
  sunset: { label: 'Sunset', stops: ['#ffe5c7', '#ffb547', '#ff7a3d', '#d6336c'], star: '#ffb547', starStrong: '#ff7a3d' },
  mint: { label: 'Mint', stops: ['#d9ffec', '#5ee6b0', '#18b784', '#0b7a5c'], star: '#5ee6b0', starStrong: '#18b784' },
  mono: { label: 'Moon', stops: ['#ffffff', '#dfe4f2', '#a3adc9', '#626b8a'], star: '#dfe4f2', starStrong: '#a3adc9' },
};

export const ACCESSORIES: Record<Accessory, string> = {
  none: 'None',
  hat: 'Party hat',
  glasses: 'Glasses',
  crown: 'Crown',
  bow: 'Bow',
};

export interface Appearance { skin: Skin; accessory: Accessory }

const AppearanceContext = createContext<Appearance>({ skin: 'classic', accessory: 'none' });

export const AppearanceProvider = AppearanceContext.Provider;
export const useAppearance = () => useContext(AppearanceContext);

/** CSS variables that re-theme the UI for a skin. */
export function skinVars(skin: Skin): Record<string, string> {
  const s = SKINS[skin] ?? SKINS.classic;
  return { '--star': s.star, '--star-strong': s.starStrong, '--mascot-halo': s.star };
}
