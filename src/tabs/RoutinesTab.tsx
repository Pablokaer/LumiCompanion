import { useEffect, useState } from 'react';
import { FREQUENCY_LABEL, ROUTINE_PRESETS, type Routine, type RoutineFrequency, type RoutineInput, type RoutineKind } from '../../shared/routines';
import { api } from '../api';
import { EditIcon, PlayIcon, PlusIcon, TrashIcon } from '../components/Icons';
import { timeAgo } from '../format';

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const KIND_LABEL: Record<RoutineKind, string> = { news: 'News search', articles: 'Articles (Hacker News)', site: 'Website to watch' };
const TARGET_HINT: Record<RoutineKind, { label: string; placeholder: string; hint: string }> = {
  news: { label: 'Search for', placeholder: 'artificial intelligence OR LLM', hint: 'She searches the news for this every time the routine runs. OR and quotes work.' },
  articles: { label: 'Search for', placeholder: 'programming', hint: 'Developer articles and discussions from Hacker News.' },
  site: { label: 'Website address', placeholder: 'https://akitaonrails.com/', hint: 'Every new post becomes an item in News with a link straight to it. She uses the site’s feed when it has one.' },
};

const NEW_ROUTINE: RoutineInput = { name: '', kind: 'news', target: '', language: 'en', frequency: 'daily', time: '08:00', maxItems: 5, useAi: true, enabled: true };

const scheduleText = (r: Routine) => (r.frequency === 'daily' ? `Every day at ${r.time}` : FREQUENCY_LABEL[r.frequency]);

function lastRunText(r: Routine, now: Date) {
  if (r.lastError) return { text: `Problem: ${r.lastError}`, bad: true };
  if (!r.lastRunAt) return { text: r.enabled ? 'Waiting for its first run…' : 'Paused', bad: false };
  const added = r.lastAdded ? `${r.lastAdded} new` : 'nothing new';
  return { text: `Last run ${timeAgo(new Date(r.lastRunAt).toISOString(), now)} ago · ${added}`, bad: false };
}

