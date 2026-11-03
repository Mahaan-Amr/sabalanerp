import assert from 'node:assert/strict';
import { customerScopeForActor } from '../crm';

assert.deepEqual(customerScopeForActor({ userId: 'admin', role: 'ADMIN', canAssignOwner: false }), {});
assert.deepEqual(customerScopeForActor({ userId: 'manager', role: 'MANAGER', canAssignOwner: true }), {});
assert.deepEqual(customerScopeForActor({ userId: 'seller', role: 'USER', canAssignOwner: false }), {
  OR: [{ ownerUserId: 'seller' }, { ownerUserId: null, createdBy: 'seller' }],
});

console.log('CRM customer ownership scope tests passed.');
