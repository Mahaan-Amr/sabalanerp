import { randomUUID } from 'node:crypto';
import { Prisma, type AccountingFinancialRecord } from '@prisma/client';
import {
  PartnerEventSchema, SabalanInternalRecordViewSchema, canonicalHash, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import type { PartnerFinancialPreparation } from './source';
import { equalAmounts, matchesFinancialPreparation, prepareCommittedAccountingSource, PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { approveStagedPartnerReplacement, PARTNER_REPLACEMENT_MODE, type PartnerReplacementApprovalInput } from './sharedCorrection';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { PartnerAccountingCommandError } from './errors';
import { readPartnerAccountingCapabilities } from './capabilities';
import { partnerError } from '@sabalanerp/partner-sales-contracts';
import { readPartnerInvoiceSource } from './invoiceSource';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const partnerFinancialApprovalAuthorization = Symbol('partnerFinancialApprovalAuthorization');
export type PartnerFinancialApprovalAuthorization = {
  caseId: string;
  recordId: string;
  [partnerFinancialApprovalAuthorization]: true;
};

export { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';

/** Call before mutating the invoice, returning a denied decision from the owning
 * transaction so its central audit survives. Case precedes invoice in the lock order. */
export async function authorizePartnerFinancialApproval(tx: Prisma.TransactionClient, record: AccountingFinancialRecord,
  input: Pick<PartnerReplacementApprovalInput, 'actorId' | 'correlationId' | 'downstreamNote'>
): Promise<Result<PartnerFinancialApprovalAuthorization>> {
  const metadata = object(record.metadata);
  if (record.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || typeof metadata?.partnerCaseId !== 'string') {
    throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'منبع صورتحساب همکار معتبر نیست؛ بررسی پرونده در حسابداری لازم است.');
  }
  await lockPartnerOperationsControl(tx);
  const caseId = metadata.partnerCaseId;
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const decision = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose: 'ACCOUNTING', channel: 'API' },
    { correlationId: input.correlationId, reason: input.downstreamNote || 'تأیید مالی صورتحساب پرونده همکار' },
    typeof metadata.correctionId === 'string' ? { correctionOpportunityId: metadata.correctionId } : undefined)
    // FINANCIAL_APPROVE is the distinct-manager correction gate and requires
    // its real requester. Initial invoice approval retains the Accounting
    // adapter's ACCOUNTING_WRITE mapping, in addition to the HTTP manager gate.
    .authorize(metadata.mode === PARTNER_REPLACEMENT_MODE ? 'FINANCIAL_APPROVE' : 'ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
  if (!decision.ok) return decision;
  if (!(await readPartnerAccountingCapabilities(tx, input.actorId)).approve) return { ok: false as const, error: partnerError('FORBIDDEN') };
  await readPartnerInvoiceSource(tx, record, caseId);
  return { ok: true as const, value: {
    caseId, recordId: record.id, [partnerFinancialApprovalAuthorization]: true as const,
  } };
}

/**
 * Partner financial approval is deliberately not sealed against the retail
 * SalesContract. Its immutable source is the Sabalan-to-Partner record, whose
 * debtor, amount and terms differ from the end-customer contract. This hook
 * validates that private source and publishes the official receivable/event in
 * the same Accounting approval transaction.
 */
export async function approvePartnerFinancialSourceWithinTransaction(
  tx: Prisma.TransactionClient,
  record: AccountingFinancialRecord,
  input: PartnerReplacementApprovalInput,
  authorization?: PartnerFinancialApprovalAuthorization,
): Promise<AccountingFinancialRecord> {
  if (record.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || !record.sourceId) {
    throw new Error('Partner financial approval source is invalid');
  }
  const metadata = object(record.metadata);
  const historical = object(record.sourceSnapshot)?.partnerPreparation as PartnerFinancialPreparation | undefined;
  const caseId = metadata?.partnerCaseId;
  if (!historical || typeof caseId !== 'string') throw new Error('Partner financial preparation is missing');
  let verified = authorization;
  if (!verified) {
    const decision = await authorizePartnerFinancialApproval(tx, record, input);
    if (!decision.ok) {
      throw new PartnerAccountingCommandError('FORBIDDEN',
        'مجوز تأیید مالی این پرونده همکار فعال نیست؛ مدیر حسابداری باید دسترسی پرونده را بررسی کند.');
    }
    verified = decision.value;
  }
  if (!verified || verified[partnerFinancialApprovalAuthorization] !== true || verified.caseId !== caseId || verified.recordId !== record.id) {
    throw new PartnerAccountingCommandError('FORBIDDEN', 'مجوز تأیید مالی این پرونده همکار فعال نیست؛ مدیر حسابداری باید دسترسی پرونده را بررسی کند.');
  }

  const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, state: true, headRevision: true, integrityHash: true, internalRecordId: true,
    profile: { select: { userId: true } }, head: { select: { internalProjection: true } },
    events: { where: { type: 'CASE_COMMITTED' }, orderBy: { sequence: 'asc' }, take: 1, select: { evidence: true } },
  } });
  if (metadata?.mode === PARTNER_REPLACEMENT_MODE && row && historical.owner.revision > row.headRevision) {
    return approveStagedPartnerReplacement(tx, record, input);
  }
  if (row && await partnerPredecessorIsFrozen(tx, row.id, row.headRevision)) {
    throw new Error('تأیید صورتحساب قبلی تا تعیین تکلیف گردش اصلاح پرونده همکار متوقف است.');
  }
  if (metadata?.mode === PARTNER_REPLACEMENT_MODE) {
    const staged = object(metadata.partnerStagedApproval);
    const effect = await tx.partnerCaseEvent.findFirst({ where: { caseId, type: 'CORRECTION_EFFECTIVE',
      caseRevision: historical.owner.revision, integrityHash: historical.owner.integrityHash,
      evidence: { path: ['publicEvent', 'correctionId'], equals: metadata.correctionId as string } } });
    if (!effect || staged?.actorId !== input.actorId || staged?.invoiceRecordId !== record.id) {
      throw new Error('انتشار صورتحساب جایگزین فقط پس از تکمیل گردش اصلاح پرونده همکار مجاز است.');
    }
  }
  const view = SabalanInternalRecordViewSchema.safeParse(object(row?.head.internalProjection)?.accounting);
  const commitment = PartnerEventSchema.safeParse(object(row?.events[0]?.evidence)?.publicEvent);
  if (!row || row.state !== 'COMMITTED' || row.internalRecordId !== record.sourceId || !view.success ||
      view.data.owner.caseId !== row.id || view.data.owner.revision !== row.headRevision ||
      view.data.owner.integrityHash !== row.integrityHash || !commitment.success ||
      commitment.data.type !== 'CASE_COMMITTED') throw new Error('Partner financial source integrity conflict');

  const prepared = await prepareCommittedAccountingSource({
    view: { ...view.data, state: row.state }, partnerSellerId: row.profile.userId, commitment: commitment.data,
  }, view.data.owner);
  if (!prepared.ok || !matchesFinancialPreparation(prepared.value, historical) ||
      historical.evidenceHash !== prepared.value.evidenceHash ||
      record.currency !== prepared.value.amount.currency || !equalAmounts(record.amount.toString(), prepared.value.amount.amount)) {
    throw new Error('Partner financial preparation no longer matches its committed source');
  }

  const approval = {
    eventId: randomUUID(), commandId: input.commandId, correlationId: input.correlationId,
    actorId: input.actorId, recordedAt: input.approvedAt.toISOString(),
    effectiveDate: input.effectiveDate.toISOString().slice(0, 10),
    financialApprovalEvidenceId: `partner-financial-approval:${(await canonicalHash({
      invoiceRecordId: record.id, evidenceHash: prepared.value.evidenceHash,
      actorId: input.actorId, approvedAt: input.approvedAt.toISOString(),
    })).slice(10)}`,
  };
  if (await tx.accountingReceivable.count({ where: { status: { not: 'VOIDED' },
    invoiceRecord: { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: record.sourceId } } })) {
    throw new Error('تعهد فعال قبلی باید در همان گردش اصلاح پرونده همکار تعیین تکلیف شود.');
  }
  const receivable = {
    id: `partner-receivable:${(await canonicalHash(record.id)).slice(10)}`,
    invoiceRecordId: record.id, internalRecordId: prepared.value.internalRecordId,
    partnerSellerId: prepared.value.debtor.partnerSellerId,
    commercialAccountId: prepared.value.debtor.commercialAccountId, owner: historical.owner,
    originalAmount: prepared.value.amount, paymentPlan: prepared.value.paymentPlan,
    dueDate: [...prepared.value.paymentPlan.installments]
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate ?? prepared.value.paymentPlan.effectiveDate,
  };
  const event = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_FINANCIAL_APPROVED',
    owner: prepared.value.owner, ...approval, internalRecordId: prepared.value.internalRecordId,
    accountingReceivableId: receivable.id, financialApprovalEvidenceId: approval.financialApprovalEvidenceId,
    amount: prepared.value.amount });

  const updated = await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: {
    metadata: json({ ...metadata, partnerApproval: approval }),
  } });
  await tx.accountingReceivable.create({ data: { id: receivable.id, invoiceRecordId: record.id,
    originalAmount: receivable.originalAmount.amount, remainingAmount: receivable.originalAmount.amount,
    currency: receivable.originalAmount.currency, dueDate: new Date(`${receivable.dueDate}T00:00:00.000Z`),
    metadata: json({ partnerReceivable: receivable }), createdBy: input.actorId } });
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId, caseRevision: event.owner.revision,
    integrityHash: event.owner.integrityHash, sequence: (maximum._max.sequence ?? 0) + 1, type: event.type,
    actorId: event.actorId, commandId: event.commandId, correlationId: event.correlationId,
    effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`), evidence: json({ publicEvent: event }) } });
  return updated;
}
