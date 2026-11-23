import type { Prisma, SalesContract } from '@prisma/client';
import { RevisionRefSchema, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { ownsPartnerRevision } from '../events/persisted';
import { readEffectivePartnerLoadingRevision } from './effectiveRevision';

/** Commercial-revision authority governs dispatch. Draft selection also needs
 * the specific effective Case revision, including Case-only corrections. */
export async function hasPartnerDraftManagerApproval(tx: Prisma.TransactionClient, contract: SalesContract, owner: RevisionRef) {
  const authority = await tx.contractDispatchAuthority.findFirst({ where: {
    contractId: contract.id, kind: 'MANAGER', status: 'APPROVED', revision: contract.commercialRevision,
  } });
  if (!authority?.decidedAt || !authority.promisedDate || !authority.decidedBy || authority.decidedBy === authority.requestedBy) return false;
  const audit = await tx.accountingAuditLog.findFirst({ where: {
    contractId: contract.id, entityType: 'ContractDispatchCredit', entityId: authority.id,
    action: 'DISPATCH_MANAGER_APPROVE', actorId: authority.decidedBy,
  }, orderBy: { createdAt: 'desc' }, select: { afterState: true } });
  const decision = audit?.afterState as Prisma.JsonObject | null | undefined;
  if (decision?.id !== authority.id || decision.status !== 'APPROVED' ||
      decision.revision !== authority.revision || decision.decidedAt !== authority.decidedAt.toISOString()) return false;
  if ('partnerCaseOwner' in decision) {
    const stamped = RevisionRefSchema.safeParse(decision.partnerCaseOwner);
    return stamped.success && ownsPartnerRevision(stamped.data, owner);
  }

  // Historical approvals have commercial revision and decision evidence.
  // Only a decision made after this Case revision became effective can qualify.
  const effective = await readEffectivePartnerLoadingRevision(tx, owner);
  if (!effective) return false;
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return authority.decidedAt > effective.recordedAt && authority.decidedAt <= clock.now;
}
