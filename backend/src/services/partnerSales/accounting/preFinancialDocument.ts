import { partnerCustomerSignatureContractSelect, readPartnerCustomerSignature, readPartnerPaperSignatureAvailability } from './customerSignature';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import type { AccountingCaseAuthority } from './batchCaseAuthority';
import { hasSharedOperationAuthority } from '../authorization/sharedOperationAuthority';
import type { PartnerPermissionReadClient } from '../authorization/fencedPermissionReads';
import { readPartnerCommercialState } from '../cases/commercialLifecycle';
import { projectPartnerInternalContent, projectPartnerInternalSummary, partnerInternalPhysicalFacts } from './internalDocumentContent';
import { withAccountingReadScope, type AccountingReadScope } from './readScope';
import { prisma } from '../../../lib/prisma';
import { fillPartnerPrintCodes, partnerPhysicalPrintDetails, readPartnerPrintCodes } from '../../../utils/partnerProductPrint';
import { partnerCustomerPrintSelect } from './customerPrintInformation';
import { appendAuthorizationDecisions, type AuthorizationDecisionAudit } from '../../effectiveAuthorization/audit';
import { measureAccountingReadPhase } from '../../accountingReadTiming';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
type RecordPreparationDecision = (decision: AuthorizationDecisionAudit) => Promise<unknown>;

function authorizePartnerPreparationRead(tx: Prisma.TransactionClient, actorId: string, caseId: string,
  source?: AccountingCaseAuthority['preparationSource'], recordDecision?: RecordPreparationDecision) {
  return createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'LIST' },
    { correlationId: randomUUID() }, undefined, undefined, recordDecision, source).authorize('ACCOUNTING_READ', { kind: 'CASE', id: caseId });
}

