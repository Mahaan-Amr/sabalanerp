import assert from 'node:assert/strict';
import { assertContractPayableTotal, ContractPayableTotalError } from '../contractPayableTotal';

const edited = {
  serviceRows: [],
  discount: { enabled: false, amount: 0 },
  payment: { totalContractAmount: 920_696_000 }
};

assert.equal(assertContractPayableTotal('920696000', edited, 920_696_000).toString(), '920696000');
assert.throws(
  () => assertContractPayableTotal('920696000', edited, 875_000_000),
  (error: unknown) => error instanceof ContractPayableTotalError &&
    error.field === 'totalAmount' && error.expected === '920696000',
);
assert.throws(
  () => assertContractPayableTotal('920696000', {
    ...edited, payment: { totalContractAmount: 875_000_000 }
  }, 920_696_000),
  (error: unknown) => error instanceof ContractPayableTotalError &&
    error.field === 'payment.totalContractAmount',
);
assert.equal(assertContractPayableTotal('1000', {
  serviceRows: [{ totalPrice: '250' }],
  discount: { amount: '100' }, payment: { totalContractAmount: '1150' }
}, '1150').toString(), '1150');
assert.throws(
  () => assertContractPayableTotal('1000', { serviceRows: [{}] }, '1000'),
  ContractPayableTotalError,
);
