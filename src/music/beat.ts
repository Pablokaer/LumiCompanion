/**
 * Tempo and beat detection from an onset-strength signal (one value per audio hop).
 * Pure functions, unit tested with synthetic click tracks; the live audio plumbing is in listener.ts.
 */

export const TEMPO_MIN = 70;
export const TEMPO_MAX = 180;
/** The tempo people tap most often; used as a soft prior so 60 vs 120 BPM ambiguities resolve sensibly. */
const TEMPO_PRIOR = 120;
/** Faster tempos are reported at half-time: dancing on every second beat looks natural, every beat looks frantic. */
export const DANCE_MAX = 150;

export interface Tempo {
  bpm: number;
  /** 0..1: how strongly the signal repeats at that tempo (periodic pulse train ≈ 1, noise ≈ 0). */
  confidence: number;
  /** Index (fractional, in hops) of the most recent beat inside the analysed window. */
  lastBeat: number;
}

/** Half-wave rectified spectral flux between two dB spectra over bins [lo, hi). Silence (-Infinity) is clamped. */
export function spectralFlux(prev: Float32Array, cur: Float32Array, lo: number, hi: number): number {
  let sum = 0;
  for (let k = lo; k < hi; k++) {
    const d = Math.max(-100, cur[k]) - Math.max(-100, prev[k]);
    if (d > 0) sum += d;
  }
  return sum / Math.max(1, hi - lo);
}

/** Subtracts a moving average and keeps only positive peaks, so slow loudness changes do not count as rhythm. */
export function normalizeFlux(flux: ArrayLike<number>, window: number): Float64Array {
  const n = flux.length;
  const out = new Float64Array(n);
  const half = Math.max(1, Math.floor(window / 2));
  let acc = 0;
  let lo = 0;
  let hi = 0; // window is [lo, hi)
  for (let i = 0; i < n; i++) {
    const newHi = Math.min(n, i + half + 1);
    while (hi < newHi) acc += flux[hi++];
    const newLo = Math.max(0, i - half);
    while (lo < newLo) acc -= flux[lo++];
    out[i] = Math.max(0, flux[i] - acc / (hi - lo));
  }
  return out;
}

/** Estimates the tempo of an onset-strength signal sampled every `hop` seconds. Returns null when there is too little data. */
export function estimateTempo(flux: ArrayLike<number>, hop: number): Tempo | null {
  const n = flux.length;
  const lagMin = Math.max(2, Math.floor(60 / TEMPO_MAX / hop));
  const lagMax = Math.ceil(60 / TEMPO_MIN / hop);
  if (n < lagMax * 3) return null;

  // Smooth by one hop either side so pulses are wider than the lag resolution, then centre the signal
  // so that random noise (which is non-negative after rectifying) does not correlate with itself.
  const rect = normalizeFlux(flux, Math.round(0.6 / hop));
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.25 * (rect[i - 1] ?? rect[i]) + 0.5 * rect[i] + 0.25 * (rect[i + 1] ?? rect[i]);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) { x[i] -= mean; energy += x[i] * x[i]; }
  if (energy < 1e-9) return null;

  // Autocorrelation up to 2×lagMax so the double-period peak can reinforce the beat period.
  const maxLag = Math.min(n - 2, lagMax * 2 + 2);
  const r = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    r[lag] = s / (n - lag);
  }
  const r0 = energy / n;

  let best = -1;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 / (lag * hop);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / TEMPO_PRIOR) / 0.9) ** 2);
    const score = (r[lag] + 0.5 * (r[lag * 2] ?? 0)) * (0.7 + 0.3 * prior);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0) return null;

  // Parabolic interpolation for a sub-hop period.
  const a = r[best - 1] ?? r[best];
  const b = r[best];
  const c = r[best + 1] ?? r[best];
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  let period = best + shift;
  if (60 / (period * hop) > DANCE_MAX && period * 2 <= maxLag) period *= 2;

  // Beat phase: the offset whose comb of period-spaced samples collects the most onset energy.
  let bestOffset = 0;
  let bestComb = -Infinity;
  for (let o = 0; o < period; o += 0.5) {
    let s = 0;
    for (let t = o; t < n; t += period) s += x[Math.round(t)] ?? 0;
    if (s > bestComb) { bestComb = s; bestOffset = o; }
  }
  const lastBeat = bestOffset + period * Math.floor((n - 1 - bestOffset) / period);

  return { bpm: 60 / (period * hop), confidence: Math.max(0, Math.min(1, r[best] / r0)), lastBeat };
}

export function median(values: number[]): number {
  const s = [...values].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** True when the recent tempo estimates agree (within `tolerance`) strongly enough to trust them. */
export function isStableTempo(bpms: number[], confidences: number[], minConfidence: number, tolerance = 0.05): boolean {
  if (bpms.length < 4) return false;
  const m = median(bpms);
  const agreeing = bpms.filter((b, i) => Math.abs(b - m) / m <= tolerance && confidences[i] >= minConfidence).length;
  return agreeing >= Math.ceil(bpms.length * 0.66);
}

/** Position within the current beat, 0 ≤ phase < 1, and the number of whole beats since `origin`. */
export function beatPhase(nowMs: number, originMs: number, periodSec: number): { phase: number; count: number } {
  const beats = (nowMs - originMs) / 1000 / periodSec;
  const count = Math.floor(beats);
  return { phase: beats - count, count };
}