async function canRegisterPartnerPreparation(tx: Prisma.TransactionClient, actorId: string, caseId: string,
  inactive: boolean, commercialStatus: PartnerCommercialState['status'], source?: AccountingCaseAuthority['preparationSource'],
  recordDecision?: RecordPreparationDecision, permissionClient: PartnerPermissionReadClient = tx) {
  return !inactive && commercialStatus === 'FINAL' && (await createAuditedPartnerAuthorization(tx,
    { actorId, purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: randomUUID(), reason: 'بررسی امکان ثبت مالی قرارداد قطعی همکار' },
    undefined, undefined, recordDecision, source)
    .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok &&
    await hasSharedOperationAuthority(permissionClient, actorId, 'accounting', 'accounting_invoice_candidates_manage');
}

/** A read-only preparation projection, never a persisted financial record.
 * Retail rates, totals and customer payment terms are not returned. */
export async function readPartnerPreparationDocument(tx: Prisma.TransactionClient, actorId: string, caseId: string) {
  if (!(await authorizePartnerPreparationRead(tx, actorId, caseId)).ok) return null;
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: {
    head: true, internalRecord: true, customerContract: true, trackingCode: true,
    profile: { include: { commercialAccount: true } },
    customer: { select: partnerCustomerPrintSelect },
  } });
  if (!root?.internalRecord || !root.customerContract) return null;
  const commercial = await readPartnerCommercialState(tx, caseId);
  if (!commercial) return null;
  const write = await canRegisterPartnerPreparation(tx, actorId, caseId, root.customerContract.isInactive, commercial.status);
  const owner = { caseId, revision: root.headRevision, integrityHash: root.integrityHash };
  const projection = object(root.head.internalProjection);
  const accounting = object(projection.accounting), partner = object(projection.partner);
  const parties = object(root.head.partySnapshots), context = object(root.head.customerContent);
  const snapshot = { partnerPreparation: { owner,
    products: accounting.products, totals: accounting.totals, paymentPlan: accounting.sabalanPaymentPlan } };
  const content = projectPartnerInternalContent(snapshot, root.head.graph);
  const amountKnown = Boolean(content.totals);
  const codes = await readPartnerPrintCodes(tx, root.head.graph);
  content.items = content.items.map(item => ({ ...item, productCode: item.productCode || item.printDetails?.code || codes.get(item.productRowId),
    ...(item.printDetails ? { printDetails: fillPartnerPrintCodes({ ...item.printDetails, code: item.printDetails.code || item.productCode }, codes) } : {}) }));
  const items = amountKnown ? content.items : (Array.isArray(partner.products) ? partner.products : []).map((row: Record<string, any>) => ({
      ...partnerInternalPhysicalFacts(String(row.productRowId), root.head.graph),
      printDetails: partnerPhysicalPrintDetails(String(row.productRowId), root.head.graph),
      productCode: typeof row.productCode === 'string' ? row.productCode : codes.get(String(row.productRowId)),
      productRowId: String(row.productRowId), description: String(row.description), quantity: String(row.quantity),
      unit: String(row.unit), unitPrice: '0', totalPrice: '0',
    }));
  return { customerSignature: await readPartnerCustomerSignature(tx, caseId, actorId), id: root.internalRecord.id, preparationOnly: true, amountKnown, commercial, canRegister: write,
    caseState: root.state, isInactive: root.customerContract.isInactive, owner, status: 'DRAFT', amount: content.totals?.payable ?? '0',
    receivedAmount: '0', remainingAmount: content.totals?.payable ?? '0', currency: 'IRT', createdAt: root.createdAt,
    systemInvoiceNumber: null, systemInvoiceDate: null, sepidarAmount: null, metadata: undefined,
    partnerContext: { caseId, caseNumber: root.caseNumber, trackingNumber: root.trackingCode?.number,
      customerContractNumber: root.customerContract.contractNumber, internalRecordNumber: root.internalRecord.recordNumber,
      partnerSellerId: root.profile.userId, commercialAccountId: root.profile.commercialAccount?.id ?? '',
      debtor: { displayName: String(object(parties.partner).displayName ?? '') },
      endCustomer: { displayName: String(object(parties.customer).displayName ?? ''),
        phone: typeof object(parties.customer).phone === 'string' ? object(parties.customer).phone : undefined }, revision: root.headRevision,
      actionUrl: `/dashboard/accounting/contracts/partner/${encodeURIComponent(caseId)}`, accountingWritable: false, accountingDraftDeletionWritable: false },
    ...content, items, contractDate: typeof context.contractDate === 'string' ? context.contractDate : undefined,
    customerInformation: root.customer,
    project: context.project ? { title: String(object(context.project).title ?? ''), address: String(object(context.project).address ?? '') } : undefined,
    deliveries: (Array.isArray(context.deliveries) ? context.deliveries : []).map((value: unknown) => {
      const delivery = object(value);
      return { deliveryId: String(delivery.deliveryId), date: String(delivery.date), destination: String(delivery.destination),
        receiverName: typeof delivery.receiverName === 'string' ? delivery.receiverName : undefined,
        projectManagerName: typeof delivery.projectManagerName === 'string' ? delivery.projectManagerName : undefined,
        items: (Array.isArray(delivery.items) ? delivery.items : []).map((value: unknown) => { const item = object(value);
          return { productRowId: String(item.productRowId), quantity: String(item.quantity) }; }) };
    }),
    technicalEvidenceAvailable: true,
    receivables: [] as Array<{ id: string; status: string; paidAmount: string; remainingAmount: string; dueDate: Date; payments: Array<{ id: string; amount: string; method: string; status: string; occurredAt: Date | null }> }>,
    taxRecords: [] as Array<{ id: string; readinessStatus: string; submissionStatus: string; taxableAmount: string; vatAmount: string }>,
    flags: [] as Array<{ id: string; title: string; note: string | null; severity: string; status: string }>,
  };
}

const preparationListRootSelect = {
  id: true, caseNumber: true, state: true, createdAt: true, headRevision: true, integrityHash: true,
  internalRecord: { select: { id: true, recordNumber: true } },
  customerContract: { select: { ...partnerCustomerSignatureContractSelect, contractNumber: true } },
  trackingCode: { select: { number: true } },
  profile: { select: { userId: true, commercialAccount: { select: { id: true } } } },
} satisfies Prisma.PartnerSaleCaseSelect;

