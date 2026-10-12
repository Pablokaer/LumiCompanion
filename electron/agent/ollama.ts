import type { OllamaStatus } from '../../shared/types';

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
