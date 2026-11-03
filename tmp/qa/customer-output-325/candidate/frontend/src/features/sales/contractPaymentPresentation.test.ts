import assert from 'node:assert/strict';
import { buildContractPaymentPresentation } from './contractPaymentPresentation';

const relational = buildContractPaymentPresentation({
  payments: [{
    id: 'payment-1',
    paymentMethod: 'CASH',
    cashType: 'SHIBA',
    totalAmount: '24360000',
    currency: 'تومان',
    paymentDate: '2026-08-20T00:00:00.000Z',
    status: 'PENDING'
  }],
  contractData: {
    payment: {
      payments: [{ method: 'CHECK', amount: 1 }]
    }
  },
  currency: 'تومان'
});
assert.equal(relational.source, 'payments');
assert.equal(relational.summaryLabel, 'نقدی (شبا)');
assert.equal(relational.rows[0].amount, 24_360_000);
assert.equal(relational.rows[0].status, 'در انتظار پرداخت');

const historical = buildContractPaymentPresentation({
  payments: [],
  contractData: {
    payment: {
      payments: [{ id: 'legacy-1', method: 'CASH_CARD', amount: 500_000 }]
    }
  },
  currency: 'تومان'
});
assert.equal(historical.source, 'historical-snapshot');
assert.equal(historical.summaryLabel, 'نقدی (کارتخوان)');
assert.equal(historical.rows[0].amount, 500_000);

const compound = buildContractPaymentPresentation({
  payments: [
    { id: 'cash', paymentMethod: 'CASH', cashType: 'SHIBA', totalAmount: 10 },
    { id: 'check', paymentMethod: 'CHECK', totalAmount: 20, checkNumber: '123' }
  ],
  contractData: {},
  currency: 'تومان'
});
assert.equal(compound.summaryLabel, '۲ روش پرداخت');
assert.deepEqual(compound.rows.map((row) => row.methodLabel), ['نقدی (شبا)', 'چک']);

console.log('contract payment presentation tests passed');
