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
  canonicalHrSnapshot: {
    evaluatedAt: '2026-08-17T12:00:00.000Z',
    grants: [{ id: 'canonical-hr-edit', workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE' }],
  },
});

assert.deepEqual(
  projected.filter(({ workspace }) => workspace === 'hr'),
  [{ key: 'canonical-hr-edit', workspace: 'hr', permissionLevel: 'edit', source: 'direct' }],
  'the canonical HR grant must replace a stale legacy HR workspace row',
);
assert.equal(projected.find(({ workspace }) => workspace === 'accounting')?.permissionLevel, 'view');

const serverEvaluatedAt = '2099-08-17T12:00:00.000Z';
const confirmedAccessWithClientClockSkew = projectUserWorkspaceAccess({
  role: 'USER',
  directPermissions: [
    { id: 'logistics-edit', workspace: 'logistics', permissionLevel: 'edit', isActive: true },
  ],
  roleDefaults: [],
  canonicalHrSnapshot: {
    evaluatedAt: serverEvaluatedAt,
    grants: [{
      id: 'canonical-hr-admin',
      workspaceCode: 'HUMAN_RESOURCES',
      level: 'ADMIN',
      status: 'ACTIVE',
      effectiveFrom: serverEvaluatedAt,
      effectiveTo: null,
    }],
  },
});
assert.deepEqual(
  confirmedAccessWithClientClockSkew.map(({ workspace }) => workspace).sort(),
  ['hr', 'logistics'],
  'a Confirmed Access Change must project HR and logistics immediately using authoritative server time',
);

const inheritedHr = projectUserWorkspaceAccess({
  role: 'USER',
  directPermissions: [],
  roleDefaults: [{ id: 'role-hr-view', workspace: 'hr', permissionLevel: 'view', isActive: true }],
  canonicalHrSnapshot: {
    evaluatedAt: new Date().toISOString(),
    grants: [{
      id: 'expired-direct-hr-admin',
      workspaceCode: 'HUMAN_RESOURCES',
      level: 'ADMIN',
      status: 'ACTIVE',
      effectiveTo: new Date(Date.now() - 1_000).toISOString(),
    }],
  },
});
assert.deepEqual(inheritedHr, [{ key: 'role-hr-view', workspace: 'hr', permissionLevel: 'view', source: 'role' }]);

assert.throws(
  () => projectUserWorkspaceAccess({
    role: 'USER',
    directPermissions: [],
    roleDefaults: [],
    canonicalHrSnapshot: { evaluatedAt: 'not-a-server-time', grants: [] },
  }),
  /authoritative server evaluation time/i,
  'an invalid or missing server evaluation time must not silently fall back to the client clock',
);

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
  usersPageSource,
  /addEventListener\('pageshow'/,
  'restoring the user list from browser history must invalidate cached access summaries',
);
assert.match(
  apiSource,
  /getContext:\s*\(\)\s*=>\s*api\.get\('\/hr\/authorization\/context',\s*\{\s*params:\s*\{\s*_fresh:\s*Date\.now\(\)\s*\}/,
  'HR authorization context reads must bypass browser and intermediary response caches',
);

console.log('User workspace projection tests passed.');
