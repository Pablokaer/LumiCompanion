import type { Shape } from '../../shared/types';

/**
 * The star's body in every shape, in the mascot's 200×200 drawing box with the face centred on (100, 108).
 * Each shape has up to three parts: `Back` (behind the body: ring, tail, rays), `Body`, and `Front`
 * (in front of the body but behind the face, like the near half of a planet's ring).
 */

export interface ShapeProps {
  shape: Shape;
  /** `url(#…)` of the skin's body gradient. */
  fill: string;
  /** Unique id prefix for this mascot's clip paths and gradients. */
  uid: string;
  /** The skin's four gradient stops (light to dark), for details drawn in the skin's colours. */
  stops: [string, string, string, string];
}

/** Rounded n-point star path centred in the box (drawn with a thick round-joined stroke for soft tips). */
export function starPath(cx: number, cy: number, outer: number, inner: number, points = 5) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

const STAR_SHAPES: Partial<Record<Shape, string>> = {
  star: starPath(100, 108, 70, 37, 5),
  chubby: starPath(100, 108, 64, 46, 5),
  sparkle: starPath(100, 108, 70, 28, 4),
  hexa: starPath(100, 108, 70, 46, 6),
};

const isStar = (shape: Shape) => shape in STAR_SHAPES;

export function ShapeBack({ shape, stops, uid }: ShapeProps) {
  switch (shape) {
    case 'planet':
      // the far half of the ring, hidden behind the planet
      return (
        <g transform="rotate(-16 100 134)" fill="none" strokeLinecap="round">
          <path d="M6 134 A94 20 0 0 1 194 134" stroke={stops[2]} strokeWidth="10" />
          <path d="M16 134 A84 15 0 0 1 184 134" stroke={stops[0]} strokeWidth="3" opacity="0.7" />
        </g>
      );
    case 'sun':
      return (
        <g className="sun-rays" stroke={stops[1]} strokeWidth="10" strokeLinecap="round">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1="100" y1="34" x2="100" y2={i % 2 ? 40 : 28} transform={`rotate(${i * 30} 100 108)`} />
          ))}
        </g>
      );
    case 'comet':
      return (
        <g>
          <defs>
            <linearGradient id={`${uid}-tail`} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor={stops[1]} stopOpacity="1" />
              <stop offset="100%" stopColor={stops[0]} stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <path d="M112 62 Q164 46 206 -4 Q192 70 146 112 Z" fill={`url(#${uid}-tail)`} />
          <path d="M126 92 Q172 92 202 52 Q184 112 138 128 Z" fill={`url(#${uid}-tail)`} opacity="0.8" />
        </g>
      );
    default:
      return null;
  }
}

export function ShapeBody({ shape, fill, uid, stops }: ShapeProps) {
  if (isStar(shape)) {
    return <path d={STAR_SHAPES[shape]} fill={fill} stroke={fill} strokeWidth="22" strokeLinejoin="round" />;
  }
  switch (shape) {
    case 'planet':
      return (
        <g>
          <circle cx="100" cy="108" r="62" fill={fill} />
          <ellipse cx="100" cy="86" rx="46" ry="5" fill="#fff" opacity="0.1" />
          <ellipse cx="100" cy="152" rx="44" ry="6" fill="#000" opacity="0.1" />
        </g>
      );
    case 'earth':
      return (
        <g>
          <defs><clipPath id={`${uid}-clip`}><circle cx="100" cy="108" r="64" /></clipPath></defs>
          <circle cx="100" cy="108" r="64" fill={fill} />
          <g clipPath={`url(#${uid}-clip)`}>
            <path d="M44 84 q16 -22 40 -12 q10 12 -4 24 q-22 12 -36 -12z" fill="#4ade80" opacity="0.85" />
            <path d="M136 118 q22 -8 30 12 q-4 26 -26 26 q-14 -12 -4 -38z" fill="#4ade80" opacity="0.85" />
            <path d="M70 158 q24 -12 46 2 q-14 16 -40 10z" fill="#34c26a" opacity="0.85" />
            <path d="M120 56 q16 -6 24 4 q-12 8 -24 -4z M54 134 q10 -4 16 2 q-8 4 -16 -2z" fill="#fff" opacity="0.5" />
          </g>
        </g>
      );
    case 'moon':
      return (
        <g>
          <circle cx="100" cy="108" r="64" fill={fill} />
          <g fill="#000" opacity="0.13">
            <circle cx="60" cy="80" r="10" />
            <circle cx="146" cy="142" r="13" />
            <circle cx="72" cy="152" r="6" />
            <circle cx="148" cy="76" r="6" />
            <circle cx="46" cy="116" r="4" />
          </g>
        </g>
      );
    case 'sun':
      return <circle cx="100" cy="108" r="52" fill={fill} stroke={stops[1]} strokeWidth="4" />;
    case 'comet':
      return (
        <g>
          <circle cx="100" cy="108" r="56" fill={fill} />
          <circle cx="76" cy="76" r="5" fill="#fff" opacity="0.35" />
        </g>
      );
    default:
      return null;
  }
}

export function ShapeFront({ shape, stops }: ShapeProps) {
  if (shape !== 'planet') return null;
  // the near half of the ring, passing in front of the planet
  return (
    <g transform="rotate(-16 100 134)" fill="none" strokeLinecap="round">
      <path d="M6 134 A94 20 0 0 0 194 134" stroke={stops[2]} strokeWidth="10" />
      <path d="M16 134 A84 15 0 0 0 184 134" stroke={stops[0]} strokeWidth="3" opacity="0.7" />
    </g>
  );
}
