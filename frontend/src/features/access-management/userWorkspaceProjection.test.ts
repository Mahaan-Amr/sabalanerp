import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

const usersPageSource = readFileSync(path.resolve(__dirname, '../../app/dashboard/users/page.tsx'), 'utf8');
const apiSource = readFileSync(path.resolve(__dirname, '../../lib/api.ts'), 'utf8');
assert.doesNotMatch(
  usersPageSource,
  /referenceDataLoaded\.current\s*\?\s*Promise\.resolve\(null\)\s*:\s*hrAuthorizationAPI\.getContext\(\)/,
  'HR authorization context must refresh with user-list results instead of remaining stale behind the reference-data cache',
);
assert.match(
  usersPageSource,
  /useEffect\(\(\) => \{\s*if \(!\['\/dashboard\/users', '\/dashboard\/hr\/users'\]\.includes\(pathname\)\) return;\s*fetchData\(\);\s*\}, \[pathname, currentPage,/,
  'returning to a router-cached user list must immediately refresh its HR authorization context',
);
assert.match(
  apiSource,
  /getContext:\s*\(\)\s*=>\s*api\.get\('\/hr\/authorization\/context',\s*\{\s*params:\s*\{\s*_fresh:\s*Date\.now\(\)\s*\}/,
  'HR authorization context reads must bypass browser and intermediary response caches',
);

console.log('User workspace projection tests passed.');
