import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;

test('reviewable pages read historical dates for visible ordinary contracts and preserve date fallbacks', {
  skip: !sourceDatabaseUrl, timeout: 240_000,
}, async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve('.'), sourceDatabaseUrl: sourceDatabaseUrl! });
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = temporary.databaseUrl;
  try {
    const { prisma } = await import('../../lib/prisma');
    try {
      const { listAccountingContracts } = await import('../accountingService');
      const actor = await prisma.user.create({ data: { username: 'date-reader', email: 'date@example.invalid',
        firstName: 'Date', lastName: 'Reader', password: 'fixture' } });
      const department = await prisma.department.create({ data: { name: 'Sales', namePersian: 'فروش' } });
      const customer = await prisma.crmCustomer.create({ data: { firstName: 'Date', lastName: 'Customer' } });
      const createdAt = new Date('2025-05-01T00:00:00Z');
      const signedAt = new Date('2023-04-01T00:00:00Z');
      const samples = [
        { contractData: { contractDate: '۱۴۰۳/۰۱/۰۱', date: '2000-01-01' }, signedAt, expected: '2024-03-20' },
        { contractData: { contractDate: 'invalid', date: '2021-02-03' }, signedAt, expected: '2021-02-03' },
        { contractData: { date: 'invalid', contract: { date: '2022-03-04' } }, signedAt, expected: '2022-03-04' },
        { contractData: 'legacy scalar', signedAt, expected: '2023-04-01' },
        { contractData: {}, signedAt: null, expected: '2025-05-01' },
      ];
      for (const [index, sample] of samples.entries()) {
        const id = `contract-${index}`;
        await prisma.salesContract.create({ data: { id, contractNumber: id, title: id, titlePersian: id, content: '',
          customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
          totalAmount: 100, currency: 'IRR', createdAt, signedAt: sample.signedAt, contractData: sample.contractData } });
      }

      const dateReadIds: string[] = [];
      prisma.$use(async (params, next) => {
        const result = await next(params);
        if (params.action === 'queryRaw' && Array.isArray(result)) {
          for (const row of result) if (row && 'contractData' in row) dateReadIds.push(row.id);
        }
        return result;
      });
      for (const sort of ['attention', 'work_queue']) {
        const query = { view: 'reviewable', sort, sourceKind: 'SALES_CONTRACT' as const };
        const reference = await listAccountingContracts({ ...query, dateFrom: '1900-01-01' });
        assert.equal(reference.total, samples.length);
        assert.deepEqual(reference.totals, { contractAmount: '500', receivedAmount: '0', invoicedAmount: '0', remainingAmount: '500' });
        for (const page of [1, 2, 3, 4]) {
          dateReadIds.length = 0;
          const result = await listAccountingContracts({ ...query, page, pageSize: 2 });
          const visible = reference.items.slice(2 * (page - 1), 2 * page);
          assert.deepEqual(result.items, visible);
          assert.equal(result.total, reference.total);
          assert.deepEqual(result.totals, reference.totals);
          assert.deepEqual(dateReadIds.sort(), visible.map(row => row.contractId).sort(),
            'the historical date projection must read only visible ordinary contract IDs');
        }
        for (const [index, sample] of samples.entries()) {
          const row = reference.items.find(item => item.contractId === `contract-${index}`);
          assert.equal(row?.contractDate?.toISOString(), `${sample.expected}T00:00:00.000Z`);
        }
      }
      const search = await listAccountingContracts({ view: 'reviewable', search: '2022-03-04', pageSize: 1 });
      assert.deepEqual(search.items.map(row => row.contractId), ['contract-2']);
      const filtered = await listAccountingContracts({ view: 'reviewable', dateFrom: '2021-02-03', dateTo: '2021-02-03', pageSize: 1 });
      assert.deepEqual(filtered.items.map(row => row.contractId), ['contract-1']);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await temporary.cleanup();
  }
});
