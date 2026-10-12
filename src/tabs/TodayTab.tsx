import { useState } from 'react';
import type { CalendarEvent, FocusState } from '../../shared/types';
import { api } from '../api';
import { FocusCard } from '../components/FocusCard';
import { ExternalIcon, PinIcon, PlusIcon, VideoIcon } from '../components/Icons';
import { QuickAdd } from '../components/QuickAdd';
import { fmtTime, greeting, groupByDay, nextEvent, relative } from '../format';

export function TodayTab({ events, now, name, focus, focusMinutes }: { events: CalendarEvent[]; now: Date; name?: string; focus?: FocusState; focusMinutes: number }) {
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

      <FocusCard focus={focus} defaultMinutes={focusMinutes} />

      {next && (
        <section className="next-card">
          <div className="next-label">Next up · {relative(next.start, now)}</div>
          <div className="next-name">{next.title}</div>
          <div className="next-meta">
            {fmtTime(next.start)} – {fmtTime(next.end)}
            {next.location && <> · <PinIcon width={13} height={13} /> {next.location}</>}
          </div>
          <div className="next-actions">
            {(next.joinUrl ?? next.meetLink) && <button className="pill-btn" onClick={() => api.window.openExternal((next.joinUrl ?? next.meetLink)!)}><VideoIcon width={15} height={15} /> Join</button>}
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
