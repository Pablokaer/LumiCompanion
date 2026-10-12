import type { CSSProperties } from 'react';
import type { Ambient } from '../../shared/weather';

const COUNT: Record<Exclude<Ambient, 'none'>, number> = { rain: 22, snow: 18, leaves: 10, petals: 10 };

/** A cheap deterministic spread so each particle starts somewhere different. */
const spread = (i: number, salt: number) => ((i * 2654435761 + salt * 40503) % 1000) / 1000;

/** Rain, snow, falling leaves or blossom petals drifting through the background. Decoration only. */
export function AmbientLayer({ kind }: { kind: Ambient }) {
  if (kind === 'none') return null;
  return (
    <div className={`ambient ambient-${kind}`} aria-hidden="true">
      {Array.from({ length: COUNT[kind] }, (_, i) => (
        <i
          key={i}
          className={`amb amb-${kind} v${i % 3}`}
          style={{ '--x': `${Math.round(spread(i, 1) * 100)}%`, '--delay': `${(-spread(i, 2) * 8).toFixed(2)}s`, '--dur': `${(kind === 'rain' ? 0.7 + spread(i, 3) * 0.7 : 5 + spread(i, 3) * 6).toFixed(2)}s`, '--size': `${(0.7 + spread(i, 4) * 0.8).toFixed(2)}` } as CSSProperties}
        />
      ))}
    </div>
  );
}
