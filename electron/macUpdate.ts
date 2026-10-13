import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * Self-update for macOS without an Apple Developer certificate.
 *
 * electron-updater's macOS updater (Squirrel.Mac) refuses apps that are not signed with a real developer ID,
 * so Lumi does the few steps itself: download the release .zip for this CPU, check its SHA-512 against
 * `latest-mac.yml`, unpack it, and, once Lumi has quit, swap the app in place (a small shell script), sign it
 * ad hoc again and open it. A file downloaded by the app itself carries no quarantine flag, so macOS does not
 * show the "damaged" warning for updates.
 */

export interface MacFeedEntry { version: string; url: string; sha512: string; size?: number }

/** Reads `latest-mac.yml` (a tiny, regular YAML file) and picks the .zip for this CPU. */
export function parseMacFeed(yml: string, arch: string): MacFeedEntry | undefined {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yml)?.[1];
  if (!version) return undefined;
  // Entries look like:  - url: Lumi-1.2.3-mac-arm64.zip \n    sha512: abc== \n    size: 123
  for (const block of yml.split(/^\s*-\s+url:/m).slice(1)) {
    const url = block.split(/\r?\n/)[0].trim().replace(/^['"]|['"]$/g, '');
    if (!new RegExp(`-mac-${arch}\\.zip$`).test(url) || /[\\/]|\.\./.test(url)) continue;
    const sha512 = /sha512:\s*['"]?([A-Za-z0-9+/=]+)['"]?/.exec(block)?.[1];
    const size = Number(/size:\s*(\d+)/.exec(block)?.[1]);
    if (sha512) return { version, url, sha512, size: size || undefined };
  }
  return undefined;
}

/** `/Applications/Lumi.app` from the running executable, or undefined when not running from an app bundle. */
export function appBundleOf(execPath: string): string | undefined {
  const m = /^(.*?\.app)\/Contents\//.exec(execPath.replace(/\\/g, '/'));
  return m?.[1];
}

/** The shell script that replaces the app once Lumi has quit. Everything it needs comes in as arguments. */
export const INSTALL_SCRIPT = `#!/bin/sh
# usage: install.sh <pid of Lumi> <new Lumi.app> <installed Lumi.app> <staging folder> <relaunch: 1|0>
PID="$1"; NEW="$2"; APP="$3"; STAGE="$4"; RELAUNCH="$5"
n=0
while kill -0 "$PID" 2>/dev/null && [ "$n" -lt 60 ]; do sleep 0.5; n=$((n+1)); done
OLD="$APP.previous"
rm -rf "$OLD"
if mv "$APP" "$OLD"; then
  if /usr/bin/ditto "$NEW" "$APP"; then
    /usr/bin/xattr -cr "$APP" 2>/dev/null
    /usr/bin/codesign --force --deep --sign - "$APP" 2>/dev/null
    rm -rf "$OLD"
  else
    rm -rf "$APP"; mv "$OLD" "$APP"
  fi
fi
rm -rf "$STAGE"
if [ "$RELAUNCH" = "1" ]; then /usr/bin/open "$APP"; fi
`;

/** Downloads a file, reporting progress, and checks its SHA-512 (base64, as in latest-mac.yml). */
export async function downloadVerified(url: string, dest: string, sha512: string, onProgress: (percent: number) => void): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`The update server answered ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = createHash('sha512');
  const out = fs.createWriteStream(dest);
  let seen = 0;
  let last = -1;
  try {
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      seen += buf.length;
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()));
      const pct = total ? Math.min(99, Math.round((seen / total) * 100)) : 0;
      if (pct !== last) { last = pct; onProgress(pct); }
    }
    await new Promise<void>((resolve, reject) => { out.once('error', reject); out.end(() => resolve()); });
  } catch (e) {
    out.destroy();
    fs.rmSync(dest, { force: true });
    throw e;
  }
  if (hash.digest('base64') !== sha512) {
    fs.rmSync(dest, { force: true });
    throw new Error('sha512 checksum mismatch');
  }
}

export const stagingDir = (tmp: string, version: string) => path.join(tmp, `lumi-update-${version}`);
