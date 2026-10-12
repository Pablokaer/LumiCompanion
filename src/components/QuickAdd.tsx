import { useState, type FormEvent } from 'react';
import type { NewEventInput } from '../../shared/types';
import { api } from '../api';

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface QuickAddInitial {
  title?: string;
  date?: string;
  time?: string;
  duration?: number;
  allDay?: boolean;
  location?: string;
  description?: string;
}

/** Converts a suggested event (from an email) into the form's initial values. */
export function initialFromEvent(e: NewEventInput): QuickAddInitial {
  const [date, time] = e.start.split('T');
  let duration: number | undefined = e.durationMinutes;
  if (!duration && e.end && time) {
    const mins = Math.round((+new Date(e.end) - +new Date(e.start)) / 60_000);
    if (mins > 0 && mins <= 12 * 60) duration = mins;
  }
  return { title: e.title, date, time, duration, allDay: e.allDay || !time, location: e.location, description: e.description };
}

/** Small form that creates an event in Google Calendar. */
export function QuickAdd({ onDone, initial = {}, submitLabel = 'Add to Google Calendar' }: {
  onDone(): void; initial?: QuickAddInitial; submitLabel?: string;
}) {
  const today = new Date();
  const [title, setTitle] = useState(initial.title ?? '');
  const [date, setDate] = useState(initial.date ?? toDateInput(today));
  const [time, setTime] = useState(initial.time ?? `${pad(Math.min(23, today.getHours() + 1))}:00`);
  const [duration, setDuration] = useState(initial.duration ?? 60);
  const [allDay, setAllDay] = useState(!!initial.allDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.data.createEvent({
        title,
        start: allDay ? date : `${date}T${time}`,
        allDay: allDay || undefined,
        durationMinutes: allDay ? undefined : duration,
        location: initial.location,
        description: initial.description,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const durations = [...new Set([15, 30, 45, 60, 90, 120, duration])].sort((a, b) => a - b);

  return (
    <form className="quick-add" onSubmit={submit}>
      <input autoFocus placeholder="What’s happening?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event title" />
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" disabled={allDay} />
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration" disabled={allDay}>
          {durations.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : m % 60 ? `${m} min` : `${m / 60} h`}</option>)}
        </select>
      </div>
      <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
      {initial.location && <p className="hint">📍 {initial.location}</p>}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="pill-btn ghost" onClick={onDone}>Cancel</button>
        <button className="primary-btn" disabled={busy || !title.trim()}>{busy ? 'Adding…' : submitLabel}</button>
      </div>
    </form>
  );
}
