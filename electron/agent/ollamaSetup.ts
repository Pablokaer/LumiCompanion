import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { OllamaSetupState } from '../../shared/types';
import { ensureOllama, isLocalUrl, lumiOllamaDir, ollamaCandidates, ollamaStatus } from './ollama';

const run = promisify(execFile);

/**
 * Sets up the local AI by itself: downloads Ollama from ollama.com when it is missing, installs it, starts it,
 * and downloads the model Lumi uses. Windows and macOS only; on Linux the official installer needs administrator
 * rights, so Lumi explains the one command to run instead.
 */

/**
 * Windows uses the standalone build (a plain zip with ollama.exe): the official installer also adds Ollama's tray app,
 * which starts with Windows and shows its own windows and notifications. Lumi only needs the server.
 */
export const INSTALLERS = {
  win32: { url: windowsZipUrl(), file: 'ollama-windows.zip' },
  darwin: { url: 'https://ollama.com/download/Ollama-darwin.zip', file: 'Ollama-darwin.zip' },
} as const;

function windowsZipUrl(arch = process.arch): string {
  return `https://github.com/ollama/ollama/releases/latest/download/ollama-windows-${arch === 'arm64' ? 'arm64' : 'amd64'}.zip`;
}

export const LINUX_HINT = 'On Linux, install Ollama with:  curl -fsSL https://ollama.com/install.sh | sh  (it needs administrator rights), then reopen Lumi.';

/** Whether an Ollama executable exists on this computer (not whether it is running). */
export function isOllamaInstalled(platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  return ollamaCandidates(platform, env).some((exe) => {
    if (path.isAbsolute(exe)) return fs.existsSync(exe);
    return (env.PATH ?? '').split(path.delimiter).some((dir) => dir && fs.existsSync(path.join(dir, exe)));
  });
}

/** One line of Ollama's streamed `/api/pull` answer, as a percentage (or an error). */
export function parsePullLine(line: string): { percent?: number; status?: string; error?: string } | undefined {
  try {
    const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
    if (j.error) return { error: j.error };
    const percent = j.total && j.completed !== undefined ? Math.min(99, Math.floor((j.completed / j.total) * 100)) : undefined;
    return { status: j.status, percent };
  } catch {
    return undefined;
  }
}

/** Downloads a file with progress. */
async function download(url: string, dest: string, onProgress: (percent: number) => void): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`ollama.com answered ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let seen = 0, last = -1;
  try {
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      const buf = chunk as Buffer;
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
}

export class OllamaSetup extends EventEmitter {
  private state: OllamaSetupState = { status: 'idle' };
  private busy = false;

  get current() { return this.state; }

  private set(next: OllamaSetupState) {
    this.state = next;
    this.emit('state', next);
  }

  /**
   * Makes sure Ollama is installed, running and has at least one model. Does nothing when everything is
   * already in place. Never throws: problems end up in the state.
   */
  async ensure(baseUrl: string, model: string): Promise<OllamaSetupState> {
    if (this.busy) return this.state;
    if (!isLocalUrl(baseUrl)) return this.state; // a remote server is somebody else's to manage
    this.busy = true;
    try {
      let status = await ollamaStatus(baseUrl);
      if (!status.running && !isOllamaInstalled()) {
        const platform = process.platform;
        if (platform !== 'win32' && platform !== 'darwin') { this.set({ status: 'unsupported', message: LINUX_HINT }); return this.state; }
        await this.install(platform);
      }
      if (!status.running) {
        this.set({ status: 'starting' });
        status = await ensureOllama(baseUrl, 60_000);
        if (!status.running) throw new Error('Ollama is installed but did not start. Open the Ollama app once, then try again.');
      }
      if (!status.models.length) await this.pull(baseUrl, model);
      this.set({ status: 'ready' });
    } catch (e) {
      this.set({ status: 'error', message: friendlySetupError(e) });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  private async install(platform: 'win32' | 'darwin') {
    const { url, file } = INSTALLERS[platform];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-ollama-'));
    const dest = path.join(dir, file);
    try {
      this.set({ status: 'downloading', percent: 0, message: 'Downloading Ollama' });
      await download(url, dest, (percent) => this.set({ status: 'downloading', percent, message: 'Downloading Ollama' }));
      this.set({ status: 'installing', message: 'Installing Ollama' });
      if (platform === 'win32') {
        // Unpack into Lumi's own folder: no installer, no administrator rights, no tray app, no windows.
        const target = lumiOllamaDir();
        fs.mkdirSync(target, { recursive: true });
        await new Promise<void>((resolve, reject) => {
          const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
          const child = spawn(tar, ['-xf', dest, '-C', target], { stdio: 'ignore', windowsHide: true });
          child.once('error', reject);
          child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Unpacking Ollama failed (code ${code}).`))));
        });
        if (!fs.existsSync(path.join(target, 'ollama.exe'))) throw new Error('The Ollama download did not contain ollama.exe.');
      } else {
        const apps = writable('/Applications') ? '/Applications' : path.join(os.homedir(), 'Applications');
        fs.mkdirSync(apps, { recursive: true });
        await run('/usr/bin/ditto', ['-x', '-k', dest, apps]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async pull(baseUrl: string, model: string) {
    this.set({ status: 'pulling', model, percent: 0, message: `Downloading the ${model} model` });
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama could not download ${model} (HTTP ${res.status}).`);
    let buffer = '';
    let last = -1;
    for await (const chunk of Readable.fromWeb(res.body as any)) {
      buffer += (chunk as Buffer).toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const p = parsePullLine(line.trim());
        if (!p) continue;
        if (p.error) throw new Error(p.error);
        if (p.percent !== undefined && p.percent !== last) { last = p.percent; this.set({ status: 'pulling', model, percent: p.percent, message: `Downloading the ${model} model` }); }
      }
    }
  }
}

function writable(dir: string): boolean {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

export function friendlySetupError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|fetch failed|net::/i.test(m)) return 'Could not reach ollama.com. Check your internet connection; Lumi will try again next time it opens.';
  if (/ENOSPC/i.test(m)) return 'Not enough free disk space for the local AI.';
  return m.split('\n')[0].slice(0, 220);
}
