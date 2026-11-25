import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoneReturnAcceptance, StoneReturnIntakeRejected } from '../stoneReturnReceipts';

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

test('an intake cannot reuse a witness already verified for this stone and unit', async () => {
  const { recordStoneReturnReceipt } = await import('../stoneReturnReceipts');
  const tx = {
    $executeRaw: async () => 1,
    stoneReturnReceipt: { findUnique: async () => null, findFirst: async () => null },
    shipmentQuantityEvidence: { findFirst: async () => ({ id: 'verified' }) },
  };
  await assert.rejects(recordStoneReturnReceipt(tx as unknown as Parameters<typeof recordStoneReturnReceipt>[0], 'logistics-user', {
    ...command, guardReturnMovementId: 'existing-return',
  }), (error: unknown) => error instanceof StoneReturnIntakeRejected && error.requestId === command.requestId);
});

test('an intake retries a serializable conflict and returns the existing receipt on replay', async () => {
  const { Prisma } = await import('@prisma/client');
  const { recordStoneReturnReceipt } = await import('../stoneReturnReceipts');
  let attempts = 0;
  const db = {
    $transaction: async (record: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, 'Serializable');
      attempts += 1;
      if (attempts === 1) throw { code: 'P2034' };
      return record({
        $executeRaw: async () => 1,
        stoneReturnReceipt: { findUnique: async () => ({
          ...command, id: 'existing', guardReturnMovementId: null,
          receivedQuantity: new Prisma.Decimal('40'), acceptedQuantity: new Prisma.Decimal('35'), rejectedQuantity: new Prisma.Decimal('5'),
        }) },
      });
    },
  };
  const result = await recordStoneReturnReceipt(db as unknown as Parameters<typeof recordStoneReturnReceipt>[0], 'logistics-user', command);
  assert.equal(result.data.id, 'existing');
  assert.equal(result.replayed, true);
  assert.equal(attempts, 2);
});
