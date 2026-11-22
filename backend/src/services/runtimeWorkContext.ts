import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeTaskAdmission } from './runtimeTaskAdmission';

type Work = { active: boolean; pending: Set<Promise<unknown>> };

/** Completion ownership for non-Express application entry points. */
export class RuntimeWorkContext {
  private readonly storage = new AsyncLocalStorage<Work>();

  constructor(private readonly tasks: RuntimeTaskAdmission, private readonly assertOwner: () => void) {}

  gateIdentity() { return this.tasks.gateIdentity(); }

  /** Used by a nested storage owner before durable side effects. An ambient
   * context whose actual root lease ended cannot authorize a detached writer. */
  assertActive() {
    if (!this.storage.getStore()?.active) throw Object.assign(new Error('RUNTIME_WORK_CONTEXT_NOT_ACTIVE'), {
      code: 'RUNTIME_WORK_CONTEXT_NOT_ACTIVE',
    });
    this.assertOwner();
  }

  run<T>(body: () => Promise<T>): Promise<T> {
    const parent = this.storage.getStore();
    if (parent?.active) {
      const child = Promise.resolve().then(() => { this.assertOwner(); return body(); });
      parent.pending.add(child);
      void child.then(() => parent.pending.delete(child), () => parent.pending.delete(child));
      return child;
    }
    return this.runRoot(body);
  }

  private async runRoot<T>(body: () => Promise<T>): Promise<T> {
    this.assertOwner();
    const lease = await this.tasks.acquire();
    const work: Work = { active: true, pending: new Set() };
    try {
      this.assertOwner();
      return await this.storage.run(work, body);
    } finally {
      // A returned/failed action can still have an already started query. Keep
      // its real lease until all such descendants have actually completed.
      while (work.pending.size) await Promise.allSettled([...work.pending]);
      work.active = false;
      await lease.release();
    }
  }

  async stopAndDrain(timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 240000) {
      throw Object.assign(new Error('RUNTIME_WORK_DRAIN_TIMEOUT_INVALID'), { code: 'RUNTIME_WORK_DRAIN_TIMEOUT_INVALID' });
    }
    await this.tasks.stopAndDrain(timeoutMs);
  }
}
