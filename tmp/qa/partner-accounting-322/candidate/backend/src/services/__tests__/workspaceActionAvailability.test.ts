import assert from 'node:assert/strict';
import { WORKSPACE_ACTION_RULES, resolveWorkspaceActionAvailability } from '../workspaceActionAvailability';

const run = async () => {
  assert.deepEqual(Object.keys(WORKSPACE_ACTION_RULES).sort(), [
    'accounting', 'bi', 'crm', 'hr', 'inventory', 'logistics', 'sales', 'security',
  ]);
  for (const workspace of Object.keys(WORKSPACE_ACTION_RULES) as Array<keyof typeof WORKSPACE_ACTION_RULES>) {
    const availability = await resolveWorkspaceActionAvailability({} as never, {
      userId: 'system-admin', role: 'ADMIN', workspace,
    });
    assert.equal(Object.keys(availability).length, Object.keys(WORKSPACE_ACTION_RULES[workspace]).length);
    assert.ok(Object.values(availability).every(({ visible, enabled, reason }) => visible && enabled && reason === null));
    assert.ok(Object.values(WORKSPACE_ACTION_RULES[workspace]).every((rule) => rule.workspace === workspace));
  }
  const emptyClient = {
    workspacePermission: { findMany: async () => [], findUnique: async () => null },
    roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
    featurePermission: { findMany: async () => [], findUnique: async () => null },
    roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
    hrWorkspaceAccessGrant: { findMany: async () => [] },
    hrFeatureAccessGrant: { findMany: async () => [] },
  };
  for (const role of ['USER', 'MANAGER']) for (const workspace of Object.keys(WORKSPACE_ACTION_RULES) as Array<keyof typeof WORKSPACE_ACTION_RULES>) {
    const availability = await resolveWorkspaceActionAvailability(emptyClient as never, {
      userId: `${role.toLowerCase()}-without-grants`, role, workspace,
    });
    assert.ok(Object.values(availability).every(({ visible, enabled, reason }) => (
      !visible && !enabled && typeof reason === 'string' && /مدیر همان فضای کاری/.test(reason)
    )), `${role} must not receive a global bypass in ${workspace}`);
  }
  console.log('Workspace action availability matrix tests passed.');
};

void run();
