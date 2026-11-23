import { AsyncLocalStorage } from 'node:async_hooks';

type AccountingReadPhase = 'lockWait' | 'authorization' | 'population' | 'rowHydration';
export type AccountingReadTimings = Partial<Record<AccountingReadPhase, number>>;

export const accountingReadTiming = new AsyncLocalStorage<AccountingReadTimings>();

export function startAccountingReadPhase(phase: AccountingReadPhase): () => void {
  const timings = accountingReadTiming.getStore();
  if (!timings) return () => {};
  const startedAt = performance.now();
  return () => {
    timings[phase] = (timings[phase] ?? 0) + (performance.now() - startedAt);
  };
}

export async function measureAccountingReadPhase<T>(phase: AccountingReadPhase, read: () => Promise<T>): Promise<T> {
  const finish = startAccountingReadPhase(phase);
  try {
    return await read();
  } finally {
    finish();
  }
}
