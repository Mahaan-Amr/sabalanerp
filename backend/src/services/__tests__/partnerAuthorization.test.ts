import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerAction, PermissionContext } from '@sabalanerp/partner-sales-contracts';
import { createPartnerAuthorization } from '../partnerSales/authorization/service';
import { projectActionAvailability } from '../partnerSales/authorization/availability';
import type { AuthorizationEvidence, AuthorizationSource } from '../partnerSales/authorization/contracts';

// In-memory persistence adapter at the evidence seam; the real policy is never mocked.
function fixture() {
  const evidence: AuthorizationEvidence = {
    evaluatedAt: '2026-08-28T12:00:00.000Z', authorizationRevision: 1,
    actor: { id: 'partner-a', active: true, role: 'USER',
      partnerProfile: { state: 'ACTIVE', revision: 1 } },
    resource: { root: { kind: 'CASE', id: 'case-a' }, partnerSellerId: 'partner-a',
      partnerStatus: 'ACTIVE', lifecycleRevision: 1, departmentId: 'sales-a' },
    grants: [],
  };
  const source: AuthorizationSource = { read: async (_actorId, root) =>
    root.id === evidence.resource?.root.id ? structuredClone(evidence) : { ...structuredClone(evidence), resource: null } };
  return { evidence, source, port: createPartnerAuthorization(source, {
    actorId: 'partner-a', purpose: 'PARTNER', channel: 'DETAIL',
  }) };
}

test('own Case is accessible but a foreign or missing direct id has the same non-disclosing result', async () => {
  const { evidence, port } = fixture();
  const own = await port.authorize('CASE_READ', { kind: 'CASE', id: 'case-a' });
  assert.equal(own.ok, true);
  evidence.resource!.partnerSellerId = 'partner-b';
  const foreign = await port.authorize('CASE_READ', { kind: 'CASE', id: 'case-a' });
  const missing = await port.authorize('CASE_READ', { kind: 'CASE', id: 'missing' });
  assert.deepEqual(foreign, missing);
  assert.equal(foreign.ok ? null : foreign.error.status, 404);
});

test('suspension blocks a new commitment but not named cancellation or committed downstream authority; private public-channel reads are denied', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'admin-a', active: true, role: 'ADMIN' };
  evidence.resource!.partnerStatus = 'SUSPENDED';
  const port = createPartnerAuthorization(source, { actorId: 'admin-a', purpose: 'MANAGEMENT', channel: 'API' });
  const commit = await port.authorize('CASE_COMMIT', evidence.resource!.root);
  assert.equal(commit.ok ? null : commit.error.code, 'PARTNER_NOT_ACTIVE');
  assert.equal((await port.authorize('CASE_CANCEL', evidence.resource!.root)).ok, true);
  const accounting = createPartnerAuthorization(source, { actorId: 'admin-a', purpose: 'ACCOUNTING', channel: 'API' });
  assert.equal((await accounting.authorize('ACCOUNTING_WRITE', evidence.resource!.root)).ok, true);
  const publicChannel = createPartnerAuthorization(source, { actorId: 'admin-a', purpose: 'MANAGEMENT', channel: 'PUBLIC' });
  assert.equal((await publicChannel.authorize('CASE_READ', evidence.resource!.root)).ok, false);
});

test('wrong-purpose grant cannot disclose existence and responder read requires a current assignment', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'internal-a', active: true, role: 'USER' };
  evidence.grants = [{ action: 'CASE_READ', rootKind: 'CASE', purpose: 'CRM', scope: 'COMPANY' }];
  const crm = createPartnerAuthorization(source, { actorId: 'internal-a', purpose: 'CRM', channel: 'DETAIL' });
  const result = await crm.authorize('CASE_READ', evidence.resource!.root);
  assert.equal(result.ok ? null : result.error.status, 404);
  evidence.resource!.root.kind = 'INQUIRY';
  evidence.grants = [{ action: 'INQUIRY_READ', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'COMPANY' }];
  const responder = createPartnerAuthorization(source, { actorId: 'internal-a', purpose: 'RESPONDER', channel: 'DETAIL' });
  assert.equal((await responder.authorize('INQUIRY_READ', evidence.resource!.root)).ok, false);
});

