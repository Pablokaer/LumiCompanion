import { app } from 'electron';

/** CPU use per kind of Electron process, in percent of one core (as `app.getAppMetrics()` reports it). */
export interface PerfSample {
  renderer: number;
  gpu: number;
  main: number;
}

interface MetricLike { type: string; cpu: { percentCPUUsage: number } }

/** Adds up the processes of each kind: the window's renderer ("Tab"), the GPU process and the main ("Browser") process. */
export function summarizeMetrics(metrics: MetricLike[]): PerfSample {
  const sum = (types: string[]) => metrics.filter((m) => types.includes(m.type)).reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
  return { renderer: sum(['Tab']), gpu: sum(['GPU']), main: sum(['Browser']) };
}

export const formatSample = (s: PerfSample) =>
  `[perf] renderer ${s.renderer.toFixed(1)}%  gpu ${s.gpu.toFixed(1)}%  main ${s.main.toFixed(1)}%`;

export const PERF_EVERY_MS = 5_000;

/**
 * Development aid: with `LUMI_PERF=1` the CPU use of each process kind is printed every 5 seconds, so a change
 * can be judged by numbers (idle, covered, asleep, dancing, panel open). Does nothing otherwise.
 */
export function startPerfLog(log: (line: string) => void = console.log): (() => void) | undefined {
  if (!process.env.LUMI_PERF) return undefined;
  const timer = setInterval(() => log(formatSample(summarizeMetrics(app.getAppMetrics()))), PERF_EVERY_MS);
  return () => clearInterval(timer);
}
