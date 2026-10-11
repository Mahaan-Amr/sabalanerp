import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { technicalRecoveryExpired } from '../partnerSales/cases/technicalRecovery';
import { decodeTechnicalRecovery } from '../partnerSales/cases/technicalRecoveryRecords';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../contractRecoveryProtection';

test('only an owned editable numbered Case retains an aged unbound technical recovery', async () => {
  const now = new Date();
  const recovery = decodeTechnicalRecovery({ kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1,
    recoveryRevision: 1, updatedAt: now.getTime() - 8 * 86400000,
    draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, partnerCaseId: 'case-owned' });
  assert.ok(recovery);
  let state: string | null = 'DRAFT';
  let reads = 0;
  const tx = { partnerSaleCase: { findFirst: async (query: unknown) => {
    reads++;
    assert.deepEqual(query, { where: { id: 'case-owned', profile: { userId: 'seller-owned' } }, select: { state: true } });
    return state ? { state } : null;
  } } } as unknown as Pick<Prisma.TransactionClient, 'partnerSaleCase'>;
  for (state of ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED']) {
    assert.equal(await technicalRecoveryExpired(tx, null, recovery, 'seller-owned', now), false);
  }
  for (state of ['COMMITTED', 'CANCELLED', 'VOIDED', null]) {
    assert.equal(await technicalRecoveryExpired(tx, null, recovery, 'seller-owned', now), true);
  }
  assert.equal(reads, 7);
  assert.equal(await technicalRecoveryExpired(tx, null, { ...recovery, partnerCaseId: undefined }, 'seller-owned', now), true);
  assert.equal(await technicalRecoveryExpired(tx, null, { ...recovery, updatedAt: now.getTime() }, 'seller-owned', now), false);
  assert.equal(reads, 7, 'fresh and independent draft retention does not read unrelated Cases');
});
