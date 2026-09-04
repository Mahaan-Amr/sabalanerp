import type { AccountingFinancialRecord, Prisma } from '@prisma/client';
import { HashSchema, RevisionRefSchema, SabalanInternalRecordViewSchema, canonicalHash, partnerError,
  type Result } from '@sabalanerp/partner-sales-contracts';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, preparePartnerFinancialSource, type PartnerFinancialPreparation } from './source';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readPartnerCollections } from './collections';
import { readPartnerRevisionProjections } from '../cases/lifecycle';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const PARTNER_REPLACEMENT_MODE = 'PARTNER_SHARED_CORRECTION_REPLACEMENT';

/** A sealed external approval is not a published obligation. Readers must
 * validate the seal before hiding a staged record; a missing publication alone
 * is never evidence that an invoice is merely pending. */
export async function matchesPartnerStagedApproval(record: AccountingFinancialRecord, preparation: unknown) {
  const metadata = object(record.metadata), staged = object(metadata?.partnerStagedApproval);
  if (metadata?.mode !== PARTNER_REPLACEMENT_MODE || !staged || !record.financiallyApprovedAt ||
      !record.financiallyApprovedBy || !record.systemInvoiceDate || !record.systemInvoiceNumber ||
      !record.sepidarAmount?.equals(record.amount)) return false;
  const { evidenceHash, ...evidence } = staged;
  return await canonicalHash(evidence) === evidenceHash && staged.invoiceRecordId === record.id &&
    staged.correctionId === metadata.correctionId && staged.actorId === record.financiallyApprovedBy &&
    staged.approvedAt === record.financiallyApprovedAt.toISOString() &&
    staged.systemInvoiceNumber === record.systemInvoiceNumber && staged.systemInvoiceDate === record.systemInvoiceDate.toISOString() &&
    staged.sepidarAmount === record.sepidarAmount.toString() && staged.preparationHash === await canonicalHash(preparation) &&
    typeof staged.externalReference === 'string' && Boolean(staged.externalReference.trim()) &&
    typeof staged.commandId === 'string' && typeof staged.correlationId === 'string' && typeof staged.downstreamNote === 'string';
}

export type PartnerReplacementApprovalInput = { actorId: string; commandId: string; correlationId: string;
  approvedAt: Date; effectiveDate: Date; externalReference?: string; downstreamNote?: string };

/** Existing Accounting approval seals the pending invoice, but publication is
 * reserved for the atomic Case effect. No earlier obligation is voided here. */
export async function approveStagedPartnerReplacement(tx: Prisma.TransactionClient, record: AccountingFinancialRecord,
  input: PartnerReplacementApprovalInput) {
  const metadata = object(record.metadata);
  if (metadata?.mode !== PARTNER_REPLACEMENT_MODE || typeof metadata.correctionId !== 'string' ||
      typeof metadata.partnerCaseId !== 'string' || !input.externalReference?.trim() ||
      !record.financiallyApprovedAt || record.financiallyApprovedBy !== input.actorId || record.status !== 'ISSUED' ||
      !record.systemInvoiceNumber || !record.systemInvoiceDate || !record.sepidarAmount?.equals(record.amount)) {
    throw new Error('Partner replacement requires approved external invoice and cancellation evidence');
  }
  const opportunity = await tx.partnerCorrectionOpportunity.findUniqueOrThrow({ where: { id: metadata.correctionId }, include: { gates: true } });
  const processor = opportunity.gates.find(gate => gate.kind === 'ACCOUNTING_PROCESS' && gate.outcome === 'APPROVE');
  const manager = opportunity.gates.find(gate => gate.kind === 'ACCOUNTING_MANAGER' && gate.outcome === 'APPROVE');
  if (!processor || processor.actorId === input.actorId || opportunity.requesterId === input.actorId ||
      (manager && manager.actorId !== input.actorId) ||
      opportunity.gates.some(gate => gate.outcome === 'REJECT')) throw new Error('Partner correction Accounting actor separation conflict');
  const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
    purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: input.correlationId,
    reason: input.downstreamNote || 'تأیید مستند صورتحساب جایگزین همکار' }, { correctionOpportunityId: opportunity.id })
    .authorize('FINANCIAL_APPROVE', { kind: 'CASE', id: metadata.partnerCaseId });
  if (!authorization.ok) throw new Error('Partner replacement Accounting authorization denied');
  const staged = await stagePartnerAccountingReplacement(tx, { caseId: metadata.partnerCaseId,
    correctionId: opportunity.id, actorId: input.actorId });
  if (!staged || staged.id !== record.id) throw new Error('Partner replacement source no longer matches its pending correction');
  const evidence = { schemaVersion: 1, invoiceRecordId: record.id, correctionId: opportunity.id,
    actorId: input.actorId, commandId: input.commandId, correlationId: input.correlationId,
    approvedAt: record.financiallyApprovedAt.toISOString(), externalReference: input.externalReference.trim(),
    downstreamNote: input.downstreamNote?.trim() || '', systemInvoiceNumber: record.systemInvoiceNumber,
    systemInvoiceDate: record.systemInvoiceDate.toISOString(), sepidarAmount: record.sepidarAmount.toString(),
    preparationHash: await canonicalHash(object(record.sourceSnapshot)?.partnerPreparation) };
  return tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { metadata: json({ ...metadata,
    partnerStagedApproval: { ...evidence, evidenceHash: await canonicalHash(evidence) } }) } });
}

