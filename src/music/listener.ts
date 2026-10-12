import { estimateTempo, isStableTempo, median, spectralFlux } from './beat';

/**
 * Listens to whatever the computer is playing (system audio "loopback" capture) and works out
 * whether it is music and at what tempo. Audio is analysed in memory only: nothing is recorded,
 * stored or sent anywhere.
 */

export type MusicStatus = 'off' | 'starting' | 'listening' | 'unavailable';

export interface MusicSnapshot {
  status: MusicStatus;
  /** True while steady, rhythmic audio is detected. */
  playing: boolean;
  bpm: number;
  error?: string;
}

/** Shared beat clock, read every animation frame by the mascot (no React re-render needed). */
export interface BeatClock {
  active: boolean;
  periodSec: number;
  /** performance.now() of a recent beat. */
  originMs: number;
  bpm: number;
}

export const beatClock: BeatClock = { active: false, periodSec: 0.5, originMs: 0, bpm: 0 };

const FFT_SIZE = 1024;
const FLUX_LO_BIN = 1;
const FLUX_HI_BIN = 100; // ~50 Hz – 4.7 kHz at 48 kHz
const WINDOW_SEC = 8;
const AUDIBLE_RMS = 0.002;
/** Share of the last 3 s that must be audible. Low on purpose: sparse beats leave gaps, digital silence is exactly zero. */
const MIN_AUDIBLE_FRACTION = 0.15;
/** How clearly the audio must repeat to start the dance (clicks ≈ 0.8, synthetic speech ≈ 0.1–0.3), and to keep it going. */
const START_CONFIDENCE = 0.3;
const KEEP_CONFIDENCE = 0.18;
const TICK_EVERY_SEC = 0.5;
/** Extra delay between the captured audio and what you hear, in ms (tune if the dance feels early or late). */
const LATENCY_MS = 0;

type Subscriber = (s: MusicSnapshot) => void;

export class MusicListener {
  snapshot: MusicSnapshot = { status: 'off', playing: false, bpm: 0 };
  private subscribers = new Set<Subscriber>();
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private processor?: ScriptProcessorNode;

