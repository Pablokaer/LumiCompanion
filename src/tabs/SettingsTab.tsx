import { useEffect, useState } from 'react';
import { nextLocalHour } from '../../shared/dnd';
import { weatherSummary } from '../../shared/weather';
import { useDnd, useWeather } from '../automation';
import { ACCESSORY_SLOTS, SLOT_ORDER, toggleAccessory } from '../../shared/appearance';
import type { Accessory, AuthState, OllamaStatus, Settings, Shape, WidgetView } from '../../shared/types';
import { api } from '../api';
import { addSwatch, removeSwatch } from '../../shared/color';
import { ACCESSORY_LABEL, SHAPE_INFO, SKINS, SLOT_LABEL, type PresetSkin } from '../appearance';
import { ColorPicker } from '../components/ColorPicker';
import { Mascot } from '../components/Mascot';
import { useLife } from '../mascotLife';
import { describeUpdate, useUpdateState } from '../updates';

const LEAD_OPTIONS = [60, 30, 15, 10, 5, 1];

const TASK_MODELS: { key: 'modelChat' | 'modelTriage' | 'modelWriting'; label: string; hint: string }[] = [
  { key: 'modelChat', label: 'Chat and event extraction', hint: 'Must support tool calling (e.g. qwen2.5:7b).' },
  { key: 'modelTriage', label: 'Email triage', hint: 'A small, fast model is enough.' },
  { key: 'modelWriting', label: 'Writing (answers and email drafts)', hint: 'A larger model writes better text.' },
];

const VIEW_OPTIONS: { id: WidgetView; label: string; hint: string }[] = [
  { id: 'mascot', label: 'Star', hint: 'Just the star in a circle, with reminders and notifications.' },
  { id: 'month', label: 'Month', hint: 'A monthly calendar you can browse, with the selected day below.' },
  { id: 'day', label: 'Day', hint: 'A daily agenda you can step through day by day.' },
];

