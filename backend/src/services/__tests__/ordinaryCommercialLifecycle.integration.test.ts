import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { approveOrdinarySales, markCustomerAcceptance, commercialStartFields,
  renewOrdinaryContract, invalidateCommercialApprovals, canManageCommercialSettings } from '../ordinaryContractLifecycle';
import { assertOrdinaryAccountingCommercialGate } from '../ordinaryAccountingCommercialGate';
import { reconcileOrdinaryFinancialRealization, snapshotRealizedSale } from '../salesAttributionService';
import { updateContract } from '../contractService';
import { requestAccountingSalesContractCorrection } from '../salesContractCorrectionDuty';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { completeSalesCorrectionEditDuty } from '../crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';

const databaseUrl = process.env.ORDINARY_CONTRACT_QA_DATABASE_URL
  || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10';
const location = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '55432'
  && location.pathname === '/sabalanerp', 'Integration QA requires existing sabalanerp-local database');

class RollbackFixture extends Error {}
const inFixture = async (run: (tx: Prisma.TransactionClient, contract: any) => Promise<void>) => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(database.$transaction(async tx => {
      const source = await tx.salesContract.findFirst({ where: { partnerKind: null, partnerCaseId: null, productGraphState: { isNot: null } }, include: { productGraphState: true } });
      assert.ok(source, 'Local QA needs an existing ordinary contract for identity references');
      const contract = await tx.salesContract.create({ data: {
        contractNumber: `QA-COMMERCIAL-${randomUUID()}`, title: 'Isolated lifecycle QA', titlePersian: 'آزمون گردش قرارداد',
        content: 'QA', customerId: source.customerId, departmentId: source.departmentId,
        createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId,
        totalAmount: 100, currency: 'ریال', ...await commercialStartFields(tx),
      } });
      const graph = source.productGraphState!;
      await tx.salesContractProductGraphState.create({ data: { contractId: contract.id, schemaVersion: graph.schemaVersion, revision: graph.revision, graph: graph.graph as Prisma.InputJsonValue, policySnapshot: graph.policySnapshot as Prisma.InputJsonValue, inputHash: graph.inputHash, resultHash: graph.resultHash, totalAmountToman: graph.totalAmountToman } });
      await run(tx, contract);
      throw new RollbackFixture();
    }, { timeout: 30_000 }), RollbackFixture);
  } finally { await database.$disconnect(); }
};

