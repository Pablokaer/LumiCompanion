import { useState } from 'react';
import type { AuthState } from '../../shared/types';
import { api } from '../api';
import { Mascot } from './Mascot';

export function LoginScreen({ auth, mascotName, onSignedIn }: { auth: AuthState; mascotName: string; onSignedIn(a: AuthState): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(await api.auth.signIn());
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login drag">
      <div className="login-top">
        <button className="icon-btn no-drag" onClick={() => api.window.hide()} aria-label="Hide">×</button>
      </div>
      <div className="login-hero">
        <Mascot mood={busy ? 'thinking' : 'happy'} size={170} />
        <h1>Hi, I’m {mascotName}!</h1>
        <p>Your little star companion. I’ll watch over your calendar, remind you before every meeting and spot the emails that really matter.</p>
      </div>

      {auth.configured ? (
        <button className="google-btn no-drag" onClick={signIn} disabled={busy}>
          <GoogleG />
          {busy ? 'Waiting for Google in your browser…' : 'Sign in with Google'}
        </button>
      ) : (
        <div className="setup-card no-drag">
          <strong>One-time setup needed</strong>
          <p>Add your Google OAuth client (type “Desktop app”) as <code>.env</code> or <code>google-oauth.json</code>. The README walks you through it in 5 minutes.</p>
        </div>
      )}
      {error && <p className="error no-drag">{error}</p>}
      <p className="fineprint">Lumi reads your calendar and inbox on this computer only. Your AI runs locally with Ollama.</p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
