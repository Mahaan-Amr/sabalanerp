import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerActionV2 } from '@sabalanerp/partner-sales-contracts';
import { createPartnerAuthorization, createPartnerAuthorizationV2 } from '../partnerSales/authorization/service';
import type { AuthorizationEvidence, AuthorizationSource } from '../partnerSales/authorization/contracts';
import { projectActionAvailabilityV2 } from '../partnerSales/authorization/availability';

test('v2 commercial and conversion actions require their own current management grant; v1 stays closed', async () => {
  const evidence: AuthorizationEvidence<PartnerActionV2> = {
    evaluatedAt: '2026-08-29T08:00:00.000Z', authorizationRevision: 1,
    actor: { id: 'internal-a', active: true, role: 'MANAGER', departmentId: 'sales-a' },
    resource: { root: { kind: 'PROFILE', id: 'profile-a' }, partnerSellerId: 'partner-a',
      partnerStatus: 'PENDING', lifecycleRevision: 1, departmentId: 'sales-a' }, grants: [],
  };
  const source: AuthorizationSource<PartnerActionV2> = { read: async () => structuredClone(evidence) };
  const binding = { actorId: 'internal-a', purpose: 'MANAGEMENT' as const, channel: 'API' as const };
  const port = createPartnerAuthorizationV2(source, binding);
  const root = evidence.resource!.root;
  for (const action of ['COMMERCIAL_TERMS_MANAGE', 'PROFILE_CONVERSION_MANAGE'] as const) {
    evidence.grants = [];
    assert.equal((await port.authorize(action, root)).ok, false, 'manager title is not a grant');
    evidence.grants = [{ action, rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'DEPARTMENT' }];
    assert.equal((await port.authorize(action, root)).ok, true, action);
    evidence.grants[0].expiresAt = evidence.evaluatedAt;
    assert.equal((await port.authorize(action, root)).ok, false, 'exact expiry denies the v2 action');
  }
  const v1 = createPartnerAuthorization({ read: async () => ({ ...evidence, grants: [] }) }, binding);
  // A legacy caller receiving an unknown runtime action still fails closed.
  const unknown = await v1.authorize('COMMERCIAL_TERMS_MANAGE' as never, root);
  assert.equal(unknown.ok ? null : unknown.error.code, 'INVALID_PAYLOAD');
});

test('v2 availability never expands the Partner bundle and retains all ADMIN domain exceptions', async () => {
  const evidence: AuthorizationEvidence<PartnerActionV2> = {
    evaluatedAt: '2026-08-29T08:00:00.000Z', authorizationRevision: 1,
    actor: { id: 'partner-a', active: true, role: 'ADMIN', partnerProfile: { state: 'ACTIVE', revision: 1 } },
    resource: { root: { kind: 'PROFILE', id: 'profile-a' }, partnerSellerId: 'partner-a',
      partnerStatus: 'ACTIVE', lifecycleRevision: 1, departmentId: 'sales-a' },
    grants: [{ action: 'COMMERCIAL_TERMS_MANAGE', rootKind: 'PROFILE', purpose: 'MANAGEMENT', scope: 'COMPANY' }],
  };
  const source: AuthorizationSource<PartnerActionV2> = { read: async () => structuredClone(evidence) };
  const root = evidence.resource!.root;
  const partner = createPartnerAuthorizationV2(source, { actorId: 'partner-a', purpose: 'MANAGEMENT', channel: 'DETAIL' });
  const unavailable = await projectActionAvailabilityV2(partner, root, ['COMMERCIAL_TERMS_MANAGE', 'COMMERCIAL_TERMS_MANAGE']);
  assert.deepEqual(unavailable, [{ action: 'COMMERCIAL_TERMS_MANAGE', enabled: false, disabledReason: {
    code: 'FORBIDDEN', status: 403, message: 'اجازه انجام این اقدام را ندارید.',
  } }]);
  evidence.actor = { id: 'admin-a', active: true, role: 'ADMIN' };
  const admin = createPartnerAuthorizationV2(source, { actorId: 'admin-a', purpose: 'MANAGEMENT', channel: 'API' });
  assert.deepEqual(await projectActionAvailabilityV2(admin, root, ['PROFILE_CONVERSION_MANAGE']), [
    { action: 'PROFILE_CONVERSION_MANAGE', enabled: true },
  ]);
  for (const [action, purpose, kind] of [
    ['CASE_DRAFT_WRITE', 'PARTNER', 'CASE'], ['INQUIRY_RESPOND', 'RESPONDER', 'INQUIRY'],
    ['FINANCIAL_PROCESS', 'ACCOUNTING', 'CASE'], ['FINANCIAL_APPROVE', 'ACCOUNTING', 'CASE'],
    ['CORRECTION_REQUEST', 'ACCOUNTING', 'CASE'],
  ] as const) {
    evidence.resource!.root = { kind, id: 'resource-a' }; evidence.resource!.requesterId = 'admin-a';
    const port = createPartnerAuthorizationV2(source, { actorId: 'admin-a', purpose, channel: 'API' });
    assert.equal((await port.authorize(action, evidence.resource!.root)).ok, false, action);
  }
  evidence.resource = null;
  assert.deepEqual(await projectActionAvailabilityV2(admin, root, ['COMMERCIAL_TERMS_MANAGE']), []);
});
