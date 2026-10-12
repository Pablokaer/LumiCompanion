import { useEffect, useState, type FormEvent } from 'react';
import type { CaptureResult, Settings } from '../shared/types';
import { api } from './api';
import { skinVars } from './appearance';
import { QuickAdd, initialFromEvent } from './components/QuickAdd';

/** The small window opened by the global shortcut: type a sentence, check it, save. */
export default function QuickCapture() {
  const [settings, setSettings] = useState<Settings>();
  const [text, setText] = useState('');
  const [result, setResult] = useState<CaptureResult>();
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => { api.settings.get().then(setSettings); }, []);
  useEffect(() => api.on('quick:show', () => { setText(''); setResult(undefined); setRound((r) => r + 1); }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void api.capture.close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const understand = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try { setResult(await api.capture.parse(text)); } finally { setBusy(false); }
  };

  return (
    <div className="shell quick-capture" style={settings ? skinVars(settings.skin, settings.customColor) : undefined}>
      <div className="quick-card">
        <h3>✦ Quick event</h3>
        {!result ? (
          <form onSubmit={understand}>
            <input key={round} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="lunch with Ana tomorrow 1pm" aria-label="Describe the event" />
            <p className="hint">Enter to continue · Esc to close</p>
            <button className="primary-btn" disabled={busy || !text.trim()}>{busy ? 'Reading…' : 'Continue'}</button>
          </form>
        ) : (
          <>
            <p className="hint">{result.understood ? `Understood${result.via === 'ai' ? ' with the local AI' : ''}. Check it and save.` : 'I could not find a date or time. Pick one below.'}</p>
            <QuickAdd key={round} initial={initialFromEvent(result.event)} onDone={() => void api.capture.close()} submitLabel="Save to Google Calendar" />
          </>
        )}
      </div>
    </div>
  );
}
