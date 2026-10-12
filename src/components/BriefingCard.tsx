import type { Briefing } from '../../shared/types';

/** The morning briefing: today's events and the emails that matter, dismissible. */
export function BriefingCard({ briefing, onDismiss }: { briefing: Briefing; onDismiss(): void }) {
  return (
    <section className="briefing-card" role="status">
      <div className="briefing-head">
        <strong>{briefing.title}</strong>
        <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss briefing">✕</button>
      </div>
      <ul>
        {briefing.lines.map((l, i) => (
          <li key={i} className={l.startsWith('•') ? 'item' : 'head'}>{l.startsWith('•') ? l.slice(1).trim() : l}</li>
        ))}
      </ul>
    </section>
  );
}
