export type InterviewDraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export type InterviewDraftSaveSnapshot = {
  status: InterviewDraftSaveStatus;
  version: number;
  error?: unknown;
};

type TimerHandle = ReturnType<typeof setTimeout>;

const isVersionConflict = (error: any) => Number(error?.response?.status || 0) === 409;

export class InterviewDraftSaveCoordinator<Payload> {
  private version: number;
  private pending?: Payload;
  private running: Promise<void> | null = null;
  private retryTimer: TimerHandle | null = null;
  private failureCount = 0;
  private lastError?: unknown;
  private status: InterviewDraftSaveStatus = 'idle';

  constructor(private readonly options: {
    initialVersion: number;
    save: (payload: Payload, expectedVersion: number) => Promise<{ version: number }>;
    onChange?: (snapshot: InterviewDraftSaveSnapshot) => void;
    retryDelaysMs?: number[];
    schedule?: (callback: () => void, delayMs: number) => TimerHandle;
    cancelSchedule?: (timer: TimerHandle) => void;
  }) {
    this.version = options.initialVersion;
  }

  queue(payload: Payload) {
    this.pending = payload;
    if (this.status === 'conflict') return;
    void this.start().catch(() => undefined);
  }

  async flush(payload: Payload) {
    this.cancelRetry();
    if (this.status === 'conflict') throw this.lastError;
    this.pending = payload;
    await this.start();
    const completedStatus = this.getSnapshot().status;
    if (completedStatus === 'error' || completedStatus === 'conflict') throw this.lastError;
    return { version: this.version };
  }

  retry() {
    if (!this.pending || this.status === 'conflict') return;
    this.cancelRetry();
    void this.start().catch(() => undefined);
  }

  reset(version: number) {
    this.cancelRetry();
    this.pending = undefined;
    this.failureCount = 0;
    this.version = version;
    this.emit('saved');
  }

  getSnapshot(): InterviewDraftSaveSnapshot {
    return { status: this.status, version: this.version, error: this.lastError };
  }

  dispose() {
    this.cancelRetry();
  }

  private emit(status: InterviewDraftSaveStatus, error?: unknown) {
    this.status = status;
    this.lastError = error;
    this.options.onChange?.({ status, version: this.version, error });
  }

  private start() {
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async drain() {
    while (this.pending) {
      const payload = this.pending;
      this.pending = undefined;
      this.emit('saving');
      try {
        const saved = await this.options.save(payload, this.version);
        this.version = saved.version;
        this.failureCount = 0;
        this.emit('saved');
      } catch (error) {
        this.pending = payload;
        if (isVersionConflict(error)) {
          this.emit('conflict', error);
        } else {
          this.failureCount += 1;
          this.emit('error', error);
          this.scheduleRetry();
        }
        throw error;
      }
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    const delays = this.options.retryDelaysMs || [1_500, 3_000, 6_000];
    if (this.failureCount > delays.length) return;
    const delay = delays[Math.min(this.failureCount - 1, delays.length - 1)];
    const schedule = this.options.schedule || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
    this.retryTimer = schedule(() => {
      this.retryTimer = null;
      this.retry();
    }, delay);
  }

  private cancelRetry() {
    if (!this.retryTimer) return;
    const cancel = this.options.cancelSchedule || clearTimeout;
    cancel(this.retryTimer);
    this.retryTimer = null;
  }
}
