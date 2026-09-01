import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerCommandSchema, PartnerManagementCommandV2Schema } from '@sabalanerp/partner-sales-contracts';

test('management commands bind opaque producer evidence and optimistic revision without caller-authored gates', () => {
  const envelope = (type: string, targetId = 'profile-1') => ({ schemaVersion: 2, type,
    commandId: 'command-1', correlationId: 'correlation-1', reason: 'ثبت تصمیم مجاز',
    idempotency: { actorId: 'manager-1', operation: type, targetId, key: 'request-1', payloadHash: 'sha256-v1:' + 'a'.repeat(64) } });
  const create = { ...envelope('PROFILE_CREATE', 'identity-evidence-1'), identityEvidenceId: 'identity-evidence-1' };
  assert.equal(PartnerManagementCommandV2Schema.safeParse(create).success, true);
  assert.equal(PartnerCommandSchema.safeParse(create).success, false);
  const terms = { ...envelope('COMMERCIAL_TERMS_SET'), profileId: 'profile-1', expectedRevision: 1, termsVersionId: 'terms-v2' };
  assert.equal(PartnerManagementCommandV2Schema.safeParse(terms).success, true);
  assert.equal(PartnerManagementCommandV2Schema.safeParse({ ...terms, commercialTermsReady: true }).success, false);
  assert.equal(PartnerManagementCommandV2Schema.safeParse({ ...terms, profileId: 'other-profile' }).success, false);
  const verification = { ...envelope('IDENTITY_VERIFY'), profileId: 'profile-1', expectedRevision: 1, evidenceId: 'identity-evidence-1' };
  assert.equal(PartnerManagementCommandV2Schema.safeParse(verification).success, true);
  const conversion = { ...envelope('PROFILE_CONVERSION'), profileId: 'profile-1', expectedRevision: 1,
    transition: 'RESOLVE', dispositionEvidenceIds: ['disposition-1'] };
  assert.equal(PartnerManagementCommandV2Schema.safeParse(conversion).success, true);
  assert.equal(PartnerManagementCommandV2Schema.safeParse({ ...conversion, dispositionEvidenceIds: [] }).success, false);
  assert.equal(PartnerManagementCommandV2Schema.safeParse({ ...conversion, irreversible: false }).success, false);
});
