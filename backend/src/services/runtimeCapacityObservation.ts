import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Prisma } from '@prisma/client';

type JobMeasurements = { completed: number; failed: number; totalMs: number; maxMs: number };
type PoolWait = { samples: number; totalMs: number; p95UpperMs: number | null };
type CapacityWindow = {
  kind: 'backend_capacity_window';
  commit: string;
  pid: number;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  memory: { rssBytes: number; heapUsedBytes: number };
  eventLoop: { samples: number; p95Ms: number | null; maxMs: number | null };
  poolWait: PoolWait | null;
  jobs: Array<JobMeasurements & { name: string }>;
};

type Options = {
  commit: string;
  poolMetrics: () => Promise<Prisma.Metrics | undefined>;
  emit?: (window: CapacityWindow) => void;
  intervalMs?: number;
};

const poolWaitMetric = 'prisma_client_queries_wait_histogram_ms';
const millis = (value: number) => Math.round(value * 100) / 100;

function poolWaitDifference(previous?: Prisma.MetricHistogram, current?: Prisma.MetricHistogram): PoolWait | null {
  if (!previous || !current || previous.buckets.length !== current.buckets.length) return null;
  const samples = current.count - previous.count;
  const totalMs = current.sum - previous.sum;
  if (!Number.isSafeInteger(samples) || samples < 0 || !Number.isFinite(totalMs) || totalMs < 0) return null;

  let p95UpperMs: number | null = null;
  let cumulative = 0;
  // Prisma 5.22 JSON snapshots contain lifetime counts per nonoverlapping bucket.
  for (const [index, [bound, count]] of current.buckets.entries()) {
    const [priorBound, priorCount] = previous.buckets[index];
    const delta = count - priorCount;
    cumulative += delta;
    if (bound !== priorBound || !Number.isSafeInteger(delta) || delta < 0 || cumulative > samples) return null;
    if (samples > 0 && p95UpperMs === null && Number.isFinite(bound) && cumulative >= Math.ceil(samples * 0.95)) {
      p95UpperMs = bound;
    }
  }
  return { samples, totalMs: millis(totalMs), p95UpperMs };
}

let recordJob: ((name: string, elapsedMs: number, failed: boolean) => void) | undefined;

export function observeRuntimeBackgroundJob(name: string, run: () => Promise<unknown>) {
  const record = recordJob;
  if (!record) return run;
  return async () => {
    const started = performance.now();
    let failed = true;
    try {
      const result = await run();
      failed = false;
      return result;
    } finally {
      record(name, performance.now() - started, failed);
    }
  };
}

export function startRuntimeCapacityObservation({
  commit, poolMetrics, intervalMs = 60_000, emit = window => console.info(JSON.stringify(window)),
}: Options) {
  if (recordJob) throw new Error('RUNTIME_CAPACITY_OBSERVATION_ALREADY_STARTED');

  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  let startedAt = new Date();
  let started = performance.now();
  let jobs = new Map<string, JobMeasurements>();
  let stopped = false;
  recordJob = (name, elapsedMs, failed) => {
    if (stopped) return;
    const job = jobs.get(name) ?? { completed: 0, failed: 0, totalMs: 0, maxMs: 0 };
    job.completed += 1;
    if (failed) job.failed += 1;
    job.totalMs += elapsedMs;
    job.maxMs = Math.max(job.maxMs, elapsedMs);
    jobs.set(name, job);
  };

  const readPoolWait = async () => {
    try {
      const metrics = await poolMetrics();
      return metrics?.histograms.find(metric => metric.key === poolWaitMetric)?.value;
    } catch {
      return undefined;
    }
  };

  let previousPoolWait: Prisma.MetricHistogram | undefined;
  let pending: Promise<void> | undefined = readPoolWait().then(value => { previousPoolWait = value; });
  void pending.then(() => { pending = undefined; });
  const timer = setInterval(() => {
    if (pending) return;
    const endedAt = new Date();
    const ended = performance.now();
    const { rss, heapUsed } = process.memoryUsage();
    const window = {
      kind: 'backend_capacity_window' as const, commit, pid: process.pid,
      startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), elapsedMs: millis(ended - started),
      memory: { rssBytes: rss, heapUsedBytes: heapUsed },
      eventLoop: {
        samples: loop.count,
        p95Ms: loop.count ? millis(loop.percentile(95) / 1e6) : null,
        maxMs: loop.count ? millis(loop.max / 1e6) : null,
      },
      jobs: [...jobs].map(([name, job]) => ({ ...job, name, totalMs: millis(job.totalMs), maxMs: millis(job.maxMs) })),
    };
    loop.reset();
    jobs = new Map();
    started = ended;
    startedAt = endedAt;
    pending = readPoolWait().then(current => {
      const poolWait = poolWaitDifference(previousPoolWait, current);
      previousPoolWait = current;
      if (!stopped) emit({ ...window, poolWait });
    }).catch(() => {
      console.warn('RUNTIME_CAPACITY_OBSERVATION_EMIT_FAILED');
    }).finally(() => { pending = undefined; });
  }, intervalMs);
  timer.unref();

  return async () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
      loop.disable();
      recordJob = undefined;
    }
    await pending;
  };
}
