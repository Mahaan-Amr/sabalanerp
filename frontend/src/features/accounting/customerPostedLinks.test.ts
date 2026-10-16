import assert from 'node:assert/strict';
import test from 'node:test';
import { recordForPostedItem, postedReceiptShares } from './customerPostedLinks';
import type { AccountItem, CustomerAccount } from './customerAccountModel';
const account = { financialRecords: [{ id: 'one', contractId: 'contract', systemInvoiceNumber: '987' }, { id: 'two', contractId: 'contract', systemInvoiceNumber: '988' }], receipts: [{ id: 'receipt', allocations: [{ id: 'active', reversedAt: null, lines: [{ openItemId: 'item', amountRials: '30' }, { openItemId: 'other', amountRials: '20' }] }, { id: 'old', reversedAt: '2026-01-01', lines: [{ openItemId: 'item', amountRials: '99' }] }] }] } as unknown as CustomerAccount;
const item = { id: 'item', sourceKind: 'OPENING', contractId: 'contract', invoiceNumber: '987' } as AccountItem;
test('opening requires explicit invoice identity even when the contract and invoice label match', () => {
  assert.equal(recordForPostedItem(account, item), undefined);
  assert.equal(recordForPostedItem(account, { ...item, financialRecordId: 'two' })?.id, 'two');
  assert.equal(recordForPostedItem(account, { ...item, financialRecordId: 'one', contractId: 'foreign' }), undefined);
  assert.equal(recordForPostedItem(account, { ...item, financialRecordId: 'missing' }), undefined);
});
test('native sale number is linked only if unique inside the same contract', () => {
  assert.equal(recordForPostedItem(account, { ...item, sourceKind: 'SALE' })?.id, 'one');
  assert.equal(recordForPostedItem({ ...account, financialRecords: [...account.financialRecords, { ...account.financialRecords[0], id: 'duplicate' }] }, { ...item, sourceKind: 'SALE' }), undefined);
});
test('receipt detail uses active allocation line share rather than full receipt or reversed allocations', () => {
  const shares = postedReceiptShares(account, 'item');
  assert.equal(shares.length, 1); assert.equal(shares[0].amountRials, '30'); assert.equal(shares[0].allocation.id, 'active');
});
