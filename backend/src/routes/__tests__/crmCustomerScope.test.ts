import assert from 'node:assert/strict';
import { customerScopeForActor, ordinaryCrmRelatedVisibility } from '../crm';

assert.deepEqual(customerScopeForActor({ userId: 'admin', role: 'ADMIN', canAssignOwner: false }), { partnerOwnerProfileId: null });
assert.deepEqual(customerScopeForActor({ userId: 'manager', role: 'MANAGER', canAssignOwner: true }), { partnerOwnerProfileId: null });
assert.deepEqual(customerScopeForActor({ userId: 'seller', role: 'USER', canAssignOwner: false }), {
  partnerOwnerProfileId: null,
  OR: [{ ownerUserId: 'seller' }, { ownerUserId: null, createdBy: 'seller' }],
});
assert.deepEqual(ordinaryCrmRelatedVisibility, { OR: [{ customer: { partnerOwnerProfileId: null } },
  { potentialProject: { partnerRevision: null } }] });

console.log('CRM customer ownership scope tests passed.');