export function SettingsTab({ settings, onSettings, onLiveColor, auth, onSignedOut }: {
  settings: Settings; onSettings(s: Settings): void; onLiveColor(hex?: string): void; auth: AuthState; onSignedOut(a: AuthState): void;
}) {
  const [ollama, setOllama] = useState<OllamaStatus>();
  const life = useLife();
  const dnd = useDnd();
  const weather = useWeather();
  const [place, setPlace] = useState(settings.weatherPlace);
  const [shortcut, setShortcut] = useState(settings.quickCaptureShortcut);
  const [shortcutError, setShortcutError] = useState<string>();
  const update_ = useUpdateState();
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaUrl);
  const [mascotName, setMascotName] = useState(settings.mascotName);

  const update = async (patch: Partial<Settings>) => onSettings(await api.settings.update(patch));
  /** Saves a picked colour and stops previewing it. */
  const saveColor = async (hex: string) => {
    if (hex !== settings.customColor || settings.skin !== 'custom') await update({ customColor: hex, skin: 'custom' });
    onLiveColor(undefined);
  };
  const saveShortcut = async () => {
    const r = await api.capture.setShortcut(shortcut.trim());
    setShortcutError(r.ok ? undefined : r.error ?? 'That shortcut cannot be used.');
    if (r.ok) onSettings(await api.settings.update({ quickCaptureShortcut: shortcut.trim() }));
  };
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
        <h3>Appearance</h3>
        <div className="appearance-preview"><Mascot size={104} title="Preview" /></div>
        <div className="field">
          <span>Colour</span>
          <div className="chips" role="radiogroup" aria-label="Colour">
            {(Object.keys(SKINS) as PresetSkin[]).map((id) => (
              <button key={id} role="radio" aria-checked={settings.skin === id} className={`chip skin${settings.skin === id ? ' on' : ''}`} onClick={() => { onLiveColor(undefined); void update({ skin: id }); }}>
                <i className="swatch" style={{ background: `linear-gradient(135deg, ${SKINS[id].stops[1]}, ${SKINS[id].stops[3]})` }} />{SKINS[id].label}
              </button>
            ))}
            <button role="radio" aria-checked={settings.skin === 'custom'} className={`chip skin${settings.skin === 'custom' ? ' on' : ''}`} onClick={() => void update({ skin: 'custom' })}>
              <i className="swatch rainbow" style={settings.skin === 'custom' ? { background: settings.customColor } : undefined} />Custom
            </button>
          </div>
          {settings.skin === 'custom' && (
            <ColorPicker
              value={settings.customColor}
              swatches={settings.colorSwatches}
              onLive={onLiveColor}
              onCommit={(hex) => void saveColor(hex)}
              onSaveSwatch={(hex) => void update({ colorSwatches: addSwatch(settings.colorSwatches, hex) })}
              onRemoveSwatch={(hex) => void update({ colorSwatches: removeSwatch(settings.colorSwatches, hex) })}
            />
          )}
        </div>
        <div className="field">
          <span>Shape</span>
          {(['Stars', 'Space'] as const).map((group) => (
            <div key={group} className="chips" role="radiogroup" aria-label={`${group} shapes`}>
              {(Object.keys(SHAPE_INFO) as Shape[]).filter((id) => SHAPE_INFO[id].group === group).map((id) => (
                <button key={id} role="radio" aria-checked={settings.shape === id} className={`chip${settings.shape === id ? ' on' : ''}`} onClick={() => update({ shape: id })}>
                  <span aria-hidden="true">{SHAPE_INFO[id].icon}</span> {SHAPE_INFO[id].label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="field">
          <span>Accessories <small className="hint">one per spot, mix and match</small></span>
          {SLOT_ORDER.map((slot) => (
            <div key={slot} className="slot-row">
              <span className="slot-label">{SLOT_LABEL[slot]}</span>
              <div className="chips">
                {(ACCESSORY_SLOTS[slot] as Accessory[]).map((id) => {
                  const on = settings.accessories.includes(id);
                  return (
                    <button key={id} aria-pressed={on} className={`chip${on ? ' on' : ''}`} onClick={() => update({ accessories: toggleAccessory(settings.accessories, id) })}>{ACCESSORY_LABEL[id]}</button>
                  );
                })}
              </div>
            </div>
          ))}
          {settings.accessories.length > 0 && <button className="pill-btn ghost small" onClick={() => update({ accessories: [] })}>Take everything off</button>}
        </div>
      </section>

      <section className="card">
        <h3>Life</h3>
        <Toggle label="Lively star" hint="She smiles, hops, waves, hums and looks around on her own." checked={settings.mascotLife} onChange={(v) => update({ mascotLife: v })} />
        <Toggle label="React when I pet her" hint="Pass the mouse over her: she laughs, blushes, purrs, or tries to bite it." checked={settings.petReactions} onChange={(v) => update({ petReactions: v })} />
        <Toggle label="Eyes follow the mouse" hint="Her eyes track your cursor around the screen, and wander and blink on their own when it rests." checked={settings.followMouse} onChange={(v) => update({ followMouse: v })} />
        <Toggle label="Sleep when I am away" hint="Zzz… when the keyboard and mouse have been idle." checked={settings.sleepAfterMinutes > 0} onChange={(v) => update({ sleepAfterMinutes: v ? 3 : 0 })} />
        {settings.sleepAfterMinutes > 0 && (
          <label className="field">
            <span>Fall asleep after</span>
            <select value={settings.sleepAfterMinutes} onChange={(e) => update({ sleepAfterMinutes: Number(e.target.value) })}>
              {[...new Set([1, 3, 5, 10, 15, 30, settings.sleepAfterMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        )}
        <Toggle label="Dance to music" hint="Detects music playing on this computer and dances to its tempo. Audio is analysed in memory only, never recorded or sent." checked={settings.reactToMusic} onChange={(v) => update({ reactToMusic: v })} />
        {settings.reactToMusic && (
          <p className={`hint${life.musicStatus === 'unavailable' ? ' warn' : ''}`}>
            {life.musicStatus === 'unavailable' ? `Music detection is unavailable: ${life.musicError ?? 'audio capture failed'}`
              : life.dancing ? `♪ Dancing to about ${life.bpm} BPM`
              : life.musicStatus === 'listening' ? 'Listening for music… (steady beats only; speech is ignored)'
              : 'Starting…'}
          </p>
        )}
      </section>

      <section className="card">
        <h3>Do not disturb</h3>
        <p className="hint">{dnd.active ? `🔕 Quiet right now (${dnd.reason === 'manual' ? 'paused by you' : dnd.reason === 'fullscreen' ? 'a full-screen app is open' : 'you are in a meeting'}). Reminders wait and come back as a summary.` : 'Not quiet right now.'}</p>
        <div className="chips">
          <button className="chip" onClick={() => api.dnd.set(Date.now() + 3_600_000)}>Quiet for 1 hour</button>
          <button className="chip" onClick={() => api.dnd.set(nextLocalHour(Date.now(), 8))}>Until tomorrow morning</button>
          {dnd.reason === 'manual' && <button className="chip on" onClick={() => api.dnd.set(null)}>Turn off</button>}
        </div>
        <Toggle label="Quiet when an app is full-screen" hint="Games, videos and presentations. Detected on Windows only; on other systems use the pause above or meetings." checked={settings.dndFullscreen} onChange={(v) => update({ dndFullscreen: v })} />
        <Toggle label="Quiet during meetings" hint="While a calendar event with a time is running." checked={settings.dndMeetings} onChange={(v) => update({ dndMeetings: v })} />
        <Toggle label="Hide the widget while quiet" hint="Only for full-screen apps, so she does not float over your game or video." checked={settings.dndHideWidget} onChange={(v) => update({ dndHideWidget: v })} />
      </section>

      <section className="card">
        <h3>Weather and seasons</h3>
        <Toggle label="Show the weather" hint="Your approximate place comes from your IP address (ipwho.is / ipapi.co) or the city below; the weather comes from Open-Meteo. Nothing else is sent." checked={settings.weather} onChange={(v) => update({ weather: v })} />
        {settings.weather && (
          <>
            <label className="field">
              <span>City (empty = detect automatically)</span>
              <input value={place} placeholder="e.g. Lisbon" onChange={(e) => setPlace(e.target.value)} onBlur={() => place !== settings.weatherPlace && update({ weatherPlace: place.trim() })} />
            </label>
            <div className="field">
              <span>Temperature</span>
              <div className="chips" role="radiogroup" aria-label="Temperature unit">
                {(['c', 'f'] as const).map((u) => <button key={u} role="radio" aria-checked={settings.temperatureUnit === u} className={`chip${settings.temperatureUnit === u ? ' on' : ''}`} onClick={() => update({ temperatureUnit: u })}>°{u.toUpperCase()}</button>)}
              </div>
            </div>
            <p className={`hint${weather?.status === 'error' ? ' warn' : ''}`}>
              {weather?.status === 'ok' ? `${weather.place ? `${weather.place}: ` : ''}${weatherSummary(weather, settings.temperatureUnit)}` : weather?.status === 'error' ? weather.message : 'Looking outside…'}
            </p>
            <button className="pill-btn ghost small" onClick={() => api.weather.refresh()}>Refresh</button>
          </>
        )}
        <Toggle label="Dress for the weather and season" hint="Umbrella in the rain, scarf in the cold, sunglasses in the heat, festive hats on holidays, plus falling rain, snow, leaves or petals. Never replaces what you picked." checked={settings.seasonalLook} onChange={(v) => update({ seasonalLook: v })} />
      </section>

      <section className="card">
        <h3>Quick capture</h3>
        <Toggle label="Add events from anywhere" hint="Press the shortcut, type “lunch with Ana tomorrow 1pm” and it becomes an event." checked={settings.quickCapture} onChange={(v) => update({ quickCapture: v })} />
        {settings.quickCapture && (
          <label className="field">
            <span>Shortcut</span>
            <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} onBlur={() => shortcut.trim() !== settings.quickCaptureShortcut && void saveShortcut()} />
            {shortcutError ? <span className="hint warn">{shortcutError}</span> : <span className="hint">For example CommandOrControl+Shift+Space.</span>}
          </label>
        )}
      </section>

      <section className="card">
        <h3>Tips and system reactions</h3>
        <Toggle label="Gentle tips" hint="Water, stretching, rest your eyes, posture, late-night and rain reminders. Never while you are busy." checked={settings.proactiveTips} onChange={(v) => update({ proactiveTips: v })} />
        {settings.proactiveTips && (
          <div className="field">
            <span>How often</span>
            <div className="chips" role="radiogroup" aria-label="Tip frequency">
              {(['rare', 'normal', 'often'] as const).map((f) => <button key={f} role="radio" aria-checked={settings.tipFrequency === f} className={`chip${settings.tipFrequency === f ? ' on' : ''}`} onClick={() => update({ tipFrequency: f })}>{f === 'rare' ? 'Rarely' : f === 'often' ? 'Often' : 'Normal'}</button>)}
            </div>
          </div>
        )}
        <Toggle label="React to the computer" hint="Low battery, charging, Wi-Fi dropping, headphones, locking the screen." checked={settings.reactToSystem} onChange={(v) => update({ reactToSystem: v })} />
      </section>

      <section className="card">
        <h3>Morning briefing</h3>
        <Toggle label="Show a daily briefing" hint="Today’s events and important emails, once a day." checked={settings.morningBriefing} onChange={(v) => update({ morningBriefing: v })} />
        <label className="field">
          <span>Show it after</span>
          <input type="time" value={settings.briefingTime} disabled={!settings.morningBriefing} onChange={(e) => e.target.value && update({ briefingTime: e.target.value })} />
        </label>
        <button className="pill-btn ghost small" onClick={() => api.briefing.show()}>Preview now</button>
      </section>

      <section className="card">
        <h3>Focus timer</h3>
        <label className="field">
          <span>Default session length</span>
          <select value={settings.focusMinutes} onChange={(e) => update({ focusMinutes: Number(e.target.value) })}>
            {[...new Set([15, 25, 30, 45, 60, 90, settings.focusMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <p className="hint">Start a session from the Today tab. Reminders more than 5 minutes away are held back until it ends.</p>
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
        <Toggle label="Start Ollama automatically" hint="If it is installed but stopped, Lumi launches it for you." checked={settings.autoStartOllama} onChange={(v) => update({ autoStartOllama: v })} />
        <label className="field">
          <span>Default model</span>
          <select value={settings.ollamaModel} onChange={(e) => update({ ollamaModel: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {TASK_MODELS.map(({ key, label, hint }) => (
          <label key={key} className="field">
            <span>{label}</span>
            <select value={settings[key]} onChange={(e) => update({ [key]: e.target.value } as Partial<Settings>)}>
              <option value="">Default ({settings.ollamaModel})</option>
              {models.filter((m) => m !== settings.ollamaModel).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="hint">{hint}</span>
          </label>
        ))}
        {ollama?.running && !ollama.models.includes(settings.ollamaModel) && (
          <p className="hint warn">Model not installed. Run <code>ollama pull {settings.ollamaModel}</code></p>
        )}
        <label className="field">
          <span>Voice input language</span>
          <select value={settings.voiceLanguage} onChange={(e) => update({ voiceLanguage: e.target.value as Settings['voiceLanguage'] })}>
            <option value="system">Same as my computer</option>
            <option value="pt">Português</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <Toggle label="AI email triage" hint="Let the local model help rank your inbox." checked={settings.aiEmailTriage} onChange={(v) => update({ aiEmailTriage: v })} />
        <label className="field">
          <span>Look at emails from the last</span>
          <select value={settings.emailLookbackDays} onChange={(e) => update({ emailLookbackDays: Number(e.target.value) })}>
            {[1, 2, 3, 7, 14].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
          </select>
        </label>
      </section>

      <section className="card">
        <h3>Updates</h3>
        <p className="hint">{update_ ? `Lumi ${update_.currentVersion}` : '…'}</p>
        <Toggle label="Check for updates automatically" hint="Looks for a new version when Lumi starts and every few hours." checked={settings.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        {update_ && describeUpdate(update_) && <p className={`hint${update_.status === 'error' ? ' warn' : ''}`}>{describeUpdate(update_)}</p>}
        {update_?.status === 'downloading' && <div className="focus-bar" role="progressbar" aria-valuenow={update_.percent ?? 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${update_.percent ?? 0}%` }} /></div>}
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          {update_?.status === 'ready' ? (
            <button className="primary-btn" onClick={() => void api.updates.install()}>Restart to update</button>
          ) : update_?.status === 'available' && update_.notifyOnly ? (
            <button className="primary-btn" onClick={() => void api.updates.openDownload()}>Download {update_.version}</button>
          ) : (
            <button className="pill-btn ghost small" disabled={!update_ || update_.status === 'checking' || update_.status === 'downloading' || update_.status === 'unsupported'} onClick={() => void api.updates.check()}>Check now</button>
          )}
        </div>
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
