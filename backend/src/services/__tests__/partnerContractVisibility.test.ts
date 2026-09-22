import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPartnerContractListScope, canPartnerReadSalesContract } from '../partnerSales/contractVisibility';

test('Partner contract lists are intersected with the owning Partner profile', () => {
  assert.deepEqual(
    applyPartnerContractListScope({ isInactive: false, status: { in: ['DRAFT'] } }, 'profile-1'),
    {
      AND: [
        { isInactive: false, status: { in: ['DRAFT'] } },
        { partnerCase: { is: { profileId: 'profile-1' } } },
      ],
    },
  );
});

test('ordinary sales users retain their existing contract scope', () => {
  const scope = { isInactive: false, departmentId: 'department-1' };
  assert.equal(applyPartnerContractListScope(scope, null), scope);
});

test('Partner detail access only accepts a contract owned by the same profile', async () => {
  const checked: unknown[] = [];
  const database = {
    partnerProfile: { findUnique: async () => ({ id: 'profile-1' }) },
    salesContract: { count: async (query: unknown) => { checked.push(query); return 0; } },
  };
  const allowed = await canPartnerReadSalesContract(database as never, {
    userId: 'partner-user-1', role: 'USER', contractId: 'sabalan-contract-1',
  });
  assert.equal(allowed, false);
  assert.deepEqual(checked, [{ where: {
    id: 'sabalan-contract-1', partnerCase: { is: { profileId: 'profile-1' } },
  } }]);
});