export function RoutinesTab({ now }: { now: Date }) {
  const [routines, setRoutines] = useState<Routine[]>();
  const [draft, setDraft] = useState<RoutineInput>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string[]>([]);
  const [confirmId, setConfirmId] = useState<string>();

  useEffect(() => {
    void api.routines.list().then(setRoutines);
    return api.on('routines:updated', setRoutines);
  }, []);

  const edit = (patch: RoutineInput) => setDraft((d) => ({ ...d, ...patch }));
  const open = (d: RoutineInput) => { setDraft(d); setError(undefined); };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    try {
      setRoutines(await api.routines.save(draft));
      setDraft(undefined);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Routine) => setRoutines(await api.routines.save({ id: r.id, enabled: !r.enabled }));
  const runNow = async (r: Routine) => {
    setRunning((x) => [...x, r.id]);
    try { await api.routines.run(r.id); } finally { setRunning((x) => x.filter((id) => id !== r.id)); }
  };
  const remove = async (id: string) => { setConfirmId(undefined); setRoutines(await api.routines.remove(id)); };

  if (draft) {
    const kind = draft.kind ?? 'news';
    const t = TARGET_HINT[kind];
    return (
      <div className="tab-page">
        <section className="hello">
          <h2>{draft.id ? 'Edit routine' : 'New routine'}</h2>
          <p>A job she does for you by herself, and reports in News.</p>
        </section>
        <section className="card">
          {!draft.id && (
            <div className="field">
              <span>Start from an idea</span>
              <div className="chips">
                {ROUTINE_PRESETS.map((p) => (
                  <button key={p.name} className="chip small" onClick={() => edit({ name: p.name, kind: p.kind, target: p.target, language: p.language ?? draft.language })}>{p.name}</button>
                ))}
              </div>
            </div>
          )}
          <label className="field">
            <span>Name</span>
            <input value={draft.name ?? ''} maxLength={60} placeholder="AI news" onChange={(e) => edit({ name: e.target.value })} />
          </label>
          <label className="field">
            <span>What should she do?</span>
            <select value={kind} onChange={(e) => edit({ kind: e.target.value as RoutineKind, target: '' })}>
              {(Object.keys(KIND_LABEL) as RoutineKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t.label}</span>
            <input value={draft.target ?? ''} maxLength={300} placeholder={t.placeholder} spellCheck={false} onChange={(e) => edit({ target: e.target.value })} />
            <span className="hint">{t.hint}</span>
          </label>
          {kind === 'news' && (
            <label className="field">
              <span>News language</span>
              <select value={draft.language ?? 'en'} onChange={(e) => edit({ language: e.target.value as 'en' | 'pt' })}>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>How often</span>
            <select value={draft.frequency ?? 'daily'} onChange={(e) => edit({ frequency: e.target.value as RoutineFrequency })}>
              {(Object.keys(FREQUENCY_LABEL) as RoutineFrequency[]).map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
            </select>
          </label>
          {(draft.frequency ?? 'daily') === 'daily' && (
            <label className="field">
              <span>At</span>
              <input type="time" value={draft.time ?? '08:00'} onChange={(e) => edit({ time: e.target.value })} />
              <span className="hint">If the computer is off then, she runs it when it is back on.</span>
            </label>
          )}
          <label className="field">
            <span>Most items per run</span>
            <select value={draft.maxItems ?? 5} onChange={(e) => edit({ maxItems: Number(e.target.value) })}>
              {[1, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {kind !== 'site' && (
            <label className="toggle">
              <span>
                <span className="toggle-label">Pick and summarise with AI</span>
                <span className="hint">Uses the local Ollama model to choose the best items and write a line about each. Without it, the newest are used.</span>
              </span>
              <input type="checkbox" role="switch" checked={draft.useAi ?? true} onChange={(e) => edit({ useAi: e.target.checked })} />
              <span className="switch" aria-hidden="true" />
            </label>
          )}
          {error && <p className="hint warn" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="pill-btn ghost" onClick={() => setDraft(undefined)} disabled={saving}>Cancel</button>
            <button className="pill-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save' : 'Create and run'}</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="tab-page">
      <section className="hello">
        <h2>Routines</h2>
        <p>Jobs she does by herself every day. What she finds goes to the News tab.</p>
      </section>

      <button className="pill-btn" onClick={() => open(NEW_ROUTINE)}><PlusIcon width={15} height={15} /> New routine</button>

      {routines && routines.length === 0 && (
        <div className="card empty-card">
          <p>No routines yet. Start with one of these:</p>
          <div className="chips">
            {ROUTINE_PRESETS.map((p) => (
              <button key={p.name} className="chip small" onClick={() => open({ ...NEW_ROUTINE, name: p.name, kind: p.kind, target: p.target })}>{p.name}</button>
            ))}
            <button className="chip small" onClick={() => open({ ...NEW_ROUTINE, name: 'New posts', kind: 'site', target: '', frequency: 'hourly', useAi: false })}>Watch a website</button>
          </div>
        </div>
      )}

      <ul className="routine-list">
        {routines?.map((r) => {
          const last = lastRunText(r, now);
          return (
            <li key={r.id} className={`routine card${r.enabled ? '' : ' off'}`}>
              <div className="routine-head">
                <div className="routine-name">{r.name}</div>
                <label className="toggle compact" title={r.enabled ? 'Pause' : 'Resume'}>
                  <input type="checkbox" role="switch" aria-label={`${r.name} enabled`} checked={r.enabled} onChange={() => toggle(r)} />
                  <span className="switch" aria-hidden="true" />
                </label>
              </div>
              <div className="routine-what">{KIND_LABEL[r.kind]} · <span className="routine-target">{r.target}</span></div>
              <div className="routine-when">{scheduleText(r)} · up to {r.maxItems}</div>
              <div className={`routine-last${last.bad ? ' bad' : ''}`}>{last.text}</div>
              <div className="routine-actions">
                {confirmId === r.id ? (
                  <>
                    <span className="hint">Delete this routine?</span>
                    <button className="pill-btn small danger" onClick={() => remove(r.id)}>Delete</button>
                    <button className="pill-btn small ghost" onClick={() => setConfirmId(undefined)}>Keep</button>
                  </>
                ) : (
                  <>
                    <button className="pill-btn small ghost" onClick={() => runNow(r)} disabled={running.includes(r.id)}><PlayIcon width={13} height={13} /> {running.includes(r.id) ? 'Running…' : 'Run now'}</button>
                    <button className="pill-btn small ghost" onClick={() => open(r)}><EditIcon width={13} height={13} /> Edit</button>
                    <button className="icon-btn" onClick={() => setConfirmId(r.id)} aria-label={`Delete ${r.name}`} title="Delete"><TrashIcon width={16} height={16} /></button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
