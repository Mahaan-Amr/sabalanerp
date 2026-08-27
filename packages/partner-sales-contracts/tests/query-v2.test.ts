import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerCommandSchema, PartnerManagementCommandV2Schema, PartnerQuerySchema, PartnerQueryV2Schema,
  partnerError, type PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { createPartnerWorkspaceFixturesV2, FixturePartnerQueryV2Adapter } from '@sabalanerp/partner-sales-contracts/testing';

test('v2 public fixture queries round-trip evidence selections and never broaden an unavailable purpose', async () => {
  const fixture = createPartnerWorkspaceFixturesV2();
  const adapter: PartnerQueryV2Port = new FixturePartnerQueryV2Adapter(['PARTNER_MANAGEMENT', 'PARTNER_INQUIRY']);
  const query = { schemaVersion: 2 as const, purpose: 'PARTNER_MANAGEMENT' as const };
  assert.equal(PartnerQueryV2Schema.safeParse(query).success, true);
  assert.equal(PartnerQuerySchema.safeParse(query).success, false);
  const result = await adapter.query(query);
  if (!result.ok) assert.fail('Management fixture must be available');
  const candidate = result.value.identityCandidates?.[0];
  assert.ok(candidate);
  const envelope = (type: string, targetId: string) => ({ schemaVersion: 2, commandId: 'roundtrip-command', correlationId: 'roundtrip-correlation',
    reason: 'ثبت تصمیم آزمایشی', idempotency: { actorId: result.value.actorId, operation: type, targetId,
      key: 'roundtrip-key', payloadHash: 'sha256-v1:' + 'c'.repeat(64) } });
  assert.equal(PartnerManagementCommandV2Schema.safeParse({ ...envelope('PROFILE_CREATE', candidate.identityEvidenceId),
    type: 'PROFILE_CREATE', identityEvidenceId: candidate.identityEvidenceId }).success, true);
  const profile = result.value.profiles[0];
  const pending = profile.responder?.pendingInquiries[0];
  assert.ok(pending);
  assert.equal(PartnerCommandSchema.safeParse({ ...envelope('INQUIRY_REASSIGN', pending.inquiryId), schemaVersion: 1,
    type: 'INQUIRY_REASSIGN', inquiryId: pending.inquiryId, expectedAssignmentRevision: pending.assignmentRevision,
    responderId: profile.responder!.eligibleOptions[0].id }).success, true);
  assert.equal(profile.profile.cohortReady, false);
  profile.profile.cohortReady = true;
  const again = await adapter.query(query);
  if (!again.ok) assert.fail('Fixture stays available');
  assert.equal(again.value.profiles[0].profile.cohortReady, false);
  assert.deepEqual(await adapter.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' }), { ok: false, error: partnerError('NOT_FOUND') });
  assert.deepEqual(await adapter.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: 'other-owner' }), { ok: false, error: partnerError('NOT_FOUND') });
  const inquiry = await adapter.query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: fixture.inquiry.inquiryId });
  assert.equal(inquiry.ok, true);
});
