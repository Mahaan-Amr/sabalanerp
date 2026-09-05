import type { Prisma } from '@prisma/client';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';

export const PARTNER_OPERATIONS_CONTROL_ID = 'partner-operations';

/** The global operations row is always the first durable lock acquired by a
 * Partner mutation. Callers may safely invoke this again after their entry
 * guard; PostgreSQL retains the same row lock through commit. */
export async function lockPartnerOperationsControl(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM partner_operations_controls
    WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
  return tx.partnerOperationsControl.findUnique({ where: { id: PARTNER_OPERATIONS_CONTROL_ID },
    select: { cohortId: true, operationalPaused: true } });
}

/** Fail-closed rollout boundary shared by every mounted Partner technical
 * surface. Reads remain available to an enrolled profile during an operational
 * pause; mutations additionally lock and re-read the cohort so pause and write
 * commit have one winner. */
export async function authorizePartnerTechnicalRollout(tx: Prisma.TransactionClient, profileId: string,
  operation: 'READ' | 'MUTATE' | 'CONTROL' | 'COMMITTED_FULFILLMENT'): Promise<Result<void>> {
  const control = operation === 'READ'
    ? await tx.partnerOperationsControl.findUnique({ where: { id: PARTNER_OPERATIONS_CONTROL_ID },
      select: { cohortId: true, operationalPaused: true } })
    : await lockPartnerOperationsControl(tx);
  if (!control) return { ok: false, error: partnerError('COHORT_NOT_READY') };
  // A committed Case is already a durable Sabalan obligation. Its fulfillment
  // remains available during emergency pause and after rollout cohort changes;
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
  // A pause blocks new commercial facts, not the controls required to cancel
  // pending work or replace an unavailable responder.
  if (operation === 'MUTATE' && control.operationalPaused) return { ok: false, error: partnerError('OPERATIONAL_PAUSE') };
  return { ok: true, value: undefined };
}
