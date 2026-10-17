import type { KernelWriteAdmission, KernelWriteLease } from './kernelWriteAdmission';
import type { RuntimeBoundaryJournal } from './runtimeBoundaryJournal';

const failure = (code: string) => Object.assign(new Error(code), { code });

/** One durable ACTIVE epoch covers overlapping local tasks; each still owns
 * its own completion reference. New work cannot join a settling epoch. The
 * shared kernel lease is released only after durable QUIESCENT publication.
 * This does not replace database-session/descendant proof after process death.
 */
export class RuntimeTaskAdmission {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private waiting = 0;
  private stopping = false;
  private poisoned = false;
  private group?: { lease: KernelWriteLease; epoch: number; references: Set<symbol> };

  constructor(private readonly gate: KernelWriteAdmission, private readonly journal: RuntimeBoundaryJournal,
    private readonly assertOwner: () => void, private readonly canJoin: () => boolean = () => true) {
    const acquired = gate.identity(), declared = journal.gateIdentity();
    if (acquired.device !== declared.device || acquired.inode !== declared.inode || acquired.ownerUid !== declared.ownerUid) {
      throw failure('RUNTIME_TASK_GATE_SCOPE_MISMATCH');
    }
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.queue.then(run);
    this.queue = result.then(() => { this.pending--; }, () => { this.pending--; });
    return result;
  }

  private captureOpen() {
    try {
      const value = this.canJoin();
      if (typeof value !== 'boolean') throw failure('RUNTIME_TASK_CAPTURE_FENCE_UNPROVEN');
      return value;
    } catch (error) { this.poisoned = true; throw error; }
  }

  async acquire(): Promise<{ release(): Promise<void> }> {
    this.waiting++;
    try {
      for (;;) {
        if (this.stopping || this.poisoned) throw failure('RUNTIME_TASK_ADMISSION_CLOSED');
        // Wait OUTSIDE the serialized queue: existing completions must remain
        // able to settle their epoch while a capture waits for the gate.
        if (!this.captureOpen()) { await new Promise(resolve => setTimeout(resolve, 10)); continue; }
        const admitted = await this.enqueue(async () => {
          if (this.stopping || this.poisoned) throw failure('RUNTIME_TASK_ADMISSION_CLOSED');
          this.assertOwner();
          if (!this.captureOpen()) return undefined;
          if (!this.group) {
            const lease = await this.gate.acquire();
            const open = this.captureOpen();
            if (this.stopping || !open) {
              try { lease.release(); } catch (error) { this.poisoned = true; throw error; }
              if (this.stopping) throw failure('RUNTIME_TASK_ADMISSION_CLOSED');
              return undefined;
            }
            let retired = false;
            try {
              const epoch = await this.journal.activate();
              this.group = { lease, epoch, references: new Set() };
              let join: boolean;
              try {
                this.assertOwner();
                if (this.stopping) throw failure('RUNTIME_TASK_ADMISSION_CLOSED');
                join = this.captureOpen();
              } catch (error) {
                await this.journal.settle(epoch); lease.release(); this.group = undefined; retired = true; throw error;
              }
              if (!join) {
                // A pause published during async fsync cannot admit a body.
                // Retire only this proven unstarted epoch, then wait outside.
                await this.journal.settle(epoch); lease.release(); this.group = undefined; retired = true;
                return undefined;
              }
            } catch (error) {
              // Unknown publication retains the gate and poisons admission.
              if (!retired) this.poisoned = true;
              throw error;
            }
          }
          const group = this.group!, reference = Symbol(); group.references.add(reference);
          return { release: () => this.enqueue(async () => {
            if (this.group !== group || !group.references.delete(reference)) throw failure('RUNTIME_TASK_REFERENCE_NOT_OWNED');
            if (group.references.size) return;
            try {
              await this.journal.settle(group.epoch);
              group.lease.release(); this.group = undefined;
            } catch (error) { this.poisoned = true; throw error; }
          }) };
        });
        if (admitted) return admitted;
      }
    } finally { this.waiting--; }
  }

  async stopAndDrain(timeoutMs: number) {
    this.stopping = true;
    const deadline = performance.now() + timeoutMs;
    while ((this.waiting || this.pending || this.group) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    if (this.waiting || this.pending || this.group || this.poisoned) throw failure('RUNTIME_TASK_DRAIN_UNPROVEN');
    await this.gate.drain(Math.max(0, deadline - performance.now()));
  }
}
