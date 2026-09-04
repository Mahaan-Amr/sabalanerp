import type { Prisma } from '@prisma/client';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import type { RetailCorrectionRecord } from './retailCorrection';

export const retailStateScope = (caseId: string) => ({ actorId: 'SYSTEM',
  operation: 'RETAIL_CORRECTION_STATE', targetScope: caseId });

/** Workflow snapshots are immutable command evidence, ordered by sequence. */
export async function readRetailCorrectionState(tx: Prisma.TransactionClient, caseId: string) {
  const rows = await tx.partnerCommandOutcome.findMany({ where: retailStateScope(caseId),
    select: { key: true, payloadHash: true, outcome: true } });
  const states: RetailCorrectionRecord[] = [];
  for (const row of rows) {
    const value = row.outcome as unknown as RetailCorrectionRecord;
    if (!value || value.caseId !== caseId || !Number.isSafeInteger(value.sequence) || value.sequence < 2 ||
        (row.key !== 'v1' && row.key !== `v1:${value.sequence}`) || await canonicalHash(value) !== row.payloadHash) {
      throw new Error('Partner retail correction history integrity conflict');
    }
    states.push(value);
  }
  states.sort((left, right) => left.sequence - right.sequence);
  if ((states.length && states[0].sequence !== 2) ||
      states.some((state, index) => index > 0 && state.sequence !== states[index - 1].sequence + 1)) {
    throw new Error('Partner retail correction history sequence conflict');
  }
  const outcome = states.at(-1);
  return outcome ? { outcome } : null;
}
