import { useMemo, useState } from 'react';
import type { DataSnapshot } from '../../shared/types';
import { DayAgenda } from '../components/DayAgenda';
import { MonthCalendar, Navigator } from '../components/MonthCalendar';
import { dayKey, eventsByDay, gridRange, monthTitle, sameMonth, shiftMonth, startOfDay } from '../calendar';
import { useRangeEvents } from '../useRangeEvents';

/** A full month view with navigation; selecting a day lists its events underneath. */
export function CalendarTab({ data, now }: { data: DataSnapshot; now: Date }) {
  const [month, setMonth] = useState(() => shiftMonth(now, 0));
  const [selected, setSelected] = useState(() => startOfDay(now));
  const { from, to } = useMemo(() => gridRange(month.getFullYear(), month.getMonth()), [month]);
  const { events, loading, error } = useRangeEvents(from, to, data.lastSync);
  const byDay = useMemo(() => eventsByDay(events), [events]);

  const goTo = (m: Date) => {
    setMonth(m);
    // Keep a sensible selection: today when returning to this month, otherwise the 1st.
    setSelected(sameMonth(m, now) ? startOfDay(now) : m);
  };
  const monthCount = useMemo(() => {
    const ids = new Set<string>();
    for (const [key, list] of byDay) if (key.startsWith(dayKey(month).slice(0, 7))) list.forEach((e) => ids.add(e.id + e.start));
    return ids.size;
  }, [byDay, month]);

  return (
    <div className="tab-page calendar-tab">
      <Navigator
        title={monthTitle(month)}
        unit="month"
        onPrev={() => goTo(shiftMonth(month, -1))}
        onNext={() => goTo(shiftMonth(month, 1))}
        onToday={() => goTo(shiftMonth(now, 0))}
        todayActive={sameMonth(month, now) && dayKey(selected) === dayKey(now)}
      />
      <p className="hint cal-count">{loading && !events.length ? 'Loading…' : `${monthCount} event${monthCount === 1 ? '' : 's'} this month`}</p>
      {error && <p className="error">{error}</p>}
      <MonthCalendar month={month} selected={selected} onSelect={(d) => { setSelected(startOfDay(d)); if (!sameMonth(d, month)) setMonth(shiftMonth(d, 0)); }} byDay={byDay} now={now} />
      <div className="section-head">
        <h3>{selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      </div>
      <DayAgenda day={selected} events={byDay.get(dayKey(selected)) ?? []} now={now} />
    </div>
  );
}
