import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('downloads only from ollama.com', () => {
    for (const i of Object.values(INSTALLERS)) expect(new URL(i.url).hostname).toBe('ollama.com');
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
