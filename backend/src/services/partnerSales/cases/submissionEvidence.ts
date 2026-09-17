import { Prisma } from '@prisma/client';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';

export const SUBMISSION_EVIDENCE_OPERATION = 'PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1';

/** Immutable saved configurations survive submission. A bound session may retain
 * that evidence for Draft revisions, but it is no longer an editable lease. */
export async function readSubmittedTechnicalSnapshots(tx: Prisma.TransactionClient, actorId: string, recoveryId: string) {
  const row = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
    actorId, operation: SUBMISSION_EVIDENCE_OPERATION, targetScope: recoveryId, key: 'v1' } } });
  if (!row) return undefined;
  if (await canonicalHash(row.outcome) !== row.payloadHash) throw new Error('Partner submission evidence integrity conflict');
  const evidence = row.outcome as { schemaVersion?: number; validatedSnapshots?: unknown[] } | null;
  if (evidence?.schemaVersion !== 1 || !Array.isArray(evidence.validatedSnapshots)) {
    throw new Error('Partner submission evidence integrity conflict');
  }
  return evidence.validatedSnapshots;
}
