import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { executeAccountingAction } from '../accountingService';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const recordId = process.env.PARTNER_TEST_INVOICE_ID!, actor = { userId: process.env.PARTNER_TEST_ACTOR_ID!, role: 'ADMIN' };
  try {
    await prisma.workspacePermission.update({ where: { userId_workspace: { userId: actor.userId, workspace: 'accounting' } }, data: { permissionLevel: 'admin' } });
    const invoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } });
    const caseId = (invoice.metadata as { partnerCaseId: string }).partnerCaseId;
    const root = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId } });
    const originalContract = await prisma.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId! } });
    const commitmentCount = await prisma.partnerCaseEvent.count({ where: { caseId, type: 'CASE_COMMITTED' } });
    const receivable = await prisma.accountingReceivable.findFirstOrThrow({ where: { invoiceRecordId: recordId } });
    await prisma.featurePermission.upsert({ where: { userId_workspace_feature: { userId: actor.userId, workspace: 'accounting', feature: 'accounting_payments_manage' } },
      update: { permissionLevel: 'edit' }, create: { userId: actor.userId, workspace: 'accounting', feature: 'accounting_payments_manage', permissionLevel: 'edit', grantedBy: actor.userId } });
    const receivedAt = new Date().toISOString(), key = randomUUID();
    const received = await executeAccountingAction({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id,
      method: 'CASH', amount: '100', receivedAt, idempotencyKey: key, correlationId: key }, actor);
    assert.equal(received.status, 'APPLIED');
    const paymentId = (await prisma.accountingPaymentStatus.findFirstOrThrow({ where: { receivableId: receivable.id }, orderBy: { createdAt: 'desc' } })).id;
    const checkKey = randomUUID();
    await executeAccountingAction({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CHECK', amount: '200',
      receivedAt: new Date().toISOString(), check: { checkNumber: 'isolated-void-check', ownerName: 'همکار آزمون', dueDate: '2026-10-10' },
      idempotencyKey: checkKey, correlationId: checkKey }, actor);
    const check = await prisma.accountingPaymentStatus.findFirstOrThrow({ where: { receivableId: receivable.id, method: 'CHECK' } });
    const effectiveAt = new Date().toISOString();
    const started = await executeAccountingAction({ kind: 'START_ACCOUNTING_VOID_CASE', recordId, reasonKind: 'ENTRY_ERROR', reason: 'اصلاح ثبت مالی', effectiveAt }, actor);
    const voidCase = await prisma.accountingFinancialVoidCase.findFirstOrThrow({ where: { sourceRecordId: recordId, status: 'OPEN' } });
    assert.equal(started.status, 'APPLIED');
    assert.equal((await executeAccountingAction({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CASH', amount: '100', receivedAt, idempotencyKey: key, correlationId: key }, actor)).status, 'APPLIED', 'existing receipt retries remain idempotent during void');
    assert.equal((await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } })).status, invoice.status);
    await assert.rejects(() => executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECORD', recordId }, actor), /دریافت|مراحل/);
    await assert.rejects(() => executeAccountingAction({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CASH', amount: '100',
      receivedAt: new Date().toISOString(), idempotencyKey: randomUUID(), correlationId: randomUUID() }, actor), /ابطال/);
    await executeAccountingAction({ kind: 'REVERSE_RECEIPT', paymentEventId: paymentId, reason: 'برگشت دریافت برای ابطال',
      occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), correlationId: randomUUID() }, actor);
    await assert.rejects(() => executeAccountingAction({ kind: 'CANCEL_ACCOUNTING_VOID_CASE', voidCaseId: voidCase.id, reason: 'لغو آزمون' }, actor), /اولین تغییر مالی/);
    await assert.rejects(() => executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECEIVABLE', receivableId: receivable.id,
      reason: 'ابطال قبل از عودت چک', effectiveAt: new Date().toISOString() }, actor), /چک/);
    await executeAccountingAction({ kind: 'UPDATE_CHECK_STATUS', paymentEventId: check.id, status: 'RETURNED', reason: 'عودت چک برای ابطال',
      occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), correlationId: randomUUID() }, actor);
    await executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECEIVABLE', receivableId: receivable.id, reason: 'ابطال پس از برگشت دریافت', effectiveAt: new Date().toISOString() }, actor);
    await executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECORD', recordId }, actor);
    const finalInvoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } });
    assert.equal(finalInvoice.status, 'VOIDED'); assert.equal(finalInvoice.contractId, null); assert.equal(finalInvoice.customerId, null);
    const finalRoot = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId } });
    assert.equal(finalRoot.state, 'COMMITTED'); assert.equal(finalRoot.commitmentEventId, root.commitmentEventId);
    assert.equal(await prisma.partnerCaseEvent.count({ where: { caseId, type: 'CASE_COMMITTED' } }), commitmentCount);
    const contract = await prisma.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId! } });
    assert.equal(contract.status, originalContract.status); assert.equal(contract.salesApprovalRevision, originalContract.salesApprovalRevision);
    assert.equal(contract.customerAcceptanceRevision, originalContract.customerAcceptanceRevision);
    assert.equal(contract.firstFinancialRecordAt?.toISOString(), originalContract.firstFinancialRecordAt?.toISOString());
    assert.equal((await prisma.accountingFinancialVoidCase.findUniqueOrThrow({ where: { id: voidCase.id } })).status, 'COMPLETED');
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
