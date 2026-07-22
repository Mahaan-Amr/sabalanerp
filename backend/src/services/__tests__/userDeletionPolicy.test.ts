import assert from 'node:assert/strict';
import { assertUserCanBeDeleted, collectUserDeletionBlockers, UserDeletionPolicyError } from '../userDeletionPolicy';

const actor = { id: 'admin-1', role: 'ADMIN' };
const target = { id: 'qa-user', username: 'qa_hr_processor', role: 'USER', isActive: true };

assert.doesNotThrow(() => assertUserCanBeDeleted({ actor, target, confirmationUsername: target.username, adminCount: 2, activeAdminCount: 2 }));

const expectCode = (code: string, run: () => void) => {
  assert.throws(run, (error) => error instanceof UserDeletionPolicyError && error.code === code);
};

expectCode('USER_DELETE_ADMIN_REQUIRED', () => assertUserCanBeDeleted({ actor: { id: 'manager', role: 'MANAGER' }, target, confirmationUsername: target.username, adminCount: 2, activeAdminCount: 2 }));
expectCode('USER_DELETE_SELF_FORBIDDEN', () => assertUserCanBeDeleted({ actor, target: { ...target, id: actor.id }, confirmationUsername: target.username, adminCount: 2, activeAdminCount: 2 }));
expectCode('USER_DELETE_CONFIRMATION_MISMATCH', () => assertUserCanBeDeleted({ actor, target, confirmationUsername: 'wrong-user', adminCount: 2, activeAdminCount: 2 }));
expectCode('USER_DELETE_LAST_ADMIN', () => assertUserCanBeDeleted({ actor, target: { ...target, role: 'ADMIN' }, confirmationUsername: target.username, adminCount: 1, activeAdminCount: 1 }));
expectCode('USER_DELETE_LAST_ACTIVE_ADMIN', () => assertUserCanBeDeleted({ actor, target: { ...target, role: 'ADMIN' }, confirmationUsername: target.username, adminCount: 2, activeAdminCount: 1 }));

assert.deepEqual(collectUserDeletionBlockers({ workspacePermissions: 2, featurePermissions: 3 }), []);
assert.deepEqual(
  collectUserDeletionBlockers({ workspacePermissions: 2, createdContracts: 1, attendanceRecords: 4 }, { hasSecurityPersonnel: true }),
  ['attendanceRecords', 'createdContracts', 'securityPersonnel']
);

console.log('User deletion policy tests passed.');
