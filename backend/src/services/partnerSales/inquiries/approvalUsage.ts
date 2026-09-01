import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ApprovedInquirySchema, canonicalHash, checkApprovalUse, partnerError,
  type ApprovedInquiry, type Result } from '@sabalanerp/partner-sales-contracts';

type Binding = { inquiryId: string; rowId: string; revision: number };
type UseInput = { binding: Binding; partnerSellerId: string; configurationHash: string };

/** Locks and reconstructs immutable approval evidence for a Case transaction.
 * The caller still owns Case/Customer authorization; this seam owns only the
 * inquiry root, exact row and current Partner-lifecycle validity. */
export async function resolveApprovalForUse(tx: Prisma.TransactionClient, input: UseInput): Promise<Result<ApprovedInquiry>> {
  await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${input.binding.inquiryId} FOR UPDATE`;
  const row = await tx.partnerInquiryRow.findFirst({ where: { id: input.binding.rowId, inquiryId: input.binding.inquiryId },
    select: { id: true, revision: true, configurationHash: true, predecessorId: true,
      predecessor: { select: { approval: { select: { id: true } } } },
      successor: { select: { outcome: true } },
      inquiry: { select: { id: true, profile: { select: { state: true, userId: true } } } },
      approval: { select: { id: true, actorId: true, assignmentId: true, commandId: true,
        authorizationEvidenceId: true, wholesaleUnitPrice: true, currency: true, evidenceHash: true,
        note: true, supersessionReason: true, approvedAt: true, expiresAt: true,
        assignment: { select: { revision: true } } } },
    } });
  if (!row?.approval || row.inquiry.profile.userId !== input.partnerSellerId) return { ok: false, error: partnerError('NOT_FOUND') };
  if (row.revision !== input.binding.revision) return { ok: false, error: partnerError('ROW_STALE') };
  const approval = ApprovedInquirySchema.safeParse({ schemaVersion: 1, approvalId: row.approval.id,
    inquiryId: row.inquiry.id, rowId: row.id, revision: row.revision, partnerSellerId: row.inquiry.profile.userId,
    configurationHash: row.configurationHash, evidenceHash: row.approval.evidenceHash,
    wholesaleUnitPrice: { amount: row.approval.wholesaleUnitPrice.toString(), currency: row.approval.currency },
    approvedAt: row.approval.approvedAt.toISOString(), expiresAt: row.approval.expiresAt.toISOString(),
    ...(row.approval.note ? { note: row.approval.note } : {}),
    ...(row.predecessorId ? { predecessorApprovalId: row.predecessor?.approval?.id,
      supersessionReason: row.approval.supersessionReason } : {}),
    decision: { actorId: row.approval.actorId, assignmentId: row.approval.assignmentId,
      assignmentRevision: row.approval.assignment.revision,
      authorizationEvidenceId: row.approval.authorizationEvidenceId, commandId: row.approval.commandId },
  });
  if (!approval.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const invalid = checkApprovalUse(approval.data, { partnerSellerId: input.partnerSellerId,
    configurationHash: input.configurationHash, superseded: row.successor?.outcome === 'APPROVED',
    terminated: row.inquiry.profile.state === 'TERMINATED' }, clock.now.toISOString());
  return invalid ? { ok: false, error: invalid } : { ok: true, value: approval.data };
}

/** Records immutable, reusable approval usage after the Case row binding exists.
 * No approval is consumed and no usage count limit is imposed. */
export async function bindApprovalUsage(tx: Prisma.TransactionClient, input: UseInput & {
  usageId?: string; caseId: string; caseRevision: number; productRowId: string;
}): Promise<Result<{ usageId: string; approval: ApprovedInquiry; usedAt: string; replayed: boolean }>> {
  const binding = await tx.partnerCaseRowBinding.findUnique({ where: { caseId_revision_productRowId: {
    caseId: input.caseId, revision: input.caseRevision, productRowId: input.productRowId,
  } }, select: { configurationHash: true } });
  if (!binding || binding.configurationHash !== input.configurationHash) return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  const previous = await tx.partnerInquiryUsage.findUnique({ where: { caseId_caseRevision_productRowId: {
    caseId: input.caseId, caseRevision: input.caseRevision, productRowId: input.productRowId,
  } } });
  if (previous) {
    const snapshot = ApprovedInquirySchema.safeParse(previous.approvalSnapshot);
    if (!snapshot.success || snapshot.data.inquiryId !== input.binding.inquiryId ||
        snapshot.data.rowId !== input.binding.rowId || snapshot.data.revision !== input.binding.revision ||
        snapshot.data.partnerSellerId !== input.partnerSellerId || snapshot.data.configurationHash !== input.configurationHash) {
      return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    }
    const replayHash = await canonicalHash({ schemaVersion: 1, caseId: input.caseId, caseRevision: input.caseRevision,
      productRowId: input.productRowId, approval: snapshot.data });
    if (previous.approvalId !== snapshot.data.approvalId || previous.evidenceHash !== replayHash) {
      return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    }
    return { ok: true, value: { usageId: previous.id, approval: snapshot.data,
      usedAt: previous.usedAt.toISOString(), replayed: true } };
  }
  const approval = await resolveApprovalForUse(tx, input);
  if (!approval.ok) return approval;
  const evidenceHash = await canonicalHash({ schemaVersion: 1, caseId: input.caseId, caseRevision: input.caseRevision,
    productRowId: input.productRowId, approval: approval.value });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const usage = await tx.partnerInquiryUsage.create({ data: { id: input.usageId ?? randomUUID(), caseId: input.caseId,
    caseRevision: input.caseRevision, productRowId: input.productRowId, approvalId: approval.value.approvalId,
    approvalSnapshot: approval.value as Prisma.InputJsonValue, evidenceHash, usedAt: clock.now } });
  return { ok: true, value: { usageId: usage.id, approval: approval.value,
    usedAt: usage.usedAt.toISOString(), replayed: false } };
}

/** Appends a new Case-revision usage from the preceding immutable snapshot.
 * Draft edits with unchanged price-bearing configuration retain that exact
 * wholesale truth even after inquiry expiry or supersession. */
export async function bindFrozenApprovalUsage(tx: Prisma.TransactionClient, input: UseInput & {
  caseId: string; caseRevision: number; productRowId: string; approval: ApprovedInquiry;
}): Promise<Result<{ usageId: string; approval: ApprovedInquiry; usedAt: string; replayed: false }>> {
  const approval = ApprovedInquirySchema.safeParse(input.approval);
  if (!approval.success || approval.data.partnerSellerId !== input.partnerSellerId ||
      approval.data.configurationHash !== input.configurationHash || approval.data.inquiryId !== input.binding.inquiryId ||
      approval.data.rowId !== input.binding.rowId || approval.data.revision !== input.binding.revision) {
    return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  }
  const binding = await tx.partnerCaseRowBinding.findUnique({ where: { caseId_revision_productRowId: {
    caseId: input.caseId, revision: input.caseRevision, productRowId: input.productRowId,
  } }, select: { configurationHash: true } });
  if (!binding || binding.configurationHash !== input.configurationHash) {
    return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  }
  const evidenceHash = await canonicalHash({ schemaVersion: 1, caseId: input.caseId,
    caseRevision: input.caseRevision, productRowId: input.productRowId, approval: approval.data });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const usageId = randomUUID();
  await tx.partnerInquiryUsage.create({ data: { id: usageId, caseId: input.caseId,
    caseRevision: input.caseRevision, productRowId: input.productRowId, approvalId: approval.data.approvalId,
    approvalSnapshot: approval.data as Prisma.InputJsonValue, evidenceHash, usedAt: clock.now } });
  return { ok: true, value: { usageId, approval: approval.data, usedAt: clock.now.toISOString(), replayed: false } };
}
