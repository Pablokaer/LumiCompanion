import type { CalendarEvent } from '../../shared/types';
import { dayKey, monthGrid, monthTitle, sameMonth, weekdayLabels } from '../calendar';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';

const WEEKDAYS = weekdayLabels();

/** Previous / next / today controls with a title, shared by the tab and the widgets. */
export function Navigator({ title, onPrev, onNext, onToday, todayActive, unit }: {
  title: string; onPrev(): void; onNext(): void; onToday(): void; todayActive: boolean; unit: 'month' | 'day';
}) {
  return (
    <div className="cal-nav no-drag">
      <button className="icon-btn" onClick={onPrev} aria-label={`Previous ${unit}`}><ChevronLeftIcon /></button>
      <div className="cal-title" aria-live="polite">{title}</div>
      <button className="icon-btn" onClick={onNext} aria-label={`Next ${unit}`}><ChevronRightIcon /></button>
      <button className="chip small" onClick={onToday} disabled={todayActive}>Today</button>
    </div>
  );
}

export function MonthCalendar({ month, selected, onSelect, onOpen, byDay, now }: {
  month: Date; selected: Date; onSelect(d: Date): void; /** Double-click on a day. */ onOpen?(d: Date): void; byDay: Map<string, CalendarEvent[]>; now: Date;
}) {
  const days = monthGrid(month.getFullYear(), month.getMonth());
  const todayKey = dayKey(now);
  const selectedKey = dayKey(selected);

  return (
    <div className="month" role="grid" aria-label={monthTitle(month)}>
      <div className="month-row weekdays" role="row">
        {WEEKDAYS.map((w, i) => <span key={i} role="columnheader">{w}</span>)}
      </div>
      <div className="month-cells">
        {days.map((d) => {
          const key = dayKey(d);
          const events = byDay.get(key) ?? [];
          const cls = ['cell', sameMonth(d, month) ? '' : 'outside', key === todayKey ? 'today' : '', key === selectedKey ? 'selected' : '', events.length ? 'has-events' : '']
            .filter(Boolean).join(' ');
          return (
            <button
              key={key}
              className={cls}
              role="gridcell"
              onClick={() => onSelect(d)}
              onDoubleClick={() => onOpen?.(d)}
              aria-selected={key === selectedKey}
              aria-label={`${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}, ${events.length} event${events.length === 1 ? '' : 's'}`}
            >
              <span className="num">{d.getDate()}</span>
              <span className="dots" aria-hidden="true">
                {events.slice(0, 3).map((e, i) => <i key={e.id + i} className={e.allDay ? 'all' : ''} />)}
                {events.length > 3 && <b>+</b>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
