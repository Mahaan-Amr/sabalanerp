import assert from 'node:assert/strict';
import test from 'node:test';
import { exactQuantityText, parseExactQuantityAtoms, formatExactQuantityAtoms } from '../exactQuantity';
import { sumCanonicalQuantities } from '../pricedAllocationLedger';

test('exact quantity serialization preserves every accepted digit and historical text', () => {
  assert.equal(exactQuantityText('15.4875'), '15.4875');
  assert.equal(exactQuantityText('3'), '3.000');
  assert.equal(exactQuantityText('0.000000000000000000000000000001'), '0.000000000000000000000000000001');
  assert.equal(exactQuantityText('12345678901234567890123456789012345.123456789012345678901234567891'),
    '12345678901234567890123456789012345.123456789012345678901234567891');
  assert.throws(() => exactQuantityText(`0.${'0'.repeat(30)}1`), /capacity/);
  assert.throws(() => exactQuantityText('1'.repeat(36)), /capacity/);
});

test('quantity sums and signed differences do not lose fine precision through Number or Decimal arithmetic', () => {
  assert.equal(sumCanonicalQuantities(['5.1625', '10.325']), '15.4875');
  assert.equal(sumCanonicalQuantities(['1.12345678901234567890123456789', '0.000000000000000000000000000001']),
    '1.123456789012345678901234567891');
  assert.equal(formatExactQuantityAtoms(parseExactQuantityAtoms('15.4875') - parseExactQuantityAtoms('15.4876')), '-0.0001');
});
