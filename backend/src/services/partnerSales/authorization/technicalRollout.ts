import type { Prisma } from '@prisma/client';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';

/** Fail-closed rollout boundary shared by every mounted Partner technical
 * surface. Reads remain available to an enrolled profile during an operational
 * pause; mutations additionally lock and re-read the cohort so pause and write
 * commit have one winner. */
export async function authorizePartnerTechnicalRollout(tx: Prisma.TransactionClient, profileId: string,
  operation: 'READ' | 'MUTATE'): Promise<Result<void>> {
  const memberships = await tx.partnerCohortMembership.findMany({ where: { profileId,
    cohort: { activationEnabled: true } }, select: { cohortId: true } });
  if (memberships.length !== 1) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  if (operation === 'READ') return { ok: true, value: undefined };
  const cohortId = memberships[0].cohortId;
  await tx.$queryRaw`SELECT id FROM partner_release_cohorts WHERE id = ${cohortId} FOR UPDATE`;
  const cohort = await tx.partnerReleaseCohort.findUnique({ where: { id: cohortId },
    select: { activationEnabled: true, operationalPaused: true } });
  if (!cohort?.activationEnabled) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  if (cohort.operationalPaused) return { ok: false, error: partnerError('OPERATIONAL_PAUSE') };
  return { ok: true, value: undefined };
}
