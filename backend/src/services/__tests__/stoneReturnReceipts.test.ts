import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoneReturnAcceptance } from '../stoneReturnReceipts';

const command = {
  requestId: 'dcc61352-0398-4ec8-9a88-2a04687f33e7',
  customerId: 'customer', productId: 'stone', unit: 'squareMeter',
  receivedQuantity: '40', acceptedQuantity: '35', rejectionReason: 'لب‌پریدگی',
};

test('Logistics accepts 35 of 40 square meters without an original loading', () => {
  const result = parseStoneReturnAcceptance(command);
  assert.equal(result.receivedQuantity, '40');
  assert.equal(result.acceptedQuantity, '35');
  assert.equal(result.rejectedQuantity, '5');
  assert.equal(result.rejectionReason, 'لب‌پریدگی');
  assert.equal(result.guardReturnMovementId, null);
});

test('partial and full rejection require a reason', () => {
  assert.throws(() => parseStoneReturnAcceptance({ ...command, rejectionReason: ' ' }), /دلیل رد/);
  const rejected = parseStoneReturnAcceptance({ ...command, acceptedQuantity: '0' });
  assert.equal(rejected.rejectedQuantity, '40');
  assert.throws(() => parseStoneReturnAcceptance({ ...command, acceptedQuantity: '0', rejectionReason: '' }), /دلیل رد/);
});

test('acceptance cannot exceed intake or round the physical decision', () => {
  assert.throws(() => parseStoneReturnAcceptance({ ...command, acceptedQuantity: '41' }), /پذیرفته‌شده/);
  assert.throws(() => parseStoneReturnAcceptance({ ...command, unit: 'count', acceptedQuantity: '35.1' }), /عدد/);
  const exact = parseStoneReturnAcceptance({
    ...command, receivedQuantity: '40.000000000000000000000000000001',
  });
  assert.equal(exact.rejectedQuantity, '5.000000000000000000000000000001');
});
