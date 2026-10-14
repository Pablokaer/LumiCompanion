import { describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  events: undefined as undefined | ((e: unknown[]) => void),
  inbox: undefined as undefined | ((m: unknown[]) => void),
}));

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));
vi.mock('../electron/google/calendar', () => ({ listUpcomingEvents: () => new Promise((r) => { gate.events = r; }) }));
vi.mock('../electron/google/gmail', () => ({ listRecentInbox: () => new Promise((r) => { gate.inbox = r; }) }));
vi.mock('../electron/google/auth', () => ({
  getProfile: async () => ({ name: 'Ana', email: 'ana@example.com' }),
  NotSignedInError: class NotSignedInError extends Error {},
}));
vi.mock('../electron/store', () => ({ getSettings: () => ({ reminderLeadMinutes: [15, 5], emailLookbackDays: 2, aiEmailTriage: false }) }));
vi.mock('../electron/agent/agent', () => ({ aiTriageEmails: async () => ({}) }));

import { SyncService } from '../electron/services/sync';

const event = { id: 'old', title: 'Old account meeting', start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString(), allDay: false };
const email = { id: 'm1', threadId: 't1', from: 'Boss', fromEmail: 'boss@example.com', to: 'ana@example.com', subject: 'Old account email', snippet: '', date: new Date().toISOString(), labelIds: ['INBOX'], hasListUnsubscribe: false };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('signing out while a refresh is still on its way', () => {
  it('does not bring the old account’s calendar back', async () => {
    const sync = new SyncService();
    const pending = sync.refreshEvents();
    await tick();
    sync.reset(); // sign-out
    const updates: unknown[] = [];
    sync.on('updated', (s) => updates.push(s));
    gate.events!([event]); // the old answer finally arrives
    await pending;
    expect(sync.data.events).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('does not bring the old account’s email back', async () => {
    const sync = new SyncService();
    const pending = sync.refreshEmails();
    await tick();
    sync.reset();
    const updates: unknown[] = [];
    sync.on('updated', (s) => updates.push(s));
    gate.inbox!([email]);
    await pending;
    expect(sync.data.emails).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('does not announce a full refresh that finished after the reset', async () => {
    const sync = new SyncService();
    const pending = sync.refreshAll();
    await tick();
    sync.reset();
    const updates: unknown[] = [];
    sync.on('updated', (s) => updates.push(s));
    gate.events!([event]);
    gate.inbox!([email]);
    await pending;
    expect(sync.data).toEqual({ events: [], emails: [] });
    expect(updates).toEqual([]);
  });

  it('still keeps the data of a refresh that was not interrupted', async () => {
    const sync = new SyncService();
    const pending = sync.refreshEvents();
    await tick();
    gate.events!([event]);
    await pending;
    expect(sync.data.events).toHaveLength(1);
  });
});