type PreparationListRoot = Prisma.PartnerSaleCaseGetPayload<{ select: typeof preparationListRootSelect }>;
type PreparationFacts = {
  caseId: string; contractDate: unknown; products: unknown; totals: unknown; paymentPlan: unknown;
  debtorName?: unknown; customerName?: unknown; customerPhone?: unknown; preparationCompleted?: boolean;
};

/** Only selected wholesale evidence and bounded presentation fields cross the
 * database boundary. The wholesale evidence still uses the full financial schema. */
async function readPreparationFacts(tx: Prisma.TransactionClient, caseIds: string[], presentation: 'list' | 'overlay') {
  const listFacts = presentation === 'list' ? Prisma.sql`,
    r."partySnapshots" #> '{partner,displayName}' AS "debtorName",
    r."partySnapshots" #> '{customer,displayName}' AS "customerName",
    r."partySnapshots" #> '{customer,phone}' AS "customerPhone",
    (r."retailEnvelope" -> 'preparationCompleted') IS DISTINCT FROM 'false'::jsonb AS "preparationCompleted"` : Prisma.empty;
  const facts = caseIds.length ? await tx.$queryRaw<PreparationFacts[]>`
    SELECT c.id AS "caseId", r."customerContent" -> 'contractDate' AS "contractDate",
      r."internalProjection" #> '{accounting,products}' AS products,
      r."internalProjection" #> '{accounting,totals}' AS totals,
      r."internalProjection" #> '{accounting,sabalanPaymentPlan}' AS "paymentPlan"
      ${listFacts}
    FROM partner_sale_cases c
    JOIN partner_case_revisions r ON r."caseId" = c.id AND r.revision = c."headRevision"
    WHERE c.id = ANY(${caseIds}::text[])` : [];
  return new Map(facts.map(fact => [fact.caseId, fact]));
}

function currentPreparationFacts(facts: Map<string, PreparationFacts>, caseId: string) {
  const row = facts.get(caseId);
  if (!row) throw new Error('Accounting Case head evidence missing');
  return row;
}

async function readPreparationListSummary(scope: AccountingReadScope, actorId: string, root: PreparationListRoot,
  caseAuthority: AccountingCaseAuthority, factsByCase: Map<string, PreparationFacts>, recordDecision: RecordPreparationDecision) {
  const tx = scope.database, caseId = root.id;
  const source = caseAuthority.preparationSource;
  if (!(await authorizePartnerPreparationRead(tx, actorId, caseId, source, recordDecision)).ok) return null;
  if (!root.internalRecord || !root.customerContract) return null;
  // The earlier scope can disagree when a time-bound grant or denial expires.
  // Load a newly allowed Case only after its own successful preparation READ.
  const facts = factsByCase.get(caseId) ?? currentPreparationFacts(await readPreparationFacts(tx, [caseId], 'list'), caseId);
  const commercialStatus = (await scope.readCommercialForCase(caseId))?.status;
  if (!commercialStatus) return null;
  const isInactive = root.customerContract.isInactive;
  const canRegister = await canRegisterPartnerPreparation(tx, actorId, caseId, isInactive, commercialStatus, source, recordDecision, caseAuthority.permissionClient);
  const owner = { caseId, revision: root.headRevision, integrityHash: root.integrityHash };
  const content = projectPartnerInternalSummary({ partnerPreparation: { ...facts, owner } });
  // Preserve the advisory paper-signature audit after registration and
  // financial evidence have been evaluated.
  await readPartnerPaperSignatureAvailability(tx, caseId, actorId, root.state, root.customerContract,
    facts.preparationCompleted !== false, { caseAuthority: caseAuthority.signatureSource,
      permissionClient: caseAuthority.permissionClient, recordDecision });

  return { id: root.internalRecord.id, owner, caseState: root.state, isInactive, commercialStatus, canRegister,
    status: 'DRAFT', amountKnown: Boolean(content.totals), amount: content.totals?.payable ?? '0',
    currency: 'IRT', createdAt: root.createdAt, contractDate: typeof facts.contractDate === 'string' ? facts.contractDate : undefined,
    partnerContext: { caseId, caseNumber: root.caseNumber, trackingNumber: root.trackingCode?.number,
      customerContractNumber: root.customerContract.contractNumber, internalRecordNumber: root.internalRecord.recordNumber,
      partnerSellerId: root.profile.userId, commercialAccountId: root.profile.commercialAccount?.id ?? '',
      debtor: { displayName: String(facts.debtorName ?? '') },
      endCustomer: { displayName: String(facts.customerName ?? ''),
        phone: typeof facts.customerPhone === 'string' ? facts.customerPhone : undefined }, revision: root.headRevision,
      actionUrl: `/dashboard/accounting/contracts/partner/${encodeURIComponent(caseId)}`, accountingWritable: false, accountingDraftDeletionWritable: false },
  };
}

