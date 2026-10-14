/**
 * Routines: little daily jobs the companion does by itself. Each one finds new articles (a news search,
 * an article search, or a website to watch) and puts them in the News tab.
 */

/** news: a news search. articles: developer articles (Hacker News). site: a website or feed to watch for new posts. */
export type RoutineKind = 'news' | 'articles' | 'site';
export type RoutineFrequency = 'hourly' | 'every6h' | 'daily';
export type RoutineLanguage = 'en' | 'pt';

export interface Routine {
  id: string;
  name: string;
  kind: RoutineKind;
  /** news / articles: what to search for. site: the address of the page or feed. */
  target: string;
  /** Language of the news search and of the summaries. */
  language: RoutineLanguage;
  frequency: RoutineFrequency;
  /** Local "HH:mm" for daily routines. */
  time: string;
  /** The most items added per run (1-10). */
  maxItems: number;
  /** Let the local AI pick the best items and write a one-line summary (searches only). */
  useAi: boolean;
  enabled: boolean;
  createdAt: number;
  /** When it last ran successfully, epoch ms. */
  lastRunAt?: number;
  /** When it last tried, even if that failed, epoch ms. */
  lastAttemptAt?: number;
  lastError?: string;
  /** How many items the last successful run added. */
  lastAdded?: number;
}

/** What the editor sends: everything the user can change. */
export type RoutineInput = Partial<Pick<Routine, 'id' | 'name' | 'kind' | 'target' | 'language' | 'frequency' | 'time' | 'maxItems' | 'useAi' | 'enabled'>>;

export interface NewsItem {
  id: string;
  routineId: string;
  routineName: string;
  title: string;
  url: string;
  /** The site or publisher. */
  source?: string;
  summary?: string;
  /** When the article was published, epoch ms, when known. */
  publishedAt?: number;
  addedAt: number;
  read: boolean;
}

export interface RoutinePreset {
  name: string;
  kind: RoutineKind;
  target: string;
  language?: RoutineLanguage;
}

export const ROUTINE_PRESETS: RoutinePreset[] = [
  { name: 'AI & LLM news', kind: 'news', target: 'artificial intelligence OR LLM OR OpenAI OR Anthropic' },
  { name: 'Technology news', kind: 'news', target: 'technology' },
  { name: 'Big tech companies', kind: 'news', target: 'Apple OR Google OR Microsoft OR Meta OR Amazon OR Nvidia' },
  { name: 'Programming articles', kind: 'articles', target: 'programming' },
  { name: 'AI articles', kind: 'articles', target: 'LLM OR "machine learning"' },
];

export const FREQUENCY_LABEL: Record<RoutineFrequency, string> = { hourly: 'Every hour', every6h: 'Every 6 hours', daily: 'Every day' };
const FREQUENCY_MS: Record<Exclude<RoutineFrequency, 'daily'>, number> = { hourly: 3_600_000, every6h: 6 * 3_600_000 };

/** After a failed run, wait this long before trying again. */
export const RETRY_AFTER_MS = 10 * 60_000;
export const MAX_ROUTINES = 30;

const KINDS: RoutineKind[] = ['news', 'articles', 'site'];
const FREQUENCIES: RoutineFrequency[] = ['hourly', 'every6h', 'daily'];

/** Whether a routine should run now. A daily one runs once per day, after its time (also late, if the computer was off). */
export function isDue(r: Routine, now = new Date()): boolean {
  if (!r.enabled) return false;
  const t = now.getTime();
  if (r.lastAttemptAt && r.lastAttemptAt > (r.lastRunAt ?? 0) && t - r.lastAttemptAt < RETRY_AFTER_MS) return false; // failed a moment ago
  if (!r.lastRunAt) return true;
  if (r.frequency !== 'daily') return t - r.lastRunAt >= FREQUENCY_MS[r.frequency];
  const [h, m] = (/^\d{2}:\d{2}$/.test(r.time) ? r.time : '08:00').split(':').map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(h, m, 0, 0);
  return t >= scheduled.getTime() && r.lastRunAt < scheduled.getTime();
}

/** Makes a web address from what was typed ("akitaonrails.com" works); undefined when it is not a usable http(s) address. */
export function normalizeUrl(text: string): string | undefined {
  const raw = text.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Checks what the editor sent and fills in the rest. Throws an Error with a message fit to show. */
export function buildRoutine(input: RoutineInput, existing?: Routine, id = '', now = Date.now()): Routine {
  const name = (input.name ?? existing?.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Give the routine a name.');
  const kind = input.kind ?? existing?.kind ?? 'news';
  if (!KINDS.includes(kind)) throw new Error('Unknown routine type.');
  const rawTarget = (input.target ?? existing?.target ?? '').trim().slice(0, 300);
  let target = rawTarget;
  if (kind === 'site') {
    const url = normalizeUrl(rawTarget);
    if (!url) throw new Error('Enter the website address, for example https://akitaonrails.com/');
    target = url;
  } else if (!rawTarget) {
    throw new Error('Say what to search for.');
  }
  const frequency = input.frequency ?? existing?.frequency ?? 'daily';
  if (!FREQUENCIES.includes(frequency)) throw new Error('Unknown frequency.');
  const time = input.time ?? existing?.time ?? '08:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter the time as HH:mm.');
  const maxItems = Math.min(10, Math.max(1, Math.round(Number(input.maxItems ?? existing?.maxItems ?? 5)) || 5));
  return {
    id: existing?.id ?? id,
    name,
    kind,
    target,
    language: (input.language ?? existing?.language) === 'pt' ? 'pt' : 'en',
    frequency,
    time,
    maxItems,
    useAi: kind === 'site' ? false : (input.useAi ?? existing?.useAi ?? true),
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    // Changing what it looks at starts it over.
    ...(existing && existing.kind === kind && existing.target === target
      ? { lastRunAt: existing.lastRunAt, lastAttemptAt: existing.lastAttemptAt, lastError: existing.lastError, lastAdded: existing.lastAdded }
      : {}),
  };
}

/** Keeps the news list to a sensible size: newest first, at most `max`. */
export function capNews(items: NewsItem[], max = 300): NewsItem[] {
  return [...items].sort((a, b) => b.addedAt - a.addedAt).slice(0, max);
}