test('all read channels use the same predicate and availability exposes only canonical reasons, never policy context', async () => {
  const { evidence, source } = fixture();
  const root = { kind: 'CASE' as const, id: 'case-a' };
  for (const channel of ['LIST', 'DETAIL', 'SEARCH', 'COUNT', 'EXPORT', 'NOTIFICATION', 'PDF', 'LINK', 'API'] as const) {
    evidence.resource!.partnerSellerId = 'partner-a';
    const port = createPartnerAuthorization(source, { actorId: 'partner-a', purpose: 'PARTNER', channel });
    assert.equal((await port.authorize('CASE_READ', root)).ok, true, channel);
    evidence.resource!.partnerSellerId = 'partner-b';
    assert.equal((await port.authorize('CASE_READ', root)).ok, false, channel);
    assert.deepEqual(await projectActionAvailability(port, root, ['CASE_READ', 'CASE_DRAFT_WRITE']), []);
  }
  evidence.resource!.partnerSellerId = 'partner-a';
  evidence.actor.partnerProfile!.state = evidence.resource!.partnerStatus = 'SUSPENDED';
  const port = createPartnerAuthorization(source, { actorId: 'partner-a', purpose: 'PARTNER', channel: 'DETAIL' });
  const availability = await projectActionAvailability(port, root, ['CASE_READ', 'CASE_DRAFT_WRITE', 'CASE_READ']);
  assert.deepEqual(availability, [
    { action: 'CASE_READ', enabled: true },
    { action: 'CASE_DRAFT_WRITE', enabled: false, disabledReason: {
      code: 'PARTNER_NOT_ACTIVE', status: 409, message: 'حساب فروشنده همکار فعال نیست.',
    } },
  ]);
});

test('all named internal management actions retain explicit authority, without granting Partner authorship', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'internal-a', active: true, role: 'USER', departmentId: 'sales-a' };
  const entries: Array<[PartnerAction, PermissionContext['root']['kind'], PermissionContext['purpose']]> = [
    ['PROFILE_CREATE', 'PROFILE', 'ONBOARDING'], ['PROFILE_ACTIVATE', 'PROFILE', 'ONBOARDING'],
    ['PROFILE_SUSPEND', 'PROFILE', 'ONBOARDING'], ['PROFILE_TERMINATE', 'PROFILE', 'ONBOARDING'],
    ['RESPONDER_ASSIGN', 'PROFILE', 'MANAGEMENT'], ['RESPONDER_REASSIGN', 'INQUIRY', 'MANAGEMENT'],
    ['INQUIRY_READ', 'INQUIRY', 'MANAGEMENT'], ['CASE_COMMIT', 'CASE', 'MANAGEMENT'],
    ['CUSTOMER_OUTPUT', 'CASE', 'CUSTOMER_OUTPUT'], ['CORRECTION_SCOPE_APPROVE', 'CASE', 'MANAGEMENT'],
    ['FINANCIAL_VERIFY', 'CASE', 'ACCOUNTING'], ['INTERNAL_REMEDIATION', 'CASE', 'MANAGEMENT'],
    ['CREDIT_TERMS_MANAGE', 'PROFILE', 'ACCOUNTING'], ['REPORT_READ', 'PROFILE', 'MANAGEMENT'],
    ['REPORT_READ', 'PROFILE', 'ACCOUNTING'], ['AUDIT_READ', 'CASE', 'AUDIT'],
    ['OPERATIONS_MANAGE', 'PROFILE', 'OPERATIONS'],
  ];
  for (const [action, kind, purpose] of entries) {
    evidence.resource!.root.kind = kind;
    evidence.grants = [{ action, rootKind: kind, purpose, scope: 'COMPANY' }];
    const port = createPartnerAuthorization(source, { actorId: 'internal-a', purpose, channel: 'API' });
    assert.equal((await port.authorize(action, evidence.resource!.root)).ok, true, action);
  }
});

