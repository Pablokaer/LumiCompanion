import { useState, type FormEvent } from 'react';
import type { CalendarEvent } from '../../shared/types';
import { api } from '../api';
import { ExternalIcon, PinIcon, PlusIcon, VideoIcon } from '../components/Icons';
import { fmtTime, greeting, groupByDay, nextEvent, relative } from '../format';

export function TodayTab({ events, now, name }: { events: CalendarEvent[]; now: Date; name?: string }) {
  const [adding, setAdding] = useState(false);
  const next = nextEvent(events, now);
  const groups = groupByDay(events, now);
  const todayCount = groups.find(([k]) => k === 'Today')?.[1].length ?? 0;

  return (
    <div className="tab-page">
      <section className="hello">
        <h2>{greeting(now)}{name ? `, ${name}` : ''}</h2>
        <p>{todayCount ? `${todayCount} event${todayCount > 1 ? 's' : ''} left in today’s orbit.` : 'Nothing else on today — clear skies ✦'}</p>
      </section>

      {next && (
        <section className="next-card">
          <div className="next-label">Next up · {relative(next.start, now)}</div>
          <div className="next-name">{next.title}</div>
          <div className="next-meta">
            {fmtTime(next.start)} – {fmtTime(next.end)}
            {next.location && <> · <PinIcon width={13} height={13} /> {next.location}</>}
          </div>
          <div className="next-actions">
            {next.meetLink && <button className="pill-btn" onClick={() => api.window.openExternal(next.meetLink!)}><VideoIcon width={15} height={15} /> Join</button>}
            {next.htmlLink && <button className="pill-btn ghost" onClick={() => api.window.openExternal(next.htmlLink!)}><ExternalIcon width={15} height={15} /> Open</button>}
          </div>
        </section>
      )}

      <div className="section-head">
        <h3>Upcoming</h3>
        <button className="pill-btn small" onClick={() => setAdding((a) => !a)}><PlusIcon width={14} height={14} /> {adding ? 'Close' : 'Add event'}</button>
      </div>
      {adding && <QuickAdd onDone={() => setAdding(false)} />}

      {groups.length === 0 && <p className="empty">No events in the next 7 days. Ask me in Chat to schedule something!</p>}
      {groups.map(([day, list]) => (
        <section key={day} className="day-group">
          <div className="day-label">{day}</div>
          <ul className="event-list">
            {list.map((e) => (
              <li key={e.id + e.start} className={`event${e === next ? ' is-next' : ''}`}>
                <span className="event-time">{e.allDay ? 'All day' : fmtTime(e.start)}</span>
                <span className="event-orb" />
                <span className="event-title">{e.title}{e.location && <small>{e.location}</small>}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function QuickAdd({ onDone }: { onDone(): void }) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  const [time, setTime] = useState(`${pad(Math.min(23, today.getHours() + 1))}:00`);
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.data.createEvent({ title, start: `${date}T${time}`, durationMinutes: duration });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="quick-add" onSubmit={submit}>
      <input autoFocus placeholder="What’s happening?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event title" />
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration">
          {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="primary-btn" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add to Google Calendar'}</button>
    </form>
  );
}