for (const flowVersion of [0, 1]) test(`editor save commits its edits and cancellation together (flow ${flowVersion})`, () => inFixture(async (tx, contract) => {
  const source = await tx.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null,
    productGraphState: { isNot: null }, id: { not: contract.id }, contractData: { not: Prisma.DbNull } } });
  const admin = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  await tx.salesContract.update({ where: { id: contract.id }, data: {
    contractData: source.contractData as Prisma.InputJsonValue, content: source.content,
    totalAmount: source.totalAmount, currency: source.currency, commercialFlowVersion: flowVersion,
  } });
  const client = new Proxy(tx, { get(target, property) {
    if (property === '$transaction') return (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx);
    return Reflect.get(target, property);
  } }) as unknown as PrismaClient;
  const edit = { notes: 'ویرایش همراه لغو', cancelContract: true };
  const authority = { cancellationAuthority: { canCancelApproved: true } };
  await assert.rejects(updateContract(contract.id, edit, admin.id, client), /Access denied/);
  await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'APPROVED' } });
  await assert.rejects(updateContract(contract.id, edit, admin.id, client,
    { cancellationAuthority: { canCancelApproved: false } }), /بدون دسترسی ویژه/);
  await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'DRAFT' } });
  let correctionId: string | undefined;
  if (flowVersion === 1) {
    await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'SIGNED',
      salesApprovalRevision: 1, customerAcceptanceRevision: 1 } });
    await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
      contractId: contract.id, amount: Number(source.totalAmount), createdBy: admin.id } });
    await snapshotRealizedSale(tx, contract.id, admin.id, new Date(), 'FINANCIAL_RECORD');
    await assert.rejects(updateContract(contract.id, edit, admin.id, client, authority), /approved formal correction/);
    const requested = await requestAccountingSalesContractCorrection(tx, { contractId: contract.id,
      actorUserId: admin.id, category: 'OTHER', priority: 'MEDIUM', reason: 'آزمون لغو همراه اصلاح', idempotencyKey: randomUUID() });
    correctionId = requested.correction.id;
    await respondToCrossWorkspaceDuty(tx, { dutyId: requested.duty.id, actorUserId: admin.id,
      actionCode: 'APPROVE', expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null, policyVersion: 2 });
  }
  const before = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
  const graphBefore = await tx.salesContractProductGraphState.findUniqueOrThrow({ where: { contractId: contract.id } });
  const failingClient = new Proxy(client, { get(target, property) {
    if (property !== '$transaction') return Reflect.get(target, property);
    return async (work: (transaction: Prisma.TransactionClient) => unknown) => {
      await tx.$executeRawUnsafe('SAVEPOINT cancellation_save_failure');
      try {
        return await work(new Proxy(tx, { get(transaction, key) {
          if (key === 'contractConfirmationAuditLog') return new Proxy(transaction.contractConfirmationAuditLog, {
            get(delegate, method) { return method === 'create' ? () => { throw new Error('injected cancellation audit failure'); }
              : Reflect.get(delegate, method); },
          });
          return Reflect.get(transaction, key);
        } }));
      } catch (error) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT cancellation_save_failure');
        throw error;
      } finally {
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT cancellation_save_failure');
      }
    };
  } });
  await assert.rejects(updateContract(contract.id, edit, admin.id, failingClient, authority), /injected cancellation audit failure/);
  assert.deepEqual(await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } }), before);
  assert.deepEqual(await tx.salesContractProductGraphState.findUniqueOrThrow({ where: { contractId: contract.id } }), graphBefore);
  assert.equal(await tx.contractConfirmationAuditLog.count({ where: { contractId: contract.id } }), 0);
  if (correctionId) assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: correctionId } })).status,
    'APPROVED_FOR_SALES_EDIT');
  const saved = await updateContract(contract.id, edit,
    admin.id, client, { cancellationAuthority: { canCancelApproved: true } });
  assert.equal(saved.status, 'CANCELLED');
  assert.equal(saved.notes, 'ویرایش همراه لغو');
  assert.equal(saved.commercialRevision, flowVersion === 1 ? 2 : 1);
  if (flowVersion === 1) assert.equal(saved.commercialExpiresAt!.getTime(), contract.commercialExpiresAt.getTime());
  assert.equal((saved.signatures as any).cancellation.previousStatus, 'DRAFT');
  assert.equal(await tx.contractConfirmationAuditLog.count({ where: { contractId: contract.id, eventType: 'CONTRACT_CANCELLED' } }), 1);
  if (correctionId) {
    assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: correctionId } })).status, 'SALES_EDITED');
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: correctionId,
      sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', status: 'OPEN' } }), 1);
    assert.equal((await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } }))
      .reduce((net, event) => net + Number(event.amount), 0), 0);
  }
}));

test('both approval orders require evidence from the current revision and commercial finality gates finance', () => inFixture(async (tx, contract) => {
  await assert.rejects(assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE'));
  const salesFirst = await approveOrdinarySales(tx, contract.id, contract.createdBy, undefined, 1);
  assert.equal(salesFirst.status, 'PENDING_APPROVAL');
  const final = await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' });
  assert.equal(final.status, 'SIGNED');
  await assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE', 1);
  await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2,
    status: 'DRAFT', salesApprovalRevision: null, customerAcceptanceRevision: null } });
  await invalidateCommercialApprovals(tx, contract.id);
  await assert.rejects(markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' }));
  const customerFirst = await markCustomerAcceptance(tx, { contractId: contract.id, revision: 2, actorId: contract.createdBy, method: 'PAPER' });
  assert.equal(customerFirst.status, 'APPROVED');
  assert.equal((await approveOrdinarySales(tx, contract.id, contract.createdBy, undefined, 2)).status, 'SIGNED');
}));

test('renewal restores note and a new deadline, while previous revision approval stays invalid', () => inFixture(async (tx, contract) => {
  await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'EXPIRED', commercialExpiresAt: new Date(0) } });
  const renewed = await renewOrdinaryContract(tx, contract.id, contract.createdBy, 'تمدید برای آزمون');
  assert.equal(renewed.status, 'DRAFT');
  assert.equal(renewed.commercialRevision, 2);
  assert.ok(renewed.commercialExpiresAt! > new Date());
  await assert.rejects(markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' }));
}));

