import { shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AuthState, UserProfile } from '../../shared/types';
import { clearTokens, getOAuthConfig, loadTokens, saveTokens, type StoredTokens } from '../store';

/**
 * Google sign-in for installed apps: system browser + loopback redirect + PKCE.
 * https://developers.google.com/identity/protocols/oauth2/native-app
 */

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/gmail.compose',
];

/** What Lumi cannot work without. The Docs and Gmail-compose scopes are optional. */
const REQUIRED_SCOPES = ['calendar.events', 'gmail.readonly'];

/** The required scopes missing from a granted-scope string (Google lets people untick them on the consent screen). */
export function missingScopes(granted: string): string[] {
  return REQUIRED_SCOPES.filter((name) => !granted.includes(`/auth/${name}`));
}

/** True when the stored token was granted a scope (older sign-ins predate newer scopes). */
export function hasScope(name: 'documents' | 'gmail.compose'): boolean {
  return !!loadTokens()?.scope?.includes(`/auth/${name}`);
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

let profileCache: UserProfile | undefined;

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function getAuthState(): Promise<AuthState> {
  const configured = !!getOAuthConfig();
  const tokens = loadTokens();
  if (!configured || !tokens) return { configured, signedIn: false };
  try {
    return { configured, signedIn: true, profile: await getProfile() };
  } catch (e) {
    // Google refused the tokens (revoked, or expired refresh token): really signed out.
    if (e instanceof NotSignedInError) { dropSession(); return { configured, signedIn: false }; }
    // Anything else (no network yet right after the computer starts, Google unreachable) is temporary:
    // stay signed in and show the last known profile instead of asking for the login again.
    return { configured, signedIn: true, profile: tokens.profile ?? { name: '', email: '' } };
  }
}

/**
 * Forgets a session Google no longer accepts: the stored tokens and the cached profile. Without this the
 * cached profile keeps `getAuthState()` saying "signed in" while every request fails.
 */
export function dropSession() {
  clearTokens();
  profileCache = undefined;
}

let signInInFlight: Promise<AuthState> | undefined;

/** Signs in through the browser. Clicking again while a sign-in is open joins it instead of starting a second one. */
export function signIn(): Promise<AuthState> {
  signInInFlight ??= doSignIn().finally(() => { signInInFlight = undefined; });
  return signInInFlight;
}

async function doSignIn(): Promise<AuthState> {
  const config = getOAuthConfig();
  if (!config) throw new Error('Google OAuth client is not configured. See README → "Google Cloud setup".');

  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') { res.writeHead(404).end(); return; }
      const error = url.searchParams.get('error');
      const returnedState = url.searchParams.get('state');
      const authCode = url.searchParams.get('code');
      // Stray requests (a browser prefetch, a port scan) carry neither: ignore them and keep waiting for the real redirect.
      if (!error && !authCode) { res.writeHead(404).end(); return; }
      const ok = !error && returnedState === state && !!authCode;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage(ok));
      clearTimeout(timer);
      server.close();
      if (ok) resolve({ code: authCode!, redirectUri });
      else reject(new Error(error ? `Google sign-in failed: ${error}` : 'Google sign-in failed (state mismatch).'));
    });
    let redirectUri = '';
    const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out.')); }, SIGN_IN_TIMEOUT_MS);
    server.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start the sign-in listener: ${e.message}`)); });
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
      });
      shell.openExternal(`${AUTH_URL}?${params}`);
    });
  });

  const tokenRes = await postForm(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (typeof tokenRes.scope === 'string' && missingScopes(tokenRes.scope).length) {
    throw new Error('Lumi needs access to your Google Calendar and Gmail (read-only) to work. Sign in again and leave every box ticked.');
  }
  saveTokens(toStored(tokenRes));
  profileCache = undefined;
  return getAuthState();
}

export async function signOut(): Promise<AuthState> {
  const tokens = loadTokens();
  if (tokens) {
    const token = tokens.refresh_token ?? tokens.access_token;
    fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
  }
  clearTokens();
  profileCache = undefined;
  return { configured: !!getOAuthConfig(), signedIn: false };
}

/** Returns a valid access token, refreshing it when needed. */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new NotSignedInError();
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new NotSignedInError();
  const config = getOAuthConfig();
  if (!config) throw new NotSignedInError();
  const res = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const next = { ...toStored(res), refresh_token: res.refresh_token ?? tokens.refresh_token, profile: tokens.profile };
  saveTokens(next);
  return next.access_token;
}

/** fetch() against a Google API with the user's bearer token. */
export async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new NotSignedInError();
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function getProfile(): Promise<UserProfile> {
  if (profileCache) return profileCache;
  const info = await googleFetch<{ name?: string; email: string; picture?: string; given_name?: string }>(USERINFO_URL);
  profileCache = { name: info.given_name ?? info.name ?? info.email, email: info.email, picture: info.picture };
  const stored = loadTokens();
  if (stored) saveTokens({ ...stored, profile: profileCache });
  return profileCache;
}

export class NotSignedInError extends Error {
  constructor() { super('Not signed in to Google.'); }
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as any;
  if (json?.error === 'invalid_grant') throw new NotSignedInError();
  if (!res.ok) throw new Error(`Google token error: ${json.error_description ?? json.error ?? res.status}`);
  return json as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

function toStored(res: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }): StoredTokens {
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    expires_at: Date.now() + res.expires_in * 1000,
    scope: res.scope,
  };
}

function callbackPage(ok: boolean) {
  const title = ok ? 'You are connected! ✦' : 'Sign-in did not complete';
  const text = ok ? 'Lumi is ready. You can close this tab and head back to your desktop.' : 'Please close this tab and try again from Lumi.';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Lumi</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;color:#e8eeff;
background:radial-gradient(ellipse at 30% 20%,#3a2a7a 0%,transparent 50%),radial-gradient(ellipse at 70% 80%,#0d4a8a 0%,transparent 50%),#070b1f}
.card{text-align:center;padding:40px 48px;border-radius:24px;background:rgba(20,28,64,.6);border:1px solid rgba(140,170,255,.25)}
.star{font-size:56px;color:#5cb8ff;text-shadow:0 0 24px #4aa3ff}</style></head>
<body><div class="card"><div class="star">★</div><h1>${title}</h1><p>${text}</p></div></body></html>`;
}
