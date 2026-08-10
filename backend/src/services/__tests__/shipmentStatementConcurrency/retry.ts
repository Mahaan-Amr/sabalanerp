import { Prisma, type PrismaClient } from '@prisma/client';
import type { ConcurrencyTrace } from './trace';

export const isRetryableConcurrencyError = (error: unknown): boolean => {
  const record = typeof error === 'object' && error ? error as { code?: unknown; meta?: { code?: unknown } } : {};
  const code = String(record.code ?? '');
  const databaseCode = String(record.meta?.code ?? '');
  if (error instanceof Prisma.PrismaClientKnownRequestError && code === 'P2034') return true;
  return code === '40001' || code === '40P01' || code === 'P2034'
    || databaseCode === '40001' || databaseCode === '40P01';
};

export const runSerializableWithRetry = async <T>(input: {
  client: PrismaClient;
  actor: string;
  scenario: string;
  trace: ConcurrencyTrace;
  work: (tx: Prisma.TransactionClient, attempt: number) => Promise<T>;
  maxAttempts?: number;
  retryWhen?: (error: unknown) => boolean;
}): Promise<T> => {
  const maxAttempts = input.maxAttempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = performance.now();
    try {
      const value = await input.client.$transaction(tx => input.work(tx, attempt), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      });
      input.trace.record({ scenario: input.scenario, actor: input.actor, phase: 'transaction', outcome: 'committed',
        detail: { attempt, durationMs: Number((performance.now() - started).toFixed(3)), databaseCode: null } });
      return value;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableConcurrencyError(error) || input.retryWhen?.(error) === true;
      input.trace.record({ scenario: input.scenario, actor: input.actor, phase: 'transaction',
        outcome: retryable ? 'retryable-abort' : 'failed', detail: { attempt, code: (error as { code?: string })?.code ?? null,
          databaseCode: (error as { meta?: { code?: string } })?.meta?.code ?? null,
          durationMs: Number((performance.now() - started).toFixed(3)) } });
      if (!retryable || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
};
