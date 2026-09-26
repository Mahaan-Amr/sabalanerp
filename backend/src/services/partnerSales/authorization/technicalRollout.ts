import type { Prisma } from '@prisma/client';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';

export const PARTNER_OPERATIONS_CONTROL_ID = 'partner-operations';

/** Legacy cohort mutations still serialize through their historical rollout
 * row. Directly converted profiles do not use this global control. */
export async function lockPartnerOperationsControl(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM partner_operations_controls
    WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
  return tx.partnerOperationsControl.findUnique({ where: { id: PARTNER_OPERATIONS_CONTROL_ID },
    select: { cohortId: true, operationalPaused: true } });
}

/** Compatibility rollout boundary shared by mounted Partner technical
 * surfaces. Direct conversion bypasses it completely; older profiles retain
 * their named-cohort eligibility until migrated. */
export async function authorizePartnerTechnicalRollout(tx: Prisma.TransactionClient, profileId: string,
  operation: 'READ' | 'MUTATE' | 'CONTROL' | 'COMMITTED_FULFILLMENT'): Promise<Result<void>> {
  const direct = tx.partnerConversionDisposition && await tx.partnerConversionDisposition.findFirst({ where: {
    profileId, sourceType: 'PARTNER_ACTIVATION', disposition: 'DIRECT_V4',
  }, select: { id: true } });
  // Direct conversion is the complete availability decision. It must not
  // depend on the existence or value of a legacy global rollout row.
  if (direct) return { ok: true, value: undefined };
  const control = operation === 'READ'
    ? await tx.partnerOperationsControl.findUnique({ where: { id: PARTNER_OPERATIONS_CONTROL_ID },
      select: { cohortId: true, operationalPaused: true } })
    : await lockPartnerOperationsControl(tx);
  if (!control) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  // A committed Case is already a durable Sabalan obligation. Its fulfillment
  // remains available after legacy rollout cohort changes;
  // the fulfillment boundary separately proves COMMITTED source and current
  // actor authority under the global/Case locks acquired before this call.
  if (operation === 'COMMITTED_FULFILLMENT') return { ok: true, value: undefined };
  if (!control.cohortId) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  const memberships = await tx.partnerCohortMembership.findMany({ where: { profileId,
    cohortId: control.cohortId, cohort: { activationEnabled: true } }, select: { cohortId: true } });
  if (memberships.length !== 1) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  if (operation === 'READ') return { ok: true, value: undefined };
  const cohortId = memberships[0].cohortId;
  await tx.$queryRaw`SELECT id FROM partner_release_cohorts WHERE id = ${cohortId} FOR UPDATE`;
  const cohort = await tx.partnerReleaseCohort.findUnique({ where: { id: cohortId },
    select: { activationEnabled: true, operationalPaused: true } });
  if (!cohort?.activationEnabled) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  return { ok: true, value: undefined };
}
