import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';
import { executeAccountingAction } from '../accountingService';
import { createPartnerAccountingAdapter } from '../partnerSales/accounting/adapter';
import { createPrismaPartnerAccountingRepository } from '../partnerSales/accounting/prismaRepository';
import express from 'express';
import type { AddressInfo } from 'node:net';
import accountingRouter from '../../routes/accounting';
import partnerAccountingRouter from '../../routes/partner-accounting';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { PartnerAccountingCommandError } from '../partnerSales/accounting/errors';
import { executeContractLifecycleAction, createContractLifecycleRequest, decideContractLifecycleRequest,
  ContractLifecycleBlockedError } from '../contractLifecycleService';

// Runs in its own process so the application-owned Prisma client targets only
// the isolated real-schema database supplied by the parent integration harness.
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const recordId = process.env.PARTNER_TEST_INVOICE_ID!;
  const actor = { userId: process.env.PARTNER_TEST_ACTOR_ID!, role: 'ADMIN' };
  try {
    await assert.rejects(executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECORD', recordId,
      reason: 'آزمون منع دور زدن گردش اصلاح پرونده', externalReference: 'isolated-external-reference',
      downstreamNote: 'isolated-test' }, actor), /گردش اصلاح پرونده همکار/);
    const record = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } });
    assert.notEqual(record.status, 'VOIDED');
    const receivable = await prisma.accountingReceivable.findFirstOrThrow({ where: { invoiceRecordId: recordId } });
    const source = (receivable.metadata as { partnerReceivable: { partnerSellerId: string } }).partnerReceivable;
    const account = createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database: prisma,
      actorId: source.partnerSellerId, correlationId: `${recordId}-receipt-account` }));
    await prisma.workspacePermission.update({ where: { userId_workspace: { userId: actor.userId, workspace: 'accounting' } },
      data: { permissionLevel: 'edit' } });
    await prisma.featurePermission.create({ data: { userId: actor.userId, workspace: 'accounting',
      feature: 'accounting_payments_manage', permissionLevel: 'edit', grantedBy: actor.userId } });
    const assertBalance = async (received: string, balance: string) => {
      const result = await account.readOwnAccount(source.partnerSellerId);
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) {
        assert.equal(result.value.purchases[0].received.amount, received);
        assert.equal(result.value.purchases[0].balance.amount, balance);
      }
    };
    const receipt = { kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CHECK' as const,
      amount: '200', receivedAt: new Date().toISOString(), note: 'دریافت چک آزمایشی حساب همکار',
      idempotencyKey: `${recordId}-receipt`, correlationId: `${recordId}-receipt`,
      check: { checkNumber: 'isolated-334', ownerName: 'آزمایش همکار', dueDate: '2026-09-03T00:00:00.000Z' } };
    const caseId = (record.metadata as { partnerCaseId: string }).partnerCaseId;
    const sale = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: { head: true } });
    const graphHash = async (value: string) => prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId, revision: sale.headRevision } }, data: { graphHash: value } });
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
    });
    try {
      await graphHash(`sha256-v1:${'e'.repeat(64)}`);
      await assert.rejects(executeAccountingAction(receipt, actor), error =>
        error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT',
      'receipt authority requires canonical source, not just cached projections');
      const invalidAccount = await account.readOwnAccount(source.partnerSellerId);
      assert.equal(invalidAccount.ok ? null : invalidAccount.error.code, 'INTEGRITY_CONFLICT',
        'own-account cannot present amounts derived from damaged canonical evidence');
    } finally { await graphHash(sale.head.graphHash); }
    const receiptMetadata = receivable.metadata as Record<string, any>;
    await prisma.accountingReceivable.update({ where: { id: receivable.id }, data: { originalAmount: '3200', remainingAmount: '3200',
      metadata: { ...receiptMetadata, partnerReceivable: { ...receiptMetadata.partnerReceivable,
        originalAmount: { amount: '3200', currency: 'IRR' } } } } });
    try {
      await assert.rejects(executeAccountingAction({ ...receipt, amount: '2000', method: 'CASH',
        idempotencyKey: `${recordId}-inflated-receivable` }, actor), error =>
        error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT',
      'coordinated receivable/metadata corruption cannot enlarge the canonical 1600 obligation');
    } finally {
      await prisma.accountingReceivable.update({ where: { id: receivable.id }, data: { originalAmount: receivable.originalAmount,
        remainingAmount: receivable.remainingAmount, metadata: receiptMetadata } });
    }
    const registered = await executeAccountingAction(receipt, actor);
    const paymentEventId = (registered.affected.paymentEventIds as string[])[0];
    assert.deepEqual((await executeAccountingAction(receipt, actor)).affected, registered.affected);
    await assertBalance('0', '1600');
    const originalPayment = await prisma.accountingPaymentStatus.findUniqueOrThrow({ where: { id: paymentEventId } });
    await prisma.accountingPaymentStatus.update({ where: { id: paymentEventId }, data: {
      metadata: { ...(originalPayment.metadata as Record<string, any>), retained: { partnerCaseId: 'another-private-case' } } } });
    try {
      await assert.rejects(executeAccountingAction({ kind: 'UPDATE_CHECK_STATUS', paymentEventId, status: 'CLEARED',
        idempotencyKey: `${recordId}-mixed-owned-payment`, correlationId: `${recordId}-mixed-owned-payment` }, actor),
      error => error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT',
      'valid receivable ownership cannot legitimize a payment with conflicting retained Case evidence');
    } finally {
      await prisma.accountingPaymentStatus.update({ where: { id: paymentEventId }, data: { metadata: originalPayment.metadata! } });
    }
    await assert.rejects(executeAccountingAction({ kind: 'UPDATE_CHECK_STATUS', paymentEventId,
      receivableId: 'unrelated-or-missing', status: 'CLEARED',
      idempotencyKey: `${recordId}-wrong-source`, correlationId: `${recordId}-wrong-source` }, actor),
    /شواهد حساب همکار/);
    const correctionId = `${recordId}-receipt-freeze`;
    await prisma.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId,
      predecessorRevision: sale.headRevision, scope: 'SHARED', scopeHash: sale.integrityHash,
      requesterId: source.partnerSellerId, approvedBy: actor.userId, approvedAt: new Date(),
      expiresAt: new Date('2099-01-01'), calendarVersion: 'TEHRAN_WORKING_DAYS_V1', evidence: {} } });
    await prisma.partnerCorrectionGate.create({ data: { id: `${correctionId}-scope`, opportunityId: correctionId,
      kind: 'SALES_SCOPE', outcome: 'APPROVE', actorId: actor.userId, commandId: `${correctionId}-scope`, evidence: {} } });
    await assert.rejects(executeAccountingAction({ ...receipt, idempotencyKey: `${recordId}-frozen-receipt` }, actor),
      error => error instanceof PartnerAccountingCommandError && error.status === 409,
      'approved correction scope freezes new receipts against its predecessor');
    assert.deepEqual((await executeAccountingAction(receipt, actor)).affected, registered.affected,
      'an existing receipt remains replayable under current authority without creating another obligation');
    for (const [status, received, balance] of [
      ['CLEARED', '200', '1400'], ['BOUNCED', '0', '1600'], ['RETURNED', '0', '1600'],
    ]) {
      const change = { kind: 'UPDATE_CHECK_STATUS', paymentEventId, status,
        occurredAt: new Date().toISOString(), note: 'آزمون گردش چک',
        idempotencyKey: `${recordId}-${status}`, correlationId: `${recordId}-${status}` };
      await executeAccountingAction(change, actor);
      await executeAccountingAction(change, actor);
      await assertBalance(received, balance);
      const persisted = await prisma.accountingReceivable.findUniqueOrThrow({ where: { id: receivable.id } });
      assert.equal(persisted.paidAmount.toString(), received, 'official balance agrees with dated collections');
      assert.equal(persisted.remainingAmount.toString(), balance);
    }
    await prisma.partnerCorrectionGate.create({ data: { id: `${correctionId}-reject`, opportunityId: correctionId,
      kind: 'PROCESSING', outcome: 'REJECT', actorId: actor.userId, commandId: `${correctionId}-reject`, evidence: {} } });
    await prisma.workspacePermission.upsert({ where: { userId_workspace: { userId: actor.userId, workspace: 'accounting' } },
      create: { userId: actor.userId, workspace: 'accounting', permissionLevel: 'edit', grantedBy: actor.userId },
      update: { permissionLevel: 'edit' } });
    const session = await createAuthoritativeSession(prisma, actor.userId, { ipAddress: '127.0.0.1', userAgent: 'issue334-isolated-test' });
    const app = express(); app.use(express.json()); app.use('/api/accounting', accountingRouter);
    app.use('/api/partner-accounting', partnerAccountingRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const action = async (body: Record<string, unknown>, key: string) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/actions`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${session.token}`,
            'x-idempotency-key': key, 'x-correlation-id': key }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
      };
      const cash = await action({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CASH', amount: '50.25',
        note: 'آزمون دریافت نقدی' }, `${recordId}-cash`);
      assert.equal(cash.status, 200, JSON.stringify(cash.body));
      await assertBalance('50.25', '1549.75');
      const reverse = { kind: 'REVERSE_RECEIPT', paymentEventId: cash.body.data.affected.paymentEventIds[0], reason: 'استرداد وجه آزمایشی' };
      const reversed = await action(reverse, `${recordId}-cash-reverse`);
      assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
      assert.equal((await action(reverse, `${recordId}-cash-reverse`)).status, 200);
      await assertBalance('0', '1600');
      const grant = await prisma.effectiveActionGrant.findFirstOrThrow({ where: { principalId: actor.userId,
        domain: 'PARTNER', action: 'ACCOUNTING_WRITE', revokedAt: null } });
      await prisma.effectiveActionGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(),
        revokedBy: actor.userId, revocationReason: 'آزمون لغو دسترسی', revocationCorrelationId: `${recordId}-revoke` } });
      const deniedReplay = await action(reverse, `${recordId}-cash-reverse`);
      assert.equal(deniedReplay.status, 403, 'even exact replay requires current Partner authority');
      await prisma.featurePermission.create({ data: { userId: actor.userId, workspace: 'accounting',
        feature: 'accounting_tax_manage', permissionLevel: 'edit', grantedBy: actor.userId } });
      const deniedTax = await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-denied`);
      assert.equal(deniedTax.status, 403, 'ordinary tax permission cannot mutate a Partner invoice without current Case authority');
      await prisma.effectiveActionGrant.create({ data: { ...grant, id: `${grant.id}-renewed`,
        correlationId: `${recordId}-renewed`, reason: 'مجوز جدید پس از آزمون لغو' } });
      assert.equal((await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-ready`)).status, 200);
      const readyTax = await prisma.accountingTaxRecord.findFirstOrThrow({ where: { invoiceRecordId: recordId } });
      await prisma.accountingTaxRecord.update({ where: { id: readyTax.id }, data: { metadata: {
        ...(readyTax.metadata as Record<string, any>), retained: { partnerCaseId: 'foreign-private-case' } } } });
      try {
        for (const key of [`${recordId}-tax-ready`, `${recordId}-tax-mixed-owner`]) {
          const mixed = await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, key);
          assert.equal(mixed.status, 409, 'tax mutation and exact replay reject conflicting retained Case evidence');
        }
      } finally {
        await prisma.accountingTaxRecord.update({ where: { id: readyTax.id }, data: { metadata: readyTax.metadata! } });
      }
      const { owner: _taxOwner, ...withoutTaxOwner } = readyTax.metadata as Record<string, any>;
      await prisma.accountingTaxRecord.update({ where: { id: readyTax.id }, data: { metadata: withoutTaxOwner } });
      try {
        const missingOwner = await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-ready`);
        assert.equal(missingOwner.status, 409, 'missing persisted tax ownership is an integrity conflict, not a server failure');
      } finally {
        await prisma.accountingTaxRecord.update({ where: { id: readyTax.id }, data: { metadata: readyTax.metadata! } });
      }
      try {
        await graphHash(`sha256-v1:${'e'.repeat(64)}`);
        const damagedReplay = await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-ready`);
        assert.equal(damagedReplay.status, 409, 'an exact fiscal retry cannot bypass damaged canonical evidence');
      } finally { await graphHash(sale.head.graphHash); }
      const ambiguousTaxTime = await action({ kind: 'TRACK_TAX_SUBMISSION', invoiceId: recordId, status: 'SUBMITTED',
        trackingCode: `${recordId}-ambiguous-time`, submittedAt: '2026-09-02' }, `${recordId}-ambiguous-tax-time`);
      assert.equal(ambiguousTaxTime.status, 400, 'a fiscal instant must not silently interpret a date-only value as UTC midnight');
      assert.equal((await action({ kind: 'TRACK_TAX_SUBMISSION', invoiceId: recordId, status: 'SUBMITTED',
        trackingCode: `${recordId}-fiscal-reference`, submittedAt: new Date().toISOString() }, `${recordId}-tax-submit`)).status, 200);
      let acceptingTax: ReturnType<typeof action> | undefined;
      let submissionRecordedAt: Date | undefined;
      await prisma.effectiveActionGrant.create({ data: { ...grant, id: `${grant.id}-tax-clock-read`, action: 'ACCOUNTING_READ',
        correlationId: `${recordId}-tax-clock-read`, reason: 'خواندن سابقه مالیاتی در آزمون هم‌زمانی' } });
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
          acceptingTax = action({ kind: 'TRACK_TAX_SUBMISSION', invoiceId: recordId, status: 'ACCEPTED' }, `${recordId}-tax-accepted`);
          const deadline = Date.now() + 5_000;
          let blocked = false;
          while (Date.now() < deadline) {
            await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
            const waiters = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock' AND query LIKE '%partner_operations_controls%'`;
            if (Number(waiters[0].count) > 0) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, 'acceptance reached the actual operations lock');
          const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
          submissionRecordedAt = clock.now;
          await tx.accountingTaxRecord.update({ where: { id: readyTax.id }, data: { submittedAt: clock.now } });
        });
        const accepted = await acceptingTax!;
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
        const fiscalResponse = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/tax`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(fiscalResponse.status, 200);
        const fiscal = (await fiscalResponse.json() as any).data.items.find((item: any) => item.id === readyTax.id);
        assert.ok(fiscal?.acceptedAt, 'authorized tax read exposes the accepted fiscal record');
        assert.ok(Date.parse(fiscal.acceptedAt) >= submissionRecordedAt!.getTime(),
          'fiscal acceptance cannot precede the submission observed after its lock wait');
      } finally {
        await acceptingTax;
        await prisma.effectiveActionGrant.update({ where: { id: `${grant.id}-tax-clock-read` }, data: { revokedAt: new Date(),
          revokedBy: actor.userId, revocationReason: 'پایان آزمون هم‌زمانی', revocationCorrelationId: `${recordId}-tax-clock-end` } });
      }
      const duplicateTax = await prisma.accountingTaxRecord.create({ data: { invoiceRecordId: recordId,
        readinessStatus: 'READY', submissionStatus: 'READY', metadata: readyTax.metadata!,
        missingFields: [], createdBy: actor.userId } });
      try {
        const duplicate = await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-duplicate`);
        assert.equal(duplicate.status, 409, 'a newer tax child cannot hide the existing accepted fiscal record');
      } finally { await prisma.accountingTaxRecord.delete({ where: { id: duplicateTax.id } }); }
      assert.equal((await action({ kind: 'MARK_TAX_READY', invoiceId: recordId, readiness: 'READY' }, `${recordId}-tax-reset`)).status, 409,
        'accepted fiscal evidence cannot be reset to ready to evade correction gates');
      let waitingTax: ReturnType<typeof action> | undefined;
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
          waitingTax = action({ kind: 'TRACK_TAX_SUBMISSION', invoiceId: recordId, status: 'NEEDS_CORRECTION' }, `${recordId}-tax-race`);
          // Observe the actual lock wait, not a guessed scheduling delay. The
          // isolated fixture retires the invoice as a competing effect would.
          const deadline = Date.now() + 5_000;
          let blocked = false;
          while (Date.now() < deadline) {
            await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
            const waiters = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock' AND query LIKE '%partner_operations_controls%'`;
            if (Number(waiters[0].count) > 0) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, 'tax command reached the shared operations lock');
          await tx.accountingFinancialRecord.update({ where: { id: recordId }, data: { status: 'VOIDED' } });
        });
        const raced = await waitingTax!;
        assert.equal(raced.status, 409, 'a waiting tax command cannot mutate an invoice retired before its lock');
      } finally {
        await waitingTax;
        await prisma.accountingFinancialRecord.update({ where: { id: recordId }, data: { status: record.status } });
      }
      const partnerCase = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: (record.metadata as { partnerCaseId: string }).partnerCaseId } });
      await assert.rejects(executeAccountingAction({ kind: 'REGISTER_RECEIPT', contractId: partnerCase.customerContractId!,
        method: 'CASH', amount: '10' }, actor), /دریافتنی داخلی پرونده همکار/);
      await assert.rejects(executeAccountingAction({ kind: 'CREATE_RECEIVABLE', contractId: partnerCase.customerContractId!,
        amount: '10' }, actor), /رکورد داخلی پرونده همکار/);
      await assert.rejects(executeAccountingAction({ kind: 'CREATE_INVOICE', contractId: partnerCase.customerContractId! }, actor),
        /رکورد داخلی پرونده همکار/);
      const lifecycleBlocked = (error: unknown) => error instanceof ContractLifecycleBlockedError &&
        error.blockers.some(item => item.code === 'PARTNER_CASE_LIFECYCLE');
      await assert.rejects(executeContractLifecycleAction({ contractId: partnerCase.customerContractId, action: 'DEACTIVATE',
        reason: 'آزمون جلوگیری از تغییر مستقل قرارداد مشتری', actorId: actor.userId }), lifecycleBlocked);
      await assert.rejects(createContractLifecycleRequest({ contractId: partnerCase.customerContractId, kind: 'DEACTIVATE',
        reason: 'آزمون جلوگیری از درخواست مستقل قرارداد مشتری', actorId: actor.userId }), lifecycleBlocked);
      const legacyRequest = await prisma.contractLifecycleRequest.create({ data: { contractId: partnerCase.customerContractId,
        contractNumberSnapshot: 'isolated-legacy-request', kind: 'DEACTIVATE', requestedBy: actor.userId,
        reason: 'درخواست قدیمی پیش از اعمال سیاست پرونده همکار', contractSnapshot: {} } });
      await assert.rejects(decideContractLifecycleRequest({ requestId: legacyRequest.id, decision: 'APPROVE', actorId: actor.userId }), lifecycleBlocked);
      await prisma.salesContract.update({ where: { id: partnerCase.customerContractId }, data: { isInactive: true } });
      try {
        await assert.rejects(executeContractLifecycleAction({ contractId: partnerCase.customerContractId, action: 'REACTIVATE',
          reason: 'آزمون وضعیت غیرفعال قدیمی', actorId: actor.userId }), lifecycleBlocked);
      } finally {
        await prisma.salesContract.update({ where: { id: partnerCase.customerContractId }, data: { isInactive: false } });
      }
      for (const feature of ['accounting_receivables_manage', 'accounting_records_approve_void',
        'accounting_tax_manage', 'accounting_audit_view', 'accounting_dashboard_view', 'accounting_contracts_view']) {
        await prisma.featurePermission.upsert({ where: { userId_workspace_feature: { userId: actor.userId, workspace: 'accounting', feature } },
          create: { userId: actor.userId, workspace: 'accounting', feature, permissionLevel: 'view', grantedBy: actor.userId },
          update: { permissionLevel: 'view' } });
      }
      for (const suffix of ['', '/lifecycle', '/pdf', '/sales-pdf']) {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/contracts/${partnerCase.customerContractId}${suffix}`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(response.status, 404, `Partner retail contract is not an ordinary Accounting entry point: ${suffix}`);
      }
      // Incomplete imported provenance must not become an ordinary, unscoped row.
      await prisma.accountingReceivable.create({ data: { originalAmount: '1', remainingAmount: '1',
        currency: 'IRR', dueDate: new Date(), createdBy: actor.userId, metadata: receivable.metadata! } });
      await prisma.accountingPaymentStatus.create({ data: { amount: '1', method: 'CASH', currency: 'IRR',
        createdBy: actor.userId, metadata: { partnerCaseId: partnerCase.id, collectionMovements: [], invoiceId: recordId } } });
      const ordinaryReceivable = await prisma.accountingReceivable.create({ data: { originalAmount: '1', remainingAmount: '1',
        currency: 'IRR', dueDate: new Date(), createdBy: actor.userId } });
      await prisma.accountingReceivable.create({ data: { originalAmount: '3', remainingAmount: '3',
        currency: 'IRT', dueDate: new Date(), createdBy: actor.userId } });
      const mixedPayment = await prisma.accountingPaymentStatus.create({ data: { receivableId: ordinaryReceivable.id,
        amount: '1', method: 'CASH', currency: 'IRR', createdBy: actor.userId,
        metadata: { partnerCaseId: partnerCase.id, privateEvidence: 'hidden-partner-child-evidence' } } });
      const orphanAudit = await prisma.accountingAuditLog.create({ data: { actorId: actor.userId,
        action: 'REGISTER_RECEIPT', entityType: 'AccountingPaymentStatus', entityId: 'missing-payment',
        afterState: { metadata: { partnerCaseId: partnerCase.id, privateEvidence: 'orphan-partner-audit-evidence' } } } });
      const mixedInvoice = await prisma.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE',
        sourceKind: 'IMPORT', amount: '1600', currency: 'IRR', createdBy: actor.userId, sourceSnapshot: record.sourceSnapshot! } });
      const malformedCheck = await prisma.accountingPaymentStatus.create({ data: { method: 'CHECK', amount: '1', currency: 'IRR',
        status: 'RECEIVED', checkStatus: 'RECEIVED', createdBy: actor.userId, metadata: { retained: { partnerCaseId: null } } } });
      const malformedChange = await action({ kind: 'UPDATE_CHECK_STATUS', paymentEventId: malformedCheck.id,
        status: 'CLEARED' }, `${recordId}-malformed-check`);
      assert.equal(malformedChange.status, 409, 'nested or null Partner evidence cannot fall through to an ordinary check writer');
      await prisma.workspacePermission.update({ where: { userId_workspace: { userId: actor.userId, workspace: 'accounting' } },
        data: { permissionLevel: 'admin' } });
      try {
        const ordinaryTaxInvoice = await prisma.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE',
          sourceKind: 'IMPORT', amount: '1', currency: 'IRR', createdBy: actor.userId } });
        const partialTax = await prisma.accountingTaxRecord.create({ data: { invoiceRecordId: ordinaryTaxInvoice.id, readinessStatus: 'READY',
          submissionStatus: 'READY', missingFields: [], createdBy: actor.userId, metadata: { retained: { partnerCaseId: null } } } });
        const mixedTax = await action({ kind: 'MARK_TAX_READY', invoiceId: ordinaryTaxInvoice.id, readiness: 'READY' }, `${recordId}-ordinary-private-tax`);
        assert.equal(mixedTax.status, 409, 'an ordinary invoice cannot authorize its Partner-marked tax child');
        await prisma.accountingTaxRecord.update({ where: { id: partialTax.id }, data: {
          metadata: { retained: { financialEvidenceHash: null } } } });
        const partialFiscal = await action({ kind: 'MARK_TAX_READY', invoiceId: ordinaryTaxInvoice.id, readiness: 'READY' }, `${recordId}-partial-private-tax`);
        assert.equal(partialFiscal.status, 409, 'partial fiscal provenance cannot fall back to ordinary tax authority');
        const ordinaryFiscalRead = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/tax`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(ordinaryFiscalRead.status, 200);
        assert.equal((await ordinaryFiscalRead.text()).includes(partialTax.id), false, 'partial private fiscal evidence stays outside ordinary reads');
        for (const kind of ['VOID_ACCOUNTING_RECORD', 'DELETE_DRAFT_ACCOUNTING_RECORD']) {
          const malformed = await prisma.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE',
            sourceKind: 'IMPORT', amount: '1', currency: 'IRR', createdBy: actor.userId,
            sourceSnapshot: { retained: { partnerCaseId: null } } } });
          const changed = await action({ kind, recordId: malformed.id, reason: 'آزمون حفظ شواهد منبع همکار' }, `${recordId}-${kind}-mixed`);
          assert.equal(changed.status, 409, `${kind} cannot destroy nested Partner evidence through an ordinary discriminator`);
          assert.equal((await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: malformed.id } })).status, 'DRAFT');
        }
      } finally {
        await prisma.workspacePermission.update({ where: { userId_workspace: { userId: actor.userId, workspace: 'accounting' } },
          data: { permissionLevel: 'edit' } });
      }
      for (const path of ['/financial-records', '/receivables', `/receivables?recordId=${receivable.id}`,
        '/payments', `/payments?recordId=${paymentEventId}`, '/tax', '/audit', '/workspace']) {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting${path}`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        const body = await response.text();
        assert.equal(response.status, 200, body);
        assert.equal(body.includes(recordId), false, `unscoped Accounting read leaks Partner source at ${path}`);
        assert.equal(body.includes(receivable.id), false, `unscoped Accounting read leaks Partner receivable at ${path}`);
        assert.equal(body.includes(paymentEventId), false, `unscoped Accounting read leaks Partner payment at ${path}`);
        assert.equal(body.includes(mixedPayment.id), false, `ordinary parent leaks mixed Partner child at ${path}`);
        assert.equal(body.includes(orphanAudit.id), false, `orphan audit leaks Partner evidence at ${path}`);
        assert.equal(body.includes(mixedInvoice.id), false, `ordinary discriminator leaks retained Partner preparation at ${path}`);
      }
      await prisma.effectiveActionGrant.create({ data: { ...grant, id: `${grant.id}-read`, action: 'ACCOUNTING_READ',
        correlationId: `${recordId}-read`, reason: 'مجوز خواندن پرونده برای آزمون' } });
      const visible = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/receivables?recordId=${receivable.id}`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      assert.equal(visible.status, 200);
      const visibleBody = await visible.json() as any;
      const displayed = visibleBody.data.items.find((item: any) => item.id === receivable.id);
      assert.ok(displayed, 'explicit Case read permission admits its existing receivable');
      assert.equal(displayed.sourceKind, 'PARTNER_INTERNAL_RECORD');
      assert.equal(displayed.partnerContext.caseId, partnerCase.id);
      assert.equal(displayed.partnerContext.partnerSellerId, source.partnerSellerId);
      assert.equal(displayed.contract, null, 'the retail customer contract is not the debtor');
      assert.equal(displayed.partnerActions.registerReceipt, true, 'current Case and narrow payment authority admits receipt entry');
      const readTax = async () => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/tax`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(response.status, 200);
        return (await response.json() as any).data.items.find((item: any) => item.invoiceRecordId === recordId);
      };
      assert.deepEqual((await readTax()).partnerActions.taxStatuses, [], 'read-only tax permission offers no mutations');
      const taxGrantKey = { userId_workspace_feature: { userId: actor.userId, workspace: 'accounting', feature: 'accounting_tax_manage' } };
      await prisma.featurePermission.update({ where: taxGrantKey, data: { permissionLevel: 'edit' } });
      const taxDisplay = await readTax();
      assert.deepEqual(taxDisplay.partnerActions.taxStatuses, ['NEEDS_CORRECTION']);
      assert.equal(taxDisplay.partnerFinancialSource.currency, 'IRR');
      assert.equal(taxDisplay.partnerFinancialSource.tax, '0');
      const readPayment = async (id: string) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/payments?recordId=${id}`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(response.status, 200);
        return (await response.json() as any).data.focus.record;
      };
      assert.deepEqual((await readPayment(paymentEventId)).partnerActions.checkStatuses, [], 'returned check has no further transitions');
      const actionCash = await action({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CASH', amount: '1',
        note: 'آزمون دسترسی اقدام' }, `${recordId}-action-cash`);
      assert.equal(actionCash.status, 200);
      const beforeReversal = new Date().toISOString();
      const actionPaymentId = actionCash.body.data.affected.paymentEventIds[0];
      assert.equal((await readPayment(actionPaymentId)).partnerActions.reverseReceipt, true);
      const paymentGrantKey = { userId_workspace_feature: { userId: actor.userId, workspace: 'accounting', feature: 'accounting_payments_manage' } };
      await prisma.featurePermission.update({ where: paymentGrantKey, data: { permissionLevel: 'view' } });
      assert.equal((await readPayment(actionPaymentId)).partnerActions.reverseReceipt, false, 'current narrow permission controls the projected action');
      await prisma.featurePermission.update({ where: paymentGrantKey, data: { permissionLevel: 'edit' } });
      const actionReverse = await action({ kind: 'REVERSE_RECEIPT', paymentEventId: actionPaymentId, reason: 'بازگرداندن وجه آزمایش دسترسی' }, `${recordId}-action-reverse`);
      assert.equal(actionReverse.status, 200);
      assert.equal((await readPayment(actionPaymentId)).partnerActions.reverseReceipt, false);
      const periodParts = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
      const period = `${periodParts.find(part => part.type === 'year')!.value}-${periodParts.find(part => part.type === 'month')!.value}`;
      const historical = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/receivables?view=outstanding&period=${period}&cutoff=${encodeURIComponent(new Date().toISOString())}&search=${encodeURIComponent(displayed.partnerContext.caseNumber)}`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      const historicalBody = await historical.json() as any;
      assert.equal(historical.status, 200, JSON.stringify(historicalBody));
      const historicalPartner = historicalBody.data.items.find((item: any) => item.sourceKind === 'PARTNER_INTERNAL_RECORD');
      assert.ok(historicalPartner, 'historical outstanding includes published Partner debt without a synthetic contract');
      assert.equal(historicalPartner.remainingAmount, '1600');
      assert.equal(historicalPartner.contractId, null);
      assert.ok(historicalPartner.metadata.historicalOutstandingAt);
      const earlier = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/receivables?view=outstanding&period=${period}&cutoff=${encodeURIComponent(beforeReversal)}&search=${encodeURIComponent(displayed.partnerContext.caseNumber)}`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      assert.equal(earlier.status, 200);
      assert.equal((await earlier.json() as any).data.items.find((item: any) => item.sourceKind === 'PARTNER_INTERNAL_RECORD').remainingAmount,
        '1599', 'historical balance retains the receipt before its later reversal');
      const trend = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/financial-trend?range=1m`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      assert.equal(trend.status, 200);
      const trendBody = await trend.json() as any;
      const partnerPoint = trendBody.data.partnerSeries.find((series: any) => series.currency === 'IRR').points.at(-1);
      assert.equal(partnerPoint.invoiced, '1600');
      assert.equal(partnerPoint.received, '0');
      assert.equal(partnerPoint.outstanding, '1600');
      const workspace = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/workspace`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      const workspaceBody = await workspace.json() as any;
      assert.equal(workspace.status, 200, JSON.stringify(workspaceBody));
      assert.equal(workspaceBody.data.partnerAccountingIncluded, true);
      assert.equal(workspaceBody.data.deadlines.items.find((item: any) => item.id === receivable.id)?.partnerContext.caseId, partnerCase.id,
        'deadline entries retain authorized Partner identity rather than presenting a legacy customer debt');
      assert.equal(workspaceBody.data.commandCenter.openReceivables.amount, null, 'mixed currencies have no combined monetary total');
      assert.deepEqual(workspaceBody.data.commandCenter.openReceivables.amountsByCurrency,
        [{ currency: 'IRR', amount: '1601' }, { currency: 'IRT', amount: '3' }]);
      const searched = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${displayed.partnerContext.actionUrl.replace('/dashboard/accounting/invoice-candidates', '/api/accounting/financial-records')}`,
        { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
      assert.equal(searched.status, 200);
      assert.equal((await searched.json() as any).data.items.some((item: any) => item.id === recordId), true,
        'the authorized Case context links to a searchable official invoice');
      await prisma.accountingFinancialRecord.update({ where: { id: recordId }, data: { amount: '1601' } });
      try {
        for (const path of ['/workspace', '/financial-records']) {
          const corrupt = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting${path}`,
            { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
          assert.equal(corrupt.status, 409, `corrupt authorized source must be an actionable conflict at ${path}`);
          const problem = await corrupt.json() as any;
          assert.match(problem.message, /شواهد/);
          assert.equal(problem.actionUrl, '/dashboard/accounting/receivables');
        }
      } finally {
        await prisma.accountingFinancialRecord.update({ where: { id: recordId }, data: { amount: record.amount } });
      }
      await prisma.accountingReceivable.update({ where: { id: receivable.id }, data: { remainingAmount: '1599' } });
      try {
        const corrupt = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/workspace`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        assert.equal(corrupt.status, 409, 'dashboard must reject a balance that disagrees with the dated collection ledger');
      } finally {
        await prisma.accountingReceivable.update({ where: { id: receivable.id }, data: { remainingAmount: '1600' } });
      }
      const customerContract = await prisma.salesContract.findUniqueOrThrow({ where: { id: partnerCase.customerContractId } });
      const ordinaryContractIds: string[] = [];
      for (const suffix of ['ordinary-history-alpha', 'ordinary-history-beta']) {
        const contract = await prisma.salesContract.create({ data: { contractNumber: `${recordId}-${suffix}`, title: suffix,
          titlePersian: suffix, content: 'isolated ordinary history', status: 'APPROVED', customerId: customerContract.customerId,
          departmentId: customerContract.departmentId, createdBy: actor.userId, responsibleSellerId: actor.userId } });
        ordinaryContractIds.push(contract.id);
        await prisma.accountingFinancialRecord.create({ data: { contractId: contract.id, sourceKind: 'SALES_CONTRACT', kind: 'INVOICE_CANDIDATE',
          status: 'ISSUED', amount: '100', sepidarAmount: '100', currency: 'ریال', createdBy: actor.userId,
          financiallyApprovedAt: new Date('2026-08-01'), systemInvoiceDate: new Date('2026-08-01'), createdAt: new Date('2026-08-01') } });
      }
      for (const [search, expectedCount] of [['ordinary-history-alpha', 1], ['no-matching-ordinary-history', 0]] as const) {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/receivables?view=outstanding&period=1405-05&search=${search}`,
          { headers: { cookie: `${SESSION_COOKIE}=${session.token}` } });
        const body = await response.json() as any;
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(body.data.total, expectedCount, 'historical search retains its ordinary contract population');
        if (expectedCount) assert.equal(body.data.items[0].contractId, ordinaryContractIds[0]);
      }
      const ownSession = await createAuthoritativeSession(prisma, source.partnerSellerId,
        { ipAddress: '127.0.0.1', userAgent: 'issue334-own-account-test' });
      const ownAccount = () => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/partner-accounting/account`,
        { headers: { cookie: `${SESSION_COOKIE}=${ownSession.token}` }, signal: AbortSignal.timeout(10_000) });
      assert.equal((await ownAccount()).status, 200);
      // A real infrastructure failure in this isolated database, not an internal
      // mock. Always restore the table before closing the probe.
      await prisma.$executeRawUnsafe('ALTER TABLE accounting_payment_statuses RENAME TO issue334_unavailable_payments');
      try {
        const failed = await ownAccount();
        const body = await failed.json() as any;
        assert.equal(failed.status, 500, 'database failure is retryable technical failure, not business-integrity conflict');
        assert.equal(body.code, 'TECHNICAL_FAILURE');
        assert.ok(body.supportReference);
        assert.equal(failed.headers.get('cache-control'), 'private, no-store');
        assert.doesNotMatch(JSON.stringify(body), /P2021|accounting_payment_statuses|prisma|SELECT/i);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE issue334_unavailable_payments RENAME TO accounting_payment_statuses');
      }
      assert.equal((await ownAccount()).status, 200, 'technical failure does not poison later valid requests');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
