import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerRetailPriceUnitLabel, partnerSelectableFamilies } from './partnerPricingUnit';

test('partner pricing exposes only supported stone families with the negotiated commercial basis', () => {
  assert.deepEqual(partnerSelectableFamilies, ['longitudinal', 'stair', 'slab', 'prepared']);
  assert.equal(partnerRetailPriceUnitLabel({ family: 'longitudinal' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'tread' }), 'فی کف پله (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'riser' }), 'فی خیز (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'landing' }), 'فی پاگرد (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'slab' }), 'فی سنگ مادر مصرفی (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'prepared' }), 'قیمت واحد (تومان)');
});
