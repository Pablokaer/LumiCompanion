const SAMPLE_RATE = 16_000;
export const MAX_RECORDING_MS = 60_000;

export interface Recording {
  /** Stops the microphone and resolves with 16 kHz mono samples. */
  stop(): Promise<Float32Array>;
}

/** Records from the microphone as raw 16 kHz mono samples, the format the local speech model expects. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but needs no extra worker file, which the app's strict CSP would block.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    async stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
      const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) { out.set(c, offset); offset += c.length; }
      return out;
    },
  };
}

/** Friendly text for the usual microphone failures. */
export function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow it in your system privacy settings.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  return (e as Error)?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Voice input failed.';
}