export async function listPartnerPreparationDocuments(actorId: string, lifecycleView: 'active' | 'inactive' | 'pending' = 'active') {
  return withAccountingReadScope(prisma, { userId: actorId }, scope => listPartnerPreparationDocumentsInScope(scope, actorId, lifecycleView));
}

/** Reuse this request's validated authorization snapshot. Evaluate and audit
 * each Case in the original order, with evidence read in bulk in that snapshot. */
export async function listPartnerPreparationDocumentsInScope(scope: AccountingReadScope, actorId: string,
  lifecycleView: 'active' | 'inactive' | 'pending' = 'active',
  reviewable?: { existingInternalIds: readonly string[] }) {
  const caseAuthority = scope.caseAuthority;
  if (!caseAuthority) throw new Error('Partner preparation list requires a fenced Accounting Case scope');
  const pending = lifecycleView === 'pending' ? await scope.database.contractLifecycleRequest.findMany({
    where: { status: 'PENDING' }, select: { contractId: true } }) : [];
  const roots = await scope.database.partnerSaleCase.findMany({ where: { commercialFlowVersion: 1,
    internalRecordId: { not: null }, customerContractId: { not: null }, customerContract: lifecycleView === 'pending'
      ? { id: { in: pending.map(row => row.contractId) } } : { isInactive: lifecycleView === 'inactive' },
    ...(reviewable ? { state: 'COMMITTED', NOT: { internalRecordId: { in: [...reviewable.existingInternalIds] } } } : {}) },
    select: preparationListRootSelect, orderBy: { id: 'asc' } });
  const authorized = new Set(scope.authorizedPartnerInternalIds);
  const authorizedCaseIds = roots.flatMap(root => root.internalRecord && authorized.has(root.internalRecord.id) ? [root.id] : []);
  const facts = await readPreparationFacts(scope.database, authorizedCaseIds, 'list');
  const decisions: AuthorizationDecisionAudit[] = [];
  const recordDecision: RecordPreparationDecision = async decision => { decisions.push(decision); };
  const documents: NonNullable<Awaited<ReturnType<typeof readPreparationListSummary>>>[] = [];
  for (const root of roots) {
    const row = await readPreparationListSummary(scope, actorId, root, caseAuthority, facts, recordDecision);
    if (row) documents.push(row);
  }
  await measureAccountingReadPhase('authorizationAudit', () => appendAuthorizationDecisions(scope.database, decisions));
  return documents;
}

/** Existing financial rows only need these preparation overlays. Their Case
 * authority and commercial state were already validated in this snapshot. */
export async function readPartnerPreparationOverlaysInScope(scope: AccountingReadScope, internalIds: readonly string[]) {
  if (!internalIds.length) return new Map<string, { contractDate?: string; amountKnown: boolean; isInactive: boolean }>();
  const roots = await scope.database.partnerSaleCase.findMany({ where: { internalRecordId: { in: [...internalIds] } },
    select: { id: true, headRevision: true, integrityHash: true, customerContract: { select: { isInactive: true } } } });
  const facts = await readPreparationFacts(scope.database, roots.map(root => root.id), 'overlay');
  return new Map(roots.map(root => {
    const row = currentPreparationFacts(facts, root.id);
    const owner = { caseId: root.id, revision: root.headRevision, integrityHash: root.integrityHash };
    const content = projectPartnerInternalSummary({ partnerPreparation: { ...row, owner } });
    return [root.id, { contractDate: typeof row.contractDate === 'string' ? row.contractDate : undefined,
      amountKnown: Boolean(content.totals), isInactive: root.customerContract?.isInactive ?? false }] as const;
  }));
}
