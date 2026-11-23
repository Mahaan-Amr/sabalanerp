import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../services/identitySessionService';
import { createTemporaryConcurrencyDatabase } from '../../services/__tests__/shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('the authenticated tax register defers provider evidence and preserves invoice attempt history', {
  skip: !sourceDatabaseUrl,
  timeout: 240_000,
}, async () => {
  const temporary = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl: sourceDatabaseUrl!,
    migrateEmptySchema: true,
  });
  const database = temporary.client();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = temporary.databaseUrl;
  let closeServer: (() => Promise<void>) | undefined;
  let disconnectRuntime: (() => Promise<void>) | undefined;
  try {
    disconnectRuntime = (await import('../../lib/prisma')).disconnectDatabase;
    const { default: router } = await import('../accountingLedger');
    const app = express();
    app.use('/api/accounting/ledger', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/ledger/tax`;

    const viewer = await database.user.create({ data: {
      email: 'tax-viewer@example.test', username: 'tax-viewer', password: 'fixture-not-used',
      firstName: 'حسابدار', lastName: 'آزمون',
    } });
    await database.roleWorkspacePermission.deleteMany({ where: { role: viewer.role, workspace: 'accounting' } });
    const permission = await database.workspacePermission.create({ data: {
      userId: viewer.id, workspace: 'accounting', permissionLevel: 'view',
    } });
    const { token } = await createAuthoritativeSession(database, viewer.id, {});
    const read = (route: string) => fetch(origin + route, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

    const invoiceData = { documentKind: 'SALE', protocolVersion: '1', netRials: '9007199254740993', taxRials: '100' };
    const invoice = await database.accountingTaxInvoice.create({ data: {
      ...invoiceData, internalSerial: 'TAX-001', status: 'SUBMITTED', issuedAt: new Date('2026-09-01T20:00:00Z'),
    } });
    const otherInvoice = await database.accountingTaxInvoice.create({ data: {
      ...invoiceData, internalSerial: 'TAX-002', status: 'NEEDS_CHANNEL', issuedAt: new Date('2026-09-01T21:00:00Z'),
    } });
    const message = await database.accountingTaxOutboxMessage.create({ data: {
      taxInvoiceId: invoice.id, payloadHash: 'payload-a', protocolVersion: '1',
      requestIdentity: 'request-a', status: 'SENT', availableAt: invoice.issuedAt, createdAt: invoice.issuedAt,
    } });
    const earlierMessage = await database.accountingTaxOutboxMessage.create({ data: {
      taxInvoiceId: invoice.id, payloadHash: 'payload-b', protocolVersion: '1', requestIdentity: 'request-b',
      status: 'UNKNOWN', availableAt: invoice.issuedAt, createdAt: new Date('2026-09-01T19:00:00Z'),
    } });
    const failedAt = new Date('2026-09-01T21:00:00Z');
    const succeededAt = new Date('2026-09-01T21:30:00Z');
    const failure = await database.accountingTaxSubmissionAttempt.create({ data: {
      outboxMessageId: message.id, attemptNumber: 1, requestHash: 'hash-1', errorCode: 'FAILED_PROVIDER',
      status: 'FAILED', attemptedAt: failedAt, completedAt: failedAt, safeResponse: { result: 'rejected' },
    } });
    const success = await database.accountingTaxSubmissionAttempt.create({ data: {
      outboxMessageId: message.id, attemptNumber: 2, requestHash: 'hash-2', receiptNumber: 'receipt-2',
      status: 'SUCCEEDED', attemptedAt: succeededAt, completedAt: succeededAt, safeResponse: { result: 'accepted' },
    } });
    const earlierFailure = await database.accountingTaxSubmissionAttempt.create({ data: {
      outboxMessageId: earlierMessage.id, attemptNumber: 1, requestHash: 'hash-3', errorCode: 'OLDER_ERROR',
      status: 'UNKNOWN', attemptedAt: earlierMessage.createdAt,
    } });

    const overview = await read('/overview');
    assert.equal(overview.status, 200);
    const { data: { invoices, capabilities } } = await overview.json() as { data: any };
    assert.deepEqual(capabilities, { canManage: false, canConfigure: false });
    assert.deepEqual(invoices.map((row: { id: string }) => row.id), [otherInvoice.id, invoice.id]);
    assert.deepEqual(invoices[1].outboxMessages, [
      { id: earlierMessage.id, status: 'UNKNOWN' }, { id: message.id, status: 'SENT' },
    ]);
    assert.equal(invoices[1].latestAttemptAt, succeededAt.toISOString());
    assert.equal(invoices[1].latestErrorCode, 'FAILED_PROVIDER');
    assert.equal(invoices[1].netRials, '9007199254740993');
    assert.equal(invoices[0].latestAttemptAt, null);
    assert.equal(invoices[0].latestErrorCode, null);
    assert.ok(!JSON.stringify(invoices).includes('receipt-2'));

    const historyPath = `/invoices/${invoice.id}/attempts`;
    const history = await read(historyPath);
    assert.equal(history.status, 200);
    assert.match(history.headers.get('cache-control') ?? '', /no-store/);
    const expected = { id: invoice.id, internalSerial: invoice.internalSerial, outboxMessages: [
      { ...earlierMessage, attempts: [earlierFailure] }, { ...message, attempts: [success, failure] },
    ] };
    assert.deepEqual((await history.json() as { data: unknown }).data, JSON.parse(JSON.stringify(expected)));
    assert.deepEqual((await (await read(`/invoices/${otherInvoice.id}/attempts`)).json() as { data: unknown }).data, {
      id: otherInvoice.id, internalSerial: otherInvoice.internalSerial, outboxMessages: [],
    });
    assert.equal((await read('/invoices/absent/attempts')).status, 404);

    await database.workspacePermission.update({ where: { id: permission.id }, data: { isActive: false } });
    const denied = await read(historyPath);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as { data?: unknown }).data, undefined);
  } finally {
    await closeServer?.();
    await disconnectRuntime?.();
    await database.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    await temporary.cleanup();
  }
});
