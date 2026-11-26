import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { requireSepidarCustomerOpeningWithin } from '../sepidarCustomerOpeningAdmission';

test('an approved-looking Sepidar command cannot write with no protected release identity', async () => {
  let queried = false;
  const tx = { $queryRaw: async () => { queried = true; return [{ admitted: true }]; } } as unknown as Prisma.TransactionClient;
  await assert.rejects(requireSepidarCustomerOpeningWithin(tx, {
    bookId: 'book', profileId: 'customer-profile', actorId: 'accountant', occurredAt: new Date('2026-03-21T00:00:00Z'),
    counterAccountId: 'approved-clearing', commandHash: 'b'.repeat(64), sourcePackageHash: 'a'.repeat(64),
    sourceCustomerId: '7', sourceVoucherItemId: '91', idempotencyKey: 'opening-key-91',
  }), { code: 'SEPIDAR_CUSTOMER_OPENING_CLOSED' });
  assert.equal(queried, false);
});
