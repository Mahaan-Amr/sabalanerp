import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStoneReturnAllocations } from '../stoneReturnAllocationRules';

const receipt = { acceptedQuantity: '35', unit: 'squareMeter' };
const a = { originalInvoiceId: 'INV-A', originalLineId: 'ROW-A', dispatchEvidenceId: 'EXIT-A',
  lineRemainingQuantity: '21', dispatchRemainingQuantity: '20.123456789012345678901234567892' };
const b = { originalInvoiceId: 'INV-B', originalLineId: 'ROW-B', dispatchEvidenceId: 'EXIT-B',
  lineRemainingQuantity: '14', dispatchRemainingQuantity: '16' };
const allocations = (candidates = [a, b], originKnown = false) => ({ candidates, originKnown });

test('accounts for an incomplete allocation to two original contracts without rounding', () => {
  const result = validateStoneReturnAllocations(receipt, allocations(), [
    { ...a, quantity: '20.123456789012345678901234567891' },
    { ...b, quantity: '3' },
  ], '  کالای هم‌مشخصات از دو قرارداد  ');
  assert.equal(result.allocatedQuantity, '23.123456789012345678901234567891');
  assert.equal(result.unallocatedQuantity, '11.876543210987654321098765432109');
  assert.equal(result.attributionReason, 'کالای هم‌مشخصات از دو قرارداد');
});

test('rejects a source from another customer, stone, or governed unit absent from the eligible rows', () => {
  for (const dispatchEvidenceId of ['OTHER-CUSTOMER', 'OTHER-STONE', 'OTHER-UNIT']) {
    assert.throws(() => validateStoneReturnAllocations(receipt, allocations(), [
      { ...a, dispatchEvidenceId, quantity: '1' },
    ], 'دلیل'), /قابل استفاده نیست/);
  }
});

test('rejects exceeding either remaining financial line or physical dispatch capacity across rows', () => {
  const sameLine = { ...a, dispatchEvidenceId: 'EXIT-C', dispatchRemainingQuantity: '11' };
  const sameDispatch = { ...b, dispatchEvidenceId: a.dispatchEvidenceId, dispatchRemainingQuantity: a.dispatchRemainingQuantity };
  assert.throws(() => validateStoneReturnAllocations(receipt, allocations([a, sameLine]), [
    { ...a, quantity: '20' }, { ...sameLine, quantity: '2' },
  ], 'دلیل'), /مانده/);
  assert.throws(() => validateStoneReturnAllocations(receipt, allocations([a, sameDispatch]), [
    { ...a, quantity: '20' }, { ...sameDispatch, quantity: '1' },
  ], 'دلیل'), /مانده/);
});

test('requires an attribution reason when origins are unknown and blocks partial posting', () => {
  assert.throws(() => validateStoneReturnAllocations(receipt, allocations(), [{ ...a, quantity: '20' }], ' '), /دلیل/);
  assert.throws(() => validateStoneReturnAllocations(receipt, allocations([a], true), [{ ...a, quantity: '20' }], null, true), /کامل/);
});

test('rejects shares exceeding acceptance or fractional counts', () => {
  assert.throws(() => validateStoneReturnAllocations({ ...receipt, acceptedQuantity: '2' }, allocations(), [{ ...a, quantity: '3' }], 'دلیل'), /پذیرفته/);
  assert.throws(() => validateStoneReturnAllocations({ ...receipt, unit: 'count' }, allocations(), [{ ...a, quantity: '1.5' }], 'دلیل'), /صحیح/);
});
