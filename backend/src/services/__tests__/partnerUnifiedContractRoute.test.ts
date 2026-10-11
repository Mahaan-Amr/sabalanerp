import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';

test('unified contract list keeps Partner lifecycle read admission without ordinary sales grants', async () => {
  for (const state of ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'PENDING']) {
    const client = { partnerProfile: { findUnique: async () => ({ state }) } };
    const decision = await resolveWorkspaceRouteAvailability(client as never,
      { userId: 'partner-fixture', role: 'SALES', path: '/dashboard/sales/contracts' });
    assert.equal(decision.allowed, state !== 'PENDING', state);
  }
});
