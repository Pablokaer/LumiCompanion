import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appBundleOf, downloadVerified, INSTALL_SCRIPT, parseMacFeed } from '../electron/macUpdate';

const FEED = `version: 0.1.12
files:
  - url: Lumi-0.1.12-mac-x64.zip
    sha512: AAAA+/==
    size: 100
  - url: Lumi-0.1.12-mac-arm64.zip
    sha512: BBBB+/==
    size: 200
  - url: Lumi-0.1.12-mac-arm64.dmg
    sha512: CCCC==
    size: 300
path: Lumi-0.1.12-mac-x64.zip
sha512: AAAA+/==
releaseDate: '2026-10-13T00:00:00.000Z'
`;

describe('macOS update feed', () => {
  it('picks the zip for this CPU', () => {
    expect(parseMacFeed(FEED, 'arm64')).toEqual({ version: '0.1.12', url: 'Lumi-0.1.12-mac-arm64.zip', sha512: 'BBBB+/==', size: 200 });
    expect(parseMacFeed(FEED, 'x64')?.url).toBe('Lumi-0.1.12-mac-x64.zip');
  });
  it('ignores dmg files, odd paths and broken feeds', () => {
    expect(parseMacFeed('version: 1.0.0\nfiles:\n  - url: Lumi-1.0.0-mac-arm64.dmg\n    sha512: X==\n', 'arm64')).toBeUndefined();
    expect(parseMacFeed('version: 1.0.0\nfiles:\n  - url: ../evil-mac-arm64.zip\n    sha512: X==\n', 'arm64')).toBeUndefined();
    expect(parseMacFeed('nothing useful', 'arm64')).toBeUndefined();
  });
});

describe('finding the installed app', () => {
  it('returns the .app folder', () => {
    expect(appBundleOf('/Applications/Lumi.app/Contents/MacOS/Lumi')).toBe('/Applications/Lumi.app');
    expect(appBundleOf('/Users/me/My Apps/Lumi.app/Contents/MacOS/Lumi')).toBe('/Users/me/My Apps/Lumi.app');
    expect(appBundleOf('/usr/local/bin/electron')).toBeUndefined();
  });
});

describe('the install script', () => {
  it('is valid shell and replaces the app only after the old one is moved aside', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-sh-')), 'install.sh');
    fs.writeFileSync(file, INSTALL_SCRIPT);
    const r = spawnSync('sh', ['-n', file]);
    if (r.error) return; // no sh on this machine
    expect(r.status).toBe(0);
    expect(INSTALL_SCRIPT.indexOf('mv "$APP" "$OLD"')).toBeLessThan(INSTALL_SCRIPT.indexOf('ditto "$NEW" "$APP"'));
    expect(INSTALL_SCRIPT).toContain('mv "$OLD" "$APP"'); // puts the old app back if the copy fails
  });
});

describe('verified download', () => {
  const serve = (body: Buffer) => new Promise<{ url: string; close(): void }>((resolve) => {
    const server = http.createServer((_req, res) => { res.setHeader('content-length', body.length); res.end(body); });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}/f.zip`, close: () => server.close() }));
  });
  const body = Buffer.alloc(200_000, 7);
  const sum = createHash('sha512').update(body).digest('base64');

  it('keeps a file whose checksum matches and reports progress', async () => {
    const s = await serve(body);
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-dl-')), 'u.zip');
    const seen: number[] = [];
    await downloadVerified(s.url, dest, sum, (p) => seen.push(p));
    s.close();
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
  it('throws away a file whose checksum does not match', async () => {
    const s = await serve(body);
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-dl-')), 'u.zip');
    await expect(downloadVerified(s.url, dest, 'wrong==', () => undefined)).rejects.toThrow(/checksum/);
    s.close();
    expect(fs.existsSync(dest)).toBe(false);
  });
});
