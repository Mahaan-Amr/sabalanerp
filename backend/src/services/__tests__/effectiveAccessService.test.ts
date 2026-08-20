import assert from 'node:assert/strict';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { evaluateHrAuthorization } from '../hrAuthorizationPolicy';
import { loadHrAuthorizationSnapshot } from '../hrAuthorizationService';
import { HR_QA_ACCESS_MATRIX, HR_REDESIGN_CATALOG } from '../hrRedesignDataContracts';

const at = new Date('2026-08-20T10:00:00.000Z');

const client = {
  workspacePermission: {
    findMany: async () => [{
      id: 'accounting-direct', workspace: 'accounting', permissionLevel: 'edit',
      isActive: true, expiresAt: null,
    }],
  },
  roleWorkspacePermission: {
    findMany: async () => [{
      id: 'hr-role', workspace: 'hr', permissionLevel: 'view', isActive: true,
    }],
  },
  featurePermission: {
    findMany: async () => [{
      id: 'accounting-feature', workspace: 'accounting', feature: 'accounting_contracts_view',
      permissionLevel: 'view', isActive: true, expiresAt: null,
    }],
  },
  roleFeaturePermission: {
    findMany: async () => [
      { id: 'hr-role-dashboard', workspace: 'hr', feature: 'DASHBOARD', permissionLevel: 'view', isActive: true },
      { id: 'hr-role-personnel', workspace: 'hr', feature: 'PERSONNEL', permissionLevel: 'view', isActive: true },
    ],
  },
  hrWorkspaceAccessGrant: {
    findMany: async () => [{
      id: 'hr-direct', workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null,
    }],
  },
  hrFeatureAccessGrant: {
    findMany: async () => [{
      id: 'hr-personnel-direct', featureCode: 'PERSONNEL', level: 'EDIT', status: 'ACTIVE',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null, reason: 'QA access',
    }],
  },
};

