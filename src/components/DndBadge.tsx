import type { DndState } from '../../shared/dnd';

const REASON: Record<NonNullable<DndState['reason']>, string> = {
  manual: 'paused by you',
  fullscreen: 'full-screen app',
  meeting: 'in a meeting',
};

export const dndText = (d: DndState) => (d.active ? `Quiet — ${d.reason ? REASON[d.reason] : 'on'}${d.reason === 'meeting' && d.meeting ? `: ${d.meeting}` : ''}` : '');

/** A small "do not disturb" pill. */
export function DndBadge({ dnd }: { dnd: DndState }) {
  if (!dnd.active) return null;
  return <span className="dnd-badge" title={dndText(dnd)}>🔕 {dndText(dnd)}</span>;
}
