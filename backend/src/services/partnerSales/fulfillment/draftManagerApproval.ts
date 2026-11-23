import type { ContractDispatchAuthority, Prisma, SalesContract } from '@prisma/client';
import { RevisionRefSchema, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { ownsPartnerRevision } from '../events/persisted';
import { readEffectivePartnerLoadingRevision } from './effectiveRevision';

async function readManagerAudit(tx: Prisma.TransactionClient, authority: ContractDispatchAuthority,
  action: 'DISPATCH_MANAGER_APPROVE' | 'DISPATCH_AUTHORITY_REQUESTED', actorId: string) {
  const audit = await tx.accountingAuditLog.findFirst({ where: {
    contractId: authority.contractId, entityType: 'ContractDispatchCredit', entityId: authority.id, action, actorId,
  }, orderBy: { createdAt: 'desc' }, select: { afterState: true } });
  const evidence = audit?.afterState;
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : null;
}

const matchesOwner = (evidence: Prisma.JsonObject, owner: RevisionRef) => {
  const stamped = RevisionRefSchema.safeParse(evidence.partnerCaseOwner);
  return stamped.success && ownsPartnerRevision(stamped.data, owner);
};

/** Commercial-revision authority governs dispatch. Draft selection also needs
 * the specific effective Case revision, including Case-only corrections. */
export async function readPartnerDraftManagerApproval(tx: Prisma.TransactionClient, contract: SalesContract, owner: RevisionRef) {
  const authority = await tx.contractDispatchAuthority.findFirst({ where: {
    contractId: contract.id, kind: 'MANAGER', status: 'APPROVED', revision: contract.commercialRevision,
  } });
  if (!authority?.decidedAt || !authority.promisedDate || !authority.decidedBy || authority.decidedBy === authority.requestedBy) return null;
  const decision = await readManagerAudit(tx, authority, 'DISPATCH_MANAGER_APPROVE', authority.decidedBy);
  if (decision?.id !== authority.id || decision.revision !== authority.revision ||
      decision.status !== 'APPROVED' || decision.decidedAt !== authority.decidedAt.toISOString()) return null;
  if ('partnerCaseOwner' in decision) return matchesOwner(decision, owner) ? authority : null;

  // Historical approvals have commercial revision and decision evidence.
  // Only a decision made after this Case revision became effective can qualify.
  const effective = await readEffectivePartnerLoadingRevision(tx, owner);
  if (!effective) return null;
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return authority.decidedAt > effective.recordedAt && authority.decidedAt <= clock.now ? authority : null;
}

export async function isCurrentPartnerManagerRequest(tx: Prisma.TransactionClient, authority: ContractDispatchAuthority,
  contract: SalesContract, owner: RevisionRef | null) {
  if (!owner || authority.status !== 'PENDING' || authority.revision !== contract.commercialRevision) return false;
  const request = await readManagerAudit(tx, authority, 'DISPATCH_AUTHORITY_REQUESTED', authority.requestedBy);
  if (request && 'partnerCaseOwner' in request) return request.id === authority.id &&
    request.revision === authority.revision && request.status === 'PENDING' && matchesOwner(request, owner);
  const effective = await readEffectivePartnerLoadingRevision(tx, owner);
  // Legacy pending rows lack a Case stamp. A row that predates activation
  // cannot provide an independent decision for the successor.
  return Boolean(effective && authority.createdAt > effective.recordedAt);
}
