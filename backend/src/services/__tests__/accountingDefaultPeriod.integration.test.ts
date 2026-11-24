import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

test('two first workspace readers receive the same new period', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: process.cwd(),
    sourceDatabaseUrl: process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL! });
  const originalUrl = process.env.DATABASE_URL;
  const url = new URL(temporary.databaseUrl);
  url.searchParams.set('connection_limit', '2');
  process.env.DATABASE_URL = url.toString();
  try {
    const { prisma } = await import('../../lib/prisma');
    try {
      const { getAccountingWorkspace } = await import('../accountingService');
      await prisma.accountingSetting.create({ data: { requiredTaxFields: [] } });
      let reads = 0;
      let release!: () => void;
      const bothReading = new Promise<void>(resolve => { release = resolve; });
      prisma.$use(async (query, next) => {
        const result = await next(query);
        if (query.model === 'AccountingPeriod' && query.action === 'findUnique' && !result && reads < 2) {
          if (++reads === 2) release();
          await bothReading;
        }
        return result;
      });
      const instant = new Date('2052-05-15T00:00:00Z');
      const responses = await Promise.allSettled([getAccountingWorkspace({}, undefined, instant),
        getAccountingWorkspace({}, undefined, instant)]);
      const periods = responses.map(result => {
        if (result.status === 'rejected') throw result.reason;
        return result.value.period;
      });
      assert.deepEqual(periods[0], periods[1]);
      assert.equal(await prisma.accountingPeriod.count(), 1);
      const read = async (iso: string) => (await getAccountingWorkspace({}, undefined, new Date(iso))).period;
      const may = await read('2052-05-31T20:29:59.999Z');
      const june = await read('2052-05-31T20:30:00.000Z');
      assert.equal(may.code, '2052-05');
      assert.equal(june.code, '2052-06');
      assert.equal(may.endsAt.toISOString(), '2052-05-31T20:29:59.999Z');
      assert.equal(june.startsAt.toISOString(), '2052-05-31T20:30:00.000Z');
      assert.equal(june.endsAt.toISOString(), '2052-06-30T20:29:59.999Z');
      const retainedStart = new Date('2052-06-01T00:00:00Z');
      await prisma.accountingPeriod.update({ where: { id: june.id }, data: { startsAt: retainedStart } });
      assert.equal((await read('2052-06-15T00:00:00Z')).startsAt.toISOString(), retainedStart.toISOString());
    } finally { await prisma.$disconnect(); }
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await temporary.cleanup();
  }
});
