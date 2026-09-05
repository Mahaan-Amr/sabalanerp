import { Prisma, type AccountingReceivable } from '@prisma/client';
import type { PartnerEvent } from '@sabalanerp/partner-sales-contracts';
import { readPersistedPartnerEvents, ownsPartnerRevision } from '../events/persisted';
import { readPartnerOfficialPurchase } from './officialPurchase';
import { PartnerAccountingCommandError } from './errors';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, preparePartnerFinancialSource,
  type PartnerFinancialPreparation } from './source';
import { sum, negate } from '../reporting/money';
import { readPartnerCollections } from './collections';
import type { FinancialTrendPeriod } from '../../accountingFinancialTrend';
import { PARTNER_REPLACEMENT_MODE, matchesPartnerStagedApproval } from './sharedCorrection';
import { readPartnerRevisionProjections } from '../cases/lifecycle';
import { readPartnerInvoiceSource } from './invoiceSource';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'سابقه تعهد همکار کامل یا سازگار نیست؛ بررسی شواهد حسابداری لازم است.');

/** Caller supplies already-authorized, canonically validated invoice ids from
 * the same read transaction. A historical obligation requires its published
 * approval and dated collections; drafts never stand in for an official debt. */
async function publishedInvoices(tx: Prisma.TransactionClient, input: { invoiceIds: readonly string[]; asOf: Date }) {
  const invoices = await tx.accountingFinancialRecord.findMany({ where: { id: { in: [...input.invoiceIds] },
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, financiallyApprovedAt: { not: null, lte: input.asOf } },
    include: { receivables: true } });
  const caseIds = [...new Set(invoices.map(invoice => object(invoice.metadata)?.partnerCaseId).filter((id): id is string => typeof id === 'string'))];
  const cases = await tx.partnerSaleCase.findMany({ where: { id: { in: caseIds } }, include: { events: { orderBy: { sequence: 'asc' } } } });
  const eventsByCase = new Map(cases.map(row => [row.id, readPersistedPartnerEvents(row, row.events)]));
  const rows: Array<{ invoice: typeof invoices[number]; approval: Extract<PartnerEvent, { type: 'SABALAN_FINANCIAL_APPROVED' }>;
    effectiveAt: Date; preparation: PartnerFinancialPreparation }> = [];
  for (const invoice of invoices) {
    const metadata = object(invoice.metadata), caseId = metadata?.partnerCaseId;
    const approvalId = object(metadata?.partnerApproval)?.eventId;
    if (metadata?.mode === PARTNER_REPLACEMENT_MODE && !('partnerApproval' in metadata)) {
      const preparation = object(object(invoice.sourceSnapshot)?.partnerPreparation), owner = object(preparation?.owner);
      const opportunity = typeof metadata.correctionId === 'string' ? await tx.partnerCorrectionOpportunity.findUnique({
        where: { id: metadata.correctionId }, include: { save: { include: { successor: true } } },
      }) : null;
      const predecessor = typeof metadata.replacesRecordId === 'string' ? await tx.accountingFinancialRecord.findUnique({
        where: { id: metadata.replacesRecordId },
      }) : null;
      const events = typeof caseId === 'string' ? eventsByCase.get(caseId) : undefined;
      const sale = cases.find(row => row.id === caseId);
      const retainedAfterCaseVoid = invoice.status === 'VOIDED' && sale?.state === 'VOIDED' && events?.some(event =>
        event.type === 'CASE_VOIDED' && event.owner.revision === sale.headRevision && event.owner.integrityHash === sale.integrityHash &&
        event.recordedAt === invoice.voidedAt?.toISOString() && event.recordedAt === predecessor?.voidedAt?.toISOString());
      if (!opportunity || opportunity.caseId !== caseId || !['SHARED', 'SABALAN_TERMS'].includes(opportunity.scope) ||
          !owner || !opportunity.save || opportunity.save.successor.revision !== owner.revision ||
          opportunity.save.successor.integrityHash !== owner.integrityHash || !predecessor ||
          predecessor.sourceKind !== invoice.sourceKind || predecessor.sourceId !== invoice.sourceId ||
          (invoice.status !== 'ISSUED' && !retainedAfterCaseVoid) || invoice.receivables.length || !events ||
          events.some(event => event.type === 'CORRECTION_EFFECTIVE' && event.correctionId === opportunity.id) ||
          !await matchesPartnerStagedApproval(invoice, preparation)) throw conflict();
      continue;
    }
    const approval = typeof caseId === 'string' ? eventsByCase.get(caseId)?.find(event =>
      event.type === 'SABALAN_FINANCIAL_APPROVED' && event.eventId === approvalId) : undefined;
    if (!approval || approval.type !== 'SABALAN_FINANCIAL_APPROVED' || !invoice.systemInvoiceDate ||
        !['ISSUED', 'POSTED', 'VOIDED'].includes(invoice.status) || (invoice.status === 'VOIDED' && !invoice.voidedAt) ||
        invoice.receivables.length !== 1) throw conflict();
    if (Date.parse(approval.recordedAt) > input.asOf.getTime()) continue;
    let effectiveAt = invoice.systemInvoiceDate;
    if (metadata?.mode === PARTNER_REPLACEMENT_MODE) {
      const effect = eventsByCase.get(approval.owner.caseId)?.find(event => event.type === 'CORRECTION_EFFECTIVE' &&
        event.correctionId === metadata.correctionId && ownsPartnerRevision(event.owner, approval.owner));
      const predecessor = typeof metadata.replacesRecordId === 'string' ? await tx.accountingFinancialRecord.findUnique({
        where: { id: metadata.replacesRecordId },
      }) : null;
      if (!effect || effect.type !== 'CORRECTION_EFFECTIVE' || effect.recordedAt !== approval.recordedAt ||
          effect.effectiveDate !== approval.effectiveDate || !predecessor || predecessor.status !== 'VOIDED' ||
          predecessor.sourceKind !== invoice.sourceKind || predecessor.sourceId !== invoice.sourceId ||
          predecessor.voidedAt?.toISOString() !== effect.recordedAt) throw conflict();
      // Retail-only successors advance the Case without replacing its earlier
      // invoice. Compare the canonical commercial evidence, not revision equality.
      const historical = object(object(predecessor.sourceSnapshot)?.partnerPreparation) as PartnerFinancialPreparation | undefined;
      const predecessorViews = await readPartnerRevisionProjections(tx, effect.predecessor);
      if (!historical || !predecessorViews) throw conflict();
      const prepared = await preparePartnerFinancialSource({ view: { ...predecessorViews.accounting, state: 'COMMITTED' },
        partnerSellerId: historical.debtor.partnerSellerId }, effect.predecessor);
      if (!prepared.ok || !matchesFinancialPreparation(prepared.value, historical)) throw conflict();
      effectiveAt = new Date(effect.recordedAt);
    }
    const canonical = await readPartnerInvoiceSource(tx, invoice, approval.owner.caseId);
    rows.push({ invoice, approval, effectiveAt, preparation: canonical.preparation });
  }
  return rows;
}

