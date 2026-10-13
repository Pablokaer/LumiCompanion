/**
 * How many frames per second the mascot's animation loop needs right now. Pure logic, unit tested; the
 * loop in Mascot.tsx feeds it the current state and a `FrameGate` turns the answer into "draw this frame or skip it".
 *
 * Motion never depends on the frame rate: the loop measures the real time between the frames it draws
 * (`dt`) and poses everything from absolute time, so drawing less often only makes it coarser, never slower.
 */

import type { BaseMotion } from './motion';

export type Fps = 0 | 15 | 30 | 60;

/**
 * The background movements slow enough to look continuous at 30 fps: the float moves a few tenths of a pixel
 * per frame. Bouncing and shaking sweep several pixels (or degrees) per frame, so they keep every frame.
 */
const SLOW_MOTIONS: readonly BaseMotion[] = ['float', 'slowFloat', 'thinkFloat', 'breathe'];
export const isSlowMotion = (m: BaseMotion): boolean => SLOW_MOTIONS.includes(m);

export interface FrameRateState {
  /** The window is hidden, minimised, covered, or the screen is locked: nothing can be seen. */
  hidden: boolean;
  sleeping: boolean;
  /** The background movement is one of the slow ones (see `isSlowMotion`). */
  slowMotion: boolean;
  dancing: boolean;
  /** A reaction to the mouse (giggle, shy, purr, bite) is playing. */
  reacting: boolean;
  /** An action (wave, spin, hum, stretch, yawn…) is playing. */
  acting: boolean;
  /** The blend between states is still gliding. */
  easing: boolean;
  /** The "eyes follow the mouse" setting is on and the cursor moved within the last couple of seconds. */
  followingCursor: boolean;
  /** A blink or a glance is in progress: the eyes move fast and need every frame. */
  eyesBusy: boolean;
  /** The full panel is open. */
  expanded: boolean;
}

/** How long after the cursor last moved the eyes still count as following it. */
export const CURSOR_ACTIVE_MS = 2000;

/** 0 means "draw nothing at all" (paused). Anything lively gets 60; a quietly floating star gets 30; a sleeping one 15. */
export function targetFps(s: FrameRateState): Fps {
  if (s.hidden) return 0;
  if (s.dancing || s.reacting || s.acting || s.easing || s.followingCursor || s.expanded) return 60;
  if (s.sleeping) return 15; // her eyes are shut, so a blink or glance cannot be happening
  if (s.eyesBusy || !s.slowMotion) return 60;
  return 30;
}

/** Slack so a frame that arrives a hair early (timer jitter) is not skipped, which would halve the rate. */
const SLACK_MS = 2;

/**
 * Decides, from the timestamps `requestAnimationFrame` hands out, which display frames to draw. On a 120 Hz
 * screen a 60 fps target draws every second frame; on a 60 Hz screen a 30 fps target draws every second one.
 */
export class FrameGate {
  private nextDue = 0;
  private fps: Fps = 60;

  /** Forget the schedule, e.g. when resuming after a pause: the next frame is drawn straight away. */
  reset(now = 0): void {
    this.nextDue = now;
  }

  /** True when the frame at `now` should be drawn at the given rate. */
  shouldDraw(now: number, fps: Fps): boolean {
    if (fps === 0) return false;
    if (fps !== this.fps) { this.fps = fps; this.nextDue = now; } // a change of rate starts a new schedule
    if (now < this.nextDue - SLACK_MS) return false;
    const interval = 1000 / fps;
    this.nextDue += interval;
    if (this.nextDue < now) this.nextDue = now + interval; // fell behind (long frame): do not try to catch up
    return true;
  }
}

/** True once the weights of the blend have settled on the target layer. */
export function weightsSettled(weights: Record<string, number>, target: string, epsilon = 0.003): boolean {
  for (const k in weights) {
    if (Math.abs(weights[k] - (k === target ? 1 : 0)) > epsilon) return false;
  }
  return true;
}
