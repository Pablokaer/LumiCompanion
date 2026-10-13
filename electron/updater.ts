import { app } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { UpdateState } from '../shared/types';
import { appBundleOf, downloadVerified, INSTALL_SCRIPT, parseMacFeed, stagingDir, type MacFeedEntry } from './macUpdate';

const run = promisify(execFile);

/**
 * Keeps Lumi up to date from its GitHub releases.
 *
 * - Windows and Linux (AppImage): the update downloads in the background (its SHA-512 is checked against
 *   `latest.yml`) and installs when you restart.
 * - macOS: electron-updater needs a developer-ID signature, so Lumi downloads the release .zip itself, checks its
 *   SHA-512, and swaps the app in place when it quits (see macUpdate.ts). If the app cannot be replaced (not in a
 *   writable folder), it only tells you a newer version exists.
 * - Linux .deb: not self-updating, so Lumi only tells you a newer version exists and opens the download page.
 */

export const REPO = { owner: 'Pablokaer', repo: 'LumiCompanion' };
export const RELEASES_PAGE = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;

export const FIRST_CHECK_MS = 20_000;
export const CHECK_EVERY_MS = 4 * 60 * 60_000;

export type Strategy = 'auto' | 'mac' | 'notify';
const FEED_MAC = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest/download/latest-mac.yml`;

/** How this install can be updated. */
export function updateStrategy(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Strategy {
  if (platform === 'win32') return 'auto';
  if (platform === 'linux') return env.APPIMAGE ? 'auto' : 'notify';
  if (platform === 'darwin') return 'mac';
  return 'notify';
}

/** Compares "1.2.3"-style versions numerically: negative when a < b, 0 when equal, positive when a > b. A pre-release sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return 0;
}

/** Test hook: the update feed can be redirected, but only to this computer. */
export function isLocalFeed(url: string | undefined): url is string {
  try { return !!url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname); } catch { return false; }
}

/** The newest release from the GitHub API response, if it is a normal (non-draft, non-pre) release. */
export function parseLatestRelease(json: unknown): { version: string } | undefined {
  const r = json as { tag_name?: unknown; draft?: unknown; prerelease?: unknown } | null;
  if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string') return undefined;
  const version = r.tag_name.replace(/^v/i, '');
  return /^\d+(\.\d+){0,2}/.test(version) ? { version } : undefined;
}

export class UpdateService extends EventEmitter {
  private state: UpdateState = { status: 'idle', currentVersion: app.getVersion(), notifyOnly: false };
  private timers: NodeJS.Timeout[] = [];
  private wired = false;
  private checking = false;
  private macUpdate?: { app: string; staged: string; stage: string };
  private macSpawned = false;

  get current(): UpdateState { return this.state; }

  /** Starts the periodic checks (not in development, where there is nothing installed to replace). */
  start(enabled: () => boolean) {
    if (!app.isPackaged) {
      this.set({ status: 'unsupported', message: 'Updates work in the installed app, not in development.' });
      return;
    }
    const tick = () => { if (enabled()) void this.check(false); };
    this.timers.push(setTimeout(tick, FIRST_CHECK_MS), setInterval(tick, CHECK_EVERY_MS));
  }

  stop() { this.timers.forEach(clearTimeout); this.timers = []; }

  async check(manual: boolean): Promise<UpdateState> {
    if (!app.isPackaged && !isLocalFeed(process.env.LUMI_UPDATE_FEED)) return this.state;
    if (this.checking || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    this.checking = true;
    try {
      let strategy = updateStrategy(process.platform, process.env);
      // macOS can only replace itself when the app sits in a folder this user can write to.
      const bundle = appBundleOf(process.execPath);
      if (strategy === 'mac' && !(bundle && canReplace(bundle))) strategy = 'notify';
      const notifyOnly = strategy === 'notify';
      this.set({ status: 'checking', notifyOnly });
      if (strategy === 'notify') await this.checkReleasePage();
      else if (strategy === 'mac') await this.checkMac(bundle!);
      else await this.checkAndDownload();
    } catch (e) {
      // A failed background check is not worth bothering anyone about; a manual one is.
      this.set(manual ? { status: 'error', message: friendly(e) } : { status: 'idle' });
    } finally {
      this.checking = false;
    }
    return this.state;
  }

  /** Restarts into the downloaded update. */
  install() {
    if (this.state.status !== 'ready') return;
    if (this.macUpdate) { this.spawnMacInstall(true); app.quit(); return; }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  /** Called when Lumi quits: a downloaded macOS update is put in place without opening the app again. */
  applyOnQuit() {
    if (this.macUpdate && this.state.status === 'ready') this.spawnMacInstall(false);
  }

  // ---- macOS ----

  private async checkMac(bundle: string) {
    const res = await fetch(FEED_MAC, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const entry = parseMacFeed(await res.text(), process.arch);
    if (!entry || compareVersions(entry.version, app.getVersion()) <= 0) { this.set({ status: 'none' }); return; }
    this.set({ status: 'available', version: entry.version });
    await this.downloadMac(entry, bundle);
  }

  private async downloadMac(entry: MacFeedEntry, bundle: string) {
    const stage = stagingDir(os.tmpdir(), entry.version);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const zip = path.join(stage, 'update.zip');
    const base = FEED_MAC.slice(0, FEED_MAC.lastIndexOf('/') + 1);
    this.set({ status: 'downloading', version: entry.version, percent: 0 });
    await downloadVerified(base + encodeURIComponent(entry.url), zip, entry.sha512, (percent) => this.set({ status: 'downloading', version: entry.version, percent }));
    await run('/usr/bin/ditto', ['-x', '-k', zip, path.join(stage, 'unpacked')]);
    fs.rmSync(zip, { force: true });
    const staged = path.join(stage, 'unpacked', path.basename(bundle));
    if (!fs.existsSync(path.join(staged, 'Contents', 'MacOS'))) throw new Error('The downloaded update is not a Lumi app.');
    this.macUpdate = { app: bundle, staged, stage };
    this.set({ status: 'ready', version: entry.version, percent: 100 });
  }

  private spawnMacInstall(relaunch: boolean) {
    const u = this.macUpdate;
    if (!u || this.macSpawned) return;
    this.macSpawned = true;
    const script = path.join(u.stage, 'install.sh');
    fs.writeFileSync(script, INSTALL_SCRIPT, { mode: 0o700 });
    // Detached, so it keeps running (and can replace the app) after Lumi has quit.
    spawn('/bin/sh', [script, String(process.pid), u.staged, u.app, u.stage, relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
  }

  // ---- notify-only platforms ----

  private async checkReleasePage() {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const latest = parseLatestRelease(await res.json());
    if (latest && compareVersions(latest.version, app.getVersion()) > 0) this.set({ status: 'available', version: latest.version, notifyOnly: true });
    else this.set({ status: 'none' });
  }

  // ---- self-updating platforms ----

  private async checkAndDownload() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
    if (!this.wired) {
      this.wired = true;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.allowPrerelease = false;
      autoUpdater.allowDowngrade = false;
      if (isLocalFeed(process.env.LUMI_UPDATE_FEED)) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.LUMI_UPDATE_FEED });
      autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version }));
      autoUpdater.on('update-not-available', () => this.set({ status: 'none' }));
      autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }));
      autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version, percent: 100 }));
      autoUpdater.on('error', (e) => this.set({ status: 'error', message: friendly(e) }));
    }
    await autoUpdater.checkForUpdates();
  }

  private set(patch: Partial<UpdateState>) {
    // Moving on to a new status clears the fields of the previous one.
    const base: UpdateState = { status: 'idle', currentVersion: app.getVersion(), notifyOnly: this.state.notifyOnly };
    this.state = { ...base, version: patch.status === this.state.status ? this.state.version : undefined, ...patch };
    this.emit('state', this.state);
  }
}

/** Whether the app folder can be written to, so a new version can take its place. */
function canReplace(bundle: string): boolean {
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); return true; } catch { return false; }
}

export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/sha512 checksum mismatch|sha256 checksum mismatch/i.test(m)) return 'The downloaded update failed its integrity check and was discarded.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::|fetch failed/i.test(m)) return 'Could not reach the update server. Check your internet connection.';
  return m.split('\n')[0].slice(0, 200);
}
