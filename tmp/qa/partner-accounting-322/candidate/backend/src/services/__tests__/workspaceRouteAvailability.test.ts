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
  console.log('Workspace direct-route authority matrix tests passed.');
};

void run();
