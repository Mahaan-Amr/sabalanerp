import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { canonicalHash, canonicalJson, RevisionRefSchema, partnerError, type Result, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { lockPartnerOperationsControl, authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { authorizePartnerLoading } from './loadingAuthority';
import { createPartnerFulfillmentAdapter } from './adapter';
import { createPrismaPartnerFulfillmentRepository } from './prismaRepository';

type ReservationSource = { sourceKind: 'SALES_CONTRACT' } | {
  sourceKind: 'PARTNER_CASE'; owner: RevisionRef; deliveryId: string; sourceHash: string;
};

/** Enter before queue/cutover locks. A nonlocking discriminator lookup does not
 * grant authority; every Partner owner is reread after the global/Case locks. */
export async function preparePartnerLoadingQueueChange(tx: Prisma.TransactionClient, input: {
  loadingId: string; actorId: string; expected?: RevisionRef; correlationId?: string; reason?: string;
}, operation: 'RESERVE' | 'ALLOCATE' | 'FINALIZE' | 'RELEASE' | 'GUARD_RELEASE'): Promise<Result<ReservationSource>> {
  const target = await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, select: { sourceKind: true, partnerCaseId: true } });
  if (!target || target.sourceKind === 'SALES_CONTRACT') return { ok: true, value: { sourceKind: 'SALES_CONTRACT' } };
  const fail = (code: Parameters<typeof partnerError>[0]): Result<never> => ({ ok: false, error: partnerError(code) });
  if (!target.partnerCaseId) return fail('INTEGRITY_CONFLICT');
  await lockPartnerOperationsControl(tx);
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${target.partnerCaseId} FOR UPDATE`;
  const actor = { actorId: input.actorId, correlationId: input.correlationId || randomUUID(), reason: input.reason };
  const authorized = await authorizePartnerLoading(tx, actor, target.partnerCaseId, operation);
  if (!authorized.ok) return authorized;
  const loading = await tx.logisticsLoading.findUniqueOrThrow({ where: { id: input.loadingId } });
  const origin = RevisionRefSchema.safeParse({ caseId: loading.partnerCaseId, revision: loading.partnerCaseRevision,
    integrityHash: loading.partnerIntegrityHash });
  if (loading.sourceKind !== 'PARTNER_CASE' || loading.partnerCaseId !== target.partnerCaseId || !origin.success ||
      !loading.partnerDeliveryId || loading.projectId !== null) return fail('INTEGRITY_CONFLICT');
  const adapter = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx, ...actor }));
  const historical = await adapter.readLoadingEvidence(origin.data, loading.partnerDeliveryId);
  if (!historical.ok) return historical;
  if (loading.partnerSourceHash !== await canonicalHash(historical.value) ||
      canonicalJson(loading.partnerSourceSnapshot) !== canonicalJson(historical.value) ||
      loading.customerId !== historical.value.recipient.customerId) return fail('INTEGRITY_CONFLICT');
  if (operation === 'RELEASE' || operation === 'GUARD_RELEASE') return { ok: true, value: { sourceKind: 'PARTNER_CASE', owner: origin.data,
    deliveryId: loading.partnerDeliveryId, sourceHash: await canonicalHash(historical.value) } };
  const expected = RevisionRefSchema.safeParse(input.expected);
  if (!expected.success || expected.data.caseId !== target.partnerCaseId) return fail('INVALID_PAYLOAD');
  const current = await adapter.readLoadingSource(expected.data, loading.partnerDeliveryId);
  if (!current.ok) return current;
  // Retail-only successors may retain the same physical loading. A changed
  // delivery/quantity/recipient must be deliberately selected in a new draft.
  if (canonicalJson({ ...historical.value, owner: current.value.owner }) !== canonicalJson(current.value)) return fail('ROW_STALE');
  const row = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: target.partnerCaseId }, select: { profileId: true } });
  const rollout = await authorizePartnerTechnicalRollout(tx, row.profileId, 'COMMITTED_FULFILLMENT');
  if (!rollout.ok) return rollout;
  if (await partnerPredecessorIsFrozen(tx, expected.data.caseId, expected.data.revision)) return fail('STATE_CONFLICT');
  return { ok: true, value: { sourceKind: 'PARTNER_CASE', owner: current.value.owner,
    deliveryId: loading.partnerDeliveryId, sourceHash: await canonicalHash(current.value) } };
}

export async function preparePartnerGuardQueueRelease(tx: Prisma.TransactionClient, input: {
  turnId: string; actorId: string; reason: string;
}): Promise<Result<{ loadingId: string | null; source?: ReservationSource }>> {
  const turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId }, select: { loadingId: true } });
  if (!turn?.loadingId) return { ok: true, value: { loadingId: null } };
  const source = await preparePartnerLoadingQueueChange(tx, { ...input, loadingId: turn.loadingId }, 'GUARD_RELEASE');
  return source.ok ? { ok: true, value: { loadingId: turn.loadingId, source: source.value } } : source;
}
