import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerContractPayableTotal, roundPartnerContractTotals } from '../src/monetary-rounding';

test('new commercial obligations round after discount while historical obligations retain precision', () => {
  const fields = { net: '200.8', discount: '0.3', tax: '0', charges: '0', currency: 'IRT' as const };
  const totals = roundPartnerContractTotals(fields);
  assert.equal(totals.net, '200.8');
  assert.equal(totals.discount, '0.3');
  assert.equal(totals.payable, '201');
  assert.equal(totals.monetaryRounding?.sourceAmount, '200.5');
  assert.equal(partnerContractPayableTotal(totals), '201');
  assert.equal(partnerContractPayableTotal({ ...fields, payable: '200.5' }), '200.5');
  assert.throws(() => partnerContractPayableTotal({ ...totals, payable: '200' }));
  assert.throws(() => partnerContractPayableTotal({ ...totals, net: '201.8' }));
  assert.throws(() => partnerContractPayableTotal({ ...totals, monetaryRounding: undefined }));
});
