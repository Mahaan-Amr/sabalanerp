import assert from 'node:assert/strict';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';

const emptyClient = {
  workspacePermission: { findMany: async () => [], findUnique: async () => null },
  roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
  featurePermission: { findMany: async () => [], findUnique: async () => null },
  roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
  hrWorkspaceAccessGrant: { findMany: async () => [] },
  hrFeatureAccessGrant: { findMany: async () => [] },
};

const clientWith = (workspace: string) => ({
  ...emptyClient,
  workspacePermission: {
    ...emptyClient.workspacePermission,
    findMany: async () => [{ id: 'grant', userId: 'operator', workspace, permissionLevel: 'view', isActive: true, expiresAt: null }],
  },
  hrWorkspaceAccessGrant: {
    findMany: async () => workspace === 'hr' ? [{
      id: 'hr-grant', userId: 'operator', workspaceCode: 'HUMAN_RESOURCES', level: 'VIEW',
      status: 'ACTIVE', effectiveFrom: new Date('2020-01-01'), effectiveTo: null, reason: 'explicit test grant',
    }] : [],
  },
});

const run = async () => {
  const workspaces = ['sales', 'crm', 'hr', 'accounting', 'inventory', 'security', 'bi', 'logistics'];
  for (const workspace of workspaces) {
    const admin = await resolveWorkspaceRouteAvailability(emptyClient as never, {
      userId: 'admin', role: 'ADMIN', path: `/dashboard/${workspace}`,
    });
    assert.equal(admin.allowed, true);
    for (const role of ['USER', 'MANAGER']) {
      const denied = await resolveWorkspaceRouteAvailability(emptyClient as never, {
        userId: role.toLowerCase(), role, path: `/dashboard/${workspace}`,
      });
      assert.equal(denied.allowed, false, `${role} without a grant must be denied from ${workspace}`);
      assert.match(denied.reason || '', /مدیر همان فضای کاری/);
    }
  }
  const unrelated = await resolveWorkspaceRouteAvailability(emptyClient as never, {
    userId: 'user', role: 'USER', path: '/dashboard/profile',
  });
  assert.equal(unrelated.allowed, true);
  for (const [workspace, path, purposes] of [
    ['sales', '/dashboard/sales/partners', ['MANAGEMENT']],
    ['sales', '/dashboard/sales/partner-inquiries', ['RESPONDER']],
  ] as const) {
    const client = { ...clientWith(workspace), $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({}) };
    const inherited = await resolveWorkspaceRouteAvailability(client as never, {
      userId: 'operator', role: 'USER', path,
    }, async () => ({ authorizationRevision: 1, grants: [] }));
    assert.equal(inherited.allowed, false, `${path} must reject inherited workspace membership`);
    const admitted = await resolveWorkspaceRouteAvailability(client as never, {
      userId: 'operator', role: 'USER', path,
    }, async () => ({ authorizationRevision: 1, grants: [{ purpose: purposes[0] }] as never }));
    assert.equal(admitted.allowed, true, `${path} must accept an explicit Partner-domain grant`);
  }
  console.log('Workspace direct-route authority matrix tests passed.');
};

void run();
