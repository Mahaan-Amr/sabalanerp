import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { reactivateOrdinaryContract, readOrdinaryReactivationActions } from '../ordinaryContractReactivation';
import { requestAccountingSalesContractCorrection } from '../salesContractCorrectionDuty';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { reconcileOrdinaryFinancialRealization, recordRealizedAdjustment } from '../salesAttributionService';
import { renewOrdinaryContract, approveOrdinarySales, markCustomerAcceptance } from '../ordinaryContractLifecycle';
import { contractConfirmationService } from '../contractConfirmationService';

const url = new URL(process.env.DATABASE_URL || '');
assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/sabalanerp', 'use existing local Compose database only');
const rollback = new Error('ROLLBACK_REACTIVATION_QA');
for (const trigger of ['FINANCIAL_RECORD', 'COMMERCIAL']) test(`ordinary reactivation keeps evidence, requires fresh authority and restores current sales once (${trigger})`, async () => {
  const db = new PrismaClient();
  try {
    await assert.rejects(db.$transaction(async tx => {
      const marker = `reactivation-${randomUUID()}`;
      const actor = await tx.user.create({ data: { username: marker, email: `${marker}@example.invalid`,
        password: 'not-login', firstName: 'QA', lastName: 'Reactivation', role: 'ADMIN' } });
      const department = await tx.department.create({ data: { name: marker, namePersian: marker } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'QA', lastName: marker, createdBy: actor.id } });
      const cancelledAt = new Date(Date.now() - 60_000);
      const base = { title: 'QA', titlePersian: 'آزمون فعال‌سازی', content: 'QA', customerId: customer.id,
        departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id, status: 'CANCELLED' as const,
        commercialFlowVersion: 1, commercialRevision: 3, totalAmount: 1000,
        commercialExpiresAt: new Date(Date.now() + 86400000), signatures: { cancellation: { at: cancelledAt.toISOString() },
          approve: { by: actor.id }, customerAcceptance: { method: 'PAPER' } } };
      const direct = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-direct` } });
      const viewer = await tx.user.create({ data: { username: `${marker}-viewer`, email: `${marker}-viewer@example.invalid`,
        password: 'not-login', firstName: 'QA', lastName: 'Viewer' } });
      await tx.workspacePermission.create({ data: { userId: viewer.id, workspace: 'sales', permissionLevel: 'edit', grantedBy: actor.id } });
      await tx.featurePermission.create({ data: { userId: viewer.id, workspace: 'sales', feature: 'sales_contracts_edit',
        permissionLevel: 'view', grantedBy: actor.id } });
      assert.equal((await readOrdinaryReactivationActions(tx, direct, viewer.id)).canReactivate, false);
      await assert.rejects(reactivateOrdinaryContract(tx, { contractId: direct.id, actorId: viewer.id, reason: 'مجوز مشاهده کافی نیست', expectedRevision: 3 }));
      await assert.rejects(reactivateOrdinaryContract(tx, { contractId: direct.id, actorId: actor.id, reason: '', expectedRevision: 3 }));
      await tx.featurePermission.updateMany({ where: { userId: viewer.id }, data: { permissionLevel: 'edit' } });
      await reactivateOrdinaryContract(tx, { contractId: direct.id, actorId: viewer.id, reason: 'مشتری برگشته است', expectedRevision: 3 });
      const opened = await tx.salesContract.findUniqueOrThrow({ where: { id: direct.id } });
      assert.equal(opened.status, 'DRAFT'); assert.equal(opened.commercialRevision, 4);
      assert.equal(opened.contractNumber, direct.contractNumber); assert.equal(opened.customerAcceptanceRevision, null);
      assert.equal(opened.commercialExpiresAt?.getTime(), direct.commercialExpiresAt?.getTime());
      assert.equal((opened.signatures as any).approvalHistory[0].customerAcceptance.method, 'PAPER');
      assert.equal((opened.signatures as any).reactivation.by, viewer.id);
      await assert.rejects(reactivateOrdinaryContract(tx, { contractId: direct.id, actorId: actor.id, reason: 'تکرار درخواست', expectedRevision: 3 }));
      const graph = await tx.salesContractProductGraphState.findFirstOrThrow();
      const attachGraph = (contractId: string) => tx.salesContractProductGraphState.create({ data: { contractId,
        schemaVersion: graph.schemaVersion, revision: graph.revision, graph: graph.graph as any,
        policySnapshot: graph.policySnapshot as any, inputHash: graph.inputHash, resultHash: graph.resultHash,
        totalAmountToman: graph.totalAmountToman } });
      await attachGraph(direct.id);
      await markCustomerAcceptance(tx, { contractId: direct.id, actorId: actor.id, revision: 4, method: 'PAPER' });
      assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: direct.id } })).status, 'APPROVED');
      await approveOrdinarySales(tx, direct.id, actor.id, 'تأیید تازه پس از پذیرش مشتری', 4);
      assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: direct.id } })).status, 'SIGNED');
      assert.equal(await tx.salesReportingEvent.count({ where: { contractId: direct.id } }), 0, 'finality alone does not count as a financial registration');
      assert.equal((await contractConfirmationService.cancelContract({ contractId: direct.id, requestedBy: actor.id,
        canCancelApproved: true, transaction: tx })).success, true);
      await reactivateOrdinaryContract(tx, { contractId: direct.id, actorId: viewer.id, reason: 'بازگشت پس از لغو دوباره', expectedRevision: 4 });
      const twiceOpened = await tx.salesContract.findUniqueOrThrow({ where: { id: direct.id } });
      assert.equal(twiceOpened.commercialRevision, 5);
      assert.equal((twiceOpened.signatures as any).reactivationHistory.length, 2);

      const expired = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-expired`, commercialExpiresAt: new Date(Date.now() - 1) } });
      const expiredActions = await readOrdinaryReactivationActions(tx, expired, actor.id);
      assert.equal(expiredActions.canReactivate, false); assert.equal(expiredActions.canCreateReplacement, true);
      await assert.rejects(reactivateOrdinaryContract(tx, { contractId: expired.id, actorId: actor.id, reason: 'باید جدید ساخته شود', expectedRevision: 3 }));
      await assert.rejects(renewOrdinaryContract(tx, expired.id, actor.id, 'مدیر هم نمی‌تواند دور بزند'));
      const legacy = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-legacy`, commercialFlowVersion: 0,
        commercialRevision: 0, commercialExpiresAt: null, signatures: {} } });
      await reactivateOrdinaryContract(tx, { contractId: legacy.id, actorId: actor.id, reason: 'قرارداد قدیمی', expectedRevision: 0 });
      assert.ok((await tx.salesContract.findUniqueOrThrow({ where: { id: legacy.id } })).commercialExpiresAt! > new Date());
      const missingDeadline = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-missing-deadline`, commercialExpiresAt: null } });
      await reactivateOrdinaryContract(tx, { contractId: missingDeadline.id, actorId: actor.id, reason: 'تعیین مهلت ثبت‌نشده', expectedRevision: 3 });
      assert.ok((await tx.salesContract.findUniqueOrThrow({ where: { id: missingDeadline.id } })).commercialExpiresAt! > new Date());
      const deletedFinancial = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-deleted-financial` } });
      await tx.accountingAuditLog.create({ data: { contractId: deletedFinancial.id, actorId: actor.id,
        action: 'DELETE_DRAFT_ACCOUNTING_RECORD', entityType: 'AccountingFinancialRecord', entityId: marker } });
      assert.equal((await readOrdinaryReactivationActions(tx, deletedFinancial, actor.id)).requiresAccountingAuthorization, true);

      const financial = await tx.salesContract.create({ data: { ...base, contractNumber: `${marker}-financial`, firstFinancialRecordAt: cancelledAt,
        commercialExpiresAt: new Date(Date.now() - 86400000), realizedAt: cancelledAt, realizedAmount: 1000, realizedSellerId: actor.id } });
      const record = await tx.accountingFinancialRecord.create({ data: { contractId: financial.id, customerId: customer.id,
        kind: 'INVOICE_CANDIDATE', status: 'DRAFT', sourceKind: 'SALES_CONTRACT', sourceId: financial.id, createdBy: actor.id, amount: 1000 } });
      const voided = await tx.accountingFinancialRecord.create({ data: { contractId: financial.id, customerId: customer.id,
        kind: 'INVOICE_CANDIDATE', status: 'VOIDED', sourceKind: 'SALES_CONTRACT', sourceId: financial.id, createdBy: actor.id, amount: 900 } });
      await tx.salesReportingEvent.createMany({ data: [
        { contractId: financial.id, eventType: 'REALIZED', amount: 1000, effectiveAt: cancelledAt, sellerId: actor.id, createdBy: actor.id, sourceKey: `${marker}-realized`, metadata: { trigger } },
        { contractId: financial.id, eventType: 'CANCELLATION', amount: -1000, effectiveAt: cancelledAt, sellerId: actor.id, createdBy: actor.id, sourceKey: `${marker}-cancelled` },
      ] });
      assert.equal((await readOrdinaryReactivationActions(tx, financial, actor.id)).canReactivate, false);
      const request = await requestAccountingSalesContractCorrection(tx, { contractId: financial.id, actorUserId: actor.id,
        category: 'OTHER', priority: 'MEDIUM', reason: 'مجوز فعال‌سازی دوباره', idempotencyKey: marker });
      const decision = await respondToCrossWorkspaceDuty(tx, { dutyId: request.duty.id, actorUserId: actor.id, actionCode: 'APPROVE',
        expectedSourceVersion: request.duty.sourceVersion, expectedEnvelopeVersion: request.duty.envelopeVersion, policyVersion: 2, reason: 'مجوز تازه فعال‌سازی' });
      assert.ok(decision.successor);
      await tx.crossWorkspaceDuty.update({ where: { id: decision.successor.id }, data: { createdAt: new Date(cancelledAt.getTime() - 1) } });
      assert.equal((await readOrdinaryReactivationActions(tx, financial, actor.id)).canReactivate, false, 'pre-cancellation opportunity is never reused');
      const freshRequest = await requestAccountingSalesContractCorrection(tx, { contractId: financial.id, actorUserId: actor.id,
        category: 'OTHER', priority: 'MEDIUM', reason: 'بررسی تازه پس از لغو', idempotencyKey: `${marker}-fresh` });
      assert.equal(freshRequest.correction.status, 'SALES_EDITED');
      assert.equal(freshRequest.duty.sourceActionCode, 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION');
      const returned = await respondToCrossWorkspaceDuty(tx, { dutyId: freshRequest.duty.id, actorUserId: actor.id,
        actionCode: 'RETURN_TO_SELLER', expectedSourceVersion: freshRequest.duty.sourceVersion,
        expectedEnvelopeVersion: freshRequest.duty.envelopeVersion, policyVersion: 2, reason: 'فعال‌سازی نیازمند مجوز تازه است' });
      assert.ok(returned.successor);
      await respondToCrossWorkspaceDuty(tx, { dutyId: returned.successor.id, actorUserId: actor.id, actionCode: 'APPROVE',
        expectedSourceVersion: returned.successor.sourceVersion, expectedEnvelopeVersion: returned.successor.envelopeVersion,
        policyVersion: 2, reason: 'صدور فرصت تازه فعال‌سازی' });
      await reactivateOrdinaryContract(tx, { contractId: financial.id, actorId: actor.id, reason: 'طبق مجوز حسابداری', expectedRevision: 3 });
      assert.equal((await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: voided.id } })).status, 'VOIDED');
      const sum = async () => (await tx.salesReportingEvent.aggregate({ where: { contractId: financial.id }, _sum: { amount: true } }))._sum.amount?.toNumber();
      assert.equal(await sum(), 0);
      await recordRealizedAdjustment(tx, { contractId: financial.id, previousAmount: 1000, nextAmount: 1200,
        sourceKey: `${marker}-edit`, actorId: actor.id, reason: 'اصلاح مبلغ پیش از قطعیت' });
      await tx.salesContract.update({ where: { id: financial.id }, data: { totalAmount: 1200 } });
      await reconcileOrdinaryFinancialRealization(tx, { contractId: financial.id, actorId: actor.id, sourceKey: `${marker}-note` });
      assert.equal(await sum(), 0);
      await attachGraph(financial.id);
      await approveOrdinarySales(tx, financial.id, actor.id, 'تأیید تازه فروش', 4);
      assert.equal(await sum(), 0, 'Sales approval alone does not restore reporting');
      await markCustomerAcceptance(tx, { contractId: financial.id, actorId: actor.id, revision: 4, method: 'PAPER' });
      await reconcileOrdinaryFinancialRealization(tx, { contractId: financial.id, actorId: actor.id, sourceKey: `${marker}-retry` });
      assert.equal(await sum(), 1200);
      assert.equal((await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: record.id } })).amount.toNumber(), 1000);
      await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { status: 'VOIDED' } });
      await reconcileOrdinaryFinancialRealization(tx, { contractId: financial.id, actorId: actor.id, sourceKey: `${marker}-void` });
      assert.equal(await sum(), 0);
      throw rollback;
    }, { timeout: 60000 }), error => error === rollback);
  } finally { await db.$disconnect(); }
});

test('two simultaneous reactivations commit one new revision and one audit', async () => {
  const db = new PrismaClient();
  const marker = `reactivation-race-${randomUUID()}`;
  let contractId: string | undefined;
  let actorId: string | undefined;
  try {
    const source = await db.salesContract.findFirst({ where: { partnerKind: null, partnerCaseId: null } });
    assert.ok(source, 'existing local fixture data is required');
    const actor = await db.user.create({ data: { username: marker, email: `${marker}@example.invalid`,
      password: 'not-login', firstName: 'QA', lastName: 'Concurrency', role: 'ADMIN' } });
    actorId = actor.id;
    const contract = await db.salesContract.create({ data: { contractNumber: marker, title: 'QA', titlePersian: 'آزمون هم‌زمانی فعال‌سازی', content: 'QA', status: 'CANCELLED',
      customerId: source.customerId, departmentId: source.departmentId, createdBy: actor.id, responsibleSellerId: actor.id,
      commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date(Date.now() + 86400000) } });
    contractId = contract.id;
    const input = { contractId, actorId: actor.id, reason: 'فعال‌سازی هم‌زمان', expectedRevision: 1 };
    const outcomes = await Promise.allSettled([reactivateOrdinaryContract(db, input), reactivateOrdinaryContract(db, input)]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.salesContract.findUniqueOrThrow({ where: { id: contractId } })).commercialRevision, 2);
    assert.equal(await db.accountingAuditLog.count({ where: { contractId, action: 'COMMERCIAL_CONTRACT_REACTIVATED' } }), 1);
  } finally {
    try {
    if (contractId) {
      await db.accountingAuditLog.deleteMany({ where: { contractId } });
      await db.contractConfirmationAuditLog.deleteMany({ where: { contractId } });
      await db.salesContract.delete({ where: { id: contractId } });
    }
    if (actorId) await db.user.delete({ where: { id: actorId } });
    } finally { await db.$disconnect(); }
  }
});
