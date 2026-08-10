import assert from 'node:assert/strict';
import {
  evaluateHrAuthorization,
  resolveNamedResponsibility,
  type HrAuthorizationSnapshot,
} from '../hrAuthorizationPolicy';
import { activeCompanyManagerUserIds, activeHrAuthoritiesForUser, resolveHrNamedResponsibility } from '../hrAuthorizationService';

const now = new Date('2026-08-08T10:00:00.000Z');
const activeWindow = { effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null };

const snapshot = (overrides: Partial<HrAuthorizationSnapshot> = {}): HrAuthorizationSnapshot => ({
  user: { id: 'hr-user', role: 'USER', isActive: true },
  workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE', ...activeWindow }],
  featureGrants: [{ featureCode: 'PERSONNEL', level: 'EDIT', status: 'ACTIVE', ...activeWindow }],
  authorityGrants: [{ authorityCode: 'HR_PROCESSOR', status: 'ACTIVE', ...activeWindow }],
  assignedDutyIds: ['duty-1'],
  ...overrides,
});

{
  const decision = evaluateHrAuthorization(snapshot(), {
    workspaceLevel: 'VIEW',
    feature: { code: 'PERSONNEL', level: 'EDIT' },
    authorityCodes: ['HR_PROCESSOR'],
  }, now);
  assert.deepEqual(decision, { allowed: true, missingLayers: [] });
}

{
  const withoutWorkspace = snapshot({ workspaceGrants: [] });
  assert.deepEqual(
    evaluateHrAuthorization(withoutWorkspace, { feature: { code: 'PERSONNEL', level: 'VIEW' }, workspaceLevel: 'VIEW' }, now),
    { allowed: false, missingLayers: ['WORKSPACE'] },
    'feature permission must not imply workspace access',
  );
}

{
  const withoutAuthority = snapshot({ authorityGrants: [] });
  assert.deepEqual(
    evaluateHrAuthorization(withoutAuthority, { workspaceLevel: 'VIEW', authorityCodes: ['HR_PROCESSOR'] }, now),
    { allowed: false, missingLayers: ['BUSINESS_AUTHORITY'] },
    'workspace access must not imply governed authority',
  );
}

{
  assert.deepEqual(
    evaluateHrAuthorization(snapshot({ workspaceGrants: [], featureGrants: [], authorityGrants: [] }), { dutyId: 'duty-1' }, now),
    { allowed: true, missingLayers: [] },
    'assigned duty access is independent from ordinary HR access',
  );
  assert.deepEqual(
    evaluateHrAuthorization(snapshot({ assignedDutyIds: [] }), { dutyId: 'duty-1' }, now),
    { allowed: false, missingLayers: ['TASK_DUTY'] },
  );
}

{
  for (const user of [
    { id: 'admin-1', role: 'ADMIN', isActive: true },
  ]) {
    const baseline = snapshot({ user, workspaceGrants: [], featureGrants: [], authorityGrants: [] });
    assert.equal(evaluateHrAuthorization(baseline, {
      workspaceLevel: 'ADMIN',
      feature: { code: 'USER_ADMINISTRATION', level: 'ADMIN' },
      authorityCodes: ['COMPANY_MANAGER'],
    }, now).allowed, true);
  }
  assert.equal(evaluateHrAuthorization(snapshot({
    user: { id: 'shakila-stable-id', role: 'USER', isActive: true },
    workspaceGrants: [], featureGrants: [], authorityGrants: [],
  }), { workspaceLevel: 'VIEW' }, now).allowed, false, 'named users do not bypass governed grants');
  assert.equal(evaluateHrAuthorization(snapshot({
    user: { id: 'sales-manager', role: 'MANAGER', isActive: true },
    workspaceGrants: [], featureGrants: [], authorityGrants: [],
  }), { workspaceLevel: 'VIEW' }, now).allowed, false, 'MANAGER is not an HR baseline role');
  assert.equal(evaluateHrAuthorization(snapshot({
    user: { id: 'demoted-admin', role: 'MANAGER', isActive: true },
    workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE', bootstrapOnly: true, ...activeWindow }],
  }), { workspaceLevel: 'VIEW' }, now).allowed, false, 'persisted bootstrap grants do not survive role demotion');
}

const users = [
  { id: 'primary-user', isActive: true },
  { id: 'acting-user', isActive: true },
  { id: 'inactive-user', isActive: false },
];
const destination = {
  id: 'destination-1', responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
  workspaceCode: 'ACCOUNTING', featureCode: null, queueCode: 'FINANCE_APPROVALS', version: 1, isActive: true,
};
const primary = {
  id: 'primary', responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
  assignedUserId: 'primary-user', assignmentKind: 'PRIMARY' as const, principalResponsibilityId: null, ...activeWindow,
};