  private flux: number[] = [];
  private stamps: number[] = [];
  private rms: number[] = [];
  private blocksSinceTick = 0;
  private bpms: number[] = [];
  private confidences: number[] = [];
  private silentTicks = 0;
  private weakTicks = 0;

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    fn(this.snapshot);
    return () => { this.subscribers.delete(fn); };
  }

  /** Starts listening. Needs a user gesture on some platforms, which the main process simulates. */
  async start(): Promise<void> {
    if (this.snapshot.status === 'listening' || this.snapshot.status === 'starting') return;
    this.update({ status: 'starting', playing: false, bpm: 0, error: undefined });
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      // Only the audio is wanted; drop the video track straight away so nothing is captured visually.
      for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
      if (!stream.getAudioTracks().length) throw new Error('This system does not provide audio capture.');
      stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      // ScriptProcessor is deprecated, but it is driven by the audio clock (not timers that get throttled
      // when the window is hidden) and needs no separate worklet file, which the strict CSP would block.
      const processor = ctx.createScriptProcessor(FFT_SIZE, 1, 1);
      const hop = FFT_SIZE / ctx.sampleRate;
      const prev = new Float32Array(analyser.frequencyBinCount).fill(-100);
      const spec = new Float32Array(analyser.frequencyBinCount);

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        analyser.getFloatFrequencyData(spec);
        this.push(spectralFlux(prev, spec, FLUX_LO_BIN, FLUX_HI_BIN), Math.sqrt(sum / input.length), performance.now() - LATENCY_MS, hop);
        prev.set(spec);
      };
      source.connect(analyser);
      source.connect(processor);
      processor.connect(ctx.destination); // outputs silence; required for the callback to run

      this.stream = stream;
      this.ctx = ctx;
      this.source = source;
      this.analyser = analyser;
      this.processor = processor;
      this.update({ status: 'listening' });
    } catch (e) {
      this.cleanup();
      this.update({ status: 'unavailable', playing: false, bpm: 0, error: (e as Error)?.message || 'Audio capture failed.' });
    }
  }

  /** Pretends music is playing (browser preview only, where there is no audio to capture). */
  simulate(bpm: number): void {
    beatClock.bpm = bpm;
    beatClock.periodSec = 60 / bpm;
    beatClock.originMs = performance.now();
    beatClock.active = true;
    this.update({ status: 'listening', playing: true, bpm, error: undefined });
  }

  stop(): void {
    this.cleanup();
    this.update({ status: 'off', playing: false, bpm: 0, error: undefined });
  }

  private cleanup() {
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.analyser?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.processor = this.analyser = this.source = this.stream = this.ctx = undefined;
    this.flux = []; this.stamps = []; this.rms = []; this.bpms = []; this.confidences = [];
    this.blocksSinceTick = this.silentTicks = this.weakTicks = 0;
    beatClock.active = false;
  }

  private push(flux: number, rms: number, stamp: number, hop: number) {
    const cap = Math.ceil((WINDOW_SEC * 2) / hop);
    this.flux.push(flux); this.stamps.push(stamp); this.rms.push(rms);
    if (this.flux.length > cap) { this.flux.shift(); this.stamps.shift(); this.rms.shift(); }
    if (++this.blocksSinceTick >= Math.round(TICK_EVERY_SEC / hop)) {
      this.blocksSinceTick = 0;
      this.tick(hop);
    }
  }

  private tick(hop: number) {
    const recent = this.rms.slice(-Math.round(3 / hop));
    const audible = recent.filter((v) => v > AUDIBLE_RMS).length / Math.max(1, recent.length);
    if (audible < MIN_AUDIBLE_FRACTION) {
      // Silence (or nearly): after a few quiet seconds the music has stopped.
      if (++this.silentTicks >= 6) { this.bpms = []; this.confidences = []; this.setPlaying(false); }
      return;
    }
    this.silentTicks = 0;

    const n = Math.round(WINDOW_SEC / hop);
    const start = Math.max(0, this.flux.length - n);
    const est = estimateTempo(this.flux.slice(start), hop);
    if (!est) return;
    this.bpms.push(est.bpm); this.confidences.push(est.confidence);
    if (this.bpms.length > 8) { this.bpms.shift(); this.confidences.shift(); }

    if (!isStableTempo(this.bpms, this.confidences, beatClock.active ? KEEP_CONFIDENCE : START_CONFIDENCE)) {
      if (++this.weakTicks >= 12) this.setPlaying(false);
      return;
    }
    this.weakTicks = 0;

    const bpm = median(this.bpms);
    const period = 60 / bpm;
    const i = start + est.lastBeat;
    const lo = Math.max(0, Math.min(this.stamps.length - 1, Math.floor(i)));
    const hi = Math.min(this.stamps.length - 1, lo + 1);
    const beatStamp = this.stamps[lo] + (this.stamps[hi] - this.stamps[lo]) * (i - lo);

    if (beatClock.active && Math.abs(period - beatClock.periodSec) / beatClock.periodSec < 0.06) {
      // Same song: nudge the clock instead of jumping, so the dance stays smooth.
      let drift = ((beatStamp - beatClock.originMs) / 1000) % period;
      if (drift > period / 2) drift -= period;
      if (drift < -period / 2) drift += period;
      beatClock.originMs += drift * 1000 * 0.3;
      beatClock.periodSec = beatClock.periodSec * 0.7 + period * 0.3;
    } else {
      beatClock.originMs = beatStamp;
      beatClock.periodSec = period;
    }
    beatClock.bpm = bpm;
    beatClock.active = true;
    this.setPlaying(true, Math.round(bpm));
  }

  private setPlaying(playing: boolean, bpm = 0) {
    if (!playing) beatClock.active = false;
    const s = this.snapshot;
    if (s.playing === playing && Math.abs(s.bpm - bpm) < 2) return;
    this.update({ playing, bpm });
  }

  private update(patch: Partial<MusicSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.subscribers.forEach((fn) => fn(this.snapshot));
  }
}
