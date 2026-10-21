import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ollamaCandidates, startedByLumi, stopOllama } from '../electron/agent/ollama';
import { friendlySetupError, INSTALLERS, isOllamaInstalled, LINUX_HINT, OllamaSetup, parsePullLine } from '../electron/agent/ollamaSetup';

afterEach(() => vi.restoreAllMocks());

describe('ollama setup helpers', () => {
  it('turns pull lines into progress', () => {
    expect(parsePullLine('{"status":"pulling abc","total":200,"completed":50}')).toEqual({ status: 'pulling abc', percent: 25 });
    expect(parsePullLine('{"status":"success"}')).toEqual({ status: 'success', percent: undefined });
    expect(parsePullLine('{"error":"model not found"}')).toEqual({ error: 'model not found' });
    expect(parsePullLine('not json')).toBeUndefined();
  });
  it('never shows 100% before the model is really done', () => {
    expect(parsePullLine('{"total":100,"completed":100}')?.percent).toBe(99);
  });
  it("downloads only from ollama.com or Ollama's own GitHub releases", () => {
    for (const i of Object.values(INSTALLERS)) {
      const u = new URL(i.url);
      expect(u.hostname === 'ollama.com' || (u.hostname === 'github.com' && u.pathname.startsWith('/ollama/ollama/releases/'))).toBe(true);
    }
  });
  it('uses the standalone Windows build, not the installer that adds the tray app', () => {
    expect(INSTALLERS.win32.url).toMatch(/ollama-windows-(amd64|arm64)\.zip$/);
    expect(ollamaCandidates('win32', { LOCALAPPDATA: 'C:\\L' } as NodeJS.ProcessEnv)[0]).toMatch(/Lumi.ollama.ollama\.exe$/);
  });
  it('detects an installed Ollama from the candidate paths', () => {
    expect(isOllamaInstalled('win32', { LOCALAPPDATA: 'C:\nowhere', PATH: '' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('writes friendly errors', () => {
    expect(friendlySetupError(new Error('fetch failed'))).toMatch(/ollama\.com/);
    expect(friendlySetupError(new Error('write ENOSPC'))).toMatch(/disk space/);
    expect(LINUX_HINT).toContain('install.sh');
  });
});

describe('setup against a running Ollama', () => {
  const server = (models: string[], pull = true) => new Promise<{ url: string; pulled: string[]; close(): void }>((resolve) => {
    const pulled: string[] = [];
    const s = http.createServer((req, res) => {
      if (req.url === '/api/tags') { res.end(JSON.stringify({ models: models.map((name) => ({ name })) })); return; }
      if (req.url === '/api/pull' && pull) {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          pulled.push(JSON.parse(body).model);
          models.push(JSON.parse(body).model);
          res.write('{"status":"pulling","total":100,"completed":40}\n');
          res.write('{"status":"pulling","total":100,"completed":100}\n');
          res.end('{"status":"success"}\n');
        });
        return;
      }
      res.statusCode = 404; res.end();
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(s.address() as any).port}`, pulled, close: () => s.close() }));
  });

  it('does nothing when a model is already there', async () => {
    const s = await server(['llama3.1:8b']);
    const setup = new OllamaSetup();
    const seen: string[] = [];
    setup.on('state', (st) => seen.push(st.status));
    expect((await setup.ensure(s.url, 'qwen2.5:7b')).status).toBe('ready');
    expect(s.pulled).toEqual([]);
    expect(seen).not.toContain('pulling');
    s.close();
  });
  it('downloads the model when none is installed, with progress', async () => {
    const s = await server([]);
    const setup = new OllamaSetup();
    const percents: number[] = [];
    setup.on('state', (st) => { if (st.status === 'pulling' && st.percent !== undefined) percents.push(st.percent); });
    expect((await setup.ensure(s.url, 'qwen2.5:7b')).status).toBe('ready');
    expect(s.pulled).toEqual(['qwen2.5:7b']);
    expect(percents).toContain(40);
    s.close();
  });
  it('reports an error when the model cannot be downloaded', async () => {
    const s = await server([], false);
    const state = await new OllamaSetup().ensure(s.url, 'qwen2.5:7b');
    expect(state.status).toBe('error');
    s.close();
  });
  it('leaves a remote server alone', async () => {
    const state = await new OllamaSetup().ensure('http://example.com:11434', 'x');
    expect(state.status).toBe('idle');
  });
});

describe('stopping the local AI', () => {
  it('unloads every loaded model and leaves a server Lumi did not start running', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body });
      if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.1:8b' }] }));
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [] }));
      return new Response('{}');
    }));
    try {
      expect(startedByLumi('http://localhost:11434/')).toBe(false);
      expect(await stopOllama('http://localhost:11434/')).toEqual({ stopped: false, external: true });
      const unloads = calls.filter((c) => c.url === 'http://localhost:11434/api/generate').map((c) => JSON.parse(c.body!));
      expect(unloads).toEqual([{ model: 'qwen2.5:7b', keep_alive: 0 }, { model: 'llama3.1:8b', keep_alive: 0 }]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('never throws when nothing is running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));
    try { expect(await stopOllama('http://localhost:11434')).toEqual({ stopped: false, external: false }); } finally { vi.unstubAllGlobals(); }
  });
});
