import { readContractEditSession, readContractEditSessionMetadata } from '../../contractEditSessionRead';
import type { Prisma } from '@prisma/client';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../contractRecoveryProtection';

type RecoveryMetadataRow = { draftId: string; baseRevision: number; recovery: Prisma.JsonValue | null };

/** Creation navigation validates the draft and wizard metadata, not historical
 * graph envelopes. Exclude that journal in SQL before Prisma materializes it;
 * owning recovery/save readers still load and validate the complete evidence. */
export async function readPartnerCreationRecoveries(tx: Prisma.TransactionClient, ownerUserId: string, caseId?: string) {
  const rawDrafts = await tx.$queryRaw<RecoveryMetadataRow[]>`
    SELECT "draftId", "baseRevision", recovery - 'validatedSnapshots' AS recovery
    FROM sales_contract_edit_sessions
    WHERE "ownerUserId" = ${ownerUserId} AND "contractId" IS NULL
      AND recovery->>'kind' = ${PARTNER_TECHNICAL_RECOVERY_KIND}
    ORDER BY "updatedAt" DESC LIMIT 200`;
  const requested = caseId ? await tx.$queryRaw<RecoveryMetadataRow[]>`
    SELECT "draftId", "baseRevision", recovery - 'validatedSnapshots' AS recovery
    FROM sales_contract_edit_sessions
    WHERE "ownerUserId" = ${ownerUserId} AND purpose = 'PARTNER_TECHNICAL'
      AND recovery->>'partnerCaseId' = ${caseId}
    ORDER BY "updatedAt" DESC LIMIT 1` : [];
  return { rawDrafts, requestedRecovery: requested[0] ?? null };
}

/** Keep the ORM's existing first-match lookup semantics, then materialize the
 * complete document through the UTF-8 transport. Recheck the selected
 * incarnation and ownership/binding before exposing its evidence. */
export async function readPartnerCaseRecovery(tx: Prisma.TransactionClient, input: {
  ownerUserId: string; caseId: string; contractId?: string | null; navigationOnly?: boolean;
}) {
  const found = await tx.salesContractEditSession.findFirst({ where: {
    ownerUserId: input.ownerUserId, purpose: 'PARTNER_TECHNICAL',
    OR: [ ...(input.contractId ? [{ contractId: input.contractId }] : []),
      { recovery: { path: ['partnerCaseId'], equals: input.caseId } } ],
  }, select: { id: true, draftId: true } });
  if (!found) return null;
  const session = input.navigationOnly
    ? await readContractEditSessionMetadata(tx, found.draftId)
    : await readContractEditSession(tx, found.draftId);
  const recovery = session?.recovery;
  const caseBound = recovery !== null && typeof recovery === 'object' && !Array.isArray(recovery)
    && recovery?.partnerCaseId === input.caseId;
  const contractBound = Boolean(input.contractId && session?.contractId === input.contractId);
  if (!session || session.id !== found.id || session.ownerUserId !== input.ownerUserId ||
      session.purpose !== 'PARTNER_TECHNICAL' || (!contractBound && !caseBound)) return null;
  return { draftId: session.draftId, baseRevision: session.baseRevision, recovery: session.recovery };
}
