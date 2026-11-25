import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { readStoneReturnAllocationReview, saveStoneReturnAllocationDraft } from '../stoneReturnAllocationDraft';

test('reopens the latest saved revision and rejects an older editor without discarding the current draft', async () => {
  let saved: { id: string; version: number; attributionReason: string | null; createdAt: Date; createdBy: string; rows: [] } | null = null;
  const tx = {
    $executeRaw: async () => 1,
    stoneReturnReceipt: { findUnique: async () => ({
      id: 'receipt', customerId: 'customer', customerName: 'مشتری', productId: 'product', productName: 'سنگ', productCode: 'A',
      receivedQuantity: new Prisma.Decimal('40'), acceptedQuantity: new Prisma.Decimal('35'), rejectedQuantity: new Prisma.Decimal('5'),
      unit: 'squareMeter', guardReturnMovementId: null, createdAt: new Date('2026-10-11T08:00:00Z'),
    }) },
    stoneReturnFinalization: { findUnique: async () => null },
    contractItem: { findMany: async () => [] },
    stoneReturnAllocationDraft: {
      findFirst: async () => saved,
      create: async ({ data }: { data: { version: number; attributionReason: string | null; createdBy: string } }) => {
        saved = { ...data, id: 'draft', rows: [], createdAt: new Date('2026-10-12T08:00:00Z') };
        return saved;
      },
    },
  };
  const db = { $transaction: async (task: (transaction: typeof tx) => Promise<unknown>) => task(tx) } as unknown as PrismaClient;
  await saveStoneReturnAllocationDraft(db, 'receipt', 'accountant', { expectedVersion: 0, rows: [], attributionReason: 'سوابق در بررسی' });
  await assert.rejects(saveStoneReturnAllocationDraft(db, 'receipt', 'other', { expectedVersion: 0, rows: [] }), /نسخه جدید/);
  const reviewed = await readStoneReturnAllocationReview(tx as unknown as Prisma.TransactionClient, 'receipt');
  assert.equal(reviewed.draft?.version, 1);
  assert.equal(reviewed.draft?.createdBy, 'accountant');
  assert.equal(reviewed.draft?.attributionReason, 'سوابق در بررسی');
  assert.equal(reviewed.unallocatedQuantity, '35.000');
});