/** Stages an ordinary Accounting invoice record with a private Partner source;
 * no receivable, published approval or effective Case state is changed here.
 * Caller owns the locked Case save transaction and its authorization.
 */
export async function stagePartnerAccountingReplacement(tx: Prisma.TransactionClient, input: {
  caseId: string; correctionId: string; actorId: string;
}) {
  const sale = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: input.caseId },
    include: { profile: true } });
  const records = await tx.accountingFinancialRecord.findMany({ where: { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE,
    sourceId: sale.internalRecordId, kind: 'INVOICE_CANDIDATE', status: { not: 'VOIDED' } } });
  const ordinary = records.filter(row => object(row.metadata)?.mode !== PARTNER_REPLACEMENT_MODE || object(row.metadata)?.partnerApproval);
  // If Accounting has never prepared this commitment, the corrected committed
  // source will enter its normal first-invoice path. There is no debt to replace.
  if (!ordinary.length) return null;
  if (ordinary.length !== 1) throw new Error('Partner replacement predecessor evidence conflict');
  const predecessor = ordinary[0];
  const opportunity = await tx.partnerCorrectionOpportunity.findUniqueOrThrow({ where: { id: input.correctionId },
    include: { save: { include: { successor: true } }, gates: true } });
  const successor = opportunity.save?.successor;
  if (opportunity.caseId !== sale.id || !['SHARED', 'SABALAN_TERMS'].includes(opportunity.scope) || !successor ||
      sale.state !== 'COMMITTED' || opportunity.predecessorRevision !== sale.headRevision ||
      successor.predecessorRevision !== sale.headRevision || opportunity.gates.some(gate => gate.outcome === 'REJECT')) {
    throw new Error('Partner replacement correction is not pending against this Case');
  }
  const view = SabalanInternalRecordViewSchema.parse({ ...object(object(successor.internalProjection)?.accounting), state: 'COMMITTED' });
  if (view.owner.caseId !== sale.id || view.owner.revision !== successor.revision ||
      view.owner.integrityHash !== successor.integrityHash || view.recordId !== sale.internalRecordId) {
    throw new Error('Partner replacement source owner conflict');
  }
  if (!await readPartnerRevisionProjections(tx, view.owner)) throw new Error('Partner replacement canonical revision integrity conflict');
  const prepared = await preparePartnerFinancialSource({ view, partnerSellerId: sale.profile.userId }, view.owner);
  const historical = object(object(predecessor.sourceSnapshot)?.partnerPreparation);
  if (!prepared.ok || !historical || !RevisionRefSchema.safeParse(historical.owner).success ||
      !HashSchema.safeParse(historical.evidenceHash).success) throw new Error('Partner replacement financial source conflict');
  if (matchesFinancialPreparation(prepared.value, historical as PartnerFinancialPreparation)) return null;
  const id = `partner-replacement:${(await canonicalHash({ correctionId: opportunity.id, owner: view.owner })).slice(10)}`;
  const prior = await tx.accountingFinancialRecord.findUnique({ where: { id } });
  if (prior) {
    if (prior.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || prior.sourceId !== sale.internalRecordId ||
        object(prior.metadata)?.replacesRecordId !== predecessor.id ||
        await canonicalHash(object(prior.sourceSnapshot)?.partnerPreparation) !== await canonicalHash(prepared.value)) {
      throw new Error('Partner replacement replay evidence conflict');
    }
    return prior;
  }
  return tx.accountingFinancialRecord.create({ data: { id, kind: 'INVOICE_CANDIDATE', status: 'DRAFT',
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: sale.internalRecordId,
    amount: prepared.value.amount.amount, currency: prepared.value.amount.currency,
    sourceSnapshot: json({ partnerPreparation: prepared.value }), idempotencyKey: id, createdBy: input.actorId,
    metadata: json({ mode: PARTNER_REPLACEMENT_MODE, partnerCaseId: sale.id, correctionId: opportunity.id,
      replacesRecordId: predecessor.id, commitmentEventId: sale.commitmentEventId }) } });
}

