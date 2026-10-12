/**
 * The star's choreography. Given the position inside the current beat (phase 0..1) and the
 * number of beats so far, returns a pose. Moves change every four beats so it never gets stale.
 */

export type DanceMove = 'bounce' | 'sway' | 'hop' | 'twirl';

export const MOVES: DanceMove[] = ['bounce', 'sway', 'hop', 'twirl'];
export const BEATS_PER_MOVE = 4;

export interface DancePose {
  move: DanceMove;
  /** Pixels in the mascot's 200-unit drawing space. */
  x: number;
  y: number;
  /** Degrees. */
  rot: number;
  sx: number;
  sy: number;
  /** How far each arm is raised, in degrees (0 = down). */
  armL: number;
  armR: number;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const parabola = (phase: number) => 4 * phase * (1 - phase); // 0 → 1 → 0 across one beat
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function moveFor(count: number): DanceMove {
  return MOVES[Math.floor(mod(count, BEATS_PER_MOVE * MOVES.length) / BEATS_PER_MOVE)];
}

export function dancePose(phase: number, count: number): DancePose {
  const move = moveFor(count);
  const beatInMove = mod(count, BEATS_PER_MOVE);
  const hit = Math.exp(-phase * 9); // squash right on the beat

  switch (move) {
    case 'sway': {
      const wave = Math.sin(Math.PI * (mod(count, 2) + phase)); // one full swing every two beats
      return {
        move, x: wave * 7, y: -5 * parabola(phase), rot: wave * 9, sx: 1, sy: 1 - 0.03 * hit,
        armL: 45 * Math.max(0, wave), armR: 45 * Math.max(0, -wave),
      };
    }
    case 'hop': {
      const up = parabola(phase);
      return { move, x: 0, y: -22 * up, rot: 0, sx: 1 - 0.05 * up + 0.06 * hit, sy: 1 + 0.07 * up - 0.08 * hit, armL: 80 * up, armR: 80 * up };
    }
    case 'twirl': {
      if (beatInMove === BEATS_PER_MOVE - 1) {
        // The last beat of the move is a full spin with a little jump.
        return { move, x: 0, y: -16 * parabola(phase), rot: 360 * easeInOut(phase), sx: 1, sy: 1, armL: 70, armR: 70 };
      }
      return { move, x: 0, y: -8 * parabola(phase), rot: 0, sx: 1 + 0.05 * hit, sy: 1 - 0.07 * hit, armL: 30 * parabola(phase), armR: 30 * parabola(phase) };
    }
    default: {
      const down = parabola(phase);
      return { move, x: 0, y: -12 * down, rot: 0, sx: 1 + 0.06 * hit, sy: 1 - 0.08 * hit, armL: 55 * down, armR: 55 * down };
    }
  }
}
