import { readPartnerCustomerSignature } from './customerSignature';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PartnerCommercialState } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { resolvePartnerAccountingScopedAuthority } from '../authorization/centralAuthority';
import { prismaAuthorizationSource } from '../authorization/prisma';
import { hasSharedOperationAuthority } from '../authorization/sharedOperationAuthority';
import { readPartnerCommercialState } from '../cases/commercialLifecycle';
import { projectPartnerInternalContent, projectPartnerInternalSummary, partnerInternalPhysicalFacts } from './internalDocumentContent';
import { withAccountingReadScope, type AccountingReadScope } from './readScope';
import { prisma } from '../../../lib/prisma';
import { fillPartnerPrintCodes, partnerPhysicalPrintDetails, readPartnerPrintCodes } from '../../../utils/partnerProductPrint';
import { partnerCustomerPrintSelect } from './customerPrintInformation';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** A read-only preparation projection, never a persisted financial record.
 * Retail rates, totals and customer payment terms are not returned. */
export async function readPartnerPreparationDocument(tx: Prisma.TransactionClient, actorId: string, caseId: string,
  presentation: 'detail' | 'list' = 'detail',
  accountingAuthority: typeof resolvePartnerAccountingScopedAuthority = resolvePartnerAccountingScopedAuthority,
  commercialInSnapshot?: PartnerCommercialState) {
  // List callers already fenced the Case, Profile and Users in the shared
  // Accounting scope. Taking command locks here would upgrade those fences.
  const source = presentation === 'list' ? prismaAuthorizationSource(tx, accountingAuthority, undefined, 'ACCOUNTING_SNAPSHOT') : undefined;
  const allowed = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'LIST' },
    { correlationId: randomUUID() }, undefined, accountingAuthority, undefined, source).authorize('ACCOUNTING_READ', { kind: 'CASE', id: caseId });
  if (!allowed.ok) return null;
  const root = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, include: {
    head: true, internalRecord: true, customerContract: true, trackingCode: true,
    profile: { include: { commercialAccount: true } },
    customer: { select: partnerCustomerPrintSelect },
  } });
  if (!root?.internalRecord || !root.customerContract) return null;
  const commercial = commercialInSnapshot ?? await readPartnerCommercialState(tx, caseId);
  if (!commercial) return null;
  const write = !root.customerContract.isInactive && commercial.status === 'FINAL' && (await createAuditedPartnerAuthorization(tx,
    { actorId, purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: randomUUID(), reason: 'بررسی امکان ثبت مالی قرارداد قطعی همکار' },
    undefined, accountingAuthority, undefined, source)
    .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok &&
    await hasSharedOperationAuthority(tx, actorId, 'accounting', 'accounting_invoice_candidates_manage');
  const owner = { caseId, revision: root.headRevision, integrityHash: root.integrityHash };
  const projection = object(root.head.internalProjection);
  const accounting = object(projection.accounting), partner = object(projection.partner);
  const parties = object(root.head.partySnapshots), context = object(root.head.customerContent);
  const snapshot = { partnerPreparation: { owner,
    products: accounting.products, totals: accounting.totals, paymentPlan: accounting.sabalanPaymentPlan } };
  const content = presentation === 'list'
    ? { ...projectPartnerInternalSummary(snapshot), items: [] }
    : projectPartnerInternalContent(snapshot, root.head.graph);
  const amountKnown = Boolean(content.totals);
  const codes = presentation === 'list' ? new Map<string, string>() : await readPartnerPrintCodes(tx, root.head.graph);
  content.items = content.items.map(item => ({ ...item, productCode: item.productCode || item.printDetails?.code || codes.get(item.productRowId),
    ...(item.printDetails ? { printDetails: fillPartnerPrintCodes({ ...item.printDetails, code: item.printDetails.code || item.productCode }, codes) } : {}) }));
  const items = presentation === 'list' ? [] : amountKnown ? content.items : (Array.isArray(partner.products) ? partner.products : []).map((row: Record<string, any>) => ({
      ...partnerInternalPhysicalFacts(String(row.productRowId), root.head.graph),
      printDetails: partnerPhysicalPrintDetails(String(row.productRowId), root.head.graph),
      productCode: typeof row.productCode === 'string' ? row.productCode : codes.get(String(row.productRowId)),
      productRowId: String(row.productRowId), description: String(row.description), quantity: String(row.quantity),
      unit: String(row.unit), unitPrice: '0', totalPrice: '0',
    }));
  return { customerSignature: await readPartnerCustomerSignature(tx, caseId, actorId, presentation === 'list' ? 'ACCOUNTING_SNAPSHOT' : 'COMMAND'), id: root.internalRecord.id, preparationOnly: true, amountKnown, commercial, canRegister: write,
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

export async function listPartnerPreparationDocuments(actorId: string, lifecycleView: 'active' | 'inactive' | 'pending' = 'active') {
  return withAccountingReadScope(prisma, { userId: actorId }, scope => listPartnerPreparationDocumentsInScope(scope, actorId, lifecycleView));
}

/** Reuse this request's validated authorization snapshot, never a second root
 * transaction competing for the operations-control lock. List rows need no print geometry. */
export async function listPartnerPreparationDocumentsInScope(scope: AccountingReadScope, actorId: string,
  lifecycleView: 'active' | 'inactive' | 'pending' = 'active',
  reviewable?: { existingInternalIds: readonly string[] }) {
    const pending = lifecycleView === 'pending' ? await scope.database.contractLifecycleRequest.findMany({
      where: { status: 'PENDING' }, select: { contractId: true } }) : [];
    const roots = await scope.database.partnerSaleCase.findMany({ where: { commercialFlowVersion: 1,
      internalRecordId: { not: null }, customerContractId: { not: null }, customerContract: lifecycleView === 'pending'
        ? { id: { in: pending.map(row => row.contractId) } } : { isInactive: lifecycleView === 'inactive' },
      ...(reviewable ? { state: 'COMMITTED', NOT: { internalRecordId: { in: [...reviewable.existingInternalIds] } } } : {}) },
      select: { id: true }, orderBy: { id: 'asc' } });
    const documents: NonNullable<Awaited<ReturnType<typeof readPartnerPreparationDocument>>>[] = [];
    for (const root of roots) {
      const document = await readPartnerPreparationDocument(scope.database, actorId, root.id, 'list', scope.readActorAuthority,
        scope.commercialForCase(root.id));
      if (document) documents.push(document);
    }
    return documents;
}

/** Existing financial rows only need these preparation overlays. Their Case
 * authority and commercial state were already validated in this snapshot. */
export async function readPartnerPreparationOverlaysInScope(scope: AccountingReadScope, internalIds: readonly string[]) {
  if (!internalIds.length) return new Map<string, { contractDate?: string; amountKnown: boolean; isInactive: boolean }>();
  const roots = await scope.database.partnerSaleCase.findMany({ where: { internalRecordId: { in: [...internalIds] } },
    select: { id: true, headRevision: true, integrityHash: true,
      head: { select: { customerContent: true, internalProjection: true } },
      customerContract: { select: { isInactive: true } } } });
  return new Map(roots.map(root => {
    const context = object(root.head.customerContent);
    const accounting = object(object(root.head.internalProjection).accounting);
    const content = projectPartnerInternalSummary({ partnerPreparation: {
      owner: { caseId: root.id, revision: root.headRevision, integrityHash: root.integrityHash },
      products: accounting.products, totals: accounting.totals, paymentPlan: accounting.sabalanPaymentPlan,
    } });
    return [root.id, { contractDate: typeof context.contractDate === 'string' ? context.contractDate : undefined,
      amountKnown: Boolean(content.totals), isInactive: root.customerContract?.isInactive ?? false }] as const;
  }));
}
