import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { ordinaryContractDispatchEligible, obligationsFullySettled } from '../ordinaryContractDispatchEligibility';

const contract = { id: 'c1', commercialFlowVersion: 1, commercialRevision: 2,
  salesApprovalRevision: 2, customerAcceptanceRevision: 2, status: 'SIGNED', totalAmount: 100, currency: 'IRT' };
const db = (payments: any[], authoritative = false, allocated = 1000): any => ({
  accountingFinancialRecord: { findMany: async () => [] },
  contractDispatchAuthority: { findFirst: async () => null },
  accountingReplacementCutoverRun: { findMany: async () => authoritative ? [{ bookId: 'b1' }] : [] },
  accountingReceivable: { findMany: async () => [{ originalAmount: 1000, paymentStatuses: payments }] },
  accountingCustomerOpenItem: { findMany: async () => [{ originalRials: 1000, invoice: { ledgerVoucherId: 'invoice-voucher' },
    allocationLines: [{ amountRials: allocated, allocation: { ledgerVoucherId: 'allocation-voucher',
      transaction: { postedVoucherId: 'receipt-voucher', sourceType: 'BANK_RECEIPT' } } }] }] },
  accountingLedgerVoucher: { findMany: async () => ['invoice-voucher', 'allocation-voucher', 'receipt-voucher'].map(id => ({ id })) },
  accountingCheckInstrument: { findMany: async () => [] },
});
test('commercial approval alone and planned payments never permit loading', async () => {
  assert.equal(await ordinaryContractDispatchEligible(db([]), contract), false);
  assert.equal(await ordinaryContractDispatchEligible(db([{ method: 'CASH', status: 'RECEIVED', amount: 1000 }]),
    { ...contract, customerAcceptanceRevision: 1 }), false);
});
test('received checks are insufficient until cleared, and reversal relocks preparation', async () => {
  const receipt = { method: 'CHECK', status: 'RECEIVED', checkStatus: 'RECEIVED', amount: 1000 };
  assert.equal(await ordinaryContractDispatchEligible(db([receipt]), contract), false);
  assert.equal(await ordinaryContractDispatchEligible(db([{ ...receipt, checkStatus: 'CLEARED' }]), contract), true);
  assert.equal(await ordinaryContractDispatchEligible(db([{ ...receipt, status: 'REVERSED', checkStatus: 'BOUNCED' }]), contract), false);
});
test('ledger authority cannot fall back to paid legacy receipts after allocation reversal', async () => {
  const paid = [{ method: 'CASH', status: 'RECEIVED', amount: 1000 }];
  assert.equal(await ordinaryContractDispatchEligible(db(paid, true, 0), contract), false);
  assert.equal(await ordinaryContractDispatchEligible(db([], true, 1000), contract), true);
});
test('one paid obligation cannot conceal another unpaid obligation', () => {
  assert.equal(obligationsFullySettled(1000, [{ original: 500, applied: 1000 }, { original: 500, applied: 0 }]), false);
  assert.equal(obligationsFullySettled(1000, []), false);
});
test('existing ordinary contracts require financial approval or another valid dispatch authority', async () => {
  assert.equal(await ordinaryContractDispatchEligible(db([]), { ...contract, commercialFlowVersion: 0 }), false);
  const approved = db([]);
  approved.accountingFinancialRecord.findMany = async () => [{ amount: new Prisma.Decimal(100), sepidarAmount: new Prisma.Decimal(100), systemInvoiceNumber: 'Q1', systemInvoiceDate: new Date() }];
  assert.equal(await ordinaryContractDispatchEligible(approved, { ...contract, commercialFlowVersion: 0 }), true);
});
test('manager approval permits whole-contract dispatch without receipt; finality still applies', async () => {
  const manager = db([]);
  manager.contractDispatchAuthority.findFirst = async ({ where }: any) => where.kind === 'MANAGER' ? { id: 'manager' } : null;
  assert.equal(await ordinaryContractDispatchEligible(manager, contract), true);
  assert.equal(await ordinaryContractDispatchEligible(manager, { ...contract, salesApprovalRevision: 1 }), false);
});
test('partial credit needs real receipt coverage and never treats the payment plan as cash', async () => {
  const credit = db([]);
  credit.contractDispatchAuthority.findFirst = async ({ where }: any) => where.kind === 'CREDIT' ? { amountRials: new Prisma.Decimal(300) } : null;
  assert.equal(await ordinaryContractDispatchEligible(credit, contract), false);
  credit.accountingReceivable.findMany = async () => [{ originalAmount: 1000, paymentStatuses: [{ method: 'CASH', status: 'RECEIVED', amount: 700 }] }];
  assert.equal(await ordinaryContractDispatchEligible(credit, contract), true);
});
