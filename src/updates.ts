import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/types';
import { api } from './api';

/** The app's update status, kept in sync with the main process. */
export function useUpdateState(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    let alive = true;
    api.updates.getState().then((s) => { if (alive) setState(s); });
    const off = api.on('update:state', (s: UpdateState) => setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}

/** One line describing the state, for the Settings card. */
export function describeUpdate(s: UpdateState): string {
  switch (s.status) {
    case 'checking': return 'Checking for updates…';
    case 'none': return 'You are up to date ✦';
    case 'available': return `Version ${s.version} is available.`;
    case 'downloading': return `Downloading version ${s.version ?? ''}… ${s.percent ?? 0}%`;
    case 'ready': return `Version ${s.version} is ready — restarting to install.`;
    case 'error': return s.message ?? 'The update check failed.';
    case 'unsupported': return s.message ?? 'Updates are not available here.';
    default: return '';
  }
}
