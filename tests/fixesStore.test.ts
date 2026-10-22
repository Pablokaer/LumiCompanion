import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ dir: '', encrypt: true }));

vi.mock('electron', () => ({
  app: { getPath: () => h.dir },
  // A stand-in cipher: reversing the text is enough to tell encrypted bytes from plain JSON.
  safeStorage: {
    isEncryptionAvailable: () => h.encrypt,
    encryptString: (s: string) => Buffer.from([...s].reverse().join('')),
    decryptString: (b: Buffer) => [...b.toString()].reverse().join(''),
  },
}));

import { DEFAULT_SETTINGS } from '../shared/settings';
import { clearTokens, getSettings, loadTokens, onSettingsChanged, saveTokens, updateSettings } from '../electron/store';

beforeAll(() => { h.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-store-')); });
afterAll(() => { fs.rmSync(h.dir, { recursive: true, force: true }); });

const files = () => fs.readdirSync(h.dir);
const tokens = { access_token: 'access_SECRET', refresh_token: 'refresh_SECRET', expires_at: 1 };

describe('Google tokens at rest', () => {
  it('are encrypted on disk and written without leaving a half-written file around', () => {
    h.encrypt = true;
    saveTokens(tokens);
    expect(files()).toEqual(['google-tokens.bin']);
    expect(fs.readFileSync(path.join(h.dir, 'google-tokens.bin')).toString()).not.toContain('SECRET');
    expect(loadTokens()).toEqual(tokens);
  });

  it('are never written in plain text when the system cannot encrypt: they stay in memory, and an old plain file is removed', () => {
    fs.writeFileSync(path.join(h.dir, 'google-tokens.bin'), JSON.stringify(tokens)); // what older versions left behind
    h.encrypt = false;
    expect(loadTokens()).toBeUndefined(); // the plain file is not trusted or read
    saveTokens(tokens);
    expect(files()).not.toContain('google-tokens.bin');
    expect(loadTokens()).toEqual(tokens);
    clearTokens();
    expect(loadTokens()).toBeUndefined();
  });

  it('go back to the encrypted file once encryption is available again', () => {
    h.encrypt = false;
    saveTokens(tokens);
    h.encrypt = true;
    saveTokens({ ...tokens, access_token: 'second' });
    expect(files()).toContain('google-tokens.bin');
    expect(loadTokens()?.access_token).toBe('second');
    clearTokens();
  });
});

describe('saving settings', () => {
  it('writes through a temporary file that does not stay behind', () => {
    updateSettings({ mascotName: 'Nova' });
    expect(files().filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(h.dir, 'settings.json'), 'utf8')).mascotName).toBe('Nova');
  });

  it('ignores unknown settings and values of the wrong kind or outside their range', () => {
    const before = getSettings();
    const next = updateSettings({
      evil: 'x', __proto__: { polluted: true }, mascotName: 'Lumi2', ollamaUrl: 'ftp://nope', reminderLeadMinutes: 'abc',
      focusMinutes: 9999, widgetMode: 'weird', briefingTime: '25:99', sleepAfterMinutes: Number.NaN, quickCapture: 'yes', skin: 'nebula',
    } as never);
    expect(next.mascotName).toBe('Lumi2');
    expect(next.skin).toBe('nebula');
    expect(next.ollamaUrl).toBe(before.ollamaUrl);
    expect(next.reminderLeadMinutes).toEqual(before.reminderLeadMinutes);
    expect(next.focusMinutes).toBe(240); // clamped
    expect(next.widgetMode).toBe(before.widgetMode);
    expect(next.briefingTime).toBe(before.briefingTime);
    expect(next.sleepAfterMinutes).toBe(before.sleepAfterMinutes);
    expect(next.quickCapture).toBe(before.quickCapture);
    expect('evil' in next).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('evil' in JSON.parse(fs.readFileSync(path.join(h.dir, 'settings.json'), 'utf8'))).toBe(false);
  });

  it('accepts a real AI server address (without a trailing slash) and refuses one with a password in it', () => {
    expect(updateSettings({ ollamaUrl: 'http://192.168.1.5:11434/' }).ollamaUrl).toBe('http://192.168.1.5:11434');
    expect(updateSettings({ ollamaUrl: 'http://user:pw@evil.example' }).ollamaUrl).toBe('http://192.168.1.5:11434');
    expect(updateSettings({ ollamaUrl: DEFAULT_SETTINGS.ollamaUrl }).ollamaUrl).toBe(DEFAULT_SETTINGS.ollamaUrl);
  });

  it('can still clear the optional values', () => {
    expect(updateSettings({ dndUntil: 123 }).dndUntil).toBe(123);
    expect(updateSettings({ dndUntil: undefined }).dndUntil).toBeUndefined();
  });

  it('survives a patch that is not an object at all', () => {
    const before = { ...getSettings() };
    expect(updateSettings(null as never)).toMatchObject({ mascotName: before.mascotName });
    expect(updateSettings('x' as never)).toMatchObject({ mascotName: before.mascotName });
    expect(updateSettings([1] as never)).toMatchObject({ mascotName: before.mascotName });
  });
});

describe('settings listeners', () => {
  it('hear every real change with the keys that changed, wherever it came from, and nothing for a no-op', () => {
    const heard: string[][] = [];
    const off = onSettingsChanged((_next, changed) => heard.push(changed));
    updateSettings({ startInTray: !getSettings().startInTray }); // what a tray toggle does
    updateSettings({ mascotName: getSettings().mascotName }); // same value: nothing to tell
    updateSettings({ reminderLeadMinutes: [5, 30, 5] });
    off();
    updateSettings({ startInTray: !getSettings().startInTray });
    expect(heard).toEqual([['startInTray'], ['reminderLeadMinutes']]);
    expect(getSettings().reminderLeadMinutes).toEqual([30, 5]);
  });
});
