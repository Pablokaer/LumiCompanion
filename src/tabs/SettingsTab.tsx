import { useEffect, useState } from 'react';
import type { AuthState, OllamaStatus, Settings, WidgetView } from '../../shared/types';
import { api } from '../api';

const LEAD_OPTIONS = [60, 30, 15, 10, 5, 1];

const VIEW_OPTIONS: { id: WidgetView; label: string; hint: string }[] = [
  { id: 'mascot', label: 'Star', hint: 'Just the star in a circle, with reminders and notifications.' },
  { id: 'month', label: 'Month', hint: 'A monthly calendar you can browse, with the selected day below.' },
  { id: 'day', label: 'Day', hint: 'A daily agenda you can step through day by day.' },
];

export function SettingsTab({ settings, onSettings, auth, onSignedOut }: {
  settings: Settings; onSettings(s: Settings): void; auth: AuthState; onSignedOut(a: AuthState): void;
}) {
  const [ollama, setOllama] = useState<OllamaStatus>();
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [mascotName, setMascotName] = useState(settings.mascotName);

  const update = async (patch: Partial<Settings>) => onSettings(await api.settings.update(patch));
  const checkOllama = () => api.agent.ollamaStatus().then(setOllama);
  useEffect(() => { void checkOllama(); }, [settings.ollamaUrl]);

  const toggleLead = (m: number) => {
    const has = settings.reminderLeadMinutes.includes(m);
    void update({ reminderLeadMinutes: has ? settings.reminderLeadMinutes.filter((x) => x !== m) : [...settings.reminderLeadMinutes, m] });
  };

  const models = ollama?.models.length ? ollama.models : [settings.ollamaModel];

  return (
    <div className="tab-page settings">
      <section className="card">
        <h3>Widget</h3>
        <div className="field">
          <span>When shrunk to widget, show</span>
          <div className="chips" role="radiogroup" aria-label="Widget view">
            {VIEW_OPTIONS.map((o) => (
              <button key={o.id} role="radio" aria-checked={settings.widgetView === o.id} className={`chip${settings.widgetView === o.id ? ' on' : ''}`} onClick={() => update({ widgetView: o.id })}>{o.label}</button>
            ))}
          </div>
          <span className="hint">{VIEW_OPTIONS.find((o) => o.id === settings.widgetView)?.hint} Reminders always appear.</span>
        </div>
        <Toggle label="Always on top" hint="Off: Lumi lives on your desktop behind other windows and peeks out for reminders." checked={settings.widgetMode === 'onTop'} onChange={(v) => update({ widgetMode: v ? 'onTop' : 'desktop' })} />
        <Toggle label="Start with my computer" checked={settings.launchAtLogin} onChange={(v) => update({ launchAtLogin: v })} />
        <label className="field">
          <span>Mascot name</span>
          <input value={mascotName} maxLength={20} onChange={(e) => setMascotName(e.target.value)} onBlur={() => mascotName.trim() && update({ mascotName: mascotName.trim() })} />
        </label>
        <p className="hint">Tip: press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> anywhere to show or hide {settings.mascotName}.</p>
      </section>

      <section className="card">
        <h3>Reminders</h3>
        <p className="hint">Remind me before each event:</p>
        <div className="chips">
          {LEAD_OPTIONS.map((m) => (
            <button key={m} className={`chip${settings.reminderLeadMinutes.includes(m) ? ' on' : ''}`} onClick={() => toggleLead(m)} aria-pressed={settings.reminderLeadMinutes.includes(m)}>
              {m >= 60 ? `${m / 60} h` : `${m} min`}
            </button>
          ))}
        </div>
        <Toggle label="System notifications" checked={settings.systemNotifications} onChange={(v) => update({ systemNotifications: v })} />
      </section>

      <section className="card">
        <h3>Local AI (Ollama)</h3>
        <div className={`ollama-pill inline ${ollama?.running ? 'ok' : 'off'}`}><span className="dot" />{!ollama ? 'Checking…' : ollama.running ? 'Connected' : ollama.error}</div>
        <label className="field">
          <span>Server URL</span>
          <input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} onBlur={() => ollamaUrl !== settings.ollamaUrl && update({ ollamaUrl })} />
        </label>
        <label className="field">
          <span>Model</span>
          <select value={settings.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {ollama?.running && !ollama.models.includes(settings.ollamaModel) && (
          <p className="hint warn">Model not installed. Run <code>ollama pull {settings.ollamaModel}</code></p>
        )}
        <Toggle label="AI email triage" hint="Let the local model help rank your inbox." checked={settings.aiEmailTriage} onChange={(v) => update({ aiEmailTriage: v })} />
        <label className="field">
          <span>Look at emails from the last</span>
          <select value={settings.emailLookbackDays} onChange={(e) => update({ emailLookbackDays: Number(e.target.value) })}>
            {[1, 2, 3, 7, 14].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
          </select>
        </label>
      </section>

      <section className="card account">
        <h3>Account</h3>
        <div className="account-row">
          {auth.profile?.picture ? <img src={auth.profile.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{auth.profile?.name?.[0] ?? '?'}</span>}
          <div>
            <div className="account-name">{auth.profile?.name}</div>
            <div className="hint">{auth.profile?.email}</div>
          </div>
        </div>
        <button className="pill-btn ghost danger" onClick={async () => onSignedOut(await api.auth.signOut())}>Sign out</button>
      </section>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="toggle">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
