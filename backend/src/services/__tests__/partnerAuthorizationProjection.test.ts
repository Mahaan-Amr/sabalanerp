import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { createPartnerAuthorization } from '../partnerSales/authorization/service';
import { createAuthorizedCaseReader } from '../partnerSales/authorization/projections';
import type { AuthorizationEvidence } from '../partnerSales/authorization/contracts';

test('Case query uses purpose-specific strict DTOs and cannot follow a forged child owner or return nested economics', async () => {
  const fixture = createPartnerFixtures();
  const evidence: AuthorizationEvidence = {
    actor: { id: 'logistics-a', active: true, role: 'USER' },
    resource: { root: { kind: 'CASE', id: fixture.case.caseId }, partnerSellerId: fixture.case.partnerSellerId,
      partnerStatus: 'ACTIVE', lifecycleRevision: 1 },
    evaluatedAt: '2026-08-28T12:00:00.000Z', authorizationRevision: 1,
    grants: [{ action: 'FULFILLMENT_READ', rootKind: 'CASE', purpose: 'FULFILLMENT', scope: 'PURPOSE_BOUND', boundRootId: fixture.case.caseId }],
  };
  const binding = { actorId: 'logistics-a', purpose: 'FULFILLMENT' as const, channel: 'DETAIL' as const };
  let view: unknown = fixture.fulfillment;
  const reader = createAuthorizedCaseReader(createPartnerAuthorization({ read: async () => structuredClone(evidence) }, binding), {
    read: async () => structuredClone(view),
  });
  const query = { schemaVersion: 1 as const, purpose: 'FULFILLMENT' as const, expected: fixture.case.head };
  const safe = await reader.query(query);
  assert.deepEqual(safe, { ok: true, value: fixture.fulfillment });
  const economics = await reader.query({ ...query, purpose: 'PARTNER_CASE' });
  assert.equal(economics.ok, false);
  view = { ...fixture.fulfillment, products: [{ ...fixture.fulfillment.products[0], wholesaleUnitPrice: '800' }] };
  const leaked = await reader.query(query);
  assert.equal(leaked.ok ? null : leaked.error.code, 'INTEGRITY_CONFLICT');
  view = { ...fixture.fulfillment, owner: { ...fixture.case.head, caseId: 'foreign-case' } };
  const wrongRoot = await reader.query(query);
  assert.equal(wrongRoot.ok ? null : wrongRoot.error.status, 404);
});
