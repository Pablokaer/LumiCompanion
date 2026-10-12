import { useEffect, useState } from 'react';
import type { EmailDraft, ImportanceLevel, NewEventInput, ScoredEmail } from '../../shared/types';
import { api } from '../api';
import { initialFromEvent, QuickAdd } from '../components/QuickAdd';
import { timeAgo } from '../format';

const LEVEL_LABEL: Record<ImportanceLevel, string> = { high: 'Supernova', medium: 'Bright', low: 'Faint' };

const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

type Panel = { id: string; kind: 'reply' | 'event' };

export function InboxTab({ emails, now }: { emails: ScoredEmail[]; now: Date }) {
  const [showAll, setShowAll] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const important = emails.filter((e) => e.level !== 'low');
  const list = showAll ? emails : important;

  const toggle = (id: string, kind: Panel['kind']) =>
    setPanel((p) => (p?.id === id && p.kind === kind ? undefined : { id, kind }));

  return (
    <div className="tab-page">
      <section className="hello">
        <h2>Brightest emails</h2>
        <p>{important.length ? `${important.length} worth your attention, ranked by importance.` : 'Nothing urgent in your inbox right now ✦'}</p>
      </section>

      <div className="legend">
        <span><i className="lv high" />Supernova</span>
        <span><i className="lv medium" />Bright</span>
        <span><i className="lv low" />Faint</span>
      </div>

      <ul className="email-list">
        {list.map((e) => (
          <li key={e.id}>
            <button className={`email lv-${e.level}`} onClick={() => api.window.openExternal(e.url)} title="Open in Gmail">
              <div className="email-top">
                <span className="email-from">{e.from}</span>
                <span className="email-time">{timeAgo(e.date, now)}</span>
              </div>
              <div className="email-subject">{e.subject}</div>
              <div className="email-snippet">{e.snippet}</div>
              <div className="email-tags">
                <span className={`level-tag ${e.level}`}>{LEVEL_LABEL[e.level]} · {e.score}</span>
                {e.aiReason && <span className="tag ai">✦ {e.aiReason}</span>}
                {!e.aiReason && e.reasons.slice(0, 2).map((r) => <span key={r} className="tag">{r}</span>)}
              </div>
            </button>
            <div className="email-actions">
              <button className={`chip small${panel?.id === e.id && panel.kind === 'reply' ? ' on' : ''}`} onClick={() => toggle(e.id, 'reply')}>✎ Draft reply</button>
              <button className={`chip small${panel?.id === e.id && panel.kind === 'event' ? ' on' : ''}`} onClick={() => toggle(e.id, 'event')}>📅 Make event</button>
            </div>
            {panel?.id === e.id && panel.kind === 'reply' && <ReplyPanel email={e} onClose={() => setPanel(undefined)} />}
            {panel?.id === e.id && panel.kind === 'event' && <EventPanel email={e} onClose={() => setPanel(undefined)} />}
          </li>
        ))}
      </ul>
      {emails.length > important.length && (
        <button className="link-btn" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show only important' : `Show ${emails.length - important.length} faint emails too`}
        </button>
      )}
    </div>
  );
}

/** Ask for a reply, edit it, and save it to Gmail Drafts. Nothing is ever sent from here. */
function ReplyPanel({ email, onClose }: { email: ScoredEmail; onClose(): void }) {
  const [instructions, setInstructions] = useState('');
  const [draft, setDraft] = useState<EmailDraft>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();

  const generate = async () => {
    setBusy(true); setError(undefined); setSaved(undefined);
    try { setDraft(await api.mail.draftReply(email.id, instructions)); } catch (e) { setError(cleanError(e)); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError(undefined);
    try { setSaved((await api.mail.saveDraft(draft)).url); } catch (e) { setError(cleanError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="inline-panel">
      {!draft ? (
        <>
          <label className="field">
            <span>What should the reply say? (optional)</span>
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Accept, but ask to move it to Thursday" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void generate(); }} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <button className="pill-btn ghost small" onClick={onClose}>Cancel</button>
            <button className="primary-btn" disabled={busy} onClick={generate}>{busy ? 'Writing…' : 'Write draft'}</button>
          </div>
        </>
      ) : (
        <>
          <label className="field"><span>To</span><input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <label className="field"><span>Subject</span><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
          <label className="field"><span>Message</span><textarea rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
          <p className="hint">Review and edit. Saving puts it in your Gmail Drafts — Lumi never sends email.</p>
          {error && <p className="error">{error}</p>}
          {saved ? (
            <div className="form-actions">
              <span className="hint ok">Saved to Gmail Drafts ✦</span>
              <button className="pill-btn small" onClick={() => api.window.openExternal(saved)}>Open drafts</button>
              <button className="pill-btn ghost small" onClick={onClose}>Done</button>
            </div>
          ) : (
            <div className="form-actions">
              <button className="pill-btn ghost small" disabled={busy} onClick={generate}>Rewrite</button>
              <button className="primary-btn" disabled={busy || !draft.body.trim()} onClick={save}>{busy ? 'Saving…' : 'Save to Gmail drafts'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Looks for a meeting or deadline in the email and offers it as a prefilled event. */
function EventPanel({ email, onClose }: { email: ScoredEmail; onClose(): void }) {
  const [suggestion, setSuggestion] = useState<NewEventInput | null>();
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.mail.suggestEvent(email.id)
      .then((s) => { if (!cancelled) setSuggestion(s ?? null); })
      .catch((e) => { if (!cancelled) { setError(cleanError(e)); setSuggestion(null); } });
    return () => { cancelled = true; };
  }, [email.id]);

  if (suggestion === undefined) return <div className="inline-panel"><p className="hint">Looking for a date in this email…</p></div>;

  if (suggestion) {
    return (
      <div className="inline-panel">
        <p className="hint">Found this in the email — check it before adding:</p>
        <QuickAdd initial={initialFromEvent(suggestion)} onDone={onClose} />
      </div>
    );
  }
  return (
    <div className="inline-panel">
      {error ? <p className="error">{error}</p> : <p className="hint">I couldn’t find a clear meeting or deadline in this email.</p>}
      {manual ? (
        <QuickAdd initial={{ title: email.subject }} onDone={onClose} />
      ) : (
        <div className="form-actions">
          <button className="pill-btn ghost small" onClick={onClose}>Close</button>
          <button className="pill-btn small" onClick={() => setManual(true)}>Create one manually</button>
        </div>
      )}
    </div>
  );
}
