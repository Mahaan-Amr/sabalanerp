import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('authenticated historical balances and receipt movement pages retain exact results with bounded evidence', async () => {
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: process.cwd(),
    sourceDatabaseUrl: process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '', migrateEmptySchema: true });
  const database = temporary.client();
  const noiseCount = 24;
  const padding = 'x'.repeat(4096);
  const date = (iso: string) => new Date(iso);
  const start = date('2026-07-22T20:30:00Z'); // Tehran midnight at the start of 1405-05.
  const cutoff = date('2026-08-06T20:30:00Z');
  try {
    const { actorId, fixture } = await seedHistoricalAccountingRead(database);
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const id of ['ordinary-legacy', 'ordinary-void', 'ordinary-future']) {
        await tx.salesContract.create({ data: { id, contractNumber: id, title: id, titlePersian: id, content: 'Fixture',
          customerId: 'historical-customer', departmentId: 'historical-department', createdBy: actorId, responsibleSellerId: actorId } });
      }
      const invoice = { kind: 'INVOICE_CANDIDATE' as const, status: 'ISSUED' as const, sourceKind: 'SALES_CONTRACT' as const,
        createdBy: actorId, amount: '100.50', financiallyApprovedAt: date('2026-07-25T08:00:00Z'),
        createdAt: date('2026-08-31T08:00:00Z'), sourceSnapshot: { padding } };
      await tx.accountingFinancialRecord.createMany({ data: [
        { ...invoice, id: 'legacy-invoice', contractId: 'ordinary-legacy', sourceId: 'ordinary-legacy' },
        { ...invoice, id: 'void-invoice', contractId: 'ordinary-void', sourceId: 'ordinary-void', status: 'VOIDED',
          systemInvoiceDate: start, voidedAt: cutoff },
        ...Array.from({ length: noiseCount }, (_, index) => ({ ...invoice, id: `future-invoice-${index}`,
          sourceId: 'ordinary-future', contractId: 'ordinary-future', systemInvoiceDate: cutoff })),
      ] });
      const payment = { method: 'CASH' as const, status: 'RECEIVED' as const, amount: '10.25', createdBy: actorId,
        contractId: 'ordinary-legacy', createdAt: date('2026-08-31T08:00:00Z'), notes: padding };
      await tx.accountingPaymentStatus.createMany({ data: [
        { ...payment, id: 'legacy-receipt', occurredAt: start },
        { ...payment, id: 'legacy-reversal', status: 'REVERSED', amount: '20.25', occurredAt: date('2026-08-01T12:00:00Z'),
          updatedAt: date('2026-08-04T12:00:00Z'), metadata: { collectionMovements: [{ kind: 'RECEIVED', amount: '20.25',
            effectiveAt: '2026-08-01T12:00:00Z' }] } },
        { ...payment, id: 'at-cutoff', occurredAt: cutoff },
        { ...payment, id: 'private-receipt', contractId: fixture.row.customerContractId, occurredAt: start },
        ...Array.from({ length: noiseCount }, (_, index) => ({ ...payment, id: `future-payment-${index}`,
          contractId: 'ordinary-future', occurredAt: cutoff })),
      ] });
      const audit = { actorId, beforeState: { padding }, afterState: { padding }, contractId: 'ordinary-legacy',
        entityType: 'AccountingFinancialRecord', entityId: 'legacy-invoice', createdAt: date('2026-07-25T08:00:00Z') };
      await tx.accountingAuditLog.createMany({ data: [
        { ...audit, action: 'APPROVE_FINANCIAL_INVOICE' },
        ...Array.from({ length: noiseCount }, () => ({ ...audit, action: 'UNRELATED_FIXTURE_ACTION' })),
      ] });
    });
    const result = spawnSync(process.execPath, [
      path.resolve('backend/node_modules/tsx/dist/cli.mjs'),
      path.resolve('backend/src/services/__tests__/accountingHistoricalDrilldownHttpProbe.ts'),
      actorId, start.toISOString(), cutoff.toISOString(), String(noiseCount), String(padding.length),
    ], { env: { ...process.env, DATABASE_URL: temporary.databaseUrl }, encoding: 'utf8', timeout: 60_000 });
    if (result.error) throw result.error;
    if (result.stdout) process.stdout.write(result.stdout);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
