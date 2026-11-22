import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient, Prisma, type SalesContract } from '@prisma/client';
import { activeCreditForContract, creditBalance, synchronizeSellerCredit, createDispatchRequest, decideDispatchRequest, canReviewManagerDispatch, tehranDay } from '../contractDispatchCredit';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';
import { createContractDispatchDuty, closeContractDispatchDuty } from '../crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { processContractCreditReminders } from '../contractCreditReminders';
import { getCrossWorkspaceDutyDetail } from '../crossWorkspaceDutyInbox';
import { filterCurrentlyAuthorizedNotifications } from '../notificationAuthorization';

const url = process.env.LOCAL_QA_DATABASE_URL;
assert.ok(url, 'Use the existing sabalanerp-local database via LOCAL_QA_DATABASE_URL');
const target = new URL(url);
assert.ok(['localhost','127.0.0.1','postgres'].includes(target.hostname) && target.pathname === '/sabalanerp', 'Only sabalanerp-local is supported');
class Rollback extends Error {}
const fixture = async (run: (tx: Prisma.TransactionClient, contract: any, seller: any, admin: any) => Promise<void>) => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await assert.rejects(db.$transaction(async tx => {
      const source = await tx.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
      const admin = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
      const id = randomUUID();
      const seller = await tx.user.create({ data: { email: `${id}@credit-qa.invalid`, username: `credit-qa-${id}`, password: 'non-login-qa-fixture',
        firstName: 'آزمون', lastName: 'اعتبار', departmentId: source.departmentId } });
      await tx.sellerCreditAccount.create({ data: { sellerId: seller.id, limitRials: 1000, updatedBy: admin.id } });
      const contract = await tx.salesContract.create({ data: { contractNumber: `QA-CREDIT-${id}`, title: 'Credit QA', titlePersian: 'آزمون اعتبار', content: 'QA',
        customerId: source.customerId, departmentId: source.departmentId, createdBy: seller.id, responsibleSellerId: seller.id,
        totalAmount: 1000, currency: 'ریال', status: 'SIGNED', commercialFlowVersion: 1, commercialRevision: 1,
        salesApprovalRevision: 1, customerAcceptanceRevision: 1, commercialExpiresAt: new Date('2099-01-01') } });
      await run(tx, contract, seller, admin);
      throw new Rollback();
    }, { timeout: 60000 }), Rollback);
  } finally { await db.$disconnect(); }
};

for (const action of ['SUPERSEDED', 'WITHDRAW', 'REVOKE']) test(`dispatch ${action} cancels the open duty without recording a decision response`, () => fixture(async (tx, contract, seller, admin) => {
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER' });
  const duty = await createContractDispatchDuty(tx, request.id);
  await closeContractDispatchDuty(tx, request.id, admin.id, action, 'آزمون پایان درخواست');
  const closed = await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
  assert.equal(closed.status, 'CANCELLED');
  assert.equal(closed.respondedAt, null);
  assert.equal(closed.respondedByUserId, null);
  assert.deepEqual(closed.structuredResultJson, { actionCode: action, reason: 'آزمون پایان درخواست' });
  const audit = await tx.crossWorkspaceDutyAuditVersion.findFirstOrThrow({ where: { dutyId: duty.id, eventCode: 'CANCELLED' } });
  assert.equal(audit.actorUserId, admin.id);
  assert.equal(audit.reason, 'آزمون پایان درخواست');
  await closeContractDispatchDuty(tx, request.id, admin.id, action, 'تکرار');
  assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: duty.id, eventCode: 'CANCELLED' } }), 1);
}));

test('a new seller-credit promise in the past remains invalid after managerial rejection', () => fixture(async (tx, contract, seller, admin) => {
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER' });
  await decideDispatchRequest(tx, request.id, admin.id, 'DECLINE', 'رد درخواست مدیریتی');
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 1000,
    currency: 'ریال', paymentDate: new Date('2000-01-01') } });
  await assert.rejects(synchronizeSellerCredit(tx, contract, seller.id), /تاریخ وعده پرداخت باید امروز یا آینده باشد/);
  assert.equal(await tx.contractDispatchAuthority.count({ where: { contractId: contract.id, kind: 'CREDIT' } }), 0);
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { paymentDate: new Date('2099-01-01') } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  assert.equal((await creditBalance(tx, seller.id)).usedRials, '1000');
}));

