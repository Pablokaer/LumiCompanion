import { describe, expect, it } from 'vitest';
import { beatPhase, estimateTempo, isStableTempo, median, normalizeFlux, spectralFlux } from '../src/music/beat';

const HOP = 1024 / 48000;

/** A deterministic pseudo-random generator so the tests never flake. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Onset strength of a click track: a sharp peak on each beat that decays over a few hops, plus noise. */
function clickTrack(bpm: number, seconds: number, noise = 0.05, offsetSec = 0.1, seed = 1) {
  const rand = rng(seed);
  const n = Math.round(seconds / HOP);
  const period = 60 / bpm;
  return Array.from({ length: n }, (_, i) => {
    const t = i * HOP - offsetSec;
    const sinceBeat = t < 0 ? 99 : t % period;
    const hit = Math.exp(-sinceBeat / 0.03);
    return hit + noise * rand();
  });
}

describe('tempo estimation', () => {
  it.each([80, 100, 120, 128, 140])('finds %i BPM within 2%', (bpm) => {
    const t = estimateTempo(clickTrack(bpm, 8), HOP)!;
    expect(Math.abs(t.bpm - bpm) / bpm).toBeLessThan(0.02);
    expect(t.confidence).toBeGreaterThan(0.3);
  });

  it.each([[160, 80], [170, 85]])('reports %i BPM at half-time (%i) so the dance stays relaxed', (bpm, expected) => {
    const t = estimateTempo(clickTrack(bpm, 8), HOP)!;
    expect(Math.abs(t.bpm - expected) / expected).toBeLessThan(0.02);
  });

  it('survives a noisy signal with a steady pulse underneath', () => {
    const t = estimateTempo(clickTrack(120, 8, 0.5, 0.2, 7), HOP)!;
    expect(Math.abs(t.bpm - 120)).toBeLessThan(3);
  });

  it('does not see rhythm in noise, and ignores silence', () => {
    const rand = rng(42);
    const noise = Array.from({ length: 400 }, () => rand());
    expect(estimateTempo(noise, HOP)!.confidence).toBeLessThan(0.25);
    expect(estimateTempo(new Array(400).fill(0), HOP)).toBeNull();
    expect(estimateTempo([1, 0, 1], HOP)).toBeNull();
  });

  it('locates the most recent beat', () => {
    const bpm = 120;
    const flux = clickTrack(bpm, 8, 0.02, 0.1);
    const t = estimateTempo(flux, HOP)!;
    // Beats fall at 0.1 + k·0.5 s; the last one inside the window is the last such time below the end.
    const end = flux.length * HOP;
    const expected = 0.1 + Math.floor((end - 0.1) / 0.5) * 0.5;
    expect(Math.abs(t.lastBeat * HOP - expected)).toBeLessThan(0.05);
  });
});

describe('helpers', () => {
  it('computes rectified spectral flux and clamps silence', () => {
    const prev = Float32Array.from([-Infinity, -50, -40]);
    const cur = Float32Array.from([-60, -30, -45]);
    // bins 0..2: (-60 - -100)=40, 20, negative → ignored; averaged over 3 bins
    expect(spectralFlux(prev, cur, 0, 3)).toBeCloseTo(20, 5);
  });

  it('removes slow loudness changes', () => {
    const ramp = Array.from({ length: 100 }, (_, i) => i);
    expect(Math.max(...normalizeFlux(ramp, 20).slice(10, 90))).toBeLessThan(1);
  });

  it('trusts only agreeing, confident estimates', () => {
    expect(isStableTempo([120, 121, 119, 120, 120], [0.4, 0.4, 0.4, 0.4, 0.4], 0.2)).toBe(true);
    expect(isStableTempo([120, 90, 150, 120, 100], [0.4, 0.4, 0.4, 0.4, 0.4], 0.2)).toBe(false);
    expect(isStableTempo([120, 121, 119, 120], [0.1, 0.1, 0.1, 0.1], 0.2)).toBe(false);
    expect(isStableTempo([120, 121], [0.9, 0.9], 0.2)).toBe(false);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('turns time into beat position', () => {
    expect(beatPhase(1250, 1000, 0.5)).toEqual({ phase: 0.5, count: 0 });
    const p = beatPhase(3100, 1000, 0.5);
    expect(p.count).toBe(4);
    expect(p.phase).toBeCloseTo(0.2, 5);
    expect(beatPhase(900, 1000, 0.5).count).toBe(-1);
  });
});
