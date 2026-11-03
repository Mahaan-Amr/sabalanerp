import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkApprovalUse, ApprovedInquirySchema } from '../src';

const hash = 'sha256-v1:' + 'a'.repeat(64);
const approval = {
  schemaVersion: 1, approvalId: 'approval-313', inquiryId: 'inquiry-313', rowId: 'inquiry-row-313', revision: 1,
  partnerSellerId: 'partner-313', configurationHash: hash, evidenceHash: hash,
  wholesaleUnitPrice: { amount: '800', currency: 'IRR' },
  approvedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-29T08:00:00.000Z',
  decision: { actorId: 'responder-313', assignmentId: 'assignment-313', assignmentRevision: 1, authorizationEvidenceId: 'auth-313', commandId: 'command-313' },
};
test('approval is reusable until exactly 48 hours and cannot cross Partner or configuration', () => {
  const parsed = ApprovedInquirySchema.parse(approval);
  const use = { partnerSellerId: 'partner-313', configurationHash: hash, superseded: false, terminated: false };
  assert.equal(checkApprovalUse(parsed, use, '2026-08-29T07:59:59.999Z'), null);
  assert.equal(checkApprovalUse(parsed, use, '2026-08-29T07:59:59.999Z'), null);
  assert.equal(checkApprovalUse(parsed, use, parsed.expiresAt)?.code, 'APPROVAL_EXPIRED');
  assert.equal(checkApprovalUse(parsed, { ...use, partnerSellerId: 'other' }, parsed.approvedAt)?.status, 404);
  assert.equal(checkApprovalUse(parsed, { ...use, configurationHash: 'sha256-v1:' + 'b'.repeat(64) }, parsed.approvedAt)?.code, 'CONFIG_MISMATCH');
  assert.equal(ApprovedInquirySchema.safeParse({ ...approval, expiresAt: '2026-08-30T08:00:00.000Z' }).success, false);
});
