import path from 'node:path';

/**
 * Local speech-to-text with Whisper running through transformers.js (ONNX).
 * The model (~150 MB) is downloaded once on first use and cached on disk; audio
 * never leaves the computer.
 */

export const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 90;
const MODEL = 'onnx-community/whisper-base';

type Recognizer = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let recognizer: Promise<Recognizer> | undefined;

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
  const run = await loadRecognizer(cacheDir, onProgress);
  const out = await run(audio, { chunk_length_s: 30, task: 'transcribe', ...(language ? { language } : {}) });
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
