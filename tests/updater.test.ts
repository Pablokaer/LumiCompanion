import { afterEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ app: { isPackaged: true, getVersion: () => '0.1.5' } }));
vi.mock('electron', () => electron);

import { compareVersions, friendly, isLocalFeed, parseLatestRelease, UpdateService, updateStrategy } from '../electron/updater';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  electron.app.isPackaged = true;
});

describe('version comparison', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.5', '0.1.5')).toBe(0);
    expect(compareVersions('0.1.4', '0.1.5')).toBeLessThan(0);
  });

  it('copes with a leading v, missing parts and pre-releases', () => {
    expect(compareVersions('v0.1.6', '0.1.5')).toBeGreaterThan(0);
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
    expect(compareVersions('0.1.6-beta.1', '0.1.6')).toBeLessThan(0);
    expect(compareVersions('0.1.6', '0.1.6-beta.1')).toBeGreaterThan(0);
  });
});

describe('how each install updates', () => {
  it('updates itself on Windows and Linux AppImage, and only tells you elsewhere', () => {
    expect(updateStrategy('win32', {})).toBe('auto');
    expect(updateStrategy('linux', { APPIMAGE: '/tmp/Lumi.AppImage' })).toBe('auto');
    expect(updateStrategy('linux', {})).toBe('notify'); // .deb
    expect(updateStrategy('darwin', {})).toBe('mac'); // Lumi swaps the app itself (no developer certificate needed)
  });

  it('only ever redirects the feed to this computer (a test hook)', () => {
    expect(isLocalFeed('http://localhost:8080/updates')).toBe(true);
    expect(isLocalFeed('http://127.0.0.1:9')).toBe(true);
    expect(isLocalFeed('https://evil.example.com/feed')).toBe(false);
    expect(isLocalFeed('http://localhost.evil.com')).toBe(false);
    expect(isLocalFeed('garbage')).toBe(false);
    expect(isLocalFeed(undefined)).toBe(false);
  });
});

describe('error messages', () => {
  it('keep the hash out of integrity failures and explain network trouble', () => {
    expect(friendly(new Error('sha512 checksum mismatch, expected AAA==, got BBB=='))).toBe('The downloaded update failed its integrity check and was discarded.');
    expect(friendly(new Error('net::ERR_INTERNET_DISCONNECTED'))).toContain('internet connection');
    expect(friendly(new Error(`${'x'.repeat(500)}\nstack`)).length).toBeLessThanOrEqual(200);
  });
});

describe('GitHub release parsing', () => {
  it('reads normal releases and skips drafts, pre-releases and nonsense', () => {
    expect(parseLatestRelease({ tag_name: 'v0.1.9' })).toEqual({ version: '0.1.9' });
    expect(parseLatestRelease({ tag_name: '1.2.3' })).toEqual({ version: '1.2.3' });
    expect(parseLatestRelease({ tag_name: 'v0.1.9', draft: true })).toBeUndefined();
    expect(parseLatestRelease({ tag_name: 'v0.1.9', prerelease: true })).toBeUndefined();
    expect(parseLatestRelease({ tag_name: 'nightly' })).toBeUndefined();
    expect(parseLatestRelease({})).toBeUndefined();
    expect(parseLatestRelease(null)).toBeUndefined();
  });
});

describe('UpdateService (notify-only platforms)', () => {
  const onMac = () => vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  const release = (tag: string) => vi.fn(async () => new Response(JSON.stringify({ tag_name: tag })));

  it('announces a newer release and opens nothing by itself', async () => {
    onMac();
    vi.stubGlobal('fetch', release('v0.1.9'));
    const service = new UpdateService();
    const seen: string[] = [];
    service.on('state', (s) => seen.push(s.status));
    const state = await service.check(true);
    expect(state).toMatchObject({ status: 'available', version: '0.1.9', notifyOnly: true, currentVersion: '0.1.5' });
    expect(seen).toEqual(['checking', 'available']);
  });

  it('says you are up to date when the latest release is not newer', async () => {
    onMac();
    vi.stubGlobal('fetch', release('v0.1.5'));
    expect((await new UpdateService().check(true)).status).toBe('none');
    vi.stubGlobal('fetch', release('v0.1.2'));
    expect((await new UpdateService().check(true)).status).toBe('none');
  });

  it('reports a network failure for a manual check but stays quiet in the background', async () => {
    onMac();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }));
    const manual = await new UpdateService().check(true);
    expect(manual.status).toBe('error');
    expect(manual.message).toContain('internet connection');
    expect((await new UpdateService().check(false)).status).toBe('idle');
  });

  it('treats a GitHub error response as a failure, not as "up to date"', async () => {
    onMac();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })));
    const s = await new UpdateService().check(true);
    expect(s.status).toBe('error');
    expect(s.message).toContain('403');
  });

  it('does nothing in development', async () => {
    electron.app.isPackaged = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new UpdateService();
    service.start(() => true);
    expect(service.current.status).toBe('unsupported');
    await service.check(true);
    expect(fetchMock).not.toHaveBeenCalled();
    service.stop();
  });

  it('ignores a request to install when nothing has been downloaded', () => {
    const service = new UpdateService();
    expect(() => service.install()).not.toThrow();
  });
});
