import { useMemo } from 'react';

export type Mood = 'idle' | 'happy' | 'alert' | 'thinking' | 'sleepy';

interface Props {
  mood?: Mood;
  size?: number;
  onClick?: () => void;
  title?: string;
}

/** Chubby rounded five-point star path centred in a 200×200 box. */
function starPath(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Lumi, the little blue star. */
export function Mascot({ mood = 'idle', size = 140, onClick, title }: Props) {
  const d = useMemo(() => starPath(100, 108, 70, 37), []);
  const id = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  return (
    <button
      type="button"
      className={`mascot mood-${mood}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={title ?? 'Lumi'}
      title={title}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`body-${id}`} cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#bfe6ff" />
            <stop offset="35%" stopColor="#5cb8ff" />
            <stop offset="75%" stopColor="#2f7bff" />
            <stop offset="100%" stopColor="#1e4fd8" />
          </radialGradient>
          <radialGradient id={`halo-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--mascot-halo)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--mascot-halo)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="mascot-halo" cx="100" cy="108" r="96" fill={`url(#halo-${id})`} />

        <g className="mascot-sparkles" fill="#d9f0ff">
          <path className="spark s1" d="M28 46 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z" />
          <path className="spark s2" d="M170 40 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" />
          <path className="spark s3" d="M176 150 l2.5 7 7 2.5 -7 2.5 -2.5 7 -2.5 -7 -7 -2.5 7 -2.5z" />
        </g>

        <g className="mascot-body">
          <path d={d} fill={`url(#body-${id})`} stroke={`url(#body-${id})`} strokeWidth="22" strokeLinejoin="round" />
          {/* shine */}
          <ellipse cx="76" cy="72" rx="14" ry="7" fill="#fff" opacity="0.45" transform="rotate(-30 76 72)" />

          <Face mood={mood} />
        </g>
      </svg>
    </button>
  );
}

function Face({ mood }: { mood: Mood }) {
  const ink = '#0b1a4a';
  return (
    <g className="mascot-face">
      {/* cheeks */}
      <ellipse cx="68" cy="126" rx="10" ry="6" fill="#ff8fc8" opacity={mood === 'alert' ? 0.3 : 0.55} />
      <ellipse cx="132" cy="126" rx="10" ry="6" fill="#ff8fc8" opacity={mood === 'alert' ? 0.3 : 0.55} />

      {/* eyes */}
      {mood === 'happy' && (
        <g stroke={ink} strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M74 110 q8 -11 16 0" />
          <path d="M110 110 q8 -11 16 0" />
        </g>
      )}
      {mood === 'sleepy' && (
        <g stroke={ink} strokeWidth="4.5" strokeLinecap="round" fill="none">
          <path d="M74 108 q8 7 16 0" />
          <path d="M110 108 q8 7 16 0" />
        </g>
      )}
      {(mood === 'idle' || mood === 'alert' || mood === 'thinking') && (
        <g className="mascot-eyes">
          {[82, 118].map((cx) => {
            const ry = mood === 'alert' ? 13 : 11;
            const dx = mood === 'thinking' ? 3 : 0;
            const dy = mood === 'thinking' ? -4 : 1;
            return (
              <g key={cx}>
                <ellipse cx={cx} cy="106" rx={mood === 'alert' ? 10 : 9} ry={ry} fill="#fff" />
                <circle cx={cx + dx} cy={106 + dy} r={mood === 'alert' ? 5 : 6} fill={ink} />
                <circle cx={cx + dx + 2.5} cy={106 + dy - 3} r="2" fill="#fff" />
              </g>
            );
          })}
        </g>
      )}

      {/* mouth */}
      {mood === 'idle' && <path d="M90 126 q10 9 20 0" stroke={ink} strokeWidth="4.5" strokeLinecap="round" fill="none" />}
      {mood === 'happy' && (
        <g>
          <path d="M86 122 q14 20 28 0 z" fill={ink} />
          <path d="M93 129 q7 6 14 0 q-7 -3 -14 0z" fill="#ff7aa8" />
        </g>
      )}
      {mood === 'alert' && <ellipse cx="100" cy="130" rx="6" ry="7.5" fill={ink} />}
      {mood === 'thinking' && <path d="M93 128 q6 -3 14 1" stroke={ink} strokeWidth="4.5" strokeLinecap="round" fill="none" />}
      {mood === 'sleepy' && <ellipse cx="100" cy="128" rx="4" ry="3" fill={ink} />}
    </g>
  );
}
