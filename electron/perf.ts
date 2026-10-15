import { app } from 'electron';

/** CPU use per kind of Electron process, in percent of one core, and memory in MB (as `app.getAppMetrics()` reports them). */
export interface PerfSample {
  renderer: number;
  gpu: number;
  main: number;
  /** Memory per kind of process, in MB. `other` is everything else (utility processes, extra windows' helpers). */
  mem: { renderer: number; gpu: number; main: number; other: number; total: number };
}

interface MetricLike { type: string; cpu: { percentCPUUsage: number }; memory?: { workingSetSize?: number; privateBytes?: number } }

/** Adds up the processes of each kind: the window's renderer ("Tab"), the GPU process and the main ("Browser") process. */
export function summarizeMetrics(metrics: MetricLike[]): PerfSample {
  const sum = (types: string[]) => metrics.filter((m) => types.includes(m.type)).reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
  // Private memory is what the process really owns; the working set also counts pages shared with other processes. Both are in KB.
  const mb = (m: MetricLike) => ((m.memory?.privateBytes || m.memory?.workingSetSize || 0) / 1024);
  const memOf = (types: string[]) => metrics.filter((m) => types.includes(m.type)).reduce((n, m) => n + mb(m), 0);
  const total = metrics.reduce((n, m) => n + mb(m), 0);
  const renderer = memOf(['Tab']), gpu = memOf(['GPU']), main = memOf(['Browser']);
  return { renderer: sum(['Tab']), gpu: sum(['GPU']), main: sum(['Browser']), mem: { renderer, gpu, main, other: total - renderer - gpu - main, total } };
}

export const formatSample = (s: PerfSample) =>
  `[perf] renderer ${s.renderer.toFixed(1)}%  gpu ${s.gpu.toFixed(1)}%  main ${s.main.toFixed(1)}%` +
  `  | memory: renderer ${s.mem.renderer.toFixed(0)} MB  gpu ${s.mem.gpu.toFixed(0)} MB  main ${s.mem.main.toFixed(0)} MB  other ${s.mem.other.toFixed(0)} MB  total ${s.mem.total.toFixed(0)} MB`;

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
