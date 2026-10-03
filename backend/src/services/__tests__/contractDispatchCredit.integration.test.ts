import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient, Prisma, type SalesContract } from '@prisma/client';
import { activeCreditForContract, creditBalance, synchronizeSellerCredit, createDispatchRequest, decideDispatchRequest } from '../contractDispatchCredit';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';
import { createContractDispatchDuty } from '../crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { processContractCreditReminders } from '../contractCreditReminders';

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
  const request = await createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER', promisedDate: '2099-01-01' });
  const duty = await createContractDispatchDuty(tx, request.id);
  await respondToCrossWorkspaceDuty(tx, { dutyId: duty.id, actorUserId: admin.id, actionCode: 'APPROVE', expectedSourceVersion: 1,
    expectedEnvelopeVersion: 1, reason: null, policyVersion: 1 });
  assert.equal((await creditBalance(tx, seller.id)).availableRials, '0', 'manager approval does not release Seller guarantee');
  await assert.rejects(decideDispatchRequest(tx, request.id, admin.id, 'DECLINE', 'تصمیم دوم'));
  await assert.rejects(createDispatchRequest(tx, contract, seller.id, { kind: 'MANAGER', promisedDate: '2099-01-02' }), /تأیید مدیریتی این نسخه برقرار است/);
  const changed = await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2, salesApprovalRevision: null, status: 'DRAFT' } });
  assert.equal(await ordinaryContractDispatchEligible(tx, changed), false);
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
  assert.equal((await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: original.id } })).promisedDate.toISOString().slice(0, 10), '2099-01-01');
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
