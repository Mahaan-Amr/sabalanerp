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
    await database.$transaction(async tx => {
      // Fixture construction follows the isolated historical seed's trigger policy.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.salesContract.create({ data: { id: 'ordinary-dashboard-fixture', contractNumber: 'ordinary-dashboard-fixture',
        title: 'Ordinary fixture', titlePersian: 'قرارداد آزمون', content: 'Fixture', customerId: 'historical-customer', departmentId: 'historical-department',
        createdBy: 'historical-admin', responsibleSellerId: 'historical-admin', totalAmount: '1.49', currency: '\tتومان\n',
        createdAt: new Date('2026-10-01T00:00:00Z') } });
      await tx.salesContract.create({ data: { id: 'ordinary-rounding-fixture', contractNumber: 'ordinary-rounding-fixture',
        title: 'Ordinary rounding', titlePersian: 'گرد کردن', content: 'Fixture', customerId: 'historical-customer', departmentId: 'historical-department',
        createdBy: 'historical-admin', responsibleSellerId: 'historical-admin', totalAmount: '2.50', currency: 'ریال',
        createdAt: new Date('2026-10-01T00:00:00Z') } });
      await tx.salesContract.create({ data: { id: 'ordinary-whitespace-fixture', contractNumber: 'ordinary-whitespace-fixture',
        title: 'Whitespace', titlePersian: 'فاصله', content: 'Fixture', customerId: 'historical-customer', departmentId: 'historical-department',
        createdBy: 'historical-admin', responsibleSellerId: 'historical-admin', totalAmount: '1.05', currency: '\u00a0ToMaN\u2029',
        createdAt: new Date('2026-10-01T00:00:00Z') } });
      for (const [id, contractId, amount] of [
        ['ordinary-invoice-1', 'ordinary-dashboard-fixture', '1.49'], ['ordinary-invoice-2', 'ordinary-rounding-fixture', '2.50'],
      ]) await tx.accountingFinancialRecord.create({ data: { id, contractId, sourceId: contractId, sourceKind: 'SALES_CONTRACT',
        kind: 'INVOICE_CANDIDATE', status: 'DRAFT', amount, currency: 'ریال', createdBy: 'historical-admin' } });
      for (const [id, contractId, amount] of [
        ['ordinary-payment-1', 'ordinary-dashboard-fixture', '0.49'], ['ordinary-payment-2', 'ordinary-rounding-fixture', '0.50'],
      ]) await tx.accountingPaymentStatus.create({ data: { id, contractId, method: 'CASH', status: 'RECEIVED', amount,
        currency: 'ریال', createdBy: 'historical-admin' } });
    });
    await database.accountingAuditLog.create({ data: { id: 'dashboard-audit-fixture', action: 'FIXTURE',
      actorId: 'historical-admin', beforeState: { evidence: 'before' }, afterState: { evidence: 'after' } } });
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
        const allContracts = await listAccountingContracts({ view: 'reviewable' }, actor);
        const partnerContracts = await listAccountingContracts({ view: 'reviewable', sourceKind: 'PARTNER_INTERNAL_RECORD' }, actor);
        const partnerRows = allContracts.items.filter(row => row.sourceKind === 'PARTNER_INTERNAL_RECORD');
        assert.ok(allContracts.items.some(row => row.contractId === 'ordinary-dashboard-fixture'));
        assert.ok(partnerRows.length > 0, 'fixture exposes an authorized Partner accounting row');
        assert.deepEqual(partnerContracts.items, partnerRows, 'Partner-only filter preserves authorized rows in a mixed population');
        assert.equal(partnerContracts.total, partnerRows.length);
        for (const sourceKind of ['ALL', 'SALES_CONTRACT']) for (const sort of [undefined, 'oldest']) for (const page of [1, 2, 3, 4, 5]) {
          const query = { sourceKind, sort, page, pageSize: 1 };
          const paged = await listAccountingContracts(query, actor);
          const complete = await listAccountingContracts({ ...query, view: 'all' }, actor);
          assert.deepEqual(paged, complete, 'database paging must match the complete-population path');
          if (sourceKind === 'SALES_CONTRACT') assert.deepEqual(paged.totals,
            { contractAmount: '29', invoicedAmount: '4', receivedAmount: '1', remainingAmount: '27' });
        }
        const workspace = await getAccountingWorkspace({}, actor);
        assert.ok(JSON.stringify(workspace).includes('historical-invoice'));
        const dashboard = await getAccountingDashboard({}, '6m', new Date(), actor);
        assert.ok(JSON.stringify(dashboard).includes('historical-invoice'));
        const invoice = dashboard.workspace.queues.invoiceCandidates.find(row => row.id === 'historical-invoice');
        assert.ok(invoice);
        assert.equal('sourceSnapshot' in invoice, false, 'dashboard must not transmit invoice snapshots');
        const fullInvoice = workspace.queues.invoiceCandidates.find(row => row.id === 'historical-invoice');
        assert.ok(fullInvoice && 'sourceSnapshot' in fullInvoice, 'the existing workspace retains full evidence');
        assert.equal(invoice.amount.toString(), fullInvoice.amount.toString());
        assert.equal(invoice.status, fullInvoice.status);
        const audit = dashboard.workspace.queues.audit.find(row => row.id === 'dashboard-audit-fixture');
        assert.ok(audit, 'dashboard retains the visible audit summary');
        const fullAudit = workspace.queues.audit.find(row => row.id === 'dashboard-audit-fixture');
        assert.deepEqual(fullAudit?.afterState, { evidence: 'after' });
        for (const row of dashboard.workspace.queues.audit) {
          assert.equal('beforeState' in row, false);
          assert.equal('afterState' in row, false);
        }
        await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await tx.salesContract.create({ data: { id: 'precision-contract', contractNumber: 'precision-contract',
            title: 'Precision', titlePersian: 'دقت', content: 'Fixture', customerId: 'historical-customer',
            departmentId: 'historical-department', createdBy: 'historical-admin', responsibleSellerId: 'historical-admin', currency: 'ریال' } });
          await tx.contractItem.create({ data: { id: 'precision-item', contractId: 'precision-contract', productId: 'fixture-only',
            quantity: '1', unitPrice: '1', totalPrice: '9999999999999.499999999999' } });
        });
        const beforeAudits = await prisma.$queryRaw\`SELECT count(*)::int AS n FROM effective_authorization_audit WHERE purpose = 'ACCOUNTING' AND channel = 'LIST'\`;
        const precisionPage = await listAccountingContracts({ sourceKind: 'SALES_CONTRACT', pageSize: 1 }, actor);
        const afterAudits = await prisma.$queryRaw\`SELECT count(*)::int AS n FROM effective_authorization_audit WHERE purpose = 'ACCOUNTING' AND channel = 'LIST'\`;
        assert.equal(afterAudits[0].n - beforeAudits[0].n, 2, 'precision fallback must not duplicate Partner authorization audits');
        const precisionReference = await listAccountingContracts({ sourceKind: 'SALES_CONTRACT', pageSize: 1, view: 'all' }, actor);
        assert.deepEqual(precisionPage, precisionReference, 'high precision must fall back to original monetary arithmetic');
        assert.equal(precisionPage.totals.contractAmount, '10000000000029');
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
