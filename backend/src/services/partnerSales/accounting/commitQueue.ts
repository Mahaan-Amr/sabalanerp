import { Prisma } from '@prisma/client';
import { PartnerEventSchema, canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { withCurrentSabalanPlan } from './sabalanPlan';
import { matchesFinancialPreparation, prepareCommittedAccountingSource, PARTNER_INTERNAL_ACCOUNTING_SOURCE,
  type PartnerFinancialPreparation } from './source';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Mandatory Case-commit side effect. It deliberately accepts the already
 * authorized finalization transaction instead of opening an Accounting API
 * authorization path or a second transaction. */
export async function enqueueCommittedPartnerCase(
  tx: Prisma.TransactionClient,
  input: { caseId: string; actorId: string },
): Promise<Result<{ queueEvidenceId: string }>> {
  const current = await readCurrentPartnerCaseViews(tx, input.caseId);
  if (!current?.accounting || current.row.state !== 'COMMITTED' || !current.row.internalRecordId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const eventRow = await tx.partnerCaseEvent.findFirst({ where: { caseId: input.caseId, type: 'CASE_COMMITTED' },
    orderBy: { sequence: 'asc' }, select: { id: true, evidence: true } });
  const commitment = PartnerEventSchema.safeParse(object(eventRow?.evidence)?.publicEvent);
  if (!eventRow || !commitment.success || commitment.data.type !== 'CASE_COMMITTED' ||
      commitment.data.eventId !== eventRow.id || commitment.data.internalRecordId !== current.row.internalRecordId ||
      commitment.data.salesCreditOwnerId !== current.row.profile.userId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const accounting = await withCurrentSabalanPlan(tx, current.accounting);
  const prepared = await prepareCommittedAccountingSource({ view: { ...accounting, state: 'COMMITTED' },
    partnerSellerId: current.row.profile.userId, commitment: commitment.data }, accounting.owner);
  if (!prepared.ok) return prepared;
  const queueEvidenceId = `partner-accounting:${(await canonicalHash(commitment.data.eventId)).slice(10)}`;
  const prior = await tx.accountingFinancialRecord.findFirst({ where: { OR: [
    { id: queueEvidenceId },
    { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, metadata: { path: ['partnerCaseId'], equals: input.caseId } },
  ] }, orderBy: { createdAt: 'asc' } });
  if (prior) {
    const historical = object(prior.sourceSnapshot)?.partnerPreparation as PartnerFinancialPreparation | undefined;
    const metadata = object(prior.metadata);
    if (prior.id !== queueEvidenceId || prior.sourceId !== prepared.value.internalRecordId ||
        metadata?.commitmentEventId !== commitment.data.eventId || !historical ||
        !matchesFinancialPreparation(prepared.value, historical)) {
      return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    }
    return { ok: true, value: { queueEvidenceId } };
  }
  await tx.accountingFinancialRecord.create({ data: { id: queueEvidenceId, kind: 'INVOICE_CANDIDATE', status: 'DRAFT',
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: prepared.value.internalRecordId,
    amount: prepared.value.amount.amount, currency: prepared.value.amount.currency,
    sourceSnapshot: json({ partnerPreparation: prepared.value }),
    metadata: json({ partnerCaseId: input.caseId, commitmentEventId: commitment.data.eventId }),
    idempotencyKey: queueEvidenceId, createdBy: input.actorId } });
  return { ok: true, value: { queueEvidenceId } };
}
