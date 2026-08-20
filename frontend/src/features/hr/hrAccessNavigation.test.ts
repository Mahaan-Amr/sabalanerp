import assert from 'node:assert/strict';
import {
  canAdministerHrAccess,
  canAccessHrRoute,
  projectHrNavigation,
  projectHrWorkspaceLanding,
  resolveHrRouteFeature,
} from './hrAccessNavigation';

assert.equal(canAdministerHrAccess('ADMIN'), true);
assert.equal(canAdministerHrAccess('MANAGER'), true);
assert.equal(canAdministerHrAccess('USER'), false);

const features = [
  { feature: 'DASHBOARD', permissionLevel: 'view', workspace: 'hr' },
  { feature: 'PERSONNEL', permissionLevel: 'edit', workspace: 'hr' },
  { feature: 'RECORD_INITIAL_INTERVIEW', permissionLevel: 'edit', workspace: 'hr' },
  { feature: 'accounting_contracts_view', permissionLevel: 'view', workspace: 'accounting' },
];

assert.deepEqual(
  projectHrNavigation(features).map(({ id }) => id),
  ['dashboard', 'personnel'],
  'base feature grants reveal HR surfaces while action permissions do not create navigation entries',
);

assert.deepEqual(projectHrWorkspaceLanding(features), {
  kind: 'dashboard',
  links: [{ id: 'personnel', label: 'پرسنل و روابط استخدامی', href: '/dashboard/hr/personnel' }],
});

assert.deepEqual(projectHrWorkspaceLanding([
  { feature: 'PERSONNEL', permissionLevel: 'view', workspace: 'hr' },
]), {
  kind: 'limited',
  links: [{ id: 'personnel', label: 'پرسنل و روابط استخدامی', href: '/dashboard/hr/personnel' }],
});

assert.deepEqual(projectHrWorkspaceLanding([]), { kind: 'empty', links: [] });
assert.deepEqual(
  projectHrNavigation([
    { feature: 'USER_ADMINISTRATION', permissionLevel: 'admin', workspace: 'hr' },
  ], 'USER'),
  [],
  'User Administration retains its independent system-role boundary',
);
assert.equal(resolveHrRouteFeature('/dashboard/hr/hiring/case-1'), 'RECRUITMENT_CASES');
assert.equal(resolveHrRouteFeature('/dashboard/hr/interview-criteria'), 'RECRUITMENT_CASES');
assert.equal(resolveHrRouteFeature('/dashboard/hr/permissions'), 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION');
assert.equal(resolveHrRouteFeature('/dashboard/hr'), 'DASHBOARD');
assert.equal(canAccessHrRoute(features, '/dashboard/hr/personnel', 'USER'), true);
assert.equal(canAccessHrRoute(features, '/dashboard/hr/structure', 'USER'), false);
assert.equal(canAccessHrRoute(features, '/dashboard/hr/vehicle-operations', 'USER'), false);
assert.equal(canAccessHrRoute(features, '/dashboard/hr/vehicle-operations', 'ADMIN'), true);
assert.equal(canAccessHrRoute(features, '/dashboard/hr/vehicle-operations', 'MANAGER'), true);

console.log('HR access navigation tests passed.');
