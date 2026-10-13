import { EventEmitter } from 'node:events';
import { computeDnd, isBusyNotificationState, meetingNow, type DndState } from '../../shared/dnd';
import type { CalendarEvent, Settings } from '../../shared/types';

/**
 * Windows reports whether a full-screen app, a presentation or Focus Assist is on through
 * SHQueryUserNotificationState. It is called in-process (koffi) every few seconds: no helper process,
 * so nothing ever flashes a console window.
 */
export function queryNotificationState(): number | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const fn = (queryNotificationState as any).fn ??= koffi.load('shell32.dll').func('int __stdcall SHQueryUserNotificationState(_Out_ int *state)');
    const out = [0];
    return fn(out) === 0 ? out[0] : undefined;
  } catch {
    return undefined;
  }
}

export class FullscreenProbe extends EventEmitter {
  /** True while a full-screen app, presentation or Focus Assist is active. */
  busy = false;
  private timer?: NodeJS.Timeout;

  start() {
    if (process.platform !== 'win32' || this.timer) return;
    const poll = () => {
      const state = queryNotificationState();
      if (state !== undefined) this.set(isBusyNotificationState(state));
    };
    poll();
    this.timer = setInterval(poll, 3000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.set(false);
  }

  private set(busy: boolean) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.emit('change', busy);
  }
}

export interface DndDeps {
  getSettings(): Settings;
  getEvents(): CalendarEvent[];
  /** Saves the manual pause time (epoch ms), or clears it. */
  saveManual(untilMs: number | undefined): void;
}

/** Combines the manual pause, the full-screen probe and the calendar into one "should I stay quiet?" state. */
export class DndService extends EventEmitter {
  state: DndState = { active: false };
  readonly probe = new FullscreenProbe();
  private timer?: NodeJS.Timeout;

  constructor(private deps: DndDeps) { super(); }

  start() {
    this.probe.on('change', () => this.evaluate());
    if (this.deps.getSettings().dndFullscreen) this.probe.start();
    this.timer = setInterval(() => this.evaluate(), 10_000);
    this.evaluate();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.probe.stop();
  }

  /** Call after the settings change (the full-screen setting starts or stops the probe). */
  applySettings() {
    if (this.deps.getSettings().dndFullscreen) this.probe.start(); else this.probe.stop();
    this.evaluate();
  }

  setManual(untilMs: number | null) {
    this.deps.saveManual(untilMs ?? undefined);
    this.evaluate();
  }

  evaluate(now = Date.now()) {
    const settings = this.deps.getSettings();
    const next = computeDnd({
      now,
      manualUntil: settings.dndUntil,
      fullscreen: this.probe.busy,
      meeting: meetingNow(this.deps.getEvents(), now),
      settings,
    });
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    const was = this.state;
    this.state = next;
    this.emit('state', next, was);
  }
}
