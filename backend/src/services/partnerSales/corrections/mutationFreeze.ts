import type { Prisma } from '@prisma/client';

async function frozenOpportunityConditions(tx: Prisma.TransactionClient) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return {
    gates: { some: { kind: 'SALES_SCOPE', outcome: 'APPROVE' }, none: { outcome: 'REJECT' } },
    OR: [{ save: { isNot: null } }, { expiresAt: { gt: clock.now } }],
  } satisfies Prisma.PartnerCorrectionOpportunityWhereInput;
}

/** The Accounting snapshot holds the shared fence for these verified heads.
 * Evaluate expiry at the same database instant across the invoice population. */
export async function readFrozenPartnerPredecessors(tx: Prisma.TransactionClient,
  heads: Array<{ caseId: string; predecessorRevision: number }>) {
  if (!heads.length) return new Set<string>();
  const matches = await tx.partnerCorrectionOpportunity.findMany({ where: {
    AND: [{ OR: heads }, await frozenOpportunityConditions(tx)],
  }, select: { caseId: true } });
  return new Set(matches.map(row => row.caseId));
}

/** Scope approval freezes new predecessor obligations, not read access or the
 * release/return/settlement work required to complete the correction. The caller
 * owns the Case lock, so scope approval and a new obligation cannot cross. */
export async function partnerPredecessorIsFrozen(tx: Prisma.TransactionClient, caseId: string, revision: number) {
  return Boolean(await tx.partnerCorrectionOpportunity.findFirst({ where: {
    caseId, predecessorRevision: revision, ...await frozenOpportunityConditions(tx),
  }, select: { id: true } }));
}
