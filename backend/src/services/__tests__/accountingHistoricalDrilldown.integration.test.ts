import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('authenticated historical balances and receipt movement pages retain exact results with bounded evidence', async () => {
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: process.cwd(),
    sourceDatabaseUrl: process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '', migrateEmptySchema: true });
  const database = temporary.client();
  const originalUrl = process.env.DATABASE_URL;
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
    process.env.DATABASE_URL = temporary.databaseUrl;
    const { prisma } = await import('../../lib/prisma');
    const { default: router } = await import('../../routes/accounting');
    const { SESSION_COOKIE, createAuthoritativeSession } = await import('../identitySessionService');
    try {
      await prisma.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting', permissionLevel: 'view', grantedBy: actorId } });
      const session = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1', userAgent: 'fixture' });
      let measure = false;
      let evidence = { rows: 0, bytes: 0 };
      const measuredModels = new Set(['AccountingFinancialRecord', 'AccountingPaymentStatus', 'AccountingAuditLog']);
      prisma.$use(async (params, next) => {
        const rows = await next(params);
        if (measure && params.action === 'findMany' && params.model && measuredModels.has(params.model) && Array.isArray(rows)) {
          evidence.rows += rows.length;
          evidence.bytes += Buffer.byteLength(JSON.stringify(rows));
        }
        return rows;
      });
      const app = express();
      app.use('/api/accounting', router);
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>(resolve => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting`;
      async function read(route: string, view: string, query: Record<string, string> = {}) {
        const params = new URLSearchParams({ view, period: '1405-05', cutoff: cutoff.toISOString(), ...query });
        evidence = { rows: 0, bytes: 0 };
        measure = true;
        try {
          const response = await fetch(`${origin}/${route}?${params}`, { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
          const body = await response.json() as any;
          assert.equal(response.status, 200, JSON.stringify(body));
          return { data: body.data, work: evidence };
        } finally { measure = false; }
      }
      try {
        const outstanding = await read('receivables', 'outstanding');
        assert.equal(outstanding.data.total, 2);
        assert.deepEqual(Object.fromEntries(outstanding.data.items.map((row: any) => [row.contractId, row.remainingAmount])),
          { 'ordinary-legacy': '90.25', 'ordinary-void': '100.5' });
        const later = await read('receivables', 'outstanding', { cutoff: '2026-08-06T20:30:00.001Z' });
        assert.equal(later.data.items.some((row: any) => row.contractId === 'ordinary-void'), false);
        for (const page of [1, 2, 3]) {
          const partial = await read('receivables', 'outstanding', { page: String(page), pageSize: '1' });
          assert.equal(partial.data.total, 2);
          assert.deepEqual(partial.data.items, outstanding.data.items.slice(page - 1, page));
        }
        const received = await read('payments', 'received', { pageSize: '1' });
        const receivedFull = await read('payments', 'received');
        assert.equal(received.data.total, 3);
        assert.deepEqual(received.data.items, receivedFull.data.items.slice(0, 1));
        assert.deepEqual(receivedFull.data.items.map((row: any) => [row.id, row.collectionEffectAmount, row.collectionEffectConfidence]), [
          ['legacy-reversal', '20.25', 'authoritative'], ['legacy-reversal', '-20.25', 'legacy-fallback'],
          ['legacy-receipt', '10.25', 'legacy-fallback'],
        ]);
        const focused = await read('payments', 'received', { recordId: 'legacy-receipt', pageSize: '1' });
        assert.equal(focused.data.focus.state, 'focused');
        assert.equal(focused.data.focus.inPage, false);
        assert.equal((await read('payments', 'received', { recordId: 'private-receipt' })).data.focus.state, 'missing');
        console.log(JSON.stringify({ fixture: { noiseCount, evidenceBytesPerRow: padding.length },
          outstanding: outstanding.work, received: received.work }));
        assert.ok(outstanding.work.rows < noiseCount && outstanding.work.bytes < padding.length * 4,
          'outstanding reads only dated rows and relevant historical evidence');
        assert.ok(received.work.rows < noiseCount && received.work.bytes < padding.length * 4,
          'received reads only potential movements and hydrates just the selected page');

        // Imported evidence can place a movement in the period even if the
        // payment header falls outside it. An undated legacy receipt falls
        // back to the creation date.
        await database.accountingPaymentStatus.update({ where: { id: 'legacy-reversal' }, data: {
          occurredAt: date('2026-08-31T08:00:00Z'), updatedAt: date('2026-08-04T12:00:00Z'),
        } });
        await database.accountingPaymentStatus.update({ where: { id: 'legacy-receipt' }, data: {
          occurredAt: null, createdAt: start,
        } });
        const imported = await read('payments', 'received');
        assert.equal(imported.data.total, 3);
        assert.deepEqual(imported.data.items.filter((row: any) => row.id === 'legacy-reversal')
          .map((row: any) => row.collectionEffectAmount), ['20.25', '-20.25']);
        assert.equal(imported.data.items.find((row: any) => row.id === 'legacy-receipt').collectionEffectiveAt, start.toISOString());
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    } finally { await prisma.$disconnect(); }
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await database.$disconnect();
    await temporary.cleanup();
  }
});
