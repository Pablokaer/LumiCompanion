import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { OllamaStatus, Settings } from '../../shared/types';

export interface OllamaToolCall { function: { name: string; arguments: Record<string, unknown> | string } }

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const trimUrl = (url: string) => url.replace(/\/+$/, '');

export async function ollamaStatus(baseUrl: string): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${trimUrl(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, models: [], error: `HTTP ${res.status}` };
    const json = (await res.json()) as { models?: { name: string }[] };
    return { running: true, models: (json.models ?? []).map((m) => m.name).sort() };
  } catch (e) {
    return { running: false, models: [], error: 'Ollama is not running. Install it from ollama.com and start it.' };
  }
}

export async function ollamaChat(opts: {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  format?: 'json';
  timeoutMs?: number;
  /** Context window; Ollama's default is too small for long prompts. */
  numCtx?: number;
}): Promise<OllamaMessage> {
  const res = await fetch(`${trimUrl(opts.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      format: opts.format,
      stream: false,
      options: { temperature: 0.3, ...(opts.numCtx ? { num_ctx: opts.numCtx } : {}) },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) throw new Error(`Model "${opts.model}" is not installed. Run: ollama pull ${opts.model}`);
    if (/does not support tools/i.test(text)) throw new Error(`Model "${opts.model}" does not support tool calling. Try llama3.1:8b or qwen2.5:7b.`);
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message: OllamaMessage };
  return { ...json.message, content: stripThinking(json.message.content ?? '') };
}

/** Removes <think>…</think> blocks some reasoning models emit. */
export function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export type ModelTask = 'chat' | 'triage' | 'writing';

/** The model for a task: the per-task override when set, otherwise the default model. */
export function modelFor(settings: Pick<Settings, 'ollamaModel' | 'modelChat' | 'modelTriage' | 'modelWriting'>, task: ModelTask): string {
  const override = { chat: settings.modelChat, triage: settings.modelTriage, writing: settings.modelWriting }[task]?.trim();
  return override || settings.ollamaModel;
}

/** Only local servers are ever started automatically. */
export function isLocalUrl(baseUrl: string): boolean {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname); } catch { return false; }
}

/** Where Lumi unpacks its own copy of Ollama on Windows (the standalone build: no tray app, no autostart, no windows). */
export function lumiOllamaDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA ?? '', 'Lumi', 'ollama');
}

/** Likely locations of the Ollama executable, in order. The bare name relies on PATH. */
export function ollamaCandidates(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    return [path.join(lumiOllamaDir(env), 'ollama.exe'), path.join(env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe'), 'ollama.exe'];
  }
  if (platform === 'darwin') return ['/Applications/Ollama.app/Contents/Resources/ollama', path.join(env.HOME ?? '', 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', 'ollama'];
  return ['/usr/local/bin/ollama', '/usr/bin/ollama', 'ollama'];
}

/**
 * Starts `ollama serve` when it is installed but not running, and waits until it
 * answers. Resolves with the final status; never throws. The server is left
 * running when Lumi quits, like it would be if the user had started it.
 */
export function ensureOllama(baseUrl: string, waitMs = 20_000): Promise<OllamaStatus> {
  // One start at a time: startup and the automatic setup both ask, and a second `ollama serve` would be a second process.
  const pending = starting.get(baseUrl);
  if (pending) return pending;
  const p = startOllama(baseUrl, waitMs).finally(() => starting.delete(baseUrl));
  starting.set(baseUrl, p);
  return p;
}

const starting = new Map<string, Promise<OllamaStatus>>();

async function startOllama(baseUrl: string, waitMs: number): Promise<OllamaStatus> {
  const current = await ollamaStatus(baseUrl);
  if (current.running || !isLocalUrl(baseUrl)) return current;

  for (const exe of ollamaCandidates()) {
    if (path.isAbsolute(exe) && !fs.existsSync(exe)) continue;
    const started = await new Promise<boolean>((resolve) => {
      // Not detached on Windows: a process without a console makes every runner Ollama starts open its own visible console window.
      // Hidden-but-attached (CREATE_NO_WINDOW) gives them a hidden console to inherit; the server still outlives Lumi.
      const child = spawn(exe, ['serve'], { detached: process.platform !== 'win32', stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    });
    if (!started) continue;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const status = await ollamaStatus(baseUrl);
      if (status.running) return status;
    }
    return ollamaStatus(baseUrl);
  }
  return current;
}
