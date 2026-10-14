import { withRecoveryBackgroundWrite } from './recoveryRuntime';

type Job = { name: string; intervalMs: number; initialDelayMs?: number; run: () => Promise<unknown> };

/** Tracks completion of background work, rather than just the timer that started it. */
export class BackgroundJobGroup {
  private stopping = false;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly names = new Set<string>();

  constructor(private readonly execute: (work: () => Promise<unknown>) => Promise<unknown>) {}

  start(job: Job) {
    if (this.stopping) throw new Error('BACKGROUND_JOBS_STOPPING');
    if (this.names.has(job.name)) throw new Error('BACKGROUND_JOB_ALREADY_STARTED');
    if (!Number.isFinite(job.intervalMs) || job.intervalMs < 1) throw new Error('BACKGROUND_JOB_INTERVAL_INVALID');
    this.names.add(job.name);
    let stopped = false;
    let running = false;
    const invoke = () => {
      if (stopped || this.stopping || running) return;
      running = true;
      const task = Promise.resolve().then(() => this.execute(job.run)).then(() => undefined,
        () => { console.error('Background job failed', { name: job.name, code: 'BACKGROUND_JOB_FAILED' }); })
        .finally(() => { running = false; this.tasks.delete(task); });
      this.tasks.add(task);
    };
    const interval = setInterval(invoke, job.intervalMs);
    interval.unref();
    this.timers.add(interval);
    let initial: NodeJS.Timeout | undefined;
    if (job.initialDelayMs) {
      initial = setTimeout(invoke, job.initialDelayMs);
      initial.unref();
      this.timers.add(initial);
    } else invoke();
    return () => {
      stopped = true;
      clearInterval(interval);
      this.timers.delete(interval);
      if (initial) { clearTimeout(initial); this.timers.delete(initial); }
    };
  }

  async stop(timeoutMs: number) {
    this.stopping = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (!this.tasks.size) return;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([...this.tasks]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('BACKGROUND_JOB_DRAIN_TIMEOUT')), timeoutMs);
        }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
}

const backgroundJobs = new BackgroundJobGroup(withRecoveryBackgroundWrite);
export const startBackgroundJob = (job: Job) => backgroundJobs.start(job);
export const stopBackgroundJobs = (timeoutMs = 120_000) => backgroundJobs.stop(timeoutMs);
