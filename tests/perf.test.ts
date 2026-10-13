import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }));

import { formatSample, summarizeMetrics } from '../electron/perf';

const m = (type: string, percentCPUUsage: number) => ({ type, cpu: { percentCPUUsage } });

describe('perf log', () => {
  it('adds up the processes of each kind', () => {
    const s = summarizeMetrics([m('Browser', 0.5), m('Tab', 2), m('Tab', 1.5), m('GPU', 3), m('Utility', 9)]);
    expect(s).toEqual({ renderer: 3.5, gpu: 3, main: 0.5 });
  });
  it('prints one short line', () => {
    expect(formatSample({ renderer: 3.456, gpu: 0, main: 0.04 })).toBe('[perf] renderer 3.5%  gpu 0.0%  main 0.0%');
  });
});
