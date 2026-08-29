import { partnerError } from '@sabalanerp/partner-sales-contracts';
import type { PartnerTechnicalRecoveryDependencies } from '../cases/technicalRecovery';
import { createAuditedPartnerAuthorization } from './audited';

/** Creator-private pre-Case authority. The recovery module still owns lease,
 * CAS, expiry and idempotency. This adapter supplies only current domain rights;
 * it cannot issue a configuration ref, bypass a lease or impersonate a Partner. */
export function createPartnerTechnicalRecoveryAuthority(binding: { actorId: string; correlationId: string })
  : PartnerTechnicalRecoveryDependencies['authorize'] {
  return async (tx, input) => {
    if (input.actorId !== binding.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
    // Same order as technicalRecoveryLease: session -> Profile -> Users ->
    // central authority. No caller may enter this after locking a Case child.
    await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions WHERE "draftId" = ${input.recoveryId} FOR UPDATE`;
    const session = await tx.salesContractEditSession.findUnique({ where: { draftId: input.recoveryId },
      select: { ownerUserId: true, contractId: true } });
    if (!session || session.ownerUserId !== binding.actorId || session.contractId !== null) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
    const profile = await tx.partnerProfile.findUnique({ where: { userId: binding.actorId }, select: { id: true } });
    if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
    const port = createAuditedPartnerAuthorization(tx, { actorId: binding.actorId, purpose: 'PARTNER', channel: 'API' },
      { correlationId: binding.correlationId });
    const decision = await port.authorize(input.operation === 'READ' ? 'CASE_READ' : 'CASE_DRAFT_WRITE', { kind: 'PROFILE', id: profile.id });
    if (!decision.ok) return decision;
    if (input.operation === 'READ') return { ok: true, value: undefined };
    const memberships = await tx.partnerCohortMembership.findMany({ where: { profileId: profile.id,
      cohort: { activationEnabled: true } }, select: { cohortId: true, cohort: { select: {
        activationEnabled: true, operationalPaused: true,
      } } } });
    if (memberships.length !== 1) return { ok: false, error: partnerError('COHORT_NOT_READY') };
    const cohortId = memberships[0].cohortId;
    // The rollout row is the last lock before a technical mutation. Re-read it
    // after any wait so pause and save/checkpoint have one commit winner.
    await tx.$queryRaw`SELECT id FROM partner_release_cohorts WHERE id = ${cohortId} FOR UPDATE`;
    const cohort = await tx.partnerReleaseCohort.findUnique({ where: { id: cohortId },
      select: { activationEnabled: true, operationalPaused: true } });
    if (!cohort?.activationEnabled) return { ok: false, error: partnerError('COHORT_NOT_READY') };
    if (cohort.operationalPaused) return { ok: false, error: partnerError('OPERATIONAL_PAUSE') };
    return { ok: true, value: undefined };
  };
}
