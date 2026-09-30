import assert from 'node:assert/strict';
import { assertContractPayableTotal, sealContractPayableTotal, ContractPayableTotalError } from '../contractPayableTotal';

const edited = {
  serviceRows: [],
  discount: { enabled: false, amount: 0 },
  payment: { totalContractAmount: 920_696_000 }
};

const precise = { serviceRows: [{ totalPrice: '0.2' }], discount: { amount: '0.5' },
  payment: { currency: 'تومان', totalContractAmount: '200.5' } };
const sealed = sealContractPayableTotal('200.8', precise, '200.5', 'تومان');
assert.equal(sealed.totalAmount.toString(), '201');
assert.equal(sealed.contractData.payment.totalContractAmount, 201);
assert.equal(sealed.contractData.monetaryRounding.sourceAmount, '200.5');
assert.equal(assertContractPayableTotal('200.8', sealed.contractData, '201').toString(), '201');
assert.equal(assertContractPayableTotal('200.8', precise, '200.5').toString(), '200.5', 'historical evidence remains exact');
assert.throws(() => assertContractPayableTotal('200.8', sealed.contractData, '200.5'), ContractPayableTotalError);
assert.throws(() => sealContractPayableTotal('200.8', precise, '202', 'تومان'), ContractPayableTotalError);
assert.throws(() => assertContractPayableTotal('200.8', { ...sealed.contractData,
  monetaryRounding: { ...sealed.contractData.monetaryRounding, difference: '0' } }, '201'), ContractPayableTotalError);

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
