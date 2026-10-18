import { AsyncLocalStorage } from 'node:async_hooks';
import { RuntimeWorkContext } from './runtimeWorkContext';
import type { RuntimeTaskAdmission } from './runtimeTaskAdmission';

type LeasedWork = { active: boolean; pending: Set<Promise<unknown>> };
const fail = () => Object.assign(new Error('RUNTIME_LEASED_WORK_NOT_ACTIVE'), { code: 'RUNTIME_LEASED_WORK_NOT_ACTIVE' });

/** Share an actual acquired request reference with nested storage work. A
 * caller cannot supply a fabricated lease: this owner acquires it itself.
 * Request completion still belongs to HttpRequestLifecycle; release waits for
 * even ignored nested promises before releasing the real admission reference. */
export class RuntimeLeasedWorkContext extends RuntimeWorkContext {
  private readonly leasedStorage = new AsyncLocalStorage<LeasedWork>();

  constructor(private readonly admission: RuntimeTaskAdmission, private readonly owner: () => void) {
    super(admission, owner);
  }

  override assertActive() {
    const work = this.leasedStorage.getStore();
    if (!work?.active) return super.assertActive();
    this.owner();
  }

  override run<T>(body: () => Promise<T>): Promise<T> {
    const work = this.leasedStorage.getStore();
    if (!work?.active) return super.run(body);
    const child = Promise.resolve().then(() => { this.owner(); return body(); });
    work.pending.add(child);
    void child.then(() => work.pending.delete(child), () => work.pending.delete(child));
    return child;
  }

  async acquireOwned() {
    this.owner();
    const lease = await this.admission.acquire();
    try { this.owner(); }
    catch (error) { await lease.release(); throw error; }
    const work: LeasedWork = { active: true, pending: new Set() };
    let releasing = false;
    const invoke = <T>(body: () => T, reserved = false): T => {
      if (!work.active || (!reserved && releasing && this.leasedStorage.getStore() !== work)) throw fail();
      this.owner();
      return this.leasedStorage.run(work, () => {
        const value = body();
        if (value !== null && value !== undefined && typeof (value as any).then === 'function') {
          const observed = Promise.resolve(value);
          work.pending.add(observed);
          void observed.then(() => work.pending.delete(observed), () => work.pending.delete(observed));
        }
        return value;
      });
    };
    return {
      run: <T>(body: () => T): T => invoke(body),
      reserve: () => {
        // A future callback is reserved by an already admitted descendant,
        // never by an external late callback reviving an answered request.
        if (!work.active || this.leasedStorage.getStore() !== work) throw fail();
        this.owner();
        let complete!: () => void, released = false;
        const marker = new Promise<void>(resolve => { complete = resolve; });
        work.pending.add(marker);
        return {
          run: <T>(body: () => T): T => { if (released) throw fail(); return invoke(body, true); },
          release: () => {
            if (released) throw fail();
            released = true; work.pending.delete(marker); complete();
          },
        };
      },
      release: async () => {
        if (!work.active || releasing) throw fail();
        releasing = true;
        while (work.pending.size) await Promise.allSettled([...work.pending]);
        work.active = false;
        await lease.release();
      },
    };
  }
}
