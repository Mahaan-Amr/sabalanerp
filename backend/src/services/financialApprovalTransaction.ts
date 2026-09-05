import { Prisma } from '@prisma/client';

export const FINANCIAL_APPROVAL_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 120_000,
} as const;

type FinancialApprovalOperation<T> = (tx: Prisma.TransactionClient) => Promise<T>;

type FinancialApprovalTransactionClient = {
  $transaction<T>(
    operation: FinancialApprovalOperation<T>,
    options: typeof FINANCIAL_APPROVAL_TRANSACTION_OPTIONS,
  ): Promise<T>;
};

export const createFinancialApprovalTransactionRunner = (
  client: FinancialApprovalTransactionClient,
  retrySerialization?: () => boolean,
) => async <T>(operation: FinancialApprovalOperation<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try { return await client.$transaction(operation, FINANCIAL_APPROVAL_TRANSACTION_OPTIONS); }
    catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } };
      if (attempt >= 1 || !retrySerialization?.() ||
          (failure.code !== 'P2034' && failure.meta?.code !== '40001')) throw error;
    }
  }
};
