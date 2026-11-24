import { readAccountingCommercialRoots, readAccountingCommercialState, readPartnerCommercialState } from '../cases/commercialLifecycle';
import { randomUUID } from 'node:crypto';
import { Prisma, type AccountingFinancialRecord, type PrismaClient } from '@prisma/client';
import { canonicalJson, RevisionRefSchema, type PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { appendAuthorizationDecisions, type AuthorizationDecisionAudit } from '../../effectiveAuthorization/audit';
import { resolvePartnerAccountingScopedAuthority } from '../authorization/centralAuthority';
import { readCurrentPartnerCaseViews, readCurrentPartnerCaseViewsBatch, readPartnerRevisionProjections } from '../cases/lifecycle';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, preparePartnerFinancialSource, type PartnerFinancialPreparation, type PartnerAccountingSource } from './source';
import { subtract } from '../reporting/money';
import { PartnerAccountingCommandError } from './errors';
import { PartnerCollectionIntegrityError, sumPartnerCollections } from './collections';
import { partnerCheckTransitions } from './paymentPolicy';
import { readPartnerAccountingCapabilities } from './capabilities';
import { readPartnerSnapshot, retryReadSnapshot } from '../authorization/readSnapshot';
import { partnerTaxTransitions } from './taxPolicy';
import { partnerPredecessorIsFrozen, readFrozenPartnerPredecessors } from '../corrections/mutationFreeze';
import { PARTNER_ACCOUNTING_MARKER_JSON_PATH } from './provenance';
import { assertPartnerAccountingWitnesses as assertWitnesses, readPartnerReceivableEvidence } from './receivableEvidence';
import { assertPartnerTaxEvidence, assertSinglePartnerTaxRecord } from './taxEvidence';
import { readCurrentSabalanPlanEvidence, resolveCurrentSabalanPlan, resolveInvoiceSabalanPlan } from './sabalanPlanEvidence';
import { readAuthorizedPartnerAuditWitnesses } from '../../accountingReadProjection';
import { batchAccountingCaseAuthority, type AccountingCaseAuthority } from './batchCaseAuthority';
import { groupPaymentsByReceivable } from './groupPaymentsByReceivable';
import { financialReviewOwners } from './financialReviewSelection';
import { countAccountingReadRows, measureAccountingReadPhase, startAccountingReadPhase } from '../../accountingReadTiming';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
type ListRow = { id: string; invoiceRecordId?: string | null; receivableId?: string | null;
  recordId?: string | null; entityType?: string | null; entityId?: string | null };
type ListKind = 'FINANCIAL' | 'RECEIVABLE' | 'PAYMENT' | 'TAX' | 'AUDIT';
type PartnerAccountingContext = { caseId: string; caseNumber: string; trackingNumber?: number; customerContractNumber: string; internalRecordNumber: string;
  partnerSellerId: string; commercialAccountId: string; debtor: { displayName: string };
  endCustomer: { displayName: string }; revision: number; actionUrl: string; accountingWritable: boolean; accountingDraftDeletionWritable?: boolean; caseState?: string; commercialStatus?: string };
type AccountingRowContext = { sourceKind?: string; partnerContext?: PartnerAccountingContext;
  partnerFinancialSource?: PartnerFinancialPreparation['totals']; partnerActions?: {
    registerReceipt?: boolean; reverseReceipt?: boolean; checkStatuses?: string[]; taxStatuses?: string[];
  } };

export const readAccountingSnapshotTime = async (database: Prisma.TransactionClient) =>
  (await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;

export type AccountingReadActor = { userId: string };
export type AccountingReadScope = Awaited<ReturnType<typeof createScope>>;
type AccountingReadSelection = { focusedCaseId?: string; ordinaryOnly?: boolean;
  financialRecordId?: string; auditRecordId?: string; purpose?: 'REGISTER' | 'CORRECTIONS' };

/** One request, one authorization/data snapshot. Ordinary Accounting authority
 * does not imply permission to read a Partner Case. Predicates are applied before
 * pagination, aggregate calculations and independent focused-record lookup. */
export function withAccountingReadScope<T>(database: PrismaClient, actor: AccountingReadActor | undefined,
  read: (scope: AccountingReadScope) => Promise<T>, selection: AccountingReadSelection = {}): Promise<T> {
  const readInScope = async (tx: Prisma.TransactionClient) =>
    read(await measureAccountingReadPhase('scopeSetup', () => createScope(tx, actor, selection)));
  if (actor) return readPartnerSnapshot(database, readInScope, {
    multiRootAuthority: Boolean(selection.focusedCaseId),
  });
  return retryReadSnapshot(() => database.$transaction(readInScope, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000,
  }));
}