test('HR, CRM, responder, Accounting and Logistics permissions are confined to their named purpose and relationship', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'internal-a', active: true, role: 'USER', departmentId: 'sales-a' };
  const entries: Array<[PartnerAction, PermissionContext['root']['kind'], PermissionContext['purpose'], PermissionContext['scope']]> = [
    ['PROFILE_READ', 'PROFILE', 'ONBOARDING', 'DEPARTMENT'], ['IDENTITY_VERIFY', 'PROFILE', 'ONBOARDING', 'DEPARTMENT'],
    ['CUSTOMER_READ', 'CUSTOMER', 'CRM', 'DEPARTMENT'], ['CUSTOMER_TRANSFER_DECIDE', 'CUSTOMER', 'CRM', 'COMPANY'],
    ['INQUIRY_READ', 'INQUIRY', 'RESPONDER', 'ASSIGNED'], ['INQUIRY_RESPOND', 'INQUIRY', 'RESPONDER', 'ASSIGNED'],
    ['ACCOUNTING_READ', 'CASE', 'ACCOUNTING', 'PURPOSE_BOUND'], ['ACCOUNTING_WRITE', 'CASE', 'ACCOUNTING', 'PURPOSE_BOUND'],
    ['FULFILLMENT_READ', 'CASE', 'FULFILLMENT', 'PURPOSE_BOUND'], ['FULFILLMENT_WRITE', 'CASE', 'FULFILLMENT', 'PURPOSE_BOUND'],
  ];
  for (const [action, kind, purpose, scope] of entries) {
    evidence.resource!.root.kind = kind;
    evidence.resource!.assignment = { actorId: 'internal-a', eligible: true, assignmentId: 'assignment-a', revision: 2 };
    evidence.grants = [{ action, rootKind: kind, purpose, scope, boundRootId: 'case-a' }];
    const port = createPartnerAuthorization(source, { actorId: 'internal-a', purpose, channel: 'API' });
    assert.equal((await port.authorize(action, evidence.resource!.root)).ok, true, action);
    const privatePurpose = createPartnerAuthorization(source, { actorId: 'internal-a', purpose: 'MANAGEMENT', channel: 'API' });
    assert.equal((await privatePurpose.authorize('CASE_READ', { kind: 'CASE', id: 'case-a' })).ok, false, action);
    if (scope === 'PURPOSE_BOUND') {
      evidence.grants[0].boundRootId = 'unrelated-case';
      assert.equal((await port.authorize(action, evidence.resource!.root)).ok, false, 'queue purpose must bind exact root');
    }
    if (scope === 'ASSIGNED') {
      evidence.resource!.assignment!.actorId = 'new-responder';
      assert.equal((await port.authorize(action, evidence.resource!.root)).ok, false, 'reassignment revokes old access');
    }
  }
});

test('ADMIN retains company management but cannot bypass any of the four Partner domain exceptions', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'admin-a', active: true, role: 'ADMIN' };
  const authorize = (action: PartnerAction, purpose: PermissionContext['purpose']) =>
    createPartnerAuthorization(source, { actorId: 'admin-a', purpose, channel: 'API' }).authorize(action, evidence.resource!.root);
  assert.equal((await authorize('CASE_CANCEL', 'MANAGEMENT')).ok, true);
  for (const action of ['CASE_DRAFT_WRITE', 'CASE_SUBMIT', 'RETAIL_COLLECTION_WRITE', 'RETAIL_CORRECTION_SAVE', 'CORRECTION_REQUEST', 'VOID_REQUEST'] as const) {
    assert.equal((await authorize(action, 'PARTNER')).ok, false, action);
  }
  evidence.resource!.root.kind = 'INQUIRY';
  assert.equal((await authorize('INQUIRY_RESPOND', 'RESPONDER')).ok, false);
  evidence.resource!.assignment = { actorId: 'admin-a', eligible: true, assignmentId: 'assigned', revision: 1 };
  assert.equal((await authorize('INQUIRY_RESPOND', 'RESPONDER')).ok, true);
  evidence.resource!.assignment.actorId = 'responder-b';
  assert.equal((await authorize('INQUIRY_RESPOND', 'RESPONDER')).ok, false);
  evidence.resource!.root.kind = 'CASE';
  evidence.resource!.requesterId = 'admin-a';
  for (const action of ['FINANCIAL_PROCESS', 'FINANCIAL_APPROVE'] as const) {
    assert.equal((await authorize(action, 'ACCOUNTING')).ok, false);
    evidence.resource!.requesterId = 'requester-b';
    assert.equal((await authorize(action, 'ACCOUNTING')).ok, true);
    evidence.resource!.requesterId = 'admin-a';
  }
  assert.equal((await authorize('VOID_REMEDIATION_REQUEST', 'MANAGEMENT')).ok, false);
  evidence.resource!.partnerStatus = 'SUSPENDED';
  assert.equal((await authorize('VOID_REMEDIATION_REQUEST', 'MANAGEMENT')).ok, true);
  assert.equal((await authorize('CORRECTION_REQUEST', 'ACCOUNTING')).ok, false, 'ordinary Accounting correction is not Partner initiation');
});