export type PartnerSharedAccountingEffect = { replacement?: AccountingFinancialRecord;
  predecessor?: AccountingFinancialRecord; approval?: PartnerReplacementApprovalInput };

/** Net-sales adjustments and official payable replacement are independent.
 * All settlement and staged-approval checks run before any Case effect. */
export async function validatePartnerSharedAccountingEffect(tx: Prisma.TransactionClient, input: {
  caseId: string; internalRecordId: string; partnerSellerId: string; successor: unknown; correctionId?: string;
}): Promise<Result<PartnerSharedAccountingEffect>> {
  const invoices = await tx.accountingFinancialRecord.findMany({ where: {
    kind: 'INVOICE_CANDIDATE', OR: [
      { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: input.internalRecordId },
      { metadata: { path: ['partnerCaseId'], equals: input.caseId } },
    ],
  } });
  if (!invoices.length) return { ok: true, value: {} };
  const live = invoices.filter(row => row.status !== 'VOIDED' &&
    (object(row.metadata)?.mode !== PARTNER_REPLACEMENT_MODE || object(row.metadata)?.partnerApproval));
  if (!live.length) return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
  if (live.length !== 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const invoice = live[0];
  const view = SabalanInternalRecordViewSchema.safeParse({ ...object(input.successor), state: 'COMMITTED' });
  const historical = object(object(invoice.sourceSnapshot)?.partnerPreparation);
  if (!view.success || view.data.owner.caseId !== input.caseId || view.data.recordId !== input.internalRecordId ||
      invoice.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoice.sourceId !== input.internalRecordId ||
      invoice.contractId || invoice.customerId || !historical || !RevisionRefSchema.safeParse(historical.owner).success ||
      !HashSchema.safeParse(historical.evidenceHash).success || historical.internalRecordId !== input.internalRecordId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const prepared = await preparePartnerFinancialSource({ view: view.data, partnerSellerId: input.partnerSellerId }, view.data.owner);
  if (!prepared.ok) return prepared;
  if (!matchesFinancialPreparation(prepared.value, historical as PartnerFinancialPreparation)) {
    const replacement = invoices.find(row => object(row.metadata)?.mode === PARTNER_REPLACEMENT_MODE &&
      object(row.metadata)?.correctionId === input.correctionId && object(row.metadata)?.replacesRecordId === invoice.id);
    const staged = object(object(replacement?.metadata)?.partnerStagedApproval);
    if (!input.correctionId || !replacement || !staged || replacement.status !== 'ISSUED' ||
        !replacement.financiallyApprovedAt || !replacement.financiallyApprovedBy || !replacement.systemInvoiceNumber ||
        !replacement.systemInvoiceDate || !replacement.sepidarAmount?.equals(replacement.amount) ||
        replacement.currency !== prepared.value.amount.currency || !replacement.amount.equals(prepared.value.amount.amount)) {
      return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
    }
    const preparationHash = await canonicalHash(prepared.value);
    if (!await matchesPartnerStagedApproval(replacement, prepared.value) ||
        await canonicalHash(object(replacement.sourceSnapshot)?.partnerPreparation) !== preparationHash ||
        typeof staged.externalReference !== 'string' || typeof staged.commandId !== 'string' ||
        typeof staged.correlationId !== 'string' || typeof staged.downstreamNote !== 'string') {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const opportunity = await tx.partnerCorrectionOpportunity.findUniqueOrThrow({ where: { id: input.correctionId }, include: { gates: true } });
    const manager = opportunity.gates.find(gate => gate.kind === 'ACCOUNTING_MANAGER' && gate.outcome === 'APPROVE');
    if (!manager || manager.actorId !== staged.actorId || opportunity.gates.some(gate => gate.outcome === 'REJECT')) {
      return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
    }
    const authorization = await createAuditedPartnerAuthorization(tx, { actorId: manager.actorId,
      purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: staged.correlationId,
      reason: staged.downstreamNote || 'بازبینی اختیار تأییدکننده پیش از اثر اصلاح پرونده' },
    { correctionOpportunityId: opportunity.id }).authorize('FINANCIAL_APPROVE', { kind: 'CASE', id: input.caseId });
    if (!authorization.ok) return authorization;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const receivables = await tx.accountingReceivable.findMany({ where: { invoiceRecordId: invoice.id }, include: { paymentStatuses: true } });
    if (invoice.financiallyApprovedAt && receivables.length !== 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    for (const receivable of receivables) {
      const source = object(object(receivable.metadata)?.partnerReceivable);
      const debtor = object(historical.debtor), amount = object(source?.originalAmount);
      if (!source || !debtor || !amount || receivable.status === 'VOIDED' || receivable.contractId || receivable.customerId ||
          source.id !== receivable.id || source.invoiceRecordId !== invoice.id || source.internalRecordId !== input.internalRecordId ||
          source.partnerSellerId !== input.partnerSellerId || source.commercialAccountId !== debtor.commercialAccountId ||
          source.partnerSellerId !== debtor.partnerSellerId || receivable.currency !== invoice.currency ||
          amount.currency !== invoice.currency || typeof amount.amount !== 'string' ||
          !receivable.originalAmount.equals(invoice.amount) || !invoice.amount.equals(amount.amount) ||
          await canonicalHash(source.owner) !== await canonicalHash(historical.owner) ||
          await canonicalHash(source.paymentPlan) !== await canonicalHash(historical.paymentPlan)) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      const collected = await readPartnerCollections(tx, { receivableId: receivable.id,
        currency: receivable.currency, cutoff: clock.now, asOf: clock.now, preparation: historical as PartnerFinancialPreparation });
      if (collected !== '0' || !receivable.paidAmount.isZero() || receivable.paymentStatuses.some(payment =>
        payment.method === 'CHECK' && !['PENDING_HANDOVER', 'RETURNED', 'REPLACED'].includes(String(payment.checkStatus)))) {
        return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
      }
      if (!['OPEN', 'OVERDUE'].includes(receivable.status) || !receivable.remainingAmount.equals(receivable.originalAmount)) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
    }
    const tax = await tx.accountingTaxRecord.findMany({ where: { invoiceRecordId: invoice.id } });
    const fiscalHistory = await tx.accountingAuditLog.findFirst({ where: { recordId: invoice.id, entityType: 'AccountingTaxRecord',
      OR: ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION'].flatMap(status => [
        { beforeState: { path: ['submissionStatus'], equals: status } }, { afterState: { path: ['submissionStatus'], equals: status } },
      ]) }, select: { id: true } });
    if ((fiscalHistory || tax.some(row => row.submittedAt || row.acceptedAt || row.rejectedAt ||
        ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION'].includes(row.submissionStatus))) &&
        !staged.downstreamNote.trim()) return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
    return { ok: true, value: { replacement, predecessor: invoice, approval: {
      actorId: replacement.financiallyApprovedBy, commandId: staged.commandId, correlationId: staged.correlationId,
      approvedAt: replacement.financiallyApprovedAt, effectiveDate: replacement.systemInvoiceDate,
      externalReference: staged.externalReference, downstreamNote: staged.downstreamNote } } };
  }
  return { ok: true, value: {} };
}