{
  const result = resolveNamedResponsibility({
    sourceActionCode: 'APPROVE_COMPENSATION', responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
    responsibilities: [primary], destinations: [destination], users, authorityEligibleUserIds: ['primary-user'], conflictedUserIds: [], now,
  });
  assert.equal(result.status, 'RESOLVED');
  if (result.status === 'RESOLVED') assert.equal(result.assignedUserId, 'primary-user');
}

{
  const acting = { ...primary, id: 'acting', assignedUserId: 'acting-user', assignmentKind: 'ACTING' as const, principalResponsibilityId: primary.id };
  const result = resolveNamedResponsibility({
    sourceActionCode: 'APPROVE_COMPENSATION', responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
    responsibilities: [primary, acting], destinations: [destination], users,
    authorityEligibleUserIds: ['primary-user', 'acting-user'], conflictedUserIds: [], now,
  });
  assert.equal(result.status, 'RESOLVED');
  if (result.status === 'RESOLVED') {
    assert.equal(result.assignedUserId, 'acting-user');
    assert.equal(result.assignmentKind, 'ACTING');
  }
}

const unresolvedBase = {
  sourceActionCode: 'APPROVE_COMPENSATION', responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
  responsibilities: [primary], destinations: [destination], users,
  authorityEligibleUserIds: ['primary-user'], conflictedUserIds: [], now,
};
const unresolvedCases: Array<[string, string, Record<string, unknown>]> = [
  ['missing', 'MISSING_ASSIGNMENT', { responsibilities: [] }],
  ['ambiguous', 'AMBIGUOUS_ASSIGNMENT', { responsibilities: [primary, { ...primary, id: 'primary-2' }] }],
  ['inactive', 'INELIGIBLE_ASSIGNEE', { responsibilities: [{ ...primary, assignedUserId: 'inactive-user' }], authorityEligibleUserIds: ['inactive-user'] }],
  ['authority', 'INELIGIBLE_ASSIGNEE', { authorityEligibleUserIds: [] }],
  ['destination', 'DESTINATION_MISSING', { destinations: [] }],
  ['separation', 'SEPARATION_OF_DUTY_CONFLICT', { conflictedUserIds: ['primary-user'] }],
];
for (const [name, expectedReason, overrides] of unresolvedCases) {
  const result = resolveNamedResponsibility({ ...unresolvedBase, ...overrides } as Parameters<typeof resolveNamedResponsibility>[0]);
  assert.equal(result.status, 'UNRESOLVED', name);
  if (result.status === 'UNRESOLVED') assert.equal(result.reason, expectedReason, name);
}

const serviceRegressionTests = async () => {
  const grant = {
    authorityCode: 'HR_MANAGER', status: 'ACTIVE', effectiveFrom: activeWindow.effectiveFrom,
    effectiveTo: null, reason: 'HR redesign baseline', userId: 'demoted-admin',
  };
  const fakeClient = {
    user: {
      findUnique: async () => ({ id: 'demoted-admin', role: 'MANAGER', isActive: true }),
      findMany: async () => [{ id: 'demoted-admin', role: 'MANAGER', isActive: true }],
    },
    hrWorkspaceAccessGrant: { findMany: async () => [] },
    hrFeatureAccessGrant: { findMany: async () => [] },
    hrBusinessAuthorityGrant: { findMany: async () => [grant] },
    hrDuty: { findMany: async () => [] },
    hrAuthorityCatalog: {
      findMany: async () => [{ code: 'HR_MANAGER' }],
      findUnique: async () => ({ code: 'HR_MANAGER' }),
    },
    hrNamedResponsibility: { findMany: async () => [{ ...primary, responsibilityTypeCode: 'HR_MANAGER', assignedUserId: 'demoted-admin' }] },
    hrResponsibilityDestination: { findMany: async () => [{ ...destination, responsibilityTypeCode: 'HR_MANAGER', workspaceCode: 'HUMAN_RESOURCES' }] },
    hrSeparationOfDutyConstraint: { findMany: async () => [] },
  } as any;

  assert.deepEqual(
    await activeHrAuthoritiesForUser(fakeClient, 'demoted-admin', now),
    [],
    'active-authority projections must exclude persisted bootstrap grants after demotion',
  );
  assert.deepEqual(
    await activeCompanyManagerUserIds(fakeClient, { at: now }),
    [],
    'last-manager protection must not count a demoted admin bootstrap grant as eligible',
  );
  const resolution = await resolveHrNamedResponsibility(fakeClient, {
    sourceActionCode: 'HR_MANAGER_ACTION', responsibilityTypeCode: 'HR_MANAGER', scopeType: 'GLOBAL', scopeId: null, now,
  });
  assert.deepEqual(
    resolution,
    { status: 'UNRESOLVED', reason: 'INELIGIBLE_ASSIGNEE' },
    'responsibility resolution must exclude persisted bootstrap grants after demotion',
  );
};

serviceRegressionTests()
  .then(() => console.log('HR authorization and named responsibility policy tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