async function createScope(database: Prisma.TransactionClient, actor: AccountingReadActor | undefined,
  selection: AccountingReadSelection = {}) {
  const finishCaseSelection = startAccountingReadPhase('population');
  const reviewRecordId = selection.financialRecordId ?? selection.auditRecordId;
  const canReadAudit = !selection.focusedCaseId && !selection.ordinaryOnly &&
    !selection.financialRecordId && !selection.purpose;
  const canReadCorrections = !selection.focusedCaseId && !selection.ordinaryOnly &&
    !reviewRecordId && selection.purpose !== 'REGISTER';
  // Bound live authority and expensive Case evidence reconstruction to the
  // review's relational owners. Keep global provenance/hidden-owner predicates:
  // a focused ordinary row or polymorphic audit must not gain private fallback.
  const reviewOwners = reviewRecordId
    ? await financialReviewOwners(database, reviewRecordId, Boolean(selection.auditRecordId)) : undefined;
  const caseRows = await database.partnerSaleCase.findMany({ where: { internalRecordId: { not: null },
    customerContractId: { not: null }, ...(selection.focusedCaseId ? { id: selection.focusedCaseId } : {}) }, orderBy: { id: 'asc' }, select: {
    id: true, state: true, caseNumber: true, trackingCode: { select: { number: true } }, internalRecordId: true, internalRecord: { select: { recordNumber: true } },
    customerContractId: true, customerContract: { select: { contractNumber: true } },
    customer: { select: { companyName: true, firstName: true, lastName: true } },
    profile: { select: { userId: true } } } });
  const cases = caseRows.filter((row): row is typeof row & { internalRecordId: string; customerContractId: string;
    internalRecord: NonNullable<typeof row.internalRecord>; customerContract: NonNullable<typeof row.customerContract> } =>
    Boolean(row.internalRecordId && row.customerContractId && row.internalRecord && row.customerContract));
  finishCaseSelection();
  const allowedInternalIds: string[] = [];
  const allowedCaseIds = new Set<string>();
  const writableCases = new Set<string>();
  let canManagePayments = false;
  let canManageTax = false;
  let actorAuthority: ReturnType<typeof resolvePartnerAccountingScopedAuthority> | undefined;
  const readFocusedActorAuthority: typeof resolvePartnerAccountingScopedAuthority = (tx, input) =>
    actorAuthority ??= resolvePartnerAccountingScopedAuthority(tx, input);
  let caseAuthority: AccountingCaseAuthority | undefined;
  if (actor && !selection.ordinaryOnly) {
    const finishAuthorization = startAccountingReadPhase('authorization');
    // The central actor grants and workspace bridge are identical for every
    // Case in this repeatable-read snapshot. Resource locks and evidence,
    // expiry checks and a distinct audited decision still apply to each Case.
    const decisions: AuthorizationDecisionAudit[] = [];
    const authorityCases = reviewOwners ? cases.filter(row => reviewOwners.internalRecordIds.has(row.internalRecordId)
      || reviewOwners.contractIds.has(row.customerContractId)) : cases;
    if (!selection.focusedCaseId) caseAuthority = await batchAccountingCaseAuthority(database, actor.userId, authorityCases.map(row => row.id));
    const authority = createAuditedPartnerAuthorization(database, { actorId: actor.userId, purpose: 'ACCOUNTING', channel: 'LIST' },
      { correlationId: randomUUID(), reason: 'بررسی دسترسی اقدامات حسابداری پرونده' }, undefined, readFocusedActorAuthority,
      async decision => { decisions.push(decision); }, caseAuthority?.source);
    for (const row of authorityCases) {
      if ((await authority.authorize('ACCOUNTING_READ', { kind: 'CASE', id: row.id })).ok) {
        allowedInternalIds.push(row.internalRecordId);
        allowedCaseIds.add(row.id);
        if ((await authority.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: row.id })).ok) writableCases.add(row.id);
      }
    }
    await measureAccountingReadPhase('authorizationAudit', () => appendAuthorizationDecisions(database, decisions));
    const capabilities = await readPartnerAccountingCapabilities(database, actor.userId);
    canManagePayments = capabilities.payments;
    canManageTax = capabilities.tax;
    finishAuthorization();
  }
  const finishPopulation = startAccountingReadPhase('population');
  const finishProvenance = startAccountingReadPhase('provenance');
  const partnerContracts = cases.map(row => row.customerContractId);
  const ordinaryContract = { OR: [{ contractId: null }, { contractId: { notIn: partnerContracts } }] };
  // Static, code-owned SQL literal lets generic prepared plans prove the
  // partial-index predicate too. Never interpolate request data here.
  const markerPath = Prisma.raw(`'${PARTNER_ACCOUNTING_MARKER_JSON_PATH}'::jsonpath`);
  // Discriminators are not sufficient for imported/partial records. Retained
  // private evidence at any nested JSON depth also prevents ordinary fallback.
  const markedRows: Array<{ kind: ListKind; id: string }> = selection.focusedCaseId ? [] : await database.$queryRaw<Array<{ kind: ListKind; id: string }>>`
    SELECT 'FINANCIAL' AS kind, id FROM accounting_financial_records
      WHERE metadata @? ${markerPath} OR CASE
        WHEN "sourceKind" = 'SALES_CONTRACT' AND "contractId" IS NOT NULL AND "sourceId" = "contractId"
          AND "sourceSnapshot" -> 'partnerCaseId' = 'null'::jsonb
        THEN ("sourceSnapshot" - 'partnerCaseId') @? ${markerPath}
        ELSE "sourceSnapshot" @? ${markerPath}
      END
    UNION ALL SELECT 'RECEIVABLE', id FROM accounting_receivables WHERE metadata @? ${markerPath}
    UNION ALL SELECT 'PAYMENT', id FROM accounting_payment_statuses WHERE metadata @? ${markerPath}
    UNION ALL SELECT 'TAX', id FROM accounting_tax_records WHERE metadata @? ${markerPath}
    UNION ALL SELECT 'AUDIT', id FROM accounting_audit_logs
      WHERE ("beforeState" @? ${markerPath} OR "afterState" @? ${markerPath})
        ${reviewRecordId ? Prisma.sql`AND "recordId" = ${reviewRecordId}` : Prisma.empty}`;
  finishProvenance();
  countAccountingReadRows('markedProvenanceRows', markedRows.length);
  const markedIds = (kind: ListKind) => markedRows.filter(row => row.kind === kind).map(row => row.id);
  const ordinaryFinancial: Prisma.AccountingFinancialRecordWhereInput = selection.focusedCaseId
    ? { id: { in: [] } } : { sourceKind: { not: PARTNER_INTERNAL_ACCOUNTING_SOURCE }, id: { notIn: markedIds('FINANCIAL') } };
  const partnerFinancial: Prisma.AccountingFinancialRecordWhereInput = {
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: { in: allowedInternalIds }, contractId: null, customerId: null,
  };
  const financialAccess: Prisma.AccountingFinancialRecordWhereInput = { AND: [ordinaryContract, { OR: [
    ordinaryFinancial, partnerFinancial,
  ] }] };
  const receivableAccess: Prisma.AccountingReceivableWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [selection.focusedCaseId ? { id: { in: [] } } : { id: { notIn: markedIds('RECEIVABLE') } },
      { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] },
    { invoiceRecord: partnerFinancial },
  ] }] };
  const paymentAccess: Prisma.AccountingPaymentStatusWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [selection.focusedCaseId ? { id: { in: [] } } : { id: { notIn: markedIds('PAYMENT') } }, { receivableId: null }] },
    { AND: [selection.focusedCaseId ? { id: { in: [] } } : { id: { notIn: markedIds('PAYMENT') } },
      { receivable: { AND: [receivableAccess, { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] } }] },
    { receivable: { AND: [receivableAccess, { invoiceRecord: partnerFinancial }] } },
  ] }] };
  const taxAccess: Prisma.AccountingTaxRecordWhereInput = { AND: [ordinaryContract, { OR: [
    { AND: [selection.focusedCaseId ? { id: { in: [] } } : { id: { notIn: markedIds('TAX') } },
      { OR: [{ invoiceRecordId: null }, { invoiceRecord: ordinaryFinancial }] }] },
    { invoiceRecord: partnerFinancial },
  ] }] };
  // Audit has polymorphic references, not foreign keys. Resolve the same denied
  // owners once in this snapshot; audit bodies are never returned for a hidden owner.
  const [hiddenRecords, hiddenReceivables, hiddenPayments, hiddenTax] = await Promise.all([
    canReadAudit || canReadCorrections
      ? database.accountingFinancialRecord.findMany({ where: { NOT: financialAccess }, select: { id: true } }) : [],
    canReadAudit ? database.accountingReceivable.findMany({ where: { NOT: receivableAccess }, select: { id: true } }) : [],
    canReadAudit ? database.accountingPaymentStatus.findMany({ where: { NOT: paymentAccess }, select: { id: true } }) : [],
    canReadAudit ? database.accountingTaxRecord.findMany({ where: { NOT: taxAccess }, select: { id: true } }) : [],
  ]);
  const recordIds = hiddenRecords.map(row => row.id);
  const hiddenCaseContractIds = cases.filter(row => !allowedInternalIds.includes(row.internalRecordId))
    .map(row => row.customerContractId);
  const [hiddenCorrections, hiddenFlags] = !canReadAudit
    ? [[], []] as const : await Promise.all([
    database.accountingCorrectionRequest.findMany({ where: { OR: [
      { recordId: { in: recordIds } }, { contractId: { in: hiddenCaseContractIds } },
    ] }, select: { id: true } }),
    database.accountingContractFlag.findMany({ where: { OR: [
      { sourceFinancialRecordId: { in: recordIds } }, { contractId: { in: hiddenCaseContractIds } },
    ] }, select: { id: true } }),
  ]);
  const hiddenEntityIds = [...recordIds, ...hiddenReceivables.map(row => row.id),
    ...hiddenPayments.map(row => row.id), ...hiddenTax.map(row => row.id),
    ...hiddenCorrections.map(row => row.id), ...hiddenFlags.map(row => row.id)];
  const auditAccess: Prisma.AccountingAuditLogWhereInput = { AND: [ordinaryContract,
    { OR: [{ recordId: null }, { recordId: { notIn: recordIds } }] },
    { OR: [{ entityId: null }, { entityId: { notIn: hiddenEntityIds } }] },
  ] };
  const contextByInvoice = new Map<string, PartnerAccountingContext>();
  const partnerInvoiceEvidence = new Map<string, AccountingFinancialRecord>();
  const healthyCases = new Set<string>();
  const currentAccountingByCase = new Map<string, PartnerAccountingSource['view']>();
  const currentPreparationByCase = new Map<string, { plan: PartnerAccountingSource['view']['sabalanPaymentPlan'];
    preparation: PartnerFinancialPreparation }>();
  const committedCases = new Set<string>();
  const finalCases = new Set<string>();
  const commercialByCase = new Map<string, PartnerCommercialState>();
  const sharesCaseFence = Boolean(actor && !selection.focusedCaseId);
  let commercialRoots: ReturnType<typeof readAccountingCommercialRoots> | undefined;
  const readCommercialForCase = async (caseId: string, currentRoot?: Parameters<typeof readAccountingCommercialState>[2]) => {
    if (sharesCaseFence && !caseAuthority?.hasCase(caseId)) {
      throw new Error('Accounting commercial evidence requires a fenced Case');
    }
    const known = commercialByCase.get(caseId);
    if (known) return known;
    if (!sharesCaseFence) return readPartnerCommercialState(database, caseId);
    if (currentRoot) return readAccountingCommercialState(database, caseId, currentRoot);
    // A fresh preparation decision can allow a previously denied Case after a grant expires.
    if (reviewRecordId || !allowedCaseIds.has(caseId)) return readAccountingCommercialState(database, caseId);
    commercialRoots ??= readAccountingCommercialRoots(database, allowedCaseIds);
    const root = (await commercialRoots).get(caseId);
    if (!root) throw new Error('Fenced Accounting commercial Case evidence missing');
    return readAccountingCommercialState(database, caseId, root);
  };
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
    const referencedInvoiceIds = new Set(rows.flatMap(row => {
      const id = invoiceFor(row);
      return id ? [id] : [];
    }));
    const missingIds = [...referencedInvoiceIds].filter(id => !partnerInvoiceEvidence.has(id));
    if (missingIds.length) {
      const additionalInvoices = await database.accountingFinancialRecord.findMany({ where: { id: { in: missingIds },
        sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE } });
      for (const invoice of additionalInvoices) partnerInvoiceEvidence.set(invoice.id, invoice);
    }
    const pendingInvoices = [...referencedInvoiceIds].flatMap(id => {
      const invoice = partnerInvoiceEvidence.get(id);
      if (!invoice || contextByInvoice.has(id)) return [];
      const row = cases.find(candidate => candidate.internalRecordId === invoice.sourceId);
      const preparation = object(invoice.sourceSnapshot)?.partnerPreparation as PartnerFinancialPreparation | undefined;
      const owner = RevisionRefSchema.safeParse(preparation?.owner);
      if (!row || !allowedInternalIds.includes(row.internalRecordId) || !owner.success || owner.data.caseId !== row.id ||
          object(invoice.metadata)?.partnerCaseId !== row.id) throw conflict();
      if (sharesCaseFence && !caseAuthority?.hasCase(row.id)) throw conflict();
      return [{ invoice, row, owner: owner.data, preparation }];
    });
    const pendingCaseIds = [...new Set(pendingInvoices.map(({ row }) => row.id))];
    const currentViews = sharesCaseFence
      ? await readCurrentPartnerCaseViewsBatch(database, pendingCaseIds.filter(id => !healthyCases.has(id))) : undefined;
    const frozenHeads = currentViews && !reviewRecordId ? await readFrozenPartnerPredecessors(database, Array.from(currentViews.values(),
      ({ row }) => ({ caseId: row.id, predecessorRevision: row.headRevision }))) : undefined;
    const currentPlanEvidence = sharesCaseFence ? await readCurrentSabalanPlanEvidence(database, pendingCaseIds) : undefined;
    for (const { invoice, row, owner, preparation } of pendingInvoices) {
      if (!healthyCases.has(row.id)) {
        const batchedCurrent = currentViews?.get(row.id);
        const current = currentViews ? batchedCurrent : await readCurrentPartnerCaseViews(database, row.id);
        if (!current?.accounting) throw conflict();
        currentAccountingByCase.set(row.id, current.accounting);
        if (current.row.state === 'COMMITTED') committedCases.add(row.id);
        const commercial = await readCommercialForCase(row.id, batchedCurrent?.row);
        if (commercial) commercialByCase.set(row.id, commercial);
        if (current.row.state === 'COMMITTED' && (!commercial || commercial.status === 'FINAL')) finalCases.add(row.id);
        const frozen = frozenHeads ? frozenHeads.has(row.id) : await partnerPredecessorIsFrozen(database, row.id, current.row.headRevision);
        if (frozen) frozenCases.add(row.id);
        healthyCases.add(row.id);
      }
      // The current projection already passed the canonical reconstruction.
      // A saved invoice from another revision still needs its own reconstruction.
      const currentAccounting = currentAccountingByCase.get(row.id);
      if (!currentAccounting) throw conflict();
      const currentOwner = currentAccounting.owner;
      const invoiceAccounting = owner.revision === currentOwner.revision &&
        owner.integrityHash === currentOwner.integrityHash
        ? currentAccounting
        : (await readPartnerRevisionProjections(database, owner))?.accounting;
      if (!invoiceAccounting) throw conflict();
      // Live terms and immutable invoice terms are validated independently.
      let current = currentPreparationByCase.get(row.id);
      if (!current) {
        const plan = await resolveCurrentSabalanPlan(database, row.id, currentAccounting.sabalanPaymentPlan, currentPlanEvidence);
        const prepared = await preparePartnerFinancialSource({ view: {
          ...currentAccounting, sabalanPaymentPlan: plan, state: 'COMMITTED',
        }, partnerSellerId: row.profile.userId }, currentAccounting.owner);
        if (!prepared.ok) throw conflict();
        current = { plan, preparation: prepared.value };
        currentPreparationByCase.set(row.id, current);
      }
      const invoicePlan = await resolveInvoiceSabalanPlan(database, owner,
        invoiceAccounting.sabalanPaymentPlan, preparation?.paymentPlan, currentPlanEvidence);
      // Reuse the canonical rebuild only after both plans have resolved to identical terms for this head.
      let rebuilt = current.preparation;
      if (invoiceAccounting !== currentAccounting || (invoicePlan !== current.plan && canonicalJson(invoicePlan) !== canonicalJson(current.plan))) {
        const prepared = await preparePartnerFinancialSource({ view: {
          ...invoiceAccounting, sabalanPaymentPlan: invoicePlan, state: 'COMMITTED',
        }, partnerSellerId: row.profile.userId }, owner);
        if (!prepared.ok) throw conflict();
        rebuilt = prepared.value;
      }
      if (!preparation || !matchesFinancialPreparation(rebuilt, preparation) ||
          invoice.currency !== rebuilt.amount.currency || subtract(invoice.amount.toString(), rebuilt.amount.amount) !== '0') throw conflict();
      contextByInvoice.set(invoice.id, { caseId: row.id, caseNumber: invoiceAccounting.caseNumber,
        trackingNumber: row.trackingCode?.number,
        customerContractNumber: invoiceAccounting.customerContractNumber,
        internalRecordNumber: invoiceAccounting.recordNumber, partnerSellerId: row.profile.userId,
        commercialAccountId: invoiceAccounting.commercialAccountId, debtor: invoiceAccounting.debtor,
        endCustomer: { displayName: row.customer.companyName ||
          `${row.customer.firstName} ${row.customer.lastName}`.trim() },
        revision: owner.revision, caseState: row.state, commercialStatus: commercialByCase.get(row.id)?.status,
        accountingWritable: writableCases.has(row.id) && finalCases.has(row.id),
        accountingDraftDeletionWritable: writableCases.has(row.id),
        actionUrl: `/dashboard/accounting/invoice-candidates?search=${encodeURIComponent(invoiceAccounting.caseNumber)}` });
      preparationByInvoice.set(invoice.id, preparation);
    }
    return rows.map(row => {
      const invoiceId = invoiceFor(row) || '';
      const context = contextByInvoice.get(invoiceId);
      if (!context) return row;
      const invoice = partnerInvoiceEvidence.get(invoiceId);
      const writable = canManagePayments && writableCases.has(context.caseId) && committedCases.has(context.caseId) &&
        Boolean(invoice && ['ISSUED', 'POSTED'].includes(invoice.status));
      const payment = row as T & { method?: string; status?: string; checkStatus?: keyof typeof partnerCheckTransitions | null };
      const taxStatus = (row as T & { submissionStatus?: keyof typeof partnerTaxTransitions }).submissionStatus;
      const taxWritable = canManageTax && writableCases.has(context.caseId) && committedCases.has(context.caseId) &&
        Boolean(invoice && ['ISSUED', 'POSTED'].includes(invoice.status) && object(invoice.metadata)?.partnerApproval);
      return { ...row, sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, partnerContext: context,
        ...(['PAYMENT', 'RECEIVABLE'].includes(kind) ? { partnerActions: {
          registerReceipt: kind === 'RECEIVABLE' && writable && finalCases.has(context.caseId) && !frozenCases.has(context.caseId) && !['VOIDED', 'SETTLED'].includes(payment.status || ''),
          reverseReceipt: kind === 'PAYMENT' && writable && ['CASH', 'BANK_TRANSFER'].includes(payment.method || '') &&
            ['RECEIVED', 'RECONCILED'].includes(payment.status || ''),
          checkStatuses: kind === 'PAYMENT' && writable && payment.method === 'CHECK' && payment.checkStatus
            ? (partnerCheckTransitions[payment.checkStatus] || []).filter(status => finalCases.has(context.caseId) || ['RETURNED', 'BOUNCED'].includes(status)) : [],
        } } : {}),
        ...(kind === 'TAX' ? { partnerFinancialSource: preparationByInvoice.get(invoice!.id)!.totals,
          partnerActions: { taxStatuses: taxWritable && taxStatus ? partnerTaxTransitions[taxStatus].filter(status =>
            finalCases.has(context.caseId) && !frozenCases.has(context.caseId) || !['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(status)) : [] } } : {}),
      };
    });
  };
  // Validate the authorized population once, before any endpoint can aggregate,
  // paginate or serialize it. Dashboard and report reads share this boundary.
  const finishPartnerEvidence = startAccountingReadPhase('partnerEvidence');
  const finishInvoiceEvidence = startAccountingReadPhase('invoiceEvidence');
  const authorizedInvoices = allowedInternalIds.length
    ? await database.accountingFinancialRecord.findMany({ where: partnerFinancial }) : [];
  // Reuse evidence inside this fenced transaction. Contextualization still
  // validates each Partner invoice before any result is returned.
  for (const invoice of authorizedInvoices) partnerInvoiceEvidence.set(invoice.id, invoice);
  await contextualize('FINANCIAL', authorizedInvoices);
  countAccountingReadRows('partnerInvoices', authorizedInvoices.length);
  finishInvoiceEvidence();
  const invoicesById = new Map(authorizedInvoices.map(row => [row.id, row]));
  const invoiceIds = [...invoicesById.keys()];
  const finishCollectionEvidence = startAccountingReadPhase('collectionEvidence');
  const [ownedReceivables, ownedPayments] = invoiceIds.length ? await Promise.all([
    database.accountingReceivable.findMany({ where: { invoiceRecordId: { in: invoiceIds } } }),
    database.accountingPaymentStatus.findMany({ where: { receivable: { invoiceRecordId: { in: invoiceIds } } } }),
  ]) : [[], []];
  countAccountingReadRows('partnerReceivables', ownedReceivables.length);
  countAccountingReadRows('partnerPayments', ownedPayments.length);
  const invoiceByEntity = new Map(invoiceIds.map(id => [id, id]));
  // The collection writer timestamps both knowledge and effect with PostgreSQL's clock.
  const asOf = await readAccountingSnapshotTime(database);
  const paymentsByReceivable = groupPaymentsByReceivable(ownedPayments);
  const verifiedReceivables = new Map<string, { row: typeof ownedReceivables[number]; evidence: ReturnType<typeof readPartnerReceivableEvidence> }>();
  for (const receivable of ownedReceivables) {
    const preparation = preparationByInvoice.get(receivable.invoiceRecordId!)!;
    const evidence = readPartnerReceivableEvidence(receivable, preparation);
    let collected;
    try {
      collected = sumPartnerCollections(paymentsByReceivable.get(receivable.id) ?? [], { currency: receivable.currency,
        cutoff: asOf, asOf, preparation });
    } catch (error) {
      if (error instanceof PartnerCollectionIntegrityError) throw conflict();
      throw error;
    }
    if (collected === null || subtract(receivable.paidAmount.toString(), collected) !== '0') throw conflict();
    const remaining = subtract(receivable.originalAmount.toString(), collected);
    if (remaining.startsWith('-') || subtract(receivable.remainingAmount.toString(), remaining) !== '0') throw conflict();
    const invoice = invoicesById.get(receivable.invoiceRecordId!)!;
    const statuses = invoice.status === 'VOIDED' && collected === '0' ? ['VOIDED']
      : remaining === '0' ? ['SETTLED'] : collected === '0' ? ['OPEN', 'OVERDUE'] : ['PARTIALLY_PAID', 'OVERDUE'];
    if (!statuses.includes(receivable.status)) throw conflict();
    invoiceByEntity.set(receivable.id, receivable.invoiceRecordId!);
    verifiedReceivables.set(receivable.id, { row: receivable, evidence });
  }
  for (const payment of ownedPayments) {
    const invoiceId = invoiceByEntity.get(payment.receivableId!)!;
    const preparation = preparationByInvoice.get(invoiceId)!;
    if (payment.contractId || payment.currency !== preparation.amount.currency) throw conflict();
    assertWitnesses(payment.metadata, preparation);
    invoiceByEntity.set(payment.id, invoiceId);
  }
  finishCollectionEvidence();
  const finishTaxEvidence = startAccountingReadPhase('taxEvidence');
  const ownedTaxes = invoiceIds.length
    ? await database.accountingTaxRecord.findMany({ where: { invoiceRecordId: { in: invoiceIds } } }) : [];
  countAccountingReadRows('partnerTaxRows', ownedTaxes.length);
  const taxesByInvoice = new Map<string, typeof ownedTaxes>();
  for (const tax of ownedTaxes) {
    const siblings = taxesByInvoice.get(tax.invoiceRecordId!) || [];
    siblings.push(tax);
    assertSinglePartnerTaxRecord(siblings);
    taxesByInvoice.set(tax.invoiceRecordId!, siblings);
    assertPartnerTaxEvidence(tax, tax.invoiceRecordId!, preparationByInvoice.get(tax.invoiceRecordId!)!);
    invoiceByEntity.set(tax.id, tax.invoiceRecordId!);
  }
  finishTaxEvidence();
  // Audit references are polymorphic and legacy snapshots can be orphaned.
  // Select Partner-bearing JSON in the database, not after user pagination. An
  // unknown or ordinary reference cannot authorize a private snapshot.
  const finishAuditEvidence = startAccountingReadPhase('auditEvidence');
  const markedAuditIds = markedIds('AUDIT');
  const { rejectedIds: rejectedAuditIds, witnesses } = selection.focusedCaseId || selection.ordinaryOnly || !invoiceIds.length && !canReadAudit
    ? { rejectedIds: [] as string[], witnesses: [] as Array<{ beforeState: Prisma.JsonValue | null; afterState: Prisma.JsonValue | null; invoiceId: string }> }
    : await readAuthorizedPartnerAuditWitnesses(database, markedAuditIds, invoiceByEntity, { projectStates: true });
  for (const audit of witnesses) {
    const preparation = preparationByInvoice.get(audit.invoiceId)!;
    assertWitnesses(audit.beforeState, preparation);
    assertWitnesses(audit.afterState, preparation);
  }
  countAccountingReadRows('partnerAuditWitnesses', witnesses.length);
  finishAuditEvidence();
  auditAccess.AND = [...auditAccess.AND as Prisma.AccountingAuditLogWhereInput[], { id: { notIn: rejectedAuditIds } }];
  finishPartnerEvidence();
  finishPopulation();
  return { database, asOf,
    actorId: actor?.userId ?? null,
    caseAuthority,
    readCommercialForCase: (caseId: string) => readCommercialForCase(caseId),
    partnerAccountingIncluded: authorizedInvoices.length > 0,
    authorizedPartnerInternalIds: allowedInternalIds,
    verifiedPurchaseRows(invoiceId: string, receivableId: string, caseId: string) {
      const invoice = invoicesById.get(invoiceId), receivable = verifiedReceivables.get(receivableId);
      const preparation = preparationByInvoice.get(invoiceId);
      if (!invoice || !preparation || preparation.owner.caseId !== caseId ||
          !receivable || receivable.row.invoiceRecordId !== invoice.id) throw conflict();
      return { invoice, receivable: receivable.row, evidence: receivable.evidence, preparation,
        payments: paymentsByReceivable.get(receivableId) ?? [] };
    },
    verifiedInvoicePreparation: (invoice: AccountingFinancialRecord, caseId: string) => {
      const preparation = preparationByInvoice.get(invoice.id);
      if (!preparation || preparation.owner.caseId !== caseId || preparation.internalRecordId !== invoice.sourceId ||
          invoice.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoice.kind !== 'INVOICE_CANDIDATE' ||
          invoice.contractId || invoice.customerId || object(invoice.metadata)?.partnerCaseId !== caseId) throw conflict();
      return preparation;
    },
    contextualize,
    search: async (kind: ListKind | 'CORRECTION', ordinaryContractIds: string[], text: string) => {
      const normalized = text.toLocaleLowerCase();
      const matchedSources = cases.filter(row => allowedInternalIds.includes(row.internalRecordId) &&
        [row.caseNumber, row.internalRecord.recordNumber, row.customerContract.contractNumber,
          row.trackingCode?.number ? `همکار-${row.trackingCode.number.toLocaleString('fa-IR', { useGrouping: false, minimumIntegerDigits: 5 })}` : '',
          row.customer.companyName ?? '', row.customer.firstName, row.customer.lastName,
          `${row.customer.firstName} ${row.customer.lastName}`]
          .some(value => value.toLocaleLowerCase().includes(normalized)))
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
    financial: (where: Prisma.AccountingFinancialRecordWhereInput = {}): Prisma.AccountingFinancialRecordWhereInput => ({
      AND: [financialAccess, ...(reviewRecordId ? [{ id: reviewRecordId }] : []), where] }),
    receivable: (where: Prisma.AccountingReceivableWhereInput = {}): Prisma.AccountingReceivableWhereInput => ({
      AND: [receivableAccess, ...(reviewRecordId ? [{ invoiceRecordId: reviewRecordId }] : []), where] }),
    payment: (where: Prisma.AccountingPaymentStatusWhereInput = {}): Prisma.AccountingPaymentStatusWhereInput => ({
      AND: [paymentAccess, ...(reviewRecordId ? [{ receivable: { invoiceRecordId: reviewRecordId } }] : []), where] }),
    tax: (where: Prisma.AccountingTaxRecordWhereInput = {}): Prisma.AccountingTaxRecordWhereInput => ({
      AND: [taxAccess, ...(reviewRecordId ? [{ invoiceRecordId: reviewRecordId }] : []), where] }),
    audit: (where: Prisma.AccountingAuditLogWhereInput = {}): Prisma.AccountingAuditLogWhereInput => {
      if (!canReadAudit) throw new Error('Audit reads require an Accounting audit scope');
      return { AND: [auditAccess, ...(reviewRecordId ? [{ recordId: reviewRecordId }] : []), where] };
    },
    correction: (where: Prisma.AccountingCorrectionRequestWhereInput = {}): Prisma.AccountingCorrectionRequestWhereInput => {
      if (!canReadCorrections) throw new Error('Correction reads require an Accounting correction scope');
      return { AND: [{ OR: [ordinaryContract,
      { recordId: { in: invoiceIds }, contractId: { in: cases.filter(row =>
        allowedInternalIds.includes(row.internalRecordId)).map(row => row.customerContractId) } }] },
      { OR: [{ recordId: null }, { recordId: { notIn: recordIds } }] }, where] };
    },
  };
}
