import { AsyncLocalStorage } from 'node:async_hooks';

type Provider = 'population' | 'partnerInquiry' | 'customerTransfer' | 'dispatch' | 'performance'
  | 'purchasing' | 'workspaceFeature' | 'support' | 'hrDuty';
type Phase = 'queries' | 'transaction' | 'evidence' | 'authority' | 'queue';
type Code = `P${number}` | 'NOTIFICATION_READ_FAILED';
type Sample = { calls: number; durationMs: number; errorCode?: Code };

export const notificationReadObservation = new AsyncLocalStorage<Partial<Record<`${Provider}.${Phase}`, Sample>>>();

export function notificationReadErrorCode(error: unknown): Code {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code as Code : 'NOTIFICATION_READ_FAILED';
}

export async function measureNotificationRead<T>(provider: Provider, phase: Phase, read: () => Promise<T>): Promise<T> {
  const observation = notificationReadObservation.getStore();
  if (!observation) return read();
  const key = `${provider}.${phase}` as const;
  const sample = observation[key] ??= { calls: 0, durationMs: 0 };
  const started = performance.now();
  sample.calls++;
  try {
    return await read();
  } catch (error) {
    sample.errorCode = notificationReadErrorCode(error);
    throw error;
  } finally {
    sample.durationMs += performance.now() - started;
  }
}

// Local and production pools default to ten connections. Limit the protected
// providers across overlapping count and preview reads in the same process.
const available = 2;
let running = 0;
const waiters: Array<() => void> = [];

export async function withNotificationReadSlot<T>(provider: Provider, read: () => Promise<T>): Promise<T> {
  if (running === available) {
    await measureNotificationRead(provider, 'queue', () => new Promise<void>(resolve => waiters.push(resolve)));
  } else {
    running++;
  }
  try {
    return await read();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else running--;
  }
}
