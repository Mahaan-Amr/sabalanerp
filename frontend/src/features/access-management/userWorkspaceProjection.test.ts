import assert from 'node:assert/strict';
import { projectUserWorkspaceAccess } from './userWorkspaceProjection';

const projected = projectUserWorkspaceAccess({
  role: 'USER',
  directPermissions: [
    { id: 'legacy-hr-admin', workspace: 'hr', permissionLevel: 'admin', isActive: true },
    { id: 'accounting-view', workspace: 'accounting', permissionLevel: 'view', isActive: true },
  ],
  roleDefaults: [],
  canonicalHrGrants: [
    { id: 'canonical-hr-edit', workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE' },
  ],
});

assert.deepEqual(
  projected.filter(({ workspace }) => workspace === 'hr'),
  [{ key: 'canonical-hr-edit', workspace: 'hr', permissionLevel: 'edit', source: 'direct' }],
  'the canonical HR grant must replace a stale legacy HR workspace row',
);
assert.equal(projected.find(({ workspace }) => workspace === 'accounting')?.permissionLevel, 'view');

const inheritedHr = projectUserWorkspaceAccess({
  role: 'USER',
  directPermissions: [],
  roleDefaults: [{ id: 'role-hr-view', workspace: 'hr', permissionLevel: 'view', isActive: true }],
  canonicalHrGrants: [{
    id: 'expired-direct-hr-admin',
    workspaceCode: 'HUMAN_RESOURCES',
    level: 'ADMIN',
    status: 'ACTIVE',
    effectiveTo: new Date(Date.now() - 1_000).toISOString(),
  }],
});
assert.deepEqual(inheritedHr, [{ key: 'role-hr-view', workspace: 'hr', permissionLevel: 'view', source: 'role' }]);

console.log('User workspace projection tests passed.');
