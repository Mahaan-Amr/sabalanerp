import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateWorkspaceDutyAuthority, resolveWorkspaceDutyAuthority } from '../crossWorkspaceDutyAuthority';

const grant = (permissionLevel: 'view' | 'edit' | 'admin') => ({ permissionLevel });

test('workspace administration alone does not grant a duty feature', () => {
  assert.deepEqual(evaluateWorkspaceDutyAuthority({
    role: 'MANAGER',
    directWorkspace: grant('admin'),
    roleWorkspace: null,
    directFeature: null,
    roleFeature: null,
  }), { isWorkspaceAdmin: true, hasFeatureEdit: false, canSelfDecide: false });
});

test('workspace administration plus an effective edit feature permits self-decision', () => {
  assert.deepEqual(evaluateWorkspaceDutyAuthority({
    role: 'USER',
    directWorkspace: grant('admin'),
    roleWorkspace: null,
    directFeature: null,
    roleFeature: grant('edit'),
  }), { isWorkspaceAdmin: true, hasFeatureEdit: true, canSelfDecide: true });
});

test('an explicit lower feature grant narrows inherited edit authority', () => {
  assert.deepEqual(evaluateWorkspaceDutyAuthority({
    role: 'USER',
    directWorkspace: grant('admin'),
    roleWorkspace: null,
    directFeature: grant('view'),
    roleFeature: grant('edit'),
  }), { isWorkspaceAdmin: true, hasFeatureEdit: false, canSelfDecide: false });
});

test('global MANAGER has no workspace authority without a workspace grant', () => {
  assert.deepEqual(evaluateWorkspaceDutyAuthority({
    role: 'MANAGER',
    directWorkspace: null,
    roleWorkspace: null,
    directFeature: grant('edit'),
    roleFeature: null,
  }), { isWorkspaceAdmin: false, hasFeatureEdit: true, canSelfDecide: false });
});

test('global ADMIN retains system-wide duty authority', () => {
  assert.deepEqual(evaluateWorkspaceDutyAuthority({
    role: 'ADMIN',
    directWorkspace: null,
    roleWorkspace: null,
    directFeature: null,
    roleFeature: null,
  }), { isWorkspaceAdmin: true, hasFeatureEdit: true, canSelfDecide: true });
});

const accessClient = (overrides: { directWorkspace?: any; directFeature?: any } = {}) => {
  const directWorkspace = overrides.directWorkspace ?? {
    id: 'workspace-direct', workspace: 'accounting', permissionLevel: 'admin', isActive: true, expiresAt: null,
  };
  const directFeature = overrides.directFeature ?? {
    id: 'feature-direct', workspace: 'accounting', feature: 'approve', permissionLevel: 'edit', isActive: true, expiresAt: null,
  };
  return {
    user: { findUnique: async () => ({ role: 'MANAGER', isActive: true }) },
    workspacePermission: {
      findMany: async () => directWorkspace ? [directWorkspace] : [],
      findUnique: async () => directWorkspace,
    },
    roleWorkspacePermission: {
      findMany: async () => [{ id: 'workspace-role', workspace: 'accounting', permissionLevel: 'admin', isActive: true }],
    },
    featurePermission: {
      findMany: async () => directFeature ? [directFeature] : [],
      findUnique: async () => directFeature,
    },
    roleFeaturePermission: {
      findMany: async () => [{ id: 'feature-role', workspace: 'accounting', feature: 'approve', permissionLevel: 'admin', isActive: true }],
      findUnique: async () => ({ id: 'feature-role', workspace: 'accounting', feature: 'approve', permissionLevel: 'admin', isActive: true }),
    },
    hrWorkspaceAccessGrant: { findMany: async () => [], findFirst: async () => null },
    hrFeatureAccessGrant: { findMany: async () => [], findFirst: async () => null },
  };
};

test('expired direct feature vetoes role fallback in the duty policy and preserves provenance', async () => {
  const result = await resolveWorkspaceDutyAuthority(accessClient({
    directFeature: {
      id: 'expired-feature', workspace: 'accounting', feature: 'approve', permissionLevel: 'edit',
      isActive: true, expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  }) as never, { userId: 'samane', workspace: 'accounting', feature: 'approve', at: new Date('2026-08-23T00:00:00.000Z') });
  assert.equal(result.canSelfDecide, false);
  assert.deepEqual(result.provenance.feature, { source: 'DIRECT_FEATURE', grantId: 'expired-feature' });
});

test('revoked direct workspace vetoes inherited workspace administration', async () => {
  const result = await resolveWorkspaceDutyAuthority(accessClient({
    directWorkspace: {
      id: 'revoked-workspace', workspace: 'accounting', permissionLevel: 'admin', isActive: false, expiresAt: null,
    },
  }) as never, { userId: 'samane', workspace: 'accounting', feature: 'approve' });
  assert.equal(result.isWorkspaceAdmin, false);
  assert.equal(result.canSelfDecide, false);
});
