import { EventEmitter } from 'node:events';
import type { DataSnapshot, ReminderPayload, ScoredEmail } from '../../shared/types';
import { aiTriageEmails } from '../agent/agent';
import { getProfile, NotSignedInError } from '../google/auth';
import { listUpcomingEvents } from '../google/calendar';
import { listRecentInbox } from '../google/gmail';
import { getSettings } from '../store';
import { rankEmails, scoreEmail } from './emailScoring';
import { ReminderScheduler } from './reminders';

const CALENDAR_EVERY_MS = 5 * 60_000;
const GMAIL_EVERY_MS = 10 * 60_000;
const REMINDER_TICK_MS = 20_000;

/**
 * Keeps a cached snapshot of calendar + email data, refreshes it periodically
 * and emits 'updated' and 'reminder' events.
 */
export class SyncService extends EventEmitter {
  private snapshot: DataSnapshot = { events: [], emails: [] };
  private timers: NodeJS.Timeout[] = [];
  private scheduler = new ReminderScheduler(getSettings().reminderLeadMinutes);
  private aiCache = new Map<string, { score: number; reason?: string }>();

  get data() { return this.snapshot; }

  start() {
    this.stop();
    void this.refreshAll();
    this.timers.push(
      setInterval(() => void this.refreshEvents(), CALENDAR_EVERY_MS),
      setInterval(() => void this.refreshEmails(), GMAIL_EVERY_MS),
      setInterval(() => this.checkReminders(), REMINDER_TICK_MS),
    );
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  reset() {
    this.stop();
    this.snapshot = { events: [], emails: [] };
    this.aiCache.clear();
    this.emit('updated', this.snapshot);
  }

  setReminderLeads(leads: number[]) { this.scheduler.setLeads(leads); }

  async refreshAll(): Promise<DataSnapshot> {
    await Promise.all([this.refreshEvents(false), this.refreshEmails(false)]);
    this.emit('updated', this.snapshot);
    this.checkReminders();
    return this.snapshot;
  }

  async refreshEvents(emit = true) {
    try {
      const events = await listUpcomingEvents(7);
      this.snapshot = { ...this.snapshot, events, lastSync: new Date().toISOString(), error: undefined };
    } catch (e) {
      this.handleError(e);
    }
    if (emit) { this.emit('updated', this.snapshot); this.checkReminders(); }
  }

  async refreshEmails(emit = true) {
    try {
      const settings = getSettings();
      const profile = await getProfile();
      const raw = await listRecentInbox(settings.emailLookbackDays);
      const scored = raw.map((e) => scoreEmail(e, profile.email));
      this.snapshot = { ...this.snapshot, emails: rankEmails(scored, this.aiScoresFor(scored)), lastSync: new Date().toISOString() };
      if (emit) this.emit('updated', this.snapshot);
      if (settings.aiEmailTriage) void this.runAiTriage(scored);
    } catch (e) {
      this.handleError(e);
      if (emit) this.emit('updated', this.snapshot);
    }
  }

  /** Runs the local model over emails it has not rated yet, then re-ranks. */
  private async runAiTriage(scored: ScoredEmail[]) {
    const todo = scored.filter((e) => !this.aiCache.has(e.id)).sort((a, b) => b.score - a.score);
    if (!todo.length) return;
    const ai = await aiTriageEmails(todo, getSettings());
    if (!Object.keys(ai).length) return;
    for (const [id, v] of Object.entries(ai)) this.aiCache.set(id, v);
    this.snapshot = { ...this.snapshot, emails: rankEmails(scored, this.aiScoresFor(scored)) };
    this.emit('updated', this.snapshot);
  }

  private aiScoresFor(emails: ScoredEmail[]) {
    const out: Record<string, { score: number; reason?: string }> = {};
    for (const e of emails) { const v = this.aiCache.get(e.id); if (v) out[e.id] = v; }
    return out;
  }

  private checkReminders() {
    for (const r of this.scheduler.due(this.snapshot.events)) this.emit('reminder', r as ReminderPayload);
  }

  private handleError(e: unknown) {
    if (e instanceof NotSignedInError) { this.emit('signed-out'); return; }
    this.snapshot = { ...this.snapshot, error: (e as Error).message };
    console.error('[sync]', e);
  }
}
