import type { ActiveNotice } from '../automation';

/** What she is saying about the computer or a tip, with a close button. Disappears by itself. */
export function NoticeToast({ notice, onDismiss }: { notice: ActiveNotice; onDismiss(): void }) {
  return (
    <section className={`notice-toast tone-${notice.tone}`} role="status" aria-live="polite">
      <span className="notice-text">{notice.line}</span>
      <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">✕</button>
    </section>
  );
}
