import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tokens: undefined as undefined | Record<string, unknown>, cleared: 0 }));

vi.mock('electron', () => ({ shell: {}, app: {}, safeStorage: {} }));
vi.mock('../electron/store', () => ({
  getOAuthConfig: () => ({ clientId: 'id', clientSecret: 'secret' }),
  loadTokens: () => state.tokens,
  saveTokens: (t: Record<string, unknown>) => { state.tokens = t; },
  clearTokens: () => { state.tokens = undefined; state.cleared++; },
}));

import { dropSession, getAuthState, missingScopes } from '../electron/google/auth';

afterEach(() => { vi.unstubAllGlobals(); dropSession(); state.cleared = 0; });

const CAL = 'https://www.googleapis.com/auth/calendar.events';
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';

describe('granted scopes', () => {
  it('lists what Lumi cannot work without when a box was unticked', () => {
    expect(missingScopes(`openid email ${CAL} ${GMAIL}`)).toEqual([]);
    expect(missingScopes(`openid ${CAL}`)).toEqual(['gmail.readonly']);
    expect(missingScopes('openid email')).toEqual(['calendar.events', 'gmail.readonly']);
  });
  it('does not require the optional Docs and Gmail-compose scopes', () => {
    expect(missingScopes(`${CAL} ${GMAIL}`)).toEqual([]);
  });
});

describe('a session Google no longer accepts', () => {
  const valid = () => ({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3_600_000 });

  it('is forgotten completely, so the login screen comes back instead of an empty signed-in app', async () => {
    state.tokens = valid();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ email: 'ana@example.com', given_name: 'Ana' }))));
    // The profile is now cached: on its own it keeps saying "signed in" even after the tokens stop working.
    expect(await getAuthState()).toMatchObject({ signedIn: true, profile: { name: 'Ana' } });
    expect(await getAuthState()).toMatchObject({ signedIn: true });

    dropSession(); // what the app does when the sync reports that Google refused the tokens
    expect(state.tokens).toBeUndefined();
    expect(await getAuthState()).toMatchObject({ configured: true, signedIn: false });
  });

  it('clears the stored tokens when Google rejects them', async () => {
    state.tokens = { access_token: 'old', expires_at: 0 }; // expired and no refresh token
    expect(await getAuthState()).toMatchObject({ signedIn: false });
    expect(state.tokens).toBeUndefined();
    expect(state.cleared).toBeGreaterThan(0);
  });

  it('stays signed in when it is only offline', async () => {
    state.tokens = { ...valid(), profile: { name: 'Ana', email: 'ana@example.com' } };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
    expect(await getAuthState()).toMatchObject({ signedIn: true, profile: { name: 'Ana' } });
    expect(state.tokens).toBeDefined();
  });
});
