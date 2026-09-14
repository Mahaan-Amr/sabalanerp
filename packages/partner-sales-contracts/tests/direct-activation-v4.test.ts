import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PartnerDirectActivationCommandV4Schema,
  PartnerDirectActivationRevertCommandV4Schema,
  PartnerDirectActivationRevertReceiptV4Schema,
  PartnerDirectActivationReceiptV4Schema,
  PartnerDirectActivationViewV4Schema,
} from '@sabalanerp/partner-sales-contracts';

const hash = `sha256-v1:${'a'.repeat(64)}`;

test('direct activation requires only the user, responder, current user revision and consequence confirmation', () => {
  const command = {
    schemaVersion: 4,
    type: 'PROFILE_DIRECT_ACTIVATE',
    commandId: 'activate-fariba',
    correlationId: 'activate-fariba-correlation',
    userId: 'fariba-user',
    responderId: 'sales-responder',
    expectedUserUpdatedAt: '2026-09-14T08:00:00.000Z',
    consequenceConfirmed: true,
    idempotency: {
      actorId: 'admin-user', operation: 'PROFILE_DIRECT_ACTIVATE', targetId: 'fariba-user',
      key: 'activate-fariba-key', payloadHash: hash,
    },
  };
  assert.equal(PartnerDirectActivationCommandV4Schema.safeParse(command).success, true);
  assert.equal(PartnerDirectActivationCommandV4Schema.safeParse({ ...command, consequenceConfirmed: false }).success, false);
  for (const legacyField of ['identityEvidenceId', 'commercialTermsPolicyId', 'creditTermsPolicyId', 'cohortId', 'reason']) {
    assert.equal(PartnerDirectActivationCommandV4Schema.safeParse({ ...command, [legacyField]: 'legacy' }).success, false);
  }
});

test('direct activation view exposes an operational profile summary without onboarding gates', () => {
  const view = {
    schemaVersion: 4,
    purpose: 'PARTNER_DIRECT_ACTIVATION',
    actorId: 'admin-user',
    subject: {
      userId: 'fariba-user', displayName: 'فریبا پورشهید', active: true,
      role: 'SALES', userUpdatedAt: '2026-09-14T08:00:00.000Z',
      partnerState: 'NONE', canActivate: true,
      canRevert: false,
      customerCount: 0, inquiryCount: 0, caseCount: 0,
    },
    responders: [{ id: 'sales-responder', label: 'پاسخ‌دهنده فروش' }],
  };
  assert.equal(PartnerDirectActivationViewV4Schema.safeParse(view).success, true);
  for (const legacyField of ['release', 'cohort', 'identityEvidence', 'commercialTerms', 'creditTerms', 'gates']) {
    assert.equal(PartnerDirectActivationViewV4Schema.safeParse({ ...view, [legacyField]: [] }).success, false);
  }
});

test('direct activation can be reverted only through an explicit revision-bound command', () => {
  const command = {
    schemaVersion: 4, type: 'PROFILE_DIRECT_ACTIVATION_REVERT', commandId: 'revert-fariba',
    correlationId: 'revert-fariba-correlation', userId: 'fariba-user', profileId: 'fariba-profile',
    expectedProfileRevision: 3, consequenceConfirmed: true,
    idempotency: { actorId: 'admin-user', operation: 'PROFILE_DIRECT_ACTIVATION_REVERT',
      targetId: 'fariba-profile', key: 'revert-fariba-key', payloadHash: hash },
  };
  assert.equal(PartnerDirectActivationRevertCommandV4Schema.safeParse(command).success, true);
  assert.equal(PartnerDirectActivationRevertCommandV4Schema.safeParse({ ...command,
    expectedProfileRevision: 2, extraReason: 'not accepted' }).success, false);
  assert.equal(PartnerDirectActivationRevertReceiptV4Schema.safeParse({ schemaVersion: 4,
    commandId: command.commandId, replayed: false, userId: command.userId, profileId: command.profileId,
    profileRevision: 4, eventId: 'revert-event', restoredAccessCount: 2 }).success, true);
});

test('direct activation receipt preserves the automatic access and debtor-account evidence', () => {
  const receipt = {
    schemaVersion: 4, commandId: 'activate-fariba', replayed: false,
    userId: 'fariba-user', profileId: 'fariba-profile', profileRevision: 3,
    responderAssignmentId: 'assignment-1', commercialAccountId: 'account-1',
    eventIds: ['profile-event'], removedAccessCount: 4, preservedResponsibilityCount: 2,
  };
  assert.equal(PartnerDirectActivationReceiptV4Schema.safeParse(receipt).success, true);
});
