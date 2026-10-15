import path from 'node:path';

/**
 * Local speech-to-text with Whisper running through transformers.js (ONNX).
 * The model (~150 MB) is downloaded once on first use and cached on disk; audio
 * never leaves the computer.
 */

export const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 90;
const MODEL = 'onnx-community/whisper-base';

type Recognizer = ((audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>) & { dispose?: () => Promise<void> | void };

/** The model takes a few hundred MB of memory, so it is let go of after this long without use (the next use reloads it from disk). */
export const UNLOAD_AFTER_MS = 3 * 60_000;

let recognizer: Promise<Recognizer> | undefined;
let busy = 0;
let unloadTimer: NodeJS.Timeout | undefined;

/** Frees the model now, unless it is being used. Returns whether it was freed. */
export async function unloadRecognizer(): Promise<boolean> {
  clearTimeout(unloadTimer);
  if (busy || !recognizer) return false;
  const loading = recognizer;
  recognizer = undefined;
  try { await (await loading).dispose?.(); } catch { /* it is gone either way */ }
  return true;
}

function scheduleUnload() {
  clearTimeout(unloadTimer);
  unloadTimer = setTimeout(() => void unloadRecognizer(), UNLOAD_AFTER_MS);
  unloadTimer.unref?.();
}

/** Loads (and on first use downloads) the model. `onProgress` receives 0-100 while downloading. */
export function loadRecognizer(cacheDir: string, onProgress?: (percent: number) => void): Promise<Recognizer> {
  if (!recognizer) {
    recognizer = (async () => {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = path.join(cacheDir, 'models');
      tf.env.allowLocalModels = false;
      const pipe = await tf.pipeline('automatic-speech-recognition', MODEL, {
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') onProgress?.(Math.round(p.progress));
        },
      } as never);
      return pipe as unknown as Recognizer;
    })().catch((e) => { recognizer = undefined; throw e; });
  }
  return recognizer;
}

export const LANGUAGE_NAMES: Record<string, string> = { pt: 'portuguese', en: 'english', es: 'spanish' };

/** Turns a few seconds of 16 kHz mono audio into text. `language` is a Whisper language name, or undefined to auto-detect. */
export async function transcribe(
  samples: Float32Array, cacheDir: string, language?: string, onProgress?: (percent: number) => void,
): Promise<string> {
  if (!samples.length) return '';
  const audio = samples.length > SAMPLE_RATE * MAX_SECONDS ? samples.subarray(0, SAMPLE_RATE * MAX_SECONDS) : samples;
  clearTimeout(unloadTimer);
  busy++;
  let out: Awaited<ReturnType<Recognizer>>;
  try {
    const run = await loadRecognizer(cacheDir, onProgress);
    out = await run(audio, { chunk_length_s: 30, task: 'transcribe', ...(language ? { language } : {}) });
  } finally {
    busy--;
    scheduleUnload();
  }
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
