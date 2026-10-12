import type { CalendarEvent } from '../../shared/types';
import { api } from '../api';
import { dayKey } from '../calendar';
import { fmtTime } from '../format';
import { VideoIcon } from './Icons';

/** The events of one day, all-day first. Finished events are dimmed and the running one is highlighted. */
export function DayAgenda({ day, events, now, empty = 'Nothing planned — clear skies ✦' }: {
  day: Date; events: CalendarEvent[]; now: Date; empty?: string;
}) {
  if (!events.length) return <p className="empty">{empty}</p>;
  const isToday = dayKey(day) === dayKey(now);
  return (
    <ul className="agenda">
      {events.map((e) => {
        const done = isToday && !e.allDay && new Date(e.end) <= now;
        const live = isToday && !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
        return (
          <li key={e.id + e.start} className={`agenda-item${done ? ' done' : ''}${live ? ' live' : ''}`}>
            <span className="agenda-time">{e.allDay ? 'All day' : <>{fmtTime(e.start)}<small>{fmtTime(e.end)}</small></>}</span>
            <span className="agenda-body">
              <span className="agenda-title">{e.title}</span>
              {e.location && <small>{e.location}</small>}
            </span>
            {(e.joinUrl ?? e.meetLink) && !done && (
              <button className="icon-btn" onClick={() => api.window.openExternal((e.joinUrl ?? e.meetLink)!)} aria-label={`Join ${e.title}`} title="Join the call"><VideoIcon width={16} height={16} /></button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
