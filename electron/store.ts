import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { migrateAppearance } from '../shared/appearance';
import { applyPatch, DEFAULT_SETTINGS } from '../shared/settings';
import type { NewsItem, Routine } from '../shared/routines';
import type { Settings } from '../shared/types';
import type { RoutineStorage } from './services/routines';


const userFile = (name: string) => path.join(app.getPath('userData'), name);

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Writes through a temporary file and renames it, so a crash or power cut never leaves a half-written file behind. */
function writeFileAtomic(file: string, data: string | Buffer, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
  fs.renameSync(tmp, file);
}

function writeJson(file: string, data: unknown) {
  writeFileAtomic(file, JSON.stringify(data, null, 2));
}

// ---------- Settings ----------

let settingsCache: Settings | undefined;
type SettingsListener = (next: Settings, changed: (keyof Settings)[]) => void;
const settingsListeners = new Set<SettingsListener>();

export function getSettings(): Settings {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS, ...migrateAppearance(readJson<Record<string, unknown>>(userFile('settings.json')) ?? {}) } as Settings;
  }
  return settingsCache;
}

/** Saves a (checked) change and tells every listener which settings really changed, wherever the change came from. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const { next, changed } = applyPatch(getSettings(), patch);
  settingsCache = next;
  writeJson(userFile('settings.json'), next);
  if (changed.length) settingsListeners.forEach((l) => l(next, changed));
  return next;
}

/** Runs `listener` after every saved change. Returns a function that stops it. */
export function onSettingsChanged(listener: SettingsListener) {
  settingsListeners.add(listener);
  return () => { settingsListeners.delete(listener); };
}

// ---------- Window position ----------

export interface SavedPosition { x: number; y: number }
export const getSavedPosition = () => readJson<SavedPosition>(userFile('window.json'));
export const savePosition = (pos: SavedPosition) => writeJson(userFile('window.json'), pos);

// ---------- Routines and news ----------

/** Routines, the addresses each has seen, and the news they found, kept in memory and written on every change. */
function jsonStore<T>(file: string, empty: () => T) {
  let cache: T | undefined;
  return {
    get: () => (cache ??= readJson<T>(userFile(file)) ?? empty()),
    set: (value: T) => { cache = value; writeJson(userFile(file), value); },
  };
}

const routinesFile = jsonStore<Routine[]>('routines.json', () => []);
const seenFile = jsonStore<Record<string, string[]>>('routines-seen.json', () => ({}));
const newsFile = jsonStore<NewsItem[]>('news.json', () => []);

export const routineStorage: RoutineStorage = {
  routines: routinesFile.get,
  saveRoutines: routinesFile.set,
  seen: seenFile.get,
  saveSeen: seenFile.set,
  news: newsFile.get,
  saveNews: newsFile.set,
};

// ---------- Google tokens (encrypted with the OS keychain via safeStorage) ----------

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at: number;
  scope?: string;
  /** Last known profile, so the app can still show who is signed in while offline. */
  profile?: { name: string; email: string; picture?: string };
}

const TOKENS_FILE = () => userFile('google-tokens.bin');

/**
 * Where the tokens live when the OS cannot encrypt them (for example Linux without a keyring): in memory only,
 * so they are never written to disk in the clear. You sign in again each time Lumi starts.
 */
let memoryTokens: StoredTokens | undefined;

const canEncrypt = () => {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
};

export function loadTokens(): StoredTokens | undefined {
  if (memoryTokens) return memoryTokens;
  if (!canEncrypt()) return undefined; // nothing readable on disk: older versions saved plain text, which is now removed
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(TOKENS_FILE()))) as StoredTokens;
  } catch {
    return undefined;
  }
}

export function saveTokens(tokens: StoredTokens) {
  if (!canEncrypt()) {
    memoryTokens = tokens;
    try { fs.unlinkSync(TOKENS_FILE()); } catch { /* none left over */ }
    return;
  }
  memoryTokens = undefined;
  writeFileAtomic(TOKENS_FILE(), safeStorage.encryptString(JSON.stringify(tokens)), 0o600);
}

export function clearTokens() {
  memoryTokens = undefined;
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
