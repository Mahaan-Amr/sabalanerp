import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingProjectedRialCurrency } from '../accountingProjectedRialCurrency';

test('ordinary row currency is explicit only when every stored sum has a known rial unit', () => {
  assert.equal(accountingProjectedRialCurrency('تومان', [{ currency: 'ریال' }], [{ currency: 'IRR' }]), 'IRR');
  assert.equal(accountingProjectedRialCurrency('ریال', [], []), 'IRR');
  assert.equal(accountingProjectedRialCurrency('unknown', [], []), undefined);
  assert.equal(accountingProjectedRialCurrency('تومان', [{ currency: 'تومان' }], []), undefined);
  assert.equal(accountingProjectedRialCurrency('تومان', [], [{ currency: null }]), undefined);
});
