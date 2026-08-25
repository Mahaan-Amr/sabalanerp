import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  createFinancialApprovalTransactionRunner,
  FINANCIAL_APPROVAL_TRANSACTION_OPTIONS,
} from '../financialApprovalTransaction';

assert.deepEqual(FINANCIAL_APPROVAL_TRANSACTION_OPTIONS, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 120_000,
});

assert.ok(
  FINANCIAL_APPROVAL_TRANSACTION_OPTIONS.timeout > 5_000,
  'financial approval must not inherit Prisma interactive transaction default timeout',
);

const verifyRunnerWiring = async () => {
  let receivedOptions: unknown;
  const runFinancialApprovalTransaction = createFinancialApprovalTransactionRunner({
    $transaction: async (operation, options) => {
      receivedOptions = options;
      return operation({} as Prisma.TransactionClient);
    },
  });

  const result = await runFinancialApprovalTransaction(async () => 'committed');
  assert.equal(result, 'committed');
  assert.deepEqual(receivedOptions, FINANCIAL_APPROVAL_TRANSACTION_OPTIONS);
};

verifyRunnerWiring()
  .then(() => console.log('Accounting financial approval transaction policy tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