test('first financial record realizes once; deleting last reverses and replacement restores without double counting', () => inFixture(async (tx, contract) => {
  await approveOrdinarySales(tx, contract.id, contract.createdBy, undefined, 1);
  await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' });
  const first = await tx.accountingFinancialRecord.create({ data: {
    kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id, amount: 100, createdBy: contract.createdBy,
  } });
  await tx.salesContract.update({ where: { id: contract.id }, data: { firstFinancialRecordAt: new Date() } });
  const reconcile = (key: string) => reconcileOrdinaryFinancialRealization(tx, {
    contractId: contract.id, actorId: contract.createdBy, sourceKey: key,
  });
  await reconcile(`create:${first.id}`);
  await reconcile(`create:${first.id}`);
  await tx.accountingFinancialRecord.delete({ where: { id: first.id } });
  await reconcile(`delete:${first.id}`);
  let events = await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } });
  assert.equal(events.reduce((sum, event) => sum + Number(event.amount), 0), 0);
  const replacement = await tx.accountingFinancialRecord.create({ data: {
    kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id, amount: 100, createdBy: contract.createdBy,
  } });
  await reconcile(`create:${replacement.id}`);
  events = await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } });
  assert.equal(events.filter(event => event.eventType === 'REALIZED').length, 1);
  assert.equal(events.reduce((sum, event) => sum + Number(event.amount), 0), 100);
  await tx.salesContract.update({ where: { id: contract.id }, data: { commercialExpiresAt: new Date(0) } });
  await assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE');
}));

test('voided receivable companions do not preserve realized sales, including historical audit-linked companions', () => inFixture(async (tx, contract) => {
  const invoice = await tx.accountingFinancialRecord.create({ data: {
    kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id, amount: 100, createdBy: contract.createdBy,
  } });
  const receivable = await tx.accountingReceivable.create({ data: {
    contractId: contract.id, invoiceRecordId: invoice.id, originalAmount: 100, remainingAmount: 100,
    dueDate: new Date(), createdBy: contract.createdBy,
  } });
  const companion = await tx.accountingFinancialRecord.create({ data: {
    kind: 'RECEIVABLE', status: 'READY', sourceKind: 'SALES_CONTRACT', contractId: contract.id,
    amount: 100, createdBy: contract.createdBy, metadata: { receivableId: receivable.id },
  } });
  const reconcile = (sourceKey: string) => reconcileOrdinaryFinancialRealization(tx, {
    contractId: contract.id, actorId: contract.createdBy, sourceKey,
  });
  await reconcile(`create:${invoice.id}`);
  await tx.accountingFinancialRecord.update({ where: { id: invoice.id }, data: { status: 'VOIDED' } });
  await reconcile(`void:${invoice.id}`);
  assert.equal((await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } }))
    .reduce((sum, event) => sum + Number(event.amount), 0), 100);
  // Before the new metadata identity existed, the CREATE_RECEIVABLE audit is the exact link.
  await tx.accountingFinancialRecord.update({ where: { id: companion.id }, data: { metadata: {} } });
  await tx.accountingAuditLog.create({ data: { action: 'CREATE_RECEIVABLE', actorId: contract.createdBy,
    contractId: contract.id, recordId: companion.id, entityType: 'AccountingReceivable', entityId: receivable.id } });
  await tx.accountingReceivable.update({ where: { id: receivable.id }, data: { status: 'VOIDED' } });
  await reconcile(`void:${receivable.id}`);
  const events = await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } });
  assert.equal(events.reduce((sum, event) => sum + Number(event.amount), 0), 0);
  assert.equal(events.filter(event => event.eventType === 'REALIZED').length, 1);
  assert.equal((await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: companion.id } })).status, 'READY');
}));

test('legacy status keeps accounting eligibility while new customer-only acceptance cannot create finance', () => inFixture(async (tx, contract) => {
  await tx.salesContract.update({ where: { id: contract.id }, data: { commercialFlowVersion: 0, status: 'APPROVED' } });
  await assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE');
  await tx.salesContract.update({ where: { id: contract.id }, data: { commercialFlowVersion: 1, customerAcceptanceRevision: 1 } });
  await assert.rejects(assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE'));
}));

test('paper acceptance is idempotent and cannot overwrite digital acceptance evidence', () => inFixture(async (tx, contract) => {
  await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'DIGITAL', sessionId: 'qa-digital' });
  const repeat = await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' });
  assert.equal(repeat.customerAcceptanceMethod, 'DIGITAL');
  assert.equal((repeat.signatures as any).customerAcceptance.sessionId, 'qa-digital');
  assert.equal(await tx.accountingAuditLog.count({ where: { contractId: contract.id, action: 'COMMERCIAL_CUSTOMER_PAPER_ACCEPTED' } }), 0);
}));

