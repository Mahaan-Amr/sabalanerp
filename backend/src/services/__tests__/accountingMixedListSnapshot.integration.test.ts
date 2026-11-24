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
      const { getAccountingDashboard, listAccountingContracts } = await import('../accountingService');
      const { accountingReadTiming } = await import('../accountingReadTiming');
      const { seedHistoricalAccountingRead } = await import('./partnerAccountingHistoricalReadSeed');
      const { actorId, fixture } = await seedHistoricalAccountingRead(writer);
      await writer.crmCustomerCard.create({ data: { customerId: 'historical-customer' } });
      const ordinary = await writer.salesContract.create({ data: { contractNumber: 'mixed-ordinary',
        title: 'Ordinary', titlePersian: 'عادی', content: '', customerId: 'historical-customer',
        departmentId: 'historical-department', createdBy: actorId, responsibleSellerId: actorId,
        status: 'SIGNED', totalAmount: '10.05', currency: '\u00a0ToMaN\ufeff' } });
      let written = false;
      let partnerInvoiceReads = 0;
      prisma.$use(async (params, next) => {
        if (params.model === 'AccountingFinancialRecord' && params.action === 'findMany'
          && (params.args.where?.sourceKind === 'PARTNER_INTERNAL_RECORD' ||
            params.args.where?.AND?.some((predicate: { sourceKind?: string }) => predicate.sourceKind === 'PARTNER_INTERNAL_RECORD'))) {
          partnerInvoiceReads++;
        }
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
        const page = await listAccountingContracts({ view: 'reviewable' }, { userId: actorId });
        return [ordinary.id, 'partner:' + fixture.invoice.id].map(id =>
          page.items.find(row => row.contractId === id)?.accounting.openFlags);
      };
      const during = await counts();
      assert.ok(written);
      assert.deepEqual(during, [0, 0]);
      partnerInvoiceReads = 0;
      assert.deepEqual(await counts(), [1, 1]);
      assert.equal(partnerInvoiceReads, 1, 'the register reuses the invoice population that its scope already verified');

      const baseInvoice = { contractId: ordinary.id, sourceId: ordinary.id, amount: '10.50',
        kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', createdBy: actorId } as const;
      const visible = await writer.accountingFinancialRecord.create({ data: { ...baseInvoice, status: 'ISSUED',
        sourceSnapshot: { partnerCaseId: null, ordinary: true } } });
      const hidden = await writer.accountingFinancialRecord.create({ data: { ...baseInvoice, amount: '3000.50',
        sourceSnapshot: { partnerCaseId: null, retained: { partnerCaseId: null } } } });
      const privateReceivable = await writer.accountingReceivable.create({ data: { contractId: ordinary.id,
        invoiceRecordId: hidden.id, originalAmount: '3000.50', remainingAmount: '3000.50', dueDate: new Date('2020-01-01'),
        createdBy: actorId } });
      const payment = { contractId: ordinary.id, method: 'CASH', status: 'RECEIVED', createdBy: actorId } as const;
      await writer.accountingPaymentStatus.createMany({ data: [
        { ...payment, amount: '5.51' },
        { ...payment, amount: 7000, receivableId: privateReceivable.id },
        { ...payment, amount: 8000, metadata: { nested: [null, { financialEvidenceHash: false }] } },
      ] });
      await writer.accountingContractFlag.create({ data: { contractId: ordinary.id, category: 'OTHER', title: 'Private source',
        sourceFinancialRecordId: hidden.id, severity: 'BLOCKER', createdBy: actorId } });
      await writer.accountingCorrectionRequest.create({ data: { contractId: ordinary.id, category: 'OTHER',
        recordId: hidden.id, accountantNote: 'Private correction', createdBy: actorId } });
      await writer.accountingTaxRecord.create({ data: { contractId: ordinary.id, submissionStatus: 'READY',
        invoiceRecordId: hidden.id, taxableAmount: 10, missingFields: [], createdBy: actorId } });
      for (const sort of ['attention', 'work_queue']) {
        const query = { view: 'reviewable', sort };
        const expected = await listAccountingContracts({ ...query, dateFrom: 'retain-entire-population' }, { userId: actorId });
        const actual = await accountingReadTiming.run({}, async () => {
          const result = await listAccountingContracts(query, { userId: actorId });
          assert.equal(accountingReadTiming.getStore()?.readWork?.reviewableSqlPages, 1);
          return result;
        });
        assert.deepEqual(actual, expected);
        assert.equal(actual.total, 2, 'the private retail Contract never becomes an ordinary row');
        const row = actual.items.find(item => item.contractId === ordinary.id);
        assert.deepEqual(row?.financialRecords.map((record: { id: string }) => record.id), [visible.id]);
        assert.equal(row?.accounting.totalContractAmount, '101');
        assert.equal(row?.accounting.invoicedAmount, '11');
        assert.equal(row?.accounting.receivedAmount, '6');
        assert.equal(row?.accounting.remainingAmount, '95');
        assert.equal(row?.accounting.openFlags, 1);
        assert.equal(row?.accounting.openCorrections, 0);
        assert.equal(row?.accounting.receivableStatus, 'NONE');
        assert.equal(row?.accounting.taxStatus, 'NOT_READY');
      }
      const partnerInvoice = await writer.accountingFinancialRecord.findUniqueOrThrow({ where: { id: fixture.invoice.id } });
      await writer.accountingFinancialRecord.createMany({ data: [
        { ...partnerInvoice, id: 'mixed-partner-voided', status: 'VOIDED', voidedAt: new Date(),
          createdAt: new Date(partnerInvoice.createdAt.getTime() - 1000), idempotencyKey: null,
          sourceSnapshot: partnerInvoice.sourceSnapshot ?? undefined, metadata: partnerInvoice.metadata ?? undefined },
        { ...partnerInvoice, id: 'mixed-partner-noncandidate', kind: 'PAYMENT_RECEIPT', idempotencyKey: null,
          sourceSnapshot: partnerInvoice.sourceSnapshot ?? undefined, metadata: partnerInvoice.metadata ?? undefined },
      ] });
      const actor = { userId: actorId };
      const reviewable = await listAccountingContracts({ view: 'reviewable' }, actor);
      assert.equal(reviewable.items.find(item => item.contractId === 'partner:mixed-partner-voided')?.accounting.invoiceStatus, 'VOIDED');
      assert.ok(!reviewable.items.some(item => item.contractId === 'partner:mixed-partner-noncandidate'));
      const dashboard = await getAccountingDashboard({}, '6m', undefined, actor);
      const queued = dashboard.workspace.queues.contracts.flatMap(row => row.financialRecords.map((record: { id: string }) => record.id));
      assert.ok(queued.includes(fixture.invoice.id));
      assert.ok(!queued.includes('mixed-partner-noncandidate'));
      assert.equal(dashboard.trendError, false);
      const assertAuthoritativeFallback = async () => {
        const query = { view: 'reviewable', page: 5, pageSize: 1 };
        const reference = await listAccountingContracts({ ...query, dateFrom: 'retain-entire-population' }, { userId: actorId });
        await accountingReadTiming.run({}, async () => {
          const actual = await listAccountingContracts(query, { userId: actorId });
          assert.deepEqual(actual, reference, 'the authoritative result still supplies exact totals on an empty page');
          assert.deepEqual(actual.items, []);
          assert.equal(accountingReadTiming.getStore()?.readWork?.reviewableExactnessFallbacks, 1);
        });
      };
      const legacyMarker = await writer.accountingPaymentStatus.create({ data: { ...payment, amount: 123456,
        metadata: { nested: [{ sourceKind: [['PARTNER_INTERNAL_RECORD']] }] } } });
      await assertAuthoritativeFallback();
      await writer.accountingPaymentStatus.delete({ where: { id: legacyMarker.id } });
      await writer.accountingFinancialRecord.createMany({ data: Array.from({ length: 101 }, () => ({
        ...baseInvoice, amount: '9999999999999999.99',
      })) });
      await assertAuthoritativeFallback();
    } finally { await prisma.$disconnect(); }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await writer.$disconnect();
    await temporary.cleanup();
  }
});
