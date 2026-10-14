import { useState } from 'react';
import type { NewsItem } from '../../shared/routines';
import { api } from '../api';
import { CloseIcon } from '../components/Icons';
import { timeAgo } from '../format';

interface Props {
  news: NewsItem[];
  now: Date;
  /** Opens the Routines tab, where news comes from. */
  onRoutines(): void;
}

export function NewsTab({ news, now, onRoutines }: Props) {
  const [routineId, setRoutineId] = useState<string>();
  const routines = [...new Map(news.map((n) => [n.routineId, n.routineName])).entries()];
  // A filter for a routine whose news is all gone falls back to "All".
  const active = routines.some(([id]) => id === routineId) ? routineId : undefined;
  const list = active ? news.filter((n) => n.routineId === active) : news;
  const unread = news.filter((n) => !n.read).length;
  const hasRead = news.some((n) => n.read);

  return (
    <div className="tab-page">
      <section className="hello">
        <h2>News</h2>
        <p>{news.length ? (unread ? `${unread} unread from your routines.` : 'You are all caught up ✦') : 'What your routines find shows up here.'}</p>
      </section>

      {news.length === 0 ? (
        <div className="card empty-card">
          <p>No news yet. Create a routine and she will look for articles every day, or watch a website for new posts.</p>
          <button className="pill-btn" onClick={onRoutines}>Create a routine</button>
        </div>
      ) : (
        <>
          <div className="news-tools">
            <div className="chips inbox-filter" role="group" aria-label="Filter by routine">
              <button className={`chip small${!active ? ' on' : ''}`} aria-pressed={!active} onClick={() => setRoutineId(undefined)}>All · {news.length}</button>
              {routines.map(([id, name]) => (
                <button key={id} className={`chip small${active === id ? ' on' : ''}`} aria-pressed={active === id} onClick={() => setRoutineId(id)}>{name}</button>
              ))}
            </div>
            <div className="news-actions">
              {unread > 0 && <button className="pill-btn small ghost" onClick={() => api.news.markRead()}>Mark all read</button>}
              {hasRead && <button className="pill-btn small ghost" onClick={() => api.news.clearRead()}>Clear read</button>}
            </div>
          </div>

          <ul className="news-list">
            {list.map((n) => (
              <li key={n.id} className={n.read ? 'read' : ''}>
                <button className="news-item" onClick={() => api.news.open(n.id)} title={n.url}>
                  <div className="news-top">
                    {!n.read && <i className="unread-dot" aria-label="Unread" />}
                    <span className="news-source">{n.source ?? n.routineName}</span>
                    <span className="news-time">{timeAgo(new Date(n.publishedAt ?? n.addedAt).toISOString(), now)}</span>
                  </div>
                  <div className="news-title">{n.title}</div>
                  {n.summary && <div className="news-summary">{n.summary}</div>}
                  {n.source && <div className="news-routine">{n.routineName}</div>}
                </button>
                <button className="icon-btn news-dismiss" onClick={() => api.news.dismiss(n.id)} aria-label="Remove" title="Remove"><CloseIcon width={14} height={14} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
