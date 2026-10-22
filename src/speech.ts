import { calendarWindowMinutes } from '../shared/proactive';
import type { Briefing, CalendarEvent } from '../shared/types';
import { ACTION_LINE_GAP_MS, ACTION_LINES, type MascotAction } from './behavior';
import { fmtTime, greeting } from './format';

/** Everything that decides what her speech bubble says. */
export interface SpeechInput {
  now: Date;
  /** The next timed event that has not ended yet. */
  upcoming?: CalendarEvent;
  importantEmails: number;
  firstName?: string;
  /** "Calendar pop-ups only": no bubble unless an event is about to start (or a reminder). */
  calendarOnly: boolean;
  reminderLeadMinutes: number[];
  reminder?: string;
  /** The chat agent is working. */
  thinking: boolean;
  briefing?: Briefing;
  focusEndsAt?: number;
  dnd: boolean;
  notice?: string;
  reactionLine?: string;
  sleeping: boolean;
  dancing: boolean;
  bpm?: number;
  /** The line for the spontaneous action now playing, if it gets one (see ActionLineGate). */
  actionLine?: string;
}

/**
 * The lines her bubble shows, in order (the bubble rotates through them). An empty list means no
 * bubble. The first situation that applies wins: a reminder, then calendar-only mode, then the agent
 * thinking, the briefing, focus, quiet mode, a notice, a pet reaction, sleep, dance, an action line,
 * and finally the everyday lines (next event, important emails, a greeting).
 */
export function speechFor(s: SpeechInput): string[] {
  const minutesToNext = s.upcoming ? Math.round((+new Date(s.upcoming.start) - +s.now) / 60_000) : Infinity;
  if (s.reminder) return [s.reminder];
  if (s.calendarOnly) {
    const near = s.upcoming && minutesToNext >= 0 && minutesToNext <= calendarWindowMinutes(s.reminderLeadMinutes);
    return near ? [`“${s.upcoming!.title}” in ${minutesToNext} min ✦`] : [];
  }
  if (s.thinking) return ['Thinking among the stars…'];
  if (s.briefing) return [s.briefing.title, ...s.briefing.lines.slice(0, 5).map((l) => l.replace(/^•\s*/, ''))];
  if (s.focusEndsAt !== undefined) return [`Focus time — ${Math.max(1, Math.ceil((s.focusEndsAt - +s.now) / 60_000))} min left ✦`];
  if (s.dnd) return ['🔕 Quiet mode — I will stay out of your way'];
  if (s.notice) return [s.notice];
  if (s.reactionLine) return [s.reactionLine];
  if (s.sleeping) return ['Zzz… 💤'];
  if (s.dancing) return [`♪ ${s.bpm} BPM — I love this one!`, 'Dance with me! ✦'];
  if (s.actionLine) return [s.actionLine];

  const lines: string[] = [];
  if (s.upcoming && minutesToNext <= 60) lines.push(`“${s.upcoming.title}” ${minutesToNext <= 0 ? 'is happening now' : `in ${minutesToNext} min`} ✦`);
  else if (s.upcoming) lines.push(`Next up: ${s.upcoming.title} at ${fmtTime(s.upcoming.start)}`);
  if (s.importantEmails) lines.push(`${s.importantEmails} important email${s.importantEmails > 1 ? 's' : ''} waiting for you`);
  lines.push(`${greeting(s.now)}${s.firstName ? `, ${s.firstName}` : ''}!`);
  if (!s.upcoming) lines.push('Your sky is clear — no more events today 🌌');
  return lines;
}

/**
 * Spontaneous actions come every few seconds; only some get a line, at most one per `gapMs`, so the
 * bubble is not always changing. Call `lineFor` once per new action.
 */
export class ActionLineGate {
  private lastAt = -Infinity;
  constructor(private gapMs = ACTION_LINE_GAP_MS) {}

  lineFor(action: MascotAction, now: number): string | undefined {
    const line = ACTION_LINES[action];
    if (!line || now - this.lastAt < this.gapMs) return undefined;
    this.lastAt = now;
    return line;
  }
}
