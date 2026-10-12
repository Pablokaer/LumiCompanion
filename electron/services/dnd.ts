import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { computeDnd, isBusyNotificationState, meetingNow, type DndState } from '../../shared/dnd';
import type { CalendarEvent, Settings } from '../../shared/types';

/**
 * Windows reports whether a full-screen app, a presentation or Focus Assist is on through
 * SHQueryUserNotificationState. A single long-lived PowerShell process polls it every few seconds and
 * prints the value only when it changes, which is far cheaper than starting PowerShell for every check.
 */
export const PROBE_SCRIPT = `
Add-Type -Namespace Lumi -Name Q -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
$last = -1
while ($true) {
  $s = 0
  [void][Lumi.Q]::SHQueryUserNotificationState([ref]$s)
  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  Start-Sleep -Seconds 3
}
`;

export class FullscreenProbe extends EventEmitter {
  /** True while a full-screen app, presentation or Focus Assist is active. */
  busy = false;
  private child?: ChildProcess;
  private buffer = '';
  private restarts = 0;
  private stopped = true;

  start() {
    if (process.platform !== 'win32' || this.child) return;
    this.stopped = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROBE_SCRIPT], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (/^\d+$/.test(line)) this.set(isBusyNotificationState(Number(line)));
      }
    });
    child.once('exit', () => {
      this.child = undefined;
      this.set(false);
      // If it dies on its own (not because we stopped it), try again a few times.
      if (!this.stopped && this.restarts++ < 3) setTimeout(() => this.start(), 30_000);
    });
    child.once('error', () => { this.child = undefined; });
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
    this.child = undefined;
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
