import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contract from '../../../../packages/partner-sales-contracts';
import { checkOperationsGate, initialOperationsState, operationForCommand } from '../partnerSales/operations/policy';
import type { PermissionContext } from '../../../../packages/partner-sales-contracts';
import { assessReadiness, readinessGates, acceptanceResponsibilities } from '../partnerSales/operations/readiness';

const permission: PermissionContext = {
  actorId: 'partner-333', persona: 'PARTNER', isAdmin: false, partnerSellerId: 'partner-333',
  partnerStatus: 'ACTIVE', root: { kind: 'CASE', id: 'case-333' }, purpose: 'PARTNER', channel: 'API',
  scope: 'OWN', resourceVisible: true, actionGranted: true, authorizationRevision: 1,
  lifecycleRevision: 1, evaluatedAt: '2026-08-27T08:00:00.000Z',
};

test('emergency pause freezes Draft edit and commitment but preserves authorized reads', () => {
  const state = { ...initialOperationsState(), operationalPaused: true };
  for (const operation of ['CASE_DRAFT_WRITE', 'CASE_COMMIT'] as const) {
    assert.equal(checkOperationsGate(contract, state, { operation, permission, caseState: 'DRAFT' })?.code, 'OPERATIONAL_PAUSE');
  }
  assert.equal(checkOperationsGate(contract, state, { operation: 'CASE_READ', permission, caseState: 'DRAFT' }), null);
});

test('activation requires current real evidence for every gate, named membership and both open pauses', () => {
  const evidence = {
    source: 'DATABASE_VERIFIED' as const, releaseId: 'release-333', schemaId: 'schema-333',
    checkedAt: '2026-08-27T07:59:00.000Z', expiresAt: '2026-08-27T08:10:00.000Z',
    evidenceId: 'evidence-333', gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
    acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, 'approval-333'])),
  };
  const current = { now: permission.evaluatedAt, releaseId: 'release-333', schemaId: 'schema-333' };
  assert.equal(assessReadiness(contract, evidence, current), true);
  assert.equal(assessReadiness(contract, { ...evidence, source: 'FIXTURE' }, current), false);
  assert.equal(assessReadiness(contract, evidence, { ...current, now: evidence.expiresAt }), false);
  assert.equal(assessReadiness(contract, evidence, { ...current, releaseId: 'different-release' }), false);
  for (const gate of readinessGates) assert.equal(assessReadiness(contract, { ...evidence, gates: { ...evidence.gates, [gate]: false } }, current), false, gate);
  for (const role of acceptanceResponsibilities) assert.equal(assessReadiness(contract, { ...evidence, acceptedBy: { ...evidence.acceptedBy, [role]: '' } }, current), false, role);
  const state = { ...initialOperationsState(), enrollmentPaused: false, operationalPaused: false, cohort: { id: 'cohort-333', name: 'همکاران تأییدشده', sellerIds: [permission.partnerSellerId] } };
  const input = { operation: 'PROFILE_ACTIVATE' as const, permission, readiness: { evidence, current } };
  assert.equal(checkOperationsGate(contract, state, input), null);
  assert.equal(checkOperationsGate(contract, { ...state, enrollmentPaused: true }, input)?.code, 'COHORT_NOT_READY');
  assert.equal(checkOperationsGate(contract, { ...state, operationalPaused: true }, input)?.code, 'OPERATIONAL_PAUSE');
  assert.equal(checkOperationsGate(contract, state, { ...input, operation: 'CASE_COMMIT', readiness: undefined })?.code, 'COHORT_NOT_READY');
});

test('every action port is classified; new enrollment is separate from active cohort work', () => {
  const state = { ...initialOperationsState(), operationalPaused: false, cohort: { id: 'cohort-333', name: 'همکاران تأییدشده', sellerIds: [permission.partnerSellerId] } };
  assert.equal(checkOperationsGate(contract, state, { operation: 'CASE_DRAFT_WRITE', permission }), null);
  assert.equal(checkOperationsGate(contract, state, { operation: 'COHORT_ENROLL', permission })?.code, 'COHORT_NOT_READY');
  assert.equal(checkOperationsGate(contract, state, { operation: 'PROFILE_ACTIVATE', permission })?.code, 'COHORT_NOT_READY');
  assert.equal(checkOperationsGate(contract, { ...state, cohort: null }, { operation: 'CASE_DRAFT_WRITE', permission: { ...permission, isAdmin: true } })?.code, 'COHORT_NOT_READY');
  const readActions = new Set(['PROFILE_READ', 'CUSTOMER_READ', 'INQUIRY_READ', 'CASE_READ', 'CUSTOMER_OUTPUT', 'ACCOUNTING_READ', 'FULFILLMENT_READ', 'REPORT_READ', 'AUDIT_READ']);
  for (const operation of contract.PartnerActionSchema.options) {
    const internal: PermissionContext = { ...permission, persona: 'INTERNAL', actorId: 'staff-333', scope: 'COMPANY', purpose: 'OPERATIONS', requesterId: 'other-333', assignment: { actorId: 'staff-333', eligible: true, assignmentId: 'assignment-333', revision: 1 } };
    const result = checkOperationsGate(contract, initialOperationsState(), { operation, permission: internal, caseState: 'DRAFT' });
    if (readActions.has(operation) || ['OPERATIONS_MANAGE', 'INTERNAL_REMEDIATION'].includes(operation)) assert.equal(result, null, operation);
    else assert.notEqual(result, null, operation);
  }
  // These mutation ports are not distinct PartnerActions in the v1 foundation.
  for (const operation of ['CUSTOMER_CONFIRMATION_SEND', 'CUSTOMER_OTP_VERIFY', 'RECOVERY_WRITE', 'SHARED_CORRECTION_SAVE'] as const) {
    assert.equal(checkOperationsGate(contract, initialOperationsState(), { operation, permission })?.code, 'OPERATIONAL_PAUSE');
  }
  assert.equal(operationForCommand({ type: 'PROFILE_TRANSITION', to: 'ACTIVE' } as contract.PartnerCommand), 'PROFILE_ACTIVATE');
  assert.equal(operationForCommand({ type: 'CASE_DRAFT_REVISE' } as contract.PartnerCommand), 'CASE_DRAFT_WRITE');
});

