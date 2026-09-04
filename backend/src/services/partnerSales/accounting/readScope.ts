import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { RevisionRefSchema } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readCurrentPartnerCaseViews, readPartnerRevisionProjections } from '../cases/lifecycle';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, preparePartnerFinancialSource, type PartnerFinancialPreparation } from './source';
import { subtract } from '../reporting/money';
import { PartnerAccountingCommandError } from './errors';
import { PartnerCollectionIntegrityError, readPartnerCollections } from './collections';
import { partnerCheckTransitions } from './paymentPolicy';
import { readPartnerAccountingCapabilities } from './capabilities';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { partnerTaxTransitions } from './taxPolicy';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { PARTNER_ACCOUNTING_MARKER_JSON_PATH } from './provenance';
import { assertPartnerAccountingWitnesses as assertWitnesses, readPartnerReceivableEvidence } from './receivableEvidence';
import { assertPartnerTaxEvidence, assertSinglePartnerTaxRecord } from './taxEvidence';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
type ListRow = { id: string; invoiceRecordId?: string | null; receivableId?: string | null;
  recordId?: string | null; entityType?: string | null; entityId?: string | null };
type ListKind = 'FINANCIAL' | 'RECEIVABLE' | 'PAYMENT' | 'TAX' | 'AUDIT';
type PartnerAccountingContext = { caseId: string; caseNumber: string; internalRecordNumber: string;
  partnerSellerId: string; commercialAccountId: string; debtor: { displayName: string }; revision: number; actionUrl: string };
type AccountingRowContext = { sourceKind?: string; partnerContext?: PartnerAccountingContext;
  partnerFinancialSource?: PartnerFinancialPreparation['totals']; partnerActions?: {
    registerReceipt?: boolean; reverseReceipt?: boolean; checkStatuses?: string[]; taxStatuses?: string[];
  } };

export type AccountingReadActor = { userId: string };
export type AccountingReadScope = Awaited<ReturnType<typeof createScope>>;

/** One request, one authorization/data snapshot. Ordinary Accounting authority
 * does not imply permission to read a Partner Case. Predicates are applied before
 * pagination, aggregate calculations and independent focused-record lookup. */
export function withAccountingReadScope<T>(database: PrismaClient, actor: AccountingReadActor | undefined,
  read: (scope: AccountingReadScope) => Promise<T>): Promise<T> {
  if (actor) return readPartnerSnapshot(database, async tx => read(await createScope(tx, actor)));
  return database.$transaction(async tx => read(await createScope(tx, actor)), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000,
  });
}

