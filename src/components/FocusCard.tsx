import { useEffect, useState } from 'react';
import type { FocusState } from '../../shared/types';
import { api } from '../api';

const CHOICES = [15, 25, 45, 60];

export const formatClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Milliseconds left in a focus session, ticking every second while one is running. */
export function useRemaining(focus?: FocusState) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!focus) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [focus?.endsAt]);
  return focus ? Math.max(0, focus.endsAt - now) : 0;
}

/** Start or stop a focus session. While one runs, only reminders within 5 minutes interrupt you. */
export function FocusCard({ focus, defaultMinutes }: { focus?: FocusState; defaultMinutes: number }) {
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [busy, setBusy] = useState(false);
  const remaining = useRemaining(focus);
  const options = [...new Set([...CHOICES, defaultMinutes])].sort((a, b) => a - b);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  if (focus) {
    const pct = Math.min(100, Math.round(100 - (remaining / (focus.minutes * 60_000)) * 100));
    return (
      <section className="focus-card active" aria-live="polite">
        <div className="focus-top">
          <span className="focus-label">Focus session</span>
          <span className="focus-clock" aria-label={`${formatClock(remaining)} left`}>{formatClock(remaining)}</span>
        </div>
        <div className="focus-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
        <p className="hint">Only reminders within 5 minutes will interrupt you.</p>
        <button className="pill-btn ghost small" disabled={busy} onClick={() => run(() => api.focus.stop())}>End session</button>
      </section>
    );
  }

  return (
    <section className="focus-card">
      <div className="focus-top">
        <span className="focus-label">Focus session</span>
      </div>
      <div className="chips" role="radiogroup" aria-label="Session length">
        {options.map((m) => (
          <button key={m} role="radio" aria-checked={minutes === m} className={`chip${minutes === m ? ' on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>
        ))}
      </div>
      <button className="primary-btn" disabled={busy} onClick={() => run(() => api.focus.start(minutes))}>Start focusing</button>
    </section>
  );
}

/** A thin strip for the widgets showing the running countdown. */
export function FocusStrip({ focus }: { focus: FocusState }) {
  const remaining = useRemaining(focus);
  return (
    <div className="focus-strip no-drag">
      <span className="focus-dot" />
      <span>Focus · {formatClock(remaining)}</span>
      <button onClick={() => void api.focus.stop()} aria-label="End focus session">End</button>
    </div>
  );
}