test('a correction permits repeated saves; commercial finality closes it and expiry records a separate system outcome', () => inFixture(async (tx, contract) => {
  const source = await tx.salesContract.findFirst({ where: { partnerKind: null, partnerCaseId: null, productGraphState: { isNot: null },
    id: { not: contract.id }, contractData: { not: Prisma.DbNull } } });
  assert.ok(source);
  const admin = await tx.user.findFirst({ where: { role: 'ADMIN' } });
  assert.ok(admin);
  const catalog = await tx.product.findFirst();
  assert.ok(catalog);
  const identity = source.contractData as any;
  const commercialData: any = { customerId: identity.customerId, customer: identity.customer, projectId: identity.projectId, project: identity.project, products: [{ rowId: `qa-prepared-${randomUUID()}`,
    productId: catalog.id, productType: 'prepared', preparedKind: 'readyPiece', preparedUnit: 'count', preparedQuantity: 1,
    quantity: 1, squareMeters: 0, unitPrice: 100, pricePerSquareMeter: 100, totalPrice: 100, originalTotalPrice: 100,
    stoneName: 'سنگ آزمون اصلاح مبلغ', currency: 'تومان', appliedSubServices: [], finishings: [], cuttingCost: 0,
    physicalCuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } }], serviceRows: [], discount: null,
    payment: { currency: 'تومان', totalContractAmount: 100, payments: [] } };
  delete commercialData.monetaryRounding;
  await tx.salesContract.update({ where: { id: contract.id }, data: { contractData: commercialData,
    content: source.content, customerId: source.customerId, departmentId: source.departmentId,
    currency: 'تومان', totalAmount: 100, firstFinancialRecordAt: new Date() } });
  await approveOrdinarySales(tx, contract.id, contract.createdBy, undefined, 1);
  await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' });
  await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
    contractId: contract.id, amount: 1000, currency: 'ریال', createdBy: admin.id } });
  await snapshotRealizedSale(tx, contract.id, admin.id, new Date(), 'FINANCIAL_RECORD');
  const request = await requestAccountingSalesContractCorrection(tx, { contractId: contract.id, actorUserId: admin.id,
    category: 'OTHER', priority: 'MEDIUM', reason: 'آزمون دوره اصلاح چند ذخیره', idempotencyKey: randomUUID() });
  const approved = await respondToCrossWorkspaceDuty(tx, { dutyId: request.duty.id, actorUserId: admin.id,
    actionCode: 'APPROVE', expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null, policyVersion: 2 });
  const client = new Proxy(tx, { get(target, property) {
    if (property === '$transaction') return (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx);
    return Reflect.get(target, property);
  } }) as unknown as PrismaClient;
  const first = await updateContract(contract.id, { notes: 'ذخیره اول' }, admin.id, client);
  assert.equal(first.status, 'DRAFT');
  assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.correction.id } })).status, 'APPROVED_FOR_SALES_EDIT');
  const scalePrices = (value: any, factor: number): any => {
    if (Array.isArray(value)) return value.map(item => scalePrices(item, factor));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /price|amount|cost|rateToman|subtotal/i.test(key) && (typeof item === 'number' || typeof item === 'string') && Number.isFinite(Number(item))
        ? Number(item) * factor : scalePrices(item, factor)]));
  };
  const second = await updateContract(contract.id, { notes: 'ذخیره دوم', contractData: scalePrices(commercialData, 2),
    totalAmount: 200 }, admin.id, client);
  assert.equal(second.commercialRevision, 3);
  const third = await updateContract(contract.id, { notes: 'ذخیره سوم', contractData: scalePrices(commercialData, 3),
    totalAmount: 300 }, admin.id, client);
  assert.equal(third.commercialRevision, 4);
  const reporting = await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } });
  assert.equal(reporting.filter(event => event.eventType === 'ADJUSTMENT').length, 2);
  assert.equal(reporting.reduce((sum, event) => sum + Number(event.amount), 0), Number(third.totalAmount));
  assert.equal((await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: approved.successor!.id } })).status, 'OPEN');
  await approveOrdinarySales(tx, contract.id, admin.id, undefined, 4);
  await markCustomerAcceptance(tx, { contractId: contract.id, revision: 4, actorId: admin.id, method: 'PAPER' });
  assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.correction.id } })).status, 'SALES_EDITED');
  const verify = await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: request.correction.id,
    sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', status: 'OPEN' } });
  await respondToCrossWorkspaceDuty(tx, { dutyId: verify.id, actorUserId: admin.id, actionCode: 'RETURN_TO_SELLER',
    expectedSourceVersion: verify.sourceVersion, expectedEnvelopeVersion: verify.envelopeVersion,
    reason: 'آزمون اجازه تازه مدیر', policyVersion: 2 });
  const managerDuty = await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: request.correction.id,
    sourceActionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION', status: 'OPEN' } });
  const renewed = await respondToCrossWorkspaceDuty(tx, { dutyId: managerDuty.id, actorUserId: admin.id, actionCode: 'APPROVE',
    expectedSourceVersion: managerDuty.sourceVersion, expectedEnvelopeVersion: managerDuty.envelopeVersion, reason: null, policyVersion: 2 });
  await tx.crossWorkspaceDuty.update({ where: { id: renewed.successor!.id }, data: { dueAt: new Date(0) } });
  await assert.rejects(updateContract(contract.id, { notes: 'ذخیره ممنوع پس از مهلت' }, admin.id, client), /DUTY_SALES_EDIT_EXPIRED/);
  const expired = await completeSalesCorrectionEditDuty(tx, { contractId: contract.id, actorUserId: 'system:commercial-correction-expiry',
    note: 'مهلت دوره بدون ذخیره جدید پایان یافت', policyVersion: 2, now: new Date(), periodExpired: true });
  assert.equal((expired.predecessor!.structuredResultJson as any).actionCode, 'EDIT_PERIOD_EXPIRED');
  assert.equal(expired.predecessor!.respondedByUserId, 'system:commercial-correction-expiry');
  assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).notes, 'ذخیره سوم');
  assert.equal(await tx.accountingAuditLog.count({ where: { contractId: contract.id, action: 'SALES_CORRECTION_PERIOD_EXPIRED' } }), 1);
}));

