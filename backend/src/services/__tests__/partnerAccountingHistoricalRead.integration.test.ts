import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';


for (const writerBound of [false, true]) {
test(`real-schema authenticated Accounting reads preserve ${writerBound ? 'writer-bound nonempty v4 invoice with later v5 plan' : 'v3 invoice with valid v4 plan'}`, async () => {
  const source = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert.equal(source.hostname, '127.0.0.1'); assert.equal(source.port, '55432'); assert.equal(source.pathname, '/sabalanerp');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: process.cwd(), sourceDatabaseUrl: source.toString() });
  const database = temporary.client();
  try {
    await seedHistoricalAccountingRead(database, undefined, writerBound);
    const financialHistory = async () => ({
      records: await database.accountingFinancialRecord.findMany({ orderBy: { id: 'asc' } }),
      revisions: await database.partnerCaseRevision.findMany({ orderBy: [{ caseId: 'asc' }, { revision: 'asc' }] }),
      plans: await database.partnerPaymentPlan.findMany({ orderBy: { id: 'asc' } }),
      receivables: await database.accountingReceivable.findMany({ orderBy: { id: 'asc' } }),
      payments: await database.accountingPaymentStatus.findMany({ orderBy: { id: 'asc' } }),
      taxes: await database.accountingTaxRecord.findMany({ orderBy: { id: 'asc' } }),
      audit: await database.accountingAuditLog.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await financialHistory();
    const script = `
      import assert from 'node:assert/strict';
      import { listAccountingContracts, listFinancialRecords, listReceivables, listPaymentStatuses,
        listTaxRecords, listAuditLogs, getAccountingWorkspace, getAccountingDashboard } from './backend/src/services/accountingService';
      import { prisma } from './backend/src/lib/prisma';
      (async () => { try {
        const actor = { userId: 'historical-admin' };
        const records = await listFinancialRecords({}, actor);
        assert.ok(JSON.stringify(records).includes('historical-invoice'));
        for (const read of [listReceivables, listPaymentStatuses, listTaxRecords, listAuditLogs]) await read({}, actor);
        await listAccountingContracts({ view: 'reviewable' }, actor);
        const workspace = await getAccountingWorkspace({}, actor);
        assert.ok(JSON.stringify(workspace).includes('historical-invoice'));
        const dashboard = await getAccountingDashboard({}, '6m', new Date(), actor);
        assert.ok(JSON.stringify(dashboard).includes('historical-invoice'));
        console.log('authenticated lists and dashboard passed');
      } finally { await prisma.$disconnect(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });`;
    const result = execFileSync(process.execPath, [path.resolve('backend/node_modules/tsx/dist/cli.mjs'), '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 90_000, env: { ...process.env, DATABASE_URL: temporary.databaseUrl } });
    assert.match(result, /authenticated lists and dashboard passed/);
    assert.deepEqual(await financialHistory(), before, 'reads preserve all financial rows, revision history, plans and accounting audit');
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});
}
