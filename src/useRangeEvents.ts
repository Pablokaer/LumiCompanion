import { useEffect, useState } from 'react';
import type { CalendarEvent } from '../shared/types';
import { api } from './api';

/**
 * Events between two dates, fetched on demand. `version` should change whenever
 * the background sync finishes so the view refreshes; the previous events stay
 * on screen while the next range loads.
 */
export function useRangeEvents(from: Date, to: Date, version?: string) {
  const [state, setState] = useState<{ events: CalendarEvent[]; loading: boolean; error?: string }>({ events: [], loading: true });
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.data.getRange(fromIso, toIso)
      .then((events) => { if (!cancelled) setState({ events, loading: false }); })
      .catch((e: Error) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }));
      });
    return () => { cancelled = true; };
  }, [fromIso, toIso, version]);

  return state;
}
