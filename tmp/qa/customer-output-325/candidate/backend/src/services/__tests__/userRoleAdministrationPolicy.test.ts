import assert from 'node:assert/strict';
import { canAssignSystemRole } from '../userRoleAdministrationPolicy';

assert.equal(canAssignSystemRole({ actorRole: 'MANAGER', targetRole: 'USER', requestedRole: 'MANAGER' }), true);
assert.equal(canAssignSystemRole({ actorRole: 'MANAGER', targetRole: 'USER', requestedRole: 'USER' }), true);
assert.equal(canAssignSystemRole({ actorRole: 'MANAGER', targetRole: 'SALES', requestedRole: 'USER' }), true);
assert.equal(canAssignSystemRole({ actorRole: 'MANAGER', targetRole: 'USER', requestedRole: 'ADMIN' }), false);
assert.equal(canAssignSystemRole({ actorRole: 'MANAGER', targetRole: 'ADMIN', requestedRole: 'MANAGER' }), false);
assert.equal(canAssignSystemRole({ actorRole: 'ADMIN', targetRole: 'USER', requestedRole: 'ADMIN' }), true);

console.log('User role administration policy tests passed.');