async function createScope(database: Prisma.TransactionClient, actor: AccountingReadActor | undefined) {
  const cases = await database.partnerSaleCase.findMany({ orderBy: { id: 'asc' }, select: {
    id: true, caseNumber: true, internalRecordId: true, internalRecord: { select: { recordNumber: true } },
    customerContractId: true, customerContract: { select: { contractNumber: true } }, profile: { select: { userId: true } } } });
  const allowedInternalIds: string[] = [];
  const writableCases = new Set<string>();
  let canManagePayments = false;
  let canManageTax = false;
  if (actor) {
    const authority = createAuditedPartnerAuthorization(database, { actorId: actor.userId, purpose: 'ACCOUNTING', channel: 'LIST' },
      { correlationId: randomUUID(), reason: 'بررسی دسترسی اقدامات حسابداری پرونده' });
    for (const row of cases) {
      if ((await authority.authorize('ACCOUNTING_READ', { kind: 'CASE', id: row.id })).ok) {
        allowedInternalIds.push(row.internalRecordId);
        if ((await authority.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: row.id })).ok) writableCases.add(row.id);
      }
    }
    const capabilities = await readPartnerAccountingCapabilities(database, actor.userId);
    canManagePayments = capabilities.payments;
    canManageTax = capabilities.tax;
  }
  const partnerContracts = cases.map(row => row.customerContractId);
  const ordinaryContract = { OR: [{ contractId: null }, { contractId: { notIn: partnerContracts } }] };
  const markerPath = PARTNER_ACCOUNTING_MARKER_JSON_PATH;
  // Discriminators are not sufficient for imported/partial records. Retained
  // private evidence at any nested JSON depth also prevents ordinary fallback.
  const markedRows = await database.$queryRaw<Array<{ kind: ListKind; id: string }>>`
    SELECT 'FINANCIAL' AS kind, id FROM accounting_financial_records
      WHERE jsonb_build_array(metadata, "sourceSnapshot") @? ${markerPath}::jsonpath
    UNION ALL SELECT 'RECEIVABLE', id FROM accounting_receivables WHERE metadata @? ${markerPath}::jsonpath
    UNION ALL SELECT 'PAYMENT', id FROM accounting_payment_statuses WHERE metadata @? ${markerPath}::jsonpath
    UNION ALL SELECT 'TAX', id FROM accounting_tax_records WHERE metadata @? ${markerPath}::jsonpath
    UNION ALL SELECT 'AUDIT', id FROM accounting_audit_logs
      WHERE jsonb_build_array("beforeState", "afterState") @? ${markerPath}::jsonpath`;
  const markedIds = (kind: ListKind) => markedRows.filter(row => row.kind === kind).map(row => row.id);
  const ordinaryFinancial: Prisma.AccountingFinancialRecordWhereInput = { AND: [
    { sourceKind: { not: PARTNER_INTERNAL_ACCOUNTING_SOURCE }, id: { notIn: markedIds('FINANCIAL') } },
  ] };
  const partnerFinancial: Prisma.AccountingFinancialRecordWhereInput = {
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: { in: allowedInternalIds }, contractId: null, customerId: null,
  };
  const financialAccess: Prisma.AccountingFinancialRecordWhereInput = { AND: [ordinaryContract, { OR: [
    ordinaryFinancial, partnerFinancial,
  ] }] };
  const receivableAccess: Prisma.AccountingReceivableWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [{ id: { notIn: markedIds('RECEIVABLE') } }, { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] },
    { invoiceRecord: partnerFinancial },
  ] }] };
  const paymentAccess: Prisma.AccountingPaymentStatusWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [{ receivableId: null, id: { notIn: markedIds('PAYMENT') } }] },
    { AND: [{ id: { notIn: markedIds('PAYMENT') } },
      { receivable: { AND: [receivableAccess, { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] } }] },
    { receivable: { AND: [receivableAccess, { invoiceRecord: partnerFinancial }] } },
  ] }] };
  const taxAccess: Prisma.AccountingTaxRecordWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [{ id: { notIn: markedIds('TAX') } }, { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] },
    { invoiceRecord: partnerFinancial },
  ] }] };
  // Audit has polymorphic references, not foreign keys. Resolve the same denied
  // owners once in this snapshot; audit bodies are never returned for a hidden owner.
  const [hiddenRecords, hiddenReceivables, hiddenPayments, hiddenTax] = await Promise.all([
    database.accountingFinancialRecord.findMany({ where: { NOT: financialAccess }, select: { id: true } }),
    database.accountingReceivable.findMany({ where: { NOT: receivableAccess }, select: { id: true } }),
    database.accountingPaymentStatus.findMany({ where: { NOT: paymentAccess }, select: { id: true } }),
    database.accountingTaxRecord.findMany({ where: { NOT: taxAccess }, select: { id: true } }),
  ]);
  const recordIds = hiddenRecords.map(row => row.id);
  const hiddenEntityIds = [...recordIds, ...hiddenReceivables.map(row => row.id),
    ...hiddenPayments.map(row => row.id), ...hiddenTax.map(row => row.id)];
  const auditAccess: Prisma.AccountingAuditLogWhereInput = { AND: [ordinaryContract,
    { OR: [{ recordId: null }, { recordId: { notIn: recordIds } }] },
    { OR: [{ entityId: null }, { entityId: { notIn: hiddenEntityIds } }] },
  ] };
  const contextByInvoice = new Map<string, PartnerAccountingContext>();
  const healthyCases = new Set<string>();
  const committedCases = new Set<string>();
  const frozenCases = new Set<string>();
  const preparationByInvoice = new Map<string, PartnerFinancialPreparation>();
  const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'شواهد صورتحساب همکار نیاز به بررسی دارد؛ پرونده را در حسابداری بررسی کنید.');
  const contextualize = async <T extends ListRow>(kind: ListKind, rows: T[]): Promise<Array<T & AccountingRowContext>> => {
    const paymentIds = kind === 'AUDIT' ? rows.filter(row => row.entityType === 'AccountingPaymentStatus')
      .flatMap(row => row.entityId ? [row.entityId] : []) : [];
    const payments = paymentIds.length ? await database.accountingPaymentStatus.findMany({ where: { id: { in: paymentIds } },
      select: { id: true, receivableId: true } }) : [];
    const receivableIds = [...rows.flatMap(row => row.receivableId ? [row.receivableId] : []),
      ...payments.flatMap(row => row.receivableId ? [row.receivableId] : [])];
    const receivables = receivableIds.length ? await database.accountingReceivable.findMany({ where: { id: { in: receivableIds } },
      select: { id: true, invoiceRecordId: true } }) : [];
    const invoiceFor = (row: T) => kind === 'FINANCIAL' ? row.id : row.invoiceRecordId || row.recordId ||
      (kind === 'AUDIT' && row.entityType === 'AccountingFinancialRecord' ? row.entityId : null) ||
      receivables.find(receivable => receivable.id === (row.receivableId || payments.find(payment => payment.id === row.entityId)?.receivableId))?.invoiceRecordId;
    const ids = [...new Set(rows.flatMap(row => invoiceFor(row) ? [invoiceFor(row)!] : []))];
    const invoices = ids.length ? await database.accountingFinancialRecord.findMany({ where: { id: { in: ids },
      sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE } }) : [];
    for (const invoice of invoices) {
      if (contextByInvoice.has(invoice.id)) continue;
      const row = cases.find(candidate => candidate.internalRecordId === invoice.sourceId);
      const preparation = object(invoice.sourceSnapshot)?.partnerPreparation as PartnerFinancialPreparation | undefined;
      const owner = RevisionRefSchema.safeParse(preparation?.owner);
      if (!row || !allowedInternalIds.includes(row.internalRecordId) || !owner.success || owner.data.caseId !== row.id ||
          object(invoice.metadata)?.partnerCaseId !== row.id) throw conflict();
      if (!healthyCases.has(row.id)) {
        const current = await readCurrentPartnerCaseViews(database, row.id);
        if (!current) throw conflict();
        if (current.row.state === 'COMMITTED') committedCases.add(row.id);
        if (await partnerPredecessorIsFrozen(database, row.id, current.row.headRevision)) frozenCases.add(row.id);
        healthyCases.add(row.id);
      }
      const views = await readPartnerRevisionProjections(database, owner.data);
      if (!views) throw conflict();
      const prepared = await preparePartnerFinancialSource({ view: { ...views.accounting, state: 'COMMITTED' },
        partnerSellerId: row.profile.userId }, owner.data);
      if (!prepared.ok || !preparation || !matchesFinancialPreparation(prepared.value, preparation) ||
          invoice.currency !== prepared.value.amount.currency || subtract(invoice.amount.toString(), prepared.value.amount.amount) !== '0') throw conflict();
      contextByInvoice.set(invoice.id, { caseId: row.id, caseNumber: views.accounting.caseNumber,
        internalRecordNumber: views.accounting.recordNumber, partnerSellerId: row.profile.userId,
        commercialAccountId: views.accounting.commercialAccountId, debtor: views.accounting.debtor,
        revision: owner.data.revision, actionUrl: `/dashboard/accounting/invoice-candidates?search=${encodeURIComponent(views.accounting.caseNumber)}` });
      preparationByInvoice.set(invoice.id, preparation);
    }
    return rows.map(row => {
      const context = contextByInvoice.get(invoiceFor(row) || '');
      if (!context) return row;
      const invoice = invoices.find(invoice => invoice.id === invoiceFor(row));
      const writable = canManagePayments && writableCases.has(context.caseId) && committedCases.has(context.caseId) &&
        Boolean(invoice && ['ISSUED', 'POSTED'].includes(invoice.status));
      const payment = row as T & { method?: string; status?: string; checkStatus?: keyof typeof partnerCheckTransitions | null };
      const taxStatus = (row as T & { submissionStatus?: keyof typeof partnerTaxTransitions }).submissionStatus;
      const taxWritable = canManageTax && writableCases.has(context.caseId) && committedCases.has(context.caseId) &&
        Boolean(invoice && ['ISSUED', 'POSTED'].includes(invoice.status) && object(invoice.metadata)?.partnerApproval);
      return { ...row, sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, partnerContext: context,
        ...(['PAYMENT', 'RECEIVABLE'].includes(kind) ? { partnerActions: {
          registerReceipt: kind === 'RECEIVABLE' && writable && !frozenCases.has(context.caseId) && !['VOIDED', 'SETTLED'].includes(payment.status || ''),
          reverseReceipt: kind === 'PAYMENT' && writable && ['CASH', 'BANK_TRANSFER'].includes(payment.method || '') &&
            ['RECEIVED', 'RECONCILED'].includes(payment.status || ''),
          checkStatuses: kind === 'PAYMENT' && writable && payment.method === 'CHECK' && payment.checkStatus
            ? partnerCheckTransitions[payment.checkStatus] || [] : [],
        } } : {}),
        ...(kind === 'TAX' ? { partnerFinancialSource: preparationByInvoice.get(invoice!.id)!.totals,
          partnerActions: { taxStatuses: taxWritable && taxStatus ? partnerTaxTransitions[taxStatus].filter(status =>
            !frozenCases.has(context.caseId) || !['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(status)) : [] } } : {}),
      };
    });
  };
  // Validate the authorized population once, before any endpoint can aggregate,
  // paginate or serialize it. Dashboard and report reads share this boundary.
  const authorizedInvoices = await database.accountingFinancialRecord.findMany({ where: partnerFinancial });
  await contextualize('FINANCIAL', authorizedInvoices);
  const invoiceIds = authorizedInvoices.map(row => row.id);
  const [ownedReceivables, ownedPayments, ownedTaxes] = await Promise.all([
    database.accountingReceivable.findMany({ where: { invoiceRecordId: { in: invoiceIds } } }),
    database.accountingPaymentStatus.findMany({ where: { receivable: { invoiceRecordId: { in: invoiceIds } } } }),
    database.accountingTaxRecord.findMany({ where: { invoiceRecordId: { in: invoiceIds } } }),
  ]);
  const invoiceByEntity = new Map(invoiceIds.map(id => [id, id]));
  const asOf = new Date();
  for (const receivable of ownedReceivables) {
    const preparation = preparationByInvoice.get(receivable.invoiceRecordId!)!;
    readPartnerReceivableEvidence(receivable, preparation);
    let collected;
    try {
      collected = await readPartnerCollections(database, { receivableId: receivable.id, currency: receivable.currency,
        cutoff: asOf, asOf, preparation });
    } catch (error) {
      if (error instanceof PartnerCollectionIntegrityError) throw conflict();
      throw error;
    }
    if (collected === null || subtract(receivable.paidAmount.toString(), collected) !== '0') throw conflict();
    const remaining = subtract(receivable.originalAmount.toString(), collected);
    if (remaining.startsWith('-') || subtract(receivable.remainingAmount.toString(), remaining) !== '0') throw conflict();
    const invoice = authorizedInvoices.find(row => row.id === receivable.invoiceRecordId)!;
    const statuses = invoice.status === 'VOIDED' && collected === '0' ? ['VOIDED']
      : remaining === '0' ? ['SETTLED'] : collected === '0' ? ['OPEN', 'OVERDUE'] : ['PARTIALLY_PAID', 'OVERDUE'];
    if (!statuses.includes(receivable.status)) throw conflict();
    invoiceByEntity.set(receivable.id, receivable.invoiceRecordId!);
  }
  for (const payment of ownedPayments) {
    const invoiceId = invoiceByEntity.get(payment.receivableId!)!;
    const preparation = preparationByInvoice.get(invoiceId)!;
    if (payment.contractId || payment.currency !== preparation.amount.currency) throw conflict();
    assertWitnesses(payment.metadata, preparation);
    invoiceByEntity.set(payment.id, invoiceId);
  }
  const taxesByInvoice = new Map<string, typeof ownedTaxes>();
  for (const tax of ownedTaxes) {
    const siblings = taxesByInvoice.get(tax.invoiceRecordId!) || [];
    siblings.push(tax);
    assertSinglePartnerTaxRecord(siblings);
    taxesByInvoice.set(tax.invoiceRecordId!, siblings);
    assertPartnerTaxEvidence(tax, tax.invoiceRecordId!, preparationByInvoice.get(tax.invoiceRecordId!)!);
    invoiceByEntity.set(tax.id, tax.invoiceRecordId!);
  }
  // Audit references are polymorphic and legacy snapshots can be orphaned.
  // Select Partner-bearing JSON in the database, not after user pagination. An
  // unknown or ordinary reference cannot authorize a private snapshot.
  const markedAuditIds = markedIds('AUDIT');
  const markedAudits = markedAuditIds.length ? await database.accountingAuditLog.findMany({
    where: { id: { in: markedAuditIds } },
  }) : [];
  const rejectedAuditIds: string[] = [];
  for (const audit of markedAudits) {
    const references = [audit.recordId, audit.entityId].filter((id): id is string => Boolean(id));
    const owners = references.map(id => invoiceByEntity.get(id));
    const invoiceId = owners[0];
    if (!invoiceId || owners.some(owner => owner !== invoiceId) || audit.contractId) {
      rejectedAuditIds.push(audit.id); continue;
    }
    const preparation = preparationByInvoice.get(invoiceId)!;
    assertWitnesses(audit.beforeState, preparation);
    assertWitnesses(audit.afterState, preparation);
  }
  auditAccess.AND = [...auditAccess.AND as Prisma.AccountingAuditLogWhereInput[], { id: { notIn: rejectedAuditIds } }];
  return { database,
    partnerAccountingIncluded: authorizedInvoices.length > 0,
    contextualize,
    search: async (kind: ListKind | 'CORRECTION', ordinaryContractIds: string[], text: string) => {
      const normalized = text.toLocaleLowerCase();
      const matchedSources = cases.filter(row => allowedInternalIds.includes(row.internalRecordId) &&
        [row.caseNumber, row.internalRecord.recordNumber, row.customerContract.contractNumber].some(value => value.toLocaleLowerCase().includes(normalized)))
        .map(row => row.internalRecordId);
      const invoices = await database.accountingFinancialRecord.findMany({ where: { AND: [financialAccess,
        { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE }, { OR: [
          { sourceId: { in: matchedSources } },
          { sourceSnapshot: { path: ['partnerPreparation', 'debtor', 'identity', 'displayName'], string_contains: text } },
        ] }] }, select: { id: true } });
      const invoiceIds = invoices.map(row => row.id);
      let partner: Record<string, unknown>;
      if (kind === 'FINANCIAL') partner = { id: { in: invoiceIds } };
      else if (kind === 'RECEIVABLE' || kind === 'TAX') partner = { invoiceRecordId: { in: invoiceIds } };
      else if (kind === 'PAYMENT') partner = { receivable: { invoiceRecordId: { in: invoiceIds } } };
      else if (kind === 'CORRECTION') partner = { recordId: { in: invoiceIds } };
      else {
        const [receivables, payments, taxes] = await Promise.all([
          database.accountingReceivable.findMany({ where: { invoiceRecordId: { in: invoiceIds } }, select: { id: true } }),
          database.accountingPaymentStatus.findMany({ where: { receivable: { invoiceRecordId: { in: invoiceIds } } }, select: { id: true } }),
          database.accountingTaxRecord.findMany({ where: { invoiceRecordId: { in: invoiceIds } }, select: { id: true } }),
        ]);
        partner = { OR: [{ recordId: { in: invoiceIds } }, { entityId: { in: [...invoiceIds,
          ...receivables.map(row => row.id), ...payments.map(row => row.id), ...taxes.map(row => row.id)] } }] };
      }
      return { OR: [{ contractId: { in: ordinaryContractIds } }, partner] };
    },
    financial: (where: Prisma.AccountingFinancialRecordWhereInput = {}): Prisma.AccountingFinancialRecordWhereInput => ({ AND: [financialAccess, where] }),
    receivable: (where: Prisma.AccountingReceivableWhereInput = {}): Prisma.AccountingReceivableWhereInput => ({ AND: [receivableAccess, where] }),
    payment: (where: Prisma.AccountingPaymentStatusWhereInput = {}): Prisma.AccountingPaymentStatusWhereInput => ({ AND: [paymentAccess, where] }),
    tax: (where: Prisma.AccountingTaxRecordWhereInput = {}): Prisma.AccountingTaxRecordWhereInput => ({ AND: [taxAccess, where] }),
    audit: (where: Prisma.AccountingAuditLogWhereInput = {}): Prisma.AccountingAuditLogWhereInput => ({ AND: [auditAccess, where] }),
    correction: (where: Prisma.AccountingCorrectionRequestWhereInput = {}): Prisma.AccountingCorrectionRequestWhereInput => ({ AND: [ordinaryContract,
      { OR: [{ recordId: null }, { recordId: { notIn: recordIds } }] }, where] }),
  };
}
