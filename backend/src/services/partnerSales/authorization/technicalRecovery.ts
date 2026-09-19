import { isPartnerCaseEditableState, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { PartnerTechnicalRecoveryDependencies } from '../cases/technicalRecovery';
import { createAuditedPartnerAuthorization } from './audited';
import { authorizePartnerTechnicalRollout } from './technicalRollout';

/** Creator-private pre-Case authority. The recovery module still owns lease,
 * CAS, expiry and idempotency. This adapter supplies only current domain rights;
 * it cannot issue a configuration ref, bypass a lease or impersonate a Partner. */
export function createPartnerTechnicalRecoveryAuthority(binding: { actorId: string; correlationId: string })
  : PartnerTechnicalRecoveryDependencies['authorize'] {
  return async (tx, input) => {
    if (input.actorId !== binding.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
    // The Prisma composition has already locked global operations control;
    // session -> Profile -> Users -> central authority follows that boundary.
    await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions WHERE "draftId" = ${input.recoveryId} FOR UPDATE`;
    const session = await tx.salesContractEditSession.findUnique({ where: { draftId: input.recoveryId },
      select: { ownerUserId: true, contractId: true } });
    if (!session || session.ownerUserId !== binding.actorId) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
    const profile = await tx.partnerProfile.findUnique({ where: { userId: binding.actorId }, select: { id: true } });
    if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
    const port = createAuditedPartnerAuthorization(tx, { actorId: binding.actorId, purpose: 'PARTNER', channel: 'API' },
      { correlationId: binding.correlationId });
    const contract = session.contractId ? await tx.salesContract.findUnique({ where: { id: session.contractId },
      select: { partnerKind: true, partnerCase: { select: { id: true, state: true,
        profile: { select: { userId: true } } } } } }) : null;
    const boundCase = contract?.partnerCase;
    if (session.contractId && (contract?.partnerKind !== 'PARTNER_CUSTOMER' || !boundCase ||
        boundCase.profile.userId !== binding.actorId ||
        !isPartnerCaseEditableState(boundCase.state))) {
      return { ok: false, error: partnerError('STATE_CONFLICT') };
    }
    const decision = await port.authorize(input.operation === 'READ' ? 'CASE_READ' : 'CASE_DRAFT_WRITE',
      boundCase ? { kind: 'CASE', id: boundCase.id } : { kind: 'PROFILE', id: profile.id });
    if (!decision.ok) return decision;
    return authorizePartnerTechnicalRollout(tx, profile.id, input.operation === 'READ' ? 'READ' : 'MUTATE');
  };
}