test('actual applied receipts qualify settlement while an uncleared check or lost receipt blocks dispatch', () => inFixture(async (tx, contract) => {
  assert.equal(await tx.accountingReplacementCutoverRun.count({ where: { authorityTransferredAt: { not: null }, sabalanAuthoritative: true } }), 0,
    'This fixture exercises pre-cutover receipts, never changes live authority');
  await approveOrdinarySales(tx, contract.id, contract.createdBy, undefined, 1);
  const final = await markCustomerAcceptance(tx, { contractId: contract.id, revision: 1, actorId: contract.createdBy, method: 'PAPER' });
  const receivable = await tx.accountingReceivable.create({ data: { contractId: contract.id, customerId: contract.customerId,
    originalAmount: 100, remainingAmount: 100, dueDate: new Date(), createdBy: contract.createdBy } });
  assert.equal(await ordinaryContractDispatchEligible(tx, final), false);
  const payment = await tx.accountingPaymentStatus.create({ data: { contractId: contract.id, receivableId: receivable.id,
    method: 'CHECK', amount: 100, status: 'RECEIVED', checkStatus: 'RECEIVED', createdBy: contract.createdBy } });
  assert.equal(await ordinaryContractDispatchEligible(tx, final), false);
  await tx.accountingPaymentStatus.update({ where: { id: payment.id }, data: { checkStatus: 'CLEARED' } });
  assert.equal(await ordinaryContractDispatchEligible(tx, final), true);
  await tx.accountingPaymentStatus.delete({ where: { id: payment.id } });
  assert.equal(await ordinaryContractDispatchEligible(tx, final), false);
}));

test('expiration configuration requires effective Sales administration, not global Manager title', () => inFixture(async (tx, contract) => {
  const key = randomUUID();
  const manager = await tx.user.create({ data: { username: `qa-permission-${key}`, email: `${key}@example.invalid`,
    password: 'isolated-not-login', role: 'MANAGER', firstName: 'QA', lastName: 'Manager' } });
  // Remove inherited Sales authority only inside the transaction that is rolled back.
  await tx.roleWorkspacePermission.deleteMany({ where: { role: 'MANAGER', workspace: 'sales' } });
  assert.equal(await canManageCommercialSettings(tx, manager), false);
  const grant = await tx.workspacePermission.create({ data: { userId: manager.id, workspace: 'sales', permissionLevel: 'admin',
    grantedBy: contract.createdBy } });
  assert.equal(await canManageCommercialSettings(tx, manager), true);
  await tx.workspacePermission.update({ where: { id: grant.id }, data: { expiresAt: new Date(0) } });
  assert.equal(await canManageCommercialSettings(tx, manager), false);
}));
