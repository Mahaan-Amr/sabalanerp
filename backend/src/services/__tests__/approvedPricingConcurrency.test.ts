import assert from 'node:assert/strict';
import { AccountingRecordStatus, FinancialRecordKind, Prisma, PrismaClient } from '@prisma/client';
import { lockFinancialApprovalRecord } from '../approvedPricing/approvalLock';

const firstClient = new PrismaClient();
const secondClient = new PrismaClient();
const firstRollback = Symbol('first approval rollback');
const secondRollback = Symbol('second approval rollback');

const expectRollback = async (work: Promise<unknown>, marker: symbol) => {
  try {
    await work;
    assert.fail('Concurrent approval transaction must roll back');
  } catch (error) {
    if (error !== marker) throw error;
  }
};

const run = async () => {
  const candidate = await firstClient.accountingFinancialRecord.findFirst({
    where: { kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.DRAFT },
    orderBy: { createdAt: 'asc' },
  });
  assert(candidate, 'Local integration database needs one draft accounting record');

  let firstLocked!: () => void;
  const firstHasLock = new Promise<void>(resolve => { firstLocked = resolve; });
  let releaseFirst!: () => void;
  const firstMayRollback = new Promise<void>(resolve => { releaseFirst = resolve; });
  let secondAttempted!: () => void;
  const secondIsWaiting = new Promise<void>(resolve => { secondAttempted = resolve; });
  let secondObservedStatus: AccountingRecordStatus | null = null;

  const first = firstClient.$transaction(async tx => {
    await lockFinancialApprovalRecord(tx, candidate.id);
    await tx.accountingFinancialRecord.update({
      where: { id: candidate.id },
      data: { status: AccountingRecordStatus.ISSUED, financiallyApprovedAt: new Date(), financiallyApprovedBy: candidate.createdBy },
    });
    firstLocked();
    await firstMayRollback;
    throw firstRollback;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await firstHasLock;
  const second = secondClient.$transaction(async tx => {
    secondAttempted();
    await lockFinancialApprovalRecord(tx, candidate.id);
    const afterFirstRollback = await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: candidate.id } });
    secondObservedStatus = afterFirstRollback.status;
    await tx.accountingFinancialRecord.update({
      where: { id: candidate.id },
      data: { status: AccountingRecordStatus.ISSUED, financiallyApprovedAt: new Date(), financiallyApprovedBy: candidate.createdBy },
    });
    throw secondRollback;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await secondIsWaiting;
  releaseFirst();
  await Promise.all([expectRollback(first, firstRollback), expectRollback(second, secondRollback)]);

  assert.equal(secondObservedStatus, candidate.status, 'Second approval must read only after acquiring the same row lock');
  const preserved = await firstClient.accountingFinancialRecord.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal(preserved.status, candidate.status);
  assert.equal(preserved.financiallyApprovedAt?.toISOString() ?? null, candidate.financiallyApprovedAt?.toISOString() ?? null);
  assert.equal(preserved.financiallyApprovedBy, candidate.financiallyApprovedBy);
  console.log('approved pricing two-connection approval race rollback: ok');
};

run().finally(async () => {
  await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
});
