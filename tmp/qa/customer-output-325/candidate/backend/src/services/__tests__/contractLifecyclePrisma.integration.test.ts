import assert from 'node:assert/strict';
import { AccountingRecordStatus, AccountingSourceKind, ContractStatus, FinancialRecordKind } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ContractLifecycleBlockedError, executeContractLifecycleAction } from '../contractLifecycleService';

const marker = `qa-contract-lifecycle-${Date.now()}`;

const run = async () => {
  const [actor, customer, department] = await Promise.all([
    prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.crmCustomer.findFirst({ orderBy: { createdAt: 'asc' } }),
    prisma.department.findFirst({ orderBy: { createdAt: 'asc' } }),
  ]);
  assert.ok(actor && customer && department, 'local QA database must contain an actor, customer, and department');

  const createFixture = (suffix: string) => prisma.salesContract.create({
    data: {
      contractNumber: `${marker}-${suffix}`,
      title: `Lifecycle QA ${suffix}`,
      titlePersian: `آزمون چرخه قرارداد ${suffix}`,
      content: 'isolated lifecycle QA fixture',
      status: ContractStatus.DRAFT,
      customerId: customer.id,
      departmentId: department.id,
      createdBy: actor.id,
      responsibleSellerId: actor.id,
    },
  });

  const deletable = await createFixture('deletable');
  const blocked = await createFixture('blocked');
  await prisma.accountingFinancialRecord.create({
    data: {
      kind: FinancialRecordKind.INVOICE_CANDIDATE,
      status: AccountingRecordStatus.DRAFT,
      sourceKind: AccountingSourceKind.SALES_CONTRACT,
      sourceId: blocked.id,
      contractId: blocked.id,
      customerId: customer.id,
      createdBy: actor.id,
    },
  });

  try {
    await executeContractLifecycleAction({
      contractId: deletable.id,
      action: 'DELETE',
      reason: 'آزمون مسیر موفق حذف دائمی',
      actorId: actor.id,
    });
    assert.equal(await prisma.salesContract.findUnique({ where: { id: deletable.id } }), null,
      'successful hard deletion must remove the contract row from PostgreSQL');

    await assert.rejects(
      executeContractLifecycleAction({
        contractId: blocked.id,
        action: 'DELETE',
        reason: 'آزمون مسدود شدن حذف وابسته',
        actorId: actor.id,
      }),
      (error: unknown) => error instanceof ContractLifecycleBlockedError &&
        error.blockers.some((blocker) => blocker.code === 'FINANCIAL_DOCUMENTS' && blocker.details?.some((detail) => detail.kind === 'FINANCIAL_INVOICE_CANDIDATE')),
    );
    assert.ok(await prisma.salesContract.findUnique({ where: { id: blocked.id } }),
      'blocked hard deletion must preserve the contract row in PostgreSQL');
  } finally {
    await prisma.accountingFinancialRecord.deleteMany({ where: { contractId: { in: [deletable.id, blocked.id] } } });
    await prisma.accountingAuditLog.deleteMany({ where: { contractId: { in: [deletable.id, blocked.id] } } });
    await prisma.contractLifecycleRequest.deleteMany({ where: { contractId: { in: [deletable.id, blocked.id] } } });
    await prisma.salesContract.deleteMany({ where: { id: { in: [deletable.id, blocked.id] } } });
  }
};

run()
  .then(() => console.log('Contract lifecycle Prisma integration test passed.'))
  .finally(() => prisma.$disconnect());
