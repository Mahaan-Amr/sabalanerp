import type { Prisma, SalesContract } from '@prisma/client';
import { PartnerEventSchema, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { isPartnerCommercialFlow, partnerDeadlinePassed } from '../cases/commercialLifecycle';

export function isFinalPartnerLoadingContract(contract: SalesContract) {
  if (contract.isInactive || !['APPROVED', 'SIGNED', 'PRINTED'].includes(contract.status)) return false;
  return !isPartnerCommercialFlow(contract) || (contract.status === 'SIGNED' && !partnerDeadlinePassed(contract) &&
    contract.salesApprovalRevision === contract.commercialRevision && contract.customerAcceptanceRevision === contract.commercialRevision);
}

/** A persisted head may advance before the successor becomes commercially effective. */
export async function hasEffectivePartnerLoadingRevision(tx: Prisma.TransactionClient, owner: RevisionRef) {
  const event = await tx.partnerCaseEvent.findFirst({ where: { caseId: owner.caseId,
    type: { in: ['CASE_COMMITTED', 'CORRECTION_EFFECTIVE', 'CASE_RECOMMITTED'] },
  }, orderBy: { sequence: 'desc' }, select: { id: true, type: true, caseRevision: true, integrityHash: true, evidence: true } });
  if (event?.caseRevision !== owner.revision || event.integrityHash !== owner.integrityHash) return false;
  const parsed = PartnerEventSchema.safeParse((event.evidence as Prisma.JsonObject | null)?.publicEvent);
  return parsed.success && parsed.data.type === event.type && parsed.data.eventId === event.id &&
    parsed.data.owner.caseId === owner.caseId && parsed.data.owner.revision === owner.revision &&
    parsed.data.owner.integrityHash === owner.integrityHash;
}