test('a promise can start today and an unchanged saved credit date remains valid after it is due', () => fixture(async (tx, contract, seller) => {
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 1000,
    currency: 'ریال', paymentDate: new Date(tehranDay()) } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  const grant = await tx.contractDispatchAuthority.findFirstOrThrow({ where: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED' } });
  // Model a previously valid promise whose due date has now passed.
  await tx.contractDispatchAuthority.update({ where: { id: grant.id }, data: { promisedDate: new Date('2000-01-01') } });
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { paymentDate: new Date('2000-01-01') } });
  await synchronizeSellerCredit(tx, { ...contract, commercialRevision: 2 }, seller.id);
  const unchanged = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: grant.id } });
  assert.equal(unchanged.promisedDate!.toISOString().slice(0, 10), '2000-01-01');
  assert.equal(unchanged.revision, 2);
  assert.equal((await creditBalance(tx, seller.id)).usedRials, '1000');
}));

test('partial guarantee, financial release, reversal deficit, deactivation and cancellation use live evidence', () => fixture(async (tx, contract, seller) => {
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 300, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '700');
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), false);
  const record = await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id,
    amount: 1000, currency: 'ریال', createdBy: seller.id } });
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '700', 'a draft is not financial approval');
  await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { status: 'ISSUED', financiallyApprovedAt: new Date(),
    systemInvoiceNumber: randomUUID(), systemInvoiceDate: new Date(), sepidarAmount: 1000 } });
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '1000');
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), true);
  await tx.sellerCreditAccount.update({ where: { sellerId: seller.id }, data: { limitRials: 100 } });
  await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { status: 'VOIDED' } });
  assert.equal((await creditBalance(tx, seller.id)).balanceRials, '-200');
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), false);
  const inactive = await tx.salesContract.update({ where: { id: contract.id }, data: { isInactive: true } });
  assert.equal((await activeCreditForContract(tx, inactive)).toString(), '300');
  await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'CANCELLED' } });
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '100');
}));

test('whole guarantee and managerial shared duty preserve first-decision and revision boundaries', () => fixture(async (tx, contract, seller, admin) => {
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 1000, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), true);
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER' });
  const duty = await createContractDispatchDuty(tx, request.id);
  await respondToCrossWorkspaceDuty(tx, { dutyId: duty.id, actorUserId: admin.id, actionCode: 'APPROVE', expectedSourceVersion: 1,
    expectedEnvelopeVersion: 1, reason: null, policyVersion: 1, promisedDate: '2099-01-01' });
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '0', 'manager approval does not release Seller guarantee');
  await assert.rejects(decideDispatchRequest(tx, request.id, admin.id, 'DECLINE', 'تصمیم دوم'));
  await assert.rejects(createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER', promisedDate: '2099-01-02' }), /تأیید مدیریتی این نسخه برقرار است/);
  const changed = await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2, salesApprovalRevision: null, status: 'DRAFT' } });
  assert.equal(await ordinaryContractDispatchEligible(tx, changed), false);
}));

