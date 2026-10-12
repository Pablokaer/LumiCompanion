import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The real app, started with a throw-away profile and a DevTools port, plus a tiny DevTools client. */
export class RunningApp {
  private id = 0;
  private pending = new Map<number, (r: any) => void>();
  private ws!: WebSocket;
  readonly logs: string[] = [];

  private constructor(private proc: ChildProcess, private dataDir: string, private port: number) {}

  static async start(port = 9444): Promise<RunningApp> {
    const electron: string = require('electron'); // path to the electron binary
    const dataDir = mkdtempSync(join(tmpdir(), 'lumi-e2e-'));
    const args = ['.', `--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`];
    // CI containers have no sandbox helper; a normal desktop does not need this.
    if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
    const proc = spawn(electron, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
    const app = new RunningApp(proc, dataDir, port);
    proc.stdout?.on('data', (d) => app.logs.push(String(d)));
    proc.stderr?.on('data', (d) => app.logs.push(String(d)));
    await app.connect();
    return app;
  }

  private async connect() {
    for (let i = 0; i < 80; i++) {
      try {
        const pages = (await (await fetch(`http://127.0.0.1:${this.port}/json`)).json()) as any[];
        const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (page) {
          this.ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('devtools socket failed')); });
          this.ws.onmessage = (m) => {
            const d = JSON.parse(String(m.data));
            if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)!(d); this.pending.delete(d.id); }
          };
          return;
        }
      } catch { /* still starting */ }
      await sleep(500);
    }
    throw new Error(`the app never opened a window.\n${this.logs.join('').slice(-2000)}`);
  }

  private send(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve) => { const id = ++this.id; this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); });
  }

  /** Runs an expression in the page and returns its (JSON-able) value; promises are awaited. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed');
    return r.result?.result?.value as T;
  }

  /** Waits until the expression is truthy and returns it. */
  async waitFor<T = unknown>(expression: string, what: string, ms = 20_000): Promise<T> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const v = await this.eval<T>(expression); if (v) return v; } catch { /* page navigating */ }
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  async navigate(url: string) { await this.send('Page.navigate', { url }); await sleep(300); }
  currentUrl() { return this.eval<string>('location.href'); }

  async stop() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.proc.kill();
    await sleep(500);
    try { rmSync(this.dataDir, { recursive: true, force: true }); } catch { /* still locked: the OS cleans the temp folder */ }
  }
}
