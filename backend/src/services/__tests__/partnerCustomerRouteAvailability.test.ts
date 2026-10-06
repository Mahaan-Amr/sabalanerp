import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';

const emptyClient = {
  workspacePermission: { findMany: async () => [], findUnique: async () => null },
  roleWorkspacePermission: { findMany: async () => [], findUnique: async () => null },
  featurePermission: { findMany: async () => [], findUnique: async () => null },
  roleFeaturePermission: { findMany: async () => [], findUnique: async () => null },
  hrWorkspaceAccessGrant: { findMany: async () => [] },
  hrFeatureAccessGrant: { findMany: async () => [] },
  partnerProfile: { findUnique: async () => null },
};

test('Partner customer creation admits only active owners without broadening CRM', async () => {
  for (const state of ['ACTIVE', 'SUSPENDED', 'TERMINATED']) {
    const client = { ...emptyClient, partnerProfile: { findUnique: async () => ({ id: 'owned-profile', state }) } };
    const result = await resolveWorkspaceRouteAvailability(client as never, {
      userId: 'partner', role: 'USER', path: '/dashboard/crm/customers/create',
    });
    assert.equal(result.allowed, state === 'ACTIVE', `Partner customer creation must respect ${state}`);
    const general = await resolveWorkspaceRouteAvailability(client as never, {
      userId: 'partner', role: 'USER', path: '/dashboard/crm/customers',
    });
    assert.equal(general.allowed, false, 'Partner creation must not grant general CRM access');
  }
  assert.equal((await resolveWorkspaceRouteAvailability(emptyClient as never, {
    userId: 'ordinary', role: 'USER', path: '/dashboard/crm/customers/create',
  })).allowed, false);
});
