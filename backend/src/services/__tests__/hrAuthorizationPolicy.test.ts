import assert from 'node:assert/strict';
import {
  evaluateHrAuthorization,
  resolveNamedResponsibility,
  type HrAuthorizationSnapshot,
} from '../hrAuthorizationPolicy';
import { activeCompanyManagerUserIds, activeHrAuthoritiesForUser, resolveHrNamedResponsibility } from '../hrAuthorizationService';
import { actionPermissionsForLegacyAuthority, expandHrActionPermissionSelection, getHrActionPermissionDefinition } from '../hrActionPermissionCatalog';

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

const actionGrants = (code: string, window = activeWindow) => expandHrActionPermissionSelection([code])
  .map((featureCode) => ({
    featureCode,
    level: getHrActionPermissionDefinition(featureCode)?.level ?? 'VIEW' as const,
    status: 'ACTIVE' as const,
    ...window,
  }));

{
  const decision = evaluateHrAuthorization(snapshot(), {
    workspaceLevel: 'VIEW',
    feature: { code: 'PERSONNEL', level: 'EDIT' },
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
  assert.deepEqual(evaluateHrAuthorization(withoutAuthority, {
    workspaceLevel: 'VIEW',
    actionPermissionCodes: ['RECORD_INITIAL_INTERVIEW'],
  }, now), { allowed: false, missingLayers: ['ACTION_PERMISSION'] });
}

{
  const noPerformanceGrant = snapshot({
    featureGrants: [],
    authorityGrants: [{ authorityCode: 'HR_MANAGER', status: 'ACTIVE', ...activeWindow }],
  });
  assert.equal(evaluateHrAuthorization(noPerformanceGrant, {
    actionPermissionCodes: ['VIEW_PERFORMANCE_HISTORY'],
  }, now).allowed, false, 'legacy HR authority must not disclose confidential performance history');

  const historyOnly = snapshot({ featureGrants: actionGrants('VIEW_PERFORMANCE_HISTORY'), authorityGrants: [] });
  assert.equal(evaluateHrAuthorization(historyOnly, {
    actionPermissionCodes: ['VIEW_PERFORMANCE_HISTORY'],
  }, now).allowed, true, 'the explicit performance-history grant authorizes only its own capability');
  assert.equal(evaluateHrAuthorization(historyOnly, {
    actionPermissionCodes: ['VIEW_NAMED_PERFORMANCE_RANKING'],
  }, now).allowed, false, 'history access must not imply named ranking access');

  const workspaceAdmin = snapshot({
    user: { id: 'hr-workspace-admin', role: 'MANAGER', isActive: true },
    workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE', ...activeWindow }],
    featureGrants: [],
    authorityGrants: [],
  });
  assert.equal(evaluateHrAuthorization(workspaceAdmin, {
    actionPermissionCodes: ['MANAGE_PERFORMANCE_ROLLOUT'],
  }, now).allowed, false, 'HR workspace administration never implies an independent performance permission');

  const systemAdmin = snapshot({
    user: { id: 'system-admin', role: 'ADMIN', isActive: true },
    workspaceGrants: [], featureGrants: [], authorityGrants: [],
  });
  assert.equal(evaluateHrAuthorization(systemAdmin, {
    actionPermissionCodes: ['MANAGE_PERFORMANCE_ROLLOUT'],
  }, now).allowed, true, 'the existing system ADMIN baseline remains complete');
}

{
  const viewOnly = snapshot({ featureGrants: actionGrants('VIEW_FULL_APPLICANT_INFORMATION') });
  assert.equal(evaluateHrAuthorization(viewOnly, { actionPermissionCodes: ['VIEW_FULL_APPLICANT_INFORMATION'] }, now).allowed, true, 'VIEW actions accept VIEW grants');
  assert.equal(evaluateHrAuthorization(viewOnly, { actionPermissionCodes: ['RECORD_INITIAL_INTERVIEW'] }, now).allowed, false, 'VIEW grants cannot perform EDIT actions');
  const criteriaEditor = snapshot({ featureGrants: actionGrants('MANAGE_INITIAL_INTERVIEW_CRITERIA').map((grant) => (
    grant.featureCode === 'MANAGE_INITIAL_INTERVIEW_CRITERIA' ? { ...grant, level: 'EDIT' as const } : grant
  )) });
  assert.equal(evaluateHrAuthorization(criteriaEditor, { actionPermissionCodes: ['MANAGE_INITIAL_INTERVIEW_CRITERIA'] }, now).allowed, false, 'EDIT grants cannot perform ADMIN actions');
}

{
  const futurePrerequisite = snapshot({ featureGrants: [
    { featureCode: 'VIEW_FULL_APPLICANT_INFORMATION', level: 'VIEW', status: 'ACTIVE', ...activeWindow },
    { featureCode: 'RECRUITMENT_CASES', level: 'VIEW', status: 'ACTIVE', effectiveFrom: new Date('2026-08-09T00:00:00.000Z'), effectiveTo: null },
  ] });
  assert.equal(evaluateHrAuthorization(futurePrerequisite, { actionPermissionCodes: ['VIEW_FULL_APPLICANT_INFORMATION'] }, now).allowed, false, 'future prerequisites do not satisfy an active action');
  const expiredPrerequisite = snapshot({ featureGrants: [
    { featureCode: 'VIEW_FULL_APPLICANT_INFORMATION', level: 'VIEW', status: 'ACTIVE', ...activeWindow },
    { featureCode: 'RECRUITMENT_CASES', level: 'VIEW', status: 'ACTIVE', effectiveFrom: activeWindow.effectiveFrom, effectiveTo: new Date('2026-08-08T09:00:00.000Z') },
  ] });
  assert.equal(evaluateHrAuthorization(expiredPrerequisite, { actionPermissionCodes: ['VIEW_FULL_APPLICANT_INFORMATION'] }, now).allowed, false, 'expired prerequisites do not satisfy an active action');
}

{
  const interviewOnly = snapshot({ featureGrants: [{ featureCode: 'RECORD_INITIAL_INTERVIEW', level: 'EDIT', status: 'ACTIVE', ...activeWindow }] });
  assert.equal(evaluateHrAuthorization(interviewOnly, { authorityCodes: ['HR_PROCESSOR'] }, now).allowed, false, 'an interview-only grant cannot unlock legacy processor routes');
  const processorBundle = actionPermissionsForLegacyAuthority('HR_PROCESSOR').map((code) => ({
    featureCode: code,
    level: getHrActionPermissionDefinition(code)?.level ?? 'VIEW',
    status: 'ACTIVE' as const,
    ...activeWindow,
  }));
  assert.equal(evaluateHrAuthorization(snapshot({ featureGrants: processorBundle }), { authorityCodes: ['HR_PROCESSOR'] }, now).allowed, true, 'legacy compatibility requires the complete migrated action bundle');
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
    user: { id: 'hr-manager', role: 'MANAGER', isActive: true },
    workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE', ...activeWindow }],
    featureGrants: [], authorityGrants: [],
  }), {
    workspaceLevel: 'ADMIN',
    actionPermissionCodes: ['RECORD_INITIAL_INTERVIEW', 'RECORD_PRELIMINARY_DECISION'],
  }, now).allowed, true, 'a MANAGER with complete HR workspace access receives the broad-manager override');
  assert.equal(evaluateHrAuthorization(snapshot({
    user: { id: 'hr-editor', role: 'MANAGER', isActive: true },
    workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'EDIT', status: 'ACTIVE', ...activeWindow }],
    featureGrants: [{ featureCode: 'RECORD_INITIAL_INTERVIEW', level: 'EDIT', status: 'ACTIVE', ...activeWindow }],
    authorityGrants: [{ authorityCode: 'HR_MANAGER', status: 'ACTIVE', ...activeWindow }],
  }), {
    workspaceLevel: 'EDIT',
    actionPermissionCodes: ['RECORD_PRELIMINARY_DECISION'],
  }, now).allowed, false, 'legacy authority does not grant an action and incomplete workspace access does not activate the override');
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
    workspacePermission: { findMany: async () => [] },
    featurePermission: { findMany: async () => [] },
    roleWorkspacePermission: { findMany: async () => [] },
    roleFeaturePermission: { findMany: async () => [] },
    hrBusinessAuthorityGrant: { findMany: async () => [grant] },
    crossWorkspaceDuty: { findMany: async () => [] },
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
