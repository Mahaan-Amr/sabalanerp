import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;

test('reviewable pages read historical dates for visible ordinary contracts and preserve date fallbacks', {
  skip: !sourceDatabaseUrl, timeout: 240_000,
}, async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve('.'), sourceDatabaseUrl: sourceDatabaseUrl! });
  const originalUrl = process.env.DATABASE_URL;
  const readerUrl = new URL(temporary.databaseUrl);
  readerUrl.searchParams.set('connection_limit', '1');
  readerUrl.searchParams.set('pool_timeout', '3');
  process.env.DATABASE_URL = readerUrl.toString();
  try {
    const { prisma } = await import('../../lib/prisma');
    try {
      const { listAccountingContracts, getAccountingDashboard, getAccountingDashboardChange, getAccountingFinancialTrend } = await import('../accountingService');
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

      const writer = temporary.client();
      try {
        let written = false;
        prisma.$use(async (params, next) => {
          const result = await next(params);
          if (!written && params.model === 'SalesContract' && params.action === 'findMany') {
            written = true;
            await writer.salesContract.update({ where: { id: 'contract-0' }, data: {
              totalAmount: 199, contractData: { contractDate: '2026-03-20' },
            } });
          }
          return result;
        });
        const page = () => listAccountingContracts({ view: 'reviewable', sort: 'work_queue', sourceKind: 'SALES_CONTRACT' });
        const during = await page();
        assert.ok(written, 'the concurrent update committed after the review headers were selected');
        const changed = (rows: typeof during.items) => rows.find(row => row.contractId === 'contract-0');
        assert.equal(during.totals.contractAmount, '500');
        assert.equal(changed(during.items)?.contractDate.toISOString(), '2024-03-20T00:00:00.000Z',
          'reviewable dates and financial totals describe the same committed contract version');
        const after = await page();
        assert.equal(after.totals.contractAmount, '599');
        assert.equal(changed(after.items)?.contractDate.toISOString(), '2026-03-20T00:00:00.000Z');
      } finally { await writer.$disconnect(); }
      await prisma.salesContract.update({ where: { id: 'contract-0' }, data: { status: 'CANCELLED' } });
      const reader = { userId: actor.id };
      const review = await listAccountingContracts({ view: 'reviewable' }, reader);
      assert.equal(review.totals.contractAmount, '599');
      const [databaseClock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const historicalTime = new Date('2000-01-15T12:00:00.000Z');
      mock.timers.enable({ apis: ['Date'], now: historicalTime });
      const dashboard = await getAccountingDashboard({}, '1m', undefined, reader).finally(() => mock.timers.reset());
      assert.equal(dashboard.trendError, false, 'the dashboard can read cancelled ordinary rows using one connection');
      assert.equal(dashboard.workspace.period.code,
        `${databaseClock.now.getFullYear()}-${String(databaseClock.now.getMonth() + 1).padStart(2, '0')}`);
      assert.ok(Date.parse(dashboard.trend!.points.at(-1)!.endsAt) >= databaseClock.now.getTime());
      assert.ok('revisions' in dashboard && dashboard.revisions);
      const revisions = dashboard.revisions;
      const change = await getAccountingDashboardChange({ range: '1m', accessRevision: revisions.access,
        workspaceRevision: revisions.workspace, trendRevision: revisions.trend }, reader);
      assert.equal(change.workspaceChanged, false, 'moving the application clock across calendar days cannot advance the revision');
      assert.equal(change.trendChanged, false);
      const historical = await getAccountingFinancialTrend('1m', historicalTime, reader);
      assert.equal(historical.points.at(-1)!.endsAt, historicalTime.toISOString());
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await temporary.cleanup();
  }
});
