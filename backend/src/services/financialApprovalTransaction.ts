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
) => <T>(operation: FinancialApprovalOperation<T>) => client.$transaction(
  operation,
  FINANCIAL_APPROVAL_TRANSACTION_OPTIONS,
);