test('managerial request waits without a date, notifies independent role owners and publishes their explicit dated decision', () => fixture(async (tx, contract, seller, admin) => {
  // Broad Accounting administration does not make an ordinary user a Manager.
  await tx.workspacePermission.create({ data: { userId: seller.id, workspace: 'accounting', permissionLevel: 'admin' } });
  await tx.featurePermission.create({ data: { userId: seller.id, workspace: 'accounting', feature: 'accounting_actions_manage', permissionLevel: 'edit' } });
  assert.equal(await canReviewManagerDispatch(tx, seller.id), false);
  const manager = await tx.user.create({ data: { email: `${randomUUID()}@manager-qa.invalid`, username: `manager-${randomUUID()}`,
    password: 'non-login-qa-fixture', firstName: 'مدیر', lastName: 'آزمون', role: 'MANAGER' } });
  await tx.workspacePermission.create({ data: { userId: manager.id, workspace: 'accounting', permissionLevel: 'view' } });
  await tx.featurePermission.create({ data: { userId: manager.id, workspace: 'accounting', feature: 'accounting_contracts_view', permissionLevel: 'view' } });
  assert.equal(await canReviewManagerDispatch(tx, manager.id), true);
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER', promisedDate: '2099-01-01' });
  assert.equal(request.promisedDate, null, 'the requester cannot determine the payment promise');
  const duty = await createContractDispatchDuty(tx, request.id);
  assert.equal(duty.status, 'OPEN');
  assert.equal(duty.dueAt, null);
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), false);
  const notices = await tx.notification.findMany({ where: { referenceId: request.id }, include: { event: true } });
  assert.ok(notices.some(row => row.userId === admin.id && row.type === 'CONTRACT_MANAGER_DISPATCH_REQUESTED'));
  assert.ok(notices.some(row => row.userId === manager.id));
  assert.ok(!notices.some(row => row.userId === seller.id));
  const detail = await getCrossWorkspaceDutyDetail(tx, { dutyId: duty.id, actorUserId: manager.id, workspaceCode: 'ACCOUNTING' });
  assert.equal(detail.destinationHref, `/dashboard/accounting/contracts/${contract.id}`);
  assert.equal(detail.overdue, false);
  await assert.rejects(decideDispatchRequest(tx, request.id, seller.id, 'APPROVE', undefined, '2099-01-01'), /مجوز تصمیم/);
  await assert.rejects(decideDispatchRequest(tx, request.id, admin.id, 'APPROVE'), /تاریخ وعده پرداخت/);
  await assert.rejects(decideDispatchRequest(tx, request.id, manager.id, 'APPROVE', undefined, '2000-01-01'), /تاریخ وعده پرداخت/);
  await respondToCrossWorkspaceDuty(tx, { dutyId: duty.id, actorUserId: manager.id, actionCode: 'APPROVE', expectedSourceVersion: 1,
    expectedEnvelopeVersion: 1, reason: null, policyVersion: 1, promisedDate: '2099-02-03' });
  const approved = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.promisedDate!.toISOString().slice(0, 10), '2099-02-03');
  assert.equal(approved.decidedBy, manager.id);
  assert.ok(approved.decidedAt);
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), true);
  assert.equal((await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } })).status, 'COMPLETED');
  const result = await tx.notification.findFirstOrThrow({ where: { referenceId: request.id, userId: seller.id, type: 'CONTRACT_MANAGER_DISPATCH_DECIDED' } });
  assert.equal(result.actionUrl, `/dashboard/accounting/contracts/${contract.id}`);
  await assert.rejects(decideDispatchRequest(tx, request.id, admin.id, 'DECLINE', 'تصمیم دوم'), /قبلاً تعیین تکلیف/);
  await tx.user.update({ where: { id: manager.id }, data: { isActive: false } });
  assert.equal(await canReviewManagerDispatch(tx, manager.id), false);
  const managerNotice = notices.filter(row => row.userId === manager.id);
  assert.equal((await filterCurrentlyAuthorizedNotifications(tx, { id: manager.id, role: 'MANAGER', isActive: false }, managerNotice)).length, 0);
}));

test('Admin requester cannot decide their own request; independent rejection needs a reason and no date and permits a fresh request', () => fixture(async (tx, contract, seller, admin) => {
  const own = await createDispatchRequest(tx, contract, admin.id, { kind: 'MANAGER' });
  const duty = await createContractDispatchDuty(tx, own.id);
  await assert.rejects(decideDispatchRequest(tx, own.id, admin.id, 'APPROVE', undefined, '2099-01-01'), /مجوز تصمیم/);
  await assert.rejects(decideDispatchRequest(tx, own.id, admin.id, 'DECLINE', 'رد توسط درخواست‌کننده'), /مجوز تصمیم/);
  await assert.rejects(getCrossWorkspaceDutyDetail(tx, { dutyId: duty.id, actorUserId: admin.id, workspaceCode: 'ACCOUNTING' }));
  await tx.user.update({ where: { id: seller.id }, data: { role: 'ADMIN' } });
  await assert.rejects(decideDispatchRequest(tx, own.id, seller.id, 'DECLINE'), /دلیل رد/);
  await respondToCrossWorkspaceDuty(tx, { dutyId: duty.id, actorUserId: seller.id, actionCode: 'DECLINE', expectedSourceVersion: 1,
    expectedEnvelopeVersion: 1, reason: 'پرداخت پیش از ارسال لازم است', policyVersion: 1 });
  const rejected = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: own.id } });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.promisedDate, null);
  assert.equal(rejected.decidedBy, seller.id);
  assert.ok(rejected.decidedAt);
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), false);
  const resubmitted = await createDispatchRequest(tx, contract, admin.id, { kind: 'MANAGER' });
  assert.notEqual(resubmitted.id, own.id);
  assert.equal(resubmitted.status, 'PENDING');
  assert.equal(await tx.notification.count({ where: { referenceId: own.id, userId: admin.id, type: 'CONTRACT_MANAGER_DISPATCH_DECIDED' } }), 1);
}));

