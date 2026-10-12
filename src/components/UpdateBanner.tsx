import { useState } from 'react';
import { api } from '../api';
import { useUpdateState } from '../updates';

/** Shown when a downloaded update is waiting, or (on platforms that cannot update themselves) a newer version exists. */
export function UpdateBanner() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState('');
  if (!state || !state.version || dismissed === state.version) return null;
  const ready = state.status === 'ready';
  const download = state.status === 'available' && state.notifyOnly;
  if (!ready && !download) return null;

  return (
    <section className="update-banner" role="status">
      <span className="update-text">
        <strong>Lumi {state.version}</strong> {ready ? 'is ready to install.' : 'is available.'}
      </span>
      {ready
        ? <button className="pill-btn small" onClick={() => void api.updates.install()}>Restart now</button>
        : <button className="pill-btn small" onClick={() => void api.updates.openDownload()}>Download</button>}
      <button className="icon-btn" onClick={() => setDismissed(state.version ?? '')} aria-label="Remind me later" title="Later">✕</button>
    </section>
  );
}
