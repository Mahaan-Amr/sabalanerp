import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { ApprovedInquirySchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { bindApprovalUsage, resolveApprovalForUse } from '../partnerSales/inquiries/approvalUsage';

const approval = ApprovedInquirySchema.parse({
  schemaVersion: 1,
  approvalId: 'approval-usage-replay',
  inquiryId: 'inquiry-usage-replay',
  rowId: 'inquiry-row-usage-replay',
  revision: 2,
  partnerSellerId: 'partner-usage-replay',
  configurationHash: `sha256-v1:${'1'.repeat(64)}`,
  evidenceHash: `sha256-v1:${'2'.repeat(64)}`,
  wholesaleUnitPrice: { amount: '1250000', currency: 'IRT' },
  approvedAt: '2026-08-20T10:00:00.000Z',
  expiresAt: '2026-08-22T10:00:00.000Z',
  decision: { actorId: 'responder-usage-replay', assignmentId: 'assignment-usage-replay',
    assignmentRevision: 1, authorizationEvidenceId: 'authorization-usage-replay', commandId: 'command-usage-replay' },
});

test('an exact usage retry returns its immutable snapshot without revalidating an expired approval', async () => {
  const evidenceHash = await canonicalHash({ schemaVersion: 1, caseId: 'case-usage-replay', caseRevision: 3,
    productRowId: 'case-row-usage-replay', approval });
  let currentApprovalReads = 0;
  const tx = {
    partnerCaseRowBinding: { findUnique: async () => ({ configurationHash: approval.configurationHash }) },
    partnerInquiryUsage: { findUnique: async () => ({ id: 'usage-replay', approvalId: approval.approvalId,
      approvalSnapshot: approval, evidenceHash, usedAt: new Date('2026-08-20T11:00:00.000Z') }) },
    partnerInquiryRow: { findFirst: async () => { currentApprovalReads += 1; return null; } },
    $queryRaw: async () => { currentApprovalReads += 1; return [{ now: new Date('2026-08-29T10:00:00.000Z') }]; },
  } as unknown as Prisma.TransactionClient;
  const result = await bindApprovalUsage(tx, { binding: { inquiryId: approval.inquiryId, rowId: approval.rowId,
    revision: approval.revision }, partnerSellerId: approval.partnerSellerId, configurationHash: approval.configurationHash,
    caseId: 'case-usage-replay', pricingCaseRevision: 2, caseRevision: 3,
    productRowId: 'case-row-usage-replay' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.replayed, true);
    assert.deepEqual(result.value.approval, approval);
  }
  assert.equal(currentApprovalReads, 0, 'historical replay must not depend on current approval validity');
});

test('fresh approval use is bound to the pricing source revision, not the successor revision', async () => {
  const tx = {
    $queryRaw: async () => [{ now: new Date('2026-08-21T10:00:00.000Z') }],
    partnerInquiryRow: { findFirst: async () => ({ id: approval.rowId, revision: approval.revision,
      configurationHash: approval.configurationHash, predecessorId: null, predecessor: null, successor: null,
      inquiry: { id: approval.inquiryId, caseId: 'case-usage-replay', caseRevision: 2,
        pricingReadyAt: new Date(approval.approvedAt), pricingExpiresAt: new Date(approval.expiresAt),
        profile: { state: 'ACTIVE', userId: approval.partnerSellerId } },
      approval: { id: approval.approvalId, actorId: approval.decision.actorId,
        assignmentId: approval.decision.assignmentId, commandId: approval.decision.commandId,
        authorizationEvidenceId: approval.decision.authorizationEvidenceId,
        wholesaleUnitPrice: { toString: () => approval.wholesaleUnitPrice.amount },
        currency: approval.wholesaleUnitPrice.currency, evidenceHash: approval.evidenceHash,
        note: null, supersessionReason: null, approvedAt: new Date(approval.approvedAt),
        expiresAt: new Date(approval.expiresAt), assignment: { revision: approval.decision.assignmentRevision } } }) },
  } as unknown as Prisma.TransactionClient;
  const usable = await resolveApprovalForUse(tx, { binding: { inquiryId: approval.inquiryId,
    rowId: approval.rowId, revision: approval.revision }, partnerSellerId: approval.partnerSellerId,
    configurationHash: approval.configurationHash, caseId: 'case-usage-replay', pricingCaseRevision: 2 });
  assert.equal(usable.ok, true);
  const wrongRevision = await resolveApprovalForUse(tx, { binding: { inquiryId: approval.inquiryId,
    rowId: approval.rowId, revision: approval.revision }, partnerSellerId: approval.partnerSellerId,
    configurationHash: approval.configurationHash, caseId: 'case-usage-replay', pricingCaseRevision: 3 });
  assert.equal(wrongRevision.ok ? null : wrongRevision.error.code, 'NOT_FOUND');
});

test('a successor to a rejected row uses its own approval clock and omits absent supersession evidence', async () => {
  const tx = {
    $queryRaw: async () => [{ now: new Date('2026-08-21T10:00:00.000Z') }],
    partnerInquiryRow: { findFirst: async () => ({ id: approval.rowId, revision: approval.revision,
      configurationHash: approval.configurationHash, predecessorId: 'rejected-row',
      predecessor: { approval: null }, successor: null,
      inquiry: { id: approval.inquiryId, caseId: 'case-usage-replay', caseRevision: 2,
        pricingReadyAt: null, pricingExpiresAt: null,
        profile: { state: 'ACTIVE', userId: approval.partnerSellerId } },
      approval: { id: approval.approvalId, actorId: approval.decision.actorId,
        assignmentId: approval.decision.assignmentId, commandId: approval.decision.commandId,
        authorizationEvidenceId: approval.decision.authorizationEvidenceId,
        wholesaleUnitPrice: { toString: () => approval.wholesaleUnitPrice.amount },
        currency: approval.wholesaleUnitPrice.currency, evidenceHash: approval.evidenceHash,
        note: null, supersessionReason: null, approvedAt: new Date(approval.approvedAt),
        expiresAt: new Date(approval.expiresAt), assignment: { revision: approval.decision.assignmentRevision } } }) },
  } as unknown as Prisma.TransactionClient;
  const result = await resolveApprovalForUse(tx, { binding: { inquiryId: approval.inquiryId,
    rowId: approval.rowId, revision: approval.revision }, partnerSellerId: approval.partnerSellerId,
    configurationHash: approval.configurationHash, caseId: 'case-usage-replay', pricingCaseRevision: 2 });
  assert.equal(result.ok, true, result.ok ? undefined : result.error.code);
  if (result.ok) {
    assert.equal(result.value.approvedAt, approval.approvedAt);
    assert.equal(result.value.expiresAt, approval.expiresAt);
    assert.equal(result.value.predecessorApprovalId, undefined);
    assert.equal(result.value.supersessionReason, undefined);
  }
});