test('due reminder is published once without changing dispatch permission', () => fixture(async (tx, contract, seller, admin) => {
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 1000, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  // Scope the worker to this rollback fixture, including its notification recipients.
  const worker = new Proxy(tx, { get(target, key) {
    if (key === '$transaction') return (work: (db: Prisma.TransactionClient) => Promise<void>) => work(tx);
    if (key === 'user') return { findMany: async () => [{ id: admin.id }] };
    if (key === 'contractDispatchAuthority') return {
      findMany: (input: any) => tx.contractDispatchAuthority.findMany({ ...input, where: { ...input.where, contractId: contract.id } }),
    };
    return Reflect.get(target, key);
  } }) as unknown as PrismaClient;
  const before = await ordinaryContractDispatchEligible(tx, contract);
  await processContractCreditReminders(worker, new Date('2099-01-01T10:00:00Z'));
  await processContractCreditReminders(worker, new Date('2099-01-01T11:00:00Z'));
  assert.equal(await tx.notification.count({ where: { event: { resourceId: contract.id }, userId: admin.id, type: 'CONTRACT_PAYMENT_PROMISE_DUE' } }), 1);
  assert.equal(await ordinaryContractDispatchEligible(tx, contract), before);
}));

test('managerial promise reminder links a view-only Accounting manager to the Accounting contract', () => fixture(async (tx, contract, seller, admin) => {
  const manager = await tx.user.create({ data: { email: `${randomUUID()}@manager-qa.invalid`, username: `reminder-manager-${randomUUID()}`,
    password: 'non-login-qa-fixture', firstName: 'مدیر', lastName: 'یادآوری', role: 'MANAGER' } });
  await tx.workspacePermission.create({ data: { userId: manager.id, workspace: 'accounting', permissionLevel: 'view' } });
  await tx.featurePermission.create({ data: { userId: manager.id, workspace: 'accounting', feature: 'accounting_contracts_view', permissionLevel: 'view' } });
  assert.equal(await tx.workspacePermission.count({ where: { userId: manager.id, workspace: 'sales' } }), 0);
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER' });
  await decideDispatchRequest(tx, request.id, admin.id, 'APPROVE', undefined, '2099-01-01');
  const worker = new Proxy(tx, { get(target, key) {
    if (key === '$transaction') return (work: (db: Prisma.TransactionClient) => Promise<void>) => work(tx);
    if (key === 'user') return { findMany: async () => [{ id: manager.id }] };
    if (key === 'contractDispatchAuthority') return {
      findMany: (input: any) => tx.contractDispatchAuthority.findMany({ ...input, where: { ...input.where, contractId: contract.id } }),
    };
    return Reflect.get(target, key);
  } }) as unknown as PrismaClient;
  await processContractCreditReminders(worker, new Date('2099-01-01T10:00:00Z'));
  await processContractCreditReminders(worker, new Date('2099-01-01T11:00:00Z'));
  const notices = await tx.notification.findMany({ where: { event: { resourceId: contract.id }, userId: manager.id, type: 'CONTRACT_PAYMENT_PROMISE_DUE' } });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].actionUrl, `/dashboard/accounting/contracts/${contract.id}`);
}));

