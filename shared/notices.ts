/**
 * Short things the star says and does in response to the computer: waking up, charging, low battery,
 * going offline, a new audio device. Pure mapping functions so the wording and the rules are testable.
 */

export type NoticeTone = 'happy' | 'worried' | 'neutral';
export type NoticeAction = 'stretch' | 'wave' | 'hop' | 'twinkle' | 'cheer' | 'none';

export interface Notice {
  line: string;
  tone: NoticeTone;
  action: NoticeAction;
  /** How long it stays, in ms. */
  ms: number;
}

export type SystemKind = 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume' | 'on-ac' | 'on-battery';

/** What a power or session event means for her. `undefined` means she does not react. */
export function noticeForSystem(kind: SystemKind): Notice | undefined {
  switch (kind) {
    case 'unlock-screen': return { line: 'Welcome back! ✦', tone: 'happy', action: 'wave', ms: 6000 };
    case 'resume': return { line: 'Good to see you again! ✦', tone: 'happy', action: 'stretch', ms: 6000 };
    case 'on-ac': return { line: '⚡ Charging — ahh, that\'s better', tone: 'happy', action: 'hop', ms: 5000 };
    case 'on-battery': return { line: '🔋 Running on battery', tone: 'neutral', action: 'none', ms: 4000 };
    default: return undefined; // locking and sleeping make her fall asleep, not talk
  }
}

/** Whether this event means the person has left (so she should doze off at once) or come back. */
export const isAwayEvent = (kind: SystemKind) => kind === 'lock-screen' || kind === 'suspend';
export const isBackEvent = (kind: SystemKind) => kind === 'unlock-screen' || kind === 'resume';

export const noticeOffline = (): Notice => ({ line: 'No internet connection… 😟', tone: 'worried', action: 'none', ms: 7000 });
export const noticeOnline = (): Notice => ({ line: 'Back online! ✦', tone: 'happy', action: 'wave', ms: 4000 });

/** A change in the number of audio output devices (headphones, speakers, a headset). */
export function noticeForAudioDevices(before: number, after: number): Notice | undefined {
  if (after > before) return { line: '🎧 New audio device connected', tone: 'happy', action: 'twinkle', ms: 5000 };
  if (after < before) return { line: '🎧 Audio device disconnected', tone: 'neutral', action: 'none', ms: 4000 };
  return undefined;
}

export interface BatteryReading { level: number; charging: boolean }

/**
 * Warns when the battery runs low: once at 20% and once at 10%, and again only after it has been
 * charged back above 30%. Never nags while charging.
 */
export class BatteryWatcher {
  private warned: 0 | 20 | 10 = 0;

  update({ level, charging }: BatteryReading): Notice | undefined {
    const pct = Math.round(level * 100);
    if (charging || pct > 30) { this.warned = 0; return undefined; } // recharged: warn again next time
    if (pct <= 10 && this.warned !== 10) {
      this.warned = 10;
      return { line: `🪫 Battery at ${pct}% — please plug me in!`, tone: 'worried', action: 'none', ms: 10_000 };
    }
    if (pct <= 20 && this.warned === 0) {
      this.warned = 20;
      return { line: `🪫 Battery at ${pct}% — plug me in soon?`, tone: 'worried', action: 'none', ms: 8000 };
    }
    return undefined;
  }
}

/** Battery low enough to save power (calmer animations). */
export const isLowBattery = ({ level, charging }: BatteryReading) => !charging && level <= 0.2;
