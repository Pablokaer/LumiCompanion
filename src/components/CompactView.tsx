import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../../shared/types';
import { relative } from '../format';
import { Mascot, type Mood } from './Mascot';
import { Starfield } from './Starfield';

interface Props {
  mood: Mood;
  name: string;
  lines: string[];
  upcoming?: CalendarEvent;
  now: Date;
  onExpand(): void;
  onPoke(): void;
}

/** The small always-there widget: Lumi, a speech bubble and the next event chip. */
export function CompactView({ mood, name, lines, upcoming, now, onExpand, onPoke }: Props) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [lines.join('|')]);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % lines.length), 9000);
    return () => window.clearInterval(t);
  }, [lines.length]);

  const line = lines[i % lines.length];

  return (
    <div className="compact drag">
      <div className="bubble" key={line} role="status" aria-live="polite">{line}</div>
      <div className="portal">
        <Starfield density={0.004} />
      </div>
      <div className="compact-mascot no-drag">
        <Mascot mood={mood} size={128} title={`${name} — click to open`} onClick={() => { onPoke(); onExpand(); }} />
      </div>
      {upcoming && (
        <button className="next-chip no-drag" onClick={onExpand}>
          <span className="dot" />
          <span className="next-title">{upcoming.title}</span>
          <span className="next-when">{relative(upcoming.start, now)}</span>
        </button>
      )}
    </div>
  );
}