test('two concurrent Contract commits cannot spend the same available credit', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const ids: string[] = [];
  let sellerId = '';
  try {
    const source = await db.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
    const identity = randomUUID();
    const seller = await db.user.create({ data: { email: `${identity}@credit-qa.invalid`, username: `credit-race-${identity}`, password: 'non-login-qa-fixture',
      firstName: 'آزمون', lastName: 'همزمانی', departmentId: source.departmentId } });
    sellerId = seller.id;
    await db.sellerCreditAccount.create({ data: { sellerId, limitRials: 1000, updatedBy: sellerId } });
    const contracts: SalesContract[] = [];
    for (let index = 0; index < 2; index++) {
      const contract = await db.salesContract.create({ data: { contractNumber: `QA-CREDIT-RACE-${identity}-${index}`, title: 'Credit race QA', titlePersian: 'آزمون همزمانی اعتبار', content: 'QA',
        customerId: source.customerId, departmentId: source.departmentId, createdBy: sellerId, responsibleSellerId: sellerId,
        totalAmount: 700, currency: 'ریال', commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date('2099-01-01') } });
      ids.push(contract.id); contracts.push(contract);
    }
    const results = await Promise.allSettled(contracts.map(contract => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "sales_contracts" WHERE "id"=${contract.id} FOR UPDATE`;
      await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 700, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
      await synchronizeSellerCredit(tx, contract, sellerId);
    }, { timeout: 30000 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await creditBalance(db, sellerId)).availableRials, '300');
    assert.equal(await db.payment.count({ where: { contractId: { in: ids }, paymentMethod: 'SELLER_CREDIT' } }), 1, 'failed commit does not leave a payment row');
  } finally {
    if (ids.length) {
      await db.accountingAuditLog.deleteMany({ where: { contractId: { in: ids } } });
      await db.contractDispatchAuthority.deleteMany({ where: { contractId: { in: ids } } });
      await db.salesContract.deleteMany({ where: { id: { in: ids } } });
    }
    if (sellerId) { await db.sellerCreditAccount.deleteMany({ where: { sellerId } }); await db.user.delete({ where: { id: sellerId } }); }
    await db.$disconnect();
  }
});

test('date decisions preserve the previous deadline until approval and guarantee transfer requires the new Seller', () => fixture(async (tx, contract, seller, admin) => {
  await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT', totalAmount: 300, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
  await synchronizeSellerCredit(tx, contract, seller.id);
  const original = await tx.contractDispatchAuthority.findFirstOrThrow({ where: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED' } });
  const dateRequest = await createDispatchRequest(tx, contract, seller.id, { kind: 'DATE', targetAuthorityId: original.id, promisedDate: '2099-02-01', reason: 'وعده جدید مشتری' });
  assert.equal((await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: original.id } })).promisedDate!.toISOString().slice(0, 10), '2099-01-01');
  await decideDispatchRequest(tx, dateRequest.id, admin.id, 'APPROVE');
  assert.equal((await tx.payment.findFirstOrThrow({ where: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT' } })).paymentDate!.toISOString().slice(0, 10), '2099-02-01');
  const balance = await creditBalance(tx, admin.id);
  await tx.sellerCreditAccount.upsert({ where: { sellerId: admin.id }, update: { limitRials: new Prisma.Decimal(balance.usedRials).plus(1000) },
    create: { sellerId: admin.id, limitRials: new Prisma.Decimal(balance.usedRials).plus(1000), updatedBy: admin.id } });
  const reassigned = await tx.salesContract.update({ where: { id: contract.id }, data: { responsibleSellerId: admin.id } });
  assert.equal((await creditBalance(tx, seller.id)).usedRials, '300', 'responsibility reassignment alone does not move the guarantee');
  const transfer = await createDispatchRequest(tx, reassigned, admin.id, { kind: 'TRANSFER', targetAuthorityId: original.id,
    targetSellerId: admin.id, promisedDate: '2099-02-01', reason: 'پذیرش مسئولیت ضمانت' });
  await assert.rejects(decideDispatchRequest(tx, transfer.id, seller.id, 'APPROVE'));
  await decideDispatchRequest(tx, transfer.id, admin.id, 'APPROVE');
  assert.equal((await creditBalance(tx, seller.id)).usedRials, '0');
  assert.equal((await creditBalance(tx, admin.id)).availableRials, '700');
  assert.equal((await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: original.id } })).status, 'SUPERSEDED');
}));