test('pause preserves support cancellation, internal remediation and healthy committed obligations', () => {
  const state = initialOperationsState();
  const internal: PermissionContext = { ...permission, actorId: 'operator-333', persona: 'INTERNAL', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND' };
  for (const operation of ['CASE_CANCEL', 'INTERNAL_REMEDIATION', 'ACCOUNTING_WRITE', 'FULFILLMENT_WRITE'] as const) {
    const context = operation === 'CASE_CANCEL' ? { ...internal, purpose: 'MANAGEMENT' as const } : internal;
    assert.equal(checkOperationsGate(contract, state, { operation, permission: context, caseState: operation === 'CASE_CANCEL' ? 'DRAFT' : 'COMMITTED', integrityVerified: true }), null);
  }
  assert.equal(checkOperationsGate(contract, state, { operation: 'ACCOUNTING_WRITE', permission: internal, caseState: 'COMMITTED', integrityVerified: false })?.code, 'INTEGRITY_CONFLICT');
  assert.equal(checkOperationsGate(contract, state, { operation: 'CASE_CANCEL', permission, caseState: 'DRAFT' })?.code, 'OPERATIONAL_PAUSE');
});

test('all command ports remain closed during emergency pause, including confirmation and correction successors', () => {
  const commands = ['CASE_SUBMIT', 'CASE_DRAFT_REVISE', 'CASE_COMMIT', 'CASE_CANCEL', 'CUSTOMER_CONFIRMATION_SEND',
    'INQUIRY_SUBMIT', 'INQUIRY_DECIDE', 'INQUIRY_CANCEL', 'INQUIRY_REASSIGN', 'CORRECTION_REQUEST',
    'RETAIL_CORRECTION_SAVE', 'SHARED_CORRECTION_SAVE', 'RETAIL_RECEIPT', 'RETAIL_RECEIPT_REVERSE', 'CUSTOMER_TRANSFER_DECIDE'];
  for (const type of commands) {
    const operation = operationForCommand({ type } as contract.PartnerCommand);
    const result = checkOperationsGate(contract, initialOperationsState(), { operation, permission });
    assert.notEqual(result, null, type);
  }
  for (const gate of ['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY', 'CUSTOMER_CONFIRM']) {
    const operation = operationForCommand({ type: 'CORRECTION_GATE', gate } as contract.PartnerCommand);
    assert.notEqual(checkOperationsGate(contract, initialOperationsState(), { operation, permission }), null, gate);
  }
});

test('inactive Partner mutations and malformed durable control state fail closed', () => {
  const state = { ...initialOperationsState(), operationalPaused: false, cohort: { id: 'cohort-333', name: 'همکاران', sellerIds: [permission.partnerSellerId] } };
  assert.equal(checkOperationsGate(contract, state, { operation: 'CUSTOMER_WRITE', permission: { ...permission, partnerStatus: 'SUSPENDED' } })?.code, 'PARTNER_NOT_ACTIVE');
  assert.equal(checkOperationsGate(contract, { ...state, operationalPaused: undefined } as any, { operation: 'CASE_DRAFT_WRITE', permission })?.code, 'INTEGRITY_CONFLICT');
});

test('internal identity onboarding and security lifecycle actions do not require prior cohort membership', () => {
  const identity: PermissionContext = { ...permission, persona: 'INTERNAL', actorId: 'hr-333', purpose: 'ONBOARDING', scope: 'COMPANY', partnerStatus: 'PENDING' };
  for (const operation of ['PROFILE_CREATE', 'IDENTITY_VERIFY', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'] as const) {
    assert.equal(checkOperationsGate(contract, initialOperationsState(), { operation, permission: identity }), null, operation);
  }
  assert.notEqual(checkOperationsGate(contract, initialOperationsState(), { operation: 'PROFILE_ACTIVATE', permission: identity }), null);
});
