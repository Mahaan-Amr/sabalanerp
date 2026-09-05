import type { Prisma } from '@prisma/client';

/** Scope approval freezes new predecessor obligations, not read access or the
 * release/return/settlement work required to complete the correction. The caller
 * owns the Case lock, so scope approval and a new obligation cannot cross. */
export async function partnerPredecessorIsFrozen(tx: Prisma.TransactionClient, caseId: string, revision: number) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return Boolean(await tx.partnerCorrectionOpportunity.findFirst({ where: {
    caseId, predecessorRevision: revision,
    gates: { some: { kind: 'SALES_SCOPE', outcome: 'APPROVE' }, none: { outcome: 'REJECT' } },
    OR: [{ save: { isNot: null } }, { expiresAt: { gt: clock.now } }],
  }, select: { id: true } }));
}
