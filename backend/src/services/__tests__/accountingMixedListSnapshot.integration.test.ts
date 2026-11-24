import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';


test('one-connection mixed list reads both flag counts before or after the same commit', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: process.cwd(),
    sourceDatabaseUrl: process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL! });
  const writer = temporary.client();
  const previousUrl = process.env.DATABASE_URL;
  const readerUrl = new URL(temporary.databaseUrl);
  readerUrl.searchParams.set('connection_limit', '1');
  readerUrl.searchParams.set('pool_timeout', '2');
  process.env.DATABASE_URL = readerUrl.toString();
  try {
    const { prisma } = await import('../../lib/prisma');
    try {
      const { listAccountingContracts } = await import('../accountingService');
      const { seedHistoricalAccountingRead } = await import('./partnerAccountingHistoricalReadSeed');
      const { actorId, fixture } = await seedHistoricalAccountingRead(writer);
      await writer.crmCustomerCard.create({ data: { customerId: 'historical-customer' } });
      const ordinary = await writer.salesContract.create({ data: { contractNumber: 'mixed-ordinary',
        title: 'Ordinary', titlePersian: 'عادی', content: '', customerId: 'historical-customer',
        departmentId: 'historical-department', createdBy: actorId, responsibleSellerId: actorId } });
      let written = false;
      prisma.$use(async (params, next) => {
        const rows = await next(params);
        if (!written && params.model === 'AccountingContractFlag' && params.action === 'findMany'
          && params.args.where?.sourceFinancialRecordId?.in?.includes(fixture.invoice.id)) {
          written = true;
          const flag = { category: 'OTHER' as const, title: 'Concurrent review', createdBy: actorId };
          await writer.accountingContractFlag.createMany({ data: [
            { ...flag, contractId: ordinary.id },
            { ...flag, contractId: fixture.row.customerContractId, sourceFinancialRecordId: fixture.invoice.id },
          ] });
        }
        return rows;
      });
      const counts = async () => {
        const page = await listAccountingContracts({}, { userId: actorId });
        return [ordinary.id, 'partner:' + fixture.invoice.id].map(id =>
          page.items.find(row => row.contractId === id)?.accounting.openFlags);
      };
      const during = await counts();
      assert.ok(written);
      assert.deepEqual(during, [0, 0]);
      assert.deepEqual(await counts(), [1, 1]);
    } finally { await prisma.$disconnect(); }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await writer.$disconnect();
    await temporary.cleanup();
  }
});