export async function readPartnerOutstandingHistory(tx: Prisma.TransactionClient, input: {
  invoiceIds: readonly string[]; cutoff: Date; asOf: Date;
}) {
  const rows: Array<Omit<AccountingReceivable, 'paidAmount' | 'remainingAmount' | 'originalAmount' | 'status' | 'metadata'> & {
    paidAmount: string; remainingAmount: string; originalAmount: string; status: string; metadata: Record<string, unknown>;
  }> = [];
  const activeCases = new Set<string>();
  for (const { invoice, approval, effectiveAt } of await publishedInvoices(tx, input)) {
    if (effectiveAt >= input.cutoff ||
        (invoice.voidedAt && invoice.voidedAt < input.cutoff)) continue;
    if (activeCases.has(approval.owner.caseId)) throw conflict();
    activeCases.add(approval.owner.caseId);
    const purchase = await readPartnerOfficialPurchase(tx, { internalRecordId: invoice.sourceId!, approval,
      cutoff: new Date(input.cutoff.getTime() - 1), asOf: input.asOf, voided: false });
    if (!purchase.covered || !purchase.official) throw conflict();
    const official = purchase.official, receivable = invoice.receivables[0];
    if (official.receivable.id !== receivable.id) throw conflict();
    if (official.balance.amount === '0') continue;
    rows.push({ ...receivable, paidAmount: official.received.amount, remainingAmount: official.balance.amount,
      originalAmount: official.receivable.originalAmount.amount, status: official.status,
      metadata: { ...object(receivable.metadata), historicalOutstandingAt: input.cutoff.toISOString() } });
  }
  return rows;
}

/** Separate exact-currency series; ordinary contract/Rial chart stays unchanged. */
export async function readPartnerAccountingTrend(tx: Prisma.TransactionClient, input: {
  invoiceIds: readonly string[]; periods: readonly FinancialTrendPeriod[]; asOf: Date;
}) {
  const published = await publishedInvoices(tx, input);
  const currencies = [...new Set(published.map(({ invoice }) => invoice.currency))].sort();
  const series: Array<{ currency: string; points: Array<{ periodKey: string; label: string; startsAt: string; endsAt: string;
    invoiced: string; received: string; outstanding: string }> }> = [];
  for (const currency of currencies) {
    const selected = published.filter(({ invoice }) => invoice.currency === currency);
    const points: typeof series[number]['points'] = [];
    for (const period of input.periods) {
      const within = (date: Date) => date >= period.startsAt && date < period.endsAt;
      const invoiced = sum(selected.flatMap(({ invoice, effectiveAt }) => [
        ...(within(effectiveAt) ? [invoice.amount.toString()] : []),
        ...(invoice.voidedAt && within(invoice.voidedAt) ? [negate(invoice.amount.toString())] : []),
      ]));
      const receivedAmounts: string[] = [];
      for (const { invoice, approval, preparation } of selected) {
        const before = await readPartnerCollections(tx, { receivableId: approval.accountingReceivableId, currency,
          cutoff: new Date(period.startsAt.getTime() - 1), asOf: input.asOf, preparation });
        const after = await readPartnerCollections(tx, { receivableId: approval.accountingReceivableId, currency,
          cutoff: new Date(period.endsAt.getTime() - 1), asOf: input.asOf, preparation });
        if (before === null || after === null || invoice.receivables[0].id !== approval.accountingReceivableId) throw conflict();
        receivedAmounts.push(after, negate(before));
      }
      const outstanding = await readPartnerOutstandingHistory(tx, { invoiceIds: selected.map(({ invoice }) => invoice.id),
        cutoff: period.endsAt, asOf: input.asOf });
      points.push({ periodKey: period.key, label: period.label, startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString(),
        invoiced, received: sum(receivedAmounts), outstanding: sum(outstanding.map(row => row.remainingAmount)) });
    }
    series.push({ currency, points });
  }
  return series;
}

export function accountingCurrencyTotals<T extends { currency: string }>(rows: readonly T[], amount: (row: T) => string) {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const currency = row.currency === 'ریال' ? 'IRR' : row.currency === 'تومان' ? 'IRT' : row.currency;
    const values = groups.get(currency) || [];
    values.push(amount(row)); groups.set(currency, values);
  }
  const amountsByCurrency = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amounts]) => ({ currency, amount: sum(amounts) }));
  return { amount: amountsByCurrency.length > 1 ? null : amountsByCurrency[0]?.amount || '0', amountsByCurrency };
}
