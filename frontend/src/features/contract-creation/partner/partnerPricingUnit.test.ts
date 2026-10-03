import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerRetailPriceUnitLabel, partnerSelectableFamilies } from './partnerPricingUnit';

test('partner pricing exposes only supported stone families with the ordinary Sales commercial basis', () => {
  assert.deepEqual(partnerSelectableFamilies, ['longitudinal', 'stair', 'slab', 'prepared']);
  assert.equal(partnerRetailPriceUnitLabel({ family: 'longitudinal' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'tread' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'riser' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'stair', part: 'landing' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'slab' }), 'فی هر مترمربع (تومان)');
  assert.equal(partnerRetailPriceUnitLabel({ family: 'prepared' }), 'قیمت واحد (تومان)');
});
