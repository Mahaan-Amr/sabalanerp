import assert from 'node:assert/strict';
import test from 'node:test';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { evaluateNarrowFeatureAccess } from '../narrowFeatureAccess';
import { evaluateHrAuthorization } from '../hrAuthorizationPolicy';
import { FEATURES, FEATURE_WORKSPACE_MAP, requireAnyFeatureAccessWithClient } from '../../middleware/feature';

const at = new Date('2026-10-11T10:00:00Z');
const workspaceNames = ['sales', 'crm', 'hr', 'accounting', 'inventory', 'security', 'bi', 'logistics'];
const matrix = workspaceNames.map(workspace => ({ workspace, feature: workspace === 'hr' ? 'PERSONNEL'
  : Object.entries(FEATURE_WORKSPACE_MAP).find(([feature, value]) => value === workspace && feature.endsWith('_view'))![0] }));
const workspaceRows = workspaceNames.map(workspace => ({ id: workspace, workspace, permissionLevel: 'admin', isActive: true, expiresAt: null }));
const empty = { findMany: async () => [], findUnique: async () => null };
function client(off: string[]) {
  const rows = matrix.filter(row => off.includes(row.feature)).map(row => ({ ...row, permissionLevel: 'none', isActive: true, expiresAt: null }));
  return {
    featurePermission: { findMany: async () => rows, findUnique: async (args: any) => rows.find(row => row.feature === args.where.userId_workspace_feature.feature) ?? null },
    roleFeaturePermission: empty,
    workspacePermission: { findMany: async () => workspaceRows, findUnique: async () => workspaceRows[0] },
    roleWorkspacePermission: empty,
    hrWorkspaceAccessGrant: { findMany: async () => [{ id: 'hr', workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', status: 'ACTIVE', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, reason: 'test' }] },
    hrFeatureAccessGrant: { findMany: async () => [{ id: 'personnel', featureCode: 'PERSONNEL', level: 'ADMIN', status: 'ACTIVE', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, reason: 'test' }] },
  };
}
for (const role of ['USER', 'MANAGER', 'ADMIN']) test(`${role}: off overrides administration in all eight workspaces; on restores only the operation`, async () => {
  const baseline = await getEffectiveUserAccess(client([]) as never, { userId: role, userRole: role, at });
  for (const { feature } of matrix) {
    const denied = await getEffectiveUserAccess(client([feature]) as never, { userId: role, userRole: role, at });
    assert.equal(denied.features.some(row => row.feature === feature), false);
    assert.deepEqual(denied.workspaces, baseline.workspaces, 'workspace management level stays unchanged');
    assert.deepEqual(denied.features.filter(row => row.feature !== feature), baseline.features.filter(row => row.feature !== feature));
    assert.equal(evaluateNarrowFeatureAccess({ role, requiredPermission: 'edit', userFeature: { isActive: true, permissionLevel: 'none' }, roleFeature: { isActive: true, permissionLevel: 'admin' }, userWorkspace: workspaceRows[0], roleWorkspace: workspaceRows[0] }, at).allowed, false);
    const restored = await getEffectiveUserAccess(client([]) as never, { userId: role, userRole: role, at });
    assert.equal(restored.features.some(row => row.feature === feature), true);
  }
});
test('revocation beats HR baseline and canonical grants without changing identity', () => {
  for (const role of ['MANAGER', 'ADMIN']) {
    const snapshot = { user: { id: role, role, isActive: true }, disabledFeatures: ['PERSONNEL'], workspaceGrants: [{ workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN' as const, status: 'ACTIVE' as const, effectiveFrom: new Date('2020-01-01'), effectiveTo: null }], featureGrants: [{ featureCode: 'PERSONNEL', level: 'ADMIN' as const, status: 'ACTIVE' as const, effectiveFrom: new Date('2020-01-01'), effectiveTo: null }], authorityGrants: [], assignedDutyIds: [] };
    assert.equal(evaluateHrAuthorization(snapshot, { feature: { code: 'PERSONNEL', level: 'EDIT' } }, at).allowed, false);
    assert.equal(snapshot.user.role, role);
  }
});
test('OR middleware denies even system ADMIN when every alternative is off', async () => {
  const off = { isActive: true, permissionLevel: 'none', expiresAt: null };
  const db = { featurePermission: { findUnique: async () => off }, roleFeaturePermission: empty, workspacePermission: empty, roleWorkspacePermission: empty };
  let status = 0; let nextCalled = false;
  const res = { status(value: number) { status = value; return this; }, json() { return this; } };
  await requireAnyFeatureAccessWithClient(db as never, [FEATURES.SALES_CONTRACTS_VIEW], 'view')({ user: { id: 'admin', role: 'ADMIN' } } as never, res as never, () => { nextCalled = true; });
  assert.equal(status, 403); assert.equal(nextCalled, false);
});
