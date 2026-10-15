import type { MascotAction } from './behavior';
import type { Reaction } from './interaction';
import type { NoticeTone } from '../shared/notices';

export type Mood = 'idle' | 'happy' | 'alert' | 'thinking' | 'sleepy';

/** What the eyes and the mouth show. They are chosen separately so she can grin with her eyes open. */
export type Mouth = Mood | 'laugh' | 'shy' | 'purr' | 'chomp';

export interface Face {
  eyes: Mood;
  mouth: Mouth;
  /** Fierce little eyebrows (while she is about to bite). */
  brows?: boolean;
}

/** Actions where she is cheerful: eyes stay open, the mouth is a big smile. */
export const GRIN_ACTIONS: MascotAction[] = ['smile', 'hop', 'wave', 'spin', 'wiggle', 'twinkle', 'hum'];

/**
 * The expression for the current situation. Her eyes are open by default; the closed "^ ^" eyes are
 * only for a moment of delight (cheering) or a yawn, and the closed sleepy eyes only when she is
 * actually asleep.
 */
export function faceFor(opts: { mood: Mood; sleeping: boolean; dancing: boolean; action: MascotAction; reaction?: Reaction; tone?: NoticeTone }): Face {
  const { mood, sleeping, dancing, action, reaction = 'none', tone } = opts;
  if (sleeping) return { eyes: 'sleepy', mouth: 'sleepy' };
  if (mood === 'alert' || mood === 'thinking' || mood === 'sleepy') return { eyes: mood, mouth: mood };
  // reactions to being petted, teased or stared at
  if (reaction === 'giggle') return { eyes: 'happy', mouth: 'laugh' };
  if (reaction === 'purr') return { eyes: 'happy', mouth: 'purr' };
  if (reaction === 'bite') return { eyes: 'idle', mouth: 'chomp', brows: true };
  // how she feels about something she just told you (low battery, no internet, a tip…)
  if (tone === 'worried') return { eyes: 'idle', mouth: 'shy' };
  if (tone === 'happy') return { eyes: 'idle', mouth: 'happy' };
  if (action === 'cheer') return { eyes: 'happy', mouth: 'happy' };
  if (mood === 'happy' || dancing || GRIN_ACTIONS.includes(action)) return { eyes: 'idle', mouth: 'happy' };
  return { eyes: 'idle', mouth: 'idle' };
}

/**
 * Her overall mood. There is deliberately no "sleepy because it is late": she falls asleep when the
 * computer is idle (see mascotLife), and otherwise she is awake with her eyes open, day or night.
 */
export function moodFor(opts: { reminder: boolean; busy: boolean; recentlyHappy: boolean }): Mood {
  if (opts.reminder) return 'alert';
  if (opts.busy) return 'thinking';
  if (opts.recentlyHappy) return 'happy';
  return 'idle';
}
