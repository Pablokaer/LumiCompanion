import { useEffect, useState } from 'react';
import type { OllamaSetupState } from '../../shared/types';
import { api } from '../api';

/** The local-AI setup state, kept in sync with the main process. */
export function useOllamaSetup(): OllamaSetupState {
  const [state, setState] = useState<OllamaSetupState>({ status: 'idle' });
  useEffect(() => {
    let alive = true;
    api.agent.setupState().then((s) => { if (alive) setState(s); });
    const off = api.on('ollama:setup', (s: OllamaSetupState) => setState(s));
    return () => { alive = false; off(); };
  }, []);
  return state;
}

/** Shows the local AI being downloaded and set up, or why it could not be. Hidden when there is nothing to say. */
export function OllamaBanner() {
  const state = useOllamaSetup();
  const [hiddenReady, setHiddenReady] = useState(false);
  useEffect(() => {
    if (state.status !== 'ready') { setHiddenReady(false); return; }
    const t = setTimeout(() => setHiddenReady(true), 5000);
    return () => clearTimeout(t);
  }, [state.status]);

  if (state.status === 'idle' || (state.status === 'ready' && hiddenReady)) return null;
  const working = ['downloading', 'installing', 'starting', 'pulling'].includes(state.status);
  return (
    <section className={`update-banner ollama-banner${state.status === 'error' || state.status === 'unsupported' ? ' bad' : ''}`} role="status">
      <span className="update-text">
        {state.status === 'ready' ? <>✦ <strong>Local AI ready.</strong></>
          : working ? <><strong>Setting up the local AI.</strong> {describeSetup(state)}</>
          : <>{state.message}</>}
      </span>
      {state.status === 'error' && <button className="pill-btn small" onClick={() => void api.agent.setupOllama()}>Try again</button>}
      {working && state.percent !== undefined && state.status !== 'installing' && state.status !== 'starting' && (
        <div className="focus-bar" role="progressbar" aria-valuenow={state.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${state.percent}%` }} /></div>
      )}
    </section>
  );
}

export function describeSetup(s: OllamaSetupState): string {
  switch (s.status) {
    case 'downloading': return `Downloading Ollama… ${s.percent ?? 0}%`;
    case 'installing': return 'Installing Ollama…';
    case 'starting': return 'Starting it…';
    case 'pulling': return `Downloading the ${s.model ?? ''} model (a few GB, once)… ${s.percent ?? 0}%`;
    default: return s.message ?? '';
  }
}
