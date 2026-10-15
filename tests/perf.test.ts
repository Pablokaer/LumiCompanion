import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }));

import { formatSample, summarizeMetrics } from '../electron/perf';

const m = (type: string, percentCPUUsage: number, privateKb = 0) => ({ type, cpu: { percentCPUUsage }, memory: { privateBytes: privateKb } });

describe('perf log', () => {
  it('adds up the processes of each kind', () => {
    const s = summarizeMetrics([m('Browser', 0.5), m('Tab', 2), m('Tab', 1.5), m('GPU', 3), m('Utility', 9)]);
    expect(s).toMatchObject({ renderer: 3.5, gpu: 3, main: 0.5 });
  });
  it('adds up the memory of each kind, in MB, with the rest as "other"', () => {
    const s = summarizeMetrics([m('Browser', 0, 102_400), m('Tab', 0, 51_200), m('Tab', 0, 25_600), m('GPU', 0, 30_720), m('Utility', 0, 10_240)]);
    expect(s.mem).toEqual({ renderer: 75, gpu: 30, main: 100, other: 10, total: 215 });
  });
  it('falls back to the working set and copes with missing memory data', () => {
    const s = summarizeMetrics([{ type: 'Tab', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 2048 } }, { type: 'GPU', cpu: { percentCPUUsage: 0 } }]);
    expect(s.mem).toEqual({ renderer: 2, gpu: 0, main: 0, other: 0, total: 2 });
  });
  it('prints one short line', () => {
    const mem = { renderer: 80.4, gpu: 30, main: 100, other: 10, total: 220.4 };
    expect(formatSample({ renderer: 3.456, gpu: 0, main: 0.04, mem })).toBe(
      '[perf] renderer 3.5%  gpu 0.0%  main 0.0%  | memory: renderer 80 MB  gpu 30 MB  main 100 MB  other 10 MB  total 220 MB',
    );
  });
});
