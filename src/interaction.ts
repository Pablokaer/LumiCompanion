/**
 * How the star reacts when the mouse passes over her. A small state machine, pure and driven by time
 * and pointer events so it can be unit tested with a seeded random generator.
 *
 * - Passing over her makes her giggle. More passes in a short time escalate; rapid teasing makes her
 *   try to bite the cursor.
 * - Moving slowly over her (petting) makes her purr until you stop or leave.
 */

export type Reaction = 'none' | 'giggle' | 'purr' | 'bite';
type Active = Exclude<Reaction, 'none'>;

/** How long each timed reaction lasts. Purring lasts as long as the petting does. */
export const REACTION_MS: Record<Exclude<Reaction, 'none' | 'purr'>, number> = { giggle: 1600, bite: 1650 }; // a bite is three snaps of 0.55 s each

export const REACTION_LINES: Record<Exclude<Reaction, 'none'>, string[]> = {
  giggle: ['Hehehe! 😄', 'Haha, that tickles!', 'Hihi! Stop it!'],
  purr: ['Mmm… ♥', 'Purrrr…', 'Don\'t stop… ♥'],
  bite: ['Nom nom nom!', 'Gotcha! *chomp*', 'I\'m gonna bite that!'],
};

/** Passes older than this no longer count toward "you keep teasing me". */
export const MEMORY_MS = 14_000;
/** Slow movement over her for this long counts as petting. */
export const PET_AFTER_MS = 1100;
/** The mouse must be this gentle (pixels per second) to count as petting; faster is just swiping. */
export const PET_MIN_SPEED = 8;
export const PET_MAX_SPEED = 220;
const SWIPE_SPEED = 450;
/** A short pause after a reaction so a jittery edge cannot retrigger her immediately. */
const COOLDOWN_MS = 500;
const PURR_LINGER_MS = 700;
const MAX_PURR_MS = 15_000;

export class InteractionController {
  reaction: Reaction = 'none';
  line = '';
  /** Increases every time a reaction starts, so the UI can restart animations. */
  key = 0;
  startedAt = 0;

  private hovering = false;
  private enters: number[] = [];
  private last: Reaction | undefined;
  private lastEnd = -Infinity;
  private leftAt = 0;
  private slowMs = 0;
  private speed = 0;
  private lastMove?: { x: number; y: number; t: number };

  constructor(private rand: () => number = Math.random) {}

  /** True while something needs `tick()`: a reaction is playing. */
  get needsTick(): boolean {
    return this.reaction !== 'none';
  }

  /** The pointer came onto her. Returns true when her reaction changed. */
  enter(now: number): boolean {
    this.hovering = true;
    const recent = this.enters.filter((t) => now - t < MEMORY_MS);
    this.enters = [...recent, now];
    this.slowMs = 0;
    this.speed = 0;
    this.lastMove = undefined;
    if (this.reaction !== 'none' || now - this.lastEnd < COOLDOWN_MS) return false;
    return this.start(this.pickForPass(this.enters.length), now);
  }

  leave(now: number): boolean {
    this.hovering = false;
    this.leftAt = now;
    this.slowMs = 0;
    return false; // purring winds down in tick()
  }

  /** The pointer moved while over her. */
  move(now: number, x: number, y: number): boolean {
    if (!this.hovering) return false;
    const prev = this.lastMove;
    this.lastMove = { x, y, t: now };
    if (!prev || now <= prev.t) return false;
    const dt = now - prev.t;
    const v = (Math.hypot(x - prev.x, y - prev.y) / dt) * 1000;
    this.speed = this.speed * 0.6 + v * 0.4;

    if (this.speed > SWIPE_SPEED) this.slowMs = 0;
    else if (this.speed >= PET_MIN_SPEED && this.speed <= PET_MAX_SPEED) this.slowMs += dt;

    if (this.reaction === 'none' && now - this.lastEnd >= COOLDOWN_MS && this.slowMs >= PET_AFTER_MS) return this.start('purr', now);
    return false;
  }

  /** Call regularly (about every 100 ms). Returns true when her reaction changed. */
  tick(now: number): boolean {
    if (this.reaction === 'none') return false;

    if (this.reaction === 'purr') {
      const tooLong = now - this.startedAt > MAX_PURR_MS;
      const stopped = !this.hovering && now - this.leftAt > PURR_LINGER_MS;
      if (tooLong || stopped) return this.finish(now);
      return false;
    }

    if (now - this.startedAt >= REACTION_MS[this.reaction as keyof typeof REACTION_MS]) return this.finish(now);
    return false;
  }

  /** Stops whatever she is doing (for example when she falls asleep). */
  reset(): boolean {
    const changed = this.reaction !== 'none';
    this.reaction = 'none';
    this.line = '';
    this.slowMs = 0;
    return changed;
  }

  // ---- internals ----

  private pickForPass(count: number): Active {
    const last = this.last;
    const choose = (weights: [Active, number][]): Active => {
      const pool = weights.filter(([r, w]) => w > 0 && r !== last);
      const usable = pool.length ? pool : weights.filter(([, w]) => w > 0);
      const total = usable.reduce((n, [, w]) => n + w, 0);
      let r = this.rand() * total;
      for (const [reaction, w] of usable) { r -= w; if (r < 0) return reaction; }
      return usable[usable.length - 1][0];
    };
    if (count <= 3) return 'giggle';
    return choose([['bite', 0.6], ['giggle', 0.4]]);
  }

  private start(reaction: Active, now: number): boolean {
    this.reaction = reaction;
    this.startedAt = now;
    this.key++;
    const lines = REACTION_LINES[reaction];
    this.line = lines[Math.min(lines.length - 1, Math.floor(this.rand() * lines.length))];
    this.last = reaction;
    this.slowMs = 0;
    return true;
  }

  private finish(now: number): boolean {
    this.reaction = 'none';
    this.line = '';
    this.lastEnd = now;
    return true;
  }
}
