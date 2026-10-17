import type { RequestHandler } from 'express';
import { HttpRequestLifecycle } from './httpRequestLifecycle';
import { RuntimeTaskAdmission } from './runtimeTaskAdmission';

const unavailable = () => Object.assign(new Error('RUNTIME_WORK_ADMISSION_CLOSED'), {
  code: 'RUNTIME_WORK_ADMISSION_CLOSED', status: 503, statusCode: 503, isOperational: true,
});

/** One runtime's HTTP and managed application work share durable completion
 * references. Response/disconnect completion cannot release unfinished SQL or
 * callback work. This composes the native admission primitives; it grants no
 * serving, worker/control, recovery or migration authority by itself.
 *
 * Recovery orchestration is deliberately separate: a checkpoint controller
 * must not hold this shared application gate while requesting its exclusive
 * capture boundary. Its independent control-operation owner remains required.
 */
export class RuntimeWorkBoundary {
  private accepting = true;
  readonly requests: HttpRequestLifecycle;

  constructor(private readonly tasks: RuntimeTaskAdmission, admission: (() => boolean) | HttpRequestLifecycle,
    private readonly assertBackgroundOwner: () => void, private readonly assertHttpOwner: () => void = () => {}) {
    if (admission instanceof HttpRequestLifecycle) {
      admission.bindOwnership(() => this.acquireHttp());
      this.requests = admission;
    } else {
      if (typeof admission !== 'function') throw Error('RUNTIME_WORK_HTTP_LIFECYCLE_INVALID');
      this.requests = new HttpRequestLifecycle(admission, () => this.acquireHttp());
    }
  }

  private async acquireHttp() {
    this.assertHttpOwner();
    const lease = await this.acquire();
    try { this.assertHttpOwner(); }
    catch (error) { await lease.release(); throw error; }
    return lease;
  }

  private async acquire() {
    if (!this.accepting) throw unavailable();
    const lease = await this.tasks.acquire();
    if (!this.accepting) { await lease.release(); throw unavailable(); }
    return lease;
  }

  /** Install before routing/body parsing; install requests' promise adapter
   * after all routes/error handlers and before listen, as in the main runtime. */
  readonly middleware: RequestHandler = (request, response, next) => {
    const pathname = request.originalUrl.split('?')[0];
    if (!this.accepting && pathname !== '/api/health' && pathname !== '/api/ready') {
      response.status(503).json({ success: false, error: 'RUNTIME_WORK_ADMISSION_CLOSED',
        message: 'این نسخه در حال پایان کار است؛ کمی بعد دوباره تلاش کنید.' });
      return;
    }
    this.requests.middleware(request, response, next);
  };

  /** The scheduler's actual returned promise owns completion. Never pass a
   * detached timer/provider promise as an already completed callback here. */
  async runBackground<T>(work: () => Promise<T>): Promise<T> {
    this.assertBackgroundOwner();
    const lease = await this.acquire();
    try {
      this.assertBackgroundOwner();
      return await work();
    } finally { await lease.release(); }
  }

  async stopAndDrain(timeoutMs: number) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 240_000) throw Error('RUNTIME_WORK_DRAIN_BUDGET_INVALID');
    this.accepting = false;
    // Both waits start after admission closes and use the same total budget.
    // Failure retains native ownership; it never kills a request/job/database.
    await Promise.all([this.requests.waitForDrain(timeoutMs), this.tasks.stopAndDrain(timeoutMs)]);
  }
}
