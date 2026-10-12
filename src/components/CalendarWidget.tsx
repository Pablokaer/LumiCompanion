import { useMemo, useState } from 'react';
import type { Briefing, FocusState, ReminderPayload, WidgetView } from '../../shared/types';
import { addDays, dayKey, eventsByDay, gridRange, monthTitle, sameMonth, shiftMonth, startOfDay } from '../calendar';
import { useRangeEvents } from '../useRangeEvents';
import { BriefingCard } from './BriefingCard';
import { DayAgenda } from './DayAgenda';
import { FocusStrip } from './FocusCard';
import { Mascot, type Mood } from './Mascot';
import { MonthCalendar, Navigator } from './MonthCalendar';

interface Props {
  view: Exclude<WidgetView, 'mascot'>;
  mood: Mood;
  name: string;
  now: Date;
  reminder?: ReminderPayload;
  version?: string;
  focus?: FocusState;
  briefing?: Briefing;
  onDismissBriefing(): void;
  onDismissReminder(): void;
  onExpand(): void;
  onPoke(): void;
}

/**
 * The shrunken widget as a calendar: a month grid with the selected day's events,
 * or a single day's agenda. The star stays in the corner (click to open Lumi) and
 * reminders still appear as a banner.
 */
export function CalendarWidget({ view, mood, name, now, reminder, version, focus, briefing, onDismissBriefing, onDismissReminder, onExpand, onPoke }: Props) {
  const [selected, setSelected] = useState(() => startOfDay(now));
  const month = shiftMonth(selected, 0);
  const rangeKey = dayKey(view === 'month' ? month : selected);
  const range = useMemo(
    () => (view === 'month' ? gridRange(month.getFullYear(), month.getMonth()) : { from: startOfDay(selected), to: addDays(startOfDay(selected), 1) }),
    // The key captures everything the range depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, rangeKey],
  );
  const { events, error } = useRangeEvents(range.from, range.to, version);
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const todayKey = dayKey(now);
  const dayEvents = byDay.get(dayKey(selected)) ?? [];

  const nav = view === 'month'
    ? {
        title: monthTitle(month), unit: 'month' as const,
        onPrev: () => setSelected(shiftMonth(selected, -1)), onNext: () => setSelected(shiftMonth(selected, 1)),
        todayActive: sameMonth(selected, now) && dayKey(selected) === todayKey,
      }
    : {
        title: dayKey(selected) === todayKey ? 'Today' : selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }),
        unit: 'day' as const,
        onPrev: () => setSelected(addDays(selected, -1)), onNext: () => setSelected(addDays(selected, 1)),
        todayActive: dayKey(selected) === todayKey,
      };

  return (
    <div className="cal-widget">
      <header className="cal-widget-head drag">
        <Mascot mood={mood} size={34} title={`${name} — click to open`} onClick={() => { onPoke(); onExpand(); }} />
        <Navigator {...nav} onToday={() => setSelected(startOfDay(now))} />
      </header>

      {reminder && (
        <div className="reminder-banner" role="alert">
          <span className="pulse" />
          <span>{reminder.message}</span>
          <button onClick={onDismissReminder}>Got it</button>
        </div>
      )}

      {focus && <FocusStrip focus={focus} />}

      <div className="cal-widget-body">
        {briefing && <BriefingCard briefing={briefing} onDismiss={onDismissBriefing} />}
        {view === 'month' && <MonthCalendar month={month} selected={selected} onSelect={(d) => setSelected(startOfDay(d))} byDay={byDay} now={now} />}
        {view === 'month' && <div className="cal-day-title">{selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
        {error && <p className="error">{error}</p>}
        <DayAgenda day={selected} events={dayEvents} now={now} />
      </div>
    </div>
  );
}
