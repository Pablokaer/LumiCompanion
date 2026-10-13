import { useState } from 'react';
import { api } from '../api';
import { useUpdateState } from '../updates';

/** Shown when a downloaded update is waiting, or (on platforms that cannot update themselves) a newer version exists. */
export function UpdateBanner() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState('');
  if (!state || !state.version || dismissed === state.version) return null;
  const ready = state.status === 'ready';
  const available = state.status === 'available';
  const downloading = state.status === 'downloading';
  if (!ready && !available && !downloading) return null;

  return (
    <section className="update-banner" role="status">
      <span className="update-text">
        <strong>Lumi {state.version}</strong> {ready ? 'is ready to install.' : downloading ? `is downloading… ${state.percent ?? 0}%` : 'is available.'}
      </span>
      {ready
        ? <button className="pill-btn small" onClick={() => void api.updates.install()}>Restart now</button>
        : downloading ? null
        : state.notifyOnly
          ? <button className="pill-btn small" onClick={() => void api.updates.openDownload()}>Download</button>
          : <button className="pill-btn small" onClick={() => void api.updates.download()}>Update now</button>}
      <button className="icon-btn" onClick={() => setDismissed(state.version ?? '')} aria-label="Remind me later" title="Later">✕</button>
    </section>
  );
}
