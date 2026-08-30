import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ActionAvailabilityV2Schema, PartnerManagementWorkspaceViewV2Schema,
  PartnerActionV2Schema, ResponderWorkspaceViewV2Schema, partnerError,
  type DuplicateCustomerMatch } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';

test('management gives authorized identity creation a safe evidence selection without raw writes or permission contexts', () => {
  const profile = createPartnerFixtures().profile;
  const input = { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: 'hr-actor', personaLabel: 'منابع انسانی',
    actions: [{ action: 'PROFILE_CREATE', enabled: true }],
    identityCandidates: [{ identityEvidenceId: 'identity-evidence-1', displayName: 'همکار آزمایشی' }],
    profiles: [{ profile, displayName: 'همکار آزمایشی', actions: [],
      identity: { evidenceId: 'identity-evidence-1', legalName: 'همکار آزمایشی', phone: '09120000000', address: 'تهران', personType: 'NATURAL' } }],
    transfers: [],
  };
  const view = PartnerManagementWorkspaceViewV2Schema.parse(input);
  assert.equal(view.identityCandidates?.[0].identityEvidenceId, 'identity-evidence-1');
  assert.equal(view.profiles[0].profile.cohortReady, false);
  assert.equal(PartnerManagementWorkspaceViewV2Schema.safeParse({ ...input, actions: [] }).success, false);
  assert.equal(PartnerManagementWorkspaceViewV2Schema.safeParse({ ...input, permissionContext: {} }).success, false);
  assert.equal(PartnerManagementWorkspaceViewV2Schema.safeParse({ ...input, profiles: [{ ...input.profiles[0], retailTotals: {} }] }).success, false);
  assert.equal(ActionAvailabilityV2Schema.safeParse({ action: 'PROFILE_ACTIVATE', enabled: false, disabledReason: partnerError('COHORT_NOT_READY') }).success, true);
  assert.equal(ActionAvailabilityV2Schema.safeParse({ action: 'PROFILE_ACTIVATE', enabled: true, disabledReason: partnerError('FORBIDDEN') }).success, false);
  assert.equal(ActionAvailabilityV2Schema.safeParse({ action: 'PROFILE_READ', enabled: false, disabledReason: partnerError('NOT_FOUND') }).success, false);
});

test('responder workspace preserves explicit outcomes and exact validity without retail economics', () => {
  const fixture = createPartnerFixtures();
  const inquiry = { ...fixture.responder, schemaVersion: 2, actions: [], rows: [{ ...fixture.responder.rows[0],
    state: 'APPROVED', approvedAt: fixture.approval.approvedAt, expiresAt: fixture.approval.expiresAt, actions: [],
  }] };
  const input = { schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', actorId: 'responder-actor', inquiries: [inquiry] };
  const view = ResponderWorkspaceViewV2Schema.parse(input);
  assert.equal(view.inquiries[0].rows[0].state, 'APPROVED');
  assert.equal(view.inquiries[0].rows[0].expiresAt, '2026-08-29T08:00:00.000Z');
  const row = inquiry.rows[0];
  const withRow = (replacement: unknown) => ({ ...input, inquiries: [{ ...inquiry, rows: [replacement] }] });
  const { state, ...missingState } = row;
  assert.equal(ResponderWorkspaceViewV2Schema.safeParse(withRow(missingState)).success, false);
  assert.equal(ResponderWorkspaceViewV2Schema.safeParse(withRow({ ...row, expiresAt: '2026-08-30T08:00:00.000Z' })).success, false);
  assert.equal(ResponderWorkspaceViewV2Schema.safeParse(withRow({ ...row, retailUnitPrice: '1000' })).success, false);
  assert.equal(ResponderWorkspaceViewV2Schema.safeParse(withRow({ ...row, state: 'PENDING', used: false, approvedPrice: undefined,
    approvedAt: undefined, expiresAt: undefined })).success, true);
});

test('management reassignment carries the pending inquiry assignment revision rather than a profile ID', () => {
  const input = { schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: 'manager-1', personaLabel: 'مدیریت فروش', actions: [],
    profiles: [{ profile: createPartnerFixtures().profile, displayName: 'همکار آزمایشی', actions: [], responder: {
      currentId: 'responder-1', displayName: 'پاسخ‌دهنده', eligibleOptions: [{ id: 'responder-2', label: 'پاسخ‌دهنده دوم' }],
      pendingInquiries: [{ inquiryId: 'inquiry-1', assignmentRevision: 3, label: 'استعلام در انتظار',
        actions: [{ action: 'RESPONDER_REASSIGN', enabled: true }] }],
    } }], transfers: [],
  };
  const view = PartnerManagementWorkspaceViewV2Schema.parse(input);
  assert.equal(view.profiles[0].responder?.pendingInquiries[0].inquiryId, 'inquiry-1');
  assert.equal(view.profiles[0].responder?.pendingInquiries[0].assignmentRevision, 3);
});

test('CRM v2 actions are additive and duplicate witnesses remain the narrow public type', () => {
  for (const action of ['CUSTOMER_LIST', 'CUSTOMER_CREATE', 'CUSTOMER_DUPLICATE_MATCH',
    'CUSTOMER_TRANSFER_REQUEST'] as const) assert.equal(PartnerActionV2Schema.parse(action), action);
  const witness: DuplicateCustomerMatch = { schemaVersion: 1, purpose: 'DUPLICATE_MATCH',
    matchReference: 'match-1', displayName: 'مشتری نمونه', personType: 'NATURAL', city: 'تهران',
    maskedWitness: '********1234' };
  assert.equal('customerId' in witness, false);
});
