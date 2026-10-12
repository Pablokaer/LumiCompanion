import type { ReactElement } from 'react';
import type { Accessory } from '../../shared/types';

/**
 * Accessories, drawn in the mascot's 200×200 box. Head pieces sit on top of the body and are moved by
 * the shape's `topOffset`; the rest are anchored to the face, which is the same in every shape.
 */

const HEAD_ANCHORED: Accessory[] = ['hat', 'crown', 'wizard', 'tophat', 'halo', 'flower', 'catears', 'antenna', 'bow'];

const PIECES: Record<Accessory, () => ReactElement> = {
  hat: () => (
    <g transform="rotate(14 100 40)">
      <path d="M100 4 L78 50 L122 50 Z" fill="#ff7ac6" stroke="#b83e86" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M91 28 L109 28 M85 40 L115 40" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity="0.85" />
      <circle cx="100" cy="5" r="6" fill="#ffe066" stroke="#c9a400" strokeWidth="2" />
    </g>
  ),
  crown: () => (
    <g>
      <path d="M76 44 L80 16 L91 29 L100 10 L109 29 L120 16 L124 44 Z" fill="#ffc83d" stroke="#b8860b" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="100" cy="36" r="3.5" fill="#ff5c8a" />
      <circle cx="86" cy="38" r="2.5" fill="#5cd6ff" />
      <circle cx="114" cy="38" r="2.5" fill="#5cd6ff" />
    </g>
  ),
  wizard: () => (
    <g transform="rotate(-8 100 40)">
      <path d="M100 -26 Q96 8 74 46 L126 46 Q108 6 100 -26 Z" fill="#7a5af5" stroke="#4b32b3" strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="100" cy="46" rx="36" ry="8" fill="#5b3fc7" stroke="#4b32b3" strokeWidth="2.5" />
      <path d="M96 14 l2 5 5 1 -4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 5 -1z" fill="#ffe066" />
      <circle cx="108" cy="30" r="2.2" fill="#ffe066" />
      <circle cx="90" cy="34" r="1.8" fill="#ffe066" />
    </g>
  ),
  tophat: () => (
    <g transform="rotate(8 100 40)">
      <rect x="79" y="6" width="42" height="38" rx="4" fill="#23253a" stroke="#0f1020" strokeWidth="2.5" />
      <rect x="79" y="30" width="42" height="9" fill="#ff5c8a" />
      <ellipse cx="100" cy="46" rx="32" ry="7" fill="#23253a" stroke="#0f1020" strokeWidth="2.5" />
    </g>
  ),
  halo: () => (
    <g>
      <ellipse cx="100" cy="12" rx="28" ry="7.5" fill="none" stroke="#ffd84d" strokeWidth="6" />
      <ellipse cx="100" cy="12" rx="28" ry="7.5" fill="none" stroke="#fff6b8" strokeWidth="2" opacity="0.8" />
    </g>
  ),
  flower: () => (
    <g transform="translate(128 38)">
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={9 * Math.cos((a * Math.PI) / 180)} cy={9 * Math.sin((a * Math.PI) / 180)} r="7" fill="#ff8fc8" stroke="#d6559b" strokeWidth="1.5" />
      ))}
      <circle r="5.5" fill="#ffe066" stroke="#c9a400" strokeWidth="1.5" />
    </g>
  ),
  catears: () => (
    <g strokeLinejoin="round" strokeWidth="3">
      <path d="M60 46 L62 10 L90 34 Z" fill="#3b3f63" stroke="#23253a" />
      <path d="M140 46 L138 10 L110 34 Z" fill="#3b3f63" stroke="#23253a" />
      <path d="M66 38 L67 20 L82 33 Z" fill="#ff8fc8" />
      <path d="M134 38 L133 20 L118 33 Z" fill="#ff8fc8" />
    </g>
  ),
  antenna: () => (
    <g>
      <path d="M100 34 Q94 14 102 -2" fill="none" stroke="#3b3f63" strokeWidth="4" strokeLinecap="round" />
      <circle cx="102" cy="-6" r="8" fill="#ff5c6c" stroke="#b8303d" strokeWidth="2.5" />
      <circle cx="99.5" cy="-8.5" r="2.5" fill="#fff" opacity="0.7" />
    </g>
  ),
  bow: () => (
    <g transform="translate(138 48) rotate(18)">
      <path d="M0 0 L-20 -12 L-20 12 Z M0 0 L20 -12 L20 12 Z" fill="#ff5c8a" stroke="#b8305c" strokeWidth="2.5" strokeLinejoin="round" />
      <circle r="5" fill="#ff8fb0" stroke="#b8305c" strokeWidth="2" />
    </g>
  ),
  helmet: () => (
    <g>
      <circle cx="100" cy="108" r="80" fill="rgba(190, 225, 255, 0.12)" stroke="rgba(235, 245, 255, 0.85)" strokeWidth="5" />
      <path d="M44 70 A62 62 0 0 1 90 40" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      <path d="M52 84 A52 52 0 0 1 66 62" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.5" />
    </g>
  ),
  headphones: () => (
    <g>
      <path d="M50 108 Q50 28 100 28 Q150 28 150 108" fill="none" stroke="#2b2f4a" strokeWidth="8" strokeLinecap="round" />
      <rect x="38" y="92" width="22" height="36" rx="10" fill="#ff5c8a" stroke="#b8305c" strokeWidth="3" />
      <rect x="140" y="92" width="22" height="36" rx="10" fill="#ff5c8a" stroke="#b8305c" strokeWidth="3" />
    </g>
  ),
  glasses: () => (
    <g fill="rgba(255,255,255,0.18)" stroke="#0b1a4a" strokeWidth="4">
      <circle cx="82" cy="106" r="16" />
      <circle cx="118" cy="106" r="16" />
      <path d="M98 106 h4" fill="none" strokeLinecap="round" />
    </g>
  ),
  sunglasses: () => (
    <g>
      <rect x="62" y="93" width="38" height="25" rx="10" fill="#14162a" stroke="#000" strokeWidth="2.5" />
      <rect x="100" y="93" width="38" height="25" rx="10" fill="#14162a" stroke="#000" strokeWidth="2.5" />
      <path d="M98 100 h4" stroke="#000" strokeWidth="4" strokeLinecap="round" />
      <path d="M70 98 l8 -2 M108 98 l8 -2" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
    </g>
  ),
  monocle: () => (
    <g fill="rgba(255,255,255,0.12)" stroke="#d4a017" strokeWidth="4">
      <circle cx="118" cy="106" r="16" />
      <path d="M130 118 Q140 140 128 160" fill="none" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  scarf: () => (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M64 142 Q100 168 136 142" fill="none" stroke="#e0364f" strokeWidth="14" />
      <path d="M64 142 Q100 168 136 142" fill="none" stroke="#ff6b7f" strokeWidth="3" opacity="0.7" />
      <path d="M122 154 l8 26 l12 -4 l-6 -24 z" fill="#e0364f" stroke="#b8243a" strokeWidth="2" />
    </g>
  ),
  bowtie: () => (
    <g transform="translate(100 150)">
      <path d="M0 0 L-17 -10 L-17 10 Z M0 0 L17 -10 L17 10 Z" fill="#2c5dff" stroke="#173aa8" strokeWidth="2.5" strokeLinejoin="round" />
      <circle r="4.5" fill="#6f93ff" stroke="#173aa8" strokeWidth="2" />
    </g>
  ),
  mustache: () => (
    <path d="M76 118 Q86 108 100 116 Q114 108 124 118 Q112 128 100 120 Q88 128 76 118 Z" fill="#4a3426" stroke="#2c1d14" strokeWidth="2" strokeLinejoin="round" />
  ),
};

/** Draw order: neck pieces first, then ears, face and eyes, then head pieces, and the helmet's bubble last. */
export const ACCESSORY_DRAW_ORDER: Accessory[] = ['scarf', 'bowtie', 'headphones', 'mustache', 'glasses', 'sunglasses', 'monocle',
  'catears', 'hat', 'crown', 'wizard', 'tophat', 'halo', 'flower', 'antenna', 'bow', 'helmet'];

export function Gear({ accessories, topOffset }: { accessories: Accessory[]; topOffset: number }) {
  return (
    <g className="mascot-gear">
      {ACCESSORY_DRAW_ORDER.filter((a) => accessories.includes(a)).map((a) => {
        const Piece = PIECES[a];
        return (
          <g key={a} transform={HEAD_ANCHORED.includes(a) && topOffset ? `translate(0 ${topOffset})` : undefined}>
            <Piece />
          </g>
        );
      })}
    </g>
  );
}
