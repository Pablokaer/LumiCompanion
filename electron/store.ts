import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  mascotName: 'Lumi',
  widgetMode: 'desktop',
  widgetView: 'mascot',
  launchAtLogin: true,
  reminderLeadMinutes: [15, 5],
  systemNotifications: true,
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  aiEmailTriage: true,
  emailLookbackDays: 2,
};

const userFile = (name: string) => path.join(app.getPath('userData'), name);

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- Settings ----------

let settingsCache: Settings | undefined;

export function getSettings(): Settings {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS, ...(readJson<Partial<Settings>>(userFile('settings.json')) ?? {}) };
  }
  return settingsCache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  next.reminderLeadMinutes = [...new Set(next.reminderLeadMinutes.filter((n) => Number.isFinite(n) && n >= 0))]
    .sort((a, b) => b - a);
  next.emailLookbackDays = Math.min(14, Math.max(1, Math.round(next.emailLookbackDays || 2)));
  settingsCache = next;
  writeJson(userFile('settings.json'), next);
  return next;
}

// ---------- Window position ----------

export interface SavedPosition { x: number; y: number }
export const getSavedPosition = () => readJson<SavedPosition>(userFile('window.json'));
export const savePosition = (pos: SavedPosition) => writeJson(userFile('window.json'), pos);

// ---------- Google tokens (encrypted with the OS keychain via safeStorage) ----------

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at: number;
  scope?: string;
}

const TOKENS_FILE = () => userFile('google-tokens.bin');

export function loadTokens(): StoredTokens | undefined {
  try {
    const raw = fs.readFileSync(TOKENS_FILE());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(json) as StoredTokens;
  } catch {
    return undefined;
  }
}

export function saveTokens(tokens: StoredTokens) {
  const json = JSON.stringify(tokens);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.mkdirSync(path.dirname(TOKENS_FILE()), { recursive: true });
  fs.writeFileSync(TOKENS_FILE(), data, { mode: 0o600 });
}

export function clearTokens() {
  try { fs.unlinkSync(TOKENS_FILE()); } catch { /* already gone */ }
}

// ---------- Google OAuth client config ----------

export interface OAuthClientConfig { clientId: string; clientSecret: string }

/** Minimal .env loader for development (no dependency needed). */
export function loadDotEnv(dir: string) {
  try {
    const text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
}

/**
 * Looks for the OAuth client in this order:
 * 1. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars (.env in dev)
 * 2. <userData>/google-oauth.json
 * 3. <resources>/google-oauth.json (bundled by electron-builder)
 * 4. <project root>/google-oauth.json (dev)
 * The JSON can be the file downloaded from Google Cloud ({"installed": {...}}) or {clientId, clientSecret}.
 */
export function getOAuthConfig(): OAuthClientConfig | undefined {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && !GOOGLE_CLIENT_ID.startsWith('your-')) {
    return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
  }
  const candidates = [
    userFile('google-oauth.json'),
    path.join(process.resourcesPath ?? '', 'google-oauth.json'),
    path.join(app.getAppPath(), 'google-oauth.json'),
  ];
  for (const file of candidates) {
    const json = readJson<any>(file);
    const c = json?.installed ?? json?.web ?? json;
    const clientId = c?.client_id ?? c?.clientId;
    const clientSecret = c?.client_secret ?? c?.clientSecret;
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return undefined;
}
