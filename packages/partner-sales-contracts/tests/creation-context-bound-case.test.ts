import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PartnerCreationContextSchema } from '../src/runtime';

test('recoverable Partner drafts may disclose their owned editable Case binding', () => {
  const parsed = PartnerCreationContextSchema.safeParse({
    schemaVersion: 1,
    kind: 'PARTNER',
    actorId: 'partner-user-1',
    profileId: 'partner-profile-1',
    writable: true,
    inquiryIds: [],
    recoverableDraft: {
      recoveryId: 'partner-recovery-1',
      caseId: 'partner-case-1',
      baseRevision: 0,
      updatedAt: '2026-09-21T09:25:21.362Z',
    },
    recoverableDrafts: [{
      recoveryId: 'partner-recovery-1',
      caseId: 'partner-case-1',
      baseRevision: 0,
      updatedAt: '2026-09-21T09:25:21.362Z',
    }],
    customers: [],
    projects: [],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success || parsed.data.kind !== 'PARTNER') return;
  assert.equal(parsed.data.recoverableDraft?.caseId, 'partner-case-1');
  assert.equal(parsed.data.recoverableDrafts?.[0]?.caseId, 'partner-case-1');
});
