import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partnerCustomerOrderArea } from './partnerProductCartSummary';

test('customer order area projects Sales calculation results independently of consumption and pricing', () => {
  assert.equal(partnerCustomerOrderArea({ requestedAreaSquareMeters: '10', consumedMaterialAreaSquareMeters: '16', mandatoryPercentage: '20' }), '10');
  assert.equal(partnerCustomerOrderArea({ requestedAreaSquareMeters: '3', consumedMotherAreaSquareMeters: '3.2' }), '3');
  assert.equal(partnerCustomerOrderArea({ finishedAreaSquareMeters: '18', materialAreaSquareMeters: '20' }), '18');
  assert.equal(partnerCustomerOrderArea({ squareMeters: '0.1', quantity: 5 }), '0.1');
  assert.equal(partnerCustomerOrderArea({ quantity: 5 }), undefined);
  assert.equal(partnerCustomerOrderArea(undefined), undefined);
});
