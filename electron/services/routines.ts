import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { buildRoutine, capNews, isDue, MAX_ROUTINES, type NewsItem, type Routine, type RoutineInput } from '../../shared/routines';
import { runRoutine, SEEN_LIMIT, type RunnerDeps } from '../routines/runner';

/** Where routines, the addresses they have seen and the news are kept. */
export interface RoutineStorage {
  routines(): Routine[];
  saveRoutines(routines: Routine[]): void;
  seen(): Record<string, string[]>;
  saveSeen(seen: Record<string, string[]>): void;
  news(): NewsItem[];
  saveNews(news: NewsItem[]): void;
}

export const newsId = (url: string) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);

export interface RunOutcome { added: number; error?: string }

/**
 * Runs the routines when they are due (checked every minute, and a few seconds after start so a
 * daily one that was missed while the computer was off runs now), one after another.
 * Emits 'changed' when routines or news change and 'news' (items, routine) when a run adds articles.
 */
export class RoutineService extends EventEmitter {
  private timer?: NodeJS.Timeout;
  private firstTick?: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Set<string>();

  constructor(private deps: { storage: RoutineStorage; runner: Omit<RunnerDeps, 'makeId'>; now?: () => Date }) { super(); }

  private now = () => this.deps.now?.() ?? new Date();

  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.firstTick = setTimeout(() => void this.tick(), 15_000);
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.firstTick);
  }

  /** Runs every routine that is due. */
  async tick(): Promise<void> {
    const due = this.list().filter((r) => isDue(r, this.now()) && !this.running.has(r.id));
    await Promise.all(due.map((r) => this.run(r.id)));
  }

  list(): Routine[] { return this.deps.storage.routines(); }
  news(): NewsItem[] { return this.deps.storage.news(); }

  save(input: RoutineInput): Routine[] {
    const all = this.list();
    const existing = input.id ? all.find((r) => r.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('That routine no longer exists.');
    if (!existing && all.length >= MAX_ROUTINES) throw new Error(`You can have up to ${MAX_ROUTINES} routines.`);
    const routine = buildRoutine(input, existing, crypto.randomUUID(), this.now().getTime());
    const next = existing ? all.map((r) => (r.id === routine.id ? routine : r)) : [...all, routine];
    this.deps.storage.saveRoutines(next);
    this.emit('changed');
    // A new routine does its first run right away, so there is something to see.
    if (!existing && routine.enabled) void this.run(routine.id);
    return next;
  }

  remove(id: string): Routine[] {
    const next = this.list().filter((r) => r.id !== id);
    this.deps.storage.saveRoutines(next);
    const { [id]: _gone, ...seen } = this.deps.storage.seen();
    this.deps.storage.saveSeen(seen);
    this.emit('changed');
    return next;
  }

  /** Runs one routine now (after any run already going). */
  run(id: string): Promise<RunOutcome> {
    if (this.running.has(id)) return Promise.resolve({ added: 0 });
    this.running.add(id);
    const p = this.queue.then(() => this.execute(id)).finally(() => this.running.delete(id));
    this.queue = p.catch(() => undefined);
    return p;
  }

  private update(id: string, patch: Partial<Routine>) {
    const all = this.list();
    if (!all.some((r) => r.id === id)) return; // deleted while it ran
    this.deps.storage.saveRoutines(all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  private async execute(id: string): Promise<RunOutcome> {
    const routine = this.list().find((r) => r.id === id);
    if (!routine) return { added: 0, error: 'That routine no longer exists.' };
    const at = this.now().getTime();
    try {
      const storage = this.deps.storage;
      const seenBefore = storage.seen()[id] ?? [];
      const result = await runRoutine(routine, new Set(seenBefore), { ...this.deps.runner, makeId: newsId, now: () => at });
      const news = storage.news();
      const known = new Set(news.map((n) => n.id));
      const items = result.items.filter((i) => !known.has(i.id));
      if (items.length) storage.saveNews(capNews([...items, ...news]));
      storage.saveSeen({ ...storage.seen(), [id]: [...new Set([...result.seen, ...seenBefore])].slice(0, SEEN_LIMIT) });
      this.update(id, { lastRunAt: at, lastAttemptAt: at, lastError: undefined, lastAdded: items.length });
      this.emit('changed');
      if (items.length) this.emit('news', items, routine);
      return { added: items.length };
    } catch (e) {
      const error = ((e as Error).message || 'Something went wrong').slice(0, 200);
      this.update(id, { lastAttemptAt: at, lastError: error });
      this.emit('changed');
      return { added: 0, error };
    }
  }

  markRead(id?: string) {
    const news = this.news();
    if (!news.some((n) => !n.read && (!id || n.id === id))) return;
    this.deps.storage.saveNews(news.map((n) => (!id || n.id === id ? { ...n, read: true } : n)));
    this.emit('changed');
  }

  dismiss(id: string) {
    this.deps.storage.saveNews(this.news().filter((n) => n.id !== id));
    this.emit('changed');
  }

  /** Removes everything already read. */
  clearRead() {
    this.deps.storage.saveNews(this.news().filter((n) => !n.read));
    this.emit('changed');
  }
}
