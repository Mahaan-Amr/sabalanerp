import assert from 'node:assert/strict';
import test from 'node:test';
import { accountMoney, normalizeAccountAmount, type CustomerAccount } from './customerAccountModel';
import { customerMovements } from './customerMovements';

test('customer money preserves currency, Persian input and integers beyond Number precision', () => {
  assert.equal(normalizeAccountAmount('−۱٬۲۳۴'), '−1234');
  assert.equal(normalizeAccountAmount('-۱٬۲۳۴'), '-1234');
  assert.equal(accountMoney('9007199254740993'), `${BigInt('9007199254740993').toLocaleString('fa-IR')} ریال`);
  assert.equal(accountMoney('100.50', 'تومان'), '۱۰۰٫۵ تومان');
  assert.equal(accountMoney('0'), '۰ ریال');
});
test('settled history, refunds and allocation reversals reconcile to one net position', () => {
  const data = { activityItems: [{ id: 'invoice', kind: 'RECEIVABLE', sourceKind: 'SALE', invoiceNumber: '۱', originalRials: '1000', postedAt: '2026-01-01', ledgerVoucherId: 'v1', contractId: 'c1' },
    { id: 'credit', kind: 'CREDIT', sourceKind: 'CREDIT', description: 'تخفیف', originalRials: '100', postedAt: '2026-01-04', ledgerVoucherId: 'v4', contractId: null }],
    receipts: [{ id: 'receipt', amountRials: '600', occurredAt: '2026-01-02', postedVoucherId: 'v2', allocations: [{ id: 'allocation', createdAt: '2026-01-03', reversedAt: '2026-01-06', ledgerVoucherId: 'v3', reversalVoucherId: 'v6', lines: [{ amountRials: '300', openItemId: 'invoice' }] }] }],
    refunds: [{ id: 'refund', amountRials: '50', occurredAt: '2026-01-05', postedVoucherId: 'v5' }] } as CustomerAccount;
  const movements = customerMovements(data);
  assert.equal(movements.at(-1)?.balance, '350');
  assert.equal(movements.find(row => row.id === 'allocation')?.balance, '400');
  assert.equal(movements.find(row => row.id === 'allocation:reverse')?.voucherId, 'v6');
  assert.equal(movements.length, 6);
});
