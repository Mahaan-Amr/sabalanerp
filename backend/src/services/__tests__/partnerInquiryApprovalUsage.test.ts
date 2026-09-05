import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { ApprovedInquirySchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { bindApprovalUsage } from '../partnerSales/inquiries/approvalUsage';

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
    caseId: 'case-usage-replay', caseRevision: 3, productRowId: 'case-row-usage-replay' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.replayed, true);
    assert.deepEqual(result.value.approval, approval);
  }
  assert.equal(currentApprovalReads, 0, 'historical replay must not depend on current approval validity');
});

