import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkPartnerDomainRestrictions, publicError, partnerError, PermissionContextSchema } from '../src';

test('central authorization receives all four non-bypassable Partner restrictions', () => {
  const context = PermissionContextSchema.parse({
    actorId: 'admin', persona: 'INTERNAL', isAdmin: true, partnerSellerId: 'partner',
    partnerStatus: 'ACTIVE', root: { kind: 'CASE', id: 'case' }, purpose: 'MANAGEMENT', channel: 'API',
    scope: 'COMPANY', resourceVisible: true, actionGranted: true,
    authorizationRevision: 1, lifecycleRevision: 1, evaluatedAt: '2026-08-27T08:00:00.000Z',
  });
  assert.equal(checkPartnerDomainRestrictions('INQUIRY_RESPOND', context)?.code, 'NOT_ASSIGNED');
  assert.equal(checkPartnerDomainRestrictions('CASE_DRAFT_WRITE', context)?.code, 'FORBIDDEN');
  assert.equal(checkPartnerDomainRestrictions('FINANCIAL_PROCESS', { ...context, requesterId: 'admin' })?.code, 'FORBIDDEN');
  assert.equal(checkPartnerDomainRestrictions('FINANCIAL_APPROVE', { ...context, requesterId: 'admin' })?.code, 'FORBIDDEN');
  assert.equal(checkPartnerDomainRestrictions('CORRECTION_REQUEST', context)?.code, 'FORBIDDEN');
  assert.equal(checkPartnerDomainRestrictions('VOID_REMEDIATION_REQUEST', { ...context, partnerStatus: 'SUSPENDED' }), null);
  assert.equal(checkPartnerDomainRestrictions('INQUIRY_RESPOND', { ...context, assignment: { actorId: 'admin', eligible: true, assignmentId: 'assignment', revision: 1 } }), null);
  assert.deepEqual(publicError(partnerError('CUSTOMER_OUT_OF_SCOPE'), 'support-313'), publicError(partnerError('NOT_FOUND'), 'support-313'));
});

test('non-Admin actors retain the same exceptions and hidden/expired authority fails closed', () => {
  const context = PermissionContextSchema.parse({
    actorId: 'manager', persona: 'INTERNAL', isAdmin: false, partnerSellerId: 'partner', partnerStatus: 'ACTIVE',
    root: { kind: 'CASE', id: 'case' }, purpose: 'MANAGEMENT', channel: 'API', scope: 'DEPARTMENT', departmentId: 'sales',
    resourceVisible: true, actionGranted: true, authorizationRevision: 1, lifecycleRevision: 1, evaluatedAt: '2026-08-27T08:00:00.000Z',
  });
  for (const action of ['CASE_DRAFT_WRITE', 'CORRECTION_REQUEST', 'RETAIL_CORRECTION_SAVE', 'VOID_REQUEST'] as const) {
    assert.equal(checkPartnerDomainRestrictions(action, context)?.code, 'FORBIDDEN');
  }
  assert.equal(checkPartnerDomainRestrictions('INQUIRY_RESPOND', context)?.code, 'NOT_ASSIGNED');
  for (const action of ['FINANCIAL_PROCESS', 'FINANCIAL_APPROVE'] as const) {
    assert.equal(checkPartnerDomainRestrictions(action, { ...context, requesterId: 'manager' })?.code, 'FORBIDDEN');
  }
  assert.equal(checkPartnerDomainRestrictions('CASE_READ', { ...context, departmentId: undefined })?.code, 'NOT_FOUND');
  assert.equal(checkPartnerDomainRestrictions('CASE_READ', { ...context, resourceVisible: false })?.code, 'NOT_FOUND');
  assert.equal(checkPartnerDomainRestrictions('CASE_READ', { ...context, grantExpiresAt: context.evaluatedAt })?.code, 'FORBIDDEN');
  assert.equal(checkPartnerDomainRestrictions('CASE_DRAFT_WRITE', { ...context, actorId: 'partner', persona: 'PARTNER', scope: 'OWN' }), null);
  assert.equal(checkPartnerDomainRestrictions('CASE_DRAFT_WRITE', { ...context, actorId: 'partner', persona: 'PARTNER', scope: 'OWN', partnerStatus: 'SUSPENDED' })?.code, 'PARTNER_NOT_ACTIVE');
});
