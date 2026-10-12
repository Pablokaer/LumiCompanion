import { useState } from 'react';
import type { ImportanceLevel, ScoredEmail } from '../../shared/types';
import { api } from '../api';
import { timeAgo } from '../format';

const LEVEL_LABEL: Record<ImportanceLevel, string> = { high: 'Supernova', medium: 'Bright', low: 'Faint' };

export function InboxTab({ emails, now }: { emails: ScoredEmail[]; now: Date }) {
  const [showAll, setShowAll] = useState(false);
  const important = emails.filter((e) => e.level !== 'low');
  const list = showAll ? emails : important;

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
