import { ACCESSORY_SLOTS, SHAPES, SLOT_ORDER } from '../shared/appearance';
import type { Accessory, Shape, Skin } from '../shared/types';
import { AppearanceProvider, ACCESSORY_LABEL, SHAPE_INFO, skinVars } from './appearance';
import { Mascot } from './components/Mascot';

/**
 * Browser-preview only (`?gallery=1`): every shape, and every accessory on the classic star, side by side.
 * `?skin=sunset` re-colours it, `?mood=happy` changes the expression.
 */
export function Gallery() {
  const params = new URLSearchParams(location.search);
  const skin = (params.get('skin') ?? 'classic') as Skin;
  const mood = (params.get('mood') ?? 'idle') as 'idle' | 'happy';
  const accessories = SLOT_ORDER.flatMap((slot) => ACCESSORY_SLOTS[slot]);

  const cell = (key: string, label: string, shape: Shape, worn: Accessory[]) => (
    <figure key={key} className="gallery-cell">
      <AppearanceProvider value={{ skin, shape, accessories: worn }}>
        <Mascot size={110} mood={mood} />
      </AppearanceProvider>
      <figcaption>{label}</figcaption>
    </figure>
  );

  return (
    <div className="gallery" style={skinVars(skin)}>
      <h2>Shapes</h2>
      <div className="gallery-grid">{SHAPES.map((s) => cell(s, SHAPE_INFO[s].label, s, []))}</div>
      <h2>Accessories</h2>
      <div className="gallery-grid">{accessories.map((a) => cell(a, ACCESSORY_LABEL[a], 'star', [a]))}</div>
      <h2>Accessories on other bodies</h2>
      <div className="gallery-grid">
        {cell('p', 'Planet + wizard + sunglasses', 'planet', ['wizard', 'sunglasses'])}
        {cell('e', 'Earth + halo + scarf', 'earth', ['halo', 'scarf'])}
        {cell('m', 'Moon + helmet', 'moon', ['helmet'])}
        {cell('s', 'Sun + crown + mustache', 'sun', ['crown', 'mustache'])}
        {cell('c', 'Comet + headphones + bow tie', 'comet', ['headphones', 'bowtie'])}
        {cell('x', 'Sparkle + tophat + monocle', 'sparkle', ['tophat', 'monocle'])}
        {cell('h', 'Six-point + cat ears', 'hexa', ['catears'])}
        {cell('b', 'Chubby + flower + glasses', 'chubby', ['flower', 'glasses'])}
      </div>
    </div>
  );
}