const run = async () => {
  const access = await getEffectiveUserAccess(client as never, {
    userId: 'qa-hr-manager',
    userRole: 'USER',
    at,
  });
  assert.deepEqual(access.workspaces, [
    { workspace: 'accounting', permission: 'edit' },
    { workspace: 'hr', permission: 'admin' },
  ]);
  assert.deepEqual(access.features.filter(({ workspace }) => workspace === 'hr'), [
    { feature: 'PERSONNEL', permission: 'edit', workspace: 'hr' },
    { feature: 'DASHBOARD', permission: 'view', workspace: 'hr' },
  ]);
  assert.deepEqual(
    access.features.find(({ feature }) => feature === 'accounting_contracts_view'),
    { feature: 'accounting_contracts_view', permission: 'view', workspace: 'accounting' },
  );

  const managerClient = {
    ...client,
    workspacePermission: { findMany: async () => [] },
    roleWorkspacePermission: { findMany: async () => [] },
    featurePermission: { findMany: async () => [] },
    roleFeaturePermission: { findMany: async () => [] },
    hrFeatureAccessGrant: { findMany: async () => [] },
  };
  const managerAccess = await getEffectiveUserAccess(managerClient as never, {
    userId: 'hr-manager',
    userRole: 'MANAGER',
    at,
  });
  assert.deepEqual(
    managerAccess.features.find(({ feature }) => feature === 'PERSONNEL'),
    { feature: 'PERSONNEL', permission: 'admin', workspace: 'hr' },
    'an internal MANAGER with active canonical HR ADMIN access receives the broad-manager feature projection',
  );
  assert.equal(
    new Set(managerAccess.features.map(({ feature }) => feature)).size,
    managerAccess.features.length,
    'broad manager projection must not duplicate HR action permissions',
  );

  const directOverrideClient = {
    ...client,
    workspacePermission: { findMany: async () => [] },
    roleWorkspacePermission: {
      findMany: async () => [{ id: 'hr-role-admin', workspace: 'hr', permissionLevel: 'admin', isActive: true }],
    },
    featurePermission: { findMany: async () => [] },
    roleFeaturePermission: {
      findMany: async () => [{ id: 'hr-role-personnel', workspace: 'hr', feature: 'PERSONNEL', permissionLevel: 'admin', isActive: true }],
    },
    hrWorkspaceAccessGrant: {
      findMany: async () => [{
        id: 'hr-direct-view', workspaceCode: 'HUMAN_RESOURCES', level: 'VIEW', status: 'ACTIVE',
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null, reason: 'direct view',
      }],
    },
    hrFeatureAccessGrant: {
      findMany: async () => [{
        id: 'hr-personnel-view', featureCode: 'PERSONNEL', level: 'VIEW', status: 'ACTIVE',
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), effectiveTo: null, reason: 'direct view',
      }],
    },
  };
  const directOverride = await getEffectiveUserAccess(directOverrideClient as never, {
    userId: 'direct-viewer', userRole: 'USER', at,
  });
  assert.deepEqual(directOverride.workspaces, [{ workspace: 'hr', permission: 'view' }]);
  assert.deepEqual(directOverride.features, [{ feature: 'PERSONNEL', permission: 'view', workspace: 'hr' }]);

  const serverSnapshot = await loadHrAuthorizationSnapshot({
    ...directOverrideClient,
    user: {
      findUnique: async () => ({ id: 'direct-viewer', role: 'USER', isActive: true }),
    },
    crossWorkspaceDuty: { findMany: async () => [] },
  } as never, 'direct-viewer');
  assert.equal(
    evaluateHrAuthorization(serverSnapshot, {
      workspaceLevel: 'ADMIN',
      feature: { code: 'PERSONNEL', level: 'ADMIN' },
    }, at).allowed,
    false,
    'server authorization must use the same direct-over-role effective precedence as discovery and profile data',
  );

  const expiredDirectClient = {
    ...directOverrideClient,
    hrWorkspaceAccessGrant: {
      findMany: async () => [{
        id: 'expired-workspace', workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: new Date('2026-08-19T00:00:00.000Z'), reason: 'expired',
      }],
    },
    hrFeatureAccessGrant: {
      findMany: async () => [{
        id: 'expired-feature', featureCode: 'PERSONNEL', level: 'ADMIN', status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: new Date('2026-08-19T00:00:00.000Z'), reason: 'expired',
      }],
    },
  };
  const inheritedFallback = await getEffectiveUserAccess(expiredDirectClient as never, {
    userId: 'role-admin', userRole: 'USER', at,
  });
  assert.deepEqual(inheritedFallback.workspaces, [{ workspace: 'hr', permission: 'admin' }]);
  assert.deepEqual(inheritedFallback.features, [{ feature: 'PERSONNEL', permission: 'admin', workspace: 'hr' }]);
  const inheritedServerSnapshot = await loadHrAuthorizationSnapshot({
    ...expiredDirectClient,
    user: {
      findUnique: async () => ({ id: 'role-admin', role: 'USER', isActive: true }),
    },
    crossWorkspaceDuty: { findMany: async () => [] },
  } as never, 'role-admin');
  assert.equal(
    evaluateHrAuthorization(inheritedServerSnapshot, {
      workspaceLevel: 'ADMIN',
      feature: { code: 'PERSONNEL', level: 'ADMIN' },
    }, at).allowed,
    true,
    'expired direct grants must fall back to active role defaults in server authorization',
  );
  const revokedFallback = await getEffectiveUserAccess({
    ...expiredDirectClient,
    hrWorkspaceAccessGrant: { findMany: async () => [{
      workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'REVOKED',
      effectiveFrom: new Date('2026-08-01'), effectiveTo: null, reason: 'revoked',
    }] },
    hrFeatureAccessGrant: { findMany: async () => [{
      featureCode: 'PERSONNEL', level: 'ADMIN', status: 'REVOKED',
      effectiveFrom: new Date('2026-08-01'), effectiveTo: null, reason: 'revoked',
    }] },
  } as never, { userId: 'role-admin', userRole: 'USER', at });
  assert.deepEqual(revokedFallback.workspaces, [{ workspace: 'hr', permission: 'admin' }]);
  assert.deepEqual(revokedFallback.features, [{ feature: 'PERSONNEL', permission: 'admin', workspace: 'hr' }]);

  const datedClient = {
    ...managerClient,
    user: { findUnique: async () => ({ id: 'dated-user', role: 'USER', isActive: true }) },
    crossWorkspaceDuty: { findMany: async () => [] },
    hrWorkspaceAccessGrant: { findMany: async () => [{
      workspaceCode: 'HUMAN_RESOURCES', level: 'VIEW', status: 'ACTIVE',
      effectiveFrom: new Date('2027-01-01'), effectiveTo: new Date('2027-02-01'), reason: 'dated',
    }] },
    hrFeatureAccessGrant: { findMany: async () => [{
      featureCode: 'PERSONNEL', level: 'VIEW', status: 'ACTIVE',
      effectiveFrom: new Date('2027-01-01'), effectiveTo: new Date('2027-02-01'), reason: 'dated',
    }] },
  };
  const futureEffectiveAt = new Date('2027-01-15');
  const futureSnapshot = await loadHrAuthorizationSnapshot(datedClient as never, 'dated-user', futureEffectiveAt);
  assert.equal(
    evaluateHrAuthorization(futureSnapshot, {
      workspaceLevel: 'VIEW', feature: { code: 'PERSONNEL', level: 'VIEW' },
    }, futureEffectiveAt).allowed,
    true,
    'future-starting grants must be projected against the supplied evaluation time',
  );
  const expiredEvaluationAt = new Date('2027-02-15');
  const expiredSnapshot = await loadHrAuthorizationSnapshot(datedClient as never, 'dated-user', expiredEvaluationAt);
  assert.equal(
    evaluateHrAuthorization(expiredSnapshot, {
      workspaceLevel: 'VIEW', feature: { code: 'PERSONNEL', level: 'VIEW' },
    }, expiredEvaluationAt).allowed,
    false,
    'future-expired grants must not survive projection at the supplied evaluation time',
  );

  const danglingHrFeature = await getEffectiveUserAccess({
    ...directOverrideClient,
    roleWorkspacePermission: { findMany: async () => [] },
    hrWorkspaceAccessGrant: { findMany: async () => [] },
  } as never, { userId: 'finance-only', userRole: 'USER', at });
  assert.deepEqual(
    danglingHrFeature.features.filter(({ workspace }) => workspace === 'hr'),
    [],
    'an HR feature grant is not effective without an effective HR workspace layer',
  );

  const workspaceCappedFeature = await getEffectiveUserAccess({
    ...directOverrideClient,
    hrFeatureAccessGrant: { findMany: async () => [{
      featureCode: 'PERSONNEL', level: 'EDIT', status: 'ACTIVE',
      effectiveFrom: new Date('2026-08-01'), effectiveTo: null, reason: 'direct edit',
    }] },
  } as never, { userId: 'workspace-viewer', userRole: 'USER', at });
  assert.deepEqual(
    workspaceCappedFeature.features,
    [{ feature: 'PERSONNEL', permission: 'view', workspace: 'hr' }],
    'effective HR feature level cannot exceed the effective HR workspace level',
  );

  for (const [username, contract] of Object.entries(HR_QA_ACCESS_MATRIX)) {
    const matrixClient = {
      workspacePermission: { findMany: async () => contract.destinationWorkspace === 'ACCOUNTING'
        ? [{ workspace: 'accounting', permissionLevel: 'edit', isActive: true, expiresAt: null }]
        : [] },
      roleWorkspacePermission: { findMany: async () => [] },
      featurePermission: { findMany: async () => [] },
      roleFeaturePermission: { findMany: async () => [] },
      hrWorkspaceAccessGrant: { findMany: async () => contract.workspaceLevel
        ? [{ workspaceCode: 'HUMAN_RESOURCES', level: contract.workspaceLevel, status: 'ACTIVE', effectiveFrom: new Date('2026-08-01'), effectiveTo: null, reason: 'QA matrix' }]
        : [] },
      hrFeatureAccessGrant: { findMany: async () => Object.entries(contract.features).map(([featureCode, level]) => ({
        featureCode, level, status: 'ACTIVE', effectiveFrom: new Date('2026-08-01'), effectiveTo: null, reason: 'QA matrix',
      })) },
    };
    const matrixAccess = await getEffectiveUserAccess(matrixClient as never, { userId: username, userRole: 'USER', at });
    assert.equal(
      matrixAccess.workspaces.some(({ workspace }) => workspace === 'hr'),
      contract.workspaceLevel !== null,
      `${username}: HR workspace visibility must match the approved QA matrix`,
    );
    assert.equal(
      matrixAccess.workspaces.some(({ workspace }) => workspace === 'accounting'),
      contract.destinationWorkspace === 'ACCOUNTING',
      `${username}: Accounting visibility must remain independent from HR`,
    );
    const projectedHrFeatures = new Set(matrixAccess.features.filter(({ workspace }) => workspace === 'hr').map(({ feature }) => feature));
    for (const { code } of HR_REDESIGN_CATALOG.workspaceFeatures) {
      assert.equal(
        projectedHrFeatures.has(code),
        Object.prototype.hasOwnProperty.call(contract.features, code),
        `${username}: ${code} positive/negative visibility must match the approved QA matrix`,
      );
    }
  }

  console.log('Effective access service tests passed.');
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
