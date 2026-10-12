import { api } from '../api';

/** Opens the video call of an event. The link itself is checked again before it is opened. */
export function JoinButton({ url, label = 'Join', className = 'pill-btn small' }: { url: string; label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`${className} join-btn`}
      onClick={(e) => { e.stopPropagation(); void api.window.openExternal(url); }}
      title="Join the video call"
    >
      <span aria-hidden="true">📹</span> {label}
    </button>
  );
}