test('internal grants are explicit, purpose-scoped and current; Customer scope never exposes Case economics', async () => {
  const { evidence, source } = fixture();
  evidence.actor = { id: 'manager-a', active: true, role: 'MANAGER', departmentId: 'sales-a' };
  const port = createPartnerAuthorization(source, { actorId: 'manager-a', purpose: 'MANAGEMENT', channel: 'DETAIL' });
  const root = { kind: 'CASE' as const, id: 'case-a' };
  assert.equal((await port.authorize('CASE_READ', root)).ok, false, 'manager title is not a grant');
  evidence.grants = [{ action: 'CUSTOMER_READ', rootKind: 'CUSTOMER', purpose: 'CRM', scope: 'COMPANY' }];
  assert.equal((await port.authorize('CASE_READ', root)).ok, false, 'CRM does not reveal Case');
  evidence.grants = [{ action: 'CASE_READ', rootKind: 'CASE', purpose: 'MANAGEMENT', scope: 'DEPARTMENT' }];
  assert.equal((await port.authorize('CASE_READ', root)).ok, true);
  const write = await port.authorize('CASE_CANCEL', root);
  assert.equal(write.ok ? null : write.error.status, 403, 'visible but not granted');
  evidence.actor.departmentId = undefined;
  assert.equal((await port.authorize('CASE_READ', root)).ok, false, 'missing department fails closed');
  evidence.grants[0].scope = 'COMPANY';
  assert.equal((await port.authorize('CASE_READ', root)).ok, true);
  evidence.grants[0].expiresAt = evidence.evaluatedAt;
  assert.equal((await port.authorize('CASE_READ', root)).ok, false, 'exact expiry is denied');
  evidence.grants = [];
  assert.equal((await port.authorize('CASE_READ', root)).ok, false, 'revocation defeats old UI');
});

test('fixed Partner capabilities ignore internal grants and preserve pending/suspended/terminated boundaries', async () => {
  const { evidence, source } = fixture();
  const cases: Array<[PartnerAction, PermissionContext['root']['kind'], PermissionContext['purpose']]> = [
    ['PROFILE_READ', 'PROFILE', 'ONBOARDING'], ['CUSTOMER_READ', 'CUSTOMER', 'CRM'],
    ['CUSTOMER_WRITE', 'CUSTOMER', 'CRM'], ['INQUIRY_READ', 'INQUIRY', 'PARTNER'],
    ['INQUIRY_WRITE', 'INQUIRY', 'PARTNER'], ['CASE_READ', 'CASE', 'PARTNER'],
    ['CASE_DRAFT_WRITE', 'CASE', 'PARTNER'], ['CASE_SUBMIT', 'CASE', 'PARTNER'],
    ['CASE_COMMIT', 'CASE', 'PARTNER'],
    ['CASE_CANCEL', 'CASE', 'PARTNER'], ['CUSTOMER_OUTPUT', 'CASE', 'CUSTOMER_OUTPUT'],
    ['RETAIL_COLLECTION_WRITE', 'CASE', 'PARTNER'], ['CORRECTION_REQUEST', 'CASE', 'PARTNER'],
    ['RETAIL_CORRECTION_SAVE', 'CASE', 'PARTNER'], ['VOID_REQUEST', 'CASE', 'PARTNER'],
    ['ACCOUNTING_READ', 'PROFILE', 'PARTNER'], ['FULFILLMENT_READ', 'CASE', 'PARTNER'],
    ['REPORT_READ', 'PROFILE', 'PARTNER'],
  ];
  for (const [action, kind, purpose] of cases) {
    evidence.resource!.root.kind = kind;
    const port = createPartnerAuthorization(source, { actorId: 'partner-a', purpose, channel: 'API' });
    assert.equal((await port.authorize(action, { kind, id: 'case-a' })).ok, true, action);
  }
  evidence.resource!.root.kind = 'CASE';
  evidence.actor.role = 'ADMIN'; // Incompatible stray authority never expands a Partner persona.
  evidence.grants.push({ action: 'ACCOUNTING_WRITE', rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY' });
  const internal = createPartnerAuthorization(source, { actorId: 'partner-a', purpose: 'ACCOUNTING', channel: 'API' });
  assert.equal((await internal.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: 'case-a' })).ok, false);
  const port = createPartnerAuthorization(source, { actorId: 'partner-a', purpose: 'PARTNER', channel: 'API' });
  for (const state of ['PENDING', 'SUSPENDED', 'TERMINATED'] as const) {
    evidence.actor.partnerProfile!.state = evidence.resource!.partnerStatus = state;
    const read = await port.authorize('CASE_READ', { kind: 'CASE', id: 'case-a' });
    assert.equal(read.ok, state === 'SUSPENDED', state);
    const write = await port.authorize('CASE_DRAFT_WRITE', { kind: 'CASE', id: 'case-a' });
    assert.equal(write.ok, false, state);
    assert.equal(write.ok ? null : write.error.status, state === 'TERMINATED' || state === 'PENDING' ? 404 : 409);
  }
});
