/** What the computer's power state means for the mascot. Pure logic, shared by the main process and the interface. */

export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';

export interface PowerInputs {
  onBattery: boolean;
  thermal: ThermalState;
}

/** What the interface is told to do about it. */
export interface PowerHint {
  /** On battery or running warm: no spontaneous actions, and nothing needs more than the idle frame rate. Dancing and reactions still work. */
  calm: boolean;
  /** Overheating: she holds still, like when do-not-disturb is on. */
  critical: boolean;
}

export function powerHint({ onBattery, thermal }: PowerInputs): PowerHint {
  const critical = thermal === 'critical';
  return { critical, calm: critical || thermal === 'serious' || onBattery };
}

/** What the main process sends to the window. `hidden` covers a hidden or minimised window and a locked or sleeping screen. */
export interface PowerState extends PowerHint {
  hidden: boolean;
}

/** After this long without keyboard or mouse input the cursor cannot be moving, so there is nothing to follow. */
export const CURSOR_IDLE_LIMIT_S = 60;
/** The cursor is read this often while someone is there, so the eyes track as smoothly as before. */
export const CURSOR_POLL_MS = 33;
/** While nothing can be followed (window hidden, screen locked, user away) it is only checked this often, to notice the return. */
export const CURSOR_REST_MS = 250;

export interface CursorPollInput {
  followMouse: boolean;
  windowVisible: boolean;
  locked: boolean;
  idleSeconds: number;
}

/** True when the cursor position is worth reading right now. */
export function shouldPollCursor(i: CursorPollInput): boolean {
  return i.followMouse && i.windowVisible && !i.locked && i.idleSeconds <= CURSOR_IDLE_LIMIT_S;
}
